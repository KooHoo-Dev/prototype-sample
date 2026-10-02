// OWNER: P8 — 계약 §10.1
// DOM은 전부 deps.root(#ui-root) 아래에 만든다. 상태 변경은 progression의 명령 · actions · sim.restAtBonfire()로만 한다.
// 패널을 여는 것은 app뿐이다. Esc 키는 app만 듣는다(UI는 Esc를 직접 처리하지 않는다).
import './styles.css';
import { EV } from '../core/events.js';
import { PANEL_IDS, FACILITY_IDS } from '../core/constants.js';
import { el, add } from './dom.js';
import { Hud } from './hud.js';
import { TitlePanel } from './panels/titlePanel.js';
import { PausePanel } from './panels/pausePanel.js';
import { BonfirePanel } from './panels/bonfirePanel.js';
import { BlacksmithPanel } from './panels/blacksmithPanel.js';
import { MerchantPanel } from './panels/merchantPanel.js';
import { GatePanel } from './panels/gatePanel.js';
import { ResultPanel } from './panels/resultPanel.js';

/** @typedef {import('../types.js').GameState} GameState */
/** @typedef {import('../types.js').Settings} Settings */
/** @typedef {import('../types.js').UiActions} UiActions */
/** @typedef {import('../types.js').PanelId} PanelId */

/** 패널이 열린 뒤 이 시간 동안은 키 · 클릭 · navigate/confirm/cancel을 받지 않는다(초). */
const PANEL_INPUT_DELAY = 0.25;
/** 결과 패널은 더 길다 — 죽는 순간 연타하던 R이 곧바로 재도전이 되지 않게. */
const RESULT_INPUT_DELAY = 0.5;

const PANEL_CLASSES = {
  title: TitlePanel,
  pause: PausePanel,
  bonfire: BonfirePanel,
  blacksmith: BlacksmithPanel,
  merchant: MerchantPanel,
  gate: GatePanel,
  result: ResultPanel,
};

/** §10.1 「패널 키 조작」 — KeyboardEvent.code → [dx, dy] | 'confirm' | 'cancel' */
const KEY_NAV = {
  KeyW: [0, -1], ArrowUp: [0, -1],
  KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
  KeyE: 'confirm', Enter: 'confirm', NumpadEnter: 'confirm', Space: 'confirm',
  KeyQ: 'cancel',
};

const now = () => performance.now();

export class UIRoot {
  /**
   * @param {{root:HTMLElement, bus:import('../core/events.js').EventBus,
   *          sim:import('../sim/GameSim.js').GameSim,
   *          progression:import('../sim/progression/Progression.js').Progression,
   *          settings:Settings, actions:UiActions}} deps
   */
  constructor(deps) {
    this.deps = deps;
    this.bus = deps.bus;
    /** @type {import('./panels/panelBase.js').Panel|null} */
    this._panel = null;
    /** @type {PanelId|null} */
    this._active = null;
    this._openedAt = 0;
    this._inputDelay = 0;
    this._pointerLocked = false;
    this._dragMode = false;
    /** 세션 동안 패널이 기억하는 것(화톳불의 마지막 능력치 등) */
    this._memory = {};
    this._fadeTimer = 0;
    /** @type {(()=>void)|null} */
    this._fadeResolve = null;

    const root = deps.root;
    this._root = root;
    root.classList.add('ac-ui');
    this.hud = new Hud({ parent: root, bus: deps.bus });
    // 패널 배경: 패널이 열렸을 때만 클릭을 받는다(§10.5 클릭 통과 규칙)
    this._layer = el('div', 'ac-panel-layer');
    this._layer.addEventListener('contextmenu', (e) => e.preventDefault());
    // 알림 줄(저장 불가 · 그래픽 장치 끊김 · 게임패드 끊김): 패널 배경 위, 전환 막 아래. 클릭을 받지 않는다.
    this._notices = el('div', 'ac-notices');
    /** @type {Map<string, {el:HTMLElement, timer:number}>} */
    this._noticeItems = new Map();
    this._fade = el('div', 'ac-fade');
    add(root, this._layer, this._notices, this._fade);
    /** @type {HTMLElement|null} */
    this._fatal = null;

    this._onKeyDown = this._onKeyDown.bind(this);
    window.addEventListener('keydown', this._onKeyDown);
    // 마우스 좌표를 늘 기억해 둔다 — 패널의 hover가 「실제로 움직인 마우스」만 따르게(panelBase.item)
    this._mouseX = NaN;
    this._mouseY = NaN;
    this._mouseMoved = false;
    this._onMouseMove = (e) => {
      this._mouseMoved = e.clientX !== this._mouseX || e.clientY !== this._mouseY;
      this._mouseX = e.clientX;
      this._mouseY = e.clientY;
    };
    window.addEventListener('mousemove', this._onMouseMove, true);
    this._offs = [
      this.bus.on(EV.PROFILE_CHANGED, () => this._panel?.render()),
      this.bus.on(EV.SETTINGS_CHANGED, () => this._panel?.onSettings()),
    ];
  }

