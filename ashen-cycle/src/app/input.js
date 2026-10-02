// OWNER: P9 — 계약 §11.3
// 입력 수집: 키보드 · 마우스(포인터 락, 못 얻으면 드래그) · 게임패드 → 한 틱분의 InputFrame.
// 키 표는 data/keybinds.js(KEYBINDS · GAMEPAD). Ctrl 조합은 건드리지 않는다.
// 리스너 타깃: mousedown · contextmenu · auxclick · 포인터 락 요청은 canvas, mouseup · mousemove · keydown · keyup · blur는 window.
//   (마우스 옆 버튼 3 · 4만은 패널 위에서도 막아야 해서 window에서 한 번 더 본다.)
// UI와의 약속(§10.1): UI가 처리한 keydown은 defaultPrevented다 — 그 키는 게임의 **에지**(*Pressed)로 받지 않는다.
//   그러려면 UI의 리스너가 먼저 등록돼 있어야 한다(Game이 UIRoot를 InputCollector보다 먼저 만든다).
// 홀드와 에지는 따로 본다: 홀드(_held)는 「지금 물리적으로 눌려 있는가」다 — UI가 처리했든 자동 반복이든 keydown이면 넣고
//   keyup · blur에서 뺀다. 패널이 떠 있는 동안(전환 페이드아웃 0.3초 포함) 누른 W가 패널이 닫힌 뒤에도 눌린 것으로 읽힌다.
//   에지만 「UI가 처리하지 않은 · 반복이 아닌 keydown」에서 선다(결과 패널의 E · R이 상호작용 · 플라스크로 새지 않는다).
import { makeInput, NEUTRAL_INPUT } from '../core/inputFrame.js';
import { localToWorld } from '../core/math2d.js';
import { KEYBINDS, GAMEPAD } from '../data/keybinds.js';
import { CAMERA } from '../data/camera.js';

/** @typedef {import('../types.js').InputFrame} InputFrame */
/** @typedef {import('../types.js').Settings} Settings */

