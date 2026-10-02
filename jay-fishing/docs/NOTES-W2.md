# NOTES-W2 — 웨이브 2 통합 게이트

P9 app · P10 bot · P11 coast · P12 river 의 병렬 구현을 W1 완성본 위에서 한데 맞물려 돌렸다. 실제로 돌린 명령과 출력에 근거한다.

## 1. 게이트 결과 (마지막 실행)

| 명령 | 결과 |
|---|---|
| `npm run build` | ✓ built · 오류 0 · JS 청크 1개(1,040 kB · gzip 304 kB) |
| `npm test` | tests 347 · **pass 342 · fail 0** · todo 5(`measure.test`의 `BALANCE_PENDING` — M4 · M5 · M7 · M9 · M10 판정만) · 59.0초 |
| `npm run check:dist` | `DIST ok — /gallery/jay-fishing/ · 요청 3건(200 3) · JS 청크 1개 · 표식까지 1650ms` · `release/boot.png`를 직접 봤다(집 실내 위의 타이틀 「새 게임」) |

시작 상태: `npm run build` 오류 0 · `npm test` 346 · pass 341 · fail 0 · todo 5. 패키지 사이에서 테스트가 깨진 곳은 없었다. 고친 것은 교차 대조와 화면 확인에서 나왔다.

## 2. 고친 것

| 파일 | 무엇을 · 왜 |
|---|---|
| `src/app/Game.js` | `setBot`: 걷기로 시작하면 **지금 씬의 하루 계획**을 쓴다. 갯바위면 `coastDay`, 강이면 `riverDay`, 집 · 호수면 `lakeDay`이고 자리에 서 있으면 `stay`다. 전에는 언제나 `lakeDay`라서 `?scene=coast&level=6&bot=1`의 봇이 집을 거쳐 호수로 떠났다. 헤드리스로 확인했다(그 씬에서 시작 → 낚시 · 판매 → 집 → 수면 → 같은 스테이지로 복귀). 정지 화면으로도 갯바위 · 강에서 봇이 낚는 것을 봤다 |
| `src/app/Game.js` · `src/data/strings.ko.js` | `webglcontextlost`에 알림 `hud.notice.contextLost`를 더했다. 계약 §11.10 「일시정지 + 알림」에서 알림이 빠져 있었다(NOTES-P9 · P8 키 없음) |
| `src/app/screens.js` | `SETTLE_MS` 250 → **100**. 전환 막 out 0.45 + settle + in 0.45 의 최악이 1.15초 → 1.0초가 된다(브리프 §3.1 「전환 1초」 · NOTES-P9) |
| `test/integration.test.js` | 새 테스트 「W2: ?scene=<스테이지>&bot=1 의 계획」. 갯바위 L6 · 강 L12 에서 시작한 하루 계획을 **app 규칙**으로 하루 돌린다. travel · sleep 은 전환 막 뒤에 실행하고, 그동안 decide · step 이 없다. 봇이 낸 이동 명령을 Game 이 거를 일이 없는지(걷기 모드 · `getTravel().ok`), 랜딩 · 판매 · 경험치, 씬 순서 그 씬 → 집 → 그 씬, 날 바뀜 1을 본다. 약 1초 |
| `README.md` | 첫 화면 표에 갯바위 · 강 봇 주소를 넣었다. `?bot` 계획 설명, 전환 막(최대 1.0초), 컨텍스트 상실 알림의 알려진 한계 문면을 고쳤다 |
| `docs/CONTRACT.md` | 6절 |

## 3. 헤드리스 통합 스모크 (임시 스크립트 — 지웠다. 요지는 `integration.test.js`의 새 테스트로 남겼다)

모두 실제 GameSim · rig · fight · progression · 계획 봇(P10)으로 돌렸다. 600틱마다 유한수 · 돈 ≥ 0 · phase 를 검사했다.

