// OWNER: P0 — 계약 §12.2(data.schema.test) · §7 · §8 (W0 완성 · 이후 고치지 않는다 — 결함은 NOTES-P#)
// 모든 데이터 행의 스키마 · 참조 · 분포 · 완결성. 행을 더하면 이 테스트가 그 행을 자동으로 덮는다(§8.1).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BAIT_IDS, BAND_IDS, BEHAVIOR_KINDS, BODY_TEMPLATES, FAIL_REASONS, GEAR_SLOTS, HINT_IDS, LAYER_IDS, SCENE_IDS,
  SET_IDS, SKILL_IDS, STAGE_IDS, STYLE_IDS, TIERS, WEATHER_IDS,
} from '../src/core/constants.js';
import { fwd, pointInConvex, shoreZAt } from '../src/core/math.js';
import { normalInv } from '../src/core/stats.js';
import { SPECIES, SPECIES_BY_ID, getSpecies, speciesOfStage } from '../src/data/species/index.js';
import { LAKE_SPECIES } from '../src/data/species/lake.js';
import { COAST_SPECIES } from '../src/data/species/coast.js';
import { RIVER_SPECIES } from '../src/data/species/river.js';
import { STAGES, STAGES_BY_ID, SPOTS_BY_ID, getSpot, getStage, stageOfSpot } from '../src/data/stages/index.js';
import { BITE, CAST, LAYER, RIG, SIGNAL } from '../src/data/bite.js';
import { FIGHT, HOOK } from '../src/data/fight.js';
import { STYLES, TRAITS } from '../src/data/fightStyles.js';
import { BAITS } from '../src/data/baits.js';
import { GEAR, GEAR_BY_ID, GEAR_GATES } from '../src/data/gear.js';
import { SKILLS } from '../src/data/skills.js';
import { FREE_BAIT, HOLD, PRICE, START, XP } from '../src/data/economy.js';
import { BOT } from '../src/data/bot.js';
import { DEFAULT_SETTINGS, MOUSE, QUALITY } from '../src/data/settings.js';
import { KEYBINDS, WHEEL } from '../src/data/keybinds.js';
import { BANDS, TIME } from '../src/data/time.js';
import { WEATHER } from '../src/data/weather.js';
import { WORLD } from '../src/data/world.js';
import { STRINGS } from '../src/data/strings.ko.js';
import { typeKeys } from './helpers.js';

const HEX = /^#[0-9a-f]{6}$/i;
const PATTERNS = ['none', 'bars', 'spots', 'stripe', 'mottled', 'scales', 'mirror', 'scutes', 'gold', 'zombie', 'ghost'];
const TRAIT_IDS = ['dash', 'shake', 'twist', 'rareJump', 'shortRun', 'longRun', 'repeatRun', 'multiJump', 'stopBurst', 'spin', 'vanish', 'firstRun', 'cautious', 'abrade', 'tremble', 'shortThrash'];
const REASON_KEYS = ['stub', 'busy', 'locked', 'same', 'holdFull', 'noBait', 'noLine', 'money', 'level', 'mastery', 'notOwned', 'inUse', 'wrongSlot', 'wrongSet', 'maxRank', 'noPoints', 'notHere', 'invalid', 'full', 'holdFullCast'];
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isPos = (v) => isNum(v) && v > 0;
const subsetOf = (arr, list) => Array.isArray(arr) && arr.every(x => list.includes(x));
const timeCoef = (s, bandIdx) => BITE.timeCoef[s.time[bandIdx]];
const fails = [];
const check = (cond, msg) => { if (!cond) fails.push(msg); };
const flush = (title) => {
  const list = fails.splice(0);
  assert.deepEqual(list, [], `${title}:\n${list.join('\n')}`);
};

