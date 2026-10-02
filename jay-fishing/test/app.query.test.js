// OWNER: P9 — 계약 §12.2(app.query) · §11.6
// 쿼리 파싱 · devSession 판정 · 잘못된 값 무시 + 저장(storage — 가짜 localStorage) 왕복 · 백업 3개.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery } from '../src/app/query.js';
import * as storage from '../src/app/storage.js';
import { SAVE_BACKUP_KEY, SAVE_KEY, SETTINGS_KEY } from '../src/core/constants.js';
import { createSaveData } from '../src/sim/progression/save.js';
import { makeTestState } from './helpers.js';

test('쿼리 파싱', () => {
  const q = parseQuery('?scene=coast&level=6&money=300000&time=19&weather=rain&seed=42&panel=pc&fixture=fightRun&bot=controlled');
  assert.equal(q.scene, 'coast');
  assert.equal(q.level, 6);
  assert.equal(q.money, 300000);
  assert.equal(q.time, 19);
  assert.equal(q.weather, 'rain');
  assert.equal(q.seed, 42);
  assert.equal(q.panel, 'pc');
  assert.equal(q.fixture, 'fightRun');
  assert.equal(q.bot, 'controlled');
  const s = parseQuery('spot=river_trench&bot=1&quality=low&mute=1&nopause=1&fresh=1');
  assert.equal(s.spot, 'river_trench');
  assert.equal(s.bot, 'basic');
  assert.deepEqual(s.overrides, { quality: 'low', mute: true });
  assert.equal(s.nopause, true);
  assert.equal(s.fresh, true);
});

test('devSession 판정', () => {
  assert.equal(parseQuery('').devSession, false);
  assert.equal(parseQuery('?quality=high&mute=1&nopause=1').devSession, false, 'quality · mute · nopause 만이면 개발 세션이 아니다');
  for (const k of ['fresh=1', 'scene=home', 'spot=lake_gravel', 'level=3', 'money=0', 'time=8', 'weather=clear', 'seed=1', 'bot=1', 'panel=pause', 'fixture=ready']) {
    assert.equal(parseQuery('?' + k).devSession, true, k);
  }
});

test('잘못된 값 무시', () => {
  const q = parseQuery('?scene=moon&spot=nowhere&level=abc&money=-5&time=30&weather=snow&seed=x&panel=title&fixture=nope&bot=evil&quality=ultra&fresh=0');
  assert.equal(q.scene, null);
  assert.equal(q.spot, null);
  assert.equal(q.level, null);
  assert.equal(q.money, null);
  assert.equal(q.time, null);
  assert.equal(q.weather, null);
  assert.equal(q.seed, null);
  assert.equal(q.panel, null);
  assert.equal(q.fixture, null);
  assert.equal(q.bot, null);
  assert.deepEqual(q.overrides, {});
  assert.equal(q.fresh, false);
  assert.equal(q.devSession, false, '잘못된 값만이면 개발 세션이 아니다');
  assert.equal(parseQuery('?level=99').level, 20, '레벨은 캡으로 자른다');
  assert.equal(parseQuery('?level=0').level, 1);
  assert.equal(parseQuery('?time=24').time, 0);
  assert.doesNotThrow(() => parseQuery(/** @type {any} */ (null)));
  assert.doesNotThrow(() => parseQuery('?%E0%A4%A=1'));
});

/** 가짜 localStorage */
function memStorage({ failWrite = false } = {}) {
  const m = new Map();
  return {
    m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { if (failWrite) throw new Error('quota'); m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

test('저장: 왕복 · 손상 · 미래 버전 → 백업 후 지움 · 던지지 않음', () => {
  const st = memStorage();
  assert.deepEqual(storage.loadSave(st), { save: null, broken: false, future: false, raw: null });
  const state = makeTestState({ scene: 'lake' });
  assert.equal(storage.writeSave(createSaveData(state, 123), st), true);
  const r = storage.loadSave(st);
  assert.ok(r.save);
  assert.equal(r.broken, false);

  st.setItem(SAVE_KEY, '{not json');
  const b = storage.loadSave(st);
  assert.equal(b.save, null);
  assert.equal(b.broken, true);
  assert.equal(st.getItem(SAVE_KEY), null, '손상 원문은 백업 뒤 지운다');
  assert.equal(storage.listBackups(st).length, 1);

  st.setItem(SAVE_KEY, JSON.stringify({ game: 'jay-fishing', version: 999 }));
  const f = storage.loadSave(st);
  assert.equal(f.future, true);
  assert.equal(f.broken, false);
  assert.equal(st.getItem(SAVE_KEY), null);

  const fail = memStorage({ failWrite: true });
  assert.equal(storage.canPersist(fail), false);
  assert.equal(storage.writeSave(createSaveData(state, 1), fail), false);
  assert.equal(storage.writeSettings({}, fail), false);
});

test('저장: 백업은 최신 3개만 · 앞의 백업을 덮지 않는다', () => {
  const st = memStorage();
  for (let i = 0; i < 5; i++) assert.equal(storage.backupSave('raw' + i, st), true);
  const keys = storage.listBackups(st);
  assert.equal(keys.length, 3);
  assert.deepEqual(keys.map(k => st.getItem(k)), ['raw2', 'raw3', 'raw4']);
  const all = [...st.m.keys()].filter(k => k.startsWith(SAVE_BACKUP_KEY + '.') && !k.endsWith('.index'));
  assert.equal(all.length, 3, '오래된 백업 키는 지운다');
  assert.equal(storage.backupSave(undefined, memStorage()), false, '세이브가 없으면 백업하지 않는다');
});

test('설정: 정리해서 읽고 · 쓸 때 덮어쓰기 키(mute)는 남지 않는다', () => {
  const st = memStorage();
  const d = storage.loadSettings(st);
  assert.equal(d.quality, 'medium');
  st.setItem(SETTINGS_KEY, '{broken');
  assert.equal(storage.loadSettings(st).fov, 70);
  assert.equal(storage.writeSettings({ ...d, quality: 'high', mute: true, mouseSens: 99 }, st), true);
  const back = JSON.parse(st.getItem(SETTINGS_KEY));
  assert.equal(back.quality, 'high');
  assert.equal('mute' in back, false);
  assert.equal(back.mouseSens, 3);
});

test('밸런스 게이트: ?gear=1..3 — 장비 단계 · 개발 세션 · 범위 밖은 무시', () => {
  assert.equal(parseQuery('?scene=river&level=12&gear=3').gear, 3);
  assert.equal(parseQuery('?gear=2').devSession, true);
  assert.equal(parseQuery('?gear=4').gear, null);
  assert.equal(parseQuery('?gear=0').gear, null);
  assert.equal(parseQuery('?gear=x').gear, null);
  assert.equal(parseQuery('').gear, null);
});
