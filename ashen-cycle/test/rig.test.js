// OWNER: P5 — 계약 §12.2 「rig.test.js」
// Node에서 three만으로(WebGL 없이): 리그 3종 관절/소켓 · 포즈 수학 끝점 · bossReleaseT · VALDER_POSES · MOTIONS ·
// 실루엣 규칙 · 뷰 전 상태 NaN 0 · CharacterLayer의 getSocketWorld.
// 다른 패키지의 구현에 기대지 않는다 — 상태는 test/helpers.js의 리터럴 빌더로 만든다.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EventBus, EV } from '../src/core/events.js';
import { PALETTE } from '../src/data/palette.js';
import { PLAYER } from '../src/data/player.js';
import { COMBAT } from '../src/data/combat.js';
import { WEAPONS } from '../src/data/weapons.js';
import { VALDER } from '../src/data/bosses/valder.js';
import { DEFAULT_SETTINGS } from '../src/data/settings.js';
import { Rig, buildHumanoidRig, buildQuadrupedRig, buildFloaterRig } from '../src/view/characters/rig.js';
import { ease, emptyPose, lerpPose, addPose, attackPose, bossReleaseT, PoseBlender } from '../src/view/characters/pose.js';
import { MOTIONS, createPlayerView } from '../src/view/characters/playerView.js';
import { VALDER_POSES, createValderView } from '../src/view/bosses/valderView.js';
import { CharacterLayer } from '../src/view/characters/CharacterLayer.js';
import { makeTestState, makeTestPlayer, makeTestStats, makeTestBoss } from './helpers.js';

const HUMANOID_JOINTS = ['hips', 'spine', 'chest', 'head', 'shoulderL', 'elbowL', 'handL', 'shoulderR', 'elbowR', 'handR',
  'hipL', 'kneeL', 'footL', 'hipR', 'kneeR', 'footR'];
const HUMANOID_SOCKETS = ['weapon', 'weaponBase', 'weaponTip', 'head', 'chest', 'handL'];
const QUADRUPED_JOINTS = ['hips', 'spine', 'chest', 'neck', 'head', 'jaw', 'shoulderFL', 'elbowFL', 'pawFL', 'shoulderFR', 'elbowFR', 'pawFR',
  'hipBL', 'kneeBL', 'pawBL', 'hipBR', 'kneeBR', 'pawBR', 'tail1', 'tail2', 'tail3'];
const QUADRUPED_SOCKETS = ['mouth', 'head', 'chest', 'tailTip'];
const FLOATER_JOINTS = ['core', 'chest', 'head', 'shoulderL', 'elbowL', 'handL', 'shoulderR', 'elbowR', 'handR', 'robe1', 'robe2', 'robe3', 'halo'];
const FLOATER_SOCKETS = ['weapon', 'weaponBase', 'weaponTip', 'head', 'chest', 'handL'];
const VALDER_POSE_KEYS = ['slashR', 'slashL', 'overhead', 'thrust', 'leap', 'spin', 'slamGround', 'delayed', 'cast'];
const MOTION_KEYS = ['slashR', 'slashL', 'slashUp', 'overhead', 'thrust', 'spin', 'sweep'];
const GRIPS = ['oneHand', 'twoHand', 'polearm'];
const PLAYER_STATES = ['idle', 'move', 'roll', 'backstep', 'attack', 'guard', 'guardHit', 'guardBreak', 'parry', 'flask',
  'stagger', 'knockdown', 'getup', 'execute', 'dead'];
const BOSS_STATES = ['intro', 'idle', 'chase', 'attack', 'parried', 'groggy', 'executed', 'recover', 'phaseShift', 'dead'];

const makeRigs = () => ({
  humanoid: buildHumanoidRig({ height: 1.8, bulk: 1, palette: PALETTE.player, helmet: 'knight', cape: true }),
  quadruped: buildQuadrupedRig({ length: 5.6, shoulderHeight: 2.4, palette: PALETTE.fenrir, spikes: true }),
  floater: buildFloaterRig({ height: 2.8, hover: 0.8, palette: PALETTE.nihil, halo: true }),
});

/** 객체 트리의 모든 월드 행렬이 유한한가 */
function assertFiniteTree(root, label) {
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    for (const v of o.matrixWorld.elements) assert.ok(Number.isFinite(v), `${label}: ${o.name || o.type}의 행렬에 NaN`);
  });
}

/** 두 포즈의 관절별 최대 차(없는 관절은 0) */
function poseDist(a, b) {
  let d = 0;
  for (const part of ['rot', 'pos']) {
    const ta = a[part] ?? {};
    const tb = b[part] ?? {};
    for (const k of new Set([...Object.keys(ta), ...Object.keys(tb)])) {
      for (let i = 0; i < 3; i++) d = Math.max(d, Math.abs((ta[k]?.[i] ?? 0) - (tb[k]?.[i] ?? 0)));
    }
  }
  return d;
}
const assertPoseEq = (a, b, msg) => assert.ok(poseDist(a, b) < 1e-9, `${msg} (차 ${poseDist(a, b)})`);
function assertPoseFinite(p, label) {
  for (const part of ['rot', 'pos']) {
    for (const [k, v] of Object.entries(p[part] ?? {})) {
      assert.equal(v.length, 3, `${label}.${part}.${k}`);
      for (const x of v) assert.ok(Number.isFinite(x), `${label}.${part}.${k}에 NaN`);
    }
  }
}
const worldPos = (obj) => new THREE.Vector3().setFromMatrixPosition(obj.matrixWorld);

const P = (rot, pos = {}) => ({ rot, pos });
const IDLE = P({ spine: [0.1, 0, 0], shoulderR: [0.2, 0, -0.1] });
const SET = {
  windup: P({ spine: [-0.3, -0.4, 0], shoulderR: [-2.6, 0, -0.2], elbowR: [-0.8, 0, 0] }, { hips: [0, -0.1, 0] }),
  active: P({ spine: [0.5, 0.4, 0], shoulderR: [-1.0, 0.3, -0.1], handR: [1.1, 0, 0] }, { hips: [0, -0.2, 0.1] }),
  follow: P({ spine: [0.7, 0.5, 0], shoulderR: [-0.6, 0.3, -0.1], handR: [1.3, 0, 0] }),
};

