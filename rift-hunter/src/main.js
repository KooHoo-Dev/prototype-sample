// OWNER: P9 — 계약 §11.10 · §11.1 (W0: P0 의 「최소 부트」 — W2 에서 P9 가 `new Game(document).start()` 로 교체한다)
// 스텁 위에서 돈다: EventBus → GameSim(devSession) → start → 캐릭터 붙이기 → (?fixture | ?scene=rift) → 렌더 컨텍스트 →
// 모든 레이어를 계약 deps 그대로(WorldLayer · ActorLayer · FxLayer · CameraRig · AudioEngine · UIRoot) → rAF 누산 루프(§5.12) → 첫 렌더 뒤 markReady.
// W1 에서 각 패키지가 자기 레이어를 채우면 이 최소 부트에 그대로 뜬다(main.js 를 고치지 않는다).
// 쿼리: ?fixture=<id> · ?panel=<PanelId> · ?class=warrior|mage · ?scene=town|rift · ?seed=n · ?fresh(무시 — 저장하지 않는다)

import { markError, markReady } from './app/bootMarker.js';
import { CLASS_IDS, DT, MAX_FRAME_DT, MAX_STEPS_PER_FRAME, PANEL_IDS } from './core/constants.js';
import { EV, EventBus } from './core/events.js';
import { hash32, hashState } from './core/hash.js';
import { makeInput } from './core/inputFrame.js';
import { KEYBINDS, MOUSE } from './data/keybinds.js';
import { DEFAULT_SETTINGS } from './data/settings.js';
import { FIXTURES } from './debug/fixtures.js';
import { AudioEngine } from './audio/AudioEngine.js';
import { GameSim } from './sim/GameSim.js';
import { createCtx } from './sim/ctx.js';
import { populateRift } from './sim/monsters/packs.js';
import { placePlayer } from './sim/player/controller.js';
import { createCharacter } from './sim/progression/character.js';
import { createRiftState } from './sim/state.js';
import { generateRift } from './sim/world/mapgen.js';
import { buildTownMap } from './sim/world/townMap.js';
import { UIRoot } from './ui/UIRoot.js';
import { ActorLayer } from './view/ActorLayer.js';
import { CameraRig } from './view/CameraRig.js';
import { FxLayer } from './view/FxLayer.js';
import { WorldLayer } from './view/WorldLayer.js';
import { createRenderContext } from './view/renderer.js';

/** @type {string[]} */
const errors = [];
let booted = false;
const note = (what) => {
  const s = String(what && /** @type {any} */ (what).stack ? /** @type {any} */ (what).stack.split('\n')[0] : what);
  errors.push(s);
  if (!booted) markError(s);
  return s;
};
window.addEventListener('error', (e) => { note(e.error ?? e.message); });
window.addEventListener('unhandledrejection', (e) => { note(e.reason); });

try {
  boot();
} catch (e) {
  note(e);
  console.error(e);
}

