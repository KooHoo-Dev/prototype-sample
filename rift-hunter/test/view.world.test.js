// OWNER: P7 — 계약 §12.2 (Node · three 지오메트리만 — 렌더러 없음)
// MapData → 지오메트리(바닥 · 벽 인스턴스 수 = 벽 타일 수) · 벽 낮추기 선택(순수 함수 — 카메라 쪽 · 가로 5m) · 카메라 거리 범위 · 화질 표 ·
// setMap 두 번에 지오메트리 수 그대로(누수 없음) + 보이는 반지름 · 빛 풀 · 흔들림 상한 · 순간이동 없음 · 건물 가림.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { CAM_AZIMUTH, CAM_DISTANCE, CAM_DISTANCE_MAX, CAM_DISTANCE_MIN, CAM_ELEVATION, CAM_FOV, CAM_LEAD, TILE, TILE_FLOOR, TILE_WALL } from '../src/core/constants.js';
import { EV, EventBus } from '../src/core/events.js';
import { QUALITY } from '../src/data/quality.js';
import { TILESETS } from '../src/data/tilesets.js';
import { BOT } from '../src/data/bot.js';
import { MON } from '../src/data/monsters.js';
import { arenaAscii, mapFromAscii, townMapFromData } from '../src/debug/fixtureMap.js';
import { createGameState } from '../src/sim/state.js';
import { CAMERA, CameraRig, cameraPose, springAxis, zoomTargetAfter } from '../src/view/CameraRig.js';
import { WorldLayer, rayHitsBox } from '../src/view/WorldLayer.js';
import { buildFloor } from '../src/view/world/floor.js';
import { createLightRig, pickNearest } from '../src/view/world/lights.js';
import { WALL_FADE, occludesPlayer, propOccludesPlayer, stepFade } from '../src/view/world/occlusion.js';
import { PROP_BASE, propParts } from '../src/view/world/props.js';
import { EMIT, WALL_H } from '../src/view/world/style.js';
import { wallTileCount, wallVariants } from '../src/view/world/walls.js';

const S = Math.SQRT1_2;
/** 카메라 쪽(+X+Z)으로 d · 화면 가로(1, 0, −1)/√2 로 l 만큼 떨어진 점의 (dx, dz) */
const at = (d, l) => [d * Math.sin(CAM_AZIMUTH) + l * S, d * Math.cos(CAM_AZIMUTH) - l * S];

const crypt = () => mapFromAscii(arenaAscii(), { id: 'test:crypt', tileset: 'crypt' });
const cavern = () => mapFromAscii(arenaAscii(), { id: 'test:cavern', tileset: 'cavern' });

function makeRc({ lights = true, quality = 'medium' } = {}) {
  const scene = new THREE.Scene();
  const layers = { world: new THREE.Group(), actors: new THREE.Group(), fx: new THREE.Group() };
  scene.add(layers.world, layers.actors, layers.fx);
  const camera = new THREE.PerspectiveCamera(CAM_FOV, 16 / 9, 0.5, 220);
  const rc = { scene, layers, camera, quality, lights: lights ? createLightRig(scene) : undefined };
  if (rc.lights) rc.lights.setPoolSize(QUALITY[quality].maxLights - 1);
  return rc;
}

function makeLayer(opts = {}) {
  const bus = new EventBus();
  const settings = { quality: opts.quality ?? 'medium', screenShake: true };
  const rc = makeRc(opts);
  const wl = new WorldLayer({ rc, bus, settings });
  return { wl, rc, bus, settings };
}

function stateAt(x, z, scene = 'rift') {
  const st = createGameState({ seed: 1 });
  st.scene = /** @type {any} */ (scene);
  st.player.pos = { x, z };
  st.player.prevPos = { x, z };
  return st;
}

/** 그룹 안의 지오메트리 · 재질 · 텍스처(중복 없이) */
function resources(group) {
  const geos = new Set(), mats = new Set(), texs = new Set();
  group.traverse((o) => {
    if (o.geometry) geos.add(o.geometry);
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of ms) { mats.add(m); if (m.map) texs.add(m.map); }
  });
  return { geos, mats, texs };
}

/** 이름이 name 인 InstancedMesh 들의 인스턴스 수 합 */
function instanceCount(group, name) {
  let n = 0;
  group.traverse((o) => { if (o instanceof THREE.InstancedMesh && o.name === name) n += o.count; });
  return n;
}

// ───────────────────────── 화질 표 ─────────────────────────

test('화질 표가 §7.13 · §9.10 그대로(픽셀 비율 상한 · 점광원 · 그림자 · 입자 · 벽 낮추기)', () => {
  assert.deepEqual(QUALITY, {
    low: { pixelRatio: 1.0, shadows: false, maxLights: 3, particles: 0.4, outlines: true, wallFadeSmooth: false },
    medium: { pixelRatio: 1.5, shadows: false, maxLights: 5, particles: 0.7, outlines: true, wallFadeSmooth: true },
    high: { pixelRatio: 2.0, shadows: true, maxLights: 8, particles: 1.0, outlines: true, wallFadeSmooth: true },
  });
  for (const q of Object.values(QUALITY)) assert.ok(q.pixelRatio <= 2);
});

