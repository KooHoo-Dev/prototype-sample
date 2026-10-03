// OWNER: P9 — 리뷰 수정(ui-app) 회귀: Game 의 저장 규칙(여러 탭) · 컨텍스트 상실 · 패널을 닫는 클릭의 더블클릭.
// 실제 GameSim · UIRoot(가짜 DOM — fakeDom.js) · InputCollector(가짜 캔버스 · 창) · screens 위에서 Game 의 배선(_wireInput · _wireBus ·
// _wireWindow)을 그대로 돌린다. 렌더러 · 레이어 · 소리는 가짜다. 두 「탭」은 같은 MemStorage 를 쓰는 Game 두 개다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement, MemStorage, installFakeDom } from './fakeDom.js';

installFakeDom();
const { Game } = await import('../src/app/Game.js');
const { UIRoot } = await import('../src/ui/UIRoot.js');
const { GameSim } = await import('../src/sim/GameSim.js');
const { EventBus } = await import('../src/core/events.js');
const { InputCollector } = await import('../src/app/input.js');
const { createScreens } = await import('../src/app/screens.js');
const { parseQuery } = await import('../src/app/query.js');
const { SAVE_KEY } = await import('../src/core/constants.js');
const { DT } = await import('../src/core/constants.js');

/** 이벤트 대상 가짜(창 · 문서 · 캔버스) */
class FakeTarget {
  constructor() { this.l = new Map(); }
  addEventListener(n, fn) { (this.l.get(n) || this.l.set(n, []).get(n)).push(fn); }
  removeEventListener(n, fn) { const a = this.l.get(n) || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
  fire(n, e = {}) { for (const fn of (this.l.get(n) || []).slice()) fn({ preventDefault() {}, cancelable: true, ...e }); }
}

const noopLayer = { update() {} };

/**
 * _boot 의 저장 · 배선 부분을 가짜 렌더 위에서 그대로 — 타이틀에서 시작한다.
 * @param {MemStorage} store @param {{now?:() => number}} [opt]
 */
function makeTab(store, opt = {}) {
  const win = new FakeTarget();
  win.location = { search: '', reloads: 0, reload() { this.reloads++; } };
  const doc = new FakeTarget();
  Object.assign(doc, { defaultView: win, hidden: false, visibilityState: 'visible', hasFocus: () => true, pointerLockElement: null });
  doc.exitPointerLock = () => { doc.pointerLockElement = null; doc.fire('pointerlockchange'); };
  const canvas = new FakeTarget();
  canvas.requestPointerLock = () => { doc.pointerLockElement = canvas; doc.fire('pointerlockchange'); };
  const g = new Game(/** @type {any} */ (doc));
  g.store = /** @type {any} */ (store);
  g.query = parseQuery('');
  g.persisted = {};
  g.overrides = {};
  g.overriddenKeys = [];
  g.settings = { hints: true };
  g.devSession = false;
  const loaded = g._initSave();
  const bus = new EventBus();
  g.bus = bus;
  g.sim = new GameSim({ bus, seed: 7, save: loaded.save });
  g.actions = g._makeActions();
  g.canvas = /** @type {any} */ (canvas);
  g.ui = new UIRoot({ root: /** @type {any} */ (new FakeElement('div')), bus, sim: g.sim, settings: g.settings, actions: g.actions, fishPreview: /** @type {any} */ ({ ok: false }) });
  g.input = new InputCollector({ canvas: /** @type {any} */ (canvas), settings: g.settings, bus, win, doc, now: opt.now });
  g.audio = /** @type {any} */ ({ paused: false, setPaused(on) { this.paused = !!on; }, unlock() {}, update() {}, stats() { return { nodes: 0 }; } });
  g.rc = /** @type {any} */ ({ render() {}, prewarm() {} });
  Object.assign(g, { camera: noopLayer, world: noopLayer, tackle: noopLayer, fish: noopLayer, fx: noopLayer });
  g.screens = createScreens({ ui: { fade: () => Promise.resolve() }, bus, settle: () => Promise.resolve(), onBusy: (on) => g._onTransition(on), onPendingPause: () => g._onPendingPause() });
  g._wireInput();
  g._wireBus();
  g._wireWindow();
  g.sim.start();
  g.screens.go('title');
  g._openTitle(!!loaded.save, loaded.broken, loaded.future);
  return { g, win, doc, canvas };
}

/** @param {MemStorage} store */
function saved(store) {
  const raw = store.getItem(SAVE_KEY);
  if (!raw) return null;
  const o = JSON.parse(raw);
  return { level: o.profile.level, money: o.profile.money, scene: o.scene };
}

/** 한 프레임(누산 루프 · ui · 저장 플래그) @param {any} g @param {number} [n] */
function frames(g, n = 1) {
  for (let i = 0; i < n; i++) g._frame(DT);
}

test('여러 탭: 옛 탭이 숨거나 닫혀도 새 탭의 진행을 덮지 않는다(storage 이벤트)', async () => {
  const store = new MemStorage();
  const A = makeTab(store);
  A.g.newGame();
  await A.g.screens.idle();
  frames(A.g);
  assert.deepEqual(saved(store), { level: 1, money: saved(store).money, scene: 'home' });
  const money0 = saved(store).money;

  // B: 같은 세이브로 이어하기
  const B = makeTab(store);
  assert.equal(B.g.ui.panels.title.args.hasSave, true);
  B.g.continueGame();
  await B.g.screens.idle();
  assert.equal(B.g.screens.screen, 'play');

  // B 를 앞으로 → A 가 숨으며 저장(A 가 지금 주인) → B 에 storage 이벤트 → B 는 옛것
  A.doc.hidden = true;
  A.doc.visibilityState = 'hidden';
  A.doc.fire('visibilitychange');
  B.win.fire('storage', { key: SAVE_KEY });
  assert.equal(B.g.staleSave, true, 'B 는 다른 탭의 쓰기를 알았다');
  assert.equal(B.g.screens.screen, 'title', 'B 는 타이틀로 갔다');
  assert.equal(B.g.ui.activePanel, 'title');
  assert.equal(B.g.ui.panels.title.args.stale, true);
  assert.ok(B.g.ui.titleNotes.includes('title.staleSave'), '타이틀에 안내');

  // A 에서 진행 → A 저장
  A.g.sim.debugGrant({ xp: 300, money: 1000 });
  A.g.saveNow();
  const progressed = saved(store);
  assert.ok(progressed.level >= 2, 'A 의 진행이 저장됐다');

  // 옛 탭 B 를 닫는다 → 덮지 않는다
  B.win.fire('pagehide');
  B.win.fire('beforeunload');
  assert.deepEqual(saved(store), progressed, '옛 탭이 닫혀도 세이브는 A 의 것');
  assert.ok(saved(store).money >= money0 + 1000);

  // B 의 타이틀은 최신 세이브의 레벨을 보인다 · 「최신 기록 불러오기」는 다시 읽는다(reload)
  B.win.fire('storage', { key: SAVE_KEY });
  assert.equal(B.g.ui.panels.title.args.saveInfo.level, progressed.level);
  B.g.continueGame();
  assert.equal(B.win.location.reloads, 1, '이어하기 = 다시 읽기');
  assert.equal(B.g.screens.screen, 'title');
});

test('여러 탭: storage 이벤트를 놓쳐도 쓰기 전에 원문을 비교해 덮지 않는다', async () => {
  const store = new MemStorage();
  const A = makeTab(store);
  A.g.newGame();
  await A.g.screens.idle();
  frames(A.g);
  const B = makeTab(store);
  B.g.continueGame();
  await B.g.screens.idle();
  // A 가 진행해 저장 — B 에 이벤트가 오지 않았다
  A.g.sim.debugGrant({ xp: 300 });
  A.g.saveNow();
  const progressed = saved(store);
  assert.ok(progressed.level >= 2);
  // B 의 SAVE_REQUEST(예: 미끼 바꾸기) → 프레임 끝 저장 → 충돌 → 쓰지 않고 타이틀
  B.g.sim.markHintSeen('drift');
  frames(B.g);
  assert.deepEqual(saved(store), progressed, 'B 의 프레임 끝 저장이 덮지 않았다');
  assert.equal(B.g.staleSave, true);
  assert.equal(B.g.screens.screen, 'title');
  B.win.fire('pagehide');
  assert.deepEqual(saved(store), progressed);
  // A 는 계속 저장한다(자기 쓰기와 같은 원문)
  A.g.sim.debugGrant({ money: 5 });
  A.g.saveNow();
  assert.equal(saved(store).money, progressed.money + 5);
  assert.equal(A.g.staleSave, false);
});

test('여러 탭: 세이브 없이 연 타이틀 — 다른 탭이 세이브를 만들면 「새 게임」이 확인 없이 덮지 않는다', async () => {
  const store = new MemStorage();
  const B = makeTab(store);   // 세이브 없음
  assert.equal(B.g.ui.panels.title.args.hasSave, false);
  const A = makeTab(store);
  A.g.newGame();
  await A.g.screens.idle();
  A.g.sim.debugGrant({ xp: 300 });
  A.g.saveNow();
  const progressed = saved(store);
  // 이벤트가 오면 B 의 타이틀이 최신으로(이어하기 = 최신 기록 · 새 게임은 확인)
  B.win.fire('storage', { key: SAVE_KEY });
  assert.equal(B.g.ui.panels.title.args.hasSave, true);
  assert.equal(B.g.ui.panels.title.args.saveInfo.level, progressed.level);

  // 이벤트를 놓친 탭 C 에서 「새 게임」(타이틀은 세이브 없음으로 그렸다) → 덮지 않고 타이틀을 다시 그린다
  const store2 = new MemStorage();
  const C = makeTab(store2);
  const D = makeTab(store2);
  D.g.newGame();
  await D.g.screens.idle();
  D.g.sim.debugGrant({ xp: 300 });
  D.g.saveNow();
  const dSave = saved(store2);
  C.g.newGame();   // title 패널은 hasSave false 라 확인 없이 actions.newGame 을 부른다
  await C.g.screens.idle();
  assert.equal(C.g.screens.screen, 'title', '새 게임을 시작하지 않았다');
  assert.deepEqual(saved(store2), dSave, '다른 탭의 세이브가 그대로');
  assert.equal(C.g.ui.panels.title.args.hasSave, true, '이제 「새 게임」은 확인을 받는다');
  // 확인 뒤의 새 게임은 이 탭이 주인이 된다(백업 후) — 그 뒤 저장이 된다
  C.g.newGame();
  await C.g.screens.idle();
  frames(C.g);
  assert.equal(C.g.screens.screen, 'play');
  assert.equal(saved(store2).level, 1, '새 게임이 저장됐다');
  assert.equal(C.g.staleSave, false);
  const backups = [...store2.map.keys()].filter(k => k.startsWith(SAVE_KEY + '.bak.') && !k.endsWith('.index'));
  assert.ok(backups.length >= 1, '덮기 전에 백업했다');
});

test('여러 탭: 숨은 옛 탭이 타이틀로 갈 때 소리를 켜지 않는다', async () => {
  const store = new MemStorage();
  const A = makeTab(store);
  A.g.newGame();
  await A.g.screens.idle();
  frames(A.g);
  const B = makeTab(store);
  B.g.continueGame();
  await B.g.screens.idle();
  B.doc.hidden = true;
  B.doc.hasFocus = () => false;
  B.win.fire('blur');   // 포커스 잃음 → 일시정지 패널 · 소리 멈춤
  assert.equal(B.g.ui.activePanel, 'pause');
  assert.equal(B.g.audio.paused, true);
  A.g.sim.debugGrant({ money: 7 });
  A.g.saveNow();
  B.win.fire('storage', { key: SAVE_KEY });
  assert.equal(B.g.screens.screen, 'title');
  assert.equal(B.g.audio.paused, true, '숨은 탭은 소리를 켜지 않는다');
});

test('컨텍스트 상실: 일시정지를 닫아도 지속 알림 · 복구되면 알림과 일시정지', async () => {
  const store = new MemStorage();
  const T = makeTab(store);
  T.g.newGame();
  await T.g.screens.idle();
  T.canvas.fire('webglcontextlost');
  assert.equal(T.g.ui.activePanel, 'pause');
  assert.equal(T.g.paused, true);
  T.g.ui.closePanel('esc');
  assert.equal(T.g.paused, false);
  assert.equal(T.g.audio.paused, true, '복구 전에는 소리도 멈춰 있다');
  const tick0 = T.g.sim.state.tick;
  for (let i = 0; i < 300; i++) T.g._frame(DT);   // 5초
  assert.equal(T.g.sim.state.tick, tick0, 'sim 은 멈춰 있다');
  const texts = T.g.ui.notices.map(n => n.node.textContent);
  assert.ok(texts.some(s => s.includes('그래픽 장치')), '알림이 수명으로 사라지지 않았다: ' + JSON.stringify(texts));
  T.canvas.fire('webglcontextrestored');
  assert.equal(T.g.ui.activePanel, 'pause', '복구되면 일시정지 — 예고 없이 재개하지 않는다');
  const after = T.g.ui.notices.map(n => n.node.textContent);
  assert.ok(!after.some(s => s.includes('다시 잡는 중')), '지속 알림은 내렸다');
  assert.ok(after.some(s => s.includes('복구됐다')), '복구 알림');
  assert.deepEqual(T.g.errors.filter(e => e === 'webglcontextlost'), []);
  T.g.ui.closePanel('esc');
  T.g._frame(DT);
  T.g._frame(DT);
  assert.ok(T.g.sim.state.tick > tick0, '계속하기 뒤에는 돈다');
});

test('패널을 클릭으로 닫으면 app 이 클릭 가드를 건다 — 두 번째 누름은 캐스팅을 시작하지 않는다', async () => {
  let now = 0;
  const T = makeTab(new MemStorage(), { now: () => now });
  T.g.devSession = true;   // 세이브 무관
  T.g.enterPlay();
  T.g.sim.debugGotoSpot('lake_gravel');
  T.canvas.fire('mousedown', { button: 0 });   // 락 잡기(삼킴)
  T.win.fire('mouseup', { button: 0 });
  assert.equal(T.g.input.pointerLocked, true);
  T.g.sim.debugSkipToResult('carp', 0.5);
  T.g.ui.update(T.g.sim.state, DT);
  assert.equal(T.g.ui.activePanel, 'result');
  const worm = { ...T.g.sim.state.profile.baits };
  const casts = T.g.sim.state.profile.stats.casts;
  await new Promise((r) => setTimeout(r, 300));   // 결과 패널의 확인 유예(PANEL_INPUT_GRACE · 실제 시간)
  // 「어창에 넣기」 클릭 = keepCatch → 결과 패널이 confirm 으로 닫힌다 → 락 다시(soft) · 가드
  now = 1000;
  T.g.ui.panels.result.items[0].el.click();
  assert.equal(T.g.ui.activePanel, null);
  assert.equal(T.g.input.pointerLocked, true);
  now = 1150;
  T.canvas.fire('mousedown', { button: 0, detail: 2 });
  for (let i = 0; i < 20; i++) T.g._frame(DT);
  T.win.fire('mouseup', { button: 0, detail: 2 });
  for (let i = 0; i < 20; i++) T.g._frame(DT);
  const s = T.g.sim.state;
  assert.equal(s.rig.phase, 'ready', '캐스팅이 나가지 않았다');
  assert.equal(s.profile.stats.casts, casts);
  assert.deepEqual(s.profile.baits, worm, '미끼가 그대로');
});

test('충전 중 패널을 열거나 포커스를 잃으면 캐스팅 없이 ready — 그동안 뗀 좌클릭이 닫힌 뒤 캐스팅으로 새지 않는다(최종 게이트)', async () => {
  const T = makeTab(new MemStorage());
  T.g.devSession = true;   // 세이브 무관
  T.g.enterPlay();
  T.g.sim.debugGotoSpot('lake_gravel');
  T.canvas.fire('mousedown', { button: 0 });   // 락 잡기(삼킴)
  T.win.fire('mouseup', { button: 0 });
  assert.equal(T.g.input.pointerLocked, true);
  const s = T.g.sim.state;
  const casts = s.profile.stats.casts;
  const baits = { ...s.profile.baits };

  // ① Tab(채비 패널) — 충전 40프레임 → 패널 → 뗌 → 닫기
  T.canvas.fire('mousedown', { button: 0 });
  frames(T.g, 40);
  assert.equal(s.rig.phase, 'charging');
  T.g.ui.openPanel('tackle');
  assert.equal(s.rig.phase, 'ready', '패널이 열리면 충전을 거둔다');
  assert.equal(s.rig.aimPreview, null);
  T.win.fire('mouseup', { button: 0 });
  T.g.ui.closePanel('esc');
  frames(T.g, 30);
  assert.equal(s.rig.phase, 'ready', '닫힌 뒤 캐스팅이 나가지 않았다');
  assert.equal(s.profile.stats.casts, casts);
  assert.deepEqual(s.profile.baits, baits, '미끼가 그대로');

  // ② 포커스 잃음(blur) — 일시정지가 열리고, 닫은 뒤에도 캐스팅이 나가지 않는다
  T.g.input.requestLock({ soft: true });
  T.canvas.fire('mousedown', { button: 0 });
  frames(T.g, 30);
  assert.equal(s.rig.phase, 'charging');
  T.win.fire('blur');
  assert.equal(s.rig.phase, 'ready');
  assert.equal(T.g.ui.activePanel, 'pause');
  T.g.ui.closePanel('esc');
  frames(T.g, 30);
  assert.equal(s.rig.phase, 'ready');
  assert.equal(s.profile.stats.casts, casts);

  // ③ 정상 흐름은 그대로 — 누르고 떼면 던진다
  T.g.input.requestLock({ soft: true });
  T.canvas.fire('mousedown', { button: 0 });
  frames(T.g, 30);
  T.win.fire('mouseup', { button: 0 });
  frames(T.g, 2);
  assert.ok(['casting', 'waiting'].includes(s.rig.phase), '정상 캐스팅: ' + s.rig.phase);
  assert.equal(s.profile.stats.casts, casts + 1);

  // sim 명령 자체: charging 이 아니면 notHere
  assert.deepEqual(T.g.sim.cancelCharge(), { ok: false, reason: 'notHere' });
});
