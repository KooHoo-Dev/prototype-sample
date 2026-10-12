// OWNER: P8 — 계약 §9.5 · §9.6 (내부 — 플레이어 · NPC 리그: 부위 메시 · 장비 외형 · 포즈)
// 플레이어는 하나라 인스턴싱 없이 부위마다 Mesh(행렬을 직접 쓴다 — matrixAutoUpdate false). 장비가 바뀌면(장착 칸의 아이템 ID) 다시 짓는다.
// 포즈: 행동(act) · 스킬 동작(behavior) · 무기 형태(한손 · 한손+방패 · 양손 · 마법봉 · 마법봉+마법구 · 지팡이 · 맨손)로 고른다.
// 양손 무기(전사)는 왼손을 손잡이에 IK 로 붙인다(무기가 손을 떠나지 않는다).

import { Matrix4, Mesh, Vector3 } from 'three';
import { CAM_AZIMUTH, DT } from '../../core/constants.js';
import { ticks } from '../../core/time.js';
import { BASES_BY_ID, getSkillDef } from '../../data/index.js';
import { weaponVisual } from '../../sim/loot/stats.js';
import { CHAR_DIMS, charParts } from './gear.js';
import {
  actionPose, attackPhase, bipedBase, bipedBreathe, bipedFall, bipedWalk, clamp01, compileKey, ease, frac, mixArr, newFacingTrack, phaseStep, stepLenOf,
  trackFacing,
} from './poses.js';
import { BJ, BP, fkBiped, makeJoints } from './rig.js';
import { BIPED_FAMILIES } from './variants.js';

const PI = Math.PI;

/** 플레이어 걸음(§9.5 — 보폭 1.4m at 6 m/s · 속도에 비례) */
export const PLAYER_GAIT = Object.freeze({ step: 1.4, refSpeed: 6, stance: 0.32, lift: 0.2, armSwing: 0.55, lean: 0.14, crouch: 0.07, bob: 0.03 });
/** NPC 걸음(서 있기만) */
const NPC_GAIT = Object.freeze({ step: 0.6, refSpeed: 2, stance: 0.5, lift: 0.1, armSwing: 0.3, lean: 0.05, crouch: 0, bob: 0 });

/** 무기 형태별 기본 자세(부분) */
const STYLE_BASE = {
  fist: { RSHP: 0.15, RSHA: 0.14, RELB: 0.4, LSHP: 0.15, LSHA: 0.14, LELB: 0.4 },
  oneHand: { RSHP: 0.3, RSHA: 0.14, RELB: 1.0, RWRI: 2.0, LSHP: 0.15, LSHA: 0.14, LELB: 0.4 },
  oneHandShield: { RSHP: 0.3, RSHA: 0.14, RELB: 1.0, RWRI: 2.0, LSHP: 0.5, LSHA: 0.22, LSHT: -1.45, LELB: 1.45 },
  twoHand: { RSHP: 0.5, RSHA: -0.15, RSHT: -0.8, RELB: 1.2, RWRI: 3.0, LSHP: 0.5, LSHA: 0.1, LELB: 1.2 },
  wand: { RSHP: 0.25, RSHA: 0.14, RELB: 0.75, RWRI: 1.9, LSHP: 0.15, LSHA: 0.14, LELB: 0.4 },
  wandOrb: { RSHP: 0.25, RSHA: 0.14, RELB: 0.75, RWRI: 1.9, LSHP: 0.4, LSHA: 0.2, LELB: 1.35, LWRI: 0 },
  staff: { RSHP: 0.2, RSHA: 0.14, RELB: 0.5, RWRI: 0.7, LSHP: 0.15, LSHA: 0.14, LELB: 0.4 },
};
/** 플레이어 전용 공격 · 시전 자세(부분 — 몬스터 표에 더한다) */
const PLAYER_FAMILIES = {
  slash: {
    wind: { RSHP: 1.9, RSHA: 1.0, RSHT: 0.4, RELB: 1.3, RWRI: 1.6, '+SYAW': -0.45, '+SPITCH': -0.05 },
    hit: { RSHP: 1.45, RSHA: -0.12, RSHT: 0, RELB: 0.15, RWRI: 2.75, '+SYAW': 0.42, '+SPITCH': 0.18, '+HIPZ': 0.12, LFZ: 0.3, RFZ: -0.1 },
  },
  overhead: {
    wind: { RSHP: 2.8, RSHA: 0.1, RSHT: -1.2, RELB: 1.4, RWRI: 2.0, '+SPITCH': -0.15 },
    hit: { RSHP: 0.3, RSHA: 0.1, RSHT: -0.8, RELB: 1.2, RWRI: 3.0, '+SPITCH': 0.3, '+HIPY': -0.1, '+HIPZ': 0.1, LFZ: 0.35, RFZ: -0.12 },
  },
  punch: {
    wind: { RSHP: -0.3, RSHA: 0.2, RELB: 2.0, '+SYAW': -0.35 },
    hit: { RSHP: 1.55, RSHA: 0.02, RELB: 0.05, '+SYAW': 0.35, '+HIPZ': 0.12, LFZ: 0.25 },
  },
  thrust: {
    wind: { RSHP: 0.5, RSHA: 0.3, RELB: 1.7, RWRI: 1.8, '+SYAW': -0.25 },
    hit: { RSHP: 1.5, RSHA: 0.05, RELB: 0.05, RWRI: 2.95, '+SYAW': 0.2, LFZ: 0.2 },
  },
  castFwd2: {
    wind: { RSHP: 0.6, LSHP: 0.6, RELB: 1.6, LELB: 1.6, RSHA: 0.1, LSHA: 0.1, GLOW: 1 },
    hit: { RSHP: 1.5, LSHP: 1.5, RELB: 0.1, LELB: 0.1, RSHA: -0.1, LSHA: -0.1, '+SPITCH': 0.1, LFZ: 0.2, GLOW: 0.4 },
  },
  castDown: {
    wind: { RSHP: 1.6, LSHP: 1.6, RSHA: 0.9, LSHA: 0.9, RELB: 0.9, LELB: 0.9, '+HIPY': 0.02 },
    hit: { RSHP: 0.55, LSHP: 0.55, RSHA: 0.7, LSHA: 0.7, RELB: 0.1, LELB: 0.1, '+SPITCH': 0.25, '+HIPY': -0.16 },
  },
  roar: {
    wind: { RSHP: 0.6, LSHP: 0.6, RSHA: 0.4, LSHA: 0.4, RELB: 1.4, LELB: 1.4, '+SPITCH': 0.2, '+HPITCH': 0.2 },
    hit: { RSHP: 1.8, LSHP: 1.8, RSHA: 1.1, LSHA: 1.1, RELB: 0.7, LELB: 0.7, '+SPITCH': -0.25, '+HPITCH': -0.45 },
  },
  castChest: {
    wind: { RSHP: 0.9, LSHP: 0.9, RELB: 1.6, LELB: 1.6, RSHT: -0.6, LSHT: -0.6 },
    hit: { RSHP: 1.3, LSHP: 1.3, RSHA: 0.5, LSHA: 0.5, RELB: 0.5, LELB: 0.5, '+SPITCH': -0.1 },
  },
};
/** 스킬 동작(behavior) → 시전 자세(피드백 1: 옛 cone → slamDown 은 뺐다 — 회전 베기는 attack 의 횡베기) */
const CAST_FAMILY = { quake: 'slamDown', buff: 'roar', nova: 'castDown', fireball: 'castFwd2', chain: 'castFwd2', meteor: 'castUp', shield: 'castChest', boltBasic: 'thrust' };
const ALL_FAMILIES = { ...BIPED_FAMILIES, ...PLAYER_FAMILIES };

