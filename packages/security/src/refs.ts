/**
 * Canonical role references inside a validated plan:
 *   everyone          -> the @everyone role
 *   role:<key>        -> a role created/matched by this plan
 *   existing:<id>     -> a role that already exists on the server
 * Raw AI output may use names or keys; the validator rewrites them into these forms.
 */
export type RoleRef = { kind: 'everyone' } | { kind: 'plan'; key: string } | { kind: 'existing'; id: string };

export function parseRoleRef(ref: string): RoleRef | null {
  if (ref === 'everyone') return { kind: 'everyone' };
  if (ref.startsWith('role:')) return { kind: 'plan', key: ref.slice(5) };
  if (ref.startsWith('existing:')) return { kind: 'existing', id: ref.slice(9) };
  return null;
}

export function formatRoleRef(ref: RoleRef): string {
  switch (ref.kind) {
    case 'everyone':
      return 'everyone';
    case 'plan':
      return `role:${ref.key}`;
    case 'existing':
      return `existing:${ref.id}`;
  }
}
