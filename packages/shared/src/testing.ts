import { PermissionFlagsBits } from 'discord-api-types/v10';
import type { GuildSnapshot } from './snapshot';

/** Test fixtures shared by package test suites. Not used at runtime. */
export const TEST_GUILD_ID = '100000000000000001';
export const TEST_BOT_ID = '200000000000000002';
export const TEST_OWNER_ID = '300000000000000003';

const botPerms =
  PermissionFlagsBits.ManageChannels |
  PermissionFlagsBits.ManageRoles |
  PermissionFlagsBits.ViewChannel |
  PermissionFlagsBits.SendMessages |
  PermissionFlagsBits.EmbedLinks |
  PermissionFlagsBits.ReadMessageHistory |
  PermissionFlagsBits.ModerateMembers |
  PermissionFlagsBits.ManageMessages |
  PermissionFlagsBits.KickMembers |
  PermissionFlagsBits.BanMembers |
  PermissionFlagsBits.ManageThreads |
  PermissionFlagsBits.ViewAuditLog |
  PermissionFlagsBits.MuteMembers |
  PermissionFlagsBits.MoveMembers |
  PermissionFlagsBits.Connect |
  PermissionFlagsBits.Speak |
  PermissionFlagsBits.AddReactions |
  PermissionFlagsBits.AttachFiles |
  PermissionFlagsBits.CreatePrivateThreads;

export function makeSnapshot(overrides: Partial<GuildSnapshot> = {}): GuildSnapshot {
  return {
    guildId: TEST_GUILD_ID,
    name: 'Test Kitchen',
    ownerId: TEST_OWNER_ID,
    features: [],
    roles: [
      {
        id: TEST_GUILD_ID,
        name: '@everyone',
        color: 0,
        hoist: false,
        mentionable: false,
        position: 0,
        permissions: (PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages).toString(),
        managed: false,
      },
      {
        id: '400000000000000010',
        name: 'BotCooks',
        color: 0,
        hoist: false,
        mentionable: false,
        position: 5,
        permissions: botPerms.toString(),
        managed: true,
      },
    ],
    channels: [
      {
        id: '500000000000000020',
        name: 'Text Channels',
        type: 4,
        parentId: null,
        position: 0,
        overwrites: [],
      },
      {
        id: '500000000000000021',
        name: 'general',
        type: 0,
        parentId: '500000000000000020',
        position: 0,
        topic: null,
        nsfw: false,
        rateLimitPerUser: 0,
        overwrites: [],
      },
    ],
    protectedChannelIds: [],
    bot: { userId: TEST_BOT_ID, highestRolePosition: 5, permissions: botPerms.toString() },
    capturedAt: '2026-10-08T00:00:00.000Z',
    ...overrides,
  };
}
