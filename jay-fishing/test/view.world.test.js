// OWNER: P5 — 계약 §9.1 · §9.3 · §9.4 · §9.5 · §9.10 · §7.11 (P5 가 더한 파일 — §12.2 표에 없는 view-world 검사)
// Node 에서 three 지오메트리만으로(렌더러 없음) 월드 레이어를 만들고 판정과 보이는 것이 맞는지 본다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EV, EventBus } from '../src/core/events.js';
import { angleDiff, pointInConvex, yawOf } from '../src/core/math.js';
import { DEFAULT_SETTINGS, QUALITY, MOUSE } from '../src/data/settings.js';
import { WORLD } from '../src/data/world.js';
import { STAGES, getStage } from '../src/data/stages/index.js';
import { FIXTURE_NAMES, makeFixtureState } from '../src/debug/fixtures.js';
import { WorldLayer } from '../src/view/WorldLayer.js';
import { CameraRig } from '../src/view/CameraRig.js';
import { buildHomeProps } from '../src/view/stages/homeProps.js';
import { buildLakeProps } from '../src/view/stages/lakeProps.js';
import { createTerrainField } from '../src/view/world/terrain.js';

function makeRc(quality = 'medium') {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 2500);
  camera.rotation.order = 'YXZ';
  scene.add(camera);
  return { scene, camera, renderer: null, quality, setQuality(q) { this.quality = q; }, render() {}, prewarm() {}, dispose() {} };
}

/** 장면의 지오메트리 · 텍스처 집합 */
function gpuSets(root) {
  const geos = new Set();
  const texs = new Set();
  root.traverse((o) => {
    if (o.geometry) geos.add(o.geometry);
    const m = o.material;
    if (!m) return;
    for (const k of ['map', 'emissiveMap', 'normalMap', 'roughnessMap']) if (m[k]) texs.add(m[k]);
    if (m.uniforms) for (const u of Object.values(m.uniforms)) if (u && u.value && u.value.isTexture) texs.add(u.value);
  });
  return { geos, texs };
}

const outdoor = STAGES.filter(s => s.kind === 'outdoor');

let shared = null;
function sharedWorld() {
  if (!shared) {
    const rc = makeRc();
    const bus = new EventBus();
    const world = new WorldLayer({ rc, bus, settings: structuredClone(DEFAULT_SETTINGS) });
    shared = { rc, bus, world };
  }
  return shared;
}

test('settings.js 가 §7.11 그대로', () => {
  assert.deepEqual(DEFAULT_SETTINGS, { version: 1, mouseSens: 1.0, invertY: false, quality: 'medium', fov: 70,
    volume: { master: 0.8, sfx: 1.0, ambience: 0.7, ui: 0.8 }, hints: true });
  assert.deepEqual(QUALITY, {
    low: { pixelRatio: 1.0, shadows: false, shadowMap: 0, waterReflect: 'none', fogParticles: 0, rainDrops: 600, terrainSeg: 96 },
    medium: { pixelRatio: 1.5, shadows: true, shadowMap: 1024, waterReflect: 'sky', fogParticles: 60, rainDrops: 1500, terrainSeg: 160 },
    high: { pixelRatio: 2.0, shadows: true, shadowMap: 2048, waterReflect: 'planar', fogParticles: 140, rainDrops: 3000, terrainSeg: 256 },
  });
  assert.deepEqual(MOUSE, { radPerPx: 0.0022, spikeClampPx: 120, keyYawRate: 1.2 });
  for (const q of Object.values(QUALITY)) assert.ok(q.pixelRatio <= 2);
});

test('네 씬을 부팅 때 만들고 state.scene 에 맞춰 visible 만 바꾼다', () => {
  const { world } = sharedWorld();
  assert.deepEqual(Object.keys(world.scenes).sort(), ['coast', 'home', 'lake', 'river']);
  for (const id of ['home', 'lake', 'coast', 'river', 'lake']) {
    const s = makeFixtureState('walkLake');
    s.scene = id;
    world.update(s, 0, 1 / 60);
    for (const k of Object.keys(world.scenes)) assert.equal(world.scenes[k].group.visible, k === id, `${id}: ${k}`);
    assert.equal(world.sceneId, id);
  }
  assert.equal(world.root.parent, world.rc.scene);
  assert.equal(world.root.name, 'worldRoot');
});

