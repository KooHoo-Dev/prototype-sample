// OWNER: P9 — 계약 §5.4 · §11.2 · §11.4 (app의 DOM 없는 부분: 누산기 · 화면 상태 기계 · 저장)
// app/Game.js는 three · CSS를 끌어와 Node에서 import할 수 없다 — 그래서 로직을 loop.js · screens.js · storage.js로
// 떼어 두고 여기서 가짜 UI · 가짜 localStorage로 돌린다. 화면에 붙은 뒤의 확인은 §12.5 브라우저 스모크다.
// input.js(InputCollector)는 DOM을 생성자 인자(canvas → ownerDocument → defaultView)로만 만난다 — 가짜 창으로 돌린다.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus, EV } from '../src/core/events.js';
import {
  DT, MAX_STEPS_PER_FRAME, SAVE_KEY, SAVE_BACKUP_KEY, SETTINGS_KEY, FACILITY_IDS,
} from '../src/core/constants.js';
import { NEUTRAL_INPUT } from '../src/core/inputFrame.js';
import { DEFAULT_SETTINGS } from '../src/data/settings.js';
import { GameSim } from '../src/sim/GameSim.js';
import { FixedStepper } from '../src/app/loop.js';
import { ScreenMachine, FADE_IN, FADE_OUT } from '../src/app/screens.js';
import { backupSave, canPersist, clearSave, loadSave, loadSettings, writeSave, writeSettings } from '../src/app/storage.js';
import { InputCollector } from '../src/app/input.js';
import { GAMEPAD } from '../src/data/keybinds.js';
import { CAMERA } from '../src/data/camera.js';
import { makeTestProfile } from './helpers.js';

// ───────────────────────────────────────────────────────────── §5.4 누산기

describe('FixedStepper — §5.4', () => {
  /** @returns {[FixedStepper, ()=>number, ()=>void]} */
  const make = () => {
    const s = new FixedStepper();
    let n = 0;
    return [s, () => n, () => { n += 1; }];
  };

  test('프레임 시간을 DT로 쪼개고 남은 조각이 alpha가 된다', () => {
    const [s, count, step] = make();
    assert.equal(s.advance(DT * 0.5, 1, step), 0, '틱이 0번인 프레임');
    assert.ok(Math.abs(s.alpha - 0.5) < 1e-9);
    assert.equal(s.advance(DT * 0.75, 1, step), 1);
    assert.ok(Math.abs(s.alpha - 0.25) < 1e-9);
    assert.equal(s.advance(DT * 2, 1, step), 2);
    assert.equal(count(), 3);
    assert.ok(s.alpha >= 0 && s.alpha <= 1);
  });

  test('프레임당 최대 스텝 · 탭 복귀의 긴 프레임에도 폭주하지 않는다(상한에 닿으면 acc = 0)', () => {
    const [s, count, step] = make();
    assert.equal(s.advance(30, 1, step), MAX_STEPS_PER_FRAME, '30초짜리 프레임');
    assert.equal(s.acc, 0, '죽음의 나선 방지');
    assert.equal(s.alpha, 0);
    assert.equal(s.advance(DT, 1, step), 1, '다음 프레임은 평소대로');
    assert.equal(count(), MAX_STEPS_PER_FRAME + 1);
  });

  test('배속은 프레임 시간에 곱해 누산한다(sim의 dt는 항상 DT) · 음수/NaN 프레임은 0으로 본다', () => {
    const [s, count, step] = make();
    assert.equal(s.advance(DT, 4, step), 4);
    assert.equal(s.advance(-1, 1, step), 0);
    assert.equal(s.advance(NaN, 1, step), 0);
    assert.equal(count(), 4);
    s.advance(DT * 0.5, 1, step);
    s.reset();
    assert.equal(s.acc, 0);
  });
});

// ───────────────────────────────────────────────────────────── §11.2 화면 상태 기계

/** UIRoot의 app 쪽 계약(§10.1)만 흉내 낸다. */
function fakeUi(bus) {
  return {
    activePanel: null,
    /** @type {any[][]} */
    calls: [],
    openPanel(id, params) {
      if (id === 'pause' && this.activePanel !== null) return;
      if (this.activePanel !== null) this.closePanel();
      this.activePanel = id;
      this.calls.push(['open', id, params]);
      bus.emit(EV.UI_OPENED, { panel: id, blocking: true });
    },
    closePanel() {
      const id = this.activePanel;
      if (id === null) return;
      this.activePanel = null;
      this.calls.push(['close', id]);
      bus.emit(EV.UI_CLOSED, { panel: id });
    },
    isBlocking() { return this.activePanel !== null; },
    canClose() { return this.activePanel !== null && FACILITY_IDS.includes(this.activePanel); },
    fade(toOpaque, dur) {
      this.calls.push(['fade', toOpaque, dur]);
      return Promise.resolve();
    },
  };
}

