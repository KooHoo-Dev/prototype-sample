// OWNER: 리뷰 수정(view) — view-perf · browser-robustness 지적의 회귀(계약 §9.1 · §9.2 · §9.3 · §9.8 · §9.11)
// Node 에서 three 객체만(렌더러 없음). 브라우저에서만 드러나는 것(셰이더 링크 수 · draw call · DPR 만 바뀔 때의 캔버스 버퍼)은
// 헤드리스 Chromium 으로 쟀고 여기서는 그 원인이 된 상태(재질 dispose · 그림자 autoUpdate · 렌더 타깃 크기 · 물결 불투명도)를 고정한다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EV, EventBus } from '../src/core/events.js';
import { FIGHT } from '../src/data/fight.js';
import { GEAR_BY_ID } from '../src/data/gear.js';
import { DEFAULT_SETTINGS } from '../src/data/settings.js';
import { getSpot } from '../src/data/stages/index.js';
import { makeFixtureState } from '../src/debug/fixtures.js';
import { WorldLayer } from '../src/view/WorldLayer.js';
import { FishLayer } from '../src/view/fish/FishLayer.js';
import { FishPreview } from '../src/view/fish/FishPreview.js';
import { makeTestState } from './helpers.js';

function fakeRc(quality = 'medium') {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1280 / 720, 0.05, 2500);
  camera.rotation.order = 'YXZ';
  scene.add(camera);
  return { scene, camera, renderer: null, quality, setQuality(q) { this.quality = q; }, render() {}, prewarm() {}, dispose() {} };
}

/** 파이팅 상태(계약 §3.4 필드) — fishModel.test.js 의 withFight 와 같은 리터럴 */
function withFight(state, { speciesId = 'carp', lengthCm = 60, dist = 20, bearing = 0, depth = 2, behavior = 'run' } = {}) {
  const spot = getSpot(state.player.spotId);
  const rs = GEAR_BY_ID[state.profile.sets[state.rig.set].rod];
  const lineKg = 4;
  const tension = 2;
  state.rig.phase = 'fighting';
  state.rig.phaseTime = 0;
  state.fight = {
    speciesId, roll: { speciesId, z: 0, pct: 0.5, lengthCm, weightKg: 3, tier: 'normal' },
    t: 5, dist, prevDist: dist, minDist: spot.edgeM + FIGHT.minDistPad, bearing, prevBearing: bearing, halfArc: 0.9,
    depth, airborne: 0, stamina: 0.5, behavior, behaviorName: behavior, behaviorT: 0.5, behaviorDur: 1, telegraph: null,
    tension, tensionRatio: tension / lineKg, limitKg: lineKg, limitBy: 'line', limitRatio: tension / lineKg, lineKg, lineEffKg: lineKg, abrasion: 0,
    inSnag: false, inCover: 0, rodLift: 0, rodUp: false, rodLoadRatio: tension / rs.maxLoadKg, rodStress: false, rodOverT: 0, lineDanger: false,
    slipping: false, slipSpeed: 0, reeling: false, gainSpeed: 0, slack: false, slackTime: 0, spoolLeftM: 100,
    canNet: false, netRangeM: spot.edgeM + FIGHT.netReachM, netBuffer: 0, landStamina: 0.15, showStamina: false,
    traits: [], k: { Fmax: 3, vmax: 2, endurance: 30 }, stats: { maxTension: tension, sumTension: 0, sumTension2: 0, ticks: 0, runs: 0, jumps: 0, slackTicks: 0, slipTicks: 0 }, brain: {},
  };
  return state;
}

function placeCamera(rc, state) {
  const p = state.player;
  rc.camera.position.set(p.pos.x, 0.8 + 1.65, p.pos.z);
  rc.camera.rotation.set(p.pitch, p.yaw, 0);
  rc.camera.updateMatrixWorld(true);
}

