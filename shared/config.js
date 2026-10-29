// Single source of truth for gameplay tuning. Units: meters, ms, points.
// Values come from research/MECHANICS.md + research/FEEL.md (frame-by-frame); [L] = low-confidence estimate.
// Scale: 14 m arena, 1.05 m character; all hitbox/speed/jump numbers are in arena units from the footage.
// research/CRITIC.md independently re-verified airtime, apex, run speed and laser timing.

export const PROTOCOL_VERSION = 1;

// Networking
export const MAX_PLAYERS = 12;
export const TICK_HZ = 20; // room simulation tick
export const SNAP_HZ = 30; // position snapshots to clients
export const CLIENT_SEND_HZ = 30; // own state upload rate
export const INTERP_DELAY_MS = 75; // remote player render delay (CRITIC: 117 ms felt late)
export const ROOM_CODE_LEN = 5;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const LASER_LEAD_MS = 2500; // room announces each beam this long before it appears

// Phases
export const COUNTDOWN_MS = 5000;
export const ROUND_MS = 165000; // timer 02:45 -> 00:00
export const OVERTIME_MS = 1500; // play continues briefly after 00:00, then results
export const RESULTS_MS = 30000; // results screen, then back to lobby (host can restart earlier)

// Arena
export const ARENA_HALF = 7; // 14m x 14m square [M/L]
export const BORDER_WIDTH = 0.3;
export const WALKWAY_WIDTH = 2.5;
export const PLAYER_RADIUS = 0.45; // + LASER_HIT_HALF = 0.51 m laser hit half-width (FEEL rev2) [L/M]
export const PLAYER_HEIGHT = 1.05; // arena = 13.3-14.3 body heights on screen (CRITIC, same-method vs clone) [M]
export const PLAY_LIMIT = ARENA_HALF - PLAYER_RADIUS; // |x|,|z| clamp

// Movement
export const MOVE_SPEED = 3.2; // m/s = 0.229 arena widths/s = 0.73x fast / 1.10x slow laser (FEEL rev2, CRITIC) [M/H]
export const BACKPEDAL = false; // S turns and runs toward the camera at full speed, no backpedal (FEEL rev2) [M]
export const BACKPEDAL_RATIO = 1.0;
export const MOVE_ACCEL_MS = 65; // full speed in ~4 frames; D<->A reversal ~130 ms (CRITIC: 100-170 ms real) [L/M]
export const MOVE_DECEL_MS = 25; // stopped within <=2 frames (FEEL rev2) [M]
export const FACE_TURN_DEG_PER_S = 800; // 180 deg in ~0.23 s (CRITIC), 90 deg in ~7 frames [L]
export const AIR_CONTROL = 0; // horizontal velocity locked at takeoff, straight paths in the air (FEEL rev2) [M]
export const LANDING_LAG_MS = 0; // new input / jump works on the touchdown frame (FEEL rev2) [M]
export const JUMP_HEIGHT = 1.56; // feet apex = 1.23 character heights (FEEL rev2, n=11) [M]
export const JUMP_AIRTIME = 0.891; // takeoff -> touchdown, 53.4 frames @60fps (FEEL rev2, n=11, +/-6 ms) [H]
export const GRAVITY = (8 * JUMP_HEIGHT) / (JUMP_AIRTIME * JUMP_AIRTIME); // ~15.7 m/s^2
export const JUMP_VELOCITY = (GRAVITY * JUMP_AIRTIME) / 2; // ~7.0 m/s

// Lasers (beams always axis-aligned and spanning the whole arena)
export const LASER_Y = 0.32; // beam center height (FEEL) [L]
export const LASER_HIT_HALF = 0.06; // beam half-thickness for hit tests -> feet must be above 0.38 m (FEEL clearance) [L]
export const LASER_SPEED = 4.4; // m/s FAST tier: 14 m pass in ~3.2 s (CRITIC 3.0-3.25 s) [H]
export const LASER_SPEED_SLOW = 2.9; // m/s SLOW tier: pass in ~4.8 s; tutorial + first ~40 s, and some later patterns (CRITIC) [H]
export const LASER_SPAWN_HOLD_MS = 750; // sits at the start edge (the only telegraph)
export const LASER_END_HOLD_MS = 1000; // sits at the far edge, then vanishes
export const LASER_MAX_BEAMS = 4;
export const LASER_PENALTY = -20; // per beam pass that touches you (max one hit per beam per player)
export const HIT_TIME_TOLERANCE_MS = 400;
export const SCORE_MIN = 0;

// Balloons ("orbs" in code)
export const ORB_POINTS = { green: 50, pink: 60, yellow: 70 };
export const ORB_Y = 0.8; // ground balloons: center at head height, touch them by walking in
export const ORB_Y_AIR = 2.0; // air balloons: bottom at 1.61 m, only reachable by jumping (feet above ~0.56 m)
export const GREEN_AIR_CHANCE = 0.35; // greens are sometimes up in the air; pinks always are; yellows never
export const ORB_DIAMETER = 0.78; // ~3/4 of the character's height
export const PICKUP_RADIUS = 0.83; // horizontal center distance (FEEL estimate) [L]
export const PICKUP_TOLERANCE = 1.5; // extra slack the room allows for latency
export const GREEN_OPENING = { atMs: 1000, count: 3, spread: 2.5 };
export const GREEN_SPAWN_MS = 7000; // +/- GREEN_SPAWN_JITTER_MS (halved spawn rate, user feedback)
export const GREEN_SPAWN_JITTER_MS = 2000;
export const GREEN_MAX_ALIVE = 2;
export const GREEN_LIFETIME_MS = 10000; // [L]
export const PINK_WAVES = [
  { atMs: 20000, count: 1 },
  { atMs: 72000, count: 2 },
  { atMs: 124000, count: 1 },
]; // halved from the video's 2/3/2 (user feedback)
export const PINK_LIFETIME_MS = 8000; // [L]
export const IMMUNITY_MS = 8000; // pink: immune to laser damage (not to fear)

