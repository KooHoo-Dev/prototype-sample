// OWNER: P8 — 계약 §6.11 · §10
// STUB — W0 스텁(§6.14): 최소 HUD 한 줄(시계 · 씬 이름 · rig.phase — 파이팅이면 텐션 · 거리)을 #ui-root 에 그린다.
//   openPanel · closePanel 은 스택만 바꾸고 이벤트를 낸다(§10.4 규칙 그대로 · 화면은 패널 이름 한 줄). isBlocking() = 스택이 비어 있지 않음.
//   setAutoPanels 는 저장만 · fade 즉시 resolve · handleKey false. P8 이 채운다.

import './style.css';
import { EV } from '../core/events.js';
import { formatClock } from '../sim/clock.js';
import { t } from './i18n.js';

const OVERLAYS = ['pause', 'confirm'];
const MAX_DEPTH = 3;

export class UIRoot {
  /**
   * @param {{root:HTMLElement, bus:import('../core/events.js').EventBus, sim:Object, settings:Object, actions:Object,
   *          fishPreview:import('../view/fish/FishPreview.js').FishPreview}} deps
   */
  constructor({ root, bus, sim, settings, actions, fishPreview }) {
    this.root = root;
    this.bus = bus;
    this.sim = sim;
    this.settings = settings;
    this.actions = actions;
    this.fishPreview = fishPreview;
    /** @type {Array<{id:string, args:Object}>} */
    this.stack = [];
    this.autoPanels = true;
    this._hudText = '';
    this._panelText = '';
    this.hud = document.createElement('div');
    this.hud.className = 'w0-hud';
    this.panel = document.createElement('div');
    this.panel.className = 'w0-panel';
    this.panel.hidden = true;
    this.toastEl = document.createElement('div');
    this.toastEl.className = 'w0-toast';
    this.toastEl.hidden = true;
    this._toastLeft = 0;
    root.append(this.hud, this.panel, this.toastEl);
  }

  /** @param {Object} state GameState @param {number} dt */
  update(state, dt) {
    const s = /** @type {any} */ (state);
    let line = `${formatClock(s.clock)} · ${t('stage.' + s.scene)} · ${s.rig.phase}`;
    if (s.fight) line += ` · ${s.fight.tension.toFixed(2)}kg · ${s.fight.dist.toFixed(1)}m`;
    if (line !== this._hudText) {
      this._hudText = line;
      this.hud.textContent = line;
    }
    const top = this.activePanel;
    const ptext = top ? t('panel.' + top) : '';
    if (ptext !== this._panelText) {
      this._panelText = ptext;
      this.panel.textContent = ptext;
      this.panel.hidden = !top;
    }
    if (this._toastLeft > 0 && !this.isBlocking()) {
      this._toastLeft -= dt;
      if (this._toastLeft <= 0) this.toastEl.hidden = true;
    }
  }

  /** 패널 스택(§10.4): pause · confirm 은 위에 겹치고, 그 밖은 바탕을 교체 · title 은 스택을 비우고 연다 */
  openPanel(id, args = {}) {
    const top = this.activePanel;
    if (id === 'title') {
      while (this.stack.length) this._pop('code');
      this._push(id, args);
      return;
    }
    if (top === 'pause' && id !== 'confirm') return;
    if (OVERLAYS.includes(id)) {
      if (this.stack.length >= MAX_DEPTH) return;
      this._push(id, args);
      return;
    }
    while (this.stack.length && OVERLAYS.includes(this.activePanel)) this._pop('code');
    if (this.stack.length) this._pop('code');
    this._push(id, args);
  }

  /** 맨 위 하나를 닫는다 @param {'esc'|'tab'|'confirm'|'pointer'|'code'} [by] */
  closePanel(by = 'code') {
    if (this.stack.length) this._pop(by);
  }

  _push(id, args) {
    this.stack.push({ id, args });
    this.bus.emit(EV.PANEL_OPENED, { panel: id, depth: this.stack.length });
  }

  _pop(by) {
    const e = this.stack.pop();
    this.bus.emit(EV.PANEL_CLOSED, { panel: e.id, depth: this.stack.length, by });
  }

  /** @returns {string|null} 맨 위 PanelId */
  get activePanel() {
    return this.stack.length ? this.stack[this.stack.length - 1].id : null;
  }

  /** @returns {number} 0..3 */
  get panelDepth() {
    return this.stack.length;
  }

  isBlocking() {
    return this.stack.length > 0;
  }

  /** @param {boolean} on */
  setAutoPanels(on) {
    this.autoPanels = !!on;
  }

  /** STUB @param {KeyboardEvent} e @returns {boolean} 처리했으면 true */
  handleKey(e) {
    void e;
    return false;
  }

  /** STUB — 즉시 resolve @param {boolean} on @param {number} dur @returns {Promise<void>} */
  fade(on, dur) {
    void on; void dur;
    return Promise.resolve();
  }

  /** @param {string} key @param {Object} [params] */
  toast(key, params = {}) {
    this.toastEl.textContent = t(key, params);
    this.toastEl.hidden = false;
    this._toastLeft = 2.5;
  }

  /** @param {string} titleKey @param {string} bodyKey */
  showFatal(titleKey, bodyKey) {
    const box = document.createElement('div');
    box.className = 'w0-fatal';
    const h = document.createElement('div');
    h.textContent = t(titleKey);
    const b = document.createElement('div');
    b.textContent = t(bodyKey);
    box.append(h, b);
    this.root.append(box);
  }

  /** STUB @param {string[]} keys */
  setTitleNotes(keys) {
    void keys;
  }

  dispose() {
    this.hud.remove();
    this.panel.remove();
    this.toastEl.remove();
  }
}
