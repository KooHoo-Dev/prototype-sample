// OWNER: P9 — 계약 §12.2 · §11.6 · §11.2 · §3.11
// 저장소(가짜 localStorage) — 시험 쓰기 · 설정 정화 · 백업(키마다 3) · 계정/캐릭터 왕복 · 깨진 계정 → 백업 · rebuildAccount · 깨진 캐릭터 → 백업 · 칸 비움 ·
// 미래 버전은 덮어쓰지 않는다 · 쓰기 실패는 false(throw 0) · 저장 시점 묶기(1초 · 바로 쓰는 reason · 캐릭터 = 계정 함께 · 강제) · 설정 디바운스(가짜 타이머)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BAG_SIZE, SAVE_KEYS, SAVE_VERSION, STASH_SIZE } from '../src/core/constants.js';
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA } from '../src/data/settings.js';
import { createCharacter } from '../src/sim/progression/character.js';
import { makeItem } from '../src/sim/loot/rollItem.js';
import { dedupeItemIds } from '../src/sim/progression/save.js';
import { createGameState } from '../src/sim/state.js';
import {
  BACKUPS_PER_KEY, CHAR_SAVE_GAP_MS, IMMEDIATE_REASONS, SETTINGS_DEBOUNCE_MS, charKey, createDebouncer, createSaveScheduler, createStorage, sanitizeSettings,
} from '../src/app/storage.js';

class FakeLS {
  /** @param {{quota?:number, blocked?:boolean}} [o] */
  constructor({ quota = Infinity, blocked = false } = {}) {
    /** @type {Map<string, string>} */
    this.m = new Map();
    this.quota = quota;
    this.blocked = blocked;
    this.writes = 0;
  }
  get length() { return this.m.size; }
  key(i) { return [...this.m.keys()][i] ?? null; }
  _check() { if (this.blocked) throw new Error('SecurityError'); }
  getItem(k) { this._check(); return this.m.has(k) ? /** @type {string} */ (this.m.get(k)) : null; }
  setItem(k, v) {
    this._check();
    let size = 0;
    for (const [kk, vv] of this.m) if (kk !== k) size += kk.length + vv.length;
    if (size + k.length + String(v).length > this.quota) throw new Error('QuotaExceededError');
    this.writes++;
    this.m.set(k, String(v));
  }
  removeItem(k) { this._check(); this.m.delete(k); }
}

let clock = 1_700_000_000_000;
const now = () => clock;
const newIdOf = (state) => () => 'i' + state.account.nextItemId++;

/** 캐릭터가 붙은 상태(sim 없이 — 저장소 왕복만 본다) @param {number} slot @param {'warrior'|'mage'} cls */
function stateWithChar(slot = 0, cls = 'warrior', state = createGameState({ seed: 3 })) {
  const char = createCharacter({ slot, cls, name: 'T' + slot, newId: newIdOf(state), seed: 5 + slot });
  state.char = char;
  state.account.chars[slot] = { name: char.name, cls, level: char.level, riftUnlocked: char.riftUnlocked };
  state.account.lastSlot = slot;
  return state;
}

test('app.storage: available() — 쓰기 · 지우기 시험(막혀 있으면 false · throw 0)', () => {
  assert.equal(createStorage({ ls: new FakeLS(), now }).available(), true);
  assert.equal(createStorage({ ls: new FakeLS({ blocked: true }), now }).available(), false);
  assert.equal(createStorage({ ls: null, now }).available(), false);
  const ls = new FakeLS();
  createStorage({ ls, now }).available();
  assert.equal(ls.length, 0, '시험 키를 남기지 않는다');
});

