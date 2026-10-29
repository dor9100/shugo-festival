// Sound. Every slot is either a file listed in client/public/sfx/manifest.json (SOUND agent delivers
// sfx/<slot>.mp3) or, when missing / failing to decode, a WebAudio synth fallback. Two looping music slots
// (music_lobby, music_round) play quietly on their own bus. Mute silences everything; SFX and music have
// separate volume settings. The AudioContext is created/unlocked on the first user gesture.
import { settings, onSettings } from './settings.js';

// ------------------------------------------------------------------------------- synth building blocks
function env(g, t, a, peak, d) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}

function tone(ctx, out, { type = 'sine', f0, f1 = f0, t = 0, at = null, dur = 0.15, vol = 0.3, attack = 0.005 }) {
  const t0 = at ?? ctx.currentTime + t;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  env(g, t0, attack, vol, dur);
  o.connect(g).connect(out);
  o.start(t0);
  o.stop(t0 + attack + dur + 0.05);
}

let noiseBuf = null;
function noise(ctx, out, { t = 0, at = null, dur = 0.3, vol = 0.4, type = 'lowpass', f0 = 2000, f1 = f0, q = 0.8 }) {
  if (!noiseBuf || noiseBuf.sampleRate !== ctx.sampleRate) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t0 = at ?? ctx.currentTime + t;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, t0);
  if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  const g = ctx.createGain();
  env(g, t0, 0.005, vol, dur);
  src.connect(f).connect(g).connect(out);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

const notes = (ctx, out, list, type, step, dur, vol) => list.forEach((f, i) => tone(ctx, out, { type, f0: f, t: i * step, dur, vol }));

// ------------------------------------------------------------------- slots (names agreed with SOUND)
export const SFX = {
  pickup_green: (c, o) => notes(c, o, [1046, 1318, 1568], 'sine', 0.05, 0.16, 0.18),
  pickup_pink: (c, o) => {
    notes(c, o, [1318, 1661, 1976, 2637], 'triangle', 0.045, 0.22, 0.15);
    noise(c, o, { dur: 0.4, vol: 0.05, type: 'highpass', f0: 6000 });
  },
  pickup_yellow: (c, o) => notes(c, o, [1568, 1976, 2349, 3136], 'square', 0.04, 0.12, 0.06),
  immune_on: (c, o) => notes(c, o, [880, 1108, 1318, 1760, 2217], 'sine', 0.06, 0.3, 0.07),
  immune_off: (c, o) => notes(c, o, [1760, 1318, 880], 'sine', 0.07, 0.2, 0.06),
  countdown_tick: (c, o) => tone(c, o, { type: 'sine', f0: 660, dur: 0.16, vol: 0.2 }),
  round_start: (c, o) => {
    tone(c, o, { type: 'sine', f0: 990, dur: 0.38, vol: 0.22 });
    tone(c, o, { type: 'triangle', f0: 1485, dur: 0.3, vol: 0.08 });
  },
  round_end: (c, o) => notes(c, o, [784, 659, 523], 'triangle', 0.14, 0.25, 0.16),
  results: (c, o) => notes(c, o, [523, 659, 784, 1046, 1318], 'triangle', 0.11, 0.32, 0.15),
  ui_click: (c, o) => tone(c, o, { type: 'sine', f0: 1200, f1: 900, dur: 0.04, vol: 0.06 }),
  ui_error: (c, o) => {
    tone(c, o, { type: 'square', f0: 210, dur: 0.07, vol: 0.06 });
    tone(c, o, { type: 'square', f0: 160, t: 0.08, dur: 0.1, vol: 0.06 });
  },
};
export const MUSIC_SLOTS = ['music_lobby', 'music_round'];
export const SLOT_NAMES = [...Object.keys(SFX), ...MUSIC_SLOTS];

