// OWNER: P0 — 계약 §6.1 · §0 (W0 완성 · 이후 고치지 않는다 — 결함은 NOTES-P#)
// 구조 상수만 둔다. 밸런스 수치는 src/data/.

export const TICK_HZ = 30;
export const DT = 1 / 30;
export const MAX_STEPS_PER_FRAME = 5;
export const MAX_FRAME_DT = 0.25;

export const TILE = 2;
export const NAV_CELL = 0.5;
export const NAV_PER_TILE = 4;
export const TILE_VOID = 0, TILE_FLOOR = 1, TILE_WALL = 2;

/** 스킬 행동 길이의 기준 공격 속도 */
export const APS_REF = 1.4;

export const GAME_ID = 'rift-hunter';
export const GAME_VERSION = '0.1.0';
export const STATE_VERSION = 1;
export const SAVE_VERSION = 1;
export const SAVE_KEYS = {
  account: 'rift-hunter:account',
  charPrefix: 'rift-hunter:char:',
  settings: 'rift-hunter:settings',
  backupPrefix: 'rift-hunter:backup:',
};

export const CHAR_SLOTS = 4;
// 피드백 2 D4(Jay 결정 2026-10-12): 가방 40(8 × 5) → 30(6 × 5) — 도중 귀환이 쓰이게. 옛 세이브의 31~40번째는 보관함으로(save · GameSim.loadCharacter)
export const BAG_SIZE = 30;
export const BAG_COLS = 6;
export const STASH_SIZE = 60;
export const SKILL_BAR = 5;
export const LEVEL_CAP = 30;

export const CLASS_IDS = ['warrior', 'mage'];
export const EQUIP_SLOTS = ['mainHand', 'offhand', 'helm', 'chest', 'gloves', 'boots', 'belt', 'amulet', 'ring1', 'ring2'];
export const ITEM_SLOTS = ['mainHand', 'offhand', 'helm', 'chest', 'gloves', 'boots', 'belt', 'amulet', 'ring'];
export const RARITIES = ['normal', 'magic', 'rare', 'legendary', 'set'];
export const MON_RANKS = ['normal', 'champion', 'elite', 'minion', 'guardian', 'split', 'spawn'];
export const DMG_TYPES = ['phys', 'fire', 'cold', 'lightning'];
export const MATERIAL_IDS = ['scrap', 'dust', 'essence'];
export const TILESET_IDS = ['crypt', 'cavern', 'town'];
export const RIFT_PHASES = ['active', 'guardian', 'complete', 'collapsed'];
export const PLAYER_ACTS = ['idle', 'move', 'attack', 'cast', 'channel', 'dash', 'leap', 'blink', 'recall', 'dead'];
export const MON_ACTS = ['idle', 'move', 'windup', 'strike', 'recover', 'cast', 'channel', 'charge', 'stunned', 'frozen', 'flinch', 'swell', 'flee', 'vanish', 'spawning', 'dead'];
export const MON_TEMPLATES = ['humanoid', 'small', 'quadruped', 'blob', 'nest'];
export const PANEL_IDS = [
  'title', 'charSelect', 'newChar', 'pause', 'settings', 'help', 'death', 'riftComplete', 'confirm', 'hint', 'map',
  'inventory', 'skills', 'character', 'blacksmith', 'general', 'gambler', 'mystic', 'stash', 'riftStone', 'analytics',
];
export const HINT_IDS = ['controls', 'labels', 'elites', 'bagFull', 'death', 'skills', 'gauge', 'town'];
export const TOWN_OBJECT_IDS = ['blacksmith', 'general', 'gambler', 'mystic', 'stash', 'riftStone', 'townPortal'];
export const SHOP_IDS = ['blacksmith', 'general', 'gambler', 'mystic'];

// 카메라(§0.2 · §9.3) — view 전용이지만 sim 밖의 여러 레이어(렌더러 · 카메라 · 봇 시야 산수)가 같은 값을 본다.
/** 방위(rad) — 카메라는 대상의 +X+Z 쪽 위 */
export const CAM_AZIMUTH = Math.PI / 4;
/** 앙각 55°(rad) */
export const CAM_ELEVATION = (55 * Math.PI) / 180;
/** 세로 시야각(도) */
export const CAM_FOV = 40;
/** 기본 거리 · 줌 범위(m) · 휠 한 칸 */
export const CAM_DISTANCE = 24, CAM_DISTANCE_MIN = 16, CAM_DISTANCE_MAX = 32, CAM_ZOOM_STEP = 2;
/** 카메라 쪽 앞당김 = CAM_LEAD × 거리 */
export const CAM_LEAD = 0.12;
