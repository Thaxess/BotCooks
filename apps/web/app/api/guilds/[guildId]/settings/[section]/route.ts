import { z } from 'zod';
import { recordAudit, updateSettingsSection } from '@botcooks/database';
import { validateSettingsRefs } from '@botcooks/services';
import { ForbiddenError, SECTION_FEATURE, SETTINGS_SECTIONS, UserFacingError, type SettingsSection } from '@botcooks/shared';
import { guildRoute, json, readJson } from '@/lib/server/api';
import { server } from '@/lib/server/context';
import { guildResources } from '@/lib/server/guild';

const bodySchema = z.object({ value: z.unknown(), version: z.number().int().min(0) });

function sectionOf(params: Record<string, string>): SettingsSection {
  const s = params.section ?? '';
  if (!Object.hasOwn(SETTINGS_SECTIONS, s)) throw new UserFacingError('Unknown settings section.', 'not_found', 404);
  return s as SettingsSection;
}

export const PUT = guildRoute(
  (_req, params) => {
    const section = sectionOf(params);
    // Builder safety settings (e.g. allowing replace mode) are never delegable.
    return section === 'builder' ? { type: 'admin.settings' } : { type: 'configure', feature: SECTION_FEATURE[section] };
  },
  async ({ guildId, user, req, ownerId }, params) => {
    const section = sectionOf(params);
    const body = await readJson(req, bodySchema);
    const parsed = SETTINGS_SECTIONS[section].safeParse(body.value);
    if (!parsed.success) {
      return json({ error: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), code: 'validation' }, 400);
    }
    if (section === 'builder' && user.id !== ownerId) throw new ForbiddenError('Only the server owner can change builder safety settings.');
    const resources = await guildResources(guildId);
    const refErrors = validateSettingsRefs(section, parsed.data, {
      guildId,
      botTopPosition: resources.botTopPosition,
      channels: resources.channels,
      roles: resources.roles,
    });
    if (refErrors.length) return json({ error: refErrors.slice(0, 5).join(' '), code: 'invalid_reference' }, 400);

    const result = await updateSettingsSection(server().db, guildId, section, parsed.data, body.version, user.id);
    await recordAudit(server().db, {
      guildId,
      actorId: user.id,
      actorType: 'user',
      action: `settings.${section}`,
      details: { before: result.before, after: parsed.data },
    });
    return json({ settings: result.settings, version: result.version });
  },
);
