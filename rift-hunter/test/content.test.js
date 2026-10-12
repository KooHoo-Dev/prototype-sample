// OWNER: P16 — 계약 §12.2(content.test) · §8.2 · §8.3 · §7.5 · §7.5b · §5.9
// 속성 6(번개 강화 · 순간이동 · 감옥 · 분열 · 역병 · 몰타르) 각각 + 잿빛 마녀(잿불 비 배치 · 하수인 상한 · 순간이동 · 거리 유지) · 위협 간격과 함께.
// W1 완성 구현(P2 effects · projectiles · status · combat · rift.resolveDeaths · P3 monsters 프레임워크 · GameSim)과 P0 헬퍼만 쓴다 — 같은 웨이브(W2)의 구현에 기대지 않는다.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EV, EventBus } from '../src/core/events.js';
import { hashState } from '../src/core/hash.js';
import { makeInput } from '../src/core/inputFrame.js';
import { angleDiff, yawOf } from '../src/core/math.js';
import { makeRng, seedRng } from '../src/core/rng.js';
import { circle, overlaps } from '../src/core/shapes.js';
import { shiftTicks, ticks } from '../src/core/time.js';
import { HAZARD } from '../src/data/combat.js';
import { getMonAffix, getMonDef } from '../src/data/index.js';
import { MON } from '../src/data/monsters.js';
import { MON_AFFIXES } from '../src/data/monsterAffixes.js';
import { GameSim } from '../src/sim/GameSim.js';
import { playerHit } from '../src/sim/combat.js';
import { spawnEffect, updateEffects } from '../src/sim/effects.js';
import { getMonster, rebuildSpace, removeMarked } from '../src/sim/entities.js';
import { AFFIX_HOOKS } from '../src/sim/monsters/affixHooks/index.js';
import { GUARDIAN_IMPLS } from '../src/sim/monsters/guardians/index.js';
import {
  monsterStats, onMonDamaged, onMonDeath, onMonHitPlayer, onMonSpawn, spawnGuardian, spawnMonster, updateMonsters, wakePack,
} from '../src/sim/monsters/monsters.js';
import { spawnPack } from '../src/sim/monsters/packs.js';
import { attackOf, sleepMonster } from '../src/sim/monsters/spawn.js';
import { makeDevCharacter } from '../src/sim/progression/dev.js';
import { updateProjectiles } from '../src/sim/projectiles.js';
import { resolveDeaths } from '../src/sim/rift.js';
import { updateStatus } from '../src/sim/status.js';
import { isWalkable, isWalkableR, losClear, moveCircle } from '../src/sim/world/nav.js';
import { assertFiniteDeep, makeTestCtx, makeTestMap, makeTestState } from './helpers.js';

const HOOKS = { onMonSpawn, onMonDamaged, onMonDeath, onMonHitPlayer };
const P16_AFFIXES = ['lightningEnchanted', 'teleporter', 'jailer', 'splitter', 'plague', 'mortar'];
const TAU = Math.PI * 2;
const EPS = 1e-6;

/** 40 × 40m 방 — 플레이어(23, 21) · 가운데 가로 벽(z 28~30 · x 10~36)이 있어 (23, 33)은 플레이어에서 보이지 않는다 */
const WALL_ROOM = [
  '######################',
  '#....................#',
  '#....................#',
  '#....................#',
  '#....................#',
  '#....................#',
  '#....................#',
  '#....................#',
  '#....................#',
  '#....................#',
  '#..........S.........#',
  '#....................#',
  '#....................#',
  '#....................#',
  '#....###########.....#',
  '#....................#',
  '#....................#',
  '#....................#',
  '#....................#',
  '#....................#',
  '#....................#',
  '######################',
].join('\n');

/** 균열 L 상태 · 실제 몬스터 훅 · 플레이어 생명 넉넉히(맞아도 쓰러지지 않는다 — 판정은 그대로 센다) */
function setup({ level = 12, ascii = null, tick = 100, seed = 1 } = {}) {
  const map = ascii ? makeTestMap(ascii) : makeTestMap();
  const state = makeTestState({ map, seed });
  state.rift.level = level;
  state.tick = tick;
  const ctx = makeTestCtx(state, { map, hooks: HOOKS });
  const p = state.player;
  p.lifeMax = 1e9;
  p.life = 1e9;
  return { state, ctx, map, p };
}

/** 한 틱(§5.1 의 균열 부분 — 플레이어 입력 없음): 보간 값 → 공간 해시 → 몬스터 → 투사체 → 효과 → 상태 → 정리 */
function world(ctx, n = 1, each = null) {
  for (let i = 0; i < n; i++) {
    const st = ctx.state;
    st.tick += 1;
    const p = st.player;
    p.prevPos.x = p.pos.x;
    p.prevPos.z = p.pos.z;
    for (const m of st.rift.mons) { m.prevPos.x = m.pos.x; m.prevPos.z = m.pos.z; }
    rebuildSpace(ctx);
    updateMonsters(ctx);
    updateProjectiles(ctx);
    updateEffects(ctx);
    updateStatus(ctx);
    removeMarked(ctx);
    if (each && each(i) === false) break;
  }
}

/** 팩 하나를 직접(하수인 없이 — 검사가 구성원을 정한다) · 깨어 있게 */
function makePack(ctx, kind, members) {
  const pk = { id: ctx.nextId(), kind, memberIds: [], awake: true, nextHazardAt: -1, fled: false, anchor: { x: members[0].x, z: members[0].z } };
  ctx.state.rift.packs.push(pk);
  const mons = members.map(o => {
    const m = spawnMonster(ctx, { typeId: 'ghoul', rank: kind === 'champion' ? 'champion' : 'elite', level: ctx.state.rift.level, packId: pk.id, awake: true, ...o });
    pk.memberIds.push(m.id);
    return m;
  });
  return { pk, mons };
}

/** 플레이어에서 (dx, dz) 떨어진 자리 */
function near(p, dx, dz) { return { x: p.pos.x + dx, z: p.pos.z + dz }; }

const HIT = (dmg) => ({ monId: -1, dmg, crit: false, killed: false, immune: false, blocked: false });
const SPEC = { skillId: 'bash', coef: 1, type: 'phys', tags: ['melee'], actionId: 1 };

function dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
function affixEvents(ctx, what) { return ctx.events.filter(e => e.name === EV.AFFIX && e.payload.what === what); }
function effectsOf(state, kind) { return state.rift.effects.filter(e => e.kind === kind); }

// ───────────────────────── 레지스트리 · 인터페이스 ─────────────────────────

test('레지스트리: 속성 6 · 잿빛 마녀가 계약의 훅 자리(§6.9)를 채웠다 — 스텁이 아니다', () => {
  for (const id of P16_AFFIXES) {
    const row = MON_AFFIXES.find(a => a.id === id);
    assert.ok(row, id);
    assert.ok(AFFIX_HOOKS[row.hook], `${id} 훅`);
  }
  assert.equal(typeof AFFIX_HOOKS.lightningEnchanted.onDamaged, 'function');
  assert.equal(typeof AFFIX_HOOKS.teleporter.onAwakeTick, 'function');
  assert.equal(typeof AFFIX_HOOKS.teleporter.onDamaged, 'function');
  for (const id of ['jailer', 'plague', 'mortar']) {
    assert.equal(typeof AFFIX_HOOKS[id].onAwakeTick, 'function', id);
    assert.equal(getMonAffix(id).hazard, true, `${id} 는 바닥 위협(팩 대표만)`);
  }
  assert.equal(typeof AFFIX_HOOKS.splitter.onDeath, 'function');
  const w = GUARDIAN_IMPLS.ashWitch;
  for (const k of ['init', 'think', 'strike', 'tickAttack']) assert.equal(typeof w[k], 'function', `ashWitch.${k}`);
});

// ───────────────────────── 번개 강화 ─────────────────────────

