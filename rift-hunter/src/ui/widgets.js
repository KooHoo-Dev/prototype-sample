// OWNER: P10 — 계약 §10.1(공통 위젯) · §10.7(키보드만으로의 조작)
// P11 · P12 는 이것만 써서 같은 조작감을 낸다. DOM 은 함수 안에서만 만진다(Node 테스트가 import 한다).
//
// 키 흐름: app → ui.handleKey(e) → 맨 위 패널의 handleKey(e). 패널은 자기 nav 의 handleKey(e)를 부르면 된다.
//   패널이 false 를 돌려주면 UIRoot 가 그 패널 안의 nav(가장 최근에 쓴 것) · 탭 · data-hotkey 버튼에 한 번 더 넘긴다(dispatchFallback).
// 포커스 고리: 고른 칸에 class 'is-focus'(늘 보인다 — hud.css). 버튼은 DOM 포커스를 받지 않는다(키는 위 흐름으로만).

import { KEYBINDS } from '../data/keybinds.js';
import { t } from './i18n.js';

const CONFIRM = new Set(KEYBINDS.confirm);
const TAB_PREV = KEYBINDS.tabPrev;
const TAB_NEXT = KEYBINDS.tabNext;

/** 살아 있는 nav · 탭 컨트롤러(UIRoot 의 대체 경로가 찾는다) @type {Set<any>} */
const LIVE = new Set();
let useSeq = 0;
/** @type {any} UIRoot(confirm 이 쓴다) */
let boundRoot = null;

/** UIRoot 가 생성 때 부른다 — confirm() 이 확인 패널을 연다 @param {any} ui */
export function bindRoot(ui) { boundRoot = ui; }
/** UIRoot 가 dispose 때 부른다 @param {any} ui */
export function unbindRoot(ui) { if (boundRoot === ui) boundRoot = null; }

/**
 * 요소 하나 — el('div', 'cls', '문면')
 * @param {string} tag @param {string} [className] @param {string} [text] @returns {HTMLElement}
 */
