// OWNER: 피드백 2(ui · app 담당) — 브리프 피드백 2 결정 D4 · D5 · D6 · 계약 §10.2 · §10.5 · §5.12
// D6: 스킬 트리(S)는 균열 안에서도 모달 — 게임이 멈춘다 · S 로 닫힌다 · 1~4(칸 배정)는 닫힌 뒤에도 게임 입력으로 새지 않는다.
// D4: 가방 격자는 sim 의 칸 수(BAG_SIZE · BAG_COLS)를 따른다 · 옛 세이브의 넘친 아이템(idx ≥ BAG_SIZE)은 「넘친 칸」 줄 + 넘침 한 줄 · 넘친 칸은 놓는 자리가 아니다.
// D5: 균열 완료 「그중 더 나은 장비」의 문턱 문면은 data 의 측정 문턱(COMPARE.upgradeGain)을 읽는다 — sim 의 rift.stats.upgrades 와 같은 키.
// DOM 이 필요한 조각은 아주 작은 가짜 document 로 만든다(패널 모듈은 import 만으로 DOM 을 건드리지 않는다).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BAG_COLS, BAG_SIZE } from '../src/core/constants.js';
import { EV, EventBus } from '../src/core/events.js';
import { COMPARE } from '../src/data/items.js';
import { KEYBINDS } from '../src/data/keybinds.js';
import { STRINGS } from '../src/data/strings.ko.js';
import { InputCollector } from '../src/app/input.js';
import { stepAllowed, pauseReason } from '../src/app/screens.js';
import { UIRoot } from '../src/ui/UIRoot.js';
import { BAG_GRID, bagFill, upgradeCountGain } from '../src/ui/pnlLogic.js';
import { createBagGrid } from '../src/ui/pnlBagGrid.js';
import { createSkillsPanel } from '../src/ui/panels/skills.js';
import * as widgets from '../src/ui/widgets.js';
import { t } from '../src/ui/i18n.js';

// ───────────────────────── 아주 작은 가짜 DOM ─────────────────────────

class FakeClassList {
  constructor(owner) { this.owner = owner; }
  get set() { return new Set(String(this.owner.className || '').split(/\s+/).filter(Boolean)); }
  write(s) { this.owner.className = [...s].join(' '); }
  add(...c) { const s = this.set; for (const x of c) s.add(x); this.write(s); }
  remove(...c) { const s = this.set; for (const x of c) s.delete(x); this.write(s); }
  contains(c) { return this.set.has(c); }
  toggle(c, on) { const want = on === undefined ? !this.contains(c) : !!on; if (want) this.add(c); else this.remove(c); return want; }
}

class FakeEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.className = '';
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.hidden = false;
    this._text = '';
    this.style = { setProperty() {}, removeProperty() {} };
    this.classList = new FakeClassList(this);
    this.scrollHeight = 0;
    this.clientHeight = 0;
  }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { for (const c of this.children) c.parentElement = null; this.children = []; this._text = String(v ?? ''); }
  get isConnected() { let n = this; while (n.parentElement) n = n.parentElement; return n === ROOT; }
  appendChild(c) { if (c.parentElement) c.remove(); c.parentElement = this; this.children.push(c); return c; }
  after(c) {
    const p = this.parentElement;
    if (!p) return;
    if (c.parentElement) c.remove();
    c.parentElement = p;
    p.children.splice(p.children.indexOf(this) + 1, 0, c);
  }
  remove() { const p = this.parentElement; if (p) { p.children.splice(p.children.indexOf(this), 1); this.parentElement = null; } }
  contains(n) { while (n) { if (n === this) return true; n = n.parentElement; } return false; }
  closest() { return null; }
  querySelector() { return null; }
  addEventListener() {}
  removeEventListener() {}
  setAttribute() {}
  getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
}
const ROOT = new FakeEl('body');
globalThis.document = /** @type {any} */ ({ createElement: (tag) => new FakeEl(tag), body: ROOT });

/** 패널 ctx(가짜 sim) @param {any} sim */
function ctxOf(sim = null) {
  return { root: ROOT, sim, bus: new EventBus(), settings: {}, actions: {}, t, ui: null, widgets };
}

/** 아이템 하나(가방 칸이 그리는 만큼) @param {number} id */
const itemOf = (id) => ({ id: 'i' + id, baseId: 'belt', tier: 1, rarity: 'normal', ilvl: 1, reqLevel: 1, dur: 10, durMax: 10, affixes: [], flags: {} });

