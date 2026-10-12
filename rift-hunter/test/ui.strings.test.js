// OWNER: P10 — 계약 §12.2(ui.strings) · §10.8 · 부록 A · 부록 B
// 화면에 문자열 키가 그대로 나오지 않는다:
//  1) ui · app 소스(src/ui/** · src/app/**)의 문자열 키 리터럴(t('…') 등 · 부록 B 의 접두어를 가진 'a.b' 꼴)이 전부 strings.ko.js 에 있다.
//  2) 데이터 행의 모든 이름 키(mon · affix · node · base · afx · leg · legfx · set · setp · npc · …)와 열거(등급 · 부위 · 사유 · 안내 …)가 있다.
//  3) ui 가 이어 붙여 만드는 키(P10 — 'rank.' + rank · 'hint.' + id + '.title' · 'settings.quality.' + q …)가 있다.
//  4) 문면은 비어 있지 않고 {자리}의 괄호가 맞는다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLASS_IDS, DMG_TYPES, EQUIP_SLOTS, HINT_IDS, ITEM_SLOTS, MATERIAL_IDS, MON_RANKS, PANEL_IDS, RARITIES, TILESET_IDS } from '../src/core/constants.js';
import { STRINGS } from '../src/data/strings.ko.js';
import { CLASSES } from '../src/data/classes.js';
import { BASIC_SKILLS, SKILL_NODES } from '../src/data/skills.js';
import { MONSTERS } from '../src/data/monsters.js';
import { GUARDIANS } from '../src/data/guardians.js';
import { MON_AFFIXES } from '../src/data/monsterAffixes.js';
import { BASES, BASE_TIERS } from '../src/data/items.js';
import { ITEM_AFFIXES } from '../src/data/itemAffixes.js';
import { LEGENDARIES, SETS } from '../src/data/legendaries.js';
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA } from '../src/data/settings.js';
import { QUALITY } from '../src/data/quality.js';
import { TOWN_OBJECT_IDS } from '../src/core/constants.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const own = Object.prototype.hasOwnProperty;

/** 부록 A ReasonCode 전부 + 이벤트의 실패 사유(SKILL_FAIL · POTION_FAIL — ui 가 'reason.' + reason 으로 보인다) */
const REASONS = ['stub', 'busy', 'gold', 'materials', 'bagFull', 'stashFull', 'equipped', 'class', 'level', 'slot', 'twoHanded', 'notInTown', 'notInRift',
  'noRift', 'collapsed', 'dead', 'notDead', 'locked', 'points', 'tier', 'req', 'maxRank', 'notLearned', 'name', 'slotTaken', 'rerollLocked', 'noOffer',
  'nothing', 'notEligible', 'full', 'empty', 'cooldown', 'resource', 'noTarget', 'rooted', 'town', 'noItem', 'invalid', 'itemLocked'];

/** 문자열 키의 접두어(부록 B — 데이터 이름 키 + ui · app 키) */
const PREFIXES = ['class', 'res', 'dmg', 'rarity', 'rank', 'slot', 'islot', 'mat', 'mon', 'affix', 'node', 'branch', 'skill', 'base', 'afx', 'leg', 'legfx',
  'set', 'setp', 'npc', 'tileset', 'stat', 'reason', 'hint', 'rare', 'elite', 'preset', 'hud', 'banner', 'notice', 'panel', 'title', 'pause', 'settings',
  'help', 'death', 'complete', 'inv', 'char', 'shop', 'riftStone', 'analytics', 'confirm', 'fatal', 'audio', 'label', 'newChar', 'map', 'common'];
const KEY_RE = new RegExp(`^(?:${PREFIXES.join('|')})(?:\\.[A-Za-z0-9]+)+$`);

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  /** @type {string[]} */
  const out = [];
  let names = [];
  try { names = readdirSync(dir); } catch { return out; }
  for (const n of names) {
    const p = join(dir, n);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (n.endsWith('.js')) out.push(p);
  }
  return out;
}

/**
 * 소스의 문자열 리터럴(주석 · 정규식 바깥) — '…' · "…" · 치환 없는 `…`.
 * @param {string} src @returns {Array<{text:string, line:number}>}
 */
