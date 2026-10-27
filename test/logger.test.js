const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Writable } = require('node:stream');
const { createLogger } = require('../lib/logger');

test('Baileys error contains message and stack, without dumping message content', () => {
  const lines = [];
  const logger = createLogger(new Writable({ write(chunk, encoding, done) { lines.push(JSON.parse(chunk.toString())); done(); } }));
  logger.error({ error: new Error('session lookup failed'), node: { tag: 'message', attrs: { category: 'peer' }, content: [{ encrypted: Buffer.from('private') }] } }, 'error in handling message');
  assert.equal(lines[0].error.message, 'session lookup failed');
  assert.match(lines[0].error.stack, /session lookup failed/);
  assert.equal(lines[0].node.content, undefined);
  assert.equal(lines[0].node.attrs.category, 'peer');
});
