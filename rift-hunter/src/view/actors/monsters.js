// OWNER: P8 — 계약 §9.5 · §9.6 · §9.1 (내부 — 몬스터 인스턴싱)
// 부위 메시마다 InstancedMesh 하나(용량 = MAX_DRAWN × 그 부위를 쓰는 최대 수) — 몬스터가 10 이든 120 이든 메시 수 · 드로콜이 같다.
// 매 프레임: 보이는(32m 안) 몬스터마다 상태 → 포즈 배열(poses.js) → 관절 행렬(rig.js FK) → 부위 행렬을 인스턴스 버퍼에 쓴다(할당 없음).
// 가림 외곽선: 같은 지오메트리 · 같은 instanceMatrix 를 쓰는 쌍둥이 메시(GreaterDepth 재질) — 챔피언 · 정예 · 수호자만 색을 준다(나머지 검정 = 안 보임).
// 판정과 보이는 것(§9.6): 몸 폭 = 2 × mon.r — 인스턴스 배율 = mon.r / def.radius(rank.scale 을 다시 곱하지 않는다).
// 방향: 기록(rec)에 마지막 두 틱의 facing(fPrev · fCur · fTick)을 두고 위치와 같은 alpha 로 최단 호 보간(poses.js trackFacing) — 새 기록 · 순간이동은 끊는다.

import { Color, Euler, InstancedBufferAttribute, InstancedMesh, Matrix4 } from 'three';
import { DT } from '../../core/constants.js';
import { ticks } from '../../core/time.js';
import { DEATH, STATUS } from '../../data/combat.js';
import { getMonDef } from '../../data/index.js';
import { PART_MESHES } from './parts.js';
import {
  actionPose, attackPhase, bipedBase, bipedBreathe, bipedFall, bipedFlail, bipedFlinch, bipedStun, bipedWalk, blobBase, blobFall, blobWalk,
  clamp01, compileKey, ease, frac, launchArc, phaseStep, QUAD_PHASE, quadBase, quadFall, quadWalk, stepLenOf, trackFacing,
} from './poses.js';
import { BJ, BP, FK, NJ, NP, OJ, OP, QJ, QP, RIG, makeJoints } from './rig.js';
import { BIPED_FAMILIES, KIND_FAMILY, QUAD_FAMILIES, TEMPLATE_FALLBACK, VARIANTS } from './variants.js';

/** 그리는 몬스터 상한(§9.5) */
export const MAX_DRAWN = 160;
/** 컬링 반경(§9.1) */
export const CULL_R = 32;

// 연출 상수(§0.5 — view 의 색 · 길이)
const RANK_RIM = { champion: [0x3d7bff, 1.0], elite: [0xffd23d, 1.0], minion: [0xffd23d, 0.35], guardian: [0xff7a4a, 0.3] };
const SIL_COLOR = { champion: 0x3d7bff, elite: 0xffd23d, guardian: 0xff8a5a };
const SIL_GAIN = 0.24;
const ICE = new Color(0x9ad8ff);
const STEEL = new Color(0xb8c2cc);
const SWELL_RED = new Color(0xff3020);
const BASE_EMIT = 0.05;
const TOUGH_BODY = 1.1;
const SPAWN_RISE_SEC = 0.45;
const VANISH_TICKS = 4;
const DEAD_FALL_SEC = 0.4;
const SINK_SEC = 2;
const TELEPORT_SNAP = 2.0;
const AMT_RATE = 6;        // 걷기 섞기(1/초 — 틱 시간)
const SHIELD_RATE = 7;     // 방패 내림/올림(1/초)
const LINEAR_BP = ['RX', 'RY', 'RZ', 'HIPX', 'HIPY', 'HIPZ', 'LFX', 'LFY', 'LFZ', 'RFX', 'RFY', 'RFZ'];
const LINEAR_QP = ['RX', 'RY', 'RZ', 'BY', 'BZ', 'FLX', 'FLY', 'FLZ', 'FRX', 'FRY', 'FRZ', 'BLX', 'BLY', 'BLZ', 'BRX', 'BRY', 'BRZ'];
const JOINT_NAMES = { biped: BJ, quad: QJ, blob: OJ, nest: NJ };
const BASE_FN = { biped: bipedBase, quad: quadBase, blob: blobBase, nest: null };
const MOVE_ACTS = new Set(['move', 'flee', 'charge']);
const ATTACK_ACTS = new Set(['windup', 'cast', 'swell', 'channel', 'strike', 'recover']);
const SHIELD_DOWN_ACTS = new Set(['recover', 'stunned', 'frozen', 'flinch']);
const PI = Math.PI;

