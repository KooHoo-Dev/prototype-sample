// OWNER: P13 — 계약 §9.7 · §9.8 · §9.9 · §0.5(view 의 연출 상수는 한곳에 — 이 폴더의 표)
// 효과 kind · 투사체 visual · 속성 · 피해 종류 · 템플릿 → 그리는 법. 로직은 이 표의 「모양 이름」(pattern · pool · hit · aura …)으로만 갈린다 —
// 콘텐츠 ID(효과 kind · 투사체 visual · 속성 ID)는 §9.8 의 연출 ID 라 이 표의 키로만 쓴다.
// 색은 전부 sRGB 16진 → lin() 으로 선형(three 의 색 관리 — 정점 색 · 인스턴스 색 · 셰이더가 같은 공간).
// 규칙: 적대(hostile) 표식의 테두리는 늘 HOSTILE(#ff3b30). 플레이어 소유 연출은 붉은 색조(색상각 345°~15°)를 쓰지 않는다(흰 · 주황 · 하늘색).

import { Color } from 'three';

const _c = new Color();
/** sRGB 16진 → 선형 [r, g, b] @param {number} hex @returns {number[]} */
export function lin(hex) {
  _c.setHex(hex);
  return [_c.r, _c.g, _c.b];
}
/** 선형 색을 w 쪽으로 k 만큼 @param {number[]} c @param {number[]} w @param {number} k */
export function mix(c, w, k) {
  return [c[0] + (w[0] - c[0]) * k, c[1] + (w[1] - c[1]) * k, c[2] + (w[2] - c[2]) * k];
}

const COLORS = new Map();
/** 16진 → 선형 색(캐시 — 프레임 경로에서 할당 없음) @param {number} hex @returns {number[]} */
export function col(hex) {
  let c = COLORS.get(hex);
  if (!c) { c = lin(hex); COLORS.set(hex, c); }
  return c;
}
const LIGHT = new Map();
/** 흰색 쪽으로 k(0..1 — 1/7 단위) 밝힌 색(캐시) @param {number} hex @param {number} k */
export function light(hex, k) {
  const key = hex * 8 + Math.round(k * 7);
  let c = LIGHT.get(key);
  if (!c) { c = mix(lin(hex), [1, 1, 1], Math.round(k * 7) / 7); LIGHT.set(key, c); }
  return c;
}

/** 적대 테두리(계약 §9.7) */
export const HOSTILE_HEX = 0xff3b30;
export const HOSTILE = lin(HOSTILE_HEX);
export const WHITE = lin(0xffffff);

/** 풀 상한(§9.7 — 입자 2,000 · 데칼 200 · 투사체 256). 입자 = 시뮬 입자(가산 + 먼지) + 프레임 스프라이트(오라 · 상태 · 포털 · 후광) — 합 2,000 */
export const CAP = {
  decals: 200,          // 바닥 표식(상태의 효과 + 순간 표식) 한 프레임 상한
  decalVerts: 60000,    // 보통 혼합 데칼 정점 예산
  glowVerts: 30000,     // 가산 데칼 정점 예산
  particlesAdd: 1100,   // 가산 입자(불꽃 · 불씨 · 서리 · 번개)
  particlesDust: 300,   // 보통 혼합 입자(먼지 · 뼈 조각 · 점액)
  glyphs: 600,          // 프레임마다 다시 그리는 스프라이트
  proj: 256,            // 투사체(§9.7)
  segs: 1200,           // 굵은 선분(번개 · 조준선 · 균열 무늬)
  shells: 200,          // 구체 껍질(보호막 · 얼음 껍질 · 폭발 구)
  pillars: 64,          // 빛기둥
  arcs: 400,            // 바람 줄(빠름 · 회오리)
  links: 600,           // 쇠사슬 고리(감옥 오라 · 속박)
  stars: 300,           // 기절 별
  solids: 128,          // 돌 · 포탄 · 포신
  spikes: 96,           // 뼈 가시
  transients: 96,       // 순간 연출 기록
  hits: 48,             // 한 프레임에 처리하는 HIT 불꽃
  cullR: 32,            // §9.1 컬링
};

