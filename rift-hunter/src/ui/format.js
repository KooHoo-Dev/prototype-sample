// OWNER: P10 — 계약 §10.8(숫자 표시 · 순수)
// 화면에 나가는 숫자의 꼴 하나. NaN · Infinity 가 화면에 「NaN」으로 나가지 않는다(— · ∞).
// 순수(DOM · Intl 없음 — 로케일에 따라 바뀌지 않게 직접 쉼표를 찍는다).

const DASH = '—';

/** 정수 부분에 천 단위 쉼표 @param {number} n 0 이상의 정수 @returns {string} */
function groupInt(n) {
  const s = String(n);
  if (s.length <= 3) return s;
  let out = '';
  const head = s.length % 3;
  if (head) out = s.slice(0, head);
  for (let i = head; i < s.length; i += 3) out += (out ? ',' : '') + s.slice(i, i + 3);
  return out;
}

/**
 * 반올림한 정수 · 천 단위 쉼표 — 1234567 → '1,234,567' · −42.6 → '-43' · NaN → '—' · ±Infinity → '∞'/'-∞'
 * @param {number} v @returns {string}
 */
export function fmtInt(v) {
  if (typeof v !== 'number' || Number.isNaN(v)) return DASH;
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '-∞';
  const r = Math.round(v);
  if (r === 0) return '0';
  return (r < 0 ? '-' : '') + groupInt(Math.abs(r));
}

/**
 * 소수 d 자리(뒤의 0 은 지운다) · 천 단위 쉼표 — 12.50 → '12.5' · 1234.5 → '1,234.5'
 * @param {number} v @param {number} [d] @returns {string}
 */
export function fmtNum(v, d = 1) {
  if (typeof v !== 'number' || Number.isNaN(v)) return DASH;
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '-∞';
  const k = Math.max(0, Math.min(6, Math.floor(d)));
  let s = Math.abs(v).toFixed(k);
  if (k > 0) s = s.replace(/\.?0+$/, '');
  const dot = s.indexOf('.');
  const ip = dot < 0 ? s : s.slice(0, dot);
  const fp = dot < 0 ? '' : s.slice(dot);
  const body = groupInt(Number(ip)) + fp;
  return body === '0' || v >= 0 ? body : '-' + body;
}

/**
 * 비율(0..1) → 퍼센트 — fmtPct(0.123, 1) → '12.3%' · −0 은 '0%'
 * @param {number} v @param {number} [d] 소수 자리 @returns {string}
 */
export function fmtPct(v, d = 0) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return DASH;
  const k = Math.max(0, Math.min(6, Math.floor(d)));
  const s = (v * 100).toFixed(k);
  return (Number(s) === 0 ? (0).toFixed(k) : s) + '%';
}

/**
 * 초 → 'm:ss' (한 시간 이상이면 'h:mm:ss') · 음수 · NaN 은 '0:00'
 * @param {number} sec @returns {string}
 */
export function fmtSec(sec) {
  const s = typeof sec === 'number' && Number.isFinite(sec) && sec > 0 ? Math.round(sec) : 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/**
 * 짧은 초(쿨다운 · 버프 남은 시간) — 10초 미만은 소수 한 자리 · 그 위는 정수 · 0 이하는 ''
 * @param {number} sec @returns {string}
 */
export function fmtCd(sec) {
  if (typeof sec !== 'number' || !Number.isFinite(sec) || sec <= 0) return '';
  return sec < 10 ? (Math.ceil(sec * 10) / 10).toFixed(1) : String(Math.ceil(sec));
}

/**
 * DPS — 100 미만은 소수 한 자리 · 그 위는 정수(쉼표)
 * @param {number} v @returns {string}
 */
export function fmtDps(v) {
  if (typeof v !== 'number' || Number.isNaN(v)) return DASH;
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '-∞';
  return Math.abs(v) >= 100 ? fmtInt(v) : fmtNum(v, 1).replace(/^(-?\d+)$/, '$1.0');
}

/**
 * [a, b] → 'a–b'(반올림 · 같으면 하나) · 배열이 아니면 '—'
 * @param {[number, number]|number[]} r @returns {string}
 */
export function fmtRange(r) {
  if (!Array.isArray(r) || r.length < 2) return DASH;
  const a = fmtInt(r[0]);
  const b = fmtInt(r[1]);
  return a === b ? a : `${a}–${b}`;
}

/**
 * 배율 → '×1.25'(뒤의 0 은 지운다)
 * @param {number} v @param {number} [d] @returns {string}
 */
export function fmtMul(v, d = 2) {
  return '×' + fmtNum(v, d);
}

/**
 * 피해 숫자(떠오르는 숫자) — 정수로 반올림하되, 0보다 크고 1 미만이면 소수 한 자리(최소 0.1).
 * 최종 게이트: 균열 1~4 는 첫 판 경사(피해 ×0.03~×0.10)로 몬스터 한 방이 0.3 안팎이라 「0」이 떠오르는데 생명은 줄었다.
 * @param {number} v @returns {string}
 */
export function fmtDmg(v) {
  if (typeof v === 'number' && v > 0 && v < 0.95) return fmtNum(Math.max(0.1, v), 1);
  return fmtInt(v);
}

/**
 * 스킬 칸 아이콘 글자(두 글자) — 여러 낱말이면 낱말마다 첫 글자(「지면 강타」 → 「지강」), 한 낱말이면 앞 두 글자(「지진」).
 * 한 글자만 쓰면 같은 클래스 안에서 겹쳤다(지면 강타 · 지진 → 「지」 · 마력 화살 · 마력 보호막 → 「마」 — 화면 패스).
 * @param {string} name @returns {string}
 */
export function skillGlyph(name) {
  const s = String(name ?? '').trim();
  if (!s) return '';
  const words = s.split(/\s+/);
  if (words.length >= 2) return words[0].charAt(0) + words[1].charAt(0);
  return s.slice(0, 2);
}
