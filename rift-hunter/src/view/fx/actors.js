// OWNER: P13 — 계약 §9.7 (내부 — 몬스터 · 플레이어 위의 연출)
// 몬스터: 속성 오라 12(상태 mon.affixes — 오라만으로 서로 구분된다 · 강인함은 P8 재질) · 상태 표시(화상 · 빙결 · 감전 · 기절 · 냉기) ·
//   공격 예고(행의 telegraph 'glow' = 손 빛 · 시전 대상 빛기둥 / 'aimLine' = 궁수 붉은 조준선).
// 플레이어: 회오리 바람 고리(반지름 = 스킬 radius — §9.6 고리가 정본) · 돌진 먼지 자취(폭 = 스킬 width) · 귀환 빛기둥 · 버프 고리 · 마력 보호막 구체 ·
//   속박 쇠사슬 · 감속 서리 · 시전 손 빛.
// 위치 = lerp(prevPos, pos, alpha)(순간이동이면 pos) · 방향 = 몸(actors/monsters.js)과 같은 facing 보간(trackFacing — 몸에 붙는 균열 · 포신 · 손 빛이 몸과 같이 돈다)
// 진행 = 틱 · 장식 시간 L.time. 할당 없음(색은 캐시 · 수치는 표 · 방향 기록은 몬스터마다 처음 한 번).

import { CAM_AZIMUTH, CAM_ELEVATION } from '../../core/constants.js';
import { ticks } from '../../core/time.js';
import { newFacingTrack, trackFacing } from '../actors/poses.js';
import { hash01 } from './decals.js';
import { AFFIX_AURA, AURA, CAP, MON_TELE, PLAYER_FX, STATUS_FX, col } from './style.js';

const TAU = Math.PI * 2;
const JUMP_MON = 2.0;
const STAR_RX = -CAM_ELEVATION;
/** 판정 순간 연출이 있는 플레이어 행동(채널 · 돌진 · 기본 공격은 상태 · 불꽃으로) */
const HIT_ACTS = ['cast', 'leap', 'blink'];

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function prog(start, end, now) {
  if (!(end > start)) return 1;
  return clamp01((now - start) / (end - start));
}

/**
 * 균열의 몬스터 연출(살아 있는 것 · 32m 안)
 * @param {import('../FxLayer.js').FxLayer} L @param {import('../../types.js').RiftState} rift @param {number} tick @param {number} now @param {number} a
 */
export function drawMonsterFx(L, rift, tick, now, a) {
  const mons = rift.mons;
  for (let i = 0; i < mons.length; i++) {
    const m = mons[i];
    if (!m || m.gone || m.dead) continue;
    const jump = Math.hypot(m.pos.x - m.prevPos.x, m.pos.z - m.prevPos.z) > JUMP_MON;
    const x = jump ? m.pos.x : m.prevPos.x + (m.pos.x - m.prevPos.x) * a;
    const z = jump ? m.pos.z : m.prevPos.z + (m.pos.z - m.prevPos.z) * a;
    if (L.far(x, z)) continue;
    // 그린 몸과 같은 방향(몬스터 객체마다 기록 — 균열이 닫혀 몬스터가 사라지면 같이 사라진다)
    let tr = L.monFace.get(m);
    const fresh = !tr;
    if (fresh) { tr = newFacingTrack(); L.monFace.set(m, tr); }
    const f = trackFacing(tr, m.facing, tick, a, fresh || jump);
    const vanish = m.act === 'vanish';
    const st = m.st;
    if (!vanish && st) statusFx(L, m, x, z, tick, now);
    const affs = m.affixes;
    if (affs) {
      for (let k = 0; k < affs.length; k++) {
        const style = Object.prototype.hasOwnProperty.call(AFFIX_AURA, affs[k]) ? AFFIX_AURA[affs[k]] : null;
        if (!style || (vanish && style !== 'phase')) continue;
        aura(L, style, m, x, z, tick, now, f);
      }
    }
    if (!vanish && (m.act === 'windup' || m.act === 'cast') && m.actId) teleFx(L, m, x, z, now, f);
  }
}

