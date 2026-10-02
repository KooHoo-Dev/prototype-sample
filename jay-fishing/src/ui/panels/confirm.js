// OWNER: P8 — 계약 §10.2
// STUB — UIRoot 내부 패널(모양은 P8 재량). W0 스텁 UIRoot 는 패널 이름 한 줄만 그린다.

/**
 * STUB
 * @param {{root:HTMLElement, sim:Object, actions:Object, bus:Object}} ctx
 * @returns {{id:'confirm', open(args?:Object):void, close():void, update(state:Object, dt:number):void, handleKey(e:KeyboardEvent):boolean, dispose():void}}
 */
export function createConfirmPanel(ctx) {
  void ctx;
  return {
    id: 'confirm',
    open(args) { void args; },
    close() {},
    update(state, dt) { void state; void dt; },
    handleKey(e) { void e; return false; },
    dispose() {},
  };
}
