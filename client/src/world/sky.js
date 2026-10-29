// Gradient sky dome shared by the visible sky (arena.js) and the PMREM environment (renderer.js).
import * as THREE from 'three';

export const SUN_DIR = new THREE.Vector3(-0.42, 0.78, 0.46).normalize(); // sun high, behind-right of the default camera
export const HORIZON_COLOR = new THREE.Color('#d4e9f6');
export const FOG_COLOR = new THREE.Color('#cfe4f2');

export function createSkyMaterial({ sunDisc = true } = {}) {
  return new THREE.ShaderMaterial({
    name: 'SkyDome',
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color('#3f8fe0') },
      uMid: { value: new THREE.Color('#8cc3ee') },
      uHorizon: { value: HORIZON_COLOR.clone() },
      uBottom: { value: new THREE.Color('#e4eef5') },
      uSunDir: { value: SUN_DIR.clone() },
      uSunColor: { value: new THREE.Color('#fff2d6') },
      uSunDisc: { value: sunDisc ? 1 : 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww; // always at the far plane
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop, uMid, uHorizon, uBottom, uSunDir, uSunColor;
      uniform float uSunDisc;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.28, h));
        col = mix(col, uTop, smoothstep(0.25, 0.95, h));
        col = mix(col, uBottom, smoothstep(0.0, -0.12, h));
        float s = clamp(dot(d, uSunDir), 0.0, 1.0);
        col += uSunColor * (pow(s, 900.0) * 5.0 * uSunDisc + pow(s, 24.0) * 0.22 + pow(s, 4.0) * 0.06);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

export function createSkyDome(radius = 400, opts) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), createSkyMaterial(opts));
  mesh.name = 'sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  return mesh;
}