/** 상태 표시(§9.7) — 화상 불꽃 · 빙결 얼음 껍질(몸 크기) · 감전 불꽃 튐 · 기절 별 · 냉기 푸른 기 */
function statusFx(L, m, x, z, tick, now) {
  const st = m.st, h = m.height, r = m.r, t = L.time, ph = m.id * 1.37;
  if (st.burn && st.burn.until > tick) {
    const S = STATUS_FX.burn;
    const n = Math.max(2, Math.round(S.n * L.q));
    const c0 = col(S.color), c1 = col(S.tip);
    for (let i = 0; i < n; i++) {
      const u = (t * 1.4 + i / n + hash01(m.id, i)) % 1;
      const ang = ph + i * 2.4 + t * 0.7, rr = r * 0.65 * hash01(m.id, i + 4);
      L.glyphs.pushC(x + Math.sin(ang) * rr, h * (0.15 + 0.85 * u), z + Math.cos(ang) * rr, (0.34 - 0.2 * u) * (0.7 + 0.6 * hash01(m.id, i + 9)), u < 0.5 ? c0 : c1, 0.85 * (1 - u));
    }
  }
  const frozen = m.act === 'frozen' || st.freezeUntil > tick;
  if (frozen) {
    const S = STATUS_FX.freeze;
    L.shells.mark('freeze');
    L.shells.addTRS(x, h * 0.5, z, 0, r * 1.25, h * 0.62, r * 1.25, col(S.color), S.k);
    const c = col(0xeaf8ff);
    for (let i = 0; i < 2; i++) {
      const ang = ph + i * Math.PI + t * 0.4;
      L.glyphs.pushC(x + Math.sin(ang) * r, h * (0.4 + 0.35 * i), z + Math.cos(ang) * r, 0.18, c, 0.5 + 0.4 * Math.sin(t * 7 + i * 2));
    }
  } else if (st.chill > 0) {
    const S = STATUS_FX.chill;
    const k = S.k * clamp01(st.chill / 50);
    const c = col(S.color);
    for (let i = 0; i < S.n; i++) {
      const ang = ph + (i / S.n) * TAU + t * 0.5;
      L.glyphs.pushC(x + Math.sin(ang) * r * 0.9, 0.25 + 0.15 * Math.sin(t * 2 + i), z + Math.cos(ang) * r * 0.9, r * 1.3, c, k);
    }
  }
  if (st.shockUntil > tick) {
    const S = STATUS_FX.shock;
    const seed = Math.floor(t * 20) + m.id * 13;
    const core = col(S.core), glow = col(S.glow);
    for (let k = 0; k < 2; k++) {
      if (hash01(seed, k + 20) < 0.35) continue;
      const a0 = hash01(seed, k) * TAU, y0 = h * (0.3 + 0.5 * hash01(seed, k + 3));
      const x0 = x + Math.sin(a0) * r, z0 = z + Math.cos(a0) * r;
      const a1 = a0 + (hash01(seed, k + 6) - 0.5) * 1.6;
      const x1 = x + Math.sin(a1) * r * 1.5, z1 = z + Math.cos(a1) * r * 1.5, y1 = y0 + (hash01(seed, k + 8) - 0.5) * 0.6;
      L.segs.addSeg(x0, y0, z0, x1, y1, z1, 0.07, glow, 0.6);
      L.segs.addSeg(x0, y0, z0, x1, y1, z1, 0.025, core, 1.2);
    }
  }
  if (m.act === 'stunned' || st.stunUntil > tick) {
    const S = STATUS_FX.stun;
    const c = col(S.color);
    for (let i = 0; i < S.n; i++) {
      const ang = t * S.spin + (i / S.n) * TAU;
      L.stars.mark('stun');
      L.stars.addEuler(x + Math.sin(ang) * S.r, h + 0.3 + 0.06 * Math.sin(t * 6 + i), z + Math.cos(ang) * S.r, STAR_RX, CAM_AZIMUTH, t * 3 + i, 0.24, 0.24, 0.24, c, 1.0);
    }
  }
}