describe('리그 3종', () => {
  test('표준 관절 · 소켓 이름이 전부 있다', () => {
    const rigs = makeRigs();
    const want = {
      humanoid: [HUMANOID_JOINTS, HUMANOID_SOCKETS],
      quadruped: [QUADRUPED_JOINTS, QUADRUPED_SOCKETS],
      floater: [FLOATER_JOINTS, FLOATER_SOCKETS],
    };
    for (const [kind, [joints, sockets]] of Object.entries(want)) {
      const rig = rigs[kind];
      assert.ok(rig instanceof Rig);
      assert.ok(rig.root instanceof THREE.Object3D);
      assert.ok(rig.height > 0, `${kind}.height`);
      for (const j of joints) assert.ok(rig.joints[j] instanceof THREE.Object3D, `${kind} 관절 ${j}`);
      for (const s of sockets) assert.ok(rig.sockets[s] instanceof THREE.Object3D, `${kind} 소켓 ${s}`);
      assert.deepEqual(Object.keys(rig.joints).sort(), [...joints].sort(), `${kind}: 표준 밖의 관절이 없다`);
      rig.dispose();
    }
  });

  test('L 관절은 x > 0, R 관절은 x < 0 · 무기는 오른손 · rest에서 날은 앞(+Z)', () => {
    const { humanoid, quadruped, floater } = makeRigs();
    for (const rig of [humanoid, quadruped, floater]) {
      rig.applyPose(emptyPose());
      rig.root.updateMatrixWorld(true);
      for (const [name, j] of Object.entries(rig.joints)) {
        const x = worldPos(j).x;
        if (/L$/.test(name)) assert.ok(x > 0, `${name}.x = ${x}`);
        if (/R$/.test(name)) assert.ok(x < 0, `${name}.x = ${x}`);
      }
    }
    for (const rig of [humanoid, floater]) {
      assert.ok(worldPos(rig.sockets.weapon).x < 0, '무기 소켓은 오른손');
      const d = worldPos(rig.sockets.weaponTip).sub(worldPos(rig.sockets.weaponBase));
      assert.ok(d.length() > 0.3);
      assert.ok(d.z / d.length() > 0.99, `날의 축이 +Z가 아니다: ${d.toArray()}`);
    }
    // 발이 지면에, 머리가 키 근처에
    assert.ok(Math.abs(worldPos(humanoid.joints.footL).y - 0.08) < 0.02);
    assert.ok(Math.abs(worldPos(humanoid.sockets.head).y - 1.8) < 0.15);
    // 사족: 몸 중심이 원점 — 코끝은 앞 2.9m, 엉덩이(hips)는 뒤 2.7m를 넘지 않는다
    const mouth = worldPos(quadruped.sockets.mouth);
    assert.ok(mouth.z > 2.0 && mouth.z <= 2.9, `mouth.z = ${mouth.z}`);
    assert.ok(worldPos(quadruped.joints.hips).z > -2.7);
    assert.ok(Math.abs(worldPos(quadruped.joints.pawFL).y) < 0.3);
    // 부유체: 자락 끝이 hover 근처, 머리가 height 근처
    assert.ok(worldPos(floater.sockets.head).y > 2.3 && worldPos(floater.sockets.head).y < 3.0);
    assert.ok(worldPos(floater.joints.robe3).y > 0.8);
  });

  test('applyPose 뒤 updateMatrixWorld — NaN 0 · 포즈를 바꾸면 소켓의 월드 위치가 따라 바뀐다', () => {
    const rigs = makeRigs();
    const moves = {
      humanoid: ['weaponTip', P({ shoulderR: [-1.5, 0.2, -0.3], elbowR: [-0.6, 0, 0], spine: [0.3, 0.4, 0] }, { hips: [0, -0.2, 0.1] })],
      quadruped: ['mouth', P({ neck: [-0.5, 0.3, 0], head: [0.2, 0, 0], hips: [-0.2, 0, 0] }, { hips: [0, 0.4, 0] })],
      floater: ['weaponTip', P({ shoulderR: [-1.2, 0, -0.4], core: [0.2, 0.5, 0] }, { core: [0, 0.3, 0] })],
    };
    for (const [kind, [socket, pose]] of Object.entries(moves)) {
      const rig = rigs[kind];
      rig.applyPose(emptyPose());
      assertFiniteTree(rig.root, `${kind} rest`);
      const before = worldPos(rig.sockets[socket]);
      rig.applyPose(pose);
      assertFiniteTree(rig.root, `${kind} posed`);
      const after = worldPos(rig.sockets[socket]);
      assert.ok(before.distanceTo(after) > 0.1, `${kind}.${socket}이 움직이지 않았다`);
      // 포즈에 없는 관절은 0 회전 / 0 오프셋으로 돌아온다
      rig.applyPose(emptyPose());
      rig.root.updateMatrixWorld(true);
      assert.ok(worldPos(rig.sockets[socket]).distanceTo(before) < 1e-9, `${kind}: rest로 돌아오지 않는다`);
      rig.dispose();
    }
  });

  test('setFlash · setGlow · setBoost · setOpacity · dispose가 예외 없이 돌고 재질 값이 유한하다', () => {
    for (const rig of Object.values(makeRigs())) {
      for (const style of ['fire', 'frost', 'void', 'danger', 'none', 'nope']) rig.setGlow(style, 0.7);
      rig.setFlash(1);
      rig.setFlash(NaN);
      rig.setFlash(0.5);
      rig.setBoost(1);
      rig.setOpacity(0.4);
      rig.setOpacity(1);
      rig.root.traverse((o) => {
        if (!o.isMesh) return;
        const m = o.material;
        assert.ok(Number.isFinite(m.emissiveIntensity) && Number.isFinite(m.emissive.r) && m.opacity === 1);
        assert.equal(o.castShadow, true);
      });
      if (rig.cape) rig.cape.update(0.016, 1, 0.3, 1, -0.5, 1);
      assertFiniteTree(rig.root, 'materials');
      rig.dispose();
    }
  });

  test('groundFeet가 낮은 발을 지면에 붙인다 · ikLeftHand가 왼손을 목표에 댄다', () => {
    const rig = buildHumanoidRig({ height: 1.8, bulk: 1, palette: PALETTE.player, helmet: 'knight', cape: false });
    rig.applyPose(P({ hipL: [-1.0, 0, 0], kneeL: [1.2, 0, 0], hipR: [0.5, 0, 0], kneeR: [0.3, 0, 0] }));
    rig.groundFeet(1);
    rig.root.updateMatrixWorld(true);
    const low = Math.min(worldPos(rig.joints.footL).y, worldPos(rig.joints.footR).y);
    assert.ok(Math.abs(low - 0.08) < 1e-6, `낮은 발목 높이 ${low}`);
    // 양손 쥐기: 손이 닿는 자세에서 왼손바닥이 자루 위에 온다
    rig.applyPose(P({ shoulderR: [-0.6, 0, 0.3], elbowR: [-1.2, 0, 0], handR: [0.6, 0, 0] }));
    rig.ikLeftHand(rig.sockets.gripL, 1);
    rig.root.updateMatrixWorld(true);
    const gap = worldPos(rig.sockets.handL).distanceTo(worldPos(rig.sockets.gripL));
    assert.ok(gap < 0.02, `왼손과 자루 사이 ${gap}m`);
    assertFiniteTree(rig.root, 'ik');
    rig.dispose();
  });
});

