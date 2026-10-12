// OWNER: 피드백 2 밸런스 · sim(NOTES-FEEDBACK 라운드 2 · Jay 결정 2026-10-12)
// D2 요구 레벨 상한 30 · D3 수호자 예고 기술 × 2 · D4 가방 30칸(옛 세이브의 31~40번째가 사라지지 않는다) · D5 업그레이드 문턱 3% ·
// D8 메테오(작은 메테오 포함)는 시야가 막히면 이쪽 벽 앞에서 자른다(봇 규칙도) · D10 분쇄자 조건 — 넉백 직후 0.5초도 「무력화」.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BAG_SIZE, LEVEL_CAP, STASH_SIZE } from '../src/core/constants.js';
import { EventBus } from '../src/core/events.js';
import { makeInput } from '../src/core/inputFrame.js';
import { ticks } from '../src/core/time.js';
import { BOT, BOT_RULES } from '../src/data/bot.js';
import { COMBAT, COND, STATUS } from '../src/data/combat.js';
import { GUARDIANS } from '../src/data/guardians.js';
import { getNode } from '../src/data/index.js';
import { COMPARE, ITEM } from '../src/data/items.js';
import { mapFromAscii } from '../src/debug/fixtureMap.js';
import { skillRule } from '../src/bot/combat.js';
import { CONDS, condStatsFor } from '../src/sim/conds.js';
import { GameSim } from '../src/sim/GameSim.js';
import { compareEquip, isUpgrade } from '../src/sim/loot/compare.js';
import { makeItem } from '../src/sim/loot/rollItem.js';
import { computeStats, powerScore } from '../src/sim/loot/stats.js';
import { updatePlayer } from '../src/sim/player/controller.js';
import { sightClip } from '../src/sim/player/skills.js';
import { createCharacter } from '../src/sim/progression/character.js';
import { addToBag, bagCount, equip, freeBagIdx, isBagFull, moveItem, settleBag } from '../src/sim/progression/inventory.js';
import { loadChar, sanitizeItem, serializeChar } from '../src/sim/progression/save.js';
import { sell } from '../src/sim/progression/shops.js';
import { applyKnock } from '../src/sim/status.js';
import { losClear } from '../src/sim/world/nav.js';
import { addTestMonster, makeTestCtx, makeTestState, makeTestStats } from './helpers.js';

// ───────────────────────── D2 요구 레벨 상한 ─────────────────────────

test('피드백 2 D2: 요구 레벨 = min(ilvl, 30) — 균열 30 위의 장비도 레벨 30 캐릭터가 낀다 · 옛 세이브의 요구 레벨도 다시 계산된다', () => {
  assert.equal(ITEM.reqLevelCap, LEVEL_CAP, '상한 = 캐릭터 레벨 캡');
  for (const [ilvl, want] of [[1, 1], [12, 12], [30, 30], [31, 30], [45, 30], [99, 30]]) {
    assert.equal(makeItem({ baseId: 'helm', id: 'i1', ilvl }).reqLevel, want, `ilvl ${ilvl}`);
  }
  const old = { ...makeItem({ baseId: 'helm', id: 'i2', ilvl: 42, rarity: 'magic', affixes: [{ id: 'vit', tier: 3, value: 20 }] }), reqLevel: 42 };
  const s = sanitizeItem(JSON.parse(JSON.stringify(old)));
  assert.equal(s.ilvl, 42);
  assert.equal(s.reqLevel, 30, '옛 세이브(요구 레벨 42) → 30');
  // 레벨 30 캐릭터가 균열 40 의 투구를 낀다 · 업그레이드로 센다(옛 규칙은 'level' 로 막혀 균열 30 넘는 판의 업그레이드가 0%)
  const st = makeTestState({ cls: 'warrior' });
  const ctx = makeTestCtx(st);
  st.char.level = LEVEL_CAP;
  const helm = makeItem({ baseId: 'helm', id: 'i3', ilvl: 40, rarity: 'rare', affixes: [{ id: 'vit', tier: 5, value: 60 }, { id: 'armor', tier: 5, value: 60 }] });
  const c = compareEquip(st.char, helm);
  assert.equal(c.ok, true, JSON.stringify(c.reason));
  assert.equal(c.upgrade, true);
  st.char.bag[0] = helm;
  assert.equal(equip(ctx, { where: 'bag', idx: 0 }).ok, true);
  assert.equal(st.char.equip.helm, helm);
});

