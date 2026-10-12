// OWNER: P14 — 계약 §12.2 · §6.15 · §9.9 · §9.11
// 가짜 WebAudio(브라우저 규칙을 흉내 — 유한수 · 지수 램프 양수 · 소스 한 번 시작 · stop 은 start 뒤 · onended)로
// unlock 전 무시 · 리미터 · 발음 상한(전체 · 종류별 · 30ms 합치기) · 지속음 정리(장면 전환 · 사망 · 일시정지 · 탭 숨김) ·
// 고유 예고음 · 전설/세트 종소리 · 피해 종류 질감 · 공간 · 볼륨 · 누수(노드 수) · dispose · 소리 표 완결성 · 실제 sim 과 함께.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { AudioEngine } from '../src/audio/AudioEngine.js';
import {
  MIX, VOICE, CATS, SPACE, TEMPLATE_TONE, HIT_BY_TYPE, START_BY_BEHAVIOR, HIT_BY_BEHAVIOR, ACT_BY_TELEGRAPH, ACT_SWELL, DIE_BY_TEMPLATE,
  AFFIX_SOUND, UNIQUE_WARNS, EFFECT_WARN, EFFECT_WARN_DEFAULT, EFFECT_BOOM, EFFECT_BOOM_HOSTILE_DEFAULT, SHOT_BY_VISUAL, SHOT_DEFAULT,
  DROP_BY_RARITY, DROP_BY_KIND, PICK_BY_KIND, TRADE_SOUND, TRADE_DEFAULT, SPAWN_SOUND, INTERACT_SOUND, FAIL_PITCH, SOUNDS, LOOPS,
} from '../src/audio/sounds.js';
import { EV, EventBus } from '../src/core/events.js';
import { DT } from '../src/core/constants.js';
import { makeInput } from '../src/core/inputFrame.js';
import { DEFAULT_SETTINGS } from '../src/data/settings.js';
import { MONSTERS } from '../src/data/monsters.js';
import { GUARDIANS } from '../src/data/guardians.js';
import { SKILL_NODES, BASIC_SKILLS } from '../src/data/skills.js';
import { TILESETS } from '../src/data/tilesets.js';
import { GameSim } from '../src/sim/GameSim.js';
import { makeTestState, randomInputs } from './helpers.js';

const HERE = dirname(fileURLToPath(import.meta.url));

// ───────────────────────── 가짜 WebAudio ─────────────────────────

class FakeParam {
  constructor(name, v) {
    this.name = name;
    this.value = v;
    this.log = [];
  }
  _chk(v, t) {
    if (!Number.isFinite(v) || !Number.isFinite(t)) throw new TypeError(`non-finite ${this.name}: ${v} @ ${t}`);
    if (t < 0) throw new RangeError(`negative time ${this.name}`);
  }
  setValueAtTime(v, t) { this._chk(v, t); this.log.push(['set', v, t]); this.value = v; return this; }
  linearRampToValueAtTime(v, t) { this._chk(v, t); this.log.push(['lin', v, t]); this.value = v; return this; }
  exponentialRampToValueAtTime(v, t) {
    this._chk(v, t);
    if (v === 0) throw new RangeError(`exponential ramp to 0 (${this.name})`);
    const prev = this.log.length ? this.log[this.log.length - 1][1] : this.value;
    if (prev * v < 0) throw new RangeError(`exponential ramp across 0 (${this.name})`);
    this.log.push(['exp', v, t]);
    this.value = v;
    return this;
  }
  setTargetAtTime(v, t, tc) {
    this._chk(v, t);
    if (!(tc > 0)) throw new RangeError('timeConstant must be > 0');
    this.log.push(['target', v, t, tc]);
    this.value = v;
    return this;
  }
  cancelScheduledValues(t) { this._chk(0, t); this.log.push(['cancel', t]); return this; }
}

class FakeNode {
  constructor(ctx, kind) {
    if (ctx.state === 'closed') throw new Error('InvalidStateError: context closed');
    this.ctx = ctx;
    this.kind = kind;
    this.outs = new Set();
    ctx.created += 1;
    ctx.byKind[kind] = (ctx.byKind[kind] ?? 0) + 1;
    ctx.nodes.push(this);
  }
  connect(dest) {
    if (!dest || !(dest instanceof FakeNode || dest instanceof FakeParam)) throw new TypeError('connect target');
    if (this.outs.size === 0) this.ctx.live += 1;
    this.outs.add(dest);
    return dest;
  }
  disconnect() {
    if (this.outs.size > 0) this.ctx.live -= 1;
    this.outs.clear();
  }
}

class FakeSource extends FakeNode {
  constructor(ctx, kind) {
    super(ctx, kind);
    this.started = false;
    this.stopAt = Infinity;
    this.ended = false;
    this.onended = null;
  }
  start(t = 0, offset) {
    if (this.started) throw new Error('InvalidStateError: start twice');
    if (!Number.isFinite(t) || t < 0) throw new RangeError('start time');
    if (offset !== undefined && (!Number.isFinite(offset) || offset < 0)) throw new RangeError('start offset');
    this.started = true;
    this.startAt = t;
    this.ctx.startedSources += 1;
  }
  stop(t = 0) {
    if (!this.started) throw new Error('InvalidStateError: stop before start');
    if (!Number.isFinite(t) || t < 0) throw new RangeError('stop time');
    if (this.ended) return;
    this.stopAt = t;
    if (!this.pending) {
      this.pending = true;
      this.ctx.pending.push(this);
    }
  }
}

class FakeAudioContext {
  /** @type {FakeAudioContext[]} */
  static instances = [];
  static opts = { failCtor: false, failCompressor: false, startSuspended: false, rejectResume: false };
  constructor() {
    if (FakeAudioContext.opts.failCtor) throw new Error('NotAllowedError');
    FakeAudioContext.instances.push(this);
    this.currentTime = 0;
    this.sampleRate = 8000;
    this.state = FakeAudioContext.opts.startSuspended ? 'suspended' : 'running';
    this.created = 0;
    this.live = 0;
    this.byKind = {};
    /** @type {FakeNode[]} */ this.nodes = [];
    /** @type {FakeSource[]} */ this.pending = [];
    this.startedSources = 0;
    this.calls = { suspend: 0, resume: 0, close: 0 };
    this.destination = new FakeNode(this, 'destination');
  }
  createGain() { const n = new FakeNode(this, 'gain'); n.gain = new FakeParam('gain', 1); return n; }
  createOscillator() {
    const n = new FakeSource(this, 'osc');
    n.type = 'sine';
    n.frequency = new FakeParam('frequency', 440);
    return n;
  }
  createBufferSource() {
    const n = new FakeSource(this, 'buffer');
    n.buffer = null;
    n.loop = false;
    return n;
  }
  createBiquadFilter() {
    const n = new FakeNode(this, 'filter');
    n.type = 'lowpass';
    n.frequency = new FakeParam('frequency', 350);
    n.Q = new FakeParam('Q', 1);
    return n;
  }
  createDynamicsCompressor() {
    if (FakeAudioContext.opts.failCompressor) throw new Error('NotSupportedError');
    const n = new FakeNode(this, 'compressor');
    n.threshold = new FakeParam('threshold', -24);
    n.ratio = new FakeParam('ratio', 12);
    n.knee = new FakeParam('knee', 30);
    n.attack = new FakeParam('attack', 0.003);
    n.release = new FakeParam('release', 0.25);
    return n;
  }
  createStereoPanner() { const n = new FakeNode(this, 'panner'); n.pan = new FakeParam('pan', 0); return n; }
  createBuffer(ch, len, sr) {
    if (!(len > 0) || !(sr > 0)) throw new RangeError('buffer size');
    const data = Array.from({ length: ch }, () => new Float32Array(len));
    return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: (c) => data[c] };
  }
  suspend() { this.calls.suspend += 1; this.state = 'suspended'; return Promise.resolve(); }
  resume() {
    this.calls.resume += 1;
    if (FakeAudioContext.opts.rejectResume) return Promise.reject(new Error('NotAllowedError: no gesture'));
    this.state = 'running';
    return Promise.resolve();
  }
  close() { this.calls.close += 1; this.state = 'closed'; return Promise.resolve(); }
  /** 시간을 민다 — 멈출 시각이 지난 소스의 onended 를 부른다(브라우저처럼) */
  advance(dt) {
    this.currentTime += dt;
    const keep = [];
    for (const s of this.pending) {
      if (s.stopAt <= this.currentTime) {
        s.ended = true;
        s.pending = false;
        if (typeof s.onended === 'function') s.onended();
      } else keep.push(s);
    }
    this.pending = keep;
  }
}

afterEach(() => {
  FakeAudioContext.instances.length = 0;
  FakeAudioContext.opts = { failCtor: false, failCompressor: false, startSuspended: false, rejectResume: false };
  globalThis.AudioContext = FakeAudioContext;
});
globalThis.AudioContext = FakeAudioContext;

// ───────────────────────── 조각 ─────────────────────────

function setup({ settings = { ...DEFAULT_SETTINGS }, unlock = true } = {}) {
  globalThis.AudioContext = FakeAudioContext;
  const bus = new EventBus();
  const audio = new AudioEngine({ bus, settings });
  if (unlock) audio.unlock();
  return { bus, audio, ctx: /** @type {FakeAudioContext} */ (audio.ctx), settings };
}

/** 플레이어가 (x, z)에 선 균열 상태(기본 지하 묘지) */
function riftState(x = 20, z = 20) {
  const s = makeTestState({ scene: 'rift' });
  s.rift.tileset = 'crypt';
  s.player.pos = { x, z };
  return s;
}
function townState() {
  const s = makeTestState({ scene: 'town' });
  s.rift = null;
  return s;
}

/** 지금 종류별 상한 · 전체 상한을 지키는가 */
function assertCaps(audio, where = '') {
  const s = audio.debugStats();
  let total = 0;
  for (const [cat, n] of Object.entries(s.byCat)) {
    assert.ok(n <= CATS[cat].cap, `${where} ${cat} ${n} > cap ${CATS[cat].cap}`);
    total += n;
  }
  assert.ok(total <= VOICE.max, `${where} voices ${total} > ${VOICE.max}`);
  return s;
}

/** 레시피 서명(음색 비교용) */
function signature(rec) {
  return rec.L.map(L => `${L.w}:${Math.round(L.f?.[0] ?? 0)}>${Math.round(L.f?.[1] ?? 0)}:${L.flt ? L.flt.slice(0, 3).join('/') : '-'}:${L.t ?? 0}:${L.d}`).sort().join('|');
}

const hit = (over = {}) => ({ targetId: -1, x: 20, z: 20, amount: 10, type: 'phys', crit: false, killed: false, immune: false, blocked: false, dot: false, skillId: 'bash', big: false, ...over });
const voicesOf = (audio, id) => audio._voices.filter(v => !v.dead && v.id === id);

