// OWNER: P8 — 계약 §10.2 · §11.2
// 일시정지 — 다른 패널 위에 겹친다(§10.4). 탭: 메뉴(계속 · 타이틀로) · 설정 · 조작 안내.
// 설정은 actions.applySettings(partial)로만 바꾼다(값은 app 이 준 settings 를 읽는다). args.overridden(설정 키 배열)이면 「이번 실행만」.
// Esc 는 닫는다(= resume — UIRoot 가 처리 · app 은 PANEL_CLOSED{pause}로 PAUSED{false}).

import { SETTINGS_RANGE } from '../../data/economy.js';
import { t } from '../i18n.js';
import { PanelBase, el, fmt, pct } from '../widgets.js';

const SLIDER_STEP = 0.05;       // 슬라이더 ±5%(§10.5)
const FOV_STEP = 2;             // FOV 는 정수 눈금(범위 30의 약 5%)
const VOLUME_KEYS = SETTINGS_RANGE.volumeKeys;
/** 조작 안내 [키 문자열 키, 뜻 문자열 키] */
const CONTROLS = [
  ['controls.k.move', 'controls.d.move'],
  ['controls.k.look', 'controls.d.look'],
  ['controls.k.interact', 'controls.d.interact'],
  ['controls.k.cast', 'controls.d.cast'],
  ['controls.k.reel', 'controls.d.reel'],
  ['controls.k.pump', 'controls.d.pump'],
  ['controls.k.hook', 'controls.d.hook'],
  ['controls.k.drag', 'controls.d.drag'],
  ['controls.k.bail', 'controls.d.bail'],
  ['controls.k.depth', 'controls.d.depth'],
  ['controls.k.set', 'controls.d.set'],
  ['controls.k.aim', 'controls.d.aim'],
  ['controls.k.tackle', 'controls.d.tackle'],
  ['controls.k.release', 'controls.d.release'],
  ['controls.k.esc', 'controls.d.esc'],
  ['controls.k.panel', 'controls.d.panel'],
];

class PausePanel extends PanelBase {
  /** @param {import('../widgets.js').PanelCtx} ctx */
  constructor(ctx) {
    super(ctx, 'pause', { tabs: ['pause.tab.menu', 'pause.tab.settings', 'pause.tab.controls'], size: 'm' });
  }

  /** @param {string|null} tab */
  build(tab) {
    if (tab === 'pause.tab.settings') this._settings();
    else if (tab === 'pause.tab.controls') this._controls();
    else this._menu();
  }

  _menu() {
    const actions = /** @type {any} */ (this.ctx.actions);
    const ui = /** @type {any} */ (this.ui);
    const resume = el('div', 'row row-big');
    resume.append(el('span', 'row-main', t('pause.resume')));
    this.addItem(resume, {
      activate: () => {
        const entry = ui.stack.top;
        if (typeof actions.resume === 'function') actions.resume();
        if (entry && entry.id === 'pause' && ui.stack.entries.includes(entry) && ui.stack.top === entry) ui.closePanel('confirm');
      },
    });
    const quit = el('div', 'row row-big');
    quit.append(el('span', 'row-main', t('pause.quit')), el('span', 'row-sub', t('pause.quitNote')));
    this.addItem(quit, { activate: () => { if (typeof actions.quitToTitle === 'function') actions.quitToTitle(); } });
  }

  _settings() {
    const s = /** @type {any} */ (this.ctx.settings) || {};
    const over = Array.isArray(/** @type {any} */ (this.args).overridden) ? /** @type {any} */ (this.args).overridden : [];
    const [sMin, sMax] = SETTINGS_RANGE.mouseSens;
    const [fMin, fMax] = SETTINGS_RANGE.fov;
    this._slider('settings.mouseSens', fmt(s.mouseSens, 2), over.includes('mouseSens'), (dir) => {
      const v = clampNum(round2((s.mouseSens ?? 1) + dir * (sMax - sMin) * SLIDER_STEP), sMin, sMax);
      this._apply({ mouseSens: v });
    });
    this._toggle('settings.invertY', !!s.invertY, over.includes('invertY'), () => this._apply({ invertY: !s.invertY }));
    for (const k of VOLUME_KEYS) {
      const vol = s.volume || {};
      this._slider('settings.volume.' + k, pct(vol[k] ?? 0), over.includes('volume') || over.includes('mute'), (dir) => {
        const v = clampNum(round2((vol[k] ?? 0) + dir * SLIDER_STEP), 0, 1);
        this._apply({ volume: { ...vol, [k]: v } });
      });
    }
    const qs = SETTINGS_RANGE.quality;
    this._slider('settings.quality', t('quality.' + (s.quality || 'medium')), over.includes('quality'), (dir) => {
      const i = Math.max(0, qs.indexOf(s.quality));
      const n = Math.max(0, Math.min(qs.length - 1, i + dir));
      if (n !== i) this._apply({ quality: qs[n] });
    });
    this._slider('settings.fov', fmt(s.fov ?? 70), over.includes('fov'), (dir) => {
      this._apply({ fov: clampNum(Math.round((s.fov ?? 70) + dir * FOV_STEP), fMin, fMax) });
    });
    this._toggle('settings.hints', s.hints !== false, over.includes('hints'), () => this._apply({ hints: s.hints === false }));
  }

  /** @param {Object} partial */
  _apply(partial) {
    const actions = /** @type {any} */ (this.ctx.actions);
    if (typeof actions.applySettings === 'function') actions.applySettings(partial);
    this.render();
  }

  /** @param {string} key @param {string} value @param {boolean} once @param {(dir:number) => void} adjust */
  _slider(key, value, once, adjust) {
    const row = el('div', 'row row-setting');
    row.append(el('span', 'row-main', t(key)), el('span', 'row-value', value));
    if (once) row.append(el('span', 'row-once', t('settings.thisRun')));
    this.addItem(row, { adjust });
  }

  /** @param {string} key @param {boolean} on @param {boolean} once @param {() => void} toggle */
  _toggle(key, on, once, toggle) {
    const row = el('div', 'row row-setting');
    row.append(el('span', 'row-main', t(key)), el('span', 'row-value', t(on ? 'settings.on' : 'settings.off')));
    if (once) row.append(el('span', 'row-once', t('settings.thisRun')));
    this.addItem(row, { activate: toggle, adjust: () => toggle() });
  }

  _controls() {
    for (const [k, d] of CONTROLS) {
      const row = el('div', 'row row-control');
      row.append(el('span', 'kbd', t(k)), el('span', 'row-main', t(d)));
      this.addItem(row, {});
    }
  }
}

/** @param {number} v @param {number} lo @param {number} hi */
function clampNum(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
/** @param {number} v */
function round2(v) { return Math.round(v * 100) / 100; }

/**
 * @param {import('../widgets.js').PanelCtx} ctx
 * @returns {PausePanel}
 */
export function createPausePanel(ctx) {
  return new PausePanel(ctx);
}
