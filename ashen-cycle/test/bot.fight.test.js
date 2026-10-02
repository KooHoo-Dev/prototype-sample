// OWNER: P9 — 계약 §12.3 · §12.4
// 헤드리스 봇의 규칙(§12.3)과 봇 대전 시나리오 A~E(§12.4). 이 파일만 90초까지 허용한다(§12.1).
//
// 누가 언제 돌리나(§12.4): W2의 P9 패키지 게이트는 발더의 A~E였다. **W3 통합 게이트가 펜리르 · 니힐의 A~D를 켰고**
// (skip 없음), 시나리오 F(세 보스 메타 루프) · G(통계: 교착 · 공격 분포 · 보스의 걸음 · 돌진)를 더했다 — docs/NOTES-W3.md.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus, EV } from '../src/core/events.js';
import { DT, BOSS_IDS } from '../src/core/constants.js';
import { NEUTRAL_INPUT } from '../src/core/inputFrame.js';
import { ringFromGrow } from '../src/core/hitShapes.js';
import { getBossDef } from '../src/data/bosses/index.js';
import { getWeaponDef } from '../src/data/weapons.js';
import { BOT } from '../src/data/bot.js';
import { GameSim } from '../src/sim/GameSim.js';
import { Progression } from '../src/sim/progression/Progression.js';
import { affordableLevelUps } from '../src/sim/progression/stats.js';
import { getCycleScaling } from '../src/sim/progression/economy.js';
import { createBot } from '../src/bot/bot.js';
import { assertFiniteDeep, makeTestProfile, makeTestState } from './helpers.js';

const TICKS_PER_SEC = Math.round(1 / DT);
const MAX_300S = 300 * TICKS_PER_SEC;
const MAX_600S = 600 * TICKS_PER_SEC;
/**
 * 시나리오 A · C · D의 프로필(§12.4 — W3): 보스마다 「그 보스에 처음 닿았을 법한 성장」이다.
 * (W2까지는 세 보스 공용 {vit 12, end 8, str 12, dex 6} · 무기 +5였다 — 발더에게는 과성장이라 C가 25초에 끝났다.)
 * 값은 봇 메타 루프(시나리오 F)의 평균 진입 점수에서 왔다: 발더는 3번째 도전쯤(8점 · +2), 펜리르 21점 · +3, 니힐 36점 · +4.
 */
const A_PROFILE = {
  valder: { points: { vit: 4, str: 4 }, weaponLevel: 2 },
  fenrir: { points: { vit: 10, end: 2, str: 10 }, weaponLevel: 3 },
  nihil: { points: { vit: 16, end: 4, str: 16, dex: 2 }, weaponLevel: 4 },
};
/**
 * 시나리오 A · D의 시드(프로필 · 봇 공용). A는 「양쪽 피해 발생」 · 「2페이즈 도달」을 단언한다 — 봇이 무피해로 끝내거나
 * 2페이즈 전에 죽는 시드도 있어 조건을 채우는 판을 고정해 둔다. 수치가 바뀌면 다시 고른다.
 */
const A_SEED = { valder: 4, fenrir: 1, nihil: 1 };
const E_SEED = 3;
const E_MAX_ATTEMPTS = 12;
const F_SEEDS = [1, 2, 3];

/**
 * 봇으로 한 판을 끝까지(FIGHT_ENDED 또는 maxTicks). 60틱마다 assertFiniteDeep.
 * @param {{profile:object, bossId:string, bot:{decide:Function}, maxTicks:number, god?:boolean, sim?:GameSim, bus?:EventBus}} o
 */
function runFight(o) {
  const bus = o.bus ?? new EventBus();
  /** @type {{name:string, payload:any}[]} */
  const log = [];
  const offAny = bus.onAny((name, payload) => log.push({ name, payload }));
  const sim = o.sim ?? new GameSim({ profile: o.profile, bus });
  sim.startBossFight(o.bossId);
  if (o.god) sim.setDebug({ godMode: true });
  let ended = null;
  const offEnd = bus.on(EV.FIGHT_ENDED, (p) => { ended = p; });
  let ticks = 0;
  while (ticks < o.maxTicks && !ended) {
    sim.step(DT, o.bot.decide(sim.state));
    ticks += 1;
    if (ticks % 60 === 0) assertFiniteDeep(sim.state);
  }
  assertFiniteDeep(sim.state);
  offAny();
  offEnd();
  if (o.god) sim.setDebug({ godMode: false });
  const first = (name) => log.findIndex((e) => e.name === name);
  const count = (name) => log.reduce((n, e) => n + (e.name === name ? 1 : 0), 0);
  const reward = log.find((e) => e.name === EV.REWARD_GRANTED)?.payload.reward ?? null;
  return { sim, bus, log, ended, ticks, reward, first, count, fight: sim.state.fight };
}

/** @param {string} bossId @param {number} seed */
const aProfile = (bossId, seed) => makeTestProfile({ ...A_PROFILE[bossId], seed });

/** @param {string} bossId */
function runA(bossId) {
  const seed = A_SEED[bossId] ?? 1;
  return runFight({ profile: aProfile(bossId, seed), bossId, bot: createBot({ seed }), maxTicks: MAX_300S });
}

// ───────────────────────────────────────────────────────────── 봇 규칙(§12.3) — 합성 상태로

const VALDER = getBossDef('valder');

/** 발더와 마주 선 합성 상태: 플레이어 원점(록온) · 보스 (0, d)에서 플레이어를 본다. */
function facingState(d = 3, playerOver = {}) {
  const state = makeTestState({ bossDef: VALDER });
  state.boss.pos = { x: 0, z: d };
  state.boss.prevPos = { x: 0, z: d };
  Object.assign(state.player, { lockOn: true }, playerOver);
  return state;
}

