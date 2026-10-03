// OWNER: P6 — 계약 §6.9 · §10.2
// UI용 물고기 미리보기 — WebGL 컨텍스트는 이것 하나(결과 패널의 회전 모델 · 도감 포커스 카드 · 도감 카드의 snapshot 이미지).
// WebGL 은 첫 show/snapshot 때 만든다. 실패하면 canvas 는 빈 채 · ok = false · snapshot → ''.
// ok 는 「아직 실패하지 않았다」는 뜻이다 — 생성 직후에는 document 가 있으면 true(첫 사용 때 만들어 보고 실패하면 false).
// 모델은 길이 1로 만들어 화면에 맞춘다(크기는 패널의 숫자가 말한다) · 지오메트리 · 무늬는 어종 캐시(fishModel)를 쓴다.
// 모델은 (어종 · 실루엣)마다 한 번 만들어 _models 에 두고, 바꿀 때는 pivot 에서 떼고 붙이기만 한다(최대 어종 수 × 2) — 재질을 dispose 하면
// three 가 쓰는 곳이 없어진 셰이더 프로그램을 지우고 다음 모델이 같은 프로그램을 다시 링크한다(결과 패널 · 도감 카드마다 멈칫). 정리는 dispose() 에서 한 번.

import * as THREE from 'three';
import { getSpecies } from '../../data/species/index.js';
import { buildFishModel, disposeFishModel } from './fishModel.js';

const DEFAULT_W = 320;
const DEFAULT_H = 200;
const FOV = 26;
const SPIN_RATE = 0.7;                   // rad/s
const BASE_YAW = Math.PI / 2 - 0.32;     // 머리가 왼쪽 · 살짝 3/4 시점
const SNAPSHOT_ASPECT = 0.625;           // snapshot 높이 = size × 0.625 (16:10)
const FIT_MARGIN = 1.12;

export class FishPreview {
  constructor() {
    /** @type {HTMLCanvasElement|null} */
    this.canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    if (this.canvas) {
      this.canvas.className = 'fish-preview';
      this.canvas.width = DEFAULT_W;
      this.canvas.height = DEFAULT_H;
    }
    /** 아직 WebGL 생성에 실패하지 않았다(document 가 없으면 false) */
    this.ok = !!this.canvas;
    /** @type {THREE.WebGLRenderer|null} */
    this._renderer = null;
    /** @type {THREE.Scene|null} */
    this._scene = null;
    /** @type {THREE.PerspectiveCamera|null} */
    this._camera = null;
    /** @type {THREE.Group|null} */
    this._pivot = null;
    /** @type {THREE.Group|null} */
    this._model = null;
    this._modelKey = '';
    /** @type {Map<string, THREE.Group>} (어종 · 실루엣) → 모델 — 바꿀 때 떼고 붙이기만 한다 */
    this._models = new Map();
    this._shown = false;
    this._spin = true;
    this._angle = 0;
    this._w = 0;
    this._h = 0;
    /** @type {Map<string, string>} */
    this._snapCache = new Map();
    this._disposed = false;
  }

