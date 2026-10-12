// OWNER: P9 — 계약 §12.2 · §11.5 · §10.5 · §3.2
// 입력 수집기 — 키 → InputFrame · 에지 모으기/버리기 · 조합 키 무시 · ui 먼저 · 모달/겹쳐 보는 패널의 키 · 포커스 잃음 · Alt 이름표 · 마우스 · hover 조합.
// DOM 없이: 가짜 ui · rc · pick 을 넘기고(win · doc null — 리스너를 달지 않는다) handle* 를 직접 부른다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EV, EventBus } from '../src/core/events.js';
import { KEYBINDS, MOUSE } from '../src/data/keybinds.js';
import { InputCollector } from '../src/app/input.js';

function fakeUi() {
  return {
    modal: false,
    /** @type {string[]} 겹쳐 보는 패널이 먹는 키 */
    eats: [],
    stack: /** @type {string[]} */ ([]),
    blocks: false,
    /** @type {any} */ label: null,
    /** @type {boolean[]} */ labels: [],
    /** @type {string[]} */ got: [],
    isModal() { return this.modal; },
    anyOpen() { return this.stack.length > 0; },
    topPanel() { return this.stack[this.stack.length - 1] ?? null; },
    handleKey(e) { this.got.push(`${e.type}:${e.code}`); return this.modal || this.eats.includes(e.code); },
    blocksPointer() { return this.blocks; },
    labelHover() { return this.label; },
    setLabels(on) { this.labels.push(on); },
  };
}

/** @param {string} type @param {string} code @param {Object} [extra] */
function key(type, code, extra = {}) {
  return { type, code, repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, target: null, prevented: false, preventDefault() { this.prevented = true; }, ...extra };
}
/** @param {string} type @param {number} button @param {Object} [extra] */
function mouse(type, button, extra = {}) {
  return { type, button, clientX: 400, clientY: 300, target: null, prevented: false, preventDefault() { this.prevented = true; }, ...extra };
}

const rc = {
  groundAt: (x, y) => ({ x: x / 10, z: y / 10 }),
  rayFromScreen: () => ({ ox: 0, oy: 10, oz: 0, dx: 0, dy: -1, dz: 0 }),
};
const STATE = /** @type {any} */ ({ scene: 'rift', mon: null, rest: null });
/** 가짜 광선 판별 — kinds 로 몬스터 · 나머지 */
const pick = (state, map, ray, { kinds }) => (kinds.includes('monster') ? state.mon : state.rest);

function make(opts = {}) {
  const bus = new EventBus();
  const ui = fakeUi();
  /** @type {any[]} */
  const labelsEv = [];
  bus.on(EV.LABELS, (p) => labelsEv.push(p.on));
  let gestures = 0;
  const appKeys = [];
  const inp = new InputCollector({
    canvas: null, bus, ui, rc, keybinds: KEYBINDS, settings: /** @type {any} */ ({ alwaysLabels: false }), win: null, doc: null, pick,
    onGesture: () => gestures++, onAppKey: (e) => { appKeys.push(e.code); return opts.appEats ? opts.appEats.includes(e.code) : false; },
  });
  inp.handleMouseMove(mouse('mousemove', 0));
  return { bus, ui, inp, labelsEv, appKeys, gestures: () => gestures };
}

test('app.input: 키 → InputFrame — 누름 에지는 한 번 · 누르고 있음은 계속 · 뗌', () => {
  const { inp } = make();
  const d = key('keydown', 'Digit1');
  inp.handleKeyDown(d);
  assert.equal(d.prevented, true);
  let f = inp.frame(STATE, null);
  assert.equal(f.slotDown[1], true);
  assert.equal(f.slot[1], true);
  f = inp.frame(STATE, null);
  assert.equal(f.slotDown[1], false, '에지는 한 틱');
  assert.equal(f.slot[1], true, '누르고 있음');
  inp.handleKeyDown(key('keydown', 'Digit1', { repeat: true }));
  assert.equal(inp.frame(STATE, null).slotDown[1], false, '자동 반복은 에지가 아니다');
  inp.handleKeyUp(key('keyup', 'Digit1'));
  assert.equal(inp.frame(STATE, null).slot[1], false);
  // 나머지 매핑 — Digit4 = 칸 4 · Shift = 제자리 · Q · T
  inp.handleKeyDown(key('keydown', 'Digit4'));
  inp.handleKeyDown(key('keydown', 'ShiftRight'));
  inp.handleKeyDown(key('keydown', 'KeyQ'));
  inp.handleKeyDown(key('keydown', 'KeyT'));
  f = inp.frame(STATE, null);
  assert.deepEqual([f.slotDown[4], f.slot[4], f.shift, f.potionDown, f.recallDown], [true, true, true, true, true]);
  f = inp.frame(STATE, null);
  assert.deepEqual([f.potionDown, f.recallDown, f.shift], [false, false, true]);
});

