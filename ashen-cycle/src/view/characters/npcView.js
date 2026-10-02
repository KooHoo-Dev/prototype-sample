// OWNER: P5 — 계약 §9.6 (패키지 내부: CharacterLayer.js만 import 한다)
// 마을의 허수아비 · 대장장이 · 상인. 위치 · 방향은 CharacterLayer가 state.world에서 읽어 root에 넣는다.
import * as THREE from 'three';
import { PALETTE } from '../../data/palette.js';
import { Rig, buildHumanoidRig } from './rig.js';
import { PartBuilder, box, cyl, ball, dome, cone, wedge } from './geo.js';
import { createHammerMesh } from './weaponMeshes.js';
import { emptyPose, poseDeg, copyPose, addRot, PoseBlender } from './pose.js';

// 연출 상수
const DUMMY_HEIGHT = 1.75;        // 허수아비 키(m)
const WOBBLE_STIFF = 90;          // 흔들림 스프링(1/s²)
const WOBBLE_DAMP = 7;            // 감쇠(1/s)
const WOBBLE_KICK = 5.5;          // 약공격 한 대의 각속도(rad/s)
const WOBBLE_KICK_HEAVY = 9;
const WOBBLE_MAX = 0.6;           // 최대 기울기(rad)
const LOOK_RANGE = 9;             // 이 거리 안의 플레이어를 눈으로 따라간다(m)
const LOOK_MAX = 1.0;             // 고개를 돌리는 최대 각(rad)
const LOOK_LAMBDA = 4;
const LANTERN_COLOR = 0xffb060;
const FILL = 0.12;                // 재질의 자체 발광(제 색 × 이 값)

/**
 * @typedef {Object} DummyView
 * @property {THREE.Group} root
 * @property {Rig} rig
 * @property {(dt:number)=>void} update
 * @property {(dir:number, heavy:boolean)=>void} hit   dir = 힘의 방향(rad, §0.2)
 * @property {()=>void} dispose
 */

/**
 * 훈련용 허수아비: 말뚝 + 가로대 + 짚 몸통 + 찌그러진 투구 + 나무 방패. 맞으면 힘의 방향으로 휘청인다.
 * @returns {DummyView}
 */
