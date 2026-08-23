# bot-whatsapp-asy — Project Context / Handoff Doc (v1)

> Dokumen ini dibuat supaya bisa langsung di-attach/paste ke chat AI mana pun
> (Claude, ChatGPT, Gemini, dll) agar AI tersebut langsung paham konteks
> project ini tanpa perlu dijelaskan dari nol. Ini dokumen v1 untuk nama
> project baru **bot-whatsapp-asy** — sebelumnya project ini bernama
> `wa-bot-keuangan-todo` dan hanya fokus ke keuangan + to-do. Nama & scope
> project diperluas karena fungsionalitas bot sekarang jauh lebih luas
> (reminder & alarm, stiker, download video, forward pesan, AI assistant
> dengan function calling, dsb). Kalau ada perubahan besar setelah dokumen
> ini dibuat, tolong update lagi.

**Repo GitHub**: `https://github.com/elbon-asyafa/bot-whatsapp-asy.git` —
kalau AI yang baca dokumen ini punya akses tools untuk clone/browse repo
(misalnya `bash_tool` + akses jaringan ke `github.com`), langsung `git
clone` repo ini duluan sebelum mulai kerja, jangan minta user paste/upload
file manual lagi. Kalau AI-nya belum punya akses seperti itu, minta user
paste isi file yang relevan.

**PENTING**: kalau baru clone, cek dulu `git log --oneline -10` sebelum
mulai kerja atau bikin patch baru — jangan asumsi kondisi repo masih persis
seperti yang dideskripsikan di dokumen ini, karena bisa saja sudah ada
perubahan lanjutan di luar dokumen ini.

---

## 1. Apa project ini

**bot-whatsapp-asy** adalah bot WhatsApp pribadi/multi-user berbasis
Node.js yang awalnya cuma buat catat keuangan & to-do list, tapi sekarang
sudah berkembang jadi bot serbaguna dengan banyak fitur tambahan: reminder
otomatis, alarm custom, scan struk pakai AI, pembuatan stiker WhatsApp,
download video dari YouTube/TikTok, forward pesan/stiker ke nomor lain,
dan asisten AI (Gemini) yang bisa diajak ngobrol bebas ATAU disuruh
menjalankan aksi langsung di bot lewat bahasa natural (function calling).

Bot ini **multi-user**: setiap orang mendaftar sendiri lewat command
`/daftarbot [nama]`, lalu otomatis dibuatkan sheet keuangan & to-do sendiri
di Google Sheets (data antar-user terpisah, tidak tercampur). Setelah
daftar, admin/pemilik bot (`OWNER_NUMBERS`) perlu meng-approve akses fitur
lengkap lewat `ALLOWED_NUMBERS` di `.env` (atau dikosongkan supaya semua
yang sudah daftar otomatis dapat akses — cocok untuk pemakaian personal).

**Google Sheets adalah satu-satunya database** — tidak ada database
lain (SQLite/MySQL/dsb). Semua data (user, transaksi keuangan, to-do,
alarm, kontak) disimpan & dibaca langsung dari spreadsheet lewat
`googleapis`.

Nama sebelumnya `wa-bot-keuangan-todo` **masih dipakai** di `package.json`
(field `name`) dan sebagian folder/dokumentasi lama — belum di-rename total
ke `bot-whatsapp-asy`, cuma repo GitHub-nya yang sudah pakai nama baru.

---

## 2. Tech Stack

