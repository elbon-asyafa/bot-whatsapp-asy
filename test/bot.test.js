const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHandler, acquireLock } = require('../index');
const { config } = require('../lib/config');
let counter = 0;
function message(value, chat = '12000@g.us', extra = {}) {
  return { key: { remoteJid: chat, participant: '628111111111@s.whatsapp.net', id: String(counter++), ...extra }, message: { conversation: value } };
}
function setup(deps) {
  const sent = [];
  const records = [];
  const logger = {
    info: (fields, message) => records.push({ level: 'info', ...fields, message }),
    error: (fields, message) => records.push({ level: 'error', ...fields, message }),
  };
  const sock = { sendMessage: async (chat, body) => { sent.push({ chat, body }); }, groupMetadata: async () => ({ participants: [
    { id: '628999999999@s.whatsapp.net', admin: 'admin' }, { id: '628111111111@s.whatsapp.net', admin: null },
  ] }) };
  const handler = createHandler({ logger, ...deps });
  return { sent, sock, records, call: (...messages) => handler(sock, { type: 'notify', messages }) };
}

test('conversation logs include sender, alternate phone, exact input and every reply', async () => {
  const { records, call } = setup({ ai: async () => 'Jawaban\nbaris kedua' });
  const input = message('/ai halo', undefined, { participant: '999@lid', participantAlt: '628111111111@s.whatsapp.net' });
  input.pushName = 'Asy';
  await call(input, input);
  assert.equal(records.length, 2);
  assert.deepEqual(records[0].sender, { name: 'Asy', jid: '999@lid', phone: '+628111111111' });
  assert.equal(records[0].content.text, '/ai halo');
  assert.equal(records[1].content.text, 'Jawaban\nbaris kedua');
  assert.equal(records[1].target, '12000@g.us');
  assert.equal(records[1].messageId, input.key.id);
  assert.equal(records[1].status, 'terkirim');
  assert(records[1].durationMs >= 0);
});

test('ordinary messages are logged without replying or inventing a phone from a LID', async () => {
  const { records, sent, call } = setup();
  await call(message('halo', '999@lid'));
  assert.equal(sent.length, 0);
  assert.equal(records.length, 1);
  assert.equal(records[0].sender.phone, null);
  assert.equal(records[0].chatType, 'pribadi');
  assert.match(records[0].status, /bukan command/);
});

test('media responses log their type without including binary content', async () => {
  const { records, call } = setup({ brat: async () => Buffer.from('private binary'), sticker: async b => b });
  await call(message('/brat halo'));
  assert.deepEqual(records[1].content, { type: 'stiker', text: '' });
  assert(!JSON.stringify(records).includes('private binary'));
});

test('failed AI requests and failed sends retain conversation context', async () => {
  const first = setup({ ai: async () => { throw new Error('AI offline'); } });
  await first.call(message('/ai halo'));
  assert(first.records.some(record => record.err?.message === 'AI offline' && record.sender.phone === '+628111111111'));
  assert(first.records.some(record => record.event === 'message.sent' && /Gagal memproses/.test(record.content.text)));
  const second = setup();
  second.sock.sendMessage = async () => { throw new Error('Disconnected'); };
  await second.call(message('/help'));
  const failure = second.records.find(record => record.event === 'message.send_failed');
  assert.equal(failure.status, 'gagal dikirim');
  assert.equal(failure.err.message, 'Disconnected');
  assert(!second.records.some(record => record.event === 'message.sent'));
});

test('group and private utilities work immediately, without registration or activation', async () => {
  const { sent, call } = setup({ brat: async () => Buffer.from('brat'), sticker: async b => b });
  await call(message('/brat halo'), message('/brat hai', '628111111111@s.whatsapp.net'));
  assert.deepEqual(sent.map(x => x.chat), ['12000@g.us', '628111111111@s.whatsapp.net']);
  assert(sent.every(x => x.body.sticker));
});

test('non-command, newsletter, own message and old delivery do not drop the next command', async () => {
  const { sent, call } = setup();
  const old = message('/help'); old.messageTimestamp = 1;
  await call(message('halo'), message('/help', '123@newsletter'), message('/help', undefined, { fromMe: true }), old, message('/help'));
  assert.equal(sent.length, 1);
  assert.match(sent[0].body.text, /Tidak perlu daftar/);
});

test('replayed message is suppressed but following messages still run', async () => {
  const { sent, call } = setup(); const first = message('/help');
  await call(first, first, message('/help'));
  assert.equal(sent.length, 2);
});

