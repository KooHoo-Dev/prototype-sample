// OWNER: P12 — 계약 §10.9(세션 기록 내려받기)
// 세션 기록(char.records — RunRecord[])을 JSON · CSV 문자열로. 순수(DOM 없음 — Node 테스트가 import 한다).
// 내려받기는 app 이 한다(actions.downloadFile(name, mime, text) — Blob · a[download]).
//
// CSV 규칙(RFC 4180 — 표 계산기 · 다른 도구가 그대로 다시 읽는다):
//  - 열 순서 고정: CSV_COLUMNS(RunRecord 의 필드 — 중첩 객체 kills · drops 는 'kills.normal' 처럼 점으로 편다) → 그 뒤에 기록에만 있는
//    필드(계약 밖에서 더해진 것)를 처음 본 순서로 덧붙인다 — 어떤 값도 버리지 않는다.
//  - 쉼표 · 큰따옴표 · 줄바꿈(CR · LF)이 든 칸은 큰따옴표로 감싸고 안의 큰따옴표는 두 번 쓴다. 줄 끝은 CRLF.
//  - 숫자는 String(n)(로케일 쉼표 없음 · 소수점은 점) · NaN · Infinity · null · undefined 는 빈 칸 · 참/거짓은 true/false ·
//    배열과 (펴지 않은) 객체는 JSON 문자열(한 칸).

/** @typedef {import('../../types.js').RunRecord} RunRecord */

/** 고정 열 — 이 순서로 나간다(계약 §3.9 RunSummary + RunRecord 의 at · charLevel) */
export const CSV_COLUMNS = Object.freeze([
  'at', 'charLevel', 'level', 'seed', 'tileset', 'cls', 'result', 'timeSec',
  'kills.normal', 'kills.champion', 'kills.elite', 'kills.minion', 'kills.guardian', 'kills.other',
  'deaths',
  'drops.normal', 'drops.magic', 'drops.rare', 'drops.legendary', 'drops.set',
  'gold', 'xp', 'upgrades', 'recalls', 'maxTargeting', 'swarmMoments', 'unlockedTo', 'noDeath', 'record',
]);

/** 점으로 펴는 중첩 객체 필드 */
const NESTED = new Set(['kills', 'drops']);

/** @param {unknown} v @returns {v is Record<string, unknown>} */
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** 기록 배열만(배열이 아니면 빈 배열 · 객체가 아닌 칸은 건너뛴다) @param {unknown} records @returns {Array<Record<string, unknown>>} */
function recordList(records) {
  if (!Array.isArray(records)) return [];
  /** @type {Array<Record<string, unknown>>} */
  const out = [];
  for (const r of records) if (isPlainObject(r)) out.push(r);
  return out;
}

/**
 * 기록 하나 → 평평한 {열: 값} — kills · drops 같은 중첩 객체는 'kills.normal' 꼴로 한 단계 편다
 * @param {Record<string, unknown>} rec @returns {Map<string, unknown>}
 */
function flatten(rec) {
  /** @type {Map<string, unknown>} */
  const out = new Map();
  for (const key of Object.keys(rec)) {
    const v = rec[key];
    if (NESTED.has(key) && isPlainObject(v)) {
      for (const sub of Object.keys(v)) out.set(key + '.' + sub, v[sub]);
    } else out.set(key, v);
  }
  return out;
}

/**
 * 칸 하나의 문면(이스케이프 포함)
 * @param {unknown} v @returns {string}
 */
export function csvCell(v) {
  let s;
  if (v === null || v === undefined) s = '';
  else if (typeof v === 'number') s = Number.isFinite(v) ? String(v) : '';
  else if (typeof v === 'boolean') s = v ? 'true' : 'false';
  else if (typeof v === 'string') s = v;
  else if (typeof v === 'bigint') s = String(v);
  else {
    try { s = JSON.stringify(v) ?? ''; } catch { s = ''; }
  }
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/**
 * 열 목록 — 고정 열 + 기록에만 있는 열(처음 본 순서)
 * @param {Array<Map<string, unknown>>} rows @returns {string[]}
 */
function columnsOf(rows) {
  const cols = CSV_COLUMNS.slice();
  const seen = new Set(cols);
  for (const row of rows) {
    for (const k of row.keys()) {
      if (!seen.has(k)) { seen.add(k); cols.push(k); }
    }
  }
  return cols;
}

/**
 * 세션 기록 → JSON(들여쓰기 2) — 받은 배열 그대로(기록이 아닌 칸은 뺀다). JSON.parse 로 같은 값이 돌아온다(NaN · Infinity 는 JSON 규칙대로 null).
 * @param {RunRecord[]} records @returns {string}
 */
export function toJson(records) {
  return JSON.stringify(recordList(records), null, 2);
}

/**
 * 세션 기록 → CSV(머리줄 + 기록마다 한 줄 · CRLF · 끝에도 CRLF). 기록이 없으면 머리줄만.
 * @param {RunRecord[]} records @returns {string}
 */
export function toCsv(records) {
  const rows = recordList(records).map(flatten);
  const cols = columnsOf(rows);
  const lines = [cols.map(csvCell).join(',')];
  for (const row of rows) {
    const cells = new Array(cols.length);
    for (let i = 0; i < cols.length; i++) cells[i] = csvCell(row.get(cols[i]));
    lines.push(cells.join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

/**
 * 기록의 누적 합(세션 탭 맨 아래 줄 · 순수) — 판 수 · 시간 · 처치 · 사망 · 드랍 · 골드 · 경험치 · 업그레이드 · 결과별 판 수
 * @param {RunRecord[]} records
 */
export function sumRecords(records) {
  const out = {
    runs: 0, timeSec: 0, deaths: 0, gold: 0, xp: 0, upgrades: 0,
    kills: { normal: 0, champion: 0, elite: 0, minion: 0, guardian: 0, other: 0 },
    drops: { normal: 0, magic: 0, rare: 0, legendary: 0, set: 0 },
    results: { complete: 0, collapse: 0, abandon: 0 },
  };
  /** @param {unknown} v */
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  for (const r of recordList(records)) {
    out.runs += 1;
    out.timeSec += num(r.timeSec);
    out.deaths += num(r.deaths);
    out.gold += num(r.gold);
    out.xp += num(r.xp);
    out.upgrades += num(r.upgrades);
    const k = isPlainObject(r.kills) ? r.kills : {};
    for (const key of Object.keys(out.kills)) out.kills[/** @type {keyof typeof out.kills} */ (key)] += num(k[key]);
    const d = isPlainObject(r.drops) ? r.drops : {};
    for (const key of Object.keys(out.drops)) out.drops[/** @type {keyof typeof out.drops} */ (key)] += num(d[key]);
    const res = typeof r.result === 'string' ? r.result : '';
    if (res === 'complete' || res === 'collapse' || res === 'abandon') out.results[res] += 1;
  }
  return out;
}