// §7.3.4 산출 표(검산용) — 중앙 cm · 중앙 kg · 트로피 kg · 레전드 kg · 레전드 배율 · 중앙가 · 트로피 중앙가 · 레전드 중앙가
const DERIVE_TABLE = {
  crucian: [22.0, 0.27, 0.60, 1.13, 6.33, 1112, 7327, 36634],
  carp: [56.8, 3.06, 7.31, 14.87, 6.17, 3651, 28288, 141440],
  israeliCarp: [53.0, 2.56, 5.33, 9.69, 6.57, 3934, 24250, 121251],
  largemouthBass: [33.9, 0.74, 1.49, 2.63, 6.88, 1515, 9143, 45714],
  bluegill: [13.7, 0.10, 0.18, 0.29, 7.49, 429, 2102, 10511],
  mandarinFish: [33.9, 0.70, 1.37, 2.35, 7.23, 4355, 25564, 127819],
  catfish: [45.6, 1.42, 3.18, 6.17, 6.20, 2615, 17898, 89489],
  snakehead: [55.0, 1.78, 3.32, 5.52, 7.30, 3349, 18201, 91003],
  steedBarbel: [33.9, 0.67, 1.24, 2.07, 7.15, 1256, 6680, 33400],
  skygager: [40.3, 0.74, 1.49, 2.63, 6.74, 1136, 6711, 33556],
  bullhead: [15.5, 0.09, 0.15, 0.22, 7.94, 489, 2158, 10789],
  goldenDragon: [99.5, 16.86, 25.33, 35.30, 9.16, 48607, 210112, 1050560],
  opaleye: [33.9, 0.74, 1.49, 2.63, 6.88, 3788, 22858, 114288],
  blackSeabream: [33.9, 0.89, 1.66, 2.76, 7.46, 5024, 27882, 139412],
  barredKnifejaw: [41.2, 1.85, 3.57, 6.09, 7.43, 12174, 71994, 359969],
  redSeabream: [45.6, 1.51, 3.56, 7.19, 6.23, 6930, 52901, 264507],
  scorpionfish: [20.1, 0.21, 0.36, 0.57, 7.49, 877, 4300, 21500],
  rockfish: [16.5, 0.11, 0.21, 0.34, 7.15, 576, 3062, 15309],
  rabbitfish: [26.5, 0.43, 0.78, 1.26, 7.31, 1133, 5801, 29004],
  threelineGrunt: [26.5, 0.40, 0.69, 1.08, 7.59, 1603, 7680, 38398],
  morayEel: [67.8, 1.61, 2.78, 4.33, 7.59, 3359, 16091, 80454],
  amberjack: [69.7, 5.12, 10.66, 19.38, 6.86, 13351, 85884, 429419],
  zombieShark: [154.9, 37.27, 60.53, 89.88, 8.63, 42645, 204697, 1023486],
  pinkShark: [131.5, 27.95, 45.40, 67.41, 8.63, 34649, 166317, 831583],
  whiteSturgeon: [136.7, 16.30, 40.92, 86.65, 6.19, 20846, 179774, 898872],
  chinookSalmon: [78.5, 6.27, 11.12, 17.76, 7.75, 32577, 169188, 845940],
  steelhead: [63.6, 3.50, 5.41, 7.71, 8.61, 20111, 86720, 433602],
  walleye: [42.2, 1.08, 2.35, 4.41, 6.37, 4509, 29401, 147006],
  smallmouthBass: [27.5, 0.51, 1.07, 1.94, 6.72, 2146, 13515, 67576],
  channelCatfish: [43.9, 1.51, 3.56, 7.19, 5.97, 4158, 30418, 152091],
  americanShad: [37.0, 0.76, 1.24, 1.86, 7.88, 2520, 11297, 56484],
  pikeminnow: [27.5, 0.45, 0.83, 1.38, 7.15, 1047, 5567, 27834],
  cutthroatTrout: [26.5, 0.40, 0.69, 1.08, 7.75, 2481, 12144, 60718],
  largescaleSucker: [32.9, 0.63, 1.11, 1.78, 7.42, 1185, 5896, 29480],
  burbot: [42.2, 0.96, 1.91, 3.33, 6.83, 3418, 19718, 98588],
  paleKing: [122.7, 22.79, 31.57, 41.17, 9.75, 110362, 427685, 2138426],
};

/** stand 에서 yaw 방향 반직선이 해안선 꺾은선을 처음 만나는 거리(없으면 null) */
function rayToShore(stand, yaw, shore) {
  const d = fwd(yaw);
  let best = null;
  for (let i = 1; i < shore.length; i++) {
    const a = shore[i - 1];
    const b = shore[i];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const den = d.x * ez - d.z * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((a.x - stand.x) * ez - (a.z - stand.z) * ex) / den;
    const u = ((a.x - stand.x) * d.z - (a.z - stand.z) * d.x) / den;
    if (t >= 0 && u >= -1e-9 && u <= 1 + 1e-9 && (best === null || t < best)) best = t;
  }
  return best;
}

/** 점에서 볼록 다각형 경계까지의 거리 */
function distToPoly(poly, x, z) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / (ex * ex + ez * ez)));
    best = Math.min(best, Math.hypot(a.x + ex * t - x, a.z + ez * t - z));
  }
  return best;
}
const outsideObstacles = (stage, p) => stage.obstacles.every(o => Math.hypot(p.x - o.x, p.z - o.z) > o.r);

test('어종: 36행 · 스테이지 순서 · ID 유일 · 행 파일과 스테이지 일치', () => {
  assert.equal(SPECIES.length, 36);
  assert.deepEqual(SPECIES.map(s => s.id), [...LAKE_SPECIES, ...COAST_SPECIES, ...RIVER_SPECIES].map(s => s.id));
  assert.equal(new Set(SPECIES.map(s => s.id)).size, 36);
  for (const [rows, stage] of [[LAKE_SPECIES, 'lake'], [COAST_SPECIES, 'coast'], [RIVER_SPECIES, 'river']]) {
    for (const r of rows) check(r.stage === stage, `${r.id}: stage ${r.stage} ≠ 파일 ${stage}`);
  }
  for (const s of SPECIES) check(getSpecies(s.id) === SPECIES_BY_ID[s.id], `${s.id}: getSpecies`);
  assert.throws(() => getSpecies('nope'));
  flush('어종 목록');
});