test('번개 강화: 피해를 받으면 chance(25%)로 불꽃 3발 — 120° 간격 · 6 m/s · r 0.35 · 2초 · 튕김 · 적대 · mon.dmg × 0.5 번개 · noAffix · AFFIX sparks · 내부 쿨 0.5초', () => {
  const { ctx, state, p } = setup();
  const row = getMonAffix('lightningEnchanted');
  const pr = row.params;
  const { mons: [m] } = makePack(ctx, 'elite', [{ ...near(p, 0, 4), affixes: ['lightningEnchanted'] }]);
  assert.equal(m.res.lightning, Math.min(MON.resCap, getMonDef('ghoul').res.lightning + row.mods.res.lightning), 'mods 저항');
  let fired = 0, first = null;
  const N = 400;
  for (let i = 0; i < N; i++) {
    state.tick += ticks(pr.icd);
    const before = state.rift.projs.length;
    ctx.events.length = 0;
    onMonDamaged(ctx, m, HIT(1), SPEC);
    const sparks = affixEvents(ctx, 'sparks');
    const made = state.rift.projs.slice(before);
    if (sparks.length) {
      fired += 1;
      assert.equal(made.length, pr.n);
      if (!first) first = { made, tick: state.tick, ev: sparks[0].payload };
    } else {
      assert.equal(made.length, 0);
    }
  }
  const rate = fired / N;
  assert.ok(rate > pr.chance - 0.07 && rate < pr.chance + 0.07, `발동 비율 ${rate}`);
  // 모양 · 수치
  const { made, tick, ev } = first;
  assert.equal(ev.monId, m.id);
  assert.equal(ev.affixId, 'lightningEnchanted');
  const angles = [];
  for (const pj of made) {
    assert.equal(pj.visual, 'spark');
    assert.equal(pj.owner, 'mon');
    assert.equal(pj.srcId, m.id);
    assert.ok(dist(pj.pos, m.pos) < EPS, '몸 중심에서');
    assert.ok(Math.abs(Math.hypot(pj.vel.x, pj.vel.z) - pr.speed) < EPS);
    assert.equal(pj.r, pr.r);
    assert.equal(pj.until - pj.born, ticks(pr.life));
    assert.equal(pj.born, tick);
    assert.equal(pj.bounce, true);
    assert.equal(pj.spec.via, 'projectile');
    assert.equal(pj.spec.type, 'lightning');
    assert.equal(pj.spec.noAffix, true);
    assert.ok(Math.abs(pj.spec.raw - m.dmg * pr.mul) < EPS);
    angles.push(yawOf(pj.vel.x, pj.vel.z));
  }
  for (let k = 1; k < angles.length; k++) assert.ok(Math.abs(Math.abs(angleDiff(angles[k - 1], angles[k])) - TAU / pr.n) < 1e-9, '120° 간격');
  // 내부 쿨 — 쏜 직후 icd 동안은 몇 번 맞아도 없다(난수도 쓰지 않는다)
  const rngBefore = state.rng.ai.s;
  const st = m.ax.lightningEnchanted;
  state.tick = st.icdUntil - 1;
  for (let i = 0; i < 50; i++) onMonDamaged(ctx, m, HIT(5), SPEC);
  assert.equal(state.rng.ai.s, rngBefore, '쿨 중에는 굴리지 않는다');
  // 플레이어가 쓰러져 있으면 없다
  state.tick += 100;
  p.dead = true;
  const nb = state.rift.projs.length;
  for (let i = 0; i < 40; i++) { state.tick += ticks(pr.icd); onMonDamaged(ctx, m, HIT(1), SPEC); }
  assert.equal(state.rift.projs.length, nb);
});

test('번개 강화: 불꽃이 플레이어를 맞힌다(PLAYER_HIT 번개 · projectile) — noAffix 라 같은 몬스터의 흡혈이 돌지 않는다 · 쓰러뜨린 적중도 튄다 · dead 면 없다', () => {
  const { ctx, state, p } = setup();
  const { mons: [m] } = makePack(ctx, 'elite', [{ ...near(p, 0, 2.2), affixes: ['lightningEnchanted', 'vampiric'] }]);
  m.hp = m.hpMax * 0.5;
  const hp0 = m.hp;
  let hits = 0, dmg = 0;
  for (let i = 0; i < 200; i++) {
    state.tick += 1;
    onMonDamaged(ctx, m, HIT(1), SPEC);
    for (let k = 0; k < 15; k++) {
      state.tick += 1;
      ctx.events.length = 0;
      updateProjectiles(ctx);
      for (const e of ctx.events) if (e.name === EV.PLAYER_HIT && e.payload.type === 'lightning' && e.payload.via === 'projectile') { hits += 1; dmg += e.payload.amount; }
    }
    removeMarked(ctx);
  }
  assert.ok(hits > 0 && dmg > 0, `불꽃 적중 ${hits}`);
  assert.equal(m.hp, hp0, '불꽃 적중은 속성 onHitPlayer(흡혈)를 부르지 않는다');
  // 쓰러뜨린 적중(생명 0 · 아직 dead 아님)도 「맞을 때」다
  const { mons: [k] } = makePack(ctx, 'elite', [{ ...near(p, 3, 0), affixes: ['lightningEnchanted'] }]);
  let any = false;
  for (let i = 0; i < 60 && !any; i++) {
    state.tick += 20;
    k.hp = 0;
    ctx.events.length = 0;
    onMonDamaged(ctx, k, HIT(1), SPEC);
    any = affixEvents(ctx, 'sparks').length > 0;
  }
  assert.ok(any, '쓰러뜨린 적중에도 불꽃');
  k.dead = true;
  const nb = state.rift.projs.length;
  for (let i = 0; i < 40; i++) { state.tick += 20; onMonDamaged(ctx, k, HIT(1), SPEC); }
  assert.equal(state.rift.projs.length, nb, 'dead 면 없다');
});

test('번개 강화: 불꽃은 벽에 튕기고 끝까지 걷기 가능 칸 안에 있다', () => {
  const { ctx, state, p } = setup();
  p.pos.x = 4; p.pos.z = 40;   // 구석(불꽃이 플레이어에 막혀 끝나지 않게 멀리)
  const { mons: [m] } = makePack(ctx, 'elite', [{ x: 4, z: 4, affixes: ['lightningEnchanted'] }]);
  let flipped = 0;
  for (let i = 0; i < 80; i++) {
    state.tick += 20;
    onMonDamaged(ctx, m, HIT(1), SPEC);
  }
  const sparks = state.rift.projs.filter(q => q.visual === 'spark');
  const v0 = new Map(sparks.map(q => [q.id, { x: q.vel.x, z: q.vel.z }]));
  for (let t = 0; t < 60; t++) {
    state.tick += 1;
    updateProjectiles(ctx);
    for (const q of sparks) if (q.until > state.tick) assert.ok(isWalkable(ctx.map, q.pos.x, q.pos.z), '벽을 뚫지 않는다');
  }
  for (const q of sparks) { const a = v0.get(q.id); if (Math.sign(a.x) !== Math.sign(q.vel.x) || Math.sign(a.z) !== Math.sign(q.vel.z)) flipped += 1; }
  assert.ok(sparks.length > 0 && flipped > 0, `튕긴 불꽃 ${flipped}/${sparks.length}`);
});

// ───────────────────────── 순간이동 ─────────────────────────

test('순간이동: 8m 넘게 떨어지면 act vanish(0.4초 · 무적 · teleportOut) → actEnd 틱에 플레이어에서 2.5~4m · 시야 · 걷기 가능 점(teleportIn · 보간 끊기) · 쿨 4초', () => {
  const { ctx, state, p } = setup();
  const row = getMonAffix('teleporter');
  const pr = row.params;
  const { mons: [m] } = makePack(ctx, 'elite', [{ ...near(p, 0, 12), affixes: ['teleporter'] }]);
  world(ctx, 1);
  const t0 = state.tick;
  assert.equal(m.act, 'vanish');
  assert.equal(m.actStart, t0);
  assert.equal(m.actEnd, t0 + ticks(pr.vanish));
  assert.ok(m.st.invulnUntil >= m.actEnd, '사라진 동안 무적');
  const out = affixEvents(ctx, 'teleportOut');
  assert.equal(out.length, 1);
  const from = { x: m.pos.x, z: m.pos.z };
  assert.ok(dist(out[0].payload, from) < EPS);
  assert.equal(m.ax.teleporter.readyAt, t0 + ticks(pr.cd));
  // 사라진 동안: 맞아도 피해 0(immune) · 자리 그대로
  const r = playerHit(ctx, m, SPEC);
  assert.equal(r.dmg, 0);
  assert.equal(r.immune, true);
  world(ctx, ticks(pr.vanish) - 1);
  assert.equal(m.act, 'vanish');
  assert.ok(dist(m.pos, from) < EPS, '사라진 동안 움직이지 않는다');
  ctx.events.length = 0;
  world(ctx, 1);
  assert.equal(state.tick, m.actEnd, 'actEnd 틱에 나타난다');
  assert.notEqual(m.act, 'vanish');
  const d = dist(m.pos, p.pos);
  assert.ok(d >= pr.minR - EPS && d <= pr.maxR + EPS, `거리 ${d}`);
  assert.ok(isWalkableR(ctx.map, m.pos.x, m.pos.z, m.r));
  assert.ok(losClear(ctx.map, p.pos.x, p.pos.z, m.pos.x, m.pos.z));
  assert.ok(dist(m.prevPos, m.pos) < EPS, '보간을 끊는다');
  assert.ok(Math.abs(angleDiff(m.facing, yawOf(p.pos.x - m.pos.x, p.pos.z - m.pos.z))) < 1e-9, '플레이어를 본다');
  assert.ok(m.st.invulnUntil <= state.tick, '나타나면 무적이 끝난다');
  const inn = affixEvents(ctx, 'teleportIn');
  assert.equal(inn.length, 1);
  assert.ok(dist(inn[0].payload, m.pos) < EPS);
  // 쿨 동안은 다시 멀어져도 사라지지 않는다
  m.speed = 0;
  p.pos.z += 14;
  let again = -1;
  world(ctx, ticks(pr.cd) + 2, () => { if (m.act === 'vanish' && again < 0) again = state.tick; });
  assert.equal(again, t0 + ticks(pr.cd), '쿨이 끝난 틱에 다시');
});

