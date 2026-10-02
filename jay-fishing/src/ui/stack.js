// OWNER: P8 — 계약 §10.4 (UIRoot 내부 — 다른 패키지는 import 하지 않는다)
// 패널 스택 규칙만 담은 순수 객체(DOM 없음 — Node 테스트가 규칙을 직접 본다).
//   바탕 패널(title · tackle · result · sell · pc · camp · map · bed) 위에 confirm · pause 가 겹친다(깊이 ≤ 3).
//   openPanel(바탕) = 바탕 교체(위의 겹친 패널도 닫는다) · openPanel(겹침) = 위에 쌓기 · pause 가 맨 위면 confirm 만 · title 은 스택을 비우고 연다.
//   결과 · 타이틀 바탕은 title 말고는 교체되지 않는다(고를 때까지 · 포커스 잃음 pause 가 지우지 않는다 — 겹칠 뿐).

export const OVERLAY_PANELS = ['pause', 'confirm'];
export const BASE_PANELS = ['title', 'tackle', 'result', 'sell', 'pc', 'camp', 'map', 'bed'];
export const MAX_DEPTH = 3;
/** 바탕 교체를 거부하는 바탕(title 로만 바뀐다) */
const STICKY_BASE = ['title', 'result'];

/**
 * @typedef {{id:string, args:Object, key:number}} StackEntry
 * @typedef {{entry:StackEntry, depth:number}} StackChange   depth: 열린 뒤 깊이(opened) · 닫은 뒤 남은 깊이(closed)
 * @typedef {{ok:boolean, opened:StackChange[], closed:StackChange[]}} StackResult
 */

export class PanelStack {
  constructor() {
    /** @type {StackEntry[]} */
    this.entries = [];
    this._key = 0;
  }

  get depth() { return this.entries.length; }

  /** @returns {StackEntry|null} */
  get top() { return this.entries.length ? this.entries[this.entries.length - 1] : null; }

  /** @returns {StackEntry|null} */
  get base() { return this.entries.length ? this.entries[0] : null; }

  /** @param {string} id @returns {boolean} */
  has(id) { return this.entries.some(e => e.id === id); }

  /**
   * @param {string} id @param {Object} [args]
   * @returns {StackResult}
   */
  open(id, args = {}) {
    /** @type {StackResult} */
    const r = { ok: false, opened: [], closed: [] };
    const known = OVERLAY_PANELS.includes(id) || BASE_PANELS.includes(id);
    if (!known) return r;
    const top = this.top;
    if (id === 'title') {
      while (this.entries.length) this._pop(r);
      this._push(id, args, r);
      return r;
    }
    if (top && top.id === 'pause' && id !== 'confirm') return r;
    if (OVERLAY_PANELS.includes(id)) {
      if (this.entries.length >= MAX_DEPTH) return r;
      if (top && top.id === id && id === 'pause') return r;
      this._push(id, args, r);
      return r;
    }
    // 바탕 교체
    const base = this.base;
    if (base && STICKY_BASE.includes(base.id)) return r;
    while (this.entries.length) this._pop(r);
    this._push(id, args, r);
    return r;
  }

  /** 맨 위 하나를 닫는다 @returns {StackResult} */
  close() {
    /** @type {StackResult} */
    const r = { ok: false, opened: [], closed: [] };
    if (!this.entries.length) return r;
    this._pop(r);
    r.ok = true;
    return r;
  }

  /**
   * 그 id 의 패널을 스택 어디에 있든 뺀다(자가 동기화 — 결과 단계가 끝났는데 남은 result).
   * 그 위에 겹친 패널은 그대로 남는다(겹침만 남으면 바탕 없이 겹침이 맨 아래가 된다).
   * @param {string} id @returns {StackResult}
   */
  remove(id) {
    /** @type {StackResult} */
    const r = { ok: false, opened: [], closed: [] };
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (this.entries[i].id !== id) continue;
      const [e] = this.entries.splice(i, 1);
      r.closed.push({ entry: e, depth: this.entries.length });
      r.ok = true;
    }
    return r;
  }

  /** @param {string} id @param {Object} args @param {StackResult} r */
  _push(id, args, r) {
    const e = { id, args: args || {}, key: ++this._key };
    this.entries.push(e);
    r.opened.push({ entry: e, depth: this.entries.length });
    r.ok = true;
  }

  /** @param {StackResult} r */
  _pop(r) {
    const e = /** @type {StackEntry} */ (this.entries.pop());
    r.closed.push({ entry: e, depth: this.entries.length });
  }
}
