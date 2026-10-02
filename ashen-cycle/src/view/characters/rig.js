// OWNER: P5 — 계약 §9.5
// 관절 계층 리그 + 빌더 3종(인간형 · 사족 · 부유체). 외부 에셋 0 — 지오메트리 조각을 「관절 × 재질」로 병합한다.
// 관절 축 규약(rest 자세): +X = 캐릭터의 왼쪽, +Y = 위, +Z = 앞. L 관절은 x > 0, R 관절은 x < 0. 무기는 오른손.
// 표준 관절 · 소켓 이름은 §9.5 「표준 관절 이름」 표가 정본이다.
//
// 보스 뷰(P10 · P11)가 알아 둘 것:
//   - 재질은 리그마다 따로 만든다(점멸 · 발광 · 투명도가 리그 단위라서). setGlow는 「강조 재질」(accent)만 바꾼다.
//   - 소켓 weapon은 날의 축이 로컬 +Y다(rest에서 +Z = 앞을 향하게 돌려 둔 상태). weaponBase · weaponTip은 그 자식이고
//     position.y를 옮겨도 된다(무기 길이에 맞춘다). 무기 메시는 sockets.weapon에 붙인다.
//   - 계약 밖의 덤: rig.cape(망토, 있으면 update를 매 프레임) · rig.ikLeftHand(왼손을 자루에 붙이는 2관절 IK) ·
//     rig.setBoost(2페이즈 발광) · rig.setOpacity(사망 소멸).
import * as THREE from 'three';
import { PALETTE } from '../../data/palette.js';
import { PartBuilder, box, cyl, ball, dome, cone, wedge, tubePath, place } from './geo.js';

/** @typedef {import('../../types.js').Pose} Pose */
/** @typedef {import('../../types.js').FxStyle} FxStyle */

/**
 * 점멸이 최대일 때의 emissiveIntensity(선형). 블룸 임계(약 0.9)보다 한참 아래에 둔다.
 * 어두운 재질(발더의 갑옷 — 선형 0.07)에는 선형 0.3의 흰 발광만 더해도 음영이 사라진 「밝은 회색 판」이 된다:
 * 0.12초 동안 자세 · 무기가 안 보이고, 타격 스파크 · 섬광과 겹쳐 대상이 통째로 날아간다.
 * 몸이 "밝아졌다"로 읽히면 충분하다(번쩍임은 fx의 스파크와 점광원이 맡는다).
 */
const FLASH_INTENSITY = 0.18;
/** 점멸이 최대일 때 발광색이 흰색으로 가는 비율(1이면 순백 — 제 색이 조금 남아야 형태가 읽힌다) */
const FLASH_WHITEN = 0.7;
/** setGlow(style, 1)일 때 강조 재질에 더하는 발광 세기. */
const GLOW_GAIN = 3.2;
/** 재질의 기본 자체 발광 세기(제 색 × 이 값) */
const FILL = 0.1;
const PI = Math.PI;
const HALF_PI = Math.PI / 2;

const _c = new THREE.Color();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();
const _footY = [0, 0];

/** @param {number} a @param {number} b @param {number} t */
const mix = (a, b, t) => a + (b - a) * t;
/** @param {number} v @param {number} lo @param {number} hi */
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** 색을 어둡게/밝게 한 16진수. @param {number} hex @param {number} k */
function shade(hex, k) {
  _c.setHex(hex).multiplyScalar(k);
  return _c.getHex();
}

/**
 * fill: 제 색으로 내는 약한 자체 발광 — 어두운 아레나에서도 실루엣이 검게 뭉개지지 않게 한다(블룸 임계 아래).
 * @param {number} color
 * @param {{metal?:number, rough?:number, flat?:boolean, emissive?:number, glow?:number, fill?:number, double?:boolean}} [o]
 */
function stdMat(color, o = {}) {
  const fill = o.emissive === undefined ? o.fill ?? FILL : 0;
  return new THREE.MeshStandardMaterial({
    color,
    metalness: o.metal ?? 0,
    roughness: o.rough ?? 0.9,
    flatShading: !!o.flat,
    emissive: o.emissive ?? (fill > 0 ? color : 0x000000),
    emissiveIntensity: o.emissive === undefined ? (fill > 0 ? fill : 1) : o.glow ?? 1,
    side: o.double ? THREE.DoubleSide : THREE.FrontSide,
  });
}

export class Rig {
  constructor() {
    /** 발밑(지면) 원점. 위치 · rotation.y는 CharacterLayer가 넣는다 */
    this.root = new THREE.Group();
    /** @type {Record<string, THREE.Object3D>} 표준 관절 이름 → 관절 */
    this.joints = {};
    /** @type {Record<string, THREE.Object3D>} 부착점 */
    this.sockets = {};
    /** m */
    this.height = 0;
    /** @type {Cape|null} 망토(있으면 뷰가 매 프레임 update를 부른다) */
    this.cape = null;

    /** @type {string[]} */
    this._names = [];
    /** @type {THREE.Object3D[]} */
    this._list = [];
    /** @type {THREE.Vector3[]} rest 위치 */
    this._rest = [];
    /** @type {{mat:THREE.MeshStandardMaterial, glow:boolean, r:number, g:number, b:number, ei:number}[]} */
    this._mats = [];
    /** @type {THREE.BufferGeometry[]} */
    this._geoms = [];
    this._flash = 0;
    this._glowStyle = 'none';
    this._glowAmt = 0;
    this._boost = 0;
    this._opacity = 1;
    /** 왼팔 IK용 길이(상완 · 전완+손바닥) */
    this._armA = 0;
    this._armB = 0;
    /** 인간형: rest 발목 높이(groundFeet용) */
    this._ankle = 0;
    /** @type {THREE.Object3D[][]|null} [hip, knee, foot] × 2 */
    this._legs = null;
  }

  /**
   * 모든 관절에 적용. 포즈에 없는 관절은 0 회전 / 0 오프셋.
   * @param {Pose} pose
   */
  applyPose(pose) {
    const rot = pose.rot;
    const pos = pose.pos;
    const names = this._names;
    for (let i = 0; i < names.length; i++) {
      const n = names[i];
      const j = this._list[i];
      const r = rot[n];
      if (r) j.rotation.set(r[0], r[1], r[2]);
      else j.rotation.set(0, 0, 0);
      const rest = this._rest[i];
      const p = pos ? pos[n] : undefined;
      if (p) j.position.set(rest.x + p[0], rest.y + p[1], rest.z + p[2]);
      else j.position.copy(rest);
    }
  }

  /** 0..1 피격 점멸(전 재질 emissive를 흰색 쪽으로). @param {number} amount */
  setFlash(amount) {
    const a = clamp(Number.isFinite(amount) ? amount : 0, 0, 1);
    if (a === this._flash) return;
    this._flash = a;
    this._refresh();
  }

  /** 예고 발광(강조 재질만). @param {FxStyle|'none'} style @param {number} intensity 0..1 */
  setGlow(style, intensity) {
    const s = PALETTE.style[style] ? style : 'none';
    const a = s === 'none' ? 0 : clamp(Number.isFinite(intensity) ? intensity : 0, 0, 1);
    if (s === this._glowStyle && a === this._glowAmt) return;
    this._glowStyle = s;
    this._glowAmt = a;
    this._refresh();
  }

  /** 강조 재질의 기본 발광을 (1 + boost)배로(2페이즈). @param {number} boost */
  setBoost(boost) {
    const b = Math.max(0, Number.isFinite(boost) ? boost : 0);
    if (b === this._boost) return;
    this._boost = b;
    this._refresh();
  }