export function createDummyView() {
  const root = new THREE.Group();
  root.name = 'dummy';
  const rig = new Rig();
  rig.height = DUMMY_HEIGHT;
  root.add(rig.root);
  const pole = rig._joint('pole', null, 0, 0, 0);
  /** 제 색으로 약하게 빛난다(어두운 마을에서도 읽히게 — 리그 재질과 같은 방식) */
  const mat = (color, rough, metal = 0) => rig._mat(new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal,
    flatShading: true, emissive: color, emissiveIntensity: FILL }));
  const M = { wood: mat(0x4a3626, 0.9), straw: mat(0x9a8450, 1), cloth: mat(PALETTE.npc.cloth, 1), iron: mat(0x5c5e64, 0.5, 0.4) };
  const b = new PartBuilder();
  // 받침(X자 발) — 바닥 장식 높이 위
  b.add(rig.root, 'wood', box(0.9, 0.07, 0.12), 0, 0.045, 0, 0, 0.6, 0);
  b.add(rig.root, 'wood', box(0.9, 0.07, 0.12), 0, 0.05, 0, 0, -0.6, 0);
  // 말뚝 · 가로대
  b.add(pole, 'wood', cyl(0.05, 0.065, 1.5, 6), 0, 0.75, 0);
  b.add(pole, 'wood', cyl(0.04, 0.04, 1.2, 6), 0, 1.3, 0, 0, 0, Math.PI / 2);
  // 짚 몸통 · 허리 끈 · 짚 삐져나온 끝
  b.add(pole, 'straw', cyl(0.24, 0.19, 0.62, 8), 0, 1.08, 0);
  b.add(pole, 'cloth', cyl(0.215, 0.21, 0.07, 8), 0, 0.95, 0);
  b.add(pole, 'straw', cone(0.2, 0.3, 7), 0, 0.68, 0, Math.PI);
  b.add(pole, 'cloth', wedge(0.4, 0.016, 0.34, 0.016, 0.5), 0, 1.12, 0.2, -0.06);
  for (const sg of [1, -1]) {
    b.add(pole, 'straw', cyl(0.075, 0.065, 0.36, 6), sg * 0.4, 1.3, 0, 0, 0, Math.PI / 2);
    b.add(pole, 'straw', cone(0.08, 0.16, 6), sg * 0.64, 1.3, 0, 0, 0, -sg * Math.PI / 2);
  }
  // 자루 머리 + 찌그러진 투구
  b.add(pole, 'straw', ball(0.15, 8, 6), 0, 1.56, 0, 0, 0, 0, 1, 1.08, 1);
  b.add(pole, 'iron', dome(0.165, 8, 3, Math.PI * 0.52), 0, 1.6, 0, 0.12, 0, -0.14);
  b.add(pole, 'iron', box(0.03, 0.12, 0.03), 0, 1.53, 0.155, 0.1);
  // 나무 방패(왼팔)와 막대(오른팔)
  b.add(pole, 'wood', cyl(0.27, 0.27, 0.035, 10), 0.5, 1.2, 0.1, Math.PI / 2);
  b.add(pole, 'iron', ball(0.06, 6, 4), 0.5, 1.2, 0.13, 0, 0, 0, 1, 1, 0.6);
  b.add(pole, 'wood', cyl(0.022, 0.026, 0.8, 5), -0.56, 1.42, 0.12, 0.5, 0, 0.1);
  b.finish(M, rig._geoms);
  rig._socket('head', pole, 0, DUMMY_HEIGHT, 0);
  rig._socket('chest', pole, 0, 1.1, 0);

  let ax = 0;
  let az = 0;
  let vx = 0;
  let vz = 0;
  return {
    root,
    rig,
    update(dt) {
      // 감쇠 스프링(반암시적 오일러). dt가 커도 터지지 않게 쪼갠다
      let left = Math.min(0.1, Math.max(0, dt));
      while (left > 0) {
        const h = Math.min(left, 1 / 120);
        vx += (-WOBBLE_STIFF * ax - WOBBLE_DAMP * vx) * h;
        vz += (-WOBBLE_STIFF * az - WOBBLE_DAMP * vz) * h;
        ax = Math.max(-WOBBLE_MAX, Math.min(WOBBLE_MAX, ax + vx * h));
        az = Math.max(-WOBBLE_MAX, Math.min(WOBBLE_MAX, az + vz * h));
        left -= h;
      }
      pole.rotation.set(ax, 0, az);
    },
    hit(dir, heavy) {
      const k = heavy ? WOBBLE_KICK_HEAVY : WOBBLE_KICK;
      const d = Number.isFinite(dir) ? dir : 0;
      // 힘의 방향 (sin d, cos d)로 넘어가려면: +Z 쪽은 rx > 0, +X 쪽은 rz < 0
      vx += Math.cos(d) * k;
      vz -= Math.sin(d) * k;
    },
    dispose() {
      rig.dispose();
      if (root.parent) root.parent.remove(root);
    },
  };
}

/** 대장장이: 망치를 든 채 한 손을 허리에 얹고 선다 */
const SMITH_IDLE = poseDeg({ spine: [4, 0, 0], chest: [-2, 0, 0], head: [2, 0, 0],
  shoulderR: [-6, 0, -14], elbowR: [-32, 0, 0], handR: [-30, 0, 0],
  shoulderL: [22, 0, 38], elbowL: [-104, 0, 0],
  hipL: [0, 8, 7], hipR: [0, -8, -7] });
/** 상인: 구부정하게 서서 등불을 내밀고, 다른 손은 가슴 앞에 */
const MERCHANT_IDLE = poseDeg({ spine: [14, 0, 0], chest: [10, 0, 0], head: [-8, 0, 0],
  shoulderR: [-34, 20, -6], elbowR: [-96, 0, 0], handR: [0, 0, 0],
  shoulderL: [-50, 0, 16], elbowL: [-60, 0, 0],
  hipL: [-6, 4, 4], kneeL: [14, 0, 0], hipR: [-2, -4, -4], kneeR: [10, 0, 0] });

