// OWNER: P8 — 계약 §6.11 · §10
// ui 진입점: HUD · 패널 10종(스택 · 자가 동기화) · 알림 · 배너 · 안내 문구 · 전환 막 · 치명 안내.
//   ui 는 상태를 읽고 sim 명령을 부른다(상태를 고치지 않는다). 이벤트는 알림 · 배너 · 패널 열기에만 쓴다 —
//   놓쳐도 update(state) 의 자가 동기화가 막히지 않게 한다(§10.1).
//   알림 · 배너 · 안내 카드의 수명은 ui dt 로 깎고 일시정지(PAUSED) · 패널(isBlocking) 동안 멈춘다(§10.3).

import './style.css';
import { EV } from '../core/events.js';
import { BITE } from '../data/bite.js';
import { HOLD } from '../data/economy.js';
import { getSpot } from '../data/stages/index.js';
import { t } from './i18n.js';
import { createHud } from './hud.js';
import { PanelStack } from './stack.js';
import { el, fmt, setHidden, setText, won } from './widgets.js';
import { createTitlePanel } from './panels/title.js';
import { createPausePanel } from './panels/pause.js';
import { createTacklePanel } from './panels/tackle.js';
import { createResultPanel } from './panels/result.js';
import { createSellPanel } from './panels/sell.js';
import { createPcPanel } from './panels/pc.js';
import { createCampPanel } from './panels/camp.js';
import { createMapPanel } from './panels/map.js';
import { createBedPanel } from './panels/bed.js';
import { createConfirmPanel } from './panels/confirm.js';

/** 패널이 열린 뒤(다시 보인 뒤) 확인 키(Space · Enter · KeyX)를 버리는 시간(s — §5.5 · §10.4) */
export const PANEL_INPUT_GRACE = 0.25;

const NOTICE_LIFE = 2.6;      // 알림 수명(s, ui dt)
const NOTICE_MAX = 3;         // 화면 위쪽 가운데 — 쌓이면 최대 3줄(§10.3)
const NOTICE_FADE = 0.3;      // 끝나기 전 흐려지는 시간 · FAIL 알림의 페이드(§10.3)
const BANNER_LIFE = 2.5;      // 배너(§10.3)
const BANNER_QUEUE_MAX = 6;
const HINT_LIFE = 6;          // 안내 카드(§10.3)
/** 입질 이후의 안내는 지금 카드를 밀어낸다(그 순간의 뜻이 더 급하다) */
const URGENT_HINTS = ['bite', 'fight', 'net'];
/** 그 대상 앞에서만 열리는 패널 → 상호작용 종류(§10.1 자가 동기화) */
const PLACE_PANELS = { sell: 'npc', camp: 'camp', map: 'door', bed: 'bed', pc: 'pc' };
const INTERACT_PANEL = { npc: 'sell', camp: 'camp', door: 'map', bed: 'bed', pc: 'pc' };
/** 채비 패널을 열 수 있는 단계(§10.2) */
const TACKLE_PHASES = ['idle', 'ready', 'charging', 'waiting', 'retrieving', 'failed'];

/** @returns {number} ms */
function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : 0;
}

