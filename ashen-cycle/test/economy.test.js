// OWNER: P4 — 계약 §12.2 「economy.test.js」
// 보상 공식 · 브리프 보증 · 전선 보증(§7.7) · 파편 · 해금/순환 · 순환 배율 · 강화 비용. core · data · sim/progression만 본다.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BOSS_IDS } from '../src/core/constants.js';
import { ECONOMY } from '../src/data/economy.js';
import { getBossDef } from '../src/data/bosses/index.js';
import { createNewProfile } from '../src/sim/progression/profile.js';
import { levelUpCost, affordableLevelUps, totalPoints } from '../src/sim/progression/stats.js';
import {
  getCycleScaling, weaponUpgradeCost, repeatMulFor, computeReward, applyReward, noteAttempt,
} from '../src/sim/progression/economy.js';
import { makeTestProfile, assertFiniteDeep } from './helpers.js';

/** f만큼 깎고 죽었을 때의 보상. */
const death = (profile, bossId, f, duration = 60) => computeReward(profile, bossId, { victory: false, damageFraction: f, duration });
/** 격파 보상. */
const win = (profile, bossId, duration = 90) => computeReward(profile, bossId, { victory: true, damageFraction: 1, duration });
/** 계산하고 지급까지. */
const play = (profile, bossId, victory, f = 1, duration = 60) => {
  const r = computeReward(profile, bossId, { victory, damageFraction: f, duration });
  applyReward(profile, r);
  return r;
};

/** 점수 합이 n인 프로필(전선 보증용 — 비용은 합에만 달렸다). */
function profileAt(cycle, n) {
  const per = Math.floor(n / 4);
  const rem = n - per * 4;   // 나머지는 앞 능력치부터 한 점씩(상한 40을 넘지 않게 고르게 나눈다)
  const p = makeTestProfile({ cycle, points: { vit: per + (rem > 0 ? 1 : 0), end: per + (rem > 1 ? 1 : 0), str: per + (rem > 2 ? 1 : 0), dex: per } });
  assert.equal(totalPoints(p), n);
  return p;
}

