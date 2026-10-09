'use client';

import { useState } from 'react';
import { api } from '@/lib/client/api';
import type { RoleOption } from './settings';
import { Alert, Button, Card, CardTitle, Select } from './ui';

export function DelegationEditor({ guildId, roles, scopes, initial }: { guildId: string; roles: RoleOption[]; scopes: Array<{ key: string; label: string }>; initial: Array<{ roleId: string; scopes: string[] }> }) {
  const [rows, setRows] = useState(initial);
  const [adding, setAdding] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? 'deleted role';
  const toggle = (roleId: string, scope: string) =>
    setRows((rs) => rs.map((r) => (r.roleId === roleId ? { ...r, scopes: r.scopes.includes(scope) ? r.scopes.filter((s) => s !== scope) : [...r.scopes, scope] } : r)));
  return (
    <Card>
      <CardTitle description="Give trusted roles access to specific dashboard sections. Delegated users can never change delegation, administrator settings, deletions, or permission elevation.">Delegated access</CardTitle>
      <div className="flex flex-col gap-4">
        {rows.length === 0 ? <p className="text-sm text-coal-400">No roles have delegated access.</p> : null}
        {rows.map((row) => (
          <fieldset key={row.roleId} className="rounded-lg border border-coal-700 p-3">
            <legend className="px-1 text-sm font-semibold">@{roleName(row.roleId)}</legend>
            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {scopes.map((s) => (
                <label key={s.key} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="accent-ember-500" checked={row.scopes.includes(s.key)} onChange={() => toggle(row.roleId, s.key)} />
                  {s.label}
                </label>
              ))}
            </div>
            <Button variant="ghost" className="mt-2 px-2 py-1 text-xs" onClick={() => setRows((rs) => rs.filter((r) => r.roleId !== row.roleId))}>Remove role</Button>
          </fieldset>
        ))}
        <div className="flex flex-wrap items-end gap-2">
          <label htmlFor="add-role" className="sr-only">Role to add</label>
          <Select id="add-role" value={adding} onChange={(e) => setAdding(e.target.value)} className="w-64">
            <option value="">Add a role…</option>
            {roles.filter((r) => !r.managed && !rows.some((x) => x.roleId === r.id)).map((r) => <option key={r.id} value={r.id}>@{r.name}</option>)}
          </Select>
          <Button variant="secondary" disabled={!adding} onClick={() => { setRows((rs) => [...rs, { roleId: adding, scopes: [] }]); setAdding(''); }}>Add</Button>
        </div>
        <div className="flex items-center gap-3">
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setMsg(null);
              try {
                const res = await api<{ delegations: typeof rows }>(`/api/guilds/${guildId}/delegations`, { method: 'PUT', body: { delegations: rows } });
                setRows(res.delegations);
                setMsg({ ok: true, text: 'Saved.' });
              } catch (e) {
                setMsg({ ok: false, text: (e as Error).message });
              } finally {
                setBusy(false);
              }
            }}
          >
            Save delegation
          </Button>
          {msg ? <Alert tone={msg.ok ? 'ok' : 'danger'}>{msg.text}</Alert> : null}
        </div>
      </div>
    </Card>
  );
}
