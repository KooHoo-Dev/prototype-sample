// OWNER: P8 — 계약 §9.5 (내부 — 몬스터 템플릿의 부위 지오메트리)
// 부위 메시 하나 = InstancedMesh 하나(템플릿 × 부위). 몸 마디(limb · bone · torso …)는 단위 크기로 만들어 변형마다 배율로 늘리고,
// 변형 소품(활 · 방패 · 몽둥이 …)은 실제 크기로 만든다. 색은 정점 색(무늬 · 그늘) × 인스턴스 색(변형 · 등급).
// mat: 'std'(빛을 받는 거친 재질) · 'metal'(금속광) · 'glow'(빛을 받지 않는 발광 — 눈 · 잉걸불 · 둥지 핵)

import { build, prand, shadeByHeight } from './geom.js';

const PI = Math.PI;
const DARK = '#1a1310';
const BONE = '#e6dcc4';
const RUST = '#7a5a44';
const IRON = '#8a8a88';
const WOOD = '#6a4a2e';

/** 단위 마디: y 0(관절) → −1 · 굵기 1 */
function limb() {
  return shadeByHeight(build([{ k: 'cyl', s: [0.5, 0.4, 1], p: [0, -0.5, 0], seg: 6 }]), -1, 0, 0.8);
}
/** 단위 뼈: 가는 기둥 + 양끝 마디 */
function bone() {
  return build([
    { k: 'cyl', s: [0.3, 0.26, 0.92], p: [0, -0.5, 0], seg: 5 },
    { k: 'ico', s: [0.55], p: [0, -0.05, 0], sc: [1, 0.12, 1] },
    { k: 'ico', s: [0.5], p: [0, -0.95, 0], sc: [1, 0.12, 1] },
  ]);
}
/** 단위 몸통: 0 → 1 · 위가 넓다(어깨) · 아래 띠 */
function torso() {
  return shadeByHeight(build([
    { k: 'box', s: [0.76, 0.86, 0.8], p: [0, 0.45, 0], taper: 1.32 },
    { k: 'box', s: [0.84, 0.16, 0.86], p: [0, 0.08, 0], c: '#8a8a8a' },
  ]), 0, 1, 0.78);
}
/** 굽은 등 몸통(구울): 등 혹 · 등뼈 돌기 */
function torsoHunch() {
  const prims = [
    { k: 'box', s: [0.74, 0.9, 0.78], p: [0, 0.45, 0.02], taper: 1.3 },
    { k: 'box', s: [0.78, 0.38, 0.5], p: [0, 0.82, -0.22], r: [0.3, 0, 0], c: '#b8b8b0' },
    { k: 'box', s: [0.6, 0.14, 0.7], p: [0, 0.06, 0], c: '#808078' },
  ];
  for (let i = 0; i < 4; i++) prims.push({ k: 'tet', s: [0.13], p: [0, 0.32 + i * 0.17, -0.42 - i * 0.03], c: '#c8c0a8' });
  return shadeByHeight(build(prims), 0, 1, 0.75);
}
/** 단위 갈비뼈: 등뼈 · 갈비 넷 · 쇄골 · 흉골(앞이 트였다) */
function ribs() {
  const prims = [
    { k: 'box', s: [0.14, 1.0, 0.14], p: [0, 0.5, -0.38] },
    { k: 'box', s: [1.0, 0.09, 0.2], p: [0, 0.95, -0.15] },
    { k: 'box', s: [0.1, 0.42, 0.08], p: [0, 0.62, 0.42] },
  ];
  for (let i = 0; i < 4; i++) {
    const y = 0.28 + i * 0.17, w = 0.78 - Math.abs(i - 1.5) * 0.1;
    prims.push({ k: 'box', s: [0.07, 0.07, 0.8], p: [w / 2, y, 0.0], r: [0, 0.12, 0] });
    prims.push({ k: 'box', s: [0.07, 0.07, 0.8], p: [-w / 2, y, 0.0], r: [0, -0.12, 0] });
    prims.push({ k: 'box', s: [w * 0.42, 0.07, 0.07], p: [w * 0.3, y, 0.38] });
    prims.push({ k: 'box', s: [w * 0.42, 0.07, 0.07], p: [-w * 0.3, y, 0.38] });
  }
  return build(prims);
}
/** 단위 골반 상자(가운데 원점) */
function pelvis() { return build([{ k: 'box', s: [1, 1, 1] }]); }
/** 뼈 골반: 날개 둘 */
function pelvisBone() {
  return build([
    { k: 'box', s: [0.5, 0.5, 0.5] },
    { k: 'box', s: [0.45, 0.8, 0.25], p: [0.3, 0.1, 0], r: [0, 0, -0.4] },
    { k: 'box', s: [0.45, 0.8, 0.25], p: [-0.3, 0.1, 0], r: [0, 0, 0.4] },
  ]);
}
/** 단위 해골(0 → 1): 머리뼈 · 턱 · 어두운 눈구멍 */
function skull() {
  return build([
    { k: 'dod', s: [0.5], p: [0, 0.6, -0.02], sc: [0.86, 0.78, 0.96] },
    { k: 'box', s: [0.7, 0.4, 0.2], p: [0, 0.5, 0.36] },
    { k: 'box', s: [0.66, 0.26, 0.66], p: [0, 0.17, 0.14] },
    { k: 'box', s: [0.24, 0.2, 0.06], p: [0.2, 0.55, 0.45], c: DARK },
    { k: 'box', s: [0.24, 0.2, 0.06], p: [-0.2, 0.55, 0.45], c: DARK },
    { k: 'box', s: [0.12, 0.14, 0.06], p: [0, 0.36, 0.46], c: DARK },
    { k: 'box', s: [0.5, 0.06, 0.04], p: [0, 0.2, 0.48], c: '#4a4036' },
  ]);
}
/** 구울 머리: 길쭉 · 벌린 턱 · 이 · 눈두덩 */
function headFlesh() {
  return build([
    { k: 'box', s: [0.8, 0.62, 0.9], p: [0, 0.62, -0.05] },
    { k: 'box', s: [0.86, 0.16, 0.3], p: [0, 0.78, 0.36], c: '#b0b0a8' },
    { k: 'box', s: [0.62, 0.22, 0.72], p: [0, 0.18, 0.2], r: [0.35, 0, 0] },
    { k: 'box', s: [0.5, 0.08, 0.06], p: [0, 0.32, 0.56], c: '#e8e0c8' },
    { k: 'box', s: [0.46, 0.06, 0.06], p: [0, 0.1, 0.5], c: '#e8e0c8' },
    { k: 'box', s: [0.2, 0.12, 0.05], p: [0.2, 0.66, 0.42], c: DARK },
    { k: 'box', s: [0.2, 0.12, 0.05], p: [-0.2, 0.66, 0.42], c: DARK },
  ]);
}
/** 소인 머리: 큰 둥근 머리 · 긴 귀 · 매부리코 · 눈 자리 */
function headImp() {
  return build([
    { k: 'ico', s: [0.5], d: 1, p: [0, 0.5, 0] },
    { k: 'cone', s: [0.14, 0.62], p: [0.62, 0.62, -0.05], r: [0, 0, -1.25], seg: 4 },
    { k: 'cone', s: [0.14, 0.62], p: [-0.62, 0.62, -0.05], r: [0, 0, 1.25], seg: 4 },
    { k: 'cone', s: [0.1, 0.3], p: [0, 0.4, 0.56], r: [1.75, 0, 0], seg: 4 },
    { k: 'box', s: [0.6, 0.08, 0.1], p: [0, 0.22, 0.42], c: DARK },
  ]);
}
/** 잿빛 하수인 머리: 뾰족 · 금 간 재 */
function headAsh() {
  return build([
    { k: 'cone', s: [0.5, 1.0], p: [0, 0.5, -0.08], r: [-0.25, 0, 0], seg: 5 },
    { k: 'box', s: [0.7, 0.36, 0.7], p: [0, 0.22, 0.04] },
    { k: 'box', s: [0.5, 0.08, 0.08], p: [0, 0.12, 0.38], c: DARK },
  ]);
}
/** 눈 둘(머리 단위 좌표 · 발광 재질) — 머리와 같은 로컬 행렬을 쓴다 */
function eyes() {
  return build([
    { k: 'box', s: [0.17, 0.11, 0.05], p: [0.2, 0.56, 0.49] },
    { k: 'box', s: [0.17, 0.11, 0.05], p: [-0.2, 0.56, 0.49] },
  ]);
}
/** 발톱 셋(손목 0 → −1) */
function claws() {
  return build([
    { k: 'box', s: [0.9, 0.22, 0.5], p: [0, -0.1, 0] },
    { k: 'cone', s: [0.13, 0.85], p: [0.28, -0.6, 0.08], r: [PI - 0.15, 0, 0], seg: 4, c: '#3a3028' },
    { k: 'cone', s: [0.13, 0.95], p: [0, -0.65, 0.1], r: [PI - 0.15, 0, 0], seg: 4, c: '#3a3028' },
    { k: 'cone', s: [0.13, 0.85], p: [-0.28, -0.6, 0.08], r: [PI - 0.15, 0, 0], seg: 4, c: '#3a3028' },
  ]);
}
/** 단위 발(발목 0 → 바닥 −1 · 앞으로 길다) */
function foot() { return build([{ k: 'box', s: [1, 1, 1.3], p: [0, -0.5, 0.3] }]); }

