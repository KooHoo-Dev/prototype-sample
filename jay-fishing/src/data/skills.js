// OWNER: P4 — 계약 §7.7 · §8.4
// SEED — P0 이 W0 에 계약 값 그대로 넣었다. 조정은 소유 패키지만 §7.0 규칙 안에서(🔒 값은 밸런스 게이트만).
// effects: Modifiers 필드 → [0단계, 1, 2, 3]. 한 필드는 스킬 하나만 건드린다(스키마 테스트).

/** @typedef {import('../types.js').SkillDef} SkillDef */

/** @type {SkillDef[]} */
export const SKILLS = [
  { id: 'casting',   effects: { castMul: [1.00, 1.06, 1.12, 1.20], perfectWindow: [0.06, 0.09, 0.12, 0.15] } },
  { id: 'hookset',   effects: { hookWindowAdd: [0, 0.12, 0.24, 0.36], earlyBaitKeep: [0, 0.25, 0.50, 0.75] } },
  { id: 'dragSense', effects: { dragNotches: [20, 25, 30, 40], lineStrMul: [1.00, 1.04, 1.08, 1.12] } },
  { id: 'lineCare',  effects: { slackRateMul: [1, 0.8, 0.65, 0.5], abrasionMul: [1, 0.8, 0.65, 0.5] } },
  { id: 'pumping',   effects: { pumpDrainMul: [1, 1.15, 1.30, 1.45], jumpPumpMul: [1, 0.75, 0.55, 0.40] } },
  { id: 'knowledge', effects: { knowledge: [0, 1, 2, 3] } },
  { id: 'baitCraft', effects: { biteRateMul: [1, 1.08, 1.16, 1.25], baitKeepOnFail: [0, 0.15, 0.30, 0.45] } },
  { id: 'netting',   effects: { netRangeAdd: [0, 0.5, 1.0, 1.5], landStaminaAdd: [0, 0.05, 0.10, 0.15] } },
  { id: 'haggling',  effects: { sellMul: [1.00, 1.05, 1.10, 1.15] } },
  { id: 'mastery',   effects: { signalMul: [1, 1.15, 1.30, 1.50], tier3Unlocked: [false, false, true, true] } },
];
