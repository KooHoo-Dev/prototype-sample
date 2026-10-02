// 화면 패스(마지막 웨이브) 회귀 — 정지 화면으로 찾아 고친 것이 되돌아가지 않게. 계약 §9.7 · §9.4 · §9.10 · §10.3 · QUALITY §4.
// DOM · WebGL 없이 Node 에서 돈다: 순수 도우미 · 지오메트리 · onBeforeCompile 가 만드는 셰이더 문면 · CSS 문면.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { getStage } from '../src/data/stages/index.js';
import { RIG } from '../src/data/bite.js';
import { presentAngleDeg, rodAngleDeg } from '../src/view/tackle/TackleLayer.js';
import { netPose } from '../src/view/tackle/netPose.js';
import { buildCoastProps } from '../src/view/stages/coastProps.js';
import { buildSpotMarker, createMarkerKit } from '../src/view/world/markers.js';
import { createTerrainField } from '../src/view/world/terrain.js';
import { EventBus } from '../src/core/events.js';
import { fwd } from '../src/core/math.js';
import { FIGHT } from '../src/data/fight.js';
import { getSpot } from '../src/data/stages/index.js';
import { FishLayer } from '../src/view/fish/FishLayer.js';
import { makeTestState } from './helpers.js';

test('화면 패스: 세운 로드는 화면 안으로 눕혀 그린다 — 판정 각(rodAngleDeg)은 그대로', () => {
  const fight = (lift) => ({ rig: { phase: 'fighting' }, fight: { rodLift: lift } });
  assert.equal(rodAngleDeg(fight(1)), 75, '판정 각(계약 §9.7)');
  const shown = presentAngleDeg(fight(1));
  assert.ok(shown >= 45 && shown <= 58, `보이는 세운 각 ${shown}° — 75° 는 로드 윗부분이 화면 위로 나가 휨이 안 보였다`);
  assert.equal(presentAngleDeg(fight(0)), 15, '숙인 로드는 그대로');
  assert.ok(presentAngleDeg(fight(0.5)) > 15 && presentAngleDeg(fight(0.5)) < shown, '세울수록 단조 증가');
  for (const rig of [{ phase: 'ready', set: 'float' }, { phase: 'waiting', set: 'bottom' }, { phase: 'charging', power: 1 }, { phase: 'landing' }]) {
    assert.equal(presentAngleDeg({ rig }), rodAngleDeg({ rig }), `${rig.phase}: 파이팅 밖은 계약 각 그대로`);
  }
});

test('화면 패스: 뜰채는 netTime 의 75% 에 들어 올림을 끝낸다(그물이 결과 패널 전에 보인다)', () => {
  const camera = new THREE.PerspectiveCamera(70, 1280 / 720, 0.05, 2500);
  camera.rotation.order = 'YXZ';
  camera.position.set(0, 0.8 + 1.65, 1.6);
  camera.rotation.set(-0.15, 0, 0);
  camera.updateMatrixWorld(true);
  const out = { hand: new THREE.Vector3(), dir: new THREE.Vector3(), hoop: new THREE.Vector3(), target: new THREE.Vector3(), handleLen: 0, reach: 0, p: 0 };
  const state = (t) => ({
    player: { spotId: 'lake_gravel' },
    rig: { phase: 'landing', phaseTime: t, origin: { x: 0, z: 1.6 } },
    fight: { netRangeM: 3.0, dist: 2.1, prevDist: 2.1, bearing: 0, prevBearing: 0, minDist: 2.1 },
  });
  netPose(camera, state(RIG.netTime * 0.3), 1, out);
  const scoopY = out.hoop.y;
  assert.ok(scoopY < out.hand.y - 0.5, `뜨는 동안 테는 물 쪽 아래(${scoopY.toFixed(2)})`);
  netPose(camera, state(RIG.netTime * 0.76), 1, out);
  assert.ok(out.hoop.y >= out.hand.y - 0.05, `75% 에서 테가 손 높이까지 올라와 있다(테 ${out.hoop.y.toFixed(2)} · 손 ${out.hand.y.toFixed(2)})`);
  const lifted = out.hoop.clone();
  netPose(camera, state(RIG.netTime * 0.99), 1, out);
  assert.ok(out.hoop.distanceTo(lifted) < 0.02, '들어 올린 뒤 끝까지 그 자세로 보인다');
});

