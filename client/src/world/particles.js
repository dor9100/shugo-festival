// Pooled CPU-simulated point-sprite particles (one draw call per system, no per-frame allocations).
import * as THREE from 'three';
import { pointScaleHook } from './mascot.js';

export class Particles {
  /**
   * @param {THREE.Scene} scene
   * @param {{max?: number, map: THREE.Texture, additive?: boolean, renderOrder?: number}} o
   */
  constructor(scene, { max = 512, map, additive = true, renderOrder = 10 } = {}) {
    this.max = max;
    this.n = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.siz = new Float32Array(max);
    this.alp = new Float32Array(max);
    this.rot = new Float32Array(max);
    // simulation state
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.size1 = new Float32Array(max);
    this.alpha0 = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.spin = new Float32Array(max);
    this.fadeIn = new Float32Array(max);

    const g = new THREE.BufferGeometry();
    const mk = (arr, n) => new THREE.BufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage);
    this.aPos = mk(this.pos, 3);
    this.aCol = mk(this.col, 3);
    this.aSiz = mk(this.siz, 1);
    this.aAlp = mk(this.alp, 1);
    this.aRot = mk(this.rot, 1);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aColor', this.aCol);
    g.setAttribute('aSize', this.aSiz);
    g.setAttribute('aAlpha', this.aAlp);
    g.setAttribute('aRot', this.aRot);
    g.setDrawRange(0, 0);
    this.geometry = g;
    this.material = new THREE.ShaderMaterial({
      name: additive ? 'ParticlesAdd' : 'ParticlesAlpha',
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uMap: { value: map }, uScale: { value: 600 } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor; attribute float aSize; attribute float aAlpha; attribute float aRot;
        uniform float uScale;
        varying vec3 vColor; varying float vAlpha; varying float vRot;
        void main() {
          vColor = aColor; vAlpha = aAlpha; vRot = aRot;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec3 vColor; varying float vAlpha; varying float vRot;
        void main() {
          vec2 p = gl_PointCoord - 0.5;
          float c = cos(vRot), s = sin(vRot);
          p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + 0.5;
          vec4 t = texture2D(uMap, p);
          ${
            additive
              ? 'gl_FragColor = vec4(vColor * t.rgb * t.a * vAlpha, 1.0);'
              : 'gl_FragColor = vec4(vColor * t.rgb, t.a * vAlpha);'
          }
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = renderOrder;
    this.points.onBeforeRender = pointScaleHook(this.material.uniforms.uScale);
    scene.add(this.points);
  }

  /**
   * Emit one particle.
   * @param {number} x @param {number} y @param {number} z
   * @param {number} vx @param {number} vy @param {number} vz
   * @param {THREE.Color} color (linear, may exceed 1 for HDR glow)
   * @param {{life?: number, size?: number, size1?: number, alpha?: number, gravity?: number, drag?: number, spin?: number, fadeIn?: number, rot?: number}} o
   */
  emit(x, y, z, vx, vy, vz, color, life = 1, size = 0.1, size1 = size, alpha = 1, gravity = 0, drag = 0, spin = 0, fadeIn = 0) {
    let i = this.n;
    if (i >= this.max) i = Math.floor(Math.random() * this.max); // recycle a random one when full
    else this.n++;
    const i3 = i * 3;
    this.pos[i3] = x;
    this.pos[i3 + 1] = y;
    this.pos[i3 + 2] = z;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;
    this.col[i3] = color.r;
    this.col[i3 + 1] = color.g;
    this.col[i3 + 2] = color.b;
    this.life[i] = 0;
    this.maxLife[i] = life;
    this.size0[i] = size;
    this.size1[i] = size1;
    this.alpha0[i] = alpha;
    this.grav[i] = gravity;
    this.drag[i] = drag;
    this.spin[i] = spin;
    this.fadeIn[i] = fadeIn;
    this.rot[i] = Math.random() * Math.PI * 2;
    this.siz[i] = fadeIn > 0 ? 0 : size;
    this.alp[i] = fadeIn > 0 ? 0 : alpha;
  }

  /** Sparkle burst helper. */
  burst(x, y, z, color, count = 28, speed = 2.6, size = 0.16, life = 0.75) {
    for (let k = 0; k < count; k++) {
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const sp = speed * (0.35 + Math.random() * 0.75);
      this.emit(
        x,
        y,
        z,
        Math.cos(a) * r * sp,
        Math.abs(u) * sp * 0.9 + 0.6,
        Math.sin(a) * r * sp,
        color,
        life * (0.6 + Math.random() * 0.6),
        size * (0.6 + Math.random() * 0.8),
        size * 0.2,
        1,
        -3.5,
        2.8,
        (Math.random() - 0.5) * 6,
      );
    }
  }

  update(dt) {
    if (this.n === 0) return;
    dt = Math.min(dt, 0.1);
    let i = 0;
    while (i < this.n) {
      const l = (this.life[i] += dt);
      const ml = this.maxLife[i];
      if (l >= ml) {
        this._kill(i);
        continue;
      }
      const i3 = i * 3;
      const dr = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= dr;
      this.vel[i3 + 1] = this.vel[i3 + 1] * dr + this.grav[i] * dt;
      this.vel[i3 + 2] *= dr;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      const k = l / ml;
      const fi = this.fadeIn[i];
      const inK = fi > 0 ? Math.min(1, l / fi) : 1;
      this.siz[i] = (this.size0[i] + (this.size1[i] - this.size0[i]) * k) * (0.4 + 0.6 * inK);
      this.alp[i] = this.alpha0[i] * inK * (k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4);
      this.rot[i] += this.spin[i] * dt;
      i++;
    }
    this.geometry.setDrawRange(0, this.n);
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
    this.aSiz.needsUpdate = true;
    this.aAlp.needsUpdate = true;
    this.aRot.needsUpdate = true;
  }

  _kill(i) {
    const last = --this.n;
    if (i !== last) {
      const i3 = i * 3;
      const l3 = last * 3;
      for (let c = 0; c < 3; c++) {
        this.pos[i3 + c] = this.pos[l3 + c];
        this.vel[i3 + c] = this.vel[l3 + c];
        this.col[i3 + c] = this.col[l3 + c];
      }
      this.life[i] = this.life[last];
      this.maxLife[i] = this.maxLife[last];
      this.size0[i] = this.size0[last];
      this.size1[i] = this.size1[last];
      this.alpha0[i] = this.alpha0[last];
      this.grav[i] = this.grav[last];
      this.drag[i] = this.drag[last];
      this.spin[i] = this.spin[last];
      this.fadeIn[i] = this.fadeIn[last];
      this.rot[i] = this.rot[last];
      this.siz[i] = this.siz[last];
      this.alp[i] = this.alp[last];
    }
    if (this.n === 0) this.geometry.setDrawRange(0, 0);
  }

  dispose() {
    this.points.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