test('app.input: 에지는 다음 frame 이 가져갈 때까지 모인다(틱 없는 프레임에도 씹히지 않는다)', () => {
  const { inp } = make();
  inp.handleKeyDown(key('keydown', 'KeyQ'));
  inp.handleKeyUp(key('keyup', 'KeyQ'));
  inp.handleMouseDown(mouse('mousedown', MOUSE.move));
  inp.handleMouseUp(mouse('mouseup', MOUSE.move));
  // 여러 프레임 동안 frame() 을 부르지 않았다(틱 없음)
  const f = inp.frame(STATE, null);
  assert.equal(f.potionDown, true);
  assert.equal(f.lmbDown, true);
  assert.equal(f.lmb, false, '이미 뗐다');
  const g = inp.frame(STATE, null);
  assert.equal(g.potionDown || g.lmbDown, false);
});

test('app.input: Ctrl · Meta · Alt + 다른 키는 건드리지 않는다(기본 동작도) — 그래도 뗌은 눌림을 푼다', () => {
  const { inp, ui } = make();
  for (const mod of ['ctrlKey', 'metaKey', 'altKey']) {
    const e = key('keydown', 'Digit2', { [mod]: true });
    inp.handleKeyDown(e);
    assert.equal(e.prevented, false, mod);
    assert.equal(inp.frame(STATE, null).slotDown[2], false, mod);
  }
  assert.equal(ui.got.filter((s) => s.startsWith('keydown')).length, 0, 'ui 에도 보내지 않는다');
  inp.handleKeyDown(key('keydown', 'Digit2'));
  inp.handleKeyUp(key('keyup', 'Digit2', { ctrlKey: true }));
  assert.equal(inp.frame(STATE, null).slot[2], false, 'Ctrl 을 누른 채 떼도 풀린다');
});

test('app.input: ui.handleKey 가 먼저 — true 면 게임 입력이 아니다 · 기본 동작은 막는다', () => {
  const { inp, ui } = make();
  ui.eats = ['KeyQ'];
  const e = key('keydown', 'KeyQ');
  inp.handleKeyDown(e);
  assert.equal(e.prevented, true);
  assert.equal(inp.frame(STATE, null).potionDown, false);
  assert.deepEqual(ui.got, ['keydown:KeyQ']);
});

test('app.input: 모달이 먹은 「누르고 있는」 게임 키는 모달이 닫힌 뒤 눌림으로 잡힌다(에지 없이) — QUALITY §1', () => {
  const { inp, ui } = make();
  ui.modal = true;
  inp.handleKeyDown(key('keydown', 'Digit3'));
  inp.handleKeyDown(key('keydown', 'KeyQ'));
  ui.modal = false;
  const f = inp.frame(STATE, null);
  assert.equal(f.slot[3], true, '눌림');
  assert.equal(f.slotDown[3], false, '에지 없음');
  assert.equal(f.potionDown, false, '모달 안의 포션 누름은 버린다');
});

test('app.input: 겹쳐 보는 패널이 자기 키로 먹은 키는 뗄 때까지 게임 입력이 아니다(스킬 창의 Digit1)', () => {
  const { inp, ui } = make();
  ui.eats = ['Digit1'];
  inp.handleKeyDown(key('keydown', 'Digit1'));
  ui.eats = [];                                         // 패널을 닫았다 — 아직 누르고 있다
  inp.handleKeyDown(key('keydown', 'Digit1', { repeat: true }));
  let f = inp.frame(STATE, null);
  assert.equal(f.slot[1], false);
  assert.equal(f.slotDown[1], false);
  inp.handleKeyUp(key('keyup', 'Digit1'));
  inp.handleKeyDown(key('keydown', 'Digit1'));
  f = inp.frame(STATE, null);
  assert.equal(f.slotDown[1], true, '다시 누르면 게임 입력');
});

