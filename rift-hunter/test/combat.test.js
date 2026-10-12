// OWNER: P2 — 계약 §12.2 · §5.6 · §5.7 · §5.8
// 피해 식(손 계산) · 감소 식 · 막기 · 보호막 · 가시 · 적중 회복 상한 · 최소 피해 · 상태 이상 표 · 정면 방패 · 저항 상한 · 속성 훅 호출 · 조건부 패시브.
// makeTestCtx(훅 no-op) · addTestMonster · makeTestStats 만 쓴다 — 같은 웨이브의 남의 구현에 기대지 않는다.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EV } from '../src/core/events.js';
import { makeRng } from '../src/core/rng.js';
import { ticks } from '../src/core/time.js';
import { COMBAT, STATUS } from '../src/data/combat.js';
import { MON } from '../src/data/monsters.js';
import { DRa, DRr, damageMonsterRaw, hazardHitPlayer, healPlayer, monsterHitPlayer, playerHit, playerHitShape, tickBurns } from '../src/sim/combat.js';
import { CONDS, condStatsFor } from '../src/sim/conds.js';
import { addBuff, applyChill, applyFlinch, applyKnock, applyStun, monAtkSpeedMul, monSpeedMul, rootPlayer, slowPlayer, updateStatus } from '../src/sim/status.js';
import { circle } from '../src/core/shapes.js';
import { addTestMonster, assertFiniteDeep, countEvents, makeTestCtx, makeTestState, makeTestStats } from './helpers.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));

/** 균열 1 · 전사 · 시트 덮어쓰기 · 훅 덮어쓰기 */
function setup({ stats = {}, hooks = {}, cls = 'warrior' } = {}) {
  const state = makeTestState({ cls });
  state.tick = 300;
  const ctx = makeTestCtx(state, { stats: makeTestStats({ cls, ...stats }), hooks });
  return { state, ctx, p: state.player };
}

/** 플레이어 옆(북쪽 2m)에 몬스터 */
function monNear(ctx, opts = {}) {
  const p = ctx.state.player.pos;
  return addTestMonster(ctx, { x: p.x, z: p.z + 2, ...opts });
}

/** 적중 정의 */
function spec(ctx, extra = {}) {
  const p = ctx.state.player.pos;
  return { skillId: 'bash', coef: 1, type: 'phys', tags: ['melee'], actionId: 1000, srcX: p.x, srcZ: p.z, ...extra };
}

test('플레이어 → 몬스터: §5.6 식 그대로(무기 굴림 · 주 능력치 · 보너스 합 · 정예 추가 · 치명타 · 감전 · 저항)', () => {
  const { state, ctx } = setup({
    stats: { dmgPct: { phys: 0.2, fire: 0, cold: 0, lightning: 0 }, skillPct: { groundStomp: 0.1 }, aoePct: 0.05, elitePct: 0.3, critChance: 0.5, critDamage: 1.0, main: 30 },
  });
  const m = monNear(ctx, { rank: 'champion', hp: 1e6 });
  m.hpMax = 1e6;
  m.res.phys = 0.25;
  m.st.shockUntil = state.tick + 10;
  const probe = makeRng({ s: state.rng.combat.s });
  const roll = probe.range(3, 7) * 1.5;
  const crit = probe.chance(0.5);
  const expected = roll * (1 + 30 / 100) * (1 + 0.2 + 0.1 + 0.05 + 0.3) * (crit ? 2 : 1) * (1 + STATUS.shockTaken) * (1 - 0.25);
  const r = playerHit(ctx, m, spec(ctx, { skillId: 'groundStomp', coef: 1.5, tags: ['aoe', 'melee'] }));
  assert.ok(near(r.dmg, expected), `${r.dmg} vs ${expected}`);
  assert.equal(r.crit, crit);
  assert.ok(near(m.hp, 1e6 - expected));
  const hit = ctx.events.find(e => e.name === EV.HIT);
  assert.ok(hit && near(hit.payload.amount, expected) && hit.payload.type === 'phys' && hit.payload.dot === false);
  assert.equal(m.lastHit.by, 'player');
  assert.equal(m.lastHit.skillId, 'groundStomp');
});

