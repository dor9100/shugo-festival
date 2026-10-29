// Bombs: pearl sphere + orange fuse circle filling over the fuse, magenta pillar in the last second,
// purple flash / ring / lingering smoke on explode.
// API (SPEC "World API"): new BombView(scene); add({id,x,z,at,boomAt}); explode(id); update(dt, now); dispose()
import * as THREE from 'three';
import { BOMB_PILLAR_MS, BOMB_RADIUS } from '@shared/config.js';
import { glowTexture, puffTexture, sparkleTexture } from './textures.js';
import { Particles } from './particles.js';
import { warmUp } from './warm.js';

const BOMB_R = 0.26;
const SMOKE_S = 1.25;
const AUTO_EXPLODE_LATE_MS = 1500; // visual safety net if the 'boom' message never arrives

const decalVS = /* glsl */ `
  varying vec2 vP;
  void main() { vP = position.xz / ${BOMB_RADIUS.toFixed(3)}; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const decalFS = /* glsl */ `
  uniform float uFill, uAlpha, uTime, uPulse;
  varying vec2 vP;
  void main() {
    float r = length(vP);
    if (r > 1.0) discard;
    float aa = fwidth(r) * 1.5;
    vec3 orange = vec3(1.0, 0.42, 0.05);
    vec3 hot = vec3(2.6, 1.3, 0.35);
    // base translucent disc
    float a = 0.2 + 0.05 * sin(r * 26.0 - uTime * 3.0);
    vec3 col = orange * 0.9;
    // inner growing disc
    float inner = 1.0 - smoothstep(uFill - aa, uFill, r);
    a = mix(a, 0.36, inner);
    col = mix(col, vec3(1.0, 0.55, 0.12), inner);
    // edge of the growing disc
    float fillEdge = (1.0 - smoothstep(0.0, 0.035, abs(r - uFill))) * step(0.02, uFill);
    // outer rim
    float rim = smoothstep(0.93, 0.975, r) * (1.0 - smoothstep(1.0 - aa, 1.0, r));
    float rimGlow = smoothstep(0.75, 1.0, r) * 0.35;
    a += rimGlow * 0.5;
    col += orange * rimGlow;
    col = mix(col, hot, max(rim, fillEdge * 0.8));
    a = max(a, max(rim * 0.95, fillEdge * 0.75));
    a *= uAlpha * (1.0 + uPulse * 0.25);
    gl_FragColor = vec4(col, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;
const pillarVS = /* glsl */ `
  varying vec2 vUv; varying vec3 vN; varying vec3 vV;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;
const pillarFS = /* glsl */ `
  uniform vec3 uColor; uniform float uAlpha, uTime;
  varying vec2 vUv; varying vec3 vN; varying vec3 vV;
  void main() {
    float h = vUv.y;
    float edge = clamp(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0);
    float facing = 1.0 - edge;                       // bright along the axis, soft fade at the silhouette
    float body = 0.15 + facing * facing * 1.1;
    float streak = 0.75 + 0.25 * sin(vUv.x * 40.0 + uTime * 6.0) * sin(h * 20.0 - uTime * 14.0);
    float a = pow(clamp(1.0 - h, 0.0, 1.0), 1.3) * body * streak * uAlpha;
    gl_FragColor = vec4(uColor * a, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;
const ringFS = /* glsl */ `
  uniform vec3 uColor; uniform float uAlpha;
  varying vec2 vUv;
  void main() {
    float d = abs(vUv.y - 0.5) * 2.0;
    float a = (1.0 - d * d) * uAlpha;
    gl_FragColor = vec4(uColor * a, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export class BombView {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'bombs';
    scene.add(this.group);
    this.live = new Map();
    this.pool = [];
    this.booms = []; // active explosion visuals
    this.boomPool = [];
    this.bombGeo = new THREE.SphereGeometry(BOMB_R, 32, 24);
    this.decalGeo = new THREE.CircleGeometry(BOMB_RADIUS, 72);
    this.decalGeo.rotateX(-Math.PI / 2);
    this.pillarGeo = new THREE.CylinderGeometry(0.24, 0.36, 1, 24, 1, true);
    this.pillarGeo.translate(0, 0.5, 0);
    this.ringGeo = new THREE.RingGeometry(0.85, 1.0, 72, 1);
    this.ringGeo.rotateX(-Math.PI / 2);
    // RingGeometry uv is planar; we want radial: rebuild uv.y = radial 0..1
    {
      const pos = this.ringGeo.attributes.position;
      const uv = this.ringGeo.attributes.uv;
      for (let i = 0; i < pos.count; i++) {
        const r = Math.hypot(pos.getX(i), pos.getZ(i));
        uv.setXY(i, 0, (r - 0.85) / 0.15);
      }
    }
    this.glowMap = glowTexture();
    this.sparks = new Particles(scene, { max: 300, map: sparkleTexture(), additive: true, renderOrder: 31 });
    this.smoke = new Particles(scene, { max: 240, map: puffTexture(), additive: false, renderOrder: 32 });
    this.time = { value: 0 };
    this._c = new THREE.Color();
    this._smokeCols = [
      new THREE.Color('#7a32c8'),
      new THREE.Color('#b64ade'),
      new THREE.Color('#5a1f9a'),
      new THREE.Color('#a24ee0'),
      new THREE.Color(1.5, 0.55, 1.9), // glowing core puffs
      new THREE.Color('#9a3fd8'),
      new THREE.Color('#c860e8'),
      new THREE.Color(1.3, 0.45, 1.7),
    ];
    this._sparkCol = new THREE.Color(2.0, 0.6, 2.2);
    this._sparkCol2 = new THREE.Color(2.2, 1.6, 2.4);
    const wb = this._make();
    const wx = this._makeBoom();
    this._warm = warmUp(scene, [wb.root, wx.root], () => {
      wb.root.visible = false;
      wx.root.visible = false;
      this.pool.push(wb);
      this.boomPool.push(wx);
    });
  }

  _make() {
    const root = new THREE.Group();
    const bombMat = new THREE.MeshPhysicalMaterial({
      color: '#fbf5ff',
      roughness: 0.18,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      sheen: 1,
      sheenColor: new THREE.Color('#ff9ad8'),
      sheenRoughness: 0.4,
      iridescence: 0.7,
      iridescenceIOR: 1.6,
      emissive: '#ff4fc0',
      emissiveIntensity: 0.25,
    });
    const bomb = new THREE.Mesh(this.bombGeo, bombMat);
    bomb.castShadow = true;
    const glowMat = new THREE.SpriteMaterial({
      map: this.glowMap,
      color: new THREE.Color(1.6, 0.45, 1.3),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    const glow = new THREE.Sprite(glowMat);
    glow.renderOrder = 15;
    const decalMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
      uniforms: { uFill: { value: 0 }, uAlpha: { value: 1 }, uTime: this.time, uPulse: { value: 0 } },
      vertexShader: decalVS,
      fragmentShader: decalFS,
    });
    const decal = new THREE.Mesh(this.decalGeo, decalMat);
    decal.position.y = 0.016;
    decal.renderOrder = 7;
    const pillarMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(3.0, 0.4, 2.6) }, uAlpha: { value: 0 }, uTime: this.time },
      vertexShader: pillarVS,
      fragmentShader: pillarFS,
    });
    const pillar = new THREE.Mesh(this.pillarGeo, pillarMat);
    pillar.scale.set(1, 11, 1);
    pillar.renderOrder = 16;
    root.add(decal, bomb, glow, pillar);
    return { root, bomb, glow, decal, pillar, bombMat, glowMat, decalMat, pillarMat, b: null };
  }

  _makeBoom() {
    const root = new THREE.Group();
    const flashMat = new THREE.SpriteMaterial({
      map: this.glowMap,
      color: new THREE.Color(3.4, 1.2, 3.8),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    const flash = new THREE.Sprite(flashMat);
    const coreMat = new THREE.SpriteMaterial({
      map: this.glowMap,
      color: new THREE.Color(5, 4, 5),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    const core = new THREE.Sprite(coreMat);
    core.renderOrder = 34;
    flash.renderOrder = 33;
    const ringMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color(2.8, 1.0, 3.4) }, uAlpha: { value: 1 } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: ringFS,
    });
    const ring = new THREE.Mesh(this.ringGeo, ringMat);
    ring.position.y = 0.03;
    ring.renderOrder = 8;
    const floorMat = new THREE.MeshBasicMaterial({
      map: this.glowMap,
      color: new THREE.Color(1.1, 0.35, 1.4),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), floorMat);
    floor.position.y = 0.02;
    floor.renderOrder = 8;
    root.add(flash, core, ring, floor);
    return { root, flash, core, ring, floor, flashMat, coreMat, ringMat, floorMat, t: 0 };
  }

  /** @param {{id:any,x:number,z:number,at:number,boomAt:number}} b */
  add(b) {
    if (this.live.has(b.id)) return;
    const e = this.pool.pop() || this._make();
    e.b = b;
    e.exploded = false;
    e.root.position.set(b.x, 0, b.z);
    e.root.visible = true;
    this.group.add(e.root);
    this.live.set(b.id, e);
  }

  explode(id) {
    const e = this.live.get(id);
    if (!e) return;
    this.live.delete(id);
    const { x, z } = e.b;
    e.root.removeFromParent();
    e.root.visible = false;
    e.b = null;
    this.pool.push(e);
    // explosion visuals
    const bm = this.boomPool.pop() || this._makeBoom();
    bm.t = 0;
    bm.root.position.set(x, 0, z);
    bm.root.visible = true;
    this.group.add(bm.root);
    this.booms.push(bm);
    // purple smoke filling the circle + sparks
    for (let i = 0; i < 36; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * BOMB_RADIUS * (i < 12 ? 0.35 : 0.9);
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      const out = 0.6 + Math.random() * 0.8;
      this.smoke.emit(
        px,
        0.25 + Math.random() * 0.7,
        pz,
        Math.cos(a) * out,
        0.35 + Math.random() * 0.6,
        Math.sin(a) * out,
        this._smokeCols[i & 7],
        SMOKE_S * (0.75 + Math.random() * 0.5),
        0.9 + Math.random() * 0.6,
        1.9 + Math.random() * 1.2,
        0.5,
        0.1,
        1.6,
        (Math.random() - 0.5) * 1.2,
        0.08,
      );
    }
    this.sparks.burst(x, 0.5, z, this._sparkCol, 44, 5.5, 0.22, 0.9);
    this.sparks.burst(x, 0.4, z, this._sparkCol2, 16, 3.0, 0.16, 0.6);
  }

  update(dt, now) {
    if (this._warm && this._warm.tick()) this._warm = null;
    this.time.value = (now % 100000) / 1000;
    for (const [id, e] of this.live) {
      const b = e.b;
      if (now < b.at) {
        e.root.visible = false;
        continue;
      }
      e.root.visible = true;
      if (now > b.boomAt + AUTO_EXPLODE_LATE_MS) {
        this.explode(id);
        continue;
      }
      const fuse = Math.max(1, b.boomAt - b.at);
      const age = now - b.at;
      const fill = Math.min(1, age / fuse);
      const left = b.boomAt - now;
      // drop in from above with a small bounce
      let y = BOMB_R;
      if (age < 260) {
        const x = age / 260;
        y = BOMB_R + (1 - x * x) * 2.6;
      } else if (age < 420) {
        const x = (age - 260) / 160;
        y = BOMB_R + Math.sin(x * Math.PI) * 0.18;
      }
      e.bomb.position.y = y;
      e.glow.position.y = y;
      // pulse faster as the fuse runs down
      const rate = 3 + fill * 14;
      const pulse = 0.5 + 0.5 * Math.sin(age * 0.001 * rate * Math.PI * 2);
      e.bombMat.emissiveIntensity = 0.2 + fill * 0.5 + pulse * (0.15 + fill * 0.45);
      const gs = 1.0 + fill * 0.5 + pulse * 0.25;
      e.glow.scale.set(gs, gs, 1);
      e.glowMat.opacity = 0.55 + fill * 0.45;
      e.decalMat.uniforms.uFill.value = fill;
      e.decalMat.uniforms.uPulse.value = left < BOMB_PILLAR_MS ? pulse : 0;
      e.decalMat.uniforms.uAlpha.value = Math.min(1, age / 150);
      // magenta pillar in the last BOMB_PILLAR_MS
      if (left < BOMB_PILLAR_MS) {
        const k = 1 - left / BOMB_PILLAR_MS;
        const grow = Math.min(1, (BOMB_PILLAR_MS - left) / 160);
        e.pillar.visible = true;
        e.pillar.scale.set(0.35 + grow * 0.65 + k * 0.2, 11 * grow, 0.35 + grow * 0.65 + k * 0.2);
        e.pillarMat.uniforms.uAlpha.value = (0.55 + k * 0.45) * (0.85 + 0.15 * pulse);
      } else {
        e.pillar.visible = false;
      }
    }
    for (let i = this.booms.length - 1; i >= 0; i--) {
      const bm = this.booms[i];
      bm.t += dt;
      const t = bm.t;
      // flash: big magenta bloom + short white-hot core
      const fk = Math.min(1, t / 0.65);
      const fs = 2 + (1 - (1 - fk) * (1 - fk)) * 8;
      bm.flash.position.y = 0.7;
      bm.flash.scale.set(fs, fs, 1);
      bm.flashMat.opacity = Math.max(0, 1 - fk);
      const ck = Math.min(1, t / 0.3);
      const cs = 2.8 * (1 - ck * 0.6);
      bm.core.position.y = 0.5;
      bm.core.scale.set(cs, cs, 1);
      bm.coreMat.opacity = Math.max(0, 1 - ck);
      // ring
      const rk = Math.min(1, t / 0.7);
      const rr = 0.4 + (1 - (1 - rk) * (1 - rk)) * BOMB_RADIUS * 1.15;
      bm.ring.scale.set(rr, 1, rr);
      bm.ringMat.uniforms.uAlpha.value = Math.max(0, 1 - rk);
      // floor glow
      const gk = Math.min(1, t / 1.2);
      const gsz = BOMB_RADIUS * 2.6;
      bm.floor.scale.set(gsz, 1, gsz);
      bm.floorMat.opacity = Math.max(0, 1 - gk) * 0.9;
      if (t > 1.4) {
        this.booms.splice(i, 1);
        bm.root.removeFromParent();
        bm.root.visible = false;
        this.boomPool.push(bm);
      }
    }
    this.sparks.update(dt);
    this.smoke.update(dt);
  }

  dispose() {
    for (const e of [...this.live.values(), ...this.pool]) {
      e.root.removeFromParent();
      for (const m of [e.bombMat, e.glowMat, e.decalMat, e.pillarMat]) m.dispose();
    }
    for (const bm of [...this.booms, ...this.boomPool]) {
      bm.root.removeFromParent();
      bm.floor.geometry.dispose();
      for (const m of [bm.flashMat, bm.coreMat, bm.ringMat, bm.floorMat]) m.dispose();
    }
    this.live.clear();
    this.pool.length = 0;
    this.booms.length = 0;
    this.boomPool.length = 0;
    for (const g of [this.bombGeo, this.decalGeo, this.pillarGeo, this.ringGeo]) g.dispose();
    this.sparks.dispose();
    this.smoke.dispose();
    this.group.removeFromParent();
  }
}