test('app.input: 패널이 닫힌 직후 · dropEdges 1틱은 에지를 버린다 · 누르고 있던 것은 그대로', () => {
  const { inp, bus } = make();
  inp.handleKeyDown(key('keydown', 'Digit2'));
  inp.handleKeyDown(key('keydown', 'KeyQ'));
  inp.handleMouseDown(mouse('mousedown', MOUSE.move));
  bus.emit(EV.PANEL_CLOSED, { panel: 'death', depth: 0, by: 'key' });
  let f = inp.frame(STATE, null);
  assert.deepEqual([f.slotDown[2], f.potionDown, f.lmbDown], [false, false, false], '버림');
  assert.deepEqual([f.slot[2], f.lmb], [true, true], '눌림은 남는다');
  inp.handleKeyDown(key('keydown', 'KeyT'));
  f = inp.frame(STATE, null);
  assert.equal(f.recallDown, true, '한 틱만 버린다');
  inp.dropEdges(1);
  inp.handleKeyDown(key('keydown', 'KeyT'));
  assert.equal(inp.frame(STATE, null).recallDown, false);
  inp.handleKeyDown(key('keydown', 'KeyT'));
  inp.clearEdges();
  assert.equal(inp.frame(STATE, null).recallDown, false, 'clearEdges(전환 요청)');
});

test('app.input: 포커스를 잃으면 눌린 키 · 버튼을 전부 놓는다 · cursor null(누르고 있던 이동이 멈춘다)', () => {
  const { inp, labelsEv } = make();
  inp.handleKeyDown(key('keydown', 'Digit1'));
  inp.handleKeyDown(key('keydown', 'ShiftLeft'));
  inp.handleKeyDown(key('keydown', 'AltLeft'));
  inp.handleMouseDown(mouse('mousedown', MOUSE.move));
  inp.handleMouseDown(mouse('mousedown', MOUSE.skill0));
  inp.handleBlur();
  let f = inp.frame(STATE, null);
  assert.deepEqual([f.lmb, f.slot[0], f.slot[1], f.shift, f.lmbDown, f.slotDown[0]], [false, false, false, false, false, false]);
  assert.equal(f.cursor, null);
  assert.deepEqual(labelsEv, [true, false], 'Alt 도 놓는다');
  inp.handleFocus();
  inp.handleMouseMove(mouse('mousemove', 0));
  f = inp.frame(STATE, null);
  assert.deepEqual(f.cursor, { x: 40, z: 30 });
  inp.handleLeave();
  assert.equal(inp.frame(STATE, null).cursor, null, '창 밖');
});

test('app.input: Alt 단독 — 기본 동작을 막고(메뉴 포커스) LABELS{on} · ui.setLabels', () => {
  const { inp, ui, labelsEv } = make();
  const d = key('keydown', 'AltLeft', { altKey: true });
  inp.handleKeyDown(d);
  assert.equal(d.prevented, true);
  inp.handleKeyDown(key('keydown', 'AltLeft', { altKey: true, repeat: true }));
  const u = key('keyup', 'AltLeft');
  inp.handleKeyUp(u);
  assert.equal(u.prevented, true);
  assert.deepEqual(labelsEv, [true, false], '바뀔 때만');
  assert.deepEqual(ui.labels, [true, false]);
});

test('app.input: 게임 중 기본 동작 — Tab · Space · 방향키 · 우클릭 메뉴 · 옆 버튼을 막는다 · 텍스트 칸에서는 ui 만', () => {
  const { inp, ui, appKeys } = make();
  for (const code of ['Tab', 'Space', 'ArrowUp', 'ArrowLeft']) {
    const e = key('keydown', code);
    inp.handleKeyDown(e);
    assert.equal(e.prevented, true, code);
  }
  assert.deepEqual(appKeys, ['Tab', 'Space', 'ArrowUp', 'ArrowLeft'], 'ui 다음 app 키 처리기를 거친다');
  const cm = mouse('contextmenu', 2);
  inp.handleContextMenu(cm);
  assert.equal(cm.prevented, true);
  for (const b of [3, 4]) {
    const dn = mouse('mousedown', b);
    const up = mouse('mouseup', b);
    inp.handleMouseDown(dn);
    inp.handleMouseUp(up);
    assert.equal(dn.prevented && up.prevented, true, `옆 버튼 ${b}`);
  }
  // 텍스트 칸(새 캐릭터 이름)
  const input = { tagName: 'INPUT', type: 'text' };
  const t = key('keydown', 'KeyS', { target: input });
  inp.handleKeyDown(t);
  assert.equal(t.prevented, false, '글자 입력은 막지 않는다');
  assert.equal(ui.got.at(-1), 'keydown:KeyS');
  assert.equal(appKeys.length, 4, '텍스트 칸의 키는 app 키 처리기로 가지 않는다');
  const tq = key('keydown', 'KeyQ', { target: input });
  inp.handleKeyDown(tq);
  assert.equal(inp.frame(STATE, null).potionDown, false, '텍스트 칸의 Q 는 포션이 아니다');
  const cmi = mouse('contextmenu', 2, { target: input });
  inp.handleContextMenu(cmi);
  assert.equal(cmi.prevented, false);
});

