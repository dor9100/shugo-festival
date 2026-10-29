// Local player controller (client-authoritative): camera-relative movement with backpedal, jump with takeoff-locked
// air velocity, fear forced-run, arena clamp. Advanced in fixed substeps (MOVE_FEEL.physicsHz) on the room clock so
// airtime / hit timing are frame-rate independent. Every feel number comes from MOVE_FEEL (tuning.js <- shared/config.js).
//
// Movement model (research/FEEL.md §2):
//  - only if BACKPEDAL (off by default, the real game has none): input with a backward component = move at
//    MOVE_SPEED*BACKPEDAL_RATIO while the body faces the opposite of the movement direction;
//  - otherwise run at MOVE_SPEED facing the movement direction; facing turns at FACE_TURN_DEG_PER_S toward the INPUT
//    direction (snappy, independent of the velocity ramp);
//  - velocity moves toward the target vector at MOVE_SPEED/MOVE_ACCEL_MS per ms (speeding up / changing direction) or
//    MOVE_SPEED/MOVE_DECEL_MS per ms (stopping) -> a full reversal takes 2*MOVE_ACCEL_MS;
//  - AIR_CONTROL 0: the horizontal velocity at takeoff is kept for the whole jump (input and facing ignored mid-air);
//    0..1: the air target is blended takeoffVelocity*(1-a) + inputTarget*a and facing turns at a*FACE_TURN rate.
import { FEAR_SPEED, GRAVITY, JUMP_VELOCITY, PLAY_LIMIT } from '@shared/config.js';
import { MOVE_FEEL as F } from './tuning.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const wrap = (a) => a - TAU * Math.floor((a + Math.PI) / TAU);

export const ANIM = { idle: 0, run: 1, air: 2, feared: 3 };

/** Rate (m/s per s) for a velocity ramp over `ms` of a full MOVE_SPEED change; 0 ms = instant. */
const rateFor = (ms) => (ms > 0 ? F.speed / (ms / 1000) : Infinity);

export class LocalPlayer {
  constructor() {
    this.x = 0;
    this.y = 0; // feet height (0 = floor)
    this.z = 0;
    this.vx = 0;
    this.vz = 0;
    this.vy = 0;
    this.ry = 0;
    this.grounded = true;
    this.takeoffVx = 0; // horizontal velocity locked at takeoff (AIR_CONTROL)
    this.takeoffVz = 0;
    this.backpedal = false; // current input is a backpedal
    this.fear = null; // {dx, dz, until} room ms
    this.frozen = false; // countdown: no horizontal movement
    this.lagUntil = 0; // landing lag end (room ms)
    this.bufferedJumpAt = null; // performance.now() of a Space press waiting for touchdown
    this.prev = { x: 0, y: 0, z: 0 }; // state before the last substep (render interpolation)
  }

  teleport(x, z, ry) {
    this.x = clamp(x, -PLAY_LIMIT, PLAY_LIMIT);
    this.z = clamp(z, -PLAY_LIMIT, PLAY_LIMIT);
    this.y = 0;
    this.vx = this.vz = this.vy = 0;
    this.grounded = true;
    this.bufferedJumpAt = null;
    if (ry != null && Number.isFinite(ry)) this.ry = ry;
    this.savePrev();
  }

  savePrev() {
    this.prev.x = this.x;
    this.prev.y = this.y;
    this.prev.z = this.z;
  }

  startFear(dx, dz, until) {
    const len = Math.hypot(dx, dz) || 1;
    this.fear = { dx: dx / len, dz: dz / len, until };
  }

  fearLeft(t) {
    return this.fear ? Math.max(0, this.fear.until - t) : 0;
  }

  get speed() {
    return Math.hypot(this.vx, this.vz);
  }

  /** Movement direction relative to body facing (radians, 0 = forward, ±π = backpedal, +π/2 = toward the mascot's left). */
  get moveAngle() {
    return this.speed > 0.15 ? wrap(Math.atan2(this.vx, this.vz) - this.ry) : 0;
  }

  get anim() {
    if (this.fear) return ANIM.feared;
    if (!this.grounded) return ANIM.air;
    return this.speed > 0.4 ? ANIM.run : ANIM.idle;
  }

  _jump(out) {
    this.vy = JUMP_VELOCITY;
    this.grounded = false;
    this.bufferedJumpAt = null;
    this.takeoffVx = this.vx;
    this.takeoffVz = this.vz;
    out.jumped = true;
  }

  _turnToward(goal, h, scale = 1) {
    if (!Number.isFinite(F.turnDegPerS)) {
      this.ry = goal;
      return;
    }
    const maxTurn = F.turnDegPerS * DEG * h * scale;
    this.ry = wrap(this.ry + clamp(wrap(goal - this.ry), -maxTurn, maxTurn));
  }

