// P2P transport over PeerJS (cloud signalling + WebRTC data channels, JSON messages).
// Host: peer id `shugojj-v1-<CODE>`, runs a LocalHost; joiners connect to that id and say `hello`.
import { PROTOCOL_VERSION, ROOM_CODE_ALPHABET, ROOM_CODE_LEN } from '@shared/config.js';
import { C2R, R2C } from '@shared/protocol.js';
import { LocalHost } from './local-host.js';

export const PEER_PREFIX = 'shugojj-v1-';
export const P2P_NOT_FOUND = 'Room not found — check the code';
const NO_SIGNAL = "Can't reach the P2P server — check your internet connection";
const SIGNAL_TIMEOUT_MS = 10000;
const HOST_SILENCE_MS = 8000; // joiner: no message from the host for this long -> treat as gone

async function loadPeer() {
  const mod = await import('peerjs');
  return mod.Peer ?? mod.default;
}

function friendly(e) {
  switch (e?.type) {
    case 'peer-unavailable':
      return P2P_NOT_FOUND;
    case 'browser-incompatible':
      return "This browser doesn't support P2P (WebRTC). Try a recent Chrome, Edge or Firefox.";
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
    case 'timeout':
      return NO_SIGNAL;
    default:
      return e?.message || 'P2P connection failed';
  }
}

export function randomCode() {
  const bytes = crypto.getRandomValues(new Uint32Array(ROOM_CODE_LEN));
  return Array.from(bytes, (n) => ROOM_CODE_ALPHABET[n % ROOM_CODE_ALPHABET.length]).join('');
}

/** Resolves with an open Peer, rejects with the PeerJS error (has `.type`). */
function openPeer(Peer, id) {
  return new Promise((resolve, reject) => {
    const peer = id ? new Peer(id) : new Peer();
    const fail = (e) => {
      clearTimeout(timer);
      peer.destroy();
      reject(e);
    };
    const timer = setTimeout(() => fail(Object.assign(new Error(NO_SIGNAL), { type: 'timeout' })), SIGNAL_TIMEOUT_MS);
    peer.once('error', fail);
    peer.once('open', () => {
      clearTimeout(timer);
      peer.off('error', fail);
      resolve(peer);
    });
  });
}

/** Host: claims a fresh room code on the signalling server, then serves joiners from a LocalHost. */
export async function p2pHostLink(name) {
  const Peer = await loadPeer();
  let peer = null;
  let code = '';
  for (let i = 0; i < 6 && !peer; i++) {
    code = randomCode();
    try {
      peer = await openPeer(Peer, PEER_PREFIX + code);
    } catch (e) {
      if (e?.type !== 'unavailable-id') throw new Error(friendly(e)); // id taken -> try another code
    }
  }
  if (!peer) throw new Error('Could not create a room — please try again');

  const host = new LocalHost(code);
  const onHide = () => link.close();
  const link = host.localLink(name, () => {
    removeEventListener('pagehide', onHide);
    setTimeout(() => peer.destroy(), 500); // let the `closed` messages flush
  });
  addEventListener('pagehide', onHide);
  peer.on('connection', (conn) => acceptJoiner(host, conn));
  peer.on('disconnected', () => {
    // lost the signalling server: existing players keep playing, but new joins need it back
    if (host.closed) return;
    link.onerror?.("Lost the P2P server — new players can't join until it reconnects");
    setTimeout(() => !host.closed && !peer.destroyed && peer.reconnect(), 1000);
  });
  peer.on('error', (e) => !host.closed && link.onerror?.(friendly(e)));
  return link;
}

function acceptJoiner(host, conn) {
  let id = null;
  let state = 'new'; // new -> in | out
  const link = {
    send: (msg) => {
      try {
        if (conn.open) conn.send(msg);
      } catch {
        // channel closing
      }
    },
    close: () => setTimeout(() => conn.close(), 300),
  };
  conn.on('data', (msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (state === 'in') return host.fromRemote(id, msg);
    if (state !== 'new' || msg.t !== C2R.HELLO) return;
    if (msg.v !== PROTOCOL_VERSION) {
      state = 'out';
      link.send({ t: R2C.ERR, msg: 'Game version mismatch — both players should reload the page' });
      link.close();
      return;
    }
    id = host.addRemote(link, msg.name);
    state = id ? 'in' : 'out';
    if (!id) link.close(); // full: the room already sent `err`
  });
  const drop = () => {
    if (state === 'in') host.removeRemote(id);
    state = 'out';
  };
  conn.on('close', drop);
  conn.on('error', drop);
}

/** Joiner: connects to the host's peer id and says hello; the Session waits for `welcome`. */
export async function p2pJoinLink(code, name) {
  const Peer = await loadPeer();
  let peer;
  try {
    peer = await openPeer(Peer);
  } catch (e) {
    throw new Error(friendly(e));
  }
  const link = { onmessage: null, onclose: null };
  let conn = null;
  let welcomed = false;
  let ended = false;
  let lastSeen = Date.now();
  let watchdog = 0;
  const end = (reason) => {
    if (ended) return;
    ended = true;
    clearInterval(watchdog);
    link.onclose?.(reason);
  };
  const onHide = () => link.close();

  link.start = () => {
    conn = peer.connect(PEER_PREFIX + code, { reliable: true, serialization: 'json' });
    conn.on('open', () => conn.send({ t: C2R.HELLO, name, v: PROTOCOL_VERSION }));
    conn.on('data', (msg) => {
      lastSeen = Date.now();
      if (msg?.t === R2C.WELCOME) welcomed = true;
      link.onmessage?.(msg);
    });
    conn.on('close', () => end(welcomed ? 'The host left the room' : P2P_NOT_FOUND));
    conn.on('error', () => end(welcomed ? 'Lost connection to the host' : P2P_NOT_FOUND));
    peer.on('error', (e) => !welcomed && end(friendly(e))); // after joining, signalling errors don't matter
    watchdog = setInterval(() => {
      if (welcomed && Date.now() - lastSeen > HOST_SILENCE_MS) end('Lost connection to the host');
    }, 1000);
    addEventListener('pagehide', onHide);
  };
  link.send = (msg) => {
    try {
      if (conn?.open) conn.send(msg);
    } catch {
      // channel closing
    }
  };
  link.close = () => {
    ended = true;
    clearInterval(watchdog);
    removeEventListener('pagehide', onHide);
    try {
      conn?.close();
    } catch {
      // already closed
    }
    setTimeout(() => peer.destroy(), 300);
  };
  return link;
}
