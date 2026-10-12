// OWNER: P10 — 계약 §10.1 · §10.2 · §10.3 · §10.5
// ui 진입점: 패널 스택(맨 위 패널에만 키) · HUD · 이름표 · 피해 숫자 · 미니맵 · 알림 · 배너 · 전환 막 · 피격 테두리 · 안내(모달 2 · 비모달 6 · 큐).
// 상태가 정본이다 — 사망 · 완료 패널과 안내는 이벤트를 놓쳐도 update(state)가 상태를 보고 연다(§4.1 · 고정 상태 ?fixture 도 같은 길).
// 봇이 켜져 있으면 INTERACT · HINT · PLAYER_DIED · RIFT_COMPLETE 로 패널을 열지 않는다(§10.2 · §11.13).

import { EV } from '../core/events.js';
import { ticks } from '../core/time.js';
import { DEATH, POTION } from '../data/combat.js';
import { KEYBINDS } from '../data/keybinds.js';
import { createMeterHud } from './analytics/meterHud.js';
import { createHud, potionUrge } from './hud.js';
import { createNotices } from './hudNotices.js';
import { t, tName } from './i18n.js';
import { createLabels } from './labels.js';
import { createMinimap } from './minimap.js';
import { PANELS } from './panels/index.js';
import * as widgets from './widgets.js';

/** 겹쳐 보는 패널의 토글 키(§10.5-4) — modal 이 열려 있으면 무시 */
const TOGGLES = { [KEYBINDS.inventory]: 'inventory', [KEYBINDS.skills]: 'skills', [KEYBINDS.character]: 'character', [KEYBINDS.map]: 'map' };
const ENTER = new Set(['Enter', 'NumpadEnter']);
const CONFIRM = new Set(KEYBINDS.confirm);
/** 모달 안내 카드(나머지 여섯은 비모달 — §4.2 HintId) */
const MODAL_HINTS = new Set(['town', 'controls']);
/** 가방 격자를 자기 안에 그리는 패널 — 열리면 인벤토리를 닫는다(§10.2 · §10.5-8) */
const BAG_PANELS = new Set(['blacksmith', 'general', 'gambler', 'mystic', 'stash']);
/** INTERACT → 패널(포털은 패널이 없다 — sim 이 처리) */
const INTERACT_PANELS = { npc: null, stash: 'stash', riftStone: 'riftStone' };
/** 장면이 바뀌면 닫는 패널 */
const CLOSE_ON_SCENE = new Set(['death', 'riftComplete', 'map', 'inventory', 'skills', 'character', 'blacksmith', 'general', 'gambler', 'mystic', 'stash', 'riftStone']);
/** 봇을 켜면 닫는 패널(사람이 연 메뉴 — 일시정지 · 설정 · 도움말 · 분석 · 타이틀 쪽은 남긴다) */
const CLOSE_ON_BOT = new Set(['death', 'riftComplete', 'hint', 'confirm', 'blacksmith', 'general', 'gambler', 'mystic', 'stash', 'riftStone']);
/** 타이틀 화면 패널 */
const TITLE_PANELS = ['newChar', 'charSelect', 'title'];
/** 「play」가 아닌 화면 */
const NOT_PLAY = new Set(['title', 'fatal', 'boot']);
/** 사망 Enter · 전환 중 Enter 의 버퍼 유효 시간(실제 초) */
const ENTER_BUFFER_SEC = 1.2;
/** 부활 요청 뒤 상태가 따라오기를 기다리는 최대 시간(실제 초) — 넘으면 사망 패널을 다시 연다 */
const RESPAWN_WAIT_SEC = 3;
/** 피격 테두리(§4.2 PLAYER_HIT — 0.15초 · 화면을 덮지 않는다) */
const HIT_FLASH_SEC = 0.15;
/** 같은 실패 알림 간격(초) */
const FAIL_GAP_SEC = 1.2;
/** 가방 가득 알림 간격(초 — §4.2 「1초에 한 번」) */
const BAGFULL_GAP_SEC = 1;
/** 피드백 1 — 저생명 포션 안내(비모달)는 균열 몇 판째까지(char.runs) · 세션마다 캐릭터당 한 번 */
const POTION_NUDGE_RUNS = 3;

