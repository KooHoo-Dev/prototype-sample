// OWNER: P8 — 계약 §10.2
// 확인 — 다른 패널 · app 위에 겹친다. args {titleKey, bodyKey, bodyParams, onYes, onNo?, danger, yesKey?, noKey?}.
// Enter/Space 는 포커스된 항목 · Esc 아니오. 처음 포커스: 보통 「예」 · danger 면 「아니오」(연타로 덮어쓰지 않는다).

import { t } from '../i18n.js';
import { PanelBase, el } from '../widgets.js';

class ConfirmPanel extends PanelBase {
  /** @param {import('../widgets.js').PanelCtx} ctx */
  constructor(ctx) {
    super(ctx, 'confirm', { size: 's' });
  }

  onOpen() {
    const a = /** @type {any} */ (this.args);
    this.titleEl.textContent = t(a.titleKey || 'panel.confirm');
    this.focus = a.danger ? 1 : 0;
  }

  reveal() {
    const a = /** @type {any} */ (this.args);
    this.titleEl.textContent = t(a.titleKey || 'panel.confirm');
    super.reveal();
  }

  build() {
    const a = /** @type {any} */ (this.args);
    if (a.bodyKey) this.addInfo(el('div', 'confirm-body' + (a.danger ? ' is-danger' : ''), t(a.bodyKey, a.bodyParams || {})));
    const yes = el('div', 'row row-big' + (a.danger ? ' is-danger' : ''));
    yes.append(el('span', 'row-main', t(a.yesKey || 'confirm.yes')));
    this.addItem(yes, {
      activate: () => {
        const fn = a.onYes;
        this.ui.closePanel('confirm');
        if (typeof fn === 'function') fn();
      },
    });
    const no = el('div', 'row row-big');
    no.append(el('span', 'row-main', t(a.noKey || 'confirm.no')));
    this.addItem(no, {
      activate: () => {
        const fn = a.onNo;
        this.ui.closePanel('confirm');
        if (typeof fn === 'function') fn();
      },
    });
  }
}

/**
 * @param {import('../widgets.js').PanelCtx} ctx
 * @returns {ConfirmPanel}
 */
export function createConfirmPanel(ctx) {
  return new ConfirmPanel(ctx);
}
