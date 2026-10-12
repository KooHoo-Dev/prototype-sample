// OWNER: P10 — 계약 §10.4 (바닥 이름표 · 피해 숫자 — P10 내부 파일 · UIRoot 만 import 한다)
// 이름표: 등급색 · 희귀 이상은 늘 · 그 아래는 Alt(LABELS) 또는 설정 「늘 이름표」 · 「일반 등급 숨기기」면 일반 등급 이름표를 감춘다 ·
//   골드 · 재료 · 포션은 Alt 일 때만 · 피드백 1: 떨어진 직후 FRESH_LABEL_SEC 동안은 일반 · 마법 장비 · 골드 · 재료 · 포션도 이름표(끝 0.4초에 흐려진다 ·
//   「일반 등급 숨기기」면 일반 장비는 그래도 숨긴다) · 위치 = project(drop.pos, y 0.4) · 겹치면 화면 y 순으로 아래로 밀어 쌓는다 ·
//   마우스 아래 이름표 → labelHover() = {kind:'drop', id, src:'label'}(쌓여 밀린 이름표도 그 드랍) · DOM 풀 64.
// 피해 숫자(설정 damageNumbers): 준 HIT(amount > 0) · 같은 대상 0.1초 안이면 합친다 · 0.8초 떠오름 · 치명타 1.5배 · 노랑 주황 · dot 작은 회색 ·
//   면역 「면역」 · 받은 피해는 플레이어 위 작은 붉은 숫자 · 회복은 녹색 +n · DOM 풀 48 — 넘으면 가장 오래된 것을 다시 쓴다.
// 이름표는 pointer-events 가 없다(클릭은 캔버스로 — app 이 labelHover 로 대상을 고른다). 위치 계산은 순수 함수 stackLabels.

import { TICK_HZ } from '../core/constants.js';
import { fmtDmg, fmtInt } from './format.js';
import { t, tName } from './i18n.js';

export const LABEL_POOL = 64;
export const DMG_POOL = 48;
/** 이름표 높이(월드 m) — §10.4 */
const LABEL_Y = 0.4;
/** 쌓을 때 이름표 사이 틈(px) */
const LABEL_GAP = 1;
/** 피해 숫자 */
const DMG_SEC = 0.8;
const DMG_MERGE_SEC = 0.1;
const DMG_RISE_PX = 46;
const DMG_Y = 1.5;
const DMG_PLAYER_Y = 2.1;
const DMG_JITTER_PX = 9;
/** 피드백 1 — 떨어진 직후 이름표를 보이는 시간(초 · 게임 틱 기준 — Drop.born) · 끝에서 흐려지는 시간 */
export const FRESH_LABEL_SEC = 2.2;
const FRESH_FADE_SEC = 0.4;
/** 피드백 1 — 주운 골드 「+n 골드」(플레이어 머리 위 · 이 초 안에 또 주우면 합친다 · 떠 있는 시간) */
const GOLD_MERGE_SEC = 0.6;
const GOLD_SEC = 1.3;
const GOLD_Y = 2.6;

/** 등급 → 이름표 색 클래스 */
export const RARITY_ORDER = { normal: 0, magic: 1, rare: 2, legendary: 3, set: 4 };

/**
 * 순수 — 겹치는 이름표를 화면 y 순으로 아래로 밀어 쌓는다(제자리).
 * n 개의 상자(x = 가운데 · y = 위 · w · h)를 y(같으면 x) 순으로 놓으며, 이미 놓인 상자와 겹치면 그 아래(+gap)로 내린다.
 * order 는 길이 ≥ n 인 정수 배열(정렬 결과 — 놓은 순서)이다. 할당 없음.
 * @param {number} n @param {Float64Array|number[]} xs @param {Float64Array|number[]} ys @param {Float64Array|number[]} ws @param {Float64Array|number[]} hs
 * @param {Int32Array|number[]} order @param {number} [gap]
 */
