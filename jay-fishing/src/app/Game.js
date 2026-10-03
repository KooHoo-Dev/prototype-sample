// OWNER: P9 — 계약 §6.12 · §11.1 · §11.2 · §11.5 · §11.10
// 부트스트랩(§11.1 순서 그대로) · 루프 · 봇 모드 · fixture 모드 · 화면 상태 기계 · 일시정지 · 저장 · 포인터 락 · 디버그 API.
// 부팅 표식은 ./bootMarker.js 의 markReady · markError 만 쓴다(§11.9).

import { markError, markReady } from './bootMarker.js';
import { DT, MAX_FRAME_DT, SAVE_KEY } from '../core/constants.js';
import { EV, EventBus } from '../core/events.js';
import { NEUTRAL_INPUT, makeInput } from '../core/inputFrame.js';
import { KEYBINDS } from '../data/keybinds.js';
import { getStage } from '../data/stages/index.js';
import { GameSim } from '../sim/GameSim.js';
import { makeDevProfile } from '../sim/progression/profile.js';
import { createSaveData, parseSave, sanitizeSettings } from '../sim/progression/save.js';
import { createBot } from '../bot/bot.js';
import { createRenderContext } from '../view/renderer.js';
import { WorldLayer } from '../view/WorldLayer.js';
import { CameraRig } from '../view/CameraRig.js';
import { TackleLayer } from '../view/tackle/TackleLayer.js';
import { FishLayer } from '../view/fish/FishLayer.js';
import { FxLayer } from '../view/fx/FxLayer.js';
import { FishPreview } from '../view/fish/FishPreview.js';
import { AudioEngine } from '../audio/AudioEngine.js';
import { UIRoot } from '../ui/UIRoot.js';
import { FIXTURE_NAMES, makeFixtureState } from '../debug/fixtures.js';
import { InputCollector } from './input.js';
import { createLoop, runAccumulator } from './loop.js';
import { BOT_STRATEGIES, parseQuery } from './query.js';
import { createScreens, SETTLE_FRAMES, SETTLE_MS } from './screens.js';
import * as storage from './storage.js';
import { installDebugApi } from './debugApi.js';

/** Esc 로 낚시 자리에서 일어나는 단계(§10.4) */
const EXIT_PHASES = ['ready', 'charging', 'casting', 'waiting', 'retrieving', 'failed'];
/** 봇이 낼 수 있는 sim 명령(§6.8) — travel · waitNextBand · sleep 은 actions(전환 막) */
const BOT_SIM_COMMANDS = ['keepCatch', 'releaseCatch', 'sellAll', 'sellOne', 'buy', 'refillLine', 'equip', 'setBait', 'setDepth', 'learnSkill', 'exitFishing'];
const BOT_ACTION_COMMANDS = ['travel', 'waitNextBand', 'sleep'];
/** ?bot 의 계획 — 걷기로 시작하면 지금 씬의 하루 계획(집은 lakeDay) */
const DAY_PLAN_OF_SCENE = { lake: 'lakeDay', coast: 'coastDay', river: 'riverDay' };
/** 같은 Esc 로 치는 창(ms) — Escape keydown 과 락 상실이 겹치면 한 번(§11.2) */
const ESC_DEDUPE_MS = 200;
/** 락 상실 판정을 미루는 시간(ms) — 포커스 잃음(blur)이 먼저 처리되게 */
const LOCK_LOST_DEFER_MS = 30;
const MAX_ERRORS = 200;
const FPS_WINDOW = 60;

/** 새 시드 — Date.now · Math.random 은 app 에서만(§2.1) @returns {number} */
export function newSeed() {
  return (Date.now() ^ (Math.random() * 2 ** 32)) >>> 0;
}

/** @param {unknown} e @returns {string} */
function errText(e) {
  const x = /** @type {any} */ (e);
  if (x && typeof x.message === 'string') return x.message;
  try { return String(x); } catch { return 'unknown'; }
}

export class Game {
  /** @param {Document} doc */
  constructor(doc) {
    this.doc = doc;
    this.win = /** @type {any} */ ((doc && doc.defaultView) || (typeof window !== 'undefined' ? window : null));
    /** @type {string[]} */
    this.errors = [];
    this.booted = false;
    this.sim = /** @type {any} */ (null);
    this.ui = /** @type {any} */ (null);
    this.bot = null;
    this.fixtureMode = false;
    this.debugPaused = false;
    this.paused = false;
    this.contextLost = false;
    this.devSession = false;
    this.saveFlag = false;
    this.saveFailToasted = false;
    /** @type {Storage|undefined} 저장소(테스트용 주입 — 기본 localStorage) */
    this.store = undefined;
    /** 이 탭이 알고 있는 SAVE_KEY 원문(부팅 때 읽은 것 · 이 탭이 마지막으로 쓴 것) — 다르면 다른 탭이 썼다 @type {string|null} */
    this._saveRaw = null;
    /** 다른 탭이 세이브를 썼다 — 이 탭은 더 쓰지 않고 타이틀로 간다(리뷰 수정: 옛 탭이 숨거나 닫힐 때 새 탭의 진행을 덮었다) */
    this.staleSave = false;
    /** 마지막으로 연 타이틀의 hasSave */
    this._titleHasSave = false;
    this.acc = { acc: 0 };
    this._lastEsc = -Infinity;
    /** @type {Array<{n:number, res:() => void}>} */
    this._settleWaiters = [];
    this._frameTimes = new Float64Array(FPS_WINDOW);
    this._frameIdx = 0;
    this._frameCount = 0;
    this._lastFrameAt = 0;
    /** @type {Array<() => void>} */
    this._offs = [];
    this._badBotCommands = new Set();
  }

