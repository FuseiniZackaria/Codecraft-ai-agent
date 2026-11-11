# CodeCraft video worker

Edits Content Studio videos: FFmpeg, free local Whisper (through HyperFrames)
and HyperFrames for branded captions and graphics, all rendered on this
machine. The same code runs on a laptop or as a Render background worker
(`Dockerfile`).

```
npm install
npm run setup     # Whisper + HyperFrames browser + creates .env
# fill in BACKEND_URL and VIDEO_WORKER_TOKEN in .env
npm start         # or double-click start-worker.bat
```

Full guide: [docs/video-editor.md](../docs/video-editor.md).
