// OWNER: P0 — 계약 §11.3 (완성)
// Ctrl은 쓰지 않는다(Ctrl+W = 탭 닫힘).

/** KeyboardEvent.code · 마우스는 'Mouse0'(좌) 'Mouse1'(휠) 'Mouse2'(우) */
export const KEYBINDS = {
  moveForward: ['KeyW', 'ArrowUp'], moveBack: ['KeyS', 'ArrowDown'],
  moveLeft: ['KeyA', 'ArrowLeft'],  moveRight: ['KeyD', 'ArrowRight'],
  light: ['Mouse0'], heavy: ['KeyF', 'Mouse1'], guard: ['Mouse2'],
  roll: ['Space'], sprint: ['ShiftLeft', 'ShiftRight'],
  lockOn: ['KeyQ', 'Tab'], flask: ['KeyR'], interact: ['KeyE'], pause: ['Escape'],
};

/** 표준 매핑 버튼 인덱스 */
export const GAMEPAD = {
  light: 5, heavy: 7, guard: 4, roll: 1, sprint: 1, lockOn: 11, flask: 2, interact: 0, pause: 9,
  deadzone: 0.18, lookSpeed: 900,  // 오른쪽 스틱 최대 기울임 = 초당 900픽셀 상당
  tapMax: 0.22,                    // B: 이 시간 안에 떼면 구르기, 넘기면 달리기
  navRepeat: 0.18,                 // 패널에서 D-pad/스틱을 누르고 있을 때 navigate 반복 간격(초)
};
