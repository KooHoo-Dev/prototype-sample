// OWNER: P6 — 계약 §12.2(fishModel) · §9.6 · §9.7 · §9.8 · §9.10
// Node 에서 three 지오메트리만(렌더러 없음). 모델 36종의 치수 · 삼각형 상한 · 템플릿 · 실루엣 · 캐시와,
// 채비 · 물고기 레이어를 가짜 rc(Scene + 카메라)로 돌려 판정 = 보이는 것(고리 중심 · 찌 크기 · 뜰채 길이 · 물고기 위치)을 잰다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BODY_TEMPLATES } from '../src/core/constants.js';
import { EV, EventBus } from '../src/core/events.js';
import { fwd, shoreZAt } from '../src/core/math.js';
import { FIGHT } from '../src/data/fight.js';
import { GEAR_BY_ID } from '../src/data/gear.js';
import { SIGNAL } from '../src/data/bite.js';
import { SPECIES } from '../src/data/species/index.js';
import { getSpot, getStage } from '../src/data/stages/index.js';
import { buildFishModel, disposeFishModel, fishModelCacheStats, fishTriangleCount } from '../src/view/fish/fishModel.js';
import { FishPreview } from '../src/view/fish/FishPreview.js';
import { FishLayer, shadowOpacity } from '../src/view/fish/FishLayer.js';
import { TackleLayer, floatScale, floatSignalOffset, rodAngleDeg, rodBend } from '../src/view/tackle/TackleLayer.js';
import { NET_ARM_M, NET_HOOP_R, netHandleLength } from '../src/view/tackle/netPose.js';
import { makeTestState } from './helpers.js';

const LIMITS = { 0: 3000, 1: 400 };
const PX_PER_RAD_720 = 720 / (2 * Math.tan((70 * Math.PI) / 360));   // 1280×720 · FOV 70 — 1rad 당 px(화면 중앙 근사)

function boxOf(obj) {
  obj.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(obj);
}

test('36종 모델을 Node 에서(three 지오메트리만) — Z 길이 = lengthM ± 3% · 높이 비 · 삼각형 수 상한', () => {
  assert.equal(SPECIES.length, 36);
  for (const sp of SPECIES) {
    for (const lod of /** @type {(0|1)[]} */ ([0, 1])) {
      for (const lengthM of [0.12, 0.6, 2.5]) {
        const g = buildFishModel(sp, lengthM, { lod });
        const b = boxOf(g);
        const zLen = b.max.z - b.min.z;
        assert.ok(Math.abs(zLen / lengthM - 1) <= 0.03, `${sp.id} lod${lod} Z 길이 ${zLen} vs ${lengthM}`);
        // 머리 −Z · 원점 = 몸 중심
        assert.ok(Math.abs((b.max.z + b.min.z) / 2) <= 0.03 * lengthM, `${sp.id} 중심`);
        const body = g.getObjectByName('body');
        assert.ok(body, `${sp.id} body mesh`);
        const bb = boxOf(body);
        const hRatio = (bb.max.y - bb.min.y) / lengthM;
        assert.ok(Math.abs(hRatio / sp.look.depth - 1) <= 0.08, `${sp.id} 높이 비 ${hRatio} vs ${sp.look.depth}`);
        // 머리 쪽이 −Z: 눈의 z 가 몸 중심보다 앞
        const eyes = boxOf(g.getObjectByName('eyes'));
        assert.ok(eyes.max.z < 0, `${sp.id} 눈이 앞(−Z)`);
        const tris = fishTriangleCount(g);
        assert.ok(tris <= LIMITS[lod], `${sp.id} lod${lod} 삼각형 ${tris} > ${LIMITS[lod]}`);
        for (const name of ['body', 'fins', 'eyes', 'pupils', 'mouth']) assert.ok(g.getObjectByName(name), `${sp.id} ${name}`);
        disposeFishModel(g);
      }
    }
  }
});

