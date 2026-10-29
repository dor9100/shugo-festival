// Laser beams: pooled, stateless (pure function of descriptors + room time), no per-frame allocations of our own.
// API (SPEC "World API"): new LaserView(scene); view.update(beams, now); view.dispose()
import * as THREE from 'three';
import { ARENA_HALF, BORDER_WIDTH, LASER_Y } from '@shared/config.js';
import { beamSegment, beamTimes } from '@shared/lasers.js';
import { flareTexture } from './textures.js';
import { warmUp } from './warm.js';

const EMIT_AT = ARENA_HALF + BORDER_WIDTH * 0.5; // emitter nodes sit on the border rail
// premultiplied-alpha blending: out = src.rgb + dst * (1 - src.a)
const PREMULT = {
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor,
  blendSrcAlpha: THREE.ZeroFactor,
  blendDstAlpha: THREE.OneFactor,
};
const POP_MS = 170;
const FADE_MS = 200;

// beam ribbon: 2 x 2 verts, aTS = (t along 0..1, s side -1..1); billboarded around the beam axis in the vertex shader
function ribbonGeometry() {
  const g = new THREE.BufferGeometry();
  const segs = 24; // a few segments along the beam so the flicker / falloff varies smoothly
  const ts = [];
  const idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    ts.push(t, -1, t, 1);
    if (i < segs) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(ts.length / 2 * 3), 3));
  g.setAttribute('aTS', new THREE.Float32BufferAttribute(ts, 2));
  g.setIndex(idx);
  return g;
}

