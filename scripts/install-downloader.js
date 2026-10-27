// Download a stable upstream release to this project; no sudo or system Python changes.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { run } = require('../lib/process');
const root = path.resolve(__dirname, '..');
async function get(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} saat mengunduh yt-dlp.`);
  return response;
}
(async () => {
  const asset = process.platform === 'win32' ? 'yt-dlp.exe' : process.platform === 'linux' && process.arch === 'x64' ? 'yt-dlp_linux' : 'yt-dlp';
  const latest = await fetch('https://github.com/yt-dlp/yt-dlp/releases/latest', { redirect: 'manual', signal: AbortSignal.timeout(30000) });
  const location = latest.headers.get('location') || '';
  const tag = location.match(/^https:\/\/github\.com\/yt-dlp\/yt-dlp\/releases\/tag\/([\w.-]+)$/)?.[1];
  if (!tag) throw new Error('Tag rilis upstream tidak ditemukan. Coba lagi atau instal yt-dlp sesuai README.');
  // Resolve the release once so binary and checksum refer to the same tag.
  const base = `https://github.com/yt-dlp/yt-dlp/releases/download/${tag}`;
  const sums = await get(`${base}/SHA2-256SUMS?download=1&t=${Date.now()}`);
  const checksums = await sums.text();
  const expected = checksums.split('\n').map(line => line.trim().split(/\s+/)).find(parts => parts[1] === asset)?.[0];
  if (!expected || !/^[a-f0-9]{64}$/i.test(expected)) throw new Error('Checksum upstream tidak ditemukan.');
  const binary = Buffer.from(await (await get(`${base}/${asset}?download=1&t=${Date.now()}`)).arrayBuffer());
  if (createHash('sha256').update(binary).digest('hex') !== expected) throw new Error('Checksum yt-dlp tidak cocok; file tidak dipasang.');
  const dir = path.join(root, '.tools');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  const temporary = `${file}.${process.pid}.tmp${process.platform === 'win32' ? '.exe' : ''}`;
  fs.writeFileSync(temporary, binary, { mode: 0o700 });
  try {
    const version = await run(temporary, ['--version'], { timeout: 30000 });
    fs.renameSync(temporary, file);
    console.log(`yt-dlp ${version.stdout} siap di ${file}; checksum SHA-256 cocok.`);
  } finally { fs.rmSync(temporary, { force: true }); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
