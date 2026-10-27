const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { run } = require('../lib/process');
const { validateUrl, download } = require('../lib/download');
const { config } = require('../lib/config');

test('child process receives shell metacharacters literally', async () => {
  const argument = 'https://youtube.com/$(id);`whoami`';
  const { stdout } = await run(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', argument]);
  assert.equal(stdout, argument);
});

test('child process timeout kills stuck jobs', async () => {
  await assert.rejects(run(process.execPath, ['-e', 'setInterval(()=>{}, 1000)'], { timeout: 50 }), /batas waktu/);
});

test('download rejects local addresses, hostname lookalikes and credentials', () => {
  for (const url of ['http://youtube.com/test', 'https://localhost/a', 'https://127.0.0.1', 'https://youtube.com.evil.test', 'https://evil-tiktok.com', 'https://name:pass@youtube.com/a', 'https://youtube.com:444/a']) assert.throws(() => validateUrl(url));
  assert.equal(validateUrl('https://www.youtube.com/watch?v=test'), 'https://www.youtube.com/watch?v=test');
  assert.equal(validateUrl('https://vt.tiktok.com/test'), 'https://vt.tiktok.com/test');
});

test('download arguments are separate and artifacts are cleaned on send failure', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asy-downloader-'));
  const script = path.join(dir, 'fake downloader');
  const before = config.ytDlp;
  fs.writeFileSync(script, `#!${process.execPath}\nconst fs=require('fs');const args=process.argv.slice(2);fs.writeFileSync(args[args.indexOf('--output')+1], JSON.stringify(args));\n`, { mode: 0o700 });
  config.ytDlp = script;
  let output;
  try {
    await assert.rejects(download('https://youtube.com/$(id)', 'mp4', async buffer => {
      const args = JSON.parse(buffer); output = args[args.indexOf('--output') + 1];
      assert.equal(args.at(-1), 'https://youtube.com/$(id)'); assert.equal(args.at(-2), '--');
      assert(args.includes('--no-playlist')); throw new Error('simulated send failure');
    }), /simulated send failure/);
    assert(!fs.existsSync(path.dirname(output)));
    await download('https://youtu.be/test', 'mp3', async () => {});
  } finally { config.ytDlp = before; fs.rmSync(dir, { recursive: true, force: true }); }
});