| ID | 시나리오 | 결과 |
|---|---|---|
| S1 | 계획 봇 하루 × 4, **app 러너**(이동 · 수면은 40틱 막 뒤 · Game 처럼 `getTravel`로 먼저 거름): lakeDay basic 새 프로필 · coastDay 조절 L6 2단계 · riverDay 조절 L12 3단계 · riverDay basic L10 2단계 | 예외 0 · NaN 0 · 넷 모두 `start:home → travel:<스테이지> → travel:home` · 다음 날 06:00 에 집. 랜딩 46 / 64 / 55 / 27 · 판매 46 / 64 / 55 / 27마리 · 경험치 · 기록 · 레벨 업 이벤트가 난다. 파이팅 중 거리 ↑(질주)와 ↓(릴링)가 모두 나와 양쪽이 서로 영향을 준다. 실패 끝(lineBreak · hookOff · early · spoolEmpty) 뒤에는 `RIG_RESTORED`가 실패 수와 같고, 거른 명령은 0 |
| S1b | `?scene=<씬>&bot=1`의 계획(그 씬 spawn 에서 · 레벨 1 · ignoreGates): coast 8시 · river 8시 · lake 14시 · coast 3시 | 넷 모두 그 씬 → 집 → 그 씬 · 24시간 · 예외 0 · NaN 0(랜딩 47 / 26 / 42 / 48) |
| S2 | 세이브 왕복(`app/storage.js` + 가짜 Storage): 정오 저장 → `loadSave` → 새 GameSim → 같은 봇 1시간 · 결과 대기 중 저장 · 손상 · 미래 버전 · 백업 개수 | 프로필 동일 · 불러온 뒤 낚시를 잇는다 · 결과 대기 물고기가 세이브 어창에 있다(0 → 1) · 손상 → `broken` · 원문 백업 · `SAVE_KEY` 지움 · 미래 → `future` · 백업 3개 유지 |
| S3 | 두 끝 + 보상(디버그로 당김): 참돔 조절 2단계 · 잿방어 99% 무지성 1단계 · 흰철갑상어 조절 3단계 / 기본 1단계 · 치누크 조절 3단계 — 각 8판 | landed 8/8 · lineBreak 8/8 · landed 8/8 · lineBreak 8/8 · landed 7 + hookOff 1. 랜딩 뒤 `XP_GAINED` · `CATCH_KEPT` · `RECORD`가 나오고, 실패 뒤 `FAIL` → `RIG_RESTORED` 가 이어진다 |
| S4 | 무작위 입력 퍼즈: 9자리 × 30,000틱 + 걷기(집 · 갯바위 · 강) × 30,000틱 + 무작위 명령 16종(이동 · 기다리기 · 수면 · 판매 · 일어나기 · keep/release · 수심 · 미끼 · 장착 · 구매 · 감기 · 스킬) | 예외 0 · NaN 0 · 돈 ≥ 0 · phase ∈ RIG_PHASES |
| 헛판 | 긴 지는 판의 길이(자리 봇 자연 입질 · 12시간) | 아래 8절 #1 |

## 4. 교차 대조 (테스트가 못 잡는 것 — 눈으로)