test('순간이동: 맞으면 표시 → 다음 틱에 순간이동(가까워도) · 쿨 중 피해는 표시하지 않는다 · 기절 · 공격 중에는 기다린다', () => {
  const { ctx, state, p } = setup();
  const pr = getMonAffix('teleporter').params;
  const { mons: [m] } = makePack(ctx, 'elite', [{ ...near(p, 0, 3), affixes: ['teleporter'] }]);
  m.speed = 0;
  world(ctx, 5);
  assert.notEqual(m.act, 'vanish', '가깝고 맞지 않았으면 그대로');
  onMonDamaged(ctx, m, HIT(3), SPEC);
  assert.equal(m.ax.teleporter.marked, true);
  world(ctx, 1);
  assert.equal(m.act, 'vanish');
  world(ctx, ticks(pr.vanish));
  assert.notEqual(m.act, 'vanish');
  // 쿨 중 피해 → 표시 없음
  onMonDamaged(ctx, m, HIT(3), SPEC);
  assert.ok(!m.ax.teleporter.marked);
  // 쿨이 끝난 뒤 기절 중 표시 → 기절이 끝날 때까지 기다린다
  state.tick = m.ax.teleporter.readyAt + 1;
  onMonDamaged(ctx, m, HIT(3), SPEC);
  m.st.stunUntil = state.tick + 20;
  m.act = 'stunned';
  let at = -1;
  world(ctx, 40, () => { if (m.act === 'vanish' && at < 0) at = state.tick; });
  assert.ok(at > m.st.stunUntil - 1, `기절이 끝난 뒤(${at} · 기절 끝 ${m.st.stunUntil})`);
  // 공격(예비) 중이면 기다린다
  world(ctx, ticks(pr.vanish) + 1);
  state.tick = m.ax.teleporter.readyAt;
  m.act = 'windup'; m.actId = 'claw'; m.actStart = state.tick; m.actHit = state.tick + 20; m.actEnd = state.tick + 40;
  onMonDamaged(ctx, m, HIT(3), SPEC);
  world(ctx, 10);
  assert.ok(m.act !== 'vanish', '공격 중에는 사라지지 않는다');
});

test('순간이동: 사라짐은 반드시 끝난다 — 무작위 시나리오(멀어짐 · 피해 · 잠 · 깨움 · 마을 다녀오기) 전부에서 actEnd 넘어 사라져 있거나 무적이 남는 몬스터 0', () => {
  const pr = getMonAffix('teleporter').params;
  const vT = ticks(pr.vanish);
  let outs = 0, ins = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const { ctx, state, p, map } = setup({ seed });
    const rng = makeRng(seedRng(seed * 97 + 5));
    const { pk, mons } = makePack(ctx, 'champion', [
      { ...near(p, 0, 9), affixes: ['teleporter'] }, { ...near(p, 3, 9), affixes: ['teleporter'] }, { ...near(p, -3, 9), affixes: ['teleporter', 'fast'] },
    ]);
    for (let t = 0; t < 900; t++) {
      const r = rng.next();
      if (r < 0.02) {   // 플레이어가 순간이동(멀어지기)
        const a = rng.range(0, TAU), d = rng.range(2, 14);
        const np = moveCircle(map, p.pos, p.r, Math.sin(a) * d, Math.cos(a) * d);
        p.pos.x = np.x; p.pos.z = np.z;
      } else if (r < 0.06) {
        onMonDamaged(ctx, mons[rng.int(0, mons.length - 1)], HIT(1), SPEC);
      } else if (r < 0.065) {   // 진정(사망) — 그 자리에서 잠 · 잠시 뒤 깨움
        for (const m of mons) if (m.awake) sleepMonster(m);
        pk.awake = false;
      } else if (r < 0.07) {
        wakePack(ctx, pk.id, 'debug');
      } else if (r < 0.072) {   // 마을에 다녀오기(§5.11 — rift 하위 절대 틱을 민다)
        const delta = rng.int(30, 600);
        state.tick += delta;
        shiftTicks(state.rift, delta);
      }
      ctx.events.length = 0;
      world(ctx, 1);
      for (const e of ctx.events) if (e.name === EV.AFFIX) { if (e.payload.what === 'teleportOut') outs += 1; if (e.payload.what === 'teleportIn') ins += 1; }
      for (const m of mons) {
        if (m.act === 'vanish') assert.ok(state.tick < m.actEnd && m.actEnd - m.actStart <= vT, `seed ${seed} t ${state.tick}: 사라짐이 끝나지 않았다`);
        assert.ok(m.st.invulnUntil - state.tick <= vT, `seed ${seed}: 무적이 사라짐보다 길다`);
        assert.ok(isWalkable(map, m.pos.x, m.pos.z), '늘 걷기 가능');
      }
      p.life = p.lifeMax;
    }
    assertFiniteDeep(state.rift, `seed ${seed}`);
  }
  assert.ok(outs > 30, `사라짐 ${outs}`);
  assert.ok(ins >= outs - 12 * 3 && ins <= outs, `나타남 ${ins} / 사라짐 ${outs}(잠으로 끝난 것만 빠진다)`);
});

test('순간이동: 밖에서 세운 사라짐(고정 상태 꼴 — st 에 vanishing 없음)도 actEnd 에 다시 나타난다', () => {
  const { ctx, state, p } = setup();
  const { mons: [m] } = makePack(ctx, 'elite', [{ ...near(p, 5, 5), affixes: ['teleporter'] }]);
  const tick = state.tick;
  m.act = 'vanish'; m.actStart = tick - 3; m.actHit = tick - 3; m.actEnd = tick + 9; m.st.invulnUntil = tick + 9;
  m.ax.teleporter = { readyAt: tick + 120, marked: false };
  ctx.events.length = 0;
  world(ctx, 9);
  assert.notEqual(m.act, 'vanish');
  assert.equal(affixEvents(ctx, 'teleportIn').length, 1);
  const d = dist(m.pos, p.pos);
  assert.ok(d >= 2.5 - EPS && d <= 4 + EPS);
});

// ───────────────────────── 감옥 ─────────────────────────

test('감옥: 깬 뒤 2초 · 이후 7초마다 · 플레이어 자리 r 1.2 · 예고 0.8 · raw 0 + rootSec 1.5 → 판정 틱에 묶임 · rootLockUntil(H2) · AFFIX jailWarn', () => {
  const { ctx, state, p } = setup();
  const pr = getMonAffix('jailer').params;
  const { pk, mons: [m] } = makePack(ctx, 'elite', [{ ...near(p, 0, 6), affixes: ['jailer'] }]);
  m.speed = 0;
  const wake = state.tick + 1;
  const jails = [];
  let rootedAt = -1, rootUntil = -1, lockUntil = -1;
  world(ctx, ticks(pr.first + pr.every) + 2, () => {
    for (const e of ctx.events.splice(0)) {
      if (e.name === EV.AFFIX && e.payload.what === 'jailWarn') jails.push({ t: state.tick, ev: e.payload });
      if (e.name === EV.EFFECT_SPAWN && e.payload.kind === 'jail') jails.fx = [...(jails.fx ?? []), { ...state.rift.effects.find(x => x.id === e.payload.id) }];
    }
    if (rootedAt < 0 && p.st.rootUntil > state.tick) { rootedAt = state.tick; rootUntil = p.st.rootUntil; lockUntil = state.rift.rootLockUntil; }
  });
  assert.ok(jails.length >= 2, `감옥 ${jails.length}`);
  assert.equal(jails[0].t, wake + ticks(pr.first), '깬 뒤 first');
  assert.equal(jails[1].t, jails[0].t + ticks(pr.every), '이후 every');
  assert.ok(dist(jails[0].ev, m.pos) < EPS, 'AFFIX 는 시전한 몬스터 자리');
  assert.equal(jails.fx.length, jails.length);
  for (const x of jails.fx) {
    assert.equal(x.hostile, true);
    assert.equal(x.owner, 'mon');
    assert.equal(x.srcId, m.id);
    assert.equal(x.packId, pk.id);
    assert.equal(x.shape.type, 'circle');
    assert.equal(x.shape.r, pr.r);
    assert.ok(Math.hypot(x.shape.x - p.pos.x, x.shape.z - p.pos.z) < EPS, '플레이어 자리');
    assert.equal(x.hitAt - x.start, ticks(pr.delay));
    assert.equal(x.spec.raw, 0);
    assert.equal(x.spec.onHit.rootSec, pr.rootSec);
    assert.equal(x.cancelOnSrcDeath, false);
  }
  // 판정 — 서 있으면 첫 감옥의 판정 틱에 묶인다 · 속박 잠금 = 속박 끝 + afterRoot
  assert.equal(rootedAt, jails.fx[0].hitAt, '판정 틱에 묶인다');
  assert.equal(rootUntil, rootedAt + ticks(pr.rootSec));
  assert.equal(lockUntil, rootUntil + ticks(HAZARD.afterRoot));
});

