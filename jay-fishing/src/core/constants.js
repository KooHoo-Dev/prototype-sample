// OWNER: P0 — 계약 §6.1 (W0 완성 · 이후 고치지 않는다 — 결함은 NOTES-P#)
// 틱 · 시간 단위 · 저장 키 · 열거 ID. 수치 규칙은 계약 §0.1.

export const DT = 1 / 60;
export const TICK_HZ = 60;
export const TICKS_PER_MINUTE = 150;          // 게임 1분
export const TICKS_PER_HOUR = 9000;           // 게임 1시간 = 실제 150초
export const TICKS_PER_DAY = 216000;          // 게임 하루 = 실제 3600초
export const MAX_STEPS_PER_FRAME = 8;
export const MAX_FRAME_DT = 0.25;
export const GAME_ID = 'jay-fishing';
export const GAME_VERSION = '0.1.0';
export const STATE_VERSION = 1;
export const SAVE_VERSION = 1;
export const SAVE_KEY = 'jay-fishing:save';
export const SAVE_BACKUP_KEY = 'jay-fishing:save.bak';   // 접두사 — 백업은 `${SAVE_BACKUP_KEY}.<ms>` 최신 3개 · 목록 `${SAVE_BACKUP_KEY}.index`(§11.5)
export const SETTINGS_KEY = 'jay-fishing:settings';
export const SCENE_IDS = ['home', 'lake', 'coast', 'river'];
export const STAGE_IDS = ['lake', 'coast', 'river'];
export const BAND_IDS = ['dawn', 'morning', 'day', 'evening', 'night'];
export const WEATHER_IDS = ['clear', 'cloudy', 'rain'];
export const LAYER_IDS = ['surface', 'mid', 'bottom'];
export const SET_IDS = ['float', 'bottom'];
export const BAIT_IDS = ['worm', 'paste', 'corn', 'shrimp', 'krill', 'live'];
export const GEAR_SLOTS = ['rod', 'reel', 'line', 'hook', 'float', 'sinker'];
export const SKILL_IDS = ['casting', 'hookset', 'dragSense', 'lineCare', 'pumping', 'knowledge', 'baitCraft', 'netting', 'haggling', 'mastery'];
export const STYLE_IDS = ['heavy', 'runner', 'thrasher', 'jumper', 'diver', 'small'];
export const BEHAVIOR_KINDS = ['run', 'rest', 'turn', 'jump', 'dive', 'shake', 'hold', 'charge'];
export const BODY_TEMPLATES = ['fusiform', 'compressed', 'eel', 'shark', 'benthic'];
export const TIERS = ['normal', 'trophy', 'legend'];
export const FAIL_REASONS = ['lineBreak', 'spoolEmpty', 'rodBreak', 'hookOff', 'early', 'late'];
export const RIG_PHASES = ['idle', 'ready', 'charging', 'casting', 'waiting', 'retrieving', 'bite', 'fighting', 'landing', 'result', 'failed'];
export const INTERACT_KINDS = ['spot', 'npc', 'camp', 'pc', 'bed', 'door'];
export const PANEL_IDS = ['title', 'pause', 'tackle', 'result', 'sell', 'pc', 'camp', 'map', 'bed', 'confirm'];
export const HINT_IDS = ['start', 'stage', 'controls', 'cast', 'bite', 'fight', 'net', 'drift', 'bottomRig', 'holdFull'];
