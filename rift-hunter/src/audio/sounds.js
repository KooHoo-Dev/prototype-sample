// OWNER: P14 — 계약 §9.9 · §9.11 (P14 내부 파일 — 다른 패키지는 import 하지 않는다)
// 합성 소리 표 · 믹스 손잡이. 외부 에셋 0 — 모든 소리는 아래 레시피를 AudioEngine 이 WebAudio 노드로 짓는다.
//
// 레시피 = { cat, bus, g, gap?, rp?, L:[층…] }
//   cat  CATS 키(종류별 발음 상한 · 우선순위) · bus 'sfx' | 'ui' | 'amb' · g 소리 전체 크기(0..1)
//   gap  같은 소리를 다시 내기까지의 최소 간격(초 · 없으면 VOICE.mergeSec — 그 안의 재발음은 합친다)
//   rp   발음마다 흔드는 음높이(반음 ±)
// 층 = { w, f?, d, a?, g, t?, flt?, vib? }
//   w    'sine' | 'square' | 'sawtooth' | 'triangle' | 'noise'(공유 백색 잡음 버퍼)
//   f    [시작 Hz, 끝 Hz?] — 끝이 있으면 d 동안 지수 활강(오실레이터만)
//   d    길이(초 — 시작에서 끝까지) · a 어택(초 · 기본 0.005) · g 층 크기 · t 시작 지연(초)
//   flt  [종류, 시작 Hz, 끝 Hz?, Q?] — BiquadFilter(lowpass · highpass · bandpass) · 끝이 있으면 활강
//   vib  [속도 Hz, 깊이 Hz] — 사인 LFO 가 오실레이터 주파수(잡음이면 필터 주파수)를 흔든다
// 음높이 배율(템플릿 · 치명타 · 피해 종류)은 오실레이터와 필터 주파수에 함께 곱한다.

/** 믹스 · 시간 손잡이(사람이 확인할 것 — docs/NOTES-P14.md 의 표 · 실측) */
export const MIX = {
  master: 0.9,          // 마스터 × 설정 volMaster
  ui: 0.8,              // UI 버스 = volSfx × 이것
  amb: 0.8,             // 환경 버스 = volAmbient × 이것
  limiter: { threshold: -10, ratio: 12, knee: 0, attack: 0.001, release: 0.2 },  // 계약 §9.11(threshold · ratio 고정) · 빠른 어택으로 순간 피크를 잡는다
  volSmooth: 0.03,      // 볼륨 바꿀 때 시간 상수(초)
  ambFade: 0.8,         // 환경음 교차 페이드(초)
  ambPauseDuck: 0.35,   // 메뉴 · 모달 일시정지 동안 환경음 배율(전투 지속음은 멈춘다)
  loopFade: 0.12,       // 회오리 · 귀환 시전이 멎을 때(초)
  stealFade: 0.03,      // 상한으로 밀려난 소리가 사라지는 길이(초)
  stopPad: 0.03,        // 소스 정지 여유(초)
  heartPeriod: 0.85,    // 낮은 생명 심장 박동 간격(초)
  resumeRetry: 1,       // 컨텍스트가 멈춰 있으면(숨김에서 돌아온 뒤 resume 거절 등) 이 간격(실제 초)으로 다시 깨운다
  critGain: 1.35, critPitch: 0.88, bigGain: 1.25,
  actEliteGain: 1.6,    // 챔피언 · 정예의 예고음(MON_ACT) 배율
  actGuardianGain: 1.9, actGuardianPitch: 0.7,
  dieEliteGain: 1.3, dieMinorGain: 0.8,
  shotPlayerGain: 1.15, shotMonGain: 0.9,
  hazardHitPlayerGain: 1.2,
};

/** 동시 발음 */
export const VOICE = {
  max: 32,              // 전체 동시 발음 상한(계약 §9.11)
  mergeSec: 0.03,       // 같은 소리 30ms 안 재발음은 합친다(계약 §9.11)
  mergeBoost: 1.08,     // 합칠 때마다 남은 소리 크기 ×
  mergeMax: 1.4,        // 합쳐서 커지는 상한(원래 크기 ×)
  // 몰림 줄이기 — burstWin 초 안에 burstFree 개를 넘게 시작하면 그 뒤 소리는 (burstFree / n)^burstExp 배(바닥 burstMin).
  // 우선순위 burstExemptPrio 이상(고유 예고 · 정예 경보 · 전설/세트 종 · 플레이어 사망 · 레벨업 등)은 줄이지 않는다 — 떼 속에서도 또렷하게.
  burstWin: 0.06, burstFree: 4, burstExp: 0.6, burstMin: 0.3, burstExemptPrio: 5,
};

/** 종류별 상한 · 우선순위(전체 상한에서 낮은 것부터 밀려난다) — 피격 6 · 사망 6 · 발사 6 · 예고 4(계약 §9.11) */
export const CATS = {
  hit: { cap: 6, prio: 2 },       // 몬스터 피격 · 상태(빙결 · 기절)
  death: { cap: 6, prio: 2 },     // 몬스터 사망
  shot: { cap: 6, prio: 1 },      // 발사
  warn: { cap: 4, prio: 3 },      // 몬스터 공격 예고(MON_ACT · 일반 바닥 표식)
  alarm: { cap: 4, prio: 5 },     // 정예 속성 고유 예고(감옥 · 몰타르 · 보호막 · 냉기 노바 …) · 게이지 · 정예 경보
  monAtk: { cap: 4, prio: 1 },    // 몬스터 휘두름 · 깨어남 · 생성
  skill: { cap: 6, prio: 4 },     // 플레이어 스킬
  player: { cap: 4, prio: 4 },    // 플레이어 피격 · 회복 · 포션 · 포털
  boom: { cap: 6, prio: 3 },      // 폭발 · 바닥 판정
  loot: { cap: 4, prio: 2 },      // 드랍 · 줍기
  jackpot: { cap: 2, prio: 5 },   // 전설 · 세트 종소리(드랍 폭발 속에서도 들린다)
  ui: { cap: 4, prio: 3 },        // 패널 · 거래 · 실패음
  sting: { cap: 3, prio: 5 },     // 레벨업 · 균열 열림 · 완료 · 붕괴 · 사망 · 수호자
};

/** 공간: 플레이어에서의 거리 → 크기 · 화면 좌우 → 팬(카메라 방위 π/4 고정 — 화면 오른쪽 = 월드 (1, 0, −1)/√2 · 계약 §0.2) */
export const SPACE = {
  near: 8,              // 이 안은 크기 1
  far: 32,              // 여기서 farGain
  farGain: 0.3,
  cull: 44,             // 이 밖의 낮은 우선순위 소리(prio < cullPrio)는 내지 않는다
  cullPrio: 3,
  panRange: 14,         // 화면 가로 이 거리(m)에서 팬 최대
  panMax: 0.6,
};

/** 몬스터 템플릿 → 피격 · 휘두름 · 예고음의 음높이 · 크기(§9.9 「템플릿별」) */
export const TEMPLATE_TONE = {
  humanoid: { p: 1.0, g: 1.0 },
  small: { p: 1.3, g: 0.85 },
  quadruped: { p: 0.8, g: 1.1 },
  blob: { p: 0.7, g: 1.0 },
  nest: { p: 1.1, g: 1.0 },
};

/** 피해 종류 → 타격 질감(§9.9 · 브리프 §5) */
export const HIT_BY_TYPE = { phys: 'hitPhys', fire: 'hitFire', cold: 'hitCold', lightning: 'hitLightning' };
/** 피해 종류 → 시전 시작음 음높이 */
export const TYPE_PITCH = { phys: 1.0, fire: 0.85, cold: 1.3, lightning: 1.12 };

