// Floating score texts (pooled canvas sprites) + sparkle bursts.
// API (SPEC "World API"): new Effects(scene); floatText(pos, text, color); burst(pos, color); update(dt); dispose()
import * as THREE from 'three';
import { makeCanvas, sparkleTexture } from './textures.js';
import { Particles } from './particles.js';
import { warmUp } from './warm.js';

const NAMED = {
  green: '#6dff5a',
  pink: '#ff6ad5',
  gold: '#ffd23a',
  yellow: '#ffd23a',
  red: '#ff4a3a',
  white: '#ffffff',
  purple: '#c77dff',
};
const TEXT_LIFE = 1.15;
const POOL = 24;
const CW = 256;
const CH = 96;

function cssColor(c) {
  if (typeof c === 'number') return '#' + c.toString(16).padStart(6, '0');
  if (c && typeof c === 'object' && c.isColor) return '#' + c.getHexString();
  if (typeof c === 'string') return NAMED[c] || c;
  return '#ffffff';
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'effects';
    scene.add(this.group);
    this.texts = [];
    this.free = [];
    for (let i = 0; i < POOL; i++) this.free.push(this._makeText());
    this.sparks = new Particles(scene, { max: 400, map: sparkleTexture(), additive: true, renderOrder: 40 });
    this._col = new THREE.Color();
    const w = this.free[0];
    this._warm = warmUp(scene, [w.sprite], () => {
      w.sprite.visible = false;
    });
  }

  _makeText() {
    const cv = makeCanvas(CW, CH);
    const ctx = cv.getContext('2d');
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
    const sprite = new THREE.Sprite(mat);
    sprite.renderOrder = 100;
    sprite.center.set(0.5, 0);
    sprite.visible = false;
    return { sprite, ctx, tex, mat, t: 0, x: 0, y: 0, z: 0, drift: 0 };
  }

  /**
   * @param {THREE.Vector3|{x:number,y:number,z:number}} pos world position (e.g. above a head)
   * @param {string} text e.g. "+50", "-20"
   * @param {string|number} color CSS colour or 'green'|'pink'|'gold'|'red'
   */
  floatText(pos, text, color = '#ffffff') {
    const it = this.free.pop() || this.texts.shift();
    if (!it) return;
    const { ctx } = it;
    ctx.clearRect(0, 0, CW, CH);
    ctx.font = '900 64px system-ui, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 10;
    ctx.strokeStyle = 'rgba(20,10,20,0.85)';
    ctx.strokeText(String(text), CW / 2, CH / 2 + 2);
    const col = cssColor(color);
    const g = ctx.createLinearGradient(0, CH * 0.2, 0, CH * 0.85);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.45, col);
    g.addColorStop(1, col);
    ctx.fillStyle = g;
    ctx.fillText(String(text), CW / 2, CH / 2 + 2);
    it.tex.needsUpdate = true;
    it.t = 0;
    it.x = pos.x;
    it.y = pos.y;
    it.z = pos.z;
    it.drift = (Math.random() - 0.5) * 0.3;
    it.sprite.visible = true;
    it.sprite.position.set(it.x, it.y, it.z);
    this.group.add(it.sprite);
    this.texts.push(it);
  }

  /** Sparkle burst at a world position. */
  burst(pos, color = '#ffffff', count = 30) {
    this._col.set(cssColor(color)).multiplyScalar(1.8);
    this.sparks.burst(pos.x, pos.y, pos.z, this._col, count, 2.8, 0.17, 0.75);
  }

  update(dt) {
    if (this._warm && this._warm.tick()) this._warm = null;
    dt = Math.min(dt || 0, 0.1);
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const it = this.texts[i];
      it.t += dt;
      const k = it.t / TEXT_LIFE;
      if (k >= 1) {
        it.sprite.visible = false;
        it.sprite.removeFromParent();
        this.texts.splice(i, 1);
        this.free.push(it);
        continue;
      }
      const rise = 1 - Math.pow(1 - k, 2.2);
      it.sprite.position.set(it.x + it.drift * k, it.y + rise * 1.0, it.z);
      const pop = k < 0.12 ? 0.55 + (k / 0.12) * 0.6 : k < 0.22 ? 1.15 - ((k - 0.12) / 0.1) * 0.15 : 1;
      const s = 0.42 * pop;
      it.sprite.scale.set(s * (CW / CH), s, 1);
      it.mat.opacity = k < 0.65 ? 1 : 1 - (k - 0.65) / 0.35;
    }
    this.sparks.update(dt);
  }

  dispose() {
    for (const it of [...this.texts, ...this.free]) {
      it.sprite.removeFromParent();
      it.tex.dispose();
      it.mat.dispose();
    }
    this.texts.length = 0;
    this.free.length = 0;
    this.sparks.dispose();
    this.group.removeFromParent();
  }
}
