const path = require('node:path');
const fs = require('node:fs');
const ROOT = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env'), quiet: true });

function normalizeJid(value) {
  const input = String(value || '').trim();
  if (/^\d+(?::\d+)?@(lid|s\.whatsapp\.net)$/.test(input)) return input.replace(/:\d+@/, '@');
  let digits = input.replace(/[+\s()-]/g, '');
  if (digits.startsWith('0')) digits = `62${digits.slice(1)}`;
  return /^\d{7,15}$/.test(digits) ? `${digits}@s.whatsapp.net` : '';
}

const config = {
  root: ROOT,
  ownerNumbers: String(process.env.OWNER_NUMBERS || '').split(',').map(normalizeJid).filter(Boolean),
  model: process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite',
  authDir: path.resolve(ROOT, process.env.AUTH_DIR || 'auth_session'),
  ffmpeg: process.env.FFMPEG_PATH || 'ffmpeg',
  ytDlp: process.env.YT_DLP_PATH || (fs.existsSync(path.join(ROOT, '.tools', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')) ? path.join(ROOT, '.tools', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp') : 'yt-dlp'),
};
const aiEnabled = () => Boolean(process.env.GEMINI_API_KEY && !process.env.GEMINI_API_KEY.startsWith('isi_'));
module.exports = { config, normalizeJid, aiEnabled };
