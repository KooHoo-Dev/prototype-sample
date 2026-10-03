// OWNER: P8 — 계약 §10.2
// 지도(문) — getTravel() 의 카드: 이름 · 참고 장소 · 오늘 날씨 · 잠김 사유(「아직 갈 수 없다(레벨 5)」). Enter = actions.travel(id).

import { t, has } from '../i18n.js';
import { PanelBase, el, reasonText } from '../widgets.js';

class MapPanel extends PanelBase {
  /** @param {import('../widgets.js').PanelCtx} ctx */
  constructor(ctx) {
    super(ctx, 'map', { size: 'm' });
  }

  /** 가로 카드 — ←→ 로 고른다(값 조절 항목이 없다) */
  footKey() { return 'map.foot'; }

  build() {
    const sim = /** @type {any} */ (this.sim);
    const actions = /** @type {any} */ (this.ctx.actions);
    /** @type {any[]} */
    let list = [];
    try { list = sim.getTravel() || []; } catch (e) { void e; }
    const grid = el('div', 'map-grid');
    this.addInfo(grid);
    const first = this.items.length;
    for (const d of list) {
      const card = el('div', 'map-card' + (d.ok ? '' : ' is-locked'));
      card.append(el('div', 'map-name', t('stage.' + d.id)));
      if (has('stagePlace.' + d.id)) card.append(el('div', 'map-place', t('stagePlace.' + d.id)));
      if (d.weather) card.append(el('div', 'map-weather', t('map.weather', { w: t('weather.' + d.weather) })));
      if (d.id !== 'home') card.append(el('div', 'map-level', t('map.level', { n: d.unlockLevel })));
      if (!d.ok) card.append(el('div', 'row-reason', reasonText(d.reason, d.reasonParams)));
      else card.append(el('div', 'map-go', t('map.go')));
      this.addItem(card, {
        disabled: !d.ok,
        activate: () => {
          if (!d.ok) {
            this.ui.toast('reason.' + (d.reason || 'invalid'), d.reasonParams || {});
            return;
          }
          this.ui.closePanel('confirm');
          const r = actions.travel(d.id);
          if (r && typeof r === 'object' && 'ok' in r && !r.ok) this.ui.toast('reason.' + (r.reason || 'invalid'), r.params || {});
        },
      }, grid);
    }
    if (!list.length) grid.append(el('div', 'empty', t('map.none')));
    else this.setGrid(first, this.items.length - 1);   // 가로 카드 — ←→ 로 고른다(widgets)
    this.addInfo(el('div', 'row-note', t('map.note')));
  }
}

/**
 * @param {import('../widgets.js').PanelCtx} ctx
 * @returns {MapPanel}
 */
export function createMapPanel(ctx) {
  return new MapPanel(ctx);
}
