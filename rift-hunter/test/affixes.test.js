// OWNER: P3 — 계약 §12.2(affixes.test) · §8.2 · §7.5
// 속성 프레임워크(mods 적용 · 훅 호출 지점 · 배제 규칙 · 하수인 공유 · 챔피언 팩 보호막 엇갈림 · 수호자 저항 없음) +
// 속성 6(fast · tough · fireEnchanted · coldEnchanted · vampiric · shielding) 각각의 효과.
// 효과 · 상태 이상의 「결과」 중 P2 함수가 내는 것(감속 · 무적 · 화염 추가 피해)은 계약 시그니처의 결과(상태 필드)로만 본다.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DT } from '../src/core/constants.js';
import { EV } from '../src/core/events.js';
import { makeRng, seedRng } from '../src/core/rng.js';
import { ticks } from '../src/core/time.js';
import { HAZARD, STATUS } from '../src/data/combat.js';
import { getMonAffix, getMonDef } from '../src/data/index.js';
import { MON_AFFIXES } from '../src/data/monsterAffixes.js';
import { updateEffects } from '../src/sim/effects.js';
import { rebuildSpace } from '../src/sim/entities.js';
import { rootPlayer } from '../src/sim/status.js';
import { monsterStats, onMonDamaged, onMonDeath, onMonHitPlayer, onMonSpawn, spawnMonster, updateMonsters } from '../src/sim/monsters/monsters.js';
import { minionAffixes, rollAffixes, spawnPack } from '../src/sim/monsters/packs.js';
import { AFFIX_HOOKS } from '../src/sim/monsters/affixHooks/index.js';
import { assertFiniteDeep, makeTestCtx, makeTestMap, makeTestState } from './helpers.js';

const HOOKS = { onMonSpawn, onMonDamaged, onMonDeath, onMonHitPlayer };

function setup({ level = 1, invincible = true } = {}) {
  const map = makeTestMap();
  const state = makeTestState({ map });
  state.rift.level = level;
  state.tick = 100;
  state.flags.invincible = invincible;
  const ctx = makeTestCtx(state, { map, hooks: HOOKS });
  return { state, ctx, map, p: state.player };
}

function step(ctx, n = 1, each = null) {
  for (let i = 0; i < n; i++) {
    const st = ctx.state;
    st.tick += 1;
    for (const m of st.rift.mons) { m.prevPos.x = m.pos.x; m.prevPos.z = m.pos.z; }
    rebuildSpace(ctx);
    updateMonsters(ctx);
    if (each) each(i);
  }
}

function packOf(ctx, kind, list) {
  const pk = { id: ctx.nextId(), kind, memberIds: [], awake: true, nextHazardAt: -1, fled: false, anchor: { x: list[0].x, z: list[0].z } };
  ctx.state.rift.packs.push(pk);
  const mons = list.map(o => {
    const m = spawnMonster(ctx, { typeId: 'ghoul', rank: kind === 'champion' ? 'champion' : 'normal', level: ctx.state.rift.level, packId: pk.id, awake: true, ...o });
    pk.memberIds.push(m.id);
    return m;
  });
  return { pk, mons };
}

const RES = (dmg) => ({ dmg, absorbed: 0, blocked: false, killed: false, ignored: false });