test('heightAt = 지형 메시를 만든 같은 함수(정점마다 일치) · 집은 0', () => {
  const { world } = sharedWorld();
  for (const st of outdoor) {
    const g = world.scenes[st.id].terrain.geometry;
    const pos = g.attributes.position;
    const step = Math.max(1, Math.floor(pos.count / 4000));
    for (let i = 0; i < pos.count; i += step) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = world.heightAtScene(st.id, x, z);
      assert.ok(Math.abs(pos.getY(i) - y) < 1e-4, `${st.id} (${x}, ${z}) 메시 ${pos.getY(i)} ≠ ${y}`);
    }
  }
  assert.equal(world.heightAtScene('home', 1, 1), 0);
  // 지금 씬을 따른다
  const s = makeFixtureState('rain');
  world.update(s, 0, 1 / 60);
  assert.equal(world.heightAt(4, 2.2), world.heightAtScene('coast', 4, 2.2));
});

test('설 자리 높이 ∈ [0.3, 1.2] · 걷는 영역 경사 ≤ 30° · 물 쪽은 수면 아래 · 유한수', () => {
  for (const st of outdoor) {
    const f = createTerrainField(st);
    for (const sp of st.spots) {
      const h = f.heightAt(sp.stand.x, sp.stand.z);
      assert.ok(h >= 0.3 && h <= 1.2, `${sp.id} 높이 ${h}`);
      // 착수 부채꼴(물 쪽)은 수면 아래
      for (const d of [sp.minCastM, 20, 40]) {
        const x = sp.stand.x - Math.sin(sp.facing) * d;
        const z = sp.stand.z - Math.cos(sp.facing) * d;
        assert.ok(f.heightAt(x, z) < 0, `${sp.id} ${d}m 바닥이 수면 위`);
      }
    }
    let maxDeg = 0;
    const e = 0.05;
    for (let x = -50; x <= 50; x += 0.5) {
      for (let z = 0; z <= 40; z += 0.5) {
        if (!pointInConvex(st.walk, x, z)) continue;
        const sx = (f.heightAt(x + e, z) - f.heightAt(x - e, z)) / (2 * e);
        const sz = (f.heightAt(x, z + e) - f.heightAt(x, z - e)) / (2 * e);
        maxDeg = Math.max(maxDeg, Math.atan(Math.hypot(sx, sz)) * 180 / Math.PI);
        assert.ok(Number.isFinite(f.heightAt(x, z)));
      }
    }
    assert.ok(maxDeg <= 30, `${st.id} 걷는 영역 최대 경사 ${maxDeg.toFixed(1)}°`);
  }
});

test('자리 고리: 중심 = stand · 반경 1.2m(판정 1.4m 와 0.2m 안) · 땅 위에 붙는다', () => {
  const { world } = sharedWorld();
  for (const st of outdoor) {
    const rings = world.scenes[st.id].rings;
    assert.equal(rings.length, st.spots.length);
    for (const sp of st.spots) {
      const r = rings.find(x => x.id === sp.id);
      assert.ok(r, sp.id);
      const pos = r.ring.geometry.attributes.position;
      let sum = 0;
      for (let i = 0; i < pos.count; i++) {
        const d = Math.hypot(pos.getX(i) - sp.stand.x, pos.getZ(i) - sp.stand.z);
        sum += d;
        assert.ok(d >= 1.2 - 0.1 && d <= 1.2 + 0.1, `${sp.id} 고리 정점 반경 ${d}`);
        const ground = world.heightAtScene(st.id, pos.getX(i), pos.getZ(i));
        assert.ok(pos.getY(i) > ground && pos.getY(i) - ground < 0.1, `${sp.id} 고리가 땅에서 뜬다/묻힌다`);
      }
      const mean = sum / pos.count;
      assert.ok(Math.abs(mean - 1.2) < 0.02, `${sp.id} 평균 반경`);
      assert.ok(Math.abs(mean - WORLD.spotRadius) <= 0.2 + 1e-4, `${sp.id} 고리 ${mean} 와 판정 ${WORLD.spotRadius} 차이`);
    }
  }
});