/** 스킬 동작(SkillBehaviorId) → ACTION_START 소리(null = 없음 — 다른 이벤트 · 지속음이 맡는다) */
export const START_BY_BEHAVIOR = {
  meleeBasic: 'swing', cone: 'swing', quake: 'swing', dash: 'dash', spin: null, buff: null, leap: 'leapStart',
  boltBasic: 'castStart', fireball: 'castStart', meteor: 'castStart', nova: 'castStart', shield: 'castStart', chain: 'castStart', blink: null,
};
/** 스킬 동작 → ACTION_HIT(판정 틱) 소리 — 투사체 발사는 PROJ_SPAWN · 피격은 HIT 가 맡는다 */
export const HIT_BY_BEHAVIOR = {
  meleeBasic: null, cone: 'stomp', quake: 'quake', dash: null, spin: null, buff: 'warCry', leap: 'leapLand',
  boltBasic: null, fireball: null, meteor: 'meteorCall', nova: 'frostNova', shield: 'shieldUp', chain: 'chainZap', blink: 'blink',
};

/** MON_ACT telegraph → 예고음 · act 'swell'은 따로 */
export const ACT_BY_TELEGRAPH = { pose: 'windup', aimLine: 'bowDraw', groundLine: 'chargeWarn', groundCircle: 'groundWarn', glow: 'castCharge' };
export const ACT_SWELL = 'swell';

/** 템플릿 → 사망음 */
export const DIE_BY_TEMPLATE = { humanoid: 'dieHumanoid', small: 'dieSmall', quadruped: 'dieBeast', blob: 'dieBlob', nest: 'dieNest' };

/** AFFIX.what → 소리 — 감옥 · 몰타르 · 보호막 · 냉기 노바는 고유 예고음(계약 §4.2 · §9.9) */
export const AFFIX_SOUND = {
  jailWarn: 'jailWarn', mortarFire: 'mortarFire', shieldWarn: 'shieldWarn', novaWarn: 'novaWarn',
  plagueWarn: 'plagueWarn', fireArm: 'fireArm', teleportOut: 'teleportFx', teleportIn: 'teleportFx',
  shieldOn: 'shieldOn', shieldOff: 'shieldOff', split: 'splitFx', sparks: 'sparks', heal: 'vampHeal',
};
/** 고유 예고 넷(테스트가 서로 다른지 본다) */
export const UNIQUE_WARNS = ['jailWarn', 'mortarFire', 'shieldWarn', 'novaWarn'];

/** 적대 EFFECT_SPAWN kind → 예고음(같은 위협을 AFFIX 도 알리면 같은 소리 ID라 30ms 합치기로 한 번만 난다) */
export const EFFECT_WARN = {
  chargeLine: 'chargeWarn', bloaterBurst: 'swell', fireDeath: 'fireArm', coldNova: 'novaWarn', jail: 'jailWarn',
  plague: 'plagueWarn', mortar: 'mortarFire', slam: 'guardianWarn', boneSpikes: 'spikeWarn', emberRain: 'emberWarn',
  poisonPool: null, guardianSpawn: null,
};
/** 모르는 적대 바닥 표식의 예고음 */
export const EFFECT_WARN_DEFAULT = 'groundWarn';
/** EFFECT_HIT kind → 폭발 · 판정음(플레이어 · 적대 모두 · null = 없음) */
export const EFFECT_BOOM = {
  stomp: 'stomp', quakeWave: 'quakeBoom', shockwave: 'stomp', meteor: 'meteorImpact', vortex: null, afterimageBlast: 'zapBoom',
  corpseBlast: 'fireBoom', iceBurst: 'coldNovaBoom', chainArc: null, fireball: 'fireBoom', fireballSplit: 'fireBoom', iceShard: null,
  chargeLine: null, bloaterBurst: 'splatBoom', poisonPool: null, fireDeath: 'fireBoom', coldNova: 'coldNovaBoom',
  jail: 'jailSnap', plague: 'poisonHiss', mortar: 'mortarBoom', slam: 'bigSlam', boneSpikes: 'boneCrack', emberRain: 'fireBoom',
  guardianSpawn: null,
};
/** 모르는 적대 효과의 판정음 */
export const EFFECT_BOOM_HOSTILE_DEFAULT = 'mortarBoom';

/** 투사체 visual → 발사음 */
export const SHOT_BY_VISUAL = {
  magicBolt: 'boltShot', fireball: 'fireShot', fireballSplit: 'fireShot', iceShard: 'iceShot',
  arrow: 'arrowShot', shamanFire: 'shamanShot', spark: 'sparkShot', ashBolt: 'ashShot',
};
export const SHOT_DEFAULT = 'boltShot';

/** 드랍 */
export const DROP_BY_RARITY = { normal: 'dropItem', magic: 'dropMagic', rare: 'dropRare', legendary: 'dropLegendary', set: 'dropSet' };
export const DROP_BY_KIND = { gold: 'dropGold', potion: 'dropPotion', globe: 'dropGlobe', material: 'dropMat' };
export const PICK_BY_KIND = { gold: 'coins', item: 'pickItem', potion: 'pickPotion', material: 'pickMat', globe: null };

/** TRADE.kind → 소리 */
export const TRADE_SOUND = {
  buy: 'trade', sell: 'trade', sellMany: 'trade', buyback: 'trade', potion: 'trade', scroll: 'trade', free: 'trade',
  repair: 'repair', salvage: 'salvage', salvageMany: 'salvage', craft: 'craft', gamble: 'gamble', reroll: 'reroll', reset: 'reset',
};
export const TRADE_DEFAULT = 'trade';

/** MON_SPAWNED.reason → 소리 */
export const SPAWN_SOUND = { nest: 'spawnNest', revive: 'revive', split: 'splitSpawn', summon: 'summon', guardian: null, debug: null };

/** INTERACT.kind → 소리(npc 는 패널 열림음이 맡는다) */
export const INTERACT_SOUND = { npc: null, stash: 'stash', riftStone: 'riftStone', townPortal: 'portal', riftPortal: 'portal' };

/** SKILL_FAIL.reason → 실패음 음높이 */
export const FAIL_PITCH = { resource: 0.8, cooldown: 1.0, noTarget: 1.1, rooted: 0.9, town: 1.1, empty: 1.2 };

/** BAG.reason 중 UI 딸깍을 내는 것(나머지는 줍기 · 장착 · 거래 소리가 맡는다) */
export const BAG_CLICK = { move: true, sort: true, stash: true };

// ───────────────────────── 한 번 나는 소리 ─────────────────────────
const n = (d, flt, g = 1, t = 0, a = 0.003) => ({ w: 'noise', d, a, g, t, flt });

