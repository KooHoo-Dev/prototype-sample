// OWNER: P9 — 계약 §11.8 · §11.1
// W0: P0 의 「최소 부트」(스텁이 아니라 동작한다). W2 에서 P9 가 `new Game(document).start()` 로 교체한다.
// 스텁 위에서 돈다: EventBus → GameSim → createRenderContext → §11.1 순서 그대로 모든 레이어(계약 deps) → 누산 루프(§5.9) → 첫 렌더 뒤 markReady().
// W1 의 각 패키지가 자기 레이어를 채우면 이 파일을 고치지 않아도 그대로 뜬다.
// 쿼리: ?scene · ?spot · ?time · ?weather · ?panel · ?fixture · ?seed · ?level · ?money · ?quality · ?fresh(무시 — 세이브를 쓰지 않는다).
// window.__game: getState · pause · step · errors · screen · gotoScene · gotoSpot · openPanel · closePanel · loadFixture · setBot(no-op).

import { markError, markReady } from './app/bootMarker.js';
import { DT, MAX_FRAME_DT, MAX_STEPS_PER_FRAME, SCENE_IDS, WEATHER_IDS } from './core/constants.js';
import { EV, EventBus } from './core/events.js';
import { makeInput } from './core/inputFrame.js';
import { clamp } from './core/math.js';
import { DEFAULT_SETTINGS, MOUSE } from './data/settings.js';
import { KEYBINDS, WHEEL } from './data/keybinds.js';
import { WORLD } from './data/world.js';
import { SPOTS_BY_ID } from './data/stages/index.js';
import { GameSim } from './sim/GameSim.js';
import { makeDevProfile } from './sim/progression/profile.js';
import { createRenderContext } from './view/renderer.js';
import { WorldLayer } from './view/WorldLayer.js';
import { CameraRig } from './view/CameraRig.js';
import { TackleLayer } from './view/tackle/TackleLayer.js';
import { FishLayer } from './view/fish/FishLayer.js';
import { FxLayer } from './view/fx/FxLayer.js';
import { FishPreview } from './view/fish/FishPreview.js';
import { AudioEngine } from './audio/AudioEngine.js';
import { UIRoot } from './ui/UIRoot.js';
import { FIXTURE_NAMES, makeFixtureState } from './debug/fixtures.js';

const QUERY_PANELS = ['tackle', 'pc', 'sell', 'camp', 'map', 'bed', 'pause', 'result'];
const QUALITIES = ['low', 'medium', 'high'];
const PREVENT_KEYS = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'];

/** @type {string[]} */
const errors = [];
let booted = false;
const rawConsoleError = console.error.bind(console);

window.addEventListener('error', (e) => {
  const msg = e.message || String(e.error);
  errors.push(`error: ${msg}`);
  if (!booted) markError(msg);
});
window.addEventListener('unhandledrejection', (e) => {
  const r = /** @type {any} */ (e.reason);
  const msg = r && r.message ? r.message : String(r);
  errors.push(`rejection: ${msg}`);
  if (!booted) markError(msg);
});
console.error = (...args) => {
  errors.push(`console: ${args.map(a => (a && a.message ? a.message : String(a))).join(' ')}`);
  rawConsoleError(...args);
};

