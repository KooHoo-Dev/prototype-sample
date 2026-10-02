// OWNER: P8 — 계약 §6.11 · §10.3
// STUB — UIRoot 내부(다른 패키지는 import 하지 않는다). W0 의 최소 HUD 는 UIRoot 가 직접 그린다. P8 이 모양을 정한다.

/**
 * STUB
 * @param {HTMLElement} root @returns {{update(state:Object, dt:number):void, dispose():void}}
 */
export function createHud(root) {
  void root;
  return { update(state, dt) { void state; void dt; }, dispose() {} };
}
