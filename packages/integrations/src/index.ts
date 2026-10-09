import { z } from 'zod';

/**
 * Stream / upload status clients. All are polling-based:
 *  - YouTube: public channel RSS feed (no API key). Not an official API with an SLA; it can lag
 *    by several minutes and only shows recent uploads (not live status).
 *  - Twitch: Helix `GET /helix/streams` with an app access token (client credentials).
 *  - Kick: official public API `GET /public/v1/channels?slug=` with an app access token
 *    (client credentials via https://id.kick.com/oauth/token).
 * Real-time webhooks (Twitch EventSub, YouTube WebSub) need a public HTTPS callback and are
 * not implemented yet.
 */

export type Fetch = typeof fetch;

export interface LiveStatus {
  account: string;
  live: boolean;
  /** Stable id of the current broadcast/video, used to avoid duplicate alerts. */
  id: string | null;
  title: string | null;
  url: string;
  game?: string | null;
}

export class IntegrationError extends Error {
  constructor(
    message: string,
    readonly retryable = true,
  ) {
    super(message);
    this.name = 'IntegrationError';
  }
}

const TIMEOUT = 15_000;

// ------------------------------------------------------------------ YouTube
export const youtubeChannelIdSchema = z.string().regex(/^UC[\w-]{22}$/, 'Use the channel ID that starts with UC (24 characters).');

export interface YouTubeVideo {
  videoId: string;
  title: string;
  url: string;
  published: string;
}

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

export function parseYouTubeFeed(xml: string): YouTubeVideo[] {
  const entries = xml.split('<entry>').slice(1);
  return entries
    .map((entry) => {
      const videoId = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1];
      const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1];
      const published = entry.match(/<published>([^<]+)<\/published>/)?.[1];
      if (!videoId || !title || !published) return null;
      return { videoId, title: decodeXml(title).trim(), url: `https://www.youtube.com/watch?v=${videoId}`, published };
    })
    .filter((v): v is YouTubeVideo => v !== null);
}

export async function fetchYouTubeLatest(channelId: string, fetchImpl: Fetch = fetch): Promise<YouTubeVideo | null> {
  youtubeChannelIdSchema.parse(channelId);
  const res = await fetchImpl(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`, {
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (res.status === 404) throw new IntegrationError('YouTube channel not found. Check the channel ID.', false);
  if (!res.ok) throw new IntegrationError(`YouTube feed returned HTTP ${res.status}.`);
  const videos = parseYouTubeFeed(await res.text());
  return videos.sort((a, b) => b.published.localeCompare(a.published))[0] ?? null;
}

// ------------------------------------------------------------------ OAuth client credentials (Twitch & Kick)
interface CachedToken {
  token: string;
  expiresAt: number;
}

const tokenResponse = z.object({ access_token: z.string(), expires_in: z.number() });

class ClientCredentials {
  private cached: CachedToken | null = null;
  constructor(
    private readonly url: string,
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly fetchImpl: Fetch,
  ) {}

  async token(): Promise<string> {
    if (this.cached && this.cached.expiresAt > Date.now() + 60_000) return this.cached.token;
    const res = await this.fetchImpl(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.clientId, client_secret: this.clientSecret, grant_type: 'client_credentials' }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (res.status === 400 || res.status === 401 || res.status === 403) throw new IntegrationError('App credentials were rejected.', false);
    if (!res.ok) throw new IntegrationError(`Token endpoint returned HTTP ${res.status}.`);
    const parsed = tokenResponse.parse(await res.json());
    this.cached = { token: parsed.access_token, expiresAt: Date.now() + parsed.expires_in * 1000 };
    return parsed.access_token;
  }

  invalidate() {
    this.cached = null;
  }
}

// ------------------------------------------------------------------ Twitch
export const twitchLoginSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,25}$/, 'Twitch usernames are 3-25 letters, numbers or underscores.');

const twitchStreams = z.object({
  data: z.array(
    z.object({ id: z.string(), user_login: z.string(), title: z.string(), game_name: z.string().optional(), type: z.string() }),
  ),
});

export class TwitchClient {
  private readonly creds: ClientCredentials;
  constructor(
    private readonly clientId: string,
    clientSecret: string,
    private readonly fetchImpl: Fetch = fetch,
  ) {
    this.creds = new ClientCredentials('https://id.twitch.tv/oauth2/token', clientId, clientSecret, fetchImpl);
  }

  /** Up to 100 logins per request (Helix limit). */
  async getLiveStatus(logins: string[]): Promise<LiveStatus[]> {
    const unique = [...new Set(logins.map((l) => twitchLoginSchema.parse(l)))];
    const out: LiveStatus[] = [];
    for (let i = 0; i < unique.length; i += 100) {
      const batch = unique.slice(i, i + 100);
      const params = new URLSearchParams();
      for (const l of batch) params.append('user_login', l);
      const data = await this.request(`https://api.twitch.tv/helix/streams?${params}`);
      const live = new Map(twitchStreams.parse(data).data.filter((s) => s.type === 'live').map((s) => [s.user_login.toLowerCase(), s]));
      for (const login of batch) {
        const s = live.get(login);
        out.push({ account: login, live: Boolean(s), id: s?.id ?? null, title: s?.title ?? null, game: s?.game_name ?? null, url: `https://twitch.tv/${login}` });
      }
    }
    return out;
  }

  private async request(url: string, retried = false): Promise<unknown> {
    const res = await this.fetchImpl(url, {
      headers: { 'Client-Id': this.clientId, Authorization: `Bearer ${await this.creds.token()}` },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (res.status === 401 && !retried) {
      this.creds.invalidate();
      return this.request(url, true);
    }
    if (res.status === 429) throw new IntegrationError('Twitch rate limit reached.');
    if (!res.ok) throw new IntegrationError(`Twitch returned HTTP ${res.status}.`);
    return res.json();
  }
}

// ------------------------------------------------------------------ Kick
export const kickSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_-]{1,25}$/, 'Kick channel slugs are up to 25 letters, numbers, - or _.');

