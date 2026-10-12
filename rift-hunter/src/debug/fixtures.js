// OWNER: P0 — 계약 §11.9 (W0 완성 · 이후 고치지 않는다 — 결함은 NOTES-P#)
// 고정 상태 15개(§11.9 표) — FIXTURES[id] = (seed) → {state, map, riftMap}. sim 없이 떼 · 정예 · 수호자 · 전리품 · 패널 상태를 세운다(?fixture=<id> · __game.loadFixture).
// 모든 상태는 §3 모양 그대로(fixtures.test.js — spawnMonster · spawnEffect · spawnProjectile · spawnDrops · createCharacter · makeItem 이 만드는 키와 같다) ·
// 엔티티는 맵의 걷기 가능 칸 위 · ID 유일 · 유한수. map = 지금 장면의 맵, riftMap = 열린 균열의 맵(없으면 null).
// 마을 맵은 데이터로 만든 것(townMapFromData)이다 — app 이 화면에 띄울 때 sim 의 buildTownMap() 으로 바꿔 넘겨도 같은 자리에 선다.
// debug 가 sim 에서 가져오는 것은 W0 에 완성인 것뿐이다(§2.1).

import { EQUIP_SLOTS } from '../core/constants.js';
import { hash32 } from '../core/hash.js';
import { yawOf } from '../core/math.js';
import { circle, cone, line } from '../core/shapes.js';
import { ticks } from '../core/time.js';
import { affixesFor, getBase, getMonDef } from '../data/index.js';
import { GROWTH } from '../data/rift.js';
import { PRESETS } from '../data/presets.js';
import { TOWN } from '../data/town.js';
import { makeItem } from '../sim/loot/rollItem.js';
import { computeStats } from '../sim/loot/stats.js';
import { monsterStats } from '../sim/monsters/spawn.js';
import { createCharacter } from '../sim/progression/character.js';
import { createGameState, createMonStatus, createRiftState } from '../sim/state.js';
import { isWalkableR, nearestWalkable } from '../sim/world/nav.js';
import { arenaAscii, mapFromAscii, townMapFromData } from './fixtureMap.js';

/** @typedef {import('../types.js').GameState} GameState */
/** @typedef {import('../types.js').MapData} MapData */
/** @typedef {import('../types.js').MonsterState} MonsterState */
/** @typedef {import('../types.js').Item} Item */
/** @typedef {{state:GameState, map:MapData, riftMap:MapData|null}} Fixture */

const T0 = 1200;   // 고정 상태의 state.tick(시각 필드가 0 아래로 내려가지 않게)
const PI = Math.PI;

// ───────────────────────── 만들기 도우미 ─────────────────────────

/** 걷기 가능한 자리(반지름 r)로 — 안 되면 가장 가까운 걷기 가능 점 */
function place(map, x, z, r = 0.5) {
  if (isWalkableR(map, x, z, r)) return { x, z };
  for (let k = 1; k <= 12; k++) {
    for (let a = 0; a < 8; a++) {
      const px = x + Math.sin((a / 8) * PI * 2) * k * 0.5, pz = z + Math.cos((a / 8) * PI * 2) * k * 0.5;
      if (isWalkableR(map, px, pz, r)) return { x: px, z: pz };
    }
  }
  return nearestWalkable(map, x, z, 6) ?? { x, z };
}

/**
 * 판 하나의 뼈대 — 상태 · 캐릭터 · 플레이어(시트 반영) · (균열이면) RiftState
 * @param {number} seed
 * @param {{cls?:'warrior'|'mage', level?:number, scene?:'town'|'rift', riftLevel?:number, map:MapData, riftMap?:MapData|null}} opts
 */
function base(seed, { cls = 'warrior', level = 1, scene = 'rift', riftLevel = 1, map, riftMap = null }) {
  const state = createGameState({ seed, devSession: true });
  state.tick = T0;
  const newId = () => 'i' + state.account.nextItemId++;
  const char = createCharacter({ slot: 0, cls, name: cls === 'warrior' ? 'Fixture Warrior' : 'Fixture Mage', newId, seed: hash32(seed, 0) });
  char.level = level;
  char.riftUnlocked = Math.max(1, riftLevel + 1);
  char.lastRiftLevel = riftLevel;
  char.runs = Math.max(1, riftLevel);
  char.playSec = 600 + level * 300;
  state.char = char;
  state.account.chars[0] = { name: char.name, cls: char.cls, level: char.level, riftUnlocked: char.riftUnlocked };
  state.account.lastSlot = 0;
  state.scene = scene;
  const rmap = scene === 'rift' ? map : riftMap;
  if (rmap) {
    state.rift = createRiftState({ level: riftLevel, seed: hash32(seed, riftLevel), tileset: rmap.tileset, mapId: rmap.id, map: rmap, tick: T0 - 900 });
    state.rift.ticksIn = 900;
    state.rift.explored.fill(1);
  }
  const fx = { state, char, newId, map, rmap, seed };
  syncPlayer(fx);
  const sp = scene === 'rift' ? map.spawn : TOWN.arrive;
  setPlayerPos(fx, sp.x, sp.z, sp.facing);
  return fx;
}

/** 시트 → 플레이어 생명 · 자원 */
function syncPlayer(fx, { lifeFrac = 1, resourceFrac = null } = {}) {
  const s = computeStats(fx.char);
  const p = fx.state.player;
  p.lifeMax = s.lifeMax;
  p.life = s.lifeMax * lifeFrac;
  p.resourceMax = s.resourceMax;
  p.resource = s.resourceMax * (resourceFrac ?? (fx.char.cls === 'mage' ? 1 : 0.45));
  p.lowLife = lifeFrac <= 0.35;
  return s;
}

function setPlayerPos(fx, x, z, facing = 0) {
  const p = fx.state.player;
  const q = place(fx.map, x, z, p.r);
  p.pos = { ...q };
  p.prevPos = { ...q };
  p.facing = facing;
}

/** 아이템(makeItem · 옵션 · 플래그) */
function item(fx, baseId, { tier = 0, ilvl = 1, rarity = 'normal', affixes = [], legendaryId = null, setPieceId = null, dur = null, flags = {}, name = null } = {}) {
  const it = makeItem({ baseId, tier, ilvl, rarity: /** @type {any} */ (rarity), id: fx.newId(), affixes, legendaryId, setPieceId });
  if (dur !== null) it.dur = dur;
  Object.assign(it.flags, flags);
  if (name) it.name = name;
  return it;
}

/** 팩 상태 하나 */
function pack(fx, kind, x, z, awake = true) {
  const p = { id: fx.state.nextId++, kind, memberIds: [], awake, nextHazardAt: -1, fled: false, anchor: { x, z } };
  fx.state.rift.packs.push(p);
  return p;
}

/**
 * 몬스터 하나(spawnMonster 와 같은 꼴) — rift.mons 에 넣고 팩에 잇는다
 * @returns {MonsterState}
 */
function mon(fx, typeId, x, z, { rank = 'normal', affixes = [], awake = true, facing = null, pk = null, name = null, level = null } = {}) {
  const st = fx.state;
  const lv = level ?? st.rift.level;
  const s = monsterStats(typeId, /** @type {any} */ (rank), lv, affixes);
  const q = place(fx.rmap, x, z, Math.min(s.r, 0.9));
  const pp = st.player.pos;
  /** @type {MonsterState} */
  const m = {
    id: st.nextId++,
    typeId,
    rank: /** @type {any} */ (rank),
    packId: pk ? pk.id : -1,
    level: lv,
    affixes: [...affixes],
    name,
    pos: { ...q },
    prevPos: { ...q },
    facing: facing ?? yawOf(pp.x - q.x, pp.z - q.z),
    vel: { x: 0, z: 0 },
    r: s.r,
    height: s.height,
    scale: s.scale,
    hp: s.hpMax,
    hpMax: s.hpMax,
    dmg: s.dmg,
    speed: s.speed,
    res: /** @type {any} */ (s.res),
    awake,
    targeting: awake,
    act: 'idle',
    actId: null,
    actStart: 0,
    actHit: 0,
    actEnd: 0,
    aim: null,
    aimLocked: false,
    readyAt: {},
    st: createMonStatus(),
    knock: null,
    dead: false,
    deadAt: -1,
    gone: false,
    launch: null,
    ax: {},
    flags: { noXp: false, noDrops: false, noGauge: false, revived: false },
    lastHit: null,
    sleepAt: -1,
  };
  st.rift.mons.push(m);
  if (pk) pk.memberIds.push(m.id);
  return m;
}