/** 계약 §4 의 모든 이벤트 — 그럴듯한 payload(잠금 전 · 퍼즈용) */
function sampleEvents(x = 20, z = 20) {
  const shape = { type: 'circle', x, z, r: 2 };
  return [
    [EV.CHAR_LOADED, { slot: 0, cls: 'warrior', name: 'A', level: 1, isNew: true }],
    [EV.MAP_LOADED, { mapId: 'm', kind: 'rift', tileset: 'crypt' }],
    [EV.SCENE_CHANGED, { from: 'town', to: 'rift', reason: 'openRift' }],
    [EV.TRAVEL_REQUEST, { to: 'town', reason: 'recall' }],
    [EV.TRAVEL_REQUEST, { to: 'town', reason: 'respawn' }],
    [EV.PLAYER_SPAWNED, { x, z, facing: 0, reason: 'scene' }],
    [EV.INTERACT, { kind: 'riftPortal', id: 'portal:3' }],
    [EV.INTERACT, { kind: 'stash', id: 'stash' }],
    [EV.HINT, { id: 'town' }],
    [EV.ACTION_START, { skillId: 'bash', act: 'attack', x, z, facing: 0, tx: x, tz: z + 1, dur: 0.7, hitIn: 0.3 }],
    [EV.ACTION_START, { skillId: 'fireball', act: 'cast', x, z, facing: 0, tx: x, tz: z + 1, dur: 0.5, hitIn: 0.2 }],
    [EV.ACTION_START, { skillId: 'recall', act: 'recall', x, z, facing: 0, tx: x, tz: z, dur: 1.5, hitIn: 0 }],
    [EV.ACTION_HIT, { skillId: 'groundStomp', x, z, facing: 0, tx: x, tz: z + 1, rank: 1, transforms: [] }],
    [EV.ACTION_HIT, { skillId: 'warCry', x, z, facing: 0, tx: x, tz: z, rank: 1, transforms: [] }],
    [EV.ACTION_HIT, { skillId: 'nope', x, z, facing: 0, tx: x, tz: z, rank: 1, transforms: [] }],
    [EV.SKILL_FAIL, { skillId: 'whirlwind', reason: 'resource' }],
    [EV.CHANNEL, { skillId: 'whirlwind', on: true }],
    [EV.CHANNEL, { skillId: 'whirlwind', on: false }],
    [EV.POTION, { heal: 40, left: 3 }],
    [EV.POTION_FAIL, { reason: 'empty' }],
    [EV.RECALL, { phase: 'start', sec: 1.5 }],
    [EV.RECALL, { phase: 'cancel', reason: 'damage', sec: 0.4 }],
    [EV.RECALL, { phase: 'done', sec: 1.5 }],
    [EV.BUFF, { id: 'warCry', on: false, sec: 0, value: 0.4 }],
    [EV.PLAYER_HIT, { amount: 12, absorbed: 0, blocked: false, type: 'phys', via: 'melee', srcId: 5, x, z, life: 50, lifeMax: 100 }],
    [EV.PLAYER_HIT, { amount: 0, absorbed: 8, blocked: false, type: 'fire', via: 'projectile', srcId: 5, x, z, life: 50, lifeMax: 100 }],
    [EV.PLAYER_HIT, { amount: 3, absorbed: 0, blocked: true, type: 'phys', via: 'melee', srcId: 5, x, z, life: 50, lifeMax: 100 }],
    [EV.PLAYER_HEAL, { amount: 20, source: 'globe' }],
    [EV.PLAYER_HEAL, { amount: 20, source: 'legend' }],
    [EV.PLAYER_STATUS, { kind: 'root', on: true, sec: 1 }],
    [EV.PLAYER_STATUS, { kind: 'slow', on: true, sec: 1 }],
    [EV.SHIELD, { amount: 0, max: 30, broken: true }],
    [EV.LOW_LIFE, { on: true }],
    [EV.PLAYER_DIED, { x, z, lives: 2, collapse: false, killerId: 5, killerName: null, killerTypeId: 'ghoul' }],
    [EV.HIT, hit({ type: 'fire', crit: true })],
    [EV.HIT, hit({ type: 'cold', big: true })],
    [EV.HIT, hit({ type: 'lightning' })],
    [EV.HIT, hit({ immune: true })],
    [EV.HIT, hit({ blocked: true })],
    [EV.HIT, hit({ dot: true, type: 'fire' })],
    [EV.HITSTOP, { sec: 0.05 }],
    [EV.SHAKE, { amp: 0.3, sec: 0.2 }],
    [EV.MON_SPAWNED, { id: 900, typeId: 'boneling', rank: 'spawn', x, z, reason: 'nest' }],
    [EV.MON_SPAWNED, { id: 901, typeId: 'fallen', rank: 'normal', x, z, reason: 'revive' }],
    [EV.MON_WAKE, { packId: 1, kind: 'normal', x, z, count: 8 }],
    [EV.MON_WAKE, { packId: 2, kind: 'elite', x, z, count: 4 }],
    [EV.MON_ACT, { id: 900, typeId: 'ghoul', act: 'windup', actId: 'claw', telegraph: 'pose', x, z, facing: 0, dur: 0.5 }],
    [EV.MON_ACT, { id: 902, typeId: 'bloater', act: 'swell', actId: 'burst', telegraph: 'glow', x, z, facing: 0, dur: 1 }],
    [EV.MON_ACT, { id: 903, typeId: 'boneGiant', act: 'cast', actId: 'slam', telegraph: 'groundCircle', x, z, facing: 0, dur: 1 }],
    [EV.MON_STRIKE, { id: 900, actId: 'claw', x, z, facing: 0 }],
    [EV.MON_STATUS, { id: 900, kind: 'freeze', on: true }],
    [EV.MON_STATUS, { id: 900, kind: 'freeze', on: false }],
    [EV.MON_STATUS, { id: 900, kind: 'stun', on: true }],
    [EV.MON_STATUS, { id: 900, kind: 'burn', on: false }],
    [EV.MON_DIED, { id: 900, typeId: 'ghoul', rank: 'normal', x, z, facing: 0, launch: null, byPlayer: true, elite: false }],
    [EV.MON_DIED, { id: 904, typeId: 'charger', rank: 'elite', x, z, facing: 0, launch: { x: 1, z: 0 }, byPlayer: true, elite: true }],
    [EV.MON_DIED, { id: 903, typeId: 'boneGiant', rank: 'guardian', x, z, facing: 0, launch: null, byPlayer: true, elite: true }],
    [EV.MON_DIED, { id: 905, typeId: 'mystery', rank: 'normal', x, z, facing: 0, launch: null, byPlayer: true, elite: false }],
    [EV.AFFIX, { monId: 904, affixId: 'jailer', what: 'jailWarn', x, z }],
    [EV.AFFIX, { monId: 904, affixId: 'mortar', what: 'mortarFire', x, z }],
    [EV.AFFIX, { monId: 904, affixId: 'shielding', what: 'shieldWarn', x, z }],
    [EV.AFFIX, { monId: 904, affixId: 'coldEnchanted', what: 'novaWarn', x, z }],
    [EV.AFFIX, { monId: 904, affixId: 'teleporter', what: 'teleportIn', x, z }],
    [EV.AFFIX, { monId: 904, affixId: 'x', what: 'unknownWhat', x, z }],
    [EV.PROJ_SPAWN, { id: 50, visual: 'arrow', owner: 'mon', x, z, vx: 1, vz: 0 }],
    [EV.PROJ_SPAWN, { id: 51, visual: 'magicBolt', owner: 'player', x, z, vx: 1, vz: 0 }],
    [EV.PROJ_SPAWN, { id: 52, visual: 'unknownVisual', owner: 'mon', x, z, vx: 1, vz: 0 }],
    [EV.PROJ_END, { id: 50, visual: 'arrow', x, z, reason: 'wall' }],
    [EV.PROJ_END, { id: 51, visual: 'magicBolt', x, z, reason: 'cancel' }],
    [EV.EFFECT_SPAWN, { id: 60, kind: 'jail', hostile: true, shape, sec: 0.8, dur: 0 }],
    [EV.EFFECT_SPAWN, { id: 61, kind: 'mystery', hostile: true, shape, sec: 0.8, dur: 0 }],
    [EV.EFFECT_SPAWN, { id: 62, kind: 'meteor', hostile: false, shape, sec: 1.2, dur: 3 }],
    [EV.EFFECT_HIT, { id: 60, kind: 'jail', hostile: true, shape, hitPlayer: true, targets: 0 }],
    [EV.EFFECT_HIT, { id: 62, kind: 'meteor', hostile: false, shape, hitPlayer: false, targets: 6 }],
    [EV.EFFECT_HIT, { id: 63, kind: 'mystery', hostile: true, shape: null, hitPlayer: false, targets: 0 }],
    [EV.RIFT_OPENED, { level: 1, seed: 1, tileset: 'crypt', lives: 3 }],
    [EV.GAUGE, { gauge: 40, delta: 1 }],
    [EV.GAUGE_FULL, { x, z, sec: 2 }],
    [EV.GUARDIAN_APPEAR, { id: 903, typeId: 'boneGiant', x, z, name: ['a', 'b'] }],
    [EV.RIFT_COMPLETE, { summary: {} }],
    [EV.RIFT_COLLAPSE, { summary: {} }],
    [EV.RIFT_CLOSED, { reason: 'quit' }],
    [EV.LIVES, { lives: 2 }],
    [EV.PORTAL_OPENED, { id: 'portal:9', kind: 'exit', x, z }],
    [EV.PORTAL_CLOSED, { id: 'portal:9' }],
    [EV.DROP_SPAWN, { id: 70, kind: 'item', rarity: 'legendary', x, z, fromX: x, fromZ: z }],
    [EV.DROP_SPAWN, { id: 71, kind: 'item', rarity: 'set', x, z, fromX: x, fromZ: z }],
    [EV.DROP_SPAWN, { id: 72, kind: 'gold', rarity: null, x, z, fromX: x, fromZ: z }],
    [EV.DROP_SPAWN, { id: 73, kind: 'item', rarity: 'weird', x, z, fromX: x, fromZ: z }],
    [EV.DROP_PICKED, { id: 72, kind: 'gold', amount: 12, itemId: null, rarity: null }],
    [EV.DROP_PICKED, { id: 70, kind: 'item', amount: 1, itemId: 'i9', rarity: 'legendary' }],
    [EV.PICKUP_FAIL, { id: 70, reason: 'bagFull' }],
    [EV.GOLD, { gold: 10, delta: 2, reason: 'pickup' }],
    [EV.MATERIALS, { materials: {}, delta: {}, reason: 'salvage' }],
    [EV.BAG, { reason: 'sort' }],
    [EV.BAG, { reason: 'pickup' }],
    [EV.EQUIPPED, { slot: 'helm', itemId: 'i1', baseId: 'cap', tier: 0, rarity: 'magic' }],
    [EV.EQUIPPED, { slot: 'helm', itemId: null, baseId: null, tier: 0, rarity: null }],
    [EV.DURABILITY, { broken: ['helm'], fraction: 0.1 }],
    [EV.TRADE, { shop: 'gambler', kind: 'gamble', cost: 100, itemId: 'i5', rarity: 'rare' }],
    [EV.TRADE, { shop: 'blacksmith', kind: 'repair', cost: 10, itemId: null, rarity: null }],
    [EV.TRADE, { shop: 'x', kind: 'unknownKind', cost: 0, itemId: null, rarity: null }],
    [EV.XP, { amount: 1, level: 1, xp: 1, toNext: 10 }],
    [EV.LEVEL_UP, { level: 2, points: 1 }],
    [EV.SKILLS, { reason: 'learn', nodeId: 'groundStomp', rank: 1 }],
    [EV.STATS_CHANGED, { sheetDps: 1, lifeMax: 1, armor: 1 }],
    [EV.UNLOCK, { riftUnlocked: 2, from: 1 }],
    [EV.SAVE_REQUEST, { scope: 'char', reason: 'pickup' }],
    [EV.PANEL_OPENED, { panel: 'inventory', modal: false, depth: 1 }],
    [EV.PANEL_CLOSED, { panel: 'inventory', depth: 0, by: 'esc' }],
    [EV.PANEL_CLOSED, { panel: 'death', depth: 0, by: 'code' }],
    [EV.SCREEN_CHANGED, { from: 'title', to: 'play' }],
    [EV.SETTINGS_CHANGED, { settings: { ...DEFAULT_SETTINGS } }],
    [EV.AUDIO_UNLOCKED, {}],
    [EV.FADE, { phase: 'out', sec: 0.3 }],
    [EV.LABELS, { on: true }],
    [EV.BOT, { on: false }],
  ];
}

