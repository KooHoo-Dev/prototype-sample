// OWNER: P8 — 계약 §9.5 · §9.6 (내부 — 플레이어 · NPC 의 부위 지오메트리: 몸 · 장비 외형 · 무기 7종 · 방어구 단계 3)
// 전부 관절 로컬 좌표의 실제 크기(m)로 만든다. 무기는 손잡이가 원점 · 날이 +Y — 길이(손잡이 → 끝)는 계약 §9.5:
//   sword 1.0 · axe 0.85 · mace 0.85 · greatsword 1.5 · greataxe 1.4 · wand 0.45 · staff 1.7(전체 길이 — 손잡이에서 끝까지 1.25)
// 방어구 단계: 0 천/가죽(갈색) · 1 사슬(회색 + 어깨 보호대) · 2 판금(밝은 금속 + 투구 볏) · 세트 녹색 띠 · 전설 주황 발광 띠 · 빈 부위는 기본 옷.

import { build } from './geom.js';

const PI = Math.PI;

/** 무기 길이(손잡이 → 끝 · m) — view.actors.test 가 판정 사거리와 대조한다 */
export const WEAPON_LEN = Object.freeze({ sword: 1.0, axe: 0.85, mace: 0.85, greatsword: 1.5, greataxe: 1.4, wand: 0.45, staff: 1.25, fist: 0.06 });

/** 색(연출 상수) */
export const COL = Object.freeze({
  skin: '#c99a78', skinDark: '#a87a5a', hair: '#3a2a1e', beard: '#4a3426',
  tunic: '#7a3b2c', pants: '#4a3a2c', robe: '#33397a', robeDark: '#262a5c', robeTrim: '#c9b46a', hood: '#2a2f66',
  leather: '#6b4a2e', leatherDark: '#4a321e', chain: '#8c9198', chainDark: '#62666c', plate: '#d0d4da', plateDark: '#9aa0a8',
  gold: '#d0a840', crest: '#b0302a', set: '#4fe07a', legend: '#ff9a2e', iron: '#9a9ea4', steel: '#c4cad0', bright: '#e4eaf2',
  wood: '#6a4a2e', grip: '#3a2618', gem: '#7ad0ff', orb: '#8fd8ff', ember: '#ff8a3a',
});
const TIER_ARMOR = [COL.leather, COL.chain, COL.plate];
const TIER_ARMOR_DARK = [COL.leatherDark, COL.chainDark, COL.plateDark];
const TIER_BLADE = [COL.iron, COL.steel, COL.bright];

/**
 * @typedef {{look:string, tier:number, rarity:string, hands?:number, set?:boolean, legendary?:boolean}|null} GearLook
 * @typedef {Object} CharLook
 * @property {'warrior'|'mage'} cls
 * @property {GearLook} weapon @property {GearLook} offhand @property {GearLook} helm @property {GearLook} chest
 * @property {GearLook} gloves @property {GearLook} boots @property {GearLook} belt
 * @property {string|null} [npc]   NPC 변형(npcSmith · npcGrocer · npcGambler · npcMystic)
 */

/** @typedef {{geo:import('three').BufferGeometry, mat:'std'|'metal'|'glow', joint:string, at?:number[]}} CharPart */

/** 띠(세트 녹색 · 전설 주황) 도형 하나 — 가로 띠 */
function band(w, d, y, color, z = 0) { return { k: 'box', s: [w, 0.035, d], p: [0, y, z], c: color }; }

// ───────────────────────── 무기 ─────────────────────────

/**
 * 무기 지오메트리(무기 틀) — {main: 금속/나무, glow: 발광(전설 띠 · 보석)}
 * @param {GearLook} w
 */
