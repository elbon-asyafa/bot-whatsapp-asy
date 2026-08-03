# Bot WA Keuangan + Todo + AI (Arch Linux)

Bot WhatsApp buat catat pemasukan/pengeluaran dan to-do list harian,
otomatis kesimpen ke Google Sheets. Ada AI (Gemini), reminder & alarm,
scan struk, stiker, download video, dan lain-lain.

## 1. Install Dependency Sistem

```bash
sudo pacman -Syu                     # update dulu
sudo pacman -S nodejs npm yt-dlp     # Node.js + npm + yt-dlp (buat /download)
```

Cek udah kepasang bener:
```bash
node --version
npm --version
yt-dlp --version
```

`yt-dlp` dari `pacman` otomatis masuk ke PATH sistem, jadi **nggak perlu**
ditaruh manual di folder project (beda sama di Windows kemarin).

## 2. Setup Google Cloud & Sheets API

1. Buka https://console.cloud.google.com → buat project baru
2. Search **"Google Sheets API"** → **Enable**
3. **IAM & Admin** → **Service Accounts** → **Create Service Account**
4. Klik service account itu → tab **Keys** → **Add Key** → **Create new key**
   → **JSON** → Create (file otomatis kedownload)
5. Pindahin file JSON itu ke folder project ini, **rename jadi
   `service-account.json`**

## 3. Setup Spreadsheet

1. Bikin spreadsheet baru di Google Sheets
2. Buka file `service-account.json`, cari `"client_email"`, copy emailnya
3. Di spreadsheet, klik **Share** → paste email itu → kasih akses **Editor**
4. Copy **Spreadsheet ID** dari URL:
   `docs.google.com/spreadsheets/d/`**`SPREADSHEET_ID`**`/edit`

(Sheet-sheet lain kayak `Users`, `Keuangan_<nama>`, `Todo_<nama>`, dll
otomatis dibikin bot sendiri, nggak perlu bikin manual.)

## 4. Ambil Gemini API Key

https://aistudio.google.com/apikey → **Create API Key** → copy

## 5. Install & Konfigurasi Project

```bash
cd wa-bot-keuangan-todo
npm install --legacy-peer-deps
cp .env.example .env
```

> Kenapa `--legacy-peer-deps`: `baileys` minta `jimp@^1.x` sementara project
> ini pakai `jimp@0.22.x` (versi lama yang API-nya kepake buat fitur
> stiker). Keduanya sebenernya nggak bentrok fungsinya, npm-nya aja yang
> strict. Selalu pakai flag ini tiap `npm install` di project ini.

Edit `.env`, isi:
```
GEMINI_API_KEY=...
SPREADSHEET_ID=...
GOOGLE_SERVICE_ACCOUNT_KEY_PATH=./service-account.json
OWNER_NUMBERS=isi_JID_kamu_disini
# ALLOWED_NUMBERS dikosongin/dihapus aja -> semua orang yang /daftarbot langsung bisa akses fitur
```

## 6. Jalankan Bot

```bash
node index.js
```

QR code muncul di terminal → scan pakai WhatsApp (**Perangkat Tertaut →
Tautkan Perangkat**). Tunggu sampai `✅ Bot WhatsApp terkoneksi!`.

Cara dapetin JID kamu sendiri buat diisi ke `OWNER_NUMBERS`: chat `/help` ke
bot, lihat di terminal muncul baris `[MASUK] <jid> -> /help`, copy JID itu
ke `.env`, restart bot.

## Semua Command

Ketik `/help` di WA buat lihat daftar lengkap & terkini (tampilannya
otomatis nyesuain — beda dikit kalau dipanggil dari grup vs chat pribadi).
Garis besarnya:

- **Akun**: `/daftarbot [nama]`, `/deleteuser`
- **Keuangan**: `/masuk`, `/keluar`, `/rekap`, `/riwayat`, `/unduhrekap`,
  foto struk + caption `/struk`
- **To-Do**: `/todo`, `/listtodo`, `/done`
- **Reminder & Alarm**: `/reminder on/off`, `/alarm [jam] [pesan]`,
  `/stopalarm`, `/listalarm`, `/hapusalarm`
- **Media**: foto + caption `/stiker [teks opsional]`, `/download [link]`
  (maks 60MB)
- **Utilitas**: `/kirim [nomor] [pesan]`, atau reply stiker + `/kirim
  [nomor]` buat forward stiker
- **AI**: `/ai [pertanyaan/perintah]` — ngobrol bebas atau nyuruh bot
  ngejalanin aksi lewat bahasa natural
- **Admin** (cuma `OWNER_NUMBERS`): `/listuser`, `/adminhapususer`,
  `/testreminder`, `/notif [pesan]` (broadcast + tag ke grup)

## Jalanin Terus di Background (opsional, biar nggak perlu buka terminal terus)

Pakai `pm2` (lebih gampang manage restart/log dibanding `nohup`):

```bash
sudo npm install -g pm2
pm2 start index.js --name wa-bot
pm2 logs wa-bot        # liat log real-time
pm2 save                # simpen state biar reload otomatis
pm2 startup              # generate command buat auto-start pas boot (ikutin instruksi yang muncul)
```

## Struktur File

```
wa-bot-keuangan-todo/
├── index.js               # bot utama: koneksi WA, semua command, reminder & alarm scheduler
├── sheets.js                # semua fungsi baca/tulis Google Sheets
├── gemini.js                  # integrasi AI: chat, function calling, baca struk
├── package.json
├── .env                        # kredensial & config (JANGAN di-share/commit)
├── .env.example
├── service-account.json         # kredensial Google (kamu tambahin sendiri)
├── auth_session/                  # sesi login WA (otomatis dibikin, JANGAN dihapus kecuali lagi troubleshoot)
└── temp/                            # video sementara dari /download, auto kehapus
```

## Troubleshooting Umum

**QR code nggak muncul / loop "Koneksi terputus" terus:**
```bash
rm -rf auth_session
node index.js
```

**Error konflik peer-dependency pas `npm install`:**
```bash
npm install --legacy-peer-deps
```
Kalau masih error, bersihin total:
```bash
rm -rf node_modules package-lock.json
npm install --legacy-peer-deps
```

**Command reply "Kamu belum terdaftar" padahal udah `/daftarbot`:**
Kemungkinan JID WhatsApp kamu (`@lid`) berubah antar sesi. Bot punya
fallback otomatis pakai "nomor asli" buat ngenalin ulang — kalau tetep
gagal, `/deleteuser` terus `/daftarbot` ulang.

**`yt-dlp` nggak kedetect meskipun udah `pacman -S yt-dlp`:**
```bash
which yt-dlp
```
Kalau kosong, cek ulang instalasinya (`sudo pacman -S yt-dlp` lagi) atau
restart terminal biar PATH ke-refresh.
