// OWNER: P12 — 계약 §10.9(세션 기록 내려받기)
// STUB — W2 에서 P12 가 채운다(순수 — 이스케이프 · 열 순서). W0: JSON 은 그대로 · CSV 는 머리줄만

/** @param {import('../../types.js').RunRecord[]} records @returns {string} */
export function toJson(records) {
  return JSON.stringify(records ?? [], null, 2);
}

/** @param {import('../../types.js').RunRecord[]} records @returns {string} */
export function toCsv(records) {
  return '';
}