function makeScreens() {
  const bus = new EventBus();
  /** @type {{name:string, payload:any}[]} */
  const log = [];
  bus.onAny((name, payload) => log.push({ name, payload }));
  const profile = makeTestProfile({ seed: 3 });
  const sim = new GameSim({ profile, bus });
  const ui = fakeUi(bus);
  const snaps = [];
  let flushed = 0;
  const errors = [];
  const screens = new ScreenMachine({
    bus,
    sim,
    ui,
    cameraRig: { snapBehind: (f) => snaps.push(f) },
    flushSave: () => { flushed += 1; },
    onError: (where, e) => errors.push([where, e]),
  });
  bus.on(EV.UI_CLOSED, ({ panel }) => screens.onUiClosed(panel));
  bus.on(EV.FIGHT_ENDED, (p) => screens.onFightEnded(p));
  const names = () => log.map((e) => e.name);
  return { bus, log, names, profile, sim, ui, screens, snaps, errors, flushed: () => flushed };
}

/** 보스전을 교전(fight) 구간까지 돌린다. */
function stepToFight(sim) {
  for (let i = 0; i < 600 && sim.state.fight.phase !== 'fight'; i++) sim.step(DT, NEUTRAL_INPUT);
  assert.equal(sim.state.fight.phase, 'fight');
}

