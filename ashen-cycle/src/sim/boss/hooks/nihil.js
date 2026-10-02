// OWNER: P11 — 계약 §8.12 · §8.8 (훅)
// 니힐의 보스 전용 로직 — 나머지는 전부 data/bosses/nihil.js의 데이터로 프레임워크가 돌린다.
//   1. 부유: 매 틱 boss.y = hoverY (프레임워크는 높이를 모른다. 뷰는 이 값만큼 올라간 root 위에 몸을 그린다).
//   2. 밀착 대응: 플레이어가 crowdRange 안에 crowdTime 넘게 붙어 있으면 다음 선택에서 blink(쿨다운 0) 또는 void_nova를 강제한다.
//   (W3) 거리 벌리기(kite)는 프레임워크로 옮겼다 — 고민하는 동안 가까우면 물러난다(§8.6 「걸으며 고민」). 훅의 kiteT는 없앴다.
// 훅이 쓰는 것은 boss.ext · boss.y뿐이다(§8.8). 수치는 NIHIL_EXT에 있다.
import { NIHIL_EXT } from '../../../data/bosses/nihil.js';

/** @typedef {import('../../../types.js').BossHooks} BossHooks */
/** @typedef {import('../../../types.js').SimCtx} SimCtx */

/**
 * 플레이어까지의 중심 간 거리(m).
 * @param {SimCtx} ctx
 * @returns {number}
 */
function playerDist(ctx) {
  const b = ctx.state.boss.pos;
  const p = ctx.state.player.pos;
  return Math.hypot(p.x - b.x, p.z - b.z);
}

/** @type {BossHooks} */
export const nihilHooks = {
  onCreate(ctx) {
    const boss = ctx.state.boss;
    boss.ext.hoverY = NIHIL_EXT.hoverY;
    boss.ext.crowdT = 0;
    boss.y = NIHIL_EXT.hoverY;
  },

  onTick(ctx, dt) {
    const boss = ctx.state.boss;
    const ext = boss.ext;
    // 손수 만든 상태(onCreate를 거치지 않은 ext)도 받는다
    if (!(ext.hoverY >= 0)) ext.hoverY = NIHIL_EXT.hoverY;
    if (!(ext.crowdT >= 0)) ext.crowdT = 0;

    boss.y = ext.hoverY;

    if (boss.state !== 'dead' && playerDist(ctx) < NIHIL_EXT.crowdRange) ext.crowdT += dt;
    else ext.crowdT = 0;
  },

  forceAttack(ctx) {
    const boss = ctx.state.boss;
    const ext = boss.ext;
    if (!(ext.crowdT > NIHIL_EXT.crowdTime)) return null;
    ext.crowdT = 0;   // 다음 강제까지 다시 crowdTime을 센다
    return boss.cooldowns.blink > 0 ? 'void_nova' : 'blink';
  },
};
