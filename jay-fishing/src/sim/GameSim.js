// OWNER: P3 — 계약 §6.3 · §5.1 · §4.1
// 게임 상태의 정본과 틱 순서의 주인. 명령 메서드(ui · 봇)는 상태를 바꾸고 끝에서 플러시한다.
// 플러시는 재진입에 안전하다 — 리스너가 플러시 도중에 명령을 불러도 안쪽 호출은 큐에 쌓기만 하고 바깥 루프가 순서대로 낸다.

import { SCENE_IDS, SET_IDS, STAGE_IDS, STATE_VERSION, TICKS_PER_DAY, TICKS_PER_HOUR, WEATHER_IDS, BAND_IDS, HINT_IDS } from '../core/constants.js';
import { EV } from '../core/events.js';
import { clamp } from '../core/math.js';
import { makeRng, seedRng } from '../core/rng.js';
import { hashState } from '../core/hash.js';
import { NEUTRAL_INPUT } from '../core/inputFrame.js';
import { TIME } from '../data/time.js';
import { WORLD } from '../data/world.js';
import { GEAR_BY_ID } from '../data/gear.js';
import { SPECIES } from '../data/species/index.js';
import { SPOTS_BY_ID, STAGES_BY_ID, getSpot, getStage, stageOfSpot } from '../data/stages/index.js';
import { addHours, advanceClock, deriveClock, nextBandStart, nextWake, rederiveClock, setClock } from './clock.js';
import { currentWeatherOf, refreshWeather, weatherPayload } from './weather.js';
import { arriveHome, placePlayer, updateWalk } from './world.js';
import {
  createRigState, enterSpot, exitSpot, forceBite, forceFight, keepCatch as rigKeepCatch, releaseCatch as rigReleaseCatch,
  setFloatDepth, skipToResult, syncRig, updateRig,
} from './fishing/rig.js';
import { biteRate, biteWeights, meanWait } from './fishing/biteModel.js';
import { createNewProfile, sanitizeProfile } from './progression/profile.js';
import { computeModifiers, rigStats } from './progression/modifiers.js';
import { addXp, dexView, learnSkill as learnSkillOf, previewSkill as previewSkillOf } from './progression/progress.js';
import {
  buy as buyOf, equip as equipOf, previewEquip as previewEquipOf, refillLine as refillLineOf, sellAll as sellAllOf,
  sellOne as sellOneOf, sellPrice, setBait as setBaitOf, shopList,
} from './progression/economy.js';

/** @typedef {import('../types.js').GameState} GameState */
/** @typedef {import('../types.js').SimCtx} SimCtx */
/** @typedef {import('../types.js').InputFrame} InputFrame */
/** @typedef {import('../types.js').SaveData} SaveData */
/** @typedef {import('../types.js').Profile} Profile */
/** @typedef {import('../types.js').SceneId} SceneId */
/** @typedef {import('../core/events.js').EventBus} EventBus */

/** 디버그가 집에서 낚시 자리를 요구할 때 세우는 자리(§6.3) */
const HOME_DEBUG_SPOT = 'lake_gravel';
/** equip 이 되는 단계(§6.3) */
const EQUIP_PHASES = ['ready', 'idle'];
/** 상점의 라인 감기 항목 id 접두사(§3.6 ShopItem.id 'refill_<set>_<lineId>') */
const REFILL_ITEM = 'refill_';