describe('ScreenMachine — §11.2', () => {
  test('boot → title: 패널을 열고 SCREEN_CHANGED. boot · title에서는 저장하지 않는다', () => {
    const { screens, ui, log } = makeScreens();
    assert.equal(screens.screen, 'boot');
    assert.equal(screens.canSave(), false);
    screens.showTitle({ saveBroken: true });
    assert.equal(screens.screen, 'title');
    assert.equal(screens.canSave(), false);
    assert.equal(screens.isLive(), false);
    assert.deepEqual(ui.calls[0], ['open', 'title', { saveBroken: true }]);
    assert.deepEqual(log.find((e) => e.name === EV.SCREEN_CHANGED).payload, { from: 'boot', to: 'title' });
  });

  test('→ town: fade(0.3) → 패널 닫기 → screen → enterTown → snapBehind → fade(0.4). 합 ≤ 1초', async () => {
    const { screens, ui, sim, snaps, names, bus } = makeScreens();
    screens.showTitle();
    let canSaveAtModeChange = null;
    bus.on(EV.MODE_CHANGED, () => { canSaveAtModeChange = screens.canSave(); });
    const p = screens.toTown();
    assert.equal(screens.busy, true, 'fade를 기다리는 동안은 전이 중이다');
    assert.equal(screens.screen, 'title');
    assert.equal(await p, true);
    assert.equal(screens.busy, false);
    assert.equal(screens.screen, 'town');
    assert.equal(ui.activePanel, null);
    assert.deepEqual(ui.calls.filter((c) => c[0] === 'fade'), [['fade', true, FADE_OUT], ['fade', false, FADE_IN]]);
    assert.ok(FADE_OUT + FADE_IN <= 1, '전환 페이드 합 ≤ 1초');
    assert.deepEqual(snaps, [sim.state.player.facing]);
    // screen을 먼저 바꾼 뒤 sim 명령 — 그 MODE_CHANGED의 저장 판정이 새 화면 기준이다
    const n = names();
    assert.ok(n.lastIndexOf(EV.SCREEN_CHANGED) < n.lastIndexOf(EV.MODE_CHANGED));
    assert.equal(canSaveAtModeChange, true);
    assert.equal(sim.state.mode, 'town');
  });

  test('전이 중에는 추가 전이 · pause 요청을 무시한다', async () => {
    const { screens, sim } = makeScreens();
    screens.showTitle();
    const p = screens.toTown();
    // 같은 동기 구간에서 겹쳐 요청한다(await하면 가짜 fade가 곧바로 끝나 전이가 지나가 버린다)
    const boss = screens.toBoss('valder');
    const town = screens.toTown();
    assert.equal(screens.openPause(), false);
    screens.escape();
    assert.equal(screens.paused, false);
    assert.equal(await boss, false);
    assert.equal(await town, false);
    await p;
    assert.equal(screens.screen, 'town');
    assert.equal(sim.state.mode, 'town');
  });

  test('→ boss → result → 즉시 재도전: FIGHT_ENDED가 결과 패널을 열고 retry는 같은 보스로', async () => {
    const { screens, ui, sim } = makeScreens();
    screens.showTitle();
    await screens.toTown();
    assert.equal(await screens.toBoss('nope'), false, '모르는 보스');
    assert.equal(await screens.toBoss('valder'), true);
    assert.equal(screens.screen, 'boss');
    assert.equal(sim.state.mode, 'boss');
    assert.equal(sim.state.fight.bossId, 'valder');
    assert.equal(screens.lastBossId, 'valder');

    stepToFight(sim);
    sim.debugDamageBoss(1e9);
    for (let i = 0; i < 600 && screens.screen !== 'result'; i++) sim.step(DT, NEUTRAL_INPUT);
    assert.equal(screens.screen, 'result');
    assert.equal(ui.activePanel, 'result');
    const open = ui.calls.filter((c) => c[0] === 'open').pop();
    assert.equal(open[2].outcome, 'victory');
    assert.equal(open[2].reward.victory, true);
    assert.ok(open[2].duration >= 0);
    assert.equal(screens.canSave(), true);

    const attempts = sim.state.profile.bosses.valder.attempts;
    assert.equal(await screens.retry(), true);
    assert.equal(screens.screen, 'boss');
    assert.equal(ui.activePanel, null);
    assert.equal(sim.state.fight.phase, 'intro');
    assert.equal(sim.state.profile.bosses.valder.attempts, attempts + 1);
  });

  test('toTown: 교전 중이면 먼저 포기 보상(forfeitFight) · intro에서는 그냥 떠난다', async () => {
    const a = makeScreens();
    a.screens.showTitle();
    await a.screens.toBoss('valder');
    await a.screens.toTown(); // intro — 보상 없음
    assert.equal(a.names().includes(EV.REWARD_GRANTED), false);

    const b = makeScreens();
    b.screens.showTitle();
    await b.screens.toBoss('valder');
    stepToFight(b.sim);
    b.sim.debugDamageBoss(400);
    assert.equal(b.screens.isFighting(), true);
    await b.screens.toTown();
    const reward = b.log.find((e) => e.name === EV.REWARD_GRANTED)?.payload.reward;
    assert.ok(reward, '포기 보상이 없다');
    assert.equal(reward.victory, false);
    assert.ok(reward.embers > 0);
    assert.equal(b.profile.embers, reward.embers);
    assert.equal(b.names().includes(EV.FIGHT_ENDED), false, '포기에는 결과 화면이 없다');
    assert.equal(b.screens.screen, 'town');

    // 새 게임(프로필을 갈아 끼운 뒤)의 전이는 포기 보상을 주지 않는다
    const c = makeScreens();
    c.screens.showTitle();
    await c.screens.toBoss('valder');
    stepToFight(c.sim);
    c.sim.debugDamageBoss(400);
    await c.screens.toTown({ forfeit: false });
    assert.equal(c.names().includes(EV.REWARD_GRANTED), false);
  });

  test('일시정지: Esc로 열리고 Esc로는 닫히지 않는다 · 닫히면 누가 닫았든 재개 · 시설 패널은 Esc로 닫힌다', async () => {
    const { screens, ui, log } = makeScreens();
    screens.showTitle();
    screens.escape();
    assert.equal(screens.paused, false, '타이틀에서는 pause가 없다');
    await screens.toTown();

    screens.escape();
    assert.equal(ui.activePanel, 'pause');
    assert.equal(screens.paused, true);
    assert.deepEqual(log.filter((e) => e.name === EV.PAUSED).map((e) => e.payload.paused), [true]);
    screens.escape(); // keydown과 pointerlockchange가 둘 다 오는 브라우저 — 열자마자 닫히지 않는다
    assert.equal(ui.activePanel, 'pause');
    assert.equal(screens.openPause(), false, '이미 열려 있다');
    screens.escape(true); // 게임패드 Start는 재개한다
    assert.equal(ui.activePanel, null);
    assert.equal(screens.paused, false);
    assert.deepEqual(log.filter((e) => e.name === EV.PAUSED).map((e) => e.payload.paused), [true, false]);

    ui.openPanel('bonfire');
    assert.equal(screens.openPause(), false, '패널이 있으면 pause를 열지 않는다');
    screens.escape();
    assert.equal(ui.activePanel, null, '시설 패널은 Esc로 닫힌다');
    assert.equal(screens.paused, false);

    ui.openPanel('result', {});
    screens.escape();
    assert.equal(ui.activePanel, 'result', 'result는 Esc로 닫히지 않는다');
  });

  test('창 포커스 잃음: 보스전의 intro · fight에서만 pause를 연다', async () => {
    const { screens, ui, sim } = makeScreens();
    screens.showTitle();
    await screens.toTown();
    screens.focusLost();
    assert.equal(screens.paused, false, '마을');
    await screens.toBoss('valder');
    screens.focusLost();
    assert.equal(ui.activePanel, 'pause');
    assert.equal(screens.paused, true);
    ui.closePanel();
    assert.equal(screens.paused, false);

    stepToFight(sim);
    sim.debugDamageBoss(1e9);
    for (let i = 0; i < 600 && screens.screen !== 'result'; i++) sim.step(DT, NEUTRAL_INPUT);
    screens.focusLost();
    assert.equal(ui.activePanel, 'result', '결과 패널은 그대로다');
    assert.equal(screens.paused, false);
  });

  test('전이의 페이드 중에 창 포커스를 잃으면 도착한 보스전에서 pause가 열린다(회귀)', async () => {
    const { screens, ui, sim } = makeScreens();
    screens.showTitle();
    await screens.toTown();

    // 안개문 E, E 직후 Alt+Tab: 페이드(0.3초) 동안에는 screen이 아직 town이고 전이 중이라 pause를 열 수 없다
    const p = screens.toBoss('fenrir');
    assert.equal(screens.busy, true);
    screens.focusLost();
    assert.equal(ui.activePanel, null, '전이 중에는 아무것도 열지 않는다');
    assert.equal(screens.paused, false);
    assert.equal(await p, true);
    assert.equal(screens.screen, 'boss');
    assert.equal(sim.state.fight.phase, 'intro');
    assert.equal(ui.activePanel, 'pause', '포커스 없는 창에서 보스전이 그대로 시작되면 안 된다');
    assert.equal(screens.paused, true);
    // 막은 걷힌다(검은 화면 위의 pause가 아니다)
    assert.deepEqual(ui.calls.filter((c) => c[0] === 'fade').pop(), ['fade', false, FADE_IN]);

    // 포커스가 돌아온 뒤의 전이는 멈추지 않는다
    ui.closePanel();
    screens.focusBack();
    await screens.toTown();
    await screens.toBoss('fenrir');
    assert.equal(ui.activePanel, null);
    assert.equal(screens.paused, false);

    // 결과 → 재도전의 페이드도 같은 경로다
    stepToFight(sim);
    sim.debugDamageBoss(1e9);
    for (let i = 0; i < 600 && screens.screen !== 'result'; i++) sim.step(DT, NEUTRAL_INPUT);
    assert.equal(screens.screen, 'result');
    const again = screens.retry();
    screens.focusLost();
    assert.equal(ui.activePanel, 'result', '결과 패널은 그대로다');
    await again;
    assert.equal(ui.activePanel, 'pause');

    // 마을로 가는 전이는 포커스가 없어도 pause를 열지 않는다(마을은 안전)
    ui.closePanel();
    await screens.toTown();
    assert.equal(screens.unfocused, true);
    assert.equal(ui.activePanel, null);
    assert.equal(screens.paused, false);
  });

  test('pauseIfFighting: 보스전의 intro · fight에서만 연다(게임패드 끊김 — 포커스 상태는 건드리지 않는다)', async () => {
    const { screens, ui } = makeScreens();
    screens.showTitle();
    await screens.toTown();
    assert.equal(screens.pauseIfFighting(), false, '마을');
    await screens.toBoss('valder');
    assert.equal(screens.pauseIfFighting(), true);
    assert.equal(ui.activePanel, 'pause');
    assert.equal(screens.unfocused, false);
    assert.equal(screens.pauseIfFighting(), false, '이미 열려 있다');
  });

  test('quitToTitle: 포기 → 저장 → title. 타이틀 배경의 MODE_CHANGED는 저장 대상이 아니다', async () => {
    const { screens, ui, sim, bus, flushed, log } = makeScreens();
    screens.showTitle();
    await screens.toBoss('valder');
    stepToFight(sim);
    sim.debugDamageBoss(300);
    screens.escape();
    assert.equal(screens.paused, true);
    let canSaveAtModeChange = null;
    bus.on(EV.MODE_CHANGED, () => { canSaveAtModeChange = screens.canSave(); });
    let screenAtFlush = null;
    const before = flushed();
    const p = screens.quitToTitle();
    screenAtFlush = screens.screen;
    assert.equal(flushed(), before + 1, '화면을 바꾸기 전에 저장한다');
    assert.equal(screenAtFlush, 'boss');
    await p;
    assert.ok(log.some((e) => e.name === EV.REWARD_GRANTED), '교전 중이었으면 포기 보상');
    assert.equal(screens.screen, 'title');
    assert.equal(ui.activePanel, 'title');
    assert.equal(screens.paused, false, 'pause가 닫히며 재개됐다');
    assert.equal(canSaveAtModeChange, false);
    assert.equal(sim.state.mode, 'town');
  });

  test('전이 중 예외가 나도 검은 화면에 멈추지 않는다(막은 걷히고 오류는 보고된다)', async () => {
    const { screens, ui, bus, errors } = makeScreens();
    screens.showTitle();
    const off = bus.on(EV.MODE_CHANGED, () => { throw new Error('레이어 예외'); });
    assert.equal(await screens.toBoss('valder'), true);
    off();
    assert.equal(screens.busy, false);
    assert.equal(errors.length, 1);
    assert.deepEqual(ui.calls.filter((c) => c[0] === 'fade').pop(), ['fade', false, FADE_IN]);
    assert.equal(await screens.toTown(), true, '다음 전이는 정상이다');
  });

  test('settle: 막은 새 화면이 그려진 뒤에 걷힌다(셰이더 컴파일을 막 아래에서) · 그동안은 전이 중 · instant는 기다리지 않는다', async () => {
    const bus = new EventBus();
    const sim = new GameSim({ profile: makeTestProfile({ seed: 3 }), bus });
    const ui = fakeUi(bus);
    /** @type {string[]} */
    const order = [];
    const fade = ui.fade.bind(ui);
    ui.fade = (toOpaque, dur) => { order.push(toOpaque ? 'fade-out' : 'fade-in'); return fade(toOpaque, dur); };
    bus.on(EV.MODE_CHANGED, ({ mode }) => order.push(`mode:${mode}`));
    /** @type {(()=>void)|null} */
    let release = null;
    let settles = 0;
    const screens = new ScreenMachine({
      bus,
      sim,
      ui,
      settle: () => new Promise((resolve) => {
        settles += 1;
        order.push('settle');
        release = () => resolve();
      }),
    });
    screens.showTitle();
    const p = screens.toBoss('valder');
    for (let i = 0; i < 5 && !release; i++) await Promise.resolve();
    assert.deepEqual(order, ['fade-out', 'mode:boss', 'settle'], '막이 덮인 뒤 sim 명령 → settle. 아직 걷지 않았다');
    assert.equal(screens.screen, 'boss');
    assert.equal(screens.busy, true, 'settle을 기다리는 동안은 전이 중이다');
    assert.equal(screens.openPause(), false);
    release();
    assert.equal(await p, true);
    assert.deepEqual(order, ['fade-out', 'mode:boss', 'settle', 'fade-in']);
    assert.equal(screens.busy, false);

    // instant(디버그 쿼리 부팅)는 페이드도 settle도 없다
    await screens.toTown({ instant: true });
    assert.equal(settles, 1);
    assert.equal(screens.screen, 'town');

    // settle이 던져도 막은 걷힌다
    const errors = [];
    const bad = new ScreenMachine({ bus, sim, ui, settle: () => Promise.reject(new Error('settle')), onError: (w, e) => errors.push([w, e]) });
    bad.screen = 'town';
    assert.equal(await bad.toBoss('valder'), true);
    assert.equal(bad.busy, false);
    assert.equal(errors.length, 1);
    assert.equal(order[order.length - 1], 'fade-in');
  });
});