export class UIRoot {
  /**
   * @param {{root:HTMLElement, bus:import('../core/events.js').EventBus, sim:Object, settings:Object, actions:Object,
   *          fishPreview:import('../view/fish/FishPreview.js').FishPreview}} deps
   */
  constructor({ root, bus, sim, settings, actions, fishPreview }) {
    this.root = root;
    this.bus = bus;
    this.sim = /** @type {any} */ (sim);
    this.settings = /** @type {any} */ (settings);
    this.actions = /** @type {any} */ (actions);
    this.fishPreview = /** @type {any} */ (fishPreview);
    this.autoPanels = true;
    this.paused = false;
    /** @type {string[]} */
    this.titleNotes = [];
    this.stack = new PanelStack();
    /** @type {Map<number, number>} 스택 항목 key → 확인 키를 다시 받는 시각(ms) */
    this._grace = new Map();
    this._curtainOn = false;
    this._fadeToken = 0;
    /** @type {Array<{node:HTMLElement, life:number, kind:string}>} */
    this.notices = [];
    /** @type {Array<{key:string, params:Object, cls:string}>} */
    this.bannerQueue = [];
    this._banner = { life: 0 };
    this._hint = { id: '', life: 0 };
    /** @type {Set<string>} 이 실행에서 보인 안내(sim.markHintSeen 이 실패해도 되풀이하지 않는다) */
    this._seenHints = new Set();
    /** @type {Object|null} 지금 FAIL 알림이 보이는 LossReport */
    this._failLoss = null;
    this._failNotice = null;
    this._busyPhase = '';
    this._holdFullCastShown = false;
    this._lastPhase = '';
    /** 장소 패널이 열린 때의 씬 · 대상 */
    this._place = { scene: '', kind: '' };

    root.classList.add('jf-ui');
    this.hudLayer = el('div', 'layer layer-hud');
    this.noticeEl = el('div', 'notices');
    this.bannerEl = el('div', 'banner');
    this.bannerEl.hidden = true;
    this.hintEl = el('div', 'hint-card');
    this.hintEl.hidden = true;
    this.hintTitle = el('div', 'hint-title');
    this.hintBody = el('div', 'hint-body');
    this.hintFoot = el('div', 'hint-foot', t('hint.dismiss'));
    this.hintEl.append(this.hintTitle, this.hintBody, this.hintFoot);
    this.hintEl.addEventListener('click', () => { this._hint.life = 0; });
    this.panelLayer = el('div', 'layer layer-panels');
    this.panelLayer.hidden = true;
    this.backdrop = el('div', 'backdrop');
    this.panelLayer.append(this.backdrop);
    this.curtain = el('div', 'curtain');
    this.fatalEl = null;
    root.append(this.hudLayer, this.hintEl, this.noticeEl, this.bannerEl, this.panelLayer, this.curtain);

    this.hud = createHud(this.hudLayer, { sim: this.sim, ui: this });

    const ctx = { root: this.panelLayer, sim: this.sim, actions: this.actions, bus, ui: this, settings: this.settings, fishPreview: this.fishPreview };
    /** @type {Record<string, any>} */
    this.panels = {
      title: createTitlePanel(ctx),
      pause: createPausePanel(ctx),
      tackle: createTacklePanel(ctx),
      result: createResultPanel(ctx),
      sell: createSellPanel(ctx),
      pc: createPcPanel(ctx),
      camp: createCampPanel(ctx),
      map: createMapPanel(ctx),
      bed: createBedPanel(ctx),
      confirm: createConfirmPanel(ctx),
    };

    /** @type {Array<() => void>} */
    this._offs = [];
    const on = (name, fn) => this._offs.push(bus.on(name, fn));
    on(EV.INTERACT, (p) => {
      if (!this.autoPanels) return;
      const id = INTERACT_PANEL[p.kind];
      if (id) this.openPanel(id, { interact: p.kind });
    });
    on(EV.CATCH_RESULT, () => { if (this.autoPanels) this.openPanel('result'); });
    on(EV.FAIL, (p) => this._showFail(p.loss, p.reason));
    on(EV.CAST_BLOCKED, (p) => this.toast('reason.' + p.reason));
    on(EV.RIG_BUSY, () => {
      const ph = this.sim.state.rig.phase;
      if (this._busyPhase === ph) return;
      this._busyPhase = ph;
      this.toast('reason.busy');
    });
    on(EV.FISHING_ENTER, () => { this._holdFullCastShown = false; this.hud.markDirty(); });
    on(EV.CAST_START, () => {
      if (this._holdFullCastShown) return;
      if (this.sim.state.profile.hold.length >= HOLD.capacity) {
        this._holdFullCastShown = true;
        this.toast('reason.holdFullCast');
      }
    });
    on(EV.CAST_RELEASE, (p) => { if (p.perfect) this.toast('hud.notice.perfect', { m: fmt(p.distM, 1) }); });
    on(EV.BAIT_GRANTED, (p) => this.toast('hud.notice.baitGranted', { name: t('bait.' + p.baitId), n: p.count }));
    on(EV.MONEY_CHANGED, (p) => this.hud.moneyPop(p.delta));
    on(EV.XP_GAINED, (p) => this.hud.xpPop(p.amount));
    on(EV.LEVEL_UP, (p) => {
      this.banner('banner.levelUp', { n: p.level }, 'is-level');
      this._unlockBanners(p.unlocks);
    });
    on(EV.SKILL_LEARNED, (p) => {
      this.toast('hud.notice.skill', { name: t('skill.' + p.skillId), n: p.rank });
      this._unlockBanners(p.unlocks);
      this.hud.markDirty();
    });
    on(EV.RECORD, (p) => {
      const name = t('species.' + p.speciesId);
      if (p.kind === 'first') this.banner('banner.first', { name }, 'is-first');
      else this.banner('banner.record', { name, kg: fmt(p.weightKg, 2) }, 'is-record');
    });
    on(EV.CATCH_KEPT, (p) => {
      this._tierBanner(p.catch);
      this.toast('hud.notice.kept', { name: t('species.' + p.catch.speciesId), n: this.sim.state.profile.hold.length, cap: HOLD.capacity });
    });
    on(EV.CATCH_RELEASED, (p) => {
      if (p.swapped) this.toast('hud.notice.swapped', { name: t('species.' + p.catch.speciesId) });
      else {
        this._tierBanner(p.catch);
        this.toast('hud.notice.released', { name: t('species.' + p.catch.speciesId) });
      }
    });
    on(EV.SOLD, (p) => { if (p.count > 0) this.toast(p.auto ? 'hud.notice.autoSold' : 'hud.notice.sold', { n: p.count, money: won(p.total) }); });
    on(EV.BOUGHT, () => this.hud.markDirty());
    on(EV.LINE_REFILLED, (p) => {
      this.hud.markDirty();
      if (p.meters > 0 && p.cost > 0) this.toast('hud.notice.refilled', { m: fmt(p.meters), money: won(p.cost) });
    });
    on(EV.EQUIPPED, () => this.hud.markDirty());
    on(EV.SET_CHANGED, () => this.hud.markDirty());
    on(EV.RIG_RESTORED, () => this.hud.markDirty());
    on(EV.HOOK_SET, () => this.hud.markDirty());
    on(EV.SCENE_CHANGED, () => this.hud.markDirty());
    on(EV.CLOCK_BAND, (p) => this.toast('hud.notice.band', { band: t('band.' + p.band) }));
    on(EV.PAUSED, (p) => { this.paused = !!p.on; });
    on(EV.POINTER_LOCK, (p) => this.hud.setPointer(p.locked, p.available));
    on(EV.SETTINGS_CHANGED, () => { const top = this.stack.top; if (top && top.id === 'pause') this.panels.pause.render(); });
  }

