// OWNER: P4 — 계약 §12.2 「save.test.js」
// 저장 사슬: createSaveData → serializeSave → parseSave → migrateSave → sanitizeProfile → validateProfile.
// 읽기 쪽은 어떤 입력에서도 던지지 않는다. core · data · sim/progression만 본다.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SAVE_VERSION, BOSS_IDS, WEAPON_IDS, STAT_IDS } from '../src/core/constants.js';
import { STATS } from '../src/data/stats.js';
import { DEFAULT_SETTINGS, SETTINGS_RANGE } from '../src/data/settings.js';
import { createNewProfile } from '../src/sim/progression/profile.js';
import { computeStatBlock } from '../src/sim/progression/stats.js';
import { computeReward, applyReward, noteAttempt } from '../src/sim/progression/economy.js';
import { Progression } from '../src/sim/progression/Progression.js';
import {
  createSaveData, serializeSave, parseSave, migrateSave, sanitizeProfile, sanitizeSettings, validateProfile, loadProfileFromText,
} from '../src/sim/progression/save.js';
import { makeTestProfile, assertFiniteDeep } from './helpers.js';

/** 한참 플레이한 프로필(레벨 · 강화 · 유물 · 격파 · 순환이 다 들어 있다). */
function playedProfile() {
  const p = createNewProfile(424242);
  const prog = new Progression(p, undefined);
  for (const id of BOSS_IDS) {
    noteAttempt(p, id);
    applyReward(p, computeReward(p, id, { victory: false, damageFraction: 0.55, duration: 61.25 }));
    noteAttempt(p, id);
    applyReward(p, computeReward(p, id, { victory: true, damageFraction: 1, duration: 93.5 }));
  }
  noteAttempt(p, 'valder');
  applyReward(p, computeReward(p, 'valder', { victory: false, damageFraction: 0.31, duration: 40 }));
  prog.grant(20000, 0);
  for (const id of ['vit', 'vit', 'str', 'str', 'str', 'end', 'dex']) assert.equal(prog.levelUp(id).ok, true);
  for (let i = 0; i < 4; i++) assert.equal(prog.upgradeWeapon('greatsword').ok, true);
  assert.equal(prog.upgradeWeapon('spear').ok, true);
  assert.equal(prog.equipWeapon('greatsword').ok, true);
  for (const id of ['flask_charge', 'flask_heal', 'flask_heal', 'relic:leech_seal', 'relic:ash_idol', 'relic:red_tear']) assert.equal(prog.buy(id).ok, true);
  assert.equal(prog.equipRelic(0, 'red_tear').ok, true);
  return p;
}

describe('왕복', () => {
  test('serialize → loadProfileFromText 후 깊은 동등(새 프로필 · 플레이한 프로필)', () => {
    for (const profile of [createNewProfile(7), makeTestProfile({ embers: 5, cycle: 3 }), playedProfile()]) {
      const save = createSaveData(profile, 1767225600000);
      const text = serializeSave(save);
      assert.equal(typeof text, 'string');
      const loaded = loadProfileFromText(text);
      assert.deepEqual(loaded, save);
      assert.deepEqual(loaded.profile, profile);
      assert.deepEqual(validateProfile(loaded.profile), []);
      // 두 번 돌려도 같다
      assert.equal(serializeSave(loadProfileFromText(serializeSave(loaded))), text);
      assertFiniteDeep(loaded, 'save');
    }
  });

  test('플레이한 프로필에는 실제로 내용이 있다(왕복 검사가 공허하지 않다)', () => {
    const p = playedProfile();
    assert.equal(p.cycle, 1);
    assert.equal(p.equippedWeapon, 'greatsword');
    assert.deepEqual(p.relicsEquipped, ['red_tear', 'ash_idol']);
    assert.equal(p.bosses.valder.milestones, 1);
    assert.ok(p.totals.playTime > 0 && p.embers > 0);
  });

  test('createSaveData: 현재 버전 · 깊은 복사(원본과 물들지 않는다)', () => {
    const profile = playedProfile();
    const save = createSaveData(profile, 123);
    assert.equal(save.version, SAVE_VERSION);
    assert.equal(save.savedAt, 123);
    assert.deepEqual(save.profile, profile);
    assert.notEqual(save.profile, profile);
    assert.notEqual(save.profile.bosses.valder, profile.bosses.valder);
    assert.notEqual(save.profile.relicsOwned, profile.relicsOwned);
    profile.embers += 1;
    profile.stats.vit += 1;
    profile.relicsOwned.push('ember_fang');
    assert.notDeepEqual(save.profile, profile);
    assert.equal(createSaveData(profile, NaN).savedAt, 0);
  });

  test('불러온 프로필은 그대로 게임에 쓸 수 있다', () => {
    const loaded = loadProfileFromText(serializeSave(createSaveData(playedProfile(), 1)));
    const prog = new Progression(loaded.profile, undefined);
    assertFiniteDeep(prog.getStatBlock(), 'stats');
    assert.equal(prog.getStatBlock().weaponId, 'greatsword');
    assert.equal(prog.getBossList().length, BOSS_IDS.length);
    assert.equal(prog.getShopItems().find((i) => i.id === 'relic:red_tear').equippedSlot, 0);
  });
});

