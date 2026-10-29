// Session API (SPEC "Session API"): one object per joined room, same surface for server / p2p / solo.
import { PROTOCOL_VERSION, ROOM_CODE_ALPHABET, ROOM_CODE_LEN } from '@shared/config.js';
import { C2R, R2C } from '@shared/protocol.js';
import { ClockSync } from './clock.js';
import { LocalHost } from './local-host.js';
import { p2pHostLink, p2pJoinLink, P2P_NOT_FOUND } from './p2p.js';

const PING_FAST_MS = 250; // first PING_FAST_FOR_MS after joining
const PING_FAST_FOR_MS = 2000;
const PING_MS = 2000;
const READY_TIMEOUT_MS = 10000;

export class Session {
  #handlers = new Map();
  #buffer = []; // room messages held until the first on() so nothing is missed right after joining
  #flushTimer = 0;
  #link;
  #clock;
  #pingTimer = 0;
  #joinedAt = 0;
  #closed = false;
  #ready;

  /** @param {{mode:string, link:object, local:boolean, timeoutMsg:string}} o */
  constructor({ mode, link, local, timeoutMsg }) {
    this.mode = mode;
    this.you = null;
    this.code = null;
    this.hostId = null;
    /** the `welcome` message (full room state at join) */
    this.welcome = null;
    this.#link = link;
    this.#clock = local ? null : new ClockSync();
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.#end(timeoutMsg), READY_TIMEOUT_MS);
      this.#ready = {
        resolve: () => (clearTimeout(timer), resolve(this)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      };
    });
    this.ready.catch(() => {});
    link.onmessage = (msg) => this.#receive(msg);
    link.onclose = (reason) => this.#end(reason);
    link.onerror = (msg) => this.welcome && !this.#closed && this.#dispatch({ t: 'error', msg }); // non-fatal
    link.start();
  }

  get isHost() {
    return this.hostId != null && this.hostId === this.you;
  }

  /** smoothed round-trip time in ms (0 when the room runs in this tab) */
  get ping() {
    return this.#clock ? Math.round(this.#clock.rtt) : 0;
  }

  /** synced room clock (ms) */
  now() {
    return performance.now() + (this.#clock ? this.#clock.offset : 0);
  }

  on(type, fn) {
    if (!this.#handlers.has(type)) this.#handlers.set(type, new Set());
    this.#handlers.get(type).add(fn);
    if (this.#buffer && !this.#flushTimer) {
      // flush on a macrotask so all handlers registered in the same synchronous block see the buffered messages
      this.#flushTimer = setTimeout(() => {
        const buf = this.#buffer;
        this.#buffer = null;
        for (const m of buf) this.#emit(m);
      }, 0);
    }
    return this;
  }

  off(type, fn) {
    this.#handlers.get(type)?.delete(fn);
    return this;
  }

  send(msg) {
    if (!this.#closed && msg && typeof msg === 'object') this.#link.send(msg);
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    clearTimeout(this.#pingTimer);
    this.#link.close();
  }

  #emit(msg) {
    for (const fn of this.#handlers.get(msg.t) ?? []) {
      try {
        fn(msg);
      } catch (e) {
        console.error(`[session] '${msg.t}' handler failed`, e);
      }
    }
  }

  #dispatch(msg) {
    if (this.#buffer) this.#buffer.push(msg);
    else this.#emit(msg);
  }

  #receive(msg) {
    if (this.#closed || !msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
    if (!this.welcome) {
      if (msg.t === R2C.ERR) return this.#end(msg.msg || 'The room refused to let you in');
      if (msg.t !== R2C.WELCOME) return;
      this.welcome = msg;
      this.you = msg.you;
      this.code = msg.code;
      this.hostId = msg.hostId;
      this.#joinedAt = performance.now();
      if (this.#clock) {
        this.#clock.seed(msg.now, performance.now());
        this.#sendPing();
      }
      this.#ready.resolve();
    } else if (msg.t === R2C.ROSTER) {
      this.hostId = msg.hostId;
    } else if (msg.t === R2C.PONG && this.#clock) {
      this.#clock.sample(msg.c, msg.s, performance.now());
    }
    this.#dispatch(msg);
    if (msg.t === R2C.CLOSED) this.#end(msg.msg || 'The room was closed');
  }

  #sendPing() {
    if (this.#closed) return;
    this.#link.send({ t: C2R.PING, c: performance.now() });
    const fast = performance.now() - this.#joinedAt < PING_FAST_FOR_MS;
    this.#pingTimer = setTimeout(() => this.#sendPing(), fast ? PING_FAST_MS : PING_MS);
  }

  #end(reason) {
    if (this.#closed) return;
    this.#closed = true;
    clearTimeout(this.#pingTimer);
    this.#link.close();
    if (!this.welcome) return this.#ready.reject(new Error(reason));
    this.#dispatch({ t: 'close', reason });
  }
}

// ------------------------------------------------------------------ public API

/** @returns {Promise<'server'|'p2p'>} `?mode=server|p2p` wins, else probe ./api/info */
/** Where the game is published (GitHub Pages). Invite links from localhost/LAN point here. */
export const PUBLIC_URL = 'https://dor9100.github.io/shugo-festival/';

/**
 * P2P by default, even when the page comes from the Node server: a P2P room code works from ANY copy of the site
 * (localhost, LAN or the public URL), so a friend can join a room hosted from `npm run dev`. ?mode=server opts in to
 * server-hosted rooms (LAN only unless the server itself is public).
 */
export async function detectMode() {
  const forced = urlParam('mode');
  return forced === 'server' ? 'server' : 'p2p';
}

/** @returns {Promise<Session>} */
export async function createRoom({ name, mode } = {}) {
  mode = await resolveMode(mode);
  if (mode === 'solo') return localSession('solo', new LocalHost('SOLO'), name);
  if (mode === 'server') return serverSession({ t: C2R.CREATE, name, v: PROTOCOL_VERSION });
  return p2pSession(await p2pHostLink(name), true);
}

/** @returns {Promise<Session>} throws Error with a user-readable message */
export async function joinRoom({ code, name, mode } = {}) {
  const c = normalizeCode(code);
  mode = await resolveMode(mode);
  if (mode === 'solo') throw new Error('Solo practice has no room to join');
  if (mode === 'server') return serverSession({ t: C2R.JOIN, code: c, name, v: PROTOCOL_VERSION });
  return p2pSession(await p2pJoinLink(c, name), false);
}

/** Room code typed by a user -> canonical form; throws a readable Error if it can't be one. */
export function normalizeCode(code) {
  const c = String(code ?? '').toUpperCase().replace(/[\s-]/g, '');
  const ok = c.length === ROOM_CODE_LEN && [...c].every((ch) => ROOM_CODE_ALPHABET.includes(ch));
  if (!ok) throw new Error(`Room codes are ${ROOM_CODE_LEN} letters/numbers — check the code`);
  return c;
}

/** Invite URL for a room: this page + ?room=CODE (+ &mode= if the mode was forced in the URL). */
export function inviteLink(code) {
  // a localhost / LAN page can't be opened by a friend: P2P invites point at the public site instead
  const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)/.test(location.hostname);
  const url = new URL(local && urlParam('mode') !== 'server' ? PUBLIC_URL : location.origin + location.pathname);
  url.searchParams.set('room', code);
  const forced = urlParam('mode');
  if (forced) url.searchParams.set('mode', forced);
  return url.toString();
}