/** 공격 단계(예비 · 판정 · 후딜) — ago = 예비를 시작한 지 몇 틱 */
function attack(fx, m, atkId, phase = 'windup', ago = 6) {
  const tick = fx.state.tick;
  const atk = getMonDef(m.typeId).attacks.find(a => a.id === atkId);
  const wu = Math.max(1, ticks(atk.windup)), rc = ticks(atk.recover);
  if (phase === 'windup') {
    m.act = atk.kind === 'cast' ? 'cast' : atk.kind === 'explode' ? 'swell' : 'windup';
    m.actStart = tick - Math.min(ago, wu - 1);
  } else if (phase === 'strike') {
    m.act = 'strike';
    m.actStart = tick - wu;
  } else {
    m.act = 'recover';
    m.actStart = tick - wu - Math.min(ago, Math.max(0, rc - 1));
  }
  m.actId = atkId;
  m.actHit = m.actStart + wu;
  m.actEnd = m.actHit + rc;
  m.readyAt[atkId] = m.actStart + ticks(atk.cd);
  return m;
}

function stunned(fx, m, sec = 1) { m.act = 'stunned'; m.st.stunUntil = fx.state.tick + ticks(sec); return m; }
function frozen(fx, m, sec = 1) { m.act = 'frozen'; m.st.freezeUntil = fx.state.tick + ticks(sec); m.st.freezeImmuneUntil = m.st.freezeUntil + ticks(2.5); return m; }
function flinch(fx, m) { m.act = 'flinch'; m.st.flinchUntil = fx.state.tick + 4; m.st.flinchImmuneUntil = m.st.flinchUntil + ticks(1.2); return m; }
function moving(fx, m) {
  const p = fx.state.player.pos;
  const d = Math.hypot(p.x - m.pos.x, p.z - m.pos.z) || 1;
  m.act = 'move';
  m.vel = { x: ((p.x - m.pos.x) / d) * m.speed, z: ((p.z - m.pos.z) / d) * m.speed };
  m.prevPos = { x: m.pos.x - m.vel.x / 30, z: m.pos.z - m.vel.z / 30 };
  return m;
}
function dead(fx, m, { ago = 20, launch = null } = {}) {
  m.dead = true;
  m.hp = 0;
  m.act = 'dead';
  m.deadAt = fx.state.tick - ago;
  m.awake = false;
  m.targeting = false;
  m.launch = launch;
  m.lastHit = { by: 'player', skillId: 'bash', noProcs: false, frozen: false };
  return m;
}

/** 바닥 효과(spawnEffect 와 같은 꼴) — ago = 예고를 시작한 지 몇 틱 · 시간 인자는 초 */
function effect(fx, { kind, owner = 'mon', srcId = -1, packId = -1, hostile = true, shape, delay = 1, dur = 0, tick = 0, spec = null, tickSpec = null, from = null, cancelOnSrcDeath = false, ago = 6, follow = null }) {
  const st = fx.state;
  const start = st.tick - ago;
  const hitAt = start + ticks(delay);
  const tickT = ticks(tick);
  const e = {
    id: st.nextId++,
    kind, owner, srcId, packId, cancelOnSrcDeath, hostile,
    shape: { ...shape },
    start, hitAt, end: hitAt + Math.max(1, ticks(dur)),
    tickT,
    nextTickAt: tickT > 0 ? (st.tick < hitAt + tickT ? hitAt + tickT : hitAt + tickT * (Math.floor((st.tick - hitAt) / tickT) + 1)) : -1,
    resolved: st.tick >= hitAt,
    spec, tickSpec,
    from: from ? { ...from } : null,
  };
  if (follow === 'player') e.follow = 'player';   // 피드백 1 — 따라가는 효과에만 키를 둔다(sim spawnEffect 와 같은 꼴)
  if (e.end <= st.tick) e.end = st.tick + 1;
  st.rift.effects.push(e);
  return e;
}

/** 몬스터 → 플레이어 적중 정의 */
function monSpec(m, mul, type = 'phys', via = 'hazard', extra = {}) {
  return { srcId: m.id, via, raw: m.dmg * mul, type, level: m.level, ...extra };
}
/** 플레이어 → 몬스터 적중 정의 */
function playerSpec(fx, skillId, coef, type, tags, extra = {}) {
  const p = fx.state.player;
  return { skillId, coef, type, tags, actionId: fx.state.nextId++, srcX: p.pos.x, srcZ: p.pos.z, ...extra };
}

/** 투사체(spawnProjectile 와 같은 꼴) */
function proj(fx, { visual, owner, srcId, x, z, toX, toZ, speed, r, lifeSec = 1.5, ago = 3, pierce = 0, bounce = false, spec = {}, explode = null }) {
  const st = fx.state;
  const d = Math.hypot(toX - x, toZ - z) || 1;
  const vx = ((toX - x) / d) * speed, vz = ((toZ - z) / d) * speed;
  const q = place(fx.rmap, x + (vx / 30) * ago, z + (vz / 30) * ago, r);
  const p = {
    id: st.nextId++, visual, owner, srcId,
    pos: { ...q }, prevPos: { x: q.x - vx / 30, z: q.z - vz / 30 }, vel: { x: vx, z: vz },
    r, born: st.tick - ago, until: st.tick - ago + Math.max(ago + 1, ticks(lifeSec)),
    pierce, hitIds: [], bounce, spec, explode,
  };
  st.rift.projs.push(p);
  return p;
}

/** 바닥 드랍(spawnDrops 와 같은 꼴) */
function drop(fx, kind, x, z, { item: it = null, amount = 1, mat = null, ago = 30 } = {}) {
  const st = fx.state;
  const q = place(fx.rmap, x, z, 0.3);
  const d = { id: st.nextId++, kind, pos: { ...q }, from: { x: q.x - 0.8, z: q.z - 0.5 }, born: st.tick - ago, item: it, amount, mat, rarity: it ? it.rarity : null, gone: false };
  st.rift.drops.push(d);
  if (it) st.rift.stats.drops[it.rarity] += 1;
  return d;
}

/** 원 위 자리(플레이어 중심 · 각 a(rad) · 거리 d) */
function around(fx, a, d) {
  const p = fx.state.player.pos;
  return [p.x + Math.sin(a) * d, p.z + Math.cos(a) * d];
}

/** 프리셋 순서의 앞 n 점을 찍는다(랭크) */
function presetRanks(cls, idx, n) {
  /** @type {Record<string, number>} */
  const ranks = {};
  for (const id of PRESETS[cls][idx].order.slice(0, n)) ranks[id] = (ranks[id] ?? 0) + 1;
  return ranks;
}

/** 장착 10칸을 채운다(ilvl · 단계) */
function equipAll(fx, { ilvl, tier, cls }) {
  const ch = fx.char;
  const weapon = cls === 'warrior' ? 'sword' : 'wand';
  const off = cls === 'warrior' ? 'shield' : 'orb';
  const main = cls === 'warrior' ? 'str' : 'int';
  ch.equip.mainHand = item(fx, weapon, { tier, ilvl, rarity: 'rare', affixes: [{ id: 'weaponDmg', tier: 3, value: 28 }, { id: main, tier: 3, value: 20 }, { id: 'critDamage', tier: 2, value: 16 }], name: ['rare.a.3', 'rare.b.9'] });
  ch.equip.offhand = item(fx, off, { tier, ilvl, rarity: 'magic', affixes: [{ id: 'vit', tier: 2, value: 10 }] });
  ch.equip.helm = item(fx, 'helm', { tier, ilvl, rarity: 'magic', affixes: [{ id: 'armor', tier: 2, value: 14 }] });
  ch.equip.chest = item(fx, 'chest', { tier, ilvl, rarity: 'rare', affixes: [{ id: 'vit', tier: 3, value: 16 }, { id: 'allRes', tier: 2, value: 6 }, { id: 'lifePct', tier: 2, value: 6 }], name: ['rare.a.8', 'rare.b.11'] });
  ch.equip.gloves = item(fx, 'gloves', { tier, ilvl, rarity: 'normal' });
  ch.equip.boots = item(fx, 'boots', { tier, ilvl, rarity: 'magic', affixes: [{ id: 'moveSpeed', tier: 2, value: 7 }] });
  ch.equip.belt = item(fx, 'belt', { tier, ilvl, rarity: 'normal' });
  ch.equip.amulet = item(fx, 'amulet', { tier, ilvl, rarity: 'magic', affixes: [{ id: main, tier: 2, value: 12 }] });
  ch.equip.ring1 = item(fx, 'ring', { tier, ilvl, rarity: 'magic', affixes: [{ id: 'critChance', tier: 2, value: 2.5 }] });
  ch.equip.ring2 = item(fx, 'ring', { tier, ilvl, rarity: 'normal' });
}

