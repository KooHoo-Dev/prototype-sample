// OWNER: P2 — 계약 §6.6 · §5.3.3 · §8.2
// 물고기 행동 상태 기계. 성격(STYLES) 표를 뼈대로 특성(TRAITS)을 데이터로 합치고(buildBrain),
// 파이팅 한 틱마다 상태를 민다(stepBrain). 어종 ID 문자열을 두지 않는다(§8.2 — fishBrain.test 가 훑는다).

import { EV } from '../../core/events.js';
import { FIGHT } from '../../data/fight.js';
import { LATERAL_DEFAULT, STYLES, TRAITS } from '../../data/fightStyles.js';

/** @typedef {import('../../types.js').SpeciesDef} SpeciesDef */
/** @typedef {import('../../types.js').BehaviorStateDef} BehaviorStateDef */
/** @typedef {import('../../types.js').FightState} FightState */
/** @typedef {import('../../types.js').SimCtx} SimCtx */
/** @typedef {{start:string, states:Record<string, BehaviorStateDef>, abrasionMul:number, visual:string[]}} Brain */

/** 예고를 거치는 kind → 예고 종류(§5.3.3). 그 밖의 kind 는 tele 가 있어도 바로 들어간다 */
const TELE_KIND = { run: 'run', jump: 'jump', charge: 'charge', dive: 'dive' };

/** @type {Map<string, Brain>} 어종 ID별 캐시(순수 — 같은 입력이면 같은 결과) */
const CACHE = new Map();

/** kind 의 기본 lateral(상태 정의에 lateral 이 없을 때) @param {string} kind */
export function defaultLateral(kind) {
  return LATERAL_DEFAULT[kind] ?? LATERAL_DEFAULT.other;
}

/** 상태 정의의 lateral(없으면 kind 기본값) @param {BehaviorStateDef} def */
export function lateralOf(def) {
  return def.lateral ?? defaultLateral(def.kind);
}

/** kind 가 질주류(run · dive)인가 — 체력에 따라 지속 시간이 줄고 뜰채 재질주의 대상 @param {string} kind */
function isRunKind(kind) {
  return kind === 'run' || kind === 'dive';
}

/**
 * §8.2 — 성격 표 + 특성(species.traits 순서) → 이 어종의 상태 기계 정의. 어종 ID별 캐시 · 순수.
 * 결과는 공유되므로 호출자가 고치지 않는다.
 * @param {SpeciesDef} species
 * @returns {Brain}
 */
export function buildBrain(species) {
  const key = species.id;
  if (key && CACHE.has(key)) return /** @type {Brain} */ (CACHE.get(key));
  const style = STYLES[species.style];
  if (!style) throw new Error(`unknown fight style: ${species.style}`);
  /** @type {Record<string, BehaviorStateDef>} */
  const states = structuredClone(style.states);
  let start = style.start;
  let abrasionMul = 1;
  /** @type {string[]} */
  const visual = [];
  for (const traitId of species.traits || []) {
    const tr = TRAITS[traitId];
    if (!tr) throw new Error(`unknown trait: ${traitId}`);
    if (tr.addStates) {
      for (const name of Object.keys(tr.addStates)) states[name] = structuredClone(tr.addStates[name]);
    }
    if (tr.addNext) {
      for (const from of Object.keys(tr.addNext)) {
        const st = states[from];
        if (!st) continue;                       // 출발 상태가 없으면 그 항목은 무시
        const add = tr.addNext[from];
        for (const to of Object.keys(add)) st.next[to] = (st.next[to] ?? 0) + add[to];
      }
    }
    if (tr.scaleByKind) {
      for (const name of Object.keys(states)) {
        const st = states[name];
        const sc = tr.scaleByKind[st.kind];
        if (!sc) continue;
        if (sc.f != null) st.f *= sc.f;
        if (sc.sp != null) st.sp *= sc.sp;
        if (sc.durMul != null) st.dur = [st.dur[0] * sc.durMul, st.dur[1] * sc.durMul];
        if (sc.lateral != null) st.lateral = lateralOf(st) * sc.lateral;
      }
    }
    if (tr.nextMulByKind) {
      for (const name of Object.keys(states)) {
        const next = states[name].next;
        for (const to of Object.keys(next)) {
          const dest = states[to];
          if (!dest) continue;
          const mul = tr.nextMulByKind[dest.kind];
          if (mul != null) next[to] *= mul;
        }
      }
    }
    if (tr.start) start = tr.start;
    if (tr.abrasionMul != null) abrasionMul *= tr.abrasionMul;
    if (tr.visual) visual.push(tr.visual);
  }
  /** @type {Brain} */
  const brain = { start, states, abrasionMul, visual };
  if (key) CACHE.set(key, brain);
  return brain;
}

/** 이 brain 의 첫 run 상태(없으면 첫 dive) — 뜰채 범위 재질주(§5.3.3) @param {Brain} brain @returns {string|null} */
export function firstRunState(brain) {
  let dive = null;
  for (const name of Object.keys(brain.states)) {
    const k = brain.states[name].kind;
    if (k === 'run') return name;
    if (k === 'dive' && dive === null) dive = name;
  }
  return dive;
}