// ───────────────────────── D3 수호자 ─────────────────────────

test('피드백 2 D3: 수호자 예고 기술 × 2 — 대지 분쇄 5.0 · 뼈 가시 3.6 · 잿불 비 3.6(밸런스 게이트의 × 3 = 7.5 · 5.4 · 5.4)', () => {
  const mul = (g, a) => GUARDIANS.find(x => x.id === g).attacks.find(x => x.id === a).mul;
  assert.equal(mul('boneGiant', 'slam'), 5.0);
  assert.equal(mul('boneGiant', 'spikes'), 3.6);
  assert.equal(mul('ashWitch', 'emberRain'), 3.6);
});

// ───────────────────────── D4 가방 30칸 · 옛 세이브 ─────────────────────────

/** 옛 세이브(가방 40칸) — 가방 40개 + 클래스가 안 맞는 장착 1개(가방으로 밀린다) → 캐릭터 JSON */
function oldSave(seed = 3) {
  let n = 1;
  const newId = () => 'i' + n++;
  const ch = createCharacter({ slot: 0, cls: 'warrior', name: 'Old', newId, seed });
  const save = serializeChar(ch);
  save.char.bag = [];
  for (let k = 0; k < 40; k++) save.char.bag.push(makeItem({ baseId: ['helm', 'boots', 'belt', 'ring'][k % 4], id: newId(), ilvl: 1 + (k % 7) }));
  save.char.equip.offhand = makeItem({ baseId: 'orb', id: newId(), ilvl: 3 });   // 마법사 보조 — 전사에게는 맞지 않는다 → 가방
  const ids = [...save.char.bag.map(it => it.id), save.char.equip.offhand.id];
  return { raw: JSON.stringify(save), ids };
}

/** 계정 보관함을 free 칸만 비우고 채운 GameSim 에 붙인다 */
function attach(raw, free) {
  const sim = new GameSim({ bus: new EventBus(), seed: 9, devSession: true });
  sim.start();
  let n = 1000;
  for (let i = 0; i < STASH_SIZE - free; i++) sim.state.account.stash[i] = makeItem({ baseId: 'gloves', id: 'i' + n++, ilvl: 2 });
  const r = loadChar(raw, 0);
  assert.equal(r.broken, false);
  assert.equal(sim.loadCharacter(0, r.char).ok, true);
  return sim;
}

/** 캐릭터 · 보관함의 모든 아이템 ID */
function allIds(sim) {
  const ch = sim.state.char;
  const ids = [];
  for (const it of ch.bag) if (it) ids.push(it.id);
  for (const s of Object.keys(ch.equip)) if (ch.equip[s]) ids.push(ch.equip[s].id);
  for (const it of sim.state.account.stash) if (it) ids.push(it.id);
  return ids;
}

test('피드백 2 D4: 가방 30칸(6 × 5) · 옛 세이브(가방 40 + 밀린 장착 1)를 읽으면 칸 밖에 그대로 둔다 — 버리는 아이템 0', () => {
  assert.equal(BAG_SIZE, 30);
  const { raw, ids } = oldSave();
  const r = loadChar(raw, 0);
  assert.equal(r.broken, false);
  const got = r.char.bag.filter(Boolean).map(it => it.id);
  assert.deepEqual([...got].sort(), [...ids].sort(), '41개 모두 가방 배열에(30칸 + 칸 밖 11)');
  assert.equal(r.char.bag.length, 41);
  assert.equal(r.char.bag.slice(0, BAG_SIZE).every(Boolean), true, '칸 안은 꽉 찬다');
  // 다시 저장 → 읽기도 그대로(왕복)
  const again = loadChar(JSON.stringify(serializeChar(r.char)), 0).char;
  assert.deepEqual(again.bag.map(it => it?.id ?? null), r.char.bag.map(it => it?.id ?? null));
});

