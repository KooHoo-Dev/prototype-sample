// OWNER: P10 — 계약 §12.5 · §7.12
// 측정 목표 M1–M16 — 시나리오와 판정은 scripts/measure.mjs(npm run measure 와 같은 코드)에 있다.
// 여기서는 판정(row.pass)과 측정이 성립하는지(표본 수 · 유한값)를 본다.
//
// npm test 120초 안(§12.5): 진행 봇의 긴 실행(M12 레벨 20 · M16 3단계 완비 — 조절 봇 40일 × 시드 3, 약 40초)은
// npm run measure 로만 돈다(NOTES-P10). 나머지는 계약 표본 그대로 여기서 돈다.
//
// BALANCE_PENDING: 지금 데이터(🔒 값)로 목표 밖인 측정 — 봇이 아니라 손잡이 문제라 밸런스 게이트(§12.6)가 고친다.
// 시험은 돌고 결과를 낸다(node:test 의 todo — 실패해도 npm test 를 막지 않는다). 손잡이를 고친 뒤 이 표에서 지운다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MEASURES } from '../scripts/measure.mjs';

/** 목표 밖 — 밸런스 게이트 몫. 밸런스 게이트(NOTES-BALANCE)가 lake_gravel.snag.fromM 31 → 33 으로 M4 · M5 · M7 · M9 · M10 을 맞춰 비웠다.
 *  손잡이로도 닿지 않는 목표가 새로 생기면 여기에 { Mn: '이유 — 손잡이' } 로 적는다(판정만 todo). */
const BALANCE_PENDING = {};

/** npm run measure 로만(긴 실행) */
const MEASURE_ONLY = new Set(['M12', 'M16']);

for (const id of Object.keys(MEASURES)) {
  if (MEASURE_ONLY.has(id)) continue;
  test(`${id} 측정(§12.5) — 시나리오가 끝까지 돌고 표본 · 값이 성립한다`, async (t) => {
    const row = MEASURES[id](1);
    console.log(`# ${row.id} ${row.pass ? '○' : '✕'} ${row.measured}`);
    assert.ok(row.measured && !row.measured.startsWith('예외:'), row.measured);
    assert.ok(!/NaN(?! 0)|Infinity/.test(row.measured), `측정 값이 유한하지 않다: ${row.measured}`);
    const opts = BALANCE_PENDING[id] ? { todo: `밸런스 게이트: ${BALANCE_PENDING[id]}` } : {};
    await t.test(`${id} 목표: ${row.goal}`, opts, () => {
      assert.equal(row.pass, true, `측정 ${row.measured} — 손잡이 ${row.knob}`);
    });
  });
}

test('M12 · M16 은 npm run measure 에서(진행 봇 40일 × 시드 3) — 표에 있다', () => {
  assert.equal(typeof MEASURES.M12, 'function');
  assert.equal(typeof MEASURES.M16, 'function');
});
