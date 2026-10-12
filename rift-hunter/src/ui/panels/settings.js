// OWNER: P10 — 계약 §10.2(settings) · 브리프 §5(설정)
// 볼륨 셋(← → 5% · 마우스 끌기 — 놓을 때 적용) · 화질(← → ) · 켬/끔 여섯(Enter · ← →). 바꿀 때마다 actions.applySettings(partial)(정화 · 저장은 app).
// 보이는 값은 늘 지금 설정 객체(ui.settings — SETTINGS_CHANGED 가 바꾼다)에서 읽는다.

import { DEFAULT_SETTINGS, SETTINGS_SCHEMA } from '../../data/settings.js';

/** @typedef {import('../../types.js').Panel} Panel */

const VOL_STEP = 0.05;

/**
 * @param {{root:HTMLElement, sim:any, bus:any, settings:any, actions:any, t:(key:string, params?:Object) => string, ui:any, widgets:any}} ctx
 * @returns {Panel}
 */
export function createSettingsPanel(ctx) {
  const { t, widgets: w, actions, ui } = ctx;
  const el = w.panelFrame('panel.settings.title');
  el.dataset.panel = 'settings';
  el.classList.add('pnl-settings');
  const list = el.appendChild(w.el('div', 'menu form'));
  const keys = Object.keys(DEFAULT_SETTINGS).filter((k) => SETTINGS_SCHEMA[k]);
  /** @type {Array<{key:string, row:HTMLElement, val:HTMLElement, range:HTMLInputElement|null}>} */
  const rows = keys.map((key) => {
    const sc = SETTINGS_SCHEMA[key];
    const row = list.appendChild(w.el('div', 'menu-item form-row'));
    row.appendChild(w.el('div', 'form-label', t('settings.' + key)));
    const box = row.appendChild(w.el('div', 'form-value'));
    /** @type {HTMLInputElement|null} */
    let range = null;
    if (sc.type === 'number') {
      range = /** @type {HTMLInputElement} */ (box.appendChild(w.el('input', 'form-range')));
      range.type = 'range';
      range.min = String(sc.min);
      range.max = String(sc.max);
      range.step = String(VOL_STEP);
      range.tabIndex = -1;
      range.addEventListener('input', () => { val.textContent = pct(Number(range?.value)); });
      range.addEventListener('change', () => apply(key, Number(range?.value)));
      range.addEventListener('keydown', (ev) => ev.preventDefault());
    }
    const val = box.appendChild(w.el('span', 'form-num'));
    return { key, row, val, range };
  });
  const foot = el.appendChild(w.el('div', 'panel-foot'));
  foot.appendChild(w.el('div', 'panel-hint', t('settings.hint')));
  const nav = w.listNav(list, (i, via) => {
    const r = rows[i];
    if (!r) return;
    const sc = SETTINGS_SCHEMA[r.key];
    if (sc.type === 'bool') apply(r.key, !cur()[r.key]);
    else if (sc.type === 'enum' && (via === 'key' || via === 'pointer')) step(r.key, 1);
  });

  const cur = () => ui?.settings ?? ctx.settings ?? DEFAULT_SETTINGS;
  /** @param {number} v */
  const pct = (v) => Math.round((Number.isFinite(v) ? v : 0) * 100) + '%';
  /** @param {string} key @param {any} v */
  function apply(key, v) {
    actions.applySettings?.({ [key]: v });
    refresh();
  }
  /** @param {string} key @param {number} d */
  function step(key, d) {
    const sc = SETTINGS_SCHEMA[key];
    const s = cur();
    if (sc.type === 'number') {
      const v = Math.round(Math.max(sc.min, Math.min(sc.max, (Number(s[key]) || 0) + d * VOL_STEP)) * 100) / 100;
      apply(key, v);
    } else if (sc.type === 'enum') {
      const vals = sc.values;
      const i = Math.max(0, vals.indexOf(s[key]));
      apply(key, vals[(i + d + vals.length) % vals.length]);
    } else if (sc.type === 'bool') {
      apply(key, !s[key]);
    }
  }
  function refresh() {
    const s = cur();
    for (const r of rows) {
      const sc = SETTINGS_SCHEMA[r.key];
      const v = s[r.key];
      if (sc.type === 'number') {
        if (r.range && document.activeElement !== r.range) r.range.value = String(v);
        r.val.textContent = pct(Number(v));
      } else if (sc.type === 'enum') {
        r.val.textContent = '‹ ' + t('settings.' + r.key + '.' + v) + ' ›';
      } else {
        r.val.textContent = t(v ? 'settings.on' : 'settings.off');
        r.val.classList.toggle('is-on', !!v);
      }
    }
  }

  return {
    id: 'settings',
    modal: true,
    el,
    open() { refresh(); nav.focus(0, true); },
    close() {},
    update() {},
    handleKey(e) {
      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        if (e.type !== 'keyup') {
          const r = rows[nav.index];
          if (r) step(r.key, e.code === 'ArrowLeft' ? -1 : 1);
        }
        return true;
      }
      return nav.handleKey(e);
    },
    keys: [],
    dispose() { nav.destroy(); el.remove(); },
  };
}
