// Bot AI, simulated inside Room at TICK_HZ with the same physics and laser rules as players.
// stepBot() only moves the bot; the room validates its pickups and laser hits like anyone else's.
import {
  BOMB_RADIUS,
  BOT_ACCEL,
  BOT_BOMB_CAUTION,
  BOT_JUMP_FAIL,
  BOT_JUMP_LEAD_S,
  BOT_RETARGET_MS,
  FEAR_SPEED,
  GRAVITY,
  JUMP_VELOCITY,
  LASER_HIT_HALF,
  LASER_SPEED,
  LASER_Y,
  MOVE_SPEED,
  PLAY_LIMIT,
  PLAYER_RADIUS,
} from './config.js';
import { beamState, beamTimes } from './lasers.js';
import { ANIM, PHASE } from './protocol.js';
import { orbInAir } from './pickup.js';

export const BOT_NAMES = [
  'Bot Pip', 'Bot Mumu', 'Bot Kiki', 'Bot Popo', 'Bot Nini', 'Bot Tutu',
  'Bot Lolo', 'Bot Bibi', 'Bot Coco', 'Bot Fifi', 'Bot Rara', 'Bot Zuzu',
];

const HIT_R = LASER_HIT_HALF + PLAYER_RADIUS;
// Seconds after takeoff during which the feet are above a beam (same physics as players).
const CLEAR = (() => {
  const h = LASER_Y + LASER_HIT_HALF;
  const d = Math.sqrt(JUMP_VELOCITY * JUMP_VELOCITY - 2 * GRAVITY * h);
  return [(JUMP_VELOCITY - d) / GRAVITY, (JUMP_VELOCITY + d) / GRAVITY];
})();
// A jump fires on the first tick inside the lead and its first airborne step is simulated in that same tick,
// so the effective lead is up to one tick longer than planned.
const TICK_SLACK_S = 0.05;
const WANDER = PLAY_LIMIT - 1.5;
const ORB_WEIGHT = { green: 1, pink: 1.8, yellow: 1.7 };

export function createBrain(rng) {
  return {
    vx: 0, vz: 0, vy: 0,
    tx: rng.range(-WANDER, WANDER), tz: rng.range(-WANDER, WANDER),
    retargetAt: 0,
    orb: null, // id of the balloon being chased
    restUntil: 0,
    greed: rng.range(0.7, 1.3), // per-bot taste for special balloons
    plans: new Map(), // beamId -> {lead, fail}
    caution: new Map(), // bombId -> bool
  };
}

/**
 * @param {object} p room player record (x,y,z,ry,a,fear*,immuneUntil,brain)
 * @param {{now:number, phase:string, orbs:Map, bombs:Map, beams:object[]}} world
 * @param {number} dt ms
 */
export function stepBot(p, world, dt, rng) {
  const s = dt / 1000;
  const br = p.brain;
  const { now } = world;
  const feared = now < p.fearUntil;

  let dvx = 0;
  let dvz = 0;
  if (feared) {
    dvx = p.fearDx * FEAR_SPEED;
    dvz = p.fearDz * FEAR_SPEED;
  } else if (world.phase === PHASE.PLAYING || world.phase === PHASE.LOBBY) {
    if (now >= br.retargetAt) retarget(p, br, world, rng);
    const dodge = bombDodge(p, br, world, rng);
    const tx = dodge ? dodge.x : br.tx;
    const tz = dodge ? dodge.z : br.tz;
    const dx = tx - p.x;
    const dz = tz - p.z;
    const d = Math.hypot(dx, dz);
    const lobby = world.phase === PHASE.LOBBY;
    if (d < 0.2) {
      if (!dodge) {
        // reached a wander point: pick another (short rests only in the lobby)
        if (lobby) br.restUntil = now + rng.range(500, 2500);
        br.retargetAt = 0;
      }
    } else if (now >= br.restUntil) {
      const speed = (lobby ? 0.6 : 1) * MOVE_SPEED;
      dvx = (dx / d) * speed;
      dvz = (dz / d) * speed;
    }
  }

  // quick acceleration (instant when feared, like the client)
  const ax = dvx - br.vx;
  const az = dvz - br.vz;
  const dv = Math.hypot(ax, az);
  const maxDv = BOT_ACCEL * s;
  const k = feared || dv <= maxDv ? 1 : maxDv / dv;
  br.vx += ax * k;
  br.vz += az * k;

  const nx = p.x + br.vx * s;
  const nz = p.z + br.vz * s;
  p.x = Math.max(-PLAY_LIMIT, Math.min(PLAY_LIMIT, nx));
  p.z = Math.max(-PLAY_LIMIT, Math.min(PLAY_LIMIT, nz));
  if (p.x !== nx) br.vx = 0; // slide along the wall
  if (p.z !== nz) br.vz = 0;

  const grounded = p.y <= 0 && br.vy <= 0;
  const jump = grounded && !feared && ((world.beams.length && wantsJump(p, br, world, rng)) || underAirOrb(p, br, world));
  if (jump) br.vy = JUMP_VELOCITY;
  if (p.y > 0 || br.vy > 0) {
    p.y += br.vy * s - 0.5 * GRAVITY * s * s;
    br.vy -= GRAVITY * s;
    if (p.y <= 0) p.y = br.vy = 0;
  }

  const speed = Math.hypot(br.vx, br.vz);
  if (speed > 0.2) p.ry = Math.atan2(br.vx, br.vz);
  p.a = feared ? ANIM.FEARED : p.y > 0 ? ANIM.AIR : speed > 0.3 ? ANIM.RUN : ANIM.IDLE;

  if (br.plans.size > 24) {
    const live = new Set(world.beams.map((b) => b.id));
    for (const id of br.plans.keys()) if (!live.has(id)) br.plans.delete(id);
  }
}

