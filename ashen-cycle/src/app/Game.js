// OWNER: P9 — 계약 §11.1
// 부트스트랩: 모든 계층을 의존 순서대로 만들고, 프레임 순서(§11.1)와 저장 시점(§11.4)을 쥔다.
//   bus → settings → loaded/profile → progression → sim → rc → world → cameraRig → characters → fx → audio → ui → input → debugApi
// 상태의 정본은 sim이다. app은 입력을 InputFrame으로 만들어 넘기고, 화면 전환 · 일시정지 · 저장만 결정한다.
//
// 개발용 URL 쿼리(README 「디버그」):
//   ?boss=<id>   타이틀을 건너뛰고 그 보스전으로      ?town=1     타이틀을 건너뛰고 마을로
//   ?panel=<id>  마을(또는 ?boss의 보스전)에서 그 패널을 연다   ?god=1      무적
//   ?bot=1       봇 조종                              ?fresh=1    세이브를 읽지도 쓰지도 않는 새 프로필(시드 1)
//   ?save=1      위 쿼리와 함께 써도 실제 세이브를 쓴다   ?nopause=1  포커스 · 락 상실로 일시정지하지 않는다
//   타이틀을 건너뛰는 쿼리(boss · town · panel)와 fresh는 「일회용 세션」이다 — 시드 1의 새 프로필로 시작하고
//   localStorage의 프로필을 건드리지 않으며(설정은 평소대로), 포커스를 잃어도 멈추지 않는다(자동화가 끊기지 않게).
import { EventBus, EV } from '../core/events.js';
import { DT, MAX_FRAME_DT, BOSS_IDS, PANEL_IDS } from '../core/constants.js';
import { makeInput } from '../core/inputFrame.js';
import { CAMERA } from '../data/camera.js';
import { createNewProfile } from '../sim/progression/profile.js';
import { Progression } from '../sim/progression/Progression.js';
import { sanitizeSettings } from '../sim/progression/save.js';
import { GameSim } from '../sim/GameSim.js';
import { createRenderContext } from '../view/renderer.js';
import { WorldLayer } from '../view/world/WorldLayer.js';
import { CameraRig } from '../view/CameraRig.js';
import { CharacterLayer } from '../view/characters/CharacterLayer.js';
import { FxLayer } from '../view/fx/FxLayer.js';
import { AudioEngine } from '../audio/AudioEngine.js';
import { UIRoot } from '../ui/UIRoot.js';
import { t } from '../ui/i18n.js';
import { createBot } from '../bot/bot.js';
import { InputCollector } from './input.js';
import { FixedStepper, FrameLoop } from './loop.js';
import { ScreenMachine } from './screens.js';
import * as storage from './storage.js';
import * as debugApi from './debugApi.js';

/** @typedef {import('../types.js').InputFrame} InputFrame */
/** @typedef {import('../types.js').Settings} Settings */
/** @typedef {import('../types.js').UiActions} UiActions */

/** 타이틀 배경: 카메라가 마을을 천천히 돈다(rad/s) */
const TITLE_ORBIT_SPEED = 0.05;
/** 부팅: 검은 막에서 타이틀이 걷혀 나오는 시간(초) — 셰이더 선컴파일의 첫 프레임 멈칫을 가린다 */
const BOOT_FADE_IN = 0.6;
/** debugStep 한 번이 미는 틱의 상한(10분) · 그 사이 레이어를 갱신하는 횟수의 상한 */
const STEP_MAX = 36000;
const STEP_LAYER_UPDATES = 240;
/** 일회용 세션의 프로필 시드(자동화 · 스크린샷이 매번 같은 판을 본다) */
const DEV_SEED = 1;
/** 저장에 실패했을 때 다시 써 보는 간격(초) · 화면 아래 알림 줄을 보여 주는 시간(초) */
const SAVE_RETRY = 5;
const NOTICE_HOLD = 10;
const PAD_NOTICE_HOLD = 6;
/**
 * 화면 전환: 막을 걷기 전에 새 화면을 이만큼 그린다(프레임) — 보스 뷰의 셰이더 컴파일(세션 첫 진입 0.1~0.3초)이
 * 불투명한 막 아래에서 끝난다(CharacterLayer는 새 보스 뷰의 첫 두 프레임에 불투명 · 투명 변형을 모두 컴파일한다).
 * 프레임이 돌지 않는 환경(숨은 탭 · 자동화)에서는 SETTLE_MAX_MS 뒤에 그냥 걷는다.
 */
