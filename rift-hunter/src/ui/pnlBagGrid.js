// OWNER: P11 — 계약 §10.5-8 · §10.6
// 가방 격자 조각 — 인벤토리 · 대장장이 · 잡화상 · 보관함 · 신비술사가 같이 쓴다(gridNav 위 — 방향키 · Enter · 포커스 고리 · 마우스).
//  createItemGrid(ctx, opts) — 아이템 칸 격자 하나(가방 40 · 보관함 60 · 장비 인형 10 — 빈 자리 칸은 건너뛴다)
//  createBagGrid(ctx, opts)  — 가방(8 × 5 · char.bag)
//  createAreas(areas)        — 포커스 영역 둘 이상(§10.5-8: 방향키가 끝을 넘으면 옆 영역 · KeyE 로 바꾸기 · 포커스 영역에 고리)
//  createItemList(ctx, opts) — 아이템 · 행 목록(listNav 위 — 상점 재고 · 되사기 · 부위 고르기 · 균열 레벨)
// 끌어서 놓기: 아이템 칸을 누른 채 다른 칸(같은 패널의 다른 격자 포함)에서 떼면 opts.onDrop(src, dst) — 패널이 명령을 고른다(클릭과 같은 명령).
// 매 프레임 update(state)는 칸의 아이템 참조만 비교한다 — 바뀐 칸 · 이벤트(BAG · EQUIPPED · STATS · LEVEL_UP)가 있을 때만 DOM 을 고친다.

import { EV } from '../core/events.js';
import { BAG_COLS, BAG_SIZE } from '../core/constants.js';
import { KEYBINDS } from '../data/keybinds.js';
import { baseNameKey, upgradeOf } from './pnlLogic.js';

/** @typedef {import('../types.js').Item} Item */

const ARROWS = new Set([KEYBINDS.up, KEYBINDS.down, KEYBINDS.left, KEYBINDS.right]);
const UP_MARK = '▲';
/** 진행 중인 끌기(한 번에 하나) @type {null|{grid:any, idx:number, cell:HTMLElement}} */
let drag = null;

/** 칸 이름 — 기본형 단계 이름의 마지막 낱말(「낡은 검」 → 「검」) @param {(k:string) => string} t @param {Item} item */
function glyphOf(t, item) {
  const key = baseNameKey(item);
  if (!key) return '?';
  const s = t(key);
  const parts = s.split(' ');
  return parts[parts.length - 1] || s;
}

/** 그 캐릭터가 지금 낄 수 있는가(클래스 · 레벨 — 부위 규칙은 장착 명령이 말한다) @param {any} char @param {Item} item */
export function canWear(char, item) {
  if (!char || !item) return true;
  if (item.cls && item.cls !== char.cls) return false;
  return (Number(char.level) || 1) >= (Number(item.reqLevel) || 1);
}

/**
 * 아이템 칸 격자 하나
 * @param {{t:(k:string, p?:Object) => string, widgets:any, sim:any, bus?:any, tooltip?:any}} ctx
 * @param {{kind:string, cols:number, rows:number, items:(state:any) => Array<Item|null>, slots?:Array<string|null>, cellLabel?:(i:number) => string,
 *          onPick?:(i:number, via:string) => void, onFocus?:(i:number) => void, onEdge?:(dir:string) => boolean, onDrop?:(src:{kind:string, idx:number}, dst:{kind:string, idx:number}) => void,
 *          upgrades?:boolean, tipOpts?:(i:number, item:Item) => Object, className?:string}} opts
 */
