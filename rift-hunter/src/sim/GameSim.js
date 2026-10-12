// OWNER: P2 — 계약 §6.8 · §5.1 · §5.11 · §4.1
// 틱 순서의 주인 · 명령 · 플러시 · 장면 전환. 아무도 GameSim.js 를 import 하지 않는다(app · bot 하네스 · test 만).
// 상태를 바꾸는 길은 step 과 아래 명령 메서드뿐이다(app · ui · 봇은 상태를 직접 고치지 않는다 — unloadCharacter · returnToRift …).
// 모든 공개 명령은 끝에서 플러시한다(재진입 안전 — 리스너가 플러시 도중에 부른 명령의 이벤트는 큐 뒤에 쌓였다가 같은 플러시에서 나간다 §4.1).

import { CHAR_SLOTS, CLASS_IDS, DT, HINT_IDS, LEVEL_CAP } from '../core/constants.js';
import { EV } from '../core/events.js';
import { hash32 } from '../core/hash.js';
import { yawOf } from '../core/math.js';
import { shiftTicks, ticks } from '../core/time.js';
import { DEATH, SESSION } from '../data/combat.js';
import { CLASSES_BY_ID } from '../data/index.js';
import { RIFT } from '../data/rift.js';
import { TOWN } from '../data/town.js';
import { tickBurns } from './combat.js';
import { createCtx } from './ctx.js';
import { spawnDrops, updatePickups } from './drops.js';
import { updateEffects } from './effects.js';
import { getMonster, rebuildSpace, removeMarked } from './entities.js';
import { compareEquip } from './loot/compare.js';
import { rollGear } from './loot/rollDrops.js';
import { updateMeter } from './meter.js';
import { spawnMonster, updateMonsters } from './monsters/monsters.js';
import { populateRift, spawnPack } from './monsters/packs.js';
import { placePlayer, resetPlayerForScene, updatePlayer } from './player/controller.js';
import { createCharacter, summaryOf } from './progression/character.js';
import * as inv from './progression/inventory.js';
import * as prog from './progression/progress.js';
import * as shops from './progression/shops.js';
import { updateProjectiles } from './projectiles.js';
import { closePortals, closeRift, finishRift, markExplored, requestReturnToRift, requestTravel, resolveDeaths, settleOnRespawn, spawnGuardianNow, updateRift } from './rift.js';
import { createGameState, createMeter, createPlayerState, createRiftState, createTownState, emptyArray } from './state.js';
import { updateStatus } from './status.js';
import { emitHint, syncTown, updateTown } from './town.js';
import { createFlow, updateFlow } from './world/flow.js';
import { generateRift } from './world/mapgen.js';
import { isWalkable, nearestWalkable } from './world/nav.js';
import { buildTownMap } from './world/townMap.js';

/** @typedef {import('../types.js').GameState} GameState */
/** @typedef {import('../types.js').MapData} MapData */
/** @typedef {import('../types.js').InputFrame} InputFrame */
/** @typedef {import('../types.js').Result} Result */
/** @typedef {import('../types.js').ItemRef} ItemRef */
/** @typedef {import('../types.js').Travel} Travel */

/** @param {string} reason @returns {{ok:false, reason:string}} */
const fail = (reason) => ({ ok: false, reason });
/** 디버그 명령이 몬스터 · 아이템을 놓는 거리(플레이어 앞 m — §11.8 「플레이어 앞 6m」) */
const DEBUG_PACK_DIST = 6;
const DEBUG_DROP_DIST = 2;

export class GameSim {
  /** @param {{bus:import('../core/events.js').EventBus, seed:number, account?:import('../types.js').AccountState|null, devSession?:boolean}} opts */
  constructor({ bus, seed, account = null, devSession = false }) {
    this.bus = bus;
    /** @type {GameState} */
    this.state = createGameState({ seed, account, devSession });
    /** @type {MapData} */
    this.townMap = buildTownMap();
    this.ctx = createCtx(this.state, { map: this.townMap });
    this._flushing = false;
    placePlayer(this.ctx, TOWN.arrive.x, TOWN.arrive.z, TOWN.arrive.facing);
  }

  /** 큐의 sim 이벤트를 순서대로 발행한다 — 재진입 안전(안쪽 호출은 큐에 쌓기만 한다 §4.1) */
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

  /** @template T @param {T} result @returns {T} */
  _done(result) {
    this._flush();
    return result;
  }

  /** MAP_LOADED(town) · SCENE_CHANGED{to:'town', reason:'load'} · PLAYER_SPAWNED — 플러시 */
  start() {
    const st = this.state;
    const map = this.ctx.map;
    if (map) this.ctx.emit(EV.MAP_LOADED, { mapId: map.id, kind: map.kind, tileset: map.tileset });
    this.ctx.emit(EV.SCENE_CHANGED, { from: null, to: st.scene, reason: 'load' });
    const p = st.player;
    this.ctx.emit(EV.PLAYER_SPAWNED, { x: p.pos.x, z: p.pos.z, facing: p.facing, reason: 'scene' });
    this._flush();
  }

