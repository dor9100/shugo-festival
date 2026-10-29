// One in-room game session: consumes Session messages (state store), runs the local player, claims laser hits
// and balloon pickups, interpolates remote players, and drives the World views + HUD.
import * as THREE from 'three';
import {
  CLIENT_SEND_HZ, INTERP_DELAY_MS, LASER_PENALTY, MAX_PLAYERS, ROUND_MS, SCORE_MIN,
} from '@shared/config.js';
import * as CONFIG from '@shared/config.js';
import { beamState, beamTimes, laserHitTest } from '@shared/lasers.js';
import { createMascot, LaserView, OrbView, BombView } from './worldApi.js';
import { LocalPlayer } from './player.js';
import { RemoteTrack } from './remote.js';
import { FEEL, MOVE_FEEL } from './tuning.js';
import { audio } from './audio.js';
import { settings } from './settings.js';
import { Hud } from '../ui/hud.js';
import { LobbyPanel, ResultsScreen, Scoreboard, EscMenu } from '../ui/overlays.js';
import { ORB_COLORS, PENALTY_COLOR, copyText, mmss, withRanks } from '../ui/dom.js';
import { canTouchOrb } from '@shared/pickup.js';

// all balloons share one pickup sound; pink/yellow are pitched up a touch so the color is audible
const PICKUP_RATE = { green: 1, pink: 1.06, yellow: 1.12 };

export const TIPS = {
  balloons: 'Touch the balloons to earn points!',
  lasers: 'Jump over the lasers with Space — touching them costs points!',
  pink: 'Pink balloons grant temporary invincibility!',
  bombs: 'Watch out for the bombs — they’ll make you jump in surprise!',
};

const HEAD_Y = 1.55;
const tmpV = new THREE.Vector3();

