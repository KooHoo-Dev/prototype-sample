// OWNER: 리뷰 수정(ui-app) — 계약 §10.6(균열 완료 · 사망) · §10.3(스킬 칸 글자) · §10.6(스킬 트리 찍기 전 · 후)
// 리뷰 지적의 재현을 그대로 옮긴 회귀 테스트 — 순수 함수(pnlLogic · format)와 GameSim(Node)만 쓴다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EV, EventBus } from '../src/core/events.js';
import { RIFT } from '../src/data/rift.js';
import { STRINGS } from '../src/data/strings.ko.js';
import { GameSim } from '../src/sim/GameSim.js';
import { completeBadges, lostUnlock } from '../src/ui/pnlLogic.js';
import { costRows } from '../src/ui/pnlCommon.js';
import { t } from '../src/ui/i18n.js';

/**
 * 해금 u 인 캐릭터로 균열 L 을 열고(UIRoot 처럼 RIFT_OPENED 에 열 때의 해금을 적는다) deaths 번 쓰러진 셈으로 완료한다.
 * @param {number} u @param {number} L @param {number} deaths
 */
function completeAt(u, L, deaths) {
  const bus = new EventBus();
  const sim = new GameSim({ bus, seed: 11, devSession: true });
  let unlockAtOpen = null;
  let unlocks = 0;
  bus.on(EV.RIFT_OPENED, () => { unlockAtOpen = sim.state.char.riftUnlocked; });
  bus.on(EV.UNLOCK, () => { unlocks++; });
  sim.start();
  sim.newCharacter({ slot: 0, cls: 'warrior', name: 'U' });
  sim.debugSetRiftUnlocked(u);
  unlocks = 0;
  assert.equal(sim.debugOpenRift(L).ok, true);
  sim.state.rift.deaths = deaths;                                 // 시험용 — 이번 판의 사망 수
  assert.equal(sim.debugCompleteRift().ok, true);
  const s = sim.state.rift.summary;
  assert.ok(s, '요약');
  return { s, unlockAtOpen, unlocks, after: sim.state.char.riftUnlocked };
}

test('완료 배지 — 이번 판이 해금을 실제로 올렸을 때만 「균열 n 해금」 · 무사망 +2 는 그 +2 가 더 열었을 때만(리뷰 재현 넷 + 첫 판)', () => {
  const cases = [
    // [해금, 레벨, 사망, 배지, 무사망 배지]
    [1, 1, 0, true, true],     // 처음 깬 판 1 → 3
    [3, 1, 0, false, false],   // 이미 3 — 아무것도 열리지 않는다(리뷰: 배지가 떴다)
    [2, 1, 1, false, false],   // 해금 2 · 사망 1 — 2 그대로
    [7, 5, 0, false, false],   // 해금 7 · 균열 5 무사망 — 7 그대로
    [6, 5, 1, false, false],   // 해금 6 · 사망 1 — 6 그대로
    [2, 1, 0, true, true],     // 2 → 3 — +2 덕에 열렸다
    [6, 5, 0, true, true],     // 6 → 7 — +2 덕에
    [5, 5, 1, true, false],    // 5 → 6 — 사망이 있었으니 +1
  ];
  for (const [u, L, d, want, wantBonus] of cases) {
    const r = completeAt(u, L, d);
    const b = completeBadges(r.s, r.unlockAtOpen);
    assert.equal(r.unlockAtOpen, u);
    assert.equal(b.raised, r.unlocks > 0, `해금 ${u} · 균열 ${L} · 사망 ${d}: 배지 = UNLOCK 이 났는가`);
    assert.equal(b.raised, want, `해금 ${u} · 균열 ${L} · 사망 ${d}`);
    assert.equal(b.bonus, wantBonus, `해금 ${u} · 균열 ${L} · 사망 ${d}: 무사망 배지`);
    assert.equal(r.s.unlockedTo, r.after);
  }
  // 열 때 값을 모르면(고정 상태) 옛 식 — 범위만
  assert.deepEqual(completeBadges({ level: 3, unlockedTo: 5, noDeath: true }, null), { raised: true, bonus: true });
  assert.deepEqual(completeBadges({ level: 3, unlockedTo: 3, noDeath: false }, null), { raised: false, bonus: false });
});