test('장애물 띠: snag.fromM 에서 1m 안에 시작 · fromM+8m 안 · facing ± arc 부채꼴 · 바닥 재질별 모양', () => {
  const { world } = sharedWorld();
  const v = new THREE.Vector3();
  const m = new THREE.Matrix4();
  for (const st of outdoor) {
    for (const sp of st.spots) {
      const grp = world.scenes[st.id].group.getObjectByName(`spot:${sp.id}`);
      const snag = grp.getObjectByName('snag');
      let minR = Infinity;
      let maxR = 0;
      let n = 0;
      snag.traverse((o) => {
        if (!o.isInstancedMesh) return;
        const pos = o.geometry.attributes.position;
        for (let k = 0; k < o.count; k++) {
          o.getMatrixAt(k, m);
          for (let i = 0; i < pos.count; i++) {
            v.fromBufferAttribute(pos, i).applyMatrix4(m);
            const dx = v.x - sp.stand.x;
            const dz = v.z - sp.stand.z;
            const r = Math.hypot(dx, dz);
            minR = Math.min(minR, r);
            maxR = Math.max(maxR, r);
            n++;
          }
          // 인스턴스 중심이 부채꼴 안
          v.setFromMatrixPosition(m);
          const a = yawOf(v.x - sp.stand.x, v.z - sp.stand.z);
          assert.ok(Math.abs(angleDiff(sp.facing, a)) <= sp.arc + 1e-6, `${sp.id} 부채꼴 밖`);
        }
      });
      assert.ok(n > 0, `${sp.id} 띠가 비었다`);
      assert.ok(Math.abs(minR - sp.snag.fromM) <= 1.0, `${sp.id} 띠 시작 ${minR.toFixed(2)} vs fromM ${sp.snag.fromM}`);
      assert.ok(maxR <= sp.snag.fromM + 8 + 1.0, `${sp.id} 띠 끝 ${maxR.toFixed(2)}`);
    }
  }
});

/** 소품 그룹에서 걷는 영역 안 · 높이 0.5m 초과 정점이 obstacles 원 밖에 있으면 모은다(§9.4) */
function tallViolations(stage, group, heightAt) {
  const bad = [];
  const v = new THREE.Vector3();
  const m = new THREE.Matrix4();
  group.updateMatrixWorld(true);
  const check = (x, y, z, name) => {
    if (!pointInConvex(stage.walk, x, z)) return;
    if (y - heightAt(x, z) <= 0.5) return;
    for (const o of stage.obstacles) if (Math.hypot(x - o.x, z - o.z) <= o.r + 0.02) return;
    bad.push(`${name} (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`);
  };
  group.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    const pos = o.geometry.attributes.position;
    if (o.isInstancedMesh) {
      for (let k = 0; k < o.count; k++) {
        o.getMatrixAt(k, m);
        m.premultiply(o.matrixWorld);
        for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(m); check(v.x, v.y, v.z, o.name || 'inst'); }
      }
    } else {
      for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); check(v.x, v.y, v.z, o.name || o.parent?.name || 'mesh'); }
    }
  });
  return bad;
}

test('소품 · NPC · 캠프: 걷는 영역 안에서 0.5m 넘는 것은 obstacles 원 안에만(§9.4)', () => {
  const { world } = sharedWorld();
  for (const id of ['home', 'lake']) {
    const sc = world.scenes[id];
    const stage = getStage(id);
    const heightAt = (x, z) => world.heightAtScene(id, x, z);
    const groups = [sc.props.group];
    for (const n of sc.npcs) groups.push(n.group);
    if (sc.camp) groups.push(sc.camp.group);
    for (const g of groups) {
      const bad = tallViolations(stage, g, heightAt);
      assert.deepEqual(bad.slice(0, 5), [], `${id}/${g.name}: ${bad.length}개`);
    }
  }
  // 코스트 · 강의 일반형(NPC · 캠프)도
  for (const id of ['coast', 'river']) {
    const sc = world.scenes[id];
    const stage = getStage(id);
    const heightAt = (x, z) => world.heightAtScene(id, x, z);
    for (const g of [...sc.npcs.map(n => n.group), sc.camp.group]) {
      const bad = tallViolations(stage, g, heightAt);
      assert.deepEqual(bad.slice(0, 5), [], `${id}/${g.name}: ${bad.length}개`);
    }
  }
});