// ── 네 발 ──
/** 단위 짐승 몸통(z −0.5 → 0.5 · 앞이 높은 어깨 혹) */
function qbody() {
  return shadeByHeight(build([
    { k: 'box', s: [0.98, 0.95, 0.5], p: [0, 0.05, 0.24] },
    { k: 'box', s: [0.8, 0.7, 0.52], p: [0, -0.04, -0.22], r: [0.12, 0, 0] },
    { k: 'box', s: [1.04, 0.42, 0.44], p: [0, 0.5, 0.2], r: [-0.25, 0, 0], c: '#4a3828' },
    { k: 'box', s: [0.6, 0.3, 0.3], p: [0, 0.32, -0.32], r: [0.3, 0, 0], c: '#5a4434' },
    { k: 'box', s: [0.66, 0.2, 0.8], p: [0, -0.42, 0.04], c: '#9a8470' },
    { k: 'box', s: [0.72, 0.64, 0.22], p: [0, -0.04, -0.5], r: [0.25, 0, 0] },
  ]), -0.5, 0.7, 0.68);
}
/** 단위 짐승 머리(목 0 → 주둥이 +1) */
function qhead() {
  return build([
    { k: 'box', s: [0.84, 0.74, 0.7], p: [0, 0.02, 0.28] },
    { k: 'box', s: [0.6, 0.48, 0.55], p: [0, -0.1, 0.82], c: '#5a4434' },
    { k: 'box', s: [0.42, 0.12, 0.06], p: [0, -0.06, 1.1], c: DARK },
    { k: 'box', s: [0.14, 0.1, 0.05], p: [0.3, 0.16, 0.62], c: DARK },
    { k: 'box', s: [0.14, 0.1, 0.05], p: [-0.3, 0.16, 0.62], c: DARK },
  ]);
}
/** 큰 뿔(실제 크기 · 머리 틀) — 바깥으로 뻗다가 앞으로 굽는다 · 폭 약 1.15m */
function horns() {
  const prims = [];
  for (const sx of [1, -1]) {
    prims.push({ k: 'cyl', s: [0.05, 0.085, 0.34], p: [sx * 0.3, 0.18, 0.12], r: [0, 0, -sx * 1.25], seg: 5 });
    prims.push({ k: 'cyl', s: [0.035, 0.055, 0.28], p: [sx * 0.5, 0.26, 0.24], r: [0.9, 0, -sx * 0.5], seg: 5 });
    prims.push({ k: 'cone', s: [0.04, 0.22], p: [sx * 0.55, 0.3, 0.44], r: [1.45, 0, -sx * 0.2], seg: 5 });
  }
  return build(prims);
}
/** 꼬리(뿌리 0 → −1 · 뒤로) */
function tail() { return build([{ k: 'cone', s: [0.5, 1], p: [0, -0.5, 0], r: [PI, 0, 0], seg: 4 }]); }

