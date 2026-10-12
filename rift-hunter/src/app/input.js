// OWNER: P9 — 계약 §11.5 · §10.5 · §3.2
// 입력 수집기 — event.code 로만(한글 IME) · Ctrl/Meta/Alt + 다른 키 조합은 건드리지 않는다(기본 동작도 막지 않는다) · Alt 단독은 기본 동작을 막는다(메뉴 포커스).
// 에지(…Down)는 다음 frame() 이 가져갈 때까지 모은다 · frame() 이 InputFrame 을 만들고 에지를 비운다 · dropEdges(1) = 다음 한 틱의 에지를 버린다(패널 닫힘 · 막 걷힘).
// 키 처리 순서(§10.5): 텍스트 칸 포커스 → ui 만 / ui.handleKey(e) 먼저(true 면 게임 입력이 아니다) / app 키(onAppKey — Escape · 토글 · Enter 복귀) / 게임 키.
//   · 모달이 먹은 「누르고 있는」 게임 키(스킬 · Shift)는 눌림으로 남긴다(에지 없이) — 모달이 닫힌 뒤 「눌림」으로 잡힌다(QUALITY §1).
//   · 겹쳐 보는 패널이 자기 keys 로 먹은 키는 뗄 때까지 게임 입력이 아니다(스킬 창에서 Digit1 을 누른 채 닫아도 스킬이 나가지 않게).
// 마우스: window 에서 받는다(#ui-root 가 캔버스를 덮어도) · ui.blocksPointer(x, y) 이거나 상호작용 요소(버튼 · 입력 칸 …) 위의 누름은 게임 입력이 아니다 ·
//   누르고 있던 이동은 패널 위로 지나가도 유지 · 떼면 끝 · 창 밖 · 포커스 없음이면 cursor null(누르고 있던 이동이 멈춘다).
// hover 조합(§11.5): (이름표 켬 ? labelHover : null) ?? 몬스터 광선 ?? labelHover ?? 드랍 · 물체 광선 — 몬스터 원기둥이 이름표보다 앞선다(Alt 일 때만 이름표가 앞선다).

import { EV } from '../core/events.js';
import { makeInput } from '../core/inputFrame.js';
import { SKILL_BAR } from '../core/constants.js';
import { KEYBINDS, MOUSE } from '../data/keybinds.js';
import { pickHover } from '../sim/pick.js';

/** @typedef {import('../types.js').InputFrame} InputFrame */
/** @typedef {import('../types.js').Hover} Hover */

/** 게임 중 기본 동작을 막는 키(포커스 이동 · 스크롤) */
const BLOCK_DEFAULT = ['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', 'Backquote'];
/** 옆 버튼(뒤로 · 앞으로) */
const SIDE_BUTTONS = [3, 4];
/** 휠 한 칸(px) — 트랙패드의 잔 이벤트는 모아서 · 한 이벤트는 한 칸까지 */
const WHEEL_NOTCH = 50;
/** 상호작용 요소(클릭이 게임 입력이 아니다) */
const INTERACTIVE = 'button, input, select, textarea, a[href], label, [role="button"], [contenteditable="true"], [data-ui-block]';
const KINDS_MON = { kinds: ['monster'] };
const KINDS_REST = { kinds: ['drop', 'object'] };

/** @param {any} el */
function isTextField(el) {
  if (!el || typeof el !== 'object') return false;
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = String(el.type || 'text').toLowerCase();
    return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'color', 'file', 'image'].includes(type);
  }
  return !!el.isContentEditable;
}

