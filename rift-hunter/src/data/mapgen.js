// OWNER: P4 — 계약 §7.12 · §8.7 (시드 — P0 이 W0 에 계약 값으로 채웠다 · 「P4 W1」 값은 P4 가 더했다)
// 균열 생성 · 경로 · 흐름장 수치. 타일 단위(1타일 = 2m)는 이름 끝 Tiles · 그 밖의 거리는 m.

export const MAPGEN = {
  rooms: [10, 14], roomTiles: [8, 13], bigRoomChance: 0.25, bigRoomTiles: [13, 16], corridorLen: [3, 8], corridorWidth: [2, 3],
  gridMax: 96, margin: 2, loops: [0, 2], attempts: 40, propsPerRoom: [2, 6], pillarRoomMin: 11,
  normalPerArea: 90, normalPerRoom: [2, 5], corridorSlotMinLen: 6, slotSpacing: 6, spawnClear: 18, eliteMinDepth: 2, startRoomTiles: [8, 9],
  // P4 W1 — 로직의 숫자를 데이터로(계약 §8.7 의 절차를 구체화한 값)
  recentChance: 0.6,        // 나무 키우기: 가장 최근 방에서 뻗을 확률(나머지는 모든 방 균등 — §8.7 「최근 60% · 나머지 40%」)
  loopGap: [6, 14],         // 고리 통로: 마주 보는 두 방 사이 간격(타일)
  cropPad: 2,               // 결과 맵: 바닥 바깥 여백(타일 — 벽 1 + 빈 곳 1)
  doorClear: 2,             // 막는 소품 금지: 통로 입구 안쪽 한 줄을 이만큼(타일) 넓힌 사각형
  propGap: 2.8,             // 막는 소품 사이 · 막는 바닥 소품과 벽 사이의 최소 틈(m — 수호자 뼈 거인(지름 2.6)도 지나간다 · 좁은 틈 없음)
  propEdge: 0.2,            // 소품 원과 방 모서리 · 벽 사이 여유(m)
  wallGap: 0.05,            // 벽 소품: 원이 벽면에서 떨어진 거리(m — 붙여 세워 뒤쪽 틈이 없다)
  propTries: 16,            // 소품 하나의 자리 시도 수
  pillarGrid: [2, 3],       // 큰 방의 기둥 배열(축마다 2개 · 그 축이 pillarTripleTiles 이상이면 3개)
  pillarTripleTiles: 15,
  spawnPropClear: 4,        // 시작점 둘레에 막는 소품 금지(m)
  lightWallInset: 0.3,      // 벽 빛: 벽면에서 안쪽으로(m)
  lightFloorInset: 1.5,     // 바닥 빛: 벽에서 최소(m)
  lightSpacing: 5,          // 한 방 안의 빛 사이 최소(m — 시도 안에서)
  lightTries: 12,
  slotInset: 3,             // 팩 자리: 벽에서 최소(m — 방이 작으면 방 반폭의 절반까지 줄인다)
  slotClearR: 1.0,          // 팩 자리: 이 반지름 원이 걸을 수 있어야 한다(m)
  slotTries: 24,            // 팩 자리 하나의 후보 수(그중 다른 자리와 가장 먼 것)
  normalMin: 56,            // 일반 팩 자리 바닥 — 방 규칙으로 모자라면 넓은 방부터 더한다(방 10개 맵도 놓인 게이지 ≥ 115% · §7.14 「일반 팩 ~60」)
  bodyR: 0.4,               // 고립 틈 검사: 이 몸 반지름이 닿지 못하는 바닥 칸은 막는다(§8.7-9)
  genRetries: 6,            // 규칙(방 수 · 정예/챔피언 자리 수)을 못 채우면 같은 난수 줄기로 다시(결정적)
};
export const PATHING = {
  // 밸런스 게이트(NOTES-BALANCE): 6000 → 20000 — 생성 맵 위 걷기 가능한 두 점(8~30m · 1,800쌍)의 1.6% 에서 6000 이면 벽 둘레를 다 못 돌아
  //   [](클릭해도 서 있다)였다(봇은 완료 뒤 나가는 포털 앞 벽에서 28분 섰다). 20000 이면 0% · 최악 ~20ms(긴 우회 경로에서만)
  maxNodes: 20000,
  // P4 W1
  escapeCells: 2,           // 시작 칸 둘레(체비쇼프 칸 수): 몸 반지름 여유가 없어도 지나간다(벽에 붙어 선 자리에서 빠져나오기)
  fitR: 1.5,                // 목적지가 몸 반지름에 맞지 않으면 이 반경(m) 안의 맞는 점으로 옮긴다
  sampleStep: 0.2,          // 줄 당기기 · 직선 검사의 표본 간격(m)
  refineIters: 8,           // 목적지 옮기기의 이분 횟수
  nearSideSlack: 0.5,       // 막힌 곳 클릭: 곧장 가다 멈추는 점이 nearestWalkable 보다 이만큼(m)까지 멀어도 그 점(이쪽 벽 앞)
};
export const FLOW = {
  everySec: 0.2, recenterCells: 2, maxSteps: 100,
  // P4 W1 — 정수 가중 다익스트라(8방향 · 모서리 자르기 금지). dist = 걸음 수 × orthCost(정수) · flowDist 가 걸음 수로 되돌린다
  orthCost: 5,              // 곧은 한 칸
  diagCost: 7,              // 대각 한 칸(7/5 ≈ √2 — 떼가 45° 지그재그로 오지 않는다)
  wallCost: 4,              // 막힌 칸에 8방향으로 닿는 칸에 들어갈 때 더한다(떼가 벽 · 모서리에 붙어 걷지 않는다)
  // 리뷰 수정: 먼 흐름장 — 흐름장(maxSteps 100 ≈ 경로 30~50m) 밖의 깬 몬스터가 쓰는 맵 전체 거리장. 그런 몬스터가 있을 때만 만든다(everySec 마다 ·
  //   플레이어가 recenterCells 넘게 움직이면). 생성 맵(312 × 320 칸) 전체가 닿는다 · 한 번 약 4ms(전에는 직선으로 벽을 밀며 영영 섰다 — 마법사 · 벽 너머 메테오의 안전 지대)
  far: { maxSteps: 1000, everySec: 1.0, recenterCells: 16 },
};
