// OWNER: P8 — 계약 §12.2 · §9.5 · §9.6
// Node · three 지오메트리만(렌더러 없음): 포즈 순수 함수(걷기 주기 = 거리 / 보폭 — 미끄러짐 없음 · 판정 틱에 무기 끝 자세) ·
// 템플릿 지오메트리 치수(§9.6 — 몸 폭 2 × mon.r ± 0.1 · 높이 ≤ 0.2 · 팔 · 무기 길이 ≤ 0.35) · 몬스터 10 → 120 에서 InstancedMesh 수 그대로.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { EventBus } from '../src/core/events.js';
import { ticks } from '../src/core/time.js';
import { BASES } from '../src/data/items.js';
import { GUARDIANS_BY_ID, MONSTERS_BY_ID, RANKS_BY_ID, getMonDef } from '../src/data/index.js';
import { ActorLayer } from '../src/view/ActorLayer.js';
import { DROP_MESHES, DropInstancer, dropMeshId } from '../src/view/actors/drops.js';
import { CHAR_DIMS, WEAPON_LEN, charParts, weaponGeo } from '../src/view/actors/gear.js';
import { makeCharMaterials, makeInstanceMaterials } from '../src/view/actors/materials.js';
import { MAX_DRAWN, MonsterInstancer, compileType, poseMonster } from '../src/view/actors/monsters.js';
import { PART_MESHES } from '../src/view/actors/parts.js';
import { CharRig, PLAYER_GAIT, PlayerPoser, deadYawOffset, leftHandToGrip, playerLook, styleOf } from '../src/view/actors/player.js';
import { CAM_AZIMUTH } from '../src/core/constants.js';
import { SWING_AT, attackPhase, bipedBase, bipedWalk, footCycle, phaseStep, quadBase, quadWalk, stepLenOf } from '../src/view/actors/poses.js';
import { BJ, BP, QJ, fkBiped, fkQuad, ikLeg, makeJoints, pointOf, posOf } from '../src/view/actors/rig.js';
import { VARIANTS } from '../src/view/actors/variants.js';
import { addTestMonster, makeTestCtx, makeTestState } from './helpers.js';

const TICK = 1000;
/** 소품(무기 · 방패 · 활 …)은 몸 폭 · 높이에서 뺀다 */
const PROPS = new Set(['dagger', 'shortSword', 'shieldBig', 'bow', 'bowString', 'arrow', 'quiver', 'club', 'staffSkull', 'ashRing', 'feathers', 'embers', 'eyes']);
const GEO = {};
const geoOf = (id) => (GEO[id] ??= PART_MESHES[id].make());
const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();

/** 몬스터 상태 리터럴(최소 필드) */
function mon(typeId, o = {}) {
  const def = getMonDef(typeId);
  const rank = o.rank ?? 'normal';
  const sc = RANKS_BY_ID[rank].scale;
  return {
    id: o.id ?? 7, typeId, rank, packId: -1, level: 1, affixes: o.affixes ?? [], name: null,
    pos: { x: o.x ?? 0, z: o.z ?? 0 }, prevPos: { x: o.px ?? o.x ?? 0, z: o.pz ?? o.z ?? 0 }, facing: o.facing ?? 0, vel: { x: 0, z: 0 },
    r: def.radius * sc, height: def.height * sc, scale: sc, hp: 10, hpMax: 10, dmg: 1, speed: def.speed, res: {}, awake: true, targeting: true,
    act: o.act ?? 'idle', actId: o.actId ?? null, actStart: o.actStart ?? 0, actHit: o.actHit ?? 0, actEnd: o.actEnd ?? 0, aim: null, aimLocked: false, readyAt: {},
    st: { stunUntil: 0, stunImmuneUntil: 0, chill: 0, chillDecayAt: 0, freezeUntil: 0, freezeImmuneUntil: 0, burn: null, shockUntil: 0, slow: null, flinchUntil: o.flinchUntil ?? 0, flinchImmuneUntil: 0, knockImmuneUntil: 0, invulnUntil: 0 },
    knock: null, dead: !!o.dead, deadAt: o.deadAt ?? -1, gone: false, launch: o.launch ?? null, ax: {}, flags: { noXp: false, noDrops: false, noGauge: false, revived: false }, lastHit: null, sleepAt: -1,
  };
}
const rec = () => ({ id: 7, seen: 0, fresh: true, px: 0, pz: 0, phase: 0, amt: 0, mdx: 0, mdz: 1, lastNow: 0, snap: null, hasSnap: false, shieldDown: 0, spawnAt: -1 });

/** 그 몬스터의 포즈 → 관절 */
function monJoints(m, now, r = rec()) {
  const rt = compileType(m.typeId);
  const P = new Float32Array(rt.P.N);
  const s = m.r / rt.def.radius;
  poseMonster(rt, m, r, now, 0, P, s, m.pos.x, m.pos.z);
  const J = makeJoints(18);
  rt.fk(rt.dims, P, m.pos.x, m.pos.z, m.facing, J, s);
  return { rt, P, J, s };
}

/** 부위 정점의 월드 범위(소품 제외 · y 띠 선택) */
function extent(rt, J, { y0 = -Infinity, y1 = Infinity, props = false } = {}) {
  const box = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity };
  for (const pt of rt.parts) {
    if (pt.dyn || (!props && PROPS.has(pt.mesh))) continue;
    _m.multiplyMatrices(J[pt.j], pt.local);
    const pos = geoOf(pt.mesh).getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(_m);
      if (_v.y < y0 || _v.y > y1) continue;
      box.x0 = Math.min(box.x0, _v.x); box.x1 = Math.max(box.x1, _v.x);
      box.y0 = Math.min(box.y0, _v.y); box.y1 = Math.max(box.y1, _v.y);
      box.z0 = Math.min(box.z0, _v.z); box.z1 = Math.max(box.z1, _v.z);
    }
  }
  return box;
}

const ALL_TYPES = [...Object.keys(MONSTERS_BY_ID), ...Object.keys(GUARDIANS_BY_ID)];
const JOINT_INDEX = (rt, name) => (rt.rig === 'quad' ? QJ : BJ)[name];

// ───────────────────────── 리그 · IK ─────────────────────────

