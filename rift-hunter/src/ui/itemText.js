// OWNER: P11 — 계약 §10.6(툴팁) · §12.2(ui.panels.test — 순수 함수)
// 아이템 툴팁 줄 · 고급 툴팁(옵션마다 티어 · 값 범위) · 장착 중인 것과의 비교 줄(변화 방향 녹/적). 순수 — DOM 없음(Node 테스트가 import 한다).
// 줄은 문면이 아니라 「키 + 값」이다 — 화면 문면은 lineText(line) 하나로 만든다(t() · 문면은 strings.ko.js 한 파일).

import { DMG_TYPES } from '../core/constants.js';
import { roundTo } from '../core/math.js';
import { BASES_BY_ID, ITEM_AFFIXES_BY_ID, LEGENDARIES_BY_ID, SETS_BY_ID, SET_PIECES_BY_ID } from '../data/index.js';
import { ITEM } from '../data/items.js';
import { GROWTH } from '../data/rift.js';
import { priceSell } from '../sim/progression/shops.js';
import { fmtDps, fmtInt, fmtNum, fmtPct } from './format.js';
import { t, tName } from './i18n.js';

/** @typedef {import('../types.js').Item} Item */
/** @typedef {import('../types.js').CharacterState} CharacterState */

/**
 * 툴팁 한 줄.
 *  kind: name(이름 — keys) · sub(등급 · 부위 · 클래스 — parts) · base(기본형) · stat(기본 값 — key+params 또는 label+value) · affix · legend · set · setBonus ·
 *        class · req · dur · durZero · price · locked
 * @typedef {Object} TipLine
 * @property {string} kind
 * @property {string} [key]          문자열 키(params 로 치환)
 * @property {Record<string, string|number>} [params]
 * @property {Record<string, string>} [pkeys]   params 중 문자열 키인 것(lineText 가 t()로 바꾼다 — 예: skillDmg 의 {skill})
 * @property {string[]} [keys]        이름 키 배열(tName)
 * @property {string[]} [parts]       ' · '로 잇는 키 목록
 * @property {string[]} [label]       공백으로 잇는 라벨 키 · 뒤에 value
 * @property {string} [value]
 * @property {string} [cls]           CSS 클래스(r-<rarity> · bad · on · off · locked)
 * @property {boolean} [bad]          못 쓴다(붉게)
 * @property {{t:number, a:string, b:string}} [adv]   고급 툴팁: 티어 · 값 범위(표시용 문자열)
 * @property {boolean} [fixed]        신비술사가 고정한 옵션
 */

/**
 * 옵션 하나의 그 아이템 ilvl 에서의 값 범위 — pow 옵션은 GROWTH.item^(ilvl−1)을 곱하고 decimals 로 반올림(affixValue 와 같은 식)
 * @param {string} affixId @param {number} tier 1..5 @param {number} ilvl @returns {[number, number]|null}
 */
export function affixRange(affixId, tier, ilvl) {
  const def = ITEM_AFFIXES_BY_ID[affixId];
  if (!def) return null;
  const tt = Math.max(1, Math.min(def.tiers.length, Math.floor(Number(tier)) || 1));
  const [lo, hi] = def.tiers[tt - 1];
  const lv = Math.max(1, Math.floor(Number(ilvl)) || 1);
  const k = def.scale === 'pow' ? GROWTH.item ** (lv - 1) : 1;
  const d = def.decimals ?? 0;
  return [roundTo(lo * k, d), roundTo(hi * k, d)];
}

/**
 * 옵션 한 줄(툴팁 · 신비술사 후보가 같이 쓴다)
 * @param {{id:string, tier:number, value:number, param?:string}} a @param {number} ilvl @param {{advanced?:boolean}} [opts] @returns {TipLine}
 */
export function affixLine(a, ilvl, opts = {}) {
  const def = ITEM_AFFIXES_BY_ID[a?.id];
  if (!def) return { kind: 'affix', key: 'reason.invalid' };
  const d = def.decimals ?? 0;
  /** @type {TipLine} */
  const line = { kind: 'affix', key: 'afx.' + def.id + '.line', params: { v: fmtNum(Number(a.value) || 0, d) } };
  if (def.param && a.param) {
    line.params = { ...line.params, skill: '' };
    line.pkeys = { skill: 'node.' + a.param + '.name' };
  }
  if (opts.advanced) {
    const r = affixRange(def.id, a.tier, ilvl);
    if (r) line.adv = { t: a.tier, a: fmtNum(r[0], d), b: fmtNum(r[1], d) };
  }
  return line;
}

/** 그 아이템의 이름 키가 기본형 이름을 이미 담고 있나(일반 · 마법) @param {Item} item */
function nameHasBase(item) {
  const k = 'base.' + item.baseId + '.' + item.tier;
  return Array.isArray(item.name) && item.name.includes(k);
}