describe('깨진 입력 — 던지지 않고 null', () => {
  test('깨진 JSON · 객체가 아닌 JSON · 문자열이 아닌 인자 → null', () => {
    const bad = ['', ' ', '{', '}', 'null', 'undefined', '42', '"save"', 'true', '[]', '[1,2]', '{"version":1,"profile":', 'not json at all', '\u0000'];
    for (const text of bad) {
      assert.equal(parseSave(text), null, JSON.stringify(text));
      assert.equal(loadProfileFromText(text), null, JSON.stringify(text));
    }
    for (const v of [undefined, null, 0, {}, [], () => {}]) {
      assert.equal(parseSave(v), null);
      assert.equal(loadProfileFromText(v), null);
    }
    assert.deepEqual(parseSave('{"a":1}'), { a: 1 });
  });

  test('잘린 JSON: 어느 길이에서 끊겨도 던지지 않는다(null이거나 유효한 세이브)', () => {
    const text = serializeSave(createSaveData(playedProfile(), 1767225600000));
    for (let n = 0; n < text.length; n++) {
      const got = loadProfileFromText(text.slice(0, n));
      assert.equal(got, null, `앞 ${n}글자`);
    }
    assert.notEqual(loadProfileFromText(text), null);
  });

  test('미래 버전 · 이상한 버전 → null', () => {
    const save = createSaveData(createNewProfile(1), 1);
    for (const version of [SAVE_VERSION + 1, 99, -1, 0.5, '1', null, NaN, Infinity]) {
      const raw = { ...save, version };
      assert.equal(migrateSave(raw), null, `version ${version}`);
      assert.equal(loadProfileFromText(JSON.stringify(raw)), null, `version ${version}`);
    }
  });

  test('모르는 형태 → null', () => {
    const shapes = [
      {},
      { version: SAVE_VERSION },
      { version: SAVE_VERSION, profile: null },
      { version: SAVE_VERSION, profile: 'x' },
      { version: SAVE_VERSION, profile: [1, 2, 3] },
      { profile: createNewProfile(1) },            // 버전이 없으면 v0으로 보는데 v0의 모양이 아니다
      { version: 0, hello: 'world' },
    ];
    for (const raw of shapes) {
      assert.equal(migrateSave(raw), null, JSON.stringify(raw).slice(0, 60));
      assert.equal(loadProfileFromText(JSON.stringify(raw)), null);
    }
    for (const raw of [null, undefined, 5, 'x', []]) assert.equal(migrateSave(raw), null);
  });

  test('무작위로 망가뜨린 세이브에서도 던지지 않고, 돌려준 프로필은 항상 유효하다', () => {
    const text = serializeSave(createSaveData(playedProfile(), 1));
    const junk = ['null', '-1', '1e999', '"x"', '[]', '{}', 'true', '99999999999999999999', '"__proto__"', '{"level":"a"}'];
    // 결정적 LCG — 테스트가 매번 같은 입력을 본다
    let s = 12345;
    const rnd = (n) => {
      s = (Math.imul(s, 1103515245) + 12345) >>> 0;
      return s % n;
    };
    const tokens = [...text.matchAll(/-?\d+(?:\.\d+)?|"[a-z_]+"|true|false|null|\[[^\[\]{}]*\]/g)];
    let valid = 0;
    for (let i = 0; i < 400; i++) {
      const m = tokens[rnd(tokens.length)];
      const mutated = text.slice(0, m.index) + junk[rnd(junk.length)] + text.slice(m.index + m[0].length);
      const got = loadProfileFromText(mutated);
      if (got === null) continue;
      valid += 1;
      assert.deepEqual(validateProfile(got.profile), []);
      assertFiniteDeep(got, 'save');
      assertFiniteDeep(computeStatBlock(got.profile), 'stats');
      new Progression(got.profile, undefined).getBossList();
    }
    assert.ok(valid > 100, `값만 망가진 세이브는 복구된다(${valid}/400)`);
  });
});