  // ── 매 프레임

  /** @param {Object} state GameState @param {number} dt */
  update(state, dt) {
    const s = /** @type {any} */ (state);
    const d = Number.isFinite(dt) && dt > 0 ? dt : 0;
    this._syncPanels(s);
    const blocking = this.isBlocking();
    const frozen = this.paused || blocking;
    const titleUp = this.stack.has('title');
    this.hud.update(s, d, { frozen, blocking, hideAll: titleUp || !!this.fatalEl });
    if (s.rig.phase !== this._lastPhase) {
      this._lastPhase = s.rig.phase;
      this._busyPhase = '';
    }
    this._updateNotices(s, frozen ? 0 : d);
    this._updateBanner(frozen ? 0 : d);
    this._updateHint(s, frozen ? 0 : d, blocking || titleUp);
    const top = this.stack.top;
    if (top) this.panels[top.id].update(s, d);
  }

  /** 패널 자가 동기화(§10.1) @param {any} s */
  _syncPanels(s) {
    const rig = s.rig;
    if (this.stack.has('result') && rig.phase !== 'result') this._remove('result');
    if (this.autoPanels && this.stack.depth === 0 && rig.phase === 'result' && s.pendingCatch) this.openPanel('result');
    const base = this.stack.base;
    if (base && PLACE_PANELS[base.id]) {
      const kind = PLACE_PANELS[base.id];
      const nb = s.player.nearby;
      const sceneChanged = s.scene !== this._place.scene;
      const leftTarget = this._place.kind === kind && (!nb || nb.kind !== kind);
      if (sceneChanged || leftTarget) this._remove(base.id);
    }
  }

