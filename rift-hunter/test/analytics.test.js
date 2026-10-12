// OWNER: P12 — 계약 §12.2(analytics) · §10.9
// toJson · toCsv(이스케이프 · 열 순서 · 다시 읽기) · 누적 합 · 히스토그램 · 조각 실행기(가짜 스케줄러 · 가짜 시계로 시간 예산 · 취소) ·
// 스케줄러(MessageChannel · setTimeout 대체) · 이론값(P5 함수와 같은 값 · 불운 보정 정상 분포 = 시뮬) · 표 보기 값 = 데이터 · 계측 HUD 문면.
// DOM 은 쓰지 않는다(탭의 화면은 브라우저 확인 — ?analytics=1).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ITEM_SLOTS, RARITIES } from '../src/core/constants.js';
import { BLP } from '../src/data/drops.js';
import { PRICES } from '../src/data/economy.js';
import { ITEM_AFFIXES } from '../src/data/itemAffixes.js';
import { MON_AFFIXES } from '../src/data/monsterAffixes.js';
import { MONSTERS } from '../src/data/monsters.js';
import { GROWTH, RIFT_LEVELS, earlyDmgMul, earlyHpMul } from '../src/data/rift.js';
import { SKILL_NODES } from '../src/data/skills.js';
import { createGameState } from '../src/sim/state.js';
import { createDropSim } from '../src/sim/loot/simulate.js';
import { rarityDist, slotDist, tcDist } from '../src/sim/loot/theory.js';
import { CSV_COLUMNS, csvCell, sumRecords, toCsv, toJson } from '../src/ui/analytics/exporters.js';
import {
  SIM_RANKS, compareShare, createChunkRunner, createScheduler, dropTheory, histogram, keyLabel,
} from '../src/ui/analytics/dropSimTab.js';
import { TABLE_IDS, buildTable, rawText, sortOrder } from '../src/ui/analytics/tablesTab.js';
import { meterTexts } from '../src/ui/analytics/meterHud.js';
import { recordFileName } from '../src/ui/analytics/sessionTab.js';
import { meterView } from '../src/sim/meter.js';

// ───────────────────────── 도우미 ─────────────────────────

/** RunRecord 하나(§3.9) @param {Partial<Record<string, any>>} [o] */
function record(o = {}) {
  return {
    level: 3, seed: 123456789, tileset: 'crypt', cls: 'warrior', result: 'complete', timeSec: 372.5,
    kills: { normal: 210, champion: 9, elite: 4, minion: 14, guardian: 1, other: 3 }, deaths: 1,
    drops: { normal: 22, magic: 15, rare: 4, legendary: 0, set: 0 }, gold: 812, xp: 15890, upgrades: 2,
    recalls: 1, maxTargeting: 27, swarmMoments: 3, unlockedTo: 4, noDeath: false, record: true,
    at: 1834.2, charLevel: 7,
    ...o,
  };
}