test('감옥: 원 밖으로 걸어 나가면 묶이지 않는다 · 11m 밖 · 벽 너머 · 기절 출처 · 하수인은 감옥을 만들지 않는다', () => {
  const pr = getMonAffix('jailer').params;
  // 걸어 나가기(예고 0.8초 안에 1.6m)
  {
    const { ctx, state, p } = setup();
    const { mons: [m] } = makePack(ctx, 'elite', [{ ...near(p, 0, 6), affixes: ['jailer'] }]);
    m.speed = 0;
    world(ctx, ticks(pr.first) + 1);
    const e = effectsOf(state, 'jail')[0];
    assert.ok(e, '감옥 예고');
    p.pos.x += pr.escape;   // 데이터의 탈출 거리만큼
    world(ctx, ticks(pr.delay) + 2);
    assert.ok(!(p.st.rootUntil > state.tick), '빠져나가면 안 묶인다');
  }
  // 11m 밖(speed 0 — 거리 고정)
  {
    const { ctx, state, p } = setup();
    const { mons: [m] } = makePack(ctx, 'elite', [{ ...near(p, 0, pr.range + 0.5), affixes: ['jailer'] }]);
    m.speed = 0;
    world(ctx, 400);
    assert.equal(effectsOf(state, 'jail').length, 0);
    assert.equal(ctx.events.filter(e => e.name === EV.EFFECT_SPAWN && e.payload.kind === 'jail').length, 0);
  }
  // 벽 너머(6m 이지만 시야 없음)
  {
    const { ctx, state, p } = setup({ ascii: WALL_ROOM });
    assert.ok(!losClear(ctx.map, p.pos.x, p.pos.z, p.pos.x, p.pos.z + 10));
    const { mons: [m] } = makePack(ctx, 'elite', [{ ...near(p, 0, 10), affixes: ['jailer'] }]);
    m.speed = 0;
    world(ctx, 400);
    assert.equal(ctx.events.filter(e => e.name === EV.EFFECT_SPAWN && e.payload.kind === 'jail').length, 0, '벽 너머에서 표식 없음');
  }
  // 기절한 출처 → 막히고 기절이 끝난 첫 틱에(타이머를 버리지 않는다)
  {
    const { ctx, state, p } = setup();
    const { mons: [m] } = makePack(ctx, 'elite', [{ ...near(p, 0, 6), affixes: ['jailer'] }]);
    m.speed = 0;
    world(ctx, 1);
    const due = m.ax.jailer.nextAt;
    m.st.stunUntil = due + 30;
    m.act = 'stunned';
    let at = -1;
    world(ctx, ticks(pr.first) + 40, () => { if (at < 0 && ctx.events.some(e => e.name === EV.AFFIX && e.payload.what === 'jailWarn')) at = state.tick; ctx.events.length = 0; });
    assert.equal(at, due + 30, '기절이 끝난 틱');
  }
  // 정예 팩의 하수인은 감옥을 받지 않는다(minionShare false) · 대표(정예)만 만든다
  {
    const { ctx, state, p } = setup();
    const id = spawnPack(ctx, { typeId: 'ghoul', rank: 'elite', affixes: ['jailer'], x: p.pos.x, z: p.pos.z + 6, awake: true });
    const pk = state.rift.packs.find(x => x.id === id);
    const members = pk.memberIds.map(i => getMonster(ctx, i));
    for (const mm of members) { mm.speed = 0; if (mm.rank === 'minion') assert.ok(!mm.affixes.includes('jailer')); }
    world(ctx, ticks(pr.first) + 5);
    const fx = effectsOf(state, 'jail');
    assert.equal(fx.length, 1);
    assert.equal(getMonster(ctx, fx[0].srcId).rank, 'elite');
  }
});

test('감옥: 챔피언 팩은 대표 하나만 감옥을 깐다(겹쳐 쏘지 않는다) · 대표가 죽으면 다음 구성원이 이어받는다', () => {
  const { ctx, state, p } = setup();
  const pr = getMonAffix('jailer').params;
  const { mons } = makePack(ctx, 'champion', [
    { ...near(p, 0, 6), affixes: ['jailer'] }, { ...near(p, 2, 6), affixes: ['jailer'] }, { ...near(p, -2, 6), affixes: ['jailer'] },
  ]);
  for (const m of mons) m.speed = 0;
  const casters = [];
  const grab = () => { for (const e of ctx.events.splice(0)) if (e.name === EV.AFFIX && e.payload.what === 'jailWarn') casters.push(e.payload.monId); };
  world(ctx, ticks(pr.first) + 3, grab);
  assert.equal(effectsOf(state, 'jail').length, 1);
  assert.deepEqual(casters, [mons[0].id], '대표(첫 구성원)만');
  mons[0].hp = 0;
  mons[0].dead = true;
  casters.length = 0;
  world(ctx, ticks(pr.first + pr.every) + 5, grab);
  assert.ok(casters.length >= 1 && casters.every(id => id === mons[1].id), `다음 대표 ${casters}`);
});

test('감옥 P16 보수 규칙: 감옥 원에 적대 웅덩이(역병 · 독 — 예고 중 포함)가 겹치면 시작하지 않는다 → 웅덩이가 끝나면 시작', () => {
  const { ctx, state, p } = setup();
  const pr = getMonAffix('jailer').params;
  const { mons: [m] } = makePack(ctx, 'elite', [{ ...near(p, 0, 6), affixes: ['jailer'] }]);
  m.speed = 0;
  // 다른 출처의 역병 웅덩이(플레이어 옆 — 감옥 원과 겹친다)
  const pool = spawnEffect(ctx, {
    kind: 'plague', owner: 'mon', srcId: -1, packId: -1, hostile: true, shape: circle(p.pos.x + 2.5, p.pos.z, 2.0), delay: 0, dur: 6, tick: 0.5,
    spec: null, tickSpec: { srcId: -1, via: 'hazard', raw: 1, type: 'phys', level: 1 },
  });
  let at = -1;
  world(ctx, ticks(6) + ticks(pr.first) + 5, () => { if (at < 0 && effectsOf(state, 'jail').length) at = state.tick; });
  assert.ok(at >= pool.end, `웅덩이가 끝난 뒤(${at} ≥ ${pool.end})`);
});

// ───────────────────────── 역병 ─────────────────────────

test('역병: 깬 뒤 2초 · 이후 6초마다 · 플레이어 자리 r 2.0 · 예고 1.0 → 웅덩이 5초(0.5초 틱 · 초당 mon.dmg × 0.25) · 첫 피해 = hitAt + 0.5초 · 출처가 죽어도 남는다', () => {
  const { ctx, state, p } = setup();
  const pr = getMonAffix('plague').params;
  const { pk, mons: [m] } = makePack(ctx, 'elite', [{ ...near(p, 0, 7), affixes: ['plague'] }]);
  m.speed = 0;
  const wake = state.tick + 1;
  const hits = [];
  let warn = [];
  world(ctx, ticks(pr.first) + 1, () => { for (const e of ctx.events.splice(0)) if (e.name === EV.AFFIX && e.payload.what === 'plagueWarn') warn.push(state.tick); });
  assert.deepEqual(warn, [wake + ticks(pr.first)]);
  const e = effectsOf(state, 'plague')[0];
  assert.equal(e.hostile, true);
  assert.equal(e.packId, pk.id);
  assert.equal(e.shape.r, pr.r);
  assert.ok(Math.hypot(e.shape.x - p.pos.x, e.shape.z - p.pos.z) < EPS);
  assert.equal(e.hitAt - e.start, ticks(pr.delay));
  assert.equal(e.end - e.hitAt, ticks(pr.dur));
  assert.equal(e.tickT, ticks(pr.tick));
  assert.equal(e.spec, null, '예고 부분은 판정 없음');
  assert.ok(Math.abs(e.tickSpec.raw - m.dmg * pr.mulPerSec * pr.tick) < EPS);
  assert.equal(e.cancelOnSrcDeath, false);
  // 출처가 죽어도 웅덩이는 남는다
  m.hp = 0;
  m.dead = true;
  world(ctx, e.end - state.tick + 1, () => { for (const ev of ctx.events.splice(0)) if (ev.name === EV.PLAYER_HIT && ev.payload.via === 'hazard') hits.push(state.tick); });
  assert.ok(hits.length >= ticks(pr.dur) / ticks(pr.tick) - 1, `웅덩이 틱 ${hits.length}`);
  assert.equal(hits[0], e.hitAt + e.tickT, '놓이는 틱에는 맞지 않는다');
  assert.ok(hits.every(t => t < e.end));
  // 다음 주기(새 몬스터 — 죽은 출처는 더 깔지 않는다)
  const { mons: [m2] } = makePack(ctx, 'elite', [{ ...near(p, 3, 7), affixes: ['plague'] }]);
  m2.speed = 0;
  warn = [];
  world(ctx, ticks(pr.first + pr.every) + 2, () => { for (const ev of ctx.events.splice(0)) if (ev.name === EV.AFFIX && ev.payload.what === 'plagueWarn') warn.push(state.tick); });
  assert.equal(warn.length, 2);
  assert.equal(warn[1] - warn[0], ticks(pr.every));
});

