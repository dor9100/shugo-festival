// Balloons ("orbs"): glossy glowing translucent spheres with a light shaft to the floor (pink: tall pillar).
// API (SPEC "World API"): new OrbView(scene); add({id,k,x,z,at,exp}); remove(id, {taken}); update(dt, now); dispose()
import * as THREE from 'three';
import { ORB_DIAMETER, ORB_Y } from '@shared/config.js';
import { glowTexture, sparkleTexture, swirlTexture } from './textures.js';
import { Particles } from './particles.js';
import { warmUp } from './warm.js';

const R = ORB_DIAMETER / 2;
const BLINK_MS = 1500;
// premultiplied-alpha blending: out = src.rgb + dst * (1 - src.a)
const PREMULT = {
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor,
  blendSrcAlpha: THREE.ZeroFactor,
  blendDstAlpha: THREE.OneFactor,
};
const POP_IN_MS = 280;

export const ORB_COLORS = {
  green: { base: '#2fe05a', emissive: '#22d04a', glow: new THREE.Color(0.35, 1.6, 0.45), shaft: new THREE.Color(0.3, 1.0, 0.4) },
  pink: { base: '#ff3fc8', emissive: '#ff2fb8', glow: new THREE.Color(1.7, 0.35, 1.3), shaft: new THREE.Color(1.2, 0.25, 0.95) },
  yellow: { base: '#ffc21a', emissive: '#ffb000', glow: new THREE.Color(1.8, 1.25, 0.3), shaft: new THREE.Color(1.1, 0.8, 0.2) },
};

