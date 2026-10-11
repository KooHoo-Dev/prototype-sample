// OWNER: P15 — 계약 §7.13 · §12.1 (시드 — P0 이 W0 에 계약 값으로 채웠다)
// 봇 행동 수치. 시간은 초 · 거리 m · 비율 0..1. viewR 은 카메라(§9.3) · MON.threatRange 와 묶인 값이다.

export const BOT = {
  reactSec: 0.22, reactSd: 0.06, dodgeNotice: 0.9, missClick: 0.02, missOffset: 1.0, potionAt: 0.40, kiteFrom: 4.0, kiteCount: 3,
  lootRadius: 12, lootSafeR: 10, upMaxSec: 360, downDeaths: 2, potionsTo: 10, scrollsTo: 5, viewR: 11.4, equipMinGain: 0.005,
  priority: { fallenShaman: 5, boneNest: 4, elite: 3, champion: 2, normal: 1 }, chaseGiveUpSec: 6,
  townSec: { blacksmith: 20, general: 8, riftStone: 4 },
};