test('flat 적중은 주 능력치 · 치명타를 받지 않는다(보너스 · 저항만) · 난수를 쓰지 않는다', () => {
  const { state, ctx } = setup({ stats: { critChance: 0.75, dmgPct: { phys: 0.5, fire: 0, cold: 0, lightning: 0 } } });
  const m = monNear(ctx, { hp: 1000 });
  m.hpMax = 1000;
  m.res.phys = 0.1;
  const before = state.rng.combat.s;
  const r = playerHit(ctx, m, spec(ctx, { flat: 40, coef: 0, noProcs: true }));
  assert.equal(state.rng.combat.s, before, '굴림 없음');
  assert.ok(near(r.dmg, 40 * 1.5 * 0.9));
  assert.equal(r.crit, false);
});

test('감소 식(🔒): 맞춘 레벨의 장비면 레벨이 올라도 감소율이 같다 · 상한 0.75', () => {
  for (const L of [1, 5, 10, 20, 30]) {
    assert.ok(near(DRa(12 * 1.1 ** (L - 1), L), 12 / 92), `armor L${L}`);
    assert.ok(near(DRr(25 * 1.1 ** (L - 1), L), 25 / 75), `res L${L}`);
  }
  assert.equal(DRa(1e9, 1), COMBAT.drCap);
  assert.equal(DRr(1e9, 1), COMBAT.drCap);
  assert.equal(DRa(-5, 1), 0);
});

test('몬스터 → 플레이어: 방어도 · 저항 · 전투 함성 · 최소 20% · PLAYER_HIT · 생명은 0 아래로 내려가지 않는다', () => {
  const { state, ctx, p } = setup({ stats: { res: { phys: 0, fire: 25, cold: 0, lightning: 0 } } });
  const m = monNear(ctx);
  const life0 = p.life;
  const r = monsterHitPlayer(ctx, m, { srcId: m.id, via: 'melee', raw: 20, type: 'phys', level: 1 });
  assert.ok(near(r.dmg, 20 * (1 - 12 / 92)));
  assert.ok(near(p.life, life0 - r.dmg));
  const ph = ctx.events.find(e => e.name === EV.PLAYER_HIT).payload;
  assert.equal(ph.via, 'melee');
  assert.equal(ph.srcId, m.id);
  assert.ok(near(ph.amount, r.dmg) && near(ph.life, p.life));
  // 화염 저항 25(레벨 1) → × (1 − 25/75)
  const r2 = hazardHitPlayer(ctx, { srcId: -1, via: 'hazard', raw: 30, type: 'fire', level: 1 });
  assert.ok(near(r2.dmg, 30 * (1 - 12 / 92) * (1 - 25 / 75)));
  // 전투 함성: 방어도 × (1 + value)
  addBuff(ctx, 'warCry', 8, 0.4);
  const r3 = hazardHitPlayer(ctx, { srcId: -1, via: 'hazard', raw: 30, type: 'phys', level: 1 });
  const a = 12 * 1.4;
  assert.ok(near(r3.dmg, 30 * (1 - a / (a + 80))));
  // 최소 20%
  p.buffs = [];
  ctx.stats = makeTestStats({ dmgTakenReduce: 0.95 });
  const r4 = hazardHitPlayer(ctx, { srcId: -1, via: 'hazard', raw: 30, type: 'phys', level: 1 });
  assert.ok(near(r4.dmg, 30 * (1 - 12 / 92) * COMBAT.minTaken));
  // 생명 0 아래 없음 · 처치 훅
  let killed = 0;
  ctx.hooks.onPlayerKilled = (c, killer) => { killed++; c.state.player.dead = true; assert.equal(killer?.id, m.id); };
  const r5 = monsterHitPlayer(ctx, m, { srcId: m.id, via: 'melee', raw: 1e6, type: 'phys', level: 1 });
  assert.equal(p.life, 0);
  assert.equal(r5.killed, true);
  assert.equal(killed, 1);
  // 쓰러진 뒤 같은 틱의 피해는 무시(§5.16-2)
  const r6 = hazardHitPlayer(ctx, { srcId: -1, via: 'hazard', raw: 10, type: 'phys', level: 1 });
  assert.equal(r6.ignored, true);
  assert.equal(killed, 1);
  assert.ok(state.rift.stats.dmgTaken > 0);
});

