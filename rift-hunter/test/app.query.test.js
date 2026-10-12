// OWNER: P9 — 계약 §12.2 · §11.7
// 쿼리 해석 · dev 판정 · 값 정화 · ?panel 의 고정 상태 짝(순수 — Node)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVEL_CAP, PANEL_IDS } from '../src/core/constants.js';
import { RIFT } from '../src/data/rift.js';
import { FIXTURES } from '../src/debug/fixtures.js';
import { NO_STATE_PANELS, PANEL_FIXTURE, parseQuery, parseSeed } from '../src/app/query.js';

test('app.query: 쿼리 없음 · 모르는 키 → dev 아님(세이브를 쓴다)', () => {
  for (const s of ['', '?', '?utm_source=x', '?foo=1&bar']) {
    const q = parseQuery(s);
    assert.equal(q.dev, false, s);
    assert.equal(q.makeChar, false, s);
    assert.equal(q.fixture, null);
    assert.equal(q.panel, null);
    assert.equal(q.bot, false);
    assert.equal(q.strategy, 'basic');
  }
});

test('app.query: ?panel(상태가 필요 없는 패널) · ?analytics 만 있으면 dev 가 아니다', () => {
  assert.deepEqual([parseQuery('?analytics=1').dev, parseQuery('?analytics=1').analytics], [false, true]);
  for (const id of NO_STATE_PANELS) {
    const q = parseQuery('?panel=' + id);
    assert.equal(q.dev, false, id);
    assert.equal(q.panel, id);
    assert.equal(q.panelFixture, null, id);
  }
  const q = parseQuery('?panel=settings&analytics=1');
  assert.equal(q.dev, false);
  assert.equal(q.analytics, true);
});

test('app.query: 캐릭터 상태가 필요한 ?panel 단독 → 고정 상태를 함께(dev — 고정 상태를 세이브에 쓰지 않는다)', () => {
  const need = PANEL_IDS.filter((id) => !NO_STATE_PANELS.includes(id));
  for (const id of need) {
    assert.ok(PANEL_FIXTURE[id], `PANEL_FIXTURE.${id}`);
    assert.ok(FIXTURES[PANEL_FIXTURE[id]], `fixture ${PANEL_FIXTURE[id]} 있음`);
    const q = parseQuery('?panel=' + id);
    assert.equal(q.panelFixture, PANEL_FIXTURE[id]);
    assert.equal(q.dev, true, id);
  }
  assert.equal(parseQuery('?panel=blacksmith').panelFixture, 'shops');
  // 캐릭터를 만드는 쿼리가 있으면 고정 상태 없이 그 캐릭터로
  const q = parseQuery('?class=mage&panel=inventory');
  assert.equal(q.panelFixture, null);
  assert.equal(q.makeChar, true);
  // ?fixture 가 있으면 그것이 먼저(§11.7 — 다른 쿼리보다 먼저)
  const f = parseQuery('?fixture=bag&panel=stash');
  assert.equal(f.fixture, 'bag');
  assert.equal(f.panelFixture, null);
  assert.equal(f.makeChar, false);
  // 모르는 패널은 버린다
  assert.equal(parseQuery('?panel=nope').panel, null);
  assert.equal(parseQuery('?panel=nope').dev, false);
});

test('app.query: 개발 키 하나라도 있으면 dev — fresh 단독은 캐릭터를 만들지 않는다(새 캐릭터 화면)', () => {
  const fresh = parseQuery('?fresh=1');
  assert.equal(fresh.dev, true);
  assert.equal(fresh.fresh, true);
  assert.equal(fresh.makeChar, false);
  for (const s of ['?class=warrior', '?level=5', '?preset=1', '?rift=2', '?seed=9', '?scene=town', '?bot=1', '?strategy=noDodge']) {
    const q = parseQuery(s);
    assert.equal(q.dev, true, s);
    assert.equal(q.makeChar, true, s);
  }
  const fx = parseQuery('?fixture=riftSwarm');
  assert.equal(fx.dev, true);
  assert.equal(fx.fixture, 'riftSwarm');
  assert.equal(fx.makeChar, false);
});

test('app.query: README 「바로 해 보기」 쿼리', () => {
  const a = parseQuery('?class=warrior&level=18&rift=10');
  assert.deepEqual([a.cls, a.level, a.rift, a.preset, a.dev, a.makeChar], ['warrior', 18, 10, null, true, true]);
  const b = parseQuery('?class=mage&level=20&rift=12&preset=1');
  assert.deepEqual([b.cls, b.level, b.rift, b.preset], ['mage', 20, 12, 1]);
  const c = parseQuery('/?class=warrior&level=24&rift=18&bot=1'.slice(1));
  assert.deepEqual([c.cls, c.level, c.rift, c.bot, c.strategy], ['warrior', 24, 18, true, 'basic']);
  assert.equal(parseQuery('?fixture=riftAffixes').fixture, 'riftAffixes');
  assert.equal(parseQuery('?fixture=riftLoot').fixture, 'riftLoot');
});

test('app.query: 값 정화 — 범위 · 모르는 값', () => {
  assert.equal(parseQuery('?class=paladin').cls, null);
  assert.equal(parseQuery('?class=paladin').dev, true);
  assert.equal(parseQuery('?level=0').level, 1);
  assert.equal(parseQuery('?level=99').level, LEVEL_CAP);
  assert.equal(parseQuery('?level=abc').level, null);
  assert.equal(parseQuery('?level=12.7').level, 12);
  assert.equal(parseQuery('?rift=0').rift, 1);
  assert.equal(parseQuery('?rift=100000').rift, RIFT.maxLevel);
  assert.equal(parseQuery('?preset=7').preset, 1);
  assert.equal(parseQuery('?preset=-3').preset, 0);
  assert.equal(parseQuery('?scene=dungeon').scene, null);
  assert.equal(parseQuery('?scene=rift').scene, 'rift');
  assert.equal(parseQuery('?strategy=challenge').strategy, 'challenge');
  assert.equal(parseQuery('?strategy=cheat').strategy, 'basic');
  assert.equal(parseQuery('?bot=0').bot, false);
  assert.equal(parseQuery('?bot').bot, true);
  assert.equal(parseQuery('?bot=true').bot, true);
  assert.equal(parseQuery('?fresh=0').fresh, false);
  assert.equal(parseQuery('?fresh=0').dev, true, '키가 있으면 dev(세이브를 건드리지 않는 쪽으로)');
});

test('app.query: 시드 — 10진 정수 · 글자는 해시(결정적 · uint32)', () => {
  assert.equal(parseQuery('?seed=42').seed, 42);
  assert.equal(parseQuery('?seed=4294967297').seed, 1, 'uint32 로 자른다');
  assert.equal(parseQuery('').seed, null);
  assert.equal(parseQuery('?seed=').seed, null);
  const h = parseSeed('hello');
  assert.ok(Number.isInteger(h) && h >= 0 && h < 2 ** 32);
  assert.equal(parseSeed('hello'), h, '같은 글자 = 같은 시드');
  assert.notEqual(parseSeed('hello'), parseSeed('world'));
});

test('app.query: 이상한 입력에도 던지지 않는다', () => {
  for (const s of [undefined, null, 12, '?%E0%A4%A', '?class=%00', '?&&&=', '?level=Infinity&rift=NaN']) {
    const q = parseQuery(/** @type {any} */ (s));
    assert.equal(typeof q.dev, 'boolean');
  }
  assert.equal(parseQuery('?level=Infinity').level, null);
});