  // ── 패널 스택(§10.4)

  /** @param {string} id @param {Object} [args] */
  openPanel(id, args = {}) {
    const s = this.sim.state;
    if (id === 'tackle' && s && s.player.mode === 'fish' && !TACKLE_PHASES.includes(s.rig.phase)) {
      this.toast('reason.busy');
      return;
    }
    const topBefore = this.stack.top;
    const r = this.stack.open(id, args);
    if (!r.ok) return;
    for (const c of r.closed) this._afterClose(c.entry, c.depth, 'code');
    if (PLACE_PANELS[id] && s) {
      this._place.scene = s.scene;
      this._place.kind = s.player.nearby ? s.player.nearby.kind : '';
    }
    if (topBefore && this.stack.entries.includes(topBefore)) this.panels[topBefore.id].setCovered(true);
    for (const c of r.opened) {
      this._grace.set(c.entry.key, nowMs() + PANEL_INPUT_GRACE * 1000);
      this.panels[c.entry.id].open(c.entry.args);
      this.bus.emit(EV.PANEL_OPENED, { panel: c.entry.id, depth: c.depth });
    }
    this._layout();
  }

  /** 맨 위 하나를 닫는다 @param {'esc'|'tab'|'confirm'|'pointer'|'code'} [by] */
  closePanel(by = 'code') {
    const r = this.stack.close();
    if (!r.ok) return;
    for (const c of r.closed) this._afterClose(c.entry, c.depth, by);
    this._revealTop();
  }

  /** 스택 어디에 있든 그 패널을 뺀다(자가 동기화) @param {string} id */
  _remove(id) {
    const wasTop = this.stack.top;
    const r = this.stack.remove(id);
    if (!r.ok) return;
    for (const c of r.closed) this._afterClose(c.entry, c.depth, 'code');
    if (wasTop && wasTop.id === id) this._revealTop();
    else this._layout();
  }

  /** @param {{id:string, key:number}} entry @param {number} depth @param {string} by */
  _afterClose(entry, depth, by) {
    this._grace.delete(entry.key);
    const p = this.panels[entry.id];
    if (!this.stack.has(entry.id)) {
      p.close();
      p.setCovered(false);
    }
    this.bus.emit(EV.PANEL_CLOSED, { panel: entry.id, depth, by });
  }

  _revealTop() {
    const top = this.stack.top;
    if (top) {
      this._grace.set(top.key, nowMs() + PANEL_INPUT_GRACE * 1000);
      const p = this.panels[top.id];
      p.setCovered(false);
      p.args = top.args;
      p.reveal();
    }
    this._layout();
  }

  /** 맨 위만 보인다(겹친 패널 아래는 숨긴다 — 1280×720 에서 겹치지 않게) */
  _layout() {
    const top = this.stack.top;
    for (const id in this.panels) {
      const p = this.panels[id];
      const vis = !!top && top.id === id;
      setHidden(p.el, !vis);
    }
    setHidden(this.panelLayer, !top);
    this.panelLayer.classList.toggle('is-title', !!top && top.id === 'title');
  }

  /** @returns {string|null} */
  get activePanel() {
    const top = this.stack.top;
    return top ? top.id : null;
  }

  /** @returns {number} 0..3 */
  get panelDepth() {
    return this.stack.depth;
  }

  isBlocking() {
    return this.stack.depth > 0 || this._curtainOn;
  }

  /** @param {boolean} on */
  setAutoPanels(on) {
    this.autoPanels = !!on;
  }

  // ── 키(§10.4 · §10.5)