test('어종: 필수 필드 · 참조 · 형식(SpeciesRow · SpeciesLook)', () => {
  const rowKeys = typeKeys('SpeciesRow');
  for (const s of SPECIES) {
    const id = s.id;
    for (const k of rowKeys) check(k in s, `${id}: 필드 ${k} 없음`);
    check(typeof id === 'string' && /^[a-z][A-Za-z0-9]*$/.test(id), `${id}: camelCase ID`);
    check(STAGE_IDS.includes(s.stage), `${id}: stage`);
    check(subsetOf(s.layers, LAYER_IDS) && s.layers.length >= 1 && s.layers.length <= 2, `${id}: layers`);
    check(/^[0LNH]{5}$/.test(s.time), `${id}: time 형식`);
    check(['float', 'bottom', 'both'].includes(s.method), `${id}: method`);
    check(subsetOf(s.baits, BAIT_IDS) && s.baits.length >= 1 && s.baits.length <= 3 && new Set(s.baits).size === s.baits.length, `${id}: baits`);
    check(STYLE_IDS.includes(s.style) && s.style in STYLES, `${id}: style`);
    check(subsetOf(s.traits, Object.keys(TRAITS)) && s.traits.length <= 2, `${id}: traits`);
    check(isPos(s.lenCm[0]) && s.lenCm[1] > s.lenCm[0], `${id}: lenCm 증가`);
    check(isPos(s.kg[0]) && s.kg[1] > s.kg[0], `${id}: kg 증가`);
    check([1, 2, 3].includes(s.mouth), `${id}: mouth`);
    if (s.fight !== undefined) {
      check(subsetOf(Object.keys(s.fight), ['force', 'speed', 'stamina']) && Object.values(s.fight).every(isPos), `${id}: fight 배율`);
    }
    if (s.bite !== undefined) {
      check(subsetOf(Object.keys(s.bite), ['nibbles', 'take']), `${id}: bite 키`);
      if (s.bite.nibbles) check(Number.isInteger(s.bite.nibbles[0]) && s.bite.nibbles[0] >= 0 && s.bite.nibbles[1] >= s.bite.nibbles[0], `${id}: nibbles`);
      if (s.bite.take) check(['sink', 'lift'].includes(s.bite.take), `${id}: take`);
    }
    check(isPos(s.pricePerKg) && Number.isInteger(s.pricePerKg), `${id}: pricePerKg`);
    check(isNum(s.trophyBonus) && s.trophyBonus >= 0, `${id}: trophyBonus`);
    check(isPos(s.xp), `${id}: xp`);
    if (s.fantasy !== null) {
      check(subsetOf(s.fantasy.bands, BAND_IDS) && s.fantasy.bands.length > 0, `${id}: fantasy.bands`);
      check(subsetOf(s.fantasy.weather, WEATHER_IDS) && s.fantasy.weather.length > 0, `${id}: fantasy.weather`);
      // 판타지 어종의 time 은 조건 시간대만 H, 나머지 0(도감 표시용)
      const expect = BAND_IDS.map(b => (s.fantasy.bands.includes(b) ? 'H' : '0')).join('');
      check(s.time === expect, `${id}: 판타지 time ${s.time} ≠ ${expect}`);
    }
    const L = s.look;
    check(L && BODY_TEMPLATES.includes(L.body), `${id}: look.body`);
    check(isNum(L.depth) && L.depth >= 0.08 && L.depth <= 0.55, `${id}: look.depth`);
    check(Array.isArray(L.colors) && L.colors.length === 4 && L.colors.every(c => HEX.test(c)), `${id}: look.colors`);
    check(PATTERNS.includes(L.pattern), `${id}: look.pattern`);
    check(L.patternColor === null || HEX.test(L.patternColor), `${id}: look.patternColor`);
    if (L.barbels !== undefined) check(Number.isInteger(L.barbels) && L.barbels >= 0, `${id}: barbels`);
    if (L.glow !== undefined) check(L.glow === null || HEX.test(L.glow), `${id}: glow`);
    if (L.accent !== undefined) check(L.accent === null || HEX.test(L.accent), `${id}: accent`);
  }
  flush('어종 스키마');
});

