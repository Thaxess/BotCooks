import { describe, expect, it } from 'vitest';
import { PermissionFlagsBits } from 'discord-api-types/v10';
import { validateSettingsRefs, type GuildRefContext } from '../src/settings-refs';

const guild: GuildRefContext = {
  guildId: '100000000000000001',
  botTopPosition: 10,
  channels: [{ id: '200000000000000001', type: 0 }],
  roles: [
    { id: '100000000000000001', name: '@everyone', position: 0, managed: false, permissions: '0' },
    { id: '300000000000000001', name: 'Member', position: 2, managed: false, permissions: '0' },
    { id: '300000000000000002', name: 'Mod', position: 5, managed: false, permissions: PermissionFlagsBits.BanMembers.toString() },
    { id: '300000000000000003', name: 'Owner', position: 20, managed: false, permissions: '0' },
  ],
};

describe('validateSettingsRefs', () => {
  it('rejects channels and roles from other servers', () => {
    expect(validateSettingsRefs('logging', { modLogChannelId: '999999999999999999' }, guild)).toHaveLength(1);
    expect(validateSettingsRefs('tickets', { staffRoleIds: ['999999999999999999'] }, guild)).toHaveLength(1);
    expect(validateSettingsRefs('logging', { modLogChannelId: '200000000000000001' }, guild)).toEqual([]);
  });

  it('only allows safe roles to be auto-assigned', () => {
    expect(validateSettingsRefs('autoroles', { roleIds: ['300000000000000001'] }, guild)).toEqual([]);
    expect(validateSettingsRefs('autoroles', { roleIds: ['300000000000000002'] }, guild)[0]).toMatch(/powerful/);
    expect(validateSettingsRefs('autoroles', { roleIds: ['300000000000000003'] }, guild)[0]).toMatch(/above/);
    expect(validateSettingsRefs('levels', { rewards: [{ level: 5, roleId: '100000000000000001' }] }, guild)[0]).toMatch(/everyone/);
    // Staff roles are referenced, not assigned, so powerful roles are fine there.
    expect(validateSettingsRefs('tickets', { staffRoleIds: ['300000000000000002'] }, guild)).toEqual([]);
  });
});
