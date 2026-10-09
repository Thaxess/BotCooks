import type { Action } from '@botcooks/security';

export interface NavItem {
  href: string;
  label: string;
  emoji: string;
  /** Hidden from navigation when the user cannot perform this. The API re-checks regardless. */
  action: Action;
}

export const NAV_GROUPS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: 'Kitchen',
    items: [
      { href: '', label: 'Overview', emoji: '🏠', action: { type: 'view' } },
      { href: '/builder', label: 'AI server builder', emoji: '🍳', action: { type: 'builder.generate' } },
      { href: '/config', label: 'Features', emoji: '🧂', action: { type: 'view' } },
    ],
  },
  {
    title: 'Safety',
    items: [
      { href: '/moderation', label: 'Moderation & cases', emoji: '🛡️', action: { type: 'configure', feature: 'moderation' } },
      { href: '/security', label: 'Auto-mod & anti-raid', emoji: '🚨', action: { type: 'configure', feature: 'automod' } },
      { href: '/audit', label: 'Audit log', emoji: '📜', action: { type: 'audit.view' } },
    ],
  },
  {
    title: 'Community',
    items: [
      { href: '/roles', label: 'Roles & onboarding', emoji: '🎭', action: { type: 'configure', feature: 'selfroles' } },
      { href: '/welcome', label: 'Welcome & goodbye', emoji: '👋', action: { type: 'configure', feature: 'welcome' } },
      { href: '/levels', label: 'Levels & rewards', emoji: '⭐', action: { type: 'configure', feature: 'levels' } },
      { href: '/tickets', label: 'Tickets', emoji: '🎫', action: { type: 'configure', feature: 'tickets' } },
      { href: '/giveaways', label: 'Giveaways & polls', emoji: '🎉', action: { type: 'configure', feature: 'giveaways' } },
      { href: '/scheduled', label: 'Scheduled messages', emoji: '⏰', action: { type: 'configure', feature: 'scheduled' } },
    ],
  },
  {
    title: 'Automation',
    items: [
      { href: '/commands', label: 'Command builder', emoji: '🧩', action: { type: 'configure', feature: 'customCommands' } },
      { href: '/events', label: 'Event builder', emoji: '⚡', action: { type: 'configure', feature: 'events' } },
      { href: '/integrations', label: 'Twitch, YouTube & Kick', emoji: '📺', action: { type: 'configure', feature: 'streamAlerts' } },
      { href: '/voice', label: 'Music & voice', emoji: '🎧', action: { type: 'configure', feature: 'tempVoice' } },
    ],
  },
  {
    title: 'Insights & admin',
    items: [
      { href: '/analytics', label: 'Analytics', emoji: '📈', action: { type: 'configure', feature: 'analytics' } },
      { href: '/backups', label: 'Backups & templates', emoji: '🧊', action: { type: 'backups.restore' } },
      { href: '/admin', label: 'Administrator settings', emoji: '🔑', action: { type: 'admin.settings' } },
    ],
  },
];