  /** @returns {Promise<void>} */
  start() {
    try {
      this._installErrorCapture();
      this._boot();
    } catch (e) {
      this._pushError('boot: ' + errText(e));
      markError(errText(e));
      if (this._rawConsoleError) this._rawConsoleError(e);
    }
    return Promise.resolve();
  }

  // ── 0. 오류 수집

  _installErrorCapture() {
    const w = this.win;
    if (!w) return;
    this._listen(w, 'error', (e) => {
      const msg = e.message || errText(e.error);
      this._pushError('error: ' + msg);
      if (!this.booted) markError(msg);
    });
    this._listen(w, 'unhandledrejection', (e) => {
      const msg = errText(e.reason);
      this._pushError('rejection: ' + msg);
      if (!this.booted) markError(msg);
    });
    const c = w.console || console;
    const raw = c.error.bind(c);
    this._rawConsoleError = raw;
    c.error = (...args) => {
      this._pushError('console: ' + args.map(errText).join(' '));
      raw(...args);
    };
    this._offs.push(() => { c.error = raw; });
  }

  /** @param {string} msg */
  _pushError(msg) {
    if (this.errors.length < MAX_ERRORS) this.errors.push(msg);
  }

  /** @param {any} target @param {string} name @param {Function} fn @param {any} [opt] */
  _listen(target, name, fn, opt) {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(name, fn, opt);
    this._offs.push(() => target.removeEventListener(name, fn, opt));
  }

  // ── 1. 부트(§11.1)

  _boot() {
    const doc = this.doc;
    const win = this.win;
    this.persisted = storage.loadSettings();
    this.query = parseQuery(win && win.location ? win.location.search : '');
    const q = this.query;
    /** 쿼리 덮어쓰기(이번 실행만) */
    this.overrides = { ...q.overrides };
    /** pause 패널에 넘기는 덮인 키 — 사용자가 바꾸면 여기서 빠진다(같은 배열 — 열린 패널이 다시 그릴 때 반영) */
    this.overriddenKeys = Object.keys(this.overrides);
    this.settings = {};
    this._rebuildSettings();
    const bus = new EventBus();
    this.bus = bus;
    this.devSession = q.devSession;
    const loaded = this._initSave();
    const seed = q.seed ?? newSeed();
    const profile = q.level !== null || q.money !== null || q.gear !== null ? makeDevProfile({ level: q.level, money: q.money, gear: q.gear }) : undefined;
    const sim = new GameSim({
      bus,
      seed,
      save: loaded.save,
      profile,
      session: { ignoreGates: !!(q.scene || q.spot), devSession: q.devSession },
      start: {
        scene: q.scene ?? undefined,
        spotId: q.spot ?? undefined,
        hour: q.time ?? undefined,
        weather: q.weather ?? undefined,
      },
    });
    this.sim = sim;
    this.actions = this._makeActions();

    const canvas = /** @type {HTMLCanvasElement} */ (doc.getElementById('game-canvas'));
    const root = /** @type {HTMLElement} */ (doc.getElementById('ui-root'));
    this.canvas = canvas;
    let rc;
    try {
      rc = createRenderContext(canvas, this.settings);
    } catch (e) {
      this._pushError('webgl: ' + errText(e));
      try {
        const ui = new UIRoot({ root, bus, sim, settings: this.settings, actions: this.actions, fishPreview: new FishPreview() });
        ui.showFatal('fatal.webglTitle', 'fatal.webglBody');
        this.ui = ui;
      } catch (e2) {
        this._pushError('fatal ui: ' + errText(e2));
      }
      markError('webgl');
      return;
    }
    this.rc = rc;
    const settings = this.settings;
    this.world = new WorldLayer({ rc, bus, settings });
    this.camera = new CameraRig({ camera: rc.camera, settings, world: this.world });
    this.tackle = new TackleLayer({ rc, bus, settings, world: this.world });
    this.fish = new FishLayer({ rc, bus, settings, world: this.world });
    this.fx = new FxLayer({ rc, bus, settings, world: this.world });
    this.audio = new AudioEngine({ bus, settings });
    this.preview = new FishPreview();
    this.ui = new UIRoot({ root, bus, sim, settings, actions: this.actions, fishPreview: this.preview });
    const input = new InputCollector({ canvas, settings, bus });
    this.input = input;
    this.screens = createScreens({
      ui: this.ui,
      bus,
      settle: () => this._settle(),
      onBusy: (on) => this._onTransition(on),
      onPendingPause: () => this._onPendingPause(),
      onError: (e) => { this._pushError('transition: ' + errText(e)); if (this._rawConsoleError) this._rawConsoleError(e); },
    });
    this.debug = installDebugApi(win, this);
    this._wireInput();
    this._wireBus();
    this._wireWindow();

    sim.start();

    if (q.fixture) this.loadFixture(q.fixture);
    if (q.bot) this.setBot(q.bot);
    if (q.devSession) {
      this.screens.go('play');
      input.announceLock();
      if (q.panel) {
        if (q.panel === 'result' && !q.fixture) sim.debugSkipToResult();
        this.openPanel(q.panel);
      }
    } else {
      this.screens.go('title');
      this._openTitle(!!loaded.save, loaded.broken, loaded.future);
    }

    this.loop = createLoop({
      frame: (dt) => this._frame(dt),
      onError: (e) => {
        this._pushError('frame: ' + errText(e));
        if (this._rawConsoleError) this._rawConsoleError(e);
      },
    });
    // 첫 화면을 동기로 그리고 표식(rAF 가 늦거나 숨은 탭이어도 check:dist 가 본다)
    this._updateLayers(0, 0);
    rc.render();
    this._afterRender();
    markReady();
    this.booted = true;
    this.loop.start();
  }