// ───────────────────────────────────────────────────────────── §11.4 저장

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

describe('storage — §11.4', () => {
  test('세이브 왕복 · 프로필과 설정은 다른 키', () => {
    const st = fakeStorage();
    assert.deepEqual(loadSave(st), { save: null, broken: false }, '빈 저장소');
    const profile = makeTestProfile({ embers: 321, points: { vit: 3 }, weaponLevel: 2, seed: 99 });
    assert.equal(writeSave(profile, st), true);
    assert.deepEqual([...st.map.keys()], [SAVE_KEY]);
    const loaded = loadSave(st);
    assert.equal(loaded.broken, false);
    assert.deepEqual(loaded.save.profile, profile);
    assert.ok(loaded.save.savedAt > 0, 'savedAt은 app이 채운다');

    const settings = { ...DEFAULT_SETTINGS, mouseSensitivity: 1.7, quality: 'high', invertY: true };
    assert.equal(writeSettings(settings, st), true);
    assert.deepEqual([...st.map.keys()].sort(), [SAVE_KEY, SETTINGS_KEY].sort());
    assert.deepEqual(loadSettings(st), settings);

    // 세이브가 지워져도 설정은 남는다
    clearSave(st);
    assert.deepEqual(loadSave(st), { save: null, broken: false });
    assert.deepEqual(loadSettings(st), settings);
  });

  test('읽지 못한 세이브는 백업 키에 원문을 남기고 broken — 원래 키는 덮지 않는다', () => {
    for (const text of ['{깨진 json', '"문자열"', JSON.stringify({ version: 999, savedAt: 0, profile: {} })]) {
      const st = fakeStorage({ [SAVE_KEY]: text });
      assert.deepEqual(loadSave(st), { save: null, broken: true }, text);
      assert.equal(st.map.get(SAVE_BACKUP_KEY), text, '백업 키에 원문');
      assert.equal(st.map.get(SAVE_KEY), text, '사용자 조작 전에는 원래 키를 건드리지 않는다');
    }
  });

  test('backupSave: 새 게임이 덮기 직전의 세이브 원문을 백업 키에 남긴다(회귀)', () => {
    const st = fakeStorage();
    assert.equal(backupSave(st), false, '세이브가 없으면 아무것도 쓰지 않는다');
    assert.deepEqual([...st.map.keys()], []);

    const old = makeTestProfile({ embers: 6332, points: { vit: 3 }, seed: 387426976 });
    old.cycle = 1;
    writeSave(old, st);
    const text = st.map.get(SAVE_KEY);
    assert.equal(backupSave(st), true);
    assert.equal(st.map.get(SAVE_BACKUP_KEY), text);

    // 새 프로필이 같은 키를 덮어도 백업에서 예전 진행을 그대로 읽을 수 있다
    writeSave(makeTestProfile({ seed: 1 }), st);
    assert.notEqual(st.map.get(SAVE_KEY), text);
    const restored = loadSave(fakeStorage({ [SAVE_KEY]: st.map.get(SAVE_BACKUP_KEY) }));
    assert.equal(restored.broken, false);
    assert.deepEqual(restored.save.profile, old);

    // 빈 세이브로 기존 백업을 지우지 않는다
    const st2 = fakeStorage({ [SAVE_BACKUP_KEY]: 'keep' });
    assert.equal(backupSave(st2), false);
    assert.equal(st2.map.get(SAVE_BACKUP_KEY), 'keep');
    assert.equal(backupSave(null), false);
  });

  test('canPersist: 저장소가 막혀 있으면 false · 탐침은 흔적을 남기지 않는다', () => {
    const st = fakeStorage({ [SAVE_KEY]: 'x' });
    assert.equal(canPersist(st), true);
    assert.deepEqual([...st.map.keys()], [SAVE_KEY]);
    assert.equal(canPersist(null), false);
    assert.equal(canPersist({
      getItem() { throw new Error('SecurityError'); },
      setItem() { throw new Error('SecurityError'); },
      removeItem() {},
    }), false);
    // 쓰기는 조용히 버려지는 저장소(일부 사생활 보호 모드)
    assert.equal(canPersist({ getItem: () => null, setItem() {}, removeItem() {} }), false);
  });

  test('설정: 없거나 깨졌으면 기본값의 복사본 · 범위 밖 값은 자른다', () => {
    const a = loadSettings(fakeStorage());
    assert.deepEqual(a, { ...DEFAULT_SETTINGS });
    assert.notEqual(a, DEFAULT_SETTINGS, '동결된 기본값이 아니라 복사본이어야 한다(app이 필드를 고친다)');
    a.volumeMaster = 0.1;
    assert.deepEqual(loadSettings(fakeStorage({ [SETTINGS_KEY]: '{nope' })), { ...DEFAULT_SETTINGS });
    const odd = loadSettings(fakeStorage({ [SETTINGS_KEY]: JSON.stringify({ mouseSensitivity: 99, quality: 'ultra', volumeSfx: -1 }) }));
    assert.equal(odd.mouseSensitivity, 3);
    assert.equal(odd.quality, DEFAULT_SETTINGS.quality);
    assert.equal(odd.volumeSfx, 0);
  });

  test('저장소가 없거나 막혀 있어도 던지지 않는다(읽기는 기본값, 쓰기는 무시)', () => {
    const blocked = {
      getItem() { throw new Error('SecurityError'); },
      setItem() { throw new Error('QuotaExceededError'); },
      removeItem() { throw new Error('SecurityError'); },
    };
    for (const st of [null, blocked]) {
      assert.deepEqual(loadSave(st), { save: null, broken: false });
      assert.equal(writeSave(makeTestProfile(), st), false);
      assert.deepEqual(loadSettings(st), { ...DEFAULT_SETTINGS });
      assert.equal(writeSettings({ ...DEFAULT_SETTINGS }, st), false);
      clearSave(st);
    }
    // 기본 인자(Node에는 localStorage가 없다)로도 던지지 않는다
    assert.equal(loadSave().save, null);
    assert.equal(typeof writeSave(makeTestProfile()), 'boolean');
  });
});

