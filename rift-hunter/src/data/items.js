// OWNER: P5 — 계약 §7.7 (시드 — P0 이 W0 에 계약 값으로 채웠다 · 🔒 값은 혼자 바꾸지 않는다)
// 아이템 기본형 · 단계 · 부위 가중치 · 맨손. 이름 문면은 strings.ko.js 의 base.<id>.<tier>.
// 무기 기본형은 피해 종류를 갖지 않는다(시트의 weapon.type = 클래스 기본 공격의 type — §5.6).

/** @typedef {import('../types.js').BaseDef} BaseDef */

export const ITEM = {
  baseVar: 0.10, durMax: 100, deathDurLoss: 10, ownClassChance: 0.85, otherClassLegend: 0.25, ownSetChance: 0.8,
  mainBias: 3, offMainBias: 0.3,
  /** 등급별 옵션 수 가중치 — 전설 = 행의 affixes 범위 · 세트 3~4 */
  affixCount: { normal: { 0: 1 }, magic: { 1: 50, 2: 50 }, rare: { 3: 30, 4: 35, 5: 25, 6: 10 } },
  maxPrefix: { normal: 0, magic: 1, rare: 3, legendary: 3, set: 3 },
  maxSuffix: { normal: 0, magic: 1, rare: 3, legendary: 3, set: 3 },
  /** 🔒 §7.14 — 주무기는 손 수로 mainHand1h · mainHand2h */
  slotValue: { mainHand1h: 20, mainHand2h: 30, offhand: 15, helm: 12, chest: 18, gloves: 10, boots: 10, belt: 8, amulet: 20, ring: 15 },
  /** 세트 옵션 수 범위(§5.13) */
  setAffixes: [3, 4],
  /** (P5 W1) 희귀 이름 조각 수 — strings.ko.js 의 rare.a.0..23 · rare.b.0..23(§5.13-4 「rng.int(0, 23)」) */
  rareNames: 24,
};

export const BASE_TIERS = [
  { minIlvl: 1, mul: 1.00, weight: 30 },
  { minIlvl: 10, mul: 1.06, weight: 50 },
  { minIlvl: 20, mul: 1.12, weight: 70 },
];

export const SLOT_WEIGHTS = { mainHand: 14, offhand: 8, helm: 10, chest: 10, gloves: 10, boots: 10, belt: 9, amulet: 7, ring: 12 };

export const FIST = {
  warrior: { dmg: [3, 7], aps: 1.40, type: 'phys' },
  mage: { dmg: [3, 6], aps: 1.40, type: 'lightning' },
};

/** 업그레이드 판정 · 봇 장착의 최소 powerScore 증가(0.5%) */
export const COMPARE = { minGain: 0.005 };

/** ilvl 1 · 단계 0 의 값 @type {BaseDef[]} */
export const BASES = [
  { id: 'sword', slot: 'mainHand', cls: 'warrior', hands: 1, dmg: [3, 7], aps: 1.40, weight: 25, look: 'sword' },
  { id: 'axe', slot: 'mainHand', cls: 'warrior', hands: 1, dmg: [3, 8], aps: 1.30, weight: 20, look: 'axe' },
  { id: 'mace', slot: 'mainHand', cls: 'warrior', hands: 1, dmg: [4, 8], aps: 1.20, weight: 20, look: 'mace' },
  { id: 'greatsword', slot: 'mainHand', cls: 'warrior', hands: 2, dmg: [5, 10], aps: 1.15, weight: 20, look: 'greatsword' },
  { id: 'greataxe', slot: 'mainHand', cls: 'warrior', hands: 2, dmg: [6, 11], aps: 1.05, weight: 15, look: 'greataxe' },
  { id: 'shield', slot: 'offhand', cls: 'warrior', armor: 10, block: 0.12, weight: 1, look: 'shield' },
  { id: 'wand', slot: 'mainHand', cls: 'mage', hands: 1, dmg: [3, 6], aps: 1.40, weight: 55, look: 'wand' },
  { id: 'staff', slot: 'mainHand', cls: 'mage', hands: 2, dmg: [6, 10], aps: 1.10, weight: 45, look: 'staff' },
  { id: 'orb', slot: 'offhand', cls: 'mage', bonus: [0, 2], mana: 10, weight: 1, look: 'orb' },
  { id: 'helm', slot: 'helm', cls: null, armor: 6, weight: 1, look: 'helm' },
  { id: 'chest', slot: 'chest', cls: null, armor: 12, weight: 1, look: 'chest' },
  { id: 'gloves', slot: 'gloves', cls: null, armor: 4, weight: 1, look: 'gloves' },
  { id: 'boots', slot: 'boots', cls: null, armor: 4, weight: 1, look: 'boots' },
  { id: 'belt', slot: 'belt', cls: null, armor: 3, weight: 1, look: 'belt' },
  { id: 'amulet', slot: 'amulet', cls: null, weight: 1, look: 'amulet' },
  { id: 'ring', slot: 'ring', cls: null, weight: 1, look: 'ring' },
];
