// OWNER: P8 — 리뷰 수정(ui-app) 회귀: 안내 카드(새 게임 · 뜰채) · 지속 알림 · 패널 격자 화살표 · 상점 「(◀▶)」 · 도감의 전설 조건과 단가 ·
// 판매상 단가 · 잠김 사유 조사 · 채비 바닥글 · 파이팅 중 채비 줄 · 조준 호 밖 알림.
// 실제 GameSim 과 UIRoot(가짜 DOM — fakeDom.js)로 돈다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement, installFakeDom } from './fakeDom.js';

installFakeDom();
const { UIRoot } = await import('../src/ui/UIRoot.js');
const { hintCandidate, hintStale } = await import('../src/ui/hints.js');
const { t } = await import('../src/ui/i18n.js');
const { GameSim } = await import('../src/sim/GameSim.js');
const { EventBus } = await import('../src/core/events.js');
const { makeInput } = await import('../src/core/inputFrame.js');
const { HINT_IDS } = await import('../src/core/constants.js');

/** @param {Object} [simOpts] */
function makeUi(simOpts = {}) {
  const bus = new EventBus();
  const sim = new GameSim({ bus, seed: 3, ...simOpts });
  const actions = { newGame() {}, continueGame() {}, resume() {}, quitToTitle() {}, applySettings() {}, travel() { return { ok: true }; }, waitNextBand() { return { ok: true }; }, sleep() { return { ok: true }; }, requestPointerLock() {} };
  const ui = new UIRoot({ root: /** @type {any} */ (new FakeElement('div')), bus, sim, settings: { hints: true }, actions, fishPreview: /** @type {any} */ ({ ok: false }) });
  sim.start();
  return { bus, sim, ui };
}

/** @param {any} sim @param {string[]} ids */
function markSeen(sim, ids) {
  for (const id of ids) sim.state.profile.flags.hints[id] = true;
}

/** @param {any} ui */
function noticeTexts(ui) {
  return ui.notices.map((n) => n.node.textContent);
}

test('안내: 같은 실행에서 새 게임을 하면 첫 플레이 안내가 다시 뜬다', () => {
  const { sim, ui } = makeUi();
  ui.update(sim.state, 0.1);
  assert.equal(ui._hint.id, 'start');
  for (let i = 0; i < 70; i++) ui.update(sim.state, 0.1);   // 6초 수명이 끝났다
  assert.equal(ui.hintEl.hidden, true);
  ui.toast('hud.notice.perfect', { m: '1' });
  ui.banner('banner.levelUp', { n: 2 });
  sim.newGame(9);   // SCENE_CHANGED{new}
  assert.equal(ui.notices.length, 0, '옛 알림을 비웠다');
  assert.equal(ui.bannerQueue.length, 0, '옛 배너 대기열을 비웠다');
  ui.update(sim.state, 0.1);
  assert.equal(ui._hint.id, 'start', '시작 안내가 다시 후보가 된다');
  assert.equal(ui.hintEl.hidden, false);
  assert.equal(ui.hintTitle.textContent, t('hint.start.title'));
});

test('안내: 뜰채 안내는 랜딩이 끝나면 내린다(결과 패널 뒤 다음 캐스팅 화면에 다시 뜨지 않는다)', () => {
  const { sim, ui } = makeUi({ start: { spotId: 'lake_gravel', hour: 8 } });
  markSeen(sim, HINT_IDS.filter((id) => id !== 'net'));
  sim.debugForceFight('carp', 0.5);
  sim.state.fight.canNet = true;
  ui.update(sim.state, 0.1);
  assert.equal(ui._hint.id, 'net');
  sim.debugSkipToResult('carp', 0.5);
  ui.update(sim.state, 0.1);
  assert.equal(ui.activePanel, 'result');
  sim.keepCatch();
  for (let i = 0; i < 3; i++) ui.update(sim.state, 0.1);
  assert.equal(sim.state.rig.phase, 'ready');
  assert.notEqual(ui._hint.id, 'net', '뜰채 안내가 남지 않는다');
  assert.equal(ui.hintEl.hidden, true);

  // 순수 규칙
  const st = (mode, phase) => ({ scene: 'lake', player: { mode }, rig: { phase } });
  assert.equal(hintStale('net', st('fish', 'fighting')), false);
  assert.equal(hintStale('net', st('fish', 'landing')), false);
  assert.equal(hintStale('net', st('fish', 'result')), true);
  assert.equal(hintStale('net', st('fish', 'ready')), true);
  assert.equal(hintStale('fight', st('fish', 'failed')), false, '실패 알림과 같이 남는다');
  assert.equal(hintStale('fight', st('fish', 'result')), true);
  assert.equal(hintStale('bite', st('fish', 'retrieving')), false);
  assert.equal(hintStale('controls', st('walk', 'idle')), true);
  assert.equal(hintStale('start', { scene: 'home', player: { mode: 'walk' }, rig: { phase: 'idle' } }), false);
  assert.equal(hintCandidate(sim.state, () => true), '');
});