- **app → sim**: Game · debugApi 가 부르는 GameSim 메서드 22개는 전부 있고 시그니처도 맞다. 봇 명령 목록(§6.8)이 Game 의 `BOT_SIM_COMMANDS` + `BOT_ACTION_COMMANDS`와 같다. 봇이 실제로 내는 명령(buy · equip · exitFishing · keepCatch · learnSkill · refillLine · releaseCatch · sellAll · setBait · sleep · travel)도 그 안에 다 있다. `travel` · `sleep`은 `actions`(전환 막)로 간다.
- **ui → app actions**: map · camp · bed · title · pause 가 부르는 9개(`newGame` · `continueGame` · `resume` · `quitToTitle` · `applySettings` · `travel` · `waitNextBand` · `sleep` · `requestPointerLock`)가 모두 Game 에 있다. 반환 `{ok, reason, params}`도 ui 의 알림 규칙과 맞는다. 장소 패널은 자기를 먼저 닫고 action 을 부른다 → `PANEL_CLOSED{by:'confirm'}`가 락을 soft 로 요청하고 → 막이 `isBlocking`을 이어받는다.
- **app 이벤트**: `PAUSED{on}` → ui · audio · `SETTINGS_CHANGED{settings}` → ui(pause 다시 그리기) · audio(`applySettings`) · WorldLayer(`setQuality`) · `POINTER_LOCK{locked, available}` → hud · `SCREEN_CHANGED{from,to}` · `PANEL_OPENED/CLOSED` → app(capture · 락 · PAUSED). 발행자가 넣는 필드와 구독자가 읽는 필드가 같다. `AUDIO_UNLOCKED` · `SCREEN_CHANGED`는 구독자가 없다 — ui 에 「소리 안내」가 없고 HUD 는 스택의 title 로 숨기므로 문제가 없다.
- **봇 ↔ 브라우저**: 봇이 E 를 누르면 `INTERACT`가 나지만 `setAutoPanels(false)`라 패널이 sim 을 막지 않는다. 정지 화면으로 확인했다: `?fresh=1&bot=1` 6000틱에 집 → 문 → 막 → 호수 07:40 파이팅 · `?scene=coast&level=6&bot=1` · `?scene=river&level=12&bot=controlled`(P10 의 「확인하지 못한 것」을 닫았다).
- **소품 ↔ WorldLayer**: `STAGE_PROPS` 의 coast · river 빌더 반환 모양 · `PropsEnv` 필드 · 물 `renderOrder 2`와 소품 수면 연출 `≥ 3`이 맞다. 씬 왕복(home → coast → river → lake × 3)에서 `memory()`의 geometries 283 · textures 21 · programs 60 · listeners 88 이 그대로다. 같은 자리에서 판을 되풀이해도(6600틱) geometries · textures · listeners 가 늘지 않는다.
- **문자열**: app 이 쓰는 키(`fatal.*` · `save.failed` · `title.noStorage` · `title.needInput` · `hud.notice.contextLost` · 이동 사유 `reason.busy/notHere/same/locked/invalid`)가 전부 `strings.ko.js`에 있다. 정지 화면에 키가 그대로 보인 곳은 없다. 순수 계층 금지 토큰 · 한국어 문자열 리터럴은 `purity.test`가 통과한다.

## 5. 브라우저 스모크 (헤드리스 `probe:screen` · 1280×720 · 모두 `SCREEN ok` · `errors()` 0)

- **계약 §12.7 목록 전부**: 타이틀 · 집 PC · 호수 아침 걷기 · 호수 자리 충전(40) / 찌 대기(240) · 파이팅 `forceFight('carp', 0.95)` 120 / 600 · 결과 패널 · 갯바위 19시 비 · 강 깊은 홈 22시(헤드랜턴 · 발광 찌 · 달) · 상점 L12 300만 원(사기 전 → 후).
- **W2 장면**: 갯바위 · 강 걷기 spawn · 갯바위 깊은 곶 정오(등대) · 해 질 녘 high(등대 빛줄기 · 반사) · 강 꼬리물 새벽 흐림 봇 파이팅(질주 예고 HUD) · 강 여울 low · 꼬리물 high(숲 반사) · 갯바위 판매상 · 강 캠프 · 고정 상태 `fightRun` · `failedRodBreak`.
- **실제 키로 ui → app 흐름**(합성 KeyboardEvent):
  - 타이틀 Enter → 새 게임 → 집 play · localStorage 에 세이브(v1 · home).
  - 지도 Enter → 막 → 호수 07:00. 헤드리스에서 2.9초가 걸렸다 — 소프트웨어 렌더라 타이머가 늦다.
  - 캠프 Enter → 08:00 → 11:00(낮).
  - 침대 Enter(21시) → 2일 06:00.
  - 낚시 자리 Esc → 일어나기 · 다음 Esc → 일시정지 · Esc → 닫기 · Tab → 채비.
  - 결과 Space → 어창 1 · 경험치 20.
  - 일시정지 「타이틀로」 → title(이어하기).
  - 설정 탭 화질 → 높음 · `jay-fishing:settings`에 저장되고 화면이 반사로 바뀐다.
- 본 것: HUD(시계 · 날씨 · 돈 · 레벨 · 스킬 배지 · 어창 · 채비 줄) · 파이팅 HUD(텐션 · 드랙 눈금 · 거리 · 라인 잔량 · 질주 예고 · 장애물 · 라인 손상) · 안내 카드 · 실패 알림(잃은 로드 · 낮춘 드랙) · 모든 패널. 겹침 · 잘림 · 키 노출 없음.

