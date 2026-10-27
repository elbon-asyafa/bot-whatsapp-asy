#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
# Build first; the current bot stays available if the build fails.
sudo docker build -t bot-wa-asy .
# Named volume retains the WA login across container replacements.
sudo docker volume create bot-wa-auth >/dev/null
if sudo docker container inspect bot-wa-running >/dev/null 2>&1; then
  if ! sudo docker inspect --format '{{range .Mounts}}{{if eq .Destination "/app/auth_session"}}{{.Name}}{{end}}{{end}}' bot-wa-running | grep -qx bot-wa-auth; then
    echo 'Container lama belum memakai volume bot-wa-auth. Backup/migrasikan auth_session dulu sesuai README; container lama tetap berjalan.' >&2
    exit 1
  fi
  sudo docker stop bot-wa-running
  sudo docker rm bot-wa-running
fi
sudo docker run -d --name bot-wa-running --env-file .env --restart unless-stopped \
  --mount type=volume,source=bot-wa-auth,target=/app/auth_session bot-wa-asy
echo 'Bot diperbarui. Lihat: sudo docker logs -f bot-wa-running'