test('어종: 파생 값이 유한하고 §7.3.4 산출 표와 소수 2자리까지 같다(표시 자리의 마지막 한 단위 안)', () => {
  const z45 = normalInv(0.45);
  const z945 = normalInv(0.945);
  const z995 = normalInv(0.995);
  for (const s of SPECIES) {
    const id = s.id;
    for (const k of ['medianCm', 'medianKg', 'trophyKg', 'legendKg', 'trophyCm', 'legendCm']) check(isPos(s[k]), `${id}: ${k}`);
    for (const k of ['mu', 'sigma', 'a', 'b']) check(isNum(s.size[k]), `${id}: size.${k}`);
    check(s.size.sigma > 0 && s.size.b > 0, `${id}: σ · b > 0`);
    check(s.medianKg < s.trophyKg && s.trophyKg < s.legendKg, `${id}: 중앙 < 트로피 < 레전드`);
    check(s.priceMul.normal === 1, `${id}: priceMul.normal`);
    check(Math.abs(s.priceMul.trophy - (2 + s.trophyBonus)) < 1e-12, `${id}: priceMul.trophy = 2 + trophyBonus`);
    check(s.priceMul.legend > s.priceMul.trophy, `${id}: legend 배율 > trophy`);
    const row = DERIVE_TABLE[id];
    check(!!row, `${id}: 산출 표에 없다`);
    if (!row) continue;
    const [mCm, mKg, tKg, lKg, lMul, p45, p945, p995] = row;
    const near = (got, want, tol, what) => check(Math.abs(got - want) <= tol, `${id}: ${what} ${got.toFixed(4)} vs 표 ${want}`);
    near(s.medianCm, mCm, 0.051, '중앙 cm');
    near(s.medianKg, mKg, 0.0101, '중앙 kg');
    near(s.trophyKg, tKg, 0.0101, '트로피 kg');
    near(s.legendKg, lKg, 0.0101, '레전드 kg');
    near(s.priceMul.legend, lMul, 0.0101, '레전드 배율');
    const { mu, sigma, a, b } = s.size;
    const w = (z) => a * Math.exp(b * (mu + z * sigma));
    const rel = (got, want, what) => check(Math.abs(got - want) <= Math.max(1, want * 1e-4), `${id}: ${what} ${got} vs 표 ${want}`);
    rel(Math.round(w(z45) * s.pricePerKg), p45, '중앙가');
    rel(Math.round(w(z945) * s.pricePerKg * s.priceMul.trophy), p945, '트로피 중앙가');
    rel(Math.round(w(z995) * s.pricePerKg * s.priceMul.legend), p995, '레전드 중앙가');
    // 레전드 중앙가 / 트로피 중앙가 = 5.0(배율로 맞춘다)
    const ratio = (w(z995) * s.priceMul.legend) / (w(z945) * s.priceMul.trophy);
    check(Math.abs(ratio - PRICE.legendTargetRatio) < 0.01, `${id}: 레전드/트로피 중앙가 ${ratio}`);
  }
  flush('파생 값');
});

test('스테이지: 레지스트리 · 모양(StageDef) · walk 볼록 · 방향 · 배치', () => {
  assert.deepEqual(STAGES.map(s => s.id), SCENE_IDS);
  for (const s of STAGES) check(getStage(s.id) === STAGES_BY_ID[s.id], `${s.id}: getStage`);
  assert.throws(() => getStage('nope'));
  assert.throws(() => getSpot('nope'));
  const keys = typeKeys('StageDef');
  for (const st of STAGES) {
    const id = st.id;
    for (const k of keys) check(k in st, `${id}: 필드 ${k} 없음`);
    check(['interior', 'outdoor'].includes(st.kind), `${id}: kind`);
    check((id === 'home') === (st.kind === 'interior'), `${id}: 집만 interior`);
    check(Number.isInteger(st.unlockLevel) && st.unlockLevel >= 1 && st.unlockLevel <= XP.levelCap, `${id}: unlockLevel`);
    // walk: 볼록 · 신발끈 합 > 0
    const w = st.walk;
    let area = 0;
    let convex = w.length >= 3;
    for (let i = 0; i < w.length; i++) {
      const a = w[i];
      const b = w[(i + 1) % w.length];
      const c = w[(i + 2) % w.length];
      area += a.x * b.z - b.x * a.z;
      if ((b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x) < 0) convex = false;
    }
    check(area > 0, `${id}: walk 꼭짓점 순서(신발끈 합 > 0)`);
    check(convex, `${id}: walk 볼록`);
    check(pointInConvex(w, st.spawn.x, st.spawn.z) && outsideObstacles(st, st.spawn), `${id}: spawn 이 walk 안 · obstacles 밖`);
    check(isNum(st.spawn.yaw), `${id}: spawn.yaw`);
    for (const o of st.obstacles) check(isPos(o.r) && isNum(o.x) && isNum(o.z), `${id}: obstacle`);
    // 상호작용 점
    const kinds = id === 'home' ? ['pc', 'bed', 'door'] : ['npc', 'camp'];
    check(kinds.every(k => st.points.some(p => p.kind === k)), `${id}: 상호작용 점 ${kinds.join('·')}`);
    for (const p of st.points) {
      check(['npc', 'camp', 'pc', 'bed', 'door'].includes(p.kind), `${id}/${p.id}: kind`);
      const expectId = p.kind === 'npc' ? 'vendor' : p.kind;
      check(p.id === expectId, `${id}/${p.id}: id 규칙(npc → vendor · 그 밖은 kind 이름)`);
      check(isPos(p.radius) && isNum(p.yaw), `${id}/${p.id}: radius · yaw`);
      check(pointInConvex(w, p.x, p.z) || distToPoly(w, p.x, p.z) <= p.radius, `${id}/${p.id}: 점이 walk 안이거나 경계에서 radius 안`);
      check(pointInConvex(w, p.approach.x, p.approach.z), `${id}/${p.id}: approach 가 walk 안`);
      check(outsideObstacles(st, p.approach), `${id}/${p.id}: approach 가 obstacles 밖`);
      check(Math.hypot(p.approach.x - p.x, p.approach.z - p.z) <= p.radius, `${id}/${p.id}: approach 가 radius 안`);
    }
    check(['lake', 'waves', 'river', 'indoor'].includes(st.ambience), `${id}: ambience`);
    check(isNum(st.waves.amp) && st.waves.amp >= 0 && isPos(st.waves.period), `${id}: waves`);
    check(subsetOf(Object.keys(st.weatherWeights), WEATHER_IDS) && WEATHER_IDS.every(k => isNum(st.weatherWeights[k]) && st.weatherWeights[k] >= 0), `${id}: weatherWeights`);
    check(WEATHER_IDS.reduce((a, k) => a + st.weatherWeights[k], 0) > 0, `${id}: weatherWeights 합 > 0`);
    check(st.look && typeof st.look === 'object', `${id}: look`);
    if (st.kind === 'interior') {
      check(st.shore.length === 0 && st.spots.length === 0, `${id}: 실내는 shore · spots 가 비어 있다`);
    } else {
      check(st.shore.length >= 2, `${id}: shore`);
      for (let i = 1; i < st.shore.length; i++) check(st.shore[i].x > st.shore[i - 1].x, `${id}: shore x 오름차순`);
      check(st.spots.length >= 1, `${id}: spots`);
      for (const k of ['terrain', 'water', 'ridge', 'sky', 'fog']) check(st.look[k], `${id}: look.${k}`);
    }
  }
  flush('스테이지');
});

