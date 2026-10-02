// OWNER: P3 — 계약 §8.10
// 잿빛 기사 발더 — "패턴 학습의 교과서". 정직한 휘두르기 · 찌르기 돌진 · 도약 내려찍기,
// 2페이즈에 불 인챈트(ext.enchanted) · 충격파 · 지연 베기 · 불기둥.
// 시간 초 · 거리 m · 각 rad. hits/move/events의 시각은 전부 tA(판정 시작 = 0) 기준이다(§8.1).
// (W3) 피해 전부 약 −13%(첫 보스의 받는 피해가 셋 중 가장 컸다) · 선택 거리/각 넷 조정 — docs/NOTES-W3.md
// (W5) 근접 판정을 보이는 칼끝에 맞췄다(칼끝의 최대 도달 + 약 0.35m): slash_r 4.2 → 3.3 · slash_l 4.2 → 3.6 · overhead 끝 5.9 → 3.7 ·
//      spin_slash 4.0 → 3.3 · delayed_cleave 4.6 → 3.4. 선택 거리 · 연속기 거리도 「서 있는 플레이어에게 닿는 거리」 안으로 줄였다.
//      칼이 닿지 않는 1.3~2.5m 밖에서 맞던 것을 없앴다 — 표식이 없는 근접 공격은 보이는 무기가 곧 판정이다.
// ext: {enchanted: boolean} — valderHooks.onPhaseChange가 true로 하고 `enchant` 큐를 낸다.
/** @typedef {import('../../types.js').BossDef} BossDef */
/** @typedef {import('../../types.js').HazardSpec} HazardSpec */

// ── 2페이즈 장판 ─────────────────────────────────────────────────────────────

/** 내려찍은 자리에서 앞으로 뻗는 불길 — 옆으로 피하면 안 맞고, 뒤로 물러나면 밟는다 @type {HazardSpec} */
const FIRE_TRAIL = {
  kind: 'fire_trail', style: 'fire',
  shape: { type: 'capsule', fwd0: 1.0, fwd1: 9.0, r: 0.9 },
  warn: 0.35, active: 1.0, interval: 0.4, damage: 8, guardable: true, knockdown: false,
};

/** 도약 착지의 충격파 — 띠가 지나갈 때 구르면 뚫는다 @type {HazardSpec} */
const LEAP_SHOCKWAVE = {
  kind: 'shockwave', style: 'fire',
  grow: { r0: 2, r1: 10, width: 1.0 },
  warn: 0, active: 0.8, interval: 0, damage: 16, guardable: true, knockdown: false,
};

/** 땅 내려찍기의 충격파(더 멀리 · 더 두껍게) @type {HazardSpec} */
const WAVE_SHOCKWAVE = {
  kind: 'shockwave', style: 'fire',
  grow: { r0: 1.5, r1: 12, width: 1.1 },
  warn: 0, active: 1.0, interval: 0, damage: 19, guardable: true, knockdown: false,
};

/** 발밑에서 솟는 불기둥 — 경고 0.8초 동안 걸어 나오면 된다 @type {HazardSpec} */
const FIRE_PILLAR = {
  kind: 'fire_pillar', style: 'fire',
  shape: { type: 'circle', r: 2.0 },
  warn: 0.8, active: 0.2, interval: 0, damage: 19, guardable: true, knockdown: false,
};

