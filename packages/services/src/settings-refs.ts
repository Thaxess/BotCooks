import { DANGEROUS_PERMISSIONS, bitfieldToPermissions, type SettingsSection } from '@botcooks/shared';

export interface GuildRefContext {
  guildId: string;
  channels: Array<{ id: string; type: number }>;
  roles: Array<{ id: string; position: number; managed: boolean; permissions: string; name: string }>;
  botTopPosition: number;
}

/** Settings paths whose roles get ASSIGNED to members, so they must be safe to hand out. */
const ASSIGNED_ROLE_PATHS = [/^autoroles\.roleIds\.\d+$/, /^autoroles\.botRoleIds\.\d+$/, /^levels\.rewards\.\d+\.roleId$/, /^antiraid\.verification\.verifiedRoleId$/];

/**
 * Every Discord ID in a settings section must belong to THIS guild. Without this check a user
 * could point, say, a log channel at a channel in another server the bot is in.
 */
export function validateSettingsRefs(section: SettingsSection, value: unknown, guild: GuildRefContext): string[] {
  const errors: string[] = [];
  const channels = new Map(guild.channels.map((c) => [c.id, c]));
  const roles = new Map(guild.roles.map((r) => [r.id, r]));

  const visit = (node: unknown, path: string, key: string) => {
    if (Array.isArray(node)) return node.forEach((v, i) => visit(v, `${path}.${i}`, key));
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) visit(v, path ? `${path}.${k}` : k, k);
      return;
    }
    if (typeof node !== 'string') return;
    const full = `${section}.${path}`;
    if (/channelids?$/i.test(key)) {
      if (!channels.has(node)) errors.push(`${full}: channel ${node} is not in this server.`);
    } else if (/roleids?$/i.test(key)) {
      const role = roles.get(node);
      if (!role) {
        errors.push(`${full}: role ${node} is not in this server.`);
        return;
      }
      if (ASSIGNED_ROLE_PATHS.some((re) => re.test(full))) {
        if (role.id === guild.guildId) errors.push(`${full}: @everyone cannot be assigned.`);
        else if (role.managed) errors.push(`${full}: "${role.name}" is managed by an integration and cannot be assigned.`);
        else if (role.position >= guild.botTopPosition) errors.push(`${full}: "${role.name}" is above BotCooks' highest role, so it cannot be assigned.`);
        else {
          const dangerous = bitfieldToPermissions(role.permissions).filter((p) => DANGEROUS_PERMISSIONS.has(p));
          if (dangerous.length) errors.push(`${full}: "${role.name}" has powerful permissions (${dangerous.join(', ')}) and cannot be handed out automatically.`);
        }
      }
    }
  };
  visit(value, '', '');
  return errors;
}