export function weaponGeo(w) {
  if (!w) return null;
  const t = Math.max(0, Math.min(2, w.tier | 0));
  const blade = TIER_BLADE[t];
  const deco = t >= 2;
  /** @type {any[]} */
  const m = [], g = [];
  switch (w.look) {
    case 'sword': {
      m.push({ k: 'cyl', s: [0.022, 0.025, 0.2], p: [0, -0.03, 0], c: COL.grip });
      m.push({ k: 'box', s: [deco ? 0.3 : 0.22, 0.03, 0.04], p: [0, 0.075, 0], c: deco ? COL.gold : COL.iron });
      m.push({ k: 'box', s: [0.062, 0.86, 0.016], p: [0, 0.52, 0], c: blade });
      m.push({ k: 'cone', s: [0.044, 0.08], p: [0, 0.99, 0], r: [0, PI / 4, 0], seg: 4, c: blade });
      if (deco) g.push({ k: 'oct', s: [0.03], p: [0, -0.14, 0], c: COL.gem });
      if (w.legendary) g.push({ k: 'box', s: [0.07, 0.05, 0.026], p: [0, 0.16, 0], c: COL.legend });
      break;
    }
    case 'axe': {
      m.push({ k: 'cyl', s: [0.022, 0.026, 0.92], p: [0, 0.31, 0], c: COL.wood });
      m.push({ k: 'box', s: [0.03, 0.2, 0.2], p: [0, 0.74, 0.12], c: blade });
      m.push({ k: 'box', s: [0.02, 0.26, 0.06], p: [0, 0.74, 0.24], c: blade });
      if (deco) { m.push({ k: 'cone', s: [0.03, 0.1], p: [0, 0.8, 0], seg: 4, c: COL.gold }); g.push({ k: 'oct', s: [0.028], p: [0, 0.74, 0.02], c: COL.gem }); }
      if (w.legendary) g.push({ k: 'box', s: [0.05, 0.05, 0.05], p: [0, 0.6, 0], c: COL.legend });
      break;
    }
    case 'mace': {
      m.push({ k: 'cyl', s: [0.022, 0.026, 0.72], p: [0, 0.22, 0], c: COL.wood });
      m.push({ k: 'dod', s: [0.09], p: [0, 0.74, 0], c: blade });
      for (let i = 0; i < 4; i++) m.push({ k: 'box', s: [0.03, 0.14, 0.03], p: [Math.cos(i * PI / 2) * 0.09, 0.74, Math.sin(i * PI / 2) * 0.09], c: blade });
      m.push({ k: 'cone', s: [0.03, 0.08], p: [0, 0.83, 0], seg: 4, c: deco ? COL.gold : blade });
      if (w.legendary) g.push({ k: 'box', s: [0.05, 0.05, 0.05], p: [0, 0.58, 0], c: COL.legend });
      break;
    }
    case 'greatsword': {
      m.push({ k: 'cyl', s: [0.026, 0.028, 0.34], p: [0, -0.08, 0], c: COL.grip });
      m.push({ k: 'box', s: [deco ? 0.42 : 0.32, 0.04, 0.05], p: [0, 0.1, 0], c: deco ? COL.gold : COL.iron });
      m.push({ k: 'box', s: [0.09, 1.3, 0.02], p: [0, 0.77, 0], c: blade });
      m.push({ k: 'cone', s: [0.064, 0.1], p: [0, 1.47, 0], r: [0, PI / 4, 0], seg: 4, c: blade });
      if (deco) g.push({ k: 'oct', s: [0.035], p: [0, -0.27, 0], c: COL.gem });
      if (w.legendary) g.push({ k: 'box', s: [0.1, 0.06, 0.03], p: [0, 0.22, 0], c: COL.legend });
      break;
    }
    case 'greataxe': {
      m.push({ k: 'cyl', s: [0.026, 0.03, 1.5], p: [0, 0.5, 0], c: COL.wood });
      m.push({ k: 'box', s: [0.035, 0.34, 0.26], p: [0, 1.18, 0.15], c: blade });
      m.push({ k: 'box', s: [0.035, 0.34, 0.26], p: [0, 1.18, -0.15], c: blade });
      m.push({ k: 'cone', s: [0.035, 0.14], p: [0, 1.33, 0], seg: 4, c: deco ? COL.gold : blade });
      if (w.legendary) g.push({ k: 'box', s: [0.07, 0.06, 0.07], p: [0, 0.98, 0], c: COL.legend });
      break;
    }
    case 'wand': {
      m.push({ k: 'cyl', s: [0.014, 0.02, 0.4], p: [0, 0.14, 0], c: COL.wood });
      m.push({ k: 'box', s: [0.05, 0.03, 0.05], p: [0, 0.34, 0], c: deco ? COL.gold : COL.iron });
      g.push({ k: 'oct', s: [deco ? 0.05 : 0.04], p: [0, 0.4, 0], sc: [1, 1.5, 1], c: COL.gem });
      if (w.legendary) g.push({ k: 'box', s: [0.04, 0.03, 0.04], p: [0, 0.22, 0], c: COL.legend });
      break;
    }
    case 'staff': {
      m.push({ k: 'cyl', s: [0.022, 0.028, 1.6], p: [0, 0.35, 0], c: COL.wood });
      m.push({ k: 'box', s: [0.1, 0.05, 0.1], p: [0, 1.12, 0], c: deco ? COL.gold : COL.iron });
      for (let i = 0; i < 3; i++) m.push({ k: 'box', s: [0.02, 0.14, 0.02], p: [Math.cos(i * 2.1) * 0.05, 1.19, Math.sin(i * 2.1) * 0.05], r: [0, 0, 0.2], c: deco ? COL.gold : COL.wood });
      g.push({ k: 'oct', s: [deco ? 0.08 : 0.065], p: [0, 1.22, 0], sc: [1, 1.3, 1], c: COL.gem });
      if (w.legendary) g.push({ k: 'box', s: [0.06, 0.04, 0.06], p: [0, 0.95, 0], c: COL.legend });
      break;
    }
    default:
      return null;
  }
  return { main: build(m), glow: g.length ? build(g) : null };
}