test('프레임워크: 행 12 의 훅이 레지스트리에 있다 · mods 적용(강인함 생명 × 1.5 · 면역 · 빠름 이동 × 1.3 · 저항 더하기 상한) · 수호자는 저항을 받지 않는다', () => {
  for (const a of MON_AFFIXES) assert.ok(AFFIX_HOOKS[a.hook], a.id);
  const { ctx } = setup();
  const base = spawnMonster(ctx, { typeId: 'ghoul', rank: 'champion', level: 1, x: 10, z: 10 });
  const t = spawnMonster(ctx, { typeId: 'ghoul', rank: 'champion', level: 1, affixes: ['tough'], x: 12, z: 10 });
  const f = spawnMonster(ctx, { typeId: 'ghoul', rank: 'champion', level: 1, affixes: ['fast'], x: 14, z: 10 });
  assert.ok(Math.abs(t.hpMax - base.hpMax * 1.5) < 1e-9);
  assert.ok(Math.abs(f.speed - base.speed * 1.3) < 1e-9);
  assert.deepEqual(monsterStats('ghoul', 'champion', 1, ['tough']).immune.sort(), ['flinch', 'knock']);
  const c = spawnMonster(ctx, { typeId: 'skeletonArcher', rank: 'elite', level: 1, affixes: ['coldEnchanted', 'fireEnchanted'], x: 16, z: 10 });
  assert.equal(c.res.cold, 0.5);
  assert.equal(c.res.fire, 0.3);
  const g = spawnMonster(ctx, { typeId: 'boneGiant', rank: 'guardian', level: 1, affixes: ['coldEnchanted', 'fireEnchanted'], x: 20, z: 30 });
  assert.equal(g.res.cold, getMonDef('boneGiant').res.cold);
  assert.equal(g.res.fire, 0);
  // 훅이 비어 있는 속성(빠름 · 강인함 · P16 자리)도 프레임워크가 던지지 않는다
  const all = spawnMonster(ctx, { typeId: 'ghoul', rank: 'elite', level: 10, affixes: MON_AFFIXES.map(a => a.id), x: 23, z: 26, awake: true });
  onMonDamaged(ctx, all, { monId: all.id, dmg: 1, crit: false, killed: false, immune: false, blocked: false }, { skillId: 'bash' });
  onMonHitPlayer(ctx, all, RES(1), { srcId: all.id, via: 'melee', raw: 1, type: 'phys', level: 10 });
  step(ctx, 30);
  onMonDeath(ctx, all);
  assertFiniteDeep(ctx.state.rift);
});

test('rollAffixes: minLevel · excludeTags(몰타르 ↛ 근접 · 순간이동 ↛ 원거리 · 분열 ↛ 구조물) · 서로 배제(강인함 ↔ 보호막) · 중복 없음 · 수 · 결정성', () => {
  const rng = makeRng(seedRng(42));
  const ghoul = getMonDef('ghoul'), archer = getMonDef('skeletonArcher');
  const low = new Set(MON_AFFIXES.filter(a => a.minLevel <= 1).map(a => a.id));
  for (let i = 0; i < 3000; i++) {
    const L = 1 + (i % 12);
    const g = rollAffixes(rng, ghoul, 4, L);
    const a = rollAffixes(rng, archer, 4, L);
    for (const list of [g, a]) {
      assert.equal(new Set(list).size, list.length, '중복 없음');
      assert.ok(!(list.includes('tough') && list.includes('shielding')), '강인함 ↔ 보호막');
      for (const id of list) assert.ok(getMonAffix(id).minLevel <= L, `${id} minLevel @L${L}`);
    }
    assert.equal(g.length, 4);
    assert.ok(!g.includes('mortar'), '몰타르는 근접 종에 안 붙는다');
    assert.ok(!a.includes('teleporter'), '순간이동은 원거리 종에 안 붙는다');
    if (L === 1) for (const id of g) assert.ok(low.has(id));
  }
  assert.ok(!rollAffixes(makeRng(seedRng(1)), { tags: ['structure'] }, 12, 30).includes('splitter'));
  assert.deepEqual(rollAffixes(makeRng(seedRng(9)), ghoul, 3, 8), rollAffixes(makeRng(seedRng(9)), ghoul, 3, 8));
  assert.deepEqual(rollAffixes(makeRng(seedRng(9)), ghoul, 0, 8), []);
});