// ── 덩어리 · 둥지 ──
/** 역병 덩어리 몸(지름 1 · 가운데 원점): 얼룩 · 부스럼 · 혹 셋 · 입 */
function blobBody() {
  const rnd = prand(7);
  const prims = [{ k: 'ico', s: [0.5], d: 1 }];
  for (let i = 0; i < 9; i++) {
    const a = rnd() * PI * 2, b = (rnd() - 0.3) * 1.4;
    prims.push({ k: 'ico', s: [0.07 + rnd() * 0.05], p: [Math.cos(a) * Math.cos(b) * 0.49, Math.sin(b) * 0.49, Math.sin(a) * Math.cos(b) * 0.49], c: '#e8f070' });
  }
  prims.push({ k: 'ico', s: [0.2], p: [0.2, 0.42, -0.12], c: '#c8d870' });
  prims.push({ k: 'ico', s: [0.17], p: [-0.3, 0.32, -0.18], c: '#c8d870' });
  prims.push({ k: 'ico', s: [0.15], p: [0.05, 0.38, 0.26], c: '#c8d870' });
  prims.push({ k: 'box', s: [0.4, 0.1, 0.06], p: [0, -0.06, 0.48], c: '#3a1810' });
  return build(prims);
}
/** 덩어리 발 */
function stub() { return build([{ k: 'ico', s: [0.5], p: [0, 0, 0.1], sc: [1, 0.7, 1.3] }]); }
/** 뼈 무더기(지름 1 · 높이 0.3 돔) */
function pile() {
  const rnd = prand(11);
  const prims = [{ k: 'cyl', s: [0.36, 0.5, 0.12], p: [0, 0.06, 0], seg: 8, c: '#a8a088' }];
  for (let i = 0; i < 26; i++) {
    const a = rnd() * PI * 2, r = Math.sqrt(rnd()) * 0.44;
    const y = 0.1 + (1 - r / 0.5) * 0.18 * rnd();
    prims.push({ k: 'box', s: [0.05, 0.05, 0.22 + rnd() * 0.14], p: [Math.cos(a) * r, y, Math.sin(a) * r], r: [rnd() * 0.6, rnd() * PI, 0], c: rnd() < 0.3 ? '#c8bea6' : BONE });
  }
  for (let i = 0; i < 3; i++) {
    const a = i * 2.1 + 0.4;
    prims.push({ k: 'box', s: [0.12, 0.1, 0.12], p: [Math.cos(a) * 0.3, 0.22, Math.sin(a) * 0.3], c: BONE });
  }
  return build(prims);
}
/** 갈비 기둥 여섯(지름 1 · 높이 1 · 안으로 굽는다) */
function ribPillars() {
  const prims = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * PI * 2 + 0.3;
    const cx = Math.cos(a), cz = Math.sin(a);
    const segs = [[0.4, 0.15, 0.34], [0.36, 0.45, 0.32], [0.26, 0.76, 0.28], [0.12, 0.95, 0.2]];
    for (let k = 0; k < segs.length; k++) {
      const [rr, y, len] = segs[k];
      const tilt = 0.15 + k * 0.32;
      prims.push({ k: 'box', s: [0.05, len, 0.06], p: [cx * rr, y, cz * rr], r: [0, -a + PI / 2, tilt], c: k === 3 ? '#c8bea6' : BONE });
    }
  }
  return build(prims);
}
/** 둥지 핵(지름 1) */
function core() { return build([{ k: 'ico', s: [0.5], d: 1 }]); }

