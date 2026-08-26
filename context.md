# bot-whatsapp-asy — Project Context / Handoff Doc

> Dokumen ini buat di-attach ke chat AI mana pun (Claude, ChatGPT, dll)
> supaya langsung paham konteks project tanpa dijelasin dari nol.

**Repo**: `https://github.com/elbon-asyafa/bot-whatsapp-asy.git` — kalau
AI yang baca ini punya akses `git`/network, **clone dulu & cek `git log
--oneline -10`** sebelum mulai kerja. Jangan asumsikan dokumen ini 100%
sinkron sama kode — bisa ada perubahan lanjutan di luar dokumen ini.

---

## 1. Apa Project Ini

Bot WhatsApp pribadi/multi-user (Node.js) yang awalnya cuma keuangan +
to-do, sekarang serbaguna: reminder & alarm, scan struk via AI, stiker
(termasuk Brat & fake-chat-screenshot generator), download video
YouTube/TikTok, forward pesan, dan asisten AI (Gemini) dengan function
calling (bisa disuruh catat transaksi/todo lewat bahasa natural).

Setiap user daftar sendiri (`/daftarbot [nama]`), dapat sheet keuangan &
todo sendiri di Google Sheets (data terpisah antar-user). Setelah daftar,
akses fitur perlu di-approve lewat `ALLOWED_NUMBERS` di `.env` (atau
dikosongkan = semua yang daftar langsung dapat akses).

**Google Sheets = satu-satunya database**, lewat `googleapis`. Nama lama
project (`wa-bot-keuangan-todo`) masih nempel di `package.json` field
`name` — belum di-rename total, repo GitHub-nya aja yang sudah pakai nama baru.

---

## 2. Tech Stack

| Komponen | Library | Catatan |
|---|---|---|
| Runtime | Node.js **20+** | Wajib, disyaratkan `baileys` |
| WhatsApp | `@whiskeysockets/baileys` `^6.7.23` | Unofficial WA Web multi-device |
| Auth | `useMultiFileAuthState` → folder `auth_session/` | Jangan dihapus kecuali troubleshoot |
| Database | Google Sheets via `googleapis` | Satu-satunya sumber data |
| AI | `@google/generative-ai`, model **`gemini-3.1-flash-lite`** | `/ai` (chat + function calling) & `/struk` (vision) |
| Gambar/stiker | `jimp` + `sharp` + `canvas` + `fluent-ffmpeg` | `jimp` buat stiker biasa; `sharp` dipakai di `brat-advanced.js` (PNG→WebP); `canvas` buat Brat & `/fakechat` (custom font + emoji PNG bundled); `fluent-ffmpeg` gabung frame animasi |
| Download video | `yt-dlp` (binary eksternal) + fallback `@tobyg74/tiktok-api-dl` (npm) | yt-dlp dicoba dulu; kalau gagal & link TikTok, otomatis coba 3 provider fallback berurutan (v3→v2→v1) |
| Export Excel | `xlsx` | `/unduhrekap` |
| Lainnya | `@hapi/boom`, `pino`, `qrcode-terminal`, `dotenv` | error parsing, logging, QR login, env |
| Container | Docker, base `node:20-slim` | Debian slim — `canvas` lebih stabil di glibc daripada Alpine/musl |

**Wajib `npm install --legacy-peer-deps`** — konflik peer-dependency
`jimp` (project pakai `0.22.x`) vs `baileys` (minta `jimp@^1.x`). Nggak
bentrok fungsional, npm-nya aja strict. Jangan pakai `--force`.

---

## 3. Struktur File

```
bot-whatsapp-asy/
├── index.js          # Entry point: koneksi WA, semua command, scheduler reminder/alarm
├── sheets.js          # Semua baca/tulis Google Sheets
├── gemini.js            # System instruction AI, function-calling tools, analisis struk/gambar
├── brat-advanced.js      # Generator stiker Brat (statis & animasi)
├── fakechat.js             # Generator fake chat screenshot WA
├── package.json / package-lock.json
├── Dockerfile
├── .env / .env.example        # .env JANGAN commit
├── .gitignore                   # node_modules/, .env, service-account.json, auth_session/, temp/
├── service-account.json           # TIDAK ada di repo, ditambah sendiri
├── auth_session/                    # Auto-generated Baileys, di-gitignore
├── temp/                              # File sementara /download, auto terhapus
├── fonts/
│   ├── arialnarrow.ttf                 # Brat
│   └── Inter-Regular.ttf, Inter-Bold.ttf  # /fakechat (pengganti SF Pro — lisensi Apple nggak bisa didistribusi ulang)
└── assets/
    ├── bg.jpg                          # Background /fakechat
    └── emoji/*.png                      # 7 emoji reaksi /fakechat (dari Twemoji, dirender jadi PNG statis biar nggak gantung font sistem)
```