/** RFC 4180 CSV 읽기(검사용 — 따옴표 · 두 번 쓴 따옴표 · 칸 안 줄바꿈 · CRLF) @param {string} text @returns {string[][]} */
function parseCsv(text) {
  /** @type {string[][]} */
  const rows = [];
  let row = [], cell = '', i = 0, quoted = false;
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      cell += c; i++; continue;
    }
    if (c === '"') { quoted = true; i++; continue; }
    if (c === ',') { row.push(cell); cell = ''; i++; continue; }
    if (c === '\r' && text[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i += 2; continue; }
    if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
    cell += c; i++;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** CSV 한 줄 → 기록(점 이름을 다시 접고 · 수 · 참/거짓을 되돌린다) @param {string[]} cols @param {string[]} cells */
function unflatten(cols, cells) {
  /** @type {Record<string, any>} */
  const out = {};
  cols.forEach((c, i) => {
    const raw = cells[i];
    if (raw === '') return;
    /** @type {any} */
    let v = raw;
    if (raw === 'true') v = true;
    else if (raw === 'false') v = false;
    else if (/^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(raw)) v = Number(raw);
    const dot = c.indexOf('.');
    if (dot > 0) {
      const a = c.slice(0, dot), b = c.slice(dot + 1);
      (out[a] ??= {})[b] = v;
    } else out[c] = v;
  });
  return out;
}

/** 가짜 시계 + 가짜 스케줄러 */
function fakeEnv() {
  const env = {
    t: 0,
    /** @type {Array<() => void>} */
    queue: [],
    now: () => env.t,
    /** @param {() => void} fn */
    schedule: (fn) => { env.queue.push(fn); },
    /** 대기열을 비울 때까지(상한) @param {number} [max] */
    pump(max = 100000) {
      let n = 0;
      while (env.queue.length && n++ < max) env.queue.shift()();
      return n;
    },
  };
  return env;
}

// ───────────────────────── 내보내기 ─────────────────────────

test('toJson — 받은 기록 그대로(다시 읽으면 같다) · 배열이 아니면 [] · 기록이 아닌 칸은 뺀다', () => {
  const recs = [record(), record({ result: 'collapse', level: 5, noDeath: false, drops: { normal: 1, magic: 0, rare: 0, legendary: 1, set: 0 } })];
  assert.deepEqual(JSON.parse(toJson(recs)), recs);
  assert.equal(toJson(/** @type {any} */ (null)), '[]');
  assert.equal(toJson(/** @type {any} */ ({ a: 1 })), '[]');
  assert.deepEqual(JSON.parse(toJson(/** @type {any} */ ([record(), 3, null, 'x']))), [record()]);
});

test('toCsv — 머리줄은 고정 열 순서 · 중첩(kills · drops)은 점으로 편다 · 기록마다 한 줄 · CRLF', () => {
  const recs = [record(), record({ level: 4, result: 'abandon' })];
  const csv = toCsv(recs);
  assert.ok(csv.endsWith('\r\n'));
  assert.ok(!/[^\r]\n/.test(csv), '줄바꿈은 모두 CRLF');
  const rows = parseCsv(csv);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], [...CSV_COLUMNS]);
  assert.ok(CSV_COLUMNS.indexOf('kills.normal') > CSV_COLUMNS.indexOf('timeSec'));
  assert.equal(rows[1][CSV_COLUMNS.indexOf('kills.champion')], '9');
  assert.equal(rows[1][CSV_COLUMNS.indexOf('drops.rare')], '4');
  assert.equal(rows[2][CSV_COLUMNS.indexOf('result')], 'abandon');
  assert.equal(rows[1][CSV_COLUMNS.indexOf('noDeath')], 'false');
  assert.equal(rows[1][CSV_COLUMNS.indexOf('timeSec')], '372.5');
  // 기록이 없으면 머리줄만
  assert.equal(toCsv([]), CSV_COLUMNS.join(',') + '\r\n');
  assert.equal(toCsv(/** @type {any} */ (undefined)), CSV_COLUMNS.join(',') + '\r\n');
});

test('toCsv — 그대로 다시 읽힌다(값 · 열 순서 · 쉼표 · 따옴표 · 줄바꿈 이스케이프 · 계약 밖 필드는 뒤에 덧붙음)', () => {
  const tricky = record({ note: 'a, "b"\r\nc', tags: ['x', 'y,z'], tileset: 'cavern', seed: 4294967295, gold: 0, timeSec: 0.1 + 0.2 });
  const recs = [record(), tricky, record({ result: 'collapse', deaths: 4, record: false, extra: 'only here' })];
  const rows = parseCsv(toCsv(recs));
  const cols = rows[0];
  // 고정 열 다음에 처음 본 순서로 note · tags · extra
  assert.deepEqual(cols.slice(0, CSV_COLUMNS.length), [...CSV_COLUMNS]);
  assert.deepEqual(cols.slice(CSV_COLUMNS.length), ['note', 'tags', 'extra']);
  const back = rows.slice(1).map((r) => unflatten(cols, r));
  assert.equal(back.length, 3);
  // 쉼표 · 따옴표 · CRLF 가 든 문자열이 그대로
  assert.equal(back[1].note, 'a, "b"\r\nc');
  // 배열은 JSON 한 칸
  assert.deepEqual(JSON.parse(back[1].tags), ['x', 'y,z']);
  // 수(소수 끝자리까지) · 0 · 큰 정수
  assert.equal(back[1].timeSec, 0.1 + 0.2);
  assert.equal(back[1].gold, 0);
  assert.equal(back[1].seed, 4294967295);
  // 계약 필드 전부가 원래 값과 같다
  for (let i = 0; i < recs.length; i++) {
    const want = /** @type {Record<string, any>} */ ({ ...recs[i] });
    delete want.note; delete want.tags; delete want.extra;
    const got = { ...back[i] };
    delete got.note; delete got.tags; delete got.extra;
    assert.deepEqual(got, want, `기록 ${i}`);
  }
  assert.equal(back[2].extra, 'only here');
  assert.equal(back[0].extra, undefined);
});

