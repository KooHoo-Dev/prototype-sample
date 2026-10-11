// OWNER: P10 — 계약 §10.1 · §10.2 · §10.3
// STUB — W2 에서 P10 이 채운다(HUD 전부 · 이름표 · 피해 숫자 · 미니맵 · 안내 · 입력 포커스 규칙).
// W0: 최소 HUD(장면 · 생명/최대 · 자원 · 균열 게이지 · 패널 ID) + openPanel · closePanel · handleKey(Escape) · topPanel · isModal · blocksPointer · labelHover → null

import { EV } from '../core/events.js';
import { PANELS } from './panels/index.js';
import { t } from './i18n.js';
import * as widgets from './widgets.js';

export class UIRoot {
  /** @param {{root:HTMLElement, bus:any, sim:any, settings:any, actions:any, view:{project:Function}}} deps */
  constructor({ root, bus, sim, settings, actions, view }) {
    this.root = root;
    this.bus = bus;
    this.sim = sim;
    this.settings = settings;
    this.actions = actions;
    this.view = view;
    /** @type {Array<import('../types.js').Panel>} */
    this.stack = [];
    /** @type {Map<string, import('../types.js').Panel>} */
    this.cache = new Map();
    this.hud = document.createElement('div');
    this.hud.className = 'hud-stub';
    this.layer = document.createElement('div');
    this.layer.className = 'panel-layer';
    this.noticeEl = document.createElement('div');
    this.noticeEl.className = 'notice-stub';
    root.append(this.hud, this.layer, this.noticeEl);
    this._last = '';
  }

  /** 상태에서 HUD 를 다시 그린다 @param {import('../types.js').GameState} state */
  update(state, alpha, dtReal) {
    const p = state.player;
    const r = state.rift;
    const parts = [
      `${t('hud.scene')}: ${t('tileset.' + (state.scene === 'rift' && r ? r.tileset : 'town'))}`,
      `${t('hud.life')} ${Math.round(p.life)}/${Math.round(p.lifeMax)}`,
      `${t('hud.resource')} ${Math.round(p.resource)}/${Math.round(p.resourceMax)}`,
    ];
    if (state.scene === 'rift' && r) parts.push(`${t('hud.gauge')} ${Math.round(r.gauge)}% · ${t('hud.lives')} ${r.lives}`);
    if (this.stack.length) parts.push(`${t('hud.panel')}: ${this.stack.map(x => x.id).join(' › ')}`);
    if (state.flags.devSession) parts.push(t('hud.devBadge'));
    const text = parts.join('  |  ');
    if (text !== this._last) { this.hud.textContent = text; this._last = text; }
    for (const pnl of this.stack) pnl.update(state);
  }

  /** @param {import('../types.js').PanelId} id @param {Object} [args] @returns {boolean} */
  openPanel(id, args = {}) {
    const make = PANELS[id];
    if (!make) return false;
    let pnl = this.cache.get(id);
    if (!pnl) {
      pnl = make({ root: this.layer, sim: this.sim, bus: this.bus, settings: this.settings, actions: this.actions, t, ui: this, widgets });
      this.cache.set(id, pnl);
    }
    const i = this.stack.indexOf(pnl);
    if (i >= 0) this.stack.splice(i, 1);
    this.stack.push(pnl);
    this.layer.appendChild(pnl.el);
    pnl.open(args);
    this.bus.emit(EV.PANEL_OPENED, { panel: id, modal: pnl.modal, depth: this.stack.length });
    return true;
  }

  /** @param {string|null} [id] 없으면 맨 위 @param {'esc'|'key'|'confirm'|'pointer'|'code'} [by] */
  closePanel(id = null, by = 'code') {
    const idx = id === null ? this.stack.length - 1 : this.stack.findIndex(p => p.id === id);
    if (idx < 0) return;
    const [pnl] = this.stack.splice(idx, 1);
    pnl.close();
    pnl.el.remove();
    this.bus.emit(EV.PANEL_CLOSED, { panel: pnl.id, depth: this.stack.length, by });
  }

  closeAll(by = 'code') {
    while (this.stack.length) this.closePanel(null, by);
  }

  topPanel() { return this.stack.length ? this.stack[this.stack.length - 1].id : null; }
  isModal() { return this.stack.some(p => p.modal); }
  anyOpen() { return this.stack.length > 0; }

  /** 맨 위 패널 하나에만 · W0: Escape 로 맨 위 패널 닫기 @param {KeyboardEvent} e @returns {boolean} */
  handleKey(e) {
    const top = this.stack[this.stack.length - 1];
    if (!top) return false;
    if (top.handleKey(e)) return true;
    if (e.code === 'Escape') {
      if (e.type === 'keydown') this.closePanel(null, 'esc');
      return true;
    }
    return top.modal;
  }

  /** STUB — 그 화면 점이 상호작용하는 UI 위다 */
  blocksPointer(px, py) { return false; }
  /** STUB — 마우스 아래 바닥 이름표 */
  labelHover() { return null; }
  /** STUB */
  setLabels(on) {}

  /** 알림(W0: 한 줄 텍스트) @param {string} key */
  notice(key, params = {}, { big = false, sec = 3 } = {}) {
    this.noticeEl.textContent = t(key, params);
  }
  /** @param {string|null} key */
  setSticky(key) { this.noticeEl.textContent = key ? t(key) : ''; }

  /** 전체 화면 안내 @param {string} titleKey @param {string} bodyKey */
  showFatal(titleKey, bodyKey) {
    const el = document.createElement('div');
    el.className = 'fatal';
    const h = document.createElement('h1');
    h.textContent = t(titleKey);
    const p = document.createElement('p');
    p.textContent = t(bodyKey);
    el.append(h, p);
    this.root.appendChild(el);
  }

  dispose() {
    this.closeAll();
    for (const p of this.cache.values()) p.dispose();
    this.cache.clear();
    this.hud.remove();
    this.layer.remove();
    this.noticeEl.remove();
  }
}