// ───────────────────────── 피드백 1 — 횡베기(가르기 cleave · 회전 베기 spinSlash) ─────────────────────────
// 계약 §9.5: 진행 k = (now − actStart)/(actEnd − actStart) · u = clamp((k − from)/(to − from)) · 칼끝 방위 = facing + arcFrom + (arcTo − arcFrom)·ease(u)
//   (데이터 params.swing — 판정과 무관한 연출 값). k < from 은 arcFrom 쪽으로 감는 예비 · k > to 는 후딜(쉬는 자세로 돌아옴).
// 가르기: 발은 디딘 그대로(골반 · 가슴 yaw 를 다리 IK 가 받는다) — 몸통이 칼끝 방위의 bodyShare 를 돌고 나머지를 팔이 수평으로 쓸어 낸다.
// 회전 베기: 팔을 뻗은 채 몸 전체(루트 yaw)가 칼끝을 따라 한 바퀴 — 발은 step 마다 번갈아 들어 옮겨 디딘다(디딘 동안은 월드 자리 그대로 — 미끄러짐 없음).
// 양손 무기는 오른팔을 몸 앞(twoHandArm)에 두고 방위는 몸통이 다 맡는다 — 왼손이 손잡이에 닿는다(ActorLayer leftHandToGrip).

/** 수평으로 베는 스킬 동작 */
export const SWING_BEHAVIORS = Object.freeze(['cleave', 'spinSlash']);

/** 횡베기 자세 손잡이(연출 — 판정 치수는 sim · 데이터가 정본) */
export const SWING_POSE = Object.freeze({
  droop: 0.3,            // 가르기: 팔 + 무기를 수평 아래로(rad — 숙임을 뺀 월드 값) — 판정 틱 칼끝 높이 ≈ 1.0m(몬스터 몸통)
  spinDroop: 0.14,       // 회전 베기: 같은 값(팔을 옆으로 뻗어 더 수평)
  lean: 0.28,            // 가르기: 상체를 가슴 앞(≈ 칼끝 쪽)으로 숙임(rad) — 어깨가 앞으로 나가 끝 반지름 +0.13
  twoHandLean: 0.12,     // 가르기 양손: 같은 값(양손 무기는 이미 길다 — 끝이 판정 1.9 를 0.35 넘게 넘지 않게)
  elbow: 0.1,            // 팔꿈치 굽힘(rad — 거의 편 팔)
  wrist: PI - 0.05,      // 손목(π = 무기가 아래팔을 잇는다)
  bodyShare: 0.75,       // 가르기(한손 · 맨손): 칼끝 방위 중 몸통 yaw 몫 — 나머지는 팔
  hipShare: 0.4,         // 몸통 yaw 중 골반 몫(나머지는 가슴)
  shift: 0.16,           // 가르기: 골반을 칼끝 쪽으로(m — 디딘 발은 IK 로 그대로)
  crouch: 0.07,          // 골반 낮추기(m)
  roll: 0.12,            // 상체를 칼끝 쪽으로 기울임(rad — 회전 베기의 원심 · 끝 반지름 +)
  twoHandArm: 0.2,       // 양손: 오른팔 방위(가슴 기준 rad · 왼손이 손잡이에 닿는 자리)
  spinArm: -1.35,        // 회전 베기(한손 · 맨손): 오른팔 방위(가슴 기준 rad · −π/2 = 오른쪽) — 무기를 옆으로 뻗는다
  reach: { fist: 0.62, oneHand: 1.5, oneHandShield: 1.5, twoHand: 2.0, wand: 1.0, wandOrb: 1.0, staff: 1.8 },   // 어깨 → 칼끝 명목 길이(방위 보정)
  step: PI / 2,          // 회전 베기 발 디딤 — 몸이 이만큼 돌 때마다 한 발씩 옮긴다(두 발은 반 칸 어긋남)
  plant: 0.5,            // 한 칸 중 발이 디딘 채인 비율(나머지에 들어 옮긴다 — 골반과 발의 비틀림 ≤ step × plant · 0.5 = 두 발이 번갈아 · 쉬는 자세에서 둘 다 디딤)
  lift: 0.09,            // 옮기는 발 높이(m)
});

