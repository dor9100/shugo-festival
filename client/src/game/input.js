// Keyboard state for the game. Ignores keys typed into form fields; clears on blur so keys never stick.
const MOVE_CODES = {
  KeyW: 'f', ArrowUp: 'f',
  KeyS: 'b', ArrowDown: 'b',
  KeyA: 'l', ArrowLeft: 'l',
  KeyD: 'r', ArrowRight: 'r',
};

function isTyping(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export class Input {
  constructor(target = window) {
    this.target = target;
    this.down = new Set(); // physical codes held
    this.jumpQueue = []; // timestamps (performance.now) of Space presses not yet consumed
    this.enabled = true; // false while the Esc menu / main menu own the keyboard
    this.keyHandlers = new Map(); // code -> fn(e) for one-shot actions (Tab, Esc, M ...)
    this.keyUpHandlers = new Map();

    this._down = (e) => {
      if (isTyping(e.target) && e.code !== 'Escape') return;
      const handler = this.keyHandlers.get(e.code);
      if (handler) {
        if (handler(e) !== false) e.preventDefault();
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault(); // never "click" a focused button / scroll
        if (!e.repeat && this.enabled) this.jumpQueue.push(performance.now());
        return;
      }
      if (MOVE_CODES[e.code] || e.code === 'KeyQ' || e.code === 'KeyE') {
        if (e.code.startsWith('Arrow')) e.preventDefault();
        this.down.add(e.code);
      }
    };
    this._up = (e) => {
      this.down.delete(e.code);
      const handler = this.keyUpHandlers.get(e.code);
      if (handler) handler(e);
    };
    this._blur = () => this.clear();
    target.addEventListener('keydown', this._down);
    target.addEventListener('keyup', this._up);
    window.addEventListener('blur', this._blur);
  }

  clear() {
    this.down.clear();
    this.jumpQueue.length = 0;
    for (const fn of this.keyUpHandlers.values()) fn({ code: '', synthetic: true });
  }

  /** -> {x: right(+)/left(-), y: forward(+)/back(-)} in [-1,1], zero when disabled */
  axis() {
    if (!this.enabled) return { x: 0, y: 0 };
    const held = { f: 0, b: 0, l: 0, r: 0 };
    for (const code of this.down) {
      const m = MOVE_CODES[code];
      if (m) held[m] = 1;
    }
    return { x: held.r - held.l, y: held.f - held.b };
  }

  rotateAxis() {
    if (!this.enabled) return 0;
    return (this.down.has('KeyQ') ? 1 : 0) - (this.down.has('KeyE') ? 1 : 0);
  }

  /** Pop the oldest pending Space press (timestamp) or null. */
  takeJump() {
    return this.jumpQueue.length ? this.jumpQueue.shift() : null;
  }

  onKey(code, fn) {
    this.keyHandlers.set(code, fn);
  }
  onKeyUp(code, fn) {
    this.keyUpHandlers.set(code, fn);
  }

  dispose() {
    this.target.removeEventListener('keydown', this._down);
    this.target.removeEventListener('keyup', this._up);
    window.removeEventListener('blur', this._blur);
  }
}