export class Game {
  /**
   * @param {object} o
   * @param o.world  {scene, camera, effects, setQuality}
   * @param o.session Session (SPEC Session API)
   * @param o.uiRoot DOM element for HUD/overlays
   * @param o.input  Input
   * @param o.orbit  OrbitCamera
   * @param o.inviteUrl string
   * @param o.onExit (message?) => void
   * @param o.toggleMute () => void
   * @param o.setQuality (q) => void
   */
  constructor(o) {
    Object.assign(this, o);
    const scene = o.world.scene;
    this.scene = scene;
    this.effects = o.world.effects;
    this.laserView = new LaserView(scene);
    this.orbView = new OrbView(scene);
    this.bombView = new BombView(scene);

    this.you = o.session.you;
    this.mode = o.session.mode;
    this.code = o.session.code;
    this.hostId = null;
    this.phase = 'lobby';
    this.phaseStart = 0;
    this.phaseEnd = 0;
    this.roundStart = 0;

    this.players = new Map(); // id -> entry
    this.beams = new Map(); // id -> descriptor
    this.beamList = [];
    this.claimed = new Set(); // beam ids I've claimed a hit for
    this.orbs = new Map(); // id -> {..., hidden, hiddenAt}
    this.bombs = new Map();
    this.ranking = null;
    this.local = new LocalPlayer();
    this.simT = null; // room ms the local physics has been simulated up to
    this.pendingJump = null;
    this.stepEv = { jumped: false, glideBlocked: false, landed: false };
    this.renderPos = { x: 0, y: 0, z: 0 };
    this.wasImmune = false;
    this.sendAcc = 1; // > 0 = send on the next frame
    this.lastSendAt = -1e9;
    this.frameDtMs = 1000 / 60;
    this.localHitFloats = 0;
    this.tips = new Set();
    this.tipQueue = [];
    this.lastTipAt = -1e9;
    this.lastBombTipAt = -1e9;
    this.cdShown = null;
    this.timeUpShown = false;
    this.netT = 0;
    this.stats = { hitsSent: 0, pickupsSent: 0, stSent: 0, glideMsgs: 0, jumps: 0 };
    this.disposed = false;

    // ---- UI
    const actions = {
      copyCode: () => this.copy(this.code, 'Room code copied'),
      copyInvite: () => this.copy(this.inviteUrl, 'Invite link copied'),
      toggleMute: () => o.toggleMute(),
      start: () => this.session.send({ t: 'start' }),
      bot: (add) => this.session.send({ t: 'bot', add }),
    };
    this.hud = new Hud(o.uiRoot, actions);
    this.hud.setRoom({ code: this.code, mode: this.mode });
    this.hud.setMuted(settings.muted);
    this.lobby = new LobbyPanel(o.uiRoot, actions);
    this.results = new ResultsScreen(o.uiRoot, actions);
    this.scoreboard = new Scoreboard(o.uiRoot);
    this.escMenu = new EscMenu(o.uiRoot, {
      leave: () => this.exit(),
      setMuted: (m) => o.toggleMute(m),
      setQuality: (q) => o.setQuality(q),
      onVisible: (on) => {
        this.input.enabled = !on;
        if (on) this.input.clear();
      },
    });

    // ---- keys
    this.input.enabled = true;
    this.input.onKey('Tab', (e) => {
      if (!e.repeat) {
        this.scoreboard.update(this.playerList(), this.you);
        this.scoreboard.show(true);
      }
    });
    this.input.onKeyUp('Tab', () => this.scoreboard.show(false));
    this.input.onKey('Escape', () => this.escMenu.toggle());
    this.input.onKey('KeyM', (e) => {
      if (!e.repeat) o.toggleMute();
    });

    // ---- session
    this._subs = [];
    const on = (t, fn) => {
      const f = fn.bind(this);
      this.session.on(t, f);
      this._subs.push([t, f]);
    };
    on('welcome', this.onWelcome);
    on('roster', this.onRoster);
    on('phase', this.onPhase);
    on('snap', this.onSnap);
    on('spawn', this.onSpawn);
    on('laser', this.onLaser);
    on('orb', this.onOrb);
    on('orbGone', this.onOrbGone);
    on('bomb', this.onBomb);
    on('boom', this.onBoom);
    on('score', this.onScore);
    on('immune', this.onImmune);
    on('results', this.onResults);
    on('err', (m) => this.hud.toast(m.msg || 'Error'));
    on('closed', (m) => this.exit(m.msg || 'The room was closed.'));
    on('close', (m) => this.exit(m?.reason || 'Disconnected from the room.'));
    on('error', (m) => console.warn('[session error]', m));

    this._vis = () => {
      if (document.visibilityState === 'visible') {
        this.simT = null; // restart the fixed-step clock: no catch-up / sweep across the hidden gap
        this.sendAcc = 1; // send state right away
      }
    };
    document.addEventListener('visibilitychange', this._vis);

    // test/debug hook
    const sent = [];
    const rawSend = this.session.send.bind(this.session);
    this.send = (m) => {
      if (m.t !== 'st') {
        sent.push({ ...m, at: this.session.now() });
        if (sent.length > 300) sent.shift();
      }
      rawSend(m);
    };
    window.__jj = { game: this, sent, beamState, laserHitTest, cfg: { ...CONFIG } };

    if (this.session.welcome) this.onWelcome(this.session.welcome);
    this.refreshPanels();
  }

  // ======================================================================================= messages
  onWelcome(w) {
    if (!w || w === this._welcome) return; // session.welcome applied eagerly + buffered 'welcome' event
    this._welcome = w;
    if (w.you) this.you = w.you;
    if (w.code) this.code = w.code;
    this.hud.setRoom({ code: this.code, mode: this.mode });
    this.applyRoster(w.players || [], w.hostId);
    this.onPhase({ phase: w.phase, phaseStart: w.phaseStart, phaseEnd: w.phaseEnd, roundStart: w.roundStart }, true);
    for (const o of w.orbs || []) this.onOrb(o, true);
    for (const b of w.bombs || []) this.onBomb(b, true);
    for (const l of w.lasers || []) this.onLaser({ l });
    const now = this.session.now();
    for (const p of w.players || []) {
      if (p.id === this.you && Number.isFinite(p.x)) this.teleport(p.x, p.z, p.ry);
      const e = this.players.get(p.id);
      if (!e) continue;
      if (p.immune > now) e.immuneUntil = p.immune;
      if (p.fear > now && p.id !== this.you) e.fearUntil = p.fear;
      if (e.track && Number.isFinite(p.x)) e.track.push(w.now ?? now, p.x, p.y || 0, p.z, p.ry || 0, p.a || 0);
    }
    if (w.ranking) this.onResults({ ranking: w.ranking });
  }

