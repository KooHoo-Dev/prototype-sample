// OWNER: P6 — 계약 §6.11 · §3.11 · §11.6
// 직렬화 · 검증 · 이주 · 정화 · 아이템 ID 중복 정리 · 계정 복구. 어떤 입력에도 throw 하지 않는다(깨진 세이브 → broken 표시 · app 이 백업한다).
// 원칙: 모르는 기본형의 아이템은 버린다 · 모르는 옵션 · 노드 · 키는 뺀다 · 숫자 아닌 값은 기본값으로 · 파생 값(아이템 가치 · 되사기 값)은 다시 계산한다.

import { BAG_SIZE, CHAR_SLOTS, CLASS_IDS, EQUIP_SLOTS, GAME_ID, HINT_IDS, LEVEL_CAP, MATERIAL_IDS, RARITIES, SAVE_VERSION, SKILL_BAR, STASH_SIZE } from '../../core/constants.js';
import { BASES_BY_ID, ITEM_AFFIXES_BY_ID, LEGENDARIES_BY_ID, SET_PIECES_BY_ID, SKILL_NODES_BY_ID } from '../../data/index.js';
import { ECON, SHOP } from '../../data/economy.js';
import { BASE_TIERS } from '../../data/items.js';
import { AFFIX_TIERS } from '../../data/itemAffixes.js';
import { RIFT } from '../../data/rift.js';
import { TREE } from '../../data/skills.js';
import { makeItem } from '../loot/rollItem.js';
import { createAccount, emptyArray, emptyEquip } from '../state.js';
import { summaryOf } from './character.js';
import { eachCharItem, itemIdNum } from './inventory.js';
import { pointsTotal, xpReq } from './progress.js';
import { priceSell } from './shops.js';

/** @typedef {import('../../types.js').GameState} GameState */
/** @typedef {import('../../types.js').AccountState} AccountState */
/** @typedef {import('../../types.js').CharacterState} CharacterState */
/** @typedef {import('../../types.js').AccountSave} AccountSave */
/** @typedef {import('../../types.js').CharSave} CharSave */
/** @typedef {import('../../types.js').Item} Item */

/** 순수 객체 깊은 복사(JSON 왕복) @template T @param {T} v @returns {T} */
const clone = (v) => JSON.parse(JSON.stringify(v));
const hasOwn = (o, k) => o != null && typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
/** @param {any} v @returns {v is Record<string, any>} */
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** 정수(잘라서) ∈ [lo, hi] · 숫자가 아니면 def @param {any} v @param {number} lo @param {number} hi @param {any} def */
const intIn = (v, lo, hi, def) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.floor(v))) : def);
/** 실수 ∈ [lo, hi] · 숫자가 아니면 def @param {any} v @param {number} lo @param {number} hi @param {number} def */
const numIn = (v, lo, hi, def) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def);
const BIG = Number.MAX_SAFE_INTEGER;
/** 이름 · 문자열 키의 길이 상한(깨진 세이브가 거대한 문자열을 들고 오지 않게) */
const STR_MAX = 64;
const NAME_KEYS_MAX = 4;
const AFFIX_TIER_MAX = AFFIX_TIERS.minIlvl.length;
const ITEM_FLAG_KEYS = ['gambled', 'crafted', 'bought', 'start', 'locked'];
const RESULTS = ['complete', 'collapse', 'abandon'];

/**
 * 세이브 이주 표 — MIGRATIONS[v](obj) → v + 1 꼴의 obj. SAVE_VERSION 1 에는 아직 없다(버전을 올릴 때 여기에 한 줄 · 이전 버전이 표에 없으면 broken 'version').
 * @type {Record<number, (obj:any) => any>}
 */
const MIGRATIONS = {};

// ───────────────────────── 쓰기 ─────────────────────────

/** 상태의 아이템 번호 최대값(보관함 · 지금 캐릭터) @param {GameState} state */
function maxItemNum(state) {
  let max = 0;
  for (const it of state.account?.stash ?? []) if (it) max = Math.max(max, itemIdNum(it.id));
  eachCharItem(state.char, (it) => { max = Math.max(max, itemIdNum(it.id)); });
  return max;
}