describe('보상 공식(§7.5)', () => {
  test('보스 기본 보상: 발더 1200 · 펜리르 2000 · 니힐 3000', () => {
    assert.deepEqual(BOSS_IDS.map((id) => getBossDef(id).reward), [1200, 2000, 3000]);
  });

  test('사망 보상(발더 · 순환 0): f 0 → 0 · 0.05 → 66 · 0.10 → 132 · 0.30 → 276 · 1 → 780', () => {
    const p = createNewProfile(1);
    const table = { 0: 0, 0.05: 66, 0.1: 132, 0.2: 204, 0.3: 276, 0.5: 420, 0.65: 528, 1: 780 };
    for (const [f, embers] of Object.entries(table)) assert.equal(death(p, 'valder', Number(f)).embers, embers, `f = ${f}`);
  });

  test('사망 보상(펜리르 · 니힐): f 0.30 → 460 · 690, f 0.50 → 700 · 1050', () => {
    const p = createNewProfile(1);
    assert.equal(death(p, 'fenrir', 0.3).embers, 460);
    assert.equal(death(p, 'fenrir', 0.5).embers, 700);
    assert.equal(death(p, 'nihil', 0.3).embers, 690);
    assert.equal(death(p, 'nihil', 0.5).embers, 1050);
  });

  test('바닥은 준 피해에 따라 열린다: f = 0이면 0, f ≥ floorFullAt부터 floor 전부', () => {
    const p = createNewProfile(1);
    const d = ECONOMY.death;
    const R = getBossDef('valder').reward;
    assert.equal(death(p, 'valder', 0).embers, 0);
    assert.equal(death(p, 'valder', d.floorFullAt / 2).embers, Math.round(R * (d.floor / 2 + d.perFraction * d.floorFullAt / 2)));
    assert.equal(death(p, 'valder', d.floorFullAt).embers, Math.round(R * (d.floor + d.perFraction * d.floorFullAt)));
    // f에 대해 단조 증가하고, 죽어서는 격파 보상을 넘지 못한다
    let prev = -1;
    for (let i = 0; i <= 100; i++) {
      const e = death(p, 'valder', i / 100).embers;
      assert.ok(e >= prev, `f = ${i / 100}`);
      assert.ok(Number.isInteger(e));
      prev = e;
    }
    assert.ok(prev < win(p, 'valder').embers);
  });

  test('승리 = round(R): 1200 · 2000 · 3000, 순환 1이면 두 배', () => {
    const p = createNewProfile(1);
    assert.deepEqual(BOSS_IDS.map((id) => win(p, id).embers), [1200, 2000, 3000]);
    const c1 = makeTestProfile({ cycle: 1 });
    assert.deepEqual(BOSS_IDS.map((id) => win(c1, id).embers), [2400, 4000, 6000]);
    assert.equal(death(c1, 'valder', 0.3).embers, 552);
    assert.equal(win(c1, 'valder').cycle, 1);
  });

  test('재도전 감쇠 1 · 0.5 · 0.25(이번 순환 격파 수 0 · 1 · 2 이상)', () => {
    assert.deepEqual([0, 1, 2, 3, 9].map(repeatMulFor), [1, 0.5, 0.25, 0.25, 0.25]);
    assert.equal(repeatMulFor(NaN), 1);
    const p = createNewProfile(1);
    const expected = [[1, 1200, 276], [0.5, 600, 138], [0.25, 300, 69], [0.25, 300, 69]];
    for (const [mul, victory, dead] of expected) {
      assert.equal(death(p, 'valder', 0.3).embers, dead);
      assert.equal(death(p, 'valder', 0.3).repeatMul, mul);
      const r = play(p, 'valder', true);
      assert.equal(r.repeatMul, mul);
      assert.equal(r.embers, victory);
    }
    // 다른 보스의 감쇠는 따로 센다
    assert.equal(win(p, 'fenrir').repeatMul, 1);
  });

  test('ash_idol: 잔불 획득 ×1.15(승리 · 사망 모두)', () => {
    const p = createNewProfile(1);
    p.relicsOwned = ['ash_idol'];
    p.relicsEquipped = [null, 'ash_idol'];
    assert.equal(win(p, 'valder').embers, 1380);
    assert.equal(death(p, 'valder', 0.3).embers, Math.round(1380 * 0.23));
    assert.equal(death(p, 'valder', 0.3).embers, 317);
    p.relicsEquipped = [null, null];
    assert.equal(win(p, 'valder').embers, 1200, '보유만 해서는 실리지 않는다');
  });

  test('RewardResult의 모양 — 전 필드 · embersAfter = 보유 + 이번 잔불', () => {
    const p = makeTestProfile({ embers: 50 });
    assert.deepEqual(death(p, 'valder', 0.3, 56), {
      bossId: 'valder', cycle: 0, victory: false, damageFraction: 0.3, duration: 56,
      embers: 276, shards: 1, milestones: [0.25], firstKill: false, repeatMul: 1,
      unlocked: null, cycleAdvanced: false, embersAfter: 326,
    });
    assert.deepEqual(win(p, 'valder', 88), {
      bossId: 'valder', cycle: 0, victory: true, damageFraction: 1, duration: 88,
      embers: 1200, shards: 6, milestones: [0.25, 0.5, 0.75], firstKill: true, repeatMul: 1,
      unlocked: 'fenrir', cycleAdvanced: false, embersAfter: 1250,
    });
    assertFiniteDeep(win(p, 'valder'), 'reward');
  });

  test('깨진 인자에도 던지지 않는다: 범위 밖 f · NaN · 모르는 보스', () => {
    const p = createNewProfile(1);
    assert.equal(death(p, 'valder', 7).embers, 780);
    assert.equal(death(p, 'valder', 7).damageFraction, 1);
    assert.equal(death(p, 'valder', -1).embers, 0);
    assert.equal(death(p, 'valder', NaN).embers, 0);
    assert.equal(death(p, 'valder', NaN).damageFraction, 0);
    assert.equal(computeReward(p, 'valder', { victory: false, damageFraction: 0.3, duration: NaN }).duration, 0);

    const before = structuredClone(p);
    const r = computeReward(p, 'nobody', { victory: true, damageFraction: 1, duration: 10 });
    assert.deepEqual([r.embers, r.shards, r.unlocked, r.cycleAdvanced, r.firstKill], [0, 0, null, false, false]);
    applyReward(p, r);
    noteAttempt(p, 'nobody');
    for (const odd of ['constructor', '__proto__', 'toString', '', undefined, null, 3]) {
      const o = computeReward(p, odd, { victory: true, damageFraction: 1, duration: 10 });
      assert.deepEqual([o.embers, o.shards, o.unlocked, o.cycleAdvanced], [0, 0, null, false], String(odd));
      assertFiniteDeep(o, 'reward');
      noteAttempt(p, odd);
    }
    assert.deepEqual(Object.keys(p.bosses), BOSS_IDS, '모르는 보스가 프로필에 생기지 않는다');
    assert.deepEqual(p.bosses, before.bosses);
    assertFiniteDeep(p, 'profile');
  });

  test('computeReward는 profile을 고치지 않는다(전후 깊은 비교)', () => {
    const p = makeTestProfile({ embers: 123, shards: 4, points: { vit: 3, str: 5 }, weaponLevel: 2 });
    p.relicsOwned = ['ash_idol'];
    p.relicsEquipped = ['ash_idol', null];
    p.bosses.valder.bestFraction = 0.4;
    p.bosses.valder.milestones = 1;
    p.bosses.fenrir.killsThisCycle = 1;
    p.bosses.nihil.killsThisCycle = 1;
    const before = structuredClone(p);
    for (const id of [...BOSS_IDS, 'nobody']) {
      death(p, id, 0);
      death(p, id, 0.8);
      win(p, id);
    }
    assert.deepEqual(p, before);
  });
});

