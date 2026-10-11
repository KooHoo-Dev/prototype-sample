// OWNER: P2 — 계약 §7.6 (시드 — P0 이 W0 에 계약 값으로 채웠다 · 🔒 값은 혼자 바꾸지 않는다)
// 전투 · 상태 이상 · 줍기 · 사망 · 계측 · 위협 간격 · 선입력. 시간은 초 · 거리 m · 비율 0..1.

export const COMBAT = {
  armorK: 80, resK: 50,   // 🔒 §7.14
  drCap: 0.75, minTaken: 0.2, baseCrit: 0.05, baseCritDmg: 0.5, critCap: 0.75,
  cdrCap: 0.40, costCap: 0.40, moveCap: 0.25, blockReduce: 0.6, lohTargets: 5, lohTargetsTick: 2, lowLife: 0.35,
  vitLife: 0.012,         // 🔒 §7.14
  bigHitFrac: 0.25, hitstop: { sec: 0.05, gap: 0.4 }, launchSpeed: 7, dmgTakenCap: 0.5,
};

export const STATUS = {
  stunImmune: { normal: 0.5, champion: 1.5, elite: 2.0, minion: 1.0, guardian: 3.0, split: 0.5, spawn: 0.5 },
  chillSlow: 0.30, chillDecayDelay: 3.0, chillDecayPerSec: 20, freezeAt: 100, freezeSec: 1.5, freezeImmune: 2.5,
  burnSec: 3, burnTick: 0.5, shockTaken: 0.15, shockSec: 3, knockSec: 0.2, knockImmune: 1.0, flinchSec: 0.25, flinchImmune: 1.2, playerChill: 0.40,
};

export const POTION = { heal: 0.45, cd: 8 };
export const GLOBE = { heal: 0.20 };

export const PICKUP = {
  goldR: 2.5, potionR: 1.2, matR: 1.5, globeR: 1.2, itemReach: 1.0, interactReach: 0.8, validate: 1.5, validateH: 0.75, labelReach: 20, objectH: 2.5,
  scatterMin: 0.8, scatterMax: 2.2, scatterSep: 0.6, scatterTries: 8,
};

export const DEATH = { corpseSec: 6, calmSec: 1.0, protectSec: 1.5, panelDelay: 0.3 };
export const METER = { window: 150, killCap: 300, swarmOn: 25, swarmOff: 15 };
export const HAZARD = { packGap: 1.2, afterRoot: 0.8, nearR: 3.0, countR: 4.0, maxNear: 6, react: 0.25, slowSpeed: 3.6 };
export const BUFFER = { sec: 0.5, tail: 0.1 };

/** 균열 게이지 — 단위는 %(0..max). 등급 · 종류 배율은 RANKS · MONSTERS, 초반 배율은 RIFT.earlyGauge* */
export const GAUGE = { max: 100 };
