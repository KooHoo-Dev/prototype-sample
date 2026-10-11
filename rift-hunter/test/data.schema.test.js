// OWNER: P0 — 계약 §12.2(data.schema.test) · §7 · §8 (W0 완성 · 이후 고치지 않는다 — 결함은 NOTES-P#)
// 모든 데이터 행의 스키마 · 참조 · 완결성. 행을 더하면 이 테스트가 그 행을 자동으로 본다(표의 열이 스키마다).
// 위협 부등식 H5 · 위협 거리 · 기본 행 params 의 패치 키 금지 · ID 겹침 없음 · 프리셋이 배워지는가 · 문자열 키가 데이터의 모든 이름에 있다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLASS_IDS, DMG_TYPES, EQUIP_SLOTS, HINT_IDS, ITEM_SLOTS, MATERIAL_IDS, MON_RANKS, MON_TEMPLATES, PANEL_IDS, RARITIES, TOWN_OBJECT_IDS,
} from '../src/core/constants.js';
import { CLASSES, PLAYER } from '../src/data/classes.js';
import { BASIC_SKILLS, PATCH_KEYS, PATCH_KEYS_BY_BEHAVIOR, SKILL_NODES, TREE } from '../src/data/skills.js';
import { BUFFER, COMBAT, DEATH, GLOBE, HAZARD, METER, PICKUP, POTION, STATUS } from '../src/data/combat.js';
import { GROWTH, RIFT, RIFT_LEVELS, riftRow } from '../src/data/rift.js';
import { MON, MONSTERS, RANKS } from '../src/data/monsters.js';
import { AFFIX_RULES, MON_AFFIXES } from '../src/data/monsterAffixes.js';
import { ELITE_PACK, PACKS, TILESET_PACKS } from '../src/data/packs.js';
import { GUARDIANS } from '../src/data/guardians.js';
import { FLOW, MAPGEN, PATHING } from '../src/data/mapgen.js';
import { TILESETS } from '../src/data/tilesets.js';
import { TOWN } from '../src/data/town.js';
import { BASES, BASE_TIERS, COMPARE, FIST, ITEM, SLOT_WEIGHTS } from '../src/data/items.js';
import { AFFIX_TIERS, ITEM_AFFIXES } from '../src/data/itemAffixes.js';
import { BLP, GOLD, GUARANTEE, MATERIAL_DROP, MF, RARITY, TREASURE } from '../src/data/drops.js';
import { LEGENDARIES, SETS } from '../src/data/legendaries.js';
import { CRAFT, ECON, GAMBLE, PRICES, REROLL, SALVAGE, SHOP, START, XP } from '../src/data/economy.js';
import { QUALITY } from '../src/data/quality.js';
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA } from '../src/data/settings.js';
import { KEYBINDS, MOUSE, PANEL_KEYS } from '../src/data/keybinds.js';
import { STRINGS } from '../src/data/strings.ko.js';
import { BOT } from '../src/data/bot.js';
import { PRESETS } from '../src/data/presets.js';
import * as IDX from '../src/data/index.js';
import { SKILL_BEHAVIORS } from '../src/sim/player/skills.js';
import { EQUIP_HOOKS } from '../src/sim/player/equipHooks.js';
import { CONDS } from '../src/sim/conds.js';
import { BEHAVIORS } from '../src/sim/monsters/behaviors.js';
import { AFFIX_HOOKS } from '../src/sim/monsters/affixHooks/index.js';
import { GUARDIAN_IMPLS } from '../src/sim/monsters/guardians/index.js';
import { computeStats } from '../src/sim/loot/stats.js';

const STAT_KEYS = new Set(['str', 'int', 'vit', 'weaponDmgPct', 'attackSpeedPct', 'critChance', 'critDamage', 'physPct', 'firePct', 'coldPct', 'lightningPct',
  'skillPct', 'cdr', 'costReduce', 'lifePct', 'lifeRegen', 'lifeOnHit', 'lifePctOnHit', 'armor', 'armorPct', 'allRes', 'resPct', 'physRes', 'fireRes',
  'coldRes', 'lightningRes', 'moveSpeed', 'aoePct', 'elitePct', 'thorns', 'goldFind', 'magicFind', 'xpPct', 'potionPct', 'globePct', 'manaRegenPct',
  'dmgTakenReduce', 'rageOnHit', 'allPct', 'burnFrac', 'freezeAt', 'freezeDurPct']);
const SKILL_TAGS = new Set(['aoe', 'melee', 'projectile', 'movement', 'buff', 'channel', 'dot', 'chain']);
const MON_TAGS = new Set(['melee', 'ranged', 'support', 'swarm', 'structure', 'spawnling']);
const ATTACK_KINDS = new Set(['melee', 'projectile', 'charge', 'explode', 'spawn', 'cast']);
const TELEGRAPHS = new Set(['pose', 'aimLine', 'groundLine', 'groundCircle', 'glow']);
const PROJ_VISUALS = new Set(['magicBolt', 'fireball', 'fireballSplit', 'iceShard', 'arrow', 'shamanFire', 'spark', 'ashBolt']);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const unique = (rows, what) => {
  const ids = rows.map(r => r.id);
  assert.equal(new Set(ids).size, ids.length, `${what} ID 가 겹친다: ${ids.filter((x, i) => ids.indexOf(x) !== i)}`);
};
/** H5 — 예고 길이 ≥ react + escape / slowSpeed */
const h5 = (delay, escape) => delay + 1e-9 >= HAZARD.react + escape / HAZARD.slowSpeed;