/**
 * 계정 세이브(savedAt 은 app 이 덮어쓴다) — 지금 캐릭터의 칸 요약은 지금 값으로 · nextItemId 는 가진 아이템 번호의 최대 + 1 이상
 * @param {GameState} state @returns {AccountSave}
 */
export function serializeAccount(state) {
  const a = state.account;
  const chars = clone(a.chars);
  const ch = state.char;
  if (ch && Number.isInteger(ch.slot) && ch.slot >= 0 && ch.slot < chars.length) chars[ch.slot] = summaryOf(ch);
  const nextItemId = Math.max(Number.isFinite(a.nextItemId) ? a.nextItemId : 1, maxItemNum(state) + 1);
  return { v: SAVE_VERSION, game: GAME_ID, savedAt: 0, chars, stash: clone(a.stash), nextItemId, lastSlot: a.lastSlot };
}

/** 캐릭터 세이브 — 재고는 저장하고(새로 고침으로 재고가 바뀌지 않게) 재굴림 제안만 뺀다 @param {CharacterState} char @returns {CharSave} */
export function serializeChar(char) {
  const { shop, ...rest } = char;
  const out = clone(rest);
  out.shop = { restocks: shop?.restocks ?? 0, stockRun: shop?.stockRun ?? -1, blacksmith: clone(shop?.blacksmith ?? []), general: clone(shop?.general ?? []) };
  return { v: SAVE_VERSION, game: GAME_ID, savedAt: 0, char: out };
}

// ───────────────────────── 읽기 공통 ─────────────────────────

/**
 * JSON 문자열(또는 이미 읽은 객체) → 버전 · 게임 검사 · 이주 → {obj, future} | {obj:null, reason}
 * @param {any} raw @returns {{obj:any, future:boolean, reason:string|null}}
 */
function parseSave(raw) {
  let obj = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); } catch { return { obj: null, future: false, reason: 'json' }; }
  }
  if (!isObj(obj)) return { obj: null, future: false, reason: 'shape' };
  if (obj.game !== GAME_ID) return { obj: null, future: false, reason: 'game' };
  if (!Number.isInteger(obj.v) || obj.v < 1) return { obj: null, future: false, reason: 'version' };
  if (obj.v > SAVE_VERSION) return { obj, future: true, reason: 'future' };
  let cur = obj;
  for (let v = obj.v; v < SAVE_VERSION; v++) {
    const m = MIGRATIONS[v];
    if (!m) return { obj: null, future: false, reason: 'version' };
    try { cur = m(cur); } catch { return { obj: null, future: false, reason: 'version' }; }
    if (!isObj(cur)) return { obj: null, future: false, reason: 'version' };
  }
  return { obj: cur, future: false, reason: null };
}

// ───────────────────────── 아이템 정화 ─────────────────────────

/** [정수, 정수] · 최대 ≥ 최소 + 1 · 0 이상 → 아니면 null @param {any} v */
function intPair(v) {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const [a, b] = v;
  if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  const lo = Math.max(0, Math.round(a));
  return [lo, Math.max(lo + 1, Math.round(b))];
}

/**
 * 아이템 정화 → Item|null — 모르는 기본형 → null · 모르는 옵션은 뺀다 · 숫자 아닌 값은 기본값으로 ·
 * 부위 · 클래스 · 요구 레벨 · 가치는 기본형 · ilvl · 등급에서 다시 계산 · 전설/세트 ID 가 기본형과 맞지 않으면 희귀로 ·
 * ID 가 문자열이 아니면 ''(dedupeItemIds 가 새 ID 를 준다). throw 하지 않는다.
 * @param {any} raw @returns {Item|null}
 */
