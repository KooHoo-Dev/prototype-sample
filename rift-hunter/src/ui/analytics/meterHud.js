// OWNER: P12 — 계약 §10.9(계측 HUD)
// STUB — W2 에서 P12 가 채운다(meterView 를 0.25초마다 읽는 왼쪽 작은 표)

/** @param {any} ctx @returns {{update:(state:any, dtReal:number) => void, setVisible:(on:boolean) => void, dispose:() => void}} */
export function createMeterHud(ctx) {
  return { update(state, dtReal) {}, setVisible(on) {}, dispose() {} };
}