export function createItemGrid(ctx, opts) {
  const { t, widgets: w } = ctx;
  const el = w.el('div', 'grid ' + (opts.className ?? ''));
  el.style.setProperty('--cols', String(opts.cols));
  const total = opts.cols * opts.rows;
  /** @type {HTMLElement[]} */
  const cells = [];
  /** @type {Array<{item:Item|null, stamp:string}>} */
  const last = [];
  for (let i = 0; i < total; i++) {
    const blank = opts.slots ? opts.slots[i] === null || opts.slots[i] === undefined : false;
    const c = w.el('div', blank ? 'cell is-blank' : 'cell is-empty');
    c.dataset.idx = String(i);
    if (!blank && opts.cellLabel) c.appendChild(w.el('span', 'cell-slot', opts.cellLabel(i)));
    el.appendChild(c);
    cells.push(c);
    last.push({ item: null, stamp: '' });
  }
  const blankAt = (i) => cells[i]?.classList.contains('is-blank') ?? true;
  let dirty = true;
  /** @type {any} */
  let lastChar = null;
  /** @type {Array<Item|null>} */
  let items = [];
  /** @type {Array<() => void>} */
  const offs = [];
  if (ctx.bus) {
    const mark = () => { dirty = true; };
    for (const name of [EV.BAG, EV.EQUIPPED, EV.STATS_CHANGED, EV.LEVEL_UP, EV.DURABILITY, EV.CHAR_LOADED, EV.SCENE_CHANGED]) offs.push(ctx.bus.on(name, mark));
  }

  const grid = {
    el,
    kind: opts.kind,
    cells,
    /** @type {any} */ nav: null,
    get index() { return nav.index; },
    /** 지금 그 칸의 아이템 @param {number} i */
    itemAt(i) { return items[i] ?? null; },
    /** @param {number} i */
    isBlank(i) { return blankAt(i); },
    markDirty() { dirty = true; },
    /** @param {any} state */
    update(state) {
      const char = state?.char ?? null;
      const list = char || opts.kind === 'stash' ? opts.items(state) : null;
      items = Array.isArray(list) ? list : [];
      if (char !== lastChar) { lastChar = char; dirty = true; }
      if (!dirty) {
        for (let i = 0; i < total; i++) if ((items[i] ?? null) !== last[i].item) { dirty = true; break; }
      }
      if (!dirty) return false;
      dirty = false;
      const stats = ctx.sim?.getStats?.() ?? null;
      for (let i = 0; i < total; i++) {
        if (blankAt(i)) continue;
        const it = items[i] ?? null;
        let stamp = '';
        let up = false;
        let wear = true;
        if (it) {
          wear = canWear(char, it);
          up = !!(opts.upgrades && char && wear && upgradeOf(stats, char, it));
          stamp = `${it.id}|${it.rarity}|${it.flags?.locked ? 1 : 0}|${it.dur > 0 ? 1 : 0}|${wear ? 1 : 0}|${up ? 1 : 0}|${it.tier}|${it.baseId}`;
        }
        last[i].item = it;
        if (stamp === last[i].stamp) continue;
        last[i].stamp = stamp;
        paint(cells[i], it, { up, wear }, i);
      }
      nav.refresh();
      return true;
    },
    /** @param {number} [i] */
    focus(i) {
      let j = i ?? (nav.index >= 0 ? nav.index : 0);
      if (blankAt(j)) { const k = cells.findIndex((c, x) => !blankAt(x)); j = k >= 0 ? k : 0; }
      nav.focus(j);
    },
    blur() { nav.blur(); },
    /** 방향키 · Enter(빈 자리는 건너뛴다) @param {KeyboardEvent} e */
    handleKey(e) {
      const before = nav.index;
      const r = nav.handleKey(e);
      if (ARROWS.has(e.code) && e.type !== 'keyup' && nav.index >= 0 && blankAt(nav.index)) {
        let guard = total;
        while (guard-- > 0 && blankAt(nav.index)) {
          const prev = nav.index;
          nav.handleKey(e);
          if (nav.index === prev) break;
        }
        if (blankAt(nav.index)) nav.focus(before >= 0 ? before : 0, true);
      }
      return r;
    },
    /** 그 칸의 화면 사각형 @param {number} i */
    rectOf(i) { return cells[i]?.getBoundingClientRect?.() ?? null; },
    dispose() {
      for (const off of offs) off();
      offs.length = 0;
      nav.destroy();
      el.removeEventListener('mousedown', onDown);
      el.remove();
    },
  };

  /** @param {HTMLElement} c @param {Item|null} it @param {{up:boolean, wear:boolean}} f @param {number} i */
  function paint(c, it, f, i) {
    c.textContent = '';
    c.className = 'cell';
    if (opts.cellLabel) c.appendChild(w.el('span', 'cell-slot', opts.cellLabel(i)));
    if (!it) { c.classList.add('is-empty'); return; }
    c.classList.add('c-' + (it.rarity ?? 'normal'));
    c.appendChild(w.el('span', 'cell-name', glyphOf(t, it)));
    c.appendChild(w.el('span', 'cell-lv', String(it.ilvl ?? '')));
    if (it.flags?.locked) c.appendChild(w.el('i', 'cell-lock'));
    if (f.up) c.appendChild(w.el('i', 'cell-up', UP_MARK));
    if (!(it.dur > 0)) { c.classList.add('is-broken'); c.appendChild(w.el('i', 'cell-broken')); }
    if (!f.wear) c.classList.add('is-unusable');
  }

  const nav = w.gridNav(el, opts.cols, opts.rows, (i, via) => {
    if (blankAt(i)) return;
    opts.onPick?.(i, via);
  }, {
    onFocus: (i) => { opts.onFocus?.(i); },
    onEdge: (dir) => opts.onEdge?.(dir) ?? false,
  });
  grid.nav = nav;

  // 끌어서 놓기 — 누른 칸 → 뗀 칸(같은 칸이면 클릭으로 둔다)
  /** @param {MouseEvent} ev */
  const onDown = (ev) => {
    if (ev.button !== 0) return;
    const c = /** @type {HTMLElement|null} */ (/** @type {any} */ (ev.target)?.closest?.('.cell'));
    if (!c || !el.contains(c)) return;
    const i = Number(c.dataset.idx);
    if (!Number.isInteger(i) || blankAt(i) || !items[i]) return;
    endDrag();
    drag = { grid, idx: i, cell: c };
    c.classList.add('is-drag');
    window.addEventListener('mouseup', onUp, true);
  };
  el.addEventListener('mousedown', onDown);
  /** @type {any} */ (grid).opts = opts;
  /** @type {any} */ (el)._grid = grid;
  return grid;
}

