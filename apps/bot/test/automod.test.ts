import { describe, expect, it } from 'vitest';
import { DEFAULT_GUILD_SETTINGS } from '@botcooks/shared';
import { JoinTracker, SpamTracker, evaluateMessage, findBlockedTerm, findDisallowedLink, type MessageFacts } from '../src/features/automod-rules';

const base: MessageFacts = {
  guildId: 'g',
  authorId: 'u',
  channelId: 'c',
  content: 'hello there',
  mentionCount: 0,
  memberRoleIds: [],
  isStaff: false,
  timestamp: 1_000_000,
};
const settings = () => structuredClone(DEFAULT_GUILD_SETTINGS.automod);

describe('automod rules', () => {
  it('blocks invites but exempts staff, exempt roles and exempt channels', () => {
    const s = settings();
    const msg = { ...base, content: 'join discord.gg/abc123 now' };
    expect(evaluateMessage(s, msg, new SpamTracker())?.rule).toBe('invite');
    expect(evaluateMessage(s, { ...msg, isStaff: true }, new SpamTracker())).toBeNull();
    s.exemptRoleIds = ['111111111111111111'];
    expect(evaluateMessage(s, { ...msg, memberRoleIds: ['111111111111111111'] }, new SpamTracker())).toBeNull();
    s.exemptChannelIds = ['c'];
    expect(evaluateMessage(s, msg, new SpamTracker())).toBeNull();
  });

  it('enforces mention limits', () => {
    expect(evaluateMessage(settings(), { ...base, mentionCount: 6 }, new SpamTracker())?.rule).toBe('mentions');
    expect(evaluateMessage(settings(), { ...base, mentionCount: 5 }, new SpamTracker())).toBeNull();
  });

  it('matches blocked terms as whole words through simple obfuscation', () => {
    expect(findBlockedTerm('You are a MEANIEEEE', ['meanie'])).toBe('meanie');
    expect(findBlockedTerm('mé​anie', ['meanie'])).toBe('meanie');
    expect(findBlockedTerm('a classic class', ['ass'])).toBeNull();
    expect(findBlockedTerm('buy cheap-pills.xyz', ['cheap-pills'])).toBe('cheap-pills');
  });

  it('allows listed domains and their subdomains when links are blocked', () => {
    expect(findDisallowedLink('see https://www.youtube.com/watch?v=x', ['youtube.com'])).toBeNull();
    expect(findDisallowedLink('see https://music.youtube.com/x', ['youtube.com'])).toBeNull();
    expect(findDisallowedLink('see https://evil.example/x', ['youtube.com'])).toBe('evil.example');
    expect(findDisallowedLink('see https://youtube.com.evil.example/x', ['youtube.com'])).toBe('youtube.com.evil.example');
  });

  it('detects bursts and duplicate messages', () => {
    const s = settings();
    const tracker = new SpamTracker();
    let v = null;
    for (let i = 0; i < 7 && !v; i++) v = evaluateMessage(s, { ...base, content: `msg ${i}`, timestamp: base.timestamp + i * 100 }, tracker);
    expect(v?.rule).toBe('spam');

    const t2 = new SpamTracker();
    const results = [0, 1, 2].map((i) => evaluateMessage(s, { ...base, content: 'BUY NOW', timestamp: base.timestamp + i * 3000 }, t2));
    expect(results[2]?.rule).toBe('duplicate');
  });
});

describe('JoinTracker', () => {
  it('flags a raid once per window', () => {
    const t = new JoinTracker();
    const results = Array.from({ length: 12 }, (_, i) => t.record('g', 1000 + i * 100, 10, 30));
    expect(results[8]!.raid).toBe(false);
    expect(results[9]!.raid).toBe(true);
    expect(results.filter((r) => r.shouldAlert)).toHaveLength(1);
  });
});
