#!/bin/bash
set -e

sudo docker stop bot-wa-running 2>/dev/null || true
sudo docker rm bot-wa-running 2>/dev/null || true
sudo docker build -t bot-wa-asy .
sudo docker run -d --name bot-wa-running --env-file .env --restart always bot-wa-asy

echo "Update Docker Bot Berhasil!"
