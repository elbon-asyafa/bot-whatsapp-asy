const fs = require('node:fs');
const path = require('node:path');
const { config } = require('./config');
const { run } = require('./process');
const MAX_BYTES = 60 * 1024 * 1024;
const hosts = ['youtube.com', 'youtu.be', 'tiktok.com', 'instagram.com'];
let busy = false;

function validateUrl(input) {
  let url;
  try { url = new URL(input); } catch { throw new Error('Link tidak valid.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !hosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
    throw new Error('Gunakan link HTTPS YouTube, TikTok, atau Instagram.');
  }
  return url.href;
}

async function download(input, format, send) {
  const url = validateUrl(input);
  if (!['mp3', 'mp4'].includes(format)) throw new Error('Format harus mp3 atau mp4.');
  if (busy) throw new Error('Ada download yang sedang berjalan. Coba lagi sebentar.');
  busy = true;
  let dir;
  try {
    const root = path.join(config.root, 'temp');
    fs.mkdirSync(root, { recursive: true });
    dir = fs.mkdtempSync(path.join(root, 'download-'));
    const output = path.join(dir, `media.${format}`);
    const args = ['--ignore-config', '--no-playlist', '--playlist-items', '1', '--socket-timeout', '20', '--retries', '2',
      '--max-filesize', String(MAX_BYTES), '--js-runtimes', `node:${process.execPath}`,
      '--output', output];
    if (config.ffmpeg !== 'ffmpeg') args.push('--ffmpeg-location', config.ffmpeg);
    // Abort before downloading long media, including audio-only streams.
    args.push('--match-filters', 'duration <= 900 & !is_live');
    if (format === 'mp3') args.push('-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', '2');
    else args.push('-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]', '--merge-output-format', 'mp4');
    args.push('--', url);
    await run(config.ytDlp, args, { timeout: 180000 });
    if (!fs.existsSync(output)) throw new Error('File hasil unduhan tidak tersedia.');
    if (fs.statSync(output).size > MAX_BYTES) throw new Error('Hasil unduhan melebihi 60 MB.');
    await send(fs.readFileSync(output));
  } finally {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    busy = false;
  }
}
module.exports = { validateUrl, download, MAX_BYTES };