const _m = new Matrix4();
const _eu = new Euler();
const _dyn = new Matrix4();
const _c = new Color();
const _ph = { stage: 0, u: 0, r: 0 };

/** 부분 포즈의 길이 값을 크기 배율로 늘린다 */
function scaled(partial, k, linear) {
  if (!partial) return partial;
  /** @type {Record<string, number>} */
  const out = {};
  for (const key of Object.keys(partial)) {
    const name = key[0] === '+' ? key.slice(1) : key;
    out[key] = linear.includes(name) ? partial[key] * k : partial[key];
  }
  return out;
}

/**
 * 종류 하나의 실행 정보(변형 표 + 데이터) — typeId 마다 한 번
 * @param {string} typeId
 */
export function compileType(typeId) {
  const def = getMonDef(typeId);
  const vid = Object.prototype.hasOwnProperty.call(VARIANTS, def.look?.variant) ? def.look.variant : TEMPLATE_FALLBACK[def.template] ?? 'ghoul';
  const v = VARIANTS[vid];
  const rig = v.rig;
  const P = RIG[rig].P;
  const sz = def.height / 1.8;
  const base = rig === 'nest' ? nestBase() : BASE_FN[rig](v.dims, v.base);
  if (rig === 'biped' && v.float) base[BP.RY] = v.float;
  const linear = rig === 'quad' ? LINEAR_QP : LINEAR_BP;
  /** @type {Record<string, {fam:string, wind:Float32Array|null, hit:Float32Array|null}>} */
  const fams = {};
  for (const atk of def.attacks) {
    const fam = v.fam[atk.id] ?? KIND_FAMILY[atk.kind] ?? 'jab';
    const table = rig === 'biped' ? BIPED_FAMILIES : rig === 'quad' ? QUAD_FAMILIES : null;
    const keys = table ? table[fam] : null;
    fams[atk.id] = {
      fam,
      wind: keys ? compileKey(base, scaled(keys.wind, sz, linear), P) : null,
      hit: keys ? compileKey(base, scaled(keys.hit, sz, linear), P) : null,
    };
  }
  const names = JOINT_NAMES[rig];
  const colorOf = (c) => (c === 'skin' ? def.look.color : c === 'eye' ? v.eye : c);
  const parts = v.parts.map((row) => {
    const [mesh, joint, at, rot, size, color, extra] = row;
    if (!PART_MESHES[mesh]) throw new Error(`actors: unknown part mesh '${mesh}'`);
    const j = names[joint];
    if (typeof j !== 'number') throw new Error(`actors: unknown joint '${joint}' (${vid})`);
    const s = typeof size === 'number' ? [size, size, size] : size;
    const off = mesh === 'eyes' && v.eyeAt ? [at[0] + v.eyeAt[0], at[1] + v.eyeAt[1], at[2] + v.eyeAt[2]] : at;
    const local = new Matrix4();
    _m.makeRotationFromEuler(_eu.set(rot ? rot[0] : 0, rot ? rot[1] : 0, rot ? rot[2] : 0, 'XYZ'));
    local.makeScale(s[0], s[1], s[2]).premultiply(_m).setPosition(off[0], off[1], off[2]);
    _c.set(colorOf(color));
    return { mesh, j, local, size: s, r: _c.r, g: _c.g, b: _c.b, dyn: extra?.dyn ?? null, eye: mesh === 'eyes', glowMat: PART_MESHES[mesh].mat === 'glow' };
  });
  return {
    typeId, vid, v, def, rig, P, fk: FK[rig], dims: v.dims, gait: v.gait, base, fams, parts, sz,
    tips: v.tips, shield: !!v.shield, joints: RIG[rig].joints,
  };
}

