// OWNER: P10 — 계약 §10.1(공통 위젯)
// STUB — W2 에서 P10 이 채운다(gridNav · listNav · tabs · button · bar · confirm). W0: panelFrame 만 실제 · 나머지는 빈 동작
// P11 · P12 는 이것만 써서 같은 조작감을 낸다. DOM 은 함수 안에서만 만진다(Node 테스트가 import 한다).

import { t } from './i18n.js';

/** 제목 하나 있는 패널 틀 @param {string} titleKey @returns {HTMLElement} */
export function panelFrame(titleKey) {
  const el = document.createElement('section');
  el.className = 'panel';
  const h = document.createElement('h2');
  h.className = 'panel-title';
  h.textContent = t(titleKey);
  el.appendChild(h);
  return el;
}

/** STUB — 격자 이동(방향키 · Enter · 포커스 고리) @returns {{destroy:() => void, focus:(i:number) => void}} */
export function gridNav(el, cols, rows, onPick) { return { destroy() {}, focus(i) {} }; }
/** STUB — 목록 이동 */
export function listNav(el, onPick) { return { destroy() {}, focus(i) {} }; }
/** STUB — 탭(BracketLeft · BracketRight) */
export function tabs(el, keys) { return { destroy() {}, select(i) {}, get index() { return 0; } }; }
/** STUB — 버튼 @returns {HTMLButtonElement} */
export function button(labelKey, onClick, hotkey) {
  const b = document.createElement('button');
  b.textContent = t(labelKey);
  b.addEventListener('click', () => onClick?.());
  return b;
}
/** STUB — 막대 */
export function bar(el) { return { set(v) {} }; }
/** STUB — 확인 패널 @returns {Promise<boolean>} */
export function confirm(textKey, params) { return Promise.resolve(false); }
