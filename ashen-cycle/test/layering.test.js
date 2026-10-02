// OWNER: P0 — 계약 §2 · §12.2 「layering.test.js」
// 1) 금지 의존 검사: src의 모든 .js에서 import 경로를 뽑아 §2의 표와 맞춘다(주석은 지우고 본다 — JSDoc의 import('…')는 타입이라 허용).
// 2) 순수성 검사: src/sim · src/data · src/core · src/bot의 코드에 three · DOM · WebAudio · 시계 · Math.random 토큰이 없다.
// 3) import 스모크: 위 네 폴더의 모든 파일이 Node에서 예외 없이 로드된다.
// 4) 레지스트리 · 스텁 모양: EV 값이 서로 다르다 · 세 보스 정의/훅 · 생성 함수가 §3의 전 필드를 채운다.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

/** @param {string} dir @returns {string[]} dir 아래의 모든 .js(절대 경로) */
function listJs(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listJs(p));
    else if (name.endsWith('.js')) out.push(p);
  }
  return out.sort();
}

/** src 기준 경로(슬래시). @param {string} abs */
const rel = (abs) => relative(SRC, abs).split(sep).join('/');

/**
 * 소스에서 주석을 지운다(문자열 · 템플릿 리터럴 안의 // 는 건드리지 않는다).
 * blankStrings면 문자열 내용도 지운다(토큰 검사용 — 문자열 안의 단어는 코드가 아니다).
 * @param {string} src
 * @param {boolean} blankStrings
 * @returns {string}
 */
function stripCode(src, blankStrings) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i += 1;
    } else if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      for (let k = i; k < stop; k++) if (src[k] === '\n') out += '\n';
      i = stop;
    } else if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n && src[j] !== c) {
        if (src[j] === '\\') j += 1;
        j += 1;
      }
      out += blankStrings ? c + c : src.slice(i, j + 1);
      i = j + 1;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

/**
 * import/export 문의 경로를 뽑는다(정적 · 부수 효과 · 동적 · 재수출).
 * @param {string} code 주석을 지운 소스
 * @returns {string[]}
 */
