// OWNER: P11 — 계약 §10.1 · §10.2 · §10.5-8 · §10.6
// 대장장이(모달 · INTERACT{npc blacksmith}): 탭([ ]) 사기(재고 9) · 되사기(최근 10) · 분해(「일반 등급 전부 분해」) · 제작(부위 · 비용 · ilvl · 결과 분포).
// 위: 일괄 수리 R(모자라면 부분 수리) · 일괄 판매 V. 오른쪽: 가방 격자(X 팔기 · D 분해 · L 잠금 · Enter 장착). 옆 칸: 포커스한 거래의 전 · 후 표 · 수리 · 일괄 판매 표.

import { ITEM_SLOTS } from '../../core/constants.js';
import { CRAFT } from '../../data/economy.js';
import { priceBuy, priceCraft, salvageYield } from '../../sim/progression/shops.js';
import { fmtInt, fmtPct } from '../format.js';
import { tName } from '../i18n.js';
import { costRows } from '../pnlCommon.js';
import { craftDist, salvageNormalRefs, upgradeOf } from '../pnlLogic.js';
import { createShopFrame } from '../pnlShop.js';

/** @typedef {import('../../types.js').Panel} Panel */

const TAB_BUY = 0, TAB_BUYBACK = 1, TAB_SALVAGE = 2, TAB_CRAFT = 3;

/**
 * @param {{root:HTMLElement, sim:any, bus:any, settings:any, actions:any, t:(key:string, params?:Object) => string, ui:any, widgets:any}} ctx
 * @returns {Panel}
 */