test('app.storage: 설정 정화(SETTINGS_SCHEMA) — clamp · bool · enum · 모르는 키 · 타입이 다른 값 버림', () => {
  const s = sanitizeSettings({ volMaster: 3, volSfx: -1, volAmbient: 0.25, quality: 'ultra', damageNumbers: 'yes', alwaysLabels: true, hacker: 1, meterHud: false });
  assert.deepEqual(s, { volMaster: 1, volSfx: 0, volAmbient: 0.25, alwaysLabels: true, meterHud: false });
  assert.deepEqual(sanitizeSettings({ quality: 'high', volMaster: NaN }), { quality: 'high' });
  for (const bad of [null, undefined, 3, 'x', [1, 2]]) assert.deepEqual(sanitizeSettings(bad), {});
  assert.deepEqual(sanitizeSettings(DEFAULT_SETTINGS), DEFAULT_SETTINGS, '기본값은 그대로 통과');
  assert.deepEqual(Object.keys(SETTINGS_SCHEMA).sort(), Object.keys(DEFAULT_SETTINGS).sort());
});

test('app.storage: 설정 왕복 · 깨진 설정 → {} · 저장소가 막혀 있으면 쓰기 false', () => {
  const ls = new FakeLS();
  const st = createStorage({ ls, now });
  assert.deepEqual(st.loadSettings(), {});
  assert.equal(st.writeSettings({ ...DEFAULT_SETTINGS, quality: 'low', volMaster: 0.3 }), true);
  assert.deepEqual(st.loadSettings(), { ...DEFAULT_SETTINGS, quality: 'low', volMaster: 0.3 });
  ls.m.set(SAVE_KEYS.settings, '{not json');
  assert.deepEqual(st.loadSettings(), {});
  ls.m.set(SAVE_KEYS.settings, JSON.stringify({ quality: 'ultra', volSfx: 0.5 }));
  assert.deepEqual(st.loadSettings(), { volSfx: 0.5 });
  const blocked = createStorage({ ls: new FakeLS({ blocked: true }), now });
  assert.deepEqual(blocked.loadSettings(), {});
  assert.equal(blocked.writeSettings(DEFAULT_SETTINGS), false);
});

test('app.storage: 백업 — backupPrefix + 원래 키 + ":" + ms · 키마다 최신 3개 · 목록 backupPrefix + "index"', () => {
  const ls = new FakeLS();
  const st = createStorage({ ls, now });
  assert.equal(st.backup(charKey(0)), null, '원본이 없으면 만들지 않는다');
  ls.m.set(charKey(0), 'v0');
  ls.m.set(SAVE_KEYS.account, 'acc');
  const made = [];
  for (let i = 0; i < 5; i++) {
    ls.m.set(charKey(0), 'v' + i);
    clock += 10;
    made.push(st.backup(charKey(0)));
  }
  st.backup(SAVE_KEYS.account);
  assert.equal(made[0], SAVE_KEYS.backupPrefix + charKey(0) + ':' + (clock - 40));
  const mine = st.backupsOf(charKey(0));
  assert.equal(mine.length, BACKUPS_PER_KEY);
  assert.deepEqual(mine, made.slice(-3), '오래된 것부터 지운다');
  assert.equal(ls.getItem(made[0]), null);
  assert.equal(ls.getItem(made[4]), 'v4');
  assert.equal(st.backupsOf(SAVE_KEYS.account).length, 1, '다른 키는 따로 센다');
  const index = JSON.parse(/** @type {string} */ (ls.getItem(SAVE_KEYS.backupPrefix + 'index')));
  assert.equal(index.length, 4);
  // 같은 ms 에 두 번 — 키가 겹치지 않는다
  const a = st.backup(SAVE_KEYS.account);
  const b = st.backup(SAVE_KEYS.account);
  assert.notEqual(a, b);
  // 목록이 깨져도 저장소를 훑어 다시 센다
  ls.m.set(SAVE_KEYS.backupPrefix + 'index', '{{');
  assert.equal(st.backupsOf(charKey(0)).length, BACKUPS_PER_KEY);
});

