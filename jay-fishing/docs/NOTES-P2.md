# NOTES-P2 (sim-fight) — W1

소유: `data/fight.js` · `data/fightStyles.js` · `data/species/lake.js` · `sim/fight/fight.js` · `sim/fight/fishBrain.js` · `bot/policy.js` · `test/fight.test.js` · `test/fishBrain.test.js` · `test/styles.report.test.js`.

## 수치 조정(§7.0 ±20% — 🔒 아님)

| 값 | 계약 | 지금 | 왜 |
|---|---|---|---|
| `FIGHT.fatigueFloor` | 0.3 | 0.36 | 지친 물고기도 최대 드랙 · 세운 로드에 하중을 남긴다 → 무지성 파손 ↑ · 대형 고정(locked) 랜딩 ↓ |
| `FIGHT.pumpLiftTime` | 0.8 | 0.64 | 무지성의 0.8초 세우기 동안 로드가 다 서서 머문다(파손 ↑) · 조절의 펌핑이 빨라진다 |
| `FIGHT.rodLowerTime` | 0.4 | 0.48 | 숙이는 동안의 세운 시간 ↑ — 무지성 파손 ↑(조절은 0.8 × 로드 상한에서 멈춰 영향 없음) |
| `FIGHT.slipRef` | 0.25 | 0.3 | 드랙을 조금 넘는 당김의 풀림 속도 ↓ — 대형 조절 랜딩 ↑ |
| `FIGHT.tensionLambda` | 18 | 21.6 | 질주 스파이크가 덜 뭉개진다 — 고정 드랙(85%)의 대형 끊김 ↑ |

미니 측정(`fight.test` — 호수 자갈 · 1단계 바닥 · lakeDay 섞기 · 2,000판 / 대형 667판, 시드 고정):

| | 계약 값 | 조정 뒤 | 기준 |
|---|---|---|---|
| 기본 파이팅 대비 랜딩 | 82.2% | 81.7% | 설계 ≈ 85% |
| 한 판(소 · 중 · 대) | 20.6 · 35.3 · 98.7초 | 20.7 · 35.8 · 101.0초 | 10–25 · 25–60 · 60–150 |
| 중형 이상: 조절 − 무지성 | **24.0%p** ✗ | 26.4%p | ≥ 25 |
| 중형 이상: 조절 − 기본 | 23.2%p | 23.4%p | ≥ 10 |
| 대형: 조절 − 고정 · 고정 | 11.1%p(시드에 따라 7.9) · 49.6% | 12.9%p · 49.2% | ≥ 10 · ≤ 60% |
| 파손: 조절 · 기본 · 무지성 | 0 · 0 · **13.7%** ✗ | 0 · 0 · 15.3% | ≤ 2 · ≤ 5 · ≥ 15 |

무지성 파손 15.3%는 하한 근처다(계약 §7.12도 「무지성 하한 근처」라고 적었다). 더 올릴 ±20% 손잡이는 이 패키지에 남아 있지 않다.

## 데이터에 더한 것

- `data/fightStyles.js`의 `LATERAL_DEFAULT = {turn 0.8, run 0.3, charge 0.2, other 0.1}` — §5.3.4의 lateral 기본값(로직 파일에 숫자를 두지 않으려고). 특성 `spin`의 「2배」는 데이터(`scaleByKind.turn.lateral 2`)로만 적용한다(코드에서 한 번 더 곱하지 않는다).

## 계약 해석(내 파일 안에서 정한 것)

1. **예고 중의 `behavior` · `behaviorName`**: 예고는 지금 상태 위에 걸린다 — 예고가 끝나 `enter` 할 때까지 이전 상태 이름을 유지한다(힘은 `FIGHT.tele*`). 시작 예고(§5.3.1)는 이전 상태가 없어 시작 상태 이름 · kind 를 미리 넣는다(`behaviorDur 0`). 다음 상태 이름은 `fight.brain.pending`.
2. **예고 종류가 없는 kind 에 `tele`가 있으면** 바로 들어간다(예고 종류는 run · jump · charge · dive 넷뿐 — §5.3.3).
3. **점프 · 흔들기 굴림의 「진입 틱」**: `enterState`가 `fight.brain.entered = true`를 세우고 updateFight 5가 그 틱에 한 번 굴린다(같은 틱 앞의 1에서 구한 loose 사용).
4. **베일 열림(a)**: `slipping = false` · `slipSpeed 0`(클리커 없음) · 다가오는(Fal ≤ 0) 물고기는 거리를 바꾸지 않는다(계약 식 그대로).
5. **`createFight`가 내는 이벤트**: 시작 예고면 `FIGHT_TELEGRAPH{lead: startTele}`, 아니면 `FIGHT_BEHAVIOR`. 장애물 띠 안에서 걸면 `SNAG{on:true}`도 낸다(HUD 경고가 첫 틱부터).
6. **`FIGHT_SHAKE.strength`** = `shakeAmp × fat`(0..0.6). **`FIGHT_JUMP`**: 점프 상태에 들어간 틱에 leave, 점프 상태를 벗어나는(다음 상태 · 예고) 틱에 land. 위치는 origin + fwd(bearing) × dist.
7. **`stats.runs`**: run · dive 진입마다(뜰채 재질주 포함). `stats.jumps`: jump 진입마다.
8. **특성 합치기 순서**: 한 특성 안에서 addStates → addNext → scaleByKind → nextMulByKind(§8.2 목록 순). 그래서 multiJump 의 jump → jump 는 (0 + 0.3) × 2 = 0.6.
9. **`bot/policy.js` controlled 의 세부**(§12.1이 정하지 않은 것): 장애물 경고(`inSnag`)가 질주보다 먼저(0.80) · 눈금은 내림(`floor`) · 예고는 `teleReact` 동안 본 뒤 질주 대응(charge 예고는 질주 대응이 아니다 — 감으며 세운다) · 펌핑은 로드를 다 숙인 뒤 다시 세운다 · charge 중에도 펌핑(여유 줄 거두기). 드랙 손 속도는 `BOT.dragEveryTicks` 마다 한 눈금. `seed`는 쓰지 않는다(무작위 없음).
10. **봇이 읽는 값**: `fight.telegraph · behavior · tension · lineKg · lineEffKg · canNet · inSnag · rodLift`(로드 각도는 화면에 보인다) · `rig.dragNotch` · rigStats. `speciesId · k · brain · stamina · roll`을 읽지 않는 것을 `fight.test`가 Proxy 로 검사한다.
11. **방위 허용 반각에서 튕길 때** `lateralSign`을 안쪽(−부호(off))으로 둔다(바깥으로 가려던 부호만 뒤집는 것과 같다).
12. **고정 상태(`debug/fixtures`) 호환**: `fight.brain`에 `entered · pulseIdx · air`가 없어도 돈다 · 모르는 `behaviorName`이면 시작 상태로.

