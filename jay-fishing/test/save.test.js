// OWNER: P4 — 계약 §12.2(save) · §11.5
// 왕복 · 손상 JSON · 다른 game · 미래 버전 · 마이그레이션 순서 · sanitize · 던지지 않음 · 결과 단계 저장 · 로드 파손 뒤 저장 · 설정.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GAME_ID, SAVE_VERSION, TICKS_PER_DAY } from '../src/core/constants.js';
import { makeRng, seedRng } from '../src/core/rng.js';
import { HOLD } from '../src/data/economy.js';
import { DEFAULT_SETTINGS } from '../src/data/settings.js';
import { getSpecies } from '../src/data/species/index.js';
import { computeModifiers, rigStats } from '../src/sim/progression/modifiers.js';
import { applyLoss, fishPrice } from '../src/sim/progression/economy.js';
import { evaluateCatch } from '../src/sim/progression/progress.js';
import { createSaveData, migrateSave, parseSave, sanitizeSettings, serializeSave } from '../src/sim/progression/save.js';
import { assertFiniteDeep, assertShape, makeTestCtx, makeTestState } from './helpers.js';

function ctxOf(state) {
  /** @type {any} */
  let ctx;
  ctx = makeTestCtx(state, {
    refresh: () => {
      ctx.mods = computeModifiers(state.profile);
      ctx.rigStats = rigStats(state.profile, state.rig.set, ctx.mods);
    },
  });
  return ctx;
}

function rec(uid, speciesId = 'crucian', weightKg = 0.3) {
  const sp = getSpecies(speciesId);
  return {
    uid, speciesId, lengthCm: 22, weightKg, pct: 0.5, tier: 'normal', price: fishPrice(sp, weightKg, 'normal'),
    xpKeep: 6, xpRelease: 4, firstCatch: false, recordWeight: false, stageId: sp.stage, spotId: 'lake_gravel',
    day: 1, hour: 8, set: 'float', fightSec: 10,
  };
}

/** 결과 단계 상태 — pendingCatch 가 기다린다 */
function resultState() {
  const s = makeTestState({ spotId: 'lake_gravel', hour: 9 });
  const ctx = ctxOf(s);
  const r = evaluateCatch(ctx, { speciesId: 'carp', z: 0, pct: 0.5, lengthCm: 57, weightKg: 3.1, tier: 'normal' }, 30);
  s.pendingCatch = r;
  s.rig.phase = 'result';
  return { s, r };
}

test('왕복: createSaveData → serializeSave → parseSave 가 같은 세이브(§3.7 모양)', () => {
  const s = makeTestState({ spotId: 'lake_gravel', hour: 13 });
  s.profile.hold.push(rec(1), rec(2, 'carp', 3));
  s.profile.nextUid = 3;
  s.profile.owned.reel_2 = 1;
  s.profile.level = 5;
  s.profile.xpTotal = 700;
  s.profile.xp = 43;
  s.profile.skillPoints = 3;
  s.profile.skills.casting = 2;
  s.profile.sets.float.reel = 'reel_2';
  s.profile.dex.crucian = { count: 1, maxKg: 0.3, maxCm: 22, firstDay: 1, trophies: 0, legends: 0, best: 'normal' };
  s.profile.dex.carp = { count: 1, maxKg: 3, maxCm: 22, firstDay: 1, trophies: 0, legends: 0, best: 'normal' };
  s.profile.flags.hints.cast = true;
  const before = structuredClone(s);
  const save = createSaveData(s, 1234);
  assert.deepEqual(s, before, 'sim 상태는 그대로');
  assertShape(save, 'SaveData');
  assert.equal(save.game, GAME_ID);
  assert.equal(save.version, SAVE_VERSION);
  assert.equal(save.savedAt, 1234);
  assert.deepEqual(save.clock, { day: s.clock.day, tickInDay: s.clock.tickInDay });
  assert.equal(save.scene, 'lake');
  assert.notEqual(save.profile, s.profile, '프로필은 사본');
  const text = serializeSave(save);
  assert.equal(typeof text, 'string');
  const out = parseSave(text);
  assert.equal(out.error, null);
  assert.deepEqual(out.save, save);
  assertFiniteDeep(out.save);
});