describe('브리프 보증(§7.7 (1)) — 한 번 다녀오면 반드시 뭔가 살 수 있다', () => {
  test('f = 0.30 보상(276)으로 새 프로필의 레벨업 ≥ 2회(실제 3회)', () => {
    const p = createNewProfile(1);
    const r = play(p, 'valder', false, 0.3, 56);
    assert.equal(r.embers, 276);
    assert.equal(p.embers, 276);
    assert.ok(affordableLevelUps(p) >= 2);
    assert.equal(affordableLevelUps(p), 3);
    assert.equal(levelUpCost(0) + levelUpCost(1) + levelUpCost(2), 204);
    assert.ok(204 + levelUpCost(3) > 276, '4회째(84)는 못 산다');
    // 25% 구간 파편 1개 → 무기 +1(잔불 80 · 파편 1)과 레벨 2회(60 + 68)도 된다
    assert.equal(r.shards, 1);
    const up = weaponUpgradeCost(0);
    assert.ok(up.shards <= p.shards && up.embers + levelUpCost(0) + levelUpCost(1) <= p.embers);
  });

  test('f = 0.10 보상 ≥ 첫 레벨업 비용', () => {
    const p = createNewProfile(1);
    const r = death(p, 'valder', 0.1);
    assert.equal(r.embers, 132);
    assert.ok(r.embers >= levelUpCost(0));
    p.embers = r.embers;
    assert.equal(affordableLevelUps(p), 2);
    // 덜 깎았을 때: f 0.20 → 3회(204 = 60 + 68 + 76) · f 0.05 → 1회 · f 0 → 0회(무조작 사망은 벌지 못한다)
    p.embers = death(p, 'valder', 0.2).embers;
    assert.equal(affordableLevelUps(p), 3);
    p.embers = death(p, 'valder', 0.05).embers;
    assert.equal(affordableLevelUps(p), 1);
    p.embers = death(p, 'valder', 0).embers;
    assert.equal(affordableLevelUps(p), 0);
  });
});

describe('전선 보증(§7.7 (4)) — 그 시점의 투자 점수 n에서 f 0.30 사망 잔불 ≥ levelUpCost(n)', () => {
  // (W3) n = 봇 메타 루프(숙련 고정 · 가장 값싼 성장부터 구매 · 시드 24개)가 그 전선에 처음 닿았을 때의 평균 투자 점수(docs/NOTES-W3.md).
  // 레벨업 비용이 선형(60 + 8n)이 되어 순환 2 · 3에서도 "한 번 다녀오면 한 점은 산다".
  /** [보스, 순환, n, 사망 잔불, 비용] */
  const fronts = [
    ['valder', 0, 0, 276, 60],
    ['fenrir', 0, 21, 460, 228],
    ['nihil', 0, 36, 690, 348],
    ['valder', 1, 50, 552, 460],
    ['fenrir', 1, 54, 920, 492],
    ['nihil', 1, 68, 1380, 604],
    ['valder', 2, 83, 828, 724],
    ['fenrir', 2, 88, 1380, 764],
    ['nihil', 2, 101, 2070, 868],
    ['valder', 3, 125, 1104, 1060],
    ['fenrir', 3, 129, 1840, 1092],
    ['nihil', 3, 146, 2760, 1228],
  ];
  for (const [bossId, cycle, n, embers, cost] of fronts) {
    test(`${bossId} · 순환 ${cycle} · n = ${n}: ${embers} ≥ ${cost}`, () => {
      const p = profileAt(cycle, n);
      const r = death(p, bossId, 0.3);
      assert.equal(r.embers, embers);
      assert.equal(levelUpCost(n), cost);
      assert.ok(r.embers >= levelUpCost(n));
      p.embers = r.embers;
      assert.ok(affordableLevelUps(p) >= 1);
    });
  }

  test('순환 4부터는 상한(160점)의 마지막 한 점까지 가장 쉬운 보스의 30% 사망으로 산다', () => {
    const last = levelUpCost(159);
    assert.equal(last, 1332);
    for (const cycle of [4, 5, 8, 12]) {
      for (const bossId of BOSS_IDS) {
        const r = death(profileAt(cycle, 159), bossId, 0.3);
        assert.ok(r.embers >= last, `${bossId} · 순환 ${cycle}: ${r.embers} ≥ ${last}`);
      }
    }
    assert.equal(death(profileAt(4, 159), 'valder', 0.3).embers, 1380);
  });
});

