import { z } from 'zod';
import { listDelegations, recordAudit, replaceDelegations } from '@botcooks/database';
import { invalidateAccess } from '@botcooks/services';
import { DELEGABLE_SCOPES, validateDelegations, type DelegableScope } from '@botcooks/security';
import { guildRoute, json, readJson } from '@/lib/server/api';
import { server } from '@/lib/server/context';
import { guildResources } from '@/lib/server/guild';

const bodySchema = z.object({
  delegations: z
    .array(z.object({ roleId: z.string().regex(/^\d{17,20}$/), scopes: z.array(z.enum(DELEGABLE_SCOPES as [DelegableScope, ...DelegableScope[]])).max(DELEGABLE_SCOPES.length) }))
    .max(25),
});

export const GET = guildRoute({ type: 'delegation.manage' }, async ({ guildId }) => json({ delegations: await listDelegations(server().db, guildId) }));

/** Only owners and Manage Server admins reach this (delegates can never manage delegation). */
export const PUT = guildRoute({ type: 'delegation.manage' }, async ({ guildId, user, req }) => {
  const body = await readJson(req, bodySchema);
  const r = await guildResources(guildId);
  const result = validateDelegations(body.delegations, { guildId, roles: r.roles });
  if (!result.ok) return json({ error: result.error }, 400);
  const before = await listDelegations(server().db, guildId);
  await replaceDelegations(server().db, guildId, result.delegations, user.id);
  invalidateAccess(guildId);
  await recordAudit(server().db, {
    guildId,
    actorId: user.id,
    actorType: 'user',
    action: 'admin.delegations',
    details: { before: before.map((d) => ({ roleId: d.roleId, scopes: d.scopes })), after: result.delegations },
  });
  return json({ delegations: result.delegations });
});