describe('포즈 수학', () => {
  test('ease 8종의 끝점', () => {
    for (const name of ['linear', 'inQuad', 'outQuad', 'inOutQuad', 'inCubic', 'outCubic', 'outQuint', 'outBack']) {
      assert.ok(Math.abs(ease[name](0)) < 1e-9, `${name}(0)`);
      assert.ok(Math.abs(ease[name](1) - 1) < 1e-9, `${name}(1)`);
    }
  });

  test('lerpPose 끝점 · 없는 관절은 0 · out 재사용 · addPose', () => {
    assertPoseEq(lerpPose(SET.windup, SET.active, 0), SET.windup, 't=0');
    assertPoseEq(lerpPose(SET.windup, SET.active, 1), SET.active, 't=1');
    const mid = lerpPose(SET.windup, SET.active, 0.5);
    assert.ok(Math.abs(mid.rot.handR[0] - 0.55) < 1e-9, '없는 관절은 0에서 보간');
    assert.ok(Math.abs(mid.rot.elbowR[0] + 0.4) < 1e-9);
    assert.ok(Math.abs(mid.pos.hips[1] + 0.15) < 1e-9);
    // out에 남아 있던 관절은 0이 된다 · 제자리(out === a) 보간도 같다
    const out = P({ footL: [9, 9, 9] }, { footL: [9, 9, 9] });
    assert.equal(lerpPose(SET.windup, SET.active, 0.5, out), out);
    assertPoseEq(out, mid, 'out 재사용');
    const inPlace = lerpPose(SET.windup, SET.active, 0, emptyPose());
    lerpPose(inPlace, SET.active, 0.5, inPlace);
    assertPoseEq(inPlace, mid, '제자리 보간');
    const sum = addPose(IDLE, SET.active, 0.5);
    assert.ok(Math.abs(sum.rot.spine[0] - (0.1 + 0.25)) < 1e-9);
    assert.ok(Math.abs(sum.rot.handR[0] - 0.55) < 1e-9);
    assert.ok(Math.abs(sum.pos.hips[2] - 0.05) < 1e-9);
    assertPoseEq(addPose(IDLE, SET.active, 0), IDLE, 'weight 0');
  });

  test('attackPose 끝점 — releaseT = 0', () => {
    assertPoseEq(attackPose(SET, IDLE, 'windup', 0), IDLE, '예고 p=0 → idle');
    assertPoseEq(attackPose(SET, IDLE, 'windup', 0.6), SET.windup, '예고 p=holdAt → windup');
    assertPoseEq(attackPose(SET, IDLE, 'windup', 1), SET.windup, '예고 p=1 → windup');
    assertPoseEq(attackPose(SET, IDLE, 'active', 0), SET.windup, '판정 p=0 → windup(끊김 없음)');
    assertPoseEq(attackPose(SET, IDLE, 'active', 1), SET.active, '판정 p=1 → active');
    assertPoseEq(attackPose(SET, IDLE, 'recovery', 0), SET.active, '후딜 p=0 → active');
    assertPoseEq(attackPose(SET, IDLE, 'recovery', 0.3), SET.follow, '후딜 p=0.3 → follow');
    assertPoseEq(attackPose(SET, IDLE, 'recovery', 1), IDLE, '후딜 p=1 → idle');
    // follow가 없으면 active에서 바로 idle로
    const noFollow = { windup: SET.windup, active: SET.active };
    assertPoseEq(attackPose(noFollow, IDLE, 'recovery', 0.3), SET.active, 'follow 없음');
    // holdAt: 그 지점에서 자세가 완성된다
    const early = { ...SET, holdAt: 0.35 };
    assertPoseEq(attackPose(early, IDLE, 'windup', 0.35), SET.windup, 'holdAt 0.35');
    assert.ok(poseDist(attackPose(SET, IDLE, 'windup', 0.35), SET.windup) > 0.01, '기본 holdAt 0.6은 0.35에서 아직 덜 왔다');
    // charge: windup 근처에서 떨린다(유한)
    const ch = attackPose(SET, IDLE, 'charge', 0.8);
    assertPoseFinite(ch, 'charge');
    assert.ok(poseDist(ch, SET.windup) < 0.2);
    // out 재사용
    const out = emptyPose();
    assert.equal(attackPose(SET, IDLE, 'active', 1, out), out);
  });

  test('attackPose 끝점 — releaseT = 0.3 (보스: 판정 전에 무기가 출발한다)', () => {
    const S = lerpPose(SET.windup, SET.active, 0.35);
    assertPoseEq(attackPose(SET, IDLE, 'windup', 0.7, undefined, 0.3), SET.windup, '예고 p=0.7 → windup');
    assertPoseEq(attackPose(SET, IDLE, 'windup', 1, undefined, 0.3), S, '예고 p=1 → lerp(W, A, 0.35)');
    assertPoseEq(attackPose(SET, IDLE, 'active', 0, undefined, 0.3), S, '판정 p=0이 그 포즈와 같다');
    assertPoseEq(attackPose(SET, IDLE, 'active', 1, undefined, 0.3), SET.active, '판정 p=1 → active');
    assertPoseEq(attackPose(SET, IDLE, 'recovery', 1, undefined, 0.3), IDLE, '후딜 p=1 → idle');
    // 출발 구간은 단조롭게 W에서 멀어진다
    let prev = 0;
    for (const p of [0.7, 0.8, 0.9, 1]) {
      const d = poseDist(attackPose(SET, IDLE, 'windup', p, undefined, 0.3), SET.windup);
      assert.ok(d >= prev - 1e-12);
      prev = d;
    }
    // holdAt이 1 − releaseT보다 뒤면 당겨진다
    const late = { ...SET, holdAt: 0.9 };
    assertPoseEq(attackPose(late, IDLE, 'windup', 0.7, undefined, 0.3), SET.windup, 'h = min(holdAt, 1 − releaseT)');
  });

  test('bossReleaseT', () => {
    assert.ok(Math.abs(bossReleaseT(0.9) - 0.2) < 1e-9);
    assert.ok(Math.abs(bossReleaseT(0.2) - 0.4) < 1e-9);
    assert.ok(Math.abs(bossReleaseT(0.45) - 0.4) < 1e-9);
    assert.ok(Math.abs(bossReleaseT(1.45) - 0.18 / 1.45) < 1e-9);
    assert.ok(Number.isFinite(bossReleaseT(0)) && bossReleaseT(0) <= 0.4);
    assert.equal(bossReleaseT(NaN), 0);
  });

  test('PoseBlender: 첫 update는 바로 맞춘다 · 반감기만큼 다가간다 · dt 0이면 그대로 · snap', () => {
    const rig = buildHumanoidRig({ height: 1.8, bulk: 1, palette: PALETTE.player, helmet: 'none', cape: false });
    const bl = new PoseBlender(rig, 0.05);
    bl.update(SET.windup, 0.016);
    assertPoseEq(bl.pose, SET.windup, '첫 update = snap');
    assert.ok(Math.abs(rig.joints.shoulderR.rotation.x + 2.6) < 1e-9, '리그에 적용된다');
    bl.update(SET.active, 0.05);
    assertPoseEq(bl.pose, lerpPose(SET.windup, SET.active, 0.5), '반감기 뒤 절반');
    const keep = lerpPose(bl.pose, bl.pose, 0);
    bl.update(SET.follow, 0);
    assertPoseEq(bl.pose, keep, 'dt 0');
    bl.update(SET.follow, 10);
    assert.ok(poseDist(bl.pose, SET.follow) < 1e-6, '큰 dt면 목표에 닿는다');
    bl.snap(SET.active);
    assertPoseEq(bl.pose, SET.active, 'snap');
    assert.ok(Math.abs(rig.joints.handR.rotation.x - 1.1) < 1e-9);
    rig.dispose();
  });
});

