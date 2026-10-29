// WebGL renderer + post-processing + nameplate overlay + sun/sky lighting.
// API (SPEC "World API"): createRenderer(container) -> { renderer, scene, camera, labelRenderer, render(), resize(), setQuality(level) }
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { createSkyDome, FOG_COLOR, SUN_DIR } from './sky.js';

const QUALITY = {
  high: { maxDpr: 2, shadows: true, shadowMap: 2048, bloom: true, samples: 4 },
  medium: { maxDpr: 1.5, shadows: true, shadowMap: 1024, bloom: true, samples: 2 },
  low: { maxDpr: 1, shadows: false, shadowMap: 512, bloom: false, samples: 0 },
};

export function createRenderer(container = document.body) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', stencil: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // r186: PCF is soft (Vogel disk); PCFSoft was removed
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const canvas = renderer.domElement;
  canvas.style.display = 'block';
  canvas.style.touchAction = 'none';
  container.appendChild(canvas);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(FOG_COLOR, 70, 260);
  scene.background = FOG_COLOR.clone();

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 600);
  camera.position.set(0, 10.7, -9);
  camera.lookAt(0, 0.6, 0);

  // --- lights: one sun with a tight shadow frustum around the plaza + sky/ground fill ---
  const sun = new THREE.DirectionalLight(0xffeeda, 2.5);
  sun.name = 'sun';
  sun.position.copy(SUN_DIR).multiplyScalar(30);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  const sc = sun.shadow.camera;
  sc.left = -12.5;
  sc.right = 12.5;
  sc.top = 12.5;
  sc.bottom = -12.5;
  sc.near = 5;
  sc.far = 60;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.025;
  sun.shadow.radius = 2.5;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x8a9670, 0.7);
  hemi.name = 'hemi';
  scene.add(hemi);

  // --- image based lighting from the same procedural sky (gives balloons / copper real reflections) ---
  {
    const envScene = new THREE.Scene();
    envScene.add(createSkyDome(50, { sunDisc: false }));
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(40, 24),
      new THREE.MeshBasicMaterial({ color: 0x6f8f55 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -2;
    envScene.add(ground);
    const pmrem = new THREE.PMREMGenerator(renderer);
    // three's PMREM GGX filter shader triggers a harmless HLSL precision note (X4122) on ANGLE/D3D11, which three
    // logs as a console warning. Its programs are compiled + used synchronously inside fromScene(), so skip the
    // info-log check just for this bake.
    const check = renderer.debug.checkShaderErrors;
    renderer.debug.checkShaderErrors = false;
    const rt = pmrem.fromScene(envScene, 0.02);
    renderer.debug.checkShaderErrors = check;
    scene.environment = rt.texture;
    scene.environmentIntensity = 0.55;
    pmrem.dispose();
    envScene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }

  // --- post: render -> bloom -> output (tone mapping + sRGB) ---
  const rtSize = new THREE.Vector2();
  const composerRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: QUALITY.high.samples });
  const composer = new EffectComposer(renderer, composerRT);
  const renderPass = new RenderPass(scene, camera);
  // threshold sits above sun-lit white (~2.2 linear) so only emissive things (lasers, balloons, flashes) glow
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.75, 0.55, 2.3);
  const outputPass = new OutputPass();
  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(outputPass);

  // --- CSS2D overlay for nameplates ---
  const labelRenderer = new CSS2DRenderer();
  const ls = labelRenderer.domElement.style;
  ls.position = 'absolute';
  ls.left = '0';
  ls.top = '0';
  ls.pointerEvents = 'none';
  ls.overflow = 'hidden';
  container.appendChild(labelRenderer.domElement);

  let quality = 'high';
  let q = QUALITY.high;

  function size() {
    if (container && container !== document.body) {
      const r = container.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return [Math.round(r.width), Math.round(r.height)];
    }
    return [window.innerWidth, window.innerHeight];
  }

  function resize() {
    const [w, h] = size();
    const dpr = Math.min(window.devicePixelRatio || 1, q.maxDpr);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, true);
    composer.setPixelRatio(dpr);
    composer.setSize(w, h);
    renderer.getDrawingBufferSize(rtSize);
    // bloom at half resolution is plenty and much cheaper
    bloom.setSize(Math.max(1, Math.round(rtSize.x / 2)), Math.max(1, Math.round(rtSize.y / 2)));
    labelRenderer.setSize(w, h);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }

  function setQuality(level) {
    if (!QUALITY[level]) level = 'high';
    const prevShadows = q.shadows;
    quality = level;
    q = QUALITY[level];
    renderer.shadowMap.enabled = q.shadows;
    sun.castShadow = q.shadows;
    if (sun.shadow.mapSize.x !== q.shadowMap) {
      sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
      if (sun.shadow.map) {
        sun.shadow.map.dispose();
        sun.shadow.map = null;
      }
    }
    for (const rt of [composer.renderTarget1, composer.renderTarget2]) {
      if (rt.samples !== q.samples) {
        rt.samples = q.samples;
        rt.dispose(); // re-allocated with the new sample count on next use
      }
    }
    if (prevShadows !== q.shadows) {
      scene.traverse((o) => {
        if (!o.material) return;
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of ms) m.needsUpdate = true;
      });
    }
    resize();
  }

  function render() {
    if (q.bloom) composer.render();
    else renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  }

  window.addEventListener('resize', resize);
  resize();

  return {
    renderer,
    scene,
    camera,
    labelRenderer,
    composer,
    bloom,
    sun,
    render,
    resize,
    setQuality,
    get quality() {
      return quality;
    },
  };
}