test('빛 장치 — 풀 크기 = maxLights − 1(플레이어 빛 포함 maxLights) · 줄이고 늘려도 장면의 빛 수가 맞다', () => {
  const scene = new THREE.Scene();
  const rig = createLightRig(scene);
  const points = () => { let n = 0; scene.traverse(o => { if (o instanceof THREE.PointLight) n++; }); return n; };
  for (const q of ['low', 'high', 'medium', 'low']) {
    rig.setPoolSize(QUALITY[q].maxLights - 1);
    assert.equal(points(), QUALITY[q].maxLights, q);
  }
  rig.dispose();
  assert.equal(points(), 0);
});

// ───────────────────────── 지오메트리 ─────────────────────────

test('MapData → 지오메트리: 바닥 병합 메시 하나 · 벽 인스턴스 수 = 벽 타일 수(crypt · cavern · town)', () => {
  for (const map of [crypt(), cavern(), townMapFromData()]) {
    const { wl } = makeLayer();
    wl.setMap(map);
    const floors = [];
    wl.group.traverse(o => { if (o.name === 'floor') floors.push(o); });
    assert.equal(floors.length, 1, `${map.tileset}: 바닥 메시 하나`);
    const pos = floors[0].geometry.getAttribute('position');
    assert.ok(pos.count > 0 && pos.count % 3 === 0);
    // 바닥은 바닥 타일 위에만(빈 곳 · 벽 위에 바닥 판이 없다) · 높이 ±0.06
    const bb = floors[0].geometry.boundingBox;
    assert.ok(bb.min.y >= -0.06 && bb.max.y <= 0.06, `${map.tileset}: 바닥 높이 ${bb.min.y}..${bb.max.y}`);
    for (let t = 0; t < pos.count; t += 3 * 31) {
      const cx = (pos.getX(t) + pos.getX(t + 1) + pos.getX(t + 2)) / 3, cz = (pos.getZ(t) + pos.getZ(t + 1) + pos.getZ(t + 2)) / 3;
      const ti = Math.floor(cx / TILE), tj = Math.floor(cz / TILE);
      assert.equal(map.tiles[tj * map.w + ti], TILE_FLOOR, `${map.tileset}: 바닥 삼각형 (${cx.toFixed(2)}, ${cz.toFixed(2)})이 바닥 타일 위`);
    }
    const walls = wallTileCount(map);
    assert.ok(walls > 0);
    assert.equal(instanceCount(wl.group, 'walls'), walls, `${map.tileset}: 벽 인스턴스 = 벽 타일`);
    wl.dispose();
  }
});

test('벽 모양: 높이 WALL_H 3.0m · 타일 하나(2m)를 덮는다 · 타일셋마다 다른 모양(crypt · cavern · town)', () => {
  assert.equal(WALL_H, 3.0);
  const sig = {};
  for (const ts of ['crypt', 'cavern', 'town']) {
    const vs = wallVariants(ts);
    assert.ok(vs.length >= 1);
    for (const g of vs) {
      g.computeBoundingBox();
      const b = g.boundingBox;
      assert.ok(b.max.y >= WALL_H - 0.35 && b.max.y <= WALL_H + 0.45, `${ts}: 높이 ${b.max.y}`);
      assert.ok(b.min.y <= 0.05 && b.min.y >= -0.4, `${ts}: 바닥에서 선다(${b.min.y.toFixed(2)})`);
      assert.ok(b.min.x <= -0.95 && b.max.x >= 0.95 && b.min.z <= -0.95 && b.max.z >= 0.95, `${ts}: 타일을 덮는다`);
    }
    sig[ts] = vs[0].getAttribute('position').count;
  }
  assert.equal(new Set(Object.values(sig)).size, 3, '세 타일셋의 벽 지오메트리가 서로 다르다');
});

test('막는 소품의 보이는 반지름 = 데이터 r(±0.1) · 높이 ≈ h · 모든 타일셋 소품 kind 에 모양이 있다', () => {
  for (const ts of TILESETS) {
    for (const row of ts.props) {
      assert.ok(PROP_BASE[row.kind], `${ts.id}.${row.kind}: 기준 치수`);
      assert.equal(PROP_BASE[row.kind].r, row.r, `${row.kind}: 기준 r = 데이터`);
      assert.equal(PROP_BASE[row.kind].h, row.h, `${row.kind}: 기준 h = 데이터`);
      const parts = propParts(row.kind);
      assert.ok(parts.length >= 1);
      let r = 0, top = 0;
      for (const p of parts) {
        const a = p.geo.getAttribute('position');
        for (let i = 0; i < a.count; i++) { r = Math.max(r, Math.hypot(a.getX(i), a.getZ(i))); top = Math.max(top, a.getY(i)); }
      }
      if (row.block) assert.ok(Math.abs(r - row.r) <= 0.1 + 1e-9, `${row.kind}: 보이는 반지름 ${r.toFixed(3)} vs r ${row.r}`);
      else assert.ok(r <= row.r + 0.1, `${row.kind}: 막지 않는 소품도 r 를 크게 넘지 않는다(${r.toFixed(3)})`);
      assert.ok(Math.abs(top - row.h) <= Math.max(0.12, row.h * 0.1), `${row.kind}: 높이 ${top.toFixed(2)} vs h ${row.h}`);
    }
  }
});