  /** 전 재질 투명도(사망 소멸). 1이면 불투명으로 되돌린다. @param {number} opacity */
  setOpacity(opacity) {
    const a = clamp(Number.isFinite(opacity) ? opacity : 1, 0, 1);
    if (a === this._opacity) return;
    const toggled = (a < 1) !== (this._opacity < 1);
    this._opacity = a;
    for (const e of this._mats) {
      e.mat.opacity = a;
      if (toggled) {
        e.mat.transparent = a < 1;
        e.mat.needsUpdate = true;
      }
    }
  }

  /**
   * 왼팔 2관절 IK — 왼손바닥이 target의 월드 위치에 닿도록 shoulderL · elbowL을 덮어쓴다(양손 무기의 자루).
   * applyPose 뒤에 부른다. 닿지 않으면 팔을 다 뻗는다.
   * @param {THREE.Object3D} target
   * @param {number} [weight] 0..1 (포즈의 팔 ↔ IK)
   * @param {number} [swivel] 어깨→손 축을 중심으로 팔꿈치를 돌리는 각(rad)
   */
  ikLeftHand(target, weight = 1, swivel = 0) {
    const sh = this.joints.shoulderL;
    const el = this.joints.elbowL;
    const hd = this.joints.handL;
    if (!(weight > 0) || !sh || !el || !hd || !target) return;
    const parent = sh.parent;
    parent.updateWorldMatrix(true, false);
    target.updateWorldMatrix(true, false);
    _v1.setFromMatrixPosition(target.matrixWorld);
    parent.worldToLocal(_v1).sub(sh.position);
    const a = this._armA;
    const b = this._armB;
    const dist = _v1.length();
    if (!(dist > 1e-5) || !(a > 0) || !(b > 0)) return;
    const reach = clamp(dist, Math.abs(a - b) + 1e-4, (a + b) * 0.995);
    const bend = PI - Math.acos(clamp((a * a + b * b - reach * reach) / (2 * a * b), -1, 1));
    // 팔꿈치를 bend만큼 굽힌 팔의 「어깨 → 손」 방향(어깨 로컬)을 목표 방향에 맞춘다
    _v2.set(0, -a - b * Math.cos(bend), b * Math.sin(bend)).normalize();
    _v1.divideScalar(dist);
    _q1.setFromUnitVectors(_v2, _v1);
    if (swivel) _q1.premultiply(_q2.setFromAxisAngle(_v1, swivel));
    const w = Math.min(1, weight);
    if (w >= 1) {
      sh.quaternion.copy(_q1);
      el.rotation.set(-bend, 0, 0);
      hd.rotation.set(0, 0, 0);
    } else {
      sh.quaternion.slerp(_q1, w);
      el.rotation.set(mix(el.rotation.x, -bend, w), el.rotation.y * (1 - w), el.rotation.z * (1 - w));
      hd.rotation.set(hd.rotation.x * (1 - w), hd.rotation.y * (1 - w), hd.rotation.z * (1 - w));
    }
  }

  /**
   * 인간형 전용: 낮은 쪽 발목이 rest 높이(= 발바닥이 지면)에 오도록 hips를 위아래로 옮기고, 디딘 발을 수평으로 편다.
   * 포즈 표가 다리 각만 적어도 발이 뜨거나 묻히지 않고, 걷기의 몸 출렁임이 다리 길이에서 저절로 나온다.
   * applyPose 뒤에 부른다. 공중 · 누운 자세에서는 weight 0.
   * @param {number} [weight] 0..1
   */
  groundFeet(weight = 1) {
    const hips = this.joints.hips;
    if (!(weight > 0) || !hips || !this.joints.footL || !this.joints.footR || !(this._ankle > 0)) return;
    if (!this._legs) {
      const j = this.joints;
      this._legs = [[j.hipL, j.kneeL, j.footL], [j.hipR, j.kneeR, j.footR]];
    }
    hips.updateMatrix();
    let minY = Infinity;
    for (let i = 0; i < 2; i++) {
      const leg = this._legs[i];
      leg[0].updateMatrix();
      leg[1].updateMatrix();
      _m1.multiplyMatrices(hips.matrix, leg[0].matrix).multiply(leg[1].matrix);
      _footY[i] = _v1.copy(leg[2].position).applyMatrix4(_m1).y;
      if (_footY[i] < minY) minY = _footY[i];
    }
    const w = Math.min(1, weight);
    hips.position.y += (this._ankle - minY) * w;
    for (let i = 0; i < 2; i++) {
      const leg = this._legs[i];
      const planted = clamp(1 - (_footY[i] - minY) / (this._ankle * 1.6), 0, 1) * w;
      if (planted <= 0) continue;
      const flat = -(hips.rotation.x + leg[0].rotation.x + leg[1].rotation.x);
      leg[2].rotation.x += (flat - leg[2].rotation.x) * planted;
    }
  }

  dispose() {
    for (const g of this._geoms) g.dispose();
    for (const e of this._mats) e.mat.dispose();
    this._geoms.length = 0;
    this._mats.length = 0;
    if (this.cape) this.cape.dispose();
    this.cape = null;
    if (this.root.parent) this.root.parent.remove(this.root);
  }

  // ── 빌더용(패키지 내부) ──

  /** @param {string} name @param {string|null} parent @returns {THREE.Object3D} */
  _joint(name, parent, x, y, z) {
    const j = new THREE.Object3D();
    j.name = name;
    j.position.set(x, y, z);
    (parent ? this.joints[parent] : this.root).add(j);
    this.joints[name] = j;
    this._names.push(name);
    this._list.push(j);
    this._rest.push(new THREE.Vector3(x, y, z));
    return j;
  }

  /** @param {string} name @param {string|THREE.Object3D} parent @returns {THREE.Object3D} */
  _socket(name, parent, x, y, z) {
    const s = new THREE.Object3D();
    s.name = `socket:${name}`;
    s.position.set(x, y, z);
    (typeof parent === 'string' ? this.joints[parent] : parent).add(s);
    this.sockets[name] = s;
    return s;
  }

  /** 재질을 등록한다(점멸 · 발광 · 투명도 · dispose 대상). @template {THREE.MeshStandardMaterial} T @param {T} mat @param {boolean} [glow] @returns {T} */
  _mat(mat, glow = false) {
    this._mats.push({ mat, glow, r: mat.emissive.r, g: mat.emissive.g, b: mat.emissive.b, ei: mat.emissiveIntensity });
    return mat;
  }

  _refresh() {
    const style = PALETTE.style[this._glowStyle];
    const g = style ? this._glowAmt : 0;
    const f = this._flash;
    if (g > 0) _c.setHex(style.glow);
    for (const e of this._mats) {
      let r = e.r;
      let gg = e.g;
      let b = e.b;
      let ei = e.ei;
      if (e.glow) {
        ei *= 1 + this._boost;
        if (g > 0) {
          r = mix(r, _c.r, g);
          gg = mix(gg, _c.g, g);
          b = mix(b, _c.b, g);
          ei += GLOW_GAIN * g;
        }
      }
      if (f > 0) {
        const w = f * FLASH_WHITEN;
        r = mix(r, 1, w);
        gg = mix(gg, 1, w);
        b = mix(b, 1, w);
        // 이미 그보다 밝은 강조 재질(눈 · 문양)은 세기를 내리지 않는다 — 색만 희게
        if (ei < FLASH_INTENSITY) ei = mix(ei, FLASH_INTENSITY, f);
      }
      e.mat.emissive.setRGB(r, gg, b);
      e.mat.emissiveIntensity = ei;
    }
  }
}

// ───────────────────────── 망토 ─────────────────────────

const CAPE_COLS = 6;
const CAPE_ROWS = 7;
/** 등에 닿지 않는 최소 처짐 각 · 최대 날림 각(rad) */
const CAPE_MIN = 0.07;
const CAPE_MAX = 1.35;
/** 찢어진 망토의 열별 길이 비 */
const CAPE_TORN = [0.82, 1.0, 0.66, 0.94, 0.74, 1.0, 0.58];
/** 세로 주름의 깊이(망토 길이에 대한 비) */
const CAPE_PLEAT = 0.022;

