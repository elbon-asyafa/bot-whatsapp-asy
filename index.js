const fs = require('node:fs');
const path = require('node:path');
const { config, normalizeJid } = require('./lib/config');
const { rememberIdentity, isOwner, senderIdentity } = require('./lib/access');
const { text, serial } = require('./lib/validation');
const { download, validateUrl } = require('./lib/download');
const { phoneNumber, describeMessage, createChatHistory } = require('./lib/chat-log');

const MAX_IMAGE = 10 * 1024 * 1024;
const COMMANDS = new Set(['.help', '.ai', '.download', '.stiker', '.sticker', '.brat', '.bratvid', '.fakechat', '.kirim', '.ping', '.log']);
const REMOVED = new Set(['.daftarbot', '.deleteuser', '.masuk', '.keluar', '.rekap', '.riwayat', '.unduhrekap', '.struk', '.todo', '.listtodo', '.done', '.reminder', '.alarm', '.stopalarm', '.listalarm', '.hapusalarm', '.listuser', '.adminhapususer', '.testreminder', '.allreminder', '.botonline', '.botoffline', '.alert']);

function unwrap(content) {
  for (let i = 0; i < 5; i++) {
    const nested = content?.ephemeralMessage?.message || content?.viewOnceMessage?.message || content?.viewOnceMessageV2?.message || content?.documentWithCaptionMessage?.message;
    if (!nested) break;
    content = nested;
  }
  return content || {};
}

function help(owner) {
  return `*Bot WhatsApp ASY*\nLangsung pakai di grup atau chat pribadi. Tidak perlu daftar.\n\n` +
    `.download [link YouTube.TikTok.Instagram] [mp4.mp3] | [caption]\n` +
    `.stiker [teks atas | teks bawah] — foto dengan caption atau reply foto\n` +
    `.brat [teks] — stiker teks\n.bratvid [teks] — stiker teks animasi\n` +
    `.fakechat [pesan] | [jam] — gambar fakechat\n` +
    `.ai [pertanyaan] — tanya AI; bisa foto atau reply foto\n` +
    `.help — daftar command` +
    `\n\n.kirim [nomor] [pesan] — kirim lewat bot; opsional: | dari: Nama\n` +
    `\n*Khusus owner${owner ? ' — akunmu dikenali' : ''}*\n.ping [pesan] — tag anggota grup\n.log [jumlah] — log terbaru (maksimal 30)\n.kirim [nomor] [pesan] — teruskan pesan melalui bot\n.alert [pesan] — kirim pengumuman ke semua grup bot` +
    `\n\nDownload: maksimal 60 MB dan 15 menit durasi. AI memerlukan API key dari pemilik bot.`;
}

