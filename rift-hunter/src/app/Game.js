// OWNER: P9 — 계약 §11.1 · §11.2 · §11.3 · §11.4 · §11.6 · §11.11 · §11.12 · §11.13 · §5.12
// 부트스트랩 · actions(ui → app) · 화면 기계 · 고정 틱 루프 · 전환 막 · 저장 시점 · 견고성 · 봇 구동 · 디버그 API.
// app 은 sim 상태를 직접 고치지 않는다 — 명령(GameSim 의 공개 메서드)으로만(quitToTitle = unloadCharacter · 마을 패널 시간 = addPlaySec).
// 부팅 표식: 첫 프레임(타이틀이든 play 든 — 뒤에 마을이 그려진 상태)을 그린 직후 markReady · 부팅 실패면 markError(§11.11).

import { markError, markReady } from './bootMarker.js';
import { CHAR_SLOTS, CLASS_IDS, DT, PANEL_IDS } from '../core/constants.js';
import { EV, EventBus } from '../core/events.js';
import { hash32 } from '../core/hash.js';
import { KEYBINDS } from '../data/keybinds.js';
import { DEFAULT_SETTINGS } from '../data/settings.js';
import { STRINGS } from '../data/strings.ko.js';
import { FIXTURES } from '../debug/fixtures.js';
import { AudioEngine } from '../audio/AudioEngine.js';
import { Bot } from '../bot/bot.js';
import { GameSim } from '../sim/GameSim.js';
import { createCharacter } from '../sim/progression/character.js';
import { makeDevCharacter } from '../sim/progression/dev.js';
import { dedupeItemIds } from '../sim/progression/save.js';
import { createAccount } from '../sim/state.js';
import { buildTownMap } from '../sim/world/townMap.js';
import { UIRoot } from '../ui/UIRoot.js';
import { ActorLayer } from '../view/ActorLayer.js';
import { CameraRig } from '../view/CameraRig.js';
import { FxLayer } from '../view/FxLayer.js';
import { WorldLayer } from '../view/WorldLayer.js';
import { createRenderContext } from '../view/renderer.js';
import { installDebugApi } from './debugApi.js';
import { InputCollector } from './input.js';
import { FixedStepper, createLoop } from './loop.js';
import { STRATEGIES, parseQuery } from './query.js';
import { BOT_HALT_PANELS, MENU_PANELS, createScreens, pauseReason, stepAllowed } from './screens.js';
import { SETTINGS_DEBOUNCE_MS, charKey, createDebouncer, createSaveScheduler, createStorage, sanitizeSettings } from './storage.js';

/** @typedef {import('../types.js').Result} Result */
/** @typedef {import('../types.js').Settings} Settings */
/** @typedef {import('../types.js').PanelId} PanelId */

/** 전환 막(초) — 부활만 짧다(재도전 2초 안 · §5.10) */
const FADE_SEC = 0.3;
const FADE_RESPAWN_SEC = 0.2;
/** 히트스톱 상한(초 — 이상한 payload 가 화면을 오래 멈추지 않게) */
const HITSTOP_MAX = 0.5;
/** 마을 패널 시간을 sim 에 넘기는 묶음(초) */
const PLAY_SEC_CHUNK = 1;
/** 오류 목록 상한 · 한 줄 길이 */
const ERRORS_MAX = 200;
const ERROR_LEN = 300;
/** 새 캐릭터 이름 최대 글자 수(§10.6) */
const NAME_MAX = 12;
/** 지속 알림 우선순위(위가 먼저 보인다 — ui.setSticky 는 한 줄) */
const SAVE_FUTURE_KEY = STRINGS['notice.saveFuture'] !== undefined ? 'notice.saveFuture' : 'notice.saveBlocked';
const STICKY_ORDER = ['notice.contextLost', SAVE_FUTURE_KEY, 'notice.saveBlocked', 'notice.settingsUnsaved'];
/** 패널 토글 키(§10.5-4 — 모달이 열려 있으면 ui 가 먼저 먹는다) */
const TOGGLES = /** @type {Array<[string, PanelId]>} */ ([
  [KEYBINDS.inventory, 'inventory'], [KEYBINDS.skills, 'skills'], [KEYBINDS.character, 'character'], [KEYBINDS.map, 'map'],
]);

/** @param {string} reason @returns {{ok:false, reason:string}} */
const fail = (reason) => ({ ok: false, reason });

/** 세션 시드 — app 에서만 시계 · Math.random 을 쓴다(§11.1) */
function newSeed() {
  return (Date.now() ^ (Math.random() * 2 ** 32)) >>> 0;
}

/** 오류 한 줄 @param {unknown} what */
function describe(what) {
  if (what && typeof what === 'object' && 'stack' in what && typeof (/** @type {any} */ (what).stack) === 'string') {
    const st = /** @type {any} */ (what).stack.split('\n').map((s) => s.trim()).filter(Boolean);
    const head = String(/** @type {any} */ (what).message ?? st[0] ?? 'Error');
    const at = st.find((s) => s.startsWith('at ')) ?? '';
    return `${/** @type {any} */ (what).name ?? 'Error'}: ${head}${at ? ' ' + at : ''}`.slice(0, ERROR_LEN);
  }
  return String(what).slice(0, ERROR_LEN);
}