test('낚시 자리: 모양(SpotDef) · stand · edgeM 검산 · 캐스팅 부채꼴은 물 · 수심 · 장애물 띠 · farFromM · 풀', () => {
  const keys = typeKeys('SpotDef');
  const allSpotIds = STAGES.flatMap(s => s.spots.map(p => p.id));
  assert.equal(new Set(allSpotIds).size, allSpotIds.length, '자리 ID 유일');
  assert.deepEqual(Object.keys(SPOTS_BY_ID).sort(), [...allSpotIds].sort());
  for (const st of STAGES) {
    for (const sp of st.spots) {
      const id = sp.id;
      for (const k of keys) check(k in sp, `${id}: 필드 ${k} 없음`);
      check(id.startsWith(st.id + '_'), `${id}: ID 는 <stage>_<name>`);
      check(stageOfSpot(id) === st.id && getSpot(id) === sp, `${id}: stageOfSpot · getSpot`);
      check(pointInConvex(st.walk, sp.stand.x, sp.stand.z) && outsideObstacles(st, sp.stand), `${id}: stand 가 walk 안 · obstacles 밖`);
      check(isNum(sp.facing) && isPos(sp.arc), `${id}: facing · arc`);
      // edgeM = stand 에서 facing 으로 해안선까지(±0.15m)
      const d = rayToShore(sp.stand, sp.facing, st.shore);
      check(d !== null && Math.abs(d - sp.edgeM) <= 0.15, `${id}: edgeM ${sp.edgeM} vs 해안선 ${d === null ? '없음' : d.toFixed(3)}`);
      // 캐스팅 부채꼴(facing ± arc × minCastM..80m)의 착수점은 물 쪽
      for (let ai = -2; ai <= 2; ai++) {
        const yaw = sp.facing + (sp.arc * ai) / 2;
        for (const dist of [sp.minCastM, 15, 30, 50, 80]) {
          const f = fwd(yaw, dist);
          const x = sp.stand.x + f.x;
          const z = sp.stand.z + f.z;
          check(z < shoreZAt(st.shore, x), `${id}: 착수점(${yaw.toFixed(2)}, ${dist}m)이 물 쪽이 아니다`);
        }
      }
      // 수심 프로필: 거리 · 깊이 증가
      check(Array.isArray(sp.depth) && sp.depth.length >= 2, `${id}: depth`);
      for (let i = 0; i < sp.depth.length; i++) {
        check(isNum(sp.depth[i][0]) && isPos(sp.depth[i][1]), `${id}: depth[${i}]`);
        if (i) check(sp.depth[i][0] > sp.depth[i - 1][0] && sp.depth[i][1] >= sp.depth[i - 1][1], `${id}: depth 증가`);
      }
      check(isPos(sp.minCastM) && isPos(sp.maxDriftM) && sp.maxDriftM > sp.minCastM, `${id}: minCastM · maxDriftM`);
      check(sp.snag.fromM > sp.minCastM && isPos(sp.snag.rate), `${id}: snag.fromM > minCastM`);
      check(sp.farFromM === null || (sp.farFromM > sp.minCastM && sp.farFromM <= sp.maxDriftM), `${id}: farFromM`);
      check(isNum(sp.flow.x) && isNum(sp.flow.z), `${id}: flow`);
      check(isNum(sp.abrasion) && sp.abrasion >= 0 && sp.abrasion <= 1, `${id}: abrasion 0..1`);
      check(['mud', 'gravel', 'rock', 'sand'].includes(sp.bottom), `${id}: bottom`);
      check(CAST.minLineM >= sp.minCastM + CAST.lineReserveM, `${id}: CAST.minLineM ≥ minCastM + lineReserveM`);
      // 풀
      check(Array.isArray(sp.pool) && sp.pool.length > 0, `${id}: pool`);
      check(new Set(sp.pool.map(e => e.id)).size === sp.pool.length, `${id}: pool 중복`);
      for (const e of sp.pool) {
        const s = SPECIES_BY_ID[e.id];
        check(!!s, `${id}: pool 의 ${e.id} 가 없다`);
        if (!s) continue;
        check(s.stage === st.id, `${id}: pool 의 ${e.id} 는 ${s.stage} 어종`);
        check(isPos(e.w), `${id}: ${e.id} w > 0`);
        if (s.fantasy !== null) check(e.w === 1, `${id}: 판타지 ${e.id} 의 w 는 1`);
        if (e.farMul !== undefined) check(isPos(e.farMul) && sp.farFromM !== null, `${id}: ${e.id} farMul > 0 · farFromM 있음`);
      }
    }
  }
  flush('낚시 자리');
});