test('무시: 도착 보호 · 도약 무적 · 무적 플래그 · 전환 대기 · 마을', () => {
  const { state, ctx, p } = setup();
  const sp = { srcId: -1, via: 'hazard', raw: 10, type: 'phys', level: 1 };
  p.protectUntil = state.tick + 1;
  assert.equal(hazardHitPlayer(ctx, sp).ignored, true);
  p.protectUntil = 0;
  p.invulnUntil = state.tick + 1;
  assert.equal(hazardHitPlayer(ctx, sp).ignored, true);
  p.invulnUntil = 0;
  state.flags.invincible = true;
  assert.equal(hazardHitPlayer(ctx, sp).ignored, true);
  state.flags.invincible = false;
  state.pendingTravel = { to: 'town', reason: 'recall' };
  assert.equal(hazardHitPlayer(ctx, sp).ignored, true);
  state.pendingTravel = null;
  const life = p.life;
  assert.equal(hazardHitPlayer(ctx, sp).ignored, false);
  assert.ok(p.life < life);
});

test('막기: 근접 · 투사체 · 돌진만 × (1 − 0.6) · 바닥은 막지 않는다', () => {
  const { ctx } = setup({ stats: { block: 1 } });
  const m = monNear(ctx);
  const base = 20 * (1 - 12 / 92);
  const r = monsterHitPlayer(ctx, m, { srcId: m.id, via: 'melee', raw: 20, type: 'phys', level: 1 });
  assert.equal(r.blocked, true);
  assert.ok(near(r.dmg, base * (1 - COMBAT.blockReduce)));
  const h = hazardHitPlayer(ctx, { srcId: -1, via: 'hazard', raw: 20, type: 'phys', level: 1 });
  assert.equal(h.blocked, false);
  assert.ok(near(h.dmg, base));
});

test('마력 보호막: 흡수 → 깨지면 SHIELD{broken} · 버프 끝 · 다 막은 적중은 생명 피해 훅을 부르지 않는다', () => {
  let damaged = 0;
  const { state, ctx, p } = setup({ hooks: { onPlayerDamaged: () => { damaged++; } } });
  addBuff(ctx, 'energyShield', 6, 50);
  p.shield = 50;
  const life = p.life;
  const r = hazardHitPlayer(ctx, { srcId: -1, via: 'hazard', raw: 20, type: 'phys', level: 1 });
  assert.equal(r.dmg, 0);
  assert.ok(near(r.absorbed, 20 * (1 - 12 / 92)));
  assert.equal(p.life, life);
  assert.equal(damaged, 0);
  assert.ok(near(p.shield, 50 - r.absorbed));
  const r2 = hazardHitPlayer(ctx, { srcId: -1, via: 'hazard', raw: 200, type: 'phys', level: 1 });
  assert.ok(r2.dmg > 0);
  assert.equal(p.shield, 0);
  assert.equal(damaged, 1);
  const sh = ctx.events.filter(e => e.name === EV.SHIELD).map(e => e.payload);
  assert.equal(sh.at(-1).broken, true);
  assert.equal(p.buffs.some(b => b.id === 'energyShield'), false);
  assert.ok(ctx.events.some(e => e.name === EV.BUFF && e.payload.id === 'energyShield' && e.payload.on === false));
  assert.equal(state.player.dead, false);
});

test('가시: 근접 적중이면 thorns × (1 + main/100) 물리(저항만 · HIT dot) · 바닥은 없음', () => {
  const { ctx } = setup({ stats: { thorns: 5 } });
  const m = monNear(ctx, { hp: 100 });
  m.res.phys = 0.2;
  monsterHitPlayer(ctx, m, { srcId: m.id, via: 'melee', raw: 5, type: 'phys', level: 1 });
  assert.ok(near(m.hp, 100 - 5 * 1.1 * 0.8));
  const dot = ctx.events.find(e => e.name === EV.HIT);
  assert.equal(dot.payload.dot, true);
  const hp = m.hp;
  monsterHitPlayer(ctx, m, { srcId: m.id, via: 'projectile', raw: 5, type: 'phys', level: 1 });
  assert.equal(m.hp, hp);
});

