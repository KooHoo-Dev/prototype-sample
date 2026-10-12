// OWNER: P11 — 계약 §10.1 · §10.2 · §10.5 · §10.6
// 인벤토리(겹쳐 보는 패널 · KeyI): 왼쪽 장비 10칸(인형 배치) · 오른쪽 가방 8 × 5 · 골드 · 재료.
// 칸을 고르면(마우스 위 · 방향키) 툴팁(장착 중인 것과 나란히 · 변화 줄). Enter(또는 클릭) = 장착/해제 · L = 잠금 · Z = 정렬 · E = 영역 바꾸기.
// 끌어서 놓기: 가방 → 가방(자리 바꿈) · 가방 → 장비 칸(그 칸에 장착) · 장비 → 가방(해제). 실패는 패널 안에 reason 문면.

import { KEYBINDS, PANEL_KEYS } from '../../data/keybinds.js';
import { createAreas, createBagGrid, createItemGrid } from '../pnlBagGrid.js';
import { createErrorLine, createWallet, hintLine, isDown } from '../pnlCommon.js';
import { createTooltip, spanBoxes } from '../tooltip.js';

/** @typedef {import('../../types.js').Panel} Panel */

/** 인형 배치(3 × 4 · null = 빈 자리) */
const DOLL = ['', 'helm', 'amulet', 'mainHand', 'chest', 'offhand', 'gloves', 'belt', 'ring1', '', 'boots', 'ring2'].map((s) => s || null);
const PK = PANEL_KEYS.inventory;
/** 인형 칸의 아이템(매 프레임 새 배열을 만들지 않는다) @type {Array<any>} */
const dollItems = new Array(DOLL.length).fill(null);
const NAV_KEYS = [KEYBINDS.up, KEYBINDS.down, KEYBINDS.left, KEYBINDS.right, 'Enter', 'NumpadEnter'];

/**
 * @param {{root:HTMLElement, sim:any, bus:any, settings:any, actions:any, t:(key:string, params?:Object) => string, ui:any, widgets:any}} ctx
 * @returns {Panel}
 */
