// Single import point for the World API (SPEC "World API"), implemented by WORLD in client/src/world/**.
export { createRenderer } from '../world/renderer.js';
export { createArena } from '../world/arena.js';
// Players use ANIM's clip-animated mascot (same Mascot API as world/mascot.js).
export { createRiggedMascot as createMascot, loadMascotAssets } from '../anim/riggedMascot.js';
export { LaserView } from '../world/lasers.js';
export { OrbView } from '../world/orbs.js';
export { BombView } from '../world/bombs.js';
export { Effects } from '../world/effects.js';