/** 장착 · 가방 · 보관함의 아이템을 골고루(전 등급 · 옵션은 그 부위가 허용하는 것) */
function variedItem(fx, k, { ilvl = 10, cls = 'warrior' } = {}) {
  const slots = ['sword', 'helm', 'chest', 'gloves', 'boots', 'belt', 'amulet', 'ring', 'greatsword', 'shield', 'axe', 'mace'];
  const mageSlots = ['wand', 'helm', 'chest', 'gloves', 'boots', 'belt', 'amulet', 'ring', 'staff', 'orb', 'wand', 'helm'];
  const baseId = (cls === 'warrior' ? slots : mageSlots)[k % 12];
  const rarities = ['normal', 'magic', 'magic', 'rare', 'normal', 'magic', 'rare', 'magic'];
  const rarity = rarities[k % rarities.length];
  const lv = ilvl + (k % 3);
  const pool = affixesFor(getBase(baseId).slot).filter(a => a.main === undefined || a.main === (cls === 'warrior' ? 'str' : 'int'));
  const n = rarity === 'normal' ? 0 : rarity === 'magic' ? 1 : 3;
  const affixes = [];
  for (let i = 0; affixes.length < n && i < pool.length; i++) {
    const def = pool[(k * 5 + i * 7) % pool.length];
    if (affixes.some(a => a.id === def.id)) continue;
    const raw = def.tiers[0][0] * (def.scale === 'pow' ? GROWTH.item ** (lv - 1) : 1);
    const a = { id: def.id, tier: 1, value: Math.round(raw * 10 ** def.decimals) / 10 ** def.decimals };
    if (def.param) a.param = cls === 'warrior' ? 'groundStomp' : 'fireball';
    affixes.push(a);
  }
  return item(fx, baseId, { tier: (k % 3 === 2 && ilvl >= 10) ? 1 : 0, ilvl: lv, rarity, affixes, name: rarity === 'rare' ? ['rare.a.' + (k % 24), 'rare.b.' + ((k * 5) % 24)] : null });
}

const arena = (id, tileset = 'crypt') => mapFromAscii(arenaAscii(), { id: 'fixture:' + id, kind: 'rift', tileset });

// ───────────────────────── 고정 상태 15 ─────────────────────────

/** 마을 · 전사 레벨 12 · 열린 균열(포털 켜짐) · 복귀 안내 */
function fxTown(seed) {
  const map = townMapFromData();
  const riftMap = arena('town-rift');
  const fx = base(seed, { cls: 'warrior', level: 12, scene: 'town', riftLevel: 5, map, riftMap });
  equipAll(fx, { ilvl: 10, tier: 1, cls: 'warrior' });
  fx.char.gold = 1840;
  fx.char.runs = 6;
  syncPlayer(fx);
  const st = fx.state;
  st.rift.leftAt = st.tick - 90;
  st.rift.returnPos = { ...riftMap.spawn };
  st.rift.lives = 2;
  st.rift.deaths = 1;
  st.town.portalOpen = true;
  st.town.returnPrompt = true;
  // 균열 안에 남아 있는 잠든 팩(돌아가면 그대로 있다)
  const pk = pack(fx, 'normal', 50, 20, false);
  for (let i = 0; i < 6; i++) mon(fx, 'ghoul', 50 + Math.sin(i) * 3, 20 + Math.cos(i) * 3, { awake: false, pk });
  return { state: st, map, riftMap };
}

/** 지하 묘지 · 전사 가르기(bash) 판정 직후 · 일반 8종 + 새끼 40마리(걷기 · 예비 · 판정 · 경직 · 기절 · 빙결 · 사망 · 날아가는 시체) */
function fxRiftSwarm(seed) {
  const map = arena('riftSwarm');
  const fx = base(seed, { cls: 'warrior', level: 8, scene: 'rift', riftLevel: 4, map });
  const st = fx.state;
  const p = st.player;
  p.facing = -PI / 2;
  p.act = 'attack';
  p.actSkill = 'bash';
  p.actStart = st.tick - 7;
  p.actHit = st.tick - 1;
  p.actEnd = st.tick + 7;
  p.actId = st.nextId++;
  p.combatUntil = st.tick + 90;
  p.resource = 46;
  const ring = (k, n, d0, d1) => around(fx, -PI / 2 + ((k / n) * PI * 1.5) - PI * 0.25, d0 + ((k * 7) % 5) / 4 * (d1 - d0));
  const pkG = pack(fx, 'normal', p.pos.x - 6, p.pos.z, true);
  const ghouls = [];
  for (let k = 0; k < 10; k++) {
    const [x, z] = ring(k, 10, 1.6, 6);
    ghouls.push(mon(fx, 'ghoul', x, z, { pk: pkG }));
  }
  // 가르기를 맞은 첫 구울(대상) — 정면 1.5m
  const [tx, tz] = around(fx, -PI / 2, 1.5);
  ghouls[0].pos = place(map, tx, tz, ghouls[0].r);
  ghouls[0].prevPos = { ...ghouls[0].pos };
  flinch(fx, ghouls[0]);
  ghouls[0].hp = ghouls[0].hpMax * 0.55;
  ghouls[0].lastHit = { by: 'player', skillId: 'bash', noProcs: false, frozen: false };
  p.targetId = ghouls[0].id;
  p.hover = { kind: 'monster', id: ghouls[0].id, src: 'pick' };
  attack(fx, ghouls[1], 'claw', 'windup', 8);
  attack(fx, ghouls[2], 'claw', 'windup', 14);
  attack(fx, ghouls[3], 'claw', 'strike');
  attack(fx, ghouls[4], 'claw', 'recover', 5);
  stunned(fx, ghouls[5], 0.8);
  frozen(fx, ghouls[6], 1.2);
  dead(fx, ghouls[7], { ago: 40 });
  dead(fx, ghouls[8], { ago: 3, launch: { x: -6.5, z: 2.1 } });
  moving(fx, ghouls[9]);

  const pkF = pack(fx, 'normal', p.pos.x + 4, p.pos.z - 7, true);
  for (let k = 0; k < 6; k++) {
    const [x, z] = around(fx, PI * 0.85 + k * 0.22, 7 + (k % 3));
    const m = mon(fx, 'fallen', x, z, { pk: pkF });
    if (k < 3) moving(fx, m);
    else if (k === 3) attack(fx, m, 'jab', 'windup', 5);
    else if (k === 4) { m.act = 'flee'; m.targeting = false; m.facing += PI; }
    else dead(fx, m, { ago: 60 });
  }
  const [sx, sz] = around(fx, PI * 0.95, 10);
  const sh1 = mon(fx, 'fallenShaman', sx, sz, { pk: pkF });
  attack(fx, sh1, 'revive', 'windup', 20);
  sh1.act = 'channel';
  sh1.aim = { ...st.rift.mons.find(m => m.typeId === 'fallen' && m.dead).pos };
  const [sx2, sz2] = around(fx, PI * 0.7, 9.5);
  attack(fx, mon(fx, 'fallenShaman', sx2, sz2, { pk: pkF }), 'shamanFire', 'windup', 10);

  const pkS = pack(fx, 'normal', p.pos.x, p.pos.z - 9, true);
  for (let k = 0; k < 4; k++) {
    const [x, z] = around(fx, PI + (k - 1.5) * 0.35, 9);
    const m = mon(fx, 'skeletonArcher', x, z, { pk: pkS });
    if (k === 0) { attack(fx, m, 'arrow', 'windup', 10); m.aim = { ...p.pos }; }
    else if (k === 1) { attack(fx, m, 'arrow', 'windup', 16); m.aim = { ...p.pos }; m.aimLocked = true; }
    else if (k === 2) attack(fx, m, 'arrow', 'recover', 4);
    else moving(fx, m);
  }
  for (let k = 0; k < 4; k++) {
    const [x, z] = around(fx, PI + (k - 1.5) * 0.3, 4.5);
    const m = mon(fx, 'shieldSkeleton', x, z, { pk: pkS });
    if (k === 0) attack(fx, m, 'shieldBash', 'windup', 8);
    else if (k === 1) attack(fx, m, 'shieldBash', 'recover', 6);
    else if (k === 2) stunned(fx, m, 1);
    else moving(fx, m);
  }
  const pkC = pack(fx, 'normal', p.pos.x - 8, p.pos.z - 4, true);
  const [cx1, cz1] = around(fx, -PI * 0.6, 8);
  const ch1 = mon(fx, 'charger', cx1, cz1, { pk: pkC });
  attack(fx, ch1, 'charge', 'windup', 12);
  const dch = Math.hypot(p.pos.x - ch1.pos.x, p.pos.z - ch1.pos.z);
  const len = Math.min(13, dch + 2);
  ch1.aim = { x: ch1.pos.x + Math.sin(ch1.facing) * len, z: ch1.pos.z + Math.cos(ch1.facing) * len };
  ch1.aimLocked = true;
  effect(fx, { kind: 'chargeLine', srcId: ch1.id, packId: pkC.id, shape: line(ch1.pos.x, ch1.pos.z, ch1.facing, len, ch1.r * 2), delay: 0.9, spec: null, cancelOnSrcDeath: true, ago: 12 });
  const [cx2, cz2] = around(fx, -PI * 0.75, 6);
  const ch2 = mon(fx, 'charger', cx2, cz2, { pk: pkC });
  attack(fx, ch2, 'charge', 'strike');
  ch2.act = 'charge';
  ch2.aimLocked = true;
  ch2.aim = { ...p.pos };

  const pkB = pack(fx, 'normal', p.pos.x + 7, p.pos.z + 2, true);
  const [bx, bz] = around(fx, PI * 0.25, 3.2);
  const bl1 = mon(fx, 'bloater', bx, bz, { pk: pkB });
  attack(fx, bl1, 'burst', 'windup', 15);
  effect(fx, { kind: 'bloaterBurst', srcId: bl1.id, packId: pkB.id, shape: circle(bl1.pos.x, bl1.pos.z, 2.8), delay: 1.0, spec: monSpec(bl1, 2.5, 'phys', 'explode'), cancelOnSrcDeath: true, ago: 15 });
  moving(fx, mon(fx, 'bloater', ...around(fx, PI * 0.4, 7), { pk: pkB }));
  const bl3 = dead(fx, mon(fx, 'bloater', ...around(fx, PI * 0.1, 6.5), { pk: pkB }), { ago: 25 });
  effect(fx, { kind: 'poisonPool', srcId: bl3.id, packId: pkB.id, shape: circle(bl3.pos.x, bl3.pos.z, 1.6), delay: 0, dur: 3, tick: 0.5, spec: null, tickSpec: monSpec(bl3, 0.3 * 0.5), ago: 25 });

  const pkN = pack(fx, 'normal', p.pos.x - 3, p.pos.z + 9, true);
  const nest = mon(fx, 'boneNest', ...around(fx, -PI * 0.1, 9.5), { pk: pkN });
  attack(fx, nest, 'spawn', 'windup', 8);
  for (let k = 0; k < 5; k++) {
    const m = mon(fx, 'boneling', ...around(fx, -PI * 0.1 + (k - 2) * 0.25, 6 + (k % 2)), { rank: 'spawn', pk: pkN });
    if (k < 3) moving(fx, m);
    else if (k === 3) attack(fx, m, 'jab', 'windup', 4);
    else dead(fx, m, { ago: 10 });
  }
  for (let k = 0; k < 3; k++) {
    const m = mon(fx, 'ashling', ...around(fx, -PI * 0.35 + k * 0.3, 3 + k), { rank: 'spawn', pk: pkN });
    if (k < 2) moving(fx, m);
    else attack(fx, m, 'claw', 'windup', 5);
  }
  // 날아오는 화살 · 화염탄
  const a0 = st.rift.mons.find(m => m.typeId === 'skeletonArcher' && m.act === 'recover');
  proj(fx, { visual: 'arrow', owner: 'mon', srcId: a0.id, x: a0.pos.x, z: a0.pos.z, toX: p.pos.x, toZ: p.pos.z, speed: 16, r: 0.2, lifeSec: 1.2, ago: 8, spec: monSpec(a0, 1, 'phys', 'projectile') });
  proj(fx, { visual: 'shamanFire', owner: 'mon', srcId: sh1.id, x: sh1.pos.x, z: sh1.pos.z, toX: p.pos.x + 1, toZ: p.pos.z, speed: 9, r: 0.35, lifeSec: 1.6, ago: 10, spec: monSpec(sh1, 1, 'fire', 'projectile') });
  st.meter.targeting = st.rift.mons.filter(m => m.targeting && !m.dead).length;
  st.rift.stats.maxTargeting = st.meter.targeting;
  return { state: st, map, riftMap: map };
}

