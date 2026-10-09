import { z } from 'zod';

/** Discord snowflake IDs are unsigned 64-bit integers serialised as decimal strings. */
export const snowflakeSchema = z.string().regex(/^\d{17,20}$/, 'Invalid Discord ID');
export type Snowflake = z.infer<typeof snowflakeSchema>;

export function isSnowflake(value: unknown): value is Snowflake {
  return typeof value === 'string' && /^\d{17,20}$/.test(value);
}
