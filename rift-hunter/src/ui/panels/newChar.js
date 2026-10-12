// OWNER: P10 — 계약 §10.2(newChar) · §10.5-1(텍스트 입력) · §10.6
// 새 캐릭터: 클래스(← →) · 이름(최대 12자 · 빈 이름이면 기본 이름) · 저장 칸(← →) · Enter = 시작.
// 고른 칸이 차 있으면 확인(덮어쓰기 · 백업은 app) → actions.newChar({slot, cls, name, confirmed}).
// 이름 칸에 포커스가 있으면 글자 키는 입력 칸만 받는다(창까지 올라가지 않게 막는다 — Enter · Esc · ↑ ↓ · Tab 만 올라간다 · IME 조합 중엔 전부 막는다).

import { CHAR_SLOTS, CLASS_IDS } from '../../core/constants.js';

/** @typedef {import('../../types.js').Panel} Panel */

const NAME_MAX = 12;
/** 입력 칸에서 창으로 올려 보내는 키(나머지는 입력 칸만) */
const PASS = new Set(['Enter', 'NumpadEnter', 'Escape', 'ArrowUp', 'ArrowDown', 'Tab']);

/**
 * @param {{root:HTMLElement, sim:any, bus:any, settings:any, actions:any, t:(key:string, params?:Object) => string, ui:any, widgets:any}} ctx
 * @returns {Panel}
 */