/**
 * 속성 오라 하나(§9.7) — 모양 이름(AFFIX_AURA 의 값)으로 갈린다
 * @param {import('../FxLayer.js').FxLayer} L @param {string} style @param {import('../../types.js').MonsterState} m
 * @param {number} x @param {number} z 그린 위치 @param {number} tick @param {number} now @param {number} f 그린 방향(보간)
 */
function aura(L, style, m, x, z, tick, now, f) {
  const h = m.height, r = m.r, t = L.time, ph = m.id * 1.37;
  const q = L.q;
  switch (style) {
    case 'wind': {
      // 빠름 — 몸을 감도는 흰 바람 줄 셋(높이마다 반대로 돈다)
      const A = AURA.wind, c = col(A.color), R = r * A.rMul;
      L.arcs.mark('aura:wind');
      for (let i = 0; i < A.rings; i++) {
        const dir = i & 1 ? -1 : 1;
        L.arcs.addEuler(x, h * (0.25 + 0.25 * i), z, 0.22 * Math.sin(t * 3 + i + ph), t * A.spin * dir + ph + i * 2.1, 0, R * (1 + 0.08 * i), R, R * (1 + 0.08 * i), c, A.k);
      }
      break;
    }
    case 'fireGlow': {
      // 화염 강화 — 발밑 주황 빛 + 몸 빛 + 떠오르는 불씨
      const A = AURA.fireGlow, c = col(A.color);
      const pulse = 0.85 + 0.15 * Math.sin(t * 5 + ph);
      L.glow.fan(x, z, r * 1.8, 0, TAU, c, 0, A.k * pulse);
      L.glyphs.pushC(x, h * 0.5, z, Math.max(r * 2.4, h * 0.8), c, 0.22 * pulse);
      const n = Math.max(2, Math.round(A.embers * q)), ec = col(A.ember);
      for (let i = 0; i < n; i++) {
        const u = (t * 0.7 + i / n + hash01(m.id, i)) % 1;
        const ang = ph * 3 + i * 2.4 + t * 0.8, rr = r * (0.6 + 0.5 * hash01(m.id, i + 2));
        L.glyphs.pushC(x + Math.sin(ang) * rr, h * (0.2 + 0.9 * u), z + Math.cos(ang) * rr, 0.06 + 0.12 * (1 - u), ec, 0.9 * (1 - u));
      }
      break;
    }
    case 'frost': {
      // 냉기 강화 — 내려앉는 서리 입자 + 발밑 서리 고리
      const A = AURA.frost, c = col(A.color);
      L.glow.band(x, z, r * 1.05, r * 1.5, 0, TAU, col(A.ring), 0, A.k);
      const n = Math.max(3, Math.round(A.flakes * q));
      for (let i = 0; i < n; i++) {
        const u = (t * 0.35 + i / n + hash01(m.id, i)) % 1;
        const ang = ph + (i / n) * TAU + t * 0.6, rr = r * 1.15;
        L.glyphs.pushC(x + Math.sin(ang) * rr, h * (1.05 - u), z + Math.cos(ang) * rr, 0.12, c, 0.9 * (0.7 + 0.3 * Math.sin(t * 9 + i)) * (1 - 0.3 * u));
      }
      break;
    }
    case 'arcs': {
      // 번개 강화 — 몸 둘레를 튀는 전기 아크(빠르게 바뀐다)
      const A = AURA.arcs, core = col(A.core), glow = col(A.glow);
      const seed = Math.floor(t * A.hz) + m.id * 7;
      L.segs.mark('aura:arcs');
      for (let k = 0; k < A.n; k++) {
        let ang = hash01(seed, k) * TAU, y = h * (0.2 + 0.6 * hash01(seed, k + 11));
        let px = x + Math.sin(ang) * r * 1.05, pz = z + Math.cos(ang) * r * 1.05, py = y;
        for (let j = 0; j < 3; j++) {
          ang += (hash01(seed + j, k + 3) - 0.3) * 0.9;
          y += (hash01(seed + j, k + 5) - 0.5) * h * 0.25;
          const rr = r * (1.05 + 0.25 * hash01(seed + j, k + 7));
          const qx = x + Math.sin(ang) * rr, qz = z + Math.cos(ang) * rr;
          L.segs.addSeg(px, py, pz, qx, y, qz, A.width * 2.6, glow, 0.55);
          L.segs.addSeg(px, py, pz, qx, y, qz, A.width, core, 1.2);
          px = qx; pz = qz; py = y;
        }
      }
      break;
    }
    case 'bloodAura': {
      // 흡혈 — 몸을 감싼 붉은 오라(아래가 진한 기둥) + 몸으로 빨려 드는 핏빛 티끌
      const A = AURA.bloodAura;
      L.pillars.mark('aura:bloodAura');
      L.pillars.addTRS(x, 0.02, z, 0, r * 1.25, h * 1.05, r * 1.25, col(A.color), A.k * (0.75 + 0.25 * Math.sin(t * 4 + ph)));
      const n = Math.max(2, Math.round(A.motes * q)), mc = col(A.mote);
      for (let i = 0; i < n; i++) {
        const u = (t * 0.45 + i / n + hash01(m.id, i)) % 1;
        const ang = ph + i * 2.1 + u * 2, rr = r * (1.9 - 0.9 * u);
        L.glyphs.pushC(x + Math.sin(ang) * rr, h * (0.1 + 0.8 * u), z + Math.cos(ang) * rr, 0.14, mc, 0.8 * (1 - u));
      }
      break;
    }
    case 'goldGlint': {
      // 보호막 — 평소 머리 위 금빛 반짝임 둘 · 예고(ax.shielding.warnUntil) 동안 금빛 반짝임이 몸을 감싼다 · 무적(invulnUntil) 동안 금빛 구체
      const A = AURA.goldGlint, c = col(A.color);
      const sh = m.ax ? m.ax.shielding : null;
      const warn = !!sh && typeof sh.warnUntil === 'number' && sh.warnUntil > tick;
      const invul = m.st.invulnUntil > tick && m.act !== 'vanish';
      if (invul) {
        L.shells.mark('aura:goldShell');
        L.shells.addTRS(x, h * 0.5, z, 0, Math.max(r * 1.55, 0.7), Math.max(h * 0.62, 0.9), Math.max(r * 1.55, 0.7), col(A.shell), A.shellK * (0.9 + 0.1 * Math.sin(t * 6)));
      }
      const n = warn ? A.warn : A.idle;
      for (let i = 0; i < n; i++) {
        const ang = ph + (i / n) * TAU + t * (warn ? 2.5 : 0.8);
        const tw = 0.5 + 0.5 * Math.sin(t * 12 + i * 2.3);
        const y = warn ? h * (0.15 + 0.75 * ((i * 0.37 + t * 0.9) % 1)) : h * 1.08;
        const rr = r * (warn ? 1.35 : 0.55);
        L.glyphs.pushC(x + Math.sin(ang) * rr, y, z + Math.cos(ang) * rr, (warn ? 0.24 : 0.13) * (0.6 + 0.4 * tw), c, (warn ? 1 : 0.65) * tw);
      }
      break;
    }
    case 'phase': {
      // 순간이동 — 움직임을 따라오는 보라 잔상 · 사라짐(act vanish) 동안 그 자리에 보라 기둥이 흩어진다
      const A = AURA.phase, c = col(A.color);
      if (m.act === 'vanish') {
        const u = prog(m.actStart, m.actEnd, now);
        L.pillars.mark('aura:phase');
        L.pillars.addTRS(x, 0.02, z, t, r * 1.3, h * 1.1, r * 1.3, c, 0.9 * (1 - u));
        for (let i = 0; i < 6; i++) {
          const ang = ph + i * 1.05 + u * 3;
          L.glyphs.pushC(x + Math.sin(ang) * r * (1 + u), h * (0.2 + 0.7 * ((i * 0.31 + u) % 1)), z + Math.cos(ang) * r * (1 + u), 0.2, c, 0.8 * (1 - u));
        }
        break;
      }
      const vx = m.vel ? m.vel.x : 0, vz = m.vel ? m.vel.z : 0;
      for (let i = 1; i <= 2; i++) {
        L.glyphs.pushC(x - vx * 0.07 * i, h * 0.5, z - vz * 0.07 * i, Math.max(h * 0.7, r * 2), c, 0.16 / i);
      }
      const n = Math.max(2, Math.round(A.motes * q));
      for (let i = 0; i < n; i++) {
        const ang = ph + (i / n) * TAU - t * 1.6;
        const flick = 0.5 + 0.5 * Math.sin(t * 8 + i * 1.9);
        L.glyphs.pushC(x + Math.sin(ang) * r * 1.2, h * (0.3 + 0.15 * i), z + Math.cos(ang) * r * 1.2, 0.16, c, A.k * flick);
      }
      break;
    }
    case 'chains': {
      // 감옥 — 허리에 도는 쇠사슬 고리(고리마다 90° 엇갈림)
      const A = AURA.chains, c = col(A.color), R = r * A.rMul;
      const n = A.n, s = 0.17;
      L.links.mark('aura:chains');
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * TAU + t * A.spin + ph;
        L.links.addEuler(x + Math.sin(ang) * R, h * 0.45 + 0.04 * Math.sin(ang * 2), z + Math.cos(ang) * R, i & 1 ? Math.PI / 2 : 0, ang, 0, s, s, s, c);
      }
      break;
    }
    case 'cracks': {
      // 분열 — 몸에 빛나는 균열 무늬(세로로 갈라진 금 셋)
      const A = AURA.cracks, c = col(A.color);
      const k = A.k * (0.7 + 0.3 * Math.sin(t * 4 + ph));
      L.segs.mark('aura:cracks');
      for (let j = 0; j < A.n; j++) {
        let ang = f + (j / A.n) * TAU + 0.4;
        let px = x + Math.sin(ang) * r * 1.04, pz = z + Math.cos(ang) * r * 1.04, py = h * 0.15;
        for (let s = 1; s <= 4; s++) {
          ang += (hash01(m.id + j, s) - 0.5) * 0.36;
          const qy = h * (0.15 + 0.175 * s);
          const qx = x + Math.sin(ang) * r * 1.04, qz = z + Math.cos(ang) * r * 1.04;
          L.segs.addSeg(px, py, pz, qx, qy, qz, 0.045, c, k);
          px = qx; pz = qz; py = qy;
        }
      }
      break;
    }
    case 'bubbles': {
      // 역병 — 발밑 연두 얼룩 + 떠오르는 기포
      const A = AURA.bubbles, c = col(A.color);
      L.glow.fan(x, z, r * 1.5, 0, TAU, c, 0, 0.22);
      const n = Math.max(2, Math.round(A.n * q));
      for (let i = 0; i < n; i++) {
        const u = (t * 0.5 + i / n + hash01(m.id, i)) % 1;
        const ang = ph * 2 + i * 2.4, rr = r * (0.5 + 0.6 * hash01(m.id, i + 1));
        L.glyphs.pushC(x + Math.sin(ang) * rr, 0.1 + u * h * 0.9, z + Math.cos(ang) * rr, 0.12 + 0.08 * hash01(m.id, i + 2), c, A.k * 1.4 * (1 - u));
      }
      break;
    }
    case 'barrel': {
      // 몰타르 — 등에 비스듬히 선 포신 + 포구의 주황 빛
      const A = AURA.barrel;
      const back = f + Math.PI, el = 0.87;
      const bx = x + Math.sin(back) * r * 0.55, bz = z + Math.cos(back) * r * 0.55, by = h * 0.82;
      L.barrels.mark('aura:barrel');
      L.barrels.addEuler(bx, by, bz, -el, back, 0, 0.1, 0.1, 0.55, col(A.color));
      const dx = Math.sin(back) * Math.cos(el), dy = Math.sin(el), dz = Math.cos(back) * Math.cos(el);
      L.glyphs.pushC(bx + dx * 0.3, by + dy * 0.3, bz + dz * 0.3, 0.28, col(A.mouth), 0.6 + 0.3 * Math.sin(t * 5 + ph));
      break;
    }
    default: break;
  }
}

