// OWNER: P11 — 계약 §10.2 · §10.5-8 · §10.6 · §10.7 (P11 내부 — 대장장이 · 잡화상 · 신비술사가 같이 쓰는 상점 틀)
// 머리(인사 · 골드 · 재료 · 일괄 수리 R · 일괄 판매 V) · [탭] · 왼쪽 영역(행 목록) · 오른쪽 가방 격자(pnlBagGrid) · 옆 칸(전 · 후 표 · 정보) · 실패 사유 줄.
// 영역 둘: 방향키가 끝을 넘으면 옆 영역 · KeyE 로 바꾸기. 가방 영역: X 팔기 · D 분해(대장장이) · L 잠금 · Enter 장착. V 일괄 판매 · R 수리는 어디서나.
// 모든 거래가 전 · 후를 나란히(골드 · 재료 · 수량) — 포커스한 것의 거래가 옆 칸의 표에 늘 보인다(툴팁은 장비 변화 줄).

import { EV } from '../core/events.js';
import { KEYBINDS, PANEL_KEYS } from '../data/keybinds.js';
import { priceSell, salvageYield } from '../sim/progression/shops.js';
import { fmtInt } from './format.js';
import { itemLines, lineText } from './itemText.js';
import { createAreas, createBagGrid, createItemList } from './pnlBagGrid.js';
import { costRows, createErrorLine, createTradeBox, createWallet, hintLine, isDown, numRow } from './pnlCommon.js';
import { bulkSellPlan, repairPlan } from './pnlLogic.js';
import { besideBoxes, createTooltip } from './tooltip.js';

/** @typedef {import('../types.js').Item} Item */

const IK = PANEL_KEYS.inventory;
const NAV = [KEYBINDS.up, KEYBINDS.down, KEYBINDS.left, KEYBINDS.right, 'Enter', 'NumpadEnter', 'Space'];

/**
 * @param {{root:HTMLElement, sim:any, bus:any, settings:any, actions:any, t:(key:string, params?:Object) => string, ui:any, widgets:any}} ctx
 * @param {{id:string, className?:string, greet?:string, tabs?:string[], leftHead?:string, sell?:boolean, salvage?:boolean, repair?:boolean, bulk?:boolean, mats?:boolean,
 *          onPick:(i:number, via:string) => void, leftTrade:(i:number) => {title:string, rows:any[]}|null, leftItem?:(i:number) => ({item:Item, price?:any, where?:string}|null),
 *          onTab?:(i:number) => void, onKey?:(e:KeyboardEvent) => boolean, extraKeys?:string[], onUpdate?:(state:any) => void, onFocusChange?:() => void}} opts
 */
