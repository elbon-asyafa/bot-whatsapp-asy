#!/usr/bin/env bash
set -euo pipefail
# Interactive cleanup of dangling images only; no volumes or other containers removed.
docker image prune
