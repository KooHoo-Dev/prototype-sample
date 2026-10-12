// OWNER: P15 — 계약 §12.1 「마을 정비」 · §6.16 · §11.13
// 마을에서의 봇: 사람처럼 NPC 앞까지 걸어가 INTERACT 를 받은 뒤에만 그 상점의 명령을 부른다(state.town.lastInteract · 도착).
// 차례: 대장장이(가방 전부 팔기 · 일괄 수리) → 잡화상(포션 potionsTo · 두루마리 scrollsTo 까지 · 살 수 없으면 무료) → 균열석(레벨 선택 · 열기)
// 또는 마을 포털(가방이 차서 귀환했으면 같은 자리로). 상점마다 명령 뒤 BOT.townSec 만큼 서서 step 한다(사람이 패널을 보는 시간 — playSec 에 들어간다).
// 부활해 온 마을이면 정비 없이 반응 지연 뒤 Enter(복귀 — sim.returnToRift).
// 도박 · 재굴림 · 제작 · 보관함은 쓰지 않는다(측정의 한계 — §12.6).

import { PICKUP } from '../data/combat.js';
import { ticks } from '../core/time.js';
import { getObject } from '../sim/entities.js';
import { repairCost } from '../sim/progression/inventory.js';
import { canTakeFree, pricePotion, priceScroll } from '../sim/progression/shops.js';
import { chooseLevel } from './build.js';

/** @typedef {import('../types.js').InputFrame} InputFrame */

/**
 * 마을 계획(마을에 들어설 때 한 번)
 * @typedef {Object} TownPlan
 * @property {'return'|'portal'|'new'} mode   부활 복귀 · 귀환 뒤 같은 자리로 · 새 균열
 * @property {string[]} queue                 남은 들를 곳(물체 ID)
 * @property {string|null} cur @property {number} curAt   지금 가는 곳 · 가기 시작한 틱
 * @property {boolean} arrived @property {number} waitUntil @property {number} clickAt
 * @property {number} returnAt               부활 복귀: Enter 를 누를 틱
 * @property {boolean} done
 */

/** 대장장이에 들를 일이 있는가(가방에 팔 것 · 고칠 것) @param {any} ch */
export function needsBlacksmith(ch) {
  if (!ch) return false;
  if (ch.bag.some(it => it && !it.flags?.locked)) return true;
  return repairCost(ch) > 0;
}

/** 잡화상에 들를 일이 있는가(채울 소모품이 있고 살 수 있거나 무료) @param {any} ch @param {any} P BOT */
export function needsGeneral(ch, P) {
  if (!ch) return false;
  const pot = ch.potions < P.potionsTo && (ch.gold >= pricePotion(ch) || canTakeFree(ch, 'potion'));
  const scr = ch.scrolls < P.scrollsTo && (ch.gold >= priceScroll(ch) || canTakeFree(ch, 'scroll'));
  return pot || scr;
}

/**
 * 마을에 들어선 틱의 계획 — 부활해 왔고(returnPrompt) 균열이 살아 있으면 'return' · 균열이 진행 중이면(가방 귀환) 정비 뒤 'portal' · 아니면 정비 뒤 'new'
 * @param {any} bot @returns {TownPlan}
 */
export function planTown(bot) {
  const st = bot.sim.state;
  const rift = st.rift;
  const tick = st.tick;
  const live = !!rift && (rift.phase === 'active' || rift.phase === 'guardian') && !bot.abandonRift;
  /** @type {TownPlan} */
  const plan = { mode: 'new', queue: [], cur: null, curAt: tick, arrived: false, waitUntil: -1, clickAt: -1, returnAt: -1, done: false };
  if (live && st.town.returnPrompt) {
    plan.mode = 'return';
    plan.returnAt = tick + bot.reactTicks();
  } else {
    plan.mode = live ? 'portal' : 'new';
    plan.queue = ['blacksmith', 'general', live ? 'townPortal' : 'riftStone'];
  }
  bot.note('town', { mode: plan.mode });
  return plan;
}

/** 다음 들를 곳으로(필요 없는 상점은 건너뛴다) @param {any} bot @param {TownPlan} plan */
function advance(bot, plan) {
  const ch = bot.sim.state.char;
  const tick = bot.sim.state.tick;
  while (plan.queue.length) {
    const id = plan.queue[0];
    if (id === 'blacksmith' && !needsBlacksmith(ch)) { plan.queue.shift(); continue; }
    if (id === 'general' && !needsGeneral(ch, bot.params)) { plan.queue.shift(); continue; }
    break;
  }
  plan.cur = plan.queue[0] ?? null;
  plan.curAt = tick;
  plan.arrived = false;
  plan.waitUntil = -1;
  plan.clickAt = -1;
  if (!plan.cur) plan.done = true;
}

/**
 * 마을 입력 — 지금 들를 곳의 물체를 누른다(hover object · 커서는 물체 자리 · 걸어가는 것은 sim 의 상호작용 의도) · 명령 뒤에는 서 있는다
 * @param {any} bot @param {InputFrame} inp
 */