// ───────────────────────── D4 — 가방 칸 수 · 넘침 ─────────────────────────

test('피드백 2 D4: 가방 격자 크기는 sim 이 쓰는 값(BAG_SIZE · BAG_COLS) 하나에서 온다(하드코딩 없음)', () => {
  assert.equal(BAG_GRID.size, BAG_SIZE);
  assert.equal(BAG_GRID.cols, Math.min(BAG_SIZE, BAG_COLS));
  assert.equal(BAG_GRID.rows, Math.ceil(BAG_SIZE / BAG_GRID.cols));
  assert.ok(BAG_GRID.cols * BAG_GRID.rows >= BAG_SIZE, '모든 칸이 격자 안');
});

test('피드백 2 D4: bagFill — 든 수 · 넘친 수(idx ≥ 칸 수) · 그릴 칸 수(넘친 줄까지 열 단위)', () => {
  const size = 30;
  const cols = 6;
  const bag = new Array(40).fill(null);
  for (let i = 0; i < 12; i++) bag[i] = itemOf(i);
  let f = bagFill(bag, size, cols);
  assert.deepEqual([f.count, f.over, f.overflow, f.shown], [12, 0, false, 30], '40칸 배열이어도 넘친 칸이 비었으면 30칸만');
  for (let i = 0; i < 38; i++) bag[i] = itemOf(i);
  f = bagFill(bag, size, cols);
  assert.deepEqual([f.count, f.over, f.overflow, f.full, f.shown], [38, 8, true, true, 42], '31~38번째 — 넘친 두 줄(6 × 7 = 42칸)');
  bag[37] = null; bag[36] = null; bag[35] = null;
  f = bagFill(bag, size, cols);
  assert.equal(f.shown, 36, '마지막 넘친 아이템의 줄까지만');
  bag[3] = null; bag[4] = null; bag[5] = null; bag[6] = null; bag[7] = null; bag[8] = null;
  f = bagFill(bag, size, cols);
  assert.deepEqual([f.count, f.over, f.overflow, f.full, f.shown], [29, 5, false, false, 36],
    '패널을 연 채 팔아 칸 안이 비었다(sim settleBag 전) — 넘친 칸은 보이되 「넘쳤다」는 아니다');
  for (let i = 0; i < 9; i++) bag[i] = itemOf(i);
  for (let i = 30; i < 40; i++) bag[i] = null;
  bag[3] = null;
  f = bagFill(bag, size, cols);
  assert.deepEqual([f.count, f.over, f.overflow, f.full, f.shown], [29, 0, false, false, 30]);
  assert.deepEqual(bagFill(null, size, cols), { count: 0, over: 0, last: 0, shown: 30, full: false, overflow: false }, '깨진 상태에서 throw 하지 않는다');
});