test('지속 알림(setSticky): 수명 · 다른 알림에 밀리지 않고 지우면 내린다', () => {
  const { sim, ui } = makeUi();
  ui.setSticky('hud.notice.contextLost');
  for (let i = 0; i < 6; i++) ui.toast('hud.notice.perfect', { m: String(i) });
  for (let i = 0; i < 100; i++) ui.update(sim.state, 0.1);
  assert.deepEqual(noticeTexts(ui), [t('hud.notice.contextLost')]);
  ui.setSticky(null);
  assert.equal(ui.notices.length, 0);
  assert.equal(ui.noticeEl.children.length, 0);
});

test('패널 격자: 도감 카드는 ←→ 이웃 · ↑↓ 한 줄 — 탭을 바꾸지 않는다 · 지도 카드는 ←→', () => {
  const { sim, ui } = makeUi();
  ui.openPanel('tackle', { tab: 1 });
  const p = ui.panels.tackle;
  assert.equal(p.tabs[p.tab], 'tackle.tab.dex');
  const g = p.grid;
  assert.ok(g && g.to - g.from + 1 === 12, '카드 12장이 격자');
  // 실제 배치처럼 4열(가짜 DOM 은 배치가 없다)
  for (let i = g.from; i <= g.to; i++) Object.defineProperty(p.items[i].el, 'offsetTop', { value: Math.floor((i - g.from) / 4) * 100 });
  const key = (code) => ui.handleKey(/** @type {any} */ ({ code, cancelable: true, preventDefault() {} }));
  p.setFocus(g.from);
  key('ArrowDown');
  assert.equal(p.focus, g.from + 4, '↓ = 아래 줄');
  key('ArrowRight');
  assert.equal(p.focus, g.from + 5, '→ = 오른쪽 이웃');
  key('ArrowLeft');
  key('ArrowLeft');
  assert.equal(p.focus, g.from + 3, '← 가 윗줄 끝으로 이어진다');
  key('ArrowUp');
  assert.equal(p.focus, 0, '첫 줄에서 ↑ = 스테이지 선택');
  p.setFocus(g.to);
  key('ArrowRight');
  assert.equal(p.focus, g.to);
  assert.equal(p.tabs[p.tab], 'tackle.tab.dex', '마지막 카드의 → 가 탭을 바꾸지 않는다');
  key('ArrowDown');
  assert.equal(p.focus, g.to);
  // 스테이지 선택 줄의 ←→ 는 값(스테이지)
  p.setFocus(0);
  const st0 = p.dexStage;
  key('ArrowRight');
  assert.notEqual(p.dexStage, st0);
  assert.equal(p.tabs[p.tab], 'tackle.tab.dex');
  // Q/E 는 여전히 탭
  key('KeyE');
  assert.equal(p.tabs[p.tab], 'tackle.tab.skill');
  assert.equal(p.foot.textContent, t('tackle.footSkill'), '스킬 탭 바닥글 = Enter 배우기');
  key('KeyQ');
  assert.equal(p.foot.textContent, t('tackle.footDex'));
  key('KeyQ');
  assert.equal(p.foot.textContent, t('tackle.foot'));

  // 지도: 가로 카드 — → 로 다음 카드
  ui.openPanel('map', {});
  const m = ui.panels.map;
  assert.ok(m.grid && m.items.length >= 2);
  m.setFocus(0);
  key('ArrowRight');
  assert.equal(m.focus, 1);
  key('ArrowLeft');
  assert.equal(m.focus, 0);
});