test('손상: JSON 이 아니다 · 객체가 아니다 · 다른 game · 문자열이 아니다 → 던지지 않고 사유', () => {
  for (const t of ['', '{', 'nope', 'null', '42', '"str"', '[1,2]', undefined, null, 5, {}]) {
    const r = parseSave(/** @type {any} */ (t));
    assert.equal(r.save, null);
    assert.equal(r.error, 'json', String(t));
  }
  const good = createSaveData(makeTestState(), 1);
  assert.deepEqual(parseSave(JSON.stringify({ ...good, game: 'other' })), { save: null, error: 'game' });
  assert.deepEqual(parseSave(JSON.stringify({ ...good, game: undefined })), { save: null, error: 'game' });
});

test('미래 버전 → future(필드가 깨져 있어도 손상으로 읽지 않는다) · 과거 버전은 migrateSave 를 거친다 · 순서', () => {
  const good = createSaveData(makeTestState(), 1);
  assert.deepEqual(parseSave(JSON.stringify({ ...good, version: SAVE_VERSION + 1 })), { save: null, error: 'future' });
  assert.deepEqual(parseSave(JSON.stringify({ game: GAME_ID, version: 99, profile: 'garbage' })), { save: null, error: 'future' });
  // game 이 먼저: 다른 게임의 미래 버전은 'game'
  assert.deepEqual(parseSave(JSON.stringify({ game: 'x', version: 99 })), { save: null, error: 'game' });
  // 과거 버전: v1 이 처음이라 올릴 길이 없다 → migrateSave null → 'fields'
  assert.equal(migrateSave({ ...good, version: 0 }), null);
  assert.deepEqual(parseSave(JSON.stringify({ ...good, version: 0 })), { save: null, error: 'fields' });
  // 지금 버전은 그대로 · 깨진 입력은 null(던지지 않는다)
  assert.equal(migrateSave(good), good);
  for (const bad of [null, 3, 'x', [], {}, { version: 'a' }, { version: 1.5 }, { version: SAVE_VERSION + 1 }]) assert.equal(migrateSave(bad), null);
  // 버전 없음 → fields
  assert.deepEqual(parseSave(JSON.stringify({ ...good, version: undefined })), { save: null, error: 'fields' });
});

test('필수 필드 누락 → fields · 범위 밖 → sanitize(seed · clock · scene · profile) · 무작위 입력에 던지지 않는다', () => {
  const good = createSaveData(makeTestState(), 1);
  for (const k of ['profile', 'clock', 'seed', 'scene']) {
    const o = { ...good };
    delete o[k];
    assert.deepEqual(parseSave(JSON.stringify(o)), { save: null, error: 'fields' }, k);
  }
  assert.equal(parseSave(JSON.stringify({ ...good, profile: [] })).error, 'fields');
  const odd = {
    ...good,
    seed: -1,
    savedAt: 'x',
    clock: { day: -3, tickInDay: TICKS_PER_DAY * 5 },
    scene: 'river',                           // 레벨 1 은 강에 들어갈 수 없다 → 집
    profile: { ...good.profile, money: -50, level: 'x', extra: 1 },
    junk: true,
  };
  const r = parseSave(JSON.stringify(odd));
  assert.equal(r.error, null);
  assertShape(r.save, 'SaveData');
  assert.equal(r.save.seed, 0xffffffff);
  assert.equal(r.save.savedAt, 0);
  assert.deepEqual(r.save.clock, { day: 1, tickInDay: TICKS_PER_DAY - 1 });
  assert.equal(r.save.scene, 'home');
  assert.equal(r.save.profile.money, 0);
  assert.equal(r.save.profile.level, 1);
  assert.ok(!('extra' in r.save.profile));
  assert.ok(!('junk' in r.save));
  assert.equal(parseSave(JSON.stringify({ ...good, scene: 'moon' })).save.scene, 'home');

  // 퍼징: 세이브의 아무 필드나 이상한 값으로 → 던지지 않는다 · 성공이면 유한수만
  const rng = makeRng(seedRng(9));
  const weird = [null, -1, 1e308, 'x', [], {}, true, NaN, -0.5, [1, 'a'], { a: { b: 1 } }];
  const paths = [];
  const walk = (o, p) => {
    for (const k of Object.keys(o)) {
      paths.push([...p, k]);
      if (o[k] && typeof o[k] === 'object') walk(o[k], [...p, k]);
    }
  };
  const base = createSaveData(resultState().s, 5);
  base.profile.hold.push(rec(7));
  walk(base, []);
  for (let i = 0; i < 1500; i++) {
    const o = structuredClone(base);
    for (let j = 0; j < 3; j++) {
      const path = paths[rng.int(0, paths.length - 1)];
      let t = o;
      for (let d = 0; d < path.length - 1 && t && typeof t === 'object'; d++) t = t[path[d]];
      if (t && typeof t === 'object') t[path[path.length - 1]] = structuredClone(weird[rng.int(0, weird.length - 1)]);
    }
    let out;
    assert.doesNotThrow(() => { out = parseSave(JSON.stringify(o)); });
    if (out.save) {
      assertFiniteDeep(out.save);
      assertShape(out.save.profile, 'Profile');
      assert.ok(out.save.profile.money >= 0);
      assert.ok(out.save.profile.hold.length <= HOLD.capacity);
    } else assert.ok(['json', 'game', 'future', 'fields'].includes(out.error));
  }
});