export class Game {
  /** @param {Document} doc */
  constructor(doc) {
    this.doc = doc;
    /** @type {any} */
    this.win = (doc && doc.defaultView) || (typeof window !== 'undefined' ? window : null);
    /** @type {string[]} */
    this.errors = [];
    this.booted = false;
    this.screens = createScreens({ bus: null });
    this.stepper = new FixedStepper();
    this.saves = createSaveScheduler();
    /** @type {any} */ this.query = parseQuery('');
    this.dev = false;
    this.storageOk = false;
    this.readOnly = false;
    /** @type {Settings} */
    this.settings = { ...DEFAULT_SETTINGS };
    this.seed = 1;
    /** @type {EventBus|null} */ this.bus = null;
    /** @type {GameSim|any} */ this.sim = null;
    /** @type {any} */ this.rc = null;
    /** @type {any} */ this.world = null;
    /** @type {any} */ this.actors = null;
    /** @type {any} */ this.fx = null;
    /** @type {any} */ this.camera = null;
    /** @type {any} */ this.audio = null;
    /** @type {any} */ this.ui = null;
    /** @type {InputCollector|null} */ this.input = null;
    /** @type {any} */ this.loop = null;
    /** @type {any} */ this.storage = null;
    /** @type {any} */ this.settingsSave = null;
    /** 전환 막 @type {{phase:'out'|'in', t:number, f:number}|null} */
    this.trans = null;
    this.hitstop = 0;
    this.hidden = false;
    this.blurred = false;
    this.contextLost = false;
    this.debugPaused = false;
    this._booting = false;
    /** @type {any} */ this.bot = null;
    this.audioUnlocked = false;
    /** @type {Set<string>} */
    this._stickies = new Set();
    /** @type {string|null} */
    this._stickyShown = null;
    /** @type {string|null} */
    this._pause = null;
    this._townSec = 0;
    this._cond = /** @type {import('./screens.js').StepCond} */ ({
      screen: 'boot', hasChar: false, fading: false, hitstop: false, hidden: false, blurred: false, contextLost: false, debugPaused: false,
      modal: false, anyOpen: false, top: null, scene: 'town', bot: false,
    });
    this._tickFn = () => this._tick();
    this._canStepFn = () => this._canStep();

    /** ui → app(§11.2) — 결과 값은 Result */
    this.actions = {
      continueGame: () => this._continueGame(),
      /** @param {number} slot */
      selectChar: (slot) => this._selectChar(slot),
      /** @param {{slot:number, cls:import('../types.js').ClassId, name:string}} o */
      newChar: (o) => this._newChar(o),
      /** @param {number} slot */
      deleteChar: (slot) => this._deleteChar(slot),
      /** @param {number} level */
      openRift: (level) => (this.sim ? this.sim.openRift(level) : fail('invalid')),
      returnToRift: () => (this.sim ? this.sim.returnToRift() : fail('invalid')),
      respawn: () => (this.sim ? this.sim.respawn() : fail('invalid')),
      quitToTitle: () => this._quitToTitle(),
      resume: () => this._resume(),
      /** @param {Partial<Settings>} partial */
      applySettings: (partial) => this._applySettings(partial),
      /** @param {boolean} on @param {{strategy?:string, preset?:number}} [opts] */
      setBot: (on, opts = {}) => this._setBot(on, opts),
      /** @param {string} name @param {string} mime @param {string} text */
      downloadFile: (name, mime, text) => this._downloadFile(name, mime, text),
    };
  }

  // ───────────────────────── 부트(§11.1) ─────────────────────────

  start() {
    this._installErrorHooks();
    try {
      this._boot();
    } catch (e) {
      this._noteError(e, true);
      this.screens.go('fatal');
      if (!this.booted) markError(describe(e));
    }
  }

  _installErrorHooks() {
    const w = this.win;
    if (!w || typeof w.addEventListener !== 'function') return;
    w.addEventListener('error', (e) => this._noteError(e && (e.error ?? e.message ?? e), false));
    w.addEventListener('unhandledrejection', (e) => this._noteError(e && e.reason, false));
  }