export class UIRoot {
  /** @param {{root:HTMLElement, bus:any, sim:any, settings:any, actions:any, view:{project:Function}}} deps */
  constructor({ root, bus, sim, settings, actions, view }) {
    this.root = root;
    this.bus = bus;
    this.sim = sim;
    this.settings = settings ?? {};
    this.actions = actions ?? {};
    this.view = view ?? { project: () => ({ x: 0, y: 0, visible: false }) };
    /** @type {Array<import('../types.js').Panel>} */
    this.stack = [];
    /** @type {Map<string, import('../types.js').Panel>} */
    this.cache = new Map();
    /** @type {string} app 화면(SCREEN_CHANGED) — 모르면 'unknown' */
    this.screen = 'unknown';
    this.botOn = false;
    this.labelsOn = false;
    /** @type {any} */
    this.lastState = null;
    /** 안내 큐 @type {Array<{id:string, deferred:boolean}>} */
    this.hintQueue = [];
    /** PLAYER_DIED → PLAYER_SPAWNED{portal} 사이(받은 안내는 큐 · 뒤에 비모달로) */
    this.deathWindow = false;
    this.deathEnter = 0;          // 사망 패널이 뜨기 전에 누른 Enter(남은 유효 초)
    this.deadRealSec = 0;         // 사망 패널을 기다린 실제 초
    this.respawnWait = 0;         // 부활 요청 뒤 남은 기다림(초)
    /** 지금 균열을 열 때의 해금(char.riftUnlocked) — 완료 패널이 「새로 열렸는가」를 본다(요약의 unlockedTo 는 max(지금, L + 몫)이라 이미 열린 것도 범위 안이다) @type {number|null} */
    this.unlockAtOpen = null;
    this.completeKey = '';        // 이미 띄운 완료 패널의 판
    this.fadeEnter = 0;           // 전환 막 동안 누른 Enter(남은 유효 초)
    this.fade = { alpha: 0, from: 0, to: 0, t: 0, sec: 0 };
    this.hitFlash = 0;
    this.time = 0;
    this._wallAt = 0;
    this._resuming = false;
    /** @type {Record<string, number>} */
    this.failAt = {};
    /** 피드백 1 — 이 세션에 저생명 포션 안내를 냈다(캐릭터가 바뀌면 다시) */
    this.potionNudged = false;

    const layer = (cls) => {
      const e = document.createElement('div');
      e.className = cls;
      root.appendChild(e);
      return e;
    };
    this.labels = createLabels({ root, settings: this.settings, project: (x, y, z) => this.view.project(x, y, z) });
    this.hud = createHud({ root, sim });
    this.minimap = createMinimap({ root: this.hud.mapHost });
    /** @type {any} */
    this.meterHud = null;
    try {
      this.meterHud = createMeterHud({ root: this.hud.leftHost, sim, bus, settings: this.settings, actions: this.actions, t, ui: this, widgets });
    } catch (e) {
      this.meterHud = null;
      queueMicrotask(() => { throw e; });
    }
    this.notices = createNotices({ root });
    this.layer = layer('panel-layer');
    // 나란히 붙은 겹쳐 보는 패널(인벤토리 · 캐릭터) — 아래에 깔린 쪽을 누르면 맨 위로(키도 그쪽으로 · 누름이 게임으로 새지 않는다)
    this.layer.addEventListener('pointerdown', (e) => this._raiseFrom(/** @type {any} */ (e.target)), true);
    this.hitEl = layer('hit-flash');
    this.audioHint = layer('audio-hint');
    this.audioHint.textContent = t('audio.hint');
    this.fadeEl = layer('fade');
    this.fadeEl.style.opacity = '0';
    /** @type {HTMLElement|null} */
    this.fatalEl = null;
    widgets.bindRoot(this);

    /** @type {Array<() => void>} */
    this._offs = [];
    const on = (name, fn) => { if (bus) this._offs.push(bus.on(name, fn)); };
    on(EV.CHAR_LOADED, () => { this.unlockAtOpen = null; this._onCharLoaded(); });
    on(EV.MAP_LOADED, () => this.minimap.setMap(this.sim?.getMap?.() ?? null));
    on(EV.SCENE_CHANGED, (e) => this._onScene(e));
    on(EV.PLAYER_SPAWNED, (e) => { if (e.reason === 'portal') this._endDeathWindow(); });
    on(EV.RIFT_CLOSED, () => this._endDeathWindow());
    on(EV.INTERACT, (e) => this._onInteract(e));
    on(EV.HINT, (e) => this._queueHint(e.id));
    on(EV.PLAYER_DIED, () => { this.deathWindow = true; });
    on(EV.RIFT_OPENED, (e) => {
      const u = this.sim?.state?.char?.riftUnlocked;
      this.unlockAtOpen = Number.isFinite(u) ? u : null;
      this.notices.banner(t('banner.riftOpened', { n: e.level, tileset: t('tileset.' + e.tileset) }));
    });
    on(EV.GAUGE_FULL, () => this.notices.banner(t('banner.gaugeFull')));
    on(EV.GUARDIAN_APPEAR, (e) => {
      if (this.sim?.state?.scene !== 'rift') return;      // 마을에서 보스 배너 금지(W1 수정 4 — 부활 commit 의 플러시)
      this.notices.banner(t('banner.guardian', { name: e.name && e.name.length ? tName(e.name) : t('mon.' + e.typeId) }));
    });
    on(EV.RIFT_COMPLETE, () => this.notices.banner(t('banner.complete')));
    on(EV.LEVEL_UP, (e) => this.notices.banner(t('banner.levelUp', { n: e.level })));
    on(EV.UNLOCK, (e) => this.notices.push(t('notice.unlock', { n: e.riftUnlocked })));
    on(EV.DROP_SPAWN, (e) => this._onDrop(e));
    on(EV.DROP_PICKED, (e) => {
      // 피드백 1 — 주운 골드를 머리 위에 「+n 골드」(자동 줍기로 연달아 주우면 한 숫자로 합친다)
      const p = this.sim?.state?.player;
      if (e.kind === 'gold' && p && e.amount > 0) this.labels.addGold(p.pos.x, p.pos.z, e.amount);
    });
    on(EV.PICKUP_FAIL, (e) => {
      if (e.reason === 'bagFull') { if (this._gap('bagFull', BAGFULL_GAP_SEC)) this.notices.push(t('notice.bagFull')); }
      else if (this._gap('pickFull', BAGFULL_GAP_SEC)) this.notices.push(t('notice.potionFull'));
    });
    on(EV.DURABILITY, (e) => {
      const broken = Array.isArray(e.broken) ? e.broken : [];
      if (broken.length) this.notices.push(t('notice.broken', { slot: broken.map(s => t('slot.' + s)).join(', ') }));
      else this.notices.push(t('notice.durability'));
    });
    on(EV.SKILL_FAIL, (e) => this._onSkillFail(e));
    on(EV.POTION_FAIL, (e) => {
      if (!this._gap('potion:' + e.reason, FAIL_GAP_SEC)) return;
      this.notices.push(t(e.reason === 'empty' ? 'notice.noPotion' : e.reason === 'full' ? 'notice.lifeFull' : 'reason.' + e.reason));
    });
    on(EV.RECALL, (e) => { if (e.phase === 'cancel' && e.reason !== 'scene') this.notices.push(t('notice.recallCancel')); });
    on(EV.PLAYER_HIT, (e) => {
      if (!(e.amount > 0) && !(e.absorbed > 0)) return;
      this.hitFlash = HIT_FLASH_SEC;
      this.hud.hit();
      if (e.amount > 0) this.labels.addTaken(e);
    });
    on(EV.PLAYER_HEAL, (e) => {
      const p = this.sim?.state?.player;
      if (p && e.amount >= 1) this.labels.addHeal(p.pos.x, p.pos.z, e.amount);
    });
    on(EV.HIT, (e) => this.labels.addHit(e));
    on(EV.LABELS, (e) => this.setLabels(!!e.on));
    on(EV.BOT, (e) => this._onBot(!!e.on));
    on(EV.SCREEN_CHANGED, (e) => this._onScreen(e));
    on(EV.PAUSED, (e) => {
      if (e.on && (e.reason === 'blur' || e.reason === 'hidden' || e.reason === 'context') && this._playing() && !this.isOpen('pause')) this.openPanel('pause');
    });
    on(EV.SETTINGS_CHANGED, (e) => {
      if (e.settings && typeof e.settings === 'object') this.settings = e.settings;
      this.labels.setSettings(this.settings);
    });
    on(EV.AUDIO_UNLOCKED, () => { this.audioHint.hidden = true; });
    on(EV.FADE, (e) => this._onFade(e));
  }

