// OWNER: P1 — 계약 §6.8 · §12.1
// 자리 봇 — 지금 자리에서 캐스팅 · 챔질 · 파이팅 · 뜰채 · 어창/방생을 되풀이한다(걷기 · 이동 · 계획 없음).
// 사람이 보는 것(찌 · 초리 신호 · 게이지 · 결과 패널 · 채비 패널의 재고)만 읽고, 사람과 같은 InputFrame 과 UI 명령만 낸다.
// 읽지 않는 것: rig.bite · fight.speciesId · fight.k · fight.brain · biteInfo(). sim 에서는 getRigStats() 만 읽는다.
// bot/angler.js → bot/policy.js 단방향(§2.2).

import { makeRng, seedRng } from '../core/rng.js';
import { clamp } from '../core/math.js';
import { DT } from '../core/constants.js';
import { NEUTRAL_INPUT } from '../core/inputFrame.js';
import { BOT, PLAN } from '../data/bot.js';
import { CAST } from '../data/bite.js';
import { HOLD } from '../data/economy.js';
import { createFightPolicy } from './policy.js';

/** @typedef {import('../types.js').BotAction} BotAction */
/** @typedef {import('../types.js').InputFrame} InputFrame */

/**
 * @param {{strategy:string, seed:number, set?:string|null, baitId?:string|null, depthM?:number|null}} opts
 * @returns {{name:string, decide(state:Object, sim:Object): BotAction, reset():void}}
 */
