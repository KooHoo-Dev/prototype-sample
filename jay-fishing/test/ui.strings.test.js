// OWNER: P8 — 계약 §12.2(ui.strings) · §10.6 · 부록 B
// 1) src/ui/** 의 문자열 키 리터럴(t('…') 와 키 모양의 리터럴)이 전부 STRINGS 에 있다
// 2) 부록 B 의 키 전부 · 데이터 ID 마다의 이름 키(동적 키 — t('species.' + id) 같은 것)가 있다
// 3) strings.ko.js 에 같은 키가 두 번 없다 · 값은 비어 있지 않은 문자열 · {자리}가 짝이 맞는다
// 4) i18n.t / has 의 동작 · 패널 스택 규칙(§10.4 — 순수 PanelStack)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { STRINGS } from '../src/data/strings.ko.js';
import { t, has } from '../src/ui/i18n.js';
import { PanelStack, MAX_DEPTH } from '../src/ui/stack.js';
import {
  BAIT_IDS, BAND_IDS, FAIL_REASONS, GEAR_SLOTS, HINT_IDS, LAYER_IDS, PANEL_IDS, SCENE_IDS, SET_IDS, SKILL_IDS,
  STAGE_IDS, STYLE_IDS, TIERS, WEATHER_IDS, INTERACT_KINDS,
} from '../src/core/constants.js';
import { SPECIES } from '../src/data/species/index.js';
import { SPOTS_BY_ID } from '../src/data/stages/index.js';
import { GEAR } from '../src/data/gear.js';
import { SKILLS } from '../src/data/skills.js';
import { SETTINGS_RANGE } from '../src/data/economy.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

/** @param {string} dir @returns {string[]} */
function jsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...jsFiles(p));
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

/** 주석을 지운 소스 @param {string} src */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

/** 문자열 키의 이름공간(이 접두사로 시작하는 리터럴은 키다) */
const NAMESPACES = [
  'species', 'stage', 'stagePlace', 'spot', 'gear', 'bait', 'skill', 'skillDesc', 'band', 'weather', 'layer', 'set', 'tier',
  'style', 'npc', 'fail', 'reason', 'hint', 'fatal', 'title', 'save', 'prompt', 'hud', 'banner', 'confirm', 'result', 'panel',
  'pause', 'settings', 'quality', 'controls', 'sell', 'shop', 'pc', 'dex', 'method', 'skills', 'tackle', 'hookSize', 'camp',
  'map', 'bed', 'stat', 'mod', 'unit', 'list',
];
const KEY_RE = new RegExp(`^(?:${NAMESPACES.join('|')})\\.[A-Za-z0-9_.]*[A-Za-z0-9_]$`);