test('바닥 — 같은 맵 · 같은 씨앗이면 같은 지오메트리(결정적) · 타일셋마다 다른 바닥', () => {
  const a = buildFloor(crypt(), 7), b = buildFloor(crypt(), 7), c = buildFloor(cavern(), 7);
  assert.deepEqual(Array.from(a.getAttribute('color').array.slice(0, 300)), Array.from(b.getAttribute('color').array.slice(0, 300)));
  assert.notEqual(a.getAttribute('position').count, c.getAttribute('position').count);
});

// ───────────────────────── 벽 낮추기 ─────────────────────────

test('벽 낮추기 선택(순수 함수) — 카메라 쪽 0.5m 넘게 · 화면 가로 5m 안 · 14m 안만', () => {
  assert.equal(occludesPlayer(...at(3, 0)), true, '카메라 쪽 3m');
  assert.equal(occludesPlayer(...at(13.5, 0)), true, '카메라 쪽 13.5m');
  assert.equal(occludesPlayer(...at(14.5, 0)), false, '14m 밖');
  assert.equal(occludesPlayer(...at(0.4, 0)), false, '카메라 쪽 0.5m 이하');
  assert.equal(occludesPlayer(...at(0.6, 0)), true, '0.5m 넘음');
  assert.equal(occludesPlayer(...at(-3, 0)), false, '반대쪽(화면 위)');
  assert.equal(occludesPlayer(...at(4, 4.9)), true, '가로 4.9m');
  assert.equal(occludesPlayer(...at(4, -4.9)), true, '가로 −4.9m');
  assert.equal(occludesPlayer(...at(4, 5.1)), false, '가로 5.1m');
  assert.equal(occludesPlayer(...at(4, -5.1)), false, '가로 −5.1m');
  // 축 정렬 예: 플레이어의 +X+Z 대각(카메라 쪽) 2m 벽은 낮춘다 · −X−Z 는 아니다
  assert.equal(occludesPlayer(2, 2), true);
  assert.equal(occludesPlayer(-2, -2), false);
  assert.equal(occludesPlayer(4, -4), false, '화면 오른쪽 5.66m');
});

test('키 큰 소품(기둥 · 석순)도 플레이어를 가리면 낮춘다 — 가릴 수 있는 거리 · 가로 r + 1.2m 안만(벽보다 좁게)', () => {
  assert.equal(propOccludesPlayer(...at(2, 0), 0.6, 3), true, '카메라 쪽 2m 기둥');
  assert.equal(propOccludesPlayer(...at(3.2, 0.5), 0.6, 3), true);
  assert.equal(propOccludesPlayer(...at(4, 0), 0.6, 3), false, '3m 기둥이 가릴 수 없는 거리');
  assert.equal(propOccludesPlayer(...at(2, 1.9), 0.6, 3), false, '가로 1.9m');
  assert.equal(propOccludesPlayer(...at(-1, 0), 0.6, 3), false, '반대쪽');
  // WorldLayer: 기둥 바로 뒤(−X−Z)에 선 플레이어 → 그 기둥 인스턴스가 낮아진다
  const map = crypt();
  const pillar = map.props.find(p => p.block && p.h >= 1.6);
  assert.ok(pillar);
  const { wl } = makeLayer();
  wl.setMap(map);
  const [dx, dz] = at(1.6, 0);
  const st = stateAt(pillar.x - dx, pillar.z - dz);
  wl.update(st, 1, 1 / 60, null);
  const mesh = /** @type {THREE.InstancedMesh} */ (wl.group.children.find(o => o.name === 'prop:' + pillar.kind));
  const k = map.props.filter(p => p.kind === pillar.kind).indexOf(pillar);
  const m4 = new THREE.Matrix4(), p3 = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  mesh.getMatrixAt(k, m4);
  m4.decompose(p3, q, sc);
  assert.ok(Math.abs(p3.x - pillar.x) < 1e-6 && Math.abs(p3.z - pillar.z) < 1e-6);
  assert.ok(Math.abs(sc.y - WALL_FADE.lowH / pillar.h) < 1e-6, `기둥이 0.6m 로(${sc.y})`);
  wl.dispose();
});

test('낮추기 진행 — 0.15초에 낮은 높이까지 · 돌아오는 것도 0.15초 · low 화질은 즉시', () => {
  const low = WALL_FADE.lowH / WALL_H;
  assert.equal(WALL_FADE.sec, 0.15);
  assert.equal(WALL_FADE.lowH, 0.6);
  let h = 1;
  h = stepFade(h, low, 0.075, true, low);
  assert.ok(Math.abs(h - (1 + low) / 2) < 1e-9, '절반 시간에 절반');
  h = stepFade(h, low, 0.075, true, low);
  assert.equal(h, low);
  h = stepFade(h, 1, 0.1, true, low);
  assert.ok(h > low && h < 1);
  h = stepFade(h, 1, 0.1, true, low);
  assert.equal(h, 1);
  assert.equal(stepFade(1, low, 0.001, false, low), low, 'smooth false 는 즉시');
  assert.equal(stepFade(1, low, NaN, true, low), low, 'dt 가 이상하면 목표로');
});

