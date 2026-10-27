const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHandler, acquireLock, help } = require('../index');
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
  const sock = { user: { id: '628555555555:7@s.whatsapp.net', name: 'Bot ASY' }, sendMessage: async (chat, body) => { sent.push({ chat, body }); }, groupMetadata: async () => ({ participants: [
    { id: '628999999999@s.whatsapp.net', admin: 'admin' }, { id: '628111111111@s.whatsapp.net', admin: null },
  ] }) };
  const handler = createHandler({ logger, ...deps });
  return { sent, sock, records, call: (...messages) => handler(sock, { type: 'notify', messages }) };
}

test('help always lists owner commands and labels recognized owners', () => {
  for (const owner of [true, false]) {
    assert.match(help(owner), /\/kirim \[nomor\]/);
    assert.match(help(owner), /Khusus owner/);
  }
  assert.match(help(true), /akunmu dikenali/);
  assert(!help(false).includes('akunmu dikenali'));
});

test('Baileys participantPn and senderPn recognize owners in group and private LID chats', async () => {
  const before = config.ownerNumbers;
  config.ownerNumbers = ['628777777777@s.whatsapp.net'];
  try {
    const { call, sent, records } = setup();
    await call(message('/ping halo', undefined, { participant: '70101@lid', participantPn: config.ownerNumbers[0] }));
    assert.equal(sent.at(-1).body.mentions.length, 2);
    assert.equal(records[0].sender.phone, '+628777777777');
    await call(message('/help', '70102@lid', { senderPn: config.ownerNumbers[0] }));
    assert.match(sent.at(-1).body.text, /akunmu dikenali/);
    await call(message('/kirim 628222222222 tes', '70102@lid', { senderPn: config.ownerNumbers[0] }));
    assert(sent.some(item => item.chat === '628222222222@s.whatsapp.net' && item.body.text === 'tes'));
    await call(message('/log', '70102@lid', { senderPn: config.ownerNumbers[0] }));
    assert.match(sent.at(-1).body.text, /\*Log bot/);
  } finally { config.ownerNumbers = before; }
});

test('group envelope senderPn cannot authorize a different participant as owner', async () => {
  const before = config.ownerNumbers;
  config.ownerNumbers = ['628777777777@s.whatsapp.net'];
  try {
    const { call, sent } = setup();
    await call(message('/ping', undefined, { participant: '70103@lid', senderPn: config.ownerNumbers[0], participantPn: '628333333333@s.whatsapp.net' }));
    assert.match(sent.at(-1).body.text, /cuma untuk owner/);
    assert.equal(sent.at(-1).body.mentions, undefined);
  } finally { config.ownerNumbers = before; }
});

test('conversation logs include sender, alternate phone, exact input and every reply', async () => {
  const { records, call } = setup({ ai: async () => 'Jawaban\nbaris kedua' });
  const input = message('/ai halo', undefined, { participant: '999@lid', participantAlt: '628111111111@s.whatsapp.net' });
  input.pushName = 'Asy';
  await call(input, input);
  assert.equal(records.length, 2);
  assert.deepEqual(records[0].sender, { name: 'Asy', jid: '999@lid', phone: '+628111111111' });
  assert.equal(records[0].content.text, '/ai halo');
  assert.equal(records[1].content.text, 'Jawaban\nbaris kedua');
  assert.deepEqual(records[1].sender, { name: 'Bot ASY', jid: '628555555555@s.whatsapp.net', phone: '+628555555555' });
  assert.deepEqual(records[1].requester, records[0].sender);
  assert.equal(records[1].target, '12000@g.us');
  assert.equal(records[1].messageId, input.key.id);
  assert.equal(records[1].status, 'terkirim');
  assert(records[1].durationMs >= 0);
});

test('ordinary private and group messages are ignored without logging', async () => {
  const { records, sent, call } = setup();
  await call(message('halo', '999@lid'), message('obrolan grup'));
  assert.equal(sent.length, 0);
  assert.equal(records.length, 0);
});