/** 최소 부트의 쿼리(§11.8) — 모르는 값은 무시한다 */
function readQuery(search) {
  const q = new URLSearchParams(search);
  const num = (k) => {
    const v = q.get(k);
    if (v === null || v.trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const pick = (k, list) => {
    const v = q.get(k);
    return v !== null && list.includes(v) ? v : null;
  };
  const time = num('time');
  return {
    scene: pick('scene', SCENE_IDS),
    spot: pick('spot', Object.keys(SPOTS_BY_ID)),
    time: time === null ? null : clamp(time, 0, 23.99),
    weather: pick('weather', WEATHER_IDS),
    panel: pick('panel', QUERY_PANELS),
    fixture: pick('fixture', FIXTURE_NAMES),
    seed: num('seed'),
    level: num('level'),
    money: num('money'),
    quality: pick('quality', QUALITIES),
  };
}

/** 최소 입력 수집기 — 키보드(event.code) · 좌/우 홀드와 에지 · 휠 → 드랙 눈금 · 가운데 드래그 시선. 포인터 락 · A/D 조준은 P9 */
function createMinimalInput(canvas, ui, audio, settings) {
  const held = new Set();
  const mouse = { left: false, right: false };
  const look = { yaw: 0, pitch: 0 };
  let edges = freshEdges();
  let dragSteps = 0;
  let depthSteps = 0;
  let wheelAcc = 0;
  let dragging = false;
  let unlocked = false;

  function freshEdges() {
    return { primaryPressed: false, primaryReleased: false, hook: false, interact: false, bail: false, selectSet: null };
  }
  const bound = (action, code) => KEYBINDS[action].includes(code);
  const down = (action) => KEYBINDS[action].some(c => held.has(c));
  const unlock = () => {
    if (unlocked) return;
    unlocked = true;
    audio.unlock();
  };

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    unlock();
    const c = e.code;
    if (PREVENT_KEYS.includes(c)) e.preventDefault();
    if (ui.handleKey(e)) return;
    if (bound('pause', c)) {
      if (ui.activePanel) ui.closePanel('esc');
      return;
    }
    if (bound('tackle', c)) {
      if (ui.activePanel === 'tackle') ui.closePanel('tab');
      else if (!ui.activePanel) ui.openPanel('tackle');
      return;
    }
    if (!ui.isBlocking() && !e.repeat) {
      if (bound('hook', c)) edges.hook = true;
      if (bound('interact', c)) edges.interact = true;
      if (bound('bail', c)) edges.bail = true;
      if (bound('dragTighten', c)) dragSteps += 1;
      if (bound('dragLoosen', c)) dragSteps -= 1;
      if (bound('depthDeeper', c)) depthSteps += 1;
      if (bound('depthShallower', c)) depthSteps -= 1;
      if (bound('setFloat', c)) edges.selectSet = 'float';
      if (bound('setBottom', c)) edges.selectSet = 'bottom';
    }
    held.add(c);
  });
  window.addEventListener('keyup', (e) => { held.delete(e.code); });
  window.addEventListener('blur', () => {
    held.clear();
    mouse.left = false;
    mouse.right = false;
    dragging = false;
  });
  canvas.addEventListener('pointerdown', (e) => {
    unlock();
    if (e.button === 1) {
      dragging = true;
      e.preventDefault();
      return;
    }
    if (ui.isBlocking()) return;
    if (e.button === 0) {
      mouse.left = true;
      edges.primaryPressed = true;
    } else if (e.button === 2) {
      mouse.right = true;
    }
  });
  window.addEventListener('pointerup', (e) => {
    if (e.button === 1) dragging = false;
    else if (e.button === 0 && mouse.left) {
      mouse.left = false;
      edges.primaryReleased = true;
    } else if (e.button === 2) mouse.right = false;
  });
  window.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = clamp(e.movementX, -MOUSE.spikeClampPx, MOUSE.spikeClampPx);
    const dy = clamp(e.movementY, -MOUSE.spikeClampPx, MOUSE.spikeClampPx);
    look.yaw -= dx * MOUSE.radPerPx * settings.mouseSens;
    look.pitch = clamp(look.pitch - dy * MOUSE.radPerPx * settings.mouseSens * (settings.invertY ? -1 : 1), WORLD.pitchMin, WORLD.pitchMax);
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('auxclick', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const px = e.deltaMode === 1 ? e.deltaY * WHEEL.linePx : e.deltaY;
    wheelAcc += -px / WHEEL.pxPerStep;
    const whole = Math.trunc(wheelAcc);
    if (whole) {
      dragSteps += whole;
      wheelAcc -= whole;
    }
  }, { passive: false });

  return {
    look,
    setLook(yaw, pitch) {
      look.yaw = yaw;
      look.pitch = pitch;
    },
    /** 이번 틱의 InputFrame — 에지는 한 번만 나간다 */
    buildFrame() {
      const f = makeInput({
        moveX: (down('right') ? 1 : 0) - (down('left') ? 1 : 0),
        moveZ: (down('forward') ? 1 : 0) - (down('back') ? 1 : 0),
        yaw: look.yaw,
        pitch: look.pitch,
        primary: mouse.left,
        secondary: mouse.right,
        dragSteps,
        depthSteps,
        ...edges,
      });
      edges = freshEdges();
      dragSteps = 0;
      depthSteps = 0;
      return f;
    },
  };
}

