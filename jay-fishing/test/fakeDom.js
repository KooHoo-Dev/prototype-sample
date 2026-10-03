// OWNER: P9 — 리뷰 수정(ui-app): Node 에서 UIRoot · 패널을 세우는 최소 가짜 DOM + `.css` import 를 비우는 로더.
// 테스트 파일이 `await installFakeDom()` 뒤에 UIRoot 를 동적 import 한다(.css 는 로더가 빈 모듈로).
// 실제 배치(offsetTop · 스크롤)는 흉내 내지 않는다 — 패널 스택 · 안내 · 알림 같은 상태 규칙을 보는 데만 쓴다.

import { register } from 'node:module';

class FakeClassList {
  /** @param {FakeElement} owner */
  constructor(owner) { this.owner = owner; }
  _list() { return this.owner.className ? this.owner.className.split(/\s+/).filter(Boolean) : []; }
  add(...cs) { const l = this._list(); for (const c of cs) if (!l.includes(c)) l.push(c); this.owner.className = l.join(' '); }
  remove(...cs) { this.owner.className = this._list().filter(c => !cs.includes(c)).join(' '); }
  contains(c) { return this._list().includes(c); }
  toggle(c, force) {
    const on = force === undefined ? !this.contains(c) : !!force;
    if (on) this.add(c); else this.remove(c);
    return on;
  }
}

class FakeText {
  /** @param {string} s */
  constructor(s) { this.textContent = s; this.parentElement = null; }
  remove() { if (this.parentElement) this.parentElement._detach(this); }
}

export class FakeElement {
  /** @param {string} tag */
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.className = '';
    this.classList = new FakeClassList(this);
    /** @type {Array<FakeElement|FakeText>} */
    this.children = [];
    /** @type {FakeElement|null} */
    this.parentElement = null;
    this._text = '';
    this.hidden = false;
    this.innerHTML = '';
    this.scrollTop = 0;
    this.attributes = {};
    /** @type {Record<string, Function[]>} */
    this._l = {};
    this.style = { setProperty(k, v) { this[k] = v; } };
  }

  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  set textContent(v) {
    for (const c of this.children) c.parentElement = null;
    this.children = [];
    this._text = String(v);
  }

  /** @param {any} n @param {number} i */
  _insert(n, i) {
    const node = typeof n === 'string' ? new FakeText(n) : n;
    if (node.parentElement) node.parentElement._detach(node);
    node.parentElement = this;
    this.children.splice(Math.min(i, this.children.length), 0, node);
  }

  /** @param {any} n */
  _detach(n) {
    const i = this.children.indexOf(n);
    if (i >= 0) this.children.splice(i, 1);
    n.parentElement = null;
  }

  append(...ns) { for (const n of ns) this._insert(n, this.children.length); }
  appendChild(n) { this.append(n); return n; }
  prepend(...ns) { ns.forEach((n, i) => this._insert(n, i)); }
  after(...ns) {
    const p = this.parentElement;
    if (!p) return;
    let i = p.children.indexOf(this) + 1;
    for (const n of ns) p._insert(n, i++);
  }
  before(...ns) {
    const p = this.parentElement;
    if (!p) return;
    let i = p.children.indexOf(this);
    for (const n of ns) p._insert(n, i++);
  }
  remove() { if (this.parentElement) this.parentElement._detach(this); }
  replaceChildren(...ns) {
    for (const c of this.children) c.parentElement = null;
    this.children = [];
    this._text = '';
    this.append(...ns);
  }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
  addEventListener(n, fn) { (this._l[n] || (this._l[n] = [])).push(fn); }
  removeEventListener(n, fn) { const a = this._l[n] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
  /** @param {string} n @param {Object} [e] */
  dispatch(n, e = {}) {
    for (const fn of (this._l[n] || []).slice()) fn({ preventDefault() {}, stopPropagation() {}, cancelable: true, target: this, ...e });
  }
  click() { this.dispatch('click'); }
  scrollIntoView() {}
  get offsetTop() { return 0; }

  /** 자손을 깊이 우선으로(자기 포함) @returns {FakeElement[]} */
  all() {
    const out = [this];
    for (const c of this.children) if (c instanceof FakeElement) out.push(...c.all());
    return out;
  }

  /** 이 클래스를 가진 첫 자손 @param {string} cls @returns {FakeElement|null} */
  find(cls) {
    return this.all().find(n => n.classList.contains(cls)) || null;
  }
}

let installed = false;

/** 전역 document(createElement)와 .css 로더를 건다 — 한 프로세스에서 한 번 */
export function installFakeDom() {
  if (installed) return;
  installed = true;
  register('data:text/javascript,export async function load(url, ctx, next){ if (url.endsWith(".css")) return {format:"module", source:"", shortCircuit:true}; return next(url, ctx); }');
  /** @type {any} */ (globalThis).document = { createElement: (tag) => new FakeElement(tag) };
}

/** 메모리 Storage(localStorage 흉내) — 두 「탭」이 같은 것을 쓰면 같은 저장소 */
export class MemStorage {
  constructor() { this.map = new Map(); }
  get length() { return this.map.size; }
  key(i) { return [...this.map.keys()][i] ?? null; }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}
