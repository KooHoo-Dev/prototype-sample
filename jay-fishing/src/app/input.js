// OWNER: P9 — 계약 §6.12 · §11.3
// 입력 수집: 키는 event.code(한글 IME) · Ctrl/Alt/Meta 조합은 건드리지 않는다 · 홀드는 물리 상태를 늘 추적 · 에지는 buildFrame 한 번에만.
// 포인터 락 규칙 넷(§11.3): ① 요청은 사용자 활성화 처리기 안에서만 ② 락이 없을 때 캔버스 클릭은 락만 요청하고 삼킨다
//   ③ available 은 API 가 없거나 한 번도 성공 못 한 채 첫 요청이 실패했을 때만 false ④ available false 면 드래그 대체.
// 마우스 버튼은 mousedown/mouseup 으로 읽는다 — 좌클릭을 누른 채 우클릭(릴링 + 펌핑)은 pointerdown 이 다시 오지 않는다(Pointer Events 의 화음 규칙).
// frameFromState 는 순수(app.input.test).

import { EV } from '../core/events.js';
import { makeInput } from '../core/inputFrame.js';
import { clamp, wrapAngle } from '../core/math.js';
import { KEYBINDS, WHEEL } from '../data/keybinds.js';
import { MOUSE } from '../data/settings.js';
import { WORLD } from '../data/world.js';

/** @typedef {import('../types.js').InputFrame} InputFrame */
/** @typedef {{pressed:string[], released:string[]}} InputEdges  지난 buildFrame 이후의 누름 · 뗌(코드 · 같은 코드 여러 번 가능) */

