const pino = require('pino');
const { Writable } = require('node:stream');
const { formatChatRecord } = require('./chat-log');
const labels = { 10: 'TRACE', 20: 'DEBUG', 30: 'INFO', 40: 'WARN', 50: 'ERROR', 60: 'FATAL' };
const clean = value => String(value || '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim();

function formatRecord(record, verbose = false) {
  const time = new Date(record.time).toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta', hour12: false });
  const component = record.component === 'wa' ? 'WA' : 'BOT';
  const error = record.err || record.error;
  let message = clean(record.msg);
  if (error?.message && !message.includes(clean(error.message))) message += ` — ${clean(error.message)}`;
  if (record.suppressed) message += ` (${record.suppressed} pengulangan diringkas)`;
  let result = `${time} ${labels[record.level] || 'LOG'} ${component} | ${message}\n`;
  if (record.sender) result = formatChatRecord(record);
  if (verbose && error?.stack) result += error.stack.split('\n').map(line => `    ${clean(line)}`).join('\n') + '\n';
  return result;
}

function prettyDestination(output) {
  let pending = '';
  return new Writable({
    write(chunk, encoding, done) {
      pending += chunk.toString();
      const lines = pending.split('\n');
      pending = lines.pop();
      try {
        for (const line of lines) if (line) {
          const verbose = ['debug', 'trace'].includes(process.env.LOG_LEVEL);
          output.write(formatRecord(JSON.parse(line), verbose));
        }
        done();
      } catch (error) { done(error); }
    },
  });
}

function createLogger(destination, options = {}) {
  // Explicit destinations default to JSON for tooling/tests; terminal output is readable.
  const format = options.format || process.env.LOG_FORMAT || (destination ? 'json' : 'pretty');
  const output = destination || process.stdout;
  let lastInitTimeout = -Infinity, suppressed = 0;
  const now = options.now || Date.now;
  return pino({
    level: options.level || 'info',
    serializers: { err: pino.stdSerializers.err, error: pino.stdSerializers.err },
    redact: { paths: ['node.content'], remove: true },
    hooks: {
      logMethod(args, method) {
        const entry = args[0];
        const error = entry && typeof entry === 'object' ? entry.err || entry.error : undefined;
        const message = typeof args[1] === 'string' ? args[1] : entry?.msg;
        const initTimeout = message === "unexpected error in 'init queries'" && error?.output?.statusCode === 408;
        if (initTimeout && this.levelVal > 20) {
          const time = now();
          if (time - lastInitTimeout < 300000) { suppressed++; return; }
          lastInitTimeout = time;
          const count = suppressed; suppressed = 0;
          this.warn({ suppressed: count }, 'Sinkronisasi awal WhatsApp timeout (408). Coba /help jika command tidak merespons. Warning serupa diringkas selama 5 menit.');
          return;
        }
        return method.apply(this, args);
      },
    },
  }, format === 'json' ? output : prettyDestination(output));
}

module.exports = { createLogger, formatRecord };