const shaftVS = /* glsl */ `
  varying float vH; varying vec3 vN; varying vec3 vV;
  void main() {
    vH = uv.y;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;
const shaftFS = /* glsl */ `
  uniform vec3 uColor; uniform float uAlpha; uniform float uPow;
  varying float vH; varying vec3 vN; varying vec3 vV;
  void main() {
    float facing = abs(dot(normalize(vN), normalize(vV)));   // bright on the axis, soft at the silhouette
    float a = pow(clamp(1.0 - vH, 0.0, 1.0), uPow) * smoothstep(0.0, 0.05, vH) * facing * facing * uAlpha;
    // premultiplied: slight darkening keeps the colour saturated over the bright floor
    gl_FragColor = vec4(uColor * a, clamp(a * 0.35, 0.0, 1.0));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;
const rimVS = /* glsl */ `
  varying vec3 vN; varying vec3 vV;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;
const rimFS = /* glsl */ `
  uniform vec3 uColor; uniform float uAlpha;
  varying vec3 vN; varying vec3 vV;
  void main() {
    float f = clamp(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0);
    float a = pow(f, 2.2) * 1.1 + pow(f, 8.0) * 0.8;
    gl_FragColor = vec4(uColor * a * uAlpha, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export class OrbView {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'orbs';
    scene.add(this.group);
    this.live = new Map(); // id -> entry
    this.pool = { green: [], pink: [], yellow: [] };
    this.dying = []; // entries animating out
    this.sphereGeo = new THREE.SphereGeometry(R, 40, 28);
    this.rimGeo = new THREE.SphereGeometry(R * 1.08, 32, 20);
    this.shaftGeo = new THREE.CylinderGeometry(0.035, 0.06, 1, 16, 1, true);
    this.shaftGeo.translate(0, 0.5, 0);
    this.pillarGeo = new THREE.CylinderGeometry(0.13, 0.17, 1, 20, 1, true);
    this.pillarGeo.translate(0, 0.5, 0);
    this.groundGeo = new THREE.PlaneGeometry(1.5, 1.5);
    this.groundGeo.rotateX(-Math.PI / 2);
    this.glowMap = glowTexture();
    this.swirl = swirlTexture();
    this.sparks = new Particles(scene, { max: 400, map: sparkleTexture(), additive: true, renderOrder: 30 });
    this._c = new THREE.Color();
    this._white = new THREE.Color(2.2, 2.2, 2.0);
    const warm = ['green', 'pink', 'yellow'].map((k) => this._make(k));
    this._warm = warmUp(
      scene,
      warm.map((e) => e.root),
      () => {
        for (const e of warm) {
          e.root.visible = false;
          this.pool[e.k].push(e);
        }
      },
    );
  }

  _make(k) {
    const C = ORB_COLORS[k] || ORB_COLORS.green;
    const root = new THREE.Group();
    const float = new THREE.Group();
    root.add(float);
    const bodyMat = new THREE.MeshPhysicalMaterial({
      color: C.base,
      emissive: C.emissive,
      emissiveIntensity: 0.75,
      emissiveMap: this.swirl,
      roughness: 0.08,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      transparent: true,
      opacity: 0.86,
      envMapIntensity: 1.4,
      specularIntensity: 1,
    });
    const body = new THREE.Mesh(this.sphereGeo, bodyMat);
    body.renderOrder = 12;
    const rimMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: C.glow.clone().multiplyScalar(1.5) }, uAlpha: { value: 1 } },
      vertexShader: rimVS,
      fragmentShader: rimFS,
    });
    const rim = new THREE.Mesh(this.rimGeo, rimMat);
    rim.renderOrder = 13;
    const coreMat = new THREE.SpriteMaterial({
      map: this.glowMap,
      color: C.glow.clone().multiplyScalar(0.55),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    const core = new THREE.Sprite(coreMat);
    core.scale.set(R * 2.6, R * 2.6, 1);
    core.renderOrder = 14;
    float.add(body, rim, core);

    const shaftMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      ...PREMULT,
      uniforms: { uColor: { value: C.shaft.clone().multiplyScalar(1.6) }, uAlpha: { value: 0.55 }, uPow: { value: 1.2 } },
      vertexShader: shaftVS,
      fragmentShader: shaftFS,
    });
    // uv.y is 0 at the floor and 1 at the top: invert so it's brightest at the floor
    const shaft = new THREE.Mesh(this.shaftGeo, shaftMat);
    shaft.scale.y = ORB_Y;
    shaft.renderOrder = 11;
    root.add(shaft);

    let pillar = null;
    if (k === 'pink') {
      const pm = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        ...PREMULT,
        uniforms: { uColor: { value: C.shaft.clone().multiplyScalar(2.2) }, uAlpha: { value: 0.5 }, uPow: { value: 1.4 } },
        vertexShader: shaftVS,
        fragmentShader: shaftFS,
      });
      pillar = new THREE.Mesh(this.pillarGeo, pm);
      pillar.scale.y = 4.2; // visible from afar, but the real pillar is far shorter than a banner pole
      pillar.renderOrder = 11;
      root.add(pillar);
    }

    const groundMat = new THREE.MeshBasicMaterial({
      map: this.glowMap,
      color: C.shaft.clone().multiplyScalar(0.7),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const ground = new THREE.Mesh(this.groundGeo, groundMat);
    ground.position.y = 0.014;
    ground.renderOrder = 6;
    root.add(ground);

    return { k, root, float, body, rim, core, shaft, pillar, ground, bodyMat, rimMat, coreMat, shaftMat, groundMat, orb: null, state: 'live', t: 0, phase: 0 };
  }

  /** @param {{id:any,k:'green'|'pink'|'yellow',x:number,z:number,at?:number,exp?:number}} orb */
  add(orb) {
    if (this.live.has(orb.id)) return;
    const k = ORB_COLORS[orb.k] ? orb.k : 'green';
    const e = this.pool[k].pop() || this._make(k);
    e.orb = orb;
    e.y = orb.y ?? ORB_Y; // air balloons float higher (need a jump)
    e.state = 'live';
    e.t = 0;
    e.phase = Math.random() * Math.PI * 2;
    e.root.position.set(orb.x, 0, orb.z);
    e.root.visible = true;
    e.root.scale.setScalar(1);
    this.group.add(e.root);
    this.live.set(orb.id, e);
  }

  /** @param {any} id @param {{taken?: boolean}} [o] */
  remove(id, o) {
    const e = this.live.get(id);
    if (!e) return;
    this.live.delete(id);
    e.t = 0;
    if (o && o.taken) {
      e.state = 'pop';
      const p = e.float.getWorldPosition(this._v || (this._v = new THREE.Vector3()));
      const C = ORB_COLORS[e.k];
      this.sparks.burst(p.x, p.y, p.z, C.glow, 34, 3.2, 0.2, 0.8);
      this.sparks.burst(p.x, p.y, p.z, this._white, 10, 2.0, 0.14, 0.5);
    } else {
      e.state = 'shrink';
    }
    this.dying.push(e);
  }

  _release(e) {
    e.root.removeFromParent();
    e.root.visible = false;
    e.orb = null;
    this.pool[e.k].push(e);
  }

  _pose(e, now, scale, alpha) {
    const bob = Math.sin(now * 0.0034 + e.phase) * 0.065;
    e.float.position.y = e.y + bob;
    e.float.rotation.y = now * 0.0006 + e.phase;
    e.float.scale.setScalar(scale);
    e.bodyMat.opacity = 0.86 * alpha;
    e.bodyMat.emissiveIntensity = 0.75 * alpha;
    e.rimMat.uniforms.uAlpha.value = alpha;
    e.coreMat.opacity = alpha;
    e.shaft.scale.y = Math.max(0.01, e.y + bob - R * 0.6 * scale);
    e.shaftMat.uniforms.uAlpha.value = 0.7 * alpha;
    e.groundMat.opacity = 0.9 * alpha;
    e.ground.scale.setScalar(0.6 + 0.4 * scale);
    if (e.pillar) e.pillar.material.uniforms.uAlpha.value = 0.6 * alpha * (0.85 + 0.15 * Math.sin(now * 0.006 + e.phase));
  }

  update(dt, now) {
    if (this._warm && this._warm.tick()) this._warm = null;
    for (const e of this.live.values()) {
      const o = e.orb;
      const age = o.at != null ? now - o.at : 1e9;
      if (age < 0) {
        e.root.visible = false;
        continue;
      }
      e.root.visible = true;
      let scale = 1;
      if (age < POP_IN_MS) {
        const x = age / POP_IN_MS;
        scale = x < 0.7 ? (x / 0.7) * 1.15 : 1.15 - ((x - 0.7) / 0.3) * 0.15;
      }
      let alpha = 1;
      if (o.exp != null) {
        const left = o.exp - now;
        if (left < BLINK_MS) {
          // blink faster as expiry approaches
          const f = left < 600 ? 9 : 5.5;
          const on = Math.sin(now * 0.001 * Math.PI * 2 * f) > -0.2;
          alpha = on ? 1 : 0.25;
          if (left < 0) scale *= Math.max(0, 1 + left / 300);
        }
      }
      this._pose(e, now, scale, alpha);
    }
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const e = this.dying[i];
      e.t += dt;
      let done;
      if (e.state === 'pop') {
        const x = e.t / 0.16;
        this._pose(e, now, 1 + x * 0.45, Math.max(0, 1 - x));
        done = x >= 1;
      } else {
        const x = e.t / 0.3;
        this._pose(e, now, Math.max(0.001, 1 - x * x), Math.max(0, 1 - x));
        done = x >= 1;
      }
      if (done) {
        this.dying.splice(i, 1);
        this._release(e);
      }
    }
    this.sparks.update(dt);
  }

  dispose() {
    const all = [...this.live.values(), ...this.dying, ...this.pool.green, ...this.pool.pink, ...this.pool.yellow];
    for (const e of all) {
      e.root.removeFromParent();
      for (const m of [e.bodyMat, e.rimMat, e.coreMat, e.shaftMat, e.groundMat, e.pillar && e.pillar.material]) if (m) m.dispose();
    }
    this.live.clear();
    this.dying.length = 0;
    this.pool = { green: [], pink: [], yellow: [] };
    for (const g of [this.sphereGeo, this.rimGeo, this.shaftGeo, this.pillarGeo, this.groundGeo]) g.dispose();
    this.sparks.dispose();
    this.group.removeFromParent();
  }
}
