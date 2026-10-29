// Shader warm-up: render pooled objects once, out of sight, so their programs compile at load time instead of
// causing a hitch the first time a balloon / bomb / beam / float text appears mid-round.
import * as THREE from 'three';

const WARM_Y = -80; // below the island and the opaque cloud sea: never visible from gameplay cameras

/**
 * @param {THREE.Object3D} parent scene (or any attached group)
 * @param {THREE.Object3D[]} roots objects to render for `frames` frames
 * @param {(roots: THREE.Object3D[]) => void} done called once afterwards (detach / return to pools)
 */
export function warmUp(parent, roots, done, frames = 3) {
  const g = new THREE.Group();
  g.name = 'warmup';
  g.position.y = WARM_Y;
  const culled = [];
  for (const r of roots) {
    r.visible = true;
    g.add(r);
    r.traverse((o) => {
      o.visible = true;
      if (o.frustumCulled) {
        o.frustumCulled = false;
        culled.push(o);
      }
    });
  }
  parent.add(g);
  let n = 0;
  return {
    /** call once per frame; returns true when finished */
    tick() {
      if (++n < frames) return false;
      for (const o of culled) o.frustumCulled = true;
      for (const r of roots) g.remove(r);
      g.removeFromParent();
      done(roots);
      return true;
    },
  };
}
