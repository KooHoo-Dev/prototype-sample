// OWNER: P10 — 계약 §6.8 · §12.1
// 계획 봇 — 자리에서는 createAngler(P1)에 그대로 맡기고(파이팅은 그 안의 createFightPolicy — P2), 걷기 · 이동 · 판매 · 구매 · 스킬 · 수면만 더한다.
// 사람과 같은 것만 낸다: 매 틱 InputFrame 하나 + (있으면) UI 가 부르는 것과 같은 명령 하나(§6.8 목록).
// 명령은 그 패널을 사람이 열 수 있는 상황에서만: 판매 · 구매 · 감기 · 이동 · 수면은 그 상호작용 점 앞에서 E 를 누른 뒤,
// 장착 · 스킬은 채비 패널이 열리는 단계(걷기 · ready)에서, keep/release 는 결과 단계에서(angler), exitFishing 은 낚시 모드에서.
// 읽는 것: 상태 · 데이터 표 · getRigStats · getTravel. 읽지 않는 것: rig.bite · fight.speciesId · k · brain · stamina · biteInfo().
// bot/bot.js → bot/angler.js → bot/policy.js 단방향(§2.2).

import { NEUTRAL_INPUT } from '../core/inputFrame.js';
import { DT, TICKS_PER_DAY, TICKS_PER_HOUR } from '../core/constants.js';
import { yawOf } from '../core/math.js';
import { PLAN } from '../data/bot.js';
import { getStage, SPOTS_BY_ID, stageOfSpot } from '../data/stages/index.js';
import { createAngler } from './angler.js';
import { createPlanner } from './planner.js';

/** @typedef {import('../types.js').BotAction} BotAction */
/** @typedef {import('../types.js').BotCommand} BotCommand */
/** @typedef {import('../types.js').InputFrame} InputFrame */
/** @typedef {import('./planner.js').Goal} Goal */

/** exitFishing 이 되는 단계(§5.2 — 입질 · 파이팅 · 랜딩 · 결과 중에는 끝까지 한다) */
const EXITABLE = ['idle', 'ready', 'charging', 'casting', 'waiting', 'retrieving', 'failed'];
/** 자리 봇을 바꿔 끼워도 되는 단계(손이 비어 있다 — 충전 · 입질 · 파이팅 · 랜딩 · 결과 도중에는 같은 손이 끝낸다) */
const SWAP_OK = ['idle', 'ready', 'casting', 'waiting', 'retrieving', 'failed'];
/** 걷기 목표 → 그 씬의 상호작용 점 종류 */
const POINT_OF = { sell: 'npc', buy: 'pc', sleep: 'bed' };

/** 문자열 → 32비트 해시(자리 봇 시드를 갈라 쓴다) @param {string} s */
function strHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * @param {{strategy:'basic'|'controlled'|'mindless'|'locked', seed:number, plan:'lakeDay'|'coastDay'|'riverDay'|'progress'|'stay', spotId?:string, set?:string, baitId?:string}} opts
 * @returns {{name:string, decide(state:Object, sim:Object): BotAction, reset():void}}
 */