function nestBase() {
  const P = new Float32Array(NP.N);
  P[NP.PILE] = 1; P[NP.CORE] = 1; P[NP.FADE] = 1; P[NP.SWELL] = 1;
  return P;
}

/** 표시용 기록(몬스터 ID 마다 · view 전용) */
function newRec(id) {
  return {
    id, seen: 0, fresh: true, px: 0, pz: 0, phase: frac(id * 0.6180339), amt: 0, mdx: 0, mdz: 1, lastNow: 0,
    snap: null, hasSnap: false, shieldDown: 0, spawnAt: -1, fPrev: 0, fCur: 0, fTick: -1,
  };
}

/**
 * 포즈 계산(순수에 가깝다 — 기록 rec 만 고친다). out = 포즈 배열 · 반환 = 그릴 배율(0 = 숨김)
 * @param {ReturnType<typeof compileType>} rt @param {import('../../types.js').MonsterState} m @param {any} rec
 * @param {number} now state.tick + alpha @param {number} t 실제 시간(초 — 숨쉬기 · 흔들림) @param {Float32Array} out @param {number} s 인스턴스 배율
 * @param {number} x @param {number} z 그릴 위치 @param {number} [facing] 그릴 방향(보간 — 없으면 m.facing) · 걷기 방향(몸 기준)과 쓰러짐이 그린 몸에 맞게
 */
