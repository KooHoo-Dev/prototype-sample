// OWNER: P7 — 계약 §6.14 · §9.2 · §9.10 · §0.2
// 렌더러 · 장면 · 카메라 · 빛 장치 · 화질 3단계.
//   WebGLRenderer({antialias: quality !== 'low'}) · SRGB · ACESFilmic · 픽셀 비율 = min(devicePixelRatio, QUALITY[q].pixelRatio)(상한 2).
//   빛 = 반구광 + 해(마을만) + 플레이어 머리 위 점광원 + 맵 빛 풀(maxLights − 1 — WorldLayer 가 가까운 빛을 배정).
//   화질: settings 객체(app 이 필드만 바꾼다)의 quality 가 바뀌면 render() 가 setQuality 를 부른다(SETTINGS_CHANGED 를 기다리지 않는다).
//   antialias 는 만들 때만 정해진다(화질을 low ↔ 그 밖으로 바꿔도 다음 부팅부터).
// WebGL 을 만들지 못하면 throw(app 이 잡는다).
// rc 에 계약 밖 필드: lights(LightRig) · quality(지금 화질 ID) · setAtmosphere(tileset) — P7 내부(WorldLayer · CameraRig)만 쓴다.

import * as THREE from 'three';
import { CAM_DISTANCE, CAM_FOV } from '../core/constants.js';
import { QUALITY } from '../data/quality.js';
import { cameraPose } from './CameraRig.js';
import { applyAtmosphere, createLightRig } from './world/lights.js';
import { ATMOS, FOG_K } from './world/style.js';

/** @typedef {import('../types.js').RenderContext} RenderContext */

const NEAR = 0.5, FAR = 220;
const SHADOW_TYPE = THREE.PCFShadowMap;

/**
 * @param {HTMLCanvasElement} canvas @param {import('../types.js').Settings} settings
 * @returns {RenderContext}
 */
export function createRenderContext(canvas, settings) {
  const quality = settings?.quality && QUALITY[settings.quality] ? settings.quality : 'medium';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality !== 'low', powerPreference: 'high-performance' });
  if (!renderer.getContext()) throw new Error('webgl');
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = ATMOS.crypt.exposure;
  renderer.shadowMap.type = SHADOW_TYPE;
  renderer.shadowMap.enabled = false;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(ATMOS.crypt.fog);
  scene.fog = new THREE.FogExp2(ATMOS.crypt.fog, ATMOS.crypt.density * FOG_K);
  scene.userData.fogBase = ATMOS.crypt.density * FOG_K;
  const camera = new THREE.PerspectiveCamera(CAM_FOV, 16 / 9, NEAR, FAR);
  const layers = { world: new THREE.Group(), actors: new THREE.Group(), fx: new THREE.Group() };
  layers.world.name = 'world';
  layers.actors.name = 'actors';
  layers.fx.name = 'fx';
  scene.add(layers.world, layers.actors, layers.fx);
  const lights = createLightRig(scene);

  // 기본 카메라(§0.2 · §9.3): 원점의 플레이어를 본다 — CameraRig 가 매 프레임 옮긴다
  const pose = cameraPose(0, 0, CAM_DISTANCE);
  camera.position.set(pose.px, pose.py, pose.pz);
  camera.lookAt(pose.tx, pose.ty, pose.tz);
  camera.updateMatrixWorld();

  const v3 = new THREE.Vector3();
  const ndc = new THREE.Vector2();
  const ray = new THREE.Raycaster();
  const rayOut = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0 };
  let cssW = 1, cssH = 1;

  /** @type {RenderContext & {lights:any, quality:string, setAtmosphere:(ts:string) => void}} */
  const rc = {
    renderer, scene, camera, layers, lights, quality,
    resize(w, h) {
      cssW = Math.max(1, Math.floor(w) || 1);
      cssH = Math.max(1, Math.floor(h) || 1);
      renderer.setSize(cssW, cssH, false);
      camera.aspect = cssW / cssH;
      camera.updateProjectionMatrix();
    },
    setQuality(q) {
      const id = QUALITY[q] ? q : 'medium';
      const Q = QUALITY[id];
      rc.quality = id;
      const dpr = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
      renderer.setPixelRatio(Math.min(dpr, Q.pixelRatio, 2));
      lights.setPoolSize(Q.maxLights - 1);
      renderer.shadowMap.enabled = !!Q.shadows;
      lights.setShadows(!!Q.shadows);
    },
    setAtmosphere(tileset) {
      applyAtmosphere(rc, tileset);
    },
    render() {
      const want = settings?.quality;
      if (want && want !== rc.quality && QUALITY[want]) rc.setQuality(want);
      renderer.render(scene, camera);
    },
    dispose() {
      lights.dispose();
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
      rayOut.ox = o.x; rayOut.oy = o.y; rayOut.oz = o.z; rayOut.dx = d.x; rayOut.dy = d.y; rayOut.dz = d.z;
      return { ...rayOut };
    },
    groundAt(px, py) {
      const r = rc.rayFromScreen(px, py);
      if (!(r.dy < -1e-6)) return null;
      const t = -r.oy / r.dy;
      const x = r.ox + r.dx * t, z = r.oz + r.dz * t;
      return Number.isFinite(x) && Number.isFinite(z) ? { x, z } : null;
    },
    stats() {
      const i = renderer.info;
      return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs ? i.programs.length : 0 };
    },
  };
  rc.setQuality(quality);
  return rc;
}
