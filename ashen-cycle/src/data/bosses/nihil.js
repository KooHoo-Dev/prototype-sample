// OWNER: P11 — 계약 §8.12
// 심연의 군주 니힐 — "원거리 압박과 틈 찾기". 부유하는 마술사: 유도 구체 · 순간이동 · 광선 쓸기 · 지면 폭발 · 검 비.
// 근접 보스 둘과 반대로 싸운다: 긴 후딜(1.0~2.0초)은 **멀리서** 생기고, 붙으면 떼어 낸다(blink · void_nova).
// 2페이즈는 복합이다 — 구체 5발 + 광선 연계, 등 뒤 순간이동 직후의 폭발(blink_strike → void_nova), 검 비 + 지면 폭발(cataclysm).
// 시간 초 · 거리 m · 각 rad. hits/move/events의 시각은 전부 tA(판정 시작 = 0) 기준이다(§8.1).
// ext: {hoverY, crowdT} — hooks/nihil.js가 쓴다. 훅의 수치는 이 파일 끝의 NIHIL_EXT.
// (W3) HP 2400 → 2800 · 피해 전부 약 +20%(받는 피해가 셋 중 가장 낮았다) · 훅의 kite는 프레임워크로 옮겼다 — docs/NOTES-W3.md
/** @typedef {import('../../types.js').BossDef} BossDef */
/** @typedef {import('../../types.js').HazardSpec} HazardSpec */
/** @typedef {import('../../types.js').ProjectileSpec} ProjectileSpec */

// ── 투사체 · 장판 ───────────────────────────────────────────────────────────

/**
 * 유도 구체 — 패링하면 사라지고 니힐에 체간 parryPosture × 0.5(기본 15)가 쌓인다(§6.4 규칙 3).
 * 원거리 보스에게 체간을 쌓는 주 수단이다(체간 90 = 구체 6개). 기둥 뒤로 숨으면 기둥이 막는다.
 * @type {ProjectileSpec}
 */
const VOID_ORB = {
  kind: 'void_orb', style: 'void',
  speed: 9, r: 0.45, life: 5, homing: 2.2, homingTime: 2.5,
  damage: 22, guardable: true, parryable: true, knockdown: false, y: 1.4,
};

/** 발밑에서 터지는 지연 폭발 — 경고 0.9초 동안 원 밖으로 나오면 된다(멈춰 서 있으면 맞고 넘어진다) @type {HazardSpec} */
const VOID_BURST = {
  kind: 'void_burst', style: 'void',
  shape: { type: 'circle', r: 2.6 },
  warn: 0.9, active: 0.2, interval: 0, damage: 36, guardable: true, knockdown: true,
};

/** 하늘에서 떨어지는 검 — 경고 0.7초(fx가 그 시간에 맞춰 검을 떨어뜨린다). 작은 원이 순서대로 깔린다 @type {HazardSpec} */
const VOID_SWORD = {
  kind: 'void_sword', style: 'void',
  shape: { type: 'circle', r: 1.3 },
  warn: 0.7, active: 0.15, interval: 0, damage: 24, guardable: true, knockdown: false,
};

/** 구체가 손을 떠나는 자리(보스 로컬) — 뷰의 시전 손(handL)이 이 앞에 온다 */
const ORB_ORIGIN = { fwd: 0.8, side: 0 };