| Komponen | Library/Tool | Catatan |
|---|---|---|
| Runtime | Node.js **20+** | Wajib 20+ karena `@whiskeysockets/baileys` mensyaratkannya. Lihat bagian Docker untuk histori masalah versi Node. |
| Koneksi WhatsApp | `@whiskeysockets/baileys` (`^6.7.9`) | Library WhatsApp Web multi-device (unofficial), tanpa API resmi/berbayar |
| Auth session WA | `useMultiFileAuthState` (bawaan Baileys) | Session tersimpan di folder `auth_session/`, JANGAN dihapus kecuali sedang troubleshoot |
| Database | **Google Sheets** via `googleapis` (`^144.0.0`) | Satu-satunya sumber data; tidak ada DB lain |
| Kredensial Google | Service Account (`service-account.json`) | Dibuat manual lewat Google Cloud Console, di-share ke spreadsheet sebagai Editor |
| AI | `@google/generative-ai` (`^0.21.0`), model **`gemini-3.1-flash-lite`** | Dipakai untuk `/ai` (chat + function calling) dan analisis struk (`/struk`). Model ini hasil keputusan sadar — pernah dicoba `gemini-3.5-flash` tapi diminta balik ke `gemini-3.1-flash-lite`. |
| Export Excel | `xlsx` (SheetJS, `^0.18.5`) | Untuk `/unduhrekap` |
| Stiker | `wa-sticker-formatter` (`^4.4.4`) + `jimp` (`^0.22.12`) + **`node-canvas` (`^3.2.3`)** + **`fluent-ffmpeg` (`^2.1.3`)** | **Sengaja pakai `jimp`, BUKAN `sharp`** — `sharp` pernah gagal total (`ERR_DLOPEN_FAILED`) di environment yang dipakai sebelumnya. `node-canvas` dipakai untuk stiker Brat (statis & animasi) dengan font Arial Narrow, `fluent-ffmpeg` untuk gabung frame animasi jadi WebP |
| Download video | `yt-dlp` (binary eksternal, bukan npm package) | Dicari otomatis: prioritas file lokal di folder project (`yt-dlp.exe`/`yt-dlp`), fallback ke command global di PATH sistem (misal hasil install via `pacman`/`apt`) |
| Error handling koneksi | `@hapi/boom` (`^10.0.1`) | Dipakai Baileys untuk parsing alasan disconnect |
| Logging | `pino` (`^9.5.0`) | Logger internal Baileys |
| QR code login | `qrcode-terminal` (`^0.12.0`) | Menampilkan QR untuk scan login WA di terminal |
| Env config | `dotenv` (`^16.4.5`) | Baca `.env` |
| Containerization | **Docker**, base image `node:20-slim` | Debian slim dipakai karena `node-canvas` lebih stabil di glibc daripada Alpine/musl. Lihat Bagian 6 untuk histori lengkap |

**Instalasi dependency WAJIB pakai flag `--legacy-peer-deps`**
(`npm install --legacy-peer-deps`), karena ada konflik *peer dependency*
antara `@whiskeysockets/baileys` (minta `jimp@^1.x`) dengan versi `jimp`
yang benar-benar dipakai project ini (`jimp@0.22.x`, versi lama yang
API-nya dipakai untuk fitur stiker). Keduanya sebenarnya tidak bentrok
secara fungsional, npm-nya saja yang strict soal versi. **Jangan pakai
`--force`**, harus `--legacy-peer-deps`.

---

## 3. Struktur File Repo

```
bot-whatsapp-asy/
├── index.js               # Entry point utama: koneksi WhatsApp (Baileys), routing
│                           # semua command, scheduler reminder & alarm, handler
│                           # media (stiker/download/struk), logic multi-user & admin
├── sheets.js               # Semua fungsi baca/tulis ke Google Sheets (CRUD user,
│                           # transaksi keuangan, to-do, alarm, kontak, dsb)
├── gemini.js                # Integrasi AI: system instruction, daftar tools/function
│                           # calling untuk /ai, chat bebas, dan analisis foto struk
├── brat-advanced.js          # Generator stiker Brat (statis & animasi)
├── package.json
├── package-lock.json
├── Dockerfile               # Definisi image Docker (lihat Bagian 6)
├── .env                       # Kredensial & konfigurasi runtime (JANGAN commit/share)
├── .env.example                # Template .env, aman untuk commit ke repo
├── .gitignore                   # Mengabaikan node_modules/, .env, service-account.json,
│                                # auth_session/, temp/
├── service-account.json          # Kredensial Google Service Account (TIDAK ada di repo,
│                                 # user tambahkan sendiri, di-gitignore)
├── auth_session/                   # Sesi login WhatsApp (auto-generated oleh Baileys,
│                                   # di-gitignore, jangan dihapus kecuali troubleshoot)
├── temp/                             # File video sementara hasil /download, auto terhapus,
│                                     # di-gitignore
└── fonts/                                  # Font untuk stiker Brat
    └── arialnarrow.ttf
```