describe('파편', () => {
  test('구간(0.25 · 0.5 · 0.75)은 순환당 한 번씩', () => {
    const p = createNewProfile(1);
    assert.deepEqual(death(p, 'valder', 0.24).milestones, []);
    let r = play(p, 'valder', false, 0.25);
    assert.deepEqual([r.milestones, r.shards], [[0.25], 1]);
    r = play(p, 'valder', false, 0.3);
    assert.deepEqual([r.milestones, r.shards], [[], 0], '같은 구간은 다시 주지 않는다');
    r = play(p, 'valder', false, 0.8);
    assert.deepEqual([r.milestones, r.shards], [[0.5, 0.75], 2]);
    r = play(p, 'valder', false, 0.99);
    assert.deepEqual([r.milestones, r.shards], [[], 0]);
    assert.equal(p.bosses.valder.milestones, 3);
    assert.equal(p.shards, 3);
    // 다른 보스의 구간은 따로다
    assert.deepEqual(death(p, 'fenrir', 0.5).milestones, [0.25, 0.5]);
  });

  test('승리 시 남은 구간 + 3, 재격파 1 · 2번째는 1개, 3번째부터 0', () => {
    const p = createNewProfile(1);
    play(p, 'valder', false, 0.3);
    const first = play(p, 'valder', true);
    assert.deepEqual([first.milestones, first.shards, first.firstKill], [[0.5, 0.75], 5, true]);
    const again = [play(p, 'valder', true), play(p, 'valder', true), play(p, 'valder', true), play(p, 'valder', true)];
    assert.deepEqual(again.map((r) => r.shards), [1, 1, 0, 0]);
    assert.deepEqual(again.map((r) => r.firstKill), [false, false, false, false]);
    assert.equal(p.shards, 8);
  });

  test('보스별 · 순환별 합 ≤ 8 — 어떤 순서로 싸워도', () => {
    const cap = ECONOMY.shardMilestones.length + ECONOMY.shardsFirstKill + ECONOMY.shardsRepeatKill * ECONOMY.shardsRepeatKillMax;
    assert.equal(cap, 8);
    const plans = [
      [[true, 1], [true, 1], [true, 1], [true, 1], [true, 1]],
      [[false, 0.1], [false, 0.26], [false, 0.51], [false, 0.76], [false, 1], [true, 1], [true, 1], [true, 1], [true, 1]],
      [[false, 0.9], [true, 1], [false, 0.9], [true, 1], [false, 0.3], [true, 1], [true, 1], [false, 1]],
    ];
    for (const plan of plans) {
      const p = createNewProfile(1);
      for (const [victory, f] of plan) play(p, 'valder', victory, f);
      assert.equal(p.shards, 8);
      assert.equal(p.cycle, 0, '발더만 잡아서는 순환이 오르지 않는다');
    }
    // 세 보스 24 ≥ 한 무기 +10의 22
    assert.ok(cap * BOSS_IDS.length >= ECONOMY.weapon.shards.reduce((a, b) => a + b, 0));
  });

  test('순환이 오르면 구간과 격파 파편이 다시 열린다', () => {
    const p = createNewProfile(1);
    for (const id of BOSS_IDS) play(p, id, true);
    assert.equal(p.cycle, 1);
    assert.equal(p.shards, 18);
    const r = win(p, 'valder');
    assert.deepEqual([r.shards, r.firstKill, r.repeatMul, r.embers], [6, true, 1, 2400]);
  });
});