/** 공격 예고(행의 telegraph) — 'glow' = 손 빛(+ 시전 대상 빛기둥) · 'aimLine' = 궁수 붉은 조준선 */
function teleFx(L, m, x, z, now, f) {
  const info = L.monInfo(m.typeId);
  const atk = info ? info.atk[m.actId] : null;
  if (!atk) return;
  const u = prog(m.actStart, m.actHit, now);
  const h = m.height, r = m.r;
  if (atk.telegraph === 'glow') {
    const hex = atk.type === 'fire' ? MON_TELE.glowFire : atk.type === 'cold' ? MON_TELE.glowCold : atk.type === 'lightning' ? MON_TELE.glowLightning : MON_TELE.glowPhys;
    const c = col(hex);
    const fx = Math.sin(f), fz = Math.cos(f);
    L.glyphs.pushC(x + fx * r * 0.9, h * 0.72, z + fz * r * 0.9, (0.3 + 0.6 * u) * Math.max(1, h / 1.8), c, 0.5 + 0.45 * u);
    if (atk.kind === 'cast' && m.aim) {
      L.pillars.mark('tele:cast');
      L.pillars.addTRS(m.aim.x, 0.02, m.aim.z, 0, 0.45, 0.3 + 2.4 * u, 0.45, c, 0.7 * u);
    } else if (atk.kind === 'spawn') {
      L.glow.fan(x, z, r * 1.5, 0, Math.PI * 2, c, 0, 0.3 * u);
    }
  } else if (atk.telegraph === 'aimLine' && m.aim) {
    const c = col(MON_TELE.aim);
    const locked = !!m.aimLocked;
    const w = locked ? MON_TELE.aimLockedWidth : MON_TELE.aimWidth;
    L.segs.mark('tele:aim');
    L.segs.addSeg(x, 1.25, z, m.aim.x, 1.0, m.aim.z, w, c, locked ? 1.0 : 0.45 + 0.35 * u);
    L.glow.band(m.aim.x, m.aim.z, 0.22, 0.34, 0, Math.PI * 2, c, locked ? 0.8 : 0.45);
  }
}