test('app.storage: 계정 + 캐릭터 왕복(재고 포함) · 계정 요약 · hasChar 는 저장소 키로', () => {
  const ls = new FakeLS();
  const st = createStorage({ ls, now });
  const state = stateWithChar(1, 'mage');
  state.char.gold = 1234;
  state.char.shop.blacksmith = [makeItem({ baseId: state.char.equip.mainHand.baseId, tier: 0, ilvl: 1, rarity: 'magic', id: 'i900' })];
  assert.equal(st.writeChar(state.char), true);
  assert.equal(st.writeAccount(state), true);
  const raw = JSON.parse(/** @type {string} */ (ls.getItem(charKey(1))));
  assert.equal(raw.v, SAVE_VERSION);
  assert.equal(raw.savedAt, clock, 'savedAt 은 app 이 쓴다');
  assert.equal(st.hasChar(1), true);
  assert.equal(st.hasChar(0), false);
  const acc = st.loadAccount();
  assert.equal(acc.broken, false);
  assert.equal(acc.rebuilt, false);
  assert.equal(acc.account.chars[1].name, 'T1');
  assert.equal(acc.account.lastSlot, 1);
  const r = st.loadChar(1);
  assert.equal(r.broken, false);
  assert.equal(r.char.gold, 1234);
  assert.equal(r.char.cls, 'mage');
  assert.equal(r.char.shop.blacksmith.length, 1, '재고도 저장된다(새로 고침으로 바뀌지 않게)');
  assert.equal(st.loadChar(2).char, null, '빈 칸');
  assert.equal(st.loadChar(2).broken, false);
});

test('app.storage: 깨진 계정 → 백업 → rebuildAccount(칸 0..3 의 캐릭터 세이브) — 요약 복원 · ID 충돌 0 · 계정을 다시 쓴다', () => {
  const ls = new FakeLS();
  const st = createStorage({ ls, now });
  const s0 = stateWithChar(0, 'warrior');
  const s2 = stateWithChar(2, 'mage', createGameState({ seed: 4 }));    // 다른 계정에서 만든 것처럼 — 아이템 ID 가 겹친다
  st.writeChar(s0.char);
  st.writeChar(s2.char);
  ls.m.set(SAVE_KEYS.account, '{"v":1,"game":"rift-hunter","chars":');  // 깨진 JSON
  const r = st.loadAccount();
  assert.equal(r.broken, true);
  assert.equal(r.rebuilt, true);
  assert.equal(st.backupsOf(SAVE_KEYS.account).length, 1, '깨진 계정을 백업했다');
  assert.equal(r.account.chars[0].name, 'T0');
  assert.equal(r.account.chars[2].name, 'T2');
  assert.equal(r.account.chars[1], null);
  // 다시 쓴 계정 · 캐릭터를 다시 읽으면 깨지지 않고 ID 가 유일하다
  const again = st.loadAccount();
  assert.equal(again.broken, false);
  const c0 = st.loadChar(0).char;
  const c2 = st.loadChar(2).char;
  const ids = new Set();
  let n = 0;
  for (const c of [c0, c2]) for (const it of Object.values(c.equip)) if (it) { ids.add(it.id); n++; }
  assert.equal(ids.size, n, '캐릭터 사이 ID 겹침 0(다시 쓴 캐릭터)');
  const maxNum = Math.max(...[...ids].map((id) => Number(id.slice(1))));
  assert.ok(again.account.nextItemId > maxNum, 'nextItemId = 최대 + 1 이상');
});

test('app.storage: 계정 키가 없는데 캐릭터 세이브가 있으면 말없이 다시 세운다(broken 아님 · 백업 없음)', () => {
  const ls = new FakeLS();
  const st = createStorage({ ls, now });
  st.writeChar(stateWithChar(3, 'warrior').char);
  const r = st.loadAccount();
  assert.equal(r.broken, false);
  assert.equal(r.rebuilt, true);
  assert.equal(r.account.chars[3].name, 'T3');
  assert.equal(st.backupsOf(SAVE_KEYS.account).length, 0);
  assert.ok(ls.getItem(SAVE_KEYS.account), '계정을 썼다');
  // 아무것도 없으면 새 계정 · 쓰지 않는다
  const empty = new FakeLS();
  const r2 = createStorage({ ls: empty, now }).loadAccount();
  assert.deepEqual([r2.broken, r2.rebuilt, empty.writes], [false, false, 0]);
});

test('app.storage: 계정 요약이 빈 칸에 캐릭터 세이브가 있으면 요약을 채운다(새 캐릭터 덮어쓰기 확인이 요약을 본다)', () => {
  const ls = new FakeLS();
  const st = createStorage({ ls, now });
  const s = stateWithChar(0);
  st.writeChar(s.char);
  s.account.chars[0] = null;
  st.writeAccount(/** @type {any} */ ({ account: s.account, char: null }));
  const r = st.loadAccount();
  assert.equal(r.account.chars[0].name, 'T0');
});