const kickChannels = z.object({
  data: z.array(
    z
      .object({
        slug: z.string(),
        stream_title: z.string().nullable().optional(),
        category: z.object({ name: z.string().optional() }).partial().nullable().optional(),
        stream: z
          .object({ is_live: z.boolean(), start_time: z.string().nullable().optional() })
          .partial()
          .nullable()
          .optional(),
      })
      .passthrough(),
  ),
});

export class KickClient {
  private readonly creds: ClientCredentials;
  constructor(
    clientId: string,
    clientSecret: string,
    private readonly fetchImpl: Fetch = fetch,
  ) {
    this.creds = new ClientCredentials('https://id.kick.com/oauth/token', clientId, clientSecret, fetchImpl);
  }

  /** Up to 50 slugs per request (Kick API limit). */
  async getLiveStatus(slugs: string[]): Promise<LiveStatus[]> {
    const unique = [...new Set(slugs.map((s) => kickSlugSchema.parse(s)))];
    const out: LiveStatus[] = [];
    for (let i = 0; i < unique.length; i += 50) {
      const batch = unique.slice(i, i + 50);
      const params = new URLSearchParams();
      for (const s of batch) params.append('slug', s);
      const res = await this.fetchImpl(`https://api.kick.com/public/v1/channels?${params}`, {
        headers: { Authorization: `Bearer ${await this.creds.token()}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT),
      });
      if (res.status === 401) this.creds.invalidate();
      if (!res.ok) throw new IntegrationError(`Kick returned HTTP ${res.status}.`);
      const byslug = new Map(kickChannels.parse(await res.json()).data.map((c) => [c.slug.toLowerCase(), c]));
      for (const slug of batch) {
        const c = byslug.get(slug);
        const live = Boolean(c?.stream?.is_live);
        out.push({
          account: slug,
          live,
          // Kick does not expose a broadcast id here; the start time identifies a broadcast.
          id: live ? (c?.stream?.start_time ?? 'live') : null,
          title: c?.stream_title ?? null,
          game: c?.category?.name ?? null,
          url: `https://kick.com/${slug}`,
        });
      }
    }
    return out;
  }
}

/** Returns true when a new alert should be posted (went live with a new broadcast id / new video). */
export function shouldAlert(previous: { id?: string | null } | null | undefined, current: { live: boolean; id: string | null }): boolean {
  if (!current.live || !current.id) return false;
  return previous?.id !== current.id;
}