## 계약의 모순 · 통합 때 볼 것

1. **styles.report 「무게형 변동계수 ≤ 돌진형 0.5배」는 🔒 값으로 닿지 않는다.** M14 조건(대표 어종 중앙값 · 그 자리 · 호수 1/갯바위 2단계 · 입에 맞는 바늘 · 기본 봇 300판)에서 붕어 0.328 vs 참돔 0.477 → **0.687**. 원인: 무게형의 hold(f 0.65) ↔ rest(f 0.25 × along 0.5) 교대와, 판 전체 변동계수에 체력 감소(fat 1 → 0.36)의 추세가 들어간다. ±20% 재량(dur · next · along)을 다 써도 0.565, rest f(🔒)를 0.45 · along 1 로 올려도 0.528. 분당 질주는 **0.230**(≤ 0.4 ○). 테스트는 분당 질주 ≤ 0.4 · 변동계수 비 < 1 · 요동형(쏘가리)의 변동계수 최대 · 점프형만 점프 · 잠수형만 박힘을 검사하고, 0.5 기준은 표에 「계약 목표」로 보고만 한다. → 밸런스 게이트가 지표(예: 2초 창 변동계수 — 0.648)나 기준을 정할 것.
2. **「쌍마다 지표 2개 이상 25%」**: 계약이 이름 댄 일곱 지표(최대 · 평균 · 분산 · 분당 질주 · 분당 점프 · 슬랙 · 길이)만으로는 **돌진형(참돔 1.51kg) ↔ 잠수형(돌돔 1.85kg)이 하나도 갈리지 않는다**. 화면에서 읽히는 넷(미끄러짐 비율 · 박힘 평균 · 옆 움직임 m/s · 평균 수심)을 더해 검사한다(그 쌍: 박힘 · 옆 움직임 · 수심).
3. **호수 자갈의 완벽 캐스팅이 장애물 띠 안에 떨어진다**: 1단계 바닥 로드 `castMaxM 32` ≥ `lake_gravel.snag.fromM 31`. 봇은 게이지 표본 `N(0.90, 0.04)`가 완벽(≥ 0.94)이면 32m — 캐스팅의 약 16%가 띠 안에서 파이팅을 시작해 즉시 쓸린다. 완벽을 빼면(계약 값으로) 측정이 설계 숫자와 거의 같다(기본 85.5% · 중형 이상 조절 92.5 / 기본 71.3 / 무지성 65.2) — 설계 스크립트는 띠 밖에서 시작했을 가능성이 크다. 완벽 캐스팅이 벌이 되는 것은 감각상 이상하다 → P3(`data/stages/lake.js`) · 밸런스 게이트: `snag.fromM`을 33 이상으로(그러면 이 패키지의 ±20% 조정 일부는 되돌려도 된다).
4. **장애물 띠에서 상한 라인의 「긴 헛판」**: 띠의 쓸림 `rate 0.12/s`면 7초에 `maxAbrasion 0.9`(유효 0.4kg). 조절 봇은 드랙을 유효 강도에 맞춰 내리므로 물고기가 스풀 끝까지 천천히 끌고 간다 — 조절 봇 spoolEmpty 판의 길이 **중앙 345초 · p90 428초**(대형 표본). 사람도 이길 길이 없다(조이면 끊김). 몇 분씩 누르는 헛판은 QUALITY 「한 판 길이」에 걸릴 수 있다 → 밸런스 게이트 · P8(HUD 라인 손상 표시 · 「끊어 내기」 안내) 검토.
5. **charge(사라지기) 와 「감으며 세우면 슬랙을 막는다」**: 거두는 속도는 `릴 회수 + pumpGain/DT`인데 펌핑 이득은 rodLift 0.5 → 1 구간(≤ 0.32초)에서만 난다. 왕연어(22kg) 접근 속도 ≈ 2.1m/s > `reel_3` 2.0m/s 라, 1–2초 charge 중 로드가 다 선 뒤에는 슬랙이 생긴다(위험률은 slackTime 에 비례해 작다). `fight.test`는 「세우는 동안 슬랙 0 · 가만히보다 훨씬 적다」로 검사한다.
6. `test/fixtures.test.js`의 「helpers: 리터럴이 실제 함수 · 계약 모양과 같다」가 지금 실패한다(시계 `light` 0.577 vs 1 — P3 `clock.js` 또는 `data/time.js`). 이 패키지와 무관.