export function sanitizeItem(raw) {
  try {
    if (!isObj(raw) || !hasOwn(BASES_BY_ID, raw.baseId)) return null;
    const base = BASES_BY_ID[raw.baseId];
    const ilvl = intIn(raw.ilvl, 1, RIFT.maxLevel, 1);
    const tier = intIn(raw.tier, 0, BASE_TIERS.length - 1, 0);
    let rarity = RARITIES.includes(raw.rarity) ? raw.rarity : RARITIES[0];
    let legendaryId = null;
    let setPieceId = null;
    if (rarity === 'legendary') {
      if (hasOwn(LEGENDARIES_BY_ID, raw.legendaryId) && LEGENDARIES_BY_ID[raw.legendaryId].baseId === base.id) legendaryId = raw.legendaryId;
      else rarity = RARITIES[2];
    } else if (rarity === 'set') {
      if (hasOwn(SET_PIECES_BY_ID, raw.setPieceId) && SET_PIECES_BY_ID[raw.setPieceId].baseId === base.id) setPieceId = raw.setPieceId;
      else rarity = RARITIES[2];
    }
    /** @type {import('../../types.js').ItemAffix[]} */
    const affixes = [];
    if (Array.isArray(raw.affixes)) {
      for (const a of raw.affixes) {
        if (!isObj(a) || !hasOwn(ITEM_AFFIXES_BY_ID, a.id)) continue;
        if (typeof a.value !== 'number' || !Number.isFinite(a.value)) continue;
        const t = a.tier;
        if (!Number.isInteger(t) || t < 1 || t > AFFIX_TIER_MAX) continue;   // 티어가 값 범위를 정한다 — 범위 밖이면 버린다
        /** @type {import('../../types.js').ItemAffix} */
        const o = { id: a.id, tier: /** @type {any} */ (t), value: a.value };
        if (ITEM_AFFIXES_BY_ID[a.id].param) {
          if (!hasOwn(SKILL_NODES_BY_ID, a.param)) continue;
          o.param = a.param;
        }
        affixes.push(o);
      }
    }
    const id = typeof raw.id === 'string' && raw.id.length <= STR_MAX ? raw.id : '';
    const item = makeItem({ baseId: base.id, tier, ilvl, rarity, id, affixes, legendaryId, setPieceId });
    // 굴린 기본 값 — 기본형에 있는 키만 · 숫자가 맞으면 그 값 · 아니면 makeItem 의 기본(편차 1)
    if (isObj(raw.base)) {
      const b = /** @type {Record<string, any>} */ (item.base);
      for (const k of Object.keys(b)) {
        const v = raw.base[k];
        if (k === 'dmg' || k === 'bonus') { const p = intPair(v); if (p) b[k] = p; }
        else if (k === 'armor') { if (typeof v === 'number' && Number.isFinite(v) && v >= 0) b[k] = Math.round(v); }
        else if (k === 'block') { if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1) b[k] = v; }
        else if (typeof v === 'number' && Number.isFinite(v) && v > 0) b[k] = v;
      }
    }
    if (Array.isArray(raw.name) && raw.name.length > 0 && raw.name.length <= NAME_KEYS_MAX
      && raw.name.every(s => typeof s === 'string' && s.length > 0 && s.length <= STR_MAX)) item.name = raw.name.slice();
    item.dur = numIn(raw.dur, 0, item.durMax, item.durMax);
    item.rerollIdx = Number.isInteger(raw.rerollIdx) && raw.rerollIdx >= 0 && raw.rerollIdx < affixes.length ? raw.rerollIdx : null;
    item.rerolls = intIn(raw.rerolls, 0, BIG, 0);
    /** @type {Item['flags']} */
    const flags = {};
    if (isObj(raw.flags)) for (const k of ITEM_FLAG_KEYS) if (raw.flags[k] === true) /** @type {any} */ (flags)[k] = true;
    item.flags = flags;
    return item;
  } catch {
    return null;
  }
}

/** 아이템 배열(길이 ≤ max · 버린 것은 뺀다) @param {any} raw @param {number} max @returns {Item[]} */
function itemList(raw, max) {
  /** @type {Item[]} */
  const out = [];
  if (!Array.isArray(raw)) return out;
  for (const r of raw) {
    if (out.length >= max) break;
    const it = sanitizeItem(r);
    if (it) out.push(it);
  }
  return out;
}