test('템플릿 5종이 모두 쓰이고 실루엣(폭 · 높이 비 · 꼬리)이 체형마다 갈린다', () => {
  const used = new Set(SPECIES.map(s => s.look.body));
  for (const t of BODY_TEMPLATES) assert.ok(used.has(t), `템플릿 ${t} 를 쓰는 어종이 없다`);
  // 체형마다 폭 비가 템플릿 값(±10%)
  const WIDTH = { fusiform: 0.16, compressed: 0.10, eel: 0.09, shark: 0.17, benthic: 0.20 };
  for (const sp of SPECIES) {
    const g = buildFishModel(sp, 1, { lod: 0 });
    const bb = boxOf(g.getObjectByName('body'));
    const w = bb.max.x - bb.min.x;
    assert.ok(Math.abs(w / WIDTH[sp.look.body] - 1) <= 0.1, `${sp.id} 폭 ${w}`);
    disposeFishModel(g);
  }
});

test('같은 체형 안의 어종은 무늬 텍스처(색 · 무늬)가 모두 다르다 · 절차 텍스처는 DataTexture', () => {
  const seen = new Map();
  for (const sp of SPECIES) {
    const g = buildFishModel(sp, 1, { lod: 0 });
    const mat = /** @type {THREE.MeshStandardMaterial} */ (/** @type {THREE.Mesh} */ (g.getObjectByName('body')).material);
    assert.ok(mat.map instanceof THREE.DataTexture, `${sp.id} DataTexture`);
    const data = /** @type {Uint8Array} */ (mat.map.image.data);
    let h = 0x811c9dc5;
    for (let i = 0; i < data.length; i += 7) { h ^= data[i]; h = Math.imul(h, 0x01000193); }
    const key = (h >>> 0).toString(16);
    assert.ok(!seen.has(key), `${sp.id} 텍스처가 ${seen.get(key)} 와 같다`);
    seen.set(key, sp.id);
    if (sp.look.glow) assert.ok(mat.emissiveIntensity > 0.5, `${sp.id} glow emissive`);
    if (sp.look.pattern === 'ghost') assert.ok(mat.transparent && Math.abs(mat.opacity - 0.55) < 1e-9, `${sp.id} ghost 반투명 0.55`);
    disposeFishModel(g);
  }
});

test('실루엣 모드: 모든 재질이 검은 무광(MeshBasic)', () => {
  for (const sp of SPECIES) {
    const g = buildFishModel(sp, 0.5, { silhouette: true });
    g.traverse(o => {
      const m = /** @type {any} */ (o);
      if (!m.isMesh) return;
      assert.ok(m.material instanceof THREE.MeshBasicMaterial, `${sp.id} ${m.name}`);
      assert.equal(m.material.color.getHex(), 0x000000);
      assert.equal(m.material.map, null);
    });
    disposeFishModel(g);
  }
});

test('dispose 뒤 재생성 · 캐시 상한(지오메트리 · 텍스처가 판을 반복해도 늘지 않는다)', () => {
  const sp = SPECIES[0];
  const a = buildFishModel(sp, 0.4, { lod: 1 });
  const geoA = /** @type {THREE.Mesh} */ (a.getObjectByName('body')).geometry;
  disposeFishModel(a);
  const before = fishModelCacheStats();
  for (let i = 0; i < 20; i++) {
    const m = buildFishModel(sp, 0.2 + i * 0.05, { lod: 1, silhouette: i % 2 === 0 });
    assert.equal(/** @type {THREE.Mesh} */ (m.getObjectByName('body')).geometry, geoA, '지오메트리를 다시 만들지 않는다');
    disposeFishModel(m);
  }
  const after = fishModelCacheStats();
  assert.deepEqual(after, before);
  const b = buildFishModel(sp, 0.4, { lod: 1 });
  assert.ok(fishTriangleCount(b) > 0);
  disposeFishModel(b);
  // 모르는 어종 · 이상한 길이에도 던지지 않는다
  const u = buildFishModel(/** @type {any} */ (null), NaN);
  assert.ok(u.isGroup);
  disposeFishModel(u);
});