  // ───────────────────────── 매 프레임 ─────────────────────────

  /** HUD · 열린 패널 · 이름표 · 피해 숫자 · 미니맵 — 상태에서 다시 그린다 @param {import('../types.js').GameState} state @param {number} [alpha] @param {number} [dtReal] */
  update(state, alpha = 1, dtReal = 0) {
    if (!state) return;
    this.lastState = state;
    const dt = Number.isFinite(dtReal) && dtReal > 0 ? Math.min(dtReal, 0.25) : 0;
    // 전환 막 · Enter 버퍼는 실제 시간으로 — dtReal 이 0 인 렌더(__game.step · 멈춘 화면)에서도 막이 걷힌다
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    const wall = this._wallAt > 0 ? Math.min(0.25, Math.max(0, (now - this._wallAt) / 1000)) : 0;
    this._wallAt = now;
    const rdt = dt > 0 ? dt : wall;
    this.time += rdt;
    this._autoPanels(state, dt, rdt);
    const visible = this._hudVisible(state);
    this.hud.update(state, dt, { visible, bot: this.botOn });
    if (visible) this._potionNudge(state);
    this.minimap.update(state, dt);
    this.labels.update(state, dt, { visible, alpha });
    if (this.meterHud) {
      this.meterHud.setVisible(!!(visible && this.settings.meterHud));
      this.meterHud.update(state, dt);
    }
    this.notices.update(dt);
    this._updateFade(rdt);
    if (this.hitFlash > 0) {
      this.hitFlash -= rdt;
      this.hitEl.style.opacity = this.hitFlash > 0 ? String(Math.min(1, this.hitFlash / HIT_FLASH_SEC)) : '0';
    } else if (this.hitEl.style.opacity !== '0') this.hitEl.style.opacity = '0';
    this.audioHint.classList.toggle('is-off', !visible);
    for (let i = 0; i < this.stack.length; i++) this.stack[i].update(state);
  }