describe('해금 · 순환', () => {
  test('해금 순서: 발더 → 펜리르 → 니힐', () => {
    const p = createNewProfile(1);
    const unlocked = () => BOSS_IDS.map((id) => p.bosses[id].unlocked);
    assert.deepEqual(unlocked(), [true, false, false]);
    play(p, 'valder', false, 0.9);
    assert.deepEqual(unlocked(), [true, false, false], '죽어서는 열리지 않는다');

    let r = play(p, 'valder', true);
    assert.equal(r.unlocked, 'fenrir');
    assert.deepEqual(unlocked(), [true, true, false]);
    assert.equal(play(p, 'valder', true).unlocked, null, '이미 열린 보스는 다시 알리지 않는다');

    r = play(p, 'fenrir', true);
    assert.equal(r.unlocked, 'nihil');
    assert.equal(r.cycleAdvanced, false);
    assert.deepEqual(unlocked(), [true, true, true]);
  });

  test('세 보스 격파 시 cycle += 1과 초기화(해금 · totalKills · attempts는 유지)', () => {
    const p = createNewProfile(1);
    for (const id of BOSS_IDS) noteAttempt(p, id);
    noteAttempt(p, 'valder');
    play(p, 'valder', false, 0.6);
    play(p, 'valder', true);
    play(p, 'valder', true);
    play(p, 'fenrir', true);
    assert.equal(p.cycle, 0);
    assert.deepEqual(BOSS_IDS.map((id) => p.bosses[id].killsThisCycle), [2, 1, 0]);

    const last = win(p, 'nihil');
    assert.equal(last.cycleAdvanced, true);
    assert.equal(last.unlocked, null);
    assert.equal(last.cycle, 0, '보상은 오르기 전 순환의 배율로 계산된다');
    assert.equal(last.embers, 3000);
    applyReward(p, last);

    assert.equal(p.cycle, 1);
    for (const id of BOSS_IDS) {
      const b = p.bosses[id];
      assert.deepEqual([b.killsThisCycle, b.bestFraction, b.milestones, b.unlocked], [0, 0, 0, true], id);
    }
    assert.deepEqual(BOSS_IDS.map((id) => p.bosses[id].totalKills), [2, 1, 1]);
    assert.deepEqual(BOSS_IDS.map((id) => p.bosses[id].attempts), [2, 1, 1]);

    // 다음 순환: 니힐을 먼저 잡아도 순환은 세 보스를 다 잡아야 오른다
    assert.equal(play(p, 'nihil', true).cycleAdvanced, false);
    assert.equal(play(p, 'nihil', true).cycleAdvanced, false);
    assert.equal(play(p, 'fenrir', true).cycleAdvanced, false);
    assert.equal(play(p, 'valder', true).cycleAdvanced, true);
    assert.equal(p.cycle, 2);
    assertFiniteDeep(p, 'profile');
  });

  test('applyReward: bestFraction은 이번 순환의 최고값 · 승리는 1', () => {
    const p = createNewProfile(1);
    play(p, 'valder', false, 0.4);
    play(p, 'valder', false, 0.2);
    assert.equal(p.bosses.valder.bestFraction, 0.4);
    play(p, 'valder', true);
    assert.equal(p.bosses.valder.bestFraction, 1);
  });

  test('noteAttempt: 도전 횟수 +1(그 보스만)', () => {
    const p = createNewProfile(1);
    noteAttempt(p, 'fenrir');
    noteAttempt(p, 'fenrir');
    assert.deepEqual(BOSS_IDS.map((id) => p.bosses[id].attempts), [0, 2, 0]);
  });
});

describe('applyReward — 지급과 totals', () => {
  test('잔불 · 파편 지급, embersAfter와 일치', () => {
    const p = makeTestProfile({ embers: 40, shards: 2 });
    const r = play(p, 'valder', false, 0.5, 61.5);
    assert.equal(p.embers, 40 + 420);
    assert.equal(p.embers, r.embersAfter);
    assert.equal(p.shards, 2 + 2);
  });

  test('totals: playTime · embersEarned · kills · deaths', () => {
    const p = createNewProfile(1);
    play(p, 'valder', false, 0.3, 56);
    assert.deepEqual(p.totals, { deaths: 1, kills: 0, embersEarned: 276, playTime: 56 });
    play(p, 'valder', false, 0, 12.5);
    assert.deepEqual(p.totals, { deaths: 2, kills: 0, embersEarned: 276, playTime: 68.5 });
    play(p, 'valder', true, 1, 90);
    assert.deepEqual(p.totals, { deaths: 2, kills: 1, embersEarned: 1476, playTime: 158.5 });
    assertFiniteDeep(p, 'profile');
  });
});

