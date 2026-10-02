// OWNER: P8 — 계약 §10.2
// 캠프 — 다음 시간대까지 기다리기(→ 「HH:MM 저녁」) · 집으로 · 닫기. 명령은 app 의 actions(전환 막)로.
// 패널을 먼저 닫고 action 을 부른다(app 의 막이 isBlocking 을 이어받는다 — 같은 동기 호출 안).

import { bandOf, formatClock, hourOf, nextBandStart } from '../../sim/clock.js';
import { t } from '../i18n.js';
import { PanelBase, el } from '../widgets.js';

class CampPanel extends PanelBase {
  /** @param {import('../widgets.js').PanelCtx} ctx */
  constructor(ctx) {
    super(ctx, 'camp', { size: 's' });
  }

  build() {
    const s = /** @type {any} */ (this.sim).state;
    const actions = /** @type {any} */ (this.ctx.actions);
    const c = s.clock;
    this.addInfo(el('div', 'row-note', t('camp.now', { time: formatClock(c), band: t('band.' + c.band) })));
    const nb = nextBandStart(c.day, c.tickInDay);
    const h = hourOf(nb.tickInDay);
    const nextTime = formatClock({ hour: h, minute: Math.floor((h % 1) * 60 + 1e-6) });
    const wait = el('div', 'row row-big');
    wait.append(el('span', 'row-main', t('camp.wait')), el('span', 'row-sub', t('camp.waitTo', { time: nextTime, band: t('band.' + bandOf(h)) })));
    this.addItem(wait, { activate: () => this._go(() => actions.waitNextBand()) });
    const home = el('div', 'row row-big');
    home.append(el('span', 'row-main', t('camp.home')), el('span', 'row-sub', t('camp.homeNote')));
    this.addItem(home, { activate: () => this._go(() => actions.travel('home')) });
    const close = el('div', 'row');
    close.append(el('span', 'row-main', t('panel.close')));
    this.addItem(close, { activate: () => this.ui.closePanel('confirm') });
  }

  /** @param {() => any} fn */
  _go(fn) {
    this.ui.closePanel('confirm');
    const r = fn();
    if (r && typeof r === 'object' && 'ok' in r && !r.ok) this.ui.toast('reason.' + (r.reason || 'invalid'), r.params || {});
  }
}

/**
 * @param {import('../widgets.js').PanelCtx} ctx
 * @returns {CampPanel}
 */
export function createCampPanel(ctx) {
  return new CampPanel(ctx);
}
