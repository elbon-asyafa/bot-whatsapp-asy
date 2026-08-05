# Bot WhatsApp ASY

Bot WhatsApp multi-user serbaguna berbasis Node.js: catat pemasukan/
pengeluaran & to-do list otomatis ke Google Sheets, reminder & alarm
custom, scan struk otomatis pakai AI, pembuatan stiker WhatsApp, download
video YouTube/TikTok, forward pesan/stiker ke nomor lain, **stiker Brat statis & animasi**, dan asisten AI
(Gemini) yang bisa diajak ngobrol bebas atau disuruh menjalankan aksi
langsung lewat bahasa natural.

Repo: https://github.com/elbon-asyafa/bot-whatsapp-asy

> **Kompatibilitas OS**: bot ini bisa dijalankan dari **Windows maupun
> Linux** — jalur instalasi [tanpa Docker (Bagian 7)](#7-menjalankan-bot-tanpa-docker-alternatif)
> berlaku untuk kedua OS tersebut. **Pengecualian**: seluruh panduan Docker
> di [Bagian 6](#6-menjalankan-bot-dengan-docker-direkomendasikan) —
> termasuk perintah `systemctl`, `docker`, dan skrip `update.sh` — ditulis
> khusus untuk **Linux** (perintahnya berbasis `bash`/`systemd`, belum
> disesuaikan untuk Docker Desktop di Windows/PowerShell).

---

## Daftar Isi

1. [Persiapan Sebelum Install](#1-persiapan-sebelum-install)
2. [Setup Google Cloud & Sheets API](#2-setup-google-cloud--sheets-api)
3. [Setup Spreadsheet](#3-setup-spreadsheet)
4. [Ambil Gemini API Key](#4-ambil-gemini-api-key)
5. [Konfigurasi File `.env`](#5-konfigurasi-file-env)
6. [Menjalankan Bot dengan Docker (Direkomendasikan)](#6-menjalankan-bot-dengan-docker-direkomendasikan)
7. [Menjalankan Bot Tanpa Docker (Alternatif)](#7-menjalankan-bot-tanpa-docker-alternatif)
8. [Semua Command Bot](#8-semua-command-bot)
9. [Struktur File](#9-struktur-file)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Persiapan Sebelum Install

Clone dulu repo ini:

```bash
git clone https://github.com/elbon-asyafa/bot-whatsapp-asy.git
cd bot-whatsapp-asy
```

Pilih salah satu jalur instalasi:
- **Pakai Docker** (direkomendasikan untuk server/VPS, lebih stabil &
  mudah di-maintain) → lanjut ke [Bagian 6](#6-menjalankan-bot-dengan-docker-direkomendasikan).
- **Tanpa Docker** (jalankan langsung di OS, cocok untuk development
  lokal) → lanjut ke [Bagian 7](#7-menjalankan-bot-tanpa-docker-alternatif).

Kedua jalur tetap butuh setup Google Cloud, Spreadsheet, Gemini API Key,
dan file `.env` di Bagian 2–5 di bawah — kerjakan itu dulu sebelum lanjut.

---

## 2. Setup Google Cloud & Sheets API

1. Buka https://console.cloud.google.com → buat project baru.
2. Cari **"Google Sheets API"** → klik **Enable**.
3. Masuk ke **IAM & Admin** → **Service Accounts** → **Create Service
   Account**.
4. Klik service account yang baru dibuat → tab **Keys** → **Add Key** →
   **Create new key** → pilih **JSON** → **Create** (file JSON otomatis
   terdownload).
5. Pindahkan file JSON itu ke folder root project ini, lalu **rename jadi
   `service-account.json`**.

## 3. Setup Spreadsheet

1. Buat spreadsheet baru di Google Sheets.
2. Buka file `service-account.json`, cari field `"client_email"`, copy
   alamat emailnya.
3. Di spreadsheet, klik **Share** → paste email tadi → beri akses
   **Editor**.
4. Copy **Spreadsheet ID** dari URL spreadsheet:
   `docs.google.com/spreadsheets/d/`**`SPREADSHEET_ID`**`/edit`

Sheet-sheet lain seperti `Users`, `Keuangan_<nama>`, `Todo_<nama>`, dsb
akan **dibuat otomatis oleh bot sendiri** — tidak perlu dibuat manual.

## 4. Ambil Gemini API Key

Buka https://aistudio.google.com/apikey → **Create API Key** → copy
hasilnya. Key ini dipakai untuk fitur `/ai` dan pembacaan struk otomatis
(`/struk`).

## 5. Konfigurasi File `.env`

Copy template yang sudah disediakan:

```bash
cp .env.example .env
```

Lalu edit `.env` dan isi setiap variabel:

```env
GEMINI_API_KEY=isi_api_key_gemini_kamu
SPREADSHEET_ID=isi_spreadsheet_id_kamu
GOOGLE_SERVICE_ACCOUNT_KEY_PATH=./service-account.json
OWNER_NUMBERS=isi_JID_kamu_sendiri
# ALLOWED_NUMBERS boleh dikosongkan -> semua orang yang /daftarbot
# otomatis langsung dapat akses fitur (direkomendasikan untuk pemakaian
# personal). Isi dengan JID dipisah koma kalau mau approve manual per-orang.
ALLOWED_NUMBERS=
```

> **Cara dapetin JID kamu sendiri** (untuk `OWNER_NUMBERS`): jalankan bot
> dulu (Docker atau tanpa Docker), chat `/help` ke nomor bot, lalu lihat
> log/terminal — akan muncul baris `[MASUK] <jid-kamu> -> /help`. Copy
> JID itu ke `.env`, lalu restart bot.

**Jangan pernah** commit atau share file `.env` maupun
`service-account.json` — keduanya berisi kredensial rahasia dan sudah
di-gitignore secara default.

---

## 6. Menjalankan Bot dengan Docker (Direkomendasikan)

Cara ini direkomendasikan untuk deployment jangka panjang di server/VPS
karena environment terisolasi, konsisten, dan bisa auto-restart kalau
crash atau server reboot.

> ⚠️ **Khusus Linux**: seluruh perintah di bagian ini (`sudo systemctl`,
> `sudo docker ...`, skrip `update.sh`) ditulis untuk environment Linux
> (server/VPS berbasis `bash`). Kalau menjalankan di Windows dengan Docker
> Desktop, konsepnya sama (build image → run dengan `--env-file` &
> `--restart always`), tapi perintah `sudo` dan `systemctl` tidak berlaku
> — jalankan lewat PowerShell/CMD tanpa `sudo`, dan pastikan Docker Desktop
> menyala manual (tidak ada `systemctl` di Windows). Kalau kamu di Windows,
> pertimbangkan langsung pakai [Bagian 7 (tanpa Docker)](#7-menjalankan-bot-tanpa-docker-alternatif)
> untuk pengalaman yang lebih teruji.

### 6.1 Prasyarat

Docker Engine harus sudah terpasang & daemon-nya menyala. Kalau daemon
tidak otomatis menyala setelah reboot server, aktifkan dulu:

```bash
sudo systemctl enable --now docker
```

### 6.2 Penjelasan `Dockerfile`

```dockerfile
FROM node:20-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    yt-dlp \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    fontconfig \
    build-essential \
    python3 \
 && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm install --legacy-peer-deps && npm cache clean --force
COPY . .
CMD ["node", "index.js"]
```

Penjelasan tiap baris:

| Baris | Fungsi |
|---|---|
| `FROM node:20-slim` | Base image **Node.js versi 20**, varian Debian slim. Dipakai karena `node-canvas` lebih stabil di glibc/Debian daripada Alpine/musl. **Wajib 20+** karena `@whiskeysockets/baileys` mensyaratkan Node 20 ke atas — versi di bawahnya akan gagal (`EBADENGINE`). |
| `WORKDIR /app` | Direktori kerja di dalam container. |
| `RUN apt-get install ...` | Install `ffmpeg`, `yt-dlp`, dependensi sistem untuk `node-canvas` (cairo, pango, jpeg, giflib, librsvg, fontconfig), dan tool build (`build-essential`, `python3`). |
| `COPY package*.json ./` | Copy `package.json` & `package-lock.json` **terlebih dahulu**, sebelum source code lain — supaya Docker bisa memakai layer cache dan tidak perlu `npm install` ulang setiap build kalau dependency-nya tidak berubah. |
| `RUN npm install --legacy-peer-deps && npm cache clean --force` | Install dependency dengan flag **`--legacy-peer-deps`** (lihat penjelasan di bawah), lalu bersihkan cache npm di layer yang sama supaya ukuran image tetap kecil. |
| `COPY . .` | Copy seluruh source code project ke dalam image. |
| `CMD ["node", "index.js"]` | Perintah yang dijalankan saat container start. |

### 6.3 Penjelasan file `.env` di konteks Docker

File `.env` **tidak** di-`COPY` ke dalam image (dan memang tidak boleh,
karena berisi kredensial). Sebagai gantinya, variabel di dalamnya
di-inject ke container saat runtime lewat flag `--env-file .env` pada
`docker run` (lihat Bagian 6.4). Ini artinya:
- Image Docker yang di-build **aman untuk dibagikan/di-push ke registry**
  (tidak mengandung kredensial di dalamnya).
- File `.env` cukup ada di host (server), sejajar dengan `Dockerfile`,
  sebelum menjalankan `docker run`.
- Kalau isi `.env` berubah, container perlu di-restart/dijalankan ulang
  supaya perubahan itu ke-load (lihat skrip `update.sh` di Bagian 6.6).

### 6.4 Build image & jalankan container

```bash
# 1. Build Docker image dari Dockerfile
sudo docker build -t bot-wa-asy .

# 2. Jalankan container
sudo docker run -d \
  --name bot-wa-running \
  --env-file .env \
  --restart always \
  bot-wa-asy
```

Penjelasan flag `docker run`:
- **`-d`** — jalankan di background (*detached mode*).
- **`--name bot-wa-running`** — nama container, dipakai untuk
  stop/rm/logs selanjutnya.
- **`--env-file .env`** — memuat seluruh variabel dari `.env` ke dalam
  container sebagai environment variable, tanpa perlu hardcode kredensial
  ke image.
- **`--restart always`** — container otomatis restart kalau proses di
  dalamnya crash, atau kalau Docker daemon/server reboot. Ini yang bikin
  bot bisa jalan 24 jam nonstop tanpa perlu dijaga manual.

### 6.5 Scan QR Code login WhatsApp

Saat pertama kali dijalankan (atau setelah `auth_session` dihapus), bot
akan menampilkan QR code di log container:

```bash
sudo docker logs -f bot-wa-running
```

Scan QR yang muncul pakai WhatsApp di HP: **Perangkat Tertaut → Tautkan
Perangkat**. Tunggu sampai muncul `✅ Bot WhatsApp terkoneksi!`, lalu
`Ctrl+C` untuk keluar dari mode log (container tetap jalan di
background).

### 6.6 Monitoring & maintenance container

```bash
# Lihat log real-time
sudo docker logs -f bot-wa-running

# Cek status container yang berjalan
sudo docker ps

# Cek pemakaian resource (RAM/CPU)
sudo docker stats

# Bersihkan image/cache lama kalau disk mulai penuh
# (berguna kalau sering build ulang)
sudo docker system prune -a --volumes
```

Kalau root/storage mulai penuh, bersihkan bertahap:

```bash
sudo docker container prune -f
sudo docker image prune -a -f
sudo docker volume prune -f
sudo docker builder prune -a -f
```

Atau bersihkan semua resource Docker yang tidak terpakai sekaligus:

```bash
sudo docker system prune -a --volumes -f
```

### 6.7 Skrip otomasi update (`update.sh`)

Untuk menarik update kode terbaru dari Git dan langsung redeploy container
tanpa mengetik ulang seluruh perintah Docker satu-satu, buat file
`update.sh` di root project:

```bash
#!/bin/bash
set -e
sudo docker stop bot-wa-running 2>/dev/null || true
sudo docker rm bot-wa-running 2>/dev/null || true
sudo docker build -t bot-wa-asy .
sudo docker run -d --name bot-wa-running --env-file .env --restart always bot-wa-asy
echo "Update Docker Bot Berhasil!"
```

Beri izin eksekusi sekali saja:

```bash
chmod +x update.sh
```

Cara pakai tiap kali ada update kode:

```bash
git pull
./update.sh
```

Skrip cleanup Docker opsional (`docker-clean.sh`):

```bash
#!/bin/bash
set -e
sudo docker container prune -f
sudo docker image prune -a -f
sudo docker volume prune -f
sudo docker builder prune -a -f
echo "Docker cleanup selesai."
```

Alur kerja skrip ini: **stop** container lama → **rm** (hapus) container
lama → **build** ulang image dari kode terbaru → **run** container baru
dengan konfigurasi yang sama (`--env-file .env --restart always`).

---

## 7. Menjalankan Bot Tanpa Docker (Alternatif)

Cocok untuk development lokal atau kalau tidak mau memakai Docker sama
sekali.

### 7.1 Install dependency sistem

Contoh untuk Arch Linux:

```bash
sudo pacman -Syu
sudo pacman -S nodejs npm yt-dlp
```

Untuk distro berbasis Debian/Ubuntu:

```bash
sudo apt update
sudo apt install nodejs npm yt-dlp
```

Pastikan versi Node.js **20 atau lebih baru**:

```bash
node --version
npm --version
yt-dlp --version
```

`yt-dlp` yang terpasang lewat package manager sistem otomatis masuk ke
PATH, jadi tidak perlu ditaruh manual di folder project.

### 7.2 Install dependency Node.js project

```bash
npm install --legacy-peer-deps
```

> Flag `--legacy-peer-deps` **wajib** — lihat penjelasan lengkap di
> [Bagian 10 (Troubleshooting)](#node-engine--legacy-peer-deps).

### 7.3 Jalankan bot

```bash
node index.js
```

QR code akan muncul di terminal — scan pakai WhatsApp (**Perangkat
Tertaut → Tautkan Perangkat**). Tunggu sampai muncul pesan `✅ Bot
WhatsApp terkoneksi!`.

### 7.4 Jalankan terus di background (opsional)

Pakai `pm2` supaya bot tetap jalan setelah terminal ditutup, dan lebih
gampang di-manage dibanding `nohup`:

```bash
sudo npm install -g pm2
pm2 start index.js --name wa-bot
pm2 logs wa-bot         # lihat log real-time
pm2 save                 # simpan state biar reload otomatis
pm2 startup               # generate command auto-start saat boot
                          # (ikuti instruksi yang muncul)
```

---

## 8. Semua Command Bot

Ketik `/help` langsung di chat WhatsApp bot untuk melihat daftar lengkap
& paling terkini (tampilan menyesuaikan otomatis — beda sedikit kalau
dipanggil dari grup vs chat pribadi, dan beda kalau dipanggil owner vs
user biasa). Garis besarnya:

- **Akun** *(chat pribadi saja)*: `/daftarbot [nama]`, `/deleteuser`
- **Keuangan**: `/masuk`, `/keluar`, `/rekap`, `/riwayat`, `/unduhrekap`,
  foto struk + caption `/struk`
- **To-Do**: `/todo`, `/listtodo`, `/done`
- **Reminder & Alarm**: `/reminder on/off`, `/alarm [jam] [pesan]`,
  `/stopalarm`, `/listalarm`, `/hapusalarm`
- **Media**: foto + caption `/stiker [teks opsional]`, `/download [link] [format]`
  (mp3 atau mp4, default mp4, video maks 60MB, butuh `ffmpeg` untuk mp3)
- **Brat Sticker**: `/brat [teks]` — stiker statis (Arial Narrow, blur 8.4px, tanpa noise),
  `/bratvid [teks]` — stiker animasi kata per kata (equal speed 0.75s per frame)
- **Utilitas**: `/kirim [nomor] [pesan]`, atau reply stiker + `/kirim
  [nomor]` untuk forward stiker
- **AI Assistant**: `/ai [pertanyaan/perintah]` — ngobrol bebas atau
  menyuruh bot menjalankan aksi lewat bahasa natural (function calling)
- **Admin** *(khusus `OWNER_NUMBERS`)*: `/listuser`, `/adminhapususer
  [nama]`, `/testreminder`, `/ping [text]` (tag semua member grup, hanya di grup), `/alert [text]` (kirim info ke semua user & grup)

---

## 9. Struktur File

```
bot-whatsapp-asy/
├── index.js                # Bot utama: koneksi WA, semua command, scheduler
│                           # reminder & alarm
├── sheets.js                # Semua fungsi baca/tulis Google Sheets
├── gemini.js                  # Integrasi AI: chat, function calling, baca struk
├── brat-advanced.js          # Generator stiker Brat (statis & animasi)
├── package.json
├── package-lock.json
├── Dockerfile                   # Definisi image Docker
├── update.sh                      # (opsional, dibuat sendiri) skrip otomasi update
├── .env                              # Kredensial & config (JANGAN commit/share)
├── .env.example
├── service-account.json               # Kredensial Google (ditambahkan sendiri, di-gitignore)
├── auth_session/                        # Sesi login WA (auto-generated, JANGAN dihapus
│                                        # kecuali sedang troubleshoot)
├── temp/                                  # File video sementara dari /download, auto terhapus
└── fonts/                                  # Font Arial Narrow untuk stiker Brat
    └── arialnarrow.ttf
```

---

## 10. Troubleshooting

### QR code tidak muncul / loop "Koneksi terputus" terus

```bash
# Tanpa Docker:
rm -rf auth_session
node index.js

# Dengan Docker:
sudo docker exec -it bot-wa-running rm -rf /app/auth_session
sudo docker restart bot-wa-running
```

Kalau pakai Docker dan `auth_session` di-mount sebagai volume dari host,
cukup hapus foldernya di host lalu `docker restart`.

### <a name="node-engine--legacy-peer-deps"></a>Error `EBADENGINE` (versi Node tidak sesuai)

`@whiskeysockets/baileys` mensyaratkan **Node.js v20 atau lebih baru**.
Kalau muncul warning/error `EBADENGINE` saat `npm install`:
- **Tanpa Docker**: update Node.js ke versi 20+ di sistem kamu.
- **Dengan Docker**: pastikan `Dockerfile` memakai `FROM node:20-slim`
  (atau Node 20+ lain), bukan `node:18-alpine` atau di bawahnya.

### Error konflik peer-dependency (`ERESOLVE`) saat `npm install`

Ini terjadi karena `baileys` meminta `jimp@^1.x`, sementara project ini
sengaja memakai `jimp@0.22.x` (versi lama yang API-nya dipakai untuk
fitur stiker — `sharp` sempat dicoba sebagai alternatif tapi gagal total
di beberapa environment). Solusinya **selalu** pakai flag
`--legacy-peer-deps`:

```bash
npm install --legacy-peer-deps
```

Kalau masih error, bersihkan total dan install ulang:

```bash
rm -rf node_modules package-lock.json
npm install --legacy-peer-deps
```

Flag ini juga sudah tertanam permanen di `Dockerfile` (lihat Bagian 6.2),
jadi build Docker seharusnya tidak pernah kena isu ini — tapi kalau
melakukan modifikasi ke `Dockerfile`, pastikan flag ini tidak terhapus.

### Docker: `failed to connect to the docker API`

Docker daemon belum/tidak berjalan. Aktifkan (dan buat otomatis menyala
saat boot):

```bash
sudo systemctl enable --now docker
```

### Docker: disk/storage penuh akibat build berulang

Bersihkan image & cache Docker yang tidak lagi terpakai:

```bash
sudo docker system prune -a --volumes
```

Perintah ini akan menghapus **semua** image, container berhenti, dan
volume yang tidak terpakai — pastikan tidak ada container penting lain
yang sedang berhenti sementara sebelum menjalankan ini.

### Command reply "Kamu belum terdaftar" padahal sudah `/daftarbot`

Kemungkinan JID WhatsApp kamu (format `@lid`) berubah antar sesi. Bot
punya fallback otomatis memakai "nomor asli" untuk mengenali ulang —
kalau tetap gagal, jalankan `/deleteuser` lalu `/daftarbot` ulang.

### `yt-dlp` tidak terdeteksi meskipun sudah terpasang

```bash
which yt-dlp
```

Kalau kosong, cek ulang instalasinya (`sudo pacman -S yt-dlp` /
`sudo apt install yt-dlp`) atau restart terminal/session supaya PATH
ter-refresh. Untuk Docker, `ffmpeg` dan `yt-dlp` sudah otomatis ter-install
di dalam image lewat `Dockerfile`.

Kalau download MP3 gagal dengan error `ffmpeg`/`ffprobe`, install `ffmpeg`:
```bash
# Arch Linux
sudo pacman -S ffmpeg

# Debian/Ubuntu
sudo apt install ffmpeg
```

### Stiker Brat (`/brat`, `/bratvid`) tidak muncul / error

1. **Font Arial Narrow** — pastikan file `fonts/arialnarrow.ttf` ada di project (sudah include di repo).
2. **Canvas native deps** — untuk Docker, sudah include di `Dockerfile` (`cairo-dev`, `pango-dev`, dll). Tanpa Docker, install manual:
   ```bash
   # Arch Linux
   sudo pacman -S cairo pango libjpeg-turbo giflib librsvg fontconfig
   
   # Debian/Ubuntu
   sudo apt install libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev fontconfig
   ```
3. **Rebuild canvas** jika error `Cannot find module '../build/Release/canvas.node'`:
   ```bash
   npm rebuild canvas --legacy-peer-deps
   ```
4. **`/bratvid` tidak bergerak** — pastikan `ffmpeg` terinstall dan support `libwebp`:
   ```bash
   ffmpeg -codecs | grep webp
   ```
   Kalau tidak ada, compile ffmpeg dengan `--enable-libwebp` atau install package `ffmpeg` yang sudah include (biasanya sudah).