  _boot() {
    const doc = this.doc;
    const w = this.win;
    const q = (this.query = parseQuery(w && w.location ? w.location.search : ''));
    this.storage = createStorage();
    this.storageOk = this.storage.available();
    const persisted = this.storageOk ? this.storage.loadSettings() : {};
    this.settings = { ...DEFAULT_SETTINGS, ...persisted };
    this.dev = q.dev;
    /** @type {string[]} */
    const notices = [];
    let account;
    if (this.dev || !this.storageOk) account = createAccount();
    else {
      const r = this.storage.loadAccount();
      account = r.account;
      if (r.future) this.readOnly = true;
      if (r.rebuilt && r.broken) notices.push('notice.accountRebuilt');
    }
    this.seed = q.seed ?? newSeed();
    const bus = (this.bus = new EventBus());
    this.screens = createScreens({ bus });
    const sim = (this.sim = new GameSim({ bus, seed: this.seed, account, devSession: this.dev }));
    const canvas = /** @type {HTMLCanvasElement} */ (doc.getElementById('game-canvas'));
    const root = /** @type {HTMLElement} */ (doc.getElementById('ui-root'));
    this.canvas = canvas;
    this.settingsSave = createDebouncer(() => this._writeSettings(), SETTINGS_DEBOUNCE_MS);

    let rc;
    try {
      rc = createRenderContext(canvas, this.settings);
    } catch (e) {
      this._noteError(e, false);
      this.ui = new UIRoot({ root, bus, sim, settings: this.settings, actions: this.actions, view: { project: () => ({ x: 0, y: 0, visible: false }) } });
      this.ui.showFatal('fatal.webglTitle', 'fatal.webglBody');
      this.screens.go('fatal');
      markError('webgl');
      return;
    }
    this.rc = rc;
    const deps = { rc, bus, settings: this.settings };
    this.world = new WorldLayer(deps);
    this.actors = new ActorLayer(deps);
    this.fx = new FxLayer(deps);
    this.camera = new CameraRig(deps);
    this.audio = new AudioEngine({ bus, settings: this.settings });
    this.ui = new UIRoot({ root, bus, sim, settings: this.settings, actions: this.actions, view: { project: rc.project } });
    this.input = new InputCollector({
      canvas, bus, ui: this.ui, rc, keybinds: KEYBINDS, settings: this.settings,
      onAppKey: (e) => this._appKey(e), onGesture: () => this._unlockAudio(), onZoom: (s) => this.camera.zoom(s),
    });

    bus.on(EV.MAP_LOADED, () => {
      const m = this.sim.getMap();
      this.world.setMap(m);
      this.actors.setMap(m);
      this.fx.setMap(m);
    });
    bus.on(EV.TRAVEL_REQUEST, (p) => this._onTravelRequest(p));
    bus.on(EV.SAVE_REQUEST, (p) => this.saves.request(p && p.scope, p && p.reason));
    bus.on(EV.HITSTOP, (p) => {
      const s = Number(p && p.sec);
      if (s > 0) this.hitstop = Math.max(this.hitstop, Math.min(HITSTOP_MAX, s));
    });
    bus.on(EV.PLAYER_SPAWNED, () => this.camera.snap());
    this._installWindowHooks();
    installDebugApi(w, this);

    sim.start();
    const resize = () => rc.resize(w ? w.innerWidth : 1280, w ? w.innerHeight : 720);
    resize();
    if (w) w.addEventListener('resize', resize);
    this.hidden = !!doc && doc.visibilityState === 'hidden';

    this._applyQuery(q);

    if (!this.dev && !this.storageOk) this._sticky('notice.saveBlocked', true);
    if (this.readOnly) this._sticky(SAVE_FUTURE_KEY, true);
    for (const k of notices) this.ui.notice(k, {}, { sec: 6 });
    if (this._isTouchOnly()) this.ui.notice('title.touch', {}, { sec: 10 });

    this.loop = createLoop({ onFrame: (dt) => this._frame(dt), onError: (e) => this._noteError(e, true) });
    this._render(1, 0);
    this.booted = true;
    markReady();
    this.loop.start();
    this._syncPause();
  }

  /**
   * 개발용 쿼리(§11.7) — fixture → 캐릭터 → 균열 → 장면 → (화면) → 패널 → 분석 → 봇. 부트 중의 전환은 막 없이 바로 commit 한다.
   * @param {ReturnType<typeof parseQuery>} q
   */
  _applyQuery(q) {
    const sim = this.sim;
    this._booting = true;
    try {
      const fx = q.fixture ?? q.panelFixture;
      if (fx) {
        if (!this.loadFixture(fx)) this._noteProblem(`unknown fixture '${fx}'`);
      } else if (q.dev && q.makeChar) {
        const cls = q.cls ?? CLASS_IDS[0];
        const name = this._defaultName(cls);
        const seed = hash32(this.seed, 0);
        const newId = sim.ctx.newItemId;
        const char = q.level !== null || q.rift !== null
          ? makeDevCharacter({ slot: 0, cls, name, level: q.level ?? 1, rift: q.rift ?? 1, preset: q.preset ?? 0, seed, newId })
          : createCharacter({ slot: 0, cls, name, newId, seed });
        sim.loadCharacter(0, char);
        const riftLevel = q.scene === 'town' ? null : q.rift ?? (q.scene === 'rift' ? 1 : null);
        if (riftLevel !== null && sim.state.char) {
          const r = sim.openRift(riftLevel);
          if (!r.ok) sim.debugOpenRift(riftLevel);
          else if (sim.state.pendingTravel) sim.commitTravel();
        }
      }
      // 화면 — 캐릭터가 붙어 있으면 play · 아니면 타이틀(?fresh 는 새 캐릭터 화면)
      if (sim.state.char) this.screens.go('play');
      else {
        this.screens.go('title');
        if (q.fresh && q.dev) this.ui.openPanel('newChar', {});
        else this._openTitle();
      }
      if (q.panel && PANEL_IDS.includes(q.panel) && this.ui.topPanel() !== q.panel) this.ui.openPanel(q.panel, {});
      if (q.analytics && this.ui.topPanel() !== 'analytics') this.ui.openPanel('analytics', {});
      if (q.bot && sim.state.char) this._setBot(true, { strategy: q.strategy, preset: q.preset ?? 0 });
    } finally {
      this._booting = false;
    }
  }