/**
 * 등 뒤에 드리운 천. 격자 정점을 매 프레임 다시 놓는다(행마다 처짐 각을 누적 — 뼈가 아니라 곡선 하나).
 * 부모 관절(가슴)의 로컬 공간에서 논다: 몸이 숙으면 등에 붙고, 달리면 뒤로 날린다.
 */
export class Cape {
  /**
   * @param {{parent:THREE.Object3D, material:THREE.Material, width:number, flare:number, length:number,
   *          y:number, z:number, torn?:boolean}} o
   */
  constructor(o) {
    this.width = o.width;
    this.flare = o.flare;
    this.length = o.length;
    this.y0 = o.y;
    this.z0 = o.z;
    this.torn = !!o.torn;
    this.angle = 0.12;
    this.side = 0;
    const nx = CAPE_COLS + 1;
    const ny = CAPE_ROWS + 1;
    this._pos = new Float32Array(nx * ny * 3);
    const index = [];
    for (let j = 0; j < CAPE_ROWS; j++) {
      for (let i = 0; i < CAPE_COLS; i++) {
        const a = j * nx + i;
        const b = a + 1;
        const c = a + nx;
        const d = c + 1;
        index.push(a, c, b, b, c, d);
      }
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this._pos, 3));
    this.geometry.setIndex(index);
    this.mesh = new THREE.Mesh(this.geometry, o.material);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false; // 정점이 매 프레임 바뀐다(경계 구 재계산 대신)
    o.parent.add(this.mesh);
    this._layout(0, 0, 0);
  }

  /**
   * @param {number} dt 초
   * @param {number} time 초(흔들림 위상)
   * @param {number} lean 몸통의 앞 숙임 합(rad, + = 숙임)
   * @param {number} fwd 로컬 전진 속도 비(−1..1.5)
   * @param {number} side 로컬 오른쪽 속도 비
   * @param {number} [gust] 0..1 바람(보스 포효 · 인챈트)
   */
  update(dt, time, lean, fwd, side, gust = 0) {
    // 숙이면 중력이 망토를 등으로 누르고(각 0 근처), 젖히면 등에서 떨어진다
    let hang = -Math.atan2(Math.sin(lean), Math.cos(lean));
    hang += Math.max(0, fwd) * 0.55 + gust * 0.35;
    // 누웠거나 거꾸로일 때(기울기 60° 넘음)는 등에 붙인다 — 바닥을 뚫고 늘어지지 않게
    const target = Math.cos(lean) < 0.5 ? CAPE_MIN : clamp(hang, CAPE_MIN, CAPE_MAX);
    const k = 1 - Math.exp(-9 * Math.max(0, dt));
    this.angle += (target - this.angle) * k;
    this.side += (clamp(side, -1.2, 1.2) - this.side) * k;
    this._layout(time, 0.035 + 0.05 * Math.min(1.5, Math.abs(fwd) + Math.abs(side)) + 0.09 * gust, 1);
  }

  /** @param {number} time @param {number} amp @param {number} live */
  _layout(time, amp, live) {
    const pos = this._pos;
    const nx = CAPE_COLS + 1;
    for (let i = 0; i <= CAPE_COLS; i++) {
      const fx = i / CAPE_COLS - 0.5;
      const seg = (this.length * (this.torn ? CAPE_TORN[i % CAPE_TORN.length] : 1)) / CAPE_ROWS;
      let y = this.y0;
      let z = this.z0;
      for (let j = 0; j <= CAPE_ROWS; j++) {
        const s = j / CAPE_ROWS;
        if (j > 0) {
          const wave = live * amp * 4 * s * Math.sin(time * 5.2 - s * 3.4 + i * 0.85);
          // 아래로 갈수록 더 날린다(끝단이 가볍다) + 가장자리는 살짝 말린다
          const th = this.angle * (0.55 + 0.75 * s) + wave + Math.abs(fx) * 0.12;
          y -= seg * Math.cos(th);
          z -= seg * Math.sin(th);
        }
        const w = this.width * mix(1, this.flare, s);
        const k = (j * nx + i) * 3;
        pos[k] = fx * w + this.side * 0.22 * s * s * this.length + live * amp * 0.5 * s * Math.sin(time * 3.1 + i * 1.3);
        pos[k + 1] = y;
        // 어깨를 감싸는 곡면 + 세로 주름(열마다 앞뒤로 엇갈린다 — 아래로 갈수록 깊다)
        pos[k + 2] = z - Math.abs(fx) * Math.abs(fx) * 0.18 * w + (i % 2 ? 1 : -1) * CAPE_PLEAT * this.length * (0.25 + 0.75 * s);
      }
    }
    this.geometry.getAttribute('position').needsUpdate = true;
    this.geometry.computeVertexNormals();
  }

  dispose() {
    this.geometry.dispose();
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
  }
}

// ───────────────────────── 인간형 ─────────────────────────

/**
 * 갑옷 기사(플레이어 · 발더 · NPC). 치수는 키 1.8m 기준으로 적고 height / 1.8로 키운다.
 * rest 관절 높이(키 1.8 기준, m): hips 0.95 · chest 1.25 · head(목) 1.57 · shoulder 1.485 · elbow 1.185 · hand(손목) 0.915 ·
 *   knee 0.48 · foot(발목) 0.08. 팔 길이(어깨 → 손바닥) 0.645.
 * @param {{height:number, bulk:number, palette:{armor:number, cloth:number, skin:number, accent:number},
 *          helmet:'knight'|'hood'|'none'|'horned', cape:boolean,
 *          heavy?:boolean, accentGlow?:number, apron?:boolean}} opts
 *   계약 밖의 덤(P5 내부): helmet 'horned'(뿔 투구) · heavy(큰 견갑 · 가시 · 털 깃 · 찢어진 망토 — 보스용) ·
 *   accentGlow(강조 재질의 기본 발광 세기 — 0이면 놋쇠 장식, 2 이상이면 블룸에 걸린다) · apron(가죽 앞치마 — 대장장이)
 * @returns {Rig}
 */