test('완결성: 스테이지마다 어종 ≥ 10 · 모든 어종이 그 스테이지의 풀에 · 층 3 × 시간대 5 칸마다 비판타지 어종 ≥ 1', () => {
  for (const stageId of STAGE_IDS) {
    const list = speciesOfStage(stageId);
    check(list.length >= 10, `${stageId}: 어종 ${list.length} < 10`);
    const pooled = new Set(getStage(stageId).spots.flatMap(sp => sp.pool.map(e => e.id)));
    for (const s of list) check(pooled.has(s.id), `${stageId}: ${s.id} 가 어느 풀에도 없다`);
    for (const layer of LAYER_IDS) {
      BAND_IDS.forEach((band, bi) => {
        const ok = list.some(s => s.fantasy === null && s.layers.includes(layer) && timeCoef(s, bi) > 0);
        check(ok, `${stageId}: ${layer} × ${band} 칸이 비었다`);
      });
    }
  }
  flush('완결성');
});

test('장비 · 미끼 · 스킬', () => {
  // 장비
  assert.equal(new Set(GEAR.map(g => g.id)).size, GEAR.length);
  assert.deepEqual(Object.keys(GEAR_BY_ID).sort(), GEAR.map(g => g.id).sort());
  const need = {
    rod: ['castM', 'maxLoadKg', 'sensitivity', 'lengthM'],
    reel: ['maxDragKg', 'speedMS', 'capacityM', 'castBonus'],
    line: ['strengthKg', 'biteMul', 'abrasionMul', 'pricePerM'],
    hook: ['size'],
    float: ['sensitivity', 'stability', 'driftMul'],
    sinker: ['castBonusM', 'holdMS'],
  };
  for (const g of GEAR) {
    check(GEAR_SLOTS.includes(g.slot), `${g.id}: slot`);
    check([1, 2, 3].includes(g.tier), `${g.id}: tier`);
    check(g.slot === 'rod' ? SET_IDS.includes(g.set) : g.set === null, `${g.id}: set(로드만 세트 전용)`);
    check(Number.isInteger(g.price) && g.price >= 0, `${g.id}: price`);
    check(Number.isInteger(g.lossCost) && g.lossCost >= 0, `${g.id}: lossCost`);
    if (g.tier === 1 || g.slot === 'line') check(g.price === 0, `${g.id}: 1단계 · 라인은 가격 0`);
    for (const k of need[g.slot] || []) check(isNum(g[k]) && g[k] >= 0, `${g.id}: ${k}`);
    const id = g.slot === 'rod' ? `rod_${g.set}_${g.tier}` : g.slot === 'hook' ? null : `${g.slot}_${g.tier}`;
    if (id) check(g.id === id, `${g.id}: ID 규칙 ${id}`);
  }
  for (const slot of GEAR_SLOTS) check(GEAR.some(g => g.slot === slot), `슬롯 ${slot} 장비 없음`);
  check(GEAR_GATES.tier2Level < GEAR_GATES.tier3Level && GEAR_GATES.tier3Mastery >= 1 && GEAR_GATES.tier3Mastery <= 3, 'GEAR_GATES');
  // 시작 세트가 유효한 장비
  for (const set of SET_IDS) {
    const c = START.sets[set];
    check(GEAR_BY_ID[c.rod]?.slot === 'rod' && GEAR_BY_ID[c.rod].set === set, `START ${set}: rod`);
    check(GEAR_BY_ID[c.reel]?.slot === 'reel', `START ${set}: reel`);
    check(GEAR_BY_ID[c.hook]?.slot === 'hook', `START ${set}: hook`);
    check(GEAR_BY_ID[c.lineId]?.slot === 'line', `START ${set}: line`);
    check(set === 'float' ? GEAR_BY_ID[c.float]?.slot === 'float' && c.sinker === null : GEAR_BY_ID[c.sinker]?.slot === 'sinker' && c.float === null, `START ${set}: float/sinker`);
    check(BAIT_IDS.includes(c.bait), `START ${set}: bait`);
    check(c.lineM <= GEAR_BY_ID[c.reel].capacityM && c.lineM >= CAST.minLineM, `START ${set}: lineM`);
  }
  // 미끼
  assert.deepEqual(BAITS.map(b => b.id), BAIT_IDS);
  for (const b of BAITS) check(Number.isInteger(b.packSize) && b.packSize > 0 && Number.isInteger(b.packPrice) && b.packPrice > 0, `${b.id}: 팩`);
  check(Math.min(...BAITS.map(b => b.packPrice)) <= FREE_BAIT.moneyBelow, 'FREE_BAIT.moneyBelow ≥ 가장 싼 팩');
  check(BAIT_IDS.includes(FREE_BAIT.baitId), 'FREE_BAIT.baitId');
  // 스킬 — 한 필드는 스킬 하나만
  assert.deepEqual(SKILLS.map(s => s.id), SKILL_IDS);
  const owner = {};
  for (const s of SKILLS) {
    for (const [field, ranks] of Object.entries(s.effects)) {
      check(!(field in owner), `스킬 필드 ${field} 를 ${owner[field]} 와 ${s.id} 가 같이 건드린다`);
      owner[field] = s.id;
      check(Array.isArray(ranks) && ranks.length === 4, `${s.id}.${field}: 0~3단계 4개`);
    }
  }
  assert.deepEqual(Object.keys(owner).sort(), typeKeys('Modifiers').sort(), 'Modifiers 필드 전부를 스킬이 덮는다');
  flush('장비 · 미끼 · 스킬');
});