export function poseMonster(rt, m, rec, now, t, out, s, x, z, facing = m.facing) {
  out.set(rt.base);
  const rig = rt.rig;
  const act = m.act;
  const fresh = rec.fresh;
  rec.fresh = false;
  const dtT = rec.lastNow > 0 ? Math.max(0, Math.min(0.5, (now - rec.lastNow) * DT)) : 1;
  rec.lastNow = now;
  // 걷기 위상(이동한 거리 / 보폭)
  const dx = x - rec.px, dz = z - rec.pz;
  let dist = Math.hypot(dx, dz);
  if (fresh || dist > TELEPORT_SNAP) dist = 0;
  rec.px = x; rec.pz = z;
  const f = facing;
  const sF = Math.sin(f), cF = Math.cos(f);
  if (dist > 1e-5) {
    const lx = (dx * cF - dz * sF) / dist, lz = (dx * sF + dz * cF) / dist;
    // 방향이 크게 바뀌면(뒷걸음 · 돌아섬) 바로 · 아니면 부드럽게
    if (fresh || lx * rec.mdx + lz * rec.mdz < 0.3) { rec.mdx = lx; rec.mdz = lz; }
    else {
      rec.mdx += (lx - rec.mdx) * 0.35;
      rec.mdz += (lz - rec.mdz) * 0.35;
      const n = Math.hypot(rec.mdx, rec.mdz) || 1;
      rec.mdx /= n; rec.mdz /= n;
    }
  }
  const tickSpeed = Math.hypot(m.pos.x - m.prevPos.x, m.pos.z - m.prevPos.z) / DT;
  const g = rt.gait;
  const stepW = stepLenOf(g, tickSpeed) * s;
  rec.phase = frac(rec.phase + phaseStep(dist, stepW));
  const moving = !m.dead && MOVE_ACTS.has(act) && (tickSpeed > 0.05 * g.refSpeed || act === 'charge');
  const amtT = moving ? 1 : 0;
  rec.amt = fresh ? amtT : rec.amt + (amtT - rec.amt) * Math.min(1, dtT * AMT_RATE);
  const stepL = stepW / s;
  let vis = 1;

  if (m.dead) {
    const td = Math.max(0, (now - m.deadAt) * DT);
    deathPose(rt, m, td, out, s, f);
    if (td > DEATH.corpseSec - SINK_SEC) {
      const k = clamp01((td - (DEATH.corpseSec - SINK_SEC)) / SINK_SEC);
      out[1] -= rt.def.height * s * 0.9 * k;
    }
    return vis;
  }

  if (rig === 'biped') {
    if (rec.amt > 0.001) bipedWalk(out, rt.dims, g, rec.phase, stepL, rec.mdx, rec.mdz, rec.amt);
    else bipedBreathe(out, t + m.id, 1);
    if (rt.v.float) out[BP.RY] = rt.v.float + 0.05 * Math.sin(t * 2 + m.id);
    if (act === 'flee') bipedFlail(out, rec.phase);
  } else if (rig === 'quad') {
    if (rec.amt > 0.001) quadWalk(out, rt.dims, g, rec.phase, stepL, rec.mdx, rec.mdz, rec.amt, act === 'charge' ? QUAD_PHASE.gallop : QUAD_PHASE.trot);
    else out[QP.BY] += 0.012 * Math.sin(t * 1.7 + m.id);
    if (act === 'charge') { out[QP.HPITCH] = 0.55; out[QP.BPITCH] += 0.08; }
  } else if (rig === 'blob') {
    if (rec.amt > 0.001) blobWalk(out, rt.dims, g, rec.phase, stepL, rec.mdx, rec.mdz, rec.amt);
    out[OP.SWELL] = 1 + 0.025 * Math.sin(t * 2.2 + m.id);
  } else {
    out[NP.CORE] = 1 + 0.08 * Math.sin(t * 2.5 + m.id);
  }

  // 공격(예비 → 판정 → 후딜)
  if (ATTACK_ACTS.has(act) && m.actId && rt.fams[m.actId]) {
    const fam = rt.fams[m.actId];
    attackPhase(now, m.actStart, m.actHit, m.actEnd, _ph);
    // rest = 지금 out(기본 + 숨쉬기) — 제자리 섞기
    if (fam.wind && fam.hit) actionPose(out, out, fam.wind, fam.hit, _ph);
    special(rt, fam.fam, out, _ph, t);
  } else if (act === 'stunned' && rig === 'biped') {
    bipedStun(out, t + m.id);
  } else if (act === 'flinch' && rig === 'biped') {
    const t0 = m.st.flinchUntil - Math.max(1, ticks(STATUS.flinchSec));
    bipedFlinch(out, (now - t0) / Math.max(1, ticks(STATUS.flinchSec)));
  } else if (act === 'flinch' && rig === 'quad') {
    out[QP.HPITCH] -= 0.4; out[QP.BZ] -= 0.1;
  } else if (act === 'vanish') {
    vis = 1 - ease((now - m.actStart) / VANISH_TICKS);
  } else if (act === 'spawning') {
    rise(out, rt, s, (now - m.actStart) / Math.max(1, m.actEnd - m.actStart));
  }
  if (rec.spawnAt >= 0) {
    const p = (now - rec.spawnAt) / ticks(SPAWN_RISE_SEC);
    if (p < 1) rise(out, rt, s, p);
    else rec.spawnAt = -1;
  }
  // 빙결: 마지막 자세 그대로
  if (act === 'frozen') {
    if (rec.hasSnap) out.set(rec.snap);
  } else {
    if (!rec.snap) rec.snap = new Float32Array(out.length);
    rec.snap.set(out);
    rec.hasSnap = true;
  }
  // 방패 해골: 후딜 · 기절 · 빙결 · 경직 동안 방패를 내린다(정면 막기가 꺼진 것이 보인다)
  if (rt.shield) {
    const want = SHIELD_DOWN_ACTS.has(act) ? 1 : 0;
    rec.shieldDown = fresh ? want : rec.shieldDown + (want - rec.shieldDown) * Math.min(1, dtT * SHIELD_RATE);
    shieldDown(out, rec.shieldDown);
  }
  return vis;
}

/** 방패 내린 자세 섞기(왼팔) */
function shieldDown(out, k) {
  if (k <= 0) return;
  out[BP.LSHP] += (0.08 - out[BP.LSHP]) * k;
  out[BP.LSHA] += (0.14 - out[BP.LSHA]) * k;
  out[BP.LSHT] += (0 - out[BP.LSHT]) * k;
  out[BP.LELB] += (0.22 - out[BP.LELB]) * k;
}

