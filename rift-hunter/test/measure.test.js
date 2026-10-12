// OWNER: P15 — 계약 §12.2 · §12.5 (measure.test.js — npm test 안 · 60초 이하)
// 각 클래스 균열 1~3 세 판(새 캐릭터 · basic 봇 · 판마다 레벨 고정 1 → 2 → 3) — 한 판 3~9분(느슨) · 게이지 100% 도달 · 떼 순간 ≥ 1 ·
// 드랍 장비 20~70 · 분당 처치 25~100. 밸런스가 크게 무너졌는지만 본다(정밀한 판정은 npm run measure → docs/MEASURE.md).
// 측정 함수는 makeSim(seed, account) 를 받는다(bot/* 는 GameSim 을 import 하지 않는다 — §2.2).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventBus } from '../src/core/events.js';
import { RARITIES } from '../src/core/constants.js';
import { Bot } from '../src/bot/bot.js';
import { compactRun, measureTable, newSession, runJob, runRift } from '../src/bot/measure.js';
import { GameSim } from '../src/sim/GameSim.js';

const makeSim = (seed, account) => new GameSim({ bus: new EventBus(), seed, account, devSession: true });

/** @type {Record<string, any[]>} */
const RUNS = {};

for (const [cls, seed] of /** @type {const} */ ([['warrior', 3], ['mage', 3]])) {
  test(`measure: ${cls} — 균열 1~3 세 판(느슨한 범위: 3~9분 · 게이지 100% · 떼 순간 ≥ 1 · 장비 20~70 · 분당 처치 25~100)`, () => {
    const sim = newSession(makeSim, seed, { cls });
    const bot = new Bot({ sim, cls, seed });
    const runs = [];
    for (const level of [1, 2, 3]) {
      bot.levelOverride = level;
      const s = runRift({ sim, bot, maxSec: 12 * 60 });
      assert.ok(s, `${cls} 균열 ${level}: 판이 시작되지 않았다`);
      runs.push(s);
    }
    RUNS[cls] = runs;
    let swarm = 0;
    for (const s of runs) {
      const gear = RARITIES.reduce((a, r) => a + (s.drops[r] ?? 0), 0);
      const kills = Object.values(s.kills).reduce((a, b) => a + b, 0);
      const kpm = kills / (s.timeSec / 60);
      const why = `${cls} 균열 ${s.level}: ${JSON.stringify({ result: s.result, timeSec: Math.round(s.timeSec), deaths: s.deaths, gauge: s.m.gauge, gear, kpm: Math.round(kpm), swarm: s.swarmMoments })}`;
      assert.equal(s.level, runs.indexOf(s) + 1, why);
      assert.ok(s.timeSec >= 3 * 60 && s.timeSec <= 9 * 60, why);
      assert.ok(s.m.gauge >= 100, `${why} — 게이지 100%`);
      assert.ok(gear >= 20 && gear <= 70, `${why} — 드랍 장비`);
      assert.ok(kpm >= 25 && kpm <= 100, `${why} — 분당 처치`);
      swarm += s.swarmMoments;
    }
    assert.ok(swarm >= 1, `${cls}: 세 판 동안 25마리 이상 동시 순간 ${swarm}`);
  });
}

test('measure: 리포트 — measureTable 이 브리프 §7 의 모든 목표를 목표 · 측정값 · 판정 세 열로 쓰고 측정의 한계를 적는다', () => {
  const sessions = Object.entries(RUNS).map(([cls, runs]) => ({
    kind: 'session', cls, hours: 0, runs: runs.map(compactRun), levelAt: {}, unlockAt: {}, timeline: [{ playSec: 0, level: 1, riftUnlocked: 1 }],
    snaps: [], firstLegendaryRun: null, final: { level: runs.at(-1).m.charLevel, riftUnlocked: runs.at(-1).m.riftUnlocked, playSec: runs.at(-1).m.playSec },
    econ: { level: 2, charLevel: 3, gainPerGold: 0, avgPrice: 100, rerollPrice: 200 }, counters: { dodges: 0, dodgeSkills: 0, kites: 0, casts: {}, equips: 0, sold: 0, stuck: 0 },
  }));
  const drops = runJob({ kind: 'drops', seed: 1, n: 20000, level: 5 }, makeSim);
  const md = measureTable({ results: [...sessions, drops], generatedAt: 'test' });
  assert.match(md, /^<!-- OWNER: P15/);
  assert.match(md, /\| 무엇 \| 목표 \| 측정값 \| 판정 \|/);
  for (const what of ['한 판 길이', '처음 성공까지', '실패 한 번으로 잃는 것', '실패 → 재도전', '다수의 몬스터', '처치 시간', '위협', '정예 속성이 다르다', '드랍/판',
    '첫 전설', '한 번 다녀오면 바뀐다', '레벨이 의미 있다', '진행 속도', '귀환 루프', '경제', '장비가 의미 있다', '스킬 트리', '클래스 균형', '드랍 확률이 표와 같다',
    '성능', '결정성', '데이터 완결성']) assert.ok(md.includes(`| ${what}`), `목표 행 ${what}`);
  assert.match(md, /상승 조건/);
  assert.match(md, /보상\(L\)/);
  assert.match(md, /9시간 시점/);
  assert.match(md, /## 9\. 측정의 한계/);
  assert.match(md, /도박 · 재굴림 · 제작 · 보관함을 쓰지 않는다/);
  const body = md.replace('예외 · NaN · 음수', '');   // 목표 문면의 「NaN」 은 값이 아니다
  assert.ok(!body.includes('NaN') && !body.includes('undefined') && !body.includes('Infinity'), '빈 값은 — 로');
  assert.equal(measureTable({}), '(측정 없음)');
});
