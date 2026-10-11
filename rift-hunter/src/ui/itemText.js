// OWNER: P11 — 계약 §10.6 · §12.2(ui.panels.test — 순수 함수)
// STUB — W2 에서 P11 이 채운다(툴팁 줄 · 고급 티어 범위 · 비교 색 방향 — 순수)

/** 아이템 툴팁 줄 @param {any} item @param {{advanced?:boolean}} [opts] @returns {Array<{key:string, params?:Object}>} */
export function itemLines(item, opts = {}) {
  return [];
}

/** 장착 중인 것과의 비교 줄 @param {any} compare compareEquip 결과 @returns {Array<{key:string, params?:Object, dir:-1|0|1}>} */
export function compareLines(compare) {
  return [];
}
