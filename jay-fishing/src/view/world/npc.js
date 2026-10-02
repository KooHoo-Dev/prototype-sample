// OWNER: P5 — 내부 파일 · NPC 판매상(단순 관절 인형 — 머리 · 몸통 · 팔 · 다리) · 숨쉬는 대기 · 가까우면 고개를 돌린다.
// 앞치마 · 모자는 스테이지의 look.vendor 로(stall 밀짚모자 · truck 고무 앞치마 + 캡 · dock 조끼 + 비니). 모델은 −Z 가 앞.

import * as THREE from 'three';
import { angleDiff, clamp, damp } from '../../core/math.js';

const SKIN = '#d9a77e';
const LOOKS = {
  stall: { shirt: '#c8c2b0', pants: '#4a4a52', apron: '#3f6e4a', hat: 'straw', hatColor: '#d8c27a' },
  truck: { shirt: '#5a6a80', pants: '#2e3238', apron: '#2a5f8a', hat: 'cap', hatColor: '#d84a2a' },
  dock: { shirt: '#7a4a3a', pants: '#3a4048', apron: '#e07a2a', hat: 'beanie', hatColor: '#2f4a6a' },
};
const BREATH_PERIOD = 3.6;
const HEAD_TURN_MAX = 1.05;
const HEAD_TURN_PAD = 1.5;    // m — 상호작용 반경 + 이만큼 안이면 고개를 돌린다

