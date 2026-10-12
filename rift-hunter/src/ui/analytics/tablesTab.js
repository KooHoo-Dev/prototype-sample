// OWNER: P12 — 계약 §10.9(표 보기) · 브리프 §3.9
// 표 보기 탭 — src/data 의 표를 가공 없이 그대로 보인다(열 이름 = 데이터 필드 이름 · 값 = 데이터 값). 정렬 가능 열.
// 계산해서 덧붙인 열은 셋뿐이고 이름에 식을 적는다: 균열 곡선의 earlyHpMul(L) · earlyDmgMul(L)(data/rift.js 의 함수 — 밸런스 게이트가 생명 경사를 더했다) · GROWTH.item^(L−1)(아이템 위력 — §7.3 표).
// buildTable(id, t) 는 순수(DOM 없음) — 테스트가 표 값과 데이터를 대조한다. DOM 은 createTablesTab 안에서만.

import { CLASSES } from '../../data/classes.js';
import { BLP, GOLD, GUARANTEE, MATERIAL_DROP, MF, RARITY, TREASURE } from '../../data/drops.js';
import { CRAFT, ECON, GAMBLE, PRICES, REROLL, SALVAGE, SHOP, START, XP } from '../../data/economy.js';
import { GUARDIANS } from '../../data/guardians.js';
import { AFFIX_TIERS, ITEM_AFFIXES } from '../../data/itemAffixes.js';
import { BASE_TIERS, ITEM, SLOT_WEIGHTS } from '../../data/items.js';
import { KEYBINDS } from '../../data/keybinds.js';
import { MON_AFFIXES } from '../../data/monsterAffixes.js';
import { MON, MONSTERS, RANKS } from '../../data/monsters.js';
import { GROWTH, RIFT, RIFT_LEVELS, earlyDmgMul, earlyHpMul } from '../../data/rift.js';
import { BASIC_SKILLS, SKILL_NODES, TREE } from '../../data/skills.js';
import { DMG_TYPES, RARITIES } from '../../core/constants.js';

/** 표 목록(왼쪽 목록 순서) */
export const TABLE_IDS = Object.freeze(['rift', 'rarity', 'affixes', 'monAffixes', 'monsters', 'ranks', 'skills', 'treasure', 'economy']);

/**
 * @typedef {Object} TableCol
 * @property {string} key      필드 이름(머리줄에 그대로)
 * @property {boolean} [num]   숫자 열(오른쪽 정렬 · 수로 정렬)
 * @property {string} [cls]    칸 클래스
 */
/**
 * @typedef {Object} TableSpec
 * @property {string} id @property {string} titleKey @property {string} src   데이터 출처(파일 · 이름)
 * @property {TableCol[]} cols
 * @property {Array<{values:unknown[], cls?:Array<string|undefined>, rowCls?:string}>} rows   cls = 칸별 클래스 · rowCls = 줄 클래스
 * @property {string[]} notes   표 아래 줄 — 같은 파일의 스칼라 상수(이름 = 값)
 */

/**
 * 데이터 값 → 문면. 정수는 그대로 · 소수는 셋째 자리까지(0.01 미만은 유효 숫자 셋) · 배열 [a, b] · 객체 {k: v} · 참/거짓 true/false · 없음 —
 * @param {unknown} v @returns {string}
 */
export function rawText(v) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return Number.isNaN(v) ? 'NaN' : v > 0 ? '∞' : '-∞';
    if (Number.isInteger(v)) return String(v);
    const r = Math.abs(v) >= 0.01 ? Number(v.toFixed(3)) : Number(v.toPrecision(3));
    return String(r);
  }
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return '[' + v.map(rawText).join(', ') + ']';
  if (typeof v === 'object') {
    const parts = [];
    for (const k of Object.keys(/** @type {object} */ (v))) parts.push(k + ': ' + rawText(/** @type {any} */ (v)[k]));
    return '{' + parts.join(', ') + '}';
  }
  return String(v);
}

/** 이름 = 값 줄 @param {string} name @param {unknown} v */
function note(name, v) {
  return name + ' = ' + rawText(v);
}

/** [a, b] → 'a–b' @param {unknown} r */
function rangeText(r) {
  return Array.isArray(r) && r.length === 2 ? rawText(r[0]) + '–' + rawText(r[1]) : rawText(r);
}

/** 공격 하나의 짧은 꼴(id kind 예비/후딜 cd ×배율 종류) @param {any} a */
function attackText(a) {
  return `${a.id} ${a.kind} ${rawText(a.windup)}/${rawText(a.recover)} cd${rawText(a.cd)} ×${rawText(a.mul)} ${a.type}`;
}