const SETTLE_FRAMES = 2;
const SETTLE_MAX_MS = 250;

const NO_LOOK = Object.freeze({ dx: 0, dy: 0 });

/**
 * 터치만 있는 기기인가(폰 · 태블릿 — 키보드 · 마우스가 없다). 이 게임은 터치로 조작할 수 없다.
 * @param {Window} win
 * @returns {boolean}
 */
function isTouchOnly(win) {
  try {
    if (typeof win.matchMedia !== 'function') return false;
    return win.matchMedia('(pointer: coarse)').matches && !win.matchMedia('(any-pointer: fine)').matches;
  } catch {
    return false;
  }
}

/** @param {string} search location.search */
function parseQuery(search) {
  const q = new URLSearchParams(search);
  const flag = (/** @type {string} */ key) => q.has(key) && q.get(key) !== '0' && q.get(key) !== 'false';
  const boss = q.get('boss');
  const panel = q.get('panel');
  return {
    boss: boss && BOSS_IDS.includes(boss) ? boss : null,
    panel: panel && PANEL_IDS.includes(panel) && panel !== 'title' ? panel : null,
    town: flag('town'),
    god: flag('god'),
    bot: flag('bot'),
    fresh: flag('fresh'),
    save: flag('save'),
    nopause: flag('nopause'),
  };
}

export class Game {
  /**
   * §11.1의 순서로 만든다. 레이어 하나가 생성 중에 던져도 나머지로 돈다(오류는 __ashen.errors()에 남는다).
   * @param {Document} doc
   */
  constructor(doc) {
    const win = /** @type {Window} */ (doc.defaultView);
    this.document = doc;
    this.window = win;
    /** window.onerror · unhandledrejection · 레이어 예외 수집 목록 @type {string[]} */
    this.errors = debugApi.captureErrors(win);

    const canvas = /** @type {HTMLCanvasElement} */ (doc.getElementById('game-canvas'));
    const root = /** @type {HTMLElement} */ (doc.getElementById('ui-root'));
    this.canvas = canvas;
    this.root = root;
    const query = parseQuery(win.location.search);
    this.query = query;
    /** 타이틀을 건너뛰는가 */
    this.skipTitle = !!(query.boss || query.town || query.panel);
    /** 일회용 세션: 프로필 세이브를 읽지도 쓰지도 않는다 */
    this.ephemeral = (this.skipTitle || query.fresh) && !query.save;
    /** 포커스 · 락 상실로 일시정지하는가 */
    this.autoPause = !(this.skipTitle || query.fresh || query.nopause);

    this.bus = new EventBus();
    /** @type {Settings} 수명 내내 같은 객체(필드만 바꾼다) */
    this.settings = storage.loadSettings();
    this.loaded = this.ephemeral ? { save: null, broken: false } : storage.loadSave();
    this.profile = this.loaded.save?.profile ?? createNewProfile(this._newSeed());
    this.progression = new Progression(this.profile, this.bus);
    this.sim = new GameSim({ profile: this.profile, bus: this.bus });

    const { bus, settings, sim, progression } = this;
    this.rc = this._make('renderer', () => createRenderContext(canvas, settings));
    const rc = this.rc;
    this.world = rc && this._make('WorldLayer', () => new WorldLayer({ rc, bus, settings }));
    this.cameraRig = rc && this._make('CameraRig', () => new CameraRig({ camera: rc.camera, bus, settings }));
    this.characters = rc && this._make('CharacterLayer', () => new CharacterLayer({ scene: rc.scene, bus, settings }));
    this.fx = rc && this._make('FxLayer', () => new FxLayer({ scene: rc.scene, camera: rc.camera, bus, characters: this.characters, settings }));
    this.audio = this._make('AudioEngine', () => new AudioEngine({ bus, settings }));

    /** @type {UiActions} */
    const actions = {
      hasSave: () => this.hasSave(),
      newGame: () => { this.newGame(); },
      continueGame: () => { this.continueGame(); },
      startBoss: (bossId) => { this.screens.toBoss(bossId); },
      retry: () => { this.screens.retry(); },
      toTown: () => { this.screens.toTown(); },
      resume: () => { if (this.ui && this.ui.activePanel === 'pause') this.ui.closePanel(); },
      quitToTitle: () => { this.screens.quitToTitle(); },
      applySettings: (partial) => this.applySettings(partial),
    };
    // UI의 keydown 리스너가 입력 수집보다 먼저 등록돼야 한다(§10.1 — UI가 처리한 키는 defaultPrevented)
    this.ui = /** @type {UIRoot} */ (this._make('UIRoot', () => new UIRoot({ root, bus, sim, progression, settings, actions })));
    this.input = new InputCollector(canvas, settings);

    this.screens = new ScreenMachine({
      bus,
      sim,
      ui: this.ui ?? NULL_UI,
      cameraRig: this.cameraRig,
      flushSave: () => this._flushSave(true),
      settle: () => this._settleFrames(),
      onError: (where, e) => this.reportError(where, e),
    });
    /** 전환의 settle을 기다리는 쪽 — 렌더한 프레임마다 left를 줄인다 @type {{left:number, finish:()=>void}[]} */
    this._settling = [];
    this.stepper = new FixedStepper();
    this.loop = new FrameLoop(win, (frameDt) => this.frame(frameDt));

    this.timeScale = 1;
    /** @type {{decide:(state:any)=>InputFrame, reset:()=>void}|null} 봇 조종(켜져 있으면 실제 입력 대신 쓴다) */
    this.bot = null;
    /** @type {{holds:Object, edges:Object}|null} __ashen.setInput의 덮어쓰기 */
    this._override = null;
    this._saveDirty = false;
    this._savedOnce = false;
    /** 저장 실패 뒤 다시 써 볼 시각(performance.now 기준 ms, 0 = 없음) · 실패 알림을 이미 띄웠는가 */
    this._saveRetryAt = 0;
    this._saveWarned = false;
    /** 창이 포커스를 잃은 채인가(blur ~ focus) — 소리를 재우는 판정에 쓴다 */
    this._unfocused = false;
    /** 렌더러를 만들지 못했다(WebGL2 없음) — 안내만 띄우고 게임은 시작하지 않는다 */
    this.fatal = !this.rc;
    this._simFault = false;
    /** 예외를 내 꺼 둔 레이어 @type {Set<string>} */
    this._dead = new Set();
    /** 부팅 표식(<html data-game-ready>)을 이미 붙였는가 */
    this._bootMarked = false;

    this._wire();
    debugApi.install(win, this);
  }

