// OWNER: P9 — 계약 §11.2
// STUB — W0 스텁(빈 export). 화면 상태 기계(boot → title → play) · 전환 막은 P9.

/** 전환 막(초) — 합 1초 이내(브리프 §3.1) */
export const TRANSITION = { out: 0.45, in: 0.45 };

/**
 * STUB
 * @param {Object} opts @returns {{screen:string, go(to:string):Promise<void>}}
 */
export function createScreens(opts) {
  void opts;
  return { screen: 'boot', go() { return Promise.resolve(); } };
}