test('적중 회복 상한: 한 행동 5마리 · 채널/지속 틱 2마리 · 새 actionId 면 다시', () => {
  const { ctx, p } = setup({ stats: { lifeOnHit: 2 } });
  p.life = 10;
  const mons = [];
  for (let i = 0; i < 8; i++) mons.push(addTestMonster(ctx, { x: 10 + i, z: 30, hp: 1e6 }));
  for (const m of mons) playerHit(ctx, m, spec(ctx, { actionId: 7 }));
  assert.equal(p.life, 10 + 2 * COMBAT.lohTargets);
  for (const m of mons) playerHit(ctx, m, spec(ctx, { actionId: 8, tags: ['aoe', 'channel', 'melee'] }));
  assert.equal(p.life, 10 + 2 * (COMBAT.lohTargets + COMBAT.lohTargetsTick));
  for (const m of mons) playerHit(ctx, m, spec(ctx, { actionId: 9, tickHit: true }));
  assert.equal(p.life, 10 + 2 * (COMBAT.lohTargets + 2 * COMBAT.lohTargetsTick));
  // noProcs 면 회복 없음
  playerHit(ctx, mons[0], spec(ctx, { actionId: 10, noProcs: true }));
  assert.equal(p.life, 10 + 2 * (COMBAT.lohTargets + 2 * COMBAT.lohTargetsTick));
  // 회복 이벤트는 싣지 않는다(source 'hit')
  assert.equal(countEvents(ctx.events, EV.PLAYER_HEAL), 0);
});

test('무적(보호막 속성 · 사라짐): 피해 0 · immune · 상태 이상 없음 · HIT{immune}', () => {
  const { state, ctx } = setup();
  const m = monNear(ctx, { hp: 50 });
  m.st.invulnUntil = state.tick + 30;
  const r = playerHit(ctx, m, spec(ctx, { stun: 1, knock: 3, chill: 80 }));
  assert.equal(r.immune, true);
  assert.equal(r.dmg, 0);
  assert.equal(m.hp, 50);
  assert.equal(m.st.stunUntil, -1);
  assert.equal(m.knock, null);
  assert.equal(m.st.chill, 0);
  assert.equal(ctx.events.find(e => e.name === EV.HIT).payload.immune, true);
});

test('정면 방패: idle · move · windup 에서 정면 ±45° 만 50% · strike/recover/기절 · 옆/뒤 · 범위는 그대로', () => {
  const { state, ctx } = setup({ stats: { critChance: 0 } });
  const p = state.player.pos;
  const m = addTestMonster(ctx, { typeId: 'shieldSkeleton', x: p.x, z: p.z + 2, hp: 1e6 });
  m.hpMax = 1e6;
  m.res.phys = 0;
  m.facing = Math.PI;   // −Z = 플레이어 쪽
  const once = (extra = {}) => {
    const probe = makeRng({ s: state.rng.combat.s });
    const roll = probe.range(3, 7);
    const r = playerHit(ctx, m, spec(ctx, extra));
    return { r, base: roll * 1.1 };
  };
  let o = once();
  assert.equal(o.r.blocked, true);
  assert.ok(near(o.r.dmg, o.base * (1 - MON.shieldFront)));
  m.act = 'windup';
  assert.equal(once().r.blocked, true);
  m.act = 'move';
  assert.equal(once().r.blocked, true);
  for (const act of ['strike', 'recover', 'stunned']) {
    m.act = act;
    o = once();
    assert.equal(o.r.blocked, false, act);
    assert.ok(near(o.r.dmg, o.base));
  }
  m.act = 'idle';
  assert.equal(once({ tags: ['aoe'] }).r.blocked, false, '범위');
  m.facing = 0;   // 등을 돌렸다
  assert.equal(once().r.blocked, false, '뒤');
  m.facing = Math.PI / 2;
  assert.equal(once().r.blocked, false, '옆');
});

test('저항 상한 0.5 — 데이터 · 속성으로 더 높아도 0.5 까지만', () => {
  const { ctx } = setup({ stats: { critChance: 0 } });
  const m = monNear(ctx, { hp: 1e6 });
  m.hpMax = 1e6;
  m.res.fire = 0.75;
  const r = playerHit(ctx, m, spec(ctx, { flat: 100, type: 'fire', coef: 0 }));
  assert.ok(near(r.dmg, 100 * (1 - MON.resCap)));
});