describe('포즈 표', () => {
  test('VALDER_POSES가 §8.10의 pose 9종을 가진다 (delayed.holdAt === 0.35)', () => {
    for (const k of VALDER_POSE_KEYS) {
      const set = VALDER_POSES[k];
      assert.ok(set && set.windup && set.active, `VALDER_POSES.${k}`);
      for (const part of ['windup', 'active', 'follow']) if (set[part]) assertPoseFinite(set[part], `${k}.${part}`);
    }
    assert.equal(VALDER_POSES.delayed.holdAt, 0.35);
    for (const k of VALDER_POSE_KEYS) if (k !== 'delayed') assert.ok((VALDER_POSES[k].holdAt ?? 0.6) === 0.6, `${k}.holdAt`);
  });

  test('MOTIONS가 motion 7종 × grip 3종을 가진다 · 데이터의 모든 무브가 포즈를 찾는다', () => {
    for (const m of MOTION_KEYS) {
      assert.ok(MOTIONS[m], `MOTIONS.${m}`);
      for (const g of GRIPS) {
        const set = MOTIONS[m][g];
        assert.ok(set && set.windup && set.active, `MOTIONS.${m}.${g}`);
        for (const part of ['windup', 'active', 'follow']) if (set[part]) assertPoseFinite(set[part], `${m}.${g}.${part}`);
      }
    }
    for (const w of Object.values(WEAPONS)) {
      assert.ok(GRIPS.includes(w.grip), `${w.id}.grip`);
      for (const mv of Object.values(w.moves)) assert.ok(MOTIONS[mv.motion]?.[w.grip], `${w.id}.${mv.id}의 motion '${mv.motion}'`);
    }
  });

  test('실루엣 규칙: 발더의 각 포즈에서 windup과 active의 weaponTip이 2m 이상 떨어진다', () => {
    const view = createValderView();
    const tipAt = (pose) => {
      view.rig.applyPose(pose);
      view.root.updateMatrixWorld(true);
      return worldPos(view.rig.sockets.weaponTip);
    };
    for (const k of VALDER_POSE_KEYS) {
      const w = tipAt(VALDER_POSES[k].windup);
      const a = tipAt(VALDER_POSES[k].active);
      const d = w.distanceTo(a);
      assert.ok(d >= 2, `${k}: windup ↔ active 무기 끝 ${d.toFixed(2)}m`);
    }
    // 발더는 플레이어보다 확연히 크다
    assert.equal(view.rig.height, VALDER.height);
    assert.ok(view.rig.height > PLAYER.height * 1.3);
    view.dispose();
  });

  test('실루엣 규칙: 플레이어의 세 무기 × 전 무브에서 windup과 active의 weaponTip이 1m 이상 떨어진다', () => {
    const view = createPlayerView();
    const info = { alpha: 1, dt: 0.1, time: 0, state: makeTestState() };
    for (const w of Object.values(WEAPONS)) {
      for (const mv of Object.values(w.moves)) {
        const tips = [];
        for (const phase of ['windup', 'active']) {
          const p = makeTestPlayer(makeTestStats({ weaponId: w.id }), { lockOn: true, state: 'attack',
            attack: { moveId: mv.id, weaponId: w.id, kind: mv.kind, motion: mv.motion, comboIndex: 0, phase, phaseT: 1, charge: 0, hitId: 1 } });
          for (let i = 0; i < 30; i++) view.update(p, info);
          view.root.updateMatrixWorld(true);
          tips.push(worldPos(view.rig.sockets.weaponTip));
        }
        const d = tips[0].distanceTo(tips[1]);
        assert.ok(d >= 1, `${w.id}.${mv.id}(${mv.motion}): windup ↔ active 무기 끝 ${d.toFixed(2)}m`);
      }
    }
    view.dispose();
  });
});