export function el(tag, className = '', text = '') {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

/**
 * 제목 하나 있는 패널 틀 — section.panel[data-ui-block] > h2.panel-title
 * @param {string} titleKey @returns {HTMLElement}
 */
export function panelFrame(titleKey) {
  const root = document.createElement('section');
  root.className = 'panel ui-block';
  const h = document.createElement('h2');
  h.className = 'panel-title';
  h.textContent = t(titleKey);
  root.appendChild(h);
  return root;
}

/** 이 이벤트가 keydown 인가 @param {KeyboardEvent} e */
function isDown(e) { return !e.type || e.type === 'keydown'; }

/**
 * 격자 이동 — el 의 자식들이 칸(인덱스 = 행 × cols + 열). 방향키 · Enter(Space) · 포커스 고리 · 마우스(올리면 포커스 · 클릭 = 고르기).
 * opts.onFocus(i) — 포커스가 바뀔 때 · opts.onEdge(dir) → true 면 그 키를 먹은 것으로(옆 영역으로 넘기기 — §10.5-8) · opts.wrap.
 * @param {HTMLElement} el @param {number} cols @param {number} rows
 * @param {(i:number, via:'key'|'pointer') => void} onPick
 * @param {{onFocus?:(i:number) => void, onEdge?:(dir:'up'|'down'|'left'|'right') => boolean, wrap?:boolean, start?:number}} [opts]
 */
export function gridNav(el, cols, rows, onPick, opts = {}) {
  let c = Math.max(1, cols | 0);
  let r = Math.max(1, rows | 0);
  let index = -1;
  const count = () => Math.min(el.children.length, c * r);
  const ctl = {
    el,
    kind: 'grid',
    active: true,
    lastUse: 0,
    get index() { return index; },
    get cols() { return c; },
    get rows() { return r; },
    /** @param {number} i @param {boolean} [silent] onFocus 를 부르지 않는다 */
    focus(i, silent = false) {
      const n = count();
      if (!n) { index = -1; return; }
      const j = Math.max(0, Math.min(n - 1, i | 0));
      if (index >= 0 && index < el.children.length && index !== j) el.children[index].classList.remove('is-focus');
      index = j;
      const cell = el.children[j];
      cell.classList.add('is-focus');
      if (typeof cell.scrollIntoView === 'function' && el.scrollHeight > el.clientHeight) cell.scrollIntoView({ block: 'nearest' });
      ctl.lastUse = ++useSeq;
      if (!silent) opts.onFocus?.(j);
    },
    blur() {
      if (index >= 0 && index < el.children.length) el.children[index].classList.remove('is-focus');
    },
    /** 칸 수가 바뀌었다(다시 그린 뒤) @param {number} [nc] @param {number} [nr] */
    setSize(nc = c, nr = r) {
      c = Math.max(1, nc | 0);
      r = Math.max(1, nr | 0);
      ctl.refresh();
    },
    /** 다시 그린 뒤 포커스 고리를 다시 붙인다 */
    refresh() {
      const n = count();
      for (let k = 0; k < el.children.length; k++) el.children[k].classList.toggle('is-focus', k === index);
      if (index >= n) ctl.focus(n - 1, true);
    },
    /** @param {KeyboardEvent} e @returns {boolean} */
    handleKey(e) {
      const code = e.code;
      const nav = code === KEYBINDS.left || code === KEYBINDS.right || code === KEYBINDS.up || code === KEYBINDS.down;
      if (!nav && !CONFIRM.has(code)) return false;
      if (!isDown(e)) return true;
      const n = count();
      if (!n) return nav;
      if (index < 0) { ctl.focus(opts.start ?? 0); if (nav) return true; }
      if (CONFIRM.has(code)) { ctl.lastUse = ++useSeq; onPick?.(index, 'key'); return true; }
      const col = index % c;
      const row = Math.floor(index / c);
      /** @type {'up'|'down'|'left'|'right'} */
      const dir = code === KEYBINDS.left ? 'left' : code === KEYBINDS.right ? 'right' : code === KEYBINDS.up ? 'up' : 'down';
      let next = index;
      if (dir === 'left') next = col > 0 ? index - 1 : opts.wrap ? index + Math.min(c, n - row * c) - 1 : -1;
      else if (dir === 'right') next = col < c - 1 && index + 1 < n ? index + 1 : opts.wrap ? row * c : -1;
      else if (dir === 'up') next = row > 0 ? index - c : opts.wrap ? Math.min(n - 1, (Math.ceil(n / c) - 1) * c + col) : -1;
      else next = index + c < n ? index + c : opts.wrap ? col : -1;
      if (next < 0) {
        if (opts.onEdge?.(dir)) return true;
        return true;
      }
      ctl.focus(next);
      return true;
    },
    destroy() {
      LIVE.delete(ctl);
      el.removeEventListener('mouseover', onOver);
      el.removeEventListener('click', onClick);
    },
  };
  /** @param {Event} ev */
  const cellIndex = (ev) => {
    let node = /** @type {any} */ (ev.target);
    while (node && node.parentElement !== el) node = node.parentElement;
    if (!node) return -1;
    return Array.prototype.indexOf.call(el.children, node);
  };
  const onOver = (ev) => {
    const i = cellIndex(ev);
    if (i >= 0 && i < count() && i !== index) ctl.focus(i);
  };
  const onClick = (ev) => {
    const i = cellIndex(ev);
    if (i < 0 || i >= count()) return;
    ctl.focus(i);
    onPick?.(i, 'pointer');
  };
  el.addEventListener('mouseover', onOver);
  el.addEventListener('click', onClick);
  el.classList.add('nav-grid');
  LIVE.add(ctl);
  return ctl;
}

/**
 * 목록 이동 — el 의 자식들이 줄. ↑ ↓ · Enter(Space) · 마우스. opts 는 gridNav 와 같다(onEdge 는 'up'|'down'|'left'|'right').
 * @param {HTMLElement} el @param {(i:number, via:'key'|'pointer') => void} onPick
 * @param {{onFocus?:(i:number) => void, onEdge?:(dir:'up'|'down'|'left'|'right') => boolean, wrap?:boolean, start?:number}} [opts]
 */
export function listNav(el, onPick, opts = {}) {
  const ctl = gridNav(el, 1, 9999, onPick, { wrap: true, ...opts });
  ctl.kind = 'list';
  el.classList.add('nav-list');
  return ctl;
}

/**
 * 탭 — el 안에 탭 단추를 그린다(keys = 문자열 키 배열). `[` `]`(BracketLeft · BracketRight)로 바꾼다 · 클릭.
 * @param {HTMLElement} el @param {string[]} keys @param {(i:number) => void} [onChange]
 */
export function tabs(el, keys, onChange) {
  el.classList.add('tabs');
  el.textContent = '';
  /** @type {HTMLElement[]} */
  const btns = keys.map((k, i) => {
    const b = el.appendChild(document.createElement('button'));
    b.type = 'button';
    b.className = 'tab';
    b.tabIndex = -1;
    b.textContent = t(k);
    b.addEventListener('mousedown', (ev) => ev.preventDefault());
    b.addEventListener('click', () => ctl.select(i));
    return b;
  });
  let index = 0;
  const ctl = {
    el,
    kind: 'tabs',
    active: true,
    lastUse: 0,
    get index() { return index; },
    /** @param {number} i @param {boolean} [silent] */
    select(i, silent = false) {
      if (!btns.length) return;
      const j = ((i % btns.length) + btns.length) % btns.length;
      index = j;
      for (let k = 0; k < btns.length; k++) btns[k].classList.toggle('is-on', k === j);
      ctl.lastUse = ++useSeq;
      if (!silent) onChange?.(j);
    },
    /** @param {KeyboardEvent} e @returns {boolean} */
    handleKey(e) {
      if (e.code !== TAB_PREV && e.code !== TAB_NEXT) return false;
      if (isDown(e)) ctl.select(index + (e.code === TAB_NEXT ? 1 : -1));
      return true;
    },
    destroy() { LIVE.delete(ctl); },
  };
  ctl.select(0, true);
  LIVE.add(ctl);
  return ctl;
}

/**
 * 버튼 — 문면은 t(labelKey). hotkey(event.code)가 있으면 data-hotkey — 패널이 먹지 않은 그 키를 UIRoot 가 이 버튼의 클릭으로 바꾼다.
 * DOM 포커스를 받지 않는다(Space 키업이 다시 누르지 않게).
 * @param {string} labelKey @param {() => void} onClick @param {string} [hotkey] @param {Record<string, string|number>} [params]
 * @returns {HTMLButtonElement}
 */
export function button(labelKey, onClick, hotkey, params) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn';
  b.tabIndex = -1;
  if (labelKey) b.textContent = t(labelKey, params);
  if (hotkey) b.dataset.hotkey = hotkey;
  b.addEventListener('mousedown', (ev) => ev.preventDefault());
  b.addEventListener('click', () => { if (!b.disabled) onClick?.(); });
  return b;
}

