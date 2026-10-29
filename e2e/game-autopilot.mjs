// In-page autopilot for GAME e2e tests. Drives the real input paths (KeyboardEvents on window):
//  - jump: plans the takeoff from the LIVE config (window.__jj.cfg: JUMP_VELOCITY, GRAVITY, LASER_Y, LASER_HIT_HALF,
//    PLAYER_RADIUS, PLAY_LIMIT) by simulating candidate takeoff delays against every beam with the horizontal velocity
//    locked at takeoff (AIR_CONTROL 0); presses Space at the middle of the first feasible window.
//  - charge: when a beam approaches, run straight INTO it (shortens the contact time; needed if standing jumps can't clear)
//  - chase: hold WASD (camera-relative) toward the nearest balloon; goto: walk to a point
// Runtime config: window.__auto = { jump, charge, chase, goto, kinds, log, jumped:Set, unjumpable:Set }
export async function installAutopilot(page, opts = {}) {
  await page.evaluate((o) => {
    if (window.__auto) {
      Object.assign(window.__auto, o);
      return;
    }
    const auto = (window.__auto = { jump: false, charge: false, chase: false, log: [], jumped: new Set(), unjumpable: new Set(), ...o });
    const key = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, key: code === 'Space' ? ' ' : code, bubbles: true }));
    let held = new Set();
    function setKeys(want) {
      for (const c of held) if (!want.has(c)) key('keyup', c);
      for (const c of want) if (!held.has(c)) key('keydown', c);
      held = want;
    }
    function keysToward(g, dx, dz, want) {
      const d = Math.hypot(dx, dz);
      if (d < 1e-6) return;
      const b = g.orbit.basis();
      const f = (dx * b.fx + dz * b.fz) / d;
      const r = (dx * b.rx + dz * b.rz) / d;
      if (f > 0.38) want.add('KeyW');
      if (f < -0.38) want.add('KeyS');
      if (r > 0.38) want.add('KeyD');
      if (r < -0.38) want.add('KeyA');
    }
    function plan(g, jj, now) {
      const C = jj.cfg;
      const L = g.local;
      const R = C.LASER_HIT_HALF + C.PLAYER_RADIUS;
      const clear = C.LASER_Y + C.LASER_HIT_HALF;
      const v0 = C.JUMP_VELOCITY;
      const G = C.GRAVITY;
      const disc = v0 * v0 - 2 * G * clear;
      if (disc <= 0) return null; // the jump can never clear a beam
      const s1 = ((v0 - Math.sqrt(disc)) / G) * 1000; // feet above clearance from s1..s2 ms after takeoff
      const s2 = ((v0 + Math.sqrt(disc)) / G) * 1000;
      const lim = C.PLAY_LIMIT;
      const coordAt = (b, ms) => {
        const c = b.ax === 'x' ? L.x + (L.vx * ms) / 1000 : L.z + (L.vz * ms) / 1000;
        return Math.max(-lim, Math.min(lim, c));
      };
      // ground-path contact intervals [tA, tB] (ms from now) for every beam
      const contacts = [];
      for (const b of g.beamList) {
        let tA = null;
        let tB = null;
        for (let ms = 0; ms <= 1200; ms += 4) {
          const st = jj.beamState(b, now + ms);
          const inside = st && Math.abs(coordAt(b, ms) - st.pos) < R;
          if (inside && tA == null) tA = ms;
          if (!inside && tA != null) {
            tB = ms;
            break;
          }
        }
        if (tA != null) contacts.push({ b, tA, tB: tB ?? 1200 });
      }
      contacts.sort((x, y) => x.tA - y.tA);
      const threat = contacts.find((c) => !auto.jumped.has(c.b.id) && !auto.unjumpable.has(c.b.id));
      if (!threat) return null;
      const lo = threat.tB - s2; // earliest takeoff that is still airborne-high when the beam leaves
      const hi = threat.tA - s1; // latest takeoff that is already high when the beam arrives
      if (lo > hi || hi < 0) {
        if (threat.tA <= 40) {
          auto.unjumpable.add(threat.b.id);
          auto.log.push({ beam: threat.b.id, at: now, unjumpable: true, v: +Math.hypot(L.vx, L.vz).toFixed(2), lo, hi });
        }
        return null;
      }
      const best = (lo + hi) / 2; // absolute midpoint (lo may already be in the past)
      if (best > 8) return null; // not yet (re-evaluated every frame)
      // every beam whose ground contact fits inside this jump's high window is cleared by it
      const covered = contacts.filter((c) => c.tA >= s1 && c.tB <= s2).map((c) => c.b.id);
      if (!covered.includes(threat.b.id)) covered.push(threat.b.id);
      return { covered, window: [Math.round(lo), Math.round(hi)], v: Math.hypot(L.vx, L.vz) };
    }
    function tick() {
      requestAnimationFrame(tick);
      const jj = window.__jj;
      const g = jj && jj.game;
      if (!g || g.disposed) return;
      const now = g.session.now();
      const L = g.local;
      if (auto.jump && L.grounded && !L.fear && g.beamList.length) {
        const p = plan(g, jj, now);
        if (p) {
          for (const id of p.covered) auto.jumped.add(id);
          auto.log.push({ beams: p.covered, at: now, window: p.window, v: +p.v.toFixed(2) });
          key('keydown', 'Space');
          setTimeout(() => key('keyup', 'Space'), 40);
        }
      }
      const want = new Set();
      let charging = false;
      if (auto.charge && !L.fear) {
        // run into the nearest approaching beam (perpendicular to it)
        let best = null;
        for (const b of g.beamList) {
          const s0 = jj.beamState(b, now);
          const s1 = jj.beamState(b, now + 100);
          if (!s0 || !s1 || s0.phase !== 'move') continue;
          const c = b.ax === 'x' ? L.x : L.z;
          const dist = c - s0.pos;
          const closing = Math.sign(dist) === Math.sign(s1.pos - s0.pos);
          if (closing && Math.abs(dist) < 3.2 && (!best || Math.abs(dist) < Math.abs(best.dist))) best = { b, dist };
        }
        if (best) {
          charging = true;
          const dir = -Math.sign(best.dist);
          keysToward(g, best.b.ax === 'x' ? dir : 0, best.b.ax === 'z' ? dir : 0, want);
        }
      }
      if (!charging && auto.chase && !L.fear) {
        let best = null;
        let bd = 1e9;
        for (const orb of g.orbs.values()) {
          if (orb.hidden) continue;
          if (auto.kinds && !auto.kinds.includes(orb.k)) continue;
          const d = Math.hypot(orb.x - L.x, orb.z - L.z);
          if (d < bd) {
            bd = d;
            best = orb;
          }
        }
        if (best && bd > 0.2) keysToward(g, best.x - L.x, best.z - L.z, want);
      } else if (!charging && auto.goto && !L.fear) {
        const dx = auto.goto.x - L.x;
        const dz = auto.goto.z - L.z;
        if (Math.hypot(dx, dz) > 0.3) keysToward(g, dx, dz, want);
      }
      // mid-air input is ignored by the game (AIR_CONTROL 0) — keep holding whatever we decided
      setKeys(want);
    }
    requestAnimationFrame(tick);
  }, opts);
}