test('기절: rank.stunMul · 기절 중의 새 기절은 끝을 늘리지 않는다 · 끝 + 면역 · 예비 공격 취소(쿨다운은 쓴 채) · 몸에 붙은 예고도 지운다', () => {
  const { state, ctx } = setup();
  const m = monNear(ctx, { rank: 'champion' });
  m.act = 'windup';
  m.readyAt.claw = state.tick + 40;
  state.rift.effects.push({ id: 999, kind: 'chargeLine', owner: 'mon', srcId: m.id, packId: -1, cancelOnSrcDeath: true, hostile: true, shape: circle(0, 0, 1), start: state.tick, hitAt: state.tick + 20, end: state.tick + 21, tickT: 0, nextTickAt: -1, resolved: false, spec: null, tickSpec: null, from: null });
  assert.equal(applyStun(ctx, m, 1.0), true);
  const t = ticks(1.0 * 0.6);
  assert.equal(m.st.stunUntil, state.tick + t);
  assert.equal(m.act, 'stunned');
  assert.equal(m.readyAt.claw, state.tick + 40);
  assert.equal(state.rift.effects[0].end, state.tick, '몸에 붙은 예고 지움');
  state.tick += 3;
  assert.equal(applyStun(ctx, m, 5), false, '연장 없음');
  assert.equal(m.st.stunUntil, state.tick - 3 + t);
  state.tick = m.st.stunUntil;
  updateStatus(ctx);
  assert.equal(m.act, 'idle');
  assert.ok(ctx.events.some(e => e.name === EV.MON_STATUS && e.payload.kind === 'stun' && e.payload.on === false));
  state.tick += 1;
  assert.equal(applyStun(ctx, m, 1), false, '면역 창');
  state.tick = m.st.stunImmuneUntil;
  assert.equal(applyStun(ctx, m, 1), true);
});

test('냉기 · 빙결: 60 + 60 → 빙결(chill 0 · freezeSec × freezeMul) · 면역 · 냉기는 3초 뒤 초당 20 감소 · 이동 · 공격 속도 × 0.7', () => {
  const { state, ctx } = setup();
  const m = monNear(ctx);
  assert.equal(applyChill(ctx, m, 60), false);
  assert.equal(m.st.chill, 60);
  assert.ok(near(monSpeedMul(m, state.tick), 1 - STATUS.chillSlow));
  assert.ok(near(monAtkSpeedMul(m, state.tick), 1 - STATUS.chillSlow));
  assert.equal(applyChill(ctx, m, 60), true);
  assert.equal(m.act, 'frozen');
  assert.equal(m.st.chill, 0);
  assert.equal(m.st.freezeUntil, state.tick + ticks(STATUS.freezeSec));
  assert.equal(monSpeedMul(m, state.tick), 0);
  state.tick = m.st.freezeUntil;
  updateStatus(ctx);
  assert.equal(m.act, 'idle');
  assert.equal(applyChill(ctx, m, 100), false, '빙결 면역');
  assert.equal(m.st.chill, 100);
  const decayAt = m.st.chillDecayAt;
  state.tick = decayAt - 1;
  updateStatus(ctx);
  assert.equal(m.st.chill, 100, '3초 전에는 줄지 않는다');
  for (let i = 0; i < 30; i++) { state.tick += 1; updateStatus(ctx); }
  assert.ok(near(m.st.chill, 100 - STATUS.chillDecayPerSec * 30 / 30, 1e-6), String(m.st.chill));
  // 정예는 빙결이 짧다 · 냉기 핵심(freezeAtReduce)은 문턱을 낮춘다
  const e = monNear(ctx, { rank: 'elite' });
  ctx.stats = makeTestStats({ freezeAtReduce: 40, freezeDurPct: 0.5 });
  assert.equal(applyChill(ctx, e, 60), true);
  assert.equal(e.st.freezeUntil, state.tick + ticks(STATUS.freezeSec * 1.5 * 0.5));
});