  _openTitle() {
    this.ui.openPanel('title', { storageOk: this.storageOk, readOnly: this.readOnly, touch: this._isTouchOnly(), dev: this.dev });
  }

  /** @param {string} cls */
  _defaultName(cls) {
    return STRINGS['title.defaultName.' + cls] ?? cls;
  }

  _isTouchOnly() {
    const w = this.win;
    if (!w || typeof w.matchMedia !== 'function') return false;
    try {
      return w.matchMedia('(pointer: coarse)').matches && !w.matchMedia('(any-pointer: fine)').matches;
    } catch {
      return false;
    }
  }

  _installWindowHooks() {
    const w = this.win;
    const doc = this.doc;
    if (doc && typeof doc.addEventListener === 'function') doc.addEventListener('visibilitychange', () => this._onVisibility());
    if (!w || typeof w.addEventListener !== 'function') return;
    w.addEventListener('pagehide', () => this._persistNow());
    w.addEventListener('blur', () => this._onBlur());
    w.addEventListener('focus', () => { this.blurred = false; this._syncPause(); });
    const c = this.canvas;
    if (c && typeof c.addEventListener === 'function') {
      c.addEventListener('webglcontextlost', (e) => this._onContextLost(e), false);
      c.addEventListener('webglcontextrestored', () => this._onContextRestored(), false);
    }
  }

  // ───────────────────────── 루프(§5.12 · §11.3) ─────────────────────────

  /** 한 프레임 @param {number} dt 실제 초(MAX_FRAME_DT 로 자른 값) */
  _frame(dt) {
    if (this.hitstop > 0) this.hitstop = Math.max(0, this.hitstop - dt);
    if (this.trans) this._advanceTransition(dt);
    else if (this.sim.state.pendingTravel) this._onTravelRequest(this.sim.state.pendingTravel);   // 놓친 요청이 막 없이 남지 않게
    if (this.screens.current === 'title' && this.ui && !this.ui.anyOpen()) this._openTitle();
    const running = this._canStep();
    this.stepper.frame(dt, running, this._tickFn, this._canStepFn);
    this._townPanelTime(dt, running);
    this._render(this.stepper.alpha, dt);
    this._flushSaves(false);
    this._syncPause();
  }

  /** 한 틱 — 봇이 켜져 있으면 봇의 입력(사람의 에지는 버린다) */
  _tick() {
    const sim = this.sim;
    const bot = this.bot;
    if (bot) {
      /** @type {any} */
      let input;
      try {
        this.input.clearEdges();
        input = bot.frame();
      } catch (e) {
        this._noteError(e, true);
        this._setBot(false);
        return;
      }
      sim.step(input);
      try {
        if (this.bot === bot) bot.afterStep();
      } catch (e) {
        this._noteError(e, true);
        this._setBot(false);
      }
      return;
    }
    sim.step(this.input.frame(sim.state, sim.getMap()));
  }

  _fillCond() {
    const c = this._cond;
    const ui = this.ui;
    const st = this.sim.state;
    const bot = !!this.bot;
    const top = ui ? ui.topPanel() : null;
    c.screen = this.screens.current;
    c.hasChar = !!st.char;
    c.fading = !!this.trans;
    c.hitstop = this.hitstop > 0;
    c.hidden = this.hidden;
    c.blurred = this.blurred && !bot;
    c.contextLost = this.contextLost;
    c.debugPaused = this.debugPaused;
    c.top = top;
    c.modal = ui ? (bot ? !!top && BOT_HALT_PANELS.includes(top) : ui.isModal()) : false;
    c.anyOpen = ui ? ui.anyOpen() : false;
    c.scene = st.scene;
    c.bot = bot;
    return c;
  }

  _canStep() { return stepAllowed(this._fillCond()); }

  /** 마을에서 패널이 열려 step 하지 않은 실제 시간 → sim.addPlaySec(§11.3 · 플레이 시간 측정) @param {number} dt @param {boolean} running */
  _townPanelTime(dt, running) {
    const st = this.sim.state;
    const c = this._cond;
    const counting = !running && !this.bot && c.screen === 'play' && !!st.char && st.scene === 'town' && c.anyOpen
      && !c.fading && !c.hidden && !c.blurred && !c.contextLost && !c.debugPaused && !(c.top && (MENU_PANELS.includes(c.top) || c.top === 'analytics'));
    if (counting) this._townSec += dt;
    if (this._townSec > 0 && (!counting || this._townSec >= PLAY_SEC_CHUNK)) {
      const s = this._townSec;
      this._townSec = 0;
      if (st.char) this.sim.addPlaySec(s);
    }
  }

  /** 렌더 순서(§9.1): world → actors → fx → camera → render → ui (→ audio) @param {number} alpha @param {number} dtReal */
  _render(alpha, dtReal) {
    if (!this.rc) return;
    const st = this.sim.state;
    const target = this.camera.target;
    this.world.update(st, alpha, dtReal, target);
    this.actors.update(st, alpha, dtReal, target);
    this.fx.update(st, alpha, dtReal, target);
    this.camera.update(st, alpha, dtReal);
    this.rc.render();
    this.ui.update(st, alpha, dtReal);
    this.audio.update(st, dtReal);
  }