test('화면 패스: 갯바위 — 먼 바위의 깊은 몸통 · 물보라는 멀수록 옅다 · 등대 빛줄기는 카메라 가까이에서 사라진다', () => {
  const stage = getStage('coast');
  const field = createTerrainField(stage);
  const props = buildCoastProps({ stage, quality: 'medium', heightAt: field.heightAt });
  const fakeShader = () => ({
    uniforms: {},
    vertexShader: '#include <begin_vertex>\n#include <project_vertex>\n',
    fragmentShader: '#include <clipping_planes_fragment>\n#include <map_fragment>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n',
  });
  const rocks = props.group.getObjectByName('lavaRocks0');
  const sh = fakeShader();
  rocks.material.onBeforeCompile(sh);
  assert.match(sh.fragmentShader, /discard/, '물 너머로 비치는 깊은 바위 몸통(옅은 기둥)을 버린다');
  assert.match(sh.vertexShader, /vRockD/, '카메라 거리로 가른다(가까운 얕은 물의 바위는 그대로)');
  const spray = props.group.getObjectByName('surfSpray');
  const sp = fakeShader();
  spray.material.onBeforeCompile(sp);
  assert.match(sp.fragmentShader, /vCamD/, '물보라는 멀수록 옅다');
  assert.match(sp.fragmentShader, /vMapUv\.y/, '물보라는 위로 갈수록 옅다');
  const beam = props.group.getObjectByName('lighthouseBeam');
  assert.ok(beam.material.uniforms && beam.material.uniforms.uNear, '빛줄기는 카메라 가까이에서 사라진다(uNear)');
  assert.ok(beam.material.uniforms.uNear.value.x >= 5, '가까운 거리 문턱');
  const env = { hour: 22, light: 0.1, night: true, sunDir: new THREE.Vector3(0, 1, 0), weather: 'clear', waveAmp: 0.18, wavePeriod: 6, time: 1, camPos: new THREE.Vector3(0, 2, 20) };
  props.update(env, 1 / 60);
  assert.ok(beam.material.uniforms.uOpacity.value > 0 && beam.visible, '밤에는 빛줄기');
  props.update({ ...env, hour: 12, light: 1, night: false }, 1 / 60);
  assert.equal(beam.visible, false, '한낮에는 없다');
  props.dispose();
});

test('화면 패스: 자리 깃발이 스폰(약 20m)에서 읽히는 크기 · 갯바위 땅이 검은 평지가 아니다', () => {
  const kit = createMarkerKit();
  const spot = getStage('lake').spots[0];
  const mk = buildSpotMarker(spot, () => 0.5, kit, 7);
  let flag = null;
  mk.group.traverse((o) => { if (o.isMesh && o.material === kit.mats.flag) flag = o; });
  assert.ok(flag, '깃발');
  flag.geometry.computeBoundingBox();
  const b = flag.geometry.boundingBox;
  assert.ok(b.max.x - b.min.x >= 0.55, `깃발 길이 ${(b.max.x - b.min.x).toFixed(2)}m`);
  assert.ok(b.max.y - b.min.y >= 0.3, `깃발 높이 ${(b.max.y - b.min.y).toFixed(2)}m`);
  mk.dispose();
  kit.dispose();
  const ground = new THREE.Color(getStage('coast').look.terrain.ground);
  const lum = 0.2126 * ground.r + 0.7152 * ground.g + 0.0722 * ground.b;
  assert.ok(lum > 0.06, `갯바위 땅 밝기(선형) ${lum.toFixed(3)} — 용암 바위 소품보다 밝아야 걷는 땅이 읽힌다`);
});

