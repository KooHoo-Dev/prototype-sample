// OWNER: 리뷰 수정(ui-app) — 계약 §11.2 · §11.4 · §11.5 · §11.6 · §11.13
// app/Game.js 의 화면 · 저장 · 전환 · 봇 경로를 DOM · WebGL 없이 — 가짜 ui · 가짜 localStorage · 가짜 window(EventTarget)로 Game 을 엮어 돌린다.
// (부트의 렌더 · 레이어는 만들지 않는다 — rc 가 없으면 _render 는 아무것도 하지 않는다)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/app/Game.js';
import { InputCollector } from '../src/app/input.js';
import { createScreens } from '../src/app/screens.js';
import { charKey, createStorage } from '../src/app/storage.js';
import { DT, SAVE_KEYS } from '../src/core/constants.js';
import { EV, EventBus } from '../src/core/events.js';
import { KEYBINDS } from '../src/data/keybinds.js';
import { GameSim } from '../src/sim/GameSim.js';
import { pointsFree } from '../src/sim/progression/progress.js';
import { createAccount } from '../src/sim/state.js';

const MODAL = new Set(['title', 'charSelect', 'newChar', 'pause', 'settings', 'help', 'death', 'riftComplete', 'confirm', 'hint',
  'blacksmith', 'general', 'gambler', 'mystic', 'stash', 'riftStone', 'analytics']);