/**
 * 팔(어깨 → 무기 끝) 방향 — 가슴 틀 수평 방위 phi · 아래로 droop(rad) → RSHP · RSHA(비틀기 0)
 * fkBiped 오른팔 = Rz(−RSHA)·Rx(−RSHP) · (0, −1, 0) = (−cosP·sinA, −cosP·cosA, sinP) 를 (sinφ·cosδ, −sinδ, cosφ·cosδ) 에 맞춘다.
 * @param {Float32Array} out @param {number} phi @param {number} droop
 */
export function aimRightArm(out, phi, droop) {
  const sp = Math.sin(phi), cp = Math.cos(phi), sd = Math.sin(droop), cd = Math.cos(droop);
  const cP = Math.hypot(sp * cd, sd);
  out[BP.RSHA] = Math.atan2(-sp * cd, sd);
  out[BP.RSHP] = Math.atan2(cp * cd, cP);
  out[BP.RSHT] = 0;
}

/**
 * 가슴 틀에서 칼끝이 방위 alpha 에 오게 하는 오른팔 방위(어깨가 가운데에서 shX 만큼 오른쪽 — 반직선과 원의 교점)
 * @param {number} alpha 원하는 칼끝 방위(가슴 기준) @param {number} s 어깨 shX @param {number} L 어깨 → 끝 수평 길이 @returns {number}
 */
export function armForTip(alpha, s, L) {
  const sa = Math.sin(alpha), ca = Math.cos(alpha);
  const t = -s * sa + Math.sqrt(Math.max(0, s * s * sa * sa - s * s + L * L));
  return Math.atan2(t * sa + s, t * ca);
}

/** 오른팔 방위 phi 일 때 칼끝의 가슴 틀 방위 @param {number} phi @param {number} s @param {number} L */
export function tipForArm(phi, s, L) {
  return Math.atan2(-s + L * Math.sin(phi), L * Math.cos(phi));
}

/**
 * 발 디딤 계단 — 몸 yaw Y 를 따라가는 발의 월드 yaw(디딘 동안 그대로 · 칸의 끝 (1 − plant) 동안 옮긴다) · 옮기는 중이면 lift 진행(0..1)
 * @param {number} Y @param {number} step @param {number} plant @param {{yaw:number, k:number}} out
 */
export function footStair(Y, step, plant, out) {
  const q = Y / step, n = Math.floor(q), t = q - n;
  const m = t <= plant ? 0 : (t - plant) / (1 - plant);
  out.yaw = step * (n + ease(m));
  out.k = t <= plant ? 0 : Math.sin(PI * m);
  return out;
}

/** 한 행동의 횡베기 진행 — 칼끝 방위(facing 기준 rad) · 쉬는 자세와의 섞음 w · 단계 @param {{from:number,to:number,arcFrom:number,arcTo:number}} sw */
export function swingAt(sw, now, actStart, actEnd, out) {
  const dur = actEnd - actStart;
  const k = dur > 0 ? (now - actStart) / dur : 1;
  const span = Math.max(1e-6, sw.to - sw.from);
  const u = clamp01((k - sw.from) / span);
  out.k = k;
  out.u = u;
  out.theta = ((sw.arcFrom + (sw.arcTo - sw.arcFrom) * ease(u)) * PI) / 180;
  out.w = k < sw.from ? ease(sw.from > 0 ? k / sw.from : 1) : k > sw.to ? 1 - ease((k - sw.to) / Math.max(1e-6, 1 - sw.to)) : 1;
  out.r = k > sw.to ? ease((k - sw.to) / Math.max(1e-6, 1 - sw.to)) : 0;
  return out;
}

/** 장비 → 외형 @param {import('../../types.js').CharacterState|null} char @returns {import('./gear.js').CharLook} */
export function playerLook(char) {
  const cls = char?.cls === 'mage' ? 'mage' : 'warrior';
  const eq = char?.equip ?? null;
  const gearOf = (it) => {
    if (!it) return null;
    const b = BASES_BY_ID[it.baseId];
    if (!b) return null;
    return { look: b.look, tier: it.tier | 0, rarity: it.rarity, hands: b.hands ?? 1, set: it.rarity === 'set' || !!it.setPieceId, legendary: it.rarity === 'legendary' };
  };
  const wv = eq ? weaponVisual(eq.mainHand) : null;
  return {
    cls,
    weapon: wv ? { look: wv.look, tier: wv.tier, rarity: wv.rarity, hands: wv.hands, legendary: wv.rarity === 'legendary', set: wv.rarity === 'set' } : null,
    offhand: eq ? gearOf(eq.offhand) : null,
    helm: eq ? gearOf(eq.helm) : null,
    chest: eq ? gearOf(eq.chest) : null,
    gloves: eq ? gearOf(eq.gloves) : null,
    boots: eq ? gearOf(eq.boots) : null,
    belt: eq ? gearOf(eq.belt) : null,
    npc: null,
  };
}