test('WorldLayer — 카메라 쪽 벽 덩어리가 플레이어 곁에서 낮아지고(행렬 y 배율), 멀어지면 0.15초에 돌아온다 · 판정 맵은 그대로', () => {
  const map = crypt();
  const navBefore = map.nav.slice();
  const { wl } = makeLayer();
  wl.setMap(map);
  // arenaAscii: 시작점(타일 14,14)의 +X+Z(카메라 쪽) 5~9m 에 벽 덩어리
  const st = stateAt(map.spawn.x, map.spawn.z);
  wl.update(st, 1, 1 / 60, null);
  const lowered = wl.loweredIndices();
  assert.ok(lowered.length >= 3, `카메라 쪽 벽 덩어리 낮춤(${lowered.length})`);
  const mesh = /** @type {THREE.InstancedMesh} */ (wl.group.children.find(o => o.name === 'walls'));
  const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  let lowSeen = 0;
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m4);
    m4.decompose(p, q, s);
    if (s.y < 0.99) {
      lowSeen++;
      assert.ok(Math.abs(s.y - WALL_FADE.lowH / WALL_H) < 1e-6, '첫 프레임은 바로(맵을 막 띄웠다)');
      assert.equal(occludesPlayer(p.x - map.spawn.x, p.z - map.spawn.z), true, '낮춘 것은 전부 카메라 쪽 · 가로 5m 안');
    }
  }
  assert.equal(lowSeen, lowered.length);
  // 걸어서(한 프레임 2m 미만) 화면 위쪽(카메라 반대)으로 멀어진다 → 0.15초에 걸쳐 돌아온다
  let x = map.spawn.x, z = map.spawn.z;
  for (let k = 0; k < 6; k++) {
    x -= 1.4; z -= 1.4;
    st.player.prevPos = { x: x + 1.4, z: z + 1.4 }; st.player.pos = { x, z };
    st.tick += 1;
    wl.update(st, 1, 0.02, null);
  }
  const mid = wl.loweredIndices().filter(k => lowered.includes(k)).length;
  assert.ok(mid > 0, `0.12초 뒤에는 아직 돌아오는 중(${mid})`);
  const mid2 = wl.loweredIndices().filter(k => lowered.includes(k)).map(k => wl._fCur[k]);
  assert.ok(mid2.every(v => v > WALL_FADE.lowH / WALL_H && v < 1), '중간 높이');
  st.tick += 6;
  wl.update(st, 1, 0.2, null);
  assert.equal(wl.loweredIndices().filter(k => lowered.includes(k)).length, 0, '다 돌아옴');
  // 순간이동(한 프레임 2.5m 넘게)이면 새 자리 기준으로 바로 맞춘다
  st.player.prevPos = { ...map.spawn }; st.player.pos = { ...map.spawn };
  st.tick += 1;
  wl.update(st, 1, 0.016, null);
  assert.equal(wl.loweredIndices().length, lowered.length, '돌아오자마자 바로 낮춤');
  for (const k of wl.loweredIndices()) assert.ok(Math.abs(wl._fCur[k] - WALL_FADE.lowH / WALL_H) < 1e-6);
  assert.deepEqual(Array.from(map.nav), Array.from(navBefore), '판정(내비)은 바뀌지 않는다');
  wl.dispose();
});

test('WorldLayer — 정지 화면(dtReal 0)에서도 민 틱만큼 진행한다(§9.1 — __game.step)', () => {
  const map = crypt();
  const { wl } = makeLayer();
  wl.setMap(map);
  const st = stateAt(map.spawn.x, map.spawn.z);
  wl.update(st, 1, 0, null);
  const lowered = wl.loweredIndices();
  assert.ok(lowered.length > 0);
  st.player.pos = { x: 8, z: 8 }; st.player.prevPos = { x: 8, z: 8 };
  st.tick += 10;           // 0.33초
  wl.update(st, 1, 0, null);
  assert.equal(wl.loweredIndices().filter(k => lowered.includes(k)).length, 0);
  wl.dispose();
});

// ───────────────────────── 누수 ─────────────────────────

