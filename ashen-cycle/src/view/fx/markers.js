// OWNER: P7 — fx 내부 파일
// 카메라를 보는 표식 셋: 록온 고리 · 그로기 표식(붉은 점 — 처형 가능) · danger 경고 섬광(패링 불가 신호).
// 전부 깊이 검사 없이 그린다(캐릭터에 가려지면 신호를 놓친다).
import * as THREE from 'three';
import { COL, styleColors } from './fxColors.js';

const LOCK_ACQUIRE_DUR = 0.18;
/** 카메라 거리 1m당 표식 반지름(m) — 화면에서 크기가 일정하게 보인다 */
const LOCK_SIZE_PER_M = 0.016;
const GROGGY_SIZE_PER_M = 0.02;
const GROGGY_SIZE_MIN = 0.16;
const GROGGY_SIZE_MAX = 0.5;
const DANGER_DUR = 0.35;
const DANGER_SIZE_PER_M = 0.07;
const DANGER_SIZE_MIN = 0.7;
const DANGER_SIZE_MAX = 1.7;
const STAR_LONG = 1.35;
const STAR_SHORT = 0.62;

/**
 * 깊이 검사 없는 HDR 단색 재질.
 * @param {number|THREE.Color} color @param {number} hdr 색 배율(블룸용) @param {number} opacity
 * @returns {THREE.MeshBasicMaterial}
 */
function overlayMat(color, hdr, opacity) {
  const m = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthTest: false, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
  });
  m.color.multiplyScalar(hdr);
  return m;
}

/** 네 갈래 별(위아래로 길다) — danger 표식은 색뿐 아니라 모양으로도 구분한다. */
function starGeometry(inner) {
  const pts = [0, 0, 0];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    // 짝수 = 가지 끝(위 · 아래는 길고 좌우는 짧다), 홀수 = 가지 사이의 오목한 점
    const r = i % 2 === 1 ? inner : i % 4 === 0 ? STAR_LONG : STAR_SHORT;
    pts.push(Math.sin(a) * r, Math.cos(a) * r, 0);
  }
  const idx = [];
  for (let i = 0; i < 8; i++) idx.push(0, 1 + i, 1 + ((i + 1) % 8));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.setIndex(idx);
  return g;
}

const easeOutBack = (t) => {
  const c = 1.70158;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
};

export class Markers {
  /**
   * @param {THREE.Object3D} parent fxRoot
   * @param {THREE.Camera} camera
   */
  constructor(parent, camera) {
    this.parent = parent;
    this.camera = camera;
    this._disposables = [];
    const track = (o) => { this._disposables.push(o); return o; };

    // 록온: 고리 + 가운데 마름모
    this.lock = new THREE.Group();
    const lockMat = track(overlayMat(0xfff0d6, 1.3, 0.9));
    this.lock.add(
      new THREE.Mesh(track(new THREE.RingGeometry(0.8, 1.0, 40)), lockMat),
      new THREE.Mesh(track(new THREE.RingGeometry(0, 0.2, 4)), lockMat),
    );
    this.lock.renderOrder = 30;
    this.lock.visible = false;
    this._lockT = 0;
    this._lockOn = false;

    // 그로기: 붉은 점 + 맥동하는 고리
    this.groggy = new THREE.Group();
    this._groggyRingMat = track(overlayMat(styleColors('danger').glow, 3, 0.9));
    this._groggyRing = new THREE.Mesh(track(new THREE.RingGeometry(0.82, 1.0, 32)), this._groggyRingMat);
    this.groggy.add(
      new THREE.Mesh(track(new THREE.CircleGeometry(0.5, 24)), track(overlayMat(styleColors('danger').glow, 4, 1))),
      new THREE.Mesh(track(new THREE.CircleGeometry(0.2, 16)), track(overlayMat(styleColors('danger').core, 4, 1))),
      this._groggyRing,
    );
    this.groggy.renderOrder = 30;
    this.groggy.visible = false;
    this._groggyT = 0;
    this._groggyReady = false;

    // danger: 붉은 네 갈래 별 + 밝은 속 별
    this.danger = new THREE.Group();
    this._dangerOuter = track(overlayMat(styleColors('danger').glow, 4, 1));
    this._dangerInner = track(overlayMat(styleColors('danger').core, 4, 1));
    const inner = new THREE.Mesh(track(starGeometry(0.16)), this._dangerInner);
    inner.scale.setScalar(0.5);
    inner.position.z = 0.001;
    this.danger.add(new THREE.Mesh(track(starGeometry(0.22)), this._dangerOuter), inner);
    this.danger.renderOrder = 31;
    this.danger.visible = false;
    this._dangerT = -1;

    for (const g of [this.lock, this.groggy, this.danger]) {
      g.traverse((o) => { o.renderOrder = g.renderOrder; o.frustumCulled = false; });
      parent.add(g);
    }
  }