  /**
   * 한 틱(§5.1 — 이 순서 그대로). pendingTravel 이 있거나 캐릭터가 없으면 tick 만 민다.
   * @param {InputFrame} input
   */
  step(input) {
    const st = this.state;
    const ctx = this.ctx;
    st.tick += 1;
    // 0
    if (st.pendingTravel || st.char === null) {
      this._flush();
      return;
    }
    // 1 — 플레이 시간 · 보간용 직전 값(값만 복사)
    st.char.playSec += DT;
    const p = st.player;
    if (p.prevPos === p.pos) p.prevPos = { x: p.pos.x, z: p.pos.z };
    p.prevPos.x = p.pos.x;
    p.prevPos.z = p.pos.z;
    const rift = st.rift;
    const inRift = st.scene === 'rift' && rift !== null;
    if (inRift) {
      const mons = rift.mons;
      for (let i = 0; i < mons.length; i++) {
        const m = mons[i];
        if (m.prevPos === m.pos) m.prevPos = { x: m.pos.x, z: m.pos.z };
        m.prevPos.x = m.pos.x;
        m.prevPos.z = m.pos.z;
      }
      const projs = rift.projs;
      for (let i = 0; i < projs.length; i++) {
        const pr = projs[i];
        if (pr.prevPos === pr.pos) pr.prevPos = { x: pr.pos.x, z: pr.pos.z };
        pr.prevPos.x = pr.pos.x;
        pr.prevPos.z = pr.pos.z;
      }
    }
    if (!inRift) {
      // 2 — 마을(이동 · 상호작용 · 포션 · 스킬은 SKILL_FAIL town — P1)
      updatePlayer(ctx, input);
      if (st.scene === 'town') updateTown(ctx);
      this._flush();
      return;
    }
    // 3 — 균열 준비
    rift.ticksIn += 1;
    rebuildSpace(ctx);
    if (ctx.flow && ctx.map) updateFlow(ctx.flow, ctx.map, p.pos, st.tick);
    // 4 — 플레이어
    updatePlayer(ctx, input);
    // 5 — 몬스터
    updateMonsters(ctx);
    // 6 — 세계
    updateProjectiles(ctx);
    updateEffects(ctx);
    tickBurns(ctx);
    updateStatus(ctx);
    // 7 — 정리 · 진행
    resolveDeaths(ctx);
    updatePickups(ctx);
    updateRift(ctx);
    updateMeter(ctx);
    removeMarked(ctx);
    // 8
    this._flush();
  }

  // ───────────────────────── 장면 전환(§5.11) ─────────────────────────

  /** 장면 전환 실행 — pendingTravel 을 처리한다. 공통: MAP_LOADED(맵이 바뀌면) → SCENE_CHANGED → PLAYER_SPAWNED → SAVE_REQUEST{char, scene} @returns {Result} */
  commitTravel() {
    const st = this.state;
    const t = st.pendingTravel;
    if (!t) return this._done(fail('nothing'));
    if (!st.char) {
      st.pendingTravel = null;
      return this._done(fail('invalid'));
    }
    const from = st.scene;
    const prevMap = this.ctx.map;
    /** @type {'scene'|'respawn'|'portal'|'debug'} */
    let spawnReason = 'scene';
    if (t.to === 'rift') {
      if (t.reason === 'townPortal') {
        if (!st.rift || st.rift.phase === 'collapsed') {
          st.pendingTravel = null;
          return this._done(fail(st.rift ? 'collapsed' : 'noRift'));
        }
        this._enterExistingRift();
        spawnReason = 'portal';
      } else {
        this._enterNewRift(t);
        if (t.reason === 'debug') spawnReason = 'debug';
      }
    } else {
      spawnReason = this._enterTown(t);
    }
    st.pendingTravel = null;
    const ctx = this.ctx;
    const map = ctx.map;
    if (map && map !== prevMap) ctx.emit(EV.MAP_LOADED, { mapId: map.id, kind: map.kind, tileset: map.tileset });
    ctx.emit(EV.SCENE_CHANGED, { from, to: st.scene, reason: t.reason });
    const p = st.player;
    ctx.emit(EV.PLAYER_SPAWNED, { x: p.pos.x, z: p.pos.z, facing: p.facing, reason: spawnReason });
    ctx.emit(EV.SAVE_REQUEST, { scope: 'char', reason: 'scene' });
    return this._done({ ok: true });
  }

  /**
   * 새 균열(openRift · debug): 열린 균열은 닫는다(활동 중이면 abandon · RIFT_CLOSED{newRift}) → seed → generateRift → createRiftState → populateRift →
   * flow → runs + 1 · lastRiftLevel → refreshStats → resetPlayerForScene(full) → placePlayer(spawn) · protectUntil → RIFT_OPENED → HINT controls
   * @param {Travel} t
   */
  _enterNewRift(t) {
    const st = this.state;
    const ctx = this.ctx;
    const ch = /** @type {import('../types.js').CharacterState} */ (st.char);
    const level = Math.max(1, Math.min(RIFT.maxLevel, Math.floor(Number(t.level) || 1)));
    if (st.rift) closeRift(ctx, t.reason === 'debug' ? 'debug' : 'newRift');
    const seed = (t.seed ?? hash32(st.seed, ch.runs + 1)) >>> 0;
    const map = generateRift(seed, level);
    st.rift = createRiftState({ level, seed, tileset: map.tileset, mapId: map.id, map, tick: st.tick });
    st.meter = createMeter();
    st.scene = 'rift';
    ctx.map = map;
    ctx.riftMap = map;
    ctx.flow = createFlow(map);
    ctx.monVer += 1;
    populateRift(ctx);
    ch.runs += 1;
    ch.lastRiftLevel = level;
    ctx.refreshStats();
    this._revive();
    resetPlayerForScene(ctx, { full: true });
    placePlayer(ctx, map.spawn.x, map.spawn.z, map.spawn.facing);
    st.player.protectUntil = st.tick + ticks(DEATH.protectSec);
    markExplored(ctx);
    syncTown(st);
    st.town.returnPrompt = false;
    ctx.emit(EV.RIFT_OPENED, { level, seed, tileset: map.tileset, lives: st.rift.lives });
    emitHint(ctx, 'controls');
  }

