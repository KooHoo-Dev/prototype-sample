// OWNER: P9 — 계약 §11.7
// 개발용 URL 쿼리 해석(순수 — location.search 문자열만 받는다 · Node 테스트가 부른다).
// dev = 세이브를 읽지도 쓰지도 않는 개발 세션. ?panel · ?analytics 만 있으면 dev 가 아니다(세이브를 쓴다).
// 그 밖의 알려진 쿼리(fresh · class · level · preset · rift · seed · scene · fixture · bot · strategy)가 하나라도 있으면 dev.
// 모르는 키(utm 등)는 무시한다 — dev 로 바꾸지 않는다(세이브가 말없이 멈추지 않게).
// ?panel 이 캐릭터 상태를 필요로 하는데 캐릭터를 만드는 쿼리가 없으면 고정 상태를 함께 띄운다(PANEL_FIXTURE) — 그때는 dev(고정 상태를 세이브에 쓰지 않게).

import { CLASS_IDS, LEVEL_CAP, PANEL_IDS } from '../core/constants.js';
import { fnv1a } from '../core/hash.js';
import { RIFT } from '../data/rift.js';

/** @typedef {import('../types.js').PanelId} PanelId */

/**
 * @typedef {Object} Query
 * @property {boolean} dev            세이브를 읽지도 쓰지도 않는다
 * @property {boolean} fresh          ?fresh=1 — 타이틀 없이 새 캐릭터 화면(캐릭터를 만드는 쿼리가 없을 때)
 * @property {import('../types.js').ClassId|null} cls
 * @property {number|null} level      1..LEVEL_CAP
 * @property {number|null} preset     0|1
 * @property {number|null} rift       1..RIFT.maxLevel
 * @property {number|null} seed       uint32
 * @property {'town'|'rift'|null} scene
 * @property {PanelId|null} panel
 * @property {string|null} fixture
 * @property {boolean} bot
 * @property {'basic'|'noDodge'|'challenge'} strategy
 * @property {boolean} analytics
 * @property {boolean} makeChar       개발용 캐릭터를 만든다(고정 상태가 없고 fresh 단독이 아닐 때)
 * @property {string|null} panelFixture   ?panel 이 필요로 해 함께 띄우는 고정 상태 ID
 */

/** 개발 세션으로 만드는 키 */
export const DEV_KEYS = ['fresh', 'class', 'level', 'preset', 'rift', 'seed', 'scene', 'fixture', 'bot', 'strategy'];
/** 캐릭터를 만드는 키(fresh · fixture 를 뺀 dev 키) */
const CHAR_KEYS = ['class', 'level', 'preset', 'rift', 'seed', 'scene', 'bot', 'strategy'];
export const STRATEGIES = ['basic', 'noDodge', 'challenge'];

/** 캐릭터 없이 뜨는 패널(타이틀 화면 위에서도 뜻이 있다) */
export const NO_STATE_PANELS = ['title', 'charSelect', 'newChar', 'pause', 'settings', 'help', 'confirm', 'analytics'];
/** 캐릭터 상태가 필요한 패널 → 함께 띄울 고정 상태(§11.7 「필요한 상태가 없으면 고정 상태를 함께 — 예: 상점 패널은 마을」) */
export const PANEL_FIXTURE = Object.freeze({
  inventory: 'bag', character: 'bag', stash: 'bag', skills: 'skillTree',
  blacksmith: 'shops', general: 'shops', gambler: 'shops', mystic: 'shops',
  riftStone: 'town', hint: 'town', map: 'riftSwarm', death: 'riftDeath', riftComplete: 'riftComplete',
});

/** 참 값 — '1' · 'true' · 'yes' · 'on' · 빈 값(?bot) @param {string|null} v */
function truthy(v) {
  if (v === null) return false;
  const s = v.trim().toLowerCase();
  return s === '' || s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

/** 정수 ∈ [lo, hi] · 숫자가 아니면 null @param {string|null} v @param {number} lo @param {number} hi */
function intIn(v, lo, hi) {
  if (v === null || v.trim() === '') return null;
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return null;
  return Math.max(lo, Math.min(hi, n));
}

/** 시드 — 10진 정수면 그 값(uint32) · 그 밖의 글자면 그 글자의 fnv1a @param {string|null} v */
export function parseSeed(v) {
  if (v === null) return null;
  const s = v.trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s) >>> 0;
  return parseInt(fnv1a(s), 16) >>> 0;
}

/**
 * location.search → Query
 * @param {string} search 예: '?class=mage&level=20' (앞의 ? 는 있어도 없어도 된다)
 * @returns {Query}
 */
export function parseQuery(search) {
  let p;
  try { p = new URLSearchParams(typeof search === 'string' ? search : ''); } catch { p = new URLSearchParams(''); }
  const has = (k) => p.has(k);
  const get = (k) => p.get(k);

  const clsRaw = get('class');
  const cls = clsRaw !== null && CLASS_IDS.includes(clsRaw.trim()) ? /** @type {any} */ (clsRaw.trim()) : null;
  const sceneRaw = (get('scene') ?? '').trim();
  const scene = sceneRaw === 'town' || sceneRaw === 'rift' ? sceneRaw : null;
  const panelRaw = (get('panel') ?? '').trim();
  const panel = PANEL_IDS.includes(panelRaw) ? /** @type {PanelId} */ (panelRaw) : null;
  const fixtureRaw = (get('fixture') ?? '').trim();
  const fixture = fixtureRaw || null;
  const stratRaw = (get('strategy') ?? '').trim();
  const strategy = /** @type {'basic'|'noDodge'|'challenge'} */ (STRATEGIES.includes(stratRaw) ? stratRaw : 'basic');

  const fresh = has('fresh') && truthy(get('fresh'));
  const bot = has('bot') && truthy(get('bot'));
  const analytics = has('analytics') && truthy(get('analytics'));

  let dev = DEV_KEYS.some((k) => has(k));
  const makeChar = !fixture && CHAR_KEYS.some((k) => has(k));
  let panelFixture = null;
  if (panel && !fixture && !makeChar && !NO_STATE_PANELS.includes(panel)) {
    panelFixture = PANEL_FIXTURE[panel] ?? null;
    if (panelFixture) dev = true;
  }

  return {
    dev,
    fresh,
    cls,
    level: intIn(get('level'), 1, LEVEL_CAP),
    preset: intIn(get('preset'), 0, 1),
    rift: intIn(get('rift'), 1, RIFT.maxLevel),
    seed: parseSeed(get('seed')),
    scene,
    panel,
    fixture,
    bot,
    strategy,
    analytics,
    makeChar,
    panelFixture,
  };
}
