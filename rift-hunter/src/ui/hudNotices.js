// OWNER: P10 — 계약 §10.1(notice · setSticky) · §10.2(hint 비모달 6) · §10.3(알림 열 · 배너) — P10 내부 파일(UIRoot 만 import 한다)
// 알림 열(오른쪽 가운데 · 3초 · 최대 4) · 큰 안내(비모달 · 6초 · 최대 2 — 대상 프레임 · 플레이어를 가리지 않는 오른쪽 위) · 배너(화면 가운데 위 2.5초) · 지속 알림(왼쪽 위).
// 시간은 update(dt)의 실제 초로 민다(CSS 전환에 기대지 않는다 — 숨은 창 · step 정지 화면에서도 같은 모양).

const NOTICE_MAX = 4;
const NOTICE_SEC = 3;
const NOTICE_FADE = 0.35;
const BIG_MAX = 2;
const BIG_SEC = 6;
const BANNER_SEC = 2.5;
const BANNER_FADE = 0.3;
/** 같은 문면이 이 초 안에 다시 오면 새 줄 대신 시간을 늘린다 */
const DEDUP_SEC = 1.5;

/**
 * @param {{root:HTMLElement}} deps
 */
export function createNotices({ root }) {
  const layer = root.appendChild(document.createElement('div'));
  layer.className = 'notice-layer';
  const sticky = layer.appendChild(document.createElement('div'));
  sticky.className = 'notice-sticky';
  sticky.hidden = true;
  const bigCol = layer.appendChild(document.createElement('div'));
  bigCol.className = 'notice-big-col';
  const col = layer.appendChild(document.createElement('div'));
  col.className = 'notice-col';
  const banner = layer.appendChild(document.createElement('div'));
  banner.className = 'hud-banner';
  banner.hidden = true;

  /** @type {Array<{el:HTMLElement, text:string, left:number, total:number}>} */
  const items = [];
  /** @type {Array<{el:HTMLElement, left:number, total:number, onShown?:() => void}>} */
  const bigs = [];
  /** @type {Array<{title:string, body:string, more:string, sec:number, onShown?:() => void}>} */
  const bigWait = [];
  let bannerLeft = 0;
  let bannerTotal = 0;

  const api = {
    layer,
    /** @param {string} text @param {number} [sec] */
    push(text, sec = NOTICE_SEC) {
      if (!text) return;
      for (const it of items) {
        if (it.text === text && it.total - it.left < DEDUP_SEC) {
          it.left = Math.max(it.left, sec);
          it.total = it.left;
          it.el.classList.remove('is-out');
          it.el.style.opacity = '';
          return;
        }
      }
      while (items.length >= NOTICE_MAX) {
        const old = items.shift();
        old?.el.remove();
      }
      const e = col.appendChild(document.createElement('div'));
      e.className = 'notice';
      e.textContent = text;
      items.push({ el: e, text, left: sec, total: sec });
    },
    /**
     * 큰 안내(비모달) — 제목 · 본문 · 꼬리 줄. 둘이 떠 있으면 기다린다. onShown 은 화면에 붙는 순간(markHint).
     * @param {{title?:string, body:string, more?:string, sec?:number, onShown?:() => void}} card
     */
    big({ title = '', body, more = '', sec = BIG_SEC, onShown }) {
      bigWait.push({ title, body, more, sec, onShown });
      flushBig();
    },
    /** @param {string} text @param {number} [sec] */
    banner(text, sec = BANNER_SEC) {
      if (!text) return;
      banner.textContent = text;
      banner.hidden = false;
      banner.style.opacity = '1';
      bannerLeft = sec;
      bannerTotal = sec;
    },
    /** @param {string|null} text */
    sticky(text) {
      sticky.textContent = text || '';
      sticky.hidden = !text;
    },
    /** 지금 떠 있는 알림 문면(디버그 · 테스트) */
    texts() { return items.map(i => i.text); },
    bigCount() { return bigs.length + bigWait.length; },
    /** @param {number} dt 실제 초 */
    update(dt) {
      if (!(dt > 0)) return;
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        it.left -= dt;
        if (it.left <= 0) {
          it.el.remove();
          items.splice(i, 1);
        } else if (it.left < NOTICE_FADE) {
          it.el.style.opacity = String(it.left / NOTICE_FADE);
        }
      }
      for (let i = bigs.length - 1; i >= 0; i--) {
        const b = bigs[i];
        b.left -= dt;
        if (b.left <= 0) {
          b.el.remove();
          bigs.splice(i, 1);
        } else if (b.left < NOTICE_FADE) {
          b.el.style.opacity = String(b.left / NOTICE_FADE);
        }
      }
      if (bigWait.length && bigs.length < BIG_MAX) flushBig();
      if (bannerLeft > 0) {
        bannerLeft -= dt;
        const since = bannerTotal - bannerLeft;
        const a = bannerLeft <= 0 ? 0 : Math.min(1, since / BANNER_FADE, bannerLeft / BANNER_FADE);
        banner.style.opacity = String(a);
        if (bannerLeft <= 0) banner.hidden = true;
      }
    },
    /** 장면 · 캐릭터가 바뀌었다 — 알림 열 · 배너만 지운다(큰 안내 · 지속 알림은 남는다) */
    clearTransient() {
      for (const it of items) it.el.remove();
      items.length = 0;
      bannerLeft = 0;
      banner.hidden = true;
    },
    dispose() { layer.remove(); },
  };

  function flushBig() {
    while (bigWait.length && bigs.length < BIG_MAX) {
      const c = /** @type {NonNullable<ReturnType<typeof bigWait.shift>>} */ (bigWait.shift());
      const e = bigCol.appendChild(document.createElement('div'));
      e.className = 'notice-big';
      if (c.title) {
        const h = e.appendChild(document.createElement('div'));
        h.className = 'notice-big-title';
        h.textContent = c.title;
      }
      const b = e.appendChild(document.createElement('div'));
      b.className = 'notice-big-body';
      b.textContent = c.body;
      if (c.more) {
        const m = e.appendChild(document.createElement('div'));
        m.className = 'notice-big-more';
        m.textContent = c.more;
      }
      bigs.push({ el: e, left: c.sec, total: c.sec });
      c.onShown?.();
    }
  }

  return api;
}