/** 객체를 '이름.키 = 값' 줄들로(한 단계) @param {string} name @param {Record<string, unknown>} obj @param {Array<[string, unknown]>} out */
function flatPairs(name, obj, out) {
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) flatPairs(name + '.' + k, /** @type {Record<string, unknown>} */ (v), out);
    else out.push([name + '.' + k, v]);
  }
}

/**
 * 표 하나를 만든다(순수 — 값은 데이터 그대로).
 * @param {string} id @param {(key:string, params?:any) => string} t @returns {TableSpec}
 */
export function buildTable(id, t) {
  switch (id) {
    case 'rift': {
      const cols = ['level', 'monLevel', 'ilvl', 'hpMul', 'earlyHpMul(L)', 'dmgMul', 'earlyDmgMul(L)', 'goldMul', 'xpMul', 'GROWTH.item^(L−1)',
        'rarityMul.magic', 'rarityMul.rare', 'rarityMul.legendary', 'rarityMul.set',
        'champAffixes', 'eliteAffixes', 'guardianAffixes', 'championPacks', 'elitePacks'].map((key) => ({ key, num: true }));
      const rows = RIFT_LEVELS.map((r) => ({
        values: [r.level, r.monLevel, r.ilvl, r.hpMul, earlyHpMul(r.level), r.dmgMul, earlyDmgMul(r.level), r.goldMul, r.xpMul, GROWTH.item ** (r.level - 1),
          r.rarityMul.magic, r.rarityMul.rare, r.rarityMul.legendary, r.rarityMul.set,
          r.champAffixes, r.eliteAffixes, r.guardianAffixes, r.championPacks, r.elitePacks],
        rowCls: r.level > GROWTH.lateFrom ? 'an-late' : undefined,
      }));
      return {
        id, titleKey: 'analytics.tbl.rift', src: 'src/data/rift.js · RIFT_LEVELS = riftRow(1..30)', cols, rows,
        notes: [note('GROWTH', GROWTH), note('RIFT.earlyDmg', RIFT.earlyDmg), note('RIFT.maxLevel', RIFT.maxLevel),
          note('RIFT.unlockClear', RIFT.unlockClear), note('RIFT.unlockNoDeath', RIFT.unlockNoDeath), note('RIFT.lives', RIFT.lives)],
      };
    }
    case 'rarity': {
      const cols = [{ key: 'row' }, ...RARITIES.map((r) => ({ key: r, num: true, cls: 'r-' + r }))];
      /** @param {string} name @param {Record<string, number>|undefined} obj */
      const row = (name, obj) => ({ values: [name, ...RARITIES.map((r) => (obj && r in obj ? obj[r] : null))] });
      const rows = [row('RARITY.base', RARITY.base)];
      for (const k of Object.keys(RARITY.rank)) rows.push(row('RARITY.rank.' + k, /** @type {any} */ (RARITY.rank)[k]));
      rows.push(row('GUARANTEE', GUARANTEE), row('MF.scale', MF.scale), row('RARITY.value', RARITY.value));
      return {
        id, titleKey: 'analytics.tbl.rarity', src: 'src/data/drops.js · RARITY · GUARANTEE · MF · BLP', cols, rows,
        notes: [note('MF.k', MF.k), note('BLP', BLP), note('GOLD', GOLD), note('MATERIAL_DROP', MATERIAL_DROP)],
      };
    }
    case 'affixes': {
      const tierCols = AFFIX_TIERS.minIlvl.map((lv, i) => ({ key: `T${i + 1} (ilvl ${lv} · w ${AFFIX_TIERS.weight[i]})`, num: false }));
      const cols = [{ key: 'id' }, { key: 'line' }, { key: 'kind' }, { key: 'stat' }, { key: 'slots' }, { key: 'weight', num: true },
        { key: 'scale' }, { key: 'main' }, { key: 'decimals', num: true }, ...tierCols];
      const rows = ITEM_AFFIXES.map((a) => ({
        values: [a.id, t('afx.' + a.id + '.line', { v: '#', skill: '…' }), a.kind, a.stat, a.slots.join(' '), a.weight, a.scale,
          /** @type {any} */ (a).main ?? null, a.decimals, ...a.tiers.map(rangeText)],
      }));
      return {
        id, titleKey: 'analytics.tbl.affixes', src: 'src/data/itemAffixes.js · ITEM_AFFIXES · AFFIX_TIERS · src/data/items.js', cols, rows,
        notes: [note('AFFIX_TIERS', AFFIX_TIERS), note('ITEM.affixCount', ITEM.affixCount), note('ITEM.maxPrefix', ITEM.maxPrefix),
          note('ITEM.maxSuffix', ITEM.maxSuffix), note('ITEM.setAffixes', ITEM.setAffixes), note('SLOT_WEIGHTS', SLOT_WEIGHTS),
          note('BASE_TIERS', BASE_TIERS), note('ITEM.ownClassChance', ITEM.ownClassChance), note('ITEM.otherClassLegend', ITEM.otherClassLegend),
          note('ITEM.ownSetChance', ITEM.ownSetChance)],
      };
    }
    case 'monAffixes': {
      const cols = [{ key: 'id' }, { key: 'name' }, { key: 'weight', num: true }, { key: 'minLevel', num: true }, { key: 'hazard' },
        { key: 'minionShare' }, { key: 'excludeTags' }, { key: 'excludeAffixes' }, { key: 'mods' }, { key: 'params' }];
      const rows = MON_AFFIXES.map((a) => ({
        values: [a.id, t('affix.' + a.id + '.name'), a.weight, a.minLevel, a.hazard, a.minionShare, a.excludeTags, a.excludeAffixes, a.mods, a.params],
      }));
      return { id, titleKey: 'analytics.tbl.monAffixes', src: 'src/data/monsterAffixes.js · MON_AFFIXES', cols, rows, notes: [] };
    }
    case 'monsters': {
      const cols = [{ key: 'id' }, { key: 'name' }, { key: 'template' }, { key: 'behavior' }, { key: 'tags' },
        { key: 'hp', num: true }, { key: 'dmg', num: true }, { key: 'xp', num: true }, { key: 'gauge', num: true }, { key: 'speed', num: true },
        { key: 'radius', num: true }, { key: 'aggro', num: true },
        // 저항 열 = 데이터 필드 경로 res.<DmgType>(문자열 키가 아니다 — 피해 종류 목록에서 만든다)
        ...DMG_TYPES.map((d) => ({ key: ['res', d].join('.'), num: true })), { key: 'eliteOk' }, { key: 'attacks' }];
      const all = [...MONSTERS, ...GUARDIANS];
      const rows = all.map((m) => ({
        values: [m.id, t('mon.' + m.id), m.template, m.behavior, m.tags.join(' '), m.hp, m.dmg, m.xp, m.gauge, m.speed, m.radius, m.aggro,
          ...DMG_TYPES.map((d) => m.res[d]), m.eliteOk, m.attacks.map(attackText).join(' · ')],
      }));
      return {
        id, titleKey: 'analytics.tbl.monsters', src: 'src/data/monsters.js · MONSTERS · src/data/guardians.js · GUARDIANS', cols, rows,
        notes: [note('MON.hpBase', MON.hpBase), note('MON.dmgBase', MON.dmgBase), note('MON.linkRadius', MON.linkRadius),
          note('MON.linkMinDepth', MON.linkMinDepth), note('MON.maxAwake', MON.maxAwake), note('MON.targetingRange', MON.targetingRange)],
      };
    }
    case 'ranks': {
      const cols = [{ key: 'id' }, { key: 'name' }, { key: 'hp', num: true }, { key: 'dmg', num: true }, { key: 'xp', num: true },
        { key: 'gauge', num: true }, { key: 'tc' }, { key: 'scale', num: true }, { key: 'stunMul', num: true }, { key: 'freezeMul', num: true },
        { key: 'knockMul', num: true }, { key: 'flinchFrac', num: true }];
      const rows = RANKS.map((r) => ({
        values: [r.id, t('rank.' + r.id), r.hp, r.dmg, r.xp, r.gauge, r.tc, r.scale, r.stunMul, r.freezeMul, r.knockMul, r.flinchFrac],
        cls: [undefined, 'rank-' + r.id],
      }));
      return { id, titleKey: 'analytics.tbl.ranks', src: 'src/data/monsters.js · RANKS', cols, rows, notes: [] };
    }
    case 'skills': {
      const cols = [{ key: 'id' }, { key: 'name' }, { key: 'cls' }, { key: 'branch', num: true }, { key: 'tier', num: true }, { key: 'kind' },
        { key: 'maxRank', num: true }, { key: 'req' }, { key: 'behavior' }, { key: 'type' }, { key: 'cost', num: true }, { key: 'cd', num: true },
        { key: 'coef' }, { key: 'status' }, { key: 'stats' }, { key: 'cond' }, { key: 'patch' }];
      /** @type {TableSpec['rows']} */
      const rows = [];
      for (const c of CLASSES) {
        const b = /** @type {any} */ (BASIC_SKILLS)[c.basic];
        if (!b) continue;
        rows.push({ values: [b.id, t('skill.' + b.id + '.name'), c.id, null, 0, 'basic', 1, null, b.behavior, b.type, b.cost, b.cd, b.coef, b.status ?? null, null, null, null] });
      }
      for (const n of SKILL_NODES) {
        const sk = /** @type {any} */ (n).skill ?? null;
        const any = /** @type {any} */ (n);
        rows.push({
          values: [n.id, t('node.' + n.id + '.name'), n.cls, n.branch, n.tier, n.kind, n.maxRank, any.req ?? null, sk ? sk.behavior : null,
            sk ? sk.type : null, sk ? sk.cost : null, sk ? sk.cd : null, sk ? sk.coef : null, sk ? sk.status ?? null : null,
            any.stats ?? any.condStats ?? null, any.cond ?? null, any.patch ?? null],
        });
      }
      return { id, titleKey: 'analytics.tbl.skills', src: 'src/data/skills.js · BASIC_SKILLS · SKILL_NODES', cols, rows, notes: [note('TREE', TREE)] };
    }
    case 'treasure': {
      const W = ['none', 'gold', 'potion', 'globe', 'material', 'gear'];
      const cols = [{ key: 'id' }, { key: 'picks', num: true }, { key: 'goldMul', num: true }, ...W.map((k) => ({ key: 'w.' + k, num: true })),
        { key: 'guaranteed', num: true }];
      const rows = TREASURE.map((r) => ({
        values: [r.id, r.picks, r.goldMul, ...W.map((k) => /** @type {any} */ (r.w)[k] ?? 0), /** @type {any} */ (r).guaranteed ?? 0],
      }));
      return {
        id, titleKey: 'analytics.tbl.treasure', src: 'src/data/drops.js · TREASURE', cols, rows,
        notes: [note('GOLD', GOLD), note('MATERIAL_DROP', MATERIAL_DROP)],
      };
    }
    case 'economy': {
      /** @type {Array<[string, unknown]>} */
      const pairs = [];
      flatPairs('PRICES', PRICES, pairs);
      flatPairs('GAMBLE', GAMBLE, pairs);
      flatPairs('REROLL', REROLL, pairs);
      flatPairs('CRAFT', CRAFT, pairs);
      flatPairs('SALVAGE', SALVAGE, pairs);
      flatPairs('SHOP', SHOP, pairs);
      flatPairs('ECON', ECON, pairs);
      flatPairs('START', START, pairs);
      flatPairs('XP', XP, pairs);
      const cols = [{ key: 'key' }, { key: 'value', num: true }];
      return {
        id, titleKey: 'analytics.tbl.economy', src: 'src/data/economy.js', cols,
        rows: pairs.map(([k, v]) => ({ values: [k, v] })), notes: [],
      };
    }
    default:
      return { id, titleKey: 'analytics.tbl.' + id, src: '', cols: [], rows: [], notes: [] };
  }
}

