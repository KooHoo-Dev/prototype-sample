// OWNER: P2 — 계약 §6.8 · §11.5
// STUB — W1 에서 P2 가 채운다(광선 → 마우스 아래 대상 · 원기둥 · 상자). W0: null

/**
 * STUB — 순수 · ray = {ox, oy, oz, dx, dy, dz}(월드) → Hover|null(src 'pick')
 * @param {import('../types.js').GameState} state @param {import('../types.js').MapData|null} map
 * @param {{ox:number, oy:number, oz:number, dx:number, dy:number, dz:number}} ray @param {{kinds?:string[]}} [opts]
 * @returns {import('../types.js').Hover|null}
 */
export function pickHover(state, map, ray, { kinds = ['monster', 'drop', 'object'] } = {}) {
  return null;
}
