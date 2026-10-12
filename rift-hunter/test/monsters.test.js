// OWNER: P3 — 계약 §12.2(monsters.test) · §5.17 · §5.6(몬스터 수치)
// 몬스터 프레임워크: monsterStats · 잠/깨움 · 팩 연결 · 상한 120 · 흐름장/직선 추적 · 밀어내기(겹침 해소 · 플레이어 원) · 다시 잠 ·
// 공격 진행(예비 facing 고정 · 판정 틱 · 후딜 · 시작 관용 없음 · 판정 관용 0.3) · 빠름이 바닥 예고를 줄이지 않는다 · 상태 관문(사라짐이 actEnd 에 끝난다) ·
// 팩 대표만 hazard onAwakeTick · prevPos 를 건드리지 않는다 · 생명 ≤ 0 이면 행동 없음.
// 같은 웨이브의 남의 구현에 기대지 않는다 — 판정 결과(플레이어 피해)가 아니라 P3 의 결정(MON_ACT · MON_STRIKE · 상태 · 판정 함수)을 본다.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EV } from '../src/core/events.js';
import { deg2rad } from '../src/core/math.js';
import { ticks } from '../src/core/time.js';
import { getMonDef, getMonAffix } from '../src/data/index.js';
import { MON, RANKS } from '../src/data/monsters.js';
import { RIFT, earlyDmgMul, earlyHpMul, riftRow } from '../src/data/rift.js';
import { rebuildSpace } from '../src/sim/entities.js';
import {
  chaseStop, monsterStats, onMonDamaged, onMonDeath, onMonHitPlayer, onMonSpawn, spawnMonster, startAttack, updateMonsters, wakePack,
} from '../src/sim/monsters/monsters.js';
import { attackOf, meleeHitOk, meleeStartOk } from '../src/sim/monsters/spawn.js';
import { flowDir, flowDist, updateFlow } from '../src/sim/world/flow.js';
import { isWalkable } from '../src/sim/world/nav.js';
import { assertFiniteDeep, countEvents, makeTestCtx, makeTestMap, makeTestState } from './helpers.js';

const HOOKS = { onMonSpawn, onMonDamaged, onMonDeath, onMonHitPlayer };

/** 가운데 벽(x 20..22 · z 6..20) — 위아래로 돌아갈 틈 · 시작점 (15, 13) */
const WALL_ROOM = [
  '######################',
  '#....................#',
  '#....................#',
  '#.........#..........#',
  '#.........#..........#',
  '#.........#..........#',
  '#......S..#..........#',
  '#.........#..........#',
  '#.........#..........#',
  '#.........#..........#',
  '#....................#',
  '#....................#',
  '######################',
].join('\n');

/** 긴 방(120m × 16m) — 시작점 왼쪽 */
function longRoom() {
  const w = 62, h = 10;
  const rows = [];
  for (let j = 0; j < h; j++) {
    let r = '';
    for (let i = 0; i < w; i++) r += i === 0 || j === 0 || i === w - 1 || j === h - 1 ? '#' : i === 3 && j === 5 ? 'S' : '.';
    rows.push(r);
  }
  return rows.join('\n');
}

/** 상태 · 문맥(P3 훅을 ctx.hooks 에 · 무적 — 판정 결과를 보지 않는다) */
function setup({ ascii = null, level = 1 } = {}) {
  const map = ascii ? makeTestMap(ascii) : makeTestMap();
  const state = makeTestState({ map });
  state.rift.level = level;
  state.tick = 100;
  state.flags.invincible = true;
  const ctx = makeTestCtx(state, { map, hooks: HOOKS });
  return { state, ctx, map, p: state.player };
}

/** GameSim 의 한 틱 중 몬스터 몫(§5.1-1 · 3 · 5) */
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

