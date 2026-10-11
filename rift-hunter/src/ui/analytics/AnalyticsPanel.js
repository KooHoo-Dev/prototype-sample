// OWNER: P12 — 계약 §10.9 · §10.1
// STUB — W2 에서 P12 가 채운다(탭 넷 — 드랍 시뮬레이터 · 표 보기 · 세션 기록 · 봇). W0: 제목 하나 있는 빈 상자

/** @typedef {import('../../types.js').Panel} Panel */

/** @param {{root:HTMLElement, sim:any, bus:any, settings:any, actions:any, t:Function, ui:any, widgets:any}} ctx @returns {Panel} */
export function createAnalyticsPanel(ctx) {
  const el = ctx.widgets.panelFrame('panel.analytics.title');
  el.dataset.panel = 'analytics';
  return {
    id: 'analytics',
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
