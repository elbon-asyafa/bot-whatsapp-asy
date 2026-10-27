# Bot WhatsApp ASY

Bot utilitas untuk **grup dan chat pribadi**. Langsung ketik command setelah
nomor bot tersambung; tidak perlu daftar, allowlist, atau aktivasi grup.
Tidak menggunakan Google Sheets, service account, database, keuangan,
todo, alarm, reminder, atau scan struk.

## Command

| Command | Fungsi |
|---|---|
| `/help` | Tampilkan bantuan |
| `/download [link] [mp4/mp3] \| [caption]` | Download YouTube/TikTok, default MP4 |
| Foto + caption `/stiker [atas \| bawah]` | Stiker foto, dengan teks opsional |
| Reply foto + `/stiker` atau `/sticker` | Stiker dari foto yang dibalas |
| `/brat [teks]` | Stiker teks statis |
| `/bratvid [teks]` | Stiker teks animasi kata per kata |
| `/fakechat [pesan] \| [21.30]` | Gambar fakechat dengan jam opsional |
| `/ai [pertanyaan]` | Jawaban Gemini, memerlukan API key |
| Foto + caption `/ai [pertanyaan]` atau reply foto | Analisis gambar dengan Gemini |
| `/ping [pesan]` | Tag semua anggota; khusus admin grup atau owner bot |
| `/kirim [628...] [pesan]` atau reply stiker + `/kirim [628...]` | Forward; khusus owner bot |

Semua fitur umum tersedia untuk siapa saja di grup dan chat pribadi. Bot
mengabaikan pesan yang dikirim dari akun bot sendiri, status, dan channel.
Uji command dari akun WhatsApp lain. Grup tidak memerlukan `/botonline`.
`/alert` dan command admin untuk user/reminder dihapus bersama fitur lama.

AI hanya menjawab pesan saat itu, tanpa history tersimpan atau akses aksi bot.
Pesan/gambar yang dikirim dengan `/ai` diteruskan ke Gemini. Bot tidak
mengunggah chat lain. Command dan isi chat tidak dicatat rutin di terminal;
log error dapat berisi diagnostik dari dependency, jadi jangan bagikan log
mentah tanpa memeriksanya.

Batas: 6 command berat per menit per pengirim per chat, 2 pekerjaan bersamaan,
1 download bersamaan, gambar 10 MB, download 60 MB/15 menit/3 menit waktu
proses, dan Brat maksimal 300 karakter/30 kata. Caption MP3 dikirim sebagai
pesan terpisah karena pesan audio WA tidak memiliki caption teks.

## Menjalankan di Linux Mint

Gunakan **Node.js 24 LTS**. Pada mesin yang diaudit, Node 24 sudah terpasang.
Jika memakai nvm, jalankan `nvm install` lalu `nvm use` dari folder repo.

Pasang paket sistem dari terminal (memerlukan password sudo lokal):

```bash
sudo apt update
sudo apt install ffmpeg fontconfig fonts-noto-color-emoji
```

Pasang dependency dan downloader:

```bash
npm ci --legacy-peer-deps
npm run setup:downloader
```