/** 무기 형태 @param {import('./gear.js').CharLook} L */
export function styleOf(L) {
  const w = L.weapon;
  if (!w) return 'fist';
  if (w.look === 'staff') return 'staff';
  if (w.look === 'wand') return L.offhand?.look === 'orb' ? 'wandOrb' : 'wand';
  if ((w.hands ?? 1) >= 2) return 'twoHand';
  return L.offhand?.look === 'shield' ? 'oneHandShield' : 'oneHand';
}

/** 부위 메시 묶음(플레이어 · NPC 공용) */
export class CharRig {
  /** @param {import('three').Group} parent @param {ReturnType<typeof import('./materials.js').makeCharMaterials>} mats */
  constructor(parent, mats) {
    this.parent = parent;
    this.mats = mats;
    /** @type {{mesh:Mesh, twin:Mesh|null, j:number, local:Matrix4|null}[]} */
    this.meshes = [];
    this.J = makeJoints(18);
    this.dims = CHAR_DIMS.warrior;
  }

  /** @param {import('./gear.js').CharLook} look @param {any} dims */
  build(look, dims) {
    this.clear();
    this.dims = dims;
    for (const p of charParts(look, dims)) {
      const j = BJ[p.joint];
      const mesh = new Mesh(p.geo, this.mats[p.mat]);
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = p.mat !== 'glow';
      mesh.frustumCulled = false;
      this.parent.add(mesh);
      let twin = null;
      if (this.mats.sil && p.mat !== 'glow') {
        twin = new Mesh(p.geo, this.mats.sil);
        twin.matrixAutoUpdate = false;
        twin.frustumCulled = false;
        twin.renderOrder = 6;
        this.parent.add(twin);
      }
      const local = p.at ? new Matrix4().makeTranslation(p.at[0], p.at[1], p.at[2]) : null;
      this.meshes.push({ mesh, twin, j, local });
    }
  }

  /** 관절 행렬 → 메시 행렬 */
  apply(J = this.J) {
    for (const e of this.meshes) {
      const m = e.mesh.matrix;
      if (e.local) m.multiplyMatrices(J[e.j], e.local);
      else m.copy(J[e.j]);
      e.mesh.matrixWorldNeedsUpdate = true;
      if (e.twin) { e.twin.matrix.copy(m); e.twin.matrixWorldNeedsUpdate = true; }
    }
  }

  setVisible(on) {
    for (const e of this.meshes) { e.mesh.visible = on; if (e.twin) e.twin.visible = on; }
  }

  clear() {
    for (const e of this.meshes) {
      this.parent.remove(e.mesh);
      if (e.twin) this.parent.remove(e.twin);
      e.mesh.geometry.dispose();
    }
    this.meshes = [];
  }

  dispose() { this.clear(); }
}

// ───────────────────────── 플레이어 포즈 ─────────────────────────

/** 무기 형태 · 자세 이름 → 완전한 배열(캐시) */
export class PlayerPoser {
  constructor() {
    /** @type {Record<string, Record<string, Float32Array>>} 기본 자세 */
    this.bases = {};
    /** @type {Record<string, Record<string, Record<string, {wind:Float32Array, hit:Float32Array}>>>} 공격 · 시전 자세 */
    this.fams = {};
    this.phase = 0;
    this.amt = 0;
    this.px = 0;
    this.pz = 0;
    this.mdx = 0;
    this.mdz = 1;
    this.lastNow = 0;
    this.fresh = true;
    this._ph = { stage: 0, u: 0, r: 0 };
    /** 그린 방향 보간(마지막 두 틱의 facing — poses.js trackFacing) */
    this.face = newFacingTrack();
    /** @type {Map<string, {beh:string, swing:{from:number,to:number,arcFrom:number,arcTo:number}}|null>} 스킬 → 횡베기 정의(캐시) */
    this._sw = new Map();
    this._swT = new Float32Array(BP.N);
    this._sa = { k: 0, u: 0, theta: 0, w: 0, r: 0 };
    this._fs = { yaw: 0, k: 0 };
  }

  reset() { this.fresh = true; this.face.fTick = -1; }

  /** 그 스킬이 횡베기(cleave · spinSlash + params.swing)면 정의 · 아니면 null @param {string|null} id */
  _swingDef(id) {
    if (!id) return null;
    if (this._sw.has(id)) return this._sw.get(id);
    let v = null;
    try {
      const def = getSkillDef(id);
      const swing = def.params?.swing;
      if (SWING_BEHAVIORS.includes(def.behavior) && swing && Number.isFinite(swing.from) && Number.isFinite(swing.to)) v = { beh: def.behavior, swing };
    } catch { v = null; }
    this._sw.set(id, v);
    return v;
  }