  /** 저장소 확인 · 세이브 읽기 · 이 탭이 아는 원문 기억(개발 세션은 읽지 않는다) @returns {{save:Object|null, broken:boolean, future:boolean, raw:string|null}} */
  _initSave() {
    this.canSave = storage.canPersist(this.store);
    const loaded = this.devSession ? { save: null, broken: false, future: false, raw: null } : storage.loadSave(this.store);
    this.loaded = loaded;
    // loadSave 가 손상 원문을 지운 뒤의 값(지우지 못했으면 그 원문 — 백업은 이미 됐다)
    this._saveRaw = this.devSession ? null : storage.readSaveRaw(this.store);
    return loaded;
  }

  /**
   * @param {boolean} hasSave @param {boolean} [broken] @param {boolean} [future]
   * @param {{stale?:boolean, info?:{level:number, money:number}|null}} [extra] 다른 탭의 세이브(stale) — 이어하기 문면 · 확인 본문은 info 로
   */
  _openTitle(hasSave, broken = false, future = false, extra = {}) {
    const notes = [];
    if (extra.stale) notes.push('title.staleSave');
    if (!this.canSave) notes.push('title.noStorage');
    if (this._touchOnly()) notes.push('title.needInput');
    this._titleHasSave = !!hasSave;
    this.ui.setTitleNotes(notes);
    this.ui.openPanel('title', { hasSave, saveBroken: broken, saveFuture: future, stale: !!extra.stale, saveInfo: extra.info || null });
  }

  /** @returns {boolean} 터치만 있는 기기(§11.4) */
  _touchOnly() {
    const w = this.win;
    if (!w || typeof w.matchMedia !== 'function') return false;
    try {
      return w.matchMedia('(pointer: coarse)').matches && !w.matchMedia('(any-pointer: fine)').matches;
    } catch {
      return false;
    }
  }

  // ── 설정(§11.5)

  _rebuildSettings() {
    const s = /** @type {any} */ (this.settings);
    for (const k of Object.keys(s)) if (!(k in this.persisted) && !(k in this.overrides)) delete s[k];
    Object.assign(s, this.persisted, this.overrides);
  }

  /** @param {Object} partial */
  applySettings(partial) {
    if (!partial || typeof partial !== 'object') return;
    for (const k of Object.keys(partial)) {
      if (k in this.overrides) {
        delete /** @type {any} */ (this.overrides)[k];
        const i = this.overriddenKeys.indexOf(k);
        if (i >= 0) this.overriddenKeys.splice(i, 1);
      }
    }
    this.persisted = sanitizeSettings({ ...this.persisted, ...partial });
    storage.writeSettings(this.persisted);   // 개발 세션도 설정은 쓴다 · 쿼리 덮어쓰기는 쓰지 않는다
    this._rebuildSettings();
    this.bus.emit(EV.SETTINGS_CHANGED, { settings: this.settings });
  }

  // ── actions(ui 가 부른다)

  _makeActions() {
    return {
      newGame: () => this.newGame(),
      continueGame: () => this.continueGame(),
      resume: () => this.resume(),
      quitToTitle: () => this.quitToTitle(),
      applySettings: (partial) => this.applySettings(partial),
      travel: (id) => this.travel(id),
      waitNextBand: () => this.waitNextBand(),
      sleep: () => this.sleep(),
      requestPointerLock: () => (this.input ? this.input.requestLock({ soft: true }) : false),
    };
  }