// ------------------------------------------------------------------------- synth music fallback
const MIDI = (n) => 440 * 2 ** ((n - 69) / 12);
const MUSIC_PATTERNS = {
  // gentle festival arpeggio, C major: C Am F G
  music_lobby: { bpm: 92, chords: [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]], arp: [0, 1, 2, 3, 2, 1, 2, 1], lead: 'triangle', drums: false },
  // bouncy round loop, A minor: Am F C G
  music_round: { bpm: 132, chords: [[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62]], arp: [0, 2, 1, 3, 0, 2, 1, 2], lead: 'square', drums: true },
};

class SynthLoop {
  constructor(ctx, out, p) {
    this.ctx = ctx;
    this.p = p;
    this.out = out;
    this.step = 0;
    this.next = ctx.currentTime + 0.08;
    this.dur = 60 / p.bpm / 2; // 8th notes
    this.timer = setInterval(() => this.schedule(), 60);
    this.schedule();
  }
  schedule() {
    const { ctx, p } = this;
    while (this.next < ctx.currentTime + 0.25) {
      const chord = p.chords[Math.floor(this.step / 8) % p.chords.length];
      const i = p.arp[this.step % 8];
      const n = i === 3 ? chord[0] + 12 : chord[i];
      tone(ctx, this.out, { type: p.lead, f0: MIDI(n + 12), at: this.next, dur: this.dur * 0.9, vol: p.lead === 'square' ? 0.035 : 0.07, attack: 0.01 });
      if (this.step % 4 === 0) tone(ctx, this.out, { type: 'sine', f0: MIDI(chord[0] - 12), at: this.next, dur: this.dur * 3.5, vol: 0.12, attack: 0.02 });
      if (p.drums) {
        if (this.step % 2 === 1) noise(ctx, this.out, { at: this.next, dur: 0.05, vol: 0.04, type: 'highpass', f0: 7000 });
        if (this.step % 4 === 0) tone(ctx, this.out, { type: 'sine', f0: 140, f1: 45, at: this.next, dur: 0.14, vol: 0.18 });
      }
      this.next += this.dur;
      this.step++;
    }
  }
  stop() {
    clearInterval(this.timer);
  }
}

