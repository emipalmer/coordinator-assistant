// One JSON object per line so CloudWatch Logs Insights and `jq` can query it.
type Level = 'debug' | 'info' | 'warn' | 'error';

export function createLogger(base: Record<string, unknown> = {}) {
  const emit = (level: Level, msg: string, fields: Record<string, unknown> = {}) => {
    if (level === 'debug' && !process.env.LOG_DEBUG) return;
    const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...base, ...fields }, errorReplacer);
    (level === 'error' || level === 'warn' ? console.error : console.log)(line);
  };
  return {
    debug: (m: string, f?: Record<string, unknown>) => emit('debug', m, f),
    info: (m: string, f?: Record<string, unknown>) => emit('info', m, f),
    warn: (m: string, f?: Record<string, unknown>) => emit('warn', m, f),
    error: (m: string, f?: Record<string, unknown>) => emit('error', m, f),
    child: (more: Record<string, unknown>) => createLogger({ ...base, ...more }),
  };
}
export type Logger = ReturnType<typeof createLogger>;

function errorReplacer(_k: string, v: unknown) {
  return v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : v;
}
