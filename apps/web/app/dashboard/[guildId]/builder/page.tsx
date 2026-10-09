import { TEMPLATE_LIST } from '@botcooks/ai';
import { listBuildSessions } from '@botcooks/database';
import { can } from '@botcooks/security';
import { PageHeader } from '@/components/ui';
import { BuilderWorkspace } from '@/components/builder/workspace';
import { server } from '@/lib/server/context';
import { requirePageAccess } from '@/lib/server/guild';

export const metadata = { title: 'AI server builder' };

export default async function BuilderPage({ params, searchParams }: { params: Promise<{ guildId: string }>; searchParams: Promise<{ session?: string }> }) {
  const { guildId } = await params;
  const { session } = await searchParams;
  const { access } = await requirePageAccess(guildId, { type: 'builder.generate' });
  const sessions = await listBuildSessions(server().db, guildId, 30);
  return (
    <>
      <PageHeader
        emoji="🍳"
        title="AI server builder"
        description="Describe your server in plain language or start from a template. BotCooks drafts a plan, you review the exact changes, and nothing happens until you confirm."
      />
      <BuilderWorkspace
        guildId={guildId}
        aiConfigured={Boolean(server().provider)}
        aiProvider={server().provider ? `${server().provider!.name} · ${server().provider!.model}` : null}
        templates={TEMPLATE_LIST}
        initialSessions={sessions.map((s) => ({ ...s, createdAt: s.createdAt.toISOString() }))}
        initialSessionId={session ?? null}
        canApplyBasic={can(access, { type: 'builder.apply', destructive: false, elevation: false })}
      />
    </>
  );
}
