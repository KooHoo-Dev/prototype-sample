// OWNER: 피드백 1(ui 단계 · 2026-10-12) — 계약 §10.3(포션 칸) · §10.4(떨어진 직후 이름표 · 주운 골드) · §10.6(스킬 트리 넉백 · 반경 · 균열 완료 골드)
// Jay 「포션을 받는 줄 몰랐다 · 일반 몬스터가 드랍하는지 몰랐다」의 ui 쪽 회귀 — 순수 함수와 GameSim(Node)만 쓴다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TICK_HZ } from '../src/core/constants.js';
import { EV, EventBus } from '../src/core/events.js';
import { makeInput } from '../src/core/inputFrame.js';
import { START } from '../src/data/economy.js';
import { STRINGS } from '../src/data/strings.ko.js';
import { GameSim } from '../src/sim/GameSim.js';
import { spawnDrops } from '../src/sim/drops.js';
import { describeSkill } from '../src/sim/player/skills.js';
import { potionUrge } from '../src/ui/hud.js';
import { t } from '../src/ui/i18n.js';
import { FRESH_LABEL_SEC, freshAlpha, labelVisible } from '../src/ui/labels.js';
import { SKILL_EXTRA_KEYS, skillExtraRows } from '../src/ui/pnlLogic.js';

const base = { alt: false, always: false, hideNormal: false };
const item = (r) => ({ kind: 'item', rarity: r });

test('떨어진 직후 이름표 — fresh 면 일반 · 마법 장비 · 골드 · 재료 · 포션도 보인다 · 「일반 등급 숨기기」의 흰 장비는 그래도 숨긴다 · 구슬은 없다', () => {
  const fresh = { ...base, fresh: true };
  for (const r of ['normal', 'magic']) {
    assert.ok(!labelVisible(item(r), base), r + ' — 평소에는 Alt');
    assert.ok(labelVisible(item(r), fresh), r + ' — 떨어진 직후');
  }
  for (const k of ['gold', 'material', 'potion']) {
    assert.ok(!labelVisible({ kind: k, rarity: null }, base), k);
    assert.ok(labelVisible({ kind: k, rarity: null }, fresh), k + ' — 떨어진 직후');
  }
  assert.ok(!labelVisible(item('normal'), { ...fresh, hideNormal: true }), '일반 숨기기면 떨어진 직후에도 숨김');
  assert.ok(labelVisible(item('magic'), { ...fresh, hideNormal: true }));
  assert.ok(!labelVisible({ kind: 'globe', rarity: null }, fresh), '구슬은 이름표가 없다');
});

test('freshAlpha — 떨어진 틱부터 FRESH_LABEL_SEC 동안 1 · 끝 0.4초에 흐려진다 · 뒤로는 0 · 이상한 값이면 0', () => {
  const born = 1000;
  assert.equal(freshAlpha(born, born), 1);
  assert.equal(freshAlpha(born, born + Math.floor(TICK_HZ * 1.5)), 1);
  const late = freshAlpha(born, born + Math.round(TICK_HZ * (FRESH_LABEL_SEC - 0.2)));
  assert.ok(late > 0 && late < 1, String(late));
  assert.equal(freshAlpha(born, born + Math.ceil(TICK_HZ * FRESH_LABEL_SEC)), 0);
  assert.equal(freshAlpha(born, born - 5), 0, '미래에 떨어진 드랍(고정 상태 등)');
  assert.equal(freshAlpha(NaN, born), 0);
  assert.ok(FRESH_LABEL_SEC >= 1.5 && FRESH_LABEL_SEC <= 3, '약 2초');
});

test('potionUrge — 저생명 · 포션 있음 · 재사용 대기 끝 · 살아 있음일 때만', () => {
  const p = { dead: false, lowLife: true, potionReadyAt: 0 };
  const ch = { potions: 3 };
  assert.equal(potionUrge(p, ch, 100), true);
  assert.equal(potionUrge({ ...p, lowLife: false }, ch, 100), false);
  assert.equal(potionUrge(p, { potions: 0 }, 100), false);
  assert.equal(potionUrge({ ...p, potionReadyAt: 150 }, ch, 100), false, '재사용 대기 중');
  assert.equal(potionUrge({ ...p, dead: true }, ch, 100), false);
  assert.equal(potionUrge(null, ch, 100), false);
});