/** 솟아오름 — 땅 아래에서 p 0 → 1 */
function rise(out, rt, s, p) {
  out[1] -= rt.def.height * s * (1 - ease(p));
}

/** 공격 자세 중 절차로 만드는 것(발 구르기 · 부풀기 · 맥동) */
function special(rt, fam, out, ph, t) {
  if (fam === 'stomp' && rt.rig === 'quad' && ph.stage === 0) {
    const w = Math.sin(ph.u * PI * 3);
    out[QP.FRY] = rt.dims.ankleY + 0.17 * Math.abs(w);
    out[QP.FRZ] = rt.dims.legZf + 0.12 * Math.cos(ph.u * PI * 3);
    out[QP.HPITCH] += 0.05 * w;
  } else if (fam === 'swell' && rt.rig === 'blob') {
    const u = ph.stage === 0 ? ph.u : 1;
    out[OP.SWELL] = 1 + 0.4 * ease(u) + 0.03 * Math.sin(t * 40) * u;
    out[OP.GLOW] = u;
  } else if (fam === 'pulse' && rt.rig === 'nest') {
    const u = ph.stage === 0 ? ph.u : ph.stage === 1 ? 1 : 1 - ph.r;
    out[NP.CORE] = 1 + 0.5 * Math.sin(u * PI);
    out[NP.GLOW] = u;
  } else if (fam === 'channelUp' && rt.rig === 'biped' && ph.stage === 0) {
    out[BP.SROLL] += 0.08 * Math.sin(t * 6);
  }
}

/** 사망 자세 — 0.4초 쓰러짐 · launch 면 날아가며 구른다 */
function deathPose(rt, m, td, out, s, facing) {
  const rig = rt.rig;
  const hc = rt.def.height * 0.5 * s;
  const lie = 0.17 * rt.sz * s;
  if (rig === 'biped') {
    if (m.launch && (m.launch.x || m.launch.z)) {
      bipedFall(out, 1, 1, 0);
      launchArc(out, td, m.launch.x, m.launch.z, facing, hc, lie + 0.02, BP);
    } else {
      bipedFall(out, td, DEAD_FALL_SEC, lie);
    }
    // 변형별 누운 자세 보정(활은 팔을 따라 눕힌다 등)
    const dz = rt.v.dead;
    if (dz) {
      const k = ease(td / DEAD_FALL_SEC);
      for (const key in dz) { const i = BP[key]; out[i] += (dz[key] - out[i]) * k; }
    }
  } else if (rig === 'quad') {
    if (m.launch && (m.launch.x || m.launch.z)) {
      launchArc(out, td, m.launch.x, m.launch.z, facing, hc, lie, QP);
      out[QP.RROLL] = 1.45 * clamp01(td / 0.5);
    } else quadFall(out, td, DEAD_FALL_SEC, lie * 1.6);
  } else if (rig === 'blob') {
    blobFall(out, td, DEAD_FALL_SEC);
  } else {
    const k = ease(td / 0.6);
    out[NP.PILE] = 1 - 0.55 * k;
    out[NP.CORE] = 1 - k;
  }
}

// ───────────────────────── 인스턴서 ─────────────────────────

export class MonsterInstancer {
  /**
   * @param {import('three').Group} group @param {ReturnType<typeof import('./materials.js').makeInstanceMaterials>} mats
   */
  constructor(group, mats) {
    this.group = group;
    this.mats = mats;
    /** @type {Map<string, ReturnType<typeof compileType>>} */
    this.types = new Map();
    /** @type {Map<number, any>} */
    this.recs = new Map();
    this.frame = 0;
    this.drawn = 0;
    this.J = makeJoints(18);
    /** 리그 종류별 포즈 배열(재사용 — 프레임마다 할당하지 않는다) */
    this.poses = { biped: new Float32Array(BP.N), quad: new Float32Array(QP.N), blob: new Float32Array(OP.N), nest: new Float32Array(NP.N) };
    /** 부위 메시 → 인스턴스 메시 정보 */
    this.meshes = {};
    const uses = {};
    for (const vid of Object.keys(VARIANTS)) {
      const cnt = {};
      for (const row of VARIANTS[vid].parts) cnt[row[0]] = (cnt[row[0]] ?? 0) + 1;
      for (const k of Object.keys(cnt)) uses[k] = Math.max(uses[k] ?? 0, cnt[k]);
    }
    for (const id of Object.keys(uses)) this.meshes[id] = this._makeMesh(id, MAX_DRAWN * uses[id]);
  }

