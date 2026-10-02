// OWNER: P0 — 계약 §6.1 (완전 구현 · 웨이브 1부터 고치지 않는다)

/** 고정 틱(초). GameSim.step(dt, input)의 dt는 항상 이 값이다. */
export const DT = 1 / 60;
export const TAU = Math.PI * 2;
export const EPS = 1e-6;
export const MAX_STEPS_PER_FRAME = 5;
export const MAX_FRAME_DT = 0.1;
export const GAME_VERSION = '0.1.0';
export const SAVE_KEY = 'ashen-cycle/save';
/** 읽지 못한 세이브 원문을 옮겨 두는 곳 */
export const SAVE_BACKUP_KEY = 'ashen-cycle/save.bak';
export const SETTINGS_KEY = 'ashen-cycle/settings';
export const SAVE_VERSION = 1;
/** 해금 순서 */
export const BOSS_IDS = ['valder', 'fenrir', 'nihil'];
export const WEAPON_IDS = ['longsword', 'greatsword', 'spear'];
export const STAT_IDS = ['vit', 'end', 'str', 'dex'];
export const FACILITY_IDS = ['bonfire', 'blacksmith', 'merchant', 'gate'];
export const PANEL_IDS = ['title', 'pause', 'bonfire', 'blacksmith', 'merchant', 'gate', 'result'];
/** BOSS_CUE.cue 어휘(§4.2 · 부록 A) — validateBossDef 규칙 7과 fx · audio가 같은 목록을 본다 */
export const CUE_IDS = [
  'roar', 'howl', 'slam', 'stomp', 'whoosh', 'charge_start', 'land', 'cast',
  'blink_out', 'blink_in', 'breath_start', 'breath_end', 'beam_start', 'beam_end',
  'enchant', 'shatter',
];
/** 투사체 kind(부록 A) */
export const PROJECTILE_KINDS = ['void_orb'];
/** 장판 kind(부록 A) */
export const HAZARD_KINDS = ['shockwave', 'fire_trail', 'fire_pillar', 'ice_spike', 'void_burst', 'void_sword'];