export function createBot(opts) {
  const { strategy = 'basic', seed = 1, plan = 'stay', spotId = null, set = null, baitId = null } = opts || /** @type {any} */ ({});
  const planner = createPlanner(/** @type {any} */ (plan), { spotId, set, baitId });
  /** @type {Map<string, ReturnType<typeof createAngler>>} */
  const anglers = new Map();
  /** 지금 손에 쥔 자리 봇(Goal 이 바뀌어도 손이 빌 때까지 이것이 끝낸다) */
  let hand = /** @type {ReturnType<typeof createAngler>|null} */ (null);

  // 걷기 · 패널의 기억
  /** @type {{scene:string, id:string, tried:Set<string>}|null} */
  let panel = null;          // E 로 연 상호작용 점(그 앞을 떠나면 닫힌다)
  let pressedE = false;      // 지난 틱에 E 를 눌렀다(에지 — 연달아 누르지 않는다)
  let stuckT = 0;
  let stuckRef = Infinity;
  let sideStepT = 0;
  /** 실패한 곁일(장착 · 스킬)의 키 → 그때의 절대 틱(같은 것을 틱마다 되풀이하지 않는다) */
  const sideFail = new Map();
  let absNow = 0;

  /** @type {InputFrame} */
  const out = { ...NEUTRAL_INPUT };

  function reset() {
    anglers.clear();
    hand = null;
    panel = null;
    pressedE = false;
    stuckT = 0;
    stuckRef = Infinity;
    sideStepT = 0;
    sideFail.clear();
    planner.reset();
  }

  /** Goal 에 맞는 자리 봇(세트 · 미끼 · 수심이 같으면 같은 것) @param {any} g */
  function anglerFor(g) {
    const key = `${g.set}|${g.baitId}|${g.depthM ?? ''}`;
    let a = anglers.get(key);
    if (!a) {
      a = createAngler({ strategy, seed: (seed * 7919 + strHash(key)) >>> 0, set: g.set, baitId: g.baitId, depthM: g.depthM });
      anglers.set(key, a);
    }
    return a;
  }

  /** 입력을 중립으로(시선은 지금 값 그대로) @param {any} player */
  function neutral(player) {
    Object.assign(out, NEUTRAL_INPUT);
    out.yaw = Number.isFinite(player.yaw) ? player.yaw : 0;
    out.pitch = Number.isFinite(player.pitch) ? player.pitch : 0;
  }

  /** @param {BotCommand|null} command @returns {BotAction} */
  function act(command) {
    return { input: { ...out }, command };
  }

  /**
   * (x, z)로 곧게 걷는다(yaw = 목표 방향 · moveZ). arrive m 안에 닿았으면 true.
   * @param {any} player @param {number} x @param {number} z @param {number} [arrive]
   */
  function walkTo(player, x, z, arrive = PLAN.arriveM) {
    const dx = x - player.pos.x;
    const dz = z - player.pos.z;
    const d = Math.hypot(dx, dz);
    if (d <= arrive) {
      stuckT = 0;
      stuckRef = Infinity;
      return true;
    }
    panel = null;
    out.yaw = yawOf(dx, dz);
    out.pitch = 0;
    out.moveZ = d > PLAN.slowM ? 1 : Math.max(0.25, d / PLAN.slowM);
    // 막혔으면(장애물 원 · 벽 모서리) 잠깐 옆걸음
    if (d < stuckRef - 0.2) { stuckRef = d; stuckT = 0; } else stuckT += DT;
    if (stuckT > PLAN.stuckS) { sideStepT = 0.6; stuckT = 0; stuckRef = d; }
    if (sideStepT > 0) { sideStepT -= DT; out.moveX = 1; }
    return false;
  }

  /** 씬의 그 종류 상호작용 점 @param {string} scene @param {string} kind */
  function pointOf(scene, kind) {
    const pts = getStage(scene).points || [];
    for (const p of pts) if (p.kind === kind) return p;
    return null;
  }

  /**
   * 상호작용 점까지 걸어가 그쪽을 보고 E — 패널이 열렸으면 true(이 틱에는 입력만).
   * @param {any} state @param {any} point
   */
  function openPanel(state, point) {
    const player = state.player;
    if (panel && panel.scene === state.scene && panel.id === point.id && player.nearby && player.nearby.id === point.id) return true;
    // approach 는 반경 안쪽 끝에 가까운 점도 있다(집의 문 1.0m · 반경 1.2m) — 0.3m 앞에서 멈추면 반경 밖일 수 있어 approach 까지 간다
    if (!walkTo(player, point.approach.x, point.approach.z, PLAN.arriveM / 3)) return false;
    out.yaw = yawOf(point.x - player.pos.x, point.z - player.pos.z);
    out.pitch = 0;
    if (pressedE) { pressedE = false; return false; }   // 에지를 한 틱 떼었다가
    out.interact = true;
    pressedE = true;
    // 이 틱의 입력으로 sim 이 nearby 를 고르고 INTERACT 를 낸다 — 다음 틱에 nearby 로 확인한다
    panel = { scene: state.scene, id: point.id, tried: new Set() };
    return false;
  }

  /** 곁일: 스킬 · 장착(채비 패널 — 걷기 또는 ready 에서) @param {any} state @param {Goal|null} goal @returns {BotCommand|null} */
  function sideCommand(state, goal) {
    const sk = planner.skill(state);
    if (sk) {
      const key = 'skill|' + sk + '|' + state.profile.skillPoints;
      if (!recentFail(key)) { sideFail.set(key, absNow); return { name: 'learnSkill', args: [sk] }; }
    }
    for (const [s, slot, id] of planner.equips(state, goal)) {
      const key = `equip|${s}|${slot}|${id}|${state.profile.owned[id] ?? 0}`;
      if (recentFail(key)) continue;
      sideFail.set(key, absNow);
      return { name: 'equip', args: [s, slot, id] };
    }
    return null;
  }

  /** @param {string} key */
  function recentFail(key) {
    const t = sideFail.get(key);
    return t !== undefined && absNow - t < PLAN.retryHours * TICKS_PER_HOUR;
  }

  /**
   * @param {any} state @param {any} sim @returns {BotAction}
   */
  function decide(state, sim) {
    const player = state.player;
    const rig = state.rig;
    absNow = state.clock.day * TICKS_PER_DAY + state.clock.tickInDay;
    const goal = planner.next(state, sim);
    neutral(player);

    // ── 낚시 모드
    if (player.mode === 'fish') {
      const phase = rig.phase;
      const here = goal && goal.kind === 'fish' && goal.spotId === player.spotId;
      if (here) {
        const a = anglerFor(goal);
        if (a !== hand && (!hand || SWAP_OK.includes(phase))) hand = a;
        if (phase === 'ready' && hand === a) {
          const side = sideCommand(state, goal);
          if (side) return act(side);
        }
        return hand.decide(state, sim);
      }
      // 다른 곳으로 간다 — 손이 비면 일어난다
      if (EXITABLE.includes(phase)) {
        hand = null;
        return act({ name: 'exitFishing', args: [] });
      }
      if (!hand) {
        // 세이브를 불러온 직후처럼 쥔 손이 없으면 지금 Goal 과 무관한 기본 손으로 끝낸다
        hand = anglerFor({ set: rig.set, baitId: state.profile.sets[rig.set].bait, depthM: null });
      }
      return hand.decide(state, sim);
    }

    // ── 걷기 모드
    hand = null;
    if (!goal) return act(null);
    const side = sideCommand(state, goal);
    if (side) return act(side);

    switch (goal.kind) {
      case 'fish': {
        const spot = SPOTS_BY_ID[goal.spotId];
        if (!spot || stageOfSpot(goal.spotId) !== state.scene) return act(null);
        if (walkTo(player, spot.stand.x, spot.stand.z)) {
          if (pressedE) { pressedE = false; return act(null); }
          out.interact = true;
          pressedE = true;
        } else pressedE = false;
        return act(null);
      }
      case 'skill':
        return act({ name: 'learnSkill', args: [goal.skillId] });
      case 'walkTo':
        walkTo(player, goal.x, goal.z);
        return act(null);
      case 'travel':
      case 'sell':
      case 'buy':
      case 'sleep': {
        const kind = goal.kind === 'travel' ? (state.scene === 'home' ? 'door' : 'camp') : POINT_OF[goal.kind];
        const point = pointOf(state.scene, kind);
        if (!point) return act(null);
        if (!openPanel(state, point)) return act(null);
        pressedE = false;
        if (goal.kind === 'travel') return act({ name: 'travel', args: [goal.to] });
        if (goal.kind === 'sleep') return act({ name: 'sleep', args: [] });
        const at = goal.kind === 'sell' ? 'vendor' : 'pc';
        const c = planner.command(state, at, panel.tried);
        if (!c) {
          planner.done(state, at);
          panel = null;
          return act(null);
        }
        panel.tried.add(c.key);
        return act({ name: c.name, args: c.args });
      }
      default:
        return act(null);
    }
  }

  return { name: `bot:${plan}:${strategy}`, decide, reset };
}