  /**
   * sim.enterTown()(레이어가 받는 첫 MODE_CHANGED — 화면은 아직 boot라 저장하지 않는다)
   * → 타이틀(또는 디버그 쿼리가 고른 화면) → 루프 시작.
   * @returns {Game}
   */
  start() {
    const q = this.query;
    if (this.fatal) {
      // 검은 화면에 타이틀 · HUD만 뜨는 대신 이유를 알린다. 루프도 타이틀도 시작하지 않는다(그릴 것이 없다).
      this._showFatal(t('fatal.webgl.title'), t('fatal.webgl.body'));
      this._markBoot('gameError', 'webgl');
      return this;
    }
    // 타이틀의 환경 안내: 저장할 수 없는 브라우저 · 터치만 있는 기기
    const notes = [];
    if (!this.ephemeral && !storage.canPersist()) notes.push('panel.title.noStorage');
    if (isTouchOnly(this.window)) notes.push('panel.title.needInput');
    this._try('titleNotes', () => this.ui?.setTitleNotes(notes));
    this._try('enterTown', () => this.sim.enterTown());
    if (q.god) this.sim.setDebug({ godMode: true });
    if (q.bot) this.setBot(true);
    if (q.boss) this.screens.toBoss(q.boss, { instant: true });
    else if (this.skipTitle) this.screens.toTown({ instant: true });
    else {
      this.screens.showTitle({ saveBroken: this.loaded.broken });
      this._try('fade', () => {
        this.ui?.fade(true, 0);
        this.ui?.fade(false, BOOT_FADE_IN);
      });
    }
    if (q.panel && this.ui) {
      if (q.panel === 'pause') this.screens.openPause();
      else this._try('openPanel', () => this.ui.openPanel(q.panel));
    }
    this.loop.start();
    return this;
  }

  // ───────────────────────── 화면 · 설정 명령 ─────────────────────────

  /** 「이어하기」를 켤 세이브가 있는가(부팅 때 읽었거나 이 세션에서 한 번이라도 썼다). @returns {boolean} */
  hasSave() {
    return !this.ephemeral && (this.loaded.save !== null || this._savedOnce);
  }

