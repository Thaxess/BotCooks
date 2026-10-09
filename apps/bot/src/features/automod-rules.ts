import type { GuildSettings } from '@botcooks/shared';

/**
 * Deterministic auto-moderation rules. Pure functions + a small in-memory tracker so they can be
 * unit tested without Discord. No AI is involved.
 */

export type AutomodRule = 'spam' | 'duplicate' | 'mentions' | 'invite' | 'link' | 'blocked_term';

export interface Violation {
  rule: AutomodRule;
  reason: string;
}

export interface MessageFacts {
  guildId: string;
  authorId: string;
  channelId: string;
  content: string;
  /** Unique user + role mentions (and @everyone/@here counted as one each). */
  mentionCount: number;
  memberRoleIds: string[];
  /** Members with Manage Messages / Administrator are exempt by default. */
  isStaff: boolean;
  timestamp: number;
}

const INVITE_RE = /(?:discord(?:app)?\.com\/invite|discord\.gg|dsc\.gg)\/[\w-]+/i;
const URL_RE = /\bhttps?:\/\/([^\s/<>]+)/gi;

function normalize(s: string): string {
  // Defeat trivial obfuscation: case, accents and zero-width characters (repeats are handled when matching).
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ​-‍﻿]/g, '')
    .toLowerCase();
}

export function findBlockedTerm(content: string, terms: string[]): string | null {
  if (!terms.length) return null;
  const text = normalize(content);
  for (const term of terms) {
    const t = normalize(term);
    if (!t) continue;
    // Each character may repeat ("meanieeee"), but never appear fewer times than written ("as" is not "ass").
    const body = [...t].map((ch) => (ch === ' ' ? '\\s+' : `${escapeRe(ch)}+`)).join('');
    // Whole-word match for word-like terms to limit false positives ("class" vs "ass").
    const wordLike = /^[\p{L}\p{N} ]+$/u.test(t);
    const re = new RegExp(wordLike ? `(?:^|[^\\p{L}\\p{N}])${body}(?:$|[^\\p{L}\\p{N}])` : body, 'u');
    if (re.test(text)) return term;
  }
  return null;
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function findDisallowedLink(content: string, allowedDomains: string[]): string | null {
  for (const match of content.matchAll(URL_RE)) {
    const host = (match[1] ?? '').toLowerCase().replace(/^www\./, '').split(':')[0]!;
    if (!allowedDomains.some((d) => host === d || host.endsWith(`.${d}`))) return host;
  }
  return null;
}

/** Sliding-window spam tracker per guild member. Memory bounded by pruning idle entries. */
export class SpamTracker {
  private recent = new Map<string, Array<{ t: number; hash: string }>>();

  record(facts: MessageFacts, windowMs: number): { count: number; duplicates: number } {
    const key = `${facts.guildId}:${facts.authorId}`;
    const now = facts.timestamp;
    const hash = normalize(facts.content).trim().slice(0, 200);
    const list = (this.recent.get(key) ?? []).filter((e) => now - e.t <= Math.max(windowMs, 60_000));
    list.push({ t: now, hash });
    this.recent.set(key, list.slice(-50));
    const inWindow = list.filter((e) => now - e.t <= windowMs);
    const duplicates = hash ? list.filter((e) => e.hash === hash).length : 0;
    if (this.recent.size > 20_000) this.prune(now);
    return { count: inWindow.length, duplicates };
  }

  reset(guildId: string, userId: string) {
    this.recent.delete(`${guildId}:${userId}`);
  }

  private prune(now: number) {
    for (const [k, v] of this.recent) if (!v.length || now - v[v.length - 1]!.t > 120_000) this.recent.delete(k);
  }
}

export function evaluateMessage(settings: GuildSettings['automod'], facts: MessageFacts, tracker: SpamTracker): Violation | null {
  if (facts.isStaff) return null;
  if (settings.exemptChannelIds.includes(facts.channelId)) return null;
  if (facts.memberRoleIds.some((r) => settings.exemptRoleIds.includes(r))) return null;

  if (settings.maxMentionsPerMessage > 0 && facts.mentionCount > settings.maxMentionsPerMessage) {
    return { rule: 'mentions', reason: `Too many mentions (${facts.mentionCount}, limit ${settings.maxMentionsPerMessage})` };
  }
  if (settings.blockInvites && INVITE_RE.test(facts.content)) return { rule: 'invite', reason: 'Server invites are not allowed here' };
  if (settings.blockLinks) {
    const host = findDisallowedLink(facts.content, settings.allowedDomains);
    if (host) return { rule: 'link', reason: `Links to ${host} are not allowed here` };
  }
  const term = findBlockedTerm(facts.content, settings.blockedTerms);
  if (term) return { rule: 'blocked_term', reason: 'Message contained a blocked term' };

  if (settings.spam.enabled) {
    const { count, duplicates } = tracker.record(facts, settings.spam.perSeconds * 1000);
    if (count > settings.spam.maxMessages) return { rule: 'spam', reason: `Sending messages too fast (${count} in ${settings.spam.perSeconds}s)` };
    if (duplicates >= settings.spam.duplicateThreshold) return { rule: 'duplicate', reason: 'Repeating the same message' };
  }
  return null;
}

/** Join-rate tracker for anti-raid. */
export class JoinTracker {
  private joins = new Map<string, number[]>();
  private lastAlert = new Map<string, number>();

  /** Records a join and reports whether the guild is over the threshold right now. */
  record(guildId: string, now: number, threshold: number, perSeconds: number): { count: number; raid: boolean; shouldAlert: boolean } {
    const windowMs = perSeconds * 1000;
    const list = (this.joins.get(guildId) ?? []).filter((t) => now - t <= windowMs);
    list.push(now);
    this.joins.set(guildId, list.slice(-1000));
    const raid = list.length >= threshold;
    // Alert at most once per window so staff are not flooded during a raid.
    const last = this.lastAlert.get(guildId);
    const shouldAlert = raid && (last === undefined || now - last > windowMs);
    if (shouldAlert) this.lastAlert.set(guildId, now);
    return { count: list.length, raid, shouldAlert };
  }
}

export function accountAgeDays(createdTimestamp: number, now = Date.now()): number {
  return Math.floor((now - createdTimestamp) / 86_400_000);
}