test('FishPreview: DOM 이 없으면 ok=false · snapshot "" · 나머지는 던지지 않는다', () => {
  const p = new FishPreview();
  assert.equal(p.ok, false);
  assert.equal(p.canvas, null);
  p.show('carp', 50, { silhouette: false, spin: true });
  p.render(0.016);
  p.hide();
  assert.equal(p.snapshot('carp', 50, { silhouette: true, size: 160 }), '');
  p.dispose();
});

// ── 채비 · 물고기 레이어(가짜 rc)

function fakeRc() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1280 / 720, 0.05, 2500);
  camera.rotation.order = 'YXZ';
  scene.add(camera);
  return { scene, camera, renderer: null, quality: 'medium', setQuality() {}, render() {}, prewarm() {}, dispose() {} };
}

/** 카메라를 설 자리 눈높이에(CameraRig 대신) */
function placeCamera(rc, state) {
  const p = state.player;
  rc.camera.position.set(p.pos.x, 0.8 + 1.65, p.pos.z);
  rc.camera.rotation.set(p.pitch, p.yaw, 0);
  rc.camera.updateMatrixWorld(true);
}

function assertFiniteObject(root, label) {
  root.updateMatrixWorld(true);
  root.traverse(o => {
    for (const v of o.matrixWorld.elements) assert.ok(Number.isFinite(v), `${label}: ${o.name || o.type} matrixWorld NaN`);
    const g = /** @type {any} */ (o).geometry;
    if (g && g.attributes && g.attributes.position && o.visible) {
      for (const v of g.attributes.position.array) assert.ok(Number.isFinite(v), `${label}: ${o.name} position NaN`);
    }
  });
}

/** 파이팅 상태(계약 §3.4 필드) — 테스트 리터럴 */
function withFight(state, { speciesId = 'carp', lengthCm = 60, dist = 20, bearing = 0, depth = 2, tension = 2, airborne = 0, rodLift = 0, behavior = 'run', telegraph = null, inCover = 0, Fmax = 3, phase = 'fighting', phaseTime = 0 } = {}) {
  const spot = getSpot(state.player.spotId);
  const rs = GEAR_BY_ID[state.profile.sets[state.rig.set].rod];
  const lineKg = 4;
  state.rig.phase = phase;
  state.rig.phaseTime = phaseTime;
  state.fight = {
    speciesId, roll: { speciesId, z: 0, pct: 0.5, lengthCm, weightKg: 3, tier: 'normal' },
    t: 5, dist, prevDist: dist, minDist: spot.edgeM + FIGHT.minDistPad, bearing, prevBearing: bearing, halfArc: 0.9,
    depth, airborne, stamina: 0.5, behavior, behaviorName: behavior, behaviorT: 0.5, behaviorDur: 1, telegraph,
    tension, tensionRatio: tension / lineKg, limitKg: lineKg, limitBy: 'line', limitRatio: tension / lineKg, lineKg, lineEffKg: lineKg, abrasion: 0,
    inSnag: false, inCover, rodLift, rodUp: rodLift >= 0.5, rodLoadRatio: tension / rs.maxLoadKg, rodStress: false, rodOverT: 0, lineDanger: false,
    slipping: false, slipSpeed: 0, reeling: false, gainSpeed: 0, slack: false, slackTime: 0, spoolLeftM: 100,
    canNet: false, netRangeM: spot.edgeM + FIGHT.netReachM, netBuffer: 0, landStamina: 0.15, showStamina: false,
    traits: [], k: { Fmax, vmax: 2, endurance: 30 }, stats: { maxTension: tension, sumTension: 0, sumTension2: 0, ticks: 0, runs: 0, jumps: 0, slackTicks: 0, slipTicks: 0 }, brain: {},
  };
  return state;
}

