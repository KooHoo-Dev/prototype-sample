// OWNER: P8 — 계약 §10.2
// 침대 — 「다음 날 06:00까지 잔다」 확인 → actions.sleep()(전환 막 · 다음 06:00 — §5.7).

import { formatClock, hourOf, nextWake } from '../../sim/clock.js';
import { t } from '../i18n.js';
import { PanelBase, el } from '../widgets.js';

class BedPanel extends PanelBase {
  /** @param {import('../widgets.js').PanelCtx} ctx */
  constructor(ctx) {
    super(ctx, 'bed', { size: 's' });
  }

  build() {
    const s = /** @type {any} */ (this.sim).state;
    const actions = /** @type {any} */ (this.ctx.actions);
    const c = s.clock;
    const w = nextWake(c.day, c.tickInDay);
    const h = hourOf(w.tickInDay);
    const wake = formatClock({ hour: h, minute: Math.floor((h % 1) * 60 + 1e-6) });
    this.addInfo(el('div', 'row-note', t('bed.now', { time: formatClock(c), day: c.day })));
    const yes = el('div', 'row row-big');
    yes.append(el('span', 'row-main', t('bed.sleep', { time: wake })), el('span', 'row-sub', t(w.day > c.day ? 'bed.nextDay' : 'bed.sameDay')));
    this.addItem(yes, {
      activate: () => {
        this.ui.closePanel('confirm');
        const r = actions.sleep();
        if (r && typeof r === 'object' && 'ok' in r && !r.ok) this.ui.toast('reason.' + (r.reason || 'invalid'), r.params || {});
      },
    });
    const no = el('div', 'row');
    no.append(el('span', 'row-main', t('panel.close')));
    this.addItem(no, { activate: () => this.ui.closePanel('confirm') });
  }
}

/**
 * @param {import('../widgets.js').PanelCtx} ctx
 * @returns {BedPanel}
 */
export function createBedPanel(ctx) {
  return new BedPanel(ctx);
}