/** 바닥 표식 수치(m · 초 · 불투명도) */
export const DECAL = {
  lift: 0.035,          // 바닥 위 높이
  border: 0.12,         // 테두리 띠 폭(모양 안쪽으로 — 바깥 가장자리 = 판정 경계)
  edge: 0.08,           // 채움 앞머리 띠 폭
  segLen: 0.2,          // 원호 한 조각 길이(m)
  segMin: 8, segMax: 72,
  baseA: 0.08,          // 전체 영역 옅은 바탕
  fillA: 0.30,          // 자라는 채움
  edgeA: 0.6,           // 채움 앞머리
  borderA: 0.92,        // 테두리
  patternA: 0.75,
  faint: 0.6,           // 플레이어 예고(지진 고리 · 메테오)
  flashSec: 0.1,        // 판정 순간 밝아짐 길이(§9.7)
  flashA: 0.6,          // 그 불투명도 상한(§9.7 — 화면을 덮지 않는다)
  flashWhite: 0.5,      // 안쪽 색을 흰색 쪽으로
  poolA: 0.32,          // 웅덩이 채움
  poolFadeIn: 0.15, poolFadeOut: 0.3,
};

/**
 * 효과 kind → 그리는 법(§9.8 의 kind 전부 + 투사체 폭발 visual).
 * inner = 안쪽 색 · border = 비적대 테두리 색(적대는 늘 HOSTILE) · tele = 예고 [start, hitAt) 를 그린다 · faint = 예고 불투명도 배율 ·
 * pattern = 무늬(chains · bubbles · chevrons · cracks · spikes · rift) · fall = 낙하체(mortar · meteor · ember) · pool = 지속 [hitAt, end) 의 모양 ·
 * hit = 판정 순간(flash · ring · fan · line · sphere) · burst = 판정 순간 입자 · grow/fade = 순간 연출 길이(초)
 */
export const KIND_STYLE = {
  // ── 적대(붉은 테두리 공통 + 종류별 안쪽 색) ──
  jail: { inner: 0x9aa0a8, tele: true, pattern: 'chains', hit: 'flash', burst: 'chains' },
  plague: { inner: 0xa6e22e, tele: true, pattern: 'bubbles', pool: 'pool', hit: 'flash', burst: 'plague' },
  mortar: { inner: 0xff8a1e, tele: true, fall: 'mortar', hit: 'flash', burst: 'blast' },
  coldNova: { inner: 0x5ac8ff, tele: true, hit: 'flash', burst: 'frost' },
  fireDeath: { inner: 0xff7a1a, tele: true, hit: 'flash', burst: 'fire' },
  bloaterBurst: { inner: 0xb3124a, tele: true, pattern: 'bubbles', hit: 'flash', burst: 'goo' },
  poisonPool: { inner: 0x5f9a2a, tele: false, pattern: 'bubbles', pool: 'pool', hit: null, burst: null },
  chargeLine: { inner: 0xd9a066, tele: true, pattern: 'chevrons', hit: null, burst: null },
  slam: { inner: 0xe8dcc0, tele: true, pattern: 'cracks', hit: 'flash', burst: 'rubble' },
  boneSpikes: { inner: 0xe8dcc0, tele: true, pattern: 'spikes', hit: 'flash', burst: 'spikes' },
  emberRain: { inner: 0xd8743a, tele: true, fall: 'ember', hit: 'flash', burst: 'embers' },
  // ── 플레이어 소유(흰 · 주황 · 하늘색 — 붉은색 없음) ──
  stomp: { inner: 0xffc46b, border: 0xfff2d6, tele: false, hit: 'fan', burst: 'dust', fade: 0.3 },
  quakeWave: { inner: 0xe8c890, border: 0xf3e6c8, tele: true, faint: DECAL.faint, hit: 'ring', burst: 'dustRing', grow: 0.25, fade: 0.3 },
  shockwave: { inner: 0xffc46b, border: 0xfff2d6, tele: false, hit: 'line', burst: 'dustLine', fade: 0.3 },
  meteor: { inner: 0xff9a2e, border: 0xffc36b, tele: true, faint: DECAL.faint, fall: 'meteor', pool: 'burning', hit: 'flash', burst: 'fire' },
  vortex: { inner: 0xff8a2a, border: 0xffb050, tele: false, pool: 'vortex', hit: null, burst: null },
  afterimageBlast: { inner: 0xb9a6ff, border: 0xe6dcff, tele: false, hit: 'sphere', burst: 'lightning', grow: 0.08, fade: 0.2 },
  corpseBlast: { inner: 0xffb070, border: 0xfff0d0, tele: false, hit: 'sphere', burst: 'fire', grow: 0.08, fade: 0.2 },
  iceBurst: { inner: 0x8fdcff, border: 0xe6f7ff, tele: false, hit: 'sphere', burst: 'frost', grow: 0.08, fade: 0.2 },
  chainArc: { inner: 0xd8ccff, border: 0xffffff, tele: false, pool: 'arc', hit: null, burst: null },
  // 투사체 폭발(EFFECT_HIT kind = explode.visual) — 불덩이 구는 판정 원 크기까지(§9.6 — 0.25초)
  fireball: { inner: 0xffa23a, border: 0xffd27a, tele: false, hit: 'sphere', burst: 'fire', grow: 0.1, fade: 0.15 },
  fireballSplit: { inner: 0xffa23a, border: 0xffd27a, tele: false, hit: 'sphere', burst: 'fire', grow: 0.1, fade: 0.15 },
  // ── 환경(수호자 출현 — 검은 균열 + 보라 소용돌이) ──
  guardianSpawn: { inner: 0x07040a, border: 0xb06bff, tele: true, pattern: 'rift', hit: null, burst: null },
};
/** 표에 없는 kind */
export const KIND_DEFAULT_HOSTILE = { inner: 0xff9a80, tele: true, hit: 'flash', burst: 'dust' };
export const KIND_DEFAULT_FRIENDLY = { inner: 0xfff0d0, border: 0xffffff, tele: true, faint: DECAL.faint, hit: 'flash', burst: null };