test('붕괴 「잃은 것」 — 이미 다음 레벨이 열려 있으면 잃은 해금이 없다(리뷰: 해금 7 · 균열 5 붕괴에 「해금 +1」)', () => {
  assert.equal(lostUnlock(5, 4, 7), 0);
  assert.equal(lostUnlock(5, 4, 6), 0);
  assert.equal(lostUnlock(5, 4, 5), 1);
  assert.equal(lostUnlock(1, 4, 1), 1);
  assert.equal(lostUnlock(RIFT.maxLevel, 4, RIFT.maxLevel), 0, '최고 레벨');
  assert.ok(STRINGS['death.lostNoUnlock'] && STRINGS['death.lost'].includes('{n}'));
});

test('스킬 트리 찍기 전 · 후 — 찍을 수 있는 모든 노드에서 바뀌는 줄이 하나 이상(변형 6 · 전투 함성 · 마력 보호막 포함 · 리뷰 재현)', async () => {
  const { SKILL_NODES } = await import('../src/data/skills.js');
  const { describeSkill } = await import('../src/sim/player/skills.js');
  const { previewLearn } = await import('../src/sim/progression/progress.js');
  const { nodeStatRows, skillExtraRows, SKILL_EXTRA_KEYS } = await import('../src/ui/pnlLogic.js');
  const { makeTestChar } = await import('./helpers.js');
  for (const k of SKILL_EXTRA_KEYS) assert.ok(typeof STRINGS[k] === 'string', k);
  let checked = 0;
  for (const node of SKILL_NODES) {
    for (const rb of [0, 1]) {
      if (rb === 1 && node.maxRank < 2) continue;
      const char = makeTestChar({ cls: node.cls, level: 30 });
      char.skills.ranks = {};
      for (const n of SKILL_NODES) if (n.cls === node.cls && n.branch === node.branch && n.tier < node.tier) char.skills.ranks[n.id] = n.maxRank;
      if (rb) char.skills.ranks[node.id] = 1;
      const pv = previewLearn(char, node.id);
      assert.equal(pv.ok, true, `${node.id} r${rb}: 시험 캐릭터가 찍을 수 있다(${pv.reason})`);
      const target = node.kind === 'transform' ? node.transforms : node.skill ? node.id : null;
      let a = null, b = null;
      if (target) {
        const tRank = target === node.id ? null : Math.max(1, Number(char.skills.ranks[target]) || 1);
        a = target === node.id ? (pv.rankBefore > 0 ? describeSkill(pv.statsBefore, node.id, pv.rankBefore) : null) : describeSkill(pv.statsBefore, target, tRank);
        b = target === node.id ? describeSkill(pv.statsAfter, node.id, pv.rankAfter) : describeSkill(pv.statsAfter, target, tRank);
      }
      const base = !!a !== !!b || (a && b && (Math.round(a.dmgMax) !== Math.round(b.dmgMax) || a.cost !== b.cost || a.cd !== b.cd));
      const stat = nodeStatRows(node.id, pv.rankBefore, pv.rankAfter).some((r) => r.before !== r.after);
      const extra = skillExtraRows(a, b).some((r) => JSON.stringify(r.before) !== JSON.stringify(r.after));
      const dps = Math.abs((pv.statsAfter.sheetDps ?? 0) - (pv.statsBefore.sheetDps ?? 0)) >= 0.05;
      assert.ok(base || stat || extra || dps, `${node.id} r${pv.rankBefore} → ${pv.rankAfter}: 바뀌는 줄이 없다`);
      checked++;
    }
  }
  assert.ok(checked >= 50, `노드 · 랭크 ${checked}`);
  // 전투 함성 r1 → 2 는 방어도 줄이 오른다 · 분열 화염구는 「— → 갈래 3 × 70%」
  const wc = skillExtraRows(describeSkill(null, 'warCry', 1), describeSkill(null, 'warCry', 2)).find((r) => r.key === 'skill.x.armorBuff');
  assert.deepEqual([wc.before, wc.after, wc.dir], [{ v: '40' }, { v: '46' }, 1]);
});

test('costRows — 모자라면 「후」가 음수(골드 12 → −3)가 아니라 모자란 양(붉게) · 넉넉하면 그대로(최종 게이트 — 잡화상 · 대장장이 사기 미리보기)', () => {
  const ch = { gold: 12, materials: { scrap: 1, dust: 0, essence: 0 } };
  const [g] = costRows(t, ch, -15);
  assert.equal(g.before, '12');
  assert.equal(g.after, t('shop.lack', { n: '3' }));
  assert.ok(!/-|−/.test(g.after), g.after);
  assert.equal(g.dir, -1);
  const ok = costRows(t, ch, -5)[0];
  assert.equal(ok.after, '7');
  const mats = costRows(t, ch, -1, { scrap: -3 });
  assert.equal(mats[1].after, t('shop.lack', { n: '2' }));
  assert.ok(STRINGS['shop.lack']);
});
