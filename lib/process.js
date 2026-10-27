const { spawn } = require('node:child_process');
const children = new Set();
function stop(child) {
  try {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
    else child.kill('SIGKILL');
  } catch {}
}
process.once('exit', () => { for (const child of children) stop(child); });

// Bounded output and runtime. All callers pass argument arrays; never use a shell.
function run(file, args, { timeout = 180000, maxOutput = 65536, ...options } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { ...options, shell: false, detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    let stdout = '', stderr = '', timedOut = false;
    const append = (previous, data) => (previous + data.toString()).slice(-maxOutput);
    child.stdout.on('data', data => { stdout = append(stdout, data); });
    child.stderr.on('data', data => { stderr = append(stderr, data); });
    const timer = setTimeout(() => { timedOut = true; stop(child); }, timeout);
    child.on('error', error => { children.delete(child); clearTimeout(timer); reject(error); });
    child.on('close', code => {
      children.delete(child);
      clearTimeout(timer);
      if (timedOut) return reject(new Error(`${file}: melewati batas waktu.`));
      if (code !== 0) return reject(new Error(`${file} gagal (${code}): ${stderr.slice(-1000)}`));
      resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

module.exports = { run };
