// OWNER: P0 — 계약 §12.2(purity.test) · §2 · §11.9 · §10.6 (W0 완성 · 이후 고치지 않는다 — 결함은 NOTES-P#)
// 소스를 훑는다: 순수 계층의 금지 토큰 · 계층 import 규칙 · 상대 import 경로의 대소문자 · 동적 import 없음 · 부팅 표식 · 한국어 문자열 리터럴 위치.
// 주석(//, /* */, JSDoc)은 먼저 지운다 — 주석의 한국어 · 낱말은 된다. 한국어 검사는 문자열 리터럴(작은따옴표 · 큰따옴표 · 백틱) 안만 본다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const PURE_LAYERS = ['core', 'data', 'sim', 'bot', 'debug'];
/** §2.1 — 순수 계층이 import 해도 되는 계층(types.js 는 어디서나) */
const ALLOWED = {
  core: ['core'],
  data: ['core', 'data'],
  sim: ['core', 'data', 'sim'],
  bot: ['core', 'data', 'sim', 'bot'],
  debug: ['core', 'data', 'sim'],
};
/** §2.1 — debug 가 sim 에서 가져와도 되는 것(상태를 만드는 순수 함수만) */
const DEBUG_SIM_NAMES = ['createNewProfile', 'createRigState', 'deriveClock', 'fightConstants', 'rigStats', 'computeModifiers'];
const FORBIDDEN = [
  ['window', /(?<![\w$.])window(?![\w$])(?!\s*:)/],
  ['document', /(?<![\w$.])document(?![\w$])(?!\s*:)/],
  ['AudioContext', /\b(?:webkit)?AudioContext\b/],
  ['localStorage', /(?<![\w$.])localStorage(?![\w$])(?!\s*:)/],
  ['performance.', /(?<![\w$.])performance\s*\./],
  ['Date.now', /\bDate\s*\.\s*now\b/],
  ['Math.random', /\bMath\s*\.\s*random\b/],
  ['requestAnimationFrame', /(?<![\w$.])requestAnimationFrame\b/],
  ['setTimeout', /(?<![\w$.])setTimeout\b/],
];
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힣]/;
const REGEX_PREV = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
const REGEX_WORDS = /\b(?:return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await)$/;

/** src 아래 파일(확장자 필터) — 상대 경로는 '/' 로 */
function listFiles(dir, exts) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p, exts));
    else if (exts.some(e => name.endsWith(e))) out.push(p);
  }
  return out;
}
const rel = (p) => relative(ROOT, p).split(sep).join('/');

/**
 * 작은 렉서: 주석을 지우고 문자열 리터럴을 모은다.
 * @returns {{keep:string, bare:string, strings:Array<{text:string, line:number}>}}
 *   keep: 주석만 지운 코드 · bare: 문자열 · 정규식 내용까지 비운 코드
 */
