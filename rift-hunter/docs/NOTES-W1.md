# NOTES-W1 — 웨이브 1 통합 게이트

W1 여덟 패키지(P1~P8)의 실제 구현을 한데 맞물려 본 결과. 계약의 공개 이름 · 시그니처는 바꾸지 않았고, 비어 있던 해석은 `CONTRACT.md`에 「W1 확정」으로 적었다.

## 1. 게이트 결과 (마지막 실행)

| 명령 | 결과 |
|---|---|
| `npm run build` | ✓ built · 오류 0 · JS 1개(986 kB) |
| `npm test` | tests 452 · pass 437 · **fail 0** · skipped 0 · todo 15(전부 W2 자리 — app · ui · analytics · audio · bot · headless · measure · perf · content · view.fx) · 16.5초 |
| `npm run check:dist` | `DIST ok — /gallery/rift-hunter/ · 요청 3건(200 3) · JS 청크 1개 · 표식까지 2763ms` · `release/boot.png` 직접 봄(마을 · 플레이어 · NPC · 포털 · 균열석 흰 고리) |

## 2. 고친 것

| 파일 | 무엇 |
|---|---|
| `src/sim/projectiles.js` (P2) | **꿰뚫는 화염** — 관통이 남은 폭발 투사체가 접촉마다 폭발하게(§7.9 문면 · 게임 안 툴팁 `legfx.piercingFlame` 「관통하며 맞힐 때마다 폭발한다」와 W1 구현이 달랐다 — 한 번만 터졌다). 접촉한 몬스터는 폭발 원 안에서 한 번 · pierce − 1 · 다 떨어진 접촉에서 끝. |
| `test/effects.test.js` (P2) | 위 규칙 회귀 검사 하나(pierce 2 → 폭발 3 · 넷째 몬스터 그대로 · HIT 3). |
| `src/sim/monsters/monsters.js` (P3) | `moveMul`이 `status.monSpeedMul`(계약 정본)에 맡긴다 — 두 패키지가 같은 §5.8 규칙을 따로 들고 있던 것(NOTES-P3 · 지금은 같음)을 하나로. |
| `src/sim/progression/shops.js` (P6) | 도박의 「그 부위 · 클래스에 전설 · 세트 후보가 있나」를 P5 `specialCandidates`로 — §6.10 「P6이 고르기를 다시 구현하지 않는다」. 결과는 지금 데이터에서 같다(shops.test 통과). |
| `test/helpers.js` (P0) `scriptedClear` | **결함 수정**: 직선 거리로 가장 가까운 몬스터를 붙잡아, 벽 너머 직선 16m · 경로 120m(A* 노드 상한 밖)인 궁수 앞 벽에서 15분 동안 아무것도 못 했다(시드 7 · 두 클래스 · 처치 0). → 흐름장 걸음 수로 닿는 대상(깬 것 먼저) · 없으면 경로를 8m씩 클릭 · 생명 40% 아래 포션 · 선택 `untilComplete`(수호자까지). 시그니처는 그대로(옵션 하나 추가). |
| `test/gameSim.test.js` (P2) | 「W1 통합」 검사가 제목(게이지 100%)과 달리 붕괴도 통과로 봤다 → 둘로: ① 시작 캐릭터 · 끝(완료 또는 붕괴)까지 · 붕괴면 `RIFT_COLLAPSE` → 부활 → 마을 · `RIFT_CLOSED{collapse}` · 기록 / ② **완료 경로** — 개발 캐릭터(L10 · 프리셋 A · `makeDevCharacter`) · 무적으로 게이지 100% → `GAUGE_FULL` → `GUARDIAN_APPEAR` → 완료 → `RIFT_COMPLETE`(요약 · 수호자 처치 1) → `UNLOCK`(무사망 +2) → 나가는 포털 → 마을 · 재고 갱신 · 기록 — 두 클래스(+7초). |

## 3. 계약 수정(「W1 확정」 표시 — 모두 지금 구현에 맞춘 것)