/** 잿빛 동굴 · 챔피언 팩(파랑 · 속성 2) + 정예(노랑 · 속성 4) + 하수인 4 · 대상 프레임 hover */
function fxRiftElites(seed) {
  const map = arena('riftElites', 'cavern');
  const fx = base(seed, { cls: 'warrior', level: 20, scene: 'rift', riftLevel: 15, map });
  equipAll(fx, { ilvl: 14, tier: 1, cls: 'warrior' });
  syncPlayer(fx);
  const st = fx.state;
  const p = st.player;
  const champAff = ['fast', 'fireEnchanted'];
  const pkC = pack(fx, 'champion', p.pos.x - 7, p.pos.z - 4, true);
  for (let k = 0; k < 3; k++) {
    const m = mon(fx, 'skeletonArcher', ...around(fx, -PI * 0.65 + k * 0.3, 8), { rank: 'champion', affixes: champAff, pk: pkC });
    if (k === 0) { attack(fx, m, 'arrow', 'windup', 9); m.aim = { ...p.pos }; } else moving(fx, m);
  }
  const eliteAff = ['fast', 'vampiric', 'coldEnchanted', 'jailer'];
  const pkE = pack(fx, 'elite', p.pos.x + 4, p.pos.z - 5, true);
  const elite = mon(fx, 'ghoul', ...around(fx, PI * 0.75, 4.2), { rank: 'elite', affixes: eliteAff, pk: pkE, name: ['elite.a.3', 'elite.b.5'] });
  attack(fx, elite, 'claw', 'windup', 6);
  elite.hp = elite.hpMax * 0.7;
  elite.ax.coldEnchanted = { nextAt: st.tick + 60 };
  elite.ax.jailer = { nextAt: st.tick + 150 };
  const minionAff = eliteAff.filter(a => a !== 'jailer');
  for (let k = 0; k < 4; k++) {
    const m = mon(fx, 'ghoul', ...around(fx, PI * 0.75 + (k - 1.5) * 0.45, 6), { rank: 'minion', affixes: minionAff, pk: pkE });
    if (k % 2) moving(fx, m); else attack(fx, m, 'claw', 'windup', 3 + k);
  }
  effect(fx, { kind: 'coldNova', srcId: elite.id, packId: pkE.id, shape: circle(elite.pos.x, elite.pos.z, 4.0), delay: 1.3, spec: monSpec(elite, 0.8, 'cold', 'hazard', { onHit: { slowPct: 0.4, chillSec: 2.0 }, noAffix: true }), ago: 14 });
  p.hover = { kind: 'monster', id: elite.id, src: 'pick' };
  p.targetId = elite.id;
  p.act = 'idle';
  return { state: st, map, riftMap: map };
}

