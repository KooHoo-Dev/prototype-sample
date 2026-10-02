// OWNER: P2 — 계약 §7.8 · §8.2
// SEED — P0 이 W0 에 계약 값 그대로 넣었다. 조정은 소유 패키지만 §7.0 규칙 안에서(🔒 값은 밸런스 게이트만).

export const STYLES = {   // 🔒 force · speed · endurance · 각 상태의 f · tele(측정 산수 · 예고 공정성 — tele 는 사람이 보고 대응할 수 있는 길이) — dur · lateral · next 가중치는 ±20% 재량
  heavy:    { force: 1.3,  speed: 0.9, endurance: 12, start: 'hold', states: {      // 重 — 느리고 꾸준한 당김(질주는 시간의 약 12%)
    hold:   { kind: 'hold',  f: 0.65, along: 1,   sp: 0.6, dur: [3, 5],               next: { hold: 0.4, rest: 0.45, run: 0.15 } },
    run:    { kind: 'run',   f: 0.8,  along: 1,   sp: 0.5, dur: [2, 4],    tele: 0.6, next: { hold: 0.7, rest: 0.3 } },
    rest:   { kind: 'rest',  f: 0.25, along: 0.5, sp: 0.3, dur: [2, 4],               next: { hold: 0.8, run: 0.2 } } } },
  runner:   { force: 1.7,  speed: 2.4, endurance: 14, start: 'run', states: {
    run:    { kind: 'run',   f: 1.0,  along: 1,   sp: 1.0, dur: [4, 8],    tele: 0.7, next: { rest: 0.6, turn: 0.4 } },
    turn:   { kind: 'turn',  f: 0.6,  along: 0.2, sp: 0.6, dur: [1, 2],               next: { run: 0.5, rest: 0.5 } },
    rest:   { kind: 'rest',  f: 0.25, along: 0.6, sp: 0.3, dur: [2, 4],               next: { run: 0.7, turn: 0.3 } } } },
  thrasher: { force: 1.5,  speed: 2.0, endurance: 12, start: 'burst', states: {
    burst:  { kind: 'run',   f: 1.1,  along: 1,   sp: 1.0, dur: [0.5, 1.2], tele: 0.25, next: { turn: 0.5, burst: 0.3, rest: 0.2, shake: 0.2 } },
    turn:   { kind: 'turn',  f: 0.7,  along: 0.3, sp: 0.8, dur: [0.6, 1.5],            next: { burst: 0.6, rest: 0.4 } },
    rest:   { kind: 'rest',  f: 0.3,  along: 0.5, sp: 0.3, dur: [1, 2.5],              next: { burst: 0.8, turn: 0.2 } },
    shake:  { kind: 'shake', f: 0.5,  along: 0.6, sp: 0.3, dur: [0.8, 1.6],            next: { burst: 0.5, rest: 0.5 } } } },
  jumper:   { force: 1.45, speed: 2.0, endurance: 13, start: 'run', states: {
    run:    { kind: 'run',   f: 0.85, along: 1,   sp: 1.0, dur: [2, 4],    tele: 0.5, next: { jump: 0.45, rest: 0.35, turn: 0.2 } },
    jump:   { kind: 'jump',  f: 1.1,  along: 0.3, sp: 0.4, dur: [0.7, 0.7], tele: 0.7, next: { rest: 0.6, run: 0.4 } },
    rest:   { kind: 'rest',  f: 0.3,  along: 0.6, sp: 0.3, dur: [1.5, 3],             next: { run: 0.6, jump: 0.2, turn: 0.2 } },
    turn:   { kind: 'turn',  f: 0.6,  along: 0.3, sp: 0.6, dur: [1, 2],               next: { run: 0.5, jump: 0.3, rest: 0.2 } } } },
  diver:    { force: 1.7,  speed: 1.8, endurance: 13, start: 'dive', states: {
    dive:   { kind: 'dive',  f: 1.0,  along: 0.7, sp: 0.8, dur: [2, 5],    tele: 0.5, next: { hold: 0.5, rest: 0.5 } },
    hold:   { kind: 'hold',  f: 0.7,  along: 0.8, sp: 0.5, dur: [2, 3],               next: { dive: 0.5, rest: 0.5 } },
    rest:   { kind: 'rest',  f: 0.3,  along: 0.5, sp: 0.3, dur: [1.5, 3],             next: { dive: 0.6, hold: 0.4 } } } },
  small:    { force: 1.2,  speed: 1.6, endurance: 5,  start: 'wiggle', states: {
    wiggle: { kind: 'turn',  f: 0.7,  along: 0.6, sp: 0.6, dur: [1, 2],               next: { rest: 0.5, wiggle: 0.3, burst: 0.2 } },
    burst:  { kind: 'run',   f: 1.0,  along: 1,   sp: 1.0, dur: [0.4, 0.9], tele: 0.2, next: { wiggle: 0.6, rest: 0.4 } },
    rest:   { kind: 'rest',  f: 0.3,  along: 0.4, sp: 0.3, dur: [0.5, 1.5],            next: { wiggle: 0.7, burst: 0.3 } } } },
};
export const TRAITS = {
  dash:        { addStates: { dash: { kind: 'run', f: 1.0, along: 1, sp: 1.6, dur: [1, 2], tele: 0.5, next: { hold: 0.6, rest: 0.4 } } },
                 addNext: { hold: { dash: 0.25 }, rest: { dash: 0.25 } } },
  shake:       { addStates: { shake: { kind: 'shake', f: 0.5, along: 0.6, sp: 0.3, dur: [0.8, 1.6], next: { hold: 0.5, rest: 0.5 } } },
                 addNext: { hold: { shake: 0.25 }, rest: { shake: 0.2 }, turn: { shake: 0.2 } } },
  twist:       { addStates: { twist: { kind: 'shake', f: 0.6, along: 0.5, sp: 0.2, dur: [1.0, 2.0], abrades: true, next: { hold: 0.5, rest: 0.5 } } },
                 addNext: { hold: { twist: 0.3 }, rest: { twist: 0.2 } } },
  rareJump:    { addStates: { jump: { kind: 'jump', f: 1.1, along: 0.3, sp: 0.4, dur: [0.9, 0.9], tele: 0.8, next: { rest: 0.7, hold: 0.3 } } },
                 addNext: { run: { jump: 0.05 }, hold: { jump: 0.03 } } },
  shortRun:    { scaleByKind: { run: { durMul: 0.5, sp: 1.2 } } },
  longRun:     { scaleByKind: { run: { durMul: 1.6 } } },
  repeatRun:   { addNext: { run: { run: 0.3 } } },
  multiJump:   { nextMulByKind: { jump: 2 }, addNext: { jump: { jump: 0.3 } } },
  stopBurst:   { scaleByKind: { rest: { durMul: 2 }, run: { f: 1.3 } } },
  spin:        { nextMulByKind: { turn: 2 }, scaleByKind: { turn: { lateral: 2 } }, visual: 'spin' },
  vanish:      { addStates: { vanish: { kind: 'charge', f: 0.5, along: -0.8, sp: 1.0, dur: [1, 2], tele: 0.5, next: { rest: 0.6, run: 0.4 } } },   // 다가오는 속도 < 릴 회수 + 세우기 — 감으며 세우면 슬랙을 막는다
                 addNext: { run: { vanish: 0.25 }, rest: { vanish: 0.25 } } },
  firstRun:    { addStates: { firstRun: { kind: 'run', f: 1.3, along: 1, sp: 1.0, dur: [3, 5], next: { hold: 0.5, rest: 0.5 } } }, start: 'firstRun' },
  cautious:    { nextMulByKind: { rest: 1.5 } },
  abrade:      { abrasionMul: 1.6 },
  tremble:     { addStates: { tremble: { kind: 'shake', f: 0.3, along: 0.5, sp: 0.2, dur: [0.5, 1.0], next: { wiggle: 0.6, rest: 0.4 } } },
                 addNext: { wiggle: { tremble: 0.15 }, rest: { tremble: 0.1 } }, visual: 'tremble' },
  shortThrash: { addStates: { thrash: { kind: 'run', f: 1.0, along: 0.8, sp: 1.2, dur: [0.3, 0.6], next: { wiggle: 0.6, rest: 0.4 } } },
                 addNext: { wiggle: { thrash: 0.3 }, rest: { thrash: 0.2 } } },
};

/** §5.3.4 — 상태 정의에 lateral 이 없을 때의 방향(bearing) 변화 속도 배율(kind 별 · 그 밖은 other) */
export const LATERAL_DEFAULT = { turn: 0.8, run: 0.3, charge: 0.2, other: 0.1 };