  continueGame() {
    if (this.screens.busy || this.screens.screen !== 'title') return;
    if (this.staleSave) {
      // 메모리의 상태는 다른 탭보다 옛것이다 — 다시 읽어 최신 세이브로 부팅한다(타이틀이 최신 「이어하기」를 보인다)
      this._reloadPage();
      return;
    }
    this.input.requestLock({ soft: true });   // 사용자 활성화 처리기 안(Enter · 클릭)
    this.screens.transition(() => {
      this._closeAllPanels();
      this.screens.go('play');
      this.input.announceLock();
    }, { out: 0.3, in: 0.4 });
  }

  /** 확인(confirm{danger})은 ui 가 이미 받았다 — 두 번째 확인 없이 백업 → sim.newGame → 막 */
  newGame() {
    if (this.screens.busy) return;
    if (!this.devSession && this.canSave && this.screens.screen === 'title' && !this._titleHasSave
        && storage.readSaveRaw(this.store) !== null && storage.readSaveRaw(this.store) !== this._saveRaw) {
      // 세이브 없이 연 타이틀인데 그 사이 다른 탭이 세이브를 만들었다 — 확인 없이 덮지 않는다(타이틀을 최신으로)
      this._markStale();
      return;
    }
    this.input.requestLock({ soft: true });
    if (!this.devSession) {
      storage.backupSave(undefined, this.store);
      this._adoptSave();   // 사용자가 새 게임을 골랐다 — 지금 세이브(백업됨) 위에 이 탭이 쓴다
    }
    this.sim.newGame(newSeed());
    this.screens.transition(() => {
      this._closeAllPanels();
      this.screens.go('play');
      this.input.announceLock();
    }, { out: 0.3, in: 0.4 });
  }

  resume() {
    if (this.ui.activePanel === 'pause') this.ui.closePanel('confirm');   // PANEL_CLOSED{confirm} → 락 다시(처리기 안)
  }

  quitToTitle() {
    if (this.screens.busy) return;
    this.saveNow();
    if (this.staleSave) return;   // 저장하려다 다른 탭의 세이브를 만났다 — _markStale 이 이미 타이틀로 보냈다
    this.screens.transition(() => {
      this.input.releaseLock();
      this.screens.go('title');
      this._openTitle(true);
    });
  }

  /** @param {string} id @returns {{ok:boolean, reason?:string, params?:Object}} */
  travel(id) {
    if (this.screens.busy) return { ok: false, reason: 'busy' };
    const s = this.sim.state;
    if (s.player.mode !== 'walk') return { ok: false, reason: 'busy' };
    const list = this.sim.getTravel();
    const t = Array.isArray(list) ? list.find(d => d.id === id) : null;
    if (!t) return { ok: false, reason: id === s.scene ? 'same' : 'notHere' };
    if (!t.ok) return { ok: false, reason: t.reason || 'invalid', params: t.reasonParams || {} };
    this.screens.transition(() => {
      this._closeAllPanels();
      const r = this.sim.travel(id);
      if (!r || !r.ok) this.ui.toast('reason.' + ((r && r.reason) || 'invalid'), (r && r.params) || {});
      else this.rc.prewarm();
    });
    return { ok: true };
  }

  waitNextBand() {
    if (this.screens.busy) return { ok: false, reason: 'busy' };
    const s = this.sim.state;
    if (s.player.mode !== 'walk') return { ok: false, reason: 'busy' };
    if (getStage(s.scene).kind !== 'outdoor') return { ok: false, reason: 'notHere' };
    this.screens.transition(() => this._simCommand(() => this.sim.waitNextBand()));
    return { ok: true };
  }

  sleep() {
    if (this.screens.busy) return { ok: false, reason: 'busy' };
    const s = this.sim.state;
    if (s.player.mode !== 'walk') return { ok: false, reason: 'busy' };
    if (s.scene !== 'home') return { ok: false, reason: 'notHere' };
    this.screens.transition(() => this._simCommand(() => this.sim.sleep()));
    return { ok: true };
  }

  /** @param {() => any} fn */
  _simCommand(fn) {
    this._closeAllPanels();
    const r = fn();
    if (r && r.ok === false) this.ui.toast('reason.' + (r.reason || 'invalid'), r.params || {});
  }

  _closeAllPanels() {
    for (let i = 0; i < 4 && this.ui.panelDepth > 0; i++) this.ui.closePanel('code');
  }

  // ── 일시정지 · Esc(§11.2 · §10.4)

  openPause() {
    if (this.ui.activePanel === 'pause') return;
    this.ui.openPanel('pause', { overridden: this.overriddenKeys });
  }

  /** @param {string} id @param {Object} [args] */
  openPanel(id, args) {
    this.enterPlay();
    if (id === 'pause') this.openPause();
    else this.ui.openPanel(id, args || {});
  }

  /** @param {'key'|'lock'} src */
  _escape(src) {
    void src;
    const now = this._now();
    if (now - this._lastEsc < ESC_DEDUPE_MS) return;
    this._lastEsc = now;
    if (this.screens.screen !== 'play' || this.screens.busy) return;
    const ui = this.ui;
    if (ui.panelDepth > 0) {
      const top = ui.activePanel;
      if (top !== 'result' && top !== 'title') ui.closePanel('esc');
      return;
    }
    const s = this.sim.state;
    if (s.player.mode === 'fish' && EXIT_PHASES.includes(s.rig.phase)) {
      if (!this.fixtureMode) this.sim.exitFishing();
      return;
    }
    this.openPause();
  }

