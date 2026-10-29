// Rigged, clip-animated mascot: a drop-in for WORLD's createMascot (SPEC "World API" -> mascot.js), using real
// animation clips (client/public/models/mascot-anims.glb, built by tools/anim/build-clips.mjs) on a chibi-proportioned
// UE-Manny-layout skeleton, with an original procedural body (body.js) shared by every mascot.
//
//   await loadMascotAssets()                       // once (cached); createRiggedMascot also works before it resolves
//   const m = createRiggedMascot({ color, name, title, isLocal })
//   m.root (Group, origin at feet, faces +Z at rotation.y = 0), m.label (CSS2DObject nameplate)
//   m.update(dt, { moving, speed, airborne, vy, feared, immune, fearLeftMs, moveAngle?, hit? })
//   m.setName(n), m.setTitle(t), m.setColor(hex), m.flashHit(), m.emote('cheer'|'jazz'|'victory'|'clap'|'wave'|'idle_hips'|null), m.dispose()
//   const s = createSpectator({ color }); s.update(dt, { excitement? }); s.cheer(seconds)
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { JUMP_AIRTIME, JUMP_VELOCITY, MOVE_SPEED, PLAYER_HEIGHT } from '@shared/config.js';
import { loadRigAssets, makeBones, PROPS } from './rig.js';
import { buildBody } from './body.js';
import { createNameplate } from './nameplate.js';
import { pointScaleHook } from '../world/mascot.js';
import { sparkleTexture } from '../world/textures.js';

// Planted-foot ground speed of each synced loop on the full-size rig at rate 1, measured on the ball (toe) bones during
// contact (tools/anim/stride.mjs). Playback rate = speed / (this x leg scale x body scale) keeps the planted foot still.
const CLIP_SPEED = { run: 4.95, run_back: 5.3, strafe_l: 4.95, strafe_r: 4.95, fear: 4.95 };
const SYNCED = ['run', 'run_back', 'strafe_l', 'strafe_r', 'fear'];
export const EMOTES = ['cheer', 'jazz', 'victory', 'clap', 'wave', 'idle_hips'];

export const TUNING = {
  fade: 0.1, // s, state cross-fades
  rateMin: 0.75,
  // Locomotion playback-rate cap. Feet are exactly planted up to rateMax x natural speed (~1.5 m/s for the 1.05 m
  // mascot), i.e. up to ~6 m/s; MOVE_SPEED 3.2 m/s plays at ~2.15x (6.5 steps/s).
  rateMax: 4.2,
  stride: 1, // multiplier on the measured clip ground speeds (fine-tune for foot plant)
  landRate: 1.4,
  spectatorHz: 20, // spectator animation update rate
  hitFlash: 0.1, // s, orange body flash on a laser hit (real game: a 3-7 frame burst)
  hitSparks: 0.3, // s, orange spark burst lifetime
  runLean: 0.42, // rad of extra forward lean (spine) at MOVE_SPEED
  hitFlinch: 0, // weight of the additive Hit_F flinch (0 = off, as in the real game; per mascot: createRiggedMascot({ hitFlinch }))
};

let SHARED = null;
let loading = null;

/** Load (once) the clip library + build the shared body geometry. Resolves to the shared asset bundle. */
export function loadMascotAssets(url) {
  if (SHARED) return Promise.resolve(SHARED);
  if (!loading) {
    loading = loadRigAssets(url).then(({ tpl, clips }) => {
      const { geometry, height } = buildBody(tpl, 1);
      const low = buildBody(tpl, 0.6).geometry; // spectator LOD (same skin / proportions, coarser tessellation)
      SHARED = { tpl, clips, geometry, geometryLow: low, scale: PLAYER_HEIGHT / height, designHeight: height };
      return SHARED;
    });
  }
  return loading;
}
export const mascotAssetsReady = () => !!SHARED;