- §3.5 `Item.cls` — 전설은 그 행의 cls · 세트 조각은 그 세트의 cls(클래스 전용).
- §4.2 `BUFF`(addBuff는 내지 않는다 · 끝남만 P2) · `SHAKE`(효과 `spec.shake` → P2가 hitAt에 · P3는 직접 내지 않는다) · `PICKUP_FAIL{reason:'full'}`(포션 상한) · `DURABILITY`(broken = 0인 칸 전부 · fraction = 이번 손실).
- §5.2-5 원거리 · 연쇄 번개의 시야는 막는 소품까지(`losClear(…, {props:true})`).
- §5.5 포션 · 두루마리를 쓰는 감소는 P1이 직접(`addConsumable`은 더하기만) · `rift.stats.potions`는 P1.
- §5.10 완료 경험치는 P2 `finishRift`의 `grantXp(…, 'complete')` · `rift.stats.xp` · `meter.runXp`는 P2가 `amount`로 · 완료 정리 몬스터는 사망 훅을 돌리지 않는다.
- §5.14 재굴림 후보는 파생 난수(NOTES-P6 #1 — 「제안 → 취소 → 제안」 공짜 굴림 방지)를 확정.
- §6.6 `findPath` 끝점 옮김(≤ 1.5m) · 빈 경로 · 노드 상한의 뜻 / `FlowField.dist`는 정수 가중 거리 — 걸음 수는 `flowDist`만.
- §6.8 status `apply*`에는 데이터 값(등급 배율은 status.js) · 공격 취소 때 몸에 붙은 예고도 지움 / `spawnEffect`의 `spec.shake` · `spec.onHit.rootSec`(감옥) / `canStartHazard`의 `opts.shape` · H2 확장 · 진행 중 = start ≤ tick ≤ hitAt / 폭발 투사체 접촉마다 폭발 / `unloadCharacter` 뒤 app이 잡아 둔 캐릭터로 다시 저장.
- §6.9 `startAttack(…, opts?)` → 예비 길이(초) · 속성 훅 `onHitPlayer`의 여섯째 인자 `spec`.
- §6.10 `slotDist(cls, mix?)` · `specialCandidates` 추가 · §6.11 `gambleOdds`가 그것을 쓴다 · `loadAccount`/`loadChar`의 `future`.
- §7.12 `MAPGEN.normalMin` 56.
- §7.14 **받는 피해 실측**(아래 4 · 5의 첫 항목) — 밸런스 게이트의 첫 과제로.
- §9.2 「(§9.5)」 → §9.4 오기 · 안개 × `FOG_K` 0.5 · 빛 세기 상대값(× `LIGHT_SCALE` 24 · 반구광 × 12).
- §10.6 신비술사 「3번째부터 망각의 정수」 → `priceReroll(item).essence` 그대로(식대로면 4번째부터).
- §13 P2 — 통합 검사 두 개의 뜻.

## 4. 통합 스모크 — 실행한 것과 결과

모두 `docs/_scratch/`의 임시 스크립트(끝나고 지움) · 실제 `GameSim` + 실제 W1 구현.

- **교차 호출 · 이벤트**: §4.2의 sim 이벤트 60개 전부 발행 지점이 있다(ui · app 이벤트 아홉 중 발행 0인 여섯은 W2 P9). 실제 판(두 클래스 · 무적 완주 + 퍼즈)에서 나온 payload의 키 집합을 §4.2 표와 대조 — **빠진 필드 · 남는 필드 0**. 이번 판에 나오지 않은 일곱(CHANNEL · SHIELD · PORTAL_CLOSED · PICKUP_FAIL · BAG · EQUIPPED · TRADE)은 발행 코드를 직접 읽어 같은 키를 확인. §6의 공개 export 전부 · GameSim 명령 · 디버그 전부 있다. sim이 돌려주는 실패 사유 32가지가 모두 `reason.*` 문자열에 있다. `flow.dist`를 직접 읽는 곳 0.
- **완료 경로**(무적 · 레벨업마다 프리셋 · 포션 · 흐름장 대상): 두 클래스 × 시드 3 — 전부 게이지 100% → 수호자 → `RIFT_COMPLETE` → `UNLOCK`(1 → 3) → 나가는 포털 클릭(`INTERACT riftPortal`) → 마을 → 정비(장착 · 일괄 판매 · 수리 · 포션) → 균열 다시. 한 판 9~13분(전사 11.5~13 · 마법사 9~9.5).
- **실패 경로**: 사망 → 부활 → 마을 → 복귀 4번 → 붕괴(`RIFT_COLLAPSE` · `LIVES` 3 · `DURABILITY` 4) → 부활 → `RIFT_CLOSED{collapse}` · 기록 collapse.
- **루프 경로**: 대장장이까지 걸어가 `INTERACT{npc}` · 귀환 두루마리(`RECALL start → done` · 마을 포털 열림) → 마을 포털 클릭 → 떠난 자리 그대로(거리 0.00) · 완료 → `leaveRift` → 재고 갱신(판마다 한 번) · 완료된 균열로 다시 들어가기 · 저장 왕복(`serializeChar` → `loadChar` → `loadCharacter` · broken 0) · `unloadCharacter`.
- **퍼즈**: 균열 3 · 레벨 8 · 무작위 입력 10,000틱 × 3(두 클래스) + 무작위 명령 ~280(장착 · 판매 · 분해 · 스킬 · 정예 소환 · 드랍) — 예외 0 · NaN 0 · 불변식(생명 · 자원 범위 · 골드 · 재료 정수 ≥ 0 · 아이템 ID 유일 · 몬스터 · 플레이어 걷기 가능 칸) 0 위반 · **두 번 돌려 상태 해시 같음**.
- **view를 실제 상태로**: Node에서 WorldLayer · ActorLayer · CameraRig를 실제 판(무적 완주 2판 + 균열 5 퍼즈)의 상태로 17,400프레임 갱신 — 예외 0 · 인스턴스 행렬 · 카메라 NaN 0.
- **기둥 뒤 대상**: 진짜 A*로 전사 · 마법사 모두 기둥을 돌아 쳤다(8경우 · 첫 적중 30~74틱 · 마법 화살 벽 끝 0) — NOTES-P1 #2 해소.
- **성능**: 깨어 있는 ~100 + 투사체 200에서 `step` 평균 2.22ms(최대 12.6ms 한 번) · `generateRift` 20시드 최대 104ms.

## 5. 브라우저 스모크 (헤드리스 `probe:screen` · dev 서버 5420 — 끝나고 끔)

`?fixture=` 15개 전부 · `?panel=` 넷(스텁) · 실제 흐름(`--eval`로 `__game.sim.openRift` → `commitTravel`: 균열 1 전사 · 균열 3 마법사(잿빛 동굴) · 정예 · 챔피언 팩 소환 전투 · 무적 900틱 장기) · 실제 마을 · 1920×1080(town · riftSwarm — 스크래치 사본 프로브). **`errors()` 전부 0 · SCREEN ok**. 보인 것: 생성 맵의 벽 · 촛불 · 관 · 항아리 · 화로 · 가린 벽 낮춤 · 마을 NPC 넷(P8) · 포털 · 균열석 흰 고리 · 챔피언 파란 테두리 · 빛기둥(전설 주황 · 세트 녹색) · 수호자 · 시체.

## 6. 다음 웨이브(W2)가 알아야 할 것 — 패키지별

**밸런스 게이트 · 오케스트레이터 (가장 먼저)**
- 시작 캐릭터가 균열 1을 깨지 못한다(§7.14 실측 · 아래 7-1). W2 P15의 `headless` S1(「균열 1 클리어 · 사망 ≤ 1」)과 `measure.test`(「게이지 100% 도달」)가 이 수치로는 통과하지 못한다 — W2 시작 전에 정할지, 밸런스 게이트에서 정할지 오케스트레이터가 고른다.
- 손잡이: 🔒 `MON.dmgBase` 3.5 · 클래스 생명(`CLASSES.life`) · `MON.linkRadius` 8 · `MonsterDef.aggro` 12~16 · `MAPGEN.normalMin` 56 · `PACKS` 크기(구울 6~12) · 근접 `recover` · `DEATH.protectSec` · 첫 판 `RIFT.earlyGaugeMul` · `XP.reqEarly`.

**P9 app**
- `quitToTitle`: `unloadCharacter` 전에 캐릭터 참조를 잡아 두고 뒤에 그 참조로 한 번 더 저장(abandon 기록).
- `loadAccount` · `loadChar`의 `future`면 덮어쓰지 않는다 · `rebuildAccount`가 돌려준 `chars`는 ID가 바뀌었을 수 있어 계정과 함께 다시 쓴다.
- `SAVE_REQUEST`가 판마다 500~680개(처치마다 경험치 저장 요청) — §11.6대로 프레임 끝 한 번으로 묶는 것이 필수.
- 화질은 `settings.quality`만 바꾸면 `rc.render()`가 바꾼다(antialias는 만들 때만) · `webglcontextrestored` → `world.setMap` · `actors.setMap` 다시 · CameraRig는 `PLAYER_SPAWNED`를 스스로 받는다(`camera.snap()`은 무해한 중복) · `__game.step`(dtReal 0)에서도 카메라 · 벽 낮추기가 틱 × DT로 진행.
- 최소 부트는 `pendingTravel`을 commit하지 않는다 — Game의 전환 막이 한다.

**P10 · P11 ui**
- `INTERACT`는 포털에도 난다(소리용) — 패널은 npc · stash · riftStone만. `town.lastInteract`가 도착한 물체.
- 실패 사유 · TRADE.kind · 결과 모양은 NOTES-P6(「P10 · P11」 문단) 그대로 · 신비술사 정수는 `priceReroll(item).essence`를 그대로.
- `compareEquip`(class · level 실패도 「꼈다면」 값) · `Item.cls`(전설 · 세트는 클래스 전용) — NOTES-P5 #2 · #4.
- `PICKUP_FAIL{reason:'full'}`(포션 상한) · 마을에서 스킬 → `SKILL_FAIL{reason:'town'}` · 빈 칸 → `skillId null · 'empty'`.

**P12 analytics** — `slotDist(cls, mix)` 둘째 인자로 시뮬과 같은 부위 분포 · 1~2% 칸은 표본 오차가 3%와 같은 크기(표본 수나 σ를 같이 — NOTES-P5 #8).

**P13 fx**
- 여진 `stomp`는 예고 고리를 그리지 않는다(판정 순간만 — 상태에는 delay 0.5의 효과로 있다).
- 효과 kind · 투사체 visual은 P1 스킬 params(`fx*` · `visual*`) · 폭발은 `EFFECT_HIT{kind: explode.visual}` — 꿰뚫는 화염은 이제 접촉마다 하나씩.
- `player.air`(도약 · 돌진) · 채널의 굴러가는 `actHit/actEnd` · 순간이동 판정 틱의 `prevPos = pos` · 속성 상태 필드(`shielding {nextAt, warnUntil, offUntil}` · `coldEnchanted {nextAt}` · `vampiric {fxAt}`).
- W0 스텁 FxLayer의 베이지 원반(투사체 자리 표시)이 그대로 보인다 — P13이 바꾼다.

**P14 audio** — 한 판(균열 1)에 `HIT` 1,650~3,300 · `MON_ACT` 2,600~7,700 · `MON_STRIKE` 2,300~7,200 · `PROJ_SPAWN` 3,000~5,000 · `SHAKE` ~230(전사) — 상한 필수. `INTERACT riftPortal`(포털 소리).

**P15 bot**
- `findPath`는 경로 ~80m까지만 찾는다(넘으면 부분 경로) — 멀리 있는 몬스터를 벽 너머로 클릭하면 벽 앞에서 선다. 방 · 통로 그래프로 경유점을 찍는다(`scriptedClear`의 수정이 같은 문제였다). 닿는지는 `flowDist`(플레이어 중심 · 100걸음)로.
- 사망 뒤 몬스터는 그 자리에서 잠들고 복귀는 안전 지점 — 같은 떼가 1~2초 안에 다시 깬다(아래 7-3).
- 상점 명령은 마을 밖에서 `'notInTown'` · 재고는 판이 바뀐 뒤 첫 마을에서 한 번.

**P16 content**
- 감옥 = 적대 효과 `spec {raw:0, onHit:{rootSec}}` + `canStartHazard(…, {jail:true, shape})` · 자기 중심 위협은 `shape`를 넘긴다 · 흔들림은 `spec.shake`.
- 훅: `onHitPlayer`의 여섯째 인자 `spec` · 깰 때 `mon.ax[id] = {}`로 새로 — 「깬 뒤 first」는 첫 `onAwakeTick`에서 `st.nextAt`이 없을 때 · 사라짐은 프레임워크가 actEnd에 idle로(훅은 자기 st로 「사라지는 중」을 안다).
- 잿빛 마녀: `mon.ax.b.move = 'kite'`(params keepMin · keepMax) · `startAttack`의 반환 = 그 틱 효과의 delay · 선택 `onDamaged` · `tickAttack`. 지금은 P16 스텁이라 쫓아오기만 한다.

## 7. 남은 문제

1. **[막는 것 — 밸런스] 시작 캐릭터가 균열 1을 깨지 못한다.** 들어서고 2~3초에 40~50마리가 깨고(시야 2팩 + 연결 4팩), 10~20초 사이 플레이어 3m 안이 20마리를 넘는다. 간이 스크립트(포션 · 프리셋 학습)는 두 클래스 × 시드 4개 첫 판 전부 붕괴(36~97초 · 처치 3~24) · 15분 동안 레벨 4~5가 돼도 붕괴만 반복. 연결 0 · 시야 × 0.75로도 전부 붕괴 · 몬스터 피해 × 0.33도 전부 붕괴 · × 0.2에서 8판 중 6판 완료. 스크립트는 피하기 · 카이팅이 없어 봇보다 약하지만, 구울 6마리 한 팩도 포션 없이는 못 버티는 산수(§7.14 실측)라 봇으로도 크게 달라지지 않을 것이다. 🔒 값이 걸려 있어 이 게이트에서 바꾸지 않았다.
2. **[주요 — 밸런스] 첫 판 길이**: 무적이어도 9~13분(스킬 학습 포함 · 목표 ≤ 9분 · §7.14 추정 7.5분) · 기본 공격만이면 15분에 게이지 78~92%. 처치 속도 · `RIFT.earlyGaugeMul` · 맵 밀도를 같이 본다.
3. **[주요 — 설계] 부활 뒤 같은 떼**: 사망 때 몬스터가 그 자리에서 잠들고(§5.10) 복귀는 안전 지점이라, 안전 지점에서 aggro 안에 있던 떼가 복귀 1~2초 뒤 다시 깬다(도착 보호 1.5초) → 4번 사망 · 붕괴까지 30~100초. 손잡이: 진정 때 깬 몬스터를 팩 자리로 되돌리기 · 안전 지점 조건(15m) · `DEATH.protectSec`.
4. [작은 것 — 화면] `lavaCrack`(주황 · 붉은 바닥 발광)이 시작점 바로 밑에도 놓인다(시드 hash32(7,1) · L3 · 0.47m) — 위협 색(붉은 표식)과 섞일 수 있다(브리프 §5). 화면 패스에서 색 또는 시작점 둘레 금지.
5. [작은 것 — 화면] 쓰러진 플레이어(등을 대고 팔을 벌림)가 55° 카메라에서 서 있는 T자로 읽힌다(`riftDeath`). 어둡게 하기 · 옆으로 눕히기.
6. [작은 것 — 화면] 단계 0 가죽(전사)이 던전 조명에서 거의 검게 보인다(NOTES-P8) — 화면 패스.

## 8. 사람이 확인할 것 (이 환경에서 못 본 것)

실시간 재생(클릭 이동 · 누르고 있는 공격 · 선입력 · 회오리 · 도약 궤적 · 걷기 발 고정 · 카메라 따라가기 · 흔들림 · 벽 낮추기 0.15초 · 빛 깜빡임) · 소리 · 실제 GPU 프레임(120마리 + high 그림자) · 손으로 균열 1을 해 본 체감(위 7-1의 실측이 사람에게도 그런지).
