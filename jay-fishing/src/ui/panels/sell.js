// OWNER: P8 — 계약 §10.2
// 판매상(INTERACT{npc}) — 탭: 판매(전부 · 한 마리) · 미끼(팩) · 라인(세트 × 라인 감기).
// 판매상 앞을 떠나거나 씬이 바뀌면 UIRoot 의 자가 동기화가 닫는다(§10.1).

import { HOLD } from '../../data/economy.js';
import { t, has } from '../i18n.js';
import { PanelBase, el, fmt, won } from '../widgets.js';
import { addBaitRow, addLineRow, unitPrice } from './shared.js';

class SellPanel extends PanelBase {
  /** @param {import('../widgets.js').PanelCtx} ctx */
  constructor(ctx) {
    super(ctx, 'sell', { tabs: ['sell.tab.sell', 'sell.tab.bait', 'sell.tab.line'], size: 'm' });
  }

  /** @param {string|null} tab */
  build(tab) {
    const sim = /** @type {any} */ (this.sim);
    const s = sim.state;
    this.addInfo(el('div', 'row-note row-money', t('shop.money', { money: won(s.profile.money) })));
    if (tab === 'sell.tab.bait' || tab === 'sell.tab.line') {
      /** @type {any[]} */
      let shop = [];
      try { shop = sim.getShop() || []; } catch (e) { void e; }
      const kind = tab === 'sell.tab.bait' ? 'bait' : 'line';
      const list = shop.filter(it => it.kind === kind);
      for (const it of list) {
        if (kind === 'bait') addBaitRow(this, it);
        else addLineRow(this, it, s.scene === 'home');
      }
      if (!list.length) this.addInfo(el('div', 'empty', t('shop.empty')));
      return;
    }
    const greet = 'npc.' + s.scene + '.greet';
    if (has(greet)) this.addInfo(el('div', 'npc-greet', t(greet)));
    /** @type {any} */
    let quote = { items: [], total: 0 };
    try { quote = sim.getSellQuote() || quote; } catch (e) { void e; }
    const hold = s.profile.hold;
    const priceOf = new Map((quote.items || []).map(q => [q.uid, q.price]));
    const all = el('div', 'row row-big');
    all.append(el('span', 'row-main', t('sell.all')), el('span', 'row-price', won(quote.total || 0)), el('span', 'row-sub', t('sell.count', { n: hold.length, cap: HOLD.capacity })));
    this.addItem(all, {
      disabled: !hold.length,
      activate: () => {
        if (!hold.length) { this.ui.toast('sell.emptyShort'); return; }
        const r = sim.sellAll();
        if (!r || !r.ok) this.ui.toast('reason.' + ((r && r.reason) || 'invalid'), (r && r.params) || {});
        this.render();
      },
    });
    if (!hold.length) this.addInfo(el('div', 'empty', t('sell.empty')));
    for (const rec of hold) {
      const row = el('div', 'row row-fish');
      const head = el('div', 'row-head');
      const name = el('span', 'row-main', t('species.' + rec.speciesId));
      if (rec.tier === 'legend') name.append(el('span', 'stars is-legend', '★★'));
      else if (rec.tier === 'trophy') name.append(el('span', 'stars is-trophy', '★'));
      head.append(name, el('span', 'row-price', won(priceOf.get(rec.uid) ?? rec.price)));
      // 어종 단가(원/kg · 흥정 반영 — 브리프 §3.1 · 리뷰 수정)
      const unit = t('unit.wonPerKg', { v: fmt(unitPrice(sim, rec.speciesId)) });
      row.append(head, el('div', 'row-sub', t('sell.fish', { cm: fmt(rec.lengthCm, 1), kg: fmt(rec.weightKg, 3), tier: t('tier.' + rec.tier), unit })));
      this.addItem(row, {
        activate: () => {
          const r = sim.sellOne(rec.uid);
          if (!r || !r.ok) this.ui.toast('reason.' + ((r && r.reason) || 'invalid'), (r && r.params) || {});
          this.render();
        },
      });
    }
  }
}

/**
 * @param {import('../widgets.js').PanelCtx} ctx
 * @returns {SellPanel}
 */
export function createSellPanel(ctx) {
  return new SellPanel(ctx);
}