test('결과 단계 저장: 어창에 자리가 있으면 keep · 없으면 방생 경험치 · sim 상태는 그대로', () => {
  // 자리 있음 → 어창에 들어간 프로필 사본
  {
    const { s, r } = resultState();
    const before = structuredClone(s);
    const save = createSaveData(s, 1);
    assert.deepEqual(s, before, 'sim 상태를 바꾸지 않는다');
    assert.ok(save.profile.hold.some(c => c.uid === r.uid));
    assert.equal(save.profile.xpTotal, r.xpKeep);
    assert.equal(save.profile.dex.carp.count, 1);
    assert.equal(save.profile.nextUid, r.uid + 1);
    assert.equal(save.profile.stats.landed, 1);
    // 다시 읽어도 물고기가 남는다
    const back = parseSave(serializeSave(save)).save;
    assert.ok(back.profile.hold.some(c => c.uid === r.uid && c.speciesId === 'carp'));
  }
  // 어창이 가득 → 방생으로(경험치 · 도감만)
  {
    const { s, r } = resultState();
    for (let i = 0; i < HOLD.capacity; i++) s.profile.hold.push(rec(100 + i));
    s.profile.nextUid = Math.max(s.profile.nextUid, 200);
    s.pendingCatch = { ...r, uid: s.profile.nextUid };
    const save = createSaveData(s, 1);
    assert.equal(save.profile.hold.length, HOLD.capacity);
    assert.ok(!save.profile.hold.some(c => c.speciesId === 'carp'));
    assert.equal(save.profile.xpTotal, r.xpRelease);
    assert.equal(save.profile.stats.released, 1);
    assert.equal(save.profile.dex.carp.count, 1);
    assert.equal(s.profile.hold.length, HOLD.capacity, 'sim 어창은 그대로');
    assert.equal(s.profile.xpTotal, 0);
  }
  // result 가 아니면 pendingCatch 를 반영하지 않는다
  {
    const { s } = resultState();
    s.rig.phase = 'ready';
    const save = createSaveData(s, 1);
    assert.equal(save.profile.hold.length, 0);
    assert.equal(save.profile.xpTotal, 0);
  }
});

test('로드 파손 → 저장 → parseSave → owned 에 그 로드가 없다 · 세트는 1단계 로드 · 낮춘 드랙', () => {
  const s = makeTestState({ spotId: 'lake_gravel', set: 'float' });
  const ctx = ctxOf(s);
  const p = s.profile;
  p.level = 5;
  p.owned.rod_float_2 = 1;
  p.sets.float.rod = 'rod_float_2';
  p.sets.float.dragNotch = 18;
  const loss = applyLoss(ctx, 'float', 'rodBreak', { baitId: 'worm' });
  assert.equal(loss.rodLost, 'rod_float_2');
  const back = parseSave(serializeSave(createSaveData(s, 1)));
  assert.equal(back.error, null);
  assert.ok(!('rod_float_2' in back.save.profile.owned));
  assert.equal(back.save.profile.sets.float.rod, 'rod_float_1');
  assert.equal(back.save.profile.sets.float.dragNotch, p.sets.float.dragNotch);
  assert.equal(back.save.profile.sets.float.dragNotch * 0.25, loss.dragKgAfter);
});