describe('migrateSave', () => {
  /** v0(공개 전) 형태: 래퍼 없이 펼쳐져 있고 이름이 달랐다. */
  const V0 = {
    version: 0,
    savedAt: 1700000000000,
    embers: 345,
    shards: 2,
    stats: { vit: 4, end: 1, str: 6, dex: 0 },
    weapon: 'spear',
    weaponLevels: { longsword: 1, greatsword: 0, spear: 3 },
    flask: { charges: 1, heal: 2 },
    relics: ['green_moss', 'stone_ward'],
    relicSlots: ['stone_ward', null],
    cycle: 0,
    bosses: {
      valder: { unlocked: true, attempts: 5, kills: 1, killsThisCycle: 1, best: 1, milestones: 3 },
      fenrir: { unlocked: true, attempts: 2, kills: 0, killsThisCycle: 0, best: 0.4, milestones: 1 },
    },
    seed: 99,
  };

  test('v0 픽스처 → v1', () => {
    const save = migrateSave(structuredClone(V0));
    assert.equal(save.version, SAVE_VERSION);
    assert.equal(save.savedAt, 1700000000000);

    const loaded = loadProfileFromText(JSON.stringify(V0));
    assert.equal(loaded.version, SAVE_VERSION);
    const expected = createNewProfile(99);
    Object.assign(expected, {
      embers: 345, shards: 2, stats: { vit: 4, end: 1, str: 6, dex: 0 },
      weapons: { longsword: { level: 1 }, greatsword: { level: 0 }, spear: { level: 3 } },
      equippedWeapon: 'spear', flaskChargeLv: 1, flaskHealLv: 2,
      relicsOwned: ['green_moss', 'stone_ward'], relicsEquipped: ['stone_ward', null],
    });
    expected.bosses.valder = { unlocked: true, attempts: 5, totalKills: 1, killsThisCycle: 1, bestFraction: 1, milestones: 3 };
    expected.bosses.fenrir = { unlocked: true, attempts: 2, totalKills: 0, killsThisCycle: 0, bestFraction: 0.4, milestones: 1 };
    assert.deepEqual(loaded.profile, expected);
    assert.deepEqual(loaded.profile.totals, { deaths: 0, kills: 0, embersEarned: 0, playTime: 0 }, 'v0에 없던 totals는 기본값');
    assert.deepEqual(validateProfile(loaded.profile), []);
  });

  test('version 필드가 없는 v0도 읽는다 · 입력을 고치지 않는다', () => {
    const { version, ...noVersion } = V0;
    const before = structuredClone(noVersion);
    const loaded = loadProfileFromText(JSON.stringify(noVersion));
    assert.equal(loaded.profile.equippedWeapon, 'spear');
    migrateSave(noVersion);
    assert.deepEqual(noVersion, before);
  });

  test('v1은 그대로 통과한다(profile은 정화 전 그대로 · savedAt이 깨졌으면 0)', () => {
    const profile = createNewProfile(3);
    const save = migrateSave({ version: 1, savedAt: 55, profile, extra: 'ignored' });
    assert.deepEqual(save, { version: 1, savedAt: 55, profile });
    assert.equal(migrateSave({ version: 1, savedAt: 'yesterday', profile }).savedAt, 0);
    assert.equal(migrateSave({ version: 1, profile }).savedAt, 0);
  });
});