describe('뷰 — 모든 상태 · 공격 포즈에서 NaN 0', () => {
  test('플레이어 뷰: 상태 15종 × 무기 3종 × 진행도 · 무기 교체 · dt 0과 큰 dt', () => {
    const view = createPlayerView();
    const state = makeTestState();
    const info = { alpha: 0.5, dt: 1 / 60, time: 0, state };
    const durs = { roll: PLAYER.roll.dur, backstep: PLAYER.backstep.dur, guardHit: PLAYER.guard.hitDur, guardBreak: PLAYER.guard.breakDur,
      parry: PLAYER.parry.dur, flask: PLAYER.flask.dur, stagger: PLAYER.hurt.staggerDur, knockdown: PLAYER.hurt.knockdownDur,
      getup: PLAYER.hurt.getupDur, execute: PLAYER.execute.dur, dead: 0 };
    for (const w of Object.values(WEAPONS)) {
      for (const st of PLAYER_STATES) {
        for (const lockOn of [false, true]) {
          const dur = durs[st] ?? 0;
          for (const frac of [0, 0.1, 0.35, 0.5, 0.75, 1, 1.5]) {
            const over = { state: st, stateDur: dur, stateTime: (dur || 1.2) * frac, lockOn,
              vel: st === 'move' || st === 'guard' ? { x: 2, z: 4 } : { x: 0, z: 0 }, sprinting: st === 'move' && !lockOn,
              knockVel: st === 'stagger' ? { x: -3, z: frac * 2 } : { x: 0, z: 0 }, parryActive: st === 'guard' && frac < 0.2,
              facing: 0.7 };
            if (st === 'attack') {
              const moves = Object.values(w.moves);
              const mv = moves[Math.floor(frac * 4) % moves.length];
              const phase = ['windup', 'charge', 'active', 'recovery'][Math.floor(frac * 6) % 4];
              over.attack = { moveId: mv.id, weaponId: w.id, kind: mv.kind, motion: mv.motion, comboIndex: 0, phase, phaseT: Math.min(1, frac), charge: 0, hitId: 1 };
            }
            if (st === 'execute') {
              over.attack = { moveId: 'execute', weaponId: w.id, kind: 'execute', motion: 'thrust', comboIndex: 0, phase: 'windup', phaseT: Math.min(1, frac), charge: 0, hitId: 1 };
            }
            const p = makeTestPlayer(makeTestStats({ weaponId: w.id }), over);
            const before = JSON.stringify(p);
            for (const dt of [1 / 60, 0, 0.1, 1 / 60]) {
              info.dt = dt;
              view.update(p, info);
            }
            assert.equal(JSON.stringify(p), before, '뷰는 상태를 고치지 않는다');
            assertFiniteTree(view.root, `player ${w.id} ${st} ${frac}`);
          }
        }
      }
    }
    // 모르는 motion · 모르는 무기 id가 와도 죽지 않는다
    const odd = makeTestPlayer(makeTestStats({ weaponId: 'nope' }), { state: 'attack',
      attack: { moveId: 'x', weaponId: 'nope', kind: 'light', motion: 'nope', comboIndex: 0, phase: 'active', phaseT: 0.5, charge: 0, hitId: 1 } });
    view.update(odd, info);
    assertFiniteTree(view.root, 'player odd');
    view.dispose();
  });

  test('발더 뷰: 상태 10종 × pose 9종 × 구간 · 모르는 pose는 첫 포즈로 대체 · 사망 연출은 outro 안에 끝난다', () => {
    const view = createValderView();
    const state = makeTestState({ bossDef: VALDER });
    const info = { alpha: 0.5, dt: 1 / 60, time: 0, state };
    const mkAttack = (pose, phase, phaseT, seq) => ({ id: 'x', seq, pose, glow: phase === 'windup' ? 'danger' : 'fire', phase, phaseT, t: 0,
      windup: 0.9, active: 0.15, recovery: 1.2, locked: false, aimX: 0, aimZ: 0, chained: false, fired: [], hitIds: [] });
    const run = (over, label) => {
      const b = makeTestBoss(VALDER, over);
      const before = JSON.stringify(b);
      for (const dt of [1 / 60, 0, 0.1, 1 / 60]) {
        info.dt = dt;
        view.update(b, info);
      }
      assert.equal(JSON.stringify(b), before, '뷰는 상태를 고치지 않는다');
      assertFiniteTree(view.root, label);
    };
    const durs = { intro: VALDER.introDur, parried: VALDER.parriedDur, groggy: VALDER.groggyDur, executed: VALDER.executedDur,
      recover: VALDER.recoverDur, phaseShift: VALDER.phaseShiftDur };
    let seq = 1;
    for (const st of BOSS_STATES) {
      if (st === 'attack') continue;
      for (const frac of [0, 0.1, 0.3, 0.6, 1, 1.4]) {
        const dur = durs[st] ?? 0;
        run({ state: st, stateDur: dur, stateTime: (dur || 2.2) * frac, phase: frac > 0.5 ? 2 : 1, ext: { enchanted: frac > 0.5 },
          y: st === 'chase' ? 0 : 0, prevPos: st === 'chase' ? { x: 0.03, z: 5.96 } : { x: 0, z: 6 } }, `valder ${st} ${frac}`);
      }
    }
    for (const pose of [...VALDER_POSE_KEYS, 'unknown_pose']) {
      for (const phase of ['windup', 'active', 'recovery']) {
        for (const pt of [0, 0.4, 0.8, 1]) {
          run({ state: 'attack', attack: mkAttack(pose, phase, pt, seq++), y: pose === 'leap' && phase === 'windup' ? 2.5 * pt : 0 }, `valder ${pose} ${phase} ${pt}`);
        }
      }
    }
    // 사망: outroVictory − 0.4초에 걸쳐 흩어지고 숨는다 → 다시 살아나면 보인다
    info.dt = 1 / 60;
    view.update(makeTestBoss(VALDER, { state: 'dead', stateTime: 0.5 }), info);
    assert.equal(view.root.visible, true);
    view.update(makeTestBoss(VALDER, { state: 'dead', stateTime: COMBAT.outroVictory - 0.4 }), info);
    assert.equal(view.root.visible, false, '연출이 outro 안에 끝난다');
    assert.ok(COMBAT.outroVictory - 0.4 < COMBAT.outroVictory);
    view.update(makeTestBoss(VALDER, { state: 'idle' }), info);
    assert.equal(view.root.visible, true);
    view.root.traverse((o) => { if (o.isMesh && o.material.opacity !== undefined) assert.equal(o.material.opacity, 1); });
    view.dispose();
  });

  test('보스 무기는 판정 전에 출발한다: 예고 끝의 무기 끝이 예고 자세에서 active 쪽으로 움직여 있다', () => {
    const view = createValderView();
    const info = { alpha: 1, dt: 0.2, time: 0, state: makeTestState({ bossDef: VALDER }) };
    const tipOf = (phase, phaseT) => {
      const b = makeTestBoss(VALDER, { state: 'attack', attack: { id: 'slash_r', seq: 1, pose: 'slashR', glow: 'none', phase, phaseT, t: 0,
        windup: 0.7, active: 0.15, recovery: 1, locked: true, aimX: 0, aimZ: 0, chained: false, fired: [], hitIds: [] } });
      for (let i = 0; i < 20; i++) view.update(b, info);
      view.root.updateMatrixWorld(true);
      return worldPos(view.rig.sockets.weaponTip);
    };
    const releaseT = bossReleaseT(0.7);
    const hold = tipOf('windup', 1 - releaseT);
    const end = tipOf('windup', 1);
    const start = tipOf('active', 0);
    assert.ok(hold.distanceTo(end) > 0.5, `예고 끝에 무기가 움직인다(${hold.distanceTo(end).toFixed(2)}m)`);
    assert.ok(end.distanceTo(start) < 0.2, `예고 끝 = 판정 시작(순간 이동 없음 — 호흡의 흔들림만): ${end.distanceTo(start).toFixed(3)}m`);
    assert.ok(tipOf('active', 1).distanceTo(end) > 1, '판정 구간에 나머지 궤적을 간다');
    view.dispose();
  });
});