export function createAngler({ strategy = 'basic', seed = 1, set = null, baitId = null, depthM = null } = /** @type {any} */ ({})) {
  const policy = createFightPolicy(/** @type {any} */ (strategy), seed);
  /** @type {{s:number}} */
  let rngState = seedRng(seed);
  let rng = makeRng(rngState);
  // 손의 기억(사람의 머릿속 — 게임 상태가 아니다)
  let prevPrimary = false;
  let lastPhase = '';
  let castTarget = 1;
  let prevPower = 0;
  let early = false;          // 이번 입질에 성급히 챔질할 것인가
  let reactLeft = -1;         // 신호를 본 뒤 Space 까지 남은 시간(s) — 음수면 아직 보지 못했다
  let hookSent = false;
  let depthWait = 0;          // 수심 눈금을 2틱에 한 번만(사람의 키 반복 속도)
  let pokeWait = 0;           // 미끼가 없을 때 다음에 좌클릭을 눌러 볼 때까지(s)

  /** @type {InputFrame} */
  const out = { ...NEUTRAL_INPUT };

  function reset() {
    rngState = seedRng(seed);
    rng = makeRng(rngState);
    prevPrimary = false;
    lastPhase = '';
    castTarget = 1;
    prevPower = 0;
    early = false;
    reactLeft = -1;
    hookSent = false;
    depthWait = 0;
    pokeWait = 0;
    policy.reset();
  }

  function sampleReact() {
    const r = BOT.react;
    return clamp(r.mean + r.sd * rng.normal(), r.min, r.max);
  }

  /** 보이는 재고에서 미끼를 고른다: 지정 미끼 → 지금 미끼 → 가장 많이 가진 미끼 @param {any} profile @param {string} cur */
  function chooseBait(profile, cur) {
    if (baitId && (profile.baits[baitId] ?? 0) > 0) return baitId;
    if ((profile.baits[cur] ?? 0) > 0) return cur;
    let best = null;
    let n = 0;
    for (const k of Object.keys(profile.baits)) {
      if (profile.baits[k] > n) { n = profile.baits[k]; best = k; }
    }
    return best;
  }

  /**
   * @param {any} state @param {any} sim @returns {BotAction}
   */
  function decide(state, sim) {
    const rig = state.rig;
    const player = state.player;
    Object.assign(out, NEUTRAL_INPUT);
    out.yaw = Number.isFinite(player.yaw) ? player.yaw : 0;
    out.pitch = Number.isFinite(player.pitch) ? player.pitch : 0;
    /** @type {import('../types.js').BotCommand|null} */
    let command = null;
    let primary = false;
    const phase = player.mode === 'fish' ? rig.phase : 'walk';
    const entered = phase !== lastPhase;
    lastPhase = phase;

    switch (phase) {
      case 'ready': {
        const cfg = state.profile.sets[rig.set];
        if (set && rig.set !== set) { out.selectSet = /** @type {any} */ (set); break; }
        const bait = chooseBait(state.profile, cfg.bait);
        if (bait && bait !== cfg.bait) { command = { name: 'setBait', args: [rig.set, bait] }; break; }
        if (rig.set === 'float' && typeof depthM === 'number' && Math.abs(rig.floatDepth - depthM) > CAST.depthStepM / 2) {
          if (depthWait > 0) depthWait--;
          else {
            out.depthSteps = rig.floatDepth < depthM ? 1 : -1;
            depthWait = 1;
          }
          break;
        }
        if (!rig.canCast) {
          // 미끼 · 라인이 없다 — 자리 봇은 살 수 없다(계획 봇이 맡는다). 미끼가 없으면 사람처럼 가끔 눌러 본다:
          // sim 이 첫 캐스팅 시도에 무료 미끼를 주거나(§5.6) CAST_BLOCKED 로 알린다(리뷰 수정 — 누르지 않으면 무료 미끼를 영영 받지 못했다)
          if (rig.castBlock === 'noBait' && !prevPrimary) {
            pokeWait -= DT;
            if (pokeWait <= 0) {
              pokeWait = PLAN.noBaitPokeS;
              primary = true;
            }
          }
          break;
        }
        pokeWait = 0;
        // ready 인데 손이 이미 버튼을 쥐고 있다(충전 중 자리를 떠났다가 같은 손으로 돌아왔다 — 누름이 충전을 시작하지 못했다):
        // 사람처럼 한 틱 떼었다가 다시 누른다(리뷰 수정 — 쥔 채로는 누름 에지가 영영 나오지 않아 몇 시간 서 있었다)
        if (prevPrimary) break;
        primary = true;                                  // 누름 → 다음 틱 charging
        break;
      }
      case 'charging': {
        if (entered) {
          const c = BOT.castPower;
          castTarget = clamp(c.target + c.sd * rng.normal(), 0, 1);
          prevPower = 0;
        }
        const p = rig.power;
        const falling = p < prevPower;                   // 꼭대기를 지났다 — 더 기다리면 짧아진다
        prevPower = p;
        primary = !(p >= castTarget || falling);
        break;
      }
      case 'bite': {
        if (entered) {
          early = rng.chance(BOT.earlyRate);
          reactLeft = -1;
          hookSent = false;
        }
        const sig = rig.signal;
        const seen = sig.kind === 'take' || (early && sig.kind === 'nibble');
        if (seen && reactLeft < 0 && !hookSent) reactLeft = sampleReact();
        if (reactLeft >= 0 && !hookSent) {
          reactLeft -= DT;
          if (reactLeft <= 0) {
            out.hook = true;
            hookSent = true;
          }
        }
        break;
      }
      case 'fighting': {
        if (entered) policy.reset();
        const rs = sim && typeof sim.getRigStats === 'function' ? sim.getRigStats() : null;
        const h = policy.decide(state, rs);
        primary = !!h.primary;
        out.secondary = !!h.secondary;
        out.dragSteps = h.dragSteps | 0;
        out.hook = !!h.hook;
        break;
      }
      case 'result': {
        const rec = state.pendingCatch;
        if (!rec) break;
        const hold = state.profile.hold;
        if (hold.length < HOLD.capacity) { command = { name: 'keepCatch', args: [{}] }; break; }
        let cheap = null;
        for (const c of hold) if (!cheap || c.price < cheap.price) cheap = c;
        command = cheap && rec.price > cheap.price
          ? { name: 'keepCatch', args: [{ swapUid: cheap.uid }] }
          : { name: 'releaseCatch', args: [] };
        break;
      }
      default:
        break;                                           // casting · waiting · retrieving · landing · failed · walk — 손을 놓고 본다
    }

    out.primary = primary;
    out.primaryPressed = primary && !prevPrimary;
    out.primaryReleased = !primary && prevPrimary;
    prevPrimary = primary;
    return { input: { ...out }, command };
  }

  return { name: 'angler', decide, reset };
}