/** @type {Record<string, {cat:string, bus:string, g:number, gap?:number, rp?:number, L:Array<Object>}>} */
export const SOUNDS = {
  // ── 플레이어 스킬 ──
  swing: { cat: 'skill', bus: 'sfx', g: 0.58, rp: 2, L: [n(0.14, ['bandpass', 600, 2400, 1.2], 1, 0, 0.03)] },
  castStart: { cat: 'skill', bus: 'sfx', g: 0.24, rp: 1, L: [{ w: 'sine', f: [300, 700], d: 0.18, a: 0.05, g: 0.8 }, n(0.12, ['highpass', 3000], 0.3, 0, 0.03)] },
  dash: { cat: 'skill', bus: 'sfx', g: 0.45, L: [n(0.25, ['lowpass', 400, 2000, 0.8], 1, 0, 0.02), { w: 'sine', f: [90, 50], d: 0.2, g: 0.7 }] },
  stomp: { cat: 'skill', bus: 'sfx', g: 0.4, rp: 1, L: [{ w: 'sine', f: [120, 40], d: 0.35, a: 0.004, g: 1 }, n(0.3, ['lowpass', 900, 200], 0.6), n(0.06, ['bandpass', 2000, null, 1.5], 0.3)] },
  quake: { cat: 'skill', bus: 'sfx', g: 0.3, L: [{ w: 'sine', f: [60, 35], d: 0.9, a: 0.05, g: 1 }, n(0.9, ['lowpass', 250], 0.7, 0, 0.1)] },
  warCry: { cat: 'skill', bus: 'sfx', g: 1.0, L: [
    { w: 'sawtooth', f: [160, 210], d: 0.6, a: 0.04, g: 0.6, flt: ['bandpass', 700, null, 3], vib: [7, 6] },
    { w: 'sawtooth', f: [240, 315], d: 0.6, a: 0.04, g: 0.4, flt: ['bandpass', 1100, null, 4] }, n(0.3, ['bandpass', 1500], 0.2)] },
  leapStart: { cat: 'skill', bus: 'sfx', g: 0.3, L: [n(0.3, ['bandpass', 500, 1500, 1], 1, 0, 0.05)] },
  leapLand: { cat: 'skill', bus: 'sfx', g: 0.4, L: [{ w: 'sine', f: [100, 35], d: 0.4, a: 0.004, g: 1 }, n(0.35, ['lowpass', 700, 150], 0.7)] },
  meteorCall: { cat: 'skill', bus: 'sfx', g: 0.4, L: [{ w: 'sawtooth', f: [200, 80], d: 0.8, a: 0.05, g: 0.5, flt: ['lowpass', 1200, 300] }, n(1.0, ['bandpass', 800, 300, 1], 0.6, 0, 0.6)] },
  meteorImpact: { cat: 'boom', bus: 'sfx', g: 0.45, L: [{ w: 'sine', f: [70, 28], d: 0.9, a: 0.004, g: 1 }, n(0.8, ['lowpass', 1200, 120], 0.9), n(0.1, ['bandpass', 2500], 0.4)] },
  frostNova: { cat: 'skill', bus: 'sfx', g: 0.5, L: [n(0.4, ['highpass', 4000, 7000], 0.6, 0, 0.01), { w: 'sine', f: [1760, 2637], d: 0.35, g: 0.3 }, { w: 'triangle', f: [880, 440], d: 0.3, g: 0.3 }] },
  shieldUp: { cat: 'skill', bus: 'sfx', g: 0.4, L: [{ w: 'sine', f: [523], d: 0.7, g: 0.5, vib: [5, 4] }, { w: 'sine', f: [784], d: 0.7, t: 0.05, g: 0.4 }, { w: 'sine', f: [1046], d: 0.8, t: 0.1, g: 0.3 }] },
  chainZap: { cat: 'skill', bus: 'sfx', g: 0.45, L: [{ w: 'square', f: [1200, 300], d: 0.18, g: 0.6, flt: ['bandpass', 2500, null, 2], vib: [60, 400] }, n(0.2, ['highpass', 3000], 0.5)] },
  blink: { cat: 'skill', bus: 'sfx', g: 0.4, L: [{ w: 'sine', f: [400, 2000], d: 0.15, g: 0.6 }, { w: 'sine', f: [2000, 600], d: 0.15, t: 0.12, g: 0.4 }] },
  zapBoom: { cat: 'boom', bus: 'sfx', g: 0.5, L: [{ w: 'square', f: [800, 150], d: 0.25, g: 0.6, flt: ['bandpass', 1500], vib: [70, 300] }, n(0.2, ['highpass', 2500], 0.5), { w: 'sine', f: [100, 50], d: 0.2, g: 0.5 }] },
  quakeBoom: { cat: 'boom', bus: 'sfx', g: 0.33, rp: 1, L: [{ w: 'sine', f: [80, 35], d: 0.45, a: 0.005, g: 1 }, n(0.4, ['lowpass', 500, 150], 0.6)] },

  // ── 플레이어 상태 · 생존 ──
  recallFizzle: { cat: 'player', bus: 'sfx', g: 0.4, L: [{ w: 'triangle', f: [600, 150], d: 0.3, g: 0.6 }, n(0.2, ['highpass', 2000], 0.3)] },
  portal: { cat: 'player', bus: 'sfx', g: 0.5, gap: 0.3, L: [n(0.7, ['bandpass', 300, 1800, 2], 0.7, 0, 0.3), { w: 'sine', f: [220, 440], d: 0.7, a: 0.3, g: 0.4, vib: [6, 10] }] },
  portalOpen: { cat: 'player', bus: 'sfx', g: 0.45, gap: 0.3, L: [n(0.9, ['bandpass', 1800, 400, 2], 0.7, 0, 0.2), { w: 'sine', f: [330, 165], d: 0.9, a: 0.2, g: 0.35, vib: [5, 8] }] },
  respawn: { cat: 'player', bus: 'sfx', g: 0.28, L: [{ w: 'sine', f: [262, 523], d: 0.6, a: 0.2, g: 0.6 }, { w: 'sine', f: [392, 784], d: 0.6, t: 0.1, a: 0.2, g: 0.4 }] },
  potion: { cat: 'player', bus: 'sfx', g: 0.45, L: [
    { w: 'sine', f: [300, 500], d: 0.09, g: 0.6 }, { w: 'sine', f: [320, 540], d: 0.09, t: 0.11, g: 0.6 },
    { w: 'sine', f: [340, 600], d: 0.1, t: 0.22, g: 0.5 }, n(0.3, ['lowpass', 600], 0.15)] },
  globe: { cat: 'player', bus: 'sfx', g: 0.4, L: [{ w: 'sine', f: [660], d: 0.25, g: 0.6 }, { w: 'sine', f: [880], d: 0.25, t: 0.06, g: 0.5 }, { w: 'sine', f: [1320], d: 0.35, t: 0.12, g: 0.4 }] },
  heal: { cat: 'player', bus: 'sfx', g: 0.3, gap: 0.3, L: [{ w: 'sine', f: [523, 659], d: 0.4, a: 0.05, g: 0.6 }] },
  playerHit: { cat: 'player', bus: 'sfx', g: 0.4, gap: 0.15, rp: 1, L: [{ w: 'sine', f: [180, 70], d: 0.15, g: 0.9 }, n(0.12, ['lowpass', 1500, 400], 0.6)] },
  block: { cat: 'player', bus: 'sfx', g: 0.45, gap: 0.05, L: [{ w: 'triangle', f: [900], d: 0.15, g: 0.6 }, n(0.06, ['bandpass', 3000, null, 2], 0.5)] },
  shieldAbsorb: { cat: 'player', bus: 'sfx', g: 0.35, gap: 0.06, L: [{ w: 'sine', f: [1200, 900], d: 0.15, g: 0.6, vib: [30, 40] }] },
  shieldBreak: { cat: 'player', bus: 'sfx', g: 0.6, L: [n(0.4, ['highpass', 3500], 0.7), { w: 'sine', f: [2400, 1200], d: 0.3, g: 0.4 }, { w: 'sine', f: [3100, 1500], d: 0.25, g: 0.3 }] },
  rooted: { cat: 'player', bus: 'sfx', g: 0.55, L: [{ w: 'square', f: [220], d: 0.25, g: 0.5, flt: ['bandpass', 1800, null, 6] }, n(0.1, ['bandpass', 4000, null, 4], 0.6), n(0.1, ['bandpass', 4000, null, 4], 0.5, 0.07)] },
  chilled: { cat: 'player', bus: 'sfx', g: 0.35, gap: 0.3, L: [n(0.3, ['highpass', 5000], 0.6, 0, 0.03), { w: 'sine', f: [2000, 1500], d: 0.25, g: 0.2 }] },
  heartbeat: { cat: 'player', bus: 'sfx', g: 0.33, L: [{ w: 'sine', f: [60, 45], d: 0.12, g: 1 }, { w: 'sine', f: [55, 40], d: 0.14, t: 0.18, g: 0.8 }] },
  buffEnd: { cat: 'player', bus: 'sfx', g: 0.25, L: [{ w: 'sine', f: [784, 523], d: 0.3, g: 0.6 }] },
  fail: { cat: 'ui', bus: 'ui', g: 0.3, gap: 0.15, L: [{ w: 'square', f: [140], d: 0.06, g: 0.6, flt: ['lowpass', 800] }, n(0.03, ['bandpass', 1200], 0.3)] },

  // ── 몬스터 피격(피해 종류마다 질감) · 상태 ──
  hitPhys: { cat: 'hit', bus: 'sfx', g: 0.34, rp: 2, L: [n(0.08, ['lowpass', 2500, 500], 0.7), { w: 'sine', f: [160, 70], d: 0.1, g: 0.8 }] },
  hitFire: { cat: 'hit', bus: 'sfx', g: 0.48, rp: 2, L: [n(0.14, ['bandpass', 1500, 700, 0.8], 0.8), { w: 'sine', f: [120, 60], d: 0.1, g: 0.5 }, n(0.05, ['highpass', 4000], 0.3)] },
  hitCold: { cat: 'hit', bus: 'sfx', g: 0.44, rp: 2, L: [{ w: 'sine', f: [2400, 1800], d: 0.12, g: 0.5 }, n(0.08, ['highpass', 5000], 0.5), { w: 'sine', f: [150, 80], d: 0.08, g: 0.4 }] },
  hitLightning: { cat: 'hit', bus: 'sfx', g: 0.9, rp: 2, L: [{ w: 'square', f: [900, 200], d: 0.08, g: 0.6, flt: ['bandpass', 2000, null, 1.5], vib: [80, 300] }, n(0.06, ['highpass', 3000], 0.4)] },
  immune: { cat: 'hit', bus: 'sfx', g: 0.3, gap: 0.1, L: [{ w: 'sine', f: [2500], d: 0.12, g: 0.5 }, { w: 'sine', f: [3150], d: 0.1, g: 0.3 }] },
  blockMon: { cat: 'hit', bus: 'sfx', g: 0.35, gap: 0.05, L: [{ w: 'triangle', f: [700, 600], d: 0.12, g: 0.6 }, n(0.05, ['bandpass', 2500], 0.4)] },
  freeze: { cat: 'hit', bus: 'sfx', g: 0.35, gap: 0.08, L: [n(0.25, ['highpass', 6000], 0.6, 0, 0.02), { w: 'sine', f: [3000, 2600], d: 0.2, g: 0.25 }] },
  iceBreak: { cat: 'hit', bus: 'sfx', g: 0.35, gap: 0.08, L: [n(0.15, ['highpass', 3000], 0.7), { w: 'sine', f: [2200, 1100], d: 0.1, t: 0.02, g: 0.3 }, { w: 'triangle', f: [1500], d: 0.05, t: 0.05, g: 0.3 }] },
  stun: { cat: 'hit', bus: 'sfx', g: 0.2, gap: 0.12, L: [{ w: 'sine', f: [1400], d: 0.1, g: 0.5, vib: [25, 100] }, { w: 'sine', f: [1800], d: 0.1, t: 0.08, g: 0.4 }] },
  sparks: { cat: 'hit', bus: 'sfx', g: 0.35, gap: 0.08, L: [{ w: 'square', f: [2000, 600], d: 0.12, g: 0.4, flt: ['highpass', 1500], vib: [90, 500] }, n(0.1, ['highpass', 4000], 0.5, 0.03)] },

  // ── 몬스터 공격 · 예고 ──
  monSwing: { cat: 'monAtk', bus: 'sfx', g: 0.28, rp: 3, L: [n(0.12, ['bandpass', 500, 1500, 1], 1, 0, 0.03)] },
  wakeGrowl: { cat: 'monAtk', bus: 'sfx', g: 0.25, gap: 0.25, rp: 2, L: [{ w: 'sawtooth', f: [90, 70], d: 0.5, a: 0.08, g: 0.6, flt: ['lowpass', 400], vib: [11, 5] }, n(0.4, ['lowpass', 300], 0.3, 0, 0.05)] },
  spawnNest: { cat: 'monAtk', bus: 'sfx', g: 0.3, gap: 0.15, L: [n(0.25, ['lowpass', 700, 300], 0.8), { w: 'sine', f: [300, 150], d: 0.2, g: 0.4 }] },
  splitSpawn: { cat: 'monAtk', bus: 'sfx', g: 0.35, L: [n(0.2, ['lowpass', 1200, 300], 0.8), { w: 'sine', f: [400, 200], d: 0.12, t: 0.05, g: 0.5 }] },
  windup: { cat: 'warn', bus: 'sfx', g: 0.42, rp: 2, L: [n(0.2, ['bandpass', 300, 700, 1.5], 1, 0, 0.12)] },
  bowDraw: { cat: 'warn', bus: 'sfx', g: 0.55, rp: 1, L: [{ w: 'triangle', f: [220, 330], d: 0.35, a: 0.25, g: 0.7, flt: ['bandpass', 900, null, 4], vib: [18, 6] }] },
  chargeWarn: { cat: 'warn', bus: 'sfx', g: 0.35, L: [{ w: 'sawtooth', f: [90, 140], d: 0.5, a: 0.1, g: 0.5, flt: ['lowpass', 500] }, n(0.15, ['lowpass', 300], 0.6), n(0.15, ['lowpass', 300], 0.6, 0.2)] },
  groundWarn: { cat: 'warn', bus: 'sfx', g: 0.18, L: [{ w: 'sine', f: [200, 400], d: 0.5, a: 0.4, g: 0.6, vib: [8, 12] }, n(0.5, ['bandpass', 600], 0.3, 0, 0.4)] },
  castCharge: { cat: 'warn', bus: 'sfx', g: 0.12, L: [{ w: 'sine', f: [300, 900], d: 0.5, a: 0.4, g: 0.6 }, { w: 'triangle', f: [450, 1350], d: 0.5, a: 0.4, g: 0.4, vib: [9, 15] }] },
  swell: { cat: 'warn', bus: 'sfx', g: 0.4, L: [{ w: 'sawtooth', f: [60, 160], d: 0.8, a: 0.7, g: 0.5, flt: ['lowpass', 300, 900] }, n(0.8, ['lowpass', 400], 0.4, 0, 0.7)] },
  revive: { cat: 'warn', bus: 'sfx', g: 0.35, gap: 0.2, L: [{ w: 'sine', f: [220, 660], d: 0.6, a: 0.3, g: 0.6, vib: [6, 10] }, n(0.6, ['bandpass', 1000, 3000], 0.3, 0, 0.4)] },
  summon: { cat: 'warn', bus: 'sfx', g: 0.3, gap: 0.2, L: [{ w: 'sine', f: [150, 450], d: 0.5, a: 0.3, g: 0.6 }, n(0.5, ['lowpass', 600], 0.4, 0, 0.3)] },
  eliteAlarm: { cat: 'alarm', bus: 'sfx', g: 0.45, gap: 0.4, L: [
    { w: 'sawtooth', f: [233], d: 0.35, a: 0.02, g: 0.5, flt: ['lowpass', 1400] }, { w: 'sawtooth', f: [311], d: 0.5, t: 0.25, a: 0.02, g: 0.5, flt: ['lowpass', 1400] },
    { w: 'sine', f: [117], d: 0.8, g: 0.4 }] },
  guardianWarn: { cat: 'alarm', bus: 'sfx', g: 0.2, L: [{ w: 'sine', f: [50, 80], d: 0.9, a: 0.7, g: 1 }, n(0.9, ['lowpass', 300, 600], 0.6, 0, 0.7), { w: 'sawtooth', f: [70], d: 0.9, a: 0.7, g: 0.3, flt: ['lowpass', 250] }] },
  spikeWarn: { cat: 'alarm', bus: 'sfx', g: 0.45, L: [n(0.7, ['bandpass', 2000, 4000, 2], 0.7, 0, 0.5), { w: 'triangle', f: [300, 600], d: 0.7, a: 0.5, g: 0.3 }] },
  emberWarn: { cat: 'alarm', bus: 'sfx', g: 0.4, L: [n(1.0, ['bandpass', 1200, null, 1], 0.7, 0, 0.6), { w: 'sine', f: [400, 200], d: 1.0, a: 0.6, g: 0.3 }] },

  // ── 정예 속성 — 고유 예고 넷(서로 다른 음색: 쇠사슬 딸깍 연타 · 발사 쿵 + 내려가는 휘파람 · 올라가는 금빛 아르페지오 · 얼음 쉬익 크레셴도) ──
  jailWarn: { cat: 'alarm', bus: 'sfx', g: 0.9, gap: 0.2, L: [
    n(0.05, ['bandpass', 4500, null, 6], 0.7, 0), n(0.05, ['bandpass', 4200, null, 6], 0.6, 0.08), n(0.05, ['bandpass', 4600, null, 6], 0.7, 0.16),
    n(0.05, ['bandpass', 4300, null, 6], 0.6, 0.24), n(0.05, ['bandpass', 4500, null, 6], 0.7, 0.32),
    { w: 'square', f: [330], d: 0.6, g: 0.35, flt: ['bandpass', 1700, null, 8], vib: [28, 25] }, { w: 'triangle', f: [110], d: 0.8, a: 0.05, g: 0.3 }] },
  mortarFire: { cat: 'alarm', bus: 'sfx', g: 0.5, gap: 0.15, L: [
    { w: 'sine', f: [90, 40], d: 0.18, g: 1 }, n(0.12, ['lowpass', 800], 0.5), { w: 'sine', f: [1900, 650], d: 1.15, t: 0.05, a: 0.1, g: 0.35 }] },
  shieldWarn: { cat: 'alarm', bus: 'sfx', g: 0.6, gap: 0.2, L: [
    { w: 'triangle', f: [1046], d: 0.25, g: 0.6 }, { w: 'triangle', f: [1318], d: 0.25, t: 0.07, g: 0.6 }, { w: 'triangle', f: [1568], d: 0.25, t: 0.14, g: 0.6 },
    { w: 'triangle', f: [2093], d: 0.4, t: 0.21, g: 0.6 }, { w: 'sine', f: [4186], d: 0.5, a: 0.2, g: 0.15, vib: [12, 60] }] },
  novaWarn: { cat: 'alarm', bus: 'sfx', g: 0.38, gap: 0.2, L: [
    n(1.0, ['highpass', 5000, 8000], 0.6, 0, 0.85), { w: 'triangle', f: [700, 2100], d: 1.0, a: 0.85, g: 0.35 }, { w: 'sine', f: [2637], d: 1.0, a: 0.9, g: 0.2, vib: [16, 40] }] },
  plagueWarn: { cat: 'alarm', bus: 'sfx', g: 1.0, gap: 0.2, L: [
    { w: 'sine', f: [200, 260], d: 0.08, g: 0.4 }, { w: 'sine', f: [180, 240], d: 0.08, t: 0.15, g: 0.4 }, { w: 'sine', f: [210, 280], d: 0.08, t: 0.3, g: 0.4 },
    { w: 'sine', f: [190, 250], d: 0.08, t: 0.45, g: 0.4 }, n(0.9, ['lowpass', 500], 0.3, 0, 0.6)] },
  fireArm: { cat: 'alarm', bus: 'sfx', g: 0.4, gap: 0.2, L: [n(0.6, ['bandpass', 800, 2500, 1], 0.6, 0, 0.5), { w: 'sine', f: [150, 300], d: 0.6, a: 0.5, g: 0.4 }] },
  shieldOn: { cat: 'warn', bus: 'sfx', g: 0.3, gap: 0.2, L: [{ w: 'sine', f: [523], d: 0.6, a: 0.05, g: 0.6, vib: [5, 5] }, { w: 'sine', f: [1046], d: 0.6, g: 0.4 }] },
  shieldOff: { cat: 'warn', bus: 'sfx', g: 0.3, gap: 0.2, L: [{ w: 'sine', f: [1046, 523], d: 0.25, g: 0.6 }] },
  teleportFx: { cat: 'warn', bus: 'sfx', g: 0.3, gap: 0.08, L: [{ w: 'sine', f: [1500, 300], d: 0.18, g: 0.6, vib: [40, 200] }, n(0.1, ['highpass', 3000], 0.4)] },
  splitFx: { cat: 'death', bus: 'sfx', g: 0.35, L: [n(0.25, ['lowpass', 1500, 300], 0.8), { w: 'sine', f: [300, 120], d: 0.2, g: 0.5 }] },
  vampHeal: { cat: 'warn', bus: 'sfx', g: 0.2, gap: 0.3, L: [{ w: 'sine', f: [300, 200], d: 0.3, a: 0.05, g: 0.6, vib: [6, 8] }] },

  // ── 폭발 · 바닥 판정 ──
  jailSnap: { cat: 'boom', bus: 'sfx', g: 0.6, L: [{ w: 'square', f: [180], d: 0.3, g: 0.5, flt: ['bandpass', 2200, null, 5] }, n(0.1, ['bandpass', 3500, null, 3], 0.6), { w: 'sine', f: [90], d: 0.3, g: 0.5 }] },
  mortarBoom: { cat: 'boom', bus: 'sfx', g: 0.4, rp: 1, L: [{ w: 'sine', f: [90, 35], d: 0.4, g: 1 }, n(0.35, ['lowpass', 1500, 200], 0.8)] },
  coldNovaBoom: { cat: 'boom', bus: 'sfx', g: 0.55, L: [n(0.4, ['highpass', 2500, 6000], 0.7), { w: 'sine', f: [1200, 300], d: 0.3, g: 0.4 }, { w: 'sine', f: [120, 60], d: 0.25, g: 0.5 }] },
  fireBoom: { cat: 'boom', bus: 'sfx', g: 0.45, rp: 1, L: [n(0.45, ['lowpass', 2500, 300], 0.9), { w: 'sine', f: [110, 45], d: 0.35, g: 0.8 }, n(0.15, ['highpass', 3000], 0.3)] },
  splatBoom: { cat: 'boom', bus: 'sfx', g: 0.38, L: [n(0.4, ['lowpass', 1200, 200], 0.9), { w: 'sine', f: [160, 50], d: 0.3, g: 0.7 }] },
  poisonHiss: { cat: 'boom', bus: 'sfx', g: 0.4, gap: 0.1, L: [n(0.5, ['bandpass', 2500, null, 1], 0.5, 0, 0.05), n(0.3, ['lowpass', 400], 0.4)] },
  bigSlam: { cat: 'boom', bus: 'sfx', g: 0.45, L: [{ w: 'sine', f: [70, 25], d: 0.8, g: 1 }, n(0.7, ['lowpass', 900, 100], 0.9), n(0.08, ['bandpass', 1800], 0.4)] },
  boneCrack: { cat: 'boom', bus: 'sfx', g: 0.55, L: [n(0.05, ['bandpass', 2200, null, 3], 0.7), n(0.05, ['bandpass', 2600, null, 3], 0.6, 0.05), n(0.05, ['bandpass', 2000, null, 3], 0.7, 0.1), { w: 'sine', f: [200, 80], d: 0.2, g: 0.5 }] },
  eliteDie: { cat: 'boom', bus: 'sfx', g: 0.3, L: [{ w: 'sine', f: [80, 30], d: 0.7, g: 0.9 }, n(0.5, ['lowpass', 600], 0.6)] },

  // ── 발사 ──
  boltShot: { cat: 'shot', bus: 'sfx', g: 0.22, rp: 2, L: [{ w: 'sine', f: [900, 1800], d: 0.1, g: 0.6 }, { w: 'square', f: [1800, 900], d: 0.06, g: 0.2, flt: ['highpass', 2000] }] },
  fireShot: { cat: 'shot', bus: 'sfx', g: 0.35, rp: 1, L: [n(0.25, ['bandpass', 600, 1800, 1], 0.8, 0, 0.03), { w: 'sine', f: [200, 120], d: 0.2, g: 0.4 }] },
  iceShot: { cat: 'shot', bus: 'sfx', g: 0.2, rp: 3, L: [{ w: 'sine', f: [3000, 2200], d: 0.08, g: 0.6 }, n(0.05, ['highpass', 6000], 0.4)] },
  arrowShot: { cat: 'shot', bus: 'sfx', g: 0.25, rp: 2, L: [{ w: 'triangle', f: [420, 260], d: 0.12, g: 0.5, flt: ['lowpass', 2000] }, n(0.12, ['bandpass', 3000, 1500, 2], 0.3)] },
  shamanShot: { cat: 'shot', bus: 'sfx', g: 0.35, rp: 2, L: [n(0.2, ['bandpass', 900, 1500, 1], 0.7), { w: 'sine', f: [300, 500], d: 0.15, g: 0.3 }] },
  sparkShot: { cat: 'shot', bus: 'sfx', g: 0.2, rp: 3, L: [{ w: 'square', f: [2500, 800], d: 0.08, g: 0.4, flt: ['highpass', 1200] }] },
  ashShot: { cat: 'shot', bus: 'sfx', g: 0.42, rp: 1, L: [n(0.25, ['bandpass', 500, 1200, 1], 0.7), { w: 'sawtooth', f: [140, 100], d: 0.2, g: 0.3, flt: ['lowpass', 600] }] },
  projWall: { cat: 'shot', bus: 'sfx', g: 0.15, gap: 0.05, rp: 2, L: [n(0.05, ['bandpass', 1500], 0.6), { w: 'sine', f: [300, 200], d: 0.04, g: 0.4 }] },

  // ── 몬스터 사망(템플릿별) ──
  dieHumanoid: { cat: 'death', bus: 'sfx', g: 0.7, rp: 2, L: [
    n(0.05, ['bandpass', 1800, null, 3], 0.5), n(0.05, ['bandpass', 2100, null, 3], 0.45, 0.06), n(0.05, ['bandpass', 1600, null, 3], 0.4, 0.13),
    { w: 'sawtooth', f: [140, 70], d: 0.35, a: 0.01, g: 0.35, flt: ['lowpass', 600] }] },
  dieSmall: { cat: 'death', bus: 'sfx', g: 0.42, rp: 3, L: [{ w: 'square', f: [900, 300], d: 0.15, g: 0.4, flt: ['lowpass', 2000] }, n(0.08, ['lowpass', 1500], 0.4)] },
  dieBeast: { cat: 'death', bus: 'sfx', g: 0.22, rp: 2, L: [{ w: 'sine', f: [110, 45], d: 0.4, g: 0.9 }, { w: 'sawtooth', f: [180, 90], d: 0.3, g: 0.4, flt: ['lowpass', 700] }] },
  dieBlob: { cat: 'death', bus: 'sfx', g: 0.36, rp: 2, L: [n(0.35, ['lowpass', 900, 200], 0.8), { w: 'sine', f: [200, 60], d: 0.25, g: 0.6 }] },
  dieNest: { cat: 'death', bus: 'sfx', g: 0.95, L: [n(0.6, ['bandpass', 1200, 400, 1], 0.7), n(0.05, ['bandpass', 2500, null, 3], 0.4, 0.1), n(0.05, ['bandpass', 2500, null, 3], 0.4, 0.25)] },
  guardianDie: { cat: 'sting', bus: 'sfx', g: 0.36, L: [{ w: 'sine', f: [60, 22], d: 2.0, g: 1 }, n(1.8, ['lowpass', 800, 80], 0.8), { w: 'sawtooth', f: [110, 40], d: 1.6, g: 0.4, flt: ['lowpass', 600] }] },

  // ── 드랍 · 줍기(전설 · 세트는 고유 종소리) ──
  dropItem: { cat: 'loot', bus: 'sfx', g: 0.25, rp: 2, L: [{ w: 'triangle', f: [1200], d: 0.08, g: 0.6 }, n(0.04, ['bandpass', 2500], 0.3)] },
  dropMagic: { cat: 'loot', bus: 'sfx', g: 0.3, L: [{ w: 'sine', f: [1568], d: 0.25, g: 0.6 }, { w: 'sine', f: [2093], d: 0.2, t: 0.03, g: 0.4 }] },
  dropRare: { cat: 'loot', bus: 'sfx', g: 0.4, L: [{ w: 'sine', f: [1318], d: 0.4, g: 0.6 }, { w: 'sine', f: [1760], d: 0.5, t: 0.09, g: 0.6 }, { w: 'sine', f: [2637], d: 0.4, t: 0.09, g: 0.25 }] },
  // 전설 — 비화성 종(분음 1 · 2.76 · 5.40 · 8.93) 두 번 + 낮은 징
  dropLegendary: { cat: 'jackpot', bus: 'sfx', g: 0.28, gap: 0.25, L: [
    n(0.03, ['bandpass', 3000, null, 2], 0.3), { w: 'sine', f: [523], d: 3.0, g: 1 }, { w: 'sine', f: [1443], d: 2.2, g: 0.5 },
    { w: 'sine', f: [2824], d: 1.4, g: 0.3 }, { w: 'sine', f: [4670], d: 0.9, g: 0.2 }, { w: 'sine', f: [261], d: 3.2, a: 0.02, g: 0.6 },
    { w: 'sine', f: [784], d: 2.5, t: 0.35, g: 0.7 }, { w: 'sine', f: [2164], d: 1.6, t: 0.35, g: 0.3 }] },
  // 세트 — 올라가는 장3화음 + 옥타브 종 · 반짝임
  dropSet: { cat: 'jackpot', bus: 'sfx', g: 0.3, gap: 0.25, L: [
    { w: 'sine', f: [587], d: 2.6, g: 0.9 }, { w: 'sine', f: [740], d: 2.4, t: 0.12, g: 0.7 }, { w: 'sine', f: [880], d: 2.4, t: 0.24, g: 0.7 },
    { w: 'sine', f: [1175], d: 2.2, t: 0.36, g: 0.6 }, { w: 'triangle', f: [2349], d: 2.0, t: 0.36, g: 0.2, vib: [5, 8] }] },
  dropGold: { cat: 'loot', bus: 'sfx', g: 0.2, rp: 3, L: [{ w: 'sine', f: [2637], d: 0.07, g: 0.6 }, { w: 'sine', f: [3520], d: 0.06, t: 0.04, g: 0.4 }] },
  dropPotion: { cat: 'loot', bus: 'sfx', g: 0.2, rp: 2, L: [{ w: 'sine', f: [1000, 1200], d: 0.1, g: 0.6 }, n(0.03, ['highpass', 4000], 0.3)] },
  dropGlobe: { cat: 'loot', bus: 'sfx', g: 0.2, rp: 2, L: [{ w: 'sine', f: [500, 700], d: 0.15, g: 0.6 }] },
  dropMat: { cat: 'loot', bus: 'sfx', g: 0.2, rp: 2, L: [{ w: 'triangle', f: [700], d: 0.08, g: 0.6 }, n(0.04, ['bandpass', 1800], 0.3)] },
  // 골드 줍기 — 짤랑(높은 사인 넷이 엇갈려 부딪힌다)
  coins: { cat: 'loot', bus: 'sfx', g: 0.4, gap: 0.04, rp: 2, L: [
    { w: 'sine', f: [3136], d: 0.12, g: 0.6 }, { w: 'sine', f: [2637], d: 0.14, t: 0.035, g: 0.5 }, { w: 'sine', f: [3951], d: 0.1, t: 0.07, g: 0.4 },
    { w: 'sine', f: [2349], d: 0.16, t: 0.1, g: 0.45 }, n(0.04, ['highpass', 6000], 0.3), n(0.04, ['highpass', 6000], 0.25, 0.07)] },
  pickItem: { cat: 'loot', bus: 'sfx', g: 0.3, L: [n(0.08, ['lowpass', 1500], 0.6), { w: 'triangle', f: [400, 300], d: 0.08, g: 0.4 }] },
  pickPotion: { cat: 'loot', bus: 'sfx', g: 0.3, L: [{ w: 'sine', f: [900, 1300], d: 0.1, g: 0.6 }, n(0.05, ['highpass', 3000], 0.3)] },
  pickMat: { cat: 'loot', bus: 'sfx', g: 0.25, L: [{ w: 'triangle', f: [600], d: 0.06, g: 0.6 }, { w: 'triangle', f: [900], d: 0.06, t: 0.05, g: 0.5 }] },

  // ── UI · 거래 ──
  uiOpen: { cat: 'ui', bus: 'ui', g: 0.25, gap: 0.05, L: [{ w: 'sine', f: [660, 880], d: 0.08, g: 0.6 }, n(0.05, ['bandpass', 2500], 0.3)] },
  uiClose: { cat: 'ui', bus: 'ui', g: 0.22, gap: 0.05, L: [{ w: 'sine', f: [880, 600], d: 0.08, g: 0.6 }] },
  uiClick: { cat: 'ui', bus: 'ui', g: 0.18, gap: 0.06, L: [{ w: 'square', f: [1200], d: 0.02, g: 0.5, flt: ['bandpass', 2500, null, 2] }, { w: 'sine', f: [800], d: 0.03, g: 0.4 }] },
  equip: { cat: 'ui', bus: 'ui', g: 0.35, gap: 0.05, L: [n(0.08, ['bandpass', 1800], 0.6), { w: 'triangle', f: [500], d: 0.12, g: 0.4 }, { w: 'triangle', f: [750], d: 0.1, t: 0.03, g: 0.3 }] },
  unequip: { cat: 'ui', bus: 'ui', g: 0.25, gap: 0.05, L: [n(0.06, ['bandpass', 1200], 0.6), { w: 'triangle', f: [400], d: 0.08, g: 0.4 }] },
  trade: { cat: 'ui', bus: 'ui', g: 0.4, gap: 0.05, L: [{ w: 'sine', f: [2093], d: 0.1, g: 0.6 }, { w: 'sine', f: [2637], d: 0.12, t: 0.05, g: 0.6 }, { w: 'sine', f: [3136], d: 0.15, t: 0.1, g: 0.6 }, n(0.05, ['highpass', 5000], 0.3)] },
  gamble: { cat: 'ui', bus: 'ui', g: 0.45, gap: 0.05, L: [
    n(0.04, ['bandpass', 1500, null, 2], 0.6), n(0.04, ['bandpass', 1700, null, 2], 0.6, 0.07), n(0.04, ['bandpass', 1400, null, 2], 0.6, 0.14),
    n(0.04, ['bandpass', 1600, null, 2], 0.6, 0.21), { w: 'sine', f: [784, 1568], d: 0.3, t: 0.28, g: 0.5 }] },
  reroll: { cat: 'ui', bus: 'ui', g: 0.4, gap: 0.05, L: [{ w: 'sine', f: [400, 1600], d: 0.5, a: 0.3, g: 0.5, vib: [8, 20] }, n(0.4, ['highpass', 3000, 6000], 0.3, 0, 0.3), { w: 'sine', f: [1568], d: 0.4, t: 0.45, g: 0.4 }] },
  craft: { cat: 'ui', bus: 'ui', g: 0.5, gap: 0.05, L: [
    { w: 'triangle', f: [1100], d: 0.35, g: 0.7 }, { w: 'triangle', f: [2750], d: 0.25, g: 0.3 }, n(0.03, ['bandpass', 3000], 0.4),
    { w: 'triangle', f: [1100], d: 0.35, t: 0.25, g: 0.6 }, n(0.03, ['bandpass', 3000], 0.4, 0.25)] },
  salvage: { cat: 'ui', bus: 'ui', g: 0.45, gap: 0.05, L: [n(0.25, ['lowpass', 2500, 400], 0.8), { w: 'triangle', f: [300, 150], d: 0.15, g: 0.4 }] },
  repair: { cat: 'ui', bus: 'ui', g: 0.4, gap: 0.05, L: [
    { w: 'triangle', f: [1300], d: 0.15, g: 0.6 }, n(0.02, ['bandpass', 3500], 0.4), { w: 'triangle', f: [1300], d: 0.15, t: 0.15, g: 0.55 },
    n(0.02, ['bandpass', 3500], 0.4, 0.15), { w: 'triangle', f: [1300], d: 0.2, t: 0.3, g: 0.6 }, n(0.02, ['bandpass', 3500], 0.4, 0.3)] },
  reset: { cat: 'ui', bus: 'ui', g: 0.35, gap: 0.05, L: [{ w: 'sine', f: [1046, 262], d: 0.6, g: 0.6, vib: [6, 10] }] },
  skillLearn: { cat: 'ui', bus: 'ui', g: 0.35, gap: 0.05, L: [{ w: 'sine', f: [784], d: 0.2, g: 0.6 }, { w: 'sine', f: [1175], d: 0.3, t: 0.07, g: 0.5 }] },
  broken: { cat: 'ui', bus: 'ui', g: 0.35, gap: 0.5, L: [{ w: 'triangle', f: [300, 200], d: 0.25, g: 0.6 }, n(0.2, ['lowpass', 800], 0.4)] },
  stash: { cat: 'ui', bus: 'ui', g: 0.3, gap: 0.2, L: [{ w: 'sawtooth', f: [120, 90], d: 0.3, a: 0.02, g: 0.4, flt: ['lowpass', 700], vib: [14, 6] }, n(0.15, ['lowpass', 900], 0.4)] },
  riftStone: { cat: 'ui', bus: 'ui', g: 0.3, gap: 0.2, L: [{ w: 'sine', f: [110], d: 0.8, a: 0.2, g: 0.6, vib: [4, 2] }, { w: 'sine', f: [165], d: 0.8, a: 0.2, g: 0.4 }] },

  // ── 진행 · 균열 ──
  levelUp: { cat: 'sting', bus: 'sfx', g: 0.35, L: [
    { w: 'triangle', f: [523], d: 0.5, g: 0.6 }, { w: 'triangle', f: [659], d: 0.5, t: 0.08, g: 0.6 }, { w: 'triangle', f: [784], d: 0.5, t: 0.16, g: 0.6 },
    { w: 'triangle', f: [1046], d: 0.7, t: 0.24, g: 0.7 }, { w: 'sine', f: [2093], d: 1.0, t: 0.24, g: 0.25, vib: [6, 8] }] },
  unlock: { cat: 'sting', bus: 'sfx', g: 0.4, L: [{ w: 'triangle', f: [659], d: 0.3, g: 0.6 }, { w: 'triangle', f: [988], d: 0.5, t: 0.12, g: 0.6 }] },
  riftOpen: { cat: 'sting', bus: 'sfx', g: 0.25, gap: 0.3, L: [{ w: 'sine', f: [55, 110], d: 1.5, a: 0.6, g: 0.8 }, n(1.5, ['bandpass', 400, 1200, 1], 0.5, 0, 0.8), { w: 'sine', f: [440, 880], d: 1.2, t: 0.5, a: 0.4, g: 0.2, vib: [5, 8] }] },
  gaugeFull: { cat: 'alarm', bus: 'sfx', g: 0.3, gap: 0.5, L: [
    { w: 'sawtooth', f: [147], d: 1.6, a: 0.05, g: 0.5, flt: ['lowpass', 900] }, { w: 'sawtooth', f: [220], d: 1.6, t: 0.15, a: 0.05, g: 0.4, flt: ['lowpass', 900] },
    { w: 'sine', f: [73], d: 2.0, g: 0.7 }, n(1.0, ['lowpass', 500], 0.3, 0, 0.5)] },
  guardianAppear: { cat: 'sting', bus: 'sfx', g: 0.34, gap: 0.5, L: [
    { w: 'sine', f: [45, 35], d: 2.0, g: 1 }, { w: 'sawtooth', f: [110, 98], d: 1.8, g: 0.5, flt: ['lowpass', 600], vib: [4, 3] },
    n(1.5, ['lowpass', 1200, 200], 0.6), { w: 'sawtooth', f: [165], d: 1.5, t: 0.3, g: 0.35, flt: ['lowpass', 800] }] },
  fanfare: { cat: 'sting', bus: 'sfx', g: 0.4, gap: 0.5, L: [
    { w: 'triangle', f: [523], d: 0.25, g: 0.6 }, { w: 'triangle', f: [659], d: 0.25, t: 0.12, g: 0.6 }, { w: 'triangle', f: [784], d: 0.25, t: 0.24, g: 0.6 },
    { w: 'triangle', f: [1046], d: 0.9, t: 0.36, g: 0.8 }, { w: 'sawtooth', f: [262], d: 1.0, t: 0.36, g: 0.3, flt: ['lowpass', 1500] }, { w: 'sine', f: [1568], d: 0.8, t: 0.36, g: 0.2 }] },
  collapse: { cat: 'sting', bus: 'sfx', g: 0.55, gap: 0.5, L: [
    { w: 'sawtooth', f: [196, 98], d: 2.0, g: 0.5, flt: ['lowpass', 900, 200] }, { w: 'sawtooth', f: [233, 116], d: 2.0, g: 0.4, flt: ['lowpass', 900, 200] },
    n(1.8, ['lowpass', 400], 0.6, 0, 0.3)] },
  death: { cat: 'sting', bus: 'sfx', g: 0.48, gap: 0.5, L: [{ w: 'sawtooth', f: [220, 55], d: 1.5, a: 0.02, g: 0.6, flt: ['lowpass', 1200, 200] }, { w: 'sine', f: [110, 40], d: 1.2, g: 0.8 }] },
};