test('app.input: app 키 처리기가 먹은 키(Escape · 토글 · Enter 복귀)는 게임 입력이 아니다', () => {
  const { inp } = make({ appEats: ['KeyQ'] });
  const e = key('keydown', 'KeyQ');
  inp.handleKeyDown(e);
  assert.equal(e.prevented, true);
  assert.equal(inp.frame(STATE, null).potionDown, false);
});

test('app.input: 마우스 — 좌클릭 이동 · 우클릭 칸 0 · UI 위 · 모달 · 상호작용 요소 위의 누름은 게임 입력이 아니다 · 누르고 있던 이동은 패널 위로 지나가도 유지', () => {
  const { inp, ui } = make();
  inp.handleMouseDown(mouse('mousedown', MOUSE.move));
  inp.handleMouseDown(mouse('mousedown', MOUSE.skill0));
  let f = inp.frame(STATE, null);
  assert.deepEqual([f.lmb, f.lmbDown, f.slot[0], f.slotDown[0]], [true, true, true, true]);
  ui.blocks = true;                                       // 커서가 패널 위로
  inp.handleMouseMove(mouse('mousemove', 0, { clientX: 500 }));
  f = inp.frame(STATE, null);
  assert.equal(f.lmb, true, '유지');
  assert.equal(f.hover, null, 'UI 위에서는 대상 없음');
  inp.handleMouseUp(mouse('mouseup', MOUSE.move));
  inp.handleMouseUp(mouse('mouseup', MOUSE.skill0));
  inp.handleMouseDown(mouse('mousedown', MOUSE.move));
  assert.equal(inp.frame(STATE, null).lmbDown, false, 'UI 위 누름');
  ui.blocks = false;
  ui.modal = true;
  inp.handleMouseDown(mouse('mousedown', MOUSE.move));
  assert.equal(inp.frame(STATE, null).lmbDown, false, '모달');
  ui.modal = false;
  const btn = { closest: (sel) => (sel.includes('button') ? {} : null) };
  inp.handleMouseDown(mouse('mousedown', MOUSE.move, { target: btn }));
  assert.equal(inp.frame(STATE, null).lmbDown, false, '버튼 위');
  inp.handleMouseDown(mouse('mousedown', MOUSE.move, { target: { closest: () => null } }));
  assert.equal(inp.frame(STATE, null).lmbDown, true, '빈 곳(오버레이 배경) 위는 게임 입력');
});

test('app.input: hover 조합 — 몬스터 원기둥이 이름표보다 앞선다 · Alt(또는 늘 이름표)일 때만 이름표가 앞선다 · 이름표 > 드랍 · 물체 광선', () => {
  const { inp, ui } = make();
  const st = { scene: 'rift', mon: { kind: 'monster', id: 7, src: 'pick' }, rest: { kind: 'drop', id: 3, src: 'pick' } };
  ui.label = { kind: 'drop', id: 9 };
  let f = inp.frame(/** @type {any} */ (st), null);
  assert.deepEqual(f.hover, { kind: 'monster', id: 7, src: 'pick' }, '몬스터 먼저(떼 속 좌클릭이 줍기로 바뀌지 않게)');
  inp.handleKeyDown(key('keydown', 'AltLeft', { altKey: true }));
  f = inp.frame(/** @type {any} */ (st), null);
  assert.deepEqual(f.hover, { kind: 'drop', id: 9, src: 'label' }, 'Alt — 이름표 먼저 · src label');
  inp.handleKeyUp(key('keyup', 'AltLeft'));
  inp.settings = /** @type {any} */ ({ alwaysLabels: true });
  assert.equal(inp.frame(/** @type {any} */ (st), null).hover.src, 'label', '늘 이름표 설정');
  inp.settings = /** @type {any} */ ({ alwaysLabels: false });
  st.mon = null;
  assert.deepEqual(inp.frame(/** @type {any} */ (st), null).hover, { kind: 'drop', id: 9, src: 'label' }, '몬스터가 없으면 이름표');
  ui.label = null;
  assert.deepEqual(inp.frame(/** @type {any} */ (st), null).hover, { kind: 'drop', id: 3, src: 'pick' }, '그다음 드랍 · 물체 광선');
  st.rest = null;
  assert.equal(inp.frame(/** @type {any} */ (st), null).hover, null);
});