export function buildHumanoidRig(opts) {
  const o = opts ?? {};
  const height = o.height > 0 ? o.height : 1.8;
  const w = o.bulk > 0 ? o.bulk : 1;
  const pal = o.palette ?? PALETTE.player;
  const helmet = o.helmet ?? 'knight';
  const heavy = !!o.heavy;
  const accentGlow = o.accentGlow ?? 0;
  const u = height / 1.8;
  const lw = 1 + (w - 1) * 0.6; // 팔다리 굵기는 몸통보다 덜 불린다

  const rig = new Rig();
  rig.height = height;
  rig.root.name = 'rig:humanoid';

  const M = {
    armor: rig._mat(stdMat(pal.armor, { metal: 0.38, rough: 0.46, flat: true, fill: heavy ? 0.2 : 0.14 })),
    dark: rig._mat(stdMat(shade(pal.armor, 0.42), { metal: 0.3, rough: 0.7, flat: true, fill: 0.12 })),
    cloth: rig._mat(stdMat(pal.cloth, { rough: 0.95 })),
    leather: rig._mat(stdMat(shade(pal.cloth, 1.35), { rough: 0.72, flat: true })),
    skin: rig._mat(stdMat(pal.skin, { rough: 0.8 })),
    horn: rig._mat(stdMat(shade(pal.armor, heavy ? 0.75 : 0.3), { metal: 0.2, rough: 0.55, flat: true, fill: 0.16 })),
    accent: rig._mat(accentGlow > 0
      ? stdMat(pal.accent, { metal: 0.2, rough: 0.5, emissive: pal.accent, glow: accentGlow })
      : stdMat(pal.accent, { metal: 0.6, rough: 0.35, flat: true, fill: 0.2 }), true),
    voidm: rig._mat(stdMat(0x050506, { rough: 1, fill: 0 })),
    cape: rig._mat(stdMat(shade(pal.cloth, heavy ? 1.5 : 1.9), { rough: 1, double: true, fill: 0.14 })),
  };

  const J = (name, parent, x, y, z) => rig._joint(name, parent, x * u, y * u, z * u);
  J('hips', null, 0, 0.95, 0);
  J('spine', 'hips', 0, 0.10, 0);
  J('chest', 'spine', 0, 0.20, 0);
  J('head', 'chest', 0, 0.32, 0);
  for (const [S, sg] of /** @type {[string, number][]} */ ([['L', 1], ['R', -1]])) {
    J(`shoulder${S}`, 'chest', sg * 0.205 * w, 0.235, 0);
    J(`elbow${S}`, `shoulder${S}`, 0, -0.30, 0);
    J(`hand${S}`, `elbow${S}`, 0, -0.27, 0);
  }
  for (const [S, sg] of /** @type {[string, number][]} */ ([['L', 1], ['R', -1]])) {
    J(`hip${S}`, 'hips', sg * 0.095 * w, -0.05, 0);
    J(`knee${S}`, `hip${S}`, 0, -0.42, 0);
    J(`foot${S}`, `knee${S}`, 0, -0.40, 0);
  }
  rig._armA = 0.30 * u;
  rig._armB = (0.27 + 0.075) * u;
  rig._ankle = 0.08 * u;

  const b = new PartBuilder();
  /** 관절 로컬(키 1.8 기준 치수)로 조각을 붙인다 */
  const A = (joint, mat, geom, px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
    b.add(rig.joints[joint], mat, geom, px * u, py * u, pz * u, rx, ry, rz, sx * u, sy * u, sz * u);

  // ── 골반 · 허리 ──
  A('hips', 'leather', wedge(0.27 * w, 0.17, 0.31 * w, 0.2, 0.16), 0, -0.03, 0);
  A('hips', 'leather', box(0.325 * w, 0.05, 0.215), 0, 0.045, 0);
  A('hips', 'accent', box(0.07, 0.065, 0.03), 0, 0.045, 0.105);
  for (const sg of [1, -1]) {
    A('hips', 'armor', wedge(0.11 * w, 0.02, 0.13 * w, 0.026, 0.21), sg * 0.088 * w, -0.14, 0.102, -0.14, 0, sg * 0.1);
    A('hips', 'armor', wedge(0.02, 0.13, 0.026, 0.16, 0.2), sg * 0.168 * w, -0.12, 0, 0, 0, sg * 0.16);
  }
  A('hips', 'armor', wedge(0.2 * w, 0.02, 0.27 * w, 0.026, 0.17), 0, -0.11, -0.104, 0.14);
  if (o.apron) {
    A('hips', 'leather', box(0.3 * w, 0.52, 0.016), 0, -0.26, 0.118, -0.04);
  } else {
    A('hips', 'cloth', box(0.115 * w, 0.36, 0.014), 0, -0.26, 0.118, -0.05);
    A('hips', 'cloth', box(0.2 * w, 0.4, 0.014), 0, -0.28, -0.118, 0.05);
  }
  if (heavy) {
    // 해진 허리 천 — 길이가 제각각인 조각
    const strips = [[-0.15, 0.44, 0.09], [-0.07, 0.3, 0.112], [0.08, 0.5, 0.108], [0.155, 0.36, 0.08], [0.12, 0.46, -0.1], [-0.12, 0.52, -0.1]];
    for (const [sx, len, sz] of strips) {
      A('hips', 'cloth', wedge(0.035, 0.012, 0.075, 0.012, len), sx * w, -0.08 - len / 2, sz, sz > 0 ? -0.07 : 0.07, 0, sx * 0.3);
    }
  }

  A('spine', 'dark', wedge(0.28 * w, 0.18, 0.3 * w, 0.2, 0.24), 0, 0.1, 0);
  A('spine', 'armor', wedge(0.3 * w, 0.2, 0.285 * w, 0.192, 0.1), 0, 0.035, 0.004);

  // ── 흉갑 · 견갑(가슴에 붙인다 — 팔을 들어도 뒤집히지 않게) ──
  A('chest', 'armor', wedge(0.3 * w, 0.2, 0.41 * w, 0.25, 0.3), 0, 0.14, 0.005);
  A('chest', 'armor', wedge(0.05, 0.03, 0.1, 0.05, 0.24), 0, 0.15, 0.123, -0.08);
  A('chest', 'accent', box(0.33 * w, 0.02, 0.215), 0, 0.005, 0.006);
  A('chest', 'armor', cyl(0.085, 0.118, 0.07, 8), 0, 0.305, 0);
  const pw = heavy ? 1.5 : 1;
  for (const sg of [1, -1]) {
    A('chest', 'armor', dome(0.125, 8, 4, PI * 0.56), sg * 0.24 * w, 0.232, 0, 0, 0, -sg * 0.45, 1.2 * pw, 0.86 * pw, 1.28 * pw);
    A('chest', 'armor', dome(0.112, 8, 3, PI * 0.5), sg * (0.285 + (pw - 1) * 0.1) * w, 0.18, 0, 0, 0, -sg * 0.8, 1.1 * pw, 0.7, 1.22 * pw);
    A('chest', 'accent', ball(0.02, 6, 4), sg * 0.19 * w, 0.272, 0.118);
    if (heavy) {
      A('chest', 'horn', cone(0.04, 0.24, 5), sg * 0.33 * w, 0.37, 0.0, 0, 0, -sg * 0.55);
      A('chest', 'horn', cone(0.03, 0.17, 5), sg * 0.4 * w, 0.29, 0.04, 0.25, 0, -sg * 1.05);
      A('chest', 'horn', cone(0.03, 0.17, 5), sg * 0.4 * w, 0.29, -0.05, -0.25, 0, -sg * 1.05);
    }
  }
  if (heavy) {
    // 흉갑의 균열(잔불) — 블룸에 걸리는 발광 포인트
    A('chest', 'accent', box(0.014, 0.19, 0.012), 0.035 * w, 0.14, 0.132, -0.08, 0, 0.42);
    A('chest', 'accent', box(0.012, 0.13, 0.012), -0.05 * w, 0.17, 0.134, -0.08, 0, -0.3);
    A('chest', 'accent', box(0.011, 0.09, 0.012), -0.01 * w, 0.07, 0.126, -0.08, 0, 0.9);
    // 털 깃 — 목둘레의 삐죽한 실루엣
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * PI * 2 + 0.35;
      const tuft = place(cone(0.055, 0.2, 4), 0, 0, 0, 1.95, 0, 0);
      A('chest', 'dark', tuft, Math.sin(a) * 0.19 * w, 0.3, Math.cos(a) * 0.14 - 0.02, 0, a, 0);
    }
  }

  // ── 팔 ──
  for (const [S] of [['L'], ['R']]) {
    A(`shoulder${S}`, 'dark', cyl(0.052 * lw, 0.046 * lw, 0.3, 7), 0, -0.15, 0);
    A(`shoulder${S}`, 'armor', cyl(0.061 * lw, 0.054 * lw, 0.15, 7), 0, -0.145, 0);
    A(`shoulder${S}`, 'armor', ball(0.06 * lw, 7, 5), 0, -0.3, -0.006);
    A(`elbow${S}`, 'armor', cyl(0.057 * lw, 0.043 * lw, 0.2, 7), 0, -0.135, 0);
    A(`elbow${S}`, 'accent', cyl(0.06 * lw, 0.058 * lw, 0.022, 7), 0, -0.04, 0);
    A(`elbow${S}`, 'armor', cyl(0.06 * lw, 0.052 * lw, 0.045, 7), 0, -0.245, 0);
    A(`hand${S}`, 'leather', box(0.07 * lw, 0.1, 0.086 * lw), 0, -0.078, 0);
    A(`hand${S}`, 'armor', box(0.082 * lw, 0.06, 0.098 * lw), 0, -0.036, 0);
    if (heavy) A(`elbow${S}`, 'horn', cone(0.028, 0.15, 4), 0, -0.1, -0.075, -2.0);
  }

  // ── 다리 ──
  for (const [S, sg] of /** @type {[string, number][]} */ ([['L', 1], ['R', -1]])) {
    A(`hip${S}`, 'dark', cyl(0.083 * lw, 0.064 * lw, 0.42, 8), 0, -0.21, 0);
    A(`hip${S}`, 'armor', wedge(0.11 * lw, 0.05, 0.142 * lw, 0.062, 0.27), sg * 0.006, -0.17, 0.056, 0.03);
    A(`hip${S}`, 'armor', ball(0.068 * lw, 7, 5), 0, -0.42, 0.03, 0, 0, 0, 1, 0.92, 1);
    A(`knee${S}`, 'armor', cyl(0.067 * lw, 0.05 * lw, 0.35, 8), 0, -0.195, 0);
    A(`knee${S}`, 'armor', wedge(0.05, 0.02, 0.07, 0.03, 0.2), 0, -0.14, 0.055 * lw, -0.06);
    A(`knee${S}`, 'dark', cyl(0.058 * lw, 0.056 * lw, 0.05, 8), 0, -0.385, 0);
    A(`foot${S}`, 'armor', box(0.1 * lw, 0.076, 0.2), 0, -0.042, 0.035);
    A(`foot${S}`, 'armor', wedge(0.1 * lw, 0.076, 0.045 * lw, 0.024, 0.09), 0, -0.042, 0.18, HALF_PI);
    if (heavy) A(`hip${S}`, 'horn', cone(0.03, 0.14, 4), 0, -0.4, 0.1, 1.2);
  }

  // ── 머리 ──
  if (helmet === 'horned') {
    A('head', 'dark', cyl(0.07, 0.085, 0.09, 8), 0, 0.02, 0);
    A('head', 'armor', cyl(0.115, 0.128, 0.2, 8), 0, 0.135, 0);
    A('head', 'armor', dome(0.115, 8, 3), 0, 0.235, 0, 0, 0, 0, 1, 0.62, 1);
    A('head', 'armor', wedge(0.035, 0.04, 0.02, 0.03, 0.23), 0, 0.13, 0.118);
    A('head', 'voidm', box(0.2, 0.034, 0.03), 0, 0.166, 0.104);
    A('head', 'accent', box(0.058, 0.016, 0.02), 0.056, 0.166, 0.115, 0, 0, 0.12);
    A('head', 'accent', box(0.058, 0.016, 0.02), -0.056, 0.166, 0.115, 0, 0, -0.12);
    for (const sg of [1, -1]) {
      const pts = [[0.1, 0.2, 0], [0.2, 0.225, 0.005], [0.275, 0.3, 0.03], [0.31, 0.41, 0.085], [0.295, 0.54, 0.16]];
      A('head', 'horn', tubePath(pts.map((p) => [p[0] * sg, p[1], p[2]]), [0.045, 0.04, 0.031, 0.02, 0], 6));
    }
    A('head', 'horn', cone(0.022, 0.1, 4), 0, 0.33, 0.03, 0.25);
    A('head', 'horn', cone(0.02, 0.085, 4), 0, 0.325, -0.045, -0.3);
  } else if (helmet === 'hood') {
    A('head', 'skin', cyl(0.045, 0.055, 0.08, 7), 0, 0.02, 0);
    A('head', 'skin', ball(0.098, 8, 6), 0, 0.13, 0.014, 0, 0, 0, 0.92, 1.1, 1);
    A('head', 'cloth', dome(0.135, 8, 4, PI * 0.64), 0, 0.142, -0.012, -0.42, 0, 0, 1, 1.06, 1.12);
    A('head', 'cloth', cone(0.075, 0.2, 5), 0, 0.2, -0.14, -1.95);
    A('head', 'cloth', cyl(0.09, 0.17, 0.1, 8), 0, 0.03, 0);
    A('head', 'voidm', box(0.11, 0.035, 0.02), 0, 0.15, 0.085);
  } else if (helmet === 'none') {
    A('head', 'skin', cyl(0.05, 0.062, 0.09, 8), 0, 0.02, 0);
    A('head', 'skin', ball(0.1, 8, 6), 0, 0.13, 0.005, 0, 0, 0, 0.94, 1.1, 1);
    A('head', 'dark', dome(0.105, 8, 3, PI * 0.5), 0, 0.142, -0.012, -0.35, 0, 0, 1, 1.05, 1.06);
    A('head', 'dark', cone(0.075, 0.16, 5), 0, 0.05, 0.068, PI - 0.25, 0, 0, 1, 1, 0.7);
    A('head', 'skin', box(0.03, 0.035, 0.03), 0, 0.125, 0.1);
    A('head', 'dark', box(0.12, 0.014, 0.02), 0, 0.165, 0.092);
  } else {
    // 기사 투구: 둥근 정수리 + 앞으로 뾰족한 면갑 + 볏
    A('head', 'dark', cyl(0.105, 0.128, 0.075, 8), 0, 0.045, 0);
    A('head', 'armor', ball(0.118, 10, 7), 0, 0.142, 0, 0, 0, 0, 0.94, 1.08, 1.06);
    A('head', 'armor', cone(0.088, 0.13, 4), 0, 0.112, 0.125, HALF_PI, PI / 4, 0, 1, 1, 0.95);
    A('head', 'voidm', box(0.15, 0.015, 0.03), 0, 0.166, 0.106);
    A('head', 'armor', box(0.02, 0.05, 0.2), 0, 0.262, -0.012);
    A('head', 'cloth', cone(0.05, 0.3, 5), 0, 0.235, -0.145, -2.0, 0, 0, 0.6, 1, 1);
    A('head', 'accent', cyl(0.122, 0.122, 0.014, 10), 0, 0.085, 0, 0, 0, 0, 0.94, 1, 1.06);
  }

  b.finish(M, rig._geoms);

  // ── 소켓 ──
  const weapon = rig._socket('weapon', 'handR', 0, -0.075 * u, 0);
  weapon.rotation.x = HALF_PI; // 무기의 +Y(날) → rest에서 +Z(앞)
  rig._socket('weaponBase', weapon, 0, 0.12 * u, 0);
  rig._socket('weaponTip', weapon, 0, 1.0 * u, 0);
  rig._socket('gripL', weapon, 0, -0.16 * u, 0);
  rig._socket('head', 'head', 0, 0.27 * u, 0);
  rig._socket('chest', 'chest', 0, 0.15 * u, 0.02 * u);
  rig._socket('handL', 'handL', 0, -0.075 * u, 0);

  if (o.cape) {
    rig.cape = new Cape({
      parent: rig.joints.chest, material: M.cape,
      width: (heavy ? 0.46 : 0.3) * w * u, flare: heavy ? 1.7 : 1.75, length: (heavy ? 1.1 : 0.82) * u,
      y: 0.285 * u, z: -0.135 * u, torn: heavy,
    });
  }
  return rig;
}