/** 정예 12마리가 줄지어 각 속성 하나 + 그 효과 */
function fxRiftAffixes(seed) {
  const map = arena('riftAffixes');
  const fx = base(seed, { cls: 'warrior', level: 20, scene: 'rift', riftLevel: 12, map });
  equipAll(fx, { ilvl: 12, tier: 1, cls: 'warrior' });
  syncPlayer(fx);
  const st = fx.state;
  const p = st.player;
  const ROW = [
    ['fast', 'ghoul'], ['tough', 'shieldSkeleton'], ['fireEnchanted', 'ghoul'], ['coldEnchanted', 'ghoul'],
    ['vampiric', 'fallen'], ['shielding', 'ghoul'], ['lightningEnchanted', 'ghoul'], ['teleporter', 'ghoul'],
    ['jailer', 'ghoul'], ['splitter', 'charger'], ['plague', 'ghoul'], ['mortar', 'skeletonArcher'],
  ];
  // 화면 가로(오른쪽 = (1, −1)/√2)로 한 줄 · 플레이어보다 화면 위(= (−1, −1)/√2)로 6m(§0.2 카메라)
  const S = Math.SQRT1_2;
  ROW.forEach(([aff, typeId], k) => {
    const off = -14.3 + 2.6 * k;
    const x = p.pos.x - 6 * S + off * S, z0 = p.pos.z - 6 * S - off * S;
    const pk = pack(fx, 'elite', x, z0, true);
    const m = mon(fx, typeId, x, z0, { rank: 'elite', affixes: [aff], pk, name: ['elite.a.' + k, 'elite.b.' + ((k * 3) % 16)], facing: PI / 4 });
    const tick = st.tick;
    switch (aff) {
      case 'fast': moving(fx, m); break;
      case 'tough': attack(fx, m, 'shieldBash', 'windup', 6); break;
      case 'fireEnchanted':
        dead(fx, m, { ago: 12 });
        effect(fx, { kind: 'fireDeath', srcId: m.id, packId: pk.id, shape: circle(m.pos.x, m.pos.z, 3.0), delay: 1.0, spec: monSpec(m, 1.2, 'fire', 'hazard', { noAffix: true }), ago: 12 });
        break;
      case 'coldEnchanted':
        effect(fx, { kind: 'coldNova', srcId: m.id, packId: pk.id, shape: circle(m.pos.x, m.pos.z, 4.0), delay: 1.3, spec: monSpec(m, 0.8, 'cold', 'hazard', { onHit: { slowPct: 0.4, chillSec: 2.0 }, noAffix: true }), ago: 20 });
        m.ax.coldEnchanted = { nextAt: tick + 200 };
        break;
      case 'vampiric': attack(fx, m, 'jab', 'recover', 3); m.hp = m.hpMax * 0.6; break;
      case 'shielding': m.st.invulnUntil = tick + 60; m.ax.shielding = { warnUntil: -1, nextAt: tick + 210, offUntil: tick + 60 }; break;
      case 'lightningEnchanted':
        for (let s = 0; s < 3; s++) {
          const a = s * (PI * 2 / 3) + 0.4;
          proj(fx, { visual: 'spark', owner: 'mon', srcId: m.id, x: m.pos.x, z: m.pos.z, toX: m.pos.x + Math.sin(a), toZ: m.pos.z + Math.cos(a), speed: 6, r: 0.35, lifeSec: 2.0, ago: 6, bounce: true, spec: monSpec(m, 0.5, 'lightning', 'projectile', { noAffix: true }) });
        }
        m.ax.lightningEnchanted = { icdUntil: tick + 9 };
        break;
      case 'teleporter':
        m.act = 'vanish'; m.actStart = tick - 3; m.actHit = tick - 3; m.actEnd = tick + 9; m.st.invulnUntil = tick + 9;
        m.ax.teleporter = { readyAt: tick + 120, marked: false };
        break;
      case 'jailer':
        effect(fx, { kind: 'jail', srcId: m.id, packId: pk.id, shape: circle(p.pos.x, p.pos.z, 1.2), delay: 0.8, spec: monSpec(m, 0, 'phys', 'hazard', { onHit: { rootSec: 1.5 } }), ago: 10 });
        m.ax.jailer = { nextAt: tick + 200 };
        break;
      case 'splitter': moving(fx, m); break;
      case 'plague': {
        const [px, pz] = around(fx, PI * 0.5, 4);
        effect(fx, { kind: 'plague', srcId: m.id, packId: pk.id, shape: circle(px, pz, 2.0), delay: 1.0, dur: 5, tick: 0.5, spec: null, tickSpec: monSpec(m, 0.25 * 0.5, 'phys', 'hazard'), ago: 60 });
        m.ax.plague = { nextAt: tick + 120 };
        break;
      }
      case 'mortar': {
        attack(fx, m, 'arrow', 'recover', 2);
        const targets = [[p.pos.x, p.pos.z], [p.pos.x + 1.6, p.pos.z + 1.1], [p.pos.x - 1.4, p.pos.z + 1.5]];
        for (const [tx, tz] of targets) {
          effect(fx, { kind: 'mortar', srcId: m.id, packId: pk.id, shape: circle(tx, tz, 1.5), delay: 1.2, spec: monSpec(m, 0.9, 'phys', 'hazard'), from: { ...m.pos }, ago: 18 });
        }
        m.ax.mortar = { nextAt: tick + 150 };
        break;
      }
      default: break;
    }
  });
  return { state: st, map, riftMap: map };
}

/** 뼈 거인 대지 분쇄 예고 중 · 수호자 바 */
function fxRiftGuardian(seed) {
  const map = arena('riftGuardian');
  const fx = base(seed, { cls: 'warrior', level: 10, scene: 'rift', riftLevel: 5, map });
  equipAll(fx, { ilvl: 5, tier: 0, cls: 'warrior' });
  syncPlayer(fx);
  const st = fx.state;
  const p = st.player;
  st.rift.phase = 'guardian';
  st.rift.gauge = 100;
  const pk = pack(fx, 'guardian', p.pos.x, p.pos.z - 5, true);
  const g = mon(fx, 'boneGiant', p.pos.x - 1, p.pos.z - 5, { rank: 'guardian', affixes: ['fast', 'vampiric', 'coldEnchanted'], pk });
  g.hp = g.hpMax * 0.62;
  attack(fx, g, 'slam', 'windup', 18);
  effect(fx, { kind: 'slam', srcId: g.id, packId: pk.id, shape: cone(g.pos.x, g.pos.z, 6.5, g.facing, (100 * PI) / 180), delay: 1.2, spec: monSpec(g, 2.5, 'phys', 'hazard'), cancelOnSrcDeath: true, ago: 18 });
  g.readyAt.spikes = st.tick + 120;
  st.rift.guardianId = g.id;
  st.rift.guardianType = 'boneGiant';
  p.hover = { kind: 'monster', id: g.id, src: 'pick' };
  p.targetId = g.id;
  return { state: st, map, riftMap: map };
}

/** 잿빛 마녀 잿불 비 예고 + 하수인 */
function fxRiftWitch(seed) {
  const map = arena('riftWitch', 'cavern');
  const fx = base(seed, { cls: 'mage', level: 12, scene: 'rift', riftLevel: 6, map });
  equipAll(fx, { ilvl: 6, tier: 0, cls: 'mage' });
  syncPlayer(fx);
  const st = fx.state;
  const p = st.player;
  st.rift.phase = 'guardian';
  st.rift.gauge = 100;
  const pk = pack(fx, 'guardian', p.pos.x + 6, p.pos.z - 6, true);
  const w = mon(fx, 'ashWitch', p.pos.x + 5.5, p.pos.z - 5.5, { rank: 'guardian', affixes: ['lightningEnchanted', 'vampiric', 'fast'], pk });
  attack(fx, w, 'emberRain', 'windup', 12);
  const spots = [[0, 0], [0, 3], [3, 0], [0, -3], [-3, 0]];
  for (const [dx, dz] of spots) {
    effect(fx, { kind: 'emberRain', srcId: w.id, packId: pk.id, shape: circle(p.pos.x + dx, p.pos.z + dz, 1.8), delay: 1.2, spec: monSpec(w, 1.8, 'fire', 'hazard'), from: { ...w.pos }, ago: 12 });
  }
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * PI * 2;
    const m = mon(fx, 'ashling', w.pos.x + Math.sin(a) * 2, w.pos.z + Math.cos(a) * 2, { rank: 'spawn', pk });
    moving(fx, m);
  }
  st.rift.guardianId = w.id;
  st.rift.guardianType = 'ashWitch';
  return { state: st, map, riftMap: map };
}

/** 전사 회오리 채널 중 · 지진 파동 · 연속 회전 대기(회전 베기 0.5초 뒤 플레이어를 따라가는 원 — 피드백 1) · 전투 함성 버프(도약은 같은 순간에 둘 수 없어 행동은 회오리) */
function fxRiftWarrior(seed) {
  const map = arena('riftWarrior');
  const fx = base(seed, { cls: 'warrior', level: 20, scene: 'rift', riftLevel: 10, map });
  equipAll(fx, { ilvl: 10, tier: 1, cls: 'warrior' });
  fx.char.skills.ranks = { whirlwind: 4, groundStomp: 3, earthquake: 3, aftershock: 1, warCry: 2, leap: 2, charge: 2, bloodthirst: 2 };
  fx.char.skills.bar = ['whirlwind', 'earthquake', 'groundStomp', 'warCry', 'leap'];
  syncPlayer(fx, { resourceFrac: 0.72 });
  const st = fx.state;
  const p = st.player;
  p.act = 'channel';
  p.actSkill = 'whirlwind';
  p.actStart = st.tick - 30;
  p.actHit = st.tick - 30;
  p.actEnd = st.tick + 9;
  p.actId = st.nextId++;
  p.channel = { skillId: 'whirlwind', nextAt: st.tick + 4, startedAt: st.tick - 30 };
  p.buffs = [{ id: 'warCry', until: st.tick + 150, value: 0.52 }];
  p.readyAt = { earthquake: st.tick + 180, warCry: st.tick + 300, leap: st.tick + 60 };
  p.combatUntil = st.tick + 90;
  const [qx, qz] = around(fx, PI * 0.8, 5);
  const waveSpec = playerSpec(fx, 'earthquake', 1.34, 'phys', ['aoe']);
  effect(fx, { kind: 'quakeWave', owner: 'player', srcId: 0, hostile: false, shape: circle(qx, qz, 6.0), delay: 0.4, spec: waveSpec, ago: 10 });
  effect(fx, { kind: 'quakeWave', owner: 'player', srcId: 0, hostile: false, shape: circle(qx, qz, 6.0), delay: 0.9, spec: waveSpec, ago: 10 });
  effect(fx, { kind: 'quakeWave', owner: 'player', srcId: 0, hostile: false, shape: circle(qx, qz, 6.0), delay: 1.4, spec: waveSpec, ago: 10 });
  // 피드백 1: 옛 지면 강타 원뿔(stomp · r 4.0 · 120°) → 연속 회전(spinEcho · 원 r 2.5 · 0.5초 뒤 · follow 'player') — 대기 중(판정 7틱 전)
  effect(fx, { kind: 'spinEcho', owner: 'player', srcId: 0, hostile: false, shape: circle(p.pos.x, p.pos.z, 2.5), delay: 0.5, spec: playerSpec(fx, 'groundStomp', 0.6 * 1.38, 'phys', ['aoe']), ago: 8, follow: 'player' });
  const pk = pack(fx, 'normal', p.pos.x, p.pos.z, true);
  for (let k = 0; k < 10; k++) {
    const m = mon(fx, k < 6 ? 'ghoul' : 'fallen', ...around(fx, k * 0.6, 2.2 + (k % 4)), { pk });
    if (k < 3) stunned(fx, m, 0.9);
    else if (k < 7) moving(fx, m);
    else attack(fx, m, getMonDef(m.typeId).attacks[0].id, 'windup', 4);
  }
  return { state: st, map, riftMap: map };
}