  /**
   * 마을 포털 복귀: 맵은 캐시(없거나 다르면 같은 seed · level 로 다시) · flow · 시각 밀기(delta = tick − leftAt → shiftTicks(rift) · killTicks) ·
   * placePlayer(returnPos ?? checkpoint — 생명 · 자원 유지) · protectUntil · 귀환 포털 닫음 · returnPrompt = false
   */
  _enterExistingRift() {
    const st = this.state;
    const ctx = this.ctx;
    const rift = /** @type {import('../types.js').RiftState} */ (st.rift);
    let map = ctx.riftMap;
    if (!map || map.id !== rift.mapId) map = generateRift(rift.seed, rift.level);
    ctx.map = map;
    ctx.riftMap = map;
    ctx.flow = createFlow(map);
    ctx.monVer += 1;
    const delta = rift.leftAt >= 0 ? st.tick - rift.leftAt : 0;
    if (delta > 0) {
      shiftTicks(rift, delta);
      const kt = st.meter.killTicks;
      for (let i = 0; i < kt.length; i++) kt[i] += delta;
    }
    rift.leftAt = -1;
    st.scene = 'rift';
    const target = rift.returnPos ?? rift.checkpoint;
    const pos = this._walkable(map, target.x, target.z);
    const p = st.player;
    placePlayer(ctx, pos.x, pos.z, p.facing);
    p.protectUntil = st.tick + ticks(DEATH.protectSec);
    rift.returnPos = null;
    closePortals(ctx, 'recall');
    st.town.returnPrompt = false;
    syncTown(st);
    markExplored(ctx);
  }

  /**
   * 마을로: 마을 맵(캐시) · flow null · 부활이면 refreshStats → resetPlayerForScene(full) → placePlayer(TOWN.respawn) · killedBy null ·
   * 붕괴였으면 균열을 닫는다(RIFT_CLOSED{collapse}) 아니면 returnPrompt. 그 밖(recall · riftPortal · exit · debug)은 placePlayer(TOWN.arrive)만
   * (생명 · 자원 유지 — debug 로 쓰러진 채 오면 되살린다) · restockShops(P6) · HINT town(균열에서 처음 돌아왔을 때)
   * @param {Travel} t @returns {'scene'|'respawn'|'debug'}
   */
  _enterTown(t) {
    const st = this.state;
    const ctx = this.ctx;
    const p = st.player;
    const fromRift = st.scene === 'rift';
    // W1 수정(NOTES-W1FIX · §5.10): 부활로 떠날 때 남은 진정 · 잠든 몬스터를 처음 자리로(전환 막 아래)
    if (t.reason === 'respawn' && st.rift) settleOnRespawn(ctx);
    // 밸런스 게이트(NOTES-BALANCE): 수호자 처치 뒤 완료 마무리(completeAt · RIFT.completeDelay) 전에 떠나면(처치 직후 끝난 귀환 시전) 여기서 마무리한다 —
    //   전에는 마을에서 새 균열을 열면 그 판의 요약 · 해금 · 완료 경험치 · 기록이 조용히 사라졌다(봇 실측). 맵은 아직 균열 맵이다(나가는 포털 자리).
    if (fromRift && st.rift && st.rift.phase === 'complete' && !st.rift.summary) finishRift(ctx);
    st.scene = 'town';
    ctx.map = this.townMap;
    ctx.flow = null;
    /** @type {'scene'|'respawn'|'debug'} */
    let reason = 'scene';
    if (t.reason === 'respawn' || p.dead) {
      ctx.refreshStats();
      this._revive();
      resetPlayerForScene(ctx, { full: true });
      const at = t.reason === 'respawn' ? TOWN.respawn : TOWN.arrive;
      placePlayer(ctx, at.x, at.z, at.facing);
      p.killedBy = null;
      if (st.rift && st.rift.phase === 'collapsed') closeRift(ctx, 'collapse');
      else if (st.rift && t.reason === 'respawn') st.town.returnPrompt = true;
      reason = t.reason === 'respawn' ? 'respawn' : t.reason === 'debug' ? 'debug' : 'scene';
    } else {
      placePlayer(ctx, TOWN.arrive.x, TOWN.arrive.z, TOWN.arrive.facing);
      if (t.reason === 'debug') reason = 'debug';
    }
    shops.restockShops(ctx);
    syncTown(st);
    if (fromRift) emitHint(ctx, 'town');
    return reason;
  }

  /** 쓰러진 플레이어를 일으킨다(resetPlayerForScene 앞 — 부활 · 새 균열 · 디버그) */
  _revive() {
    const p = this.state.player;
    if (!p.dead) return;
    p.dead = false;
    p.deadAt = -1;
    p.act = 'idle';
  }

  /** 걷기 가능한 점(아니면 가장 가까운 걷기 가능 점 · 그것도 없으면 그대로) @param {MapData} map @param {number} x @param {number} z */
  _walkable(map, x, z) {
    if (!map || isWalkable(map, x, z)) return { x, z };
    const q = nearestWalkable(map, x, z) ?? nearestWalkable(map, map.spawn.x, map.spawn.z);
    return q ? { x: q.x, z: q.z } : { x: map.spawn.x, z: map.spawn.z };
  }