describe('sanitizeProfile', () => {
  test('빠진 필드는 기본값(= 새 프로필)', () => {
    assert.deepEqual(sanitizeProfile({}), createNewProfile(1));
    assert.deepEqual(sanitizeProfile({ seed: 9 }), createNewProfile(9));
    for (const junk of [null, undefined, 5, 'x', [], true]) assert.deepEqual(sanitizeProfile(junk), createNewProfile(1));
    const partial = sanitizeProfile({ embers: 500, stats: { str: 3 }, weapons: { spear: { level: 2 } }, bosses: { fenrir: { attempts: 4 } } });
    const expected = createNewProfile(1);
    expected.embers = 500;
    expected.stats.str = 3;
    expected.weapons.spear.level = 2;
    expected.bosses.fenrir.attempts = 4;
    assert.deepEqual(partial, expected);
  });

  test('범위 밖 값 자르기: stats 99 → 40 · weapon level 15 → 10 · embers NaN → 0', () => {
    const dirty = makeTestProfile();
    dirty.stats = { vit: 99, end: -3, str: 12.9, dex: NaN };
    dirty.weapons = { longsword: { level: 15 }, greatsword: { level: -2 }, spear: { level: '3' } };
    dirty.embers = NaN;
    dirty.shards = -4;
    dirty.cycle = 2.7;
    dirty.flaskChargeLv = 9;
    dirty.flaskHealLv = 9;
    dirty.seed = -1;
    dirty.totals = { deaths: -1, kills: 2.5, embersEarned: Infinity, playTime: -10 };
    dirty.bosses.valder = { unlocked: false, attempts: -1, totalKills: 1.5, killsThisCycle: NaN, bestFraction: 4, milestones: 9 };
    dirty.bosses.nihil.bestFraction = NaN;
    const p = sanitizeProfile(dirty);

    assert.deepEqual(p.stats, { vit: STATS.maxPoints, end: 0, str: 12, dex: 0 });
    assert.deepEqual(p.weapons, { longsword: { level: 10 }, greatsword: { level: 0 }, spear: { level: 0 } });
    assert.deepEqual([p.embers, p.shards, p.cycle], [0, 0, 2]);
    assert.deepEqual([p.flaskChargeLv, p.flaskHealLv], [3, 5]);
    assert.equal(p.seed, 0);
    assert.deepEqual(p.totals, { deaths: 0, kills: 2, embersEarned: 0, playTime: 0 });
    assert.deepEqual(p.bosses.valder, { unlocked: true, attempts: 0, totalKills: 1, killsThisCycle: 0, bestFraction: 1, milestones: 3 });
    assert.equal(p.bosses.nihil.bestFraction, 0);
    assert.deepEqual(validateProfile(p), []);
    assertFiniteDeep(p, 'profile');
  });

  test('모르는 유물 제거 · 중복 제거 · 미보유 유물 장착 해제 · 같은 유물 두 칸 금지', () => {
    const dirty = makeTestProfile();
    dirty.relicsOwned = ['ember_fang', 'holy_grail', 'ember_fang', 42, null, 'constructor', 'ash_idol'];
    dirty.relicsEquipped = ['leech_seal', 'ash_idol'];   // leech_seal은 보유하지 않았다
    let p = sanitizeProfile(dirty);
    assert.deepEqual(p.relicsOwned, ['ember_fang', 'ash_idol']);
    assert.deepEqual(p.relicsEquipped, [null, 'ash_idol']);

    dirty.relicsEquipped = ['ember_fang', 'ember_fang', 'ash_idol'];
    p = sanitizeProfile(dirty);
    assert.deepEqual(p.relicsEquipped, ['ember_fang', null]);

    dirty.relicsEquipped = 'ember_fang';
    dirty.relicsOwned = { 0: 'ember_fang' };
    p = sanitizeProfile(dirty);
    assert.deepEqual([p.relicsOwned, p.relicsEquipped], [[], [null, null]]);
    assert.deepEqual(validateProfile(p), []);
  });

  test("무효 equippedWeapon → 'longsword'", () => {
    for (const bad of ['club', '', null, undefined, 3, 'constructor']) {
      const dirty = makeTestProfile();
      dirty.equippedWeapon = bad;
      assert.equal(sanitizeProfile(dirty).equippedWeapon, 'longsword');
    }
    const ok = makeTestProfile();
    ok.equippedWeapon = 'spear';
    assert.equal(sanitizeProfile(ok).equippedWeapon, 'spear');
  });

  test('bosses.valder.unlocked는 항상 true · 모르는 보스는 버린다 · unlocked는 불리언 true만 인정', () => {
    const dirty = makeTestProfile();
    dirty.bosses = { valder: { unlocked: false, totalKills: 2 }, fenrir: 'x', nihil: { unlocked: 'yes' }, dragon: { unlocked: true } };
    let p = sanitizeProfile(dirty);
    assert.deepEqual(Object.keys(p.bosses), BOSS_IDS);
    assert.deepEqual(BOSS_IDS.map((id) => p.bosses[id].unlocked), [true, false, false]);
    assert.equal(p.bosses.valder.totalKills, 2);

    dirty.bosses = { fenrir: { unlocked: true }, nihil: { unlocked: true } };
    p = sanitizeProfile(dirty);
    assert.deepEqual(BOSS_IDS.map((id) => p.bosses[id].unlocked), [true, true, true]);
    assert.deepEqual(validateProfile(p), []);
  });

  test('이미 유효한 프로필은 그대로 · 입력을 고치지 않고 새 객체를 준다', () => {
    const profile = makeTestProfile({ embers: 77, points: { vit: 3 }, weaponLevel: 4, cycle: 2, seed: 5 });
    profile.bosses.fenrir.unlocked = true;
    profile.bosses.nihil.unlocked = true;
    const before = structuredClone(profile);
    const p = sanitizeProfile(profile);
    assert.deepEqual(p, before);
    assert.deepEqual(profile, before);
    assert.notEqual(p, profile);
    assert.notEqual(p.stats, profile.stats);
    assert.notEqual(p.bosses.valder, profile.bosses.valder);
    assert.deepEqual(Object.keys(p.stats), STAT_IDS);
    assert.deepEqual(Object.keys(p.weapons), WEAPON_IDS);
  });

  test('정화한 프로필의 StatBlock은 유한하다(가장 지저분한 입력에서도)', () => {
    const p = sanitizeProfile({ stats: { vit: 'many' }, weapons: null, equippedWeapon: {}, relicsEquipped: [{}, []], bosses: 7, totals: 'none', seed: 'abc' });
    assert.deepEqual(p, createNewProfile(1));
    assert.deepEqual(computeStatBlock(p), computeStatBlock(createNewProfile(1)));
  });
});

