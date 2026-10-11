// OWNER: P10 — 계약 §10.1 · §10.2 · §10.6
// STUB — W2 에서 P10 가 채운다. W0: 제목 하나 있는 빈 상자

/** @typedef {import('../../types.js').Panel} Panel */

/**
 * @param {{root:HTMLElement, sim:any, bus:any, settings:any, actions:any, t:(key:string, params?:Object) => string, ui:any, widgets:any}} ctx
 * @returns {Panel}
 */
export function createHelpPanel(ctx) {
  const el = ctx.widgets.panelFrame('panel.help.title');
  el.dataset.panel = 'help';
  return {
    id: 'help',
    modal: true,
    el,
    open(args = {}) {},
    close() {},
    update(state) {},
    handleKey(e) { return false; },
    keys: [],
    dispose() { el.remove(); },
  };
}
