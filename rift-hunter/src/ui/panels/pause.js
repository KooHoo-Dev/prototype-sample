// OWNER: P10 — 계약 §10.2(pause) · 브리프 §3.1(균열 진행은 저장되지 않는다)
// 일시정지: 계속 · 설정 · 도움말 · 타이틀로(열린 균열이 활동 중이면 확인). 닫히면(Esc · 계속) UIRoot 가 actions.resume().

/** @typedef {import('../../types.js').Panel} Panel */

/**
 * @param {{root:HTMLElement, sim:any, bus:any, settings:any, actions:any, t:(key:string, params?:Object) => string, ui:any, widgets:any}} ctx
 * @returns {Panel}
 */
export function createPausePanel(ctx) {
  const { t, widgets: w, actions, sim, ui } = ctx;
  const el = w.panelFrame('panel.pause.title');
  el.dataset.panel = 'pause';
  el.classList.add('pnl-pause');
  const menu = el.appendChild(w.el('div', 'menu'));
  const items = [
    { key: 'pause.resume', run: () => ui.closePanel('pause', 'confirm') },
    { key: 'pause.settings', run: () => ui.openPanel('settings') },
    { key: 'pause.help', run: () => ui.openPanel('help') },
    { key: 'pause.quit', run: () => quit() },
  ];
  for (const it of items) {
    const r = menu.appendChild(w.el('div', 'menu-item'));
    r.appendChild(w.el('div', 'menu-label', t(it.key)));
  }
  el.appendChild(w.el('p', 'panel-note', t('pause.riftNote')));
  const foot = el.appendChild(w.el('div', 'panel-foot'));
  foot.appendChild(w.el('div', 'panel-hint', t('pause.hint')));
  const nav = w.listNav(menu, (i) => items[i]?.run());
  let busy = false;

  async function quit() {
    if (busy) return;
    const r = sim?.state?.rift;
    if (r && (r.phase === 'active' || r.phase === 'guardian')) {
      busy = true;
      const ok = await w.confirm('pause.quitConfirm');
      busy = false;
      if (!ok) return;
    }
    actions.quitToTitle?.();
  }

  return {
    id: 'pause',
    modal: true,
    el,
    open() { nav.focus(0, true); },
    close() {},
    update() {},
    handleKey(e) { return nav.handleKey(e); },
    keys: [],
    dispose() { nav.destroy(); el.remove(); },
  };
}