test('클래스: 필드 · 기본 공격 · 시작 장비 · 낄 수 있는 기본형', () => {
  unique(CLASSES, 'class');
  assert.deepEqual(CLASSES.map(c => c.id), CLASS_IDS);
  for (const c of CLASSES) {
    assert.ok(['str', 'int'].includes(c.mainStat), c.id);
    assert.ok(['rage', 'mana'].includes(c.resource), c.id);
    for (const k of ['moveSpeed', 'radius', 'height']) assert.ok(isNum(c[k]) && c[k] > 0, `${c.id}.${k}`);
    assert.ok(isNum(c.life.base) && c.life.growth > 1);
    assert.ok(Object.prototype.hasOwnProperty.call(BASIC_SKILLS, c.basic), `${c.id}.basic`);
    assert.equal(c.resource === 'rage', c.rage !== null, `${c.id}: 분노 클래스만 rage 표`);
    for (const g of c.startGear) {
      const b = IDX.getBase(g.baseId);
      assert.ok(b.cls === null || b.cls === c.id, `${c.id} 시작 장비 ${g.baseId}`);
      assert.ok(BASE_TIERS[g.tier] && BASE_TIERS[g.tier].minIlvl <= 1);
    }
    for (const id of c.mainHandBases) { const b = IDX.getBase(id); assert.equal(b.slot, 'mainHand'); assert.equal(b.cls, c.id); }
    for (const id of c.offhandBases) { const b = IDX.getBase(id); assert.equal(b.slot, 'offhand'); assert.equal(b.cls, c.id); }
  }
  for (const k of Object.keys(PLAYER)) assert.ok(isNum(PLAYER[k]), `PLAYER.${k}`);
});

/** @param {any} s SkillDef @param {number} maxRank @param {string} where */
function checkSkillDef(s, maxRank, where) {
  assert.ok(Object.prototype.hasOwnProperty.call(SKILL_BEHAVIORS, s.behavior), `${where}: behavior ${s.behavior} 가 SKILL_BEHAVIORS 에 있다`);
  assert.ok(['target', 'direction', 'point', 'self'].includes(s.targeting), `${where}.targeting`);
  assert.ok(s.type === null || DMG_TYPES.includes(s.type), `${where}.type`);
  for (const t of s.tags) assert.ok(SKILL_TAGS.has(t), `${where}: tag ${t}`);
  assert.ok(isNum(s.cost) && s.cost >= 0, `${where}.cost`);
  assert.ok(isNum(s.cd) || (Array.isArray(s.cd) && s.cd.length === maxRank && s.cd.every(isNum)), `${where}.cd`);
  assert.ok(isNum(s.action) && s.action > 0, `${where}.action`);
  assert.equal(typeof s.scaled, 'boolean', `${where}.scaled`);
  assert.ok(isNum(s.hitFrac) && s.hitFrac >= 0 && s.hitFrac <= 1, `${where}.hitFrac`);
  assert.ok(Array.isArray(s.coef) && s.coef.length === maxRank && s.coef.every(isNum), `${where}.coef 길이 = maxRank`);
  for (const k of ['range', 'radius', 'angleDeg', 'width', 'reach', 'costPerSec', 'gen']) if (k in s) assert.ok(isNum(s[k]) && s[k] > 0, `${where}.${k}`);
  const st = s.status ?? {};
  for (const [k, v] of Object.entries(st)) {
    const arr = Array.isArray(v) ? v : [v];
    if (Array.isArray(v)) assert.equal(v.length, maxRank, `${where}.status.${k} 랭크별 길이`);
    for (const x of arr) assert.ok(isNum(x) && x >= 0, `${where}.status.${k}`);
    if (['shockChance', 'slowPct', 'burnFrac'].includes(k)) for (const x of arr) assert.ok(x <= 1, `${where}.status.${k} 는 0..1`);
  }
  assert.ok(s.params && typeof s.params === 'object', `${where}.params`);
  for (const k of PATCH_KEYS) assert.ok(!(k in s.params), `${where}: 기본 행 params 에 패치 키 '${k}' 가 있으면 변형을 찍지 않아도 늘 켜진다(§7.2)`);
  assert.ok(!('stun' in s.params), `${where}: 기절은 status.stun 에만`);
}

