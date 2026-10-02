// 계약 §9.4 — 카메라 충돌의 연속성(Node에서 three만으로 · WebGL 없이).
// 기둥 · 상자 모서리가 「피벗 → 카메라」 선을 스치는 순간 충돌 목표 거리는 불연속으로 꺾인다.
// 그 값을 한 프레임에 넣으면 화면이 3~4m 순간이동한다 — 거리 · 각 모두 속도 상한으로 따라가야 한다.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EventBus, EV } from '../src/core/events.js';
import { CAMERA } from '../src/data/camera.js';
import { getWorld } from '../src/data/world.js';
import { DEFAULT_SETTINGS } from '../src/data/settings.js';
import { CameraRig } from '../src/view/CameraRig.js';
import { makeTestState } from './helpers.js';

const DT = 1 / 60;
/** 한 프레임에 허용하는 카메라 이동(m): 충돌로 당겨지는 몫(25m/s) + 회전 몫. 고치기 전에는 2~4.7m였다. */
const MAX_STEP = 0.8;
/** 한 프레임에 허용하는 시선 방향 변화(rad). 고치기 전에는 상자 모서리에서 0.36이었다. */
const MAX_TURN = 0.25;

/**
 * @param {{world?:string, x:number, z:number, facing:number}} o
 * 자유 시점(록온 없음)의 카메라. facing 쪽을 보며 시작한다(카메라는 그 반대편에 놓인다).
 */
function makeCam(o) {
  const world = getWorld(o.world ?? 'town');
  const state = makeTestState({ world, mode: world.kind === 'arena' ? 'boss' : 'town' });
  const p = state.player;
  p.pos = { x: o.x, z: o.z };
  p.prevPos = { x: o.x, z: o.z };
  p.facing = o.facing;
  const camera = new THREE.PerspectiveCamera(CAMERA.fov, 16 / 9, CAMERA.near, CAMERA.far);
  const bus = new EventBus();
  const rig = new CameraRig({ camera, bus, settings: { ...DEFAULT_SETTINGS } });
  const pivot = () => new THREE.Vector3(p.pos.x, CAMERA.pivotY, p.pos.z);
  const dir = new THREE.Vector3();
  const prevPos = new THREE.Vector3();
  const prevDir = new THREE.Vector3();
  const stat = { maxStep: 0, maxTurn: 0, maxDrop: 0, maxGrow: 0, frames: 0 };
  let prevDist = -1;
  /** yawRate(rad/s)로 n프레임 돌린다. 한 프레임의 위치 · 방향 · 거리 변화를 stat에 모은다. */
  const spin = (n, yawRate = 0, dt = DT) => {
    const dx = -(yawRate * dt) / (CAMERA.rotSpeed * (DEFAULT_SETTINGS.mouseSensitivity ?? 1));
    for (let i = 0; i < n; i++) {
      rig.update(state, 1, dt, { dx, dy: 0 });
      camera.getWorldDirection(dir);
      const dist = camera.position.distanceTo(pivot());
      for (const v of [camera.position.x, camera.position.y, camera.position.z, dir.x, dir.y, dir.z]) assert.ok(Number.isFinite(v), '카메라에 NaN');
      if (prevDist >= 0) {
        stat.maxStep = Math.max(stat.maxStep, camera.position.distanceTo(prevPos));
        stat.maxTurn = Math.max(stat.maxTurn, dir.angleTo(prevDir));
        stat.maxDrop = Math.max(stat.maxDrop, prevDist - dist);
        stat.maxGrow = Math.max(stat.maxGrow, dist - prevDist);
        stat.frames += 1;
      }
      prevDist = dist;
      prevPos.copy(camera.position);
      prevDir.copy(dir);
    }
  };
  const dist = () => camera.position.distanceTo(pivot());
  return { state, camera, rig, bus, spin, stat, dist, world };
}