test('화질을 낮추면 반사 렌더 타깃 · 그림자 맵을 놓는다(다시 올리면 렌더가 새로 잡는다)', () => {
  const rc = fakeRc('high');
  const world = new WorldLayer({ rc, bus: new EventBus(), settings: structuredClone(DEFAULT_SETTINGS) });
  const lake = makeFixtureState('walkLake');
  world.update(lake, 0, 1 / 60);
  // high 에서 반사 · 그림자가 그려진 뒤의 모양(Node 에는 렌더러가 없어 손으로 만든다)
  const rt = world.reflection.rt;
  rt.setSize(960, 540);
  let rtDisposed = 0;
  rt.addEventListener('dispose', () => rtDisposed++);
  const map = new THREE.WebGLRenderTarget(2048, 2048);
  let mapDisposed = 0;
  map.addEventListener('dispose', () => mapDisposed++);
  world.sun.shadow.map = map;
  rc.setQuality('medium');
  world.update(lake, 0, 1 / 60);
  assert.equal(rt.width, 16, 'medium(반사 sky): 반 해상도 반사 버퍼를 놓는다');
  assert.equal(rtDisposed, 1);
  assert.equal(world.reflection.rt, rt, '같은 렌더 타깃(물 셰이더의 uReflTex 가 그 텍스처를 계속 가리킨다)');
  rc.setQuality('low');
  world.update(lake, 0, 1 / 60);
  assert.equal(world.sun.shadow.map, null, 'low(그림자 없음): 그림자 맵을 놓는다');
  assert.equal(mapDisposed, 1);
  assert.equal(world.sun.castShadow, false);
  assert.equal(rtDisposed, 1, '이미 놓은 반사 버퍼는 다시 건드리지 않는다');
  rc.setQuality('medium');
  world.update(lake, 0, 1 / 60);
  assert.equal(world.sun.castShadow, true);
  assert.equal(world.sun.shadow.map, null, '다시 켜면 three 가 첫 그림자 패스에서 만든다');
  world.dispose();
});

test('집(방향광 세기 0)에서는 그림자 패스를 건너뛴다 — 맵이 아직 없으면 한 번은 그린다 · 야외는 매 프레임', () => {
  const rc = fakeRc('medium');
  const world = new WorldLayer({ rc, bus: new EventBus(), settings: structuredClone(DEFAULT_SETTINGS) });
  const home = makeFixtureState('shopL12');
  assert.equal(home.scene, 'home');
  world.update(home, 0, 1 / 60);
  assert.equal(world.sun.intensity, 0);
  assert.equal(world.sun.castShadow, true, 'castShadow 는 그대로(빛 · 프로그램이 바뀌지 않는다)');
  assert.equal(world.sun.shadow.autoUpdate, true, '맵이 없으면 그린다 — null 맵을 묶으면 GL_INVALID_OPERATION · 검은 방(실측)');
  world.sun.shadow.map = new THREE.WebGLRenderTarget(1024, 1024);   // 첫 그림자 패스가 만든 모양
  world.update(home, 0, 1 / 60);
  assert.equal(world.sun.shadow.autoUpdate, false, '맵이 있으면 집에서는 그림자 패스를 건너뛴다');
  const lake = makeFixtureState('walkLake');
  world.update(lake, 0, 1 / 60);
  assert.equal(world.sun.shadow.autoUpdate, true, '야외는 매 프레임 그림자를 그린다');
  world.update(home, 0, 1 / 60);
  assert.equal(world.sun.shadow.autoUpdate, false);
  world.dispose();
});