test('화상: 화염 적중 burnFrac(+ 연소) × 저항 전 피해를 3초 · 0.5초 틱 · 총량 = 적중 피해 × burnFrac · 약한 새 화상은 dps 를 낮추지 않는다', () => {
  const { state, ctx } = setup({ stats: { critChance: 0, burnFrac: 0.4 } });
  const m = monNear(ctx, { hp: 1e6 });
  m.hpMax = 1e6;
  m.res.fire = 0.2;
  const r = playerHit(ctx, m, spec(ctx, { flat: 100, type: 'fire', coef: 0, burnFrac: 0.2 }));
  assert.ok(near(r.dmg, 80));
  assert.ok(m.st.burn);
  const hp0 = m.hp;
  for (let i = 0; i < ticks(STATUS.burnSec) + 5; i++) { state.tick += 1; tickBurns(ctx); }
  assert.ok(near(hp0 - m.hp, 80 * 0.6, 1e-9), `총량 ${hp0 - m.hp}`);
  assert.equal(m.st.burn, null);
  assert.ok(ctx.events.some(e => e.name === EV.MON_STATUS && e.payload.kind === 'burn' && e.payload.on === false));
  // 물리 적중은 패시브 연소를 받지 않는다
  playerHit(ctx, m, spec(ctx, { flat: 100, type: 'phys', coef: 0 }));
  assert.equal(m.st.burn, null);
});

test('감전 확률 · 감속 · 넉백(knockMul · 면역 1초 · 강인함 · 구조물 · 정예 0) · 경직(15% · 면역 1.2초 · 정예 없음)', () => {
  const { state, ctx } = setup({ stats: { critChance: 0 } });
  const m = monNear(ctx, { hp: 1e6 });
  m.hpMax = 1e6;
  playerHit(ctx, m, spec(ctx, { flat: 1, coef: 0, shockChance: 1, slow: { pct: 0.4, sec: 2 } }));
  assert.ok(m.st.shockUntil > state.tick);
  assert.ok(near(monSpeedMul(m, state.tick), 0.6));
  // 넉백
  const k = monNear(ctx, { hp: 1e6 });
  assert.equal(applyKnock(ctx, k, state.player.pos.x, state.player.pos.z, 2.5), true);
  assert.ok(k.knock && k.knock.vz > 0, '플레이어 → 몬스터 방향');
  const dist = Math.hypot(k.knock.vx, k.knock.vz) * (k.knock.until - state.tick) / 30;
  assert.ok(near(dist, 2.5, 1e-9));
  assert.equal(applyKnock(ctx, k, 0, 0, 2.5), false, '면역 1초');
  state.tick = k.st.knockImmuneUntil;
  assert.equal(applyKnock(ctx, k, 0, 0, 2.5), true);
  const tough = monNear(ctx);
  tough.affixes = ['tough'];
  assert.equal(applyKnock(ctx, tough, 0, 0, 2.5), false, '강인함');
  assert.equal(applyFlinch(ctx, tough), false, '강인함 경직 면역');
  const nest = monNear(ctx, { typeId: 'boneNest' });
  assert.equal(applyKnock(ctx, nest, 0, 0, 2.5), false, '구조물');
  const elite = monNear(ctx, { rank: 'elite' });
  assert.equal(applyKnock(ctx, elite, 0, 0, 2.5), false, '정예 knockMul 0');
  assert.equal(applyFlinch(ctx, elite), false, '정예는 경직 없음');
  // 경직: 한 적중이 최대 생명 15% 이상
  const f = monNear(ctx, { hp: 100 });
  f.hpMax = 100;
  playerHit(ctx, f, spec(ctx, { flat: 10, coef: 0 }));
  assert.notEqual(f.act, 'flinch');
  playerHit(ctx, f, spec(ctx, { flat: 16, coef: 0 }));
  assert.equal(f.act, 'flinch');
  const until = f.st.flinchUntil;
  state.tick = until;
  updateStatus(ctx);
  assert.equal(f.act, 'idle');
  state.tick += 1;
  playerHit(ctx, f, spec(ctx, { flat: 16, coef: 0 }));
  assert.equal(f.act, 'idle', '면역 1.2초 — 무한 경직 없음');
});

test('플레이어 감속 · 속박: 긴 쪽 · rootLockUntil = 끝 + 0.8초 · 끝나면 PLAYER_STATUS off', () => {
  const { state, ctx, p } = setup();
  slowPlayer(ctx, 0.4, 1.5);
  slowPlayer(ctx, 0.2, 3);
  assert.equal(p.st.slowPct, 0.4);
  assert.equal(p.st.slowUntil, state.tick + ticks(3));
  rootPlayer(ctx, 1.5);
  assert.equal(p.st.rootUntil, state.tick + ticks(1.5));
  assert.equal(state.rift.rootLockUntil, p.st.rootUntil + ticks(0.8));
  state.tick = p.st.slowUntil;
  updateStatus(ctx);
  assert.equal(p.st.slowPct, 0);
  assert.equal(p.st.rootUntil, 0);
  const offs = ctx.events.filter(e => e.name === EV.PLAYER_STATUS && e.payload.on === false).map(e => e.payload.kind).sort();
  assert.deepEqual(offs, ['root', 'slow']);
});