  _makeMesh(id, cap) {
    const spec = PART_MESHES[id];
    const geo = spec.make();
    const glowMat = spec.mat === 'glow';
    const mat = glowMat ? this.mats.glow : spec.mat === 'metal' ? this.mats.metal : this.mats.std;
    const glowArr = new Float32Array(cap * 4);
    if (!glowMat) geo.setAttribute('aGlow', new InstancedBufferAttribute(glowArr, 4));
    const mesh = new InstancedMesh(geo, mat, cap);
    mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = !glowMat;
    mesh.name = 'mon:' + id;
    this.group.add(mesh);
    let twin = null;
    if (!glowMat) {
      twin = new InstancedMesh(geo, this.mats.sil, cap);
      twin.instanceMatrix = mesh.instanceMatrix;
      twin.instanceColor = new InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      twin.count = 0;
      twin.frustumCulled = false;
      twin.renderOrder = 5;
      twin.visible = false;
      twin.name = 'monSil:' + id;
      this.group.add(twin);
    }
    return { mesh, twin, geo, cap, n: 0, sil: false, mat: /** @type {Float32Array} */ (mesh.instanceMatrix.array), col: /** @type {Float32Array} */ (mesh.instanceColor.array),
      glow: glowArr, glowAttr: glowMat ? null : geo.getAttribute('aGlow'), tcol: twin ? /** @type {Float32Array} */ (twin.instanceColor.array) : null, glowMat };
  }

  /** 종류 실행 정보(없는 종류 ID 면 null — 그 몬스터만 그리지 않는다 · 프레임을 깨지 않는다) @param {string} typeId */
  type(typeId) {
    let rt = this.types.get(typeId);
    if (rt === undefined) {
      try { rt = compileType(typeId); } catch { rt = null; }
      this.types.set(typeId, rt);
    }
    return rt;
  }

  /** 기록 · 메시 수 비우기(맵이 바뀔 때) */
  reset() {
    this.recs.clear();
    for (const k of Object.keys(this.meshes)) {
      const e = this.meshes[k];
      e.n = 0;
      e.mesh.count = 0;
      if (e.twin) { e.twin.count = 0; e.twin.visible = false; }
    }
  }

  /** MON_SPAWNED — 솟아오름 시작 */
  noteSpawn(id, tick) {
    let rec = this.recs.get(id);
    if (!rec) { rec = newRec(id); this.recs.set(id, rec); }
    rec.spawnAt = tick;
  }