  onRoster(m) {
    this.applyRoster(m.players || [], m.hostId);
  }

  applyRoster(list, hostId) {
    if (hostId !== undefined) this.hostId = hostId;
    const seen = new Set();
    for (const p of list) {
      seen.add(p.id);
      let e = this.players.get(p.id);
      if (!e) {
        const isLocal = p.id === this.you;
        const mascot = createMascot({ color: p.color, name: p.name, title: p.bot ? 'Practice Bot' : 'Festival Jumper', isLocal });
        this.scene.add(mascot.root);
        e = { id: p.id, name: p.name, color: p.color, score: 0, bot: !!p.bot, scored: false, mascot, track: isLocal ? null : new RemoteTrack(), immuneUntil: 0, fearUntil: 0 };
        mascot.root.visible = isLocal;
        if (isLocal) mascot.root.position.set(this.local.x, this.local.y, this.local.z);
        this.players.set(p.id, e);
      }
      if (p.name !== e.name) e.mascot.setName(p.name);
      if (p.color !== e.color) e.mascot.setColor(p.color);
      e.name = p.name;
      e.color = p.color;
      e.bot = !!p.bot;
      if (Number.isFinite(p.score)) {
        e.score = p.score;
        if (p.score > 0) e.scored = true;
      }
    }
    for (const [id, e] of this.players) {
      if (!seen.has(id)) {
        e.mascot.root.removeFromParent();
        e.mascot.dispose?.();
        this.players.delete(id);
      }
    }
    this.refreshPanels();
  }

  onPhase(m, initial = false) {
    const prev = this.phase;
    this.phase = m.phase || 'lobby';
    this.phaseStart = m.phaseStart || 0;
    this.phaseEnd = m.phaseEnd || 0;
    this.roundStart = m.roundStart || 0;
    this.hud.setPhase(this.phase);
    const now = this.session.now();
    if (this.phase === 'countdown' && (prev !== 'countdown' || initial)) {
      this.resetRound();
      this.hud.bigText('Get ready…', 'ready', 0);
      this.cdShown = null;
    } else if (this.phase === 'lobby' && prev !== 'lobby') {
      this.resetRound();
      this.hud.hideBig();
    } else if (this.phase === 'playing' && prev !== 'playing') {
      if (!initial && now - this.phaseStart < 1500) {
        this.hud.bigText('Start!', 'go', 1000);
        audio.play('round_start');
      } else this.hud.hideBig();
      this.timeUpShown = now - this.roundStart >= ROUND_MS;
    } else if (this.phase === 'results' && prev !== 'results') {
      this.input.clear();
      this.hud.hideTip();
      if (!initial) audio.play('results');
    }
    this.local.frozen = this.phase === 'countdown';
    audio.setMusic(this.phase === 'countdown' || this.phase === 'playing' ? 'music_round' : 'music_lobby');
    this.refreshPanels();
  }

  resetRound() {
    this.beams.clear();
    this.beamList = [];
    this.claimed.clear();
    for (const id of this.orbs.keys()) this.orbView.remove(id, { taken: false });
    this.orbs.clear();
    this.bombView.dispose();
    this.bombView = new BombView(this.scene);
    this.bombs.clear();
    this.local.fear = null;
    for (const e of this.players.values()) {
      e.score = 0;
      e.scored = false;
      e.immuneUntil = 0;
      e.fearUntil = 0;
    }
    this.ranking = null;
    this.tips.clear();
    this.tipQueue.length = 0;
    this.timeUpShown = false;
    this.localHitFloats = 0;
  }