/**
 * 상태에 들어간다(§5.3.3 enter) — 지속 시간 · 좌우 부호 · FIGHT_BEHAVIOR · 질주/점프 수.
 * fight.brain.entered = 이 틱에 들어갔다(updateFight 5 의 점프 · 흔들기 굴림이 읽는다).
 * @param {FightState} fight @param {Brain} brain @param {import('../../core/rng.js').Rng} rng @param {SimCtx} ctx @param {string} name
 */
export function enterState(fight, brain, rng, ctx, name) {
  const def = brain.states[name];
  const b = fight.brain;
  fight.behaviorName = name;
  fight.behavior = def.kind;
  fight.behaviorT = 0;
  const durMul = isRunKind(def.kind) ? FIGHT.runFatigueMin + (1 - FIGHT.runFatigueMin) * fight.stamina : 1;
  fight.behaviorDur = rng.range(def.dur[0], def.dur[1]) * durMul;
  b.state = name;
  b.lateralSign = rng.chance(0.5) ? 1 : -1;
  b.entered = true;
  b.pulseIdx = -1;
  if (isRunKind(def.kind)) fight.stats.runs += 1;
  else if (def.kind === 'jump') fight.stats.jumps += 1;
  ctx.emit(EV.FIGHT_BEHAVIOR, { kind: def.kind, name });
}

/**
 * 상태로 간다 — tele 가 있으면(예고 종류가 있는 kind) 예고를 먼저 건다(§5.3.3).
 * @param {FightState} fight @param {Brain} brain @param {import('../../core/rng.js').Rng} rng @param {SimCtx} ctx
 * @param {string} name @param {number} loose 예고에 들어갈 때 preTeleLoose 로 저장
 */
export function goToState(fight, brain, rng, ctx, name, loose) {
  const def = brain.states[name];
  const kind = TELE_KIND[def.kind];
  if (def.tele != null && def.tele > 0 && kind) {
    fight.telegraph = { kind, remaining: def.tele, total: def.tele };
    fight.brain.pending = name;
    fight.brain.preTeleLoose = loose;
    ctx.emit(EV.FIGHT_TELEGRAPH, { kind, lead: def.tele });
    return;
  }
  enterState(fight, brain, rng, ctx, name);
}

/** 시작 상태에 들어간다 — §5.3.1: 질주류(run · dive · jump · charge)면 FIGHT.startTele 예고를 거친다.
 * @param {FightState} fight @param {Brain} brain @param {import('../../core/rng.js').Rng} rng @param {SimCtx} ctx */
export function startBrain(fight, brain, rng, ctx) {
  const name = brain.start;
  const def = brain.states[name];
  const kind = TELE_KIND[def.kind];
  if (kind) {
    fight.behaviorName = name;
    fight.behavior = def.kind;
    fight.behaviorT = 0;
    fight.behaviorDur = 0;
    fight.brain.state = name;
    fight.brain.lateralSign = rng.chance(0.5) ? 1 : -1;
    fight.telegraph = { kind, remaining: FIGHT.startTele, total: FIGHT.startTele };
    fight.brain.pending = name;
    fight.brain.preTeleLoose = 0;
    ctx.emit(EV.FIGHT_TELEGRAPH, { kind, lead: FIGHT.startTele });
    return;
  }
  enterState(fight, brain, rng, ctx, name);
}

/**
 * §5.3.3 — 행동 상태 기계 한 틱. 예고 진행 · 지속 시간 끝의 가중치 뽑기 · 뜰채 범위 재질주.
 * @param {FightState} fight @param {Brain} brain @param {import('../../core/rng.js').Rng} rng
 * @param {number} dt @param {SimCtx} ctx @param {number} loose §5.3.2 1 의 값
 */
export function stepBrain(fight, brain, rng, dt, ctx, loose) {
  const b = fight.brain;
  if (fight.telegraph) {
    fight.telegraph.remaining -= dt;
    if (fight.telegraph.remaining <= 0) {
      const name = b.pending && brain.states[b.pending] ? b.pending : fight.behaviorName;
      fight.telegraph = null;
      b.pending = null;
      enterState(fight, brain, rng, ctx, name);
    }
  } else {
    fight.behaviorT += dt;
    if (fight.behaviorT >= fight.behaviorDur) {
      const cur = brain.states[fight.behaviorName];
      const next = (cur && rng.pick(cur.next)) || brain.start;
      goToState(fight, brain, rng, ctx, next, loose);
    }
  }
  // 뜰채 범위 재질주 — 체력이 남은 물고기는 뜰채 앞에서 한 번 더 달아난다
  if (fight.dist > fight.netRangeM + FIGHT.netRunReset) {
    b.netRunUsed = false;
  } else if (!b.netRunUsed && !fight.telegraph && fight.dist <= fight.netRangeM
    && fight.stamina > fight.landStamina && !isRunKind(fight.behavior)) {
    const name = firstRunState(brain);
    if (name) {
      b.netRunUsed = true;
      goToState(fight, brain, rng, ctx, name, loose);
    }
  }
}