// ───────────────────────── 계정 ─────────────────────────

/** account.chars 한 칸 정화 @param {any} s */
function sanitizeSummary(s) {
  if (!isObj(s) || !CLASS_IDS.includes(s.cls)) return null;
  return {
    name: typeof s.name === 'string' ? s.name.slice(0, STR_MAX) : '',
    cls: s.cls,
    level: intIn(s.level, 1, LEVEL_CAP, 1),
    riftUnlocked: intIn(s.riftUnlocked, 1, RIFT.maxLevel, 1),
  };
}

/** @param {Record<string, any>} obj @returns {AccountState} */
function sanitizeAccount(obj) {
  const a = createAccount();
  if (Array.isArray(obj.chars)) for (let i = 0; i < CHAR_SLOTS; i++) a.chars[i] = sanitizeSummary(obj.chars[i]);
  if (Array.isArray(obj.stash)) for (let i = 0; i < STASH_SIZE && i < obj.stash.length; i++) a.stash[i] = obj.stash[i] == null ? null : sanitizeItem(obj.stash[i]);
  a.nextItemId = intIn(obj.nextItemId, 1, BIG, 1);
  a.lastSlot = intIn(obj.lastSlot, -1, CHAR_SLOTS - 1, -1);
  dedupeItemIds(a, []);
  return a;
}

/**
 * 계정 읽기(JSON 문자열|null · throw 금지) — 없으면 새 계정(broken false) · 깨졌으면 새 계정 + broken true · reason ∈ json shape game version ·
 * 미래 버전이면 읽은 것 + reason 'future' · future true(app 은 덮어쓰지 않는다 · §11.6)
 * @param {string|null} raw @returns {{account:AccountState, broken:boolean, reason:string|null, future:boolean}}
 */
export function loadAccount(raw) {
  try {
    if (raw === null || raw === undefined || raw === '') return { account: createAccount(), broken: false, reason: null, future: false };
    const p = parseSave(raw);
    if (!p.obj) return { account: createAccount(), broken: true, reason: p.reason, future: false };
    return { account: sanitizeAccount(p.obj), broken: false, reason: p.reason, future: p.future };
  } catch {
    return { account: createAccount(), broken: true, reason: 'shape', future: false };
  }
}

// ───────────────────────── 캐릭터 ─────────────────────────

/**
 * 스킬 정화 — 그 클래스의 아는 노드 · 랭크 1..maxRank · 그 레벨의 포인트 안 · 단계 해금(아래 단계 점수 ≥ tierPoints) · 변형의 req 가
 * 지켜지지 않으면 전부 돌려준다(ranks 비움 — 포인트는 다시 찍는다) · bar 는 배운 액티브만 · 중복 없이
 * @param {any} raw @param {string} cls @param {number} level
 */
function sanitizeSkills(raw, cls, level) {
  /** @type {Record<string, number>} */
  let ranks = {};
  if (isObj(raw?.ranks)) {
    for (const id of Object.keys(raw.ranks)) {
      if (!hasOwn(SKILL_NODES_BY_ID, id)) continue;
      const node = SKILL_NODES_BY_ID[id];
      if (node.cls !== cls) continue;
      const r = intIn(raw.ranks[id], 0, node.maxRank, 0);
      if (r > 0) ranks[id] = r;
    }
  }
  let total = 0;
  /** @type {number[]} */
  const byTier = TREE.tierPoints.map(() => 0);
  for (const id of Object.keys(ranks)) {
    total += ranks[id];
    const t = SKILL_NODES_BY_ID[id].tier - 1;
    if (t >= 0 && t < byTier.length) byTier[t] += ranks[id];
  }
  let valid = total <= pointsTotal(level);
  let below = 0;
  for (let t = 0; t < byTier.length && valid; t++) {
    if (byTier[t] > 0 && below < TREE.tierPoints[t]) valid = false;
    below += byTier[t];
  }
  for (const id of Object.keys(ranks)) {
    const req = SKILL_NODES_BY_ID[id].req;
    if (req && !(ranks[req] >= 1)) valid = false;
  }
  if (!valid) ranks = {};
  /** @type {Array<string|null>} */
  const bar = emptyArray(SKILL_BAR);
  if (Array.isArray(raw?.bar)) {
    for (let i = 0; i < SKILL_BAR; i++) {
      const id = raw.bar[i];
      if (typeof id !== 'string' || !(ranks[id] >= 1) || SKILL_NODES_BY_ID[id].kind !== 'active' || bar.includes(id)) continue;
      bar[i] = id;
    }
  }
  return { ranks, bar };
}