  /** @param {KeyboardEvent} e @returns {boolean} 처리했으면 true(게임 입력으로 새지 않는다) */
  handleKey(e) {
    if (!e || e.ctrlKey || e.altKey || e.metaKey) return false;
    const code = e.code;
    const top = this.stack.top;
    if (this._curtainOn && !top) {
      prevent(e);
      return true;
    }
    if (!top) {
      if (code === 'Tab') {
        prevent(e);
        if (!e.repeat) this.openPanel('tackle');
        return true;
      }
      return false;
    }
    if (code === 'Escape') {
      prevent(e);
      if (!e.repeat && top.id !== 'result' && top.id !== 'title') this.closePanel('esc');
      return true;
    }
    if (code === 'Tab') {
      prevent(e);
      if (!e.repeat && top.id === 'tackle') this.closePanel('tab');
      return true;
    }
    const until = this._grace.get(top.key) ?? 0;
    const grace = nowMs() < until;
    const handled = this.panels[top.id].handleKey(e, grace);
    if (handled) prevent(e);
    return handled;
  }

  /** 확인 키 유예 중인가(패널이 마우스 클릭도 같은 규칙으로 막을 때) @returns {boolean} */
  inGrace() {
    const top = this.stack.top;
    if (!top) return false;
    return nowMs() < (this._grace.get(top.key) ?? 0);
  }

  // ── 전환 막

  /** @param {boolean} on @param {number} dur s @returns {Promise<void>} 실제 시간(setTimeout) */
  fade(on, dur) {
    const token = ++this._fadeToken;
    const ms = Math.max(0, (Number.isFinite(dur) ? dur : 0) * 1000);
    if (on) this._curtainOn = true;
    this.curtain.style.transitionDuration = `${ms}ms`;
    this.curtain.classList.toggle('is-on', !!on);
    return new Promise((resolve) => {
      setTimeout(() => {
        if (!on && token === this._fadeToken) this._curtainOn = false;
        resolve();
      }, ms);
    });
  }

  // ── 알림 · 배너 · 안내

  /** @param {string} key @param {Object} [params] */
  toast(key, params = {}) {
    const node = el('div', 'notice', t(key, params));
    this._pushNotice({ node, life: NOTICE_LIFE, kind: 'toast' });
  }

  /** @param {{node:HTMLElement, life:number, kind:string}} n */
  _pushNotice(n) {
    this.notices.push(n);
    this.noticeEl.append(n.node);
    while (this.notices.length > NOTICE_MAX) {
      const i = this.notices.findIndex(x => x !== this._failNotice);
      const [old] = this.notices.splice(i < 0 ? 0 : i, 1);
      old.node.remove();
      if (old === this._failNotice) this._failNotice = null;
    }
  }

  /** FAIL — 잃은 것 한 줄 + 원인 한 줄 · 예비 로드 · 예비 스풀 · 낮춘 드랙(§10.3) @param {any} loss @param {string} [reason] */
  _showFail(loss, reason) {
    if (this._failNotice) {
      const i = this.notices.indexOf(this._failNotice);
      if (i >= 0) this.notices.splice(i, 1);
      this._failNotice.node.remove();
      this._failNotice = null;
    }
    const r = (loss && loss.reason) || reason;
    if (!r) return;
    const node = el('div', 'notice notice-fail');
    node.append(el('div', 'notice-title', t('fail.' + r)));
    if (loss) {
      const parts = [];
      if (loss.baitId) parts.push(loss.baitLost ? t('fail.part.bait', { bait: t('bait.' + loss.baitId) }) : t('fail.part.baitKept', { bait: t('bait.' + loss.baitId) }));
      if (loss.tackleCost > 0) parts.push(t('fail.part.cost', { cost: fmt(loss.tackleCost) }));
      if (loss.lineLostM > 0) parts.push(t('fail.part.line', { line: fmt(loss.lineLostM) }));
      if (parts.length) node.append(el('div', 'notice-line', parts.join(t('fail.part.sep'))));
      if (loss.cause) node.append(el('div', 'notice-line notice-cause', t('fail.cause.' + loss.cause)));
      // 「바늘이 작다」는 바늘 빠짐의 원인일 때만(§5.6 — 라인 끊김 알림에 붙으면 원인을 잘못 읽힌다 · 밸런스 게이트)
      if (loss.hookSmall && r === 'hookOff') node.append(el('div', 'notice-line notice-cause', t('fail.hookSmall')));
      if (loss.rodLost) node.append(el('div', 'notice-line', t('fail.part.rodLost', { name: t('gear.' + loss.rodLost) })));
      if (loss.spareSpool) node.append(el('div', 'notice-line', t('fail.spareSpool')));
      if (loss.dragKgAfter !== null && loss.dragKgAfter !== undefined) node.append(el('div', 'notice-line', t('fail.dragLowered', { kg: fmt(loss.dragKgAfter, 2) })));
    }
    const n = { node, life: NOTICE_FADE, kind: 'fail' };
    this._failLoss = loss || null;
    this._failNotice = n;
    this._pushNotice(n);
  }

