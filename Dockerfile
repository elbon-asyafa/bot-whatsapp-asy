FROM node:24-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg fontconfig fonts-noto-color-emoji python3 python3-venv \
    build-essential pkg-config libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
 && python3 -m venv /opt/yt-dlp \
 && /opt/yt-dlp/bin/pip install --no-cache-dir 'yt-dlp[default,curl-cffi]' \
 && rm -rf /var/lib/apt/lists/*
ENV PATH="/opt/yt-dlp/bin:${PATH}"
COPY package.json package-lock.json .npmrc ./
RUN npm ci --legacy-peer-deps --omit=dev
COPY --chown=node:node . .
RUN mkdir -p /app/auth_session /app/temp && chown node:node /app /app/auth_session /app/temp
USER node
CMD ["node", "index.js"]