// ───────────────────────── 몰타르 ─────────────────────────

test('몰타르: 6m 넘게 · 11m 안 · 시야면 깬 뒤 1.5초 · 이후 5초마다 포탄 3발(플레이어 자리 + 1~2m 둘) · r 1.5 · 예고 1.2 · from = 몬스터 · 위협 간격은 한 묶음', () => {
  const { ctx, state, p } = setup();
  const pr = getMonAffix('mortar').params;
  const { pk, mons: [m] } = makePack(ctx, 'elite', [{ typeId: 'skeletonArcher', ...near(p, 0, 8), affixes: ['mortar'] }]);
  m.speed = 0;
  const wake = state.tick + 1;
  const fires = [];
  world(ctx, ticks(pr.first) + 1, () => {
    for (const e of ctx.events.splice(0)) if (e.name === EV.AFFIX && e.payload.what === 'mortarFire') fires.push({ t: state.tick, n: state.rift.effects.filter(x => x.kind === 'mortar' && x.start === state.tick).length, gap: pk.nextHazardAt });
  });
  assert.equal(fires.length, 1);
  assert.equal(fires[0].t, wake + ticks(pr.first));
  assert.equal(fires[0].n, pr.n, '세 발');
  assert.equal(fires[0].gap, fires[0].t + ticks(HAZARD.packGap), 'noteHazard 한 번');
  const shells = effectsOf(state, 'mortar');
  assert.equal(shells.length, pr.n);
  const ds = shells.map(s => Math.hypot(s.shape.x - p.pos.x, s.shape.z - p.pos.z)).sort((a, b) => a - b);
  assert.ok(ds[0] < EPS, '하나는 플레이어 자리');
  for (const d of ds.slice(1)) assert.ok(d >= pr.spread * 0.5 - EPS && d <= pr.spread + EPS, `흩어짐 ${d}`);
  for (const s of shells) {
    assert.equal(s.shape.r, pr.r);
    assert.equal(s.hitAt - s.start, ticks(pr.delay));
    assert.ok(dist(s.from, m.pos) < EPS, 'from = 몬스터 자리');
    assert.ok(Math.abs(s.spec.raw - m.dmg * pr.mul) < EPS);
    assert.equal(s.hostile, true);
    assert.equal(s.cancelOnSrcDeath, false);
  }
  // 이후 every
  world(ctx, ticks(pr.every) + 1, () => { for (const e of ctx.events.splice(0)) if (e.name === EV.AFFIX && e.payload.what === 'mortarFire') fires.push({ t: state.tick }); });
  assert.equal(fires.length, 2);
  assert.equal(fires[1].t - fires[0].t, ticks(pr.every));
});

test('몰타르: 6m 안 · 11m 밖 · 벽 너머에서는 쏘지 않는다(화면 밖 · 벽 너머 포탄 없음) · H4(근처 예고 4 + 3 > 6)면 막혔다가 풀리면 쏜다', () => {
  const pr = getMonAffix('mortar').params;
  for (const dz of [pr.minDist - 0.5, pr.range + 0.5]) {
    const { ctx, state, p } = setup();
    const { mons: [m] } = makePack(ctx, 'elite', [{ typeId: 'skeletonArcher', ...near(p, 0, dz), affixes: ['mortar'] }]);
    m.speed = 0;
    world(ctx, 300);
    assert.equal(ctx.events.filter(e => e.name === EV.EFFECT_SPAWN && e.payload.kind === 'mortar').length, 0, `거리 ${dz}`);
  }
  {
    const { ctx, state, p } = setup({ ascii: WALL_ROOM });
    const { mons: [m] } = makePack(ctx, 'elite', [{ typeId: 'skeletonArcher', ...near(p, 0, 10), affixes: ['mortar'] }]);
    m.speed = 0;
    world(ctx, 300);
    assert.equal(ctx.events.filter(e => e.name === EV.EFFECT_SPAWN && e.payload.kind === 'mortar').length, 0, '벽 너머');
  }
  {
    const { ctx, state, p } = setup();
    const { mons: [m] } = makePack(ctx, 'elite', [{ typeId: 'skeletonArcher', ...near(p, 0, 8), affixes: ['mortar'] }]);
    m.speed = 0;
    world(ctx, 1);
    // 다른 출처의 예고 4개(플레이어 근처 — countR 4m 와 겹친다 · 3초 간다)
    let last = null;
    for (let k = 0; k < 4; k++) {
      last = spawnEffect(ctx, { kind: 'coldNova', owner: 'mon', srcId: -1, packId: -1, hostile: true, shape: circle(p.pos.x - 5 - k * 0.5, p.pos.z - 3, 4.0), delay: 3, spec: null });
    }
    const due = m.ax.mortar.nextAt;
    assert.ok(due < last.hitAt, '몰타르 차례가 예고 도중에 온다');
    let at = -1;
    world(ctx, ticks(3) + 5, () => { if (at < 0 && effectsOf(state, 'mortar').length) at = state.tick; });
    assert.equal(at, last.hitAt + 1, `막혔다가 예고가 끝난 첫 틱(${at})`);
  }
});

// ───────────────────────── 분열 ─────────────────────────

test('분열: 죽으면 시체 자리 1.5m 안 걷기 가능 점 3곳에 같은 종류 rank split(속성 없음 · 깨어 있게 · 같은 팩) · MON_SPAWNED{split} · AFFIX split · 사본은 다시 분열하지 않는다', () => {
  const { ctx, state, p } = setup();
  const pr = getMonAffix('splitter').params;
  const { pk, mons: [m] } = makePack(ctx, 'elite', [{ typeId: 'charger', ...near(p, 0, 7), affixes: ['splitter'] }]);
  m.hp = 0;
  m.lastHit = { by: 'player', skillId: 'bash', noProcs: false, frozen: false };
  ctx.events.length = 0;
  resolveDeaths(ctx);
  const copies = state.rift.mons.filter(x => x.rank === 'split');
  assert.equal(copies.length, pr.n);
  const spawned = ctx.events.filter(e => e.name === EV.MON_SPAWNED && e.payload.reason === 'split');
  assert.equal(spawned.length, pr.n);
  assert.equal(affixEvents(ctx, 'split').length, 1);
  const stats = monsterStats('charger', 'split', state.rift.level, []);
  for (const c of copies) {
    assert.equal(c.typeId, 'charger');
    assert.deepEqual(c.affixes, []);
    assert.equal(c.awake, true);
    assert.equal(c.packId, pk.id);
    assert.ok(pk.memberIds.includes(c.id));
    assert.ok(dist(c.pos, m.pos) <= pr.spread + EPS);
    assert.ok(isWalkableR(ctx.map, c.pos.x, c.pos.z, c.r));
    assert.ok(Math.abs(c.hpMax - stats.hpMax) < EPS);
    assert.ok(Math.abs(c.r - stats.r) < EPS);
  }
  assert.equal(pk.awake, true, '팩은 깨어 있다');
  // 사본을 죽여도 더 생기지 않는다 · rank split 에 붙은 분열도 없다
  for (const c of copies) { c.hp = 0; c.lastHit = { by: 'player', skillId: 'bash', noProcs: false, frozen: false }; }
  resolveDeaths(ctx);
  const s = spawnMonster(ctx, { typeId: 'ghoul', rank: 'split', level: 12, affixes: ['splitter'], x: p.pos.x + 3, z: p.pos.z, awake: true });
  s.hp = 0;
  resolveDeaths(ctx);
  assert.equal(state.rift.mons.filter(x => x.rank === 'split' && !x.dead).length, 0);
});

test('분열: 벽 구석에서도 사본은 걷기 가능 칸 · 수호자는 분열하지 않는다(처치 = 완료) · 사본은 실제로 플레이어를 친다', () => {
  {
    const { ctx, state } = setup();
    const { mons: [m] } = makePack(ctx, 'elite', [{ x: 2.8, z: 2.8, affixes: ['splitter'] }]);
    for (let i = 0; i < 20; i++) {
      m.hp = 0; m.dead = false; m.gone = false;
      onMonDeath(ctx, m);
    }
    for (const c of state.rift.mons.filter(x => x.rank === 'split')) assert.ok(isWalkableR(ctx.map, c.pos.x, c.pos.z, c.r), `(${c.pos.x}, ${c.pos.z})`);
  }
  {
    const { ctx, state, p } = setup();
    state.rift.guardianType = 'boneGiant';
    const g = spawnMonster(ctx, { typeId: 'boneGiant', rank: 'guardian', level: 12, affixes: ['splitter'], x: p.pos.x, z: p.pos.z + 9, awake: true });
    ctx.events.length = 0;
    onMonDeath(ctx, g);
    assert.equal(state.rift.mons.filter(x => x.rank === 'split').length, 0);
    assert.equal(affixEvents(ctx, 'split').length, 0);
  }
  {
    const { ctx, state, p } = setup();
    const { mons: [m] } = makePack(ctx, 'elite', [{ ...near(p, 0, 3), affixes: ['splitter'] }]);
    m.hp = 0;
    resolveDeaths(ctx);
    const ids = new Set(state.rift.mons.filter(x => x.rank === 'split').map(x => x.id));
    let hits = 0;
    world(ctx, 120, () => { for (const e of ctx.events.splice(0)) if (e.name === EV.PLAYER_HIT && ids.has(e.payload.srcId) && e.payload.amount > 0) hits += 1; });
    assert.ok(hits > 0, '사본이 근접 공격을 한다');
  }
});