// ── 소품(실제 크기 · 손잡이 원점 · 날 +Y) ──
function dagger() {
  return build([
    { k: 'box', s: [0.045, 0.3, 0.012], p: [0, 0.2, 0], c: '#a8a49c' },
    { k: 'box', s: [0.12, 0.025, 0.03], p: [0, 0.045, 0], c: RUST },
    { k: 'cyl', s: [0.016, 0.018, 0.1], p: [0, -0.02, 0], c: '#3a2a1e' },
  ]);
}
function shortSword() {
  return build([
    { k: 'box', s: [0.07, 0.6, 0.016], p: [0, 0.36, 0], c: '#8e8a82' },
    { k: 'cone', s: [0.05, 0.1, 4], p: [0, 0.71, 0], r: [0, PI / 4, 0], c: '#8e8a82' },
    { k: 'box', s: [0.2, 0.035, 0.04], p: [0, 0.06, 0], c: RUST },
    { k: 'cyl', s: [0.02, 0.022, 0.13], p: [0, -0.03, 0], c: '#3a2a1e' },
  ]);
}
/** 큰 방패 — 아래팔 틀: 판이 아래팔(Y)과 앞(Z)에 걸치고 얼굴이 +X(바깥 · 막을 때 앞) */
function shieldBig() {
  return build([
    { k: 'cyl', s: [0.46, 0.46, 0.06], p: [0.07, 0, 0], r: [0, 0, PI / 2], seg: 8, c: '#6a5440' },
    { k: 'cyl', s: [0.47, 0.47, 0.035], p: [0.04, 0, 0], r: [0, 0, PI / 2], seg: 8, c: RUST },
    { k: 'ico', s: [0.1], p: [0.12, 0, 0], c: IRON },
    { k: 'box', s: [0.02, 0.86, 0.06], p: [0.105, 0, 0], c: '#4a3a2c' },
    { k: 'box', s: [0.02, 0.06, 0.86], p: [0.105, 0, 0], c: '#4a3a2c' },
  ]);
}
/** 활 — 손 틀(팔을 앞으로 뻗으면 −Y 가 앞 · +Z 가 위): 활대가 ±Z · 앞(−Y)으로 휜다 · 시위는 따로(bowString) */
function bow() {
  const prims = [{ k: 'box', s: [0.05, 0.06, 0.14], c: '#3a2a1e' }];
  const segs = 4;
  for (const sz of [1, -1]) {
    for (let i = 0; i < segs; i++) {
      const t0 = i / segs, t1 = (i + 1) / segs;
      const z0 = 0.07 + t0 * 0.6, z1 = 0.07 + t1 * 0.6;
      const y0 = 0.05 + t0 * t0 * 0.2, y1 = 0.05 + t1 * t1 * 0.2;
      const len = Math.hypot(z1 - z0, y1 - y0);
      prims.push({ k: 'box', s: [0.035, 0.035, len + 0.01], p: [0, (y0 + y1) / 2 - 0.04, sz * (z0 + z1) / 2], r: [sz * -Math.atan2(y1 - y0, z1 - z0), 0, 0], c: WOOD });
    }
  }
  return build(prims);
}
/** 시위 한쪽(단위 길이 0 → +Y — 동적 행렬로 끝점을 잇는다) */
function bowString() { return build([{ k: 'box', s: [0.012, 1, 0.012], p: [0, 0.5, 0], c: '#d8d0c0' }]); }
/** 화살(시위 자리 0 → 앞 −Y · 길이 0.8) */
function arrow() {
  return build([
    { k: 'cyl', s: [0.012, 0.012, 0.78], p: [0, -0.39, 0], seg: 4, c: WOOD },
    { k: 'cone', s: [0.03, 0.08], p: [0, -0.8, 0], r: [PI, 0, 0], seg: 4, c: '#9a9890' },
    { k: 'box', s: [0.004, 0.1, 0.05], p: [0, -0.06, 0], c: '#c84a3a' },
  ]);
}
/** 화살통(가슴 틀 등 뒤) */
function quiver() {
  const prims = [{ k: 'cyl', s: [0.07, 0.06, 0.5], p: [0, 0, 0], seg: 6, c: '#5a3a24' }];
  for (let i = 0; i < 4; i++) prims.push({ k: 'box', s: [0.01, 0.1, 0.04], p: [(i - 1.5) * 0.03, 0.3, 0], c: '#d8d0c0' });
  return build(prims);
}
/** 뼈 거인의 뼈 몽둥이(손잡이 → +Y 끝 · 길이 약 1.7m) */
function club() {
  return build([
    { k: 'cyl', s: [0.07, 0.06, 0.36], p: [0, 0, 0], seg: 6, c: '#8a7458' },
    { k: 'cyl', s: [0.13, 0.08, 1.25], p: [0, 0.8, 0], seg: 6, c: BONE },
    { k: 'ico', s: [0.2], p: [0.08, 1.48, 0], c: BONE },
    { k: 'ico', s: [0.18], p: [-0.1, 1.56, 0.04], c: '#d8ceb4' },
    { k: 'cone', s: [0.05, 0.22], p: [0.22, 1.5, 0], r: [0, 0, -1.2], seg: 4, c: '#c8bea6' },
    { k: 'cone', s: [0.05, 0.22], p: [-0.2, 1.62, 0.05], r: [0, 0, 1.0], seg: 4, c: '#c8bea6' },
  ]);
}
/** 등뼈 가시(가슴 틀 · 등 뒤 −Z · 실제 크기 — 뼈 거인) */
function spineSpikes() {
  const prims = [];
  for (let i = 0; i < 5; i++) {
    const y = 0.25 + i * 0.32;
    prims.push({ k: 'cone', s: [0.09 + 0.02 * (i % 2), 0.55 - i * 0.04], p: [0, y, -0.52], r: [-2.1, 0, 0], seg: 4, c: BONE });
  }
  prims.push({ k: 'cone', s: [0.08, 0.45], p: [0.32, 1.45, -0.42], r: [-2.0, 0, -0.5], seg: 4, c: BONE });
  prims.push({ k: 'cone', s: [0.08, 0.45], p: [-0.32, 1.45, -0.42], r: [-2.0, 0, 0.5], seg: 4, c: BONE });
  return build(prims);
}
/** 주술사 지팡이(손잡이 원점 · 위 +Y · 꼭대기 해골 · 깃털) */
function staffSkull() {
  return build([
    { k: 'cyl', s: [0.022, 0.026, 1.15], p: [0, 0.2, 0], seg: 5, c: '#5a4030' },
    { k: 'box', s: [0.12, 0.11, 0.12], p: [0, 0.82, 0], c: BONE },
    { k: 'box', s: [0.03, 0.03, 0.02], p: [0.03, 0.83, 0.06], c: DARK },
    { k: 'box', s: [0.03, 0.03, 0.02], p: [-0.03, 0.83, 0.06], c: DARK },
    { k: 'box', s: [0.02, 0.16, 0.05], p: [0.07, 0.72, 0], r: [0, 0, -0.4], c: '#3cc850' },
    { k: 'box', s: [0.02, 0.16, 0.05], p: [-0.07, 0.72, 0], r: [0, 0, 0.4], c: '#3cc850' },
  ]);
}
/** 해골 가면(머리 단위 좌표 앞면 — 주술사) */
function mask() {
  return build([
    { k: 'box', s: [0.84, 0.8, 0.1], p: [0, 0.5, 0.52], c: '#f0e8d4' },
    { k: 'box', s: [0.22, 0.2, 0.04], p: [0.2, 0.58, 0.58], c: DARK },
    { k: 'box', s: [0.22, 0.2, 0.04], p: [-0.2, 0.58, 0.58], c: DARK },
    { k: 'box', s: [0.46, 0.08, 0.04], p: [0, 0.24, 0.58], c: '#5a5040' },
    { k: 'box', s: [0.1, 0.26, 0.06], p: [0, 0.94, 0.5], c: '#b04030' },
  ]);
}
/** 깃털 장식(머리 단위 좌표 정수리) */
function feathers() {
  const prims = [];
  for (let i = 0; i < 5; i++) {
    const a = (i - 2) * 0.35;
    prims.push({ k: 'box', s: [0.08, 0.72, 0.05], p: [Math.sin(a) * 0.36, 1.18 + Math.cos(a) * 0.1, -0.15], r: [-0.2, 0, -a], c: i % 2 ? '#2a9a3a' : '#52d860' });
  }
  return build(prims);
}
/** 작은 뿔(머리 단위 좌표 — 타락 소인) */
function hornsSmall() {
  return build([
    { k: 'cone', s: [0.1, 0.4], p: [0.24, 1.02, 0.02], r: [-0.3, 0, -0.35], seg: 4, c: '#2a1a14' },
    { k: 'cone', s: [0.1, 0.4], p: [-0.24, 1.02, 0.02], r: [-0.3, 0, 0.35], seg: 4, c: '#2a1a14' },
  ]);
}
/** 녹슨 투구(머리 단위 좌표 — 방패 해골) */
function helmRusty() {
  return build([
    { k: 'cyl', s: [0.48, 0.52, 0.48], p: [0, 0.8, -0.02], seg: 7 },
    { k: 'cone', s: [0.48, 0.25], p: [0, 1.15, -0.02], seg: 7 },
    { k: 'box', s: [0.08, 0.36, 0.06], p: [0, 0.52, 0.5] },
  ]);
}
/** 잿빛 마녀 옷자락(골반 틀 0 → 바닥 쪽 −1.25 · 너덜 자락) */
function robe() {
  const prims = [{ k: 'cyl', s: [0.22, 0.52, 1.18], p: [0, -0.56, 0], seg: 8 }];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * PI * 2 + 0.2;
    prims.push({ k: 'box', s: [0.16, 0.18, 0.04], p: [Math.cos(a) * 0.5, -1.18, Math.sin(a) * 0.5], r: [0, -a + PI / 2, 0], c: '#3a302c' });
  }
  return shadeByHeight(build(prims), -1.25, 0, 0.6);
}
/** 두건(머리 단위 좌표 — 잿빛 마녀) */
function hood() {
  return build([
    { k: 'cone', s: [0.62, 1.3], p: [0, 0.75, -0.12], r: [-0.25, 0, 0], seg: 6 },
    { k: 'box', s: [0.7, 0.62, 0.12], p: [0, 0.48, 0.36], c: '#140e0c' },
  ]);
}
/** 떠 있는 재 여섯(루트 틀 · 반지름 0.7) */
function ashRing() {
  const prims = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * PI * 2;
    prims.push({ k: 'oct', s: [0.05 + (i % 3) * 0.015], p: [Math.cos(a) * 0.7, 0.6 + (i % 3) * 0.45, Math.sin(a) * 0.7] });
  }
  return build(prims);
}
/** 잉걸불 금(가슴 틀 단위 — 잿빛 하수인 · 발광) */
function embers() {
  return build([
    { k: 'box', s: [0.06, 0.4, 0.02], p: [0.12, 0.5, 0.42], r: [0, 0, 0.3] },
    { k: 'box', s: [0.05, 0.3, 0.02], p: [-0.15, 0.62, 0.42], r: [0, 0, -0.4] },
    { k: 'box', s: [0.3, 0.04, 0.02], p: [0, 0.32, 0.42] },
  ]);
}

