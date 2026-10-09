'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { Button } from './ui';

export function CaseActions({ guildId, caseNumber, active, appealOpen }: { guildId: string; caseNumber: number; active: boolean; appealOpen: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (body: unknown) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/guilds/${guildId}/cases/${caseNumber}`, { body });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap gap-1">
      {appealOpen ? (
        <>
          <Button variant="secondary" className="px-2 py-1 text-xs" disabled={busy} onClick={() => void run({ action: 'appeal', accepted: true })}>Accept appeal</Button>
          <Button variant="ghost" className="px-2 py-1 text-xs" disabled={busy} onClick={() => void run({ action: 'appeal', accepted: false })}>Reject</Button>
        </>
      ) : null}
      <Button variant="ghost" className="px-2 py-1 text-xs" disabled={busy} onClick={() => void run({ action: 'active', active: !active })}>
        {active ? 'Pardon' : 'Reactivate'}
      </Button>
      {error ? <span role="alert" className="text-xs text-chili-400">{error}</span> : null}
    </div>
  );
}