test('csvCell — 이스케이프 · NaN/Infinity/null 은 빈 칸 · 참/거짓 · 객체는 JSON', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('line\nbreak'), '"line\nbreak"');
  assert.equal(csvCell('cr\rx'), '"cr\rx"');
  assert.equal(csvCell(NaN), '');
  assert.equal(csvCell(Infinity), '');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(undefined), '');
  assert.equal(csvCell(-1.5), '-1.5');
  assert.equal(csvCell(true), 'true');
  assert.equal(csvCell({ a: 1, b: 'x' }), '"{""a"":1,""b"":""x""}"');
});

test('sumRecords — 판 수 · 시간 · 처치 · 드랍 · 결과별 합(누적 줄)', () => {
  const s = sumRecords([record(), record({ result: 'collapse', timeSec: 100, deaths: 3, gold: 10 }), /** @type {any} */ ({ bogus: true })]);
  assert.equal(s.runs, 3);
  assert.equal(s.timeSec, 472.5);
  assert.equal(s.deaths, 4);
  assert.equal(s.gold, 822);
  assert.equal(s.kills.normal, 420);
  assert.equal(s.drops.rare, 8);
  assert.deepEqual(s.results, { complete: 1, collapse: 1, abandon: 0 });
  assert.equal(sumRecords(/** @type {any} */ (null)).runs, 0);
});

test('recordFileName — 클래스 · 칸 · 확장자', () => {
  assert.equal(recordFileName({ cls: 'mage', slot: 2 }, 'csv'), 'rift-hunter-mage-2-records.csv');
  assert.equal(recordFileName(null, 'json'), 'rift-hunter-char-0-records.json');
});

// ───────────────────────── 히스토그램 ─────────────────────────

test('histogram — 정수 너비 막대 · 넘친 값 · 평균 · 중앙값 · 최대 · 가장 큰 막대', () => {
  const h = histogram([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], { bins: 5, max: 10 });
  assert.equal(h.width, 2);
  assert.deepEqual(h.counts, [2, 2, 2, 2, 2]);
  assert.equal(h.over, 0);
  assert.equal(h.mean, 5.5);
  assert.equal(h.median, 5.5);
  assert.equal(h.max, 10);
  assert.equal(h.peak, 2);
  const g = histogram([1, 1, 1, 2, 50], { bins: 4, max: 4 });
  assert.equal(g.width, 1);
  assert.deepEqual(g.counts, [3, 1, 0, 0]);
  assert.equal(g.over, 1);
  assert.equal(g.median, 1);
  // 상한을 주지 않으면 99% 분위수 — 극단값 하나는 넘친 칸으로
  const vals = Array.from({ length: 999 }, (_, i) => (i % 100) + 1).concat([100000]);
  const q = histogram(vals, { bins: 20 });
  assert.equal(q.width, 5);
  assert.equal(q.over, 1);
  assert.equal(q.counts.reduce((a, b) => a + b, 0) + q.over, 1000);
  // 빈 입력 · 유한하지 않은 값은 무시
  const e = histogram([], { bins: 3 });
  assert.equal(e.n, 0);
  assert.deepEqual(e.counts, [0, 0, 0]);
  assert.equal(histogram([NaN, Infinity, -1, 3]).n, 1);
});

// ───────────────────────── 조각 실행기 ─────────────────────────

