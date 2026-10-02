// OWNER: P5 — 계약 §6.9 · §9.2 · §9.11
// STUB — W0 스텁(§6.14): 실제 WebGLRenderer · Scene · PerspectiveCamera 를 만들고 render 가 그린다(후처리 없음 · resize 구독) · prewarm no-op. P5 가 채운다.

import * as THREE from 'three';
import { QUALITY } from '../data/settings.js';

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
  const quality = settings.quality in QUALITY ? settings.quality : 'medium';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality !== 'low', powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.05, 2500);
  camera.rotation.order = 'YXZ';
  scene.add(camera);

  /** @type {RenderContext} */
  const rc = {
    renderer,
    scene,
    camera,
    quality,
    setQuality(q) {
      if (!(q in QUALITY)) return;
      rc.quality = q;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY[q].pixelRatio));
      renderer.shadowMap.enabled = QUALITY[q].shadows;
      resize();
    },
    render() {
      renderer.render(scene, camera);
    },
    prewarm() {},
    dispose() {
      window.removeEventListener('resize', resize);
      renderer.dispose();
    },
  };

  function resize() {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  rc.setQuality(quality);
  return rc;
}