// --------------------------------------------------------------------------------------- engine
function normalizeManifest(m) {
  // Accepts ["jump.mp3", ...] | {jump:"jump.mp3"} | {files|sounds|slots: (array|object)} | [{slot,file}]
  const out = {};
  const add = (slot, file) => {
    if (typeof slot === 'string' && typeof file === 'string') out[slot.replace(/\.(mp3|ogg|wav)$/i, '')] = file;
  };
  const walk = (v) => {
    if (Array.isArray(v)) {
      for (const it of v) {
        if (typeof it === 'string') add(it, /\.(mp3|ogg|wav)$/i.test(it) ? it : `${it}.mp3`);
        else if (it && typeof it === 'object') add(it.slot ?? it.name ?? it.id, it.file ?? it.src ?? it.url ?? `${it.slot ?? it.name}.mp3`);
      }
    } else if (v && typeof v === 'object') {
      for (const key of ['files', 'sounds', 'slots', 'sfx']) if (key in v) return walk(v[key]);
      for (const [k, f] of Object.entries(v)) {
        if (typeof f === 'string') add(k, f);
        else if (f && typeof f === 'object') add(k, f.file ?? f.src ?? f.url ?? `${k}.mp3`);
        else if (f === true) add(k, `${k}.mp3`);
      }
    }
  };
  walk(m);
  return out;
}

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.buffers = new Map(); // slot -> AudioBuffer
    this.lastPlay = new Map();
    this.musicWanted = null;
    this.music = null; // {slot, gain, src|loop}
    this.filesReady = null;
    this._unlock = () => this.unlock();
    window.addEventListener('pointerdown', this._unlock, true);
    window.addEventListener('keydown', this._unlock, true);
    onSettings(() => this.applyVolume());
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const comp = this.ctx.createDynamicsCompressor();
      this.out = this.ctx.createGain(); // mute
      this.sfxBus = this.ctx.createGain();
      this.musicBus = this.ctx.createGain();
      this.sfxBus.connect(this.out);
      this.musicBus.connect(this.out);
      this.out.connect(comp).connect(this.ctx.destination);
      this.applyVolume();
      this.filesReady = this.loadFiles().then(() => this._applyMusic(true));
      this._applyMusic();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  applyVolume() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.out.gain.setTargetAtTime(settings.muted ? 0 : 1, t, 0.015);
    this.sfxBus.gain.setTargetAtTime(settings.volume * settings.volume, t, 0.02);
    const mv = settings.musicVolume ?? 0.5;
    this.musicBus.gain.setTargetAtTime(mv * 0.7, t, 0.05); // tracks are mastered quiet (-22 LUFS): keep under the SFX
  }

  async loadFiles() {
    let manifest = {};
    try {
      const res = await fetch(new URL('./sfx/manifest.json', document.baseURI), { cache: 'no-cache' });
      const type = res.headers.get('content-type') || '';
      if (res.ok && !type.includes('text/html')) manifest = normalizeManifest(await res.json());
    } catch {
      manifest = {};
    }
    // manifest paths are relative to the site root ("sfx/jump.mp3"); bare names ("jump.mp3") to sfx/
    const resolve = (f) => new URL(f.includes('/') ? f.replace(/^\.?\//, '') : `sfx/${f}`, document.baseURI);
    await Promise.all(
      SLOT_NAMES.filter((slot) => manifest[slot]).map(async (slot) => {
        try {
          const res = await fetch(resolve(manifest[slot]));
          if (!res.ok) return;
          const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
          this.buffers.set(slot, buf);
        } catch {
          /* synth fallback */
        }
      }),
    );
  }

  /** play('pickup_green'); opts.minGapMs throttles rapid repeats; opts.vol / opts.rate scale file playback */
  play(slot, opts = {}) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || settings.muted) return;
    const synth = SFX[slot];
    if (!synth) return;
    const nowMs = performance.now();
    if (nowMs - (this.lastPlay.get(slot) || 0) < (opts.minGapMs ?? 30)) return;
    this.lastPlay.set(slot, nowMs);
    const buf = this.buffers.get(slot);
    try {
      if (buf) {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = opts.rate ?? 1;
        const g = ctx.createGain();
        g.gain.value = opts.vol ?? 1;
        src.connect(g).connect(this.sfxBus);
        src.start();
      } else synth(ctx, this.sfxBus);
    } catch {
      /* never let audio break the game */
    }
  }

  /** 'music_lobby' | 'music_round' | null — crossfades. */
  setMusic(slot) {
    this.musicWanted = slot;
    this._applyMusic();
  }

  _applyMusic(force = false) {
    const ctx = this.ctx;
    if (!ctx) return;
    const want = this.musicWanted;
    const cur = this.music;
    const curIsFile = cur && !!cur.src;
    if (cur && cur.slot === want && !(force && !curIsFile && this.buffers.has(want))) return;
    if (cur) {
      const t = ctx.currentTime;
      cur.gain.gain.cancelScheduledValues(t);
      cur.gain.gain.setValueAtTime(cur.gain.gain.value, t);
      cur.gain.gain.linearRampToValueAtTime(0, t + 0.8);
      setTimeout(() => {
        try {
          cur.src?.stop();
        } catch {
          /* already stopped */
        }
        cur.loop?.stop();
        cur.gain.disconnect();
      }, 900);
      this.music = null;
    }
    if (!want) return;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(1, ctx.currentTime + 1.2);
    gain.connect(this.musicBus);
    const m = { slot: want, gain };
    const buf = this.buffers.get(want);
    if (buf) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(gain);
      src.start();
      m.src = src;
    } else if (MUSIC_PATTERNS[want]) {
      m.loop = new SynthLoop(ctx, gain, MUSIC_PATTERNS[want]);
    }
    this.music = m;
  }
}

export const audio = new AudioEngine();
