// OWNER: P15 — 계약 §12.1 「줍기 · 가방」 · §6.16
// 줍기 대상 고르기(lootSafeR 안에 깨어 있는 몬스터가 없을 때 lootRadius 안 — 전설 · 세트 · 희귀 먼저 · 닿는 것만(흐름장 걸음 수 — 몬스터 대상과 같은 규칙)) · 주운 장비 비교 · 장착(compareEquip).
// 리뷰 수정: 쫓던 드랍은 경계 여유(lootMemoryPad)까지 놓지 않는다 · 드랍 ID 와 따로 「바닥 드랍 수가 줄지 않는」 진척 시계로도 포기한다(두 드랍 번갈아 누르기 라이브락).
// 화면 밖이라도 미니맵에 보이는 장비(등급색 점 — P10 minimap)는 lootMemoryR 안이면 주우러 돌아간다(싸우는 동안 멀리 떨어진 것 · §7.14 「봇이 장비를 전부 줍는다」).
// 가방이 차서 줍지 못하는 장비가 보이면 표시해 두고(봇이 귀환을 정한다 — rift.stats.bagFullRecall 은 sim 이 센다).

import { ECON } from '../data/economy.js';
import { roundTo } from '../core/math.js';
import { ticks } from '../core/time.js';
import { compareEquip } from '../sim/loot/compare.js';
import { isBagFull } from '../sim/progression/inventory.js';
import { powerScore } from '../sim/loot/stats.js';
import { flowDist } from '../sim/world/flow.js';

/** @typedef {import('../types.js').Drop} Drop */
/** @typedef {import('./sense.js').Sense} Sense */

/** 줍는 차례(작을수록 먼저) — 장비 등급 · 그 밖(골드 · 재료 · 포션) */
const RARITY_RANK = { legendary: 0, set: 0, rare: 1, magic: 2, normal: 3 };
const OTHER_RANK = 4;

/** 드랍 자리(0.5m 칸)와 이웃 8칸 — 벽 · 소품 옆에 흩어진 드랍도 흐름장 걸음 수를 본다 */
const NEAR9 = [[0, 0], [-0.5, 0], [0.5, 0], [0, -0.5], [0, 0.5], [-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]];

/**
 * 리뷰 수정: 닿는 드랍인가 — 흐름장(플레이어 중심) 걸음 수가 직선의 reachMul 배 + reachPad 안(몬스터 대상과 같은 규칙 · combat.js reachable).
 * 벽 너머 긴 우회(직선 12m · 경로 70m)의 드랍을 고르면 그쪽으로 몇 걸음 가다 화면 · 반경 밖으로 나가 다른 드랍으로 바뀌고, 돌아오면 다시 골라 영영 떨었다.
 * 흐름장이 없으면(검사용 가짜 봇) 닿는다고 본다.
 * @param {any} bot @param {Drop} d @param {number} dist
 */
function dropReachable(bot, d, dist) {
  const ctx = bot.sim?.ctx;
  if (!ctx || !ctx.flow || !ctx.map) return true;
  let steps = Infinity;
  for (let k = 0; k < NEAR9.length; k++) steps = Math.min(steps, flowDist(ctx.flow, ctx.map, d.pos.x + NEAR9[k][0], d.pos.z + NEAR9[k][1]));
  if (!Number.isFinite(steps)) return false;
  return steps <= (dist / 0.5) * bot.rules.reachMul + bot.rules.reachPad;
}

/** 깨어 있는 몬스터가 R 안에 있는가 @param {Sense} sv @param {number} R */
export function awakeWithin(sv, R) {
  for (let i = 0; i < sv.mons.length; i++) if (sv.mons[i].awake && sv.dist[i] <= R) return true;
  return false;
}

/**
 * 주울 드랍 — 깨어 있는 몬스터가 lootSafeR 안에 없을 때(완료 뒤에는 늘) lootRadius 안: 장비(가방에 자리가 있으면 · 등급 순) → 골드 · 재료 · 포션(상한 아래).
 * 가방이 차서 못 줍는 장비가 있으면 bot.bagBlocked = true. 포기한 드랍(lootGiveUpSec)은 건너뛴다. 구슬은 globeInput 이 맡는다.
 * @param {any} bot @param {Sense} sv @returns {Drop|null}
 */