describe('ui.strings', () => {
  const files = jsFiles(join(ROOT, 'src', 'ui'));

  test("src/ui/** 의 t('…') 리터럴 키가 전부 STRINGS 에 있다", () => {
    assert.ok(files.length >= 10, 'ui 파일을 찾지 못했다');
    const missing = [];
    let count = 0;
    for (const f of files) {
      const src = stripComments(readFileSync(f, 'utf8'));
      for (const m of src.matchAll(/\bt\(\s*(['"`])([^'"`$]+)\1\s*[,)]/g)) {
        count++;
        if (!has(m[2])) missing.push(`${f.slice(ROOT.length + 1)}: t('${m[2]}')`);
      }
    }
    assert.ok(count > 50, `t() 리터럴이 너무 적다(${count}) — 정규식 확인`);
    assert.deepEqual(missing, []);
  });

  test('src/ui/** 의 키 모양 리터럴(numText · 조건식으로 넘기는 키 포함)이 전부 STRINGS 에 있다', () => {
    const missing = [];
    for (const f of files) {
      const src = stripComments(readFileSync(f, 'utf8'));
      for (const m of src.matchAll(/(['"])([A-Za-z][A-Za-z0-9_.]*)\1/g)) {
        const s = m[2];
        if (!s.includes('.') || s.endsWith('.')) continue;   // 접두사(동적 키) · 키 아님
        if (!KEY_RE.test(s)) continue;
        if (!has(s)) missing.push(`${f.slice(ROOT.length + 1)}: '${s}'`);
      }
    }
    assert.deepEqual(missing, []);
  });

  test('부록 B 키 전부 존재', () => {
    const fixed = [
      'fail.loss', 'fail.spareSpool', 'fail.dragLowered', 'fail.hookSmall',
      'fatal.webglTitle', 'fatal.webglBody', 'title.noStorage', 'title.needInput', 'title.saveBroken', 'title.saveFuture', 'save.failed',
      'prompt.clickToLook', 'hud.levelMax', 'hud.skillPoints', 'banner.levelUp', 'banner.tier3',
      'confirm.newGame.title', 'confirm.newGame.body', 'result.swap',
    ];
    const families = [];
    for (const s of SPECIES) families.push('species.' + s.id);
    for (const id of SCENE_IDS) families.push('stage.' + id);
    for (const id of STAGE_IDS) families.push('stagePlace.' + id, 'npc.' + id + '.greet');
    for (const id of Object.keys(SPOTS_BY_ID)) families.push('spot.' + id);
    for (const g of GEAR) families.push('gear.' + g.id);
    for (const id of BAIT_IDS) families.push('bait.' + id);
    for (const id of SKILL_IDS) {
      families.push('skill.' + id);
      for (let r = 1; r <= 3; r++) families.push(`skillDesc.${id}.${r}`);
    }
    for (const id of BAND_IDS) families.push('band.' + id);
    for (const id of WEATHER_IDS) families.push('weather.' + id);
    for (const id of LAYER_IDS) families.push('layer.' + id);
    for (const id of SET_IDS) families.push('set.' + id);
    for (const id of TIERS) families.push('tier.' + id);
    for (const id of STYLE_IDS) families.push('style.' + id);
    for (const id of FAIL_REASONS) families.push('fail.' + id);
    for (const id of ['slack', 'jump', 'shake', 'active']) families.push('fail.cause.' + id);
    const reasons = ['stub', 'busy', 'locked', 'same', 'holdFull', 'noBait', 'noLine', 'money', 'level', 'mastery', 'notOwned', 'inUse',
      'wrongSlot', 'wrongSet', 'maxRank', 'noPoints', 'notHere', 'invalid', 'full', 'holdFullCast'];
    for (const id of reasons) families.push('reason.' + id);
    for (const id of HINT_IDS) families.push(`hint.${id}.title`, `hint.${id}.body`);
    const missing = [...fixed, ...families].filter(k => !has(k));
    assert.deepEqual(missing, []);
    assert.equal(SPECIES.length, 36);
  });

  test('ui 가 조립하는 동적 키 — 패널 · 상호작용 · 예고 · 부위 · 화질 · 볼륨 · 방식 · 바늘 · 스킬 효과', () => {
    const keys = [];
    for (const id of PANEL_IDS) keys.push('panel.' + id);
    for (const k of INTERACT_KINDS) keys.push('prompt.' + k);
    for (const k of ['run', 'jump', 'dive', 'charge']) keys.push('hud.tele.' + k);
    for (const s of GEAR_SLOTS) keys.push('shop.slot.' + s);
    keys.push('shop.slot.bait');
    for (const q of SETTINGS_RANGE.quality) keys.push('quality.' + q);
    for (const v of SETTINGS_RANGE.volumeKeys) keys.push('settings.volume.' + v);
    for (const m of ['float', 'bottom', 'both']) keys.push('method.' + m);
    for (const n of [1, 2, 3]) keys.push('hookSize.' + n);
    for (const sk of SKILLS) for (const field of Object.keys(sk.effects)) keys.push('mod.' + field);
    for (const s of SPECIES) keys.push('method.' + s.method);
    const missing = keys.filter(k => !has(k));
    assert.deepEqual(missing, []);
  });

  test('strings.ko.js — 같은 키가 두 번 없다 · 값은 비지 않은 문자열 · {자리} 짝', () => {
    const src = readFileSync(join(ROOT, 'src', 'data', 'strings.ko.js'), 'utf8');
    const seen = new Map();
    const dup = [];
    for (const m of src.matchAll(/^\s*'([^']+)'\s*:/gm)) {
      if (seen.has(m[1])) dup.push(m[1]);
      seen.set(m[1], true);
    }
    assert.deepEqual(dup, []);
    assert.equal(seen.size, Object.keys(STRINGS).length, '소스의 키 수와 객체의 키 수가 다르다');
    for (const [k, v] of Object.entries(STRINGS)) {
      assert.equal(typeof v, 'string', k);
      assert.ok(v.length > 0, `빈 문면: ${k}`);
      const open = (v.match(/\{/g) || []).length;
      const close = (v.match(/\}/g) || []).length;
      assert.equal(open, close, `중괄호 짝: ${k}`);
      for (const p of v.matchAll(/\{([^}]*)\}/g)) assert.match(p[1], /^\w+$/, `자리 이름: ${k}`);
    }
  });

  test('i18n.t — {name} 치환 · 숫자 · 없는 키는 키 그대로(경고) · has', () => {
    assert.equal(t('reason.level', { n: 5 }), STRINGS['reason.level'].replace('{n}', '5'));
    assert.equal(t('hud.hold', { n: 3, cap: 12 }), STRINGS['hud.hold'].replace('{n}', '3').replace('{cap}', '12'));
    assert.equal(has('hud.tension'), true);
    assert.equal(has('nope.never'), false);
    const warn = console.warn;
    let warned = 0;
    console.warn = () => { warned++; };
    try {
      assert.equal(t('nope.never'), 'nope.never');
      assert.equal(t('nope.never'), 'nope.never');
    } finally {
      console.warn = warn;
    }
    assert.equal(warned, 1, '같은 없는 키는 한 번만 경고');
  });
});

describe('ui 패널 스택(§10.4)', () => {
  test('바탕 교체 · 겹침 쌓기 · 깊이 상한 · title 은 스택을 비운다', () => {
    const st = new PanelStack();
    let r = st.open('tackle');
    assert.ok(r.ok);
    assert.equal(st.top.id, 'tackle');
    r = st.open('confirm', { danger: true });
    assert.deepEqual(st.entries.map(e => e.id), ['tackle', 'confirm']);
    r = st.open('pause');
    assert.deepEqual(st.entries.map(e => e.id), ['tackle', 'confirm', 'pause']);
    assert.equal(st.depth, MAX_DEPTH);
    r = st.open('confirm');
    assert.equal(r.ok, false, '깊이 3이면 더 쌓지 않는다');
    r = st.open('sell');
    assert.equal(r.ok, false, 'pause 가 맨 위면 confirm 말고는 무시');
    r = st.open('title');
    assert.ok(r.ok);
    assert.deepEqual(st.entries.map(e => e.id), ['title']);
    assert.deepEqual(r.closed.map(c => c.entry.id), ['pause', 'confirm', 'tackle']);
    assert.deepEqual(r.closed.map(c => c.depth), [2, 1, 0]);
  });

  test('바탕 패널 열기는 바탕을 바꾸고 위의 겹침을 닫는다', () => {
    const st = new PanelStack();
    st.open('pc');
    st.open('confirm');
    const r = st.open('sell');
    assert.ok(r.ok);
    assert.deepEqual(st.entries.map(e => e.id), ['sell']);
    assert.deepEqual(r.closed.map(c => c.entry.id), ['confirm', 'pc']);
    assert.deepEqual(r.opened.map(c => [c.entry.id, c.depth]), [['sell', 1]]);
  });

  test('포커스 잃음 pause 는 결과 · 타이틀 · 확인을 지우지 않는다 — 닫으면 아래가 그대로', () => {
    for (const base of ['result', 'title']) {
      const st = new PanelStack();
      st.open(base, { x: 1 });
      st.open('confirm', { y: 2 });
      st.open('pause');
      assert.deepEqual(st.entries.map(e => e.id), [base, 'confirm', 'pause']);
      st.close();
      assert.equal(st.top.id, 'confirm');
      assert.deepEqual(st.top.args, { y: 2 }, '아래 패널은 같은 args');
      st.close();
      assert.equal(st.top.id, base);
      assert.deepEqual(st.top.args, { x: 1 });
    }
  });

  test('결과 · 타이틀 바탕은 다른 바탕으로 교체되지 않는다(고를 때까지)', () => {
    const st = new PanelStack();
    st.open('result');
    assert.equal(st.open('tackle').ok, false);
    assert.equal(st.open('sell').ok, false);
    assert.equal(st.top.id, 'result');
    const st2 = new PanelStack();
    st2.open('title');
    assert.equal(st2.open('pc').ok, false);
    assert.equal(st2.open('title').ok, true, 'title 은 언제나');
  });

  test('pause 위에 pause 는 쌓지 않는다 · 모르는 패널은 무시', () => {
    const st = new PanelStack();
    st.open('pause');
    assert.equal(st.open('pause').ok, false);
    assert.equal(st.open('nope').ok, false);
    assert.equal(st.depth, 1);
  });

  test('remove — 결과 단계가 끝난 result 를 스택 어디서든 뺀다(위의 겹침은 남는다)', () => {
    const st = new PanelStack();
    st.open('result');
    st.open('pause');
    const r = st.remove('result');
    assert.ok(r.ok);
    assert.deepEqual(st.entries.map(e => e.id), ['pause']);
    assert.deepEqual(r.closed.map(c => [c.entry.id, c.depth]), [['result', 1]]);
    assert.equal(st.remove('result').ok, false);
    assert.equal(st.close().ok, true);
    assert.equal(st.close().ok, false, '빈 스택 닫기는 아무것도 안 한다');
    assert.equal(st.top, null);
  });
});
