import 'server-only';
import { getSettings } from '@botcooks/database';
import type { Action } from '@botcooks/security';
import { getFeature, hasPermission, isPermissionName, type FeatureKey } from '@botcooks/shared';
import { server } from './context';
import { guildResources, requirePageAccess } from './guild';

/** Everything a settings page needs, after the access check. */
export async function loadSettingsPage(guildId: string, action: Action) {
  const access = await requirePageAccess(guildId, action);
  const [{ settings, version }, resources] = await Promise.all([getSettings(server().db, guildId), guildResources(guildId)]);
  return {
    ...access,
    settings,
    version,
    resources,
    channels: resources.channels,
    roles: resources.roles.filter((r) => r.id !== guildId).map((r) => ({ id: r.id, name: r.name, color: r.color, managed: r.managed })),
  };
}

/**
 * Prerequisites for a feature, as far as the dashboard can tell. Bot permissions are checked
 * live; privileged intents can only be verified by the bot (`/botcooks` shows them), so they are
 * shown as informational.
 */
export function featureRequirements(feature: FeatureKey, botPermissions: string) {
  return getFeature(feature).requires.map((r) => {
    if (r.kind === 'botPermission') {
      return { ok: isPermissionName(r.key) ? hasPermission(botPermissions, r.key) : null, label: `Bot permission: ${r.label}` };
    }
    if (r.kind === 'intent') return { ok: null, label: `${r.label}${r.privileged ? ' (privileged: enable in the Developer Portal and BOT_INTENT_* env)' : ''}` };
    if (r.kind === 'credential') {
      // The AI provider is used by this process; other credentials live in the worker's environment.
      if (r.key === 'AI_API_KEY') return { ok: Boolean(server().provider), label: r.label };
      return { ok: process.env[r.key] ? true : null, label: `${r.label} (worker environment)` };
    }
    return { ok: null, label: r.label };
  });
}