  /** → ctx.map */
  getMap() { return this.ctx.map; }
  /** → ctx.stats */
  getStats() { return this.ctx.stats; }

  // ───────────────────────── 캐릭터 ─────────────────────────

  /**
   * 지금 캐릭터를 떼어 낸다(빈 마을 배경으로) — 열린 균열이 active · guardian 이면 recordRun(abandon) → RIFT_CLOSED{reason} → rift = null → char = null →
   * player = createPlayerState() → scene 'town'(맵이 바뀌면 MAP_LOADED · SCENE_CHANGED{exit}) · PLAYER_SPAWNED
   * @param {'quit'|'newRift'|'debug'|'collapse'} reason
   */
  _detach(reason) {
    const st = this.state;
    const ctx = this.ctx;
    if (st.rift) closeRift(ctx, reason);
    st.char = null;
    st.player = createPlayerState();
    st.town = createTownState();
    st.meter = createMeter();
    st.pendingTravel = null;
    this._toTown('exit');
    ctx.refreshStats();
  }

  /** 마을 맵으로(장면이 바뀌면 MAP_LOADED · SCENE_CHANGED) · TOWN.arrive · PLAYER_SPAWNED @param {string} reason */
  _toTown(reason) {
    const st = this.state;
    const ctx = this.ctx;
    const from = st.scene;
    const changed = ctx.map !== this.townMap;
    st.scene = 'town';
    ctx.map = this.townMap;
    ctx.flow = null;
    if (!st.rift) ctx.riftMap = null;
    placePlayer(ctx, TOWN.arrive.x, TOWN.arrive.z, TOWN.arrive.facing);
    if (changed) ctx.emit(EV.MAP_LOADED, { mapId: this.townMap.id, kind: this.townMap.kind, tileset: this.townMap.tileset });
    if (changed || from !== 'town') ctx.emit(EV.SCENE_CHANGED, { from, to: 'town', reason });
    const p = st.player;
    ctx.emit(EV.PLAYER_SPAWNED, { x: p.pos.x, z: p.pos.z, facing: p.facing, reason: 'scene' });
    syncTown(st);
  }

  /**
   * 붙이기 순서: (다른 캐릭터가 있으면 떼고) char 붙이기 → refreshStats → resetPlayerForScene({full:true}) → restockShops → placePlayer(TOWN.arrive) → CHAR_LOADED
   * (생명 1 · 빈 상점으로 시작하지 않게 — 첫 마을의 대장장이 · 잡화상에 재고가 있다)
   * @param {number} slot @param {import('../types.js').CharacterState} char @param {boolean} isNew
   */
  _attach(slot, char, isNew) {
    const st = this.state;
    const ctx = this.ctx;
    if (st.char) this._detach('quit');
    else if (st.scene !== 'town' || st.rift) {
      if (st.rift) closeRift(ctx, 'quit');
      this._toTown('load');
    }
    st.pendingTravel = null;
    st.char = char;
    st.player = createPlayerState();
    st.player.r = CLASSES_BY_ID[char.cls]?.radius ?? st.player.r;
    st.town = createTownState();
    st.meter = createMeter();
    st.account.chars[slot] = summaryOf(char);
    st.account.lastSlot = slot;
    ctx.refreshStats();
    resetPlayerForScene(ctx, { full: true });
    shops.restockShops(ctx);
    placePlayer(ctx, TOWN.arrive.x, TOWN.arrive.z, TOWN.arrive.facing);
    ctx.emit(EV.CHAR_LOADED, { slot, cls: char.cls, name: char.name, level: char.level, isNew });
    const p = st.player;
    ctx.emit(EV.PLAYER_SPAWNED, { x: p.pos.x, z: p.pos.z, facing: p.facing, reason: 'scene' });
  }

  /**
   * 새 캐릭터 — createCharacter(seed = hash32(state.seed, slot)) · account.chars[slot] · 붙이기 순서 · HINT town · SAVE_REQUEST{all, new}
   * (덮어쓰기 확인 · 백업은 app 이 한다)
   * @param {{slot:number, cls:import('../types.js').ClassId, name:string}} opts
   */
  newCharacter({ slot, cls, name } = /** @type {any} */ ({})) {
    if (!(Number.isInteger(slot) && slot >= 0 && slot < CHAR_SLOTS)) return this._done(fail('slot'));
    if (!CLASS_IDS.includes(cls)) return this._done(fail('class'));
    if (typeof name !== 'string' || !name.trim()) return this._done(fail('name'));
    const char = createCharacter({ slot, cls, name: name.trim(), newId: this.ctx.newItemId, seed: hash32(this.state.seed, slot) });
    this._attach(slot, char, true);
    emitHint(this.ctx, 'town');
    this.ctx.emit(EV.SAVE_REQUEST, { scope: 'all', reason: 'new' });
    return this._done({ ok: true, char });
  }

  /** 정화된 CharacterState 를 받아 붙인다(같은 붙이기 순서) @param {number} slot @param {import('../types.js').CharacterState} char @returns {Result} */
  loadCharacter(slot, char) {
    if (!(Number.isInteger(slot) && slot >= 0 && slot < CHAR_SLOTS)) return this._done(fail('slot'));
    if (!char || typeof char !== 'object' || !CLASS_IDS.includes(char.cls)) return this._done(fail('invalid'));
    char.slot = slot;
    this._attach(slot, char, false);
    return this._done({ ok: true });
  }