test('파이팅 성격 · 특성 · 수치 표', () => {
  assert.deepEqual(Object.keys(STYLES).sort(), [...STYLE_IDS].sort());
  assert.deepEqual(Object.keys(TRAITS).sort(), [...TRAIT_IDS].sort());
  for (const [id, st] of Object.entries(STYLES)) {
    check(isPos(st.force) && isPos(st.speed) && isPos(st.endurance), `${id}: force · speed · endurance`);
    check(st.start in st.states, `${id}: start 상태`);
    for (const [name, def] of Object.entries(st.states)) {
      check(BEHAVIOR_KINDS.includes(def.kind), `${id}.${name}: kind`);
      check(isNum(def.f) && isNum(def.along) && isNum(def.sp), `${id}.${name}: f · along · sp`);
      check(def.dur[0] > 0 && def.dur[1] >= def.dur[0], `${id}.${name}: dur`);
      check(Object.keys(def.next).every(n => n in st.states) && Object.values(def.next).reduce((a, b) => a + b, 0) > 0, `${id}.${name}: next`);
    }
  }
  for (const [id, tr] of Object.entries(TRAITS)) {
    for (const [name, def] of Object.entries(tr.addStates || {})) check(BEHAVIOR_KINDS.includes(def.kind) && def.dur[1] >= def.dur[0], `trait ${id}.${name}`);
    for (const k of Object.keys(tr.scaleByKind || {})) check(BEHAVIOR_KINDS.includes(k), `trait ${id}: scaleByKind ${k}`);
    for (const k of Object.keys(tr.nextMulByKind || {})) check(BEHAVIOR_KINDS.includes(k), `trait ${id}: nextMulByKind ${k}`);
    if (tr.visual !== undefined) check(['tremble', 'spin', null].includes(tr.visual), `trait ${id}: visual`);
  }
  for (const [k, v] of Object.entries(FIGHT)) check(isNum(v), `FIGHT.${k}`);
  for (const [k, v] of Object.entries(HOOK)) check(isNum(v), `HOOK.${k}`);
  check(FIGHT.rodStressAt < 1 && FIGHT.lineDangerAt < 1, 'FIGHT 경고 문턱');
  check(BITE.baitOther > 0, 'BITE.baitOther > 0(아무 미끼로도 무언가는 문다)');
  check(BITE.baitFit.length === 3 && BITE.layerFit.length === 3, 'BITE 표 길이');
  check(Object.keys(BITE.timeCoef).sort().join('') === '0HLN' && BITE.timeCoef['0'] === 0, 'BITE.timeCoef');
  check(SIGNAL.float.takeWindow > 0 && SIGNAL.bottom.takeWindow > 0 && RIG.failNotice > 0 && RIG.netTime > 0, 'SIGNAL · RIG');
  check(LAYER.surfaceMaxM > 0 && LAYER.bottomGapM > 0, 'LAYER');
  check(CAST.depthMinM < CAST.depthMaxM && CAST.depthStepM > 0, 'CAST 수심');
  flush('파이팅 · 입질 표');
});

