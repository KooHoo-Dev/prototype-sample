// OWNER: P11 — 계약 §10.1 · §10.2 · §10.6
// 도박꾼(모달 · INTERACT{npc gambler}): 부위 9(부위마다 가격 priceGamble) · 고른 부위의 **실제 등급 확률**(gambleOdds — 그 부위 · 클래스에 전설 · 세트 후보가
// 없으면 그 몫을 희귀에 더한 값) · 골드 전 · 후 · Enter = 도박 → 결과는 그 자리에서 카드 + 장착 중인 것과의 비교.

import { ITEM_SLOTS, RARITIES } from '../../core/constants.js';
import { EV } from '../../core/events.js';
import { KEYBINDS } from '../../data/keybinds.js';
import { gambleOdds, priceGamble } from '../../sim/progression/shops.js';
import { fmtInt, fmtPct } from '../format.js';
import { createItemList } from '../pnlBagGrid.js';
import { costRows, createErrorLine, createTradeBox, createWallet, isDown } from '../pnlCommon.js';
import { itemCard } from '../tooltip.js';

/** @typedef {import('../../types.js').Panel} Panel */

const NAV = [KEYBINDS.up, KEYBINDS.down, KEYBINDS.left, KEYBINDS.right, 'Enter', 'NumpadEnter', 'Space'];

/**
 * @param {{root:HTMLElement, sim:any, bus:any, settings:any, actions:any, t:(key:string, params?:Object) => string, ui:any, widgets:any}} ctx
 * @returns {Panel}
 */
export function createGamblerPanel(ctx) {
  const { t, widgets: w, sim } = ctx;
  const el = w.panelFrame('panel.gambler.title');
  el.dataset.panel = 'gambler';
  el.classList.add('pnl-gambler');
  const topRow = el.appendChild(w.el('div', 'shop-top'));
  topRow.appendChild(w.el('div', 'shop-greet', t('npc.gambler.greet')));
  const wallet = createWallet(ctx, { mats: false });
  topRow.appendChild(wallet.el);
  const body = el.appendChild(w.el('div', 'two-col'));
  const leftBox = body.appendChild(w.el('div', 'area is-area shop-left'));
  leftBox.appendChild(w.el('div', 'area-head', t('shop.gamble')));
  const list = createItemList(ctx, {
    onPick: () => gamble(),
    onFocus: () => { err.clear(); dirty = true; },
  });
  leftBox.appendChild(list.el);
  const mid = body.appendChild(w.el('div', 'shop-side'));
  const oddsBox = mid.appendChild(w.el('div', 'shop-info'));
  const trade = createTradeBox(ctx);
  mid.appendChild(trade.el);
  const result = body.appendChild(w.el('div', 'result-card'));
  const foot = el.appendChild(w.el('div', 'panel-foot'));
  const err = createErrorLine(ctx);
  foot.appendChild(err.el);
  foot.appendChild(w.el('div', 'panel-hint', t('shop.gamble') + ' Enter'));

  let dirty = true;
  /** @type {any} */
  let lastItem = null;
  /** @type {Array<() => void>} */
  const offs = [];
  let alt = false;
  if (ctx.bus) {
    const mark = () => { dirty = true; };
    for (const name of [EV.GOLD, EV.BAG, EV.UNLOCK, EV.STATS_CHANGED, EV.EQUIPPED]) offs.push(ctx.bus.on(name, mark));
    // 결과 카드의 고급 줄(Alt · 설정) — 바뀌면 다시
    offs.push(ctx.bus.on(EV.LABELS, (e) => { alt = !!e?.on; showResult(); }));
    offs.push(ctx.bus.on(EV.SETTINGS_CHANGED, () => showResult()));
  }

  function slotNow() {
    const i = list.index;
    return ITEM_SLOTS[i >= 0 ? i : 0];
  }

  /** @param {any} ch */
  function render(ch) {
    const gold = ch?.gold ?? 0;
    list.set(ITEM_SLOTS.length, (i) => `${ITEM_SLOTS[i]}|${ch ? priceGamble(ch, ITEM_SLOTS[i]) : 0}|${gold}`, (row, i) => {
      const slot = ITEM_SLOTS[i];
      const price = ch ? priceGamble(ch, slot) : 0;
      row.appendChild(w.el('span', 'row-main', t('islot.' + slot)));
      row.appendChild(w.el('span', 'row-side' + (gold < price ? ' bad' : ''), fmtInt(price)));
    });
    if (list.index < 0 && list.count) list.nav.focus(0, true);
    const slot = slotNow();
    oddsBox.textContent = '';
    if (!ch) return;
    oddsBox.appendChild(w.el('h4', '', t('shop.gambleOdds') + ' · ' + t('islot.' + slot)));
    const odds = gambleOdds(ch, slot);
    for (const r of RARITIES) {
      const p = Number(odds[r]) || 0;
      if (r === 'normal' && p <= 0) continue;
      const row = oddsBox.appendChild(w.el('div', 'dist-row r-' + r));
      const bar = row.appendChild(w.el('div', 'dist-bar'));
      const fill = bar.appendChild(w.el('i', ''));
      fill.style.width = Math.round(Math.max(0, Math.min(1, p)) * 100) + '%';
      bar.appendChild(w.el('span', 'r-' + r, t('rarity.' + r)));
      row.appendChild(w.el('span', p > 0 ? '' : 'row-sub', fmtPct(p, 1)));
    }
    oddsBox.appendChild(w.el('div', 'row-sub', t('shop.gambleSlotPrice', { slot: t('islot.' + slot), n: fmtInt(priceGamble(ch, slot)) })));
    trade.set(costRows(t, ch, -priceGamble(ch, slot)), t('shop.gamble'));
  }

  function gamble() {
    const slot = slotNow();
    const res = sim.gamble(slot);
    err.show(res);
    if (res?.ok && res.item) {
      lastItem = res.item;
      showResult();
    }
    dirty = true;
  }

  function showResult() {
    result.textContent = '';
    if (!lastItem) return;
    const adv = alt || !!(ctx.ui?.settings ?? ctx.settings)?.advancedTooltips;
    result.appendChild(itemCard(ctx, lastItem, { compare: true, worn: false, head: t('shop.gamble'), advanced: adv }));
  }

  return {
    id: 'gambler',
    modal: true,
    el,
    open() {
      err.clear();
      lastItem = null;
      result.textContent = '';
      list.invalidate();
      dirty = true;
      list.focus(0);
    },
    close() {},
    update(state) {
      const ch = state?.char ?? null;
      wallet.update(ch);
      if (!dirty) return;
      dirty = false;
      render(ch);
    },
    handleKey(e) {
      const code = e.code;
      if (code === KEYBINDS.pause) return false;
      if (!isDown(e)) return NAV.includes(code);
      if (NAV.includes(code)) {
        if ((code === 'Enter' || code === 'NumpadEnter' || code === 'Space') && e.repeat) return true;
        return list.handleKey(e);
      }
      return false;
    },
    keys: [...NAV, KEYBINDS.pause],
    dispose() {
      for (const off of offs) off();
      list.dispose();
      el.remove();
    },
  };
}