  /** PAUSED{on, reason} — 사유가 바뀔 때만 */
  _syncPause() {
    if (!this.ui || !this.bus) return;
    const r = pauseReason(this._fillCond());
    if (r === this._pause) return;
    const prev = this._pause;
    this._pause = r;
    this.bus.emit(EV.PAUSED, { on: r !== null, reason: r ?? prev });
  }

  // ───────────────────────── 전환 막(§11.4) ─────────────────────────

  /** @param {{to:string, reason:string}} p */
  _onTravelRequest(p) {
    if (this._booting) return;                                 // 부트 중에는 applyQuery 가 바로 commit 한다
    if (!this.sim.state.pendingTravel) return;                 // 이미 commit 됨(디버그 _travelNow)
    const tr = this.trans;
    if (tr && tr.phase === 'out') return;                      // 막이 내려가는 중 — 그 끝에서 commit 한다
    this.input.clearEdges();
    const f = p && p.reason === 'respawn' ? FADE_RESPAWN_SEC : FADE_SEC;
    if (this.hidden) {                                         // 탭이 숨어 있으면 바로(타이머가 멈추지 않게)
      this._commit();
      if (this.trans) {
        this.trans = null;
        this.bus.emit(EV.FADE, { phase: 'in', sec: 0 });
      }
      this.input.dropEdges(1);
      return;
    }
    if (tr) {                                                  // 막이 걷히는 중의 새 요청(부활 막 아래에서 미리 누른 「Enter — 복귀」) — 다시 내린다
      tr.phase = 'out';
      tr.t = 0;
      tr.f = f;
    } else this.trans = { phase: 'out', t: 0, f };
    this.bus.emit(EV.FADE, { phase: 'out', sec: f });
  }

  /** 막 진행 — 실제 시간(루프의 dt) @param {number} dt */
  _advanceTransition(dt) {
    const tr = this.trans;
    if (!tr) return;
    tr.t += dt;
    if (tr.phase === 'out' && tr.t >= tr.f) {
      this._commit();
      if (this.trans !== tr) return;
      tr.phase = 'in';
      tr.t = 0;
      this.bus.emit(EV.FADE, { phase: 'in', sec: tr.f });
    } else if (tr.phase === 'in' && tr.t >= tr.f) {
      this.trans = null;
      this.input.dropEdges(1);                                 // 막이 걷힌 뒤 1틱 에지 버림(§10.5-7)
      if (this.sim.state.pendingTravel) this._onTravelRequest(this.sim.state.pendingTravel);
    }
  }

  /** 막 아래에서: 옛 장면의 패널을 닫고 → commitTravel(맵 생성) → 한 번 그리고 셰이더 컴파일(첫 균열의 멈칫이 막 아래에서 끝난다) */
  _commit() {
    if (this.ui.anyOpen()) this.ui.closeAll('code');
    this.hitstop = 0;
    let r = null;
    try {
      r = this.sim.commitTravel();
    } catch (e) {
      this._noteError(e, true);
    }
    this._warmup();
    return r;
  }

  _warmup() {
    try {
      this._render(1, 0);
      const renderer = this.rc && this.rc.renderer;
      if (renderer && typeof renderer.compile === 'function') renderer.compile(this.rc.scene, this.rc.camera);
    } catch (e) {
      this._noteError(e, true);
    }
  }

  /** 막을 지금 끝낸다(탭 숨김 · 타이틀로) */
  _finishTransitionNow() {
    const tr = this.trans;
    if (!tr) return;
    if (tr.phase === 'out' && this.sim.state.pendingTravel) this._commit();
    this.trans = null;
    this.bus.emit(EV.FADE, { phase: 'in', sec: 0 });
    this.input.dropEdges(1);
  }

  // ───────────────────────── 키 · 포커스 · 가시성 · 컨텍스트 ─────────────────────────

  /** app 이 먹는 키(ui.handleKey 가 먹지 않은 것 — §10.5-4 · 6) @param {KeyboardEvent} e @returns {boolean} */
  _appKey(e) {
    const code = e.code;
    const ui = this.ui;
    const screen = this.screens.current;
    if (code === KEYBINDS.pause) {
      if (e.repeat) return true;
      if (ui.anyOpen()) ui.closePanel(null, 'esc');
      else if (screen === 'play') ui.openPanel('pause', {});
      else if (screen === 'title') this._openTitle();
      return true;
    }
    if (code === KEYBINDS.analytics) {
      if (!e.repeat && (screen === 'play' || screen === 'title')) this._toggle('analytics');
      return true;
    }
    if (screen !== 'play' || !this.sim.state.char) return false;
    for (const [k, id] of TOGGLES) {
      if (code !== k) continue;
      if (!e.repeat) this._toggle(id);
      return true;
    }
    if (KEYBINDS.confirm.includes(code)) {
      const st = this.sim.state;
      if (!this.bot && !e.repeat && !ui.anyOpen() && st.scene === 'town' && st.town && st.town.returnPrompt) {
        this.actions.returnToRift();                            // HUD 복귀 안내 「Enter」(§10.5-6) — ui 가 먹지 않았을 때
        return true;
      }
    }
    return false;
  }

  /** @param {PanelId} id */
  _toggle(id) {
    if (this.ui.topPanel() === id) this.ui.closePanel(id, 'key');
    else this.ui.openPanel(id, {});
  }

