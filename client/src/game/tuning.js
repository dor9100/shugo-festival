// ALL movement-feel parameters live here, read from shared/config.js (FEEL agent tunes them there) with defaults
// when absent. Spread into a plain object so missing exports are just `undefined` (no bundler warnings).
import * as ConfigNS from '@shared/config.js';

const C = { ...ConfigNS };
const DEG = Math.PI / 180;

export const MOVE_FEEL = {
  speed: C.MOVE_SPEED, // m/s
  backpedal: C.BACKPEDAL ?? true, // false: S just turns and runs toward the camera like any other direction
  backpedalRatio: C.BACKPEDAL_RATIO ?? 0.55, // input with a backward component: this fraction of speed, facing away
  accelMs: C.MOVE_ACCEL_MS ?? 0, // 0 -> MOVE_SPEED (and direction changes) at MOVE_SPEED/MOVE_ACCEL_MS per ms; 0 = instant
  decelMs: C.MOVE_DECEL_MS ?? 0, // MOVE_SPEED -> 0 at MOVE_SPEED/MOVE_DECEL_MS per ms; 0 = instant stop
  turnDegPerS: C.FACE_TURN_DEG_PER_S ?? Infinity, // Infinity => facing snaps to the goal direction
  airControl: C.AIR_CONTROL ?? 1, // 0 = takeoff velocity + facing locked for the whole jump; 0..1 blends toward input
  landingLagMs: C.LANDING_LAG_MS ?? 0, // no input / jump for this long after touching down
  jumpBufferMs: C.JUMP_BUFFER_MS ?? 100, // Space pressed just before landing still jumps (no glide message)
  jumpBufferMaxFeet: 0.2, // ...only when falling with feet this close to the floor
  physicsHz: C.CLIENT_PHYSICS_HZ ?? 120, // fixed-timestep substeps => exact airtime at any frame rate
  maxSubsteps: 24, // per frame (200 ms at 120 Hz); beyond that the sim clock skips ahead
};

// Non-movement client feel (smoothing / UI). Gameplay rules stay in shared/config.js.
export const FEEL = {
  pickupRestoreMs: 1000, // optimistic balloon hide is undone if the room doesn't confirm
  extrapolateMaxMs: 200, // remote players: max extrapolation past the newest snapshot
  stateDecimals: 100, // 'st' rounding (cm)
};

// Camera per research/FEEL.md §7 + research/CRITIC.md P2-6: pitch ~33 deg, slant ~15-16 m, vertical FOV ~56 deg, RIGID
// follow in x/y/z (the camera rises with the jump, so the character stays put on screen and the floor drops).
export const CAM = {
  fov: 56, // vertical degrees (applied to WORLD's PerspectiveCamera by OrbitCamera)
  pitchMin: 10 * DEG,
  pitchMax: 85 * DEG,
  pitchDefault: 33 * DEG,
  distMin: 4,
  distMax: 24,
  distDefault: 15, // CRITIC: slant 15.5-16 m to the arena centre
  yawDefault: 0, // camera sits on the -z side looking toward +z
  dragRadPerPx: 0.0055,
  wheelZoom: 0.0012,
  qeSpeed: 1.9, // rad/s
  followLerp: Infinity, // 1/s; Infinity = rigid follow (no lag), as measured
  followJump: 1, // fraction of the feet height the camera follows (1 = full jump height, FEEL)
  zoomLerp: 12,
  targetHeight: (C.PLAYER_HEIGHT ?? 1) * 0.63, // orbit pivot ~ chest/neck of the mascot (0.66 m for 1.05 m)
  centerBias: 0, // >0 pulls the focus toward the arena centre (fades out when zoomed in); 0 = focus on the mascot
};

export const UI_TIMING = {
  npcTipMs: 6500,
  systemMsgMs: 2200,
  bigTextMs: 1100,
  toastMs: 1400,
};