  onSnap(m) {
    const t = m.s ?? this.session.now();
    for (const row of m.p || []) {
      const id = row[0];
      if (id === this.you) continue;
      const e = this.players.get(id);
      if (!e || !e.track) continue;
      e.track.push(t, row[1], row[2], row[3], row[4], row[5], row[6]); // row[6]: optional per-player sample time
    }
  }

  onSpawn(m) {
    if (m.id === this.you) this.teleport(m.x, m.z, m.ry);
    else this.players.get(m.id)?.track?.reset(m.x, m.z);
  }

  teleport(x, z, ry) {
    this.local.teleport(x, z, Number.isFinite(ry) ? ry : Math.atan2(-x, -z));
    Object.assign(this.renderPos, { x: this.local.x, y: 0, z: this.local.z });
    this.orbit.snapTo(this.local);
    this.sendAcc = 1;
  }

  onLaser(m) {
    const l = m.l;
    if (!l || this.beams.has(l.id)) return;
    this.beams.set(l.id, l);
    l._gone = beamTimes(l).tGone;
    this.beamList = [...this.beams.values()];
  }

  onOrb(o, initial = false) {
    if (this.orbs.has(o.id)) return;
    this.orbs.set(o.id, { ...o, hidden: false, hiddenAt: 0, retryAt: 0 });
    this.orbView.add(o);
    if (o.k === 'pink' && !initial) this.queueTip('pink');
  }

  onOrbGone(m) {
    const o = this.orbs.get(m.id);
    if (!o) return;
    this.orbs.delete(m.id);
    if (!o.hidden) this.orbView.remove(m.id, { taken: !!m.by });
  }

  onBomb(b, initial = false) {
    if (this.bombs.has(b.id)) return;
    this.bombs.set(b.id, { ...b });
    this.bombView.add(b);
    if (!initial) {
      const now = this.session.now();
      if (now - this.lastBombTipAt > 15000) {
        this.lastBombTipAt = now;
        this.queueTip('bombs', true);
      }
    }
  }

  onBoom(m) {
    this.bombView.explode(m.id);
    this.bombs.delete(m.id);
    for (const f of m.feared || []) {
      if (f.id === this.you) {
        this.local.startFear(f.dx, f.dz, f.until);
      } else {
        const e = this.players.get(f.id);
        if (e) e.fearUntil = f.until;
      }
    }
  }

  onScore(m) {
    const e = this.players.get(m.id);
    if (!e) return;
    e.score = m.score;
    if (m.d > 0 || m.score > 0) e.scored = true;
    const d = m.d ?? 0;
    if (d !== 0) {
      let skip = false;
      if (m.id === this.you && m.why === 'laser' && this.localHitFloats > 0) {
        this.localHitFloats--;
        skip = true; // already shown locally the moment we touched the beam
      }
      if (!skip) this.floatOver(e, d > 0 ? `+${d}` : `${d}`, d > 0 ? ORB_COLORS[m.k] || ORB_COLORS.green : PENALTY_COLOR);
    }
    if (m.id !== this.you && m.why === 'laser') e.mascot.flashHit();
    this.refreshScores();
  }

  onImmune(m) {
    const e = this.players.get(m.id);
    if (!e) return;
    e.immuneUntil = m.until;
    if (m.id === this.you) audio.play('immune_on');
  }

  onResults(m) {
    const byId = this.players;
    this.ranking = (m.ranking || []).map((r) => ({ ...r, color: byId.get(r.id)?.color, bot: byId.get(r.id)?.bot }));
    this.refreshPanels();
  }