export function stackLabels(n, xs, ys, ws, hs, order, gap = LABEL_GAP) {
  for (let i = 0; i < n; i++) order[i] = i;
  // 삽입 정렬(y → x) — n ≤ 64
  for (let i = 1; i < n; i++) {
    const k = order[i];
    let j = i - 1;
    while (j >= 0 && (ys[order[j]] > ys[k] || (ys[order[j]] === ys[k] && xs[order[j]] > xs[k]))) {
      order[j + 1] = order[j];
      j--;
    }
    order[j + 1] = k;
  }
  for (let a = 1; a < n; a++) {
    const i = order[a];
    let moved = true;
    let guard = 0;
    while (moved && guard++ < n + 1) {
      moved = false;
      for (let b = 0; b < a; b++) {
        const j = order[b];
        const overlapX = Math.abs(xs[i] - xs[j]) * 2 < ws[i] + ws[j];
        const overlapY = ys[i] < ys[j] + hs[j] + gap && ys[j] < ys[i] + hs[i] + gap;
        if (overlapX && overlapY) {
          ys[i] = ys[j] + hs[j] + gap;
          moved = true;
        }
      }
    }
  }
}

/**
 * 순수 — 이 드랍의 이름표를 보이는가(§10.4)
 * @param {{kind:string, rarity:string|null}} drop @param {{alt:boolean, always:boolean, hideNormal:boolean}} o
 */
export function labelVisible(drop, o) {
  if (drop.kind === 'item') {
    const r = drop.rarity ?? 'normal';
    if (r === 'normal' && o.hideNormal) return false;
    if (r === 'rare' || r === 'legendary' || r === 'set') return true;
    return o.alt || o.always || !!o.fresh;
  }
  if (drop.kind === 'gold' || drop.kind === 'material' || drop.kind === 'potion') return o.alt || !!o.fresh;
  return false;
}

/**
 * 순수 — 떨어진 직후 이름표의 남은 불투명도(피드백 1): 0 = 이제 「갓 떨어짐」이 아니다 · 1 = 또렷 · 끝 FRESH_FADE_SEC 동안 1 → 0.
 * @param {number} born 틱 @param {number} tick @param {number} [sec]
 */
export function freshAlpha(born, tick, sec = FRESH_LABEL_SEC) {
  if (!Number.isFinite(born) || !Number.isFinite(tick)) return 0;
  const age = (tick - born) / TICK_HZ;
  if (age < 0 || age >= sec) return 0;
  const left = sec - age;
  return left >= FRESH_FADE_SEC ? 1 : left / FRESH_FADE_SEC;
}

/** 드랍 이름표 문면 @param {any} d */
export function labelText(d) {
  if (d.kind === 'item') return d.item ? tName(d.item.name) : t('rarity.' + (d.rarity ?? 'normal'));
  if (d.kind === 'gold') return t('label.gold', { n: fmtInt(d.amount) });
  if (d.kind === 'material') return t('label.material', { name: t('mat.' + d.mat), n: d.amount });
  if (d.kind === 'potion') return d.amount > 1 ? t('label.material', { name: t('label.potion'), n: d.amount }) : t('label.potion');
  return '';
}

/**
 * @param {{root:HTMLElement, settings:any, project:(x:number, y:number, z:number) => {x:number, y:number, visible:boolean}}} deps
 */