export function lex(src) {
  let keep = '';
  let bare = '';
  const strings = [];
  let i = 0;
  let line = 1;
  let last = '';
  const n = src.length;
  const push = (k, b) => { keep += k; bare += b; };
  while (i < n) {
    const ch = src[i];
    const nx = src[i + 1];
    if (ch === '\n') line++;
    if (ch === '/' && nx === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
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
      let j = i + 1;
      let text = '';
      let depth = 0;
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
      let j = i + 1;
      let inClass = false;
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
    const names = [...clause.matchAll(/\b([A-Za-z_$][\w$]*)\b(?:\s+as\s+[\w$]+)?/g)].map(x => x[1]).filter(x => x !== 'as' && x !== 'type');
    out.push({ spec: m[3], clause, names });
  }
  return out;
}

/** 디스크의 이름과 대소문자까지 같은가 */
function existsExact(absPath) {
  const r = relative(ROOT, absPath);
  if (r.startsWith('..')) return existsSync(absPath);
  let cur = ROOT;
  for (const seg of r.split(sep)) {
    if (!existsSync(cur) || !statSync(cur).isDirectory()) return false;
    if (!readdirSync(cur).includes(seg)) return false;
    cur = join(cur, seg);
  }
  return true;
}

const layerOf = (abs) => {
  const r = relative(SRC, abs).split(sep);
  return r.length > 1 ? r[0] : r[0];   // 'types.js' · 'main.js' 는 최상위 파일
};

const FILES = listFiles(SRC, ['.js']);
const PARSED = new Map(FILES.map(f => [f, lex(readFileSync(f, 'utf8'))]));

test('순수 계층(core · data · sim · bot · debug)에 금지 토큰이 없다', () => {
  const bad = [];
  for (const f of FILES) {
    if (!PURE_LAYERS.includes(layerOf(f))) continue;
    const { bare, keep } = PARSED.get(f);
    for (const [name, re] of FORBIDDEN) {
      const m = bare.match(re);
      if (m) bad.push(`${rel(f)}: ${name}`);
    }
    for (const imp of importsOf(keep)) {
      if (imp.spec === 'three' || imp.spec.startsWith('three/')) bad.push(`${rel(f)}: import '${imp.spec}'`);
    }
  }
  assert.deepEqual(bad, [], `순수 계층 위반:\n${bad.join('\n')}`);
});

test('순수 계층의 import 는 §2.1 표 안에서만 · debug 는 sim 에서 상태를 만드는 순수 함수만 · fixtures 는 app 만 import', () => {
  const bad = [];
  for (const f of FILES) {
    const layer = layerOf(f);
    const { keep } = PARSED.get(f);
    for (const imp of importsOf(keep)) {
      if (!imp.spec.startsWith('.')) {
        if (PURE_LAYERS.includes(layer) && imp.spec !== 'node:test') bad.push(`${rel(f)}: 외부 모듈 '${imp.spec}'`);
        continue;
      }
      const target = resolve(dirname(f), imp.spec);
      const tl = layerOf(target);
      if (tl === 'debug' && layer !== 'app' && rel(f) !== 'src/main.js' && layer !== 'debug') bad.push(`${rel(f)}: debug/ 는 app 만 import 한다`);
      if (!PURE_LAYERS.includes(layer)) continue;
      if (tl === 'types.js') continue;
      if (!ALLOWED[layer].includes(tl)) bad.push(`${rel(f)}: ${layer} → ${tl} ('${imp.spec}')`);
      if (layer === 'debug' && tl === 'sim') {
        const extra = imp.names.filter(nm => !DEBUG_SIM_NAMES.includes(nm));
        if (extra.length || imp.clause.includes('*')) bad.push(`${rel(f)}: debug 가 sim 에서 ${extra.join(', ') || '*'} 를 가져온다`);
      }
    }
  }
  assert.deepEqual(bad, [], `계층 규칙 위반:\n${bad.join('\n')}`);
});

test('src 전체의 상대 import 경로가 디스크의 파일 이름과 대소문자까지 같다 · 동적 import() 없음', () => {
  const bad = [];
  for (const f of FILES) {
    const { keep, bare } = PARSED.get(f);
    for (const imp of importsOf(keep)) {
      if (!imp.spec.startsWith('.')) continue;
      const target = resolve(dirname(f), imp.spec);
      if (!existsSync(target)) bad.push(`${rel(f)}: 없는 파일 '${imp.spec}'`);
      else if (!existsExact(target)) bad.push(`${rel(f)}: 대소문자가 다르다 '${imp.spec}'`);
    }
    if (/\bimport\s*\(/.test(bare)) bad.push(`${rel(f)}: 동적 import() — 단일 번들이 깨진다`);
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('부팅 표식: main.js 또는 app/Game.js 가 bootMarker 의 markReady · markError 를 import · 그 밖의 파일은 dataset 표식을 쓰지 않는다', () => {
  const entries = ['src/main.js', 'src/app/Game.js'].map(p => join(ROOT, p)).filter(existsSync);
  const ok = entries.some(f => {
    const imps = importsOf(PARSED.get(f).keep).filter(i => i.spec === './app/bootMarker.js' || i.spec === './bootMarker.js');
    const names = imps.flatMap(i => i.names);
    return names.includes('markReady') && names.includes('markError');
  });
  assert.ok(ok, 'src/main.js 또는 src/app/Game.js 가 markReady · markError 를 bootMarker.js 에서 import 해야 한다');
  const bad = [];
  for (const f of FILES) {
    if (rel(f) === 'src/app/bootMarker.js') continue;
    const raw = readFileSync(f, 'utf8');
    if (/dataset\s*\.\s*game(?:Ready|Error)|data-game-(?:ready|error)/.test(raw)) bad.push(rel(f));
  }
  assert.deepEqual(bad, [], `부팅 표식은 bootMarker.js 만 쓴다: ${bad.join(', ')}`);
});

test('한국어 문자열 리터럴은 src/data/strings.ko.js 에만 있다(주석은 된다)', () => {
  const bad = [];
  for (const f of FILES) {
    if (rel(f) === 'src/data/strings.ko.js') continue;
    for (const s of PARSED.get(f).strings) if (HANGUL.test(s.text)) bad.push(`${rel(f)}:${s.line}: ${s.text.slice(0, 40)}`);
  }
  assert.deepEqual(bad, [], `UI 문면은 strings.ko.js 하나(CLAUDE.md):\n${bad.join('\n')}`);
});

test('렉서 자체 검사 — 주석 · 정규식 · 템플릿을 구분한다', () => {
  const src = [
    "// window 주석 '한글'",
    '/* document',
    ' * Math.random() */',
    "const a = 'w/in' + \"q\" + `t${1 + 2}x`; const r = /\\/\\/[a/]x/g.test(a) ? 1 : 2;",
    "const b = 6 / 2 / 3; const c = { window: 1 }.window;",
    "import x from './y.js'; export { z } from \"../w.js\";",
  ].join('\n');
  const { bare, strings, keep } = lex(src);
  assert.ok(!/window|document|Math\.random/.test(bare.replace(/\{ window: 1 \}\.window/, '')), '주석은 지워진다');
  assert.ok(!FORBIDDEN[0][1].test(bare), '객체 키 · 속성 이름 window 는 걸리지 않는다');
  assert.deepEqual(strings.map(s => s.text), ['w/in', 'q', 't${1 + 2}x', './y.js', '../w.js']);
  assert.match(bare, /6 \/ 2 \/ 3/, '나눗셈은 정규식이 아니다');
  assert.deepEqual(importsOf(keep).map(i => i.spec), ['./y.js', '../w.js']);
  assert.ok(FORBIDDEN[0][1].test(lex('const w = window.innerWidth;').bare));
  assert.ok(FORBIDDEN[6][1].test(lex('x = Math.random();').bare));
  assert.ok(HANGUL.test(lex("t('붕어')").strings[0].text));
});