export function createInventoryPanel(ctx) {
  const { t, widgets: w, sim } = ctx;
  const el = w.panelFrame('panel.inventory.title');
  el.dataset.panel = 'inventory';
  el.classList.add('pnl-inv');
  const tip = createTooltip(ctx);
  const body = el.appendChild(w.el('div', 'two-col'));
  const dollBox = body.appendChild(w.el('div', 'area area-doll'));
  dollBox.appendChild(w.el('div', 'area-head', t('inv.compare')));
  const bagBox = body.appendChild(w.el('div', 'area area-bag'));
  bagBox.appendChild(w.el('div', 'area-head', t('panel.inventory.title')));
  const foot = el.appendChild(w.el('div', 'panel-foot'));
  const wallet = createWallet(ctx);
  const btns = w.el('div', 'btn-row btn-row-left');
  btns.appendChild(w.button('inv.sort', () => sort(), PK.sort));
  btns.appendChild(w.button('inv.lock', () => toggleLock(), PK.lock));
  btns.appendChild(w.button('inv.areaEquip', () => areas.toggle(), PK.area));
  const err = createErrorLine(ctx);
  foot.appendChild(wallet.el);
  foot.appendChild(btns);
  foot.appendChild(err.el);
  foot.appendChild(hintLine(ctx, ['inv.equip', 'inv.unequip', 'inv.lock', 'inv.sort', 'inv.areaEquip']));

  const doll = createItemGrid(ctx, {
    kind: 'equip', cols: 3, rows: 4, slots: DOLL, className: 'grid-doll',
    items: (state) => {
      const eq = state?.char?.equip;
      for (let i = 0; i < DOLL.length; i++) dollItems[i] = DOLL[i] && eq ? eq[/** @type {string} */ (DOLL[i])] ?? null : null;
      return dollItems;
    },
    cellLabel: (i) => (DOLL[i] ? t('slot.' + DOLL[i]) : ''),
    onPick: (i) => unequipAt(i),
    onFocus: (i) => { areas.pointer(0); showTip(); err.clear(); void i; },
    onEdge: (dir) => areas.cross(dir),
    onDrop: (src, dst) => drop(src, dst),
  });
  const bag = createBagGrid(ctx, {
    onPick: (i) => equipAt(i),
    onFocus: () => { areas.pointer(1); showTip(); err.clear(); },
    onEdge: (dir) => areas.cross(dir),
    onDrop: (src, dst) => drop(src, dst),
  });
  dollBox.appendChild(doll.el);
  bagBox.appendChild(bag.el);
  const areas = createAreas([
    { el: doll.el, box: dollBox, focus: () => doll.focus(), handleKey: (e) => doll.handleKey(e) },
    { el: bag.el, box: bagBox, focus: () => bag.focus(), handleKey: (e) => bag.handleKey(e) },
  ], () => showTip());

  /** 지금 포커스 칸의 아이템 · 참조 */
  function focused() {
    if (areas.index === 0) {
      const i = doll.index;
      const slot = i >= 0 ? DOLL[i] : null;
      const item = slot ? sim?.state?.char?.equip?.[slot] ?? null : null;
      return { item, ref: slot ? { where: 'equip', slot } : null, grid: doll, i };
    }
    const i = bag.index;
    return { item: i >= 0 ? bag.itemAt(i) : null, ref: i >= 0 ? { where: 'bag', idx: i } : null, grid: bag, i };
  }

  function showTip() {
    const f = focused();
    if (!f.item || !el.isConnected) { tip.hide(); return; }
    // 패널이 화면 오른쪽에 붙는다(hud.css) — 카드는 패널 밖(왼쪽)에 · 가운데의 플레이어는 비켜서(가방도 플레이어도 덮지 않게)
    tip.show(f.item, 0, 0, { rect: spanBoxes(f.grid.rectOf(f.i), dollBox, bagBox), clearCenter: true, where: areas.index === 0 ? 'equip' : 'bag' });
  }

  /** 명령 결과 — 실패면 사유 · 성공이면 지운다 @param {any} res */
  function done(res) {
    err.show(res);
    // 상태가 바뀌었으면 다음 update 가 다시 그린다 — 툴팁도 그때 새로
    doll.markDirty();
    bag.markDirty();
    pendingTip = true;
    return res;
  }
  let pendingTip = false;

  /** @param {number} i */
  function equipAt(i) {
    if (!bag.itemAt(i)) return;
    done(sim.equip({ where: 'bag', idx: i }));
  }
  /** @param {number} i */
  function unequipAt(i) {
    const slot = DOLL[i];
    if (!slot || !sim?.state?.char?.equip?.[slot]) return;
    done(sim.unequip(slot));
  }
  function sort() { done(sim.sortBag()); }
  function toggleLock() {
    const f = focused();
    if (!f.item || !f.ref) return;
    done(sim.setItemLocked(f.ref, !f.item.flags?.locked));
  }
  /** @param {{kind:string, idx:number}} src @param {{kind:string, idx:number}} dst */
  function drop(src, dst) {
    if (src.kind === 'bag' && dst.kind === 'bag') done(sim.moveItem({ where: 'bag', idx: src.idx }, { where: 'bag', idx: dst.idx }));
    else if (src.kind === 'bag' && dst.kind === 'equip' && DOLL[dst.idx]) done(sim.equip({ where: 'bag', idx: src.idx }, DOLL[dst.idx]));
    else if (src.kind === 'equip' && dst.kind === 'bag' && DOLL[src.idx]) done(sim.unequip(DOLL[src.idx]));
  }

  const KEYS = [...NAV_KEYS, PK.sort, PK.lock, PK.area, KEYBINDS.pause, KEYBINDS.inventory];

  return {
    id: 'inventory',
    modal: false,
    el,
    open() {
      err.clear();
      doll.markDirty();
      bag.markDirty();
      areas.set(1, false);
      bag.focus(bag.index >= 0 ? bag.index : 0);
      pendingTip = true;
    },
    close() { tip.hide(); },
    update(state) {
      const a = doll.update(state);
      const b = bag.update(state);
      wallet.update(state?.char);
      if (a || b || pendingTip) { pendingTip = false; showTip(); }
    },
    handleKey(e) {
      const code = e.code;
      if (!isDown(e)) return KEYS.includes(code) && code !== KEYBINDS.pause && code !== KEYBINDS.inventory;
      if (code === KEYBINDS.pause || code === KEYBINDS.inventory) return false;
      if (e.repeat && (code === PK.sort || code === PK.lock || code === PK.area || code === 'Enter' || code === 'NumpadEnter')) return true;
      if (code === PK.area) { areas.toggle(); return true; }
      if (code === PK.sort) { sort(); return true; }
      if (code === PK.lock) { toggleLock(); return true; }
      if (NAV_KEYS.includes(code)) return areas.handleKey(e);
      return false;
    },
    keys: KEYS,
    dispose() { tip.dispose(); doll.dispose(); bag.dispose(); el.remove(); },
  };
}