/**
 * 플레이어 연출(마을 · 균열)
 * @param {import('../FxLayer.js').FxLayer} L @param {import('../../types.js').GameState} state @param {number} tick @param {number} now
 */
export function drawPlayerFx(L, state, tick, now) {
  const p = state.player;
  if (!p) return;
  const x = L.px, z = L.pz, t = L.time;
  // 돌진 먼지 자취(폭 = 스킬 width · §9.6) — 끝나면 0.5초에 사라지는 순간 연출로
  const dashing = !p.dead && p.act === 'dash' && p.air && p.air.kind === 'dash';
  if (dashing) {
    const def = L.skillDef(p.actSkill);
    const w = def && def.width > 0 ? def.width : 1.2;
    const d = L._dash;
    d.live = true; d.x0 = p.air.from.x; d.z0 = p.air.from.z; d.x1 = x; d.z1 = z; d.w = w;
    const L2 = Math.hypot(x - d.x0, z - d.z0);
    if (L2 > 0.05 && L.decalCount < CAP.decals) {
      L.decalCount++;
      L.decals.mark('dash', 0);
      L.decals.rect(d.x0, d.z0, Math.atan2(x - d.x0, z - d.z0), 0, L2, -w / 2, w / 2, col(PLAYER_FX.dust), 0.35);
      L.decals.unmark();
    }
    if (Math.random() < 0.6 * L.q) L.burst('dust', x, 0.2, z, 0.15, 0, 0.4);
  } else if (L._dash.live) {
    L._endDash();
  }
  if (p.dead) return;
  // 스킬 판정 순간 — ACTION_HIT 을 놓쳤으면(고정 상태 등) 지금 행동의 상태로 한 번(행동 번호 actId)
  if (p.actSkill && p.actId !== L.seenAct && tick >= p.actHit && tick <= p.actHit + 3 && HIT_ACTS.includes(p.act)) {
    L.seenAct = p.actId;
    const ax = p.actPoint ? p.actPoint.x : p.pos.x, az = p.actPoint ? p.actPoint.z : p.pos.z;
    L._skillHit(p.actSkill, p.pos.x, p.pos.z, p.facing, ax, az, p.actHit);
  }
  // 회오리 — 바람 고리(바깥 = 스킬 radius 정확히) + 도는 바람 기둥
  if (p.act === 'channel' && p.channel) {
    const def = L.skillDef(p.channel.skillId);
    const R = def && def.radius > 0 ? def.radius : 0;
    if (R > 0 && L.decalCount < CAP.decals) {
      L.decalCount++;
      const wc = col(PLAYER_FX.wind);
      L.glow.mark('whirl', 0);
      L.glow.band(x, z, R - 0.14, R, 0, TAU, wc, 0.55);
      L.glow.unmark();
      L.decals.fan(x, z, R, 0, TAU, wc, 0.05, 0.02);
      L.arcs.mark('whirl');
      for (let i = 0; i < 5; i++) {
        const rr = R * (0.6 + 0.1 * i);
        L.arcs.addEuler(x, 0.3 + 0.35 * i, z, 0.15 * Math.sin(i * 1.7), t * 18.85 + i * 1.3, 0, rr, rr, rr, wc, 0.35);
      }
      const n = Math.max(3, Math.round(6 * L.q));
      for (let i = 0; i < n; i++) {
        const ang = t * 8 + (i / n) * TAU;
        L.glyphs.pushC(x + Math.sin(ang) * R * 0.92, 0.18, z + Math.cos(ang) * R * 0.92, 0.45, wc, 0.25);
      }
    }
  }
  // 귀환 시전 — 무릎 꿇은 손의 빛 + 자라는 빛기둥
  if (p.act === 'recall' && p.recall) {
    const u = prog(p.recall.start, p.recall.end, now);
    const c = col(PLAYER_FX.recall);
    L.pillars.mark('recall');
    // 화면 패스: r 0.8 · 세기 최대 0.6 이면 무릎 꿇은 몸이 흰 기둥에 덮여 피격 · 자세가 안 보였다 — 넓고 옅게(시전 진행은 높이 · 입자가 보인다)
    L.pillars.addTRS(x, 0.02, z, t, 1.15, 0.5 + 3.5 * u, 1.15, c, 0.12 + 0.18 * u);
    L.glyphs.pushC(x + Math.sin(p.facing) * 0.35, 0.8, z + Math.cos(p.facing) * 0.35, 0.4 + 0.3 * u, c, 0.8);
    for (let i = 0; i < 5; i++) {
      const v = (t * 0.6 + i / 5) % 1, ang = i * 1.26 + t;
      L.glyphs.pushC(x + Math.sin(ang) * 0.7, v * (0.5 + 3.5 * u), z + Math.cos(ang) * 0.7, 0.14, c, 0.8 * (1 - v));
    }
  }
  // 버프(행동의 behavior 로 — buff = 금빛 고리 · shield = 푸른 구체)
  const buffs = p.buffs;
  if (buffs) {
    for (let i = 0; i < buffs.length; i++) {
      const b = buffs[i];
      if (!b || b.until <= tick) continue;
      const def = L.skillDef(b.id);
      if (!def) continue;
      if (def.behavior === 'buff') {
        const total = Math.max(1, ticks(def.params && def.params.buffSec > 0 ? def.params.buffSec : 8));
        const rem = clamp01((b.until - now) / total);
        const c = col(PLAYER_FX.gold);
        L.glow.mark('buff', 0);
        L.glow.band(x, z, 0.75, 0.95, 0, TAU * rem, c, 0.6);
        L.glow.unmark();
        for (let k = 0; k < 2; k++) {
          const v = (t * 0.5 + k * 0.5) % 1, ang = t * 1.5 + k * Math.PI;
          L.glyphs.pushC(x + Math.sin(ang) * 0.6, 0.2 + v * 1.6, z + Math.cos(ang) * 0.6, 0.14, c, 0.7 * (1 - v));
        }
      } else if (def.behavior === 'shield' && p.shield > 0) {
        const k = 0.25 + 0.75 * clamp01(p.shield / Math.max(1, b.value));
        L.shells.mark('shield');
        L.shells.addTRS(x, 0.95, z, 0, 0.85, 1.15, 0.85, col(PLAYER_FX.shield), k);
      }
    }
  }
  // 속박 — 발목의 쇠사슬 고리 / 감속 — 발밑 서리
  if (p.st && p.st.rootUntil > tick) {
    const c = col(PLAYER_FX.root);
    L.links.mark('root');
    for (let ring = 0; ring < 2; ring++) {
      const R = ring ? 0.42 : 0.62, y = ring ? 0.45 : 0.14, n = ring ? 8 : 10;
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * TAU + (ring ? 0.3 : 0) + t * 0.3;
        L.links.addEuler(x + Math.sin(ang) * R, y, z + Math.cos(ang) * R, i & 1 ? Math.PI / 2 : 0, ang, 0, 0.15, 0.15, 0.15, c);
      }
    }
  }
  if (p.st && p.st.slowUntil > tick && p.st.slowPct > 0) {
    const c = col(PLAYER_FX.slow);
    L.glow.band(x, z, 0.45, 0.85, 0, TAU, c, 0, 0.35);
    for (let i = 0; i < 3; i++) {
      const ang = t * 0.8 + (i / 3) * TAU;
      L.glyphs.pushC(x + Math.sin(ang) * 0.5, 0.2, z + Math.cos(ang) * 0.5, 0.5, c, 0.3);
    }
  }
  // 시전 손 빛(판정 전까지 자란다 — 물리 근접 공격은 없음)
  if ((p.act === 'cast' || p.act === 'blink' || p.act === 'attack') && tick < p.actHit) {
    const def = L.skillDef(p.actSkill);
    if (def && !(p.act === 'attack' && (def.type === 'phys' || !def.type))) {
      const hex = def.type === 'fire' ? PLAYER_FX.castFire : def.type === 'cold' ? PLAYER_FX.castCold : def.type === 'lightning' ? PLAYER_FX.castLightning : PLAYER_FX.castNone;
      const u = prog(p.actStart, p.actHit, now);
      const fx = Math.sin(p.facing), fz = Math.cos(p.facing);
      L.glyphs.pushC(x + fx * 0.45 - fz * 0.12, 1.25, z + fz * 0.45 + fx * 0.12, 0.15 + PLAYER_FX.windupHand * u, col(hex), 0.55 + 0.4 * u);
    }
  }
}