// Bombs
export const BOMB_WAVES = [
  { atMs: 63000, count: 2 },
  { atMs: 112000, count: 3 },
];
export const BOMB_STAGGER_MS = 400;
export const BOMB_FUSE_MS = 3300;
export const BOMB_PILLAR_MS = 1000; // magenta pillar during the last second of the fuse
export const BOMB_RADIUS = 3.3; // (CRITIC)
export const FEAR_MS = 2300;
export const FEAR_SPEED = MOVE_SPEED;
export const FEAR_WANDER_DEG = 30; // random offset from the "away from bomb" direction
export const YELLOW_PER_BOMB = 3; // spawned WITH the bomb, inside its circle (bait)
export const YELLOW_RING_RADIUS = 1.5;
export const YELLOW_LIFETIME_AFTER_BOOM_MS = 3000;

// Laser timeline (round-relative ms). Generator in shared/schedule.js fills these windows with patterns.
export const LASER_FIRST_AT_MS = 10000; // single tutorial line
export const LASER_STOP_BEFORE_END_MS = 4500;

// ---- NET additions (appended by the NET agent) ----
// Laser timeline windows (round-relative ms) filled by shared/schedule.js after the tutorial line.
// Speed tiers (CRITIC P0-1): 'slow' = LASER_SPEED_SLOW, 'fast' = LASER_SPEED. `speed` = tier weights, drawn per pattern.
// 'chain': patterns back-to-back (next starts as the previous beams reach the far side). All speeds in a chain are
//          scaled by one factor within LASER_CHAIN_SPEED_RANGE to fit the window. anchor 'start' keeps the start time
//          and may overrun `to` a little (the next window waits); anchor 'end' finishes exactly at `to`.
// 'gaps':  a pause between patterns that shrinks linearly from gapMs[0] to gapMs[1] (+/- LASER_GAP_JITTER_MS);
//          with probability `chain` the next pattern is chained instead (no pause), as in the video's mid-round runs.
// `mix` = pattern weights (line: 1 beam, lines: 2 opposite, cross: x+z, square: 4 edges -> # -> out).
// Real timeline: tutorial 10.3 s (slow), chain 21.7-37.4 s (slow), slow ~38-46 s, fast two-line ~48.9 s (CRITIC 1:05
// track), break, 74-146 s mixed, final non-stop chain to 4.5 s before the end.
export const LASER_TUTORIAL_TIER = 'slow';
export const LASER_SEGMENTS = [
  { kind: 'chain', from: 21700, to: 37400, anchor: 'start', speed: { slow: 1 }, mix: { cross: 2, square: 2, lines: 1 } },
  { kind: 'gaps', from: 38000, to: 47000, gapMs: [1500, 1500], speed: { slow: 1 }, mix: { line: 1, lines: 2, cross: 2, square: 1 } },
  { kind: 'gaps', from: 48800, to: 55000, gapMs: [1200, 1200], speed: { fast: 1 }, mix: { line: 1, lines: 3, cross: 2 } },
  { kind: 'gaps', from: 74000, to: 144000, gapMs: [4000, 2000], chain: 0.25, speed: { slow: 0.3, fast: 0.7 }, mix: { line: 1, lines: 2, cross: 2, square: 2 } },
  { kind: 'chain', from: 146000, to: ROUND_MS - LASER_STOP_BEFORE_END_MS, anchor: 'end', speed: { slow: 0.15, fast: 0.85 }, mix: { square: 3, cross: 2, lines: 1 } },
];
export const LASER_GAP_JITTER_MS = 500;
export const LASER_SEGMENT_GAP_MS = 1100; // min pause between a chain that overran and the next segment (CRITIC)
export const LASER_TUTORIAL_END_HOLD_MS = 200; // tutorial beam: no start hold, short end hold (CRITIC)
export const LASER_GAP_MAX_STRETCH_MS = 1200; // unused window time is spread over the gaps, at most this much per gap
export const LASER_CHAIN_SPEED_RANGE = [0.93, 1.07]; // chain speed-fit factor around each tier (tiers stay near-constant)
export const LASER_ANNOUNCE_MARGIN_MS = 150; // announce a little early so ticks never make the lead < LASER_LEAD_MS

export const NAME_MAX_LEN = 16;
export const SPAWN_RING_RADIUS = 3.5; // players start on a ring around the center at countdown
export const ORB_SPAWN_LIMIT = PLAY_LIMIT - 0.5; // balloons spawn inside |x|,|z| <= this
export const ORB_MIN_SPACING = 1.2; // between balloons at spawn
export const PINK_MIN_SPACING = 3.5;
export const BOMB_CENTER_LIMIT = 3.5; // bombs land within |x|,|z| <= this (central area)
export const BOMB_AIM_JITTER = 1.0; // first bomb of a wave: player centroid +/- this
export const BOMB_SPACING = [2.5, 3.5]; // later bombs of a wave: this far from an earlier one (~one radius, CRITIC)
export const MAX_ST_Y = 3; // st.y clamp (feet height)

// Bots
export const BOT_JUMP_LEAD_S = [0.2, 0.42]; // the real standing-jump window is ~0.2-0.45 s before the beam arrives // jump when a beam will reach them within this many seconds
export const BOT_JUMP_FAIL = 0.2; // chance to misjudge a beam
export const BOT_ACCEL = 28; // m/s^2, quick but not instant direction changes
export const BOT_RETARGET_MS = [350, 800];
export const BOT_BOMB_CAUTION = 0.5; // chance to step out of a bomb circle just before the boom
