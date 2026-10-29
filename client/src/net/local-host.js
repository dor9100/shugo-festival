// Runs a Room in this tab (solo practice / P2P host). The local player talks to it through an in-memory
// loopback (JSON-cloned, async) with exactly the network message shapes; remote players are "links".
import { R2C } from '@shared/protocol.js';
import { Room, ROOM_TICK_HZ } from '@shared/room.js';
import { startTicker } from './ticker.js';

const clone = (m) => JSON.parse(JSON.stringify(m));

export class LocalHost {
  constructor(code) {
    this.code = code;
    this.links = new Map(); // playerId -> {send(msg), close()}
    this.playerNo = 0;
    this.localId = this._newId();
    this.onLocal = null; // (msg) => void, set by the Session
    this.room = new Room({ code, now: () => performance.now(), send: (id, msg) => this._route(id, msg) });
    this.stopTicker = startTicker(ROOM_TICK_HZ, () => this.room.tick());
    this.closed = false;
  }

  _newId() {
    return `p${++this.playerNo}`;
  }

  _route(id, msg) {
    if (id === this.localId) {
      const m = clone(msg);
      queueMicrotask(() => this.onLocal?.(m));
    } else {
      this.links.get(id)?.send(msg);
    }
  }

  /** Loopback link for the local player's Session (see Session: start/send/close + onmessage/onclose). */
  localLink(name, onClose) {
    const link = {
      onmessage: null,
      onclose: null,
      start: () => this.room.addPlayer(this.localId, name),
      send: (msg) => {
        const m = clone(msg);
        queueMicrotask(() => !this.closed && this.room.handle(this.localId, m));
      },
      close: () => {
        this.close('The host left the room');
        onClose?.();
      },
    };
    this.onLocal = (msg) => link.onmessage?.(msg);
    return link;
  }

  /** @returns {string|null} player id, or null if the room refused (the `err` was already sent on the link) */
  addRemote(link, name) {
    if (this.closed) return null;
    const id = this._newId();
    this.links.set(id, link);
    if (this.room.addPlayer(id, name)) return id;
    this.links.delete(id);
    return null;
  }

  fromRemote(id, msg) {
    if (this.links.has(id)) this.room.handle(id, msg);
  }

  removeRemote(id) {
    if (this.links.delete(id)) this.room.removePlayer(id);
  }

  close(reason) {
    if (this.closed) return;
    this.closed = true;
    this.stopTicker();
    for (const link of this.links.values()) {
      link.send({ t: R2C.CLOSED, msg: reason });
      link.close();
    }
    this.links.clear();
  }
}