function createHandler(deps = {}) {
  const appLog = deps.logger || require('./lib/logger').createLogger();
  const media = deps.downloadMediaMessage;
  const downloadFile = deps.download || download;
  const ai = deps.ai || ((...args) => require('./gemini').tanyaAI(...args));
  const sticker = deps.sticker || (async buffer => new (require('./lib/sticker').Sticker)(buffer).toBuffer());
  const brat = deps.brat || ((value, animated) => {
    const generators = require('./brat-advanced');
    return animated ? generators.generateAnimatedBrat(value) : generators.generateStaticBrat(value);
  });
  const fakechat = deps.fakechat || (value => require('./fakechat').generateFakeChat(value));
  const meme = deps.meme || ((...args) => require('./lib/meme').addMemeText(...args));
  const limits = new Map();
  const seen = new Map();
  const history = createChatHistory();
  function log(level, fields, message) {
    appLog[level](fields, message);
    history.add({ ...fields, time: Date.now(), msg: message });
  }
  let active = 0;
  const started = Math.floor(Date.now() / 1000);

  async function imageBuffer(message) {
    const content = unwrap(message.message);
    if (Number(content.imageMessage?.fileLength || 0) > MAX_IMAGE) throw new Error('Gambar maksimal 10 MB.');
    if (!media) throw new Error('Downloader media belum tersedia.');
    const buffer = await media({ ...message, message: content }, 'buffer', {});
    if (buffer.length > MAX_IMAGE) throw new Error('Gambar maksimal 10 MB.');
    return buffer;
  }

  async function handle(sock, msg) {
    if (!msg?.message || msg.key?.fromMe) return;
    const chat = msg.key?.remoteJid;
    if (!chat || !/@(g\.us|lid|s\.whatsapp\.net)$/.test(chat)) return;
    const timestamp = Number(msg.messageTimestamp) || 0;
    if (timestamp && timestamp < started - 10) return;
    const group = chat.endsWith('@g.us');
    const { author, alternate } = senderIdentity(msg.key);
    if (!author) return;
    rememberIdentity(author, alternate);
    const content = unwrap(msg.message);
    const raw = (content.conversation || content.extendedTextMessage?.text || content.imageMessage?.caption || content.videoMessage?.caption || content.documentMessage?.caption || '').trim();
    if (!raw.startsWith('.')) return;
    // Suppress replayed deliveries without dropping other messages from the batch.
    const messageId = msg.key.id && `${chat}:${author}:${msg.key.id}`;
    if (messageId && seen.has(messageId)) return;
    if (messageId) {
      seen.set(messageId, Date.now());
      while (seen.size > 2000) seen.delete(seen.keys().next().value);
    }
    const receivedAt = Date.now();
    const conversation = {
      messageId: msg.key.id,
      chat, chatType: group ? 'grup' : 'pribadi',
      sender: { name: msg.pushName || 'Nama tidak tersedia', jid: author,
        phone: phoneNumber(author, alternate) },
    };
    const match = raw.match(/^(\S+)(?:\s+([\s\S]*))?$/);
    const cmd = match[1].toLowerCase();
    const args = (match[2] || '').trim();
    log('info', { ...conversation, command: cmd, event: 'message.received', content: describeMessage(content) }, 'Pesan masuk');
    async function send(target, body) {
      // Do not copy log exports back into the history on each .log call.
      const details = { ...conversation, requester: conversation.sender,
        sender: { name: sock.user?.name || 'Bot WhatsApp',
          jid: normalizeJid(sock.user?.id) || sock.user?.id || null,
          phone: phoneNumber(sock.user?.id) }, command: cmd, target,
        content: cmd === '.log' && body.text?.startsWith('*Log bot —')
          ? { type: 'teks', text: '[respons .log]' } : describeMessage(body) };
      try {
        const result = await sock.sendMessage(target, body);
        log('info', { ...details, event: 'message.sent', status: 'terkirim',
          responseId: result?.key?.id, durationMs: Date.now() - receivedAt }, 'Respons bot terkirim');
        return result;
      } catch (error) {
        log('error', { ...details, event: 'message.send_failed', status: 'gagal dikirim',
          durationMs: Date.now() - receivedAt, err: error }, 'Respons bot gagal dikirim');
        throw error;
      }
    }
    const reply = value => send(chat, { text: value });
    if (cmd === '.help') return await reply(help(isOwner(author)));
    if (REMOVED.has(cmd)) return await reply('Fitur ini sudah dihapus. Bot sekarang langsung dipakai tanpa daftar. Ketik .help.');
    if (!COMMANDS.has(cmd)) return await reply('Command belum tersedia. Ketik .help.');
    if (['.log', '.ping', '.kirim', '.alert'].includes(cmd) && !isOwner(author)) return await reply(`${cmd} cuma untuk owner bot.`);
    if (args.length > 4000) return await reply('Pesan terlalu panjang, maksimal 4000 karakter.');
    const now = Date.now();
    const limitKey = `${chat}:${author}`;
    const previous = limits.get(limitKey);
    const limit = previous && now - previous.since < 60000 ? previous : { since: now, count: 0 };
    if (limit.count >= 6) return await reply('Maksimal 6 command per menit. Tunggu sebentar ya.');
    limit.count++;
    limits.set(limitKey, limit);
    while (limits.size > 2000) limits.delete(limits.keys().next().value);
    if (active >= 2) return await reply('Bot sedang mengerjakan request lain. Coba lagi sebentar.');
    active++;
    try {
      const context = content.extendedTextMessage?.contextInfo || content.imageMessage?.contextInfo;
      const quoted = unwrap(context?.quotedMessage);
      const image = content.imageMessage ? { ...msg, message: content } : quoted.imageMessage ? {
        key: { remoteJid: chat, id: context.stanzaId, participant: context.participant }, message: quoted,
      } : null;
      switch (cmd) {
        case '.log': {
          // Global logs stay in owner DMs; requests in a group show only that group.
          if (args && !/^(?:[1-9]|[12]\d|30)$/.test(args)) return await reply('Format: .log [jumlah 1–30]. Contoh: .log 10.');
          const count = args ? Number(args) : 10;
          const result = history.read(group ? chat : null, count);
          return await reply(`*Log bot — ${group ? 'grup ini' : 'semua chat'}*\nAktivitas terbaru sejak bot dinyalakan (maks. 200 entri).\n\n${result || 'Belum ada log.'}`);
        }
        case '.download': {
          const [main, ...captions] = args.split('|');
          const [url, format = 'mp4'] = main.trim().split(/\s+/);
          if (!url) return await reply('Format: .download https:/.youtu.be/... mp4 | caption opsional');
          validateUrl(url);
          if (!['mp3', 'mp4'].includes(format.toLowerCase())) return await reply('Format harus mp3 atau mp4.');
          await reply('Lagi download, tunggu sebentar...');
          await downloadFile(url, format.toLowerCase(), async buffer => {
            const caption = captions.join('|').trim();
            // WhatsApp audio messages do not support a text caption.
            await send(chat, format.toLowerCase() === 'mp3'
              ? { audio: buffer, mimetype: 'audio.mpeg' }
              : { video: buffer, ...(caption ? { caption } : {}) });
            if (format.toLowerCase() === 'mp3' && caption) await reply(caption);
          });
          return;
        }
        case '.stiker':
        case '.sticker': {
          if (!image) return await reply('Kirim foto dengan caption .stiker, atau reply foto dengan .stiker [teks atas | teks bawah].');
          let buffer = await imageBuffer(image);
          if (args) buffer = await meme(buffer, args);
          return await send(chat, { sticker: await sticker(buffer) });
        }
        case '.brat':
        case '.bratvid': {
          const value = text(args, 'Teks Brat', 300);
          if (value.split(/\s+/).length > 30) return await reply('Brat maksimal 30 kata.');
          return await send(chat, { sticker: await sticker(await brat(value, cmd === '.bratvid')) });
        }
        case '.fakechat':
          return await send(chat, { image: await fakechat(text(args, 'Pesan fakechat', 1000)) });
        case '.ai': {
          if (!args && !image) return await reply('Format: .ai [pertanyaan], bisa foto dengan caption .ai atau reply foto.');
          const picture = image ? { buffer: await imageBuffer(image), mimeType: unwrap(image.message).imageMessage.mimetype || 'image.jpeg' } : undefined;
          return await reply(await ai(args, picture));
        }
        case '.ping': {
          if (!group) return await reply('.ping dipakai oleh owner bot di grup.');
          const metadata = await sock.groupMetadata(chat);
          return await send(chat, { text: `🔔 ${args || 'Halo semuanya!'}`, mentions: metadata.participants.map(p => p.id) });
        }
        case '.alert': {
          if (!args) return await reply('Format: .alert [pesan maintenance atau pengumuman].');
          const groups = await sock.groupFetchAllParticipating();
          const targets = Object.keys(groups || {}).filter(jid => jid.endsWith('@g.us'));
          let sentCount = 0;
          for (const target of targets) {
            try {
              await send(target, { text: `📢 *PENGUMUMAN BOT*\n\n${args}\n\n_Pesan ini dikirim oleh bot. Untuk informasi pengirim asli, hubungi owner bot._` });
              sentCount++;
            } catch {}
          }
          return await reply(`Pengumuman terkirim ke ${sentCount} dari ${targets.length} grup.`);
        }
        case '.kirim': {
          const [number, ...message] = args.split(/\s+/);
          const target = normalizeJid(number);
          if (!target.endsWith('@s.whatsapp.net')) return await reply('Isi nomor tujuan yang valid, contoh .kirim 628123456789 halo.');
          let payload = message.join(' ');
          let declaredName = '';
          const identity = payload.match(/\s*\|\s*dari:\s*([^|]+)\s*$/i);
          if (identity) {
            declaredName = identity[1].trim().slice(0, 80);
            payload = payload.slice(0, identity.index).trim();
          }
          const disclaimer = `ℹ️ Pesan berikut dikirim melalui bot. Nomor yang terlihat adalah nomor bot.${declaredName ? ` Pengirim: ${declaredName}.` : ''}`;
          if (quoted.stickerMessage) {
            const buffer = await media({ key: { remoteJid: chat, id: context.stanzaId, participant: context.participant }, message: quoted }, 'buffer', {});
            if (buffer.length > 2 * 1024 * 1024) throw new Error('Stiker terlalu besar.');
            await send(target, { text: disclaimer });
            await send(target, { sticker: buffer });
          } else {
            if (!payload) return await reply('Format: .kirim 628123456789 [pesan] | dari: Nama (opsional), atau reply stiker.');
            await send(target, { text: disclaimer });
            await send(target, { text: payload });
          }
          return await reply('Pesan terkirim.');
        }
      }
    } catch (error) {
      // Do not echo external process diagnostics or request URLs into chats.
      log('error', { ...conversation, command: cmd, err: error }, `Gagal memproses ${cmd}`);
      const safe = /^(Gunakan link|Link tidak valid|Format harus|Teks Brat|Pesan fakechat|Pertanyaan|Gambar maksimal|Stiker terlalu|Fitur AI belum|Ada download|Hasil unduhan|Video tidak tersedia|Video melebihi|Durasi hasil|Durasi video|Format gambar)/.test(error.message);
      await reply(safe ? error.message : `Gagal memproses ${cmd}. Coba lagi sebentar atau hubungi pemilik bot.`);
    } finally { active--; }
  }
  return async (sock, event) => {
    if (event.type !== 'notify') return;
    for (const msg of event.messages || []) {
      try { await handle(sock, msg); } catch (error) { appLog.error({ err: error }, 'Gagal memproses pesan'); }
    }
  };
}