test('view.actors: 두 마디 IK — 닿는 목표에 발목이 정확히 닿는다(FK 와 같은 식)', () => {
  const d = CHAR_DIMS.warrior;
  const J = makeJoints(18);
  const P = bipedBase({ ...d, hipY: d.hipY, footW: 0.175 });
  for (const [fx, fy, fz] of [[0.175, 0.2, 0.25], [0.25, 0.2, -0.35], [0.12, 0.09, 0.0], [0.3, 0.45, 0.2]]) {
    P[BP.LFX] = fx; P[BP.LFY] = fy; P[BP.LFZ] = fz;
    fkBiped(d, P, 3, -2, 0.7, J, 1);
    const a = posOf(J[BJ.anL], {});
    // 루트 좌표 → 월드: Ry(0.7) · (fx, fy, fz) + (3, 0, −2)
    const c = Math.cos(0.7), s = Math.sin(0.7);
    const wx = 3 + fx * c + fz * s, wz = -2 - fx * s + fz * c;
    assert.ok(Math.hypot(a.x - wx, a.y - fy, a.z - wz) < 1e-4, `ankle ${JSON.stringify(a)} vs ${wx},${fy},${wz}`);
  }
  // ikLeg: 닿지 않는 거리면 다 편다(무릎 0)
  const out = [0, 0, 0];
  ikLeg(0, -5, 0, 0.43, 0.43, 1, out, 0);
  assert.ok(Math.abs(out[2]) < 0.05 && Math.abs(out[0]) < 0.05, `펴진 다리 ${out}`);
});

test('view.actors: 양손 무기 — 왼손이 손잡이에 붙는다(무기가 손을 떠나지 않는다)', () => {
  const d = CHAR_DIMS.warrior;
  const J = makeJoints(18);
  const poser = new PlayerPoser();
  const P = new Float32Array(BP.N);
  for (const [act, now] of [['idle', 50], ['attack', 95], ['attack', 100], ['attack', 106]]) {
    const p = { pos: { x: 0, z: 0 }, prevPos: { x: 0, z: 0 }, facing: 0.3, act, actSkill: 'bash', actStart: 90, actHit: 100, actEnd: 110, dead: false, speed: 0, moving: false };
    poser.pose(P, p, 'warrior', 'twoHand', now, 0, 0, 0);
    fkBiped(d, P, 0, 0, 0.3, J, 1);
    leftHandToGrip(J, d, -0.2);
    const grip = pointOf(J[BJ.wR], 0, -0.2, 0, {});
    const hand = posOf(J[BJ.haL], {});
    const el = posOf(J[BJ.elL], {}), sh = posOf(J[BJ.shL], {});
    assert.ok(Math.hypot(hand.x - grip.x, hand.y - grip.y, hand.z - grip.z) < 0.05, `${act}@${now}: hand-grip ${Math.hypot(hand.x - grip.x, hand.y - grip.y, hand.z - grip.z)}`);
    assert.ok(Math.abs(Math.hypot(el.x - sh.x, el.y - sh.y, el.z - sh.z) - d.upper) < 1e-3, '위팔 길이 그대로');
  }
});

// ───────────────────────── 걷기 — 미끄러짐 없음 ─────────────────────────

/** 일정 속도로 곧게 걷게 하며 디딘 발의 월드 위치가 움직이지 않는지 잰다 → 최대 미끄러짐(m) */
function slipBiped(d, g, speed, frames = 90) {
  const J = makeJoints(18);
  const base = bipedBase(d);
  const P = new Float32Array(BP.N);
  const step = stepLenOf(g, speed);
  let phase = 0, x = 0;
  const dt = 1 / 60;
  const last = [null, null];
  let maxSlip = 0, plantedFrames = 0;
  for (let f = 0; f < frames; f++) {
    const dist = speed * dt;
    x += dist;
    phase = (phase + phaseStep(dist, step)) % 1;
    P.set(base);
    const planted = bipedWalk(P, d, g, phase, step, 0, 1, 1);
    fkBiped(d, P, 0, x, 0, J, 1);
    for (let side = 0; side < 2; side++) {
      const on = planted & (side === 0 ? 1 : 2);
      const a = posOf(J[side === 0 ? BJ.anL : BJ.anR], {});
      if (on && last[side]) {
        maxSlip = Math.max(maxSlip, Math.hypot(a.x - last[side].x, a.z - last[side].z), Math.abs(a.y - d.ankleY));
        plantedFrames++;
      }
      last[side] = on ? a : null;
    }
  }
  return { maxSlip, plantedFrames };
}

test('view.actors: 걷기 주기 = 거리 / 보폭 — 보폭 1.4m at 6 m/s · 속도에 비례 · 위상 증가 = 거리 / (2 × 보폭)', () => {
  assert.equal(stepLenOf(PLAYER_GAIT, 6), 1.4);
  assert.ok(Math.abs(stepLenOf(PLAYER_GAIT, 3) - 0.7) < 1e-9, '보폭은 속도에 비례');
  assert.ok(Math.abs(phaseStep(1.4, 1.4) - 0.5) < 1e-12, '한 걸음 = 반 주기');
  // 디딤 구간: 진폭 A 에서 −A 로 위상에 선형 — 루트 좌표 변화 = 몸이 간 거리
  const o = { f: 0, h: 0 };
  const S = PLAYER_GAIT.stance, A = S * 1.4;
  footCycle(0.1, S, A, 0.2, o); const f1 = o.f;
  footCycle(0.2, S, A, 0.2, o); const f2 = o.f;
  assert.ok(Math.abs((f1 - f2) - phaseToDist(0.1, 1.4)) < 1e-9, '디딘 발의 루트 좌표 이동 = 몸 이동');
});
function phaseToDist(dPhase, step) { return dPhase * 2 * step; }

test('view.actors: 디딘 발이 미끄러지지 않는다(FK · 플레이어 6 · 3 m/s · 구울 · 소인 · 해골 · 거인)', () => {
  const cases = [
    ['player 6m/s', CHAR_DIMS.warrior, PLAYER_GAIT, 6, 0.175],
    ['player 3m/s', CHAR_DIMS.warrior, PLAYER_GAIT, 3, 0.175],
    ...['ghoul', 'fallen', 'archer', 'boneGiant', 'boneling'].map((v) => [v, VARIANTS[v].dims, VARIANTS[v].gait, VARIANTS[v].gait.refSpeed, VARIANTS[v].dims.footW]),
  ];
  for (const [name, dims, g, speed] of cases) {
    const { maxSlip, plantedFrames } = slipBiped(dims, g, speed);
    assert.ok(plantedFrames > 20, `${name}: 디딘 프레임 ${plantedFrames}`);
    assert.ok(maxSlip < 0.01, `${name}: 미끄러짐 ${maxSlip.toFixed(4)}m`);
  }
});

