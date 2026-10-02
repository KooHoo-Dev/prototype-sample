# NOTES-P3 (sim-world) — W1

## 계약의 모순 · 남의 파일 결함

1. **밤의 최저 해 고도 시각**: §7.1 `TIME.minSunElev` 주석은 「01:30」인데 §7.1 식(`g = ((h − sunset + 24) % 24) / (24 − (sunset − sunrise))`)의 밤 가운데는 **00:30**이다. 식을 따랐다(`test/helpers.js`의 시계 리터럴도 같은 식). `data/time.js`의 주석만 고쳤다(값 그대로). 계약 주석을 00:30 으로 고치면 맞는다.
2. **`test/fixtures.test.js` 「helpers: 리터럴이 실제 함수 · 계약 모양과 같다」(P0) 실패**: 끝부분이 `new GameSim({seed:1, start:{scene:'lake', hour:8}})`의 시계를 `makeTestState({hour:8})`(맑음 리터럴)와 비교한다. W0 날씨 스텁은 전부 clear 였지만, §7.2 식대로 뽑으면 seed 1 · 1일 · lake 는 **rain** 이라 `light`가 1 ≠ 0.577 이 된다 — 스텁을 전제한 테스트다. 고침: 그 GameSim 에 `start: {…, weather: 'clear'}`를 넘기거나 비교 쪽을 `makeTestState({hour: 8, weather: sim.state.weather.current})`로(P0 · 통합 담당).

## 계약에 없어서 정한 것(공개 동작)

3. **`player.vel {x, z}`**(내부 필드 추가): 걷기 가속(`WORLD.accel` — 멈출 때도 같은 가속)에 속도 벡터가 필요하다. 계약 필드는 그대로이고, 없으면(고정 상태 · 테스트 리터럴) `updateWalk`가 0 으로 만든다. `placePlayer`가 0 으로 되돌린다.
4. **벽 미끄러짐**: 다음 점이 `walk` 밖이면 x 를 갈 수 있는 데까지 → 그 점에서 z 를 갈 수 있는 데까지(이분 탐색 — 벽에 딱 붙는다), 막힌 축의 속도는 0. 그 뒤 obstacles 원 밖으로 밀어내고, 밀어낸 점이 walk 밖이면 그 틱은 움직이지 않는다. walk 밖에서 시작하면(잘못된 배치) 경계의 가장 가까운 점으로 먼저 되돌린다.
5. **`setClock`의 저장 요청**: 날이 바뀐 `camp` · `debug` 점프는 `SAVE_REQUEST{day}`도 낸다(step 의 자정과 같은 대우). `bed` · `travel`은 부르는 쪽이 `sleep` · `scene`으로 요청하므로 내지 않는다. 순서는 `CLOCK_DAY → WEATHER_CHANGED → (SAVE_REQUEST{day}) → CLOCK_BAND → CLOCK_SKIP`.
6. **집 도착(`world.arriveHome`)**: §5.6 순서 그대로. 어창이 비었으면 ①을, 라인이 이미 가득(`lineM ≥ spoolCapM`)이면 ②를 부르지 않는다(빈 SOLD · LINE_REFILLED 알림 방지). P4 함수는 `world.homeArrival` 객체로 부른다 — world.test 가 가짜로 바꿔 끼워 순서를 본다(rig 의 `fightImpl`과 같은 방식).
7. **이동 이벤트 순서**: `SCENE_CHANGED{travel}` → `PLAYER_PLACED{spawn}` → `WEATHER_CHANGED` → (자정을 넘으면 `CLOCK_DAY` → `WEATHER_CHANGED`) → (`CLOCK_BAND`) → `CLOCK_SKIP{travel}` → (집이면 P4 의 판매 · 감기 · 미끼 이벤트) → `SAVE_REQUEST{scene}`.
8. **강제 정리의 `FISHING_EXIT`**: `newGame` · `debugGotoScene`(· 다른 씬의 `debugGotoSpot`)이 낚시 중에 불리면 rig · fight · pendingCatch 를 지우고 `FISHING_EXIT{spotId}`를 먼저 낸다(tackle · ui 가 로드 · 낚시 HUD 를 내리게). `newGame`의 나머지 순서는 계약 그대로(`SCENE_CHANGED{new}` → `PLAYER_PLACED{spawn}` → `WEATHER_CHANGED` → `SAVE_REQUEST{new}`). `newGame`은 `tick = 0` · `debug` 리셋 · `session`은 유지. seed 가 유한수가 아니면 지금 시드를 쓴다(sim 은 난수를 만들 수 없다 — app 이 넘긴다).
9. **`getForecast().activeByBand`**: 세 스테이지 × 다섯 시간대 키는 항상 있다. 어종 지식 0 이면 빈 배열, 1 이상이면 `time` 이 `H`인 **비판타지** 어종(판타지의 `time`은 도감 표시용 — 출현은 섞기로만).
10. **디버그**: `debugGrant({money})`는 더하기(음수면 빼기 · 0 아래로 내려가지 않는다 · `MONEY_CHANGED{grant}`), `xp`는 `addXp(…, 'debug')`. `debugSetGear('line', id)`는 그 릴의 용량만큼 감는다 · 릴을 바꾸면 `lineM`을 새 용량으로 자른다 · `EQUIPPED`. `debugForceBite`도 `debugForceFight`처럼 낚시 모드가 아니면 먼저 자리(집이면 `lake_gravel`)에 선다. `debugSetWeather`는 세 스테이지의 오늘 날씨를 모두 바꾼다.
11. **생성자의 세이브 검증**: 모르는 씬 → home, 시계 day 가 유한수가 아니면 1, tickInDay 는 0..216 000−1 로 자른다. `start.hour`는 세이브가 있어도 덮는다(개발 쿼리). `start.weather`는 오늘 날씨(세 스테이지)만 덮는다 — 자정이 지나면 시드 날씨로 돌아간다.

## 확인하지 못한 것

- 실제 P4(`sellAll` · `refillLine` · `grantFreeBaitIfNeeded` · `createSaveData` · `sanitizeProfile`) 위의 집 도착 · 세이브 왕복 — W1 은 스텁(세이브 왕복은 계약 모양의 리터럴로 검사). 통합 뒤 `economy.test` · `save.test` · 헤드리스로.
- 걷기 감각(가속 16 m/s² · 벽 미끄러짐 · 상호작용 시선 70°)은 실시간 플레이로만 — 사람이 확인할 것. 조정 손잡이: `src/data/world.js` `WORLD.accel`(12–20) · `interactFov`(1.0–1.4) · `spotRadius`(1.2–1.8).