/** 심연의 군주 니힐 @type {BossDef} */
export const NIHIL = {
  id: 'nihil', rig: 'floater', arenaId: 'arena_nihil', style: 'void',
  hp: 2800, postureMax: 90, postureDecayDelay: 8.0, postureDecayRate: 5,
  radius: 0.8, height: 2.8,                 // 부유 높이 0.8 포함
  moveSpeed: 2.6, turnRate: 5.0, preferredRange: 10, kite: true,
  stride: 0, think: [0.60, 1.00],           // stride 0 = 발소리 없음
  introDur: 1.6, parriedDur: 1.0, groggyDur: 5.0, executedDur: 1.2, recoverDur: 0.8, phaseShiftDur: 2.6,
  phase2: { hpFrac: 0.5, speedMul: 1.10, dmgMul: 1.12, thinkMul: 0.6, moveSpeedMul: 1.2 },
  reward: 3000,
  fallbackAttack: 'void_orbs',
  attacks: {
    // 유도 구체 3발(2페이즈 5발) — 기본기. 패링으로 되받아치면 체간이 쌓인다. 2페이즈: 절반은 광선으로 이어진다
    void_orbs: {
      id: 'void_orbs', pose: 'castOrbs', glow: 'void',
      windup: 0.90, active: 0.60, recovery: 1.10,
      sel: { minRange: 5, maxRange: 22, weight: 3, cooldown: 3 },
      hits: [],
      move: null,
      track: { turnRate: 5.0, lockLead: 0.10 },
      events: [
        { t: 0, type: 'cue', cue: 'cast' },
        { t: 0, type: 'projectile', proj: VOID_ORB, count: 3, interval: 0.25, spread: 0.5, origin: ORB_ORIGIN },
        { t: 0.12, type: 'projectile', phase: 2, proj: VOID_ORB, count: 2, interval: 0.25, spread: 0.9, origin: ORB_ORIGIN },
      ],
      chain: [{ next: 'beam_sweep', chance: 0, chanceP2: 0.50, at: 0.40 }],
    },

    // 순간이동 — 붙은 플레이어를 떼어 낸다. 사라졌다가 플레이어에서 11m 떨어진(아레나 안쪽) 자리에 나타난다
    blink: {
      id: 'blink', pose: 'blink', glow: 'void',
      windup: 0.45, active: 0.10, recovery: 0.40,
      sel: { minRange: 0, maxRange: 4.5, weight: 4, cooldown: 5 },
      hits: [],
      move: null,
      track: { turnRate: 0, lockLead: 0 },
      events: [
        { t: -0.05, type: 'cue', cue: 'blink_out' },
        { t: 0, type: 'teleport', to: 'away', dist: 11 },
        { t: 0.02, type: 'cue', cue: 'blink_in' },
      ],
      chain: [
        { next: 'void_orbs', chance: 0.50, chanceP2: 0.30, at: 0.10 },
        { next: 'ground_burst', chance: 0.30, chanceP2: 0.40, at: 0.10 },
      ],
    },

    // 광선 쓸기 — 오른쪽 끝에서 왼쪽 끝까지 1.5초에 걸쳐 쓴다. 바닥의 부채가 쓸리는 범위 전체다.
    // 한 번만 맞는다(지속 판정이 아니다) — 광선이 지나갈 때 구르기 무적으로 통과한다. 긴 후딜이 접근 기회
    beam_sweep: {
      id: 'beam_sweep', pose: 'beam', glow: 'void',
      windup: 1.20, active: 1.50, recovery: 1.40,
      sel: { minRange: 4, maxRange: 22, maxAngle: 1.0, weight: 2, cooldown: 8 },
      hits: [{
        t0: 0, t1: 1.50, interval: 0, shape: { type: 'capsule', fwd0: 1.0, fwd1: 22, r: 0.6 }, damage: 36,
        guardable: true, parryable: false, knockdown: false, telegraph: true,
        telegraphShape: { type: 'arc', r: 22, rInner: 1.0, halfAngle: 0.95 },
      }],
      move: null,
      track: { turnRate: 5.0, lockLead: 0.25, sweep: { from: -0.95, to: 0.95 } },
      events: [
        { t: 0, type: 'cue', cue: 'beam_start', params: { length: 22, width: 1.2, socket: 'handL' } },
        { t: 1.50, type: 'cue', cue: 'beam_end' },
      ],
      chain: [],
    },

    // 지면 폭발 3연발 — 0.45초 간격으로 플레이어의 발밑(0.3초 앞)을 쫓는다. 달리거나 걷던 방향을 버리면 안 맞는다
    // (걷던 방향 그대로면 앞에 깔린 원의 가장자리에 걸린다 — 4.5m 걷고 1.5m 앞질림 = 반경 2.6 + 몸 0.4)
    ground_burst: {
      id: 'ground_burst', pose: 'castGround', glow: 'void',
      windup: 0.80, active: 1.00, recovery: 1.00,
      sel: { minRange: 0, maxRange: 22, weight: 3, cooldown: 6 },
      hits: [],
      move: null,
      track: { turnRate: 5.0, lockLead: 0.10 },
      events: [
        { t: 0, type: 'cue', cue: 'cast' },
        { t: 0, type: 'hazard', hazard: VOID_BURST, place: { mode: 'chase', lead: 0.3 }, count: 3, interval: 0.45 },
      ],
      chain: [],
    },

    // 검 비 — 2초 동안 0.2초마다 한 자루씩, 플레이어 둘레 6m 안에 10자루. 시전이 길어 그 사이를 달려 들어갈 수 있다
    sword_rain: {
      id: 'sword_rain', pose: 'castSky', glow: 'void',
      windup: 1.10, active: 2.00, recovery: 1.20,
      sel: { minRange: 0, maxRange: 22, weight: 2, cooldown: 12 },
      hits: [],
      move: null,
      track: { turnRate: 5.0, lockLead: 0.10 },
      events: [
        { t: 0, type: 'cue', cue: 'cast' },
        { t: 0, type: 'hazard', hazard: VOID_SWORD, place: { mode: 'scatter', radius: 6 }, count: 10, interval: 0.2 },
      ],
      chain: [],
    },

    // 심연 폭발 — 붉은 발광(패링 불가). 밀착한 플레이어에게 "물러나라"는 신호다. 반경 5m · 후딜 1.5초가 가장 큰 반격 창
    void_nova: {
      id: 'void_nova', pose: 'nova', glow: 'danger',
      windup: 0.85, active: 0.15, recovery: 1.50,
      sel: { minRange: 0, maxRange: 4.8, weight: 3, cooldown: 6 },
      hits: [{
        t0: 0, t1: 0.15, interval: 0, shape: { type: 'circle', r: 5.0 }, damage: 34,
        guardable: true, parryable: false, knockdown: true, telegraph: true,
      }],
      move: null,
      track: { turnRate: 0, lockLead: 0 },
      events: [{ t: 0, type: 'cue', cue: 'slam', shake: [0.30, 0.35] }],
      chain: [],
    },

    // 낫 베기 — 정면에 붙은 플레이어를 가로로 벤다. 니힐의 유일한 패링 가능 근접기(패링하면 체간 + 경직)
    // (W5) 판정 r 4.0 → 3.0: 보이는 낫 끝(2.7m)에 맞췄다. 선택 거리 4.2 → 4.0
    scythe_slash: {
      id: 'scythe_slash', pose: 'scythe', glow: 'none',
      windup: 0.60, active: 0.15, recovery: 1.10,
      sel: { minRange: 0, maxRange: 4.0, maxAngle: 1.4, weight: 2.5, cooldown: 2 },
      hits: [{
        t0: 0, t1: 0.15, interval: 0, shape: { type: 'arc', r: 3.0, halfAngle: 1.4 }, damage: 29,
        guardable: true, parryable: true, knockdown: false, telegraph: false,
      }],
      move: { kind: 'lunge', t0: -0.15, t1: 0.05, dist: 1.0 },
      track: { turnRate: 5.0, lockLead: 0.15 },
      events: [{ t: -0.15, type: 'cue', cue: 'whoosh' }],
      chain: [],
    },

    // (2페이즈) 등 뒤 순간이동 → 곧바로 심연 폭발. 사라지는 것을 보면 앞으로 구른다
    blink_strike: {
      id: 'blink_strike', pose: 'blink', glow: 'void',
      windup: 0.50, active: 0.10, recovery: 0.30,
      sel: { minRange: 6, maxRange: 22, weight: 2.5, cooldown: 9, minPhase: 2 },
      hits: [],
      move: null,
      track: { turnRate: 0, lockLead: 0 },
      events: [
        { t: -0.05, type: 'cue', cue: 'blink_out' },
        { t: 0, type: 'teleport', to: 'behindTarget', dist: 2.5 },
        { t: 0.02, type: 'cue', cue: 'blink_in' },
      ],
      chain: [{ next: 'void_nova', chance: 1, chanceP2: 1, at: 0.05 }],
    },

    // (2페이즈) 대격변 — 검 비 12자루와 지면 폭발 4연발이 겹친다. 후딜 2.0초가 2페이즈의 가장 긴 틈
    cataclysm: {
      id: 'cataclysm', pose: 'castSky', glow: 'void',
      windup: 1.30, active: 2.40, recovery: 2.00,
      sel: { minRange: 0, maxRange: 22, weight: 1.5, cooldown: 16, minPhase: 2 },
      hits: [],
      move: null,
      track: { turnRate: 5.0, lockLead: 0.10 },
      events: [
        { t: -0.8, type: 'cue', cue: 'roar' },
        { t: 0, type: 'hazard', hazard: VOID_SWORD, place: { mode: 'scatter', radius: 7 }, count: 12, interval: 0.2 },
        { t: 0.3, type: 'hazard', hazard: VOID_BURST, place: { mode: 'chase', lead: 0.3 }, count: 4, interval: 0.6 },
      ],
      chain: [],
    },
  },
};

/**
 * 훅이 쓰는 수치(§8.12). 훅 파일에 숫자를 박지 않는다.
 *   hoverY      부유 높이(m) — onTick이 매 틱 boss.y에 넣는다
 *   crowdRange  밀착 판정 거리(m) · crowdTime  이만큼(초) 넘게 붙어 있으면 blink(쿨다운 0) 또는 void_nova를 강제한다
 * (W3) 거리 벌리기(kite)는 프레임워크가 한다 — 고민하는 동안 preferredRange × BOSS_AI.kiteNear(= 6m) 안이면 물러난다(§8.6).
 */
export const NIHIL_EXT = { hoverY: 0.8, crowdRange: 3.5, crowdTime: 1.5 };
