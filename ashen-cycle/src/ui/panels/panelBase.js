// OWNER: P8 — 패널 공통 뼈대(§10.1 「패널 키 조작」 · §10.3). ui 내부 파일이다.
// 포커스는 「행 × 칸」 격자다: navigate(0, ±1)은 행을, navigate(±1, 0)은 칸을 옮긴다(조절 항목이면 값을 바꾼다).
// 버튼은 DOM 포커스를 받지 않는다(div) — 포커스는 .focused 클래스로만 그린다.
import { el, add, clear, fmtInt } from '../dom.js';
import { t } from '../i18n.js';

/** @typedef {import('../../types.js').PanelId} PanelId */
/** @typedef {import('../../types.js').CmdResult} CmdResult */

/**
 * 포커스를 받는 항목 하나.
 * @typedef {Object} FocusItem
 * @property {string} key                     다시 그린 뒤에도 같은 항목을 찾는 이름
 * @property {HTMLElement} el
 * @property {(()=>CmdResult|void)|null} activate  confirm · 클릭
 * @property {((dx:number)=>void)|null} adjust     navigate(±1, 0) — 슬라이더 · 고르기
 * @property {string|null} denied             null이 아니면 실행하지 않고 이 사유(reason.<id>)로 거절한다
 */

/**
 * UIRoot가 패널에 넘기는 것.
 * @typedef {Object} PanelCtx
 * @property {PanelId} id
 * @property {Object} params
 * @property {{bus:Object, sim:Object, progression:Object, settings:Object, actions:Object}} deps
 * @property {Object} memory                  세션 동안 남는 기억(마지막으로 올린 능력치 등)
 * @property {()=>boolean} ready              입력 지연이 지났는가
 * @property {()=>boolean} pointerMoved       방금의 mousemove가 실제 이동이었는가(좌표가 바뀌었다)
 * @property {(kind:'hover'|'click'|'confirm'|'deny')=>void} sound
 * @property {()=>void} close
 */

const MSG_HOLD_MS = 2200;
/**
 * 「한 번 더 누르면 확정」의 두 번째 입력을 받기 시작하는 시각(무장 뒤 ms). 더블클릭 · E 연타의 둘째 입력이
 * 확인 문구를 읽기도 전에 확정이 되지 않게 — 그 안의 입력은 무시한다.
 */
export const ARM_CONFIRM_DELAY_MS = 700;
const SHAKE_CLASS = 'ac-shake';
const PULSE_CLASS = 'ac-pulse';

export class Panel {
  /**
   * @param {PanelCtx} ctx
   * @param {{title?:string, closable?:boolean, wide?:boolean}} [opts]
   */
  constructor(ctx, opts = {}) {
    this.ctx = ctx;
    this.id = ctx.id;
    /** @type {FocusItem[][]} */
    this.rows = [];
    this.r = 0;
    this.c = 0;
    /** @type {string|null} */
    this.focusKey = null;
    /** 열쇠 → 함수. UIRoot가 패널 전용 단축키로 쓴다(결과 패널의 KeyR). @type {Record<string, ()=>void>} */
    this.hotkeys = {};
    this._msgTimer = 0;
    /** 확인 대기 중인 항목(confirmTwice) @type {FocusItem|null} */
    this._armedItem = null;
    this._armedAt = 0;

    this.el = el('div', `ac-panel ac-panel-${ctx.id}`);
    this.el.setAttribute('role', 'dialog');
    this.head = el('div', 'ac-panel-head');
    this.titleEl = el('h2', 'ac-heading', opts.title ?? t(`panel.${ctx.id}.title`));
    this.headRight = el('div', 'ac-panel-head-right');
    add(this.head, this.titleEl, this.headRight);
    this.body = el('div', 'ac-panel-body');
    this.msg = el('div', 'ac-panel-msg');
    this.foot = el('div', 'ac-panel-foot');
    this.hintEl = el('div', 'ac-panel-hints');
    add(this.foot, this.hintEl);
    if (opts.closable) {
      this.closeBtn = el('div', 'ac-btn ac-btn-close', t('panel.close'));
      this.closeBtn.setAttribute('role', 'button');
      this.closeBtn.addEventListener('click', () => {
        if (!this.ctx.ready()) return;
        this.ctx.sound('click');
        this.ctx.close();
      });
      add(this.foot, this.closeBtn);
    }
    add(this.el, this.head, this.body, this.msg, this.foot);
    // 흔들림 · 번쩍임은 끝나면 뗀다(남아 있으면 다음 연출을 가린다)
    this.el.addEventListener('animationend', (e) => e.target.classList.remove(SHAKE_CLASS, PULSE_CLASS));
  }

