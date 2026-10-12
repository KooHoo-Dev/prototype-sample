// OWNER: P10 — 계약 §10.1(widgets.confirm) · §10.2(confirm)
// 확인: 문면(args.textKey · params) · 예(Enter) / 아니오(Escape) · ← → 로 단추 사이 이동 · 마우스.
// args.resolve(boolean) — 어떻게 닫히든 한 번 부른다(닫히면 false).

/** @typedef {import('../../types.js').Panel} Panel */

/**
 * @param {{root:HTMLElement, sim:any, bus:any, settings:any, actions:any, t:(key:string, params?:Object) => string, ui:any, widgets:any}} ctx
 * @returns {Panel}
 */
export function createConfirmPanel(ctx) {
  const { t, widgets: w, ui } = ctx;
  const el = w.panelFrame('panel.confirm.title');
  el.dataset.panel = 'confirm';
  el.classList.add('pnl-confirm');
  const text = el.appendChild(w.el('p', 'confirm-text'));
  const btns = el.appendChild(w.el('div', 'btn-row'));
  const yes = btns.appendChild(w.button('confirm.yes', () => done(true)));
  const no = btns.appendChild(w.button('confirm.no', () => done(false)));
  yes.classList.add('is-primary');
  /** @type {((v:boolean) => void)|null} */
  let resolve = null;
  let focus = 0;

  /** @param {number} i */
  function setFocus(i) {
    focus = i;
    yes.classList.toggle('is-focus', i === 0);
    no.classList.toggle('is-focus', i === 1);
  }
  /** @param {boolean} v */
  function done(v) {
    const r = resolve;
    resolve = null;
    ui.closePanel('confirm', v ? 'confirm' : 'esc');
    r?.(v);
  }

  return {
    id: 'confirm',
    modal: true,
    el,
    open(args = {}) {
      if (resolve) { const r = resolve; resolve = null; r(false); }    // 앞의 확인은 아니오로
      resolve = typeof args.resolve === 'function' ? args.resolve : null;
      text.textContent = t(args.textKey ?? 'panel.confirm.title', args.params);
      setFocus(0);
    },
    close() {
      if (resolve) { const r = resolve; resolve = null; r(false); }
    },
    update() {},
    handleKey(e) {
      const down = e.type !== 'keyup';
      const c = e.code;
      if (c === 'ArrowLeft' || c === 'ArrowRight') {
        if (down) setFocus(focus === 0 ? 1 : 0);
        return true;
      }
      if (c === 'Enter' || c === 'NumpadEnter' || c === 'Space') {
        if (down && !e.repeat) done(focus === 0);
        return true;
      }
      if (c === 'Escape') {
        if (down && !e.repeat) done(false);
        return true;
      }
      return false;
    },
    keys: ['ArrowLeft', 'ArrowRight', 'Enter', 'NumpadEnter', 'Space', 'Escape'],
    dispose() { el.remove(); },
  };
}
