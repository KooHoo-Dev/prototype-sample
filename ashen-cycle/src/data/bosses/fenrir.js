// OWNER: P10 — 계약 §8.11
// 서리 송곳니 펜리르 — "속도와 거리 조절". 짧은 예고의 물기 · 긴 돌진 · 뒤를 잡으면 꼬리 쓸기 · 멀어지면 도약 덮치기 ·
// 부채꼴 브레스(옆 · 뒤로 돌아 들어가면 큰 반격 기회). 2페이즈에는 얼음 가시 장판이 거의 모든 큰 공격에 따라붙는다.
// (W3) HP 1900 → 1700 · charge 선택 거리 18 → 17 · frost_breath 10 → 9 — docs/NOTES-W3.md
// (W5) 표식 없는 근접 판정을 보이는 몸에 맞췄다: claw_swipe 부채꼴 r4.4 ±80° → 가슴 앞의 원(fwd 1.3 · r 2.1 — 앞 3.4m · 옆 2.1m) ·
//      tail_sweep r 5.2 → 4.3(꼬리 끝 3.9m). 선택 거리 · 연속기 거리도 닿는 거리 안으로 — docs/CONTRACT.md §8.11
// 시간 초 · 거리 m · 각 rad. hits/move/events의 시각은 전부 tA(판정 시작 = 0) 기준이다(§8.1).
// ext(훅이 쓴다 — hooks/fenrir.js): {sinceHop, pressure, lastHp, burst}. 훅의 수치는 아래 FENRIR_EXT.
/** @typedef {import('../../types.js').BossDef} BossDef */
/** @typedef {import('../../types.js').HazardSpec} HazardSpec */

// ── 2페이즈 얼음 가시 장판 ───────────────────────────────────────────────────

/** 포효로 부르는 가시 · 브레스 도중의 가시 — 경고 0.9초 동안 걸어 나오면 된다. "서 있을 곳"을 줄인다 @type {HazardSpec} */
const SPIKE_BIG = {
  kind: 'ice_spike', style: 'frost',
  shape: { type: 'circle', r: 1.8 },
  warn: 0.9, active: 0.25, interval: 0, damage: 26, guardable: true, knockdown: false,
};

/** 도약 착지 둘레의 가시 고리(6개) — 착지를 굴러 피한 자리가 고리 위면 한 번 더 움직여야 한다 @type {HazardSpec} */
const SPIKE_RING = {
  kind: 'ice_spike', style: 'frost',
  shape: { type: 'circle', r: 1.4 },
  warn: 0.6, active: 0.25, interval: 0, damage: 20, guardable: true, knockdown: false,
};

/** 돌진이 지나온 궤적을 따라 솟는 가시 줄 — 돌진을 옆으로 피한 뒤 그 선 위로 돌아가면 밟는다 @type {HazardSpec} */
const SPIKE_TRAIL = {
  kind: 'ice_spike', style: 'frost',
  shape: { type: 'capsule', fwd0: -13, fwd1: 0, r: 1.2 },
  warn: 0.5, active: 0.3, interval: 0, damage: 20, guardable: true, knockdown: false,
};

