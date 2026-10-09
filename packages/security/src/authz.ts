import { FEATURE_KEYS, hasPermission, type FeatureKey } from '@botcooks/shared';

/**
 * Dashboard / command authorization.
 *
 * Every request is authorised server-side from FRESH Discord data (member roles + guild roles),
 * never from anything the browser sends. Access tiers:
 *   owner     - the guild owner
 *   admin     - has Administrator or Manage Server
 *   delegate  - holds a role the owner/admins delegated specific scopes to
 *
 * Delegates can never manage delegation, so they cannot grant themselves more access.
 */

export type DelegableScope = FeatureKey | 'audit' | 'backups' | 'builder.apply';

/** Scopes that can be delegated to trusted roles. */
export const DELEGABLE_SCOPES: readonly DelegableScope[] = [...FEATURE_KEYS, 'audit', 'backups', 'builder.apply'];

export type Action =
  | { type: 'view' }
  | { type: 'configure'; feature: FeatureKey }
  | { type: 'builder.generate' }
  | { type: 'builder.apply'; destructive: boolean; elevation: boolean }
  | { type: 'builder.wipe' }
  | { type: 'backups.restore' }
  | { type: 'audit.view' }
  | { type: 'delegation.manage' }
  | { type: 'admin.settings' };

export interface Delegation {
  roleId: string;
  scopes: DelegableScope[];
}

export interface AccessContext {
  userId: string;
  guildOwnerId: string;
  /** Roles the member holds, excluding @everyone. */
  memberRoleIds: string[];
  /** All guild roles with their permission bitfields (decimal strings). */
  guildRoles: Array<{ id: string; permissions: string }>;
  /** @everyone role id == guild id. */
  guildId: string;
  delegations: Delegation[];
}

export type AccessTier = 'owner' | 'admin' | 'delegate' | 'none';

export interface Access {
  tier: AccessTier;
  permissions: bigint;
  scopes: Set<DelegableScope>;
}

export function computeBasePermissions(ctx: Pick<AccessContext, 'guildRoles' | 'memberRoleIds' | 'guildId'>): bigint {
  let bits = 0n;
  const held = new Set([ctx.guildId, ...ctx.memberRoleIds]);
  for (const role of ctx.guildRoles) if (held.has(role.id)) bits |= BigInt(role.permissions);
  return bits;
}

export function resolveAccess(ctx: AccessContext): Access {
  const permissions = computeBasePermissions(ctx);
  if (ctx.userId === ctx.guildOwnerId) return { tier: 'owner', permissions, scopes: new Set(DELEGABLE_SCOPES) };
  if (hasPermission(permissions, 'ManageGuild')) return { tier: 'admin', permissions, scopes: new Set(DELEGABLE_SCOPES) };
  const held = new Set(ctx.memberRoleIds);
  const scopes = new Set<DelegableScope>();
  for (const d of ctx.delegations) {
    if (!held.has(d.roleId)) continue;
    for (const s of d.scopes) if ((DELEGABLE_SCOPES as readonly string[]).includes(s)) scopes.add(s);
  }
  return { tier: scopes.size > 0 ? 'delegate' : 'none', permissions, scopes };
}

export function can(access: Access, action: Action): boolean {
  const { tier, scopes, permissions } = access;
  if (tier === 'none') return false;
  switch (action.type) {
    case 'view':
      return true;
    case 'configure':
      return tier !== 'delegate' || scopes.has(action.feature);
    case 'builder.generate':
      return tier !== 'delegate' || scopes.has('builder');
    case 'builder.apply': {
      // Deletions and elevation always need real server-management rights, never just delegation.
      if (action.destructive || action.elevation) {
        return (
          tier === 'owner' ||
          (tier === 'admin' && hasPermission(permissions, 'ManageRoles') && hasPermission(permissions, 'ManageChannels'))
        );
      }
      return tier !== 'delegate' || scopes.has('builder.apply');
    }
    case 'builder.wipe':
      return tier === 'owner';
    case 'backups.restore':
      return tier === 'owner' || tier === 'admin' || scopes.has('backups');
    case 'audit.view':
      return tier !== 'delegate' || scopes.has('audit');
    case 'delegation.manage':
    case 'admin.settings':
      return tier === 'owner' || tier === 'admin';
  }
}

/**
 * Validates a proposed delegation change (callers must already have checked `delegation.manage`).
 * Only allow-listed scopes are kept, and access is never delegated to @everyone or managed roles.
 */
export function validateDelegations(
  input: Delegation[],
  guild: { guildId: string; roles: Array<{ id: string; managed: boolean }> },
): { ok: true; delegations: Delegation[] } | { ok: false; error: string } {
  const out: Delegation[] = [];
  const seen = new Set<string>();
  for (const d of input) {
    if (d.roleId === guild.guildId) return { ok: false, error: 'Access cannot be delegated to @everyone.' };
    const role = guild.roles.find((r) => r.id === d.roleId);
    if (!role) return { ok: false, error: `Role ${d.roleId} does not exist.` };
    if (role.managed) return { ok: false, error: 'Access cannot be delegated to bot/integration roles.' };
    if (seen.has(d.roleId)) return { ok: false, error: 'Each role may appear only once.' };
    seen.add(d.roleId);
    const scopes = [...new Set(d.scopes)].filter((s) => (DELEGABLE_SCOPES as readonly string[]).includes(s));
    if (scopes.length > 0) out.push({ roleId: d.roleId, scopes });
  }
  return { ok: true, delegations: out };
}
