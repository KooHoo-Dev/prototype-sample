// OWNER: P3 — 계약 §6.3 · §5.1 · §4.1
// STUB — W0 스텁(§6.14): 생성자가 §3.4 모양의 상태 전부 · start()(SCENE_CHANGED · PLAYER_PLACED · WEATHER_CHANGED — start.spotId 면 그 자리)
//   · step = tick · prev 복사 · advanceClock · 시선 · 모드별 updateWalk/updateRig(지금은 스텁) · 플러시(§4.1 그대로)
//   · 명령 {ok:false, reason:'stub'} · 조회는 빈 값 · debugGotoScene/debugGotoSpot 최소 · debugLoadState 는 완성. P3 가 채운다.

import { STATE_VERSION, TICKS_PER_HOUR, TICKS_PER_DAY, STAGE_IDS, WEATHER_IDS } from '../core/constants.js';
import { EV } from '../core/events.js';
import { clamp } from '../core/math.js';
import { makeRng, seedRng } from '../core/rng.js';
import { hashState } from '../core/hash.js';
import { TIME } from '../data/time.js';
import { WORLD } from '../data/world.js';
import { getSpot, getStage, stageOfSpot } from '../data/stages/index.js';
import { advanceClock, deriveClock } from './clock.js';
import { refreshWeather } from './weather.js';
import { placePlayer, updateEnv, updateWalk } from './world.js';
import { createRigState, enterSpot, syncRig, updateRig } from './fishing/rig.js';
import { createNewProfile, sanitizeProfile } from './progression/profile.js';
import { computeModifiers, rigStats } from './progression/modifiers.js';
import { dexView, previewSkill as previewSkillOf } from './progression/progress.js';
import { previewEquip as previewEquipOf } from './progression/economy.js';

/** @typedef {import('../types.js').GameState} GameState */
/** @typedef {import('../types.js').SimCtx} SimCtx */
/** @typedef {import('../types.js').InputFrame} InputFrame */
/** @typedef {import('../types.js').SaveData} SaveData */
/** @typedef {import('../types.js').Profile} Profile */
/** @typedef {import('../core/events.js').EventBus} EventBus */

const stub = () => ({ ok: false, reason: 'stub' });

export class GameSim {
  /**
   * 이벤트를 내지 않는다(레이어가 아직 없을 수 있다).
   * @param {{bus:EventBus, seed:number, save?:SaveData|null, profile?:Profile,
   *          session?:{ignoreGates?:boolean, devSession?:boolean},
   *          start?:{scene?:string, spotId?:string, hour?:number, weather?:string}}} opts
   */
  constructor(opts) {
    const { bus, seed = 1, save = null, profile, session = {}, start = {} } = opts || /** @type {any} */ ({});
    this.bus = bus;
    this._flushing = false;
    this._startSpot = start.spotId ?? null;
    this._loaded = !!save;

    const prof = save ? sanitizeProfile(save.profile) : (profile ?? createNewProfile());
    let scene = save ? save.scene : 'home';
    if (start.spotId) scene = stageOfSpot(start.spotId);
    else if (start.scene) scene = start.scene;
    const stage = getStage(scene);
    const day = save ? save.clock.day : TIME.startDay;
    const hour = Number.isFinite(start.hour) ? clamp(/** @type {number} */ (start.hour), 0, 24) : TIME.startHour;
    const tickInDay = save ? save.clock.tickInDay : Math.min(TICKS_PER_DAY - 1, Math.round(hour * TICKS_PER_HOUR));
    const s0 = Number(save ? save.seed : seed) >>> 0;

    /** @type {GameState} */
    const state = /** @type {any} */ ({
      version: STATE_VERSION,
      seed: s0,
      rng: seedRng(s0),
      tick: 0,
      scene,
      clock: deriveClock(day, tickInDay, 'clear'),
      weather: { today: {}, tomorrow: {}, current: 'clear' },
      env: { waveAmp: 0, wavePeriod: 1, headlamp: false, rain: 0, ambience: stage.ambience },
      player: {
        pos: { x: stage.spawn.x, z: stage.spawn.z },
        prevPos: { x: stage.spawn.x, z: stage.spawn.z },
        yaw: stage.spawn.yaw,
        pitch: 0,
        mode: 'walk',
        spotId: null,
        speed: 0,
        nearby: null,
      },
      rig: createRigState(prof),
      fight: null,
      pendingCatch: null,
      profile: prof,
      session: { ignoreGates: !!session.ignoreGates, devSession: !!session.devSession },
      debug: { forceBite: null, noBites: false },
      events: [],
    });
    this.state = state;

    /** @type {SimCtx} */
    const ctx = /** @type {any} */ ({
      state,
      rng: makeRng(state.rng),
      emit: (name, payload = {}) => { state.events.push({ name, payload }); },
      mods: null,
      stage,
      spot: null,
      rigStats: null,
      refresh: () => {
        ctx.mods = computeModifiers(state.profile);
        ctx.rigStats = rigStats(state.profile, state.rig.set, ctx.mods);
        syncRig(ctx);
      },
    });
    this.ctx = ctx;

    refreshWeather(ctx);
    if (start.weather && WEATHER_IDS.includes(start.weather)) {
      for (const id of STAGE_IDS) state.weather.today[id] = /** @type {any} */ (start.weather);
      state.weather.current = /** @type {any} */ (start.weather);
    }
    state.clock = deriveClock(day, tickInDay, state.weather.current);
    updateEnv(ctx);
    ctx.refresh();
    state.events.length = 0;
  }

