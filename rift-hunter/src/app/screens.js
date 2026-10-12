// OWNER: P9 — 계약 §11.3 · §5.12 · §11.13
// 화면 상태 기계(boot → title ⇄ play · 어디서든 → fatal) · step 을 부르는 조건 · 일시정지 사유(PAUSED) — 조건 판정은 순수 함수(테스트).

import { EV } from '../core/events.js';

/** @typedef {import('../types.js').ScreenId} ScreenId */
/** @typedef {import('../types.js').PanelId} PanelId */

export const SCREENS = ['boot', 'title', 'play', 'fatal'];
/** 허용 전환 — from → to 목록 */
const NEXT = { boot: ['title', 'play', 'fatal'], title: ['play', 'fatal'], play: ['title', 'fatal'], fatal: [] };
/** 일시정지 메뉴 계열(PAUSED reason 'menu') */
export const MENU_PANELS = ['pause', 'settings', 'help'];
/** 봇이 켜져 있어도 멈추는 패널(사람이 연 일시정지 · 분석 · 그 위의 확인 · 타이틀 계열 — §11.13) */
export const BOT_HALT_PANELS = ['pause', 'settings', 'help', 'confirm', 'analytics', 'title', 'charSelect', 'newChar'];

/**
 * @param {{bus?:{emit:(name:string, payload?:Object) => void}|null}} [deps]
 * @returns {{readonly current:ScreenId, go:(to:ScreenId) => boolean, is:(id:ScreenId) => boolean}}
 */
export function createScreens({ bus = null } = {}) {
  /** @type {ScreenId} */
  let cur = 'boot';
  return {
    get current() { return cur; },
    /** 허용된 전환이면 바꾸고 SCREEN_CHANGED{from, to} — 같은 화면이면 아무것도 하지 않는다(true) */
    go(to) {
      if (to === cur) return true;
      if (!SCREENS.includes(to) || !NEXT[cur].includes(to)) return false;
      const from = cur;
      cur = to;
      if (bus) bus.emit(EV.SCREEN_CHANGED, { from, to });
      return true;
    },
    is(id) { return cur === id; },
  };
}

/**
 * @typedef {Object} StepCond
 * @property {ScreenId} screen
 * @property {boolean} hasChar
 * @property {boolean} fading        전환 막
 * @property {boolean} hitstop
 * @property {boolean} hidden        탭 숨김
 * @property {boolean} blurred       포커스 잃음(봇이 켜져 있으면 부르는 쪽이 false 로 — 사람의 입력이 아니다)
 * @property {boolean} contextLost
 * @property {boolean} debugPaused   __game.pause(true)
 * @property {boolean} modal         ui.isModal()
 * @property {boolean} anyOpen       ui.anyOpen()
 * @property {PanelId|null} top      ui.topPanel()
 * @property {'town'|'rift'} scene
 * @property {boolean} bot
 */

/**
 * step 을 부르는가(§11.3 · §5.12) — play 에서만 · 전환 막 · 히트스톱 · 탭 숨김 · 포커스 잃음 · 컨텍스트 잃음 · 일시정지 · 모달 · 마을에서 어떤 패널이든 열림이면 아니다.
 * 봇이 켜져 있으면 「마을이면 anyOpen」과 모달 일반은 보지 않고, 사람이 연 일시정지 · 분석(BOT_HALT_PANELS)만 멈춘다.
 * @param {StepCond} c @returns {boolean}
 */
export function stepAllowed(c) {
  if (c.screen !== 'play' || !c.hasChar) return false;
  if (c.fading || c.hitstop || c.hidden || c.blurred || c.contextLost || c.debugPaused) return false;
  if (c.bot) return !(c.top && BOT_HALT_PANELS.includes(c.top));
  if (c.modal) return false;
  if (c.scene === 'town' && c.anyOpen) return false;
  return true;
}

/**
 * 지금의 일시정지 사유(PAUSED{reason}) — 없으면 null. 전환 막 · 히트스톱 · 마을 패널은 일시정지가 아니다(게임 시간만 멈춘다).
 * @param {Pick<StepCond, 'screen'|'hidden'|'blurred'|'contextLost'|'debugPaused'|'modal'|'top'>} c
 * @returns {'context'|'hidden'|'blur'|'debug'|'menu'|'modal'|null}
 */
export function pauseReason(c) {
  if (c.contextLost) return 'context';
  if (c.hidden) return 'hidden';
  if (c.blurred) return 'blur';
  if (c.debugPaused) return 'debug';
  if (c.screen !== 'play') return null;
  if (c.top && MENU_PANELS.includes(c.top)) return 'menu';
  if (c.modal) return 'modal';
  return null;
}
