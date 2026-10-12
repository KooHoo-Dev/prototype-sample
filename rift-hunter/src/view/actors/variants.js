// OWNER: P8 — 계약 §9.5 · §9.6 (내부 — 몬스터 변형 표: 치수 · 부위 · 걸음 · 기본 자세 · 공격 자세 · 판정 끝점)
// 키 = 데이터의 look.variant(§3.3 MonsterDef.look — view 힌트). sim 은 이 표를 모른다(view 의 연출 상수).
// 치수는 배율 1(def.radius · def.height) 기준 — 인스턴스 배율은 mon.r / def.radius(= rank.scale · 이미 곱한 r 을 다시 곱하지 않는다 §9.6).
// 부위: [메시 ID, 관절 이름, 자리[x,y,z], 회전[rx,ry,rz] | 0, 크기(수 | [sx,sy,sz]), 색('skin' = look.color · 'eye' · hex)] (+ {dyn})
// 판정 끝점(tips): 근접 공격 ID → [관절, 로컬 점] — view.actors.test 가 판정 틱 자세에서 몸 중심까지 수평 거리를 r + reach 와 대조한다.

const PI = Math.PI;
const BONE = '#e2d8c0';
const DARK = '#2a2420';

/** 두 발 몸 부위 묶음(골반 · 몸통 · 머리 · 눈 · 팔 · 다리 · 발) — 반복을 줄인다 */
function bipedBody(o) {
  const L = o.limb ?? 'limb';
  const at = o.armT, lt = o.legT;
  const parts = [
    [o.pelvisMesh ?? 'pelvis', 'hips', [0, o.pelvisY ?? 0.02, 0], 0, o.pelvisS, o.pelvisC ?? 'skin'],
    [o.torsoMesh ?? 'torso', 'chest', [0, 0, o.torsoZ ?? 0], 0, o.torsoS, o.torsoC ?? 'skin'],
    [o.headMesh, 'head', [0, 0, 0], 0, o.headS, o.headC ?? 'skin'],
    ['eyes', 'head', [0, 0, 0], 0, o.headS, 'eye'],
  ];
  if (o.arms !== false) {
    for (const s of ['L', 'R']) {
      parts.push([L, 'sh' + s, [0, 0, 0], 0, [at, o.upper, at], o.armC ?? 'skin']);
      parts.push([L, 'el' + s, [0, 0, 0], 0, [at * 0.85, o.fore, at * 0.85], o.armC ?? 'skin']);
      if (o.hand) parts.push([o.hand, 'ha' + s, [0, 0, 0], 0, o.handS, o.handC ?? DARK]);
    }
  }
  if (o.legs !== false) {
    for (const s of ['L', 'R']) {
      parts.push([L, 'hip' + s, [0, 0, 0], 0, [lt, o.thigh, lt], o.legC ?? 'skin']);
      parts.push([L, 'kn' + s, [0, 0, 0], 0, [lt * 0.85, o.shin, lt * 0.85], o.legC ?? 'skin']);
      parts.push(['foot', 'an' + s, [0, 0, 0], 0, o.footS, o.footC ?? 'skin']);
    }
  }
  return parts;
}

/**
 * 변형 표
 * rig: biped · quad · blob · nest / tpl: 계약 템플릿 / dims: 리그 치수 / base: 기본 자세(부분) / gait: 걸음 / fam: 공격 ID → 공격 자세 / tips / eye: 눈 색
 */
