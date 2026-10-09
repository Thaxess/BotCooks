import type { ChangeSet } from '@botcooks/workflows';

/** Brand colour (warm orange) used across embeds. */
export const BRAND_COLOR = 0xf97316;
export const DANGER_COLOR = 0xef4444;
export const OK_COLOR = 0x22c55e;

/** Custom ID prefixes. Every handler re-validates the user; IDs carry no authority on their own. */
export const CID = {
  planReview: 'bc:plan:review',
  planRevise: 'bc:plan:revise',
  planConfirm: 'bc:plan:confirm',
  planElevate: 'bc:plan:elevate',
  planCancel: 'bc:plan:cancel',
  planStatus: 'bc:plan:status',
  selfRole: 'bc:sr',
  ticketOpen: 'bc:ticket:open',
  ticketClose: 'bc:ticket:close',
  ticketClaim: 'bc:ticket:claim',
  giveawayEnter: 'bc:gw',
  verify: 'bc:verify',
  appeal: 'bc:appeal',
} as const;

export function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function dashboardUrl(base: string | undefined, path: string): string | null {
  if (!base) return null;
  return `${base.replace(/\/+$/, '')}${path}`;
}

/** Message shown in Discord when a plan has been generated. */
export function planReadyMessage(input: {
  summary: string;
  version: number;
  planVersionId: string;
  sessionId: string;
  counts: ChangeSet['counts'];
  warnings: string[];
  downgrades: number;
  elevation: boolean;
  url: string | null;
}) {
  const lines = [
    `**${input.counts.create}** to create · **${input.counts.update}** to update · **${input.counts.unchanged}** already exist · **${input.counts.skipped}** left as-is`,
  ];
  if (input.elevation) lines.push('⚠️ Grants moderation/management permissions to some roles (you will be asked to confirm).');
  if (input.downgrades) lines.push(`ℹ️ ${input.downgrades} item(s) were adjusted to fit Discord limits or safety rules.`);
  for (const w of input.warnings.slice(0, 3)) lines.push(`⚠️ ${truncate(w, 180)}`);
  const buttons: unknown[] = [
    { type: 2, style: 1, label: 'Review & apply', custom_id: `${CID.planReview}:${input.planVersionId}` },
    { type: 2, style: 2, label: 'Revise', custom_id: `${CID.planRevise}:${input.sessionId}` },
  ];
  if (input.url) buttons.push({ type: 2, style: 5, label: 'Open dashboard', url: input.url });
  return {
    content: '',
    embeds: [
      {
        title: `🍳 Your server plan is ready (v${input.version})`,
        description: truncate(`${input.summary || 'Server plan'}\n\n${lines.join('\n')}`, 4000),
        color: BRAND_COLOR,
        footer: { text: 'Nothing changes until you confirm. Plans are additive by default.' },
      },
    ],
    components: [{ type: 1, components: buttons }],
    allowed_mentions: { parse: [] },
  };
}

export function planFailedMessage(error: string) {
  return {
    content: '',
    embeds: [{ title: 'Could not create a plan', description: truncate(error, 2000), color: DANGER_COLOR }],
    components: [],
    allowed_mentions: { parse: [] },
  };
}