test('피드백 2 D4: 캐릭터를 붙일 때 칸 밖 아이템 → 보관함 빈칸 · 보관함이 차면 가방 칸 밖에 남는다 — 사라지는 아이템 0 · 30 아래로 줄 때까지 줍지 못한다', () => {
  const { raw, ids } = oldSave();
  // ① 보관함 빈칸 20 — 11개 모두 보관함으로 · 가방은 30칸
  const a = attach(raw, 20);
  const ach = a.state.char;
  assert.equal(ach.bag.length, BAG_SIZE);
  assert.equal(bagCount(ach), BAG_SIZE);
  for (const id of ids) assert.ok(allIds(a).includes(id), `잃지 않았다 ${id}`);
  assert.equal(new Set(allIds(a)).size, allIds(a).length, '아이템 ID 유일');
  assert.equal(a.state.account.stash.filter(Boolean).length, STASH_SIZE - 20 + 11);
  // ② 보관함 빈칸 4 — 4개만 옮기고 7개는 가방 칸 밖에
  const b = attach(raw, 4);
  const st = b.state;
  const ch = st.char;
  assert.equal(st.account.stash.filter(Boolean).length, STASH_SIZE, '보관함이 찼다');
  assert.equal(bagCount(ch), BAG_SIZE + 7);
  assert.equal(ch.bag.length, BAG_SIZE + 7);
  for (const id of ids) assert.ok(allIds(b).includes(id), `잃지 않았다 ${id}`);
  assert.equal(isBagFull(ch), true);
  assert.equal(freeBagIdx(ch), -1);
  const ctx = b.ctx;
  const extra = makeItem({ baseId: 'belt', id: 'i9000', ilvl: 1 });
  assert.deepEqual(addToBag(ctx, extra), { ok: false, reason: 'bagFull' }, '넘친 가방에는 줍지 못한다');
  // 팔아서 줄여 간다 — 30 아래로 내려갈 때까지는 그대로 못 줍는다 · 칸 밖 아이템은 비는 칸으로 당겨진다(step)
  let sold = 0;
  while (bagCount(ch) >= BAG_SIZE) {
    const r = sell(ctx, { where: 'bag', idx: 0 });
    assert.equal(r.ok, true, JSON.stringify(r));
    sold++;
    b.step(makeInput({}));
    if (bagCount(ch) >= BAG_SIZE) assert.equal(addToBag(ctx, extra).ok, false, `아직 ${bagCount(ch)}개`);
  }
  assert.equal(sold, 8);
  assert.equal(ch.bag.length, BAG_SIZE, '칸 밖이 비었다');
  assert.equal(bagCount(ch), BAG_SIZE - 1);
  assert.equal(addToBag(ctx, extra).ok, true, '29개 → 줍는다');
  assert.equal(addToBag(ctx, makeItem({ baseId: 'belt', id: 'i9001', ilvl: 1 })).ok, false, '다시 30');
});