function acquireLock(file = path.join(config.root, '.bot.lock')) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(file, 'wx', 0o600);
      fs.writeFileSync(fd, String(process.pid));
      fs.closeSync(fd);
      return () => { try { if (fs.readFileSync(file, 'utf8') === String(process.pid)) fs.unlinkSync(file); } catch {} };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const pid = Number(fs.readFileSync(file, 'utf8'));
      if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('File .bot.lock tidak valid. Periksa proses bot sebelum menghapus file ini.');
      try { process.kill(pid, 0); } catch (err) {
        if (err.code !== 'ESRCH') throw err;
        fs.unlinkSync(file);
        continue;
      }
      throw new Error(`Bot sudah berjalan (PID ${pid}). Matikan instance lama dulu.`);
    }
  }
  throw new Error('Tidak bisa mengambil lock bot.');
}

async function main() {
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Gunakan Node.js 24 LTS.');
  const release = acquireLock();
  process.once('exit', release);
  // Keep the supported legacy patch pinned; v7 remains a separate RC migration.
  const { default: makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore, DisconnectReason, downloadMediaMessage } = require('@whiskeysockets/baileys');
  const logger = require('./lib/logger').createLogger();
  const waLogger = logger.child({ component: 'wa' }, { level: process.env.LOG_LEVEL || 'warn' });
  const handle = createHandler({ downloadMediaMessage, logger });
  let socket, retry, stopping = false, failures = 0;
  const save = serial();
  async function connect() {
    if (stopping) return;
    if (socket) { socket.ev.removeAllListeners(); socket.end(undefined); }
    // The next socket must load the credentials saved during QR pairing.
    await save(async () => {});
    fs.mkdirSync(config.authDir, { recursive: true, mode: 0o700 });
    const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
    // Use Baileys' bundled protocol version rather than fetching a different one on every reconnect.
    const sock = makeWASocket({ auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, waLogger) }, logger: waLogger });
    socket = sock;
    sock.ev.on('creds.update', () => save(saveCreds).catch(fatal));
    sock.ev.on('messages.upsert', event => { if (socket === sock && !stopping) handle(sock, event).catch(fatal); });
    sock.ev.on('connection.update', update => {
      if (socket !== sock || stopping) return;
      if (update.qr) {
        logger.info('Scan QR: WhatsApp > Perangkat tertaut > Tautkan perangkat.');
        require('qrcode-terminal').generate(update.qr, { small: true });
      }
      if (update.connection === 'open') {
        failures = 0;
        logger.info('WhatsApp tersambung. Bot siap di grup dan chat pribadi. Ketik .help.');
      }
      if (update.connection === 'close') {
        const code = update.lastDisconnect?.error?.output?.statusCode;
        if ([DisconnectReason.loggedOut, DisconnectReason.badSession, DisconnectReason.connectionReplaced, DisconnectReason.multideviceMismatch].includes(code)) {
          logger.error(`Sesi WA perlu diperiksa (kode ${code}). Hentikan instance lain atau tautkan ulang sesuai README.`);
          shutdown(78);
          return;
        }
        const pairingRestart = code === DisconnectReason.restartRequired;
        const delay = pairingRestart ? 1000 : Math.min(60000, 3000 * 2 ** Math.min(failures++, 5));
        logger.warn(pairingRestart
          ? 'WhatsApp meminta restart koneksi setelah pairing (515). Menyambungkan ulang dengan sesi yang tersimpan...'
          : `Koneksi terputus (${code || 'jaringan'}), coba lagi dalam ${delay / 1000} detik.`);
        clearTimeout(retry);
        retry = setTimeout(() => connect().catch(fatal), delay);
      }
    });
  }
  function shutdown(code = 0) {
    if (stopping) return;
    stopping = true;
    clearTimeout(retry);
    if (socket) { socket.ev.removeAllListeners(); socket.end(undefined); }
    // Flush pending auth writes before allowing the supervisor to restart.
    save(async () => {}).finally(() => { release(); process.exit(code); });
    setTimeout(() => process.exit(code), 5000).unref();
  }
  function fatal(error) { logger.fatal({ err: error }, 'Bot berhenti'); shutdown(1); }
  process.once('SIGINT', () => shutdown());
  process.once('SIGTERM', () => shutdown());
  process.once('uncaughtException', fatal);
  process.once('unhandledRejection', fatal);
  await connect();
}

if (require.main === module) main().catch(error => { require('./lib/logger').createLogger().fatal({ err: error }, 'Startup gagal'); process.exitCode = 1; });
module.exports = { createHandler, unwrap, help, acquireLock };