// ───────────────────────── unlock 규칙 ─────────────────────────

test('unlock 전: AudioContext 를 만들지 않고 모든 호출 · 이벤트를 조용히 무시 → unlock 은 한 번만 만든다', () => {
  const { bus, audio, settings } = setup({ unlock: false });
  const st = riftState();
  for (const [name, payload] of sampleEvents()) bus.emit(name, payload);
  bus.emit(EV.PAUSED, { on: true, reason: 'menu' });
  bus.emit(EV.PAUSED, { on: false, reason: 'menu' });
  audio.update(st, 0.016);
  audio.setPaused(true);
  audio.setPaused(false);
  audio.applySettings(settings);
  assert.deepEqual(audio.stats(), { voices: 0, nodes: 0 });
  assert.equal(FakeAudioContext.instances.length, 0, '잠금 전에 컨텍스트를 만들었다');

  audio.unlock();
  assert.equal(FakeAudioContext.instances.length, 1);
  audio.unlock();
  audio.unlock();
  assert.equal(FakeAudioContext.instances.length, 1, 'unlock 이 컨텍스트를 또 만들었다');
  assert.deepEqual(audio.stats(), { voices: 0, nodes: 5 }, '마스터 체인(리미터 · 마스터 · 버스 셋)만');
});

test('WebAudio 가 없거나 · 생성이 막히거나 · 노드 생성이 실패해도 던지지 않고 조용하다', () => {
  delete globalThis.AudioContext;
  const bus = new EventBus();
  const a = new AudioEngine({ bus, settings: { ...DEFAULT_SETTINGS } });
  assert.doesNotThrow(() => a.unlock());
  assert.equal(a.ctx, null);
  for (const [name, payload] of sampleEvents()) bus.emit(name, payload);
  a.update(riftState(), 0.016);
  assert.deepEqual(a.stats(), { voices: 0, nodes: 0 });

  globalThis.AudioContext = FakeAudioContext;
  FakeAudioContext.opts.failCtor = true;
  const b = new AudioEngine({ bus: new EventBus(), settings: {} });
  assert.doesNotThrow(() => b.unlock());
  assert.equal(b.ctx, null);

  FakeAudioContext.opts.failCtor = false;
  FakeAudioContext.opts.failCompressor = true;
  const c = new AudioEngine({ bus: new EventBus(), settings: {} });
  assert.doesNotThrow(() => c.unlock());
  assert.equal(c.ctx, null, '체인을 못 지으면 소리 없이');
  assert.equal(FakeAudioContext.instances.at(-1).calls.close, 1, '반쯤 만든 컨텍스트는 닫는다');

  // bus 가 없어도
  assert.doesNotThrow(() => new AudioEngine({ bus: null, settings: null }).unlock());
});

