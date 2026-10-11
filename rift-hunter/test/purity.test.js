// OWNER: P0 — 계약 §12.3 · §2 · §11.11 (W0 완성 · 이후 고치지 않는다 — 결함은 NOTES-P#)
// 소스를 훑는다: 순수 계층의 금지 토큰 · 계층 import 표(§2.1) · 순환 금지 지점(§2.2) · 상대 import 대소문자 · 동적 import 없음 ·
// 부팅 표식 · 이벤트 이름 리터럴 · 콘텐츠 ID 분기 · sim import 순환 · default export 없음 · 한국어 문자열 리터럴 위치.
// 주석(//, /* */, JSDoc)은 먼저 지운다 — 주석 안의 낱말은 된다. 문자열 검사는 문자열 리터럴(작은따옴표 · 큰따옴표 · 백틱) 안만 본다.
// 검사기는 analyze(files) 하나다 — 마지막 테스트가 일부러 만든 위반 소스를 넣어 검사기가 실제로 잡는지 본다(§12.3-6).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EV } from '../src/core/events.js';
import {
  CLASS_IDS, DMG_TYPES, EQUIP_SLOTS, HINT_IDS, ITEM_SLOTS, MATERIAL_IDS, MON_ACTS, MON_RANKS, MON_TEMPLATES, PANEL_IDS, PLAYER_ACTS,
  RARITIES, TILESET_IDS, TOWN_OBJECT_IDS,
} from '../src/core/constants.js';
import { MONSTERS } from '../src/data/monsters.js';
import { GUARDIANS } from '../src/data/guardians.js';
import { MON_AFFIXES } from '../src/data/monsterAffixes.js';
import { SKILL_NODES } from '../src/data/skills.js';
import { LEGENDARIES, SETS } from '../src/data/legendaries.js';
import { BASES } from '../src/data/items.js';
import { ITEM_AFFIXES } from '../src/data/itemAffixes.js';
import { computeStats } from '../src/sim/loot/stats.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

// ───────────────────────── 규칙 표 ─────────────────────────

const PURE_LAYERS = ['core', 'data', 'sim', 'bot', 'debug'];
/** §2.1 — 계층 → import 해도 되는 계층(types 는 어디서나 · app 은 전부) */
const ALLOWED = {
  core: ['core'],
  data: ['core', 'data'],
  sim: ['core', 'data', 'sim'],
  bot: ['core', 'data', 'sim', 'bot'],
  debug: ['core', 'data', 'sim', 'debug'],
  view: ['core', 'data', 'sim', 'view'],
  audio: ['core', 'data', 'audio'],
  ui: ['core', 'data', 'sim', 'ui'],
};
/** 외부 모듈 — three 는 view · app 만 */
const EXTERNAL_OK = { view: ['three'], app: ['three'] };
/** debug 가 sim 에서 가져와도 되는 것(W0 에 완성인 것) — 파일 → 이름 목록(null = 그 파일의 무엇이든) */
const DEBUG_SIM = {
  'src/sim/state.js': null,
  'src/sim/entities.js': null,
  'src/sim/world/nav.js': null,
  'src/sim/loot/rollItem.js': ['makeItem'],
  'src/sim/loot/stats.js': null,
  'src/sim/monsters/spawn.js': ['monsterStats'],
  'src/sim/progression/character.js': ['createCharacter'],
};
/** view 가 읽어도 되는 sim(순수 조회) */
const VIEW_SIM = ['src/sim/world/nav.js', 'src/sim/loot/stats.js'];
/** ui 가 부르는 순수 조회 · 계산(§6.13) */
const UI_SIM = (rel) => rel.startsWith('src/sim/loot/') || [
  'src/sim/player/skills.js', 'src/sim/progression/progress.js', 'src/sim/progression/shops.js', 'src/sim/progression/inventory.js',
  'src/sim/meter.js', 'src/sim/rift.js',
].includes(rel);
const FORBIDDEN = [
  ['window', /(?<![\w$.])window(?![\w$])(?!\s*:)/],
  ['document', /(?<![\w$.])document(?![\w$])(?!\s*:)/],
  ['AudioContext', /\b(?:webkit)?AudioContext\b/],
  ['localStorage', /(?<![\w$.])localStorage(?![\w$])(?!\s*:)/],
  ['performance.', /(?<![\w$.])performance\s*\./],
  ['Date.now', /\bDate\s*\.\s*now\b/],
  ['Math.random', /\bMath\s*\.\s*random\b/],
  ['setTimeout', /(?<![\w$.])setTimeout\b/],
  ['setInterval', /(?<![\w$.])setInterval\b/],
  ['requestAnimationFrame', /(?<![\w$.])requestAnimationFrame\b/],
];
/** §12.3-5 콘텐츠 ID 분기 금지 — 프레임워크 파일 */
const FRAMEWORK = (rel) => [
  'src/sim/monsters/monsters.js', 'src/sim/monsters/spawn.js', 'src/sim/monsters/packs.js',
  'src/sim/player/controller.js', 'src/sim/player/actions.js',
  'src/sim/combat.js', 'src/sim/status.js', 'src/sim/effects.js', 'src/sim/projectiles.js', 'src/sim/drops.js', 'src/sim/rift.js',
].includes(rel) || rel.startsWith('src/sim/loot/') || rel.startsWith('src/sim/progression/');
/** §3.3 StatKey */
const STAT_KEYS = ['str', 'int', 'vit', 'weaponDmgPct', 'attackSpeedPct', 'critChance', 'critDamage', 'physPct', 'firePct', 'coldPct', 'lightningPct',
  'skillPct', 'cdr', 'costReduce', 'lifePct', 'lifeRegen', 'lifeOnHit', 'lifePctOnHit', 'armor', 'armorPct', 'allRes', 'resPct', 'physRes', 'fireRes',
  'coldRes', 'lightningRes', 'moveSpeed', 'aoePct', 'elitePct', 'thorns', 'goldFind', 'magicFind', 'xpPct', 'potionPct', 'globePct', 'manaRegenPct',
  'dmgTakenReduce', 'rageOnHit', 'allPct', 'burnFrac', 'freezeAt', 'freezeDurPct'];
