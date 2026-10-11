// OWNER: P7 — 계약 §9.2 · §9.4 · §7.12 (내부 — 연출 상수: 색 · 빛 배율 · 크기. 판정 수치가 아니다)
// 타일셋별 분위기(안개 · 하늘빛 · 해) · 바닥/벽 색 · 빛 종류별 발광체 모양.

/** 계약 §9.2 · §7.12 의 빛 세기 → three(물리 단위) 세기 배율 — 화면을 보고 맞춘 값(조정 손잡이) */
export const LIGHT_SCALE = 24;
/** 점광원 감쇠 지수(three decay) — 2 는 반경 끝이 너무 일찍 꺼져 「빛 반경」이 작게 읽힌다 */
export const LIGHT_DECAY = 1.0;

/** 플레이어 머리 위 점광원(§9.2 — 따뜻한 흰 · 세기 2.2 · 반경 11m) */
export const PLAYER_LIGHT = { color: 0xffe6c0, intensity: 2.2, radius: 11, y: 3.2 };

/**
 * 분위기(§9.2 안개 FogExp2 색 · 밀도) + 반구광 · 해(방향광 · 마을 해질녘) — 반구광 「약하게 0.25」(three 단위로 × HEMI_SCALE) · 해는 three 단위
 * 안개 밀도는 계약 값 × FOG_K — 계약 값 그대로면 카메라(24m)에서 플레이어 자리가 이미 58% 안개라 빛 반경이 보이지 않는다(NOTES-P7).
 * 줌하면 CameraRig 가 밀도를 거리 비(24 / d)로 바꿔 플레이어 자리의 안개 양을 같게 둔다.
 */
export const ATMOS = {
  crypt: { fog: 0x0b0a0d, density: 0.035, hemiSky: 0x5a6078, hemiGround: 0x1a1412, hemi: 0.25, sun: 0x000000, sunI: 0, exposure: 1.2 },
  cavern: { fog: 0x120806, density: 0.03, hemiSky: 0x7a5a4c, hemiGround: 0x1e0c06, hemi: 0.25, sun: 0x000000, sunI: 0, exposure: 1.2 },
  town: { fog: 0x1a1420, density: 0.015, hemiSky: 0x8a80a8, hemiGround: 0x3a2e24, hemi: 0.55, sun: 0xffa060, sunI: 2.6, exposure: 1.0 },
};
export const HEMI_SCALE = 12;
/** 안개 밀도 배율(계약 §9.2 값에 곱한다 — 조정 손잡이 0.4~1.0) */
export const FOG_K = 0.5;
/** 해질녘 해의 방향(빛이 오는 쪽 — 카메라 쪽(+X) 낮게: 보이는 면(+X · +Z)이 노을빛을 받는다) */
export const SUN_DIR = { x: 0.82, y: 0.42, z: 0.38 };

/** 바닥 · 벽 · 소품 색(16진 sRGB) */
export const PAL = {
  crypt: {
    grout: 0x22201d, slab: 0x5e5a53, slabAlt: 0x4e4c48, moss: 0x3e4636, crack: 0x2a2826,
    wallCore: 0x1c1a18, wall: 0x6c6760, wallAlt: 0x5e5a55, wallBand: 0x4a4540, wallTop: 0x57524b, plinth: 0x4a4540,
  },
  cavern: {
    floorA: 0x3c3532, floorB: 0x2e2522, ash: 0x55504c, ember: 0x5a2a16,
    rock: 0x3a322e, rockAlt: 0x2c2522, rockTop: 0x5a524c, rockBase: 0x1e1614,
  },
  town: {
    grout: 0x3a342e, cobble: 0x6e675e, cobbleAlt: 0x625b52, dirt: 0x5a4a38, ring: 0x857c70, grass: 0x3a3e2e,
    wallStone: 0x6a6258, stake: 0x5a4030, stakeTop: 0x7a5a40, beam: 0x4a3426,
    outside: 0x1e1c1a,
  },
};

/** 벽 높이(§9.4 WALL_H) */
export const WALL_H = 3.0;

/**
 * 빛 종류 → 발광체(먼 빛은 이것만 보인다 — §9.4)
 * mesh: 'sconce'(벽 고정 횃불 · 벽이 없으면 기둥) · 'candle'(소품 촛불이 불꽃을 그린다 — 빛 자리에는 후광만) · 'lava'(바닥 후광) · 'brazier'(화로) · 'bonfire'(마을 모닥불 — 마을 물체가 그린다)
 * glow: 후광 지름(m) · glowY: 후광 높이(m · null 이면 빛 y) · ground: 바닥에 눕힌 후광
 */
export const EMIT = {
  candle: { mesh: 'candle', glow: 1.3, glowY: 0.55, ground: false },
  torch: { mesh: 'sconce', glow: 1.9, glowY: null, ground: false },
  lava: { mesh: 'lava', glow: 4.2, glowY: 0.06, ground: true },
  brazier: { mesh: 'brazier', glow: 2.2, glowY: 1.45, ground: false },
  bonfire: { mesh: 'bonfire', glow: 4.0, glowY: 1.1, ground: false },
};
export const EMIT_DEFAULT = { mesh: 'none', glow: 1.6, glowY: null, ground: false };

/** 불꽃 색(발광 — 톤 매핑을 받는다) */
export const FLAME = { core: 0xfff0b0, mid: 0xffa040, edge: 0xff5a1a, lava: 0xff7a20, lavaHot: 0xffd060 };

/** 마을 · 균열 물체 색 */
export const OBJ = {
  portalStone: 0x5a5660, portalStoneDark: 0x3a3640, portalRune: 0x8a7bff, portalOpen: 0x7f6cff, portalOpenCore: 0xc8bcff,
  riftStone: 0x23202a, riftStoneBase: 0x3a3640, riftCrack: 0xb070ff, riftCrackHot: 0xe0b8ff,
  firstRing: 0xffffff,
  stashWood: 0x5a3a22, stashIron: 0x5a5a60, stashGold: 0xb08a40,
  bonfireStone: 0x5a544c, bonfireLog: 0x3a2618,
  riftRecall: 0x5ab4ff, riftExit: 0xffc870,
};
