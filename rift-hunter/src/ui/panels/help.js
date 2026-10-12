// OWNER: P10 — 계약 §10.2(help) · 브리프 §3.4 · §3.5(정예 속성 12 — 표시 · 대응) · QUALITY §1(규칙의 뜻은 게임 안에)
// 탭 셋: 조작 · 정예 속성(데이터 표 MON_AFFIXES 의 행 전부 — 행을 더하면 저절로 늘어난다) · 규칙. `[` `]` 또는 ← → 로 탭 · ↑ ↓ 스크롤.
// args.tab = 'controls'|'affixes'|'rules'.

import { MON_AFFIXES } from '../../data/monsterAffixes.js';

/** @typedef {import('../../types.js').Panel} Panel */

const TABS = ['controls', 'affixes', 'rules'];
const CONTROL_LINES = 8;
const RULES = ['lives', 'repair', 'unlock', 'telegraph', 'potion', 'recall'];
const SCROLL_PX = 48;

/**
 * @param {{root:HTMLElement, sim:any, bus:any, settings:any, actions:any, t:(key:string, params?:Object) => string, ui:any, widgets:any}} ctx
 * @returns {Panel}
 */
export function createHelpPanel(ctx) {
  const { t, widgets: w } = ctx;
  const el = w.panelFrame('panel.help.title');
  el.dataset.panel = 'help';
  el.classList.add('pnl-help');
  const tabBar = el.appendChild(w.el('div', ''));
  const body = el.appendChild(w.el('div', 'help-body'));
  const foot = el.appendChild(w.el('div', 'panel-foot'));
  foot.appendChild(w.el('div', 'panel-hint', t('help.hint')));
  const pages = TABS.map((id) => {
    const page = body.appendChild(w.el('div', 'help-page help-' + id));
    if (id === 'controls') {
      const ul = page.appendChild(w.el('ul', 'help-list'));
      for (let i = 0; i < CONTROL_LINES; i++) ul.appendChild(w.el('li', '', t('help.controls.' + i)));
    } else if (id === 'affixes') {
      page.appendChild(w.el('p', 'help-intro', t('help.affixes.intro')));
      const grid = page.appendChild(w.el('div', 'affix-grid'));
      for (const a of MON_AFFIXES) {
        const row = grid.appendChild(w.el('div', 'affix-row'));
        row.appendChild(w.el('div', 'affix-chip affix-name', t('affix.' + a.id + '.name')));
        row.appendChild(w.el('div', 'affix-desc', t('affix.' + a.id + '.desc')));
      }
    } else {
      const ul = page.appendChild(w.el('ul', 'help-list'));
      for (const r of RULES) ul.appendChild(w.el('li', '', t('help.rules.' + r)));
    }
    return page;
  });
  const tb = w.tabs(tabBar, TABS.map((id) => 'help.tab.' + id), (i) => show(i));
  /** @param {number} i */
  function show(i) {
    pages.forEach((p, k) => { p.hidden = k !== i; });
    body.scrollTop = 0;
  }
  show(0);

  return {
    id: 'help',
    modal: true,
    el,
    open(args = {}) {
      const i = Math.max(0, TABS.indexOf(args.tab ?? 'controls'));
      tb.select(i, true);
      show(i);
    },
    close() {},
    update() {},
    handleKey(e) {
      if (tb.handleKey(e)) return true;
      const down = e.type !== 'keyup';
      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        if (down) tb.select(tb.index + (e.code === 'ArrowRight' ? 1 : -1));
        return true;
      }
      if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        if (down) body.scrollTop += e.code === 'ArrowDown' ? SCROLL_PX : -SCROLL_PX;
        return true;
      }
      if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') {
        if (down && !e.repeat) ctx.ui.closePanel('help', 'confirm');
        return true;
      }
      return false;
    },
    keys: [],
    dispose() { tb.destroy(); el.remove(); },
  };
}