test('조각 실행기 — 시간 예산(8ms) 안에서 나눠 굴리고 끝까지 · 첫 조각도 스케줄러로 · 진행은 늘기만', () => {
  const env = fakeEnv();
  const COST = 0.013;   // 처치 하나 0.013ms(가짜 시계)
  let ran = 0, calls = 0;
  /** @type {number[]} */
  const progress = [];
  /** @type {number[]} */
  const sliceMs = [];
  /** @type {any} */
  let doneArg = null;
  let doneCount = 0;
  const r = createChunkRunner({
    total: 100000,
    step: (k) => { calls++; ran += k; env.t += k * COST; return k; },
    budgetMs: 8,
    now: env.now,
    schedule: env.schedule,
    onSlice: (done, all, ms) => { progress.push(done); sliceMs.push(ms); assert.equal(all, 100000); },
    onDone: (x) => { doneArg = x; doneCount++; },
  });
  assert.equal(r.start(), true);
  assert.equal(calls, 0, 'start 는 곧장 굴리지 않는다');
  assert.equal(env.queue.length, 1);
  assert.equal(r.start(), false, '두 번 시작하지 않는다');
  env.pump();
  assert.equal(ran, 100000);
  assert.equal(r.done, 100000);
  assert.equal(r.running, false);
  assert.equal(r.finished, true);
  assert.equal(doneCount, 1);
  assert.deepEqual(doneArg, { done: 100000, total: 100000, cancelled: false });
  assert.ok(r.slices >= Math.ceil((100000 * COST) / 8), `조각 수 ${r.slices}`);
  for (const ms of sliceMs) assert.ok(ms <= 8 + 1e-9, `조각 ${ms}ms > 8ms`);
  assert.ok(Math.max(...sliceMs) > 4, '예산을 거의 다 쓴다(조각이 지나치게 잘지 않다)');
  for (let i = 1; i < progress.length; i++) assert.ok(progress[i] > progress[i - 1]);
  assert.equal(progress.at(-1), 100000);
});

test('조각 실행기 — 취소하면 곧바로 onDone(cancelled) · 걸려 있던 조각은 아무것도 하지 않는다 · 다시 시작 못 함', () => {
  const env = fakeEnv();
  let ran = 0;
  /** @type {any[]} */
  const dones = [];
  const r = createChunkRunner({
    total: 50000, step: (k) => { ran += k; env.t += k * 0.02; return k; }, now: env.now, schedule: env.schedule,
    onDone: (x) => dones.push(x),
  });
  r.start();
  env.queue.shift()();
  env.queue.shift()();
  const after2 = ran;
  assert.ok(after2 > 0 && after2 < 50000);
  assert.equal(env.queue.length, 1, '다음 조각이 걸려 있다');
  assert.equal(r.cancel(), true);
  assert.equal(dones.length, 1);
  assert.deepEqual(dones[0], { done: after2, total: 50000, cancelled: true });
  env.pump();
  assert.equal(ran, after2, '취소 뒤에는 굴리지 않는다');
  assert.equal(r.cancelled, true);
  assert.equal(r.cancel(), false);
  assert.equal(r.start(), false);
  assert.equal(dones.length, 1);
});

test('조각 실행기 — 한 묶음이 예산보다 길어도 조각마다 하나는 돈다 · step 이 덜 돌리면 끝 · 0 회는 바로 끝', () => {
  const env = fakeEnv();
  let ran = 0;
  const slow = createChunkRunner({ total: 20, step: (k) => { ran += k; env.t += k * 50; return k; }, now: env.now, schedule: env.schedule, firstBatch: 4 });
  slow.start();
  env.pump();
  assert.equal(ran, 20);
  assert.equal(slow.done, 20);
  assert.ok(slow.slices >= 5, '묶음이 1까지 줄어든다');

  let n = 0;
  /** @type {any} */
  let fin = null;
  const stall = createChunkRunner({ total: 1000, step: (k) => { const g = Math.min(k, 30 - n); n += g; return g; }, now: env.now, schedule: env.schedule, onDone: (x) => { fin = x; } });
  stall.start();
  env.pump();
  assert.equal(stall.done, 30);
  assert.equal(stall.finished, true);
  assert.deepEqual(fin, { done: 30, total: 1000, cancelled: false });

  /** @type {any} */
  let zero = null;
  const z = createChunkRunner({ total: 0, step: () => { throw new Error('굴리면 안 된다'); }, now: env.now, schedule: env.schedule, onDone: (x) => { zero = x; } });
  assert.equal(z.start(), true);
  assert.deepEqual(zero, { done: 0, total: 0, cancelled: false });
});

test('조각 실행기 + createDropSim — 나눠 굴려도 한 번에 굴린 것과 같다(같은 시드)', () => {
  const env = fakeEnv();
  const opts = { rank: 'elite', level: 7, cls: 'mage', mf: 1, blpOn: true, seed: 42 };
  const a = createDropSim(opts);
  const r = createChunkRunner({ total: 3000, step: (k) => { env.t += k * 0.05; return a.run(k); }, now: env.now, schedule: env.schedule });
  r.start();
  env.pump();
  assert.ok(r.slices > 5);
  const b = createDropSim(opts);
  b.run(3000);
  assert.deepEqual(a.result(), b.result());
});