export function createNewCharPanel(ctx) {
  const { t, widgets: w, actions, sim, ui } = ctx;
  const el = w.panelFrame('panel.newChar.title');
  el.dataset.panel = 'newChar';
  el.classList.add('pnl-newchar');
  const form = el.appendChild(w.el('div', 'menu form'));
  // 클래스
  const rowCls = form.appendChild(w.el('div', 'menu-item form-row'));
  rowCls.appendChild(w.el('div', 'form-label', t('newChar.class')));
  const clsBox = rowCls.appendChild(w.el('div', 'form-value choice'));
  /** @type {HTMLElement[]} */
  const clsEls = CLASS_IDS.map((c) => {
    const b = clsBox.appendChild(w.el('span', 'choice-opt', t('class.' + c)));
    b.addEventListener('click', (ev) => { ev.stopPropagation(); setCls(CLASS_IDS.indexOf(c)); });
    return b;
  });
  const clsDesc = rowCls.appendChild(w.el('div', 'form-desc'));
  // 이름
  const rowName = form.appendChild(w.el('div', 'menu-item form-row'));
  rowName.appendChild(w.el('div', 'form-label', t('newChar.name')));
  const input = /** @type {HTMLInputElement} */ (rowName.appendChild(w.el('input', 'form-input')));
  input.type = 'text';
  input.maxLength = NAME_MAX;
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.placeholder = t('title.namePlaceholder');
  // 칸
  const rowSlot = form.appendChild(w.el('div', 'menu-item form-row'));
  rowSlot.appendChild(w.el('div', 'form-label', t('newChar.slot')));
  const slotVal = rowSlot.appendChild(w.el('div', 'form-value choice-one'));
  // 시작
  const rowGo = form.appendChild(w.el('div', 'menu-item form-row form-go'));
  rowGo.appendChild(w.el('div', 'menu-label', t('newChar.create')));
  const err = el.appendChild(w.el('div', 'panel-error'));
  const foot = el.appendChild(w.el('div', 'panel-foot'));
  foot.appendChild(w.el('div', 'panel-hint', t('newChar.hint')));

  const ROW_CLS = 0, ROW_NAME = 1, ROW_SLOT = 2, ROW_GO = 3;
  const nav = w.listNav(form, (i, via) => {
    if (i === ROW_GO || (via === 'key' && i !== ROW_NAME)) create();
    else if (i === ROW_SLOT && via === 'pointer') setSlot(slot + 1);
  }, { onFocus: (i) => onRow(i) });
  let cls = 0;
  let slot = 0;
  let busy = false;

  const chars = () => sim?.state?.account?.chars ?? [];
  /** @param {number} i */
  function setCls(i) {
    cls = ((i % CLASS_IDS.length) + CLASS_IDS.length) % CLASS_IDS.length;
    clsEls.forEach((b, k) => b.classList.toggle('is-on', k === cls));
    clsDesc.textContent = t('newChar.desc.' + CLASS_IDS[cls]);
    input.placeholder = t('title.defaultName.' + CLASS_IDS[cls]);
  }
  /** @param {number} i */
  function setSlot(i) {
    slot = ((i % CHAR_SLOTS) + CHAR_SLOTS) % CHAR_SLOTS;
    const c = chars()[slot];
    slotVal.textContent = c ? t('newChar.slotUsed', { n: slot + 1, name: c.name }) : t('newChar.slotEmpty', { n: slot + 1 });
    slotVal.classList.toggle('is-warn', !!c);
  }
  /** @param {number} i */
  function onRow(i) {
    if (i === ROW_NAME) { if (document.activeElement !== input) input.focus({ preventScroll: true }); }
    else if (document.activeElement === input) input.blur();
  }
  async function create() {
    if (busy) return;
    err.textContent = '';
    const c = chars()[slot];
    if (c) {
      const ok = await w.confirm('title.overwriteConfirm', { name: c.name });
      if (!ok) return;
    }
    const cid = CLASS_IDS[cls];
    const name = input.value.trim().slice(0, NAME_MAX) || t('title.defaultName.' + cid);
    busy = true;
    try {
      const res = await actions.newChar?.({ slot, cls: cid, name, confirmed: !!c });
      if (res && res.ok === false) err.textContent = t('reason.' + res.reason, res.params);
    } catch (e) {
      queueMicrotask(() => { throw e; });
    } finally {
      busy = false;
    }
  }
  // 입력 칸의 키 — 글자는 입력 칸만(창의 게임 · ui 처리기로 올라가지 않게)
  input.addEventListener('keydown', (ev) => {
    if (ev.isComposing || ev.keyCode === 229) { ev.stopPropagation(); return; }
    if (!PASS.has(ev.code)) ev.stopPropagation();
  });
  input.addEventListener('keyup', (ev) => { if (!PASS.has(ev.code)) ev.stopPropagation(); });
  input.addEventListener('focus', () => { if (nav.index !== ROW_NAME) nav.focus(ROW_NAME, true); });
  rowCls.addEventListener('click', () => nav.focus(ROW_CLS, true));

  return {
    id: 'newChar',
    modal: true,
    el,
    open(args = {}) {
      err.textContent = '';
      input.value = '';
      setCls(typeof args.cls === 'string' && CLASS_IDS.includes(args.cls) ? CLASS_IDS.indexOf(args.cls) : cls);
      const cs = chars();
      let s = typeof args.slot === 'number' ? args.slot : cs.findIndex((c) => !c);
      if (s < 0) s = 0;
      setSlot(s);
      nav.focus(ROW_CLS, true);
      if (document.activeElement === input) input.blur();
    },
    close() { if (document.activeElement === input) input.blur(); },
    update() {},
    handleKey(e) {
      const down = e.type !== 'keyup';
      if (e.isComposing) return false;
      const code = e.code;
      const onInput = typeof document !== 'undefined' && document.activeElement === input;
      if (code === 'Escape') {
        if (down && !e.repeat) ui.closePanel('newChar', 'esc');
        return true;
      }
      if (code === 'Tab') {
        if (down) nav.focus(nav.index >= ROW_GO ? ROW_CLS : nav.index + 1);
        return true;
      }
      if (code === 'ArrowLeft' || code === 'ArrowRight') {
        if (onInput) return false;
        if (down) {
          const d = code === 'ArrowLeft' ? -1 : 1;
          if (nav.index === ROW_CLS) setCls(cls + d);
          else if (nav.index === ROW_SLOT) setSlot(slot + d);
        }
        return true;
      }
      if (code === 'ArrowUp' || code === 'ArrowDown') {
        if (down) {
          const d = code === 'ArrowUp' ? -1 : 1;
          let i = nav.index + d;
          if (i < ROW_CLS) i = ROW_GO;
          if (i > ROW_GO) i = ROW_CLS;
          nav.focus(i);
        }
        return true;
      }
      if (code === 'Enter' || code === 'NumpadEnter') {
        if (down && !e.repeat) create();
        return true;
      }
      if (onInput) return false;                               // 글자 키 — 입력 칸이 받는다
      return nav.handleKey(e);
    },
    keys: [],
    dispose() { nav.destroy(); el.remove(); },
  };
}