  /** account.chars[slot] = null(지금 캐릭터면 떼어 낸다) · SAVE_REQUEST{account, delete} @param {number} slot @returns {Result} */
  deleteCharacter(slot) {
    const st = this.state;
    if (!(Number.isInteger(slot) && slot >= 0 && slot < CHAR_SLOTS)) return this._done(fail('slot'));
    if (st.char && st.char.slot === slot) this._detach('quit');
    st.account.chars[slot] = null;
    if (st.account.lastSlot === slot) st.account.lastSlot = -1;
    this.ctx.emit(EV.SAVE_REQUEST, { scope: 'account', reason: 'delete' });
    return this._done({ ok: true });
  }

  /**
   * 타이틀로 — 열린 균열이 active · guardian 이면 recordRun(abandon) → RIFT_CLOSED{quit} → rift = null → char = null → player = createPlayerState() →
   * scene 'town' → SAVE_REQUEST{all, quit}. (기록은 떼기 전에 캐릭터에 들어간다 — app 은 부르기 전에 잡아 둔 캐릭터 참조로 저장한다)
   * @returns {Result}
   */
  unloadCharacter() {
    if (!this.state.char) return this._done(fail('invalid'));
    this._detach('quit');
    this.ctx.emit(EV.SAVE_REQUEST, { scope: 'all', reason: 'quit' });
    return this._done({ ok: true });
  }

  // ───────────────────────── 가방 · 장비 · 스킬 ─────────────────────────

  /** 캐릭터가 있어야 하는 명령 @param {() => any} fn */
  _withChar(fn) {
    if (!this.state.char) return this._done(fail('invalid'));
    return this._done(fn());
  }
  /** 마을에서만(상점 · 신비술사) @param {() => any} fn */
  _inTown(fn) {
    const st = this.state;
    if (!st.char) return this._done(fail('invalid'));
    if (st.scene !== 'town') return this._done(fail('notInTown'));
    if (st.pendingTravel) return this._done(fail('busy'));
    return this._done(fn());
  }

  /** @param {ItemRef} ref @param {import('../types.js').EquipSlot|null} [toSlot] */ equip(ref, toSlot = null) { return this._withChar(() => inv.equip(this.ctx, ref, toSlot)); }
  /** @param {import('../types.js').EquipSlot} slot */ unequip(slot) { return this._withChar(() => inv.unequip(this.ctx, slot)); }
  /** @param {ItemRef} from @param {ItemRef} to */ moveItem(from, to) { return this._withChar(() => inv.moveItem(this.ctx, from, to)); }
  sortBag() { return this._withChar(() => inv.sortBag(this.ctx)); }
  sortStash() { return this._withChar(() => inv.sortStash(this.ctx)); }
  /** @param {ItemRef} ref @param {boolean} on */ setItemLocked(ref, on) { return this._withChar(() => inv.setItemLocked(this.ctx, ref, on)); }
  /** @param {string} nodeId */ learnSkill(nodeId) { return this._withChar(() => prog.learnSkill(this.ctx, nodeId)); }
  /** @param {number} idx @param {string|null} nodeId */ setSkillBar(idx, nodeId) { return this._withChar(() => prog.setSkillBar(this.ctx, idx, nodeId)); }
  /** 신비술사 스킬 초기화(골드) */ resetSkills() { return this._inTown(() => shops.resetSkills(this.ctx)); }

  // ───────────────────────── 상점(마을에서만) ─────────────────────────

  /** @param {'blacksmith'|'general'} shop @param {number} idx */ buy(shop, idx) { return this._inTown(() => shops.buy(this.ctx, shop, idx)); }
  /** @param {ItemRef} ref */ sell(ref) { return this._inTown(() => shops.sell(this.ctx, ref)); }
  /** @param {ItemRef[]} refs */ sellMany(refs) { return this._inTown(() => shops.sellMany(this.ctx, refs)); }
  /** @param {number} idx */ buyback(idx) { return this._inTown(() => shops.buyback(this.ctx, idx)); }
  repairAll() { return this._inTown(() => shops.repairAll(this.ctx)); }
  /** @param {ItemRef} ref */ salvage(ref) { return this._inTown(() => shops.salvage(this.ctx, ref)); }
  /** @param {ItemRef[]} refs */ salvageMany(refs) { return this._inTown(() => shops.salvageMany(this.ctx, refs)); }
  /** @param {import('../types.js').ItemSlot} slot */ craft(slot) { return this._inTown(() => shops.craft(this.ctx, slot)); }
  /** @param {import('../types.js').ItemSlot} slot */ gamble(slot) { return this._inTown(() => shops.gamble(this.ctx, slot)); }
  /** @param {ItemRef} ref @param {number} affixIdx */ rerollOffer(ref, affixIdx) { return this._inTown(() => shops.rerollOffer(this.ctx, ref, affixIdx)); }
  /** @param {number} choice */ rerollChoose(choice) { return this._inTown(() => shops.rerollChoose(this.ctx, choice)); }
  rerollCancel() { return this._inTown(() => shops.rerollCancel(this.ctx)); }
  /** @param {number} n */ buyPotions(n) { return this._inTown(() => shops.buyPotions(this.ctx, n)); }
  /** @param {number} n */ buyScrolls(n) { return this._inTown(() => shops.buyScrolls(this.ctx, n)); }
  /** @param {'potion'|'scroll'} what */ takeFree(what) { return this._inTown(() => shops.takeFree(this.ctx, what)); }

  // ───────────────────────── 균열 ─────────────────────────