  _unlockAudio() {
    if (this.audioUnlocked || !this.audio) return;
    this.audioUnlocked = true;
    try {
      this.audio.unlock();
    } catch (e) {
      this._noteError(e, true);
    }
    this.bus.emit(EV.AUDIO_UNLOCKED, {});
  }

  /** 사람이 보던 판이면 일시정지 패널을 띄운다(돌아오면 떠 있다 — §11.5) */
  _openPauseIfPlaying() {
    if (!this.ui || this.bot) return;
    if (this.screens.current !== 'play' || !this.sim.state.char) return;
    if (this.ui.isModal()) return;
    this.ui.openPanel('pause', {});
  }

  _onBlur() {
    this.blurred = true;
    if (this.input) this.input.releaseAll();
    this._openPauseIfPlaying();
    this._syncPause();
  }

  _onVisibility() {
    const hidden = !!this.doc && this.doc.visibilityState === 'hidden';
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    if (hidden) {
      if (this.input) this.input.releaseAll();
      if (this.audio) this.audio.setPaused(true);
      if (this.trans) this._finishTransitionNow();
      this._openPauseIfPlaying();
      this._persistNow();
    } else {
      if (this.audio) this.audio.setPaused(false);
      if (this.loop) this.loop.resync();
    }
    this._syncPause();
  }

  /** 탭 숨김 · pagehide — 캐릭터가 있고 dev 가 아니면 무조건 캐릭터 + 계정 · 밀린 설정 */
  _persistNow() {
    try {
      if (this.sim) this._flushSaves(true);
      if (this.settingsSave) this.settingsSave.flush();
    } catch (e) {
      this._noteError(e, true);
    }
  }

  /** @param {Event} e */
  _onContextLost(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();   // 복구를 받으려면
    this.contextLost = true;
    if (this.input) this.input.releaseAll();
    this._sticky('notice.contextLost', true);
    if (this.ui && this.screens.current === 'play' && this.sim.state.char && this.ui.topPanel() !== 'pause') this.ui.openPanel('pause', {});
    this._syncPause();
  }

  _onContextRestored() {
    this.contextLost = false;
    try {
      const m = this.sim.getMap();
      this.world.setMap(m);
      this.actors.setMap(m);
      this.fx.setMap(m);
    } catch (e) {
      this._noteError(e, true);
    }
    this._sticky('notice.contextLost', false);
    if (this.ui) this.ui.notice('notice.contextRestored', {}, {});
    this._syncPause();
  }

  // ───────────────────────── 저장(§11.6) ─────────────────────────

  /** 세이브를 쓰는 세션인가 */
  persist() { return !this.dev && this.storageOk && !this.readOnly; }

  /** 프레임 끝 한 번 — 밀린 SAVE_REQUEST(force = 탭 숨김 · pagehide) @param {boolean} force */
  _flushSaves(force) {
    if (!this.persist()) {
      this.saves.clear();
      return;
    }
    const st = this.sim.state;
    const plan = this.saves.take(this._now(), { force, hasChar: !!st.char });
    if (!plan.char && !plan.account) return;
    let ok = true;
    if (plan.char && st.char) ok = this.storage.writeChar(st.char) && ok;
    if (plan.account || plan.char) ok = this.storage.writeAccount(st) && ok;
    this._sticky('notice.saveBlocked', !ok);
  }

  /** 지금 바로 캐릭터 + 계정(선택 · 새 캐릭터 · 타이틀로) @param {import('../types.js').CharacterState|null} [char] */
  _saveNow(char = null) {
    if (!this.persist()) return;
    const st = this.sim.state;
    const ch = char ?? st.char;
    let ok = true;
    if (ch) ok = this.storage.writeChar(ch) && ok;
    ok = this.storage.writeAccount(st) && ok;
    this.saves.markWritten(this._now());
    this._sticky('notice.saveBlocked', !ok);
  }

  _writeSettings() {
    if (!this.storage) return;
    const ok = this.storageOk && this.storage.writeSettings(this.settings);
    this._sticky('notice.settingsUnsaved', !ok);
  }

  _now() {
    try {
      return performance.now();
    } catch {
      return Date.now();
    }
  }

  /** 지속 알림 켬/끔 — 우선순위가 가장 높은 하나를 ui 에 @param {string} key @param {boolean} on */
  _sticky(key, on) {
    if (on) this._stickies.add(key);
    else this._stickies.delete(key);
    const top = STICKY_ORDER.find((k) => this._stickies.has(k)) ?? null;
    if (top === this._stickyShown || !this.ui) return;
    this._stickyShown = top;
    this.ui.setSticky(top);
  }

  // ───────────────────────── actions(§11.2) ─────────────────────────

  /** @returns {Result} */
  _continueGame() {
    const acc = this.sim.state.account;
    const s = acc.lastSlot;
    if (Number.isInteger(s) && s >= 0 && s < CHAR_SLOTS && acc.chars[s]) return this._selectChar(s);
    const first = acc.chars.findIndex((c) => !!c);
    if (first >= 0) return this._selectChar(first);
    this.ui.openPanel('newChar', {});
    return fail('empty');
  }

