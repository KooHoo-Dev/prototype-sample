// OWNER: P8 — 계약 §10 (UIRoot 내부 — 다른 패키지는 import 하지 않는다)
// DOM 도우미 · 숫자 서식 · 패널 바탕 클래스(키보드 목록 · 탭) · 전/후 비교 줄.
// 문면은 전부 t() — 이 파일에 한국어 리터럴을 두지 않는다(purity.test).

import { t } from './i18n.js';

// ── DOM

/**
 * @param {string} tag @param {string} [cls] @param {string} [text]
 * @returns {HTMLElement}
 */
export function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}

/**
 * 마우스로 눌러도 DOM 포커스를 가져가지 않는 버튼(Space · Enter 가 브라우저 기본 클릭으로 새지 않게)
 * @param {string} cls @param {string} text @param {(e:MouseEvent) => void} onClick @returns {HTMLButtonElement}
 */
export function btn(cls, text, onClick) {
  const b = /** @type {HTMLButtonElement} */ (el('button', cls, text));
  b.type = 'button';
  b.tabIndex = -1;
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', onClick);
  return b;
}

/** 바뀐 때만 쓴다 @param {HTMLElement} node @param {string} s */
export function setText(node, s) {
  const n = /** @type {any} */ (node);
  if (n._t !== s) {
    n._t = s;
    node.textContent = s;
  }
}

/** @param {HTMLElement} node @param {boolean} hidden */
export function setHidden(node, hidden) {
  if (node.hidden !== hidden) node.hidden = hidden;
}

/** @param {HTMLElement} node @param {string} cls @param {boolean} on */
export function setClass(node, cls, on) {
  if (node.classList.contains(cls) !== on) node.classList.toggle(cls, on);
}

/** style 한 속성을 바뀐 때만 @param {HTMLElement} node @param {string} prop @param {string} v */
export function setStyle(node, prop, v) {
  const n = /** @type {any} */ (node);
  const k = '_s_' + prop;
  if (n[k] !== v) {
    n[k] = v;
    node.style.setProperty(prop, v);
  }
}

// ── 숫자 서식(Intl.NumberFormat('ko-KR') — §10.1)

