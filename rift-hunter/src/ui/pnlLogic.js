// OWNER: P11 — 계약 §10.6(패널 세부) · §12.2(ui.panels.test — 순수 함수)
// 패널이 고르는 것(일괄 판매 대상 · 균열석 기본 포커스 · 부분 수리 미리보기 · 스킬 트리 배치 · 노드 수치 전/후 · 제작 분포 · 남은 전리품)을 순수 함수로.
// DOM 없음 — Node 테스트가 import 한다. 규칙의 정본은 sim(§6.13 조회 함수)이고, 여기는 그것을 화면에 맞게 모은다.

import { EQUIP_SLOTS, ITEM_SLOTS } from '../core/constants.js';
import { BASES_BY_ID, ITEM_AFFIXES_BY_ID, SKILL_NODES_BY_ID, basesFor, nodesOf } from '../data/index.js';
import { REPAIR_ORDER } from '../data/economy.js';
import { ITEM } from '../data/items.js';
import { RIFT } from '../data/rift.js';
import { TREE } from '../data/skills.js';
import { isUpgrade } from '../sim/loot/compare.js';
import { affixCountDist, baseTierDist, tierDist } from '../sim/loot/theory.js';
import { itemRepairRaw, repairCost } from '../sim/progression/inventory.js';
import { priceSell } from '../sim/progression/shops.js';

/** @typedef {import('../types.js').CharacterState} CharacterState */
/** @typedef {import('../types.js').Item} Item */
/** @typedef {import('../types.js').PlayerStats} PlayerStats */

/** isUpgrade 기억 — 시트(stats 객체 — 장착 · 레벨 · 스킬이 바뀌면 새 객체) × 아이템(객체 · 재굴림 횟수) @type {WeakMap<object, WeakMap<object, {r:number, v:boolean}>>} */
const UP_CACHE = new WeakMap();

/**
 * isUpgrade(§5.13-5)를 시트 · 아이템별로 기억한다 — 패널이 거래마다 가방 40칸을 다시 계산하지 않게(값은 isUpgrade 그대로)
 * @param {PlayerStats|null} stats @param {CharacterState|null} char @param {Item|null} item @returns {boolean}
 */
export function upgradeOf(stats, char, item) {
  if (!char || !item) return false;
  if (!stats || typeof stats !== 'object') return isUpgrade(stats, char, item);
  let m = UP_CACHE.get(stats);
  if (!m) { m = new WeakMap(); UP_CACHE.set(stats, m); }
  const r = Number(item.rerolls) || 0;
  const hit = m.get(item);
  if (hit && hit.r === r) return hit.v;
  const v = isUpgrade(stats, char, item);
  m.set(item, { r, v });
  return v;
}

/** 일괄 판매 대상 등급(§10.6 — 가방의 일반 · 마법) */
export const BULK_SELL_RARITIES = Object.freeze(['normal', 'magic']);

/**
 * 일괄 판매 대상(§10.6) — 가방의 일반 · 마법 중 업그레이드(isUpgrade)가 아니고 잠기지 않은 것 → refs · 개수 · 합계 골드(priceSell)
 * @param {CharacterState|null} char @param {PlayerStats|null} stats
 * @returns {{refs:Array<{where:'bag', idx:number}>, count:number, gold:number}}
 */
export function bulkSellPlan(char, stats) {
  /** @type {Array<{where:'bag', idx:number}>} */
  const refs = [];
  let gold = 0;
  const bag = Array.isArray(char?.bag) ? char.bag : [];
  for (let i = 0; i < bag.length; i++) {
    const it = bag[i];
    if (!it || it.flags?.locked) continue;
    if (!BULK_SELL_RARITIES.includes(it.rarity)) continue;
    if (char && upgradeOf(stats, char, it)) continue;
    refs.push({ where: 'bag', idx: i });
    gold += priceSell(it);
  }
  return { refs, count: refs.length, gold };
}

/**
 * 「일반 등급 전부 분해」 대상 — 가방의 일반 등급 · 잠기지 않은 것
 * @param {CharacterState|null} char @returns {Array<{where:'bag', idx:number}>}
 */
export function salvageNormalRefs(char) {
  /** @type {Array<{where:'bag', idx:number}>} */
  const refs = [];
  const bag = Array.isArray(char?.bag) ? char.bag : [];
  for (let i = 0; i < bag.length; i++) {
    const it = bag[i];
    if (it && it.rarity === 'normal' && !it.flags?.locked) refs.push({ where: 'bag', idx: i });
  }
  return refs;
}

