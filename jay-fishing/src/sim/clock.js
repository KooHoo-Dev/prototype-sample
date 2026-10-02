// OWNER: P3 — 계약 §6.4 · §7.1 · §5.7
// 시계 — 정본은 틱(day · tickInDay). hour · band · 해 · 빛은 파생 값이다.
// 시계는 step(advanceClock)으로만 가고, 시간 건너뛰기(캠프 · 이동 · 수면 · 디버그)는 setClock 의 시각 점프다.
// 앞의 여섯(hourOf · bandOf · bandStartTick · sunAt · deriveClock · formatClock)과 nextBandStart · nextWake 는 순수(view · ui · audio 가 써도 된다).

import { TICKS_PER_DAY, TICKS_PER_HOUR, TICKS_PER_MINUTE } from '../core/constants.js';
import { EV } from '../core/events.js';
import { smoothstep } from '../core/math.js';
import { BANDS, TIME } from '../data/time.js';
import { WEATHER } from '../data/weather.js';
import { refreshWeather, weatherPayload } from './weather.js';
import { updateEnv } from './world.js';

/** @typedef {import('../types.js').ClockState} ClockState */
/** @typedef {import('../types.js').BandId} BandId */
/** @typedef {import('../types.js').SimCtx} SimCtx */

/** @param {number} tickInDay @returns {number} 0 ≤ h < 24 */
export function hourOf(tickInDay) {
  return tickInDay / TICKS_PER_HOUR;
}

/** @param {number} hour @returns {BandId} night 는 자정을 넘는다(from 20 · to 4) */
export function bandOf(hour) {
  for (const b of BANDS) {
    const inside = b.from < b.to ? hour >= b.from && hour < b.to : hour >= b.from || hour < b.to;
    if (inside) return /** @type {BandId} */ (b.id);
  }
  return /** @type {BandId} */ (BANDS[BANDS.length - 1].id);
}

/** @param {BandId} band @returns {number} 그 시간대가 시작하는 tickInDay(모르는 band 면 0) */
export function bandStartTick(band) {
  const b = BANDS.find(x => x.id === band);
  return b ? Math.round(b.from * TICKS_PER_HOUR) : 0;
}

/** sunAt 의 계산을 out 에 쓴다(틱마다 도는 경로 — 할당 없음) */
function sunInto(out, hour, weatherLight) {
  const { sunrise, sunset, maxSunElev, minSunElev, nightFloor, nightLight, twilight } = TIME;
  let sunElev;
  let sunAzim;
  if (hour >= sunrise && hour < sunset) {
    const f = (hour - sunrise) / (sunset - sunrise);
    sunElev = maxSunElev * Math.sin(Math.PI * f);
    sunAzim = -Math.PI / 2 + Math.PI * f;
  } else {
    const g = ((hour - sunset + 24) % 24) / (24 - (sunset - sunrise));
    sunElev = minSunElev * Math.sin(Math.PI * g);
    sunAzim = Math.PI / 2 + Math.PI * g;
  }
  const light = nightFloor + (1 - nightFloor) * smoothstep(twilight[0], twilight[1], sunElev) * weatherLight;
  out.sunElev = sunElev;
  out.sunAzim = sunAzim;
  out.light = light;
  out.night = light < nightLight;
  return out;
}

/**
 * §7.1 — 해 고도 · 방위 · 하늘 밝기. 해는 +X(동)에서 떠 정오에 −Z(물 위) · −X(서)로 진다.
 * @param {number} hour @param {number} [weatherLight]
 * @returns {{sunElev:number, sunAzim:number, light:number, night:boolean}}
 */
export function sunAt(hour, weatherLight = 1) {
  return sunInto({ sunElev: 0, sunAzim: 0, light: 0, night: false }, hour, weatherLight);
}

/** ClockState 의 필드를 제자리에서 쓴다 @param {ClockState} c */
function writeClock(c, day, tickInDay, weatherId) {
  const hour = hourOf(tickInDay);
  const w = WEATHER[weatherId] || WEATHER.clear;
  c.day = day;
  c.tickInDay = tickInDay;
  c.hour = hour;
  c.minute = Math.floor((tickInDay % TICKS_PER_HOUR) / TICKS_PER_MINUTE);
  c.band = bandOf(hour);
  sunInto(c, hour, w.light);
  return c;
}

/**
 * @param {number} day @param {number} tickInDay @param {string} weatherId
 * @returns {ClockState}
 */
export function deriveClock(day, tickInDay, weatherId) {
  return writeClock(/** @type {ClockState} */ ({
    day, tickInDay, hour: 0, minute: 0, band: 'dawn', sunElev: 0, sunAzim: 0, light: 0, night: false,
  }), day, tickInDay, weatherId);
}

/** @param {{hour:number, minute:number}} clock @returns {string} 'HH:MM' */
export function formatClock(clock) {
  const h = Math.floor(clock.hour) % 24;
  return `${String(h).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')}`;
}