/** 마법사 화염구 · 메테오 예고 · 서리 노바 · 연쇄 번개 꺾은선 · 마력 보호막 · 순간이동 직후 */
function fxRiftMage(seed) {
  const map = arena('riftMage');
  const fx = base(seed, { cls: 'mage', level: 20, scene: 'rift', riftLevel: 10, map });
  equipAll(fx, { ilvl: 10, tier: 1, cls: 'mage' });
  fx.char.skills.ranks = presetRanks('mage', 0, 19);
  fx.char.skills.bar = ['fireball', 'frostNova', 'meteor', 'teleport', 'energyShield'];
  const s = syncPlayer(fx, { resourceFrac: 0.6 });
  const st = fx.state;
  const p = st.player;
  p.act = 'cast';
  p.actSkill = 'frostNova';
  p.actStart = st.tick - 7;
  p.actHit = st.tick;
  p.actEnd = st.tick + 6;
  p.actId = st.nextId++;
  p.buffs = [{ id: 'energyShield', until: st.tick + 150, value: s.lifeMax * 0.38 }];
  p.shield = s.lifeMax * 0.25;
  p.readyAt = { teleport: st.tick + 70, frostNova: st.tick + 120, meteor: st.tick + 55, energyShield: st.tick + 380 };
  const pk = pack(fx, 'normal', p.pos.x - 6, p.pos.z - 2, true);
  const ms = [];
  for (let k = 0; k < 10; k++) {
    const m = mon(fx, 'ghoul', ...around(fx, -PI * 0.4 + k * 0.35, k < 5 ? 3.5 + (k % 2) : 8 + (k % 3)), { pk });
    ms.push(m);
    if (k < 3) { m.st.chill = 60; m.st.chillDecayAt = st.tick + 90; moving(fx, m); }
    else if (k < 5) frozen(fx, m, 1.4);
    else if (k < 7) { m.st.burn = { dps: 4.2, until: st.tick + 75, nextAt: st.tick + 8 }; moving(fx, m); }
    else if (k === 7) { m.st.shockUntil = st.tick + 80; }
    else moving(fx, m);
  }
  const tgt = ms[8];
  proj(fx, { visual: 'fireball', owner: 'player', srcId: 0, x: p.pos.x, z: p.pos.z, toX: tgt.pos.x, toZ: tgt.pos.z, speed: 18, r: 0.35, lifeSec: 16 / 18, ago: 6,
    spec: playerSpec(fx, 'fireball', 2.1, 'fire', ['projectile', 'aoe']), explode: { r: 2.5, spec: playerSpec(fx, 'fireball', 2.1, 'fire', ['projectile', 'aoe']), visual: 'fireball' } });
  proj(fx, { visual: 'magicBolt', owner: 'player', srcId: 0, x: p.pos.x, z: p.pos.z, toX: ms[9].pos.x, toZ: ms[9].pos.z, speed: 22, r: 0.25, lifeSec: 15 / 22, ago: 4, spec: playerSpec(fx, 'magicBolt', 1, 'lightning', ['projectile']) });
  const [mx, mz] = around(fx, -PI * 0.15, 7);
  effect(fx, { kind: 'meteor', owner: 'player', srcId: 0, hostile: false, shape: circle(mx, mz, 3.5), delay: 1.2, dur: 3, tick: 0.5, from: { x: mx - 3, z: mz - 3 },
    spec: playerSpec(fx, 'meteor', 4.8, 'fire', ['aoe', 'dot']), tickSpec: playerSpec(fx, 'meteor', 0.47 * 0.5, 'fire', ['aoe', 'dot']), ago: 15 });
  const chain = [ms[5], ms[6], ms[7]].map(m => ({ x: m.pos.x, z: m.pos.z }));
  effect(fx, { kind: 'chainArc', owner: 'player', srcId: 0, hostile: false, shape: { type: 'poly', x: p.pos.x, z: p.pos.z, pts: [{ x: p.pos.x, z: p.pos.z }, ...chain] }, delay: 0, dur: 0.2, spec: null, ago: 1 });
  return { state: st, map, riftMap: map };
}

/** 드랍 전 등급(전설 · 세트 빛기둥) · 골드 더미 3단계 · 포션 · 구슬 · 재료 · 이름표 겹침 */
function fxRiftLoot(seed) {
  const map = arena('riftLoot');
  const fx = base(seed, { cls: 'warrior', level: 15, scene: 'rift', riftLevel: 8, map });
  const st = fx.state;
  const p = st.player;
  const L = 8;
  const items = [
    item(fx, 'sword', { ilvl: L }),
    item(fx, 'helm', { ilvl: L, rarity: 'magic', affixes: [{ id: 'armor', tier: 2, value: 13 }, { id: 'vit', tier: 2, value: 9 }] }),
    item(fx, 'chest', { ilvl: L, rarity: 'rare', affixes: [{ id: 'str', tier: 2, value: 12 }, { id: 'armor', tier: 2, value: 14 }, { id: 'vit', tier: 2, value: 10 }, { id: 'allRes', tier: 1, value: 5 }, { id: 'lifePct', tier: 2, value: 6 }], name: ['rare.a.12', 'rare.b.3'] }),
    item(fx, 'greatsword', { ilvl: L, rarity: 'legendary', legendaryId: 'emberMaelstrom', affixes: [{ id: 'weaponDmg', tier: 2, value: 18 }, { id: 'str', tier: 2, value: 11 }, { id: 'critDamage', tier: 2, value: 16 }], tier: 0 }),
    item(fx, 'amulet', { ilvl: L, rarity: 'legendary', legendaryId: 'bloodPact', affixes: [{ id: 'critChance', tier: 2, value: 2.4 }, { id: 'vit', tier: 2, value: 9 }, { id: 'goldFind', tier: 1, value: 8 }] }),
    item(fx, 'helm', { ilvl: L, rarity: 'set', setPieceId: 'ironLordHelm', affixes: [{ id: 'armor', tier: 2, value: 12 }, { id: 'vit', tier: 2, value: 8 }, { id: 'allRes', tier: 1, value: 4 }] }),
    item(fx, 'chest', { ilvl: L, rarity: 'set', setPieceId: 'ashSageRobe', affixes: [{ id: 'int', tier: 2, value: 12 }, { id: 'vit', tier: 1, value: 5 }, { id: 'lifePct', tier: 1, value: 4 }] }),
    item(fx, 'ring', { ilvl: L, rarity: 'magic', affixes: [{ id: 'critChance', tier: 1, value: 1.5 }] }),
    item(fx, 'boots', { ilvl: L, rarity: 'normal' }),
    item(fx, 'gloves', { ilvl: L, rarity: 'rare', affixes: [{ id: 'attackSpeed', tier: 2, value: 6 }, { id: 'armor', tier: 1, value: 6 }, { id: 'critDamage', tier: 1, value: 10 }], name: ['rare.a.20', 'rare.b.7'] }),
  ];
  // 넓게 흩어진 넷 + 겹치는 묶음 여섯(1m 안 — 이름표 쌓기)
  const spread = [[PI * 0.5, 4], [PI * 0.9, 5], [-PI * 0.3, 4.5], [PI * 1.3, 3.5]];
  items.slice(0, 4).forEach((it, k) => drop(fx, 'item', ...around(fx, spread[k][0], spread[k][1]), { item: it }));
  const [cx, cz] = around(fx, -PI * 0.75, 3.5);
  items.slice(4).forEach((it, k) => drop(fx, 'item', cx + Math.sin(k * 1.1) * 0.6, cz + Math.cos(k * 1.1) * 0.6, { item: it }));
  drop(fx, 'gold', ...around(fx, 0.2, 2.5), { amount: 6 });
  drop(fx, 'gold', ...around(fx, 0.8, 3.2), { amount: 48 });
  drop(fx, 'gold', ...around(fx, 1.4, 4.0), { amount: 320 });
  drop(fx, 'potion', ...around(fx, 2.2, 2.6), { amount: 1 });
  drop(fx, 'potion', ...around(fx, 2.5, 3.6), { amount: 1 });
  drop(fx, 'globe', ...around(fx, 3.0, 2.2), { amount: 1 });
  drop(fx, 'globe', ...around(fx, 3.4, 3.1), { amount: 1 });
  drop(fx, 'material', ...around(fx, 4.0, 2.4), { amount: 1, mat: 'scrap' });
  drop(fx, 'material', ...around(fx, 4.3, 3.0), { amount: 1, mat: 'dust' });
  drop(fx, 'material', ...around(fx, 4.6, 2.8), { amount: 1, mat: 'essence' });
  p.hover = { kind: 'drop', id: st.rift.drops[3].id, src: 'pick' };
  return { state: st, map, riftMap: map };
}