export function townFrame(bot, inp) {
  const plan = bot.townPlan;
  if (!plan || plan.mode === 'return' || plan.done) return;
  if (plan.cur === null && !plan.done) advance(bot, plan);
  if (!plan.cur) return;
  if (plan.arrived) return;   // 패널을 보는 시간 — 서 있는다
  const st = bot.sim.state;
  const o = getObject(bot.sim.ctx, plan.cur);
  if (!o) return;
  const p = st.player;
  const going = p.intent && p.intent.kind === 'interact' && p.intent.objectId === plan.cur;
  const edge = !going && st.tick >= plan.clickAt;
  bot.clickObject(inp, o.id, o.x, o.z, edge);
  if (edge) plan.clickAt = st.tick + ticks(bot.rules.interactRetrySec);
}

/**
 * 마을 명령(step 뒤) — 도착(INTERACT — lastInteract · 의도 끝 · 반경 안)하면 그 상점의 명령 → townSec 대기 → 다음. 균열석이면 레벨을 골라 연다.
 * 부활 복귀면 반응 지연 뒤 sim.returnToRift(Enter). 오래 닿지 못한 곳은 건너뛴다.
 * @param {any} bot
 */
export function townAfter(bot) {
  const sim = bot.sim;
  const st = sim.state;
  const plan = bot.townPlan;
  if (!plan || plan.done || st.pendingTravel) return;
  const tick = st.tick;
  if (plan.mode === 'return') {
    if (tick >= plan.returnAt) {
      const r = sim.returnToRift();
      bot.counters.keys++;
      bot.note('returnToRift', { ok: !!r?.ok, reason: r?.reason });
      plan.done = true;
      if (!r || !r.ok) {
        // 균열이 닫혔다 등 — 새 계획(정비 뒤 새 균열)
        bot.townPlan = planTown(bot);
        bot.townPlan.mode = 'new';
        bot.townPlan.queue = ['blacksmith', 'general', 'riftStone'];
      }
    }
    return;
  }
  if (!plan.cur) { advance(bot, plan); if (!plan.cur) return; }
  const p = st.player;
  if (!plan.arrived) {
    const o = getObject(sim.ctx, plan.cur);
    const near = o && Math.hypot(p.pos.x - o.x, p.pos.z - o.z) <= o.r + PICKUP.interactReach + 0.05;
    if (o && near && st.town.lastInteract === plan.cur && p.intent.kind === 'none') {
      plan.arrived = true;
      doShop(bot, plan.cur);
      const sec = bot.params.townSec[plan.cur] ?? 0;
      plan.waitUntil = tick + ticks(sec);
      return;
    }
    if (tick - plan.curAt > ticks(bot.rules.interactGiveUpSec)) {
      bot.note('townSkip', { id: plan.cur });
      plan.queue.shift();
      advance(bot, plan);
    }
    return;
  }
  if (tick < plan.waitUntil) return;
  if (plan.cur === 'riftStone') openNext(bot);
  plan.queue.shift();
  advance(bot, plan);
}

/** 상점 명령(INTERACT 뒤) @param {any} bot @param {string} id */
function doShop(bot, id) {
  const sim = bot.sim;
  const ch = sim.state.char;
  const P = bot.params;
  if (!ch) return;
  if (id === 'blacksmith') {
    /** @type {Array<{where:'bag', idx:number}>} */
    const refs = [];
    for (let i = 0; i < ch.bag.length; i++) if (ch.bag[i] && !ch.bag[i].flags?.locked) refs.push({ where: 'bag', idx: i });
    if (refs.length) {
      const r = sim.sellMany(refs);
      bot.note('sell', { ok: !!r?.ok, sold: r?.sold ?? 0, gold: r?.gold ?? 0 });
      if (r?.ok) bot.counters.sold += r.sold ?? 0;
    }
    if (repairCost(ch) > 0) {
      const r = sim.repairAll();
      bot.note('repair', { ok: !!r?.ok, cost: r?.cost ?? 0, reason: r?.reason });
      if (r?.ok) bot.counters.repairGold += r.cost ?? 0;
    }
  } else if (id === 'general') {
    for (const what of /** @type {const} */ (['potion', 'scroll'])) {
      const have = what === 'potion' ? ch.potions : ch.scrolls;
      const to = what === 'potion' ? P.potionsTo : P.scrollsTo;
      if (have >= to) continue;
      const r = what === 'potion' ? sim.buyPotions(to - have) : sim.buyScrolls(to - have);
      bot.note('buy', { what, ok: !!r?.ok, n: r?.bought ?? 0, cost: r?.cost ?? 0, reason: r?.reason });
      if ((!r || !r.ok) && canTakeFree(ch, what)) {
        const f = sim.takeFree(what);
        bot.note('free', { what, ok: !!f?.ok });
      }
    }
  }
}

/** 균열석 — 레벨을 골라 연다(안 되면 1) @param {any} bot */
function openNext(bot) {
  const sim = bot.sim;
  const ch = sim.state.char;
  if (!ch) return;
  const L = chooseLevel(bot.strategy, ch, bot.params, bot.levelOverride);
  let r = sim.openRift(L);
  if ((!r || !r.ok) && L !== 1) r = sim.openRift(1);
  bot.abandonRift = false;
  bot.note('openRift', { level: L, ok: !!r?.ok, reason: r?.reason });
}
