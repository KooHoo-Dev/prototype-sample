// OWNER: P7 — 계약 §6.14 · §9.2 · §0.2
// STUB — W1 에서 P7 이 채운다(화질 3단계 · 톤 · 안개 · 빛 풀 · 그림자). W0: 실제 렌더러 · 장면 · 카메라(fov 40 · 방위 · 앙각 · 거리 24 · 카메라 쪽 앞당김) ·
//   반구광 하나 · project · rayFromScreen · groundAt · stats 는 완성
// WebGL 을 만들지 못하면 throw(app 이 잡는다).

import * as THREE from 'three';
import { CAM_AZIMUTH, CAM_DISTANCE, CAM_ELEVATION, CAM_FOV, CAM_LEAD } from '../core/constants.js';
import { QUALITY } from '../data/quality.js';

/** @typedef {import('../types.js').RenderContext} RenderContext */

const BG = 0x0b0a0d;
const HEMI = { sky: 0xd8dcff, ground: 0x3a3028, intensity: 3.2 };

/**
 * @param {HTMLCanvasElement} canvas @param {import('../types.js').Settings} settings
 * @returns {RenderContext}
 */
export function createRenderContext(canvas, settings) {
  const quality = settings?.quality ?? 'medium';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality !== 'low', powerPreference: 'high-performance' });
  if (!renderer.getContext()) throw new Error('webgl');
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  const camera = new THREE.PerspectiveCamera(CAM_FOV, 16 / 9, 0.5, 200);
  const layers = { world: new THREE.Group(), actors: new THREE.Group(), fx: new THREE.Group() };
  layers.world.name = 'world';
  layers.actors.name = 'actors';
  layers.fx.name = 'fx';
  scene.add(layers.world, layers.actors, layers.fx);
  scene.add(new THREE.HemisphereLight(HEMI.sky, HEMI.ground, HEMI.intensity));

  // 기본 카메라(§0.2 · §9.3): 원점을 본다 — CameraRig 가 매 프레임 옮긴다
  const lead = CAM_LEAD * CAM_DISTANCE;
  const tx = lead * Math.SQRT1_2, tz = lead * Math.SQRT1_2;
  const ce = Math.cos(CAM_ELEVATION);
  camera.position.set(tx + CAM_DISTANCE * Math.sin(CAM_AZIMUTH) * ce, 1 + CAM_DISTANCE * Math.sin(CAM_ELEVATION), tz + CAM_DISTANCE * Math.cos(CAM_AZIMUTH) * ce);
  camera.lookAt(tx, 1, tz);

  const v3 = new THREE.Vector3();
  const ndc = new THREE.Vector2();
  const ray = new THREE.Raycaster();
  let cssW = 1, cssH = 1;

  /** @type {RenderContext} */
  const rc = {
    renderer, scene, camera, layers,
    resize(w, h) {
      cssW = Math.max(1, w);
      cssH = Math.max(1, h);
      renderer.setSize(cssW, cssH, false);
      camera.aspect = cssW / cssH;
      camera.updateProjectionMatrix();
    },
    setQuality(q) {
      const Q = QUALITY[q] ?? QUALITY.medium;
      const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
      renderer.setPixelRatio(Math.min(dpr, Q.pixelRatio));
    },
    render() {
      renderer.render(scene, camera);
    },
    dispose() {
      renderer.dispose();
    },
    project(x, y, z) {
      v3.set(x, y, z).project(camera);
      return { x: ((v3.x + 1) / 2) * cssW, y: ((1 - v3.y) / 2) * cssH, visible: v3.z > -1 && v3.z < 1 };
    },
    rayFromScreen(px, py) {
      ndc.set((px / cssW) * 2 - 1, -(py / cssH) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const o = ray.ray.origin, d = ray.ray.direction;
      return { ox: o.x, oy: o.y, oz: o.z, dx: d.x, dy: d.y, dz: d.z };
    },
    groundAt(px, py) {
      const r = rc.rayFromScreen(px, py);
      if (!(r.dy < -1e-6)) return null;
      const t = -r.oy / r.dy;
      return { x: r.ox + r.dx * t, z: r.oz + r.dz * t };
    },
    stats() {
      const i = renderer.info;
      return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs ? i.programs.length : 0 };
    },
  };
  rc.setQuality(quality);
  return rc;
}