  /**
   * 횡베기 자세(피드백 1 — 계약 §9.5). out = 쉬는 자세(걷기 · 숨쉬기)를 받아 덮어쓴다.
   * @param {Float32Array} out @param {import('../../types.js').PlayerState} p @param {string} cls @param {string} style @param {number} now
   * @param {string} beh @param {{from:number,to:number,arcFrom:number,arcTo:number}} sw @param {any} d
   */
  _swing(out, p, cls, style, now, beh, sw, d) {
    const S = SWING_POSE;
    const a = swingAt(sw, now, p.actStart, p.actEnd, this._sa);
    const T = this._swT;
    T.set(out);
    const th = a.theta;
    const two = style === 'twoHand';
    const spin = beh === 'spinSlash';
    const droop = spin ? S.spinDroop : S.droop;
    const L = (S.reach[style] ?? S.reach.oneHand) * Math.cos(droop);
    let phi, bodyYaw = 0;
    if (spin) {
      phi = two ? S.twoHandArm : S.spinArm;
    } else if (two) {
      phi = S.twoHandArm;
      bodyYaw = th - tipForArm(phi, d.shX, L);
    } else {
      bodyYaw = th * S.bodyShare;
      phi = armForTip(th - bodyYaw, d.shX, L);
    }
    // 몸통(가르기) — 골반 · 가슴 yaw(발은 IK 로 디딘 자리) · 칼끝 쪽으로 골반을 싣는다
    T[BP.PYAW] += bodyYaw * S.hipShare;
    T[BP.SYAW] += bodyYaw * (1 - S.hipShare);
    T[BP.HIPY] -= S.crouch;
    const lean = spin ? tipForArm(phi, d.shX, L) : th - bodyYaw;   // 가슴 기준 칼끝 방위
    if (!spin) { T[BP.HIPX] += Math.sin(th) * S.shift; T[BP.HIPZ] += Math.cos(th) * S.shift; }
    T[BP.SROLL] += -Math.sin(lean) * S.roll;
    const pitch = spin ? 0 : two ? S.twoHandLean : S.lean;
    T[BP.SPITCH] += pitch;
    // 오른팔 + 무기 — 수평에서 droop 만큼 아래로 뻗는다(가슴이 숙은 만큼은 팔 방위의 앞 성분에서 덜어 월드 droop 을 맞춘다)
    aimRightArm(T, phi, droop - pitch * Math.cos(phi));
    T[BP.RELB] = S.elbow;
    T[BP.RWRI] = S.wrist;
    // 왼팔 — 한손: 반대쪽으로 벌려 균형 · 방패 · 마법구는 쉬는 자세 그대로 · 양손은 IK(ActorLayer)
    if (style === 'oneHand' || style === 'fist' || style === 'staff' || style === 'wand') {
      T[BP.LSHA] = 1.05; T[BP.LSHP] = spin ? 0.15 : -0.25; T[BP.LSHT] = 0; T[BP.LELB] = 0.45;
    }
    mixArr(out, out, T, a.w);
    if (!spin) return;
    // 회전 베기 — 루트 yaw(펼친 값 · 감기 0 → Y0 · 휘두름 Y(θ) · 후딜 Y_end → 가장 가까운 한 바퀴)
    const tip0 = tipForArm(phi, d.shX, L);
    let Y;
    if (a.k < sw.from) Y = (((sw.arcFrom * PI) / 180) - tip0) * a.w;
    else if (a.k <= sw.to) Y = th - tip0;
    else {
      const yEnd = ((sw.arcTo * PI) / 180) - tip0;
      const yRest = 2 * PI * Math.round(yEnd / (2 * PI));
      Y = yEnd + (yRest - yEnd) * a.r;
    }
    out[BP.RYAW] = Y;
    // 발 — 몸 yaw 를 계단으로 따라간다(디딘 발은 월드 자리 그대로) · 루트 틀 목표 = Ry(발 yaw − Y) · 기본 자리
    const base = this._base(cls, style);
    const fs = this._fs;
    for (let side = 0; side < 2; side++) {
      const iX = side ? BP.RFX : BP.LFX, iY = side ? BP.RFY : BP.LFY, iZ = side ? BP.RFZ : BP.LFZ;
      const off = side ? 0 : S.step / 2;
      footStair(Y + off, S.step, S.plant, fs);
      const rel = fs.yaw - Y;   // 왼발은 반 칸 앞서 옮긴다(디딘 자리는 두 발 모두 step 의 배수)
      const c = Math.cos(rel), s = Math.sin(rel);
      const bx = base[iX], bz = base[iZ];
      // 쉬는 자세가 기본에서 벗어난 만큼(걷기에서 막 멈춤)은 감기 동안 사라진다
      const ex = (out[iX] - bx) * (1 - a.w), ez = (out[iZ] - bz) * (1 - a.w);
      out[iX] = bx * c + bz * s + ex;
      out[iZ] = -bx * s + bz * c + ez;
      out[iY] = base[iY] + S.lift * fs.k;
    }
  }

  /**
   * 그릴 방향 — 마지막 두 틱의 facing 을 alpha 로 최단 호 보간(위치 보간과 같은 alpha). snap = 보간 끊기(순간이동)
   * @param {number} facing sim 값 @param {number} tick state.tick @param {number} alpha @param {boolean} snap @returns {number}
   */
  facing(facing, tick, alpha, snap) {
    return trackFacing(this.face, facing, tick, alpha, snap || this.fresh);
  }