  /** SCENE_CHANGED{start|load} · PLAYER_PLACED{spawn} · WEATHER_CHANGED → (start.spotId 면) 자리 진입 → 플러시 */
  start() {
    const s = this.state;
    const ctx = this.ctx;
    ctx.emit(EV.SCENE_CHANGED, { from: null, to: s.scene, reason: this._loaded ? 'load' : 'start' });
    ctx.emit(EV.PLAYER_PLACED, { x: s.player.pos.x, z: s.player.pos.z, yaw: s.player.yaw, pitch: s.player.pitch, reason: 'spawn' });
    ctx.emit(EV.WEATHER_CHANGED, { current: s.weather.current, today: { ...s.weather.today }, tomorrow: { ...s.weather.tomorrow } });
    if (this._startSpot) enterSpot(ctx, this._startSpot);
    this._flush();
  }

  /** §5.1 — 한 틱(DT) @param {InputFrame} input */
  step(input) {
    const s = this.state;
    const ctx = this.ctx;
    s.tick += 1;
    s.player.prevPos = { x: s.player.pos.x, z: s.player.pos.z };
    s.rig.prevBobber = { x: s.rig.bobber.x, z: s.rig.bobber.z };
    if (s.fight) {
      s.fight.prevDist = s.fight.dist;
      s.fight.prevBearing = s.fight.bearing;
    }
    advanceClock(ctx, 1);
    if (Number.isFinite(input.yaw)) s.player.yaw = input.yaw;
    if (Number.isFinite(input.pitch)) s.player.pitch = clamp(input.pitch, WORLD.pitchMin, WORLD.pitchMax);
    if (s.player.mode === 'walk') {
      const r = updateWalk(ctx, input);
      if (r && r.enterSpotId) enterSpot(ctx, r.enterSpotId);
    } else {
      updateRig(ctx, input);
    }
    this._flush();
  }

  /** §4.1 — 재진입 안전 플러시 */
  _flush() {
    if (this._flushing) return;
    this._flushing = true;
    try {
      while (this.state.events.length) {
        const q = this.state.events;
        this.state.events = [];
        for (const e of q) this.bus.emit(e.name, e.payload);
      }
    } finally {
      this._flushing = false;
    }
  }

  // ── 월드 · 시간(STUB)
  travel(sceneId) { void sceneId; return stub(); }
  waitNextBand() { return stub(); }
  sleep() { return stub(); }

  // ── 낚시 모드 전용(STUB)
  exitFishing() { return stub(); }
  keepCatch(opts = {}) { void opts; return stub(); }
  releaseCatch() { return stub(); }

  sellAll() { return stub(); }
  sellOne(uid) { void uid; return stub(); }
  buy(itemId, qty = 1) { void itemId; void qty; return stub(); }
  refillLine(set, lineId) { void set; void lineId; return stub(); }
  equip(set, slot, itemId) { void set; void slot; void itemId; return stub(); }
  setBait(set, baitId) { void set; void baitId; return stub(); }
  setDepth(depthM) { void depthM; return stub(); }
  learnSkill(skillId) { void skillId; return stub(); }
  markHintSeen(hintId) { void hintId; return stub(); }
  newGame(seed) { void seed; return stub(); }