/** Standing under the targeted air balloon: hop straight up to grab it. */
function underAirOrb(p, br, world) {
  const o = br.orb != null && world.orbs.get(br.orb);
  return !!o && orbInAir(o) && Math.hypot(o.x - p.x, o.z - p.z) < 0.5;
}

/** Nearest balloon (special ones count as closer); wander when there's none. */
function retarget(p, br, world, rng) {
  br.retargetAt = world.now + rng.range(BOT_RETARGET_MS[0], BOT_RETARGET_MS[1]);
  let best = null;
  let bestCost = Infinity;
  for (const o of world.orbs.values()) {
    const d = Math.hypot(o.x - p.x, o.z - p.z);
    if (world.now + (d / MOVE_SPEED) * 1000 > o.exp) continue; // won't make it
    let w = ORB_WEIGHT[o.k] ?? 1;
    if (o.k !== 'green') w *= br.greed;
    if (o.k === 'pink' && world.now < p.immuneUntil) w = 1;
    const cost = d / w;
    if (cost < bestCost) [best, bestCost] = [o, cost];
  }
  br.orb = best ? best.id : null;
  if (best) {
    br.tx = best.x;
    br.tz = best.z;
  } else if (Math.hypot(br.tx - p.x, br.tz - p.z) < 0.3) {
    br.tx = rng.range(-WANDER, WANDER);
    br.tz = rng.range(-WANDER, WANDER);
  }
}

/** Some bots step out of a bomb circle just before it goes off. */
function bombDodge(p, br, world, rng) {
  for (const b of world.bombs.values()) {
    if (b.boomAt - world.now > 900) continue;
    const dx = p.x - b.x;
    const dz = p.z - b.z;
    const d = Math.hypot(dx, dz);
    if (d > BOMB_RADIUS + 0.3) continue;
    if (!br.caution.has(b.id)) br.caution.set(b.id, rng.chance(BOT_BOMB_CAUTION));
    if (!br.caution.get(b.id)) continue;
    const ux = d > 0.01 ? dx / d : 1;
    const uz = d > 0.01 ? dz / d : 0;
    return { x: b.x + ux * (BOMB_RADIUS + 0.8), z: b.z + uz * (BOMB_RADIUS + 0.8) };
  }
  return null;
}

/** True when a moving beam will reach the bot within its (random) reaction lead; ~BOT_JUMP_FAIL misjudged. */
function wantsJump(p, br, world, rng) {
  for (const b of world.beams) {
    const st = beamState(b, world.now);
    if (!st || st.phase === 'end') continue;
    const dir = Math.sign(b.to - b.from);
    const ahead = ((b.ax === 'x' ? p.x : p.z) - st.pos) * dir; // distance in front of the beam
    if (ahead < -HIT_R) continue; // already behind it
    const spd = b.spd ?? LASER_SPEED; // each beam's own speed (slow / fast tiers)
    let tReach;
    let closing = spd;
    if (st.phase === 'hold') {
      tReach = (beamTimes(b).tMove - world.now) / 1000 + Math.max(0, ahead - HIT_R) / spd;
    } else {
      closing = spd - (b.ax === 'x' ? br.vx : br.vz) * dir;
      if (closing <= 0.1) continue;
      tReach = Math.max(0, ahead - HIT_R) / closing;
    }
    let plan = br.plans.get(b.id);
    if (!plan) {
      plan = { lead: rng.range(BOT_JUMP_LEAD_S[0], BOT_JUMP_LEAD_S[1]), fail: rng.chance(BOT_JUMP_FAIL) };
      br.plans.set(b.id, plan);
    }
    // Keep the lead inside this beam's clear window: feet up before contact starts, still up when it ends.
    const latest = CLEAR[1] - (2 * HIT_R) / closing - TICK_SLACK_S;
    const lead = latest > CLEAR[0] ? Math.min(Math.max(plan.lead, CLEAR[0]), latest) : plan.lead;
    if (!plan.fail && tReach <= lead) return true;
  }
  return false;
}