test('피드백 2 D4: 가방 격자 — 넘친 아이템이 있으면 넘친 칸 줄(is-over)을 더 그리고 넘침 한 줄 · 머리 「n/칸 수」 · 비우면 다시 줄인다', () => {
  const box = ROOT.appendChild(new FakeEl('div'));
  const head = box.appendChild(new FakeEl('div'));
  /** @type {any[]} */
  const drops = [];
  const grid = createBagGrid(ctxOf({ getStats: () => null }), { head, onDrop: (a, b) => drops.push([a, b]) });
  box.appendChild(grid.el);
  const base = BAG_GRID.cols * BAG_GRID.rows;
  const bag = new Array(BAG_SIZE).fill(null);
  bag[0] = itemOf(0);
  const state = { char: { cls: 'warrior', level: 1, bag, equip: {} } };
  grid.update(state);
  assert.equal(grid.el.children.length, base, '넘침이 없으면 기본 칸만');
  assert.equal(grid.note.parentElement, box, '넘침 줄은 격자 바로 밑에 붙는다');
  assert.equal(grid.note.hidden, true);
  assert.equal(head.textContent, `${STRINGS['panel.inventory.title']}  1/${BAG_SIZE}`);
  // 옛 세이브 — 칸 수 + 7개(보관함도 가득 차 가방에 남았다)
  const old = new Array(BAG_SIZE + 10).fill(null);
  for (let i = 0; i < BAG_SIZE + 7; i++) old[i] = itemOf(100 + i);
  state.char = { ...state.char, bag: old };
  grid.update(state);
  const shown = Math.ceil((BAG_SIZE + 7) / BAG_GRID.cols) * BAG_GRID.cols;
  assert.equal(grid.el.children.length, shown, '넘친 아이템의 줄까지 칸을 더 그린다');
  assert.equal(grid.nav.rows, shown / BAG_GRID.cols, '키보드 이동도 늘어난 줄까지');
  assert.ok(grid.el.children[BAG_SIZE].classList.contains('is-over'), '넘친 칸 표시');
  assert.ok(!grid.el.children[BAG_SIZE - 1].classList.contains('is-over'));
  assert.equal(grid.itemAt(BAG_SIZE + 6)?.id, 'i' + (100 + BAG_SIZE + 6), '넘친 아이템도 고를 수 있다(꺼내기)');
  assert.equal(grid.isOver(BAG_SIZE), true);
  assert.equal(grid.isOver(BAG_SIZE - 1), false);
  assert.equal(grid.note.hidden, false);
  assert.equal(grid.note.textContent, t('inv.overflow', { n: BAG_SIZE + 7, max: BAG_SIZE }));
  assert.ok(!grid.note.textContent.includes('{'), '자리 이름이 다 채워졌다');
  assert.ok(head.classList.contains('is-over'));
  // 키보드: 맨 아래 넘친 줄까지 내려간다
  grid.focus(0);
  for (let i = 0; i < 20; i++) grid.handleKey({ type: 'keydown', code: KEYBINDS.down, repeat: false });
  assert.ok(grid.index >= BAG_SIZE, `아래 끝은 넘친 줄(${grid.index})`);
  // 정리 — 넘친 것을 다 꺼내면 기본 칸으로 돌아간다 · 포커스는 남은 칸 안
  const tidy = old.slice();
  for (let i = BAG_SIZE; i < tidy.length; i++) tidy[i] = null;
  tidy[0] = null;
  state.char = { ...state.char, bag: tidy };
  grid.update(state);
  assert.equal(grid.el.children.length, base);
  assert.ok(grid.index < base, '포커스가 사라진 칸에 남지 않는다');
  assert.equal(grid.note.hidden, true);
  assert.equal(head.textContent, `${STRINGS['panel.inventory.title']}  ${BAG_SIZE - 1}/${BAG_SIZE}`);
  box.remove();
});

test('피드백 2 D4: 넘침 문면 키가 하나 있다(격자 줄 · 줍기 실패 알림 · 캐릭터를 읽었을 때 — inv.overflow 한 키)', () => {
  const k = 'inv.overflow';
  assert.equal(typeof STRINGS[k], 'string', k);
  assert.match(STRINGS[k], /\{n\}/);
  assert.match(STRINGS[k], /\{max\}/);
  assert.equal(STRINGS['notice.bagOverflow'], undefined, '같은 뜻의 두 번째 키를 두지 않는다');
});

// ───────────────────────── D5 — 완료 패널 문턱 ─────────────────────────

test('피드백 2 D5: 「그중 더 나은 장비」의 문턱은 data 의 측정 문턱(COMPARE.upgradeGain 3% · 화살표의 minGain 과 다르다)', () => {
  assert.equal(upgradeCountGain(), COMPARE.upgradeGain);
  assert.equal(COMPARE.upgradeGain, 0.03);
  assert.ok(COMPARE.minGain < COMPARE.upgradeGain);
  assert.match(STRINGS['complete.upgradesNote'], /\{pct\}/);
  assert.equal(typeof STRINGS['complete.upgrades'], 'string');
});

// ───────────────────────── D6 — 스킬 트리 모달 ─────────────────────────

test('피드백 2 D6: 스킬 트리 패널은 모달이고 1~4(칸 배정)를 자기 키로 쓴다', () => {
  const p = createSkillsPanel(ctxOf({ state: { char: null } }));
  assert.equal(p.modal, true, '균열에서도 게임이 멈춘다(§5.12)');
  for (const k of KEYBINDS.skill) assert.ok(p.keys.includes(k), k);
  p.dispose();
});

test('피드백 2 D6: 모달이 열리면 균열에서도 step 하지 않는다 · 일시정지 사유 modal · 봇이 켜져 있으면 막지 않는다', () => {
  const c = { screen: 'play', hasChar: true, fading: false, hitstop: false, hidden: false, blurred: false, contextLost: false, debugPaused: false,
    modal: true, anyOpen: true, top: 'skills', scene: 'rift', bot: false };
  assert.equal(stepAllowed(/** @type {any} */ (c)), false);
  assert.equal(pauseReason(/** @type {any} */ (c)), 'modal');
  assert.equal(stepAllowed(/** @type {any} */ ({ ...c, bot: true })), true, '봇은 사람이 연 일시정지 · 분석만 멈춘다(§11.13)');
  assert.equal(stepAllowed(/** @type {any} */ ({ ...c, modal: false, anyOpen: false, top: null })), true, '닫으면 다시 돈다');
});