  /**
   * One fixed substep.
   * @param h        step seconds
   * @param t        room time (ms) at the END of this step
   * @param input    {x, z, back} world-space unit input direction (0,0 = none); back = input has a backward component
   * @param jumpPress performance.now() timestamp of a fresh Space press, or null
   * @param out      event accumulator {jumped, glideBlocked, landed}
   */
  step(h, t, input, jumpPress, out) {
    if (this.fear && t >= this.fear.until) this.fear = null;
    const feared = !!this.fear;
    const lagging = t < this.lagUntil;
    let faceGoal = null;
    let faceScale = 1;

    if (feared) {
      // forced run (no input, no inertia); slide along the arena edge instead of sticking to it
      let tx = this.fear.dx * FEAR_SPEED;
      let tz = this.fear.dz * FEAR_SPEED;
      const bx = (this.x >= PLAY_LIMIT - 1e-3 && tx > 0) || (this.x <= -PLAY_LIMIT + 1e-3 && tx < 0);
      const bz = (this.z >= PLAY_LIMIT - 1e-3 && tz > 0) || (this.z <= -PLAY_LIMIT + 1e-3 && tz < 0);
      if (bx && !bz) {
        tx = 0;
        tz = (this.fear.dz >= 0 ? 1 : -1) * FEAR_SPEED;
      } else if (bz && !bx) {
        tz = 0;
        tx = (this.fear.dx >= 0 ? 1 : -1) * FEAR_SPEED;
      }
      this.vx = tx;
      this.vz = tz;
      this.backpedal = false;
      faceGoal = Math.atan2(tx, tz);
    } else {
      // ---- target velocity from input
      let gx = 0;
      let gz = 0;
      const active = !this.frozen && !lagging && (input.x || input.z);
      if (active) {
        this.backpedal = F.backpedal && !!input.back;
        const spd = this.backpedal ? F.speed * F.backpedalRatio : F.speed;
        gx = input.x * spd;
        gz = input.z * spd;
        faceGoal = this.backpedal ? Math.atan2(-input.x, -input.z) : Math.atan2(input.x, input.z);
      } else if (this.grounded) {
        this.backpedal = false;
      }
      if (!this.grounded) {
        // AIR_CONTROL: blend between the takeoff velocity (kept) and the input target
        const a = clamp(F.airControl, 0, 1);
        gx = this.takeoffVx * (1 - a) + gx * a;
        gz = this.takeoffVz * (1 - a) + gz * a;
        if (a <= 0) faceGoal = null;
        else faceScale = a;
      }
      // ---- ramp velocity toward the target vector (accel when speeding up / turning, decel when stopping)
      const wants = gx !== 0 || gz !== 0;
      const rate = wants ? rateFor(F.accelMs) : rateFor(F.decelMs);
      const dx = gx - this.vx;
      const dz = gz - this.vz;
      const d = Math.hypot(dx, dz);
      const maxDv = rate * h;
      if (d <= maxDv) {
        this.vx = gx;
        this.vz = gz;
      } else if (maxDv > 0) {
        this.vx += (dx / d) * maxDv;
        this.vz += (dz / d) * maxDv;
      }
    }

    // ---- jump (after the velocity update, so the takeoff velocity includes this step's input)
    let press = jumpPress;
    if (press == null && this.grounded && this.bufferedJumpAt != null && t >= this.lagUntil) {
      if (performance.now() - this.bufferedJumpAt < F.jumpBufferMs + F.landingLagMs + 50) press = this.bufferedJumpAt;
      this.bufferedJumpAt = null;
    }
    if (press != null && !feared) {
      if (this.grounded) {
        if (lagging) this.bufferedJumpAt = press;
        else this._jump(out);
      } else if (this.vy < 0 && this.y < F.jumpBufferMaxFeet) {
        this.bufferedJumpAt = press; // forgiving: fires on touchdown, no glide message
      } else {
        out.glideBlocked = true;
      }
    }

    // ---- integrate (exact for constant gravity)
    this.x = clamp(this.x + this.vx * h, -PLAY_LIMIT, PLAY_LIMIT);
    this.z = clamp(this.z + this.vz * h, -PLAY_LIMIT, PLAY_LIMIT);
    if (!feared) {
      if (Math.abs(this.x) >= PLAY_LIMIT && Math.sign(this.vx) === Math.sign(this.x)) this.vx = this.takeoffVx = 0;
      if (Math.abs(this.z) >= PLAY_LIMIT && Math.sign(this.vz) === Math.sign(this.z)) this.vz = this.takeoffVz = 0;
    }
    if (!this.grounded) {
      this.y += this.vy * h - 0.5 * GRAVITY * h * h;
      this.vy -= GRAVITY * h;
      if (this.y <= 0) {
        this.y = 0;
        this.vy = 0;
        this.grounded = true;
        out.landed = true;
        if (F.landingLagMs > 0) this.lagUntil = t + F.landingLagMs;
      }
    }

    // ---- facing
    if (faceGoal != null) this._turnToward(faceGoal, h, faceScale);
  }
}
