// OWNER: P8 — 계약 §10.2 · §11.2
// 타이틀 — 이어하기 · 새 게임(세이브가 있으면 confirm{danger}). args: {hasSave, saveBroken, saveFuture, stale, saveInfo}(app) · ui.titleNotes(setTitleNotes).
// stale(리뷰 수정 — 여러 탭): 다른 탭이 세이브를 썼다 — 이어하기는 「최신 기록 불러오기」(app 이 다시 읽는다) · 레벨 · 돈은 saveInfo(그 세이브).
// 닫히지 않는다(Esc · ×) — app 이 이어하기 · 새 게임의 막 아래에서 closePanel 한다.

import { t } from '../i18n.js';
import { PanelBase, el, fmt, won } from '../widgets.js';

class TitlePanel extends PanelBase {
  /** @param {import('../widgets.js').PanelCtx} ctx */
  constructor(ctx) {
    super(ctx, 'title', { closable: false, size: 's', titleKey: 'title.name' });
    this.titleEl.classList.add('panel-title-big');
    this.titleEl.after(el('div', 'title-tag', t('title.tagline')));
  }

  footKey() { return 'panel.footTitle'; }

  build() {
    const a = /** @type {any} */ (this.args);
    const ui = /** @type {any} */ (this.ui);
    const actions = /** @type {any} */ (this.ctx.actions);
    const prof = /** @type {any} */ (this.sim).state.profile;
    const p = a.saveInfo && Number.isFinite(a.saveInfo.level) ? a.saveInfo : prof;
    const notes = [];
    if (a.saveBroken) notes.push('title.saveBroken');
    if (a.saveFuture) notes.push('title.saveFuture');
    for (const k of ui.titleNotes || []) if (!notes.includes(k)) notes.push(k);
    for (const k of notes) this.addInfo(el('div', 'row-note is-warn', t(k)));

    if (a.hasSave) {
      const row = el('div', 'row row-big');
      row.append(el('span', 'row-main', t(a.stale ? 'title.reload' : 'title.continue')), el('span', 'row-sub', t('title.saveInfo', { level: p.level, money: won(p.money) })));
      this.addItem(row, { activate: () => actions.continueGame() });
    }
    const nrow = el('div', 'row row-big');
    nrow.append(el('span', 'row-main', t('title.newGame')));
    this.addItem(nrow, {
      activate: () => {
        if (a.hasSave) {
          ui.openPanel('confirm', {
            titleKey: 'confirm.newGame.title',
            bodyKey: 'confirm.newGame.body',
            bodyParams: { level: p.level, money: fmt(p.money) },
            danger: true,
            onYes: () => actions.newGame(),
          });
        } else {
          actions.newGame();
        }
      },
    });
  }
}

/**
 * @param {import('../widgets.js').PanelCtx} ctx
 * @returns {TitlePanel}
 */
export function createTitlePanel(ctx) {
  return new TitlePanel(ctx);
}