test('하수인 공유: 정예 속성 중 minionShare 인 것만 · 챔피언 팩은 같은 속성', () => {
  const { ctx, state } = setup({ level: 6 });
  assert.deepEqual(minionAffixes(['fast', 'shielding', 'coldEnchanted', 'jailer', 'vampiric']), ['fast', 'coldEnchanted', 'vampiric']);
  const id = spawnPack(ctx, { typeId: 'ghoul', rank: 'elite', affixes: ['fast', 'shielding', 'coldEnchanted', 'jailer'], x: 20, z: 32 });
  const pk = state.rift.packs.find(p => p.id === id);
  const mons = pk.memberIds.map(i => state.rift.mons.find(m => m.id === i));
  const elite = mons.filter(m => m.rank === 'elite');
  const minions = mons.filter(m => m.rank === 'minion');
  assert.equal(elite.length, 1);
  assert.deepEqual(elite[0].affixes, ['fast', 'shielding', 'coldEnchanted', 'jailer']);
  assert.ok(minions.length >= 3 && minions.length <= 5);
  for (const m of minions) assert.deepEqual(m.affixes, ['fast', 'coldEnchanted']);
  const cid = spawnPack(ctx, { typeId: 'fallen', rank: 'champion', x: 30, z: 10 });
  const cp = state.rift.packs.find(p => p.id === cid);
  const cm = cp.memberIds.map(i => state.rift.mons.find(m => m.id === i));
  for (const m of cm) assert.deepEqual(m.affixes, cm[0].affixes);
});

test('보호막: 깬 뒤 first → AFFIX shieldWarn(warn 동안 warnUntil) → 무적 dur(setInvuln) · shieldOn → shieldOff · 이후 every 마다', () => {
  const { ctx, state, p } = setup({ level: 5 });
  const row = getMonAffix('shielding');
  p.dead = true;   // 제자리(생각 = hold)
  const { mons: [m] } = packOf(ctx, 'elite', [{ x: 20, z: 30, rank: 'elite', affixes: ['shielding'] }]);
  const ev = [];
  step(ctx, ticks(row.params.first + row.params.every + row.params.warn + row.params.dur) + 5, () => {
    for (const e of ctx.events.splice(0)) if (e.name === EV.AFFIX) ev.push({ t: state.tick, what: e.payload.what, warnUntil: m.ax.shielding.warnUntil, inv: m.st.invulnUntil });
  });
  const t0 = 100;
  const warn = ev.filter(e => e.what === 'shieldWarn');
  const on = ev.filter(e => e.what === 'shieldOn');
  const off = ev.filter(e => e.what === 'shieldOff');
  assert.equal(warn[0].t, t0 + 1 + ticks(row.params.first));
  assert.equal(warn[0].warnUntil, warn[0].t + ticks(row.params.warn));
  assert.equal(on[0].t, warn[0].t + ticks(row.params.warn));
  assert.ok(on[0].inv >= on[0].t + ticks(row.params.dur), '무적(setInvuln)');
  assert.equal(off[0].t, on[0].t + ticks(row.params.dur));
  assert.equal(warn[1].t, warn[0].t + ticks(row.params.every));
  assert.ok(ev.every(e => e.what !== 'shieldOn' || e.inv > e.t));
});

test('보호막 엇갈림: 챔피언 팩 구성원 i 의 첫 사용 = first + i × every / n — 팩 전원이 같은 때 무적인 틱이 없다', () => {
  const row = getMonAffix('shielding');
  for (const n of [2, 3, 4]) {
    const { ctx, state, p } = setup({ level: 5 });
    p.dead = true;
    const { mons } = packOf(ctx, 'champion', Array.from({ length: n }, (_, k) => ({ x: 10 + k * 3, z: 30, affixes: ['shielding'] })));
    const firstOn = new Map();
    let allOn = 0;
    step(ctx, ticks(row.params.first + row.params.every * 3), () => {
      for (const e of ctx.events.splice(0)) if (e.name === EV.AFFIX && e.payload.what === 'shieldOn' && !firstOn.has(e.payload.monId)) firstOn.set(e.payload.monId, state.tick);
      if (mons.every(m => m.ax.shielding.offUntil > state.tick)) allOn += 1;
    });
    const t = mons.map(m => firstOn.get(m.id));
    for (let i = 0; i < n; i++) {
      const want = 100 + 1 + ticks(row.params.first + (i * row.params.every) / n) + ticks(row.params.warn);
      assert.ok(Math.abs(t[i] - want) <= 1, `n${n} i${i}: ${t[i]} ≈ ${want}`);
    }
    assert.equal(allOn, 0, `n${n}: 전원 무적인 틱 없음`);
  }
});