// ───────────────────────── 사족 ─────────────────────────

/**
 * 거대 늑대. **몸 중심이 root 원점**이다(보스 pos = 중심 원): 코끝 z = +0.518 × length, 엉덩이 끝 z = −0.482 × length
 * (length 5.6이면 앞 2.9m · 뒤 2.7m — 꼬리는 그 뒤로 더 나간다). shoulderHeight = 어깨(등) 높이.
 * rest = 네 발로 선 자세. 다리 관절은 rest에서 살짝 지그재그로 놓여 있다(회전 0이 자연스러운 선 자세).
 * 관절 rest 위치(L = length, H = shoulderHeight): hips (0, 0.86H, −0.33L) · chest (0, 0.90H, 0.05L) · head (0, 1.07H, 0.335L) ·
 *   앞발 (±0.062L, 0.06H, 0.15L) · 뒷발 (±0.058L, 0.06H, −0.34L). 소켓 mouth는 주둥이 안쪽 끝(브레스 원점).
 * @param {{length:number, shoulderHeight:number, palette:{fur:number, dark:number, accent:number}, spikes:boolean}} opts
 * @returns {Rig}
 */
export function buildQuadrupedRig(opts) {
  const o = opts ?? {};
  const L = o.length > 0 ? o.length : 5.6;
  const H = o.shoulderHeight > 0 ? o.shoulderHeight : 2.4;
  const pal = o.palette ?? PALETTE.fenrir;

  const rig = new Rig();
  rig.height = H;
  rig.root.name = 'rig:quadruped';

  const M = {
    fur: rig._mat(stdMat(pal.fur, { rough: 0.92, flat: true })),
    dark: rig._mat(stdMat(pal.dark, { rough: 0.85, flat: true })),
    bone: rig._mat(stdMat(0xd8d2c4, { rough: 0.5, flat: true })),
    accent: rig._mat(stdMat(pal.accent, { rough: 0.3, metal: 0.1, flat: true, emissive: pal.accent, glow: 2.2 }), true),
    voidm: rig._mat(stdMat(0x08090c, { rough: 1, fill: 0 })),
  };

  rig._joint('hips', null, 0, 0.86 * H, -0.33 * L);
  rig._joint('spine', 'hips', 0, 0.02 * H, 0.19 * L);
  rig._joint('chest', 'spine', 0, 0.02 * H, 0.19 * L);
  rig._joint('neck', 'chest', 0, 0.07 * H, 0.17 * L);
  rig._joint('head', 'neck', 0, 0.1 * H, 0.115 * L);
  rig._joint('jaw', 'head', 0, -0.05 * H, 0.02 * L);
  for (const [S, sg] of /** @type {[string, number][]} */ ([['L', 1], ['R', -1]])) {
    rig._joint(`shoulderF${S}`, 'chest', sg * 0.062 * L, -0.1 * H, 0.1 * L);
    rig._joint(`elbowF${S}`, `shoulderF${S}`, 0, -0.36 * H, -0.03 * L);
    rig._joint(`pawF${S}`, `elbowF${S}`, 0, -0.38 * H, 0.03 * L);
  }
  for (const [S, sg] of /** @type {[string, number][]} */ ([['L', 1], ['R', -1]])) {
    rig._joint(`hipB${S}`, 'hips', sg * 0.058 * L, -0.08 * H, -0.02 * L);
    rig._joint(`kneeB${S}`, `hipB${S}`, 0, -0.33 * H, 0.07 * L);
    rig._joint(`pawB${S}`, `kneeB${S}`, 0, -0.39 * H, -0.06 * L);
  }
  rig._joint('tail1', 'hips', 0, 0.03 * H, -0.11 * L);
  rig._joint('tail2', 'tail1', 0, -0.06 * H, -0.1 * L);
  rig._joint('tail3', 'tail2', 0, -0.07 * H, -0.09 * L);

  const b = new PartBuilder();
  const A = (joint, mat, geom, px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
    b.add(rig.joints[joint], mat, geom, px, py, pz, rx, ry, rz, sx, sy, sz);
  /** 뒤로 누운 털 뭉치(원뿔) — tilt는 수직에서 뒤로 누운 각 */
  const tuft = (joint, mat, r, len, x, y, z, tilt = 1.1, yaw = 0) =>
    A(joint, mat, place(cone(r, len, 4), 0, len * 0.3, 0, -tilt, 0, 0), x, y, z, 0, yaw, 0);

  // ── 몸통: 큰 가슴 → 잘록한 허리 → 엉덩이 ──
  A('chest', 'fur', ball(1, 10, 7), 0, -0.05 * H, 0.035 * L, 0, 0, 0, 0.088 * L, 0.25 * H, 0.15 * L);
  A('chest', 'dark', ball(1, 8, 5), 0, -0.2 * H, 0.04 * L, 0, 0, 0, 0.06 * L, 0.1 * H, 0.12 * L);
  A('spine', 'fur', ball(1, 9, 6), 0, -0.04 * H, 0.085 * L, 0, 0, 0, 0.078 * L, 0.215 * H, 0.175 * L);
  A('hips', 'fur', ball(1, 9, 6), 0, -0.04 * H, 0.0, 0, 0, 0, 0.083 * L, 0.22 * H, 0.14 * L);
  // 등줄기 갈기
  for (let i = 0; i < 5; i++) {
    tuft('chest', 'fur', 0.05 * H, 0.22 * H, 0, 0.12 * H, (0.12 - i * 0.045) * L, 0.9);
    tuft('chest', 'fur', 0.045 * H, 0.18 * H, (i % 2 ? 1 : -1) * 0.035 * L, 0.08 * H, (0.1 - i * 0.045) * L, 1.0, (i % 2 ? 1 : -1) * 0.5);
  }
  for (let i = 0; i < 4; i++) tuft('spine', 'fur', 0.04 * H, 0.16 * H, 0, 0.11 * H, (0.14 - i * 0.05) * L, 1.1);
  for (let i = 0; i < 3; i++) tuft('hips', 'fur', 0.04 * H, 0.15 * H, 0, 0.12 * H, (0.06 - i * 0.05) * L, 1.2);

  // ── 목 · 갈기 깃 ──
  A('neck', 'fur', tubePath([[0, -0.04 * H, -0.03 * L], [0, 0.11 * H, 0.12 * L]], [0.2 * H, 0.15 * H], 8));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * PI * 2;
    const x = Math.sin(a) * 0.17 * H;
    const y = Math.cos(a) * 0.17 * H;
    tuft('neck', i % 2 ? 'fur' : 'dark', 0.06 * H, 0.26 * H, x, 0.03 * H + y, 0.03 * L, 1.25, 0);
  }

  // ── 머리: 넓은 두개골 → 긴 주둥이, 아래턱은 jaw 관절 ──
  A('head', 'fur', wedge(0.088 * L, 0.21 * H, 0.062 * L, 0.15 * H, 0.085 * L), 0, 0, 0.035 * L, HALF_PI);
  A('head', 'fur', wedge(0.058 * L, 0.115 * H, 0.034 * L, 0.07 * H, 0.105 * L), 0, 0.0 * H, 0.128 * L, HALF_PI);
  A('head', 'dark', box(0.03 * L, 0.035 * H, 0.012 * L), 0, 0.02 * H, 0.176 * L);
  A('head', 'dark', wedge(0.07 * L, 0.03 * H, 0.05 * L, 0.02 * H, 0.05 * L), 0, 0.075 * H, 0.06 * L, HALF_PI + 0.25);
  for (const sg of [1, -1]) {
    A('head', 'fur', cone(0.02 * L, 0.13 * H, 4), sg * 0.032 * L, 0.14 * H, 0.0, -0.35, 0, -sg * 0.3);
    A('head', 'dark', cone(0.011 * L, 0.07 * H, 4), sg * 0.032 * L, 0.135 * H, 0.004 * L, -0.3, 0, -sg * 0.3);
    A('head', 'accent', ball(0.012 * L, 6, 4), sg * 0.03 * L, 0.045 * H, 0.074 * L, 0, 0, 0, 1, 0.6, 1.2);
    A('head', 'voidm', box(0.018 * L, 0.03 * H, 0.03 * L), sg * 0.033 * L, 0.045 * H, 0.068 * L);
    // 윗송곳니 + 어금니 줄
    A('head', 'bone', cone(0.007 * L, 0.075 * H, 4), sg * 0.014 * L, -0.068 * H, 0.168 * L, PI);
    for (let i = 0; i < 4; i++) A('head', 'bone', cone(0.005 * L, 0.035 * H, 4), sg * (0.02 + i * 0.002) * L, -0.062 * H, (0.14 - i * 0.02) * L, PI);
    tuft('head', 'fur', 0.04 * H, 0.2 * H, sg * 0.045 * L, -0.02 * H, 0.0, 1.35, sg * 0.5);
  }
  A('jaw', 'dark', wedge(0.05 * L, 0.04 * H, 0.028 * L, 0.03 * H, 0.125 * L), 0, -0.01 * H, 0.075 * L, HALF_PI);
  for (const sg of [1, -1]) {
    A('jaw', 'bone', cone(0.006 * L, 0.06 * H, 4), sg * 0.011 * L, 0.03 * H, 0.128 * L);
    for (let i = 0; i < 3; i++) A('jaw', 'bone', cone(0.0045 * L, 0.03 * H, 4), sg * (0.016 + i * 0.002) * L, 0.02 * H, (0.1 - i * 0.02) * L);
  }

  // ── 앞다리 ──
  for (const S of ['L', 'R']) {
    A(`shoulderF${S}`, 'fur', ball(0.135 * H, 7, 5), 0, 0.03 * H, 0, 0, 0, 0, 0.9, 1.25, 1.1);
    A(`shoulderF${S}`, 'fur', tubePath([[0, 0.0, 0], [0, -0.36 * H, -0.03 * L]], [0.105 * H, 0.068 * H], 7));
    A(`elbowF${S}`, 'dark', tubePath([[0, 0.01 * H, 0], [0, -0.36 * H, 0.028 * L]], [0.076 * H, 0.056 * H], 7));
    tuft(`elbowF${S}`, 'fur', 0.035 * H, 0.14 * H, 0, -0.02 * H, -0.012 * L, 2.2);
    A(`pawF${S}`, 'dark', wedge(0.1 * H, 0.06 * H, 0.085 * H, 0.03 * H, 0.16 * H), 0, -0.03 * H, 0.03 * H, HALF_PI);
    for (const k of [-1, 0, 1]) A(`pawF${S}`, 'bone', cone(0.012 * H, 0.06 * H, 4), k * 0.03 * H, -0.035 * H, 0.125 * H, HALF_PI + 0.3);
  }
  // ── 뒷다리: 넓적다리(앞-아래) → 정강이(뒤-아래) → 발허리(아래) ──
  for (const S of ['L', 'R']) {
    A(`hipB${S}`, 'fur', ball(0.15 * H, 7, 5), 0, -0.03 * H, 0.01 * L, 0, 0, 0, 0.85, 1.3, 1.25);
    A(`hipB${S}`, 'fur', tubePath([[0, -0.02 * H, 0], [0, -0.33 * H, 0.07 * L]], [0.12 * H, 0.075 * H], 7));
    A(`kneeB${S}`, 'dark', tubePath([[0, 0, 0], [0, -0.22 * H, -0.075 * L], [0, -0.38 * H, -0.062 * L]], [0.082 * H, 0.058 * H, 0.05 * H], 7));
    A(`pawB${S}`, 'dark', wedge(0.095 * H, 0.06 * H, 0.08 * H, 0.03 * H, 0.16 * H), 0, -0.03 * H, 0.03 * H, HALF_PI);
    for (const k of [-1, 0, 1]) A(`pawB${S}`, 'bone', cone(0.012 * H, 0.055 * H, 4), k * 0.028 * H, -0.035 * H, 0.125 * H, HALF_PI + 0.3);
  }

  // ── 꼬리 ──
  A('tail1', 'fur', tubePath([[0, 0, 0.02 * L], [0, -0.06 * H, -0.1 * L]], [0.06 * H, 0.085 * H], 7));
  A('tail2', 'fur', tubePath([[0, 0, 0], [0, -0.07 * H, -0.09 * L]], [0.085 * H, 0.075 * H], 7));
  A('tail3', 'fur', tubePath([[0, 0, 0], [0, -0.05 * H, -0.06 * L], [0, -0.075 * H, -0.1 * L]], [0.075 * H, 0.05 * H, 0], 7));
  tuft('tail2', 'dark', 0.04 * H, 0.14 * H, 0, 0.05 * H, -0.03 * L, 1.5);
  tuft('tail3', 'dark', 0.035 * H, 0.12 * H, 0, 0.03 * H, -0.03 * L, 1.6);

  // ── 얼음 가시(등 · 어깨) ──
  if (o.spikes) {
    const spikes = [[0, 0.2, 0.1, 0.34, 0.3], [0.035, 0.17, 0.06, 0.26, 0.5], [-0.035, 0.17, 0.06, 0.26, 0.5],
      [0, 0.19, 0.01, 0.28, 0.45], [0.03, 0.15, -0.03, 0.2, 0.6], [-0.03, 0.15, -0.03, 0.2, 0.6]];
    for (const [x, y, z, len, tilt] of spikes) {
      A('chest', 'accent', place(cone(0.035 * H, len * H, 5), 0, len * H * 0.4, 0, -tilt, 0, 0), x * L, y * H, z * L, 0, x * 8, 0);
    }
    A('spine', 'accent', place(cone(0.03 * H, 0.2 * H, 5), 0, 0.08 * H, 0, -0.6, 0, 0), 0, 0.15 * H, 0.05 * L);
    A('hips', 'accent', place(cone(0.028 * H, 0.17 * H, 5), 0, 0.07 * H, 0, -0.7, 0, 0), 0, 0.16 * H, 0.0);
  }

  b.finish(M, rig._geoms);

  rig._socket('mouth', 'head', 0, -0.03 * H, 0.17 * L);
  rig._socket('head', 'head', 0, 0.13 * H, 0.03 * L);
  rig._socket('chest', 'chest', 0, -0.03 * H, 0.05 * L);
  rig._socket('tailTip', 'tail3', 0, -0.075 * H, -0.1 * L);
  return rig;
}