// ---------------------------------------------------------------- material (per mascot; one shared program)
function makeMaterial(color) {
  // Always `transparent` (opacity 1, depth write on): immunity only changes uniforms (opacity, emissive), never the
  // shader program, so becoming immune mid-round can't trigger a recompile hitch (CRITIC round 2, P1).
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, envMapIntensity: 0.75, transparent: true, depthWrite: true });
  material.name = 'RiggedMascot';
  // uFill: a little warm self-light so the fur never goes grey in shade (soft toon look)
  const u = { uRobe: { value: new THREE.Color(color) }, uRim: { value: new THREE.Color(0.3, 0.28, 0.26) }, uFill: { value: new THREE.Color(0.11, 0.095, 0.08) }, uHit: { value: 0 } };
  material.onBeforeCompile = (sh) => {
    sh.uniforms.uRobe = u.uRobe;
    sh.uniforms.uRim = u.uRim;
    sh.uniforms.uFill = u.uFill;
    sh.uniforms.uHit = u.uHit;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aTint;\nvarying float vTint;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTint = aTint;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRobe;\nuniform vec3 uRim;\nuniform vec3 uFill;\nuniform float uHit;\nvarying float vTint;')
      // uHit: the laser-hit burst pushes the albedo to orange (emissive alone washes out to white on the cream fur)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(vec3(1.0), uRobe, vTint);\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85, 0.16, 0.025), uHit);')
      .replace(
        '#include <opaque_fragment>',
        `{ float fr = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
           outgoingLight += uRim * pow(fr, 3.0) + diffuseColor.rgb * uFill; }
         #include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => 'anim-rigged-mascot-3';
  return { material, u };
}

// ---------------------------------------------------------------- shared immunity sparkle aura
let AURA = null;
function auraShared() {
  if (AURA) return AURA;
  const n = 18;
  const seed = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    seed[i * 4] = Math.random() * Math.PI * 2;
    seed[i * 4 + 1] = Math.random();
    seed[i * 4 + 2] = 0.24 + Math.random() * 0.2;
    seed[i * 4 + 3] = 0.5 + Math.random() * 0.8;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 4));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.6, 0), 1);
  const mat = new THREE.ShaderMaterial({
    name: 'RiggedMascotAura',
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uScale: { value: 500 }, uMap: { value: sparkleTexture() } },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      uniform float uTime, uScale;
      varying float vA;
      void main() {
        float h = fract(aSeed.y + uTime * 0.35 * aSeed.w);
        float ang = aSeed.x + uTime * aSeed.w * 1.4;
        vec3 p = vec3(cos(ang) * aSeed.z, 0.05 + h * 1.05, sin(ang) * aSeed.z);
        vA = sin(h * 3.14159) * (0.6 + 0.4 * sin(uTime * 9.0 + aSeed.x * 7.0));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (0.07 + 0.05 * aSeed.w) * uScale / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      varying float vA;
      void main() {
        vec4 t = texture2D(uMap, gl_PointCoord);
        gl_FragColor = vec4(vec3(1.6, 1.35, 0.8) * t.rgb * t.a * vA, 1.0);
      }`,
  });
  AURA = { geo, mat };
  return AURA;
}

/** A small pointed festival hat with a brim and a pompom, placed (in head-bone space) on top of the head. */
function makeHat(color, tpl, castShadow) {
  const J = tpl.J;
  const parts = [new THREE.ConeGeometry(0.07, 0.17, 16).translate(0, 0.085, 0), new THREE.CylinderGeometry(0.095, 0.1, 0.018, 20), new THREE.SphereGeometry(0.026, 10, 8).translate(0, 0.175, 0)];
  const geo = mergeGeometries(parts.map((g) => g.toNonIndexed()));
  parts.forEach((g) => g.dispose());
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));
  mesh.castShadow = castShadow;
  // rest pose: on the crown between the ears, tilted a little back and to the side
  const world = new THREE.Matrix4().compose(
    new THREE.Vector3(0, J.headC.y + 0.165, J.headC.z - 0.015),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.2, 0, 0.14)),
    new THREE.Vector3(1, 1, 1),
  );
  const local = new THREE.Matrix4().copy(tpl.W.head).invert().multiply(world);
  local.decompose(mesh.position, mesh.quaternion, mesh.scale);
  return mesh;
}