/**
 * 부위 메시 표 — id → {make, mat}
 * @type {Record<string, {make:() => import('three').BufferGeometry, mat:'std'|'metal'|'glow'}>}
 */
export const PART_MESHES = {
  limb: { make: limb, mat: 'std' },
  bone: { make: bone, mat: 'std' },
  torso: { make: torso, mat: 'std' },
  torsoHunch: { make: torsoHunch, mat: 'std' },
  ribs: { make: ribs, mat: 'std' },
  pelvis: { make: pelvis, mat: 'std' },
  pelvisBone: { make: pelvisBone, mat: 'std' },
  skull: { make: skull, mat: 'std' },
  headFlesh: { make: headFlesh, mat: 'std' },
  headImp: { make: headImp, mat: 'std' },
  headAsh: { make: headAsh, mat: 'std' },
  eyes: { make: eyes, mat: 'glow' },
  claws: { make: claws, mat: 'std' },
  foot: { make: foot, mat: 'std' },
  qbody: { make: qbody, mat: 'std' },
  qhead: { make: qhead, mat: 'std' },
  horns: { make: horns, mat: 'std' },
  tail: { make: tail, mat: 'std' },
  blobBody: { make: blobBody, mat: 'std' },
  stub: { make: stub, mat: 'std' },
  pile: { make: pile, mat: 'std' },
  ribPillars: { make: ribPillars, mat: 'std' },
  core: { make: core, mat: 'glow' },
  dagger: { make: dagger, mat: 'metal' },
  shortSword: { make: shortSword, mat: 'metal' },
  shieldBig: { make: shieldBig, mat: 'metal' },
  bow: { make: bow, mat: 'std' },
  bowString: { make: bowString, mat: 'std' },
  arrow: { make: arrow, mat: 'std' },
  quiver: { make: quiver, mat: 'std' },
  club: { make: club, mat: 'std' },
  spineSpikes: { make: spineSpikes, mat: 'std' },
  staffSkull: { make: staffSkull, mat: 'std' },
  mask: { make: mask, mat: 'std' },
  feathers: { make: feathers, mat: 'std' },
  hornsSmall: { make: hornsSmall, mat: 'std' },
  helmRusty: { make: helmRusty, mat: 'metal' },
  robe: { make: robe, mat: 'std' },
  hood: { make: hood, mat: 'std' },
  ashRing: { make: ashRing, mat: 'glow' },
  embers: { make: embers, mat: 'glow' },
};
