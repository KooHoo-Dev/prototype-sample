// OWNER: P4 — 계약 §6.6 (UI가 부르는 명령 창구)
// 성공한 명령은 §4.3의 이벤트(세부 이벤트 → PROFILE_CHANGED)를 즉시 낸다.
// 실패한 명령은 {ok:false, reason}을 반환하고 PURCHASE_FAILED를 낸다. profile은 바뀌지 않는다.
// 조회 메서드는 UI가 계산 없이 그대로 그릴 값을 준다. 캐시하지 않는다 — app이 profile 내용을 갈아 끼워도('reset') 그대로 맞는다.
import { BOSS_IDS, STAT_IDS, WEAPON_IDS } from '../../core/constants.js';
import { EV } from '../../core/events.js';
import { PLAYER } from '../../data/player.js';
import { STATS } from '../../data/stats.js';
import { ECONOMY } from '../../data/economy.js';
import { RELICS, RELIC_IDS } from '../../data/relics.js';
import { computeStatBlock, previewLevelUp, affordableLevelUps, levelUpCost, totalPoints, weaponDamageAt } from './stats.js';
import { computeReward, weaponUpgradeCost, shardsLeftFor } from './economy.js';
import { nonNegInt } from './num.js';

/** @typedef {import('../../types.js').Profile} Profile */
/** @typedef {import('../../types.js').StatBlock} StatBlock */
/** @typedef {import('../../types.js').StatId} StatId */
/** @typedef {import('../../types.js').WeaponId} WeaponId */
/** @typedef {import('../../types.js').CmdResult} CmdResult */
/** @typedef {import('../../core/events.js').EventBus} EventBus */

/**
 * @typedef {Object} ShopItem
 * @property {string} id                'flask_charge' | 'flask_heal' | 'relic:<id>'
 * @property {'flask_charge'|'flask_heal'|'relic'} kind
 * @property {number} level             플라스크: 산 단계 · 유물: 보유 1 / 미보유 0
 * @property {number} maxLevel
 * @property {number} price             다음 단계 가격(품절이면 0)
 * @property {boolean} canAfford        품절이 아니고 잔불이 닿는가
 * @property {boolean} owned            유물만 — 보유 여부(플라스크는 false)
 * @property {boolean} soldOut
 * @property {number|null} valueNow     flask_charge: 충전 수 · flask_heal: 1회 회복량 · relic: null
 * @property {number|null} valueNext    다음 단계의 값(품절이면 valueNow와 같다) · relic: null
 * @property {0|1|null} equippedSlot    relic만. 그 밖은 null
 */

const ITEM_FLASK_CHARGE = 'flask_charge';
const ITEM_FLASK_HEAL = 'flask_heal';
const RELIC_PREFIX = 'relic:';

/** @returns {CmdResult} 호출마다 새 객체(받은 쪽이 고쳐도 서로 물들지 않는다) */
const ok = () => ({ ok: true });

export class Progression {
  /**
   * @param {Profile} profile 살아 있는 프로필(GameSim과 같은 객체)
   * @param {EventBus} bus
   */
  constructor(profile, bus) {
    /** @type {Profile} */
    this.profile = profile;
    this.bus = bus;
  }

  // ───────────────────────────── 화톳불

  /** @returns {StatBlock} */
  getStatBlock() {
    return computeStatBlock(this.profile);
  }

  /** @param {StatId} statId @returns {ReturnType<typeof previewLevelUp>} */
  previewLevelUp(statId) {
    return previewLevelUp(this.profile, statId);
  }

  /** 결과 패널 · 화톳불 머리줄. @returns {number} */
  getAffordableLevelUps() {
    return affordableLevelUps(this.profile);
  }