  // ───────────────────────── 패널 ─────────────────────────

  /** @param {import('../types.js').PanelId} id @param {Object} [args] @returns {boolean} */
  openPanel(id, args = {}) {
    const make = PANELS[id];
    if (!make) return false;
    let pnl = this.cache.get(id);
    if (!pnl) {
      pnl = make({ root: this.layer, sim: this.sim, bus: this.bus, settings: this.settings, actions: this.actions, t, ui: this, widgets });
      this.cache.set(id, pnl);
    }
    if (BAG_PANELS.has(id) && this.isOpen('inventory')) this.closePanel('inventory', 'code');
    const i = this.stack.indexOf(pnl);
    if (i >= 0) this.stack.splice(i, 1);
    this.stack.push(pnl);
    this.layer.appendChild(pnl.el);
    pnl.open(args ?? {});
    this._restack();
    if (this.lastState) pnl.update(this.lastState);
    this.bus?.emit(EV.PANEL_OPENED, { panel: id, modal: !!pnl.modal, depth: this.stack.length });
    return true;
  }

  /** @param {string|null} [id] 없으면 맨 위 @param {'esc'|'key'|'confirm'|'pointer'|'code'} [by] @returns {boolean} */
  closePanel(id = null, by = 'code') {
    const idx = id === null ? this.stack.length - 1 : this.stack.findIndex(p => p.id === id);
    if (idx < 0) return false;
    const [pnl] = this.stack.splice(idx, 1);
    pnl.close();
    pnl.el.remove();
    this._restack();
    this.bus?.emit(EV.PANEL_CLOSED, { panel: pnl.id, depth: this.stack.length, by });
    if (pnl.id === 'pause' && by !== 'code' && !this._resuming) {
      // 일시정지를 닫으면 app 이 다시 돈다(actions.resume 가 다시 closePanel 을 불러도 한 번만)
      this._resuming = true;
      try { this.actions.resume?.(); } finally { this._resuming = false; }
    }
    return true;
  }

  /** @param {'esc'|'key'|'confirm'|'pointer'|'code'} [by] */
  closeAll(by = 'code') {
    let guard = 64;
    while (this.stack.length && guard-- > 0) this.closePanel(null, by);
  }

  /** @returns {import('../types.js').PanelId|null} */
  topPanel() { return this.stack.length ? /** @type {any} */ (this.stack[this.stack.length - 1].id) : null; }
  isModal() { return this.stack.some(p => p.modal); }
  anyOpen() { return this.stack.length > 0; }
  /** @param {string} id */
  isOpen(id) { return this.stack.some(p => p.id === id); }

  /**
   * 누른 요소가 맨 위가 아닌 겹쳐 보는 패널 안이면 그 패널을 맨 위로(모달이 열려 있으면 아니다) — open 을 다시 부르지 않는다(포커스 · 영역 그대로)
   * @param {any} target
   */
  _raiseFrom(target) {
    if (!target || typeof target.closest !== 'function' || this.isModal()) return;
    const el = target.closest('[data-panel]');
    const i = this.stack.findIndex(p => p.el === el);
    if (i < 0 || i === this.stack.length - 1 || this.stack[i].modal) return;
    const [pnl] = this.stack.splice(i, 1);
    this.stack.push(pnl);
    this._restack();
  }