/** 플레이어 사망(생명 1 남음) · 사망 패널 */
function fxRiftDeath(seed) {
  const map = arena('riftDeath');
  const fx = base(seed, { cls: 'warrior', level: 9, scene: 'rift', riftLevel: 5, map });
  equipAll(fx, { ilvl: 5, tier: 0, cls: 'warrior' });
  for (const s of EQUIP_SLOTS) if (fx.char.equip[s]) fx.char.equip[s].dur = 80;
  syncPlayer(fx);
  const st = fx.state;
  const p = st.player;
  p.life = 0;
  p.dead = true;
  p.deadAt = st.tick - 12;
  p.act = 'dead';
  p.killedBy = { typeId: 'charger', rank: 'elite', name: ['elite.a.1', 'elite.b.2'] };
  st.rift.lives = 1;
  st.rift.deaths = 2;
  st.rift.returnPos = { ...st.rift.checkpoint };
  // W1 수정(NOTES-W1FIX · 계약 §5.10): 사망한 틱에 진정 — 깨어 있던 떼는 그 자리에서 잠들어 서 있고(calmAt 없음 · 공격 · 이동은 쉬는 자세로),
  // 부활로 떠날 때 처음 자리(rift.homes)로 돌아간다. 플레이어가 남긴 투사체 · 효과 · 화상 · 감전은 그 틱에 지워져 없다(W1 수정 3).
  st.rift.calmAt = null;
  const pk = pack(fx, 'elite', p.pos.x + 3, p.pos.z - 3, false);
  const e = mon(fx, 'charger', ...around(fx, PI * 0.8, 3), { rank: 'elite', affixes: ['fast', 'tough'], pk, name: ['elite.a.1', 'elite.b.2'], awake: false });
  for (let k = 0; k < 3; k++) mon(fx, 'charger', ...around(fx, PI * 0.8 + (k - 1) * 0.5, 5), { rank: 'minion', affixes: ['fast', 'tough'], pk, awake: false });
  // 처음 자리 — 팩 자리(pk.anchor)에서 몰려왔다
  const homes = /** @type {any} */ (st.rift).homes;
  for (const m of st.rift.mons) {
    if (m.packId !== pk.id) continue;
    const h = place(map, pk.anchor.x + (m.pos.x - e.pos.x) * 0.5 + 4, pk.anchor.z + (m.pos.z - e.pos.z) * 0.5 - 4, Math.min(m.r, 0.9));
    homes[m.id] = { x: h.x, z: h.z, facing: m.facing };
  }
  return { state: st, map, riftMap: map };
}

/** 완료 단계 · 나가는 포털 · 요약 */
function fxRiftComplete(seed) {
  const map = arena('riftComplete');
  const fx = base(seed, { cls: 'mage', level: 14, scene: 'rift', riftLevel: 7, map });
  equipAll(fx, { ilvl: 7, tier: 0, cls: 'mage' });
  syncPlayer(fx);
  const st = fx.state;
  const p = st.player;
  const rift = st.rift;
  rift.phase = 'complete';
  rift.gauge = 100;
  const pk = pack(fx, 'guardian', p.pos.x, p.pos.z - 5, false);
  const g = mon(fx, 'boneGiant', p.pos.x - 1, p.pos.z - 5, { rank: 'guardian', affixes: ['fast', 'vampiric', 'coldEnchanted'], pk });
  dead(fx, g, { ago: 50, launch: null });
  rift.guardianId = g.id;
  rift.guardianType = 'boneGiant';
  rift.completeAt = st.tick - 5;
  const ex = place(map, g.pos.x + 3, g.pos.z, 1.0);
  rift.portals.push({ id: 'portal:' + st.nextId++, kind: 'exit', pos: ex, r: 1.0, born: st.tick - 5 });
  drop(fx, 'item', g.pos.x - 1.5, g.pos.z + 1.0, { item: item(fx, 'staff', { ilvl: 7, rarity: 'rare', affixes: [{ id: 'int', tier: 2, value: 13 }, { id: 'weaponDmg', tier: 2, value: 17 }, { id: 'critDamage', tier: 1, value: 11 }], name: ['rare.a.4', 'rare.b.17'] }), ago: 50 });
  drop(fx, 'item', g.pos.x + 1.2, g.pos.z + 1.6, { item: item(fx, 'boots', { ilvl: 7, rarity: 'rare', affixes: [{ id: 'moveSpeed', tier: 2, value: 7 }, { id: 'vit', tier: 2, value: 9 }, { id: 'magicFind', tier: 1, value: 5 }], name: ['rare.a.9', 'rare.b.1'] }), ago: 50 });
  drop(fx, 'item', g.pos.x - 0.4, g.pos.z + 2.2, { item: item(fx, 'orb', { ilvl: 7, rarity: 'legendary', legendaryId: 'stormOrb', affixes: [{ id: 'int', tier: 2, value: 12 }, { id: 'cdr', tier: 1, value: 2.5 }, { id: 'lightningDmg', tier: 1, value: 6 }] }), ago: 50 });
  drop(fx, 'gold', g.pos.x + 2.0, g.pos.z - 0.4, { amount: 210, ago: 50 });
  Object.assign(rift.stats, { gold: 512, xp: 4630, upgrades: 3, recalls: 1, potions: 2, maxTargeting: 31, swarmMoments: 3, dmgDealt: 92000, dmgTaken: 4100 });
  Object.assign(rift.stats.kills, { normal: 286, champion: 12, elite: 2, minion: 8, guardian: 1, other: 14 });
  Object.assign(rift.stats.drops, { normal: 19, magic: 15, rare: 6, legendary: 1, set: 0 });
  rift.ticksIn = ticks(6 * 60 + 42);
  rift.summary = {
    level: rift.level, seed: rift.seed, tileset: rift.tileset, cls: 'mage', result: 'complete', timeSec: rift.ticksIn / 30,
    kills: { ...rift.stats.kills }, deaths: 0, drops: { ...rift.stats.drops }, gold: rift.stats.gold, xp: rift.stats.xp, upgrades: rift.stats.upgrades,
    recalls: rift.stats.recalls, maxTargeting: rift.stats.maxTargeting, swarmMoments: rift.stats.swarmMoments, unlockedTo: 9, noDeath: true, record: true,
  };
  fx.char.riftUnlocked = 9;
  fx.char.best[String(rift.level)] = { timeSec: rift.summary.timeSec, deaths: 0 };
  return { state: st, map, riftMap: map };
}

/**
 * 마을 · 가방 38개(전 등급 · 부서진 장비 · 못 끼는 레벨) · 장착 10 · 보관함 20.
 * 피드백 2 D4: 가방은 30칸 — 31~38번째는 칸 밖(넘친 옛 세이브의 화면 · 고정 상태는 loadCharacter 의 보관함 이동을 거치지 않는다)
 */