  // ========================================================================================= frame
  frame(dt) {
    if (this.disposed) return;
    const now = this.session.now();
    this.frameNow = now; // room time this frame was simulated/rendered at (tests)
    const L = this.local;
    const me = this.players.get(this.you);

    // ---- local movement: fixed substeps on the room clock, laser sweep test per substep
    this.pruneBeams(now);
    this.simulate(now, me);

    // ---- balloons
    this.checkPickups(now);

    // ---- upload own state
    // Regular cadence: send when a full period (minus half a frame) has passed since the last send. An accumulator
    // alternates 2- and 3-frame gaps at ~60 fps (33/50 ms), which shows up as jitter on everyone else's screen.
    this.frameDtMs += (dt * 1000 - this.frameDtMs) * 0.1;
    if (this.sendAcc > 0 || now - this.lastSendAt >= 1000 / CLIENT_SEND_HZ - 0.5 * this.frameDtMs) {
      this.sendAcc = 0;
      this.lastSendAt = now;
      const r = FEEL.stateDecimals;
      this.session.send({ t: 'st', x: Math.round(L.x * r) / r, y: Math.round(L.y * r) / r, z: Math.round(L.z * r) / r, ry: Math.round(L.ry * 100) / 100, a: L.anim });
      this.stats.stSent++;
    }

    // ---- mascots
    const rt = now - INTERP_DELAY_MS;
    for (const e of this.players.values()) {
      if (e.id === this.you) continue;
      const tr = e.track;
      if (!tr.has) continue;
      tr.sample(rt, dt);
      const root = e.mascot.root;
      root.visible = true;
      root.position.set(tr.x, tr.y, tr.z);
      root.rotation.y = tr.ry;
      const fearLeft = Math.max(0, e.fearUntil - now);
      e.mascot.update(dt, {
        moving: tr.a === 1 || tr.a === 3 || tr.speed > 0.6,
        speed: tr.speed,
        airborne: tr.a === 2 || tr.y > 0.03,
        vy: tr.vy,
        feared: tr.a === 3 || fearLeft > 0,
        immune: e.immuneUntil > now,
        fearLeftMs: fearLeft,
        moveAngle: tr.moveAngle,
      });
    }
    if (me) {
      const root = me.mascot.root;
      const rp = this.renderPos;
      root.visible = true;
      root.position.set(rp.x, rp.y, rp.z);
      root.rotation.y = L.ry;
      const fearLeft = L.fearLeft(now);
      const immune = me.immuneUntil > now;
      me.mascot.update(dt, {
        moving: L.speed > 0.4,
        speed: L.speed,
        airborne: !L.grounded,
        vy: L.vy,
        feared: fearLeft > 0,
        immune,
        fearLeftMs: fearLeft,
        moveAngle: L.moveAngle,
      });
      if (this.wasImmune && !immune) audio.play('immune_off');
      this.wasImmune = immune;
      this.hud.setImmunity(Math.max(0, me.immuneUntil - now));
      this.hud.setFear(fearLeft);
    }

    // ---- world views
    this.laserView.update(this.beamList, now);
    this.orbView.update(dt, now);
    this.bombView.update(dt, now);

    // ---- camera
    this.orbit.update(dt, this.renderPos, this.input.rotateAxis());

    // ---- HUD clock / phase texts / tips
    this.updatePhaseHud(now);
  }

  pruneBeams(now) {
    let changed = false;
    for (const [id, b] of this.beams) {
      if (b._gone < now - 500) {
        this.beams.delete(id);
        this.claimed.delete(id);
        changed = true;
      }
    }
    if (changed) this.beamList = [...this.beams.values()];
  }