test('실패 퇴장: V자 물결은 그림자와 같은 비율로 옅어지고, 실패 순간 보이지 않았으면 켜지 않는다', () => {
  for (const behavior of ['run', 'hold']) {
    const rc = fakeRc();
    const bus = new EventBus();
    const layer = new FishLayer({ rc, bus, settings: {}, world: { heightAt: () => 0 } });
    const s = withFight(makeTestState({ spotId: 'lake_gravel', set: 'bottom' }), { dist: 18, depth: 5, behavior });
    placeCamera(rc, s);
    for (let i = 0; i < 30; i++) layer.update(s, 1, 1 / 60);      // 나타나기(0.3초) 끝
    const wake = rc.scene.getObjectByName('fishWake');
    const sh = rc.scene.getObjectByName('fishShadow');
    const wakeMat = /** @type {any} */ (wake).material;
    const shadowMat = /** @type {any} */ (sh.children[0]).material;
    const wasVisible = wake.visible;
    assert.equal(wasVisible, behavior === 'run', `${behavior}: 실패 전 물결`);
    const w0 = wakeMat.opacity;
    const s0 = shadowMat.opacity;
    assert.ok(s0 > 0);
    bus.emit(EV.FAIL, { reason: 'lineBreak' });
    s.rig.phase = 'failed';
    s.fight = null;
    let prevW = Infinity;
    let frames = 0;
    while (sh.visible && frames < 120) {
      layer.update(s, 1, 1 / 60);
      frames++;
      if (!sh.visible) break;
      assert.equal(wake.visible, wasVisible, `${behavior}: 퇴장 중 물결은 실패 순간의 보임 그대로`);
      if (wasVisible) {
        assert.ok(wakeMat.opacity <= prevW + 1e-12, `${behavior}: 물결이 점점 옅어진다`);
        assert.ok(Math.abs(wakeMat.opacity / w0 - shadowMat.opacity / s0) < 1e-9, `${behavior}: 물결 · 그림자가 같은 비율`);
        prevW = wakeMat.opacity;
      }
    }
    assert.ok(frames > 20 && frames < 60, `${behavior}: 0.6초 안에 끝난다(${frames}프레임)`);
    assert.equal(wake.visible, false);
    assert.equal(sh.visible, false);
    layer.dispose();
  }
});

test('FishPreview: 모델은 (어종 · 실루엣)마다 한 번 만들고 바꿀 때 떼고 붙이기만 한다 — 재질을 dispose 하지 않는다', () => {
  const fp = new FishPreview();
  assert.equal(fp.ok, false, 'Node: WebGL 없음');
  // WebGL 없이 모델 교체 경로만 본다(_ensure 가 만드는 pivot 을 대신 둔다)
  const pivot = new THREE.Group();
  fp._pivot = pivot;
  const disposed = new Set();
  const watch = (m) => m.traverse(o => {
    const mat = /** @type {any} */ (o).material;
    if (mat) for (const x of [].concat(mat)) x.addEventListener('dispose', () => disposed.add(x));
  });
  const carp = fp._setModel('carp', false);
  watch(carp);
  const crucian = fp._setModel('crucian', false);
  watch(crucian);
  assert.notEqual(carp, crucian);
  assert.deepEqual(pivot.children, [crucian], '한 번에 하나만 붙어 있다');
  for (let i = 0; i < 6; i++) fp._setModel(i % 2 ? 'crucian' : 'carp', false);
  assert.equal(fp._setModel('carp', false), carp, '같은 키면 같은 모델(다시 만들지 않는다)');
  assert.deepEqual(pivot.children, [carp]);
  const sil = fp._setModel('carp', true);
  watch(sil);
  assert.notEqual(sil, carp, '실루엣은 다른 모델');
  assert.deepEqual(pivot.children, [sil]);
  assert.equal(disposed.size, 0, '바꾸는 동안 재질을 dispose 하지 않는다(셰이더 프로그램이 지워졌다 다시 링크되지 않게)');
  assert.equal(fp._models.size, 3);
  fp.dispose();
  assert.ok(disposed.size > 0, 'dispose 에서 한 번에 정리한다');
  assert.equal(fp._models.size, 0);
  assert.equal(pivot.children.length, 0);
});