test('view.actors: 네 발 걷기도 디딘 발이 미끄러지지 않는다(돌격 짐승 속보)', () => {
  const v = VARIANTS.charger;
  const d = v.dims, g = v.gait;
  const J = makeJoints(18);
  const base = quadBase(d);
  const P = new Float32Array(base.length);
  const step = stepLenOf(g, g.refSpeed);
  let phase = 0, z = 0, maxSlip = 0, n = 0;
  const last = [null, null, null, null];
  const feet = [QJ.flF, QJ.frF, QJ.blF, QJ.brF];
  for (let f = 0; f < 90; f++) {
    const dist = g.refSpeed / 60;
    z += dist;
    phase = (phase + phaseStep(dist, step)) % 1;
    P.set(base);
    const planted = quadWalk(P, d, g, phase, step, 0, 1, 1);
    fkQuad(d, P, 0, z, 0, J, 1);
    for (let i = 0; i < 4; i++) {
      const on = planted & (1 << i);
      const a = posOf(J[feet[i]], {});
      if (on && last[i]) { maxSlip = Math.max(maxSlip, Math.hypot(a.x - last[i].x, a.z - last[i].z)); n++; }
      last[i] = on ? a : null;
    }
  }
  assert.ok(n > 40 && maxSlip < 0.01, `quad 미끄러짐 ${maxSlip.toFixed(4)} (${n})`);
});

test('view.actors: 몬스터 걷기 위상은 그린 위치의 이동 거리로 진행한다(뒷걸음은 발이 뒤로 — 미끄러짐 없음)', () => {
  const m = mon('skeletonArcher', { act: 'move', facing: 0 });
  const r = rec();
  const rt = compileType('skeletonArcher');
  const P = new Float32Array(rt.P.N);
  const J = makeJoints(18);
  let z = 0, maxSlip = 0, n = 0;
  const last = [null, null];
  for (let f = 0; f < 120; f++) {
    // 뒤로 2.56 m/s(궁수 뒷걸음) — facing 0 은 +Z 앞
    const dz = -2.56 / 60;
    m.prevPos = { x: 0, z };
    z += dz;
    m.pos = { x: 0, z };
    poseMonster(rt, m, r, TICK + f * 0.5, 0, P, 1, 0, z);
    rt.fk(rt.dims, P, 0, z, 0, J, 1);
    for (let side = 0; side < 2; side++) {
      const a = posOf(J[side === 0 ? BJ.anL : BJ.anR], {});
      const planted = Math.abs(a.y - rt.dims.ankleY) < 1e-3;
      if (planted && last[side] && f > 20) { maxSlip = Math.max(maxSlip, Math.hypot(a.x - last[side].x, a.z - last[side].z)); n++; }
      last[side] = planted ? a : null;
    }
  }
  assert.ok(n > 20, `디딘 프레임 ${n}`);
  assert.ok(maxSlip < 0.02, `뒷걸음 미끄러짐 ${maxSlip.toFixed(4)}`);
});

// ───────────────────────── 판정 틱 자세 ─────────────────────────

test('view.actors: 판정 틱(actHit)에 몬스터의 팔 · 무기 · 뿔 끝이 r + reach 에 닿아 있다(차이 ≤ 0.35 · 정예 배율 포함) · 예비 자세에서는 닿지 않는다', () => {
  for (const [typeId, def] of Object.entries({ ...MONSTERS_BY_ID, ...GUARDIANS_BY_ID })) {
    const rt = compileType(typeId);
    for (const atk of def.attacks) {
      if (atk.kind !== 'melee') continue;
      const tip = rt.tips[atk.id];
      assert.ok(tip, `${typeId}.${atk.id}: 판정 끝점이 변형 표에 있다`);
      const ranks = def.eliteOk ? ['normal', 'champion', 'elite'] : [def.behavior === 'guardian' ? 'guardian' : 'normal'];
      for (const rank of ranks) {
        const hitM = mon(typeId, { rank, act: 'strike', actId: atk.id, actStart: TICK - ticks(atk.windup), actHit: TICK, actEnd: TICK + ticks(atk.recover) });
        const { J } = monJoints(hitM, TICK);
        const p = pointOf(J[JOINT_INDEX(rt, tip[0])], tip[1][0], tip[1][1], tip[1][2], {});
        const dist = Math.hypot(p.x, p.z), want = hitM.r + atk.reach;
        assert.ok(Math.abs(dist - want) <= 0.35, `${typeId}.${atk.id}(${rank}): 끝 ${dist.toFixed(2)} vs r + reach ${want.toFixed(2)}`);
        assert.ok(p.z > 0, '앞쪽(+Z)');
        // 예비(「뒤로 빼기」가 끝난 순간 — u = SWING_AT): 끝이 판정 자세보다 확실히 뒤에 있다(예고 자세인 채 피해가 들어가지 않는다)
        const wu = Math.max(4, ticks(atk.windup));
        const windM = { ...hitM, act: 'windup', actStart: TICK - wu };
        const tPull = windM.actStart + SWING_AT * (TICK - 1 - windM.actStart);
        const w = monJoints(windM, tPull);
        const pw = pointOf(w.J[JOINT_INDEX(rt, tip[0])], tip[1][0], tip[1][1], tip[1][2], {});
        const back = dist - Math.hypot(pw.x, pw.z);
        assert.ok(back >= (rt.rig === 'quad' ? 0.12 : 0.3), `${typeId}.${atk.id}(${rank}): 예비 끝이 판정 자세보다 ${back.toFixed(2)}m 뒤`);
      }
    }
  }
});