export class InputCollector {
  /**
   * @param {{canvas:any, bus:any, ui:any, rc:any, keybinds?:typeof KEYBINDS, settings?:import('../types.js').Settings|null,
   *   win?:any, doc?:any, pick?:typeof pickHover, onAppKey?:((e:KeyboardEvent) => boolean)|null, onGesture?:(() => void)|null, onZoom?:((steps:number) => void)|null}} deps
   *   win · doc 를 null 로 주면 리스너를 달지 않는다(테스트는 handle* 를 직접 부른다)
   */
  constructor({ canvas, bus, ui, rc, keybinds = KEYBINDS, settings = null, win = undefined, doc = undefined, pick = pickHover, onAppKey = null, onGesture = null, onZoom = null }) {
    this.canvas = canvas;
    this.bus = bus;
    this.ui = ui;
    this.rc = rc;
    this.kb = keybinds;
    this.settings = settings;
    this.pick = pick;
    this.onAppKey = onAppKey;
    this.onGesture = onGesture;
    this.onZoom = onZoom;
    this.win = win === undefined ? (typeof window !== 'undefined' ? window : null) : win;
    this.doc = doc === undefined ? (typeof document !== 'undefined' ? document : null) : doc;

    /** 캔버스 CSS px */
    this.mx = 0;
    this.my = 0;
    this.inside = false;
    this.focused = true;
    /** 게임이 받는 「누르고 있음」(스킬 숫자 · Shift) @type {Set<string>} */
    this.held = new Set();
    /** 겹쳐 보는 패널이 먹은 키 — 뗄 때까지 게임 입력이 아니다 @type {Set<string>} */
    this.captured = new Set();
    this.lmb = false;
    this.rmb = false;
    this.alt = false;
    this.lmbDown = false;
    this.slotDown = new Array(SKILL_BAR).fill(false);
    this.potionDown = false;
    this.recallDown = false;
    /** 에지를 버릴 남은 틱 */
    this.drop = 0;
    this.wheelAcc = 0;
    this.gestured = false;
    this._slot = new Array(SKILL_BAR).fill(false);
    this._offs = [];

    this._offs.push(bus.on(EV.PANEL_CLOSED, () => this.dropEdges(1)));
    this._attach();
  }

  // ───────────────────────── 리스너 ─────────────────────────

  _attach() {
    const w = this.win;
    if (!w || typeof w.addEventListener !== 'function') return;
    /** @param {any} target @param {string} type @param {(e:any) => void} fn @param {any} [opt] */
    const on = (target, type, fn, opt) => {
      if (!target || typeof target.addEventListener !== 'function') return;
      target.addEventListener(type, fn, opt);
      this._offs.push(() => target.removeEventListener(type, fn, opt));
    };
    on(w, 'keydown', (e) => this.handleKeyDown(e));
    on(w, 'keyup', (e) => this.handleKeyUp(e));
    on(w, 'mousemove', (e) => this.handleMouseMove(e));
    on(w, 'mousedown', (e) => this.handleMouseDown(e));
    on(w, 'mouseup', (e) => this.handleMouseUp(e));
    on(w, 'auxclick', (e) => { if (SIDE_BUTTONS.includes(e.button)) e.preventDefault(); });
    on(w, 'contextmenu', (e) => this.handleContextMenu(e));
    on(w, 'blur', () => this.handleBlur());
    on(w, 'focus', () => this.handleFocus());
    on(w, 'mouseout', (e) => { if (!e.relatedTarget) this.handleLeave(); });
    on(this.doc && this.doc.documentElement, 'mouseleave', () => this.handleLeave());
    on(this.canvas, 'wheel', (e) => this.handleWheel(e), { passive: false });
  }

  dispose() {
    for (const off of this._offs) off();
    this._offs.length = 0;
  }

  // ───────────────────────── 키 ─────────────────────────

  /** 텍스트 칸에 포커스가 있는가 @param {any} e */
  _typing(e) {
    const a = this.doc && this.doc.activeElement;
    return isTextField(a) || isTextField(e && e.target);
  }

  _gesture() {
    if (this.gestured) return;
    this.gestured = true;
    if (this.onGesture) this.onGesture();
  }

  /** @param {boolean} on */
  _setAlt(on) {
    if (this.alt === on) return;
    this.alt = on;
    if (this.ui && typeof this.ui.setLabels === 'function') this.ui.setLabels(on);
    this.bus.emit(EV.LABELS, { on });
  }

  /** @param {string} code */
  _isHoldKey(code) { return this.kb.skill.includes(code) || this.kb.stand.includes(code); }

