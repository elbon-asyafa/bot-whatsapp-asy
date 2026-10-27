#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { config } = require('../lib/config');
const service = 'bot-whatsapp-asy.service';
const file = path.join(os.homedir(), '.config/systemd/user', service);
const quote = value => '"' + value.replace(/%/g, '%%').replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
const unit = `[Unit]
Description=Bot WhatsApp ASY
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
Type=simple
WorkingDirectory=${config.root.replace(/%/g, '%%').replace(/\\/g, '\\x5c').replace(/\s/g, c => '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0'))}
ExecStart=${quote(process.execPath)} ${quote(path.join(config.root, 'index.js'))}
Environment=${quote(`PATH=${path.dirname(process.execPath)}:${path.join(os.homedir(), '.local/bin')}:/usr/local/bin:/usr/bin:/bin`)}
Environment=TZ=Asia/Jakarta
Restart=on-failure
RestartPreventExitStatus=78
RestartSec=15
TimeoutStopSec=15
UMask=0077
NoNewPrivileges=true

[Install]
WantedBy=default.target
`;
function ctl(...args) {
  const result = spawnSync('systemctl', ['--user', ...args], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
try {
  if (process.platform !== 'linux') throw new Error('Script ini khusus Linux.');
  switch (process.argv[2]) {
    case 'print': console.log(unit); break;
    case 'install':
      if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') !== unit) throw new Error(`Unit ${file} sudah ada dan berbeda. Backup atau hapus unit itu sebelum install ulang.`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, unit, { mode: 0o600 });
      ctl('daemon-reload'); ctl('enable', service);
      console.log('Auto-start terpasang untuk login user berikutnya. Setelah QR berhasil, jalankan: node linux/manage-bot.js start');
      break;
    case 'start': case 'stop': case 'restart': case 'status': ctl(process.argv[2], service); break;
    case 'logs': {
      const result = spawnSync('journalctl', ['--user', '-u', service, '-f'], { stdio: 'inherit' });
      process.exitCode = result.status || 0; break;
    }
    case 'uninstall':
      ctl('disable', '--now', service);
      fs.rmSync(file, { force: true }); ctl('daemon-reload'); break;
    default: console.log('Pakai: node linux/manage-bot.js install|start|stop|restart|status|logs|uninstall');
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