  /** 마을 · 1 ≤ level ≤ riftUnlocked · requestTravel{openRift} @param {number} level @param {number|null} [seed] @returns {Result} */
  openRift(level, seed = null) {
    const st = this.state;
    const ch = st.char;
    if (!ch) return this._done(fail('invalid'));
    if (st.scene !== 'town') return this._done(fail('notInTown'));
    if (st.pendingTravel) return this._done(fail('busy'));
    if (st.player.dead) return this._done(fail('dead'));
    const L = Math.floor(Number(level));
    if (!Number.isFinite(L) || L < 1) return this._done(fail('invalid'));
    if (L > ch.riftUnlocked) return this._done(fail('locked'));
    /** @type {Travel} */
    const travel = { to: 'rift', reason: 'openRift', level: L };
    if (seed !== null && seed !== undefined && Number.isFinite(Number(seed))) travel.seed = Number(seed) >>> 0;
    return this._done(requestTravel(this.ctx, travel));
  }

  /** 열린 균열 · 붕괴 아님 · 마을에서 → requestReturnToRift @returns {Result} */
  returnToRift() { return this._done(requestReturnToRift(this.ctx)); }

  /** 완료 단계에서만(나가는 포털과 같다) · rift.returnPos = player.pos(남은 전리품을 주우러 그 자리로 돌아온다) @returns {Result} */
  leaveRift() {
    const st = this.state;
    if (!st.char) return this._done(fail('invalid'));
    if (st.scene !== 'rift' || !st.rift) return this._done(fail('notInRift'));
    if (st.rift.phase !== 'complete') return this._done(fail('invalid'));
    if (st.player.dead) return this._done(fail('dead'));
    if (st.pendingTravel) return this._done(fail('busy'));
    st.rift.returnPos = { x: st.player.pos.x, z: st.player.pos.z };
    return this._done(requestTravel(this.ctx, { to: 'town', reason: 'exit' }));
  }

  /** 사망 중일 때만 → requestTravel{to:'town', reason:'respawn'} @returns {Result} */
  respawn() {
    const st = this.state;
    if (!st.char) return this._done(fail('invalid'));
    if (!st.player.dead) return this._done(fail('notDead'));
    return this._done(requestTravel(this.ctx, { to: 'town', reason: 'respawn' }));
  }

  /** 본 안내 카드 — char.hints[id] = true · SAVE_REQUEST{char, hint} @param {import('../types.js').HintId} id @returns {Result} */
  markHint(id) {
    const ch = this.state.char;
    if (!ch) return this._done(fail('invalid'));
    if (!HINT_IDS.includes(id)) return this._done(fail('invalid'));
    if (!ch.hints) ch.hints = {};
    ch.hints[id] = true;
    this.ctx.emit(EV.SAVE_REQUEST, { scope: 'char', reason: 'hint' });
    return this._done({ ok: true });
  }

  /** 마을 패널 시간(0 ≤ sec ≤ SESSION.maxPlaySecAdd) → char.playSec @param {number} sec @returns {Result} */
  addPlaySec(sec) {
    const ch = this.state.char;
    if (!ch) return this._done(fail('invalid'));
    const s = Number(sec);
    if (!Number.isFinite(s) || s <= 0) return this._done({ ok: true });
    ch.playSec += Math.min(SESSION.maxPlaySecAdd, s);
    return this._done({ ok: true });
  }

  // ───────────────────────── 조회(상태를 바꾸지 않는다) ─────────────────────────

  /** compareEquip 결과(§6.10) · 아이템이 없으면 null @param {ItemRef} ref */
  previewEquip(ref) {
    const item = inv.itemAt(this.state, ref);
    if (!item || !this.state.char) return null;
    return compareEquip(this.state.char, item);
  }
  /** → RiftPreview @param {number} level */
  previewRift(level) { return prog.previewRift(this.state.char, level); }
  /**
   * → 정수 | null — kind 'sell'(priceSell) · 'buy'(priceBuy) · 'buyback'(판 값 그대로) · 'reroll'(골드)
   * @param {ItemRef} ref @param {'sell'|'buy'|'buyback'|'reroll'} kind
   */
  priceOf(ref, kind) {
    const st = this.state;
    const ch = st.char;
    if (!ch || !ref) return null;
    if (kind === 'buyback') {
      const e = ref.where === 'buyback' ? ch.buyback[ref.idx ?? -1] : null;
      return e && Number.isFinite(e.price) ? Math.round(e.price) : null;
    }
    const item = inv.itemAt(st, ref);
    if (!item) return null;
    let v = null;
    if (kind === 'sell') v = shops.priceSell(item);
    else if (kind === 'buy') v = shops.priceBuy(item);
    else if (kind === 'reroll') v = shops.priceReroll(item)?.gold;
    return Number.isFinite(v) ? Math.round(/** @type {number} */ (v)) : null;
  }

  // ───────────────────────── 디버그(§11.8) ─────────────────────────

  /** 요청을 세우고 바로 commit(막 없이) — 대기 중인 전환은 버린다 @param {Travel} travel @returns {Result} */
  _travelNow(travel) {
    const st = this.state;
    if (!st.char) return this._done(fail('invalid'));
    st.pendingTravel = null;
    const r = requestTravel(this.ctx, travel);
    if (!r.ok) return this._done(r);
    return this.commitTravel();
  }

