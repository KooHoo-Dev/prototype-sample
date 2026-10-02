// OWNER: P9 — 계약 §11.1
// 진입점. 조립은 전부 app/Game.js가 한다: 타이틀 → 마을 ⇄ 보스전 → 결과 루프 · 입력 · 저장 · 디버그 API(window.__ashen).
// 개발용 URL 쿼리(?boss= · ?town=1 · ?panel= · ?god=1 · ?bot=1 · ?fresh=1 · ?save=1 · ?nopause=1)는 README 「디버그」에 있다.
import { Game } from './app/Game.js';

try {
  new Game(document).start();
} catch (e) {
  // 부팅 표식(리포 규칙): 조립이 던지면 사유를 남긴다 — `npm run check:dist`가 읽는다
  document.documentElement.dataset.gameError = String((e && e.message) || e);
  throw e;
}