/** 지금 씬 날씨의 빛으로 시계 파생 필드를 다시 쓴다(날씨 · 씬이 바뀐 뒤) @param {SimCtx} ctx */
export function rederiveClock(ctx) {
  const s = ctx.state;
  writeClock(s.clock, s.clock.day, s.clock.tickInDay, s.weather.current);
  updateEnv(ctx);
}

/**
 * step 전용 — 틱을 민다. 자정: CLOCK_DAY → 날씨(WEATHER_CHANGED) → SAVE_REQUEST{day}. 시간대가 바뀌면 CLOCK_BAND. 파생 필드 · env 갱신.
 * @param {SimCtx} ctx @param {number} ticks
 */
export function advanceClock(ctx, ticks) {
  const s = ctx.state;
  const c = s.clock;
  const prevBand = c.band;
  let day = c.day;
  let t = c.tickInDay + (ticks > 0 ? Math.floor(ticks) : 0);
  while (t >= TICKS_PER_DAY) {
    t -= TICKS_PER_DAY;
    day += 1;
    c.day = day;
    c.tickInDay = t;
    ctx.emit(EV.CLOCK_DAY, { day });
    refreshWeather(ctx);
    ctx.emit(EV.WEATHER_CHANGED, weatherPayload(s));
    ctx.emit(EV.SAVE_REQUEST, { reason: 'day' });
  }
  writeClock(c, day, t, s.weather.current);
  if (c.band !== prevBand) ctx.emit(EV.CLOCK_BAND, { band: c.band, prev: prevBand, day: c.day, hour: c.hour });
  updateEnv(ctx);
}

/**
 * 시각 점프(§5.7) — 틱을 빨리 밀지 않는다(입질 · 파이팅 없음). 순서: CLOCK_DAY → WEATHER_CHANGED → CLOCK_BAND → CLOCK_SKIP.
 * 날이 바뀌면 날씨를 다시 뽑는다. 날이 바뀐 캠프 · 디버그 점프는 SAVE_REQUEST{day}도 낸다(침대 · 이동은 부르는 쪽이 sleep · scene 으로 요청한다).
 * 앞으로만 가는 것은 부르는 쪽의 책임이다(디버그는 같은 날 안의 아무 시각).
 * @param {SimCtx} ctx @param {number} day @param {number} tickInDay @param {'camp'|'bed'|'travel'|'debug'} reason
 */
export function setClock(ctx, day, tickInDay, reason) {
  const s = ctx.state;
  const c = s.clock;
  const fromDay = c.day;
  const fromTick = c.tickInDay;
  const prevBand = c.band;
  let toDay = Number.isFinite(day) ? Math.max(1, Math.floor(day)) : fromDay;
  let toTick = Number.isFinite(tickInDay) ? Math.floor(tickInDay) : fromTick;
  // 범위 밖 tickInDay 는 날로 넘긴다(음수는 0)
  if (toTick < 0) toTick = 0;
  if (toTick >= TICKS_PER_DAY) {
    toDay += Math.floor(toTick / TICKS_PER_DAY);
    toTick %= TICKS_PER_DAY;
  }
  c.day = toDay;
  c.tickInDay = toTick;
  if (toDay !== fromDay) {
    ctx.emit(EV.CLOCK_DAY, { day: toDay });
    refreshWeather(ctx);
    ctx.emit(EV.WEATHER_CHANGED, weatherPayload(s));
    if (reason === 'camp' || reason === 'debug') ctx.emit(EV.SAVE_REQUEST, { reason: 'day' });
  }
  writeClock(c, toDay, toTick, s.weather.current);
  updateEnv(ctx);
  if (c.band !== prevBand) ctx.emit(EV.CLOCK_BAND, { band: c.band, prev: prevBand, day: c.day, hour: c.hour });
  ctx.emit(EV.CLOCK_SKIP, { fromDay, fromTick, toDay, toTick, reason });
}

/** 다음 시간대 시작 시각(§5.7 캠프) — 지금보다 뒤(같은 시각이면 그다음) @returns {{day:number, tickInDay:number}} */
export function nextBandStart(day, tickInDay) {
  const starts = BANDS.map(b => Math.round(b.from * TICKS_PER_HOUR)).sort((a, b) => a - b);
  const next = starts.find(x => x > tickInDay);
  return next === undefined ? { day: day + 1, tickInDay: starts[0] } : { day, tickInDay: next };
}

/** 지금보다 뒤의 첫 TIME.wakeHour(§5.7 침대) — 자정 전이면 다음 날, 자정 뒤 06:00 전이면 그날 @returns {{day:number, tickInDay:number}} */
export function nextWake(day, tickInDay) {
  const wake = Math.round(TIME.wakeHour * TICKS_PER_HOUR);
  return tickInDay < wake ? { day, tickInDay: wake } : { day: day + 1, tickInDay: wake };
}

/** 지금 시각 + hours(이동) @returns {{day:number, tickInDay:number}} */
export function addHours(day, tickInDay, hours) {
  const t = tickInDay + Math.round(hours * TICKS_PER_HOUR);
  return { day: day + Math.floor(t / TICKS_PER_DAY), tickInDay: ((t % TICKS_PER_DAY) + TICKS_PER_DAY) % TICKS_PER_DAY };
}