// ───────────────────────── 부유체 ─────────────────────────

/**
 * 다리 없는 로브의 마술사. **몸은 root 원점 위 [hover, height] 구간**을 차지한다(자락 끝 y = hover, 두건 끝 y ≈ height).
 * sim이 이미 root를 들어 올린다면(예: boss.y = hoverY) `hover: 0, height: 정의 키 − hoverY`로 만든다 — 두 번 띄우지 않게.
 * 관절 rest 높이(bh = height − hover): core hover + 0.50bh · chest +0.20bh · head(목) +0.19bh · 어깨 chest + (±0.16bh, 0.12bh).
 * 팔 길이(어깨 → 손바닥) 0.37bh.
 * robe1 → robe2 → robe3은 허리에서 아래로 늘어진 자락(끝단은 해진 조각). halo는 머리 뒤의 고리(rz로 돌린다).
 * @param {{height:number, hover:number, palette:{robe:number, trim:number, accent:number}, halo:boolean}} opts
 * @returns {Rig}
 */
export function buildFloaterRig(opts) {
  const o = opts ?? {};
  const height = o.height > 0 ? o.height : 2.8;
  const hover = Number.isFinite(o.hover) ? Math.max(0, o.hover) : 0;
  const bh = Math.max(0.5, height - hover);
  const pal = o.palette ?? PALETTE.nihil;

  const rig = new Rig();
  rig.height = height;
  rig.root.name = 'rig:floater';

  const M = {
    robe: rig._mat(stdMat(pal.robe, { rough: 0.95, flat: true, fill: 0.5 })),
    inner: rig._mat(stdMat(shade(pal.robe, 0.45), { rough: 1, fill: 0.3 })),
    trim: rig._mat(stdMat(pal.trim, { metal: 0.5, rough: 0.4, flat: true, emissive: pal.trim, glow: 0.45 })),
    accent: rig._mat(stdMat(pal.accent, { rough: 0.4, emissive: pal.accent, glow: 2.4 }), true),
    voidm: rig._mat(stdMat(0x030206, { rough: 1, fill: 0 })),
  };

  const J = (name, parent, x, y, z) => rig._joint(name, parent, x * bh, y * bh, z * bh);
  rig._joint('core', null, 0, hover + 0.5 * bh, 0);
  J('chest', 'core', 0, 0.2, 0);
  J('head', 'chest', 0, 0.19, 0);
  for (const [S, sg] of /** @type {[string, number][]} */ ([['L', 1], ['R', -1]])) {
    J(`shoulder${S}`, 'chest', sg * 0.16, 0.12, 0);
    J(`elbow${S}`, `shoulder${S}`, 0, -0.17, 0);
    J(`hand${S}`, `elbow${S}`, 0, -0.16, 0);
  }
  J('robe1', 'core', 0, -0.04, 0);
  J('robe2', 'robe1', 0, -0.16, 0);
  J('robe3', 'robe2', 0, -0.15, 0);
  J('halo', 'chest', 0, 0.3, -0.1);
  rig._armA = 0.17 * bh;
  rig._armB = (0.16 + 0.04) * bh;

  const b = new PartBuilder();
  const A = (joint, mat, geom, px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
    b.add(rig.joints[joint], mat, geom, px * bh, py * bh, pz * bh, rx, ry, rz, sx * bh, sy * bh, sz * bh);

  // ── 몸통: 가는 허리 · 역삼각 가슴 · 어깨에서 바깥으로 뻗은 깃 ──
  A('core', 'robe', cyl(0.1, 0.085, 0.22, 8), 0, 0.09, 0);
  A('core', 'trim', cyl(0.09, 0.09, 0.022, 8), 0, -0.01, 0);
  A('chest', 'robe', wedge(0.2, 0.13, 0.3, 0.17, 0.2), 0, 0.03, 0);
  A('chest', 'trim', wedge(0.035, 0.012, 0.08, 0.012, 0.19), 0, 0.03, 0.082, -0.1);
  A('chest', 'accent', ball(0.02, 6, 4), 0, 0.085, 0.092);
  for (const sg of [1, -1]) {
    // 어깨 깃: 바깥-위로 뾰족하게(머리를 가리지 않는다)
    A('chest', 'robe', place(cone(0.07, 0.24, 4), 0, 0.09, 0, 0, 0, -sg * 1.25), sg * 0.13, 0.125, -0.01, 0, 0, 0, 1, 1, 1.5);
    A('chest', 'trim', place(cone(0.022, 0.13, 4), 0, 0.06, 0, 0, 0, -sg * 1.0), sg * 0.24, 0.17, -0.01);
    A('chest', 'robe', wedge(0.1, 0.15, 0.06, 0.1, 0.05), sg * 0.09, 0.145, 0);
  }
  A('chest', 'robe', cyl(0.05, 0.085, 0.06, 8), 0, 0.16, 0);
  // ── 머리: 깊은 두건 속의 어둠 + 빛나는 눈 ──
  A('head', 'voidm', ball(0.056, 8, 6), 0, 0.07, 0.012, 0, 0, 0, 0.88, 1.2, 0.9);
  A('head', 'robe', dome(0.08, 8, 4, PI * 0.62), 0, 0.075, -0.012, -0.5, 0, 0, 1, 1.2, 1.2);
  A('head', 'robe', cone(0.05, 0.2, 5), 0, 0.135, -0.085, -1.75);
  A('head', 'robe', cyl(0.055, 0.075, 0.05, 8), 0, 0.01, 0);
  A('head', 'accent', box(0.026, 0.01, 0.014), 0.022, 0.07, 0.066, 0, 0, 0.3);
  A('head', 'accent', box(0.026, 0.01, 0.014), -0.022, 0.07, 0.066, 0, 0, -0.3);
  A('head', 'trim', cone(0.009, 0.09, 4), 0, 0.185, 0.02, 0.25);
  for (const sg of [1, -1]) A('head', 'trim', cone(0.007, 0.06, 4), sg * 0.045, 0.165, 0.0, 0.1, 0, -sg * 0.5);
  // ── 팔: 가는 팔 + 손목으로 갈수록 넓어지는 긴 소매 + 뼈 같은 손 ──
  for (const S of ['L', 'R']) {
    A(`shoulder${S}`, 'robe', cyl(0.04, 0.032, 0.17, 6), 0, -0.085, 0);
    A(`elbow${S}`, 'robe', cyl(0.032, 0.058, 0.15, 7), 0, -0.07, 0);
    A(`elbow${S}`, 'inner', cyl(0.05, 0.054, 0.012, 7), 0, -0.148, 0);
    A(`elbow${S}`, 'trim', cyl(0.06, 0.06, 0.012, 7), 0, -0.138, 0);
    A(`hand${S}`, 'trim', box(0.03, 0.045, 0.016), 0, -0.022, 0);
    for (const k of [-1, 0, 1]) A(`hand${S}`, 'trim', cone(0.0055, 0.055, 4), k * 0.011, -0.068, 0, PI, 0, k * 0.22);
  }
  // ── 자락: 아래로 갈수록 퍼지고 끝단은 해진 조각 ──
  A('robe1', 'robe', cyl(0.092, 0.15, 0.17, 9), 0, -0.08, 0);
  A('robe1', 'trim', cyl(0.152, 0.152, 0.012, 9), 0, -0.16, 0);
  A('robe2', 'robe', cyl(0.146, 0.2, 0.16, 9), 0, -0.075, 0);
  A('robe2', 'inner', cyl(0.1, 0.14, 0.15, 7), 0, -0.08, 0);
  A('robe2', 'trim', wedge(0.05, 0.01, 0.03, 0.01, 0.3), 0, -0.02, 0.178, 0.19);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * PI * 2;
    const len = 0.11 + ((i * 7) % 5) * 0.018;
    const strip = place(wedge(0.014, 0.01, 0.13, 0.012, len), 0, -len / 2, 0.185, 0.22, 0, 0);
    A('robe3', 'robe', strip, 0, 0.005, 0, 0, a, 0);
  }
  A('robe3', 'inner', cyl(0.13, 0.05, 0.12, 7), 0, -0.05, 0);
  // ── 후광 ──
  if (o.halo) {
    A('halo', 'accent', new THREE.TorusGeometry(0.16, 0.007, 5, 20), 0, 0, 0);
    A('halo', 'trim', new THREE.TorusGeometry(0.12, 0.004, 4, 16), 0, 0, 0);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * PI * 2;
      const len = i % 2 ? 0.07 : 0.12;
      A('halo', 'accent', place(cone(0.01, len, 4), 0, 0.16 + len / 2, 0), 0, 0, 0, 0, 0, a);
    }
  }

  b.finish(M, rig._geoms);

  const weapon = rig._socket('weapon', 'handR', 0, -0.04 * bh, 0);
  weapon.rotation.x = HALF_PI;
  rig._socket('weaponBase', weapon, 0, 0.2 * bh, 0);
  rig._socket('weaponTip', weapon, 0, 0.9 * bh, 0);
  rig._socket('head', 'head', 0, 0.16 * bh, 0);
  rig._socket('chest', 'chest', 0, 0.06 * bh, 0.02 * bh);
  rig._socket('handL', 'handL', 0, -0.04 * bh, 0);
  return rig;
}