  /** 성공: LEVEL_UP · PROFILE_CHANGED. @param {StatId} statId @returns {CmdResult} */
  levelUp(statId) {
    const p = this.profile;
    if (!STAT_IDS.includes(statId)) return this._fail('invalid');
    if (p.stats[statId] >= STATS.maxPoints) return this._fail('max');
    const cost = levelUpCost(totalPoints(p));
    if (p.embers < cost) return this._fail('embers');

    p.embers -= cost;
    p.stats[statId] += 1;
    this._emit(EV.LEVEL_UP, { stat: statId, points: p.stats[statId], level: 1 + totalPoints(p), cost });
    this._changed('levelUp');
    return ok();
  }

  // ───────────────────────────── 대장장이

  /**
   * @param {WeaponId} weaponId
   * @returns {{id:WeaponId, level:number, maxed:boolean, equipped:boolean, catchUp:boolean,
   *            cost:{embers:number, shards:number}|null, canAfford:boolean, damageNow:number, damageNext:number}}
   *   catchUp = level < max(다른 두 무기의 level) — 그 단계는 이미 다른 무기로 넘어 봤으므로 파편 없이 반값
   *   damageNow/damageNext = 무기 피해(baseDamage × 강화 배율). 최대 단계면 damageNext = damageNow
   *   모르는 weaponId면 중립 값(level 0 · cost null · 피해 0)
   */
  getWeaponInfo(weaponId) {
    const p = this.profile;
    if (!WEAPON_IDS.includes(weaponId)) {
      return { id: weaponId, level: 0, maxed: false, equipped: false, catchUp: false, cost: null, canAfford: false, damageNow: 0, damageNext: 0 };
    }
    const level = p.weapons[weaponId].level;
    let best = 0;
    for (const id of WEAPON_IDS) if (id !== weaponId) best = Math.max(best, p.weapons[id].level);
    const maxed = level >= ECONOMY.weapon.maxLevel;
    const catchUp = level < best;
    const cost = weaponUpgradeCost(level, catchUp);
    return {
      id: weaponId,
      level,
      maxed,
      equipped: p.equippedWeapon === weaponId,
      catchUp,
      cost,
      canAfford: cost !== null && p.embers >= cost.embers && p.shards >= cost.shards,
      damageNow: weaponDamageAt(weaponId, level),
      damageNext: weaponDamageAt(weaponId, maxed ? level : level + 1),
    };
  }

  /** 성공: WEAPON_UPGRADED · PROFILE_CHANGED. 비용은 getWeaponInfo().cost 그대로. @param {WeaponId} weaponId @returns {CmdResult} */
  upgradeWeapon(weaponId) {
    const p = this.profile;
    if (!WEAPON_IDS.includes(weaponId)) return this._fail('invalid');
    const info = this.getWeaponInfo(weaponId);
    if (info.cost === null) return this._fail('max');
    if (p.embers < info.cost.embers) return this._fail('embers');
    if (p.shards < info.cost.shards) return this._fail('shards');

    p.embers -= info.cost.embers;
    p.shards -= info.cost.shards;
    p.weapons[weaponId].level += 1;
    this._emit(EV.WEAPON_UPGRADED, { weaponId, level: p.weapons[weaponId].level });
    this._changed('upgrade');
    return ok();
  }

  /**
   * 성공: WEAPON_EQUIPPED · PROFILE_CHANGED. 이미 든 무기면 아무것도 바꾸지 않고 {ok:true}(이벤트 없음).
   * @param {WeaponId} weaponId
   * @returns {CmdResult}
   */
  equipWeapon(weaponId) {
    const p = this.profile;
    if (!WEAPON_IDS.includes(weaponId)) return this._fail('invalid');
    if (p.equippedWeapon === weaponId) return ok();
    p.equippedWeapon = weaponId;
    this._emit(EV.WEAPON_EQUIPPED, { weaponId });
    this._changed('equip');
    return ok();
  }

  // ───────────────────────────── 상인

