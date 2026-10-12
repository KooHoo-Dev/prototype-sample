// OWNER: P11 — 계약 §10.6(툴팁)
// 아이템 툴팁(떠 있는 카드) — 그 아이템 카드 + 장착 중인 것(같은 부위 · 반지는 둘 다)을 나란히 + 변화 줄(시트 DPS · 생명 · 방어도 · 저항 넷 — 녹/적).
// 고급 툴팁(Alt 누름 · LABELS 이벤트 · 또는 설정 advancedTooltips): 옵션마다 [티어 n a–b].
// 고른 칸(마우스 위 · 방향키)의 화면 사각형 옆에 띄운다 — 화면 밖으로 나가지 않게. 마우스를 막지 않는다(pointer-events none).

import { EV } from '../core/events.js';
import { compareEquip } from '../sim/loot/compare.js';
import { compareLabel, compareLines, itemLines, lineText } from './itemText.js';

/** @typedef {import('../types.js').Item} Item */

const GAP = 10;          // 칸과 카드 사이(px)
const EDGE = 8;          // 화면 가장자리 여유(px)
const TIP_ROOM = 300;    // 툴팁 카드 폭(쌓은 꼴 · 대략 px) — besideBoxes 가 자리를 볼 때

/** @param {string} tag @param {string} cls @param {string} [text] */
function mk(tag, cls, text) {
  const e = document.createElement(tag);
  e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/**
 * 카드 하나(이름 · 등급 · 기본 값 · 옵션 · …) @param {(k:string, p?:Object) => string} t @param {Item} item @param {any} opts @param {string|null} head
 * @returns {HTMLElement}
 */
function card(t, item, opts, head) {
  const box = mk('div', 'tip-card r-border-' + (item.rarity ?? 'normal'));
  if (head) box.appendChild(mk('div', 'tip-head', head));
  const lines = itemLines(item, { advanced: !!opts.advanced, char: opts.char ?? null, setCounts: opts.setCounts ?? null, price: opts.price ?? null, noPrice: !!opts.noPrice });
  for (const ln of lines) box.appendChild(mk('div', 'tip-line k-' + ln.kind + (ln.cls ? ' ' + ln.cls : '') + (ln.bad ? ' bad' : '') + (ln.fixed ? ' is-fixed' : ''), lineText(ln)));
  return box;
}

/** 변화 블록 @param {(k:string, p?:Object) => string} t @param {any} cmp @param {Item} item @param {string|null} head */
function deltaBlock(t, cmp, item, head) {
  const box = mk('div', 'tip-delta');
  box.appendChild(mk('div', 'tip-head', head ?? t('inv.delta')));
  for (const ln of compareLines(cmp, item)) {
    if (ln.kind === 'reason') {
      box.appendChild(mk('div', 'tip-line bad', t(ln.key, ln.params)));
      continue;
    }
    if (ln.zero) continue;
    const row = mk('div', 'tip-cmp ' + (ln.dir > 0 ? 'good' : ln.dir < 0 ? 'bad' : 'same'));
    row.appendChild(mk('span', 'tip-cmp-label', compareLabel(ln)));
    row.appendChild(mk('span', 'tip-cmp-val', `${ln.before} \u2192 ${ln.after}`));
    row.appendChild(mk('span', 'tip-cmp-d', ln.delta ?? ''));
    box.appendChild(row);
  }
  return box;
}

/**
 * 아이템 카드 묶음 — [장착 중인 것(같은 부위 · 반지는 둘 다)] [그 아이템 + 변화 줄]. 떠 있는 툴팁 · 도박 결과 · 제작 결과가 같이 쓴다.
 * @param {{t:(k:string, p?:Object) => string, sim?:any}} ctx @param {Item} item
 * @param {{char?:any, compare?:boolean, where?:string, price?:{key:string, n:number}|null, noPrice?:boolean, head?:string|null, advanced?:boolean, setCounts?:any, worn?:boolean}} [opts]
 * @returns {HTMLElement}
 */
export function itemCard(ctx, item, opts = {}) {
  const { t } = ctx;
  const char = opts.char ?? ctx.sim?.state?.char ?? null;
  const o = { ...opts, char, setCounts: opts.setCounts ?? ctx.sim?.getStats?.()?.setCounts ?? null };
  const row = mk('div', 'tip-row');
  /** @type {Array<{slot:string, item:Item}>} */
  const worn = [];
  const compare = opts.compare !== false && !!char && opts.where !== 'equip';
  if (compare && char.equip && opts.worn !== false) {
    const slots = item.slot === 'ring' ? ['ring1', 'ring2'] : [item.slot];
    for (const s of slots) {
      const w = char.equip[s];
      if (w && w !== item) worn.push({ slot: s, item: w });
    }
  }
  for (const w of worn) row.appendChild(card(t, w.item, { ...o, noPrice: true }, t('inv.compare') + ' \u00b7 ' + t('slot.' + w.slot)));
  const main = card(t, item, o, opts.head ?? null);
  if (compare) {
    try {
      const ringBoth = item.slot === 'ring' && char.equip?.ring1 && char.equip?.ring2;
      if (ringBoth) {
        for (const s of ['ring1', 'ring2']) main.appendChild(deltaBlock(t, compareEquip(char, item, { slot: s }), item, t('inv.delta') + ' \u00b7 ' + t('slot.' + s)));
      } else {
        main.appendChild(deltaBlock(t, compareEquip(char, item), item, null));
      }
    } catch (err) {
      queueMicrotask(() => { throw err; });
    }
  }
  row.appendChild(main);
  return row;
}

/**
 * 툴팁 자리 — 칸의 세로(top · bottom)는 그대로 · 가로는 격자 상자들 전체(left = 가장 왼쪽 · right = 가장 오른쪽).
 * 칸 바로 옆에 두면 키보드로 격자를 훑을 때 카드가 같은 격자(가방)를 덮었다(상점을 열면 첫 줄 툴팁이 가방을 가렸다 — NOTES-W2 · 화면 패스).
 * 상자들 밖(오른쪽 · 모자라면 왼쪽)에 놓이게 한다.
 * @param {{left:number, right:number, top:number, bottom:number}|null|undefined} cell
 * @param {...(Element|null|undefined)} boxes
 * @returns {{left:number, right:number, top:number, bottom:number, width:number, height:number}|null|undefined}
 */
export function besideBoxes(cell, ...boxes) {
  if (!cell) return cell;
  const vw = (typeof window !== 'undefined' && window.innerWidth) || 1280;
  let left = cell.left;
  let right = cell.right;
  // 앞의 상자부터 차례로 합친다 — 합친 오른쪽에 카드(TIP_ROOM px)가 들어갈 자리가 없으면 그 상자부터는 합치지 않는다
  // (왼쪽으로 넘기면 상점 왼쪽의 전 · 후 표를 덮는다 — 1280 폭에서는 오른쪽 끝의 일괄 판매 상자를 덮고 · 1920 에서는 그것도 비켜 선다)
  for (const b of boxes) {
    const r = b?.getBoundingClientRect?.();
    if (!r || !(r.width > 0)) continue;
    const l = Math.min(left, r.left);
    const rr = Math.max(right, r.right);
    if (vw - EDGE - GAP - rr < TIP_ROOM) break;
    left = l;
    right = rr;
  }
  return { left, right, top: cell.top, bottom: cell.bottom, width: right - left, height: cell.bottom - cell.top };
}

/**
 * 격자 상자들 전체(칸의 세로 · 상자들의 가로를 모두 합친다) — 화면 한쪽에 붙은 겹쳐 보는 패널(인벤토리)은 카드를 패널 밖에 둔다(가방을 덮지 않게).
 * @param {{left:number, right:number, top:number, bottom:number}|null|undefined} cell
 * @param {...(Element|null|undefined)} boxes
 */
export function spanBoxes(cell, ...boxes) {
  if (!cell) return cell;
  let left = cell.left;
  let right = cell.right;
  for (const b of boxes) {
    const r = b?.getBoundingClientRect?.();
    if (!r || !(r.width > 0)) continue;
    left = Math.min(left, r.left);
    right = Math.max(right, r.right);
  }
  return { left, right, top: cell.top, bottom: cell.bottom, width: right - left, height: cell.bottom - cell.top };
}

/** 화면 가운데(플레이어) 양옆으로 비워 둘 폭(px) — opts.clearCenter */
const CENTER_CLEAR = 44;

/**
 * 떠 있는 툴팁
 * @param {{root:HTMLElement, sim?:any, bus?:any, settings?:any, ui?:any, t:(k:string, p?:Object) => string}} ctx
 * @returns {{show:(item:Item|null, x:number, y:number, opts?:Object) => void, hide:() => void, refresh:() => void, dispose:() => void, el:HTMLElement, advanced:() => boolean}}
 */
export function createTooltip(ctx) {
  const el = document.createElement('div');
  el.className = 'tip';
  el.hidden = true;
  ctx.root.appendChild(el);
  let alt = false;
  /** @type {null|{item:Item, x:number, y:number, opts:any}} */
  let cur = null;
  /** @type {Array<() => void>} */
  const offs = [];
  /** @type {Array<() => void>} */
  const listeners = [];
  if (ctx.bus) {
    offs.push(ctx.bus.on(EV.LABELS, (e) => {
      const on = !!e?.on;
      if (on === alt) return;
      alt = on;
      if (cur) render();
      for (const fn of listeners) fn();
    }));
    offs.push(ctx.bus.on(EV.SETTINGS_CHANGED, () => {
      if (cur) render();
      for (const fn of listeners) fn();
    }));
  }

  const settings = () => ctx.ui?.settings ?? ctx.settings ?? {};
  const advanced = () => alt || !!settings().advancedTooltips;

  function render() {
    if (!cur) return;
    el.textContent = '';
    el.appendChild(itemCard(ctx, cur.item, { ...cur.opts, advanced: advanced() }));
    el.hidden = false;
    place();
  }

  /** 칸 사각형(opts.rect) 옆 — 오른쪽이 모자라면 왼쪽 · 위아래는 화면 안으로 */
  function place() {
    if (!cur) return;
    const vw = window.innerWidth || 1280;
    const vh = window.innerHeight || 720;
    el.style.left = '0px';
    el.style.top = '0px';
    // 위아래로 쌓기(그 아이템 위 · 장착 중인 것 아래 — 좁다) · 화면 높이를 넘으면 나란히
    el.classList.add('is-stack');
    let box = el.getBoundingClientRect();
    if (box.height > vh - 2 * EDGE) {
      el.classList.remove('is-stack');
      box = el.getBoundingClientRect();
    }
    const w = box.width;
    const h = box.height;
    const r = cur.opts.rect;
    let x;
    let y;
    if (r) {
      const right = vw - EDGE - r.right - GAP;
      const left = r.left - GAP - EDGE;
      if (w <= right) x = r.right + GAP;
      else if (w <= left) x = r.left - GAP - w;
      else x = right >= left ? vw - EDGE - w : EDGE;            // 어느 쪽도 모자라면 넓은 쪽 끝에 붙인다
      // 게임이 도는 겹쳐 보는 패널(인벤토리)의 카드는 화면 가운데의 플레이어를 덮지 않는다 — 가운데에 걸치면 그 왼쪽(또는 오른쪽)으로 비킨다
      if (cur.opts.clearCenter) {
        const c0 = vw / 2 - CENTER_CLEAR, c1 = vw / 2 + CENTER_CLEAR;
        if (x < c1 && x + w > c0) x = x + w / 2 < vw / 2 && c0 - w >= EDGE ? c0 - w : c1 + w <= vw - EDGE ? c1 : x;
      }
      y = r.top;
      if (x < r.right && x + w > r.left) y = r.bottom + GAP;     // 칸을 덮게 되면 칸 아래로
    } else {
      x = cur.x + GAP;
      y = cur.y + GAP;
      if (x + w > vw - EDGE) x = cur.x - GAP - w;
    }
    if (y + h > vh - EDGE) y = vh - EDGE - h;
    x = Math.max(EDGE, x);
    y = Math.max(EDGE, y);
    el.style.left = Math.round(x) + 'px';
    el.style.top = Math.round(y) + 'px';
  }

  return {
    el,
    advanced,
    /** 고급 툴팁(Alt · 설정)이 바뀌면 부른다 @param {() => void} fn */
    onAdvanced(fn) { listeners.push(fn); },
    /**
     * @param {Item|null} item @param {number} x @param {number} y
     * @param {{rect?:DOMRect, char?:any, compare?:boolean, where?:string, price?:{key:string, n:number}|null, noPrice?:boolean, head?:string|null}} [opts]
     */
    show(item, x, y, opts = {}) {
      if (!item) { this.hide(); return; }
      cur = { item, x: Number(x) || 0, y: Number(y) || 0, opts: opts ?? {} };
      render();
    },
    hide() {
      cur = null;
      el.hidden = true;
      el.textContent = '';
    },
    /** 같은 아이템을 다시 그린다(상태가 바뀌었을 때) */
    refresh() { if (cur) render(); },
    dispose() {
      for (const off of offs) off();
      offs.length = 0;
      cur = null;
      el.remove();
    },
  };
}
