// OWNER: P6 — 계약 §7.10 · §7.11 (시드 — P0 이 W0 에 계약 값으로 채웠다 · 🔒 값은 혼자 바꾸지 않는다)
// 경제 · 경험치 · 시작 값. 골드 · 재료 · 가격 · 경험치는 정수(계산 끝에서 Math.round). 가격 식은 §7.10 표.

export const ECON = { potionMax: 10, scrollMax: 10, recordsMax: 200, buybackMax: 10 };
export const START = { gold: 0, potions: 5, scrolls: 3, riftUnlocked: 1, materials: { scrap: 0, dust: 0, essence: 0 } };
export const PRICES = { sellRate: 0.15, buyMul: { normal: 1.5, magic: 1.5, rare: 2.5 }, repairBase: 4.0, potion: 15, scroll: 10, resetPerLevel: 30 };   // 🔒 sellRate · buyMul · repairBase · potion
export const GAMBLE = { price: 110, slotRef: 15, mainHandValue: 24, rarity: { magic: 720, rare: 240, legendary: 30, set: 10 } };   // 🔒
export const REROLL = { gold: 90, growth: 1.5, cap: 8, dustBase: 1, dustCap: 5, essenceFrom: 3 };   // 🔒
export const CRAFT = { gold: 150, scrap: 20, dust: 10, essence: 0 };
export const SALVAGE = {
  normal: { scrap: 1 }, magic: { scrap: 1, dust: 1 }, rare: { scrap: 1, dust: 2 }, legendary: { dust: 2, essence: 1 }, set: { dust: 2, essence: 1 },
};
export const SHOP = { blacksmithStock: 9, generalStock: 4, stockRarity: { magic: 85, rare: 15 }, stockIlvlOffset: -1, generalSlots: { amulet: 1, ring: 3 } };

export const XP = {
  // W1 수정(NOTES-W1FIX): reqEarly [200, 500, 900] → [60, 300, 700] — 레벨 2 ≈ 일반 12처치(첫 팩 안에 첫 스킬) · 3 ≈ 72 · 4 ≈ 212
  base: 5, req: { a: 1100, g: 1.15 }, reqEarly: [60, 300, 700], completeBonus: 560,   // 🔒 §7.14
  diff: { penaltyFrom: 12, penaltyStep: 0.1, penaltyMin: 0.3, bonusStep: 0.1, bonusMax: 0.5 },
};

// ── P6 이 W1 에 더한 것(계약에 묶이지 않은 값 — P6 이 조정한다) ──

/** 부분 수리(§6.11 repairAll)에서 먼저 고치는 칸 — 나머지는 EQUIP_SLOTS 순서 */
export const REPAIR_ORDER = ['mainHand', 'chest', 'offhand'];

/** 개발용 캐릭터(makeDevCharacter · ?rift)의 장비 등급 가중치 — 마법 60% · 희귀 40%(§6.11) */
export const DEV = { gearRarity: { magic: 60, rare: 40 } };

/**
 * 파생 난수의 소금 — hash32(char.seed, …, 소금). stock = §6.11 재고(계약의 7) ·
 * reroll = 재굴림 후보(아이템 · 재굴림 횟수에 묶여 「취소 → 다시 굴리기」로 새 후보를 공짜로 보지 못한다 · NOTES-P6) · dev = 개발용 캐릭터 장비
 */
export const SEED_SALT = { stock: 7, reroll: 11, dev: 13 };