/** 최고 기록 정화 — 키는 균열 레벨 숫자 @param {any} raw */
function sanitizeBest(raw) {
  /** @type {Record<string, {timeSec:number, deaths:number}>} */
  const out = {};
  if (!isObj(raw)) return out;
  for (const k of Object.keys(raw)) {
    if (!/^\d+$/.test(k) || !isObj(raw[k])) continue;
    const t = raw[k].timeSec;
    if (typeof t !== 'number' || !Number.isFinite(t) || t < 0) continue;
    out[k] = { timeSec: t, deaths: intIn(raw[k].deaths, 0, BIG, 0) };
  }
  return out;
}

/** 등급별 · 처치 구성 같은 숫자 표 — 정해진 키만 · 숫자 아니면 0 @param {any} raw @param {readonly string[]} keys */
function numTable(raw, keys) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const k of keys) out[k] = numIn(isObj(raw) ? raw[k] : undefined, 0, BIG, 0);
  return out;
}
const KILL_KEYS = ['normal', 'champion', 'elite', 'minion', 'guardian', 'other'];

/** 판 기록 한 줄 정화(RunRecord) — 모양이 아니면 null @param {any} r */
function sanitizeRecord(r) {
  if (!isObj(r) || typeof r.level !== 'number' || !Number.isFinite(r.level)) return null;
  const n = (v) => numIn(v, 0, BIG, 0);
  return {
    level: intIn(r.level, 1, RIFT.maxLevel, 1), seed: n(r.seed), tileset: typeof r.tileset === 'string' ? r.tileset.slice(0, STR_MAX) : '',
    cls: CLASS_IDS.includes(r.cls) ? r.cls : CLASS_IDS[0], result: RESULTS.includes(r.result) ? r.result : RESULTS[2], timeSec: n(r.timeSec),
    kills: numTable(r.kills, KILL_KEYS), deaths: intIn(r.deaths, 0, BIG, 0), drops: numTable(r.drops, RARITIES),
    gold: n(r.gold), xp: n(r.xp), upgrades: n(r.upgrades), recalls: n(r.recalls), maxTargeting: n(r.maxTargeting), swarmMoments: n(r.swarmMoments),
    unlockedTo: intIn(r.unlockedTo, 1, RIFT.maxLevel, 1), noDeath: r.noDeath === true, record: r.record === true,
    at: n(r.at), charLevel: intIn(r.charLevel, 1, LEVEL_CAP, 1),
  };
}

/**
 * 캐릭터 정화 → CharacterState|null(클래스를 모르면 null) — 칸은 인자 slot · 부위 · 클래스가 안 맞는 장착 · 양손과 겹친 보조는 가방으로(빈칸이 없으면 버린다) ·
 * 되사기 값은 판매가로 다시 계산 · 재굴림 제안은 null
 * @param {any} raw @param {number} slot @returns {CharacterState|null}
 */