/** @type {Map<number, Intl.NumberFormat>} */
const FMT = new Map();
/** @param {number} digits @returns {Intl.NumberFormat} */
function fmtOf(digits) {
  let f = FMT.get(digits);
  if (!f) {
    f = new Intl.NumberFormat('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    FMT.set(digits, f);
  }
  return f;
}

/** 유한수가 아니면 0 @param {number} n @param {number} [digits] @returns {string} */
export function fmt(n, digits = 0) {
  const v = Number.isFinite(n) ? n : 0;
  return fmtOf(digits).format(digits === 0 ? Math.round(v) : v);
}

/** 원 @param {number} n */
export function won(n) { return t('hud.won', { n: fmt(n) }); }

/** @param {number} ratio 0..1 @returns {string} */
export function pct(ratio) { return fmt((Number.isFinite(ratio) ? ratio : 0) * 100) + '%'; }

// ── 결과 사유(§0.5)

/** @param {string|null|undefined} reason @param {Object|null|undefined} params @returns {string} */
export function reasonText(reason, params) {
  if (!reason) return '';
  return t('reason.' + reason, params || {});
}

// ── RigStats 전/후 비교(QUALITY §3 — 상점 · 채비)

/** [필드, 문자열 키, 소수 자리, 단위 키, 낮을수록 좋다] */
const RIG_ROWS = [
  ['castMaxM', 'stat.cast', 1, 'unit.m', false],
  ['rodMaxLoadKg', 'stat.rodLoad', 1, 'unit.kg', false],
  ['reelMaxDragKg', 'stat.maxDrag', 1, 'unit.kg', false],
  ['reelSpeedMS', 'stat.reelSpeed', 2, 'unit.ms', false],
  ['spoolCapM', 'stat.spool', 0, 'unit.m', false],
  ['lineKg', 'stat.lineKg', 1, 'unit.kg', false],
  ['lineBiteMul', 'stat.lineBite', 2, 'unit.x', false],
  ['lineAbrasionMul', 'stat.lineAbrasion', 2, 'unit.x', true],
  ['signalMul', 'stat.signal', 2, 'unit.x', false],
  ['sinkerHoldMS', 'stat.sinkerHold', 1, 'unit.ms', false],
  ['hookSize', 'stat.hookSize', 0, '', null],
];

/** @param {string} unitKey @param {string} s */
function withUnit(unitKey, s) { return unitKey ? t(unitKey, { v: s }) : s; }

/** @param {string} field @param {number} v */
function rigValue(field, v, digits, unitKey) {
  if (field === 'hookSize') return t('hookSize.' + v);
  return withUnit(unitKey, fmt(v, digits));
}

/**
 * 바뀌는 값만 줄로 — 「라벨 현재 → 바꾸면」(오르면 초록 · 내리면 주황). 바뀌는 것이 없으면 「변화 없음」.
 * @param {Object|null} before RigStats @param {Object|null} after RigStats
 * @returns {HTMLElement}
 */
export function rigCompare(before, after) {
  const box = el('div', 'cmp');
  if (!before || !after) return box;
  let rows = 0;
  for (const [field, key, digits, unitKey, lowerBetter] of RIG_ROWS) {
    const a = /** @type {any} */ (before)[field];
    const b = /** @type {any} */ (after)[field];
    if (typeof a !== 'number' || typeof b !== 'number') continue;
    if (Math.abs(a - b) < 1e-9) continue;
    box.append(cmpRow(t(/** @type {string} */ (key)), rigValue(/** @type {string} */ (field), a, digits, unitKey), rigValue(/** @type {string} */ (field), b, digits, unitKey), lowerBetter === null ? 0 : (b > a) !== lowerBetter ? 1 : -1));
    rows++;
  }
  if (!rows) box.append(el('span', 'cmp-none', t('stat.noChange')));
  return box;
}

/** RigStats 요약(현재 값만) @param {Object} rs RigStats @param {string[]} fields @returns {HTMLElement} */
export function rigSummary(rs, fields) {
  const box = el('div', 'cmp cmp-summary');
  for (const [field, key, digits, unitKey] of RIG_ROWS) {
    if (!fields.includes(/** @type {string} */ (field))) continue;
    const v = /** @type {any} */ (rs)[field];
    if (typeof v !== 'number') continue;
    const row = el('span', 'cmp-row');
    row.append(el('span', 'cmp-label', t(/** @type {string} */ (key))), el('span', 'cmp-val', rigValue(/** @type {string} */ (field), v, digits, unitKey)));
    box.append(row);
  }
  return box;
}

/** [필드, 키, 서식, 낮을수록 좋다] — Modifiers 전/후(스킬) */
const MOD_ROWS = [
  ['castMul', 'mod.castMul', 'pctMul', false],
  ['perfectWindow', 'mod.perfectWindow', 'pct', false],
  ['hookWindowAdd', 'mod.hookWindowAdd', 'sec', false],
  ['earlyBaitKeep', 'mod.earlyBaitKeep', 'pct', false],
  ['dragNotches', 'mod.dragNotches', 'int', false],
  ['lineStrMul', 'mod.lineStrMul', 'pctMul', false],
  ['slackRateMul', 'mod.slackRateMul', 'pctMul', true],
  ['abrasionMul', 'mod.abrasionMul', 'pctMul', true],
  ['pumpDrainMul', 'mod.pumpDrainMul', 'pctMul', false],
  ['jumpPumpMul', 'mod.jumpPumpMul', 'pctMul', true],
  ['knowledge', 'mod.knowledge', 'int', false],
  ['biteRateMul', 'mod.biteRateMul', 'pctMul', false],
  ['baitKeepOnFail', 'mod.baitKeepOnFail', 'pct', false],
  ['netRangeAdd', 'mod.netRangeAdd', 'm', false],
  ['landStaminaAdd', 'mod.landStaminaAdd', 'pct', false],
  ['sellMul', 'mod.sellMul', 'pctMul', false],
  ['signalMul', 'mod.signalMul', 'pctMul', false],
  ['tier3Unlocked', 'mod.tier3Unlocked', 'bool', false],
];

/** @param {any} v @param {string} kind */
function modValue(v, kind) {
  switch (kind) {
    case 'pctMul': { const d = Math.round((v - 1) * 100); return t('unit.pctMul', { v: (d > 0 ? '+' : '') + fmt(d) }); }
    case 'pct': return pct(v);
    case 'sec': return t('unit.s', { v: fmt(v, 2) });
    case 'm': return t('unit.m', { v: fmt(v, 1) });
    case 'bool': return t(v ? 'stat.yes' : 'stat.no');
    default: return fmt(v);
  }
}

/** @param {Object} before Modifiers @param {Object} after Modifiers @returns {HTMLElement} */
export function modCompare(before, after) {
  const box = el('div', 'cmp');
  let rows = 0;
  for (const [field, key, kind, lowerBetter] of MOD_ROWS) {
    const a = /** @type {any} */ (before)[field];
    const b = /** @type {any} */ (after)[field];
    if (a === b) continue;
    const better = typeof a === 'boolean' ? (b ? 1 : -1) : ((b > a) !== lowerBetter ? 1 : -1);
    box.append(cmpRow(t(/** @type {string} */ (key)), modValue(a, /** @type {string} */ (kind)), modValue(b, /** @type {string} */ (kind)), better));
    rows++;
  }
  if (!rows) box.append(el('span', 'cmp-none', t('stat.noChange')));
  return box;
}

/** @param {string} label @param {string} a @param {string} b @param {number} dir 1 오름(좋음) · −1 내림 · 0 중립 */
function cmpRow(label, a, b, dir) {
  const row = el('span', 'cmp-row');
  row.append(el('span', 'cmp-label', label), el('span', 'cmp-from', a), el('span', 'cmp-arrow', '→'),
    el('span', 'cmp-to ' + (dir > 0 ? 'is-up' : dir < 0 ? 'is-down' : ''), b));
  return row;
}

// ── 패널 바탕(§10.5 — 키보드만으로)

/**
 * @typedef {Object} MenuItem
 * @property {HTMLElement} el
 * @property {(() => void)|null} [activate]
 * @property {((dir:number) => void)|null} [adjust]   있으면 값 조절형(←→ · 「◀ ▶」)
 * @property {boolean} [disabled]
 * @property {(() => void)|null} [onFocus]
 */

/**
 * @typedef {Object} PanelCtx
 * @property {HTMLElement} root           패널 층
 * @property {Object} sim                 GameSim
 * @property {Object} actions
 * @property {import('../core/events.js').EventBus} bus
 * @property {Object} ui                  UIRoot
 * @property {Object} settings
 * @property {any} fishPreview
 */

export class PanelBase {
  /**
   * @param {PanelCtx} ctx @param {string} id
   * @param {{tabs?:string[]|null, closable?:boolean, size?:'s'|'m'|'l', titleKey?:string}} [opts]
   */
  constructor(ctx, id, opts = {}) {
    this.ctx = ctx;
    this.sim = ctx.sim;
    this.ui = ctx.ui;
    this.id = id;
    /** @type {string[]|null} */
    this.tabs = opts.tabs || null;
    this.closable = opts.closable !== false;
    this.args = {};
    this.tab = 0;
    this.focus = 0;
    /** @type {MenuItem[]} */
    this.items = [];
    /** @type {{from:number, to:number}|null} 격자로 놓인 항목 범위(setGrid — 렌더마다 다시 정한다) */
    this.grid = null;
    this.isOpen = false;

    this.el = el('section', `panel panel-${id} size-${opts.size || 'm'}`);
    this.el.hidden = true;
    this.el.setAttribute('role', 'dialog');
    const head = el('header', 'panel-head');
    this.titleEl = el('h2', 'panel-title', t(opts.titleKey || 'panel.' + id));
    head.append(this.titleEl);
    this.tabBar = el('nav', 'panel-tabs');
    if (this.tabs) {
      this.tabs.forEach((key, i) => {
        this.tabBar.append(btn('tab', t(key), () => this.setTab(i)));
      });
      head.append(this.tabBar);
    }
    if (this.closable) {
      const x = btn('panel-close', '×', () => this.ui.closePanel('pointer'));
      x.setAttribute('aria-label', t('panel.close'));
      head.append(x);
    }
    this.body = el('div', 'panel-body');
    this.foot = el('footer', 'panel-foot');
    this.el.append(head, this.body, this.foot);
    ctx.root.append(this.el);
  }

  /** @param {Object} [args] */
  open(args = {}) {
    this.args = args || {};
    this.tab = Number.isInteger(this.args.tab) ? this.args.tab : 0;
    this.focus = 0;
    this.isOpen = true;
    this.onOpen();
    this.render();
    this.el.hidden = false;
  }

  /** 위의 패널이 닫혀 다시 보인다(같은 args) */
  reveal() {
    this.isOpen = true;
    this.render();
    this.el.hidden = false;
  }

  /** 위에 다른 패널이 겹쳤다(보이게 두되 흐리게) @param {boolean} on */
  setCovered(on) { setClass(this.el, 'is-covered', on); }

  close() {
    this.isOpen = false;
    this.el.hidden = true;
    this.onClose();
  }

  /** 하위 클래스 훅 */
  onOpen() {}
  onClose() {}
  /** @param {string|null} tabKey */
  build(tabKey) { void tabKey; }
  /** @param {Object} state @param {number} dt */
  update(state, dt) { void state; void dt; }
  /** 하위 클래스 키(공통 처리 전) @param {KeyboardEvent} e @param {boolean} grace @returns {boolean} */
  onKey(e, grace) { void e; void grace; return false; }
  /** 발판 도움말 문자열 키 @returns {string} */
  footKey() { return this.tabs ? 'panel.footTabs' : 'panel.foot'; }

  /** 지금 탭으로 다시 그린다(포커스 자리 유지) */
  render() {
    if (this.tabs) {
      const bs = this.tabBar.children;
      for (let i = 0; i < bs.length; i++) setClass(/** @type {HTMLElement} */ (bs[i]), 'is-active', i === this.tab);
    }
    const keepScroll = this.body.scrollTop;
    this.items = [];
    this.grid = null;
    this.body.replaceChildren();
    this.build(this.tabs ? this.tabs[this.tab] : null);
    if (this.focus >= this.items.length) this.focus = Math.max(0, this.items.length - 1);
    this.body.scrollTop = keepScroll;
    this._paintFocus(false);
    setText(this.foot, t(this.footKey()));
  }

  /**
   * 포커스 가능한 항목을 더한다
   * @param {HTMLElement} node @param {Omit<MenuItem, 'el'>} [opts] @param {HTMLElement} [parent]
   * @returns {MenuItem}
   */
  addItem(node, opts = {}, parent) {
    const item = { el: node, activate: opts.activate || null, adjust: opts.adjust || null, disabled: !!opts.disabled, onFocus: opts.onFocus || null };
    const idx = this.items.length;
    node.classList.add('item');
    if (item.disabled) node.classList.add('is-disabled');
    if (item.adjust) {
      node.classList.add('is-adjust');
      const l = btn('adj adj-l', '◀', (e) => { e.stopPropagation(); this.setFocus(idx); this._adjust(-1); });
      const r = btn('adj adj-r', '▶', (e) => { e.stopPropagation(); this.setFocus(idx); this._adjust(1); });
      node.prepend(l);
      node.append(r);
    }
    node.addEventListener('click', () => {
      this.setFocus(idx);
      this._activate();
    });
    this.items.push(item);
    (parent || this.body).append(node);
    return item;
  }

  /**
   * items[from..to] 은 가로로 이어지는 격자(도감 카드 · 지도 카드) — ←→ 는 이웃 항목, ↑↓ 는 한 줄 위 · 아래(리뷰 수정:
   * 4열 도감에서 ↓ 가 오른쪽으로 가고 → 가 탭을 바꿨다 · 가로 지도 카드에서 → 가 듣지 않았다). build 안에서 부른다.
   * @param {number} from @param {number} to
   */
  setGrid(from, to) {
    this.grid = to >= from && from >= 0 ? { from, to } : null;
  }

  /** 지금 배치에서 격자 한 줄의 항목 수(첫 항목과 같은 높이의 수 — 배치가 없으면 한 줄) @returns {number} */
  _gridCols() {
    const g = /** @type {{from:number, to:number}} */ (this.grid);
    const top0 = this.items[g.from].el.offsetTop;
    let c = 0;
    for (let i = g.from; i <= g.to && this.items[i].el.offsetTop === top0; i++) c++;
    return Math.max(1, c);
  }

  /** 격자 안 포커스의 화살표 @param {string} code @returns {boolean} 처리했는가 */
  _gridKey(code) {
    const g = this.grid;
    const i = this.focus;
    if (!g || i < g.from || i > g.to || g.to >= this.items.length) return false;
    const n = g.to - g.from + 1;
    const k = i - g.from;
    const cols = this._gridCols();
    switch (code) {
      case 'ArrowLeft': if (k > 0) this.setFocus(i - 1); return true;
      case 'ArrowRight': if (k < n - 1) this.setFocus(i + 1); return true;
      case 'ArrowUp':
        if (k - cols >= 0) this.setFocus(i - cols);
        else if (g.from > 0) this.setFocus(g.from - 1);
        return true;
      case 'ArrowDown':
        if (k + cols < n) this.setFocus(i + cols);
        else if (g.to + 1 < this.items.length) this.setFocus(g.to + 1);
        else if (Math.floor(k / cols) < Math.floor((n - 1) / cols)) this.setFocus(g.to);
        return true;
      default: return false;
    }
  }

  /** 포커스 없는 정보 줄 @param {HTMLElement} node @param {HTMLElement} [parent] */
  addInfo(node, parent) {
    (parent || this.body).append(node);
    return node;
  }

  /** @param {number} i */
  setFocus(i) {
    if (!this.items.length) return;
    const n = Math.max(0, Math.min(this.items.length - 1, i));
    if (n === this.focus && this.items[n].el.classList.contains('is-focus')) return;
    this.focus = n;
    this._paintFocus(true);
  }

  /** @param {boolean} scroll */
  _paintFocus(scroll) {
    for (let i = 0; i < this.items.length; i++) setClass(this.items[i].el, 'is-focus', i === this.focus);
    const it = this.items[this.focus];
    if (!it) return;
    if (scroll && typeof it.el.scrollIntoView === 'function') it.el.scrollIntoView({ block: 'nearest' });
    if (it.onFocus) it.onFocus();
  }

  /** @param {number} i */
  setTab(i) {
    if (!this.tabs) return;
    const n = ((i % this.tabs.length) + this.tabs.length) % this.tabs.length;
    if (n === this.tab) return;
    this.tab = n;
    this.focus = 0;
    this.body.scrollTop = 0;
    this.onTab();
    this.render();
  }

  onTab() {}

  _activate() {
    const it = this.items[this.focus];
    if (!it || !it.activate) return;
    it.activate();
  }

  /** @param {number} dir */
  _adjust(dir) {
    const it = this.items[this.focus];
    if (it && it.adjust) it.adjust(dir);
  }

  /**
   * 공통 키(§10.5). Esc · Tab 은 UIRoot 가 먼저 본다.
   * @param {KeyboardEvent} e @param {boolean} grace 열린 뒤 PANEL_INPUT_GRACE 안 — 확인 키를 버린다
   * @returns {boolean}
   */
  handleKey(e, grace) {
    if (this.onKey(e, grace)) return true;
    const c = e.code;
    if (this._gridKey(c)) return true;
    switch (c) {
      case 'ArrowUp': this.setFocus(this.focus - 1); return true;
      case 'ArrowDown': this.setFocus(this.focus + 1); return true;
      case 'KeyQ': if (!e.repeat) this.setTab(this.tab - 1); return true;
      case 'KeyE': if (!e.repeat) this.setTab(this.tab + 1); return true;
      case 'ArrowLeft':
      case 'ArrowRight': {
        const dir = c === 'ArrowLeft' ? -1 : 1;
        const it = this.items[this.focus];
        if (it && it.adjust) this._adjust(dir);
        else if (!e.repeat) this.setTab(this.tab + dir);
        return true;
      }
      case 'Enter':
      case 'NumpadEnter':
      case 'Space':
        if (grace || e.repeat) return true;
        this._activate();
        return true;
      default: return false;
    }
  }

  dispose() { this.el.remove(); }
}
