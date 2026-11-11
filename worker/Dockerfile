# CodeCraft video worker - the same code as on the laptop, in a container.
# For a Render "Background Worker" (Docker) later: Root Directory = repo root,
# Dockerfile Path = worker/Dockerfile, env vars BACKEND_URL + VIDEO_WORKER_TOKEN.
# (Render background workers are a paid plan - nothing here runs until you create one.)
#
# Build locally to check:  docker build -f worker/Dockerfile -t codecraft-video-worker .

FROM node:22-bookworm-slim

# git/cmake/compiler: HyperFrames builds whisper.cpp (free local transcription).
# The rest: what headless Chrome needs to render captions and graphics.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates git cmake build-essential \
      fonts-liberation fonts-noto-color-emoji libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libgbm1 \
      libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libasound2 libpango-1.0-0 libcairo2 libgtk-3-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production HYPERFRAMES_NO_TELEMETRY=1 WORK_DIR=/tmp/codecraft-video-worker

# The shared 9:16 / 16:9 framing (also used by the backend's video.edit plugin).
COPY backend/core/video/framing.js backend/core/video/framing.js

COPY worker/package.json worker/package-lock.json worker/
RUN cd worker && npm ci --omit=dev

COPY worker/ worker/

# Bake in Chrome, the whisper.cpp build and the small.en model, so the first job doesn't wait.
RUN cd worker && node -e "\
const {spawnSync}=require('child_process');const path=require('path');\
const ff=require('ffmpeg-static'),fp=require('ffprobe-static').path;\
const env={...process.env,PATH:[path.dirname(ff),path.dirname(fp),process.env.PATH].join(':')};\
const hf='node_modules/hyperframes/bin/hyperframes.mjs';\
const run=(a)=>{const r=spawnSync(process.execPath,[hf,...a],{stdio:'inherit',env});if(r.status!==0)process.exit(r.status||1)};\
run(['browser','ensure']);\
spawnSync(ff,['-y','-f','lavfi','-i','sine=frequency=440:duration=2','-ar','16000','-ac','1','/tmp/warm.wav'],{stdio:'ignore'});\
spawnSync(process.execPath,[hf,'transcribe','/tmp/warm.wav','--dir','/tmp/warm','--engine','whisper','--model','small.en','--json'],{stdio:'inherit',env});\
"

CMD ["node", "worker/index.js"]