  /**
   * storage.loadChar(slot) → (깨졌으면 백업 · 칸 비움 · 알림 · 타이틀) → dedupeItemIds(account, [char]) → sim.loadCharacter → play(바뀌었으면 바로 저장)
   * @param {number} slot @returns {Result}
   */
  _selectChar(slot) {
    const s = Number(slot);
    if (!Number.isInteger(s) || s < 0 || s >= CHAR_SLOTS) return fail('slot');
    if (this.dev || !this.storageOk) return fail('invalid');
    const r = this.storage.loadChar(s);
    if (r.broken || !r.char) {
      this.sim.deleteCharacter(s);                              // 계정 요약을 비운다(명령 — SAVE_REQUEST{account})
      if (r.broken) this.ui.notice('notice.saveBroken', {}, { sec: 6 });
      return fail('empty');
    }
    if (r.future) {
      this.readOnly = true;
      this._sticky(SAVE_FUTURE_KEY, true);
    }
    const { changed } = dedupeItemIds(this.sim.state.account, [r.char]);
    this.ui.closeAll('code');
    const lr = this.sim.loadCharacter(s, r.char);
    if (!lr.ok) return lr;
    if (changed) this._saveNow();
    this._enterPlay();
    return { ok: true };
  }

  /**
   * 새 캐릭터 — 저장소에 char:<slot> 키가 있으면 백업(계정 요약이 아니라 저장소로 판단 — §11.2) → sim.newCharacter → play
   * @param {{slot:number, cls:import('../types.js').ClassId, name:string}} o @returns {Result}
   */
  _newChar(o) {
    const s = Number(o && o.slot);
    if (!Number.isInteger(s) || s < 0 || s >= CHAR_SLOTS) return fail('slot');
    const cls = o && o.cls;
    if (!CLASS_IDS.includes(/** @type {any} */ (cls))) return fail('class');
    let name = String((o && o.name) ?? '').trim().slice(0, NAME_MAX);
    if (!name) name = this._defaultName(/** @type {string} */ (cls));
    if (this.persist() && this.storage.hasChar(s)) this.storage.backup(charKey(s));
    this.ui.closeAll('code');
    const r = this.sim.newCharacter({ slot: s, cls, name });
    if (!r.ok) return r;
    this._saveNow();
    this._enterPlay();
    return r;
  }

  /** 백업 뒤 지운다 → sim.deleteCharacter(SAVE_REQUEST{account}) @param {number} slot @returns {Result} */
  _deleteChar(slot) {
    const s = Number(slot);
    if (!Number.isInteger(s) || s < 0 || s >= CHAR_SLOTS) return fail('slot');
    if (this.persist()) this.storage.removeChar(s);
    return this.sim.deleteCharacter(s);
  }

  _enterPlay() {
    this.screens.go('play');
    this.debugPaused = false;
    if (this.input) this.input.dropEdges(1);
    this._syncPause();
  }

  /**
   * 저장(즉시) → sim.unloadCharacter()(열린 균열은 닫힌다 — abandon 기록) → 잡아 둔 캐릭터로 한 번 더 저장 → title(§11.2 · W1 확정)
   * @returns {Result}
   */
  _quitToTitle() {
    if (this.bot) this._setBot(false);
    if (this.trans) {
      this.trans = null;
      this.bus.emit(EV.FADE, { phase: 'in', sec: 0 });
    }
    this.hitstop = 0;
    this.ui.closeAll('code');
    const ch = this.sim.state.char;
    if (ch) {
      this._saveNow();
      this.sim.unloadCharacter();
      this._saveNow(ch);
    }
    this.screens.go('title');
    this._openTitle();
    this._syncPause();
    return { ok: true };
  }

  /** 일시정지 패널의 「계속」 @returns {Result} */
  _resume() {
    if (this.ui.topPanel() === 'pause') this.ui.closePanel('pause', 'confirm');
    this.blurred = false;
    this._syncPause();
    return { ok: true };
  }

  /**
   * SETTINGS_SCHEMA 로 정화 → 같은 settings 객체에 Object.assign → SETTINGS_CHANGED → 250ms 디바운스로 writeSettings(devSession 에서도)
   * @param {Partial<Settings>} partial @returns {Result}
   */
  _applySettings(partial) {
    const clean = sanitizeSettings(partial);
    Object.assign(this.settings, clean);
    if (this.bus) this.bus.emit(EV.SETTINGS_CHANGED, { settings: this.settings });
    if (this.audio && typeof this.audio.applySettings === 'function') this.audio.applySettings(this.settings);
    if (this.settingsSave) this.settingsSave.schedule();
    return { ok: true };
  }