test('app.storage: 미래 버전 계정은 덮어쓰지 않는다(future · 읽기만)', () => {
  const ls = new FakeLS();
  const st = createStorage({ ls, now });
  const raw = JSON.stringify({ v: SAVE_VERSION + 5, game: 'rift-hunter', savedAt: 1, chars: [null, null, null, null], stash: [], nextItemId: 7, lastSlot: -1 });
  ls.m.set(SAVE_KEYS.account, raw);
  st.writeChar(stateWithChar(0).char);
  const writes = ls.writes;
  const r = st.loadAccount();
  assert.equal(r.future, true);
  assert.equal(ls.getItem(SAVE_KEYS.account), raw, '그대로');
  assert.equal(ls.writes, writes, '아무것도 쓰지 않았다');
});

test('app.storage: 깨진 캐릭터 → 백업 → 그 칸 비움(키 삭제) · removeChar 는 백업 뒤 지운다', () => {
  const ls = new FakeLS();
  const st = createStorage({ ls, now });
  ls.m.set(charKey(1), '}}garbage');
  const r = st.loadChar(1);
  assert.equal(r.broken, true);
  assert.equal(r.char, null);
  assert.equal(st.hasChar(1), false, '칸 비움');
  assert.equal(ls.getItem(st.backupsOf(charKey(1))[0]), '}}garbage', '백업은 원본 그대로');
  st.writeChar(stateWithChar(2).char);
  assert.equal(st.removeChar(2), true);
  assert.equal(st.hasChar(2), false);
  assert.equal(st.backupsOf(charKey(2)).length, 1);
  assert.equal(st.removeChar(3), true, '없는 칸은 그대로 성공');
});

test('app.storage: 쓰기 실패(용량 · 막힘)는 false — throw 0', () => {
  const st = createStorage({ ls: new FakeLS({ quota: 50 }), now });
  const s = stateWithChar(0);
  assert.equal(st.writeChar(s.char), false);
  assert.equal(st.writeAccount(s), false);
  assert.equal(st.writeChar(/** @type {any} */ ({ slot: 9 })), false, '없는 칸');
  const b = createStorage({ ls: new FakeLS({ blocked: true }), now });
  assert.equal(b.writeChar(s.char), false);
  assert.equal(b.loadChar(0).char, null);
  assert.equal(b.loadAccount().broken, false);
  assert.equal(b.backup(charKey(0)), null);
});

test('app.storage: 드랍 100개 → 캐릭터 저장(계정 함께) → 다시 읽기 → 새 아이템 ID 가 가방 · 보관함과 겹치지 않는다', () => {
  const ls = new FakeLS();
  const st = createStorage({ ls, now });
  const state = stateWithChar(0);
  const newId = newIdOf(state);
  const base = state.char.equip.chest.baseId;
  // 피드백 2 D4: 가방 30칸 — 가방 + 보관함(60)에 다 들어가는 만큼(최대 100)
  const N = Math.min(100, BAG_SIZE + STASH_SIZE);
  for (let i = 0; i < N; i++) {
    const it = makeItem({ baseId: base, tier: 0, ilvl: 1, rarity: 'normal', id: newId() });
    if (i < BAG_SIZE) state.char.bag[i] = it;
    else state.account.stash[i - BAG_SIZE] = it;
  }
  const sch = createSaveScheduler();
  sch.request('char', 'pickup');
  const plan = sch.take(clock, { hasChar: true });
  assert.deepEqual(plan, { char: true, account: true }, '캐릭터를 쓸 때 계정도 같이');
  st.writeChar(state.char);
  st.writeAccount(state);
  const acc = st.loadAccount().account;
  const ch = st.loadChar(0).char;
  dedupeItemIds(acc, [ch]);
  const have = new Set();
  for (const it of ch.bag) if (it) have.add(it.id);
  for (const it of Object.values(ch.equip)) if (it) have.add(it.id);
  for (const it of acc.stash) if (it) have.add(it.id);
  assert.equal(have.size, N + Object.values(ch.equip).filter(Boolean).length);
  for (let k = 0; k < 20; k++) assert.equal(have.has('i' + (acc.nextItemId + k)), false);
});