/** 진행 중인 발더 공격 런타임(§3.5 전 필드). t = 공격 시작 후 경과. */
function attackAt(id, t, seq = 1) {
  const a = VALDER.attacks[id];
  const tA = t - a.windup;
  const phase = tA < 0 ? 'windup' : tA < a.active ? 'active' : 'recovery';
  return {
    id, seq, pose: a.pose, glow: a.glow, phase, phaseT: 0, t,
    windup: a.windup, active: a.active, recovery: a.recovery,
    locked: false, aimX: 0, aimZ: 0, chained: false, fired: [], hitIds: a.hits.map(() => 0),
  };
}

function setAttack(state, id, t, seq = 1) {
  state.boss.state = 'attack';
  state.boss.attack = attackAt(id, t, seq);
  state.boss.stateTime = t;
}

describe('봇 규칙 — §12.3', () => {
  test('1. 보스가 없거나 · 플레이어가 죽었거나 · 판이 끝났으면 NEUTRAL_INPUT', () => {
    const bot = createBot({ seed: 1 });
    assert.equal(bot.decide(makeTestState()), NEUTRAL_INPUT, '마을');
    const dead = facingState();
    dead.player.state = 'dead';
    dead.player.hp = 0;
    assert.equal(bot.decide(dead), NEUTRAL_INPUT, '사망');
    const done = facingState();
    done.fight.phase = 'done';
    assert.equal(bot.decide(done), NEUTRAL_INPUT, 'fight.phase done');
    const won = facingState();
    won.boss.hp = 0;
    assert.equal(bot.decide(won), NEUTRAL_INPUT, '보스 HP 0');
  });

  test('2. 록온이 꺼져 있으면 lockOnPressed', () => {
    const bot = createBot({ seed: 1 });
    assert.equal(bot.decide(facingState(6, { lockOn: false })).lockOnPressed, true);
    assert.equal(bot.decide(facingState(6, { lockOn: true })).lockOnPressed, false);
  });

  test('3·4. 예고가 reaction 안으로 들어오면 구른다 — 보스 방향에 수직 · 인스턴스당 한 번 굴린다', () => {
    const a = VALDER.attacks.slash_r;
    const soon = facingState(3);
    setAttack(soon, 'slash_r', a.windup - BOT.reaction + DT);
    const out = createBot({ seed: 1, dodgeChance: 1 }).decide(soon);
    assert.equal(out.rollPressed, true);
    assert.ok(Math.abs(out.moveZ) < 1e-6 && Math.abs(Math.abs(out.moveX) - 1) < 1e-6, `수직이 아니다: ${out.moveX}, ${out.moveZ}`);

    // 홀짝으로 좌우가 갈린다
    const other = facingState(3);
    setAttack(other, 'slash_r', a.windup - BOT.reaction + DT, 2);
    const out2 = createBot({ seed: 1, dodgeChance: 1 }).decide(other);
    assert.equal(Math.sign(out2.moveX), -Math.sign(out.moveX));

    // 아직 멀었으면 구르지 않는다(사거리 안 · 보스 예고 중 → 멈춰서 기다린다)
    const early = facingState(3);
    setAttack(early, 'slash_r', 0.1);
    const wait = createBot({ seed: 1, dodgeChance: 1 }).decide(early);
    assert.equal(wait.rollPressed, false);
    assert.equal(wait.lightPressed, false);
    assert.equal(Math.hypot(wait.moveX, wait.moveZ), 0);

    // dodgeChance 0이면 절대 구르지 않는다 — 같은 인스턴스를 몇 번 물어도 답이 같다
    const never = createBot({ seed: 1, dodgeChance: 0 });
    for (let i = 0; i < 20; i++) assert.equal(never.decide(soon).rollPressed, false);

    // 닿지 않는 거리의 예고는 위협이 아니다
    const far = facingState(12);
    setAttack(far, 'slash_r', a.windup - BOT.reaction + DT);
    assert.equal(createBot({ seed: 1, dodgeChance: 1 }).decide(far).rollPressed, false);
  });

  test('4. 이미 흘린 판정(hitLog)에는 다시 구르지 않고, 구르는 중에는 다시 누르지 않는다', () => {
    const a = VALDER.attacks.slash_r;
    const state = facingState(3);
    setAttack(state, 'slash_r', a.windup + DT);
    state.boss.attack.hitIds = [77];
    const bot = createBot({ seed: 1, dodgeChance: 1 });
    assert.equal(bot.decide(state).rollPressed, true, '판정 중 · 아직 안 맞음');
    state.hitLog.push({ hitId: 77, target: 'player' });
    assert.equal(bot.decide(state).rollPressed, false, '이미 흘렸다');

    const rolling = facingState(3, { state: 'roll', stateTime: 0.1, iframe: true });
    setAttack(rolling, 'slash_r', a.windup - 0.05);
    assert.equal(createBot({ seed: 1, dodgeChance: 1 }).decide(rolling).rollPressed, false);
  });

  test('4. 돌진 선(바닥 표식)은 선에 수직으로 · 충격파 띠는 중심을 향해 구른다', () => {
    // 찌르기 돌진: 예고 중의 긴 선(telegraphShape)이 위협이다
    const a = VALDER.attacks.thrust_charge;
    const lane = facingState(9);
    lane.player.pos = { x: 0.3, z: 0 };
    lane.player.prevPos = { x: 0.3, z: 0 };
    setAttack(lane, 'thrust_charge', a.windup - BOT.reaction + DT);
    lane.telegraphs = [{
      id: 'atk:1:0', shape: { type: 'capsule', ax: 0, az: 9, bx: 0, bz: -4.4, r: 0.8 }, progress: 0.9, style: 'danger', source: 'boss',
    }];
    const out = createBot({ seed: 1, dodgeChance: 1 }).decide(lane);
    assert.equal(out.rollPressed, true);
    assert.ok(out.moveX > 0.99 && Math.abs(out.moveZ) < 1e-6, `서 있는 쪽(+X)으로 선에 수직이어야 한다: ${out.moveX}, ${out.moveZ}`);

    // 충격파: 띠가 ringNear 안으로 다가오면 중심(보스 쪽)으로
    const ring = facingState(6);
    const grow = { r0: 2, r1: 10, width: 1 };
    const u = 0.3;
    ring.hazards.push({
      id: 5, kind: 'shockwave', style: 'fire', state: 'active', t: u * 0.8, warn: 0, active: 0.8, interval: 0,
      shape: ringFromGrow(0, 6, grow, u), damage: 18, guardable: true, knockdown: false, hitId: 6, nextTick: 0,
      grow, x: 0, z: 6, facing: 0,
    });
    const out2 = createBot({ seed: 1, dodgeChance: 1 }).decide(ring);
    assert.equal(out2.rollPressed, true);
    assert.ok(out2.moveZ > 0.99, `띠의 중심(+Z)을 향해야 한다: ${out2.moveX}, ${out2.moveZ}`);

    // 이미 지나간 띠(플레이어가 띠 안쪽)는 위협이 아니다
    const passed = facingState(6);
    passed.hazards.push({ ...ring.hazards[0], shape: ringFromGrow(0, 6, grow, 1), t: 0.79 });
    assert.equal(createBot({ seed: 1, dodgeChance: 1 }).decide(passed).rollPressed, false);
  });

  test('4a. (W3) 막을 수 있는 투사체는 가드로 받는다 — 스태미나가 모자라면 구른다', () => {
    const orb = (z) => ({
      id: 9, kind: 'void_orb', style: 'void', x: 0, z, prevX: 0, prevZ: z, y: 1.4, dir: Math.PI, speed: 9, r: 0.45,
      age: 0.5, life: 5, homing: 2.2, homingTime: 2.5, damage: 22, guardable: true, parryable: true, knockdown: false, hitId: 31,
    });
    // 3m 앞(0.24초 뒤 도착 — projLead 0.4 안 · reaction 0.18 밖): 가드를 쥔다. 구르지 않는다
    const close = facingState(12);
    close.projectiles.push(orb(3));
    const out = createBot({ seed: 1, dodgeChance: 1 }).decide(close);
    assert.equal(out.guard, true);
    assert.equal(out.rollPressed, false);
    assert.equal(Math.hypot(out.moveX, out.moveZ), 0, '보스(= 구체가 오는 쪽)를 본 채 선다');

    // 아직 멀면(0.4초 밖) 평소대로 접근한다
    const far = facingState(12);
    far.projectiles.push(orb(8));
    const walk = createBot({ seed: 1, dodgeChance: 1 }).decide(far);
    assert.equal(walk.guard, false);
    assert.ok(walk.moveZ > 0.9);

    // 스태미나가 guardStamina보다 적으면 가드 대신 구른다(reaction 안에 들어왔을 때)
    const tired = facingState(12, { stamina: BOT.guardStamina - 1 });
    tired.projectiles.push(orb(1.6));
    const roll = createBot({ seed: 1, dodgeChance: 1 }).decide(tired);
    assert.equal(roll.guard, false);
    assert.equal(roll.rollPressed, true);

    // 막을 수 없는 투사체는 구른다 · dodgeChance 0이면 아무것도 하지 않는다(그대로 맞는다)
    const raw = facingState(12);
    raw.projectiles.push({ ...orb(1.6), guardable: false });
    const r2 = createBot({ seed: 1, dodgeChance: 1 }).decide(raw);
    assert.equal(r2.guard, false);
    assert.equal(r2.rollPressed, true);
    const never = createBot({ seed: 1, dodgeChance: 0 }).decide(close);
    assert.equal(never.guard, false);
    assert.equal(never.rollPressed, false);
  });

  test('5. (W3) 지속 판정(브레스): 방향이 고정된 뒤에는 부채꼴 밖으로 달려 나간다 — 멀면 보스의 옆구리 쪽으로 비스듬히', () => {
    const FENRIR = getBossDef('fenrir');
    const a = FENRIR.attacks.frost_breath;
    const mk = (px, locked, t, bz = 6) => {
      const state = makeTestState({ bossDef: FENRIR });
      state.boss.pos = { x: 0, z: bz };
      state.boss.prevPos = { x: 0, z: bz };
      state.boss.state = 'attack';
      state.boss.attack = {
        id: 'frost_breath', seq: 2, pose: a.pose, glow: a.glow, phase: t < a.windup ? 'windup' : 'active', phaseT: 0, t,
        windup: a.windup, active: a.active, recovery: a.recovery, locked, aimX: 0, aimZ: 0, chained: false, fired: [], hitIds: [0],
      };
      state.boss.stateTime = t;
      Object.assign(state.player, { lockOn: true, pos: { x: px, z: 0 }, prevPos: { x: px, z: 0 } });
      return state;
    };
    // 판정 중 · 이번 틱의 판정은 이미 흘렸다 → 다음 간격(0.35초 뒤)까지 달린다.
    // 보스가 6m 앞(coneNear 3m보다 멀다): 서 있는 쪽(−X) + 보스 쪽(+Z)으로 비스듬히 — 부채꼴은 보스 쪽이 좁다
    const active = mk(-0.5, true, a.windup + 0.02);
    active.boss.attack.hitIds = [55];
    active.hitLog.push({ hitId: 55, target: 'player' });
    const out = createBot({ seed: 1, dodgeChance: 1 }).decide(active);
    assert.equal(out.rollPressed, false);
    assert.ok(out.moveX < -0.5 && out.moveZ > 0.4, `옆 + 보스 쪽: ${out.moveX}, ${out.moveZ}`);
    assert.ok(Math.abs(Math.hypot(out.moveX, out.moveZ) - 1) < 1e-9);
    assert.equal(out.sprint, true);
    const other = mk(0.5, true, a.windup + 0.02);
    other.boss.attack.hitIds = [55];
    other.hitLog.push({ hitId: 55, target: 'player' });
    assert.ok(createBot({ seed: 1, dodgeChance: 1 }).decide(other).moveX > 0.5);
    // 보스가 가깝다(2.5m ≤ coneNear): 옆으로만
    const close = mk(-0.5, true, a.windup + 0.02, 2.5);
    close.boss.attack.hitIds = [55];
    close.hitLog.push({ hitId: 55, target: 'player' });
    const side = createBot({ seed: 1, dodgeChance: 1 }).decide(close);
    assert.ok(side.moveX < -0.9 && Math.abs(side.moveZ) < 0.1, `부채꼴의 축에 수직: ${side.moveX}, ${side.moveZ}`);

    // 방향이 고정되기 전(추적 중)에는 달아나지 않는다 — 어차피 따라온다
    const tracking = mk(-0.5, false, 0.3);
    const wait = createBot({ seed: 1, dodgeChance: 1 }).decide(tracking);
    assert.equal(wait.sprint, false);
    assert.ok(Math.abs(wait.moveX) < 0.5, '고정 전에는 옆으로 달리지 않는다');
  });

  test('5. 경고 중인 장판 안이고 시간이 남았으면 달려서 벗어난다', () => {
    const state = facingState(10);
    state.hazards.push({
      id: 5, kind: 'fire_pillar', style: 'fire', state: 'warn', t: 0.1, warn: 0.8, active: 0.2, interval: 0,
      shape: { type: 'circle', x: 0.5, z: 0, r: 2 }, damage: 22, guardable: true, knockdown: false, hitId: 6, nextTick: 0,
      grow: null, x: 0.5, z: 0, facing: 0,
    });
    const out = createBot({ seed: 1, dodgeChance: 1 }).decide(state);
    assert.equal(out.rollPressed, false);
    assert.ok(out.moveX < -0.9, `장판 중심(+X)에서 멀어져야 한다: ${out.moveX}`);
    assert.equal(out.sprint, true);
  });

  test('6. 체력이 낮으면: 안전하면 플라스크, 아니면 보스에게서 멀어지며 달린다', () => {
    const hp = 30;
    const farIdle = facingState(BOT.healSafeDist + 1, { hp });
    assert.equal(createBot({ seed: 1 }).decide(farIdle).flaskPressed, true, '멀다');

    const close = facingState(3, { hp });
    const run = createBot({ seed: 1 }).decide(close);
    assert.equal(run.flaskPressed, false);
    assert.ok(run.moveZ < -0.9 && run.sprint, '보스(+Z) 반대로 달린다');

    // 가까워도 보스의 남은 후딜이 길면 마신다
    const a = VALDER.attacks.overhead;
    const punish = facingState(3, { hp });
    setAttack(punish, 'overhead', a.windup + a.active + 0.05);
    assert.equal(createBot({ seed: 1 }).decide(punish).flaskPressed, true, '긴 후딜');

    // 플라스크가 없으면 평소대로 싸운다
    const empty = facingState(BOT.healSafeDist + 1, { hp, flasks: 0 });
    const fight = createBot({ seed: 1 }).decide(empty);
    assert.equal(fight.flaskPressed, false);
    assert.ok(fight.moveZ > 0.9, '보스 쪽으로');
  });

  test('7. 그로기: canExecute면 약공격, 아니면 보스 정면으로 간다(조건식을 다시 계산하지 않는다)', () => {
    const ready = facingState(2.5, { canExecute: true });
    ready.boss.state = 'groggy';
    ready.boss.stateDur = VALDER.groggyDur;
    assert.equal(createBot({ seed: 1 }).decide(ready).lightPressed, true);

    // 보스 등 뒤: 처형 조건이 안 된다 → 정면 지점(boss.pos + facing × (radius + executeStand))으로
    const behind = facingState(3, { canExecute: false });
    behind.boss.state = 'groggy';
    behind.boss.stateDur = VALDER.groggyDur;
    behind.boss.facing = 0; // 보스가 +Z를 본다 = 플레이어는 등 뒤
    const out = createBot({ seed: 1 }).decide(behind);
    assert.equal(out.lightPressed, false);
    assert.ok(out.moveZ > 0.9, `정면 지점(+Z)으로 가야 한다: ${out.moveX}, ${out.moveZ}`);
  });

  test('8. 반격: 긴 후딜 · 사거리 안 · 스태미나 ≥ attackStamina일 때만. 연속기가 남았으면 기다린다', () => {
    const reach = getWeaponDef('longsword').reach + VALDER.radius - BOT.reachPad;
    const a = VALDER.attacks.overhead;
    const open = facingState(reach - 0.2);
    setAttack(open, 'overhead', a.windup + a.active + 0.1);
    assert.equal(createBot({ seed: 1 }).decide(open).lightPressed, true);

    const tired = facingState(reach - 0.2, { stamina: BOT.attackStamina - 1 });
    setAttack(tired, 'overhead', a.windup + a.active + 0.1);
    assert.equal(createBot({ seed: 1 }).decide(tired).lightPressed, false, '스태미나 부족');

    const late = facingState(reach - 0.2);
    setAttack(late, 'overhead', a.windup + a.active + a.recovery - BOT.punishRecovery + 0.05);
    assert.equal(createBot({ seed: 1 }).decide(late).lightPressed, false, '남은 후딜이 짧다');

    const out = facingState(reach + 1);
    setAttack(out, 'overhead', a.windup + a.active + 0.1);
    const walk = createBot({ seed: 1 }).decide(out);
    assert.equal(walk.lightPressed, false, '사거리 밖');
    assert.ok(walk.moveZ > 0.9, '보스 쪽으로 걷는다');

    // slash_r의 후딜 0.30초에 연속기(slash_l) 판정이 남아 있다 — 그 전에는 때리지 않는다
    const s = VALDER.attacks.slash_r;
    const chain = facingState(reach - 0.2);
    setAttack(chain, 'slash_r', s.windup + s.active + 0.1);
    assert.equal(createBot({ seed: 1 }).decide(chain).lightPressed, false, '연속기 판정 전');
    const after = facingState(reach - 0.2);
    setAttack(after, 'slash_r', s.windup + s.active + s.chain[0].at + 0.05);
    assert.equal(createBot({ seed: 1 }).decide(after).lightPressed, true, '연속기 판정 뒤');
  });

  test('8. 보스가 idle이면 aggression 확률로 먼저 때린다 · 무적(intro)에는 때리지 않는다', () => {
    const reach = getWeaponDef('longsword').reach + VALDER.radius - BOT.reachPad;
    assert.equal(createBot({ seed: 1, aggression: 1 }).decide(facingState(reach - 0.2)).lightPressed, true);
    assert.equal(createBot({ seed: 1, aggression: 0 }).decide(facingState(reach - 0.2)).lightPressed, false);
    const intro = facingState(reach - 0.2);
    intro.boss.state = 'intro';
    intro.boss.invulnerable = true;
    intro.fight.phase = 'intro';
    assert.equal(createBot({ seed: 1, aggression: 1 }).decide(intro).lightPressed, false);
  });

  test('9. 거리 유지: 멀면 달려서 접근 · 스태미나가 바닥이면 물러난다', () => {
    const far = createBot({ seed: 1 }).decide(facingState(BOT.sprintDist + 2));
    assert.ok(far.moveZ > 0.9 && far.sprint === true);
    const mid = createBot({ seed: 1 }).decide(facingState(BOT.sprintDist - 2));
    assert.ok(mid.moveZ > 0.9 && mid.sprint === false);
    const tired = createBot({ seed: 1 }).decide(facingState(3, { stamina: BOT.retreatStamina - 1 }));
    assert.ok(tired.moveZ < -0.9, '물러난다');
    assert.equal(tired.lightPressed, false);
  });

  test('봇은 상태를 고치지 않는다 · 같은 시드는 같은 입력 열을 낸다 · reset()은 처음으로 되돌린다', () => {
    const run = () => {
      const bus = new EventBus();
      const sim = new GameSim({ profile: makeTestProfile({ seed: 11 }), bus });
      sim.startBossFight('valder');
      return sim;
    };
    const bot = createBot({ seed: 5 });
    const sim = run();
    const inputs = [];
    for (let i = 0; i < 900; i++) {
      const before = JSON.stringify(sim.state);
      const input = bot.decide(sim.state);
      assert.equal(JSON.stringify(sim.state), before, `decide가 상태를 고쳤다(틱 ${i})`);
      for (const key of Object.keys(NEUTRAL_INPUT)) assert.ok(key in input, `InputFrame에 ${key}가 없다`);
      assert.ok(Math.hypot(input.moveX, input.moveZ) <= 1 + 1e-9, '이동 의도의 길이 ≤ 1');
      inputs.push(JSON.stringify(input));
      sim.step(DT, input);
    }
    bot.reset();
    const sim2 = run();
    for (let i = 0; i < 900; i++) {
      const input = bot.decide(sim2.state);
      assert.equal(JSON.stringify(input), inputs[i], `틱 ${i}의 입력이 다르다`);
      sim2.step(DT, input);
    }
    assert.equal(JSON.stringify(sim2.state), JSON.stringify(sim.state));
  });
});

