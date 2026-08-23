const {
  default: makeWASocket,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const pino = require("pino");
const ffmpeg = require("fluent-ffmpeg");
require("dotenv").config();

process.on("unhandledRejection", (err) => {
  console.error("UNHANDLED REJECTION:", err);
});
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});

const sheets = require("./sheets");
const { 
  getGroupSetting, 
  setGroupActive, 
  getAllActiveGroups,
  deleteCompletedTodos,
} = require("./sheets");
const { tanyaAI, prosesPerintahBot, analisisStruk, analisisGambar } = require("./gemini");
const { generateStaticBrat, generateAnimatedBrat } = require("./brat-advanced");
const XLSX = require("xlsx");
const { Sticker, StickerTypes } = require("wa-sticker-formatter");
const Jimp = require("jimp");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

function isTikTokUrl(url) {
  return /tiktok\.com|vt\.tiktok|vm\.tiktok|tiktokv\.com/i.test(url);
}

// Fallback khusus TikTok, dipake kalau yt-dlp gagal (misal lagi ada bug ekstraktor upstream
// kayak "Unable to extract universal data for rehydration"). Pakai API publik tikwm.com buat
// ambil link video tanpa watermark, terus didownload manual — di luar yt-dlp sepenuhnya.
async function downloadTiktokFallback(url, outputPath) {
  const apiRes = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`);
  const json = await apiRes.json();
  if (json.code !== 0 || !json.data) {
    throw new Error(`Fallback API TikTok gagal: ${json.msg || "respons nggak valid dari API"}`);
  }
  const playUrl = json.data.play || json.data.hdplay;
  if (!playUrl) throw new Error("Fallback API TikTok gagal: nggak ada link video di respons.");

  const videoRes = await fetch(playUrl);
  if (!videoRes.ok) throw new Error(`Fallback API TikTok gagal ambil videonya (HTTP ${videoRes.status}).`);
  const buf = Buffer.from(await videoRes.arrayBuffer());
  fs.writeFileSync(outputPath, buf);
}

// Convert video hasil fallback jadi mp3 (dipake kalau user minta format mp3 tapi yt-dlp-nya gagal)
function convertToMp3(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .noVideo()
      .audioCodec("libmp3lame")
      .audioQuality(0)
      .save(outputPath)
      .on("end", resolve)
      .on("error", reject);
  });
}

// Cari yt-dlp: prioritas file di folder project (yt-dlp.exe), fallback ke command global di PATH
function pathYtDlp() {
  // Cari yt-dlp lokal dulu (Windows: yt-dlp.exe, Linux/Mac: yt-dlp), baru fallback ke PATH sistem.
  // Di Arch Linux biasanya udah keinstall global via pacman, jadi fallback "yt-dlp" ini yang kepake.
  const kandidat = [
    path.join(__dirname, "yt-dlp.exe"),
    path.join(__dirname, "yt-dlp"),
  ];
  const lokal = kandidat.find((p) => fs.existsSync(p));
  return lokal ? `"${lokal}"` : "yt-dlp";
}

// Nomor/JID yang boleh pakai FITUR bot (selain /daftarbot & /help). Pisah koma kalau lebih dari satu.
// Kosongkan/hapus baris ALLOWED_NUMBERS di .env kalau mau semua orang yang udah /daftarbot langsung bisa akses.
const ALLOWED_NUMBERS = (process.env.ALLOWED_NUMBERS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// JID pemilik bot, boleh isi lebih dari satu dipisah koma. Ini yang boleh pakai /listuser & /adminhapususer.
const OWNER_NUMBERS = (process.env.OWNER_NUMBERS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function isOwner(sender) {
  return OWNER_NUMBERS.includes(sender);
}

const DUA_JAM_MS = 2 * 60 * 60 * 1000;
const LIMA_BELAS_MENIT_MS = 15 * 60 * 1000;

function formatRupiah(angka) {
  return "Rp" + Number(angka).toLocaleString("id-ID");
}

function parseWaktu(str) {
  const cleaned = str.replace(/jam/gi, "").trim().replace(".", ":").replace(/\s+/g, "");
  const match = cleaned.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const jam = parseInt(match[1], 10);
  const menit = parseInt(match[2], 10);
  if (jam > 23 || menit > 59) return null;
  return `${String(jam).padStart(2, "0")}:${String(menit).padStart(2, "0")}`;
}

function normalisasiNomor(input) {
  let digits = input.replace(/[^0-9]/g, "");
  if (digits.startsWith("0")) digits = "62" + digits.slice(1); // 08xx -> 628xx
  return `${digits}@s.whatsapp.net`;
}

function waktuSekarangJakarta() {
  const now = new Date();
  const jakarta = new Date(now.getTime() + 7 * 60 * 60 * 1000); // UTC+7, pure math, nggak bergantung locale/ICU
  const jam = String(jakarta.getUTCHours()).padStart(2, "0");
  const menit = String(jakarta.getUTCMinutes()).padStart(2, "0");
  return `${jam}:${menit}`;
}

// Jaring pengaman: normalisasi format jam biar "2:47" atau "2.47" tetep ke-treat sama kayak "02:47"
function normalisasiJam(str) {
  if (!str) return "";
  const match = String(str).match(/^(\d{1,2})[.:](\d{2})/);
  if (!match) return str;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function bolehAksesFitur(sender) {
  return ALLOWED_NUMBERS.length === 0 || ALLOWED_NUMBERS.includes(sender);
}

let currentSock = null;
let reconnectTimer = null;
let reminderIntervals = [];

function clearReminderIntervals() {
  for (const id of reminderIntervals) {
    clearInterval(id);
  }
  reminderIntervals = [];
}

async function startBot() {
  if (currentSock) {
    try {
      currentSock.ev.removeAllListeners();
    } catch (_) {}
    try {
      currentSock.end(undefined);
    } catch (_) {}
    currentSock = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  clearReminderIntervals();

  const logger = pino({ level: "silent" });
  const { state, saveCreds } = await useMultiFileAuthState("auth_session");
  const { version } = await fetchLatestBaileysVersion();
  console.log("Pakai versi WhatsApp Web:", version.join("."));

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    logger,
  });

  currentSock = sock;

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    if (sock !== currentSock) return;
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("Scan QR code ini pakai WhatsApp di HP kamu (Linked Devices):");
      require("qrcode-terminal").generate(qr, { small: true });
    }

    if (connection === "close") {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log("Koneksi terputus. Status code:", statusCode);
      console.log("Detail error:", lastDisconnect?.error?.message || lastDisconnect?.error);
      console.log("Reconnect:", shouldReconnect);
      if (shouldReconnect) {
        // 440 = stream errored (conflict). WhatsApp masih nganggap koneksi lama aktif;
        // jangan langsung nyambung ulang — tunggu biar link lama kelepas dulu.
        const delayMs = statusCode === 440 ? 20000 : 5000;
        console.log(`Nyambung ulang dalam ${delayMs / 1000} detik...`);
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(startBot, delayMs);
      }
    } else if (connection === "open") {
      console.log("✅ Bot WhatsApp terkoneksi!");
      sheets.ensureBaseSheets().catch((e) =>
        console.error("Gagal siapin sheet dasar:", e.message)
      );
      mulaiReminderBerkala(sock);
    }
  });

  const botStartTime = Math.floor(Date.now() / 1000);

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (sock !== currentSock) return;
    if (type !== "notify") return;

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      // Abaikan pesan usang yang masuk saat bot mati/reconnect (margin 10 detik sebelum bot start)
      const msgTime = Number(msg.messageTimestamp) || 0;
      if (msgTime > 0 && msgTime < botStartTime - 10) continue;

      const sender = msg.key.remoteJid; // ke sini balesan bot dikirim (personal JID atau grup JID)
        if (sender.endsWith("@newsletter")) return; // abaikan update channel, bukan chat personal

        const isGroup = sender.endsWith("@g.us");
        const authorId = isGroup ? msg.key.participant || sender : sender; // identitas ASLI si pengirim
        const pushName = msg.pushName || null; // nama profil WA, buat fallback tanpa perlu /daftarbot
        const mentionedJid = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];

        // Kadang WA kasih tau "JID alternatif" (nomor asli) di samping @lid, kalau ada kita tangkep
        const nomorAsli = msg.key.remoteJidAlt || msg.key.participantAlt || null;

        // Foto struk: gambar dengan caption /struk
        const caption = msg.message.imageMessage?.caption || "";
        if (msg.message.imageMessage && caption.trim().toLowerCase().startsWith("/struk")) {
          console.log(`[MASUK] ${authorId} -> [foto struk]`);
          try {
            await handleStruk(sock, sender, authorId, msg, isGroup, nomorAsli);
            console.log(`[SELESAI] Struk dari ${authorId} udah diproses.`);
          } catch (err) {
            console.error(`[ERROR] Gagal proses struk dari ${authorId}:`, err);
            await sock.sendMessage(sender, {
              text: "⚠️ Gagal baca struk-nya. Coba foto ulang yang lebih jelas.",
            });
          }
          return;
        }

        // Foto biasa dengan caption /stiker atau /sticker: convert jadi stiker WA
        const captionLower = caption.trim().toLowerCase();
        if (
          msg.message.imageMessage &&
          (captionLower.startsWith("/stiker") || captionLower.startsWith("/sticker"))
        ) {
          console.log(`[MASUK] ${authorId} -> [foto buat stiker]`);
          try {
            await handleStiker(sock, sender, authorId, msg, caption);
            console.log(`[SELESAI] Stiker buat ${authorId} udah dikirim.`);
          } catch (err) {
            console.error(`[ERROR] Gagal bikin stiker buat ${authorId}:`, err);
            await sock.sendMessage(sender, {
              text: "⚠️ Gagal bikin stiker. Coba foto lain.",
            });
          }
          return;
        }

        // Foto dengan caption /ai: analisis gambar pakai AI vision
        if (msg.message.imageMessage && captionLower.startsWith("/ai")) {
          console.log(`[MASUK] ${authorId} -> [foto buat /ai]`);
          try {
            await handleCommand(sock, sender, caption.trim(), nomorAsli, authorId, isGroup, mentionedJid, pushName, null, msg);
            console.log(`[SELESAI] Analisis gambar /ai buat ${authorId} udah dibales.`);
          } catch (err) {
            console.error(`[ERROR] Gagal analisis gambar /ai dari ${authorId}:`, err);
            await sock.sendMessage(sender, {
              text: "⚠️ Gagal analisis gambarnya. Coba lagi ya.",
            });
          }
          return;
        }

      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        "";

    if (!text.startsWith("/")) return; // abaikan pesan non-command

    const cmdUntukLog = text.trim().split(/\s+/)[0].toLowerCase();
    if (cmdUntukLog === "/kirim") {
      console.log(`[MASUK] ${authorId}${isGroup ? " (grup)" : ""} -> /kirim [detail disembunyiin demi privasi]`);
    } else {
      console.log(`[MASUK] ${authorId}${isGroup ? " (grup)" : ""} -> ${text.trim()}`);
    }

    if (pushName) {
      sheets.simpanKontak(authorId, pushName).catch(() => {}); // cache nama, best-effort, jangan blocking
    }

    // Info pesan yang di-reply (dipakai /kirim buat forward stiker)
    const contextInfo = msg.message.extendedTextMessage?.contextInfo || null;
    const quotedInfo = contextInfo?.quotedMessage
      ? {
          message: contextInfo.quotedMessage,
          stanzaId: contextInfo.stanzaId,
          participant: contextInfo.participant,
        }
      : null;

    try {
      await handleCommand(sock, sender, text.trim(), nomorAsli, authorId, isGroup, mentionedJid, pushName, quotedInfo, msg);
      console.log(`[SELESAI] Command dari ${authorId} udah diproses & dibales.`);
    } catch (err) {
      console.error(`[ERROR] Gagal proses command dari ${authorId}:`, err);
      await sock.sendMessage(sender, {
        text: "⚠️ Ada error pas proses command. Coba lagi ya.",
      });
    }
    }
  });
}

async function handleStruk(sock, sender, authorId, msg, isGroup, nomorAsli) {
  if (isGroup) {
    return sock.sendMessage(sender, {
      text: "Fitur struk cuma bisa dipakai di chat pribadi ke bot, bukan di grup.",
    });
  }
  if (!bolehAksesFitur(authorId)) {
    return sock.sendMessage(sender, {
      text: "Kamu belum diaktifin buat pakai fitur bot ini. Minta admin nambahin JID kamu ke akses bot ya.",
    });
  }

  const nama = await sheets.getNamaByJid(authorId, nomorAsli);
  if (!nama) {
    return sock.sendMessage(sender, {
      text: "Kamu belum terdaftar. Daftar dulu ya, contoh: /daftarbot Elbon",
    });
  }

  await sock.sendMessage(sender, { text: "📸 Lagi baca struk-nya, tunggu sebentar..." });

  const buffer = await downloadMediaMessage(msg, "buffer", {});
  const base64Data = buffer.toString("base64");
  const mimeType = msg.message.imageMessage.mimetype || "image/jpeg";

  const hasil = await analisisStruk(base64Data, mimeType);

  if (!hasil.nominal || hasil.nominal <= 0) {
    return sock.sendMessage(sender, {
      text: "⚠️ Nggak berhasil baca nominal dari struk itu. Coba foto ulang yang lebih jelas & terang, atau catat manual pakai /keluar.",
    });
  }

  await sheets.catatTransaksi(nama, "Keluar", hasil.nominal, hasil.keterangan);
  return sock.sendMessage(sender, {
    text: `✅ [${nama}] Struk terbaca & tercatat otomatis:\nKeluar ${formatRupiah(hasil.nominal)} - ${hasil.keterangan}`,
  });
}


async function tambahTeksMeme(buffer, teksAtas, teksBawah) {
  const image = await Jimp.read(buffer);
  image.resize(512, Jimp.AUTO); // normalisasi ukuran biar teks konsisten proporsinya, apapun resolusi asli fotonya

  const width = image.bitmap.width;
  const height = image.bitmap.height;

  const fontPutih = await Jimp.loadFont(Jimp.FONT_SANS_64_WHITE);
  const fontHitam = await Jimp.loadFont(Jimp.FONT_SANS_64_BLACK);

  const offsetOutline = Math.max(2, Math.round(width / 128));

  function cetakTeks(teks, y) {
    if (!teks) return;
    const teksUpper = teks.toUpperCase();
    const opsi = {
      text: teksUpper,
      alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER,
      alignmentY: Jimp.VERTICAL_ALIGN_TOP,
    };
    const arahOutline = [
      [-offsetOutline, -offsetOutline], [offsetOutline, -offsetOutline],
      [-offsetOutline, offsetOutline], [offsetOutline, offsetOutline],
      [0, -offsetOutline], [0, offsetOutline], [-offsetOutline, 0], [offsetOutline, 0],
    ];
    for (const [dx, dy] of arahOutline) {
      image.print(fontHitam, dx, y + dy, opsi, width);
    }
    // cetak putih beberapa kali dioffset kecil biar keliatan lebih tebal/bold
    const arahBold = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dy] of arahBold) {
      image.print(fontPutih, dx, y + dy, opsi, width);
    }
  }

  cetakTeks(teksAtas, Math.round(height * 0.03));
  cetakTeks(teksBawah, Math.round(height * 0.78));

  return image.getBufferAsync(Jimp.MIME_PNG);
}

async function handleStiker(sock, sender, authorId, msg, caption) {
  if (!bolehAksesFitur(authorId)) {
    return sock.sendMessage(sender, {
      text: "Kamu belum diaktifin buat pakai fitur bot ini. Minta admin nambahin JID kamu ke akses bot ya.",
    });
  }

  let buffer = await downloadMediaMessage(msg, "buffer", {});

  // Parsing teks: /stiker teks bawah  ATAU  /stiker teks atas | teks bawah
  const rawTeks = (caption || "").trim().replace(/^\/(stiker|sticker)\s*/i, "");
  if (rawTeks) {
    let teksAtas = "";
    let teksBawah = "";
    if (rawTeks.includes("|")) {
      const [atas, bawah] = rawTeks.split("|");
      teksAtas = (atas || "").trim();
      teksBawah = (bawah || "").trim();
    } else {
      teksBawah = rawTeks.trim();
    }
    buffer = await tambahTeksMeme(buffer, teksAtas, teksBawah);
  }

  const sticker = new Sticker(buffer, {
    pack: "Bot Wangsaff",
    author: "Milik Asyafa Bejir",
    type: StickerTypes.FULL,
    quality: 70,
  });

  const stickerBuffer = await sticker.toBuffer();
  return sock.sendMessage(sender, { sticker: stickerBuffer });
}

async function handleCommand(sock, sender, text, nomorAsli, authorId, isGroup, mentionedJid, pushName, quotedInfo, msg) {
  const [command, ...rest] = text.split(" ");
  const args = rest.join(" ");
  const cmd = command.toLowerCase();

  const ACTIVATION_CMDS = ['/botonline', '/botoffline'];

  // Check group activation FIRST
  if (isGroup && !ACTIVATION_CMDS.includes(cmd)) {
    const groupSetting = await getGroupSetting(sender);
    if (!groupSetting || !groupSetting.isActive) {
      return; // Silent ignore
    }
  }

  if (isGroup && ACTIVATION_CMDS.includes(cmd) && !isOwner(authorId)) {
    return sock.sendMessage(sender, { text: "Command ini cuma buat pemilik bot." });
  }

  // Commands that are NEVER allowed in groups (even when active)
  const TRULY_PERSONAL_ONLY = [
    "/daftarbot", "/deleteuser",
    "/listuser", "/adminhapususer", "/testreminder",
    "/alert",
  ];
  if (isGroup && TRULY_PERSONAL_ONLY.includes(cmd)) {
    return sock.sendMessage(sender, {
      text: "Command ini cuma bisa dipakai di chat pribadi ke bot, bukan di grup.",
    });
  }

  // /daftarbot dan /help bebas diakses siapa aja, tanpa perlu masuk ALLOWED_NUMBERS dulu
  if (cmd === "/daftarbot") {
    const nama = args.trim().replace(/\s+/g, "");
    if (!nama) {
      return sock.sendMessage(sender, {
        text: "Format salah. Contoh: /daftarbot Elbon",
      });
    }
    const hasil = await sheets.daftarUser(authorId, nama, nomorAsli);
    if (hasil.alreadyRegistered) {
      return sock.sendMessage(sender, {
        text: `Kamu udah terdaftar sebagai *${hasil.nama}*.`,
      });
    }

    if (bolehAksesFitur(authorId)) {
      return sock.sendMessage(sender, {
        text: `✅ Berhasil daftar sebagai *${hasil.nama}*! Sheet "Keuangan_${hasil.nama}" dan "Todo_${hasil.nama}" udah otomatis dibikin. Ketik /help buat lihat command.`,
      });
    }

    return sock.sendMessage(sender, {
      text:
        `✅ Berhasil daftar sebagai *${hasil.nama}*, sheet kamu udah otomatis dibikin.\n\n` +
        `Tapi fitur bot (catat uang, todo, dll) masih butuh di-aktifin admin dulu. ` +
        `Minta admin nambahin JID kamu ke akses bot ya (JID kamu udah otomatis kesimpen di sheet "Users").`,
    });
  }

  if (cmd === "/help") {
      const bagianAdmin = isOwner(authorId)
        ? `\n\n*Admin (khusus pemilik bot)*\n` +
          `*/listuser* — lihat semua user terdaftar (hanya chat pribadi)\n` +
          `*/adminhapususer [nama]* — hapus akun user manapun (hanya chat pribadi)\n` +
          `*/testreminder* — tes kirim reminder sekarang juga (hanya chat pribadi)\n` +
          `*/ping [text]* — tag semua member grup (hanya di grup)\n` +
          `*/alert [text]* — kirim info ke semua user & grup aktif\n` +
          `*/botonline* — aktifkan bot di grup ini (hanya di grup)\n` +
          `*/botoffline* — nonaktifkan bot di grup ini (hanya di grup)\n` +
          `*/allreminder [on/off]* — nyalain/matiin reminder buat semua user sekaligus, tanpa argumen buat cek status\n`
        : "";

    const bagianPersonal = isGroup
      ? ""
      : `*1.) Akun*\n` +
        `*/daftarbot [nama]* — wajib kalau mau pakai bot\n` +
        `*/deleteuser* — hapus akun kamu dari bot\n\n` +
        `*2.) Keuangan*\n` +
        `*/masuk [nominal] [ket]* — catat pemasukan\n` +
        `*/keluar [nominal] [ket]* — catat pengeluaran\n` +
        `*/rekap* — rekap keuangan kamu hari ini\n` +
        `*/riwayat [jumlah]* — lihat transaksi terakhir (default 10)\n` +
        `*/unduhrekap* — download excel data kamu\n` +
        `*/struk* — foto struk/nota pembelian (otomatis tercatat)\n\n` +
        `*3.) To-Do List*\n` +
        `*/todo [tugas]* — tambah tugas\n` +
        `*/listtodo* — lihat to-do hari ini\n` +
        `*/done [nomor]* — tandai tugas selesai\n\n`;

    const catatanGrup = isGroup
      ? `_Command Akun/Keuangan/To-Do/Admin cuma bisa dipake di chat pribadi ke bot._\n\n`
      : "";

    const contohAI = isGroup
      ? `Contoh: "/ai bikinin caption lucu buat foto ini"\n` +
        `Contoh: "/ai bot ini dibuat pakai apa aja?"\n`
      : `Contoh: "/ai catat keluar 15000 buat makan siang"\n` +
        `Contoh: "/ai gimana rekapku hari ini?"\n` +
        `Contoh: "/ai tambahin todo beli galon"\n`;

    return sock.sendMessage(sender, {
      text:
        `Daftar Command Bot\n\n` +
        bagianPersonal +
        `*4.) Reminder & Alarm*\n` +
        `*/reminder [on/off]* — nyala/matiin reminder kamu\n` +
        `*/reminder* — cek status reminder kamu\n` +
        `*/alarm [jam] [pesan]* — set alarm, _contoh: /alarm 20:20 mau coding_\n` +
        `*/stopalarm* — matiin alarm yang lagi bunyi\n` +
        `*/listalarm — lihat alarm aktif kamu\n` +
        `*/hapusalarm [nomor] — hapus alarm\n\n` +
        `*5.) Media*\n` +
        `*/stiker* - ubah foto jadi stiker\n` +
        `*/stiker [text]* - ubah foto jadi stiker dengan text\n` +
        `*/stiker [text atas]|[text bawah]* - ubah foto jadi stiker dengan text atas bawah\n` +
        `*/download [link] [format]* — download video/audio youtube/tiktok (format: mp4/mp3, max 60mb)\n` +
        `_(contoh: /download https://tiktok..... mp4)_\n\n` +
        `*6.) Utilitas*\n` +
        `*/kirim [nomor] [pesan]* — kirim pesan lewat bot ke nomor lain\n` +
        `*reply stiker + /kirim [nomor]* — kirim stiker itu ke nomor lain\n` +
        `*/brat [teks]* — bikin stiker brat\n` +
        `*/bratvid [teks]* — bikin stiker brat bergerak\n\n` +
        `*7.) AI Assistant*\n` +
        `*/ai [perintah/pertanyaan]* — suruh/tanya bot\n` +
        `_contoh: "/ai gimana rekapku hari ini?"_\n` +
        `_contoh: "/ai ibu kota indonesia apa?"_\n\n` +
        catatanGrup +
        bagianAdmin +
        `\n/help — tampilkan pesan ini`,
    });
  }

  if (cmd === "/botonline") {
    if (!isGroup) return sock.sendMessage(sender, { text: "Command ini cuma buat grup." });
    if (!isOwner(authorId)) return sock.sendMessage(sender, { text: "Cuma pemilik bot." });

    const metadata = await sock.groupMetadata(sender).catch(() => null);
    const groupName = metadata?.subject || 'Unknown';

    await setGroupActive(sender, groupName, authorId, true);
    return sock.sendMessage(sender, { text: `✅ Bot diaktifkan di grup *${groupName}*. Sekarang bisa pakai command & terima /alert.` });
  }

  if (cmd === "/botoffline") {
    if (!isGroup) return sock.sendMessage(sender, { text: "Command ini cuma buat grup." });
    if (!isOwner(authorId)) return sock.sendMessage(sender, { text: "Cuma pemilik bot." });

    const metadata = await sock.groupMetadata(sender).catch(() => null);
    const groupName = metadata?.subject || 'Unknown';

    await setGroupActive(sender, groupName, authorId, false);
    return sock.sendMessage(sender, { text: `⛔ Bot dinonaktifkan di grup *${groupName}*. Command & /alert tidak diproses.` });
  }

  // Reminder buat semua user sekaligus (admin only)
  if (cmd === "/allreminder") {
    if (!isOwner(authorId)) return sock.sendMessage(sender, { text: "Command ini cuma buat pemilik bot." });
    const sub = (args || "").trim().toLowerCase();

    if (sub === "on") {
      const jumlah = await sheets.setAllUsersReminderStatus(true);
      return sock.sendMessage(sender, { text: `✅ Reminder dinyalain buat ${jumlah} user.` });
    }

    if (sub === "off") {
      const jumlah = await sheets.setAllUsersReminderStatus(false);
      return sock.sendMessage(sender, { text: `⛔ Reminder dimatiin buat ${jumlah} user.` });
    }

    const users = await sheets.getAllUsers();
    const nyala = users.filter((u) => u.reminderAktif).length;
    return sock.sendMessage(sender, {
      text: `Status reminder: ${nyala}/${users.length} user lagi nyala.\nKetik /allreminder on atau /allreminder off buat ubah semua sekaligus.`,
    });
  }

  // command lain butuh: (1) diizinkan admin, (2) udah daftar
  if (!bolehAksesFitur(authorId)) {
    return sock.sendMessage(sender, {
      text: "Kamu belum diaktifin buat pakai fitur bot ini. Minta admin nambahin JID kamu ke akses bot ya.",
    });
  }

  const nama = await sheets.getNamaByJid(authorId, nomorAsli);
  if (!nama) {
    return sock.sendMessage(sender, {
      text: "Kamu belum terdaftar. Daftar dulu ya, contoh: /daftarbot Elbon",
    });
  }

  switch (cmd) {
    case "/masuk":
    case "/keluar": {
      const jenis = cmd === "/masuk" ? "Masuk" : "Keluar";
      const [nominalStr, ...ketArr] = args.split(" ");
      const nominal = parseInt(nominalStr, 10);
      const keterangan = ketArr.join(" ") || "-";

      if (!nominal || isNaN(nominal)) {
        return sock.sendMessage(sender, {
          text: `Format salah. Contoh: ${cmd} 15000 makan siang`,
        });
      }

      await sheets.catatTransaksi(nama, jenis, nominal, keterangan);
      return sock.sendMessage(sender, {
        text: `✅ [${nama}] Tercatat: ${jenis} ${formatRupiah(nominal)} - ${keterangan}`,
      });
    }

    case "/rekap": {
      const rekap = await sheets.rekapHariIni(nama);
      return sock.sendMessage(sender, {
        text:
          `📊 *Rekap Hari Ini - ${nama}*\n` +
          `Masuk: ${formatRupiah(rekap.totalMasuk)}\n` +
          `Keluar: ${formatRupiah(rekap.totalKeluar)}\n` +
          `Saldo: ${formatRupiah(rekap.saldo)}`,
      });
    }

    case "/download": {
      const parts = args.trim().split(/\s+/);
      if (parts.length < 1) {
        return sock.sendMessage(sender, {
          text: "Format: /download [link] [format]\nContoh: /download https://youtu.be/xyz mp3\nContoh: /download https://youtu.be/xyz mp4\nKalau format dikosongin, default mp4.\n\nBisa dari YouTube, TikTok, dan source lain yang didukung yt-dlp.",
        });
      }

      const url = parts[0];
      if (!/^https?:\/\//.test(url)) {
        return sock.sendMessage(sender, {
          text: "Format: /download [link] [format]\nContoh: /download https://youtu.be/xyz mp3\n\nCatatan: pastiin konten yang kamu download itu boleh diunduh (video sendiri, Creative Commons, atau diizinin creator-nya).",
        });
      }

      let format = parts[1]?.toLowerCase() || "mp4";
      if (format !== "mp3" && format !== "mp4") {
        format = "mp4";
      }

      const statusText = format === "mp3"
        ? "Lagi download & convert ke MP3, tunggu bentar..."
        : "Lagi download videonya, tunggu bentar... (maks 60MB ya, karena keterbatasan WA)";

      await sock.sendMessage(sender, { text: statusText });

      const tempDir = path.join(__dirname, "temp");
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
      const prefix = format === "mp3" ? "audio" : "video";
      const ext = format;
      const outputPath = path.join(tempDir, `${prefix}_${Date.now()}.${ext}`);

      let usedFallback = false;

      try {
        try {
          if (format === "mp3") {
            await new Promise((resolve, reject) => {
              exec(
                `${pathYtDlp()} -x --audio-format mp3 --extract-audio --audio-quality 0 --impersonate chrome -o "${outputPath}" "${url}"`,
                { maxBuffer: 1024 * 1024 * 100 },
                (err, stdout, stderr) => {
                  if (err) {
                    console.error("[DOWNLOAD MP3] stderr:", stderr);
                    reject(new Error(`${err.message} | stderr: ${stderr}`));
                  } else {
                    resolve();
                  }
                }
              );
            });
          } else {
            await new Promise((resolve, reject) => {
              exec(
                `${pathYtDlp()} -f "best[ext=mp4]/best" --max-filesize 60M --impersonate chrome -o "${outputPath}" "${url}"`,
                { maxBuffer: 1024 * 1024 * 50 },
                (err, stdout, stderr) => {
                  if (err) {
                    console.error("[DOWNLOAD MP4] stderr:", stderr);
                    reject(new Error(`${err.message} | stderr: ${stderr}`));
                  } else {
                    resolve();
                  }
                }
              );
            });
          }
        } catch (ytDlpErr) {
          if (!isTikTokUrl(url)) throw ytDlpErr;

          // yt-dlp gagal & ini link TikTok -> coba fallback API, bukan langsung nyerah
          console.log(`[DOWNLOAD] yt-dlp gagal buat TikTok (${ytDlpErr.message}), coba fallback API...`);
          try {
            if (format === "mp3") {
              const tempVideoPath = path.join(tempDir, `tiktok_tmp_${Date.now()}.mp4`);
              await downloadTiktokFallback(url, tempVideoPath);
              await convertToMp3(tempVideoPath, outputPath);
              fs.unlinkSync(tempVideoPath);
            } else {
              await downloadTiktokFallback(url, outputPath);
            }
            usedFallback = true;
          } catch (fallbackErr) {
            throw new Error(`yt-dlp gagal (${ytDlpErr.message}); fallback API juga gagal (${fallbackErr.message})`);
          }
        }

        const files = fs.readdirSync(tempDir).filter((f) => f.startsWith(prefix));
        const finalFile = files.find((f) => f.endsWith(`.${ext}`));
        if (!finalFile) {
          const fallback = files[0];
          if (fallback) {
            const fallbackPath = path.join(tempDir, fallback);
            const buf = fs.readFileSync(fallbackPath);
            await sock.sendMessage(sender, {
              [format === "mp3" ? "audio" : "video"]: buf,
              mimetype: format === "mp3" ? "audio/mpeg" : undefined,
              caption: format === "mp3" ? "Nih audionya" : "Nih videonya",
            });
            fs.unlinkSync(fallbackPath);
            return;
          }
          return sock.sendMessage(sender, {
            text: "Gagal download, kemungkinan konten nggak tersedia atau link nggak valid.",
          });
        }

        const finalPath = path.join(tempDir, finalFile);
        const sumberNote = usedFallback ? " (via fallback API)" : "";
        if (format === "mp3") {
          const audioBuffer = fs.readFileSync(finalPath);
          await sock.sendMessage(sender, {
            audio: audioBuffer,
            mimetype: "audio/mpeg",
            caption: `Nih audionya${sumberNote}`,
          });
        } else {
          const videoBuffer = fs.readFileSync(finalPath);
          await sock.sendMessage(sender, { video: videoBuffer, caption: `Nih videonya${sumberNote}` });
        }
        fs.unlinkSync(finalPath);
      } catch (e) {
        const extraHelp = format === "mp3"
          ? "\n\nCatatan: download MP3 butuh ffmpeg di server bot. Kalau belum keinstall, cek README buat cara install-nya."
          : "";
        const isImpersonationIssue = !isTikTokUrl(url) && /impersonat|universal data|rehydration/i.test(e.message);
        const impersonationHelp = isImpersonationIssue
          ? "\n\nKemungkinan besar ini masalah yang butuh 'impersonation' (niru fingerprint browser) buat yt-dlp bisa akses halamannya. Coba: (1) install curl_cffi di server bot, (2) update yt-dlp ke versi terbaru (`yt-dlp -U`)."
          : "";
        const tiktokFallbackHelp = isTikTokUrl(url)
          ? "\n\nUdah dicoba lewat fallback API TikTok juga tapi tetep gagal — kemungkinan videonya private/dihapus, atau API fallback-nya lagi down."
          : "";

        return sock.sendMessage(sender, {
          text: `Gagal download: ${e.message}\n\nPastiin "yt-dlp" udah keinstall di komputer bot ya (cek README).${extraHelp}${impersonationHelp}${tiktokFallbackHelp}`,
        });
      }
      return;
    }

    case "/brat":
    case "/bratvid": {
      if (!bolehAksesFitur(authorId)) {
        return sock.sendMessage(sender, {
          text: "Kamu belum diaktifin buat pakai fitur bot ini. Minta admin nambahin JID kamu ke akses bot ya.",
        });
      }

      const isVideo = cmd === "/bratvid";
      const teks = args.trim();
      const cmdLabel = isVideo ? "/bratvid (animasi)" : "/brat (statis)";
      const formatMsg = isVideo
        ? "Format: /bratvid [teks]\nContoh: /bratvid gue nggak mau\n\nStiker animasi kata per kata."
        : "Format: /brat [teks]\nContoh: /brat gue nggak mau\n\nStiker background putih, teks hitam, font Arial Narrow, auto‑scaling, blur 8.4px.";

      if (!teks) {
        return sock.sendMessage(sender, { text: formatMsg });
      }

      await sock.sendMessage(sender, { text: `Lagi bikin stiker ${cmdLabel}...` });

      try {
        const webpBuffer = isVideo
          ? await generateAnimatedBrat(teks)
          : await generateStaticBrat(teks);

        const sticker = new Sticker(webpBuffer, {
          pack: "Bot Wangsaff",
          author: "Bot by ©raiasy-bot 2026",
          type: StickerTypes.FULL,
          quality: 90,
        });
        const stickerBuffer = await sticker.toBuffer();
        await sock.sendMessage(sender, { sticker: stickerBuffer });
      } catch (e) {
        console.error(`[BRAT${isVideo ? "VID" : ""}] Error:`, e);
        await sock.sendMessage(sender, {
          text: `Gagal bikin stiker ${cmdLabel}. Coba lagi ya.`,
        });
      }
      return;
    }

    case "/kirim": {
      // Kalau ini balesan (reply) ke sebuah stiker: forward stiker itu ke nomor tujuan
      if (quotedInfo?.message?.stickerMessage) {
        const nomorTarget = args.trim().split(/\s+/)[0];
        if (!nomorTarget) {
          return sock.sendMessage(sender, {
            text: "Format: reply stiker yang mau dikirim, terus ketik /kirim [nomor]",
          });
        }
        const targetJid = normalisasiNomor(nomorTarget);
        try {
          const quotedMsgObj = {
            key: {
              remoteJid: sender,
              id: quotedInfo.stanzaId,
              participant: quotedInfo.participant,
            },
            message: quotedInfo.message,
          };
          const stickerBuffer = await downloadMediaMessage(quotedMsgObj, "buffer", {});
          await sock.sendMessage(targetJid, { sticker: stickerBuffer });
          return sock.sendMessage(sender, {
            text: `Stiker terkirim ke ${nomorTarget}.\n\nCatatan: ini tetep kekirim dari nomor bot ini, bukan bener-bener nggak bisa dilacak.`,
          });
        } catch (e) {
          return sock.sendMessage(sender, { text: `Gagal kirim stiker: ${e.message}` });
        }
      }

      // Format teks biasa
      const [nomorRaw, ...pesanArr] = args.split(" ");
      const pesanKirim = pesanArr.join(" ");
      if (!nomorRaw || !pesanKirim) {
        return sock.sendMessage(sender, {
          text:
            "Format: /kirim [nomor] [pesan]\nContoh: /kirim 628123456789 halo, apa kabar?\n\n" +
            "Atau reply sebuah stiker terus ketik /kirim [nomor] buat forward stiker itu.",
        });
      }
      const targetJid = normalisasiNomor(nomorRaw);
      try {
        await sock.sendMessage(targetJid, { text: pesanKirim });
        return sock.sendMessage(sender, {
          text: `Pesan terkirim ke ${nomorRaw}.\n\nCatatan: ini tetep kekirim dari nomor bot ini, bukan bener-bener nggak bisa dilacak — pastiin dipake buat orang yang emang nyaman dihubungin ya.`,
        });
      } catch (e) {
        return sock.sendMessage(sender, { text: `Gagal kirim: ${e.message}` });
      }
    }

    case "/alarm": {
      const match = args.match(/(\d{1,2}[.:]\d{2})/);
      if (!match) {
        return sock.sendMessage(sender, {
          text: 'Format: /alarm [jam] [pesan]\nContoh: /alarm 20:20 mau coding',
        });
      }
      const waktu = parseWaktu(match[1]);
      if (!waktu) {
        return sock.sendMessage(sender, {
          text: "Jamnya nggak valid, pakai format 00:00 - 23:59 ya.",
        });
      }
      const pesan = args.slice(match.index + match[0].length).trim() || "Alarm!";
      await sheets.tambahAlarm(nama, waktu, pesan);
      return sock.sendMessage(sender, {
        text: `Oke, alarm diset jam ${waktu}: "${pesan}"`,
      });
    }

    case "/stopalarm": {
      const dihentikan = await sheets.stopAlarmBerbunyi(nama);
      if (dihentikan.length === 0) {
        return sock.sendMessage(sender, { text: "Nggak ada alarm yang lagi bunyi." });
      }
      const list = dihentikan.map((a) => `- ${a.pesan}`).join("\n");
      return sock.sendMessage(sender, { text: `Oke, alarm dimatiin:\n${list}` });
    }

    case "/listalarm": {
      const aktif = await sheets.getAlarmUser(nama);
      if (aktif.length === 0) {
        return sock.sendMessage(sender, { text: "Belum ada alarm aktif." });
      }
      const list = aktif.map((a, i) => `${i + 1}. ${a.waktu} - ${a.pesan}`).join("\n");
      return sock.sendMessage(sender, { text: `Alarm aktif kamu:\n${list}` });
    }

    case "/hapusalarm": {
      const nomor = parseInt(args, 10);
      if (!nomor) {
        return sock.sendMessage(sender, { text: "Format: /hapusalarm [nomor]" });
      }
      const berhasil = await sheets.hapusAlarm(nama, nomor);
      return sock.sendMessage(sender, {
        text: berhasil ? "Alarm dihapus." : "Nomor alarm nggak ketemu, cek /listalarm dulu.",
      });
    }

    case "/todo": {
      if (!args) {
        return sock.sendMessage(sender, {
          text: "Format salah. Contoh: /todo beli galon",
        });
      }
      await sheets.tambahTodo(nama, args);
      return sock.sendMessage(sender, {
        text: `✅ [${nama}] To-do ditambahkan: ${args}`,
      });
    }

    case "/listtodo": {
      // Hapus todo yang sudah Done sebelum menampilkan
      await sheets.deleteCompletedTodos(nama);
      const todos = await sheets.getTodoHariIni(nama);
      if (todos.length === 0) {
        return sock.sendMessage(sender, {
          text: "Belum ada to-do hari ini. Tambah pakai /todo [task]",
        });
      }
      const list = todos
        .map(
          (t, i) =>
            `${i + 1}. ${t.status === "Done" ? "✅" : "⬜"} ${t.task}`
        )
        .join("\n");
      return sock.sendMessage(sender, {
        text: `📝 *To-do Hari Ini - ${nama}*\n${list}\n\nBalas /done [nomor] buat tandain selesai.`,
      });
    }

    case "/done": {
      const nomor = parseInt(args, 10);
      if (!nomor) {
        return sock.sendMessage(sender, {
          text: "Format salah. Contoh: /done 1",
        });
      }
      const target = await sheets.tandaiSelesai(nama, nomor);
      if (!target) {
        return sock.sendMessage(sender, {
          text: "Nomor to-do nggak ketemu. Cek lagi pakai /listtodo",
        });
      }
      return sock.sendMessage(sender, {
        text: `✅ Selesai: ${target.task}`,
      });
    }

    case "/ai": {
      // Handle image + /ai caption
      if (msg?.message?.imageMessage) {
        const buffer = await downloadMediaMessage(msg, "buffer", {});
        const base64 = buffer.toString("base64");
        const mime = msg.message.imageMessage.mimetype || "image/jpeg";
        const prompt = args.trim() || "";
        const hasil = await analisisGambar(base64, mime, prompt);
        return sock.sendMessage(sender, { text: `🤖 ${hasil}` });
      }

      if (!args) {
        return sock.sendMessage(sender, {
          text: 'Contoh: "/ai catet keluar 15000 buat makan siang" atau "/ai gimana rekapku hari ini"',
        });
      }

      // fungsi-fungsi ini yang boleh dipanggil Gemini, di-scope ke user yang lagi chat
      const executors = {
        catat_transaksi: async ({ jenis, nominal, keterangan }) => {
          const hasil = await sheets.catatTransaksi(nama, jenis, nominal, keterangan);
          return { status: "sukses", ...hasil };
        },
        tambah_todo: async ({ task }) => {
          await sheets.tambahTodo(nama, task);
          return { status: "sukses", task };
        },
        tandai_todo_selesai: async ({ nomor }) => {
          const target = await sheets.tandaiSelesai(nama, nomor);
          if (!target) return { status: "gagal", pesan: "nomor to-do tidak ditemukan" };
          return { status: "sukses", task: target.task };
        },
        get_rekap_keuangan: async () => {
          return await sheets.rekapHariIni(nama);
        },
        get_daftar_todo: async () => {
          const todos = await sheets.getTodoHariIni(nama);
          return { todos };
        },
      };

      const hasil = await prosesPerintahBot(args, executors, authorId);
      return sock.sendMessage(sender, { text: `🤖 ${hasil.text}` });
    }

    case "/unduhrekap": {
      const data = await sheets.ambilDataUntukExport(nama);

      const workbook = XLSX.utils.book_new();
      const sheetKeuangan = XLSX.utils.aoa_to_sheet(
        data.keuangan.length > 0
          ? data.keuangan
          : [["Tanggal", "Jenis", "Nominal", "Keterangan"]]
      );
      const sheetTodo = XLSX.utils.aoa_to_sheet(
        data.todo.length > 0 ? data.todo : [["Tanggal", "Task", "Status"]]
      );
      XLSX.utils.book_append_sheet(workbook, sheetKeuangan, "Keuangan");
      XLSX.utils.book_append_sheet(workbook, sheetTodo, "Todo");

      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

      return sock.sendMessage(sender, {
        document: buffer,
        fileName: `Rekap_${nama}.xlsx`,
        mimetype:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        caption: `📄 Rekap keuangan & to-do milik ${nama}`,
      });
    }

    case "/listuser": {
      if (!isOwner(authorId)) {
        return sock.sendMessage(sender, {
          text: "Command ini cuma buat pemilik bot.",
        });
      }
      const users = await sheets.getAllUsers();
      if (users.length === 0) {
        return sock.sendMessage(sender, { text: "Belum ada user yang daftar." });
      }
      const daftar = users
        .map(
          (u, i) =>
            `${i + 1}. *${u.nama}*\n   JID: ${u.jid}\n   No. WA: ${u.nomorWA || "tidak diketahui (privasi @lid)"}\n   Daftar: ${u.tanggalDaftar || "-"}`
        )
        .join("\n\n");
      return sock.sendMessage(sender, {
        text: `👥 *Daftar User Terdaftar (${users.length})*\n\n${daftar}`,
      });
    }

    case "/adminhapususer": {
      if (!isOwner(authorId)) {
        return sock.sendMessage(sender, {
          text: "Command ini cuma buat pemilik bot.",
        });
      }
      if (!args.trim()) {
        return sock.sendMessage(sender, {
          text: "Format: /adminhapususer [nama]. Cek nama-nama user lewat /listuser dulu.",
        });
      }
      const hasilHapus = await sheets.hapusUserByNama(args.trim());
      if (!hasilHapus.berhasil) {
        return sock.sendMessage(sender, {
          text: `User "${args.trim()}" nggak ketemu. Cek /listuser buat lihat nama yang bener.`,
        });
      }
      return sock.sendMessage(sender, {
        text: `✅ User *${hasilHapus.nama}* dan semua sheet-nya udah dihapus admin.`,
      });
    }

    case "/deleteuser": {
      if (args.trim().toLowerCase() !== "yakin") {
        return sock.sendMessage(sender, {
          text:
            `⚠️ Ini bakal HAPUS PERMANEN sheet dan semua data kamu (*${nama}*): ` +
            `sheet "Keuangan_${nama}", "Todo_${nama}", dan data kamu di sheet "Users".\n\n` +
            `Kalau yakin, ketik: /deleteuser yakin`,
        });
      }

      const hasil = await sheets.hapusUser(authorId);
      if (!hasil.berhasil) {
        return sock.sendMessage(sender, {
          text: "Gagal hapus akun, coba lagi ya.",
        });
      }
      return sock.sendMessage(sender, {
        text: `✅ Akun *${hasil.nama}* dan semua sheet-nya udah dihapus. Kalau mau pakai bot lagi, /daftarbot dulu ya.`,
      });
    }

    case "/reminder": {
      const mode = args.trim().toLowerCase();
      if (mode === "on") {
        await sheets.setReminderUser(authorId, true);
        return sock.sendMessage(sender, {
          text: "Reminder kamu dinyalain (rekap tiap 2 jam, todo tiap 15 menit).",
        });
      }
      if (mode === "off") {
        await sheets.setReminderUser(authorId, false);
        return sock.sendMessage(sender, {
          text: "Reminder kamu dimatiin. Ketik /reminder on kapan aja buat nyalain lagi.",
        });
      }
      const users = await sheets.getAllUsers();
      const me = users.find((u) => u.jid === authorId);
      return sock.sendMessage(sender, {
        text: `Status reminder kamu: ${me?.reminderAktif ? "NYALA" : "MATI"}\nKetik /reminder on atau /reminder off buat ganti.`,
      });
    }

    case "/testreminder": {
      if (!isOwner(authorId)) {
        return sock.sendMessage(sender, {
          text: "Command ini cuma buat pemilik bot.",
        });
      }
      await sock.sendMessage(sender, {
        text: "Ngetes kirim reminder sekarang juga (nggak nunggu interval)...",
      });
      await kirimRekapBerkala(sock);
      await kirimReminderTodo(sock);
      return sock.sendMessage(sender, { text: "Test reminder selesai, cek pesan di atas." });
    }

    case "/ping": {
      if (!isOwner(authorId)) {
        return sock.sendMessage(sender, { text: "Command ini cuma buat pemilik bot." });
      }
      if (!isGroup) {
        return sock.sendMessage(sender, {
          text: "Command /ping cuma bisa dipakai di grup, untuk tag semua member grup.",
        });
      }

      const pesan = args.trim();
      if (!pesan) {
        return sock.sendMessage(sender, {
          text: "Format: /ping [text]\nContoh: /ping makan siang di kantin ya\n\nBot akan tag semua member grup dengan text yang kamu kasih.",
        });
      }

      const metadata = await sock.groupMetadata(sender).catch(() => null);
      if (!metadata) {
        return sock.sendMessage(sender, { text: "Gagal ambil data grup ini." });
      }
      const participantJids = metadata.participants.map((p) => p.id);
      return sock.sendMessage(sender, {
        text: `🔔 ${pesan}`,
        mentions: participantJids,
      });
    }

    case "/alert": {
      if (!isOwner(authorId)) {
        return sock.sendMessage(sender, { text: "Command ini cuma buat pemilik bot." });
      }

      const pesanAlert = args.trim();
      if (!pesanAlert) {
        return sock.sendMessage(sender, {
          text: "Format: /alert [text]\nContoh: /alert ada maintenance jam 2 malam",
        });
      }

      const teksAlert = `⚠️ *Alert dari admin*:\n\n${pesanAlert}`;

      const users = await sheets.getAllUsers();
      let kirimKeUser = 0;
      let kirimKeGrup = 0;

      // 1. Fetch all groups ONCE, build Set of ALL participant JIDs
      const semuaGrup = await sock.groupFetchAllParticipating();
      const allGroupJids = new Set();
      for (const grup of Object.values(semuaGrup)) {
        for (const p of grup.participants) {
          allGroupJids.add(p.id);
        }
      }

      // 2. Send to DB users NOT in any group (private only)
      for (const user of users) {
        if (!allGroupJids.has(user.jid)) {
          try {
            await sock.sendMessage(user.jid, { text: teksAlert });
            kirimKeUser++;
          } catch (e) {
            console.error(`[ALERT] Gagal kirim ke ${user.jid}: ${e.message}`);
          }
        }
      }

      // 3. Send to ACTIVE groups only (with mentions)
      for (const grup of Object.values(semuaGrup)) {
        const groupSetting = await getGroupSetting(grup.id);
        if (!groupSetting || !groupSetting.isActive) continue;

        const participantJids = grup.participants.map(p => p.id);
        try {
          await sock.sendMessage(grup.id, { text: teksAlert, mentions: participantJids });
          kirimKeGrup++;
        } catch (e) {
          console.error(`[ALERT] Gagal kirim ke grup ${grup.id}: ${e.message}`);
        }
      }

      return sock.sendMessage(sender, {
        text: `Alert terkirim:\n${kirimKeUser} user (private)\n${kirimKeGrup} grup aktif`,
      });
    }

    case "/riwayat": {
      const jumlah = parseInt(args, 10) || 10;
      const riwayat = await sheets.ambilRiwayat(nama, jumlah);
      if (riwayat.length === 0) {
        return sock.sendMessage(sender, {
          text: "Belum ada transaksi tercatat.",
        });
      }
      const list = riwayat
        .map(([tanggal, jenis, nominal, keterangan]) => {
          const tanda = jenis === "Masuk" ? "+" : "-";
          return `${tanggal} | ${tanda}${formatRupiah(nominal)} - ${keterangan}`;
        })
        .join("\n");
      return sock.sendMessage(sender, {
        text: `Riwayat ${riwayat.length} transaksi terakhir - ${nama}\n\n${list}`,
      });
    }

    default:
      return sock.sendMessage(sender, {
        text: "Command nggak dikenal. Ketik /help buat lihat daftar command.",
      });
  }
}

