#!/bin/bash
set -e

sudo docker container prune -f
sudo docker image prune -a -f
sudo docker volume prune -f
sudo docker builder prune -a -f

echo "Docker cleanup selesai."
