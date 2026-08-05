const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();

const SYSTEM_INSTRUCTION = `
Kamu adalah AI assistant yang terintegrasi di dalam bot WhatsApp pribadi buat catat keuangan dan to-do list.

Info tentang bot ini (jawab pakai info ini kalau user nanya soal bot-nya, dengan santai dan jelas):
- Dibuat oleh Elbon, seorang network technician & pelajar TKJ (Teknik Komputer dan Jaringan) dari Rajeg, Banten, Indonesia.
- Dibangun pakai Node.js, dengan library Baileys buat koneksi ke WhatsApp Web (multi-device), Google Sheets API buat nyimpen semua data, dan Google Gemini API (kamu sendiri) buat fitur AI.
- Bot ini multi-user: tiap orang daftar sendiri pakai command /daftarbot [nama], nanti otomatis dibikinin sheet keuangan dan to-do sendiri-sendiri (nggak nyampur sama user lain). Setelah daftar, admin/pemilik bot yang approve akses fitur lengkapnya.
- Fitur utama: catat pemasukan/pengeluaran (/masuk, /keluar), rekap keuangan (/rekap, /riwayat), to-do list (/todo, /listtodo, /done), export data ke Excel (/unduhrekap), scan struk otomatis, alarm custom (/alarm, /stopalarm), kirim pesan lewat bot ke nomor lain (/kirim), hapus akun sendiri (/deleteuser), dan reminder otomatis (rekap keuangan tiap 2 jam, reminder to-do tiap 15 menit, bisa dinyalain/dimatiin per-user lewat /reminder on atau /reminder off).
- Kamu (fitur /ai) bisa diajak ngobrol bebas, ATAU disuruh langsung ngejalanin aksi di bot pakai bahasa natural (contoh: "catet keluar 15000 buat makan siang", "tambahin todo beli galon") — ini pakai kemampuan function calling, jadi kamu beneran manggil fungsi backend-nya, bukan cuma jawab teks doang.
- Semua data tersimpan di Google Sheets, jadi user bisa pantau juga langsung dari spreadsheet-nya kapan aja.

Jawab pertanyaan user dengan bahasa Indonesia yang santai dan natural, kayak lagi ngobrol biasa sama temen — jangan formal/kaku, jangan bertele-tele, langsung ke intinya.

Aturan format PENTING karena ini bakal ditampilin di WhatsApp:
- JANGAN pakai markdown kayak **teks tebal** (dua bintang) atau tanda pagar untuk heading.
- Kalau mau nebelin teks, WhatsApp cuma butuh SATU tanda bintang: *teks*. Pakai itu seperlunya aja, jangan kebanyakan.
- Jangan pakai bullet point pakai tanda bintang/dash berlebihan, cukup nomor urut atau baris baru biasa.
`.trim();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Daftar "kemampuan" yang boleh dipanggil AI buat ngontrol bot
const tools = [
  {
    functionDeclarations: [
      {
        name: "catat_transaksi",
        description:
          "Mencatat pemasukan atau pengeluaran uang user ke spreadsheet keuangan",
        parameters: {
          type: "OBJECT",
          properties: {
            jenis: {
              type: "STRING",
              enum: ["Masuk", "Keluar"],
              description: "Jenis transaksi: Masuk (pemasukan) atau Keluar (pengeluaran)",
            },
            nominal: {
              type: "NUMBER",
              description: "Jumlah uang dalam Rupiah, angka saja (contoh 15000, bukan '15rb')",
            },
            keterangan: {
              type: "STRING",
              description: "Keterangan singkat transaksi, contoh 'makan siang'",
            },
          },
          required: ["jenis", "nominal", "keterangan"],
        },
      },
      {
        name: "tambah_todo",
        description: "Menambahkan task baru ke to-do list user hari ini",
        parameters: {
          type: "OBJECT",
          properties: {
            task: { type: "STRING", description: "Deskripsi task yang mau ditambahkan" },
          },
          required: ["task"],
        },
      },
      {
        name: "tandai_todo_selesai",
        description:
          "Menandai satu to-do sebagai selesai, berdasarkan nomor urutnya di daftar to-do hari ini",
        parameters: {
          type: "OBJECT",
          properties: {
            nomor: { type: "NUMBER", description: "Nomor urut to-do yang mau ditandai selesai" },
          },
          required: ["nomor"],
        },
      },
      {
        name: "get_rekap_keuangan",
        description:
          "Mengambil ringkasan total pemasukan, pengeluaran, dan saldo milik user hari ini",
        parameters: { type: "OBJECT", properties: {} },
      },
      {
        name: "get_daftar_todo",
        description: "Mengambil daftar to-do user hari ini beserta statusnya",
        parameters: { type: "OBJECT", properties: {} },
      },
    ],
  },
];

