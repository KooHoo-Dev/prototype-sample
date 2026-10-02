// OWNER: P8 — ui 내부 도우미(DOM 생성 · 숫자 표기 · 키 이름). 다른 패키지는 import하지 않는다.
import { t, hasStr } from './i18n.js';

/**
 * 요소 하나를 만든다.
 * @param {string} tag
 * @param {string} [cls]
 * @param {string|number} [text]
 * @returns {HTMLElement}
 */
export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = String(text);
  return e;
}

/**
 * 자식을 차례로 붙이고 부모를 돌려준다(null · undefined · false는 건너뛴다).
 * @param {HTMLElement} parent
 * @param {...(HTMLElement|null|undefined|false)} children
 * @returns {HTMLElement}
 */
export function add(parent, ...children) {
  for (const c of children) if (c) parent.appendChild(c);
  return parent;
}

/** @param {HTMLElement} node */
export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** 유한한 수가 아니면 0. @param {*} v @returns {number} */
export function num(v) {
  return Number.isFinite(v) ? v : 0;
}

/** 0..1로 자른다(NaN → 0). @param {number} v @returns {number} */
export function clamp01(v) {
  return v > 0 ? (v < 1 ? v : 1) : 0;
}

/** 정수 + 천 단위 쉼표. @param {number} n @returns {string} */
export function fmtInt(n) {
  const s = String(Math.round(num(n)));
  return s.length > 3 ? s.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : s;
}

/** 소수 자리를 정해 쓰되 끝의 0은 뗀다(1.50 → 1.5, 3.00 → 3). @param {number} n @param {number} digits @returns {string} */
export function fmtNum(n, digits) {
  return String(Number(num(n).toFixed(digits)));
}

/** 비율 0..1 → '37%'. @param {number} f @returns {string} */
export function fmtPct(f) {
  return `${Math.round(num(f) * 100)}%`;
}

/** 배율 → '×1.25'. @param {number} m @returns {string} */
export function fmtMul(m) {
  return `×${num(m).toFixed(2)}`;
}

/** 초 → 'm:ss'. @param {number} sec @returns {string} */
export function fmtTime(sec) {
  const s = Math.max(0, Math.round(num(sec)));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * KeyboardEvent.code · 'Mouse0' 같은 바인딩 이름을 화면 표기로.
 * @param {string} code
 * @returns {string}
 */
export function keyLabel(code) {
  if (hasStr(`key.${code}`)) return t(`key.${code}`);
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}

/**
 * 바인딩 목록을 ' / '로 잇는다(같은 표기는 한 번만 — ShiftLeft · ShiftRight).
 * @param {string[]} codes
 * @returns {string}
 */
export function keysLabel(codes) {
  const out = [];
  for (const c of codes ?? []) {
    const label = keyLabel(c);
    if (!out.includes(label)) out.push(label);
  }
  return out.join(' / ');
}