/** @param {MouseEvent} ev */
function onUp(ev) {
  const d = drag;
  endDrag();
  if (!d) return;
  const c = /** @type {HTMLElement|null} */ (/** @type {any} */ (ev.target)?.closest?.('.cell'));
  if (!c) return;
  const host = c.parentElement;
  const dst = host && /** @type {any} */ (host)._grid;
  if (!dst) return;
  const j = Number(c.dataset.idx);
  if (!Number.isInteger(j) || dst.isBlank(j)) return;
  if (dst === d.grid && j === d.idx) return;
  const fn = dst.opts?.onDrop ?? d.grid.opts?.onDrop;
  fn?.({ kind: d.grid.kind, idx: d.idx }, { kind: dst.kind, idx: j });
}

function endDrag() {
  if (drag) drag.cell.classList.remove('is-drag');
  drag = null;
  if (typeof window !== 'undefined') window.removeEventListener('mouseup', onUp, true);
}

/**
 * 가방 격자(8 × 5 · char.bag) — 칸을 고르면 opts.onPick · 업그레이드 표시(▲) · 잠김 · 부서짐 · 못 끼는 것
 * @param {any} ctx @param {Partial<Parameters<typeof createItemGrid>[1]>} [opts]
 */
export function createBagGrid(ctx, opts = {}) {
  return createItemGrid(ctx, {
    kind: 'bag', cols: BAG_COLS, rows: Math.ceil(BAG_SIZE / BAG_COLS), upgrades: true,
    items: (state) => state?.char?.bag ?? [],
    ...opts,
  });
}

/**
 * 포커스 영역 둘 이상(§10.5-8). area = {el, focus(), blur(), handleKey(e), nav} — 활성 영역의 컨테이너에 'is-area'.
 * cross(dir): 방향키가 끝을 넘을 때 — 영역 순서(왼쪽 → 오른쪽 · 위 → 아래)에서 그 방향의 다음 영역으로.
 * @param {Array<{el:HTMLElement, focus:Function, blur?:Function, handleKey:Function, box?:HTMLElement, axis?:'h'|'v'}>} areas @param {(i:number) => void} [onChange]
 */