/** 에지를 내는 행동 → InputFrame 필드 */
const EDGE_FIELD = {
  light: 'lightPressed',
  heavy: 'heavyPressed',
  roll: 'rollPressed',
  flask: 'flaskPressed',
  lockOn: 'lockOnPressed',
  interact: 'interactPressed',
};
/** 브라우저 기본 동작(포커스 이동 · 스크롤)을 막는 키 */
const PREVENT_CODES = new Set(['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
/** 락 요청 뒤 이 시간 안에 락을 얻지 못하면 드래그 모드로 본다(초) */
const LOCK_TIMEOUT = 0.5;
/** UI_CLOSED 뒤 이 시간 동안의 에지를 버린다(초) — 패널을 닫은 E · Q · 클릭이 상호작용 · 록온 · 공격으로 새지 않게 */
const EDGE_DISCARD_AFTER_UI = 0.15;
/**
 * 화면이 바뀐 뒤(타이틀/결과 → 마을, 안개문/결과 → 보스전) 이 시간 동안의 에지를 버린다(초) — 막이 걷히는 0.4초 + 여유.
 * 패널을 넘기려고 연타하던 E · R이 도착한 화면의 상호작용(화톳불 → 레벨업) · 플라스크가 되지 않게.
 */
const EDGE_DISCARD_AFTER_SCREEN = 0.5;
/** 그 창 안에서 버려진 에지와 같은 입력이 이 간격 안에 다시 오면 그것도 버린다(초) — 연타가 멎을 때까지 창이 따라간다 */
const EDGE_MASH_GAP = 0.35;
/** mousemove 한 번의 이동량 상한(픽셀)의 바닥 — 실제 상한은 감도에 맞춘 각도(LOOK_EVENT_MAX_ANGLE) 기준이다 */
const LOOK_EVENT_MAX = 300;
/** mousemove 한 번이 돌릴 수 있는 최대 각(rad). 넘는 만큼은 버리지 않고 **자른다**(빠르게 돌릴수록 멈추는 일이 없다) */
const LOOK_EVENT_MAX_ANGLE = Math.PI / 2;
/** 표준 매핑의 D-pad 버튼 인덱스 · 스틱을 방향 입력으로 보는 문턱 */
const PAD_UP = 12;
const PAD_DOWN = 13;
const PAD_LEFT = 14;
const PAD_RIGHT = 15;
const PAD_NAV_THRESHOLD = 0.5;
const PAD_BUTTON_THRESHOLD = 0.5;

/**
 * app이 채우는 콜백 묶음.
 * @typedef {Object} InputHandlers
 * @property {()=>boolean} isBlocking            패널이 열려 있는가(ui.isBlocking)
 * @property {()=>void} onGesture                키 · 클릭 · 패드 버튼(첫 제스처에서 audio.unlock)
 * @property {(locked:boolean, info:{lost:boolean})=>void} onLockChange  락 상태가 바뀌었다(lost = app이 푼 것이 아닌 상실)
 * @property {(fromPad:boolean)=>void} onEscape  Esc · 게임패드 Start
 * @property {(dx:number, dy:number)=>void} onNavigate  패널에서 게임패드 방향
 * @property {()=>void} onConfirm                패널에서 게임패드 A
 * @property {()=>void} onCancel                 패널에서 게임패드 B
 * @property {()=>void} onPadLost                방금까지 쓰던 게임패드가 사라졌다(배터리 · 블루투스 끊김)
 */

export class InputCollector {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {Settings} settings
   */
  constructor(canvas, settings) {
    this.canvas = canvas;
    this.settings = settings;
    const doc = canvas.ownerDocument;
    const win = doc.defaultView;
    this._doc = doc;
    this._win = win;

    /** @type {InputHandlers} */
    this.handlers = {
      isBlocking: () => false,
      onGesture: () => {},
      onLockChange: () => {},
      onEscape: () => {},
      onNavigate: () => {},
      onConfirm: () => {},
      onCancel: () => {},
      onPadLost: () => {},
    };

    /** 코드('KeyW' · 'Mouse0' …) → 행동 이름 @type {Map<string, string>} */
    this._byCode = new Map();
    for (const action of Object.keys(KEYBINDS)) {
      for (const code of KEYBINDS[action]) this._byCode.set(code, action);
    }
    /** 지금 눌려 있는 코드 @type {Set<string>} */
    this._held = new Set();
    /** 아직 틱에 넘기지 않은 에지(InputFrame 필드 이름 → true) @type {Record<string, boolean>} */
    this._edges = {};
    this._lookX = 0;
    this._lookY = 0;
    this._discardUntil = 0;
    /** 화면 전환 뒤의 연타 방지 창이 끝나는 시각 */
    this._mashGuardUntil = 0;
    /** 에지 필드 → 그 입력을 버리는 시각의 끝(연타가 이어지는 동안 밀린다) @type {Record<string, number>} */
    this._mashUntil = {};
    /** 락을 막 얻었다 — 다음 mousemove 한 번은 버린다(락을 얻는 순간의 튐) */
    this._skipLook = false;
    /** 마지막으로 입력을 준 장치(패드를 쓰다 잃었을 때만 onPadLost를 낸다) @type {'kbm'|'pad'} */
    this._lastDevice = 'kbm';

    // 포인터 락
    this._locked = false;
    this._lockFailed = false;   // 사용자의 클릭으로 한 요청이 한 번이라도 실패했는가(→ 락 없는 클릭도 입력으로 낸다)
    this._userRequest = false;  // 마지막 요청이 사용자의 클릭이었는가
    this._selfExit = false;     // app이 스스로 락을 풀었는가(UI_OPENED)
    this._lockTimer = 0;
    this._dragging = false;     // 캔버스에서 시작한 누르기가 이어지는 중인가

    // 게임패드
    this._pad = {
      /** @type {boolean[]} */
      prev: [],
      moveX: 0,
      moveY: 0,
      guard: false,
      heavy: false,
      sprint: false,
      rollHeld: 0,
      /** 패널에서 B(닫기 · 재개)를 누른 채 나왔다 — 뗄 때까지 구르기 탭으로 보지 않는다 */
      rollBlocked: false,
      navKey: '',
      navT: 0,
    };

    this._listeners = [];
    const on = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      this._listeners.push(() => target.removeEventListener(type, fn, opts));
    };
    on(win, 'keydown', (e) => this._onKeyDown(e));
    on(win, 'keyup', (e) => this._onKeyUp(e));
    on(win, 'blur', () => this.releaseAll());
    on(win, 'mouseup', (e) => this._onMouseUp(e));
    on(win, 'mousemove', (e) => this._onMouseMove(e));
    on(canvas, 'mousedown', (e) => this._onMouseDown(e));
    on(canvas, 'contextmenu', (e) => e.preventDefault());
    on(canvas, 'auxclick', (e) => e.preventDefault());
    // 마우스 옆 버튼(뒤로 · 앞으로)은 게임 화면 · 패널 어디서도 막는다
    const blockSide = (e) => {
      if (e.button === 3 || e.button === 4) e.preventDefault();
    };
    on(win, 'mousedown', blockSide, true);
    on(win, 'mouseup', blockSide, true);
    on(win, 'auxclick', blockSide, true);
    // 캔버스 밖(패널 · 전환 막)을 누른 것: 화면 어디를 눌러도 첫 제스처로 세고(오디오 unlock), 버튼의 홀드만 기록한다.
    // 전환 막이 덮인 0.3초 동안 미리 쥔 우클릭(가드)이 막이 걷힌 뒤에도 눌린 것으로 읽힌다. 에지는 내지 않는다.
    on(win, 'mousedown', (e) => this._onWindowMouseDown(e), true);
    on(win, 'pointerup', () => this.handlers.onGesture(), true); // 터치 탭의 활성화 시점
    on(doc, 'pointerlockchange', () => this._onLockChange());
    on(doc, 'pointerlockerror', () => this._onLockError());
  }

  // ───────────────────────── 공개 ─────────────────────────

  /**
   * 한 틱분의 입력. 에지(*Pressed)는 한 번 반환하면 지운다(한 프레임에 틱이 여러 번이면 첫 틱만 받는다.
   * 틱이 0번인 프레임은 에지가 다음으로 넘어간다). 패널이 열려 있으면 NEUTRAL_INPUT을 반환하고 에지를 버린다.
   * 이동 변환: {moveX, moveZ} = localToWorld(0, 0, camYaw, fwd, side) — 카메라 기준 앞 · 오른쪽.
   * @param {number} camYaw
   * @returns {InputFrame}
   */
  consume(camYaw) {
    if (this.handlers.isBlocking()) {
      this._edges = {};
      return NEUTRAL_INPUT;
    }
    const pad = this._pad;
    let fwd = (this._down('moveForward') ? 1 : 0) - (this._down('moveBack') ? 1 : 0) + pad.moveY;
    let side = (this._down('moveRight') ? 1 : 0) - (this._down('moveLeft') ? 1 : 0) + pad.moveX;
    const l = Math.hypot(fwd, side);
    if (l > 1) {
      fwd /= l;
      side /= l;
    }
    const m = l > 0 ? localToWorld(0, 0, camYaw, fwd, side) : { x: 0, z: 0 };
    const frame = makeInput({
      moveX: m.x,
      moveZ: m.z,
      sprint: this._down('sprint') || pad.sprint,
      guard: this._down('guard') || pad.guard,
      heavyHeld: this._down('heavy') || pad.heavy,
      ...this._edges,
    });
    this._edges = {};
    return frame;
  }

  /** 이번 프레임 누적 마우스 이동(픽셀) + 게임패드 오른쪽 스틱 환산분. 반환 후 0. @returns {{dx:number, dy:number}} */
  consumeLook() {
    const look = { dx: this._lookX, dy: this._lookY };
    this._lookX = 0;
    this._lookY = 0;
    return look;
  }

  /** 모든 홀드 · 에지 · look 누적을 0으로(창 포커스 잃음 — §11.2). keyup이 오지 않아 달리기 · 가드가 고착되는 것을 막는다. */
  releaseAll() {
    this._held.clear();
    this._edges = {};
    this._lookX = 0;
    this._lookY = 0;
    this._dragging = false;
    const pad = this._pad;
    pad.moveX = 0;
    pad.moveY = 0;
    pad.guard = false;
    pad.heavy = false;
    pad.sprint = false;
    pad.rollHeld = 0;
    pad.rollBlocked = false;
    pad.navKey = '';
  }

  /** 지금 포인터 락을 쥐고 있는가. @returns {boolean} */
  get locked() {
    return this._locked;
  }

  /** 락을 얻지 못해 드래그로 카메라를 돌리는 환경인가(사용자의 요청이 한 번이라도 실패했다). @returns {boolean} */
  get dragMode() {
    return this._lockFailed && !this._locked;
  }

  /** app이 락을 다시 요청한다(UI_CLOSED). 사용자 제스처가 아니면 실패할 수 있다 — 실패해도 조용히 계속한다. */
  requestLock() {
    this._requestLock(false);
  }

  /** app이 스스로 락을 푼다(UI_OPENED) — 「락 상실」로 보지 않는다. */
  exitLock() {
    clearTimeout(this._lockTimer);
    if (!this._locked) return;
    this._selfExit = true;
    try {
      this._doc.exitPointerLock();
    } catch {
      this._selfExit = false;
    }
  }

  /** 패널이 닫혔다: 지금까지의 에지와 앞으로 0.15초의 에지를 버린다. */
  notifyUiClosed() {
    this._edges = {};
    this._discardUntil = Math.max(this._discardUntil, this._now() + EDGE_DISCARD_AFTER_UI * 1000);
  }

  /**
   * 화면이 바뀌었다(SCREEN_CHANGED): 지금까지의 에지와 앞으로 0.5초의 에지를 버린다. 그 창 안에서 버려진 입력이
   * 0.35초 안에 다시 오면 그것도 버린다 — 연타가 멎은 뒤의 첫 입력부터 받는다. 홀드(이동 · 가드 · 달리기)는 그대로다.
   */
  notifyScreenChanged() {
    const now = this._now();
    this._edges = {};
    this._mashUntil = {};
    this._mashGuardUntil = now + EDGE_DISCARD_AFTER_SCREEN * 1000;
    this._discardUntil = Math.max(this._discardUntil, this._mashGuardUntil);
  }

  /**
   * 게임패드를 한 번 읽는다(프레임마다). 패널이 열려 있으면 navigate/confirm/cancel로 넘기고, 아니면 홀드 · 에지 · look에 더한다.
   * @param {number} dt 프레임 시간(초)
   */
  pollGamepad(dt) {
    const pad = this._readPad();
    const st = this._pad;
    if (!pad) {
      if (st.prev.length) {
        st.prev = [];
        st.moveX = 0;
        st.moveY = 0;
        st.guard = false;
        st.heavy = false;
        st.sprint = false;
        st.rollHeld = 0;
        st.rollBlocked = false;
        // 직전 프레임까지 있던 패드가 사라졌다. 그 패드로 조종하던 중이었을 때만 알린다
        // (키보드로 하는 동안 옆에 둔 패드가 절전으로 꺼지는 것은 일시정지할 일이 아니다).
        if (this._lastDevice === 'pad') {
          this._lastDevice = 'kbm';
          this.handlers.onPadLost();
        }
      }
      return;
    }
    const down = (/** @type {number} */ i) => {
      const b = pad.buttons[i];
      return !!b && (b.pressed || b.value > PAD_BUTTON_THRESHOLD);
    };
    const pressed = (/** @type {number} */ i) => down(i) && !st.prev[i];
    const axis = (/** @type {number} */ i) => {
      const v = pad.axes[i] ?? 0;
      const a = Math.abs(v);
      return a < GAMEPAD.deadzone ? 0 : Math.sign(v) * ((a - GAMEPAD.deadzone) / (1 - GAMEPAD.deadzone));
    };
    const lx = axis(0);
    const ly = axis(1);

    let any = false;
    for (let i = 0; i < pad.buttons.length; i++) any = any || pressed(i);
    if (any) this.handlers.onGesture();
    if (any || lx !== 0 || ly !== 0 || axis(2) !== 0 || axis(3) !== 0) this._lastDevice = 'pad';
    if (pressed(GAMEPAD.pause)) this.handlers.onEscape(true);

    if (this.handlers.isBlocking()) {
      // 패널: D-pad · 왼쪽 스틱 → navigate(누르고 있으면 navRepeat 간격), A → confirm, B → cancel
      let nx = 0;
      let ny = 0;
      if (down(PAD_UP) || ly < -PAD_NAV_THRESHOLD) ny = -1;
      else if (down(PAD_DOWN) || ly > PAD_NAV_THRESHOLD) ny = 1;
      else if (down(PAD_LEFT) || lx < -PAD_NAV_THRESHOLD) nx = -1;
      else if (down(PAD_RIGHT) || lx > PAD_NAV_THRESHOLD) nx = 1;
      if (nx !== 0 || ny !== 0) {
        const key = `${nx},${ny}`;
        st.navT -= dt;
        if (key !== st.navKey || st.navT <= 0) {
          st.navKey = key;
          st.navT = GAMEPAD.navRepeat;
          this.handlers.onNavigate(nx, ny);
        }
      } else {
        st.navKey = '';
        st.navT = 0;
      }
      // B가 눌린 채 패널이 닫히면(cancel = 닫기 · 재개) 그 B를 떼는 순간이 구르기 탭으로 읽힌다 — 뗄 때까지 막는다
      if (down(GAMEPAD.roll)) st.rollBlocked = true;
      if (pressed(GAMEPAD.interact)) this.handlers.onConfirm();
      if (pressed(GAMEPAD.roll)) this.handlers.onCancel();
      st.moveX = 0;
      st.moveY = 0;
      st.guard = false;
      st.heavy = false;
      st.sprint = false;
      st.rollHeld = 0;
    } else {
      st.moveX = lx;
      st.moveY = -ly; // 스틱을 위로 = 앞으로
      this._lookX += axis(2) * GAMEPAD.lookSpeed * dt;
      this._lookY += axis(3) * GAMEPAD.lookSpeed * dt;
      st.guard = down(GAMEPAD.guard);
      st.heavy = down(GAMEPAD.heavy);
      if (pressed(GAMEPAD.light)) this._edge('lightPressed');
      if (pressed(GAMEPAD.heavy)) this._edge('heavyPressed');
      if (pressed(GAMEPAD.lockOn)) this._edge('lockOnPressed');
      if (pressed(GAMEPAD.flask)) this._edge('flaskPressed');
      if (pressed(GAMEPAD.interact)) this._edge('interactPressed');
      // B: tapMax 안에 떼면 구르기, 넘기면 달리기
      if (down(GAMEPAD.roll)) {
        st.rollHeld += dt;
        st.sprint = st.rollHeld > GAMEPAD.tapMax;
      } else {
        if (!st.rollBlocked && st.prev[GAMEPAD.roll] && st.rollHeld > 0 && st.rollHeld <= GAMEPAD.tapMax) this._edge('rollPressed');
        st.rollHeld = 0;
        st.sprint = false;
        st.rollBlocked = false;
      }
    }
    const prev = [];
    for (let i = 0; i < pad.buttons.length; i++) prev[i] = down(i);
    st.prev = prev;
  }

  dispose() {
    clearTimeout(this._lockTimer);
    for (const off of this._listeners) off();
    this._listeners.length = 0;
    this.releaseAll();
  }

  // ───────────────────────── 내부 ─────────────────────────

  _now() {
    return this._win.performance.now();
  }

  /** 그 행동에 묶인 코드 중 하나라도 눌려 있는가. @param {string} action */
  _down(action) {
    const codes = KEYBINDS[action];
    for (let i = 0; i < codes.length; i++) if (this._held.has(codes[i])) return true;
    return false;
  }

  /** 코드가 눌렸다 — 홀드에 넣고, 에지를 내는 행동이면 에지를 세운다. @param {string} code */
  _press(code) {
    const action = this._byCode.get(code);
    if (!action) return;
    this._held.add(code);
    const field = EDGE_FIELD[action];
    if (field) this._edge(field);
  }

  /**
   * 에지 하나를 세운다. 버리는 창(UI_CLOSED 뒤 0.15초 · 화면 전환 뒤 0.5초) 안이면 버린다.
   * 화면 전환 창에서 버려진 입력은 연타가 멎을 때까지(EDGE_MASH_GAP) 계속 버린다.
   * @param {string} field InputFrame의 *Pressed 필드
   */
  _edge(field) {
    const now = this._now();
    const mashing = now < (this._mashUntil[field] ?? 0);
    if (now < this._mashGuardUntil || mashing) {
      this._mashUntil[field] = now + EDGE_MASH_GAP * 1000;
      return;
    }
    if (now < this._discardUntil) return;
    this._edges[field] = true;
  }

  /** @param {KeyboardEvent} e */
  _onKeyDown(e) {
    this.handlers.onGesture();
    this._lastDevice = 'kbm';
    if (e.ctrlKey || e.metaKey || e.altKey) return;     // 브라우저 단축키는 건드리지 않는다(Ctrl+W · Alt+Tab …)
    const uiHandled = e.defaultPrevented;               // UI(패널)가 처리한 키 — 에지로는 받지 않는다(홀드만 기록)
    if (!uiHandled && PREVENT_CODES.has(e.code)) e.preventDefault(); // Tab 포커스 이동 · Space/화살표 스크롤
    const action = this._byCode.get(e.code);
    if (!action) return;
    if (action === 'pause') {
      if (!uiHandled && !e.repeat) this.handlers.onEscape(false);
      return;
    }
    // 홀드는 물리 상태다: UI가 처리한 키 · 자동 반복도 「눌려 있다」로 본다(keyup · blur에서 풀린다).
    this._held.add(e.code);
    if (uiHandled || e.repeat) return;
    const field = EDGE_FIELD[action];
    if (field) this._edge(field);
  }

  /** @param {KeyboardEvent} e */
  _onKeyUp(e) {
    this._held.delete(e.code);
  }

  /** @param {MouseEvent} e */
  _onMouseDown(e) {
    this.handlers.onGesture();
    this._lastDevice = 'kbm';
    if (e.button === 1) e.preventDefault(); // 휠 클릭의 자동 스크롤
    if (e.button > 2) return;
    this._dragging = true;
    if (!this._locked) {
      this._requestLock(true);
      // 시점을 고정하려던 클릭에 칼이 나가지 않게, 락이 없을 때의 클릭은 요청에만 쓴다.
      // 단 한 번이라도 실패한 환경(자동화 · 락 미지원)에서는 정상 입력으로 낸다.
      if (!this._lockFailed) return;
    }
    this._press(`Mouse${e.button}`);
  }

  /** 캔버스 밖(패널 · 전환 막)의 mousedown — window capture. 홀드만 기록하고 에지는 내지 않는다. @param {MouseEvent} e */
  _onWindowMouseDown(e) {
    this.handlers.onGesture();
    if (e.target === this.canvas || e.button > 2 || e.button < 0) return;
    this._held.add(`Mouse${e.button}`);
  }

  /** @param {MouseEvent} e */
  _onMouseUp(e) {
    this._held.delete(`Mouse${e.button}`);
    if (e.buttons === 0) this._dragging = false;
  }

  /** @param {MouseEvent} e */
  _onMouseMove(e) {
    // 락을 쥐고 있으면 항상, 아니면 캔버스에서 시작한 누르기를 끄는 동안만(드래그 모드) 쌓는다
    if (!this._locked && !(this._dragging && e.buttons !== 0)) return;
    if (this._skipLook) {
      this._skipLook = false; // 락을 얻은 직후의 첫 이동(커서가 중앙으로 옮겨지며 튄다)
      return;
    }
    // 상한을 넘는 이동은 버리지 않고 자른다 — 빠르게 돌릴수록(또는 프레임이 떨어져 이동이 한 이벤트로 합쳐질수록)
    // 카메라가 멈추는 일이 없다. 상한은 각도 기준이라 감도를 낮춰도 같은 속도까지 돈다.
    const max = this._lookEventMax();
    const dx = e.movementX || 0;
    const dy = e.movementY || 0;
    this._lookX += dx > max ? max : dx < -max ? -max : dx;
    this._lookY += dy > max ? max : dy < -max ? -max : dy;
    if (this._locked) this._lastDevice = 'kbm';
  }

  /** mousemove 한 번의 이동량 상한(픽셀) = 90° ÷ (rad/픽셀 × 감도), 바닥 300. @returns {number} */
  _lookEventMax() {
    const sens = Number(this.settings && this.settings.mouseSensitivity) || 1;
    const perPixel = CAMERA.rotSpeed * (sens > 0 ? sens : 1);
    return Math.max(LOOK_EVENT_MAX, LOOK_EVENT_MAX_ANGLE / perPixel);
  }

  /** @param {boolean} fromUser 캔버스 클릭에서 온 요청인가(실패를 「드래그 모드」로 셀지 가른다) */
  _requestLock(fromUser) {
    if (this._locked) return;
    const canvas = this.canvas;
    this._userRequest = fromUser;
    clearTimeout(this._lockTimer);
    if (typeof canvas.requestPointerLock !== 'function') {
      if (fromUser) this._markLockFailed();
      return;
    }
    if (fromUser) {
      this._lockTimer = this._win.setTimeout(() => {
        if (!this._locked) this._markLockFailed();
      }, LOCK_TIMEOUT * 1000);
    }
    try {
      const r = canvas.requestPointerLock();
      // 새 브라우저는 Promise를 준다 — 거부는 삼킨다(unhandledrejection으로 새지 않게)
      if (r && typeof r.then === 'function') {
        r.then(() => {}, () => {
          if (fromUser) this._markLockFailed();
        });
      }
    } catch {
      if (fromUser) this._markLockFailed();
    }
  }

  _markLockFailed() {
    clearTimeout(this._lockTimer);
    if (this._locked) return;
    const first = !this._lockFailed;
    this._lockFailed = true;
    if (first) this.handlers.onLockChange(false, { lost: false });
  }

  _onLockChange() {
    const locked = this._doc.pointerLockElement === this.canvas;
    if (locked === this._locked) return;
    const self = this._selfExit;
    this._selfExit = false;
    this._locked = locked;
    if (locked) {
      clearTimeout(this._lockTimer);
      this._skipLook = true;
    } else {
      this._dragging = false;
    }
    this.handlers.onLockChange(locked, { lost: !locked && !self });
  }

  _onLockError() {
    if (this._userRequest) this._markLockFailed();
  }

  /** 표준 매핑의 첫 게임패드(없으면 연결된 첫 패드). @returns {Gamepad|null} */
  _readPad() {
    const nav = this._win.navigator;
    if (!nav || typeof nav.getGamepads !== 'function') return null;
    let pads;
    try {
      pads = nav.getGamepads();
    } catch {
      return null; // 권한 정책으로 막힌 문서
    }
    let first = null;
    for (let i = 0; pads && i < pads.length; i++) {
      const p = pads[i];
      if (!p || !p.connected) continue;
      if (p.mapping === 'standard') return p;
      if (!first) first = p;
    }
    return first;
  }
}