// ───────────────────────────────────────────────────────────── 봇 대전(§12.4)

describe('봇 대전 — §12.4', () => {
  for (const bossId of BOSS_IDS) {
    test(`A 표준 — ${bossId}`, () => {
      const r = runA(bossId);
      assert.ok(r.fight.damageDealt > 0, '보스에게 준 피해가 없다');
      assert.ok(r.fight.damageTaken > 0, '플레이어가 받은 피해가 없다');
      assert.ok(r.count(EV.BOSS_PHASE_CHANGED) >= 1, '2페이즈에 닿지 못했다 — 먼저 봇 규칙을 고친다(§12.4)');
      assert.ok(r.reward, 'REWARD_GRANTED가 없다');
      assert.ok(r.ended, 'FIGHT_ENDED가 없다(300초 안에 끝나지 않았다)');
      assert.ok(r.reward.embers > 0, 'reward.embers > 0');
      console.log(`[A ${bossId}] ${r.ended.outcome} · ${r.fight.time.toFixed(1)}초 · 준 피해 ${r.fight.damageDealt} · 받은 피해 ${r.fight.damageTaken} · 처형 ${r.fight.executions}`);
    });

    test(`B 사망 — ${bossId}`, () => {
      const profile = makeTestProfile({ seed: 2 });
      const r = runFight({ profile, bossId, bot: createBot({ seed: 2, dodgeChance: 0, aggression: 0.3 }), maxTicks: MAX_300S });
      assert.ok(r.first(EV.PLAYER_DIED) >= 0, 'PLAYER_DIED가 없다');
      assert.ok(r.first(EV.REWARD_GRANTED) > r.first(EV.PLAYER_DIED), 'PLAYER_DIED → REWARD_GRANTED 순서');
      assert.equal(r.reward.victory, false);
      if (r.reward.damageFraction > 0) assert.ok(r.reward.embers > 0, 'f > 0이면 잔불을 받는다');
      assert.equal(profile.embers, r.reward.embers, 'profile.embers가 reward.embers만큼 늘었다');
      assert.equal(r.reward.embersAfter, profile.embers);
      console.log(`[B ${bossId}] 사망 · ${r.fight.time.toFixed(1)}초 · f ${r.reward.damageFraction.toFixed(3)} · 잔불 ${r.reward.embers}`);
    });

    test(`D 결정성 — ${bossId}`, () => {
      const a = runA(bossId);
      const b = runA(bossId);
      assert.equal(a.fight.outcome, b.fight.outcome);
      assert.equal(a.fight.time, b.fight.time);
      assert.equal(a.fight.damageDealt, b.fight.damageDealt);
      assert.equal(a.ticks, b.ticks);
    });
  }

  // C는 한 프로필로 세 보스를 순서대로 잡는다(니힐 격파의 cycleAdvanced를 보려면 앞의 둘이 먼저 잡혀 있어야 한다).
  // 보스마다 그 보스의 A 프로필로 능력치 · 무기를 갈아 끼운다(진행 기록 — 해금 · 격파 수 — 은 이어진다).
  const cProfile = aProfile('valder', 7);
  for (const bossId of BOSS_IDS) {
    test(`C 승리(godMode) — ${bossId}`, () => {
      const def = getBossDef(bossId);
      Object.assign(cProfile.stats, { vit: 0, end: 0, str: 0, dex: 0 }, A_PROFILE[bossId].points);
      cProfile.weapons.longsword.level = A_PROFILE[bossId].weaponLevel;
      const expected = Math.round(def.reward * getCycleScaling(cProfile.cycle).rewardMul);
      const r = runFight({ profile: cProfile, bossId, bot: createBot({ seed: 7 }), maxTicks: MAX_600S, god: true });
      assert.ok(r.first(EV.BOSS_DEFEATED) >= 0, 'BOSS_DEFEATED가 없다(600초 안에 격파하지 못했다)');
      assert.ok(r.first(EV.REWARD_GRANTED) > r.first(EV.BOSS_DEFEATED), 'BOSS_DEFEATED → REWARD_GRANTED 순서');
      assert.equal(r.reward.victory, true);
      assert.equal(r.reward.embers, expected, 'embers = round(R)');
      assert.equal(r.fight.damageTaken, 0, 'godMode');
      const next = BOSS_IDS[BOSS_IDS.indexOf(bossId) + 1] ?? null;
      if (next) {
        assert.equal(r.reward.unlocked, next, '다음 보스 해금');
        assert.equal(cProfile.bosses[next].unlocked, true);
      } else {
        assert.equal(r.reward.cycleAdvanced, true, '세 보스 격파 → 순환 +1');
      }
      // (W3) 격파 시간은 「도달 프로필」 기준으로 계약의 허용 범위(45~180초) 안이어야 한다
      assert.ok(r.fight.time >= 45 && r.fight.time <= 180, `격파 ${r.fight.time.toFixed(1)}초 — 45~180초를 벗어났다`);
      console.log(`[C ${bossId}] 격파 ${r.fight.time.toFixed(1)}초 · 처형 ${r.fight.executions} (목표 45~180초)`);
    });
  }

  test('E 메타 루프 — valder: 죽고 · 사고 · 다시 도전해 12회 안에 격파', () => {
    const profile = makeTestProfile({ seed: E_SEED });
    const bus = new EventBus();
    const sim = new GameSim({ profile, bus });
    const progression = new Progression(profile, bus);
    let alternate = 0;
    let killedAt = 0;
    let checkedFirst = false;
    for (let n = 1; n <= E_MAX_ATTEMPTS && !killedAt; n++) {
      const bot = createBot({ seed: E_SEED * 100 + n, dodgeChance: 0.55, aggression: 0.6 });
      const r = runFight({ profile, bossId: 'valder', bot, maxTicks: MAX_300S, sim, bus });
      assert.ok(r.reward, `${n}회차: REWARD_GRANTED가 없다(300초 안에 끝나지 않았다)`);
      const f = r.reward.damageFraction;
      if (r.reward.victory) {
        killedAt = n;
        console.log(`[E ${n}] 격파 · f ${f.toFixed(2)} · ${r.fight.time.toFixed(0)}초 · 잔불 +${r.reward.embers}`);
        break;
      }
      if (!checkedFirst && f >= 0.10) {
        checkedFirst = true;
        assert.ok(affordableLevelUps(profile) >= 2, `f ${f.toFixed(2)}로 죽은 첫 판 뒤 레벨업 ${affordableLevelUps(profile)}회 — 2회 이상이어야 한다(브리프 §2)`);
      }
      // 자동 구매: 장착 무기 강화가 되면 강화 → 남은 잔불로 str · vit를 번갈아
      let bought = '';
      while (progression.upgradeWeapon(profile.equippedWeapon).ok) bought += ' 무기+1';
      for (;;) {
        const stat = alternate % 2 === 0 ? 'str' : 'vit';
        if (!progression.levelUp(stat).ok) break;
        bought += ` ${stat}`;
        alternate += 1;
      }
      console.log(`[E ${n}] 사망 · f ${f.toFixed(2)} · ${r.fight.time.toFixed(0)}초 · 잔불 +${r.reward.embers} · 산 것:${bought || ' 없음'}`);
    }
    assert.ok(killedAt > 0, `${E_MAX_ATTEMPTS}회 안에 격파하지 못했다`);
    assert.ok(killedAt <= 8, `격파까지 ${killedAt}회 — 목표 8회 이하(§12.4)`);
    console.log(`[E] 격파까지 ${killedAt}회 (목표 8회 이하 · 각 판 40~170초)`);
    assertFiniteDeep(sim.state);
  });
});