  // ── 조회 — 상태를 바꾸지 않는다
  getRigStats(set = this.state.rig.set) { return rigStats(this.state.profile, set, this.ctx.mods); }
  getShop() { return []; }
  getSellQuote() { return { items: [], total: 0 }; }
  getDex(stageId) { return dexView(this.state.profile, stageId, this.ctx.mods); }
  getForecast() {
    const w = this.state.weather;
    return { today: { ...w.today }, tomorrow: { ...w.tomorrow }, activeByBand: {} };
  }
  getTravel() { return []; }
  previewEquip(set, slot, itemId) { return previewEquipOf(this.state.profile, set, slot, itemId, this.ctx.mods); }
  previewSkill(skillId) { return previewSkillOf(this.state.profile, skillId); }
  biteInfo() { return null; }
  hash() { return hashState(this.state); }

  // ── 디버그
  debugSetTime(hour) { void hour; return stub(); }
  debugSetWeather(weatherId) { void weatherId; return stub(); }

  /** STUB(최소) — 레벨 게이트 무시 · 씬 교체 · spawn 에 걷기 모드 · SCENE_CHANGED{debug} · PLAYER_PLACED{debug} */
  debugGotoScene(sceneId) {
    const s = this.state;
    const ctx = this.ctx;
    const stage = getStage(sceneId);
    const from = s.scene;
    s.scene = /** @type {any} */ (sceneId);
    ctx.stage = stage;
    ctx.spot = null;
    s.player.mode = 'walk';
    s.player.spotId = null;
    s.player.nearby = null;
    s.rig = createRigState(s.profile);
    s.fight = null;
    s.pendingCatch = null;
    s.weather.current = sceneId === 'home' ? s.weather.today.lake : s.weather.today[sceneId] ?? s.weather.current;
    s.clock = deriveClock(s.clock.day, s.clock.tickInDay, s.weather.current);
    updateEnv(ctx);
    ctx.refresh();
    ctx.emit(EV.SCENE_CHANGED, { from, to: sceneId, reason: 'debug' });
    placePlayer(ctx, stage.spawn, stage.spawn.yaw, 0, 'debug');
    this._flush();
    return { ok: true };
  }

  /** STUB(최소) — 그 자리의 씬으로 옮기고 자리에 선다 */
  debugGotoSpot(spotId) {
    getSpot(spotId);
    const sceneId = stageOfSpot(spotId);
    if (this.state.scene !== sceneId || this.state.player.mode !== 'walk') this.debugGotoScene(sceneId);
    enterSpot(this.ctx, spotId);
    this._flush();
    return { ok: true };
  }

  debugForceBite(speciesId, pct) { void speciesId; void pct; return stub(); }
  debugForceFight(speciesId, pct) { void speciesId; void pct; return stub(); }
  debugGrant({ money, xp } = {}) { void money; void xp; return stub(); }
  debugSetGear(slot, itemId, set = this.state.rig.set) { void slot; void itemId; void set; return stub(); }
  debugSkipToResult(speciesId = 'crucian', pct = 0.5) { void speciesId; void pct; return stub(); }
  debugNoBites(on) { this.state.debug.noBites = !!on; return { ok: true }; }

  /**
   * ?fixture 전용(완성): state 의 필드를 제자리에서 덮어쓴다(같은 객체 — rng 도 같은 객체에 값만).
   * ctx.stage/spot/mods/rigStats 를 다시 계산한다(syncRig 는 부르지 않는다 — 고정 상태 값 그대로). 이벤트를 내지 않는다.
   * @param {GameState} stateObj
   */
  debugLoadState(stateObj) {
    const src = structuredClone(stateObj);
    const s = /** @type {any} */ (this.state);
    for (const key of Object.keys(src)) {
      if (key === 'rng') s.rng.s = src.rng.s;
      else s[key] = src[key];
    }
    s.events = [];
    const ctx = this.ctx;
    ctx.stage = getStage(s.scene);
    ctx.spot = s.player.spotId ? getSpot(s.player.spotId) : null;
    ctx.mods = computeModifiers(s.profile);
    ctx.rigStats = rigStats(s.profile, s.rig.set, ctx.mods);
    return { ok: true };
  }
}
