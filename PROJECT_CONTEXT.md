# WA Bot Keuangan & Todo (Elbon) — Project Context / Handoff Doc

> Dokumen ini dibuat buat di-attach/paste ke chat Claude yang baru, supaya
> Claude di chat itu langsung paham konteks project ini tanpa perlu dijelasin
> dari nol. Nggak ada repo Git — semua file ditukar via download langsung di
> chat, jadi kalau chat baru punya `bash_tool`, **selalu minta user upload file
> terbaru (`index.js`, `sheets.js`, `gemini.js`, `package.json`) duluan**
> sebelum mulai kerja, jangan asumsi kode di kepala masih akurat.

**Environment kerja user**: Windows, terminal Git Bash (MINGW64), jalanin bot
lokal pakai `node index.js` (belum di-deploy ke hosting/VPS — sempat
direncanain di awal tapi keburu fokus nambah fitur terus). Nomor WA bot
("second") beda dari nomor pribadi user ("elbon"/nomor 1).

## Apa aplikasi ini

Bot WhatsApp pribadi (Node.js + Baileys) buat catat keuangan & to-do list,
data tersimpen di Google Sheets (bukan database sendiri), dengan integrasi AI
(Gemini) yang bisa ngobrol bebas ATAU beneran ngejalanin aksi di bot lewat
function calling. Awalnya direncanain multi-user + bisa dipake di grup
(patungan/split bill), tapi **fitur grup udah dihapus total** atas permintaan
user — sekarang fokus ke pemakaian personal/multi-user via chat pribadi.

## Tech Stack

- **Node.js** + **`@whiskeysockets/baileys`** (WhatsApp Web multi-device,
  pakai `fetchLatestBaileysVersion()` biar nggak kena error 405/connection
  failure gara-gara versi protokol WA yang usang)
- **`googleapis`** (Google Sheets API) — satu-satunya "database", nggak pakai
  SQL/NoSQL sendiri
- **`@google/generative-ai`** — model **`gemini-3.1-flash-lite`** (user
  eksplisit milih ini, sempat dicoba `gemini-3.5-flash` tapi diminta balik ke
  3.1). Dipakai buat: chat bebas, function calling (ngejalanin command bot),
  dan vision (baca foto struk)
- **`xlsx`** (SheetJS) — export data personal ke `.xlsx`
- **`wa-sticker-formatter`** — convert foto jadi stiker WA
- **`jimp`** (BUKAN `sharp` — lihat catatan di bawah) — overlay teks meme di
  stiker
- **`yt-dlp`** — binary eksternal (bukan npm package) buat download video
  YouTube/TikTok, dipanggil lewat `child_process.exec`
- `dotenv`, `pino`, `qrcode-terminal`, `@hapi/boom` — utilitas standar Baileys

## Struktur File

```
wa-bot-keuangan-todo/
  index.js              # koneksi Baileys, semua command handler, reminder & alarm scheduler
  sheets.js              # semua fungsi baca/tulis Google Sheets
  gemini.js               # integrasi Gemini: chat, function calling, vision (struk)
  package.json
  .env                    # GEMINI_API_KEY, SPREADSHEET_ID, GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
                          # ALLOWED_NUMBERS (kosongin = semua boleh akses fitur),
                          # OWNER_NUMBERS (JID admin, buat command khusus pemilik)
  service-account.json    # kredensial Google Cloud punya user sendiri (gitignored)
  auth_session/            # sesi login Baileys (gitignored, jangan disave)
  temp/                     # video hasil /download sementara, auto-dihapus abis kekirim (gitignored)
  yt-dlp.exe                # binary yt-dlp, ditaruh manual di sini karena user gak ada Python
```

## Keputusan Teknis Penting