test('피드백 2 D4: 넘친 가방 — 보관함에서 꺼내기 · 양손 무기로 보조 밀어내기 · 칸 밖 자리에 놓기는 막고 · 정리(settleBag)는 수를 바꾸지 않는다', () => {
  const st = makeTestState({ scene: 'town', cls: 'warrior' });
  const ctx = makeTestCtx(st);
  const ch = st.char;
  let n = 500;
  const mk = (baseId, o = {}) => makeItem({ baseId, id: 'i' + n++, ilvl: 1, ...o });
  for (let i = 0; i < BAG_SIZE + 2; i++) ch.bag[i] = mk('belt');
  st.account.stash[0] = mk('helm');
  assert.equal(moveItem(ctx, { where: 'stash', idx: 0 }, { where: 'bag' }).ok, false, '넘친 가방으로 꺼내지 못한다');
  assert.equal(moveItem(ctx, { where: 'stash', idx: 0 }, { where: 'bag', idx: 3 }).ok, true, '든 칸과 바꾸는 것은 된다(수 그대로)');
  assert.equal(bagCount(ch), BAG_SIZE + 2);
  // 칸 밖 아이템을 보관함으로 → 정리돼 길이가 준다
  assert.equal(moveItem(ctx, { where: 'bag', idx: BAG_SIZE + 1 }, { where: 'stash' }).ok, true);
  assert.equal(ch.bag.length, BAG_SIZE + 1);
  // 칸 밖의 빈자리는 놓는 자리가 아니다
  ch.bag.push(null);
  assert.deepEqual(moveItem(ctx, { where: 'bag', idx: 0 }, { where: 'bag', idx: BAG_SIZE + 1 }), { ok: false, reason: 'invalid' });
  ch.bag.pop();
  // 양손 무기 — 보조가 가방으로 들어가야 하는데 넘쳤으면 'bagFull'(아무것도 바꾸지 않는다)
  ch.equip.offhand = mk('shield');
  ch.bag[5] = mk('greatsword');
  const before = ch.bag.map(it => it?.id ?? null);
  assert.deepEqual(equip(ctx, { where: 'bag', idx: 5 }), { ok: false, reason: 'bagFull' });
  assert.deepEqual(ch.bag.map(it => it?.id ?? null), before);
  // 정리: 칸 안에 빈자리가 생기면 칸 밖 아이템을 당긴다 · 수 그대로
  ch.bag[2] = null;
  const cnt = bagCount(ch);
  assert.equal(settleBag(ch), 1);
  assert.equal(bagCount(ch), cnt);
  assert.equal(ch.bag.length, BAG_SIZE);
  assert.ok(ch.bag[2]);
});

// ───────────────────────── D5 업그레이드 문턱 ─────────────────────────

test('피드백 2 D5: 「업그레이드」로 세는 문턱 3%(COMPARE.upgradeGain) — 화살표(isUpgrade 기본)는 0.5% 그대로', () => {
  assert.equal(COMPARE.minGain, 0.005);
  assert.equal(COMPARE.upgradeGain, 0.03);
  const st = makeTestState({ cls: 'warrior', level: 10 });
  const ch = st.char;
  const stats = computeStats(ch);
  const p0 = powerScore(stats);
  // 활력 값을 올려 가며 power 이득 1~2% 인 반지를 찾는다(빈 반지 칸)
  let small = null;
  for (let v = 1; v <= 40 && !small; v++) {
    const it = makeItem({ baseId: 'ring', id: 'i' + (100 + v), ilvl: 5, rarity: 'magic', affixes: [{ id: 'vit', tier: 1, value: v }] });
    const g = powerScore(compareEquip(ch, it).after) / p0 - 1;
    if (g > 0.01 && g < 0.025) small = it;
  }
  assert.ok(small, '1~2.5% 이득 반지');
  assert.equal(isUpgrade(stats, ch, small), true, '화살표: 조금이라도 나으면');
  assert.equal(isUpgrade(stats, ch, small, COMPARE.upgradeGain), false, '기록 · 측정: 3% 아래는 세지 않는다');
});

// ───────────────────────── D8 메테오 시야 ─────────────────────────

/** 가운데 벽 기둥(i = 6 · x ∈ [12, 14))이 있는 방 — 시작점 (7, 7) */
const WALL_MAP = [
  '##############',
  '#.....#......#',
  '#.....#......#',
  '#..S..#......#',
  '#.....#......#',
  '#.....#......#',
  '##############',
].join('\n');