  /**
   * 진열 순서: flask_charge · flask_heal · 유물(RELIC_IDS 순서).
   * @returns {ShopItem[]}
   */
  getShopItems() {
    const p = this.profile;
    const shop = ECONOMY.shop;
    /** @type {ShopItem[]} */
    const items = [
      this._flaskItem(ITEM_FLASK_CHARGE, p.flaskChargeLv, shop.flaskCharge.prices, PLAYER.base.flaskCharges, 1),
      this._flaskItem(ITEM_FLASK_HEAL, p.flaskHealLv, shop.flaskHeal.prices, PLAYER.base.flaskHeal, shop.flaskHeal.perLevel),
    ];
    for (const id of RELIC_IDS) {
      const owned = p.relicsOwned.includes(id);
      const slot = p.relicsEquipped.indexOf(id);
      items.push({
        id: RELIC_PREFIX + id,
        kind: 'relic',
        level: owned ? 1 : 0,
        maxLevel: 1,
        price: RELICS[id].price,
        canAfford: !owned && p.embers >= RELICS[id].price,
        owned,
        soldOut: owned,
        valueNow: null,
        valueNext: null,
        equippedSlot: slot >= 0 ? /** @type {0|1} */ (slot) : null,
      });
    }
    return items;
  }

  /**
   * 성공: ITEM_PURCHASED · PROFILE_CHANGED. 유물은 빈 칸이 있으면 가장 앞 빈 칸에 자동 장착(RELIC_EQUIPPED도 낸다).
   * 두 칸이 다 차 있으면 보유만 한다.
   * @param {string} itemId 'flask_charge' | 'flask_heal' | 'relic:<id>'
   * @returns {CmdResult}
   */
  buy(itemId) {
    const p = this.profile;
    const shop = ECONOMY.shop;

    if (itemId === ITEM_FLASK_CHARGE || itemId === ITEM_FLASK_HEAL) {
      const charge = itemId === ITEM_FLASK_CHARGE;
      const prices = charge ? shop.flaskCharge.prices : shop.flaskHeal.prices;
      const level = charge ? p.flaskChargeLv : p.flaskHealLv;
      if (level >= prices.length) return this._fail('max');
      if (p.embers < prices[level]) return this._fail('embers');
      p.embers -= prices[level];
      if (charge) p.flaskChargeLv += 1;
      else p.flaskHealLv += 1;
      this._emit(EV.ITEM_PURCHASED, { itemId });
      this._changed('buy');
      return ok();
    }

    const relicId = typeof itemId === 'string' && itemId.startsWith(RELIC_PREFIX) ? itemId.slice(RELIC_PREFIX.length) : '';
    if (!Object.hasOwn(RELICS, relicId)) return this._fail('invalid');
    if (p.relicsOwned.includes(relicId)) return this._fail('owned');
    const price = RELICS[relicId].price;
    if (p.embers < price) return this._fail('embers');

    p.embers -= price;
    p.relicsOwned.push(relicId);
    const slot = p.relicsEquipped.indexOf(null);
    if (slot >= 0) p.relicsEquipped[slot] = relicId;
    this._emit(EV.ITEM_PURCHASED, { itemId });
    if (slot >= 0) this._emit(EV.RELIC_EQUIPPED, { slot, relicId });
    this._changed('buy');
    return ok();
  }

  /**
   * 성공: RELIC_EQUIPPED · PROFILE_CHANGED. 미보유 유물은 'locked'.
   * 같은 유물은 두 칸에 들어가지 않는다 — 다른 칸에 있던 유물을 고르면 두 칸의 내용을 맞바꾼다(RELIC_EQUIPPED 두 번).
   * 이미 그 칸에 있는 값이면 아무것도 바꾸지 않고 {ok:true}(이벤트 없음).
   * @param {0|1} slot
   * @param {string|null} relicId null이면 해제
   * @returns {CmdResult}
   */
  equipRelic(slot, relicId) {
    const p = this.profile;
    const eq = p.relicsEquipped;
    if (!Number.isInteger(slot) || slot < 0 || slot >= ECONOMY.relicSlots) return this._fail('invalid');
    if (relicId !== null) {
      if (typeof relicId !== 'string' || !Object.hasOwn(RELICS, relicId)) return this._fail('invalid');
      if (!p.relicsOwned.includes(relicId)) return this._fail('locked');
    }
    const prev = eq[slot];
    if (prev === relicId) return ok();

    const other = relicId === null ? -1 : eq.indexOf(relicId);
    // 두 칸을 다 고친 뒤에 알린다 — 리스너가 같은 유물이 두 칸에 든 중간 상태를 보지 않게.
    if (other >= 0) eq[other] = prev;
    eq[slot] = relicId;
    if (other >= 0) this._emit(EV.RELIC_EQUIPPED, { slot: other, relicId: prev });
    this._emit(EV.RELIC_EQUIPPED, { slot, relicId });
    this._changed('relic');
    return ok();
  }