function boot() {
  const q = readQuery(location.search);
  const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('game-canvas'));
  const root = /** @type {HTMLElement} */ (document.getElementById('ui-root'));
  const settings = structuredClone(DEFAULT_SETTINGS);
  if (q.quality) settings.quality = /** @type {any} */ (q.quality);
  const bus = new EventBus();
  const profile = q.level !== null || q.money !== null ? makeDevProfile({ level: q.level, money: q.money }) : undefined;
  const sim = new GameSim({
    bus,
    seed: q.seed ?? 1,
    save: null,
    profile,
    session: { ignoreGates: true, devSession: true },
    start: {
      scene: q.scene ?? (q.spot ? undefined : 'lake'),
      spotId: q.spot ?? undefined,
      hour: q.time ?? undefined,
      weather: q.weather ?? undefined,
    },
  });

  const actions = {
    newGame: () => sim.newGame(1),
    continueGame() {},
    resume() {},
    quitToTitle() {},
    applySettings() {},
    travel: (id) => sim.travel(id),
    waitNextBand: () => sim.waitNextBand(),
    sleep: () => sim.sleep(),
    requestPointerLock() {},
  };

  let rc;
  try {
    rc = createRenderContext(canvas, settings);
  } catch (e) {
    const ui = new UIRoot({ root, bus, sim, settings, actions, fishPreview: new FishPreview() });
    ui.showFatal('fatal.webglTitle', 'fatal.webglBody');
    markError('webgl');
    return;
  }
  const world = new WorldLayer({ rc, bus, settings });
  const camera = new CameraRig({ camera: rc.camera, settings, world });
  const tackle = new TackleLayer({ rc, bus, settings, world });
  const fish = new FishLayer({ rc, bus, settings, world });
  const fx = new FxLayer({ rc, bus, settings, world });
  const audio = new AudioEngine({ bus, settings });
  const preview = new FishPreview();
  const ui = new UIRoot({ root, bus, sim, settings, actions, fishPreview: preview });
  const input = createMinimalInput(canvas, ui, audio, settings);
  bus.on(EV.PLAYER_PLACED, (p) => input.setLook(p.yaw, p.pitch));
  sim.start();

  let fixtureMode = false;
  let paused = false;
  let acc = 0;
  const syncLook = () => input.setLook(sim.state.player.yaw, sim.state.player.pitch);
  const loadFixture = (name) => {
    sim.debugLoadState(makeFixtureState(name));
    fixtureMode = true;
    acc = 0;
    syncLook();
  };
  if (q.fixture) loadFixture(q.fixture);
  if (q.panel) {
    if (q.panel === 'result' && !q.fixture) sim.debugSkipToResult();
    ui.openPanel(q.panel);
  }

  /** §11.1 의 매 프레임 순서 — 카메라 → 레이어 → 소리 → ui */
  const updateLayers = (alpha, dt) => {
    const s = sim.state;
    camera.update(s, alpha, dt, input.look);
    world.update(s, alpha, dt);
    tackle.update(s, alpha, dt);
    fish.update(s, alpha, dt);
    fx.update(s, alpha, dt);
    audio.update(s, dt);
    ui.update(s, dt);
  };
  const resultPhase = () => sim.state.rig.phase === 'result';

  let last = performance.now();
  const frame = (now) => {
    const frameDt = Math.min(Math.max(0, (now - last) / 1000), MAX_FRAME_DT);
    last = now;
    let steps = 0;
    if (!paused && !fixtureMode && !ui.isBlocking()) {
      acc += frameDt;
      while (acc >= DT && steps < MAX_STEPS_PER_FRAME && !ui.isBlocking() && !resultPhase()) {
        sim.step(input.buildFrame());
        acc -= DT;
        steps++;
      }
      if (steps === MAX_STEPS_PER_FRAME || ui.isBlocking() || resultPhase()) acc = 0;
    } else {
      acc = 0;
    }
    updateLayers(acc / DT, frameDt);
    rc.render();
    requestAnimationFrame(frame);
  };

  window.__game = {
    getState: () => sim.state,
    pause(on) {
      if (on !== undefined) paused = !!on;
      return paused;
    },
    /** n 틱을 동기로 밀고 렌더까지(§5.9) — ?fixture 모드면 sim 은 그대로 두고 레이어 · ui 를 dt = DT 로 n 번 */
    step(n = 1) {
      const k = Math.max(0, Math.floor(Number(n) || 0));
      if (fixtureMode) {
        for (let i = 0; i < k; i++) updateLayers(0, DT);
        if (k === 0) updateLayers(0, 0);
      } else {
        for (let i = 0; i < k && !resultPhase() && !ui.isBlocking(); i++) sim.step(makeInput({ yaw: input.look.yaw, pitch: input.look.pitch }));
        updateLayers(0, Math.min(k * DT, MAX_FRAME_DT));
      }
      rc.render();
      return Promise.resolve();
    },
    errors: () => errors.slice(),
    screen: () => 'play',
    gotoScene(id) {
      fixtureMode = false;
      return sim.debugGotoScene(id);
    },
    gotoSpot(id) {
      fixtureMode = false;
      return sim.debugGotoSpot(id);
    },
    openPanel: (id, args) => ui.openPanel(id, args),
    closePanel: () => ui.closePanel('code'),
    loadFixture,
    setBot: () => false,
    // §11.7 의 sim 디버그 위임(W1 통합 게이트 — sim 이 도는 화면을 정지 화면으로 보려고. W2 의 debugApi 가 같은 이름으로 대신한다)
    setTime: (h) => { fixtureMode = false; return sim.debugSetTime(h); },
    setWeather: (id) => { fixtureMode = false; return sim.debugSetWeather(id); },
    forceBite: (id, pct) => { fixtureMode = false; return sim.debugForceBite(id, pct); },
    forceFight: (id, pct) => { fixtureMode = false; return sim.debugForceFight(id, pct); },
    grant: (g) => sim.debugGrant(g),
    setGear: (slot, id, set) => sim.debugSetGear(slot, id, set),
    skipToResult: (id, pct) => { fixtureMode = false; return sim.debugSkipToResult(id, pct); },
    hash: () => sim.hash(),
  };

  // 첫 화면을 동기로 그리고 표식을 붙인다(rAF 가 늦거나 돌지 않아도 check:dist 가 본다)
  updateLayers(0, 0);
  rc.render();
  markReady();
  booted = true;
  requestAnimationFrame(frame);
}

try {
  boot();
} catch (e) {
  const msg = e && /** @type {any} */ (e).message ? /** @type {any} */ (e).message : String(e);
  errors.push(`boot: ${msg}`);
  markError(msg);
  rawConsoleError(e);
}