// ───────────────────────────────────────────────────────────── §11.3 입력 수집

/** 이벤트를 손으로 보낼 수 있는 가짜 대상. */
function fakeTarget() {
  /** @type {Record<string, Function[]>} */
  const map = {};
  return {
    addEventListener(type, fn) { (map[type] ??= []).push(fn); },
    removeEventListener(type, fn) { map[type] = (map[type] ?? []).filter((f) => f !== fn); },
    emit(type, e = {}) { for (const fn of (map[type] ?? []).slice()) fn(e); return e; },
  };
}

/** InputCollector를 가짜 창 · 문서 · 캔버스 위에 만든다. 시계와 게임패드는 손으로 움직인다. */
function makeInputEnv() {
  const env = { now: 1000, pad: null, blocking: false, lockOk: true };
  const win = fakeTarget();
  win.performance = { now: () => env.now };
  win.setTimeout = () => 0;
  win.navigator = { getGamepads: () => [env.pad] };
  const doc = fakeTarget();
  doc.defaultView = win;
  doc.pointerLockElement = null;
  doc.exitPointerLock = () => {};
  const canvas = fakeTarget();
  canvas.ownerDocument = doc;
  canvas.requestPointerLock = () => {};
  const input = new InputCollector(canvas, { ...DEFAULT_SETTINGS });
  const calls = { gesture: 0, escape: 0, confirm: 0, cancel: 0, padLost: 0 };
  input.handlers = {
    isBlocking: () => env.blocking,
    onGesture: () => { calls.gesture += 1; },
    onLockChange: () => {},
    onEscape: () => { calls.escape += 1; },
    onNavigate: () => {},
    onConfirm: () => { calls.confirm += 1; },
    onCancel: () => { calls.cancel += 1; },
    onPadLost: () => { calls.padLost += 1; },
  };
  const keyEvent = (code, extra = {}) => ({
    code, repeat: false, defaultPrevented: false, ctrlKey: false, metaKey: false, altKey: false,
    preventDefault() { this.defaultPrevented = true; },
    ...extra,
  });
  return {
    env, win, doc, canvas, input, calls,
    keydown: (code, extra) => win.emit('keydown', keyEvent(code, extra)),
    keyup: (code) => win.emit('keyup', keyEvent(code)),
    /** UI(패널)가 먼저 처리한 keydown */
    uiKeydown: (code, extra) => win.emit('keydown', keyEvent(code, { defaultPrevented: true, ...extra })),
    lock(on) {
      doc.pointerLockElement = on ? canvas : null;
      doc.emit('pointerlockchange');
    },
    mousemove: (dx, dy = 0, buttons = 0) => win.emit('mousemove', { movementX: dx, movementY: dy, buttons }),
    /** 표준 매핑 패드 하나(버튼 17개 · 축 4개) */
    plugPad() {
      env.pad = {
        connected: true, mapping: 'standard', axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
      };
      return env.pad;
    },
    press(i, on) { env.pad.buttons[i] = { pressed: on, value: on ? 1 : 0 }; },
    /** n프레임(1/60초씩) 패드를 읽는다. 시계도 같이 간다. */
    poll(n = 1) {
      for (let i = 0; i < n; i++) {
        env.now += 1000 / 60;
        input.pollGamepad(1 / 60);
      }
    },
  };
}

