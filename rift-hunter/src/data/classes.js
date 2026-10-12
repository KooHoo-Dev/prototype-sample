// OWNER: P1 — 계약 §7.1 (시드 — P0 이 W0 에 계약 값으로 채웠다 · 🔒 값은 혼자 바꾸지 않는다)
// 클래스 정의 · 플레이어 조작 상수. 이름 문면은 strings.ko.js 의 class.<id>.

/** @typedef {import('../types.js').ClassDef} ClassDef */

// §7.1 의 값 + (W1 P1 이 더한 것) recallSec 귀환 시전(§5.5) · noCursorDist 커서가 없을 때 목표 = facing 앞(§5.2-6) ·
//   failGapSec 같은 SKILL_FAIL 간격(§4.2) · shakeSec 스킬 흔들림 길이 · combatSec 분노 없는 클래스의 전투 표시(combatUntil) ·
//   shoveSide 앞을 막은 일반 몬스터를 옆으로 비키는 비율(밀고 빠져나가기 — §5.2-8)
export const PLAYER = { turnRate: 18, repathSec: 0.2, repathDist: 0.75, arriveR: 0.15, attackRepathDist: 1.0, standConeDeg: 70, reachTolerance: 0.3, shoveMul: 0.6, pushSec: 0.15,
  recallSec: 1.5, noCursorDist: 3, failGapSec: 0.5, shakeSec: 0.25, combatSec: 3, shoveSide: 0.6 };

/** §5.2-8 — 플레이어가 밀고 지나가는 몬스터 등급 · 막는 태그(그 밖의 등급 champion · elite · guardian 도 막는다) */
export const SHOVE = { ranks: ['normal', 'minion', 'split', 'spawn'], blockTags: ['structure'] };

/** @type {ClassDef[]} */
export const CLASSES = [
  {
    id: 'warrior', mainStat: 'str', resource: 'rage',
    life: { base: 120, growth: 1.09 },   // 🔒 §7.14
    resourceMax: { base: 100, perLevel: 1 }, regen: { base: 0, perLevel: 0 },
    // W1 수정(NOTES-W1FIX): onBasicHit 6 → 8 — 분노 흐름(지면 강타 빈도 · 클래스 차)
    rage: { onBasicHit: 8, perExtraTarget: 1, extraCap: 3, onHitTaken: 2, takenCapPerSec: 8, decayDelay: 3, decayPerSec: 5 },
    moveSpeed: 6, radius: 0.40, height: 1.8, basic: 'bash',
    startGear: [{ baseId: 'sword', tier: 0 }, { baseId: 'chest', tier: 0 }],
    mainHandBases: ['sword', 'axe', 'mace', 'greatsword', 'greataxe'], offhandBases: ['shield'],
  },
  {
    id: 'mage', mainStat: 'int', resource: 'mana',
    life: { base: 100, growth: 1.09 },    // 🔒 §7.14 · 밸런스 게이트: 90 → 100(몬스터 피해 × 7 뒤 마법사 첫 판 사망)
    resourceMax: { base: 100, perLevel: 2 }, regen: { base: 7, perLevel: 0.15 },
    rage: null,
    moveSpeed: 6, radius: 0.40, height: 1.8, basic: 'magicBolt',
    startGear: [{ baseId: 'wand', tier: 0 }, { baseId: 'chest', tier: 0 }],
    mainHandBases: ['wand', 'staff'], offhandBases: ['orb'],
  },
];
