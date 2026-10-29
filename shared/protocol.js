// Message type constants + JSDoc shapes. Mirrors SPEC.md "Protocol". All messages are JSON objects with `t` = type.
export { PROTOCOL_VERSION } from './config.js';

/** Client -> Room */
export const C2R = Object.freeze({
  HELLO: 'hello', // {name, v}            first message on a P2P link (server mode uses CREATE/JOIN instead)
  PING: 'ping', // {c}                    -> pong {c, s}
  ST: 'st', // {x, y, z, ry, a}           own state at CLIENT_SEND_HZ
  PICKUP: 'pickup', // {id}               balloon claim
  HIT: 'hit', // {id}                     laser hit claim on myself
  START: 'start', // {}                   host only, from lobby/results
  NAME: 'name', // {name}                 rename (lobby/results only)
  BOT: 'bot', // {add: bool}              host only
  // Server-mode lobby handshake (handled by server/index.js, never reaches the Room)
  CREATE: 'create', // {name, v}
  JOIN: 'join', // {code, name, v}
});

/** Room -> Client */
export const R2C = Object.freeze({
  WELCOME: 'welcome',
  PONG: 'pong',
  ROSTER: 'roster',
  PHASE: 'phase',
  SNAP: 'snap',
  SPAWN: 'spawn',
  LASER: 'laser',
  ORB: 'orb',
  ORB_GONE: 'orbGone',
  BOMB: 'bomb',
  BOOM: 'boom',
  SCORE: 'score',
  IMMUNE: 'immune',
  RESULTS: 'results',
  ERR: 'err',
  CLOSED: 'closed',
});

export const PHASE = Object.freeze({
  LOBBY: 'lobby',
  COUNTDOWN: 'countdown',
  PLAYING: 'playing',
  RESULTS: 'results',
});

/** `a` field of `st` / snapshot rows */
export const ANIM = Object.freeze({ IDLE: 0, RUN: 1, AIR: 2, FEARED: 3 });

export const ORB_KINDS = Object.freeze(['green', 'pink', 'yellow']);

/**
 * @typedef {{id:string, name:string, color:string, score:number, bot:boolean}} RosterEntry
 * @typedef {RosterEntry & {x:number, y:number, z:number, ry:number, a:number, immune:number, fear:number}} PlayerState
 *   immune / fear = room-ms "until" (0 = none)
 * @typedef {{id:number, k:'green'|'pink'|'yellow', x:number, z:number, at:number, exp:number, bomb?:number}} Orb
 * @typedef {{id:number, x:number, z:number, at:number, boomAt:number}} Bomb
 * @typedef {{id:number, ax:'x'|'z', from:number, to:number, t0:number, hold?:number, spd?:number, endHold?:number}} Beam
 *   see shared/lasers.js
 *
 * @typedef {{t:'welcome', you:string, code:string, hostId:string, phase:string, phaseStart:number, phaseEnd:number,
 *   roundStart:number, players:PlayerState[], orbs:Orb[], bombs:Bomb[], lasers:Beam[], now:number, v:number,
 *   ranking?:Ranking[]}} WelcomeMsg
 *   phaseEnd = 0 while in lobby (no end). roundStart = start of the current/next round (0 before the first one).
 *   `ranking` is present when joining during `results`.
 * @typedef {{t:'pong', c:number, s:number}} PongMsg
 * @typedef {{t:'roster', players:RosterEntry[], hostId:string}} RosterMsg
 * @typedef {{t:'phase', phase:string, phaseStart:number, phaseEnd:number, roundStart:number}} PhaseMsg
 * @typedef {{t:'snap', s:number, p:Array<[string, number, number, number, number, number]>}} SnapMsg
 *   rows: [id, x, y, z, ry, a], 2-decimal rounding
 * @typedef {{t:'spawn', id:string, x:number, z:number, ry:number}} SpawnMsg   sent only to that player
 * @typedef {{t:'laser', l:Beam}} LaserMsg
 * @typedef {{t:'orb'} & Orb} OrbMsg
 * @typedef {{t:'orbGone', id:number, by?:string, pts?:number}} OrbGoneMsg
 * @typedef {{t:'bomb'} & Bomb} BombMsg
 * @typedef {{t:'boom', id:number, x:number, z:number, feared:Array<{id:string, dx:number, dz:number, until:number}>}} BoomMsg
 * @typedef {{t:'score', id:string, score:number, d:number, why:'orb'|'laser', k?:string}} ScoreMsg
 * @typedef {{t:'immune', id:string, until:number}} ImmuneMsg
 * @typedef {{id:string, name:string, score:number, rank:number}} Ranking
 * @typedef {{t:'results', ranking:Ranking[]}} ResultsMsg
 * @typedef {{t:'err', msg:string}} ErrMsg
 * @typedef {{t:'closed', msg:string}} ClosedMsg
 */