test('시간 · 날씨 · 월드 · 경제 · 봇 · 설정 · 키 바인딩 표', () => {
  assert.deepEqual(BANDS.map(b => b.id), BAND_IDS);
  // 시간대는 24시간을 빈틈없이 덮는다
  for (let h = 0; h < 24; h += 0.25) {
    const n = BANDS.filter(b => (b.from < b.to ? h >= b.from && h < b.to : h >= b.from || h < b.to)).length;
    check(n === 1, `시간대 ${h}시: ${n}개`);
  }
  check(TIME.sunrise < TIME.sunset && TIME.maxSunElev > 0 && TIME.minSunElev < 0, 'TIME');
  assert.deepEqual(Object.keys(WEATHER), WEATHER_IDS);
  for (const w of Object.values(WEATHER)) check(isPos(w.biteMul) && isPos(w.light) && w.light <= 1 && isNum(w.rain), `WEATHER ${w.id}`);
  check(WORLD.pitchMin < 0 && WORLD.pitchMax > 0 && isPos(WORLD.spotRadius) && isPos(WORLD.walkSpeed), 'WORLD');
  check(XP.levelCap === 20 && isPos(XP.base) && isPos(XP.exp), 'XP');
  check(TIERS.every(t => isPos(XP.tierMul[t])), 'XP.tierMul');
  check(PRICE.trophyPct < PRICE.legendPct && HOLD.capacity > 0, 'PRICE · HOLD');
  check(START.money >= 0 && START.level === 1 && subsetOf(Object.keys(START.baits), BAIT_IDS), 'START');
  // 봇 계획
  for (const [name, plan] of Object.entries(BOT.plans)) {
    if (!plan.byBand) continue;
    check(STAGE_IDS.includes(plan.stage), `BOT.plans.${name}.stage`);
    for (const band of BAND_IDS) {
      const [spotId, set, bait] = plan.byBand[band] || [];
      check(SPOTS_BY_ID[spotId] && stageOfSpot(spotId) === plan.stage, `BOT.plans.${name}.${band}: 자리 ${spotId}`);
      check(SET_IDS.includes(set) && BAIT_IDS.includes(bait), `BOT.plans.${name}.${band}: 세트 · 미끼`);
    }
  }
  const pg = BOT.plans.progress;
  check(pg.buyOrder.every(id => GEAR_BY_ID[id]), 'BOT.progress.buyOrder');
  check(pg.skillOrder.every(id => SKILL_IDS.includes(id)), 'BOT.progress.skillOrder');
  check(GEAR_BY_ID[pg.riverHook]?.slot === 'hook', 'BOT.progress.riverHook');
  // 설정 · 키
  assert.deepEqual(Object.keys(QUALITY), ['low', 'medium', 'high']);
  for (const q of Object.values(QUALITY)) check(q.pixelRatio <= 2, 'QUALITY.pixelRatio ≤ 2');
  check(DEFAULT_SETTINGS.quality in QUALITY && DEFAULT_SETTINGS.version === 1, 'DEFAULT_SETTINGS');
  for (const k of typeKeys('Settings')) check(k in DEFAULT_SETTINGS, `DEFAULT_SETTINGS.${k}`);
  check(isPos(MOUSE.radPerPx) && isPos(MOUSE.spikeClampPx) && isPos(MOUSE.keyYawRate), 'MOUSE');
  check(isPos(WHEEL.pxPerStep) && isPos(WHEEL.linePx), 'WHEEL');
  for (const [k, codes] of Object.entries(KEYBINDS)) check(Array.isArray(codes) && codes.length && codes.every(c => typeof c === 'string' && /^(Key[A-Z]|Digit\d|Arrow\w+|Space|Tab|Escape|Mouse[0-2])$/.test(c)), `KEYBINDS.${k}`);
  flush('표');
});

test('strings.ko.js: 모든 데이터 ID 의 이름 키 · 부록 B 키', () => {
  const need = [];
  for (const s of SPECIES) need.push(`species.${s.id}`);
  for (const id of SCENE_IDS) need.push(`stage.${id}`);
  for (const id of STAGE_IDS) need.push(`stagePlace.${id}`, `npc.${id}.greet`);
  for (const id of Object.keys(SPOTS_BY_ID)) need.push(`spot.${id}`);
  for (const g of GEAR) need.push(`gear.${g.id}`);
  for (const id of BAIT_IDS) need.push(`bait.${id}`);
  for (const id of SKILL_IDS) need.push(`skill.${id}`, `skillDesc.${id}.1`, `skillDesc.${id}.2`, `skillDesc.${id}.3`);
  for (const id of BAND_IDS) need.push(`band.${id}`);
  for (const id of WEATHER_IDS) need.push(`weather.${id}`);
  for (const id of LAYER_IDS) need.push(`layer.${id}`);
  for (const id of SET_IDS) need.push(`set.${id}`);
  for (const id of TIERS) need.push(`tier.${id}`);
  for (const id of STYLE_IDS) need.push(`style.${id}`);
  for (const id of FAIL_REASONS) need.push(`fail.${id}`);
  for (const id of ['slack', 'jump', 'shake', 'active', 'abrasion']) need.push(`fail.cause.${id}`);
  need.push('fail.loss', 'fail.spareSpool', 'fail.dragLowered', 'fail.hookSmall');
  for (const id of REASON_KEYS) need.push(`reason.${id}`);
  for (const id of HINT_IDS) need.push(`hint.${id}.title`, `hint.${id}.body`);
  need.push('fatal.webglTitle', 'fatal.webglBody', 'title.noStorage', 'title.needInput', 'title.saveBroken', 'title.saveFuture', 'save.failed');
  need.push('prompt.clickToLook', 'hud.levelMax', 'hud.skillPoints', 'banner.levelUp', 'banner.tier3');
  need.push('confirm.newGame.title', 'confirm.newGame.body', 'result.swap');
  const missing = need.filter(k => typeof STRINGS[k] !== 'string' || !STRINGS[k].length);
  assert.deepEqual(missing, [], `strings.ko.js 에 없는 키: ${missing.join(', ')}`);
  for (const [k, v] of Object.entries(STRINGS)) check(/^[A-Za-z][\w]*(\.[\w]+)+$/.test(k) && typeof v === 'string', `문자열 키 형식: ${k}`);
  flush('문자열');
});
