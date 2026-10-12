// OWNER: P11 — 계약 §10.1 · §10.2 · §10.5-8 · §10.6
// 보관함(모달 · INTERACT{stash} — 계정 공유 60칸): 위 보관함 10 × 6 · 아래 가방 8 × 5(pnlBagGrid). 영역 둘 — 방향키가 위 · 아래 끝을 넘으면 옆 영역 · E 로 바꾸기.
// Enter · F = 옮기기(반대쪽의 빈 첫 칸) · Z = 포커스 영역 정렬 · L = 잠금 · 끌어서 놓기(가방 ↔ 보관함 · 같은 격자 안 자리 바꿈).

import { STASH_SIZE } from '../../core/constants.js';
import { KEYBINDS, PANEL_KEYS } from '../../data/keybinds.js';
import { createAreas, createBagGrid, createItemGrid } from '../pnlBagGrid.js';
import { createErrorLine, hintLine, isDown } from '../pnlCommon.js';
import { besideBoxes, createTooltip } from '../tooltip.js';

/** @typedef {import('../../types.js').Panel} Panel */

const IK = PANEL_KEYS.inventory;
const NAV = [KEYBINDS.up, KEYBINDS.down, KEYBINDS.left, KEYBINDS.right];
const OK = ['Enter', 'NumpadEnter', 'Space'];
const STASH_COLS = 10;

/**
 * @param {{root:HTMLElement, sim:any, bus:any, settings:any, actions:any, t:(key:string, params?:Object) => string, ui:any, widgets:any}} ctx
 * @returns {Panel}
 */
export function createStashPanel(ctx) {
  const { t, widgets: w, sim } = ctx;
  const el = w.panelFrame('panel.stash.title');
  el.dataset.panel = 'stash';
  el.classList.add('pnl-stash');
  const tip = createTooltip(ctx);
  const stashBox = el.appendChild(w.el('div', 'area'));
  const stashHead = stashBox.appendChild(w.el('div', 'area-head'));
  const bagBox = el.appendChild(w.el('div', 'area'));
  const bagHead = bagBox.appendChild(w.el('div', 'area-head'));
  const foot = el.appendChild(w.el('div', 'panel-foot'));
  const err = createErrorLine(ctx);
  foot.appendChild(err.el);
  foot.appendChild(hintLine(ctx, ['inv.toStash', 'inv.sort', 'inv.lock', 'inv.area']));

  const stash = createItemGrid(ctx, {
    kind: 'stash', cols: STASH_COLS, rows: Math.ceil(STASH_SIZE / STASH_COLS), upgrades: true,
    items: (state) => state?.account?.stash ?? [],
    onPick: (i) => move(0, i),
    onFocus: () => { areas.pointer(0); showTip(); },
    onEdge: (dir) => areas.cross(dir),
    onDrop: (src, dst) => drop(src, dst),
  });
  const bag = createBagGrid(ctx, {
    onPick: (i) => move(1, i),
    onFocus: () => { areas.pointer(1); showTip(); },
    onEdge: (dir) => areas.cross(dir),
    onDrop: (src, dst) => drop(src, dst),
  });
  stashBox.appendChild(stash.el);
  bagBox.appendChild(bag.el);
  const areas = createAreas([
    { el: stash.el, box: stashBox, axis: 'v', focus: () => stash.focus(), handleKey: (e) => stash.handleKey(e) },
    { el: bag.el, box: bagBox, axis: 'v', focus: () => bag.focus(), handleKey: (e) => bag.handleKey(e) },
  ], () => showTip());

  /** @param {any} state */
  function heads(state) {
    const st = state?.account?.stash ?? [];
    const bg = state?.char?.bag ?? [];
    let a = 0;
    let b = 0;
    for (const x of st) if (x) a++;
    for (const x of bg) if (x) b++;
    stashHead.textContent = `${t('shop.stashTitle')}  ${a}/${st.length || STASH_SIZE}`;
    bagHead.textContent = `${t('panel.inventory.title')}  ${b}/${bg.length}`;
  }

  function focused() {
    const g = areas.index === 0 ? stash : bag;
    const i = g.index;
    const item = i >= 0 ? g.itemAt(i) : null;
    return { g, i, item, ref: item ? { where: areas.index === 0 ? 'stash' : 'bag', idx: i } : null };
  }

  function showTip() {
    err.clear();
    const f = focused();
    if (!f.item || !el.isConnected) { tip.hide(); return; }
    tip.show(f.item, 0, 0, { rect: besideBoxes(f.g.rectOf(f.i), stashBox, bagBox), where: f.ref?.where });
  }

  /** @param {any} res */
  function done(res) {
    err.show(res);
    stash.markDirty();
    bag.markDirty();
    pending = true;
  }
  let pending = false;

  /** 반대쪽의 빈 첫 칸으로 @param {number} area @param {number} i */
  function move(area, i) {
    const g = area === 0 ? stash : bag;
    if (!g.itemAt(i)) return;
    if (area === 0) done(sim.moveItem({ where: 'stash', idx: i }, { where: 'bag' }));
    else done(sim.moveItem({ where: 'bag', idx: i }, { where: 'stash' }));
  }
  /** @param {{kind:string, idx:number}} src @param {{kind:string, idx:number}} dst */
  function drop(src, dst) {
    done(sim.moveItem({ where: src.kind, idx: src.idx }, { where: dst.kind, idx: dst.idx }));
  }

  const KEYS = [...NAV, ...OK, IK.stash, IK.sort, IK.lock, IK.area, KEYBINDS.pause];

  return {
    id: 'stash',
    modal: true,
    el,
    open() {
      err.clear();
      stash.markDirty();
      bag.markDirty();
      areas.set(1, false);
      bag.focus(0);
      pending = true;
    },
    close() { tip.hide(); },
    update(state) {
      const a = stash.update(state);
      const b = bag.update(state);
      if (a || b) heads(state);
      if (a || b || pending) { pending = false; showTip(); }
    },
    handleKey(e) {
      const code = e.code;
      if (code === KEYBINDS.pause) return false;
      if (!isDown(e)) return KEYS.includes(code);
      if (NAV.includes(code)) return areas.handleKey(e);
      if (e.repeat) return KEYS.includes(code);   // 옮기기 · 정렬 · 잠금은 누름 한 번에 한 번
      if (OK.includes(code) || code === IK.stash) {
        const f = focused();
        if (f.i >= 0) move(areas.index, f.i);
        return true;
      }
      if (code === IK.area) { areas.toggle(); return true; }
      if (code === IK.sort) { done(areas.index === 0 ? sim.sortStash() : sim.sortBag()); return true; }
      if (code === IK.lock) {
        const f = focused();
        if (f.ref && f.item) done(sim.setItemLocked(f.ref, !f.item.flags?.locked));
        return true;
      }
      return false;
    },
    keys: KEYS,
    dispose() { tip.dispose(); stash.dispose(); bag.dispose(); el.remove(); },
  };
}