  // ── 하위 클래스가 채운다 ──

  /** body를 채우고 this.row(...)로 포커스 항목을 등록한다. */
  build() {}

  /** 열릴 때의 기본 포커스(항목 key). @returns {string|null} */
  defaultFocus() {
    return null;
  }

  /** 열리는 순간 한 번(그리기 전). */
  onOpen() {}

  /** 닫히는 순간 한 번. */
  onClose() {}

  /** SETTINGS_CHANGED를 받았다. */
  onSettings() {}

  /** Q · 게임패드 B. 기본은 닫기(시설 패널). */
  cancel() {
    this.ctx.sound('click');
    this.ctx.close();
  }

  // ── 수명 ──

  open() {
    this.onOpen();
    this.focusKey = null;
    this.render();
  }

  destroy() {
    clearTimeout(this._msgTimer);
    this.onClose();
    this.el.remove();
  }

  /** 다시 그린다(포커스는 key로 유지). PROFILE_CHANGED마다 불린다. */
  render() {
    const key = this.focusKey;
    clear(this.body);
    this.rows = [];
    this._armedItem = null; // 다시 그리면 확인 대기는 풀린다(버튼이 새로 만들어진다)
    this.build();
    if (!(key !== null && this._focusByKey(key))) {
      const def = this.defaultFocus();
      if (!(key === null && def !== null && this._focusByKey(def))) this._clampFocus();
    }
    this._paintFocus();
  }

  // ── 포커스 항목 만들기 ──

  /**
   * 항목을 만든다(행에는 this.row로 넣는다).
   * @param {HTMLElement} node
   * @param {string} key
   * @param {{activate?:()=>CmdResult|void, adjust?:(dx:number)=>void, denied?:string|null}} [opts]
   * @returns {FocusItem}
   */
  item(node, key, opts = {}) {
    /** @type {FocusItem} */
    const it = { key, el: node, activate: opts.activate ?? null, adjust: opts.adjust ?? null, denied: opts.denied ?? null };
    node.classList.add('ac-focusable');
    // hover는 마우스가 실제로 움직였을 때만 포커스를 옮긴다 — 다시 그린 뒤 가만히 있는 커서 밑에 새 요소가 생겨도
    // (브라우저가 합성 마우스 이벤트를 낸다) 키보드로 잡은 포커스를 빼앗지 않는다.
    node.addEventListener('mousemove', () => {
      if (this.ctx.ready() && this.ctx.pointerMoved()) this._focusItem(it, true);
    });
    node.addEventListener('click', () => {
      if (!this.ctx.ready()) return;
      this._focusItem(it, false);
      this._activate(it);
    });
    return it;
  }

  /**
   * 버튼 항목.
   * @param {string} label
   * @param {string} key
   * @param {()=>CmdResult|void} activate
   * @param {{cls?:string, denied?:string|null}} [opts]
   * @returns {FocusItem}
   */
  button(label, key, activate, opts = {}) {
    const node = el('div', `ac-btn ${opts.cls ?? ''}`, label);
    node.setAttribute('role', 'button');
    return this.item(node, key, { activate, denied: opts.denied ?? null });
  }