test('냉기 강화: 적중 감속 · 깬 뒤 novaFirst · 이후 novaEvery 노바(자기 중심 r 4 · 예고 1.3 · 감속 실음 · noAffix) · range 밖이면 깔지 않는다 · 빠름이 예고를 줄이지 않는다', () => {
  const { ctx, state, p } = setup({ level: 3 });
  const row = getMonAffix('coldEnchanted');
  const { mons: [m] } = packOf(ctx, 'elite', [{ x: p.pos.x, z: p.pos.z + 5, rank: 'elite', affixes: ['coldEnchanted', 'fast'] }]);
  m.speed = 0;   // 제자리
  onMonHitPlayer(ctx, m, RES(5), { srcId: m.id, via: 'melee', raw: 5, type: 'phys', level: 3 });
  assert.ok(Math.abs(p.st.slowPct - STATUS.playerChill) < 1e-9, '감속(slowPlayer)');
  assert.equal(p.st.slowUntil, state.tick + ticks(row.params.chillSec));
  const novas = () => state.rift.effects.filter(e => e.kind === 'coldNova');
  step(ctx, ticks(row.params.novaFirst));
  assert.equal(novas().length, 0, '첫 onAwakeTick(101) + novaFirst 전');
  step(ctx, 1);
  assert.equal(novas().length, 1);
  const e = novas()[0];
  assert.equal(e.start, 101 + ticks(row.params.novaFirst));
  assert.equal(e.hitAt - e.start, ticks(row.params.delay), '예고 그대로(빠름 무관)');
  assert.equal(e.shape.type, 'circle');
  assert.equal(e.shape.r, row.params.novaR);
  assert.deepEqual([e.shape.x, e.shape.z], [m.pos.x, m.pos.z]);
  assert.equal(e.spec.noAffix, true);
  assert.equal(e.spec.onHit.chillSec, row.params.novaChillSec);
  assert.equal(e.spec.type, 'cold');
  assert.ok(Math.abs(e.spec.raw - m.dmg * row.params.novaMul) < 1e-9);
  assert.equal(e.cancelOnSrcDeath, false);
  assert.ok(ctx.events.some(x => x.name === EV.AFFIX && x.payload.what === 'novaWarn'));
  state.rift.effects.length = 0;
  step(ctx, ticks(row.params.novaEvery));
  assert.equal(novas().length, 1, '다음 주기');
  // 플레이어가 range 밖
  state.rift.effects.length = 0;
  p.pos.z = m.pos.z - row.params.range - 1;
  step(ctx, ticks(row.params.novaEvery) + 5);
  assert.equal(novas().length, 0);
});