function importSpecs(code) {
  const specs = [];
  const res = [
    /\b(?:import|export)\b[^'"`;()]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
  ];
  for (const re of res) {
    for (const m of code.matchAll(re)) specs.push(m[1]);
  }
  return specs;
}

/**
 * 경로 하나를 분류한다.
 * @param {string} fileAbs import 하는 파일
 * @param {string} spec
 * @returns {{kind:'pkg', name:string} | {kind:'src', path:string, layer:string, exists:boolean} | {kind:'outside', path:string}}
 */
function classify(fileAbs, spec) {
  if (!spec.startsWith('.') && !spec.startsWith('/')) return { kind: 'pkg', name: spec };
  const target = resolve(dirname(fileAbs), spec);
  const r = relative(SRC, target).split(sep).join('/');
  if (r.startsWith('..')) return { kind: 'outside', path: r };
  const seg = r.split('/');
  return { kind: 'src', path: r, layer: seg.length > 1 ? seg[0] : '(root)', exists: existsSync(target) };
}

/** §2 표 — 계층별로 import 할 수 있는 src 계층과 패키지. */
const RULES = {
  core: { layers: ['core'], pkg: () => false },
  data: { layers: ['core', 'data'], pkg: () => false },
  sim: { layers: ['core', 'data', 'sim'], pkg: () => false },
  bot: { layers: ['core', 'data', 'bot'], pkg: () => false },
  view: { layers: ['core', 'data', 'view'], pkg: (name) => name === 'three' || name.startsWith('three/addons/') },
  audio: { layers: ['core', 'data', 'audio'], pkg: () => false },
  ui: { layers: ['core', 'data', 'ui'], pkg: () => false },
};

/** sim 안의 순환 금지 지점(§2). [가져오는 쪽 접두, 금지 대상 접두 목록] */
const SIM_SUBRULES = [
  ['sim/player/', ['sim/boss/', 'sim/combat/', 'sim/GameSim.js']],
  ['sim/boss/', ['sim/player/', 'sim/combat/', 'sim/GameSim.js']],
  ['sim/progression/', ['sim/']], // progression은 자기 폴더 말고 sim의 다른 곳을 import하지 않는다(아래에서 자기 폴더는 뺀다)
];

/** 순수 계층에서 금지하는 토큰(주석 · 문자열을 지운 코드에서 찾는다). */
const PURE_FORBIDDEN = [
  [/\bwindow\b/, 'window'],
  [/\bdocument\b/, 'document'],
  [/\bnavigator\b/, 'navigator'],
  [/\bAudioContext\b/, 'AudioContext'],
  [/\blocalStorage\b/, 'localStorage'],
  [/\bsessionStorage\b/, 'sessionStorage'],
  [/\bperformance\s*\./, 'performance.*'],
  [/\bDate\s*\.\s*now\b/, 'Date.now'],
  [/\bnew\s+Date\b/, 'new Date'],
  [/\bMath\s*\.\s*random\b/, 'Math.random'],
  [/\brequestAnimationFrame\b/, 'requestAnimationFrame'],
  [/\bTHREE\b/, 'THREE'],
];

const PURE_DIRS = ['sim', 'data', 'core', 'bot'];
const pureFiles = PURE_DIRS.flatMap((d) => listJs(join(SRC, d)));
const allFiles = listJs(SRC);

describe('§2 의존 규칙 — import 경로', () => {
  test('검사 대상 파일이 있다', () => {
    assert.ok(pureFiles.length >= 40, `sim/data/core/bot 파일 ${pureFiles.length}개`);
    for (const d of PURE_DIRS) assert.ok(listJs(join(SRC, d)).length > 0, `src/${d}가 비어 있다`);
  });

  test('계층별 금지 의존이 없다 · 깨진 상대 경로가 없다', () => {
    const errors = [];
    for (const file of allFiles) {
      const r = rel(file);
      const layer = r.includes('/') ? r.split('/')[0] : '(root)';
      const rule = RULES[layer]; // app · (root)는 전부 허용 — 깨진 경로만 본다
      const code = stripCode(readFileSync(file, 'utf8'), false);
      for (const spec of importSpecs(code)) {
        const c = classify(file, spec);
        if (c.kind === 'outside') {
          errors.push(`${r}: src 밖을 import — '${spec}'`);
        } else if (c.kind === 'pkg') {
          if (rule && !rule.pkg(c.name)) errors.push(`${r}: 패키지 '${spec}' import 금지(${layer})`);
        } else {
          if (!c.exists) errors.push(`${r}: 없는 파일 — '${spec}'`);
          if (rule && !rule.layers.includes(c.layer)) errors.push(`${r}: '${spec}' → ${c.layer} import 금지(${layer})`);
          for (const [from, banned] of SIM_SUBRULES) {
            if (!r.startsWith(from)) continue;
            for (const b of banned) {
              const selfOk = b === 'sim/' && c.path.startsWith(from);
              if (c.path.startsWith(b) && !selfOk) errors.push(`${r}: '${spec}' → ${c.path} import 금지(§2 sim 안의 순환 금지 지점)`);
            }
          }
        }
      }
    }
    assert.deepEqual(errors, []);
  });

  test('레지스트리는 한 방향 — 보스 파일이 index를 import하지 않는다', () => {
    const errors = [];
    for (const dir of ['data/bosses', 'sim/boss/hooks', 'view/bosses']) {
      for (const file of listJs(join(SRC, dir))) {
        if (file.endsWith(`${sep}index.js`)) continue;
        const code = stripCode(readFileSync(file, 'utf8'), false);
        for (const spec of importSpecs(code)) {
          const c = classify(file, spec);
          if (c.kind === 'src' && c.path === `${dir}/index.js`) errors.push(`${rel(file)}: index.js를 import — 순환`);
        }
      }
    }
    assert.deepEqual(errors, []);
  });

  test('view의 세 레이어는 서로 import하지 않는다', () => {
    const layers = {
      'view/world/WorldLayer.js': ['view/characters/', 'view/fx/'],
      'view/characters/CharacterLayer.js': ['view/world/', 'view/fx/'],
      'view/fx/FxLayer.js': ['view/world/', 'view/characters/'],
    };
    const errors = [];
    for (const [r, banned] of Object.entries(layers)) {
      const file = join(SRC, r);
      if (!existsSync(file)) continue;
      const code = stripCode(readFileSync(file, 'utf8'), false);
      for (const spec of importSpecs(code)) {
        const c = classify(file, spec);
        if (c.kind === 'src' && banned.some((b) => c.path.startsWith(b))) errors.push(`${r}: '${spec}' import 금지`);
      }
    }
    assert.deepEqual(errors, []);
  });

  test('default export가 없다(§0.4 named export만)', () => {
    const errors = [];
    for (const file of allFiles) {
      const code = stripCode(readFileSync(file, 'utf8'), true);
      if (/\bexport\s+default\b/.test(code)) errors.push(rel(file));
    }
    assert.deepEqual(errors, []);
  });
});

describe('순수성 — sim · data · core · bot', () => {
  test('three · DOM · WebAudio · 시계 · Math.random 토큰이 없다', () => {
    const errors = [];
    for (const file of pureFiles) {
      const code = stripCode(readFileSync(file, 'utf8'), true);
      const lines = code.split('\n');
      for (const [re, label] of PURE_FORBIDDEN) {
        lines.forEach((line, i) => {
          if (re.test(line)) errors.push(`${rel(file)}:${i + 1}: ${label}`);
        });
      }
    }
    assert.deepEqual(errors, []);
  });

  test('모든 파일이 Node에서 예외 없이 로드된다', async () => {
    for (const file of pureFiles) {
      await assert.doesNotReject(() => import(pathToFileURL(file).href), `${rel(file)} 로드 실패`);
    }
  });
});

describe('레지스트리 · 스텁 모양', () => {
  test('EV의 값이 서로 다르다', async () => {
    const { EV } = await import('../src/core/events.js');
    const values = Object.values(EV);
    assert.ok(values.length > 0);
    assert.equal(new Set(values).size, values.length);
    for (const v of values) assert.equal(typeof v, 'string');
  });

  test('BOSS_IDS의 세 정의가 getBossDef로 나온다 · 훅 레지스트리', async () => {
    const { BOSS_IDS } = await import('../src/core/constants.js');
    const { BOSS_DEFS, getBossDef } = await import('../src/data/bosses/index.js');
    const { getBossHooks } = await import('../src/sim/boss/hooks/index.js');
    const { getWorld } = await import('../src/data/world.js');
    assert.deepEqual(Object.keys(BOSS_DEFS), BOSS_IDS);
    for (const id of BOSS_IDS) {
      const def = getBossDef(id);
      assert.ok(def, `getBossDef('${id}')`);
      assert.equal(def.id, id);
      assert.ok(def.hp > 0 && def.reward > 0 && def.radius > 0);
      assert.ok(def.attacks[def.fallbackAttack], `${id}.fallbackAttack이 attacks에 없다`);
      for (const [key, atk] of Object.entries(def.attacks)) assert.equal(atk.id, key);
      const world = getWorld(def.arenaId);
      assert.ok(world && world.kind === 'arena' && world.bossSpawn, `${id}.arenaId`);
      assert.equal(typeof getBossHooks(id), 'object');
    }
    assert.deepEqual(getBossHooks('nobody'), {});
    assert.equal(getBossDef('nobody'), undefined);
  });

  test('무기 3종 · 월드 4개 · 새 프로필', async () => {
    const { WEAPON_IDS, BOSS_IDS, STAT_IDS } = await import('../src/core/constants.js');
    const { WEAPONS, getWeaponDef, getMoveDef } = await import('../src/data/weapons.js');
    const { WORLDS } = await import('../src/data/world.js');
    const { createNewProfile } = await import('../src/sim/progression/profile.js');
    assert.deepEqual(Object.keys(WEAPONS), WEAPON_IDS);
    for (const id of WEAPON_IDS) {
      const w = getWeaponDef(id);
      assert.equal(w.id, id);
      assert.ok(w.baseDamage > 0 && w.reach > 0 && w.length > 0);
      for (const [key, m] of Object.entries(w.moves)) {
        assert.equal(m.id, key);
        assert.equal(getMoveDef(id, key), m);
        if (m.next !== null) assert.ok(w.moves[m.next], `${id}.${key}.next = ${m.next}`);
      }
    }
    assert.equal(getMoveDef('longsword', 'nope'), null);
    assert.deepEqual(Object.keys(WORLDS), ['town', 'arena_valder', 'arena_fenrir', 'arena_nihil']);
    for (const [id, w] of Object.entries(WORLDS)) assert.equal(w.id, id);
    const p = createNewProfile(7);
    assert.equal(p.seed, 7);
    assert.deepEqual(Object.keys(p.weapons), WEAPON_IDS);
    assert.deepEqual(Object.keys(p.bosses), BOSS_IDS);
    assert.deepEqual(Object.keys(p.stats), STAT_IDS);
    assert.deepEqual(BOSS_IDS.map((b) => p.bosses[b].unlocked), [true, false, false]);
    assert.equal(p.equippedWeapon, 'longsword');
    structuredClone(p);
  });

  test('GameSim이 스텁/완성본 어느 쪽이든 유효한 상태로 뜬다(§3의 전 필드 · structuredClone 가능)', async () => {
    const { EventBus, EV } = await import('../src/core/events.js');
    const { DT, BOSS_IDS } = await import('../src/core/constants.js');
    const { NEUTRAL_INPUT } = await import('../src/core/inputFrame.js');
    const { GameSim } = await import('../src/sim/GameSim.js');
    const { createNewProfile } = await import('../src/sim/progression/profile.js');
    const types = readFileSync(join(SRC, 'types.js'), 'utf8');
    /** @param {string} name @returns {string[]} 필수 @property 이름 */
    const props = (name) => {
      const start = types.search(new RegExp(`@typedef \\{Object\\} ${name}\\r?\\n`));
      assert.ok(start >= 0, `typedef ${name}`);
      const out = [];
      for (const line of types.slice(start, types.indexOf('*/', start)).split(/\r?\n/)) {
        const at = line.indexOf('@property');
        if (at < 0) continue;
        let i = line.indexOf('{', at);
        let depth = 0;
        for (; i < line.length; i++) {
          if (line[i] === '{') depth += 1;
          else if (line[i] === '}' && --depth === 0) break;
        }
        const m = /^\s*(\[?)(\w+)/.exec(line.slice(i + 1));
        if (m && !m[1]) out.push(m[2]);
      }
      return out;
    };
    const hasAll = (obj, name) => {
      for (const k of props(name)) assert.ok(k in obj, `${name}.${k}가 없다`);
    };

    const bus = new EventBus();
    const seen = [];
    bus.onAny((name) => seen.push(name));
    const sim = new GameSim({ profile: createNewProfile(1), bus });
    assert.deepEqual(seen, [], '생성자는 이벤트를 내지 않는다');
    assert.equal(sim.state.mode, 'town');
    hasAll(sim.state, 'GameState');
    hasAll(sim.state.player, 'PlayerState');
    hasAll(sim.state.player.stats, 'StatBlock');
    hasAll(sim.state.dummy, 'DummyState');
    hasAll(sim.state.profile, 'Profile');
    structuredClone(sim.state);
    for (let i = 0; i < 10; i++) sim.step(DT, NEUTRAL_INPUT);
    assert.equal(sim.state.tick, 10);

    for (const id of BOSS_IDS) {
      seen.length = 0;
      sim.startBossFight(id);
      assert.equal(seen[0], EV.MODE_CHANGED);
      assert.equal(sim.state.mode, 'boss');
      assert.equal(sim.state.boss.id, id);
      hasAll(sim.state.boss, 'BossState');
      hasAll(sim.state.fight, 'FightState');
      assert.equal(sim.state.events.length, 0, '플러시 뒤 큐는 빈다');
      for (let i = 0; i < 10; i++) sim.step(DT, NEUTRAL_INPUT);
      structuredClone(sim.state);
    }
    seen.length = 0;
    sim.enterTown();
    assert.equal(seen[0], EV.MODE_CHANGED);
    assert.equal(sim.state.mode, 'town');
    assert.equal(sim.state.boss, null);
    assert.equal(sim.state.fight, null);
    sim.dispose();
  });
});