test('aimPreview 고리: 충전 중 중심 = rig.aimPreview(허용 0) · 완벽 띠에서 밝아진다 · 그 밖에는 숨김', () => {
  const rc = fakeRc();
  const bus = new EventBus();
  const tackle = new TackleLayer({ rc, bus, settings: {}, world: { heightAt: () => 0 } });
  const s = makeTestState({ spotId: 'lake_gravel', set: 'bottom' });
  placeCamera(rc, s);
  s.rig.phase = 'charging';
  s.rig.power = 0.5;
  s.rig.aimPreview = { x: 3.25, z: -24.5, distM: 26.3 };
  for (let i = 0; i < 30; i++) tackle.update(s, 1, 1 / 60);
  const ring = rc.scene.getObjectByName('aimPreview');
  assert.ok(ring && ring.visible);
  assert.equal(ring.position.x, 3.25);
  assert.equal(ring.position.z, -24.5);
  const dim = /** @type {any} */ (ring.children[0]).material.opacity;
  s.rig.power = 0.97;
  tackle.update(s, 1, 1 / 60);
  assert.ok(/** @type {any} */ (ring.children[0]).material.opacity > dim, '완벽 띠에서 밝아진다');
  s.rig.phase = 'casting';
  s.rig.aimPreview = null;
  tackle.update(s, 1, 1 / 60);
  assert.equal(ring.visible, false);
  assertFiniteObject(rc.scene, 'charging');
  tackle.dispose();
  assert.equal(bus.count(), 0, '구독을 끊는다');
  assert.equal(rc.scene.getObjectByName('tackleRoot'), undefined);
});

test('찌: 위치 = bobber · 보이는 배율 clamp(dist / 7, 1, 18) · 예신 침하 ≥ 6px(120m 까지) · 밤 발광', () => {
  assert.equal(floatScale(3), 1);
  assert.equal(floatScale(70), 10);
  assert.equal(floatScale(500), 18);
  const strength = SIGNAL.baseStrength;   // 1단계 장비의 신호 크기(가장 약한 경우)
  for (const d of [7, 24, 60, 120]) {
    const off = floatSignalOffset({ kind: 'nibble', t: SIGNAL.float.nibbleDur * 0.5, strength, takeStyle: 'sink' }, { y: 0, lie: 0 });
    const px = (Math.abs(off.y) * floatScale(d) / d) * PX_PER_RAD_720;
    assert.ok(px >= 6, `${d}m 예신 침하 ${px.toFixed(1)}px`);
  }
  const sink = floatSignalOffset({ kind: 'take', t: 0.5, strength: 1, takeStyle: 'sink' }, { y: 0, lie: 0 });
  assert.ok(sink.y <= -0.3, '본신 sink = 완전히 잠김');
  const lift = floatSignalOffset({ kind: 'take', t: SIGNAL.float.takeWindow, strength: 1, takeStyle: 'lift' }, { y: 0, lie: 0 });
  assert.equal(lift.lie, 1, '찌올림: 창 동안 누운 채');
  const rising = floatSignalOffset({ kind: 'take', t: 0.15, strength: 1, takeStyle: 'lift' }, { y: 0, lie: 0 });
  assert.ok(Math.abs(rising.y - 0.12) < 1e-9, '0.15초에 +0.12m');

  const rc = fakeRc();
  const tackle = new TackleLayer({ rc, bus: new EventBus(), settings: {}, world: { heightAt: () => 0 } });
  const s = makeTestState({ spotId: 'lake_gravel', set: 'float', hour: 22 });
  placeCamera(rc, s);
  const b = fwd(0.1, 42);
  s.rig.phase = 'bite';
  s.rig.bobber = { x: s.rig.origin.x + b.x, z: s.rig.origin.z + b.z };
  s.rig.prevBobber = { ...s.rig.bobber };
  s.rig.dist = 42;
  s.rig.bearing = 0.1;
  s.rig.signal = { kind: 'nibble', t: 0.1, strength: 0.6, takeStyle: 'sink', count: 1 };
  s.env.headlamp = true;
  s.env.waveAmp = 0;
  tackle.update(s, 1, 1 / 60);
  const fl = rc.scene.getObjectByName('float');
  assert.ok(fl.visible);
  assert.ok(Math.abs(fl.position.x - s.rig.bobber.x) < 1e-9 && Math.abs(fl.position.z - s.rig.bobber.z) < 1e-9, '찌 중심 = bobber');
  assert.equal(fl.scale.x, 6);
  assert.ok(fl.children[0].position.y < 0, '예신으로 잠긴다');
  let glow = 0;
  fl.traverse(o => { const m = /** @type {any} */ (o).material; if (m && m.emissiveIntensity >= 1) glow++; });
  assert.ok(glow > 0, '밤에는 안테나 위 1/3 이 발광');
  assertFiniteObject(rc.scene, 'bite');
  tackle.dispose();
});