function sanitizeChar(raw, slot) {
  if (!isObj(raw) || !CLASS_IDS.includes(raw.cls)) return null;
  const cls = raw.cls;
  const level = intIn(raw.level, 1, LEVEL_CAP, 1);
  const req = xpReq(level);
  const mats = isObj(raw.materials) ? raw.materials : {};
  /** @type {Record<string, number>} */
  const materials = {};
  for (const id of MATERIAL_IDS) materials[id] = intIn(mats[id], 0, BIG, 0);

  // 장착 · 가방
  const equip = emptyEquip();
  /** @type {Item[]} */
  const overflow = [];
  const rawEquip = isObj(raw.equip) ? raw.equip : {};
  for (const s of EQUIP_SLOTS) {
    const it = sanitizeItem(rawEquip[s]);
    if (!it) continue;
    const fits = it.slot === s || (it.slot === 'ring' && (s === 'ring1' || s === 'ring2'));
    const clsOk = it.cls === null || it.cls === cls;
    if (fits && clsOk) /** @type {any} */ (equip)[s] = it;
    else overflow.push(it);
  }
  if (equip.mainHand && (BASES_BY_ID[equip.mainHand.baseId]?.hands ?? 1) === 2 && equip.offhand) {
    overflow.push(equip.offhand);
    equip.offhand = null;
  }
  /** @type {Array<Item|null>} */
  const bag = emptyArray(BAG_SIZE);
  if (Array.isArray(raw.bag)) {
    for (let i = 0; i < raw.bag.length; i++) {
      const it = raw.bag[i] == null ? null : sanitizeItem(raw.bag[i]);
      if (!it) continue;
      if (i < BAG_SIZE) bag[i] = it;
      else overflow.push(it);
    }
  }
  for (const it of overflow) {
    const j = bag.indexOf(null);
    if (j < 0) break;
    bag[j] = it;
  }

  /** @type {Array<{item:Item, price:number}>} */
  const buyback = [];
  if (Array.isArray(raw.buyback)) {
    for (const e of raw.buyback) {
      if (buyback.length >= ECON.buybackMax) break;
      const it = isObj(e) ? sanitizeItem(e.item) : null;
      if (it) buyback.push({ item: it, price: priceSell(it) });
    }
  }
  const shop = isObj(raw.shop) ? raw.shop : {};
  /** @type {Record<string, boolean>} */
  const hints = {};
  if (isObj(raw.hints)) for (const h of HINT_IDS) if (raw.hints[h] === true) hints[h] = true;
  /** @type {any[]} */
  const records = [];
  if (Array.isArray(raw.records)) {
    for (const r of raw.records) {
      if (records.length >= ECON.recordsMax) break;
      const rec = sanitizeRecord(r);
      if (rec) records.push(rec);
    }
  }

  /** @type {CharacterState} */
  const ch = {
    slot: Number.isInteger(slot) && slot >= 0 && slot < CHAR_SLOTS ? slot : intIn(raw.slot, 0, CHAR_SLOTS - 1, 0),
    name: typeof raw.name === 'string' ? raw.name.slice(0, STR_MAX) : '',
    cls,
    level,
    xp: Number.isFinite(req) ? intIn(raw.xp, 0, req - 1, 0) : 0,
    xpTotal: intIn(raw.xpTotal, 0, BIG, 0),
    gold: intIn(raw.gold, 0, BIG, 0),
    materials: /** @type {any} */ (materials),
    potions: intIn(raw.potions, 0, ECON.potionMax, 0),
    scrolls: intIn(raw.scrolls, 0, ECON.scrollMax, 0),
    skills: sanitizeSkills(raw.skills, cls, level),
    equip,
    bag,
    riftUnlocked: intIn(raw.riftUnlocked, 1, RIFT.maxLevel, 1),
    best: sanitizeBest(raw.best),
    records,
    blp: { count: intIn(raw.blp?.count, 0, BIG, 0) },
    buyback,
    shop: {
      blacksmith: itemList(shop.blacksmith, SHOP.blacksmithStock),
      general: itemList(shop.general, SHOP.generalStock),
      restocks: intIn(shop.restocks, 0, BIG, 0),
      stockRun: intIn(shop.stockRun, -1, BIG, -1),
      reroll: null,
    },
    hints,
    playSec: numIn(raw.playSec, 0, BIG, 0),
    runs: intIn(raw.runs, 0, BIG, 0),
    seed: typeof raw.seed === 'number' && Number.isFinite(raw.seed) ? raw.seed >>> 0 : 1,
    lastRiftLevel: intIn(raw.lastRiftLevel, 1, RIFT.maxLevel, 1),
  };
  return ch;
}

