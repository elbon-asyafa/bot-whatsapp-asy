# Bot WhatsApp ASY

Bot WhatsApp multi-user berbasis Node.js: catat keuangan & to-do ke Google
Sheets, reminder & alarm custom, scan struk pakai AI, stiker (biasa & Brat),
download video YouTube/TikTok, generator fake chat screenshot, forward
pesan, dan asisten AI (Gemini) yang bisa ngobrol bebas atau menjalankan aksi
lewat bahasa natural.

Repo: https://github.com/elbon-asyafa/bot-whatsapp-asy

> Bisa jalan di **Windows maupun Linux** tanpa Docker (Bagian 3). Panduan
> Docker (Bagian 2) khusus **Linux** (`systemctl`/`bash`).

## Daftar Isi

1. [Setup Awal (Google Sheets, Gemini, `.env`)](#1-setup-awal)
2. [Menjalankan dengan Docker](#2-menjalankan-dengan-docker)
3. [Menjalankan Tanpa Docker](#3-menjalankan-tanpa-docker)
4. [Semua Command](#4-semua-command)
5. [Struktur File](#5-struktur-file)
6. [Troubleshooting](#6-troubleshooting)

---

## 1. Setup Awal

```bash
git clone https://github.com/elbon-asyafa/bot-whatsapp-asy.git
cd bot-whatsapp-asy
```

**Google Cloud & Sheets:**
1. https://console.cloud.google.com → project baru → enable **Google Sheets API**.
2. **IAM & Admin → Service Accounts → Create** → tab **Keys → Add Key → JSON**.
3. Rename file JSON yang terdownload jadi **`service-account.json`**, taruh di root project.
4. Buat spreadsheet baru → **Share** ke email `client_email` dari file JSON tadi (akses **Editor**).
5. Copy **Spreadsheet ID** dari URL: `docs.google.com/spreadsheets/d/`**`ID`**`/edit`.

Sheet lain (`Users`, `Keuangan_<nama>`, dst) **dibuat otomatis oleh bot**.

**Gemini API Key:** https://aistudio.google.com/apikey → Create API Key.

**File `.env`:**

Linux:
```bash
cp .env.example .env
```

Windows PowerShell:
```powershell
Copy-Item .env.example .env
```

Isi `GEMINI_API_KEY`, `SPREADSHEET_ID`, `OWNER_NUMBERS` (JID kamu — cara
dapetin: jalankan bot, chat `/help`, lihat log `[MASUK] <jid> -> /help`).
`ALLOWED_NUMBERS` boleh dikosongkan (semua yang `/daftarbot` langsung dapat akses).

**Jangan pernah commit** `.env` atau `service-account.json`.

---

## 2. Menjalankan dengan Docker

Direkomendasikan untuk server/VPS — auto-restart kalau crash/reboot.

```bash
sudo docker build -t bot-wa-asy .
sudo docker run -d --name bot-wa-running --env-file .env --restart always bot-wa-asy
sudo docker logs -f bot-wa-running   # scan QR yang muncul di sini
```

Scan QR pakai WhatsApp: **Perangkat Tertaut → Tautkan Perangkat**. Tunggu
`✅ Bot WhatsApp terkoneksi!`, lalu `Ctrl+C` (container tetap jalan).

**Update ke versi terbaru** — buat `update.sh` sekali:
```bash
#!/bin/bash
set -e
sudo docker stop bot-wa-running 2>/dev/null || true
sudo docker rm bot-wa-running 2>/dev/null || true
sudo docker build -t bot-wa-asy .
sudo docker run -d --name bot-wa-running --env-file .env --restart always bot-wa-asy
echo "Update selesai!"
```
```bash
chmod +x update.sh
# tiap ada update:
git pull && ./update.sh
```

**Maintenance:**
```bash
sudo docker logs -f bot-wa-running     # log real-time
sudo docker ps                          # status
sudo docker stats                       # RAM/CPU
sudo docker system prune -a --volumes   # bersihin disk penuh
```

> ⚠️ **Jangan jalanin Docker dan `node index.js` manual bersamaan** — dua
> instance connect ke WhatsApp session yang sama bikin bug aneh (reminder
> nggak konsisten, pesan dobel, dll). Matiin salah satu dulu kalau mau tes manual.

---

## 3. Menjalankan Tanpa Docker

Cocok untuk development lokal.

### Windows (native)

Jalankan perintah berikut dari PowerShell. Node.js dan Git hanya perlu
di-install kalau belum ada:

```powershell
winget install --source winget --exact --id OpenJS.NodeJS.LTS
winget install --source winget --exact --id Git.Git
winget install --source winget --exact --id Gyan.FFmpeg
winget install --source winget --exact --id yt-dlp.yt-dlp
```

Tutup dan buka ulang terminal setelah instalasi supaya `PATH` terbaru terbaca,
lalu verifikasi:

```powershell
node --version
npm.cmd --version
ffmpeg -version
ffprobe -version
yt-dlp --version
```

Node.js wajib versi 20+. Python, Cairo, dan Visual Studio Build Tools biasanya
tidak diperlukan karena `canvas` dan `sharp` menyediakan binary Windows.

Install dependency project dari root repository:

```powershell
npm.cmd ci --legacy-peer-deps
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows\install-fonts.ps1
```

Project menyertakan `.npmrc` untuk mengizinkan dependency Git yang dikunci oleh
Baileys. Ini diperlukan oleh npm 12; tanpa itu clean install gagal dengan
`EALLOWGIT`. `npm.cmd` dipakai karena sebagian instalasi Windows memblokir
`npm.ps1` lewat PowerShell Execution Policy.

Pastikan `.env` dan `service-account.json` sudah ada, lalu lakukan login pertama:

```powershell
node index.js
```

Scan QR melalui WhatsApp: **Perangkat Tertaut -> Tautkan Perangkat**. Folder
`auth_session/` dibuat otomatis setelah login, jadi tidak perlu dibuat atau
dipindahkan sebelumnya. Tekan `Ctrl+C` untuk mematikan proses manual.

#### Auto-start Windows

Bot dapat dijalankan otomatis setiap kali user Windows login. Install NSSM
tidak diperlukan karena repository sudah menyediakan integrasi Task Scheduler:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows\manage-bot.ps1 install
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows\manage-bot.ps1 start
```

Lakukan ini setelah login QR manual berhasil. Kontrol bot selanjutnya:

```powershell
# Cek status
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows\manage-bot.ps1 status

# Matikan
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows\manage-bot.ps1 stop

# Nyalakan lagi
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows\manage-bot.ps1 start

# Hapus auto-start
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows\manage-bot.ps1 uninstall
```

Log proses otomatis disimpan di `logs/bot-YYYY-MM-DD.log`. Jangan menjalankan
proses manual dan Task Scheduler bersamaan karena keduanya memakai sesi
WhatsApp yang sama.

### Linux (Arch)
```bash
sudo pacman -Syu
sudo pacman -S nodejs npm yt-dlp ffmpeg fontconfig noto-fonts-emoji
npm install --legacy-peer-deps
node index.js
```

### Linux (Debian/Ubuntu)
```bash
sudo apt install nodejs npm ffmpeg fontconfig fonts-noto-color-emoji
pip3 install --break-system-packages -U yt-dlp
npm install --legacy-peer-deps
node index.js
```

Node.js **wajib versi 20+** (dicek: `node --version`).

---

## 4. Semua Command

Ketik `/help` di chat bot buat lihat daftar terkini (tampilan beda dikit
untuk grup vs pribadi, owner vs user biasa). Ringkasannya:

| Kategori | Command |
|---|---|
| **Akun** *(pribadi)* | `/daftarbot [nama]`, `/deleteuser` |
| **Keuangan** | `/masuk`, `/keluar`, `/rekap`, `/riwayat`, `/unduhrekap`, foto+caption `/struk` |
| **To-Do** | `/todo`, `/listtodo`, `/done` |
| **Reminder & Alarm** | `/reminder on/off` (per-user), `/alarm [jam] [pesan]`, `/stopalarm`, `/listalarm`, `/hapusalarm` |
| **Media** | foto+caption `/stiker [teks]`, `/download [link] [format] \| [caption]`, foto+caption `/ai` (analisis gambar) |
| **Brat** | `/brat [teks]`, `/bratvid [teks]` (animasi) |
| **Fake Chat** | `/fakechat [teks pesan]` — generate screenshot chat WA palsu |
| **Utilitas** | `/kirim [nomor] [pesan]`, reply stiker + `/kirim [nomor]` (forward) |
| **AI Assistant** | `/ai [pertanyaan/perintah]` — chat bebas atau jalanin aksi (catat transaksi, todo, dll) via bahasa natural |
| **Admin** *(`OWNER_NUMBERS`)* | `/listuser`, `/adminhapususer [nama]`, `/testreminder`, `/ping [text]` (grup), `/alert [text]`, `/botonline`/`/botoffline` (grup), `/allreminder [on/off]` (nyala/matiin reminder semua user sekaligus) |

**Group activation:** bot silent di grup sampai owner jalanin `/botonline`
di grup itu. Command finansial/personal tetap cuma jalan di chat pribadi;
di grup cuma `/ai`, `/botonline`/`/botoffline`, dan broadcast admin.

---

## 5. Struktur File

```
bot-whatsapp-asy/
├── index.js              # Entry point: koneksi WA, semua command, scheduler
├── sheets.js              # Baca/tulis Google Sheets
├── gemini.js               # Integrasi AI: chat, function calling, baca struk
├── brat-advanced.js         # Generator stiker Brat
├── fakechat.js               # Generator fake chat screenshot
├── package.json / package-lock.json
├── Dockerfile
├── update.sh                  # (opsional, dibuat sendiri) skrip redeploy
├── .npmrc                       # Izin dependency Git Baileys untuk npm 12+
├── .env                          # JANGAN commit
├── .env.example
├── service-account.json           # JANGAN commit (di-gitignore)
├── auth_session/                    # Sesi login WA (auto-generated, jangan hapus sembarangan)
├── temp/                              # File temporary /download (auto terhapus)
├── windows/
│   ├── install-fonts.ps1                # Daftarkan font bundled ke Windows
│   ├── manage-bot.ps1                  # Install/start/stop auto-start Windows
│   └── run-bot.ps1                     # Runner Task Scheduler + logging
├── fonts/
│   ├── arialnarrow.ttf                 # Font stiker Brat
│   └── sfprodisplayregular.otf          # Font /fakechat
└── assets/
    ├── bg.jpg                          # Background /fakechat
    └── emoji/*.png                      # Emoji bar reaksi /fakechat
```

---

## 6. Troubleshooting

**QR tidak muncul / loop "Koneksi terputus" terus** — hapus session lalu login ulang:
```bash
# Docker:
sudo docker exec -it bot-wa-running rm -rf /app/auth_session && sudo docker restart bot-wa-running
# Linux tanpa Docker:
rm -rf auth_session && node index.js
```

```powershell
# Windows tanpa Docker:
Remove-Item -LiteralPath .\auth_session -Recurse -Force
node index.js
```

**`Stream Errored (ack)` sering muncul** — bug internal library Baileys
(auto-reconnect, bot tetap jalan). Pastikan cuma 1 instance bot yang jalan
(lihat peringatan di Bagian 2), dan `npm ci --legacy-peer-deps` buat pastiin versi
Baileys terbaru.

**`EBADENGINE`** — Node.js kurang dari v20, update dulu.

**`ERESOLVE` / konflik peer-dependency saat `npm install`** — selalu pakai
`--legacy-peer-deps`:
```bash
rm -rf node_modules
npm ci --legacy-peer-deps
```

Windows PowerShell (jangan hapus `package-lock.json` untuk install normal):
```powershell
Remove-Item -LiteralPath .\node_modules -Recurse -Force
npm.cmd ci --legacy-peer-deps
```

**PowerShell menolak `npm.ps1` karena execution policy** — gunakan `npm.cmd`
seperti pada contoh Windows. Tidak perlu menurunkan kebijakan keamanan sistem.

**`Cannot find module 'canvas'` atau `Cannot find module
'../build/Release/canvas.node'` di Windows:**
```powershell
npm.cmd rebuild canvas --foreground-scripts
node -e "require('canvas'); console.log('canvas OK')"
```

Kalau clean install dengan npm 12 menampilkan `EALLOWGIT`, pastikan file
`.npmrc` dari repository tidak hilang, lalu ulangi `npm.cmd ci
--legacy-peer-deps`.

**Docker: `failed to connect to the docker API`** — daemon belum jalan:
```bash
sudo systemctl enable --now docker
```

**`/download` gagal khusus buat TikTok** (`Unable to extract universal
data for rehydration`) — TikTok lagi ngetatin anti-bot, ini isu upstream di
yt-dlp maupun provider fallback (`@tobyg74/tiktok-api-dl` — otomatis coba 3
provider berurutan). Kalau semua provider gagal, biasanya sementara —
`yt-dlp -U` buat update, atau tunggu beberapa hari sampai provider-nya
nyesuain diri. YouTube & platform lain harusnya nggak kena isu ini.

**`/brat`, `/bratvid`, `/fakechat` error atau emoji nggak muncul berwarna**
1. Native deps buat `canvas` belum lengkap (Docker sudah handle otomatis):
   ```bash
   # Arch: sudo pacman -S cairo pango libjpeg-turbo giflib librsvg fontconfig
   # Debian/Ubuntu: sudo apt install libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev fontconfig
   ```
2. Error `Cannot find module '../build/Release/canvas.node'` → `npm rebuild canvas --legacy-peer-deps`
3. `/fakechat` emoji-nya pakai PNG bundled di `assets/emoji/` (bukan font sistem), jadi harusnya selalu muncul berwarna tanpa install tambahan — kalau error, cek folder `assets/emoji/` dan `fonts/sfprodisplayregular.otf` ada di project.
4. `/bratvid` nggak bergerak -> cek dukungan WebP dengan `ffmpeg -codecs`. Di
   Windows PowerShell bisa difilter dengan `ffmpeg -codecs | Select-String webp`.

**`Kamu belum terdaftar` padahal sudah `/daftarbot`** — JID `@lid` kadang
berubah antar sesi (isu belum ke-root-cause sepenuhnya). Coba
`/deleteuser` lalu `/daftarbot` ulang.

**Grup tidak merespons meski sudah `/botonline`** — cek sheet
`GroupSettings` kolom `IsActive` = `TRUE`, pastikan `OWNER_NUMBERS` di
`.env` sesuai akun yang jalanin `/botonline`, dan cek log error:
```bash
sudo docker logs bot-wa-running | grep -A 5 ERROR
```