test('app.input: 첫 사용자 제스처(키 · 클릭)에서 한 번 · InputFrame 은 새 배열(돌려준 뒤 바꿔도 앞의 것이 변하지 않는다)', () => {
  const { inp, gestures } = make();
  inp.handleKeyDown(key('keydown', 'Digit1'));
  inp.handleMouseDown(mouse('mousedown', MOUSE.move));
  inp.handleKeyDown(key('keydown', 'KeyQ'));
  assert.equal(gestures(), 1);
  const a = inp.frame(STATE, null);
  inp.handleKeyUp(key('keyup', 'Digit1'));
  const b = inp.frame(STATE, null);
  assert.equal(a.slot[1], true);
  assert.equal(b.slot[1], false);
  assert.notEqual(a.slot, b.slot);
});

test('app.input: 휠 → 줌(한 칸 = 한 단계 · 트랙패드 잔 이벤트는 모은다) · UI 위 · Ctrl 휠은 건드리지 않는다', () => {
  const bus = new EventBus();
  const ui = fakeUi();
  const zooms = [];
  const inp = new InputCollector({ canvas: null, bus, ui, rc, win: null, doc: null, pick, onZoom: (s) => zooms.push(s) });
  const w = (deltaY, extra = {}) => ({ deltaY, deltaMode: 0, ctrlKey: false, clientX: 1, clientY: 1, prevented: false, preventDefault() { this.prevented = true; }, ...extra });
  const e = w(100);
  inp.handleWheel(e);
  assert.equal(e.prevented, true);
  inp.handleWheel(w(-120));
  for (let i = 0; i < 10; i++) inp.handleWheel(w(5));    // 트랙패드 50px
  inp.handleWheel(w(1, { deltaMode: 1 }));                // 줄 단위 한 칸
  assert.deepEqual(zooms, [1, -1, 1, 1]);
  const c = w(100, { ctrlKey: true });
  inp.handleWheel(c);
  assert.equal(c.prevented, false);
  ui.blocks = true;
  inp.handleWheel(w(100));
  assert.equal(zooms.length, 4);
});

test('app.input: 뗌은 창의 캡처 단계에서 눌림을 푼다 — 처리기(이름 칸)가 keyup 전파를 막아도 Shift · 스킬 키 · Alt 가 남지 않는다', () => {
  const bus = new EventBus();
  const ui = fakeUi();
  /** 단계를 나눠 받는 가짜 창 — 캡처(창 먼저) → 대상(이름 칸) → 버블(창) */
  const capture = new Map(), bubble = new Map();
  const win = {
    addEventListener(type, fn, opt) { const m = opt === true || (opt && opt.capture) ? capture : bubble; if (!m.has(type)) m.set(type, []); m.get(type).push(fn); },
    removeEventListener() {},
  };
  const inp = new InputCollector({ canvas: null, bus, ui, rc, keybinds: KEYBINDS, settings: /** @type {any} */ ({ alwaysLabels: false }), win, doc: null, pick });
  /** @param {string} type @param {string} code @param {boolean} [onField] 이름 칸에서(keyup 전파를 막는다 — newChar.js) */
  const dispatch = (type, code, onField = false) => {
    let stopped = false;
    const e = key(type, code, { stopPropagation() { stopped = true; } });
    for (const fn of capture.get(type) ?? []) fn(e);
    if (onField && type === 'keyup') e.stopPropagation();
    if (!stopped) for (const fn of bubble.get(type) ?? []) fn(e);
  };
  ui.modal = true;                                              // 새 캐릭터(모달)가 Shift 누름을 먹는다 → 눌림으로 남는다
  dispatch('keydown', 'ShiftLeft');
  dispatch('keydown', 'Digit2');
  dispatch('keydown', 'AltLeft');
  assert.equal(inp.held.has('ShiftLeft'), true);
  assert.equal(inp.alt, true);
  dispatch('keyup', 'ShiftLeft', true);                         // 이름 칸에서 뗐다 — 버블은 막혔다
  dispatch('keyup', 'Digit2', true);
  dispatch('keyup', 'AltLeft', true);
  ui.modal = false;
  const f = inp.frame(STATE, null);
  assert.equal(f.shift, false, 'Shift 가 눌린 채 남지 않는다');
  assert.equal(f.slot[2], false);
  assert.equal(inp.alt, false, 'Alt 이름표도');
});