  /** 맨 위 패널 표시(is-top) · 모달 뒤 가림 */
  _restack() {
    const n = this.stack.length;
    let modalTop = -1;
    for (let i = n - 1; i >= 0; i--) if (this.stack[i].modal) { modalTop = i; break; }
    for (let i = 0; i < n; i++) {
      const el = this.stack[i].el;
      el.classList.toggle('is-top', i === n - 1);
      el.classList.toggle('is-under', i < n - 1);
      // 화면 패스: 패널 바탕이 95% 불투명이라 아래 패널의 글자가 비쳐 겹쳐 읽혔다(타이틀 위 새 캐릭터) — 아래에 패널이 있으면 맨 위는 불투명
      el.classList.toggle('has-under', i === n - 1 && n > 1);
    }
    this.layer.classList.toggle('has-modal', modalTop >= 0);
  }

  // ───────────────────────── 키 · 마우스 ─────────────────────────

  /**
   * keydown · keyup 둘 다 받는다 → true = 처리했다(게임 입력이 아니다). 맨 위 패널 하나에만 보낸다.
   * keyup 은 보통 false — app 이 누르고 있던 키를 놓게(§10.5-7).
   * @param {KeyboardEvent} e @returns {boolean}
   */
  handleKey(e) {
    const code = e.code;
    const down = e.type !== 'keyup';
    const top = this.stack.length ? this.stack[this.stack.length - 1] : null;
    if (top && top.modal) {
      if (!down) {
        top.handleKey(e);
        return CONFIRM.has(code);
      }
      if (top.handleKey(e)) return true;
      if (code === KEYBINDS.pause) { if (!e.repeat) this.closePanel(null, 'esc'); return true; }
      if (code === KEYBINDS.analytics && top.id === 'analytics') { if (!e.repeat) this.closePanel('analytics', 'key'); return true; }
      widgets.dispatchFallback(top.el, e);
      return true;
    }
    if (!down) {
      if (top && top.keys.includes(code)) { top.handleKey(e); return true; }
      return false;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    // 쓰러진 동안의 Enter 는 겹쳐 보는 패널보다 부활 버퍼가 먼저(재도전 키 2번 — §10.5-6)
    if (ENTER.has(code) && this.sim?.state?.player?.dead) return this._onEnter(e);
    // 겹쳐 보는 패널(인벤토리 · 스킬 · 캐릭터 · 지도) — 자기 keys 만 먹는다
    if (top && top.keys.includes(code)) {
      if (top.handleKey(e)) return true;
      if (code === KEYBINDS.pause || TOGGLES[code] === top.id) { if (!e.repeat) this.closePanel(null, code === KEYBINDS.pause ? 'esc' : 'key'); return true; }
      widgets.dispatchFallback(top.el, e);
      return true;
    }
    if (code === KEYBINDS.pause) {
      if (e.repeat) return true;
      if (top) this.closePanel(null, 'esc');
      else if (this._playing()) this.openPanel('pause');
      else return false;
      return true;
    }
    const toggle = TOGGLES[code];
    if (toggle) {
      if (!this._playing()) return false;
      if (!e.repeat) { if (this.isOpen(toggle)) this.closePanel(toggle, 'key'); else this.openPanel(toggle); }
      return true;
    }
    if (code === KEYBINDS.analytics) {
      if (!this._playing()) return false;
      if (!e.repeat) this.openPanel('analytics');
      return true;
    }
    if (ENTER.has(code)) return this._onEnter(e);
    return false;
  }

  /** Enter(패널 없음 · 겹쳐 보는 패널만) — 사망 버퍼 > 전환 막 버퍼 > 복귀 안내(§10.5-6) @param {KeyboardEvent} e */
  _onEnter(e) {
    const st = this.sim?.state;
    if (!st || !st.char || this.botOn || !this._playing()) return false;
    if (e.repeat) return true;
    if (st.player.dead) {
      if (!st.pendingTravel && this.respawnWait <= 0) this.deathEnter = ENTER_BUFFER_SEC;
      return true;
    }
    if (this._fading()) { this.fadeEnter = ENTER_BUFFER_SEC; return true; }
    if (st.scene === 'town' && st.town?.returnPrompt && !this.stack.length) {
      this._returnToRift();
      return true;
    }
    return false;
  }

  /** 그 화면 점이 상호작용하는 UI 위다(패널 · HUD 아래 묶음) @param {number} px @param {number} py */
  blocksPointer(px, py) {
    if (this.fatalEl) return true;
    if (typeof document === 'undefined' || !document.elementFromPoint) return false;
    const hit = document.elementFromPoint(px, py);
    if (!hit || !this.root.contains(hit)) return false;
    return !!(hit.closest('.ui-block') || hit.closest('.panel-layer'));
  }

  /** 마우스 아래 바닥 이름표의 드랍(src 'label') */
  labelHover() { return this.labels.labelHover(); }

  /** Alt(LABELS 이벤트로도 온다) @param {boolean} on */
  setLabels(on) {
    this.labelsOn = !!on;
    this.labels.setLabels(this.labelsOn);
  }

  // ───────────────────────── 알림 ─────────────────────────

  /** 알림 열(3초 · 최대 4) · big 이면 비모달 안내 꼴(6초) @param {string} key @param {Object} [params] @param {{big?:boolean, sec?:number}} [opts] */
  notice(key, params = {}, { big = false, sec } = {}) {
    const text = t(key, /** @type {any} */ (params));
    if (big) this.notices.big({ body: text, sec: sec ?? 6 });
    else this.notices.push(text, sec ?? 3);
  }

  /** 지우기 전까지 남는 알림 @param {string|null} key */
  setSticky(key) { this.notices.sticky(key ? t(key) : null); }

  /** 전체 화면 안내 — 게임은 멈춘다(app) @param {string} titleKey @param {string} bodyKey */
  showFatal(titleKey, bodyKey) {
    if (this.fatalEl) this.fatalEl.remove();
    const el = document.createElement('div');
    el.className = 'fatal ui-block';
    const h = el.appendChild(document.createElement('h1'));
    h.textContent = t(titleKey);
    const p = el.appendChild(document.createElement('p'));
    p.textContent = t(bodyKey);
    this.root.appendChild(el);
    this.fatalEl = el;
  }

  dispose() {
    for (const off of this._offs) off();
    this._offs.length = 0;
    this.closeAll();
    for (const p of this.cache.values()) p.dispose();
    this.cache.clear();
    this.meterHud?.dispose();
    this.minimap.dispose();
    this.hud.dispose();
    this.labels.dispose();
    this.notices.dispose();
    this.layer.remove();
    this.hitEl.remove();
    this.audioHint.remove();
    this.fadeEl.remove();
    this.fatalEl?.remove();
    widgets.unbindRoot(this);
  }

  // ───────────────────────── 내부 ─────────────────────────

  /** 놀이 화면인가(타이틀 · 치명 안내가 아니고 캐릭터가 있다) */
  _playing() {
    const st = this.sim?.state;
    if (!st || !st.char || this.fatalEl) return false;
    if (NOT_PLAY.has(this.screen)) return false;
    return !TITLE_PANELS.some(id => this.isOpen(id));
  }
  /** @param {any} state */
  _hudVisible(state) {
    if (!state.char || this.fatalEl || NOT_PLAY.has(this.screen)) return false;
    return !TITLE_PANELS.some(id => this.isOpen(id));
  }
  _fading() { return this.fade.alpha > 0.02 || this.fade.t < this.fade.sec; }
  /** 같은 알림의 간격 @param {string} key @param {number} sec */
  _gap(key, sec) {
    const last = this.failAt[key];
    if (last !== undefined && this.time - last < sec) return false;
    this.failAt[key] = this.time;
    return true;
  }

  /** 사망 · 완료 패널 · 안내 — 상태를 보고 연다 @param {any} state @param {number} dt 렌더의 실제 초 @param {number} rdt 실제 초(dt 가 0 이면 벽시계) */
  _autoPanels(state, dt, rdt) {
    const p = state.player;
    const playing = this._playing();
    if (this.deathEnter > 0) this.deathEnter -= rdt;
    if (this.fadeEnter > 0) this.fadeEnter -= rdt;
    // ── 사망(PLAYER_DIED + DEATH.panelDelay — 틱 또는 실제 시간) ──
    if (p.dead) {
      if (this.respawnWait > 0) this.respawnWait -= rdt;
      if (playing && !this.botOn && !state.pendingTravel && this.respawnWait <= 0 && !this.isOpen('death')) {
        this.deadRealSec += dt;
        const due = state.tick - p.deadAt >= ticks(DEATH.panelDelay) || this.deadRealSec >= DEATH.panelDelay;
        if (due && !this.isOpen('pause')) {
          this.openPanel('death');
          if (this.deathEnter > 0) {
            this.deathEnter = 0;
            this.respawnFromPanel();
          }
        }
      }
    } else {
      this.deadRealSec = 0;
      this.deathEnter = 0;
      this.respawnWait = 0;
      if (this.isOpen('death')) this.closePanel('death', 'code');
    }
    // ── 균열 완료(요약이 생긴 판 — 판마다 한 번) ──
    const r = state.rift;
    if (r && state.scene === 'rift' && r.phase === 'complete' && r.summary && playing && !this.botOn && !p.dead) {
      const key = this._runKey(state);
      if (key !== this.completeKey && !this.isOpen('riftComplete') && !this.isModal()) {
        this.completeKey = key;
        this.openPanel('riftComplete');
      }
    }
    // ── 전환 막 동안 누른 Enter → 막이 걷히면 복귀 ──
    if (this.fadeEnter > 0 && !this._fading()) {
      this.fadeEnter = 0;
      if (playing && !this.botOn && state.scene === 'town' && state.town?.returnPrompt && !this.stack.length && !p.dead) this._returnToRift();
    }
    // ── 안내 ──
    if (this.hintQueue.length && playing) this._pumpHints(state);
  }

  /** 지금 판의 열쇠 @param {any} state */
  _runKey(state) {
    const r = state.rift;
    return `${state.char?.slot ?? -1}:${state.char?.runs ?? 0}:${r.seed}:${r.level}`;
  }

  /** 사망 패널의 Enter — app 에 부활을 맡기고 패널을 닫는다(상태가 따라오면 마을) */
  respawnFromPanel() {
    const st = this.sim?.state;
    if (!st || !st.player.dead) return { ok: false, reason: 'notDead' };
    const res = this.actions.respawn ? this.actions.respawn() : this.sim.respawn?.();
    if (res && res.ok === false) return res;
    this.respawnWait = RESPAWN_WAIT_SEC;
    this.closePanel('death', 'confirm');
    return res ?? { ok: true };
  }

  _returnToRift() {
    const res = this.actions.returnToRift ? this.actions.returnToRift() : this.sim?.returnToRift?.();
    if (res && res.ok === false) this.notices.push(t('reason.' + res.reason, res.params));
  }

  /** @param {string} id */
  _queueHint(id) {
    if (typeof id !== 'string') return;
    if (this.hintQueue.some(h => h.id === id)) return;
    const dead = !!this.sim?.state?.player?.dead;
    this.hintQueue.push({ id, deferred: this.deathWindow || dead });
  }

  /** 큐의 맨 앞 안내 하나 @param {any} state */
  _pumpHints(state) {
    const h = this.hintQueue[0];
    if (this.deathWindow && !this.botOn) return;              // 재도전 경로 — 뒤에 비모달로
    const modal = MODAL_HINTS.has(h.id) && !h.deferred && !this.botOn;
    if (modal) {
      if (this.isModal() || this._fading() || state.pendingTravel || state.player.dead) return;
      this.hintQueue.shift();
      this.openPanel('hint', { id: h.id });
      return;
    }
    this.hintQueue.shift();
    this.notices.big({
      title: t('hint.' + h.id + '.title'),
      body: t('hint.' + h.id + '.body'),
      more: t('hint.more'),
      onShown: () => { this.sim?.markHint?.(h.id); },
    });
  }

  _endDeathWindow() {
    if (!this.deathWindow) return;
    this.deathWindow = false;
    for (const h of this.hintQueue) h.deferred = true;
  }

  /**
   * 피드백 1 — 첫 몇 판에서 처음으로 생명이 낮아졌고 포션을 마실 수 있으면 「Q — 체력 포션」 비모달 안내(6초 · 게임을 멈추지 않는다).
   * 안내 카드(HINT)가 아니다 — sim 의 HINT_IDS 밖이라 세이브에 적지 않는다(세션마다 캐릭터당 한 번).
   * @param {any} state
   */
  _potionNudge(state) {
    if (this.potionNudged || this.botOn || state.scene !== 'rift' || !state.char) return;
    if ((state.char.runs ?? 0) > POTION_NUDGE_RUNS) return;
    if (!potionUrge(state.player, state.char, state.tick) || this.isModal()) return;
    this.potionNudged = true;
    this.notices.big({
      title: t('hint.potion.title'),
      body: t('hint.potion.body', { n: state.char.potions, heal: Math.round(POTION.heal * 100), cd: POTION.cd }),
      more: '',
    });
  }

  _onCharLoaded() {
    this.potionNudged = false;
    this.hud.reset();
    this.labels.reset();
    this.notices.clearTransient();
    this.hintQueue = this.hintQueue.filter(h => h.id === 'town');
    this.deathWindow = false;
    this.completeKey = '';
    this.deathEnter = 0;
    this.respawnWait = 0;
  }

  /** @param {{from:string|null, to:string, reason:string}} e */
  _onScene(e) {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const id = this.stack[i]?.id;
      if (id && CLOSE_ON_SCENE.has(id)) this.closePanel(id, 'code');
    }
    this.labels.reset();
    this.hud.reset();
    if (e.reason === 'fixture' || e.reason === 'load') {
      this.completeKey = '';
      this.deathWindow = false;
      this.respawnWait = 0;
    }
    if (e.to === 'rift' && e.reason !== 'townPortal') this._endDeathWindow();
    this.minimap.setMap(this.sim?.getMap?.() ?? null);
  }