/** @param {{x:number, z:number, yaw:number, radius:number}} point @param {string} vendorKind @param {number} groundY */
export function buildNpc(point, vendorKind, groundY) {
  const L = LOOKS[vendorKind] || LOOKS.stall;
  const geos = [];
  const mats = [];
  const G = (g) => { geos.push(g); return g; };
  const M = (color, extra = {}) => { const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra }); mats.push(m); return m; };
  const skin = M(SKIN);
  const shirt = M(L.shirt);
  const pants = M(L.pants);
  const apron = M(L.apron, { roughness: vendorKind === 'truck' ? 0.45 : 0.85 });
  const hatM = M(L.hatColor);
  const boots = M('#2a2420');

  const root = new THREE.Group();
  root.name = `npc:${vendorKind}`;
  root.position.set(point.x, groundY, point.z);
  root.rotation.y = point.yaw;

  const mesh = (g, m, x, y, z) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; return o; };
  // 다리
  const legG = G(new THREE.CylinderGeometry(0.075, 0.065, 0.8, 8).translate(0, -0.4, 0));
  const bootG = G(new THREE.BoxGeometry(0.12, 0.1, 0.24));
  for (const sx of [-0.1, 0.1]) {
    const leg = mesh(legG, pants, sx, 0.88, 0);
    leg.add(mesh(bootG, boots, 0, -0.82, -0.04));
    root.add(leg);
  }
  // 몸통(숨쉬는 부분)
  const torso = new THREE.Group();
  torso.position.set(0, 0.88, 0);
  root.add(torso);
  const hips = mesh(G(new THREE.CylinderGeometry(0.17, 0.16, 0.18, 10)), pants, 0, 0.06, 0);
  const chest = mesh(G(new THREE.CylinderGeometry(0.2, 0.17, 0.52, 10)), shirt, 0, 0.4, 0);
  chest.scale.set(1, 1, 0.72);
  const apronG = G(new THREE.BoxGeometry(0.34, vendorKind === 'dock' ? 0.42 : 0.72, 0.03));
  const ap = mesh(apronG, apron, 0, vendorKind === 'dock' ? 0.44 : 0.22, -0.13);
  // 어깨(몸통 윗면이 납작한 원판으로 보이지 않게)
  const shoulders = mesh(G(new THREE.CapsuleGeometry(0.085, 0.3, 4, 10).rotateZ(Math.PI / 2)), shirt, 0, 0.62, 0);
  shoulders.scale.set(1, 1, 0.9);
  torso.add(hips, chest, ap, shoulders);
  if (vendorKind === 'dock') {
    // 조끼: 앞 · 뒤 판
    const back = mesh(apronG, apron, 0, 0.44, 0.13);
    torso.add(back);
  }
  // 팔(어깨 관절)
  const armG = G(new THREE.CylinderGeometry(0.055, 0.05, 0.6, 8).translate(0, -0.3, 0));
  const handG = G(new THREE.SphereGeometry(0.055, 8, 6));
  const arms = [];
  for (const sx of [-1, 1]) {
    const sh = new THREE.Group();
    sh.position.set(sx * 0.24, 0.62, 0);
    const arm = mesh(armG, shirt, 0, 0, 0);
    arm.add(mesh(handG, skin, 0, -0.62, 0));
    sh.add(arm);
    sh.rotation.z = sx * 0.12;
    sh.rotation.x = -0.15;
    torso.add(sh);
    arms.push(sh);
  }
  // 목 · 머리
  const neck = new THREE.Group();
  neck.position.set(0, 0.68, 0);
  torso.add(neck);
  neck.add(mesh(G(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 8)), skin, 0, 0.03, 0));
  const head = new THREE.Group();
  head.position.set(0, 0.15, 0);
  neck.add(head);
  const skull = mesh(G(new THREE.SphereGeometry(0.115, 14, 10)), skin, 0, 0, 0);
  skull.scale.set(0.95, 1.08, 1);
  head.add(skull);
  const nose = mesh(G(new THREE.ConeGeometry(0.022, 0.05, 6).rotateX(-Math.PI / 2)), skin, 0, -0.01, -0.12);
  const eyeM = M('#1a1612');
  const eyeG = G(new THREE.SphereGeometry(0.014, 6, 4));
  head.add(nose, mesh(eyeG, eyeM, -0.04, 0.025, -0.105), mesh(eyeG, eyeM, 0.04, 0.025, -0.105));
  if (L.hat === 'straw') {
    head.add(mesh(G(new THREE.CylinderGeometry(0.26, 0.27, 0.02, 18)), hatM, 0, 0.07, 0));
    head.add(mesh(G(new THREE.CylinderGeometry(0.1, 0.12, 0.1, 14)), hatM, 0, 0.12, 0));
  } else if (L.hat === 'cap') {
    head.add(mesh(G(new THREE.SphereGeometry(0.122, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2)), hatM, 0, 0.03, 0));
    head.add(mesh(G(new THREE.BoxGeometry(0.17, 0.015, 0.12)), hatM, 0, 0.04, -0.13));
  } else {
    head.add(mesh(G(new THREE.SphereGeometry(0.125, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55)), hatM, 0, 0.02, 0));
  }

  let headYaw = 0;
  return {
    group: root,
    /** @param {number} time @param {number} dt @param {THREE.Vector3} camPos */
    update(time, dt, camPos) {
      const b = Math.sin((time / BREATH_PERIOD) * Math.PI * 2);
      torso.scale.set(1 + b * 0.008, 1 + b * 0.012, 1 + b * 0.012);
      arms[0].rotation.x = -0.15 + b * 0.03;
      arms[1].rotation.x = -0.15 - b * 0.03;
      const dx = camPos.x - root.position.x;
      const dz = camPos.z - root.position.z;
      const near = dx * dx + dz * dz < (point.radius + HEAD_TURN_PAD) * (point.radius + HEAD_TURN_PAD);
      const want = near ? clamp(angleDiff(root.rotation.y, Math.atan2(-dx, -dz)), -HEAD_TURN_MAX, HEAD_TURN_MAX) : Math.sin(time * 0.23) * 0.25;
      headYaw = damp(headYaw, want, 5, Math.min(dt, 0.1));
      head.rotation.y = headYaw;
      head.rotation.x = near ? -0.06 : 0.04;
    },
    dispose() { for (const g of geos) g.dispose(); for (const m of mats) m.dispose(); },
  };
}