Catatan: `service-account.json`, `.env`, `auth_session/`, dan `temp/`
semuanya di-gitignore — tidak pernah ada di repo GitHub, harus dibuat/isi
sendiri oleh siapa pun yang menjalankan bot ini (lihat README.md untuk
langkah setup lengkap).

---

## 4. Arsitektur & Alur Kerja Inti

### 4.1 Alur pendaftaran & otorisasi user
1. User baru chat `/daftarbot [nama]` ke bot (chat pribadi, bukan grup).
2. `sheets.daftarUser()` membuat baris user baru di sheet `Users`, sekaligus
   otomatis membuat sheet `Keuangan_<nama>` dan `Todo_<nama>` khusus untuk
   user itu (lewat `createSheetIfNotExists`).
3. User yang baru daftar **belum otomatis bisa akses fitur** (catat uang,
   todo, dll) — hanya `/daftarbot` dan `/help` yang selalu terbuka.
4. Admin (pemilik bot, didefinisikan di `OWNER_NUMBERS`) harus menambahkan
   JID user itu ke `ALLOWED_NUMBERS` di `.env` (lalu restart bot), ATAU
   `ALLOWED_NUMBERS` dikosongkan sepenuhnya supaya SEMUA yang sudah
   `/daftarbot` otomatis mendapat akses fitur (cocok untuk pemakaian
   personal/santai, direkomendasikan di `.env.example`).
5. Fungsi `bolehAksesFitur(sender)` di `index.js` yang menegakkan aturan
   ini di setiap command (selain `/daftarbot` dan `/help`).

### 4.2 Identifikasi user: JID vs nomor asli
- Bot mengenali user lewat JID WhatsApp (`<nomor>@s.whatsapp.net` atau
  varian `@lid`).
- **Isu yang belum sepenuhnya di-root-cause**: sebagian kontak bisa dapat
  JID `@lid` yang berbeda-beda antar sesi/pesan, membuat bot kadang gagal
  mengenali user yang sebenarnya sudah terdaftar.
- Sebagai mitigasi, bot punya fallback pakai "nomor asli" (nomor telepon
  polos) untuk mengenali ulang user kalau JID `@lid`-nya berubah
  (`getNamaByJid(jid, nomorAsli)`, `updateJidUser()`). Kalau tetap gagal,
  solusi manual: `/deleteuser` lalu `/daftarbot` ulang.

### 4.3 Reminder & Alarm (scheduler)
- Bot punya scheduler berjalan (interval timer di `index.js`) untuk dua
  jenis reminder otomatis:
  - **Rekap keuangan otomatis** setiap 2 jam (`DUA_JAM_MS`) — hanya untuk
    user yang reminder-nya aktif (`/reminder on`).
  - **Reminder to-do** setiap 15 menit (`LIMA_BELAS_MENIT_MS`) — untuk
    to-do yang belum selesai hari itu.
- **Alarm** (`/alarm [jam] [pesan]`) berbeda dari reminder di atas: alarm
  bersifat sekali-jalan pada jam tertentu yang di-set user sendiri, dan
  akan **spam berulang tiap menit** sampai user mematikannya lewat
  `/stopalarm`. Waktu memakai zona Jakarta (UTC+7), dihitung manual lewat
  math (`waktuSekarangJakarta()`) supaya tidak bergantung pada
  locale/ICU sistem.

### 4.4 Integrasi AI (`/ai` dan `/struk`)
- `gemini.js` mendefinisikan `SYSTEM_INSTRUCTION` (bahasa Indonesia santai,
  aturan format khusus WhatsApp — larangan markdown `**bold**`/heading,
  hanya boleh satu tanda bintang `*bold*`) dan daftar **tools/function
  declarations** yang boleh dipanggil model: `catat_transaksi`,
  `tambah_todo`, `tandai_todo_selesai`, `get_rekap_keuangan`,
  `get_daftar_todo`.