function mageAt(map, hooks = []) {
  const m = map ? mapFromAscii(map, { id: 'test:wall', kind: 'rift', tileset: 'crypt' }) : null;
  const st = makeTestState({ cls: 'mage', map: m });
  st.char.skills.ranks = { meteor: 1 };
  st.char.skills.bar = ['meteor', null, null, null, null];
  const ctx = makeTestCtx(st, { map: m, stats: makeTestStats({ cls: 'mage', hooks: [...hooks], resourceRegen: 0 }) });
  st.player.resource = st.player.resourceMax;
  return { st, ctx, p: st.player };
}
function step(ctx, inp = {}) {
  ctx.state.tick += 1;
  ctx.state.player.prevPos = { x: ctx.state.player.pos.x, z: ctx.state.player.pos.z };
  updatePlayer(ctx, makeInput(inp));
}

test('피드백 2 D8: 메테오 — 커서가 벽 너머면 플레이어 → 커서 선 위의 마지막 보이는 바닥(벽 앞 COMBAT.sightBack)에 떨어진다 · 작은 메테오도 보이는 곳만', () => {
  const { st, ctx, p } = mageAt(WALL_MAP, ['ashenCrown']);
  const o = { ...p.pos };
  step(ctx, { cursor: { x: o.x + 11, z: o.z }, slotDown: [true, false, false, false, false] });
  assert.equal(p.act, 'cast');
  assert.ok(Math.abs(p.actPoint.x - (12 - COMBAT.sightBack)) < 1e-3, `벽 앞 ${p.actPoint.x}`);
  assert.ok(Math.abs(p.actPoint.z - o.z) < 1e-9);
  while (st.tick < p.actHit) step(ctx, {});
  const met = st.rift.effects.filter(e => e.kind === 'meteor');
  assert.equal(met.length, 3, '메테오 + 작은 메테오 둘');
  for (const e of met) assert.ok(losClear(ctx.map, p.pos.x, p.pos.z, e.shape.x, e.shape.z), `보이는 곳 (${e.shape.x.toFixed(2)}, ${e.shape.z.toFixed(2)})`);
  for (const e of met) assert.ok(e.shape.x < 12, '벽 너머(x ≥ 12)에 떨어지지 않는다');
  // 트인 곳은 그대로(18m 로만 자른다)
  const b = mageAt(null);
  step(b.ctx, { cursor: { x: b.p.pos.x + 9, z: b.p.pos.z + 3 }, slotDown: [true, false, false, false, false] });
  assert.ok(Math.hypot(b.p.actPoint.x - (b.p.pos.x + 9), b.p.actPoint.z - (b.p.pos.z + 3)) < 1e-9);
});

test('피드백 2 D8: sightClip — 트이면 그대로 · 막히면 첫 벽 앞(back 만큼) · 벽에 붙어 서서 벽을 누르면 제자리 쪽으로', () => {
  const map = mapFromAscii(WALL_MAP, { id: 'test:wall2', kind: 'rift', tileset: 'crypt' });
  assert.deepEqual(sightClip(map, 7, 7, 10, 9, 0.3), { x: 10, z: 9 });
  const a = sightClip(map, 7, 7, 20, 7, 0.3);
  assert.ok(Math.abs(a.x - 11.7) < 1e-3 && Math.abs(a.z - 7) < 1e-9, JSON.stringify(a));
  const c = sightClip(map, 11.9, 7, 20, 7, 0.3);
  assert.ok(c.x >= 11.6 - 1e-3 && c.x <= 11.9, JSON.stringify(c));
  assert.ok(losClear(map, 11.9, 7, c.x, c.z));
});

test('피드백 2 D8: 봇 메테오 규칙 — 벽에 가려진 무리 · 정예는 고르지 않는다(visible)', () => {
  const sit = (mons, target, visible) => ({ px: 0, pz: 0, life: 1, resource: 100, combat: true, mons, target, meleeNear: 0, kiteCount: BOT.kiteCount, walkable: null, visible });
  const mon = (x, z, rank = 'normal') => ({ x, z, r: 0.45, rank, awake: true, melee: true, id: Math.round(x * 100 + z) });
  const cl = [mon(5, 5), mon(6, 5), mon(5, 6), mon(6, 6)];
  const tgt = (m) => ({ ...m, d: Math.hypot(m.x, m.z), los: false });
  assert.ok(skillRule('meteor', sit(cl, tgt(cl[0]), () => true), BOT_RULES, { cost: 40 }), '보이면 쓴다');
  assert.equal(skillRule('meteor', sit(cl, tgt(cl[0]), () => false), BOT_RULES, { cost: 40 }), null, '가려진 무리');
  const el = mon(4, 4, 'elite');
  assert.equal(skillRule('meteor', sit([el], tgt(el), () => false), BOT_RULES, { cost: 40 }), null, '가려진 정예');
  assert.ok(skillRule('meteor', sit([el], tgt(el), null), BOT_RULES, { cost: 40 }), 'visible 이 없으면 늘 보인다(옛 상황 객체)');
});