function fxBag(seed) {
  const map = townMapFromData();
  const fx = base(seed, { cls: 'warrior', level: 12, scene: 'town', riftLevel: 8, map });
  equipAll(fx, { ilvl: 9, tier: 0, cls: 'warrior' });
  fx.char.equip.gloves.dur = 0;
  const ch = fx.char;
  for (let k = 0; k < 38; k++) ch.bag[k] = variedItem(fx, k, { ilvl: 6 + (k % 6) });
  ch.bag[5] = item(fx, 'chest', { ilvl: 20, tier: 1, rarity: 'rare', affixes: [{ id: 'armor', tier: 3, value: 50 }, { id: 'vit', tier: 3, value: 18 }, { id: 'lifePct', tier: 3, value: 8 }], name: ['rare.a.17', 'rare.b.20'] });
  ch.bag[6] = item(fx, 'greatsword', { ilvl: 9, rarity: 'legendary', legendaryId: 'emberMaelstrom', affixes: [{ id: 'weaponDmg', tier: 2, value: 19 }, { id: 'str', tier: 2, value: 12 }, { id: 'attackSpeed', tier: 1, value: 4 }] });
  ch.bag[7] = item(fx, 'gloves', { ilvl: 9, rarity: 'set', setPieceId: 'ironLordGrips', affixes: [{ id: 'armor', tier: 2, value: 10 }, { id: 'critDamage', tier: 1, value: 12 }, { id: 'vit', tier: 1, value: 6 }] });
  ch.bag[8] = item(fx, 'boots', { ilvl: 7, rarity: 'magic', affixes: [{ id: 'moveSpeed', tier: 2, value: 6 }], dur: 0 });
  ch.bag[9] = item(fx, 'wand', { ilvl: 8, rarity: 'magic', affixes: [{ id: 'int', tier: 2, value: 10 }] });
  ch.bag[10].flags.locked = true;
  ch.bag[11].flags.locked = true;
  for (let k = 0; k < 20; k++) fx.state.account.stash[k] = variedItem(fx, k + 3, { ilvl: 4 + (k % 8), cls: k % 3 === 0 ? 'mage' : 'warrior' });
  ch.gold = 2310;
  ch.materials = { scrap: 34, dust: 12, essence: 1 };
  syncPlayer(fx);
  return { state: fx.state, map, riftMap: null };
}

/** 마을 · 상점 재고 · 되사기 5 · 재굴림 제안 진행 중 · 골드 · 재료 */
function fxShops(seed) {
  const map = townMapFromData();
  const fx = base(seed, { cls: 'warrior', level: 14, scene: 'town', riftLevel: 6, map });
  equipAll(fx, { ilvl: 6, tier: 0, cls: 'warrior' });
  const ch = fx.char;
  const L = 6;
  const bs = ['sword', 'axe', 'greatsword', 'shield', 'helm', 'chest', 'gloves', 'boots', 'belt'];
  ch.shop.blacksmith = bs.map((b, k) => item(fx, b, { ilvl: L - 1, rarity: k % 5 === 4 ? 'rare' : 'magic',
    affixes: k % 5 === 4 ? [{ id: 'vit', tier: 1, value: 6 }, { id: 'armor', tier: 1, value: 5 }, { id: 'allRes', tier: 1, value: 3 }] : [{ id: 'vit', tier: 1, value: 4 + k }],
    flags: {}, name: k % 5 === 4 ? ['rare.a.' + k, 'rare.b.' + (k + 2)] : null }));
  ch.shop.general = ['amulet', 'ring', 'ring', 'ring'].map((b, k) => item(fx, b, { ilvl: L - 1, rarity: 'magic', affixes: [{ id: k ? 'critChance' : 'str', tier: 1, value: k ? 1.5 : 6 }] }));
  ch.shop.restocks = 3;
  ch.shop.stockRun = ch.runs;
  ch.buyback = [0, 1, 2, 3, 4].map(k => {
    const it = variedItem(fx, k + 20, { ilvl: 5 });
    return { item: it, price: Math.max(1, Math.round(it.value * 0.15)) };
  });
  for (let k = 0; k < 12; k++) ch.bag[k] = variedItem(fx, k, { ilvl: 5 + (k % 3) });
  const target = item(fx, 'chest', { ilvl: 6, rarity: 'rare', affixes: [{ id: 'vit', tier: 2, value: 9 }, { id: 'armor', tier: 2, value: 12 }, { id: 'lifePct', tier: 1, value: 4 }, { id: 'thorns', tier: 1, value: 4 }], name: ['rare.a.6', 'rare.b.6'] });
  target.rerolls = 1;
  ch.bag[12] = target;
  ch.shop.reroll = {
    itemId: target.id, where: 'bag', idx: 12, affixIdx: 3,
    options: [{ id: 'thorns', tier: 1, value: 4 }, { id: 'allRes', tier: 2, value: 5 }, { id: 'lifeRegen', tier: 1, value: 1.4 }],
    cost: { gold: 203, dust: 2, essence: 0 },
  };
  ch.gold = 5000;
  ch.materials = { scrap: 42, dust: 17, essence: 3 };
  syncPlayer(fx);
  setPlayerPos(fx, 14.5, 28.5, (3 * PI) / 4);
  fx.state.town.lastInteract = 'blacksmith';
  return { state: fx.state, map, riftMap: null };
}

/** 마법사 레벨 18 · 프리셋 B 중간까지 · 포인트 3 남음 */
function fxSkillTree(seed) {
  const map = townMapFromData();
  const fx = base(seed, { cls: 'mage', level: 18, scene: 'town', riftLevel: 9, map });
  equipAll(fx, { ilvl: 9, tier: 0, cls: 'mage' });
  fx.char.skills.ranks = presetRanks('mage', 1, 14);
  fx.char.skills.bar = ['chainLightning', 'frostNova', 'teleport', 'energyShield', null];
  syncPlayer(fx);
  return { state: fx.state, map, riftMap: null };
}

/** 전사 생명 20% · 감속 · 속박 · 귀환 시전 중 · 저생명 */
function fxLowLife(seed) {
  const map = arena('lowLife');
  const fx = base(seed, { cls: 'warrior', level: 11, scene: 'rift', riftLevel: 6, map });
  equipAll(fx, { ilvl: 6, tier: 0, cls: 'warrior' });
  syncPlayer(fx, { lifeFrac: 0.2, resourceFrac: 0.3 });
  const st = fx.state;
  const p = st.player;
  p.st = { slowPct: 0.4, slowUntil: st.tick + 30, rootUntil: st.tick + 20 };
  p.act = 'recall';
  p.actSkill = 'recall';
  p.actStart = st.tick - 15;
  p.actHit = st.tick - 15;
  p.actEnd = st.tick + 30;
  p.recall = { start: st.tick - 15, end: st.tick + 30 };
  p.combatUntil = st.tick + 60;
  st.rift.rootLockUntil = p.st.rootUntil + ticks(0.8);
  const pk = pack(fx, 'elite', p.pos.x + 5, p.pos.z - 4, true);
  const j = mon(fx, 'ghoul', ...around(fx, PI * 0.8, 6), { rank: 'elite', affixes: ['jailer', 'coldEnchanted'], pk, name: ['elite.a.10', 'elite.b.11'] });
  moving(fx, j);
  effect(fx, { kind: 'jail', srcId: j.id, packId: pk.id, shape: circle(p.pos.x, p.pos.z, 1.2), delay: 0.8, spec: monSpec(j, 0, 'phys', 'hazard', { onHit: { rootSec: 1.5 } }), ago: 30 });
  for (let k = 0; k < 3; k++) moving(fx, mon(fx, 'ghoul', ...around(fx, PI * 0.8 + (k - 1) * 0.4, 7.5), { rank: 'minion', affixes: ['coldEnchanted'], pk }));
  return { state: st, map, riftMap: map };
}

/** 고정 상태 15 — id → (seed) → {state, map, riftMap} */
export const FIXTURES = Object.freeze({
  town: fxTown,
  riftSwarm: fxRiftSwarm,
  riftElites: fxRiftElites,
  riftAffixes: fxRiftAffixes,
  riftGuardian: fxRiftGuardian,
  riftWitch: fxRiftWitch,
  riftWarrior: fxRiftWarrior,
  riftMage: fxRiftMage,
  riftLoot: fxRiftLoot,
  riftDeath: fxRiftDeath,
  riftComplete: fxRiftComplete,
  bag: fxBag,
  shops: fxShops,
  skillTree: fxSkillTree,
  lowLife: fxLowLife,
});

/** 고정 상태 하나(없는 id 면 throw) @param {string} id @param {number} [seed] @returns {Fixture} */
export function loadFixture(id, seed = 1) {
  const f = FIXTURES[id];
  if (!f) throw new Error(`fixture: unknown fixture '${id}'`);
  return f(seed);
}