describe('sanitizeSettings', () => {
  test('빠진 필드는 기본값 · 항상 새 객체(DEFAULT_SETTINGS는 동결)', () => {
    for (const junk of [undefined, null, {}, 5, 'x', []]) {
      const s = sanitizeSettings(junk);
      assert.deepEqual(s, { ...DEFAULT_SETTINGS });
      assert.notEqual(s, DEFAULT_SETTINGS);
      s.volumeMaster = 0.1;   // 던지지 않는다 — 복사본이다
    }
    assert.equal(DEFAULT_SETTINGS.volumeMaster, 0.8);
  });

  test('범위 clamp(SETTINGS_RANGE)', () => {
    const s = sanitizeSettings({ mouseSensitivity: 50, volumeMaster: -1, volumeSfx: 2, volumeMusic: 0.25, cameraShake: 7 });
    assert.equal(s.mouseSensitivity, SETTINGS_RANGE.mouseSensitivity[1]);
    assert.equal(s.volumeMaster, 0);
    assert.equal(s.volumeSfx, 1);
    assert.equal(s.volumeMusic, 0.25);
    assert.equal(s.cameraShake, 1);
    assert.equal(sanitizeSettings({ mouseSensitivity: 0 }).mouseSensitivity, SETTINGS_RANGE.mouseSensitivity[0]);
    for (const [key, [lo, hi]] of Object.entries(SETTINGS_RANGE)) {
      assert.equal(sanitizeSettings({ [key]: -1e9 })[key], lo, key);
      assert.equal(sanitizeSettings({ [key]: 1e9 })[key], hi, key);
    }
  });

  test('모르는 quality → 기본값 · 아는 값은 유지', () => {
    assert.equal(sanitizeSettings({ quality: 'ultra' }).quality, DEFAULT_SETTINGS.quality);
    assert.equal(sanitizeSettings({ quality: 3 }).quality, DEFAULT_SETTINGS.quality);
    assert.equal(sanitizeSettings({ quality: 'constructor' }).quality, DEFAULT_SETTINGS.quality);
    for (const q of ['low', 'medium', 'high']) assert.equal(sanitizeSettings({ quality: q }).quality, q);
  });

  test('타입이 다른 값 · NaN은 기본값으로, 모르는 키는 버린다', () => {
    const s = sanitizeSettings({ invertY: 'yes', damageNumbers: 0, volumeMaster: NaN, mouseSensitivity: '2', cameraShake: Infinity, hacks: true });
    assert.deepEqual(s, { ...DEFAULT_SETTINGS });
    const t = sanitizeSettings({ invertY: true, damageNumbers: false, mouseSensitivity: 2.5 });
    assert.deepEqual(t, { ...DEFAULT_SETTINGS, invertY: true, damageNumbers: false, mouseSensitivity: 2.5 });
    assertFiniteDeep(s, 'settings');
  });
});

