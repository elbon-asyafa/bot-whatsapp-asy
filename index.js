const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const pino = require("pino");
require("dotenv").config();

process.on("unhandledRejection", (err) => {
  console.error("UNHANDLED REJECTION:", err);
});
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});

const sheets = require("./sheets");
const { tanyaAI, prosesPerintahBot, analisisStruk } = require("./gemini");
const XLSX = require("xlsx");
const { Sticker, StickerTypes } = require("wa-sticker-formatter");
const Jimp = require("jimp");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

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

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_session");
  const { version } = await fetchLatestBaileysVersion();
  console.log("Pakai versi WhatsApp Web:", version.join("."));

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
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
      if (shouldReconnect) startBot();
    } else if (connection === "open") {
      console.log("✅ Bot WhatsApp terkoneksi!");
      sheets.ensureBaseSheets().catch((e) =>
        console.error("Gagal siapin sheet dasar:", e.message)
      );
      mulaiReminderBerkala(sock);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

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
      await handleCommand(sock, sender, text.trim(), nomorAsli, authorId, isGroup, mentionedJid, pushName, quotedInfo);
      console.log(`[SELESAI] Command dari ${authorId} udah diproses & dibales.`);
    } catch (err) {
      console.error(`[ERROR] Gagal proses command dari ${authorId}:`, err);
      await sock.sendMessage(sender, {
        text: "⚠️ Ada error pas proses command. Coba lagi ya.",
      });
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

async function handleCommand(sock, sender, text, nomorAsli, authorId, isGroup, mentionedJid, pushName, quotedInfo) {
  const [command, ...rest] = text.split(" ");
  const args = rest.join(" ");
  const cmd = command.toLowerCase();

  // Command Akun/Keuangan/To-Do/Admin cuma boleh di chat pribadi, nggak di grup
  const PERSONAL_ONLY_COMMANDS = [
    "/daftarbot", "/deleteuser",
    "/masuk", "/keluar", "/rekap", "/riwayat", "/unduhrekap",
    "/todo", "/listtodo", "/done",
    "/listuser", "/adminhapususer", "/testreminder",
  ];
  if (isGroup && PERSONAL_ONLY_COMMANDS.includes(cmd)) {
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
    const bagianAdminPersonal =
      isOwner(authorId) && !isGroup
        ? `\n\n*Admin* (khusus pemilik bot)\n` +
          `/listuser — lihat semua user terdaftar\n` +
          `/adminhapususer [nama] — hapus akun user manapun\n` +
          `/testreminder — tes kirim reminder sekarang juga\n`
        : "";
    const bagianNotif = isOwner(authorId)
      ? (isGroup ? `\n\n*Admin*\n` : "") +
        `/notif [pesan] — kirim & tag notif ke grup (di grup: grup itu aja, di DM: semua grup)`
      : "";
    const bagianAdmin = bagianAdminPersonal + bagianNotif;

    const bagianPersonal = isGroup
      ? ""
      : `*Akun*\n` +
        `/daftarbot [nama] — daftar user baru (wajib sebelum command lain)\n` +
        `/deleteuser — hapus akun & semua data kamu (butuh konfirmasi)\n\n` +
        `*Keuangan*\n` +
        `/masuk [nominal] [keterangan] — catat pemasukan\n` +
        `/keluar [nominal] [keterangan] — catat pengeluaran\n` +
        `/rekap — ringkasan keuangan kamu hari ini\n` +
        `/riwayat [jumlah] — lihat transaksi terakhir (default 10)\n` +
        `/unduhrekap — download Excel data kamu\n` +
        `Kirim foto struk + caption /struk — otomatis dibaca & dicatat\n\n` +
        `*To-Do List*\n` +
        `/todo [task] — tambah tugas\n` +
        `/listtodo — lihat to-do hari ini\n` +
        `/done [nomor] — tandai tugas selesai\n\n`;

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
        `*Reminder & Alarm*\n` +
        `/reminder on / off — nyala/matiin reminder kamu\n` +
        `/reminder — cek status reminder kamu\n` +
        `/alarm [jam] [pesan] — set alarm sekali jalan, contoh: /alarm 20:20 mau coding\n` +
        `/stopalarm — matiin alarm yang lagi bunyi (spam tiap menit sampai di-stop)\n` +
        `/listalarm — lihat alarm aktif kamu\n` +
        `/hapusalarm [nomor] — hapus alarm\n\n` +
        `*Media*\n` +
        `Kirim foto + caption /stiker — convert jadi stiker WA\n` +
        `Kirim foto + caption /stiker [teks] — stiker + teks meme, contoh: /stiker kecewa ringan\n` +
        `Kirim foto + caption /stiker [atas]|[bawah] — teks di atas & bawah sekaligus\n` +
        `/download [link] — download video YouTube/TikTok (maks 60MB, keterbatasan WA)\n\n` +
        `*Utilitas*\n` +
        `/kirim [nomor] [pesan] — kirim pesan lewat bot ke nomor lain\n` +
        `Reply stiker + /kirim [nomor] — forward stiker itu ke nomor lain\n\n` +
        `*AI Assistant*\n` +
        `/ai [perintah/pertanyaan] — ngobrol bebas atau suruh bot ngapa-ngapain\n` +
        contohAI +
        `\n` +
        catatanGrup +
        bagianAdmin +
        `\n\n/help — tampilkan pesan ini`,
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
      const url = args.trim();
      if (!url || !/^https?:\/\//.test(url)) {
        return sock.sendMessage(sender, {
          text: "Format: /download [link youtube/tiktok]\n\nCatatan: pastiin video yang kamu download itu boleh diunduh (video sendiri, Creative Commons, atau diizinin creator-nya).",
        });
      }

      await sock.sendMessage(sender, {
        text: "Lagi download videonya, tunggu bentar... (maks 60MB ya, karena keterbatasan WA)",
      });

      const tempDir = path.join(__dirname, "temp");
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
      const outputPath = path.join(tempDir, `video_${Date.now()}.mp4`);

      try {
        await new Promise((resolve, reject) => {
          exec(
            `${pathYtDlp()} -f "best[ext=mp4]/best" --max-filesize 60M -o "${outputPath}" "${url}"`,
            { maxBuffer: 1024 * 1024 * 50 },
            (err) => (err ? reject(err) : resolve())
          );
        });

        if (!fs.existsSync(outputPath)) {
          return sock.sendMessage(sender, {
            text: "Gagal download, kemungkinan video kebesaran (>60MB) atau link nggak valid.",
          });
        }

        const videoBuffer = fs.readFileSync(outputPath);
        await sock.sendMessage(sender, { video: videoBuffer, caption: "Nih videonya" });
        fs.unlinkSync(outputPath);
      } catch (e) {
        return sock.sendMessage(sender, {
          text: `Gagal download: ${e.message}\n\nPastiin "yt-dlp" udah keinstall di komputer bot ya (cek README).`,
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

      const hasil = await prosesPerintahBot(args, executors);
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

    case "/notif": {
      if (!isOwner(authorId)) {
        return sock.sendMessage(sender, { text: "Command ini cuma buat pemilik bot." });
      }
      const pesanNotif = args.trim();
      if (!pesanNotif) {
        return sock.sendMessage(sender, {
          text:
            "Format: /notif [pesan]\n\n" +
            "Dipanggil DI DALAM grup -> kirim & tag semua member grup itu doang.\n" +
            "Dipanggil DI CHAT PRIBADI -> broadcast ke SEMUA grup yang ada bot-nya.",
        });
      }

      const teksNotif = `📢 Pengumuman dari admin:\n\n${pesanNotif}`;

      if (isGroup) {
        const metadata = await sock.groupMetadata(sender).catch(() => null);
        if (!metadata) {
          return sock.sendMessage(sender, { text: "Gagal ambil data grup ini." });
        }
        const participantJids = metadata.participants.map((p) => p.id);
        return sock.sendMessage(sender, { text: teksNotif, mentions: participantJids });
      }

      // Dipanggil dari chat pribadi -> broadcast ke semua grup yang ada bot-nya
      try {
        const semuaGrup = await sock.groupFetchAllParticipating();
        const daftarGrup = Object.values(semuaGrup);
        if (daftarGrup.length === 0) {
          return sock.sendMessage(sender, { text: "Bot belum ada di grup manapun." });
        }
        for (const grup of daftarGrup) {
          const participantJids = grup.participants.map((p) => p.id);
          await sock.sendMessage(grup.id, { text: teksNotif, mentions: participantJids });
        }
        return sock.sendMessage(sender, {
          text: `Notif terkirim & tag semua member ke ${daftarGrup.length} grup.`,
        });
      } catch (e) {
        return sock.sendMessage(sender, { text: `Gagal broadcast notif: ${e.message}` });
      }
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
  setInterval(() => kirimRekapBerkala(sock), DUA_JAM_MS);
  setInterval(() => kirimReminderTodo(sock), LIMA_BELAS_MENIT_MS);
  setInterval(() => cekAlarmBerkala(sock), 60 * 1000);
  console.log("⏰ Reminder berkala aktif: rekap tiap 2 jam, todo tiap 15 menit, alarm dicek tiap menit.");
  console.log("   (Nunggu interval pertama lewat dulu baru kekirim. Test manual: /testreminder)");
}

startBot();
