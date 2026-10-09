import { createHash } from 'node:crypto';

/** Deterministic JSON serialisation (sorted object keys) so equal values always hash equally. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortValue(v);
    }
    return out;
  }
  return value;
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function hashValue(value: unknown): string {
  return sha256(stableStringify(value));
}
