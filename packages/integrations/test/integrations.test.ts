import { describe, expect, it, vi } from 'vitest';
import { KickClient, TwitchClient, fetchYouTubeLatest, parseYouTubeFeed, shouldAlert } from '../src/index';

const FEED = `<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015">
<entry><yt:videoId>old123</yt:videoId><title>Old &amp; boring</title><published>2026-01-01T00:00:00+00:00</published></entry>
<entry><yt:videoId>new456</yt:videoId><title>New video</title><published>2026-10-01T00:00:00+00:00</published></entry>
</feed>`;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('YouTube', () => {
  it('parses the feed and returns the newest upload', async () => {
    expect(parseYouTubeFeed(FEED)[0]!.title).toBe('Old & boring');
    const latest = await fetchYouTubeLatest('UCabcdefghijklmnopqrstuv', (async () => new Response(FEED)) as unknown as typeof fetch);
    expect(latest?.videoId).toBe('new456');
  });

  it('rejects malformed channel IDs before making a request', async () => {
    const f = vi.fn();
    await expect(fetchYouTubeLatest('not-a-channel', f as unknown as typeof fetch)).rejects.toThrow(/UC/);
    expect(f).not.toHaveBeenCalled();
  });
});

describe('Twitch', () => {
  it('gets an app token once and reports live status per login', async () => {
    const calls: string[] = [];
    const f = (async (url: string) => {
      calls.push(url.split('?')[0]!);
      if (url.startsWith('https://id.twitch.tv')) return json({ access_token: 't', expires_in: 3600 });
      return json({ data: [{ id: 's1', user_login: 'chef', title: 'Cooking live', game_name: 'Food', type: 'live' }] });
    }) as unknown as typeof fetch;
    const client = new TwitchClient('id', 'secret', f);
    const res = await client.getLiveStatus(['Chef', 'sleepy']);
    expect(res).toEqual([
      { account: 'chef', live: true, id: 's1', title: 'Cooking live', game: 'Food', url: 'https://twitch.tv/chef' },
      { account: 'sleepy', live: false, id: null, title: null, game: null, url: 'https://twitch.tv/sleepy' },
    ]);
    await client.getLiveStatus(['chef']);
    expect(calls.filter((c) => c.includes('id.twitch.tv'))).toHaveLength(1);
  });
});

describe('Kick', () => {
  it('reads is_live from the stream object', async () => {
    const f = (async (url: string) => {
      if (url.startsWith('https://id.kick.com')) return json({ access_token: 'k', expires_in: 3600 });
      return json({ data: [{ slug: 'grillmaster', stream_title: 'BBQ', stream: { is_live: true, start_time: '2026-10-08T10:00:00Z' } }] });
    }) as unknown as typeof fetch;
    const [s] = await new KickClient('id', 'secret', f).getLiveStatus(['grillmaster']);
    expect(s).toMatchObject({ live: true, id: '2026-10-08T10:00:00Z', title: 'BBQ' });
  });
});

describe('shouldAlert', () => {
  it('alerts once per broadcast', () => {
    expect(shouldAlert(null, { live: true, id: 'a' })).toBe(true);
    expect(shouldAlert({ id: 'a' }, { live: true, id: 'a' })).toBe(false);
    expect(shouldAlert({ id: 'a' }, { live: false, id: null })).toBe(false);
    expect(shouldAlert({ id: 'a' }, { live: true, id: 'b' })).toBe(true);
  });
});