test('화염 강화: 적중에 같은 공격 30% 화염 추가(noAffix) · 죽으면 fireDeath(r 3 · 예고 1.0 · × 1.2 · 출처 사망 후에도) · AFFIX fireArm', () => {
  const { ctx, state, p } = setup({ invincible: false });
  const row = getMonAffix('fireEnchanted');
  const m = spawnMonster(ctx, { typeId: 'ghoul', rank: 'champion', level: 1, affixes: ['fireEnchanted'], x: p.pos.x, z: p.pos.z + 1.5, awake: true });
  const life0 = p.life;
  onMonHitPlayer(ctx, m, RES(4), { srcId: m.id, via: 'melee', raw: 10, type: 'phys', level: 1 });
  const fire = ctx.events.filter(e => e.name === EV.PLAYER_HIT && e.payload.type === 'fire');
  assert.equal(fire.length, 1, '화염 한 번 더');
  assert.ok(p.life < life0);
  // noAffix · 피해 0 이면 훅이 돌지 않는다
  onMonHitPlayer(ctx, m, RES(4), { srcId: m.id, via: 'hazard', raw: 10, type: 'fire', level: 1, noAffix: true });
  onMonHitPlayer(ctx, m, RES(0), { srcId: m.id, via: 'melee', raw: 10, type: 'phys', level: 1 });
  assert.equal(ctx.events.filter(e => e.name === EV.PLAYER_HIT && e.payload.type === 'fire').length, 1);
  m.hp = 0; m.dead = true; m.deadAt = state.tick;
  onMonDeath(ctx, m);
  const e = state.rift.effects.find(x => x.kind === 'fireDeath');
  assert.ok(e);
  assert.equal(e.shape.r, row.params.deathR);
  assert.equal(e.hitAt - e.start, ticks(row.params.delay));
  assert.equal(e.cancelOnSrcDeath, false);
  assert.equal(e.spec.type, 'fire');
  assert.equal(e.spec.noAffix, true);
  assert.ok(Math.abs(e.spec.raw - m.dmg * row.params.deathMul) < 1e-9);
  assert.ok(ctx.events.some(x => x.name === EV.AFFIX && x.payload.what === 'fireArm' && x.payload.monId === m.id));
});

test('리뷰 수정: 감옥에 묶인 동안 발밑에서 화염 강화 · 역병 덩어리가 죽어도 피할 수 있다 — 예고가 속박 끝 + 반응 + 걸어 나가는 시간(감속 속도) 뒤 · 풀린 뒤 걸어 나가면 0번 맞는다 · 묶이지 않았으면 예고 그대로', () => {
  const row = getMonAffix('fireEnchanted');
  for (const kind of ['fire', 'pool']) {
    for (const k of [0, 5, 15, 30, 44]) {
      for (const d of [0.6, 1.5, 2.5]) {
        const { ctx, state, p } = setup({ invincible: false });
        p.lifeMax = 1e9;
        p.life = 1e9;
        rootPlayer(ctx, 1.5);
        const rootUntil = p.st.rootUntil;
        state.tick += k;
        const at = { x: p.pos.x + d, z: p.pos.z };
        const m = kind === 'fire'
          ? spawnMonster(ctx, { typeId: 'ghoul', rank: 'champion', level: 1, affixes: ['fireEnchanted'], x: at.x, z: at.z, awake: false })
          : spawnMonster(ctx, { typeId: 'bloater', rank: 'normal', level: 1, x: at.x, z: at.z, awake: false });
        m.pos.x = at.x; m.pos.z = at.z;
        m.hp = 0; m.dead = true; m.deadAt = state.tick;
        onMonDeath(ctx, m);
        const e = state.rift.effects.find(x => x.kind === (kind === 'fire' ? 'fireDeath' : 'poisonPool'));
        assert.ok(e, `${kind}: 효과`);
        const out = e.shape.r + p.r - Math.hypot(p.pos.x - e.shape.x, p.pos.z - e.shape.z);
        if (out > 0) {
          const need = rootUntil + ticks(HAZARD.react) + Math.ceil((out / HAZARD.slowSpeed) * 30);
          assert.ok(e.hitAt >= need - 1, `${kind} k=${k} d=${d}: 판정 ${e.hitAt} < 풀림 ${rootUntil} + 반응 + 걸어 나가기 = ${need}`);
        } else assert.equal(e.hitAt - e.start, kind === 'fire' ? ticks(row.params.delay) : 0, '발밑이 아니면 예고 그대로');
        // 사람: 풀리고 반응한 뒤 몸 중심 반대쪽으로 감속 속도로 걷는다 — 맞지 않는다
        const n0 = ctx.events.length;
        const ux = (p.pos.x - e.shape.x) / (Math.hypot(p.pos.x - e.shape.x, p.pos.z - e.shape.z) || 1);
        const uz = (p.pos.z - e.shape.z) / (Math.hypot(p.pos.x - e.shape.x, p.pos.z - e.shape.z) || 1);
        for (let i = 0; i < 200; i++) {
          state.tick += 1;
          if (state.tick >= rootUntil + ticks(HAZARD.react)) { p.pos.x += ux * HAZARD.slowSpeed * DT; p.pos.z += uz * HAZARD.slowSpeed * DT; }
          updateEffects(ctx);
        }
        const hits = ctx.events.slice(n0).filter(x => x.name === EV.PLAYER_HIT);
        assert.equal(hits.length, 0, `${kind} k=${k} d=${d}: 묶인 채 · 풀린 직후 피할 수 없이 맞았다`);
      }
    }
    // 묶이지 않았으면 예고 그대로(화염 1.0초 · 웅덩이 0)
    const { ctx, state, p } = setup({ invincible: false });
    const m = kind === 'fire'
      ? spawnMonster(ctx, { typeId: 'ghoul', rank: 'champion', level: 1, affixes: ['fireEnchanted'], x: p.pos.x + 1, z: p.pos.z, awake: false })
      : spawnMonster(ctx, { typeId: 'bloater', rank: 'normal', level: 1, x: p.pos.x + 1, z: p.pos.z, awake: false });
    m.hp = 0; m.dead = true; m.deadAt = state.tick;
    onMonDeath(ctx, m);
    const e = state.rift.effects.find(x => x.kind === (kind === 'fire' ? 'fireDeath' : 'poisonPool'));
    assert.equal(e.hitAt - e.start, kind === 'fire' ? ticks(row.params.delay) : 0);
  }
});