/** 플레이어 강타의 무기 끝(판정 자세) */
function bashTip(look, now = 100) {
  const d = CHAR_DIMS.warrior;
  const it = (baseId) => ({ id: 'x' + baseId, baseId, tier: 0, rarity: 'normal' });
  const char = { cls: 'warrior', equip: { mainHand: it(look) } };
  const L = playerLook(char);
  const style = styleOf(L);
  const poser = new PlayerPoser();
  const P = new Float32Array(BP.N);
  const p = { pos: { x: 0, z: 0 }, prevPos: { x: 0, z: 0 }, facing: 0, act: 'attack', actSkill: 'bash', actStart: 90, actHit: 100, actEnd: 110, dead: false, speed: 0, moving: false };
  poser.pose(P, p, 'warrior', style, now, 0, 0, 0);
  const J = makeJoints(18);
  fkBiped(d, P, 0, 0, 0, J, 1);
  if (style === 'twoHand') leftHandToGrip(J, d, -0.2);
  return pointOf(J[BJ.wR], 0, WEAPON_LEN[look], 0, {});
}

test('view.actors: 플레이어 강타 — 판정 틱에 무기 끝이 0.4 + 1.1(± 0.35)에 · 예비(뒤로 빼기)에서는 몸 가까이', () => {
  for (const look of ['sword', 'axe', 'mace', 'greatsword', 'greataxe']) {
    const p = bashTip(look, 100);
    const dist = Math.hypot(p.x, p.z);
    assert.ok(Math.abs(dist - 1.5) <= 0.35, `${look}: 판정 자세 끝 ${dist.toFixed(2)}`);
    assert.ok(p.z > 0.6 && p.y > 0.1 && p.y < 2.2, `${look}: 앞 · 높이 ${p.y.toFixed(2)}`);
    // 판정 자세는 actHit 앞뒤 1틱 붙잡는다 · 예비 초반은 무기가 뒤 · 위
    const w = bashTip(look, 90 + SWING_AT * 9);
    assert.ok(w.z < p.z - 0.5, `${look}: 예비 끝 z ${w.z.toFixed(2)} < 판정 ${p.z.toFixed(2)}`);
  }
  const ph = { stage: 0, u: 0, r: 0 };
  attackPhase(100, 90, 100, 110, ph);
  assert.equal(ph.stage, 1, 'actHit 은 판정 자세');
  attackPhase(99.2, 90, 100, 110, ph);
  assert.equal(ph.stage, 1, 'actHit − 1 부터 판정 자세(두 틱 붙잡기)');
  attackPhase(95, 90, 100, 110, ph);
  assert.equal(ph.stage, 0);
  attackPhase(104, 90, 100, 110, ph);
  assert.equal(ph.stage, 2);
});

test('view.actors: 회오리 — 무기 수평 · 끝 회전 반지름 1.4 ~ 2.0(§9.6) · 초당 3바퀴', () => {
  const d = CHAR_DIMS.warrior;
  const poser = new PlayerPoser();
  const P = new Float32Array(BP.N);
  const J = makeJoints(18);
  const p = { pos: { x: 0, z: 0 }, prevPos: { x: 0, z: 0 }, facing: 0, act: 'channel', actSkill: 'whirlwind', actStart: 0, actHit: 0, actEnd: 50, channel: { skillId: 'whirlwind', startedAt: 0, nextAt: 0 }, dead: false, speed: 0, moving: false };
  poser.pose(P, p, 'warrior', 'oneHand', 10, 0, 0, 0);
  assert.ok(Math.abs(P[BP.RYAW] - (10 / 30) * 3 * 2 * Math.PI) < 1e-6, '초당 3바퀴(틱으로)');
  fkBiped(d, P, 0, 0, 0, J, 1);
  const tip = pointOf(J[BJ.wR], 0, WEAPON_LEN.sword, 0, {});
  const hand = posOf(J[BJ.haR], {});
  const rad = Math.hypot(tip.x, tip.z);
  assert.ok(rad >= 1.4 && rad <= 2.0, `회전 반지름 ${rad.toFixed(2)}`);
  assert.ok(Math.abs(tip.y - hand.y) < 0.25, `무기 수평(끝 높이 ${tip.y.toFixed(2)} · 손 ${hand.y.toFixed(2)})`);
});

test('view.actors: 도약 포물선 최고 2.0m(중간) · 순간이동 판정 틱 전후 0.1초 투명 · 사망 0.6초에 쓰러짐', () => {
  const poser = new PlayerPoser();
  const P = new Float32Array(BP.N);
  const land = ticks(0.45);
  const p = { pos: { x: 0, z: 0 }, prevPos: { x: 0, z: 0 }, facing: 0, act: 'leap', actSkill: 'leap', actStart: 100, actHit: 100 + ticks(0.55), actEnd: 100 + ticks(0.7), air: { from: { x: 0, z: 0 }, to: { x: 5, z: 0 }, start: 100 + ticks(0.1), end: 100 + ticks(0.55), kind: 'leap' }, dead: false, speed: 0, moving: false };
  const mid = (p.air.start + 100 + land) / 2;
  poser.pose(P, p, 'warrior', 'oneHand', mid, 0, 0, 0);
  assert.ok(Math.abs(P[BP.RY] - 2.0) < 0.05, `최고 ${P[BP.RY]}`);
  poser.pose(P, p, 'warrior', 'oneHand', 100 + land + 1, 0, 0, 0);
  assert.equal(P[BP.RY], 0, '착지 뒤 땅');
  const b = { ...p, act: 'blink', actSkill: 'teleport', actStart: 100, actHit: 105, actEnd: 108, air: null };
  assert.equal(poser.pose(P, b, 'mage', 'wand', 105, 0, 0, 0), 0, '판정 틱 투명');
  assert.equal(poser.pose(P, b, 'mage', 'wand', 108, 0, 0, 0), 1, '0.1초 뒤 불투명');
  assert.equal(poser.pose(P, b, 'mage', 'wand', 102, 0, 0, 0), 1, '0.1초 전 불투명');
  const dead = { ...p, act: 'dead', dead: true, deadAt: 100, air: null };
  poser.pose(P, dead, 'warrior', 'oneHand', 100 + ticks(0.6), 0, 0, 0);
  assert.ok(P[BP.RPITCH] < -1.3, '0.6초에 누웠다');
});

