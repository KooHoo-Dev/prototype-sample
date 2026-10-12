// OWNER: P10 — 계약 §12.2(ui.format) · §10.8(숫자 표시) · §10.4(이름표 쌓기 · 보이는 규칙)
// 순수 ui 함수: format.js · i18n.js · labels.js 의 stackLabels · labelVisible · labelText · minimap.js 의 worldToMap.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtCd, fmtDmg, fmtDps, fmtInt, fmtMul, fmtNum, fmtPct, fmtRange, fmtSec, skillGlyph } from '../src/ui/format.js';
import { BASIC_SKILLS, SKILL_NODES } from '../src/data/skills.js';
import { CLASSES } from '../src/data/classes.js';
import { has, t, tName } from '../src/ui/i18n.js';
import { labelText, labelVisible, stackLabels } from '../src/ui/labels.js';
import { worldToMap } from '../src/ui/minimap.js';

test('fmtInt — 반올림 · 천 단위 쉼표 · 음수 · NaN/∞ 는 화면에 NaN 으로 나가지 않는다', () => {
  assert.equal(fmtInt(0), '0');
  assert.equal(fmtInt(7), '7');
  assert.equal(fmtInt(999), '999');
  assert.equal(fmtInt(1000), '1,000');
  assert.equal(fmtInt(1234567), '1,234,567');
  assert.equal(fmtInt(12345.5), '12,346');
  assert.equal(fmtInt(-42.6), '-43');
  assert.equal(fmtInt(-1234), '-1,234');
  assert.equal(fmtInt(-0.4), '0');
  assert.equal(fmtInt(NaN), '—');
  assert.equal(fmtInt(Infinity), '∞');
  assert.equal(fmtInt(-Infinity), '-∞');
  assert.equal(fmtInt(/** @type {any} */ (undefined)), '—');
});

test('fmtDmg — 피해 숫자: 1 미만의 양수는 「0」이 아니라 소수 한 자리(최소 0.1) · 그 위는 fmtInt(최종 게이트 — 균열 1 몬스터 한 방 ≈ 0.3)', () => {
  assert.equal(fmtDmg(0.31), '0.3');
  assert.equal(fmtDmg(0.04), '0.1');
  assert.equal(fmtDmg(0.94), '0.9');
  assert.equal(fmtDmg(0.96), '1');
  assert.equal(fmtDmg(12.6), '13');
  assert.equal(fmtDmg(1234), '1,234');
  assert.equal(fmtDmg(0), '0');
  assert.equal(fmtDmg(NaN), fmtInt(NaN));
});

test('fmtNum — 소수 자리 · 뒤의 0 지움 · 쉼표', () => {
  assert.equal(fmtNum(12.5), '12.5');
  assert.equal(fmtNum(12.0), '12');
  assert.equal(fmtNum(12.34, 2), '12.34');
  assert.equal(fmtNum(12.3, 2), '12.3');
  assert.equal(fmtNum(1234.56, 1), '1,234.6');
  assert.equal(fmtNum(-3.25, 1), '-3.3');
  assert.equal(fmtNum(-0.04, 1), '0');
  assert.equal(fmtNum(NaN), '—');
  assert.equal(fmtMul(1.25), '×1.25');
  assert.equal(fmtMul(2), '×2');
});

test('fmtPct — 비율(0..1) → 퍼센트 · 소수 자리 · −0 없음', () => {
  assert.equal(fmtPct(0.123), '12%');
  assert.equal(fmtPct(0.123, 1), '12.3%');
  assert.equal(fmtPct(1), '100%');
  assert.equal(fmtPct(0), '0%');
  assert.equal(fmtPct(-0.0001, 1), '0.0%');
  assert.equal(fmtPct(0.035, 1), '3.5%');
  assert.equal(fmtPct(NaN), '—');
  assert.equal(fmtPct(Infinity), '—');
});

test('fmtSec — m:ss · 한 시간 이상이면 h:mm:ss · 음수 · NaN 은 0:00', () => {
  assert.equal(fmtSec(0), '0:00');
  assert.equal(fmtSec(5), '0:05');
  assert.equal(fmtSec(65), '1:05');
  assert.equal(fmtSec(402), '6:42');
  assert.equal(fmtSec(59.6), '1:00');
  assert.equal(fmtSec(3600), '1:00:00');
  assert.equal(fmtSec(3725), '1:02:05');
  assert.equal(fmtSec(-3), '0:00');
  assert.equal(fmtSec(NaN), '0:00');
});

