// OWNER: P5 — 계약 §6.9 · §9.2 · §9.11
// 렌더러: sRGB 출력 · ACESFilmic · 노출 1.0 · PCF 그림자(QUALITY[q].shadows) · 픽셀 비율 = min(devicePixelRatio, QUALITY[q].pixelRatio ≤ 2)
//   · 후처리 없음 · 캔버스 크기의 주인(window resize 구독) · prewarm = 지금 장면의 셰이더 미리 컴파일.
// 물 반사 · 안개 입자 · 빗방울 수는 레이어(WorldLayer)가 rc.quality 를 보고 바꾼다.

import * as THREE from 'three';
import { QUALITY } from '../data/settings.js';

const NEAR = 0.05;
const FAR = 2500;
const MAX_PIXEL_RATIO = 2;

/** @typedef {Object} RenderContext
 * @property {THREE.WebGLRenderer} renderer
 * @property {THREE.Scene} scene
 * @property {THREE.PerspectiveCamera} camera
 * @property {'low'|'medium'|'high'} quality
 * @property {(q:'low'|'medium'|'high') => void} setQuality
 * @property {() => void} render
 * @property {() => void} prewarm
 * @property {() => void} dispose
 */

/**
 * WebGL 을 못 만들면 throw(app 이 받아 안내).
 * @param {HTMLCanvasElement} canvas @param {import('../types.js').Settings} settings @returns {RenderContext}
 */
export function createRenderContext(canvas, settings) {
  const quality = settings && settings.quality in QUALITY ? settings.quality : 'medium';
  // 생성 실패는 three 가 던진다(컨텍스트 없음) — 그대로 위로 보낸다
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality !== 'low', powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.enabled = QUALITY[quality].shadows;

  const scene = new THREE.Scene();
  const fov = settings && Number.isFinite(settings.fov) ? settings.fov : 70;
  const camera = new THREE.PerspectiveCamera(fov, 1, NEAR, FAR);
  camera.rotation.order = 'YXZ';
  scene.add(camera);   // 1인칭 로드(viewModel — P6)가 카메라의 자식으로 그려지게

  let disposed = false;
  /** @type {RenderContext} */
  const rc = {
    renderer,
    scene,
    camera,
    quality,
    setQuality(q) {
      if (!(q in QUALITY)) return;
      const prevShadows = renderer.shadowMap.enabled;
      rc.quality = q;
      renderer.shadowMap.enabled = QUALITY[q].shadows;
      if (prevShadows !== renderer.shadowMap.enabled) {
        // 그림자 켬/끔은 재질 프로그램을 바꾼다
        scene.traverse((o) => {
          const m = /** @type {any} */ (o).material;
          if (Array.isArray(m)) for (const mm of m) mm.needsUpdate = true;
          else if (m) m.needsUpdate = true;
        });
      }
      resize();
    },
    render() {
      if (disposed) return;
      renderer.render(scene, camera);
    },
    prewarm() {
      if (disposed) return;
      renderer.compile(scene, camera);
    },
    dispose() {
      disposed = true;
      window.removeEventListener('resize', resize);
      renderer.dispose();
    },
  };

  function resize() {
    if (disposed) return;
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    const pr = Math.min(window.devicePixelRatio || 1, QUALITY[rc.quality].pixelRatio, MAX_PIXEL_RATIO);
    if (renderer.getPixelRatio() !== pr) renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();
  return rc;
}
