// OWNER: P11 — 계약 §10.1 · §10.2 · §10.5-8 · §10.6
// 잡화상(모달 · INTERACT{npc general}): 체력 포션 · 귀환 두루마리(수량 −/+ = Minus · Equal · 상한까지 · 가격) · 무료 받기(자격일 때만 보인다) · 장신구 재고 4 ·
// 일괄 판매 V · 오른쪽에 가방 격자(X 팔기 · L 잠금 · Enter 장착). 옆 칸: 포커스한 거래의 전 · 후(골드 · 개수).

import { ECON } from '../../data/economy.js';
import { PANEL_KEYS } from '../../data/keybinds.js';
import { canTakeFree, priceBuy, pricePotion, priceScroll } from '../../sim/progression/shops.js';
import { fmtInt } from '../format.js';
import { tName } from '../i18n.js';
import { costRows, isDown, numRow } from '../pnlCommon.js';
import { upgradeOf } from '../pnlLogic.js';
import { createShopFrame } from '../pnlShop.js';

/** @typedef {import('../../types.js').Panel} Panel */

const GK = PANEL_KEYS.general;
/** 소모품 → 상한 · 가격 · 이름 */
const CONSUM = {
  potion: { max: ECON.potionMax, price: pricePotion, label: 'shop.potions', have: (ch) => ch.potions },
  scroll: { max: ECON.scrollMax, price: priceScroll, label: 'shop.scrolls', have: (ch) => ch.scrolls },
};

/**
 * @param {{root:HTMLElement, sim:any, bus:any, settings:any, actions:any, t:(key:string, params?:Object) => string, ui:any, widgets:any}} ctx
 * @returns {Panel}
 */
