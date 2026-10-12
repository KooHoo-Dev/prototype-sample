// OWNER: P2 — 계약 §7.6 (시드 — P0 이 W0 에 계약 값으로 채웠다 · 🔒 값은 혼자 바꾸지 않는다)
// 전투 · 상태 이상 · 줍기 · 사망 · 계측 · 위협 간격 · 선입력. 시간은 초 · 거리 m · 비율 0..1.
// 계약 표에 없는 값(아래 「P2 W1」 표시)은 P2 가 로직의 숫자를 데이터로 모으려고 더한 것이다 — 계약 값은 그대로다.

export const COMBAT = {
  armorK: 80, resK: 50,   // 🔒 §7.14
  drCap: 0.75, minTaken: 0.2, baseCrit: 0.05, baseCritDmg: 0.5, critCap: 0.75,
  cdrCap: 0.40, costCap: 0.40, moveCap: 0.25, blockReduce: 0.6, lohTargets: 5, lohTargetsTick: 2, lowLife: 0.35,
  vitLife: 0.012,         // 🔒 §7.14
  bigHitFrac: 0.25, hitstop: { sec: 0.05, gap: 0.4 }, launchSpeed: 7, dmgTakenCap: 0.5,
  /** P2 W1 — 효과 판정이 내는 SHAKE 의 길이(초 · 진폭은 효과 spec.shake) */
  shakeSec: 0.3,
  /** 피드백 2 D8 — 지점 스킬(메테오 · 작은 메테오)의 목표가 벽(타일)에 가려지면 플레이어 → 목표 선 위의 마지막 보이는 바닥에서 이만큼(m) 이쪽으로 */
  sightBack: 0.3,
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
  /** P2 W1 — 마우스 판별의 드랍 상자(반지름 · 높이 m — §6.8 pickHover) */
  dropPickR: 0.45, dropPickH: 0.6,
};

// W1 수정(NOTES-W1FIX · §5.10): calmSec 1.0 → 0 — 사망한 그 틱에 깨어 있는 몬스터를 재운다(1초 뒤로 미루면 빠른 부활에서 진정이 복귀 뒤로 밀렸다).
//   부활로 균열을 떠날 때 잠든 몬스터는 처음 놓인 자리(rift.homes)로 돌아간다(rift.settleOnRespawn — 같은 떼가 안전 지점 앞에서 다시 깨지 않게).
export const DEATH = { corpseSec: 6, calmSec: 0, protectSec: 1.5, panelDelay: 0.3 };
export const METER = { window: 150, killCap: 300, swarmOn: 25, swarmOff: 15 };
export const HAZARD = { packGap: 1.2, afterRoot: 0.8, nearR: 3.0, countR: 4.0, maxNear: 6, react: 0.25, slowSpeed: 3.6 };
export const BUFFER = { sec: 0.5, tail: 0.1 };

/** 균열 게이지 — 단위는 %(0..max). 등급 · 종류 배율은 RANKS · MONSTERS, 초반 배율은 RIFT.earlyGauge* */
export const GAUGE = { max: 100 };

/**
 * P2 W1 — 조건부 패시브의 문턱(§5.7): rage50 = 분노 ≥ rageAt · lifeBelow35 = 생명 ≤ 최대 × lifeFrac ·
 * knockSec(피드백 2 D10 · Jay 결정 2026-10-12): targetDisabled 는 넉백이 끝난 뒤 이 초까지도 「무력화」로 센다(밀려나는 동안 포함 — 회전 베기 넉백으로 분쇄자가 켜진다)
 */
export const COND = { rageAt: 50, lifeFrac: 0.35, knockSec: 0.5 };

/** P2 W1 — 투사체 이동의 벽 검사 간격(m · 한 틱 이동을 이 길이 이하로 잘라 본다 — 얇은 소품을 뚫지 않게) */
export const PROJ = { step: 0.25 };

/** P2 W1 — 세션 명령의 한도: addPlaySec 한 번에 더하는 최대 초(§6.8 「0 ≤ sec ≤ 60」) */
export const SESSION = { maxPlaySecAdd: 60 };