test('view.actors: 방패 해골 — idle · 예비는 방패가 앞(정면 막기) · 후딜 · 기절 · 빙결 · 경직은 방패를 내린다', () => {
  const faceOf = (m) => {
    const { J } = monJoints(m, TICK);
    // 방패 얼굴 = 아래팔 틀의 +X
    const e = J[BJ.elL].elements;
    const n = Math.hypot(e[0], e[1], e[2]);
    return { fwd: e[2] / n, lat: e[0] / n };
  };
  const base = { actId: 'shieldBash', actStart: TICK - 10, actHit: TICK + 5, actEnd: TICK + 26 };
  for (const act of ['idle', 'windup']) {
    const f = faceOf(mon('shieldSkeleton', { act, ...base }));
    assert.ok(f.fwd > 0.6, `${act}: 방패가 앞을 본다(${f.fwd.toFixed(2)})`);
  }
  for (const act of ['recover', 'stunned', 'frozen', 'flinch']) {
    const f = faceOf(mon('shieldSkeleton', { act, ...base, actHit: TICK - 6, flinchUntil: TICK + 4 }));
    assert.ok(f.fwd < 0.35, `${act}: 방패를 내렸다(앞 ${f.fwd.toFixed(2)})`);
  }
});

test('view.actors: 빙결은 마지막 자세 그대로 · 시체는 0.4초에 쓰러지고 launch 면 날아간다(위 4 m/s · 중력 15)', () => {
  const r = rec();
  const atk = mon('ghoul', { act: 'windup', actId: 'claw', actStart: TICK - 10, actHit: TICK + 6, actEnd: TICK + 24 });
  const a = monJoints(atk, TICK, r);
  const frozen = { ...atk, act: 'frozen', actId: null };
  const b = monJoints(frozen, TICK + 3, r);
  assert.deepEqual(Array.from(b.P), Array.from(a.P), '빙결 자세 = 직전 자세');
  // 시체
  const d0 = monJoints(mon('ghoul', { dead: true, deadAt: TICK }), TICK + ticks(0.5));
  assert.ok(d0.P[BP.RPITCH] < -1.3, '쓰러짐');
  const fly = mon('ghoul', { dead: true, deadAt: TICK, launch: { x: 7, z: 0 } });
  const apex = monJoints(fly, TICK + ticks(4 / 15));
  const land = monJoints(fly, TICK + ticks(1.0));
  const c0 = posOf(apex.J[BJ.chest], {}), c1 = posOf(land.J[BJ.chest], {});
  assert.ok(c0.y > 1.0, `날아가는 중 높이 ${c0.y.toFixed(2)}`);
  assert.ok(c1.x > 3.3 && c1.x < 4.5 && c1.y < 0.5, `착지(수평 7 m/s × 0.53초 ≈ 3.7m · ${c1.x.toFixed(2)}, ${c1.y.toFixed(2)})`);
});

// ───────────────────────── 치수(§9.6) ─────────────────────────

test('view.actors: 템플릿 몸 폭 = 2 × mon.r ± 0.1 · 모델 높이 = mon.height ± 0.2 — 10종 + 수호자 2 · 등급 배율', () => {
  for (const typeId of ALL_TYPES) {
    const def = getMonDef(typeId);
    const ranks = def.eliteOk ? ['normal', 'champion', 'elite'] : [def.behavior === 'guardian' ? 'guardian' : 'normal'];
    for (const rank of ranks) {
      const m = mon(typeId, { rank });
      const { rt, J } = monJoints(m, TICK);
      const b = extent(rt, J);
      const w = b.x1 - b.x0;
      assert.ok(Math.abs(w - 2 * m.r) <= 0.1, `${typeId}(${rank}): 몸 폭 ${w.toFixed(3)} vs 2r ${(2 * m.r).toFixed(3)}`);
      assert.ok(Math.abs(b.y1 - m.height) <= 0.2, `${typeId}(${rank}): 높이 ${b.y1.toFixed(2)} vs ${m.height.toFixed(2)}`);
      assert.ok(b.y0 > -0.06, `${typeId}: 땅 아래로 파묻히지 않는다(${b.y0.toFixed(3)})`);
    }
  }
});

test('view.actors: 플레이어 — 어깨 폭 0.48~0.52 · 발 사이 0.35 · 키 1.8 · 무기 길이(§9.5)', () => {
  for (const [cls, w0, w1] of [['warrior', 0.48, 0.54], ['mage', 0.46, 0.52]]) {
    const d = CHAR_DIMS[cls];
    const parts = charParts(playerLook({ cls, equip: {} }), d);
    const poser = new PlayerPoser();
    const P = new Float32Array(BP.N);
    poser.pose(P, { pos: { x: 0, z: 0 }, prevPos: { x: 0, z: 0 }, facing: 0, act: 'idle', dead: false, speed: 0, moving: false }, cls, 'fist', 10, 0, 0, 0);
    P[BP.LSHA] = 0; P[BP.RSHA] = 0;
    const J = makeJoints(18);
    fkBiped(d, P, 0, 0, 0, J, 1);
    const shY = posOf(J[BJ.shL], {}).y;
    let x0 = Infinity, x1 = -Infinity, top = -Infinity;
    for (const pt of parts) {
      const pos = pt.geo.getAttribute('position');
      const M = J[BJ[pt.joint]];
      for (let i = 0; i < pos.count; i++) {
        _v.fromBufferAttribute(pos, i).applyMatrix4(M);
        top = Math.max(top, _v.y);
        if (pt.joint.startsWith('sh') && _v.y > shY - 0.08) { x0 = Math.min(x0, _v.x); x1 = Math.max(x1, _v.x); }
      }
    }
    assert.ok(x1 - x0 >= w0 && x1 - x0 <= w1, `${cls}: 어깨 폭 ${(x1 - x0).toFixed(3)}`);
    const aL = posOf(J[BJ.anL], {}), aR = posOf(J[BJ.anR], {});
    assert.ok(Math.abs(Math.hypot(aL.x - aR.x, aL.z - aR.z) - 0.35) <= 0.05, `${cls}: 발 사이`);
    assert.ok(Math.abs(top - 1.8) <= 0.1, `${cls}: 키 ${top.toFixed(2)}`);
    for (const p of parts) p.geo.dispose();
  }
  for (const look of ['sword', 'axe', 'mace', 'greatsword', 'greataxe', 'wand']) {
    const g = weaponGeo({ look, tier: 2, rarity: 'legendary', legendary: true });
    g.main.computeBoundingBox();
    g.glow.computeBoundingBox();
    const len = Math.max(g.main.boundingBox.max.y, g.glow.boundingBox.max.y);
    assert.ok(Math.abs(len - WEAPON_LEN[look]) <= 0.06, `${look}: 길이 ${len.toFixed(3)} vs ${WEAPON_LEN[look]}`);
    assert.ok(g.glow, `${look}: 전설은 주황 발광 띠`);
  }
  const st = weaponGeo({ look: 'staff', tier: 0, rarity: 'normal' });
  st.main.computeBoundingBox();
  assert.ok(Math.abs(st.main.boundingBox.max.y - st.main.boundingBox.min.y - 1.7) <= 0.08, 'staff 전체 1.7m');
});