const chatModel = genAI.getGenerativeModel({
  model: "gemini-3.5-flash-lite",
  tools,
  systemInstruction: SYSTEM_INSTRUCTION,
});

const plainModel = genAI.getGenerativeModel({
  model: "gemini-3.5-flash-lite",
  systemInstruction: SYSTEM_INSTRUCTION,
});

// Dipanggil buat baca foto struk belanja, extract nominal + keterangan otomatis
async function analisisStruk(base64Data, mimeType) {
  const visionModel = genAI.getGenerativeModel({ model: "gemini-3.5-flash-lite" });

  const prompt =
    `Ini foto struk/nota belanja. Baca dan ekstrak informasinya. ` +
    `Balas HANYA dalam format JSON persis seperti ini, tanpa teks lain, tanpa markdown code block:\n` +
    `{"nominal": <total belanja dalam angka, tanpa titik/koma>, "keterangan": "<nama toko atau ringkasan belanja, singkat>"}\n` +
    `Kalau nggak ketemu totalnya atau ini bukan struk, balas: {"nominal": 0, "keterangan": "tidak terbaca"}`;

  const result = await visionModel.generateContent([
    { inlineData: { mimeType, data: base64Data } },
    { text: prompt },
  ]);

  const rawText = result.response.text().trim();
  const cleaned = rawText.replace(/```json|```/g, "").trim();

  try {
    const parsed = JSON.parse(cleaned);
    return { nominal: parseInt(parsed.nominal, 10) || 0, keterangan: parsed.keterangan || "belanja" };
  } catch (e) {
    return { nominal: 0, keterangan: "tidak terbaca" };
  }
}

// Dipanggil lewat /ai — Gemini bisa milih manggil fungsi bot (executors) atau jawab langsung
async function prosesPerintahBot(pertanyaan, executors) {
  const result = await chatModel.generateContent(pertanyaan);
  const response = result.response;
  const calls = response.functionCalls();

  if (!calls || calls.length === 0) {
    return { text: bersihkanFormat(response.text()), executed: null };
  }

  const call = calls[0];
  const executor = executors[call.name];
  if (!executor) {
    return { text: "Aku ngerti maksudnya, tapi belum bisa lakuin itu.", executed: null };
  }

  let functionResult;
  try {
    functionResult = await executor(call.args || {});
  } catch (e) {
    functionResult = { status: "error", pesan: e.message };
  }

  // Kirim hasil eksekusi balik ke Gemini biar dijawab natural ke user
  // Penting: pakai konten ASLI dari response.candidates (bukan disusun ulang manual),
  // karena model terbaru butuh thought_signature yang cuma ada di response asli.
  const modelContent = response.candidates[0].content;

  const chat = chatModel.startChat({
    history: [
      { role: "user", parts: [{ text: pertanyaan }] },
      modelContent,
    ],
  });

  const followUp = await chat.sendMessage([
    {
      functionResponse: {
        name: call.name,
        response: functionResult,
      },
    },
  ]);

  return { text: bersihkanFormat(followUp.response.text()), executed: call.name };
}

// Dipanggil buat obrolan bebas biasa (fallback / non-command context)
async function tanyaAI(pertanyaan) {
  const result = await plainModel.generateContent(pertanyaan);
  return bersihkanFormat(result.response.text());
}

function bersihkanFormat(teks) {
  return teks
    .replace(/\*\*/g, "*") // **tebal** (markdown) -> *tebal* (format WA)
    .replace(/^#{1,6}\s*/gm, "") // buang heading markdown (#, ##, dst)
    .trim();
}

module.exports = { prosesPerintahBot, tanyaAI, analisisStruk };