  /**
   * @param {import('../../types.js').RiftState|null} rift @param {number} tick @param {number} alpha @param {number} t 실제 시간
   * @param {{x:number, z:number}} ct 카메라 대상 @param {number|null} hoverId @param {boolean} outlines
   */
  update(rift, tick, alpha, t, ct, hoverId, outlines) {
    this.frame++;
    const meshes = this.meshes;
    for (const k in meshes) { meshes[k].n = 0; meshes[k].sil = false; }
    let drawn = 0;
    if (rift) {
      const now = tick + alpha;
      const mons = rift.mons;
      // 살아 있는 것 먼저, 시체는 남는 자리에
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < mons.length; i++) {
          const m = mons[i];
          if (m.gone || (pass === 0) === m.dead) continue;
          if (drawn >= MAX_DRAWN) break;
          if (this._drawOne(m, tick, now, alpha, t, ct, hoverId, outlines)) drawn++;
        }
      }
    }
    this.drawn = drawn;
    for (const k in meshes) {
      const e = meshes[k];
      e.mesh.count = e.n;
      e.mesh.visible = e.n > 0;
      if (e.n > 0) {
        e.mesh.instanceMatrix.needsUpdate = true;
        /** @type {any} */ (e.mesh.instanceColor).needsUpdate = true;
        if (e.glowAttr) e.glowAttr.needsUpdate = true;
      }
      if (e.twin) {
        e.twin.count = e.n;
        e.twin.visible = e.sil && e.n > 0;
        if (e.twin.visible) /** @type {any} */ (e.twin.instanceColor).needsUpdate = true;
      }
    }
    // 오래 안 보인 기록 정리
    if ((this.frame & 63) === 0) {
      for (const [id, rec] of this.recs) if (this.frame - rec.seen > 120) this.recs.delete(id);
    }
  }

  _drawOne(m, tick, now, alpha, t, ct, hoverId, outlines) {
    const rec0 = this.recs.get(m.id);
    const fresh = !rec0;
    const rec = rec0 ?? newRec(m.id);
    if (fresh) this.recs.set(m.id, rec);
    let x, z;
    const jump = Math.hypot(m.pos.x - m.prevPos.x, m.pos.z - m.prevPos.z) > TELEPORT_SNAP;
    if (rec.fresh || jump) { x = m.pos.x; z = m.pos.z; }
    else { x = m.prevPos.x + (m.pos.x - m.prevPos.x) * alpha; z = m.prevPos.z + (m.pos.z - m.prevPos.z) * alpha; }
    if (rec.fresh) { rec.px = x; rec.pz = z; }
    rec.seen = this.frame;
    const cdx = x - ct.x, cdz = z - ct.z;
    if (cdx * cdx + cdz * cdz > CULL_R * CULL_R) return false;
    const rt = this.type(m.typeId);
    if (!rt) return false;
    const tough = m.affixes && m.affixes.indexOf('tough') >= 0;
    const s0 = m.r / rt.def.radius;
    const s = s0 * (tough ? TOUGH_BODY : 1);
    const out = this.poses[rt.rig];
    const f = trackFacing(rec, m.facing, tick, alpha, rec.fresh || jump);
    const vis = poseMonster(rt, m, rec, now, t, out, s, x, z, f);
    if (vis <= 0.01) return false;
    rt.fk(rt.dims, out, x, z, f, this.J, s * vis);
    // 색 · 발광
    const rank = m.rank;
    const rim = RANK_RIM[rank];
    let rr = 0, rg = 0, rb = 0;
    if (rim && !m.dead) { _c.setHex(rim[0]); rr = _c.r * rim[1]; rg = _c.g * rim[1]; rb = _c.b * rim[1]; }
    if (tough && !m.dead) { rr += 0.22; rg += 0.24; rb += 0.26; }
    if (hoverId === m.id && !m.dead) {
      const k = 0.55 + 0.35 * Math.sin(t * 7);
      rr = Math.max(rr, k); rg = Math.max(rg, k); rb = Math.max(rb, k);
    }
    const glowP = rt.P.GLOW;
    const gl = out[glowP] || 0;
    let emit = m.dead ? 0 : BASE_EMIT + 0.22 * gl;
    if (rt.rig === 'blob' && gl > 0) { rr += SWELL_RED.r * gl * 1.4; rg += SWELL_RED.g * gl * 1.4; rb += SWELL_RED.b * gl * 1.4; emit += 0.25 * gl; }
    const frozen = m.act === 'frozen';
    let dark = 1;
    if (m.dead) {
      const td = Math.max(0, (now - m.deadAt) * DT);
      dark = 0.62 - 0.4 * clamp01((td - (DEATH.corpseSec - SINK_SEC)) / SINK_SEC);
    }
    const silHex = outlines && !m.dead ? SIL_COLOR[rank] : undefined;
    let sr = 0, sg = 0, sb = 0;
    if (silHex !== undefined) { _c.setHex(silHex); sr = _c.r * SIL_GAIN; sg = _c.g * SIL_GAIN; sb = _c.b * SIL_GAIN; }
    const prop = rt.rig === 'biped' ? out[BP.PROP] : 0;
    const parts = rt.parts;
    for (let i = 0; i < parts.length; i++) {
      const pt = parts[i];
      const e = this.meshes[pt.mesh];
      if (!e || e.n >= e.cap) continue;
      let L = pt.local;
      if (pt.dyn) {
        L = dynLocal(pt.dyn, prop, t);
        if (!L) continue;
      }
      _m.multiplyMatrices(this.J[pt.j], L);
      const idx = e.n++;
      e.mat.set(_m.elements, idx * 16);
      let r = pt.r, g = pt.g, b = pt.b;
      if (pt.glowMat) {
        const k = m.dead ? 0.12 : pt.mesh === 'core' ? 0.6 + 0.6 * (out[NP.CORE] - 0.9) + gl * 0.8 : 1;
        r *= k; g *= k; b *= k;
      } else {
        if (frozen) { r += (ICE.r - r) * 0.5; g += (ICE.g - g) * 0.5; b += (ICE.b - b) * 0.5; }
        if (tough) { r += (STEEL.r - r) * 0.3; g += (STEEL.g - g) * 0.3; b += (STEEL.b - b) * 0.3; }
        r *= dark; g *= dark; b *= dark;
        const o4 = idx * 4;
        e.glow[o4] = rr; e.glow[o4 + 1] = rg; e.glow[o4 + 2] = rb; e.glow[o4 + 3] = emit;
        if (e.tcol) {
          const o3 = idx * 3;
          e.tcol[o3] = sr; e.tcol[o3 + 1] = sg; e.tcol[o3 + 2] = sb;
          if (sr + sg + sb > 0) e.sil = true;
        }
      }
      const o3 = idx * 3;
      e.col[o3] = r; e.col[o3 + 1] = g; e.col[o3 + 2] = b;
    }
    return true;
  }

  /** 지금 그린 인스턴스 메시 수(테스트 · 진단) */
  meshCount() {
    let n = 0;
    for (const k in this.meshes) n += 1 + (this.meshes[k].twin ? 1 : 0);
    return n;
  }

  dispose() {
    for (const k of Object.keys(this.meshes)) {
      const e = this.meshes[k];
      this.group.remove(e.mesh);
      if (e.twin) this.group.remove(e.twin);
      e.geo.dispose();
      e.mesh.dispose();
      if (e.twin) e.twin.dispose();
    }
    this.meshes = {};
    this.recs.clear();
  }
}