test('view.actors: 장비 외형 — 무기 7종 · 단계 3 · 세트 녹색 띠가 부위를 바꾼다 · 빈 부위는 기본 옷', () => {
  const it = (baseId, tier, extra = {}) => ({ id: 'i' + baseId + tier, baseId, tier, rarity: 'normal', ...extra });
  const sig = (char) => charParts(playerLook(char), CHAR_DIMS[char.cls]).map((p) => p.joint + ':' + p.mat + ':' + p.geo.getAttribute('position').count).join('|');
  const bare = sig({ cls: 'warrior', equip: {} });
  const seen = new Set();
  for (const t of [0, 1, 2]) {
    const s = sig({ cls: 'warrior', equip: { helm: it('helm', t), chest: it('chest', t), gloves: it('gloves', t), boots: it('boots', t) } });
    assert.notEqual(s, bare, `단계 ${t} 는 기본 옷과 다르다`);
    assert.ok(!seen.has(s), `단계 ${t} 는 다른 단계와 다르다`);
    seen.add(s);
  }
  const set = sig({ cls: 'warrior', equip: { chest: it('chest', 1, { rarity: 'set', setPieceId: 'ironLordPlate' }) } });
  const plain = sig({ cls: 'warrior', equip: { chest: it('chest', 1) } });
  assert.notEqual(set, plain, '세트 띠');
  const looks = new Set(BASES.filter((b) => b.slot === 'mainHand').map((b) => b.look));
  assert.equal(looks.size, 7, '무기 외형 7종');
  for (const look of looks) assert.ok(weaponGeo({ look, tier: 0, rarity: 'normal' }), look);
  // 마법사 기본 = 두건 · 긴 옷자락(전사보다 부위가 많다)
  assert.ok(charParts(playerLook({ cls: 'mage', equip: {} }), CHAR_DIMS.mage).length > charParts(playerLook({ cls: 'warrior', equip: {} }), CHAR_DIMS.warrior).length);
});

// ───────────────────────── 인스턴싱 · 레이어 ─────────────────────────

function fakeRc() { return { layers: { world: new THREE.Group(), actors: new THREE.Group(), fx: new THREE.Group() } }; }
function countInstanced(root) {
  let n = 0;
  root.traverse((o) => { if (o.isInstancedMesh) n++; });
  return n;
}
function stateWith(n, opts = {}) {
  const state = makeTestState({ scene: 'rift' });
  const ctx = makeTestCtx(state);
  const types = Object.keys(MONSTERS_BY_ID);
  for (let i = 0; i < n; i++) {
    const m = addTestMonster(ctx, { typeId: types[i % types.length], x: 18 + (i % 12) * 1.4, z: 18 + Math.floor(i / 12) * 1.4 });
    if (opts.rank) m.rank = opts.rank;
  }
  return state;
}

test('view.actors: 몬스터 10 → 120 에서 InstancedMesh 수 · 장면 자식 수가 그대로(드로콜이 수에 비례하지 않는다)', () => {
  const rc = fakeRc();
  const layer = new ActorLayer({ rc, bus: new EventBus(), settings: { quality: 'medium' } });
  const before = countInstanced(rc.layers.actors);
  const s10 = stateWith(10);
  layer.update(s10, 1, 1 / 60, { x: 24, z: 24 });
  const n10 = countInstanced(rc.layers.actors);
  let children10 = 0; rc.layers.actors.traverse(() => children10++);
  assert.equal(layer.info().monstersDrawn, 10);
  const s120 = stateWith(120);
  layer.update(s120, 1, 1 / 60, { x: 24, z: 24 });
  const n120 = countInstanced(rc.layers.actors);
  let children120 = 0; rc.layers.actors.traverse(() => children120++);
  assert.equal(layer.info().monstersDrawn, 120);
  assert.equal(n10, before);
  assert.equal(n120, n10);
  assert.equal(children120, children10);
  // 보이는 인스턴스 메시 수도 몬스터 수와 무관(종류가 같으면 같다)
  let vis10 = 0, vis120 = 0;
  layer.update(s10, 1, 1 / 60, { x: 24, z: 24 });
  rc.layers.actors.traverse((o) => { if (o.isInstancedMesh && o.visible && o.count > 0) vis10++; });
  layer.update(s120, 1, 1 / 60, { x: 24, z: 24 });
  rc.layers.actors.traverse((o) => { if (o.isInstancedMesh && o.visible && o.count > 0) vis120++; });
  assert.equal(vis120, vis10);
  layer.dispose();
  assert.equal(rc.layers.actors.children.length, 0, 'dispose 뒤 남는 것 없음');
});