test('피드백 2 D6: UIRoot — 맨 위 모달이 스킬 트리면 S 로 닫힌다 · ownsKey 는 맨 위 모달의 자기 키만', () => {
  /** @type {any[]} */
  const closed = [];
  const skills = { id: 'skills', modal: true, keys: [...KEYBINDS.skill, KEYBINDS.skills], el: new FakeEl('section'), handleKey: (e) => KEYBINDS.skill.includes(e.code) };
  const fake = /** @type {any} */ ({
    stack: [skills], sim: null,
    closePanel(id, by) { closed.push([id, by]); this.stack.pop(); return true; },
  });
  const ui = /** @type {any} */ (UIRoot.prototype);
  assert.equal(ui.ownsKey.call(fake, KEYBINDS.skill[0]), true);
  assert.equal(ui.ownsKey.call(fake, 'ShiftLeft'), false);
  assert.equal(ui.handleKey.call(fake, { type: 'keydown', code: KEYBINDS.skill[0], repeat: false }), true, '1 = 칸 배정(패널이 먹는다)');
  assert.equal(closed.length, 0);
  assert.equal(ui.handleKey.call(fake, { type: 'keydown', code: KEYBINDS.skills, repeat: false }), true);
  assert.deepEqual(closed, [[null, 'key']], 'S 로 닫힌다');
  // 비모달(인벤토리)이면 ownsKey 는 false — 겹쳐 보는 패널의 키는 따로 captured
  fake.stack = [{ id: 'inventory', modal: false, keys: ['KeyZ'] }];
  assert.equal(ui.ownsKey.call(fake, 'KeyZ'), false);
  fake.stack = [];
  assert.equal(ui.ownsKey.call(fake, 'Digit1'), false);
});

test('피드백 2 D6: 모달 스킬 트리에서 누른 1(칸 배정)은 닫힌 뒤에도 게임 입력으로 새지 않는다 · 다른 모달이 먹은 스킬 키는 눌림으로 남는다', () => {
  const bus = new EventBus();
  const ui = {
    modal: true, owns: true, isModal() { return this.modal; }, ownsKey() { return this.owns; },
    anyOpen: () => true, topPanel: () => 'skills', handleKey() { return this.modal; }, blocksPointer: () => false, labelHover: () => null, setLabels() {},
  };
  const rc = { groundAt: () => ({ x: 1, z: 1 }), rayFromScreen: () => ({ ox: 0, oy: 10, oz: 0, dx: 0, dy: -1, dz: 0 }) };
  const inp = new InputCollector({ canvas: null, bus, ui, rc, keybinds: KEYBINDS, settings: /** @type {any} */ ({}), win: null, doc: null, pick: () => null });
  const k = (type, code) => ({ type, code, repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, target: null, preventDefault() {} });
  inp.handleKeyDown(k('keydown', KEYBINDS.skill[0]));
  ui.modal = false;                                       // 1 을 누른 채 S 로 닫았다
  bus.emit(EV.PANEL_CLOSED, { panel: 'skills', depth: 0, by: 'key' });
  inp.frame(/** @type {any} */ ({}), null);
  const f = inp.frame(/** @type {any} */ ({}), null);
  assert.equal(f.slot[1], false, '누르고 있어도 스킬 칸 1이 「눌림」이 아니다');
  assert.equal(f.slotDown[1], false);
  inp.handleKeyUp(k('keyup', KEYBINDS.skill[0]));
  inp.handleKeyDown(k('keydown', KEYBINDS.skill[0]));
  assert.equal(inp.frame(/** @type {any} */ ({}), null).slotDown[1], true, '떼고 다시 누르면 게임 입력');
  inp.handleKeyUp(k('keyup', KEYBINDS.skill[0]));
  // 자기 키가 아닌 모달(사망 · 확인 …)이 먹은 스킬 키는 그대로 눌림(QUALITY §1 — 기존 규칙)
  ui.modal = true;
  ui.owns = false;
  inp.handleKeyDown(k('keydown', KEYBINDS.skill[1]));
  ui.modal = false;
  bus.emit(EV.PANEL_CLOSED, { panel: 'death', depth: 0, by: 'key' });
  inp.frame(/** @type {any} */ ({}), null);
  assert.equal(inp.frame(/** @type {any} */ ({}), null).slot[2], true);
  inp.dispose();
});
