// OWNER: P4 — 계약 §12.2 「progression.test.js」
// 능력치 곡선 · 레벨업 비용 · 미리보기 · Progression 명령과 조회. core · data · sim/progression만 본다.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { STAT_IDS, WEAPON_IDS, BOSS_IDS } from '../src/core/constants.js';
import { EV, EventBus } from '../src/core/events.js';
import { PLAYER } from '../src/data/player.js';
import { STATS } from '../src/data/stats.js';
import { ECONOMY } from '../src/data/economy.js';
import { RELICS, RELIC_IDS } from '../src/data/relics.js';
import { getWeaponDef } from '../src/data/weapons.js';
import { getBossDef } from '../src/data/bosses/index.js';
import { createNewProfile } from '../src/sim/progression/profile.js';
import { computeStatBlock, totalPoints, levelUpCost, affordableLevelUps, previewLevelUp } from '../src/sim/progression/stats.js';
import { applyReward, computeReward } from '../src/sim/progression/economy.js';
import { Progression } from '../src/sim/progression/Progression.js';
import { makeTestStats, makeTestProfile, assertFiniteDeep } from './helpers.js';

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg ?? ''} ${a} ≉ ${b}`);

/** 버스 + 발행 기록. */
function makeBus() {
  const bus = new EventBus();
  /** @type {{name:string, payload:any}[]} */
  const log = [];
  bus.onAny((name, payload) => log.push({ name, payload }));
  return { bus, log, names: () => log.map((e) => e.name) };
}

/** 명령이 실패했고 profile이 그대로인지. */
function assertFailed(prog, log, run, reason) {
  const before = structuredClone(prog.profile);
  log.length = 0;
  const res = run();
  assert.deepEqual(res, { ok: false, reason });
  assert.deepEqual(log, [{ name: EV.PURCHASE_FAILED, payload: { reason } }]);
  assert.deepEqual(prog.profile, before, '실패한 명령은 profile을 바꾸지 않는다');
}

describe('레벨업 비용', () => {
  test('표 값(§7.4)', () => {
    // (W3) 60 + 10n + 0.3n² → 60 + 8n
    const table = { 0: 60, 1: 68, 2: 76, 3: 84, 4: 92, 6: 108, 8: 124, 10: 140, 12: 156, 18: 204, 20: 220, 24: 252, 30: 300, 36: 348, 40: 380, 100: 860, 159: 1332 };
    for (const [n, cost] of Object.entries(table)) assert.equal(levelUpCost(Number(n)), cost, `n = ${n}`);
  });

  test('누적 합(§7.4) — 3점 204 · 10점 960 · 24점 3648 · 40점 8640 · 상한 160점 111360', () => {
    const cum = (n) => {
      let s = 0;
      for (let k = 0; k < n; k++) s += levelUpCost(k);
      return s;
    };
    const table = { 3: 204, 5: 380, 10: 960, 12: 1248, 20: 2720, 24: 3648, 28: 4704, 30: 5280, 40: 8640, 160: 111360 };
    for (const [n, sum] of Object.entries(table)) assert.equal(cum(Number(n)), sum, `${n}점까지`);
  });

  test('공식은 data/stats.js의 levelCost에서 읽고, 깨진 인자는 0점 비용', () => {
    const c = STATS.levelCost;
    assert.equal(levelUpCost(7), Math.round(c.base + c.linear * 7 + c.quad * 49));
    assert.equal(levelUpCost(NaN), levelUpCost(0));
    assert.equal(levelUpCost(-3), levelUpCost(0));
  });

  test('affordableLevelUps: 잔불 276 · 0점 → 3 (60 + 68 + 76 ≤ 276 < + 84)', () => {
    assert.equal(affordableLevelUps(makeTestProfile({ embers: 276 })), 3);
    assert.equal(affordableLevelUps(makeTestProfile({ embers: 59 })), 0);
    assert.equal(affordableLevelUps(makeTestProfile({ embers: 60 })), 1);
    assert.equal(affordableLevelUps(makeTestProfile({ embers: 203 })), 2);
    assert.equal(affordableLevelUps(makeTestProfile({ embers: 204 })), 3);
    assert.equal(affordableLevelUps(makeTestProfile({ embers: 287 })), 3);
    assert.equal(affordableLevelUps(makeTestProfile({ embers: 288 })), 4);
    // 비용은 점수 합에만 달렸다 — 어느 능력치에 넣었든 같다
    assert.equal(affordableLevelUps(makeTestProfile({ embers: 500, points: { vit: 10 } })), affordableLevelUps(makeTestProfile({ embers: 500, points: { str: 4, dex: 6 } })));
  });

  test('affordableLevelUps는 전 능력치 상한까지 남은 점수를 넘지 않는다', () => {
    const max = STATS.maxPoints;
    assert.equal(affordableLevelUps(makeTestProfile({ embers: 1e9, points: { vit: max, end: max, str: max, dex: max - 2 } })), 2);
    assert.equal(affordableLevelUps(makeTestProfile({ embers: 1e9, points: { vit: max, end: max, str: max, dex: max } })), 0);
  });
});

describe('computeStatBlock', () => {
  test('기본 StatBlock이 §7.4와 같다(= makeTestStats())', () => {
    assert.deepEqual(computeStatBlock(createNewProfile(1)), makeTestStats());
    assert.deepEqual(computeStatBlock(makeTestProfile()), makeTestStats());
    assertFiniteDeep(computeStatBlock(createNewProfile(1)), 'stats');
  });

  test('totalPoints · level = 1 + 투자 점수 합', () => {
    const p = makeTestProfile({ points: { vit: 12, end: 8, str: 12, dex: 6 } });
    assert.equal(totalPoints(p), 38);
    assert.equal(computeStatBlock(p).level, 39);
  });

  test('생명력: 한 점 +14 HP, 17점 = 15×14 + 2×9, 구간 경계 15↔16 · 30↔31', () => {
    const hp = (vit) => computeStatBlock(makeTestProfile({ points: { vit } })).hpMax - PLAYER.base.hp;
    assert.equal(hp(1), 14);
    assert.equal(hp(17), 228);
    assert.equal(hp(15) - hp(14), 14);
    assert.equal(hp(16) - hp(15), 9);
    assert.equal(hp(30) - hp(29), 9);
    assert.equal(hp(31) - hp(30), 5);
    assert.equal(hp(40), 15 * 14 + 15 * 9 + 10 * 5);
  });

  test('지구력: 스태미나와 회복이 함께 오른다 · 구간 경계', () => {
    const s = (end) => computeStatBlock(makeTestProfile({ points: { end } }));
    near(s(1).staminaMax - PLAYER.base.stamina, 5);
    near(s(1).staminaRegen - PLAYER.base.staminaRegen, 1.2);
    near(s(16).staminaMax - s(15).staminaMax, 3);
    near(s(16).staminaRegen - s(15).staminaRegen, 0.8);
    near(s(31).staminaMax - s(30).staminaMax, 1.5);
    near(s(31).staminaRegen - s(30).staminaRegen, 0.4);
    near(s(40).staminaMax, PLAYER.base.stamina + 75 + 45 + 15);
    near(s(40).staminaRegen, PLAYER.base.staminaRegen + 18 + 12 + 4);
  });

  test('근력: 한 점 +6% 피해 · 구간 경계', () => {
    const d = (str) => computeStatBlock(makeTestProfile({ points: { str } })).damageMul;
    near(d(1), 1.06);
    near(d(15), 1.9);
    near(d(16) - d(15), 0.035);
    near(d(31) - d(30), 0.02);
    near(d(40), 1 + 0.9 + 0.525 + 0.2);
  });

  test('기량: 체간 · 치명 · 처형 · 패링 체간이 함께 오른다 · 구간 경계', () => {
    const s = (dex) => computeStatBlock(makeTestProfile({ points: { dex } }));
    near(s(1).postureMul, 1.05);
    near(s(1).critMul, STATS.dex.critBase + 0.03);
    near(s(1).executeMul, 1.05);
    near(s(1).parryPosture, PLAYER.base.parryPosture * 1.05);
    near(s(16).postureMul - s(15).postureMul, 0.03);
    near(s(16).critMul - s(15).critMul, 0.02);
    near(s(31).executeMul - s(30).executeMul, 0.015);
    near(s(40).postureMul, 1 + 0.75 + 0.45 + 0.15);
    near(s(40).critMul, 1.25 + 0.45 + 0.3 + 0.1);
    near(s(40).parryPosture, PLAYER.base.parryPosture * 2.35);
  });

  test('한 능력치는 다른 능력치의 필드를 건드리지 않는다', () => {
    const base = computeStatBlock(makeTestProfile());
    for (const id of STAT_IDS) {
      const b = computeStatBlock(makeTestProfile({ points: { [id]: 5 } }));
      const touched = Object.keys(b).filter((k) => b[k] !== base[k]).sort();
      const expected = { vit: ['hpMax'], end: ['staminaMax', 'staminaRegen'], str: ['damageMul'], dex: ['critMul', 'executeMul', 'parryPosture', 'postureMul'] }[id];
      assert.deepEqual(touched, ['level', ...expected].sort(), id);
    }
  });

  test('상한 40: 범위 밖 점수는 잘라서 읽는다', () => {
    const over = computeStatBlock(makeTestProfile({ points: { vit: 99, str: -5 } }));
    const max = computeStatBlock(makeTestProfile({ points: { vit: STATS.maxPoints } }));
    assert.equal(over.hpMax, max.hpMax);
    assert.equal(over.damageMul, 1);
    assert.equal(totalPoints(makeTestProfile({ points: { vit: 99, str: -5 } })), STATS.maxPoints);
  });

  test('무기 강화: 피해 +10%/단계 · 체간 +3%/단계(기량 배율과 곱)', () => {
    const base = getWeaponDef('longsword').baseDamage;
    for (const lv of [0, 1, 5, 10]) {
      const s = computeStatBlock(makeTestProfile({ weaponLevel: lv }));
      assert.equal(s.weaponLevel, lv);
      near(s.weaponDamage, base * (1 + ECONOMY.weapon.dmgPerLevel * lv), `+${lv} 피해`);
      near(s.postureMul, 1 + ECONOMY.weapon.posturePerLevel * lv, `+${lv} 체간`);
    }
    const s = computeStatBlock(makeTestProfile({ weaponLevel: 5, points: { dex: 10 } }));
    near(s.postureMul, 1.5 * 1.15);
    near(s.parryPosture, PLAYER.base.parryPosture * 1.5, '패링 체간에는 무기 강화가 실리지 않는다');
  });

  test('장착 무기에 따라 무기 필드가 바뀐다(강화 단계는 무기별)', () => {
    for (const id of WEAPON_IDS) {
      const p = makeTestProfile();
      p.equippedWeapon = id;
      p.weapons[id].level = 2;
      const w = getWeaponDef(id);
      const s = computeStatBlock(p);
      assert.equal(s.weaponId, id);
      assert.equal(s.weaponLevel, 2);
      near(s.weaponDamage, w.baseDamage * 1.2);
      assert.equal(s.guardReduction, w.guardReduction);
      assert.equal(s.guardStaminaFactor, w.guardStaminaFactor);
    }
    const broken = makeTestProfile();
    broken.equippedWeapon = 'club';
    assert.equal(computeStatBlock(broken).weaponId, 'longsword');
  });

  test('플라스크 단계: 충전 3 → 6 · 회복 45 → 95', () => {
    const p = makeTestProfile();
    p.flaskChargeLv = 3;
    p.flaskHealLv = 5;
    const s = computeStatBlock(p);
    assert.equal(s.flaskCharges, PLAYER.base.flaskCharges + 3);
    assert.equal(s.flaskHeal, PLAYER.base.flaskHeal + 50);
  });

  test('유물 7종의 효과', () => {
    const base = computeStatBlock(makeTestProfile());
    const withRelic = (id) => {
      const p = makeTestProfile();
      p.relicsOwned = [id];
      p.relicsEquipped = [id, null];
      return computeStatBlock(p);
    };
    const expected = {
      ember_fang: { postRollDmgMul: 1.25, postRollWindow: 1.5 },
      watcher_ring: { parryWindow: base.parryWindow + 0.08 },
      green_moss: { staminaRegen: base.staminaRegen * 1.25 },
      leech_seal: { lifesteal: 0.05 },
      red_tear: { lowHpThreshold: 0.3, lowHpDmgMul: 1.3 },
      ash_idol: { emberGainMul: 1.15 },
      stone_ward: { guardStaminaFactor: base.guardStaminaFactor * 0.7 },
    };
    assert.deepEqual(Object.keys(expected), RELIC_IDS);
    for (const id of RELIC_IDS) {
      const s = withRelic(id);
      for (const k of Object.keys(base)) {
        if (k in expected[id]) near(s[k], expected[id][k], `${id}.${k}`);
        else assert.equal(s[k], base[k], `${id}는 ${k}를 건드리지 않는다`);
      }
      assertFiniteDeep(s, id);
    }
  });

  test('유물 2칸 조합: 두 효과가 다 실리고 칸 순서는 결과를 바꾸지 않는다', () => {
    const p = makeTestProfile({ points: { end: 10 } });
    p.relicsOwned = ['green_moss', 'stone_ward', 'ember_fang'];
    p.relicsEquipped = ['green_moss', 'stone_ward'];
    const a = computeStatBlock(p);
    near(a.staminaRegen, (PLAYER.base.staminaRegen + 12) * 1.25);
    near(a.guardStaminaFactor, getWeaponDef('longsword').guardStaminaFactor * 0.7);
    p.relicsEquipped = ['stone_ward', 'green_moss'];
    assert.deepEqual(computeStatBlock(p), a);
    // 장착하지 않은 보유 유물은 효과가 없다
    assert.equal(a.postRollDmgMul, 1);
    // 깨진 장착 칸(같은 유물 두 번 · 모르는 id)에도 한 번만 실린다
    p.relicsEquipped = ['green_moss', 'green_moss'];
    near(computeStatBlock(p).staminaRegen, (PLAYER.base.staminaRegen + 12) * 1.25);
    p.relicsEquipped = ['nope', 'constructor'];
    assert.equal(computeStatBlock(p).staminaRegen, PLAYER.base.staminaRegen + 12);
  });

  test('수치에 부동소수 잡음이 없다(UI가 그대로 그린다)', () => {
    for (let n = 0; n <= STATS.maxPoints; n++) {
      const s = computeStatBlock(makeTestProfile({ points: { vit: n, end: n, str: n, dex: n }, weaponLevel: n % 11 }));
      for (const [k, v] of Object.entries(s)) {
        if (typeof v === 'number') assert.ok(String(v).length <= 9, `${k} = ${v} (점수 ${n})`);
      }
    }
  });
});

describe('previewLevelUp', () => {
  test('before/after와 changes — 바뀐 필드만, 표시 순서대로', () => {
    const p = makeTestProfile({ embers: 100 });
    const order = ['hpMax', 'staminaMax', 'staminaRegen', 'damageMul', 'postureMul', 'critMul', 'executeMul', 'parryPosture'];
    const keys = { vit: ['hpMax'], end: ['staminaMax', 'staminaRegen'], str: ['damageMul'], dex: ['postureMul', 'critMul', 'executeMul', 'parryPosture'] };
    for (const id of STAT_IDS) {
      const pv = previewLevelUp(p, id);
      assert.equal(pv.cost, 60);
      assert.equal(pv.canAfford, true);
      assert.equal(pv.maxed, false);
      assert.deepEqual(pv.before, computeStatBlock(p));
      assert.deepEqual(pv.after, computeStatBlock(makeTestProfile({ points: { [id]: 1 } })));
      assert.deepEqual(pv.changes.map((c) => c.key), keys[id], id);
      for (const c of pv.changes) {
        assert.equal(c.before, pv.before[c.key]);
        assert.equal(c.after, pv.after[c.key]);
        assert.ok(c.after > c.before);
      }
      const idx = pv.changes.map((c) => order.indexOf(c.key));
      assert.deepEqual(idx, [...idx].sort((a, b) => a - b));
      assert.equal(pv.diminished, false);
      assert.equal(pv.nextCost, 68);
      assert.equal(pv.affordableCount, 1);
    }
    assert.deepEqual(p, makeTestProfile({ embers: 100 }), '미리보기는 profile을 고치지 않는다');
  });

  test('한 점의 체감(§7.4): 생명력 +14 · 근력 +0.06 · 지구력 +5/+1.2', () => {
    const p = makeTestProfile();
    const b = PLAYER.base;
    assert.deepEqual(previewLevelUp(p, 'vit').changes, [{ key: 'hpMax', before: b.hp, after: b.hp + 14 }]);
    assert.deepEqual(previewLevelUp(p, 'str').changes, [{ key: 'damageMul', before: 1, after: 1.06 }]);
    const end = previewLevelUp(p, 'end').changes;
    assert.deepEqual(end.map((c) => c.key), ['staminaMax', 'staminaRegen']);
    assert.deepEqual([end[0].before, end[0].after], [b.stamina, b.stamina + 5]);
    near(end[1].before, b.staminaRegen);
    near(end[1].after, b.staminaRegen + 1.2);
    assert.ok(String(end[1].after).length <= 6, `잡음 없는 값(${end[1].after})`);
  });

  test('diminished: 15 · 30점 경계를 넘는 순간에만 true', () => {
    for (const id of STAT_IDS) {
      for (let n = 0; n < STATS.maxPoints; n++) {
        const pv = previewLevelUp(makeTestProfile({ points: { [id]: n } }), id);
        assert.equal(pv.diminished, n === 15 || n === 30, `${id} ${n} → ${n + 1}`);
      }
    }
  });

  test('canAfford · nextCost · affordableCount는 점수 합과 잔불을 따른다', () => {
    const p = makeTestProfile({ embers: 276, points: { vit: 2, str: 1 } });
    const pv = previewLevelUp(p, 'dex');
    assert.equal(pv.cost, levelUpCost(3));
    assert.equal(pv.nextCost, levelUpCost(4));
    assert.equal(pv.canAfford, true);
    assert.equal(pv.affordableCount, affordableLevelUps(p));
    assert.equal(pv.affordableCount, 3);   // 84 + 92 + 100 ≤ 276 < + 108
    const poor = previewLevelUp(makeTestProfile({ embers: 83, points: { vit: 3 } }), 'vit');
    assert.equal(poor.canAfford, false);
    assert.equal(poor.affordableCount, 0);
  });

  test('상한: maxed · changes 없음 · after = before · canAfford false', () => {
    const p = makeTestProfile({ embers: 1e6, points: { vit: STATS.maxPoints } });
    const pv = previewLevelUp(p, 'vit');
    assert.equal(pv.maxed, true);
    assert.equal(pv.canAfford, false);
    assert.deepEqual(pv.changes, []);
    assert.deepEqual(pv.after, pv.before);
    assert.equal(pv.diminished, false);
    assert.equal(pv.nextCost, levelUpCost(STATS.maxPoints), '다른 능력치는 아직 올릴 수 있다');
    assert.equal(previewLevelUp(p, 'str').maxed, false);
  });

  test('nextCost: 전 능력치가 상한이 되면 null', () => {
    const max = STATS.maxPoints;
    const last = makeTestProfile({ embers: 1e6, points: { vit: max, end: max, str: max, dex: max - 1 } });
    const pv = previewLevelUp(last, 'dex');
    assert.equal(pv.maxed, false);
    assert.equal(pv.canAfford, true);
    assert.equal(pv.nextCost, null);
    assert.equal(pv.affordableCount, 1);
    const full = makeTestProfile({ embers: 1e6, points: { vit: max, end: max, str: max, dex: max } });
    assert.equal(previewLevelUp(full, 'dex').nextCost, null);
    assert.equal(previewLevelUp(full, 'dex').affordableCount, 0);
  });

  test('유물이 반영된 값으로 비교한다 · 모르는 능력치는 던지지 않는다', () => {
    const p = makeTestProfile();
    p.relicsOwned = ['green_moss'];
    p.relicsEquipped = ['green_moss', null];
    const pv = previewLevelUp(p, 'end');
    near(pv.changes[1].before, PLAYER.base.staminaRegen * 1.25);
    near(pv.changes[1].after, (PLAYER.base.staminaRegen + 1.2) * 1.25);
    const bad = previewLevelUp(p, 'luck');
    assert.equal(bad.canAfford, false);
    assert.equal(bad.maxed, false);
    assert.deepEqual(bad.changes, []);
    assertFiniteDeep(pv, 'preview');
  });
});

describe('Progression — 화톳불', () => {
  test('조회는 순수 함수와 같은 값을 준다', () => {
    const p = makeTestProfile({ embers: 276, points: { str: 2 } });
    const prog = new Progression(p, new EventBus());
    assert.equal(prog.profile, p, '살아 있는 프로필 참조');
    assert.deepEqual(prog.getStatBlock(), computeStatBlock(p));
    assert.deepEqual(prog.previewLevelUp('vit'), previewLevelUp(p, 'vit'));
    assert.equal(prog.getAffordableLevelUps(), affordableLevelUps(p));
  });

  test('levelUp 성공: 잔불 차감 · 점수 +1 · LEVEL_UP → PROFILE_CHANGED', () => {
    const { bus, log, names } = makeBus();
    const p = createNewProfile(1);
    p.embers = 276;
    const prog = new Progression(p, bus);
    assert.deepEqual(prog.levelUp('str'), { ok: true });
    assert.equal(p.embers, 216);
    assert.equal(p.stats.str, 1);
    assert.deepEqual(names(), [EV.LEVEL_UP, EV.PROFILE_CHANGED]);
    assert.deepEqual(log[0].payload, { stat: 'str', points: 1, level: 2, cost: 60 });
    assert.deepEqual(log[1].payload, { reason: 'levelUp' });

    assert.equal(prog.levelUp('vit').ok, true);
    assert.equal(prog.levelUp('vit').ok, true);
    assert.equal(p.embers, 276 - 204);
    assert.equal(log[4].payload.cost, 76);
    assert.equal(log[4].payload.points, 2);
    assert.equal(log[4].payload.level, 4);
  });

  test('levelUp 실패: 잔불 부족 · 상한 · 모르는 능력치 — profile 불변 · PURCHASE_FAILED', () => {
    const { bus, log } = makeBus();
    const p = makeTestProfile({ embers: 65, points: { vit: STATS.maxPoints } });
    const prog = new Progression(p, bus);
    assertFailed(prog, log, () => prog.levelUp('str'), 'embers');
    p.embers = 1e6;
    assertFailed(prog, log, () => prog.levelUp('vit'), 'max');
    assertFailed(prog, log, () => prog.levelUp('luck'), 'invalid');
  });

  test('PROFILE_CHANGED 리스너는 이미 바뀐 profile을 본다', () => {
    const bus = new EventBus();
    const p = makeTestProfile({ embers: 60 });
    const prog = new Progression(p, bus);
    let seen = null;
    bus.on(EV.PROFILE_CHANGED, () => {
      seen = { embers: p.embers, hp: prog.getStatBlock().hpMax };
    });
    prog.levelUp('vit');
    assert.deepEqual(seen, { embers: 0, hp: PLAYER.base.hp + 14 });
  });
});

describe('Progression — 대장장이', () => {
  test('getWeaponInfo: 단계 · 비용 · 현재/다음 피해 · 장착', () => {
    const p = makeTestProfile({ embers: 80, shards: 1 });
    const prog = new Progression(p, new EventBus());
    const ls = getWeaponDef('longsword').baseDamage;
    const info = prog.getWeaponInfo('longsword');
    assert.deepEqual(info, {
      id: 'longsword', level: 0, maxed: false, equipped: true, catchUp: false,
      cost: { embers: 80, shards: 1 }, canAfford: true, damageNow: ls, damageNext: info.damageNext,
    });
    near(info.damageNext, ls * 1.1);
    assert.equal(info.damageNow, prog.getStatBlock().weaponDamage);
    const gs = prog.getWeaponInfo('greatsword');
    assert.equal(gs.equipped, false);
    assert.equal(gs.damageNow, getWeaponDef('greatsword').baseDamage);
    near(gs.damageNext, getWeaponDef('greatsword').baseDamage * 1.1);
    assert.ok(String(gs.damageNext).length <= 6, `잡음 없는 값(${gs.damageNext})`);
    p.shards = 0;
    assert.equal(prog.getWeaponInfo('longsword').canAfford, false);
    assert.equal(prog.getWeaponInfo('club').cost, null, '모르는 무기는 던지지 않는다');
  });

  test('upgradeWeapon 성공: 비용은 getWeaponInfo().cost 그대로 · WEAPON_UPGRADED → PROFILE_CHANGED', () => {
    const { bus, log, names } = makeBus();
    const p = makeTestProfile({ embers: 500, shards: 5 });
    const prog = new Progression(p, bus);
    const cost = prog.getWeaponInfo('longsword').cost;
    assert.deepEqual(prog.upgradeWeapon('longsword'), { ok: true });
    assert.equal(p.weapons.longsword.level, 1);
    assert.equal(p.embers, 500 - cost.embers);
    assert.equal(p.shards, 5 - cost.shards);
    assert.deepEqual(names(), [EV.WEAPON_UPGRADED, EV.PROFILE_CHANGED]);
    assert.deepEqual(log[0].payload, { weaponId: 'longsword', level: 1 });
    assert.deepEqual(log[1].payload, { reason: 'upgrade' });
    near(prog.getStatBlock().weaponDamage, getWeaponDef('longsword').baseDamage * 1.1);
    assert.equal(prog.getStatBlock().weaponDamage, prog.getWeaponInfo('longsword').damageNow);
  });

  test('upgradeWeapon 실패: 잔불 부족 · 파편 부족 · 최대 · 모르는 무기', () => {
    const { bus, log } = makeBus();
    const p = makeTestProfile({ embers: 79, shards: 9 });
    const prog = new Progression(p, bus);
    assertFailed(prog, log, () => prog.upgradeWeapon('longsword'), 'embers');
    p.embers = 1e6;
    p.shards = 0;
    assertFailed(prog, log, () => prog.upgradeWeapon('longsword'), 'shards');
    p.shards = 99;
    p.weapons.longsword.level = ECONOMY.weapon.maxLevel;
    assertFailed(prog, log, () => prog.upgradeWeapon('longsword'), 'max');
    assertFailed(prog, log, () => prog.upgradeWeapon('club'), 'invalid');
    const info = prog.getWeaponInfo('longsword');
    assert.equal(info.maxed, true);
    assert.equal(info.cost, null);
    assert.equal(info.canAfford, false);
    assert.equal(info.damageNext, info.damageNow);
    near(info.damageNow, getWeaponDef('longsword').baseDamage * 2);
  });

  test('+0 → +10 전부 올리면 잔불 5450 · 파편 22', () => {
    const p = makeTestProfile({ embers: 5450, shards: 22 });
    const prog = new Progression(p, new EventBus());
    for (let i = 0; i < ECONOMY.weapon.maxLevel; i++) assert.equal(prog.upgradeWeapon('longsword').ok, true, `+${i} → +${i + 1}`);
    assert.equal(p.embers, 0);
    assert.equal(p.shards, 0);
    assert.equal(p.weapons.longsword.level, 10);
  });

  test('따라잡기 강화: 장검 +4일 때 대검 +0 → +1 = 잔불 40 · 파편 0', () => {
    const { bus } = makeBus();
    const p = makeTestProfile({ weaponLevel: 4, embers: 40, shards: 0 });
    const prog = new Progression(p, bus);
    const gs = prog.getWeaponInfo('greatsword');
    assert.equal(gs.catchUp, true);
    assert.deepEqual(gs.cost, { embers: 40, shards: 0 });
    assert.equal(gs.canAfford, true);
    // 가장 높은 무기는 정가
    const ls = prog.getWeaponInfo('longsword');
    assert.equal(ls.catchUp, false);
    assert.deepEqual(ls.cost, { embers: 400, shards: 2 });

    assert.deepEqual(prog.upgradeWeapon('greatsword'), { ok: true });
    assert.equal(p.embers, 0);
    assert.equal(p.shards, 0);
    assert.equal(p.weapons.greatsword.level, 1);
  });

  test('따라잡기는 가장 높은 단계에 닿는 순간 끝난다', () => {
    const p = makeTestProfile({ weaponLevel: 2, embers: 1e5, shards: 50 });
    const prog = new Progression(p, new EventBus());
    assert.deepEqual(prog.getWeaponInfo('spear').cost, { embers: 40, shards: 0 });
    prog.upgradeWeapon('spear');
    assert.deepEqual(prog.getWeaponInfo('spear').cost, { embers: 65, shards: 0 });
    prog.upgradeWeapon('spear');
    const even = prog.getWeaponInfo('spear');
    assert.equal(even.level, 2);
    assert.equal(even.catchUp, false, '같은 단계면 따라잡기가 아니다');
    assert.deepEqual(even.cost, { embers: 200, shards: 1 });
    assert.equal(p.shards, 50, '따라잡는 동안 파편은 들지 않았다');
  });

  test('equipWeapon: WEAPON_EQUIPPED → PROFILE_CHANGED · 이미 든 무기는 조용히 성공 · 모르는 무기 실패', () => {
    const { bus, log, names } = makeBus();
    const p = makeTestProfile();
    const prog = new Progression(p, bus);
    assert.deepEqual(prog.equipWeapon('spear'), { ok: true });
    assert.equal(p.equippedWeapon, 'spear');
    assert.deepEqual(names(), [EV.WEAPON_EQUIPPED, EV.PROFILE_CHANGED]);
    assert.deepEqual(log[0].payload, { weaponId: 'spear' });
    assert.deepEqual(log[1].payload, { reason: 'equip' });
    assert.equal(prog.getStatBlock().weaponId, 'spear');
    assert.equal(prog.getWeaponInfo('spear').equipped, true);
    assert.equal(prog.getWeaponInfo('longsword').equipped, false);

    log.length = 0;
    assert.deepEqual(prog.equipWeapon('spear'), { ok: true });
    assert.deepEqual(log, []);
    assertFailed(prog, log, () => prog.equipWeapon('club'), 'invalid');
  });
});

describe('Progression — 상인', () => {
  test('getShopItems: 진열 순서 · valueNow/valueNext · equippedSlot', () => {
    const p = makeTestProfile({ embers: 500 });
    const prog = new Progression(p, new EventBus());
    const items = prog.getShopItems();
    const base = PLAYER.base;
    const perLevel = ECONOMY.shop.flaskHeal.perLevel;
    assert.deepEqual(items.map((i) => i.id), ['flask_charge', 'flask_heal', ...RELIC_IDS.map((id) => `relic:${id}`)]);
    assert.deepEqual(items[0], {
      id: 'flask_charge', kind: 'flask_charge', level: 0, maxLevel: 3, price: 350, canAfford: true,
      owned: false, soldOut: false, valueNow: base.flaskCharges, valueNext: base.flaskCharges + 1, equippedSlot: null,
    });
    assert.deepEqual(items[1], {
      id: 'flask_heal', kind: 'flask_heal', level: 0, maxLevel: 5, price: 200, canAfford: true,
      owned: false, soldOut: false, valueNow: base.flaskHeal, valueNext: base.flaskHeal + perLevel, equippedSlot: null,
    });
    for (const it of items.slice(2)) {
      const id = it.id.slice('relic:'.length);
      assert.deepEqual(it, {
        id: it.id, kind: 'relic', level: 0, maxLevel: 1, price: RELICS[id].price, canAfford: RELICS[id].price <= 500,
        owned: false, soldOut: false, valueNow: null, valueNext: null, equippedSlot: null,
      });
    }
    assert.equal(items.find((i) => i.id === 'relic:leech_seal').canAfford, false);
  });

  test('플라스크 구매: 단계 · 값 · ITEM_PURCHASED → PROFILE_CHANGED · 품절이면 max', () => {
    const { bus, log, names } = makeBus();
    const p = makeTestProfile({ embers: 350 + 700 + 1200 + 3000 });
    const prog = new Progression(p, bus);
    assert.deepEqual(prog.buy('flask_charge'), { ok: true });
    assert.deepEqual(names(), [EV.ITEM_PURCHASED, EV.PROFILE_CHANGED]);
    assert.deepEqual(log[0].payload, { itemId: 'flask_charge' });
    assert.deepEqual(log[1].payload, { reason: 'buy' });
    assert.equal(p.flaskChargeLv, 1);
    const base = PLAYER.base;
    assert.equal(prog.getStatBlock().flaskCharges, base.flaskCharges + 1);
    let item = prog.getShopItems()[0];
    assert.deepEqual([item.level, item.price, item.valueNow, item.valueNext], [1, 700, base.flaskCharges + 1, base.flaskCharges + 2]);

    prog.buy('flask_charge');
    prog.buy('flask_charge');
    assert.equal(p.embers, 3000);
    item = prog.getShopItems()[0];
    assert.deepEqual([item.level, item.soldOut, item.canAfford, item.price, item.valueNow, item.valueNext], [3, true, false, 0, base.flaskCharges + 3, base.flaskCharges + 3]);
    assert.equal(item.valueNow, prog.getStatBlock().flaskCharges);
    assertFailed(prog, log, () => prog.buy('flask_charge'), 'max');

    for (let i = 0; i < 5; i++) assert.equal(prog.buy('flask_heal').ok, true);
    assert.equal(p.embers, 0);
    assert.equal(prog.getStatBlock().flaskHeal, base.flaskHeal + 50);
    const heal = prog.getShopItems()[1];
    assert.deepEqual([heal.level, heal.soldOut, heal.valueNow, heal.valueNext], [5, true, base.flaskHeal + 50, base.flaskHeal + 50]);
    assertFailed(prog, log, () => prog.buy('flask_heal'), 'max');
  });

  test('구매 실패: 잔불 부족 · 이미 보유 · 모르는 품목', () => {
    const { bus, log } = makeBus();
    const p = makeTestProfile({ embers: 199 });
    const prog = new Progression(p, bus);
    assertFailed(prog, log, () => prog.buy('flask_heal'), 'embers');
    assertFailed(prog, log, () => prog.buy('relic:green_moss'), 'embers');
    assertFailed(prog, log, () => prog.buy('relic:nope'), 'invalid');
    assertFailed(prog, log, () => prog.buy('relic:constructor'), 'invalid');
    assertFailed(prog, log, () => prog.buy('green_moss'), 'invalid');
    assertFailed(prog, log, () => prog.buy(undefined), 'invalid');
    p.embers = 5000;
    assert.equal(prog.buy('relic:green_moss').ok, true);
    assertFailed(prog, log, () => prog.buy('relic:green_moss'), 'owned');
  });

  test("buy('relic:<id>'): 빈 칸에 자동 장착(RELIC_EQUIPPED) · 두 칸이 차 있으면 보유만", () => {
    const { bus, log, names } = makeBus();
    const p = makeTestProfile({ embers: 5000 });
    const prog = new Progression(p, bus);

    assert.deepEqual(prog.buy('relic:ember_fang'), { ok: true });
    assert.deepEqual(names(), [EV.ITEM_PURCHASED, EV.RELIC_EQUIPPED, EV.PROFILE_CHANGED]);
    assert.deepEqual(log[0].payload, { itemId: 'relic:ember_fang' });
    assert.deepEqual(log[1].payload, { slot: 0, relicId: 'ember_fang' });
    assert.deepEqual(log[2].payload, { reason: 'buy' });
    assert.deepEqual(p.relicsEquipped, ['ember_fang', null]);
    assert.equal(p.embers, 4500);
    assert.equal(prog.getStatBlock().postRollDmgMul, 1.25);

    log.length = 0;
    prog.buy('relic:leech_seal');
    assert.deepEqual(log[1].payload, { slot: 1, relicId: 'leech_seal' });
    assert.deepEqual(p.relicsEquipped, ['ember_fang', 'leech_seal']);

    log.length = 0;
    assert.deepEqual(prog.buy('relic:ash_idol'), { ok: true });
    assert.deepEqual(names(), [EV.ITEM_PURCHASED, EV.PROFILE_CHANGED]);
    assert.deepEqual(p.relicsEquipped, ['ember_fang', 'leech_seal']);
    assert.deepEqual(p.relicsOwned, ['ember_fang', 'leech_seal', 'ash_idol']);
    assert.equal(prog.getStatBlock().emberGainMul, 1, '장착하지 않은 유물은 효과가 없다');

    const items = prog.getShopItems();
    const slotOf = (id) => items.find((i) => i.id === `relic:${id}`);
    assert.deepEqual([slotOf('ember_fang').equippedSlot, slotOf('leech_seal').equippedSlot, slotOf('ash_idol').equippedSlot], [0, 1, null]);
    assert.deepEqual([slotOf('ash_idol').owned, slotOf('ash_idol').soldOut, slotOf('ash_idol').canAfford, slotOf('ash_idol').level], [true, true, false, 1]);
    assert.equal(slotOf('red_tear').owned, false);

    // 앞 칸이 비어 있으면 앞 칸부터 채운다
    prog.equipRelic(0, null);
    log.length = 0;
    prog.buy('relic:red_tear');
    assert.deepEqual(log[1].payload, { slot: 0, relicId: 'red_tear' });
  });

  test('equipRelic: 미보유 불가 · 같은 유물 두 칸 불가 · null로 해제', () => {
    const { bus, log, names } = makeBus();
    const p = makeTestProfile();
    p.relicsOwned = ['ember_fang', 'green_moss', 'ash_idol'];
    p.relicsEquipped = ['ember_fang', null];
    const prog = new Progression(p, bus);

    assertFailed(prog, log, () => prog.equipRelic(1, 'leech_seal'), 'locked');
    assertFailed(prog, log, () => prog.equipRelic(1, 'nope'), 'invalid');
    assertFailed(prog, log, () => prog.equipRelic(2, 'green_moss'), 'invalid');
    assertFailed(prog, log, () => prog.equipRelic(-1, null), 'invalid');

    log.length = 0;
    assert.deepEqual(prog.equipRelic(1, 'green_moss'), { ok: true });
    assert.deepEqual(p.relicsEquipped, ['ember_fang', 'green_moss']);
    assert.deepEqual(names(), [EV.RELIC_EQUIPPED, EV.PROFILE_CHANGED]);
    assert.deepEqual(log[0].payload, { slot: 1, relicId: 'green_moss' });
    assert.deepEqual(log[1].payload, { reason: 'relic' });

    // 같은 유물은 두 칸에 들어가지 않는다 — 다른 칸의 것을 고르면 자리를 맞바꾼다
    log.length = 0;
    assert.deepEqual(prog.equipRelic(1, 'ember_fang'), { ok: true });
    assert.deepEqual(p.relicsEquipped, ['green_moss', 'ember_fang']);
    assert.deepEqual(log.map((e) => e.payload), [{ slot: 0, relicId: 'green_moss' }, { slot: 1, relicId: 'ember_fang' }, { reason: 'relic' }]);
    assert.equal(new Set(p.relicsEquipped).size, 2);

    // 교체
    log.length = 0;
    prog.equipRelic(0, 'ash_idol');
    assert.deepEqual(p.relicsEquipped, ['ash_idol', 'ember_fang']);
    assert.equal(prog.getStatBlock().emberGainMul, 1.15);

    // null로 해제
    log.length = 0;
    assert.deepEqual(prog.equipRelic(0, null), { ok: true });
    assert.deepEqual(p.relicsEquipped, [null, 'ember_fang']);
    assert.deepEqual(log.map((e) => e.payload), [{ slot: 0, relicId: null }, { reason: 'relic' }]);
    assert.equal(prog.getStatBlock().emberGainMul, 1);
    assert.deepEqual(p.relicsOwned, ['ember_fang', 'green_moss', 'ash_idol'], '해제해도 보유는 남는다');

    // 빈 칸으로 옮기면 원래 칸이 빈다
    prog.equipRelic(0, 'ember_fang');
    assert.deepEqual(p.relicsEquipped, ['ember_fang', null]);

    // 이미 그 칸에 있는 값은 조용히 성공
    log.length = 0;
    assert.deepEqual(prog.equipRelic(0, 'ember_fang'), { ok: true });
    assert.deepEqual(prog.equipRelic(1, null), { ok: true });
    assert.deepEqual(log, []);
  });
});

describe('Progression — 안개문 · 디버그', () => {
  test('getBossList: BOSS_IDS 순서 · 새 프로필의 격파 보상', () => {
    const prog = new Progression(createNewProfile(1), new EventBus());
    const list = prog.getBossList();
    assert.deepEqual(list.map((b) => b.id), BOSS_IDS);
    assert.deepEqual(list.map((b) => b.unlocked), [true, false, false]);
    for (const b of list) {
      assert.deepEqual(
        { ...b },
        { id: b.id, unlocked: b.unlocked, attempts: 0, killsThisCycle: 0, totalKills: 0, bestFraction: 0,
          victoryEmbers: getBossDef(b.id).reward, victoryShards: 6, repeatMul: 1, shardsLeft: 8 },
      );
    }
    assertFiniteDeep(list, 'bossList');
  });

  test('getBossList: victoryEmbers/victoryShards/shardsLeft가 감쇠 · 남은 구간 · 순환을 따른다', () => {
    const p = createNewProfile(1);
    const prog = new Progression(p, new EventBus());
    const valder = () => prog.getBossList()[0];
    const fight = (victory, f) => applyReward(p, computeReward(p, 'valder', { victory, damageFraction: f, duration: 30 }));

    fight(false, 0.3);   // 25% 구간 하나를 받았다
    assert.deepEqual([valder().victoryShards, valder().shardsLeft, valder().bestFraction], [5, 7, 0.3]);
    fight(false, 0.6);   // 50% 구간
    assert.deepEqual([valder().victoryShards, valder().shardsLeft], [4, 6]);

    // 목록의 값 = 실제로 받는 값
    let expect = valder();
    let got = computeReward(p, 'valder', { victory: true, damageFraction: 1, duration: 60 });
    assert.deepEqual([got.embers, got.shards], [expect.victoryEmbers, expect.victoryShards]);
    applyReward(p, got);

    assert.deepEqual(
      [valder().killsThisCycle, valder().totalKills, valder().bestFraction, valder().repeatMul, valder().victoryEmbers, valder().victoryShards, valder().shardsLeft],
      [1, 1, 1, 0.5, 600, 1, 2],
    );
    assert.equal(prog.getBossList()[1].unlocked, true);
    fight(true, 1);
    assert.deepEqual([valder().repeatMul, valder().victoryEmbers, valder().victoryShards, valder().shardsLeft], [0.25, 300, 1, 1]);
    fight(true, 1);
    assert.deepEqual([valder().repeatMul, valder().victoryEmbers, valder().victoryShards, valder().shardsLeft], [0.25, 300, 0, 0]);

    // 순환 1: 배율 2 · 구간과 격파 파편이 다시 열린다
    const q = makeTestProfile({ cycle: 1 });
    const list = new Progression(q, new EventBus()).getBossList();
    assert.deepEqual(list.map((b) => b.victoryEmbers), [2400, 4000, 6000]);
    assert.deepEqual(list.map((b) => b.shardsLeft), [8, 8, 8]);

    // ash_idol 장착 시 목록에도 반영된다
    q.relicsOwned = ['ash_idol'];
    q.relicsEquipped = ['ash_idol', null];
    assert.equal(new Progression(q, new EventBus()).getBossList()[0].victoryEmbers, 2760);
  });

  test("grant: 디버그 지급 · PROFILE_CHANGED {reason:'debug'} · 0 아래로 내려가지 않는다", () => {
    const { bus, log } = makeBus();
    const p = makeTestProfile({ embers: 10, shards: 1 });
    const prog = new Progression(p, bus);
    prog.grant(500, 3);
    assert.deepEqual([p.embers, p.shards], [510, 4]);
    assert.deepEqual(log, [{ name: EV.PROFILE_CHANGED, payload: { reason: 'debug' } }]);
    prog.grant(100);
    assert.deepEqual([p.embers, p.shards], [610, 4]);
    prog.grant(-9999, NaN);
    assert.deepEqual([p.embers, p.shards], [0, 4]);
    prog.grant();
    assert.equal(log.length, 4);
  });

  test("profile 내용을 갈아 끼워도('reset') 조회가 새 내용을 따른다 · 버스 없이도 명령이 돈다", () => {
    const p = createNewProfile(1);
    const prog = new Progression(p, undefined);
    assert.equal(prog.getStatBlock().hpMax, PLAYER.base.hp);
    Object.assign(p, structuredClone(makeTestProfile({ embers: 999, points: { vit: 3 }, weaponLevel: 2 })));
    assert.equal(prog.getStatBlock().hpMax, PLAYER.base.hp + 42);
    assert.equal(prog.getWeaponInfo('longsword').level, 2);
    assert.equal(prog.levelUp('vit').ok, true);
    assert.equal(prog.levelUp('luck').ok, false);
    assertFiniteDeep(p, 'profile');
  });
});