// Self warm-up: the first mascots that render carry the aura and spark sprites (their ORIGINAL shared materials,
// never disposed, so the compiled programs stay cached for the whole session) drawn 1000 m below the world. Those
// programs and the sparkle texture are therefore ready before the first pink balloon / laser hit.
let WARM_RENDERS = 0;
function makeWarmers() {
  return [auraShared(), burstShared()].map(({ geo, mat }) => {
    const pts = new THREE.Points(geo, mat);
    pts.position.y = -1000; // off screen for any gameplay camera
    pts.frustumCulled = false;
    pts.onBeforeRender = () => WARM_RENDERS++;
    return pts;
  });
}
function dropWarmers(I) {
  for (const w of I.warmers) w.removeFromParent(); // materials are the shared originals: keep them (and their programs)
  I.warmers = null;
}

const IMMUNE_GLOW = new THREE.Color(1.0, 0.82, 0.45);
const HIT_GLOW = new THREE.Color(1.0, 0.45, 0.15);

// ---------------------------------------------------------------- shared hit spark burst (one Points per mascot, made on first hit)
let BURST = null;
function burstShared() {
  if (BURST) return BURST;
  const n = 16;
  const seed = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    // mostly sideways/up directions around the chest
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
    const up = 0.15 + Math.random() * 0.85;
    const h = Math.sqrt(1 - up * up * 0.6);
    seed[i * 4] = Math.cos(a) * h;
    seed[i * 4 + 1] = up;
    seed[i * 4 + 2] = Math.sin(a) * h;
    seed[i * 4 + 3] = 0.6 + Math.random() * 0.8; // speed / size
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 4));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1.2);
  const mat = new THREE.ShaderMaterial({
    name: 'RiggedMascotHitSparks',
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uAge: { value: 99 }, uLife: { value: 0.3 }, uScale: { value: 500 }, uMap: { value: sparkleTexture() } },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      uniform float uAge, uLife, uScale;
      varying float vA;
      void main() {
        float k = clamp(uAge / uLife, 0.0, 1.0);
        float d = (1.0 - (1.0 - k) * (1.0 - k)) * 0.42 * aSeed.w; // fast out, easing
        vec3 p = aSeed.xyz * d - vec3(0.0, 0.35 * k * k, 0.0);
        vA = (1.0 - k) * (1.0 - k);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (0.08 + 0.07 * aSeed.w) * (1.0 - 0.5 * k) * uScale / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      varying float vA;
      void main() {
        vec4 t = texture2D(uMap, gl_PointCoord);
        gl_FragColor = vec4(vec3(2.2, 0.62, 0.1) * t.rgb * t.a * vA, 1.0);
      }`,
  });
  BURST = { geo, mat };
  return BURST;
}
const EMPTY = {};
const _qr = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _axW = new THREE.Vector3();
const _axL = new THREE.Vector3();
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

/**
 * @param {{color?: string|number, name?: string, title?: string, isLocal?: boolean, npc?: boolean, scale?: number,
 *          nameplate?: boolean, spectator?: boolean, castShadow?: boolean, hat?: string|number|null, hitFlinch?: number}} opts
 *   hitFlinch: weight (0..1) of the optional additive flinch clip on hits (default TUNING.hitFlinch = 0: flash + sparks only)
 *   hat: colour of a little festival hat (WORLD's NPC option), on the head bone between the ears
 */
export function createRiggedMascot({ color = '#b0413e', name = '', title = '', isLocal = false, npc = false, scale = 1, nameplate = true, spectator = false, castShadow = true, hat = null, hitFlinch = TUNING.hitFlinch } = {}) {
  const root = new THREE.Group();
  root.name = spectator ? 'riggedSpectator' : 'riggedMascot';
  const plate = nameplate ? createNameplate({ name, title, isLocal, npc, height: 1.1 * scale * PLAYER_HEIGHT }) : null;
  if (plate) root.add(plate.label);
  const robe = new THREE.Color(color);
  let disposed = false;

  // ---------------------------------------------------------------- state
  const st = {
    t: Math.random() * 100,
    fMove: 0,
    fAir: 0,
    fFear: 0,
    fEmote: 0,
    imm: 0,
    flash: 0,
    land: 0,
    landT: 0,
    landing: false,
    landHold: 0,
    wasAir: false,
    airT: 0,
    phase: Math.random(),
    dir: { run: 1, run_back: 0, strafe_l: 0, strafe_r: 0 },
    hitT: 99,
    sparkAge: 99,
    lean: 0,
    stream: 0,
    hitPrev: false,
    emote: null,
    emoteW: {},
    wag: Math.random() * 10,
    twitchT: 1 + Math.random() * 3,
    twitchK: 0,
    twitchL: true,
    acc: 0,
    // spectator brain
    specT: Math.random() * 3,
    cheerUntil: 0,
  };

  let I = null; // body instance (built when assets are ready)

  function attach(S) {
    if (disposed || I) return;
    const { top, bones, byName } = makeBones(S.tpl);
    const skeleton = new THREE.Skeleton(bones, S.tpl.boneInverses);
    const { material, u } = makeMaterial(robe);
    const mesh = new THREE.SkinnedMesh(spectator ? S.geometryLow : S.geometry, material);
    mesh.name = 'mascotBody';
    mesh.castShadow = castShadow;
    mesh.receiveShadow = false;
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.5, 0), 0.9); // design units (fixed: cheap culling)
    const scaler = new THREE.Group();
    scaler.name = 'mascotScaler';
    scaler.scale.setScalar(S.scale * scale);
    scaler.add(top, mesh);
    root.add(scaler);
    top.updateMatrixWorld(true);
    mesh.bind(skeleton, new THREE.Matrix4());
    let hatMesh = null;
    if (hat) {
      hatMesh = makeHat(hat, S.tpl, castShadow);
      byName.head.add(hatMesh);
    }

    const mixer = new THREE.AnimationMixer(top);
    const A = {};
    for (const [nm, clip] of Object.entries(S.clips)) {
      if (nm === 'hit' || nm === 'hit_b') continue; // full-body hits unused: the additive versions are layered instead
      const a = mixer.clipAction(clip);
      a.setEffectiveWeight(0);
      a.play();
      A[nm] = a;
    }
    for (const nm of [...SYNCED, 'jump_air']) A[nm].timeScale = 0; // time set by hand (phase / vy scrub)
    for (const nm of ['jump_land', 'hit_add', 'hit_b_add']) {
      A[nm].setLoop(THREE.LoopOnce, 1);
      A[nm].clampWhenFinished = true;
    }
    // desync crowds
    A.idle.time = Math.random() * A.idle.getClip().duration;
    for (const nm of EMOTES) A[nm].time = Math.random() * A[nm].getClip().duration;

    const aura = auraShared();
    const auraPts = new THREE.Points(aura.geo, aura.mat);
    auraPts.visible = false;
    auraPts.frustumCulled = false;
    auraPts.onBeforeRender = pointScaleHook(aura.mat.uniforms.uScale);
    auraPts.scale.setScalar(scale * PLAYER_HEIGHT);
    root.add(auraPts);

    const warmers = WARM_RENDERS < 6 ? makeWarmers() : null;
    if (warmers) root.add(...warmers);
    const restQ = (nm) => S.tpl.restQ[bones.indexOf(byName[nm])].clone();
    I = {
      S,
      root,
      warmers,
      leanOn: false,
      leanBones: [
        [byName.spine_01, 0.35, new THREE.Quaternion()],
        [byName.spine_03, 0.35, new THREE.Quaternion()],
        [byName.spine_05, 0.3, new THREE.Quaternion()],
        [byName.head, -0.35, new THREE.Quaternion()],
      ],
      hatMesh,
      top,
      byName,
      skeleton,
      mesh,
      material,
      u,
      mixer,
      A,
      auraPts,
      ear: { l: byName.ear_l, r: byName.ear_r, ql: restQ('ear_l'), qr: restQ('ear_r') },
      tail: [byName.tail_1, byName.tail_2, byName.tail_3].map((b) => ({ b, q: S.tpl.restQ[bones.indexOf(b)].clone() })),
    };
  }
  if (SHARED) attach(SHARED);
  else loadMascotAssets().then(attach, (err) => console.error('[anim] mascot assets failed to load', err));

  // ---------------------------------------------------------------- per-frame
  function setW(name, w) {
    I.A[name].setEffectiveWeight(w);
  }

  function spectatorBrain(dt, excitement) {
    st.specT -= dt;
    const now = st.t;
    if (st.cheerUntil > now) {
      if (!st.emote || st.emote === 'idle_hips' || st.emote === 'wave') st.emote = Math.random() < 0.5 ? 'cheer' : 'clap';
      return;
    }
    if (st.specT > 0) return;
    if (st.emote && Math.random() < 0.75) {
      st.emote = null;
      st.specT = 2 + Math.random() * 4 * (1.2 - excitement);
      return;
    }
    const pool = [
      ['cheer', 2 + 3 * excitement],
      ['clap', 2.5 + 2 * excitement],
      ['jazz', 1 + excitement],
      ['wave', 1.2],
      ['idle_hips', 2.2 * (1 - excitement) + 0.3],
      ['victory', 0.6 + excitement],
    ];
    let r = Math.random() * pool.reduce((a, p) => a + p[1], 0);
    for (const [nm, w] of pool) {
      r -= w;
      if (r <= 0) {
        st.emote = nm;
        break;
      }
    }
    st.specT = 2 + Math.random() * 3.5;
  }

  function update(dt, s = EMPTY) {
    dt = clamp(dt || 0, 0, 0.1);
    const fearLeft = s.fearLeftMs > 0 ? Math.max(1, Math.round(s.fearLeftMs / 1000)) : 0; // 2.3 s fear reads 2 -> 1 like the real badge
    plate?.setFear(fearLeft);
    if (!I) return;
    if (I.warmers && WARM_RENDERS >= 6) dropWarmers(I);
    if (spectator) {
      // spectators: low-rate animation (they stand still, the clips are slow)
      st.acc += dt;
      if (st.acc < 1 / TUNING.spectatorHz) return;
      dt = Math.min(st.acc, 0.15);
      st.acc = 0;
      spectatorBrain(dt, clamp(s.excitement ?? 0.4, 0, 1));
    }
    const { A } = I;
    st.t += dt;
    const k = (r) => 1 - Math.exp(-r * dt);
    const kf = k(1 / TUNING.fade);

    const moving = !!s.moving;
    const speed = s.speed ?? (moving ? MOVE_SPEED : 0);
    const airborne = !!s.airborne;
    const feared = !!s.feared;

    // --- hit (edge of s.hit, or flashHit())
    if (s.hit && !st.hitPrev) triggerHit();
    st.hitPrev = !!s.hit;

    // --- air / land
    if (airborne && !st.wasAir) st.airT = 0;
    if (!airborne && st.wasAir) {
      st.landing = true;
      st.landT = 0;
      A.jump_land.reset();
      A.jump_land.timeScale = TUNING.landRate;
      st.landHold = moving ? 0.07 : A.jump_land.getClip().duration / TUNING.landRate - 0.18;
    }
    st.wasAir = airborne;
    if (airborne) st.airT += dt;
    st.fAir += ((airborne ? 1 : 0) - st.fAir) * k(airborne ? 26 : 30);
    if (st.landing) {
      st.landT += dt;
      if (moving) st.landHold = Math.min(st.landHold, 0.07);
      const want = st.landT < st.landHold ? 1 : 0;
      st.land += (want - st.land) * k(want ? 40 : 9);
      if (!want && st.land < 0.01) {
        st.landing = false;
        st.land = 0;
      }
    }
    if (airborne) {
      const ph = typeof s.vy === 'number' ? (JUMP_VELOCITY - s.vy) / (2 * JUMP_VELOCITY) : st.airT / JUMP_AIRTIME;
      A.jump_air.time = clamp(ph, 0, 1) * A.jump_air.getClip().duration;
    }

    // --- locomotion: directional blend (weights cos^2 / sin^2 of moveAngle), all loops synced on one phase
    st.fMove += ((moving ? 1 : 0) - st.fMove) * kf;
    st.fFear += ((feared ? 1 : 0) - st.fFear) * k(8);
    const a = typeof s.moveAngle === 'number' && moving ? s.moveAngle : 0;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    const tgt = { run: c > 0 ? c * c : 0, run_back: c < 0 ? c * c : 0, strafe_l: sn > 0 ? sn * sn : 0, strafe_r: sn < 0 ? sn * sn : 0 };
    let dsum = 0;
    for (const nm in st.dir) {
      st.dir[nm] += (tgt[nm] - st.dir[nm]) * k(12);
      dsum += st.dir[nm];
    }
    let nat = 0;
    for (const nm in st.dir) nat += (st.dir[nm] / dsum) * CLIP_SPEED[nm];
    nat = nat * (1 - st.fFear) + CLIP_SPEED.fear * st.fFear;
    nat *= PROPS.legs * I.S.scale * scale * TUNING.stride; // m/s of this mascot's feet at rate 1
    const effSpeed = feared ? Math.max(speed, MOVE_SPEED * 0.8) : speed;
    const rate = clamp(effSpeed / nat, TUNING.rateMin, TUNING.rateMax);
    if (moving || feared) st.phase = (st.phase + (dt * rate) / A.run.getClip().duration) % 1;
    for (const nm of SYNCED) A[nm].time = st.phase * A[nm].getClip().duration;

    // --- emote slot (players: m.emote(); spectators: brain)
    for (const nm of EMOTES) {
      const want = st.emote === nm ? 1 : 0;
      st.emoteW[nm] = (st.emoteW[nm] ?? 0) + (want - (st.emoteW[nm] ?? 0)) * k(spectator ? 4 : 7);
    }
    st.fEmote += ((st.emote ? 1 : 0) - st.fEmote) * k(spectator ? 4 : 7);

    // --- weights (always sum to 1 -> no rest-pose bleed)
    const air = st.fAir;
    const land = st.land * (1 - air);
    const ground = Math.max(0, 1 - air - land);
    const fear = ground * st.fFear;
    const rest = ground - fear;
    const loco = rest * st.fMove;
    let idle = rest - loco;
    const emote = idle * st.fEmote;
    idle -= emote;
    setW('jump_air', air);
    setW('jump_land', land);
    setW('fear', fear);
    for (const nm in st.dir) setW(nm, (loco * st.dir[nm]) / dsum);
    let esum = 0;
    for (const nm of EMOTES) esum += st.emoteW[nm];
    for (const nm of EMOTES) setW(nm, esum > 1e-4 ? (emote * st.emoteW[nm]) / esum : 0);
    setW('idle', idle + (esum > 1e-4 ? 0 : emote));

    // --- additive flinch
    st.hitT += dt;
    const hw = st.hitT < 0.45 ? 1 : Math.max(0, 1 - (st.hitT - 0.45) / 0.3);
    setW('hit_add', hw * hitFlinch);

    if (I.leanOn) {
      for (const [b, , saved] of I.leanBones) b.quaternion.copy(saved);
      I.leanOn = false;
    }
    I.mixer.update(dt);
    secondary(dt, { moving, airborne, vy: s.vy ?? 0, feared, speed });
    effects(dt, s);
  }

  // ---------------------------------------------------------------- ears & tail (procedural, after the clips)
  function secondary(dt, { airborne, vy, speed }) {
    const t = st.t;
    const run = st.fMove * (1 - st.fAir);
    // forward lean when running, scaled by speed: applied to the spine only (legs and pelvis stay as the clip has them,
    // so the planted feet don't move); backpedalling leans back a little; the head counters part of it
    let dsum = 0;
    for (const nm in st.dir) dsum += st.dir[nm];
    const fwd = (st.dir.run - 0.4 * st.dir.run_back) / (dsum || 1);
    const want = TUNING.runLean * run * (1 - 0.5 * st.fFear) * clamp((speed || 0) / MOVE_SPEED, 0, 1.25) * fwd;
    st.lean += (want - st.lean) * (1 - Math.exp(-10 * dt));
    if (Math.abs(st.lean) > 1e-3) {
      I.root.getWorldQuaternion(_qr);
      _axW.set(1, 0, 0).applyQuaternion(_qr); // the character's left->right axis: + angle pitches the top forward
      I.leanOn = true;
      for (const [b, k, saved] of I.leanBones) {
        saved.copy(b.quaternion); // the clip pose (restored before the next mixer update: the mixer only writes changed values)
        b.matrixWorld.decompose(_p, _qb, _s);
        _axL.copy(_axW).applyQuaternion(_qb.invert());
        b.quaternion.multiply(_q.setFromAxisAngle(_axL, st.lean * k));
      }
    }
    const fear = st.fFear;
    const air = st.fAir;
    const vyN = airborne ? clamp(vy / JUMP_VELOCITY, -1, 1) : 0;
    st.twitchT -= dt;
    if (st.twitchT <= 0) {
      st.twitchT = 1.5 + Math.random() * 3.5;
      st.twitchK = 1;
      st.twitchL = Math.random() < 0.5;
    }
    st.twitchK = Math.max(0, st.twitchK - dt / 0.3);
    const tw = Math.sin(st.twitchK * Math.PI * 3) * 0.3 * st.twitchK;
    const pitch = -0.42 * run * (1 - fear) - 0.5 * vyN * air - 0.85 * fear + Math.sin(t * 1.6) * 0.03 + Math.sin(st.phase * Math.PI * 4) * 0.08 * run;
    const splay = 0.08 + 0.25 * air + 0.3 * fear;
    const shake = Math.sin(t * 31) * 0.12 * fear;
    const E = I.ear;
    E.l.quaternion.copy(E.ql).multiply(_q.setFromEuler(_e.set(pitch + shake, 0, -splay - (st.twitchL ? tw : 0))));
    E.r.quaternion.copy(E.qr).multiply(_q.setFromEuler(_e.set(pitch - shake, 0, splay + (st.twitchL ? 0 : tw))));
    // tail: wag (faster when running / panicking), streams back when running, bounces in the air
    st.wag += dt * Math.PI * 2 * (0.5 + 1.3 * run + 2.4 * fear);
    const amp = 0.18 + 0.2 * run + 0.3 * fear;
    // running: the tail un-curls and streams out flat behind (each joint pitched back; more with speed)
    const stream = run * clamp((speed || 0) / MOVE_SPEED, 0, 1.2) * (1 - 0.4 * fear);
    st.stream += (stream - st.stream) * (1 - Math.exp(-8 * dt));
    const lift = 0.3 * vyN * air + Math.sin(t * 1.3) * 0.04;
    const STREAM = [-0.55, -0.7, -0.75];
    I.tail.forEach(({ b, q }, i) => {
      const lag = i * 0.9;
      const bob = Math.sin(st.phase * Math.PI * 4 - i * 0.8) * 0.06 * st.stream; // flutters with the stride
      b.quaternion.copy(q).multiply(_q.setFromEuler(_e.set(lift * (i === 0 ? 1 : 0.6) + STREAM[i] * st.stream + bob, Math.sin(st.wag - lag) * amp * (1 + i * 0.25) * (1 - 0.5 * st.stream), 0)));
    });
  }

  // ---------------------------------------------------------------- material: immune glow + hit flash
  function effects(dt, s) {
    const { material, u, auraPts } = I;
    st.imm += ((s.immune ? 1 : 0) - st.imm) * (1 - Math.exp(-8 * dt));
    st.flash = Math.max(0, st.flash - dt / TUNING.hitFlash);
    st.sparkAge += dt;
    if (I.sparks) {
      I.sparks.visible = st.sparkAge < TUNING.hitSparks;
      I.sparks.material.uniforms.uAge.value = st.sparkAge;
      I.sparks.material.uniforms.uLife.value = TUNING.hitSparks;
    }
    const imm = st.imm;
    material.opacity = 1 - imm * 0.28;
    const pulse = 0.55 + 0.18 * Math.sin(st.t * 7);
    const fl = Math.sqrt(st.flash) * 0.32; // holds bright, then drops (3-7 frames)
    u.uHit.value = Math.sqrt(st.flash) * 0.9;
    material.emissive.setRGB(
      IMMUNE_GLOW.r * imm * pulse + HIT_GLOW.r * fl,
      IMMUNE_GLOW.g * imm * pulse + HIT_GLOW.g * fl,
      IMMUNE_GLOW.b * imm * pulse + HIT_GLOW.b * fl,
    );
    u.uRim.value.setRGB(0.3 + imm * 0.7, 0.28 + imm * 0.55, 0.26 + imm * 0.2);
    auraPts.visible = imm > 0.05;
    if (auraPts.visible) AURA.mat.uniforms.uTime.value = performance.now() / 1000;
  }

  function triggerHit() {
    st.flash = 1;
    st.sparkAge = 0;
    if (!I) return;
    if (!I.sparks) {
      // lazily: one small additive Points burst at chest height (own material instance -> own uAge)
      const B = burstShared();
      const mat = B.mat.clone();
      mat.uniforms.uMap.value = B.mat.uniforms.uMap.value;
      const pts = new THREE.Points(B.geo, mat);
      pts.frustumCulled = false;
      pts.position.y = 0.48 * PLAYER_HEIGHT * scale;
      pts.scale.setScalar(scale * PLAYER_HEIGHT);
      pts.onBeforeRender = pointScaleHook(mat.uniforms.uScale);
      pts.visible = false;
      root.add(pts);
      I.sparks = pts;
    }
    if (hitFlinch > 0) {
      st.hitT = 0;
      const a = I.A.hit_add;
      a.reset();
      a.play();
    }
  }

  const api = {
    root,
    label: plate ? plate.label : null,
    update,
    get ready() {
      return !!I;
    },
    get mesh() {
      return I ? I.mesh : null;
    },
    get mixer() {
      return I ? I.mixer : null;
    },
    setName(n) {
      plate?.setName(n);
    },
    setTitle(t) {
      plate?.setTitle(t);
    },
    setColor(c) {
      robe.set(c ?? '#b0413e');
      if (I) I.u.uRobe.value.copy(robe);
    },
    flashHit() {
      triggerHit();
    },
    /** Play an emote while standing (results / lobby): 'cheer'|'jazz'|'victory'|'clap'|'wave'|'idle_hips', or null. */
    emote(nm) {
      st.emote = nm && EMOTES.includes(nm) ? nm : null;
    },
    /** Spectators: cheer/clap for `seconds` (e.g. after a bomb, at results). */
    cheer(seconds = 3) {
      st.cheerUntil = st.t + seconds;
      st.specT = 0;
    },
    dispose() {
      disposed = true;
      root.removeFromParent();
      plate?.dispose();
      if (I) {
        I.mixer.stopAllAction();
        I.mixer.uncacheRoot(I.top);
        I.material.dispose();
        if (I.sparks) I.sparks.material.dispose();
        if (I.warmers) dropWarmers(I);
        if (I.hatMesh) {
          I.hatMesh.geometry.dispose();
          I.hatMesh.material.dispose();
        }
        I.skeleton.dispose();
        I = null;
      }
    },
  };
  return api;
}

/**
 * Pre-compile every shader the mascots can need mid-round (body, immune aura, hit sparks) so the first pink balloon /
 * laser hit never hitches. Renders a hidden immune + hit dummy far below the world (y = -80) via compileAsync, keeps it
 * for a few real frames (first-draw driver work), then removes it. Call once after the renderer + scene exist
 * (loads the mascot assets if needed); resolves when done. The caller's render loop must be running for `frames`.
 */
export async function warmMascotShaders(renderer, scene, camera, frames = 3) {
  await loadMascotAssets();
  const d = createRiggedMascot({ color: '#ffffff', nameplate: false });
  d.root.position.set(0, -80, 0);
  for (let i = 0; i < 3; i++) d.update(0.1, { immune: true, moving: true, speed: MOVE_SPEED });
  d.flashHit();
  d.update(0.016, { immune: true, moving: true, speed: MOVE_SPEED }); // aura + sparks + flash all visible
  d.root.traverse((o) => (o.frustumCulled = false));
  scene.add(d.root);
  d.root.updateMatrixWorld(true);
  try {
    if (renderer.compileAsync) await renderer.compileAsync(scene, camera);
    else renderer.compile(scene, camera);
  } catch (err) {
    console.warn('[anim] warmMascotShaders compile failed', err);
  }
  await new Promise((res) => {
    let n = 0;
    const f = () => (++n >= frames ? res() : requestAnimationFrame(f));
    requestAnimationFrame(f);
  });
  d.dispose();
}

/** A spectator critter for the walkway: no nameplate, cycles idle / cheer / clap / jazz hands / wave at random. */
export function createSpectator({ color = '#7a2f2a', scale = 1, castShadow = true } = {}) {
  return createRiggedMascot({ color, scale, nameplate: false, spectator: true, castShadow });
}
