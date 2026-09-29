// Serves the onboarding prototype on the Mac: npm run proto -> http://localhost:8766
// Never part of the app. The orb itself is the app's own bundle (app/src/main/assets/avatar);
// the prototype's script is rebuilt on every load, so edits show with a reload.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import * as esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.resolve(here, '../../../app/src/main/assets/avatar');
const models = path.resolve(here, '../../../models/avatar');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.vrm': 'model/gltf-binary' };
const PORT = Number(process.env.PORT || 8766), VOICE_PORT = PORT + 1;

// The app's real voice (Supertonic 3), if its model is on this Mac: voice_server.py runs it with ONNX
// Runtime. Without it, the prototype falls back to the Mac's own speech.
const voiceModel = process.env.VOICE_MODEL
  || path.resolve(here, '../../../../models-cache/sherpa-onnx-supertonic-3-tts-int8-2026-05-11');
let voice = null;
function startVoice() {   // only once this server has its port, so a second copy never starts one
  if (!fs.existsSync(path.join(voiceModel, 'voice.bin'))) {
    console.log(`no voice model at ${voiceModel}: the prototype uses the Mac's own speech instead`);
    return;
  }
  voice = spawn(process.env.PYTHON || 'python3', [path.join(here, 'voice_server.py'), voiceModel, String(VOICE_PORT)], { stdio: ['ignore', 'inherit', 'inherit'] });
  voice.on('exit', code => { console.log(`voice server stopped (${code})`); voice = null; });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { voice?.kill(); process.exit(0); });
  process.on('exit', () => voice?.kill());
}

const server = http.createServer(async (req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const nocache = { 'cache-control': 'no-store' };
  if (u === '/' || u === '/avatar/') { res.writeHead(302, { location: '/avatar/onboarding.html' }).end(); return; }
  if (u === '/avatar/tts' || u === '/avatar/tts-health') {   // to the voice server
    if (!voice) { res.writeHead(404).end(); return; }   // no voice model on this Mac (503 below: still starting)
    const up = http.get(`http://127.0.0.1:${VOICE_PORT}${u === '/avatar/tts' ? '/tts' : '/health'}${new URL(req.url, 'http://x').search}`, r => {
      res.writeHead(r.statusCode, { 'content-type': r.headers['content-type'] || 'application/octet-stream', 'cache-control': 'no-store' });
      r.pipe(res);
    });
    up.on('error', () => res.writeHead(503).end());
    return;
  }
  if (u === '/avatar/onboarding.js') {
    try {
      const out = await esbuild.build({
        entryPoints: [path.join(here, 'src/main.js')], bundle: true, write: false,
        format: 'iife', target: 'es2020', sourcemap: 'inline',
      });
      res.writeHead(200, { 'content-type': 'text/javascript', ...nocache }).end(out.outputFiles[0].text);
    } catch (e) {
      res.writeHead(500, { 'content-type': 'text/plain' }).end(String(e));
    }
    return;
  }
  const f = u === '/avatar/onboarding.html' ? path.join(here, 'onboarding.html')
    : u.startsWith('/avatar/models/') ? path.join(models, u.slice('/avatar/models/'.length))
    : u.startsWith('/avatar/') ? path.join(assets, u.slice('/avatar/'.length)) : null;
  if (!f || !(f.startsWith(assets) || f.startsWith(models) || f.startsWith(here)) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', ...nocache });
  fs.createReadStream(f).pipe(res);
});
server.on('error', e => {
  if (e.code !== 'EADDRINUSE') throw e;
  console.log(`The prototype is already running: open http://localhost:${PORT}\n`
    + `(To restart it here instead: pkill -f proto/serve.mjs, then npm run proto again.)`);
  process.exit(0);
});
server.listen(PORT, () => { console.log(`orb onboarding prototype: http://localhost:${PORT}`); startVoice(); });