function boot() {
  const q = new URLSearchParams(location.search);
  const seed = (Number(q.get('seed')) >>> 0) || 1;
  const cls = /** @type {'warrior'|'mage'} */ (CLASS_IDS.includes(q.get('class') ?? '') ? q.get('class') : CLASS_IDS[0]);
  const settings = { ...DEFAULT_SETTINGS };
  const bus = new EventBus();
  const sim = new GameSim({ bus, seed, devSession: true });
  const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('game-canvas'));
  const root = /** @type {HTMLElement} */ (document.getElementById('ui-root'));
  const actions = {
    continueGame() {}, selectChar() {}, newChar() {}, deleteChar() {}, openRift(level) { return sim.openRift(level); },
    returnToRift() { return sim.returnToRift(); }, respawn() { return sim.respawn(); }, quitToTitle() {}, resume() {},
    applySettings(partial) { Object.assign(settings, partial); bus.emit(EV.SETTINGS_CHANGED, { settings }); }, setBot() {}, downloadFile() {},
  };

  let rc;
  try {
    rc = createRenderContext(canvas, settings);
  } catch (e) {
    const ui = new UIRoot({ root, bus, sim, settings, actions, view: { project: () => ({ x: 0, y: 0, visible: false }) } });
    ui.showFatal('fatal.webglTitle', 'fatal.webglBody');
    markError('webgl');
    return;
  }
  const world = new WorldLayer({ rc, bus, settings });
  const actors = new ActorLayer({ rc, bus, settings });
  const fx = new FxLayer({ rc, bus, settings });
  const camera = new CameraRig({ rc, bus, settings });
  const audio = new AudioEngine({ bus, settings });
  const ui = new UIRoot({ root, bus, sim, settings, actions, view: { project: rc.project } });
  bus.on(EV.MAP_LOADED, () => {
    const m = sim.getMap();
    world.setMap(m);
    actors.setMap(m);
    fx.setMap(m);
  });
  bus.on(EV.PLAYER_SPAWNED, () => camera.snap());

  sim.start();
  sim.loadCharacter(0, createCharacter({ slot: 0, cls, name: 'Hunter', newId: sim.ctx.newItemId, seed: hash32(seed, 0) }));

  /** 고정 상태(§11.9) — 마을 맵은 sim 의 buildTownMap() 으로 바꿔 넘긴다 @param {string} id */
  const loadFixture = (id) => {
    const make = FIXTURES[id];
    if (!make) return false;
    const f = make(seed);
    const map = f.map.kind === 'town' ? buildTownMap() : f.map;
    sim.debugLoadState(f.state, map, f.riftMap);
    return true;
  };
  /** ?scene=rift — 스텁 맵 · 스텁 균열 채우기로 균열 1 상태를 직접 세운다 */
  const enterStubRift = () => {
    const st = sim.state;
    const map = generateRift(seed, 1);
    st.rift = createRiftState({ level: 1, seed, tileset: map.tileset, mapId: map.id, map, tick: st.tick });
    st.scene = 'rift';
    const ctx = createCtx(st, { map, riftMap: map });
    populateRift(ctx);
    placePlayer(ctx, map.spawn.x, map.spawn.z, map.spawn.facing);
    sim.debugLoadState(st, map, map);
  };
  const fixtureId = q.get('fixture');
  if (fixtureId) {
    if (!loadFixture(fixtureId)) errors.push(`unknown fixture '${fixtureId}'`);
  } else if (q.get('scene') === 'rift') {
    enterStubRift();
  }
  const panelId = q.get('panel');
  if (panelId && PANEL_IDS.includes(panelId)) ui.openPanel(/** @type {any} */ (panelId));

  // ── 최소 입력 수집기 ──
  const inp = { x: 0, y: 0, inside: false, lmb: false, lmbDown: false, slot: [false, false, false, false, false], slotDown: [false, false, false, false, false], shift: false, potionDown: false, recallDown: false };
  const clearEdges = () => {
    inp.lmbDown = false;
    inp.slotDown = [false, false, false, false, false];
    inp.potionDown = false;
    inp.recallDown = false;
  };
  const releaseAll = () => {
    inp.lmb = false;
    inp.slot = [false, false, false, false, false];
    inp.shift = false;
    clearEdges();
  };
  const collect = () => {
    const frame = makeInput({
      cursor: inp.inside ? rc.groundAt(inp.x, inp.y) : null,
      hover: null,
      lmb: inp.lmb, lmbDown: inp.lmbDown, slot: inp.slot, slotDown: inp.slotDown, shift: inp.shift, potionDown: inp.potionDown, recallDown: inp.recallDown,
    });
    clearEdges();
    return frame;
  };
  const onKey = (e, down) => {
    if (ui.handleKey(e)) { e.preventDefault(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = KEYBINDS.skill.indexOf(e.code);
    if (k >= 0) { if (down && !inp.slot[k + 1]) inp.slotDown[k + 1] = true; inp.slot[k + 1] = down; }
    else if (KEYBINDS.stand.includes(e.code)) inp.shift = down;
    else if (e.code === KEYBINDS.potion && down && !e.repeat) inp.potionDown = true;
    else if (e.code === KEYBINDS.recall && down && !e.repeat) inp.recallDown = true;
    else if (e.code === KEYBINDS.pause && down) ui.openPanel('pause');
    else return;
    e.preventDefault();
  };
  window.addEventListener('keydown', (e) => onKey(e, true));
  window.addEventListener('keyup', (e) => onKey(e, false));
  window.addEventListener('blur', releaseAll);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mousemove', (e) => { inp.x = e.offsetX; inp.y = e.offsetY; inp.inside = true; });
  canvas.addEventListener('mouseleave', () => { inp.inside = false; inp.lmb = false; });
  canvas.addEventListener('mousedown', (e) => {
    inp.x = e.offsetX; inp.y = e.offsetY; inp.inside = true;
    if (e.button === MOUSE.move) { inp.lmb = true; inp.lmbDown = true; }
    else if (e.button === MOUSE.skill0) { if (!inp.slot[0]) inp.slotDown[0] = true; inp.slot[0] = true; }
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === MOUSE.move) inp.lmb = false;
    else if (e.button === MOUSE.skill0) inp.slot[0] = false;
  });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); camera.zoom(Math.sign(e.deltaY)); }, { passive: false });

  // ── 루프(§5.12) · 렌더 순서(§9.1): world → actors → fx → camera → render → ui ──
  const resize = () => rc.resize(window.innerWidth, window.innerHeight);
  window.addEventListener('resize', resize);
  resize();
  const render = (alpha, dtReal) => {
    const st = sim.state;
    const target = camera.target;
    world.update(st, alpha, dtReal, target);
    actors.update(st, alpha, dtReal, target);
    fx.update(st, alpha, dtReal, target);
    camera.update(st, alpha, dtReal);
    rc.render();
    ui.update(st, alpha, dtReal);
    audio.update(st, dtReal);
  };
  let paused = false;
  let acc = 0;
  let last = performance.now();
  const frame = (now) => {
    try {
      const dt = Math.min(Math.max(0, (now - last) / 1000), MAX_FRAME_DT);
      last = now;
      if (!paused && !ui.isModal()) {
        acc += dt;
        let steps = 0;
        while (acc >= DT && steps < MAX_STEPS_PER_FRAME) {
          sim.step(collect());
          acc -= DT;
          steps++;
        }
        if (acc > 2 * DT) acc = 0;
      }
      render(paused ? 1 : acc / DT, dt);
    } catch (e) {
      note(e);
      console.error(e);
    }
    requestAnimationFrame(frame);
  };

  // ── 디버그 API(§11.10 의 최소 목록) ──
  /** @type {any} */ (window).__game = {
    sim,
    getState: () => sim.state,
    pause: (on = true) => { paused = !!on; return Promise.resolve(paused); },
    step: (n = 1) => {
      for (let i = 0; i < Math.max(0, n | 0); i++) sim.step(collect());
      acc = 0;
      render(1, 0);
      return Promise.resolve(sim.state.tick);
    },
    errors: () => errors.slice(),
    screen: () => 'play',
    panel: () => ui.topPanel(),
    openPanel: (id, args) => ui.openPanel(id, args),
    closePanel: () => ui.closePanel(),
    loadFixture: (id) => { const ok = loadFixture(id); render(1, 0); return ok; },
    setBot: () => {},
    hash: () => hashState(sim.state),
    memory: () => ({ rc: rc.stats(), dom: document.querySelectorAll('*').length, listeners: bus.count(), audio: audio.stats() }),
  };

  render(1, 0);
  booted = true;
  markReady();
  requestAnimationFrame(frame);
}
