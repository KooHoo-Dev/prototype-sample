// OWNER: P5 — 계약 §9.4 · §9.3(집)
// 집 실내 가구 — 책상 + PC(발광 모니터) · 의자 · 침대 · 문 · 로드 걸이 선반 · 러그 · 포스터 · 화분.
// 상호작용 대상(PC · 침대 · 문)이 한눈에 읽히게 크고 색이 다르다. 걷는 영역(walk) 안에서 0.5m 넘는 것은 obstacles 원 안에만(§9.4).
// three 만 — Node 에서도 만들어진다(절차 텍스처는 DataTexture).

import * as THREE from 'three';
import { makeBlanketTexture, makePosterTexture, makeRugTexture, makeScreenTexture } from '../world/textures.js';

/** @typedef {{hour:number, light:number, night:boolean, sunDir:THREE.Vector3, weather:string, waveAmp:number, wavePeriod:number, time:number, camPos:THREE.Vector3}} PropsEnv */

const WOOD = '#7a5434';
const WOOD_DARK = '#4e3522';
const DESK_TOP = '#9a7350';
const METAL = '#3a3d44';

/**
 * @param {{stage:import('../../types.js').StageDef, quality:'low'|'medium'|'high', heightAt:(x:number, z:number) => number}} args
 * @returns {{group:THREE.Group, update(env:PropsEnv, dt:number):void, setQuality(q:'low'|'medium'|'high'):void, dispose():void}}
 */