Installer downloader mengambil rilis stable resmi yt-dlp, memverifikasi
SHA-256, dan memasangnya di `.tools/` dalam repo. Tidak mengubah Python atau
yt-dlp sistem. Jalankan kembali command itu untuk memperbarui downloader.
Binary Linux x64 sudah menyertakan dependensi downloader/EJS; Node 24
project dipakai sebagai JS runtime. [Rujukan upstream](https://github.com/yt-dlp/yt-dlp/wiki/EJS).
Untuk arsitektur Linux lain, installer memakai binary Python zipimport;
Python 3 yang kompatibel perlu tersedia. Windows memakai executable Windows.

Jika canvas tidak dapat memakai binary bawaan dan perlu build dari source:

```bash
sudo apt install build-essential python3 pkg-config libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
npm rebuild canvas --foreground-scripts
```

Konfigurasi opsional:

```bash
cp .env.example .env
```

- `GEMINI_API_KEY`: isi hanya jika ingin `/ai`; ambil dari [Google AI Studio](https://aistudio.google.com/apikey).
- `GEMINI_MODEL`: default `gemini-3.1-flash-lite`.
- `OWNER_NUMBERS`: nomor owner, contoh `6281234567890`, pisah koma jika lebih dari satu. Bisa juga JID `12345@lid`. Hanya diperlukan untuk `/kirim` atau hak owner pada `/ping`.
- `YT_DLP_PATH` / `FFMPEG_PATH`: opsional, path executable tanpa argumen. Jika `YT_DLP_PATH` kosong, `.tools/yt-dlp` diprioritaskan sebelum PATH sistem.
- `AUTH_DIR`: default `auth_session`, relatif terhadap folder repo.

Tanpa `.env`, fitur non-AI sudah bisa dipakai. Jangan kirim key atau isi sesi
WA ke chat dan jangan commit file tersebut. `.env` lama dengan pengaturan
Sheets tidak lagi dibaca untuk fitur lama; ganti dengan template baru jika
menginginkan konfigurasi yang bersih.

Periksa instalasi:

```bash
npm run check
npm test
npm start
```

Scan QR dari HP: **WhatsApp → Perangkat tertaut → Tautkan perangkat**.
Setelah muncul pesan tersambung, kirim `/help` dari akun lain. Tidak ada
operasi Google Sheets saat startup. Spreadsheet lama di akun Google tetap
utuh; aplikasi ini tidak menghapus atau memigrasikannya.

## Auto-start Linux Mint

Lakukan setelah login QR manual berhasil. Hentikan proses manual dengan
Ctrl+C sebelum menyalakan service:

```bash
node linux/manage-bot.js install
node linux/manage-bot.js start
node linux/manage-bot.js status
node linux/manage-bot.js logs
```

Kontrol lainnya:

```bash
node linux/manage-bot.js stop
node linux/manage-bot.js restart
node linux/manage-bot.js uninstall
```

Service berjalan sebagai user biasa, otomatis saat login, dengan Node dari
instalasi yang sedang dipakai. Jika path Node berubah setelah upgrade nvm,
install ulang unit. Script menolak menimpa unit yang berbeda: backup atau
hapus file `~/.config/systemd/user/bot-whatsapp-asy.service` lama lebih dulu.
Bot berhenti bekerja selama PC mati/suspend. Untuk berjalan sejak boot tanpa
login, user dapat mengaktifkan linger secara eksplisit:

```bash
sudo loginctl enable-linger "$USER"
```

Bot memakai `.bot.lock` untuk mencegah dua proses lokal sekaligus. Jangan
menjalankan service, Docker, dan proses manual dengan sesi WA yang sama.

## Docker (opsional)

Image menggunakan Node 24, FFmpeg dan yt-dlp dalam virtualenv. File rahasia,
sesi, dependency lokal, serta `.tools` tidak masuk image.

```bash
cp .env.example .env
sudo docker build -t bot-wa-asy .
sudo docker volume create bot-wa-auth
sudo docker run -d --name bot-wa-running --env-file .env --restart unless-stopped \
  --mount type=volume,source=bot-wa-auth,target=/app/auth_session bot-wa-asy
sudo docker logs -f bot-wa-running
```

Untuk update: `git pull`, lalu `./update.sh`. Image dibangun sebelum bot lama
dihentikan, dan login disimpan pada volume `bot-wa-auth`.

Jika container lama belum memakai volume, script menolak menghapusnya.
Hentikan container, backup sesinya dengan `docker cp`, lalu migrasikan isi
backup ke volume dan pastikan dimiliki UID/GID 1000 sebelum memakai image
baru. Jangan hapus container lama sampai backup terverifikasi. Sesuaikan
`AUTH_DIR` ke `/app/auth_session` jika `.env` memiliki override lama.

`docker-clean.sh` hanya menawarkan pembersihan dangling image secara interaktif;
tidak menghapus volume/sesi.

## Windows

Node 24, FFmpeg, dan Git diperlukan. Lalu dari root repo:

```powershell
npm.cmd ci --legacy-peer-deps
npm.cmd run setup:downloader
Copy-Item .env.example .env
npm.cmd run check
npm.cmd start
```

Integrasi Task Scheduler yang ada di folder `windows/` tetap tersedia.
Pastikan FFmpeg ada di PATH task. Untuk auto-start, setelah scan QR dan
mematikan proses manual:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows\manage-bot.ps1 install
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows\manage-bot.ps1 start
```

## Troubleshooting

- **`npm ci` / EALLOWGIT:** Baileys 6 memakai dependency Git yang dipin dalam lockfile. `.npmrc` repo mengizinkan sumber Git tersebut. npm 12 juga memakai `allowScripts` eksplisit untuk paket native; jangan menghapus konfigurasi itu. Gunakan lockfile untuk clean install.
- **Gagal download:** jalankan `npm run setup:downloader`, periksa `npm run check`, dan coba link publik biasa. Video private/berbayar, pembatasan jaringan, login/cookie, atau perubahan provider tetap bisa membuat download gagal. Tidak ada fallback ke layanan TikTok pihak ketiga.
- **Sesi logout/diganti perangkat lain:** service berhenti dengan kode 78 agar tidak loop login. Hentikan semua instance, backup/rename `auth_session`, lalu `npm start` dan scan ulang jika memang logout. Jangan hapus sesi untuk setiap error jaringan.
- **`/kirim` menolak owner:** nomor WhatsApp bisa disampaikan sebagai LID. Bot memakai alternate JID dari pesan bila tersedia; bila tidak tersedia, isi JID `@lid` owner di `OWNER_NUMBERS`.
- **Bratvid:** animasi dibuat dengan Sharp, tidak memerlukan FFmpeg. FFmpeg diperlukan untuk download dan konversi MP3/MP4.

## Struktur dan pemeriksaan

`index.js` menangani WhatsApp dan command; `lib/` menangani konfigurasi,
akses owner, proses eksternal tanpa shell, download, teks meme, dan metadata
stiker; `gemini.js` memakai SDK `@google/genai`; `brat-advanced.js` dan
`fakechat.js` menghasilkan gambar; `scripts/check.js` memeriksa instalasi.

`npm test` mencakup akses grup/pribadi tanpa pendaftaran, admin, batch pesan,
replay, input URL, batas request, cleanup download, lock proses, dan hasil
media native termasuk animasi. Tes memakai mock untuk layanan WA/Gemini dan
unduhan jaringan; koneksi nyata harus diverifikasi saat login.

Baileys dipin pada patch legacy 6.7.24. v7 upstream masih RC dan tidak
ditingkatkan otomatis.