test('설정 sanitizeSettings: 기본값 · 범위 자르기 · 모르는 키 제거 · 던지지 않는다', () => {
  assert.deepEqual(sanitizeSettings(undefined), DEFAULT_SETTINGS);
  assert.deepEqual(sanitizeSettings(structuredClone(DEFAULT_SETTINGS)), DEFAULT_SETTINGS);
  const s = sanitizeSettings({
    version: 7, mouseSens: 50, invertY: 'yes', quality: 'ultra', fov: 10,
    volume: { master: 2, sfx: -1, ambience: 'x', ui: 0.3, extra: 1 }, hints: false, junk: 1,
  });
  assert.deepEqual(s, {
    version: 1, mouseSens: 3, invertY: false, quality: 'medium', fov: 60,
    volume: { master: 1, sfx: 0, ambience: DEFAULT_SETTINGS.volume.ambience, ui: 0.3 }, hints: false,
  });
  assert.equal(sanitizeSettings({ quality: 'high', fov: 90, mouseSens: 0.1 }).quality, 'high');
  assert.equal(sanitizeSettings({ mouseSens: 0.1 }).mouseSens, 0.2);
  for (const raw of [null, 3, 'x', [], { volume: null }]) assert.doesNotThrow(() => sanitizeSettings(raw));
  const out = sanitizeSettings({ volume: 5 });
  assert.deepEqual(out.volume, DEFAULT_SETTINGS.volume);
  assert.notEqual(out.volume, DEFAULT_SETTINGS.volume, '기본값 객체를 그대로 내주지 않는다');
});

test('난수 상태(리뷰 수정): 세이브가 rng 를 담고 불러오면 잇는다 — 첫 입질을 본 뒤 저장한 세이브는 다음 첫 입질이 다르다 · 같은 세이브는 같은 난수열 · 옛 세이브는 시각에서 파생', async () => {
  const { EventBus } = await import('../src/core/events.js');
  const { GameSim } = await import('../src/sim/GameSim.js');
  const { makeInput } = await import('../src/core/inputFrame.js');
  const { derivedRngState } = await import('../src/sim/progression/save.js');
  const load = (save) => {
    const sim = new GameSim({ bus: new EventBus(), seed: 1, save: parseSave(serializeSave(save)).save, start: { spotId: 'lake_gravel' } });
    sim.start();
    return sim;
  };
  /** 캐스팅 → 첫 입질(어종 · 무게) */
  const firstBite = (sim) => {
    const s = sim.state;
    const inp = (o = {}) => makeInput({ yaw: s.player.yaw, ...o });
    sim.step(inp({ primary: true, primaryPressed: true }));
    for (let i = 0; i < 30; i++) sim.step(inp({ primary: true }));
    sim.step(inp({ primaryReleased: true }));
    let n = 0;
    while (s.rig.phase !== 'bite') { sim.step(inp()); assert.ok(++n < 60 * 1800, '30분 동안 입질 없음'); }
    return `${s.rig.bite.speciesId} ${s.rig.bite.roll.weightKg}`;
  };
  for (const seed of [11, 88, 105]) {
    const sim0 = new GameSim({ bus: new EventBus(), seed, start: { scene: 'lake', hour: 9 } });
    sim0.start();
    const s0 = createSaveData(sim0.state, 1);
    assert.equal(s0.rng, sim0.state.rng.s >>> 0, 'rng = state.rng.s');
    const a = load(s0);
    assert.equal(a.state.rng.s, s0.rng, '불러오면 저장한 난수 상태에서 시작');
    const bite1 = firstBite(a);
    assert.equal(firstBite(load(s0)), bite1, '같은 세이브 → 같은 난수열(결정성)');
    const s1 = createSaveData(a.state, 2);              // 첫 입질을 본 뒤 저장(이어하기)
    assert.notEqual(s1.rng, s0.rng);
    const bite2 = firstBite(load(s1));
    assert.notEqual(bite2, bite1, `seed ${seed}: 이어하기 첫 입질이 앞 세션과 같다(${bite1})`);
  }
  // 옛 세이브(rng 없음) → seed · 시각에서 파생 — 저장 시각이 다르면 다른 난수열 · 깨진 값도 파생
  const good = createSaveData(makeTestState(), 1);
  const old1 = { ...good, rng: undefined };
  const old2 = { ...good, rng: 'x', clock: { ...good.clock, tickInDay: good.clock.tickInDay + 600 } };
  const p1 = parseSave(JSON.stringify(old1)).save;
  const p2 = parseSave(JSON.stringify(old2)).save;
  assert.equal(p1.rng, derivedRngState(good.seed, good.clock.day, good.clock.tickInDay));
  assert.equal(p2.rng, derivedRngState(good.seed, good.clock.day, good.clock.tickInDay + 600));
  assert.notEqual(p1.rng, p2.rng);
  assert.equal(parseSave(JSON.stringify({ ...good, rng: -1 })).save.rng, 0xffffffff, 'uint32 로 정리');
});