test('스케줄러 — MessageChannel 로 차례대로 돈다 · dispose 가 닫는다 · 없으면 setTimeout 0', async () => {
  const s = createScheduler();
  assert.equal(s.kind, 'message');
  /** @type {number[]} */
  const seen = [];
  await new Promise((resolve) => {
    s.schedule(() => seen.push(1));
    s.schedule(() => seen.push(2));
    s.schedule(() => { seen.push(3); resolve(undefined); });
  });
  assert.deepEqual(seen, [1, 2, 3]);
  s.dispose();
  s.dispose();
  // 대체 경로(가짜 전역)
  /** @type {Array<[Function, number]>} */
  const timers = [];
  const f = createScheduler({ setTimeout: (fn, ms) => { timers.push([fn, ms]); return 1; } });
  assert.equal(f.kind, 'timeout');
  let hit = 0;
  f.schedule(() => hit++);
  assert.equal(timers.length, 1);
  assert.equal(timers[0][1], 0);
  timers[0][0]();
  assert.equal(hit, 1);
});

// ───────────────────────── 이론값 ─────────────────────────

test('이론값(불운 보정 끔) — P5 rarityDist · slotDist 그대로 · 합 1 · 처치당 장비 = picks × gear + 보장', () => {
  for (const rank of SIM_RANKS) {
    for (const [level, mf] of [[1, 0], [12, 1], [30, 6]]) {
      const th = dropTheory({ rank, level, cls: 'warrior', mf, blpOn: false });
      const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
      assert.ok(Math.abs(sum(th.rarity) - 1) < 1e-9, `${rank} ${level} rarity 합`);
      assert.ok(Math.abs(sum(th.slot) - 1) < 1e-9, `${rank} ${level} slot 합`);
      assert.ok(Math.abs(sum(th.affixCount) - 1) < 1e-9, `${rank} ${level} affix 합`);
      assert.ok(Math.abs(th.tiers.reduce((a, b) => a + b, 0) - 1) < 1e-9);
      if (rank !== 'guardian') {
        const rd = rarityDist({ rank, level, mf });
        for (const r of RARITIES) assert.ok(Math.abs(th.rarity[r] - rd[r]) < 1e-12, `${rank} ${level} ${r}`);
        const sd = slotDist('warrior', { rank, level, mf, blpOn: false });
        for (const s of ITEM_SLOTS) assert.ok(Math.abs(th.slot[s] - sd[s]) < 1e-12, `${rank} ${level} ${s}`);
      }
      assert.ok(th.gearPerKill > 0);
    }
  }
  // 「전설 하나까지 처치 수」 평균 = 1 / P(처치에 전설 ≥ 1) — 일반: 1 − (1 − p_gear × p_leg)^picks
  const th = dropTheory({ rank: 'normal', level: 1, cls: 'warrior', mf: 0, blpOn: false });
  const pl = rarityDist({ rank: 'normal', level: 1 }).legendary;
  const want = 1 / (1 - (1 - tcDist('normal').gear * pl) ** 1);
  assert.ok(Math.abs(th.meanKillsToLeg - want) / want < 1e-9);
});

test('이론값(불운 보정 켬) — 정상 분포를 섞은 값이 시뮬과 표본 오차 안(보장 없는 등급 · 보장 있는 등급) · 끔보다 전설이 많다', () => {
  for (const [rank, level, n] of [['elite', 12, 12000], ['guardian', 5, 4000]]) {
    const on = dropTheory({ rank, level, cls: 'mage', mf: 0.5, blpOn: true });
    const off = dropTheory({ rank, level, cls: 'mage', mf: 0.5, blpOn: false });
    assert.ok(on.rarity.legendary > off.rarity.legendary, `${rank}: 불운 보정이 전설을 늘린다`);
    assert.ok(Math.abs(Object.values(on.rarity).reduce((a, b) => a + b, 0) - 1) < 1e-9);
    const sim = createDropSim({ rank, level, cls: 'mage', mf: 0.5, blpOn: true, seed: 9 });
    sim.run(n);
    const r = sim.result();
    for (const k of RARITIES) {
      const c = compareShare(on.rarity[k], r.byRarity[k], r.gear);
      assert.ok(Math.abs(c.z) < 4.5, `${rank} ${k}: 이론 ${on.rarity[k]} 시뮬 ${c.share} z ${c.z}`);
    }
    for (const s of ITEM_SLOTS) {
      const c = compareShare(on.slot[s], r.bySlot[s], r.gear);
      assert.ok(Math.abs(c.z) < 4.5, `${rank} ${s}: z ${c.z}`);
    }
    const gpk = r.gear / r.kills;
    assert.ok(Math.abs(gpk - on.gearPerKill) < 4.5 * Math.max(1e-9, on.gearSdPerKill) / Math.sqrt(r.kills), `${rank} 처치당 장비`);
    assert.ok(r.maxGearGap <= BLP.hard);
  }
});