/** 방패(아래팔 틀 · 얼굴 +X) — 단계: 0 나무 원형 · 1 철 연 모양 · 2 탑 방패 @param {GearLook} o */
function shieldGeo(o) {
  const t = Math.max(0, Math.min(2, o.tier | 0));
  /** @type {any[]} */
  const m = [], g = [];
  if (t === 0) {
    m.push({ k: 'cyl', s: [0.3, 0.3, 0.05], p: [0.06, 0, 0], r: [0, 0, PI / 2], seg: 8, c: COL.wood });
    m.push({ k: 'cyl', s: [0.31, 0.31, 0.03], p: [0.04, 0, 0], r: [0, 0, PI / 2], seg: 8, c: COL.iron });
    m.push({ k: 'ico', s: [0.06], p: [0.1, 0, 0], c: COL.iron });
  } else if (t === 1) {
    m.push({ k: 'box', s: [0.05, 0.5, 0.42], p: [0.06, 0.05, 0], c: COL.chain });
    m.push({ k: 'cone', s: [0.21, 0.24], p: [0.06, -0.31, 0], r: [PI, PI / 4, 0], seg: 4, sc: [0.25, 1, 1], c: COL.chain });
    m.push({ k: 'box', s: [0.02, 0.5, 0.06], p: [0.09, 0.05, 0], c: COL.crest });
    m.push({ k: 'box', s: [0.02, 0.06, 0.42], p: [0.09, 0.15, 0], c: COL.crest });
  } else {
    m.push({ k: 'box', s: [0.06, 0.9, 0.48], p: [0.06, -0.05, 0], c: COL.plate });
    m.push({ k: 'box', s: [0.03, 0.82, 0.08], p: [0.1, -0.05, 0], c: COL.gold });
    m.push({ k: 'box', s: [0.03, 0.08, 0.42], p: [0.1, 0.2, 0], c: COL.gold });
  }
  if (o.set) g.push({ k: 'box', s: [0.02, 0.05, 0.3], p: [0.11, -0.12, 0], c: COL.set });
  if (o.legendary) g.push({ k: 'box', s: [0.02, 0.05, 0.3], p: [0.11, -0.12, 0], c: COL.legend });
  return { main: build(m), glow: g.length ? build(g) : null };
}

/** 마법구(손 틀 · 손바닥 위로 떠 있다) @param {GearLook} o */
function orbGeo(o) {
  const t = Math.max(0, Math.min(2, o.tier | 0));
  const m = [{ k: 'box', s: [0.12, 0.02, 0.12], p: [0, -0.07, 0.1], c: t >= 2 ? COL.gold : COL.iron }];
  const g = [{ k: 'ico', s: [0.07 + t * 0.012], d: 1, p: [0, -0.07, 0.19], c: o.legendary ? COL.legend : o.set ? COL.set : COL.orb }];
  return { main: build(m), glow: build(g) };
}

// ───────────────────────── 몸 · 방어구 ─────────────────────────

/**
 * 플레이어 · NPC 부위 목록(관절 로컬 · 실제 크기)
 * @param {CharLook} L @param {import('./rig.js').BipedDims & {shX:number}} d @returns {CharPart[]}
 */