export function createAreas(areas, onChange) {
  let cur = 0;
  const ctl = {
    get index() { return cur; },
    get active() { return areas[cur]; },
    /** @param {number} i @param {boolean} [focus] */
    set(i, focus = true) {
      const j = Math.max(0, Math.min(areas.length - 1, i | 0));
      const changed = j !== cur;
      cur = j;
      for (let k = 0; k < areas.length; k++) (areas[k].box ?? areas[k].el).classList.toggle('is-area', k === j);
      if (focus) areas[j].focus();
      if (changed) onChange?.(j);
    },
    toggle() { ctl.set((cur + 1) % areas.length); },
    /** @param {string} dir */
    cross(dir) {
      const axis = areas[cur].axis ?? 'h';
      const fwd = axis === 'h' ? dir === 'right' : dir === 'down';
      const back = axis === 'h' ? dir === 'left' : dir === 'up';
      if (fwd && cur < areas.length - 1) { ctl.set(cur + 1); return true; }
      if (back && cur > 0) { ctl.set(cur - 1); return true; }
      return false;
    },
    /** 마우스가 그 영역의 칸을 골랐다(포커스는 이미 옮겨졌다) @param {number} i */
    pointer(i) { if (i !== cur) ctl.set(i, false); },
    /** @param {KeyboardEvent} e */
    handleKey(e) { return areas[cur].handleKey(e); },
  };
  return ctl;
}

/**
 * 행 목록(listNav 위) — 행마다 render(row, i)가 내용을 채운다 · 같은 stamp 면 다시 그리지 않는다
 * @param {any} ctx
 * @param {{className?:string, onPick?:(i:number, via:string) => void, onFocus?:(i:number) => void, onEdge?:(dir:string) => boolean}} opts
 */
export function createItemList(ctx, opts = {}) {
  const { widgets: w } = ctx;
  const el = w.el('div', 'rows ' + (opts.className ?? ''));
  /** @type {string[]} */
  let stamps = [];
  const nav = w.listNav(el, (i, via) => opts.onPick?.(i, via), {
    wrap: false,
    onFocus: (i) => opts.onFocus?.(i),
    onEdge: (dir) => opts.onEdge?.(dir) ?? false,
  });
  const list = {
    el,
    nav,
    get index() { return nav.index; },
    get count() { return el.children.length; },
    /**
     * 행 n 개를 그린다 — stamp 가 같은 행은 그대로 @param {number} n @param {(i:number) => string} stampOf @param {(row:HTMLElement, i:number) => void} render
     */
    set(n, stampOf, render) {
      let changed = false;
      while (el.children.length > n) { el.lastChild?.remove(); changed = true; }
      while (el.children.length < n) { el.appendChild(w.el('div', 'row')); changed = true; }
      if (stamps.length !== n) stamps = new Array(n).fill('\u0000');
      for (let i = 0; i < n; i++) {
        const s = stampOf(i);
        if (s === stamps[i]) continue;
        stamps[i] = s;
        const row = /** @type {HTMLElement} */ (el.children[i]);
        row.textContent = '';
        row.className = 'row';
        render(row, i);
        changed = true;
      }
      if (changed) {
        nav.refresh();
        if (nav.index >= n) nav.focus(n - 1, true);
      }
      return changed;
    },
    /** 다음 set 이 모든 행을 다시 그린다 */
    invalidate() { stamps = []; },
    /** @param {number} [i] */
    focus(i) {
      const n = el.children.length;
      if (!n) return;
      nav.focus(Math.max(0, Math.min(n - 1, i ?? (nav.index >= 0 ? nav.index : 0))));
    },
    blur() { nav.blur(); },
    /** @param {KeyboardEvent} e */
    handleKey(e) { return nav.handleKey(e); },
    /** @param {number} i */
    rectOf(i) { return /** @type {HTMLElement|undefined} */ (el.children[i])?.getBoundingClientRect?.() ?? null; },
    dispose() { nav.destroy(); el.remove(); },
  };
  return list;
}