test('setMap 두 번(같은 맵 · 다른 맵 왕복)에 지오메트리 · 재질 · 텍스처 수 그대로 · 이전 맵 것은 dispose', () => {
  const { wl } = makeLayer();
  const A = crypt(), B = townMapFromData(), C = cavern();
  wl.setMap(A);
  const r1 = resources(wl.group);
  let disposed = 0, instDisposed = 0;
  for (const g of r1.geos) g.addEventListener('dispose', () => { disposed++; });
  const insts = [];
  wl.group.traverse(o => { if (o instanceof THREE.InstancedMesh) { insts.push(o); o.addEventListener('dispose', () => { instDisposed++; }); } });
  wl.setMap(A);
  const r2 = resources(wl.group);
  assert.equal(r2.geos.size, r1.geos.size, '같은 맵 두 번');
  assert.equal(r2.mats.size, r1.mats.size);
  assert.equal(r2.texs.size, r1.texs.size);
  const kept = [...r1.geos].filter(g => r2.geos.has(g)).length;
  assert.equal(disposed, r1.geos.size - kept, '남지 않은 이전 지오메트리는 전부 dispose 됐다');
  assert.equal(instDisposed, insts.length, '이전 인스턴스 버퍼 해제');
  for (let k = 0; k < 3; k++) { wl.setMap(B); wl.setMap(C); wl.setMap(A); }
  const r3 = resources(wl.group);
  assert.equal(r3.geos.size, r1.geos.size, '여러 번 왕복 뒤에도 같다');
  assert.equal(r3.mats.size, r1.mats.size);
  assert.equal(r3.texs.size, r1.texs.size);
  wl.setMap(B);
  const town1 = resources(wl.group);
  wl.setMap(C); wl.setMap(B);
  const town2 = resources(wl.group);
  assert.equal(town2.geos.size, town1.geos.size, '마을(건물 재질 포함)도 같다');
  assert.equal(town2.mats.size, town1.mats.size);
  wl.setMap(null);
  assert.ok(resources(wl.group).geos.size <= kept + 2, 'null 이면 맵 것은 없다');
  wl.dispose();
  assert.equal(wl.rc.layers.world.children.length, 0);
});

// ───────────────────────── 빛 ─────────────────────────

test('가까운 빛 고르기 — 대상에서 가까운 k 개(오름차순) · 꺼진 후보 건너뜀', () => {
  const xs = [10, 0, 5, 30, 2, 7], zs = [0, 0, 0, 0, 0, 0], on = new Uint8Array([1, 1, 1, 1, 0, 1]);
  const idx = new Int32Array(3), d = new Float64Array(3);
  const m = pickNearest(xs, zs, on, xs.length, 0, 0, 3, idx, d);
  assert.equal(m, 3);
  assert.deepEqual(Array.from(idx), [1, 2, 5]);
  assert.equal(pickNearest(xs, zs, null, 2, 0, 0, 3, idx, d), 2);
});

test('WorldLayer — 맵 빛 중 카메라 대상에서 가까운 maxLights − 1 개만 실제 점광원 · 세기가 유한 · 플레이어 빛은 머리 위', () => {
  for (const q of ['low', 'medium', 'high']) {
    const { wl, rc } = makeLayer({ quality: q });
    const map = crypt();
    wl.setMap(map);
    const st = stateAt(map.spawn.x, map.spawn.z);
    wl.update(st, 1, 1 / 60, { x: map.spawn.x, z: map.spawn.z });
    const pool = rc.lights.pool;
    assert.equal(pool.length, QUALITY[q].maxLights - 1);
    const lit = pool.filter(l => l.intensity > 0);
    assert.equal(lit.length, Math.min(pool.length, map.lights.length), `${q}: 풀이 다 찬다`);
    const dist = (l) => Math.hypot(l.position.x - map.spawn.x, l.position.z - map.spawn.z);
    const sorted = map.lights.map(l => Math.hypot(l.x - map.spawn.x, l.z - map.spawn.z)).sort((a, b) => a - b);
    const maxLit = Math.max(...lit.map(dist));
    assert.ok(maxLit <= sorted[lit.length - 1] + 1e-6, `${q}: 가까운 것부터`);
    for (const l of pool) assert.ok(Number.isFinite(l.intensity) && l.intensity >= 0);
    assert.ok(Math.abs(rc.lights.player.position.x - map.spawn.x) < 1e-9 && rc.lights.player.position.y > 2);
    wl.dispose();
  }
});

// ───────────────────────── 마을 ─────────────────────────

test('마을 — 건물 넷 · 균열석(첫 판 전에만 흰 고리) · 포털(열려 있으면 안쪽 발광) · NPC 몸은 그리지 않는다(P8)', () => {
  const { wl } = makeLayer();
  const map = townMapFromData();
  wl.setMap(map);
  const names = new Set();
  wl.group.traverse(o => names.add(o.name));
  for (const id of ['smithy', 'grocery', 'tent', 'tower']) assert.ok(names.has('building:' + id), id);
  const st = stateAt(24, 20, 'town');
  st.char = /** @type {any} */ ({ runs: 0 });
  st.town.portalOpen = false;
  wl.update(st, 1, 1 / 60, null);
  assert.equal(wl._firstRing.visible, true, 'runs 0 → 흰 고리');
  assert.equal(wl._townPortalInner.visible, false, '균열이 없으면 꺼짐');
  st.char.runs = 1;
  st.town.portalOpen = true;
  wl.update(st, 1, 1 / 60, null);
  assert.equal(wl._firstRing.visible, false);
  assert.equal(wl._townPortalInner.visible, true);
  wl.dispose();
});