// ───────────────────────── 잿빛 마녀 ─────────────────────────

function witchSetup(opts = {}) {
  const s = setup(opts);
  s.state.rift.guardianType = 'ashWitch';
  s.state.rift.phase = 'guardian';
  const g = spawnGuardian(s.ctx, s.p.pos.x + (opts.gx ?? 0), s.p.pos.z + (opts.gz ?? 9));
  return { ...s, g, pk: s.state.rift.packs.find(x => x.id === g.packId), def: getMonDef('ashWitch') };
}

/** 잿불 비 원 다섯의 배치 규칙 — 하나는 플레이어 자리 · 넷은 ringMin..ringMax · 서로 minSepDeg 이상 */
function checkEmber(shapes, p, pr) {
  assert.equal(shapes.length, pr.n);
  const center = shapes.filter(s => Math.hypot(s.x - p.x, s.z - p.z) < EPS);
  assert.equal(center.length, 1, '플레이어 자리 하나');
  const ring = shapes.filter(s => Math.hypot(s.x - p.x, s.z - p.z) >= EPS);
  assert.equal(ring.length, pr.n - 1);
  const angs = [];
  for (const s of ring) {
    const d = Math.hypot(s.x - p.x, s.z - p.z);
    assert.ok(d >= pr.ringMin - EPS && d <= pr.ringMax + EPS, `고리 거리 ${d}`);
    angs.push(Math.atan2(s.x - p.x, s.z - p.z));
  }
  angs.sort((a, b) => a - b);
  const sep = (pr.minSepDeg * Math.PI) / 180;
  for (let i = 0; i < angs.length; i++) {
    const a = angs[i], b = i + 1 < angs.length ? angs[i + 1] : angs[0] + TAU;
    assert.ok(b - a >= sep - 1e-9, `간격 ${((b - a) * 180) / Math.PI}°`);
  }
  for (const s of shapes) assert.equal(s.r, pr.r);
}

test('잿빛 마녀 잿불 비: 11m 안 · 시야 · 예비 시작 틱에 효과 emberRain 5개(플레이어 자리 + 2.5~3.5m 고리 · 72° 이상) · 예고 = 예비 길이 1.2 · H4 count 5 · from = 마녀 · 판정은 효과(strike 는 다시 만들지 않는다)', () => {
  const { ctx, state, p, g, pk, def } = witchSetup();
  const atk = attackOf(def, 'emberRain');
  const pr = atk.params;
  assert.ok(g.ax.g, 'init');
  world(ctx, 1);
  assert.equal(g.act, 'cast');
  assert.equal(g.actId, 'emberRain');
  const fx = effectsOf(state, 'emberRain');
  checkEmber(fx.map(e => e.shape), p.pos, pr);
  for (const e of fx) {
    assert.equal(e.start, state.tick);
    assert.equal(e.hitAt, g.actHit, 'hitAt === actHit');
    assert.equal(e.hitAt - e.start, ticks(atk.windup));
    assert.equal(e.hostile, true);
    assert.equal(e.srcId, g.id);
    assert.equal(e.packId, pk.id);
    assert.ok(dist(e.from, g.pos) < EPS);
    assert.ok(Math.abs(e.spec.raw - g.dmg * atk.mul) < EPS);
    assert.equal(e.spec.type, 'fire');
    assert.equal(e.cancelOnSrcDeath, false);
  }
  assert.equal(pk.nextHazardAt, state.tick + ticks(HAZARD.packGap));
  // 판정 틱 — strike 가 효과를 더 만들지 않는다 · 서 있는 플레이어는 가운데 원에 맞는다
  let hits = 0;
  world(ctx, g.actHit - state.tick, () => { for (const e of ctx.events.splice(0)) if (e.name === EV.PLAYER_HIT && e.payload.via === 'hazard' && e.payload.srcId === g.id) hits += 1; });
  assert.equal(effectsOf(state, 'emberRain').length, pr.n);
  assert.ok(hits >= 1, '가운데 원');
  // 배치 규칙 — 여러 번
  for (let seed = 1; seed <= 150; seed++) {
    const w = witchSetup({ seed });
    world(w.ctx, 1);
    checkEmber(effectsOf(w.state, 'emberRain').map(e => e.shape), w.p.pos, pr);
  }
});

test('잿빛 마녀: 잿불 비가 위협 간격(H4 — 근처 예고 2 + 5 > 6)에 막히면 그 기술을 시작하지 않고 다른 것을 한다 · 벽 너머 · 11m 밖이면 쓰지 않는다', () => {
  {
    const { ctx, state, p, g } = witchSetup();
    for (let k = 0; k < 2; k++) spawnEffect(ctx, { kind: 'coldNova', owner: 'mon', srcId: -1, packId: -1, hostile: true, shape: circle(p.pos.x + 5, p.pos.z + k, 4.0), delay: 2, spec: null });
    world(ctx, 1);
    assert.equal(effectsOf(state, 'emberRain').length, 0);
    assert.notEqual(g.actId, 'emberRain');
    assert.equal(g.actId, 'summon', '대신 소환');
  }
  {
    const { ctx, state, g } = witchSetup({ ascii: WALL_ROOM, gz: 10 });
    g.speed = 0;
    world(ctx, 60);
    assert.equal(ctx.events.filter(e => e.name === EV.EFFECT_SPAWN && e.payload.kind === 'emberRain').length, 0, '벽 너머');
  }
  {
    const { ctx, g } = witchSetup({ gz: 11.5 });
    g.speed = 0;
    world(ctx, 60);
    assert.equal(ctx.events.filter(e => e.name === EV.EFFECT_SPAWN && e.payload.kind === 'emberRain').length, 0, '11m 밖');
  }
});

test('잿빛 마녀 소환: 시전 1.0초 → 판정 틱에 잿빛 하수인 4(rank spawn · 깨어 있게 · 같은 팩 · 마녀 몸에서 2m · MON_SPAWNED{summon}) · 살아 있는 하수인 상한 8 · 하수인은 실제로 친다', () => {
  const { ctx, state, p, g, pk, def } = witchSetup();
  const sm = attackOf(def, 'summon');
  const pr = sm.params;
  g.readyAt.emberRain = state.tick + 9999;
  world(ctx, 1);
  assert.equal(g.act, 'cast');
  assert.equal(g.actId, 'summon');
  const hitAt = g.actHit;
  assert.equal(hitAt - state.tick, ticks(sm.windup));
  ctx.events.length = 0;
  world(ctx, hitAt - state.tick);
  const kids = state.rift.mons.filter(m => m.typeId === pr.child);
  assert.equal(kids.length, pr.n);
  assert.equal(ctx.events.filter(e => e.name === EV.MON_SPAWNED && e.payload.reason === 'summon').length, pr.n);
  for (const k of kids) {
    assert.equal(k.rank, 'spawn');
    assert.equal(k.awake, true);
    assert.equal(k.packId, pk.id);
    assert.ok(pk.memberIds.includes(k.id));
    assert.ok(isWalkableR(ctx.map, k.pos.x, k.pos.z, k.r));
    assert.ok(dist(k.pos, g.pos) <= g.r + pr.r + 0.6, `마녀 곁 ${dist(k.pos, g.pos)}`);
  }
  // 하수인이 플레이어를 친다
  let hits = 0;
  const ids = new Set(kids.map(k => k.id));
  world(ctx, 150, () => { for (const e of ctx.events.splice(0)) if (e.name === EV.PLAYER_HIT && ids.has(e.payload.srcId) && e.payload.amount > 0) hits += 1; });
  assert.ok(hits > 0, `하수인 적중 ${hits}`);
  // 상한 — 살아 있는 6 이면 2만 더 · 8 이면 시전하지 않는다
  for (const cap of [6, 8]) {
    const w = witchSetup();
    w.g.readyAt.emberRain = w.state.tick + 9999;
    for (let i = 0; i < cap; i++) {
      const k = spawnMonster(w.ctx, { typeId: pr.child, rank: 'spawn', level: 12, packId: w.pk.id, x: w.p.pos.x - 6 + i, z: w.p.pos.z - 6, awake: true });
      k.speed = 0;
      w.pk.memberIds.push(k.id);
    }
    w.ctx.events.length = 0;
    world(w.ctx, ticks(sm.windup) + 2);
    const n = w.state.rift.mons.filter(m => m.typeId === pr.child && !m.dead).length;
    assert.equal(n, Math.max(cap, Math.min(pr.cap, cap + pr.n)), `cap ${cap}`);
    if (cap >= pr.cap) assert.equal(w.ctx.events.filter(e => e.name === EV.MON_ACT && e.payload.actId === 'summon').length, 0, '상한이면 시전하지 않는다');
  }
});