/** 낙하체(§9.7 — from → 표식 중심 · 진행 = 틱) */
export const FALL = {
  mortar: { y0: 1.6, apex: 3.0, apexPerM: 0.25, size: 0.22, solid: 0x2a2a2e, glow: 0xff9a2e, glowSize: 0.9, trail: 3 },
  meteor: { y0: 12, apex: 0, apexPerM: 0, size: 0.42, solid: 0x5a2a14, glow: 0xff8a1e, glowSize: 2.4, trail: 5 },
  ember: { y0: 2.6, apex: 4.0, apexPerM: 0.15, size: 0.18, solid: 0x4a2a1a, glow: 0xff7a2a, glowSize: 0.9, trail: 3 },
};

/** 지속 모양 */
export const POOL = {
  pool: { bubbleN: 10 },
  burning: { glow: 0xff8a1e, flame: 0xffc060, flames: 8 },
  vortex: { arms: 3, spin: 4.0, glow: 0xff9a3a },
  arc: { core: 0xffffff, glow: 0xb48cff, width: 0.05, glowWidth: 0.14, jitter: 0.35, y: 1.0 },
};

/** 수호자 출현 예고 */
export const RIFT_FX = { crack: 0xb06bff, swirl: 0xa35bff, dark: 0x07040a, swirlN: 18, cracks: 7 };

/**
 * 투사체 visual → 그리는 법(§9.7 · §9.6 — 구의 반지름 = 판정 r(proj.r) · 화살 막대 0.8m).
 * form: orb(구) · streak(빛 화살) · shard(얼음 파편) · arrow(화살 메시)
 */
