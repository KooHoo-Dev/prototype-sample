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
  actionPose, attackPhase, bipedBase, bipedBreathe, bipedFall, bipedWalk, clamp01, compileKey, ease, frac, phaseStep, stepLenOf,
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
/** 스킬 동작(behavior) → 시전 자세 */
const CAST_FAMILY = { cone: 'slamDown', quake: 'slamDown', buff: 'roar', nova: 'castDown', fireball: 'castFwd2', chain: 'castFwd2', meteor: 'castUp', shield: 'castChest', boltBasic: 'thrust' };
const ALL_FAMILIES = { ...BIPED_FAMILIES, ...PLAYER_FAMILIES };

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
  }

  reset() { this.fresh = true; }

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
   */
  pose(out, p, cls, style, now, t, x, z) {
    const d = CHAR_DIMS[cls];
    const base = this._base(cls, style);
    out.set(base);
    const dtT = this.lastNow > 0 ? Math.max(0, Math.min(0.5, (now - this.lastNow) * DT)) : 1;
    this.lastNow = now;
    let dist = Math.hypot(x - this.px, z - this.pz);
    if (this.fresh || dist > 2.5) dist = 0;
    const f = p.facing, sF = Math.sin(f), cF = Math.cos(f);
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