test('app.storage: 저장 시점 묶기 — 캐릭터는 1초 간격 · 바로 쓰는 reason · 계정만 · 전부 · 강제(pagehide) · 캐릭터가 없으면 계정으로', () => {
  const s = createSaveScheduler();
  assert.equal(CHAR_SAVE_GAP_MS, 1000);
  for (const r of ['scene', 'death', 'complete', 'collapse', 'new', 'delete', 'quit', 'trade']) assert.ok(IMMEDIATE_REASONS.includes(r), r);
  assert.deepEqual(s.take(0), { char: false, account: false }, '밀린 것 없음');
  s.request('char', 'xp');
  assert.deepEqual(s.take(0), { char: true, account: true });
  s.request('char', 'xp');
  s.request('char', 'pickup');
  assert.deepEqual(s.take(400), { char: false, account: false }, '1초 안에는 묶는다');
  assert.equal(s.pending, true);
  assert.deepEqual(s.take(1000), { char: true, account: true }, '1초가 지나면 한 번');
  s.request('char', 'trade');
  assert.deepEqual(s.take(1001), { char: true, account: true }, 'trade 는 바로(세이브 스컴 틈)');
  s.request('char', 'death');
  assert.deepEqual(s.take(1002), { char: true, account: true });
  s.request('account', 'delete');
  assert.deepEqual(s.take(1003), { char: false, account: true }, '계정만은 묶지 않는다');
  s.request('all', 'stash');
  assert.deepEqual(s.take(1004), { char: false, account: true }, '전부 — 캐릭터는 간격을 지킨다 · 계정은 지금');
  assert.deepEqual(s.take(2005), { char: true, account: true });
  assert.deepEqual(s.take(2006, { force: true }), { char: true, account: true }, '강제 — 밀린 것이 없어도(경험치 · 플레이 시간)');
  assert.deepEqual(s.take(2007, { force: true, hasChar: false }), { char: false, account: false });
  s.request('char', 'quit');
  assert.deepEqual(s.take(2008, { hasChar: false }), { char: false, account: true }, '캐릭터가 없어졌으면 계정');
  s.request('char', 'xp');
  s.markWritten(3000);
  assert.deepEqual(s.take(3001), { char: false, account: false }, '바로 쓴 경로 뒤 밀린 것 없음');
  s.request('char', 'xp');
  s.clear();
  assert.equal(s.pending, false);
});

test('app.storage: 설정 디바운스 — 250ms 안의 여러 번은 마지막 뒤 한 번 · flush 는 밀린 것을 바로(pagehide)', () => {
  assert.equal(SETTINGS_DEBOUNCE_MS, 250);
  /** @type {Array<{f:() => void, at:number, id:number}>} */
  let timers = [];
  let t = 0, id = 0;
  const setTimer = (f, ms) => { timers.push({ f, at: t + ms, id: ++id }); return id; };
  const clearTimer = (h) => { timers = timers.filter((x) => x.id !== h); };
  const advance = (ms) => { t += ms; const due = timers.filter((x) => x.at <= t); timers = timers.filter((x) => x.at > t); for (const x of due) x.f(); };
  let writes = 0;
  const d = createDebouncer(() => writes++, SETTINGS_DEBOUNCE_MS, { setTimer, clearTimer });
  d.schedule();
  advance(100);
  d.schedule();
  advance(100);
  d.schedule();
  advance(249);
  assert.equal(writes, 0);
  advance(1);
  assert.equal(writes, 1);
  d.schedule();
  assert.equal(d.pending, true);
  d.flush();
  assert.equal(writes, 2);
  advance(1000);
  assert.equal(writes, 2, 'flush 뒤 타이머 없음');
  d.flush();
  assert.equal(writes, 2, '밀린 것이 없으면 아무것도');
  d.schedule();
  d.cancel();
  advance(1000);
  assert.equal(writes, 2);
});