export const PROJ_STYLE = {
  magicBolt: { form: 'streak', core: 0xeaf8ff, glow: 0x5ac8ff, len: 0.9, y: 1.15, halo: 0.9, trail: 2, end: 'lightning' },
  fireball: { form: 'orb', core: 0xffd27a, glow: 0xff8a1e, y: 1.1, halo: 1.6, trail: 4, trailColor: 0xff7a1a, end: 'embers' },
  fireballSplit: { form: 'orb', core: 0xffd27a, glow: 0xff8a1e, y: 1.1, halo: 1.2, trail: 3, trailColor: 0xff7a1a, end: 'embers' },
  iceShard: { form: 'shard', core: 0xd8f4ff, glow: 0x7fd4ff, len: 0.6, y: 0.9, halo: 0.6, trail: 1, end: 'frostPuff' },
  arrow: { form: 'arrow', len: 0.8, y: 1.3, glow: 0xffe6c8, halo: 0.45, trail: 0, end: 'dust' },
  shamanFire: { form: 'orb', core: 0xdcff8a, glow: 0x7cff3a, y: 1.25, halo: 1.3, trail: 3, trailColor: 0xffa23a, end: 'embers' },
  spark: { form: 'orb', core: 0xb49cff, glow: 0x9a7bff, y: 0.55, halo: 0.8, trail: 0, arcs: true, coreK: 0.45, end: 'lightning' },
  ashBolt: { form: 'orb', core: 0xffb080, glow: 0xff5a1a, y: 1.4, halo: 1.4, trail: 4, trailColor: 0x9a6a50, end: 'ash' },
};
export const PROJ_DEFAULT = { form: 'orb', core: 0xffffff, glow: 0xffd8a0, y: 1.1, halo: 0.8, trail: 1, end: 'embers' };

/** 속성 ID → 오라 모양(§9.7) — 강인함은 P8 재질(P13 은 입자 없음) */
export const AFFIX_AURA = {
  fast: 'wind', tough: null, fireEnchanted: 'fireGlow', coldEnchanted: 'frost', lightningEnchanted: 'arcs', vampiric: 'bloodAura',
  shielding: 'goldGlint', teleporter: 'phase', jailer: 'chains', splitter: 'cracks', plague: 'bubbles', mortar: 'barrel',
};
/** 오라 모양 → 색 · 수치 */
export const AURA = {
  wind: { color: 0xdff4ff, k: 0.55, rings: 3, spin: 6.5, rMul: 1.3 },
  fireGlow: { color: 0xff7a1a, ember: 0xffc060, k: 0.42, embers: 5 },
  frost: { color: 0xbfe8ff, ring: 0x7fd4ff, k: 0.3, flakes: 6 },
  arcs: { core: 0xffffff, glow: 0xb48cff, n: 3, width: 0.03, hz: 14 },
  bloodAura: { color: 0xb0102a, mote: 0xff3a5a, k: 0.28, motes: 3 },
  goldGlint: { color: 0xffd23d, idle: 2, warn: 10, shell: 0xffd23d, shellK: 0.8 },
  phase: { color: 0xa35bff, motes: 4, k: 0.6 },
  chains: { color: 0x9aa0a8, n: 12, spin: 0.8, rMul: 1.4 },
  cracks: { color: 0xff8af0, n: 3, k: 0.85 },
  bubbles: { color: 0xa6e22e, n: 5, k: 0.5 },
  barrel: { color: 0x3a3d42, mouth: 0xff9a2e },
};

/** 상태 표시(§9.7) */
export const STATUS_FX = {
  burn: { color: 0xff8a1e, tip: 0xffd27a, n: 5 },
  freeze: { color: 0x9ad8ff, k: 0.85 },
  shock: { core: 0xffffff, glow: 0xb48cff },
  stun: { color: 0xffe066, n: 3, r: 0.38, spin: 4 },
  chill: { color: 0x6fb8ff, n: 3, k: 0.35 },
};

/** 몬스터 예고(공격 행의 telegraph — 'glow' · 'aimLine') — 색은 공격 행의 kind · type 으로 */
export const MON_TELE = {
  glowPhys: 0x7cff6a,       // 「녹색 시전 빛」(주술사 부활 · 둥지 낳기)
  glowFire: 0xffa23a,
  glowCold: 0x7fd4ff,
  glowLightning: 0xb48cff,
  aim: HOSTILE_HEX,         // 궁수 붉은 조준선
  aimWidth: 0.05, aimLockedWidth: 0.09,
};