  /** Advance the local player in fixed substeps up to room time `now`; laser sweep test on every substep. */
  simulate(now, me) {
    const L = this.local;
    const hMs = 1000 / MOVE_FEEL.physicsHz;
    const h = hMs / 1000;
    if (this.simT == null || this.simT > now + 100) this.simT = now; // first frame / clock stepped back
    if (now - this.simT > MOVE_FEEL.maxSubsteps * hMs) this.simT = now - MOVE_FEEL.maxSubsteps * hMs; // long stall: skip ahead
    // input sampled once per frame (camera-relative)
    if (this.pendingJump == null) this.pendingJump = this.input.takeJump();
    while (this.input.takeJump() != null); // at most one press per frame
    const mv = this.input.axis();
    const b = this.orbit.basis();
    let wx = b.fx * mv.y + b.rx * mv.x;
    let wz = b.fz * mv.y + b.rz * mv.x;
    const len = Math.hypot(wx, wz);
    if (len > 0) {
      wx /= len;
      wz /= len;
    }
    const wish = { x: wx, z: wz, back: mv.y < 0 };
    const rec = window.__jj?.rec; // test hook: per-substep samples (e2e/feel-measure.mjs)
    const ev = this.stepEv;
    ev.jumped = ev.glideBlocked = ev.landed = false;
    while (this.simT + hMs <= now) {
      const t0 = this.simT;
      const t1 = t0 + hMs;
      L.savePrev();
      L.step(h, t1, wish, this.pendingJump, ev);
      this.pendingJump = null;
      if (this.beamList.length) this.checkLasers(t0, L.prev.x, L.prev.z, t1, me);
      this.simT = t1;
      if (rec) rec.push({ t: t1, x: L.x, y: L.y, z: L.z, vx: L.vx, vz: L.vz, vy: L.vy, ry: L.ry, g: L.grounded, ma: L.moveAngle, bp: L.backpedal, ix: mv.x, iy: mv.y });
    }
    // render interpolation between the last two substeps
    const a = Math.min(1, Math.max(0, (now - this.simT) / hMs));
    const rp = this.renderPos;
    rp.x = L.prev.x + (L.x - L.prev.x) * a;
    rp.y = L.prev.y + (L.y - L.prev.y) * a;
    rp.z = L.prev.z + (L.z - L.prev.z) * a;
    if (ev.jumped) this.stats.jumps++; // jumping and landing are silent (user preference)
    if (ev.glideBlocked) {
      this.stats.glideMsgs++;
      this.hud.sysMessage('Cannot glide in current state.');
      audio.play('ui_error', { minGapMs: 250 });
    }
  }

  checkLasers(prevT, prevX, prevZ, now, me) {
    const L = this.local;
    const immune = me && me.immuneUntil > now;
    for (const b of this.beamList) {
      if (this.claimed.has(b.id)) continue;
      if (!laserHitTest(b, prevT, prevX, prevZ, now, L.x, L.z, L.y)) continue;
      if (immune) continue; // invincible: no claim, no feedback
      this.claimed.add(b.id);
      this.send({ t: 'hit', id: b.id });
      this.stats.hitsSent++;
      // immediate local feedback (the real game: a short orange body flash only); the score itself only changes
      // from 'score' messages. Vignette + floating numbers are opt-in "practice popups".
      me?.mascot.flashHit();
      if (settings.practicePopups) this.hud.hitPulse();
      const expected = me ? Math.max(SCORE_MIN, me.score + LASER_PENALTY) - me.score : LASER_PENALTY;
      if (expected !== 0 && me && settings.practicePopups) {
        this.localHitFloats++;
        this.floatOver(me, `${expected}`, PENALTY_COLOR, true);
      }
    }
  }

  checkPickups(now) {
    const L = this.local;
    const t = performance.now();
    for (const o of this.orbs.values()) {
      if (o.hidden) {
        if (t - o.hiddenAt > FEEL.pickupRestoreMs) {
          // the room never confirmed: show it again (it may have been rejected)
          o.hidden = false;
          o.retryAt = t + 400;
          if (!o.exp || o.exp > now) this.orbView.add(o);
        }
        continue;
      }
      if (t < o.retryAt || (o.exp && o.exp <= now) || (o.at && o.at > now)) continue;
      if (!canTouchOrb(o, L.x, L.z, L.y)) continue; // air balloons need a jump
      o.hidden = true;
      o.hiddenAt = t;
      this.orbView.remove(o.id, { taken: true });
      this.send({ t: 'pickup', id: o.id });
      this.stats.pickupsSent++;
      audio.play(`pickup_${o.k}`, { minGapMs: 40, rate: PICKUP_RATE[o.k] });
    }
  }