const fail = (reason, params) => (params ? { ok: false, reason, params } : { ok: false, reason });
const finiteOr = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export class GameSim {
  /**
   * 이벤트를 내지 않는다(레이어가 아직 없을 수 있다).
   * @param {{bus:EventBus, seed:number, save?:SaveData|null, profile?:Profile,
   *          session?:{ignoreGates?:boolean, devSession?:boolean},
   *          start?:{scene?:SceneId, spotId?:string, hour?:number, weather?:string}}} opts
   */
  constructor(opts) {
    const { bus, seed = 1, save = null, profile, session = {}, start = {} } = opts || /** @type {any} */ ({});
    this.bus = bus;
    this._flushing = false;
    const st = start || {};
    this._startSpot = st.spotId && SPOTS_BY_ID[st.spotId] ? st.spotId : null;
    this._loaded = !!save;

    const prof = save ? sanitizeProfile(save.profile) : (profile ?? createNewProfile());
    /** @type {string} */
    let scene = save && SCENE_IDS.includes(save.scene) ? save.scene : 'home';
    if (this._startSpot) scene = stageOfSpot(this._startSpot);
    else if (st.scene && SCENE_IDS.includes(st.scene)) scene = st.scene;
    const stage = getStage(scene);
    const sc = save && save.clock ? save.clock : null;
    const day = sc ? Math.max(1, Math.floor(finiteOr(sc.day, TIME.startDay))) : TIME.startDay;
    let tickInDay = sc ? clamp(Math.floor(finiteOr(sc.tickInDay, 0)), 0, TICKS_PER_DAY - 1) : Math.round(TIME.startHour * TICKS_PER_HOUR);
    if (Number.isFinite(st.hour)) tickInDay = Math.min(TICKS_PER_DAY - 1, Math.round(clamp(/** @type {number} */ (st.hour), 0, 24) * TICKS_PER_HOUR));
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
        vel: { x: 0, z: 0 },
      },
      rig: createRigState(prof),
      fight: null,
      pendingCatch: null,
      profile: prof,
      session: { ignoreGates: !!(session && session.ignoreGates), devSession: !!(session && session.devSession) },
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
    if (st.weather && WEATHER_IDS.includes(st.weather)) {
      for (const id of STAGE_IDS) state.weather.today[id] = /** @type {any} */ (st.weather);
      state.weather.current = /** @type {any} */ (st.weather);
    }
    rederiveClock(ctx);
    rigAtPlayer(state);
    ctx.refresh();
    state.events.length = 0;
  }

  /** SCENE_CHANGED{start|load} · PLAYER_PLACED{spawn} · WEATHER_CHANGED → (start.spotId 면) 자리 진입 → 플러시 */
  start() {
    const s = this.state;
    const ctx = this.ctx;
    ctx.emit(EV.SCENE_CHANGED, { from: null, to: s.scene, reason: this._loaded ? 'load' : 'start' });
    ctx.emit(EV.PLAYER_PLACED, { x: s.player.pos.x, z: s.player.pos.z, yaw: s.player.yaw, pitch: s.player.pitch, reason: 'spawn' });
    ctx.emit(EV.WEATHER_CHANGED, weatherPayload(s));
    if (this._startSpot && s.player.mode === 'walk') enterSpot(ctx, this._startSpot);
    this._flush();
  }

  /** §5.1 — 한 틱(DT) @param {InputFrame} input */
  step(input) {
    const s = this.state;
    const ctx = this.ctx;
    const inp = input || NEUTRAL_INPUT;
    // 1. 틱 · 보간용 직전 값(제자리 복사 — 할당 없음)
    s.tick += 1;
    const p = s.player;
    copyPrev(p, 'prevPos', p.pos);
    copyPrev(s.rig, 'prevBobber', s.rig.bobber);
    if (s.fight) {
      s.fight.prevDist = s.fight.dist;
      s.fight.prevBearing = s.fight.bearing;
    }
    // 2. 시계
    advanceClock(ctx, 1);
    // 3. 시선
    if (Number.isFinite(inp.yaw)) p.yaw = inp.yaw;
    if (Number.isFinite(inp.pitch)) p.pitch = clamp(inp.pitch, WORLD.pitchMin, WORLD.pitchMax);
    // 4. 모드별
    if (p.mode === 'walk') {
      const r = updateWalk(ctx, inp);
      if (r && r.enterSpotId) enterSpot(ctx, r.enterSpotId);
      else rigAtPlayer(s);   // §3.4 origin — 낚시 모드가 아니면 player.pos
    } else {
      updateRig(ctx, inp);
    }
    // 5. 플러시
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

  /** 명령의 공통 끝 — 플러시하고 결과를 돌려준다 */
  _done(result) {
    this._flush();
    return result;
  }

  // ── 씬 전환(내부)

  /**
   * 씬을 바꾸고 spawn 에 걷기 모드로 세운다: 낚시 중이면 강제로 정리(디버그) → scene · ctx.stage · ctx.spot · 날씨 current · 시계 빛 · refresh
   * → SCENE_CHANGED → PLAYER_PLACED → WEATHER_CHANGED. 플러시하지 않는다.
   * @param {string} sceneId @param {'travel'|'debug'} reason
   */
  _switchScene(sceneId, reason) {
    const s = this.state;
    const ctx = this.ctx;
    const stage = getStage(sceneId);
    const from = s.scene;
    this._dropFishing();
    s.scene = /** @type {any} */ (sceneId);
    ctx.stage = stage;
    ctx.spot = null;
    s.player.nearby = null;
    s.weather.current = currentWeatherOf(s);
    rederiveClock(ctx);
    ctx.refresh();
    ctx.emit(EV.SCENE_CHANGED, { from, to: sceneId, reason });
    placePlayer(ctx, stage.spawn, stage.spawn.yaw, 0, reason === 'debug' ? 'debug' : 'spawn');
    rigAtPlayer(s);
    ctx.emit(EV.WEATHER_CHANGED, weatherPayload(s));
  }

  /** 낚시 모드 · 파이팅 · 결과 대기를 남김없이 지우고 걷기 모드로(디버그 · 새 게임). 세트는 유지 */
  _dropFishing() {
    const s = this.state;
    const ctx = this.ctx;
    const wasFishing = s.player.mode === 'fish';
    const spotId = s.player.spotId;
    const set = s.rig.set;
    s.rig = createRigState(s.profile);
    s.rig.set = set;
    s.fight = null;
    s.pendingCatch = null;
    s.player.mode = 'walk';
    s.player.spotId = null;
    ctx.spot = null;
    if (wasFishing) ctx.emit(EV.FISHING_EXIT, { spotId });
  }

  /** 디버그용: 낚시 모드가 아니면 그 씬의 첫 자리(집이면 lake_gravel)에 선다 @returns {boolean} 낚시 모드인가 */
  _ensureFishing() {
    const s = this.state;
    if (s.player.mode === 'fish' && this.ctx.spot) return true;
    const stage = getStage(s.scene);
    const spotId = s.scene === 'home' || !stage.spots.length ? HOME_DEBUG_SPOT : stage.spots[0].id;
    this._gotoSpot(spotId);
    return s.player.mode === 'fish';
  }

  /** @param {string} spotId */
  _gotoSpot(spotId) {
    const s = this.state;
    const sceneId = stageOfSpot(spotId);
    if (s.scene !== sceneId || s.player.mode !== 'walk') this._switchScene(sceneId, 'debug');
    return enterSpot(this.ctx, spotId);
  }

  /** 이동 가능 여부(travel · getTravel 공용) @param {string} sceneId */
  _travelCheck(sceneId) {
    const s = this.state;
    if (!SCENE_IDS.includes(sceneId)) return fail('invalid');
    if (s.player.mode !== 'walk') return fail('busy');
    if (sceneId === s.scene) return fail('same');
    if (s.scene !== 'home' && sceneId !== 'home') return fail('notHere');   // 스테이지끼리는 집을 거친다
    const need = getStage(sceneId).unlockLevel;
    if (!s.session.ignoreGates && s.profile.level < need) return fail('locked', { n: need });
    return { ok: true };
  }

  // ── 월드 · 시간 — 걷기 모드에서만

  /**
   * 집에서는 세 스테이지, 야외에서는 'home'만. 시계 +TIME.travelHours · 씬 교체 · spawn 배치.
   * 집 도착은 §5.6 의 순서(자동 판매 → line_1 무료 감기 → 무료 미끼 → SAVE_REQUEST{scene}).
   * @param {SceneId} sceneId
   */
  travel(sceneId) {
    const chk = this._travelCheck(sceneId);
    if (!chk.ok) return chk;
    const s = this.state;
    const ctx = this.ctx;
    const to = addHours(s.clock.day, s.clock.tickInDay, TIME.travelHours);
    this._switchScene(sceneId, 'travel');
    setClock(ctx, to.day, to.tickInDay, 'travel');
    if (sceneId === 'home') arriveHome(ctx);
    else ctx.emit(EV.SAVE_REQUEST, { reason: 'scene' });
    return this._done({ ok: true });
  }

  /** 야외만 — 다음 시간대 시작으로(캠프) */
  waitNextBand() {
    const s = this.state;
    if (s.player.mode !== 'walk') return fail('busy');
    if (getStage(s.scene).kind !== 'outdoor') return fail('notHere');
    const nb = nextBandStart(s.clock.day, s.clock.tickInDay);
    setClock(this.ctx, nb.day, nb.tickInDay, 'camp');
    return this._done({ ok: true, band: s.clock.band });
  }

  /** 집만 — 다음 06:00 · SAVE_REQUEST{sleep} */
  sleep() {
    const s = this.state;
    if (s.player.mode !== 'walk') return fail('busy');
    if (s.scene !== 'home') return fail('notHere');
    const nw = nextWake(s.clock.day, s.clock.tickInDay);
    setClock(this.ctx, nw.day, nw.tickInDay, 'bed');
    this.ctx.emit(EV.SAVE_REQUEST, { reason: 'sleep' });
    return this._done({ ok: true, day: s.clock.day });
  }

  // ── 낚시 모드 전용

  /** §5.2 — 걷기 모드면 notHere */
  exitFishing() {
    if (this.state.player.mode !== 'fish') return fail('notHere');
    return this._done(exitSpot(this.ctx));
  }

  /** result 단계만. 어창이 차 있으면 opts.swapUid 가 있어야 한다 @param {{swapUid?:number}} [opts] */
  keepCatch(opts = {}) {
    return this._done(rigKeepCatch(this.ctx, opts || {}));
  }

  /** result 단계만 */
  releaseCatch() {
    return this._done(rigReleaseCatch(this.ctx));
  }

  // ── 판매 · 상점 · 채비

  sellAll() { return this._done(sellAllOf(this.ctx, { auto: false })); }

  /** @param {number} uid */
  sellOne(uid) { return this._done(sellOneOf(this.ctx, uid)); }

  /** 장비 · 미끼 팩(itemId = 'bait_<id>') @param {string} itemId @param {number} [qty] */
  buy(itemId, qty = 1) {
    // 라인 감기 항목은 refillLine 과 같은 길로(집의 line_1 무료 — W1 확정: getShop · buy · refillLine 이 같은 값)
    if (typeof itemId === 'string' && itemId.startsWith(REFILL_ITEM)) {
      const rest = itemId.slice(REFILL_ITEM.length);
      const cut = rest.indexOf('_');
      if (cut < 0) return this._done(fail('invalid'));
      return this.refillLine(rest.slice(0, cut), rest.slice(cut + 1));
    }
    return this._done(buyOf(this.ctx, itemId, qty));
  }

  /** 판매상 · PC. 집이면 line_1 무료 @param {'float'|'bottom'} set @param {string} [lineId] 기본 = 지금 라인 */
  refillLine(set, lineId) {
    const s = this.state;
    if (!SET_IDS.includes(set)) return fail('invalid');
    const id = lineId ?? s.profile.sets[set].lineId;
    const free = s.scene === 'home' && id === 'line_1';
    return this._done(refillLineOf(this.ctx, set, id, { free }));
  }

  /** ready/idle 에서만 — 그 밖 busy @param {'float'|'bottom'} set @param {string} slot @param {string} itemId */
  equip(set, slot, itemId) {
    if (!EQUIP_PHASES.includes(this.state.rig.phase)) return fail('busy');
    return this._done(equipOf(this.ctx, set, slot, itemId));
  }

  /** 언제나 — 다음 캐스팅부터 @param {'float'|'bottom'} set @param {string} baitId */
  setBait(set, baitId) { return this._done(setBaitOf(this.ctx, set, baitId)); }

  /** 찌 세트 수심 — §5.2 의 depthSteps 와 같은 단계 규칙 @param {number} depthM */
  setDepth(depthM) { return this._done(setFloatDepth(this.ctx, depthM)); }

  /** @param {string} skillId */
  learnSkill(skillId) { return this._done(learnSkillOf(this.ctx, skillId)); }

  /** profile.flags.hints[id] = true · SAVE_REQUEST{hint}(처음일 때만) @param {string} hintId */
  markHintSeen(hintId) {
    if (!HINT_IDS.includes(hintId)) return fail('invalid');
    const flags = this.state.profile.flags;
    if (!flags.hints) flags.hints = {};
    if (!flags.hints[hintId]) {
      flags.hints[hintId] = true;
      this.ctx.emit(EV.SAVE_REQUEST, { reason: 'hint' });
    }
    return this._done({ ok: true });
  }

  /**
   * 처음 상태로 되돌린다 — 파이팅 · 결과 대기 · 낚시 모드 · 옛 시드 · 옛 프로필 · 디버그 강제 값이 남지 않는다.
   * SCENE_CHANGED{new} → PLAYER_PLACED{spawn} → WEATHER_CHANGED → SAVE_REQUEST{new}.
   * @param {number} seed
   */
  newGame(seed) {
    const s = this.state;
    const ctx = this.ctx;
    const from = s.scene;
    const wasFishing = s.player.mode === 'fish';
    const oldSpot = s.player.spotId;
    const seedU = Number.isFinite(Number(seed)) && seed !== null && seed !== undefined ? Number(seed) >>> 0 : s.seed;
    s.seed = seedU;
    s.rng.s = seedRng(seedU).s;                       // 같은 객체(ctx.rng 가 붙들고 있다)에 값만
    s.tick = 0;
    const prof = /** @type {any} */ (s.profile);
    for (const k of Object.keys(prof)) delete prof[k];
    Object.assign(prof, createNewProfile());
    s.rig = createRigState(prof);
    s.fight = null;
    s.pendingCatch = null;
    s.debug = { forceBite: null, noBites: false };
    s.scene = 'home';
    const home = getStage('home');
    ctx.stage = home;
    ctx.spot = null;
    const p = s.player;
    p.mode = 'walk';
    p.spotId = null;
    p.nearby = null;
    s.clock.day = TIME.startDay;
    s.clock.tickInDay = Math.round(TIME.startHour * TICKS_PER_HOUR);
    refreshWeather(ctx);
    rederiveClock(ctx);
    ctx.refresh();
    if (wasFishing) ctx.emit(EV.FISHING_EXIT, { spotId: oldSpot });
    ctx.emit(EV.SCENE_CHANGED, { from, to: 'home', reason: 'new' });
    placePlayer(ctx, home.spawn, home.spawn.yaw, 0, 'spawn');
    rigAtPlayer(s);
    ctx.emit(EV.WEATHER_CHANGED, weatherPayload(s));
    ctx.emit(EV.SAVE_REQUEST, { reason: 'new' });
    return this._done({ ok: true });
  }

  // ── 조회 — 상태를 바꾸지 않는다

  /** @param {'float'|'bottom'} [set] */
  getRigStats(set = this.state.rig.set) { return rigStats(this.state.profile, set, this.ctx.mods); }

  getShop() {
    const items = shopList(this.state.profile, this.ctx.mods);
    if (this.state.scene !== 'home') return items;
    // 집의 1단계 라인 감기는 무료(§6.3 refillLine) — 목록도 같은 값을 보인다(W1 확정 · NOTES-P4 #2)
    for (const it of items) {
      if (it.kind !== 'line' || !GEAR_BY_ID[it.lineId] || GEAR_BY_ID[it.lineId].tier !== 1) continue;
      it.price = 0;
      if (it.reason === 'money') { it.ok = true; it.reason = null; it.reasonParams = null; }
    }
    return items;
  }

  /** → {items: Array<{uid, price}>, total} (흥정 반영) */
  getSellQuote() {
    const items = [];
    let total = 0;
    for (const rec of this.state.profile.hold) {
      const price = sellPrice(rec, this.ctx.mods);
      items.push({ uid: rec.uid, price });
      total += price;
    }
    return { items, total };
  }

  /** @param {string} stageId */
  getDex(stageId) { return dexView(this.state.profile, stageId, this.ctx.mods); }

  /** → {today, tomorrow, activeByBand} — activeByBand 는 활동 계수 H 인 (판타지 아닌) 어종 · 어종 지식 1 이상만 채운다(그 밖 빈 배열) */
  getForecast() {
    const w = this.state.weather;
    const know = (this.ctx.mods && this.ctx.mods.knowledge) || 0;
    const activeByBand = {};
    for (const st of STAGE_IDS) {
      const byBand = {};
      for (const b of BAND_IDS) byBand[b] = [];
      if (know >= 1) {
        for (const sp of SPECIES) {
          if (sp.stage !== st || sp.fantasy) continue;
          for (let i = 0; i < BAND_IDS.length; i++) if (sp.time[i] === 'H') byBand[BAND_IDS[i]].push(sp.id);
        }
      }
      activeByBand[st] = byBand;
    }
    return { today: { ...w.today }, tomorrow: { ...w.tomorrow }, activeByBand };
  }

  /** 집에서는 세 스테이지, 야외에서는 [home] 하나 */
  getTravel() {
    const s = this.state;
    const ids = s.scene === 'home' ? STAGE_IDS : ['home'];
    return ids.map((id) => {
      const chk = this._travelCheck(id);
      return {
        id: /** @type {SceneId} */ (id),
        ok: !!chk.ok,
        reason: chk.ok ? null : chk.reason,
        reasonParams: chk.ok ? null : (chk.params ?? null),
        unlockLevel: STAGES_BY_ID[id].unlockLevel,
        weather: id === 'home' ? null : (s.weather.today[id] ?? null),
      };
    });
  }

  previewEquip(set, slot, itemId) { return previewEquipOf(this.state.profile, set, slot, itemId, this.ctx.mods); }

  previewSkill(skillId) { return previewSkillOf(this.state.profile, skillId); }

  /** waiting 일 때만 — 측정 · 디버그용(ui 는 쓰지 않는다) */
  biteInfo() {
    const s = this.state;
    const r = s.rig;
    const spot = this.ctx.spot;
    if (r.phase !== 'waiting' || !spot) return null;
    const baitId = r.castBaitId ?? s.profile.sets[r.set].bait;
    const weights = biteWeights({
      spot, band: s.clock.band, weather: s.weather.current, layer: r.layer, baitId, rigStats: this.ctx.rigStats, distM: r.dist,
    });
    const rate = biteRate(weights, { weather: s.weather.current, rigStats: this.ctx.rigStats, drifting: r.drifting, bottomSlip: r.bottomSlip });
    return { rate, meanWait: meanWait(rate), entries: weights.entries.map(e => ({ speciesId: e.speciesId, w: e.w })) };
  }

  hash() { return hashState(this.state); }

  // ── 디버그(디버그 API · 테스트 전용)

  /** 같은 날의 그 시각으로(CLOCK_SKIP{debug}) @param {number} hour */
  debugSetTime(hour) {
    if (typeof hour !== 'number' || !Number.isFinite(hour)) return fail('invalid');
    const s = this.state;
    const t = Math.min(TICKS_PER_DAY - 1, Math.round(clamp(hour, 0, 24) * TICKS_PER_HOUR));
    setClock(this.ctx, s.clock.day, t, 'debug');
    return this._done({ ok: true });
  }

  /** 오늘 날씨(모든 스테이지) · current · 빛 · env → WEATHER_CHANGED @param {string} weatherId */
  debugSetWeather(weatherId) {
    if (!WEATHER_IDS.includes(weatherId)) return fail('invalid');
    const s = this.state;
    const today = {};
    for (const id of STAGE_IDS) today[id] = weatherId;
    s.weather.today = today;
    s.weather.current = currentWeatherOf(s);
    rederiveClock(this.ctx);
    this.ctx.emit(EV.WEATHER_CHANGED, weatherPayload(s));
    return this._done({ ok: true });
  }

  /** 레벨 게이트 무시 · 씬 교체 · spawn 에 걷기 모드(낚시 중이면 정리) @param {string} sceneId */
  debugGotoScene(sceneId) {
    if (!SCENE_IDS.includes(sceneId)) return fail('invalid');
    this._switchScene(sceneId, 'debug');
    return this._done({ ok: true });
  }

  /** 그 자리의 씬으로 옮기고 자리에 선다(게이트 무시) @param {string} spotId */
  debugGotoSpot(spotId) {
    if (!SPOTS_BY_ID[spotId]) return fail('invalid');
    return this._done(this._gotoSpot(spotId));
  }

  /** 그 어종 · 퍼센타일로 바로 입질(낚시 모드가 아니면 먼저 자리에) */
  debugForceBite(speciesId, pct = 0.5) {
    if (!this._ensureFishing()) return this._done(fail('notHere'));
    return this._done(forceBite(this.ctx, speciesId, pct));
  }

  /** 입질 · 챔질을 건너뛰고 fighting(§6.3) */
  debugForceFight(speciesId, pct = 0.5) {
    if (!this._ensureFishing()) return this._done(fail('notHere'));
    return this._done(forceFight(this.ctx, speciesId, pct));
  }

  /** 돈(더하기 · 음수 금지 · MONEY_CHANGED{grant}) · 경험치(addXp{debug}) @param {{money?:number, xp?:number}} [g] */
  debugGrant({ money, xp } = {}) {
    const s = this.state;
    const ctx = this.ctx;
    if (typeof money === 'number' && Number.isFinite(money) && money !== 0) {
      const before = s.profile.money;
      s.profile.money = Math.max(0, Math.round(before + money));
      ctx.emit(EV.MONEY_CHANGED, { money: s.profile.money, delta: s.profile.money - before, reason: 'grant' });
    }
    if (typeof xp === 'number' && Number.isFinite(xp) && xp > 0) addXp(ctx, Math.round(xp), 'debug');
    ctx.refresh();
    return this._done({ ok: true });
  }

  /** 보유 수를 무시하고 끼운다(일회용 세션 전용) — 라인은 그 릴의 용량만큼 감긴다 @param {string} slot @param {string} itemId @param {'float'|'bottom'} [set] */
  debugSetGear(slot, itemId, set = this.state.rig.set) {
    const s = this.state;
    const g = GEAR_BY_ID[itemId];
    if (!g || g.slot !== slot || !SET_IDS.includes(set)) return fail('invalid');
    if ((g.set && g.set !== set) || (slot === 'float' && set !== 'float') || (slot === 'sinker' && set !== 'bottom')) return fail('wrongSet');
    const cfg = s.profile.sets[set];
    if (slot === 'line') {
      cfg.lineId = itemId;
      cfg.lineM = GEAR_BY_ID[cfg.reel].capacityM;
    } else {
      cfg[slot] = itemId;
      if (slot === 'reel') cfg.lineM = Math.min(cfg.lineM, g.capacityM);
    }
    this.ctx.emit(EV.EQUIPPED, { set, slot, itemId });
    this.ctx.refresh();
    return this._done({ ok: true });
  }

  /** result 로(낚시 모드가 아니면 먼저 그 씬의 첫 자리 — 집이면 lake_gravel) */
  debugSkipToResult(speciesId = 'crucian', pct = 0.5) {
    if (!this._ensureFishing()) return this._done(fail('notHere'));
    return this._done(skipToResult(this.ctx, speciesId, pct));
  }

  debugNoBites(on) { this.state.debug.noBites = !!on; return { ok: true }; }

  /**
   * ?fixture 전용: state 의 필드를 제자리에서 덮어쓴다(같은 객체 — rng 도 같은 객체에 값만).
   * ctx.stage/spot/mods/rigStats 를 다시 계산한다(syncRig 는 부르지 않는다 — 고정 상태 값 그대로). 이벤트를 내지 않는다.
   * @param {GameState} stateObj
   */
  debugLoadState(stateObj) {
    const src = structuredClone(stateObj);
    const s = /** @type {any} */ (this.state);
    for (const key of Object.keys(src)) {
      if (key === 'rng') { if (src.rng && Number.isFinite(src.rng.s)) s.rng.s = src.rng.s; } else if (key !== 'events') s[key] = src[key];
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

/** 걷기 모드의 rig 위치 필드 = player.pos(제자리 복사) @param {GameState} s */
function rigAtPlayer(s) {
  const pos = s.player.pos;
  copyPrev(s.rig, 'origin', pos);
  copyPrev(s.rig, 'bobber', pos);
  copyPrev(s.rig, 'prevBobber', pos);
}

/** prev 필드에 cur 값을 제자리 복사(같은 객체를 가리키면 새로 만든다) */
function copyPrev(obj, key, cur) {
  if (!cur) return;
  const prev = obj[key];
  if (prev && prev !== cur) { prev.x = cur.x; prev.z = cur.z; } else obj[key] = { x: cur.x, z: cur.z };
}