/** 플레이어(스킬 · 상태 · 버프) — 붉은색 없음 */
export const PLAYER_FX = {
  wind: 0xdff4ff,           // 회오리 바람 고리 · 기둥
  dust: 0x8a7a66,           // 돌진 먼지 자취 · 도약 먼지 고리
  stomp: 0xffe2a8,
  frost: 0x9fdcff,
  gold: 0xffcf4a,           // 전투 함성 · 레벨업
  shield: 0x7fd4ff,         // 마력 보호막
  recall: 0xbfe3ff,
  blink: 0x9fd8ff,
  root: 0x9aa0a8,
  slow: 0x9fdcff,
  heal: 0x7dff7a,
  potion: 0xff5a6a,         // 붉은 기(포션 — 플레이어 몸 위의 작은 입자 · 위협 표식이 아니다)
  hurt: 0xc0182a,           // 맞을 때 붉은 튐(작게)
  castPhys: 0xfff0d0, castFire: 0xffa23a, castCold: 0x9fdcff, castLightning: 0xc8b8ff, castNone: 0xfff0d0,
  windupHand: 0.45,         // 손 빛 최대 크기(m)
};

/** 포털 소용돌이 */
export const PORTAL_FX = { recall: 0x8fd0ff, exit: 0xffe6a0, town: 0x9fb4ff, n: 26, spin: 2.4 };

/** HIT 불꽃(§9.7 — 물리 흰 주황 · 화염 주황 · 냉기 하늘색 · 번개 흰 보라) */
export const HIT_STYLE = {
  phys: { a: 0xfff4e0, b: 0xffb060 },
  fire: { a: 0xffd080, b: 0xff6a10 },
  cold: { a: 0xeaf8ff, b: 0x5ac8ff },
  lightning: { a: 0xffffff, b: 0xb48cff },
};

/** 몬스터 사망(템플릿별 — 먼지 · 뼈 조각) */
export const DEATH_STYLE = {
  humanoid: { chips: 0xd8cfb8, dust: 0x6a6058, n: 10 },
  small: { chips: 0xd8cfb8, dust: 0x6a6058, n: 7 },
  quadruped: { chips: 0x5a4a3a, dust: 0x6a5a48, n: 10 },
  blob: { chips: 0x8fc23a, dust: 0x4f6a2a, n: 12 },
  nest: { chips: 0xe0d6bc, dust: 0x7a7060, n: 14 },
};

/** AFFIX 순간 연출(what → 입자 묶음) */
export const AFFIX_BURST = {
  teleportOut: 'purple', teleportIn: 'purple', shieldWarn: 'gold', shieldOn: 'gold', shieldOff: 'goldFade', split: 'pink', sparks: 'lightning',
  novaWarn: 'frostPuff', jailWarn: 'chains', plagueWarn: 'plague', mortarFire: 'muzzle', fireArm: 'fire', heal: 'blood',
};

/**
 * 입자 묶음(이벤트 → 시뮬 입자). pool: add(가산) · dust(보통). n = 기본 개수(× 화질 particles). speed m/s · up = 위로 더하는 속도 ·
 * life 초 · size 지름 m(s0 → s1) · grav m/s²(음수 = 떠오름) · drag 1/s · spread: sphere(사방) · ring(수평 고리) · up(위로) · disk(원 안에서 위로)
 */