  _onFocusLost() {
    this.input.releaseAll();
    this._cancelCharge();
    if (this.query.nopause) return;
    if (this.screens.busy) {
      this.screens.requestPause();
      this.audio.setPaused(true);
      return;
    }
    this.audio.setPaused(true);
    if (this.screens.screen === 'play') this.openPause();
  }

  /**
   * 충전 중에 패널이 열리거나 포커스를 잃었다 — 캐스팅 없이 ready 로(최종 게이트: 그동안 뗀 좌클릭이 닫힌 뒤
   * 「놓음」으로 읽혀 원치 않은 캐스팅이 나갔다). 고정 상태(fixture)는 sim 을 바꾸지 않고, 봇은 마우스를 쓰지 않으니 두지 않는다.
   */
  _cancelCharge() {
    const sim = this.sim;
    if (!sim || this.fixtureMode || this.bot || sim.state.rig.phase !== 'charging') return;
    sim.cancelCharge();
  }

  _onPendingPause() {
    const d = /** @type {any} */ (this.doc);
    const away = d.hidden || (typeof d.hasFocus === 'function' && !d.hasFocus());
    if (away && this.screens.screen === 'play') this.openPause();
  }

  /** @param {boolean} on 전환 막 */
  _onTransition(on) {
    if (on) {
      this.input.setCapture(false);
    } else {
      this.input.setCapture(!this.ui.isBlocking());
      this.acc.acc = 0;
      this.loop && this.loop.resetClock();
      if (this.staleSave) this._leaveStale();   // 막 동안 다른 탭이 썼다
    }
  }

  // ── 배선

  _wireInput() {
    const input = this.input;
    let unlocked = false;
    input.onGesture = () => {
      if (unlocked) return;
      unlocked = true;
      this.audio.unlock();
      this.bus.emit(EV.AUDIO_UNLOCKED, {});
    };
    input.keyHandler = (e) => {
      if (this.ui.handleKey(e)) return true;
      if (KEYBINDS.pause.includes(e.code)) {
        if (!e.repeat) this._escape('key');
        return true;
      }
      return this.screens.screen !== 'play' || this.screens.busy;
    };
    input.lockGate = () => this.screens.screen === 'play' && !this.screens.busy && !this.ui.isBlocking();
    input.onLockLost = () => {
      setTimeout(() => {
        const d = /** @type {any} */ (this.doc);
        if (d.hidden || (typeof d.hasFocus === 'function' && !d.hasFocus())) return;   // 포커스 잃음이 처리한다
        this._escape('lock');
      }, LOCK_LOST_DEFER_MS);
    };
  }

  _wireBus() {
    const bus = this.bus;
    const on = (n, fn) => this._offs.push(bus.on(n, fn));
    on(EV.PLAYER_PLACED, (p) => this.input.setLook(p.yaw, p.pitch));
    on(EV.SAVE_REQUEST, () => { this.saveFlag = true; });
    on(EV.PANEL_OPENED, (p) => {
      this.input.setCapture(false);
      this.input.releaseLock();
      this._cancelCharge();
      if (p.panel === 'pause' && !this.paused) {
        this.paused = true;
        this.audio.setPaused(true);
        bus.emit(EV.PAUSED, { on: true });
      }
    });
    on(EV.PANEL_CLOSED, (p) => {
      if (p.panel === 'pause' && this.paused) {
        this.paused = false;
        this.audio.setPaused(this.contextLost);   // 컨텍스트를 잃은 동안은 화면 · sim 이 멈춰 있다 — 소리도
        this.acc.acc = 0;
        if (this.loop) this.loop.resetClock();
        bus.emit(EV.PAUSED, { on: false });
      }
      // 클릭 · Enter 로 닫았다 — 그 클릭의 더블클릭 두 번째 누름이 다시 잡힌 락으로 캔버스에 와도 캐스팅하지 않는다(리뷰 수정)
      if (p.depth === 0 && (p.by === 'confirm' || p.by === 'pointer')) this.input.armClickGuard();
      if (p.depth === 0 && !this.screens.busy) {
        this.input.setCapture(true);
        if ((p.by === 'confirm' || p.by === 'pointer') && this.screens.screen === 'play') this.input.requestLock({ soft: p.by === 'confirm' });
      }
    });
  }

