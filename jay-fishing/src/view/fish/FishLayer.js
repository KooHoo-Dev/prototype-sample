// OWNER: P6 — 계약 §6.9 · §9.8 · §9.10
// 파이팅 물고기: 수면의 그림자(데칼 — 불투명도로 깊이를 말한다) · 질주 V자 물결 · 예고(꼬리침 · 상승 · 옅어짐) · 박힘 흙탕 ·
// 점프(lod 1 모델이 수면 위로) · 뜰채 속 모델. 위치 = origin + fwd(bearing) × dist(보간) — 판정과 같은 점(§9.10).
// 모델은 어종마다 한 번 만들어 풀에 둔다(지오메트리는 fishModel 캐시) — 판을 반복해도 늘지 않는다.

import * as THREE from 'three';
import { EV } from '../../core/events.js';
import { angleDiff, clamp, clamp01, lerp, smoothstep, yawOf } from '../../core/math.js';
import { getSpecies } from '../../data/species/index.js';
import { buildFishModel, disposeFishModel } from './fishModel.js';
import { fishInNet, fishPoint, netPose } from '../tackle/netPose.js';

// ── 연출 상수(§9.8 의 값은 계약 그대로)

const SHADOW_Y = 0.012;                   // 수면 바로 위 데칼(물 셰이더에 가려지지 않게)
const SHADOW_W = 0.35;                    // 폭 = 0.35 × 길이
const OPACITY_MAX = 0.55;
const OPACITY_MIN = 0.15;
const OPACITY_MIN_TELE = 0.35;
const DEPTH_FADE = 8;                     // 불투명도 = clamp(0.55 × (1 − depth / 8), …)
const CHARGE_OPACITY = 0.1;
const JUMP_TELE_GROW = 0.35;              // 점프 예고: 커진다
const RUN_WAG = 0.55;                     // 질주 예고: 꼬리침(rad)
const RUN_WAG_HZ = 7;
const SWIM_WAG = 0.18;
const SWIM_WAG_HZ = 2.2;
const COVER_AT = 0.5;
const COVER_FADE = 0.45;
const WAKE_OPACITY = 0.6;
const FADE_IN = 0.3;
const FADE_OUT = 0.6;
const ESCAPE_SPEED = 1.5;                 // 실패 뒤 그림자가 달아나는 속도(m/s)
const TREMBLE_AMP = 0.03;
const SPIN_RATE = 2.4;
const HEADING_SPEED_MIN = 0.25;
const AIR_BASE = 0.3;                     // 점프 높이 = airborne × (0.3 + 0.5 × lengthM)
const AIR_PER_LEN = 0.5;
const SHADOW_COLOR = new THREE.Color('#04121a');
const GLOW_TMP = new THREE.Color();
const VIS_REF = 10;                       // 먼 그림자 · 물결의 읽힘 배율 = clamp(dist / 10, 1, 3.5) — 위치(중심)는 판정 그대로
const VIS_MAX = 3.5;
const SURFACE_DEPTH = 0.35;               // 이보다 얕으면 등이 수면을 가른다(점프 예고 · 지친 물고기)
const FORE_ELEV = 0.42;                   // 화면 패스: 그림자 단축 보정 — 수면 데칼을 sin(약 25°) 높이에서 내려다본 만큼 시선 방향으로 늘린다
const FORE_MAX = 4;                       //   상한(35m 에서 4배). 16m 에서 약 2.8배 — 전에는 16m 그림자가 세로 2px 짜리 선이었다. 중심은 판정 그대로
const WAKE_FORE_MAX = 1.6;                //   V자 물결은 덜 늘린다(넓게 벌어져 4배면 수면을 덮는 흰 갈매기 모양이 된다)
const MUD_COLOR = '#4a3a22';

/** 그림자 불투명도(§9.8) @param {number} depth @param {boolean} tele */
export function shadowOpacity(depth, tele) {
  const d = Number.isFinite(depth) ? Math.max(0, depth) : 0;
  return clamp(OPACITY_MAX * (1 - d / DEPTH_FADE), tele ? OPACITY_MIN_TELE : OPACITY_MIN, OPACITY_MAX);
}

