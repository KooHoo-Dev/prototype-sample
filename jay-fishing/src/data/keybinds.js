// OWNER: P9 — 계약 §11.3
// SEED — P0 이 W0 에 계약 값 그대로 넣었다. 조정은 소유 패키지만 §7.0 규칙 안에서(🔒 값은 밸런스 게이트만).

// data/keybinds.js (P9 · 시드) — KeyboardEvent.code · 마우스 'Mouse0'(좌) 'Mouse1'(가운데) 'Mouse2'(우)
export const KEYBINDS = {
  forward: ['KeyW'], back: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
  interact: ['KeyE'], hook: ['Space'], bail: ['KeyR'],
  dragTighten: ['KeyZ'], dragLoosen: ['KeyC'],                // + 휠 ↑ 조이기 / 휠 ↓ 풀기 (브리프 §6)
  depthDeeper: ['ArrowUp'], depthShallower: ['ArrowDown'],
  setFloat: ['Digit1'], setBottom: ['Digit2'],
  tackle: ['Tab'], pause: ['Escape'], release: ['KeyX'],
  primary: ['Mouse0'], secondary: ['Mouse2'], lookDrag: ['Mouse1'],
};
export const WHEEL = { pxPerStep: 100, linePx: 33 };          // deltaY 100px = 1눈금 (DOM_DELTA_LINE은 ×33) · 누적해서 정수만 내보낸다