  _base(cls, style) {
    const byCls = this.bases[cls] ?? (this.bases[cls] = {});
    return byCls[style] ?? (byCls[style] = bipedBase(CHAR_DIMS[cls], STYLE_BASE[style]));
  }

  /** 자세 배열(무기 형태별 캐시 — 중첩 객체라 프레임마다 문자열을 만들지 않는다) */
  _fam(cls, style, fam, which) {
    const byCls = this.fams[cls] ?? (this.fams[cls] = {});
    const byStyle = byCls[style] ?? (byCls[style] = {});
    let pair = byStyle[fam];
    if (!pair) {
      const f = ALL_FAMILIES[fam] ?? ALL_FAMILIES.castFwd2;
      const b = this._base(cls, style);
      pair = byStyle[fam] = { wind: compileKey(b, f.wind, BP), hit: compileKey(b, f.hit, BP) };
    }
    return pair[which];
  }

  /**
   * 플레이어 포즈 — out(BP) · 반환 = 투명도(순간이동 0.1초 전후)
   * @param {Float32Array} out @param {import('../../types.js').PlayerState} p @param {string} cls @param {string} style
   * @param {number} now state.tick + alpha @param {number} t 실제 시간 @param {number} x @param {number} z 보간 위치
   * @param {number} [facing] 그릴 방향(facing() — 없으면 p.facing) · 걷기 방향(몸 기준)과 누운 방향이 그린 몸에 맞게
   */
  pose(out, p, cls, style, now, t, x, z, facing = p.facing) {
    const d = CHAR_DIMS[cls];
    const base = this._base(cls, style);
    out.set(base);
    const dtT = this.lastNow > 0 ? Math.max(0, Math.min(0.5, (now - this.lastNow) * DT)) : 1;
    this.lastNow = now;
    let dist = Math.hypot(x - this.px, z - this.pz);
    if (this.fresh || dist > 2.5) dist = 0;
    const f = facing, sF = Math.sin(f), cF = Math.cos(f);
    if (dist > 1e-5) {
      const dx = x - this.px, dz = z - this.pz;
      const lx = (dx * cF - dz * sF) / dist, lz = (dx * sF + dz * cF) / dist;
      if (this.fresh || lx * this.mdx + lz * this.mdz < 0.3) { this.mdx = lx; this.mdz = lz; }
      else {
        this.mdx += (lx - this.mdx) * 0.4; this.mdz += (lz - this.mdz) * 0.4;
        const n = Math.hypot(this.mdx, this.mdz) || 1;
        this.mdx /= n; this.mdz /= n;
      }
    }
    this.px = x; this.pz = z;
    const speed = p.speed > 0 ? p.speed : Math.hypot(p.pos.x - p.prevPos.x, p.pos.z - p.prevPos.z) / DT;
    const stepL = stepLenOf(PLAYER_GAIT, speed);
    this.phase = frac(this.phase + phaseStep(dist, stepL));
    const act = p.act;
    const runs = !p.dead && (act === 'move' || act === 'dash' || (act === 'idle' && p.moving)) && speed > 0.2;
    const want = runs ? 1 : 0;
    this.amt = this.fresh ? want : this.amt + (want - this.amt) * Math.min(1, dtT * 8);
    this.fresh = false;
    const armR = style === 'fist' ? 1 : 0.35, armL = style === 'oneHandShield' || style === 'twoHand' || style === 'wandOrb' ? 0.2 : 1;
    let alpha = 1;

    if (p.dead) {
      const td = Math.max(0, (now - p.deadAt) * DT);
      bipedFall(out, td, 0.6, 0.12);
      // 화면 패스: 시선 방향(카메라 쪽 ↔ 먼 쪽)으로 누우면 55° 카메라에서 몸이 세로로 길게 보여 「서 있는 T자」로 읽혔다 —
      // 쓰러지는 동안 몸을 화면 가로(머리가 화면 왼쪽 또는 오른쪽 — 지금 방향에서 가까운 쪽)로 돌려 눕힌다
      out[BP.RYAW] = deadYawOffset(f) * ease(Math.min(1, td / 0.6));
      return 1;
    }
    if (this.amt > 0.001) bipedWalk(out, d, PLAYER_GAIT, this.phase, stepL, this.mdx, this.mdz, this.amt, armL, armR);
    else bipedBreathe(out, t, 1);

    const ph = this._ph;
    switch (act) {
      case 'attack': {
        const sw = this._swingDef(p.actSkill);
        if (sw) { this._swing(out, p, cls, style, now, sw.beh, sw.swing, d); break; }
        const fam = p.actSkill === 'magicBolt' ? 'thrust' : style === 'twoHand' ? 'overhead' : style === 'fist' ? 'punch' : style === 'staff' || style === 'wand' || style === 'wandOrb' ? 'thrust' : 'slash';
        attackPhase(now, p.actStart, p.actHit, p.actEnd, ph);
        actionPose(out, out, this._fam(cls, style, fam, 'wind'), this._fam(cls, style, fam, 'hit'), ph);
        break;
      }
      case 'cast': {
        let beh = null;
        try { beh = p.actSkill ? getSkillDef(p.actSkill).behavior : null; } catch { beh = null; }
        const fam = CAST_FAMILY[beh] ?? 'castFwd2';
        attackPhase(now, p.actStart, p.actHit, p.actEnd, ph);
        actionPose(out, out, this._fam(cls, style, fam, 'wind'), this._fam(cls, style, fam, 'hit'), ph);
        break;
      }
      case 'channel': {
        const t0 = p.channel ? p.channel.startedAt : p.actStart;
        const spin = ((now - t0) * DT) * 3 * 2 * PI;
        out[BP.RYAW] = spin;
        out[BP.RSHP] = 1.5; out[BP.RSHA] = 1.25; out[BP.RSHT] = 0; out[BP.RELB] = 0.12; out[BP.RWRI] = 3.05;
        out[BP.LSHP] = 1.3; out[BP.LSHA] = 1.15; out[BP.LELB] = 0.4;
        out[BP.HIPY] = d.hipY - 0.07;
        out[BP.LFX] = d.footW + 0.08; out[BP.RFX] = -d.footW - 0.08;
        out[BP.LFZ] = 0.1; out[BP.RFZ] = -0.1; out[BP.LFY] = d.ankleY; out[BP.RFY] = d.ankleY;
        out[BP.SPITCH] = 0.1;
        break;
      }
      case 'dash': {
        out[BP.SPITCH] += 0.45; out[BP.SYAW] += 0.4;
        out[BP.RSHP] = -0.35; out[BP.RSHA] = 0.25; out[BP.RELB] = 0.6;
        out[BP.LSHP] = 0.95; out[BP.LSHA] = 0.15; out[BP.LELB] = 1.3;
        out[BP.HPITCH] -= 0.25;
        break;
      }
      case 'leap': {
        attackPhase(now, p.actStart, p.actHit, p.actEnd, ph);
        actionPose(out, out, this._fam(cls, style, 'slamDown', 'wind'), this._fam(cls, style, 'slamDown', 'hit'), ph);
        const a = p.air;
        if (a) {
          const flightEnd = p.actStart + ticks(leapLand());
          const fl = clamp01((now - a.start) / Math.max(1, flightEnd - a.start));
          if (now < a.start) out[BP.HIPY] -= 0.15 * ease((now - p.actStart) / Math.max(1, a.start - p.actStart));
          else if (fl < 1) {
            const k = Math.sin(PI * fl);
            out[BP.RY] = 2.0 * 4 * fl * (1 - fl);
            out[BP.LFY] += 0.38 * k; out[BP.RFY] += 0.3 * k; out[BP.LFZ] += 0.18 * k; out[BP.RFZ] += 0.05 * k;
          } else out[BP.HIPY] -= 0.16 * (1 - clamp01((now - flightEnd) / ticks(0.3)));
        }
        break;
      }
      case 'blink': {
        alpha = clamp01(Math.abs(now - p.actHit) / 3);
        out[BP.LSHA] = 0.6; out[BP.RSHA] = 0.6; out[BP.LELB] = 0.7; out[BP.RELB] = 0.7;
        break;
      }
      case 'recall': {
        const k = ease((now - p.actStart) / ticks(0.25));
        kneel(out, d, k);
        break;
      }
      default:
        break;
    }
    return alpha;
  }
}