- Command `/ai [pertanyaan/perintah]` bisa dipakai untuk ngobrol bebas ATAU
  menyuruh bot menjalankan aksi nyata lewat bahasa natural (misal: "catat
  keluar 15000 buat makan siang", "tambahin todo beli galon") — model
  betulan memanggil fungsi backend lewat function calling, bukan sekadar
  menjawab teks.
- Kirim foto struk + caption `/struk` akan memicu `analisisStruk()` (model
  vision) untuk membaca nominal & keterangan dari struk, lalu otomatis
  dicatat sebagai transaksi.
- Model yang dipakai: **`gemini-3.1-flash-lite`** untuk chat, function
  calling, maupun analisis gambar struk.

### 4.5 Fitur grup vs chat pribadi
- Command Akun/Keuangan/To-Do/Admin **hanya bisa dipakai di chat
  pribadi ke bot**, tidak bisa di grup.
- Di grup, fitur yang tersedia hanya `/ai` (AI assistant umum) dan
  broadcast admin (`/notif`).
- **Fitur grup/patungan yang lebih kompleks (split bill dkk) sudah
  dihapus total** dari versi awal project atas permintaan pemilik project —
  fokus sekarang personal/multi-user lewat chat pribadi. **Jangan
  asumsikan fitur grup lama ini perlu dibangun ulang** kecuali diminta
  eksplisit.

---

## 5. Daftar Lengkap Fitur/Command Bot (sesuai `/help` di `index.js`)

### Akun (chat pribadi saja)
- `/daftarbot [nama]` — daftar user baru (wajib sebelum command lain)
- `/deleteuser` — hapus akun & semua data milik user itu (butuh konfirmasi)

### Keuangan
- `/masuk [nominal] [keterangan]` — catat pemasukan
- `/keluar [nominal] [keterangan]` — catat pengeluaran
- `/rekap` — ringkasan keuangan hari ini
- `/riwayat [jumlah]` — lihat transaksi terakhir (default 10)
- `/unduhrekap` — download data keuangan sebagai file Excel
- Kirim foto struk + caption `/struk` — struk otomatis dibaca AI & dicatat

### To-Do List
- `/todo [task]` — tambah tugas
- `/listtodo` — lihat to-do hari ini
- `/done [nomor]` — tandai tugas selesai

### Reminder & Alarm
- `/reminder on` / `/reminder off` — nyalakan/matikan reminder otomatis
- `/reminder` — cek status reminder
- `/alarm [jam] [pesan]` — set alarm sekali-jalan (contoh: `/alarm 20:20
  mau coding`)
- `/stopalarm` — matikan alarm yang sedang bunyi (spam tiap menit sampai
  di-stop)
- `/listalarm` — lihat alarm aktif
- `/hapusalarm [nomor]` — hapus alarm

### Media
- Kirim foto + caption `/stiker` — convert foto jadi stiker WhatsApp
- Kirim foto + caption `/stiker [teks]` — stiker + teks meme
- Kirim foto + caption `/stiker [atas]|[bawah]` — teks di atas & bawah
  sekaligus
- `/download [link]` — download video YouTube/TikTok (maks 60MB, batasan
  ukuran file WhatsApp)
- `/brat [teks]` — stiker statis Brat (Arial Narrow, blur 1.5px, noise grain, kiri atas)
- `/bratvid [teks]` — stiker animasi Brat kata per kata (WebP animasi)

### Utilitas
- `/kirim [nomor] [pesan]` — kirim pesan lewat bot ke nomor lain
- Reply stiker + `/kirim [nomor]` — forward stiker itu ke nomor lain

### AI Assistant
- `/ai [perintah/pertanyaan]` — ngobrol bebas dengan AI, atau menyuruh bot
  menjalankan aksi lewat bahasa natural (function calling)

### Admin (khusus `OWNER_NUMBERS`, hanya di chat pribadi)
- `/listuser` — lihat semua user terdaftar
- `/adminhapususer [nama]` — hapus akun user manapun
- `/testreminder` — tes kirim reminder sekarang juga
- `/notif [pesan]` — kirim & tag notifikasi ke grup (di grup: grup itu
  saja; di DM: broadcast ke semua grup)
- `/ping [text]` — tag semua member grup (hanya di grup)
- `/alert [text]` — kirim info ke semua user & grup

### Umum
- `/help` — tampilkan daftar command (tampilan menyesuaikan otomatis:
  beda sedikit kalau dipanggil dari grup vs chat pribadi, dan beda kalau
  dipanggil oleh owner vs user biasa)

---

## 6. Riwayat Dockerisasi (WAJIB dipahami AI yang membaca dokumen ini)

Bot ini sudah di-containerize dengan Docker untuk deployment yang lebih
stabil (dari sebelumnya dijalankan langsung via `node index.js` / `pm2` di
mesin lokal/server). Berikut riwayat lengkap proses & keputusan
teknisnya:

### 6.1 Masalah yang ditemukan & solusinya

**A. Konflik peer dependency (`ERESOLVE`)**
- **Kendala**: `npm install` gagal karena konflik versi peer dependency
  antara `jimp` (versi yang dipakai project, `0.22.x`) dan
  `@whiskeysockets/baileys` (yang meminta `jimp@^1.x`).
- **Solusi**: selalu jalankan `npm install` dengan flag
  **`--legacy-peer-deps`**. Ini WAJIB, bukan opsional, dan berlaku baik di
  environment lokal maupun di dalam Dockerfile.

**B. Ketidakcocokan versi Node.js (`EBADENGINE`)**
- **Kendala**: `@whiskeysockets/baileys` mensyaratkan **Node.js v20+**,
  sementara base image Docker yang awalnya dipakai adalah `node:18-alpine`
  (Node 18), sehingga muncul warning/error `EBADENGINE`.
- **Solusi**: base image Dockerfile pernah diperbarui dari `node:18-alpine`
  menjadi Node 20+. Setelah fitur stiker Brat memakai `node-canvas`, base
  image final sekarang **`node:20-slim`** (Debian/glibc), karena `canvas`
  sering timeout/bermasalah saat compile di Alpine/musl.

**C. Storage/disk penuh akibat build berulang**
- **Kendala**: proses `docker build` yang dilakukan berulang kali menghabiskan
  kapasitas penyimpanan (disk) karena image lama & cache yang menumpuk.
- **Solusi**:
  - Membersihkan image yang tidak terpakai & cache Docker secara manual
    dengan:
    ```bash
    sudo docker system prune -a --volumes
    ```
  - Menambahkan pembersihan cache npm langsung di dalam `Dockerfile` supaya
    image hasil build lebih kecil:
    ```dockerfile
    RUN npm install --legacy-peer-deps && npm cache clean --force
    ```

**D. Docker daemon tidak auto-start**
- **Kendala**: service Docker daemon tidak otomatis menyala saat server/
  laptop di-restart, menyebabkan error `failed to connect to the docker
  API`.
- **Solusi**: mengaktifkan Docker daemon supaya berjalan otomatis sejak
  boot sistem:
  ```bash
  sudo systemctl enable --now docker
  ```

### 6.2 Struktur `Dockerfile` final

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

Catatan penting soal isi Dockerfile ini:
- `node:20-slim` dipilih spesifik karena wajib Node 20+ dan lebih aman untuk
  `node-canvas` dibanding Alpine/musl. Jangan turunkan ke Node 18.
- `RUN apt-get install ...` — Install `ffmpeg`, `yt-dlp`, dependensi sistem
  yang dibutuhkan `node-canvas` (cairo, pango, jpeg, giflib, librsvg,
  fontconfig), dan tool build (`build-essential`, `python3`).
- `COPY package*.json ./` dilakukan **sebelum** `COPY . .` secara sengaja
  supaya Docker layer caching bekerja optimal — `npm install` tidak perlu
  diulang setiap build kalau hanya source code yang berubah, bukan
  dependency-nya.
- `npm cache clean --force` ditambahkan di baris yang sama dengan
  `npm install` (bukan `RUN` terpisah) supaya cache yang dibersihkan tidak
  ikut tersimpan permanen di layer sebelumnya.

### 6.3 Cara build & menjalankan container

```bash
# Build Docker image
sudo docker build -t bot-wa-asy .

# Jalankan container: detached (-d), load semua variabel dari .env,
# dan otomatis restart kalau container crash atau server reboot
sudo docker run -d --name bot-wa-running --env-file .env --restart always bot-wa-asy
```

Dua flag berikut **wajib** dipakai saat `docker run`:
- **`--env-file .env`** — memuat seluruh variabel environment (kredensial
  Gemini, Spreadsheet ID, dsb) dari file `.env` ke dalam container, supaya
  tidak perlu hardcode kredensial di Dockerfile/image.
- **`--restart always`** — container otomatis restart kalau proses di
  dalamnya crash, ATAU kalau Docker daemon/server di-restart (mendukung
  kebutuhan bot untuk berjalan 24 jam nonstop).

### 6.4 Monitoring & debugging container

```bash
# Lihat log real-time (termasuk QR code login WhatsApp saat pertama jalan)
sudo docker logs -f bot-wa-running

# Cek status container yang sedang berjalan
sudo docker ps

# Cek penggunaan resource (RAM/CPU)
sudo docker stats
```

### 6.5 Skrip otomasi update (`update.sh`)

Dibuat untuk mempermudah proses menarik update kode terbaru dari Git dan
langsung redeploy container, tanpa perlu mengetik ulang seluruh urutan
perintah Docker satu per satu:

```bash
#!/bin/bash
sudo docker stop bot-wa-running && sudo docker rm bot-wa-running && sudo docker build -t bot-wa-asy . && sudo docker run -d --name bot-wa-running --env-file .env --restart always bot-wa-asy
echo "Update Docker Bot Berhasil!"
```

Alur kerjanya: `stop` container lama → `rm` (hapus) container lama →
`build` ulang image dari kode terbaru (biasanya setelah `git pull`) →
`run` container baru dengan konfigurasi yang sama (`--env-file .env
--restart always`). Skrip ini idealnya dijalankan setelah `git pull`
di direktori project.

---

## 7. Keputusan Teknis Penting (ringkasan, jangan diubah tanpa alasan kuat)

1. **Google Sheets sebagai satu-satunya database** — tidak ada rencana
   pindah ke database lain kecuali diminta eksplisit.
2. **`jimp`, bukan `sharp`**, untuk image processing (stiker) — `sharp`
   pernah gagal total (`ERR_DLOPEN_FAILED`) di environment yang dipakai
   sebelumnya. Konsekuensinya: harus pakai `--legacy-peer-deps` setiap
   `npm install`.
3. **`node-canvas` + `fluent-ffmpeg`** untuk stiker Brat (statis & animasi) — font Arial Narrow, blur 8.4px, tanpa noise, animasi frame-by-frame (pacing sama 0.75s per frame). Butuh native deps (cairo, pango, dll) yang sudah di-handle di Dockerfile.
4. **Base image Docker `node:20-slim`** — wajib Node 20+ untuk Baileys dan lebih stabil untuk `node-canvas`. Install `yt-dlp` via `pip3 install --break-system-packages -U yt-dlp` untuk hindari HTTP 429 TikTok.
5. **Signal Session & Quota Optimization**:
   - Auth state dibungkus `makeCacheableSignalKeyStore` di `index.js` untuk mencegah korupsi file session libsignal.
   - Reconnect delay 20s jika kena HTTP 440 conflict.
   - Scheduler check alarm diubah ke interval 5 menit untuk menghemat kuota Google Sheets API.
5. **Model AI: `gemini-3.1-flash-lite`** — dipertahankan setelah sempat
   dicoba `gemini-3.5-flash` dan diputuskan balik ke `3.1-flash-lite`.
6. **Fitur grup/patungan (split bill) sudah dihapus total** dari versi
   awal — jangan diasumsikan perlu dibangun ulang.
7. **`yt-dlp` sebagai binary eksternal**, bukan npm package — dicari
   otomatis di folder project dulu, baru fallback ke PATH sistem.
8. **Command finansial/personal hanya berlaku di chat pribadi**, tidak di
   grup — di grup hanya `/ai` dan broadcast admin yang aktif.
9. **Isu JID `@lid` yang berubah-ubah untuk sebagian kontak** masih belum
   di-root-cause sepenuhnya; ada mekanisme fallback via nomor asli, tapi
   solusi manual (`/deleteuser` + `/daftarbot` ulang) kadang masih
   dibutuhkan.
10. **Deployment sekarang pakai Docker** (`node:20-slim`,
    `--env-file .env`, `--restart always`) — bukan lagi dijalankan manual
    lewat `node index.js` atau `pm2` langsung di OS host (meskipun cara itu
    tetap didokumentasikan di README sebagai alternatif untuk yang tidak
    pakai Docker).

---

## 8. Instruksi untuk AI yang membaca dokumen ini

1. Baca dulu seluruh dokumen ini sebelum membuat perubahan apa pun ke
   kode.
2. Kalau punya akses `git`/network, clone repo dan cek `git log
   --oneline -10` dulu untuk memastikan state terbaru — jangan asumsikan
   dokumen ini 100% up-to-date dengan kondisi kode saat ini.
3. Jangan hapus atau nonaktifkan flag `--legacy-peer-deps` dari proses
   `npm install` mana pun (baik di README maupun di Dockerfile) tanpa
   alasan kuat — ini WAJIB karena konflik peer dependency `jimp` vs
   `baileys`.
4. Jangan turunkan versi Node.js di bawah 20 di Dockerfile.
5. Jangan bangun ulang fitur grup/patungan (split bill) yang sudah sengaja
   dihapus, kecuali diminta eksplisit oleh pemilik project.
6. Kalau menambah fitur baru, tanyakan dulu ke user — jangan berasumsi.
7. File `.env`, `service-account.json`, `auth_session/`, dan `temp/`
   tidak pernah ada di repo (di-gitignore) — jangan berharap bisa
   membacanya langsung dari GitHub, itu semua kredensial/state lokal milik
   masing-masing yang menjalankan bot.


---

## 7b. Group Activation System (dipilih fitur baru)

`/botonline` dan `/botoffline` membuat admin bisa mengontrol aktif/nonaktif bot per grup secara owner-controlled. Default state: semua grup inactive.

### Families yng baru ditambahkan:

- **GroupSettings.sheet** (GroupJID, GroupName, IsActive, ActivatedBy, timestamps)
- **/botonline** (/botoffline) - owner-cuma, grup-cuma, mengaktifkan/nonaktifkan bot di grup
- **Activation check** - bot silent ignore di grup nonaktif
- **/alert fix** - no duplikasi notifikasi (user menerima private atau group, bukan keduanya)

### Kelakuan:
- Default: semua grup inactive
- Owner: `/botonline` dalam grup → bot aktif di grup itu
- User: bisa pakai semua command (keuangan, todo, AI, dll) dalam aktif grup
- Group deactivation: `/botoffline` (owner-cuma)
- `/alert` sekarang kirim ke user yang tidak bergabung dengan grup (private) + only aktif grup

### Error handling & persistent:

- `setGroupActive()` menggunakan `append` untuk baris baru (bukan `update` ke header)
- `getGroupSetting()` mencari berdasarkan GroupJID (row A) - JID tidak pernah berubah
- `GroupName` row[1] diupdate otomatis saat `/botonline`/`/botoffline` (refresh nama tengah data)

### File yang terlibat:
- `sheets.js` — `GroupSettings!A:G` sheet + `getGroupSetting()`, `setGroupActive()`, `getAllActiveGroups()`
- `index.js` — activation check di `handleCommand()`, `/botonline`/`/botoffline` logic, `/alert` deduplication

