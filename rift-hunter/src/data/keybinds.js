// OWNER: P9 — 계약 §11.5 · §10.7 (시드 — P0 이 W0 에 계약 값으로 채웠다)
// 키는 event.code 로만 읽는다(한글 IME). Ctrl · Meta · Alt + 다른 키 조합은 쓰지 않는다(Alt 단독만).

export const KEYBINDS = {
  skill: ['Digit1', 'Digit2', 'Digit3', 'Digit4'], stand: ['ShiftLeft', 'ShiftRight'], potion: 'KeyQ', recall: 'KeyT',
  labels: ['AltLeft', 'AltRight'], inventory: 'KeyI', skills: 'KeyS', character: 'KeyC', map: 'Tab', analytics: 'Backquote', pause: 'Escape',
  confirm: ['Enter', 'NumpadEnter', 'Space'], up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', tabPrev: 'BracketLeft', tabNext: 'BracketRight',
};

export const PANEL_KEYS = {
  inventory: { sort: 'KeyZ', sell: 'KeyX', sellAll: 'KeyV', salvage: 'KeyD', stash: 'KeyF', lock: 'KeyL', area: 'KeyE' },
  blacksmith: { repair: 'KeyR' },
  skills: { bindRmb: 'KeyR' },
  general: { more: 'Equal', less: 'Minus' },
};

/** event.button */
export const MOUSE = { move: 0, skill0: 2 };