test('포션 · 시작 보급 문면 — 실제 개수 · 회복 % · 재사용 대기를 넣고 {자리}가 남지 않는다', () => {
  for (const k of ['hint.potion.title', 'hint.potion.body', 'hint.controls.potion', 'newChar.kit', 'hud.potion', 'hud.potionTip', 'label.goldPicked', 'skill.radius', 'skill.x.knock', 'skill.x.knock.v', 'glyph.groundStomp']) {
    assert.ok(typeof STRINGS[k] === 'string' && STRINGS[k].length, k);
  }
  const kit = t('newChar.kit', { potions: START.potions, scrolls: START.scrolls });
  assert.ok(kit.includes(String(START.potions)) && kit.includes(String(START.scrolls)) && !kit.includes('{'), kit);
  const line = t('hint.controls.potion', { n: 5, heal: 45, cd: 8 });
  assert.ok(line.startsWith('Q') && line.includes('5개') && !line.includes('{'), line);
  assert.ok(!t('hint.potion.body', { n: 2, heal: 45, cd: 8 }).includes('{'));
  assert.equal(t('label.goldPicked', { n: '1,234' }), '+1,234 골드');
});

test('스킬 트리 — 회전 베기의 넉백 줄(skill.x.knock)과 기절 줄 없음 · 키가 SKILL_EXTRA_KEYS 에 있다', () => {
  assert.ok(SKILL_EXTRA_KEYS.includes('skill.x.knock') && SKILL_EXTRA_KEYS.includes('skill.x.knock.v'));
  const a = describeSkill(null, 'groundStomp', 1);
  const b = describeSkill(null, 'groundStomp', 2);
  const rows = skillExtraRows(a, b);
  const knock = rows.find((r) => r.key === 'skill.x.knock');
  assert.ok(knock, JSON.stringify(rows));
  assert.equal(t('skill.x.knock.v', /** @type {any} */ (knock.after)), '0.8m');
  assert.ok(!rows.some((r) => r.key === 'skill.x.stun'), '회전 베기는 기절이 없다');
  assert.ok(a.radius > 0, '반경 줄(skill.radius)');
});

test('균열 완료의 골드 줄 = 이번 판에 실제로 주운 골드(DROP_PICKED gold 합) · 주운 순간 DROP_PICKED{kind:gold, amount}', () => {
  const bus = new EventBus();
  const sim = new GameSim({ bus, seed: 5, devSession: true });
  sim.start();
  sim.newCharacter({ slot: 0, cls: 'warrior', name: 'G' });
  assert.equal(sim.debugOpenRift(1).ok, true);
  let picked = 0;
  let events = 0;
  bus.on(EV.DROP_PICKED, (e) => { if (e.kind === 'gold') { picked += e.amount; events++; } });
  const p = sim.state.player.pos;
  spawnDrops(sim.ctx, [{ kind: 'gold', amount: 7 }, { kind: 'gold', amount: 11 }, { kind: 'gold', amount: 3 }], p.x, p.z);
  for (let i = 0; i < 60; i++) sim.step(makeInput({}));
  assert.ok(events >= 3, '자동 줍기 — 골드 더미 셋');
  assert.ok(picked >= 21, String(picked));
  assert.equal(sim.state.rift.stats.gold, picked, '판 통계 = 주운 합');
  assert.equal(sim.debugCompleteRift().ok, true);
  assert.equal(sim.state.rift.summary.gold, picked, '완료 패널의 골드 줄');
});

test('Jay 피드백 2 — 새 캐릭터는 체력 포션 START.potions(> 0)와 귀환 두루마리를 받고 · 첫 균열에서 Q 로 바로 마실 수 있다 · 지급 문구가 그 수를 쓴다', () => {
  assert.ok(START.potions >= 3, `시작 포션 ${START.potions}`);
  assert.ok(START.scrolls >= 1, `시작 두루마리 ${START.scrolls}`);
  for (const cls of ['warrior', 'mage']) {
    const bus = new EventBus();
    const sim = new GameSim({ bus, seed: 9, devSession: true });
    sim.start();
    assert.equal(sim.newCharacter({ slot: 0, cls, name: 'P' }).ok, true);
    assert.equal(sim.state.char.potions, START.potions, `${cls} 새 캐릭터 포션`);
    assert.equal(sim.state.char.scrolls, START.scrolls, `${cls} 새 캐릭터 두루마리`);
    assert.equal(sim.debugOpenRift(1).ok, true);
    const p = sim.state.player;
    p.life = p.lifeMax * 0.2;
    let drank = null;
    bus.on(EV.POTION, (e) => { drank = e; });
    sim.step(makeInput({ potionDown: true }));
    sim.step(makeInput({}));
    assert.ok(drank && drank.heal > 0, `${cls} Q → POTION`);
    assert.equal(drank.left, START.potions - 1);
    assert.equal(sim.state.char.potions, START.potions - 1);
  }
  const kit = t('newChar.kit', { potions: START.potions, scrolls: START.scrolls });
  assert.ok(kit.includes(String(START.potions)) && kit.includes(String(START.scrolls)), kit);
});