1. **Dua tingkat akses, terpisah total**: `ALLOWED_NUMBERS` (env) = gerbang
   akses FITUR biasa (kosongin = semua orang yang `/daftarbot` langsung bisa
   pakai). `OWNER_NUMBERS` (env) = gerbang command ADMIN doang
   (`/listuser`, `/adminhapususer`, `/testreminder`). Jangan disatuin lagi.
2. **JID WhatsApp bisa berformat `@lid`** (Linked ID, fitur privasi baru WA),
   bukan cuma `@s.whatsapp.net` biasa. Jangan pernah nebak/nulis manual JID
   seseorang — selalu ambil dari log `[MASUK] <jid> -> <command>` yang
   ke-print pas mereka chat. **ISU BELUM KETUTUP**: ada indikasi 1 kontak
   ("Karim"/nama "im") dapet JID yang beda-beda antar pesan (kelihatan dari
   `/daftarbot` yang "berhasil daftar" dua kali alih-alih bilang "udah
   terdaftar" kedua kalinya) — belum di-root-cause, terakhir user diminta
   bandingin JID di 3 baris log yang berbeda.
3. **`sender` vs `authorId` dipisah** di semua command handler: `sender` =
   `msg.key.remoteJid` (ke situ balesan dikirim — personal atau grup),
   `authorId` = identitas asli pengirim (`msg.key.participant` kalau di
   grup). Infrastruktur ini **DIPERTAHANIN** meskipun fitur grup udah
   dihapus, karena masih dipakai buat mblokir command Akun/Keuangan/To-Do/
   Admin biar nggak jalan kalau bot ke-invite ke grup.
4. **`valueInputOption: "RAW"` wajib buat data yang "kelihatan" kayak
   jam/tanggal** (misal `Waktu` di sheet Alarm) — kalau pakai
   `USER_ENTERED`, Google Sheets otomatis convert string `"02:47"` jadi tipe
   Time dan ngilangin nol di depan pas dibaca balik (`"2:47"`), bikin
   perbandingan waktu alarm gagal total. Ada juga `normalisasiJam()` di
   `index.js` sebagai jaring pengaman tambahan.
5. **Gemini function calling**: histori percakapan lanjutan (`startChat`)
   HARUS pakai `response.candidates[0].content` yang asli dari hasil
   `generateContent`, BUKAN disusun ulang manual
   (`{role:"model", parts:[{functionCall}]}`) — model butuh
   `thought_signature` yang cuma ada di response asli, kalau direkonstruksi
   manual bakal kena error 400.
6. **`sharp` GAGAL total di komputer user** (Windows, `ERR_DLOPEN_FAILED`,
   kemungkinan Visual C++ Redistributable kurang) — udah dicoba reinstall
   berkali-kali, tetep gagal. **Solusi final: pindah ke `jimp`** (pure JS,
   nggak ada native binary). Jangan saranin `sharp` lagi ke user ini. Efek
   bold+outline teks meme di stiker disimulasiin manual (cetak teks item
   berkali-kali dioffset dikit di sekeliling, baru teks putih di atasnya)
   karena font bawaan `jimp` nggak support stroke asli.
7. **`yt-dlp` nggak bisa diinstall via `pip`** (user nggak punya Python).
   Solusi: user download `yt-dlp.exe` manual, taruh di folder project.
   `index.js` punya fungsi `pathYtDlp()` yang cek dulu apakah ada
   `yt-dlp.exe` lokal di `__dirname`, baru fallback ke command global `yt-dlp`
   di PATH.
8. **Konflik peer-dependency npm** sering muncul (`baileys` minta
   `jimp@^1.x`, project ini pakai `jimp@0.22.x`) — solusinya selalu pakai
   `npm install --legacy-peer-deps`, bukan `--force`.
9. **Google Sheets API gratis** buat skala pemakaian personal kayak gini
   (kuota 300 request/menit/project), nggak butuh aktifin billing/kartu
   kredit sama sekali. Ini udah dikonfirmasi ke user di awal.

## Fitur yang Sudah Selesai

**Akun**: `/daftarbot [nama]` (auto-bikin sheet `Keuangan_<nama>` &
`Todo_<nama>`), `/deleteuser` (hapus permanen, butuh konfirmasi `yakin`).

**Keuangan**: `/masuk`, `/keluar`, `/rekap` (ringkasan hari ini), `/riwayat
[jumlah]`, `/unduhrekap` (export `.xlsx`), foto struk + caption `/struk`
(Gemini vision baca nominal+keterangan otomatis, langsung tercatat sebagai
pengeluaran).

**To-Do**: `/todo`, `/listtodo` (dulu namanya `/bottodo`, di-rename), `/done
[nomor]`.

**Reminder & Alarm**: `/reminder on|off` — **PER-USER** (kolom `ReminderAktif`
di sheet `Users`), bukan flag global. Reminder otomatis: rekap keuangan tiap
2 jam, cek to-do pending tiap 15 menit (skip kalau kosong). `/alarm [jam]
[pesan]` — sekali jalan, begitu kena jamnya bot **SPAM tiap menit terus**
sampai user bales `/stopalarm` (status: `Aktif` → `Berbunyi` →
`Dihentikan`). `/listalarm`, `/hapusalarm [nomor]`.

**Media**: foto + caption `/stiker` → convert jadi stiker WA (pack "Bot
Wangsaff", author "Milik Asyafa Bejir"). Bisa tambah teks meme:
`/stiker [teks bawah]` atau `/stiker [atas]|[bawah]` — font bold+outline
hitam, gambar dinormalisasi ke lebar 512px dulu biar teks proporsional
apapun resolusi aslinya. `/download [link]` — download video YouTube/TikTok
via `yt-dlp`, **maks 60MB** (keterbatasan WA), ada pengingat soal ToS/hak
cipta.

**Utilitas**: `/kirim [nomor] [pesan]` — kirim pesan lewat bot ke nomor
manapun, **terbuka buat semua user** yang punya akses fitur (sistem izin
khusus sempat dibikin lalu **dicabut lagi** atas permintaan user).

**AI Assistant**: `/ai [pertanyaan/perintah]` — punya system instruction
yang ngasih tau Gemini soal bot ini sendiri (siapa yang bikin, teknologi,
semua fitur), jadi bisa jawab meta-question. Function calling ke 5 fungsi:
`catat_transaksi`, `tambah_todo`, `tandai_todo_selesai`,
`get_rekap_keuangan`, `get_daftar_todo`. Output di-post-process buang
markdown `**` ganda & heading `#` (diganti format WA yang bener), system
prompt eksplisit minta jawaban santai/nggak kaku.

**Admin** (khusus `OWNER_NUMBERS`): `/listuser` (nama+JID+nomorWA+tanggal
daftar), `/adminhapususer [nama]` (hapus paksa akun siapapun),
`/testreminder` (trigger manual reminder buat testing, nggak perlu nunggu
interval).

**`/help`**: dinamis — kategori Akun/Keuangan/To-Do/Admin otomatis
disembunyiin kalau dipanggil dari dalam grup, contoh command `/ai` juga
nyesuain konteks (nggak nyaranin contoh keuangan kalau lagi di grup).

## Fitur yang Dibikin LALU DIHAPUS (jangan dibikin ulang tanpa diminta eksplisit)

- **Seluruh fitur Grup/Patungan**: `/patungan`, `/utang` (duluan dihapus),
  `/lunas`, `/listmembergrup`, `/riwayatgrup`, plus fungsi backend
  (`catatPatungan`, `catatPelunasan`, `ambilSaldoGrup`, `ambilRiwayatGrup`,
  `sanitizeSheetName`) — sempat diimplementasi penuh (split custom pakai
  `@mention`, member nggak wajib `/daftarbot`, balesan transparan di grup),
  lalu user minta hapus semua. Infrastruktur `authorId`/`isGroup` TETAP ada
  buat mblokir command personal di grup, tapi command grup-nya sendiri
  sudah nggak ada.
- **Sistem izin khusus `/kirim`** (`/izinkirim`, `/cabutizinkirim`,
  `/listizinkirim` + fungsi sheets terkait) — dibikin, langsung dicabut lagi
  di sesi yang sama.
- **`/rekapstop`** (nutup hari + rekap gabungan semua user ke sheet
  `RekapHarian`) — dihapus atas permintaan ("hapus aja, gak butuh").

## Struktur Sheet di Google Spreadsheet

- `Users`: JID | Nama | TanggalDaftar | NomorWA | ReminderAktif — **baris
  pertama itu header, WAJIB di-skip** (`.slice(1)`) pas dibaca, pernah ada
  bug di mana header ke-baca sebagai "user palsu" bernama "Nama" dan
  bikin reminder error.
- `Keuangan_<nama>` per user: Tanggal | Jenis | Nominal | Keterangan
- `Todo_<nama>` per user: Tanggal | Task | Status
- `Alarm_<nama>` per user: Waktu | Pesan | Status | DibuatTanggal
- `Kontak`: JID | Nama | TerakhirDilihat — cache nama umum (dari
  `pushName`), awalnya dibikin buat fitur grup, dipertahanin karena masih
  kepake buat auto-cache nama siapa aja yang chat bot (worth dicek ulang
  apakah `getNamaKontak` masih ada pemanggilnya sekarang fitur grup udah
  hilang).
- `RekapHarian`: Tanggal | TotalMasuk | TotalKeluar | Saldo — dibikin buat
  `/rekapstop` yang udah dihapus, kemungkinan jadi sheet nganggur sekarang
  (worth dicek apakah `rekapSemuaHariIniDanSimpan` di `sheets.js` masih
  dipanggil dari manapun).

## Insiden Penting

- **Environment kerja Claude (sandbox) sempat ke-reset di tengah proses**
  (kehapus semua file lokal). File yang udah sempet di-`present_files`/save
  ke folder output tetep aman, tapi progress yang belum sempet di-save
  hilang dan harus diulang manual dari file terakhir yang valid. **Pelajaran**:
  jangan asumsi state lokal masih ada — kalau ada tanda-tanda aneh, cek dulu
  keberadaan file sebelum lanjut edit.
- **Sesi Baileys pernah korup** (`Decrypted message with closed session`,
  `Stream Errored (restart required)`) gara-gara bot di-restart berkali-kali
  dalam waktu deket pas proses debug. Fix-nya selalu sama: `rm -rf
  auth_session` + scan ulang QR.
- **Format nomor `@lid` nggak stabil buat 1 kontak tertentu** — belum
  ke-root-cause, lihat poin #2 di Keputusan Teknis.

## Status Sekarang / Rencana Selanjutnya

Bot jalan **lokal doang** (belum di-deploy ke hosting/VPS) — rencana awal
"testing di free hosting (Railway/Render) baru pindah VPS" **belum
dieksekusi**, keburu fokus nambahin fitur terus-terusan. Kalau mau lanjut:

1. **Selesaiin isu JID nggak stabil** buat kontak "Karim"/"im" (paling
   prioritas, ngeblok orang itu pakai fitur sama sekali)
2. **Bersih-bersih kode**: cek apakah `RekapHarian` sheet & fungsi
   `rekapSemuaHariIniDanSimpan` masih relevan (peninggalan `/rekapstop` yang
   udah dihapus), cek apakah `getNamaKontak` masih ada pemanggilnya
3. **Deploy ke hosting** (sempat direncanain Railway/Render buat testing,
   baru VPS buat 24/7) — belum jalan sama sekali
4. Kalau mau nambah fitur baru, tanyain ke user dulu — jangan asumsi grup
   atau fitur lain yang udah dihapus mau dibikin ulang