/**
 * 정렬한 줄 순서(원래 순서 = col −1) — 숫자 열은 수로 · 그 밖은 문면으로 · 없음(null)은 늘 뒤
 * @param {TableSpec} spec @param {number} col @param {1|-1} dir @returns {number[]}
 */
export function sortOrder(spec, col, dir) {
  const idx = spec.rows.map((_, i) => i);
  if (col < 0 || col >= spec.cols.length) return idx;
  const num = !!spec.cols[col].num;
  /** @param {unknown} v */
  const key = (v) => {
    if (v === null || v === undefined) return null;
    if (num && typeof v === 'number') return v;
    return rawText(v);
  };
  idx.sort((a, b) => {
    const va = key(spec.rows[a].values[col]);
    const vb = key(spec.rows[b].values[col]);
    if (va === null && vb === null) return a - b;
    if (va === null) return 1;
    if (vb === null) return -1;
    let c;
    if (typeof va === 'number' && typeof vb === 'number') c = va - vb;
    else if (typeof va === 'number') c = -1;
    else if (typeof vb === 'number') c = 1;
    else c = String(va).localeCompare(String(vb));
    return c !== 0 ? c * dir : a - b;
  });
  return idx;
}

/**
 * 표 보기 탭.
 * @param {{root:HTMLElement, sim:any, bus:any, settings:any, actions:any, t:(key:string, params?:any) => string, ui:any, widgets:any}} ctx
 */