test('마을 — 건물이 플레이어를 가리면(카메라 쪽 광선) 0.15초에 반투명 · 아니면 불투명', () => {
  // 광선 판정: 상자 바로 −X−Z(뒤)에 선 플레이어는 가려진다 · +X+Z(앞)는 아니다
  assert.equal(rayHitsBox(7, 1, 7, 8, 16, 5, 8, 16), true);
  assert.equal(rayHitsBox(17, 1, 17, 8, 16, 5, 8, 16), false);
  assert.equal(rayHitsBox(30, 1, 9, 8, 16, 5, 8, 16), false);
  const { wl } = makeLayer();
  wl.setMap(townMapFromData());
  const smithy = wl._buildings.find(b => b.x0 === 8 && b.z0 === 33);
  assert.ok(smithy);
  const st = stateAt(12, 32.6, 'town');     // 대장간 앞(−Z) 바짝 — 지붕 처마가 머리를 가린다
  wl.update(st, 1, 1 / 60, null);
  st.tick++;
  wl.update(st, 1, 0.2, null);
  assert.ok(smithy.cur < 0.5, `반투명(${smithy.cur})`);
  st.player.pos = { x: 24, z: 20 }; st.player.prevPos = { x: 24, z: 20 };
  st.tick++;
  wl.update(st, 1, 0.2, null);
  assert.equal(smithy.cur, 1);
  wl.dispose();
});

// ───────────────────────── 균열 포털 · 견고성 ─────────────────────────

test('균열 포털 — rift.portals 마다 빛 고리(풀 · 수 상한) · 장면이 바뀌면 숨김', () => {
  const { wl } = makeLayer();
  const map = crypt();
  wl.setMap(map);
  const st = stateAt(map.spawn.x, map.spawn.z);
  st.rift = /** @type {any} */ ({ portals: [{ id: 'portal:1', kind: 'recall', pos: { x: 30, z: 30 }, r: 1, born: 0 }, { id: 'portal:2', kind: 'exit', pos: { x: 34, z: 26 }, r: 1, born: 0 }] });
  st.tick = 30;
  wl.update(st, 1, 1 / 60, null);
  const vis = wl._rportals.filter(p => p.root.visible);
  assert.equal(vis.length, 2);
  assert.notEqual(vis[0].mats[0].color.getHex(), vis[1].mats[0].color.getHex(), '귀환 · 출구 색이 다르다');
  st.rift.portals = [];
  wl.update(st, 1, 1 / 60, null);
  assert.equal(wl._rportals.filter(p => p.root.visible).length, 0);
  wl.dispose();
});

test('WorldLayer — 플레이어 없음 · alpha NaN · 큰 dt · 맵 없음 · 빛 장치 없는 rc 에서 던지지 않고 행렬이 유한', () => {
  const { wl } = makeLayer({ lights: false });
  const st = stateAt(10, 10);
  wl.update(st, 0.5, 1 / 60, null);          // 맵 없음
  wl.setMap(crypt());
  wl.update(st, NaN, 5, { x: NaN, z: 3 });
  /** @type {any} */ (st).player = null;
  wl.update(st, 1, 1 / 60, null);
  wl.update(/** @type {any} */ ({ tick: 3, town: {}, scene: 'rift', rift: null }), 1, 0, null);
  wl.group.traverse(o => {
    if (o instanceof THREE.InstancedMesh) for (const v of o.instanceMatrix.array) assert.ok(Number.isFinite(v), o.name);
  });
  wl.dispose();
});

// ───────────────────────── 카메라 ─────────────────────────

test('카메라 거리 — 기본 24m · 휠 한 칸 2m · 16 ~ 32m(두 배) · 0.2초 감쇠', () => {
  assert.equal(CAM_DISTANCE, 24);
  assert.equal(zoomTargetAfter(24, 1), 26);
  assert.equal(zoomTargetAfter(24, -1), 22);
  assert.equal(zoomTargetAfter(31, 5), CAM_DISTANCE_MAX);
  assert.equal(zoomTargetAfter(17, -9), CAM_DISTANCE_MIN);
  assert.equal(zoomTargetAfter(24, NaN), 24);
  assert.equal(CAM_DISTANCE_MAX / CAM_DISTANCE_MIN, 2);
  const bus = new EventBus();
  const rc = makeRc({ lights: false });
  const cam = new CameraRig({ rc, bus, settings: { screenShake: true } });
  const st = stateAt(10, 10);
  cam.update(st, 1, 1 / 60);
  for (let k = 0; k < 20; k++) cam.zoom(1);
  assert.equal(cam.zoomTarget, 32);
  cam.update(st, 1, 0.1);
  assert.ok(cam.dist > 24 && cam.dist < 32, '감쇠 중');
  cam.update(st, 1, 0.1);
  assert.ok((cam.dist - 24) / 8 >= 0.94, `0.2초에 95% 닿는다(${cam.dist})`);
  for (let k = 0; k < 20; k++) cam.zoom(-1);
  for (let k = 0; k < 30; k++) cam.update(st, 1, 0.05);
  assert.equal(cam.dist, 16);
});

