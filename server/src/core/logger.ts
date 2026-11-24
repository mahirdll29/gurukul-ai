type Fields = Record<string, unknown>;
function write(level: 'info' | 'warn' | 'error', msg: string, fields: Fields = {}) {
  process.stdout.write(`${JSON.stringify({ level, ts: new Date().toISOString(), msg, ...fields })}\n`);
}
export const logger = {
  info: (msg: string, fields?: Fields) => write('info', msg, fields),
  warn: (msg: string, fields?: Fields) => write('warn', msg, fields),
  error: (msg: string, fields?: Fields) => write('error', msg, fields),
};