  updatePhaseHud(now) {
    const hud = this.hud;
    if (this.phase === 'countdown') {
      const n = Math.ceil((this.phaseEnd - now) / 1000);
      if (n >= 1 && n <= 3 && n !== this.cdShown) {
        this.cdShown = n;
        hud.bigText(String(n), 'count', 950);
        audio.play('countdown_tick');
      }
      hud.setTimer(mmss(ROUND_MS));
    } else if (this.phase === 'playing') {
      const rt = now - this.roundStart;
      hud.setTimer(mmss(ROUND_MS - rt));
      if (!this.timeUpShown && rt >= ROUND_MS) {
        this.timeUpShown = true;
        hud.bigText('Time!', 'time', 1600);
        audio.play('round_end');
      }
      if (rt >= 0 && rt < 6000) this.queueTip('balloons');
      if (rt >= 8000 && rt < 30000) this.queueTip('lasers');
    } else if (this.phase === 'results') {
      hud.setTimer('00:00');
      this.results.setBackIn(this.phaseEnd ? this.phaseEnd - now : 0);
    }
    // NPC tip queue: one at a time, min 3.5 s apart (bomb tips jump the queue)
    if (this.tipQueue.length && now - this.lastTipAt > 3500) {
      const k = this.tipQueue.shift();
      this.lastTipAt = now;
      hud.tip(TIPS[k]);
    }
    if (now - this.netT > 500) {
      this.netT = now;
      hud.setNet({ ping: this.session.ping, players: this.players.size, mode: this.mode });
    }
  }

  queueTip(key, urgent = false) {
    if (this.tips.has(key)) return;
    this.tips.add(key);
    if (urgent) {
      this.tipQueue.unshift(key);
      this.lastTipAt = -1e9;
    } else this.tipQueue.push(key);
  }

  // ======================================================================================= helpers
  floatOver(e, text, color, local = false) {
    if (!settings.practicePopups) return; // real game: no score popups (rank panel + pickup sparkle only)
    const pos = local ? tmpV.set(this.local.x, this.local.y + HEAD_Y, this.local.z) : tmpV.copy(e.mascot.root.position).setY(e.mascot.root.position.y + HEAD_Y);
    this.effects.floatText(pos.clone(), text, color);
  }

  playerList() {
    return [...this.players.values()].map((e) => ({ id: e.id, name: e.name, score: e.score, color: e.color, bot: e.bot, scored: e.scored }));
  }

  refreshScores() {
    const list = this.playerList();
    this.hud.renderRank(list, this.you);
    if (this.scoreboard.visible) this.scoreboard.update(list, this.you);
  }

  refreshPanels() {
    const list = this.playerList();
    const isHost = this.session.isHost ?? this.hostId === this.you;
    this.lobby.show(this.phase === 'lobby');
    this.lobby.update({ code: this.code, mode: this.mode, players: list, hostId: this.hostId, you: this.you, isHost, maxPlayers: MAX_PLAYERS });
    if (this.phase === 'results') {
      const ranking =
        this.ranking ||
        withRanks(list).map((p) => ({ id: p.id, name: p.name, score: p.score, rank: p.rank, color: p.color, bot: p.bot }));
      this.results.update({ ranking, you: this.you, isHost });
    }
    this.results.show(this.phase === 'results');
    this.hud.setNet({ ping: this.session.ping, players: this.players.size, mode: this.mode });
    this.refreshScores();
  }

  async copy(text, msg) {
    const ok = await copyText(text);
    this.hud.toast(ok ? msg : `Copy failed — ${text}`);
  }

  exit(message) {
    if (this.disposed) return;
    this.dispose();
    try {
      this.session.close();
    } catch {
      /* already closed */
    }
    this.onExit?.(message);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const [t, f] of this._subs) this.session.off(t, f);
    document.removeEventListener('visibilitychange', this._vis);
    for (const k of ['Tab', 'Escape', 'KeyM']) {
      this.input.keyHandlers.delete(k);
      this.input.keyUpHandlers.delete(k);
    }
    this.input.enabled = true;
    for (const e of this.players.values()) {
      e.mascot.root.removeFromParent();
      e.mascot.dispose?.();
    }
    this.players.clear();
    this.laserView.dispose();
    this.orbView.dispose();
    this.bombView.dispose();
    this.hud.dispose();
    this.lobby.dispose();
    this.results.dispose();
    this.scoreboard.dispose();
    this.escMenu.dispose();
    if (window.__jj?.game === this) delete window.__jj;
  }
}