test('기본 공격 · 스킬 노드: 스키마 · 랭크 배열 · 단계 · 갈래 · 변형 req · 패치 키(§8.4) · 클래스별 노드 수 · 합계 칸', () => {
  for (const [id, s] of Object.entries(BASIC_SKILLS)) { assert.equal(s.id, id); checkSkillDef(s, 1, 'basic.' + id); }
  unique(SKILL_NODES, 'skill node');
  for (const id of Object.keys(BASIC_SKILLS)) assert.ok(!IDX.SKILL_NODES_BY_ID[id], `기본 공격 ID ${id} 는 노드와 겹치지 않는다`);
  for (const n of SKILL_NODES) {
    assert.ok(CLASS_IDS.includes(n.cls), n.id);
    assert.ok([0, 1, 2].includes(n.branch), `${n.id}.branch`);
    assert.ok([1, 2, 3, 4].includes(n.tier), `${n.id}.tier`);
    assert.ok(['active', 'passive', 'transform'].includes(n.kind), `${n.id}.kind`);
    assert.ok(Number.isInteger(n.maxRank) && n.maxRank >= 1 && n.maxRank <= 5, `${n.id}.maxRank`);
    if (n.kind === 'active') {
      assert.ok(n.skill, `${n.id}: 액티브는 skill`);
      checkSkillDef(n.skill, n.maxRank, n.id);
    }
    if (n.kind === 'passive') {
      assert.ok(n.stats || n.condStats, `${n.id}: 패시브는 stats 또는 condStats`);
      for (const [k, arr] of Object.entries({ ...(n.stats ?? {}), ...(n.condStats ?? {}) })) {
        assert.ok(STAT_KEYS.has(k), `${n.id}: StatKey ${k}`);
        assert.ok(Array.isArray(arr) && arr.length === n.maxRank && arr.every(isNum), `${n.id}.${k} 랭크별 길이`);
      }
      if (n.condStats) assert.ok(n.cond && Object.prototype.hasOwnProperty.call(CONDS, n.cond), `${n.id}: cond ${n.cond} 가 CONDS 에 있다`);
    }
    if (n.kind === 'transform') {
      assert.equal(n.maxRank, 1, `${n.id}: 변형은 최대 1랭크`);
      const req = IDX.getNode(n.req);
      assert.equal(req.kind, 'active', `${n.id}.req 는 액티브`);
      assert.equal(req.cls, n.cls, `${n.id}.req 같은 클래스`);
      assert.equal(n.transforms, n.req, `${n.id}.transforms = req`);
      assert.ok(n.patch && Object.keys(n.patch).length, `${n.id}.patch`);
      for (const k of Object.keys(n.patch)) assert.ok(PATCH_KEYS_BY_BEHAVIOR[req.skill.behavior].includes(k), `${n.id}: 패치 키 ${k} 는 ${req.skill.behavior} 동작의 키(§8.4)`);
    }
  }
  for (const cls of CLASS_IDS) {
    const nodes = IDX.nodesOf(cls);
    const by = (k) => nodes.filter(n => n.kind === k).length;
    assert.ok(nodes.length >= 14 && nodes.length <= 18, `${cls} 노드 수 ${nodes.length}`);
    assert.ok(by('active') >= 6 && by('active') <= 7 && by('passive') >= 5 && by('passive') <= 6 && by('transform') >= 3 && by('transform') <= 4, `${cls} 종류별 수`);
    const cells = nodes.reduce((a, n) => a + n.maxRank, 0);
    assert.ok(cells >= 50 && cells <= 60, `${cls} 합계 칸 ${cells}`);
    for (const b of [0, 1, 2]) assert.ok(nodes.some(n => n.branch === b && n.tier === 1), `${cls} 갈래 ${b} 의 1단계`);
  }
  assert.deepEqual(TREE.tierPoints, [0, 5, 10, 15]);
  for (const [beh, keys] of Object.entries(PATCH_KEYS_BY_BEHAVIOR)) {
    assert.ok(Object.prototype.hasOwnProperty.call(SKILL_BEHAVIORS, beh));
    for (const k of keys) assert.ok(PATCH_KEYS.includes(k), k);
  }
});

test('전투 · 상태 · 줍기 · 사망 · 계측 · 위협 간격 · 선입력 수치가 있다', () => {
  for (const obj of [COMBAT, POTION, GLOBE, PICKUP, DEATH, METER, HAZARD, BUFFER]) {
    for (const [k, v] of Object.entries(obj)) if (typeof v !== 'object') assert.ok(isNum(v), k);
  }
  for (const r of MON_RANKS) assert.ok(isNum(STATUS.stunImmune[r]), `STATUS.stunImmune.${r}`);
  assert.ok(Math.abs(HAZARD.slowSpeed - CLASSES[0].moveSpeed * (1 - STATUS.playerChill)) < 1e-9, 'slowSpeed = 6 × (1 − playerChill)');
});

test('균열 레벨 곡선: riftRow 1..99 유한 · 표 30행 · 30 위도 같은 식 · 정수로 자르기', () => {
  assert.equal(RIFT_LEVELS.length, 30);
  for (let L = 1; L <= RIFT.maxLevel; L++) {
    const r = riftRow(L);
    for (const [k, v] of Object.entries(r)) {
      if (typeof v === 'object') for (const x of Object.values(v)) assert.ok(isNum(x) && x > 0, `L${L}.${k}`);
      else assert.ok(isNum(v) && v > 0, `L${L}.${k}`);
    }
    assert.equal(r.monLevel, L);
  }
  assert.equal(riftRow(0).level, 1);
  assert.equal(riftRow(2.7).level, 2);
  assert.equal(riftRow(1e9).level, RIFT.maxLevel);
  assert.equal(riftRow(NaN).level, 1);
  const r5 = riftRow(5);
  assert.ok(Math.abs(r5.hpMul - 1.14 ** 4) < 1e-9);
  assert.ok(Math.abs(riftRow(25).hpMul - 1.14 ** 19 * 1.12 ** 5) < 1e-9, 'L > 20 은 hpLate');
  assert.deepEqual([riftRow(1).champAffixes, riftRow(10).champAffixes, riftRow(4).eliteAffixes, riftRow(5).eliteAffixes, riftRow(15).eliteAffixes], [1, 2, 2, 3, 4]);
  for (const k of Object.keys(GROWTH)) assert.ok(isNum(GROWTH[k]));
});