/**
 * 아이템 툴팁 줄(§10.6) — 이름(등급색) · 등급 · 부위 · 기본형(단계) · 기본 값(피해 · aps · 방어도 · 막기 · 추가 피해 · 마나) · 옵션(고급이면 티어 · 범위) ·
 * 전설 효과 · 세트 이름(낀 조각 수) · 세트 효과 · 클래스 · 요구 레벨(못 끼면 bad) · 내구도(0이면 능력치 꺼짐) · 판매가 · 잠김.
 * @param {Item} item
 * @param {{advanced?:boolean, char?:CharacterState|null, setCounts?:Record<string, number>|null, price?:{key:string, n:number, pkeys?:Record<string, string>}|null, noPrice?:boolean}} [opts]
 *   price = 판매가 대신 보일 값(상점 · 되사기 — 예 {key:'shop.gambleSlotPrice', n, pkeys:{slot:'shop.buy'}} → 「사기 — n 골드」)
 * @returns {TipLine[]}
 */
export function itemLines(item, opts = {}) {
  /** @type {TipLine[]} */
  const out = [];
  if (!item || typeof item !== 'object') return out;
  const base = BASES_BY_ID[item.baseId];
  const rarity = typeof item.rarity === 'string' ? item.rarity : 'normal';
  const char = opts.char ?? null;
  const keys = Array.isArray(item.name) && item.name.length ? item.name : base ? ['base.' + item.baseId + '.' + (item.tier | 0)] : [];
  out.push({ kind: 'name', keys, cls: 'r-' + rarity });
  const parts = ['rarity.' + rarity, 'islot.' + item.slot];
  out.push({ kind: 'sub', parts, cls: 'dim' });
  if (base && !nameHasBase(item)) out.push({ kind: 'base', key: 'base.' + item.baseId + '.' + (item.tier | 0), cls: 'dim' });

  // 기본 값
  const b = item.base ?? {};
  if (Array.isArray(b.dmg)) out.push({ kind: 'stat', key: 'skill.dmg', params: { a: fmtInt(b.dmg[0]), b: fmtInt(b.dmg[1]) } });
  if (Number.isFinite(b.aps)) out.push({ kind: 'stat', label: ['stat.aps'], value: fmtNum(/** @type {number} */ (b.aps), 2) });
  if (Number.isFinite(b.armor)) out.push({ kind: 'stat', label: ['stat.armor'], value: fmtInt(/** @type {number} */ (b.armor)) });
  if (Number.isFinite(b.block) && /** @type {number} */ (b.block) > 0) out.push({ kind: 'stat', label: ['stat.block'], value: fmtPct(/** @type {number} */ (b.block), 0) });
  if (Array.isArray(b.bonus)) out.push({ kind: 'stat', label: ['stat.weapon'], value: '+' + fmtInt(b.bonus[0]) + '–' + fmtInt(b.bonus[1]) });
  if (Number.isFinite(b.mana) && /** @type {number} */ (b.mana) > 0) out.push({ kind: 'stat', label: ['res.mana'], value: '+' + fmtInt(/** @type {number} */ (b.mana)) });

  // 옵션
  const affixes = Array.isArray(item.affixes) ? item.affixes : [];
  for (let i = 0; i < affixes.length; i++) {
    const line = affixLine(affixes[i], item.ilvl, opts);
    if (item.rerollIdx === i) line.fixed = true;
    out.push(line);
  }

  // 전설 · 세트
  if (item.legendaryId && LEGENDARIES_BY_ID[item.legendaryId]) out.push({ kind: 'legend', key: 'legfx.' + item.legendaryId, cls: 'r-legendary' });
  const piece = item.setPieceId ? SET_PIECES_BY_ID[item.setPieceId] : null;
  const set = piece ? SETS_BY_ID[piece.setId] : null;
  if (set) {
    const n = Math.max(0, Math.floor(Number(opts.setCounts?.[set.id]) || 0));
    out.push({ kind: 'set', label: ['set.' + set.id], value: t('inv.setCount', { n }), cls: 'r-set' });
    out.push({ kind: 'setBonus', key: 'set.' + set.id + '.b2', cls: n >= 2 ? 'on' : 'off' });
    out.push({ kind: 'setBonus', key: 'set.' + set.id + '.b4', cls: n >= 4 ? 'on' : 'off' });
  }

  // 클래스 · 요구 레벨
  if (item.cls) {
    const bad = !!char && char.cls !== item.cls;
    out.push({ kind: 'class', key: 'class.' + item.cls, bad, cls: bad ? 'bad' : 'dim' });
  }
  const req = Math.max(1, Math.floor(Number(item.reqLevel)) || 1);
  const reqBad = !!char && (Number(char.level) || 1) < req;
  out.push({ kind: 'req', key: 'inv.req', params: { n: req }, bad: reqBad, cls: reqBad ? 'bad' : 'dim' });

  // 내구도
  const durMax = Number(item.durMax) > 0 ? Number(item.durMax) : ITEM.durMax;
  const dur = Number.isFinite(item.dur) ? Math.max(0, item.dur) : durMax;
  if (dur <= 0) out.push({ kind: 'durZero', key: 'inv.durZero', bad: true, cls: 'bad' });
  else if (dur < durMax) out.push({ kind: 'dur', key: 'inv.dur', params: { n: fmtInt(dur), m: fmtInt(durMax) }, cls: 'dim' });

  // 가격 · 잠김
  if (!opts.noPrice) {
    if (opts.price) out.push({ kind: 'price', key: opts.price.key, params: { slot: '', n: fmtInt(opts.price.n) }, pkeys: opts.price.pkeys, cls: 'price' });
    else out.push({ kind: 'price', key: 'inv.sellPrice', params: { n: fmtInt(priceSell(item)) }, cls: 'price' });
  }
  if (item.flags?.locked) out.push({ kind: 'locked', key: 'inv.locked', cls: 'locked' });
  return out;
}