describe('validateProfile', () => {
  test('새 프로필 · 플레이한 프로필 · 정화한 프로필은 통과', () => {
    assert.deepEqual(validateProfile(createNewProfile(1)), []);
    assert.deepEqual(validateProfile(makeTestProfile({ points: { vit: 12, end: 8, str: 12, dex: 6 }, weaponLevel: 5 })), []);
    assert.deepEqual(validateProfile(playedProfile()), []);
    assert.deepEqual(validateProfile(sanitizeProfile({ embers: -5 })), []);
  });

  test('규칙 위반을 하나씩 잡는다', () => {
    /** @type {[string, (p:any)=>void][]} */
    const breaks = [
      ['embers', (p) => { p.embers = -1; }],
      ['embers', (p) => { p.embers = NaN; }],
      ['shards', (p) => { p.shards = 1.5; }],
      ['cycle', (p) => { p.cycle = '2'; }],
      ['seed', (p) => { p.seed = -1; }],
      ['stats.vit', (p) => { p.stats.vit = 41; }],
      ['stats.dex', (p) => { delete p.stats.dex; }],
      ['stats', (p) => { p.stats = null; }],
      ['weapons.spear', (p) => { delete p.weapons.spear; }],
      ['weapons.longsword.level', (p) => { p.weapons.longsword.level = 11; }],
      ['equippedWeapon', (p) => { p.equippedWeapon = 'club'; }],
      ['flaskChargeLv', (p) => { p.flaskChargeLv = 4; }],
      ['flaskHealLv', (p) => { p.flaskHealLv = 6; }],
      ['relicsOwned[0]', (p) => { p.relicsOwned = ['holy_grail']; }],
      ['relicsOwned[1]', (p) => { p.relicsOwned = ['ash_idol', 'ash_idol']; }],
      ['relicsEquipped[0]', (p) => { p.relicsEquipped = ['ash_idol', null]; }],
      ['relicsEquipped[1]', (p) => { p.relicsOwned = ['ash_idol']; p.relicsEquipped = ['ash_idol', 'ash_idol']; }],
      ['relicsEquipped', (p) => { p.relicsEquipped = [null]; }],
      ['bosses.valder.unlocked', (p) => { p.bosses.valder.unlocked = false; }],
      ['bosses.fenrir', (p) => { delete p.bosses.fenrir; }],
      ['bosses.nihil.bestFraction', (p) => { p.bosses.nihil.bestFraction = 1.5; }],
      ['bosses.nihil.milestones', (p) => { p.bosses.nihil.milestones = 4; }],
      ['totals.playTime', (p) => { p.totals.playTime = NaN; }],
      ['totals', (p) => { p.totals = undefined; }],
    ];
    for (const [path, mutate] of breaks) {
      const p = createNewProfile(1);
      mutate(p);
      const errors = validateProfile(p);
      assert.equal(errors.length, 1, `${path}: ${JSON.stringify(errors)}`);
      assert.ok(errors[0].startsWith(`${path}:`), `${path} ← ${errors[0]}`);
    }
  });

  test('객체가 아니면 오류 하나 · 던지지 않는다', () => {
    for (const junk of [null, undefined, 3, 'x', []]) assert.equal(validateProfile(junk).length, 1);
    assert.ok(validateProfile({}).length > 5);
  });
});