function stringLiterals(src) {
  /** @type {Array<{text:string, line:number}>} */
  const out = [];
  let i = 0;
  let line = 1;
  let prevSig = '';
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; }
      i += 2;
      continue;
    }
    if (c === '/' && /[(,=:[!&|?{};+\-*%<>~^]|^$|return$/.test(prevSig)) {
      // 정규식 리터럴 — 끝 / 까지 건너뛴다(문자 집합 안의 / 포함)
      i++;
      let cls = false;
      while (i < n && src[i] !== '\n') {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '[') cls = true;
        else if (src[i] === ']') cls = false;
        else if (src[i] === '/' && !cls) break;
        i++;
      }
      i++;
      prevSig = 'x';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const start = line;
      let j = i + 1;
      let text = '';
      let tmpl = false;
      while (j < n && src[j] !== c) {
        if (src[j] === '\\') { text += src[j + 1]; j += 2; continue; }
        if (c === '`' && src[j] === '$' && src[j + 1] === '{') {
          tmpl = true;
          let depth = 0;
          while (j < n) {
            if (src[j] === '{') depth++;
            else if (src[j] === '}') { depth--; if (depth === 0) break; }
            else if (src[j] === '\n') line++;
            j++;
          }
          j++;
          continue;
        }
        if (src[j] === '\n') line++;
        text += src[j];
        j++;
      }
      if (!tmpl) out.push({ text, line: start });
      i = j + 1;
      prevSig = 'x';
      continue;
    }
    if (!/\s/.test(c)) {
      if (/[A-Za-z0-9_$]/.test(c)) {
        let j = i;
        while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++;
        prevSig = src.slice(i, j);
        i = j;
        continue;
      }
      prevSig = c;
    }
    i++;
  }
  return out;
}

const sources = [...walk(join(ROOT, 'src/ui')), ...walk(join(ROOT, 'src/app'))].filter((p) => !p.endsWith('strings.ko.js'));

test('ui · app 소스의 문자열 키 리터럴이 전부 strings.ko.js 에 있다(§10.8)', () => {
  const missing = [];
  let seen = 0;
  for (const f of sources) {
    const src = readFileSync(f, 'utf8');
    for (const s of stringLiterals(src)) {
      if (!KEY_RE.test(s.text)) continue;
      seen++;
      if (!own.call(STRINGS, s.text)) missing.push(`${relative(ROOT, f)}:${s.line}: '${s.text}'`);
    }
  }
  assert.ok(seen > 50, `키 리터럴을 찾지 못했다(${seen}) — 훑기가 잘못됐다`);
  assert.deepEqual(missing, [], `strings.ko.js 에 없는 키:\n${missing.join('\n')}`);
});

test('문자열 리터럴 훑기 — 주석 · 정규식 · 치환 템플릿은 빼고 키 꼴만 고른다(자기 검사)', () => {
  const src = [
    "// t('hud.notAKey')",
    "/* t('hud.alsoNot') */",
    "const a = t('hud.life'); const r = /'x'/g; const b = `${x}.y`; const c = `hud.level`;",
    "const d = \"notice.bagFull\"; const e = 'src/ui/hud.css'; const f = 'is-focus';",
  ].join('\n');
  const lits = stringLiterals(src).map((s) => s.text);
  assert.deepEqual(lits.filter((s) => KEY_RE.test(s)), ['hud.life', 'hud.level', 'notice.bagFull']);
  assert.ok(!lits.includes("'x'") && !lits.includes('x'), '정규식 안의 따옴표는 문자열이 아니다');
});