// ==================== REMINDER BERKALA ====================

async function targetReminderUsers() {
  const users = await sheets.getAllUsers();
  const scopedUsers =
    ALLOWED_NUMBERS.length > 0
      ? users.filter((u) => ALLOWED_NUMBERS.includes(u.jid))
      : users;
  return scopedUsers.filter((u) => u.reminderAktif);
}

async function kirimRekapBerkala(sock) {
  try {
    const users = await targetReminderUsers();
    console.log(`[REMINDER] Kirim rekap berkala ke ${users.length} user (yang reminder-nya nyala)...`);
    for (const user of users) {
      const rekap = await sheets.rekapHariIni(user.nama);
      await sock.sendMessage(user.jid, {
        text:
          `Rekap Keuangan Berkala - ${user.nama}\n` +
          `Masuk: ${formatRupiah(rekap.totalMasuk)}\n` +
          `Keluar: ${formatRupiah(rekap.totalKeluar)}\n` +
          `Saldo: ${formatRupiah(rekap.saldo)}`,
      });
      console.log(`[REMINDER] Rekap berkala terkirim ke ${user.nama} (${user.jid})`);
    }
  } catch (e) {
    console.error("[REMINDER] Gagal kirim rekap berkala:", e.message);
  }
}

async function kirimReminderTodo(sock) {
  try {
    const users = await targetReminderUsers();
    console.log(`[REMINDER] Cek to-do pending buat ${users.length} user (yang reminder-nya nyala)...`);
    for (const user of users) {
      const todos = await sheets.getTodoHariIni(user.nama);
      const pending = todos.filter((t) => t.status !== "Done");
      if (pending.length === 0) {
        console.log(`[REMINDER] ${user.nama} nggak ada todo pending, skip.`);
        continue;
      }

      const list = pending.map((t, i) => `${i + 1}. ${t.task}`).join("\n");
      await sock.sendMessage(user.jid, {
        text: `Reminder To-do - ${user.nama}\n${list}`,
      });
      console.log(`[REMINDER] Reminder todo terkirim ke ${user.nama} (${user.jid})`);
    }
  } catch (e) {
    console.error("[REMINDER] Gagal kirim reminder todo:", e.message);
  }
}