test('몬스터 적중의 적중 효과: chillSec → 감속 0.4 · push → 밀림(도약 · 돌진 중이면 안 밀린다)', () => {
  const { state, ctx, p } = setup();
  const m = monNear(ctx);
  monsterHitPlayer(ctx, m, { srcId: m.id, via: 'melee', raw: 1, type: 'cold', level: 1, onHit: { chillSec: 1.5 }, push: 1.2 });
  assert.equal(p.st.slowPct, STATUS.playerChill);
  assert.ok(p.knock && p.knock.vz < 0, '몬스터 → 플레이어 방향(몬스터가 북쪽)');
  p.knock = null;
  p.act = 'leap';
  monsterHitPlayer(ctx, m, { srcId: m.id, via: 'melee', raw: 1, type: 'phys', level: 1, push: 1.2 });
  assert.equal(p.knock, null);
  assert.ok(state.tick > 0);
});

test('속성 onHitPlayer: 근접 · 투사체에서 dmg > 0 이면 부른다 · noAffix 면 안 부른다 · 출처가 죽었으면 근접은 무시 · 투사체는 바닥처럼', () => {
  const calls = [];
  const { ctx } = setup({ hooks: { onMonHitPlayer: (c, mon, res, sp) => calls.push([mon.id, sp.via, res.dmg]) } });
  const m = monNear(ctx);
  monsterHitPlayer(ctx, m, { srcId: m.id, via: 'melee', raw: 5, type: 'phys', level: 1 });
  monsterHitPlayer(ctx, m, { srcId: m.id, via: 'projectile', raw: 5, type: 'phys', level: 1 });
  monsterHitPlayer(ctx, m, { srcId: m.id, via: 'melee', raw: 5, type: 'fire', level: 1, noAffix: true });
  hazardHitPlayer(ctx, { srcId: m.id, via: 'hazard', raw: 5, type: 'phys', level: 1 });
  assert.deepEqual(calls.map(c => c[1]), ['melee', 'projectile']);
  m.hp = 0;
  const r = monsterHitPlayer(ctx, m, { srcId: m.id, via: 'melee', raw: 5, type: 'phys', level: 1 });
  assert.equal(r.ignored, true, '생명 ≤ 0 인 몬스터는 그 틱에 때리지 못한다(§5.16-1)');
  const r2 = monsterHitPlayer(ctx, m, { srcId: m.id, via: 'projectile', raw: 5, type: 'phys', level: 1 });
  assert.equal(r2.ignored, false);
  assert.equal(calls.length, 2);
});

test('조건부 패시브(CONDS · condStatsFor): 표의 조건이 참인 적중에만 더한다', () => {
  const { state, ctx, p } = setup({
    stats: {
      critChance: 0,
      conds: [
        { cond: 'targetDisabled', stats: { dmgPct: 0.3 } },
        { cond: 'rage50', stats: { critChance: 1, attackSpeedPct: 0.1 } },
        { cond: 'lifeBelow35', stats: { dmgTakenReduce: 0.3 } },
      ],
    },
  });
  const m = monNear(ctx, { hp: 1e6 });
  m.hpMax = 1e6;
  assert.equal(CONDS.targetDisabled(ctx, m), false);
  assert.deepEqual({ ...condStatsFor(ctx, m, 'offense') }, {});
  let r = playerHit(ctx, m, spec(ctx, { flat: 100, coef: 0 }));
  assert.ok(near(r.dmg, 100));
  m.st.chill = 10;
  assert.equal(CONDS.targetDisabled(ctx, m), true);
  r = playerHit(ctx, m, spec(ctx, { flat: 100, coef: 0 }));
  assert.ok(near(r.dmg, 130));
  p.resource = 60;
  assert.equal(CONDS.rage50(ctx, null), true);
  r = playerHit(ctx, m, spec(ctx, { coef: 1 }));
  assert.equal(r.crit, true, 'rage50 의 치명타 확률');
  // 방어 쪽
  assert.deepEqual({ ...condStatsFor(ctx, null, 'defense') }, {});
  p.life = p.lifeMax * 0.3;
  assert.deepEqual({ ...condStatsFor(ctx, null, 'defense') }, { dmgTakenReduce: 0.3 });
  const life = p.life;
  const h = hazardHitPlayer(ctx, { srcId: -1, via: 'hazard', raw: 10, type: 'phys', level: 1 });
  assert.ok(near(h.dmg, 10 * (1 - 12 / 92) * 0.7));
  assert.ok(near(p.life, life - h.dmg));
  // 빙결 · 화상 조건
  m.st.freezeUntil = state.tick + 5;
  assert.equal(CONDS.targetFrozen(ctx, m), true);
  m.st.burn = { dps: 1, until: state.tick + 10, nextAt: state.tick + 5 };
  assert.equal(CONDS.targetBurning(ctx, m), true);
});