export const setAuto = (page, o) => page.evaluate((v) => Object.assign(window.__auto, v), o);

/** Analytic jump slack from the live config, per laser tier: feet-above-clearance time minus beam contact time (ms).
 *  Contact = 2*(LASER_HIT_HALF+PLAYER_RADIUS) / closing speed (standing: beam speed; running into it: beam + run speed). */
export const standingSlack = (page) =>
  page.evaluate(() => {
    const C = window.__jj.cfg;
    const clear = C.LASER_Y + C.LASER_HIT_HALF;
    const v0 = C.JUMP_VELOCITY;
    const G = C.GRAVITY;
    const disc = v0 * v0 - 2 * G * clear;
    const above = disc > 0 ? (2 * Math.sqrt(disc)) / G : 0;
    const R2 = 2 * (C.LASER_HIT_HALF + C.PLAYER_RADIUS);
    const tiers = { fast: C.LASER_SPEED, slow: C.LASER_SPEED_SLOW ?? C.LASER_SPEED };
    const out = { aboveMs: above * 1000, clear, tiers: {} };
    for (const [k, spd] of Object.entries(tiers)) {
      out.tiers[k] = { spd, contactMs: (R2 / spd) * 1000, slackMs: (above - R2 / spd) * 1000, runSlackMs: (above - R2 / (spd + C.MOVE_SPEED)) * 1000 };
    }
    out.slackMs = Math.min(...Object.values(out.tiers).map((t) => t.slackMs));
    return out;
  });