/**
 * 줄 → 화면 문면(고급 범위는 「[티어 3 16–25]」를 뒤에 붙인다)
 * @param {TipLine} line @returns {string}
 */
export function lineText(line) {
  if (!line) return '';
  let s = '';
  if (line.keys) s = tName(line.keys);
  else if (line.parts) s = line.parts.map((k) => t(k)).join(' · ');
  else if (line.label) s = line.label.map((k) => t(k)).join(' ') + (line.value !== undefined ? ' ' + line.value : '');
  else if (line.key) {
    let params = line.params;
    if (line.pkeys) {
      params = { ...(params ?? {}) };
      for (const k of Object.keys(line.pkeys)) params[k] = t(line.pkeys[k]);
    }
    s = t(line.key, params);
  }
  if (line.adv) s += ' [' + t('inv.tier', { t: line.adv.t }) + ' ' + t('inv.range', { a: line.adv.a, b: line.adv.b }) + ']';
  return s;
}

/** 비교 줄 하나의 꼴 */
const CMP_ROWS = [
  { id: 'sheetDps', label: ['stat.sheetDps'], d: 1 },
  { id: 'lifeMax', label: ['stat.lifeMax'], d: 0 },
  { id: 'armor', label: ['stat.armor'], d: 0 },
  ...DMG_TYPES.map((ty) => ({ id: 'res.' + ty, label: ['dmg.' + ty, 'stat.res'], d: 0 })),
];

/** 숫자 → 표시(소수 d 자리 · DPS 는 fmtDps) @param {string} id @param {number} v @param {number} d */
function fmtCmp(id, v, d) {
  if (id === 'sheetDps') return fmtDps(v);
  return d > 0 ? fmtNum(v, d) : fmtInt(v);
}

/** 부호 붙인 변화 @param {number} v @param {number} d */
function fmtDelta(v, d) {
  const r = roundTo(v, d);
  if (r === 0) return '0';
  const body = d > 0 ? fmtNum(Math.abs(r), d) : fmtInt(Math.abs(r));
  return (r > 0 ? '+' : '−') + body;
}

/**
 * 장착 중인 것과의 비교 줄(§10.6) — 시트 DPS · 생명 · 방어도 · 저항 넷. dir = 표시 자리수로 반올림한 변화의 부호(오름 1 녹 · 내림 −1 적 · 0).
 * 끼울 수 없으면(class · level · slot) 맨 앞에 사유 줄(kind 'reason' · dir −1). compare = compareEquip 결과(§6.10).
 * @param {any} compare @param {Item|null} [item] 사유 줄의 params(요구 레벨)
 * @returns {Array<{key:string, params?:Record<string, string|number>, dir:-1|0|1, kind:string, label?:string[], before?:string, after?:string, delta?:string, zero?:boolean}>}
 */
export function compareLines(compare, item = null) {
  /** @type {Array<any>} */
  const out = [];
  if (!compare || !compare.before || !compare.after) return out;
  if (!compare.ok && compare.reason) {
    const params = compare.reason === 'level' ? { n: Math.max(1, Math.floor(Number(item?.reqLevel)) || 1) } : undefined;
    out.push({ kind: 'reason', key: 'reason.' + compare.reason, params, dir: -1 });
  }
  const B = compare.before;
  const A = compare.after;
  for (const row of CMP_ROWS) {
    const isRes = row.id.startsWith('res.');
    const ty = isRes ? row.id.slice(4) : '';
    const bv = Number(isRes ? B.res?.[ty] : B[row.id]) || 0;
    const av = Number(isRes ? A.res?.[ty] : A[row.id]) || 0;
    const dv = av - bv;
    const r = roundTo(dv, row.d);
    const dir = /** @type {-1|0|1} */ (r > 0 ? 1 : r < 0 ? -1 : 0);
    const before = fmtCmp(row.id, bv, row.d);
    const after = fmtCmp(row.id, av, row.d);
    out.push({
      kind: 'delta', key: row.label[row.label.length - 1], label: row.label, dir,
      before, after, delta: fmtDelta(dv, row.d),
      params: { before, after, delta: fmtDelta(dv, row.d) },
      zero: isRes && roundTo(bv, 0) === 0 && roundTo(av, 0) === 0,
    });
  }
  return out;
}

/** 비교 줄의 라벨 문면 @param {{label?:string[], key:string, params?:any}} line */
export function compareLabel(line) {
  return line.label ? line.label.map((k) => t(k)).join(' ') : t(line.key, line.params);
}