test('잿빛 마녀 이동: 3m 안에 1.5초 있으면 플레이어에서 6m · 시야 · 걷기 가능 점으로 즉시 순간이동(MON_ACT{actId:"blink"} · 보간 끊기 · 쿨 6초) · 10m 밖이면 다가오고 안에서는 제자리 · 재 화살', () => {
  const { ctx, state, p, g, def } = witchSetup({ gz: 2.5 });
  const pr = def.params;
  g.readyAt.emberRain = g.readyAt.summon = g.readyAt.ashBolt = state.tick + 99999;
  let blinkAt = -1, ev = null, nearFrom = -1;
  for (let i = 0; i < 120 && blinkAt < 0; i++) {
    // 플레이어가 마녀를 따라붙는다(2m)
    const a = yawOf(g.pos.x - p.pos.x, g.pos.z - p.pos.z);
    if (dist(g.pos, p.pos) > 2) { p.pos.x = g.pos.x - Math.sin(a) * 2; p.pos.z = g.pos.z - Math.cos(a) * 2; }
    ctx.events.length = 0;
    world(ctx, 1);
    if (nearFrom < 0 && g.ax.g.nearAt >= 0) nearFrom = g.ax.g.nearAt;
    const b = ctx.events.find(e => e.name === EV.MON_ACT && e.payload.actId === 'blink');
    if (b) { blinkAt = state.tick; ev = b.payload; }
  }
  assert.ok(blinkAt > 0, '순간이동');
  assert.equal(blinkAt - nearFrom, ticks(pr.blinkAfter), '3m 안 1.5초');
  assert.ok(Math.abs(dist(g.pos, p.pos) - pr.blinkDist) < 1e-6, '플레이어에서 6m');
  assert.ok(isWalkableR(ctx.map, g.pos.x, g.pos.z, g.r));
  assert.ok(losClear(ctx.map, p.pos.x, p.pos.z, g.pos.x, g.pos.z));
  assert.ok(dist(g.prevPos, g.pos) < EPS, '보간 끊기');
  assert.equal(ev.id, g.id);
  assert.equal(g.ax.g.blinkAt, blinkAt + ticks(pr.blinkCd));
  // 쿨 동안은 다시 붙어도 순간이동하지 않는다
  let again = -1;
  for (let i = 0; i < ticks(pr.blinkCd) + 30 && again < 0; i++) {
    const a = yawOf(g.pos.x - p.pos.x, g.pos.z - p.pos.z);
    if (dist(g.pos, p.pos) > 2) { p.pos.x = g.pos.x - Math.sin(a) * 2; p.pos.z = g.pos.z - Math.cos(a) * 2; }
    ctx.events.length = 0;
    world(ctx, 1);
    if (ctx.events.some(e => e.name === EV.MON_ACT && e.payload.actId === 'blink')) again = state.tick;
  }
  assert.ok(again >= blinkAt + ticks(pr.blinkCd), `쿨 뒤(${again - blinkAt}틱)`);
  // 거리 유지 — 10m 안이면 뒷걸음질하지 않고 제자리(붙잡히면 순간이동이 벌린다) · 15m 면 10m 안으로 다가온다
  {
    const w = witchSetup({ gz: 4 });
    w.g.readyAt.emberRain = w.g.readyAt.summon = w.g.readyAt.ashBolt = w.state.tick + 99999;
    const at0 = { ...w.g.pos };
    world(w.ctx, 90);
    assert.ok(dist(w.g.pos, at0) < 0.3, `제자리 ${dist(w.g.pos, at0)}`);
    assert.equal(w.ctx.events.filter(e => e.name === EV.MON_ACT && e.payload.actId === 'blink').length, 0, '3m 밖(4m)이면 순간이동하지 않는다');
  }
  {
    const w = witchSetup({ gz: 15 });
    w.g.readyAt.emberRain = w.g.readyAt.summon = w.g.readyAt.ashBolt = w.state.tick + 99999;
    world(w.ctx, 120);
    const d = dist(w.g.pos, w.p.pos);
    assert.ok(d <= pr.keepMax + 0.5, `다가옴 ${d}`);
  }
  // 재 화살 — 11m 안 · 시야면 예비 → 판정 틱에 투사체 ashBolt
  {
    const w = witchSetup({ gz: 9 });
    w.g.readyAt.emberRain = w.g.readyAt.summon = w.state.tick + 99999;
    let proj = null;
    world(w.ctx, 30, () => { for (const e of w.ctx.events.splice(0)) if (e.name === EV.PROJ_SPAWN && e.payload.visual === 'ashBolt') proj = e.payload; });
    assert.ok(proj, '재 화살');
    assert.equal(proj.owner, 'mon');
  }
});

// ───────────────────────── 위협 간격 · 마을 다녀오기 · 통합 ─────────────────────────

/**
 * 감옥 + 역병 + 몰타르(같은 정예 — 계약 §8.2 의 경우) · dense 면 + 다른 팩 둘(몰타르 + 역병 챔피언 · 감옥 + 역병 정예) + 잿빛 마녀(감옥 · 역병 · 몰타르) —
 * 플레이어 행동 넷(서 있기 · 떠돌기 · 웅덩이만 비켜서기 · 예고 피하기). 묶인 동안 생명을 깎은 위협 판정(PLAYER_HIT via hazard · amount > 0)을 센다.
 */
function spacingRun({ seed, mode, dense, n = 2400 }) {
  const { ctx, state, p, map } = setup({ seed });
  const rng = makeRng(seedRng(seed * 31 + 7));
  spawnPack(ctx, { typeId: 'skeletonArcher', rank: 'elite', affixes: ['jailer', 'plague', 'mortar'], x: p.pos.x + 8, z: p.pos.z, awake: true });
  if (dense) {
    spawnPack(ctx, { typeId: 'skeletonArcher', rank: 'champion', affixes: ['mortar', 'plague'], x: p.pos.x - 8, z: p.pos.z + 2, awake: true });
    spawnPack(ctx, { typeId: 'ghoul', rank: 'elite', affixes: ['jailer', 'plague'], x: p.pos.x, z: p.pos.z - 9, awake: true });
    state.rift.guardianType = 'ashWitch';
    const g = spawnGuardian(ctx, p.pos.x + 2, p.pos.z + 9);
    g.affixes = ['jailer', 'plague', 'mortar'];
    for (const id of g.affixes) g.ax[id] = {};
  }
  const c = { rootedHits: 0, hazardHits: 0, roots: 0, jail: 0, plague: 0, mortar: 0, emberRain: 0 };
  const orig = ctx.emit;
  ctx.emit = (name, payload = {}) => {
    if (name === EV.PLAYER_HIT && payload.via === 'hazard' && payload.amount > 0) {
      c.hazardHits += 1;
      if (p.st.rootUntil > state.tick) c.rootedHits += 1;
    }
    if (name === EV.PLAYER_STATUS && payload.kind === 'root' && payload.on) c.roots += 1;
    if (name === EV.EFFECT_SPAWN && payload.kind in c) c[payload.kind] += 1;
    orig(name, payload);
  };
  let dir = 0, turnAt = 0;
  for (let i = 0; i < n; i++) {
    const tick = state.tick + 1;
    if (!(p.st.rootUntil > tick) && mode !== 'still') {
      let vx = 0, vz = 0;
      if (mode === 'wander') {
        if (tick >= turnAt) { dir = rng.range(0, TAU); turnAt = tick + 20 + rng.int(0, 40); }
        vx = Math.sin(dir); vz = Math.cos(dir);
      } else {
        for (const e of state.rift.effects) {
          if (!e.hostile || e.end <= tick || !overlaps(e.shape, p.pos.x, p.pos.z, p.r + 0.2)) continue;
          if (mode === 'pools' && !(e.tickT > 0 && tick >= e.hitAt)) continue;   // 웅덩이만 비켜서고 예고에는 서 있는다(감옥에 잘 묶인다)
          const dx = p.pos.x - e.shape.x, dz = p.pos.z - e.shape.z, l = Math.hypot(dx, dz);
          if (l > 0) { vx += dx / l; vz += dz / l; } else { vx += Math.sin(dir); vz += Math.cos(dir); dir += 1; }
        }
      }
      const l = Math.hypot(vx, vz);
      if (l > 0) {
        const sp = 6 * (p.st.slowUntil > tick ? 1 - p.st.slowPct : 1) / 30;
        const np = moveCircle(map, p.pos, p.r, (vx / l) * sp, (vz / l) * sp);
        p.pos.x = np.x; p.pos.z = np.z;
      }
    }
    world(ctx, 1);
    p.life = p.lifeMax;
  }
  assertFiniteDeep(state.rift, `${mode} ${seed}`);
  return c;
}