describe('카메라 충돌 — 기둥(원)', () => {
  // 펜리르 아레나의 얼음 기둥 k = 0: (0, 15) r 1.3. 플레이어는 3m 남쪽. 카메라가 북쪽(기둥 쪽)으로 돌아 들어간다.
  const PILLAR = getWorld('arena_fenrir').colliders[0];
  const PAD = CAMERA.collide.hitPad;

  test('기둥이 카메라 선을 스쳐도 한 프레임에 순간이동하지 않는다 · 0.3초 안에 기둥 앞으로 온다', () => {
    assert.ok(Math.abs(PILLAR.x) < 1e-9 && Math.abs(PILLAR.z - 15) < 1e-9 && PILLAR.r === 1.3, '기둥 위치가 바뀌었다 — 시나리오를 다시 잡는다');
    // 카메라는 facing의 반대편: facing = π − 1.0이면 카메라가 기둥의 접선 각(0.56rad) 밖에 있다
    const c = makeCam({ world: 'arena_fenrir', x: 0, z: 12, facing: Math.PI - 1.0 });
    c.spin(1);
    assert.ok(Math.abs(c.dist() - CAMERA.distBoss) < 1e-6, `막힌 것이 없으면 distBoss: ${c.dist()}`);
    c.spin(20, 3);          // 3rad/s로 1.0rad — 기둥 한가운데까지 쓸고 들어간다
    assert.ok(Math.abs(c.rig.yaw - Math.PI) < 0.02 || Math.abs(c.rig.yaw + Math.PI) < 0.02, `yaw ${c.rig.yaw}`);
    c.spin(18);             // 0.3초 그대로
    const s = c.stat;
    assert.ok(s.maxDrop > 0.2, `거리가 줄었다(한 프레임 최대 ${s.maxDrop.toFixed(2)}m)`);
    assert.ok(s.maxDrop <= 25 * DT + 0.02, `한 프레임 거리 감소 ${s.maxDrop.toFixed(2)}m — 순간이동`);
    assert.ok(s.maxStep < MAX_STEP, `한 프레임 카메라 이동 ${s.maxStep.toFixed(2)}m`);
    assert.ok(s.maxTurn < MAX_TURN, `한 프레임 시선 변화 ${s.maxTurn.toFixed(3)}rad`);
    // 끝: 카메라가 (패드를 더한) 기둥 앞에 있다 — 기둥 속 · 뒤에 남지 않는다
    const cam = c.camera.position;
    assert.ok(cam.z < PILLAR.z - PILLAR.r - PAD + 0.02, `카메라 z ${cam.z.toFixed(2)}가 기둥 앞(${(PILLAR.z - PILLAR.r - PAD).toFixed(2)})을 넘는다`);
    assert.ok(c.dist() < 2.0 && c.dist() >= CAMERA.distMin - 1e-9, `줄어든 거리 ${c.dist().toFixed(2)}`);
    // 줄어든 만큼 올려다본다(§9.4-3)
    assert.ok(cam.y > CAMERA.pivotY + Math.sin(CAMERA.pitchDefault + 0.3) * c.dist(), `올려다보기 y ${cam.y.toFixed(2)}`);
    c.rig.dispose();
  });

  test('벗어나면 damp로 부드럽게 되돌아간다 · 스냅(모드 전환) 직후에는 목표로 바로 간다 · dt 0이면 그대로', () => {
    const c = makeCam({ world: 'arena_fenrir', x: 0, z: 12, facing: Math.PI });
    c.spin(1);
    // 첫 프레임(스냅)부터 기둥 앞 — 기둥을 뚫고 천천히 오지 않는다
    assert.ok(c.camera.position.z < PILLAR.z - PILLAR.r - PAD + 0.02, `스냅 직후 카메라 z ${c.camera.position.z.toFixed(2)}`);
    const near = c.dist();
    c.spin(5, 0, 0);        // 일시정지(dt 0)
    assert.ok(Math.abs(c.dist() - near) < 1e-9, 'dt 0이면 움직이지 않는다');
    c.spin(40, 3);          // 2.0rad 돌아 기둥을 벗어난다
    c.spin(120);
    assert.ok(c.stat.maxGrow < 0.5, `늘어날 때 한 프레임 ${c.stat.maxGrow.toFixed(2)}m`);
    assert.ok(Math.abs(c.dist() - CAMERA.distBoss) < 0.05, `원하는 거리로 돌아온다: ${c.dist().toFixed(2)}`);
    // MODE_CHANGED → 다음 update에서 등 뒤로 스냅: 이때는 목표 거리를 그대로 넣는다(전환 페이드 뒤의 첫 화면)
    c.state.player.facing = Math.PI;
    c.bus.emit(EV.MODE_CHANGED, { mode: 'boss', worldId: c.world.id, bossId: null });
    c.rig.update(c.state, 1, DT, { dx: 0, dy: 0 });
    assert.ok(c.camera.position.z < PILLAR.z - PILLAR.r - PAD + 0.02, `스냅 뒤 카메라 z ${c.camera.position.z.toFixed(2)}`);
    c.rig.dispose();
  });
});