  /** 포커스를 받지 않는 죽은 버튼(저장이 없을 때의 [이어하기]). @param {string} label @returns {HTMLElement} */
  deadButton(label) {
    const node = el('div', 'ac-btn ac-disabled', label);
    node.setAttribute('aria-disabled', 'true');
    return node;
  }

  /** 포커스 행을 하나 등록한다. @param {...FocusItem} items */
  row(...items) {
    const list = items.filter(Boolean);
    if (list.length) this.rows.push(list);
  }

  // ── 입력 ──

  /** @param {number} dx @param {number} dy */
  navigate(dx, dy) {
    if (!this.rows.length) return;
    const before = this.current();
    if (dy) {
      const n = this.rows.length;
      this.r = (this.r + (dy > 0 ? 1 : -1) + n) % n;
      this.c = Math.min(this.c, this.rows[this.r].length - 1);
    } else if (dx) {
      if (before?.adjust) {
        before.adjust(dx > 0 ? 1 : -1);
        this.ctx.sound('hover');
        return;
      }
      const row = this.rows[this.r];
      this.c = Math.max(0, Math.min(row.length - 1, this.c + (dx > 0 ? 1 : -1)));
    }
    const now = this.current();
    if (now !== before) {
      this.focusKey = now.key;
      this._paintFocus();
      this.onFocusChange(now);
      this.ctx.sound('hover');
    }
  }

  confirm() {
    this._activate(this.current());
  }

  /** 포커스가 옮겨졌다(미리보기 갱신용). @param {FocusItem} item */
  onFocusChange(item) {}

  /** @returns {FocusItem|null} */
  current() {
    return this.rows[this.r]?.[this.c] ?? null;
  }

  // ── 되돌릴 수 없는 버튼의 확인 ──

  /**
   * 「한 번 더 누르면 확정」. 첫 입력은 그 항목을 무장만 하고(붉은 테두리) false, 무장 뒤 ARM_CONFIRM_DELAY_MS가
   * 지난 다음의 입력에 true를 돌려준다. 그 사이의 입력(더블클릭 · 연타의 둘째)은 무시한다(false).
   * @param {FocusItem} item
   * @returns {boolean} 확정해도 되는가
   */
  confirmTwice(item) {
    const now = performance.now();
    if (this._armedItem !== item) {
      this.disarm();
      this._armedItem = item;
      this._armedAt = now;
      item.el.classList.add('ac-armed');
      return false;
    }
    return now - this._armedAt >= ARM_CONFIRM_DELAY_MS;
  }

  /** 지금 확인을 기다리는 항목(없으면 null). @returns {FocusItem|null} */
  get armed() {
    return this._armedItem;
  }

  /** 확인 대기를 푼다. @returns {boolean} 풀 것이 있었는가 */
  disarm() {
    const item = this._armedItem;
    if (!item) return false;
    this._armedItem = null;
    item.el.classList.remove('ac-armed');
    return true;
  }

  // ── 피드백 ──

  /**
   * 명령 결과에 따라 소리 · 흔들림 · 사유 문구.
   * @param {FocusItem|null} item
   * @param {string} reason CmdResult.reason
   */
  fail(item, reason) {
    this.ctx.sound('deny');
    this.say(t(`reason.${reason ?? 'invalid'}`), true);
    const node = item?.el;
    if (!node) return;
    node.classList.remove(SHAKE_CLASS);
    void node.offsetWidth; // 연타해도 흔들림이 다시 시작되게
    node.classList.add(SHAKE_CLASS);
  }

  /** 패널 아래 한 줄 안내(잠깐 뒤 사라진다). @param {string} text @param {boolean} [bad] */
  say(text, bad = false) {
    this.msg.textContent = text;
    this.msg.classList.toggle('ac-bad', bad);
    this.msg.classList.add('ac-show');
    clearTimeout(this._msgTimer);
    this._msgTimer = setTimeout(() => this.msg.classList.remove('ac-show'), MSG_HOLD_MS);
  }