test('흡혈: 준 피해의 50% 회복 · 초당 최대 생명 1% 재생 · AFFIX heal 은 1초에 한 번까지', () => {
  const { ctx, state, p } = setup();
  const row = getMonAffix('vampiric');
  p.dead = true;
  const { mons: [m] } = packOf(ctx, 'champion', [{ x: 20, z: 32, affixes: ['vampiric'] }]);
  m.hp = m.hpMax * 0.5;
  onMonHitPlayer(ctx, m, RES(4), { srcId: m.id, via: 'melee', raw: 6, type: 'phys', level: 1 });
  assert.ok(Math.abs(m.hp - (m.hpMax * 0.5 + 4 * row.params.leech)) < 1e-9);
  const h0 = m.hp;
  const fxAt = ctx.events.filter(e => e.name === EV.AFFIX && e.payload.what === 'heal').map(() => state.tick);
  ctx.events.length = 0;
  step(ctx, 60, () => { for (const e of ctx.events.splice(0)) if (e.name === EV.AFFIX && e.payload.what === 'heal') fxAt.push(state.tick); });
  assert.ok(Math.abs(m.hp - (h0 + m.hpMax * row.params.regenPctPerSec * 60 * DT)) < 1e-6);
  assert.ok(fxAt.length >= 2, `heal 연출 ${fxAt}`);
  for (let i = 1; i < fxAt.length; i++) assert.ok(fxAt[i] - fxAt[i - 1] >= ticks(row.params.fxEvery), `간격 ${fxAt}`);
  m.hp = m.hpMax;
  step(ctx, 5);
  assert.equal(m.hp, m.hpMax);
});

test('빠름 · 강인함은 mods 만(훅 비어 있음) · 빠름은 근접 예비를 줄이고 이동을 빠르게 한다', () => {
  assert.deepEqual(Object.keys(AFFIX_HOOKS.fast), []);
  assert.deepEqual(Object.keys(AFFIX_HOOKS.tough), []);
  const { ctx, p } = setup();
  const a = spawnMonster(ctx, { typeId: 'ghoul', rank: 'champion', level: 1, affixes: ['fast'], x: p.pos.x - 3, z: p.pos.z + 12, awake: true });
  const b = spawnMonster(ctx, { typeId: 'ghoul', rank: 'champion', level: 1, x: p.pos.x + 3, z: p.pos.z + 12, awake: true });
  step(ctx, 30);
  const da = 12 - Math.hypot(a.pos.x - p.pos.x, a.pos.z - p.pos.z), db = 12 - Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z);
  assert.ok(da > db * 1.2, `빠름 ${da} vs ${db}`);
});
