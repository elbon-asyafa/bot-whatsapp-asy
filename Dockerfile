# ============================================
# RECOMMENDED: Debian slim (glibc, prebuilt canvas binaries, no header download timeout)
# ============================================
FROM node:20-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    fontconfig \
    build-essential \
    python3 \
    python3-pip \
 && pip3 install --break-system-packages --no-cache-dir -U yt-dlp \
 && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm install --legacy-peer-deps
COPY . .
CMD ["node", "index.js"]

# ============================================
# Alpine (backup - may timeout on canvas header download)
# ============================================
# FROM node:20-alpine
# WORKDIR /app
# RUN apk add --no-cache \
#     ffmpeg \
#     yt-dlp \
#     cairo-dev \
#     pango-dev \
#     jpeg-dev \
#     giflib-dev \
#     librsvg-dev \
#     fontconfig-dev \
#     build-base \
#     python3
# ENV npm_config_fetch_timeout=600000
# ENV npm_config_fetch_retries=3
# COPY package*.json ./
# RUN npm install --legacy-peer-deps --unsafe-perm
# COPY . .
# CMD ["node", "index.js"]