  _wireWindow() {
    const w = this.win;
    const d = this.doc;
    this._listen(w, 'blur', () => this._onFocusLost());
    this._listen(w, 'focus', () => {
      if (!this.paused && !this.contextLost) this.audio.setPaused(false);
      if (this.loop) this.loop.resetClock();
    });
    this._listen(d, 'visibilitychange', () => {
      if (d.visibilityState === 'hidden' || d.hidden) {
        this.saveNow();
        this._onFocusLost();
      } else if (this.loop) {
        this.loop.resetClock();
        this.acc.acc = 0;
      }
    });
    this._listen(w, 'pagehide', () => this.saveNow());
    this._listen(w, 'beforeunload', () => this.saveNow());
    this._listen(w, 'storage', (e) => this._onStorage(e));
    this._listen(this.canvas, 'webglcontextlost', (e) => {
      if (e.cancelable) e.preventDefault();   // 복구를 허락한다
      this.contextLost = true;
      this._pushError('webglcontextlost');
      // §11.10 「일시정지 + 알림」 — 알림은 복구될 때까지 남는다(리뷰 수정: 일시정지를 닫으면 안내 없는 빈 화면에서 멈춰 있었다)
      this.ui.setSticky('hud.notice.contextLost');
      if (this.screens.screen === 'play') this.openPause();
    });
    this._listen(this.canvas, 'webglcontextrestored', () => {
      this.contextLost = false;
      // 기록에서 지운다(복구됨) — 남은 errors 는 복구되지 않은 것만
      const i = this.errors.lastIndexOf('webglcontextlost');
      if (i >= 0) this.errors.splice(i, 1);
      this.acc.acc = 0;
      if (this.loop) this.loop.resetClock();
      this.ui.setSticky(null);
      this.ui.toast('hud.notice.contextRestored');
      // 일시정지가 닫혀 있었다면 다시 연다 — 파이팅이 예고 없이 이어지지 않게(다른 패널이 막고 있으면 그대로 멈춰 있다)
      if (this.screens.screen === 'play' && !this.screens.busy && !this.ui.isBlocking()) this.openPause();
      else if (!this.paused) this.audio.setPaused(false);
    });
  }

  // ── 여러 탭(리뷰 수정 — 같은 localStorage 를 쓰는 탭이 서로의 진행을 덮지 않게)

  /** 다른 탭이 SAVE_KEY 를 바꿨다(window 'storage' — 쓴 탭에는 오지 않는다) @param {StorageEvent} e */
  _onStorage(e) {
    if (this.devSession || !this.canSave) return;
    const key = e ? e.key : null;
    if (key !== SAVE_KEY && key !== null) return;   // null = clear()
    if (storage.readSaveRaw(this.store) === this._saveRaw) return;
    this._markStale();
  }

  /** 이 탭의 메모리 상태는 옛것이다 — 더 쓰지 않고 타이틀로(이미 타이틀이면 최신 세이브로 다시 그린다) */
  _markStale() {
    if (this.devSession) return;
    this.staleSave = true;
    this.saveFlag = false;
    this._leaveStale();
  }

  _leaveStale() {
    const sc = this.screens;
    if (!sc || !this.ui || sc.busy) return;   // 막이 끝나면 _onTransition 이 다시 부른다
    if (sc.screen === 'play') {
      this._closeAllPanels();
      this.input.releaseLock();
      sc.go('title');
    }
    if (sc.screen !== 'title') return;
    const raw = storage.readSaveRaw(this.store);
    const parsed = raw === null ? null : parseSave(raw);
    const save = parsed && parsed.save ? /** @type {any} */ (parsed.save) : null;
    const info = save && save.profile ? { level: save.profile.level, money: save.profile.money } : null;
    this._openTitle(raw !== null, false, false, { stale: true, info });
    // 숨은 탭에서 일어났으면(다른 탭이 저장) 일시정지가 닫히며 켠 소리를 다시 끈다 — 돌아오면 'focus' 가 켠다
    const d = /** @type {any} */ (this.doc);
    if (d && (d.hidden || (typeof d.hasFocus === 'function' && !d.hasFocus()))) this.audio.setPaused(true);
  }

  /** 지금 저장된 세이브를 이 탭의 것으로 삼는다(새 게임 — 사용자가 덮기로 골랐다) */
  _adoptSave() {
    this._saveRaw = storage.readSaveRaw(this.store);
    this.staleSave = false;
  }

  _reloadPage() {
    const loc = this.win && this.win.location;
    try {
      if (loc && typeof loc.reload === 'function') loc.reload();
    } catch (e) {
      this._pushError('reload: ' + errText(e));
    }
  }

  // ── 저장(§11.5)

  /** 숨김 · 닫힘 · 타이틀로 — 플래그와 무관하게 즉시(play · 개발 세션 아님 · 다른 탭이 쓴 뒤가 아님) */
  saveNow() {
    if (this.screens && this.screens.screen === 'play' && !this.devSession && !this.fixtureMode) this._write();
  }

  _flushSave() {
    if (!this.saveFlag) return;
    this.saveFlag = false;
    if (this.devSession || this.fixtureMode) return;
    this._write();
  }

  _write() {
    if (!this.canSave || this.staleSave) return;
    // 쓰기 전에 지금 저장된 원문이 이 탭이 아는 것인지 본다 — 'storage' 이벤트를 놓쳐도(다른 프로세스 · 숨은 탭) 남의 진행을 덮지 않는다
    const r = storage.writeSaveChecked(createSaveData(this.sim.state, Date.now()), this._saveRaw, this.store);
    if (r.ok) {
      this._saveRaw = r.raw;
      return;
    }
    if (r.conflict) {
      this._markStale();
      return;
    }
    if (!this.saveFailToasted) {
      this.saveFailToasted = true;
      this.ui.toast('save.failed');
    }
  }