test('view.actors: 인스턴스 배율 = mon.r / def.radius(정예 몸 폭 2 × mon.r — scale 을 두 번 곱하지 않는다) · 상한 MAX_DRAWN · 32m 컬링', () => {
  const group = new THREE.Group();
  const inst = new MonsterInstancer(group, makeInstanceMaterials());
  const elite = mon('ghoul', { rank: 'elite', x: 10, z: 10, id: 1 });
  inst.update({ mons: [elite] }, TICK, 1, 0, { x: 10, z: 10 }, null, true);
  const torso = inst.meshes.torsoHunch;
  assert.equal(torso.n, 1);
  const M = new THREE.Matrix4().fromArray(torso.mat, 0);
  const sx = new THREE.Vector3().setFromMatrixColumn(M, 0).length();
  const part = compileType('ghoul').parts.find((p) => p.mesh === 'torsoHunch');
  assert.ok(Math.abs(sx - part.size[0] * 1.3) < 1e-4, `몸통 배율 ${sx} = 부위 ${part.size[0]} × 1.3`);
  // 상한
  const many = [];
  for (let i = 0; i < MAX_DRAWN + 40; i++) many.push(mon('fallen', { id: 100 + i, x: 10 + (i % 20) * 0.8, z: 10 + Math.floor(i / 20) * 0.8 }));
  inst.update({ mons: many }, TICK, 1, 0, { x: 18, z: 13 }, null, true);
  assert.equal(inst.drawn, MAX_DRAWN);
  // 컬링
  inst.update({ mons: [mon('fallen', { id: 999, x: 60, z: 60 })] }, TICK, 1, 0, { x: 10, z: 10 }, null, true);
  assert.equal(inst.drawn, 0);
  inst.dispose();
});

test('view.actors: 가림 외곽선은 챔피언 · 정예 · 수호자만(쌍둥이가 같은 instanceMatrix) · 일반은 검정(안 보임)', () => {
  const group = new THREE.Group();
  const inst = new MonsterInstancer(group, makeInstanceMaterials());
  const e = inst.meshes.limb;
  assert.equal(e.twin.instanceMatrix, e.mesh.instanceMatrix, '쌍둥이가 행렬 버퍼를 같이 쓴다');
  inst.update({ mons: [mon('ghoul', { id: 1 })] }, TICK, 1, 0, { x: 0, z: 0 }, null, true);
  assert.equal(e.twin.visible, false, '일반만 있으면 외곽선 메시를 그리지 않는다');
  for (const rank of ['champion', 'elite']) {
    inst.update({ mons: [mon('ghoul', { id: 2, rank })] }, TICK, 1, 0, { x: 0, z: 0 }, null, true);
    assert.equal(e.twin.visible, true, rank);
    assert.ok(e.tcol[0] + e.tcol[1] + e.tcol[2] > 0.1);
  }
  inst.update({ mons: [mon('boneGiant', { id: 3, rank: 'guardian' })] }, TICK, 1, 0, { x: 0, z: 0 }, null, true);
  assert.equal(inst.meshes.bone.twin.visible, true, '수호자');
  inst.dispose();
});

test('view.actors: 모든 종류 × 행동 · 등급 · 속성 조합에서 인스턴스 행렬 · 색이 유한수(NaN 0)', () => {
  const group = new THREE.Group();
  const inst = new MonsterInstancer(group, makeInstanceMaterials());
  const acts = ['idle', 'move', 'windup', 'cast', 'swell', 'channel', 'strike', 'recover', 'charge', 'stunned', 'frozen', 'flinch', 'flee', 'vanish', 'spawning'];
  let id = 1;
  const mons = [];
  for (const typeId of ALL_TYPES) {
    const def = getMonDef(typeId);
    for (const act of acts) {
      for (const atk of [def.attacks[0], def.attacks[def.attacks.length - 1]]) {
        mons.push(mon(typeId, { id: id++, act, actId: atk.id, actStart: TICK - 8, actHit: TICK + (id % 5) - 2, actEnd: TICK + 12, x: 5 + (id % 13), z: 5 + (id % 11), px: 4.9 + (id % 13), pz: 5 + (id % 11), affixes: id % 3 ? ['tough'] : [], rank: def.eliteOk && id % 4 === 0 ? 'elite' : 'normal', flinchUntil: TICK + 3 }));
      }
    }
    mons.push(mon(typeId, { id: id++, dead: true, deadAt: TICK - 10, x: 8, z: 8 }));
    mons.push(mon(typeId, { id: id++, dead: true, deadAt: TICK - 3, launch: { x: -5, z: 3 }, x: 9, z: 8 }));
    mons.push(mon(typeId, { id: id++, dead: true, deadAt: TICK - 170, x: 10, z: 8 }));
  }
  for (let f = 0; f < 4; f++) {
    for (let k = 0; k < mons.length; k += MAX_DRAWN) {
      inst.update({ mons: mons.slice(k, k + MAX_DRAWN) }, TICK + f, 0.3 * f, f * 0.1, { x: 10, z: 10 }, mons[k].id, true);
      for (const key of Object.keys(inst.meshes)) {
        const e = inst.meshes[key];
        for (let i = 0; i < e.n * 16; i++) assert.ok(Number.isFinite(e.mat[i]), `${key} 행렬 ${i}`);
        for (let i = 0; i < e.n * 3; i++) assert.ok(Number.isFinite(e.col[i]), `${key} 색`);
        if (!e.glowMat) for (let i = 0; i < e.n * 4; i++) assert.ok(Number.isFinite(e.glow[i]), `${key} 발광`);
      }
    }
  }
  inst.dispose();
});

test('view.actors: 바닥 아이템 — 부위별 메시 · 등장 호(0.35초 · 높이 1m) · 전설 · 세트 빛기둥 · 골드 3단계', () => {
  for (const b of BASES) {
    const id = dropMeshId({ kind: 'item', item: { baseId: b.id }, amount: 1 });
    assert.ok(DROP_MESHES[id], `${b.id} → ${id}`);
  }
  assert.deepEqual([6, 48, 320].map((a) => dropMeshId({ kind: 'gold', amount: a })), ['gold0', 'gold1', 'gold2']);
  const group = new THREE.Group();
  const di = new DropInstancer(group, makeInstanceMaterials());
  const mk = (id, rarity, born, x = 5) => ({ id, kind: 'item', pos: { x, z: 5 }, from: { x: x - 2, z: 5 }, born, item: { baseId: 'sword', rarity }, amount: 1, mat: null, rarity, gone: false });
  const drops = [mk(1, 'legendary', TICK - 100), mk(2, 'set', TICK - 100, 6), mk(3, 'rare', TICK - 100, 7), mk(4, 'legendary', TICK, 8)];
  di.update(drops, TICK, 0, { x: 5, z: 5 }, null);
  assert.equal(di.pillars, 2, '떨어진 전설 · 세트만 빛기둥(날아가는 중인 것은 아직)');
  const e = di.meshes.w_sword;
  assert.equal(e.n, 4);
  // 날아가는 것(born = TICK) — 출발점 · 반쯤에 높이 1m
  const at = (now) => { di.update([mk(4, 'normal', TICK, 8)], now, 0, { x: 5, z: 5 }, null); return new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(e.mesh.instanceMatrix.array, 0)); };
  const p0 = at(TICK), pm = at(TICK + ticks(0.35) / 2), p1 = at(TICK + ticks(0.35));
  assert.ok(Math.abs(p0.x - 6) < 1e-6 && Math.abs(p0.y) < 1e-6, '출발 = from');
  assert.ok(Math.abs(pm.y - 1.0) < 0.05, `중간 높이 ${pm.y}`);
  assert.ok(Math.abs(p1.x - 8) < 1e-6, '도착 = pos');
  // 희귀 이상 테두리 발광 · 일반은 없음
  di.update([mk(5, 'normal', 0), mk(6, 'rare', 0, 6)], TICK, 0, { x: 5, z: 5 }, null);
  assert.equal(e.glow[0] + e.glow[1] + e.glow[2], 0);
  assert.ok(e.glow[4] + e.glow[5] + e.glow[6] > 0.5);
  di.dispose();
});