test('old account and Sheets commands have no side effects', async () => {
  const { sent, call } = setup();
  await call(message('/daftarbot nama'), message('/rekap'), message('/alarm 12:00 makan'));
  assert.equal(sent.length, 3);
  assert(sent.every(x => /sudah dihapus/.test(x.body.text)));
});

test('public group member cannot tag everyone even if the first member is admin', async () => {
  const { sent, call } = setup();
  await call(message('/ping halo'));
  assert.match(sent[0].body.text, /cuma untuk admin/);
  assert.equal(sent[0].body.mentions, undefined);
  await call(message('/ping halo', undefined, { participant: '628999999999@s.whatsapp.net' }));
  assert.equal(sent[1].body.mentions.length, 2);
});

test('photo caption and reply photo can create stickers in a group', async () => {
  const { sent, call } = setup({ downloadMediaMessage: async () => Buffer.from('image'), sticker: async () => Buffer.from('webp') });
  const photo = message(''); photo.message = { imageMessage: { caption: '/stiker', mimetype: 'image/jpeg' } };
  const quoted = message(''); quoted.message = { extendedTextMessage: { text: '/stiker', contextInfo: { stanzaId: 'picture', participant: '628333333333@s.whatsapp.net', quotedMessage: { imageMessage: { mimetype: 'image/jpeg' } } } } };
  await call(photo, quoted);
  assert.equal(sent.length, 2); assert(sent.every(x => x.body.sticker));
});

test('oversized image rejected before the image is downloaded', async () => {
  let downloaded = false;
  const { sent, call } = setup({ downloadMediaMessage: async () => { downloaded = true; } });
  const photo = message(''); photo.message = { imageMessage: { caption: '/stiker', fileLength: 11000000 } };
  await call(photo);
  assert.equal(downloaded, false); assert.match(sent[0].body.text, /10 MB/);
});

test('AI in group and private is stateless and scoped to the current message', async () => {
  const prompts = [];
  const { sent, call } = setup({ ai: async prompt => { prompts.push(prompt); return `Jawab ${prompt}`; } });
  await call(message('/ai rahasia', '628111111111@s.whatsapp.net'), message('/ai halo'));
  assert.deepEqual(prompts, ['rahasia', 'halo']);
  assert.equal(sent[1].body.text, 'Jawab halo');
});

test('forwarding is owner-only, accepting a trusted alternate identity', async () => {
  const owners = config.ownerNumbers;
  config.ownerNumbers = ['628999999999@s.whatsapp.net'];
  try {
    const { sent, call } = setup();
    await call(message('/kirim 628222222222 halo'));
    assert.equal(sent.length, 1); assert.match(sent[0].body.text, /cuma untuk owner/);
    await call(message('/kirim 628222222222 halo', undefined, { participant: '999@lid', participantAlt: '628999999999@s.whatsapp.net' }));
    assert(sent.some(x => x.chat === '628222222222@s.whatsapp.net' && x.body.text === 'halo'));
  } finally { config.ownerNumbers = owners; }
});

test('download URL validation runs before downloader; audio caption is sent separately', async () => {
  let downloaded = false;
  const { sent, call } = setup({ download: async (url, format, send) => { downloaded = true; assert.equal(format, 'mp3'); await send(Buffer.from('audio')); } });
  await call(message('/download https://localhost/private mp4'));
  assert.equal(downloaded, false);
  await call(message('/download https://youtu.be/test mp3 | caption'));
  assert(sent.some(x => x.body.audio));
  assert(sent.some(x => x.body.text === 'caption'));
});

test('request concurrency is bounded and the limit is released after completion', async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const { call, sent } = setup({ ai: async () => { await pending; return 'ok'; } });
  const first = call(message('/ai a')); const second = call(message('/ai b'));
  await call(message('/ai c'));
  assert(sent.some(x => /request lain/.test(x.body.text)));
  finish(); await Promise.all([first, second]);
  await call(message('/ai d'));
  assert.equal(sent.filter(x => x.body.text === 'ok').length, 3);
});

test('runtime lock refuses a second process and recovers a stale lock', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asy-lock-'));
  const file = path.join(dir, '.bot.lock');
  try {
    const release = acquireLock(file);
    assert.throws(() => acquireLock(file), /sudah berjalan/);
    release(); assert(!fs.existsSync(file));
    fs.writeFileSync(file, '2147483647');
    const cleanup = acquireLock(file); cleanup();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
