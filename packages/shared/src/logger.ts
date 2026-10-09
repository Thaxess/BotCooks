type Level = 'debug' | 'info' | 'warn' | 'error';
const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SECRET_KEYS = /token|secret|password|authorization|api[_-]?key|cookie/i;

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

/** Recursively replaces values under secret-looking keys so they never reach log sinks. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth]';
  if (value instanceof Error) {
    // Wrapped errors (e.g. Drizzle's "Failed query") keep the real reason in `cause`.
    const cause = (value as { cause?: unknown }).cause;
    return { name: value.name, message: value.message, stack: value.stack, ...(cause ? { cause: redact(cause, depth + 1) } : {}) };
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEYS.test(k) ? '[redacted]' : redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'bigint') return value.toString();
  return value;
}

export function createLogger(name: string, base: Record<string, unknown> = {}): Logger {
  const min = LEVELS[(process.env.LOG_LEVEL as Level) ?? 'info'] ?? LEVELS.info;
  const write = (level: Level, msg: string, fields?: Record<string, unknown>) => {
    if (LEVELS[level] < min) return;
    const line = JSON.stringify({
      t: new Date().toISOString(),
      level,
      name,
      msg,
      ...(redact({ ...base, ...fields }) as Record<string, unknown>),
    });
    if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
    else process.stdout.write(line + '\n');
  };
  return {
    debug: (m, f) => write('debug', m, f),
    info: (m, f) => write('info', m, f),
    warn: (m, f) => write('warn', m, f),
    error: (m, f) => write('error', m, f),
    child: (f) => createLogger(name, { ...base, ...f }),
  };
}