test('app.input: 마우스 이벤트의 shiftKey — Alt 를 누른 채 Shift+클릭도 제자리 · false 면 놓친 Shift 뗌을 바로잡는다', () => {
  const { inp } = make();
  inp.handleKeyDown(key('keydown', 'AltLeft', { altKey: true }));
  inp.handleKeyDown(key('keydown', 'ShiftLeft', { altKey: true, shiftKey: true }));   // 조합 — keydown 은 버린다
  assert.equal(inp.held.has('ShiftLeft'), false);
  inp.handleMouseDown(mouse('mousedown', MOUSE.move, { shiftKey: true, altKey: true }));
  let f = inp.frame(STATE, null);
  assert.equal(f.shift, true, 'Alt + Shift + 클릭 = 제자리');
  assert.equal(f.lmbDown, true);
  inp.handleKeyUp(key('keyup', 'ShiftLeft', { altKey: true }));
  assert.equal(inp.frame(STATE, null).shift, false, 'Shift 를 떼면 끝');
  // 놓친 뗌 — held 에 남은 Shift 를 다음 마우스 이벤트(shiftKey false)가 푼다
  inp.handleKeyUp(key('keyup', 'AltLeft'));
  inp.held.add('ShiftLeft');
  inp.handleMouseMove(mouse('mousemove', 0, { shiftKey: false, altKey: false }));
  f = inp.frame(STATE, null);
  assert.equal(f.shift, false);
  // shiftKey 가 없는 가짜 이벤트는 그대로(키로 누른 Shift 유지)
  inp.handleKeyDown(key('keydown', 'ShiftLeft'));
  inp.handleMouseMove(mouse('mousemove', 0));
  assert.equal(inp.frame(STATE, null).shift, true);
});

test('app.input: dropEdges(rearm) — 버린 틱에 아직 누르고 있던 좌클릭은 다음 틱의 누름 · 뗐으면 없음 · 패널 닫힘(rearm 없음)은 그대로', () => {
  const { inp, bus } = make();
  inp.handleMouseDown(mouse('mousedown', MOUSE.move));
  inp.dropEdges(1, { rearm: true });
  let f = inp.frame(STATE, null);
  assert.deepEqual([f.lmb, f.lmbDown], [true, false], '버리는 틱');
  f = inp.frame(STATE, null);
  assert.deepEqual([f.lmb, f.lmbDown], [true, true], '다음 틱의 누름');
  assert.equal(inp.frame(STATE, null).lmbDown, false, '한 번만');
  // 막 동안 눌렀다 뗐다 — 버린다
  inp.handleMouseUp(mouse('mouseup', MOUSE.move));
  inp.handleMouseDown(mouse('mousedown', MOUSE.move));
  inp.handleMouseUp(mouse('mouseup', MOUSE.move));
  inp.dropEdges(1, { rearm: true });
  assert.equal(inp.frame(STATE, null).lmbDown, false);
  assert.equal(inp.frame(STATE, null).lmbDown, false);
  // 패널 닫힘 — 누르고 있어도 새 누름을 내지 않는다(이어지는 이동 의도가 그대로라)
  inp.handleMouseDown(mouse('mousedown', MOUSE.move));
  inp.frame(STATE, null);
  bus.emit(EV.PANEL_CLOSED, { panel: 'inventory', depth: 0, by: 'key' });
  inp.frame(STATE, null);
  assert.equal(inp.frame(STATE, null).lmbDown, false);
});
