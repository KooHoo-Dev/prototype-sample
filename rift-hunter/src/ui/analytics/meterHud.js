// OWNER: P12 — 계약 §10.9(계측 HUD) · §10.3(왼쪽 자리)
// 계측 HUD — 왼쪽 작은 표(HUD 의 왼쪽 자리 · 대상 프레임 · 플레이어를 가리지 않는다). meterView(P2)를 0.25초마다 읽는다.
// UIRoot 가 만들고 매 프레임 setVisible(settings.meterHud && HUD 보임) · update(state, dtReal)을 부른다.
// 균열이 없으면(state.rift 없음) 감춘다 — 잴 것이 없다. 멈춘 화면(__game.step — dtReal 0)에서도 틱이 0.25초어치 지나면 다시 읽는다.
// 프레임마다 도는 길에서는 할당하지 않는다(읽을 때만 meterView 한 번 · 문면이 바뀐 칸만 DOM).

import { RARITIES, TICK_HZ } from '../../core/constants.js';
import { meterView } from '../../sim/meter.js';
import { fmtDps, fmtInt, fmtNum, fmtSec } from '../format.js';

/** 다시 읽는 간격(초 — 계약 §10.9) */
export const METER_EVERY = 0.25;
const EVERY_TICKS = Math.max(1, Math.round(METER_EVERY * TICK_HZ));

/** 줄(순서 = 화면 순서 · 이름 = analytics.meter.<key>) */
const ROWS = /** @type {const} */ (['dps', 'takenPerSec', 'killsPerMin', 'xpPerHour', 'goldPerHour', 'drops', 'elapsedSec', 'gaugePerMin', 'targeting']);

/**
 * meterView 결과 → 줄별 문면(순수 — 테스트)
 * @param {ReturnType<typeof meterView>} v @returns {Record<string, string>}
 */
export function meterTexts(v) {
  return {
    dps: fmtDps(v.dps),
    takenPerSec: fmtDps(v.takenPerSec),
    killsPerMin: fmtInt(v.killsPerMin),
    xpPerHour: fmtInt(v.xpPerHour),
    goldPerHour: fmtInt(v.goldPerHour),
    drops: RARITIES.map((r) => fmtInt(v.drops?.[r] ?? 0)).join(' · '),
    elapsedSec: fmtSec(v.elapsedSec),
    gaugePerMin: fmtNum(v.gaugePerMin, 1) + '%',
    targeting: fmtInt(v.targeting),
  };
}

/**
 * @param {{root:HTMLElement, sim:any, bus:any, settings:any, actions:any, t:(key:string, params?:any) => string, ui:any, widgets:any}} ctx
 * @returns {{el:HTMLElement, update:(state:any, dtReal:number) => void, setVisible:(on:boolean) => void, dispose:() => void}}
 */
export function createMeterHud(ctx) {
  const t = ctx.t;
  const el = document.createElement('div');
  el.className = 'meter-hud';
  el.hidden = true;
  const table = el.appendChild(document.createElement('table'));
  /** @type {Record<string, HTMLElement>} */
  const vals = {};
  /** @type {HTMLElement[]} 이번 판 장비(등급별) 칸 */
  const dropCells = [];
  for (const key of ROWS) {
    const tr = table.appendChild(document.createElement('tr'));
    const th = tr.appendChild(document.createElement('th'));
    th.textContent = t('analytics.meter.' + key);
    const td = tr.appendChild(document.createElement('td'));
    if (key === 'drops') {
      td.className = 'meter-drops';
      for (const r of RARITIES) {
        const s = td.appendChild(document.createElement('span'));
        s.className = 'r-' + r;
        s.textContent = '0';
        dropCells.push(s);
      }
    } else vals[key] = td;
  }
  if (ctx.root) ctx.root.appendChild(el);

  let want = false;
  let shown = false;
  let acc = 0;
  let lastTick = -1;
  let fresh = true;
  /** @type {Record<string, string>} */
  const last = {};

  /** @param {boolean} on */
  const apply = (on) => {
    if (on === shown) return;
    shown = on;
    el.hidden = !on;
    if (on) fresh = true;
  };

  /** @param {any} state */
  const read = (state) => {
    const v = meterView(state);
    const txt = meterTexts(v);
    for (const key of ROWS) {
      if (key === 'drops') continue;
      const s = txt[key];
      if (last[key] !== s) { last[key] = s; vals[key].textContent = s; }
    }
    for (let i = 0; i < RARITIES.length; i++) {
      const s = fmtInt(v.drops?.[RARITIES[i]] ?? 0);
      if (dropCells[i].textContent !== s) dropCells[i].textContent = s;
    }
  };

  return {
    el,
    /** @param {any} state @param {number} dtReal */
    update(state, dtReal) {
      const on = want && !!state && !!state.rift;
      apply(on);
      if (!on) return;
      const dt = Number.isFinite(dtReal) && dtReal > 0 ? dtReal : 0;
      acc += dt;
      const tick = Number.isFinite(state.tick) ? state.tick : 0;
      if (fresh || acc >= METER_EVERY || Math.abs(tick - lastTick) >= EVERY_TICKS) {
        fresh = false;
        acc = 0;
        lastTick = tick;
        read(state);
      }
    },
    /** @param {boolean} on */
    setVisible(on) {
      want = !!on;
      if (!want) apply(false);
    },
    dispose() {
      el.remove();
    },
  };
}