## 6. 계약 수정 목록 (CONTRACT.md · 「W2 확정」)

- §1.3 트리: `integration.test.js`에 W2 테스트를 더했다.
- §6.8: planner 의 추가 메서드 · Goal `skill`/`walkTo`는 내지 않는다 · 봇의 GameSim 조회 셋 · 프로필에서 기억을 다시 읽는다.
- §6.11: `requestPointerLock`을 부르는 처리기 `pointerdown` → `mousedown`.
- §7.4.4 강 `look.dam` → `{x:-470, z:-130, width:272, height:58}`(P12).
- §7.10 `data/bot.js`의 `PLAN` export(P10 · 🔒 아님).
- §9.4: 수면 연출 `renderOrder ≥ 3` · 흘림 물길 비우기 · 원경 안개 상한 · 내부 폴더.
- §11.1 · §11.6: `?bot`의 계획은 씬별 하루 계획이다.
- §11.2: `SETTLE_MS` 100 · 전환 최악 1.0초.
- §11.3: 마우스는 `mousedown`/`mouseup` · 키로 연 락 요청은 soft · `InputCollector` 추가 API.
- §11.7: `setBot`이 바탕 패널을 닫는다 · 봇 이동은 막을 거친다 · sim 을 바꾸는 디버그 호출은 개발 세션으로 바꾼다.
- §11.10: `hud.notice.contextLost`.
- §12.1: 상호작용 점 0.1m / 자리 0.3m.
- §12.5: M12 · M16 은 measure 에서만 · `BALANCE_PENDING` · 강제 입질 표본의 한계.
- 부록 B: `hud.notice.contextLost`.

## 7. 다음 단계가 알아야 할 것 (밸런스 게이트 · 화면 패스 · 리뷰)