test('group admins, alternate admin identities and private non-owners cannot use owner commands', async () => {
  const owners = config.ownerNumbers;
  config.ownerNumbers = [];
  try {
    const { call, sent, sock } = setup();
    sock.groupMetadata = async () => { throw new Error('must not query metadata for non-owners'); };
    for (const command of ['/log', '/ping', '/kirim 628222222222 halo']) {
      await call(message(command, undefined, { participant: '628999999999@s.whatsapp.net' }),
        message(command, undefined, { participant: '888@lid', participantAlt: '628999999999@s.whatsapp.net' }),
        message(command, '628111111111@s.whatsapp.net'));
    }
    assert.equal(sent.length, 9);
    assert(sent.every(item => /cuma untuk owner bot/.test(item.body.text)));
    assert(sent.every(item => !item.body.mentions && item.chat !== '628222222222@s.whatsapp.net'));
  } finally { config.ownerNumbers = owners; }
});

test('owner can read all chats privately, while group requests remain scoped', async () => {
  const owners = config.ownerNumbers;
  const owner = '628777777777@s.whatsapp.net';
  config.ownerNumbers = [owner];
  try {
    const { call, sent } = setup({ ai: async value => value });
    await call(message('/ai pribadi saja', '628111111111@s.whatsapp.net'), message('/ai grup saja'));
    await call(message('/log 30', '777@lid', { remoteJidAlt: owner }));
    assert.match(sent.at(-1).body.text, /pribadi saja/);
    assert.match(sent.at(-1).body.text, /grup saja/);
    await call(message('/log 30', undefined, { participant: owner }));
    assert.match(sent.at(-1).body.text, /grup saja/);
    assert(!sent.at(-1).body.text.includes('pribadi saja'));
    await call(message('/log 31', owner));
    assert.match(sent.at(-1).body.text, /Format: \/log/);
  } finally { config.ownerNumbers = owners; }
});

test('log history is bounded and log exports are not copied into subsequent exports', async () => {
  const { createChatHistory } = require('../lib/chat-log');
  const history = createChatHistory(2);
  for (const text of ['expired', 'kept one', 'kept two']) history.add({ time: Date.now(),
    sender: { name: 'Asy', phone: '+628111111111' }, chat: '12000@g.us', chatType: 'grup',
    event: 'message.received', content: { type: 'teks', text } });
  assert(!history.read(null, 30).includes('expired'));
  assert.match(history.read(null, 1), /kept two/);
  assert(!history.read('other@g.us', 30));
  const owners = config.ownerNumbers;
  config.ownerNumbers = ['628777777777@s.whatsapp.net'];
  try {
    const { call, sent } = setup();
    await call(message('/log', undefined, { participant: config.ownerNumbers[0] }));
    await call(message('/log', undefined, { participant: config.ownerNumbers[0] }));
    assert.equal(sent.at(-1).body.text.split('*Log bot').length, 2);
    assert.match(sent.at(-1).body.text, /\[respons \/log\]/);
  } finally { config.ownerNumbers = owners; }
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
  assert.equal(failure.sender.phone, '+628555555555');
  assert(!second.records.some(record => record.event === 'message.sent'));
});

test('missing bot identity never falls back to the requesting user', async () => {
  const { sock, call, records } = setup();
  sock.user = { id: '12345@lid' };
  await call(message('/help'));
  assert.deepEqual(records[1].sender, { name: 'Bot WhatsApp', jid: '12345@lid', phone: null });
  delete sock.user;
  await call(message('/help'));
  assert.deepEqual(records[3].sender, { name: 'Bot WhatsApp', jid: null, phone: null });
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

test('owner can tag group members without being a group admin', async () => {
  const owners = config.ownerNumbers;
  config.ownerNumbers = ['628111111111@s.whatsapp.net'];
  try {
    const { call, sent } = setup();
    await call(message('/ping halo'));
    assert.equal(sent[0].body.mentions.length, 2);
    await call(message('/ping halo', config.ownerNumbers[0]));
    assert.match(sent[1].body.text, /dipakai oleh owner bot di grup/);
  } finally { config.ownerNumbers = owners; }
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