export function createLabels({ root, settings, project }) {
  const layer = root.appendChild(document.createElement('div'));
  layer.className = 'label-layer';
  const deps = { settings };

  // ── 이름표 풀 ──
  /** @type {Array<{el:HTMLElement, dropId:number, text:string, w:number, h:number, x:number, y:number, used:boolean, cls:string, tx:number, ty:number, shown:boolean, alpha:number}>} */
  const pool = [];
  for (let i = 0; i < LABEL_POOL; i++) {
    const e = layer.appendChild(document.createElement('div'));
    e.className = 'flabel';
    e.style.display = 'none';
    pool.push({ el: e, dropId: -1, text: '', w: 0, h: 0, x: 0, y: 0, used: false, cls: '', tx: NaN, ty: NaN, shown: false, alpha: 1 });
  }
  /** 이 프레임의 이름표 불투명도(쌓기 순서 n 번째) */
  const alphas = new Float64Array(LABEL_POOL);
  /** dropId → 풀 인덱스 @type {Map<number, number>} */
  const byDrop = new Map();
  const xs = new Float64Array(LABEL_POOL);
  const ys = new Float64Array(LABEL_POOL);
  const ws = new Float64Array(LABEL_POOL);
  const hs = new Float64Array(LABEL_POOL);
  const order = new Int32Array(LABEL_POOL);
  const slotOf = new Int32Array(LABEL_POOL);
  let alt = false;
  let mouseX = -1, mouseY = -1, mouseIn = false;
  let hoverDrop = -1;
  /** @type {{kind:'drop', id:number, src:'label'}|null} */
  let hoverObj = null;
  let hoverEl = /** @type {HTMLElement|null} */ (null);

  const onMove = (ev) => { mouseX = ev.clientX; mouseY = ev.clientY; mouseIn = true; };
  const onLeave = () => { mouseIn = false; };
  window.addEventListener('mousemove', onMove, { passive: true });
  window.addEventListener('mousedown', onMove, { passive: true });
  document.documentElement.addEventListener('mouseleave', onLeave);

  // ── 피해 숫자 풀 ──
  /** @type {Array<{el:HTMLElement, active:boolean, age:number, born:number, target:number, x:number, z:number, y:number, amount:number, kind:string, crit:boolean, jitter:number, text:string, cls:string}>} */
  const nums = [];
  for (let i = 0; i < DMG_POOL; i++) {
    const e = layer.appendChild(document.createElement('div'));
    e.className = 'dmg';
    e.style.display = 'none';
    nums.push({ el: e, active: false, age: 0, born: 0, target: -1, x: 0, z: 0, y: 0, amount: 0, kind: '', crit: false, jitter: 0, text: '', cls: '' });
  }
  let numSeq = 0;
  let clock = 0;

  /** 새 숫자 칸(빈 칸 · 없으면 가장 오래된 것) */
  function takeNum() {
    let best = 0;
    let bestAge = -1;
    for (let i = 0; i < nums.length; i++) {
      const n = nums[i];
      if (!n.active) return n;
      if (n.age > bestAge) { bestAge = n.age; best = i; }
    }
    return nums[best];
  }

  /** @param {any} n */
  function paintNum(n) {
    let text;
    if (n.kind === 'immune') text = t('hud.immune');
    else if (n.kind === 'heal') text = '+' + fmtDmg(n.amount);
    else if (n.kind === 'gold') text = t('label.goldPicked', { n: fmtInt(n.amount) });
    else text = fmtDmg(n.amount);
    if (text !== n.text) { n.text = text; n.el.textContent = text; }
    const cls = 'dmg dmg-' + n.kind + (n.crit ? ' is-crit' : '');
    if (cls !== n.cls) { n.cls = cls; n.el.className = cls; }
  }

  /**
   * @param {'hit'|'dot'|'immune'|'taken'|'heal'|'gold'} kind @param {number} target @param {number} x @param {number} z @param {number} y @param {number} amount @param {boolean} crit
   */
  function spawnNum(kind, target, x, z, y, amount, crit) {
    if (kind !== 'gold' && !deps.settings?.damageNumbers) return;     // 주운 골드는 피해 숫자 설정과 따로 늘 보인다(피드백 1)
    if (kind !== 'immune' && !(amount > 0)) return;
    if (kind === 'gold') {
      // 연달아 자동으로 주운 더미는 한 숫자로 합친다(떠오르던 자리 · 시간 그대로)
      for (let i = 0; i < nums.length; i++) {
        const n = nums[i];
        if (n.active && n.kind === 'gold' && clock - n.born <= GOLD_MERGE_SEC) {
          n.amount += amount;
          paintNum(n);
          return;
        }
      }
    }
    // 같은 대상 0.1초 안이면 합친다(같은 종류끼리) — 최종 게이트: 플레이어가 받은 피해(-2) · 회복(-3)도. 전에는 몬스터 대상만 합쳐
    //   떼에게 맞으면 틱마다 새 숫자가 머리 위 같은 자리(가로 흔들림 5칸)에 겹쳐 「22222」처럼 읽혔다
    if (target >= 0 || target === -2 || target === -3) {
      for (let i = 0; i < nums.length; i++) {
        const n = nums[i];
        if (n.active && n.target === target && n.kind === kind && clock - n.born <= DMG_MERGE_SEC) {
          n.amount += amount;
          n.crit = n.crit || crit;
          paintNum(n);
          return;
        }
      }
    }
    const n = takeNum();
    n.active = true;
    n.age = 0;
    n.born = clock;
    n.target = target;
    n.x = x;
    n.z = z;
    n.y = y;
    n.amount = amount;
    n.kind = kind;
    n.crit = crit;
    n.jitter = kind === 'gold' ? 0 : (((numSeq++ * 7) % 5) - 2) * DMG_JITTER_PX;
    paintNum(n);
    n.el.style.display = '';
  }

  const api = {
    layer,
    /** @param {boolean} on Alt */
    setLabels(on) { alt = !!on; },
    get labelsOn() { return alt; },
    /** @param {any} s */
    setSettings(s) { if (s) deps.settings = s; },
    /** HIT(§4.2) @param {any} e */
    addHit(e) {
      if (e.immune) spawnNum('immune', e.targetId, e.x, e.z, DMG_Y, 0, false);
      else spawnNum(e.dot ? 'dot' : 'hit', e.targetId, e.x, e.z, DMG_Y, e.amount, !!e.crit && !e.dot);
    },
    /** PLAYER_HIT @param {any} e */
    addTaken(e) { spawnNum('taken', -2, e.x, e.z, DMG_PLAYER_Y, e.amount, false); },
    /** PLAYER_HEAL @param {number} x @param {number} z @param {number} amount */
    addHeal(x, z, amount) { spawnNum('heal', -3, x, z, DMG_PLAYER_Y, amount, false); },
    /** 피드백 1 — DROP_PICKED{kind:'gold', amount} → 플레이어 머리 위 「+n 골드」 @param {number} x @param {number} z @param {number} amount */
    addGold(x, z, amount) { spawnNum('gold', -4, x, z, GOLD_Y, amount, false); },
    /** 마우스 아래 이름표의 드랍(src 'label') */
    labelHover() { return hoverObj; },
    /** 장면이 바뀌었다 — 이름표 · 숫자 비움 */
    reset() {
      for (const s of pool) { s.used = false; s.dropId = -1; s.text = ''; if (s.shown) { s.shown = false; s.el.style.display = 'none'; } }
      byDrop.clear();
      for (const n of nums) { n.active = false; n.el.style.display = 'none'; }
      hoverDrop = -1;
      hoverObj = null;
    },
    /**
     * @param {any} state @param {number} dt 실제 초 @param {{visible:boolean, alpha:number}} view
     */
    update(state, dt, view) {
      clock += dt > 0 ? dt : 0;
      const s = deps.settings ?? {};
      const rift = state.rift;
      const show = view.visible && rift && state.scene === 'rift';
      // ── 이름표 — 1) 보일 드랍에 칸을 붙이고 문면을 쓴다 2) 새 칸만 한 번에 잰다(레이아웃 한 번) 3) 쌓기 ──
      for (let i = 0; i < pool.length; i++) pool[i].used = false;
      let n = 0;
      if (show) {
        const o = { alt, always: !!s.alwaysLabels, hideNormal: !!s.hideNormal, fresh: false };
        const oFresh = { alt, always: !!s.alwaysLabels, hideNormal: !!s.hideNormal, fresh: true };
        const drops = rift.drops;
        const tick = state.tick;
        for (let i = 0; i < drops.length && n < LABEL_POOL; i++) {
          const d = drops[i];
          if (d.gone) continue;
          let a = 1;
          if (!labelVisible(d, o)) {
            // 피드백 1 — 떨어진 직후에만 보이는 이름표(규칙상 숨는 것) · 끝에서 흐려진다
            a = freshAlpha(d.born, tick);
            if (!(a > 0) || !labelVisible(d, oFresh)) continue;
          }
          const pr = project(d.pos.x, LABEL_Y, d.pos.z);
          if (!pr.visible || !Number.isFinite(pr.x) || !Number.isFinite(pr.y)) continue;
          let k = byDrop.get(d.id);
          if (k === undefined) {
            k = -1;
            for (let j = 0; j < pool.length; j++) if (pool[j].dropId < 0) { k = j; break; }
            if (k < 0) break;
            const slot = pool[k];
            slot.dropId = d.id;
            byDrop.set(d.id, k);
            const text = labelText(d);
            const cls = 'flabel ' + (d.kind === 'item' ? 'r-' + (d.rarity ?? 'normal') : 'k-' + d.kind);
            slot.el.className = cls;
            slot.cls = cls;
            slot.text = text;
            slot.el.textContent = text;
            slot.w = -1;
            if (!slot.shown) { slot.shown = true; slot.el.style.display = ''; }
          }
          pool[k].used = true;
          alphas[n] = a;
          xs[n] = pr.x;
          ys[n] = pr.y;
          slotOf[n] = k;
          n++;
        }
        for (let a = 0; a < n; a++) {
          const slot = pool[slotOf[a]];
          if (slot.w < 0) {
            slot.w = slot.el.offsetWidth || slot.text.length * 8 + 12;
            slot.h = slot.el.offsetHeight || 20;
          }
          ws[a] = slot.w;
          hs[a] = slot.h;
          ys[a] -= slot.h;
        }
      }
      stackLabels(n, xs, ys, ws, hs, order);
      let hv = -1;
      for (let a = 0; a < n; a++) {
        const i = order[a];
        const slot = pool[slotOf[i]];
        const tx = Math.round(xs[i] - ws[i] / 2);
        const ty = Math.round(ys[i]);
        slot.x = tx;
        slot.y = ty;
        if (!slot.shown) { slot.shown = true; slot.el.style.display = ''; }
        if (tx !== slot.tx || ty !== slot.ty) {
          slot.tx = tx;
          slot.ty = ty;
          slot.el.style.transform = `translate(${tx}px, ${ty}px)`;
        }
        const al = Math.round(alphas[i] * 20) / 20;
        if (al !== slot.alpha) {
          slot.alpha = al;
          slot.el.style.opacity = al >= 1 ? '' : String(al);
        }
        if (mouseIn && mouseX >= tx && mouseX <= tx + ws[i] && mouseY >= ty && mouseY <= ty + hs[i]) hv = slot.dropId;
      }
      for (let i = 0; i < pool.length; i++) {
        const slot = pool[i];
        if (slot.used) continue;
        if (slot.dropId >= 0) {
          if (byDrop.get(slot.dropId) === i) byDrop.delete(slot.dropId);
          slot.dropId = -1;
        }
        if (slot.shown) { slot.shown = false; slot.el.style.display = 'none'; slot.el.classList.remove('is-hover'); }
        if (slot.alpha !== 1) { slot.alpha = 1; slot.el.style.opacity = ''; }
      }
      if (hv !== hoverDrop) {
        hoverDrop = hv;
        hoverEl?.classList.remove('is-hover');
        hoverEl = null;
        hoverObj = hv >= 0 ? { kind: 'drop', id: hv, src: 'label' } : null;
        if (hv >= 0) {
          const k = byDrop.get(hv);
          if (k !== undefined) { hoverEl = pool[k].el; hoverEl.classList.add('is-hover'); }
        }
      }
      // ── 피해 숫자 ──
      for (let i = 0; i < nums.length; i++) {
        const m = nums[i];
        if (!m.active) continue;
        m.age += dt > 0 ? dt : 0;
        const life = m.kind === 'gold' ? GOLD_SEC : DMG_SEC;
        if (m.age >= life || !view.visible) {
          m.active = false;
          m.el.style.display = 'none';
          continue;
        }
        const pr = project(m.x, m.y, m.z);
        if (!pr.visible) { m.el.style.opacity = '0'; continue; }
        const k = m.age / life;
        const rise = DMG_RISE_PX * (1 - (1 - k) * (1 - k));
        const a = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
        m.el.style.transform = `translate(${Math.round(pr.x + m.jitter)}px, ${Math.round(pr.y - rise)}px) translate(-50%, -100%)`;
        m.el.style.opacity = String(Math.round(a * 100) / 100);
      }
    },
    dispose() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mousedown', onMove);
      document.documentElement.removeEventListener('mouseleave', onLeave);
      layer.remove();
    },
  };
  return api;
}