test('호수 소품: 낚시 자리의 facing ± arc · 60m 수면 시야를 가리지 않는다', () => {
  const stage = getStage('lake');
  const field = createTerrainField(stage);
  const props = buildLakeProps({ stage, quality: 'high', heightAt: field.heightAt });
  const v = new THREE.Vector3();
  const m = new THREE.Matrix4();
  props.group.updateMatrixWorld(true);
  const bad = [];
  props.group.traverse((o) => {
    if (!o.isMesh) return;
    const pts = [];
    if (o.isInstancedMesh) for (let k = 0; k < o.count; k++) { o.getMatrixAt(k, m); m.premultiply(o.matrixWorld); pts.push(v.setFromMatrixPosition(m).clone()); }
    else pts.push(v.setFromMatrixPosition(o.matrixWorld).clone());
    for (const p of pts) {
      if (p.y + 0.3 < 0) continue;   // 물속 바닥 소품
      for (const sp of stage.spots) {
        const dx = p.x - sp.stand.x;
        const dz = p.z - sp.stand.z;
        const d = Math.hypot(dx, dz);
        if (d < 1.0 || d > 60) continue;
        const tall = o.geometry.boundingSphere ? o.geometry.boundingSphere.radius > 0.3 : true;
        if (tall && Math.abs(angleDiff(sp.facing, yawOf(dx, dz))) < sp.arc) bad.push(`${o.name || 'mesh'} @${sp.id} (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
      }
    }
  });
  props.dispose();
  assert.deepEqual(bad.slice(0, 5), [], `${bad.length}개`);
});

test('고정 상태 전부를 돌려도 NaN 없음 · 판을 반복해도 지오메트리 · 텍스처가 늘지 않는다', () => {
  const { rc, world } = sharedWorld();
  const cam = new CameraRig({ camera: rc.camera, settings: { fov: 70 }, world });
  const before = gpuSets(rc.scene);
  for (let round = 0; round < 3; round++) {
    for (const name of FIXTURE_NAMES) {
      const s = makeFixtureState(name);
      for (let i = 0; i < 4; i++) {
        cam.update(s, i / 4, 1 / 60, { yaw: s.player.yaw, pitch: s.player.pitch });
        world.update(s, i / 4, i === 3 ? 0.25 : 1 / 60);
        const p = rc.camera.position;
        assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z), `${name} 카메라 NaN`);
      }
    }
    // 화질을 오가도
    rc.setQuality(round % 2 ? 'low' : 'high');
    world.update(makeFixtureState('rain'), 0, 1 / 60);
  }
  rc.setQuality('medium');
  world.update(makeFixtureState('night'), 0, 1 / 60);
  const after = gpuSets(rc.scene);
  assert.equal(after.geos.size, before.geos.size, '지오메트리 수');
  assert.equal(after.texs.size, before.texs.size, '텍스처 수');
  for (const g of after.geos) assert.ok(before.geos.has(g), '새 지오메트리가 생겼다');
});

test('밤 · 비: 헤드랜턴 켬 · 빗줄기 보임 · 집에서는 비 · 안개 없음', () => {
  const { world } = sharedWorld();
  const night = makeFixtureState('night');
  assert.equal(night.env.headlamp, true);
  world.update(night, 0, 1 / 60);
  world.update(night, 0, 1 / 60);
  assert.ok(world.headlamp.intensity > 0, '헤드랜턴');
  assert.ok(world.sky.uniforms.uMoonDir.value.y > 0, '달이 떠 있다');
  const rain = makeFixtureState('rain');
  world.update(rain, 0, 1 / 60);
  assert.equal(world.rain.object.visible, true, '비');
  assert.ok(world.fog.density > 0, '안개');
  const home = makeFixtureState('shopL12');
  world.update(home, 0, 1 / 60);
  assert.equal(world.rain.object.visible, false);
  assert.equal(world.fog.density, 0);
  assert.equal(world.sky.group.visible, false);
});

test('자리 고리: 가까우면 밝아지고 낚시 중인 자리는 숨긴다', () => {
  const { world } = sharedWorld();
  const s = makeFixtureState('walkLake');
  s.player.pos = { x: 0, z: 2.5 };
  s.player.prevPos = { x: 0, z: 2.5 };
  s.player.nearby = { kind: 'spot', id: 'lake_gravel', dist: 0.9 };
  world.update(s, 0, 1 / 60);
  const rings = world.scenes.lake.rings;
  const g = rings.find(r => r.id === 'lake_gravel');
  const o = rings.find(r => r.id === 'lake_cape');
  assert.ok(g.mat.opacity > o.mat.opacity, '가까운 고리가 더 밝다');
  const f = makeFixtureState('ready');
  world.update(f, 0, 1 / 60);
  assert.equal(rings.find(r => r.id === f.player.spotId).ring.visible, false);
  assert.equal(o.ring.visible, true);
});

test('카메라: 보간 위치 + 눈높이 · 최신 시선 · PLAYER_PLACED / SCENE_CHANGED 에서만 한 프레임에 붙는다', () => {
  const rc = makeRc();
  const bus = new EventBus();
  const world = { heightAt: () => 0.5, heightAtScene: () => 0.5, placeSerial: 0, settings: { fov: 70 } };
  const cam = new CameraRig({ camera: rc.camera, settings: { fov: 70 }, world });
  void bus;
  const s = makeFixtureState('walkLake');
  s.player.prevPos = { x: 0, z: 10 };
  s.player.pos = { x: 1, z: 10 };
  s.player.speed = 0;
  cam.update(s, 0.5, 1 / 60, { yaw: 0.3, pitch: -0.2 });      // 첫 프레임은 붙는다
  assert.equal(cam.snapped, true);
  cam.update(s, 0.5, 1 / 60, { yaw: 0.3, pitch: -0.2 });
  assert.equal(cam.snapped, false);
  assert.ok(Math.abs(rc.camera.position.x - 0.5) < 1e-9, '보간 x');
  assert.ok(Math.abs(rc.camera.position.y - (0.5 + WORLD.eyeHeight)) < 1e-9, '눈높이');
  assert.equal(rc.camera.rotation.y, 0.3);
  assert.equal(rc.camera.rotation.x, -0.2);
  assert.equal(rc.camera.rotation.order, 'YXZ');
  // 순간이동(PLAYER_PLACED → placeSerial++): 보간 없이 pos 에 붙는다
  s.player.prevPos = { x: 50, z: 10 };
  s.player.pos = { x: 1, z: 10 };
  world.placeSerial++;
  cam.update(s, 0.1, 1 / 60, { yaw: 0, pitch: 0 });
  assert.equal(cam.snapped, true);
  assert.ok(Math.abs(rc.camera.position.x - 1) < 1e-9);
  // FOV 는 설정을 따른다
  world.settings.fov = 80;
  cam.update(s, 0, 1 / 60, { yaw: 0, pitch: 0 });
  assert.equal(rc.camera.fov, 80);
});

test('카메라 걷기 흔들림: 진폭 ≤ 0.03m · 낚시 모드 · sim 정지(패널) 중에는 없다', () => {
  const rc = makeRc();
  const world = { heightAt: () => 0, heightAtScene: () => 0, placeSerial: 0 };
  const cam = new CameraRig({ camera: rc.camera, settings: { fov: 70 }, world });
  const s = makeFixtureState('walkLake');
  s.player.speed = WORLD.walkSpeed;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < 240; i++) {
    s.tick++;
    cam.update(s, 1, 1 / 60, { yaw: 0, pitch: 0 });
    if (i > 60) { minY = Math.min(minY, rc.camera.position.y); maxY = Math.max(maxY, rc.camera.position.y); }
  }
  const amp = (maxY - minY) / 2;
  assert.ok(amp > 0.02 && amp <= 0.0301, `흔들림 진폭 ${amp}`);
  // sim 이 멈추면(tick 그대로) 위상이 흐르지 않는다
  const y0 = rc.camera.position.y;
  for (let i = 0; i < 30; i++) cam.update(s, 1, 1 / 60, { yaw: 0, pitch: 0 });
  assert.ok(Math.abs(rc.camera.position.y - WORLD.eyeHeight) <= Math.abs(y0 - WORLD.eyeHeight) + 1e-9, '정지 중 흔들림이 자라지 않는다');
  // 낚시 모드: 흔들림 없음
  const f = makeFixtureState('ready');
  f.player.speed = 2;
  for (let i = 0; i < 120; i++) { f.tick++; cam.update(f, 1, 1 / 60, { yaw: 0, pitch: 0 }); }
  assert.ok(Math.abs(rc.camera.position.y - (0 + WORLD.eyeHeight)) < 1e-6);
});

test('이벤트: SCENE_CHANGED 로 씬이 바뀌고 placeSerial 이 오른다 · dispose 가 구독을 끊는다', () => {
  const rc = makeRc('low');
  const bus = new EventBus();
  const world = new WorldLayer({ rc, bus, settings: { ...DEFAULT_SETTINGS, quality: 'low' } });
  const n0 = world.placeSerial;
  bus.emit(EV.SCENE_CHANGED, { from: null, to: 'river', reason: 'debug' });
  assert.equal(world.sceneId, 'river');
  assert.equal(world.scenes.river.group.visible, true);
  bus.emit(EV.PLAYER_PLACED, { x: 0, z: 0, yaw: 0, pitch: 0, reason: 'spawn' });
  assert.equal(world.placeSerial, n0 + 2);
  bus.emit(EV.SETTINGS_CHANGED, { settings: { ...DEFAULT_SETTINGS, quality: 'high' } });
  assert.equal(rc.quality, 'high');
  world.update(makeFixtureState('driftRiver'), 0, 1 / 60);
  assert.equal(world.quality, 'high');
  world.dispose();
  assert.equal(world.root.parent, null);
  bus.emit(EV.SCENE_CHANGED, { from: 'river', to: 'lake', reason: 'debug' });
  assert.equal(world.sceneId, 'river', '끊긴 뒤에는 반응하지 않는다');
});

test('집 소품: 책상 · 모니터(발광) · 침대 · 문이 상호작용 점 둘레(반경 − 0.4m 안)에 있다 · Node 에서 만들고 dispose', () => {
  const stage = getStage('home');
  const props = buildHomeProps({ stage, quality: 'medium', heightAt: () => 0 });
  props.group.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const find = (n) => props.group.getObjectByName(n);
  for (const [kind, name] of [['pc', 'desk'], ['bed', null], ['door', null]]) {
    const pt = stage.points.find(p => p.kind === kind);
    assert.ok(pt, kind);
    if (name) {
      box.setFromObject(find(name));
      const cx = Math.max(box.min.x, Math.min(pt.x, box.max.x));
      const cz = Math.max(box.min.z, Math.min(pt.z, box.max.z));
      assert.ok(Math.hypot(cx - pt.x, cz - pt.z) <= pt.radius - 0.4, `${kind} 물체가 점에서 멀다`);
    }
  }
  let emissive = false;
  props.group.traverse((o) => { if (o.material && o.material.emissiveMap) emissive = true; });
  assert.ok(emissive, '모니터 화면이 발광한다');
  props.update({ hour: 22, light: 0.06, night: true, sunDir: new THREE.Vector3(0, -1, 0), weather: 'clear', waveAmp: 0, wavePeriod: 1, time: 3, camPos: new THREE.Vector3() }, 1 / 60);
  props.dispose();
});