test('카메라 자리 — 방위 π/4 · 앙각 55° · 대상 = 플레이어 + 카메라 쪽 0.12 × 거리 · 기본 거리에서 위 · 아래 각 11m 넘게 보인다(위협 거리 · 봇 시야)', () => {
  const pose = cameraPose(0, 0, 24);
  const lead = Math.hypot(pose.tx, pose.tz);
  assert.ok(Math.abs(lead - CAM_LEAD * 24) < 1e-9 && pose.tx > 0 && Math.abs(pose.tx - pose.tz) < 1e-9, '카메라 쪽(+X+Z) 앞당김 2.88m');
  const dx = pose.px - pose.tx, dy = pose.py - pose.ty, dz = pose.pz - pose.tz;
  assert.ok(Math.abs(Math.hypot(dx, dy, dz) - 24) < 1e-9);
  assert.ok(Math.abs(Math.atan2(dy, Math.hypot(dx, dz)) - CAM_ELEVATION) < 1e-9, '앙각');
  assert.ok(Math.abs(Math.atan2(dx, dz) - CAM_AZIMUTH) < 1e-9, '방위(+X+Z 위)');
  // 화면 위 · 아래 · 옆 끝이 땅에 닿는 곳(16:9)
  const camera = new THREE.PerspectiveCamera(CAM_FOV, 16 / 9, 0.5, 220);
  camera.position.set(pose.px, pose.py, pose.pz);
  camera.lookAt(pose.tx, pose.ty, pose.tz);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  const rc = new THREE.Raycaster();
  const ground = (nx, ny, y = 0) => {
    rc.setFromCamera(new THREE.Vector2(nx, ny), camera);
    const o = rc.ray.origin, d = rc.ray.direction;
    const t = (y - o.y) / d.y;
    return { x: o.x + d.x * t, z: o.z + d.z * t };
  };
  const up = (p) => (-p.x - p.z) * S;        // 화면 위 = (−1, 0, −1)/√2
  const right = (p) => (p.x - p.z) * S;       // 화면 오른쪽 = (1, 0, −1)/√2
  const top = up(ground(0, 1)), bottom = -up(ground(0, -1)), side = right(ground(1, 0));
  assert.ok(top >= MON.threatRange && bottom >= MON.threatRange, `위 ${top.toFixed(2)}m · 아래 ${bottom.toFixed(2)}m ≥ 위협 거리 ${MON.threatRange}m`);
  assert.ok(Math.min(top, bottom) >= 11.0 && Math.abs(top - bottom) < 2.5, '플레이어가 화면 세로 가운데 언저리');
  assert.ok(side >= 15, `옆 ${side.toFixed(2)}m`);
  // 몸 가운데 높이(y 1.0 — 대상 높이) 평면에서는 위 · 아래 각 11.4m(§9.3 · BOT.viewR)
  const top1 = up(ground(0, 1, 1)), bottom1 = -up(ground(0, -1, 1));
  assert.ok(Math.abs(top1 - BOT.viewR) < 0.1 && Math.abs(bottom1 - BOT.viewR) < 0.1, `y 1.0 에서 위 ${top1.toFixed(2)} · 아래 ${bottom1.toFixed(2)} ≈ ${BOT.viewR}`);
  // 화면 오른쪽 방향이 §0.2 그대로
  const r = ground(1, 0);
  assert.ok(r.x > 0 && r.z < 0);
});

test('카메라 따라가기 — 임계 감쇠 스프링(한 프레임 순간이동 없음 · 넘치지 않음) · PLAYER_SPAWNED 는 바로', () => {
  // 스프링 해석해: 큰 dt 에도 목표를 넘지 않는다
  const v = [0];
  let x = 0, vx = 0;
  for (let k = 0; k < 200; k++) { x = springAxis(x, vx, 10, CAMERA.omega, 1 / 60, v); vx = v[0]; assert.ok(x <= 10 + 1e-9); }
  assert.ok(Math.abs(x - 10) < 0.01);
  assert.ok(Math.abs(springAxis(0, 0, 10, CAMERA.omega, 50, v) - 10) < 1e-6);
  const bus = new EventBus();
  const rc = makeRc({ lights: false });
  const cam = new CameraRig({ rc, bus, settings: { screenShake: true } });
  const st = stateAt(10, 10);
  cam.update(st, 1, 1 / 60);
  const t0 = { ...cam.target };
  // 플레이어가 한 틱에 20m 이동(순간이동 연출 없이) → 한 프레임에 카메라는 조금만
  st.player.prevPos = { x: 10, z: 10 }; st.player.pos = { x: 30, z: 10 };
  st.tick++;
  cam.update(st, 1, 1 / 60);
  const moved = Math.hypot(cam.target.x - t0.x, cam.target.z - t0.z);
  assert.ok(moved > 0 && moved < 1.0, `한 프레임 ${moved.toFixed(3)}m`);
  // 보간: alpha 로 prev → pos 를 섞는다
  // PLAYER_SPAWNED → 바로(대상이 이벤트 자리 + 앞당김)
  bus.emit(EV.PLAYER_SPAWNED, { x: 50, z: 60, facing: 0, reason: 'scene' });
  const lead = CAM_LEAD * cam.dist * S;
  assert.ok(Math.abs(cam.target.x - (50 + lead)) < 1e-9 && Math.abs(cam.target.z - (60 + lead)) < 1e-9, '이벤트에서 바로 대상이 옮겨진다(같은 프레임의 컬링 · 빛 기준)');
  st.player.prevPos = { x: 50, z: 60 }; st.player.pos = { x: 50, z: 60 };
  cam.update(st, 1, 1 / 60);
  assert.ok(Math.abs(cam.target.x - (50 + lead)) < 1e-9, 'snap 뒤 그 자리');
  // snap() — 다음 update 에서 바로
  st.player.prevPos = { x: 0, z: 0 }; st.player.pos = { x: 0, z: 0 };
  cam.snap();
  cam.update(st, 1, 1 / 60);
  assert.ok(Math.abs(cam.target.x - lead) < 1e-9);
  // 카메라 행렬이 갱신돼 있다(project · groundAt 이 다음 렌더 전에도 맞다)
  assert.ok(Math.abs(rc.camera.position.y - (1 + cam.dist * Math.sin(CAM_ELEVATION))) < 1e-6);
  assert.ok(rc.camera.matrixWorld.elements.every(Number.isFinite));
  cam.dispose();
  assert.equal(bus.count(), 0, '구독 해제');
});