/** 팩 하나 + 구성원 */
function pack(ctx, kind, list, { awake = false } = {}) {
  const pk = { id: ctx.nextId(), kind, memberIds: [], awake, nextHazardAt: -1, fled: false, anchor: { x: list[0].x, z: list[0].z } };
  ctx.state.rift.packs.push(pk);
  const mons = list.map(o => {
    const m = spawnMonster(ctx, { typeId: 'ghoul', rank: kind === 'champion' ? 'champion' : 'normal', level: ctx.state.rift.level, packId: pk.id, awake, ...o });
    pk.memberIds.push(m.id);
    return m;
  });
  return { pk, mons };
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

test('monsterStats(§5.6): 등급 · 레벨 · 속성 배율 · 저항 상한 0.5 · 수호자는 속성 저항 없음 · r/height 는 이미 곱한 값', () => {
  const s = monsterStats('ghoul', 'champion', 5, ['tough', 'fast']);
  const row = riftRow(5);
  const rk = (id) => RANKS.find(r => r.id === id);
  // 밸런스 게이트: 🔒 hpBase 36 · dmgBase 24.5 · champion 8 · elite 15 · guardian 32 — 식은 데이터를 읽고 첫 판 경사(생명 · 피해)를 곱한다(균열 5 는 경사 안)
  // 피드백 2: dmgBase 24.5 → 22 · guardian 32 → 27(입문 구간 균열 1~6 · 일반 생명 × 1.6 · 팩 밀도 — NOTES-FEEDBACK 라운드 2)
  assert.ok(Math.abs(s.hpMax - MON.hpBase * 1.0 * rk('champion').hp * row.hpMul * 1.5 * earlyHpMul(5)) < 1e-9);
  assert.ok(Math.abs(s.dmg - MON.dmgBase * 1.0 * rk('champion').dmg * row.dmgMul * earlyDmgMul(5)) < 1e-9);
  assert.deepEqual([MON.hpBase, MON.dmgBase, rk('champion').hp, rk('elite').hp, rk('guardian').hp], [36, 22, 8, 15, 27]);
  assert.ok(Math.abs(row.hpMul - 1.14 ** 4) < 1e-9 && Math.abs(row.dmgMul - 1.1 ** 4) < 1e-9);
  assert.ok(Math.abs(s.speed - 2.6 * 1.3) < 1e-9);
  assert.ok(Math.abs(s.r - 0.45 * 1.15) < 1e-9 && Math.abs(s.height - 1.7 * 1.15) < 1e-9 && s.scale === 1.15);
  assert.equal(s.atkSpeedMul, 1.25);
  assert.deepEqual([...s.immune].sort(), ['flinch', 'knock']);
  // 저항 상한
  assert.equal(monsterStats('fallenShaman', 'elite', 1, ['fireEnchanted']).res.fire, 0.5);
  assert.equal(monsterStats('skeletonArcher', 'champion', 1, ['coldEnchanted']).res.cold, 0.5);
  // 수호자는 속성의 mods.res 를 받지 않는다
  const g = monsterStats('boneGiant', 'guardian', 3, ['fireEnchanted', 'coldEnchanted', 'tough']);
  assert.equal(g.res.fire, 0);
  assert.equal(g.res.cold, 0.15);
  assert.ok(Math.abs(g.hpMax - MON.hpBase * 1.1 * rk('guardian').hp * riftRow(3).hpMul * 1.5 * earlyHpMul(3)) < 1e-9);   // 🔒 RANKS.guardian.hp(밸런스 게이트 32)
  assert.ok(Math.abs(g.r - 1.3) < 1e-9 && Math.abs(g.height - 4.6) < 1e-9);
  // 수호자 경험치 배율이 유한(getMonDef)
  assert.ok(Number.isFinite(getMonDef('boneGiant').xp) && Number.isFinite(getMonDef('ashWitch').xp));
  // 30 위 · 99 레벨도 유한
  for (const L of [1, 20, 30, 31, 60, 99]) {
    const x = monsterStats('charger', 'elite', L, ['vampiric']);
    assert.ok(Number.isFinite(x.hpMax) && x.hpMax > 0 && Number.isFinite(x.dmg), `L${L}`);
  }
});

test('W1 수정 2(NOTES-W1FIX §2.0): 첫 판 피해 경사 — 균열 1~4 의 mon.dmg 는 × RIFT.earlyDmg[L − 1](오르는 쪽) · 균열 5 이상은 × 1(🔒 dmgBase · GROWTH 그대로)', () => {
  const t = RIFT.earlyDmg;
  assert.ok(Array.isArray(t) && t.length >= 1);
  for (let i = 0; i < t.length; i++) {
    assert.ok(t[i] > 0 && t[i] < 1, `earlyDmg[${i}]`);
    if (i > 0) assert.ok(t[i] > t[i - 1], '레벨이 오를수록 커진다');
  }
  for (let L = 1; L <= t.length + 3; L++) {
    const want = L <= t.length ? t[L - 1] : 1;
    assert.equal(earlyDmgMul(L), want, `L${L}`);
    for (const [typeId, rank] of [['ghoul', 'normal'], ['skeletonArcher', 'champion'], ['boneGiant', 'guardian']]) {
      const x = monsterStats(typeId, /** @type {any} */ (rank), L, []);
      const base = MON.dmgBase * getMonDef(typeId).dmg * RANKS.find(r => r.id === rank).dmg * riftRow(L).dmgMul;
      assert.ok(Math.abs(x.dmg - base * want) < 1e-9, `${typeId} L${L}`);
    }
  }
  // 표 다음 레벨부터 완화가 없다(계약 §7.3 — 첫 수정의 전역 완화가 높은 균열의 위협을 지웠던 것의 회귀 · NOTES-W1FIX §2.0 · 밸런스 게이트: 표 11칸 — 균열 12 부터 × 1)
  for (const L of [t.length + 1, t.length + 5, 20, 30]) assert.equal(earlyDmgMul(L), 1, `L${L}`);
  // 균열 1 의 실제 피해 배율은 옛 값(dmgBase 3.5 × 0.205)과 같다 — 첫 판(balance.test)이 맞춘 값
  assert.ok(Math.abs(MON.dmgBase * t[0] - 3.5 * 0.205) < 0.01, `균열 1 피해 ${MON.dmgBase * t[0]}`);
  // 잘못된 값 · 표 밖은 1(NaN · 0 이 몬스터 피해로 새지 않는다)
  for (const L of [0, -1, NaN, 99]) assert.equal(earlyDmgMul(L), 1);
});

test('밸런스 게이트: 첫 판 생명 경사 — 몬스터 생명은 × RIFT.earlyHp[L − 1](오르는 쪽 · 0..1) · 표 다음 레벨부터 × 1 · 잘못된 값은 1', () => {
  const t = RIFT.earlyHp;
  assert.ok(Array.isArray(t) && t.length >= 1);
  for (let i = 0; i < t.length; i++) {
    assert.ok(t[i] > 0 && t[i] <= 1, `earlyHp[${i}]`);
    if (i > 0) assert.ok(t[i] >= t[i - 1], '레벨이 오를수록 커진다');
  }
  for (let L = 1; L <= t.length + 3; L++) {
    const want = L <= t.length ? t[L - 1] : 1;
    assert.equal(earlyHpMul(L), want, `L${L}`);
    for (const [typeId, rank] of [['ghoul', 'normal'], ['skeletonArcher', 'elite'], ['ashWitch', 'guardian']]) {
      const x = monsterStats(typeId, /** @type {any} */ (rank), L, []);
      const base = MON.hpBase * getMonDef(typeId).hp * RANKS.find(r => r.id === rank).hp * riftRow(L).hpMul;
      assert.ok(Math.abs(x.hpMax - base * want) < 1e-6 * base, `${typeId} L${L}`);
    }
  }
  for (const L of [0, -1, NaN, 99]) assert.equal(earlyHpMul(L), 1);
});

test('피드백 2 D1: 레벨 비 — 입문 구간(균열 1~6 · L → L+1 이 6 → 7 까지)은 어려움이 오르기만(단조 증가) · 균열 7 부터는 어려움 √(생명 × 피해) 증가 ÷ 보상 증가(계약 §7.14 +9.4%/레벨)가 0.8~1.25', () => {
  const REWARD = 1.094;   // 계약 §7.14 「보상(L)」 = √(powerScore × 골드/판) +9.4%/레벨
  // 피드백 2 D1(Jay 결정 2026-10-12): 입문 구간을 균열 1~6 으로 줄인다 — 균열 1 의 실제 피해 · 생명은 그대로 두고 균열 7 에서 본 곡선(경사 1)에 닿으므로
  //   그 사이의 레벨당 어려움은 상한 1.25 를 넘는다(브리프 §7 「입문 구간 균열 1~6 은 예외」). 상한 검사는 균열 7 → 8 부터.
  const intro = Math.max(RIFT.earlyDmg.length, RIFT.earlyHp.length);
  assert.equal(intro, 6, '입문 구간 = 균열 1~6');
  assert.equal(earlyDmgMul(intro + 1), 1, '균열 7 에서 본 곡선');
  assert.equal(earlyHpMul(intro + 1), 1, '균열 7 에서 본 곡선(생명)');
  const hardStep = (L) => {
    const a = riftRow(L), b = riftRow(L + 1);
    return Math.sqrt(((b.hpMul * earlyHpMul(L + 1)) / (a.hpMul * earlyHpMul(L))) * ((b.dmgMul * earlyDmgMul(L + 1)) / (a.dmgMul * earlyDmgMul(L))));
  };
  for (let L = 1; L <= intro; L++) {
    assert.ok(earlyDmgMul(L + 1) * riftRow(L + 1).dmgMul > earlyDmgMul(L) * riftRow(L).dmgMul, `피해 L${L}→${L + 1} 오른다`);
    assert.ok(earlyHpMul(L + 1) * riftRow(L + 1).hpMul > earlyHpMul(L) * riftRow(L).hpMul, `생명 L${L}→${L + 1} 오른다`);
    assert.ok(hardStep(L) > 1, `어려움 L${L}→${L + 1}`);
  }
  for (let L = intro + 1; L <= 40; L++) {
    const ratio = hardStep(L) / REWARD;
    assert.ok(ratio <= 1.25 && ratio >= 0.8, `L${L}→${L + 1}: ${ratio.toFixed(4)}`);
  }
});

// 피드백 2 다듬기(검증자 실측): 입문 경사 꼬리 — 옛 표는 균열 6 → 7 의 피해 걸음(× 1.65)이 그 앞(× 1.25 ~ 1.48)보다 커서 균열 7 이 벽이었다(사망/판 0.5~0.6 → 1.0).
//   걸음은 앞이 무겁고 뒤로 갈수록 줄어든다 — 피해 · 생명 · 둘을 합친 어려움(성장 GROWTH 포함) 모두 6 → 7 이 입문 구간에서 가장 작다.
test('피드백 2 다듬기: 입문 경사의 꼴 — 피해 · 생명 · 합친 어려움의 레벨당 걸음이 뒤로 갈수록 줄어든다(늘지 않는다) · 6 → 7 이 가장 작다', () => {
  const intro = Math.max(RIFT.earlyDmg.length, RIFT.earlyHp.length);
  const step = (f, L) => f(L + 1) / f(L);
  const dmg = (L) => earlyDmgMul(L) * riftRow(L).dmgMul;
  const hp = (L) => earlyHpMul(L) * riftRow(L).hpMul;
  const hard = (L) => Math.sqrt(dmg(L) * hp(L));
  for (const [name, f] of /** @type {const} */ ([['피해 경사', earlyDmgMul], ['생명 경사', earlyHpMul], ['피해', dmg], ['생명', hp], ['어려움', hard]])) {
    const steps = [];
    for (let L = 1; L <= intro; L++) steps.push(step(f, L));
    for (let i = 1; i < steps.length; i++) assert.ok(steps[i] <= steps[i - 1] + 1e-9, `${name}: 걸음 ${steps.map(x => x.toFixed(3)).join(' → ')} — L${i + 1}→${i + 2} 가 앞보다 크다`);
    assert.equal(Math.min(...steps), steps[steps.length - 1], `${name}: 6 → 7 이 가장 작다`);
  }
  // 균열 7 로 들어서는 걸음은 입문 구간 평균 걸음보다 작다(벽이 아니다) — 어려움 기준
  const all = [];
  for (let L = 1; L <= intro; L++) all.push(step(hard, L));
  const geo = Math.exp(all.reduce((a, b) => a + Math.log(b), 0) / all.length);
  assert.ok(all[intro - 1] < geo, `6 → 7 ${all[intro - 1].toFixed(3)} < 평균 ${geo.toFixed(3)}`);
});

test('spawnMonster: 수치 · r 은 그대로(다시 곱하지 않는다) · reason 이 있을 때만 MON_SPAWNED · 깨어 나오면 행동 상태가 있다', () => {
  const { ctx } = setup();
  const a = spawnMonster(ctx, { typeId: 'charger', rank: 'elite', level: 1, x: 10, z: 10 });
  assert.equal(a.r, 0.6 * 1.3);
  assert.equal(countEvents(ctx.events, EV.MON_SPAWNED), 0);
  const b = spawnMonster(ctx, { typeId: 'boneling', rank: 'spawn', level: 1, x: 12, z: 10, awake: true, reason: 'nest' });
  const e = ctx.events.find(x => x.name === EV.MON_SPAWNED);
  assert.deepEqual(e.payload, { id: b.id, typeId: 'boneling', rank: 'spawn', x: 12, z: 10, reason: 'nest' });
  assert.ok(b.ax.b && b.ax.b.move === 'chase');
  assertFiniteDeep(ctx.state);
});

test('잠: (tick + id) % 6 틱에만 검사 · aggro 안 · 시야(벽 뒤는 깨지 않는다) · MON_WAKE 는 팩 단위', () => {
  const { ctx, state, p } = setup({ ascii: WALL_ROOM });
  assert.deepEqual([p.pos.x, p.pos.z], [15, 13]);
  const seen = pack(ctx, 'normal', [{ x: 15, z: 22 }, { x: 16, z: 23 }]);
  const hidden = pack(ctx, 'normal', [{ x: 24, z: 13 }]);
  let wokeAt = -1;
  step(ctx, 12, () => { if (wokeAt < 0 && seen.mons[0].awake) wokeAt = state.tick; });
  assert.ok(wokeAt > 0, '보이는 팩이 깼다');
  assert.ok(seen.mons.some(m => (wokeAt + m.id) % MON.wakeCheckT === 0), '검사 틱에 깼다');
  assert.ok(seen.mons.every(m => m.awake), '팩째');
  assert.equal(hidden.mons[0].awake, false, '벽 뒤(9m)는 깨지 않는다');
  const w = ctx.events.filter(e => e.name === EV.MON_WAKE);
  assert.equal(w.length, 1);
  assert.equal(w[0].payload.packId, seen.pk.id);
  assert.equal(w[0].payload.count, 2);
  assert.equal(seen.pk.awake, true);
  // aggro 밖(12m 넘게)은 깨지 않는다
  const far = pack(ctx, 'normal', [{ x: 15, z: 2.6 }]);
  p.pos.z = 15.5;
  step(ctx, 12);
  assert.equal(far.mons[0].awake, false);
});

test('피격이 그 팩을 깨운다 · 팩 연결은 linkRadius 안의 다른 잠든 팩을 한 단계만', () => {
  const { ctx } = setup();
  // W1 수정(NOTES-W1FIX): linkRadius 8 → 11 — 자리를 반지름에서 잡는다(값이 바뀌어도 같은 뜻)
  const L = MON.linkRadius - 1;
  const A = pack(ctx, 'normal', [{ x: 8, z: 36 }, { x: 9, z: 36 }]);
  const B = pack(ctx, 'normal', [{ x: 9 + L, z: 36 }]);      // A 구성원에서 linkRadius − 1
  const C = pack(ctx, 'normal', [{ x: 9 + L, z: 36 - L }]);  // B 에서 linkRadius − 1 · A 에서 linkRadius 넘게
  onMonDamaged(ctx, A.mons[0], { monId: A.mons[0].id, dmg: 3, crit: false, killed: false, immune: false, blocked: false }, { skillId: 'bash' });
  assert.ok(A.mons.every(m => m.awake));
  assert.equal(B.mons[0].awake, true, '연결');
  assert.equal(C.mons[0].awake, false, '한 단계만');
  const w = ctx.events.filter(e => e.name === EV.MON_WAKE).map(e => e.payload.packId);
  assert.deepEqual(w, [A.pk.id, B.pk.id]);
  // 죽는 일격도 팩을 깨운다(시체는 깨지 않는다)
  const D = pack(ctx, 'normal', [{ x: 8, z: 6 }, { x: 9, z: 6 }]);
  D.mons[0].hp = 0;
  onMonDamaged(ctx, D.mons[0], { monId: D.mons[0].id, dmg: 99, crit: false, killed: true, immune: false, blocked: false }, {});
  assert.equal(D.mons[0].awake, false);
  assert.equal(D.mons[1].awake, true);
});

test('W1 수정(NOTES-W1FIX) 초반 경사: 깊이 < MON.linkMinDepth 인 팩은 연결로 깨우지도 깨지도 않는다(깊이가 없는 팩은 깊은 팩)', () => {
  const { ctx } = setup();
  assert.equal(MON.linkMinDepth, 2);
  const hit = (m) => onMonDamaged(ctx, m, { monId: m.id, dmg: 1, crit: false, killed: false, immune: false, blocked: false }, {});
  const L = MON.linkRadius - 1;
  const A = pack(ctx, 'normal', [{ x: 8, z: 36 }]);
  const B = pack(ctx, 'normal', [{ x: 8 + L, z: 36 }]);
  const C = pack(ctx, 'normal', [{ x: 8 + L, z: 36 - L }]);
  const D = pack(ctx, 'normal', [{ x: 8 + 2 * L, z: 36 }]);
  A.pk.depth = 1; B.pk.depth = 3; C.pk.depth = 1; D.pk.depth = 2;
  hit(A.mons[0]);
  assert.equal(A.mons[0].awake, true);
  assert.equal(B.mons[0].awake, false, '얕은 팩(1)은 이웃을 연결로 깨우지 않는다');
  hit(B.mons[0]);
  assert.equal(B.mons[0].awake, true);
  assert.equal(C.mons[0].awake, false, '깊은 팩이 깨도 얕은 팩(1)은 연결로 깨지 않는다');
  assert.equal(D.mons[0].awake, true, '깊은 팩끼리(3 → 2)는 지금처럼 연결');
  // 깊이가 없는 팩(디버그 · 고정 상태 · 수호자)은 깊은 팩으로 본다
  const E = pack(ctx, 'normal', [{ x: 8, z: 6 }]);
  const F = pack(ctx, 'normal', [{ x: 8 + L, z: 6 }]);
  hit(E.mons[0]);
  assert.equal(F.mons[0].awake, true);
});

test('깨어 있는 수 상한 MON.maxAwake(120) — 시야로는 새로 깨지 않고 피격은 예외', () => {
  const { ctx } = setup();
  const crowd = [];
  for (let k = 0; k < MON.maxAwake; k++) crowd.push({ x: 3 + (k % 20) * 1.9, z: 38 + Math.floor(k / 20) * 0.0 + (k % 2) * 0.5 });
  const big = pack(ctx, 'normal', crowd, { awake: true });
  assert.equal(big.mons.filter(m => m.awake).length, 120);
  const near = pack(ctx, 'normal', [{ x: 23, z: 26 }]);
  step(ctx, 12);
  assert.equal(near.mons[0].awake, false, '120 이면 시야로 깨지 않는다');
  onMonDamaged(ctx, near.mons[0], { monId: near.mons[0].id, dmg: 1, crit: false, killed: false, immune: false, blocked: false }, {});
  assert.equal(near.mons[0].awake, true, '피격은 예외');
  assert.equal(wakePack(ctx, near.pk.id, 'sight'), 0);
});

test('직선 추적 · 정지 거리(r + reach × 0.8 + player.r)에서 멈추고 플레이어 원 안으로 들어가지 않는다', () => {
  const { ctx, p } = setup();
  const { mons: [g] } = pack(ctx, 'normal', [{ x: 23, z: 31 }], { awake: true });
  let last = dist(g.pos, p.pos), minD = Infinity;
  step(ctx, 150, () => {
    const d = dist(g.pos, p.pos);
    minD = Math.min(minD, d);
    if (g.act === 'move' || g.act === 'idle') assert.ok(d <= last + 1e-9, '거리를 줄인다');
    last = d;
  });
  const stop = chaseStop(g, getMonDef('ghoul'), p);
  assert.ok(Math.abs(stop - (0.45 + 0.9 * MON.stopFrac + 0.4)) < 1e-9);
  assert.ok(minD >= stop - 0.05, `정지 거리 ${stop} · 최소 ${minD}`);
  assert.ok(minD >= g.r + p.r, '플레이어 원 밖');
  assert.ok(countEvents(ctx.events, EV.MON_ACT) >= 1, '닿으면 할퀸다');
  assert.ok(isWalkable(ctx.map, g.pos.x, g.pos.z));
});

test('흐름장 추적 — 벽을 돌아 몰려온다(flowDir 이 있을 때)', (t) => {
  const { ctx, p, state, map } = setup({ ascii: WALL_ROOM });
  updateFlow(ctx.flow, map, p.pos, state.tick, true);
  const probe = flowDir(ctx.flow, map, 24, 13);
  if (!probe) { t.skip('flowDir 이 아직 방향을 주지 않는다(P4 흐름장 — 통합 게이트에서 다시)'); return; }
  const { mons: [g] } = pack(ctx, 'normal', [{ x: 25, z: 13 }], { awake: true });
  let reached = false;
  step(ctx, 900, () => {
    if (state.tick % 6 === 0) updateFlow(ctx.flow, map, p.pos, state.tick, true);
    if (dist(g.pos, p.pos) < 2.5) reached = true;
  });
  assert.ok(reached, `벽 뒤에서 돌아왔다(마지막 ${dist(g.pos, p.pos).toFixed(2)}m)`);
});

test('밀어내기 — 같은 자리 둘 · 떼가 둘러싸도 겹침이 풀리고 아무도 플레이어 원에 들어가지 않는다', () => {
  const { ctx, p } = setup();
  p.dead = true;   // 생각 = hold — 밀어내기만
  const { mons: [a, b] } = pack(ctx, 'normal', [{ x: 10, z: 10 }, { x: 10, z: 10 }], { awake: true });
  step(ctx, 30);
  assert.ok(dist(a.pos, b.pos) >= a.r + b.r - 0.02, `떨어졌다 ${dist(a.pos, b.pos)}`);
  p.dead = false;
  const ring = [];
  for (let k = 0; k < 14; k++) ring.push({ x: 23 + Math.sin(k) * 7, z: 21 + Math.cos(k) * 7 });
  const { mons } = pack(ctx, 'normal', ring, { awake: true });
  let worst = Infinity;
  step(ctx, 240, () => { for (const m of mons) worst = Math.min(worst, dist(m.pos, p.pos) - (m.r + p.r)); });
  assert.ok(worst >= -0.02, `플레이어 원 침범 ${worst}`);
  let overlap = 0;
  for (let i = 0; i < mons.length; i++) for (let j = i + 1; j < mons.length; j++) overlap = Math.max(overlap, mons[i].r + mons[j].r - dist(mons[i].pos, mons[j].pos));
  assert.ok(overlap < 0.35, `몸 겹침 최대 ${overlap}`);
  const close = mons.filter(m => dist(m.pos, p.pos) < 2.2).length;
  assert.ok(close >= 6, `둘러쌌다 ${close}`);
  for (const m of mons) assert.ok(isWalkable(ctx.map, m.pos.x, m.pos.z));
});

test('다시 잠 — 깨어 있는데 leash(36m) 넘게 leashSec(3초) 머물면 그 자리에서 잠든다(생명 유지)', () => {
  const { ctx, p } = setup({ ascii: longRoom() });
  const { pk, mons: [g] } = pack(ctx, 'normal', [{ x: 110, z: 10 }], { awake: true });
  g.hp = g.hpMax * 0.5;
  assert.ok(dist(g.pos, p.pos) > MON.leash);
  step(ctx, ticks(MON.leashSec) - 1);
  assert.equal(g.awake, true);
  step(ctx, 2);
  assert.equal(g.awake, false);
  assert.equal(pk.awake, false);
  assert.equal(g.hp, g.hpMax * 0.5);
  assert.equal(g.sleepAt, -1);
  assert.equal(g.targeting, false);
});

test('근접 시작은 관용 없이(r + reach + player.r) · 판정은 + MON.reachTolerance(0.3) · 원뿔 밖이면 시작하지 않는다', () => {
  const { ctx, p } = setup();
  const g = spawnMonster(ctx, { typeId: 'ghoul', rank: 'normal', level: 1, x: 23, z: 21 - 2, awake: true });
  const atk = attackOf(getMonDef('ghoul'), 'claw');
  const R = g.r + atk.reach + p.r;
  const place = (d, facing = 0) => { g.pos.x = p.pos.x; g.pos.z = p.pos.z - d; g.facing = facing; };
  place(R + 0.01); assert.equal(meleeStartOk(g, atk, p), false);
  place(R - 0.01); assert.equal(meleeStartOk(g, atk, p), true);
  place(R + MON.reachTolerance - 0.01); assert.equal(meleeHitOk(g, atk, p), true);
  place(R + MON.reachTolerance + 0.01); assert.equal(meleeHitOk(g, atk, p), false);
  place(R - 0.2, Math.PI); assert.equal(meleeStartOk(g, atk, p), false, '등 뒤');
  place(R - 0.2, deg2rad(atk.coneDeg / 2 + 30)); assert.equal(meleeStartOk(g, atk, p), false, '원뿔 밖');
});

test('공격 진행 — 예비 동안 facing 고정 · actHit 틱에 strike · MON_STRIKE → recover → actEnd 에 idle · 예비 동안 0.3m 넘게 물러나면 판정 밖', () => {
  const { ctx, p, state } = setup();
  const def = getMonDef('ghoul');
  const atk = attackOf(def, 'claw');
  const g = spawnMonster(ctx, { typeId: 'ghoul', rank: 'normal', level: 1, x: p.pos.x, z: p.pos.z - 1.6, awake: true });
  g.facing = 0;
  step(ctx, 1);
  assert.equal(g.act, 'windup');
  assert.equal(g.actId, 'claw');
  const t0 = state.tick;
  assert.equal(g.actHit - g.actStart, ticks(atk.windup));
  assert.equal(g.actEnd - g.actHit, ticks(atk.recover));
  const act = ctx.events.find(e => e.name === EV.MON_ACT).payload;
  assert.deepEqual(Object.keys(act).sort(), ['act', 'actId', 'dur', 'facing', 'id', 'telegraph', 'typeId', 'x', 'z']);
  assert.equal(act.telegraph, 'pose');
  const f0 = g.facing;
  p.pos.x += 0.6;   // 옆으로 — facing 은 따라가지 않는다
  step(ctx, g.actHit - state.tick - 1);
  assert.equal(g.facing, f0);
  assert.equal(countEvents(ctx.events, EV.MON_STRIKE), 0);
  // 판정 틱에 이미 0.3m 넘게 물러났다 → 판정 밖
  p.pos.x = g.pos.x; p.pos.z = g.pos.z + (g.r + atk.reach + p.r + 0.45);
  step(ctx, 1);
  assert.equal(state.tick, g.actHit);
  assert.equal(countEvents(ctx.events, EV.MON_STRIKE), 1);
  assert.equal(g.act, 'strike');
  assert.equal(meleeHitOk(g, atk, p), false);
  step(ctx, 1);
  assert.equal(g.act, 'recover');
  step(ctx, g.actEnd - state.tick);
  assert.notEqual(g.act, 'recover');
  assert.ok(state.tick - t0 >= ticks(atk.windup) + ticks(atk.recover));
});

test('빠름: pose 공격의 예비 · 후딜 ÷ atkSpeedMul · 바닥 표식 공격(돌진)의 예비는 데이터 그대로(쿨다운만 ÷) · 냉기는 예비를 늘린다', () => {
  const { ctx } = setup();
  const a = spawnMonster(ctx, { typeId: 'ghoul', rank: 'champion', level: 1, affixes: ['fast'], x: 20, z: 15, awake: true });
  const claw = attackOf(getMonDef('ghoul'), 'claw');
  startAttack(ctx, a, 'claw');
  assert.equal(a.actHit - a.actStart, ticks(claw.windup / 1.25));
  assert.equal(a.actEnd - a.actHit, ticks(claw.recover / 1.25));
  const c = spawnMonster(ctx, { typeId: 'charger', rank: 'champion', level: 1, affixes: ['fast'], x: 30, z: 15, awake: true });
  const ch = attackOf(getMonDef('charger'), 'charge');
  const t = ctx.state.tick;
  const dur = startAttack(ctx, c, 'charge');
  assert.equal(c.actHit - c.actStart, ticks(ch.windup), '예고는 줄지 않는다(H5)');
  assert.equal(dur, ticks(ch.windup) / 30);
  assert.equal(c.readyAt.charge, t + ticks(ch.cd / 1.25));
  const s = spawnMonster(ctx, { typeId: 'ghoul', rank: 'normal', level: 1, x: 20, z: 25, awake: true });
  s.st.chill = 40;
  startAttack(ctx, s, 'claw');
  assert.equal(s.actHit - s.actStart, ticks(claw.windup / 0.7));
  // 빠른 돌격 짐승의 돌진 표식 길이도 데이터 그대로
  const { ctx: c2, p } = setup();
  const fc = spawnMonster(c2, { typeId: 'charger', rank: 'champion', level: 1, affixes: ['fast'], x: p.pos.x, z: p.pos.z - 8, awake: true });
  step(c2, 1);
  const line = c2.state.rift.effects.find(e => e.kind === 'chargeLine');
  assert.ok(line, '돌진 표식');
  assert.equal(line.hitAt - line.start, ticks(ch.windup));
  assert.equal(fc.actHit, line.hitAt);
});

test('상태 관문 — 기절 · 빙결 · 경직 중 생각 · 이동 없음 · 사라짐은 actEnd 틱에 idle(그 틱도 생각하지 않는다)', () => {
  const { ctx, p, state } = setup();
  const g = spawnMonster(ctx, { typeId: 'ghoul', rank: 'normal', level: 1, x: p.pos.x, z: p.pos.z - 5, awake: true });
  g.st.stunUntil = state.tick + 20;
  g.act = 'stunned';
  const x0 = { ...g.pos };
  step(ctx, 19);
  assert.deepEqual(g.pos, x0);
  assert.equal(countEvents(ctx.events, EV.MON_ACT), 0);
  step(ctx, 2);
  assert.notDeepEqual(g.pos, x0, '풀리면 다시 움직인다');
  // 사라짐
  const v = spawnMonster(ctx, { typeId: 'ghoul', rank: 'champion', level: 1, x: p.pos.x + 1.5, z: p.pos.z, awake: true });
  v.act = 'vanish';
  v.actStart = state.tick;
  v.actEnd = state.tick + 12;
  const v0 = { ...v.pos };
  step(ctx, 12);
  assert.equal(v.act, 'idle', 'actEnd 틱에 idle');
  assert.deepEqual(v.pos, v0, '사라짐 동안 · 끝 틱에는 움직이지 않는다');
  step(ctx, 1);
  assert.notEqual(v.act, 'vanish');
  // 잘못된 actEnd(이미 지남)도 영원히 사라져 있지 않다
  v.act = 'vanish'; v.actStart = state.tick; v.actEnd = state.tick - 50;
  step(ctx, 1);
  assert.equal(v.act, 'idle');
});

test('넉백은 상태 관문과 별개로 이동 · 그 틱엔 생각하지 않는다', () => {
  const { ctx, p, state } = setup();
  const g = spawnMonster(ctx, { typeId: 'ghoul', rank: 'normal', level: 1, x: p.pos.x, z: p.pos.z - 3, awake: true });
  // P2 applyKnock 은 그 틱(T)에 until = T + n 을 세우고 같은 틱의 몬스터 단계부터 n 번 민다 — 여기서는 T 다음 틱부터라 n − 1 번
  g.knock = { vx: 0, vz: -9, until: state.tick + 6 };
  g.st.stunUntil = state.tick + 3;
  const z0 = g.pos.z;
  step(ctx, 5);
  assert.ok(Math.abs(g.pos.z - (z0 - 9 * 5 / 30)) < 1e-6, `${g.pos.z}`);
  assert.equal(countEvents(ctx.events, EV.MON_ACT), 0);
});

test('팩 대표만 hazard 속성 onAwakeTick(챔피언 팩 냉기 노바 겹쳐 쏘지 않음) · 죽으면 다음 · 하수인은 대표가 되지 않는다', () => {
  const { ctx, p, state } = setup();
  const row = getMonAffix('coldEnchanted');
  const champ = pack(ctx, 'champion', [0, 1, 2].map(k => ({ x: p.pos.x - 2 + k * 2, z: p.pos.z + 5, affixes: ['coldEnchanted'] })), { awake: true });
  p.dead = true;   // hold — 움직이지 않고 노바 타이머만(노바는 플레이어가 살아 있을 때만)
  step(ctx, ticks(row.params.novaFirst) + 2);
  p.dead = false;
  step(ctx, 2);
  const novas = () => state.rift.effects.filter(e => e.kind === 'coldNova');
  assert.equal(novas().length, 1, '팩에서 하나');
  assert.equal(novas()[0].srcId, champ.mons[0].id);
  assert.ok(champ.mons[1].ax.coldEnchanted.nextAt === undefined, '대표가 아니면 불리지 않는다');
  // 대표가 죽으면 다음
  champ.mons[0].hp = 0; champ.mons[0].dead = true; champ.mons[0].deadAt = state.tick;
  state.rift.effects.length = 0;
  step(ctx, ticks(row.params.novaFirst) + 3);
  assert.equal(novas().length, 1);
  assert.equal(novas()[0].srcId, champ.mons[1].id);
  // 정예가 죽은 팩의 하수인은 위협을 만들지 않는다
  const { ctx: c2, p: p2, state: s2 } = setup();
  const pk = { id: c2.nextId(), kind: 'elite', memberIds: [], awake: true, nextHazardAt: -1, fled: false, anchor: { x: 20, z: 25 } };
  s2.rift.packs.push(pk);
  const e = spawnMonster(c2, { typeId: 'ghoul', rank: 'elite', level: 1, affixes: ['coldEnchanted'], packId: pk.id, x: p2.pos.x, z: p2.pos.z + 5, awake: true });
  const mi = spawnMonster(c2, { typeId: 'ghoul', rank: 'minion', level: 1, affixes: ['coldEnchanted'], packId: pk.id, x: p2.pos.x + 2, z: p2.pos.z + 5, awake: true });
  pk.memberIds.push(e.id, mi.id);
  e.hp = 0; e.dead = true; e.deadAt = s2.tick;
  step(c2, ticks(row.params.novaFirst) + 30);
  assert.equal(s2.rift.effects.filter(x => x.kind === 'coldNova').length, 0);
});

test('updateMonsters 는 prevPos 를 쓰지 않는다(보간은 GameSim 이 틱 맨 앞에 복사) · 생명 ≤ 0 이면 행동 · 판정 없음', () => {
  const { ctx, p, state } = setup();
  const g = spawnMonster(ctx, { typeId: 'ghoul', rank: 'normal', level: 1, x: p.pos.x, z: p.pos.z - 1.6, awake: true });
  g.facing = 0;
  g.prevPos.x = -1; g.prevPos.z = -2;
  const pp = g.prevPos;
  state.tick += 1;
  rebuildSpace(ctx);
  updateMonsters(ctx);
  assert.equal(g.prevPos, pp);
  assert.deepEqual(g.prevPos, { x: -1, z: -2 });
  assert.equal(g.act, 'windup');
  g.hp = 0;   // 플레이어가 먼저 죽였다(dead 처리 전)
  step(ctx, g.actHit - state.tick + 2);
  assert.equal(countEvents(ctx.events, EV.MON_STRIKE), 0);
  assert.equal(g.targeting, false);
});

test('targeting = 깨어 있고 15m 안 · 도망 아님 / 잠든 몬스터는 거의 비용 0(120 깨어 있음 + 잠든 300 · 한 틱 평균)', () => {
  const { ctx, p, state } = setup();
  const { mons: [near] } = pack(ctx, 'normal', [{ x: p.pos.x, z: p.pos.z + 10 }], { awake: true });
  const { mons: [far] } = pack(ctx, 'normal', [{ x: 3, z: 3 }], { awake: true });
  step(ctx, 1);
  assert.equal(near.targeting, true);
  assert.equal(far.targeting, dist(far.pos, p.pos) <= MON.targetingRange);
  // 성능 감(참고 — 상한은 perf.test(P15)의 4ms): 깨어 있는 120 + 잠든 300
  const { ctx: c2, state: s2 } = setup();
  const awakeList = [], sleepList = [];
  for (let k = 0; k < 120; k++) awakeList.push({ x: 4 + (k % 12) * 3, z: 4 + Math.floor(k / 12) * 3.5 });
  for (let k = 0; k < 300; k++) sleepList.push({ x: 3 + (k % 20) * 1.9, z: 3 + Math.floor(k / 20) * 2.4 });
  pack(c2, 'normal', awakeList, { awake: true });
  pack(c2, 'normal', sleepList.slice(0, 150));
  pack(c2, 'normal', sleepList.slice(150));
  const t0 = process.hrtime.bigint();
  step(c2, 150);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 150;
  assert.ok(ms < 8, `한 틱 ${ms.toFixed(2)}ms`);
  assertFiniteDeep(s2.rift.mons);
  for (const m of s2.rift.mons) assert.ok(isWalkable(c2.map, m.pos.x, m.pos.z), `걷기 가능 ${m.id}`);
  void state;
});

// ───────────────────────── 리뷰 수정: 흐름장 밖의 깬 몬스터 ─────────────────────────

/** 두 방(벽 5칸 = 10m 두께)을 긴 ㄷ자 통로(약 80m)로만 잇는 맵 — sealed 면 통로가 없다 @param {boolean} sealed */
function detourMap(sealed) {
  const rows = ['####################'];
  rows.push('#....#####....######', '#.S..#####....######', '#....#####....######', '#....#####....######');
  for (let j = 5; j <= 17; j++) rows.push(sealed ? '####################' : '##.########.########');
  rows.push(sealed ? '####################' : '##..........########');
  rows.push('####################');
  return rows.join('\n');
}

test('리뷰 수정: 흐름장(maxSteps) 밖 · 벽 너머(직선 18m · 경로 약 80m)의 깬 몬스터는 먼 흐름장(FLOW.far)을 따라 돌아와 플레이어에 닿는다 — 벽에 붙어 영영 서지 않는다', () => {
  const { ctx, state, map, p } = setup({ ascii: detourMap(false) });
  const at = { x: 23, z: 5 };
  const { mons: [m] } = pack(ctx, 'normal', [{ x: at.x, z: at.z }], { awake: true });
  updateFlow(ctx.flow, map, p.pos, state.tick, true);
  assert.equal(flowDist(ctx.flow, map, m.pos.x, m.pos.z), Infinity, '이 검사는 흐름장 밖에서 시작한다');
  let minD = Infinity;
  step(ctx, 30 * 50, () => {
    updateFlow(ctx.flow, map, p.pos, state.tick);
    minD = Math.min(minD, dist(m.pos, p.pos));
  });
  assert.ok(minD < 2, `플레이어에 닿지 못했다(가장 가까이 ${minD.toFixed(1)}m — 벽 앞에 섰다)`);
  assert.equal(m.awake, true);
});

test('리뷰 수정: 어느 흐름장으로도 닿지 않는(막힌 방) 깬 몬스터는 MON.leashSec 뒤 잠든다 — 직선 목줄(36m) 안이어도', () => {
  const { ctx, state, map, p } = setup({ ascii: detourMap(true) });
  const { mons: [m] } = pack(ctx, 'normal', [{ x: 23, z: 5 }], { awake: true });
  assert.ok(dist(m.pos, p.pos) < MON.leash, '직선 목줄 안');
  let sleptAt = -1;
  step(ctx, ticks(MON.leashSec) + 30, () => {
    updateFlow(ctx.flow, map, p.pos, state.tick);
    if (sleptAt < 0 && !m.awake) sleptAt = state.tick;
  });
  assert.ok(sleptAt > 0, '깬 채 벽 앞에 서 있다');
  assert.ok(sleptAt - 100 >= ticks(MON.leashSec), 'leashSec 전에 잠들지 않는다');
});