/**
 * 균열석 기본 포커스(§10.6 — Enter 한 번이 다음 판): last = records[0] · 없으면 1 · 완료 + 사망 0 → min(해금, last + 1) ·
 * 붕괴 또는 사망 ≥ 2 → max(1, last − 1) · 그 밖 last — 결과는 [1, 해금]
 * @param {CharacterState|null} char @returns {number}
 */
export function defaultRiftLevel(char) {
  const unlocked = Math.max(1, Math.floor(Number(char?.riftUnlocked)) || 1);
  const last = Array.isArray(char?.records) ? char.records[0] : null;
  let L = 1;
  if (last && Number.isFinite(last.level)) {
    const lv = Math.max(1, Math.floor(last.level));
    const deaths = Math.max(0, Math.floor(Number(last.deaths)) || 0);
    if (last.result === 'complete' && deaths === 0) L = lv + 1;
    else if (last.result === 'collapse' || deaths >= 2) L = lv - 1;
    else L = lv;
  }
  return Math.max(1, Math.min(unlocked, L));
}

/** 균열석 목록의 마지막 레벨(해금 + 3 · 표의 끝 RIFT.maxLevel) @param {CharacterState|null} char */
export function riftListMax(char) {
  const unlocked = Math.max(1, Math.floor(Number(char?.riftUnlocked)) || 1);
  return Math.max(1, Math.min(RIFT.maxLevel, unlocked + 3));
}

/**
 * 수리 미리보기(§10.6 · P6 repairAll 과 같은 순서) — 고칠 것 · 전체 비용 · 골드가 모자라면 주무기 → 갑옷 → 보조 → 나머지 순으로 살 수 있는 만큼.
 * @param {CharacterState|null} char
 * @returns {{nothing:boolean, full:number, canFull:boolean, partialCost:number, partialSlots:string[], damaged:string[]}}
 */
export function repairPlan(char) {
  /** @type {string[]} */
  const damaged = [];
  const eq = char?.equip ?? {};
  for (const s of EQUIP_SLOTS) {
    const it = /** @type {any} */ (eq)[s];
    if (it && it.dur < (it.durMax > 0 ? it.durMax : ITEM.durMax)) damaged.push(s);
  }
  const full = char ? repairCost(char) : 0;
  const gold = Math.max(0, Number(char?.gold) || 0);
  if (!damaged.length) return { nothing: true, full: 0, canFull: false, partialCost: 0, partialSlots: [], damaged };
  if (gold >= full) return { nothing: false, full, canFull: true, partialCost: full, partialSlots: damaged.slice(), damaged };
  const order = [...REPAIR_ORDER.filter((s) => damaged.includes(s)), ...damaged.filter((s) => !REPAIR_ORDER.includes(s))];
  let budget = gold;
  let cost = 0;
  /** @type {string[]} */
  const slots = [];
  for (const s of order) {
    const c = Math.round(itemRepairRaw(/** @type {any} */ (eq)[s]));
    if (c > budget) continue;
    budget -= c;
    cost += c;
    slots.push(s);
  }
  return { nothing: false, full, canFull: false, partialCost: cost, partialSlots: slots, damaged };
}

/**
 * 스킬 트리 배치(§10.6 — 3갈래 × 4단계) — 열 = 갈래, 각 열은 그 갈래 노드를 (단계 → 액티브 · 패시브 · 변형) 순으로 위에서 아래로.
 * 행 수 = 가장 긴 갈래 · 빈 자리는 null. 콘텐츠 ID 가 아니라 데이터 필드(branch · tier · kind)만 본다.
 * @param {string} cls @returns {{cols:number, rows:number, cells:Array<string|null>}}
 */
export function skillLayout(cls) {
  const nodes = nodesOf(cls);
  let cols = 0;
  for (const n of nodes) cols = Math.max(cols, (n.branch | 0) + 1);
  cols = Math.max(1, cols);
  const KIND = { active: 0, passive: 1, transform: 2 };
  /** @type {Array<Array<any>>} */
  const byBranch = Array.from({ length: cols }, () => []);
  nodes.forEach((n, i) => byBranch[n.branch | 0].push({ n, i }));
  for (const list of byBranch) {
    list.sort((a, b) => (a.n.tier - b.n.tier) || ((KIND[a.n.kind] ?? 3) - (KIND[b.n.kind] ?? 3)) || (a.i - b.i));
  }
  let rows = 0;
  for (const list of byBranch) rows = Math.max(rows, list.length);
  rows = Math.max(1, rows);
  /** @type {Array<string|null>} */
  const cells = new Array(cols * rows).fill(null);
  for (let c = 0; c < cols; c++) for (let r = 0; r < byBranch[c].length; r++) cells[r * cols + c] = byBranch[c][r].n.id;
  return { cols, rows, cells };
}