test('같은 몬스터가 한 틱에 여러 번 맞으면 HIT 도 여러 번 · 쓰러진 뒤의 적중은 없다 · 모양 적중은 가까운 순 · maxTargets', () => {
  const { state, ctx } = setup({ stats: { critChance: 0 } });
  const p = state.player.pos;
  const a = addTestMonster(ctx, { x: p.x + 1, z: p.z, hp: 10 });
  const b = addTestMonster(ctx, { x: p.x + 3, z: p.z, hp: 10 });
  const c = addTestMonster(ctx, { x: p.x + 2, z: p.z, hp: 10 });
  const res = playerHitShape(ctx, circle(p.x, p.z, 5), spec(ctx, { flat: 4, coef: 0, maxTargets: 2 }));
  assert.deepEqual(res.map(r => r.monId), [a.id, c.id]);
  assert.equal(b.hp, 10);
  playerHit(ctx, a, spec(ctx, { flat: 4, coef: 0 }));
  const k = playerHit(ctx, a, spec(ctx, { flat: 4, coef: 0 }));
  assert.equal(k.killed, true);
  assert.equal(a.hp, 0, '생명은 0 에서 멈춘다(실제로 깎인 양만)');
  const after = playerHit(ctx, a, spec(ctx, { flat: 4, coef: 0 }));
  assert.equal(after.dmg, 0);
  assert.equal(countEvents(ctx.events, EV.HIT), 4, '모양 2 + 단일 2 · 쓰러진 뒤의 적중은 이벤트도 없다');
});

test('히트스톱: 큰 치명타 · 챔피언 이상 처치 · 0.4초 간격', () => {
  const { state, ctx } = setup({ stats: { critChance: 0.75 } });
  const m = monNear(ctx, { rank: 'champion', hp: 10 });
  m.hpMax = 10;
  playerHit(ctx, m, spec(ctx, { flat: 100, coef: 0 }));
  assert.equal(countEvents(ctx.events, EV.HITSTOP), 1);
  assert.ok(m.launch === null || Number.isFinite(m.launch.x));
  const n = monNear(ctx, { rank: 'champion', hp: 10 });
  playerHit(ctx, n, spec(ctx, { flat: 100, coef: 0 }));
  assert.equal(countEvents(ctx.events, EV.HITSTOP), 1, '간격 안');
  state.tick += ticks(COMBAT.hitstop.gap);
  const o = monNear(ctx, { rank: 'champion', hp: 10 });
  playerHit(ctx, o, spec(ctx, { flat: 100, coef: 0 }));
  assert.equal(countEvents(ctx.events, EV.HITSTOP), 2);
});

test('NaN 방어: 계수 · raw 가 숫자가 아니어도 피해 0 · 상태에 NaN 이 없다', () => {
  const { state, ctx } = setup();
  const m = monNear(ctx);
  playerHit(ctx, m, { skillId: 'bash', type: 'phys', tags: [], actionId: 1 });
  playerHit(ctx, m, spec(ctx, { coef: NaN }));
  damageMonsterRaw(ctx, m, NaN, 'fire');
  hazardHitPlayer(ctx, { srcId: -1, via: 'hazard', raw: NaN, type: 'nope', level: NaN });
  healPlayer(ctx, NaN, 'potion');
  assertFiniteDeep(state);
  assert.ok(m.hp > 0);
});