  /** @param {any} s @param {number} dt 멈춤이면 0 */
  _updateNotices(s, dt) {
    const rig = s.rig;
    // 이벤트를 놓쳐도(고정 상태 · 재부팅) 실패 단계면 알림을 세운다
    if (rig.phase === 'failed' && rig.lastLoss && !this._failNotice && rig.lastLoss !== this._failLoss) this._showFail(rig.lastLoss, rig.failReason);
    for (let i = this.notices.length - 1; i >= 0; i--) {
      const n = this.notices[i];
      if (n.kind === 'fail' && rig.phase === 'failed') n.life = Math.max(n.life, NOTICE_FADE);
      else n.life -= dt;
      const a = n.life < NOTICE_FADE ? Math.max(0, n.life / NOTICE_FADE) : 1;
      const node = /** @type {any} */ (n.node);
      if (node._a !== a) {
        node._a = a;
        n.node.style.opacity = String(a);
      }
      if (n.life <= 0) {
        n.node.remove();
        this.notices.splice(i, 1);
        if (n === this._failNotice) this._failNotice = null;
      }
    }
  }

  /** @param {string} key @param {Object} [params] @param {string} [cls] */
  banner(key, params = {}, cls = '') {
    if (this.bannerQueue.length >= BANNER_QUEUE_MAX) this.bannerQueue.shift();
    this.bannerQueue.push({ key, params, cls });
  }

  /** @param {string[]|undefined} unlocks */
  _unlockBanners(unlocks) {
    if (!Array.isArray(unlocks)) return;
    for (const u of unlocks) {
      if (u.startsWith('stage:')) this.banner('banner.stage', { name: t('stage.' + u.slice(6)) }, 'is-unlock');
      else if (u === 'tier:2') this.banner('banner.tier2', {}, 'is-unlock');
      else if (u === 'tier:3') this.banner('banner.tier3', {}, 'is-unlock');
    }
  }

  /** @param {any} rec CatchRecord */
  _tierBanner(rec) {
    if (!rec) return;
    const name = t('species.' + rec.speciesId);
    if (rec.tier === 'legend') this.banner('banner.legend', { name, kg: fmt(rec.weightKg, 2) }, 'is-legend');
    else if (rec.tier === 'trophy') this.banner('banner.trophy', { name, kg: fmt(rec.weightKg, 2) }, 'is-trophy');
  }

  /** @param {number} dt */
  _updateBanner(dt) {
    const b = this._banner;
    if (b.life > 0) {
      b.life -= dt;
      if (b.life <= 0) setHidden(this.bannerEl, true);
      return;
    }
    const next = this.bannerQueue.shift();
    if (!next) return;
    setText(this.bannerEl, t(next.key, next.params));
    this.bannerEl.className = 'banner ' + next.cls;
    setHidden(this.bannerEl, false);
    b.life = BANNER_LIFE;
  }

  /** @param {string} id @param {any} s */
  _hintSeen(id, s) {
    return this._seenHints.has(id) || !!(s.profile.flags && s.profile.flags.hints && s.profile.flags.hints[id]);
  }