/** 가짜 localStorage(공유 가능 — 두 탭) */
function fakeLs({ blocked = false } = {}) {
  const m = new Map();
  return {
    m,
    getItem: (k) => { if (blocked) throw new Error('blocked'); return m.has(k) ? m.get(k) : null; },
    setItem: (k, v) => { if (blocked) throw new Error('blocked'); m.set(k, String(v)); },
    removeItem: (k) => { if (blocked) throw new Error('blocked'); m.delete(k); },
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}

/** 가짜 UIRoot — 패널 스택 · 알림 · 지속 알림 · PANEL_CLOSED @param {EventBus} bus */
function fakeUi(bus) {
  return {
    /** @type {string[]} */ stack: [],
    /** @type {string[]} */ notices: [],
    /** @type {string|null} */ sticky: null,
    openPanel(id) {
      const i = this.stack.indexOf(id);
      if (i >= 0) this.stack.splice(i, 1);
      this.stack.push(id);
      return true;
    },
    closePanel(id = null, by = 'code') {
      const idx = id === null ? this.stack.length - 1 : this.stack.indexOf(id);
      if (idx < 0) return false;
      const [p] = this.stack.splice(idx, 1);
      bus.emit(EV.PANEL_CLOSED, { panel: p, depth: this.stack.length, by });
      return true;
    },
    closeAll(by = 'code') { while (this.stack.length) this.closePanel(null, by); },
    topPanel() { return this.stack[this.stack.length - 1] ?? null; },
    isModal() { return this.stack.some((p) => MODAL.has(p)); },
    anyOpen() { return this.stack.length > 0; },
    isOpen(id) { return this.stack.includes(id); },
    notice(key) { this.notices.push(key); },
    setSticky(key) { this.sticky = key; },
    update() {},
    handleKey() { return this.isModal(); },
    blocksPointer() { return false; },
    labelHover() { return null; },
    setLabels() {},
  };
}

/**
 * Game 을 부트 없이 엮는다(_boot 의 저장 · 화면 · 전환 · 저장 요청 배선과 같은 순서).
 * @param {{ls?:any, dev?:boolean, seed?:number, win?:any, now?:() => number}} [o]
 */
function makeGame({ ls = fakeLs(), dev = false, seed = 7, win = null, now = undefined } = {}) {
  const doc = win ? { defaultView: win, visibilityState: 'visible', addEventListener() {} } : null;
  const g = new Game(/** @type {any} */ (doc));
  g.storage = createStorage(now ? { ls, now } : { ls });
  g.storageOk = g.storage.available();
  g.dev = dev;
  let account = createAccount();
  if (!dev && g.storageOk) {
    const r = g.storage.loadAccount();
    account = r.account;
    if (r.future) g.readOnly = true;
    g._seenAt = g.storage.accountSavedAt();
  }
  g.seed = seed;
  const bus = (g.bus = new EventBus());
  g.screens = createScreens({ bus });
  g.sim = new GameSim({ bus, seed, account, devSession: dev });
  g.ui = fakeUi(bus);
  /** 커서 = 플레이어 오른쪽 3m 땅(누르면 걷기) */
  const rc = {
    groundAt: () => ({ x: g.sim.state.player.pos.x + 3, z: g.sim.state.player.pos.z }),
    rayFromScreen: () => ({ ox: 0, oy: 10, oz: 0, dx: 0, dy: -1, dz: 0 }),
  };
  g.input = new InputCollector({
    canvas: null, bus, ui: g.ui, rc, keybinds: KEYBINDS, settings: g.settings, win: null, doc: null, pick: () => null,
    onAppKey: (e) => g._appKey(e), onAltBlocked: () => g._onAltBlocked(),
  });
  g.input.handleMouseMove(/** @type {any} */ ({ clientX: 400, clientY: 300 }));
  bus.on(EV.TRAVEL_REQUEST, (p) => g._onTravelRequest(p));
  bus.on(EV.SAVE_REQUEST, (p) => g.saves.request(p && p.scope, p && p.reason));
  if (win) g._installWindowHooks();
  g.sim.start();
  g.screens.go('title');
  if (!dev && !g.storageOk) g._sticky('notice.saveBlocked', true);
  g.booted = true;
  return g;
}

/** 저장소의 캐릭터 세이브 @param {any} ls @param {number} slot */
const stored = (ls, slot = 0) => JSON.parse(ls.m.get(charKey(slot))).char;

/** 전환 막을 끝까지(실제 루프처럼 막은 시간으로 · 그 뒤 n 틱) @param {Game} g @param {number} [ticks] */
function settle(g, ticks = 1) {
  for (let i = 0; i < 200 && (g.trans || g.sim.state.pendingTravel); i++) g.debugStep(1);
  if (ticks > 0) g.debugStep(ticks);
}

test('app.game: 보통 세션에서 봇을 켜면 그 전 진행을 바로 쓰고 이후 세션은 저장하지 않는다(실제 세이브의 전설 · 스킬 포인트가 그대로) · 지속 알림', () => {
  const ls = fakeLs();
  const g = makeGame({ ls });
  assert.equal(g.actions.newChar({ slot: 0, cls: 'warrior', name: 'Keep' }).ok, true);
  g.sim.debugGrant({ items: ['legendary', 'set', 'legendary'], gold: 50 });
  g.sim.debugSetLevel(6);
  const before = g.sim.state.char;
  const bagIds = before.bag.filter(Boolean).map((it) => it.id).sort();
  assert.ok(bagIds.length >= 3);
  const free = pointsFree(before);
  assert.ok(free > 0, '찍지 않은 포인트가 있다');
  const ranks = JSON.stringify(before.skills.ranks);
  assert.equal(g.persist(), true);
  assert.equal(g.actions.setBot(true).ok, true);
  // 켜기 직전의 진행(레벨 6 · 가방 · 포인트)은 저장돼 있다
  const at = stored(ls);
  assert.equal(at.level, 6);
  assert.deepEqual(at.bag.filter(Boolean).map((it) => it.id).sort(), bagIds);
  assert.equal(g.persist(), false, '봇 관전 세션은 저장하지 않는다');
  assert.equal(g.ui.sticky, 'notice.botNoSave');
  // 봇이 마을 정비(팔기 · 포인트) → 균열까지 돈다
  for (let i = 0; i < 60; i++) g.debugStep(60);
  const live = g.sim.state.char;
  const liveIds = new Set([...live.bag, ...Object.values(live.equip)].filter(Boolean).map((it) => it.id));
  assert.ok(pointsFree(live) < free && bagIds.some((id) => !liveIds.has(id)), '봇이 실제로 팔고 찍었다(시험이 무엇인가를 본다)');
  g._persistNow();
  const after = stored(ls);
  assert.deepEqual(after.bag.filter(Boolean).map((it) => it.id).sort(), bagIds, '저장된 가방은 봇 전 그대로');
  assert.equal(JSON.stringify(after.skills.ranks), ranks, '저장된 스킬 랭크 그대로(남은 포인트를 찍지 않았다)');
  assert.equal(after.level, 6);
  // 봇을 꺼도 이 세션은 저장하지 않는다(새로 고치면 봇 전 세이브)
  g.actions.setBot(false);
  assert.equal(g.persist(), false);
  assert.equal(g.ui.sticky, 'notice.botNoSave');
});

test('app.game: 개발 세션 · 저장 막힘 세션에서 「타이틀로」 뒤 계속하기 · 캐릭터 선택은 떼어 둔 그 캐릭터로 돌아간다', () => {
  for (const mode of ['dev', 'blocked']) {
    const g = mode === 'dev' ? makeGame({ dev: true }) : makeGame({ ls: fakeLs({ blocked: true }) });
    assert.equal(g.persist(), false, mode);
    assert.equal(g.actions.newChar({ slot: 0, cls: 'mage', name: 'Fresh' }).ok, true, mode);
    g.sim.debugGrant({ gold: 321 });
    const ch = g.sim.state.char;
    g.actions.quitToTitle();
    assert.equal(g.sim.state.char, null);
    assert.equal(g.screens.current, 'title');
    const r = g.actions.continueGame();
    assert.deepEqual(r, { ok: true }, mode);
    assert.equal(g.sim.state.char, ch, `${mode}: 같은 캐릭터`);
    assert.equal(g.sim.state.char.gold, 321);
    assert.equal(g.screens.current, 'play');
    // 다시 나가 캐릭터 선택으로도
    g.actions.quitToTitle();
    assert.deepEqual(g.actions.selectChar(0), { ok: true }, mode);
    assert.equal(g.sim.state.char.name, 'Fresh');
    // 지운 칸 · 새로 만든 칸은 떼어 둔 캐릭터를 버린다
    g.actions.quitToTitle();
    g.actions.deleteChar(0);
    assert.equal(g.actions.selectChar(0).ok, false, `${mode}: 지운 칸은 돌아오지 않는다`);
  }
});

test('app.game: 같은 저장소를 쓰는 다른 탭이 세이브를 쓰면 이 탭은 더 쓰지 않는다(오래된 상태로 덮지 않는다) · 지속 알림 · 무관한 키는 무시', () => {
  const ls = fakeLs();
  const winA = new EventTarget();
  const a = makeGame({ ls, win: winA });
  assert.equal(a.actions.newChar({ slot: 0, cls: 'warrior', name: 'Two' }).ok, true);
  assert.equal(stored(ls).gold, 0);
  // 무관한 키(설정 · 다른 프로토타입 · 백업 · 탐침)는 무시
  for (const key of [SAVE_KEYS.settings, 'other-proto:account', SAVE_KEYS.backupPrefix + 'x:1', 'rift-hunter:probe']) {
    winA.dispatchEvent(Object.assign(new Event('storage'), { key }));
  }
  assert.equal(a.persist(), true);
  // 탭 B — 같은 캐릭터를 이어 하고 골드 · 전설을 얻어 저장
  const b = makeGame({ ls });
  assert.deepEqual(b.actions.continueGame(), { ok: true });
  b.sim.debugGrant({ gold: 5000, items: ['legendary', 'set'] });
  b._persistNow();
  assert.equal(stored(ls).gold, 5000);
  // 브라우저는 다른 탭에만 storage 이벤트를 보낸다
  winA.dispatchEvent(Object.assign(new Event('storage'), { key: charKey(0) }));
  assert.equal(a.persist(), false, 'A 는 더 쓰지 않는다');
  assert.equal(a.ui.sticky, 'notice.otherTab');
  a.sim.debugGrant({ xp: 10 });
  a._persistNow();
  a.actions.quitToTitle();
  assert.equal(stored(ls).gold, 5000, 'B 의 진행이 남는다');
  assert.equal(stored(ls).bag.filter(Boolean).length, 2);
  // localStorage.clear()(key null)도 다른 탭의 쓰기다
  const winC = new EventTarget();
  const c = makeGame({ ls, win: winC });
  winC.dispatchEvent(Object.assign(new Event('storage'), { key: null }));
  assert.equal(c.persist(), false);
});

test('app.game: storage 이벤트가 오기 전(브라우저는 ~1초 늦게 보낸다)에도 — 쓰기 직전 저장소의 계정 savedAt 이 이 탭이 본 것보다 새로우면 쓰지 않는다', () => {
  const ls = fakeLs();
  let clock = 1000;
  const now = () => (clock += 5);
  const a = makeGame({ ls, now });
  assert.equal(a.actions.newChar({ slot: 0, cls: 'mage', name: 'Race' }).ok, true);
  const b = makeGame({ ls, now });
  assert.deepEqual(b.actions.continueGame(), { ok: true });
  b.sim.debugGrant({ gold: 777 });
  b._persistNow();
  // A 는 이벤트를 아직 받지 못했다 — 처치 경험치 · 장면 전환 같은 보통 저장 길
  a.sim.debugGrant({ xp: 3 });
  a._persistNow();
  assert.equal(stored(ls).gold, 777, 'B 의 진행이 남는다');
  assert.equal(a.persist(), false);
  assert.equal(a.ui.sticky, 'notice.otherTab');
  // B 는 자기 쓰기 뒤에도 계속 쓴다(자기 savedAt 은 낡음이 아니다)
  b.sim.debugGrant({ gold: 1 });
  b._persistNow();
  assert.equal(stored(ls).gold, 778);
  assert.equal(b.persist(), true);
  // 처음 실행(계정 없음) 두 탭 — 먼저 쓴 쪽을 나중 쪽이 덮지 않는다
  const ls2 = fakeLs();
  const c = makeGame({ ls: ls2, now });
  const d = makeGame({ ls: ls2, now });
  c.actions.newChar({ slot: 0, cls: 'warrior', name: 'First' });
  d.actions.newChar({ slot: 1, cls: 'mage', name: 'Second' });
  assert.equal(d.persist(), false, '계정이 없던 탭이 그 사이 생긴 계정을 덮지 않는다');
  const acc2 = JSON.parse(ls2.m.get(SAVE_KEYS.account));
  assert.equal(acc2.chars[0]?.name, 'First', '먼저 쓴 탭의 계정 그대로');
  assert.equal(acc2.chars[1], null);
});

test('app.game: 전환 막이 내려가는 동안 포커스를 잃거나 Esc 로 연 일시정지는 막 아래 패널 정리 뒤에도 남는다(돌아오면 「계속」 전까지 멈춤)', () => {
  for (const how of ['blur', 'esc']) {
    const win = new EventTarget();
    const g = makeGame({ win });
    g.actions.newChar({ slot: 0, cls: 'warrior', name: 'Fade' });
    g.ui.closeAll();
    assert.equal(g.actions.openRift(1).ok, true);
    assert.ok(g.trans && g.trans.phase === 'out', how);
    if (how === 'blur') win.dispatchEvent(new Event('blur'));
    else g._appKey(/** @type {any} */ ({ code: 'Escape', repeat: false }));
    assert.equal(g.ui.topPanel(), 'pause', how);
    g._advanceTransition(0.31);                                 // 막 아래 commit — 옛 장면 패널 정리
    assert.equal(g.sim.state.scene, 'rift');
    assert.equal(g.ui.isOpen('pause'), true, `${how}: 일시정지가 남는다`);
    g._advanceTransition(0.31);
    assert.equal(g.trans, null);
    win.dispatchEvent(new Event('focus'));
    assert.equal(g._canStep(), false, `${how}: 「계속」 전에는 돌지 않는다`);
    g.actions.resume();
    assert.equal(g._canStep(), true, how);
  }
});

test('app.game: 전환 막 동안 누르기 시작했거나 막 내내 누르고 있던 좌클릭은 막이 걷힌 뒤 눌림으로 잡힌다 · 막 동안 눌렀다 뗀 클릭은 버린다(§10.5-7)', () => {
  /** @param {'during'|'before'|'tap'} how */
  const run = (how) => {
    const g = makeGame({ dev: true, seed: 3 });
    g.actions.newChar({ slot: 0, cls: 'warrior', name: 'Hold' });
    g.ui.closeAll();
    g.debugStep(2);
    const down = /** @type {any} */ ({ button: 0, clientX: 400, clientY: 300, target: null, preventDefault() {} });
    if (how === 'before') { g.input.handleMouseDown(down); g.debugStep(1); }
    const orr = g.actions.openRift(1); assert.equal(orr.ok, true, JSON.stringify(orr) + JSON.stringify(g.sim.state.player.intent));
    g.debugStep(3);                                               // 막이 내려가는 중
    if (how !== 'before') g.input.handleMouseDown(down);
    if (how === 'tap') g.input.handleMouseUp(down);
    settle(g, 0);
    assert.equal(g.sim.state.scene, 'rift');
    const p0 = { ...g.sim.state.player.pos };
    g.debugStep(20);
    const p = g.sim.state.player;
    return { moved: Math.hypot(p.pos.x - p0.x, p.pos.z - p0.z), intent: p.intent.kind };
  };
  for (const how of /** @type {const} */ (['during', 'before'])) {
    const r = run(how);
    assert.ok(r.moved > 0.5, `${how}: 누르고 있던 좌클릭으로 걷는다(이동 ${r.moved.toFixed(2)}m · ${r.intent})`);
  }
  const tap = run('tap');
  assert.ok(tap.moved < 0.01, `막 동안 눌렀다 뗀 클릭은 새 장면에 새지 않는다(${tap.moved})`);
});

test('app.game: 타이틀 · 새 캐릭터 화면에서 놓치지 않은 눌림은 play 로 넘어가지 않는다(Shift 가 눌린 채 남지 않는다)', () => {
  const g = makeGame({ dev: true });
  g.ui.openPanel('newChar');
  g.input.handleKeyDown(/** @type {any} */ ({ type: 'keydown', code: 'ShiftLeft', repeat: false, ctrlKey: false, metaKey: false, altKey: false, target: null, preventDefault() {} }));
  assert.equal(g.input.held.has('ShiftLeft'), true, '모달이 먹은 Shift 는 눌림으로 남는다(그 뒤 keyup 을 이름 칸이 삼킨 경우)');
  g.actions.newChar({ slot: 0, cls: 'warrior', name: 'Ab' });
  assert.equal(g.input.held.size, 0, 'play 로 들어갈 때 눌림을 모두 놓는다');
  assert.equal(g.input.frame(g.sim.state, null).shift, false);
});

test('app.game: Alt 를 누른 채 게임 키(Q · T · 1~4)를 누르면 「Alt 를 떼고」 알림을 한 번 띄운다(조합은 건드리지 않는다)', () => {
  const g = makeGame({ dev: true });
  g.actions.newChar({ slot: 0, cls: 'warrior', name: 'Alt' });
  g.ui.closeAll();
  const k = (type, code, extra = {}) => /** @type {any} */ ({ type, code, repeat: false, ctrlKey: false, metaKey: false, altKey: false, target: null, prevented: false, preventDefault() { this.prevented = true; }, ...extra });
  g.input.handleKeyDown(k('keydown', 'AltLeft', { altKey: true }));
  const q = k('keydown', 'KeyQ', { altKey: true });
  g.input.handleKeyDown(q);
  assert.equal(q.prevented, false, '조합의 기본 동작은 막지 않는다');
  assert.equal(g.input.frame(g.sim.state, null).potionDown, false, '게임 입력도 아니다(리포 규칙)');
  g.input.handleKeyDown(k('keydown', 'Digit1', { altKey: true }));
  assert.deepEqual(g.ui.notices.filter((n) => n === 'notice.altBlocked').length, 1, 'Alt 한 번 누름에 한 번');
  g.input.handleKeyUp(k('keyup', 'AltLeft'));
  g.input.handleKeyDown(k('keydown', 'AltLeft', { altKey: true }));
  g.input.handleKeyDown(k('keydown', 'KeyT', { altKey: true }));
  assert.equal(g.ui.notices.filter((n) => n === 'notice.altBlocked').length, 2);
  // 봇 · 모달 · 타이틀에서는 띄우지 않는다
  g.ui.openPanel('pause');
  g.input.handleKeyUp(k('keyup', 'AltLeft'));
  g.input.handleKeyDown(k('keydown', 'AltLeft', { altKey: true }));
  g.input.handleKeyDown(k('keydown', 'KeyQ', { altKey: true }));
  assert.equal(g.ui.notices.filter((n) => n === 'notice.altBlocked').length, 2);
  void DT;
});