export const BURSTS = {
  dust: { pool: 'dust', n: 10, speed: 2.2, up: 1.0, life: 0.7, s0: 0.35, s1: 0.9, grav: -0.3, drag: 3, a: 0.5, c0: 0x8a7a66, c1: 0x5a5046, spread: 'ring' },
  dustRing: { pool: 'dust', n: 18, speed: 1.4, up: 0.8, life: 0.7, s0: 0.4, s1: 1.0, grav: -0.2, drag: 2.5, a: 0.45, c0: 0x9a8a72, c1: 0x5a5046, spread: 'ring' },
  dustLine: { pool: 'dust', n: 14, speed: 1.0, up: 1.0, life: 0.6, s0: 0.35, s1: 0.8, grav: -0.2, drag: 2.5, a: 0.45, c0: 0x9a8a72, c1: 0x5a5046, spread: 'disk' },
  rubble: { pool: 'dust', n: 18, speed: 3.0, up: 3.5, life: 0.8, s0: 0.16, s1: 0.12, grav: 12, drag: 0.5, a: 0.9, c0: 0xe8dcc0, c1: 0x8a7a66, spread: 'disk' },
  spikes: { pool: 'dust', n: 14, speed: 1.5, up: 2.5, life: 0.6, s0: 0.14, s1: 0.1, grav: 10, drag: 0.5, a: 0.9, c0: 0xe8dcc0, c1: 0xb8ab90, spread: 'disk' },
  goo: { pool: 'dust', n: 16, speed: 3.5, up: 3.0, life: 0.7, s0: 0.22, s1: 0.14, grav: 12, drag: 0.8, a: 0.9, c0: 0x8fc23a, c1: 0xb3124a, spread: 'sphere' },
  blast: { pool: 'add', n: 16, speed: 4.0, up: 2.0, life: 0.45, s0: 0.45, s1: 0.1, grav: 4, drag: 2, a: 0.9, c0: 0xffd27a, c1: 0xff6a10, spread: 'sphere' },
  fire: { pool: 'add', n: 22, speed: 3.5, up: 2.5, life: 0.55, s0: 0.5, s1: 0.12, grav: -1.5, drag: 2.5, a: 0.85, c0: 0xffd27a, c1: 0xff6a10, spread: 'sphere' },
  embers: { pool: 'add', n: 12, speed: 2.5, up: 2.0, life: 0.6, s0: 0.25, s1: 0.06, grav: -1.0, drag: 2, a: 0.9, c0: 0xffc060, c1: 0xd8743a, spread: 'sphere' },
  frost: { pool: 'add', n: 20, speed: 3.0, up: 1.2, life: 0.6, s0: 0.3, s1: 0.08, grav: 0.5, drag: 2.5, a: 0.8, c0: 0xeaf8ff, c1: 0x5ac8ff, spread: 'ring' },
  frostPuff: { pool: 'add', n: 10, speed: 1.2, up: 0.6, life: 0.5, s0: 0.3, s1: 0.1, grav: 0, drag: 2, a: 0.6, c0: 0xeaf8ff, c1: 0x5ac8ff, spread: 'sphere' },
  lightning: { pool: 'add', n: 16, speed: 5.0, up: 1.0, life: 0.3, s0: 0.2, s1: 0.05, grav: 0, drag: 4, a: 1.0, c0: 0xffffff, c1: 0xb48cff, spread: 'sphere' },
  gold: { pool: 'add', n: 14, speed: 1.6, up: 1.0, life: 0.6, s0: 0.2, s1: 0.05, grav: -0.5, drag: 2, a: 0.9, c0: 0xfff2b0, c1: 0xffd23d, spread: 'sphere' },
  goldFade: { pool: 'add', n: 8, speed: 0.8, up: 0.6, life: 0.5, s0: 0.18, s1: 0.04, grav: -0.5, drag: 2, a: 0.6, c0: 0xfff2b0, c1: 0xffd23d, spread: 'sphere' },
  purple: { pool: 'add', n: 16, speed: 2.0, up: 1.2, life: 0.5, s0: 0.3, s1: 0.06, grav: -0.5, drag: 3, a: 0.85, c0: 0xd8b8ff, c1: 0xa35bff, spread: 'sphere' },
  pink: { pool: 'add', n: 14, speed: 2.5, up: 1.5, life: 0.5, s0: 0.25, s1: 0.06, grav: 1, drag: 2, a: 0.85, c0: 0xffd0f4, c1: 0xff8af0, spread: 'sphere' },
  plague: { pool: 'add', n: 10, speed: 1.0, up: 0.8, life: 0.7, s0: 0.25, s1: 0.1, grav: -0.6, drag: 2, a: 0.55, c0: 0xd8ff8a, c1: 0xa6e22e, spread: 'disk' },
  chains: { pool: 'dust', n: 8, speed: 1.2, up: 1.5, life: 0.5, s0: 0.14, s1: 0.1, grav: 8, drag: 1, a: 0.9, c0: 0xb8bec8, c1: 0x6a7078, spread: 'disk' },
  muzzle: { pool: 'add', n: 8, speed: 1.5, up: 3.0, life: 0.4, s0: 0.35, s1: 0.1, grav: -1, drag: 3, a: 0.9, c0: 0xffd27a, c1: 0xff8a1e, spread: 'up' },
  blood: { pool: 'add', n: 6, speed: 0.8, up: 0.8, life: 0.6, s0: 0.2, s1: 0.06, grav: -0.8, drag: 2, a: 0.7, c0: 0xff4a6a, c1: 0xb0102a, spread: 'sphere' },
  hurt: { pool: 'dust', n: 5, speed: 2.0, up: 1.5, life: 0.35, s0: 0.12, s1: 0.06, grav: 9, drag: 1, a: 0.85, c0: 0xc0182a, c1: 0x7a0a18, spread: 'sphere' },
  healGreen: { pool: 'add', n: 12, speed: 0.5, up: 1.4, life: 0.8, s0: 0.2, s1: 0.06, grav: -0.5, drag: 1.5, a: 0.8, c0: 0xc8ffc0, c1: 0x7dff7a, spread: 'disk' },
  healRed: { pool: 'add', n: 12, speed: 0.5, up: 1.4, life: 0.8, s0: 0.2, s1: 0.06, grav: -0.5, drag: 1.5, a: 0.8, c0: 0xffc0c8, c1: 0xff5a6a, spread: 'disk' },
  shieldBreak: { pool: 'add', n: 18, speed: 3.5, up: 1.0, life: 0.45, s0: 0.22, s1: 0.05, grav: 4, drag: 2, a: 0.9, c0: 0xeaf8ff, c1: 0x7fd4ff, spread: 'sphere' },
  portal: { pool: 'add', n: 20, speed: 1.6, up: 1.0, life: 0.7, s0: 0.3, s1: 0.06, grav: -0.5, drag: 2, a: 0.8, c0: 0xd8ecff, c1: 0x8fd0ff, spread: 'sphere' },
  revive: { pool: 'add', n: 14, speed: 1.0, up: 2.0, life: 0.7, s0: 0.3, s1: 0.06, grav: -1, drag: 2, a: 0.8, c0: 0xd0ffc0, c1: 0x7cff6a, spread: 'up' },
  bones: { pool: 'dust', n: 10, speed: 2.5, up: 3.0, life: 0.6, s0: 0.14, s1: 0.1, grav: 12, drag: 0.6, a: 0.9, c0: 0xe0d6bc, c1: 0xb8ab90, spread: 'disk' },
  ash: { pool: 'add', n: 12, speed: 1.6, up: 1.2, life: 0.6, s0: 0.3, s1: 0.06, grav: -0.6, drag: 2, a: 0.75, c0: 0xffa070, c1: 0x9a6a50, spread: 'sphere' },
  guardian: { pool: 'add', n: 30, speed: 3.0, up: 2.0, life: 0.8, s0: 0.45, s1: 0.08, grav: -0.8, drag: 2.5, a: 0.9, c0: 0xd8b8ff, c1: 0xa35bff, spread: 'ring' },
  cast: { pool: 'add', n: 5, speed: 0.8, up: 0.4, life: 0.3, s0: 0.25, s1: 0.06, grav: 0, drag: 3, a: 0.8, c0: 0xffffff, c1: 0xfff0d0, spread: 'sphere' },
};

/** 효과 kind → 판정 순간 입자 묶음의 이름(KIND_STYLE.burst) 외 · 피해 종류별 HIT 불꽃 수 */
export const HIT_FX = { n: 6, nCrit: 12, nDot: 1, nBig: 16, speed: 4.5, life: 0.28, size: 0.16, sizeCrit: 0.26, y: 0.6, critFlash: 0.6, critLife: 0.1 };