/** 단계 해금 점수(TREE.tierPoints) @param {number} tier 1.. */
export function tierPointsOf(tier) {
  return TREE.tierPoints[Math.max(0, (tier | 0) - 1)] ?? 0;
}

/** 패시브 스탯 키 → 같은 스탯을 올리는 아이템 옵션(문면 afx.<id>.line 재사용) */
const AFFIX_BY_STAT = /** @type {Record<string, string>} */ ({});
for (const id of Object.keys(ITEM_AFFIXES_BY_ID)) {
  const def = ITEM_AFFIXES_BY_ID[id];
  if (!def.param && !AFFIX_BY_STAT[def.stat]) AFFIX_BY_STAT[def.stat] = id;
}
/** 옵션 문면이 없는 패시브 스탯의 라벨(stat.<PlayerStats 키> — 퍼센트 숫자) */
const STAT_LABEL = /** @type {Record<string, string[]>} */ ({
  armorPct: ['stat.armor'], resPct: ['stat.res'], allPct: ['stat.dmgPct'], freezeAt: ['stat.freezeAtReduce'],
});

/**
 * 노드 수치 전 · 후(패시브 stats · 조건부 condStats — 퍼센트 숫자 · 랭크별 배열) → 줄
 * 옵션과 같은 스탯이면 afx.<id>.line({v}) · 아니면 라벨 + 값(%). rank 0 = 아직 없음.
 * @param {string} nodeId @param {number} rankBefore @param {number} rankAfter
 * @returns {Array<{key?:string, label?:string[], before:string, after:string, cond:boolean}>}
 */
export function nodeStatRows(nodeId, rankBefore, rankAfter) {
  const node = SKILL_NODES_BY_ID[nodeId];
  /** @type {Array<{key?:string, label?:string[], before:string, after:string, cond:boolean}>} */
  const out = [];
  if (!node) return out;
  /** @param {any} table @param {boolean} cond */
  const add = (table, cond) => {
    if (!table || typeof table !== 'object') return;
    for (const k of Object.keys(table)) {
      const arr = Array.isArray(table[k]) ? table[k] : [table[k]];
      const at = (r) => (r >= 1 ? Number(arr[Math.min(arr.length, r) - 1]) || 0 : 0);
      const fmt = (v) => (Math.round(v * 10) / 10).toString();
      const aff = AFFIX_BY_STAT[k];
      if (aff) out.push({ key: 'afx.' + aff + '.line', before: fmt(at(rankBefore)), after: fmt(at(rankAfter)), cond });
      else out.push({ label: STAT_LABEL[k] ?? ['stat.' + k], before: fmt(at(rankBefore)) + '%', after: fmt(at(rankAfter)) + '%', cond });
    }
  };
  add(node.stats, false);
  add(node.condStats, true);
  return out;
}

/** 소수 한 자리(끝 0 없이) @param {number} v */
const f1 = (v) => (Math.round(Number(v) * 10) / 10).toString();
/** 비율 → 퍼센트 숫자 @param {number} v */
const pct = (v) => f1(Number(v) * 100);

/**
 * describeSkill().extra 에서 보이는 수치(동작 params · 상태 · 변형 patch) — 랭크 효과가 피해 · 비용 · 재사용에 없는 노드(변형 6 · 전투 함성 · 마력 보호막 …)도
 * 찍기 전 · 후가 숫자로 달라지게(리뷰 수정 — 브리프 §3.3). get 이 undefined 면 그 줄이 없다(그 쪽은 「—」).
 * @type {Array<{key:string, get:(x:any) => any, p:(v:any, x:any) => Object, more:boolean}>}
 */