  /** 마을로 바로(쓰러져 있으면 되살린다) */
  debugGotoTown() { return this._travelNow({ to: 'town', reason: 'debug' }); }
  /** 균열 level(해금과 무관)을 바로 연다 @param {number} level @param {number} [seed] */
  debugOpenRift(level, seed) {
    /** @type {Travel} */
    const travel = { to: 'rift', reason: 'debug', level: Math.max(1, Math.floor(Number(level) || 1)) };
    if (seed !== null && seed !== undefined && Number.isFinite(Number(seed))) travel.seed = Number(seed) >>> 0;
    return this._travelNow(travel);
  }

  /** 지금 균열을 바로 완료 — 수호자가 없으면 세우고 쓰러뜨린다(보장 드랍) → 완료 마무리(요약 · completeRun · 나가는 포털) */
  debugCompleteRift() {
    const st = this.state;
    const ctx = this.ctx;
    const rift = st.rift;
    if (!st.char || !rift || st.scene !== 'rift') return this._done(fail('notInRift'));
    if (rift.phase === 'collapsed') return this._done(fail('collapsed'));
    if (rift.phase !== 'complete') {
      rift.gauge = 100;
      rift.phase = 'guardian';
      let g = rift.guardianId !== null ? getMonster(ctx, rift.guardianId) : null;
      if (!g || g.dead || g.gone) {
        const p = st.player.pos;
        const spot = this._walkable(ctx.map, p.x + Math.sin(st.player.facing) * DEBUG_DROP_DIST, p.z + Math.cos(st.player.facing) * DEBUG_DROP_DIST);
        g = spawnGuardianNow(ctx, spot.x, spot.z);
      }
      if (g) {
        g.hp = 0;
        g.lastHit = { by: 'player', skillId: null, noProcs: true, frozen: false };
      }
      resolveDeaths(ctx);
    }
    if (rift.phase === 'complete' && !rift.summary) finishRift(ctx);
    return this._done({ ok: true });
  }

  /**
   * 팩 하나(플레이어 앞 6m · at 이 있으면 그 자리) — spawnPack(P3) · 그 결과가 없으면 그 종류 하나를 직접(팩 하나 · 깨어 있게)
   * @param {string} typeId @param {import('../types.js').MonRank} [rank] @param {string[]|null} [affixIds] @param {{x:number, z:number}|null} [at]
   */
  debugSpawnPack(typeId, rank = 'normal', affixIds = null, at = null) {
    const st = this.state;
    const ctx = this.ctx;
    const rift = st.rift;
    if (!st.char || !rift || st.scene !== 'rift' || !ctx.map) return this._done(fail('notInRift'));
    const p = st.player;
    const want = at ?? { x: p.pos.x + Math.sin(p.facing) * DEBUG_PACK_DIST, z: p.pos.z + Math.cos(p.facing) * DEBUG_PACK_DIST };
    const pos = this._walkable(ctx.map, want.x, want.z);
    let packId = spawnPack(ctx, { typeId, rank, affixes: affixIds, x: pos.x, z: pos.z, awake: true });
    if (!(packId >= 0)) {
      const pack = { id: ctx.nextId(), kind: /** @type {any} */ (rank === 'champion' || rank === 'elite' ? rank : 'normal'), memberIds: /** @type {number[]} */ ([]), awake: true, nextHazardAt: -1, fled: false, anchor: { ...pos } };
      rift.packs.push(pack);
      const m = spawnMonster(ctx, { typeId, rank, level: rift.level, affixes: affixIds ?? [], packId: pack.id, x: pos.x, z: pos.z, facing: yawOf(p.pos.x - pos.x, p.pos.z - pos.z), awake: true, reason: 'debug' });
      pack.memberIds.push(m.id);
      packId = pack.id;
    }
    return this._done({ ok: true, packId });
  }

  /** 살아 있는 몬스터를 모두 쓰러뜨린다(처치 · 경험치 · 드랍 · 게이지 그대로 · 전설 처치 훅 없음) */
  debugKillAll() {
    const st = this.state;
    const rift = st.rift;
    if (!st.char || !rift || st.scene !== 'rift') return this._done(fail('notInRift'));
    // W2 통합: 사망 훅이 새로 세운 몬스터(분열 사본 · §8.2)까지 쓰러지게 살아 있는 것이 없을 때까지 되풀이한다(사본은 다시 분열하지 않는다 — 상한은 안전망)
    for (let pass = 0; pass < 4; pass++) {
      let any = false;
      for (const m of rift.mons) {
        if (m.gone || m.dead || m.hp <= 0) continue;
        m.hp = 0;
        m.lastHit = { by: 'player', skillId: null, noProcs: true, frozen: false };
        any = true;
      }
      if (!any) break;
      resolveDeaths(this.ctx);
    }
    return this._done({ ok: true });
  }

  /**
   * 골드 · 경험치 · 재료 · 아이템 주기 — items = 등급 이름 배열 또는 Item(새 ID 로) → 가방(rollGear · ilvl = 해금 최고 균열)
   * @param {{gold?:number, xp?:number, materials?:Partial<Record<import('../types.js').MaterialId, number>>, items?:Array<string|import('../types.js').Item>}} [g]
   */
  debugGrant({ gold = 0, xp = 0, materials = null, items = null } = {}) {
    const st = this.state;
    const ctx = this.ctx;
    const ch = st.char;
    if (!ch) return this._done(fail('invalid'));
    if (gold > 0) inv.addGold(ctx, gold, 'grant');
    if (xp > 0) prog.grantXp(ctx, Math.round(xp), 'debug');
    if (materials) inv.addMaterials(ctx, materials, 'grant');
    let added = 0, failed = 0;
    for (const it of items ?? []) {
      const item = typeof it === 'string'
        ? rollGear(ctx.rng.loot, { rarity: /** @type {any} */ (it), level: Math.max(1, ch.riftUnlocked), cls: ch.cls, newId: ctx.newItemId })
        : it && typeof it === 'object' ? { ...it, id: ctx.newItemId() } : null;
      if (!item) continue;
      if (inv.addToBag(ctx, item, 'grant').ok) added++;
      else failed++;
    }
    return this._done({ ok: true, added, failed });
  }

