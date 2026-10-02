// OWNER: P3 — 계약 §7.1
// SEED — P0 이 W0 에 계약 값 그대로 넣었다. 조정은 소유 패키지만 §7.0 규칙 안에서(🔒 값은 밸런스 게이트만).

export const TIME = {
  startDay: 1, startHour: 6.0, wakeHour: 6.0, travelHours: 1.0,      // 🔒 travelHours
  sunrise: 5.5, sunset: 19.5,
  maxSunElev: 1.08,          // rad (62°) — 12:30
  minSunElev: -0.6,          // rad — 밤의 가운데 00:30(§7.1 식 · 계약 주석의 01:30 은 식과 다르다 — NOTES-P3) (달 고도는 view가 −sunElev)
  nightFloor: 0.06,          // 한밤 하늘 밝기
  nightLight: 0.25,          // light < 이 값 → night(헤드랜턴)
  twilight: [-0.10, 0.25],   // 해 고도(rad) smoothstep 구간
};
export const BANDS = [       // 🔒 (브리프 §3.2)
  { id: 'dawn', from: 4, to: 7 }, { id: 'morning', from: 7, to: 11 }, { id: 'day', from: 11, to: 17 },
  { id: 'evening', from: 17, to: 20 }, { id: 'night', from: 20, to: 4 },
];