test('상점 줄: 「(◀▶)」는 세트를 바꿀 수 있는 줄에만 · 잠김 사유 조사 · PC 날씨 문면', () => {
  const { sim, ui } = makeUi();
  ui.openPanel('pc', { tab: 0 });
  const p = ui.panels.pc;
  let withAdjust = 0;
  let without = 0;
  for (const it of p.items) {
    const set = it.el.find('row-set');
    if (!set) continue;
    const marked = set.textContent.includes('◀▶');
    assert.equal(marked, !!it.adjust, '「(◀▶)」 ↔ 값 조절: ' + it.el.textContent);
    if (it.adjust) withAdjust++; else without++;
  }
  assert.ok(withAdjust > 0 && without > 0, `두 종류가 다 있다(${withAdjust} · ${without})`);
  assert.equal(t('reason.level', { n: 5 }), '레벨 5 필요');
  assert.equal(t('reason.mastery', { n: 2 }), '낚시 숙련 2단계 필요');
  assert.ok(p.body.textContent.includes(t('reason.level', { n: 5 })), '잠긴 줄에 그 문구');
  ui.openPanel('pc', { tab: 1 });
  const note = ui.panels.pc.body.textContent;
  assert.ok(note.includes(t('pc.weatherNote')));
  assert.ok(!t('pc.weatherNote').includes('판타지 어종이 모습을 드러낸다'));
});

test('도감: 전설 어종의 출현 조건(시간대 · 날씨)과 단가가 보인다 · 판매상 줄에 단가', () => {
  const { sim, ui } = makeUi();
  ui.openPanel('pc', { tab: 2 });
  const p = ui.panels.pc;
  const i = p.items.findIndex((it) => it.el.textContent.includes(t('species.goldenDragon')));
  assert.ok(i > 0, '금룡 카드');
  p.setFocus(i);
  const info = p.body.find('dex-info');
  const text = info.textContent;
  assert.ok(text.includes(t('dex.appear')), text);
  assert.ok(text.includes(t('dex.appearWhen', { bands: t('band.dawn'), weather: t('weather.clear') })), text);
  assert.ok(text.includes(t('unit.wonPerKg', { v: '3,000' })), '단가 3,000원/kg: ' + text);
  // 판타지가 아닌 어종에는 출현 조건 줄이 없다
  const j = p.items.findIndex((it) => it.el.textContent.includes(t('species.carp')));
  p.setFocus(j);
  assert.ok(!p.body.find('dex-info').textContent.includes(t('dex.appear')));

  // 판매상: 어창 물고기 줄에 「단가 n원/kg」
  const f = makeUi({ start: { spotId: 'lake_gravel', hour: 8 } });
  f.sim.debugSkipToResult('carp', 0.5);
  f.sim.keepCatch();
  f.ui.update(f.sim.state, 0.1);   // 결과 패널이 자가 동기화로 닫힌다
  f.ui.openPanel('sell', {});
  const row = f.ui.panels.sell.items.find((it) => it.el.classList.contains('row-fish'));
  assert.ok(row, '물고기 줄');
  assert.match(row.el.textContent, /단가 [\d,]+원\/kg/);
});

test('파이팅 중 채비 줄의 「스풀」은 숨긴다(파이팅 상자의 라인 잔량과 겹치지 않게) · 용어', () => {
  const { sim, ui } = makeUi({ start: { spotId: 'lake_gravel', hour: 8 } });
  ui.update(sim.state, 0.1);
  assert.equal(ui.hud.rigLeft.hidden, false);
  sim.debugForceFight('carp', 0.5);
  ui.update(sim.state, 0.1);
  assert.equal(ui.hud.rigLeft.hidden, true);
  assert.ok(ui.hud.limitText.textContent.startsWith('라인 강도') || ui.hud.limitText.textContent.startsWith('로드 상한'), ui.hud.limitText.textContent);
  assert.ok(!t('skillDesc.pumping.1').includes('체력 소모'));
  assert.ok(!t('skillDesc.lineCare.1').includes('슬랙'));
  assert.equal(t('hud.rodStress').startsWith('로드 상한'), true);
});