**밸런스 게이트**
- 먼저 `npm run measure` → NOTES-P10 §2 표다. 목표 밖 다섯(M4 · M5 · M7 · M9 · M10)은 뿌리가 하나다. 호수 자갈 1단계 바닥 `castMaxM 32` ≥ `lake_gravel.snag.fromM 31`이다. 손잡이 순서: `data/stages/lake.js` `snag.fromM` 33 이상 → 다시 잰다 → 남으면 `FIGHT.stick` · `stickTime` · `rodBreakHold` · `rod_bottom_1.maxLoadKg`(NOTES-P10 §3). 고친 목표는 `test/measure.test.js`의 `BALANCE_PENDING`에서 지운다.
- 긴 헛판(8절 #1)은 띠 · 상한 라인 · 스풀 끝의 조합이다. `snag.rate` · `FIGHT.maxAbrasion`과 HUD 「끊어 내기」 안내를 같이 본다.
- 강의 기본 봇 흐름 하중(NOTES-P12 §2-3)과 styles.report 변동계수 0.5배(NOTES-W1 #3)도 남아 있다.

**화면 패스(P5 · P6 · P8 · P11 · P12 손잡이)**
- 8절의 화면 항목: 갯바위 물보라 기둥 · 등대 빛줄기 끝 원반 · 갯바위 spawn 의 고른 검은 평지 · HUD 채비 줄이 두 줄로 넘어감 · 강 새벽 파이팅의 회색 물보라.
- NOTES-W1 #5–#7(자리 표식 · 뜰채 시야 · 먼 그림자)도 그대로 남아 있다.
- 1920×1080 은 이 환경의 probe(1280×720 고정)로 보지 못했다.

**리뷰 · 모든 패키지**
- 계획 봇은 브라우저에서도 같은 정책이다(`?bot=1`). 봇이 패널이 열린 사이 멈추는 것은 사람의 Tab · 일시정지뿐이다.
- 개발 쿼리로 띄운 세션의 지도는 잠긴 스테이지도 「Enter로 출발」로 보인다(ignoreGates — W1 그대로). 실제 세션에서는 잠김이 보인다.
- 디버그 `step(n)`은 ui `dt`를 `min(n × DT, 0.25)`로 한 번만 민다. 정지 화면의 안내 카드 · 알림 수명은 실제보다 길게 남는다(계약 §5.9 그대로 — 결함 아님).

## 8. 남은 문제 (openIssues 와 같다)

1. **[major · 밸런스 게이트] 이길 수 없는 긴 헛판이 강에서도 난다**(NOTES-W1 #2 의 강 판). 자리 봇 자연 입질 12시간, 2단계 조절 기준:
   - 강 깊은 홈 spoolEmpty 2판 — 중앙 344초 · 최대 466초. 같은 조건 랜딩 14판의 중앙은 19초다.
   - 꼬리물 spoolEmpty 2판 — 중앙 167초.

   1단계 찌 채비 L12(`?scene=river&level=12&bot=controlled`)의 정지 화면에서는 물고기가 111m · 라인 손상 90% · 유효 0.4kg · 스풀 8m 남은 채 파이팅이 이어졌다. 진행 봇은 강에 2단계 이상으로 오지만, 사람은 1단계로도 올 수 있다(레벨 10 게이트만 있다). 손잡이는 `snag.rate`(자리별) · `FIGHT.maxAbrasion` · 「끊어 내기(R)」 안내(P8).
2. **[major · 밸런스 게이트] 목표 밖 다섯**(M4 끊김 18.8% · M5 조절 − 무지성 23.9%p · M7 무지성 파손 13.9% · M9 바닥 로드 42.8% · M10 순수입 45.2%) — NOTES-P10 §3. todo 로 돌고 있다.
3. **[minor · 화면 패스 · P11] 갯바위 물보라가 수평선 근처에서 옅은 세로 기둥으로 보인다**(정오 · 아침 · 걷기 spawn 정지 화면 — 바위 사이 3–4곳). 손잡이: `coastProps.js` `surgeMaterial` spray 페이드 · 크기 · 먼 거리 페이드.
4. **[minor · 화면 패스 · P11] 등대 빛줄기 끝이 원반으로 보인다**(19:30 high — 빛줄기 원뿔의 끝 단면이 둥근 판처럼 보이고, 수면 반사의 쐐기가 화면 오른쪽 아래까지 길게 난다). 손잡이: `BEAM_LEN` · 끝 페이드 · 반사 제외(layers).
5. **[minor · P8] 낚시 HUD 의 채비 줄이 찌 채비에서 두 줄로 넘어간다**(「중층 2.0m」가 아래 줄로). 손잡이: `hud.js` 채비 줄 칩 · `style.css` 폭.
6. **[minor · 화면 패스 · P7] 강 새벽 파이팅의 질주 물보라가 회색 연기 덩어리처럼 보인다**(어두운 빛에서 흰 입자가 회색 — 정지 화면 한 장).
7. **[minor · 화면 패스 · P11] 갯바위 spawn 의 걷는 영역이 넓고 고른 검은 평지로 읽힌다**(NOTES-P11 그대로).
8. **[minor] 개발 세션에서 「타이틀로」 → 타이틀에 「이어하기」가 뜬다** — 메모리의 세션으로 돌아간다. 실제 세이브는 쓰지 않는다. 「새 게임」 확인 문면의 「기존 기록은 백업된다」는 개발 세션에서는 백업하지 않는다(문면만 어긋남).

## 9. 사람이 확인할 것

- 실시간 재생 · 소리 · 포인터 락 · 실제 키보드 · 실제 GPU 의 전환 막 길이(≤ 1초) · 1920×1080 은 이 환경에서 보지 못했다(정지 화면만). 로컬: `npm.cmd --prefix jay-fishing run dev`.
  - `/`: 타이틀 → 새 게임 → 문 → 호수 → 한 판 → 결과 → 판매 → 캠프 → 집 → 침대.
  - `?scene=coast&level=6&money=300000`
  - `?spot=river_trench&level=12&money=3000000`
  - `?bot=1`: 봇의 걷기와 E 를 누르는 순간.
- README 「사람이 확인할 것」(락 · Esc 한 번 · 좌+우 클릭 · 소리 · 탭 복귀)과 NOTES-P7 · P11 · P12 의 연출 손잡이(거품 · 물보라 · 등대 · 댐 물보라 · 부표).