export const VARIANTS = {
  // ── humanoid ──
  ghoul: {
    rig: 'biped', tpl: 'humanoid', eye: '#d8ff60',
    dims: { ankleY: 0.07, shin: 0.42, thigh: 0.4, hipX: 0.11, hipY: 0.82, footW: 0.19, torso: 0.66, shX: 0.26, shY: 0.6, shZ: 0.02, upper: 0.41, fore: 0.4, neck: 0.02, headZ: 0.1 },
    base: { SPITCH: 0.5, HPITCH: -0.42, LSHP: 0.3, RSHP: 0.3, LSHA: 0.16, RSHA: 0.16, LELB: 0.25, RELB: 0.25 },
    gait: { step: 0.55, refSpeed: 2.6, stance: 0.5, lift: 0.12, armSwing: 0.35, lean: 0.08, crouch: 0.02, bob: 0.03 },
    parts: bipedBody({ torsoMesh: 'torsoHunch', headMesh: 'headFlesh', pelvisS: [0.34, 0.2, 0.24], torsoS: [0.52, 0.66, 0.38], headS: 0.3,
      armT: 0.13, legT: 0.13, upper: 0.41, fore: 0.4, thigh: 0.4, shin: 0.42, footS: [0.11, 0.07, 0.15], hand: 'claws', handS: [0.13, 0.16, 0.13] }),
    fam: { claw: 'claw2' },
    tips: { claw: ['haR', [0, -0.16, 0]] },
  },
  archer: {
    rig: 'biped', tpl: 'humanoid', eye: '#ff3a2a',
    dims: { ankleY: 0.06, shin: 0.44, thigh: 0.43, hipX: 0.1, hipY: 0.92, footW: 0.15, torso: 0.52, shX: 0.22, shY: 0.48, shZ: -0.01, upper: 0.31, fore: 0.29, neck: 0.07, headZ: 0.02 },
    base: { SPITCH: 0.06, LSHP: 0.3, LSHA: 0.3, LELB: 0.45, LWRI: 2.3, RSHP: 0.12, RSHA: 0.3, RELB: 0.2 },
    gait: { step: 0.62, refSpeed: 3.2, stance: 0.5, lift: 0.14, armSwing: 0.3, lean: 0.06, crouch: 0.02, bob: 0.03 },
    parts: [
      ...bipedBody({ limb: 'bone', pelvisMesh: 'pelvisBone', torsoMesh: 'ribs', headMesh: 'skull', pelvisS: [0.3, 0.16, 0.18], torsoS: [0.4, 0.52, 0.28], headS: 0.245,
        armT: 0.07, legT: 0.08, upper: 0.31, fore: 0.29, thigh: 0.43, shin: 0.44, footS: [0.07, 0.06, 0.12] }),
      ['bow', 'wL', [0, 0, 0], 0, 1, '#ffffff'],
      ['bowString', 'wL', [0, 0, 0], 0, 1, '#ffffff', { dyn: 'stringA' }],
      ['bowString', 'wL', [0, 0, 0], 0, 1, '#ffffff', { dyn: 'stringB' }],
      ['arrow', 'wL', [0, 0, 0], 0, 1, '#ffffff', { dyn: 'arrow' }],
      ['quiver', 'chest', [0.08, 0.32, -0.17], [-0.25, 0, 0.2], 1, '#ffffff'],
    ],
    fam: { arrow: 'bowDraw' },
    tips: {},
    dead: { LWRI: PI / 2 },
  },
  shieldSkeleton: {
    rig: 'biped', tpl: 'humanoid', eye: '#ff4a2a', shield: true,
    dims: { ankleY: 0.06, shin: 0.45, thigh: 0.44, hipX: 0.11, hipY: 0.94, footW: 0.17, torso: 0.54, shX: 0.25, shY: 0.5, shZ: -0.01, upper: 0.32, fore: 0.3, neck: 0.07, headZ: 0.02 },
    base: { SPITCH: 0.08, LSHP: 0.55, LSHA: 0.28, LSHT: -1.5, LELB: 1.5, RSHP: 0.25, RSHA: 0.42, RELB: 0.55, RWRI: 1.75 },
    gait: { step: 0.6, refSpeed: 3.0, stance: 0.5, lift: 0.12, armSwing: 0.2, lean: 0.06, crouch: 0.02, bob: 0.03 },
    parts: [
      ...bipedBody({ limb: 'bone', pelvisMesh: 'pelvisBone', torsoMesh: 'ribs', headMesh: 'skull', pelvisS: [0.32, 0.16, 0.2], torsoS: [0.46, 0.54, 0.3], headS: 0.27,
        armT: 0.085, legT: 0.095, upper: 0.32, fore: 0.3, thigh: 0.44, shin: 0.45, footS: [0.08, 0.06, 0.13] }),
      ['helmRusty', 'head', [0, 0, 0], 0, 0.27, '#9a7a5a'],
      ['shieldBig', 'elL', [0, -0.17, 0.02], 0, 1, '#ffffff'],
      ['shortSword', 'wR', [0, 0, 0], 0, 1, '#ffffff'],
    ],
    fam: { shieldBash: 'shieldBash' },
    tips: { shieldBash: ['elL', [0.13, -0.17, 0.02]] },
  },
  boneGiant: {
    rig: 'biped', tpl: 'humanoid', eye: '#a8e8ff',
    dims: { ankleY: 0.15, shin: 1.08, thigh: 1.04, hipX: 0.3, hipY: 2.2, footW: 0.46, torso: 1.56, shX: 0.64, shY: 1.42, shZ: -0.02, upper: 0.8, fore: 0.74, neck: 0.14, headZ: 0.1 },
    base: { SPITCH: 0.16, HPITCH: -0.12, LSHP: 0.2, LSHA: 0.4, LELB: 0.4, RSHP: 0.35, RSHA: 0.38, RELB: 0.6, RWRI: 1.4 },
    gait: { step: 1.15, refSpeed: 3.2, stance: 0.55, lift: 0.3, armSwing: 0.22, lean: 0.06, crouch: 0.06, bob: 0.08 },
    parts: [
      ...bipedBody({ limb: 'bone', pelvisMesh: 'pelvisBone', torsoMesh: 'ribs', headMesh: 'skull', pelvisS: [0.8, 0.42, 0.46], torsoS: [1.3, 1.56, 0.86], headS: 0.72,
        armT: 0.4, legT: 0.46, upper: 0.8, fore: 0.74, thigh: 1.04, shin: 1.08, footS: [0.3, 0.15, 0.44] }),
      ['spineSpikes', 'chest', [0, 0, 0], 0, 1, '#ffffff'],
      ['club', 'wR', [0, 0, 0], 0, [1.6, 1, 1.6], '#ffffff'],
    ],
    fam: { swing: 'clubSwing', slam: 'slamDown', spikes: 'stabGround' },
    tips: { swing: ['wR', [0, 1.62, 0]] },
  },
  ashWitch: {
    rig: 'biped', tpl: 'humanoid', eye: '#ff7a2a', float: 0.28,
    dims: { ankleY: 0.08, shin: 0.48, thigh: 0.46, hipX: 0.1, hipY: 0.86, footW: 0.14, torso: 0.6, shX: 0.22, shY: 0.54, shZ: 0, upper: 0.36, fore: 0.34, neck: 0.06, headZ: 0.03 },
    base: { SPITCH: 0.1, HPITCH: -0.1, LSHP: 0.25, RSHP: 0.25, LSHA: 0.34, RSHA: 0.34, LELB: 0.5, RELB: 0.5 },
    gait: { step: 0.9, refSpeed: 4.0, stance: 0.5, lift: 0, armSwing: 0.1, lean: 0.18, crouch: 0, bob: 0 },
    parts: [
      ...bipedBody({ headMesh: 'hood', pelvisS: [0.3, 0.2, 0.22], torsoS: [0.4, 0.6, 0.28], headS: 0.32, legs: false,
        armT: 0.08, upper: 0.36, fore: 0.34, hand: 'claws', handS: [0.08, 0.16, 0.08], armC: '#3a302c', handC: '#1e1814', footS: [0.1, 0.08, 0.14] }),
      ['robe', 'hips', [0, 0.02, 0], 0, [1, 0.92, 1], 'skin'],
      ['ashRing', 'root', [0, 0, 0], 0, 1, '#ff8a3a', { dyn: 'spin' }],
    ],
    fam: { ashBolt: 'castFwd', emberRain: 'castUp', summon: 'castSpread' },
    tips: {},
  },
  // ── small ──
  fallen: {
    rig: 'biped', tpl: 'small', eye: '#ff5a2a',
    dims: { ankleY: 0.05, shin: 0.22, thigh: 0.21, hipX: 0.08, hipY: 0.42, footW: 0.12, torso: 0.3, shX: 0.15, shY: 0.27, shZ: 0, upper: 0.2, fore: 0.19, neck: 0.02, headZ: 0.05 },
    base: { SPITCH: 0.3, HPITCH: -0.22, LSHP: 0.35, RSHP: 0.4, LSHA: 0.5, RSHA: 0.5, LELB: 0.5, RELB: 0.7, RWRI: 1.7 },
    gait: { step: 0.5, refSpeed: 5.2, stance: 0.38, lift: 0.1, armSwing: 0.5, lean: 0.25, crouch: 0.03, bob: 0.03 },
    parts: [
      ...bipedBody({ headMesh: 'headImp', pelvisS: [0.22, 0.12, 0.17], torsoS: [0.3, 0.3, 0.25], headS: 0.32,
        armT: 0.08, legT: 0.09, upper: 0.2, fore: 0.19, thigh: 0.21, shin: 0.22, footS: [0.07, 0.05, 0.1] }),
      ['hornsSmall', 'head', [0, 0, 0], 0, 0.32, '#ffffff'],
      ['dagger', 'wR', [0, 0, 0], 0, 1, '#ffffff'],
    ],
    fam: { jab: 'jab' },
    tips: { jab: ['wR', [0, 0.35, 0]] },
  },
  shaman: {
    rig: 'biped', tpl: 'small', eye: '#7aff6a',
    dims: { ankleY: 0.05, shin: 0.23, thigh: 0.23, hipX: 0.08, hipY: 0.46, footW: 0.12, torso: 0.33, shX: 0.15, shY: 0.3, shZ: 0, upper: 0.21, fore: 0.2, neck: 0.02, headZ: 0.04 },
    base: { SPITCH: 0.22, HPITCH: -0.12, LSHP: 0.4, LSHA: 0.5, LELB: 0.55, LWRI: -0.25, RSHP: 0.3, RSHA: 0.55, RELB: 0.6 },
    gait: { step: 0.48, refSpeed: 3.6, stance: 0.45, lift: 0.09, armSwing: 0.3, lean: 0.15, crouch: 0.02, bob: 0.03 },
    parts: [
      ...bipedBody({ headMesh: 'headImp', pelvisS: [0.22, 0.12, 0.17], torsoS: [0.3, 0.32, 0.25], headS: 0.32,
        armT: 0.08, legT: 0.09, upper: 0.21, fore: 0.2, thigh: 0.22, shin: 0.22, footS: [0.07, 0.05, 0.1] }),
      ['mask', 'head', [0, 0, 0], 0, 0.32, '#ffffff'],
      ['feathers', 'head', [0, 0, 0], 0, 0.32, '#ffffff'],
      ['staffSkull', 'wL', [0, 0, 0], 0, 1, '#ffffff'],
    ],
    eyeAt: [0, 0, 0.035],
    fam: { shamanFire: 'castFwd', revive: 'channelUp' },
    tips: {},
  },
  boneling: {
    rig: 'biped', tpl: 'small', eye: '#9adfff',
    dims: { ankleY: 0.045, shin: 0.2, thigh: 0.19, hipX: 0.07, hipY: 0.38, footW: 0.1, torso: 0.26, shX: 0.13, shY: 0.24, shZ: 0, upper: 0.18, fore: 0.17, neck: 0.04, headZ: 0.03 },
    base: { SPITCH: 0.32, HPITCH: -0.25, LSHP: 0.45, RSHP: 0.45, LSHA: 0.42, RSHA: 0.42, LELB: 0.6, RELB: 0.6 },
    gait: { step: 0.42, refSpeed: 4.2, stance: 0.4, lift: 0.08, armSwing: 0.45, lean: 0.22, crouch: 0.02, bob: 0.02 },
    parts: bipedBody({ limb: 'bone', pelvisMesh: 'pelvisBone', torsoMesh: 'ribs', headMesh: 'skull', pelvisS: [0.18, 0.1, 0.12], torsoS: [0.22, 0.26, 0.17], headS: 0.27,
      armT: 0.05, legT: 0.055, upper: 0.18, fore: 0.17, thigh: 0.19, shin: 0.2, footS: [0.05, 0.045, 0.08], hand: 'claws', handS: [0.06, 0.2, 0.06], handC: BONE }),
    fam: { jab: 'jab' },
    tips: { jab: ['haR', [0, -0.2, 0]] },
  },
  ashling: {
    rig: 'biped', tpl: 'small', eye: '#ffa030',
    dims: { ankleY: 0.05, shin: 0.21, thigh: 0.2, hipX: 0.07, hipY: 0.4, footW: 0.11, torso: 0.28, shX: 0.14, shY: 0.26, shZ: 0, upper: 0.22, fore: 0.21, neck: 0.03, headZ: 0.03 },
    base: { SPITCH: 0.35, HPITCH: -0.3, LSHP: 0.4, RSHP: 0.4, LSHA: 0.4, RSHA: 0.4, LELB: 0.55, RELB: 0.55 },
    gait: { step: 0.45, refSpeed: 4.5, stance: 0.4, lift: 0.09, armSwing: 0.45, lean: 0.24, crouch: 0.02, bob: 0.02 },
    parts: [
      ...bipedBody({ headMesh: 'headAsh', pelvisS: [0.18, 0.11, 0.14], torsoS: [0.25, 0.28, 0.2], headS: 0.3,
        armT: 0.06, legT: 0.07, upper: 0.22, fore: 0.21, thigh: 0.2, shin: 0.21, footS: [0.06, 0.05, 0.09], hand: 'claws', handS: [0.07, 0.2, 0.07], handC: '#1a1210' }),
      ['embers', 'chest', [0, 0, 0], 0, [0.25, 0.28, 0.2], '#ff7a20'],
    ],
    fam: { claw: 'jab' },
    tips: { claw: ['haR', [0, -0.2, 0]] },
  },
  // ── quadruped ──
  charger: {
    rig: 'quad', tpl: 'quadruped', eye: '#ff3a1a',
    dims: { bodyY: 0.78, hipDrop: 0.18, legX: 0.2, legZf: 0.36, legZb: -0.38, upperF: 0.36, lowerF: 0.33, upperB: 0.37, lowerB: 0.33,
      neckY: 0.12, neckZ: 0.47, tailY: 0.1, tailZ: -0.48, ankleY: 0.06, footW: 0.2 },
    base: { HPITCH: 0.18 },
    gait: { step: 0.75, refSpeed: 3.8, stance: 0.5, lift: 0.14, armSwing: 0, lean: 0, crouch: 0.02, bob: 0.03 },
    parts: [
      ['qbody', 'body', [0, 0, 0], 0, [0.62, 0.58, 0.95], 'skin'],
      ['qhead', 'head', [0, 0, 0], 0, 0.36, 'skin'],
      ['horns', 'head', [0, 0, 0], 0, 1, BONE],
      ['eyes', 'head', [0, (0.16 - 0.56) * 0.36, (0.64 - 0.49) * 0.36], 0, 0.36, 'eye'],
      ['tail', 'tail', [0, 0, 0], [-0.6, 0, 0], [0.07, 0.38, 0.07], 'skin'],
      ...['fl', 'fr', 'bl', 'br'].flatMap((k) => [
        ['limb', k + 'H', [0, 0, 0], 0, [0.19, k[0] === 'f' ? 0.36 : 0.37, 0.19], 'skin'],
        ['limb', k + 'K', [0, 0, 0], 0, [0.13, 0.33, 0.13], 'skin'],
        ['foot', k + 'F', [0, 0, 0], 0, [0.13, 0.07, 0.11], DARK],
      ]),
    ],
    fam: { gore: 'gore', charge: 'stomp' },
    tips: { gore: ['head', [0.55, 0.3, 0.68]] },
  },
  // ── blob ──
  bloater: {
    rig: 'blob', tpl: 'blob', eye: '#f0ff40',
    dims: { bodyY: 0.78, footW: 0.22, ankleY: 0.1 },
    base: {},
    gait: { step: 0.38, refSpeed: 2.6, stance: 0.5, lift: 0.08, armSwing: 0, lean: 0, crouch: 0, bob: 0 },
    parts: [
      ['blobBody', 'body', [0, 0, 0], 0, 1, 'skin'],
      ['eyes', 'body', [0, -0.12, 0.0], 0, 0.62, 'eye'],
      ['stub', 'fL', [0, 0, 0], 0, [0.22, 0.2, 0.22], '#6a7a34'],
      ['stub', 'fR', [0, 0, 0], 0, [0.22, 0.2, 0.22], '#6a7a34'],
    ],
    fam: { burst: 'swell' },
    tips: {},
  },
  // ── nest ──
  nest: {
    rig: 'nest', tpl: 'nest', eye: '#ff2a2a',
    dims: { coreY: 0.55 },
    base: {},
    gait: { step: 1, refSpeed: 1, stance: 0.5, lift: 0, armSwing: 0, lean: 0, crouch: 0, bob: 0 },
    parts: [
      ['pile', 'pile', [0, 0, 0], 0, [1.8, 1.4, 1.8], 'skin'],
      ['ribPillars', 'pile', [0, 0, 0], 0, [1.75, 1.6, 1.75], 'skin'],
      ['core', 'core', [0, 0, 0], 0, 0.5, '#c01818'],
    ],
    fam: { spawn: 'pulse' },
    tips: {},
  },
};

