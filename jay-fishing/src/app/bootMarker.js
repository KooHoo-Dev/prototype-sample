// OWNER: P0 — 계약 §6.12 · §11.9 (W0 완성 · 아무도 고치지 않는다 — 진입점을 다시 써도 이 두 호출은 남는다)
// 부팅 표식 — npm run check:dist 가 <html data-game-ready="1"> / data-game-error 를 읽는다.

let readyMarked = false;

/** 첫 화면이 그려진 직후 한 번 */
export function markReady() {
  if (readyMarked) return;
  readyMarked = true;
  document.documentElement.dataset.gameReady = '1';
}

/** 부팅 실패 사유(200자까지) @param {unknown} reason */
export function markError(reason) {
  document.documentElement.dataset.gameError = String(reason).slice(0, 200);
}