// ───────────────────────────────────────────────────────────── W3 통합 게이트 — 시나리오 F · G

/** E와 같은 자동 구매: 장착 무기 강화가 되면 강화 → 남은 잔불로 str · vit를 번갈아. 산 것의 목록을 돌려준다. */
function autoBuy(profile, progression, st) {
  const bought = [];
  while (progression.upgradeWeapon(profile.equippedWeapon).ok) bought.push('무기+1');
  for (;;) {
    const stat = st.alternate % 2 === 0 ? 'str' : 'vit';
    if (!progression.levelUp(stat).ok) break;
    bought.push(stat);
    st.alternate += 1;
  }
  return bought;
}

/**
 * 거리를 두는 플레이어(봇이 아니다 — 합성 입력): 보스에게서 9m 안이면 멀어지고, 밖이면 옆으로 돈다. 벽에 닿으면 벽을 따라간다.
 * 봇은 늘 붙어 싸워서 원거리 패턴(도약 · 돌진 · 불기둥)을 끌어내지 못한다 — 그 패턴들이 실제로 나오는지는 이 입력으로 본다.
 */
function runnerInput(state) {
  const p = state.player.pos;
  const b = state.boss.pos;
  const dx = p.x - b.x;
  const dz = p.z - b.z;
  const d = Math.hypot(dx, dz) || 1;
  let mx = d < 9 ? dx / d : -dz / d;
  let mz = d < 9 ? dz / d : dx / d;
  const r = Math.hypot(p.x, p.z);
  if (r > state.world.radius - 2) {
    const nx = p.x / r;
    const nz = p.z / r;
    const out = mx * nx + mz * nz;
    if (out > 0) {
      mx -= out * nx;
      mz -= out * nz;
      const l = Math.hypot(mx, mz);
      if (l < 0.1) {
        mx = -nz;
        mz = nx;
      } else {
        mx /= l;
        mz /= l;
      }
    }
  }
  return { ...NEUTRAL_INPUT, moveX: mx, moveZ: mz };
}

