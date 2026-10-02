# NOTES-W1 — 웨이브 1 통합 게이트

P1–P8 의 병렬 구현을 한데 맞물려 돌리고, 패키지 사이의 어긋남을 고쳤다. 실제로 돌린 명령과 출력에 근거한다.

## 1. 게이트 결과 (마지막 실행)

| 명령 | 결과 |
|---|---|
| `npm run build` | ✓ built · 오류 0 · JS 청크 1개(914 kB · gzip 263 kB) |
| `npm test` | tests 287 · **pass 260 · fail 0** · todo 27(W2 몫 — app · bot · stage 테스트 자리) · 9.6초 |
| `npm run check:dist` | `DIST ok — /gallery/jay-fishing/ · 요청 3건(200 3) · JS 청크 1개 · 표식까지 2791ms` · `release/boot.png`를 직접 봤다(호수 06:00 비 · HUD · 안내 카드 · 자리 깃발) |

시작 상태: `npm test` fail 2(`fixtures.test` 「helpers: 리터럴…」 · `rig.test` 「createAngler … 50번」) · P7 테스트 23개가 `npm test` 글롭 밖.

## 2. 고친 것

| 파일 | 무엇을 · 왜 |
|---|---|
| `test/fixtures.test.js` | 「helpers: 리터럴 = GameSim 시계」 비교를 같은 날씨로(`start.weather:'clear'`) — 실제 날씨(§7.2 해시)에서 seed 1 · 1일 · lake 는 비라 `light` 0.577 ≠ 1. 시드 날씨에서도 같은지 한 줄 더 |
| `test/rig.test.js` | `createAngler` 50판: 실제 `applyCatch`(P4)로 어창이 12에서 차므로 keep · swap · 방생을 합해 50판 · 어창 ≤ 용량 · 50판 뒤 가득 · `CATCH_KEPT` = keep 수 · 방생(`swapped:false`) = release 수 |
| `test/audio.test.js` · `test/fx.test.js`(새 자리) | P7 의 `src/audio/AudioEngine.test.js` · `src/view/fx/FxLayer.test.js`를 `test/`로 옮겼다(import 경로만 바꿈 · 23개 그대로 통과) — `npm test` 글롭 안 |
| `src/sim/GameSim.js` | `getShop()`: 집에서 1단계 라인 감기(`refill_<set>_line_1`) `price 0` · 돈 사유 제거 / `buy('refill_…')` → `this.refillLine`(집의 line_1 무료) — 목록 · 구매 · 감기가 같은 값(NOTES-P4 #2 · P8). 전에는 `buy('refill_float_line_1')`가 집에서도 돈을 받았다 |
| `src/sim/progression/economy.js` · `src/ui/panels/shared.js` | 가득인 같은 라인 감기 항목의 사유 `'same'`(「이미 여기다」) → `'full'`(「이미 가득 감겨 있다」 — P8 이 더한 `reason.full`). ui 는 `'full'`을 본다 |
| `src/ui/UIRoot.js` | 씬에 묶인 안내 카드(`start` 집 · `stage` 야외)는 씬이 바뀌면 내린다 — 지도 패널 동안 수명이 멈춰 있던 집의 「문으로 나가 호수로」가 호수 도착 뒤 다시 떴다(정지 화면으로 확인 · 고친 뒤 `stage` 카드가 뜬다) |
| `src/view/world/markers.js` | 자리 깃발 `rotation.y = facing + π/4`(전 `π/2`) — 스폰(땅 쪽)에서 정면으로 다가가면 깃발이 옆면(0px)이었다. 호수 스폰 정지 화면에서 20m 앞 자리의 주황 깃발이 보이게 됐다 |
| `src/main.js`(최소 부트) | `window.__game`에 §11.7 의 sim 디버그 위임 `setTime · setWeather · forceBite · forceFight · grant · setGear · skipToResult · hash` — sim 이 도는 화면(파이팅 · 결과 · 밤)을 probe 로 보려고. W2 의 `debugApi`가 같은 이름으로 대신한다 |
| `src/types.js` | `PlayerState`에 선택 필드 `[vel]`(P3 의 내부 걷기 속도 — 계약 §3.4 와 같게) |
| `test/data.schema.test.js` · `test/ui.strings.test.js` | 결과 사유 목록에 `full` |
| `test/economy.test.js` · `test/gameSim.test.js` | 회귀: 가득인 라인의 사유 `full` / 집의 line_1 이 `getShop` · `buy` · `refillLine`에서 무료 · 야외는 유료(`money`) |
| `test/integration.test.js`(새 파일) | 실제 구현끼리 — 아래 3절의 S1 · S2 · S6 · S7 · S4b 를 줄여 영구 테스트로(0.7초) |
| `docs/CONTRACT.md` | 4절 |

## 3. 헤드리스 통합 스모크 (임시 스크립트 — 지웠다. 요약은 `test/integration.test.js`로 남겼다)

모두 실제 GameSim + rig + fight + progression + angler/policy, §6.8 러너 규칙(명령은 step 전 · result 는 step 하지 않음). 600틱마다 `assertFiniteDeep` + §3.4 모양(`RigState` · `PlayerState` · `FightState` · `CatchRecord`) + 돈 ≥ 0.

| ID | 시나리오 | 결과 |
|---|---|---|
| S1 | 호수 자갈 · 기본 봇(바닥 · 떡밥) · 06→10시(sim 600초) → 판매 → 집 → 수면 → 세이브 왕복 | 예외 0 · NaN 0 · 캐스팅 15 · 입질 13 · 챔질 13 · 랜딩 10 · 라인 끊김 3 · 헛챔질 1 · 경험치 이벤트 10 · 첫 포획 5 · 레벨 업 1 · 실패 → 재캐스팅 중앙 1.75초 · 최대 1.8초 · 파이팅 중 거리 증가 66회(질주) · 감소 433회(릴링) · 체력 최저 0 · 판매 10마리 19,080원 = 견적 · 세이브 → 새 GameSim 프로필 동일 |
| S2 | 끝 두 가지(디버그로 당김): 무지성 × 잉어 99% / 조절 × 붕어 중앙 | 30/30 lineBreak / 30/30 landed |
| S3 | 이른 Space · 늦음 · 미끼 0 + 돈 0 | `HOOK_MISS{early}` → `{late}` · 무료 지렁이 10 → 바로 충전 · 하루 두 번째 0 은 `CAST_BLOCKED` |
| S4 | 무작위 입력 퍼즈: 자리 6곳 × 50,000틱 · 걷기(집 · 호수) × 30,000틱 + 이동 · 캠프 · 수면 · 판매 · 일어나기 명령 | 예외 0 · NaN 0 · 모양 · 돈 ≥ 0 (무작위 Space 는 예신에 먼저 걸려 파이팅까지 가지 않는다 → S4b) |
| S4b | 파이팅 퍼즈: 아홉 자리 × 그 풀 어종 × 1 · 3단계 로드 × 무작위 입력 40판 | 예외 0 · NaN 0 · 다섯 끝(landed · lineBreak · spoolEmpty · rodBreak · hookOff) 모두 나옴 |
| S5 | 결정성(조절 봇 30,000틱 두 번) | 해시 같음 |
| S6 | 실패 → 재도전(실제 `applyLoss`): 예비 스풀 12판 · 2단계 로드 파손 12판 | 예비 스풀 12/12 · 파손 12/12(`dragKgAfter` 1.6kg · `RIG_RESTORED{rodReplaced}`) · FAIL → 다음 `CAST_RELEASE` **1.72–1.82초** · 누름 1번(+뗌) |
| S7 | 집 도착(실제 P4): 어창 3 · 찌 라인 50m | `SOLD{auto}` → `LINE_REFILLED{cost 0, 70m}` → `SAVE_REQUEST{scene}`(마지막) · 돈 증가 = 견적 · 어창 0 |
| 띠 | 호수 자갈 · 기본 봇 · 시드 20 × 4시간 | 아래 6절 #1 |

W1 보고의 「확인하지 못한 것」 중 이것으로 닫힌 것: P1(실제 P2 위의 angler · 예비 스풀 재도전) · P3(실제 P4 위의 집 도착 · 세이브 왕복) · P4(손실 → `RIG_RESTORED` → 1.7초 재캐스팅).

## 4. 교차 대조 (테스트가 못 잡는 것 — 눈으로)

- **이벤트 57종(EV 전부)**: sim 의 `ctx.emit` 지점 전부의 payload 가 §4.2 그대로다. 구독자(Tackle · Fish · Fx · World · Audio · UIRoot · main)가 읽는 필드는 전부 발행자가 넣는다. `EQUIPPED`를 tackle 이 구독하지 않지만 매 프레임 `profile.sets[set].rod`를 읽어 바꾼다(이벤트 누락 안전 — 문제 없음). `CATCH_RELEASED{swapped:true}`에도 fx 방생 물보라 · 소리가 난다(어창에서 뺀 물고기를 놓아준다 — 의도로 둔다).
- **view · ui · audio 가 읽는 상태 필드**: fight 27 · rig 24 · player · clock · env 필드 전부 §3.4 에 있고 실제 sim 이 채운다(스모크의 `assertShape`). `env.light · night · time`은 소품의 `PropsEnv`(§9.4)다. view 의 `fight.speciesId`(그림자 모델)는 허용(ui 는 읽지 않는다 — 확인).
- **ui → sim 명령**: ui 가 부르는 19개 전부 GameSim 에 있다. ui 의 sim import 는 순수 조회 함수뿐(`formatClock` · `hourOf` · `nextWake` · `nextBandStart` · `bandOf` · `xpToNext` · `computeModifiers` · `sellPrice` · `availableCount` · `isOwned`).
- **rig → P2 · P4 호출**: `createFight` · `updateFight` · `applyLoss` · `evaluateCatch` · `applyCatch` · `grantFreeBaitIfNeeded` · `placePlayer` 시그니처 일치. `stats.*` 이중 증가 없음(`lost`는 P4 만 · `casts`는 P1 만).
- **문자열**: sim 이 돌려주는 결과 사유 전부 `reason.*` 키가 있다(이벤트 사유는 해당 없음). `ui.strings.test` 통과. 정지 화면에 키가 그대로 보인 곳 없음.
- 남은 스텁: W2 파일뿐(`src/app/*` · `bot/bot.js` · `bot/planner.js` · `coastProps.js` · `riverProps.js`).

## 5. 브라우저 스모크 (헤드리스 `probe:screen` · 1280×720, 일부 1920×1080 — 모두 `SCREEN ok` · `errors()` 0)

sim 이 도는 줄: 시작(`/`) · 집 · 호수 아침 · 정오 맑음 · 호수 자리 ready · 찌 입질(`forceBite`) · 파이팅 초반/10초(`forceFight('carp', 0.95)`) · 60초 파이팅 끝 · 결과 패널 · 호수 밤 22시(헤드랜턴 · 늦음 알림) · 갯바위 19시 비 · 강 깊은 홈 22시 · 화질 low/high 의 배스 파이팅(점프 예고 HUD · 반사) · PC(레벨 1 · 레벨 12 / 300만 원) · 채비 · 판매상 · 지도 · 캠프 · 침대 · 일시정지 · **ui 를 거친 이동**(집 → 지도 → Enter → 호수 07:00). 고정 상태: `waiting` · `take` · `charging` · `fightStress` · `fightJump` · `netReady` · `landing` · `failedRodBreak` · `driftRiver` · `shopL12&panel=pc`. 1920×1080: 파이팅 HUD · 결과 · PC.

본 것: 텐션 게이지(녹/적 · 로드 아이콘) · 드랙 눈금(라인 · 로드 표식) · 「드랙 풀림」 · 「로드 한계 — 숙여라」 · 「점프 예고 — 펌핑을 멈춰라」 · 「Space 뜰채!」 · 실패 알림(잃은 것 · 예비 로드 · 낮춘 드랙) · 로드 휨 · 찌 · 충전 게이지와 착수 핀 · 결과 패널의 붕어 모델 · 사기 전 → 후 수치. P7 이 본 「`#ui-root`의 큰 흰 해 아이콘」은 이제 없다. 겹침 · 잘림 없음.

## 6. 남은 문제 (openIssues 와 같다)

1. **[major · 밸런스 게이트] 호수 자갈의 완벽 캐스팅이 장애물 띠 안에 떨어진다.** 1단계 바닥 로드 `castMaxM 32` ≥ `lake_gravel.snag.fromM 31`. 실측(기본 봇 · 바닥/떡밥 · 시드 20 × 06–10시): 캐스팅 251 중 완벽 85(**34%**) · 파이팅 200 중 띠 안 시작 68(34%) — 띠 안 라인 끊김 **32%**(22/68) vs 밖 14%(18/132). 입질 대비 끊김 40/208 = **19%**(M4 기준 ≤ 15%). 완벽이 벌이 되는 셈이다. 손잡이: `data/stages/lake.js` `lake_gravel.snag.fromM` 31 → 33 이상(계약 §7.12 M4 · M5 의 조정 손잡이) — 바꾸면 P2 의 FIGHT ±20% 조정 일부를 되돌려도 된다(NOTES-P2 #3).
2. **[major · 밸런스 게이트 · P8] 띠에서 상한 라인의 「긴 헛판」**(NOTES-P2 #4): 조절 봇 spoolEmpty 판 중앙 345초 · p90 428초 — 이길 방법 없는 몇 분짜리 판(QUALITY §2 「대응할 수 없는 손해」 · 한 판 길이). 손잡이: `lake_gravel.snag.rate` 0.12 · `FIGHT.maxAbrasion` 0.9 · HUD 「라인 손상 %」가 이미 있으니 일정 손상 위에서 「끊어 내기(R 베일)」 안내.
3. **[minor · 밸런스 게이트] styles.report 「무게형 변동계수 ≤ 돌진형 × 0.5」**는 🔒 값으로 닿지 않는다(실측 0.687) — 지금은 보고만(계약 §12.2 W1 확정). 지표(2초 창 변동계수 0.648)나 기준을 정할 것.
4. **[minor · 밸런스] 무지성 파손 15.3% · 대형 조절 − 고정 12.9%p**가 하한 근처(P2 미니 측정) — P10 measure 의 시드에서 아래로 갈 수 있다.
5. **[minor · 화면 패스] 자리 표식이 멀리서 약하다**: 고리(폭 0.14m · 불투명 0.5)는 20m 에서 몇 px — 가까워지면(`nearby`) 밝아지지만 스폰에서는 주황 깃발만 보인다(이번에 깃발이 보이게 고쳤다). 손잡이: `src/view/world/markers.js` `RING_HALF_W` · 깃발 크기 · `src/view/WorldLayer.js` `RING_OPACITY`.
6. **[minor · P9/화면 패스] 뜰채로 뜨는 순간이 화면 아래**(NOTES-P6): 물고기가 물가 아래 약 45° — 낚시 pitch −0.15 에서는 들어 올리는 끝만 보인다. landing 동안 카메라를 조금 숙이거나 그대로 둘지. **오른손이 거의 화면 밖**(손잡이 (0.26, −0.30, −0.42)) — 보이게 하려면 (0.24, −0.24, −0.42) 근처. 완전히 세운 로드 끝이 화면 위로 나간다(휨은 중간 마디로 보인다).
7. **[minor] 35m 너머 물고기 그림자는 몇 px** — 먼 파이팅은 로드 휨 · 라인 방향 · HUD 와 P7 물보라가 말한다.

## 7. 다음 웨이브(W2)가 알아야 할 것

**P9 app**
- 키 분담: `ui.handleKey`를 먼저 — 빈 스택의 `Tab`은 ui 가 처리, 빈 스택의 `Escape`는 false(§10.4 순서의 `exitFishing` → `pause`는 app). 전환 막 중 패널이 없으면 ui 가 모든 키를 삼킨다.
- 타이틀 「새 게임」 확인은 ui 가 띄운다 → `actions.newGame()`은 **두 번째 확인 없이** 백업 → `sim.newGame` → 막. pause 의 「계속하기」는 `actions.resume()` 뒤 ui 가 맨 위면 닫는다(app 이 닫아도 안전). `openPanel('pause', {overridden:[…]})`로 쿼리에 덮인 설정 키를 넘기면 「이번 실행만」이 뜬다. `openPanel('title', {hasSave, saveBroken, saveFuture})`.
- 최소 부트가 하지 않던 것: `POINTER_LOCK` 이벤트(ui 의 `prompt.clickToLook` · 드래그 안내가 이것으로 뜬다) · `audio.setPaused`(AudioEngine 은 `PAUSED` · visibilitychange 를 스스로도 본다 — 같이 불러도 같다) · `actions.applySettings`(지금 no-op — pause 설정 탭 값이 바뀌지 않는다) · `SETTINGS_CHANGED{settings}`(WorldLayer 가 이것으로 `rc.setQuality`).
- `src/main.js`의 `window.__game`에 이번에 더한 sim 디버그 위임 8개의 이름 · 동작을 `debugApi`가 그대로 잇는다(§11.7). 최소 부트는 늘 `ignoreGates` 개발 세션이다 — 지도에서 잠긴 스테이지도 「Enter로 출발」로 보이는 것은 그 때문(잠김 표시는 `getTravel().ok false`면 ui 가 그린다).
- 결과 패널 유예 0.25초는 실제 시간(`performance.now`) — app 이 막을 다시 잴 필요 없다.

**P10 bot**
- `createAngler`는 실제 파이팅 위에서 돈다(S1 · integration.test). 어창이 차면 swap/방생 — 하루 계획은 판매 시점을 정해야 한다.
- 집에서는 `getShop()`의 `refill_*_line_1` 가격이 0 · `buy('refill_…')`도 무료 — 계획이 그대로 써도 된다. 가득인 라인의 사유는 `'full'`.
- 6절 #1: lakeDay 의 기본 봇은 완벽 캐스팅의 34%가 띠 안 — M4 끊김이 19%로 나온다. measure 결과에 이것을 따로 보고(띠 안 시작 비율 · 띠 안/밖 끊김).
- `test/integration.test.js`는 headless.test 의 일부와 겹친다 — 흡수하거나 그대로 둔다.
- 스모크 S1 의 한 줄 기준선(시드 11 · 06–10시): 입질 13 · 랜딩 10 · 끊김 3 · 재캐스팅 ≤ 1.8초.

**P11 coast · P12 river**
- 소품 빌더가 받는 `heightAt`은 그 스테이지의 지형 함수(메시와 같다). 0.5m 넘는 소품의 판정은 `src/view/world/placement.js`(P5 내부) — import 하지 말고 베낀다. 빛을 더하지 않는다(빛 개수 고정 — 씬 전환 재컴파일).
- 자리 깃발은 이제 `facing + π/4`로 선다(markers.js) — 스폰에서 보이는지 정지 화면으로 확인.
- 강 꼬리물 흘림 · 갯바위 조류 홈의 경계는 rig 가 지킨다(퍼즈 S4 · S4b 에서 예외 · 땅 위 찌 없음). 판타지 조건은 `biteWeights`의 weather 인자 세 모양을 다 받는다.

**밸런스 게이트 · 화면 패스**: 6절 #1–#7. P2 의 FIGHT 조정 다섯 값은 계약 §7.8 에 W1 확정으로 반영했다(§7.12 산수를 다시 맞출 때 기준).

## 8. 계약 수정 목록 (CONTRACT.md · 「W1 확정」)

§1.3 트리(`view.world.test.js` P5 · `audio.test.js` · `fx.test.js` P7 · `integration.test.js`) · §3.4 `PlayerState [vel]` · §4.2 `RIG_BUSY` 문구(랜딩 중 세트 전환 = pendingSet) · §4.2 `SAVE_REQUEST{day}`(camp · debug 점프) · §5.2 세부 넷(phaseTime · 첫 예신 전 Space · 충전 중 뗌 · syncRig 추가 필드 · fixture 복구) · §5.4.2 weather 인자 · §5.4.3 판타지 둘 이상 · §5.4.5 rollFish(pct) · §5.6 `stats.lost` · 무료 미끼의 세트 미끼 · §6.3 집의 라인 감기(getShop · buy · `full`) · §6.10 AudioEngine 자체 구독 · §6.11 openPanel 인자 · 새 게임 확인 · §7.1 `minSunElev` 주석 00:30 · §7.8 FIGHT 다섯 값(0.36 · 0.64 · 0.48 · 0.3 · 21.6) · §9.2 setQuality 호출자 · §9.7 aimPreview 고리 배율 · §9.8 그림자 읽힘 배율 · §9.12 팬 부호(−sin) · §10.3 `bite` 안내 시점 · §10.4 키 분담 · §11.8 최소 부트 디버그 위임 · §12.2(새 파일 4줄 · biteModel 허용 오차 · createAngler 50판 · styles.report) · 부록 A · B `full`.

## 9. 사람이 확인할 것

- 실시간 재생 · 소리 · 포인터 락 · 실제 키보드는 이 환경에서 보지 못했다(정지 화면만). 로컬: `npm.cmd --prefix jay-fishing run dev` → `?spot=lake_gravel&time=18`(파이팅 손맛 · 텐션 톤 · 클리커) · `?scene=home`(걷기 → 문 → 호수). 조정 손잡이는 NOTES-P5 · P6 · P7 · P8 의 표.
- 자리 깃발 45°가 걸으면서 자연스러운지(`markers.js`의 `flag.rotation.y`).
- W2 전까지 화면은 최소 부트다(타이틀 없음 · 포인터 락 없음 · 가운데 드래그 시선).
