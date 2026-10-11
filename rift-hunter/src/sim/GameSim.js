// OWNER: P2 — 계약 §6.8 · §5.1 · §5.11 · §4.1
// STUB — W1 에서 P2 가 채운다(틱 순서 · 모든 명령 · 장면 전환 · 디버그). W0: step 은 §5.1 의 0 · 1(+ 최소 이동)과 플러시 ·
//   명령은 {ok:false, reason:'stub'} · 완성으로 내는 것: start · debugLoadState · getMap · getStats · loadCharacter · newCharacter(최소 부트에 캐릭터가 있어야 한다)
// 아무도 GameSim.js 를 import 하지 않는다(app · bot 하네스 · test 만).

import { CHAR_SLOTS, DT } from '../core/constants.js';
import { EV } from '../core/events.js';
import { hash32 } from '../core/hash.js';
import { TOWN } from '../data/town.js';
import { createCtx } from './ctx.js';
import { compareEquip } from './loot/compare.js';
import { createCharacter, summaryOf } from './progression/character.js';
import { previewRift } from './progression/progress.js';
import { restockShops } from './progression/shops.js';
import { placePlayer, resetPlayerForScene, updatePlayer } from './player/controller.js';
import { createGameState } from './state.js';
import { itemAt } from './progression/inventory.js';
import { buildTownMap } from './world/townMap.js';

/** @typedef {import('../types.js').GameState} GameState */
/** @typedef {import('../types.js').MapData} MapData */
/** @typedef {import('../types.js').InputFrame} InputFrame */
/** @typedef {import('../types.js').Result} Result */
/** @typedef {import('../types.js').ItemRef} ItemRef */