const beamVS = /* glsl */ `
  attribute vec2 aTS;
  uniform vec3 uA, uB;
  uniform float uWidth;
  varying vec2 vTS;
  varying float vAlong;
  void main() {
    vec3 P = mix(uA, uB, aTS.x);
    vec3 axis = normalize(uB - uA);
    vec3 toCam = normalize(cameraPosition - P);
    vec3 side = cross(axis, toCam);
    float sl = length(side);
    side = sl > 1e-4 ? side / sl : vec3(0.0, 1.0, 0.0);
    vec3 world = P + side * aTS.y * uWidth;
    vTS = aTS;
    vAlong = aTS.x * length(uB - uA);
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }`;
const beamFS = /* glsl */ `
  uniform vec3 uColor, uCore;
  uniform float uIntensity, uTime;
  varying vec2 vTS;
  varying float vAlong;
  void main() {
    float d = abs(vTS.y);
    float core = exp(-(d * d) / 0.008);    // thin white-hot core (~3 cm)
    float glow = exp(-(d * d) / 0.07);     // saturated red glow
    float halo = exp(-d * 5.5);            // faint wide halo
    float flick = 0.88 + 0.12 * sin(vAlong * 6.0 - uTime * 23.0) * sin(vAlong * 1.7 + uTime * 7.0);
    float k = smoothstep(1.0, 0.75, d) * uIntensity;
    // premultiplied: alpha darkens what's behind (keeps the red saturated over the bright floor), rgb adds light
    vec3 col = (uCore * core + uColor * (glow * 0.8 + halo * 0.22) * flick) * k;
    float a = clamp((glow * 0.6 + halo * 0.12) * k, 0.0, 1.0);
    gl_FragColor = vec4(col, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const floorVS = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const floorFS = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  varying vec2 vUv;
  void main() {
    float d = abs(vUv.y - 0.5) * 2.0;           // 0 under the beam .. 1 at the strip edge
    float e = min(vUv.x, 1.0 - vUv.x) * 14.0;   // soften the ends at the rail
    float a = (exp(-(d * d) / 0.03) * 0.9 + exp(-(d * d) / 0.2) * 0.4) * clamp(e, 0.0, 1.0) * uIntensity;
    gl_FragColor = vec4(uColor * a, clamp(a * 0.5, 0.0, 1.0));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export class LaserView {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'lasers';
    scene.add(this.group);
    this.slots = [];
    this.ribbon = ribbonGeometry();
    this.floorGeo = new THREE.PlaneGeometry(ARENA_HALF * 2, 1.0);
    this.floorGeo.rotateX(-Math.PI / 2); // length along X, width along Z
    this.flareMap = flareTexture();
    this.time = { value: 0 };
    const s0 = this._slot(0);
    this._warm = warmUp(scene, [s0.beam, s0.floor, s0.e1, s0.e2], (objs) => {
      for (const o of objs) {
        o.visible = false;
        this.group.add(o);
      }
    });
  }

  _slot(i) {
    let s = this.slots[i];
    if (s) return s;
    const beamMat = new THREE.ShaderMaterial({
      name: 'LaserBeam',
      transparent: true,
      depthWrite: false,
      ...PREMULT,
      uniforms: {
        uA: { value: new THREE.Vector3() },
        uB: { value: new THREE.Vector3() },
        uWidth: { value: 0.3 },
        uColor: { value: new THREE.Color(2.8, 0.26, 0.1) },
        uCore: { value: new THREE.Color(7.0, 4.2, 2.2) },
        uIntensity: { value: 1 },
        uTime: this.time,
      },
      vertexShader: beamVS,
      fragmentShader: beamFS,
    });
    const beam = new THREE.Mesh(this.ribbon, beamMat);
    beam.frustumCulled = false;
    beam.renderOrder = 20;

    const floorMat = new THREE.ShaderMaterial({
      name: 'LaserFloorGlow',
      transparent: true,
      depthWrite: false,
      ...PREMULT,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      uniforms: { uColor: { value: new THREE.Color(1.5, 0.1, 0.04) }, uIntensity: { value: 0.5 } },
      vertexShader: floorVS,
      fragmentShader: floorFS,
    });
    const floor = new THREE.Mesh(this.floorGeo, floorMat);
    floor.position.y = 0.012;
    floor.renderOrder = 5;

    const flareMat = new THREE.SpriteMaterial({
      map: this.flareMap,
      color: new THREE.Color(6.0, 3.4, 2.8),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    const e1 = new THREE.Sprite(flareMat);
    const e2 = new THREE.Sprite(flareMat);
    e1.renderOrder = e2.renderOrder = 21;

    s = { beam, floor, e1, e2, beamMat, floorMat, flareMat };
    this.group.add(beam, floor, e1, e2);
    this.slots[i] = s;
    return s;
  }

  /**
   * @param {Array<object>} beams beam descriptors (see shared/lasers.js); inactive ones are skipped
   * @param {number} now room time in ms
   */
  update(beams, now) {
    if (this._warm && this._warm.tick()) this._warm = null;
    this.time.value = (now % 100000) / 1000;
    let n = 0;
    if (beams) {
      for (let k = 0; k < beams.length; k++) {
        const b = beams[k];
        const seg = beamSegment(b, now);
        if (!seg) continue;
        const s = this._slot(n++);
        const age = now - b.t0;
        const left = beamTimes(b).tGone - now;
        // pop-in with a little overshoot, quick fade at the end
        let pop = 1;
        if (age < POP_MS) {
          const x = age / POP_MS;
          pop = x < 0.6 ? (x / 0.6) * 1.35 : 1.35 - ((x - 0.6) / 0.4) * 0.35;
        }
        const fade = Math.max(0, Math.min(1, left / FADE_MS));
        const k2 = pop * (0.55 + 0.45 * fade);
        const intensity = fade * (age < POP_MS ? 1.3 : 1);

        const isX = seg.ax === 'x';
        const p = seg.pos;
        const u = s.beamMat.uniforms;
        if (isX) {
          u.uA.value.set(p, LASER_Y, -EMIT_AT);
          u.uB.value.set(p, LASER_Y, EMIT_AT);
        } else {
          u.uA.value.set(-EMIT_AT, LASER_Y, p);
          u.uB.value.set(EMIT_AT, LASER_Y, p);
        }
        u.uWidth.value = 0.3 * k2;
        u.uIntensity.value = intensity;

        s.floor.position.x = isX ? p : 0;
        s.floor.position.z = isX ? 0 : p;
        s.floor.rotation.y = isX ? Math.PI / 2 : 0;
        s.floor.scale.z = Math.max(0.05, k2);
        s.floorMat.uniforms.uIntensity.value = 0.7 * fade;

        s.e1.position.copy(u.uA.value);
        s.e2.position.copy(u.uB.value);
        const es = 1.05 * (age < POP_MS ? pop * 1.25 : 1) * (0.5 + 0.5 * fade) * (0.95 + 0.05 * Math.sin(now * 0.04 + k));
        s.e1.scale.set(es, es, 1);
        s.e2.scale.set(es, es, 1);
        s.flareMat.opacity = fade;

        s.beam.visible = s.floor.visible = s.e1.visible = s.e2.visible = true;
      }
    }
    for (let i = n; i < this.slots.length; i++) {
      if (i === 0 && this._warm) continue; // slot 0 is being rendered off-screen for shader warm-up
      const s = this.slots[i];
      s.beam.visible = s.floor.visible = s.e1.visible = s.e2.visible = false;
    }
  }

  dispose() {
    for (const s of this.slots) {
      s.beamMat.dispose();
      s.floorMat.dispose();
      s.flareMat.dispose();
    }
    this.slots.length = 0;
    this.ribbon.dispose();
    this.floorGeo.dispose();
    this.group.removeFromParent();
  }
}