  /** @param {{kind:string, id:string}} e */
  _onInteract(e) {
    if (this.botOn || !this._playing()) return;
    if (this.isModal()) return;
    let id = /** @type {string|null|undefined} */ (INTERACT_PANELS[/** @type {'npc'|'stash'|'riftStone'} */ (e.kind)]);
    if (id === undefined) return;                                // 포털 — sim 이 처리한다
    if (id === null) id = e.id;                                  // npc → 그 상점(blacksmith · general · gambler · mystic)
    if (!id || !PANELS[/** @type {any} */ (id)]) return;
    try {
      this.openPanel(/** @type {any} */ (id), { from: 'interact', object: e.id });
    } catch (err) {
      queueMicrotask(() => { throw err; });                     // 플러시를 끊지 않고 오류로 남긴다
    }
  }

  /** @param {any} e */
  _onDrop(e) {
    if (e.kind !== 'item' || (e.rarity !== 'legendary' && e.rarity !== 'set')) return;
    const drop = this.sim?.state?.rift?.drops?.find((d) => d.id === e.id);
    const name = drop?.item ? tName(drop.item.name) : t('rarity.' + e.rarity);
    this.notices.push(t(e.rarity === 'set' ? 'notice.set' : 'notice.legendary', { name }), 4);
  }

