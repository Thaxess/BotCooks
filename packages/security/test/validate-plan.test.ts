import { describe, expect, it } from 'vitest';
import { PermissionFlagsBits } from 'discord-api-types/v10';
import { serverPlanSchema, type ServerPlanInput } from '@botcooks/shared';
import { makeSnapshot } from '@botcooks/shared/testing';
import { normalizeTextChannelName, validatePlan } from '../src/validate-plan';

const plan = (input: ServerPlanInput) => serverPlanSchema.parse(input);
const codes = (r: ReturnType<typeof validatePlan>) => r.issues.map((i) => i.code);

describe('validatePlan', () => {
  it('never lets a generated plan grant Administrator', () => {
    const r = validatePlan(
      plan({ roles: [{ key: 'boss', name: 'Boss', permissions: ['Administrator', 'KickMembers'] }] }),
      makeSnapshot(),
    );
    expect(r.plan.roles[0]!.permissions).toEqual(['KickMembers']);
    expect(codes(r)).toContain('administrator_stripped');
    expect(r.blocking).toBe(false);
  });

  it('strips dangerous permissions from self-assignable and auto-assigned roles', () => {
    const r = validatePlan(
      plan({
        roles: [
          { key: 'fun', name: 'Fun', selfAssignable: true, permissions: ['BanMembers', 'AddReactions'] },
          { key: 'auto', name: 'Auto', permissions: ['ManageMessages'] },
        ],
        features: { welcome: { enabled: true, autoroles: ['auto'] } },
      }),
      makeSnapshot(),
    );
    expect(r.plan.roles[0]!.permissions).toEqual(['AddReactions']);
    expect(r.plan.roles[1]!.permissions).toEqual([]);
    expect(codes(r).filter((c) => c === 'self_assign_dangerous_stripped')).toHaveLength(2);
  });

  it('removes permissions the bot does not hold itself', () => {
    const r = validatePlan(plan({ roles: [{ key: 'hooks', name: 'Hooks', permissions: ['ManageWebhooks'] }] }), makeSnapshot());
    expect(r.plan.roles[0]!.permissions).toEqual([]);
    expect(codes(r)).toContain('bot_lacks_permission');
  });

  it('downgrades community-only channel types on non-community servers', () => {
    const input = plan({
      channels: [
        { key: 'news', name: 'News', type: 'announcement' },
        { key: 'stage', name: 'Stage', type: 'stage' },
        { key: 'forum', name: 'Forum', type: 'forum' },
      ],
    });
    const r = validatePlan(input, makeSnapshot());
    expect(r.plan.channels.map((c) => c.type)).toEqual(['text', 'voice', 'text']);
    expect(r.downgrades).toHaveLength(3);

    const community = validatePlan(input, makeSnapshot({ features: ['COMMUNITY'] }));
    expect(community.plan.channels.map((c) => c.type)).toEqual(['announcement', 'stage', 'forum']);
    expect(community.downgrades).toHaveLength(0);
  });

  it('normalises text channel names the way Discord would', () => {
    expect(normalizeTextChannelName('  Recipes & Tips!! ')).toBe('recipes-tips');
    expect(normalizeTextChannelName('🍳 Kitchen Talk')).toBe('🍳-kitchen-talk');
    const r = validatePlan(plan({ channels: [{ key: 'a', name: 'Food Photos' }, { key: 'b', name: 'Big Room', type: 'voice' }] }), makeSnapshot());
    expect(r.plan.channels[0]!.name).toBe('food-photos');
    expect(r.plan.channels[1]!.name).toBe('Big Room');
  });

  it('resolves role references by key, name and existing role, dropping unknown ones', () => {
    const snapshot = makeSnapshot();
    snapshot.roles.push({ id: '600000000000000001', name: 'Veterans', color: 0, hoist: false, mentionable: false, position: 2, permissions: '0', managed: false });
    const r = validatePlan(
      plan({
        roles: [{ key: 'mod', name: 'Moderator' }],
        channels: [{ key: 'staff', name: 'staff', visibility: 'private', accessRoles: ['mod', 'Moderator', 'veterans', 'ghosts'] }],
      }),
      snapshot,
    );
    expect(r.plan.channels[0]!.accessRoles).toEqual(['role:mod', 'existing:600000000000000001']);
    expect(codes(r)).toContain('unknown_role_ref');
  });

  it('removes dangerous @everyone overwrites even when the AI asks for them', () => {
    const r = validatePlan(
      plan({ channels: [{ key: 'x', name: 'x', overwrites: [{ target: '@everyone', allow: ['MentionEveryone', 'SendMessages'], deny: [] }] }] }),
      makeSnapshot(),
    );
    expect(r.plan.channels[0]!.overwrites).toEqual([{ target: 'everyone', allow: ['SendMessages'], deny: [] }]);
    expect(codes(r)).toContain('everyone_dangerous_stripped');
  });

  it('drops messages and panels that point at missing or wrong-type channels', () => {
    const r = validatePlan(
      plan({
        roles: [{ key: 'r', name: 'R', selfAssignable: true }],
        channels: [{ key: 'vc', name: 'VC', type: 'voice' }],
        rules: { channel: 'vc', content: 'rules' },
        welcomeMessage: { channel: 'nowhere', content: 'hi' },
        selfRolePanels: [{ channel: 'vc', title: 'Roles', roles: [{ role: 'r' }] }],
      }),
      makeSnapshot(),
    );
    expect(r.plan.rules).toBeUndefined();
    expect(r.plan.welcomeMessage).toBeUndefined();
    expect(r.plan.selfRolePanels).toEqual([]);
  });

  it('warns when a staff-looking channel is public', () => {
    const r = validatePlan(plan({ channels: [{ key: 'ml', name: 'mod-log' }] }), makeSnapshot());
    expect(codes(r)).toContain('staff_channel_public');
  });

  it('renames duplicate keys instead of silently merging them', () => {
    const r = validatePlan(plan({ channels: [{ key: 'chat', name: 'a' }, { key: 'chat', name: 'b' }] }), makeSnapshot());
    expect(r.plan.channels.map((c) => c.key)).toEqual(['chat', 'chat-2']);
  });

  it('blocks the plan when the bot cannot manage channels or roles', () => {
    const snapshot = makeSnapshot();
    snapshot.bot.permissions = (PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages).toString();
    const r = validatePlan(plan({ roles: [{ key: 'a', name: 'A' }], channels: [{ key: 'b', name: 'b' }] }), snapshot);
    expect(r.blocking).toBe(true);
    expect(codes(r)).toEqual(expect.arrayContaining(['bot_missing_manage_channels', 'bot_missing_manage_roles']));
  });

  it('blocks plans that exceed Discord channel limits', () => {
    const snapshot = makeSnapshot();
    for (let i = 0; i < 495; i++) {
      snapshot.channels.push({ id: `7${String(i).padStart(17, '0')}`, name: `c${i}`, type: 0, parentId: null, position: i, overwrites: [] });
    }
    const r = validatePlan(plan({ channels: Array.from({ length: 10 }, (_, i) => ({ key: `n${i}`, name: `new-${i}` })) }), snapshot);
    expect(codes(r)).toContain('too_many_channels');
    expect(r.blocking).toBe(true);
  });
});