const EXTRA_ROWS = [
  { key: 'skill.x.armorBuff', get: (x) => (x.buffSec !== undefined ? x.value : undefined), p: (v) => ({ v: pct(v) }), more: true },
  { key: 'skill.x.buffSec', get: (x) => x.buffSec, p: (v) => ({ v: f1(v) }), more: true },
  { key: 'skill.x.absorb', get: (x) => x.absorbPct, p: (v, x) => ({ v: pct(v), n: Math.round(Number(x.absorb) || 0) }), more: true },
  { key: 'skill.x.shieldSec', get: (x) => (x.absorbPct !== undefined ? x.dur : undefined), p: (v) => ({ v: f1(v) }), more: true },
  { key: 'skill.x.burn', get: (x) => x.burn?.coefPerSec, p: (v, x) => ({ v: pct(v), s: f1(x.burn?.dur ?? 0) }), more: true },
  { key: 'skill.x.bounces', get: (x) => x.bounces, p: (v) => ({ v: f1(v) }), more: true },
  { key: 'skill.x.stun', get: (x) => x.stun, p: (v) => ({ v: f1(v) }), more: true },
  { key: 'skill.x.chill', get: (x) => x.chill, p: (v) => ({ v: f1(v) }), more: true },
  { key: 'skill.x.shock', get: (x) => x.shockChance, p: (v) => ({ v: pct(v) }), more: true },
  { key: 'skill.x.aftershock', get: (x) => x.aftershock?.mul, p: (v, x) => ({ v: pct(v), s: f1(x.aftershock?.delay ?? 0) }), more: true },
  { key: 'skill.x.healPerTarget', get: (x) => x.healPerTarget, p: (v, x) => ({ v: pct(v), n: Number(x.healTargetsCap) || 0 }), more: true },
  { key: 'skill.x.landStun', get: (x) => x.landStun, p: (v) => ({ v: f1(v) }), more: true },
  { key: 'skill.x.split', get: (x) => x.split?.mul, p: (v, x) => ({ n: Number(x.split?.n) || 0, v: pct(v) }), more: true },
  { key: 'skill.x.shards', get: (x) => x.shards?.mul, p: (v, x) => ({ n: Number(x.shards?.n) || 0, v: pct(v), c: f1(x.shards?.chill ?? 0) }), more: true },
  { key: 'skill.x.blast', get: (x) => x.blast?.coef, p: (v, x) => ({ v: pct(v), r: f1(x.blast?.r ?? 0) }), more: true },
];

/** 스킬 수치 줄의 문자열 키(라벨 key · 값 key + '.v') — 테스트가 다 있는지 본다 */
export const SKILL_EXTRA_KEYS = EXTRA_ROWS.flatMap((r) => [r.key, r.key + '.v']);

/**
 * 찍기 전 · 후 describeSkill 결과 둘(없으면 null) → 동작 수치 줄(라벨 t(key) · 값 t(key + '.v', 전/후)). 값이 한쪽에만 있으면 다른 쪽은 null(「—」).
 * @param {{extra?:any}|null} a @param {{extra?:any}|null} b
 * @returns {Array<{key:string, before:Object|null, after:Object|null, dir:number}>} dir 1 = 오름(좋음) · 0 = 같음/모름
 */
export function skillExtraRows(a, b) {
  const xa = a?.extra ?? null, xb = b?.extra ?? null;
  /** @type {Array<{key:string, before:Object|null, after:Object|null, dir:number}>} */
  const out = [];
  for (const row of EXTRA_ROWS) {
    const va = xa ? row.get(xa) : undefined;
    const vb = xb ? row.get(xb) : undefined;
    const ha = typeof va === 'number' && Number.isFinite(va), hb = typeof vb === 'number' && Number.isFinite(vb);
    if (!ha && !hb) continue;
    const before = ha ? row.p(va, xa) : null;
    const after = hb ? row.p(vb, xb) : null;
    const d = ha && hb ? Math.sign(Math.round((vb - va) * 1000)) : hb && !ha && xa ? 1 : 0;
    out.push({ key: row.key, before, after, dir: d === 0 ? 0 : (d > 0) === row.more ? 1 : -1 });
  }
  return out;
}

/**
 * 제작 결과 분포(§10.6) — 옵션 수 affixCountDist('rare') · 옵션 티어 tierDist(PL) · 그 부위 기본형 단계 baseTierDist(PL)(단계마다 그 부위 · 클래스 기본형 이름)
 * @param {CharacterState|null} char @param {string} slot
 * @returns {{ilvl:number, count:Array<[number, number]>, tiers:number[], baseTiers:Array<{tier:number, p:number, names:string[]}>}}
 */
export function craftDist(char, slot) {
  const ilvl = Math.max(1, Math.floor(Number(char?.riftUnlocked)) || 1);
  const cd = affixCountDist('rare');
  const count = /** @type {Array<[number, number]>} */ (Object.keys(cd).map((k) => [Number(k), cd[/** @type {any} */ (k)]]).sort((a, b) => a[0] - b[0]));
  const tiers = tierDist(ilvl);
  const bt = baseTierDist(ilvl);
  const cls = char?.cls ?? null;
  const bases = ITEM_SLOTS.includes(slot) ? basesFor(slot, cls).filter((b) => !b.cls || b.cls === cls) : [];
  /** @type {Array<{tier:number, p:number, names:string[]}>} */
  const baseTiers = [];
  for (let i = 0; i < bt.length; i++) {
    if (!(bt[i] > 0)) continue;
    baseTiers.push({ tier: i, p: bt[i], names: bases.map((b) => 'base.' + b.id + '.' + i) });
  }
  return { ilvl, count, tiers, baseTiers };
}