test('fmtCd — 쿨다운 · 버프 남은 초(10초 미만 소수 한 자리 · 올림)', () => {
  assert.equal(fmtCd(0), '');
  assert.equal(fmtCd(-1), '');
  assert.equal(fmtCd(0.04), '0.1');
  assert.equal(fmtCd(2.31), '2.4');
  assert.equal(fmtCd(9.95), '10.0');
  assert.equal(fmtCd(12.2), '13');
  assert.equal(fmtCd(NaN), '');
});

test('fmtDps — 100 미만 소수 한 자리 · 그 위 정수(쉼표)', () => {
  assert.equal(fmtDps(7.8925), '7.9');
  assert.equal(fmtDps(7), '7.0');
  assert.equal(fmtDps(0), '0.0');
  assert.equal(fmtDps(99.94), '99.9');
  assert.equal(fmtDps(100), '100');
  assert.equal(fmtDps(1234.5), '1,235');
  assert.equal(fmtDps(NaN), '—');
});

test('fmtRange — [a, b] → a–b(반올림 · 같으면 하나)', () => {
  assert.equal(fmtRange([3.2, 7.8]), '3–8');
  assert.equal(fmtRange([1200, 3400]), '1,200–3,400');
  assert.equal(fmtRange([5, 5.2]), '5');
  assert.equal(fmtRange(/** @type {any} */ (null)), '—');
  assert.equal(fmtRange(/** @type {any} */ ([1])), '—');
});

test('i18n — 치환 · 없는 params 는 그대로 · 없는 키는 키 그대로(경고 한 번) · 이름 키 배열', () => {
  assert.equal(t('reason.level', { n: 12 }), '레벨 12 이상이어야 한다');
  assert.equal(t('hud.level', { n: 3 }), '레벨 3');
  assert.equal(t('hud.level'), '레벨 {n}');
  assert.equal(t('class.warrior'), '전사');
  assert.ok(has('class.mage'));
  assert.ok(!has('no.such.key'));
  const warn = console.warn;
  let warned = 0;
  console.warn = () => { warned++; };
  try {
    assert.equal(t('no.such.key.p10'), 'no.such.key.p10');
    assert.equal(t('no.such.key.p10'), 'no.such.key.p10');
  } finally {
    console.warn = warn;
  }
  assert.equal(warned, 1, '없는 키 경고는 한 번');
  assert.equal(tName(['elite.a.1', 'elite.b.1']), '굶주린 포식자');
  assert.equal(tName('mon.ghoul'), '굶주린 구울');
  assert.equal(tName(null), '');
  assert.equal(tName([]), '');
});

test('stackLabels — 겹치는 이름표는 화면 y 순으로 아래로 밀려 쌓이고 서로 겹치지 않는다', () => {
  // 같은 자리 다섯 개 + 떨어진 하나
  const n = 6;
  const xs = new Float64Array([100, 100, 104, 98, 101, 400]);
  const ys = new Float64Array([200, 200, 201, 199, 200, 200]);
  const ws = new Float64Array([80, 60, 90, 70, 50, 80]);
  const hs = new Float64Array(n).fill(18);
  const order = new Int32Array(n);
  stackLabels(n, xs, ys, ws, hs, order, 1);
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      const ox = Math.abs(xs[a] - xs[b]) * 2 < ws[a] + ws[b];
      const oy = ys[a] < ys[b] + hs[b] && ys[b] < ys[a] + hs[a];
      assert.ok(!(ox && oy), `이름표 ${a} · ${b} 가 겹친다`);
    }
  }
  assert.equal(ys[5], 200, '겹치지 않는 이름표는 제자리');
  assert.equal(Math.min(...Array.from(ys.slice(0, 5))), 199, '가장 위의 것이 기준(제자리)');
  // 순서: 놓은 순서 = 원래 y 순(위부터)
  assert.equal(order[0], 3);
  // 쌓인 것은 아래로만 밀린다
  assert.ok(ys[0] >= 200 && ys[1] >= 200 && ys[2] >= 201 && ys[4] >= 200);
  // 아무것도 없으면 아무 일도 없다
  stackLabels(0, xs, ys, ws, hs, order);
});