/** @param {any} d MonsterDef|GuardianDef @param {string} where */
function checkMonsterDef(d, where) {
  assert.ok(MON_TEMPLATES.includes(d.template), `${where}.template`);
  for (const t of d.tags) assert.ok(MON_TAGS.has(t), `${where}: tag ${t}`);
  assert.ok(Object.prototype.hasOwnProperty.call(BEHAVIORS, d.behavior), `${where}: behavior ${d.behavior} 가 BEHAVIORS 에 있다`);
  for (const k of ['radius', 'height']) assert.ok(isNum(d[k]) && d[k] > 0, `${where}.${k}`);
  for (const k of ['speed', 'turnRate', 'hp', 'dmg', 'xp', 'gauge', 'aggro']) assert.ok(isNum(d[k]) && d[k] >= 0, `${where}.${k}`);
  assert.ok(d.hp > 0, `${where}.hp`);
  assert.deepEqual(Object.keys(d.res).sort(), [...DMG_TYPES].sort(), `${where}.res 네 종류`);
  for (const t of DMG_TYPES) assert.ok(d.res[t] >= 0 && d.res[t] <= 0.75, `${where}.res.${t}`);
  assert.equal(typeof d.eliteOk, 'boolean');
  assert.ok(d.params && typeof d.params === 'object', `${where}.params`);
  assert.ok(typeof d.look?.color === 'string' && typeof d.look?.variant === 'string', `${where}.look`);
  assert.ok(d.attacks.length >= 1, `${where}: 공격 ≥ 1`);
  const ids = d.attacks.map(a => a.id);
  assert.equal(new Set(ids).size, ids.length, `${where}: 공격 ID 겹침`);
  for (const a of d.attacks) {
    const w = `${where}.${a.id}`;
    assert.ok(ATTACK_KINDS.has(a.kind), `${w}.kind`);
    assert.ok(TELEGRAPHS.has(a.telegraph), `${w}.telegraph`);
    assert.ok(DMG_TYPES.includes(a.type), `${w}.type`);
    for (const k of ['windup', 'recover', 'cd', 'mul']) assert.ok(isNum(a[k]) && a[k] >= 0, `${w}.${k}`);
    assert.ok(a.windup > 0, `${w}.windup > 0`);
    if (a.kind === 'melee') assert.ok(isNum(a.reach) && a.reach > 0 && isNum(a.coneDeg) && a.coneDeg > 0, `${w}: 근접은 reach · coneDeg`);
    if (a.kind === 'projectile') {
      assert.ok(a.proj && isNum(a.proj.speed) && isNum(a.proj.r) && isNum(a.proj.life), `${w}.proj`);
      assert.ok(PROJ_VISUALS.has(a.proj.visual), `${w}.proj.visual ${a.proj.visual} 가 §9.8 에 있다`);
    }
    if ('range' in a) assert.ok(a.range <= MON.threatRange, `${w}: range ${a.range} ≤ MON.threatRange(${MON.threatRange}) — 화면 밖에서 쏘지 않는다`);
    if (a.telegraph === 'groundLine' || a.telegraph === 'groundCircle') assert.ok(isNum(a.escape), `${w}: 바닥 표식 공격은 escape 가 있다(H5)`);
    if (isNum(a.escape)) assert.ok(h5(a.windup, a.escape), `${w}: H5 예고 ${a.windup} ≥ ${HAZARD.react} + ${a.escape}/${HAZARD.slowSpeed}`);
    if (a.kind === 'cast' && a.params && (a.params.shape === 'cone' || a.params.shape === 'line')) {
      const reach = a.params.shape === 'cone' ? a.params.r : a.params.len;
      assert.ok(a.range <= reach - 0.5 + 1e-9, `${w}: cast range ${a.range} ≤ 효과 도달 ${reach} − 0.5`);
    }
    if (a.params?.child) assert.ok(IDX.MONSTERS_BY_ID[a.params.child], `${w}.params.child ${a.params.child}`);
  }
}

test('몬스터 · 등급 · 수호자: 스키마 · 행동 · 공격 · 위협 부등식 H5 · 위협 거리 ≤ 11m · ID 겹침 없음(getMonDef)', () => {
  unique(MONSTERS, 'monster');
  unique(GUARDIANS, 'guardian');
  for (const g of GUARDIANS) assert.ok(!IDX.MONSTERS_BY_ID[g.id], `수호자 ${g.id} 와 일반 ID 가 겹치지 않는다`);
  for (const m of MONSTERS) checkMonsterDef(m, m.id);
  for (const g of GUARDIANS) {
    checkMonsterDef(g, g.id);
    assert.equal(g.behavior, 'guardian');
    assert.equal(g.xp, 1); assert.equal(g.gauge, 0); assert.equal(g.aggro, 99); assert.equal(g.eliteOk, false);
    assert.ok(Object.prototype.hasOwnProperty.call(GUARDIAN_IMPLS, g.id), `${g.id} 의 impl`);
    assert.equal(g.attacks.filter(a => a.kind === 'cast').length >= 2, true, `${g.id}: 고유 기술 2`);
    assert.equal(IDX.getMonDef(g.id), g);
  }
  assert.deepEqual(RANKS.map(r => r.id).sort(), [...MON_RANKS].sort());
  for (const r of RANKS) {
    assert.ok(r.tc === null || IDX.TREASURE_BY_ID[r.tc], `rank ${r.id}.tc`);
    for (const k of ['hp', 'dmg', 'xp', 'gauge', 'scale', 'stunMul', 'freezeMul', 'knockMul']) assert.ok(isNum(r[k]) && r[k] >= 0, `rank ${r.id}.${k}`);
    assert.ok(r.flinchFrac === null || (r.flinchFrac > 0 && r.flinchFrac < 1));
  }
  assert.throws(() => IDX.getMonDef('nope'));
  for (const k of Object.keys(MON)) assert.ok(isNum(MON[k]), `MON.${k}`);
  assert.equal(MON.threatRange, 11);
});