/** 페이지로 넘기지 않는 키(게임 · 타이틀 · 패널 공통 — §11.3) */
export const PREVENT_CODES = ['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
/** 한 프레임에 쌓아 두는 에지 상한(멈춘 동안 무한히 쌓이지 않게) */
const MAX_PENDING_EDGES = 32;
/** 휠 · 키 드랙 눈금의 한 틱 상한(절댓값) */
const MAX_STEPS = 20;

/** @param {Iterable<string>|Record<string, boolean>|null|undefined} keys @returns {(code:string) => boolean} */
function heldFn(keys) {
  if (!keys) return () => false;
  if (typeof (/** @type {any} */ (keys)).has === 'function') return (c) => /** @type {any} */ (keys).has(c);
  if (Array.isArray(keys)) return (c) => keys.includes(c);
  return (c) => !!(/** @type {any} */ (keys))[c];
}

/** @param {string[]} list @param {string[]} codes @returns {number} */
function countIn(list, codes) {
  let n = 0;
  for (let i = 0; i < list.length; i++) if (codes.includes(list[i])) n++;
  return n;
}

/**
 * 순수 — 지금 눌린 코드 · 에지 · 시선 · 휠 눈금 → 한 틱의 InputFrame.
 * @param {Set<string>|string[]|Record<string, boolean>} keys 눌린 코드('KeyW' · 'Mouse0' …)
 * @param {InputEdges|null} edges 이번 틱에 내보낼 에지
 * @param {{yaw:number, pitch:number}} look
 * @param {number} wheelSteps 정수(+ 조이기 — 휠 ↑)
 * @param {Record<string, string[]>} [bindings] 기본 KEYBINDS
 * @returns {InputFrame}
 */
export function frameFromState(keys, edges, look, wheelSteps, bindings = KEYBINDS) {
  const b = bindings || KEYBINDS;
  const held = heldFn(keys);
  const any = (action) => (b[action] || []).some(held);
  const pressed = edges && Array.isArray(edges.pressed) ? edges.pressed : [];
  const released = edges && Array.isArray(edges.released) ? edges.released : [];
  const hit = (action) => countIn(pressed, b[action] || []);
  let selectSet = null;
  for (let i = 0; i < pressed.length; i++) {
    const c = pressed[i];
    if ((b.setFloat || []).includes(c)) selectSet = 'float';
    else if ((b.setBottom || []).includes(c)) selectSet = 'bottom';
  }
  const wheel = Number.isFinite(wheelSteps) ? Math.trunc(wheelSteps) : 0;
  const yaw = look && Number.isFinite(look.yaw) ? look.yaw : 0;
  const pitch = look && Number.isFinite(look.pitch) ? look.pitch : 0;
  return makeInput({
    moveX: (any('right') ? 1 : 0) - (any('left') ? 1 : 0),
    moveZ: (any('forward') ? 1 : 0) - (any('back') ? 1 : 0),
    yaw,
    pitch,
    primary: any('primary'),
    primaryPressed: hit('primary') > 0,
    primaryReleased: countIn(released, b.primary || []) > 0,
    secondary: any('secondary'),
    hook: hit('hook') > 0,
    interact: hit('interact') > 0,
    dragSteps: clamp(wheel + hit('dragTighten') - hit('dragLoosen'), -MAX_STEPS, MAX_STEPS),
    bail: hit('bail') > 0,
    depthSteps: clamp(hit('depthDeeper') - hit('depthShallower'), -MAX_STEPS, MAX_STEPS),
    selectSet: /** @type {any} */ (selectSet),
  });
}

/**
 * 휠 deltaY → 누적과 정수 눈금(+ = 휠 ↑ = 조이기). 순수.
 * @param {number} acc 지금까지의 소수 누적 @param {number} deltaY @param {number} deltaMode 0 px · 1 줄 · 2 쪽
 * @returns {{acc:number, steps:number}}
 */
export function wheelToSteps(acc, deltaY, deltaMode) {
  if (!Number.isFinite(deltaY)) return { acc, steps: 0 };
  const px = deltaMode === 1 ? deltaY * WHEEL.linePx : deltaMode === 2 ? deltaY * WHEEL.pxPerStep : deltaY;
  const next = acc - px / WHEEL.pxPerStep;
  const steps = Math.trunc(next);
  return { acc: next - steps, steps };
}

/**
 * 마우스 이동 한 이벤트 → 새 시선(스파이크는 버리지 않고 MOUSE.spikeClampPx 로 자른다). 순수.
 * @param {{yaw:number, pitch:number}} look @param {number} dx @param {number} dy @param {{mouseSens?:number, invertY?:boolean}} settings
 * @returns {{yaw:number, pitch:number}}
 */
export function applyMouseDelta(look, dx, dy, settings) {
  const sx = clamp(Number.isFinite(dx) ? dx : 0, -MOUSE.spikeClampPx, MOUSE.spikeClampPx);
  const sy = clamp(Number.isFinite(dy) ? dy : 0, -MOUSE.spikeClampPx, MOUSE.spikeClampPx);
  const sens = settings && Number.isFinite(settings.mouseSens) ? /** @type {number} */ (settings.mouseSens) : 1;
  const inv = settings && settings.invertY ? -1 : 1;
  return {
    yaw: wrapAngle(look.yaw - sx * MOUSE.radPerPx * sens),
    pitch: clamp(look.pitch - sy * MOUSE.radPerPx * sens * inv, WORLD.pitchMin, WORLD.pitchMax),
  };
}

/** @param {any} e */
function prevent(e) {
  if (e && e.cancelable !== false && typeof e.preventDefault === 'function') e.preventDefault();
}

export class InputCollector {
  /**
   * @param {{canvas:HTMLCanvasElement, settings:Object, bus:import('../core/events.js').EventBus,
   *          win?:any, doc?:any}} deps win · doc 은 테스트용(기본 window · document)
   */
  constructor({ canvas, settings, bus, win, doc }) {
    this.canvas = /** @type {any} */ (canvas);
    this.settings = /** @type {any} */ (settings);
    this.bus = bus;
    this.win = win || (typeof window !== 'undefined' ? window : null);
    this.doc = doc || (typeof document !== 'undefined' ? document : null);
    this._look = { yaw: 0, pitch: 0 };
    /** @type {Set<string>} 물리적으로 눌린 코드(키 · 'Mouse0' 'Mouse2') */
    this.held = new Set();
    /** @type {InputEdges} */
    this.edges = { pressed: [], released: [] };
    this._wheelAcc = 0;
    this._wheelSteps = 0;
    this.capture = true;
    this.mode = 'walk';
    /** 게임 화면(play)인가 — 마우스 옆 버튼 · 우클릭 메뉴 · 휠 스크롤을 막는다(app 이 매 프레임) */
    this.playing = false;
    /** @type {Set<number>} 락 요청에 쓴 버튼 — 뗄 때까지 무시 */
    this._swallowed = new Set();
    /** @type {Set<number>} 시선 드래그 중인 버튼(드래그 대체) */
    this._dragButtons = new Set();

    // 포인터 락
    const c = this.canvas;
    this.lockApi = !!(c && typeof c.requestPointerLock === 'function' && this.doc && 'pointerLockElement' in this.doc);
    this.locked = false;
    this.everLocked = false;
    this.lockAvailable = this.lockApi;
    this._lockPending = false;
    this._releasing = false;

    /** app 이 채운다: 키 처리기(ui.handleKey · Esc) — true 면 게임 입력으로 새지 않는다(홀드는 추적) @type {((e:KeyboardEvent) => boolean)|null} */
    this.keyHandler = null;
    /** 첫 사용자 제스처(키 · 클릭) @type {(() => void)|null} */
    this.onGesture = null;
    /** app 이 풀지 않은 락 상실 @type {(() => void)|null} */
    this.onLockLost = null;
    /** 캔버스 클릭으로 락을 요청해도 되는가(play · 패널 없음 · 막 없음) */
    this.lockGate = () => true;

    /** @type {Array<() => void>} */
    this._offs = [];
    this._listen();
  }

  _listen() {
    const on = (target, name, fn, opt) => {
      if (!target || typeof target.addEventListener !== 'function') return;
      target.addEventListener(name, fn, opt);
      this._offs.push(() => target.removeEventListener(name, fn, opt));
    };
    const w = this.win;
    const d = this.doc;
    const c = this.canvas;
    on(w, 'keydown', (e) => this._onKeyDown(e));
    on(w, 'keyup', (e) => { this.held.delete(e.code); });
    on(w, 'blur', () => this.releaseAll());
    on(c, 'mousedown', (e) => this._onMouseDown(e));
    on(w, 'mouseup', (e) => this._onMouseUp(e));
    on(w, 'mousedown', (e) => { if (this.playing && (e.button === 3 || e.button === 4)) prevent(e); });
    on(w, 'mousemove', (e) => this._onMouseMove(e));
    on(c, 'wheel', (e) => this._onWheel(e), { passive: false });
    on(c, 'contextmenu', (e) => prevent(e));
    on(w, 'contextmenu', (e) => { if (this.playing) prevent(e); });
    on(w, 'auxclick', (e) => { if (this.playing && e.button !== 0) prevent(e); });
    on(d, 'pointerlockchange', () => this._onLockChange());
    on(d, 'pointerlockerror', () => this._onLockFail());
  }

  // ── 키

  /** @param {KeyboardEvent} e */
  _onKeyDown(e) {
    if (e.ctrlKey || e.altKey || e.metaKey) return;   // 매핑 · preventDefault 둘 다 안 함
    if (this.onGesture) this.onGesture();
    const code = e.code;
    if (PREVENT_CODES.includes(code)) prevent(e);
    const consumed = this.keyHandler ? !!this.keyHandler(e) : false;
    if (typeof code === 'string' && code) this.held.add(code);
    if (consumed || !this.capture || e.repeat) return;
    this._pushEdge(this.edges.pressed, code);
  }

  /** @param {string[]} list @param {string} code */
  _pushEdge(list, code) {
    if (list.length < MAX_PENDING_EDGES) list.push(code);
  }

  // ── 마우스

  /** @param {MouseEvent} e */
  _onMouseDown(e) {
    if (this.onGesture) this.onGesture();
    const btn = e.button;
    if (btn === 1) prevent(e);   // 가운데 버튼 자동 스크롤
    if (btn !== 0 && btn !== 1 && btn !== 2) return;
    // 규칙 ②: 락이 없고 락을 쓸 수 있으면 — 락만 요청하고 이 누름은 뗄 때까지 삼킨다(캐스팅 충전을 시작하지 않는다)
    if (!this.locked && this.lockAvailable) {
      this._swallowed.add(btn);
      if (this.lockGate()) this.requestLock();
      return;
    }
    // 규칙 ④: 드래그 대체 — 가운데는 언제나, 걷기 모드면 좌 · 우도 시선
    if (!this.locked && !this.lockAvailable && (btn === 1 || this.mode === 'walk')) this._dragButtons.add(btn);
    if (btn === 1) return;
    const code = 'Mouse' + btn;
    this.held.add(code);
    if (this.capture) this._pushEdge(this.edges.pressed, code);
  }

  /** @param {MouseEvent} e */
  _onMouseUp(e) {
    const btn = e.button;
    if (this.playing && (btn === 3 || btn === 4)) prevent(e);   // 뒤로/앞으로
    this._dragButtons.delete(btn);
    if (this._swallowed.delete(btn)) return;
    const code = 'Mouse' + btn;
    if (!this.held.delete(code)) return;
    if (this.capture) this._pushEdge(this.edges.released, code);
  }

  /** @param {MouseEvent} e */
  _onMouseMove(e) {
    if (!this.locked && this._dragButtons.size === 0) return;
    const nl = applyMouseDelta(this._look, e.movementX, e.movementY, this.settings);
    this._look.yaw = nl.yaw;
    this._look.pitch = nl.pitch;
  }

  /** @param {WheelEvent} e */
  _onWheel(e) {
    prevent(e);
    if (!this.capture) return;
    const r = wheelToSteps(this._wheelAcc, e.deltaY, e.deltaMode);
    this._wheelAcc = r.acc;
    this._wheelSteps = clamp(this._wheelSteps + r.steps, -MAX_STEPS, MAX_STEPS);
  }

  // ── 포인터 락

  /**
   * 사용자 활성화가 있는 처리기 안에서만 부른다(규칙 ①).
   * soft: 키(Enter/Space)로 연 요청 — 실패해도 available 을 내리지 않는다(브라우저마다 키 활성화 인정이 달라 드래그로 굳지 않게).
   * @param {{soft?:boolean}} [opts] @returns {boolean} 요청했는가
   */
  requestLock(opts) {
    if (!this.lockApi || this.locked) return false;
    this._lockPending = true;
    this._lockSoft = !!(opts && opts.soft);
    try {
      const r = this.canvas.requestPointerLock();
      if (r && typeof r.then === 'function') r.then(undefined, () => this._onLockFail());   // 거부를 잡지 않으면 unhandledrejection
    } catch {
      this._onLockFail();
    }
    return true;
  }

  /** app 이 푼다(패널 열림) — 상실로 치지 않는다 */
  releaseLock() {
    if (!this.locked || !this.doc) return;
    this._releasing = true;
    try { this.doc.exitPointerLock(); } catch { this._releasing = false; }
  }

  _onLockChange() {
    const now = !!this.doc && this.doc.pointerLockElement === this.canvas && !!this.canvas;
    if (now === this.locked) return;
    this.locked = now;
    this._dragButtons.clear();
    if (now) {
      this._lockPending = false;
      this.everLocked = true;
      this.lockAvailable = true;
      this._emitLock();
      return;
    }
    const byApp = this._releasing;
    this._releasing = false;
    this._emitLock();
    if (!byApp && this.onLockLost) this.onLockLost();
  }

  _onLockFail() {
    if (!this._lockPending) return;   // 이벤트와 Promise 거부가 둘 다 와도 한 번
    this._lockPending = false;
    if (!this.everLocked && !this._lockSoft) this.lockAvailable = false;   // 규칙 ③
    this._swallowed.clear();
    this._emitLock();
  }

  _emitLock() {
    if (this.bus) this.bus.emit(EV.POINTER_LOCK, { locked: this.locked, available: this.lockAvailable });
  }

  /** 지금 락 상태를 한 번 알린다(play 진입 — ui 의 안내 문구) */
  announceLock() {
    this._emitLock();
  }

  // ── 계약 API

  /** @returns {InputFrame} 이번 틱 — 에지는 여기서 한 번만 나가고 비워진다 */
  buildFrame() {
    const f = frameFromState(this.held, this.edges, this._look, this._wheelSteps, KEYBINDS);
    this.edges.pressed.length = 0;
    this.edges.released.length = 0;
    this._wheelSteps = 0;
    return f;
  }

  /** @returns {{yaw:number, pitch:number}} 최신 시선(읽기 전용으로 쓴다 — 매 프레임 할당하지 않는다) */
  get look() {
    return this._look;
  }

  /** @param {number} yaw @param {number} pitch */
  setLook(yaw, pitch) {
    if (Number.isFinite(yaw)) this._look.yaw = wrapAngle(yaw);
    if (Number.isFinite(pitch)) this._look.pitch = clamp(pitch, WORLD.pitchMin, WORLD.pitchMax);
  }

  /** 홀드 · 에지 · 휠 누적 비움(포커스 잃음) */
  releaseAll() {
    this.held.clear();
    this.edges.pressed.length = 0;
    this.edges.released.length = 0;
    this._wheelAcc = 0;
    this._wheelSteps = 0;
    this._swallowed.clear();
    this._dragButtons.clear();
  }

  /** 패널 · 전환 막이면 false — 에지를 버리고 홀드 상태만 추적 @param {boolean} on */
  setCapture(on) {
    const v = !!on;
    if (!v) {
      this.edges.pressed.length = 0;
      this.edges.released.length = 0;
      this._wheelAcc = 0;
      this._wheelSteps = 0;
    }
    this.capture = v;
  }

  /** @param {'walk'|'fish'} mode */
  setMode(mode) {
    this.mode = mode === 'fish' ? 'fish' : 'walk';
  }

  /** 프레임마다 — 낚시 모드면 A/D 가 시선을 돌린다(MOUSE.keyYawRate · 락 유무와 무관) @param {number} dt */
  tick(dt) {
    if (this.mode !== 'fish' || !this.capture) return;
    const d = Number.isFinite(dt) && dt > 0 ? dt : 0;
    if (!d) return;
    const dir = (this._anyHeld(KEYBINDS.left) ? 1 : 0) - (this._anyHeld(KEYBINDS.right) ? 1 : 0);   // A = 좌회전 = yaw +(§0.2)
    if (dir) this._look.yaw = wrapAngle(this._look.yaw + dir * MOUSE.keyYawRate * d);
  }

  /** @param {string[]} codes @returns {boolean} */
  _anyHeld(codes) {
    for (let i = 0; i < codes.length; i++) if (this.held.has(codes[i])) return true;
    return false;
  }

  get pointerLocked() {
    return this.locked;
  }

  dispose() {
    for (const off of this._offs) off();
    this._offs = [];
    this.releaseLock();
  }
}
