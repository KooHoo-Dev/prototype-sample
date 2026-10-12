// OWNER: P0 — 계약 §6.1 (W0 완성 · 이후 고치지 않는다 — 결함은 NOTES-P#)
// 공간 해시 — 상태가 아니다(ctx.space · 틱마다 다시 만든다). 순수 JS.

const OFF = 4096;   // 음수 칸 좌표도 받는다
const SPAN = 8192;

export class SpatialHash {
  /** @param {number} [cell] 칸 크기(m) */
  constructor(cell = 2) {
    this.cell = cell;
    /** @type {Map<number, number[]>} 칸 키 → id(삽입 순) */
    this._cells = new Map();
    /** @type {Map<number, number>} id → 삽입 순번 */
    this._order = new Map();
    this._seq = 0;
  }

  clear() {
    this._cells.clear();
    this._order.clear();
    this._seq = 0;
  }

  _key(cx, cz) { return (cx + OFF) * SPAN + (cz + OFF); }

  /** 원이 걸치는 칸마다 등록 @param {number} id @param {number} x @param {number} z @param {number} r */
  insert(id, x, z, r) {
    if (!this._order.has(id)) this._order.set(id, this._seq++);
    const c = this.cell;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const z0 = Math.floor((z - r) / c), z1 = Math.floor((z + r) / c);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const k = this._key(cx, cz);
        const list = this._cells.get(k);
        if (list) list.push(id);
        else this._cells.set(k, [id]);
      }
    }
  }

  /**
   * 그 원과 칸이 겹치는 id(중복 없이 · 삽입 순) — 칸 단위라 실제 겹침은 부르는 쪽이 본다
   * @param {number} x @param {number} z @param {number} r @param {number[]} [out]
   * @returns {number[]}
   */
  query(x, z, r, out = []) {
    const c = this.cell;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const z0 = Math.floor((z - r) / c), z1 = Math.floor((z + r) / c);
    const seen = new Set();
    const found = [];
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const list = this._cells.get(this._key(cx, cz));
        if (!list) continue;
        for (const id of list) {
          if (seen.has(id)) continue;
          seen.add(id);
          found.push(id);
        }
      }
    }
    found.sort((a, b) => /** @type {number} */ (this._order.get(a)) - /** @type {number} */ (this._order.get(b)));
    for (const id of found) out.push(id);
    return out;
  }

  /** 등록된 id 수 */
  get size() { return this._order.size; }
}
