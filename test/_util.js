// Shared test helpers (no tests in here).
import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { Room } from '../shared/room.js';
import { createRng } from '../shared/rng.js';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Room on a fake clock that records every message per player. */
export function makeRoom({ seed = 1, t = 1000, code = 'TEST1' } = {}) {
  const clock = { t };
  const inbox = new Map(); // id -> msgs[]
  const ctx = { clock, inbox, emptied: 0 };
  ctx.room = new Room({
    code,
    now: () => clock.t,
    rng: createRng(seed),
    send: (id, msg) => {
      if (!inbox.has(id)) inbox.set(id, []);
      inbox.get(id).push(JSON.parse(JSON.stringify(msg)));
    },
    onEmpty: () => ctx.emptied++,
  });
  ctx.msgs = (id, t) => (inbox.get(id) ?? []).filter((m) => !t || m.t === t);
  ctx.last = (id, t) => ctx.msgs(id, t).at(-1);
  ctx.clear = () => inbox.clear();
  /** advance the clock in TICK steps, ticking the room */
  ctx.advance = (ms, step = 50) => {
    const end = clock.t + ms;
    while (clock.t < end) {
      clock.t = Math.min(end, clock.t + step);
      ctx.room.tick();
    }
  };
  ctx.advanceTo = (pred, maxMs = 400000, step = 50) => {
    const end = clock.t + maxMs;
    while (!pred()) {
      if (clock.t >= end) throw new Error('advanceTo: condition never met');
      clock.t += step;
      ctx.room.tick();
    }
  };
  return ctx;
}

function canListen(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });
}

/** A free localhost port picked by the OS, so tests never collide with other local projects. */
export async function freePort() {
  for (let i = 0; i < 5; i++) {
    const port = await new Promise((resolve, reject) => {
      const s = net.createServer();
      s.once('error', reject);
      s.listen(0, '127.0.0.1', () => {
        const { port } = s.address();
        s.close(() => resolve(port));
      });
    });
    if (await canListen(port)) return port;
  }
  throw new Error('no free port');
}

/** Starts the real server as a child process on localhost. */
export async function startServer({ timeScale = 1, dev = false } = {}) {
  const port = await freePort();
  const proc = spawn(process.execPath, ['server/index.js', ...(dev ? ['--dev'] : [])], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', TIME_SCALE: String(timeScale) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${out}`)), 15000);
    proc.stdout.on('data', (d) => {
      out += d;
      if (out.includes('listening on')) {
        clearTimeout(timer);
        resolve();
      }
    });
    proc.stderr.on('data', (d) => (out += d));
    proc.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited (${code}):\n${out}`));
    });
  });
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    output: () => out,
    stop: () =>
      new Promise((resolve) => {
        if (proc.exitCode !== null) return resolve();
        proc.once('exit', resolve);
        proc.kill();
      }),
  };
}

/** Minimal promise-friendly ws client that records all messages. */
export function wsClient(url) {
  const ws = new WebSocket(url);
  const c = {
    ws,
    msgs: [],
    waiters: [],
    send: (m) => ws.send(JSON.stringify(m)),
    of: (t) => c.msgs.filter((m) => m.t === t),
    waitFor(pred, timeout = 10000, label = 'message') {
      const hit = c.msgs.find(pred);
      if (hit) return Promise.resolve(hit);
      return new Promise((resolve, reject) => {
        const w = { pred, resolve };
        const timer = setTimeout(() => {
          c.waiters.splice(c.waiters.indexOf(w), 1);
          reject(new Error(`timed out waiting for ${label}`));
        }, timeout);
        w.resolve = (m) => (clearTimeout(timer), resolve(m));
        c.waiters.push(w);
      });
    },
    close: () => ws.close(),
  };
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    c.msgs.push(m);
    for (const w of [...c.waiters]) {
      if (w.pred(m)) {
        c.waiters.splice(c.waiters.indexOf(w), 1);
        w.resolve(m);
      }
    }
  });
  c.opened = new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  return c;
}
