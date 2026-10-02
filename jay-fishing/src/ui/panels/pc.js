// OWNER: P8 — 계약 §10.2
// 집 PC — 탭 4개: 상점(장비 「사고 바로 끼우기」 · 미끼 팩 · 라인 감기 — 사기 전 · 후 비교) · 날씨(오늘 · 내일 · 활발한 어종) · 도감 · 스킬.

import { BAND_IDS, STAGE_IDS } from '../../core/constants.js';
import { t } from '../i18n.js';
import { PanelBase, el, won } from '../widgets.js';
import { addBaitRow, addGearRow, addLineRow, buildDex, buildSkills, hidePreview, renderPreview } from './shared.js';

const SHOP_SECTIONS = ['rod', 'reel', 'float', 'sinker', 'line', 'hook'];

class PcPanel extends PanelBase {
  /** @param {import('../widgets.js').PanelCtx} ctx */
  constructor(ctx) {
    super(ctx, 'pc', { tabs: ['pc.tab.shop', 'pc.tab.weather', 'pc.tab.dex', 'pc.tab.skill'], size: 'l' });
    /** @type {{targetSet:Record<string,string>}} */
    this.memo = { targetSet: {} };
    /** @type {number|null} */
    this.dexStage = null;
    this.wxStage = 0;
  }

  onOpen() {
    this.dexStage = null;
    this.memo.targetSet = {};
  }

  onTab() { hidePreview(this); }

  onClose() { hidePreview(this); }

  /** @param {string|null} tab */
  build(tab) {
    const s = /** @type {any} */ (this.sim).state;
    hidePreview(this);
    switch (tab) {
      case 'pc.tab.weather': this._weather(s); break;
      case 'pc.tab.dex': buildDex(this, s); break;
      case 'pc.tab.skill': buildSkills(this, s); break;
      default: this._shop(s); break;
    }
  }

  /** @param {any} s */
  _shop(s) {
    const sim = /** @type {any} */ (this.sim);
    this.addInfo(el('div', 'row-note row-money', t('shop.money', { money: won(s.profile.money) })));
    /** @type {any[]} */
    let shop = [];
    try { shop = sim.getShop() || []; } catch (e) { void e; }
    const gear = shop.filter(it => it.kind === 'gear');
    for (const slot of SHOP_SECTIONS) {
      const list = gear.filter(it => it.slot === slot);
      if (!list.length) continue;
      this.addInfo(el('div', 'section', t('shop.slot.' + slot)));
      for (const it of list) addGearRow(this, it, this.memo);
    }
    const baits = shop.filter(it => it.kind === 'bait');
    if (baits.length) {
      this.addInfo(el('div', 'section', t('shop.baits')));
      for (const it of baits) addBaitRow(this, it);
    }
    const lines = shop.filter(it => it.kind === 'line');
    if (lines.length) {
      this.addInfo(el('div', 'section', t('shop.lines')));
      for (const it of lines) addLineRow(this, it, s.scene === 'home');
    }
    if (!shop.length) this.addInfo(el('div', 'empty', t('shop.empty')));
  }

  /** @param {any} s */
  _weather(s) {
    const sim = /** @type {any} */ (this.sim);
    /** @type {any} */
    let fc = null;
    try { fc = sim.getForecast(); } catch (e) { void e; }
    const table = el('div', 'wx-table');
    const head = el('div', 'wx-row wx-head');
    head.append(el('span', '', ''), el('span', '', t('pc.today')), el('span', '', t('pc.tomorrow')));
    table.append(head);
    for (const st of STAGE_IDS) {
      const r = el('div', 'wx-row');
      r.append(el('span', 'wx-stage', t('stage.' + st)),
        el('span', 'wx-cell wx-' + ((fc && fc.today[st]) || 'clear'), fc ? t('weather.' + fc.today[st]) : ''),
        el('span', 'wx-cell wx-' + ((fc && fc.tomorrow[st]) || 'clear'), fc ? t('weather.' + fc.tomorrow[st]) : ''));
      table.append(r);
    }
    this.addInfo(table);
    this.addInfo(el('div', 'row-note', t('pc.weatherNote')));

    const stId = STAGE_IDS[this.wxStage] || STAGE_IDS[0];
    const sel = el('div', 'row row-select');
    sel.append(el('span', 'row-main', t('pc.activeAt', { stage: t('stage.' + stId) })));
    this.addItem(sel, {
      adjust: (dir) => {
        this.wxStage = (this.wxStage + dir + STAGE_IDS.length) % STAGE_IDS.length;
        this.render();
      },
    });
    const k = sim.ctx && sim.ctx.mods ? sim.ctx.mods.knowledge : 0;
    if (!(k >= 1)) {
      this.addInfo(el('div', 'row-note is-dim', t('pc.activeLocked')));
      return;
    }
    const by = fc && fc.activeByBand ? fc.activeByBand[stId] : null;
    for (const b of BAND_IDS) {
      const ids = (by && by[b]) || [];
      const r = el('div', 'row row-band' + (s.clock.band === b ? ' is-now' : ''));
      r.append(el('span', 'row-main', t('band.' + b)), el('span', 'row-sub', ids.length ? ids.map(id => t('species.' + id)).join(t('list.sep')) : t('pc.noneActive')));
      this.addItem(r, {});
    }
  }

  /** @param {Object} state @param {number} dt */
  update(state, dt) {
    void state;
    renderPreview(this, dt);
  }
}

/**
 * @param {import('../widgets.js').PanelCtx} ctx
 * @returns {PcPanel}
 */
export function createPcPanel(ctx) {
  return new PcPanel(ctx);
}