test('로드: 단계별 각 · 휨 sqrt(0.1kg 블루길도 보인다) · 파손 연출 → 예비 로드', () => {
  assert.equal(rodAngleDeg({ rig: { phase: 'ready', set: 'float' } }), 35);
  assert.equal(rodAngleDeg({ rig: { phase: 'waiting', set: 'float' } }), 25);
  assert.equal(rodAngleDeg({ rig: { phase: 'waiting', set: 'bottom' } }), 30);
  assert.equal(rodAngleDeg({ rig: { phase: 'charging', power: 1 } }), 110);
  assert.equal(rodAngleDeg({ rig: { phase: 'casting', phaseTime: 0 } }), 110);
  assert.equal(rodAngleDeg({ rig: { phase: 'casting', phaseTime: 2 } }), 25);
  assert.equal(rodAngleDeg({ rig: { phase: 'fighting' }, fight: { rodLift: 1 } }), 75);
  assert.equal(rodAngleDeg({ rig: { phase: 'fighting' }, fight: { rodLift: 0 } }), 15);
  assert.equal(rodAngleDeg({ rig: { phase: 'landing' } }), 60);
  const small = rodBend(0.1, GEAR_BY_ID.rod_float_1.maxLoadKg) * 70;
  assert.ok(small >= 10, `0.1kg 의 끝 곡률 ${small.toFixed(1)}°`);
  assert.equal(rodBend(100, 2.6), 1.1);
  assert.equal(rodBend(NaN, 2.6), 0);

  const rc = fakeRc();
  const bus = new EventBus();
  const tackle = new TackleLayer({ rc, bus, settings: {}, world: { heightAt: () => 0 } });
  const s = withFight(makeTestState({ spotId: 'lake_gravel', set: 'float' }), { tension: 0.1, Fmax: 0.2, lengthCm: 15, dist: 12 });
  placeCamera(rc, s);
  for (let i = 0; i < 60; i++) tackle.update(s, 1, 1 / 60);
  const seg = rc.camera.getObjectByName('rodSeg11');
  assert.ok(seg.rotation.x < -0.005, `작은 물고기에도 끝이 숙여진다 ${seg.rotation.x}`);
  assert.ok(rc.camera.getObjectByName('viewModel').visible);
  const line = rc.scene.getObjectByName('fishingLine');
  assert.ok(line.visible);
  assertFiniteObject(rc.scene, 'fight');
  assertFiniteObject(rc.camera, 'fight vm');
  // 파손 → 끝 1/3 이 사라지고 조각이 떨어진다 → RIG_RESTORED 에서 예비 로드
  bus.emit(EV.FIGHT_END, { outcome: 'rodBreak', durationSec: 5, maxTension: 3, distM: 12, cause: null });
  s.fight = null;
  s.rig.phase = 'failed';
  s.rig.failReason = 'rodBreak';
  tackle.update(s, 1, 1 / 60);
  assert.equal(rc.camera.getObjectByName('rodSeg8').visible, false);
  const piece = rc.scene.getObjectByName('brokenTip');
  assert.ok(piece.visible);
  const y0 = piece.position.y;
  for (let i = 0; i < 20; i++) tackle.update(s, 1, 1 / 60);
  assert.ok(piece.position.y < y0 + 0.5, '조각이 떨어진다');
  bus.emit(EV.RIG_RESTORED, { set: 'float', rodReplaced: true, spoolReplaced: false, baitLeft: 5, lineM: 100, dragKg: 1 });
  s.rig.phase = 'ready';
  s.rig.failReason = null;
  tackle.update(s, 1, 1 / 60);
  assert.equal(rc.camera.getObjectByName('rodSeg8').visible, true);
  tackle.dispose();
});

