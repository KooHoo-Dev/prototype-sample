// OWNER: P9 — 계약 §11.1 · §11.9
// 진입점: new Game(document).start() 만 한다(예외는 markError). 부트 순서 · 루프 · 입력 · 저장 · 디버그 API 는 app/Game.js.

import { markError } from './app/bootMarker.js';
import { Game } from './app/Game.js';

try {
  new Game(document).start().catch((e) => markError(e && e.message ? e.message : String(e)));
} catch (e) {
  markError(e && /** @type {any} */ (e).message ? /** @type {any} */ (e).message : String(e));
  console.error(e);
}