  /** 아이템 하나를 플레이어 앞 바닥에(마을이면 가방에) @param {{rarity?:import('../types.js').Rarity, slot?:import('../types.js').ItemSlot|null, ilvl?:number}} [o] */
  debugDropItem({ rarity = 'rare', slot = null, ilvl = 0 } = {}) {
    const st = this.state;
    const ctx = this.ctx;
    const ch = st.char;
    if (!ch) return this._done(fail('invalid'));
    const level = ilvl > 0 ? Math.floor(ilvl) : st.rift?.level ?? Math.max(1, ch.riftUnlocked);
    const item = rollGear(ctx.rng.loot, { rarity, level, cls: ch.cls, newId: ctx.newItemId, slot });
    if (st.scene === 'rift' && st.rift) {
      const p = st.player;
      spawnDrops(ctx, [{ kind: 'item', item, amount: 1, mat: null }], p.pos.x + Math.sin(p.facing) * DEBUG_DROP_DIST, p.pos.z + Math.cos(p.facing) * DEBUG_DROP_DIST);
      return this._done({ ok: true, itemId: item.id });
    }
    const r = inv.addToBag(ctx, item, 'grant');
    return this._done(r.ok ? { ok: true, itemId: item.id } : r);
  }

  /** 캐릭터 레벨(1..30) · 경험치 0 · 시트 · 생명 가득 · XP @param {number} n */
  debugSetLevel(n) {
    const st = this.state;
    const ch = st.char;
    if (!ch) return this._done(fail('invalid'));
    ch.level = Math.max(1, Math.min(LEVEL_CAP, Math.floor(Number(n) || 1)));
    ch.xp = 0;
    st.account.chars[ch.slot] = summaryOf(ch);
    this.ctx.refreshStats();
    if (!st.player.dead) st.player.life = st.player.lifeMax;
    const req = prog.xpReq(ch.level);
    this.ctx.emit(EV.XP, { amount: 0, level: ch.level, xp: 0, toNext: Number.isFinite(req) ? req : null });
    this.ctx.emit(EV.SAVE_REQUEST, { scope: 'char', reason: 'debug' });
    return this._done({ ok: true });
  }

  /** 해금 최고 균열 레벨(1..RIFT.maxLevel) · UNLOCK @param {number} n */
  debugSetRiftUnlocked(n) {
    const st = this.state;
    const ch = st.char;
    if (!ch) return this._done(fail('invalid'));
    const from = ch.riftUnlocked;
    ch.riftUnlocked = Math.max(1, Math.min(RIFT.maxLevel, Math.floor(Number(n) || 1)));
    st.account.chars[ch.slot] = summaryOf(ch);
    this.ctx.refreshStats();
    this.ctx.emit(EV.UNLOCK, { riftUnlocked: ch.riftUnlocked, from });
    this.ctx.emit(EV.SAVE_REQUEST, { scope: 'char', reason: 'debug' });
    return this._done({ ok: true });
  }

  /** 무적(피해 무시) @param {boolean} on */
  debugSetInvincible(on) {
    this.state.flags.invincible = !!on;
    return this._done({ ok: true });
  }

  /** 균열 지도 전부 탐색함 */
  debugRevealMap() {
    const rift = this.state.rift;
    if (!rift) return this._done(fail('noRift'));
    rift.explored.fill(1);
    return this._done({ ok: true });
  }

  /** 스킬 초기화(무료 — 브리프 §3.3) */
  debugResetSkills() {
    const ch = this.state.char;
    if (!ch) return this._done(fail('invalid'));
    ch.skills.ranks = {};
    ch.skills.bar = emptyArray(ch.skills.bar?.length || 5);
    this.ctx.refreshStats();
    this.ctx.emit(EV.SKILLS, { reason: 'reset', nodeId: null, rank: 0 });
    this.ctx.emit(EV.SAVE_REQUEST, { scope: 'char', reason: 'debug' });
    return this._done({ ok: true });
  }

  /**
   * 상태 교체 · ctx 다시 만듦(균열이면 ctx.flow = createFlow(map)) · MAP_LOADED · SCENE_CHANGED{reason:'fixture'} · PLAYER_SPAWNED — ?fixture · 최소 부트가 쓴다
   * @param {GameState} state @param {MapData} map 지금 장면의 맵 @param {MapData|null} [riftMap] 열린 균열의 맵
   * @returns {Result}
   */
  debugLoadState(state, map, riftMap = null) {
    const from = this.state.scene;
    this.state = state;
    if (map && map.kind === 'town') this.townMap = map;
    this.ctx = createCtx(state, { map, riftMap });
    const ctx = this.ctx;
    if (map) ctx.emit(EV.MAP_LOADED, { mapId: map.id, kind: map.kind, tileset: map.tileset });
    ctx.emit(EV.SCENE_CHANGED, { from, to: state.scene, reason: 'fixture' });
    const p = state.player;
    ctx.emit(EV.PLAYER_SPAWNED, { x: p.pos.x, z: p.pos.z, facing: p.facing, reason: 'debug' });
    return this._done({ ok: true });
  }
}