  /** HUD 갱신(매 렌더 프레임. 값이 바뀔 때만 DOM을 건드린다). @param {GameState} state @param {number} dt */
  update(state, dt) {
    this.hud.update(state, dt, this._active, this._pointerLocked, this._dragMode);
  }

  /**
   * id ∈ PANEL_IDS. 이미 열린 패널은 닫고 연다. UI_OPENED {panel, blocking:true}.
   * 예외: id === 'pause'는 다른 패널이 열려 있으면 무시한다(result · 시설 패널을 닫지 않는다).
   * @param {PanelId} id
   * @param {Object} [params] title: {saveBroken} · result: {reward, outcome, duration}
   */
  openPanel(id, params) {
    if (!PANEL_IDS.includes(id)) {
      console.warn(`[ui] unknown panel: ${id}`);
      return;
    }
    if (id === 'pause' && this._active !== null) return;
    if (this._active !== null) this.closePanel();

    const PanelClass = PANEL_CLASSES[id];
    this._active = id;
    this._openedAt = now();
    this._inputDelay = (id === 'result' ? RESULT_INPUT_DELAY : PANEL_INPUT_DELAY) * 1000;
    const panel = new PanelClass({
      id,
      params: params ?? {},
      deps: this.deps,
      memory: this._memory,
      ready: () => this._inputReady(),
      pointerMoved: () => this._mouseMoved,
      sound: (kind) => this.bus.emit(EV.UI_SOUND, { kind }),
      close: () => this.closePanel(),
    });
    this._panel = panel;
    this._layer.className = `ac-panel-layer ac-open ac-layer-${id}`;
    this._layer.appendChild(panel.el);
    panel.open();
    this.bus.emit(EV.UI_OPENED, { panel: id, blocking: true });
  }

  /** UI_CLOSED {panel}. */
  closePanel() {
    const id = this._active;
    if (id === null) return;
    const panel = this._panel;
    this._active = null;
    this._panel = null;
    panel?.destroy();
    this._layer.className = 'ac-panel-layer';
    this.bus.emit(EV.UI_CLOSED, { panel: id });
  }

  /** @returns {PanelId|null} 열린 패널 */
  get activePanel() {
    return this._active;
  }

  /** 패널이 열려 있으면 true(전부 블로킹). @returns {boolean} */
  isBlocking() {
    return this._active !== null;
  }

  /** Esc로 닫을 수 있는 패널인가 — 시설 패널 4종만 true(title · result · pause는 false). @returns {boolean} */
  canClose() {
    return this._active !== null && FACILITY_IDS.includes(this._active);
  }

  /**
   * 패널 포커스 이동. dy: −1 위 / +1 아래, dx: −1 왼쪽 / +1 오른쪽(탭 · 슬라이더 · 유물 칸).
   * @param {number} dx @param {number} dy
   */
  navigate(dx, dy) {
    if (!this._panel || !this._inputReady()) return;
    this._panel.navigate(dx, dy);
  }

  /** 포커스된 항목 실행(= 그 버튼 클릭). */
  confirm() {
    if (!this._panel || !this._inputReady()) return;
    this._panel.confirm();
  }

  /** 시설 패널: 닫기 / pause: actions.resume() / result: actions.toTown() / title: 없음. */
  cancel() {
    if (!this._panel || !this._inputReady()) return;
    this._panel.cancel();
  }

  /**
   * app이 포인터 락 상태를 알린다(HUD의 「클릭하면 시점 고정」 안내용).
   * @param {boolean} locked
   * @param {boolean} [dragMode] 락 요청이 실패해 드래그로 시점을 돌리는 환경인가(안내 문구가 바뀌고 잠깐 뒤 사라진다)
   */
  setPointerLocked(locked, dragMode = false) {
    this._pointerLocked = !!locked;
    this._dragMode = !!dragMode && !locked;
  }

  /** @param {boolean} visible */
  setHudVisible(visible) {
    this.hud.setVisible(visible);
  }