test('compareShare — 상대 오차 ≤ 3% 이거나 표본 오차 4σ 안이면 ok · 이론 0 에 시뮬 > 0 이면 bad · 1% 미만은 small', () => {
  assert.equal(compareShare(0.5, 510, 1000).ok, true);
  const far = compareShare(0.5, 600, 1000);
  assert.equal(far.ok, false);
  assert.ok(far.z > 6);
  assert.ok(Math.abs(far.err - 0.2) < 1e-12);
  assert.equal(compareShare(0.004, 6, 1000).ok, true, '작은 칸은 표본 오차 안이면 ok');
  assert.equal(compareShare(0.004, 6, 1000).small, true);
  assert.equal(compareShare(0, 1, 1000).ok, false);
  assert.equal(compareShare(0, 0, 1000).ok, true);
  assert.equal(compareShare(0.3, 0, 0).empty, true);
});

// ───────────────────────── 표 보기 ─────────────────────────

test('표 보기 — 균열 레벨 곡선 = RIFT_LEVELS 그대로(L20 뒤 hpLate · dmgLate 포함) · 계산 열은 데이터 함수 그대로', () => {
  const t = (/** @type {string} */ k) => k;
  const spec = buildTable('rift', t);
  const col = (/** @type {string} */ key) => spec.cols.findIndex((c) => c.key === key);
  assert.equal(spec.rows.length, RIFT_LEVELS.length);
  for (let i = 0; i < RIFT_LEVELS.length; i++) {
    const row = RIFT_LEVELS[i];
    const v = spec.rows[i].values;
    assert.equal(v[col('level')], row.level);
    assert.equal(v[col('hpMul')], row.hpMul);
    assert.equal(v[col('dmgMul')], row.dmgMul);
    assert.equal(v[col('goldMul')], row.goldMul);
    assert.equal(v[col('xpMul')], row.xpMul);
    assert.equal(v[col('earlyDmgMul(L)')], earlyDmgMul(row.level));
    assert.equal(v[col('earlyHpMul(L)')], earlyHpMul(row.level));
    assert.equal(v[col('rarityMul.legendary')], row.rarityMul.legendary);
    assert.equal(v[col('eliteAffixes')], row.eliteAffixes);
    assert.equal(v[col('GROWTH.item^(L−1)')], GROWTH.item ** (row.level - 1));
  }
  // L21 의 생명 배율 = L20 × hp(밸런스 게이트: GROWTH.lateFrom 30 — 표 30행 안에서는 늘 GROWTH.hp) (화면 문면도 같은 값)
  const r21 = spec.rows[20].values[col('hpMul')], r20 = spec.rows[19].values[col('hpMul')];
  assert.ok(Math.abs(/** @type {number} */ (r21) / /** @type {number} */ (r20) - (21 > GROWTH.lateFrom ? GROWTH.hpLate : GROWTH.hp)) < 1e-12);
  assert.equal(rawText(spec.rows[19].values[col('hpMul')]), String(Number(RIFT_LEVELS[19].hpMul.toFixed(3))));
});