describe('순환 배율 · 강화 비용', () => {
  test('getCycleScaling: c = 0 · 1 · 8 · 12', () => {
    assert.deepEqual(getCycleScaling(0), { hpMul: 1, dmgMul: 1, rewardMul: 1, speedMul: 1, thinkMul: 1, chainBonus: 0 });
    // (W3) hpPer 0.75 → 0.50 · dmgPer 0.30 → 0.20
    assert.deepEqual(getCycleScaling(1), { hpMul: 1.5, dmgMul: 1.2, rewardMul: 2, speedMul: 1.04, thinkMul: 0.85, chainBonus: 0.15 });
    assert.deepEqual(getCycleScaling(8), { hpMul: 5, dmgMul: 2.6, rewardMul: 9, speedMul: 1.12, thinkMul: 0.5, chainBonus: 0.3 });
    assert.deepEqual(getCycleScaling(12), { hpMul: 6, dmgMul: 3, rewardMul: 13, speedMul: 1.12, thinkMul: 0.5, chainBonus: 0.3 });
  });

  test('getCycleScaling: softCap을 넘으면 HP · 피해 증가가 절반으로 꺾이고 보상은 선형 · 상한/하한', () => {
    const k = ECONOMY.cycle;
    const a = getCycleScaling(k.softCap);
    const b = getCycleScaling(k.softCap + 1);
    assert.ok(Math.abs(b.hpMul - a.hpMul - k.hpPerAfter) < 1e-9);
    assert.ok(Math.abs(b.dmgMul - a.dmgMul - k.dmgPerAfter) < 1e-9);
    assert.equal(b.rewardMul - a.rewardMul, k.rewardPer);
    assert.equal(getCycleScaling(2).speedMul, 1.08);
    assert.equal(getCycleScaling(3).speedMul, k.speedMax);
    assert.equal(getCycleScaling(2).thinkMul, 0.7225);
    assert.equal(getCycleScaling(5).thinkMul, k.thinkMin);
    assert.equal(getCycleScaling(2).chainBonus, k.chainMax);
    for (const c of [0, 1, 5, 8, 9, 50, 1000]) assertFiniteDeep(getCycleScaling(c), `scaling(${c})`);
    assert.deepEqual(getCycleScaling(-3), getCycleScaling(0));
    assert.deepEqual(getCycleScaling(NaN), getCycleScaling(0));
  });

  test('weaponUpgradeCost 표(+0→+1 … +9→+10) · 최대면 null', () => {
    const embers = [80, 130, 200, 290, 400, 530, 680, 850, 1040, 1250];
    const shards = [1, 1, 1, 2, 2, 2, 3, 3, 3, 4];
    for (let lv = 0; lv < 10; lv++) assert.deepEqual(weaponUpgradeCost(lv), { embers: embers[lv], shards: shards[lv] }, `+${lv}`);
    assert.equal(weaponUpgradeCost(10), null);
    assert.equal(weaponUpgradeCost(11), null);
    assert.equal(weaponUpgradeCost(-1), null);
    assert.equal(weaponUpgradeCost(NaN), null);
    assert.equal(shards.reduce((a, b) => a + b, 0), 22);
  });

  test('weaponUpgradeCost(catchUp): 잔불 반값 · 파편 0', () => {
    assert.deepEqual(weaponUpgradeCost(0, true), { embers: 40, shards: 0 });
    assert.deepEqual(weaponUpgradeCost(1, true), { embers: 65, shards: 0 });
    assert.deepEqual(weaponUpgradeCost(9, true), { embers: 625, shards: 0 });
    for (let lv = 0; lv < 10; lv++) {
      const full = weaponUpgradeCost(lv);
      const half = weaponUpgradeCost(lv, true);
      assert.equal(half.embers, Math.round(full.embers * ECONOMY.weapon.catchUpEmberMul));
      assert.equal(half.shards, 0);
    }
    assert.equal(weaponUpgradeCost(10, true), null);
  });
});