test('위협 간격(§5.9 · §8.2): 감옥 + 역병 + 몰타르 정예 · 다른 팩 둘 · 같은 속성의 잿빛 마녀가 겹쳐도 「묶인 채 맞는」 위협 판정 0 — 서 있기 · 떠돌기 · 웅덩이만 비켜서기 · 피하기', () => {
  const tot = { rootedHits: 0, hazardHits: 0, roots: 0, jail: 0, plague: 0, mortar: 0, emberRain: 0 };
  for (const dense of [false, true]) {
    for (const mode of ['still', 'wander', 'pools', 'dodge']) {
      for (let seed = 1; seed <= 2; seed++) {
        const c = spacingRun({ seed, mode, dense });
        assert.equal(c.rootedHits, 0, `${dense ? '겹침' : '정예 하나'} ${mode} seed ${seed}: 묶인 채 맞음 ${c.rootedHits}`);
        for (const k of Object.keys(tot)) tot[k] += c[k];
      }
    }
  }
  // 시나리오가 실제로 위협을 겹쳤다(빈 검사가 아니다 — 묶임 · 감옥 · 역병 · 몰타르 · 잿불 비가 다 났다)
  assert.ok(tot.roots >= 20, `묶임 ${tot.roots}`);
  assert.ok(tot.jail > 0 && tot.plague > 0 && tot.mortar > 0 && tot.emberRain > 0, JSON.stringify(tot));
  assert.ok(tot.hazardHits > 100, `위협 적중 ${tot.hazardHits}`);
});

/** 감옥 · 역병 · 몰타르 · 순간이동 · 번개 · 분열 · 마녀를 한 판에 — 플레이어는 서 있다. 그 사이 마을에 다녀오기(trip)를 끼울 수 있다 */
function tripRun(trip) {
  const { ctx, state, p } = setup({ seed: 4 });
  spawnPack(ctx, { typeId: 'skeletonArcher', rank: 'elite', affixes: ['jailer', 'plague', 'mortar'], x: p.pos.x + 8, z: p.pos.z, awake: true });
  spawnPack(ctx, { typeId: 'ghoul', rank: 'champion', affixes: ['teleporter', 'lightningEnchanted'], x: p.pos.x - 10, z: p.pos.z + 6, awake: true });
  spawnPack(ctx, { typeId: 'ghoul', rank: 'elite', affixes: ['splitter', 'plague'], x: p.pos.x, z: p.pos.z - 9, awake: true });
  state.rift.guardianType = 'ashWitch';
  spawnGuardian(ctx, p.pos.x + 3, p.pos.z + 9);
  const log = [];
  let off = 0, done = false;
  const orig = ctx.emit;
  ctx.emit = (name, payload = {}) => {
    if (name === EV.EFFECT_SPAWN || name === EV.AFFIX || name === EV.MON_SPAWNED || name === EV.MON_ACT || name === EV.PROJ_SPAWN) {
      log.push(`${state.tick - off}:${name}:${payload.kind ?? payload.what ?? payload.reason ?? payload.actId ?? payload.visual}`);
    }
    orig(name, payload);
  };
  const t0 = state.tick;
  for (let i = 0; i < 1500; i++) {
    // 마을에 다녀오기 — 묶이지 않은 첫 틱(플레이어 시각은 밀지 않는다 — §5.11)
    if (trip && !done && state.tick - t0 >= 400 && !(p.st.rootUntil > state.tick) && !(p.st.slowUntil > state.tick)) {
      state.tick += trip;
      shiftTicks(state.rift, trip);
      off += trip;
      done = true;
    }
    world(ctx, 1);
    // 몬스터 몇을 때려 피격 훅(번개 · 순간이동)을 돌린다
    if (i % 7 === 0) for (const m of state.rift.mons) if (!m.dead && !m.gone && m.affixes.length && dist(m.pos, p.pos) < 5) onMonDamaged(ctx, m, HIT(0.5), SPEC);
    p.life = p.lifeMax;
  }
  return { log, state };
}

test('마을에 다녀와도(shiftTicks) 속성 주기 · 사라짐 · 마녀 타이머가 멈춰 있다 — 같은 판을 다녀오지 않은 판과 균열 시각 기준으로 똑같이 재현 · 훅 상태의 절대 틱은 At · Until 이름뿐', () => {
  const a = tripRun(0);
  const b = tripRun(900);
  assert.ok(a.log.length > 50, `사건 ${a.log.length}`);
  assert.deepEqual(b.log, a.log, '다녀온 판 = 다녀오지 않은 판(밀린 위협이 한꺼번에 터지지 않는다)');
  // 훅 상태 키 규칙 — 숫자는 이름 끝 At · Until(절대 틱)뿐
  for (const run of [a, b]) {
    for (const m of run.state.rift.mons) {
      for (const id of [...P16_AFFIXES, 'g']) {
        const st = m.ax?.[id];
        if (!st) continue;
        for (const [k, v] of Object.entries(st)) {
          if (typeof v === 'number') assert.ok(/(At|Until)$/.test(k), `ax.${id}.${k} — 숫자 필드는 절대 틱 이름이어야 shiftTicks 가 민다`);
          else assert.ok(typeof v === 'boolean', `ax.${id}.${k} 는 불리언`);
        }
      }
    }
  }
});

test('통합(실제 GameSim): 개발 캐릭터 · 균열 12 · 속성 6 정예/챔피언 + 잿빛 마녀를 상대로 1,800틱 — 예외 0 · NaN 0 · 걷기 가능 · 같은 시드 = 같은 상태 해시 · 효과가 모두 나온다', () => {
  function run(seed) {
    const bus = new EventBus();
    const seen = new Set();
    bus.onAny((name, pl) => {
      if (name === EV.AFFIX) seen.add('affix:' + pl.what);
      if (name === EV.EFFECT_SPAWN) seen.add('fx:' + pl.kind);
      if (name === EV.MON_SPAWNED) seen.add('spawn:' + pl.reason);
      if (name === EV.MON_ACT && pl.actId === 'blink') seen.add('blink');
    });
    const sim = new GameSim({ bus, seed, devSession: true });
    sim.start();
    const ch = makeDevCharacter({ slot: 0, cls: seed % 2 ? 'warrior' : 'mage', name: 'T', level: 24, rift: 12, preset: 0, seed, newId: sim.ctx.newItemId });
    assert.equal(sim.loadCharacter(0, ch).ok, true);
    assert.equal(sim.openRift(12).ok, true);
    sim.commitTravel();
    const st = sim.state;
    for (const m of st.rift.mons) m.gone = true;
    sim.step(makeInput({}));
    const p = st.player;
    const at = (a, d) => ({ x: p.pos.x + Math.sin(p.facing + a) * d, z: p.pos.z + Math.cos(p.facing + a) * d });
    sim.debugSpawnPack('ghoul', 'elite', ['jailer', 'teleporter', 'splitter'], at(0, 8));
    sim.debugSpawnPack('skeletonArcher', 'elite', ['mortar', 'plague', 'lightningEnchanted'], at(1.2, 9));
    sim.debugSpawnPack('fallen', 'champion', ['lightningEnchanted', 'splitter'], at(-1.2, 8));
    st.rift.guardianType = 'ashWitch';
    spawnGuardian(sim.ctx, ...Object.values(at(3, 8)));
    // 밸런스 게이트: 몬스터 피해가 늘어 하네스(가장 가까운 것만 친다)가 쓰러지면 마을에 남아 판이 끝났다 — 이 검사는 효과가 나오는지를 본다(무적)
    sim.debugSetInvincible(true);
    let k = 0;
    for (let i = 0; i < 1800; i++) {
      if (st.pendingTravel) sim.commitTravel();
      if (p.dead) { sim.respawn(); sim.step(makeInput({})); continue; }
      const alive = st.rift ? st.rift.mons.filter(m => !m.gone && !m.dead && m.hp > 0) : [];
      let best = null, bd = 1e9;
      for (const m of alive) { const d = dist(m.pos, p.pos); if (d < bd) { bd = d; best = m; } }
      k++;
      const slot = [k % 40 === 0, false, false, false, false];
      sim.step(best ? makeInput({ cursor: { ...best.pos }, hover: { kind: 'monster', id: best.id, src: 'pick' }, lmb: true, lmbDown: k % 15 === 1, slot, slotDown: slot, potionDown: p.life < p.lifeMax * 0.4 }) : makeInput({}));
      if (i % 300 === 0) {
        assertFiniteDeep(st, `seed ${seed} t ${i}`);
        if (st.rift && st.scene === 'rift') for (const m of st.rift.mons) if (!m.gone) assert.ok(isWalkable(sim.getMap(), m.pos.x, m.pos.z), `${m.typeId} 걷기 가능`);
      }
    }
    assertFiniteDeep(st, `seed ${seed} 끝`);
    return { hash: hashState(st), seen };
  }
  const a = run(11);
  const b = run(11);
  assert.equal(a.hash, b.hash, '결정성');
  const c = run(12);
  const seen = new Set([...a.seen, ...c.seen]);
  for (const k of ['affix:jailWarn', 'affix:plagueWarn', 'affix:mortarFire', 'affix:sparks', 'affix:teleportOut', 'affix:teleportIn', 'affix:split',
    'fx:jail', 'fx:plague', 'fx:mortar', 'fx:emberRain', 'spawn:split', 'spawn:summon']) {
    assert.ok(seen.has(k), `${k} 가 나오지 않았다 — ${[...seen].join(' ')}`);
  }
});