test('뜰채: 보이는 길이(팔 + 손잡이 + 테) − netRangeM ≤ 0.35m · 손잡이 = netRangeM − 0.75', () => {
  for (const spotId of ['lake_shallows', 'lake_gravel', 'lake_cape']) {
    const netRangeM = getSpot(spotId).edgeM + FIGHT.netReachM;
    assert.ok(Math.abs(netHandleLength(netRangeM) - (netRangeM - 0.75)) < 1e-9);
    const rc = fakeRc();
    const tackle = new TackleLayer({ rc, bus: new EventBus(), settings: {}, world: { heightAt: () => 0 } });
    const s = withFight(makeTestState({ spotId, set: 'float' }), { dist: netRangeM - 0.3, phase: 'landing', phaseTime: 0.4 });
    placeCamera(rc, s);
    tackle.update(s, 1, 1 / 60);
    const net = rc.scene.getObjectByName('landingNet');
    assert.ok(net.visible);
    const pole = net.children[0];
    const handle = pole.scale.z;
    assert.ok(Math.abs(handle - (netRangeM - 0.75)) < 1e-9, `손잡이 ${handle}`);
    // 손(카메라) → 테 중심: 팔은 카메라에서 왼손까지의 실제 거리로 잰다
    const hand = net.position.clone();
    const camPos = rc.camera.position.clone();
    const arm = Math.hypot(hand.x - camPos.x, hand.z - camPos.z);
    const visible = arm + handle + NET_HOOP_R;
    assert.ok(Math.abs(visible - netRangeM) <= 0.35, `${spotId} 보이는 길이 ${visible.toFixed(2)} vs 판정 ${netRangeM}`);
    assert.ok(Math.abs(arm - NET_ARM_M) <= 0.1, `팔 ${arm.toFixed(2)}`);
    assert.ok(rc.camera.getObjectByName('leftHand').visible, '뜰채 때 왼손');
    assertFiniteObject(rc.scene, 'landing');
    tackle.dispose();
  }
});