test('데이터 행의 모든 이름 키 · 열거 키가 있다(부록 B)', () => {
  const missing = [];
  const need = (k) => { if (!own.call(STRINGS, k)) missing.push(k); };
  for (const c of CLASS_IDS) { need('class.' + c); need('title.defaultName.' + c); need('newChar.desc.' + c); }
  for (const c of CLASSES) need('res.' + c.resource);
  for (const d of DMG_TYPES) need('dmg.' + d);
  for (const r of RARITIES) need('rarity.' + r);
  for (const r of MON_RANKS) need('rank.' + r);
  for (const s of EQUIP_SLOTS) need('slot.' + s);
  for (const s of ITEM_SLOTS) need('islot.' + s);
  for (const m of MATERIAL_IDS) need('mat.' + m);
  for (const ts of TILESET_IDS) need('tileset.' + ts);
  for (const m of [...MONSTERS, ...GUARDIANS]) need('mon.' + m.id);
  for (const a of MON_AFFIXES) { need(`affix.${a.id}.name`); need(`affix.${a.id}.desc`); }
  for (const nd of SKILL_NODES) { need(`node.${nd.id}.name`); need(`node.${nd.id}.desc`); }
  for (const id of Object.keys(BASIC_SKILLS)) { need(`skill.${id}.name`); need(`skill.${id}.desc`); }
  for (const c of CLASS_IDS) for (const b of [0, 1, 2]) need(`branch.${c}.${b}`);
  for (const b of BASES) for (let tt = 0; tt < BASE_TIERS.length; tt++) need(`base.${b.id}.${tt}`);
  for (const a of ITEM_AFFIXES) { need(`afx.${a.id}.line`); need(`afx.${a.id}.${a.kind === 'prefix' ? 'p' : 's'}`); }
  for (const l of LEGENDARIES) { need('leg.' + l.id); need('legfx.' + l.id); }
  for (const s of SETS) { need('set.' + s.id); need(`set.${s.id}.b2`); need(`set.${s.id}.b4`); for (const p of s.pieces) need('setp.' + p.id); }
  for (const id of TOWN_OBJECT_IDS) { need('npc.' + id); need(`npc.${id}.greet`); }
  for (const r of REASONS) need('reason.' + r);
  for (const h of HINT_IDS) { need(`hint.${h}.title`); need(`hint.${h}.body`); }
  for (let i = 0; i < 24; i++) { need('rare.a.' + i); need('rare.b.' + i); }
  for (let i = 0; i < 16; i++) { need('elite.a.' + i); need('elite.b.' + i); }
  for (const c of CLASS_IDS) for (const i of [0, 1]) need(`preset.${c}.${i}`);
  for (const p of PANEL_IDS) need(`panel.${p}.title`);
  for (const k of Object.keys(DEFAULT_SETTINGS)) need('settings.' + k);
  for (const q of Object.keys(QUALITY)) need('settings.quality.' + q);
  for (const k of Object.keys(SETTINGS_SCHEMA)) if (SETTINGS_SCHEMA[k].type === 'enum') for (const v of SETTINGS_SCHEMA[k].values) need(`settings.${k}.${v}`);
  assert.deepEqual(missing, [], `없는 문자열 키:\n${missing.join('\n')}`);
});

test('ui 가 이어 붙여 만드는 키(P10 — HUD · 안내 · 도움말 · 사망 · 완료)가 있다', () => {
  const missing = [];
  const need = (k) => { if (!own.call(STRINGS, k)) missing.push(k); };
  for (let i = 0; i < 8; i++) need('help.controls.' + i);
  for (const r of ['lives', 'repair', 'unlock', 'telegraph', 'potion', 'recall']) need('help.rules.' + r);
  for (const tab of ['controls', 'affixes', 'rules']) need('help.tab.' + tab);
  for (const k of ['hud.status.slow', 'hud.status.root', 'hud.immune', 'hud.portal.recall', 'hud.portal.exit', 'hud.gaugeDone', 'hud.collapsed',
    'hud.key.lmb', 'hud.key.rmb', 'hud.level', 'hud.levelMax', 'hud.points', 'hud.gauge', 'hud.lives', 'hud.guardian', 'hud.recall', 'hud.returnPrompt',
    'hud.devBadge', 'hud.botBadge', 'hud.broken', 'hud.life', 'hud.potion', 'hud.scroll', 'hud.xp',
    'banner.riftOpened', 'banner.gaugeFull', 'banner.guardian', 'banner.complete', 'banner.levelUp',
    'notice.bagFull', 'notice.legendary', 'notice.set', 'notice.unlock', 'notice.durability', 'notice.broken', 'notice.noRecall', 'notice.potionFull',
    'notice.noPotion', 'notice.lifeFull', 'notice.recallCancel', 'notice.skillEmpty', 'hint.more', 'hint.close', 'hint.openHelp',
    'label.gold', 'label.potion', 'label.material', 'complete.other', 'death.summary', 'map.hint', 'audio.hint',
    'confirm.yes', 'confirm.no', 'fatal.webglTitle', 'fatal.webglBody', 'settings.on', 'settings.off']) need(k);
  assert.deepEqual(missing, [], `없는 문자열 키:\n${missing.join('\n')}`);
});

test('문면은 비어 있지 않고 {자리} 괄호가 맞으며 자리 이름이 낱말이다', () => {
  const bad = [];
  for (const [k, v] of Object.entries(STRINGS)) {
    if (typeof v !== 'string' || !v.length) { bad.push(`${k}: 빈 문면`); continue; }
    const open = (v.match(/\{/g) || []).length;
    const close = (v.match(/\}/g) || []).length;
    if (open !== close) bad.push(`${k}: 괄호 ${open}/${close}`);
    for (const m of v.matchAll(/\{([^}]*)\}/g)) if (!/^\w+$/.test(m[1])) bad.push(`${k}: 자리 {${m[1]}}`);
    if (KEY_RE.test(v)) bad.push(`${k}: 문면이 키처럼 생겼다 — ${v}`);
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});