/**
 * 남은 전리품(§10.2 균열석 — 줍지 않은 희귀 이상 장비 수)
 * @param {import('../types.js').GameState|null} state @returns {number}
 */
export function leftLootCount(state) {
  const drops = state?.rift?.drops;
  if (!Array.isArray(drops)) return 0;
  let n = 0;
  for (const d of drops) {
    if (!d || d.gone || d.kind !== 'item') continue;
    const r = d.rarity ?? d.item?.rarity;
    if (r === 'rare' || r === 'legendary' || r === 'set') n++;
  }
  return n;
}

/**
 * 균열석에서 새 균열을 열 때 확인이 필요한가 — 열린 균열이 진행 중(active · guardian)일 때만(완료 · 붕괴는 조용히 닫는다)
 * @param {import('../types.js').GameState|null} state
 */
export function needsCloseConfirm(state) {
  const ph = state?.rift?.phase;
  return ph === 'active' || ph === 'guardian';
}

/**
 * 신비술사가 다룰 수 있는 장착 아이템(옵션이 있는 것) — 칸 순서
 * @param {CharacterState|null} char @returns {Array<{slot:string, item:Item}>}
 */
export function mysticEquipList(char) {
  /** @type {Array<{slot:string, item:Item}>} */
  const out = [];
  const eq = char?.equip ?? {};
  for (const s of EQUIP_SLOTS) {
    const it = /** @type {any} */ (eq)[s];
    if (it && Array.isArray(it.affixes) && it.affixes.length) out.push({ slot: s, item: it });
  }
  return out;
}

/**
 * 가방 칸 이름표 — 기본형 단계 이름의 마지막 낱말(「낡은 검」 → 키 · 낱말 위치는 화면이 고른다)
 * @param {Item|null} item @returns {string|null} 기본형 이름 키
 */
export function baseNameKey(item) {
  if (!item || !BASES_BY_ID[item.baseId]) return null;
  return 'base.' + item.baseId + '.' + (item.tier | 0);
}

/**
 * 균열 완료 패널의 배지(§10.6 — 다음 레벨 해금 · 무사망 +2) — 이번 판이 해금을 실제로 올렸을 때만.
 * 요약의 unlockedTo = max(지금, min(maxLevel, L + 몫))이라 같은 레벨을 되풀이하면 「이미 열린 값」도 L + 1 ~ L + 2 안에 든다(리뷰 수정).
 * @param {{level:number, unlockedTo:number, noDeath:boolean}} s RunSummary
 * @param {number|null} from 균열을 열 때의 char.riftUnlocked(모르면 null — 옛 식: 범위만 본다)
 * @returns {{raised:boolean, bonus:boolean}} bonus = 무사망 +2 가 사망이 있었을 때(+1)보다 더 열었다
 */
export function completeBadges(s, from) {
  if (!s) return { raised: false, bonus: false };
  const L = Math.max(1, Math.floor(Number(s.level)) || 1);
  const to = Math.floor(Number(s.unlockedTo)) || 1;
  const known = typeof from === 'number' && Number.isFinite(from);
  const raised = known ? to > from : to >= L + RIFT.unlockClear && to <= L + (s.noDeath ? RIFT.unlockNoDeath : RIFT.unlockClear);
  const withoutBonus = Math.min(RIFT.maxLevel, known ? Math.max(/** @type {number} */ (from), L + RIFT.unlockClear) : L + RIFT.unlockClear);
  return { raised, bonus: raised && !!s.noDeath && to > withoutBonus };
}

/**
 * 붕괴 패널의 「잃은 것」 해금 — 이 판을 깼다면 새로 열렸을 단계 수(이미 열려 있으면 0)
 * @param {number} level 균열 레벨 @param {number} deaths 이번 판 사망 @param {number} riftUnlocked 지금 해금
 */
export function lostUnlock(level, deaths, riftUnlocked) {
  const L = Math.max(1, Math.floor(Number(level)) || 1);
  const gain = Number(deaths) === 0 ? RIFT.unlockNoDeath : RIFT.unlockClear;
  return Math.max(0, Math.min(RIFT.maxLevel, L + gain) - Math.max(1, Math.floor(Number(riftUnlocked)) || 1));
}