describe('CharacterLayer', () => {
  const makeLayer = () => {
    const bus = new EventBus();
    const scene = new THREE.Scene();
    const layer = new CharacterLayer({ scene, bus, settings: { ...DEFAULT_SETTINGS } });
    return { bus, scene, layer };
  };

  test('생성 직후 전부 숨겨져 있고, 첫 MODE_CHANGED 전의 update도 돈다 · update 끝에 소켓이 같은 프레임 위치를 준다', () => {
    const { scene, layer } = makeLayer();
    assert.equal(scene.children.length, 1);
    const charRoot = scene.children[0];
    for (const c of charRoot.children) assert.equal(c.visible, false, `${c.name}이 보인다`);
    const out = new THREE.Vector3();
    assert.equal(layer.getSocketWorld('player', 'weaponTip', out), false, 'update 전에는 false');

    const state = makeTestState();
    state.player.pos = { x: 3, z: -2 };
    state.player.prevPos = { x: 3, z: -2 };
    layer.update(state, 1, 1 / 60);
    for (const s of ['weaponBase', 'weaponTip', 'chest', 'head', 'handL']) {
      assert.equal(layer.getSocketWorld('player', s, out), true, s);
      assert.ok(Number.isFinite(out.x + out.y + out.z));
      assert.ok(Math.hypot(out.x - 3, out.z + 2) < 2.5 && out.y > -0.5 && out.y < 3.5, `${s} = ${out.toArray()}`);
    }
    assert.equal(layer.getSocketWorld('player', 'nope', out), false);
    assert.equal(layer.getSocketWorld('boss', 'chest', out), false, '보스가 없으면 false');
    assert.equal(layer.getSocketWorld('nobody', 'chest', out), false);

    // 위치를 옮기고 update → 호출 측이 행렬을 갱신하지 않아도 새 위치가 나온다
    layer.getSocketWorld('player', 'chest', out);
    const before = out.clone();
    state.player.prevPos = { x: 3, z: -2 };
    state.player.pos = { x: 5, z: -2 };
    layer.update(state, 0.5, 1 / 60);
    layer.getSocketWorld('player', 'chest', out);
    assert.ok(Math.abs(out.x - before.x - 1) < 0.2, `보간 위치(alpha 0.5)로 옮겨졌다: ${out.x - before.x}`);
    // 마을: 허수아비 · NPC가 보인다
    const names = charRoot.children.filter((c) => c.visible).map((c) => c.name);
    assert.ok(names.includes('player') && names.includes('dummy') && names.includes('npc:blacksmith') && names.includes('npc:merchant'), names.join());
    layer.dispose();
    assert.equal(scene.children.length, 0);
  });

  test('MODE_CHANGED 없이도 state를 보고 보스 뷰를 만든다/없앤다 · 마을 것은 숨는다 · 보스 소켓', () => {
    const { layer, scene } = makeLayer();
    const charRoot = scene.children[0];
    const town = makeTestState();
    layer.update(town, 0, 1 / 60);
    const boss = makeTestState({ bossDef: VALDER });
    boss.boss.y = 0;
    for (let i = 0; i < 3; i++) layer.update(boss, 0.3, 1 / 60);
    const visible = charRoot.children.filter((c) => c.visible).map((c) => c.name);
    assert.deepEqual(visible.sort(), ['boss:valder', 'player']);
    const out = new THREE.Vector3();
    for (const s of ['weaponBase', 'weaponTip', 'chest', 'head']) {
      assert.equal(layer.getSocketWorld('boss', s, out), true, s);
      assert.ok(Math.hypot(out.x - boss.boss.pos.x, out.z - boss.boss.pos.z) < 5 && Number.isFinite(out.y), `${s} = ${out.toArray()}`);
    }
    layer.getSocketWorld('boss', 'chest', out);
    assert.ok(out.y > 1.5 && out.y < VALDER.height, `가슴 높이 ${out.y}`);
    // 보스 y(도약)가 root에 실린다
    boss.boss.y = 2;
    boss.boss.prevY = 2;
    layer.update(boss, 1, 1 / 60);
    const y0 = out.y;
    layer.getSocketWorld('boss', 'chest', out);
    assert.ok(out.y - y0 > 1.5);
    layer.update(town, 0, 1 / 60);
    assert.equal(layer.getSocketWorld('boss', 'chest', out), false);
    assert.ok(!charRoot.children.some((c) => c.name === 'boss:valder'));
    layer.dispose();
  });

  test('이벤트: MODE_CHANGED가 보스 뷰를 새로 만든다 · HIT가 점멸과 허수아비 흔들림을 건다 · dispose 뒤에는 듣지 않는다', () => {
    const { bus, layer, scene } = makeLayer();
    const charRoot = scene.children[0];
    const state = makeTestState({ bossDef: VALDER });
    bus.emit(EV.MODE_CHANGED, { mode: 'boss', worldId: state.world.id, bossId: 'valder' });
    const first = charRoot.children.find((c) => c.name === 'boss:valder');
    assert.ok(first, '이벤트로 보스 뷰가 생긴다');
    layer.update(state, 0, 1 / 60);
    bus.emit(EV.MODE_CHANGED, { mode: 'boss', worldId: state.world.id, bossId: 'valder' });
    const second = charRoot.children.find((c) => c.name === 'boss:valder');
    assert.ok(second && second !== first, '재도전하면 새 뷰');
    layer.update(state, 0, 1 / 60);

    // 뷰의 메시 전체의 평균 발광(점멸하면 크게 오른다)
    const emissiveOf = (name) => {
      let e = 0;
      let n = 0;
      charRoot.children.find((c) => c.name === name).traverse((o) => {
        if (!o.isMesh) return;
        e += o.material.emissive.r * o.material.emissiveIntensity;
        n += 1;
      });
      return e / n;
    };
    const hit = (target, outcome) => ({ source: target === 'player' ? 'boss' : 'player', target, outcome, damage: 10, rawDamage: 10, posture: 0,
      staminaDamage: 0, crit: false, heavy: true, execute: false, knockdown: false, guardBreak: false, postureBroken: false, lethal: false,
      x: 0, z: 0, y: 1, dir: 0.5, attackId: 'x', hitId: 1, kind: 'x' });
    const calm = emissiveOf('player');
    bus.emit(EV.HIT, hit('player', 'guard'));
    layer.update(state, 0, 0.001);
    assert.ok(Math.abs(emissiveOf('player') - calm) < 1e-6, '가드는 점멸하지 않는다');
    bus.emit(EV.HIT, hit('player', 'hit'));
    layer.update(state, 0, 0.001);
    // (화면 패스) 점멸은 「밝아졌다」로만 읽히게 한다 — 평균 발광이 오르되 흰 덩어리(선형 0.3 이상)가 되지 않는다
    const lit = emissiveOf('player');
    assert.ok(lit > calm + 0.03, '피격 점멸');
    assert.ok(lit < calm + 0.3, '점멸이 전신을 흰 덩어리로 만들지 않는다(블룸 임계 아래)');
    for (let i = 0; i < 12; i++) layer.update(state, 0, 1 / 60);
    assert.ok(Math.abs(emissiveOf('player') - calm) < 1e-6, '0.12초 뒤 꺼진다');
    bus.emit(EV.HIT, hit('boss', 'hit'));
    for (const name of [EV.BOSS_ATTACK_WINDUP, EV.BOSS_CUE, EV.BOSS_PHASE_CHANGED, EV.BOSS_GROGGY, EV.BOSS_DEFEATED]) bus.emit(name, { bossId: 'valder' });
    layer.update(state, 0, 0.001);

    const town = makeTestState();
    bus.emit(EV.MODE_CHANGED, { mode: 'town', worldId: 'town', bossId: null });
    layer.update(town, 0, 1 / 60);
    const dummy = charRoot.children.find((c) => c.name === 'dummy');
    const tilt = () => { let t = 0; dummy.traverse((o) => { t = Math.max(t, Math.abs(o.rotation.x) + Math.abs(o.rotation.z)); }); return t; };
    assert.ok(tilt() < 1e-9);
    bus.emit(EV.HIT, hit('dummy', 'hit'));
    for (let i = 0; i < 6; i++) layer.update(town, 0, 1 / 60);
    assert.ok(tilt() > 0.05, '허수아비가 흔들린다');
    assertFiniteTree(charRoot, 'layer');

    layer.dispose();
    bus.emit(EV.HIT, hit('player', 'hit'));
    bus.emit(EV.MODE_CHANGED, { mode: 'boss', worldId: 'arena_valder', bossId: 'valder' });
  });

  test('셰이더 프로그램 지키기: 물러난 보스 뷰 하나를 쥐고 있는다 · 첫 뷰는 첫 프레임에 투명 변형까지 그린다', () => {
    // three는 프로그램을 쓰는 마지막 재질이 dispose되면 프로그램을 버린다 — 판마다 뷰를 버리면 매 판 다시 컴파일한다
    // (격파 소멸의 투명 변형 76~147ms). WebGL 없이 볼 수 있는 것: 재질의 dispose 시점과 transparent 플래그.
    const { bus, layer, scene } = makeLayer();
    const charRoot = scene.children[0];
    const state = makeTestState({ bossDef: VALDER });
    const mode = () => bus.emit(EV.MODE_CHANGED, { mode: 'boss', worldId: state.world.id, bossId: 'valder' });
    const bossRoot = () => charRoot.children.find((c) => c.name === 'boss:valder');
    const matsOf = (root) => {
      const set = new Set();
      root.traverse((o) => { if (o.isMesh && o.material && !Array.isArray(o.material)) set.add(o.material); });
      return [...set];
    };
    /** 그 뷰의 재질이 dispose됐는가(재질 하나에 리스너를 건다) */
    const watch = (root) => {
      const w = { disposed: false };
      matsOf(root)[0].addEventListener('dispose', () => { w.disposed = true; });
      return w;
    };

    // 1번째 뷰: 쥔 것이 없다 → 첫 update 뒤 불투명 재질이 전부 transparent(투명 변형을 그리는 프레임), 둘째 update 뒤 원래대로
    mode();
    const first = bossRoot();
    const firstMats = matsOf(first);
    const opaque = firstMats.filter((m) => m.transparent === false);
    assert.ok(opaque.length > 3, `불투명 재질 ${opaque.length}개`);
    const w1 = watch(first);
    layer.update(state, 0, 1 / 60);
    assert.ok(firstMats.every((m) => m.transparent === true), '첫 프레임: 전 재질이 투명 변형으로 그려진다');
    assert.ok(firstMats.every((m) => m.opacity === 1), '불투명도는 그대로(보이는 것은 같다)');
    layer.update(state, 0, 1 / 60);
    assert.ok(opaque.every((m) => m.transparent === false), '둘째 프레임: 되돌린다');
    for (let i = 0; i < 3; i++) layer.update(state, 0, 1 / 60);
    assert.ok(opaque.every((m) => m.transparent === false && m.opacity === 1));

    // 재도전 → 새 뷰. 물러난 1번째 뷰는 씬에서 빠지지만 dispose되지 않는다(프로그램을 붙잡는다)
    mode();
    const second = bossRoot();
    assert.ok(second && second !== first, '재도전하면 새 뷰');
    assert.ok(!charRoot.children.includes(first), '물러난 뷰는 씬에 없다');
    assert.equal(w1.disposed, false, '물러난 첫 뷰를 쥐고 있다');
    const w2 = watch(second);
    const secondOpaque = matsOf(second).filter((m) => m.transparent === false);
    layer.update(state, 0, 1 / 60);
    assert.ok(secondOpaque.every((m) => m.transparent === false), '쥔 뷰가 있으면 선컴파일 프레임이 없다');
    // 마을로 → 2번째 뷰는 버린다(쥔 것은 보스마다 하나). 1번째는 그대로
    bus.emit(EV.MODE_CHANGED, { mode: 'town', worldId: 'town', bossId: null });
    assert.equal(w2.disposed, true, '쥔 것이 이미 있으면 새로 물러난 뷰는 버린다');
    assert.equal(w1.disposed, false);
    assert.ok(!bossRoot());
    // 레이어를 치우면 쥔 뷰도 치운다
    layer.dispose();
    assert.equal(w1.disposed, true, 'dispose가 쥔 뷰까지 치운다');
  });

  test('선컴파일을 마치지 못한 뷰는 쥐지 않는다 · 사망 소멸 중인 재질은 되돌리지 않는다', () => {
    const { bus, layer, scene } = makeLayer();
    const charRoot = scene.children[0];
    const state = makeTestState({ bossDef: VALDER });
    const mode = () => bus.emit(EV.MODE_CHANGED, { mode: 'boss', worldId: state.world.id, bossId: 'valder' });
    const bossRoot = () => charRoot.children.find((c) => c.name === 'boss:valder');
    const anyMat = (root) => { let m = null; root.traverse((o) => { if (!m && o.isMesh && !Array.isArray(o.material)) m = o.material; }); return m; };
    mode();
    let gone = false;
    anyMat(bossRoot()).addEventListener('dispose', () => { gone = true; });
    layer.update(state, 0, 1 / 60);      // 선컴파일 1단계만
    mode();
    assert.equal(gone, true, '한 프레임만 산 뷰는 변형을 다 갖지 못했다 — 버린다');
    // 새 뷰: 첫 프레임 뒤 곧바로 사망 소멸(opacity < 1)에 들어가면, 둘째 프레임의 되돌리기가 뷰의 투명 처리를 깨지 않는다
    layer.update(state, 0, 1 / 60);
    state.boss.state = 'dead';
    state.boss.stateTime = COMBAT.outroVictory * 0.7;
    layer.update(state, 0, 1 / 60);
    bossRoot().traverse((o) => {
      if (o.isMesh && !Array.isArray(o.material) && o.material.opacity < 1) assert.equal(o.material.transparent, true, '소멸 중인 재질은 투명이어야 한다');
    });
    let faded = 0;
    bossRoot().traverse((o) => { if (o.isMesh && !Array.isArray(o.material) && o.material.opacity < 1) faded += 1; });
    assert.ok(faded > 3, `소멸 중인 재질 ${faded}개`);
    layer.dispose();
  });

  test('스텁 보스 뷰(관절 없는 리그)와도 돈다 — 세 보스 id 전부', () => {
    const { layer } = makeLayer();
    for (const id of ['valder', 'fenrir', 'nihil', 'nobody']) {
      const state = makeTestState({ bossDef: VALDER });
      state.boss.id = id;
      for (let i = 0; i < 3; i++) layer.update(state, 0.5, 1 / 60);
      layer.getSocketWorld('boss', 'chest', new THREE.Vector3());
    }
    layer.dispose();
  });
});