export function createShopFrame(ctx, opts) {
  const { t, widgets: w, sim } = ctx;
  const el = w.panelFrame('panel.' + opts.id + '.title');
  el.dataset.panel = opts.id;
  el.classList.add('pnl-shop');
  if (opts.className) el.classList.add(opts.className);
  const tip = createTooltip(ctx);
  const topRow = el.appendChild(w.el('div', 'shop-top'));
  if (opts.greet) topRow.appendChild(w.el('div', 'shop-greet', t(opts.greet)));
  const wallet = createWallet(ctx, { mats: opts.mats !== false });
  topRow.appendChild(wallet.el);
  const actions = topRow.appendChild(w.el('div', 'shop-actions'));
  /** @type {HTMLButtonElement|null} */
  let repairBtn = null;
  /** @type {HTMLButtonElement|null} */
  let bulkBtn = null;
  if (opts.repair) repairBtn = actions.appendChild(w.button('', () => repair(), PANEL_KEYS.blacksmith.repair));
  if (opts.bulk !== false) bulkBtn = actions.appendChild(w.button('shop.bulkSell', () => bulkSell(), IK.sellAll));

  /** @type {any} */
  let tabCtl = null;
  if (opts.tabs?.length) {
    const tabsEl = el.appendChild(w.el('div', 'tabs'));
    tabCtl = w.tabs(tabsEl, opts.tabs, (i) => { err.clear(); list.invalidate(); opts.onTab?.(i); frame.markDirty(); });
  }
  const body = el.appendChild(w.el('div', 'two-col'));
  const leftCol = body.appendChild(w.el('div', 'shop-left'));
  const leftBox = leftCol.appendChild(w.el('div', 'area'));
  const leftHead = leftBox.appendChild(w.el('div', 'area-head', opts.leftHead ? t(opts.leftHead) : ''));
  if (!opts.leftHead) leftHead.hidden = true;
  const list = createItemList(ctx, {
    onPick: (i, via) => { err.clear(); opts.onPick(i, via); frame.markDirty(); },
    onFocus: () => { areas.pointer(0); focusChanged(); },
    onEdge: (dir) => areas.cross(dir),
  });
  leftBox.appendChild(list.el);
  const bagBox = body.appendChild(w.el('div', 'area area-bag'));
  bagBox.appendChild(w.el('div', 'area-head', t('panel.inventory.title')));
  const bag = createBagGrid(ctx, {
    onPick: (i) => { if (bag.itemAt(i)) done(sim.equip({ where: 'bag', idx: i })); },
    onFocus: () => { areas.pointer(1); focusChanged(); },
    onEdge: (dir) => areas.cross(dir),
    onDrop: (src, dst) => { if (src.kind === 'bag' && dst.kind === 'bag') done(sim.moveItem({ where: 'bag', idx: src.idx }, { where: 'bag', idx: dst.idx })); },
  });
  bagBox.appendChild(bag.el);
  const trade = createTradeBox(ctx);
  leftCol.appendChild(trade.el);
  const side = body.appendChild(w.el('div', 'shop-side'));
  const extra = side.appendChild(w.el('div', 'shop-info'));
  const repairBox = createTradeBox(ctx);
  side.appendChild(repairBox.el);
  const bulkBox = createTradeBox(ctx);
  side.appendChild(bulkBox.el);
  const foot = el.appendChild(w.el('div', 'panel-foot'));
  const err = createErrorLine(ctx);
  foot.appendChild(err.el);
  const hints = ['inv.area'];
  if (opts.sell !== false) hints.push('inv.sell');
  if (opts.salvage) hints.push('inv.salvage');
  hints.push('inv.lock');
  if (opts.bulk !== false) hints.push('shop.bulkSell');
  foot.appendChild(hintLine(ctx, hints));

  const areas = createAreas([
    { el: list.el, box: leftBox, focus: () => list.focus(), handleKey: (e) => list.handleKey(e) },
    { el: bag.el, box: bagBox, focus: () => bag.focus(), handleKey: (e) => bag.handleKey(e) },
  ], () => focusChanged());

  let dirty = true;
  /** @type {Array<() => void>} */
  const offs = [];
  if (ctx.bus) {
    const mark = () => { dirty = true; };
    for (const name of [EV.BAG, EV.GOLD, EV.MATERIALS, EV.EQUIPPED, EV.STATS_CHANGED, EV.TRADE, EV.LEVEL_UP]) offs.push(ctx.bus.on(name, mark));
  }

  /** 포커스한 가방 칸 */
  function bagFocus() {
    const i = bag.index;
    const item = i >= 0 ? bag.itemAt(i) : null;
    return { i, item, ref: item ? { where: 'bag', idx: i } : null };
  }

  /** 왼쪽 행의 툴팁 자리 — 가로는 왼쪽 칸 전체(전 · 후 표를 덮지 않게) · 세로는 그 행 @param {number} i */
  function rowRect(i) {
    // 왼쪽 칸 + 가방 상자 밖에 — 처음 열 때(재고 첫 줄 포커스) 카드가 가방을 덮지 않게(화면 패스)
    return besideBoxes(list.rectOf(i), leftCol, bagBox, side);
  }

  /** 포커스가 바뀌었다 — 툴팁 · 전 · 후 표 */
  function focusChanged() {
    const char = sim?.state?.char ?? null;
    if (areas.index === 1) {
      const f = bagFocus();
      if (f.item && el.isConnected) tip.show(f.item, 0, 0, { rect: besideBoxes(bag.rectOf(f.i), bagBox, side), where: 'bag' });
      else tip.hide();
      if (f.item && char && f.item.flags?.locked) trade.set([], '');      // 잠긴 것은 팔기 · 분해에서 빠진다(칸의 자물쇠 · 사유는 누를 때)
      else if (f.item && char) {
        const rows = [];
        if (opts.sell !== false) {
          const p = priceSell(f.item);
          rows.push({ ...numRow(t('inv.sell'), char.gold, char.gold + p) });
        }
        if (opts.salvage) {
          const y = salvageYield(f.item);
          for (const m of Object.keys(y)) {
            const have = Number(char.materials?.[m]) || 0;
            rows.push(numRow(t('inv.salvage') + ' · ' + t('mat.' + m), have, have + (y[/** @type {any} */ (m)] ?? 0)));
          }
        }
        trade.set(rows, t('inv.gold'));
      } else trade.clear();
    } else {
      const i = list.index;
      const li = i >= 0 ? opts.leftItem?.(i) ?? null : null;
      if (li?.item && el.isConnected) tip.show(li.item, 0, 0, { rect: rowRect(i), where: li.where ?? 'stock', price: li.price ?? null });
      else tip.hide();
      const tr = i >= 0 ? opts.leftTrade(i) : null;
      if (tr) trade.set(tr.rows, tr.title);
      else trade.clear();
    }
    opts.onFocusChange?.();
  }

  /** 명령 결과 @param {any} res */
  function done(res) {
    err.show(res);
    dirty = true;
    bag.markDirty();
    return res;
  }

  function sellFocused() {
    const f = bagFocus();
    if (!f.ref) return;
    done(sim.sell(f.ref));
  }
  function salvageFocused() {
    const f = bagFocus();
    if (!f.ref || !f.item) return;
    const run = () => done(sim.salvage(f.ref));
    // 전설 · 세트 분해는 되돌릴 수 없다 — 확인(되사기도 없다)
    if (f.item.rarity === 'legendary' || f.item.rarity === 'set') {
      w.confirm('shop.salvageConfirm', { name: lineText(itemLines(f.item)[0]) }).then((ok) => { if (ok) run(); });
    } else run();
  }
  function lockFocused() {
    const f = bagFocus();
    if (!f.ref || !f.item) return;
    done(sim.setItemLocked(f.ref, !f.item.flags?.locked));
  }
  function bulkSell() {
    const char = sim?.state?.char;
    const plan = bulkSellPlan(char, sim?.getStats?.() ?? null);
    if (!plan.count) { err.show({ ok: false, reason: 'nothing' }); return; }
    w.confirm('shop.bulkSellConfirm', { n: plan.count, g: fmtInt(plan.gold) }).then((ok) => {
      if (ok) done(sim.sellMany(plan.refs));
    });
  }
  function repair() {
    done(sim.repairAll());
  }

  /** 머리 버튼 · 수리 · 일괄 판매 표 @param {any} char */
  function renderHead(char) {
    if (repairBtn) {
      const rp = repairPlan(char);
      if (rp.nothing) { repairBtn.textContent = t('shop.repairNothing'); repairBtn.disabled = true; repairBox.clear(); }
      else if (rp.canFull) {
        repairBtn.textContent = t('shop.repair', { n: fmtInt(rp.full) });
        repairBtn.disabled = false;
        repairBox.set(costRows(t, char, -rp.full), t('shop.repair', { n: fmtInt(rp.full) }));
      } else {
        repairBtn.textContent = rp.partialSlots.length ? t('shop.repairPartial', { n: fmtInt(rp.partialCost) }) : t('shop.repair', { n: fmtInt(rp.full) });
        repairBtn.disabled = false;
        repairBox.set(costRows(t, char, -rp.partialCost), rp.partialSlots.length ? t('shop.repairPartial', { n: fmtInt(rp.partialCost) }) : t('shop.repair', { n: fmtInt(rp.full) }));
      }
    }
    if (bulkBtn) {
      const plan = bulkSellPlan(char, sim?.getStats?.() ?? null);
      bulkBtn.disabled = plan.count === 0;
      if (plan.count) bulkBox.set([numRow(t('inv.gold'), char?.gold ?? 0, (char?.gold ?? 0) + plan.gold)], t('shop.bulkSellConfirm', { n: plan.count, g: fmtInt(plan.gold) }));
      else bulkBox.clear();
    }
  }

  const KEYS = [...NAV, IK.area, IK.sell, IK.lock, IK.sellAll, KEYBINDS.tabPrev, KEYBINDS.tabNext, ...(opts.salvage ? [IK.salvage] : []), ...(opts.repair ? [PANEL_KEYS.blacksmith.repair] : []), ...(opts.extraKeys ?? [])];

  const frame = {
    el, list, bag, areas, tip, trade, extra, err, side, wallet,
    get tab() { return tabCtl ? tabCtl.index : 0; },
    keys: KEYS,
    markDirty() { dirty = true; },
    done,
    focusChanged,
    /** @param {any} args */
    open(args) {
      void args;
      err.clear();
      dirty = true;
      list.invalidate();
      bag.markDirty();
      if (tabCtl) tabCtl.select(0, true);
      opts.onTab?.(0);
      areas.set(0, false);
      list.focus(0);
    },
    close() { tip.hide(); },
    /** @param {any} state */
    update(state) {
      const changed = bag.update(state);
      wallet.update(state?.char);
      if (changed) dirty = true;
      if (!dirty) return;
      dirty = false;
      renderHead(state?.char ?? null);
      opts.onUpdate?.(state);
      if (areas.index === 0 && list.index < 0 && list.count) list.nav.focus(0, true);
      focusChanged();
    },
    /** @param {KeyboardEvent} e */
    handleKey(e) {
      const code = e.code;
      if (opts.onKey?.(e)) return true;
      if (code === KEYBINDS.pause) return false;
      if (!isDown(e)) return KEYS.includes(code);
      if (e.repeat && (code === 'Enter' || code === 'NumpadEnter' || code === 'Space')) return true;   // 누르고 있어도 거래는 한 번
      if (NAV.includes(code)) return areas.handleKey(e);
      if (e.repeat) return KEYS.includes(code);
      if (code === IK.area) { areas.toggle(); return true; }
      if (code === KEYBINDS.tabPrev || code === KEYBINDS.tabNext) {
        if (tabCtl) tabCtl.select(tabCtl.index + (code === KEYBINDS.tabNext ? 1 : -1));
        return true;
      }
      if (code === IK.sellAll && opts.bulk !== false) { bulkSell(); return true; }
      if (opts.repair && code === PANEL_KEYS.blacksmith.repair) { repair(); return true; }
      if (areas.index === 1) {
        if (code === IK.sell && opts.sell !== false) { sellFocused(); return true; }
        if (code === IK.salvage && opts.salvage) { salvageFocused(); return true; }
        if (code === IK.lock) { lockFocused(); return true; }
      }
      return KEYS.includes(code);
    },
    dispose() {
      for (const off of offs) off();
      offs.length = 0;
      tip.dispose();
      list.dispose();
      bag.dispose();
      tabCtl?.destroy();
      el.remove();
    },
  };
  return frame;
}
