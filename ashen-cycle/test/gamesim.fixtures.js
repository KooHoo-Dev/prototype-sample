// OWNER: P2 — combat.test.js · gamesim.test.js 공용 빌더.
// P1 · P3의 구현에 기대지 않게, GameSim의 진입점 이음매(sim._ops)를 중립/합성 함수로 갈아 끼우는 도구를 둔다.
import { EventBus } from '../src/core/events.js';
import { DT } from '../src/core/constants.js';
import { NEUTRAL_INPUT } from '../src/core/inputFrame.js';
import { GameSim } from '../src/sim/GameSim.js';
import { makeSynthBossDef, makeTestProfile } from './helpers.js';

/**
 * GameSim + 버스 + 발행 로그(발행 순서 그대로).
 * @param {{profile?:object, seed?:number}} [opts]
 */
export function makeSim(opts = {}) {
  const bus = new EventBus();
  /** @type {{name:string, payload:any}[]} */
  const log = [];
  bus.onAny((name, payload) => log.push({ name, payload }));
  const profile = opts.profile ?? makeTestProfile({ seed: 7 });
  const sim = new GameSim({ profile, bus, seed: opts.seed });
  return { sim, bus, log, profile };
}

/** P1 · P3의 틱 진입점을 전부 중립으로(플레이어 · 보스가 스스로 움직이지 않는다). */
export function neutralize(sim) {
  sim._ops.updatePlayer = () => {};
  sim._ops.bufferPlayerInput = () => {};
  sim._ops.getPlayerHit = () => null;
  sim._ops.updateBoss = () => {};
  sim._ops.getBossHits = () => [];
  sim._ops.getBossTelegraphs = () => [];
}

/**
 * 합성 보스와의 보스전을 시작해 fight.phase === 'fight'까지 돌린다(진입점은 중립).
 * @param {GameSim} sim
 * @param {object} [def]
 */
export function startNeutralFight(sim, def = makeSynthBossDef()) {
  neutralize(sim);
  sim.startBossFight(def.id, { def, hooks: {} });
  const limit = Math.ceil(def.introDur / DT) + 10;
  for (let i = 0; i < limit && sim.state.fight.phase !== 'fight'; i++) sim.step(DT, NEUTRAL_INPUT);
  endIntro(sim.state.boss);
  return def;
}

/** updateBoss가 중립이면 보스가 intro(무적)에 머문다 — P3가 인트로를 끝낸 모양으로 맞춰 둔다. */
export function endIntro(boss) {
  boss.state = 'idle';
  boss.stateTime = 0;
  boss.stateDur = 0;
  boss.invulnerable = false;
}

/** @param {GameSim} sim @param {number} n @param {object} [input] */
export function stepN(sim, n, input = NEUTRAL_INPUT) {
  for (let i = 0; i < n; i++) sim.step(DT, input);
}

/** 플레이어 판정 리터럴(§3.2 플레이어 채움 규칙). 기본 셰이프는 무조건 닿는 큰 원. */
export function playerHit(state, o = {}) {
  const p = state.player;
  return {
    source: 'player',
    attackId: 'light1',
    hitId: o.hitId ?? state.nextId++,
    shapeDef: { type: 'circle', r: 100 },
    x: p.pos.x,
    z: p.pos.z,
    facing: p.facing,
    damage: 20,
    posture: 10,
    guardable: false,
    parryable: false,
    knockdown: false,
    heavy: false,
    execute: false,
    hitstop: 0.05,
    ...o,
  };
}

/** 보스 판정 리터럴(§3.2 보스 채움 규칙). 원점 = 보스 위치. 기본 셰이프는 무조건 닿는 큰 원. */
export function bossHit(state, o = {}) {
  const b = state.boss;
  return {
    source: 'boss',
    attackId: 'synth_melee',
    hitId: o.hitId ?? state.nextId++,
    shapeDef: { type: 'circle', r: 100 },
    x: b.pos.x,
    z: b.pos.z,
    facing: b.facing,
    damage: 20,
    posture: 0,
    guardable: true,
    parryable: true,
    knockdown: false,
    heavy: false,
    execute: false,
    hitstop: 0,
    ...o,
  };
}

/** 진행 중인 공격 런타임 리터럴(§3.5 전 필드) — 보스가 'attack' 상태인 합성 상황용. */
export function attackRuntime(def, id = 'synth_melee') {
  const a = def.attacks[id];
  return {
    id,
    seq: 1,
    pose: a.pose,
    glow: a.glow,
    phase: 'active',
    phaseT: 0.5,
    t: a.windup + a.active / 2,
    windup: a.windup,
    active: a.active,
    recovery: a.recovery,
    locked: true,
    aimX: 0,
    aimZ: 0,
    chained: false,
    fired: [],
    hitIds: a.hits.map(() => 0),
  };
}

/** 로그에서 이름만. */
export const names = (log) => log.map((e) => e.name);

/** 이름으로 거른 payload 목록. */
export const payloads = (log, name) => log.filter((e) => e.name === name).map((e) => e.payload);