export function charParts(L, d) {
  const mage = L.cls === 'mage';
  const npc = L.npc ?? null;
  /** @type {CharPart[]} */
  const out = [];
  const add = (joint, prims, mat = 'std') => { if (prims.length) out.push({ geo: build(prims), mat, joint }); };
  const ch = L.chest, hm = L.helm, gl = L.gloves, bt = L.boots, belt = L.belt;
  const chT = ch ? ch.tier : -1;
  const baseTop = npc === 'npcSmith' ? COL.skin : npc === 'npcGrocer' ? '#3a6a3a' : npc === 'npcGambler' ? '#3a2a4a' : npc === 'npcMystic' ? '#2a5a6a' : mage ? COL.robe : COL.tunic;
  const pants = npc === 'npcGambler' ? '#2a2030' : npc === 'npcMystic' ? '#1e3a44' : mage ? COL.robeDark : COL.pants;
  const top = chT >= 0 ? TIER_ARMOR[chT] : baseTop;
  const topDark = chT >= 0 ? TIER_ARMOR_DARK[chT] : pants;
  const metalChest = chT >= 1;
  const tw = d.shX * 2 + 0.02, tb = tw * 0.76;
  // 골반 · 허리띠
  const hip = [{ k: 'box', s: [0.31, 0.2, 0.2], p: [0, 0.02, 0], c: pants }];
  hip.push({ k: 'box', s: [0.33, 0.06, 0.22], p: [0, 0.11, 0], c: belt ? TIER_ARMOR_DARK[belt.tier | 0] : COL.leatherDark });
  if (belt) hip.push({ k: 'box', s: [0.06, 0.05, 0.03], p: [0, 0.11, 0.11], c: COL.gold });
  add('hips', hip);
  if (belt && (belt.set || belt.legendary)) add('hips', [band(0.34, 0.23, 0.08, belt.set ? COL.set : COL.legend)], 'glow');
  // 몸통
  const torso = [{ k: 'box', s: [tb, d.torso * 0.92, 0.2], p: [0, d.torso * 0.47, 0], taper: tw / tb, c: top }];
  if (chT === 1) for (let i = 0; i < 4; i++) torso.push({ k: 'box', s: [tb * (1.02 + i * 0.07), 0.018, 0.21 + i * 0.01], p: [0, 0.12 + i * 0.1, 0], c: COL.chainDark });
  if (chT === 2) {
    torso.push({ k: 'box', s: [0.04, d.torso * 0.6, 0.06], p: [0, d.torso * 0.55, 0.11], c: COL.plateDark });
    torso.push({ k: 'box', s: [tb + 0.02, 0.04, 0.22], p: [0, 0.05, 0], c: COL.gold });
  }
  if (npc === 'npcSmith') torso.push({ k: 'box', s: [tb * 1.02, d.torso * 0.8, 0.03], p: [0, d.torso * 0.42, 0.11], c: COL.leather });
  if (npc === 'npcGrocer') torso.push({ k: 'box', s: [tb * 1.1, d.torso * 0.4, 0.24], p: [0, d.torso * 0.2, 0.01], c: '#4a7a4a' });
  if (!npc && chT < 0 && !mage) torso.push({ k: 'box', s: [0.05, d.torso * 0.5, 0.03], p: [0.06, d.torso * 0.6, 0.1], c: COL.leatherDark });
  if (mage && chT < 0 && !npc) torso.push({ k: 'box', s: [0.06, d.torso * 0.8, 0.03], p: [0, d.torso * 0.47, 0.105], c: COL.robeTrim });
  add('chest', torso, metalChest ? 'metal' : 'std');
  if (ch && (ch.set || ch.legendary)) add('chest', [band(tw * 0.96, 0.23, d.torso * 0.62, ch.set ? COL.set : COL.legend)], 'glow');
  // 어깨 보호대(사슬 · 판금)
  if (chT >= 1) {
    const pr = chT === 2 ? 0.115 : 0.095;
    const pc = chT === 2 ? COL.plate : COL.chain;
    const pads = [];
    for (const sx of [1, -1]) {
      pads.push({ k: 'ico', s: [pr], p: [sx * d.shX, d.shY + 0.03, 0], sc: [1.15, 0.75, 1.1], c: pc });
      if (chT === 2) pads.push({ k: 'box', s: [0.16, 0.03, 0.2], p: [sx * (d.shX + 0.03), d.shY - 0.04, 0], r: [0, 0, sx * -0.4], c: COL.gold });
    }
    add('chest', pads, 'metal');
  }
  // 머리 · 얼굴
  const hs = npc === 'npcSmith' ? 0.25 : 0.24;
  const head = [
    { k: 'box', s: [hs * 0.82, hs, hs * 0.9], p: [0, hs * 0.5, 0], c: COL.skin },
    { k: 'box', s: [0.035, 0.025, 0.02], p: [0.045, hs * 0.58, hs * 0.45], c: '#1a1210' },
    { k: 'box', s: [0.035, 0.025, 0.02], p: [-0.045, hs * 0.58, hs * 0.45], c: '#1a1210' },
    { k: 'box', s: [0.035, 0.05, 0.04], p: [0, hs * 0.45, hs * 0.47], c: COL.skinDark },
  ];
  let hairOn = true;
  if (hm) {
    hairOn = false;
    const t = hm.tier | 0;
    if (t === 0) {
      head.push({ k: 'box', s: [hs * 0.96, hs * 0.5, hs * 1.02], p: [0, hs * 0.86, -0.01], c: COL.leather });
      head.push({ k: 'box', s: [hs * 0.96, hs * 0.7, 0.05], p: [0, hs * 0.55, -hs * 0.48], c: COL.leather });
    }
  } else if (mage && !npc) hairOn = false;
  if (npc === 'npcSmith') { hairOn = false; head.push({ k: 'box', s: [hs * 0.7, hs * 0.4, 0.06], p: [0, hs * 0.18, hs * 0.46], c: COL.beard }); }
  if (hairOn) head.push({ k: 'box', s: [hs * 0.9, hs * 0.32, hs * 0.96], p: [0, hs * 0.92, -0.01], c: COL.hair }, { k: 'box', s: [hs * 0.9, hs * 0.5, 0.05], p: [0, hs * 0.66, -hs * 0.46], c: COL.hair });
  add('head', head);
  // 투구 · 두건(단계 1 · 2는 금속)
  if (hm && (hm.tier | 0) >= 1) {
    const t = hm.tier | 0;
    const c = t === 2 ? COL.plate : COL.chain;
    const helm = t === 1 ? [
      { k: 'cyl', s: [hs * 0.56, hs * 0.6, hs * 0.55], p: [0, hs * 0.86, 0], seg: 8, c },
      { k: 'cone', s: [hs * 0.56, hs * 0.22], p: [0, hs * 1.24, 0], seg: 8, c },
      { k: 'box', s: [0.03, hs * 0.42, 0.03], p: [0, hs * 0.55, hs * 0.5], c },
    ] : [
      { k: 'box', s: [hs * 1.02, hs * 1.08, hs * 1.06], p: [0, hs * 0.55, 0], c },
      { k: 'box', s: [hs * 0.8, 0.025, 0.02], p: [0, hs * 0.58, hs * 0.54], c: '#141414' },
      { k: 'box', s: [0.04, 0.12, hs * 1.1], p: [0, hs * 1.14, -0.01], c: COL.crest },
    ];
    add('head', helm, 'metal');
  } else if (!hm && mage && !npc) {
    add('head', [
      { k: 'cone', s: [hs * 0.72, hs * 1.3], p: [0, hs * 0.84, -0.04], r: [-0.3, 0, 0], seg: 6, c: COL.hood },
      { k: 'box', s: [hs * 1.0, hs * 0.8, 0.05], p: [0, hs * 0.55, -hs * 0.5], c: COL.hood },
    ]);
  }
  if (hm && (hm.set || hm.legendary)) add('head', [band(hs * 1.08, hs * 1.1, hs * 0.76, hm.set ? COL.set : COL.legend)], 'glow');
  if (npc === 'npcGrocer') add('head', [{ k: 'cyl', s: [0.2, 0.2, 0.02], p: [0, hs * 0.98, 0], seg: 8, c: '#6a4a2a' }, { k: 'cyl', s: [0.12, 0.13, 0.12], p: [0, hs * 1.06, 0], seg: 8, c: '#6a4a2a' }]);
  if (npc === 'npcGambler') add('head', [{ k: 'cone', s: [hs * 0.75, hs * 1.4], p: [0, hs * 0.86, -0.05], r: [-0.25, 0, 0], seg: 6, c: '#2a1e38' }, { k: 'box', s: [hs, hs * 0.9, 0.05], p: [0, hs * 0.5, -hs * 0.5], c: '#2a1e38' }]);
  if (npc === 'npcMystic') add('head', [{ k: 'cyl', s: [0.22, 0.22, 0.02], p: [0, hs * 0.95, 0], seg: 8, c: '#3a2a6a' }, { k: 'cone', s: [0.13, 0.5], p: [0, hs * 1.2, -0.03], r: [-0.15, 0, 0], seg: 6, c: '#3a2a6a' }]);
  // 팔 — 위팔(소매 · 사슬/판금 위팔) · 아래팔(장갑 단계) · 손
  const sleeveC = chT >= 1 ? TIER_ARMOR[chT] : npc === 'npcSmith' ? COL.skin : baseTop;
  const wide = (mage && !npc) || npc === 'npcMystic' || npc === 'npcGambler';
  const glT = gl ? gl.tier | 0 : -1;
  const foreC = glT >= 0 ? TIER_ARMOR[glT] : wide ? baseTop : npc === 'npcSmith' || !npc ? COL.skin : baseTop;
  for (const s of ['L', 'R']) {
    add('sh' + s, [{ k: 'cyl', s: [0.062, wide ? 0.07 : 0.055, d.upper], p: [0, -d.upper / 2, 0], seg: 6, c: sleeveC }], chT >= 1 ? 'metal' : 'std');
    const fore = [{ k: 'cyl', s: [wide ? 0.075 : 0.05, glT === 2 ? 0.06 : 0.044, d.fore], p: [0, -d.fore / 2, 0], seg: 6, c: foreC }];
    if (glT >= 0) fore.push({ k: 'cyl', s: [0.064 + glT * 0.008, 0.06, 0.07], p: [0, -d.fore * 0.32, 0], seg: 6, c: TIER_ARMOR_DARK[glT] });
    if (wide && glT < 0) fore.push({ k: 'cyl', s: [0.095, 0.085, 0.07], p: [0, -d.fore * 0.85, 0], seg: 6, c: mage && !npc ? COL.robeTrim : baseTop });
    add('el' + s, fore, glT >= 1 ? 'metal' : 'std');
    add('ha' + s, [{ k: 'box', s: [0.07 + (glT === 2 ? 0.015 : 0), 0.085, 0.08], p: [0, -0.04, 0.005], c: glT >= 0 ? TIER_ARMOR[glT] : COL.skin }], glT >= 1 ? 'metal' : 'std');
    if (gl && (gl.set || gl.legendary)) add('el' + s, [band(0.13, 0.13, -d.fore * 0.32, gl.set ? COL.set : COL.legend)], 'glow');
  }
  // 다리 — 넓적다리(바지) · 정강이(장화 단계) · 발
  const btT = bt ? bt.tier | 0 : -1;
  const shinC = btT >= 0 ? TIER_ARMOR[btT] : pants;
  for (const s of ['L', 'R']) {
    add('hip' + s, [{ k: 'cyl', s: [0.078, 0.064, d.thigh], p: [0, -d.thigh / 2, 0], seg: 6, c: pants }]);
    const shin = [{ k: 'cyl', s: [0.06, 0.052, d.shin], p: [0, -d.shin / 2, 0], seg: 6, c: pants }];
    shin.push({ k: 'cyl', s: [0.068 + Math.max(0, btT) * 0.006, 0.062, d.shin * (btT >= 0 ? 0.62 : 0.3)], p: [0, -d.shin * (btT >= 0 ? 0.69 : 0.85), 0], seg: 6, c: btT >= 0 ? shinC : COL.leatherDark });
    if (btT === 2) shin.push({ k: 'ico', s: [0.06], p: [0, 0.0, 0.04], c: COL.plate });
    add('kn' + s, shin, btT >= 1 ? 'metal' : 'std');
    add('an' + s, [{ k: 'box', s: [0.1, 0.08, 0.25], p: [0, -0.04, 0.05], c: btT >= 0 ? TIER_ARMOR_DARK[btT] : COL.leatherDark }], btT >= 1 ? 'metal' : 'std');
    if (bt && (bt.set || bt.legendary)) add('kn' + s, [band(0.14, 0.14, -d.shin * 0.45, bt.set ? COL.set : COL.legend)], 'glow');
  }
  // 긴 옷자락(마법사 · 신비술사 · 도박꾼) — 허리 자락 + 넓적다리마다 앞뒤 자락(다리와 같이 움직인다)
  if (wide) {
    const rc = npc === 'npcGambler' ? '#2a1e38' : npc === 'npcMystic' ? '#24505e' : chT >= 0 ? TIER_ARMOR_DARK[chT] : COL.robe;
    const trim = npc ? COL.gold : COL.robeTrim;
    const long = npc === 'npcMystic' || npc === 'npcGambler' ? 1.25 : 1;
    add('hips', [{ k: 'cyl', s: [0.17, 0.25, 0.3], p: [0, -0.08, 0], seg: 8, c: rc }]);
    for (const s of ['L', 'R']) {
      const h = (d.thigh + 0.22) * long;
      add('hip' + s, [
        { k: 'box', s: [0.17, h, 0.035], p: [0, -h / 2 + 0.02, 0.085], c: rc },
        { k: 'box', s: [0.17, h, 0.035], p: [0, -h / 2 + 0.02, -0.085], c: rc },
        { k: 'box', s: [0.175, 0.035, 0.04], p: [0, -h + 0.03, 0.085], c: trim },
        { k: 'box', s: [0.175, 0.035, 0.04], p: [0, -h + 0.03, -0.085], c: trim },
      ]);
    }
  }
  // 무기 · 보조
  const wg = weaponGeo(L.weapon);
  if (wg) {
    out.push({ geo: wg.main, mat: (L.weapon && (L.weapon.look === 'staff' || L.weapon.look === 'wand')) ? 'std' : 'metal', joint: 'wR' });
    if (wg.glow) out.push({ geo: wg.glow, mat: 'glow', joint: 'wR' });
  }
  if (L.offhand) {
    const og = L.offhand.look === 'shield' ? shieldGeo(L.offhand) : L.offhand.look === 'orb' ? orbGeo(L.offhand) : null;
    if (og) {
      const joint = L.offhand.look === 'shield' ? 'elL' : 'wL';
      out.push({ geo: og.main, mat: L.offhand.look === 'shield' ? 'metal' : 'metal', joint, at: L.offhand.look === 'shield' ? [0, -d.fore * 0.55, 0.02] : [0, 0, 0] });
      if (og.glow) out.push({ geo: og.glow, mat: 'glow', joint, at: L.offhand.look === 'shield' ? [0, -d.fore * 0.55, 0.02] : [0, 0, 0] });
    }
  }
  // NPC 소품
  if (npc === 'npcSmith') add('wR', [
    { k: 'cyl', s: [0.02, 0.024, 0.42], p: [0, 0.12, 0], c: COL.wood },
    { k: 'box', s: [0.09, 0.09, 0.2], p: [0, 0.33, 0], c: COL.iron },
  ], 'metal');
  if (npc === 'npcMystic') {
    add('wL', [{ k: 'cyl', s: [0.022, 0.026, 1.55], p: [0, 0.3, 0], c: '#4a3a5a' }]);
    add('wL', [{ k: 'oct', s: [0.08], p: [0, 1.12, 0], sc: [1, 1.4, 1], c: '#c070ff' }], 'glow');
  }
  if (npc === 'npcGrocer') add('hips', [{ k: 'box', s: [0.1, 0.12, 0.06], p: [0.15, 0.0, 0.1], c: COL.leather }]);
  return out;
}

/** 플레이어 리그 치수(§9.5 · §9.6 — 키 1.8 · 어깨 폭 전사 0.52 · 마법사 0.48 · 발 사이 0.35) */
export const CHAR_DIMS = Object.freeze({
  warrior: { ankleY: 0.08, shin: 0.43, thigh: 0.43, hipX: 0.1, hipY: 0.92, footW: 0.175, torso: 0.56, shX: 0.195, shY: 0.5, shZ: 0, upper: 0.3, fore: 0.27, neck: 0.05, headZ: 0.01 },
  mage: { ankleY: 0.08, shin: 0.43, thigh: 0.43, hipX: 0.1, hipY: 0.92, footW: 0.175, torso: 0.55, shX: 0.182, shY: 0.49, shZ: 0, upper: 0.3, fore: 0.27, neck: 0.05, headZ: 0.01 },
  npcSmith: { ankleY: 0.08, shin: 0.42, thigh: 0.42, hipX: 0.11, hipY: 0.9, footW: 0.19, torso: 0.58, shX: 0.22, shY: 0.52, shZ: 0, upper: 0.31, fore: 0.28, neck: 0.04, headZ: 0.01 },
});
