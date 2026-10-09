import { z } from 'zod';
import { getSettings, recordAudit, saveSettings } from '@botcooks/database';
import { can } from '@botcooks/security';
import { FEATURE_KEYS, ForbiddenError, getFeature, type FeatureKey } from '@botcooks/shared';
import { guildRoute, json, readJson } from '@/lib/server/api';
import { server } from '@/lib/server/context';

const bodySchema = z.object({
  feature: z.enum(FEATURE_KEYS as [FeatureKey, ...FeatureKey[]]),
  enabled: z.boolean(),
  version: z.number().int().min(0),
});

export const PUT = guildRoute({ type: 'view' }, async ({ guildId, user, req, access }) => {
  const body = await readJson(req, bodySchema);
  // Per-feature check: delegates can only toggle features they were given.
  if (!can(access, { type: 'configure', feature: body.feature })) throw new ForbiddenError();
  const feature = getFeature(body.feature);
  if (body.enabled && feature.status === 'blocked') return json({ error: `${feature.label} is not available yet.`, code: 'blocked' }, 400);
  const { settings, version } = await getSettings(server().db, guildId);
  if (version !== body.version) return json({ error: 'Settings changed in another tab. Reload and try again.', code: 'stale_settings' }, 409);
  const next = { ...settings, features: { ...settings.features, [body.feature]: body.enabled } };
  const newVersion = await saveSettings(server().db, guildId, next, version, user.id);
  await recordAudit(server().db, {
    guildId,
    actorId: user.id,
    actorType: 'user',
    action: `feature.${body.enabled ? 'enabled' : 'disabled'}`,
    target: body.feature,
  });
  return json({ settings: next, version: newVersion });
});