test('view.actors: NPC 4(마을) · setMap 반복에 지오메트리가 쌓이지 않는다 · 장비가 바뀌면 리그를 다시 짓는다', () => {
  const rc = fakeRc();
  const bus = new EventBus();
  const layer = new ActorLayer({ rc, bus, settings: { quality: 'low' } });
  const town = { kind: 'town', objects: [
    { id: 'blacksmith', kind: 'npc', npc: 'blacksmith', x: 14, z: 31, facing: 2.3, r: 1, look: 'npcSmith' },
    { id: 'general', kind: 'npc', npc: 'general', x: 34, z: 31, facing: -2.3, r: 1, look: 'npcGrocer' },
    { id: 'gambler', kind: 'npc', npc: 'gambler', x: 14, z: 13, facing: 0.8, r: 1, look: 'npcGambler' },
    { id: 'mystic', kind: 'npc', npc: 'mystic', x: 34, z: 13, facing: -0.8, r: 1, look: 'npcMystic' },
  ] };
  const geos = () => { const s = new Set(); rc.layers.actors.traverse((o) => { if (o.geometry) s.add(o.geometry); }); return s.size; };
  layer.setMap(town);
  assert.equal(layer.info().npcs, 4);
  const st = makeTestState({ scene: 'town' });
  layer.update(st, 1, 0.016, null);
  const g1 = geos();
  layer.setMap(town);
  layer.setMap(town);
  layer.update(st, 1, 0.016, null);
  assert.equal(geos(), g1, 'setMap 두 번에 지오메트리 수 그대로');
  layer.setMap({ kind: 'rift', objects: [] });
  assert.equal(layer.info().npcs, 0);
  // 장비 교체 → 리그 다시 짓기(부위 수가 바뀐다)
  const n0 = layer.info().playerMeshes;
  st.char.equip.helm = { id: 'iHelm', baseId: 'helm', tier: 2, rarity: 'normal', slot: 'helm' };
  layer.update(st, 1, 0.016, null);
  assert.notEqual(layer.info().playerMeshes, n0);
  const g2 = geos();
  st.char.equip.helm = null;
  layer.update(st, 1, 0.016, null);
  st.char.equip.helm = { id: 'iHelm2', baseId: 'helm', tier: 2, rarity: 'normal', slot: 'helm' };
  layer.update(st, 1, 0.016, null);
  assert.equal(geos(), g2, '장비를 바꿔 다시 지어도 지오메트리가 쌓이지 않는다');
  layer.dispose();
});

test('view.actors: 플레이어 리그 — 무기는 오른손 · 방패는 왼 아래팔 · 마법구는 왼손에 붙는다', () => {
  const group = new THREE.Group();
  const rig = new CharRig(group, makeCharMaterials({ transparent: true, sil: 0x5fb8e0 }));
  const it = (baseId) => ({ id: 'i' + baseId, baseId, tier: 1, rarity: 'normal' });
  rig.build(playerLook({ cls: 'warrior', equip: { mainHand: it('sword'), offhand: it('shield') } }), CHAR_DIMS.warrior);
  const joints = rig.meshes.map((e) => e.j);
  assert.ok(joints.includes(BJ.wR) && joints.includes(BJ.elL));
  assert.ok(rig.meshes.every((e) => e.mesh.matrixAutoUpdate === false));
  assert.ok(rig.meshes.some((e) => e.twin), '가림 외곽선 쌍둥이');
  rig.build(playerLook({ cls: 'mage', equip: { mainHand: it('wand'), offhand: it('orb') } }), CHAR_DIMS.mage);
  assert.ok(rig.meshes.map((e) => e.j).includes(BJ.wL));
  rig.dispose();
  assert.equal(group.children.length, 0);
});

test('view.actors: 쓰러진 플레이어는 화면 가로로 눕는다(화면 패스 — 55° 카메라에서 세로로 누워 「서 있는 T자」로 읽힌 회귀)', () => {
  const poser = new PlayerPoser();
  const P = new Float32Array(Object.keys(BP).length + 8);
  for (let k = 0; k < 24; k++) {
    const f = -Math.PI + (k / 24) * 2 * Math.PI;
    const off = deadYawOffset(f);
    assert.ok(Math.abs(off) <= Math.PI / 2 + 1e-9, `보정은 가까운 쪽(${off})`);
    // 몸의 앞뒤 축(yaw) 이 카메라 시선(방위) 과 직각 — 화면 가로
    assert.ok(Math.abs(Math.cos(f + off - CAM_AZIMUTH)) < 1e-9, `facing ${f.toFixed(2)}`);
    const p = { pos: { x: 0, z: 0 }, prevPos: { x: 0, z: 0 }, facing: f, act: 'dead', dead: true, deadAt: 100, actStart: 100, actHit: 100, actEnd: 100, speed: 0, moving: false, air: null };
    poser.pose(P, p, 'warrior', 'oneHand', 100 + ticks(0.6), 0, 0, 0);
    assert.ok(Math.abs(P[BP.RYAW] - off) < 1e-6, '쓰러짐이 끝나면 보정이 다 들어간다');
    assert.ok(P[BP.RPITCH] < -1.3, '누웠다');
  }
});