  /** 디버그 호출이 sim 을 바꾸면 그 뒤로는 실제 세이브를 쓰지 않는다 */
  markDev() {
    this.devSession = true;
  }

  // ── 매 프레임(§11.1)

  /** @param {number} frameDt */
  _frame(frameDt) {
    this._trackFps(frameDt);
    const s = this.sim.state;
    const input = this.input;
    input.playing = this.screens.screen === 'play';
    input.setMode(s.player.mode);
    input.tick(frameDt);
    let alpha = 0;
    if (!this.debugPaused && !this.fixtureMode && !this.contextLost && this.screens.screen === 'play'
        && !this.screens.busy && !this.ui.isBlocking()) {
      if (this.bot && s.rig.phase === 'result') this._botResult();   // 결과 단계에서도 decide 는 프레임마다 한 번
      runAccumulator(this.acc, frameDt, () => this._canStep(), this.bot ? () => this._botStep() : () => this._humanStep());
      alpha = this.acc.acc / DT;
    } else {
      this.acc.acc = 0;
    }
    if (this.bot) input.setLook(s.player.yaw, s.player.pitch);
    this._updateLayers(alpha, frameDt);
    if (!this.contextLost) this.rc.render();
    this._afterRender();
    this._flushSave();
  }

  _canStep() {
    return !this.ui.isBlocking() && !this.screens.busy && this.sim.state.rig.phase !== 'result';
  }

  _humanStep() {
    this.sim.step(this.input.buildFrame());
    return true;
  }

  _botStep() {
    const s = this.sim.state;
    const a = this.bot.decide(s, this.sim) || { input: NEUTRAL_INPUT, command: null };
    if (a.command) this._runBotCommand(a.command);
    if (!this._canStep()) return false;   // 명령이 막을 열었거나 결과 단계 — 이 틱은 step 하지 않는다
    this.sim.step(a.input || NEUTRAL_INPUT);
    return true;
  }

  _botResult() {
    const a = this.bot.decide(this.sim.state, this.sim);
    if (a && a.command) this._runBotCommand(a.command);
  }

  /** @param {{name:string, args?:Array}} cmd */
  _runBotCommand(cmd) {
    const name = cmd && cmd.name;
    const args = Array.isArray(cmd.args) ? cmd.args : [];
    if (BOT_ACTION_COMMANDS.includes(name)) {
      /** @type {any} */ (this)[name](...args);
      return;
    }
    if (BOT_SIM_COMMANDS.includes(name) && typeof this.sim[name] === 'function') {
      this.sim[name](...args);
      return;
    }
    if (!this._badBotCommands.has(name)) {
      this._badBotCommands.add(name);
      this._pushError('bot: unknown command ' + String(name));
    }
  }

  /** @param {number} alpha @param {number} dt */
  _updateLayers(alpha, dt) {
    const s = this.sim.state;
    const look = this.input.look;
    this.camera.update(s, alpha, dt, look);
    this.world.update(s, alpha, dt);
    this.tackle.update(s, alpha, dt);
    this.fish.update(s, alpha, dt);
    this.fx.update(s, alpha, dt);
    this.audio.update(s, dt);
    this.ui.update(s, dt);
  }

  _afterRender() {
    const ws = this._settleWaiters;
    for (let i = ws.length - 1; i >= 0; i--) {
      if (--ws[i].n <= 0) {
        const w = ws[i];
        ws.splice(i, 1);
        w.res();
      }
    }
  }

  /** 렌더한 프레임 2개 또는 250ms 중 먼저 @returns {Promise<void>} */
  _settle() {
    return new Promise((res) => {
      let done = false;
      const w = { n: SETTLE_FRAMES, res: () => { if (!done) { done = true; res(); } } };
      this._settleWaiters.push(w);
      setTimeout(() => {
        const i = this._settleWaiters.indexOf(w);
        if (i >= 0) this._settleWaiters.splice(i, 1);
        w.res();
      }, SETTLE_MS);
    });
  }

  /** @param {number} dt */
  _trackFps(dt) {
    this._frameTimes[this._frameIdx] = dt;
    this._frameIdx = (this._frameIdx + 1) % FPS_WINDOW;
    if (this._frameCount < FPS_WINDOW) this._frameCount++;
  }