/** 도약 착지(공중 무적이 끝나는 초 — 데이터) */
function leapLand() {
  try { return getSkillDef('leap').params?.invuln?.[1] ?? 0.45; } catch { return 0.45; }
}

/** 무릎 꿇기(귀환 시전) */
/**
 * 쓰러진 몸의 yaw 보정 — 등으로 넘어진 몸(머리 = 등 쪽)이 화면 가로로 눕게 하는 facing 의 덧셈값(가까운 쪽 · [−π/2, π/2]).
 * 화면 가로 = 카메라 방위 ± π/2 의 방향(§0.2) — 그 축에 몸이 놓이면 55° 카메라에서도 키 그대로의 길이로 「누운 몸」이 보인다.
 * @param {number} facing @returns {number}
 */
export function deadYawOffset(facing) {
  const wrap = (a) => a - 2 * PI * Math.round(a / (2 * PI));
  const a = wrap(CAM_AZIMUTH + PI / 2 - facing);
  const b = wrap(CAM_AZIMUTH - PI / 2 - facing);
  return Math.abs(a) <= Math.abs(b) ? a : b;
}

function kneel(out, d, k) {
  const tgt = {
    HIPY: d.hipY * 0.55, LFZ: -0.42, LFY: d.ankleY + 0.02, RFZ: 0.32, RFY: d.ankleY, SPITCH: 0.2, HPITCH: 0.3,
    RSHP: 0.85, LSHP: 0.85, RSHA: -0.25, LSHA: -0.25, RELB: 1.4, LELB: 1.4, RSHT: -0.3, LSHT: -0.3,
  };
  for (const key of Object.keys(tgt)) { const i = BP[key]; out[i] += (tgt[key] - out[i]) * k; }
}

// ───────────────────────── 왼손 IK(양손 무기) ─────────────────────────

const _S = new Vector3(), _T = new Vector3(), _E = new Vector3(), _a = new Vector3(), _n = new Vector3(), _x = new Vector3(), _y = new Vector3(), _z = new Vector3(), _pole = new Vector3();

/**
 * 왼팔을 목표(무기 틀 로컬 grip 점)에 붙인다 — 위팔 · 아래팔 · 손 행렬을 바로 쓴다(팔꿈치는 아래 · 바깥 · 뒤)
 * @param {Matrix4[]} J @param {any} d @param {number} gripY 무기 틀 y(손잡이 아래쪽)
 */
