// Free MMO orbit camera around the own mascot.
// Drag with left OR right mouse: yaw 360°, pitch CAM.pitchMin..pitchMax. Wheel zoom. Q/E rotate yaw.
// yaw = horizontal forward direction (sin yaw, 0, cos yaw); yaw 0 => camera on the -z side looking toward +z.
import * as THREE from 'three';
import { CAM } from './tuning.js';
import { settings } from './settings.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class OrbitCamera {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    camera.fov = CAM.fov; // FEEL: ~60 deg vertical (WORLD's renderer only updates the aspect on resize)
    camera.updateProjectionMatrix();
    this.yaw = CAM.yawDefault;
    this.pitch = CAM.pitchDefault;
    this.dist = CAM.distDefault;
    this.distGoal = CAM.distDefault;
    this.target = new THREE.Vector3(0, CAM.targetHeight, 0);
    this.focus = new THREE.Vector3(0, CAM.targetHeight, 0);
    this.drag = null; // {id, x, y}
    this.enabled = true;
    this.auto = 0; // rad/s auto-orbit (menu background)

    this._down = (e) => {
      if (!this.enabled || (e.button !== 0 && e.button !== 2)) return;
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      try {
        dom.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      dom.classList.add('dragging');
    };
    this._move = (e) => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
      const k = CAM.dragRadPerPx * settings.sensitivity;
      this.yaw -= dx * k;
      this.pitch = clamp(this.pitch + dy * k, CAM.pitchMin, CAM.pitchMax);
    };
    this._up = (e) => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      this.drag = null;
      dom.classList.remove('dragging');
    };
    this._wheel = (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      this.distGoal = clamp(this.distGoal * Math.exp(dy * CAM.wheelZoom), CAM.distMin, CAM.distMax);
    };
    this._ctx = (e) => e.preventDefault();
    dom.addEventListener('pointerdown', this._down);
    dom.addEventListener('pointermove', this._move);
    dom.addEventListener('pointerup', this._up);
    dom.addEventListener('pointercancel', this._up);
    dom.addEventListener('wheel', this._wheel, { passive: false });
    dom.addEventListener('contextmenu', this._ctx);
  }

  reset() {
    this.yaw = CAM.yawDefault;
    this.pitch = CAM.pitchDefault;
    this.distGoal = this.dist = CAM.distDefault;
  }

  /** Snap the smoothed target to a position (teleports). */
  snapTo(pos) {
    const k = this.focusScale();
    this.focus.set(pos.x * k, CAM.targetHeight + Math.max(0, pos.y || 0) * CAM.followJump, pos.z * k);
    this.target.copy(this.focus);
  }

  /** Center bias (if any) fades out when zoomed in, so close-up orbiting stays centered on the own mascot. */
  focusScale() {
    if (!CAM.centerBias) return 1;
    const t = clamp((this.distGoal - (CAM.distMin + 2)) / (CAM.distDefault - CAM.distMin - 2), 0, 1);
    return 1 - CAM.centerBias * t * t * (3 - 2 * t);
  }

  /** Horizontal unit vectors relative to the camera: forward & right. */
  basis() {
    const s = Math.sin(this.yaw);
    const c = Math.cos(this.yaw);
    return { fx: s, fz: c, rx: -c, rz: s };
  }

  update(dt, focusPos, rotateAxis = 0) {
    this.yaw += rotateAxis * CAM.qeSpeed * dt + this.auto * dt;
    if (focusPos) {
      const k = this.focusScale();
      this.focus.set(focusPos.x * k, CAM.targetHeight + Math.max(0, focusPos.y) * CAM.followJump, focusPos.z * k);
    }
    // rigid follow (FEEL: no lag, rises with the jump) unless a finite followLerp is configured
    if (!Number.isFinite(CAM.followLerp)) this.target.copy(this.focus);
    else this.target.lerp(this.focus, 1 - Math.exp(-CAM.followLerp * dt));
    this.dist += (this.distGoal - this.dist) * (1 - Math.exp(-CAM.zoomLerp * dt));
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    this.camera.position.set(
      this.target.x - Math.sin(this.yaw) * cp * this.dist,
      this.target.y + sp * this.dist,
      this.target.z - Math.cos(this.yaw) * cp * this.dist,
    );
    this.camera.lookAt(this.target);
  }

  dispose() {
    const d = this.dom;
    d.removeEventListener('pointerdown', this._down);
    d.removeEventListener('pointermove', this._move);
    d.removeEventListener('pointerup', this._up);
    d.removeEventListener('pointercancel', this._up);
    d.removeEventListener('wheel', this._wheel);
    d.removeEventListener('contextmenu', this._ctx);
  }
}
