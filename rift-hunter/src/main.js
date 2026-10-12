// OWNER: P9 — 계약 §11.1 · §11.11
// 진입점 — new Game(document).start() 만 한다. 부트 순서 · 루프 · 입력 · 저장 · 쿼리 · 디버그 API 는 src/app/*.
// 부팅 표식: Game 이 첫 프레임을 그린 직후 markReady · 실패면 markError(진입점을 다시 써도 남는다 — bootMarker.js).

import { markError } from './app/bootMarker.js';
import { Game } from './app/Game.js';

try {
  new Game(document).start();
} catch (e) {
  markError(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
  console.error(e);
}