/** Room code from ?room= (for pre-filling the join field), or ''. */
export function inviteCode() {
  try {
    return normalizeCode(urlParam('room'));
  } catch {
    return '';
  }
}

// ------------------------------------------------------------------ internals

function urlParam(key) {
  return typeof location === 'undefined' ? null : new URLSearchParams(location.search).get(key);
}

async function resolveMode(mode) {
  if (mode === 'solo' || mode === 'server' || mode === 'p2p') return mode;
  if (urlParam('mode') === 'solo') return 'solo';
  return detectMode();
}

function localSession(mode, host, name) {
  return new Session({ mode, link: host.localLink(name), local: true, timeoutMsg: 'Could not start the room' }).ready;
}

function p2pSession(link, isHost) {
  return new Session({ mode: 'p2p', link, local: isHost, timeoutMsg: P2P_NOT_FOUND }).ready;
}

function serverSession(first) {
  const url = new URL('ws', location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.search = '';
  url.hash = '';
  const link = { onmessage: null, onclose: null };
  let ws = null;
  let opened = false;
  link.start = () => {
    try {
      ws = new WebSocket(url);
    } catch {
      queueMicrotask(() => link.onclose?.("Can't reach the game server"));
      return;
    }
    ws.onopen = () => {
      opened = true;
      ws.send(JSON.stringify(first));
    };
    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      link.onmessage?.(msg);
    };
    ws.onclose = () => link.onclose?.(opened ? 'Disconnected from the game server' : "Can't reach the game server");
  };
  link.send = (msg) => ws?.readyState === 1 && ws.send(JSON.stringify(msg));
  link.close = () => {
    if (!ws) return;
    ws.onclose = null;
    ws.close();
  };
  return new Session({ mode: 'server', link, local: false, timeoutMsg: "The game server didn't answer" }).ready;
}
