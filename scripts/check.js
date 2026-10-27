const path = require('node:path');
const { config, aiEnabled } = require('../lib/config');
const { run } = require('../lib/process');
let failures = 0;
async function check(label, fn) {
  try { console.log(`[OK] ${label}: ${await fn() || 'siap'}`); }
  catch (error) { failures++; console.log(`[MANUAL] ${label}: ${error.message.split('\n')[0]}`); }
}
(async () => {
  await check('Node.js', () => {
    if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Gunakan Node.js 24 LTS.');
    return process.version;
  });
  await check('Baileys', () => {
    if (typeof require('@whiskeysockets/baileys').default !== 'function') throw new Error('Jalankan npm ci.');
  });
  await check('Canvas dan font', () => {
    const canvas = require('canvas');
    canvas.registerFont(path.join(config.root, 'fonts/arialnarrow.ttf'), { family: 'Arial Narrow' });
    canvas.registerFont(path.join(config.root, 'fonts/sfprodisplayregular.otf'), { family: 'SF Pro Display' });
    canvas.createCanvas(10, 10).toBuffer('image/png');
  });
  await check('Sharp/WebP', async () => {
    await require('sharp')({ create: { width: 4, height: 4, channels: 4, background: '#fff' } }).webp().toBuffer();
    require('node-webpmux');
  });
  await check('FFmpeg', async () => (await run(config.ffmpeg, ['-version'], { timeout: 10000 })).stdout.split('\n')[0]);
  const ffprobe = config.ffmpeg === 'ffmpeg' ? 'ffprobe' : path.join(path.dirname(config.ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
  await check('ffprobe', async () => (await run(ffprobe, ['-version'], { timeout: 10000 })).stdout.split('\n')[0]);
  await check('yt-dlp', async () => {
    const { stdout } = await run(config.ytDlp, ['--version'], { timeout: 10000 });
    if (stdout < '2025.11.12') throw new Error(`${stdout}; perbarui yt-dlp untuk dukungan YouTube/EJS.`);
    return stdout;
  });
  await check('SDK Gemini', () => { require('@google/genai'); });
  console.log(aiEnabled() ? '[INFO] API key AI terisi; koneksi API belum diuji.' : '[INFO] AI belum diaktifkan. Isi GEMINI_API_KEY jika ingin /ai.');
  console.log(`[INFO] Owner: ${config.ownerNumbers.length ? 'terkonfigurasi' : 'belum diisi (opsional, untuk /kirim)'}. Tidak memerlukan Google Sheets.`);
  console.log('[INFO] Login WA dan download nyata perlu dites setelah instalasi sistem selesai.');
  process.exitCode = failures ? 1 : 0;
})();
