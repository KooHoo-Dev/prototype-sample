// OWNER: P3 — 계약 §6.4 · §7.1 · §5.7
// STUB(부분) — W0 에 P0 이 완성으로 낸 것: hourOf · bandOf · bandStartTick · sunAt · deriveClock · formatClock · advanceClock(이벤트 포함)
//   · nextBandStart · nextWake(§6.14 — 최소 부트가 하늘을 그리려면 필요). setClock 만 스텁(no-op) — P3 가 채운다.

import { TICKS_PER_DAY, TICKS_PER_HOUR, TICKS_PER_MINUTE } from '../core/constants.js';
import { EV } from '../core/events.js';
import { smoothstep } from '../core/math.js';
import { BANDS, TIME } from '../data/time.js';
import { WEATHER } from '../data/weather.js';
import { refreshWeather } from './weather.js';
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

/** @param {BandId} band @returns {number} 그 시간대가 시작하는 tickInDay */
export function bandStartTick(band) {
  const b = BANDS.find(x => x.id === band);
  return b ? Math.round(b.from * TICKS_PER_HOUR) : 0;
}

/**
 * §7.1 — 해 고도 · 방위 · 하늘 밝기.
 * @param {number} hour @param {number} [weatherLight]
 * @returns {{sunElev:number, sunAzim:number, light:number, night:boolean}}
 */
export function sunAt(hour, weatherLight = 1) {
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
  return { sunElev, sunAzim, light, night: light < nightLight };
}

/**
 * @param {number} day @param {number} tickInDay @param {string} weatherId
 * @returns {ClockState}
 */
export function deriveClock(day, tickInDay, weatherId) {
  const hour = hourOf(tickInDay);
  const minute = Math.floor((tickInDay % TICKS_PER_HOUR) / TICKS_PER_MINUTE);
  const w = WEATHER[weatherId] || WEATHER.clear;
  const sun = sunAt(hour, w.light);
  return { day, tickInDay, hour, minute, band: bandOf(hour), ...sun };
}

/** @param {{hour:number, minute:number}} clock @returns {string} 'HH:MM' */
export function formatClock(clock) {
  const h = Math.floor(clock.hour) % 24;
  return `${String(h).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')}`;
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
  let t = c.tickInDay + ticks;
  while (t >= TICKS_PER_DAY) {
    t -= TICKS_PER_DAY;
    day += 1;
    c.day = day;
    c.tickInDay = t;
    ctx.emit(EV.CLOCK_DAY, { day });
    refreshWeather(ctx);
    ctx.emit(EV.WEATHER_CHANGED, { current: s.weather.current, today: { ...s.weather.today }, tomorrow: { ...s.weather.tomorrow } });
    ctx.emit(EV.SAVE_REQUEST, { reason: 'day' });
  }
  Object.assign(c, deriveClock(day, t, s.weather.current));
  if (c.band !== prevBand) ctx.emit(EV.CLOCK_BAND, { band: c.band, prev: prevBand, day: c.day, hour: c.hour });
  updateEnv(ctx);
}

/**
 * STUB — 시각 점프(CLOCK_DAY · WEATHER_CHANGED · CLOCK_BAND · CLOCK_SKIP — §5.7). P3 가 채운다.
 * @param {SimCtx} ctx @param {number} day @param {number} tickInDay @param {'camp'|'bed'|'travel'|'debug'} reason
 */
export function setClock(ctx, day, tickInDay, reason) {
  void ctx; void day; void tickInDay; void reason;
}

/** 다음 시간대 시작 시각(§5.7 캠프) @returns {{day:number, tickInDay:number}} */
export function nextBandStart(day, tickInDay) {
  const starts = BANDS.map(b => Math.round(b.from * TICKS_PER_HOUR)).sort((a, b) => a - b);
  const next = starts.find(x => x > tickInDay);
  return next === undefined ? { day: day + 1, tickInDay: starts[0] } : { day, tickInDay: next };
}

/** 지금보다 뒤의 첫 TIME.wakeHour(§5.7 침대) @returns {{day:number, tickInDay:number}} */
export function nextWake(day, tickInDay) {
  const wake = Math.round(TIME.wakeHour * TICKS_PER_HOUR);
  return tickInDay < wake ? { day, tickInDay: wake } : { day: day + 1, tickInDay: wake };
}