/** 서리 송곳니 펜리르 @type {BossDef} */
export const FENRIR = {
  id: 'fenrir', rig: 'quadruped', arenaId: 'arena_fenrir', style: 'frost',
  hp: 1700, postureMax: 120, postureDecayDelay: 4.0, postureDecayRate: 8,
  radius: 1.3, height: 2.4,                 // height = 어깨 높이. 몸길이 5.6 — bodyParts가 덮는 범위와 같게 만든다
  bodyParts: [{ fwd: 1.9, r: 1.0 }, { fwd: 0, r: 1.3 }, { fwd: -1.7, r: 1.0 }],   // 머리 · 몸통 · 엉덩이(앞 2.9m ~ 뒤 2.7m)
  moveSpeed: 5.5, turnRate: 4.5, preferredRange: 4.0, kite: false,
  stride: 2.4, think: [0.40, 0.80],
  introDur: 1.6, parriedDur: 0.9, groggyDur: 4.5, executedDur: 1.2, recoverDur: 0.8, phaseShiftDur: 2.6,
  phase2: { hpFrac: 0.5, speedMul: 1.12, dmgMul: 1.12, thinkMul: 0.7, moveSpeedMul: 1.15 },
  reward: 2000,
  fallbackAttack: 'charge',
  attacks: {
    // 물기 — 가장 자주 나오는 기본기. 예고가 짧다(0.5초). 좁은 부채꼴(±40°)이라 옆구리 · 등 뒤에는 닿지 않는다. 연속기의 시작
    bite: {
      id: 'bite', pose: 'bite', glow: 'none',
      windup: 0.50, active: 0.12, recovery: 0.80,
      sel: { minRange: 0, maxRange: 4.4, maxAngle: 0.9, weight: 4, cooldown: 0 },
      hits: [{
        t0: 0, t1: 0.12, interval: 0, shape: { type: 'arc', r: 3.8, halfAngle: 0.7 }, damage: 24,
        guardable: true, parryable: true, knockdown: false, telegraph: false,
      }],
      move: { kind: 'lunge', t0: -0.15, t1: 0.05, dist: 1.8 },
      track: { turnRate: 6.0, lockLead: 0.12 },
      events: [{ t: -0.15, type: 'cue', cue: 'whoosh' }],
      chain: [{ next: 'bite2', chance: 0.50, chanceP2: 0.70, at: 0.25, maxRange: 6 }],
    },

    // 두 번째 물기 — 연속기 전용. 더 멀리 덤벼든다(2.2m). 끝에 꼬리 쓸기가 이어질 수 있다(등 뒤로 구른 플레이어를 노린다)
    bite2: {
      id: 'bite2', pose: 'bite', glow: 'none',
      windup: 0.45, active: 0.12, recovery: 1.00,
      sel: null,
      hits: [{
        t0: 0, t1: 0.12, interval: 0, shape: { type: 'arc', r: 3.8, halfAngle: 0.7 }, damage: 22,
        guardable: true, parryable: true, knockdown: false, telegraph: false,
      }],
      move: { kind: 'lunge', t0: -0.15, t1: 0.05, dist: 2.2 },
      track: { turnRate: 6.0, lockLead: 0.12 },
      events: [{ t: -0.15, type: 'cue', cue: 'whoosh' }],
      chain: [{ next: 'tail_sweep', chance: 0.25, chanceP2: 0.50, at: 0.30, maxRange: 4.5 }],
    },

    // 앞발 할퀴기 — 가슴 앞을 가로로 쓴다(머리 앞 0.5m · 좌우 2.1m — 물기보다 넓다). 옆걸음으로는 못 피한다(구르기 · 가드 · 패링).
    // 2페이즈: 물기로 이어진다
    claw_swipe: {
      id: 'claw_swipe', pose: 'claw', glow: 'none',
      windup: 0.60, active: 0.15, recovery: 0.95,
      sel: { minRange: 0, maxRange: 4.4, maxAngle: 1.4, weight: 3, cooldown: 2 },
      hits: [{
        t0: 0, t1: 0.15, interval: 0, shape: { type: 'circle', r: 2.1, fwd: 1.3 }, damage: 26,
        guardable: true, parryable: true, knockdown: false, telegraph: false,
      }],
      move: { kind: 'lunge', t0: -0.15, t1: 0.05, dist: 1.0 },
      track: { turnRate: 5.0, lockLead: 0.15 },
      events: [{ t: -0.15, type: 'cue', cue: 'whoosh' }],
      chain: [{ next: 'bite', chance: 0, chanceP2: 0.50, at: 0.30, maxRange: 6 }],
    },

    // 꼬리 쓸기 — 붉은 발광(패링 불가). 등 뒤 · 옆 뒤 ±100°를 쓴다(추적 없음). 정면 ±80°는 안전하다
    tail_sweep: {
      id: 'tail_sweep', pose: 'tail', glow: 'danger',
      windup: 0.65, active: 0.20, recovery: 1.00,
      sel: { minRange: 0, maxRange: 4.5, minAngle: 1.7, weight: 6, cooldown: 2 },
      hits: [{
        t0: 0, t1: 0.20, interval: 0, shape: { type: 'arc', r: 4.3, halfAngle: 1.75, dirOffset: Math.PI }, damage: 24,
        guardable: true, parryable: false, knockdown: false, telegraph: false,
      }],
      move: null,
      track: { turnRate: 0, lockLead: 0 },
      events: [{ t: -0.15, type: 'cue', cue: 'whoosh' }],
      chain: [],
    },

    // 돌진 — 붉은 발광(패링 불가). 바닥의 긴 선을 보고 옆으로 구른다. 지나친 뒤의 긴 후딜이 반격 기회.
    // 2페이즈: 달려온 궤적을 따라 가시가 솟는다
    charge: {
      id: 'charge', pose: 'charge', glow: 'danger',
      windup: 0.90, active: 0.55, recovery: 1.40,
      sel: { minRange: 7, maxRange: 17, maxAngle: 0.6, weight: 3, cooldown: 5 },   // (W3) 18 → 17: 실제 사거리 17.2m(NOTES-P10 #1)
      hits: [{
        t0: 0, t1: 0.55, interval: 0, shape: { type: 'capsule', fwd0: -0.5, fwd1: 2.6, r: 1.4 }, damage: 32,
        guardable: true, parryable: false, knockdown: true, telegraph: true,
        telegraphShape: { type: 'capsule', fwd0: 0, fwd1: 15.8, r: 1.4 },
      }],
      move: { kind: 'charge', t0: 0, t1: 0.55, dist: 13.2 },
      track: { turnRate: 4.0, lockLead: 0.22 },
      events: [
        { t: 0, type: 'cue', cue: 'charge_start' },
        { t: 0.55, type: 'hazard', phase: 2, hazard: SPIKE_TRAIL, place: { mode: 'self' } },
      ],
      chain: [],
    },

    // 도약 덮치기 — 붉은 발광(패링 불가). 착지 원이 0.30초 전에 멈춘다. 2페이즈: 착지 둘레에 가시 고리
    pounce: {
      id: 'pounce', pose: 'pounce', glow: 'danger',
      windup: 0.80, active: 0.15, recovery: 1.20,
      sel: { minRange: 5, maxRange: 13, maxAngle: 1.2, weight: 3, cooldown: 6 },
      hits: [{
        t0: 0, t1: 0.15, interval: 0, shape: { type: 'circle', r: 3.0, fwd: 1.8 }, damage: 34,
        guardable: true, parryable: false, knockdown: true, telegraph: true,
        telegraphAt: 'aim', telegraphShape: { type: 'circle', r: 3.0 },
      }],
      move: { kind: 'leap', t0: -0.50, t1: 0, dist: 12, stopShort: 1.8, height: 2.4, aimLock: -0.30 },
      track: { turnRate: 5.0, lockLead: 0.30 },
      events: [
        { t: 0, type: 'cue', cue: 'land', shake: [0.30, 0.35] },
        { t: 0.05, type: 'hazard', phase: 2, hazard: SPIKE_RING, place: { mode: 'ringAround', radius: 4.5 }, count: 6 },
      ],
      chain: [],
    },

    // 냉기 브레스 — 부채꼴 지속 판정(0.35초마다 한 틱). 판정 중에도 느리게 따라 돈다(0.9 rad/s).
    // 옆 · 뒤로 돌아 들어가면 1.4초 + 후딜 내내 때릴 수 있다. 2페이즈: 도중에 발밑 가시 4개
    frost_breath: {
      id: 'frost_breath', pose: 'breath', glow: 'frost',
      windup: 1.10, active: 1.40, recovery: 1.30,
      sel: { minRange: 3, maxRange: 9, maxAngle: 0.8, weight: 2, cooldown: 9 },   // (W3) 10 → 9: 부채꼴이 닿는 거리 9.4m(NOTES-P10 #2)
      hits: [{
        t0: 0, t1: 1.40, interval: 0.35, shape: { type: 'arc', r: 9.0, rInner: 1.0, halfAngle: 0.5 }, damage: 11,
        guardable: true, parryable: false, knockdown: false, telegraph: true,
      }],
      move: null,
      track: { turnRate: 4.0, lockLead: 0.20, activeTurnRate: 0.9 },
      events: [
        { t: 0, type: 'cue', cue: 'breath_start', params: { length: 9, halfAngle: 0.5, socket: 'mouth' } },
        { t: 0.70, type: 'hazard', phase: 2, hazard: SPIKE_BIG, place: { mode: 'scatter', radius: 5 }, count: 4 },
        { t: 1.40, type: 'cue', cue: 'breath_end' },
      ],
      chain: [],
    },

    // 백홉 — 판정 없음. 붙어 있는 플레이어에게서 6m 빠진 뒤 곧바로 돌진 · 브레스로 이어질 수 있다
    backhop: {
      id: 'backhop', pose: 'hop', glow: 'none',
      windup: 0.45, active: 0.35, recovery: 0.30,
      sel: { minRange: 0, maxRange: 3.5, weight: 1.5, cooldown: 7 },
      hits: [],
      move: { kind: 'hop', t0: 0, t1: 0.35, dist: 6, height: 1.2 },
      track: { turnRate: 5.0, lockLead: 0 },
      events: [],
      chain: [
        { next: 'charge', chance: 0.40, chanceP2: 0.30, at: 0.10 },
        { next: 'frost_breath', chance: 0.30, chanceP2: 0.40, at: 0.10 },
      ],
    },

    // (2페이즈) 얼음 가시 — 하늘로 울부짖으면 플레이어 둘레에 가시 6개가 솟는다(첫 개는 발밑). 긴 시전이 접근 기회
    ice_spikes: {
      id: 'ice_spikes', pose: 'howl', glow: 'frost',
      windup: 1.00, active: 0.30, recovery: 1.20,
      sel: { minRange: 0, maxRange: 24, weight: 2.5, cooldown: 10, minPhase: 2 },
      hits: [],
      move: null,
      track: { turnRate: 3.0, lockLead: 0.20 },
      events: [
        { t: -0.6, type: 'cue', cue: 'howl', shake: [0.20, 0.50] },
        { t: 0, type: 'hazard', hazard: SPIKE_BIG, place: { mode: 'scatter', radius: 7 }, count: 6 },
        { t: 0.9, type: 'cue', cue: 'shatter' },
      ],
      chain: [],
    },
  },
};

/**
 * 훅(hooks/fenrir.js)이 쓰는 수치. 훅 파일에 숫자를 박지 않는다.
 *   백홉은 "빠질 자리가 있을 때만 · 너무 자주는 아니게 · 얻어맞고 있으면 더 자주" 나온다.
 */
export const FENRIR_EXT = {
  hopGapAttacks: 2,       // 백홉 뒤 다른 공격을 이만큼 시작하기 전에는 다시 백홉하지 않는다
  hopClearPad: 0.5,       // 백홉 착지 자리의 여유(m) — 이만큼 부풀린 몸통 원이 벽 · 기둥에 걸리면 뛰지 않는다
  hopSamples: 3,          // 백홉 경로를 이만큼 등분해 벽 · 기둥을 본다(마지막 지점 = 착지 자리)
  pressureDecay: 0.5,     // 압박(최근에 깎인 HP 비율)이 초당 이 비율로 식는다(지수 감쇠 계수, 1/초)
  pressureFull: 0.06,     // 압박이 hpMax의 이 비율에 닿으면 백홉 가중치가 최대로 오른다
  pressureHopMul: 3,      // 그때의 백홉 가중치 배율(압박 0이면 1배)
};