  /**
   * 새 게임: 같은 profile 객체를 유지한 채 내용만 갈아 끼운다(sim · progression이 참조를 쥐고 있다)
   * → PROFILE_CHANGED{reset} → town 전이. 첫 저장은 그 전이의 MODE_CHANGED에서 일어난다.
   * @returns {Promise<boolean>}
   */
  newGame() {
    if (this.screens.busy) return Promise.resolve(false);
    // 기존 진행을 덮기 직전에 원문을 백업 키에 남긴다(잘못 누른 새 게임을 되돌릴 마지막 수단)
    if (!this.ephemeral) storage.backupSave();
    Object.assign(this.profile, createNewProfile(this._newSeed()));
    this.bus.emit(EV.PROFILE_CHANGED, { reason: 'reset' });
    return this.screens.toTown({ forfeit: false });
  }

  /** 이어하기: 부팅 때 읽은 profile 그대로 town 전이. @returns {Promise<boolean>} */
  continueGame() {
    return this.screens.toTown({ forfeit: false });
  }

  /**
   * 설정 변경. settings 객체를 **동기적으로** 고친다(UI가 직후에 같은 객체를 다시 읽는다 — §10.1).
   * @param {Partial<Settings>} partial
   */
  applySettings(partial) {
    const before = this.settings.quality;
    Object.assign(this.settings, sanitizeSettings({ ...this.settings, ...(partial || {}) }));
    if (this.settings.quality !== before) this._try('setQuality', () => this.rc?.setQuality(this.settings.quality));
    this.bus.emit(EV.SETTINGS_CHANGED, { settings: this.settings });
    storage.writeSettings(this.settings); // 화면과 무관하게 쓴다(프로필과 다른 키)
  }

  // ───────────────────────── 프레임 ─────────────────────────

  /**
   * 한 렌더 프레임(§11.1): 누산 루프 → 카메라 → 레이어 → 오디오 → UI → 렌더 → 저장.
   * @param {number} frameDt 직전 프레임부터의 경과(초)
   */
  frame(frameDt) {
    this._try('gamepad', () => this.input.pollGamepad(frameDt));
    const sc = this.screens;
    const live = sc.isLive();
    if (live && !sc.paused && !this._simFault) {
      try {
        this.stepper.advance(frameDt, this.timeScale, () => this.sim.step(DT, this._tickInput(false)));
      } catch (e) {
        // sim이 던지면 같은 틱을 되풀이해 던질 뿐이다 — 다음 모드 전환까지 틱을 멈추고 화면은 계속 그린다
        this._simFault = true;
        this.stepper.reset();
        this.reportError('sim.step', e);
      }
    }
    // 일시정지: 렌더는 계속하되 레이어에 dt = 0(§5.3). 타이틀은 틱 없이 배경만 살아 있다.
    const dt = sc.paused ? 0 : Math.min(Math.max(0, frameDt), MAX_FRAME_DT) * (live ? this.timeScale : 1);
    this.renderFrame(dt, this.stepper.alpha);
  }

  /**
   * 레이어 update + 렌더 + (밀린) 저장.
   * @param {number} dt 레이어에 넘기는 시간(초, 일시정지면 0)
   * @param {number} alpha 보간 계수
   */
  renderFrame(dt, alpha) {
    this._updateLayers(dt, alpha, this._look(dt));
    this._layer('render', this.rc, () => this.rc.render(dt));
    // 첫 화면이 실제로 그려졌을 때만(렌더가 던져 꺼졌으면 붙이지 않는다)
    if (!this._bootMarked && !this._dead.has('render')) {
      this._bootMarked = true;
      this._markBoot('gameReady', '1');
    }
    if (this._settling.length) {
      for (const w of this._settling.slice()) if (--w.left <= 0) w.finish();
    }
    this._flushSave();
  }

  /**
   * 새 화면이 SETTLE_FRAMES 프레임 그려질 때까지 기다린다(화면 전환이 막을 걷기 전에 — screens._transition).
   * 프레임이 돌지 않으면 SETTLE_MAX_MS 뒤에 풀린다. 던지지 않는다.
   * @returns {Promise<void>}
   */
  _settleFrames() {
    return new Promise((resolve) => {
      const waiter = { left: SETTLE_FRAMES, finish: () => {} };
      let seen = waiter.left;
      const onTimeout = () => {
        // 시한 사이에 프레임이 그려졌으면 루프는 돌고 있다 — 긴 컴파일 프레임이 시한을 넘긴 것이니 남은 프레임을 한 번 더 기다린다.
        // 한 프레임도 없었으면(숨은 탭) 그냥 걷는다. 연장은 진척이 있을 때만이라 최대 SETTLE_FRAMES × SETTLE_MAX_MS다.
        if (waiter.left < seen && waiter.left > 0) {
          seen = waiter.left;
          timer = this.window.setTimeout(onTimeout, SETTLE_MAX_MS);
        } else {
          waiter.finish();
        }
      };
      let timer = this.window.setTimeout(onTimeout, SETTLE_MAX_MS);
      waiter.finish = () => {
        const i = this._settling.indexOf(waiter);
        if (i < 0) return;
        this._settling.splice(i, 1);
        this.window.clearTimeout(timer);
        resolve();
      };
      this._settling.push(waiter);
    });
  }