export function createTablesTab(ctx) {
  const { widgets: W, t } = ctx;
  const el = W.el('div', 'an-tab an-tables');
  el.dataset.tab = 'tables';
  const listEl = el.appendChild(W.el('div', 'an-tlist menu'));
  for (const id of TABLE_IDS) listEl.appendChild(W.el('div', 'menu-item an-titem', t('analytics.tbl.' + id)));
  const view = el.appendChild(W.el('div', 'an-tview'));
  const head = view.appendChild(W.el('div', 'an-thead'));
  const title = head.appendChild(W.el('h3', 'an-h'));
  const src = head.appendChild(W.el('span', 'an-src'));
  const scroller = view.appendChild(W.el('div', 'an-tscroll'));
  const notesEl = view.appendChild(W.el('div', 'an-notes'));
  el.appendChild(W.el('div', 'an-foot panel-hint', t('analytics.hint.tables')));

  /** @type {Map<string, TableSpec>} */
  const specs = new Map();
  /** @type {Record<string, {col:number, dir:1|-1}>} */
  const sortState = {};
  let current = '';

  /** @param {string} id */
  const specOf = (id) => {
    let s = specs.get(id);
    if (!s) { s = buildTable(id, t); specs.set(id, s); }
    return s;
  };

  const draw = () => {
    const spec = specOf(current);
    const st = sortState[current] ?? (sortState[current] = { col: -1, dir: 1 });
    title.textContent = t(spec.titleKey);
    src.textContent = spec.src;
    const table = W.el('table', 'an-data');
    const tr = table.appendChild(W.el('tr'));
    spec.cols.forEach((c, i) => {
      const th = tr.appendChild(W.el('th', c.num ? 'an-num' : '', c.key));
      if (i === st.col) {
        th.classList.add('is-sorted');
        th.textContent = c.key + (st.dir > 0 ? ' ▲' : ' ▼');
      }
      th.addEventListener('click', () => {
        if (st.col === i) st.dir = st.dir > 0 ? -1 : 1;
        else { st.col = i; st.dir = 1; }
        draw();
      });
    });
    for (const ri of sortOrder(spec, st.col, st.dir)) {
      const row = spec.rows[ri];
      const r = table.appendChild(W.el('tr', row.rowCls ?? ''));
      row.values.forEach((v, ci) => {
        const td = r.appendChild(W.el('td', spec.cols[ci]?.num ? 'an-num' : ''));
        td.textContent = rawText(v);
        const extra = row.cls?.[ci];
        if (extra) td.classList.add(extra);
        const cc = spec.cols[ci]?.cls;
        if (cc) td.classList.add(cc);
      });
    }
    scroller.textContent = '';
    scroller.appendChild(table);
    notesEl.textContent = '';
    for (const n of spec.notes) notesEl.appendChild(W.el('div', '', n));
    notesEl.hidden = spec.notes.length === 0;
  };

  /** @param {string} id */
  const select = (id) => {
    if (!TABLE_IDS.includes(id) || id === current) return;
    current = id;
    scroller.scrollTop = 0;
    scroller.scrollLeft = 0;
    draw();
  };

  const nav = W.listNav(listEl, (i) => select(TABLE_IDS[i]), { onFocus: (i) => select(TABLE_IDS[i]) });

  /** @param {number} d */
  const moveSort = (d) => {
    const spec = specOf(current);
    const st = sortState[current] ?? (sortState[current] = { col: -1, dir: 1 });
    const n = spec.cols.length;
    st.col = st.col + d < -1 ? n - 1 : st.col + d >= n ? -1 : st.col + d;
    st.dir = 1;
    draw();
  };

  return {
    el,
    /** @param {any} _state */
    show(_state) {
      nav.active = true;
      if (!current) nav.focus(0);
      else draw();
    },
    hide() { nav.active = false; },
    stop() {},
    /** @param {any} _state */
    update(_state) {},
    /** @param {KeyboardEvent} e @returns {boolean} */
    handleKey(e) {
      if (e.type === 'keyup') return false;
      const code = e.code;
      if (code === KEYBINDS.left || code === KEYBINDS.right) { moveSort(code === KEYBINDS.left ? -1 : 1); return true; }
      if (KEYBINDS.confirm.includes(code)) {
        const st = sortState[current];
        if (st && st.col >= 0) { st.dir = st.dir > 0 ? -1 : 1; draw(); }
        return true;
      }
      if (code === 'PageDown' || code === 'PageUp') {
        scroller.scrollTop += (code === 'PageDown' ? 1 : -1) * Math.max(40, scroller.clientHeight * 0.85);
        return true;
      }
      return nav.handleKey(e);
    },
    /** 테스트 · 화면 확인용 @param {string} id */
    select(id) {
      const i = TABLE_IDS.indexOf(id);
      if (i >= 0) nav.focus(i);
    },
    get current() { return current; },
    dispose() {
      nav.destroy();
      el.remove();
    },
  };
}