---

## 4. Arsitektur & Alur Kerja Inti

### 4.1 Pendaftaran & otorisasi
`/daftarbot [nama]` → `sheets.daftarUser()` bikin baris di `Users` +
sheet `Keuangan_<nama>`/`Todo_<nama>` otomatis. User baru **belum**
otomatis bisa akses fitur lain — admin approve lewat `ALLOWED_NUMBERS`
(atau dikosongkan). Ditegakkan oleh `bolehAksesFitur(sender)` di setiap
command selain `/daftarbot`/`/help`.

### 4.2 Identifikasi user: JID vs nomor asli
Sebagian kontak dapat JID `@lid` yang berubah-ubah antar sesi (isu belum
di-root-cause sepenuhnya) — bot fallback pakai nomor asli
(`getNamaByJid(jid, nomorAsli)`). Kalau tetap gagal: `/deleteuser` lalu
`/daftarbot` ulang.

### 4.3 Reminder & Alarm
- **Rekap keuangan** tiap 2 jam, **reminder to-do** tiap 15 menit — cuma
  ke user yang `reminderAktif` true di sheet `Users` (kolom ini yang
  dikontrol `/reminder on/off` per-user, dan `/allreminder on/off` buat
  bulk semua user sekaligus dari admin).
- **Alarm** (`/alarm [jam] [pesan]`) independen dari sistem reminder di
  atas (sengaja, karena personal) — dicek tiap **1 menit**
  (`cekAlarmBerkala`). Sebelumnya sempat 5 menit, tapi itu **bug**: interval
  5 menit nggak align ke jam bulat, jadi alarm exact-minute-match banyak
  yang nggak pernah ke-trigger sama sekali. Sudah diperbaiki jadi 1 menit
  — jangan naikin lagi ke 5 menit tanpa mikirin ulang masalah ini.
- Waktu pakai zona Jakarta (UTC+7), dihitung manual (`waktuSekarangJakarta()`,
  murni math) — nggak bergantung locale/ICU sistem.

### 4.4 AI (`/ai`, `/struk`, foto+caption `/ai`)
`gemini.js` — system instruction (Bahasa Indonesia santai, format khusus
WA: cuma `*bold*` satu bintang, no markdown heading) + function-calling
tools: `catat_transaksi`, `tambah_todo`, `tandai_todo_selesai`,
`get_rekap_keuangan`, `get_daftar_todo`. Model: `gemini-3.1-flash-lite`
(dipertahankan setelah sempat dicoba `gemini-3.5-flash`, diputuskan balik).
Foto+caption `/struk` → `analisisStruk()` (baca nominal, auto-catat). Foto
+caption `/ai` → `analisisGambar()` (analisis gambar bebas).

### 4.5 Grup vs chat pribadi
Command finansial/personal/admin cuma jalan di chat pribadi. Di grup:
`/ai`, broadcast admin (`/alert`), dan `/botonline`/`/botoffline`
(aktivasi bot per grup, owner-only — default semua grup **inactive**,
data di sheet `GroupSettings`). `/alert` ngirim ke user terdaftar yang
BUKAN member grup aktif (private) + ke grup aktif (dengan mention) — no
duplikasi ke user yang ada di keduanya. **Fitur grup/patungan (split
bill) sudah dihapus total** — jangan dibangun ulang kecuali diminta eksplisit.

### 4.6 Download video (`/download`)
yt-dlp dicoba dulu (dengan `--impersonate chrome`, butuh `curl_cffi` di
sistem). Kalau gagal DAN link-nya TikTok → fallback otomatis ke
`@tobyg74/tiktok-api-dl`, coba provider **v3 → v2 → v1** berurutan (v3
musicaldown & v2 ssstik didesain no-watermark; v1 dipakai paling akhir
karena link resminya kadang ada watermark ke-burn). Ini karena TikTok
lagi ngetatin anti-bot secara luas (bukan cuma masalah yt-dlp) — kalau
semua provider fallback ikut gagal, itu isu upstream sementara, bukan bug
kode. Caption hasil download bisa custom manual: `/download [link]
[format] | [caption]` — tanpa `|caption`, dikirim polos tanpa caption.

