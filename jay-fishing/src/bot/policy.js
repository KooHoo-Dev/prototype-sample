// OWNER: P2 — 계약 §6.8 · §12.1
// 파이팅 한 틱의 손 — 전략 넷(basic · controlled · mindless · locked). 순수 · 다른 bot 파일을 import 하지 않는다(§2.2).
// 사람에게 보이는 값만 읽는다: fight.telegraph · behavior · tension · lineKg · lineEffKg · canNet · inSnag · rodLift(로드 각도) · rig 드랙 눈금.
// 읽지 않는 것: fight.speciesId · k · brain · stamina(지식 3 전) · rig.bite.
// 드랙은 BOT.dragEveryTicks 틱에 1눈금까지만 바꾼다(사람의 휠 속도) · 뜰채는 canNet 을 본 뒤 BOT.netReact.

import { DT } from '../core/constants.js';
import { clamp } from '../core/math.js';
import { BOT } from '../data/bot.js';

/** @typedef {'basic'|'controlled'|'mindless'|'locked'} BotStrategy */
/** @typedef {{primary:boolean, secondary:boolean, dragSteps:number, hook:boolean}} FightHand */

const STRATEGIES = ['basic', 'controlled', 'mindless', 'locked'];

/** 질주류 행동 · 예고(드랙을 풀어 줄 상황) */
function isRunLike(kind) {
  return kind === 'run' || kind === 'dive' || kind === 'jump';
}

/** 펌핑해도 되는 행동(휴식 · 버팀 · 방향 전환 — 다가오는 물고기는 감으며 세워 여유 줄을 거둔다) */
function isPumpable(kind) {
  return kind === 'rest' || kind === 'hold' || kind === 'turn' || kind === 'charge';
}

/**
 * 파이팅 한 틱의 손(§12.1).
 * @param {BotStrategy} strategy @param {number} seed
 * @returns {{decide(state:Object, rigStats:Object): FightHand, reset():void}}
 */
export function createFightPolicy(strategy, seed) {
  if (!STRATEGIES.includes(strategy)) throw new Error(`unknown fight strategy: ${strategy}`);
  void seed;   // 반응 시간은 고정값(BOT) — 무작위가 필요 없다(결정성은 sim 난수가 맡는다)

  let sinceDrag = 0;        // 마지막 드랙 조작 뒤 지난 틱
  let netSeenT = 0;         // canNet 을 본 뒤 지난 시간(s)
  let teleSeenT = 0;        // 지금 예고를 본 뒤 지난 시간(s)
  let runMode = false;      // 질주 대응(드랙을 풀어 둔 상태)
  let pumpUp = false;       // 로드를 세우는 중
  let cycleT = 0;           // mindless 펌핑 주기 타이머

  /** @type {FightHand} */
  const hand = { primary: false, secondary: false, dragSteps: 0, hook: false };

  function reset() {
    sinceDrag = BOT.dragEveryTicks;
    netSeenT = 0;
    teleSeenT = 0;
    runMode = false;
    pumpUp = false;
    cycleT = 0;
  }
  reset();

  /** 목표 눈금 쪽으로 손의 속도 안에서 한 눈금 */
  function stepToward(rig, rs, targetNotch) {
    sinceDrag += 1;
    const cur = rig.dragNotch;
    const want = clamp(targetNotch, 0, rs.dragNotches);
    if (want === cur || sinceDrag < BOT.dragEveryTicks) return 0;
    sinceDrag = 0;
    return want > cur ? 1 : -1;
  }

  /** kg → 가장 가까운 눈금 */
  function notchOf(rs, kg) {
    return Math.round(kg / rs.dragNotchKg);
  }

  /** 뜰채: canNet 을 BOT.netReact 동안 보고 Space */
  function netHand(fight) {
    if (fight.canNet) {
      netSeenT += DT;
      if (netSeenT >= BOT.netReact) {
        netSeenT = 0;
        return true;
      }
    } else {
      netSeenT = 0;
    }
    return false;
  }

  function decide(state, rigStats) {
    hand.primary = false;
    hand.secondary = false;
    hand.dragSteps = 0;
    hand.hook = false;
    const fight = state && state.fight;
    if (!fight) return { ...hand };
    const rig = state.rig;
    const rs = rigStats;
    const eff = fight.lineEffKg;
    hand.hook = netHand(fight);

    if (strategy === 'basic') {
      const p = BOT.basic;
      hand.dragSteps = stepToward(rig, rs, notchOf(rs, p.dragRatio * fight.lineKg));
      hand.primary = fight.tension < p.reelBelow * eff;
    } else if (strategy === 'locked') {
      hand.dragSteps = stepToward(rig, rs, notchOf(rs, BOT.locked.dragRatio * fight.lineKg));
      hand.primary = true;
    } else if (strategy === 'mindless') {
      hand.dragSteps = stepToward(rig, rs, rs.dragNotches);
      hand.primary = true;
      const [up, down] = BOT.mindless.pumpCycle;
      cycleT += DT;
      if (cycleT >= up + down) cycleT -= up + down;
      hand.secondary = cycleT < up;
    } else {
      const p = BOT.controlled;
      const tele = fight.telegraph;
      if (tele) teleSeenT += DT;
      else teleSeenT = 0;
      const teleRun = !!tele && tele.kind !== 'charge' && teleSeenT >= p.teleReact;
      // 질주 대응: 예고를 본 뒤(반응 시간) · 질주/잠수/점프 중. 예고 없는 다른 행동이 보이면 끝
      if (teleRun || (!tele && isRunLike(fight.behavior))) runMode = true;
      else if (!tele && !isRunLike(fight.behavior)) runMode = false;
      const rodMax = rs.rodMaxLoadKg;
      let targetKg;
      if (fight.inSnag) targetKg = p.snagDrag * eff;
      else if (runMode) targetKg = p.runDrag * eff;
      else targetKg = p.restDrag * eff;
      targetKg = Math.min(targetKg, rs.reelMaxDragKg, p.rodCap * rodMax);
      let targetNotch = Math.floor(targetKg / rs.dragNotchKg);
      if (fight.tension > p.panic * eff) targetNotch = Math.min(targetNotch, rig.dragNotch - 1);
      hand.dragSteps = stepToward(rig, rs, targetNotch);
      hand.primary = fight.tension < p.reelBelow * eff;
      // 펌핑 — 세우고 → 숙이며 감는 리듬
      const stopNow = fight.tension > p.pumpStop * rodMax || fight.rodLift >= 1
        || (!!tele && (tele.kind === 'run' || tele.kind === 'jump' || tele.kind === 'dive'))
        || (!tele && isRunLike(fight.behavior));
      if (pumpUp) {
        if (stopNow) pumpUp = false;
      } else if (fight.rodLift <= 0 && !stopNow && isPumpable(fight.behavior) && (!tele || tele.kind === 'charge')
        && fight.tension < p.pumpStart * Math.min(eff, rodMax)) {
        pumpUp = true;
      }
      hand.secondary = pumpUp;
    }
    return { ...hand };
  }

  return { decide, reset };
}
