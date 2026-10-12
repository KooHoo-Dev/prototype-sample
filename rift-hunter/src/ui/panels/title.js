// OWNER: P10 — 계약 §10.1 · §10.2 · §10.6(타이틀)
// 타이틀: 계속하기(마지막 캐릭터) · 캐릭터 선택 · 새 캐릭터 · 터치 기기 안내 · 버전. Escape 로 닫히지 않는다(타이틀 화면의 바닥).

import { GAME_VERSION } from '../../core/constants.js';

/** @typedef {import('../../types.js').Panel} Panel */

/** 계정 칸 요약 한 줄 @param {any} c @param {(k:string, p?:Object) => string} t */
export function charLine(c, t) {
  return t('title.charLine', { cls: t('class.' + c.cls), level: c.level, rift: c.riftUnlocked });
}

/**
 * @param {{root:HTMLElement, sim:any, bus:any, settings:any, actions:any, t:(key:string, params?:Object) => string, ui:any, widgets:any}} ctx
 * @returns {Panel}
 */
export function createTitlePanel(ctx) {
  const { t, widgets: w, actions, sim, ui } = ctx;
  const el = w.panelFrame('panel.title.title');
  el.dataset.panel = 'title';
  el.classList.add('pnl-title');
  const h = /** @type {HTMLElement} */ (el.querySelector('.panel-title'));
  h.textContent = t('title.name');
  const menu = el.appendChild(w.el('div', 'menu'));
  const items = [
    { key: 'title.continue', run: () => cont() },
    { key: 'title.select', run: () => ui.openPanel('charSelect') },
    { key: 'title.new', run: () => ui.openPanel('newChar', {}) },
  ];
  /** @type {HTMLElement[]} */
  const rows = items.map((it) => {
    const r = menu.appendChild(w.el('div', 'menu-item'));
    r.appendChild(w.el('div', 'menu-label', t(it.key)));
    r.appendChild(w.el('div', 'menu-sub'));
    return r;
  });
  const err = el.appendChild(w.el('div', 'panel-error'));
  const foot = el.appendChild(w.el('div', 'panel-foot'));
  const touch = foot.appendChild(w.el('div', 'title-touch', t('title.touch')));
  const saveWarn = foot.appendChild(w.el('div', 'title-touch'));
  foot.appendChild(w.el('div', 'panel-hint', t('title.navHint')));
  foot.appendChild(w.el('div', 'title-version', t('title.version', { v: GAME_VERSION })));
  const nav = w.listNav(menu, (i) => pick(i));
  let sig = '';
  let frame = 0;

  function lastChar() {
    const acc = sim?.state?.account;
    if (!acc || !Array.isArray(acc.chars)) return null;
    const s = acc.lastSlot;
    return s >= 0 && acc.chars[s] ? acc.chars[s] : null;
  }
  function refresh() {
    const c = lastChar();
    rows[0].classList.toggle('is-disabled', !c);
    const sub = /** @type {HTMLElement} */ (rows[0].querySelector('.menu-sub'));
    sub.textContent = c ? `${c.name} · ${charLine(c, t)}` : t('title.continueNone');
    const acc = sim?.state?.account;
    const n = acc?.chars?.filter(Boolean).length ?? 0;
    rows[1].classList.toggle('is-disabled', n === 0);
    sig = c ? `${acc.lastSlot}:${c.name}:${c.level}:${n}` : `none:${n}`;
  }
  /** @param {number} i */
  function pick(i) {
    if (rows[i]?.classList.contains('is-disabled')) return;
    err.textContent = '';
    items[i].run();
  }
  function cont() {
    Promise.resolve(actions.continueGame?.()).then((res) => {
      if (res && res.ok === false) err.textContent = t('reason.' + res.reason, res.params);
    }, (e) => { queueMicrotask(() => { throw e; }); });
  }

  return {
    id: 'title',
    modal: true,
    el,
    /** @param {{touch?:boolean, storageOk?:boolean, readOnly?:boolean, warn?:string|null}} [args] app 이 넘긴다(§11.1 · §11.12) */
    open(args = {}) {
      err.textContent = '';
      let coarse = false;
      if (typeof args.touch === 'boolean') coarse = args.touch;
      else try { coarse = !!window.matchMedia?.('(pointer: coarse)').matches && !window.matchMedia?.('(any-pointer: fine)').matches; } catch { coarse = false; }
      touch.hidden = !coarse;
      // app 이 넘긴 저장 안내(저장 막힘 · 다른 탭 · 미래 버전 · 봇 관전 — 저장하지 않는 세션의 이유) · 없으면 옛 인자로
      const warn = typeof args.warn === 'string' || args.warn === null ? args.warn
        : args.storageOk === false ? 'notice.saveBlocked' : args.readOnly ? 'notice.saveFuture' : null;
      saveWarn.textContent = warn ? t(warn) : '';
      saveWarn.hidden = !warn;
      refresh();
      nav.focus(lastChar() ? 0 : 2, true);
    },
    close() {},
    update(state) {
      if (++frame % 20 !== 0) return;
      const c = lastChar();
      const acc = state?.account;
      const n = acc?.chars?.filter(Boolean).length ?? 0;
      const s = c ? `${acc.lastSlot}:${c.name}:${c.level}:${n}` : `none:${n}`;
      if (s !== sig) refresh();
    },
    handleKey(e) {
      if (e.code === 'Escape') return true;
      return nav.handleKey(e);
    },
    keys: [],
    dispose() { nav.destroy(); el.remove(); },
  };
}