describe('카메라 충돌 — 상자(마을의 담 · 건물)', () => {
  const smithy = getWorld('town').colliders.find((c) => c.type === 'box' && c.x < 0);
  const wall = getWorld('town').colliders.find((c) => c.type === 'box' && c.hw > 5);

  test('건물 모서리를 스쳐도 거리 · 시선이 한 프레임에 꺾이지 않는다', () => {
    assert.ok(smithy && Math.abs(smithy.x + 10.5) < 1e-9 && Math.abs(smithy.z - 7) < 1e-9, '대장간 상자가 바뀌었다 — 시나리오를 다시 잡는다');
    for (const [x, z] of [[-7.0, 5.0], [-8.0, 6.5]]) {
      for (const rate of [3, -3]) {
        const c = makeCam({ x, z, facing: 0 });
        c.spin(1);
        c.spin(180, rate);
        assert.ok(c.stat.maxStep < MAX_STEP, `(${x}, ${z}) ${rate}rad/s: 한 프레임 카메라 이동 ${c.stat.maxStep.toFixed(2)}m`);
        assert.ok(c.stat.maxTurn < MAX_TURN, `(${x}, ${z}) ${rate}rad/s: 한 프레임 시선 변화 ${c.stat.maxTurn.toFixed(3)}rad`);
        c.rig.dispose();
      }
    }
  });

  test('담을 등지면 여전히 담 앞에서 멎고 위에서 내려다본다(W4)', () => {
    assert.ok(wall, '안개문 담 상자');
    const face = wall.z - wall.hd;   // 담의 앞면(z 15.2)
    // 담 0.6m 앞에서 담을 등지고 선다(facing = π → 카메라는 +z, 담 쪽)
    const c = makeCam({ x: 5, z: face - 0.6, facing: Math.PI });
    c.spin(1);
    const first = c.camera.position.clone();
    c.spin(60);
    assert.ok(c.camera.position.distanceTo(first) < 1e-6, '스냅 직후 이미 최종 위치다');
    assert.ok(c.camera.position.z <= face + 1e-6, `카메라 z ${c.camera.position.z.toFixed(2)}가 담(${face})을 넘는다`);
    const dir = new THREE.Vector3();
    c.camera.getWorldDirection(dir);
    assert.ok(Math.asin(-dir.y) > 1.0, `내려다보는 각 ${Math.asin(-dir.y).toFixed(2)}rad`);
    assert.ok(c.camera.position.y > 2.3, `머리 위 ${c.camera.position.y.toFixed(2)}m`);
    // 담에서 걸어 나오면 내려온다
    const p = c.state.player;
    for (let i = 0; i < 180; i++) {
      p.prevPos = { ...p.pos };
      p.pos = { x: p.pos.x, z: Math.max(8, p.pos.z - 4 * DT) };
      c.spin(1);
    }
    c.camera.getWorldDirection(dir);
    assert.ok(Math.asin(-dir.y) < 0.6 && Math.abs(c.dist() - CAMERA.distTown) < 0.1, `담을 떠난 뒤 각 ${Math.asin(-dir.y).toFixed(2)} · 거리 ${c.dist().toFixed(2)}`);
    assert.ok(c.stat.maxTurn < MAX_TURN, `걸어 나오는 동안 한 프레임 시선 변화 ${c.stat.maxTurn.toFixed(3)}rad`);
    c.rig.dispose();
  });
});