test('조준이 캐스팅 호 밖이면 충전을 시작할 때 한 번 알린다', () => {
  const { sim, ui } = makeUi({ start: { spotId: 'lake_gravel', hour: 8 } });
  const aim = t('hud.notice.aimOut');
  sim.step(makeInput({ yaw: 0.2, primary: true, primaryPressed: true }));
  assert.equal(sim.state.rig.phase, 'charging');
  assert.ok(!noticeTexts(ui).includes(aim), '호 안이면 알림 없음');
  sim.step(makeInput({ yaw: 0.2 }));   // 놓기 → 캐스팅
  sim.exitFishing();
  sim.debugGotoSpot('lake_gravel');
  sim.step(makeInput({ yaw: 2.2, primary: true, primaryPressed: true }));
  assert.equal(sim.state.rig.phase, 'charging');
  assert.ok(noticeTexts(ui).includes(aim), '호 밖(2.2rad · 호 ±0.6)이면 알린다');
});

test('충전 중 착수점이 장애물 띠 안이면 게이지 거리가 붉게 「장애물 띠」(최종 게이트 — 판정은 spot.snag.fromM)', () => {
  const { sim, ui } = makeUi({ start: { spotId: 'lake_shallows', hour: 8 } });
  const spot = sim.ctx.spot;
  sim.step(makeInput({ yaw: spot.facing, selectSet: 'bottom' }));   // 바닥 세트(1단계 castMax 32m · 찌는 24m)
  sim.step(makeInput({ yaw: spot.facing, primary: true, primaryPressed: true }));
  assert.equal(sim.state.rig.phase, 'charging');
  let sawClear = false;
  let sawSnag = false;
  for (let i = 0; i < 240 && !(sawClear && sawSnag); i++) {
    sim.step(makeInput({ yaw: spot.facing, primary: true }));
    ui.update(sim.state, 1 / 60);
    const d = sim.state.rig.aimPreview.distM;
    const snag = d >= spot.snag.fromM;
    const cls = ui.hud.castText.classList.contains('is-snag');
    assert.equal(cls, snag, `거리 ${d.toFixed(2)}m · 띠 ${spot.snag.fromM}m`);
    assert.equal(ui.hud.castText.textContent.includes('장애물 띠'), snag);
    if (snag) sawSnag = true; else sawClear = true;
  }
  assert.ok(sawClear && sawSnag, '띠 밖 · 안을 둘 다 지났다(1단계 바닥 세트 castMax 가 얕은 연안 띠 26m 를 넘는다)');
});

test('랜딩(뜰채로 뜨는 중)에는 예고 칩을 숨긴다 — fight 가 멈춰 마지막 예고가 남아도 「드랙을 풀어라」를 보이지 않는다(최종 게이트)', () => {
  const { sim, ui } = makeUi({ start: { spotId: 'lake_gravel', hour: 8 } });
  markSeen(sim, HINT_IDS);
  sim.debugForceFight('carp', 0.5);
  const s = sim.state;
  s.fight.telegraph = { kind: 'run', remaining: 0.4, total: 0.6 };
  ui.update(s, 0.1);
  assert.equal(ui.hud.tele.hidden, false, '파이팅 중에는 보인다');
  s.rig.phase = 'landing';
  ui.update(s, 0.1);
  assert.equal(ui.hud.tele.hidden, true, '랜딩 중에는 숨긴다');
});

test('강 첫 낚시: 「강의 흐름」 안내가 뜨고(드랙을 라인의 절반쯤) · 호수에서는 뜨지 않고 · 낚시를 벗어나면 내린다(Jay 결정 2026-10-03)', () => {
  const seenAllBut = (/** @type {string} */ keep) => (/** @type {string} */ id) => id !== keep;
  /** @param {string} scene @param {string} phase */
  const st = (scene, phase) => ({
    scene,
    player: { mode: 'fish', spotId: scene === 'river' ? 'river_trench' : 'lake_gravel' },
    rig: { phase, set: 'bottom' },
    fight: null,
    profile: { hold: [] },
  });
  for (const ph of ['ready', 'charging', 'waiting']) assert.equal(hintCandidate(st('river', ph), seenAllBut('riverDrag')), 'riverDrag', ph);
  assert.equal(hintCandidate(st('lake', 'ready'), seenAllBut('riverDrag')), '');
  assert.equal(hintCandidate(st('river', 'ready'), () => true), '');
  assert.equal(hintStale('riverDrag', { ...st('river', 'ready'), player: { mode: 'walk' } }), true);
  assert.equal(hintStale('riverDrag', st('river', 'waiting')), false);
  assert.ok(HINT_IDS.includes('riverDrag'));
  assert.ok(t('hint.riverDrag.body').includes('절반'));
});