export function lootTarget(bot, sv) {
  const st = bot.sim.state;
  const ch = st.char;
  const rift = st.rift;
  if (!ch || !rift) return null;
  const P = bot.params;
  if (rift.phase !== 'complete' && awakeWithin(sv, P.lootSafeR)) return null;
  const bagFree = !isBagFull(ch);   // 피드백 2 D4: 든 아이템 < BAG_SIZE(넘친 옛 세이브면 못 줍는다)
  const tick = sv.tick;
  let best = null, br = Infinity, bd = Infinity;
  bot.bagBlocked = false;
  const lt = bot.lootTry;
  /** 후보 하나 — maxR 안 · 닿는 것(리뷰 수정) · 등급 순 · 가까운 순 @param {Drop} d @param {number} maxR */
  const consider = (d, maxR) => {
    if (d.gone || d.kind === 'globe') return;
    if ((bot.lootIgnore.get(d.id) ?? -1) > tick) return;
    const dist = Math.hypot(d.pos.x - sv.px, d.pos.z - sv.pz);
    if (dist > maxR) return;
    let rank = OTHER_RANK;
    if (d.kind === 'item') {
      if (!bagFree) { bot.bagBlocked = true; return; }
      rank = RARITY_RANK[d.rarity ?? 'normal'] ?? 3;
    } else if (d.kind === 'potion') {
      if (ch.potions >= ECON.potionMax) return;
    }
    if (!(rank < br || (rank === br && dist < bd))) return;
    if (!dropReachable(bot, d, dist)) return;
    br = rank; bd = dist; best = d;
  };
  // 화면 안(lootRadius) — 등급 순 · 가까운 순
  for (const d of sv.drops) consider(d, P.lootRadius);
  // 리뷰 수정: 쫓던 드랍은 화면 · lootRadius 경계를 조금 넘어도(lootMemoryPad) 그대로 후보 — 길이 잠깐 멀어지는 쪽으로 돌면
  //   화면(viewR) · 반경 밖으로 나가 다른 드랍으로 바뀌고, 그쪽으로 가면 다시 들어와 바뀌어 두 드랍을 번갈아 눌렀다(봇 실측 · 균열 10)
  if (lt.id >= 0 && tick - lt.last <= ticks(bot.rules.lootTryGapSec)) {
    for (const d of rift.drops) if (d.id === lt.id) { consider(d, P.lootRadius + bot.rules.lootMemoryPad); break; }
  }
  // 화면 밖의 장비(미니맵에 등급색 점으로 보인다 — 싸우는 동안 멀리 떨어진 것) — lootMemoryR 안의 가장 가까운 것으로 돌아간다
  if (!best && bagFree) {
    const R = bot.rules.lootMemoryR;
    for (const d of rift.drops) {
      if (d.gone || d.kind !== 'item' || (bot.lootIgnore.get(d.id) ?? -1) > tick) continue;
      const dist = Math.hypot(d.pos.x - sv.px, d.pos.z - sv.pz);
      // 밸런스 게이트: 쫓던 드랍은 lootMemoryPad 만큼 더 멀어도 놓지 않는다(경계 40m 에서 줍기 ↔ 탐색이 틱마다 뒤집혀 제자리에서 떨었다)
      if (dist > R + (d.id === bot.lootTry.id ? bot.rules.lootMemoryPad : 0) || dist >= bd) continue;
      bd = dist; best = d;
    }
  }
  // 같은 드랍을 너무 오래 쫓으면 버린다
  // 밸런스 게이트: 잠깐 다른 일을 해도(lootTryGapSec 안) 같은 드랍이면 쫓은 시간을 이어 센다 — 전에는 고르지 않은 틱마다 시계가 0 으로 돌아가 포기가 오지 않았다
  if (best) {
    const giveUp = (/** @type {Drop} */ d) => {
      bot.lootIgnore.set(d.id, tick + ticks(bot.rules.lootIgnoreSec));
      lt.id = -1;
      bot.note('lootGiveUp', { id: d.id });
    };
    if (lt.id !== best.id || tick - lt.last > ticks(bot.rules.lootTryGapSec)) { lt.id = best.id; lt.since = tick; }
    else if (tick - lt.since > ticks(bot.rules.lootGiveUpSec)) { giveUp(best); return null; }
    lt.last = tick;
    // 리뷰 수정: 진척 시계 — 고르는 드랍이 바뀌어도(드랍 ID 시계가 돌아가도) 줍기를 이어 가는 동안 바닥 드랍 수가 lootGiveUpSec 넘게 줄지 않으면 지금 것을 버린다
    //   (두 드랍을 번갈아 누르는 모양은 ID 가 계속 바뀌어 위의 포기가 오지 않았다)
    const ls = bot.lootStall ?? (bot.lootStall = { since: tick, last: -1e9, live: Infinity });
    let live = 0;
    for (const d of rift.drops) if (!d.gone) live++;
    if (live < ls.live || tick - ls.last > ticks(bot.rules.lootTryGapSec)) { ls.since = tick; ls.live = live; }
    else if (live > ls.live) ls.live = live;
    ls.last = tick;
    if (tick - ls.since > ticks(bot.rules.lootGiveUpSec)) {
      ls.since = tick;
      giveUp(best);
      return null;
    }
  }
  return best;
}

/**
 * 가방의 새 장비를 장착 중인 것과 비교해 낫다면 낀다 — compareEquip 의 ok(클래스 · 레벨) · power 상승 비율 > equipMinGain.
 * 레벨이 오르면 가방 전부를 다시 본다(요구 레벨). → 낀 수
 * @param {any} bot @returns {number}
 */
export function checkEquip(bot) {
  const sim = bot.sim;
  const st = sim.state;
  const ch = st.char;
  if (!ch || st.pendingTravel) return 0;
  const eq = bot.equipSeen;
  if (eq.level !== ch.level) { eq.level = ch.level; eq.ids.clear(); }
  let n = 0;
  for (let guard = 0; guard < 4; guard++) {
    let changed = false;
    for (let idx = 0; idx < ch.bag.length; idx++) {
      const item = ch.bag[idx];
      if (!item || eq.ids.has(item.id)) continue;
      eq.ids.add(item.id);
      const r = compareEquip(ch, item);
      if (!r.ok || !r.slot) continue;
      const before = powerScore(r.before);
      const gain = before > 0 ? r.delta.power / before : r.delta.power > 0 ? 1 : 0;
      if (!(gain > bot.params.equipMinGain)) continue;
      const res = sim.equip({ where: 'bag', idx }, r.slot);
      if (res && res.ok) {
        n++;
        bot.counters.equips++;
        bot.note('equip', { slot: r.slot, itemId: item.id, rarity: item.rarity, gain: roundTo(gain, 3) });
        changed = true;
        break;   // 가방이 바뀌었다(벗은 것이 그 칸에) — 처음부터 다시
      }
    }
    if (!changed) break;
  }
  if (eq.ids.size > bot.rules.equipSeenCap) eq.ids.clear();
  return n;
}