test('labelVisible — 희귀 이상은 늘 · 그 아래는 Alt · 늘 이름표 · 일반 숨기기 · 골드 · 재료 · 포션은 Alt 만 · 구슬은 없다', () => {
  const off = { alt: false, always: false, hideNormal: false };
  const alt = { alt: true, always: false, hideNormal: false };
  const always = { alt: false, always: true, hideNormal: false };
  const hide = { alt: true, always: true, hideNormal: true };
  const item = (rarity) => ({ kind: 'item', rarity });
  for (const r of ['rare', 'legendary', 'set']) {
    assert.ok(labelVisible(item(r), off), r);
    assert.ok(labelVisible(item(r), hide), r);
  }
  for (const r of ['normal', 'magic']) {
    assert.ok(!labelVisible(item(r), off), r);
    assert.ok(labelVisible(item(r), alt), r);
    assert.ok(labelVisible(item(r), always), r);
  }
  assert.ok(!labelVisible(item('normal'), hide), '일반 숨기기');
  assert.ok(labelVisible(item('magic'), hide));
  for (const k of ['gold', 'material', 'potion']) {
    assert.ok(!labelVisible({ kind: k, rarity: null }, off), k);
    assert.ok(!labelVisible({ kind: k, rarity: null }, always), k + ' — 늘 이름표로는 보이지 않는다');
    assert.ok(labelVisible({ kind: k, rarity: null }, alt), k);
  }
  assert.ok(!labelVisible({ kind: 'globe', rarity: null }, alt));
});

test('labelText — 아이템 이름 키 · 골드 · 재료 · 포션 문면(문자열 키가 그대로 나오지 않는다)', () => {
  assert.equal(labelText({ kind: 'item', rarity: 'rare', item: { name: ['rare.a.4', 'rare.b.17'] } }), '어둠 날개');
  assert.equal(labelText({ kind: 'item', rarity: 'magic', item: { name: ['afx.vit.s', 'base.sword.0'] } }), `${t('afx.vit.s')} ${t('base.sword.0')}`);
  assert.equal(labelText({ kind: 'gold', amount: 1234 }), '1,234 골드');
  assert.equal(labelText({ kind: 'material', mat: 'dust', amount: 2 }), '비전 가루 2개');
  assert.equal(labelText({ kind: 'potion', amount: 1 }), '체력 포션');
  for (const s of [labelText({ kind: 'gold', amount: 5 }), labelText({ kind: 'material', mat: 'scrap', amount: 1 })]) assert.ok(!/[a-z]+\.[a-z]+/.test(s), s);
});

test('worldToMap — 미니맵이 화면과 같은 방향(화면 위 = 월드 (−1, −1) · 화면 오른쪽 = 월드 (1, −1))', () => {
  const out = { x: 0, y: 0 };
  worldToMap(0, 0, 0, 0, 1, 100, 100, out);
  assert.deepEqual(out, { x: 100, y: 100 });
  worldToMap(-1, -1, 0, 0, 10, 100, 100, out);
  assert.ok(Math.abs(out.x - 100) < 1e-9 && out.y < 100, '월드 (−1, −1) → 위');
  worldToMap(1, -1, 0, 0, 10, 100, 100, out);
  assert.ok(Math.abs(out.y - 100) < 1e-9 && out.x > 100, '월드 (1, −1) → 오른쪽');
  worldToMap(3, 4, 3, 4, 7, 50, 60, out);
  assert.deepEqual(out, { x: 50, y: 60 });
});

test('skillGlyph — 스킬 칸 아이콘 두 글자가 한 클래스 안에서 겹치지 않는다(화면 패스 — 「지」 · 「마」 겹침 회귀)', () => {
  assert.equal(skillGlyph('지면 강타'), '지강');
  assert.equal(skillGlyph('지진'), '지진');
  assert.equal(skillGlyph('화염구'), '화염');
  assert.equal(skillGlyph(''), '');
  for (const c of CLASSES) {
    const ids = [c.basic, ...SKILL_NODES.filter((n) => n.cls === c.id && n.kind === 'active').map((n) => n.id)];
    // HUD 와 같은 길 — 예외표(glyph.<id> — 다른 낱말로 읽히는 것)가 있으면 그것
    const glyphs = ids.map((id) => (has('glyph.' + id) ? t('glyph.' + id) : skillGlyph(t((Object.prototype.hasOwnProperty.call(BASIC_SKILLS, id) ? 'skill.' : 'node.') + id + '.name'))));
    for (const bad of ['전함', '연번', '화염']) assert.ok(!glyphs.includes(bad), `${c.id}: 「${bad}」는 다른 낱말로 읽힌다`);
    assert.equal(new Set(glyphs).size, glyphs.length, `${c.id}: ${glyphs.join(' ')}`);
    for (const g of glyphs) assert.ok(g.length >= 1 && g.length <= 2, g);
  }
});