async function cekAlarmBerkala(sock) {
  // Alarm tidak dipengaruhi oleh global reminder status (alarm is user-specific)
  try {
    const now = waktuSekarangJakarta();
    const alarms = await sheets.getAlarmPerluDicek();
    if (alarms.length > 0) {
      console.log(
        `[ALARM] Cek jam ${now}, ${alarms.length} alarm dipantau: ${alarms
          .map((a) => `${a.waktu}(${a.status})`)
          .join(", ")}`
      );
    }

    for (const alarm of alarms) {
      if (alarm.status === "Aktif" && normalisasiJam(alarm.waktu) === now) {
        // waktunya baru kena, mulai bunyiin
        await sock.sendMessage(alarm.jid, {
          text: `Alarm: ${alarm.pesan}\n\nBalas /stopalarm buat matiin, kalau nggak bakal terus ngingetin.`,
        });
        await sheets.updateStatusAlarm(alarm.nama, alarm.rowNumber, "Berbunyi");
        console.log(`[ALARM] Mulai bunyi buat ${alarm.nama} jam ${alarm.waktu}: ${alarm.pesan}`);
      } else if (alarm.status === "Berbunyi") {
        // masih belum di-stop user, spam terus tiap menit
        await sock.sendMessage(alarm.jid, {
          text: `Alarm: ${alarm.pesan}\n\nBalas /stopalarm buat matiin.`,
        });
        console.log(`[ALARM] Masih spam ke ${alarm.nama}: ${alarm.pesan}`);
      }
    }
  } catch (e) {
    console.error("[ALARM] Gagal cek alarm:", e.message);
  }
}

function mulaiReminderBerkala(sock) {
  reminderIntervals = [
    setInterval(() => kirimRekapBerkala(sock), DUA_JAM_MS),
    setInterval(() => kirimReminderTodo(sock), LIMA_BELAS_MENIT_MS),
    setInterval(() => cekAlarmBerkala(sock), 60 * 1000),
  ];
  console.log("⏰ Reminder berkala aktif: rekap tiap 2 jam, todo tiap 15 menit, alarm dicek tiap 1 menit.");
  console.log("   (Nunggu interval pertama lewat dulu baru kekirim. Test manual: /testreminder)");
}

startBot();