// ───────────────────────── D10 분쇄자 조건 ─────────────────────────

test('피드백 2 D10: targetDisabled — 밀려나는 동안 + 넉백이 끝난 뒤 COND.knockSec(0.5초)까지 참 · 그 뒤 거짓 · 넉백 면역 · 구조물은 안 켜진다', () => {
  assert.equal(COND.knockSec, 0.5);
  const st = makeTestState({ cls: 'warrior' });
  const ctx = makeTestCtx(st);
  const p = st.player;
  const m = addTestMonster(ctx, { x: p.pos.x + 1.5, z: p.pos.z, hp: 1e6 });
  assert.equal(CONDS.targetDisabled(ctx, m), false, '처음');
  assert.equal(applyKnock(ctx, m, p.pos.x, p.pos.z, 0.8), true);
  const start = st.tick;
  const end = start + Math.max(1, ticks(STATUS.knockSec));
  const until = end + ticks(COND.knockSec);
  for (let t = start; t < until + 10; t++) {
    st.tick = t;
    if (m.knock && t >= m.knock.until) m.knock = null;   // status.js 가 하는 정리
    assert.equal(CONDS.targetDisabled(ctx, m), t < until, `틱 ${t - start}`);
  }
  // 정예(knockMul 0)는 넉백이 걸리지 않는다 → 조건도 켜지지 않는다
  const e = addTestMonster(ctx, { rank: 'elite', x: p.pos.x - 1.5, z: p.pos.z, hp: 1e6 });
  assert.equal(applyKnock(ctx, e, p.pos.x, p.pos.z, 0.8), false);
  assert.equal(CONDS.targetDisabled(ctx, e), false);
  assert.equal(CONDS.targetDisabled(ctx, null), false);
});

test('피드백 2 D10: 회전 베기(넉백 0.8m) 정타 → 넉백 끝 + 0.5초 안의 적중에 분쇄자(crusher · targetDisabled) 피해 % 가 더해진다 · 그 뒤 빠진다', () => {
  const st = makeTestState({ cls: 'warrior', level: 20 });
  st.char.skills.ranks = { groundStomp: 1, crusher: 3 };
  const stats = computeStats(st.char);
  const ctx = makeTestCtx(st, { stats });
  assert.ok(stats.conds.some(c => c.cond === 'targetDisabled'), '분쇄자 조건이 시트에');
  assert.ok(getNode('groundStomp').skill.status.knock > 0, '회전 베기는 넉백을 건다');
  const m = addTestMonster(ctx, { x: st.player.pos.x + 1.5, z: st.player.pos.z, hp: 1e6 });
  const off = () => condStatsFor(ctx, m, 'offense').dmgPct ?? 0;
  assert.equal(off(), 0, '넉백 전');
  applyKnock(ctx, m, st.player.pos.x, st.player.pos.z, getNode('groundStomp').skill.status.knock);
  assert.ok(off() > 0, '밀려나는 중');
  st.tick += Math.max(1, ticks(STATUS.knockSec)) + ticks(COND.knockSec) - 1;
  if (m.knock && st.tick >= m.knock.until) m.knock = null;
  assert.ok(off() > 0, '넉백 끝 + 0.5초 직전');
  st.tick += 1;
  assert.equal(off(), 0, '0.5초 뒤');
});
