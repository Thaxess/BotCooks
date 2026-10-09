import type { GuildSettings } from '@botcooks/shared';
import type { PlanConfigPayload } from '@botcooks/workflows';

/**
 * Merges plan feature configuration into existing settings. Plans only ever ENABLE features and
 * fill in channels/roles; they never switch off something the server already uses.
 */
export function mergePlanConfig(
  current: GuildSettings,
  config: PlanConfigPayload,
  resolve: (ref: string | undefined) => string | undefined,
): GuildSettings {
  const s = structuredClone(current);
  const m = config.moderation;
  const ids = (refs: string[]) => refs.map((r) => resolve(r)).filter((x): x is string => Boolean(x));

  const modLog = resolve(m.modLogChannel);
  const memberLog = resolve(m.memberLogChannel);
  const serverLog = resolve(m.serverLogChannel);

  if (m.spamFilter || m.blockInvites || m.blockLinks || m.blockedTerms.length > 0) {
    s.features.automod = true;
    s.automod.spam.enabled = m.spamFilter;
    s.automod.blockInvites = m.blockInvites;
    s.automod.blockLinks = m.blockLinks;
    s.automod.maxMentionsPerMessage = m.maxMentionsPerMessage;
    s.automod.blockedTerms = [...new Set([...s.automod.blockedTerms, ...m.blockedTerms.map((t) => t.toLowerCase())])].slice(0, 500);
    if (modLog) s.automod.alertChannelId = modLog;
  }
  if (m.antiRaid) {
    s.features.antiraid = true;
    if (modLog) s.antiraid.alertChannelId = modLog;
  }
  if (modLog) {
    s.moderation.modLogChannelId = modLog;
    s.logging.modLogChannelId = modLog;
  }
  if (memberLog) s.logging.memberLogChannelId = memberLog;
  if (serverLog) s.logging.serverLogChannelId = serverLog;
  if (modLog || memberLog || serverLog) s.features.logging = true;

  const lv = config.levels;
  if (lv.enabled) {
    s.features.levels = true;
    const announce = resolve(lv.announceChannel);
    if (announce) {
      s.levels.announce = 'channel';
      s.levels.announceChannelId = announce;
    }
    const rewards = lv.rewards
      .map((r) => ({ level: r.level, roleId: resolve(r.role) }))
      .filter((r): r is { level: number; roleId: string } => Boolean(r.roleId));
    const existing = new Set(s.levels.rewards.map((r) => `${r.level}:${r.roleId}`));
    s.levels.rewards = [...s.levels.rewards, ...rewards.filter((r) => !existing.has(`${r.level}:${r.roleId}`))].slice(0, 50);
  }

  const tk = config.tickets;
  if (tk.enabled) {
    s.features.tickets = true;
    const panel = resolve(tk.panelChannel);
    if (panel) s.tickets.panelChannelId = panel;
    const staff = resolve(tk.staffRole);
    if (staff && !s.tickets.staffRoleIds.includes(staff)) s.tickets.staffRoleIds = [...s.tickets.staffRoleIds, staff];
    if (modLog && !s.tickets.logChannelId) s.tickets.logChannelId = modLog;
  }

  const tv = config.tempVoice;
  if (tv.enabled) {
    const hub = resolve(tv.hubChannel);
    if (hub) {
      s.features.tempVoice = true;
      s.tempVoice.hubChannelId = hub;
    }
  }

  const w = config.welcome;
  if (w.enabled) {
    s.features.welcome = true;
    const ch = resolve(w.channel);
    if (ch) s.welcome.channelId = ch;
    if (w.message) s.welcome.message = w.message;
  }
  const autoroles = ids(w.autoroles);
  if (autoroles.length) {
    s.features.autoroles = true;
    s.autoroles.roleIds = [...new Set([...s.autoroles.roleIds, ...autoroles])].slice(0, 50);
  }

  if (config.streamAlerts.length) s.features.streamAlerts = true;
  if (config.suggestedCommands.length) s.features.customCommands = true;
  return s;
}