/**
 * 막대 — el 안에 채움 막대를 만든다(el 이 없으면 새로). set(v 0..1, 문면?)
 * @param {HTMLElement} [host] @returns {{el:HTMLElement, fill:HTMLElement, set:(v:number, text?:string) => void}}
 */
export function bar(host) {
  const root = host ?? document.createElement('div');
  root.classList.add('bar');
  const fill = root.appendChild(document.createElement('div'));
  fill.className = 'bar-fill';
  const label = root.appendChild(document.createElement('div'));
  label.className = 'bar-text';
  let lastV = -1;
  let lastT = '';
  return {
    el: root,
    fill,
    set(v, text) {
      const x = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
      const q = Math.round(x * 1000) / 1000;
      if (q !== lastV) {
        lastV = q;
        fill.style.transform = `scaleX(${q})`;
      }
      if (text !== undefined && text !== lastT) {
        lastT = text;
        label.textContent = text;
      }
    },
  };
}

/**
 * 확인 패널(confirm — 모달)을 연다 → 예(Enter) true · 아니오(Escape) false. UIRoot 가 없으면 false.
 * @param {string} textKey @param {Record<string, string|number>} [params] @returns {Promise<boolean>}
 */
export function confirm(textKey, params) {
  const ui = boundRoot;
  if (!ui) return Promise.resolve(false);
  return new Promise((resolve) => {
    let done = false;
    const once = (v) => { if (!done) { done = true; resolve(!!v); } };
    if (!ui.openPanel('confirm', { textKey, params, resolve: once })) once(false);
  });
}

/**
 * UIRoot 의 대체 경로 — 패널이 먹지 않은 keydown 을 그 패널 안의 탭 · nav(가장 최근에 쓴 활성 nav) · data-hotkey 버튼에 넘긴다.
 * @param {HTMLElement} root 패널 el @param {KeyboardEvent} e @returns {boolean}
 */
export function dispatchFallback(root, e) {
  if (!root) return false;
  /** @type {any} */
  let bestNav = null;
  for (const c of LIVE) {
    if (!c.active || !c.el.isConnected || !root.contains(c.el)) continue;
    if (c.kind === 'tabs') {
      if (c.handleKey(e)) return true;
      continue;
    }
    if (!bestNav || c.lastUse > bestNav.lastUse) bestNav = c;
  }
  if (bestNav && bestNav.handleKey(e)) return true;
  if (!isDown(e) || !e.code) return false;
  const b = /** @type {HTMLButtonElement|null} */ (root.querySelector(`[data-hotkey="${e.code}"]`));
  if (b && !b.disabled && b.offsetParent !== null) {
    b.click();
    return true;
  }
  return false;
}