  /** @param {{skillId:string|null, reason:string}} e */
  _onSkillFail(e) {
    if (e.reason === 'resource') this.hud.blinkResource();
    if (!this._gap('skill:' + e.reason, FAIL_GAP_SEC)) return;
    let key = 'reason.' + e.reason;
    if (e.reason === 'empty') key = e.skillId ? 'notice.noRecall' : 'notice.skillEmpty';
    this.notices.push(t(key));
  }

  /** @param {boolean} on */
  _onBot(on) {
    this.botOn = on;
    if (on) {
      // 사람이 아직 닫지 않은 완료 패널을 봇이 닫았다 — 끄면 다시 연다(상태가 그대로면)
      if (this.isOpen('riftComplete')) this.completeKey = '';
      for (let i = this.stack.length - 1; i >= 0; i--) {
        const id = this.stack[i]?.id;
        if (id && CLOSE_ON_BOT.has(id)) this.closePanel(id, 'code');
      }
      this.deathEnter = 0;
      this.fadeEnter = 0;
    }
    // 끄면 다음 update 의 _autoPanels 가 상태에 맞는 패널(사망 · 완료)을 연다
  }

  /** @param {{from:string, to:string}} e */
  _onScreen(e) {
    this.screen = e.to;
    if (e.to === 'play') {
      for (const id of TITLE_PANELS) if (this.isOpen(id)) this.closePanel(id, 'code');
    } else if (e.to === 'title') {
      this.closeAll('code');
      this.hintQueue = [];
      this.deathWindow = false;
      this.openPanel('title');
    } else if (e.to === 'fatal') {
      this.closeAll('code');
    }
  }

  /**
   * 전환 막 — 보이는 불투명도는 CSS 전환이 맡고(렌더가 멈춰도 막이 걷힌다), fade.alpha 는 입력 · 안내의 판단용(실제 시간으로 민다).
   * @param {{phase:'out'|'in', sec:number}} e
   */
  _onFade(e) {
    const sec = Number.isFinite(e.sec) && e.sec > 0 ? e.sec : 0;
    this.fade.from = this.fade.alpha;
    this.fade.to = e.phase === 'out' ? 1 : 0;
    this.fade.t = 0;
    this.fade.sec = sec;
    if (sec === 0) this.fade.alpha = this.fade.to;
    this.fadeEl.style.transition = sec > 0 ? `opacity ${sec}s linear` : 'none';
    this.fadeEl.style.opacity = String(this.fade.to);
  }

  /** @param {number} dt 실제 초 */
  _updateFade(dt) {
    const f = this.fade;
    if (f.t >= f.sec) {
      f.alpha = f.to;
      return;
    }
    f.t = Math.min(f.sec, f.t + dt);
    const k = f.sec > 0 ? f.t / f.sec : 1;
    f.alpha = f.from + (f.to - f.from) * k;
  }
}