const SKILL_BEHAVIOR_IDS = ['meleeBasic', 'boltBasic', 'cone', 'quake', 'dash', 'spin', 'buff', 'leap', 'fireball', 'meteor', 'nova', 'shield', 'chain', 'blink'];
/** 구조 어휘 — 콘텐츠 ID 와 글자가 같아도 열거 · 키로 쓰는 것은 된다(부위 · 능력치 · 행동 · 등급 · 버프 ID 'warCry' · 'energyShield') */
const RESERVED = new Set([
  ...ITEM_SLOTS, ...EQUIP_SLOTS, ...STAT_KEYS, ...Object.keys(computeStats(null)), ...PLAYER_ACTS, ...MON_ACTS, ...MON_RANKS, ...RARITIES,
  ...DMG_TYPES, ...MATERIAL_IDS, ...CLASS_IDS, ...TILESET_IDS, ...SKILL_BEHAVIOR_IDS, ...TOWN_OBJECT_IDS, ...HINT_IDS, ...PANEL_IDS,
  ...MON_TEMPLATES, 'warCry', 'energyShield',
]);
const CONTENT_IDS = new Set([
  ...MONSTERS.map(r => r.id), ...GUARDIANS.map(r => r.id), ...MON_AFFIXES.map(r => r.id), ...SKILL_NODES.map(r => r.id),
  ...LEGENDARIES.map(r => r.id), ...SETS.map(r => r.id), ...SETS.flatMap(s => s.pieces.map(p => p.id)), ...BASES.map(r => r.id),
  ...ITEM_AFFIXES.map(r => r.id),
].filter(id => !RESERVED.has(id)));
const EV_VALUES = new Set(Object.values(EV));
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힣]/;
/** §2.2 순환 금지 지점 — [from 판정, to 판정, 사유] */
const EDGES = [
  [(f) => f === 'src/sim/combat.js', (t) => /^src\/sim\/(player|monsters)\//.test(t) || ['src/sim/rift.js', 'src/sim/drops.js'].includes(t), 'combat.js 는 player/* · monsters/* · rift.js · drops.js 를 import 하지 않는다'],
  [(f) => f === 'src/sim/status.js', (t) => t === 'src/sim/combat.js', 'status.js 는 combat.js 를 import 하지 않는다'],
  [(f) => f.startsWith('src/sim/loot/'), (t) => t.startsWith('src/sim/progression/') || ['src/sim/combat.js', 'src/sim/rift.js'].includes(t), 'loot/* 는 progression/* · combat · rift 를 import 하지 않는다'],
  [(f) => f === 'src/sim/rift.js' || f === 'src/sim/drops.js', (t) => t.startsWith('src/sim/player/'), 'rift.js · drops.js 는 player/* 를 import 하지 않는다'],
  [(f) => f === 'src/sim/monsters/spawn.js', (t) => /^src\/sim\/monsters\/(affixHooks|guardians)\/index\.js$/.test(t) || t === 'src/sim/monsters/monsters.js', 'spawn.js 는 레지스트리 · monsters.js 를 import 하지 않는다'],
  [(f) => /^src\/sim\/monsters\/(affixHooks|guardians)\/(?!index\.js)/.test(f), (t) => t === 'src/sim/monsters/monsters.js' || /^src\/sim\/monsters\/(affixHooks|guardians)\//.test(t), '훅 파일은 monsters.js · 레지스트리 · 다른 훅 파일을 import 하지 않는다'],
  [(f) => !f.startsWith('src/app/') && f !== 'src/main.js', (t) => t === 'src/sim/GameSim.js', 'GameSim.js 는 app 만 import 한다(bot · sim 은 인자로 받는다)'],
  [(f) => !f.startsWith('src/app/') && f !== 'src/main.js' && !f.startsWith('src/debug/'), (t) => t.startsWith('src/debug/'), 'debug/* 는 app(main.js · app/*)과 test 만 import 한다'],
];

// ───────────────────────── 렉서 · 분석 ─────────────────────────

const REGEX_PREV = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
const REGEX_WORDS = /\b(?:return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await)$/;

/**
 * 작은 렉서: 주석을 지우고 문자열 리터럴을 모은다.
 * @returns {{keep:string, bare:string, strings:Array<{text:string, line:number}>}}  keep: 주석만 지운 코드 · bare: 문자열 · 정규식 내용까지 비운 코드
 */
export function lex(src) {
  let keep = '', bare = '';
  const strings = [];
  let i = 0, line = 1, last = '';
  const n = src.length;
  const push = (k, b) => { keep += k; bare += b; };
  while (i < n) {
    const ch = src[i], nx = src[i + 1];
    if (ch === '\n') line++;
    if (ch === '/' && nx === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (ch === '/' && nx === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      const nl = (src.slice(i, stop).match(/\n/g) || []).length;
      line += nl;
      push('\n'.repeat(nl) + ' ', '\n'.repeat(nl) + ' ');
      i = stop;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const startLine = line;
      let j = i + 1, text = '', depth = 0;
      while (j < n) {
        const c = src[j];
        if (c === '\\') { text += c + (src[j + 1] ?? ''); j += 2; continue; }
        if (c === '\n') line++;
        if (ch === '`') {
          if (c === '$' && src[j + 1] === '{') { depth++; text += '${'; j += 2; continue; }
          if (c === '}' && depth > 0) { depth--; text += c; j++; continue; }
          if (c === '`' && depth === 0) break;
        } else if (c === ch || c === '\n') break;
        text += c;
        j++;
      }
      strings.push({ text, line: startLine });
      push(src.slice(i, j + 1), ch + ch);
      last = ch;
      i = j + 1;
      continue;
    }
    if (ch === '/' && (REGEX_PREV.has(last) || REGEX_WORDS.test(keep.trimEnd()))) {
      let j = i + 1, inClass = false;
      while (j < n && src[j] !== '\n') {
        const c = src[j];
        if (c === '\\') { j += 2; continue; }
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) break;
        j++;
      }
      j++;
      while (j < n && /[a-z]/i.test(src[j])) j++;
      push(src.slice(i, j), '/r/');
      last = 'r';
      i = j;
      continue;
    }
    push(ch, ch);
    if (!/\s/.test(ch)) last = /[\w$]/.test(ch) ? 'w' : ch;
    i++;
  }
  return { keep, bare, strings };
}

/** import · export-from 의 지정자와 가져오는 이름 */
function importsOf(keep) {
  const out = [];
  const re = /\b(?:import|export)\s+(?:([^;'"]*?)\s+from\s+)?(['"])([^'"]+)\2/g;
  for (const m of keep.matchAll(re)) {
    const clause = m[1] || '';
    const inner = clause.replace(/\bas\s+[\w$]+/g, '');
    const names = [...inner.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)].map(x => x[1]).filter(x => x !== 'type');
    out.push({ spec: m[3], clause, names });
  }
  return out;
}

/** 'src/<layer>/…' → 계층(main.js 는 app · types.js 는 types) */
function layerOf(rel) {
  if (rel === 'src/main.js') return 'app';
  if (rel === 'src/types.js') return 'types';
  return rel.split('/')[1];
}

/**
 * 검사기 — files: [{rel:'src/…', code}] · exists(rel) → 디스크에 그 이름 그대로 있는가 · existsLoose(rel) → 대소문자 무시하고 있는가
 * @returns {Record<string, string[]>} 규칙 → 위반 목록
 */
export function analyze(files, { exists, existsLoose }) {
  const out = { pureTokens: [], layers: [], edges: [], caseImports: [], dynamicImports: [], evLiterals: [], contentIds: [], cycles: [], hangul: [], defaultExports: [], bootMarker: [] };
  const parsed = new Map(files.map(f => [f.rel, lex(f.code)]));
  /** @type {Map<string, string[]>} sim 상대 import 그래프 */
  const graph = new Map();
  for (const f of files) {
    const { keep, bare, strings } = parsed.get(f.rel);
    const layer = layerOf(f.rel);
    if (PURE_LAYERS.includes(layer)) for (const [name, re] of FORBIDDEN) if (re.test(bare)) out.pureTokens.push(`${f.rel}: ${name}`);
    if (/\bimport\s*\(/.test(bare)) out.dynamicImports.push(`${f.rel}: 동적 import()`);
    if (/\bexport\s+default\b/.test(bare)) out.defaultExports.push(`${f.rel}: export default`);
    if (f.rel !== 'src/core/events.js') for (const s of strings) if (EV_VALUES.has(s.text)) out.evLiterals.push(`${f.rel}:${s.line}: '${s.text}' — EV 상수를 쓴다`);
    if (FRAMEWORK(f.rel)) for (const s of strings) if (CONTENT_IDS.has(s.text.trim())) out.contentIds.push(`${f.rel}:${s.line}: '${s.text}'`);
    if (f.rel !== 'src/data/strings.ko.js' && !f.rel.startsWith('src/bot/')) {
      for (const s of strings) if (HANGUL.test(s.text)) out.hangul.push(`${f.rel}:${s.line}: ${s.text.slice(0, 40)}`);
    }
    if (f.rel !== 'src/app/bootMarker.js' && /dataset\s*\.\s*game(?:Ready|Error)|data-game-(?:ready|error)/.test(f.code)) out.bootMarker.push(`${f.rel}: 부팅 표식을 직접 쓴다`);
    const deps = [];
    for (const imp of importsOf(keep)) {
      if (!imp.spec.startsWith('.')) {
        const base = imp.spec.split('/')[0];
        if (base.startsWith('node:')) { out.layers.push(`${f.rel}: '${imp.spec}' — 브라우저 번들에 node 모듈`); continue; }
        if (!(EXTERNAL_OK[layer] ?? []).includes(base)) out.layers.push(`${f.rel}: 외부 모듈 '${imp.spec}'`);
        continue;
      }
      const target = posix.normalize(posix.join(posix.dirname(f.rel), imp.spec));
      if (!exists(target)) out.caseImports.push(existsLoose(target) ? `${f.rel}: 대소문자가 다르다 '${imp.spec}'` : `${f.rel}: 없는 파일 '${imp.spec}'`);
      const tl = layerOf(target);
      if (layer !== 'app' && tl !== 'types' && !(ALLOWED[layer] ?? []).includes(tl)) out.layers.push(`${f.rel}: ${layer} → ${tl} ('${imp.spec}')`);
      if (layer === 'debug' && tl === 'sim') {
        if (!(target in DEBUG_SIM)) out.layers.push(`${f.rel}: debug 가 W0 완성이 아닌 ${target} 를 import 한다`);
        else if (DEBUG_SIM[target]) {
          const extra = imp.names.filter(nm => !DEBUG_SIM[target].includes(nm));
          if (extra.length || imp.clause.includes('*')) out.layers.push(`${f.rel}: debug 가 ${target} 에서 ${extra.join(', ') || '*'} 를 가져온다`);
        }
      }
      if (layer === 'view' && tl === 'sim' && !VIEW_SIM.includes(target)) out.layers.push(`${f.rel}: view 는 sim 의 순수 조회만(${target})`);
      if (layer === 'ui' && tl === 'sim' && !UI_SIM(target)) out.layers.push(`${f.rel}: ui 는 §6.13 의 순수 조회 · 계산만(${target})`);
      if (layer === 'bot' && target === 'src/sim/GameSim.js') out.layers.push(`${f.rel}: bot 은 GameSim.js 를 import 하지 않는다`);
      for (const [from, to, why] of EDGES) if (from(f.rel) && to(target)) out.edges.push(`${f.rel} → ${target}: ${why}`);
      if (layer === 'sim' && tl === 'sim') deps.push(target);
    }
    if (layer === 'sim') graph.set(f.rel, deps);
  }
  // sim 상대 import 순환(DFS)
  const color = new Map();
  const stack = [];
  const visit = (u) => {
    color.set(u, 1);
    stack.push(u);
    for (const v of graph.get(u) ?? []) {
      if (!graph.has(v)) continue;
      if (color.get(v) === 1) out.cycles.push(stack.slice(stack.indexOf(v)).concat(v).join(' → '));
      else if (!color.get(v)) visit(v);
    }
    stack.pop();
    color.set(u, 2);
  };
  for (const u of graph.keys()) if (!color.get(u)) visit(u);
  // 부팅 표식: main.js 또는 app/Game.js 가 bootMarker 의 markReady · markError 를 import
  const entries = files.filter(f => f.rel === 'src/main.js' || f.rel === 'src/app/Game.js');
  const okEntry = entries.some(f => {
    const names = importsOf(parsed.get(f.rel).keep)
      .filter(i => posix.normalize(posix.join(posix.dirname(f.rel), i.spec)) === 'src/app/bootMarker.js')
      .flatMap(i => i.names);
    return names.includes('markReady') && names.includes('markError');
  });
  if (!okEntry) out.bootMarker.push('src/main.js 또는 src/app/Game.js 가 markReady · markError 를 src/app/bootMarker.js 에서 import 해야 한다');
  return out;
}

// ───────────────────────── 디스크의 src ─────────────────────────

function listFiles(dir) {
  const res = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) res.push(...listFiles(p));
    else if (name.endsWith('.js')) res.push(p);
  }
  return res;
}
const toRel = (p) => relative(ROOT, p).split(sep).join('/');
/** 디스크의 이름과 대소문자까지 같은가 */
function existsExact(rel) {
  let cur = ROOT;
  for (const seg of rel.split('/')) {
    if (!existsSync(cur) || !statSync(cur).isDirectory()) return false;
    if (!readdirSync(cur).includes(seg)) return false;
    cur = join(cur, seg);
  }
  return true;
}
function existsLooseDisk(rel) {
  let cur = ROOT;
  for (const seg of rel.split('/')) {
    if (!existsSync(cur) || !statSync(cur).isDirectory()) return false;
    const hit = readdirSync(cur).find(n => n.toLowerCase() === seg.toLowerCase());
    if (!hit) return false;
    cur = join(cur, hit);
  }
  return true;
}
const DISK = listFiles(SRC).map(p => ({ rel: toRel(p), code: readFileSync(p, 'utf8') }));
const R = analyze(DISK, { exists: existsExact, existsLoose: existsLooseDisk });
const report = (list) => `\n${list.join('\n')}`;

test('순수 계층(core · data · sim · bot · debug)에 금지 토큰이 없다(three · window · document · AudioContext · localStorage · performance. · Date.now · Math.random · 타이머 · rAF)', () => {
  assert.deepEqual(R.pureTokens, [], report(R.pureTokens));
});

test('계층 import 표(§2.1) — 외부 모듈은 three(view · app)뿐 · debug 는 W0 완성 sim 만 · view · ui 는 순수 조회만', () => {
  assert.deepEqual(R.layers, [], report(R.layers));
});

test('순환 금지 지점(§2.2) — combat · status · loot · spawn · 훅 파일 · GameSim · debug', () => {
  assert.deepEqual(R.edges, [], report(R.edges));
});

test('src 전체의 상대 import 경로가 디스크의 파일 이름과 대소문자까지 같다 · 동적 import() 없음(단일 번들)', () => {
  assert.deepEqual(R.caseImports, [], report(R.caseImports));
  assert.deepEqual(R.dynamicImports, [], report(R.dynamicImports));
});

test('부팅 표식(§11.11) — main.js 또는 app/Game.js 가 markReady · markError 를 import · 그 밖의 파일은 dataset 표식을 쓰지 않는다', () => {
  assert.deepEqual(R.bootMarker, [], report(R.bootMarker));
});

test('이벤트 이름 문자열 리터럴(EV 값)이 core/events.js 밖에 없다', () => {
  assert.deepEqual(R.evLiterals, [], report(R.evLiterals));
});

test('콘텐츠 ID 분기 금지 — 프레임워크 파일의 문자열 리터럴에 데이터 행 ID 가 없다(§12.3-5)', () => {
  assert.ok(CONTENT_IDS.size > 60, `검사할 ID 가 있다(${CONTENT_IDS.size})`);
  assert.ok(CONTENT_IDS.has('ghoul') && CONTENT_IDS.has('mortar') && CONTENT_IDS.has('groundStomp') && CONTENT_IDS.has('emberMaelstrom'));
  assert.ok(!CONTENT_IDS.has('helm') && !CONTENT_IDS.has('str') && !CONTENT_IDS.has('leap'), '구조 어휘(부위 · 능력치 · 행동)는 뺀다');
  assert.deepEqual(R.contentIds, [], report(R.contentIds));
});

test('sim 상대 import 그래프에 순환이 없다(§12.3-7)', () => {
  assert.deepEqual(R.cycles, [], report(R.cycles));
});

test('default export 가 없다(§0.5 named export 만) · 한국어 문자열 리터럴은 data/strings.ko.js 에만(봇 측정 리포트 src/bot/ 은 예외)', () => {
  assert.deepEqual(R.defaultExports, [], report(R.defaultExports));
  assert.deepEqual(R.hangul, [], report(R.hangul));
});

test('검사기가 일부러 만든 위반을 실제로 잡는다(§12.3-6) — 렉서 자기 검사 포함', () => {
  const fake = [
    { rel: 'src/main.js', code: "import { markReady, markError } from './app/bootMarker.js';" },
    { rel: 'src/app/bootMarker.js', code: 'export function markReady() {} export function markError() {}' },
    { rel: 'src/core/bad.js', code: "const w = window.innerWidth; const r = Math.random(); setTimeout(() => {}, 1);" },
    { rel: 'src/sim/a.js', code: "import { b } from './b.js'; export const a = 1;" },
    { rel: 'src/sim/b.js', code: "import { a } from './a.js'; export const b = 2;" },
    { rel: 'src/sim/combat.js', code: "import { x } from './player/controller.js'; import { y } from '../ui/hud.js'; if (m.typeId === 'ghoul') {} const k = 'helm';" },
    { rel: 'src/sim/player/controller.js', code: 'export const x = 1;' },
    { rel: 'src/ui/hud.js', code: "export const y = 1; const e = 'mon/died'; const s = '한글';" },
    { rel: 'src/view/Case.js', code: "import { z } from './case.js'; const m = import('./Case.js'); export default 3;" },
    { rel: 'src/view/case.js', code: 'export const z = 1;' },
    { rel: 'src/debug/fx.js', code: "import { rollItem } from '../sim/loot/rollItem.js'; import { GameSim } from '../sim/GameSim.js';" },
    { rel: 'src/sim/loot/rollItem.js', code: 'export function rollItem() {}' },
    { rel: 'src/sim/GameSim.js', code: 'export class GameSim {}' },
    { rel: 'src/sim/monsters/spawn.js', code: "import { AFFIX_HOOKS } from './affixHooks/index.js';" },
    { rel: 'src/sim/monsters/affixHooks/index.js', code: 'export const AFFIX_HOOKS = {};' },
    { rel: 'src/bot/b.js', code: "import { GameSim } from '../sim/GameSim.js';" },
  ];
  const names = new Set(fake.map(f => f.rel));
  const r = analyze(fake, { exists: (rel) => names.has(rel), existsLoose: (rel) => [...names].some(n => n.toLowerCase() === rel.toLowerCase()) });
  assert.ok(r.pureTokens.some(x => x.includes('src/core/bad.js: window')), '금지 토큰 window');
  assert.ok(r.pureTokens.some(x => x.includes('Math.random')), '금지 토큰 Math.random');
  assert.ok(r.pureTokens.some(x => x.includes('setTimeout')), '금지 토큰 setTimeout');
  assert.ok(r.cycles.some(x => x.includes('src/sim/a.js') && x.includes('src/sim/b.js')), 'sim 순환');
  assert.ok(r.edges.some(x => x.startsWith('src/sim/combat.js → src/sim/player/controller.js')), 'combat → player');
  assert.ok(r.layers.some(x => x.includes('sim → ui')), 'sim → ui 계층 위반');
  assert.ok(r.contentIds.some(x => x.includes("'ghoul'")), '콘텐츠 ID 분기');
  assert.ok(!r.contentIds.some(x => x.includes("'helm'")), '부위 이름은 콘텐츠 ID 로 치지 않는다');
  assert.ok(r.evLiterals.some(x => x.includes('mon/died')), '이벤트 이름 리터럴');
  assert.ok(r.hangul.some(x => x.startsWith('src/ui/hud.js')), '한국어 리터럴');
  assert.ok(r.dynamicImports.some(x => x.startsWith('src/view/Case.js')), '동적 import');
  assert.ok(r.defaultExports.some(x => x.startsWith('src/view/Case.js')), 'default export');
  assert.ok(r.layers.some(x => x.includes('debug 가 src/sim/loot/rollItem.js 에서 rollItem')), 'debug 이름 제한');
  assert.ok(r.edges.some(x => x.startsWith('src/debug/fx.js → src/sim/GameSim.js')), 'debug → GameSim');
  assert.ok(r.edges.some(x => x.startsWith('src/sim/monsters/spawn.js → src/sim/monsters/affixHooks/index.js')), 'spawn → 레지스트리');
  assert.ok(r.layers.some(x => x.startsWith('src/bot/b.js: bot 은 GameSim.js')), 'bot → GameSim');
  assert.deepEqual(r.bootMarker, [], '표식 import 는 통과');
  // 대소문자: 디스크에 'case.js' 만 있는데 'Case.js' 를 부르면 잡는다
  const r2 = analyze([{ rel: 'src/main.js', code: "import { markReady, markError } from './app/bootMarker.js'; import { q } from './view/Thing.js';" }, { rel: 'src/app/bootMarker.js', code: '' }], {
    exists: (rel) => rel === 'src/app/bootMarker.js' || rel === 'src/view/thing.js', existsLoose: (rel) => rel.toLowerCase() === 'src/view/thing.js' || rel === 'src/app/bootMarker.js',
  });
  assert.ok(r2.caseImports.some(x => x.includes('대소문자가 다르다')), '대소문자 다른 import');
  const r3 = analyze([{ rel: 'src/main.js', code: 'const a = 1;' }, { rel: 'src/view/x.js', code: "document.documentElement.dataset.gameReady = '1';" }], { exists: () => true, existsLoose: () => true });
  assert.equal(r3.bootMarker.length, 2, '표식 import 없음 + 표식 직접 쓰기');
  // 렉서
  const src = [
    "// window 주석 '한글'",
    '/* document',
    ' * Math.random() */',
    "const a = 'w/in' + \"q\" + `t${1 + 2}x`; const r = /\\/\\/[a/]x/g.test(a) ? 1 : 2;",
    'const b = 6 / 2 / 3; const c = { window: 1 }.window;',
    "import x from './y.js'; export { z } from \"../w.js\";",
  ].join('\n');
  const { bare, strings, keep } = lex(src);
  assert.ok(!/document|Math\.random/.test(bare), '주석은 지워진다');
  assert.ok(!FORBIDDEN[0][1].test(bare), '객체 키 · 속성 이름 window 는 걸리지 않는다');
  assert.deepEqual(strings.map(s => s.text), ['w/in', 'q', 't${1 + 2}x', './y.js', '../w.js']);
  assert.match(bare, /6 \/ 2 \/ 3/, '나눗셈은 정규식이 아니다');
  assert.deepEqual(importsOf(keep).map(i => i.spec), ['./y.js', '../w.js']);
});