  /** @param {KeyboardEvent} e */
  handleKeyDown(e) {
    const code = e.code;
    if (this._typing(e)) {
      if (this.ui.handleKey(e)) e.preventDefault();
      return;
    }
    if (this.kb.labels.includes(code)) {
      e.preventDefault();
      this._gesture();
      this._setAlt(true);
      this.ui.handleKey(e);
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    this._gesture();
    if (this.captured.has(code)) { e.preventDefault(); return; }
    const modal = this.ui.isModal();
    if (this.ui.handleKey(e)) {
      e.preventDefault();
      if (!e.repeat && this._isHoldKey(code)) {
        if (modal) this.held.add(code);
        else this.captured.add(code);
      }
      return;
    }
    if (this.onAppKey && this.onAppKey(e)) { e.preventDefault(); return; }
    const k = this.kb.skill.indexOf(code);
    if (k >= 0 || this.kb.stand.includes(code)) {
      if (!e.repeat && !this.held.has(code) && k >= 0) this.slotDown[k + 1] = true;
      this.held.add(code);
      e.preventDefault();
      return;
    }
    if (code === this.kb.potion) {
      if (!e.repeat) this.potionDown = true;
      e.preventDefault();
      return;
    }
    if (code === this.kb.recall) {
      if (!e.repeat) this.recallDown = true;
      e.preventDefault();
      return;
    }
    if (BLOCK_DEFAULT.includes(code)) e.preventDefault();
  }

  /** 뗌은 조합 · 포커스와 무관하게 늘 눌림을 푼다 @param {KeyboardEvent} e */
  handleKeyUp(e) {
    const code = e.code;
    const was = this.held.delete(code);
    this.captured.delete(code);
    if (this.kb.labels.includes(code)) {
      e.preventDefault();
      this._setAlt(false);
      this.ui.handleKey(e);
      return;
    }
    if (this._typing(e)) {
      if (this.ui.handleKey(e)) e.preventDefault();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (this.ui.handleKey(e)) { e.preventDefault(); return; }
    if (was || this._isHoldKey(code) || code === this.kb.potion || code === this.kb.recall || BLOCK_DEFAULT.includes(code)) e.preventDefault();
  }

  // ───────────────────────── 마우스 ─────────────────────────

  /** @param {MouseEvent} e */
  _pos(e) {
    let left = 0, top = 0;
    const c = this.canvas;
    if (c && typeof c.getBoundingClientRect === 'function') {
      const r = c.getBoundingClientRect();
      left = r.left;
      top = r.top;
    }
    this.mx = (Number(e.clientX) || 0) - left;
    this.my = (Number(e.clientY) || 0) - top;
    this.inside = true;
  }

  /** 그 누름이 UI 위인가 @param {any} e */
  _blocked(e) {
    if (this.ui.blocksPointer(this.mx, this.my)) return true;
    const t = e && e.target;
    if (!t || t === this.canvas || typeof t.closest !== 'function') return false;
    try { return t.closest(INTERACTIVE) !== null; } catch { return false; }
  }

  /** @param {MouseEvent} e */
  handleMouseMove(e) { this._pos(e); }

  /** @param {MouseEvent} e */
  handleMouseDown(e) {
    this._pos(e);
    if (SIDE_BUTTONS.includes(e.button)) { e.preventDefault(); return; }
    this._gesture();
    if (this._typing(e) && isTextField(e.target)) return;
    if (this.ui.isModal() || this._blocked(e)) return;
    if (e.button === MOUSE.move) {
      if (!this.lmb) this.lmbDown = true;
      this.lmb = true;
      e.preventDefault();
    } else if (e.button === MOUSE.skill0) {
      if (!this.rmb) this.slotDown[0] = true;
      this.rmb = true;
      e.preventDefault();
    }
  }

  /** @param {MouseEvent} e */
  handleMouseUp(e) {
    if (SIDE_BUTTONS.includes(e.button)) { e.preventDefault(); return; }
    if (e.button === MOUSE.move) this.lmb = false;
    else if (e.button === MOUSE.skill0) this.rmb = false;
  }

  /** 우클릭 메뉴(텍스트 칸 밖) @param {MouseEvent} e */
  handleContextMenu(e) {
    if (isTextField(e.target)) return;
    e.preventDefault();
  }

  /** 휠 → 줌(캔버스 위 · UI 위가 아니면) @param {WheelEvent} e */
  handleWheel(e) {
    if (e.ctrlKey) return;
    e.preventDefault();
    this._pos(e);
    if (this.ui.isModal() || this.ui.blocksPointer(this.mx, this.my)) return;
    const unit = e.deltaMode === 1 ? WHEEL_NOTCH : e.deltaMode === 2 ? WHEEL_NOTCH * 4 : 1;
    const d = Math.max(-WHEEL_NOTCH, Math.min(WHEEL_NOTCH, (Number(e.deltaY) || 0) * unit));
    this.wheelAcc += d;
    while (Math.abs(this.wheelAcc) >= WHEEL_NOTCH) {
      const s = Math.sign(this.wheelAcc);
      this.wheelAcc -= s * WHEEL_NOTCH;
      if (this.onZoom) this.onZoom(s);
    }
  }

  handleLeave() { this.inside = false; }
  handleBlur() {
    this.focused = false;
    this.releaseAll();
  }
  handleFocus() { this.focused = true; }

  // ───────────────────────── 상태 ─────────────────────────

  /** 이번 틱까지 모은 에지를 비운다 */
  clearEdges() {
    this.lmbDown = false;
    this.slotDown.fill(false);
    this.potionDown = false;
    this.recallDown = false;
  }

  /** 다음 n 틱의 에지를 버린다(누르고 있는 것은 그대로) @param {number} [n] */
  dropEdges(n = 1) { this.drop = Math.max(this.drop, n | 0); }

  /** 눌린 키 · 버튼 전부 놓기(포커스 잃음 · 탭 숨김) */
  releaseAll() {
    this.held.clear();
    this.captured.clear();
    this.lmb = false;
    this.rmb = false;
    this.clearEdges();
    this._setAlt(false);
  }

  /** 이름표가 켜져 있는가(Alt · 늘 이름표) */
  labelsOn() { return this.alt || !!(this.settings && this.settings.alwaysLabels); }

  /** 커서 아래 바닥 점(창 밖 · 포커스 없음이면 null) @returns {{x:number, z:number}|null} */
  cursor() {
    if (!this.inside || !this.focused || !this.rc) return null;
    const g = this.rc.groundAt(this.mx, this.my);
    return g && Number.isFinite(g.x) && Number.isFinite(g.z) ? g : null;
  }

  /** @returns {Hover|null} */
  _label() {
    const h = this.ui.labelHover();
    if (!h) return null;
    return h.src ? h : /** @type {Hover} */ ({ ...h, src: 'label' });
  }

  /**
   * 커서 아래 대상(§11.5 조합) — UI 위 · 창 밖이면 null
   * @param {import('../types.js').GameState} state @param {import('../types.js').MapData|null} map @returns {Hover|null}
   */
  hover(state, map) {
    if (!this.inside || !this.focused || !this.rc || !state) return null;
    if (this.ui.blocksPointer(this.mx, this.my)) return null;
    const ray = this.rc.rayFromScreen(this.mx, this.my);
    return (this.labelsOn() ? this._label() : null)
      ?? this.pick(state, map, ray, KINDS_MON)
      ?? this._label()
      ?? this.pick(state, map, ray, KINDS_REST);
  }

  /**
   * 이번 틱의 InputFrame — 에지를 비운다(dropEdges 중이면 에지 없이)
   * @param {import('../types.js').GameState} state @param {import('../types.js').MapData|null} map @returns {InputFrame}
   */
  frame(state, map) {
    if (this.drop > 0) {
      this.drop--;
      this.clearEdges();
    }
    const cursor = this.cursor();
    const hover = cursor ? this.hover(state, map) : null;
    const s = this._slot;
    s[0] = this.rmb;
    for (let i = 0; i < this.kb.skill.length && i + 1 < s.length; i++) s[i + 1] = this.held.has(this.kb.skill[i]);
    let shift = false;
    for (const c of this.kb.stand) if (this.held.has(c)) shift = true;
    const f = makeInput({
      cursor, hover, lmb: this.lmb, lmbDown: this.lmbDown, slot: s, slotDown: this.slotDown, shift,
      potionDown: this.potionDown, recallDown: this.recallDown,
    });
    this.clearEdges();
    return f;
  }
}