/**
 * @typedef {Object} NpcView
 * @property {THREE.Group} root
 * @property {Rig} rig
 * @property {(dt:number, time:number, lookYaw:number|null)=>void} update  lookYaw = 플레이어를 향한 고개 각(자기 facing 기준 rad). 멀면 null
 * @property {()=>void} dispose
 */

/**
 * @param {'blacksmith'|'merchant'|string} id
 * @returns {NpcView}
 */
export function createNpcView(id) {
  const smith = id === 'blacksmith';
  const root = new THREE.Group();
  root.name = `npc:${id}`;
  const rig = smith
    ? buildHumanoidRig({ height: 1.86, bulk: 1.28, palette: PALETTE.npc, helmet: 'none', cape: false, apron: true })
    : buildHumanoidRig({ height: 1.7, bulk: 0.94, palette: { ...PALETTE.npc, cloth: 0x352c3a }, helmet: 'hood', cape: true });
  root.add(rig.root);
  const base = smith ? SMITH_IDLE : MERCHANT_IDLE;
  const blender = new PoseBlender(rig, 0.1);
  const pose = emptyPose();
  /** @type {{dispose:()=>void}[]} */
  const extras = [];
  if (smith) {
    const hammer = createHammerMesh();
    rig.sockets.weapon.add(hammer.object);
    extras.push(hammer);
  } else {
    // 등불(왼손) — 블룸에 걸리는 발광 포인트 + 등짐
    const M = {
      iron: rig._mat(new THREE.MeshStandardMaterial({ color: 0x2c2a28, roughness: 0.6, metalness: 0.4, flatShading: true,
        emissive: 0x2c2a28, emissiveIntensity: FILL })),
      glass: rig._mat(new THREE.MeshStandardMaterial({ color: 0x3a2a18, roughness: 0.4, emissive: LANTERN_COLOR, emissiveIntensity: 2.6 }), true),
      pack: rig._mat(new THREE.MeshStandardMaterial({ color: 0x5a4630, roughness: 1, flatShading: true,
        emissive: 0x5a4630, emissiveIntensity: FILL })),
    };
    const b = new PartBuilder();
    const hand = rig.sockets.handL;
    b.add(hand, 'iron', cyl(0.006, 0.006, 0.14, 4), 0, -0.07, 0.03);
    b.add(hand, 'iron', cone(0.06, 0.05, 6), 0, -0.15, 0.03);
    b.add(hand, 'glass', cyl(0.045, 0.045, 0.1, 6), 0, -0.225, 0.03);
    b.add(hand, 'iron', cyl(0.055, 0.055, 0.02, 6), 0, -0.285, 0.03);
    const chest = rig.joints.chest;
    b.add(chest, 'pack', box(0.3, 0.34, 0.2), 0, 0.1, -0.24, 0.1);
    b.add(chest, 'pack', cyl(0.07, 0.07, 0.36, 7), 0, 0.31, -0.24, 0, 0, Math.PI / 2);
    b.finish(M, rig._geoms);
  }
  let look = 0;
  const phase = smith ? 0 : 1.7;

  return {
    root,
    rig,
    update(dt, time, lookYaw) {
      copyPose(base, pose);
      const br = Math.sin(time * 1.4 + phase);
      addRot(pose, 'chest', 0.02 * br, 0, 0);
      addRot(pose, 'spine', 0.008 * br, 0, 0.012 * Math.sin(time * 0.6 + phase));
      if (!smith) addRot(pose, 'shoulderL', 0.03 * Math.sin(time * 0.9), 0, 0);
      const want = lookYaw === null || !Number.isFinite(lookYaw) ? 0 : Math.max(-LOOK_MAX, Math.min(LOOK_MAX, lookYaw));
      look += (want - look) * (1 - Math.exp(-LOOK_LAMBDA * Math.max(0, dt)));
      addRot(pose, 'head', 0, look * 0.7, 0);
      addRot(pose, 'chest', 0, look * 0.2, 0);
      blender.update(pose, dt);
      rig.groundFeet(1);
      if (rig.cape) rig.cape.update(dt, time + phase, 0.2, 0, 0, 0.1);
    },
    dispose() {
      for (const e of extras) e.dispose();
      rig.dispose();
      if (root.parent) root.parent.remove(root);
    },
  };
}

export { LOOK_RANGE };