/** 모르는 변형 → 템플릿 기본(데이터 색은 그대로) */
export const TEMPLATE_FALLBACK = { humanoid: 'ghoul', small: 'fallen', quadruped: 'charger', blob: 'bloater', nest: 'nest' };

/** 공격 자세 기본(변형 표에 없는 공격) — 공격 kind → 자세 */
export const KIND_FAMILY = { melee: 'jab', projectile: 'castFwd', cast: 'castUp', explode: 'swell', spawn: 'pulse', charge: 'stomp' };

// ───────────────────────── 공격 자세(두 발 · 부분 포즈 — '+' 는 기본에 더함 · 길이 값은 키 1.8m 기준 → 변형 크기로 늘린다) ─────────────────────────

export const BIPED_FAMILIES = {
  claw2: {
    wind: { LSHP: 2.75, RSHP: 2.75, LSHA: 0.42, RSHA: 0.42, LELB: 0.75, RELB: 0.75, '+SPITCH': -0.32, '+HPITCH': -0.25, '+HIPY': -0.03 },
    hit: { LSHP: 1.5, RSHP: 1.55, LSHA: 0.1, RSHA: 0.06, LELB: 0.08, RELB: 0.05, '+SPITCH': 0.1, '+HPITCH': 0.05, '+HIPZ': 0.18, LFZ: 0.32, RFZ: -0.12 },
  },
  jab: {
    wind: { RSHP: -0.5, RSHA: 0.25, RELB: 1.8, RWRI: 1.5, LSHP: 0.8, LSHA: 0.3, LELB: 0.7, '+SYAW': -0.38, '+HIPY': -0.05 },
    hit: { RSHP: 1.62, RSHA: 0.02, RELB: 0.04, RWRI: 3.1, LSHP: -0.3, LSHA: 0.35, LELB: 0.3, '+SPITCH': -0.05, '+SYAW': 0.35, '+HIPZ': 0.2, LFZ: 0.26, RFZ: -0.14 },
  },
  shieldBash: {
    wind: { LSHP: 0.95, LSHA: 0.3, LSHT: -1.5, LELB: 1.6, RSHP: 0.1, RELB: 0.9, '+SYAW': -0.1, '+HIPY': -0.08 },
    hit: { LSHP: 1.52, LSHA: 0.22, LSHT: -1.5, LELB: 0.92, RSHP: -0.25, RELB: 0.5, '+SYAW': 0.22, '+SPITCH': 0.4, '+HIPZ': 0.5, LFZ: 0.58, RFZ: -0.1 },
  },
  clubSwing: {
    wind: { RSHP: 0.5, RSHA: 1.55, RSHT: 0.7, RELB: 1.25, RWRI: 1.55, LSHP: 0.7, LSHA: 0.45, LELB: 0.6, '+SYAW': -0.75, '+SPITCH': -0.08 },
    hit: { RSHP: 1.0, RSHA: 0.22, RSHT: 0, RELB: 0.1, RWRI: 2.4, LSHP: -0.2, LSHA: 0.35, LELB: 0.3, '+SYAW': 0.3, '+SPITCH': 0.12, '+HIPZ': 0.1, LFZ: 0.42, RFZ: -0.18 },
  },
  bowDraw: {
    wind: { LSHP: 1.52, LSHA: 0.12, LSHT: 0, LELB: 0.02, LWRI: 0, RSHP: 1.42, RSHA: -0.2, RSHT: -0.2, RELB: 2.35, PROP: 1, '+SYAW': 0.5, '+HYAW': -0.42 },
    hit: { LSHP: 1.52, LSHA: 0.12, LSHT: 0, LELB: 0.02, LWRI: 0, RSHP: 1.2, RSHA: 0.32, RSHT: -0.2, RELB: 2.6, PROP: 0, '+SYAW': 0.5, '+HYAW': -0.42 },
  },
  castFwd: {
    wind: { RSHP: 0.45, RSHA: 0.35, RELB: 1.95, LSHP: 0.9, LELB: 1.2, '+SYAW': -0.25, GLOW: 1 },
    hit: { RSHP: 1.58, RSHA: 0.04, RELB: 0.05, RWRI: 2.4, LSHP: 0.2, LELB: 0.4, '+SYAW': 0.25, '+SPITCH': 0.08, GLOW: 0.3, LFZ: 0.16 },
  },
  castUp: {
    wind: { LSHP: 1.0, RSHP: 1.0, LELB: 1.25, RELB: 1.25, LSHA: 0.3, RSHA: 0.3, '+SPITCH': 0.1, GLOW: 0.6 },
    hit: { LSHP: 2.95, RSHP: 2.95, LELB: 0.12, RELB: 0.12, LSHA: 0.28, RSHA: 0.28, '+SPITCH': -0.18, '+HPITCH': -0.45, GLOW: 1 },
  },
  castSpread: {
    wind: { LSHP: 0.9, RSHP: 0.9, LSHA: 0.3, RSHA: 0.3, LELB: 1.35, RELB: 1.35, '+SPITCH': 0.25 },
    hit: { LSHP: 0.7, RSHP: 0.7, LSHA: 1.35, RSHA: 1.35, LELB: 0.1, RELB: 0.1, '+SPITCH': -0.15, '+HPITCH': -0.25 },
  },
  slamDown: {
    wind: { RSHP: 2.9, LSHP: 2.9, RELB: 0.9, LELB: 0.9, RSHA: 0.22, LSHA: 0.22, RWRI: 2.0, '+SPITCH': -0.22, '+HIPY': 0.02 },
    hit: { RSHP: 1.05, LSHP: 1.05, RELB: 0.1, LELB: 0.1, RSHA: 0.08, LSHA: 0.08, RWRI: 2.95, '+SPITCH': 0.72, '+HIPY': -0.14, '+HIPZ': 0.1, LFZ: 0.35, RFZ: -0.15 },
  },
  stabGround: {
    wind: { LSHP: 2.45, RSHP: 2.45, LSHA: 0.95, RSHA: 0.95, LELB: 0.5, RELB: 0.5, '+SPITCH': -0.25 },
    hit: { LSHP: 0.85, RSHP: 0.85, LSHA: 0.22, RSHA: 0.22, LELB: 0.1, RELB: 0.1, '+SPITCH': 0.85, '+HIPY': -0.18, LFZ: 0.3, RFZ: -0.1 },
  },
  channelUp: {
    wind: { LSHP: 2.55, RSHP: 2.4, LELB: 0.4, RELB: 0.5, LSHA: 0.3, RSHA: 0.42, '+SPITCH': -0.15, '+HPITCH': -0.38, GLOW: 1 },
    hit: { LSHP: 1.4, RSHP: 1.4, LELB: 0.2, RELB: 0.2, '+SPITCH': 0.2, GLOW: 0 },
  },
};

/** 네 발 공격 자세(QP 이름) */
export const QUAD_FAMILIES = {
  gore: {
    wind: { HPITCH: 0.62, BZ: -0.14, BY: -0.07, BPITCH: 0.1 },
    hit: { HPITCH: 0.02, BZ: 0.4, BY: -0.02, BPITCH: 0.02, FLZ: 0.66, FRZ: 0.52 },
  },
  stomp: {
    wind: { HPITCH: 0.55, BY: -0.08, BPITCH: 0.12, BZ: -0.05 },
    hit: { HPITCH: 0.5, BY: -0.04, BPITCH: 0.1, BZ: 0.05 },
  },
};
