// OWNER: P9 — 계약 §11.2
// 화면 상태 기계: boot → title ⇄ play. pause · 패널은 play 위의 오버레이(ui 스택).
// 전환 막: fade(true, out) → 일(work) → settle() → fade(false, in). 전환 중 다른 전환 요청은 무시하고(false),
// 들어온 일시정지 요청은 pendingPause 로 기억했다가 막이 걷힌 직후 그때도 포커스가 없거나 숨은 상태면 일시정지한다.

import { EV } from '../core/events.js';

/** 전환 막(초) — 합 1초 이내(브리프 §3.1) */
export const TRANSITION = { out: 0.45, in: 0.45 };
/** settle 의 상한(ms) — 숨은 탭에서도 걷힌다. W2 통합: 250 → 100(out 0.45 + 100ms + in 0.45 = 최악 1.0초 — 브리프 §3.1 「전환 1초」) */
export const SETTLE_MS = 100;
/** settle 이 기다리는 렌더 프레임 수 */
export const SETTLE_FRAMES = 2;

/** @typedef {'boot'|'title'|'play'} ScreenId */

/**
 * @param {{ui:{fade(on:boolean, dur:number):Promise<void>}, bus:import('../core/events.js').EventBus,
 *          settle:() => Promise<void>, onBusy?:(on:boolean) => void, onPendingPause?:() => void,
 *          onError?:(e:unknown) => void}} opts
 */
export function createScreens(opts) {
  const { ui, bus, settle } = opts;
  const onBusy = opts.onBusy || (() => {});
  const onPendingPause = opts.onPendingPause || (() => {});
  const onError = opts.onError || (() => {});
  /** @type {ScreenId} */
  let screen = 'boot';
  let busy = false;
  let pendingPause = false;
  /** @type {Promise<void>|null} */
  let current = null;

  const api = {
    /** @returns {ScreenId} */
    get screen() { return screen; },
    /** 전환 막이 진행 중인가 */
    get busy() { return busy; },
    get pendingPause() { return pendingPause; },

    /** 화면을 바로 바꾼다(막 없음) — SCREEN_CHANGED @param {ScreenId} to */
    go(to) {
      if (to === screen) return Promise.resolve();
      const from = screen;
      screen = to;
      bus.emit(EV.SCREEN_CHANGED, { from, to });
      return Promise.resolve();
    },

    /** 전환 중 일시정지 요청 — 막이 걷힌 뒤 다시 판단 */
    requestPause() {
      if (busy) pendingPause = true;
    },

    /**
     * 막을 내리고 work 를 한 뒤 걷는다. 이미 전환 중이면 무시(false).
     * @param {() => (void|Promise<void>)} work @param {{out?:number, in?:number}} [dur]
     * @returns {false|Promise<void>}
     */
    transition(work, dur = {}) {
      if (busy) return false;
      busy = true;
      onBusy(true);
      const out = Number.isFinite(dur.out) ? /** @type {number} */ (dur.out) : TRANSITION.out;
      const inn = Number.isFinite(dur.in) ? /** @type {number} */ (dur.in) : TRANSITION.in;
      const run = async () => {
        try {
          await ui.fade(true, out);
          await work();
          await settle();
        } catch (e) {
          onError(e);
        }
        try {
          await ui.fade(false, inn);
        } catch (e) {
          onError(e);
        }
        busy = false;
        current = null;
        onBusy(false);
        if (pendingPause) {
          pendingPause = false;
          onPendingPause();
        }
      };
      current = run();
      return current;
    },

    /** 진행 중인 전환이 끝날 때까지(없으면 바로) @returns {Promise<void>} */
    idle() {
      return current || Promise.resolve();
    },
  };
  return api;
}