/** 부드러운 알파 마스크 DataTexture — kind 'body'(앞이 둥근 물방울) · 'tail'(갈라진 꼬리) · 'blob'(흙탕) */
function maskTexture(kind) {
  const W = 32;
  const H = 64;
  const data = new Uint8Array(W * H * 4);
  for (let j = 0; j < H; j++) {
    const v = (j + 0.5) / H;                 // 0 = 꼬리 쪽 · 1 = 머리 쪽(평면 +y → −Z 회전 후)
    for (let i = 0; i < W; i++) {
      const u = (i + 0.5) / W;
      const x = Math.abs(u - 0.5) * 2;
      let a = 0;
      if (kind === 'body') {
        const half = Math.pow(Math.sin(Math.PI * Math.pow(v, 0.8)), 0.75) * (0.55 + 0.45 * smoothstep(0, 0.6, v));
        a = 1 - smoothstep(half * 0.7, half, x);
      } else if (kind === 'tail') {
        const fork = 0.25 + 0.75 * v;
        const notch = v < 0.45 ? smoothstep(0.0, 0.35, x) : 1;
        a = (1 - smoothstep(fork * 0.75, fork, x)) * notch * smoothstep(0, 0.15, v);
      } else {
        const dx = u - 0.5;
        const dy = (v - 0.5) * 0.5;
        const r = Math.sqrt(dx * dx + dy * dy) * 2;
        const wob = 0.85 + 0.15 * Math.sin(Math.atan2(dy, dx) * 5);
        a = 1 - smoothstep(0.55 * wob, 0.95 * wob, r);
      }
      const o = (j * W + i) * 4;
      data[o] = 255; data[o + 1] = 255; data[o + 2] = 255;
      data[o + 3] = Math.round(clamp01(a) * 255);
    }
  }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** V자 물결(머리에서 뒤로 벌어지는 두 띠) — 길이 1 · 원점 = 머리 */
function wakeGeometry() {
  const pos = [];
  const idx = [];
  const spread = 0.42;
  const w = 0.05;
  for (const side of [-1, 1]) {
    const base = pos.length / 3;
    const ex = side * Math.sin(spread);
    const ez = Math.cos(spread);
    pos.push(0, 0, 0, side * w, 0, 0, ex, 0, ez, ex + side * w * 2, 0, ez);
    if (side < 0) idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    else idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export class FishLayer {
  /** @param {{rc:import('../renderer.js').RenderContext, bus:Object, settings:Object, world:Object}} deps */
  constructor({ rc, bus, settings, world }) {
    this.rc = rc;
    this.bus = bus;
    this.settings = settings;
    this.world = world;
    this.time = 0;
    this.root = new THREE.Group();
    this.root.name = 'fishRoot';
    rc.scene.add(this.root);

    this._tex = { body: maskTexture('body'), tail: maskTexture('tail'), blob: maskTexture('blob') };
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.rotateX(-Math.PI / 2);
    this._plane = plane;
    const mat = (map, color) => new THREE.MeshBasicMaterial({ map, color, transparent: true, depthWrite: false, opacity: 0.5 });
    this._shadowMat = mat(this._tex.body, SHADOW_COLOR);
    this._tailMat = mat(this._tex.tail, SHADOW_COLOR);
    this._mudMat = mat(this._tex.blob, MUD_COLOR);
    this._wakeGeo = wakeGeometry();
    this._wakeMat = new THREE.MeshBasicMaterial({ color: '#e8f4f6', transparent: true, depthWrite: false, opacity: WAKE_OPACITY, side: THREE.DoubleSide });

    // 그림자 묶음: shadow(위치 · 방향) → body · tailPivot → tail
    const shadow = new THREE.Group();
    shadow.name = 'fishShadow';
    // 화면 패스: 행렬은 _shadowMatrix 가 만든다(위치 · 방향 + 시선 방향 단축 보정) — position · rotation.y 는 그대로 읽힌다
    shadow.matrixAutoUpdate = false;
    const body = new THREE.Mesh(plane, this._shadowMat);
    body.renderOrder = 2;
    shadow.add(body);
    const tailPivot = new THREE.Group();
    shadow.add(tailPivot);
    const tail = new THREE.Mesh(plane, this._tailMat);
    tail.renderOrder = 2;
    tailPivot.add(tail);
    const mud = new THREE.Mesh(plane, this._mudMat);
    mud.renderOrder = 1;
    shadow.add(mud);
    // V자 물결은 그림자의 단축 보정(늘림)을 따르지 않게 형제로 둔다(_wakeMatrix)
    const wake = new THREE.Mesh(this._wakeGeo, this._wakeMat);
    wake.name = 'fishWake';
    wake.renderOrder = 3;
    wake.matrixAutoUpdate = false;
    wake.visible = false;
    shadow.visible = false;
    this.root.add(shadow);
    this.root.add(wake);
    this._shadow = shadow;
    this._body = body;
    this._tailPivot = tailPivot;
    this._tail = tail;
    this._mud = mud;
    this._wake = wake;

    /** @type {Map<string, THREE.Group>} lod 1 모델 풀(어종마다 하나) */
    this._pool = new Map();
    /** @type {THREE.Group|null} */
    this._model = null;
    this._modelId = '';

    this._mode = 'none';                   // none · fight · landing · exit
    this._fade = 0;
    this._exitT = 0;
    this._heading = 0;
    this._lenM = 0.3;
    this._glow = /** @type {string|null} */ (null);
    this._traits = /** @type {string[]} */ ([]);
    this._spin = 0;
    this._tmp = { p: new THREE.Vector3(), prev: new THREE.Vector3(), q: new THREE.Vector3() };
    this._havePrev = false;
    this._pose = { hand: new THREE.Vector3(), dir: new THREE.Vector3(), hoop: new THREE.Vector3(), target: new THREE.Vector3(), handleLen: 1, reach: 1, p: 0 };
    this._exitOpacity = 0;
    /** 실패 순간의 V자 물결 불투명도(0 = 그때 보이지 않았다) — 퇴장 동안 그림자와 같이 옅어진다 */
    this._exitWake = 0;
    this._mtx = { a: new THREE.Matrix4(), b: new THREE.Matrix4() };
    this._viewYaw = 0;
    this._wakeL = 0;
    this._wakeLen = 1;
    /** 마지막 단축 보정 배율(테스트 · 디버그) */
    this.foreshorten = 1;

    const on = (name, fn) => (bus && typeof bus.on === 'function' ? bus.on(name, fn) : () => {});
    this._offs = [
      on(EV.SCENE_CHANGED, () => this._clear()),
      on(EV.HOOK_SET, () => { this._fade = 0; this._havePrev = false; }),
      on(EV.CATCH_RESULT, () => this._clear()),
      on(EV.FAIL, () => this._startExit()),
    ];
  }

  _clear() {
    this._mode = 'none';
    this._shadow.visible = false;
    this._wake.visible = false;
    if (this._model) this._model.visible = false;
    this._havePrev = false;
  }

  _startExit() {
    if (this._mode !== 'fight') {
      this._clear();
      return;
    }
    this._mode = 'exit';
    this._exitT = 0;
    this._exitOpacity = this._shadowMat.opacity;
    this._exitWake = this._wake.visible ? this._wakeMat.opacity : 0;
    if (this._model) this._model.visible = false;
  }

  /** 풀에서 그 어종의 lod 1 모델 @param {string} speciesId @param {number} lenM */
  _useModel(speciesId, lenM) {
    if (this._modelId !== speciesId) {
      if (this._model) this._model.visible = false;
      let m = this._pool.get(speciesId);
      if (!m) {
        const sp = getSpecies(speciesId);
        if (!sp) return null;
        m = buildFishModel(sp, 1, { lod: 1 });
        m.visible = false;
        this.root.add(m);
        this._pool.set(speciesId, m);
      }
      this._model = m;
      this._modelId = speciesId;
    }
    if (this._model) this._model.scale.setScalar(Math.max(0.05, lenM));
    return this._model;
  }

  /**
   * 그림자 행렬 = T(위치) · R(시선 yaw) · S(1, 1, k) · R(방향 − 시선 yaw).
   * 화면 패스: 낮은 시선각에서 납작해지는 수면 데칼을 시선 방향으로만 늘린다(k = clamp(FORE_ELEV / sin(내려다보는 각), 1, FORE_MAX)) —
   * 중심 · 방향은 그대로라 판정 위치와 같고(§9.10), 위에서 내려다본 듯한 모양이 된다. 가까우면 k = 1(그대로).
   */
  _shadowMatrix() {
    const sh = this._shadow;
    const cam = this.rc.camera.position;
    const dx = sh.position.x - cam.x;
    const dz = sh.position.z - cam.z;
    const horiz = Math.max(0.5, Math.hypot(dx, dz));
    const sinDep = Math.max(1e-3, Math.sin(Math.atan2(Math.max(0.1, cam.y - sh.position.y), horiz)));
    const k = clamp(FORE_ELEV / sinDep, 1, FORE_MAX);
    const viewYaw = yawOf(dx, dz);
    const m = this._mtx;
    m.a.makeRotationY(viewYaw);
    m.b.makeScale(1, 1, k);
    m.a.multiply(m.b);
    m.b.makeRotationY(sh.rotation.y - viewYaw);
    m.a.multiply(m.b);
    m.a.setPosition(sh.position);
    sh.matrix.copy(m.a);
    sh.matrixWorldNeedsUpdate = true;
    this.foreshorten = k;
    this._viewYaw = viewYaw;
  }

  /** V자 물결 행렬 — 머리 앞쪽(0.45 L)에서 뒤로 벌어진다 · 시선 방향 늘림은 WAKE_FORE_MAX 까지 */
  _wakeMatrix() {
    const sh = this._shadow;
    const w = this._wake;
    const h = sh.rotation.y;
    const m = this._mtx;
    const kw = clamp(this.foreshorten, 1, WAKE_FORE_MAX);
    m.a.makeRotationY(this._viewYaw);
    m.b.makeScale(1, 1, kw);
    m.a.multiply(m.b);
    m.b.makeRotationY(h - this._viewYaw);
    m.a.multiply(m.b);
    m.b.makeScale(this._wakeLen, 1, this._wakeLen);
    m.a.multiply(m.b);
    m.a.setPosition(sh.position.x - Math.sin(h) * 0.45 * this._wakeL, sh.position.y + 0.004, sh.position.z - Math.cos(h) * 0.45 * this._wakeL);
    w.matrix.copy(m.a);
    w.matrixWorldNeedsUpdate = true;
  }

  /** @param {Object} state @param {number} alpha @param {number} dt */
  update(state, alpha, dt) {
    if (!state || !state.rig) return;
    const fdt = Number.isFinite(dt) ? clamp(dt, 0, 0.25) : 0;
    this.time += fdt;
    const rig = state.rig;
    const fight = state.fight;
    const phase = rig.phase;
    const a = clamp01(Number.isFinite(alpha) ? alpha : 1);

    // 모드(이벤트를 놓쳐도 상태로 맞춘다)
    if (fight && phase === 'fighting') {
      if (this._mode !== 'fight') {
        this._mode = 'fight';
        this._fade = 0;
        this._havePrev = false;
      }
    } else if (fight && phase === 'landing') {
      this._mode = 'landing';
    } else if (this._mode === 'fight' && phase === 'failed') {
      this._startExit();
    } else if (this._mode !== 'exit') {
      if (this._mode !== 'none') this._clear();
    }

    if (this._mode === 'none') return;

    if (this._mode === 'exit') {
      // 끊긴 물고기: 그림자가 옅어지며 달아난다 · V자 물결은 실패 순간에 보이던 것만 같은 비율로 옅어진다
      this._exitT += fdt;
      const k = clamp01(this._exitT / FADE_OUT);
      this._shadow.position.x += -Math.sin(this._heading) * ESCAPE_SPEED * fdt;
      this._shadow.position.z += -Math.cos(this._heading) * ESCAPE_SPEED * fdt;
      this._shadowMatrix();
      this._wakeMatrix();
      this._shadowMat.opacity = this._exitOpacity * (1 - k);
      this._tailMat.opacity = this._shadowMat.opacity;
      this._tailPivot.rotation.y = 0.6 * Math.sin(this.time * Math.PI * 2 * 6);
      this._wakeMat.opacity = this._exitWake * (1 - k);
      this._wake.visible = this._exitWake > 0;
      this._mud.visible = false;
      if (k >= 1) this._clear();
      return;
    }

    if (!fight) return;
    const sp = getSpecies(fight.speciesId);
    const lenM = fight.roll && fight.roll.lengthCm > 0 ? fight.roll.lengthCm / 100 : sp ? sp.medianCm / 100 : 0.3;
    this._lenM = lenM;
    this._traits = Array.isArray(fight.traits) ? fight.traits : [];
    const glow = sp && sp.look && sp.look.glow ? sp.look.glow : null;
    const night = !!(state.clock && state.clock.night) || !!(state.env && state.env.headlamp);

    if (this._mode === 'landing') {
      // 뜰채 속 모델(그림자 대신)
      this._shadow.visible = false;
      this._wake.visible = false;
      const model = this._useModel(fight.speciesId, lenM);
      if (!model) return;
      this.rc.camera.updateMatrixWorld(true);
      const pose = netPose(this.rc.camera, state, a, this._pose);
      fishInNet(pose, model.position);
      model.rotation.set(0.25 * Math.sin(this.time * 9), this._heading + 0.3 * Math.sin(this.time * 3), 0.5 * Math.sin(this.time * 11));
      model.visible = true;
      return;
    }

    // ── 파이팅: 위치 · 방향
    const P = this._tmp.p;
    fishPoint(state, a, P);
    // 기본 방향: 낚시꾼에게서 멀어지는 쪽(끌려오며 버틴다) · 돌진은 다가오는 쪽. 움직이면 움직이는 쪽
    const rest = fight.behavior === 'charge' ? fight.bearing + Math.PI : fight.bearing;
    if (!this._havePrev) {
      this._heading = rest;
      this._tmp.prev.copy(P);
      this._havePrev = true;
    } else if (fdt > 0) {
      const vx = (P.x - this._tmp.prev.x) / fdt;
      const vz = (P.z - this._tmp.prev.z) / fdt;
      const moving = Math.hypot(vx, vz) > HEADING_SPEED_MIN;
      const want = moving ? yawOf(vx, vz) : rest;
      this._heading += angleDiff(this._heading, want) * clamp01(fdt * (moving ? 6 : 2));
      this._tmp.prev.copy(P);
    }
    let heading = this._heading;
    if (this._traits.includes('spin')) {
      this._spin += SPIN_RATE * fdt;
      heading += this._spin;
    }

    // ── 점프: lod 1 모델이 수면 위로(옆으로 몸을 틀어 넓게 보인다) · 얕으면 등이 수면을 가른다
    const air = clamp01(fight.airborne || 0);
    const depth = Math.max(0, Number.isFinite(fight.depth) ? fight.depth : 0);
    const model = this._useModel(fight.speciesId, lenM);
    const bodyH = sp && sp.look ? sp.look.depth * lenM : 0.25 * lenM;
    if (model) {
      if (air > 0) {
        model.visible = true;
        model.position.set(P.x, air * (AIR_BASE + AIR_PER_LEN * lenM), P.z);
        const phase01 = fight.behaviorDur > 0 ? clamp01(fight.behaviorT / fight.behaviorDur) : 0.5;
        const side = angleDiff(fight.bearing, heading) >= 0 ? 1 : -1;
        model.rotation.set(lerp(0.8, -0.8, phase01), fight.bearing + side * Math.PI / 2, 0.6 * Math.sin(this.time * 13) * air);
      } else if (depth < SURFACE_DEPTH) {
        model.visible = true;
        model.position.set(P.x, bodyH * 0.35 - depth, P.z);
        model.rotation.set(0.05 * Math.sin(this.time * 5), heading + 0.15 * Math.sin(this.time * Math.PI * 2 * SWIM_WAG_HZ), 0.06 * Math.sin(this.time * 4));
      } else {
        model.visible = false;
      }
    }

    // ── 그림자
    this._fade = Math.min(1, this._fade + fdt / FADE_IN);
    const tele = fight.telegraph;
    const teleK = tele && tele.total > 0 ? clamp01(1 - tele.remaining / tele.total) : tele ? 1 : 0;
    let opacity = shadowOpacity(fight.depth, !!tele);
    let grow = 1;
    let wag = SWIM_WAG * Math.sin(this.time * Math.PI * 2 * SWIM_WAG_HZ);
    let surge = 0;
    if (tele) {
      if (tele.kind === 'jump') {
        opacity = lerp(opacity, OPACITY_MAX, teleK);
        grow = 1 + JUMP_TELE_GROW * teleK;
      } else if (tele.kind === 'run' || tele.kind === 'dive') {
        wag = RUN_WAG * Math.sin(this.time * Math.PI * 2 * RUN_WAG_HZ);
        surge = 0.06 * lenM * Math.sin(this.time * Math.PI * 2 * RUN_WAG_HZ * 0.5);
      } else if (tele.kind === 'charge') {
        opacity = lerp(opacity, CHARGE_OPACITY, teleK);
      }
    } else if (fight.behavior === 'charge') {
      opacity = Math.min(opacity, lerp(OPACITY_MAX, CHARGE_OPACITY, 0.7));
    }
    const cover = clamp01(((fight.inCover || 0) - COVER_AT) / (1 - COVER_AT));
    const covered = (fight.inCover || 0) >= COVER_AT;
    if (covered) {
      opacity *= COVER_FADE;
      grow *= 0.9;
    }
    if (air > 0.05) opacity *= 0.35;
    opacity *= this._fade;

    let jx = 0;
    let jz = 0;
    if (this._traits.includes('tremble')) {
      jx = TREMBLE_AMP * lenM * Math.sin(this.time * 71);
      jz = TREMBLE_AMP * lenM * Math.sin(this.time * 53 + 1);
    }
    const fx = -Math.sin(heading);
    const fz = -Math.cos(heading);
    this._shadow.position.set(P.x + jx + fx * surge, SHADOW_Y, P.z + jz + fz * surge);
    this._shadow.rotation.y = heading;
    this._shadowMatrix();
    const dist = Math.hypot(P.x - rig.origin.x, P.z - rig.origin.z);
    const vis = clamp(dist / VIS_REF, 1, VIS_MAX);
    const L = lenM * grow * vis;
    // 몸(앞 0.78) + 꼬리(뒤 0.3) — 합쳐 길이 ≈ lengthM
    this._body.scale.set(SHADOW_W * L, 1, 0.78 * L);
    this._body.position.set(0, 0, -0.11 * L);
    this._tailPivot.position.set(0, 0, 0.27 * L);
    this._tailPivot.rotation.y = wag;
    this._tail.scale.set(0.3 * L, 1, 0.24 * L);
    this._tail.position.set(0, 0, 0.1 * L);

    // 판타지 발광: 밤에는 그림자 대신 희미한 빛
    const glowing = !!(glow && night);
    if (glowing !== (this._glow !== null)) {
      const blend = glowing ? THREE.AdditiveBlending : THREE.NormalBlending;
      this._shadowMat.blending = blend;
      this._tailMat.blending = blend;
      this._shadowMat.needsUpdate = true;
      this._tailMat.needsUpdate = true;
    }
    if (glowing) {
      if (this._glow !== glow) GLOW_TMP.set(/** @type {string} */ (glow));
      this._glow = glow;
      this._shadowMat.color.copy(GLOW_TMP);
      this._tailMat.color.copy(GLOW_TMP);
      opacity = Math.max(opacity, 0.35) * 0.9 * this._fade;
    } else {
      this._glow = null;
      this._shadowMat.color.copy(SHADOW_COLOR);
      this._tailMat.color.copy(SHADOW_COLOR);
    }
    this._shadowMat.opacity = opacity;
    this._tailMat.opacity = opacity;

    // 박힘: 흙탕 얼룩
    this._mud.visible = covered;
    if (covered) {
      this._mud.scale.set(1.6 * L + 0.4, 1, 1.4 * L + 0.4);
      this._mudMat.opacity = 0.32 + 0.1 * cover;
    }

    // V자 물결: 질주 · 잠수 중(입수점 뒤) · 예고 중(그림자 위 수면에 작게)
    const running = fight.behavior === 'run' || fight.behavior === 'dive' || fight.slipping;
    const telling = !!tele && tele.kind !== 'charge';
    this._wake.visible = (running || telling) && air < 0.05;
    if (this._wake.visible) {
      const wl = (running ? 1.8 * lenM + 0.6 : 0.8 * lenM + 0.2) * vis;
      this._wakeL = L;
      this._wakeLen = wl;
      this._wakeMatrix();
      this._wakeMat.opacity = running ? WAKE_OPACITY * this._fade : WAKE_OPACITY * (0.5 + 0.5 * Math.sin(this.time * 12)) * this._fade;
    }
    this._shadow.visible = true;
  }

  dispose() {
    for (const off of this._offs) off();
    this._offs = [];
    for (const m of this._pool.values()) disposeFishModel(m);
    this._pool.clear();
    this._model = null;
    this.rc.scene.remove(this.root);
    this._plane.dispose();
    this._wakeGeo.dispose();
    for (const t of Object.values(this._tex)) t.dispose();
    for (const m of [this._shadowMat, this._tailMat, this._mudMat, this._wakeMat]) m.dispose();
  }
}
