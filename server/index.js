// Game server: static client (or Vite dev middleware with --dev) + /api/info + WebSocket rooms on /ws.
//   PORT (default 47820, an uncommon port so it never clashes with other local projects), HOST (default all interfaces), TIME_SCALE (tests only: run the room clock faster).
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { MAX_PLAYERS, PROTOCOL_VERSION, ROOM_CODE_ALPHABET, ROOM_CODE_LEN } from '../shared/config.js';
import { C2R, R2C } from '../shared/protocol.js';
import { Room, ROOM_TICK_HZ } from '../shared/room.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const DEV = process.argv.includes('--dev');
const PORT = Number(process.env.PORT) || 47820;
const HOST = process.env.HOST || undefined; // undefined = all interfaces
const TIME_SCALE = Number(process.env.TIME_SCALE) || 1;
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

const HANDSHAKE_TIMEOUT_MS = 15000;
const HEARTBEAT_MS = 10000;
const MAX_MSG_BYTES = 4096;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.glb': 'model/gltf-binary',
};

// ------------------------------------------------------------------ rooms

const t0 = performance.now();
const roomNow = () => (performance.now() - t0) * TIME_SCALE;
const rooms = new Map(); // code -> Room
const clients = new Map(); // playerId -> client
let clientNo = 0;

// Rooms broadcast the same message object to many players: serialize it once.
const jsonCache = new WeakMap();
function sendTo(id, msg) {
  const c = clients.get(id);
  if (!c || c.ws.readyState !== 1) return;
  let json = jsonCache.get(msg);
  if (!json) jsonCache.set(msg, (json = JSON.stringify(msg)));
  c.ws.send(json);
}

function newCode() {
  for (;;) {
    let code = '';
    for (let i = 0; i < ROOM_CODE_LEN; i++) code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
    if (!rooms.has(code)) return code;
  }
}

function createRoom() {
  const code = newCode();
  const room = new Room({ code, now: roomNow, send: sendTo, onEmpty: () => rooms.delete(code) });
  rooms.set(code, room);
  return room;
}

function reject(c, msg) {
  c.ws.send(JSON.stringify({ t: R2C.ERR, msg }));
  c.ws.close(4000, 'rejected');
}

function handshake(c, msg) {
  if (msg.t !== C2R.CREATE && msg.t !== C2R.JOIN) return;
  if (msg.v !== PROTOCOL_VERSION) return reject(c, 'Game version mismatch — reload the page');
  let room;
  if (msg.t === C2R.CREATE) room = createRoom();
  else {
    room = rooms.get(String(msg.code ?? '').toUpperCase().trim());
    if (!room) return reject(c, 'Room not found — check the code');
    if (room.players.size >= MAX_PLAYERS) return reject(c, 'Room is full');
  }
  clearTimeout(c.handshakeTimer);
  c.room = room;
  clients.set(c.id, c);
  if (!room.addPlayer(c.id, msg.name)) {
    clients.delete(c.id);
    c.room = null;
    if (room.humanCount === 0) rooms.delete(room.code);
    c.ws.close(4000, 'rejected');
  }
}

function tickAll() {
  for (const room of rooms.values()) {
    try {
      room.tick();
    } catch (e) {
      console.error(`[room ${room.code}] tick failed`, e);
    }
  }
}

// ------------------------------------------------------------------ http

let vite = null;

function serveStatic(req, res) {
  let rel;
  try {
    rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  let file = path.join(DIST, path.normalize(rel));
  if (!file.startsWith(DIST)) {
    res.writeHead(403).end();
    return;
  }
  if (rel.endsWith('/')) file = path.join(file, 'index.html');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      // SPA fallback for extension-less paths; real 404 for missing assets
      if (path.extname(rel)) return res.writeHead(404, { 'content-type': MIME['.txt'] }).end('Not found');
      file = path.join(DIST, 'index.html');
      if (!fs.existsSync(file)) {
        return res
          .writeHead(404, { 'content-type': MIME['.txt'] })
          .end('No build found. Run `npm run build` first, or use `npm run dev`.');
      }
    }
    const ext = path.extname(file).toLowerCase();
    const immutable = rel.includes('/assets/');
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  if (pathname.endsWith('/api/info')) {
    res.writeHead(200, { 'content-type': MIME['.json'], 'cache-control': 'no-store' });
    res.end(JSON.stringify({ server: true, version: VERSION, protocol: PROTOCOL_VERSION, rooms: rooms.size }));
    return;
  }
  if (vite) return vite.middlewares(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(405).end();
  serveStatic(req, res);
});

// ------------------------------------------------------------------ websocket

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MSG_BYTES });

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, 'http://x');
  if (pathname.endsWith('/ws') && req.headers['sec-websocket-protocol'] !== 'vite-hmr') {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  } else if (!vite) {
    socket.destroy(); // in dev, Vite's HMR socket handles its own upgrades
  }
});

wss.on('connection', (ws) => {
  const c = { id: `p${(++clientNo).toString(36)}`, ws, room: null };
  c.handshakeTimer = setTimeout(() => !c.room && ws.close(4001, 'handshake timeout'), HANDSHAKE_TIMEOUT_MS);
  ws.alive = true;
  ws.on('pong', () => (ws.alive = true));
  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    try {
      if (c.room) c.room.handle(c.id, msg);
      else handshake(c, msg);
    } catch (e) {
      console.error('[ws] message failed', e);
    }
  });
  ws.on('close', () => {
    clearTimeout(c.handshakeTimer);
    if (clients.get(c.id) === c) clients.delete(c.id);
    c.room?.removePlayer(c.id);
    c.room = null;
  });
  ws.on('error', () => {});
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) {
      ws.terminate();
      continue;
    }
    ws.alive = false;
    ws.ping();
  }
}, HEARTBEAT_MS);

// ------------------------------------------------------------------ start / stop

const ticker = setInterval(tickAll, 1000 / ROOM_TICK_HZ);

function lanUrls(port) {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list ?? []) if (ni.family === 'IPv4' && !ni.internal) out.push(`http://${ni.address}:${port}/`);
  }
  return out;
}

async function start() {
  if (DEV) {
    const { createServer } = await import('vite');
    vite = await createServer({
      configFile: path.join(ROOT, 'vite.config.js'),
      server: { middlewareMode: true, ws: { server } },
      appType: 'spa',
    });
  }
  server.listen(PORT, HOST, () => {
    const port = server.address().port;
    console.log(`Shugo Jump Jump server ${VERSION} (${DEV ? 'dev, Vite HMR' : 'serving dist/'})${TIME_SCALE !== 1 ? ` TIME_SCALE=${TIME_SCALE}` : ''}`);
    console.log(`  Local:   http://localhost:${port}/`);
    if (!HOST || HOST === '0.0.0.0' || HOST === '::') for (const u of lanUrls(port)) console.log(`  LAN:     ${u}`);
    console.log(`listening on ${port}`);
  });
}

function shutdown() {
  clearInterval(ticker);
  clearInterval(heartbeat);
  for (const c of clients.values()) {
    try {
      c.ws.send(JSON.stringify({ t: R2C.CLOSED, msg: 'The server is shutting down' }));
      c.ws.close(1001);
    } catch {
      // socket already gone
    }
  }
  server.close();
  vite?.close();
  setTimeout(() => process.exit(0), 300).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use (set PORT=...)` : e);
  process.exit(1);
});

start();
