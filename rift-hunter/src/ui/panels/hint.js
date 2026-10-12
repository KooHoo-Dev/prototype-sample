// OWNER: P10 — 계약 §10.2(hint) · §10.6(안내 — 모달 카드 둘: town · controls)
// 모달 안내 카드: 제목 · 본문(controls 는 조작 줄 전부) · Enter = 닫기 · H = 도움말. 어떻게 닫히든 sim.markHint(id)(본 것으로).
// 비모달 여섯은 UIRoot 가 ui.notice(…, {big:true}) 꼴로 낸다(이 패널을 쓰지 않는다).

/** @typedef {import('../../types.js').Panel} Panel */

const CONTROL_LINES = 8;

/**
 * @param {{root:HTMLElement, sim:any, bus:any, settings:any, actions:any, t:(key:string, params?:Object) => string, ui:any, widgets:any}} ctx
 * @returns {Panel}
 */
export function createHintPanel(ctx) {
  const { t, widgets: w, sim, ui } = ctx;
  const el = w.panelFrame('panel.hint.title');
  el.dataset.panel = 'hint';
  el.classList.add('pnl-hint');
  const h = /** @type {HTMLElement} */ (el.querySelector('.panel-title'));
  const body = el.appendChild(w.el('p', 'hint-body'));
  const list = el.appendChild(w.el('ul', 'help-list hint-list'));
  for (let i = 0; i < CONTROL_LINES; i++) list.appendChild(w.el('li', '', t('help.controls.' + i)));
  const btns = el.appendChild(w.el('div', 'btn-row'));
  const ok = btns.appendChild(w.button('hint.close', () => ui.closePanel('hint', 'confirm'), 'Enter'));
  ok.classList.add('is-primary');
  btns.appendChild(w.button('hint.openHelp', () => openHelp(), 'KeyH'));
  /** @type {string|null} */
  let id = null;

  function openHelp() {
    const tab = id === 'controls' || id === 'town' ? 'controls' : id === 'elites' ? 'affixes' : 'rules';
    ui.closePanel('hint', 'key');
    ui.openPanel('help', { tab });
  }

  return {
    id: 'hint',
    modal: true,
    el,
    open(args = {}) {
      id = typeof args.id === 'string' ? args.id : 'controls';
      h.textContent = t('hint.' + id + '.title');
      body.textContent = t('hint.' + id + '.body');
      list.hidden = id !== 'controls';
      body.hidden = id === 'controls';
    },
    close() {
      if (id) sim?.markHint?.(id);
      id = null;
    },
    update() {},
    handleKey(e) {
      const down = e.type !== 'keyup';
      if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') {
        if (down && !e.repeat) ui.closePanel('hint', 'confirm');
        return true;
      }
      if (e.code === 'KeyH') {
        if (down && !e.repeat) openHelp();
        return true;
      }
      return false;
    },
    keys: ['Enter', 'NumpadEnter', 'Space', 'KeyH', 'Escape'],
    dispose() { el.remove(); },
  };
}
