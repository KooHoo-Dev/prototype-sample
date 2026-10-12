// OWNER: P10 — 계약 §10.2(charSelect) · §10.6
// 캐릭터 칸 4: 이름 · 클래스 · 레벨 · 해금 균열 / 빈 칸. Enter = 그 캐릭터로(actions.selectChar) · 빈 칸이면 새 캐릭터(그 칸) ·
// Delete → 확인 → actions.deleteChar(slot) · Escape = 뒤로(타이틀).

import { CHAR_SLOTS } from '../../core/constants.js';
import { charLine } from './title.js';

/** @typedef {import('../../types.js').Panel} Panel */

/**
 * @param {{root:HTMLElement, sim:any, bus:any, settings:any, actions:any, t:(key:string, params?:Object) => string, ui:any, widgets:any}} ctx
 * @returns {Panel}
 */
export function createCharSelectPanel(ctx) {
  const { t, widgets: w, actions, sim, ui } = ctx;
  const el = w.panelFrame('panel.charSelect.title');
  el.dataset.panel = 'charSelect';
  el.classList.add('pnl-charselect');
  const list = el.appendChild(w.el('div', 'menu slot-list'));
  /** @type {Array<{row:HTMLElement, name:HTMLElement, sub:HTMLElement}>} */
  const rows = [];
  for (let i = 0; i < CHAR_SLOTS; i++) {
    const row = list.appendChild(w.el('div', 'menu-item slot-row'));
    row.appendChild(w.el('div', 'slot-no', t('title.slot', { n: i + 1 })));
    const name = row.appendChild(w.el('div', 'menu-label'));
    const sub = row.appendChild(w.el('div', 'menu-sub'));
    rows.push({ row, name, sub });
  }
  const err = el.appendChild(w.el('div', 'panel-error'));
  const foot = el.appendChild(w.el('div', 'panel-foot'));
  const btns = foot.appendChild(w.el('div', 'btn-row'));
  btns.appendChild(w.button('title.deleteHint', () => del(nav.index), 'Delete'));
  btns.appendChild(w.button('title.back', () => ui.closePanel('charSelect', 'pointer')));
  foot.appendChild(w.el('div', 'panel-hint', t('title.navHint')));
  const nav = w.listNav(list, (i) => pick(i));
  let busy = false;

  const chars = () => sim?.state?.account?.chars ?? [];
  function refresh() {
    const cs = chars();
    for (let i = 0; i < rows.length; i++) {
      const c = cs[i];
      rows[i].row.classList.toggle('is-empty', !c);
      rows[i].name.textContent = c ? c.name : t('title.emptySlot');
      rows[i].sub.textContent = c ? charLine(c, t) : '';
    }
  }
  /** @param {number} i */
  function pick(i) {
    if (busy || i < 0) return;
    err.textContent = '';
    const c = chars()[i];
    if (!c) { ui.openPanel('newChar', { slot: i }); return; }
    busy = true;
    Promise.resolve(actions.selectChar?.(i)).then((res) => {
      busy = false;
      if (res && res.ok === false) { err.textContent = t('reason.' + res.reason, res.params); refresh(); }
    }, (e) => { busy = false; queueMicrotask(() => { throw e; }); });
  }
  /** @param {number} i */
  async function del(i) {
    const c = chars()[i];
    if (busy || !c) return;
    const ok = await w.confirm('title.deleteConfirm', { name: c.name });
    if (!ok) return;
    busy = true;
    try {
      const res = await actions.deleteChar?.(i);
      if (res && res.ok === false) err.textContent = t('reason.' + res.reason, res.params);
    } finally {
      busy = false;
      refresh();
    }
  }

  return {
    id: 'charSelect',
    modal: true,
    el,
    open(args = {}) {
      err.textContent = '';
      refresh();
      const acc = sim?.state?.account;
      const start = typeof args.slot === 'number' ? args.slot : acc && acc.lastSlot >= 0 ? acc.lastSlot : 0;
      nav.focus(start, true);
    },
    close() {},
    update() {},
    handleKey(e) {
      if (e.code === 'Delete' || e.code === 'Backspace') {
        if (e.type !== 'keyup' && !e.repeat) del(nav.index);
        return true;
      }
      return nav.handleKey(e);
    },
    keys: [],
    dispose() { nav.destroy(); el.remove(); },
  };
}
