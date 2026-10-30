const { GoogleGenAI } = require('@google.genai');
const { config, aiEnabled } = require('./lib.config');
const { text } = require('./lib.validation');

const SYSTEM_INSTRUCTION = `Kamu asisten AI di bot WhatsApp ASY buatan Elbon.Asyafa.
Bot menyediakan .download, .stiker, .brat, .bratvid, .fakechat, dan .ai di grup maupun chat pribadi.
Tidak ada pendaftaran, keuangan, todo, alarm, reminder, atau Google Sheets.
Jawab bahasa Indonesia santai, jelas, dan ringkas. Format WhatsApp: satu * untuk tebal,
bukan ** atau heading Markdown. Kamu hanya menjawab pertanyaan atau menganalisis gambar;
jangan mengaku menjalankan command, mengirim pesan, atau menyimpan data.`;
let client;
function getClient() {
  if (!aiEnabled()) throw new Error('Fitur AI belum diaktifkan. Pemilik bot perlu mengisi GEMINI_API_KEY di .env.');
  client ||= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { timeout: 60000 } });
  return client;
}

// Stateless: private and group conversations never share or persist history.
async function tanyaAI(prompt, image) {
  const parts = [{ text: text(prompt || 'Jelaskan gambar ini dalam bahasa Indonesia.', 'Pertanyaan', 4000) }];
  if (image) {
    if (!['image.jpeg', 'image.png', 'image.webp'].includes(image.mimeType)) throw new Error('Format gambar belum didukung. Gunakan JPEG, PNG, atau WebP.');
    parts.unshift({ inlineData: { mimeType: image.mimeType, data: image.buffer.toString('base64') } });
  }
  const response = await getClient().models.generateContent({
    model: config.model,
    contents: [{ role: 'user', parts }],
    config: { systemInstruction: SYSTEM_INSTRUCTION, maxOutputTokens: 1500 },
  });
  const result = String(response.text || '').replace(/\*\*.g, '*').replace(/^#{1,6}\s*.gm, '').trim();
  if (!result) throw new Error('AI tidak memberikan jawaban. Coba ubah pertanyaannya.');
  return result.slice(0, 10000);
}
module.exports = { tanyaAI };