export function createBlacksmithPanel(ctx) {
  const { t, widgets: w, sim } = ctx;
  const char = () => sim?.state?.char ?? null;

  /** 지금 탭의 행 수 */
  function rowCount() {
    const ch = char();
    if (!ch) return 0;
    switch (f.tab) {
      case TAB_BUY: return ch.shop?.blacksmith?.length ?? 0;
      case TAB_BUYBACK: return ch.buyback?.length ?? 0;
      case TAB_SALVAGE: return 1;
      default: return ITEM_SLOTS.length;
    }
  }

  /** 아이템 행 하나 @param {HTMLElement} row @param {any} item @param {number} price @param {boolean} up */
  function itemRow(row, item, price, up) {
    const ch = char();
    row.appendChild(w.el('span', 'row-main r-' + item.rarity, tName(item.name)));
    row.appendChild(w.el('span', 'row-sub', t('islot.' + item.slot) + ' · ' + item.ilvl));
    if (up) row.appendChild(w.el('span', 'row-up', '▲'));
    row.appendChild(w.el('span', 'row-side' + ((ch?.gold ?? 0) < price ? ' bad' : ''), fmtInt(price)));
  }

  const f = createShopFrame(ctx, {
    id: 'blacksmith', className: 'pnl-smith', greet: 'npc.blacksmith.greet',
    tabs: ['shop.buy', 'shop.buyback', 'shop.salvage', 'shop.craft'],
    sell: true, salvage: true, repair: true,
    onPick: (i) => pick(i),
    leftItem: (i) => {
      const ch = char();
      if (!ch) return null;
      if (f.tab === TAB_BUY) {
        const it = ch.shop?.blacksmith?.[i];
        return it ? { item: it, where: 'stock', price: { key: 'shop.gambleSlotPrice', n: priceBuy(it), pkeys: { slot: 'shop.buy' } } } : null;
      }
      if (f.tab === TAB_BUYBACK) {
        const e = ch.buyback?.[i];
        return e?.item ? { item: e.item, where: 'buyback', price: { key: 'shop.gambleSlotPrice', n: e.price, pkeys: { slot: 'shop.buyback' } } } : null;
      }
      return null;
    },
    leftTrade: (i) => {
      const ch = char();
      if (!ch) return null;
      if (f.tab === TAB_BUY) {
        const it = ch.shop?.blacksmith?.[i];
        return it ? { title: t('shop.buy'), rows: costRows(t, ch, -priceBuy(it)) } : null;
      }
      if (f.tab === TAB_BUYBACK) {
        const e = ch.buyback?.[i];
        return e ? { title: t('shop.buyback'), rows: costRows(t, ch, -Math.round(e.price)) } : null;
      }
      if (f.tab === TAB_SALVAGE) {
        const refs = salvageNormalRefs(ch);
        /** @type {Record<string, number>} */
        const sum = {};
        for (const r of refs) {
          const y = salvageYield(ch.bag[r.idx]);
          for (const m of Object.keys(y)) sum[m] = (sum[m] ?? 0) + (/** @type {any} */ (y)[m] ?? 0);
        }
        return refs.length ? { title: t('shop.salvageAllNormal'), rows: costRows(t, ch, 0, sum).slice(1) } : null;
      }
      return { title: t('shop.craft'), rows: costRows(t, ch, -priceCraft(ch), { scrap: -CRAFT.scrap, dust: -CRAFT.dust, essence: -CRAFT.essence }) };
    },
    onTab: () => {},
    onUpdate: () => renderRows(),
    onFocusChange: () => renderExtra(),
  });

  function renderRows() {
    const ch = char();
    const n = rowCount();
    const stats = sim?.getStats?.() ?? null;
    const gold = ch?.gold ?? 0;
    f.list.set(n, (i) => {
      if (!ch) return '';
      if (f.tab === TAB_BUY) { const it = ch.shop.blacksmith[i]; return `b|${it?.id}|${gold >= priceBuy(it) ? 1 : 0}|${ch.level}`; }
      if (f.tab === TAB_BUYBACK) { const e = ch.buyback[i]; return `k|${e?.item?.id}|${gold >= e?.price ? 1 : 0}`; }
      if (f.tab === TAB_SALVAGE) return 's|' + salvageNormalRefs(ch).length;
      return `c|${ITEM_SLOTS[i]}|${priceCraft(ch)}|${gold}|${ch.materials?.scrap}|${ch.materials?.dust}`;
    }, (row, i) => {
      if (!ch) return;
      if (f.tab === TAB_BUY) {
        const it = ch.shop.blacksmith[i];
        itemRow(row, it, priceBuy(it), upgradeOf(stats, ch, it));
      } else if (f.tab === TAB_BUYBACK) {
        const e = ch.buyback[i];
        itemRow(row, e.item, Math.round(e.price), false);
      } else if (f.tab === TAB_SALVAGE) {
        const n2 = salvageNormalRefs(ch).length;
        row.appendChild(w.el('span', 'row-main', t('shop.salvageAllNormal')));
        row.appendChild(w.el('span', 'row-side', String(n2)));
        if (!n2) row.classList.add('is-off');
      } else {
        const slot = ITEM_SLOTS[i];
        const cost = priceCraft(ch);
        const ok = gold >= cost && (ch.materials?.scrap ?? 0) >= CRAFT.scrap && (ch.materials?.dust ?? 0) >= CRAFT.dust;
        row.appendChild(w.el('span', 'row-main', t('islot.' + slot)));
        row.appendChild(w.el('span', 'row-side' + (ok ? '' : ' bad'), t('shop.craftCost', { a: CRAFT.scrap, b: CRAFT.dust, n: fmtInt(cost) })));
      }
    });
  }

  /** 제작 탭 — 결과 분포(옵션 수 · 티어 · 기본형 단계) */
  function renderExtra() {
    const ex = f.extra;
    ex.textContent = '';
    const ch = char();
    if (!ch || f.tab !== TAB_CRAFT) return;
    const i = f.list.index;
    const slot = ITEM_SLOTS[i >= 0 ? i : 0];
    const d = craftDist(ch, slot);
    ex.appendChild(w.el('h4', '', t('shop.craftDist')));
    ex.appendChild(w.el('div', 'row-sub', t('rarity.rare') + ' · ' + t('islot.' + slot) + ' · ' + t('riftStone.ilvl', { n: d.ilvl })));
    for (const [k, p] of d.count) distRow(ex, String(k), p, 'r-rare');
    d.tiers.forEach((p, ti) => { if (p > 0) distRow(ex, t('inv.tier', { t: ti + 1 }), p, ''); });
    for (const bt of d.baseTiers) distRow(ex, bt.names.map((k) => t(k)).join(' / '), bt.p, '');
  }

  /** 분포 막대 한 줄 @param {HTMLElement} host @param {string} label @param {number} p @param {string} cls */
  function distRow(host, label, p, cls) {
    const r = host.appendChild(w.el('div', 'dist-row ' + cls));
    const b = r.appendChild(w.el('div', 'dist-bar'));
    const fill = b.appendChild(w.el('i', ''));
    fill.style.width = Math.round(Math.max(0, Math.min(1, p)) * 100) + '%';
    b.appendChild(w.el('span', '', label));
    r.appendChild(w.el('span', '', fmtPct(p, 1)));
  }

  /** @param {number} i */
  function pick(i) {
    const ch = char();
    if (!ch) return;
    if (f.tab === TAB_BUY) f.done(sim.buy('blacksmith', i));
    else if (f.tab === TAB_BUYBACK) f.done(sim.buyback(i));
    else if (f.tab === TAB_SALVAGE) {
      const refs = salvageNormalRefs(ch);
      if (!refs.length) { f.err.show({ ok: false, reason: 'nothing' }); return; }
      w.confirm('shop.salvageAllNormal').then((ok) => { if (ok) f.done(sim.salvageMany(refs)); });
    } else {
      const res = f.done(sim.craft(ITEM_SLOTS[i]));
      if (res?.ok && res.ref?.idx >= 0) {
        // 결과는 그 자리에서 — 가방의 새 칸으로 포커스(툴팁 + 비교)
        f.bag.markDirty();
        f.bag.update(sim.state);
        f.areas.set(1, false);
        f.bag.focus(res.ref.idx);
      }
    }
  }

  return {
    id: 'blacksmith',
    modal: true,
    el: f.el,
    open(args = {}) { f.open(args); },
    close() { f.close(); },
    update(state) { f.update(state); },
    handleKey(e) { return f.handleKey(e); },
    keys: f.keys,
    dispose() { f.dispose(); },
  };
}