test('정예 속성: 훅 레지스트리 · mods · 배제 · H5(delay · escape) · 위협 거리 · 정예 가능 종마다 붙을 수 있는 속성 ≥ 4', () => {
  unique(MON_AFFIXES, 'monster affix');
  assert.equal(MON_AFFIXES.length, 12);
  for (const a of MON_AFFIXES) {
    assert.equal(a.hook, a.id, `${a.id}.hook = id`);
    assert.ok(Object.prototype.hasOwnProperty.call(AFFIX_HOOKS, a.hook), `${a.id} 의 훅 파일`);
    for (const k of Object.keys(a.mods)) assert.ok(['hpMul', 'speedMul', 'atkSpeedMul', 'res', 'immune'].includes(k), `${a.id}.mods.${k}`);
    for (const t of Object.keys(a.mods.res ?? {})) assert.ok(DMG_TYPES.includes(t));
    for (const t of a.excludeTags) assert.ok(MON_TAGS.has(t), `${a.id}.excludeTags ${t}`);
    for (const x of a.excludeAffixes) assert.ok(IDX.MON_AFFIXES_BY_ID[x], `${a.id}.excludeAffixes ${x}`);
    assert.ok(Number.isInteger(a.minLevel) && a.minLevel >= 1 && a.weight > 0);
    for (const [k, v] of Object.entries(a.params)) assert.ok(isNum(v), `${a.id}.params.${k}`);
    if (a.hazard) {
      assert.ok(isNum(a.params.delay) && isNum(a.params.escape), `${a.id}: 바닥 위협은 delay · escape`);
      assert.ok(h5(a.params.delay, a.params.escape), `${a.id}: H5 ${a.params.delay} ≥ ${HAZARD.react} + ${a.params.escape}/${HAZARD.slowSpeed}`);
    }
    if ('range' in a.params) assert.ok(a.params.range <= MON.threatRange, `${a.id}.params.range ≤ ${MON.threatRange}`);
  }
  for (const a of MON_AFFIXES) for (const x of a.excludeAffixes) assert.ok(IDX.getMonAffix(x).excludeAffixes.includes(a.id), `배제는 서로: ${a.id} ↔ ${x}`);
  for (const m of MONSTERS.filter(x => x.eliteOk)) {
    const ok = MON_AFFIXES.filter(a => !a.excludeTags.some(t => m.tags.includes(t)));
    assert.ok(ok.length >= 4, `${m.id}: 붙을 수 있는 속성 ${ok.length}`);
  }
  assert.equal(AFFIX_RULES.minLevelByCount.length, 4);
});

test('팩 · 타일셋 팩 · 정예 팩: 구성원이 있는 종 · 범위 · 타일셋마다 팩 가중치', () => {
  unique(PACKS, 'pack');
  for (const p of PACKS) {
    assert.ok(p.members.length >= 1);
    for (const mm of p.members) {
      assert.ok(IDX.MONSTERS_BY_ID[mm.typeId], `${p.id}: ${mm.typeId}`);
      assert.ok(Number.isInteger(mm.min) && mm.min >= 1 && mm.max >= mm.min, `${p.id}: ${mm.typeId} 범위`);
    }
  }
  for (const ts of TILESETS.filter(t => t.weight > 0)) {
    const w = TILESET_PACKS[ts.id];
    assert.ok(w && Object.keys(w).length, `${ts.id} 팩 가중치`);
    for (const id of Object.keys(w)) assert.ok(IDX.PACKS_BY_ID[id], `${ts.id}: ${id}`);
  }
  for (const id of Object.keys(ELITE_PACK.types)) assert.ok(IDX.getMonster(id).eliteOk, `정예 팩 종 ${id} 는 eliteOk`);
  assert.ok(ELITE_PACK.champion.min >= 2 && ELITE_PACK.champion.max >= ELITE_PACK.champion.min);
});