/**
 * 캐릭터 읽기(JSON 문자열|null · throw 금지) → {char|null, broken, reason, future} — 없으면 char null · broken false /
 * 깨졌으면 char null · broken true(reason json shape game version class) / 미래 버전이면 읽은 것 + future true
 * (ID 중복 정리는 부르는 쪽이 dedupeItemIds(account, [char]) — §11.2 selectChar)
 * @param {string|null} raw @param {number} slot
 */
export function loadChar(raw, slot) {
  try {
    if (raw === null || raw === undefined || raw === '') return { char: /** @type {CharacterState|null} */ (null), broken: false, reason: null, future: false };
    const p = parseSave(raw);
    if (!p.obj) return { char: null, broken: true, reason: p.reason, future: false };
    const ch = sanitizeChar(p.obj.char, slot);
    if (!ch) return { char: null, broken: true, reason: isObj(p.obj.char) ? 'class' : 'shape', future: false };
    return { char: ch, broken: false, reason: p.reason, future: p.future };
  } catch {
    return { char: null, broken: true, reason: 'shape', future: false };
  }
}

// ───────────────────────── ID 정리 · 계정 복구 ─────────────────────────

/**
 * 아이템 ID 중복 정리(제자리) — 캐릭터들(칸 순 · 장착 → 가방 → 재고 → 되사기) 다음 보관함 순서로 돌며, 앞에 이미 나온 ID 이거나
 * 'i<n>' 꼴이 아니면 새 ID 를 준다 · account.nextItemId = max(지금, 가진 번호의 최대 + 1) → {changed}(바뀌었으면 app 이 바로 저장)
 * @param {AccountState} account @param {Array<CharacterState|null>} chars
 */
export function dedupeItemIds(account, chars) {
  /** @type {Item[]} */
  const items = [];
  for (const ch of Array.isArray(chars) ? chars : []) eachCharItem(ch, (it) => { items.push(it); });
  for (const it of account?.stash ?? []) if (it) items.push(it);
  let max = 0;
  for (const it of items) max = Math.max(max, itemIdNum(it.id));
  const cur = account && Number.isInteger(account.nextItemId) && account.nextItemId >= 1 ? account.nextItemId : 1;
  let next = Math.max(cur, max + 1);
  let changed = !!account && account.nextItemId !== next;
  /** @type {Set<string>} */
  const seen = new Set();
  for (const it of items) {
    if (itemIdNum(it.id) < 0 || seen.has(it.id)) {
      it.id = 'i' + next++;
      changed = true;
    }
    seen.add(it.id);
  }
  if (account) account.nextItemId = next;
  return { changed };
}

/**
 * 계정이 깨졌을 때 칸 0..3 의 캐릭터 세이브로 다시 세운다 — chars[slot] = summaryOf(char) · lastSlot = 첫 캐릭터 칸 ·
 * nextItemId = (모든 캐릭터 아이템 번호의 최대) + 1 · 캐릭터 사이 ID 중복은 dedupeItemIds 로(바뀐 캐릭터는 app 이 다시 쓴다) · 보관함은 빈 채
 * @param {Array<string|null>} charRaws @returns {{account:AccountState, chars:Array<CharacterState|null>}}
 */
export function rebuildAccount(charRaws) {
  const account = createAccount();
  /** @type {Array<CharacterState|null>} */
  const chars = emptyArray(CHAR_SLOTS);
  for (let s = 0; s < CHAR_SLOTS; s++) {
    const raw = Array.isArray(charRaws) ? charRaws[s] ?? null : null;
    const r = loadChar(raw, s);
    if (!r.char) continue;
    chars[s] = r.char;
    account.chars[s] = summaryOf(r.char);
    if (account.lastSlot < 0) account.lastSlot = s;
  }
  dedupeItemIds(account, chars);
  return { account, chars };
}
