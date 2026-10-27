const pino = require('pino');
const { Writable } = require('node:stream');
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
  if (record.sender) {
    const sender = record.sender;
    result += `    Pengirim : ${clean(sender.name)} | Nomor: ${clean(sender.phone || 'belum tersedia (ID WhatsApp saja)')} | ID: ${clean(sender.jid)}\n`;
    result += `    Chat     : ${clean(record.chatType)} | ${clean(record.chat)} | ID pesan: ${clean(record.messageId)}\n`;
    if (record.command) result += `    Command  : ${clean(record.command)}\n`;
    if (record.target) result += `    Tujuan   : ${clean(record.target)}\n`;
    if (record.content) {
      const content = record.content;
      // Escape newlines and terminal control characters while retaining the complete text.
      result += `    Isi      : [${clean(content.type)}] ${JSON.stringify(String(content.text || ''))}\n`;
      if (content.fileName) result += `    File     : ${clean(content.fileName)}\n`;
      if (content.mimetype) result += `    MIME     : ${clean(content.mimetype)}\n`;
    }
    if (record.status) result += `    Status   : ${clean(record.status)}${record.durationMs !== undefined ? ` | ${record.durationMs} ms sejak pesan diterima` : ''}\n`;
    if (record.responseId) result += `    ID balas : ${clean(record.responseId)}\n`;
  }
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