  // ───────────────────────────── 안개문

  /**
   * BOSS_IDS 순서.
   * @returns {{id:string, unlocked:boolean, attempts:number, killsThisCycle:number, totalKills:number, bestFraction:number,
   *            victoryEmbers:number, victoryShards:number, repeatMul:number, shardsLeft:number}[]}
   *   victoryEmbers · victoryShards = 지금 격파하면 받는 양(감쇠 · 남은 구간 포함).
   *   shardsLeft = 이번 순환에 이 보스에게서 더 받을 수 있는 파편 합
   */
  getBossList() {
    const p = this.profile;
    return BOSS_IDS.map((id) => {
      const bp = p.bosses[id];
      const win = computeReward(p, id, { victory: true, damageFraction: 1, duration: 0 });
      return {
        id,
        unlocked: bp.unlocked,
        attempts: bp.attempts,
        killsThisCycle: bp.killsThisCycle,
        totalKills: bp.totalKills,
        bestFraction: bp.bestFraction,
        victoryEmbers: win.embers,
        victoryShards: win.shards,
        repeatMul: win.repeatMul,
        shardsLeft: shardsLeftFor(bp),
      };
    });
  }

  // ───────────────────────────── 디버그

  /**
   * 디버그 지급(음수면 회수 — 0 아래로 내려가지 않는다). PROFILE_CHANGED {reason:'debug'}.
   * @param {number} [embers]
   * @param {number} [shards]
   */
  grant(embers = 0, shards = 0) {
    const p = this.profile;
    p.embers = nonNegInt(p.embers + (Number.isFinite(embers) ? Math.trunc(embers) : 0));
    p.shards = nonNegInt(p.shards + (Number.isFinite(shards) ? Math.trunc(shards) : 0));
    this._changed('debug');
  }

  // ───────────────────────────── 내부

  /**
   * @param {'flask_charge'|'flask_heal'} id
   * @param {number} level
   * @param {number[]} prices 단계별 가격
   * @param {number} base 0단계의 값
   * @param {number} perLevel 한 단계의 증가분
   * @returns {ShopItem}
   */
  _flaskItem(id, level, prices, base, perLevel) {
    const soldOut = level >= prices.length;
    const valueNow = base + perLevel * level;
    return {
      id,
      kind: id,
      level,
      maxLevel: prices.length,
      price: soldOut ? 0 : prices[level],
      canAfford: !soldOut && this.profile.embers >= prices[level],
      owned: false,
      soldOut,
      valueNow,
      valueNext: soldOut ? valueNow : valueNow + perLevel,
      equippedSlot: null,
    };
  }

  /** @param {string} name @param {Object} payload */
  _emit(name, payload) {
    if (this.bus) this.bus.emit(name, payload);
  }

  /** @param {'levelUp'|'upgrade'|'equip'|'buy'|'relic'|'debug'} reason */
  _changed(reason) {
    this._emit(EV.PROFILE_CHANGED, { reason });
  }

  /**
   * @param {'embers'|'shards'|'max'|'locked'|'owned'|'invalid'} reason
   * @returns {CmdResult}
   */
  _fail(reason) {
    this._emit(EV.PURCHASE_FAILED, { reason });
    return { ok: false, reason };
  }
}