  /**
   * 록온 표식. 켜지는 순간 크게 나타나 조여든다.
   * @param {boolean} on
   * @param {THREE.Vector3} [pos]
   */
  setLockOn(on, pos) {
    if (on && !this._lockOn) this._lockT = 0;
    this._lockOn = on;
    this.lock.visible = on;
    if (on && pos) this.lock.position.copy(pos);
  }

  /**
   * 그로기 표식.
   * @param {boolean} on
   * @param {THREE.Vector3} [pos]
   * @param {boolean} [ready] 지금 처형할 수 있는가(더 크게 · 빠르게 맥동)
   */
  setGroggy(on, pos, ready = false) {
    this.groggy.visible = on;
    this._groggyReady = ready;
    if (on && pos) this.groggy.position.copy(pos);
  }

  /** danger 경고 섬광을 시작한다(0.35초). 위치는 매 프레임 setDangerPos로 따라간다. */
  flashDanger() {
    this._dangerT = 0;
    this.danger.visible = true;
  }

  get dangerActive() {
    return this._dangerT >= 0;
  }

  /** @param {THREE.Vector3} pos */
  setDangerPos(pos) {
    this.danger.position.copy(pos);
  }

  /** @param {number} dt */
  update(dt) {
    const cam = this.camera;
    if (this.lock.visible) {
      this._lockT += dt;
      const u = Math.min(1, this._lockT / LOCK_ACQUIRE_DUR);
      const d = cam.position.distanceTo(this.lock.position);
      this.lock.quaternion.copy(cam.quaternion);
      this.lock.rotateZ((1 - u) * 1.2);
      this.lock.scale.setScalar(d * LOCK_SIZE_PER_M * (2.4 - 1.4 * u));
    }
    if (this.groggy.visible) {
      this._groggyT += dt;
      const d = cam.position.distanceTo(this.groggy.position);
      const base = Math.min(GROGGY_SIZE_MAX, Math.max(GROGGY_SIZE_MIN, d * GROGGY_SIZE_PER_M));
      const rate = this._groggyReady ? 9 : 4.5;
      const pulse = 0.5 + 0.5 * Math.sin(this._groggyT * rate);
      this.groggy.quaternion.copy(cam.quaternion);
      this.groggy.scale.setScalar(base * (this._groggyReady ? 1.25 : 1));
      this._groggyRing.scale.setScalar(1.1 + 0.5 * pulse);
      this._groggyRingMat.opacity = 0.9 - 0.6 * pulse;
    }
    if (this._dangerT >= 0) {
      this._dangerT += dt;
      const u = this._dangerT / DANGER_DUR;
      if (u >= 1) {
        this._dangerT = -1;
        this.danger.visible = false;
      } else {
        const d = cam.position.distanceTo(this.danger.position);
        const base = Math.min(DANGER_SIZE_MAX, Math.max(DANGER_SIZE_MIN, d * DANGER_SIZE_PER_M));
        const k = u < 0.25 ? easeOutBack(u / 0.25) : 1 + (u - 0.25) * 0.25;
        const op = u < 0.55 ? 1 : 1 - (u - 0.55) / 0.45;
        this.danger.quaternion.copy(cam.quaternion);
        this.danger.scale.setScalar(base * k);
        this._dangerOuter.opacity = op;
        this._dangerInner.opacity = op;
      }
    }
  }

  clear() {
    this.lock.visible = false;
    this._lockOn = false;
    this.groggy.visible = false;
    this.danger.visible = false;
    this._dangerT = -1;
  }

  dispose() {
    this.parent.remove(this.lock, this.groggy, this.danger);
    for (const d of this._disposables) d.dispose();
  }
}