test('resume 이 거절돼도(자동 재생 정책) 처리되지 않은 거절 0 · 다음 제스처의 unlock 이 다시 깨운다', async () => {
  FakeAudioContext.opts.startSuspended = true;
  FakeAudioContext.opts.rejectResume = true;
  const unhandled = [];
  const onUnhandled = (r) => unhandled.push(r);
  process.on('unhandledRejection', onUnhandled);
  try {
    const { audio, ctx } = setup();
    assert.equal(ctx.calls.resume, 1);
    audio.unlock();
    assert.equal(ctx.calls.resume, 2);
    // 멈춘 채면 update 가 실제 시간 MIX.resumeRetry 마다 다시 깨운다(app 의 unlock 은 한 번뿐 — 숨김에서 돌아온 뒤 거절 대비)
    const st = riftState();
    audio.update(st, MIX.resumeRetry * 0.6);
    assert.equal(ctx.calls.resume, 2);
    audio.update(st, MIX.resumeRetry * 0.6);
    assert.equal(ctx.calls.resume, 3);
    audio.update(st, NaN);
    assert.equal(ctx.calls.resume, 3);
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));
    assert.equal(unhandled.length, 0);
    // 멈춘 동안(시계가 서 있다) 한 번 나는 소리는 쌓지 않는다 — 깨어날 때 한꺼번에 터지지 않게
    const { bus } = { bus: audio.bus };
    for (let i = 0; i < 50; i++) bus.emit(EV.HIT, hit({ type: ['phys', 'fire', 'cold', 'lightning'][i % 4] }));
    bus.emit(EV.LEVEL_UP, { level: 2, points: 1 });
    assert.equal(audio._voices.length, 0, '멈춘 컨텍스트에 예약한 소리');
    FakeAudioContext.opts.rejectResume = false;
    audio.unlock();
    assert.equal(ctx.state, 'running');
    bus.emit(EV.LEVEL_UP, { level: 3, points: 2 });
    assert.equal(voicesOf(audio, 'levelUp').length, 1, '깨어나면 다시 난다');
    audio.update(st, 5);
    assert.equal(ctx.calls.resume, 4, '돌고 있으면 다시 깨우지 않는다');
    audio.setPaused(true);
    audio.update(st, 5);
    assert.equal(ctx.calls.resume, 4, '탭 숨김(suspend)은 깨우지 않는다');
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

// ───────────────────────── 리미터 · 그래프 ─────────────────────────

test('리미터: 소리 → 버스 → 마스터 → DynamicsCompressor(−10dB · 12:1) → 출력 — 출력으로 가는 길은 리미터 하나', () => {
  const { bus, audio, ctx } = setup();
  audio.update(riftState(), 0);
  const comps = ctx.nodes.filter(n => n.kind === 'compressor');
  assert.equal(comps.length, 1);
  const comp = comps[0];
  assert.equal(comp.threshold.value, -10);
  assert.equal(comp.ratio.value, 12);
  assert.equal(comp.threshold.value, MIX.limiter.threshold);
  assert.ok(comp.outs.has(ctx.destination));
  const intoDest = ctx.nodes.filter(n => n.outs.has(ctx.destination));
  assert.deepEqual(intoDest, [comp], '출력에 직접 붙은 것은 리미터뿐');

  bus.emit(EV.HIT, hit());
  bus.emit(EV.DROP_SPAWN, { id: 1, kind: 'item', rarity: 'legendary', x: 25, z: 20, fromX: 25, fromZ: 20 });
  bus.emit(EV.PANEL_OPENED, { panel: 'inventory', modal: false, depth: 1 });
  /** 노드에서 출력까지 — 지나간 노드들 */
  const pathTo = (node, seen = new Set()) => {
    if (node === ctx.destination) return [node];
    if (!(node instanceof FakeNode) || seen.has(node)) return null;
    seen.add(node);
    for (const o of node.outs) {
      const p = pathTo(o, seen);
      if (p) return [node, ...p];
    }
    return null;
  };
  for (const v of audio._voices) {
    const p = pathTo(v.out);
    assert.ok(p, `${v.id} 가 출력에 닿지 않는다`);
    assert.ok(p.includes(comp), `${v.id} 가 리미터를 건너뛴다`);
  }
  const amb = audio._loops.amb;
  assert.ok(amb && pathTo(amb.out).includes(comp), '환경음도 리미터를 지난다');
});

// ───────────────────────── 발음 상한 ─────────────────────────

test('40마리가 같은 틱에 맞아도: 같은 소리는 30ms 안에서 합쳐져 소리 몇 개 · 합친 크기는 상한 안', () => {
  const { bus, audio } = setup();
  audio.update(riftState(), 0);
  const types = ['phys', 'fire', 'cold', 'lightning'];
  for (let i = 0; i < 40; i++) bus.emit(EV.HIT, hit({ targetId: 1000 + i, type: types[i % 4], x: 20 + (i % 7), z: 20 + (i % 5) }));
  const s = assertCaps(audio, '40 hits');
  assert.ok((s.byCat.hit ?? 0) <= 4, `피격 소리 ${s.byCat.hit}개`);
  assert.ok(s.merged >= 36, `합친 수 ${s.merged}`);
  for (const v of audio._voices) assert.ok(v.level <= v.base * VOICE.mergeMax + 1e-9, `${v.id} 합친 크기 ${v.level} > ${v.base} × ${VOICE.mergeMax}`);
});

test('종류별 상한: 시간이 흘러도 사망 6 · 발사 6 · 예고 4 · 피격 6 — 넘치면 가장 오래된 것을 밀어낸다', () => {
  const { bus, audio, ctx } = setup();
  const st = riftState();
  audio.update(st, 0);
  let maxDeath = 0, maxShot = 0, maxWarn = 0;
  for (let i = 0; i < 80; i++) {
    ctx.advance(VOICE.mergeSec + 0.001);
    audio.update(st, VOICE.mergeSec);
    bus.emit(EV.MON_DIED, { id: 2000 + i, typeId: 'ghoul', rank: 'normal', x: 21, z: 20, facing: 0, launch: null, byPlayer: true, elite: false });
    bus.emit(EV.PROJ_SPAWN, { id: 3000 + i, visual: 'fireball', owner: 'player', x: 20, z: 20, vx: 1, vz: 0 });
    bus.emit(EV.MON_ACT, { id: 4000 + i, typeId: 'ghoul', act: 'windup', actId: 'claw', telegraph: 'pose', x: 22, z: 20, facing: 0, dur: 0.5 });
    const s = assertCaps(audio, `step ${i}`);
    maxDeath = Math.max(maxDeath, s.byCat.death ?? 0);
    maxShot = Math.max(maxShot, s.byCat.shot ?? 0);
    maxWarn = Math.max(maxWarn, s.byCat.warn ?? 0);
  }
  assert.equal(maxDeath, CATS.death.cap, '사망음이 상한까지 찼다가 막힌다');
  assert.equal(maxShot, CATS.shot.cap);
  assert.equal(maxWarn, CATS.warn.cap);
  assert.ok(audio.debugStats().stolen > 0);
  assert.equal(CATS.hit.cap, 6);
  assert.equal(CATS.death.cap, 6);
  assert.equal(CATS.shot.cap, 6);
  assert.equal(CATS.warn.cap, 4);
  assert.equal(VOICE.max, 32);
  assert.equal(VOICE.mergeSec, 0.03);

  // 같은 순간 피격 종류 소리 9가지 → 6
  ctx.advance(1);
  audio.update(st, 1);
  for (const t of ['phys', 'fire', 'cold', 'lightning']) bus.emit(EV.HIT, hit({ type: t }));
  bus.emit(EV.HIT, hit({ immune: true }));
  bus.emit(EV.HIT, hit({ blocked: true }));
  bus.emit(EV.MON_STATUS, { id: 1, kind: 'freeze', on: true });
  bus.emit(EV.MON_STATUS, { id: 1, kind: 'stun', on: true });
  bus.emit(EV.AFFIX, { monId: 1, affixId: 'lightningEnchanted', what: 'sparks', x: 20, z: 20 });
  assert.equal(assertCaps(audio, 'hit mix').byCat.hit, CATS.hit.cap);
});

test('전체 상한 32: 모든 소리를 한꺼번에 내도 32 · 넘치면 낮은 우선순위가 밀리고 고유 예고는 들린다', () => {
  const { bus, audio, ctx } = setup();
  const st = riftState();
  audio.update(st, 0);
  for (let round = 0; round < 3; round++) {
    for (const id of Object.keys(SOUNDS)) audio._play(id, 21, 21, 1, 1);
    assertCaps(audio, `flood ${round}`);
    ctx.advance(VOICE.mergeSec + 0.001);
  }
  assert.ok(audio.debugStats().voices - 1 <= VOICE.max, '한 번 나는 소리 ≤ 32 (+ 환경음 루프 1)');
  for (const what of ['jailWarn', 'mortarFire', 'shieldWarn', 'novaWarn']) {
    ctx.advance(0.25);
    bus.emit(EV.AFFIX, { monId: 7, affixId: 'x', what, x: 22, z: 22 });
    assert.equal(voicesOf(audio, AFFIX_SOUND[what]).length, 1, `${what} 가 홍수 속에서 났다`);
    assertCaps(audio, what);
  }
});

test('몰림 줄이기: 한순간에 여러 소리가 시작되면 뒤의 것은 작게(바닥 있음) · 고유 예고 · 종소리는 줄이지 않는다', () => {
  const { audio, ctx } = setup();
  audio.update(riftState(), 0);
  ctx.advance(1);
  const ids = ['hitPhys', 'hitFire', 'hitCold', 'hitLightning', 'dieHumanoid', 'dieSmall', 'dieBeast', 'dieBlob', 'fireShot', 'arrowShot', 'boltShot', 'iceShot'];
  const ratios = ids.map(id => { const v = audio._play(id, NaN, NaN, 1, 1); return v ? v.level / SOUNDS[id].g : null; });
  for (let i = 0; i < VOICE.burstFree; i++) assert.equal(ratios[i], 1, `${ids[i]} 첫 ${VOICE.burstFree}개는 그대로`);
  for (let i = VOICE.burstFree; i < ids.length; i++) {
    if (ratios[i] === null) continue;
    const n = i + 1;
    assert.ok(Math.abs(ratios[i] - Math.max(VOICE.burstMin, Math.pow(VOICE.burstFree / n, VOICE.burstExp))) < 1e-9, `${ids[i]} ${ratios[i]}`);
  }
  const jail = audio._play('jailWarn', NaN, NaN, 1, 1);
  assert.equal(jail.level, SOUNDS.jailWarn.g, '고유 예고는 몰림에도 그대로');
  const leg = audio._play('dropLegendary', NaN, NaN, 1, 1);
  assert.equal(leg.level, SOUNDS.dropLegendary.g);
  // 몰림이 풀리면(창이 지나면) 다시 그대로
  ctx.advance(VOICE.burstWin + 0.01);
  const v = audio._play('hitPhys', NaN, NaN, 1, 1);
  assert.equal(v.level, SOUNDS.hitPhys.g);
  // 몰린 중에 합쳐도 키우지 않는다
  for (let i = 0; i < 10; i++) audio._play('boltShot', NaN, NaN, 1, 1);
  const before = voicesOf(audio, 'hitPhys')[0].level;
  audio._play('hitPhys', NaN, NaN, 1, 1);
  assert.equal(voicesOf(audio, 'hitPhys')[0].level, before);
});

test('같은 소리의 최소 간격(gap): 30ms 를 넘겨도 gap 안이면 버린다(실패음 연타 · 포털 겹침)', () => {
  const { bus, audio, ctx } = setup();
  audio.update(riftState(), 0);
  bus.emit(EV.PICKUP_FAIL, { id: 1, reason: 'bagFull' });
  ctx.advance(0.05);
  bus.emit(EV.PICKUP_FAIL, { id: 1, reason: 'bagFull' });
  assert.equal(voicesOf(audio, 'fail').length, 1);
  ctx.advance(SOUNDS.fail.gap);
  bus.emit(EV.PICKUP_FAIL, { id: 1, reason: 'bagFull' });
  assert.equal(audio._count.played >= 2, true);
  // 귀환 완료 + 이동 요청이 같은 플러시 → 포털 소리 하나
  ctx.advance(1);
  bus.emit(EV.RECALL, { phase: 'done', sec: 1.5 });
  bus.emit(EV.TRAVEL_REQUEST, { to: 'town', reason: 'recall' });
  assert.equal(voicesOf(audio, 'portal').length, 1);
});

// ───────────────────────── 위협 · 전리품 · 질감 ─────────────────────────

test('정예 속성 고유 예고 넷(감옥 · 몰타르 · 보호막 · 냉기 노바)은 음색이 서로 다르고, 떼의 예고음 홍수에 묻히지 않는다', () => {
  assert.deepEqual([...UNIQUE_WARNS].sort(), ['jailWarn', 'mortarFire', 'novaWarn', 'shieldWarn']);
  const sigs = UNIQUE_WARNS.map(id => signature(SOUNDS[id]));
  assert.equal(new Set(sigs).size, 4, '서명이 겹친다');
  for (const id of UNIQUE_WARNS) assert.equal(SOUNDS[id].cat, 'alarm', `${id} 는 고유 예고 종류(alarm)`);
  assert.ok(CATS.alarm.prio > CATS.warn.prio && CATS.alarm.prio > CATS.hit.prio);

  // 각자만 가진 특징 — 쇠사슬 딸깍 연타 · 1초 넘게 내려가는 휘파람 · 올라가는 계단 음 3개 이상 · 길게 부푸는 고역 잡음
  const clinks = (r) => r.L.filter(L => L.w === 'noise' && L.d <= 0.06 && L.flt?.[0] === 'bandpass' && L.flt[1] >= 3500).length >= 4;
  const whistle = (r) => r.L.some(L => L.w !== 'noise' && L.f[1] && L.f[1] < L.f[0] && L.f[0] >= 1200 && L.d >= 1);
  const stairs = (r) => {
    // 활강 없는 음 중 「늦게 시작할수록 높은」 가장 긴 열(시작 0.5초 안) ≥ 4
    const tones = r.L.filter(L => L.w !== 'noise' && !L.f[1] && (L.t ?? 0) < 0.5).sort((a, b) => (a.t ?? 0) - (b.t ?? 0) || a.f[0] - b.f[0]);
    const best = tones.map(() => 1);
    for (let i = 0; i < tones.length; i++) {
      for (let j = 0; j < i; j++) if ((tones[j].t ?? 0) < (tones[i].t ?? 0) && tones[j].f[0] < tones[i].f[0]) best[i] = Math.max(best[i], best[j] + 1);
    }
    return Math.max(0, ...best) >= 4;
  };
  const icySwell = (r) => r.L.some(L => L.w === 'noise' && L.flt?.[0] === 'highpass' && L.flt[1] >= 4000 && (L.a ?? 0) >= 0.5 * L.d && L.d >= 0.8);
  const feats = { jailWarn: clinks, mortarFire: whistle, shieldWarn: stairs, novaWarn: icySwell };
  for (const [own, f] of Object.entries(feats)) {
    for (const id of UNIQUE_WARNS) assert.equal(f(SOUNDS[id]), id === own, `${own} 특징이 ${id} 에서 ${id === own ? '없다' : '보인다'}`);
  }

  const { bus, audio } = setup();
  audio.update(riftState(), 0);
  for (let i = 0; i < 40; i++) {
    bus.emit(EV.MON_ACT, { id: 5000 + i, typeId: i % 2 ? 'ghoul' : 'fallenShaman', act: 'windup', actId: 'a', telegraph: i % 3 ? 'pose' : 'glow', x: 20 + i % 5, z: 22, facing: 0, dur: 0.5 });
    bus.emit(EV.MON_STRIKE, { id: 5000 + i, actId: 'a', x: 20, z: 22, facing: 0 });
  }
  bus.emit(EV.AFFIX, { monId: 1, affixId: 'jailer', what: 'jailWarn', x: 21, z: 21 });
  bus.emit(EV.EFFECT_SPAWN, { id: 9, kind: 'jail', hostile: true, shape: { type: 'circle', x: 20, z: 20, r: 1.5 }, sec: 0.8, dur: 0 });
  bus.emit(EV.AFFIX, { monId: 2, affixId: 'mortar', what: 'mortarFire', x: 30, z: 21 });
  bus.emit(EV.AFFIX, { monId: 3, affixId: 'shielding', what: 'shieldWarn', x: 21, z: 25 });
  bus.emit(EV.AFFIX, { monId: 4, affixId: 'coldEnchanted', what: 'novaWarn', x: 19, z: 21 });
  for (const id of UNIQUE_WARNS) assert.equal(voicesOf(audio, id).length, 1, `${id}`);
  assertCaps(audio, 'warn flood');
});

test('챔피언 · 정예의 예고음은 더 크고(상태에서 등급을 읽는다) · 수호자는 더 크고 낮다', () => {
  const { bus, audio, ctx } = setup();
  const st = riftState();
  st.rift.mons = [
    { id: 11, typeId: 'ghoul', rank: 'normal' }, { id: 12, typeId: 'ghoul', rank: 'elite' }, { id: 13, typeId: 'boneGiant', rank: 'guardian' },
  ];
  audio.update(st, 0);
  const level = (id) => {
    ctx.advance(1);
    bus.emit(EV.MON_ACT, { id, typeId: st.rift.mons.find(m => m.id === id).typeId, act: 'windup', actId: 'a', telegraph: 'pose', x: 20, z: 20, facing: 0, dur: 0.5 });
    return audio._voices.filter(v => v.id === 'windup' && !v.dead).at(-1).level;
  };
  const normal = level(11), elite = level(12), guardian = level(13);
  assert.ok(Math.abs(elite / normal - MIX.actEliteGain) < 1e-9, `정예 ${elite / normal}`);
  assert.ok(Math.abs(guardian / normal - MIX.actGuardianGain) < 1e-9, `수호자 ${guardian / normal}`);
});

test('전설 · 세트 드랍은 드랍 폭발 속에서도 고유 종소리 · 골드 줍기는 짤랑', () => {
  const ring = (r) => Math.max(...r.L.map(L => (L.t ?? 0) + L.d));
  for (const id of ['dropLegendary', 'dropSet']) {
    assert.equal(SOUNDS[id].cat, 'jackpot');
    assert.ok(ring(SOUNDS[id]) >= 2, `${id} 울림 ${ring(SOUNDS[id])}초 — 종소리는 길게 남는다`);
  }
  const sigs = ['dropItem', 'dropMagic', 'dropRare', 'dropLegendary', 'dropSet'].map(id => signature(SOUNDS[id]));
  assert.equal(new Set(sigs).size, 5, '등급별 드랍음이 다르다');
  // 전설 = 비화성 분음(정수배가 아닌 배음) · 세트 = 화음
  const leg = SOUNDS.dropLegendary.L.filter(L => L.w === 'sine' && !L.t).map(L => L.f[0]);
  assert.ok(leg.some(f => Math.abs(f / leg[0] - 2.76) < 0.02), '전설 종 분음 2.76');

  const { bus, audio } = setup();
  audio.update(riftState(), 0);
  for (let i = 0; i < 30; i++) {
    const rarity = ['normal', 'magic', 'rare'][i % 3];
    bus.emit(EV.DROP_SPAWN, { id: 100 + i, kind: i % 4 ? 'item' : 'gold', rarity: i % 4 ? rarity : null, x: 20 + i % 6, z: 20, fromX: 20, fromZ: 20 });
  }
  bus.emit(EV.DROP_SPAWN, { id: 200, kind: 'item', rarity: 'legendary', x: 22, z: 20, fromX: 20, fromZ: 20 });
  bus.emit(EV.DROP_SPAWN, { id: 201, kind: 'item', rarity: 'set', x: 23, z: 20, fromX: 20, fromZ: 20 });
  assert.equal(voicesOf(audio, 'dropLegendary').length, 1);
  assert.equal(voicesOf(audio, 'dropSet').length, 1);
  assertCaps(audio, 'drop burst');

  bus.emit(EV.DROP_PICKED, { id: 100, kind: 'gold', amount: 30, itemId: null, rarity: null });
  const coins = voicesOf(audio, 'coins');
  assert.equal(coins.length, 1);
  const tinks = SOUNDS.coins.L.filter(L => L.w === 'sine' && L.f[0] >= 2000);
  assert.ok(tinks.length >= 4 && new Set(tinks.map(L => L.t ?? 0)).size >= 4, '높은 사인이 엇갈려 부딪힌다');
});

test('피해 종류마다 다른 타격 질감 · 치명타 · 큰 일격 · 템플릿(상태 캐시) · 지속 피해(dot)는 조용', () => {
  const ids = ['phys', 'fire', 'cold', 'lightning'].map(t => HIT_BY_TYPE[t]);
  assert.equal(new Set(ids).size, 4);
  assert.equal(new Set(ids.map(id => signature(SOUNDS[id]))).size, 4);

  const { bus, audio, ctx } = setup();
  const st = riftState();
  st.rift.mons = [{ id: 31, typeId: 'fallen', rank: 'normal' }, { id: 32, typeId: 'ghoul', rank: 'normal' }];
  audio.update(st, 0);
  const lv = (over) => {
    ctx.advance(1);
    bus.emit(EV.HIT, hit(over));
    return audio._voices.filter(v => !v.dead).at(-1).level;
  };
  const base = lv({ targetId: 32 });
  assert.ok(Math.abs(lv({ targetId: 32, crit: true }) / base - MIX.critGain) < 1e-9);
  assert.ok(Math.abs(lv({ targetId: 32, big: true }) / base - MIX.bigGain) < 1e-9);
  assert.ok(Math.abs(lv({ targetId: 31 }) / base - TEMPLATE_TONE.small.g) < 1e-9, '소형 인간형은 가볍게');
  assert.ok(audio._mon.has(31) && audio._mon.get(31).tpl === 'small', '템플릿 캐시');

  ctx.advance(1);
  const before = audio._count.played;
  bus.emit(EV.HIT, hit({ dot: true, type: 'fire' }));
  assert.equal(audio._count.played, before, '화상 틱은 소리를 내지 않는다');
  bus.emit(EV.MAP_LOADED, { mapId: 'x', kind: 'rift', tileset: 'crypt' });
  assert.equal(audio._mon.size, 0, '맵이 바뀌면 캐시를 비운다');
});

test('공간: 멀수록 작고(44m 밖의 낮은 우선순위는 생략) · 화면 오른쪽(월드 +X−Z)은 오른쪽으로 팬', () => {
  const { bus, audio, ctx } = setup();
  const st = riftState(40, 40);
  audio.update(st, 0);
  const lastVoice = () => audio._voices.filter(v => !v.dead).at(-1);
  const at = (x, z) => {
    ctx.advance(1);
    const n = audio._count.played;
    bus.emit(EV.HIT, hit({ x, z }));
    return audio._count.played > n ? lastVoice() : null;
  };
  const near = at(41, 40).level;
  const mid = at(40 + 20, 40).level;
  const far = at(40 + 31.9, 40).level;
  assert.ok(mid < near && far < mid, `${near} > ${mid} > ${far}`);
  assert.ok(far >= near * SPACE.farGain - 1e-9);
  assert.equal(at(40 + 50, 40), null, '먼 피격음은 생략');
  ctx.advance(1);
  bus.emit(EV.GAUGE_FULL, { x: 95, z: 40, sec: 2 });
  assert.equal(voicesOf(audio, 'gaugeFull').length, 1, '경보는 거리와 무관');

  const panOf = (v) => v.nodes.find(nd => nd.kind === 'panner')?.pan.value ?? 0;
  assert.ok(panOf(at(40 + 6, 40 - 6)) > 0, '화면 오른쪽 → 오른쪽 귀');
  assert.ok(panOf(at(40 - 6, 40 + 6)) < 0, '화면 왼쪽 → 왼쪽 귀');
  assert.ok(Math.abs(panOf(at(40 + 6, 40 + 6))) < 1e-9, '화면 위아래 방향은 가운데');
  assert.ok(Math.abs(panOf(at(40 + 60 * 0.7, 40 - 60 * 0.7) ?? { nodes: [] })) <= SPACE.panMax);
});

// ───────────────────────── 지속음 ─────────────────────────

test('지속음은 상태를 따라간다(이벤트를 놓쳐도): 회오리 · 귀환 시전 · 환경음(타일셋 표) · 낮은 생명 박동', () => {
  const { audio, ctx } = setup();
  const st = riftState();
  const step = (dt = 0.05) => { ctx.advance(dt); audio.update(st, dt); return audio.debugStats(); };
  assert.equal(step().loops.amb, TILESETS.find(t => t.id === 'crypt').ambience);
  assert.equal(audio.debugStats().loops.whirl, null);

  st.player.channel = { skillId: 'whirlwind', nextAt: 0, startedAt: 0 };
  assert.equal(step().loops.whirl, 'whirl');
  st.player.channel = null;
  assert.equal(step().loops.whirl, null);

  st.player.recall = { start: st.tick, end: st.tick + 45 };
  assert.equal(step().loops.recall, 'recall');
  st.player.recall = null;
  assert.equal(step().loops.recall, null);

  st.rift.tileset = 'cavern';
  let s = step();
  assert.equal(s.loops.amb, 'cavernLava');
  assert.ok(s.dying >= 1, '앞 환경음은 교차 페이드로 사라지는 중');
  s = step(MIX.ambFade + 0.1);
  st.scene = 'town';
  st.rift = null;
  assert.equal(step().loops.amb, 'townFire');

  // 낮은 생명 — 균열에서만 · 간격마다
  const st2 = riftState();
  st2.player.lowLife = true;
  const before = audio._count.played;
  for (let i = 0; i < 40; i++) { ctx.advance(0.05); audio.update(st2, 0.05); }
  const beats = audio._count.played - before;
  assert.ok(beats >= 2 && beats <= 3, `2초에 박동 ${beats}`);
  st2.player.dead = true;
  st2.player.channel = { skillId: 'whirlwind', nextAt: 0, startedAt: 0 };
  const b2 = audio._count.played;
  for (let i = 0; i < 40; i++) { ctx.advance(0.05); audio.update(st2, 0.05); }
  assert.equal(audio._count.played, b2, '쓰러져 있으면 박동 · 회오리 없음');
  assert.equal(audio.debugStats().loops.whirl, null);
});

test('장면 전환 · 사망 · 캐릭터 교체에서 회오리 · 귀환 시전이 남지 않는다 → 시간이 지나면 노드가 환경음만큼으로', () => {
  const { bus, audio, ctx } = setup();
  const st = riftState();
  audio.update(st, 0);
  st.player.channel = { skillId: 'whirlwind', nextAt: 0, startedAt: 0 };
  bus.emit(EV.CHANNEL, { skillId: 'whirlwind', on: true });
  bus.emit(EV.RECALL, { phase: 'start', sec: 1.5 });
  st.player.recall = { start: st.tick, end: st.tick + 45 };
  ctx.advance(0.1);
  audio.update(st, 0.1);
  let s = audio.debugStats();
  assert.deepEqual([s.loops.whirl, s.loops.recall, s.loops.amb], ['whirl', 'recall', 'cryptWind']);

  bus.emit(EV.SCENE_CHANGED, { from: 'rift', to: 'town', reason: 'recall' });
  s = audio.debugStats();
  assert.equal(s.loops.whirl, null, '장면 전환 즉시 회오리가 멎는다');
  assert.equal(s.loops.recall, null);
  const town = townState();
  for (let i = 0; i < 30; i++) { ctx.advance(0.1); audio.update(town, 0.1); }
  s = audio.debugStats();
  assert.deepEqual(s.loops, { whirl: null, recall: null, amb: 'townFire' });
  assert.equal(s.dying, 0);
  assert.equal(s.voices, 1, '환경음 루프 하나만 남는다');
  assert.equal(audio.stats().nodes, ctx.live, '연결된 노드 = 센 노드');
  const ambNodes = audio._loops.amb.nodes.length;
  assert.equal(audio.stats().nodes, 5 + ambNodes);
  for (const src of ctx.nodes.filter(n => n instanceof FakeSource && n.started && !n.ended && n.stopAt === Infinity)) {
    assert.ok(audio._loops.amb.srcs.includes(src), '멈추지 않은 소스는 환경음 것뿐');
  }

  // 사망 · 캐릭터 교체 · 화면 전환도 같다
  for (const [name, payload] of [[EV.PLAYER_DIED, { x: 0, z: 0, lives: 2, collapse: false, killerId: 1, killerName: null, killerTypeId: 'ghoul' }],
    [EV.CHAR_LOADED, { slot: 1, cls: 'mage', name: 'B', level: 1, isNew: false }], [EV.SCREEN_CHANGED, { from: 'play', to: 'title' }]]) {
    const r = riftState();
    r.player.channel = { skillId: 'whirlwind', nextAt: 0, startedAt: 0 };
    ctx.advance(0.05);
    audio.update(r, 0.05);
    assert.equal(audio.debugStats().loops.whirl, 'whirl');
    bus.emit(name, payload);
    assert.equal(audio.debugStats().loops.whirl, null, `${name} 뒤 회오리`);
  }
});

test('일시정지(메뉴 · 모달): 전투 지속음은 멎고 환경음은 줄고 UI · 거래음은 난다 → 풀리면 되돌아온다', () => {
  const { bus, audio, ctx } = setup();
  const st = riftState();
  st.player.channel = { skillId: 'whirlwind', nextAt: 0, startedAt: 0 };
  audio.update(st, 0);
  assert.equal(audio.debugStats().loops.whirl, 'whirl');

  bus.emit(EV.PAUSED, { on: true, reason: 'menu' });
  assert.equal(audio.debugStats().loops.whirl, null);
  ctx.advance(0.05);
  audio.update(st, 0.05);
  let s = audio.debugStats();
  assert.equal(s.loops.whirl, null, '상태에 채널이 남아 있어도 일시정지 동안은 멎어 있다');
  assert.equal(s.ambDuck, MIX.ambPauseDuck);
  assert.ok(Math.abs(audio._loops.amb.out.gain.value - LOOPS.cryptWind.g * MIX.ambPauseDuck) < 1e-9, '환경음이 줄었다');
  bus.emit(EV.PANEL_OPENED, { panel: 'pause', modal: true, depth: 1 });
  bus.emit(EV.TRADE, { shop: 'blacksmith', kind: 'buy', cost: 10, itemId: 'i1', rarity: 'magic' });
  assert.equal(voicesOf(audio, 'uiOpen').length, 1);
  assert.equal(voicesOf(audio, 'trade').length, 1, '모달(상점)에서도 거래음은 난다');

  bus.emit(EV.PAUSED, { on: false, reason: 'menu' });
  ctx.advance(0.05);
  audio.update(st, 0.05);
  s = audio.debugStats();
  assert.equal(s.loops.whirl, 'whirl');
  assert.equal(s.ambDuck, 1);
  assert.ok(Math.abs(audio._loops.amb.out.gain.value - LOOPS.cryptWind.g) < 1e-9);
});

test('탭 숨김(setPaused): 모든 소리를 바로 끊고 suspend · 이벤트 무시 → 돌아오면 resume 하고 지속음이 다시', () => {
  const { bus, audio, ctx } = setup();
  const st = riftState();
  st.player.channel = { skillId: 'whirlwind', nextAt: 0, startedAt: 0 };
  audio.update(st, 0);
  for (const [name, payload] of sampleEvents()) bus.emit(name, payload);
  assert.ok(audio.stats().voices > 5);

  audio.setPaused(true);
  assert.equal(ctx.state, 'suspended');
  assert.deepEqual(audio.stats(), { voices: 0, nodes: 5 });
  assert.equal(ctx.live, 5, '연결된 노드는 마스터 체인뿐');
  const played = audio._count.played;
  for (const [name, payload] of sampleEvents()) bus.emit(name, payload);
  ctx.advance(0.1);
  audio.update(st, 0.1);
  assert.equal(audio._count.played, played, '숨은 동안 새 소리 0');
  assert.deepEqual(audio.stats(), { voices: 0, nodes: 5 });

  audio.setPaused(false);
  assert.equal(ctx.state, 'running');
  ctx.advance(0.1);
  audio.update(st, 0.1);
  const s = audio.debugStats();
  assert.equal(s.loops.whirl, 'whirl');
  assert.equal(s.loops.amb, 'cryptWind');

  // 앱이 setPaused 를 부르지 않고 PAUSED{hidden}만 내도 멎는다 → 다음 PAUSED(menu)에서 풀리고 메뉴 일시정지로
  bus.emit(EV.PAUSED, { on: true, reason: 'hidden' });
  assert.equal(ctx.state, 'suspended');
  assert.deepEqual(audio.stats(), { voices: 0, nodes: 5 });
  bus.emit(EV.PAUSED, { on: true, reason: 'menu' });
  assert.equal(ctx.state, 'running');
  assert.equal(audio.debugStats().soft, true);
  // 앱이 setPaused(true) 한 뒤 PAUSED{hidden} → 앱의 setPaused(false)까지 멎어 있다
  audio.setPaused(true);
  bus.emit(EV.PAUSED, { on: true, reason: 'hidden' });
  bus.emit(EV.PAUSED, { on: true, reason: 'menu' });
  assert.equal(ctx.state, 'suspended', 'PAUSED 가 앱의 setPaused(true)를 풀지 않는다');
  audio.setPaused(false);
  assert.equal(ctx.state, 'running');
});

test('수호자 출현음은 균열에서만 — 부활 commit 플러시(GUARDIAN_APPEAR → SCENE_CHANGED town)에서는 나지 않는다', () => {
  const { bus, audio, ctx } = setup();
  const st = riftState();
  audio.update(st, 0);
  bus.emit(EV.GUARDIAN_APPEAR, { id: 1, typeId: 'boneGiant', x: 30, z: 20, name: ['a', 'b'] });
  bus.emit(EV.SCENE_CHANGED, { from: 'rift', to: 'town', reason: 'respawn' });
  ctx.advance(0.05);
  audio.update(townState(), 0.05);
  assert.equal(voicesOf(audio, 'guardianAppear').length, 0);

  bus.emit(EV.GUARDIAN_APPEAR, { id: 1, typeId: 'boneGiant', x: 30, z: 20, name: ['a', 'b'] });
  ctx.advance(0.05);
  audio.update(townState(), 0.05);
  assert.equal(voicesOf(audio, 'guardianAppear').length, 0, 'SCENE_CHANGED 없이도 state.scene 이 마을이면');

  bus.emit(EV.GUARDIAN_APPEAR, { id: 1, typeId: 'boneGiant', x: 30, z: 20, name: ['a', 'b'] });
  ctx.advance(0.05);
  audio.update(st, 0.05);
  assert.equal(voicesOf(audio, 'guardianAppear').length, 1, '균열이면 다음 프레임에');
});

// ───────────────────────── 볼륨 ─────────────────────────

test('볼륨: 마스터 · 효과 · 환경 · UI(효과 × MIX.ui) · 잘못된 값은 기본값/자르기 · 잠금 전 설정도 unlock 때 적용', () => {
  const { bus, audio } = setup();
  const o = audio._out;
  audio.applySettings({ ...DEFAULT_SETTINGS, volMaster: 0.5, volSfx: 0.25, volAmbient: 0 });
  assert.ok(Math.abs(o.master.gain.value - 0.5 * MIX.master) < 1e-9);
  assert.ok(Math.abs(o.sfx.gain.value - 0.25) < 1e-9);
  assert.ok(Math.abs(o.ui.gain.value - 0.25 * MIX.ui) < 1e-9);
  assert.equal(o.amb.gain.value, 0);

  bus.emit(EV.SETTINGS_CHANGED, { settings: { volMaster: NaN, volSfx: 'x', volAmbient: 2 } });
  assert.ok(Math.abs(o.master.gain.value - DEFAULT_SETTINGS.volMaster * MIX.master) < 1e-9);
  assert.ok(Math.abs(o.sfx.gain.value - DEFAULT_SETTINGS.volSfx) < 1e-9);
  assert.ok(Math.abs(o.amb.gain.value - MIX.amb) < 1e-9, '1 로 자른다');

  const settings = { ...DEFAULT_SETTINGS, volMaster: 0.1 };
  const b = new AudioEngine({ bus: new EventBus(), settings });
  settings.volAmbient = 0.2;   // app 은 같은 객체의 필드를 바꾼다(§11.1)
  b.unlock();
  assert.ok(Math.abs(b._out.master.gain.value - 0.1 * MIX.master) < 1e-9);
  assert.ok(Math.abs(b._out.amb.gain.value - 0.2 * MIX.amb) < 1e-9);
});

// ───────────────────────── 견고성 · 누수 ─────────────────────────

test('update 경계: null · 빈 상태 · 균열인데 rift 없음 · 큰 dt · NaN — 던지지 않는다', () => {
  const { audio, ctx } = setup();
  assert.doesNotThrow(() => audio.update(null, 0.016));
  assert.doesNotThrow(() => audio.update(/** @type {any} */ ({}), NaN));
  assert.doesNotThrow(() => audio.update(/** @type {any} */ ({ scene: 'rift', rift: null, player: { pos: { x: NaN, z: 1 } } }), 1e9));
  const st = riftState();
  st.player.recall = { start: 0, end: NaN };
  ctx.advance(10);
  assert.doesNotThrow(() => audio.update(st, 10));
  assert.equal(audio.debugStats().loops.recall, 'recall');
  assert.doesNotThrow(() => audio.update(/** @type {any} */ ({ scene: 'nowhere', player: null }), 0));
  assert.equal(audio.debugStats().loops.amb, null, '모르는 장면은 환경음 없음');
});

test('무작위 이벤트 5000개(시간 · 일시정지 · 상태가 섞인다): 상한 늘 지킴 · 예외 0 · 끝나면 노드가 환경음만큼으로(누수 0)', () => {
  const { bus, audio, ctx } = setup();
  let s32 = 0x1234567;
  const rnd = () => { s32 ^= s32 << 13; s32 ^= s32 >>> 17; s32 ^= s32 << 5; return (s32 >>> 0) / 4294967296; };
  const st = riftState();
  const evs = sampleEvents();
  let maxNodes = 0;
  for (let i = 0; i < 5000; i++) {
    const r = rnd();
    if (r < 0.04) {
      ctx.advance(rnd() * 0.3);
      st.player.channel = rnd() < 0.5 ? { skillId: 'whirlwind', nextAt: 0, startedAt: 0 } : null;
      st.player.recall = rnd() < 0.3 ? { start: st.tick, end: st.tick + 45 } : null;
      st.player.lowLife = rnd() < 0.3;
      st.player.dead = rnd() < 0.05;
      st.scene = rnd() < 0.8 ? 'rift' : 'town';
      st.rift.tileset = rnd() < 0.5 ? 'crypt' : 'cavern';
      audio.update(st, 0.05);
    } else if (r < 0.05) {
      bus.emit(EV.PAUSED, rnd() < 0.5 ? { on: true, reason: ['menu', 'modal', 'debug', 'hidden', 'blur'][Math.floor(rnd() * 5)] } : { on: false, reason: 'menu' });
    } else if (r < 0.055) {
      audio.setPaused(rnd() < 0.5);
    } else {
      ctx.advance(rnd() < 0.5 ? 0 : rnd() * 0.05);
      const [name, payload] = evs[Math.floor(rnd() * evs.length)];
      bus.emit(name, payload);
    }
    if (i % 25 === 0) {
      assertCaps(audio, `fuzz ${i}`);
      maxNodes = Math.max(maxNodes, audio.stats().nodes);
      assert.equal(audio.stats().nodes, ctx.live, `fuzz ${i}: 센 노드 = 연결된 노드`);
    }
  }
  audio.setPaused(false);
  bus.emit(EV.PAUSED, { on: false, reason: 'menu' });
  const town = townState();
  for (let i = 0; i < 60; i++) { ctx.advance(0.1); audio.update(town, 0.1); }
  const s = audio.debugStats();
  assert.equal(s.voices, 1, `남은 소리 ${JSON.stringify(s.byId)}`);
  assert.equal(s.loops.amb, 'townFire');
  assert.equal(s.nodes, 5 + audio._loops.amb.nodes.length);
  assert.equal(s.nodes, ctx.live);
  assert.ok(maxNodes < 1200, `최대 노드 ${maxNodes}`);
  assert.ok(s.played > 1000 && s.merged > 0 && s.stolen > 0 && s.dropped > 0, JSON.stringify(s));
  assert.equal(s.errors, 0, '짓기 예외 0(가짜 WebAudio 는 브라우저 규칙을 검사한다)');
});

test('브라우저가 소리를 짓다 예외를 내도: 이벤트 플러시로 올리지 않고(게임이 멈추지 않는다) · 반쯤 지은 노드는 끊고 · 센다', () => {
  const { bus, audio, ctx } = setup();
  const st = riftState();
  audio.update(st, 0);
  const base = audio.stats().nodes;
  assert.equal(base, ctx.live);
  const orig = ctx.createBiquadFilter;
  let n = 0;
  ctx.createBiquadFilter = function () {
    n += 1;
    if (n % 2 === 0) throw new Error('InvalidStateError: test');
    return orig.call(this);
  };
  const warn = console.warn;
  const warned = [];
  console.warn = (...a) => warned.push(a.join(' '));
  try {
    assert.doesNotThrow(() => {
      for (let i = 0; i < 20; i++) {
        ctx.advance(0.05);
        bus.emit(EV.HIT, hit({ type: 'fire' }));
        bus.emit(EV.DROP_SPAWN, { id: i, kind: 'item', rarity: 'rare', x: 20, z: 20, fromX: 20, fromZ: 20 });
        st.player.channel = i % 2 ? { skillId: 'whirlwind', nextAt: 0, startedAt: 0 } : null;
        audio.update(st, 0.05);
      }
    });
  } finally {
    console.warn = warn;
    ctx.createBiquadFilter = orig;
  }
  const s = audio.debugStats();
  assert.ok(s.errors > 0, '예외를 셌다');
  assert.equal(warned.length, 1, '알림은 한 번만');
  assert.equal(audio.stats().nodes, ctx.live, '반쯤 지은 노드가 남지 않는다');
  ctx.advance(5);
  audio.update(townState(), 5);
  ctx.advance(5);
  audio.update(townState(), 5);
  assert.equal(audio.stats().nodes, 5 + audio._loops.amb.nodes.length);
  assert.equal(audio.stats().nodes, ctx.live);
});

test('onended 만으로도 노드를 끊는다(update 가 돌지 않는 프레임 · 숨은 탭 직전)', () => {
  const { bus, audio, ctx } = setup();
  audio.update(riftState(), 0);
  const base = audio.stats().nodes;
  bus.emit(EV.LEVEL_UP, { level: 2, points: 1 });
  bus.emit(EV.HIT, hit());
  assert.ok(ctx.live > base);
  ctx.advance(5);           // onended 가 불린다(update 없음)
  assert.equal(ctx.live, base, 'onended 로 끊겼다');
  assert.equal(audio.stats().nodes, base);
});

test('dispose: 구독을 모두 풀고 컨텍스트를 닫는다 · 그 뒤 호출 · 이벤트는 무시', () => {
  const bus = new EventBus();
  globalThis.AudioContext = FakeAudioContext;
  const audio = new AudioEngine({ bus, settings: { ...DEFAULT_SETTINGS } });
  assert.ok(bus.count() > 20);
  audio.unlock();
  const ctx = FakeAudioContext.instances.at(-1);
  audio.update(riftState(), 0);
  bus.emit(EV.HIT, hit());
  audio.dispose();
  assert.equal(bus.count(), 0, '리스너가 남았다');
  assert.equal(ctx.calls.close, 1);
  assert.equal(ctx.live, 0);
  assert.deepEqual(audio.stats(), { voices: 0, nodes: 0 });
  assert.doesNotThrow(() => {
    for (const [name, payload] of sampleEvents()) bus.emit(name, payload);
    audio.unlock();
    audio.update(riftState(), 0);
    audio.setPaused(true);
    audio.applySettings({});
    audio.dispose();
  });
  assert.equal(FakeAudioContext.instances.length, 1, 'dispose 뒤 unlock 은 새로 만들지 않는다');
});

// ───────────────────────── 소리 표 완결성 ─────────────────────────

// 피드백 1: 기본 공격 cleave(가르기) · 회전 베기 spinSlash 동작과 연속 회전 효과 spinEcho — 옛 강타(meleeBasic) · 지면 강타(cone) · 여진(stomp)이
// 내던 소리를 잇는다(소리 없이 조용해지는 회귀를 막는다). sim 이 더 만들지 않는 옛 열(meleeBasic · cone · 효과 stomp)은 표에 없다.
test('피드백 1: 가르기는 휘두름 · 회전 베기는 한 바퀴 휘두름(옛 휘두름과 다른 음색) · 연속 회전은 판정 때 잔상 휘두름 — 실제 이벤트로', () => {
  assert.equal(START_BY_BEHAVIOR.cleave, 'swing', '가르기 시작 = 옛 강타와 같은 휘두름');
  assert.equal(HIT_BY_BEHAVIOR.cleave, null, '가르기 판정 틱은 HIT(맞은 적마다 타격 — 30ms 합치기)가 맡는다');
  assert.ok(START_BY_BEHAVIOR.spinSlash && SOUNDS[START_BY_BEHAVIOR.spinSlash], '회전 베기 시작음');
  assert.ok('spinSlash' in HIT_BY_BEHAVIOR, '회전 베기 판정 열');
  assert.ok(EFFECT_BOOM.spinEcho && SOUNDS[EFFECT_BOOM.spinEcho], '연속 회전 판정음');
  const sigs = ['swing', START_BY_BEHAVIOR.spinSlash, EFFECT_BOOM.spinEcho].map(id => signature(SOUNDS[id]));
  assert.equal(new Set(sigs).size, 3, '가르기 · 회전 베기 · 연속 회전이 서로 다르게 들린다');
  for (const k of ['meleeBasic', 'cone']) assert.ok(!(k in START_BY_BEHAVIOR) && !(k in HIT_BY_BEHAVIOR), `죽은 열 ${k}`);
  assert.ok(!('stomp' in EFFECT_BOOM), '죽은 효과 열 stomp');

  const { bus, audio, ctx } = setup();
  audio.update(riftState(), 0);
  const x = 20, z = 20;
  ctx.advance(1);
  bus.emit(EV.ACTION_START, { skillId: 'bash', act: 'attack', x, z, facing: 0, tx: x, tz: z + 1, dur: 0.71, hitIn: 0.33 });
  assert.equal(voicesOf(audio, 'swing').length, 1, '가르기(bash) 시작 → 휘두름');
  ctx.advance(1);
  bus.emit(EV.ACTION_START, { skillId: 'groundStomp', act: 'attack', x, z, facing: 0, tx: x, tz: z + 1, dur: 0.6, hitIn: 0.3 });
  assert.equal(voicesOf(audio, START_BY_BEHAVIOR.spinSlash).length, 1, '회전 베기(groundStomp) 시작 → 회전 휘두름');
  ctx.advance(1);
  const shape = { type: 'circle', x, z, r: 2.5 };
  bus.emit(EV.EFFECT_SPAWN, { id: 80, kind: 'spinEcho', hostile: false, shape, sec: 0.5, dur: 0 });
  bus.emit(EV.EFFECT_HIT, { id: 80, kind: 'spinEcho', hostile: false, shape, hitPlayer: false, targets: 3 });
  assert.equal(voicesOf(audio, EFFECT_BOOM.spinEcho).length, 1, '연속 회전 판정 → 잔상 휘두름');
  assert.equal(audio.debugStats().errors, 0);
});

test('소리 표: 모든 레시피가 유효하고 · 모든 연결 표가 있는 소리를 가리키고 · 데이터의 모든 행(동작 · 템플릿 · 예고 · 환경음)을 덮는다', () => {
  const OSC = ['sine', 'square', 'sawtooth', 'triangle'];
  const FLT = ['lowpass', 'highpass', 'bandpass'];
  const BUSES = ['sfx', 'ui', 'amb'];
  for (const [id, r] of Object.entries(SOUNDS)) {
    assert.ok(CATS[r.cat], `${id}.cat`);
    assert.ok(BUSES.includes(r.bus), `${id}.bus`);
    assert.ok(r.g > 0 && r.g <= 1, `${id}.g`);
    assert.ok(Array.isArray(r.L) && r.L.length > 0, `${id}.L`);
    for (const L of r.L) {
      assert.ok(L.w === 'noise' || OSC.includes(L.w), `${id} w ${L.w}`);
      assert.ok(L.d > 0 && L.d <= 4, `${id} d`);
      assert.ok(L.g > 0 && L.g <= 1, `${id} g`);
      assert.ok((L.t ?? 0) >= 0 && (L.a ?? 0.005) < L.d, `${id} t/a`);
      if (L.w !== 'noise') assert.ok(L.f[0] > 0 && (L.f[1] == null || L.f[1] > 0), `${id} f`);
      if (L.flt) assert.ok(FLT.includes(L.flt[0]) && L.flt[1] > 0 && (L.flt[2] == null || L.flt[2] > 0), `${id} flt`);
      if (L.vib) assert.ok(L.vib[0] > 0 && L.vib[1] > 0 && (L.w !== 'noise' || L.flt), `${id} vib`);
    }
  }
  for (const [id, r] of Object.entries(LOOPS)) {
    assert.ok(BUSES.includes(r.bus) && r.g > 0 && r.L.length > 0, id);
    for (const L of r.L) {
      assert.ok(['noise', 'crackle', 'bubble', ...OSC].includes(L.w), `${id} w`);
      if (OSC.includes(L.w)) assert.ok(L.f[0] > 0, `${id} f`);
      if (L.lfo) assert.ok(L.flt || OSC.includes(L.w), `${id} lfo target`);
    }
  }
  const refs = [
    ...Object.values(HIT_BY_TYPE), ...Object.values(START_BY_BEHAVIOR), ...Object.values(HIT_BY_BEHAVIOR), ...Object.values(ACT_BY_TELEGRAPH), ACT_SWELL,
    ...Object.values(DIE_BY_TEMPLATE), ...Object.values(AFFIX_SOUND), ...Object.values(EFFECT_WARN), EFFECT_WARN_DEFAULT, ...Object.values(EFFECT_BOOM),
    EFFECT_BOOM_HOSTILE_DEFAULT, ...Object.values(SHOT_BY_VISUAL), SHOT_DEFAULT, ...Object.values(DROP_BY_RARITY), ...Object.values(DROP_BY_KIND),
    ...Object.values(PICK_BY_KIND), ...Object.values(TRADE_SOUND), TRADE_DEFAULT, ...Object.values(SPAWN_SOUND), ...Object.values(INTERACT_SOUND),
    'swing', 'portal', 'potion', 'fail', 'heartbeat', 'death', 'guardianAppear', 'guardianDie', 'eliteDie', 'eliteAlarm', 'wakeGrowl', 'monSwing',
    'freeze', 'iceBreak', 'stun', 'immune', 'blockMon', 'playerHit', 'block', 'shieldAbsorb', 'shieldBreak', 'rooted', 'chilled', 'globe', 'heal',
    'buffEnd', 'recallFizzle', 'respawn', 'portalOpen', 'riftOpen', 'gaugeFull', 'fanfare', 'collapse', 'levelUp', 'unlock', 'equip', 'unequip',
    'skillLearn', 'uiClick', 'uiOpen', 'uiClose', 'broken', 'projWall',
  ];
  for (const id of refs) if (id !== null) assert.ok(SOUNDS[id], `없는 소리 ${id}`);

  // 데이터 덮기
  const behaviors = new Set([...SKILL_NODES.filter(n => n.skill).map(n => n.skill.behavior), ...Object.values(BASIC_SKILLS).map(s => s.behavior)]);
  for (const b of behaviors) assert.ok(b in START_BY_BEHAVIOR && b in HIT_BY_BEHAVIOR, `스킬 동작 ${b}`);
  for (const d of [...MONSTERS, ...GUARDIANS]) {
    assert.ok(TEMPLATE_TONE[d.template] && DIE_BY_TEMPLATE[d.template], `템플릿 ${d.template}`);
    for (const a of d.attacks) assert.ok(ACT_BY_TELEGRAPH[a.telegraph], `${d.id}.${a.id} telegraph ${a.telegraph}`);
  }
  for (const t of TILESETS) assert.ok(LOOPS[t.ambience] && LOOPS[t.ambience].bus === 'amb', `환경음 ${t.ambience}`);
  // 계약 §9.8 · §4.2 의 ID
  for (const k of ['spinEcho', 'quakeWave', 'shockwave', 'meteor', 'vortex', 'afterimageBlast', 'corpseBlast', 'iceBurst', 'chainArc', 'chargeLine', 'bloaterBurst',
    'poisonPool', 'fireDeath', 'coldNova', 'jail', 'plague', 'mortar', 'slam', 'boneSpikes', 'emberRain', 'guardianSpawn']) assert.ok(k in EFFECT_BOOM, `효과 ${k}`);
  for (const k of ['chargeLine', 'bloaterBurst', 'poisonPool', 'fireDeath', 'coldNova', 'jail', 'plague', 'mortar', 'slam', 'boneSpikes', 'emberRain', 'guardianSpawn']) {
    assert.ok(k in EFFECT_WARN, `적대 효과 예고 ${k}`);
  }
  for (const k of ['magicBolt', 'fireball', 'fireballSplit', 'iceShard', 'arrow', 'shamanFire', 'spark', 'ashBolt']) assert.ok(SHOT_BY_VISUAL[k], `투사체 ${k}`);
  for (const k of ['teleportOut', 'teleportIn', 'shieldWarn', 'shieldOn', 'shieldOff', 'split', 'sparks', 'novaWarn', 'jailWarn', 'plagueWarn', 'mortarFire', 'fireArm', 'heal']) {
    assert.ok(AFFIX_SOUND[k], `속성 연출 ${k}`);
  }
  for (const k of ['normal', 'magic', 'rare', 'legendary', 'set']) assert.ok(DROP_BY_RARITY[k]);
  for (const k of ['gold', 'potion', 'globe', 'material']) assert.ok(DROP_BY_KIND[k]);
  for (const k of ['item', 'gold', 'potion', 'globe', 'material']) assert.ok(k in PICK_BY_KIND);
  for (const k of ['buy', 'sell', 'sellMany', 'buyback', 'repair', 'salvage', 'salvageMany', 'craft', 'gamble', 'reroll', 'potion', 'scroll', 'free', 'reset']) {
    assert.ok(TRADE_SOUND[k], `거래 ${k}`);
  }
  for (const k of ['resource', 'cooldown', 'noTarget', 'rooted', 'town', 'empty']) assert.ok(FAIL_PITCH[k] > 0);
  for (const k of ['nest', 'revive', 'split', 'summon', 'guardian', 'debug']) assert.ok(k in SPAWN_SOUND);
  for (const k of ['npc', 'stash', 'riftStone', 'townPortal', 'riftPortal']) assert.ok(k in INTERACT_SOUND);
});

test('외부 에셋 0: src/audio 에 파일 · 네트워크 · 디코딩 · 동적 import 가 없다', () => {
  const dir = join(HERE, '..', 'src', 'audio');
  for (const f of readdirSync(dir)) {
    // 주석(JSDoc 의 import('../types.js') 타입 참조 포함)은 뺀다
    const src = readFileSync(join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const bad of ['fetch(', 'decodeAudioData', 'new Audio(', 'XMLHttpRequest', '.mp3', '.ogg', '.wav', 'import(']) {
      assert.ok(!src.includes(bad), `${f}: ${bad}`);
    }
  }
});

test('모든 소리를 극단 음높이 · 크기로 · 모든 지속음을 켜고 끄기 — 브라우저 규칙 위반 0', () => {
  const { audio, ctx } = setup();
  audio.update(riftState(), 0);
  for (const pm of [0.3, 1, 3.5]) {
    for (const id of Object.keys(SOUNDS)) {
      ctx.advance(0.05);
      assert.doesNotThrow(() => audio._play(id, 20, 20, 2, pm), `${id} × ${pm}`);
    }
  }
  for (const id of Object.keys(LOOPS)) {
    assert.doesNotThrow(() => {
      audio._startLoop('whirl', id, 1.5, 0.1, 0.5);
      ctx.advance(0.2);
      audio._stopLoop('whirl', 0.1);
      ctx.advance(0.5);
      audio.update(riftState(), 0.5);
    }, id);
  }
  assert.equal(audio.debugStats().errors, 0, audio._lastError ?? '');
  for (const L of Object.values(audio._buf)) {
    const d = L.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    assert.ok(peak > 0 && peak <= 1, '합성 버퍼는 [-1, 1] · 비어 있지 않다');
  }
});

// ───────────────────────── 실제 sim 과 함께 ─────────────────────────

test('실제 GameSim(전사 · 회오리 · 떼 · 정예 · 귀환 → 마을): 상한 · 예외 0 · 회오리 루프 = player.channel · 마을에 오면 지속음 정리', () => {
  globalThis.AudioContext = FakeAudioContext;
  const bus = new EventBus();
  const audio = new AudioEngine({ bus, settings: { ...DEFAULT_SETTINGS } });
  audio.unlock();
  const ctx = /** @type {FakeAudioContext} */ (audio.ctx);
  const counts = {};
  bus.onAny((name) => { counts[name] = (counts[name] ?? 0) + 1; });
  const sim = new GameSim({ bus, seed: 11, devSession: true });
  sim.start();
  assert.equal(sim.newCharacter({ slot: 0, cls: 'warrior', name: 'A' }).ok, true);
  sim.debugSetLevel(12);
  for (let i = 0; i < 5; i++) sim.learnSkill('groundStomp');
  assert.equal(sim.learnSkill('whirlwind').ok, true);
  sim.setSkillBar(0, 'whirlwind');
  assert.equal(sim.openRift(1).ok, true);
  assert.equal(sim.commitTravel().ok, true);
  sim.debugSetInvincible(true);
  sim.debugSpawnPack('ghoul', 'normal');
  sim.debugSpawnPack('fallen', 'champion', ['fast']);
  sim.debugSpawnPack('skeletonArcher', 'elite', ['coldEnchanted', 'shielding']);
  const p = sim.state.player;
  let mismatch = 0, whirlTicks = 0, recallSeen = false;
  const run = (n, inputOf) => {
    for (let t = 0; t < n; t++) {
      if (sim.state.pendingTravel) sim.commitTravel();
      sim.step(inputOf(t));
      p.resource = p.resourceMax;
      ctx.advance(DT);
      audio.update(sim.state, DT);
      const s = assertCaps(audio, `tick ${sim.state.tick}`);
      if (sim.state.scene === 'rift' && !p.dead && !!p.channel !== !!s.loops.whirl) mismatch += 1;
      if (s.loops.whirl) whirlTicks += 1;
      if (s.loops.recall) recallSeen = true;
    }
  };
  run(900, (t) => {
    const hold = t % 200 < 150;
    const m = sim.state.rift?.mons.find(x => !x.dead && !x.gone);
    const c = m ? { x: m.pos.x, z: m.pos.z } : { x: p.pos.x + 2, z: p.pos.z + 2 };
    return makeInput({ cursor: c, slot: [hold, false, false, false, false], slotDown: [hold && t % 200 === 0, false, false, false, false] });
  });
  assert.equal(mismatch, 0, '회오리 루프가 player.channel 과 어긋난 틱');
  assert.ok(whirlTicks > 300, `회오리 루프 틱 ${whirlTicks}`);
  assert.ok((counts[EV.HIT] ?? 0) > 50 && (counts[EV.CHANNEL] ?? 0) >= 2, JSON.stringify({ hit: counts[EV.HIT], ch: counts[EV.CHANNEL] }));

  // 귀환 → 마을
  run(1, () => makeInput({ recallDown: true }));
  run(80, () => makeInput({}));
  assert.equal(sim.state.scene, 'town', '귀환했다');
  assert.ok(recallSeen, '귀환 시전 루프');
  for (let i = 0; i < 30; i++) { ctx.advance(0.1); audio.update(sim.state, 0.1); }
  const s = audio.debugStats();
  assert.deepEqual(s.loops, { whirl: null, recall: null, amb: 'townFire' });
  assert.equal(s.voices, 1);
  assert.equal(s.nodes, ctx.live);

  // 마법사 퍼즈(무작위 입력) — 투사체 · 화염구 · 노바가 섞인 실제 이벤트
  const sim2 = new GameSim({ bus, seed: 12, devSession: true });
  sim2.start();
  sim2.newCharacter({ slot: 1, cls: 'mage', name: 'B' });
  sim2.debugSetLevel(8);
  for (const id of ['fireball', 'fireball', 'frostNova', 'chainLightning', 'teleport']) sim2.learnSkill(id);
  sim2.openRift(1);
  sim2.commitTravel();
  sim2.debugSetInvincible(true);
  sim2.debugSpawnPack('fallen', 'elite', ['shielding', 'vampiric']);
  const inp = randomInputs(5);
  for (let t = 0; t < 600; t++) {
    if (sim2.state.pendingTravel) sim2.commitTravel();
    sim2.step(inp(t, sim2.state));
    sim2.state.player.resource = sim2.state.player.resourceMax;
    ctx.advance(DT);
    audio.update(sim2.state, DT);
    assertCaps(audio, `mage ${t}`);
  }
  assert.equal(audio.stats().nodes, ctx.live);
  assert.equal(audio.debugStats().errors, 0);
  audio.dispose();
});
