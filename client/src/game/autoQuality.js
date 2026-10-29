// Keeps the game smooth when the GPU is shared (e.g. the real game running in the background): every 2 s it looks
// at frame times and steps graphics quality down (high -> medium -> low -> potato), and back up — never above the
// player's chosen level — after a long stretch of headroom. F3 toggles a small FPS readout.
const LEVELS = ['high', 'medium', 'low', 'potato'];
const NAME = { high: 'High', medium: 'Medium', low: 'Low', potato: 'Lowest' };
const WINDOW_MS = 2000;
const COOLDOWN_MS = 2500; // after a change: render targets re-allocate, shaders recompile
const BAD_MEDIAN_MS = 22; // < ~45 fps
const BAD_P90_MS = 45;
const GOOD_WINDOWS = 5; // 10 s of headroom before trying a higher level
const RETRY_BLOCK_MS = 60000; // an upgrade that immediately failed isn't retried for a minute

export class AutoQuality {
  constructor({ apply, notify, renderer }) {
    this.apply = apply;
    this.notify = notify;
    this.renderer = renderer;
    this.max = 'high';
    this.level = 'high';
    this.samples = [];
    this.windowStart = 0;
    this.coolUntil = performance.now() + 4000; // startup: floor texture + shader warm-up
    this.good = 0;
    this.upAt = -Infinity;
    this.blockUpUntil = 0;
    this.fpsEl = null;
    this.fpsFrames = 0;
    this.fpsAt = 0;
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'F3') return;
      e.preventDefault();
      this.toggleFps();
    });
  }

  /** The player picked a level in the menu: it becomes the ceiling and the current level. */
  reset(max) {
    this.max = LEVELS.includes(max) ? max : 'high';
    this.set(this.max);
    this.blockUpUntil = 0;
  }

  frame(ms, now) {
    this.tickFps(now);
    if (!(ms > 0) || ms > 400) {
      // tab switches and long pauses aren't the GPU's fault
      this.samples.length = 0;
      this.windowStart = now;
      return;
    }
    if (now < this.coolUntil) {
      this.windowStart = now;
      return;
    }
    this.samples.push(ms);
    if (now - this.windowStart < WINDOW_MS) return;
    const s = this.samples.sort((a, b) => a - b);
    const median = s[s.length >> 1];
    const p90 = s[Math.floor(s.length * 0.9)];
    this.samples = [];
    this.windowStart = now;
    const i = LEVELS.indexOf(this.level);
    if ((median > BAD_MEDIAN_MS || p90 > BAD_P90_MS) && i < LEVELS.length - 1) {
      if (now - this.upAt < 10000) this.blockUpUntil = now + RETRY_BLOCK_MS;
      this.good = 0;
      this.set(LEVELS[i + 1]);
      this.notify(`Graphics lowered to ${NAME[this.level]} to keep the game smooth`);
    } else if (median < 17.5 && p90 < 25 && i > LEVELS.indexOf(this.max) && now >= this.blockUpUntil) {
      if (++this.good >= GOOD_WINDOWS) {
        this.good = 0;
        this.upAt = now;
        this.set(LEVELS[i - 1]);
      }
    } else this.good = 0;
  }

  set(level) {
    this.level = level;
    this.apply(level);
    this.coolUntil = performance.now() + COOLDOWN_MS;
    this.samples = [];
  }

  toggleFps() {
    if (this.fpsEl) {
      this.fpsEl.remove();
      this.fpsEl = null;
      return;
    }
    this.fpsEl = document.createElement('div');
    this.fpsEl.style.cssText =
      'position:fixed;left:50%;top:6px;transform:translateX(-50%);z-index:50;font:600 12px/1.4 ui-monospace,monospace;' +
      'color:#e8fff6;background:rgba(10,20,24,.72);padding:3px 8px;border-radius:6px;pointer-events:none';
    document.body.appendChild(this.fpsEl);
    this.fpsFrames = 0;
    this.fpsAt = performance.now();
  }

  tickFps(now) {
    if (!this.fpsEl) return;
    this.fpsFrames++;
    if (now - this.fpsAt < 500) return;
    const fps = Math.round((this.fpsFrames * 1000) / (now - this.fpsAt));
    const c = this.renderer.domElement;
    this.fpsEl.textContent = `${fps} fps · ${NAME[this.level]} · ${c.width}×${c.height}`;
    this.fpsFrames = 0;
    this.fpsAt = now;
  }
}