export function buildHomeProps(args) {
  const { stage } = args;
  const room = stage.look.room;
  const hw = room.w / 2;
  const hd = room.d / 2;
  const group = new THREE.Group();
  group.name = 'props:home';
  const geos = [];
  const mats = [];
  const texs = [];
  const G = (g) => { geos.push(g); return g; };
  const M = (p) => { const m = new THREE.MeshStandardMaterial({ roughness: 0.8, ...p }); mats.push(m); return m; };
  const box = (parent, sx, sy, sz, m, x, y, z, ry = 0) => {
    const o = new THREE.Mesh(G(new THREE.BoxGeometry(sx, sy, sz)), m);
    o.position.set(x, y, z);
    o.rotation.y = ry;
    o.castShadow = true;
    o.receiveShadow = true;
    parent.add(o);
    return o;
  };
  const cyl = (parent, r0, r1, hgt, m, x, y, z, seg = 10) => {
    const o = new THREE.Mesh(G(new THREE.CylinderGeometry(r0, r1, hgt, seg)), m);
    o.position.set(x, y, z);
    o.castShadow = true;
    parent.add(o);
    return o;
  };

  const wood = M({ color: WOOD });
  const woodDark = M({ color: WOOD_DARK });
  const deskTop = M({ color: DESK_TOP, roughness: 0.55 });
  const metal = M({ color: METAL, roughness: 0.45, metalness: 0.4 });
  const plastic = M({ color: '#24262b', roughness: 0.5 });
  const screenTex = makeScreenTexture();
  const posterTex = makePosterTexture();
  const rugTex = makeRugTexture();
  const blanketTex = makeBlanketTexture();
  blanketTex.repeat.set(2, 2);
  texs.push(screenTex, posterTex, rugTex, blanketTex);
  const screenM = M({ color: '#0a0c10', emissive: '#ffffff', emissiveMap: screenTex, emissiveIntensity: 1.25, roughness: 0.3 });

  // ── 책상 + PC (pc 점: −2.2, −2.3 · 북쪽 벽)
  const pc = stage.points.find(p => p.kind === 'pc');
  const desk = new THREE.Group();
  desk.name = 'desk';
  desk.position.set(pc ? pc.x : -2.2, 0, -hd);
  group.add(desk);
  const DW = 1.0;
  const DD = 0.52;
  box(desk, DW, 0.04, DD, deskTop, 0, 0.74, DD / 2);
  for (const sx of [-1, 1]) box(desk, 0.04, 0.72, DD - 0.04, wood, sx * (DW / 2 - 0.03), 0.36, DD / 2);
  box(desk, DW - 0.08, 0.3, 0.02, wood, 0, 0.55, 0.03);                 // 뒤판
  box(desk, 0.34, 0.16, DD - 0.06, woodDark, DW / 2 - 0.22, 0.64, DD / 2); // 서랍
  // 모니터
  const mon = new THREE.Group();
  mon.position.set(0, 0.76, 0.17);
  desk.add(mon);
  box(mon, 0.2, 0.012, 0.14, plastic, 0, 0.006, 0);
  box(mon, 0.04, 0.2, 0.03, plastic, 0, 0.1, 0.0);
  box(mon, 0.62, 0.38, 0.03, plastic, 0, 0.36, 0.0);
  const scr = new THREE.Mesh(G(new THREE.PlaneGeometry(0.58, 0.34)), screenM);
  scr.position.set(0, 0.36, 0.0155);
  mon.add(scr);
  // 키보드 · 마우스 · 본체 · 스탠드
  box(desk, 0.42, 0.02, 0.13, plastic, -0.05, 0.77, 0.38);
  box(desk, 0.05, 0.02, 0.08, plastic, 0.26, 0.77, 0.38);
  box(desk, 0.2, 0.42, 0.44, plastic, -DW / 2 + 0.16, 0.21, 0.25);
  const ledM = M({ color: '#1a1a1a', emissive: '#4ad0ff', emissiveIntensity: 2 });
  box(desk, 0.012, 0.012, 0.005, ledM, -DW / 2 + 0.2, 0.38, 0.475);
  cyl(desk, 0.06, 0.07, 0.02, metal, 0.4, 0.77, 0.12);
  const armL = cyl(desk, 0.01, 0.01, 0.34, metal, 0.4, 0.94, 0.12, 6);
  armL.rotation.z = 0.2;
  const shade = cyl(desk, 0.03, 0.07, 0.09, M({ color: '#d84a2a', roughness: 0.5 }), 0.37, 1.1, 0.16, 10);
  shade.rotation.x = 0.5;
  // 포스터 · 선반(책상 위 벽)
  const poster = new THREE.Mesh(G(new THREE.PlaneGeometry(0.8, 0.6)), M({ map: posterTex, roughness: 0.9 }));
  poster.position.set(-0.05, 1.55, 0.008);
  desk.add(poster);
  box(desk, 0.9, 0.025, 0.2, wood, 0.95, 1.42, 0.1);
  box(desk, 0.18, 0.14, 0.14, M({ color: '#2a6a9a' }), 0.7, 1.505, 0.1);
  box(desk, 0.16, 0.1, 0.12, M({ color: '#c8a03a' }), 0.95, 1.485, 0.1);
  box(desk, 0.05, 0.22, 0.16, M({ color: '#8a2a2a' }), 1.2, 1.545, 0.1);

  // 의자(책상에 반쯤 넣었다 — 의자 원 안)
  const chair = new THREE.Group();
  chair.position.set(desk.position.x, 0, -2.33);
  group.add(chair);
  const seatM = M({ color: '#2f3640', roughness: 0.7 });
  box(chair, 0.44, 0.06, 0.42, seatM, 0, 0.46, 0);
  box(chair, 0.42, 0.44, 0.05, seatM, 0, 0.72, 0.2);
  cyl(chair, 0.025, 0.025, 0.36, metal, 0, 0.26, 0, 6);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const leg = box(chair, 0.03, 0.03, 0.22, metal, Math.sin(a) * 0.1, 0.06, Math.cos(a) * 0.1, a);
    leg.castShadow = false;
  }

  // ── 침대(+X 벽에 머리 · bed 점 2.3, 1.6)
  const bedP = stage.points.find(p => p.kind === 'bed');
  const bed = new THREE.Group();
  bed.position.set(bedP ? bedP.x : 2.3, 0, bedP ? bedP.z : 1.6);
  group.add(bed);
  const BL = 2.1;
  const BW = 1.0;
  const bx0 = hw - 0.05 - BL;   // 침대 발 끝(월드 x)
  const cx = (bx0 + hw - 0.05) / 2 - bed.position.x;
  box(bed, BL, 0.26, BW, wood, cx, 0.15, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(bed, 0.07, 0.04, 0.07, woodDark, cx + sx * (BL / 2 - 0.05), 0.02, sz * (BW / 2 - 0.05));
  box(bed, BL - 0.06, 0.16, BW - 0.06, M({ color: '#f1ede4', roughness: 0.95 }), cx, 0.36, 0);
  const blanket = box(bed, BL * 0.66, 0.05, BW + 0.02, M({ map: blanketTex, roughness: 0.95 }), cx - BL * 0.15, 0.45, 0);
  blanket.receiveShadow = true;
  const pillowM = M({ color: '#ffffff', roughness: 0.95 });
  const pillow = new THREE.Mesh(G(new THREE.SphereGeometry(0.2, 12, 8)), pillowM);
  pillow.scale.set(0.85, 0.3, 1.7);
  pillow.position.set(hw - 0.35 - bed.position.x, 0.5, 0);
  pillow.castShadow = true;
  bed.add(pillow);
  box(bed, 0.06, 0.9, BW + 0.06, woodDark, hw - 0.08 - bed.position.x, 0.45, 0);   // 머리판(벽 쪽 · 걷는 영역 밖)
  // 협탁 + 시계
  const night = new THREE.Group();
  night.position.set(hw - 0.2, 0, bed.position.z - BW / 2 - 0.3);
  group.add(night);
  box(night, 0.34, 0.46, 0.32, wood, 0, 0.23, 0);
  const clockM = M({ color: '#141414', emissive: '#ff3a2a', emissiveIntensity: 0.0 });
  box(night, 0.14, 0.08, 0.06, plastic, 0, 0.5, 0);
  const digits = new THREE.Mesh(G(new THREE.PlaneGeometry(0.11, 0.045)), clockM);
  digits.position.set(-0.071, 0.5, 0);
  digits.rotation.y = -Math.PI / 2;
  night.add(digits);

  // ── 문(남쪽 벽 · door 점 0, 2.6)
  const doorP = stage.points.find(p => p.kind === 'door');
  const door = new THREE.Group();
  door.position.set(doorP ? doorP.x : 0, 0, hd);
  // 로컬 −Z(앞) = 방 안쪽(월드 −Z)
  group.add(door);
  const doorM = M({ color: '#8a5a36', roughness: 0.6 });
  const frameM = M({ color: '#efe8dc', roughness: 0.6 });
  box(door, 0.92, 2.04, 0.05, doorM, 0, 1.02, 0.0);
  for (const [y, hgt] of [[1.45, 0.7], [0.55, 0.7]]) {
    box(door, 0.66, hgt, 0.02, M({ color: '#7a4e2e', roughness: 0.6 }), 0, y, -0.03);
  }
  box(door, 0.08, 2.12, 0.07, frameM, -0.5, 1.06, 0.0);
  box(door, 0.08, 2.12, 0.07, frameM, 0.5, 1.06, 0.0);
  box(door, 1.08, 0.08, 0.07, frameM, 0, 2.12, 0.0);
  const brass = M({ color: '#c8a050', roughness: 0.3, metalness: 0.8 });
  const knob = new THREE.Mesh(G(new THREE.SphereGeometry(0.035, 10, 8)), brass);
  knob.position.set(0.36, 1.0, -0.07);
  door.add(knob);
  box(door, 0.03, 0.12, 0.01, brass, 0.36, 1.0, -0.03);
  // 문 옆 모자 걸이 · 문 매트
  box(door, 0.3, 0.03, 0.05, wood, -0.85, 1.7, -0.03);
  const hat = new THREE.Mesh(G(new THREE.CylinderGeometry(0.16, 0.2, 0.1, 14)), M({ color: '#c9b37a' }));
  hat.position.set(-0.85, 1.6, -0.12);
  hat.rotation.x = 1.2;
  door.add(hat);
  const mat = new THREE.Mesh(G(new THREE.PlaneGeometry(0.9, 0.5).rotateX(-Math.PI / 2)), M({ color: '#5a6a3a', roughness: 1 }));
  mat.position.set(0, 0.005, -0.45);
  mat.receiveShadow = true;
  door.add(mat);

  // ── 로드 걸이 선반(서쪽 벽 · 걷는 영역 밖)
  const rack = new THREE.Group();
  rack.position.set(-hw, 0, -0.6);
  rack.rotation.y = Math.PI / 2;     // +X(방 안)를 본다
  group.add(rack);
  box(rack, 1.6, 0.05, 0.1, wood, 0, 1.75, 0.08);
  box(rack, 1.6, 0.05, 0.22, wood, 0, 0.12, 0.13);
  const rodColors = ['#20242a', '#5a2a2a', '#2a4a3a', '#2a3a5a', '#4a4a4a'];
  for (let i = 0; i < 5; i++) {
    const x = -0.6 + i * 0.3;
    const rodM = M({ color: rodColors[i], roughness: 0.35, metalness: 0.2 });
    const rod = cyl(rack, 0.008, 0.016, 2.0, rodM, x, 1.12, 0.1, 6);
    rod.rotation.z = 0.04 * (i - 2);
    cyl(rack, 0.045, 0.045, 0.06, metal, x + 0.002, 0.42, 0.13, 10).rotation.x = Math.PI / 2;   // 릴
    box(rack, 0.03, 0.04, 0.12, woodDark, x, 1.75, 0.13);   // 걸이 홈
  }
  box(rack, 0.36, 0.22, 0.24, M({ color: '#2d6a8a', roughness: 0.4 }), 0.55, 0.26, 0.14);  // 태클 박스
  box(rack, 0.36, 0.03, 0.24, M({ color: '#e0c040', roughness: 0.4 }), 0.55, 0.385, 0.14);

  // ── 러그 · 화분 · 낚시 가방
  const rug = new THREE.Mesh(G(new THREE.PlaneGeometry(1.8, 2.6).rotateX(-Math.PI / 2)), M({ map: rugTex, roughness: 1 }));
  rug.position.set(0, 0.006, 0.1);
  rug.rotation.y = Math.PI / 2;
  rug.receiveShadow = true;
  group.add(rug);
  const plant = new THREE.Group();
  plant.position.set(hw - 0.22, 0, -hd + 0.22);
  group.add(plant);
  cyl(plant, 0.16, 0.12, 0.3, M({ color: '#b8653a' }), 0, 0.15, 0, 12);
  const leafM = M({ color: '#3a7a3a', roughness: 0.8, side: THREE.DoubleSide });
  for (let i = 0; i < 9; i++) {
    const leaf = new THREE.Mesh(G(new THREE.ConeGeometry(0.06, 0.6, 4)), leafM);
    leaf.position.set(0, 0.55, 0);
    leaf.rotation.set(Math.sin(i * 2.4) * 0.5, i * 0.7, Math.cos(i * 2.4) * 0.5);
    leaf.castShadow = true;
    plant.add(leaf);
  }
  box(group, 0.7, 0.3, 0.3, M({ color: '#3a4a30' }), -hw + 0.6, 0.15, hd - 0.4, 0.2);   // 낚시 가방(낮음)
  box(group, 0.5, 0.36, 0.34, M({ color: '#e8e8e8', roughness: 0.4 }), -hw + 1.4, 0.18, hd - 0.3);   // 아이스박스(낮음)
  box(group, 0.5, 0.05, 0.34, M({ color: '#2a6ad0', roughness: 0.4 }), -hw + 1.4, 0.385, hd - 0.3);

  let blink = 0;
  return {
    group,
    update(env, dt) {
      blink += dt;
      // 어두울수록 모니터 · 시계가 더 밝게 읽힌다
      screenM.emissiveIntensity = 1.0 + (1 - env.light) * 0.5;
      clockM.emissiveIntensity = (Math.floor(blink * 1.0) % 2 === 0 ? 1.6 : 1.3);
    },
    setQuality(q) { void q; },
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      for (const t of texs) t.dispose();
    },
  };
}