// ───────────────────────── 지속음(루프) ─────────────────────────
// 루프 레시피 = { bus, g, L:[층…] } · 층 = { w, f?, glide?, g, flt?, lfo? }
//   w     오실레이터 파형 · 'noise' · 'crackle'(모닥불 탁탁) · 'bubble'(용암 보글) — 버퍼는 unlock 때 한 번 합성
//   f     [시작 Hz, 끝 Hz?] — 끝이 있으면 glide(초 — 귀환 시전은 그 길이) 동안 활강
//   lfo   [속도 Hz, 깊이 Hz] — 오실레이터면 주파수 · 잡음이면 필터 주파수를 흔든다
/** @type {Record<string, {bus:string, g:number, L:Array<Object>}>} */
export const LOOPS = {
  // 회오리(player.channel) — 바람 기둥: 대역 잡음의 중심이 빙글빙글 돈다(좁은 대역 잡음은 에너지가 작아 층 크기를 크게 둔다 · 실측 §NOTES-P14)
  whirl: { bus: 'sfx', g: 0.5, L: [
    { w: 'noise', g: 1.0, flt: ['bandpass', 900, 1.4], lfo: [3.2, 500] },
    { w: 'noise', g: 0.5, flt: ['lowpass', 300, 0.7] }] },
  // 귀환 시전(player.recall) — 올라가는 맑은 음 + 반짝임(1.5초 동안)
  recall: { bus: 'sfx', g: 0.25, L: [
    { w: 'sine', f: [330, 990], g: 0.5, lfo: [7, 12] },
    { w: 'triangle', f: [165, 495], g: 0.3 },
    { w: 'noise', g: 0.3, flt: ['highpass', 4000, 0.7] }] },
  // 환경음 — 타일셋 표의 ambience ID(data/tilesets.js) · 바탕이라 조용히(실측 RMS 약 −30dBFS 목표)
  townFire: { bus: 'amb', g: 0.5, L: [
    { w: 'noise', g: 0.7, flt: ['lowpass', 500, 0.7] },
    { w: 'crackle', g: 1.0, flt: ['highpass', 1500, 0.7] }] },
  cryptWind: { bus: 'amb', g: 0.32, L: [
    { w: 'noise', g: 1.0, flt: ['bandpass', 450, 0.9], lfo: [0.08, 250] },
    { w: 'noise', g: 0.4, flt: ['bandpass', 1200, 3], lfo: [0.13, 600] }] },
  cavernLava: { bus: 'amb', g: 0.12, L: [
    { w: 'noise', g: 1.0, flt: ['lowpass', 160, 0.7] },
    { w: 'bubble', g: 0.8, flt: ['lowpass', 700, 0.7] }] },
};

/** 합성 버퍼(unlock 때 한 번) — 길이(초) · 밀도(/초) */
export const BUFFERS = {
  noiseSec: 2,
  crackle: { sec: 4, rate: 14, minMs: 2, maxMs: 9 },
  bubble: { sec: 5, rate: 3, minHz: 80, maxHz: 240, minMs: 40, maxMs: 90 },
};