test('표 보기 — 모든 표: 줄마다 열 수가 같다 · 옵션 · 정예 속성 · 몬스터 · 스킬 노드 · 경제가 데이터의 모든 행', () => {
  const t = (/** @type {string} */ k) => k;
  for (const id of TABLE_IDS) {
    const spec = buildTable(id, t);
    assert.ok(spec.rows.length > 0, id);
    for (const r of spec.rows) assert.equal(r.values.length, spec.cols.length, id);
    assert.equal(spec.titleKey, 'analytics.tbl.' + id);
  }
  assert.deepEqual(buildTable('affixes', t).rows.map((r) => r.values[0]), ITEM_AFFIXES.map((a) => a.id));
  assert.deepEqual(buildTable('monAffixes', t).rows.map((r) => r.values[0]), MON_AFFIXES.map((a) => a.id));
  const mons = buildTable('monsters', t).rows.map((r) => r.values[0]);
  for (const m of MONSTERS) assert.ok(mons.includes(m.id), m.id);
  const nodes = buildTable('skills', t).rows.map((r) => r.values[0]);
  for (const n of SKILL_NODES) assert.ok(nodes.includes(n.id), n.id);
  const econ = new Map(buildTable('economy', t).rows.map((r) => [r.values[0], r.values[1]]));
  assert.equal(econ.get('PRICES.sellRate'), PRICES.sellRate);
  assert.equal(econ.get('PRICES.buyMul.rare'), PRICES.buyMul.rare);
  // 옵션 티어 범위 문면 = 데이터
  const aff = buildTable('affixes', t);
  const t1 = aff.cols.findIndex((c) => c.key.startsWith('T1'));
  assert.equal(aff.rows[0].values[t1], `${ITEM_AFFIXES[0].tiers[0][0]}–${ITEM_AFFIXES[0].tiers[0][1]}`);
});

test('rawText · sortOrder — 정수 그대로 · 소수 셋째 자리 · 작은 값 유효 숫자 · 배열 · 객체 · 숫자 열 정렬 · 없음은 뒤', () => {
  assert.equal(rawText(3), '3');
  assert.equal(rawText(1.14), '1.14');
  assert.equal(rawText(1.6889601), '1.689');
  assert.equal(rawText(0.004), '0.004');
  assert.equal(rawText(0.00123456), '0.00123');
  assert.equal(rawText([1, 2]), '[1, 2]');
  assert.equal(rawText({ a: 1, b: [2, 3] }), '{a: 1, b: [2, 3]}');
  assert.equal(rawText(null), '—');
  assert.equal(rawText(true), 'true');
  const spec = { id: 'x', titleKey: '', src: '', notes: [], cols: [{ key: 'a' }, { key: 'n', num: true }],
    rows: [{ values: ['b', 10] }, { values: ['a', null] }, { values: ['c', 2] }, { values: ['a', 3] }] };
  assert.deepEqual(sortOrder(spec, 1, 1), [2, 3, 0, 1]);
  assert.deepEqual(sortOrder(spec, 1, -1), [0, 3, 2, 1]);
  assert.deepEqual(sortOrder(spec, 0, 1), [1, 3, 0, 2]);
  assert.deepEqual(sortOrder(spec, -1, 1), [0, 1, 2, 3]);
});

// ───────────────────────── 계측 HUD · 기타 ─────────────────────────

test('계측 HUD 문면 — 균열이 없어도 NaN 없이 · 값이 있으면 그 꼴', () => {
  const st = createGameState({ seed: 1 });
  const txt = meterTexts(meterView(st));
  for (const v of Object.values(txt)) assert.ok(!/NaN|undefined/.test(v), v);
  assert.equal(txt.drops, '0 · 0 · 0 · 0 · 0');
  const t2 = meterTexts({ dps: 1234.5, takenPerSec: 12.34, killsPerMin: 61, xpPerHour: 123456, goldPerHour: 9876.4, elapsedSec: 125,
    gaugePerMin: 14.25, targeting: 27, drops: { normal: 3, magic: 2, rare: 1, legendary: 0, set: 0 } });
  assert.equal(t2.dps, '1,235');
  assert.equal(t2.killsPerMin, '61');
  assert.equal(t2.elapsedSec, '2:05');
  assert.equal(t2.gaugePerMin, '14.3%');
  assert.equal(t2.drops, '3 · 2 · 1 · 0 · 0');
});

test('keyLabel · SIM_RANKS — 짧은 키 표시 · 장비가 나오는 등급만', () => {
  assert.equal(keyLabel('KeyX'), 'X');
  assert.equal(keyLabel('Digit1'), '1');
  assert.ok(SIM_RANKS.includes('normal') && SIM_RANKS.includes('elite') && SIM_RANKS.includes('guardian'));
  assert.ok(!SIM_RANKS.includes('spawn') && !SIM_RANKS.includes('split'));
});