  _now() {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  // ── 디버그(§11.7)

  /** @param {boolean} [on] @returns {boolean} */
  setDebugPause(on) {
    if (on !== undefined) {
      this.debugPaused = !!on;
      if (!this.debugPaused) {
        this.acc.acc = 0;
        this.loop.resetClock();
      }
    }
    return this.debugPaused;
  }

  /** @param {number} n @returns {Promise<void>} */
  async debugStep(n = 1) {
    const k = Math.max(0, Math.floor(Number(n) || 0));
    if (this.fixtureMode) {
      for (let i = 0; i < k; i++) this._updateLayers(0, DT);
      if (k === 0) this._updateLayers(0, 0);
    } else {
      let done = 0;
      let guard = 0;
      while (done < k && guard++ < k * 4 + 16) {
        if (this.screens.busy) {
          await this.screens.idle();
          continue;
        }
        if (this.ui.isBlocking() || this.screens.screen !== 'play' || this.contextLost) break;
        const s = this.sim.state;
        if (this.bot) {
          if (s.rig.phase === 'result') {
            this._botResult();
            done++;
            continue;
          }
          this._botStep();
        } else {
          if (s.rig.phase === 'result') break;
          this.sim.step(makeInput({ yaw: this.input.look.yaw, pitch: this.input.look.pitch }));
        }
        done++;
      }
      if (this.bot) this.input.setLook(this.sim.state.player.yaw, this.sim.state.player.pitch);
      this._updateLayers(0, Math.min(k * DT, MAX_FRAME_DT));
    }
    if (!this.contextLost) this.rc.render();
    this._afterRender();
    this._flushSave();
  }

  /** @param {boolean|string} on @returns {string|false} */
  setBot(on) {
    if (!on) {
      this.bot = null;
      this.ui.setAutoPanels(true);
      return false;
    }
    const strategy = typeof on === 'string' && BOT_STRATEGIES.includes(on) ? on : 'basic';
    const s = this.sim.state;
    const fishing = s.player.mode === 'fish' && s.player.spotId;
    // W2 통합: 자리면 stay · 야외 스테이지면 그 스테이지의 하루 계획(?scene=coast&bot=1 이 호수로 떠나지 않게) · 집이면 lakeDay
    const plan = fishing ? 'stay' : (DAY_PLAN_OF_SCENE[s.scene] || 'lakeDay');
    this.bot = createBot({
      strategy: /** @type {any} */ (strategy),
      seed: s.seed,
      plan: /** @type {any} */ (plan),
      ...(fishing ? { spotId: s.player.spotId } : {}),
    });
    this.ui.setAutoPanels(false);
    // 봇이 풀 수 없는 패널(결과 · 장소)을 닫는다 — 타이틀 · 일시정지는 사람의 것
    for (let i = 0; i < 4 && this.ui.panelDepth > 0; i++) {
      const top = this.ui.activePanel;
      if (top === 'title' || top === 'pause' || top === 'confirm') break;
      this.ui.closePanel('code');
    }
    return strategy;
  }

  /** @param {string} name @returns {boolean} */
  loadFixture(name) {
    if (!FIXTURE_NAMES.includes(name)) return false;
    this.markDev();
    this.sim.debugLoadState(makeFixtureState(name));
    this.fixtureMode = true;
    this.acc.acc = 0;
    this.input.setLook(this.sim.state.player.yaw, this.sim.state.player.pitch);
    this.enterPlay();
    return true;
  }

  leaveFixture() {
    this.fixtureMode = false;
  }

  /** 타이틀이면 막 없이 play 로(디버그 · 개발 세션) */
  enterPlay() {
    if (!this.screens || this.screens.screen === 'play') return;
    if (this.ui.activePanel === 'title') this._closeAllPanels();
    this.screens.go('play');
    this.input.announceLock();
  }

  /** 타이틀을 건너뛰고 새 개발 세션으로 play @returns {boolean} */
  startGame() {
    this.markDev();
    this.fixtureMode = false;
    this.sim.newGame(newSeed());
    this._closeAllPanels();
    this.enterPlay();
    return true;
  }

  /** @returns {number} 최근 fps */
  fps() {
    let sum = 0;
    for (let i = 0; i < this._frameCount; i++) sum += this._frameTimes[i];
    return sum > 0 ? Math.round((this._frameCount / sum) * 10) / 10 : 0;
  }

  memory() {
    const info = /** @type {any} */ (this.rc && this.rc.renderer ? this.rc.renderer.info : null);
    return {
      geometries: info ? info.memory.geometries : 0,
      textures: info ? info.memory.textures : 0,
      programs: info && info.programs ? info.programs.length : 0,
      domNodes: this.doc.getElementsByTagName('*').length,
      listeners: this.bus.count(),
      audioNodes: this.audio ? this.audio.stats().nodes : 0,
      particles: this.fx && typeof this.fx.stats === 'function' ? this.fx.stats().particles : 0,
    };
  }

  dispose() {
    if (this.loop) this.loop.stop();
    for (const off of this._offs) off();
    this._offs = [];
    for (const k of ['input', 'ui', 'audio', 'fx', 'fish', 'tackle', 'world', 'preview', 'rc']) {
      const o = /** @type {any} */ (this)[k];
      if (o && typeof o.dispose === 'function') {
        try { o.dispose(); } catch (e) { this._pushError('dispose: ' + errText(e)); }
      }
    }
    if (this.win && this.win.__game === this.debug) delete this.win.__game;
  }
}