test('맵 · 타일셋 · 마을: 소품 · 빛 · 환경음 · 마을 물체 7 · 도착점', () => {
  unique(TILESETS, 'tileset');
  assert.deepEqual(TILESETS.map(t => t.id).sort(), ['cavern', 'crypt', 'town']);
  for (const t of TILESETS) {
    for (const p of t.props) {
      assert.ok(typeof p.kind === 'string' && isNum(p.r) && isNum(p.h) && typeof p.block === 'boolean' && ['wall', 'floor', 'room'].includes(p.where), `${t.id}.${p.kind}`);
    }
    assert.ok(t.lights.kinds.length >= 1, `${t.id} 빛`);
    for (const l of t.lights.kinds) assert.match(l.color, /^#[0-9a-f]{6}$/i);
    assert.ok(typeof t.ambience === 'string' && t.ambience.length);
  }
  const ids = TOWN.objects.map(o => o.id);
  for (const id of TOWN_OBJECT_IDS) assert.ok(ids.includes(id), `마을 물체 ${id}`);
  assert.equal(TOWN.objects.filter(o => o.kind !== 'deco').length, TOWN_OBJECT_IDS.length, '상호작용 물체 7');
  for (const o of TOWN.objects) {
    assert.ok(o.x > 2 && o.x < TOWN.w * 2 - 2 && o.z > 2 && o.z < TOWN.h * 2 - 2, `${o.id} 위치`);
    if (o.kind === 'npc') assert.ok(STRINGS['npc.' + o.npc], `npc ${o.npc}`);
  }
  for (const k of ['rooms', 'roomTiles', 'corridorWidth', 'normalPerRoom']) assert.ok(Array.isArray(MAPGEN[k]) && MAPGEN[k][0] <= MAPGEN[k][1], k);
  assert.ok(MAPGEN.corridorWidth[0] * 2 >= 4 && MAPGEN.corridorWidth[1] * 2 <= 6, '통로 4~6m');
  assert.ok(isNum(PATHING.maxNodes) && isNum(FLOW.everySec));
});

test('기본형: 부위 · 클래스 · 값 · 모든 부위에 L1 기본형 ≥ 1(무기 · 보조는 클래스마다) · 양손이 한손을 크게 앞서지 않는다', () => {
  unique(BASES, 'base');
  for (const b of BASES) {
    assert.ok(ITEM_SLOTS.includes(b.slot), b.id);
    assert.ok(b.cls === null || CLASS_IDS.includes(b.cls), b.id);
    if (b.slot === 'mainHand' || b.slot === 'offhand') assert.ok(b.cls, `${b.id}: 무기 · 보조는 클래스 전용`);
    if (b.slot === 'mainHand') assert.ok([1, 2].includes(b.hands) && b.dmg[0] < b.dmg[1] && isNum(b.aps), `${b.id} 무기 값`);
    assert.ok(b.weight > 0 && typeof b.look === 'string');
  }
  assert.equal(BASE_TIERS[0].minIlvl, 1);
  for (const s of ITEM_SLOTS) {
    if (s === 'mainHand' || s === 'offhand') for (const c of CLASS_IDS) assert.ok(BASES.some(b => b.slot === s && b.cls === c), `${s} · ${c}`);
    else assert.ok(BASES.some(b => b.slot === s), `${s} 기본형`);
  }
  for (const s of ITEM_SLOTS) assert.ok(SLOT_WEIGHTS[s] > 0, `SLOT_WEIGHTS.${s}`);
  for (const c of CLASS_IDS) assert.ok(FIST[c] && FIST[c].dmg[0] < FIST[c].dmg[1]);
  const dps = (id) => { const b = IDX.getBase(id); return ((b.dmg[0] + b.dmg[1]) / 2) * b.aps; };
  for (const two of ['greatsword', 'greataxe']) assert.ok(dps(two) / dps('sword') > 1.1 && dps(two) / dps('sword') < 1.35, two);
  assert.ok(isNum(COMPARE.minGain));
  for (const [k, v] of Object.entries(ITEM.slotValue)) assert.ok(isNum(v) && v > 0, k);
});

test('아이템 옵션: 32행 · StatKey · 부위 · 티어 5 증가 · 모든 옵션이 어느 부위에선가 · 부위마다 접두 ≥ 3 · 접미 ≥ 3', () => {
  unique(ITEM_AFFIXES, 'item affix');
  assert.equal(ITEM_AFFIXES.length, 32);
  for (const a of ITEM_AFFIXES) {
    assert.ok(['prefix', 'suffix'].includes(a.kind), a.id);
    assert.ok(STAT_KEYS.has(a.stat), `${a.id}.stat`);
    assert.ok(a.slots.length >= 1 && a.slots.every(s => ITEM_SLOTS.includes(s)), `${a.id}.slots`);
    assert.ok(['flat', 'pow'].includes(a.scale) && [0, 1].includes(a.decimals) && a.weight > 0);
    assert.equal(a.tiers.length, 5, `${a.id} 티어 5`);
    for (let t = 0; t < 5; t++) {
      assert.ok(a.tiers[t][0] <= a.tiers[t][1], `${a.id} T${t + 1}`);
      if (t) assert.ok(a.tiers[t][0] >= a.tiers[t - 1][0] && a.tiers[t][1] > a.tiers[t - 1][1], `${a.id} T${t + 1} 증가`);
    }
    if (a.main) assert.ok(['str', 'int'].includes(a.main) && a.stat === a.main);
    if (a.param) assert.equal(a.stat, 'skillPct');
  }
  for (const s of ITEM_SLOTS) {
    const pool = IDX.affixesFor(s);
    assert.ok(pool.filter(a => a.kind === 'prefix').length >= 3, `${s} 접두 ≥ 3`);
    assert.ok(pool.filter(a => a.kind === 'suffix').length >= 3, `${s} 접미 ≥ 3`);
  }
  assert.deepEqual(AFFIX_TIERS.minIlvl, [1, 6, 12, 18, 24]);
  assert.equal(AFFIX_TIERS.weight.length, 5);
});

test('드랍 · 등급 · 보장 · 아이발 · 불운 · 재료: 키 · 참조 · 값', () => {
  unique(TREASURE, 'treasure');
  for (const t of TREASURE) {
    assert.deepEqual(Object.keys(t.w).sort(), ['gear', 'globe', 'gold', 'material', 'none', 'potion']);
    assert.ok(t.picks >= 1 && t.goldMul > 0);
  }
  assert.equal(IDX.getTreasure('guardian').guaranteed, 2);
  assert.deepEqual(Object.keys(RARITY.base).sort(), [...RARITIES].sort());
  for (const r of RANKS) if (r.tc) assert.ok(RARITY.rank[r.tc], `RARITY.rank.${r.tc}`);
  for (const k of Object.keys(RARITY.value)) assert.ok(RARITIES.includes(k));
  assert.deepEqual(Object.keys(GUARANTEE).sort(), ['legendary', 'rare', 'set']);
  assert.equal(MF.k, 2.0);
  assert.equal(BLP.hard, 400);
  assert.ok(GOLD.base > 0);
  for (const m of Object.keys(MATERIAL_DROP)) assert.ok(MATERIAL_IDS.includes(m));
  for (const [r, cnt] of Object.entries(ITEM.affixCount)) for (const [n, w] of Object.entries(cnt)) assert.ok(Number(n) >= 0 && w > 0, `${r}.${n}`);
});

test('전설 · 세트: 기본형 · 클래스 · 패치형(대상 노드 · §8.4 키) · 사건형(at) · 훅 · 조각 부위', () => {
  unique(LEGENDARIES, 'legendary');
  assert.equal(LEGENDARIES.length, 12);
  let patchN = 0, eventN = 0;
  for (const l of LEGENDARIES) {
    const b = IDX.getBase(l.baseId);
    assert.ok(l.cls === null || CLASS_IDS.includes(l.cls), l.id);
    assert.ok(b.cls === null || b.cls === l.cls, `${l.id}: 기본형 클래스`);
    assert.ok(Object.prototype.hasOwnProperty.call(EQUIP_HOOKS, l.hook), `${l.id}.hook ${l.hook} 가 EQUIP_HOOKS 에 있다`);
    assert.ok(Array.isArray(l.affixes) && l.affixes[0] <= l.affixes[1] && l.weight > 0);
    if (l.skill) {
      patchN++;
      const node = IDX.getNode(l.skill);
      assert.equal(node.kind, 'active', `${l.id}.skill 은 액티브`);
      assert.equal(node.cls, l.cls, `${l.id}.skill 같은 클래스`);
      assert.ok(l.patch && Object.keys(l.patch).length, `${l.id}.patch`);
      for (const k of Object.keys(l.patch)) assert.ok(PATCH_KEYS_BY_BEHAVIOR[node.skill.behavior].includes(k), `${l.id}: 패치 키 ${k}(§8.4)`);
      assert.ok(!l.at);
    } else {
      eventN++;
      assert.ok(['kill', 'globe'].includes(l.at), `${l.id}.at`);
    }
  }
  assert.deepEqual([patchN, eventN], [9, 3]);
  unique(SETS, 'set');
  const pieceIds = SETS.flatMap(s => s.pieces.map(p => p.id));
  assert.equal(new Set(pieceIds).size, pieceIds.length);
  for (const s of SETS) {
    assert.ok(CLASS_IDS.includes(s.cls));
    assert.equal(s.pieces.length, 4);
    for (const p of s.pieces) assert.equal(IDX.getBase(p.baseId).slot, p.slot, `${p.id} 부위`);
    for (const k of [...Object.keys(s.bonus2), ...Object.keys(s.bonus4)]) assert.ok(STAT_KEYS.has(k), `${s.id}: ${k}`);
  }
  assert.equal(IDX.getSetPiece('ironLordHelm').setId, 'ironLord');
});

test('경제 · 경험치 · 화질 · 설정 · 키 · 봇: 값 · 키', () => {
  for (const o of [ECON, PRICES, GAMBLE, REROLL, CRAFT, SHOP, START, XP]) assert.ok(o && typeof o === 'object');
  for (const r of RARITIES) assert.ok(SALVAGE[r], `SALVAGE.${r}`);
  assert.deepEqual(XP.reqEarly, [200, 500, 900]);
  assert.deepEqual(Object.keys(QUALITY).sort(), ['high', 'low', 'medium']);
  for (const k of Object.keys(DEFAULT_SETTINGS)) assert.ok(SETTINGS_SCHEMA[k], `SETTINGS_SCHEMA.${k}`);
  for (const k of Object.keys(SETTINGS_SCHEMA)) assert.ok(k in DEFAULT_SETTINGS, `DEFAULT_SETTINGS.${k}`);
  const codes = [];
  for (const v of Object.values(KEYBINDS)) codes.push(...(Array.isArray(v) ? v : [v]));
  for (const p of Object.values(PANEL_KEYS)) codes.push(...Object.values(p));
  for (const c of codes) assert.match(c, /^(Key[A-Z]|Digit\d|Shift(Left|Right)|Alt(Left|Right)|Tab|Backquote|Escape|Enter|NumpadEnter|Space|Arrow(Up|Down|Left|Right)|Bracket(Left|Right)|Equal|Minus)$/, c);
  assert.ok(isNum(MOUSE.move) && isNum(MOUSE.skill0));
  assert.equal(BOT.viewR, 11.4);
  for (const k of Object.keys(BOT.priority)) assert.ok(IDX.MONSTERS_BY_ID[k] || MON_RANKS.includes(k), `BOT.priority.${k}`);
});

test('프리셋: 클래스마다 둘 · order 29 가 단계 · req · 최대 랭크를 지키며 배워지고 bar 는 배운 액티브', () => {
  for (const cls of CLASS_IDS) {
    assert.equal(PRESETS[cls].length, 2, cls);
    for (const p of PRESETS[cls]) {
      assert.equal(p.order.length, 29, `${p.id} order 29`);
      assert.ok(STRINGS[p.nameKey], `${p.id}.nameKey`);
      const ranks = {};
      let spent = 0;
      p.order.forEach((id, i) => {
        const n = IDX.getNode(id);
        assert.equal(n.cls, cls, `${p.id}[${i}] ${id} 클래스`);
        assert.ok(spent >= TREE.tierPoints[n.tier - 1], `${p.id}[${i}] ${id}: 단계 ${n.tier} 는 ${TREE.tierPoints[n.tier - 1]}점 필요(쓴 점수 ${spent})`);
        if (n.req) assert.ok((ranks[n.req] ?? 0) >= 1, `${p.id}[${i}] ${id}: req ${n.req}`);
        ranks[id] = (ranks[id] ?? 0) + 1;
        assert.ok(ranks[id] <= n.maxRank, `${p.id}[${i}] ${id}: 최대 랭크 ${n.maxRank}`);
        spent++;
      });
      assert.equal(p.bar.length, 5);
      for (const id of p.bar) {
        assert.equal(IDX.getNode(id).kind, 'active', `${p.id}.bar ${id}`);
        assert.ok(ranks[id] >= 1, `${p.id}.bar ${id} 를 배웠다`);
      }
    }
  }
});

test('조회 표(data/index.js): getX 는 없는 ID 에서 throw · getSkillDef · nodesOf · basesFor · affixesFor', () => {
  assert.throws(() => IDX.getBase('nope'));
  assert.throws(() => IDX.getNode('nope'));
  assert.equal(IDX.getSkillDef('bash'), BASIC_SKILLS.bash);
  assert.equal(IDX.getSkillDef('fireball'), IDX.getNode('fireball').skill);
  assert.throws(() => IDX.getSkillDef('combustion'), '패시브는 스킬 수치가 없다');
  assert.equal(IDX.activesOf('warrior').length, 6);
  assert.ok(IDX.basesFor('mainHand', 'mage').every(b => b.cls === 'mage'));
  assert.ok(IDX.basesFor('helm', 'mage').length === 1);
  assert.ok(IDX.affixesFor('boots').some(a => a.id === 'moveSpeed'));
});

test('문자열: 데이터의 모든 이름 키가 strings.ko.js 에 있다(부록 B)', () => {
  const missing = [];
  const need = (k) => { if (typeof STRINGS[k] !== 'string' || !STRINGS[k].length) missing.push(k); };
  for (const c of CLASS_IDS) need('class.' + c);
  for (const r of ['rage', 'mana']) need('res.' + r);
  for (const t of DMG_TYPES) need('dmg.' + t);
  for (const r of RARITIES) need('rarity.' + r);
  for (const r of MON_RANKS) need('rank.' + r);
  for (const s of EQUIP_SLOTS) need('slot.' + s);
  for (const s of ITEM_SLOTS) need('islot.' + s);
  for (const m of MATERIAL_IDS) need('mat.' + m);
  for (const t of TILESETS) need('tileset.' + t.id);
  for (const m of [...MONSTERS, ...GUARDIANS]) need('mon.' + m.id);
  for (const a of MON_AFFIXES) { need(`affix.${a.id}.name`); need(`affix.${a.id}.desc`); }
  for (const n of SKILL_NODES) { need(`node.${n.id}.name`); need(`node.${n.id}.desc`); }
  for (const c of CLASS_IDS) for (const b of [0, 1, 2]) need(`branch.${c}.${b}`);
  for (const b of BASES) for (let t = 0; t < BASE_TIERS.length; t++) need(`base.${b.id}.${t}`);
  for (const a of ITEM_AFFIXES) { need(`afx.${a.id}.line`); need(`afx.${a.id}.${a.kind === 'prefix' ? 'p' : 's'}`); }
  for (const l of LEGENDARIES) { need('leg.' + l.id); need('legfx.' + l.id); }
  for (const s of SETS) { need('set.' + s.id); need(`set.${s.id}.b2`); need(`set.${s.id}.b4`); for (const p of s.pieces) need('setp.' + p.id); }
  for (const id of TOWN_OBJECT_IDS) { need('npc.' + id); need(`npc.${id}.greet`); }
  for (const k of Object.keys(computeStats(null))) if (typeof computeStats(null)[k] === 'number') need('stat.' + k);
  const REASONS = ['stub', 'busy', 'gold', 'materials', 'bagFull', 'stashFull', 'equipped', 'class', 'level', 'slot', 'twoHanded', 'notInTown', 'notInRift',
    'noRift', 'collapsed', 'dead', 'notDead', 'locked', 'points', 'tier', 'req', 'maxRank', 'notLearned', 'name', 'slotTaken', 'rerollLocked', 'noOffer',
    'nothing', 'notEligible', 'full', 'empty', 'cooldown', 'resource', 'noTarget', 'rooted', 'town', 'noItem', 'invalid', 'itemLocked'];
  for (const r of REASONS) need('reason.' + r);
  for (const h of HINT_IDS) { need(`hint.${h}.title`); need(`hint.${h}.body`); }
  for (let i = 0; i < 24; i++) { need('rare.a.' + i); need('rare.b.' + i); }
  for (let i = 0; i < 16; i++) { need('elite.a.' + i); need('elite.b.' + i); }
  for (const c of CLASS_IDS) for (const i of [0, 1]) need(`preset.${c}.${i}`);
  for (const p of PANEL_IDS) need(`panel.${p}.title`);
  for (const k of Object.keys(DEFAULT_SETTINGS)) need('settings.' + k);
  for (const q of Object.keys(QUALITY)) need('settings.quality.' + q);
  for (const k of ['fatal.webglTitle', 'fatal.webglBody', 'confirm.yes', 'confirm.no', 'audio.hint', 'title.name', 'pause.riftNote', 'death.respawn', 'hud.returnPrompt', 'notice.noRecall'])
    need(k);
  assert.deepEqual(missing, [], `없는 문자열 키:\n${missing.join('\n')}`);
  for (const [k, v] of Object.entries(STRINGS)) assert.ok(typeof v === 'string' && v.length, `빈 문면 ${k}`);
});