describe('InputCollector — §11.3', () => {
  test('홀드는 물리 상태다: 패널이 떠 있는 동안(전환 페이드 포함) 누른 이동 키가 닫힌 뒤에도 눌려 있다(회귀)', () => {
    const t = makeInputEnv();
    // 결과 패널에서 R → 페이드 0.3초 동안 W를 누른다: UI가 W를 내비게이션으로 처리해 defaultPrevented다
    t.env.blocking = true;
    t.uiKeydown('KeyR');
    t.uiKeydown('KeyW');
    assert.deepEqual(t.input.consume(0), NEUTRAL_INPUT, '패널이 열려 있는 동안은 중립');
    // 패널이 닫히고 화면이 바뀐다
    t.env.blocking = false;
    t.input.notifyUiClosed();
    t.input.notifyScreenChanged();
    const f = t.input.consume(0);
    assert.ok(Math.hypot(f.moveX, f.moveZ) > 0.99, '떼었다 다시 누르지 않아도 움직인다');
    assert.equal(f.flaskPressed, false, 'UI가 처리한 R은 플라스크가 아니다');
    assert.equal(f.interactPressed, false);
    // OS 자동 반복 keydown은 에지를 내지 않는다
    t.keydown('KeyW', { repeat: true });
    assert.ok(Math.hypot(t.input.consume(0).moveX, t.input.consume(0).moveZ) > 0.99);
    t.keyup('KeyW');
    assert.deepEqual(t.input.consume(0), NEUTRAL_INPUT);

    // 자동 반복만 도착해도(첫 keydown을 놓쳤어도) 홀드로 본다
    t.keydown('KeyS', { repeat: true });
    assert.ok(Math.hypot(t.input.consume(0).moveX, t.input.consume(0).moveZ) > 0.99);
    t.keyup('KeyS');

    // 브라우저 단축키 조합은 홀드로도 받지 않는다(Ctrl+W)
    t.keydown('KeyW', { ctrlKey: true });
    assert.deepEqual(t.input.consume(0), NEUTRAL_INPUT);
    // 창 포커스를 잃으면 전부 놓는다
    t.keydown('ShiftLeft');
    assert.equal(t.input.consume(0).sprint, true);
    t.win.emit('blur');
    assert.deepEqual(t.input.consume(0), NEUTRAL_INPUT);
  });

  test('전환 막 · 패널 위에서 쥔 마우스 버튼은 홀드만 기록한다(가드를 미리 쥐고 들어간다 · 에지는 내지 않는다)', () => {
    const t = makeInputEnv();
    const curtain = {};
    t.env.blocking = true;
    t.win.emit('mousedown', { button: 2, target: curtain });
    t.win.emit('mousedown', { button: 0, target: curtain });
    assert.ok(t.calls.gesture >= 2, '화면 어디를 눌러도 첫 제스처로 센다(오디오 unlock)');
    t.env.blocking = false;
    t.input.notifyUiClosed();
    t.env.now += 1000;
    const f = t.input.consume(0);
    assert.equal(f.guard, true);
    assert.equal(f.lightPressed, false, '패널 버튼을 누른 클릭이 약공격이 되지 않는다');
    t.win.emit('mouseup', { button: 2, buttons: 0 });
    assert.equal(t.input.consume(0).guard, false);
    // 캔버스의 mousedown은 종전 규칙 그대로다(락이 없으면 락 요청에만 쓴다)
    t.win.emit('mousedown', { button: 2, target: t.canvas });
    t.canvas.emit('mousedown', { button: 2, preventDefault() {} });
    assert.equal(t.input.consume(0).guard, false);
  });

  test('화면 전환 직후의 에지는 버리고, 연타가 멎을 때까지 계속 버린다(R 연타 → 플라스크 · E 연타 → 화톳불 레벨업 회귀)', () => {
    const t = makeInputEnv();
    const tap = (code) => { t.keydown(code); t.keyup(code); };
    // 사망 결과에서 R을 150ms 간격으로 연타 — 재도전 전이가 끝난 뒤에도 계속 누른다
    t.input.notifyUiClosed();
    t.input.notifyScreenChanged();
    for (let i = 0; i < 12; i++) {
      t.env.now += 150;
      tap('KeyR');
      assert.equal(t.input.consume(0).flaskPressed, false, `${(i + 1) * 150}ms의 R`);
    }
    // 연타가 멎은 뒤(0.35초)의 R은 받는다
    t.env.now += 400;
    tap('KeyR');
    assert.equal(t.input.consume(0).flaskPressed, true);

    // 연타하지 않은 다른 입력은 창(0.5초)이 지나면 바로 받는다
    t.input.notifyScreenChanged();
    t.env.now += 200;
    tap('KeyE');
    assert.equal(t.input.consume(0).interactPressed, false, '막이 걷히는 동안');
    t.env.now += 100;
    tap('KeyE');
    t.env.now += 250;
    t.keydown('Space');
    const f = t.input.consume(0);
    assert.equal(f.rollPressed, true, '연타하지 않은 구르기는 0.5초 뒤 바로 나간다');
    assert.equal(f.interactPressed, false);
    t.env.now += 50;
    tap('KeyE');
    assert.equal(t.input.consume(0).interactPressed, false, '0.35초 안의 E 연타는 아직 버린다');

    // 패널만 닫힌 경우(일시정지 재개)는 0.15초만 버린다 — 연타를 따라가지 않는다
    t.env.now += 5000;
    t.input.notifyUiClosed();
    t.env.now += 100;
    t.keydown('Space');
    assert.equal(t.input.consume(0).rollPressed, false);
    t.keyup('Space');
    t.env.now += 100;
    t.keydown('Space');
    assert.equal(t.input.consume(0).rollPressed, true, '재개 직후의 구르기가 씹히지 않는다');
  });

  test('마우스 시점: 상한을 넘는 이동은 버리지 않고 자른다 · 상한은 감도에 맞춘 각도 기준(회귀)', () => {
    const t = makeInputEnv();
    t.lock(true);
    t.mousemove(50);
    assert.deepEqual(t.input.consumeLook(), { dx: 0, dy: 0 }, '락을 얻은 직후의 첫 이동만 버린다');
    for (const v of [100, 250, 300, 301, 450]) {
      t.mousemove(v, -v);
      assert.deepEqual(t.input.consumeLook(), { dx: v, dy: -v }, `${v}px`);
    }
    const cap = (Math.PI / 2) / CAMERA.rotSpeed; // 감도 1: 한 이벤트에 90°
    t.mousemove(5000, -5000);
    const big = t.input.consumeLook();
    assert.ok(Math.abs(big.dx - cap) < 1e-6 && Math.abs(big.dy + cap) < 1e-6, '잘린다(0이 아니다)');
    // 0.27초 스윕(프레임당 40 → 520 → 40px): 보낸 양이 전부 반영된다
    let sent = 0;
    let got = 0;
    for (let i = 0; i < 16; i++) {
      const v = 40 + 480 * Math.sin((Math.PI * i) / 15);
      sent += v;
      t.mousemove(v);
      got += t.input.consumeLook().dx;
    }
    assert.ok(Math.abs(got - sent) < 1e-6, `스윕 ${got} / ${sent}`);
    // 감도를 낮추면 픽셀 상한이 그만큼 오른다(같은 각속도까지 돈다)
    t.input.settings.mouseSensitivity = 0.3;
    t.mousemove(2000);
    assert.equal(t.input.consumeLook().dx, 2000);
    // 락이 없고 끄는 중도 아니면 쌓지 않는다
    t.lock(false);
    t.mousemove(100);
    assert.deepEqual(t.input.consumeLook(), { dx: 0, dy: 0 });
  });

  test('게임패드 B로 패널을 닫은 뒤 그 B를 떼어도 구르지 않는다 · 평소의 B 탭은 구른다(회귀)', () => {
    const t = makeInputEnv();
    t.plugPad();
    t.poll(2);
    for (const holdFrames of [6, 11, 12]) { // 100 · 180 · 200ms — tapMax(0.22초) 안
      t.env.blocking = true;
      t.poll(2);
      t.press(GAMEPAD.roll, true);
      t.poll(1);
      assert.ok(t.calls.cancel >= 1);
      // cancel이 패널을 닫았다(일시정지 재개)
      t.env.blocking = false;
      t.input.notifyUiClosed();
      t.poll(holdFrames - 1);
      t.press(GAMEPAD.roll, false);
      t.poll(2);
      assert.equal(t.input.consume(0).rollPressed, false, `${holdFrames}프레임 쥐었다 뗀 B`);
      t.env.now += 1000;
    }
    // 평소의 탭
    t.press(GAMEPAD.roll, true);
    t.poll(6);
    t.press(GAMEPAD.roll, false);
    t.poll(1);
    assert.equal(t.input.consume(0).rollPressed, true);
    // 길게 누르면 달리기(구르기 없음)
    t.press(GAMEPAD.roll, true);
    t.poll(20);
    assert.equal(t.input.consume(0).sprint, true);
    t.press(GAMEPAD.roll, false);
    t.poll(1);
    assert.equal(t.input.consume(0).rollPressed, false);
  });

  test('쓰던 게임패드가 사라지면 onPadLost — 키보드로 하던 중에 꺼진 패드는 알리지 않는다(회귀)', () => {
    const t = makeInputEnv();
    const pad = t.plugPad();
    pad.axes[1] = -1; // 스틱 전진
    t.poll(5);
    assert.ok(t.input.consume(0).moveZ !== 0 || t.input.consume(0).moveX !== 0);
    t.env.pad = null;
    t.poll(1);
    assert.equal(t.calls.padLost, 1);
    assert.deepEqual(t.input.consume(0), NEUTRAL_INPUT, '끊긴 패드의 스틱이 남지 않는다');
    t.poll(5);
    assert.equal(t.calls.padLost, 1, '한 번만 알린다');

    // 패드가 꽂혀 있지만 키보드로 조종 중
    t.plugPad();
    t.poll(3);
    t.keydown('KeyW');
    t.env.pad = null;
    t.poll(2);
    assert.equal(t.calls.padLost, 1);
    t.keyup('KeyW');
  });
});