  /**
   * 디버그: n틱 수동 진행 뒤 레이어 update + 렌더(§11.5 step). 일시정지 여부와 무관하게 돈다.
   * 긴 진행은 중간중간 레이어를 갱신한다(연출 이벤트가 한 프레임에 몰리지 않게) — 렌더는 끝에 한 번.
   * @param {number} [n]
   * @param {Partial<InputFrame>} [input] 주면 그 n틱의 입력(에지 *Pressed는 첫 틱에만)
   * @returns {number} sim.state.tick
   */
  debugStep(n = 1, input) {
    const count = Math.max(0, Math.min(STEP_MAX, Math.floor(Number(n) || 0)));
    const stride = Math.max(1, Math.ceil(count / STEP_LAYER_UPDATES));
    const first = input ? makeInput(input) : null;
    const rest = first ? holdsOnly(first) : null;
    let pending = 0;
    for (let i = 0; i < count; i++) {
      this.sim.step(DT, first ? (i === 0 ? first : rest) : this._tickInput(true));
      pending += 1;
      if (pending >= stride && i < count - 1) {
        this._updateLayers(pending * DT, 1, NO_LOOK);
        pending = 0;
      }
    }
    this.renderFrame(pending * DT, 1);
    return this.sim.state.tick;
  }

  // ───────────────────────── 디버그 조종 ─────────────────────────

  /** @param {boolean} on @param {Object} [opts] createBot 옵션 @returns {boolean} */
  setBot(on, opts) {
    this.bot = on ? createBot(opts || {}) : null;
    return !!this.bot;
  }

  /** @param {Partial<InputFrame>|null} partial null이면 덮어쓰기를 지운다 */
  setInputOverride(partial) {
    if (!partial) {
      this._override = null;
      return;
    }
    const ov = this._override ?? { holds: {}, edges: {} };
    for (const key of Object.keys(partial)) {
      if (key.endsWith('Pressed')) ov.edges[key] = !!partial[key];
      else ov.holds[key] = partial[key];
    }
    this._override = ov;
  }

  /** 패널 없는 일시정지(자동화용). 끌 때는 열려 있는 pause 패널도 닫는다. @param {boolean} on */
  debugPause(on) {
    if (on) {
      this.screens.setPaused(true);
    } else if (this.ui && this.ui.activePanel === 'pause') {
      this.ui.closePanel(); // UI_CLOSED{pause} → paused = false
    } else {
      this.screens.setPaused(false);
      this._resyncClock();
    }
    return this.screens.paused;
  }

  /** 예외를 기록한다(콘솔 + __ashen.errors()). @param {string} where @param {unknown} e */
  reportError(where, e) {
    console.error(`[ashen] ${where}`, e);
    const text = e && typeof e === 'object' && 'stack' in e ? String(e.stack) : String(e);
    this.errors.push(`${where}: ${text}`);
  }

  dispose() {
    this.loop.stop();
    for (const off of this._offs) off();
    this._offs.length = 0;
    this.input.dispose();
    for (const part of [this.ui, this.audio, this.fx, this.characters, this.cameraRig, this.world, this.rc, this.sim]) {
      this._try('dispose', () => part && part.dispose && part.dispose());
    }
  }

  // ───────────────────────── 내부: 배선 ─────────────────────────