// ── 동적 부위(활시위 · 화살 · 떠 있는 재) ──
const BOW_TIP_Y = 0.21, BOW_TIP_Z = 0.67, BOW_NOCK_REST = 0.21, BOW_DRAW = 0.42;
const _dA = new Matrix4(), _dB = new Matrix4(), _dC = new Matrix4(), _dS = new Matrix4();

/** 활 손 틀의 동적 로컬 행렬 — PROP = 당김 0..1 */
function dynLocal(kind, prop, t) {
  if (kind === 'stringA' || kind === 'stringB') {
    const sz = kind === 'stringA' ? 1 : -1;
    const ny = BOW_NOCK_REST + BOW_DRAW * prop;
    const ay = BOW_TIP_Y, az = sz * BOW_TIP_Z;
    const vy = ny - ay, vz = -az;
    const len = Math.hypot(vy, vz);
    // 단위 시위(+Y 길이 1)를 끝(ay, az) → 시위 자리(ny, 0)로: Rx 로 +Y 를 (vy, vz) 쪽에
    const ang = Math.atan2(vz, vy);
    _dA.makeRotationX(ang);
    _dS.makeScale(1, len, 1);
    return _dB.multiplyMatrices(_dA, _dS).setPosition(0, ay, az);
  }
  if (kind === 'arrow') {
    if (prop < 0.05) return null;
    return _dC.makeTranslation(0, BOW_NOCK_REST + BOW_DRAW * prop, 0);
  }
  if (kind === 'spin') return _dyn.makeRotationY(t * 0.9);
  return null;
}

export { BOW_TIP_Y, BOW_TIP_Z };