  /** 아래쪽 조작 안내 줄. @param {...string} keys 문자열 키 */
  hints(...keys) {
    clear(this.hintEl);
    for (const k of keys) add(this.hintEl, el('span', 'ac-hint', t(k)));
  }

  /** 머리줄 오른쪽의 지갑(잔불 · 파편). @param {boolean} withShards */
  wallet(withShards) {
    const p = this.ctx.deps.progression?.profile ?? {};
    clear(this.headRight);
    add(this.headRight, add(el('span', 'ac-wallet-chip ac-ember'), el('i', 'ac-ico ac-ico-ember'), el('span', '', t('panel.wallet.embers', { n: fmtInt(p.embers) }))));
    if (withShards) {
      add(this.headRight, add(el('span', 'ac-wallet-chip ac-shard'), el('i', 'ac-ico ac-ico-shard'), el('span', '', t('panel.wallet.shards', { n: fmtInt(p.shards) }))));
    }
  }

  // ── 내부 ──

  /** @param {FocusItem|null} item */
  _activate(item) {
    if (!item) return;
    if (item.denied !== null) {
      this.fail(item, item.denied);
      return;
    }
    if (!item.activate) return;
    const res = item.activate();
    if (res && res.ok === false) {
      this.fail(item, res.reason);
    } else if (res && res.ok === true) {
      this.ctx.sound('confirm');
      this.msg.classList.remove('ac-show');
      // 성공하면 PROFILE_CHANGED로 다시 그려졌다 — 새로 그려진 같은 자리를 한 번 번쩍인다
      const node = this.current()?.el;
      if (node) {
        node.classList.remove(PULSE_CLASS);
        void node.offsetWidth;
        node.classList.add(PULSE_CLASS);
      }
    } else {
      this.ctx.sound('click');
    }
  }

  /** @param {FocusItem} item @param {boolean} hover 마우스가 올라와 옮긴 것이면 소리를 낸다 */
  _focusItem(item, hover) {
    for (let r = 0; r < this.rows.length; r++) {
      const c = this.rows[r].indexOf(item);
      if (c < 0) continue;
      if (r === this.r && c === this.c && this.focusKey === item.key) return;
      this.r = r;
      this.c = c;
      this.focusKey = item.key;
      this._paintFocus();
      this.onFocusChange(item);
      if (hover) this.ctx.sound('hover');
      return;
    }
  }

  /** @param {string} key @returns {boolean} */
  _focusByKey(key) {
    for (let r = 0; r < this.rows.length; r++) {
      for (let c = 0; c < this.rows[r].length; c++) {
        if (this.rows[r][c].key === key) {
          this.r = r;
          this.c = c;
          this.focusKey = key;
          return true;
        }
      }
    }
    return false;
  }

  _clampFocus() {
    if (!this.rows.length) {
      this.r = 0;
      this.c = 0;
      this.focusKey = null;
      return;
    }
    this.r = Math.max(0, Math.min(this.rows.length - 1, this.r));
    this.c = Math.max(0, Math.min(this.rows[this.r].length - 1, this.c));
    this.focusKey = this.rows[this.r][this.c].key;
  }

  _paintFocus() {
    const cur = this.current();
    for (const row of this.rows) {
      for (const it of row) it.el.classList.toggle('focused', it === cur);
    }
    // 작은 창에서 body가 스크롤될 때만 따라간다(scrollIntoView는 페이지 자체를 밀 수 있어 쓰지 않는다)
    const body = this.body;
    if (cur && body.scrollHeight > body.clientHeight + 1) {
      const a = cur.el.getBoundingClientRect();
      const b = body.getBoundingClientRect();
      if (a.top < b.top) body.scrollTop -= b.top - a.top;
      else if (a.bottom > b.bottom) body.scrollTop += a.bottom - b.bottom;
    }
  }
}
