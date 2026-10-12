// OWNER: P15 — 계약 §12.1 「보는 것」 · §6.16 (P15 내부 파일 — 다른 패키지가 import 하지 않는다)
// 봇의 눈: 플레이어에서 BOT.viewR(11.4m — 기본 카메라 화면) 안의 몬스터 · 적대 예고 · 드랍만 모은다.
// 읽는 몬스터 필드: 위치 · 등급 · 종류 · 속성 · 생명 비율 · act · aim · awake(움직임) · 보호막 구체(st.invulnUntil — 화면의 금빛 구체).
// 읽지 않는 것: mon.ax(훅 타이머) · mon.readyAt · 화면 밖(잠든 팩 위치) · 난수 상태. 적대 예고는 「알아챔」(dodgeNotice) · 반응 지연을 거친다.

import { overlaps } from '../core/shapes.js';
import { ticks } from '../core/time.js';
import { getMonDef } from '../data/index.js';

/** @typedef {import('../types.js').MonsterState} MonsterState */
/** @typedef {import('../types.js').Effect} Effect */
/** @typedef {import('../types.js').Drop} Drop */

/**
 * 한 틱의 시야(봇마다 하나 · 매 틱 다시 채운다 — 배열은 재사용)
 * @typedef {Object} Sense
 * @property {number} tick
 * @property {MonsterState[]} mons    보이는 살아 있는 몬스터(가까운 순 아님 · 배열 순서)
 * @property {number[]} dist          mons[i] 까지의 거리(m)
 * @property {number} awakeN          그중 깨어 있는 수
 * @property {Effect[]} threats       알아챈 · 반응 지연이 지난 적대 위협(예고 중이거나 지속 판정이 남은 것)
 * @property {Drop[]} drops           보이는 드랍
 * @property {number} px @property {number} pz
 */

/** @returns {Sense} */
export function createSense() {
  return { tick: 0, mons: [], dist: [], awakeN: 0, threats: [], drops: [], px: 0, pz: 0 };
}

/** 종류 태그(melee …)를 가졌는가 — 데이터 조회(없는 종류면 false) @param {MonsterState} m @param {string} tag */
export function hasTag(m, tag) {
  let def = null;
  try { def = getMonDef(m.typeId); } catch { def = null; }
  return !!def && Array.isArray(def.tags) && def.tags.includes(tag);
}

/** 살아 있는 몬스터인가 @param {MonsterState} m */
export const aliveMon = (m) => !!m && !m.dead && !m.gone && m.hp > 0;

/** 적대 효과가 아직 위협인가 — 예고 중(start ≤ tick < hitAt) 또는 지속 판정이 남았다(tickT > 0 · tick < end) @param {Effect} e @param {number} tick */
export function effectLive(e, tick) {
  if (!e || !e.hostile || tick >= e.end) return false;
  return tick < e.hitAt || e.tickT > 0;
}

/** 효과 모양의 크기(시야 판정 여유 m) @param {Effect} e */
function extentOf(e) {
  const s = e.shape;
  if (!s) return 0;
  if (s.type === 'line') return s.len ?? 0;
  return s.r ?? 0;
}

/**
 * 시야를 채운다(균열 장면) — 몬스터 · 드랍 · 적대 위협(알아챔 · 반응 지연 · 무회피는 알아채지 않는다)
 * @param {any} bot Bot @returns {Sense}
 */