  /**
   * 봇(§11.13) — 켜면 new Bot({sim, strategy, cls, preset, seed, autoCommit:false}) → BOT{on:true} · 분석 패널이 맨 위면 닫는다.
   * @param {boolean} on @param {{strategy?:string, preset?:number}} [opts] @returns {Result}
   */
  _setBot(on, opts = {}) {
    if (!on) {
      if (!this.bot) return { ok: true };
      this.bot = null;
      if (this.input) this.input.clearEdges();
      this.bus.emit(EV.BOT, { on: false });
      this._syncPause();
      return { ok: true };
    }
    const sim = this.sim;
    const ch = sim && sim.state.char;
    if (!ch || this.screens.current !== 'play') return fail('invalid');
    const strategy = STRATEGIES.includes(/** @type {any} */ (opts && opts.strategy)) ? /** @type {any} */ (opts.strategy) : 'basic';
    const preset = Number(opts && opts.preset) === 1 ? 1 : 0;
    try {
      this.bot = new Bot({ sim, strategy, cls: ch.cls, preset, seed: hash32(this.seed, sim.state.tick), autoCommit: false });
    } catch (e) {
      this._noteError(e, true);
      this.bot = null;
      return fail('invalid');
    }
    if (this.input) this.input.releaseAll();
    this.bus.emit(EV.BOT, { on: true });
    const top = this.ui.topPanel();
    if (top === 'analytics' || top === 'hint') this.ui.closePanel(top, 'code');
    this._syncPause();
    return { ok: true };
  }

  /** Blob · a[download](§10.9) @param {string} name @param {string} mime @param {string} text @returns {Result} */
  _downloadFile(name, mime, text) {
    const doc = this.doc;
    const w = this.win;
    try {
      const blob = new Blob([String(text ?? '')], { type: String(mime || 'text/plain') });
      const url = URL.createObjectURL(blob);
      const a = doc.createElement('a');
      a.href = url;
      a.download = String(name || 'download.txt');
      a.style.display = 'none';
      doc.body.appendChild(a);
      a.click();
      a.remove();
      if (w && typeof w.setTimeout === 'function') w.setTimeout(() => URL.revokeObjectURL(url), 1000);
      return { ok: true };
    } catch (e) {
      this._noteError(e, true);
      return fail('invalid');
    }
  }

  // ───────────────────────── 디버그(§11.8 — debugApi.js 가 부른다) ─────────────────────────

  /** @param {boolean} on */
  debugPause(on) {
    this.debugPaused = !!on;
    this._syncPause();
    return this.debugPaused;
  }

  /** n 틱(멈춘 상태에서도) — 전환 막이 있으면 그 틱만큼 막을 진행 → 렌더 @param {number} n @returns {number} state.tick */
  debugStep(n = 1) {
    const k = Math.max(0, Math.floor(Number(n)) || 0);
    for (let i = 0; i < k; i++) {
      if (!this.trans && this.sim.state.pendingTravel) this._onTravelRequest(this.sim.state.pendingTravel);
      if (this.trans) {
        this._advanceTransition(DT);
        continue;
      }
      this._tick();
    }
    this.stepper.hold();
    this._render(1, 0);
    this._flushSaves(false);
    this._syncPause();
    return this.sim.state.tick;
  }

  /**
   * 고정 상태(§11.9) — 마을 맵은 buildTownMap() 으로 바꿔 넘긴다 · 이 세션은 개발 세션(세이브를 쓰지 않는다) · 봇 끔
   * @param {string} id @returns {boolean}
   */
  loadFixture(id) {
    const make = /** @type {any} */ (FIXTURES)[id];
    if (typeof make !== 'function') return false;
    const f = make(this.query.seed ?? 1);
    const map = f.map && f.map.kind === 'town' ? buildTownMap() : f.map;
    if (this.bot) this._setBot(false);
    if (this.trans) {
      this.trans = null;
      this.bus.emit(EV.FADE, { phase: 'in', sec: 0 });
    }
    this.dev = true;
    this.saves.clear();
    this.sim.debugLoadState(f.state, map, f.riftMap ?? null);
    if (this.sim.state.char && this.screens.current !== 'play') {
      if (this.ui.anyOpen()) this.ui.closeAll('code');
      this.screens.go('play');
    }
    if (this.booted) this._render(1, 0);
    return true;
  }

  /** 디버그 장면 전환(막 없이 바로) — 옛 장면의 패널을 닫고 sim 의 debug* 를 부른다 @param {() => Result} fn @returns {Result} */
  debugTravel(fn) {
    if (!this.sim.state.char) return fail('invalid');
    if (this.trans) {
      this.trans = null;
      this.bus.emit(EV.FADE, { phase: 'in', sec: 0 });
    }
    if (this.ui.anyOpen()) this.ui.closeAll('code');
    const r = fn();
    this._warmup();
    return r;
  }

  memory() {
    const doc = this.doc;
    return {
      rc: this.rc ? this.rc.stats() : null,
      dom: doc && typeof doc.querySelectorAll === 'function' ? doc.querySelectorAll('*').length : 0,
      listeners: this.bus ? this.bus.count() : 0,
      audio: this.audio ? this.audio.stats() : null,
    };
  }

  // ───────────────────────── 오류 ─────────────────────────

  /** 예외 — 첫 프레임 전이면 부팅 실패(markError) @param {unknown} what @param {boolean} log 콘솔에도(window 오류는 브라우저가 이미 찍었다) */
  _noteError(what, log) {
    const s = this._noteProblem(what);
    if (log && typeof console !== 'undefined') console.error(what);
    if (!this.booted) markError(s);
  }

  /** 오류 목록에만(예외가 아닌 문제 — 모르는 고정 상태 ID 등) @param {unknown} what @returns {string} */
  _noteProblem(what) {
    const s = describe(what);
    if (this.errors[this.errors.length - 1] !== s && this.errors.length < ERRORS_MAX) this.errors.push(s);
    return s;
  }
}