  /** WebGL 을 만든다(한 번) @returns {boolean} */
  _ensure() {
    if (this._renderer) return true;
    if (!this.ok || this._disposed || !this.canvas) return false;
    try {
      const r = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
      r.outputColorSpace = THREE.SRGBColorSpace;
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.toneMappingExposure = 1.05;
      r.setClearColor(0x000000, 0);
      r.setPixelRatio(Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2));
      this._renderer = r;
    } catch (e) {
      void e;
      this.ok = false;
      return false;
    }
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xdfeeff, 0x3a3226, 1.35));
    const key = new THREE.DirectionalLight(0xfff4e2, 2.4);
    key.position.set(1.2, 2.2, 2.4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fd0ff, 1.3);
    rim.position.set(-1.5, 0.8, -2.5);
    scene.add(rim);
    const fill = new THREE.DirectionalLight(0xffffff, 0.45);
    fill.position.set(0, -1.5, 1.5);
    scene.add(fill);
    const pivot = new THREE.Group();
    scene.add(pivot);
    this._scene = scene;
    this._pivot = pivot;
    this._camera = new THREE.PerspectiveCamera(FOV, DEFAULT_W / DEFAULT_H, 0.05, 20);
    return true;
  }

  /** 지금 모델을 (어종 · 실루엣)으로 맞춘다 @param {string} speciesId @param {boolean} silhouette */
  _setModel(speciesId, silhouette) {
    const key = `${speciesId}|${silhouette ? 1 : 0}`;
    if (this._model && this._modelKey === key) return this._model;
    if (!this._pivot) return null;
    let m = this._models.get(key);
    if (!m) {
      const sp = getSpecies(speciesId);
      if (!sp) return null;
      m = buildFishModel(sp, 1, { silhouette, lod: 0 });
      m.rotation.y = 0;
      this._models.set(key, m);
    }
    if (this._model) this._pivot.remove(this._model);
    this._pivot.add(m);
    this._model = m;
    this._modelKey = key;
    return m;
  }

  /** 픽셀 비율 = min(devicePixelRatio, 2) — 배율이 다른 모니터로 창을 옮기면(resize 없이 DPR 만 바뀐다) 따라간다 */
  _syncPixelRatio() {
    const r = this._renderer;
    if (!r) return;
    const pr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);
    if (r.getPixelRatio() !== pr) r.setPixelRatio(pr);
  }

  /** 모델이 화면에 들어오도록 카메라를 둔다 @param {number} aspect */
  _frame(aspect) {
    const cam = this._camera;
    const m = this._model;
    if (!cam || !m) return;
    const look = /** @type {any} */ (getSpecies(m.userData.speciesId))?.look;
    const h = (look ? look.depth : 0.3) * 1.55 + 0.08;     // 몸 + 지느러미
    const halfV = Math.tan((FOV * Math.PI) / 360);
    const halfH = halfV * aspect;
    const d = Math.max((0.5 * FIT_MARGIN) / halfH, ((h / 2) * FIT_MARGIN) / halfV) + 0.2;
    cam.aspect = aspect;
    cam.fov = FOV;
    cam.position.set(0, 0.06 * d, d);
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
  }

  /** @param {number} w @param {number} h */
  _resize(w, h) {
    if (!this._renderer) return;
    if (w === this._w && h === this._h) return;
    this._w = w;
    this._h = h;
    this._renderer.setSize(w, h, false);
  }

  /** @param {string} speciesId @param {number} lengthCm @param {{silhouette?:boolean, spin?:boolean}} [opts] */
  show(speciesId, lengthCm, opts = {}) {
    void lengthCm;
    const { silhouette = false, spin = true } = opts;
    if (!this._ensure()) return;
    if (!this._setModel(speciesId, silhouette)) return;
    this._shown = true;
    this._spin = spin;
    this._angle = 0;
    this.render(0);
  }

  hide() {
    this._shown = false;
  }

  /** @param {number} dt */
  render(dt) {
    if (!this._shown || !this._renderer || !this._model || !this._pivot || !this._scene || !this._camera) return;
    const c = /** @type {HTMLCanvasElement} */ (this.canvas);
    const w = c.clientWidth > 0 ? Math.round(c.clientWidth) : DEFAULT_W;
    const h = c.clientHeight > 0 ? Math.round(c.clientHeight) : DEFAULT_H;
    this._syncPixelRatio();
    this._resize(w, h);
    if (this._spin && Number.isFinite(dt)) this._angle = (this._angle + Math.max(0, dt) * SPIN_RATE) % (Math.PI * 2);
    this._pivot.rotation.y = BASE_YAW + this._angle;
    this._pivot.rotation.z = 0.04 * Math.sin(this._angle * 2);
    this._frame(w / h);
    this._renderer.render(this._scene, this._camera);
  }

  /** @param {string} speciesId @param {number} lengthCm @param {{silhouette?:boolean, size?:number}} [opts] @returns {string} dataURL(ok 가 false 면 '') */
  snapshot(speciesId, lengthCm, opts = {}) {
    void lengthCm;
    const { silhouette = false, size = 160 } = opts;
    const key = `${speciesId}|${silhouette ? 1 : 0}`;
    const hit = this._snapCache.get(key);
    if (hit !== undefined) return hit;
    if (!getSpecies(speciesId)) return '';
    if (!this._ensure() || !this._renderer || !this._pivot || !this._scene || !this._camera) return '';
    const r = this._renderer;
    const prevKey = this._modelKey;
    const prevShown = this._shown;
    const prevW = this._w;
    const prevH = this._h;
    const prevRatio = r.getPixelRatio();
    let url = '';
    try {
      const w = Math.max(16, Math.round(size));
      const h = Math.max(10, Math.round(size * SNAPSHOT_ASPECT));
      r.setPixelRatio(1);
      this._w = 0;
      this._resize(w, h);
      this._setModel(speciesId, silhouette);
      this._pivot.rotation.y = BASE_YAW;
      this._pivot.rotation.z = 0;
      this._frame(w / h);
      r.render(this._scene, this._camera);
      url = /** @type {HTMLCanvasElement} */ (r.domElement).toDataURL('image/png');
    } catch (e) {
      void e;
      url = '';
    }
    // 보이던 미리보기로 되돌린다
    r.setPixelRatio(prevRatio);
    this._w = 0;
    if (prevW > 0) this._resize(prevW, prevH);
    if (prevKey && prevKey !== this._modelKey) {
      const [id, sil] = prevKey.split('|');
      this._setModel(id, sil === '1');
    }
    this._shown = prevShown;
    if (prevShown) this.render(0);
    if (url) this._snapCache.set(key, url);
    return url;
  }

  dispose() {
    for (const m of this._models.values()) disposeFishModel(m);
    this._models.clear();
    this._model = null;
    this._modelKey = '';
    this._shown = false;
    this._snapCache.clear();
    if (this._renderer) {
      this._renderer.dispose();
      this._renderer.forceContextLoss();
      this._renderer = null;
    }
    this._scene = null;
    this._disposed = true;
    this.ok = false;
  }
}