  /**
   * 화면 아래 가운데의 알림 한 줄(app이 띄운다 — 저장 실패 · 그래픽 장치 끊김 · 게임패드 끊김). 패널이 열려 있어도 보인다.
   * @param {string} id 알림의 이름(같은 이름은 한 줄을 갈아 끼운다)
   * @param {string|null} text null이면 지운다
   * @param {number} [hold] 초. 지나면 스스로 사라진다(0 = 지울 때까지)
   */
  setNotice(id, text, hold = 0) {
    const cur = this._noticeItems.get(id);
    if (cur) {
      clearTimeout(cur.timer);
      cur.el.remove();
      this._noticeItems.delete(id);
    }
    if (text === null || text === undefined || text === '') return;
    const node = el('div', 'ac-notice', text);
    const timer = hold > 0 ? setTimeout(() => this.setNotice(id, null), hold * 1000) : 0;
    this._noticeItems.set(id, { el: node, timer });
    this._notices.appendChild(node);
  }

  /**
   * 타이틀 패널에 덧붙일 환경 안내의 문자열 키(저장할 수 없는 브라우저 · 터치만 있는 기기). 타이틀이 열릴 때마다 보인다.
   * @param {string[]} keys
   */
  setTitleNotes(keys) {
    this._memory.titleNotes = Array.isArray(keys) ? keys.slice() : [];
    if (this._active === 'title') this._panel?.render();
  }

  /**
   * 게임을 띄울 수 없다(WebGL2 없음): 화면 가운데에 안내만 남기고 HUD · 패널을 치운다.
   * @param {string} title
   * @param {string} body
   */
  showFatal(title, body) {
    this.closePanel();
    this.hud.el.classList.add('ac-hidden');
    if (this._fatal) this._fatal.remove();
    this._fatal = add(el('div', 'ac-fatal'),
      add(el('div', 'ac-fatal-box'), el('h2', 'ac-heading', title), el('p', 'ac-fatal-body', body)));
    this._root.appendChild(this._fatal);
  }

  /**
   * 전체 화면 검은 막(전환용). 막이 불투명해지는 동안과 불투명한 동안에만 클릭을 막는다.
   * @param {boolean} toOpaque
   * @param {number} dur 초
   * @returns {Promise<void>}
   */
  fade(toOpaque, dur) {
    // 앞선 페이드가 끝나기 전에 새 페이드가 오면 앞의 약속은 바로 푼다(app의 await가 걸려 있지 않게)
    this._settleFade();
    const ms = Math.max(0, (Number.isFinite(dur) ? dur : 0) * 1000);
    const f = this._fade;
    f.style.transitionDuration = `${ms}ms`;
    f.classList.toggle('ac-block', !!toOpaque);
    void f.offsetWidth;
    f.classList.toggle('ac-opaque', !!toOpaque);
    if (ms === 0) return Promise.resolve();
    return new Promise((resolve) => {
      this._fadeResolve = resolve;
      // transitionend는 숨은 탭에서 오지 않을 수 있다 — 타이머로 끝낸다
      this._fadeTimer = setTimeout(() => this._settleFade(), ms);
    });
  }

  dispose() {
    this.closePanel();
    this._settleFade();
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('mousemove', this._onMouseMove, true);
    for (const off of this._offs) off();
    this._offs.length = 0;
    this.hud.dispose();
    for (const it of this._noticeItems.values()) clearTimeout(it.timer);
    this._noticeItems.clear();
    this._layer.remove();
    this._notices.remove();
    this._fatal?.remove();
    this._fade.remove();
    this._root.classList.remove('ac-ui');
  }

  // ── 내부 ──

  _settleFade() {
    clearTimeout(this._fadeTimer);
    this._fadeTimer = 0;
    const resolve = this._fadeResolve;
    this._fadeResolve = null;
    if (resolve) resolve();
  }

  /** @returns {boolean} 열린 뒤 입력 지연이 지났는가 */
  _inputReady() {
    return this._active !== null && now() - this._openedAt >= this._inputDelay;
  }

  /** 패널이 열려 있을 때만 키를 받는다. 처리한 키에는 preventDefault. @param {KeyboardEvent} e */
  _onKeyDown(e) {
    const panel = this._panel;
    if (!panel) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return; // 브라우저 단축키(Ctrl+R 등)는 건드리지 않는다
    const nav = KEY_NAV[e.code];
    const hot = panel.hotkeys[e.code];
    if (!nav && !hot) return;
    e.preventDefault();
    if (e.repeat || !this._inputReady()) return;
    if (hot) hot();
    else if (nav === 'confirm') panel.confirm();
    else if (nav === 'cancel') panel.cancel();
    else panel.navigate(nav[0], nav[1]);
  }
}