/** 잿빛 기사 발더 @type {BossDef} */
export const VALDER = {
  id: 'valder', rig: 'humanoid', arenaId: 'arena_valder', style: 'fire',
  hp: 1400, postureMax: 100, postureDecayDelay: 5.0, postureDecayRate: 6,
  radius: 0.8, height: 2.7,
  moveSpeed: 3.2, turnRate: 3.5, preferredRange: 3.2, kite: false,
  stride: 1.6, think: [0.55, 0.95],
  introDur: 1.6, parriedDur: 1.0, groggyDur: 5.0, executedDur: 1.2, recoverDur: 0.8, phaseShiftDur: 2.6,
  phase2: { hpFrac: 0.5, speedMul: 1.12, dmgMul: 1.15, thinkMul: 0.7, moveSpeedMul: 1.2 },
  reward: 1200,
  fallbackAttack: 'thrust_charge',
  attacks: {
    // 오른쪽 가로 베기 — 가장 자주 나오는 기본기. 연속기의 시작(→ slash_l → overhead)
    slash_r: {
      id: 'slash_r', pose: 'slashR', glow: 'none',
      windup: 0.70, active: 0.15, recovery: 1.00,
      sel: { minRange: 0, maxRange: 4.6, maxAngle: 1.2, weight: 3, cooldown: 0 },
      hits: [{
        t0: 0, t1: 0.15, interval: 0, shape: { type: 'arc', r: 3.3, halfAngle: 1.22 }, damage: 19,
        guardable: true, parryable: true, knockdown: false, telegraph: false,
      }],
      move: { kind: 'lunge', t0: -0.20, t1: 0.05, dist: 1.4 },
      track: { turnRate: 4.5, lockLead: 0.15 },
      events: [{ t: -0.15, type: 'cue', cue: 'whoosh' }],
      chain: [{ next: 'slash_l', chance: 0.45, chanceP2: 0.70, at: 0.30, maxRange: 4.8 }],
    },

    // 되돌려 베기 — 연속기 전용. 예고가 짧다(0.5초)
    slash_l: {
      id: 'slash_l', pose: 'slashL', glow: 'none',
      windup: 0.50, active: 0.15, recovery: 1.10,
      sel: null,
      hits: [{
        t0: 0, t1: 0.15, interval: 0, shape: { type: 'arc', r: 3.6, halfAngle: 1.31 }, damage: 21,
        guardable: true, parryable: true, knockdown: false, telegraph: false,
      }],
      move: { kind: 'lunge', t0: -0.18, t1: 0.05, dist: 1.2 },
      track: { turnRate: 5.0, lockLead: 0.15 },
      events: [{ t: -0.15, type: 'cue', cue: 'whoosh' }],
      chain: [{ next: 'overhead', chance: 0.30, chanceP2: 0.55, at: 0.30, maxRange: 4.5 }],
    },

    // 세로 내려찍기 — 좁고 길다. 옆으로 구르면 피한다. 2페이즈: 찍은 자리에서 불길이 앞으로 뻗는다
    overhead: {
      id: 'overhead', pose: 'overhead', glow: 'none',
      windup: 0.95, active: 0.12, recovery: 1.40,
      sel: { minRange: 0, maxRange: 4.5, maxAngle: 0.7, weight: 2, cooldown: 4 },
      hits: [{
        t0: 0, t1: 0.12, interval: 0, shape: { type: 'capsule', fwd0: 0.6, fwd1: 2.8, r: 0.9 }, damage: 30,
        guardable: true, parryable: true, knockdown: true, telegraph: false,
      }],
      move: { kind: 'lunge', t0: -0.15, t1: 0, dist: 0.8 },
      track: { turnRate: 4.0, lockLead: 0.18 },
      events: [
        { t: 0, type: 'cue', cue: 'slam', shake: [0.20, 0.25] },
        { t: 0.05, type: 'hazard', phase: 2, hazard: FIRE_TRAIL, place: { mode: 'self' } },
      ],
      chain: [],
    },

    // 찌르기 돌진 — 붉은 발광(패링 불가). 바닥의 긴 선을 보고 옆으로 구른다. 지나친 뒤의 후딜이 반격 기회
    thrust_charge: {
      id: 'thrust_charge', pose: 'thrust', glow: 'danger',
      windup: 0.85, active: 0.40, recovery: 1.30,
      sel: { minRange: 5, maxRange: 14, maxAngle: 0.6, weight: 3, cooldown: 6 },   // (W3) 6 → 5: 1페이즈의 5~6m 공백을 메운다
      hits: [{
        t0: 0, t1: 0.40, interval: 0, shape: { type: 'capsule', fwd0: 0, fwd1: 3.4, r: 0.8 }, damage: 24,
        guardable: true, parryable: false, knockdown: false, telegraph: true,
        telegraphShape: { type: 'capsule', fwd0: 0, fwd1: 13.4, r: 0.8 },
      }],
      move: { kind: 'charge', t0: 0, t1: 0.40, dist: 10 },
      track: { turnRate: 3.5, lockLead: 0.22 },
      events: [{ t: 0, type: 'cue', cue: 'charge_start' }],
      chain: [],
    },

    // 도약 내려찍기 — 붉은 발광(패링 불가). 착지 원이 0.35초 전에 멈춘다. 2페이즈: 착지 충격파
    leap_slam: {
      id: 'leap_slam', pose: 'leap', glow: 'danger',
      windup: 1.10, active: 0.15, recovery: 1.50,
      sel: { minRange: 6, maxRange: 16, maxAngle: 1.2, weight: 2, cooldown: 8 },   // (W3) 7 → 6: 걸어 들어오는 보스가 도약할 거리를 남긴다
      hits: [{
        t0: 0, t1: 0.15, interval: 0, shape: { type: 'circle', r: 3.2, fwd: 1.6 }, damage: 31,
        guardable: true, parryable: false, knockdown: true, telegraph: true,
        telegraphAt: 'aim', telegraphShape: { type: 'circle', r: 3.2 },
      }],
      move: { kind: 'leap', t0: -0.60, t1: 0, dist: 14, stopShort: 1.6, height: 3.0, aimLock: -0.35 },
      track: { turnRate: 4.0, lockLead: 0.35 },
      events: [
        { t: 0, type: 'cue', cue: 'land', shake: [0.35, 0.40] },
        { t: 0, type: 'hazard', phase: 2, hazard: LEAP_SHOCKWAVE, place: { mode: 'self' } },
      ],
      chain: [],
    },

    // 회전 베기 — 등 뒤에 붙은 플레이어를 떼어 낸다(추적 없음 · 전방위)
    spin_slash: {
      id: 'spin_slash', pose: 'spin', glow: 'none',
      windup: 0.60, active: 0.18, recovery: 1.10,
      sel: { minRange: 0, maxRange: 3.5, minAngle: 1.2, weight: 6, cooldown: 2.5 },   // (W3) 1.4 → 1.2: slash_r(≤ 1.2)와의 옆구리 공백을 메운다
      hits: [{
        t0: 0, t1: 0.18, interval: 0, shape: { type: 'circle', r: 3.3 }, damage: 18,
        guardable: true, parryable: true, knockdown: false, telegraph: false,
      }],
      move: null,
      track: { turnRate: 0, lockLead: 0 },
      events: [{ t: -0.15, type: 'cue', cue: 'whoosh' }],
      chain: [],
    },

    // (2페이즈) 땅 내려찍기 + 퍼지는 충격파 — 가까우면 직격, 멀면 띠를 굴러 뚫는다
    fire_wave: {
      id: 'fire_wave', pose: 'slamGround', glow: 'fire',
      windup: 1.00, active: 0.12, recovery: 1.60,
      sel: { minRange: 0, maxRange: 10, weight: 2.5, cooldown: 9, minPhase: 2 },
      hits: [{
        t0: 0, t1: 0.12, interval: 0, shape: { type: 'circle', r: 2.8, fwd: 1.2 }, damage: 23,
        guardable: true, parryable: false, knockdown: true, telegraph: true,
      }],
      move: null,
      track: { turnRate: 3.0, lockLead: 0.25 },
      events: [
        { t: 0, type: 'cue', cue: 'slam', shake: [0.30, 0.35] },
        { t: 0, type: 'hazard', hazard: WAVE_SHOCKWAVE, place: { mode: 'self' } },
      ],
      chain: [],
    },

    // (2페이즈) 지연 베기 — 자세를 잡고 멈췄다가 늦게 내려친다. 예고가 길고 추적이 빠르다(일찍 구르면 맞는다)
    delayed_cleave: {
      id: 'delayed_cleave', pose: 'delayed', glow: 'fire',
      windup: 1.45, active: 0.15, recovery: 1.20,
      sel: { minRange: 0, maxRange: 5.0, maxAngle: 1.3, weight: 2.5, cooldown: 5, minPhase: 2 },
      hits: [{
        t0: 0, t1: 0.15, interval: 0, shape: { type: 'arc', r: 3.4, halfAngle: 1.4 }, damage: 33,
        guardable: true, parryable: true, knockdown: true, telegraph: false,
      }],
      move: { kind: 'lunge', t0: -0.18, t1: 0.05, dist: 1.6 },
      track: { turnRate: 6.0, lockLead: 0.12 },
      events: [{ t: -0.15, type: 'cue', cue: 'whoosh' }],
      chain: [],
    },

    // (2페이즈) 불기둥 3연발 — 멀리 달아난 플레이어의 발밑을 쫓는다. 긴 시전이 접근 기회
    ember_burst: {
      id: 'ember_burst', pose: 'cast', glow: 'fire',
      windup: 0.90, active: 0.70, recovery: 1.20,
      sel: { minRange: 6.5, maxRange: 20, weight: 2, cooldown: 7, minPhase: 2 },   // (W3) 8 → 6.5: 물러나 회복하는 플레이어를 쫓는다
      hits: [],
      move: null,
      track: { turnRate: 3.0, lockLead: 0.20 },
      events: [
        { t: -0.6, type: 'cue', cue: 'cast' },
        { t: 0, type: 'hazard', hazard: FIRE_PILLAR, place: { mode: 'chase', lead: 0.25 }, count: 3, interval: 0.35 },
      ],
      chain: [],
    },
  },
};