export function senseRift(bot) {
  const st = bot.sim.state;
  const sv = /** @type {Sense} */ (bot.sv);
  const rift = st.rift;
  const p = st.player;
  const R = bot.params.viewR;
  const R2 = R * R;
  const tick = st.tick;
  sv.tick = tick;
  sv.px = p.pos.x;
  sv.pz = p.pos.z;
  sv.mons.length = 0;
  sv.dist.length = 0;
  sv.awakeN = 0;
  sv.threats.length = 0;
  sv.drops.length = 0;
  if (!rift) return sv;
  const mons = rift.mons;
  for (let i = 0; i < mons.length; i++) {
    const m = mons[i];
    if (!aliveMon(m)) continue;
    const dx = m.pos.x - sv.px, dz = m.pos.z - sv.pz;
    const d2 = dx * dx + dz * dz;
    if (d2 > R2) continue;
    sv.mons.push(m);
    const d = Math.sqrt(d2);
    sv.dist.push(d);
    if (m.awake) {
      sv.awakeN++;
      // 싸움 기억 — 가장 가까운 깨어 있는 몬스터의 자리(화면 밖으로 물러선 뒤 돌아서 싸운다)
      const f = bot.mem.fight;
      if (f.tick !== tick || d < f.d) { f.x = m.pos.x; f.z = m.pos.z; f.d = d; f.tick = tick; }
    }
    bot.mem.seen.set(m.id, m.pos.x, m.pos.z, m.rank);
  }
  const drops = rift.drops;
  for (let i = 0; i < drops.length; i++) {
    const d = drops[i];
    if (d.gone) continue;
    const dx = d.pos.x - sv.px, dz = d.pos.z - sv.pz;
    if (dx * dx + dz * dz <= R2) sv.drops.push(d);
  }
  // 적대 예고 — 처음 보는 틱(또는 시작 틱)에서 반응 지연 뒤에 알아챈다 · dodgeNotice 확률(무회피 0)
  const notice = bot.strategy === 'noDodge' ? 0 : bot.params.dodgeNotice;
  const seen = bot.threatSeen;
  const effs = rift.effects;
  for (let i = 0; i < effs.length; i++) {
    const e = effs[i];
    if (!effectLive(e, tick) || e.start > tick) continue;
    let rec = seen.get(e.id);
    if (!rec) {
      const s = e.shape;
      const dx = (s?.x ?? 0) - sv.px, dz = (s?.z ?? 0) - sv.pz;
      const ext = R + extentOf(e);
      if (dx * dx + dz * dz > ext * ext) continue;   // 화면 밖
      // 밸런스 게이트: 같은 몬스터가 같은 틱에 낸 표식 묶음(잿불 비 원 다섯 · 몰타르 셋)은 한 번에 알아채거나 놓친다 — 원마다 따로 굴리면
      //   고리 원 하나를 「못 본」 채 그쪽으로 비켜 맞았다(사람은 한 패턴으로 본다)
      const gk = e.srcId + ':' + e.start;
      let g = bot.threatGroups.get(gk);
      if (!g) { g = { noticed: notice > 0 && bot.rng.chance(notice), at: tick + bot.reactTicks(), last: tick }; bot.threatGroups.set(gk, g); }
      g.last = tick;
      rec = { noticed: g.noticed, at: g.at, last: tick };
      seen.set(e.id, rec);
    }
    rec.last = tick;
    if (rec.noticed && tick >= rec.at) sv.threats.push(e);
  }
  // 오래된 기록 정리(효과는 몇 초 안에 끝난다)
  const forget = ticks(bot.rules.threatForgetSec);
  if (tick % forget === 0 && seen.size) {
    for (const [id, rec] of seen) if (tick - rec.last > forget) seen.delete(id);
    for (const [k, g] of bot.threatGroups) if (tick - g.last > forget) bot.threatGroups.delete(k);
  }
  return sv;
}

/**
 * 점 (x, z)에 반지름 rb 몸이 알아챈 위협과 겹치는가
 * @param {Sense} sv @param {number} x @param {number} z @param {number} rb
 */
export function inThreat(sv, x, z, rb) {
  const th = sv.threats;
  for (let i = 0; i < th.length; i++) if (th[i].shape && overlaps(th[i].shape, x, z, rb)) return true;
  return false;
}

/**
 * 선분 a → b 위의 표본이 위협 밖인가(구슬 · 피하기 길) — 0.5m 간격
 * @param {Sense} sv @param {number} ax @param {number} az @param {number} bx @param {number} bz @param {number} rb
 */
export function pathClearOfThreats(sv, ax, az, bx, bz, rb) {
  if (!sv.threats.length) return true;
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.ceil(len / 0.5));
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    if (inThreat(sv, ax + (bx - ax) * t, az + (bz - az) * t, rb)) return false;
  }
  return true;
}

/**
 * 몬스터 기억(보인 자리) — 봇이 본 적 있는 몬스터의 마지막 자리 · 등급(탐색 마무리 — 미니맵 · 사람의 기억)
 * Map 하나에 순수 값만 · 결정적(삽입 순서)
 */
export class SeenMemory {
  constructor() {
    /** @type {Map<number, {x:number, z:number, rank:string}>} */
    this.map = new Map();
  }
  /** @param {number} id @param {number} x @param {number} z @param {string} rank */
  set(id, x, z, rank) {
    const e = this.map.get(id);
    if (e) { e.x = x; e.z = z; e.rank = rank; return; }
    this.map.set(id, { x, z, rank });
  }
  clear() { this.map.clear(); }
}
