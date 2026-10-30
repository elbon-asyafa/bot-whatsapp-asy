const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Writable } = require('node:stream');
const { createLogger, formatRecord } = require('../lib/logger');

test('Baileys error contains message and stack, without dumping message content', () => {
  const lines = [];
  const logger = createLogger(new Writable({ write(chunk, encoding, done) { lines.push(JSON.parse(chunk.toString())); done(); } }));
  logger.error({ error: new Error('session lookup failed'), node: { tag: 'message', attrs: { category: 'peer' }, content: [{ encrypted: Buffer.from('private') }] } }, 'error in handling message');
  assert.equal(lines[0].error.message, 'session lookup failed');
  assert.match(lines[0].error.stack, /session lookup failed/);
  assert.equal(lines[0].node.content, undefined);
  assert.equal(lines[0].node.attrs.category, 'peer');
});

function capture(options) {
  const records = [];
  const output = new Writable({ write(chunk, encoding, done) { records.push(JSON.parse(chunk.toString())); done(); } });
  return { records, logger: createLogger(output, { format: 'json', ...options }) };
}

function timeout() {
  return Object.assign(new Error('Timed Out'), { output: { statusCode: 408 } });
}

test('only repeated init-query timeouts are summarized, with the count on the next warning', () => {
  let time = 0;
  const { records, logger } = capture({ now: () => time });
  const wa = logger.child({ component: 'wa' }, { level: 'warn' });
  for (let i = 0; i < 3; i++) wa.error({ err: timeout() }, "unexpected error in 'init queries'");
  assert.equal(records.length, 1);
  assert.equal(records[0].level, 40);
  wa.error({ err: new Error('Decrypt failed') }, 'error in handling message');
  assert.equal(records.length, 2);
  assert.equal(records[1].level, 50);
  time = 300001;
  wa.error({ err: timeout() }, "unexpected error in 'init queries'");
  assert.equal(records[2].suppressed, 2);
});

test('debug retains original init-query errors and their stack', () => {
  const { records, logger } = capture({ level: 'debug' });
  logger.error({ err: timeout() }, "unexpected error in 'init queries'");
  logger.error({ err: timeout() }, "unexpected error in 'init queries'");
  assert.equal(records.length, 2);
  assert.equal(records[0].level, 50);
  assert.match(records[0].err.stack, /Timed Out/);
});

test('pretty output is one line, omits metadata, and only prints stacks in debug mode', () => {
  const record = { time: Date.UTC(2026, 9, 27, 10, 0), level: 50, component: 'wa', msg: 'error in handling message', pid: 123, hostname: 'private-host', err: { message: 'Failed', stack: 'Error: Failed\n at hidden/path.js:1' } };
  const line = formatRecord(record);
  assert.equal(line, '17:00:00 ERROR WA | error in handling message — Failed\n');
  assert.match(formatRecord(record, true), /hidden\/path.js/);
});

test('pretty destination produces readable output instead of JSON', () => {
  const lines = [];
  const output = new Writable({ write(chunk, encoding, done) { lines.push(chunk.toString()); done(); } });
  createLogger(output, { format: 'pretty' }).info('WhatsApp tersambung.');
  assert.match(lines[0], /^\d{2}:\d{2}:\d{2} INFO BOT \| WhatsApp tersambung\.\n$/);
});

test('pretty conversation output is compact, bounded and safe for terminal display', () => {
  const result = formatRecord({ time: Date.UTC(2026, 9, 27, 10), level: 30, msg: 'Respons bot terkirim',
    event: 'message.sent',
    sender: { name: 'Asy\u001b[31m', phone: '+628111111111', jid: '999@lid' }, chatType: 'grup',
    chat: '12000@g.us', messageId: 'incoming', target: '12000@g.us', command: '.ai',
    content: { type: 'teks', text: 'halo\nbaris kedua\u001b' }, status: 'terkirim', durationMs: 42 });
  assert.match(result, /^17:00:00 BALAS \| Asy.*\(\+628111111111\)/);
  assert(!result.includes('incoming'));
  assert(!result.includes('999@lid'));
  assert(result.includes('halo baris kedua'));
  assert(!result.includes('\u001b'));
  assert.match(result, /grup 12000@g.us \| 42 ms/);
  assert.equal(result.trim().split('\n').length, 2);
  const long = formatRecord({ time: Date.now(), event: 'message.received', sender: { name: 'Asy' },
    chatType: 'pribadi', content: { type: 'teks', text: 'x'.repeat(5000) } });
  assert(long.length < 400);
  assert(long.includes('…'));
});