  /** 지금 보일 만한 안내(우선순위 순) @param {any} s @returns {string} */
  _hintCandidate(s) {
    const fishing = s.player.mode === 'fish';
    const rig = s.rig;
    const ph = rig.phase;
    /** @param {string} id @param {boolean} cond */
    const ok = (id, cond) => cond && !this._hintSeen(id, s);
    if (ok('net', !!s.fight && !!s.fight.canNet && ph === 'fighting')) return 'net';
    if (ok('fight', ph === 'fighting')) return 'fight';
    if (ok('bite', fishing && (ph === 'waiting' || ph === 'bite'))) return 'bite';
    if (ok('start', s.scene === 'home' && !fishing)) return 'start';
    if (ok('stage', s.scene !== 'home')) return 'stage';
    if (ok('controls', fishing)) return 'controls';
    if (ok('cast', fishing && (ph === 'ready' || ph === 'charging'))) return 'cast';
    if (ok('bottomRig', fishing && rig.set === 'bottom')) return 'bottomRig';
    if (fishing && rig.set === 'float' && !this._hintSeen('drift', s) && s.player.spotId) {
      let flow = 0;
      try {
        const sp = getSpot(s.player.spotId);
        flow = Math.hypot(sp.flow.x, sp.flow.z);
      } catch (e) { void e; }
      if (flow >= BITE.driftMinFlow) return 'drift';
    }
    if (ok('holdFull', s.profile.hold.length >= HOLD.capacity)) return 'holdFull';
    return '';
  }

  /** @param {any} s @param {number} dt @param {boolean} blocked */
  _updateHint(s, dt, blocked) {
    const h = this._hint;
    if (h.id) {
      h.life -= dt;
      // 씬에 묶인 안내는 씬이 바뀌면 내린다(W1 통합 — 집의 「문으로 나가 호수로」가 호수 도착 뒤 남은 수명만큼 다시 뜨지 않게)
      const stale = (h.id === 'start' && s.scene !== 'home') || (h.id === 'stage' && s.scene === 'home');
      if (h.life <= 0 || stale) {
        h.id = '';
        setHidden(this.hintEl, true);
      }
    }
    setHidden(this.hintEl, !h.id || blocked);   // 패널 · 타이틀 동안은 숨기고 수명도 멈춘다(닫히면 남은 시간만큼 다시 보인다)
    if (blocked || !this.settings || this.settings.hints === false) {
      if (h.id && this.settings && this.settings.hints === false) {
        h.id = '';
        setHidden(this.hintEl, true);
      }
      return;
    }
    const cand = this._hintCandidate(s);
    if (!cand || cand === h.id) return;
    if (h.id && !URGENT_HINTS.includes(cand)) return;
    h.id = cand;
    h.life = HINT_LIFE;
    this._seenHints.add(cand);
    setText(this.hintTitle, t('hint.' + cand + '.title'));
    setText(this.hintBody, t('hint.' + cand + '.body'));
    setHidden(this.hintEl, false);
    try { this.sim.markHintSeen(cand); } catch (e) { void e; }
  }

  /** @param {string} titleKey @param {string} bodyKey */
  showFatal(titleKey, bodyKey) {
    if (this.fatalEl) this.fatalEl.remove();
    const box = el('div', 'fatal');
    box.append(el('div', 'fatal-title', t(titleKey)), el('div', 'fatal-body', t(bodyKey)));
    this.fatalEl = box;
    this.root.append(box);
    setHidden(this.hudLayer, true);
  }

  /** 타이틀 안내 문구(저장 불가 · 터치 기기 …) @param {string[]} keys */
  setTitleNotes(keys) {
    this.titleNotes = Array.isArray(keys) ? keys.filter(k => typeof k === 'string') : [];
    const top = this.stack.top;
    if (top && top.id === 'title') this.panels.title.render();
  }

  dispose() {
    for (const off of this._offs) off();
    this._offs = [];
    for (const id in this.panels) this.panels[id].dispose();
    this.hud.dispose();
    if (this.fatalEl) this.fatalEl.remove();
    for (const n of [this.hudLayer, this.hintEl, this.noticeEl, this.bannerEl, this.panelLayer, this.curtain]) n.remove();
    this.root.classList.remove('jf-ui');
  }
}

/** @param {KeyboardEvent} e */
function prevent(e) {
  if (e.cancelable && typeof e.preventDefault === 'function') e.preventDefault();
}