  _wire() {
    const { bus, screens, input } = this;
    const win = this.window;
    const doc = this.document;
    /** @type {(()=>void)[]} */
    const offs = [];
    this._offs = offs;

    // ── 입력 수집의 콜백
    input.handlers = {
      isBlocking: () => !!this.ui && this.ui.isBlocking(),
      onGesture: () => this._try('audio.unlock', () => this.audio?.unlock()),
      onLockChange: (locked, info) => {
        this.ui?.setPointerLocked(locked, this.input.dragMode);
        // 락 상실(포인터 락 중의 Esc는 브라우저에 따라 keydown 없이 이 길로만 온다)
        if (info.lost && this.autoPause) screens.openPause();
      },
      onEscape: (fromPad) => screens.escape(fromPad),
      onNavigate: (dx, dy) => this.ui?.navigate(dx, dy),
      onConfirm: () => this.ui?.confirm(),
      onCancel: () => this.ui?.cancel(),
      // 쓰던 게임패드가 끊겼다(배터리 · 블루투스): 보스전이면 멈춘다 — 선 채로 맞아 죽지 않게
      onPadLost: () => {
        this._try('notice', () => this.ui?.setNotice('pad', t('hud.notice.padLost'), PAD_NOTICE_HOLD));
        if (this.autoPause) screens.pauseIfFighting();
      },
    };

    // ── 화면
    offs.push(bus.on(EV.INTERACT, ({ id }) => {
      if (screens.screen === 'town' && !screens.busy && this.ui && !this.ui.isBlocking()) this.ui.openPanel(id);
    }));
    offs.push(bus.on(EV.FIGHT_ENDED, (p) => screens.onFightEnded(p)));
    offs.push(bus.on(EV.UI_OPENED, () => input.exitLock()));
    offs.push(bus.on(EV.UI_CLOSED, ({ panel }) => {
      input.notifyUiClosed();
      const wasPaused = screens.paused;
      screens.onUiClosed(panel);
      if (wasPaused && !screens.paused) this._resyncClock();
      // 패널이 교체되는 중일 수 있다(UI_CLOSED → UI_OPENED) — 이번 호출이 끝난 뒤에도 패널이 없을 때만 락을 다시 청한다
      Promise.resolve().then(() => {
        if (screens.isLive() && this.ui && !this.ui.isBlocking()) input.requestLock();
      });
    }));
    offs.push(bus.on(EV.MODE_CHANGED, () => {
      this._simFault = false;
      this.stepper.reset();
      this._markDirty();
    }));
    // 화면이 바뀐 직후의 에지는 버린다 — 패널을 넘기던 E · R 연타가 도착한 화면의 상호작용 · 플라스크가 되지 않게
    offs.push(bus.on(EV.SCREEN_CHANGED, () => input.notifyScreenChanged()));

    // ── 저장 시점(§11.4): 더티 플래그만 세우고 프레임 끝에 한 번 쓴다
    offs.push(bus.on(EV.PROFILE_CHANGED, () => this._markDirty()));
    offs.push(bus.on(EV.REWARD_GRANTED, () => this._markDirty()));

    // ── 창 포커스 · 이탈
    const on = (target, type, fn) => {
      target.addEventListener(type, fn);
      offs.push(() => target.removeEventListener(type, fn));
    };
    on(win, 'blur', () => {
      this._unfocused = true;
      this._focusLost();
    });
    on(win, 'focus', () => {
      this._unfocused = false;
      this._focusBack();
    });
    on(doc, 'visibilitychange', () => (doc.visibilityState === 'hidden' ? this._focusLost() : this._focusBack()));
    on(win, 'pagehide', () => this._flushSave(true));
    // WebGL 컨텍스트 로스트(GPU 드라이버 리셋 · 절전 복귀): 화면이 멈춘 동안 보스가 때리지 않게 멈추고 알린다.
    // 복구는 three가 한다(restored 뒤 다시 그린다) — 여기서는 시계만 다시 잡는다.
    on(this.canvas, 'webglcontextlost', (e) => {
      e.preventDefault(); // 기본 동작을 막아야 브라우저가 컨텍스트를 되살린다
      this._try('notice', () => this.ui?.setNotice('webgl', t('hud.notice.contextLost')));
      if (this.autoPause) screens.openPause();
    });
    on(this.canvas, 'webglcontextrestored', () => {
      this._try('notice', () => this.ui?.setNotice('webgl', null));
      this._resyncClock();
    });
    on(win, 'beforeunload', (e) => {
      this._flushSave(true);
      // 교전 중에만 이탈을 확인한다(마우스 뒤로 가기 · 탭 닫기로 그 판이 통째로 사라지지 않게)
      if (screens.isFighting() && this.autoPause) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  /** 창 포커스 잃음(blur · 탭 숨김): 홀드를 놓고, 소리를 멈추고, 보스전이면 일시정지. */
  _focusLost() {
    this.input.releaseAll();
    this._try('audio.setPaused', () => this.audio?.setPaused(true));
    if (this.autoPause) this.screens.focusLost();
    this._syncAudioSuspend();
    this._flushSave(true);
  }

  /** 복귀: 소리는 일시정지 상태를 따르고, 루프는 지금부터 다시 잰다(돌아온 프레임에 틱이 몰아 돌지 않게). */
  _focusBack() {
    // 탭이 다시 보여도 창이 아직 포커스 밖이면(visibilitychange만 온 경우) 「포커스 없음」은 그대로 둔다
    if (!this._unfocused) this.screens.focusBack();
    this._try('audio.setPaused', () => this.audio?.setPaused(this.screens.paused));
    this._syncAudioSuspend();
    this._resyncClock();
  }

  /**
   * 탭이 숨었거나 창이 포커스를 잃었으면 AudioContext를 재운다 — 덕킹만으로는 낮은 드론이 계속 난다(§11.2
   * 「숨은 탭에서 소리가 나지 않는다」). 돌아오면 깨운다. 예외 하나: 창은 보이는데 포커스만 없고 보스전이 멈추지 않은 채
   * 돌고 있으면(?nopause · 일회용 세션) 재우지 않는다 — 멈춘 시계에 효과음이 쌓였다가 돌아올 때 한꺼번에 터진다.
   */
  _syncAudioSuspend() {
    const ctx = this.audio && this.audio.ctx;
    if (!ctx || typeof ctx.suspend !== 'function') return;
    const hidden = this.document.visibilityState === 'hidden';
    const sc = this.screens;
    const fightRunning = sc.isLive() && !sc.paused && this.sim.state.mode === 'boss';
    const sleep = hidden || (this._unfocused && !fightRunning);
    this._try('audio.suspend', () => {
      let p = null;
      if (sleep && ctx.state === 'running') p = ctx.suspend();
      else if (!sleep && ctx.state === 'suspended') p = ctx.resume();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    });
  }

  _resyncClock() {
    this.loop.resetClock();
    this.stepper.reset();
  }

  // ───────────────────────── 내부: 입력 ─────────────────────────

  /**
   * 한 틱의 입력. 우선순위: setInput 덮어쓰기 > 봇 > 실제 입력. 패널이 열려 있으면 NEUTRAL(§10.4).
   * @param {boolean} manual debugStep에서 불렸는가(패널이 열려 있어도 봇 · 덮어쓰기는 통한다 — 자동화가 pause 위에서도 돈다)
   * @returns {InputFrame}
   */
  _tickInput(manual) {
    const blocking = !!this.ui && this.ui.isBlocking();
    // 실제 입력은 항상 비운다(봇이 조종하는 동안 쌓인 에지가 나중에 터지지 않게)
    let frame = this.input.consume(this.cameraRig ? this.cameraRig.yaw : 0);
    if (blocking && !manual) return frame;
    if (this.bot) frame = this.bot.decide(this.sim.state);
    const ov = this._override;
    if (ov) {
      frame = { ...frame, ...ov.holds, ...ov.edges };
      ov.edges = {}; // 에지는 한 틱만
    }
    return frame;
  }

  /** 이번 프레임의 카메라 입력. 패널 · 일시정지 중에는 0, 타이틀에서는 천천히 돈다. @param {number} dt */
  _look(dt) {
    const look = this.input.consumeLook();
    if (this.screens.screen === 'title') {
      const sens = CAMERA.rotSpeed * (this.settings.mouseSensitivity || 1);
      return { dx: (-TITLE_ORBIT_SPEED * dt) / sens, dy: 0 };
    }
    if (this.screens.paused || (this.ui && this.ui.isBlocking())) return NO_LOOK;
    return look;
  }

  // ───────────────────────── 내부: 레이어 ─────────────────────────

  /** @param {number} dt @param {number} alpha @param {{dx:number, dy:number}} look */
  _updateLayers(dt, alpha, look) {
    const state = this.sim.state;
    this._layer('CameraRig', this.cameraRig, () => this.cameraRig.update(state, alpha, dt, look));
    this._layer('WorldLayer', this.world, () => this.world.update(state, alpha, dt));
    this._layer('CharacterLayer', this.characters, () => this.characters.update(state, alpha, dt));
    this._layer('FxLayer', this.fx, () => this.fx.update(state, alpha, dt));
    this._layer('AudioEngine', this.audio, () => this.audio.update(state, dt));
    this._layer('UIRoot', this.ui, () => this.ui.update(state, dt));
  }

  /** 만들다 던지면 기록하고 null(그 레이어 없이 돈다). @template T @param {string} label @param {()=>T} make @returns {T|null} */
  _make(label, make) {
    try {
      return make();
    } catch (e) {
      this.reportError(`${label} 생성`, e);
      return null;
    }
  }

  /** 매 프레임 부르는 것: 한 번 던진 레이어는 기록하고 끈다(나머지는 계속 돈다). */
  _layer(label, target, fn) {
    if (!target || this._dead.has(label)) return;
    try {
      fn();
    } catch (e) {
      this._dead.add(label);
      this.reportError(`${label} — 이 레이어를 끈다`, e);
    }
  }

  /** 한 번 부르는 것: 던져도 기록만 하고 계속한다. @param {string} where @param {()=>void} fn */
  _try(where, fn) {
    try {
      fn();
    } catch (e) {
      this.reportError(where, e);
    }
  }

  // ───────────────────────── 내부: 저장 ─────────────────────────

  _markDirty() {
    // boot · title에서는 어떤 이벤트에도 쓰지 않는다 — 타이틀 배경용 enterTown()이 빈 프로필을 저장해
    // 「이어하기」가 켜지거나, 읽지 못한 세이브를 사용자 조작 없이 덮는 일이 없다.
    if (!this.ephemeral && this.screens.canSave()) this._saveDirty = true;
  }

  /**
   * 밀린 저장을 쓴다. 실패하면(저장소가 막힘 · 용량 초과) 한 번 알리고 SAVE_RETRY초 뒤에 다시 써 본다 —
   * 조용히 잃지 않는다. force면 재시도 시각을 기다리지 않는다(창을 떠날 때).
   * @param {boolean} [force]
   */
  _flushSave(force = false) {
    if (!this._saveDirty) {
      if (!this._saveRetryAt) return;
      if (!force && this.window.performance.now() < this._saveRetryAt) return;
    }
    this._saveDirty = false;
    this._saveRetryAt = 0;
    if (this.ephemeral || !this.screens.canSave()) return;
    if (storage.writeSave(this.profile)) {
      this._savedOnce = true;
      this.bus.emit(EV.SAVED, {});
      if (this._saveWarned) this._try('notice', () => this.ui?.setNotice('save', null));
    } else {
      this._saveRetryAt = this.window.performance.now() + SAVE_RETRY * 1000;
      if (!this._saveWarned) {
        this._saveWarned = true;
        this._try('notice', () => this.ui?.setNotice('save', t('hud.notice.saveFailed'), NOTICE_HOLD));
      }
    }
  }

  /** 게임을 띄울 수 없을 때의 안내(UI가 없으면 #ui-root에 직접 쓴다). @param {string} title @param {string} body */
  _showFatal(title, body) {
    if (this.ui && typeof this.ui.showFatal === 'function') {
      this._try('showFatal', () => this.ui.showFatal(title, body));
      return;
    }
    const box = this.document.createElement('div');
    box.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:2em;'
      + 'color:#e9e2d4;font:16px/1.6 system-ui,sans-serif;text-align:center;';
    box.textContent = title + ' — ' + body;
    this.root.appendChild(box);
  }

  /**
   * 부팅 표식(리포 규칙): <html data-game-ready="1"> 또는 data-game-error="<사유>" — `npm run check:dist`가 읽는다.
   * @param {'gameReady'|'gameError'} key @param {string} value
   */
  _markBoot(key, value) {
    const el = this.document.documentElement;
    if (el && el.dataset) el.dataset[key] = value;
  }

  /** 새 프로필의 시드. sim은 시계 · Math.random을 쓰지 않는다 — app에서만 만든다. @returns {number} uint32 */
  _newSeed() {
    if (this.ephemeral) return DEV_SEED;
    return (Date.now() ^ (Math.random() * 2 ** 32)) >>> 0;
  }
}

/** 에지(*Pressed)를 뺀 입력(홀드만). @param {InputFrame} frame @returns {InputFrame} */
function holdsOnly(frame) {
  return makeInput({
    moveX: frame.moveX,
    moveZ: frame.moveZ,
    sprint: frame.sprint,
    guard: frame.guard,
    heavyHeld: frame.heavyHeld,
  });
}

/** UIRoot가 만들어지지 못했을 때의 자리 표시(화면 기계가 던지지 않게). */
const NULL_UI = {
  activePanel: null,
  openPanel() {},
  closePanel() {},
  isBlocking: () => false,
  canClose: () => false,
  fade: () => Promise.resolve(),
};
