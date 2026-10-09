import { describe, expect, it } from 'vitest';
import { PermissionFlagsBits } from 'discord-api-types/v10';
import { signConfirmation, verifyConfirmation } from '../src/confirmation';
import { decryptSecret, encryptSecret } from '../src/crypto';
import { can, resolveAccess, validateDelegations, type AccessContext } from '../src/authz';

const SECRET = 'x'.repeat(48);
const base = {
  guildId: 'g1',
  planId: 'p1',
  planHash: 'ph',
  snapshotHash: 'sh',
  userId: 'u1',
};

describe('confirmation tokens', () => {
  const expected = { ...base, needsDestructive: false, needsElevation: false };

  it('accepts a fresh, matching token', () => {
    const { token } = signConfirmation({ ...base, allowDestructive: false, allowElevation: false }, SECRET);
    expect(verifyConfirmation(token, expected, SECRET).ok).toBe(true);
  });

  it('rejects expired tokens', () => {
    const now = Date.now();
    const { token } = signConfirmation({ ...base, allowDestructive: false, allowElevation: false }, SECRET, now);
    expect(verifyConfirmation(token, expected, SECRET, now + 11 * 60 * 1000)).toMatchObject({ ok: false, reason: 'expired' });
  });

  it('rejects tokens once the server or plan changed', () => {
    const { token } = signConfirmation({ ...base, allowDestructive: false, allowElevation: false }, SECRET);
    expect(verifyConfirmation(token, { ...expected, snapshotHash: 'other' }, SECRET)).toMatchObject({ ok: false, reason: 'mismatch' });
    expect(verifyConfirmation(token, { ...expected, planHash: 'other' }, SECRET)).toMatchObject({ ok: false, reason: 'mismatch' });
    expect(verifyConfirmation(token, { ...expected, userId: 'someone-else' }, SECRET)).toMatchObject({ ok: false });
  });

  it('rejects tampered or foreign-key tokens', () => {
    const { token } = signConfirmation({ ...base, allowDestructive: false, allowElevation: false }, SECRET);
    const [body, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body!, 'base64url').toString()), allowDestructive: true })).toString('base64url');
    expect(verifyConfirmation(`${forged}.${sig}`, expected, SECRET)).toMatchObject({ ok: false, reason: 'bad_signature' });
    expect(verifyConfirmation(token, expected, 'y'.repeat(48))).toMatchObject({ ok: false, reason: 'bad_signature' });
  });

  it('requires explicit destructive / elevation acknowledgement', () => {
    const { token } = signConfirmation({ ...base, allowDestructive: false, allowElevation: false }, SECRET);
    expect(verifyConfirmation(token, { ...expected, needsDestructive: true }, SECRET).ok).toBe(false);
    expect(verifyConfirmation(token, { ...expected, needsElevation: true }, SECRET).ok).toBe(false);
    const both = signConfirmation({ ...base, allowDestructive: true, allowElevation: true }, SECRET).token;
    expect(verifyConfirmation(both, { ...expected, needsDestructive: true, needsElevation: true }, SECRET).ok).toBe(true);
  });
});

describe('secret encryption', () => {
  it('round-trips and detects tampering', () => {
    const enc = encryptSecret('twitch-secret', SECRET);
    expect(enc).not.toContain('twitch-secret');
    expect(decryptSecret(enc, SECRET)).toBe('twitch-secret');
    const parts = enc.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => decryptSecret(parts.join('.'), SECRET)).toThrow();
    expect(() => decryptSecret(enc, 'z'.repeat(48))).toThrow();
  });
});

describe('authorization', () => {
  const roles = [
    { id: 'g', permissions: PermissionFlagsBits.ViewChannel.toString() },
    { id: 'admin', permissions: PermissionFlagsBits.ManageGuild.toString() },
    { id: 'fulladmin', permissions: (PermissionFlagsBits.ManageGuild | PermissionFlagsBits.ManageRoles | PermissionFlagsBits.ManageChannels).toString() },
    { id: 'helper', permissions: '0' },
  ];
  const ctx = (userId: string, memberRoleIds: string[]): AccessContext => ({
    userId,
    guildOwnerId: 'owner',
    guildId: 'g',
    memberRoleIds,
    guildRoles: roles,
    delegations: [{ roleId: 'helper', scopes: ['welcome', 'levels'] }],
  });

  it('gives owners everything including wipe', () => {
    const a = resolveAccess(ctx('owner', []));
    expect(a.tier).toBe('owner');
    expect(can(a, { type: 'builder.wipe' })).toBe(true);
  });

  it('lets Manage Server admins configure but not wipe', () => {
    const a = resolveAccess(ctx('u', ['admin']));
    expect(a.tier).toBe('admin');
    expect(can(a, { type: 'configure', feature: 'moderation' })).toBe(true);
    expect(can(a, { type: 'builder.wipe' })).toBe(false);
    // destructive apply needs Manage Roles + Manage Channels too
    expect(can(a, { type: 'builder.apply', destructive: true, elevation: false })).toBe(false);
    expect(can(resolveAccess(ctx('u', ['fulladmin'])), { type: 'builder.apply', destructive: true, elevation: false })).toBe(true);
  });

  it('limits delegates to their scopes and never lets them manage delegation', () => {
    const a = resolveAccess(ctx('u', ['helper']));
    expect(a.tier).toBe('delegate');
    expect(can(a, { type: 'configure', feature: 'welcome' })).toBe(true);
    expect(can(a, { type: 'configure', feature: 'moderation' })).toBe(false);
    expect(can(a, { type: 'delegation.manage' })).toBe(false);
    expect(can(a, { type: 'builder.apply', destructive: false, elevation: true })).toBe(false);
  });

  it('denies members with no access', () => {
    const a = resolveAccess(ctx('u', []));
    expect(a.tier).toBe('none');
    expect(can(a, { type: 'view' })).toBe(false);
  });

  it('rejects delegation to @everyone and managed roles', () => {
    const guild = { guildId: 'g', roles: [{ id: 'g', managed: false }, { id: 'botrole', managed: true }, { id: 'r', managed: false }] };
    expect(validateDelegations([{ roleId: 'g', scopes: ['welcome'] }], guild).ok).toBe(false);
    expect(validateDelegations([{ roleId: 'botrole', scopes: ['welcome'] }], guild).ok).toBe(false);
    const ok = validateDelegations([{ roleId: 'r', scopes: ['welcome', 'not-a-scope' as never] }], guild);
    expect(ok).toEqual({ ok: true, delegations: [{ roleId: 'r', scopes: ['welcome'] }] });
  });
});