### 4.7 `/fakechat`
Generate screenshot chat WA palsu (background foto + bar reaksi emoji +
1 bubble custom + menu konteks Balas/Teruskan/Salin/Beri
bintang/Hapus/Lainnya). Cuma teks bubble yang bisa di-custom — layout,
background, dan menu **fix** (permintaan eksplisit pemilik project).
Rasio 9:16. Font Inter (pengganti SF Pro, lihat Bagian 3). Emoji dari
PNG bundled (`assets/emoji/`), bukan font sistem — supaya konsisten di
semua environment tanpa install tambahan.

---

## 5. Daftar Command (ringkas — `/help` di bot selalu paling akurat)

**Akun**: `/daftarbot [nama]`, `/deleteuser`
**Keuangan**: `/masuk`, `/keluar`, `/rekap`, `/riwayat`, `/unduhrekap`, foto+`/struk`
**Todo**: `/todo`, `/listtodo`, `/done`
**Reminder/Alarm**: `/reminder on/off`, `/alarm`, `/stopalarm`, `/listalarm`, `/hapusalarm`
**Media**: foto+`/stiker [teks]`, `/download [link] [format] | [caption]`, foto+`/ai`
**Brat**: `/brat`, `/bratvid`
**Fake Chat**: `/fakechat [teks]`
**Utilitas**: `/kirim [nomor] [pesan]`, reply stiker+`/kirim`
**AI**: `/ai [perintah/pertanyaan]`
**Admin** (`OWNER_NUMBERS`): `/listuser`, `/adminhapususer`, `/testreminder`, `/ping`, `/alert`, `/botonline`/`/botoffline`, `/allreminder [on/off]`

---

## 6. Keputusan Teknis (jangan diubah tanpa alasan kuat)

1. **Google Sheets** satu-satunya database.
2. **`jimp` + `sharp` + `canvas` dipakai bareng** — beda fungsi (lihat
   Bagian 2), bukan salah satu doang. `--legacy-peer-deps` tetap wajib
   karena `jimp` versi lama.
3. **Base Docker `node:20-slim`** — wajib Node 20+, `canvas` lebih stabil
   di glibc. `yt-dlp` di-install via `pip3 install --break-system-packages
   -U yt-dlp` di Dockerfile (bukan `apt-get install yt-dlp` — versi apt
   sering ketinggalan & gampang kena block TikTok).
4. **Alarm dicek tiap 1 menit** (bukan 5 menit — itu bug lama, lihat
   Bagian 4.3).
5. **Model AI: `gemini-3.1-flash-lite`** — dipertahankan, jangan ganti
   tanpa diminta eksplisit.
6. **Fitur grup/patungan sudah dihapus total** — jangan dibangun ulang.
7. **`/allreminder [on/off]` nulis langsung ke kolom `ReminderAktif`**
   per user di sheet `Users` (bulk), bukan flag global terpisah — supaya
   konsisten sama yang user lihat langsung di spreadsheet.
8. **Isu JID `@lid` berubah-ubah** belum di-root-cause sepenuhnya —
   mekanisme fallback ada, tapi kadang masih butuh `/deleteuser` manual.
9. **Jangan jalanin Docker + `node index.js` manual bersamaan** — dua
   instance di satu auth_session WhatsApp bikin race condition (pesan
   dobel, reminder nggak konsisten, dll).
10. **Deployment utama pakai Docker** — cara manual (`node`/`pm2`) tetap
    didokumentasikan sebagai alternatif dev lokal.

---

## 7. Instruksi untuk AI yang Baca Dokumen Ini

1. Kalau punya akses `git`/network: clone repo, cek `git log --oneline -10`
   dulu sebelum ubah kode — jangan asumsikan dokumen ini 100% up-to-date.
2. Jangan hapus `--legacy-peer-deps` dari `npm install` mana pun.
3. Jangan turunkan Node.js di bawah versi 20 di Dockerfile.
4. Jangan bangun ulang fitur grup/patungan yang sudah dihapus, kecuali diminta eksplisit.
5. Fitur baru → tanya dulu ke user, jangan berasumsi.
6. `.env`, `service-account.json`, `auth_session/`, `temp/` tidak pernah
   ada di repo GitHub (di-gitignore) — itu kredensial/state lokal.