describe('W3 — 메타 루프 · 통계', () => {
  test('F 메타 루프 — 세 보스 · 순환 0 → 순환 1의 발더까지: 성장이 끊기지 않는다', () => {
    /** @type {Record<string, number[]>} */
    const attempts = {};
    const times = [];
    for (const seed of F_SEEDS) {
      const profile = makeTestProfile({ seed });
      const bus = new EventBus();
      const sim = new GameSim({ profile, bus });
      const progression = new Progression(profile, bus);
      const st = { alternate: 0 };
      const route = [...BOSS_IDS.map((id) => [id, 0]), ['valder', 1]];
      for (const [bossId, cycle] of route) {
        assert.equal(profile.cycle, cycle, `${bossId}에 닿았을 때의 순환`);
        assert.equal(profile.bosses[bossId].unlocked, true, `${bossId} 해금`);
        let killed = 0;
        for (let n = 1; n <= E_MAX_ATTEMPTS && !killed; n++) {
          const bot = createBot({ seed: seed * 1000 + cycle * 100 + n * 7 + BOSS_IDS.indexOf(bossId), dodgeChance: 0.55, aggression: 0.6 });
          const r = runFight({ profile, bossId, bot, maxTicks: MAX_300S, sim, bus });
          assert.ok(r.reward, `${bossId} ${n}회차: 300초 안에 끝나지 않았다`);
          times.push(r.fight.time);
          if (r.reward.victory) {
            killed = n;
          } else if (r.reward.damageFraction >= 0.30) {
            // 브리프 §2: 30%를 깎고 죽으면 반드시 한 점은 산다(순환이 올라도)
            assert.ok(affordableLevelUps(profile) >= 1,
              `${bossId} 순환 ${cycle}: f ${r.reward.damageFraction.toFixed(2)}로 죽었는데 레벨업을 못 산다(잔불 ${profile.embers})`);
          }
          autoBuy(profile, progression, st);
        }
        assert.ok(killed > 0, `시드 ${seed}: ${bossId}(순환 ${cycle})를 ${E_MAX_ATTEMPTS}회 안에 잡지 못했다`);
        (attempts[`${bossId}@${cycle}`] ??= []).push(killed);
      }
      assert.equal(profile.cycle, 1);
      assert.equal(profile.totals.kills, 4);
      assertFiniteDeep(sim.state);
    }
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    assert.ok(avg >= 55 && avg <= 150, `한 판 평균 ${avg.toFixed(0)}초 — 브리프의 60~150초에서 벗어났다`);
    for (const [key, list] of Object.entries(attempts)) console.log(`[F ${key}] 격파까지 ${list.join(' · ')}회`);
    console.log(`[F] ${times.length}판 · 한 판 평균 ${avg.toFixed(0)}초 (최소 ${Math.min(...times).toFixed(0)} · 최대 ${Math.max(...times).toFixed(0)})`);
  });

  for (const bossId of BOSS_IDS) {
    test(`G 통계 — ${bossId}: 교착 0 · 한 공격에 쏠리지 않는다 · 모든 공격이 나온다`, () => {
      const def = getBossDef(bossId);
      /** @type {Record<string, number>} */
      const used = {};
      let total = 0;
      let chaseTicks = 0;
      let fightTicks = 0;
      for (let seed = 1; seed <= 8; seed++) {
        const bus = new EventBus();
        const sim = new GameSim({ profile: aProfile(bossId, seed), bus });
        const off = bus.on(EV.BOSS_ATTACK_WINDUP, (p) => { used[p.attackId] = (used[p.attackId] ?? 0) + 1; total += 1; });
        const bot = createBot({ seed: seed * 7 + 1, dodgeChance: 0.55, aggression: 0.6 });
        sim.startBossFight(bossId);
        let lastDealt = 0;
        let lastTaken = 0;
        let quiet = 0;
        for (let t = 0; t < MAX_300S && sim.state.fight.phase !== 'done'; t++) {
          sim.step(DT, bot.decide(sim.state));
          const f = sim.state.fight;
          if (f.phase !== 'fight') continue;
          fightTicks += 1;
          if (sim.state.boss.state === 'chase') chaseTicks += 1;
          if (f.damageDealt !== lastDealt || f.damageTaken !== lastTaken) {
            lastDealt = f.damageDealt;
            lastTaken = f.damageTaken;
            quiet = 0;
          } else {
            quiet += 1;
            assert.ok(quiet < 30 * TICKS_PER_SEC, `시드 ${seed}: 30초 동안 양쪽 다 피해가 없다(교착)`);
          }
        }
        assert.equal(sim.state.fight.phase, 'done', `시드 ${seed}: 300초 안에 끝나지 않았다`);
        assertFiniteDeep(sim.state);
        off();
        sim.dispose();
      }
      const top = Object.entries(used).sort((a, b) => b[1] - a[1])[0];
      const botTotal = total;
      assert.ok(top[1] / botTotal <= 0.6, `${top[0]}가 ${(100 * top[1] / botTotal).toFixed(0)}% — 한 공격에 쏠렸다`);

      // 거리를 두는 플레이어(무적 · 2페이즈)를 상대로 60초 × 2 — 원거리 패턴이 나온다
      for (let seed = 1; seed <= 2; seed++) {
        const bus = new EventBus();
        const sim = new GameSim({ profile: makeTestProfile({ seed: seed + 20 }), bus });
        const off = bus.on(EV.BOSS_ATTACK_WINDUP, (p) => { used[p.attackId] = (used[p.attackId] ?? 0) + 1; total += 1; });
        sim.startBossFight(bossId);
        sim.setDebug({ godMode: true });
        for (let t = 0; t < 200 && sim.state.fight.phase !== 'fight'; t++) sim.step(DT, NEUTRAL_INPUT);
        sim.debugSetBossHpFraction(0.45);
        for (let t = 0; t < 60 * TICKS_PER_SEC; t++) sim.step(DT, runnerInput(sim.state));
        assert.equal(sim.state.boss.phase, 2);
        assertFiniteDeep(sim.state);
        off();
        sim.dispose();
      }
      assert.ok(total - botTotal >= 16, `달아나는 상대에게도 쉬지 않고 공격한다(120초에 ${total - botTotal}번)`);
      const never = Object.keys(def.attacks).filter((id) => !used[id]);
      assert.deepEqual(never, [], `한 번도 나오지 않은 공격: ${never.join(', ')}`);
      // 보스는 걷는다: 선호 거리 밖이면 고민하는 동안 다가오고(발더 · 펜리르), kite 보스는 물러난다(니힐)
      assert.ok(chaseTicks / fightTicks >= 0.01, `걷는 시간 ${(100 * chaseTicks / fightTicks).toFixed(1)}%`);
      console.log(`[G ${bossId}] 봇 8판 공격 ${botTotal}번 · 최다 ${top[0]} ${(100 * top[1] / botTotal).toFixed(0)}% · 걷는 시간 ${(100 * chaseTicks / fightTicks).toFixed(0)}% · 달아나는 상대 120초에 ${total - botTotal}번`);
    });
  }

  test('G 돌진: 일직선에 선 플레이어(godMode)를 밀고 가지 않고 지나친다 — 발더 thrust_charge · 펜리르 charge', () => {
    for (const [bossId, attackId, dist] of [['valder', 'thrust_charge', 8], ['fenrir', 'charge', 9]]) {
      const bus = new EventBus();
      const sim = new GameSim({ profile: makeTestProfile({ seed: 3 }), bus });
      sim.startBossFight(bossId, { hooks: { forceAttack: () => attackId } });
      sim.setDebug({ godMode: true });
      const s = sim.state;
      // 인트로를 넘기고 보스 정면 dist m에 세운다(보스는 π를 본다 = −Z 쪽)
      for (let i = 0; i < 200 && s.fight.phase !== 'fight'; i++) sim.step(DT, NEUTRAL_INPUT);
      s.player.pos.x = s.boss.pos.x;
      s.player.pos.z = s.boss.pos.z - dist;
      let started = false;
      let p0 = null;
      let b0 = null;
      for (let i = 0; i < 600; i++) {
        sim.step(DT, NEUTRAL_INPUT);
        const atk = s.boss.attack;
        if (!started && atk && atk.id === attackId) {
          started = true;
          p0 = { ...s.player.pos };
          b0 = { ...s.boss.pos };
        }
        if (started && !s.boss.attack) break;
      }
      assert.ok(started, `${attackId}가 시작되지 않았다`);
      const moveDist = getBossDef(bossId).attacks[attackId].move.dist;
      const along = Math.abs(s.player.pos.z - p0.z);
      assert.ok(along < 0.6, `${bossId}: 돌진 방향으로 ${along.toFixed(2)}m 밀렸다(W1에는 3~9m)`);
      assert.ok(Math.hypot(s.boss.pos.x - b0.x, s.boss.pos.z - b0.z) > moveDist - 0.5, `${bossId}: 보스가 끝까지 달렸다`);
      assert.ok(s.boss.pos.z < s.player.pos.z, `${bossId}: 보스가 플레이어를 지나쳤다`);
      assert.ok(Math.abs(s.player.pos.x - p0.x) > 0.5, `${bossId}: 플레이어는 옆으로 비켜났다`);
      assertFiniteDeep(s);
      sim.dispose();
    }
  });
});