test('화면 패스: HUD 채비 줄은 한 줄로(가운데 절대 배치가 50vw 에서 접히지 않게)', () => {
  const css = readFileSync(new URL('../src/ui/style.css', import.meta.url), 'utf8');
  const rule = css.slice(css.indexOf('#ui-root .hud-rig {'), css.indexOf('}', css.indexOf('#ui-root .hud-rig {')));
  assert.match(rule, /width:\s*max-content/, '.hud-rig 은 내용 폭(max-content) — 없으면 left 50% 에서 남은 폭으로 접힌다');
  assert.match(rule, /max-width:\s*72vw/, '너무 길면 72vw 에서 접는다');
});

test('화면 패스: 먼 그림자는 시선 방향으로 늘어 보인다(단축 보정) — 중심은 판정 위치 그대로', () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1280 / 720, 0.05, 2500);
  camera.rotation.order = 'YXZ';
  scene.add(camera);
  const rc = { scene, camera, renderer: null, quality: 'medium', setQuality() {}, render() {}, prewarm() {}, dispose() {} };
  const layer = new FishLayer({ rc, bus: new EventBus(), settings: {}, world: { heightAt: () => 0 } });
  const s = makeTestState({ spotId: 'lake_gravel', set: 'bottom' });
  camera.position.set(s.player.pos.x, 0.8 + 1.65, s.player.pos.z);
  const spot = getSpot('lake_gravel');
  const put = (dist) => {
    s.rig.phase = 'fighting';
    s.fight = {
      speciesId: 'carp', roll: { speciesId: 'carp', z: 0, pct: 0.5, lengthCm: 60, weightKg: 3, tier: 'normal' }, t: 5, dist, prevDist: dist,
      minDist: spot.edgeM + FIGHT.minDistPad, bearing: 0.2, prevBearing: 0.2, halfArc: 0.9, depth: 2, airborne: 0, stamina: 0.5,
      behavior: 'rest', behaviorName: 'rest', behaviorT: 0, behaviorDur: 1, telegraph: null, tension: 1, tensionRatio: 0.25, limitKg: 4, limitBy: 'line',
      limitRatio: 0.25, lineKg: 4, lineEffKg: 4, abrasion: 0, inSnag: false, inCover: 0, rodLift: 0, rodUp: false, rodLoadRatio: 0.3, rodStress: false,
      rodOverT: 0, lineDanger: false, slipping: false, slipSpeed: 0, reeling: false, gainSpeed: 0, slack: false, slackTime: 0, spoolLeftM: 100,
      canNet: false, netRangeM: 3, netBuffer: 0, landStamina: 0.15, showStamina: false, traits: [], k: { Fmax: 3, vmax: 2, endurance: 30 },
      stats: { maxTension: 1, sumTension: 0, sumTension2: 0, ticks: 0, runs: 0, jumps: 0, slackTicks: 0, slipTicks: 0 }, brain: {},
    };
    layer.update(s, 1, 1 / 60);
    return rc.scene.getObjectByName('fishShadow');
  };
  const sh = put(16);
  const want = { x: s.rig.origin.x + fwd(0.2).x * 16, z: s.rig.origin.z + fwd(0.2).z * 16 };
  const e = sh.matrix.elements;
  assert.ok(Math.abs(e[12] - want.x) < 1e-9 && Math.abs(e[14] - want.z) < 1e-9, '행렬의 중심 = 판정 위치');
  assert.ok(layer.foreshorten > 2 && layer.foreshorten <= 4, `16m 단축 보정 ${layer.foreshorten.toFixed(2)}배`);
  put(3);
  assert.ok(layer.foreshorten < 1.3, `가까우면 거의 그대로(${layer.foreshorten.toFixed(2)})`);
  put(60);
  assert.equal(layer.foreshorten, 4, '상한');
  layer.dispose();
});