export function leftHandToGrip(J, d, gripY) {
  const e = J[BJ.wR].elements;
  _T.set(e[4] * gripY + e[12], e[5] * gripY + e[13], e[6] * gripY + e[14]);
  const s = J[BJ.shL].elements;
  _S.set(s[12], s[13], s[14]);
  const c = J[BJ.chest].elements;
  // 팔꿈치 방향: 가슴 틀의 (바깥 +X 0.5, 아래 −1, 뒤 −0.3)
  _pole.set(c[0] * 0.5 - c[4] - c[8] * 0.3, c[1] * 0.5 - c[5] - c[9] * 0.3, c[2] * 0.5 - c[6] - c[10] * 0.3);
  const L1 = d.upper, L2 = d.fore;
  _a.subVectors(_T, _S);
  let D = _a.length();
  if (D < 1e-4) return;
  _a.multiplyScalar(1 / D);
  D = Math.min(D, (L1 + L2) * 0.999);
  _T.copy(_S).addScaledVector(_a, D);
  const cosA = Math.max(-1, Math.min(1, (L1 * L1 + D * D - L2 * L2) / (2 * L1 * D)));
  const sinA = Math.sqrt(1 - cosA * cosA);
  _n.copy(_pole).addScaledVector(_a, -_pole.dot(_a));
  if (_n.lengthSq() < 1e-8) _n.set(0, -1, 0);
  _n.normalize();
  _E.copy(_S).addScaledVector(_a, L1 * cosA).addScaledVector(_n, L1 * sinA);
  // 위팔: −Y 가 어깨 → 팔꿈치 · +Z 는 아래팔이 굽는 쪽
  _y.subVectors(_S, _E).normalize();
  _z.subVectors(_T, _E);
  _z.addScaledVector(_y, -_z.dot(_y));
  if (_z.lengthSq() < 1e-8) _z.copy(_n).negate();
  _z.normalize();
  _x.crossVectors(_y, _z);
  J[BJ.shL].makeBasis(_x, _y, _z).setPosition(_S);
  // 아래팔: −Y 가 팔꿈치 → 손 · 같은 경첩 축(X)
  _y.subVectors(_E, _T).normalize();
  _z.crossVectors(_x, _y).normalize();
  _x.crossVectors(_y, _z);
  J[BJ.elL].makeBasis(_x, _y, _z).setPosition(_E);
  J[BJ.haL].copy(J[BJ.elL]).setPosition(_T);
  J[BJ.wL].copy(J[BJ.haL]);
}

// ───────────────────────── NPC ─────────────────────────

/** NPC 변형(마을 물체 look) → 외형 · 치수 · 대기 동작 */
export const NPC_LOOKS = {
  npcSmith: { cls: 'warrior', dims: 'npcSmith', idle: 'hammer' },
  npcGrocer: { cls: 'warrior', dims: 'warrior', idle: 'belly' },
  npcGambler: { cls: 'warrior', dims: 'warrior', idle: 'shuffle' },
  npcMystic: { cls: 'mage', dims: 'mage', idle: 'staff' },
};

/** NPC 외형 @param {string} look */
export function npcLook(look) {
  const n = NPC_LOOKS[look] ?? NPC_LOOKS.npcGrocer;
  return { cls: n.cls, weapon: null, offhand: null, helm: null, chest: null, gloves: null, boots: null, belt: null, npc: Object.prototype.hasOwnProperty.call(NPC_LOOKS, look) ? look : 'npcGrocer' };
}

/** NPC 대기 동작(실제 시간 — §9.5 「대기 동작」) @param {Float32Array} out @param {string} kind @param {number} t */
export function npcIdle(out, base, kind, t) {
  out.set(base);
  bipedBreathe(out, t, 1.2);
  switch (kind) {
    case 'hammer': {
      const c = t * 2.4;
      const up = Math.max(0, Math.sin(c));
      out[BP.RSHP] = 0.5 + 1.3 * up; out[BP.RSHA] = 0.2; out[BP.RELB] = 1.4 - 0.6 * up; out[BP.RWRI] = 1.8;
      out[BP.LSHP] = 0.6; out[BP.LELB] = 1.0; out[BP.SPITCH] += 0.15;
      break;
    }
    case 'belly':
      out[BP.LSHP] = 0.5; out[BP.RSHP] = 0.5; out[BP.LELB] = 1.6; out[BP.RELB] = 1.6; out[BP.LSHT] = -0.9; out[BP.RSHT] = -0.9;
      out[BP.HYAW] = 0.35 * Math.sin(t * 0.4);
      break;
    case 'shuffle':
      out[BP.LSHP] = 0.7; out[BP.RSHP] = 0.75; out[BP.LELB] = 1.5; out[BP.RELB] = 1.4; out[BP.LSHT] = -0.7; out[BP.RSHT] = -0.7;
      out[BP.HPITCH] += 0.15 + 0.08 * Math.sin(t * 1.3); out[BP.SROLL] += 0.05 * Math.sin(t * 0.8);
      break;
    case 'staff':
      out[BP.LSHP] = 0.45; out[BP.LSHA] = 0.15; out[BP.LELB] = 0.9; out[BP.LWRI] = 0.9;
      out[BP.RSHP] = 0.5 + 0.25 * Math.sin(t * 0.7); out[BP.RELB] = 1.1; out[BP.HPITCH] += 0.1;
      break;
    default:
      break;
  }
  return out;
}

export { NPC_GAIT, STYLE_BASE, PLAYER_FAMILIES, ALL_FAMILIES, fkBiped };