test('흔들림 — 진폭 amp × 0.25m · 상한 0.25m · 선형 감쇠 · 큰 쪽이 이긴다 · 설정 screenShake 끄면 0', () => {
  const bus = new EventBus();
  const rc = makeRc({ lights: false });
  const settings = { screenShake: true };
  const cam = new CameraRig({ rc, bus, settings });
  const st = stateAt(10, 10);
  cam.update(st, 1, 1 / 60);
  bus.emit(EV.SHAKE, { amp: 5, sec: 0.5 });
  let peak = 0;
  for (let k = 0; k < 40; k++) { cam.update(st, 1, 1 / 120); peak = Math.max(peak, cam.shakeOffset); assert.ok(cam.shakeOffset <= 0.25 + 1e-9); }
  assert.ok(peak > 0.15, `흔들린다(${peak.toFixed(3)})`);
  for (let k = 0; k < 40; k++) cam.update(st, 1, 1 / 60);
  assert.equal(cam.shakeOffset, 0, '시간이 지나면 0');
  bus.emit(EV.SHAKE, { amp: 0.4, sec: 0.3 });
  let p2 = 0;
  for (let k = 0; k < 20; k++) { cam.update(st, 1, 1 / 240); p2 = Math.max(p2, cam.shakeOffset); }
  assert.ok(p2 <= 0.4 * 0.25 + 1e-9, `amp 0.4 → ≤ 0.1m(${p2.toFixed(3)})`);
  bus.emit(EV.SHAKE, { amp: 0.1, sec: 0.3 });     // 작은 것은 큰 것을 덮지 않는다
  assert.ok(cam._shakeAmp >= 0.1 - 1e-9 && cam._shakeAmp > 0.025);
  settings.screenShake = false;
  cam.update(st, 1, 1 / 60);
  assert.equal(cam.shakeOffset, 0, '끄면 바로 0');
  bus.emit(EV.SHAKE, { amp: 1, sec: 1 });
  cam.update(st, 1, 1 / 60);
  assert.equal(cam.shakeOffset, 0);
  cam.dispose();
});

test('벽 인스턴스의 정의 — 벽 타일 = 바닥에 8방향으로 닿는 비바닥(§3.4) · 수가 같다', () => {
  const map = crypt();
  let walls = 0;
  for (let j = 0; j < map.h; j++) for (let i = 0; i < map.w; i++) {
    if (map.tiles[j * map.w + i] !== TILE_WALL) continue;
    walls++;
    let touches = false;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj;
      if (ii >= 0 && jj >= 0 && ii < map.w && jj < map.h && map.tiles[jj * map.w + ii] === TILE_FLOOR) touches = true;
    }
    assert.ok(touches);
  }
  assert.equal(walls, wallTileCount(map));
});

test('view.world: 바닥 빛(용암)은 적대 표식 색과 섞이지 않는다(화면 패스 — 시작점 밑 붉은 원 회귀 · NOTES-W1 7-4)', () => {
  // sRGB 16진의 색상각(°) — three 의 Color 는 선형으로 바꿔 각이 달라진다
  const hueOf = (hex) => {
    const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx === mn) return 0;
    const h = mx === r ? ((g - b) / (mx - mn)) % 6 : mx === g ? (b - r) / (mx - mn) + 2 : (r - g) / (mx - mn) + 4;
    return (h * 60 + 360) % 360;
  };
  assert.ok(hueOf(0xff3b30) < 5, '적대 테두리는 붉다');
  const L = EMIT.lava;
  // 적대 테두리 #ff3b30 의 색상각은 약 3° — 바닥 후광 · 실제 빛은 주황(20° 이상)
  assert.ok(hueOf(L.color) >= 20, `후광 ${hueOf(L.color).toFixed(1)}°`);
  assert.ok(hueOf(L.lightColor) >= 20, `빛 ${hueOf(L.lightColor).toFixed(1)}°`);
  assert.ok(L.k <= 0.35 && L.glow <= 3, '후광은 작고 옅게');
  assert.ok(L.lightY >= 1, '점광원을 바닥에서 띄운다(바닥에 진한 원반이 생기지 않게)');
  const cav = TILESETS.find((t) => t.id === 'cavern');
  assert.ok(cav.lights.kinds.some((k) => k.kind === 'lava'), '용암 빛이 데이터에 있다');
});