export function createGeneralPanel(ctx) {
  const { t, widgets: w, sim, ui } = ctx;
  const char = () => sim?.state?.char ?? null;
  /** @type {Array<{kind:'potion'|'scroll'|'free'|'item', what?:'potion'|'scroll', idx?:number}>} */
  let rows = [];
  /** 수량(소모품 행) */
  const qty = { potion: 1, scroll: 1 };
  let qtyInit = false;

  /** @param {'potion'|'scroll'} what */
  function room(what) {
    const ch = char();
    if (!ch) return 0;
    const c = CONSUM[what];
    return Math.max(0, c.max - (Number(c.have(ch)) || 0));
  }
  /** 기본 수량 = 상한까지 · 골드가 되는 만큼(최소 1) @param {'potion'|'scroll'} what */
  function defaultQty(what) {
    const ch = char();
    const r = room(what);
    const p = ch ? CONSUM[what].price(ch) : 0;
    const afford = p > 0 ? Math.floor((ch?.gold ?? 0) / p) : r;
    return Math.max(1, Math.min(r, afford));
  }
  /** @param {'potion'|'scroll'} what */
  function clampQty(what) { qty[what] = Math.max(1, Math.min(Math.max(1, room(what)), qty[what] | 0)); }

  function buildRows() {
    const ch = char();
    rows = [];
    if (!ch) return;
    rows.push({ kind: 'potion', what: 'potion' }, { kind: 'scroll', what: 'scroll' });
    if (canTakeFree(ch, 'potion')) rows.push({ kind: 'free', what: 'potion' });
    if (canTakeFree(ch, 'scroll')) rows.push({ kind: 'free', what: 'scroll' });
    const stock = ch.shop?.general ?? [];
    for (let i = 0; i < stock.length; i++) rows.push({ kind: 'item', idx: i });
  }

  const f = createShopFrame(ctx, {
    id: 'general', className: 'pnl-general', greet: 'npc.general.greet', mats: false,
    sell: true, salvage: false, repair: false,
    extraKeys: [GK.more, GK.less],
    onPick: (i) => pick(i),
    leftItem: (i) => {
      const r = rows[i];
      const ch = char();
      if (!r || r.kind !== 'item' || !ch) return null;
      const it = ch.shop?.general?.[/** @type {number} */ (r.idx)];
      return it ? { item: it, where: 'stock', price: { key: 'shop.gambleSlotPrice', n: priceBuy(it), pkeys: { slot: 'shop.buy' } } } : null;
    },
    leftTrade: (i) => {
      const r = rows[i];
      const ch = char();
      if (!r || !ch) return null;
      if (r.kind === 'item') {
        const it = ch.shop?.general?.[/** @type {number} */ (r.idx)];
        return it ? { title: t('shop.buy'), rows: costRows(t, ch, -priceBuy(it)) } : null;
      }
      const what = /** @type {'potion'|'scroll'} */ (r.what);
      const c = CONSUM[what];
      const have = Number(c.have(ch)) || 0;
      if (r.kind === 'free') return { title: t('shop.free'), rows: [numRow(t(c.label), have, have + 1)] };
      const q = room(what) > 0 ? qty[what] : 0;
      return { title: t('shop.qty', { n: q }), rows: [...costRows(t, ch, -q * c.price(ch)), numRow(t(c.label), have, have + q)] };
    },
    onKey: (e) => {
      if (e.code !== GK.more && e.code !== GK.less) return false;
      if (!isDown(e)) return true;
      const r = rows[f.list.index];
      if (f.areas.index !== 0 || !r || (r.kind !== 'potion' && r.kind !== 'scroll')) return true;
      const what = /** @type {'potion'|'scroll'} */ (r.what);
      qty[what] += e.code === GK.more ? 1 : -1;
      clampQty(what);
      f.markDirty();
      return true;
    },
    onUpdate: () => renderRows(),
  });

  function renderRows() {
    const ch = char();
    if (ch && !qtyInit) { qtyInit = true; qty.potion = defaultQty('potion'); qty.scroll = defaultQty('scroll'); }
    clampQty('potion');
    clampQty('scroll');
    buildRows();
    const stats = sim?.getStats?.() ?? null;
    const gold = ch?.gold ?? 0;
    f.list.set(rows.length, (i) => {
      const r = rows[i];
      if (!ch) return '';
      if (r.kind === 'item') { const it = ch.shop.general[/** @type {number} */ (r.idx)]; return `i|${it?.id}|${gold >= priceBuy(it) ? 1 : 0}|${ch.level}`; }
      const c = CONSUM[/** @type {'potion'|'scroll'} */ (r.what)];
      return `${r.kind}|${r.what}|${c.have(ch)}|${qty[/** @type {'potion'|'scroll'} */ (r.what)]}|${gold}|${c.price(ch)}`;
    }, (row, i) => {
      const r = rows[i];
      if (!ch) return;
      if (r.kind === 'item') {
        const it = ch.shop.general[/** @type {number} */ (r.idx)];
        const price = priceBuy(it);
        row.appendChild(w.el('span', 'row-main r-' + it.rarity, tName(it.name)));
        row.appendChild(w.el('span', 'row-sub', t('islot.' + it.slot) + ' · ' + it.ilvl));
        if (upgradeOf(stats, ch, it)) row.appendChild(w.el('span', 'row-up', '▲'));
        row.appendChild(w.el('span', 'row-side' + (gold < price ? ' bad' : ''), fmtInt(price)));
        return;
      }
      const what = /** @type {'potion'|'scroll'} */ (r.what);
      const c = CONSUM[what];
      const have = Number(c.have(ch)) || 0;
      if (r.kind === 'free') {
        row.appendChild(w.el('span', 'row-main', t(c.label)));
        row.appendChild(w.el('span', 'row-badge', t('shop.free')));
        row.appendChild(w.el('span', 'row-side', '0'));
        return;
      }
      const rm = room(what);
      const q = rm > 0 ? qty[what] : 0;
      const total = q * c.price(ch);
      row.appendChild(w.el('span', 'row-main', t(c.label)));
      row.appendChild(w.el('span', 'row-sub', `${have}/${c.max} · ${fmtInt(c.price(ch))}`));
      const qEl = row.appendChild(w.el('span', 'qty'));
      qEl.appendChild(w.el('span', 'row-sub', '−'));
      qEl.appendChild(w.el('b', '', t('shop.qty', { n: q })));
      qEl.appendChild(w.el('span', 'row-sub', '+'));
      row.appendChild(w.el('span', 'row-side' + (total > gold || rm <= 0 ? ' bad' : ''), fmtInt(total)));
      if (rm <= 0) row.classList.add('is-off');
    });
  }

  /** @param {number} i */
  function pick(i) {
    const r = rows[i];
    if (!r) return;
    if (r.kind === 'item') { f.done(sim.buy('general', /** @type {number} */ (r.idx))); return; }
    const what = /** @type {'potion'|'scroll'} */ (r.what);
    if (r.kind === 'free') {
      const res = f.done(sim.takeFree(what));
      if (res?.ok) ui?.notice?.('notice.freeGiven', { what: t(CONSUM[what].label) });
      return;
    }
    const n = room(what) > 0 ? qty[what] : 1;
    const res = f.done(what === 'potion' ? sim.buyPotions(n) : sim.buyScrolls(n));
    if (res?.ok) qty[what] = defaultQty(what);
  }

  return {
    id: 'general',
    modal: true,
    el: f.el,
    open(args = {}) { qtyInit = false; f.open(args); },
    close() { f.close(); },
    update(state) { f.update(state); },
    handleKey(e) { return f.handleKey(e); },
    keys: f.keys,
    dispose() { f.dispose(); },
  };
}