const stub = () => ({ ok: /** @type {false} */ (false), reason: 'stub' });

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
   * STUB — 한 틱(§5.1). W0: 0(tick · pendingTravel/char 없음이면 끝) · 1(playSec · prevPos) · 최소 이동(updatePlayer 스텁) · 8(플러시)
   * @param {InputFrame} input
   */
  step(input) {
    const st = this.state;
    st.tick += 1;
    if (st.pendingTravel || st.char === null) { this._flush(); return; }
    st.char.playSec += DT;
    const p = st.player;
    p.prevPos = { x: p.pos.x, z: p.pos.z };
    if (st.rift && st.scene === 'rift') {
      for (const m of st.rift.mons) m.prevPos = { x: m.pos.x, z: m.pos.z };
      for (const pr of st.rift.projs) pr.prevPos = { x: pr.pos.x, z: pr.pos.z };
      st.rift.ticksIn += 1;
    }
    updatePlayer(this.ctx, input);
    this._flush();
  }

  /** STUB — 장면 전환 실행(§5.11) @returns {Result} */
  commitTravel() { return this._done(stub()); }

  /** → ctx.map */
  getMap() { return this.ctx.map; }
  /** → ctx.stats */
  getStats() { return this.ctx.stats; }

  /** 붙이기 순서: char 붙이기 → refreshStats → resetPlayerForScene({full:true}) → restockShops → placePlayer(TOWN.arrive) → CHAR_LOADED */
  _attach(slot, char, isNew) {
    const st = this.state;
    st.char = char;
    st.account.chars[slot] = summaryOf(char);
    st.account.lastSlot = slot;
    this.ctx.refreshStats();
    resetPlayerForScene(this.ctx, { full: true });
    restockShops(this.ctx);
    if (st.scene === 'town') placePlayer(this.ctx, TOWN.arrive.x, TOWN.arrive.z, TOWN.arrive.facing);
    this.ctx.emit(EV.CHAR_LOADED, { slot, cls: char.cls, name: char.name, level: char.level, isNew });
  }

  /**
   * 새 캐릭터 — createCharacter(seed = hash32(state.seed, slot)) · account.chars[slot] · 붙이기 순서 · HINT town · SAVE_REQUEST{all}
   * @param {{slot:number, cls:import('../types.js').ClassId, name:string}} opts
   */
  newCharacter({ slot, cls, name }) {
    if (!(slot >= 0 && slot < CHAR_SLOTS)) return this._done({ ok: false, reason: 'slot' });
    if (typeof name !== 'string' || !name.trim()) return this._done({ ok: false, reason: 'name' });
    const char = createCharacter({ slot, cls, name: name.trim(), newId: this.ctx.newItemId, seed: hash32(this.state.seed, slot) });
    this._attach(slot, char, true);
    this.ctx.emit(EV.HINT, { id: 'town' });
    this.ctx.emit(EV.SAVE_REQUEST, { scope: 'all', reason: 'new' });
    return this._done({ ok: true, char });
  }

  /** 정화된 CharacterState 를 받아 붙인다(같은 붙이기 순서) @param {number} slot @param {import('../types.js').CharacterState} char @returns {Result} */
  loadCharacter(slot, char) {
    if (!(slot >= 0 && slot < CHAR_SLOTS) || !char) return this._done({ ok: false, reason: 'slot' });
    this._attach(slot, char, false);
    return this._done({ ok: true });
  }

  /** STUB */ deleteCharacter(slot) { return this._done(stub()); }
  /** STUB */ unloadCharacter() { return this._done(stub()); }

  // 가방 · 장비
  /** STUB @param {ItemRef} ref @param {string|null} [toSlot] */ equip(ref, toSlot = null) { return this._done(stub()); }
  /** STUB */ unequip(slot) { return this._done(stub()); }
  /** STUB */ moveItem(from, to) { return this._done(stub()); }
  /** STUB */ sortBag() { return this._done(stub()); }
  /** STUB */ sortStash() { return this._done(stub()); }
  /** STUB */ setItemLocked(ref, on) { return this._done(stub()); }
  // 스킬
  /** STUB */ learnSkill(nodeId) { return this._done(stub()); }
  /** STUB */ setSkillBar(idx, nodeId) { return this._done(stub()); }
  /** STUB */ resetSkills() { return this._done(stub()); }
  // 상점
  /** STUB */ buy(shop, idx) { return this._done(stub()); }
  /** STUB */ sell(ref) { return this._done(stub()); }
  /** STUB */ sellMany(refs) { return this._done(stub()); }
  /** STUB */ buyback(idx) { return this._done(stub()); }
  /** STUB */ repairAll() { return this._done(stub()); }
  /** STUB */ salvage(ref) { return this._done(stub()); }
  /** STUB */ salvageMany(refs) { return this._done(stub()); }
  /** STUB */ craft(slot) { return this._done(stub()); }
  /** STUB */ gamble(slot) { return this._done(stub()); }
  /** STUB */ rerollOffer(ref, affixIdx) { return this._done(stub()); }
  /** STUB */ rerollChoose(choice) { return this._done(stub()); }
  /** STUB */ rerollCancel() { return this._done(stub()); }
  /** STUB */ buyPotions(n) { return this._done(stub()); }
  /** STUB */ buyScrolls(n) { return this._done(stub()); }
  /** STUB */ takeFree(what) { return this._done(stub()); }
  // 균열
  /** STUB */ openRift(level, seed = null) { return this._done(stub()); }
  /** STUB */ returnToRift() { return this._done(stub()); }
  /** STUB */ leaveRift() { return this._done(stub()); }
  /** STUB */ respawn() { return this._done(stub()); }
  /** STUB */ markHint(id) { return this._done(stub()); }
  /** STUB — 마을 패널 시간(0 ≤ sec ≤ 60) */ addPlaySec(sec) { return this._done(stub()); }

  // 조회
  /** STUB — compareEquip 결과 @param {ItemRef} ref */
  previewEquip(ref) {
    const item = itemAt(this.state, ref);
    if (!item || !this.state.char) return null;
    return compareEquip(this.state.char, item);
  }
  /** → RiftPreview @param {number} level */
  previewRift(level) { return previewRift(this.state.char, level); }
  /** STUB → 정수 | null */ priceOf(ref, kind) { return null; }

  // 디버그(§11.8)
  /** STUB */ debugGotoTown() { return this._done(stub()); }
  /** STUB */ debugOpenRift(level, seed) { return this._done(stub()); }
  /** STUB */ debugCompleteRift() { return this._done(stub()); }
  /** STUB */ debugSpawnPack(typeId, rank, affixIds = null, at = null) { return this._done(stub()); }
  /** STUB */ debugKillAll() { return this._done(stub()); }
  /** STUB */ debugGrant({ gold, xp, materials, items } = {}) { return this._done(stub()); }
  /** STUB */ debugDropItem({ rarity, slot, ilvl } = {}) { return this._done(stub()); }
  /** STUB */ debugSetLevel(n) { return this._done(stub()); }
  /** STUB */ debugSetRiftUnlocked(n) { return this._done(stub()); }
  /** STUB */ debugSetInvincible(on) { return this._done(stub()); }
  /** STUB */ debugRevealMap() { return this._done(stub()); }
  /** STUB */ debugResetSkills() { return this._done(stub()); }

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