test('물고기: 그림자 중심 = origin + fwd(bearing) × dist · 물 위(땅 위에 그려지지 않는다) · 예고 · 점프 · 뜰채', () => {
  assert.equal(shadowOpacity(0, false), 0.55);
  assert.equal(shadowOpacity(20, false), 0.15);
  assert.equal(shadowOpacity(20, true), 0.35);
  const rc = fakeRc();
  const bus = new EventBus();
  const layer = new FishLayer({ rc, bus, settings: {}, world: { heightAt: () => 0 } });
  const s = withFight(makeTestState({ spotId: 'lake_gravel', set: 'bottom' }), { dist: 18, bearing: 0.3, depth: 3 });
  placeCamera(rc, s);
  const stage = getStage('lake');
  layer.update(s, 1, 1 / 60);
  const sh = rc.scene.getObjectByName('fishShadow');
  assert.ok(sh.visible);
  const want = { x: s.rig.origin.x + fwd(0.3).x * 18, z: s.rig.origin.z + fwd(0.3).z * 18 };
  assert.ok(Math.abs(sh.position.x - want.x) < 1e-9 && Math.abs(sh.position.z - want.z) < 1e-9, '그림자 중심 = 판정 위치');
  // 가장 가까운 거리(minDist)에서도 물 쪽(해안선의 −Z)
  const sp = getSpot('lake_gravel');
  for (const bearing of [-0.3, 0, 0.3]) {
    s.fight.dist = s.fight.prevDist = s.fight.minDist;
    s.fight.bearing = s.fight.prevBearing = bearing;
    layer.update(s, 1, 1 / 60);
    assert.ok(sh.position.z < shoreZAt(stage.shore, sh.position.x), `물가 땅 위가 아니다(bearing ${bearing})`);
  }
  void sp;
  // 점프 예고: 그림자가 진해지고 커진다
  s.fight.dist = s.fight.prevDist = 18;
  s.fight.telegraph = null;
  layer.update(s, 1, 1 / 60);
  const body = sh.children[0];
  const base = { sx: body.scale.x, op: /** @type {any} */ (body).material.opacity };
  s.fight.telegraph = { kind: 'jump', remaining: 0.05, total: 0.6 };
  s.fight.depth = 1.5;
  layer.update(s, 1, 1 / 60);
  assert.ok(body.scale.x > base.sx, '점프 예고: 커진다');
  assert.ok(/** @type {any} */ (body).material.opacity >= base.op, '점프 예고: 진해진다');
  // 질주 예고: 꼬리침(시간에 따라 꼬리 각이 바뀐다)
  s.fight.telegraph = { kind: 'run', remaining: 0.3, total: 0.6 };
  const tails = new Set();
  for (let i = 0; i < 6; i++) {
    layer.update(s, 1, 0.023);
    tails.add(sh.children[1].rotation.y.toFixed(3));
  }
  assert.ok(tails.size >= 4, '질주 예고: 꼬리를 친다');
  // 점프: 모델이 수면 위로 airborne × (0.3 + 0.5 × lengthM)
  s.fight.telegraph = null;
  s.fight.airborne = 0.8;
  s.fight.behavior = 'jump';
  layer.update(s, 1, 1 / 60);
  const model = rc.scene.getObjectByName('fish:carp');
  assert.ok(model && model.visible);
  assert.ok(Math.abs(model.position.y - 0.8 * (0.3 + 0.5 * 0.6)) < 1e-9);
  assertFiniteObject(rc.scene, 'jump');
  // 뜰채: 그림자 대신 모델
  s.fight.airborne = 0;
  s.rig.phase = 'landing';
  s.rig.phaseTime = 0.5;
  layer.update(s, 1, 1 / 60);
  assert.equal(sh.visible, false);
  assert.ok(model.visible);
  // 결과 → 퇴장
  bus.emit(EV.CATCH_RESULT, { catch: {}, holdFull: false });
  s.fight = null;
  s.rig.phase = 'result';
  layer.update(s, 1, 1 / 60);
  assert.equal(model.visible, false);
  // 같은 어종을 다시 걸어도 모델을 새로 만들지 않는다(풀)
  const countBefore = fishModelCacheStats().geometries;
  withFight(s, { speciesId: 'carp', dist: 10 });
  layer.update(s, 1, 1 / 60);
  assert.equal(fishModelCacheStats().geometries, countBefore);
  layer.dispose();
  assert.equal(bus.count(), 0);
  assert.equal(rc.scene.getObjectByName('fishRoot'), undefined);
});

test('레이어는 이벤트 없이 상태만 바뀌어도 따라오고(걷기 ↔ 낚시) 큰 dt · 이상 값에 NaN 이 없다', () => {
  const rc = fakeRc();
  const tackle = new TackleLayer({ rc, bus: null, settings: {}, world: null });
  const fish = new FishLayer({ rc, bus: null, settings: {}, world: null });
  const s = makeTestState({ spotId: 'lake_cape', set: 'float' });
  placeCamera(rc, s);
  const phases = ['ready', 'charging', 'casting', 'waiting', 'bite', 'retrieving', 'result', 'failed', 'ready'];
  for (const ph of phases) {
    s.rig.phase = ph;
    s.rig.castT = 0.5;
    s.rig.dist = 30;
    s.rig.power = 0.7;
    s.rig.aimPreview = ph === 'charging' ? { x: 0, z: -20, distM: 21 } : null;
    for (const dt of [0, 1 / 60, 0.25, 5]) {
      tackle.update(s, 0.5, dt);
      fish.update(s, 0.5, dt);
    }
    assertFiniteObject(rc.scene, ph);
    assertFiniteObject(rc.camera, ph);
  }
  // 걷기로 돌아가면(이벤트 없음) 로드를 넣는다
  s.player.mode = 'walk';
  s.rig.phase = 'idle';
  for (let i = 0; i < 30; i++) tackle.update(s, 1, 1 / 60);
  assert.equal(rc.camera.getObjectByName('viewModel').visible, false);
  assert.equal(rc.scene.getObjectByName('fishingLine').visible, false);
  tackle.dispose();
  fish.dispose();
});
