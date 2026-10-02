# Jay Fishing v0.1 — 구현 계약 (CONTRACT)

> `docs/BRIEF.md`가 방향이고, 이 문서가 **이름 · 단위 · 시그니처 · 상태 모양 · 수치**의 정본이다.
> 병렬 작업자는 서로의 파일을 보지 않고 이 문서만으로 맞물린다. 여기 적힌 export 이름 · 필드 이름 · 이벤트 이름 · 문자열 ID · 단위는 **글자 그대로** 쓴다.
> 문서에 없는 것은 소유 패키지의 재량이다. 문서와 구현이 어긋나야 할 사정이 생기면 **자기 파일 안에서만** 해결하고(공개 시그니처 · 상태 필드 · 이벤트 payload는 유지), 사유를 `docs/NOTES-P#.md`에 세 줄 이내로 남긴다.
> 수치의 근거: 설계 단계에서 §5의 파이팅 · 입질 모델과 §12.1의 봇 전략, 하루 · 진행(레벨 · 구매) 흐름을 이 문서의 값 그대로 Node 스크립트로 돌려 측정 목표를 맞췄다(§7.12). 그 표의 값이 출발점이고, 통합 · 밸런스 게이트가 실제 구현의 봇 측정으로 다시 조정한다.

## 목차

- §0 공통 규약 (단위 · 시간 · 좌표 · 각도 · 벡터 · 이름 · 코드 스타일)
- §1 디렉터리 트리 · 파일 소유 · 웨이브
- §2 의존 규칙
- §3 타입 카탈로그
- §4 이벤트 카탈로그
- §5 틱 순서 · 파이팅 모델 · 시간 처리 · 렌더 보간
- §6 모듈별 공개 API (+ 스텁 값)
- §7 데이터 표와 수치 (+ 측정 목표 산수)
- §8 콘텐츠 프레임워크 (어종 · 파이팅 성격 · 스테이지 · 장비 · 스킬)
- §9 view 계약
- §10 ui 계약
- §11 app 계약
- §12 봇과 테스트 계획
- §13 패키지별 완료 정의
- 부록 A 식별자 목록 · 부록 B 문자열 키 시드

---

## §0 공통 규약

### 0.1 단위

| 항목 | 규약 |
|---|---|
| 실제 시간 | **초(s)**. 데이터 표 · 상태 · payload 어디에도 "프레임" 단위는 없다. |
| 고정 틱 | `DT = 1/60`초. `GameSim.step(input)`은 항상 한 틱(DT)을 민다. |
| 게임 시간 | **정본은 틱**이다. `clock.day`(1부터) + `clock.tickInDay`(0 … `TICKS_PER_DAY−1`). 실제 1초 = 60틱 = 게임 24초. 게임 1시간 = 실제 150초 = 9,000틱. 게임 1분 = 150틱. 게임 하루 = 실제 3,600초 = 216,000틱. `hour`(0 ≤ h < 24 실수)는 파생 값이다. |
| 길이 | 미터(m). 물고기 길이만 **cm**(필드 이름에 `Cm`). |
| 질량 · 힘 | 물고기 무게 **kg**(필드 이름에 `Kg`). 텐션 · 드랙 · 라인 강도 · 로드 하중도 **kg**(= kgf, 필드 이름에 `Kg` 또는 `tension`). |
| 속도 | m/s · 각속도 rad/s |
| 각도 | **라디안**. 데이터 표도 라디안. |
| 비율 · 확률 | 0..1 실수(퍼센트 아님). 퍼센타일 `pct`도 0..1. |
| 돈 | 원, **정수**. 모든 가격 계산의 끝에서 `Math.round`. 음수가 되지 않는다(차감은 `max(0, …)`). |
| 경험치 | 정수. |

### 0.2 좌표와 각도 (가장 중요 — 모든 패키지가 같은 식을 쓴다)

- three.js 기본 그대로 **오른손 좌표계 · Y-up**. 걷는 땅과 물은 **XZ 평면**, 수면은 `y = 0`. sim은 높이를 모른다(지형 높이는 view의 `WorldLayer.heightAt`). sim이 다루는 높이 성분은 물고기 수심 `depth`(수면 아래 m, 양수) 하나다.
- **yaw(수평 방향) θ의 앞 벡터 = `(x, z) = (−sin θ, −cos θ)`** — three.js 카메라의 `rotation.y = θ`와 같은 규약이다.
  - θ = 0 → **−Z**를 본다. θ = +π/2 → **−X**를 본다(왼쪽으로 돈다). θ가 커지면 위에서 보아 반시계(좌회전).
  - 두 점 사이 yaw: `yawOf(dx, dz) = Math.atan2(−dx, −dz)` (`core/math.js`).
  - **마우스를 오른쪽으로 움직이면 yaw가 감소한다.**
  - 오른쪽 벡터 = `(cos θ, −sin θ)`.
- **pitch**: 양수 = 위를 본다. `[−1.40, 1.40]`으로 자른다. 카메라는 `rotation.order = 'YXZ'`, `rotation.y = yaw`, `rotation.x = pitch`.
- **모든 모델은 −Z가 앞**(물고기 머리 · NPC 얼굴 · 텐트 입구)으로 만든다. 배치는 `object.rotation.y = yaw` 그대로.
- **월드 배치 규약**: 모든 야외 스테이지에서 **물은 해안선의 −Z 쪽**, 땅은 +Z 쪽이다. 낚시 자리는 해안선 바로 뒤(땅 쪽)에 있고 대체로 yaw ≈ 0(−Z, 물 쪽)을 본다. 강의 흐름은 **+X 방향**(하류)이다.
- 낚시 자리의 거리 `dist`는 **설 자리(`spot.stand`)에서 찌/봉돌/물고기까지의 수평 거리**(m)다. 방향은 `bearing`(yaw 규약). 위치 = `stand + (−sin bearing, −cos bearing) × dist`.

### 0.3 벡터

- sim의 2D 벡터는 **`{x, z}` 순수 객체**(`Vec2`) 하나로 통일한다. 배열 · three `Vector2/3`를 sim 상태에 넣지 않는다.
- 위치 필드는 `pos`, 직전 틱 값은 `prevPos`(렌더 보간용).
- 데이터 표의 점 · 다각형도 `{x, z}`. 수심 프로필만 `[[distM, depthM], …]` 쌍 배열(거리 오름차순).

### 0.4 이름 규칙

| 대상 | 규칙 | 예 |
|---|---|---|
| 파일 | 클래스 파일 `PascalCase.js`, 나머지 `camelCase.js`. import 경로는 디스크와 **대소문자까지** 같게 | `GameSim.js` · `biteModel.js` |
| 씬 · 스테이지 ID | 소문자 한 단어 | `home` `lake` `coast` `river` |
| 낚시 자리 ID | `<stage>_<name>` | `lake_gravel` |
| 어종 · 스킬 ID | camelCase | `largemouthBass` · `dragSense` |
| 장비 ID | `<slot>[_<set>]_<tier>` 또는 크기 | `rod_float_2` · `reel_3` · `line_1` · `hook_m` · `float_2` · `sinker_3` |
| 미끼 ID | 영어 소문자 한 단어 | `worm` `paste` `corn` `shrimp` `krill` `live` |
| 이벤트 이름 | `EV.UPPER_SNAKE` 상수 → 값 `'domain/verb'` | `EV.BITE_TAKE = 'bite/take'` |
| 문자열 키 | 점 경로 | `species.crucian` · `hud.tension` |
| 데이터 상수 | UPPER_SNAKE 객체 | `FIGHT` · `BITE` · `GEAR` |

### 0.5 코드 스타일

- ES 모듈, **named export만**(default export 금지).
- sim 상태는 **순수 객체**(클래스 인스턴스 · Map · Set · 함수 참조 금지 — `structuredClone` · `JSON.stringify` 가능해야 한다). 난수 상태도 상태 안의 `{s}` 숫자 하나다(§6.1 `core/rng.js`).
- **sim · bot의 수치는 `src/data/`에만 둔다.** 로직 파일의 숫자 리터럴은 0 · 1 · 2 · 0.5 · π 같은 수학 상수뿐이다. 이 문서 본문이 규칙에 숫자를 적었어도 그 값은 데이터 표에 이름이 있다. view · ui · audio의 연출 상수(색 · 입자 수 · 이징 길이 · 소리 주파수)는 그 파일 상단 `const`에 모은다.
- 모듈 최상위(import 시점)에서 `window` · `document` · `AudioContext` · `localStorage`를 건드리지 않는다 — 생성자/함수 안에서만(Node 테스트가 import한다).
- 타입은 `src/types.js`의 JSDoc을 `/** @typedef {import('../types.js').RigState} RigState */`로 끌어 쓴다(상대 경로는 파일 위치에 맞춘다).
- **과설계 금지**: ECS · DI 컨테이너 · 상태 관리 라이브러리 · 범용 FSM 프레임워크를 만들지 않는다. `switch (phase)` + 데이터 표.
- 명령 메서드의 결과는 `{ok: true, …}` 또는 `{ok: false, reason: string, params?: Record<string, number|string>}`(`reason`은 부록 B의 `reason.*` 키 꼬리 · `params`는 그 문면의 치환 값 — `locked` · `level`은 `params.n` = 필요 레벨, `mastery`는 `params.n` = 필요 숙련 단계). ui는 `t('reason.' + reason, params)` 하나로 보인다.

---

## §1 디렉터리 트리 · 파일 소유 · 웨이브

### 1.1 규칙

1. **한 파일 = 한 소유 패키지.** 웨이브 0(P0)이 **모든 파일을 먼저 만든다**(스텁 · 시드 · 완성). 그 뒤로는 표의 소유 패키지만 그 파일을 고친다.
2. **스텁**은 이 문서의 시그니처 그대로 export 하고 **import할 때도 호출할 때도 던지지 않는다** — §6.14의 중립 값을 돌려준다. 스텁 상태에서 `npm run build` · `npm test` · `npm run check:dist`가 통과한다.
3. 패키지는 **자기 소유 폴더 안에** 내부 파일을 더 만들 수 있다(다른 패키지가 import하지 않는 파일). 폴더 소유는 표 아래.
4. **「시드」** 데이터 파일은 P0이 이 문서의 값으로 **완성해서** 만든다(다른 패키지가 웨이브 1에서 읽는다). 이후 값 조정은 소유 패키지만, §7.0의 규칙 안에서.
5. **「완성」** 파일(`core/` 전부 · 레지스트리 `index.js` 셋 · `derive.js` · `bootMarker.js` · `debug/fixtures.js` · `test/helpers.js` · P0 테스트)은 P0이 웨이브 0에서 끝낸다. 웨이브 1부터는 아무도 고치지 않는다(결함은 `NOTES-P#`에 적고 통합 게이트에서 고친다).
6. **W1의 화면 패키지(P5 · P6 · P7 · P8)는 W0의 최소 부트로 자기 화면을 본다**: 최소 부트(§11.8)가 모든 레이어를 계약 deps 그대로 만들어 돌리고, `?fixture=<이름>`(§11.6 · `debug/fixtures.js`)이 파이팅 · 결과 · 상점 같은 상태를 sim 없이 세운다. sim이 스텁이어도 화면 확인이 W1 안에서 된다.

### 1.2 웨이브

| 웨이브 | 패키지 | 진행 | 게이트 |
|---|---|---|---|
| W0 | P0 scaffold | 한 명 | `npm run build` · `npm test` · `npm run check:dist` |
| W1 | P1 rig · P2 fight · P3 world · P4 progression · P5 view-world · P6 view-tackle · P7 fx-audio · P8 ui | 8명 병렬 — 서로의 작업 중 파일을 보지 않는다. 화면 패키지는 최소 부트 + `?fixture`로 자기 화면을 본다(§1.1-6) | 자기 테스트 파일 통과 + 자기 파일이 원인인 빌드 오류 0 → 통합 게이트(전체) |
| W2 | P9 app · P10 bot · P11 coast · P12 river | 4명 병렬 — W1 완성본 위에서. P11 · P12의 봇 테스트는 W1의 `bot/angler.js`(P1) · `bot/policy.js`(P2)를 쓴다(P10을 기다리지 않는다) | 자기 테스트 → 통합 게이트 → 밸런스 게이트(§12.6) → 화면 패스 |

### 1.3 트리와 소유

```
jay-fishing/
├─ package.json                         P0   (템플릿 · name "jay-fishing" · 의존성 vite · three)
├─ vite.config.js                       P0   (port 5300)
├─ index.html                           P0   (#game-canvas · #ui-root · favicon data: · <noscript>)
├─ .gitignore                           P0
├─ README.md                            P9   (W0: P0 임시본)
├─ scripts/                             P0   (템플릿 다섯 파일 — 고치지 않는다)
│  ├─ check-dist.mjs · boot-probe.mjs · screen-probe.mjs · make-standalone.mjs · check-standalone.mjs
│  └─ measure.mjs                       P10  (npm run measure — 긴 봇 측정 표. W0: P0 스텁)
├─ docs/
│  ├─ BRIEF.md · CONTRACT.md            (고정)
│  └─ NOTES-P#.md                       각 패키지(선택)
├─ src/
│  ├─ main.js                           P9   (W0: P0의 「최소 부트」 — §11.8. W2에서 P9가 교체)
│  ├─ types.js                          P0   완성 — §3의 typedef 전부(`export {}`)
│  ├─ core/                                  전부 P0 완성
│  │  ├─ constants.js · events.js · rng.js · math.js · stats.js · inputFrame.js · hash.js
│  ├─ data/
│  │  ├─ keybinds.js                    P9   (P0 시드 — §11.3)
│  │  ├─ settings.js                    P5   (P0 시드 — DEFAULT_SETTINGS · QUALITY)
│  │  ├─ strings.ko.js                  P8   (P0 시드 — 부록 B의 키 전부)
│  │  ├─ time.js                        P3   (시드) TIME · BANDS
│  │  ├─ weather.js                     P3   (시드) WEATHER
│  │  ├─ world.js                       P3   (시드) WORLD
│  │  ├─ bite.js                        P1   (시드) BITE · LAYER · CAST · SIGNAL · RIG
│  │  ├─ fight.js                       P2   (시드) FIGHT · HOOK
│  │  ├─ fightStyles.js                 P2   (시드) STYLES · TRAITS
│  │  ├─ baits.js                       P4   (시드) BAITS
│  │  ├─ gear.js                        P4   (시드) GEAR · GEAR_BY_ID · GEAR_GATES
│  │  ├─ skills.js                      P4   (시드) SKILLS
│  │  ├─ economy.js                     P4   (시드) START · XP · PRICE · HOLD · FREE_BAIT
│  │  ├─ bot.js                         P10  (시드) BOT
│  │  ├─ species/
│  │  │  ├─ index.js                    P0   완성 — SPECIES · SPECIES_BY_ID · getSpecies · speciesOfStage
│  │  │  ├─ derive.js                   P0   완성 — deriveSpecies
│  │  │  ├─ lake.js                     P2   (시드) LAKE_SPECIES — 12행
│  │  │  ├─ coast.js                    P11  (시드) COAST_SPECIES — 12행
│  │  │  └─ river.js                    P12  (시드) RIVER_SPECIES — 12행
│  │  └─ stages/
│  │     ├─ index.js                    P0   완성 — STAGES · getStage · getSpot · SPOTS_BY_ID
│  │     ├─ home.js                     P3   (시드)
│  │     ├─ lake.js                     P3   (시드)
│  │     ├─ coast.js                    P11  (시드)
│  │     └─ river.js                    P12  (시드)
│  ├─ sim/
│  │  ├─ GameSim.js                     P3   틱 순서의 주인 · 명령 · 플러시
│  │  ├─ clock.js                       P3
│  │  ├─ weather.js                     P3
│  │  ├─ world.js                       P3   걷기 · 상호작용 · 배치
│  │  ├─ fishing/
│  │  │  ├─ rig.js                      P1   채비 단계 기계(캐스팅 · 흘림 · 입질 신호 · 챔질 · 회수 · 랜딩 · 실패 복구)
│  │  │  ├─ biteModel.js                P1   입질 가중치 · 대기 · 어종 뽑기 · 층
│  │  │  └─ catch.js                    P1   크기 뽑기 · 퍼센타일 · 등급
│  │  ├─ fight/
│  │  │  ├─ fight.js                    P2   텐션 · 드랙 · 체력 · 실패 판정 · 뜰채 가능
│  │  │  └─ fishBrain.js                P2   성격 + 특성 → 행동 상태 기계
│  │  └─ progression/
│  │     ├─ profile.js                  P4
│  │     ├─ modifiers.js                P4   스킬 · 장비 → RigStats
│  │     ├─ economy.js                  P4   가격 · 판매 · 구매 · 라인 감기 · 손실 · 장착
│  │     ├─ progress.js                 P4   경험치 · 레벨 · 스킬 · 도감 · 어창 · 판정 결과 적용
│  │     └─ save.js                     P4   세이브 직렬화 · 검증 · 이주 · 설정 정리
│  ├─ bot/
│  │  ├─ policy.js                      P2   파이팅 정책(전략 넷 — §12.1) · W1에 완성
│  │  ├─ angler.js                      P1   자리 봇(캐스팅 · 챔질 · 파이팅 · 뜰채 · 어창/방생) · W1에 완성
│  │  ├─ bot.js                         P10  angler + 걷기 · 하루 계획
│  │  └─ planner.js                     P10  하루 계획(이동 · 판매 · 구매 · 스킬)
│  ├─ debug/
│  │  └─ fixtures.js                    P0   완성 — 화면 확인용 고정 상태(§11.6 `?fixture`)
│  ├─ view/
│  │  ├─ renderer.js                    P5
│  │  ├─ CameraRig.js                   P5
│  │  ├─ WorldLayer.js                  P5   하늘 · 해/달 · 조명 · 안개 · 지형 · 물 · 비 · NPC · 캠프 · 자리 표식 · 집 실내 셸
│  │  ├─ world/                         P5   (내부 파일 폴더 — sky · water · terrain · npc · camp …)
│  │  ├─ stages/
│  │  │  ├─ index.js                    P0   완성 — STAGE_PROPS
│  │  │  ├─ homeProps.js                P5
│  │  │  ├─ lakeProps.js                P5
│  │  │  ├─ coastProps.js               P11
│  │  │  └─ riverProps.js               P12
│  │  ├─ tackle/
│  │  │  └─ TackleLayer.js              P6   1인칭 로드 · 손 · 릴 · 라인 · 찌 · 봉돌 · 뜰채 (폴더 P6)
│  │  ├─ fish/
│  │  │  ├─ fishModel.js                P6   체형 템플릿 5종 → 메시
│  │  │  ├─ FishLayer.js                P6   물고기 그림자 · 점프 · 뜰채 속 물고기
│  │  │  └─ FishPreview.js              P6   UI용 회전 모델 렌더러 (폴더 P6)
│  │  └─ fx/
│  │     └─ FxLayer.js                  P7   (폴더 P7)
│  ├─ audio/
│  │  └─ AudioEngine.js                 P7   (폴더 P7)
│  ├─ ui/                               P8   (폴더 P8)
│  │  ├─ UIRoot.js · hud.js · i18n.js · style.css
│  │  └─ panels/ title.js · pause.js · tackle.js · result.js · sell.js · pc.js · camp.js · map.js · bed.js · confirm.js
│  └─ app/
│     ├─ bootMarker.js                  P0   완성 — markReady · markError (진입점을 다시 써도 남는다)
│     ├─ Game.js · loop.js · screens.js · input.js · storage.js · debugApi.js · query.js    P9
└─ test/
   ├─ helpers.js                        P0   완성 — §6.13
   ├─ core.test.js                      P0   완성
   ├─ purity.test.js                    P0   완성 — 순수 계층 금지 토큰 · import 대소문자 · 부팅 표식 사용
   ├─ data.schema.test.js               P0   완성 — 모든 데이터 행의 스키마 · 참조 · 완결성(§12.2)
   ├─ fixtures.test.js                  P0   완성 — 고정 상태 전부가 §3.4 모양 · 유한수
   ├─ catch.test.js                     P1
   ├─ biteModel.test.js                 P1
   ├─ rig.test.js                       P1
   ├─ fight.test.js                     P2
   ├─ fishBrain.test.js                 P2
   ├─ styles.report.test.js             P2   성격 6종 텐션 시계열 기술 통계
   ├─ clock.test.js                     P3
   ├─ world.test.js                     P3
   ├─ gameSim.test.js                   P3
   ├─ progression.test.js               P4
   ├─ economy.test.js                   P4
   ├─ save.test.js                      P4
   ├─ fishModel.test.js                 P6   (Node에서 three 지오메트리만 — 렌더러 없음)
   ├─ ui.strings.test.js                P8   쓰인 문자열 키가 전부 있다
   ├─ app.query.test.js                 P9
   ├─ app.input.test.js                 P9
   ├─ bot.test.js                       P10
   ├─ headless.test.js                  P10  봇 1 게임 일 완주 · 예외 · NaN · 결정성 · 돈
   ├─ measure.test.js                   P10  측정 목표(§7.12 · §12.5)
   ├─ stage.coast.test.js               P11
   └─ stage.river.test.js               P12
```

폴더 소유: `src/view/world/` P5 · `src/view/tackle/` · `src/view/fish/` P6 · `src/view/fx/` · `src/audio/` P7 · `src/ui/` P8 · `src/bot/` P10(`policy.js` P2 · `angler.js` P1을 뺀 나머지) · `src/debug/` P0. `src/app/`는 `bootMarker.js`(P0)를 뺀 전부 P9. 패키지가 자기 폴더에 내부 파일을 더 만들어도 되고, P11 · P12는 내부 파일이 필요하면 `src/view/stages/coast/` · `river/` 폴더를 새로 만들어 쓴다(소유 P11 · P12).

### 1.4 패키지 한눈에

| ID | 이름 | 웨이브 | 화면 | 한 줄 |
|---|---|---|---|---|
| P0 | scaffold | 0 | — | 설정 · core · 타입 · 스텁 · 시드 데이터 · 테스트 하네스 · 고정 상태(fixtures) · 모든 레이어를 띄우는 최소 부트 |
| P1 | sim-rig | 1 | — | 캐스팅 · 흘림 · 수심/층 · 입질 모델 · 입질 신호 · 챔질 · 회수 · 랜딩 · 실패 복구 흐름 · 크기 뽑기 · 자리 봇(`angler.js`) |
| P2 | sim-fight | 1 | — | 텐션 · 드랙 · 펌핑 · 체력 · 행동 상태 기계(성격 6 + 특성) · 실패 판정 · 호수 어종 데이터 · 파이팅 정책(`policy.js`) |
| P3 | sim-world | 1 | — | GameSim(틱 순서) · 시계 · 날씨 · 걷기 · 상호작용 · 이동 · 시간 건너뛰기 · 집/호수 스테이지 데이터 |
| P4 | progression | 1 | — | 프로필 · RigStats · 가격 · 판매 · 구매 · 장착 · 손실 · 경험치 · 레벨 · 스킬 · 도감 · 어창 · 세이브 |
| P5 | view-world | 1 | ● | 렌더러 · 1인칭 카메라 · 하늘/해/물/지형/비 · NPC · 캠프 · 집 실내 · 호수 소품 · 화질 단계 |
| P6 | view-tackle | 1 | ● | 1인칭 로드 · 릴 · 라인 · 찌 · 뜰채 · 로드 휨 · 물고기 그림자 · 물고기 모델(템플릿 5) · 미리보기 |
| P7 | fx-audio | 1 | ● | 물보라 · 파문 · 점프 · 합성 소리 전부(텐션 톤 · 드랙 클리커 · 환경음) |
| P8 | ui | 1 | ● | HUD · 모든 패널 · 키보드 조작 · 안내 문구 · 알림 · 배너 · 문자열 |
| P9 | app | 2 | ● | 부트 · 루프 · 화면 상태 기계 · 입력 · 저장 · 디버그 API · 쿼리 · README |
| P10 | bot | 2 | — | 봇(angler + 걷기 · 하루 계획) · 헤드리스 완주 · 측정 목표 테스트 · `npm run measure` |
| P11 | coast | 2 | ● | 갯바위 스테이지 데이터 · 어종 12 · 소품(암반 · 파도 · 어판장 트럭) |
| P12 | river | 2 | ● | 강 스테이지 데이터 · 어종 12 · 소품(강 · 댐 · 도크) |

---

## §2 의존 규칙

### 2.1 import 허용 표 (행 → 열을 import 해도 되는가)

| from \ to | core | data | sim | bot | three | view | audio | ui | app |
|---|---|---|---|---|---|---|---|---|---|
| **core** | ○ | ✕ | ✕ | ✕ | ✕ | ✕ | ✕ | ✕ | ✕ |
| **data** | ○ | ○ | ✕ | ✕ | ✕ | ✕ | ✕ | ✕ | ✕ |
| **sim** | ○ | ○ | ○ | ✕ | ✕ | ✕ | ✕ | ✕ | ✕ |
| **bot** | ○ | ○ | ○(읽기 함수만 — §6.8) | ○ | ✕ | ✕ | ✕ | ✕ | ✕ |
| **debug** | ○ | ○ | ○(상태를 만드는 순수 함수만 — `createNewProfile` · `createRigState` · `deriveClock` · `fightConstants` · `rigStats` · `computeModifiers`) | ✕ | ✕ | ✕ | ✕ | ✕ | ✕ |
| **view** | ○ | ○ | 순수 조회 함수만(`clock.js`의 `hourOf` 등 · `progression/modifiers.js`의 `rigStats`) | ✕ | ○ | ○ | ✕ | ✕ | ✕ |
| **audio** | ○ | ○ | 순수 조회 함수만 | ✕ | ✕ | ✕ | ○ | ✕ | ✕ |
| **ui** | ○ | ○ | 순수 조회 함수만 | ✕ | ✕ | `view/fish/FishPreview.js` 타입만(인스턴스는 app이 넘긴다) | ✕ | ○ | ✕ |
| **app** | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ |

- `debug/fixtures.js`는 app(`main.js` · `app/*`)만 import한다.
- **순수 계층**(`core` · `data` · `sim` · `bot` · `debug`)은 `three` · DOM(`window` · `document`) · WebAudio · `localStorage` · 시계(`Date.now` · `performance.now` · `setTimeout` · `requestAnimationFrame`) · `Math.random`을 쓰지 않는다. Node에서 그대로 돈다. `test/purity.test.js`가 소스를 훑어 막는다.
- view · audio · ui는 sim **상태를 읽기만** 하고 이벤트를 구독한다. 상태를 바꾸는 것은 `GameSim`의 명령 메서드뿐이다(ui가 호출).
- 시드 `seed`와 저장 시각 `savedAt`은 app이 만든다(`Date.now` · `Math.random`은 app에서만).

### 2.2 순환 금지 지점

- `sim/fishing/rig.js` → `sim/fight/fight.js` 단방향(파이팅은 rig를 import하지 않는다 — 결과 값을 돌려줄 뿐).
- `sim/progression/*`는 `sim/fishing/*` · `sim/fight/*` · `GameSim.js`를 import하지 않는다(rig · GameSim이 progression을 부른다).
- `GameSim.js` → `world.js` · `clock.js` · `weather.js` · `fishing/rig.js` · `progression/*` 단방향.
- `sim/fishing/rig.js` → `sim/world.js`(`placePlayer`만) 단방향. `world.js`는 `fishing/*`을 import하지 않는다 — 걷기 중 자리 진입은 `updateWalk`가 돌려주고 `GameSim.step`이 `enterSpot`을 부른다(§5.1).
- `bot/bot.js` → `bot/angler.js` → `bot/policy.js` 단방향. `policy.js`는 다른 bot 파일을 import하지 않는다.
- `data/species/index.js` → `lake.js` · `coast.js` · `river.js` · `derive.js` → `data/economy.js` · `core/stats.js`. 어종 행 파일은 서로를 import하지 않는다.
- `data/stages/index.js` → 각 스테이지 파일. 스테이지 파일은 어종 파일을 import하지 않는다(풀은 ID 문자열로 적는다).
- `view/stages/index.js` → 각 `*Props.js`. 소품 파일은 `WorldLayer.js`를 import하지 않는다(필요한 것은 인자로 받는다 — §9.4).

---

## §3 타입 카탈로그

`src/types.js`(P0 완성)에 아래 typedef를 **그대로** 옮긴다. 필드 주석의 단위 · 범위가 계약이다. view가 그려야 하는 것은 전부 상태에 있다 — view · ui가 sim 내부를 재계산하지 않는다.

### 3.1 기초 ID · 열거

```js
/** @typedef {{x:number, z:number}} Vec2 */
/** @typedef {'home'|'lake'|'coast'|'river'} SceneId */
/** @typedef {'lake'|'coast'|'river'} StageId              낚시가 되는 스테이지 */
/** @typedef {string} SpotId                                'lake_gravel' 등 — 부록 A */
/** @typedef {string} SpeciesId                             'crucian' 등 36종 — 부록 A */
/** @typedef {string} GearId                                'rod_float_2' 등 — §7.6 */
/** @typedef {'worm'|'paste'|'corn'|'shrimp'|'krill'|'live'} BaitId */
/** @typedef {'casting'|'hookset'|'dragSense'|'lineCare'|'pumping'|'knowledge'|'baitCraft'|'netting'|'haggling'|'mastery'} SkillId */
/** @typedef {'dawn'|'morning'|'day'|'evening'|'night'} BandId      새벽 04–07 · 아침 07–11 · 낮 11–17 · 저녁 17–20 · 밤 20–04 */
/** @typedef {'clear'|'cloudy'|'rain'} WeatherId */
/** @typedef {'surface'|'mid'|'bottom'} LayerId                     표층 · 중층 · 바닥 */
/** @typedef {'float'|'bottom'} SetId                               찌 채비 · 바닥 채비 */
/** @typedef {'rod'|'reel'|'line'|'hook'|'float'|'sinker'} GearSlot  float 슬롯은 찌 세트만, sinker 슬롯은 바닥 세트만 */
/** @typedef {'normal'|'trophy'|'legend'} Tier                      퍼센타일 <0.90 · ≥0.90 · ≥0.99 */
/** @typedef {'lineBreak'|'spoolEmpty'|'rodBreak'|'hookOff'|'early'|'late'} FailReason
 *  early = 헛챔질(본신 전 챔질) · late = 챔질 창을 놓쳐 미끼만 뺏김 */
/** @typedef {'idle'|'ready'|'charging'|'casting'|'waiting'|'retrieving'|'bite'|'fighting'|'landing'|'result'|'failed'} RigPhase */
/** @typedef {'run'|'rest'|'turn'|'jump'|'dive'|'shake'|'hold'|'charge'} BehaviorKind
 *  run 질주 · rest 휴식 · turn 방향 전환 · jump 점프 · dive 잠수(바닥/바위로) · shake 머리 흔들기/비틀기 · hold 버팀(꾸준한 당김) · charge 이쪽으로 돌진(슬랙을 만든다) */
/** @typedef {'heavy'|'runner'|'thrasher'|'jumper'|'diver'|'small'} StyleId   重 · 走 · 暴 · 跳 · 潛 · 小 */
/** @typedef {'fusiform'|'compressed'|'eel'|'shark'|'benthic'} BodyTemplate  방추형 · 측편형 · 장형 · 상어형 · 저서형 */
/** @typedef {'spot'|'npc'|'camp'|'pc'|'bed'|'door'} InteractKind */
/** @typedef {'title'|'pause'|'tackle'|'result'|'sell'|'pc'|'camp'|'map'|'bed'|'confirm'} PanelId */
/** @typedef {'start'|'stage'|'controls'|'cast'|'bite'|'fight'|'net'|'drift'|'bottomRig'|'holdFull'} HintId   §10.3 안내 문구 */
/** @typedef {'slack'|'jump'|'shake'|'active'|null} LossCause   바늘 빠짐의 원인(그 밖의 실패는 null) — 실패 알림이 한 줄로 보인다 */
```

### 3.2 입력 — `InputFrame`

app(사람)과 봇이 **같은 모양**을 매 틱 하나 만든다. 에지 필드는 그 틱에만 참이다. UI가 처리한 키 · 패널이 열린 동안의 키는 여기 들어오지 않는다(§11.3).

```js
/** @typedef {Object} InputFrame
 * @property {number} moveX          −1..1  오른쪽 +(KeyD) · 왼쪽 −(KeyA)
 * @property {number} moveZ          −1..1  앞 +(KeyW) · 뒤 −(KeyS)
 * @property {number} yaw            rad    보는 수평 방향(절대값 — app이 마우스로 관리). sim은 그대로 복사한다
 * @property {number} pitch          rad    [−1.40, 1.40]
 * @property {boolean} primary       좌클릭 눌림(캐스팅 충전 · 릴링 · 회수)
 * @property {boolean} primaryPressed   이번 틱에 눌렀다
 * @property {boolean} primaryReleased  이번 틱에 뗐다
 * @property {boolean} secondary     우클릭 눌림(펌핑 — 로드 세우기)
 * @property {boolean} hook          Space 에지(챔질 · 뜰채)
 * @property {boolean} interact      KeyE 에지
 * @property {number} dragSteps      정수. 이번 틱 드랙 눈금 변화 합(+ 조이기 = 휠↑ · KeyZ / − 풀기 = 휠↓ · KeyC)
 * @property {boolean} bail          KeyR 에지(베일 열기/닫기 토글)
 * @property {number} depthSteps     정수. 찌 수심 눈금 변화(+ 깊게 = ArrowUp / − 얕게 = ArrowDown)
 * @property {SetId|null} selectSet  Digit1 → 'float' · Digit2 → 'bottom' (에지)
 */
```

`core/inputFrame.js`의 `NEUTRAL_INPUT`은 위 필드가 전부 0 · false · null이고 `yaw = 0 · pitch = 0`인 동결 객체다. sim은 `yaw` · `pitch`가 유한수가 아니면 직전 값을 유지한다.

### 3.3 데이터 정의

```js
/** @typedef {Object} SpeciesRow      data/species/<stage>.js 의 한 행(§7.3) — 사람이 쓰는 값만
 * @property {SpeciesId} id
 * @property {StageId} stage
 * @property {LayerId[]} layers                서식층(1~2개)
 * @property {string} time                     5글자 — 새벽·아침·낮·저녁·밤 순서의 활동 계수 '0'|'L'|'N'|'H'
 * @property {'float'|'bottom'|'both'} method  주로 잡히는 방식(도감 표시 · 봇 계획 — 입질 규칙은 층으로만 갈린다)
 * @property {BaitId[]} baits                  선호 미끼(선호 순 1~3개)
 * @property {StyleId} style
 * @property {string[]} traits                 TRAITS의 키(0~2개)
 * @property {[number, number]} lenCm          5 퍼센타일 · 99.9 퍼센타일 길이(cm)
 * @property {[number, number]} kg             같은 두 점의 무게(kg)
 * @property {1|2|3} mouth                     입 크기(소·중·대) — 바늘 적합도
 * @property {{force?:number, speed?:number, stamina?:number}} [fight]   성격 기본값에 곱하는 배율(없으면 1)
 * @property {{nibbles?:[number,number], take?:'sink'|'lift'}} [bite]    예신 횟수 범위(기본 [1,3]) · 본신 모양(기본 'sink' — 찌가 잠긴다 / 'lift' — 찌가 솟는다)
 * @property {number} pricePerKg               원/kg
 * @property {number} trophyBonus              트로피 배율 = 2 + trophyBonus
 * @property {number} xp                       경험치 계수
 * @property {{bands:BandId[], weather:WeatherId[]}|null} fantasy   판타지 어종의 출현 조건(아니면 null)
 * @property {SpeciesLook} look
 */

/** @typedef {Object} SpeciesLook      fishModel(P6)이 읽는다(§9.6)
 * @property {BodyTemplate} body
 * @property {number} depth            몸 높이 / 몸길이 (0.08..0.55)
 * @property {[string,string,string,string]} colors   등 · 옆 · 배 · 지느러미 '#rrggbb'
 * @property {'none'|'bars'|'spots'|'stripe'|'mottled'|'scales'|'mirror'|'scutes'|'gold'|'zombie'|'ghost'} pattern
 * @property {string|null} patternColor
 * @property {number} [barbels]        수염 개수(0 기본)
 * @property {string|null} [glow]      판타지 어종의 발광색(아니면 없음)
 * @property {string|null} [accent]    작은 강조색(컷스로트의 목 줄 등)
 */

/** @typedef {SpeciesRow & SpeciesDerived} SpeciesDef   data/species/index.js 가 내보내는 것 */
/** @typedef {Object} SpeciesDerived    derive.js 가 붙인다(§7.3.4)
 * @property {{mu:number, sigma:number, a:number, b:number}} size   ln L(cm) ~ N(mu, sigma²) · W(kg) = a·L^b
 * @property {number} medianCm
 * @property {number} medianKg
 * @property {number} trophyKg         90 퍼센타일 무게
 * @property {number} legendKg         99 퍼센타일 무게
 * @property {number} trophyCm
 * @property {number} legendCm
 * @property {{normal:number, trophy:number, legend:number}} priceMul
 */

/** @typedef {Object} StageDef        data/stages/<id>.js (§7.4)
 * @property {SceneId} id
 * @property {'interior'|'outdoor'} kind
 * @property {number} unlockLevel      들어갈 수 있는 최소 레벨(집 · 호수 1 · 갯바위 5 · 강 10)
 * @property {{x:number, z:number, yaw:number}} spawn      도착 위치
 * @property {Vec2[]} walk             걸을 수 있는 영역 — **볼록 다각형** · 꼭짓점 순서 Σ(xᵢ·zᵢ₊₁ − xᵢ₊₁·zᵢ) > 0 (§7.4) · m
 * @property {Vec2[]} shore            해안선 꺾은선(x 오름차순). 물은 그 −Z 쪽. 실내는 []
 * @property {InteractPoint[]} points  npc · camp · pc · bed · door
 * @property {Array<{x:number, z:number, r:number}>} obstacles   걷기 충돌 원(m) — 판매 구조물 · 캠프 · 가구 · walk 안의 큰 소품. spawn · 자리 stand는 원 밖
 * @property {SpotDef[]} spots         낚시 자리(집은 [])
 * @property {'lake'|'waves'|'river'|'indoor'} ambience
 * @property {{amp:number, period:number}} waves           파도 진폭(m) · 주기(s) — 찌 흔들림(연출) · 물 셰이더
 * @property {Record<WeatherId, number>} weatherWeights    날씨 뽑기 가중치
 * @property {Object} look             view 전용 파라미터(§9.3) — sim은 읽지 않는다
 */
/** @typedef {{kind:InteractKind, id:string, x:number, z:number, yaw:number, radius:number, approach:Vec2}} InteractPoint
 *  kind 'npc'의 id는 'vendor', 'camp'는 'camp', 집의 'pc' · 'bed' · 'door'는 같은 이름. radius = 상호작용 반경(m)
 *  approach = 서서 E를 누르는 자리(obstacles 밖 · radius 안 — 봇이 걸어가는 목표 · 테스트가 검사) */

/** @typedef {Object} SpotDef
 * @property {SpotId} id
 * @property {Vec2} stand              설 자리 — 표식 중심 · 거리의 원점
 * @property {number} facing           물 쪽 정면 yaw
 * @property {number} arc              조준 허용 반각(rad) — 캐스팅 yaw는 facing ± arc로 자른다
 * @property {number} edgeM            stand에서 facing 방향으로 물가(해안선)까지의 거리(m). 물고기 최소 거리 · 뜰채 범위의 기준(§5.3.1) — 데이터 테스트가 shore로 검산(±0.15m)
 * @property {Array<[number,number]>} depth   수심 프로필 [[distM, depthM], …] — 거리 오름차순 · 끝점 너머는 끝값
 * @property {number} minCastM         가장 짧은 캐스팅 거리
 * @property {number} maxDriftM        흘림 최대 거리
 * @property {number|null} farFromM    이 거리 이상에서 풀의 farMul이 붙는다(먼 곳에 사는 어종 — 흘림 · 원투의 보상). 없으면 null
 * @property {Vec2} flow               흐름(m/s, 월드 XZ). 호수는 거의 0
 * @property {{fromM:number, rate:number}} snag   장애물 띠: 물고기 거리가 fromM 이상이면 라인 쓸림 rate(/s)
 * @property {number} abrasion         0..1 바닥 암반 정도 — 잠수(dive)형 쓸림 배율
 * @property {'mud'|'gravel'|'rock'|'sand'} bottom    연출 · 도감
 * @property {Array<{id:SpeciesId, w:number, farMul?:number}>} pool   어종 풀과 풍부도(판타지 어종은 w를 쓰지 않는다 — 1로 적는다). farMul: dist ≥ farFromM일 때 w에 곱한다(없으면 1)
 */

/** @typedef {Object} GearDef      data/gear.js (§7.6) — slot 별로 쓰는 필드가 다르다
 * @property {GearId} id
 * @property {GearSlot} slot
 * @property {1|2|3} tier
 * @property {SetId|null} set          로드만 세트 전용('float'|'bottom'), 나머지 null(어느 세트에나)
 * @property {number} price            상점 가격(원). 1단계는 0(지급)
 * @property {number} lossCost         잃을 때 자동 차감(바늘 · 찌 · 봉돌). 그 밖 0
 * @property {number} [castM]          로드: 기본 비거리(m)
 * @property {number} [maxLoadKg]      로드: 세운 상태 상한 하중
 * @property {number} [sensitivity]    로드 · 찌: 입질 신호 크기 배율
 * @property {number} [lengthM]        로드: 길이(연출)
 * @property {number} [maxDragKg]      릴: 최대 드랙(= 감는 힘의 상한)
 * @property {number} [speedMS]        릴: 회수 속도(m/s)
 * @property {number} [capacityM]      릴: 라인 수용량(m)
 * @property {number} [castBonus]      릴: 비거리 배율 가산(0.05 = +5%)
 * @property {number} [strengthKg]     라인: 인장 강도
 * @property {number} [biteMul]        라인: 입질 가중치 배율(굵을수록 작다)
 * @property {number} [abrasionMul]    라인: 쓸림 배율(굵을수록 작다)
 * @property {number} [pricePerM]      라인: 감기 단가(원/m)
 * @property {1|2|3} [size]            바늘: 크기
 * @property {number} [stability]      찌: 파도 · 흐름 안정(연출 노이즈 감쇠 0..1)
 * @property {number} [driftMul]       찌: 흘림 속도 배율
 * @property {number} [castBonusM]     봉돌: 비거리 가산(m)
 * @property {number} [holdMS]         봉돌: 이 흐름(m/s)까지 바닥을 잡는다
 */

/** @typedef {{id:BaitId, packSize:number, packPrice:number}} BaitDef */
/** @typedef {{id:SkillId, effects:Record<string, Array<number|boolean>>}} SkillDef   effects: Modifiers 필드 → [0단계, 1, 2, 3] 값(§7.7 · §8.4) */

/** @typedef {Object} BehaviorStateDef   fightStyles.js 의 한 행동 상태
 * @property {BehaviorKind} kind
 * @property {number} f          힘 배율(Fmax 대비)
 * @property {number} along      라인 방향 성분(+1 멀어짐 · 0 옆 · −1 다가옴)
 * @property {number} sp         속도 배율(vmax 대비)
 * @property {[number,number]} dur   지속 시간 범위(s)
 * @property {number} [tele]     들어가기 전 예고 시간(s) — 있으면 예고를 거친다
 * @property {number} [lateral]  방향(bearing) 변화 속도 배율(기본: turn 0.8 · run 0.3 · 그 밖 0.1)
 * @property {boolean} [abrades] 이 상태가 바닥/구멍을 비빈다(잠수와 같은 쓸림 규칙)
 * @property {Record<string, number>} next   다음 상태 이름 → 가중치
 */
/** @typedef {{force:number, speed:number, endurance:number, start:string, states:Record<string, BehaviorStateDef>}} StyleDef */
/** @typedef {Object} TraitDef      특성 = 성격 표에 대한 데이터 수정(§8.2)
 * @property {Record<string, BehaviorStateDef>} [addStates]
 * @property {Record<string, Record<string, number>>} [addNext]   상태 이름 → {다음 이름: 더할 가중치}
 * @property {Record<string, {f?:number, sp?:number, durMul?:number, lateral?:number}>} [scaleByKind]   BehaviorKind → 배율
 * @property {Record<string, number>} [nextMulByKind]             다음 상태 kind → 가중치 배율
 * @property {string} [start]          시작 상태 이름 바꾸기
 * @property {number} [abrasionMul]
 * @property {'tremble'|'spin'|null} [visual]   view용 표식(로드 잔떨림 · 그림자 회전)
 */
/** @typedef {{id:WeatherId, biteMul:number, dayBandStep:number, light:number, fog:number, waveMul:number, rain:number}} WeatherDef */
/** @typedef {{id:BandId, from:number, to:number}} BandDef     시(0..24). night는 from 20 · to 4(자정을 넘는다) */
```

### 3.4 게임 상태 — `GameState`

```js
/** @typedef {Object} GameState
 * @property {number} version          STATE_VERSION
 * @property {number} seed             월드 시드(uint32) — 날씨 해시 · 난수 초기값
 * @property {{s:number}} rng          sim 난수 상태(core/rng.js). sim만 쓴다
 * @property {number} tick             세션 누적 틱
 * @property {SceneId} scene
 * @property {ClockState} clock
 * @property {WeatherState} weather
 * @property {EnvState} env
 * @property {PlayerState} player
 * @property {RigState} rig
 * @property {FightState|null} fight   파이팅 중에만
 * @property {CatchRecord|null} pendingCatch   결과 패널이 기다리는 물고기(rig.phase === 'result'일 때만)
 * @property {Profile} profile         저장되는 진행(§3.6)
 * @property {{ignoreGates:boolean, devSession:boolean}} session   ?scene · ?level 등 일회용 세션(§11.6)
 * @property {DebugState} debug
 * @property {Array<{name:string, payload:Object}>} events   이번 틱/명령의 이벤트 큐(플러시 뒤 비어 있다)
 */

/** @typedef {Object} ClockState     P3 clock.js 가 매 틱 · 건너뛰기 뒤 갱신(파생 필드 포함)
 * @property {number} day              1부터
 * @property {number} tickInDay        0..215999
 * @property {number} hour             0 ≤ h < 24 (tickInDay / 9000)
 * @property {number} minute           0..59 정수(표시용)
 * @property {BandId} band
 * @property {number} sunElev          rad. 일출 05:30 · 일몰 19:30에 0, 12:30에 최대 TIME.maxSunElev. 밤에는 음수
 * @property {number} sunAzim          rad, yaw 규약. 해는 +X(동)에서 떠 −X(서)로 진다(§7.1)
 * @property {number} light            0..1 하늘 밝기(낮 1 · 한밤 0.06 · 박명 보간 · 날씨 light 곱)
 * @property {boolean} night           light < TIME.nightLight
 */

/** @typedef {Object} WeatherState
 * @property {Record<StageId, WeatherId>} today
 * @property {Record<StageId, WeatherId>} tomorrow
 * @property {WeatherId} current       지금 씬의 날씨(집은 lake의 날씨 — 창밖 연출용)
 */

/** @typedef {Object} EnvState       view · audio용 파생 값 — P3가 매 틱 갱신
 * @property {number} waveAmp          m — stage.waves.amp × weather.waveMul (집 0)
 * @property {number} wavePeriod       s
 * @property {boolean} headlamp        야외 && clock.night
 * @property {number} rain             0..1 빗줄기 세기(weather.rain, 집 0)
 * @property {string} ambience         stage.ambience
 */

/** @typedef {Object} PlayerState
 * @property {Vec2} pos
 * @property {Vec2} prevPos
 * @property {number} yaw
 * @property {number} pitch
 * @property {'walk'|'fish'} mode
 * @property {SpotId|null} spotId      mode === 'fish'일 때 선 자리
 * @property {number} speed            m/s 실제 이동 속도(걸음 흔들림 연출)
 * @property {InteractTarget|null} nearby   지금 E를 누르면 상호작용할 대상(프롬프트)
 */
/** @typedef {{kind:InteractKind, id:string, dist:number}} InteractTarget   id: 자리면 SpotId, 그 밖은 InteractPoint.id */

/** @typedef {Object} RigState       P1 rig.js 소유. 낚시 모드가 아닐 때 phase 'idle'
 * @property {SetId} set               들고 있는 세트
 * @property {RigPhase} phase
 * @property {number} phaseTime        현 단계에 들어온 뒤 경과(s)
 * @property {Vec2} origin             = spot.stand (낚시 모드가 아니면 player.pos)
 * @property {number} aimYaw           마지막 캐스팅의 yaw(facing ± arc로 잘린 값)
 * @property {number} power            0..1 캐스팅 게이지(charging 중 왕복)
 * @property {number} perfectFrom      0..1 이 값 이상이면 「완벽」(게이지에 띠로 그린다)
 * @property {{x:number, z:number, distM:number}|null} aimPreview   charging 중 지금 놓으면 떨어질 점
 * @property {Vec2} bobber             찌/봉돌의 수면 위치(waiting · bite · retrieving). 캐스팅 비행 중에는 착수 예정점
 * @property {Vec2} prevBobber
 * @property {number} castT            casting 단계의 비행 진행 0..1 (view가 포물선을 그린다)
 * @property {number} dist             origin → bobber 수평 거리(m)
 * @property {number} bearing          origin → bobber yaw
 * @property {number} waterDepth       bobber 지점 수심(m)
 * @property {number} baitDepth        미끼 수심(m) — 찌: min(floatDepth, waterDepth) · 바닥: waterDepth
 * @property {LayerId} layer
 * @property {number} floatDepth       찌 세트의 수심 설정(m) — profile.sets.float.depthM 의 사본(syncRig가 맞춘다)
 * @property {boolean} bailOpen
 * @property {boolean} drifting        찌가 흐름을 타고 움직이는 중(흘림)
 * @property {boolean} bottomSlip      봉돌이 흐름에 밀리는 중(입질 ×0.5)
 * @property {number} dragNotch        정수 0..dragNotches — profile.sets[set].dragNotch 의 사본(syncRig)
 * @property {number} dragNotches      = rigStats.dragNotches (syncRig)
 * @property {number} dragKg           = dragNotch × rigStats.dragNotchKg (syncRig)
 * @property {BaitId|null} castBaitId  물속에 있는 미끼 — charging → casting 에서 정하고 ready 에서 null. 입질 가중치 · 회수 환불 · 실패 손실은 이것을 쓴다(profile 의 bait 가 아니다)
 * @property {SetId|null} pendingSet   지금은 바꿀 수 없어 다음 ready 첫 틱에 적용할 세트 전환(failed · landing 중의 Digit1/2 — §5.2)
 * @property {SignalState} signal
 * @property {{open:boolean, remaining:number, total:number}} hookWindow
 * @property {boolean} canCast         ready에서 지금 캐스팅할 수 있는가 — profile 의 재고(미끼 · 라인)를 직접 읽는다(§5.2)
 * @property {'noBait'|'noLine'|null} castBlock
 * @property {FailReason|null} failReason   failed 단계의 사유
 * @property {LossReport|null} lastLoss
 * @property {boolean} castBuffered    failed 중 눌린 좌클릭(ready 첫 틱에 눌려 있으면 충전 시작)
 * @property {Object|null} bite        sim 내부 — 무는 물고기 {speciesId, roll, nibblesLeft, nextNibbleT, touched}. **ui는 읽지 않는다**(랜딩 전에는 어종을 숨긴다)
 */
/** @typedef {Object} SignalState     view(찌 · 초리) · audio가 읽는다
 * @property {'none'|'nibble'|'take'} kind
 * @property {number} t                이 신호가 시작된 뒤 경과(s)
 * @property {number} strength         0..1 신호 크기 = 기본 × 로드/찌 감도 × 숙련 배율(클램프)
 * @property {'sink'|'lift'|'pull'} takeStyle   찌: sink · lift / 바닥: pull
 * @property {number} count            이번 입질의 예신 횟수(지금까지)
 */

/** @typedef {Object} FightState     P2 fight.js 소유
 * @property {SpeciesId} speciesId     ui는 랜딩 전 표시하지 않는다
 * @property {FishRoll} roll
 * @property {number} t                파이팅 경과(s)
 * @property {number} dist             물고기까지 수평 거리(m) = 나가 있는 라인
 * @property {number} prevDist
 * @property {number} minDist          = spot.edgeM + FIGHT.minDistPad — 물고기가 다가올 수 있는 가장 가까운 거리(땅 위에 그려지지 않는다)
 * @property {number} bearing          origin → 물고기 yaw
 * @property {number} prevBearing
 * @property {number} halfArc          파이팅 방위 허용 반각(rad) — createFight 에서 한 번 정한다(§5.3.4)
 * @property {number} depth            물고기 수심(m, ≥0)
 * @property {number} airborne         0..1 점프 높이(공중일 때만 >0)
 * @property {number} stamina          0..1
 * @property {BehaviorKind} behavior
 * @property {string} behaviorName
 * @property {number} behaviorT
 * @property {number} behaviorDur      이 상태의 지속 시간(s) — airborne 계산 · 연출
 * @property {{kind:'run'|'jump'|'charge'|'dive', remaining:number, total:number}|null} telegraph   예고(그림자 · 아이콘 · 소리)
 * @property {number} tension          kg — 화면에 보이는 값이자 판정 값(평활)
 * @property {number} tensionRatio     tension / lineEffKg
 * @property {number} limitKg          지금 묶여 있는 한계 = rodUp ? min(lineEffKg, rodMaxLoadKg) : lineEffKg
 * @property {'line'|'rod'} limitBy    limitKg 가 어느 쪽인가(HUD 게이지 머리의 아이콘)
 * @property {number} limitRatio       tension / limitKg — HUD 텐션 게이지 · 라인 톤이 쓰는 값(§10.3 · §9.12)
 * @property {number} lineKg           세트의 라인 강도(스킬 배율 포함)
 * @property {number} lineEffKg        lineKg × (1 − abrasion)
 * @property {number} abrasion         0..FIGHT.maxAbrasion
 * @property {boolean} inSnag          dist ≥ spot.snag.fromM
 * @property {number} inCover          0..1 잠수형이 바닥/바위에 박힌 정도(≥ 0.5 이면 HUD 「박힘」)
 * @property {number} rodLift          0..1 (0 숙임 · 1 세움)
 * @property {boolean} rodUp           rodLift ≥ 0.5
 * @property {number} rodLoadRatio     tension / rodMaxLoadKg
 * @property {boolean} rodStress       rodUp && rodLoadRatio ≥ FIGHT.rodStressAt
 * @property {number} rodOverT         s — rodUp && tension > rodMaxLoadKg 가 이어진 시간(FIGHT.rodBreakHold 에 닿으면 파손). 끊기면 0
 * @property {boolean} lineDanger      tensionRatio ≥ FIGHT.lineDangerAt
 * @property {boolean} slipping        드랙이 미끄러지는 중
 * @property {number} slipSpeed        m/s 풀려 나가는 속도(클리커 소리)
 * @property {boolean} reeling         이번 틱 릴링 입력
 * @property {number} gainSpeed        m/s 실제로 감기는 속도
 * @property {boolean} slack           tension < 슬랙 문턱
 * @property {number} slackTime        s 누적(긴장되면 줄어든다)
 * @property {number} spoolLeftM       lineM − dist
 * @property {boolean} canNet          dist ≤ netRangeM && stamina ≤ landStamina
 * @property {number} netRangeM        = spot.edgeM + rigStats.netReachM (뜰채가 닿는 수평 거리)
 * @property {number} netBuffer        s — canNet 전에 누른 Space 의 남은 선입력 시간(FIGHT.netBufferS)
 * @property {number} landStamina
 * @property {boolean} showStamina     어종 지식 3단계
 * @property {string[]} traits         어종 특성(연출 — tremble · spin)
 * @property {{Fmax:number, vmax:number, endurance:number}} k   이 물고기의 상수(테스트 · 디버그)
 * @property {FightStats} stats
 * @property {Object} brain            sim 내부(행동 상태 기계 변수). view · ui는 읽지 않는다
 */
/** @typedef {{maxTension:number, sumTension:number, sumTension2:number, ticks:number, runs:number, jumps:number, slackTicks:number, slipTicks:number}} FightStats */

/** @typedef {{forceBite:{speciesId:SpeciesId, pct:number}|null, noBites:boolean}} DebugState */
```

### 3.5 판정 · 결과 값

```js
/** @typedef {Object} FishRoll        P1 catch.js rollFish 가 만든다(물기 시점에 정해진다)
 * @property {SpeciesId} speciesId
 * @property {number} z                표준정규 값(클램프 [−2.5, 3.3])
 * @property {number} pct              0..1 퍼센타일 = Φ(z)
 * @property {number} lengthCm         소수 1자리
 * @property {number} weightKg         소수 3자리
 * @property {Tier} tier
 */

/** @typedef {Object} FightOutcome    P2 updateFight 의 반환(끝난 틱에만, 나머지 null)
 * @property {'net'|'lineBreak'|'spoolEmpty'|'rodBreak'|'hookOff'} type   'net' ↔ 이벤트 FIGHT_END.outcome 'landed'
 * @property {number} lineLostM        끊긴 지점 바깥 라인(m) — lineBreak: dist · spoolEmpty: lineM 전부 · 그 밖 0
 * @property {number} durationSec
 * @property {LossCause} cause         hookOff 의 원인(§5.3.2 5 · 10e · 10f), 그 밖 null
 * @property {boolean} hookSmall       hookOffMul > 1 이었다(바늘이 입보다 작다)
 */

/** @typedef {Object} CatchRecord     P4 evaluateCatch 가 만든다
 * @property {number} uid              profile.nextUid
 * @property {SpeciesId} speciesId
 * @property {number} lengthCm
 * @property {number} weightKg
 * @property {number} pct
 * @property {Tier} tier
 * @property {number} price            기본 판매가(원, 흥정 전) = round(pricePerKg × weightKg × priceMul[tier])
 * @property {number} xpKeep           어창에 넣으면 받을 경험치(첫 포획 · 신기록 보너스 포함)
 * @property {number} xpRelease        방생하면 받을 경험치(= round(xpKeep × XP.releaseMul))
 * @property {boolean} firstCatch
 * @property {boolean} recordWeight    그 어종 최대 무게 경신(첫 포획 제외)
 * @property {StageId} stageId
 * @property {SpotId} spotId
 * @property {number} day
 * @property {number} hour
 * @property {SetId} set
 * @property {number} fightSec
 */

/** @typedef {Object} LossReport      P4 applyLoss 반환 — 실패 알림이 그대로 보인다
 * @property {FailReason} reason
 * @property {SetId} set
 * @property {BaitId} baitId           물속에 있던 미끼(rig.castBaitId — applyLoss 의 인자)
 * @property {boolean} baitLost        미끼를 잃었는가(보존 스킬로 false일 수 있다)
 * @property {number} tackleCost       자동 차감한 채비 값(원 — 바늘 + 찌/봉돌)
 * @property {number} lineLostM
 * @property {GearId|null} rodLost     부러져 사라진 로드(예비 1단계로 바뀌었다)
 * @property {boolean} spareSpool      남은 라인이 CAST.minLineM + CAST.lineReserveM 아래라 예비 스풀(line_1 가득 · 무료)로 바꿨다(§5.6)
 * @property {number|null} dragKgAfter 로드 파손으로 드랙을 낮췄으면 그 kg(§5.6), 아니면 null
 * @property {LossCause} cause         바늘 빠짐의 원인
 * @property {boolean} hookSmall       바늘이 입보다 작았다(알림 「바늘이 작다」)
 * @property {number} moneyBefore
 * @property {number} moneyAfter
 */

/** @typedef {{ok:true} & Object | {ok:false, reason:string, params?:Record<string, number|string>}} Result   §0.5 */
```

### 3.6 진행 · 보상

```js
/** @typedef {Object} Profile         저장되는 것 전부. sim(P4 함수)만 고친다
 * @property {number} money
 * @property {number} level            1..XP.levelCap
 * @property {number} xp               현재 레벨 안에서 쌓인 경험치(0 ≤ xp < xpToNext(level), 캡이면 0)
 * @property {number} xpTotal
 * @property {number} skillPoints      남은 포인트
 * @property {Record<SkillId, 0|1|2|3>} skills
 * @property {Record<GearId, number>} owned    2·3단계 장비 보유 수(1단계는 무한 — 키가 없다)
 * @property {Record<BaitId, number>} baits    보유 미끼 수
 * @property {{float:SetConfig, bottom:SetConfig}} sets
 * @property {CatchRecord[]} hold              어창(≤ HOLD.capacity)
 * @property {Record<SpeciesId, DexEntry>} dex 잡은 어종만 키가 있다
 * @property {{hints:Record<string, true>, freeBaitDay:number}} flags
 * @property {{landed:number, lost:number, released:number, sold:number, earned:number, casts:number}} stats
 * @property {number} nextUid
 */
/** @typedef {Object} SetConfig
 * @property {GearId} rod
 * @property {GearId} reel
 * @property {GearId} hook
 * @property {GearId|null} float       찌 세트만
 * @property {GearId|null} sinker      바닥 세트만
 * @property {BaitId} bait             끼울 미끼
 * @property {GearId} lineId           스풀에 감긴 라인 종류
 * @property {number} lineM            스풀 잔량(m, ≤ 릴 capacityM)
 * @property {number} depthM           찌 수심 설정(바닥 세트는 무시)
 * @property {number} dragNotch
 */
/** @typedef {{count:number, maxKg:number, maxCm:number, firstDay:number, trophies:number, legends:number, best:Tier}} DexEntry */

/** @typedef {Object} Modifiers       P4 computeModifiers — 스킬 효과의 합(§7.7)
 * @property {number} castMul
 * @property {number} perfectWindow
 * @property {number} hookWindowAdd
 * @property {number} earlyBaitKeep
 * @property {number} dragNotches
 * @property {number} lineStrMul
 * @property {number} slackRateMul
 * @property {number} abrasionMul
 * @property {number} pumpDrainMul
 * @property {number} jumpPumpMul
 * @property {0|1|2|3} knowledge
 * @property {number} biteRateMul
 * @property {number} baitKeepOnFail
 * @property {number} netRangeAdd
 * @property {number} landStaminaAdd
 * @property {number} sellMul
 * @property {number} signalMul
 * @property {boolean} tier3Unlocked
 */

/** @typedef {Object} RigStats        P4 rigStats(profile, set, mods) — rig · fight · ui 미리보기가 같은 값을 본다
 * @property {SetId} set
 * @property {GearId} rodId
 * @property {GearId} reelId
 * @property {GearId} lineId
 * @property {GearId} hookId
 * @property {GearId|null} floatId
 * @property {GearId|null} sinkerId
 * @property {BaitId} baitId
 * @property {number} baitCount        표시용 스냅샷(rig 판정은 profile 을 직접 읽는다 — §5.2)
 * @property {number} castMaxM         (rod.castM + sinker.castBonusM) × (1 + reel.castBonus) × mods.castMul
 * @property {number} rodMaxLoadKg
 * @property {number} rodSensitivity
 * @property {number} rodLengthM
 * @property {number} reelMaxDragKg
 * @property {number} reelSpeedMS
 * @property {number} spoolCapM
 * @property {number} lineM            표시용 스냅샷(rig · fight 는 profile.sets[set].lineM 을 직접 읽는다)
 * @property {number} lineKg (= strengthKg × mods.lineStrMul)
 * @property {number} lineBiteMul
 * @property {number} lineAbrasionMul (= line.abrasionMul × mods.abrasionMul)
 * @property {1|2|3} hookSize
 * @property {number} floatSensitivity
 * @property {number} floatStability
 * @property {number} floatDriftMul
 * @property {number} sinkerHoldMS
 * @property {number} sinkerCastBonusM
 * @property {number} dragNotches
 * @property {number} dragNotchKg
 * @property {number} signalMul        rod.sensitivity × (찌 세트면 float.sensitivity, 바닥이면 1) × mods.signalMul
 * @property {number} hookWindowS      SIGNAL.<set>.takeWindow + mods.hookWindowAdd (찌올림 본신이면 rig 가 SIGNAL.float.liftWindowAdd 를 더한다 — §5.4.4)
 * @property {number} perfectWindow
 * @property {number} biteRateMul
 * @property {number} netReachM        FIGHT.netReachM + mods.netRangeAdd — 물가 너머로 뜰채가 닿는 거리(파이팅의 netRangeM = spot.edgeM + 이것)
 * @property {number} landStamina      FIGHT.landStamina + mods.landStaminaAdd
 * @property {number} slackRateMul
 * @property {number} pumpDrainMul
 * @property {number} jumpPumpMul
 * @property {number} earlyBaitKeep
 * @property {number} baitKeepOnFail
 * @property {boolean} showStamina
 */

/** @typedef {Object} DexCard        P4 dexView — 도감 카드 하나
 * @property {SpeciesId} speciesId
 * @property {boolean} caught
 * @property {boolean} fantasy
 * @property {LayerId[]} layers
 * @property {string|null} time        knowledge ≥ 1 이면 SpeciesRow.time, 아니면 null
 * @property {BaitId[]|null} baits     knowledge ≥ 2
 * @property {DexEntry|null} entry
 * @property {number} trophyKg
 * @property {number} legendKg
 */
/** @typedef {Object} ShopItem       P4 shopList 의 한 항목
 * @property {string} id               목록 키 — 장비 GearId · 미끼 'bait_<id>' · 라인 감기 'refill_<set>_<lineId>'
 * @property {'gear'|'bait'|'line'} kind
 * @property {SetId|null} set          라인 감기는 그 세트(세트마다 비용이 다르다 — 항목도 세트 × 라인마다 하나), 그 밖 null
 * @property {GearId|null} lineId      kind 'line'만 — refillLine(set, lineId)
 * @property {number} price            kind 'line'은 그 세트 기준 감기 비용(같은 라인이면 모자란 m × 단가, 다른 라인이면 capacityM × 단가)
 * @property {boolean} ok
 * @property {string|null} reason
 * @property {Record<string, number|string>|null} reasonParams   §0.5
 * @property {number} owned
 * @property {GearSlot|null} slot
 * @property {number} tier
 * @property {{float:{before:RigStats, after:RigStats}|null, bottom:{before:RigStats, after:RigStats}|null}|null} previews
 *  그 장비를 각 세트에 끼웠을 때의 RigStats(사기 전 · 후 비교 — QUALITY §3). 세트 전용 로드 · 찌 · 봉돌은 해당 세트만, 공용(릴 · 바늘 · 라인)은 둘 다 */
/** @typedef {{skillId:SkillId, rank:number, ok:boolean, reason:string|null, before:Modifiers, after:Modifiers}} SkillPreview */
```

- **RigStats 의 빈 부위 · 눈금 값**(W0 확정 — `rigStats`와 `test/helpers.js`의 `makeTestRigStats`가 같은 값): 찌가 없으면(바닥 세트) `floatSensitivity 1 · floatStability 1 · floatDriftMul 1`, 봉돌이 없으면(찌 세트) `sinkerHoldMS 0 · sinkerCastBonusM 0`. `dragNotchKg = reelMaxDragKg / dragNotches`(§7.9 — 5kg / 20 = 0.25kg).

### 3.7 저장 · 설정

```js
/** @typedef {Object} SaveData       localStorage 'jay-fishing:save' 의 JSON
 * @property {'jay-fishing'} game
 * @property {number} version          SAVE_VERSION = 1
 * @property {number} savedAt          ms(app이 넣는다)
 * @property {number} seed
 * @property {{day:number, tickInDay:number}} clock
 * @property {SceneId} scene           불러오면 이 씬의 spawn에서 걷기 모드로 시작
 * @property {Profile} profile
 */

/** @typedef {Object} Settings       localStorage 'jay-fishing:settings'
 * @property {number} version          1
 * @property {number} mouseSens        0.2..3 (기본 1)
 * @property {boolean} invertY
 * @property {'low'|'medium'|'high'} quality
 * @property {number} fov              60..90 (기본 70)
 * @property {{master:number, sfx:number, ambience:number, ui:number}} volume   0..1
 * @property {boolean} hints           첫 안내 문구 켜기
 */
```

### 3.8 sim 문맥 · 봇

```js
/** @typedef {Object} SimCtx         GameSim이 하나 만들어 매 틱 필드를 갱신해 넘긴다(P3 소유)
 * @property {GameState} state
 * @property {import('./core/rng.js').Rng} rng   state.rng 위의 난수
 * @property {(name:string, payload?:Object) => void} emit   state.events 에 쌓는다(즉시 발행하지 않는다)
 * @property {Modifiers} mods          스킬이 바뀌면 GameSim이 다시 계산
 * @property {StageDef} stage          지금 씬 = getStage(state.scene) — 씬을 바꾸는 그 자리(travel · newGame · debugGotoScene · 불러오기)에서 대입한다
 * @property {SpotDef|null} spot       낚시 중인 자리 = player.spotId ? getSpot(player.spotId) : null — enterSpot · exitSpot · travel 이 바꾼 그 자리에서 대입한다
 * @property {RigStats} rigStats       지금 세트의 RigStats
 * @property {() => void} refresh      mods = computeModifiers(profile) · rigStats = rigStats(profile, rig.set, mods) → syncRig(ctx)(P1 — rig 의 파생 필드). profile 을 바꾸는 sim 함수는 끝에서 반드시 부른다(§5.2 · §6.7)
 */

/** @typedef {{name:string, args:Array}} BotCommand    GameSim 명령 메서드 이름과 인자 — UI가 부르는 것과 같은 것만(§6.8) */
/** @typedef {{input:InputFrame, command:BotCommand|null}} BotAction */
```

---

## §4 이벤트 카탈로그

### 4.1 버스 규칙

- 버스는 하나다: app이 `new EventBus()`를 만들어 sim · view · audio · ui에 넘긴다. 이름은 `core/events.js`의 `EV` 상수만 쓴다(문자열 리터럴 금지).
- **sim 이벤트는 큐에 쌓였다가 한꺼번에 발행된다.** sim 코드는 `bus.emit`을 부르지 않고 `ctx.emit(name, payload)`만 쓴다. `GameSim.step`의 마지막 단계와 `GameSim`의 **모든 공개 명령 메서드의 끝**에서 `state.events`를 순서대로 `bus.emit` 하고 비운다 → 구독자는 항상 **틱(명령)이 끝난 일관된 상태**를 본다.
- **플러시는 재진입에 안전하다**(리스너가 플러시 도중에 명령을 부르는 것은 정상 경로 — `INTERACT` → ui가 패널을 연다 → 패널이 `sim.sellAll()`):

  ```js
  _flush() {
    if (this._flushing) return;                // 안쪽 호출은 큐에 쌓기만 한다
    this._flushing = true;
    try {
      while (this.state.events.length) {
        const q = this.state.events; this.state.events = [];
        for (const e of q) this.bus.emit(e.name, e.payload);
      }
    } finally { this._flushing = false; }
  }
  ```
- sim 로직은 이벤트에 의존하지 않는다(이벤트는 표현용 알림이다). sim 안의 상호작용은 §6의 함수 호출로만 한다.
- ui · app 이벤트는 즉시 발행한다.
- payload는 순수 객체. 위치는 `x`, `z`(m). 구독자는 payload를 고치지 않는다. 리스너 예외는 삼키지 않는다(테스트가 잡는다).
- **이벤트 누락에 안전**: view · ui · audio는 이벤트를 놓쳐도 다음 `update(state)`에서 상태를 보고 스스로 맞춘다(§9.1).

### 4.2 sim 이벤트 (`ctx.emit` → 플러시)

| EV 키 | 문자열 | payload | 발행 | 주요 구독 |
|---|---|---|---|---|
| `SCENE_CHANGED` | `scene/changed` | `{from:SceneId\|null, to:SceneId, reason:'start'\|'travel'\|'load'\|'new'\|'debug'}` | P3 | world(씬 교체) · tackle · fish · fx(정리) · audio(환경음) · ui(HUD 구성) · app(카메라 · 저장) |
| `PLAYER_PLACED` | `player/placed` | `{x, z, yaw, pitch, reason:'spawn'\|'spot'\|'exitSpot'\|'debug'}` | P3(spawn · debug) · P1(spot · exitSpot — 둘 다 `placePlayer` 경유) | app(마우스 yaw · pitch를 이 값으로) · camera(순간이동 — 보간 끊기) |
| `CLOCK_BAND` | `clock/band` | `{band, prev, day, hour}` | P3 | ui(시계 아이콘 · 알림) · audio(환경음 층) · world |
| `CLOCK_DAY` | `clock/day` | `{day}` | P3 | ui · app(저장 요청은 `SAVE_REQUEST`로 온다) |
| `CLOCK_SKIP` | `clock/skip` | `{fromDay, fromTick, toDay, toTick, reason:'camp'\|'bed'\|'travel'\|'debug'}` | P3 | world(하늘을 한 번에 갱신 — 보간 금지) · ui |
| `WEATHER_CHANGED` | `weather/changed` | `{current, today, tomorrow}` | P3 | world(비 · 안개) · audio · ui |
| `INTERACT` | `world/interact` | `{kind:'npc'\|'camp'\|'pc'\|'bed'\|'door', id}` | P3 | ui(패널 열기 — §10.2) |
| `FISHING_ENTER` | `fishing/enter` | `{spotId, set}` | P1 | tackle(로드 꺼내기) · ui(HUD 낚시 모드 · 첫 안내) · audio |
| `FISHING_EXIT` | `fishing/exit` | `{spotId}` | P1 | tackle · ui |
| `SET_CHANGED` | `rig/set` | `{set}` | P1 | tackle(로드 교체 연출) · ui |
| `DEPTH_CHANGED` | `rig/depth` | `{depthM}` | P1 | ui |
| `DRAG_CHANGED` | `rig/drag` | `{notch, notches, kg, ratio}` (ratio = kg / lineKg) | P1 | ui(눈금) · audio(딸깍) |
| `BAIL_CHANGED` | `rig/bail` | `{open}` | P1 | ui · audio · tackle(베일 암) |
| `CAST_START` | `cast/start` | `{set}` | P1 | tackle(뒤로 젖힘) · ui(게이지) |
| `CAST_RELEASE` | `cast/release` | `{power, perfect, distM, aimYaw}` | P1 | tackle(휘두름) · audio(휙) · ui(완벽 알림) |
| `CAST_SPLASH` | `cast/splash` | `{x, z, distM, waterDepthM, baitDepthM, layer, set}` | P1 | fx(착수 물보라) · audio(퐁당) · ui(층 표시) |
| `CAST_BLOCKED` | `cast/blocked` | `{reason:'noBait'\|'noLine'}` | P1 | ui(안내) · audio(실패음) |
| `RIG_BUSY` | `rig/busy` | `{action:'set'\|'depth'}` | P1 | ui(알림 `reason.busy` — 그 단계에서 한 번) · audio(부정음) — 입질 · 파이팅 · 랜딩 · 결과 중의 세트 전환 · 수심 입력을 버렸다(조용한 실패 금지) |
| `RETRIEVE_DONE` | `rig/retrieved` | `{baitReturned}` | P1 | tackle · ui |
| `BITE_NIBBLE` | `bite/nibble` | `{set, strength, index}` | P1 | tackle(찌 톡 · 초리 떨림) · fx(파문) · audio(물방울 · 방울 작게) |
| `BITE_TAKE` | `bite/take` | `{set, style:'sink'\|'lift'\|'pull', window}` | P1 | tackle(본신 · 로드 숙임) · fx · audio(방울 · 본신음) · ui(첫 안내 `bite`) |
| `HOOK_SET` | `hook/set` | `{weightKg, lengthCm}` (어종은 싣지 않는다) | P1 | tackle(챔질) · audio(챔질) · ui(파이팅 HUD · 첫 안내 `fight`) · fish(그림자 등장) |
| `HOOK_MISS` | `hook/miss` | `{reason:'early'\|'late', baitKept}` | P1 | ui(알림) · audio |
| `FIGHT_TELEGRAPH` | `fight/telegraph` | `{kind:'run'\|'jump'\|'charge'\|'dive', lead}` (챔질 직후의 첫 질주 예고 포함 — §5.3.1) | P2 | ui(예고 아이콘) · audio(물살 예고 · 점프 전 소리) · fish(그림자 상승) |
| `FIGHT_BEHAVIOR` | `fight/behavior` | `{kind, name}` | P2 | fish · audio(질주 물살) |
| `FIGHT_JUMP` | `fight/jump` | `{phase:'leave'\|'land', x, z, lengthM}` | P2 | fx(물보라 큼) · audio(철썩) · fish(공중 모델) |
| `FIGHT_SHAKE` | `fight/shake` | `{strength}` | P2 | tackle(로드 덜컹) · audio |
| `FIGHT_SLIP` | `fight/slip` | `{on}` | P2 | audio(클리커 시작/끝 — 속도는 상태에서) · ui |
| `ROD_STRESS` | `fight/rodStress` | `{on}` | P2 | tackle(로드 떨림) · audio(삐걱) · ui(경고) |
| `LINE_DANGER` | `fight/lineDanger` | `{on}` | P2 | ui(게이지 점멸 — 섬광 금지) · audio(라인 삐걱) |
| `SNAG` | `fight/snag` | `{on}` | P2 | ui(「장애물」 경고) |
| `NET_READY` | `fight/netReady` | `{on}` | P2 | ui(「Space 뜰채」 프롬프트 · 첫 안내 `net`) |
| `NET_START` | `fight/net` | `{x, z, lengthM}` | P2 | tackle(뜰채 연출) · fx · audio |
| `FIGHT_END` | `fight/end` | `{outcome:'landed'\|'lineBreak'\|'spoolEmpty'\|'rodBreak'\|'hookOff', durationSec, maxTension, distM, cause:LossCause}` | P2 | audio(끊김 탁 · 파이팅 지속음 정리) · ui(파이팅 HUD 닫기) · tackle(rodBreak 부러짐 연출). **`landed`는 뜰채 「시작」이다** — tackle · fish는 landing 연출(§9.7 · §9.8)로 넘어가고, 로드 원위치 · 그림자 퇴장은 `CATCH_RESULT`(성공) 또는 `FAIL`(실패)에서 한다 |
| `CATCH_RESULT` | `catch/result` | `{catch:CatchRecord, holdFull}` | P1 | ui(결과 패널 열기) · audio(성공음) · fish(미리보기 준비) |
| `CATCH_KEPT` | `catch/kept` | `{catch}` | P1 | ui · audio |
| `CATCH_RELEASED` | `catch/released` | `{catch, swapped}` (swapped: 어창이 차서 어창의 물고기를 빼고 새 것을 넣었다 — `catch`는 뺀 것) | P1 | ui · fx(방생 물보라) · audio |
| `FAIL` | `rig/fail` | `{reason:FailReason, loss:LossReport}` | P1 | ui(1초 알림 — 잃은 것 표시) · audio |
| `RIG_RESTORED` | `rig/restored` | `{set, rodReplaced, spoolReplaced, baitLeft, lineM, dragKg}` | P1 | tackle(예비 로드 등장) · ui(예비 로드 · 예비 스풀 · 낮춘 드랙 알림) |
| `BAIT_GRANTED` | `bait/granted` | `{baitId, count}` | P4 | ui(안내) |
| `XP_GAINED` | `progress/xp` | `{amount, xpTotal, level, xp, xpToNext, source:'keep'\|'release'\|'debug'}` — 레벨 캡이면 `xp` 0 · `xpToNext` **null**(JSON 안전) | P4 | ui(경험치 바 · +n · 캡이면 「MAX」) |
| `LEVEL_UP` | `progress/levelUp` | `{level, skillPoints, unlocks:string[]}` (unlocks는 데이터에서 계산 — 아래) | P4 | ui(배너) · audio |
| `RECORD` | `progress/record` | `{speciesId, kind:'first'\|'weight', weightKg, tier}` | P4 | ui(배너 · 도감 표시) · audio |
| `MONEY_CHANGED` | `money/changed` | `{money, delta, reason:'sell'\|'buy'\|'loss'\|'refill'\|'grant'}` | P4 | ui(돈 · ±n) · audio(동전 — sell만) |
| `SOLD` | `shop/sold` | `{count, total, auto}` | P4 | ui · audio |
| `BOUGHT` | `shop/bought` | `{itemId, qty, cost}` | P4 | ui · audio |
| `LINE_REFILLED` | `shop/refill` | `{set, lineId, meters, cost}` | P4 | ui |
| `EQUIPPED` | `gear/equipped` | `{set, slot, itemId}` | P4 | tackle(로드 모델 교체) · ui |
| `SKILL_LEARNED` | `skill/learned` | `{skillId, rank, unlocks:string[]}` (숙련으로 3단계가 열리면 `'tier:3'`) | P4 | ui(배너) · audio |
| `SAVE_REQUEST` | `save/request` | `{reason:'catch'\|'loss'\|'sell'\|'buy'\|'refill'\|'equip'\|'skill'\|'tackle'\|'hint'\|'scene'\|'day'\|'sleep'\|'new'}` | P1 · P3 · P4 | app(그 프레임 끝에 한 번 저장 — §11.5) |

발행 위치: P4 함수가 내는 이벤트(`BAIT_GRANTED` · `XP_GAINED` · `LEVEL_UP` · `RECORD` · `MONEY_CHANGED` · `SOLD` · `BOUGHT` · `LINE_REFILLED` · `EQUIPPED` · `SKILL_LEARNED`)는 P4 함수가 `ctx.emit`으로 직접 낸다(호출하는 P1 · P3가 다시 내지 않는다). `SAVE_REQUEST`는 그 일을 끝낸 쪽이 낸다 — P4: sell · buy · refill · equip · skill · tackle(`setBait`) / P1: catch(keep · release) · loss(모든 `FAIL` 직후) · tackle(`setFloatDepth`) / P3: scene · day · sleep · new · hint(`markHintSeen`). 드랙 눈금 변화는 저장을 요청하지 않는다(다음 저장에 함께 실린다).

**`unlocks` 계산**(P4 — ID 분기 없이 데이터에서): `STAGES` 중 `unlockLevel === 새 레벨`이면 `'stage:<id>'` · 새 레벨 `=== GEAR_GATES.tier2Level`이면 `'tier:2'` · `level ≥ tier3Level && skills.mastery ≥ tier3Mastery`가 **이번 일로** 참이 되면 `'tier:3'`(레벨 업이든 `learnSkill`이든).

### 4.3 ui · app 이벤트 (즉시)

| EV 키 | 문자열 | payload | 발행 | 구독 |
|---|---|---|---|---|
| `PANEL_OPENED` | `ui/opened` | `{panel:PanelId, depth}` (depth = 스택 깊이 — §10.4) | P8 | app(포인터 락 해제 · 입력 차단) · audio(UI음) |
| `PANEL_CLOSED` | `ui/closed` | `{panel:PanelId, depth, by:'esc'\|'tab'\|'confirm'\|'pointer'\|'code'}` (depth = 닫은 뒤 남은 깊이 · confirm = Enter/Space) | P8 | app(depth 0이면 입력 복귀 · 포인터 락은 §11.3 규칙으로만 다시 — `by`가 `'confirm'` · `'pointer'`일 때만 그 처리기 안에서 요청) |
| `SCREEN_CHANGED` | `app/screen` | `{from, to}` | P9 | ui · audio |
| `PAUSED` | `app/paused` | `{on}` | P9 | audio(멈춤) · ui |
| `SETTINGS_CHANGED` | `app/settings` | `{settings}` | P9 | renderer(화질) · camera(FOV · 감도) · audio(볼륨) · ui |
| `POINTER_LOCK` | `app/pointerLock` | `{locked, available}` (available은 API가 없거나 **한 번도 성공한 적 없이** 첫 요청이 실패했을 때만 false — §11.3) | P9 | ui(안내 문구: 락 없음 → `prompt.clickToLook` · available false → 드래그 안내) |
| `AUDIO_UNLOCKED` | `app/audioUnlocked` | `{}` | P9 | ui(소리 안내 지우기) |

---

## §5 틱 순서 · 파이팅 모델 · 시간 처리 · 렌더 보간

### 5.1 `GameSim.step(input)` — 이 순서 그대로 (P3)

1. `tick += 1`. 보간용 직전 값 복사: `player.prevPos ← pos` · `rig.prevBobber ← bobber` · (파이팅 중) `fight.prevDist ← dist` · `fight.prevBearing ← bearing`.
2. **시계**: `advanceClock(ctx, 1)` — `tickInDay += 1`. 자정을 넘으면 `day += 1` → `CLOCK_DAY` · 날씨 다시 뽑기(`WEATHER_CHANGED`) · `SAVE_REQUEST{day}`. 시간대가 바뀌면 `CLOCK_BAND`. 파생 필드(`hour` · `band` · 해 · `light` · `night`)와 `env` 갱신.
3. **시선**: `player.yaw ← input.yaw`, `player.pitch ← clamp(input.pitch, WORLD.pitchMin, WORLD.pitchMax)`(유한수일 때만).
4. **모드별**
   - `walk`: `const {enterSpotId} = updateWalk(ctx, input)` — 이동 · 볼록 다각형 충돌 · `nearby` 갱신 · `input.interact` 에지면 상호작용(자리면 `enterSpotId`를 돌려준다 / 그 밖 → `INTERACT`). `enterSpotId`가 있으면 GameSim이 `enterSpot(ctx, enterSpotId)`(P1)를 부른다 — `world.js`는 rig를 모른다(§2.2).
   - `fish`: `updateRig(ctx, input)`(P1). 그 안에서 파이팅 중이면 `updateFight(ctx, input)`(P2)을 부른다(§5.3).
5. 플러시(§4.1).

`ctx.stage` · `ctx.spot`은 씬 · 자리가 바뀌는 그 자리(travel · newGame · enterSpot · exitSpot · debugGoto* · 불러오기 · `debugLoadState`)에서 대입하고, `ctx.mods` · `ctx.rigStats` · rig 파생 필드는 `ctx.refresh()`가 맞춘다(§3.8). step은 매 틱 다시 계산하지 않는다.

명령 메서드(`travel` · `sellAll` · `keepCatch` …)는 틱 밖에서 불린다(ui · 봇). 각 명령은 상태를 바꾸고 끝에서 플러시한다. **패널이 열려 있는 동안 app은 `step`을 부르지 않는다**(§5.8) — 그래서 명령과 틱이 섞이지 않는다.

### 5.2 채비 단계 기계 — `updateRig` (P1)

```
idle ──enterSpot──▶ ready ──좌클릭 누름──▶ charging ──좌클릭 뗌──▶ casting ──비행 끝──▶ waiting
                     ▲  ▲                                                   │   ▲  │ 좌클릭 누름
                     │  │                                  좌클릭 뗌(아직 멀다)│   │  ▼
                     │  └──── retrieving(거리 ≤ CAST.retrieveDoneM) ◀────────┘   retrieving
                     │                                                          │ 입질(위험률)
                     │  ┌── failed(RIG.failNotice초) ◀── 헛챔질 · 늦음 ◀── bite ◀┘
                     │  │        ▲                           │ 본신 창 안의 Space
                     ├──┘        └── 끊김 · 빠짐 · 파손 ◀── fighting ◀┘
                     │                                        │ canNet 상태의 Space
                     └──keepCatch/releaseCatch── result ◀── landing(RIG.netTime초)
```

틱마다 순서:

1. **설정 입력** — 지금 못 하는 입력은 다음 가능한 틱으로 미루고, 미룰 수 없으면 `RIG_BUSY`로 알린다(조용히 버리지 않는다 — QUALITY §1):
   - `input.selectSet`(지금 세트와 다를 때):
     - `ready` · `charging`(충전 취소 — 미끼는 아직 쓰지 않았다) → 바로 전환: `rig.set` · `SET_CHANGED` · `ctx.refresh()`(syncRig가 그 세트의 드랙 · 수심을 맞춘다).
     - `casting` · `waiting` · `retrieving` → 즉시 회수(`castBaitId` 미끼 환불 · `RETRIEVE_DONE{baitReturned:true}`) → `ready` → 같은 틱에 전환.
     - `failed` · `landing` → `rig.pendingSet`에 넣고 `ready`가 되는 첫 틱에 전환.
     - `bite` · `fighting` · `result` → 버리고 `RIG_BUSY{action:'set'}`.
   - `input.depthSteps`(찌 세트만 — 바닥 세트는 수심이 없어 무시한다): `floatDepth = clamp(floatDepth + steps × CAST.depthStepM, CAST.depthMinM, CAST.depthMaxM)` → `profile.sets.float.depthM`에도 쓴다 · `DEPTH_CHANGED` · `SAVE_REQUEST{tackle}`.
     - `ready` · `charging` · `casting` · `retrieving` · `failed` → 그대로 적용.
     - `waiting` → 적용하고 물속 미끼의 `baitDepth` · `layer`를 바로 다시 계산 · `phaseTime = 0`(`BITE.minWait`를 다시 센다 — 수심을 바꿔 공짜로 다시 뽑지 못하게).
     - `bite` · `fighting` · `landing` · `result` → 버리고 `RIG_BUSY{action:'depth'}`.
   - `input.dragSteps` — 낚시 모드의 **모든 단계**. `profile.sets[set].dragNotch = clamp(… + steps, 0, rigStats.dragNotches)` → `syncRig(ctx)` · `DRAG_CHANGED`.
   - `input.bail` — `waiting` · `fighting`에서 토글(`BAIL_CHANGED`). `ready`로 돌아오면 닫힌다.
   - 낚시 모드의 `input.interact`는 버린다(일어나기는 Esc → `exitFishing`). `waiting` · `casting` · `retrieving`의 `input.hook`(Space)도 버린다 — 헛챔질은 입질 신호가 시작된 `bite` 단계에서만 생긴다.
2. **단계 처리** (`phaseTime += DT` 뒤):
   - `ready`: `pendingSet`이 있으면 먼저 전환. **재고는 profile에서 직접 읽는다**(RigStats의 `baitCount` · `lineM`은 표시용 스냅샷): `bait = profile.sets[set].bait` · `canCast = profile.baits[bait] > 0 && profile.sets[set].lineM ≥ CAST.minLineM`(`castBlock` = `'noBait'` · `'noLine'` · null). `input.primaryPressed`(또는 진입 틱에 `castBuffered && input.primary`)면 — 캐스팅 불가면 먼저 `grantFreeBaitIfNeeded(ctx)`(P4)를 부르고 다시 판정, 그래도 불가면 `CAST_BLOCKED{reason}` · 남은 처리 없음 / 가능하면 `charging`(`power = 0` · `CAST_START`).
   - `charging`: `power = 삼각파(phaseTime / CAST.gaugePeriod)`(0→1→0, 0에서 시작). `perfectFrom = 1 − rigStats.perfectWindow`. `aimPreview` = 지금 놓았을 때의 착수점(아래 식 그대로). `input.primaryReleased`면 캐스팅:
     - `castBaitId = profile.sets[set].bait` · 미끼 1개 소모(`profile.baits[castBaitId] −= 1` · `stats.casts += 1`) · `ctx.refresh()`.
     - `factor = power ≥ perfectFrom ? 1 : CAST.minFactor + CAST.slope × power`.
     - `hi = min(castMaxM, lineM − CAST.lineReserveM)` · `lo = min(spot.minCastM, hi)` · `distM = clamp(castMaxM × factor, lo, hi)` (`lineM` = `profile.sets[set].lineM`. `CAST.minLineM ≥ minCastM + lineReserveM`이라 `lo = minCastM`이 보통이다).
     - `aimYaw = facing + clamp(angleDiff(facing, player.yaw), −arc, +arc)`. 착수점 = `stand + fwd(aimYaw) × distM`.
     - `casting`으로(`CAST_RELEASE{perfect: power ≥ perfectFrom}`). 비행 시간 `CAST.flightBase + distM × CAST.flightPerM`.
   - `casting`: `castT = phaseTime / 비행 시간`. 1에 닿으면 착수: `bobber` · `dist` · `bearing` · `waterDepth = depthAt(spot, dist)` · `baitDepth` · `layer`(§5.4) → `CAST_SPLASH` → `waiting`.
   - `waiting`:
     - 흘림 후보: 찌 세트 && `bailOpen` && `|spot.flow| ≥ BITE.driftMinFlow`면 `next = bobber + flow × floatDriftMul × DT`.
     - 봉돌 밀림 후보: 바닥 세트 && `|flow| > sinkerHoldMS`면 `next = bobber + 흐름 방향 × (|flow| − sinkerHoldMS) × BITE.bottomSlipSpeed × DT`.
     - **경계**: 후보 `next`가 (1) `|angleDiff(facing, yawOf(next − stand))| ≤ CAST.driftArc` (2) `|next − stand| ≥ spot.minCastM` (3) `next.z < shoreZAt(stage.shore, next.x) − CAST.shoreMarginM` (4) 흘림이면 `|next − stand| ≤ min(spot.maxDriftM, lineM − CAST.driftReserveM)` 를 모두 만족할 때만 `bobber = next`(`drifting` 또는 `bottomSlip = true`). 하나라도 어기는 틱에 멈춘다(둘 다 false). 그래서 찌/봉돌은 땅 위로 가지 않고, `createFight`의 bearing은 늘 `facing ± CAST.driftArc` 안이다.
     - `dist` · `bearing` · `waterDepth` · `baitDepth` · `layer`를 다시 계산(층이 바뀌면 입질 가중치도 다음 틱부터 바뀐다).
     - `input.primary`면 `retrieving`.
     - **입질**: `phaseTime ≥ BITE.minWait` && `!debug.noBites`면 `w = biteWeights({spot, band, weather, layer, baitId: castBaitId, rigStats, distM: dist})` · `rate = biteRate(w, …)`(§5.4) · `p = 1 − exp(−rate × DT)` · `rng.chance(p)`면 어종을 뽑고(`pickSpecies(rng, w, castBaitId)`) `roll = rollFish(rng, species)` → `bite`. `debug.forceBite`가 있으면 대기 없이 그 어종 · 퍼센타일로 바로 `bite`(그리고 비운다).
   - `retrieving`(빈 채비 회수): `input.primary` 동안 `dist −= rigStats.reelSpeedMS × CAST.emptyRetrieveMul × DT`(찌가 origin 쪽으로 — 28m 약 6초 · 100m 약 22초). 떼면 `waiting`으로(입질 위험률 재개, `minWait`는 다시 세지 않는다). `dist ≤ CAST.retrieveDoneM`이면 `castBaitId` **환불 +1**(아무것도 물지 않았으니까) → `RETRIEVE_DONE{baitReturned:true}` → `ready`(`castBaitId = null` · `ctx.refresh()`).
   - `bite`: 신호 타임라인(§5.4.4)을 민다. 창 길이 = `rigStats.hookWindowS + (takeStyle === 'lift' ? SIGNAL.float.liftWindowAdd : 0)`. `input.hook` 에지:
     - 본신 창이 열려 있으면 **성공** → `HOOK_SET` → `state.fight = createFight(ctx, …)`(P2) → `fighting`.
     - 본신 전이고 본신까지 남은 시간 ≤ `SIGNAL.earlyGrace`면 **선입력**으로 잡아 두고 본신 첫 틱에 성공 처리한다.
     - 그 밖(예신 중 이른 챔질)이면 **헛챔질** → 실패 `'early'`.
     - 창이 닫힐 때까지 없으면 → 실패 `'late'`.
   - `fighting`: `outcome = fightImpl.updateFight(ctx, input)`. `null`이면 계속. `'net'`이면 `landing`. 그 밖이면 실패 처리(아래 3).
   - `landing`: `phaseTime ≥ RIG.netTime`이면 `record = evaluateCatch(ctx, fight.roll, fight.t)`(P4) → `state.pendingCatch = record` · `state.fight = null` · `castBaitId = null` → `result` · `CATCH_RESULT{catch, holdFull: hold.length ≥ HOLD.capacity}`.
   - `result`: 아무것도 하지 않는다 — `keepCatch(opts)` / `releaseCatch()` 명령을 기다린다(app은 이 단계에서 `step`을 부르지 않는다 — §5.9).
   - `failed`: `input.primaryPressed`면 `castBuffered = true`. `phaseTime ≥ RIG.failNotice`면 `RIG_RESTORED` → `ready`(같은 틱에 `ready` 처리를 한 번 더 돌려 버퍼된 충전을 시작한다).
3. **실패 처리**(헛챔질 · 늦음 · 파이팅 실패 공통): `loss = applyLoss(ctx, set, reason, {lineLostM, baitId: rig.castBaitId, cause, hookSmall})`(P4 — 미끼 보존 판정 · 채비 값 차감 · 라인 감소 · 예비 스풀 · 로드 교체 · `MONEY_CHANGED` · 끝에 `ctx.refresh()`) → `state.fight = null` · `rig.failReason = reason` · `rig.lastLoss = loss` · `rig.castBaitId = null` · `rig.bobber = origin` · `dist = 0` · `bailOpen = false` → `FAIL{reason, loss}` (헛챔질 · 늦음은 먼저 `HOOK_MISS`) · `SAVE_REQUEST{loss}` → `failed`.

**profile을 바꾸는 sim 함수는 끝에 `ctx.refresh()`를 부른다**: 캐스팅 소모 · 회수/실패 환불 · `grantFreeBaitIfNeeded` · `applyLoss` · `refillLine` · `setBait` · `equip` · `learnSkill` · `sellAll`/`buy`(돈만 바뀌어도 — 값싼 호출이다). 그래서 HUD 스냅샷과 rig 판정이 같은 틱 안에서 어긋나지 않는다.

**재도전 2초 보장**(브리프 §2 · QUALITY §3): 실패 알림 `RIG.failNotice` 1.0초 → `ready`. 좌클릭 누름 → 게이지가 0.7초에 0.88 → 뗌. 합 1.7초 · 입력 2번. 알림 중에 누른 좌클릭은 버퍼되어 `ready` 첫 틱에 충전을 시작한다(QUALITY §1 — 선입력 창 = 남은 알림 시간 전부). 라인 끊김 · 스풀 바닥으로 라인이 모자라도 예비 스풀(§5.6)로 같은 2초다.

`exitFishing()`(P3 명령 → P1 `exitSpot`): `ready` · `charging` · `casting` · `waiting` · `retrieving` · `failed`에서만. `casting` · `waiting` · `retrieving`이면 즉시 회수(미끼 환불) → `idle` · `player.mode = 'walk'` · `ctx.spot = null` · `FISHING_EXIT` · `PLAYER_PLACED{reason:'exitSpot'}`(`placePlayer` — 자리에서 `WORLD.exitStepBack` 뒤). `bite` · `fighting` · `landing` · `result`면 `{ok:false, reason:'busy'}`, 걷기 모드면 `{ok:false, reason:'notHere'}`.

### 5.3 파이팅 모델 — `createFight` · `updateFight` (P2)

**물리 엔진이 아니다.** 1차원 거리 + 텐션 스칼라 + 물고기 행동 상태 기계다. 「드랙 이하면 버티고, 넘으면 미끄러지며 라인이 풀린다」가 전부의 뿌리다.

#### 5.3.1 시작할 때 정하는 상수 (`createFight`)

```
W = roll.weightKg ; Lm = roll.lengthCm / 100 ; sp = 어종 ; st = STYLES[sp.style] ; brain = buildBrain(sp)
Fmax  = st.force     × (sp.fight.force   ?? 1) × W ^ FIGHT.forceExp        (kg — 이 물고기가 낼 수 있는 최대 당김)
vmax  = st.speed     × (sp.fight.speed   ?? 1) × Lm ^ FIGHT.speedExp       (m/s — 최대 질주 속도)
E     = st.endurance × (sp.fight.stamina ?? 1) × W ^ FIGHT.enduranceExp    (s — 체력 시간 상수)
reelBase = FIGHT.reelLoadK × W ^ FIGHT.reelLoadExp                          (kg — 끌어오는 물의 저항)
slackKg  = min(HOOK.slackFracLine × lineKg, HOOK.slackFracFish × Fmax)     (이 아래면 슬랙)
hookOffMul = BITE.hookSmallerHookOff[clamp(mouth − hookSize, 0, 2)]         (작은 바늘에 큰 입 → 빠짐 ↑ · hookSmall = hookOffMul > 1)
minDist   = spot.edgeM + FIGHT.minDistPad                                   (물고기가 올 수 있는 가장 가까운 거리 — 물가 바로 너머)
netRangeM = spot.edgeM + rigStats.netReachM                                 (뜰채가 닿는 거리 — 보이는 뜰채 길이와 같다 · §9.10)
halfArc   = min(FIGHT.maxArc, max(spot.arc + FIGHT.bearingSlack, |angleDiff(facing, rig.bearing)| + FIGHT.bearingSlack))   (흘린 찌에서 건 물고기도 순간이동하지 않는다)
dist = rig.dist ; bearing = rig.bearing ; depth = rig.baitDepth ; stamina = 1 ; rodLift = 0 ; tension = 0 ; abrasion = 0 ; netBuffer = 0 ; rodOverT = 0 ; fight.brain.preTeleLoose = 0
행동: brain.start 의 kind 가 run · dive · jump · charge 면 **예고를 거쳐** 들어간다 — telegraph = {kind, remaining: FIGHT.startTele, total: FIGHT.startTele} · FIGHT_TELEGRAPH
      (챔질 직후 첫 질주에도 드랙을 풀 시간이 있다). 그 밖(hold 등)이면 바로 enter(brain.start).
```

#### 5.3.2 틱마다 (`updateFight(ctx, input)` — 이 순서)

```
0. 뜰채: (input.hook || netBuffer > 0) && fight.canNet(직전 틱 값) → NET_START · FIGHT_END{landed} → return {type:'net'}   ← 같은 틱의 다른 판정보다 먼저
   아니면 netBuffer = (input.hook ? FIGHT.netBufferS : max(0, netBuffer − DT))        ← 프롬프트가 뜨기 직전에 누른 Space 도 씹히지 않는다
1. loose = fight.slipping(직전 틱) ? 0 : clamp01(1 − tension / (HOOK.tightRef × Fmax × fat(직전 틱)))
         (라인이 느슨한 정도 — 드랙이 미끄러지는 동안은 스풀이 하중을 받으며 풀리므로 라인이 팽팽하다: 질주에 드랙을 풀어 주는 대응이 벌을 받지 않는다)
2. 행동: stepBrain(fight, brain, rng, DT, ctx, loose) — §5.3.3. 예고에 들어가는 틱에 fight.brain.preTeleLoose = loose 를 저장한다(fight.brain = 이 판의 상태 기계 변수 · buildBrain 의 결과는 어종별 정의). 뜰채 범위 재질주 규칙도 여기서.
3. fat = FIGHT.fatigueFloor + (1 − FIGHT.fatigueFloor) × stamina
   s  = 현재 상태 정의(예고 중이면 f = FIGHT.teleF · along = FIGHT.teleAlong · sp = FIGHT.teleSp)
   F  = Fmax × s.f × fat ;  Fal = F × s.along                  (라인 방향 당김, 음수면 다가온다)
4. 로드: rodLift += input.secondary ? DT / FIGHT.pumpLiftTime : −DT / FIGHT.rodLowerTime  (0..1) ; dLift = 이번 틱 변화 ; rodUp = rodLift ≥ 0.5
   pumpGain = (dLift > 0 && rodLift ≥ FIGHT.pumpGainFrom) ? FIGHT.pumpStroke × dLift : 0     ← 펌핑 거리는 로드가 선 구간(0.5 → 1)에서만 — 미세 연타로 위험 없이 버는 길이 없다
5. 특수 행동(예고 아님):
   jump(공중): Fal = Fmax × FIGHT.jumpSpike × fat × (rodUp ? 1 : FIGHT.lowRodAbsorb)
               공중 첫 틱에 바늘 빠짐 굴림 p = (rodUp ? HOOK.jumpPumpP × rigStats.jumpPumpMul + HOOK.jumpLooseP × fight.brain.preTeleLoose : HOOK.jumpLowP) × hookOffMul   (cause 'jump')
               ← 숙이면 HOOK.jumpLowP 뿐이다. 「점프 예고 = 로드 숙이기」가 분명한 정답
   shake    : 상태에 들어간 틱에 한 번 굴림 p = HOOK.shakeP × loose × hookOffMul   (cause 'shake' — 드랙이 버티게 두고 감으면 흔들어도 빠지지 않는다)
              FIGHT.shakePulse 주기마다 FIGHT.shakePulseOn 초 동안 Fal += Fmax × FIGHT.shakeAmp × fat · 펄스 시작마다 FIGHT_SHAKE (연출 · 힘만)
6. 텐션 목표값:
   flowLoad = FIGHT.flowLoadK × |spot.flow|² × dist ;  pumpMul = 1 + FIGHT.pumpTension × rodLift ;  drag = rig.dragKg
   (a) 베일 열림: target = 0. Fal > 0이면 dist += vmax × max(s.sp, FIGHT.minSlipSp) × √fat × DT (풀려 나간다)
   (b) s.along ≥ 0 (예고 중 포함):
       raw = (Fal + (input.primary ? reelBase : 0) + flowLoad) × pumpMul
       raw > drag  → 미끄러짐(slipping): slipT += DT
                     target = (slipT ≤ FIGHT.stickTime && t > FIGHT.hookGrace) ? drag + (raw − drag) × FIGHT.stick : drag      ← 드랙의 정지 마찰(급한 질주의 순간 과부하 — 챔질 직후 FIGHT.hookGrace 동안은 없다)
                     slipSpeed = vmax × max(s.sp, FIGHT.minSlipSp) × √fat × min(1, (raw − drag) / (FIGHT.slipRef × Fmax)) ; dist += slipSpeed × DT
       raw ≤ drag  → 버팀: slipT = 0 ; target = raw
                     gain = input.primary ? reelSpeedMS × clamp01(1 − Fal / reelMaxDragKg) : 0 ; dist −= gain × DT
                     dist −= pumpGain × clamp01(1 − Fal / rodMaxLoadKg)
   (c) s.along < 0 (charge — 이쪽으로 온다): approach = vmax × (−s.along) × s.sp × √fat ; dist −= approach × DT
       takeUp = (input.primary ? reelSpeedMS : 0) + pumpGain / DT                 ← 감으면서 로드를 세우면 여유 줄을 거둔다
       target = takeUp ≥ approach ? (reelBase + flowLoad) × pumpMul : flowLoad × FIGHT.slackFlowFrac
   dist = max(dist, minDist)
   tension += (target − tension) × (1 − exp(−FIGHT.tensionLambda × DT))     ← 보이는 값 = 판정 값
7. 체력: stamina −= (FIGHT.baseDrain + tension / Fmax × (rodUp ? FIGHT.pumpDrain × rigStats.pumpDrainMul : 1)) / E × DT
         kind === 'rest' && 예고 아님 && tension < FIGHT.recoverBelow × Fmax 이면 stamina += FIGHT.recoverRate / E × DT     (0..1)
8. 쓸림: (kind === 'dive' || s.abrades) && 예고 아님 → inCover += (slipping ? FIGHT.coverRate : −FIGHT.coverEscape) × DT, 아니면 inCover −= FIGHT.coverDecay × DT  (0..1)
         ← 「드랙이 버티면(미끄러지지 않으면) 바닥에 박히지 못한다」 — 潛 의 대응(초반에 드랙을 조여 띄운다)이 판정과 맞는다. 클리커 소리 · HUD 「박힘」으로 읽힌다
         inSnag = dist ≥ spot.snag.fromM
         abrasion += (FIGHT.coverAbrasion × inCover × spot.abrasion × brain.abrasionMul + (inSnag ? spot.snag.rate : 0)) × rigStats.lineAbrasionMul × DT   (≤ FIGHT.maxAbrasion)
         lineEffKg = lineKg × (1 − abrasion)
         limitKg = rodUp ? min(lineEffKg, rodMaxLoadKg) : lineEffKg ; limitBy ; limitRatio = tension / limitKg
9. 연출 값: depth · bearing · airborne (§5.3.4)
10. 실패 판정 — 처음 걸린 하나만, 이 순서:
   a. dist ≥ lineM(profile.sets[set].lineM)                    → spoolEmpty (lineLostM = lineM)
   b. rodOverT = (rodUp && tension > rodMaxLoadKg) ? rodOverT + DT : 0 ; rodOverT ≥ FIGHT.rodBreakHold → rodBreak (lineLostM = 0)
      ← 순간 스파이크로는 부러지지 않는다 — 상한을 넘긴 채 FIGHT.rodBreakHold 동안 세우고 있으면 부러진다(그동안 rodStress 경고가 계속 나온다)
   c. tension > lineEffKg                → lineBreak  (lineLostM = round(dist)) — 라인은 즉시(드랙이 지켜 주는 쪽)
   d. 5의 굴림이 맞았으면                  → hookOff (cause 'jump' | 'shake')
   e. 슬랙: tension < slackKg 면 slackTime += DT, 아니면 slackTime = max(0, slackTime − HOOK.slackDecay × DT)
      slackTime > 0 → 위험률 h = HOOK.slackRate × min(slackTime, HOOK.slackCap) × rigStats.slackRateMul × hookOffMul ; rng.chance(h × DT) → hookOff (cause 'slack')
   f. 활동 중(kind ∈ run · shake · turn · jump · charge, 예고 아님) → looseNow = slipping ? 0 : clamp01(1 − tension / (HOOK.tightRef × Fmax × fat))
      h = HOOK.activeRate × (HOOK.looseBase + (1 − HOOK.looseBase) × looseNow) × hookOffMul ; rng.chance(h × DT) → hookOff (cause 'active')
   실패면 FIGHT_END{outcome, cause} 를 내고 {type, lineLostM, durationSec: t, cause, hookSmall} 반환
11. 플래그: canNet = dist ≤ netRangeM && stamina ≤ landStamina · rodStress · lineDanger · inSnag · slipping — 바뀐 것만 NET_READY · ROD_STRESS · LINE_DANGER · SNAG · FIGHT_SLIP
12. stats 갱신(maxTension · 합 · 제곱합 · ticks · runs · jumps · slackTicks · slipTicks) ; t += DT
```

- **로드 파손은 세운 상태에서만**(브리프 §3.4): 숙인 로드는 휘어 버티고 라인이 먼저 끊긴다. 예고: `rodLoadRatio ≥ FIGHT.rodStressAt`(0.85)부터 `rodStress` — 로드 떨림 · 삐걱 · 게이지 경고. 상한을 넘겨도 `FIGHT.rodBreakHold`(0.3초) 안에 숙이면 산다.
- 텐션은 보통 드랙에 묶인다 — **드랙을 라인 강도보다 높이 잠그면 질주 한 번에 끊기고**(b · 과부하), 낮추면 오래 풀려 나가 체력이 천천히 깎이고 장애물 띠(`snag`)나 스풀 끝에 닿는다. 그 사이 「질주 예고에 드랙을 풀고 휴식에 조이고 펌핑」이 이기는 길이다. 라인보다 한참 약한 물고기는 드랙을 높게 둔 채 감기만 해도 잡힌다(현실 그대로) — 드랙의 차이는 라인 강도에 다가가는 물고기(§7.12 M5 대형)에서 난다.
- `input.primary`(릴링)는 펌핑과 동시에 된다. 펌핑은 로드가 선 구간(`pumpGainFrom` 이상)을 세우는 동안만 거리를 벌고, 세운 채 있으면 텐션 ×`pumpMul` · 체력 소모 ×`pumpDrain`만 남는다(세우고 → 숙이며 감는 리듬). 펌핑 이득은 언제나 `rodUp`(파손 위험 · 소모 배율)과 함께 온다.

#### 5.3.3 행동 상태 기계 — `stepBrain` (P2 `fishBrain.js`)

```
예고 중: telegraph.remaining −= DT ; ≤ 0 이면 대기 중인 상태로 enter()
아니면:  behaviorT += DT ; behaviorT ≥ behaviorDur 이면
          next = 가중치 뽑기(brain.states[현재].next)
          next 에 tele 가 있으면 telegraph = {kind: tele종류(next.kind), remaining: tele, total: tele} · fight.brain.preTeleLoose = loose · FIGHT_TELEGRAPH
          없으면 enter(next)
enter(name): behaviorT = 0 ; dur = rng.range(def.dur) × (kind ∈ run·dive ? FIGHT.runFatigueMin + (1 − FIGHT.runFatigueMin) × stamina : 1)
             lateralSign = rng.chance(0.5) ? 1 : −1 ; FIGHT_BEHAVIOR ; run/dive 면 stats.runs++ · jump 면 stats.jumps++ · shake 면 이 틱에 5의 굴림
뜰채 재질주: dist ≤ netRangeM && stamina > landStamina && !netRunUsed && 예고 없음 && 현재 kind ∉ run·dive
            → brain 의 첫 run(없으면 dive) 상태로 — 그 상태에 tele 가 있으면 예고를 거쳐 — 들어간다 · netRunUsed = true. dist > netRangeM + FIGHT.netRunReset 이면 netRunUsed = false
tele 종류: run → 'run' · jump → 'jump' · charge → 'charge' · dive → 'dive'
```

체력이 낮을수록 힘(`fat`)과 질주 길이(`dur` 배율)가 줄어 끌려온다(브리프 §3.4).

#### 5.3.4 연출 값 (sim이 정한다 — view는 읽기만)

- `depth`: 목표 = dive → `depthAt(spot, dist)`(바닥) · jump(예고 · 공중) → 0 · `stamina < FIGHT.tiredStamina` → `FIGHT.tiredDepth` · 그 밖 → `FIGHT.midDepthFrac × depthAt(spot, dist)`. 예고 중이면 `min(목표, FIGHT.teleDepth)`(깊은 자리에서도 예고의 그림자가 보인다). `FIGHT.depthSpeed`(m/s)로 다가간다.
- `airborne`: jump 상태 동안 `sin(π × behaviorT / behaviorDur)`, 그 밖 0. 공중 시작 · 끝에 `FIGHT_JUMP`(leave · land).
- `bearing`: `ω = lateral(kind) × vmax × s.sp × fat / max(dist, FIGHT.bearingMinDist)`(rad/s), `bearing += lateralSign × ω × DT`. 허용 반각 = `lerp(FIGHT.nearArc, fight.halfArc, clamp01(dist / FIGHT.nearDist))`(가까울수록 정면으로 — 물고기가 물가 땅 위에 그려지지 않게), `facing ± 허용 반각` 밖으로 나가려 하면 잘라 붙이고 부호를 뒤집는다. 시작 방위는 언제나 이 범위 안이다(흘림 경계 §5.2 · `halfArc` §5.3.1). `lateral` 기본값: turn 0.8 · run 0.3 · charge 0.2 · 그 밖 0.1(상태 정의의 `lateral`이 있으면 그것). 특성 `spin`은 2배.

### 5.4 입질 모델 · 크기 · 층 (P1)

#### 5.4.1 층

```
layerAt(set, waterDepth, floatDepth):
  set === 'bottom'                                   → {layer:'bottom', baitDepth: waterDepth}
  baitDepth = min(floatDepth, waterDepth)
  waterDepth − baitDepth ≤ LAYER.bottomGapM          → 'bottom'
  baitDepth ≤ max(LAYER.surfaceMaxM, LAYER.surfaceFrac × waterDepth) → 'surface'
  그 밖                                               → 'mid'
depthAt(spot, dist) = spot.depth 꺾은선 보간(끝점 밖은 끝값)
```

#### 5.4.2 가중치와 위험률

```
어종 s (풀의 비판타지 어종)마다:
  c = s.time[밴드 순번] ; weather.dayBandStep > 0 && band ∈ {morning, day} 이면 c = BITE.stepUp[c]   (흐림 · 비는 낮 활동을 한 단계 올린다)
  w_s = pool.w × BITE.timeCoef[c] × BITE.layerFit[min |층 순번 차|] × baitFit(s, bait) × BITE.hookBigger[clamp(hookSize − mouth, 0, 2)] × far
  bait = rig.castBaitId(물속의 미끼) ; far = (spot.farFromM != null && distM ≥ spot.farFromM) ? (pool.farMul ?? 1) : 1   (먼 곳의 어종 — 흘림 · 원투의 보상)
  baitFit = s.baits 안의 순번 i → BITE.baitFit[i] , 없으면 BITE.baitOther          (0이 아니다 — 아무 미끼로도 무언가는 문다)
W = Σ w_s × rigStats.lineBiteMul
rate(/s) = W × weather.biteMul × rigStats.biteRateMul × (drifting ? BITE.driftMul : 1) × (bottomSlip ? BITE.bottomSlipMul : 1) / BITE.t0
평균 대기 = BITE.minWait + 1 / rate        (minWait 이후 지수분포 — 매 틱 p = 1 − exp(−rate·DT))
```

#### 5.4.3 어종 뽑기

```
판타지 섞기: 풀 안의 판타지 어종 중 조건(현재 band ∈ fantasy.bands && weather.current ∈ fantasy.weather)을 만족하는 것들 F
  F가 있으면 rng.chance(BITE.fantasyShare × clamp(baitFit(f), BITE.fantasyBaitFloor, 1)) 이면 F에서 하나(균등) — 위험률은 바꾸지 않는다
  아니면 w_s 비례로 하나
조건 밖의 판타지 어종 확률은 정확히 0. 조건 안에서는 입질의 2.1 ~ 3.5%(§7.12)
```

#### 5.4.4 입질 신호 타임라인

| 세트 | 예신(nibble) | 본신(take) | 챔질 창 |
|---|---|---|---|
| 찌 | 예신 횟수 = `rng.int(...(s.bite?.nibbles ?? SIGNAL.float.nibbles))`. 첫 예신은 `SIGNAL.firstDelay` 범위 뒤. 한 번 = `SIGNAL.float.nibbleDur`초 잠김 · 간격 `SIGNAL.float.gap` 범위. 매번 `BITE_NIBBLE` | `takeStyle = s.bite?.take ?? 'sink'`(붕어는 `'lift'` — 찌올림) · `BITE_TAKE` | `rigStats.hookWindowS`(0.9 + 스킬) · `lift`면 `+ SIGNAL.float.liftWindowAdd`(0.3 — 예신과 방향이 반대인 신호라 늦기 쉽다) |
| 바닥 | 초리 떨림 `SIGNAL.bottom.tremble` 범위 동안, `SIGNAL.bottom.pulse`초마다 `BITE_NIBBLE` | `takeStyle = 'pull'`(로드가 숙여진다 + 방울) · `BITE_TAKE` | `rigStats.hookWindowS`(1.1 + 스킬) |

`signal.strength = clamp01(SIGNAL.baseStrength × rigStats.signalMul)` — 예신 · 본신 모두. 본신의 크기는 1(언제나 분명하다).

#### 5.4.5 크기 — `rollFish(rng, species, pct?)`

```
z = pct 가 있으면 normalInv(clamp(pct, 0.0005, 0.9995)) , 없으면 rng.normal()
z = clamp(z, BITE.zMin, BITE.zMax)                         (−2.5 · 3.3)
lengthCm = round1(exp(mu + sigma × z)) ; weightKg = round3(a × L^b)    (L = 반올림 전 값)
pct = normalCdf(z) ; tier = pct ≥ PRICE.legendPct ? 'legend' : pct ≥ PRICE.trophyPct ? 'trophy' : 'normal'
```
「흥정」 외의 스킬 · 장비는 이 분포를 바꾸지 않는다 — 큰 물고기는 더 자주 무는 것이 아니라 **더 자주 랜딩된다**.

### 5.5 같은 틱의 충돌 해소

| 경우 | 규칙 |
|---|---|
| 뜰채 Space와 같은 틱의 끊김 · 빠짐 | **뜰채가 이긴다** — 직전 틱의 `canNet`(화면에 「Space 뜰채」가 떠 있던 상태)로 판단하고 판정 0 단계에서 끝낸다 |
| 「Space 뜰채」가 뜨기 직전의 Space | 선입력 — `FIGHT.netBufferS`(0.3초) 안에 `canNet`이 되면 그 틱에 뜰채(§5.3.2 0) |
| 세운 로드에 상한을 넘는 순간 스파이크 | 부러지지 않는다 — 상한 초과가 `FIGHT.rodBreakHold`(0.3초) 이어져야 파손. 라인은 즉시 |
| 스풀 끝 · 로드 · 라인 · 바늘이 한 틱에 겹침 | §5.3.2의 10 순서(스풀 > 로드 > 라인 > 바늘) — 잃는 것은 하나의 사유로만 계산 |
| 본신 첫 틱과 Space | 창은 그 틱부터 열려 있다(성공). 본신 직전 `SIGNAL.earlyGrace` 안의 Space도 성공(선입력) |
| 창 마지막 틱과 Space | 성공(창 판정은 `remaining > 0`을 깎기 **전**에 본다) |
| 결과 패널 직전의 Space 연타 | 뜰채 Space → `landing`(0.8초 — 입력 무시) → 결과 패널. 패널은 열린 뒤 `PANEL_INPUT_GRACE`(0.25초 — `ui/UIRoot.js` 상수) 동안 키를 버린다(QUALITY §1) |
| 실패 알림 중 좌클릭 | 버퍼(§5.2) |
| 자정과 이동 · 수면이 겹침 | 시계 점프가 자정을 넘으면 `CLOCK_DAY` → 날씨 → `CLOCK_SKIP` 순서로 한 번씩 |

### 5.6 실패 · 손실 · 복구 규칙 (P4 `applyLoss` — P1이 부른다)

| 사유 | 미끼 | 채비(바늘 + 찌/봉돌) | 라인 | 로드 |
|---|---|---|---|---|
| `early` · `late` (헛챔질 · 늦음) | 잃음(캐스팅 때 이미 소모 — `earlyBaitKeep` 확률(early만)로 **환불**) | — | — | — |
| `hookOff` (바늘 빠짐) | 잃음(`baitKeepOnFail` 확률로 환불) | — | — | — |
| `lineBreak` (라인 끊김) | 잃음(`baitKeepOnFail` 확률로 환불) | 바늘 `lossCost` + 찌 또는 봉돌 `lossCost` 자동 차감 | `lineM −= lineLostM` | — |
| `spoolEmpty` (스풀 바닥) | 잃음 | 차감 | `lineM = 0` | — |
| `rodBreak` (로드 파손) | 잃음 | — (물고기가 털고 간다) | — | 그 로드 1대 사라짐(2·3단계면 `owned −1`) → 그 세트는 **예비 1단계 로드**(`rod_<set>_1`). 드랙이 `0.9 × 새 rodMaxLoadKg`를 넘으면 그 아래 가장 가까운 눈금으로 낮춘다(`LossReport.dragKgAfter` — 예비 로드로 바로 또 부러지지 않게) |

- 미끼는 `applyLoss`의 인자 `baitId`(= `rig.castBaitId`, 물속에 있던 미끼)로 계산한다. 환불도 그 미끼로.
- 돈은 음수가 되지 않는다: `money = max(0, money − cost)` · `LossReport.tackleCost`는 실제로 깎인 액수.
- **예비 스풀**(`applyLoss` 끝 — 모든 사유): 그 세트의 `lineM < CAST.minLineM + CAST.lineReserveM`(30m)이면 `lineId = 'line_1'` · `lineM = 그 릴의 capacityM`(무료 — 1단계 라인은 무한이다). 남아 있던 2·3단계 라인은 버린다. `LossReport.spareSpool = true` · `LINE_REFILLED{cost:0}` · `RIG_RESTORED{spoolReplaced:true}` · 알림 `fail.spareSpool`(「라인을 다 잃었다 — 예비 스풀(나일론 4kg)로 바꾼다」). 그래서 라인 끊김 · 스풀 바닥 뒤에도 **2초 재도전**(§5.2)이 깨지지 않고, 돈이 없어도 라인 때문에 막히지 않는다.
- **막히지 않는다**: 1단계 로드 · 바늘 · 찌 · 봉돌 · 릴은 무한(보유 수 없음). 1단계 라인(`line_1`)은 **집에 도착하면 무료로 가득** 다시 감긴다. 판매상에서는 `pricePerM`로 감고, 감기 패널에는 언제나 `line_1`이 있다. 돈이 `FREE_BAIT.moneyBelow` 미만이고 미끼가 하나도 없으면 하루 1회 지렁이 `FREE_BAIT.count`개(`grantFreeBaitIfNeeded` — 캐스팅 시도 때와 집 도착 때).
- **집 도착 처리 순서**(P3 `travel('home')` — 이 순서 그대로): ① `sellAll({auto:true})` ② 두 세트 중 `lineId === 'line_1'`인 세트를 `refillLine(ctx, set, 'line_1', {free:true})` ③ `grantFreeBaitIfNeeded(ctx)`(판매 뒤의 돈으로 판정) ④ `SAVE_REQUEST{scene}`.
- 실패 알림은 `FAIL{loss}`로 잃은 것을 한 줄로 보인다(「라인 끊김 — 미끼 · 채비 −550원 · 라인 −29m」). 바늘 빠짐에는 원인 한 줄을 붙인다: `cause` 'slack' → 「줄이 느슨했다」 · 'jump' → 「점프 때 로드를 세웠다」 · 'shake' → 「머리를 흔들 때 줄이 느슨했다」 · `hookSmall` → 「바늘이 작다(입이 큰 어종)」(`fail.cause.*` · `fail.hookSmall`).

### 5.7 시간 처리

- **시계는 `step`으로만 간다.** 일시정지 · 패널 · 전환 막 · 포커스 잃음 동안 app은 `step`을 부르지 않는다 → 시계도 멈춘다(「1시간 = 하루」는 플레이 중인 시간이다 — 브리프 §6).
- **시간 건너뛰기는 틱을 빨리 미는 것이 아니라 시각 점프다**(브리프 §8-2): `setClock(ctx, day, tickInDay, reason)`(P3)이 파생 필드를 다시 계산하고 `CLOCK_SKIP`을 낸다. 점프 동안 입질 · 파이팅은 없다(점프는 걷기 모드에서만 불린다).
  - 캠프 `waitNextBand()`: 다음 시간대 시작 시각으로(새벽 04 · 아침 07 · 낮 11 · 저녁 17 · 밤 20).
  - 이동 `travel()`: `+TIME.travelHours`(1시간).
  - 침대 `sleep()`: 지금보다 뒤의 첫 `TIME.wakeHour`(06:00). 자정 전이면 다음 날 06:00, 자정 뒤 06:00 전이면 그날 06:00.
- 파이팅 중에도 시계는 간다(파이팅이 시간대를 넘을 수 있다 — 아무 일도 없다).

### 5.8 일시정지 · 패널 · 포커스

| 상황 | sim `step` | 렌더 | 입력 |
|---|---|---|---|
| 플레이 | 누산기대로 | ○ | InputFrame |
| **아무 패널이나 열림**(채비 · 결과 · 판매 · PC · 캠프 · 지도 · 침대 · 확인 · 일시정지) | **멈춤** | ○ | ui가 키를 받는다. sim 입력은 `NEUTRAL_INPUT`(yaw · pitch는 유지) |
| 전환 막(페이드) | 멈춤 | ○ | 버린다 |
| 포커스 잃음 · 탭 숨김 | 멈춤 + 일시정지 패널 | ○(숨으면 안 돈다) | 눌린 키 전부 놓음 |
| 결과 패널 | 멈춤(`rig.phase === 'result'`) | ○ | ui(Space 어창 · KeyX 방생) |
| 실패 알림 · 배너 · 안내 문구 | **멈추지 않는다**(비차단). 수명은 ui `dt`로 깎고 일시정지 · 패널 동안 멈춘다(§10.3) | ○ | 게임 입력 그대로 |

### 5.9 루프와 렌더 보간 (app — P9)

```
frameDt = min(실제 경과, MAX_FRAME_DT)            // 0.25초 — 탭이 돌아와도 폭주하지 않는다
acc += frameDt ; steps = 0
while (acc ≥ DT && steps < MAX_STEPS_PER_FRAME && !ui.isBlocking() && state.rig.phase !== 'result')   // 8
  sim.step(input.buildFrame()) ; acc −= DT ; steps++       // 봇 모드는 §11.1
if (steps === MAX_STEPS_PER_FRAME || ui.isBlocking() || state.rig.phase === 'result') acc = 0   // 밀린 시간은 버린다 · 한 프레임 안에서 패널이 열리면 남은 틱을 돌리지 않는다
alpha = acc / DT
```

- 보간: `player.prevPos → pos`, `rig.prevBobber → bobber`, `fight.prevDist → dist` · `prevBearing → bearing`을 `alpha`로 `lerp`(각도는 `angleDiff`로). **카메라의 yaw · pitch는 보간하지 않고 app의 마우스 값(가장 최신)을 쓴다**(1인칭 반응성).
- `PLAYER_PLACED` · `CLOCK_SKIP` · `SCENE_CHANGED`를 받은 view는 그 다음 프레임에 보간 없이 새 값으로 붙는다.
- 디버그 `step(n)`은 n틱을 동기로 민 뒤 `alpha = 0`으로 한 번 렌더한다(그 렌더의 레이어 · ui `dt` = `min(n × DT, MAX_FRAME_DT)`). `?fixture` 모드에서는 sim을 밀지 않고 레이어 · ui의 `update`를 `dt = DT`로 n번 부른 뒤 렌더한다(§11.6).

---

## §6 모듈별 공개 API

다른 패키지가 부르는 것만 적는다. 시그니처 · 반환 모양 · 이름은 고정이다. 「W0」은 P0이 웨이브 0에 낼 상태.

### 6.1 core (P0 — W0에 **완성**)

**`core/constants.js`**

```js
export const DT = 1 / 60;
export const TICK_HZ = 60;
export const TICKS_PER_MINUTE = 150;          // 게임 1분
export const TICKS_PER_HOUR = 9000;           // 게임 1시간 = 실제 150초
export const TICKS_PER_DAY = 216000;          // 게임 하루 = 실제 3600초
export const MAX_STEPS_PER_FRAME = 8;
export const MAX_FRAME_DT = 0.25;
export const GAME_ID = 'jay-fishing';
export const GAME_VERSION = '0.1.0';
export const STATE_VERSION = 1;
export const SAVE_VERSION = 1;
export const SAVE_KEY = 'jay-fishing:save';
export const SAVE_BACKUP_KEY = 'jay-fishing:save.bak';   // 접두사 — 백업은 `${SAVE_BACKUP_KEY}.<ms>` 최신 3개 · 목록 `${SAVE_BACKUP_KEY}.index`(§11.5)
export const SETTINGS_KEY = 'jay-fishing:settings';
export const SCENE_IDS = ['home', 'lake', 'coast', 'river'];
export const STAGE_IDS = ['lake', 'coast', 'river'];
export const BAND_IDS = ['dawn', 'morning', 'day', 'evening', 'night'];
export const WEATHER_IDS = ['clear', 'cloudy', 'rain'];
export const LAYER_IDS = ['surface', 'mid', 'bottom'];
export const SET_IDS = ['float', 'bottom'];
export const BAIT_IDS = ['worm', 'paste', 'corn', 'shrimp', 'krill', 'live'];
export const GEAR_SLOTS = ['rod', 'reel', 'line', 'hook', 'float', 'sinker'];
export const SKILL_IDS = ['casting', 'hookset', 'dragSense', 'lineCare', 'pumping', 'knowledge', 'baitCraft', 'netting', 'haggling', 'mastery'];
export const STYLE_IDS = ['heavy', 'runner', 'thrasher', 'jumper', 'diver', 'small'];
export const BEHAVIOR_KINDS = ['run', 'rest', 'turn', 'jump', 'dive', 'shake', 'hold', 'charge'];
export const BODY_TEMPLATES = ['fusiform', 'compressed', 'eel', 'shark', 'benthic'];
export const TIERS = ['normal', 'trophy', 'legend'];
export const FAIL_REASONS = ['lineBreak', 'spoolEmpty', 'rodBreak', 'hookOff', 'early', 'late'];
export const RIG_PHASES = ['idle', 'ready', 'charging', 'casting', 'waiting', 'retrieving', 'bite', 'fighting', 'landing', 'result', 'failed'];
export const INTERACT_KINDS = ['spot', 'npc', 'camp', 'pc', 'bed', 'door'];
export const PANEL_IDS = ['title', 'pause', 'tackle', 'result', 'sell', 'pc', 'camp', 'map', 'bed', 'confirm'];
export const HINT_IDS = ['start', 'stage', 'controls', 'cast', 'bite', 'fight', 'net', 'drift', 'bottomRig', 'holdFull'];
```

**`core/events.js`** — `EV`(§4의 키 → 문자열 전부)와:

```js
export class EventBus {
  on(name, fn)          // → off 함수
  once(name, fn)        // → off 함수
  off(name, fn)
  onAny(fn)             // fn(name, payload) — onAny 리스너가 이름 리스너보다 먼저. → off 함수
  emit(name, payload = {})   // 등록 순서대로 동기 호출. 예외 전파. 시작 시점의 리스너 목록으로 돈다
  clear()
  count()               // 등록된 리스너 수(누수 검사용)
}
```

**`core/rng.js`** — mulberry32. 상태는 `{s}` 순수 객체(게임 상태에 들어간다).

```js
export function seedRng(seed)          // → {s: uint32} (seed 0이면 0x9e3779b9)
export function makeRng(stateObj)      // → Rng — stateObj.s 를 직접 고친다
/** @typedef {Object} Rng
 *  next() → [0,1) · range(a, b) · int(a, b)(양끝 포함) · chance(p) · sign() → ±1
 *  normal() → 표준정규(Box–Muller, 매번 두 개를 뽑아 하나만 쓴다 — 여분 상태 없음)
 *  pick(weights) → 키/ID: Record<string,number> 또는 Array<{id,w}>. 합 ≤ 0 이면 null */
```

**`core/math.js`** — 전부 순수 함수

```js
export function clamp(v, lo, hi) / clamp01(v) / lerp(a, b, t) / invLerp(a, b, v) / smoothstep(e0, e1, x)
export function approach(cur, target, maxDelta) / damp(cur, target, lambda, dt)
export function wrapAngle(a)                 // → (−π, π]
export function angleDiff(from, to)          // → wrapAngle(to − from)
export function lerpAngle(a, b, t)
export function fwdX(yaw) / fwdZ(yaw)        // = −sin yaw · −cos yaw
export function fwd(yaw, len = 1)            // → Vec2
export function yawOf(dx, dz)                // = atan2(−dx, −dz)
export function v2(x, z) / v2add(a, b) / v2sub(a, b) / v2scale(a, k) / v2len(a) / v2dist(a, b) / v2norm(a)
export function piecewise(points, x)         // [[x, y], …] 꺾은선 보간 · 끝점 밖은 끝값
export function shoreZAt(shore, x)           // Vec2[] 해안선(x 오름차순) 꺾은선의 z · 끝점 밖은 끝값 · 빈 배열이면 +Infinity(실내)
export function pointInConvex(poly, x, z)    // §7.4 방향(신발끈 합 > 0)의 볼록 다각형 · 경계 포함 — 모든 변에서 (b−a)×(p−a) = (bx−ax)(pz−az) − (bz−az)(px−ax) ≥ 0
export function triangleWave(t)              // 주기 1: 0 → 1(t=0.5) → 0
export function round1(v) / round3(v)
```

**`core/stats.js`**

```js
export const Z05 = -1.6448536, Z999 = 3.0902323;
export function normalCdf(z)                 // 오차 ≤ 1e-7
export function normalInv(p)                 // Acklam 근사(오차 ≤ 1e-8)
export function sizeModelFromRange(lenCm, kg)  // → {mu, sigma, a, b} (§7.3.4 식)
export function mean(a) / variance(a) / median(a) / quantile(a, q)
```

**`core/inputFrame.js`**: `NEUTRAL_INPUT`(동결) · `makeInput(partial = {})` → 새 InputFrame.

**`core/hash.js`**: `stableStringify(obj)`(키 정렬) · `fnv1a(str)` → 8자리 16진 · `hashState(state)`(`events` · `debug`를 뺀 상태의 해시) · `hash32(...ints)` → uint32(날씨용 정수 해시).

### 6.2 data 레지스트리 (P0 — **완성**)

```js
// data/species/index.js
export const SPECIES;                    // SpeciesDef[] — lake 12 · coast 12 · river 12 순서
export const SPECIES_BY_ID;              // Record<SpeciesId, SpeciesDef>
export function getSpecies(id)           // 없으면 throw(데이터 오류 — 테스트가 잡는다)
export function speciesOfStage(stageId)  // SpeciesDef[]
// data/species/derive.js
export function deriveSpecies(row)       // SpeciesRow → SpeciesDef (§7.3.4)
// data/stages/index.js
export const STAGES;                     // StageDef[] — home · lake · coast · river
export const STAGES_BY_ID;
export function getStage(id)
export const SPOTS_BY_ID;                // Record<SpotId, SpotDef>
export function getSpot(id)
export function stageOfSpot(spotId)      // → StageId
// view/stages/index.js
export const STAGE_PROPS;                // {home: buildHomeProps, lake: buildLakeProps, coast: buildCoastProps, river: buildRiverProps}
```

### 6.3 `sim/GameSim.js` (P3)

```js
export class GameSim {
  /** @param {{bus:EventBus, seed:number, save?:SaveData|null, profile?:Profile,
   *           session?:{ignoreGates?:boolean, devSession?:boolean},
   *           start?:{scene?:SceneId, spotId?:SpotId, hour?:number, weather?:WeatherId}}} opts */
  constructor(opts)       // 이벤트를 내지 않는다(레이어가 아직 없을 수 있다)
  state                   // GameState
  ctx                     // SimCtx (테스트 · 봇이 읽는다)
  start()                 // SCENE_CHANGED{reason:'start'|'load'} · PLAYER_PLACED{spawn} · WEATHER_CHANGED 를 내고 플러시. start.spotId 면 그 자리에서 낚시 모드
  step(input)             // §5.1

  // 월드 · 시간 — 걷기 모드에서만(낚시 중이면 {ok:false, reason:'busy'})
  travel(sceneId)         // 집에서는 세 스테이지, 야외에서는 'home'만(스테이지끼리는 집을 거친다 — 그 밖 {reason:'notHere'}). 잠김 {reason:'locked', params:{n}} · 같은 씬 {reason:'same'}.
                          //   시계 +TIME.travelHours · 씬 교체 · ctx.stage · spawn 배치. 집 도착은 §5.6의 순서(자동 판매 → line_1 무료 감기 → 무료 미끼 → SAVE_REQUEST{scene})
  waitNextBand()          // 야외만. 다음 시간대 시작으로
  sleep()                 // 집만. 다음 06:00 · SAVE_REQUEST{sleep}

  // 낚시 모드 전용
  exitFishing()           // §5.2 (걷기 모드면 {ok:false, reason:'notHere'})
  keepCatch(opts = {})    // result 단계만. 어창이 차 있으면 opts.swapUid(어창 물고기 uid)가 있어야 한다 — 그것을 빼고(CATCH_RELEASED{catch: 뺀 것, swapped:true} · 경험치 · 도감 변화 없음) 새 것을 넣는다. 없으면 {reason:'holdFull'}
  releaseCatch()          // result 단계만

  sellAll() · sellOne(uid)              // 판매상(야외)과 집 PC 어디서나 — 위치 검사는 ui가 패널로 한다
  buy(itemId, qty = 1)                  // 장비 · 미끼 팩(itemId = 'bait_<id>')
  refillLine(set, lineId = 현재 라인)   // 판매상 · PC. 집이면 line_1 무료
  equip(set, slot, itemId)              // ready/idle 에서만 — 그 밖 {reason:'busy'}. 릴을 바꾸면 드랙 kg 을 보존하는 눈금으로 옮긴다(§7.7)
  setBait(set, baitId)                  // 언제나 — 다음 캐스팅부터(물속의 미끼는 rig.castBaitId 그대로) · SAVE_REQUEST{tackle}
  setDepth(depthM)                      // 찌 세트 수심 — §5.2의 depthSteps 와 같은 단계 규칙(bite · fighting · landing · result 면 {reason:'busy'}) · SAVE_REQUEST{tackle}
  learnSkill(skillId)
  markHintSeen(hintId)                  // profile.flags.hints[id] = true · SAVE_REQUEST{hint}
  newGame(seed)                         // 처음 상태로 되돌린다(아래)

  // 조회 — 상태를 바꾸지 않는다
  getRigStats(set = rig.set)            // → RigStats
  getShop()                             // → ShopItem[] (장비 · 미끼 팩 · 라인 감기)
  getSellQuote()                        // → {items: Array<{uid, price}>, total} (흥정 반영)
  getDex(stageId)                       // → DexCard[]
  getForecast()                         // → {today, tomorrow, activeByBand: Record<StageId, Record<BandId, SpeciesId[]>>} (활동 계수 H 어종 — 어종 지식 1 이상만 채운다)
  getTravel()                           // → Array<{id:SceneId, ok:boolean, reason:string|null, reasonParams:Object|null, unlockLevel:number, weather:WeatherId|null}> — 집에서는 세 스테이지, 야외에서는 [home] 하나
  previewEquip(set, slot, itemId)       // → {before:RigStats, after:RigStats}
  previewSkill(skillId)                 // → SkillPreview
  biteInfo()                            // → {rate, meanWait, entries:Array<{speciesId, w}>} | null (waiting 아닐 때) — 측정 · 디버그용. ui는 쓰지 않는다
  hash()                                // → hashState(state)

  // 디버그(디버그 API · 테스트 전용)
  debugSetTime(hour) · debugSetWeather(weatherId) · debugGotoScene(sceneId) · debugGotoSpot(spotId)
  debugForceBite(speciesId, pct) · debugForceFight(speciesId, pct) · debugGrant({money, xp}) · debugSetGear(slot, itemId, set = rig.set)
  debugSkipToResult(speciesId = 'crucian', pct = 0.5) · debugNoBites(on)
  debugLoadState(stateObj)              // ?fixture 전용: state 의 필드를 제자리에서 덮어쓴다(같은 객체) · ctx.stage/spot/mods/rigStats 를 다시 계산(syncRig 는 부르지 않는다 — 고정 상태 값 그대로) · 이벤트를 내지 않는다
}
```

- `newGame(seed)`: `state.seed = seed` · `state.rng = seedRng(seed)` · profile 내용을 새 프로필로 갈아 끼우기(같은 객체) · `rig = createRigState(profile)` · `fight = null` · `pendingCatch = null` · player = 걷기 · 집 spawn · clock = 1일 `TIME.startHour` · `refreshWeather` · `ctx.stage = home` · `ctx.spot = null` · `ctx.refresh()` → `SCENE_CHANGED{from, to:'home', reason:'new'}` · `PLAYER_PLACED{reason:'spawn'}` · `WEATHER_CHANGED` · `SAVE_REQUEST{new}`. 파이팅 중에 「타이틀로 → 새 게임」을 해도 남는 것이 없다.
- `debugForceFight(speciesId, pct)`: 낚시 모드(아니면 그 씬의 첫 자리로 먼저 `enterSpot`)에서 입질 · 챔질을 건너뛰고 `rig.dist = 0.6 × castMaxM`(착수 처리 그대로 — bobber · 층) · `castBaitId` = 지금 미끼 → `HOOK_SET` → `createFight` → `fighting`(P1 `forceFight`).
- `debugSkipToResult`: 낚시 모드가 아니면 먼저 그 씬의 첫 자리(집이면 `debugGotoSpot('lake_gravel')`)로 `enterSpot` 한 뒤 result로(P1 `skipToResult`) — `CatchRecord.stageId` · `spotId`가 비지 않는다.

- 생성: `save`가 있으면 `sanitizeProfile(save.profile)` · 시계 · 씬을 쓰고 플레이어는 그 씬의 `spawn`(걷기 모드). 없으면 `profile ?? createNewProfile()` · 1일 `TIME.startHour` · `home`. `start.scene` · `start.hour` · `start.weather`는 개발 쿼리(§11.6). 생성 끝에 `ctx.refresh()`.
- `debugGotoScene` · `debugGotoSpot`은 레벨 게이트를 무시한다. `debugSetGear`는 보유 수를 무시하고 끼운다(일회용 세션 전용).

### 6.4 `sim/clock.js` · `weather.js` · `world.js` (P3)

```js
// clock.js — 앞의 여섯은 순수 함수(view · ui · audio가 써도 된다)
export function hourOf(tickInDay)                    // → 0 ≤ h < 24
export function bandOf(hour)                         // → BandId
export function bandStartTick(band)                  // → tickInDay
export function sunAt(hour, weatherLight = 1)        // → {sunElev, sunAzim, light, night}
export function deriveClock(day, tickInDay, weatherId)   // → ClockState
export function formatClock(clock)                   // → 'HH:MM'
export function advanceClock(ctx, ticks)             // step 전용
export function setClock(ctx, day, tickInDay, reason)    // 점프 — CLOCK_DAY · WEATHER_CHANGED · CLOCK_BAND · CLOCK_SKIP
export function nextBandStart(day, tickInDay)        // → {day, tickInDay}
export function nextWake(day, tickInDay)             // → {day, tickInDay}
// weather.js
export function weatherFor(seed, day, stageId)       // → WeatherId (순수 — hash32(seed, day, 스테이지 순번))
export function refreshWeather(ctx)                  // today · tomorrow · current · env 갱신
// world.js — fishing/* 을 import 하지 않는다(§2.2)
export function updateWalk(ctx, input)               // → {enterSpotId: SpotId|null} — 자리 진입은 직접 하지 않고 돌려준다(GameSim.step 이 enterSpot 을 부른다)
export function findNearby(state, stage)             // → InteractTarget|null
export function placePlayer(ctx, pos, yaw, pitch, reason)   // PLAYER_PLACED — P1(enterSpot · exitSpot)도 이것으로 배치한다
export function updateEnv(ctx)
```

### 6.5 `sim/fishing/*` (P1)

```js
// rig.js
export function createRigState(profile)              // → RigState (phase 'idle', set 'float') — 드랙 · 수심 필드는 profile.sets.float 에서
export function syncRig(ctx)                         // rig 파생 필드를 맞춘다: dragNotches = rigStats.dragNotches · dragNotch = clamp(profile.sets[rig.set].dragNotch, 0, dragNotches)
                                                     //   · dragKg = dragNotch × rigStats.dragNotchKg · floatDepth = profile.sets.float.depthM. ctx.refresh() 가 끝에서 부른다(§3.8)
export function enterSpot(ctx, spotId)               // → Result. 걷기 → 낚시 · ctx.spot · placePlayer(PLAYER_PLACED{spot}) · ready · FISHING_ENTER
export function exitSpot(ctx)                        // → Result (§5.2)
export function updateRig(ctx, input)                // §5.2
export function keepCatch(ctx, opts = {}) / releaseCatch(ctx)   // → Result — applyCatch(P4) · CATCH_KEPT|RELEASED · SAVE_REQUEST{catch} · ready. opts.swapUid 는 §6.3
export function setFloatDepth(ctx, depthM)           // → Result (§5.2 의 depthSteps 단계 규칙)
export function forceBite(ctx, speciesId, pct)       // 디버그: ready면 즉시 착수(최대 비거리 0.8) → bite / waiting이면 바로 bite
export function forceFight(ctx, speciesId, pct)      // 디버그: 입질 · 챔질을 건너뛰고 fighting(§6.3 debugForceFight)
export function skipToResult(ctx, speciesId, pct)    // 디버그: result로(pendingCatch 생성 · CATCH_RESULT). 낚시 모드가 아니면 GameSim 이 먼저 자리에 세운다(§6.3)
export const fightImpl = { createFight, updateFight }  // rig는 파이팅을 이 객체로만 부른다 — W1 테스트가 P2를 기다리지 않고 바꿔 끼운다(P1 rig.test)
// biteModel.js — 전부 순수(ctx 없이)
export function depthAt(spot, distM)
export function layerAt(set, waterDepth, floatDepth) // → {layer, baitDepth}
export function biteWeights({spot, band, weather, layer, baitId, rigStats, distM = 0})   // → {entries:Array<{speciesId, w}>, total, fantasy:SpeciesId[]} — distM 은 farMul(§5.4.2)
export function biteRate(weights, {weather, rigStats, drifting, bottomSlip})  // → /s
export function meanWait(rate)                       // → BITE.minWait + 1/rate (rate 0이면 Infinity)
export function pickSpecies(rng, weights, baitId)    // → SpeciesId (§5.4.3)
// catch.js
export function rollFish(rng, species, pct)          // → FishRoll (pct 생략 시 난수)
export function tierOf(pct)                          // → Tier
```

### 6.6 `sim/fight/*` (P2)

```js
// fight.js
export function fightConstants(species, roll)        // → {Fmax, vmax, endurance, reelBase} (§5.3.1)
export function createFight(ctx, {speciesId, roll, dist, bearing, depth})   // → FightState
export function updateFight(ctx, input)              // → FightOutcome|null (§5.3.2)
// fishBrain.js
export function buildBrain(species)                  // → {start, states:Record<string, BehaviorStateDef>, abrasionMul, visual:string[]} (어종 ID별 캐시 · 순수)
export function stepBrain(fight, brain, rng, dt, ctx, loose)   // loose = §5.3.2 1의 값(예고에 들어갈 때 fight.brain.preTeleLoose 로 저장)
```

### 6.7 `sim/progression/*` (P4)

```js
// profile.js
export function createNewProfile()                   // → Profile (§7.9 START)
export function sanitizeProfile(raw)                 // → Profile. 던지지 않는다: 모르는 키 제거 · 숫자 범위 자르기 · 없는 장비/미끼/어종 ID 제거(세트 슬롯은 1단계로) · 어창 ≤ capacity · level/xp 정합 · 돈 ≥ 0
export function makeDevProfile({level, money})       // → Profile — level이면 그 레벨 · skillPoints = level(누적 지급분) · xp 0
// modifiers.js — 순수(view · ui도 써도 된다)
export function computeModifiers(profile)            // → Modifiers
export function rigStats(profile, set, mods)         // → RigStats
export function isOwned(profile, gearId)             // 1단계는 언제나 true
export function availableCount(profile, gearId, exceptSet) // 보유 − 다른 세트가 끼운 수 (1단계 Infinity)
// economy.js
export function fishPrice(species, weightKg, tier)   // → round(pricePerKg × weightKg × priceMul[tier])
export function sellPrice(record, mods)              // → round(record.price × mods.sellMul)
export function sellAll(ctx, {auto = false} = {})    // → Result{count, total} · MONEY_CHANGED · SOLD · SAVE_REQUEST{sell}
export function sellOne(ctx, uid)                    // → Result{total} — hold 에 없는 uid 는 {reason:'invalid'}
export function shopList(profile, mods)              // → ShopItem[] (§3.6 — 라인 감기는 세트 × 라인마다 한 항목)
export function buy(ctx, itemId, qty = 1)            // → Result{cost} — qty 는 정수 1..99(아니면 {reason:'invalid'} · 돈 불변) · 돈 · 레벨 · 숙련 검사 · BOUGHT · MONEY_CHANGED · SAVE_REQUEST{buy}
export function refillLine(ctx, set, lineId, {free = false} = {})   // → Result{cost, meters}
export function equip(ctx, set, slot, itemId)        // → Result — 슬롯 · 세트 · 보유 검사 · (릴이면 드랙 kg 보존 눈금 — §7.7) · EQUIPPED · ctx.refresh() · SAVE_REQUEST{equip}
export function setBait(ctx, set, baitId)            // → Result · SAVE_REQUEST{tackle}
export function applyLoss(ctx, set, reason, {lineLostM = 0, baitId, cause = null, hookSmall = false} = {})   // → LossReport (§5.6 — 예비 스풀 · 로드 파손 드랙 낮추기 포함) · 끝에 ctx.refresh()
export function grantFreeBaitIfNeeded(ctx)           // → {granted:number}
export function previewEquip(profile, set, slot, itemId, mods)  // → {before, after}
// progress.js
export function xpToNext(level)                      // → round(XP.base × level ^ XP.exp), 캡이면 Infinity(sim 내부 비교용 — 이벤트에는 null)
export function addXp(ctx, amount, source)           // → {levelsGained} · XP_GAINED · LEVEL_UP(레벨마다 — unlocks §4.2)
export function evaluateCatch(ctx, roll, fightSec)   // → CatchRecord (상태를 바꾸지 않는다 · uid만 미리 본다)
export function applyCatch(ctx, record, kept, {swapUid} = {})   // → Result{xp} — 도감 · 경험치 · (kept면) 어창(swapUid 면 그 물고기를 빼고) · nextUid++ · RECORD · stats
export function applyCatchToProfile(profile, record, kept)      // 순수 — applyCatch 와 createSaveData 가 같이 쓰는 프로필 변경(이벤트 없음)
export function learnSkill(ctx, skillId)             // → Result{rank} · SKILL_LEARNED · ctx.refresh() · SAVE_REQUEST{skill}
export function previewSkill(profile, skillId)       // → SkillPreview
export function stageUnlocked(profile, stageId)      // level ≥ stage.unlockLevel
export function dexView(profile, stageId, mods)      // → DexCard[]
// save.js
export function createSaveData(state, savedAt)       // → SaveData. rig.phase === 'result' 면 pendingCatch 를 반영한 프로필 **사본**을 저장한다
                                                     //   (어창에 자리가 있으면 keep, 없으면 release — applyCatchToProfile). sim 상태는 바꾸지 않는다(결과 패널 중 탭이 닫혀도 물고기를 잃지 않는다)
export function serializeSave(save)                  // → string
export function parseSave(text)                      // → {save:SaveData|null, error:'json'|'game'|'future'|'fields'|null} — 순서: JSON 파싱 → game 일치 → version > SAVE_VERSION 이면 'future'
                                                     //   → version < SAVE_VERSION 이면 migrateSave → 필수 필드 → sanitizeProfile. 던지지 않는다
export function migrateSave(obj)                     // → SaveData|null (v1이 처음 — 미래 버전을 위한 자리)
export function sanitizeSettings(raw)                // → Settings
```

### 6.8 bot (P10)

```js
// bot/policy.js (P2 — W1) — 순수 · 파이팅 한 틱의 손
/** @typedef {'basic'|'controlled'|'mindless'|'locked'} BotStrategy */
export function createFightPolicy(strategy, seed)    // → {decide(state, rigStats) → {primary, secondary, dragSteps, hook}, reset()}
                                                     //   §12.1 의 네 전략. 사람에게 보이는 값만 읽는다(fight.telegraph · behavior · tension · lineEffKg · canNet · inSnag …)
                                                     //   드랙은 BOT.dragEveryTicks 틱에 1눈금까지만 바꾼다(사람의 휠 속도) · 뜰채는 canNet 을 본 뒤 BOT.netReact
// bot/angler.js (P1 — W1) — 자리 봇: 지금 자리에서 캐스팅 · 챔질 · 파이팅 · 뜰채 · 어창/방생을 되풀이한다(걷기 · 이동 · 계획 없음)
export function createAngler({strategy, seed, set = null, baitId = null, depthM = null})
                                                     // → {decide(state, sim) → BotAction, reset()} — sim 에서는 getRigStats() 만 읽는다
                                                     //   ready: 세트 · 미끼 · 수심을 맞추고(명령 setBait · 입력 selectSet/depthSteps) 게이지가 BOT.castPower 를 지날 때 뗀다
                                                     //   bite: 본신을 보고 BOT.react 뒤 Space · BOT.earlyRate 로 성급한 챔질 / fighting: createFightPolicy / result: keepCatch(어창이 차면 가장 싼 것과 swap — 새 것이 더 싸면 releaseCatch)
// bot/bot.js (P10 — W2)
export function createBot(opts)
// opts: {strategy:BotStrategy, seed:number, plan:'lakeDay'|'coastDay'|'riverDay'|'progress'|'stay', spotId?, set?, baitId?}
// → {name, decide(state, sim) → BotAction, reset()} — 자리에서는 createAngler 에 맡기고, 걷기 · 이동 · 판매 · 구매 · 스킬 · 수면만 더한다
// bot/planner.js
export function createPlanner(planId, opts)          // → {next(state, sim) → Goal} — Goal: {kind:'fish'|'sell'|'travel'|'buy'|'skill'|'sleep'|'walkTo', …}
```

- 봇은 **사람과 같은 입력**만 만든다: 매 틱 `InputFrame` 하나 + (있으면) **UI가 부르는 것과 같은 명령** 하나(`BotCommand` — `keepCatch` · `releaseCatch` · `sellAll` · `buy` · `refillLine` · `equip` · `setBait` · `setDepth` · `learnSkill` · `travel` · `waitNextBand` · `sleep` · `exitFishing`만. `debug*` 금지). 명령은 사람이 그 패널을 열 수 있는 상황(그 상호작용 대상 앞 · 결과 단계 · 채비 패널을 열 수 있는 단계)에서만 낸다.
- 봇을 돌리는 쪽(app §11.1 · 헤드리스 러너 §12.4)의 규칙은 같다: 틱마다 `a = bot.decide(state, sim)` → `a.command`가 있으면 **step 전에** 실행 → `rig.phase === 'result'`면 그 틱은 step 하지 않는다(결과 단계는 명령으로만 풀린다 — 브라우저의 패널 정지와 같은 시간 모델) · 아니면 `sim.step(a.input)`.
- 봇은 상태와 데이터 표, GameSim의 조회 메서드(`getShop` · `getRigStats` · `getTravel`)를 읽는다. `rig.bite` · `fight.speciesId` · `fight.stamina`(어종 지식 3 전) · `biteInfo()`처럼 **사람에게 보이지 않는 값은 읽지 않는다**(§12.1).

### 6.9 view (P5 · P6 · P7)

```js
// view/renderer.js (P5)
export function createRenderContext(canvas, settings)   // → RenderContext. WebGL을 못 만들면 throw(app이 받아 안내)
/** @typedef {Object} RenderContext
 * @property {THREE.WebGLRenderer} renderer   sRGB 출력 · ACESFilmic · PCF 그림자 · 픽셀 비율 ≤ QUALITY[q].pixelRatio(≤ 2)
 * @property {THREE.Scene} scene
 * @property {THREE.PerspectiveCamera} camera  fov = settings.fov · near 0.05 · far 2500
 * @property {'low'|'medium'|'high'} quality
 * @property {(q)=>void} setQuality
 * @property {()=>void} render
 * @property {()=>void} prewarm               지금 장면의 셰이더를 미리 컴파일(전환 막 아래에서 app이 부른다)
 * @property {()=>void} dispose
 */                                             // 캔버스 크기의 주인은 렌더러다 — window resize 를 스스로 구독
// view/CameraRig.js (P5)
export class CameraRig {
  constructor({camera, settings, world})
  update(state, alpha, dt, look)   // look = {yaw, pitch} (app의 최신 값)
  dispose()
}
// view/WorldLayer.js (P5)
export class WorldLayer {
  constructor({rc, bus, settings})  // 네 씬을 부팅 때 전부 만들어 둔다(visible만 바꾼다)
  update(state, alpha, dt)
  heightAt(x, z)                    // → 지면 y(m). 물 위면 수면 아래 바닥 높이(음수). 집은 0
  dispose()
}
// view/tackle/TackleLayer.js (P6)
export class TackleLayer { constructor({rc, bus, settings, world}) · update(state, alpha, dt) · dispose() }
// view/fish/FishLayer.js (P6)
export class FishLayer { constructor({rc, bus, settings, world}) · update(state, alpha, dt) · dispose() }
// view/fish/fishModel.js (P6)
export function buildFishModel(species, lengthM, opts = {})   // → THREE.Group. opts: {silhouette?:boolean, lod?:0|1}. 머리 −Z · 원점 = 몸 중심 · Z 길이 = lengthM
export function disposeFishModel(group)
// view/fish/FishPreview.js (P6)
export class FishPreview {
  constructor()                     // WebGL은 첫 show 때 만든다(실패하면 canvas는 빈 채 · ok=false)
  canvas                            // HTMLCanvasElement — ui가 패널 안에 옮겨 붙인다
  ok                                // boolean
  show(speciesId, lengthCm, {silhouette = false, spin = true} = {})
  hide()
  render(dt)                        // ui가 보일 때 매 프레임
  snapshot(speciesId, lengthCm, {silhouette = false, size = 160} = {})   // → string(dataURL, (speciesId · silhouette)별 캐시) — 도감 카드의 정지 이미지. ok 가 false 면 ''
  dispose()
}                                   // WebGL 컨텍스트는 이것 하나 — 도감 카드 12장은 snapshot 이미지, 포커스된 카드만 회전 캔버스(§10.2)
// view/fx/FxLayer.js (P7)
export class FxLayer { constructor({rc, bus, settings, world}) · update(state, alpha, dt) · dispose() · stats() → {particles, meshes} }
// view/stages/<id>Props.js (P5 · P11 · P12)
export function buildLakeProps(args)   // args·반환은 §9.4 (buildHomeProps · buildCoastProps · buildRiverProps 같은 모양)
```

### 6.10 audio (P7)

```js
export class AudioEngine {
  constructor({bus, settings})     // AudioContext 를 만들지 않는다
  unlock()                         // 첫 사용자 제스처(키 · 클릭)에서 app이 부른다 — 여기서 만든다. 그 전의 모든 호출은 조용히 무시
  update(state, dt)                // 지속음(텐션 톤 · 클리커 · 릴 · 환경음)
  setPaused(on)                    // 탭 숨김 · 일시정지 — suspend/resume
  applySettings()                  // settings.volume 다시 읽기
  stats()                          // → {nodes, voices}
  dispose()
}
```

### 6.11 ui (P8)

```js
export class UIRoot {
  constructor({root, bus, sim, settings, actions, fishPreview})
  update(state, dt)
  openPanel(id, args = {})         // 패널 스택(§10.4): pause · confirm 은 위에 겹치고, 그 밖은 맨 위를 교체 · title 은 스택을 비우고 연다
  closePanel(by = 'code')          // 맨 위 하나를 닫는다(아래 패널이 같은 args 로 다시 보인다 — PANEL_INPUT_GRACE 다시). by: 'esc'|'tab'|'confirm'|'pointer'|'code' → PANEL_CLOSED
  get activePanel()                // 맨 위 PanelId | null
  get panelDepth()                 // 스택 깊이 0..3
  isBlocking()                     // 스택이 비어 있지 않거나 전환 막이 있으면 true (app이 sim을 멈춘다)
  setAutoPanels(on)                // false 면 INTERACT · CATCH_RESULT 가 패널을 열지 않는다(봇 모드 — §11.1). 기본 true
  handleKey(e)                     // KeyboardEvent → 처리했으면 true(게임 입력으로 새지 않는다)
  fade(on, dur)                    // → Promise (실제 시간 — setTimeout)
  toast(key, params = {})
  showFatal(titleKey, bodyKey)
  setTitleNotes(keys)
  dispose()
}
// actions(app이 준다): {newGame(), continueGame(), resume(), quitToTitle(), applySettings(partial),
//                       travel(sceneId), waitNextBand(), sleep(), requestPointerLock()}
//   requestPointerLock 은 pointerdown · click · Enter/Space keydown 처리기 안에서만 부른다(§11.3)
// ui/i18n.js
export function t(key, params = {})   // {name} 치환. 없는 키는 개발 중 콘솔 경고 + 키를 그대로 — 테스트가 막는다
export function has(key)
// ui/hud.js — UIRoot 내부(다른 패키지는 import하지 않는다)
```

### 6.12 app (P9) · `bootMarker` (P0)

```js
// app/bootMarker.js (P0 완성 — 고치지 않는다)
export function markReady()            // document.documentElement.dataset.gameReady = '1' (한 번만)
export function markError(reason)      // dataset.gameError = String(reason).slice(0, 200)
// app/Game.js
export class Game { constructor(doc) · start() → Promise<void> · dispose() }
// app/query.js — 순수
export function parseQuery(search)     // → DevQuery (§11.6)
// app/input.js
export class InputCollector {
  constructor({canvas, settings, bus})
  buildFrame()                         // → InputFrame (이번 틱. 에지는 한 번만 나간다)
  get look()                           // {yaw, pitch}
  setLook(yaw, pitch)                  // PLAYER_PLACED 에서
  releaseAll()                         // 홀드 · 에지 · 휠 누적 비움
  setCapture(on)                       // 패널이 열리면 false — 에지를 버리고 홀드 상태만 추적
  setMode(mode)                        // 'walk'|'fish' — app 이 매 프레임 state.player.mode 로. 낚시 모드면 KeyA/KeyD 가 look.yaw 를 돌린다(§11.3)
  tick(dt)                             // 프레임마다 — 키 시선 회전(MOUSE.keyYawRate) 적용
  get pointerLocked()
  dispose()
}
export function frameFromState(keys, edges, look, wheelSteps, bindings)   // → InputFrame (순수 — 테스트)
// app/storage.js
export function canPersist() · loadSave() → {save, broken, future, raw} · writeSave(save) → boolean · backupSave(raw?) → boolean   // 백업은 §11.5 (최신 3개)
export function clearSave() · loadSettings() → Settings · writeSettings(settings) → boolean   // writeSettings 는 쿼리 덮어쓰기를 뺀 persisted 만 쓴다(§11.5)
// app/debugApi.js
export function installDebugApi(win, game)   // → window.__game (§11.7)
```

### 6.13 `test/helpers.js` (P0 완성 — W1 테스트가 서로를 기다리지 않게)

```js
export function makeTestProfile(overrides = {})    // §7.9 START 리터럴(createNewProfile을 부르지 않는다) + 얕은 덮어쓰기
export function makeTestRigStats(set = 'bottom', overrides = {})   // 1단계 기본 장비 · 스킬 0의 RigStats 리터럴(§7.6 · §7.7 값)
export function makeTestMods(overrides = {})       // 스킬 0의 Modifiers 리터럴
export function makeTestState(opts = {})           // → GameState. opts: {scene='lake', spotId=null, mode='walk', set='bottom', seed=1, hour=8, weather='clear'}
                                                   //   spotId가 있으면 player가 그 자리 · mode 'fish' · rig.phase 'ready' · origin = stand
export function makeTestCtx(state, opts = {})      // → SimCtx + {events: []} — emit은 state.events 와 ctx.events 둘 다에. stage/spot 채움 ·
                                                   //   mods = computeModifiers(profile) · rigStats = rigStats(profile, rig.set, mods) ·
                                                   //   refresh = 그 둘을 다시 계산 + syncRig(ctx)(§3.8 그대로 — opts.refresh 로 바꿀 수 있다)
export function runTicks(n, fn)
export function countEvents(events, name)
export function assertFiniteDeep(obj, path = 'state')   // NaN · Infinity 를 경로와 함께 실패
export function randomInputs(seed)                 // → (tick) => InputFrame (결정성 테스트용 무작위 입력열)
```

### 6.14 스텁 값 (P0이 W0에 쓰는 스텁의 동작)

**던지지 않고 유효한 모양의 값을 돌려준다.** 아래에 없는 export는 no-op / `null` / `[]` / `0`.

| 모듈 | 스텁 동작 |
|---|---|
| `sim/GameSim.js` | 생성자가 §3.4 모양의 상태 전부를 만든다(프로필 = `createNewProfile()`, 씬 `home` 또는 `start.scene`, 시계 = `deriveClock`). `start()`는 `SCENE_CHANGED` · `PLAYER_PLACED`를 낸다. `step`은 `tick += 1` · prev 복사 · `advanceClock` · 시선 복사 · 걷기 모드면 `updateWalk`만(스텁이면 아무것도 안 한다). 명령은 `{ok:false, reason:'stub'}`, `debugGotoScene`은 `scene`만 바꾸고 `SCENE_CHANGED`. 조회는 빈 값(`getShop` `[]` · `getRigStats` = `rigStats` 결과). `debugLoadState`는 **완성**(§6.3 — `?fixture`가 W1에 쓴다). 플러시는 §4.1 그대로 |
| `sim/clock.js` | **P0이 완성해서 낸다**(최소 부트가 하늘을 그리려면 필요 — 그 뒤 소유 P3) — `hourOf` · `bandOf` · `sunAt` · `deriveClock` · `formatClock` · `advanceClock`(이벤트 포함) |
| `sim/weather.js` · `sim/world.js` | `weatherFor` → `'clear'` · `refreshWeather` → 전부 clear · `findNearby` → null · 나머지 no-op |
| `sim/fishing/rig.js` | `createRigState` = §3.4 전 필드(phase `'idle'`, `signal.kind 'none'`, `hookWindow {open:false, remaining:0, total:0}`, `dragNotches 20`, `dragNotch 5`, `castBaitId null`, `pendingSet null`). `syncRig` = §6.5 식(**완성** — 네 줄). `enterSpot`은 phase `ready` · mode `fish`만. `updateRig` no-op. 명령 `{ok:false, reason:'stub'}` |
| `sim/fishing/biteModel.js` | `depthAt` = 프로필 보간(완성) · `layerAt` = §5.4.1(완성) · `biteWeights` = `{entries:[], total:0, fantasy:[]}` · `biteRate` 0 · `meanWait` Infinity · `pickSpecies` null |
| `sim/fishing/catch.js` | `rollFish` = 중앙값 물고기(z 0) · `tierOf` = §5.4.5(완성) |
| `sim/fight/*` | `fightConstants` = §5.3.1 식(완성) · `createFight` = §3.4 전 필드 · `updateFight` = null · `buildBrain` = 성격 표 그대로 · `stepBrain` no-op |
| `sim/progression/profile.js` | `createNewProfile` = §7.9 그대로(**완성**) · `sanitizeProfile` = 인자 그대로(없으면 새 프로필) · `makeDevProfile` = 새 프로필에 level · money |
| `sim/progression/modifiers.js` | `computeModifiers` = 스킬 0의 값(§7.7 0단계) · `rigStats` = §3.6 식대로 장비 표에서 계산(**완성** — 스텁 상태의 HUD · 테스트가 쓴다) · `isOwned` = 1단계면 true |
| `sim/progression/economy.js` | `fishPrice` = 식대로(완성) · 명령 `{ok:false, reason:'stub'}` · `applyLoss` = `{reason, set, baitId, baitLost:true, tackleCost:0, lineLostM:0, rodLost:null, spareSpool:false, dragKgAfter:null, cause, hookSmall, moneyBefore, moneyAfter}`(상태 변화 없음) · `grantFreeBaitIfNeeded` = `{granted:0}` · `shopList` `[]` |
| `sim/progression/progress.js` | `xpToNext` = 식대로(완성) · `evaluateCatch` = 필드를 채운 레코드(price 식대로 · xp 0) · `applyCatch` = `{ok:true, xp:0}`(상태 변화 없음 — P1의 흐름이 W1에서 막히지 않게) · `applyCatchToProfile` no-op · `addXp` = `{levelsGained:0}` · 나머지 `{ok:false, reason:'stub'}` · `dexView` = 그 스테이지 어종마다 `caught:false` 카드 |
| `sim/progression/save.js` | `createSaveData` = §3.7 모양 · `serializeSave` = `JSON.stringify` · `parseSave` = `{save:null, error:'stub'}` · `sanitizeSettings` = `{...DEFAULT_SETTINGS, ...raw}` |
| `bot/*` | `createBot` · `createAngler` = `{name:'stub', decide: () => ({input: NEUTRAL_INPUT, command: null}), reset() {}}` · `createFightPolicy` = `{decide: () => ({primary:false, secondary:false, dragSteps:0, hook:false}), reset() {}}` |
| `debug/fixtures.js` | **완성**(스텁 아님 — §11.6의 고정 상태 전부) |
| `view/renderer.js` | 실제 `WebGLRenderer` · `Scene` · `PerspectiveCamera`를 만들고 `render`가 그린다(후처리 없음 · resize 구독). `prewarm` no-op |
| `view/CameraRig.js` | 카메라를 `player.pos` 보간 + (0, 1.65, 0)에 두고 look을 적용 |
| `view/WorldLayer.js` | 자리 표시: 하늘색 배경(`clock.light`로 밝기) · 방향광 · 야외는 땅 평면(+Z) · 물 평면(−Z, y 0) · 해안선 띠 · 자리 표식 원 · NPC/캠프 자리의 기둥 · 집은 방 상자. `heightAt` → 0 |
| `view/tackle/*` · `view/fish/*` · `view/fx/*` | 클래스는 시그니처대로 no-op. `buildFishModel` = 상자 하나(길이 lengthM). `FishPreview.ok = false` · `snapshot` → `''` |
| `view/stages/*Props.js` | `{group: new THREE.Group(), update() {}, setQuality() {}, dispose() {}}` |
| `audio/AudioEngine.js` | 전부 no-op · `stats()` → `{nodes:0, voices:0}` |
| `ui/UIRoot.js` | 최소 HUD 한 줄(시계 · 씬 이름 · `rig.phase`)을 `#ui-root`에 그린다. `openPanel` · `closePanel`은 스택만 바꾸고 이벤트를 낸다(§10.4 규칙 그대로 · 화면은 패널 이름 한 줄). `isBlocking()` = 스택이 비어 있지 않음. `setAutoPanels` 저장만. `fade` 즉시 resolve. `handleKey` false. `i18n.t`는 동작(완성) |
| `app/*` | 빈 export(시그니처만). `main.js`는 스텁이 아니라 §11.8의 최소 부트 |

---

## §7 데이터 표와 수치

### 7.0 규칙

- 모든 수치는 `src/data/`에 있다. 소유 패키지는 **이름 · 구조 · ID를 바꾸지 않고**, 수치를 감각을 보고 **±20% 안에서** 조정할 수 있다(조정하면 `NOTES-P#.md`에 한 줄 — 무엇을 · 왜 · 테스트 결과).
- **🔒 표시 값은 측정 목표 산수(§7.12)에 묶여 있다.** 패키지가 바꾸지 않는다 — 밸런스 게이트(§12.6)가 봇 측정 결과로만 바꾸고 이 문서의 해당 줄과 §7.12를 함께 고친다.
- 어종 행 · 스테이지 · 장비 · 미끼 · 스킬은 **행을 더하면 늘어난다**(§8). 로직은 표의 ID만 참조하고 ID별 분기를 두지 않는다.

### 7.1 시간 — `data/time.js` (P3 · 시드)

```js
export const TIME = {
  startDay: 1, startHour: 6.0, wakeHour: 6.0, travelHours: 1.0,      // 🔒 travelHours
  sunrise: 5.5, sunset: 19.5,
  maxSunElev: 1.08,          // rad (62°) — 12:30
  minSunElev: -0.6,          // rad — 01:30 (달 고도는 view가 −sunElev)
  nightFloor: 0.06,          // 한밤 하늘 밝기
  nightLight: 0.25,          // light < 이 값 → night(헤드랜턴)
  twilight: [-0.10, 0.25],   // 해 고도(rad) smoothstep 구간
};
export const BANDS = [       // 🔒 (브리프 §3.2)
  { id: 'dawn', from: 4, to: 7 }, { id: 'morning', from: 7, to: 11 }, { id: 'day', from: 11, to: 17 },
  { id: 'evening', from: 17, to: 20 }, { id: 'night', from: 20, to: 4 },
];
```

`sunAt(hour, weatherLight)`:
- 낮(`sunrise ≤ h < sunset`): `f = (h − sunrise) / (sunset − sunrise)` · `sunElev = maxSunElev × sin(πf)` · `sunAzim = −π/2 + πf` (동 +X → 정오 −Z(물 위) → 서 −X).
- 밤: `g = ((h − sunset + 24) % 24) / (24 − (sunset − sunrise))` · `sunElev = minSunElev × sin(πg)` · `sunAzim = π/2 + πg`.
- `light = nightFloor + (1 − nightFloor) × smoothstep(twilight[0], twilight[1], sunElev) × weatherLight` · `night = light < nightLight`.

### 7.2 날씨 — `data/weather.js` (P3 · 시드)

```js
export const WEATHER = {
  clear:  { id: 'clear',  biteMul: 1.00, dayBandStep: 0, light: 1.00, fog: 1.0, waveMul: 1.00, rain: 0 },
  cloudy: { id: 'cloudy', biteMul: 1.05, dayBandStep: 1, light: 0.72, fog: 1.6, waveMul: 1.20, rain: 0 },
  rain:   { id: 'rain',   biteMul: 1.10, dayBandStep: 1, light: 0.55, fog: 2.4, waveMul: 1.45, rain: 1 },
};
```

- `weatherFor(seed, day, stageId)`: `u = hash32(seed, day, STAGE_IDS.indexOf(stageId) + 1) / 2^32` → `stage.weatherWeights`를 `WEATHER_IDS` 순서로 누적해 고른다. 하루 단위 · 스테이지마다 · 시드로 정해진다 — 내일 예보도 같은 함수(`day + 1`).
- `dayBandStep`: 흐림 · 비에서 아침 · 낮의 활동 계수를 한 단계 올린다(브리프 §3.2 「구름 아래서 활발」). `fog`는 안개 밀도 배율, `waveMul`은 파도, `rain`은 빗줄기.

### 7.2b 월드 — `data/world.js` (P3 · 시드)

```js
export const WORLD = {
  walkSpeed: 3.2, backMul: 0.7, strafeMul: 0.85, accel: 16,   // m/s · 뒤 · 옆 배율 · m/s² (멈출 때도 같은 가속)
  eyeHeight: 1.65,                                            // 브리프 §5
  spotRadius: 1.4, interactFov: 1.22,                         // 자리 진입 반경(m) · 상호작용 시선 반각(rad, 70°)
  exitStepBack: 1.0,                                          // 낚시 자리에서 일어나면 facing 반대로 1m
  pitchMin: -1.40, pitchMax: 1.40,
};
```

- 걷기: 목표 속도 = `walkSpeed × (moveZ ≥ 0 ? 1 : backMul)` 방향 = yaw 기준 앞/옆(`strafeMul`), 대각선은 정규화. `accel`로 다가간다. 다음 위치가 `walk` 밖이면 x만 · z만 따로 시도해 벽을 따라 미끄러진다. 그 뒤 `obstacles` 원 안이면 원 둘레로 밀어낸다(중심 → 위치 방향).
- `nearby`: 걷기 모드에서 `spotRadius` 안의 자리(가장 가까운 것)가 먼저, 없으면 `radius` 안이고 시선이 `interactFov` 안인 상호작용 점 중 가장 가까운 것.

### 7.3 어종 — `data/species/*.js`

#### 7.3.1 호수 — `data/species/lake.js` (P2 · 시드) — 충주호(청풍 연안)

```js
export const LAKE_SPECIES = [
  { id: 'crucian', stage: 'lake', layers: ['bottom'], time: 'HNLHH', method: 'both', baits: ['paste', 'worm', 'corn'],
    style: 'heavy', traits: [], lenCm: [15, 45], kg: [0.1, 1.8], mouth: 1, bite: { nibbles: [2, 4], take: 'lift' },
    pricePerKg: 4400, trophyBonus: 0.3, xp: 6, fantasy: null,
    look: { body: 'compressed', depth: 0.40, colors: ['#3e4a2a', '#9c9050', '#e6dcae', '#5a5a34'], pattern: 'scales', patternColor: '#2e3820' } },
  { id: 'carp', stage: 'lake', layers: ['bottom'], time: 'HNLNH', method: 'bottom', baits: ['corn', 'paste'],
    style: 'heavy', traits: [], fight: { stamina: 1.3 }, lenCm: [40, 110], kg: [1, 25], mouth: 3,
    pricePerKg: 1300, trophyBonus: 0.4, xp: 14, fantasy: null,
    look: { body: 'compressed', depth: 0.30, colors: ['#3a3620', '#a48a48', '#ecdcb0', '#7a5a30'], pattern: 'scales', patternColor: '#2a2614', barbels: 4 } },
  { id: 'israeliCarp', stage: 'lake', layers: ['bottom'], time: 'LNHHN', method: 'bottom', baits: ['paste', 'corn'],
    style: 'heavy', traits: ['dash'], lenCm: [40, 90], kg: [1, 15], mouth: 3,
    pricePerKg: 1650, trophyBonus: 0.3, xp: 12, fantasy: null,
    look: { body: 'compressed', depth: 0.36, colors: ['#474636', '#8c8770', '#dcd6c0', '#6a6450'], pattern: 'mirror', patternColor: '#2e2c22', barbels: 4 } },
  { id: 'largemouthBass', stage: 'lake', layers: ['mid'], time: 'NHNHL', method: 'float', baits: ['live', 'worm'],
    style: 'jumper', traits: [], lenCm: [25, 60], kg: [0.3, 4], mouth: 3, bite: { nibbles: [0, 1] },
    pricePerKg: 2200, trophyBonus: 0.35, xp: 10, fantasy: null,
    look: { body: 'fusiform', depth: 0.28, colors: ['#2e4626', '#7c9a58', '#eaedd8', '#4e6a3a'], pattern: 'stripe', patternColor: '#1e2c18' } },
  { id: 'bluegill', stage: 'lake', layers: ['surface', 'mid'], time: 'LNHNL', method: 'float', baits: ['worm', 'paste'],
    style: 'small', traits: [], lenCm: [10, 25], kg: [0.05, 0.4], mouth: 1,
    pricePerKg: 4400, trophyBonus: 0.3, xp: 3, fantasy: null,
    look: { body: 'compressed', depth: 0.50, colors: ['#34442a', '#7a8a4c', '#e8a040', '#4a5a34'], pattern: 'bars', patternColor: '#283420' } },
  { id: 'mandarinFish', stage: 'lake', layers: ['bottom'], time: 'HLLNH', method: 'both', baits: ['live'],
    style: 'thrasher', traits: [], lenCm: [25, 60], kg: [0.3, 3.5], mouth: 3, bite: { nibbles: [0, 1] },
    pricePerKg: 6600, trophyBonus: 0.4, xp: 14, fantasy: null,
    look: { body: 'fusiform', depth: 0.30, colors: ['#5e5026', '#c2a252', '#f0e6c0', '#8a7034'], pattern: 'spots', patternColor: '#2e2210' } },
  { id: 'catfish', stage: 'lake', layers: ['bottom'], time: 'NL0NH', method: 'bottom', baits: ['worm', 'live'],
    style: 'heavy', traits: ['shake'], lenCm: [30, 100], kg: [0.5, 10], mouth: 3,
    pricePerKg: 2000, trophyBonus: 0.3, xp: 10, fantasy: null,
    look: { body: 'benthic', depth: 0.18, colors: ['#262620', '#4a4a38', '#cac6b0', '#2e2e26'], pattern: 'mottled', patternColor: '#1a1a14', barbels: 4 } },
  { id: 'snakehead', stage: 'lake', layers: ['surface'], time: 'NLLHH', method: 'float', baits: ['live'],
    style: 'thrasher', traits: [], fight: { force: 1.15 }, lenCm: [40, 100], kg: [0.8, 8], mouth: 3, bite: { nibbles: [0, 1] },
    pricePerKg: 2000, trophyBonus: 0.35, xp: 14, fantasy: null,
    look: { body: 'eel', depth: 0.16, colors: ['#2a2e1e', '#5c6242', '#bab8a0', '#3a3e2a'], pattern: 'mottled', patternColor: '#141810' } },
  { id: 'steedBarbel', stage: 'lake', layers: ['bottom'], time: 'NHHNL', method: 'both', baits: ['worm', 'corn'],
    style: 'runner', traits: ['shortRun'], lenCm: [25, 60], kg: [0.3, 3], mouth: 2,
    pricePerKg: 2000, trophyBonus: 0.3, xp: 7, fantasy: null,
    look: { body: 'fusiform', depth: 0.21, colors: ['#565a50', '#b2b4a6', '#f2f2ea', '#8a8c80'], pattern: 'none', patternColor: null, barbels: 2 } },
  { id: 'skygager', stage: 'lake', layers: ['surface', 'mid'], time: 'NHLHL', method: 'float', baits: ['live', 'shrimp'],
    style: 'runner', traits: [], fight: { speed: 1.2 }, lenCm: [30, 70], kg: [0.3, 4], mouth: 2, bite: { nibbles: [0, 1] },
    pricePerKg: 1650, trophyBonus: 0.3, xp: 8, fantasy: null,
    look: { body: 'compressed', depth: 0.24, colors: ['#62747c', '#d2dade', '#f6f8fa', '#9aa8ae'], pattern: 'none', patternColor: null } },
  { id: 'bullhead', stage: 'lake', layers: ['bottom'], time: 'NLLNH', method: 'bottom', baits: ['worm'],
    style: 'small', traits: ['tremble'], lenCm: [12, 25], kg: [0.05, 0.3], mouth: 1,
    pricePerKg: 5500, trophyBonus: 0.3, xp: 4, fantasy: null,
    look: { body: 'benthic', depth: 0.20, colors: ['#5e501c', '#c8a83e', '#ecdea2', '#8a7428'], pattern: 'mottled', patternColor: '#34280c', barbels: 8 } },
  { id: 'goldenDragon', stage: 'lake', layers: ['bottom'], time: 'H0000', method: 'bottom', baits: ['corn'],
    style: 'heavy', traits: ['dash'], fight: { stamina: 1.3 }, lenCm: [80, 150], kg: [10, 45], mouth: 3,
    pricePerKg: 3000, trophyBonus: 0.5, xp: 120, fantasy: { bands: ['dawn'], weather: ['clear'] },
    look: { body: 'compressed', depth: 0.32, colors: ['#a87808', '#ffc828', '#fff0a0', '#e09810'], pattern: 'gold', patternColor: '#ffe680', barbels: 4, glow: '#ffb000' } },
];
```

#### 7.3.2 갯바위 — `data/species/coast.js` (P11 · 시드) — 조가사키 해안(이즈)

```js
export const COAST_SPECIES = [
  { id: 'opaleye', stage: 'coast', layers: ['mid'], time: 'NHLHL', method: 'float', baits: ['krill'],
    style: 'diver', traits: ['firstRun'], lenCm: [25, 60], kg: [0.3, 4], mouth: 1,
    pricePerKg: 5500, trophyBonus: 0.35, xp: 14, fantasy: null,
    look: { body: 'compressed', depth: 0.42, colors: ['#1c2828', '#2e3c3c', '#56646a', '#1c2626'], pattern: 'none', patternColor: null } },
  { id: 'blackSeabream', stage: 'coast', layers: ['bottom', 'mid'], time: 'HNLHH', method: 'both', baits: ['krill', 'shrimp'],
    style: 'diver', traits: ['cautious'], lenCm: [25, 60], kg: [0.4, 4], mouth: 2,
    pricePerKg: 6000, trophyBonus: 0.4, xp: 15, fantasy: null,
    look: { body: 'compressed', depth: 0.40, colors: ['#363c46', '#8a949e', '#d8dce2', '#4a5058'], pattern: 'bars', patternColor: '#5a6068' } },
  { id: 'barredKnifejaw', stage: 'coast', layers: ['bottom'], time: 'LNHNL', method: 'bottom', baits: ['shrimp', 'live'],
    style: 'diver', traits: ['abrade'], fight: { force: 1.2 }, lenCm: [30, 75], kg: [0.8, 9], mouth: 2,
    pricePerKg: 7000, trophyBonus: 0.45, xp: 22, fantasy: null,
    look: { body: 'compressed', depth: 0.46, colors: ['#262626', '#cac8c0', '#e2e0d8', '#3a3a3a'], pattern: 'bars', patternColor: '#181818' } },
  { id: 'redSeabream', stage: 'coast', layers: ['mid', 'bottom'], time: 'HNLHN', method: 'both', baits: ['krill', 'shrimp'],
    style: 'runner', traits: ['repeatRun'], lenCm: [30, 100], kg: [0.5, 12], mouth: 2,
    pricePerKg: 5000, trophyBonus: 0.4, xp: 16, fantasy: null,
    look: { body: 'compressed', depth: 0.40, colors: ['#c03852', '#e8707e', '#f8dcdc', '#d05060'], pattern: 'spots', patternColor: '#60a8f0' } },
  { id: 'scorpionfish', stage: 'coast', layers: ['bottom'], time: 'NLLNH', method: 'bottom', baits: ['shrimp', 'worm'],
    style: 'small', traits: [], lenCm: [15, 35], kg: [0.1, 0.8], mouth: 3,
    pricePerKg: 4500, trophyBonus: 0.3, xp: 6, fantasy: null,
    look: { body: 'fusiform', depth: 0.32, colors: ['#6a2e1e', '#b25a38', '#eab090', '#8a3c24'], pattern: 'mottled', patternColor: '#3a160c' } },
  { id: 'rockfish', stage: 'coast', layers: ['mid'], time: 'HL0NH', method: 'float', baits: ['krill', 'shrimp'],
    style: 'small', traits: ['shortThrash'], lenCm: [12, 30], kg: [0.05, 0.5], mouth: 2,
    pricePerKg: 5500, trophyBonus: 0.3, xp: 5, fantasy: null,
    look: { body: 'fusiform', depth: 0.32, colors: ['#46382e', '#8a7a66', '#d2c8b8', '#5a4a3a'], pattern: 'bars', patternColor: '#2e241c' } },
  { id: 'rabbitfish', stage: 'coast', layers: ['mid'], time: 'LNHNL', method: 'float', baits: ['krill'],
    style: 'thrasher', traits: ['spin'], lenCm: [20, 45], kg: [0.2, 1.8], mouth: 1,
    pricePerKg: 2800, trophyBonus: 0.3, xp: 9, fantasy: null,
    look: { body: 'compressed', depth: 0.42, colors: ['#46462e', '#9a9670', '#dad6ba', '#6a6648'], pattern: 'spots', patternColor: '#d8d4b8' } },
  { id: 'threelineGrunt', stage: 'coast', layers: ['mid'], time: 'LLNHH', method: 'float', baits: ['krill'],
    style: 'runner', traits: ['shortRun'], fight: { speed: 1.2 }, lenCm: [20, 45], kg: [0.2, 1.5], mouth: 1,
    pricePerKg: 4200, trophyBonus: 0.3, xp: 8, fantasy: null,
    look: { body: 'fusiform', depth: 0.30, colors: ['#665c3c', '#b8b08e', '#eae6d2', '#8a8260'], pattern: 'stripe', patternColor: '#463c24' } },
  { id: 'morayEel', stage: 'coast', layers: ['bottom'], time: 'NLLNH', method: 'bottom', baits: ['live'],
    style: 'heavy', traits: ['twist', 'abrade'], lenCm: [50, 120], kg: [0.8, 6], mouth: 3, bite: { nibbles: [0, 1] },
    pricePerKg: 2200, trophyBonus: 0.3, xp: 14, fantasy: null,
    look: { body: 'eel', depth: 0.10, colors: ['#382e16', '#6a5a2e', '#8a7a4e', '#4a3e1e'], pattern: 'mottled', patternColor: '#181206' } },
  { id: 'amberjack', stage: 'coast', layers: ['mid', 'surface'], time: 'NHNLL', method: 'float', baits: ['live'],
    style: 'runner', traits: ['longRun'], lenCm: [50, 130], kg: [2, 30], mouth: 3, bite: { nibbles: [0, 1] },
    pricePerKg: 2800, trophyBonus: 0.4, xp: 26, fantasy: null,
    look: { body: 'fusiform', depth: 0.26, colors: ['#46566a', '#b8c4ce', '#eef0f2', '#c8a040'], pattern: 'stripe', patternColor: '#c8a040' } },
  { id: 'zombieShark', stage: 'coast', layers: ['mid'], time: '0000H', method: 'both', baits: ['live'],
    style: 'thrasher', traits: ['stopBurst'], fight: { force: 0.7 }, lenCm: [120, 250], kg: [20, 120], mouth: 3, bite: { nibbles: [0, 1] },
    pricePerKg: 1200, trophyBonus: 0.5, xp: 150, fantasy: { bands: ['night'], weather: ['rain'] },
    look: { body: 'shark', depth: 0.18, colors: ['#46563f', '#7a8a6c', '#a8b096', '#3a4634'], pattern: 'zombie', patternColor: '#6e1c1c', glow: '#80ff60' } },
  { id: 'pinkShark', stage: 'coast', layers: ['surface'], time: '00H00', method: 'float', baits: ['live', 'shrimp'],
    style: 'jumper', traits: ['longRun'], fight: { force: 0.7, stamina: 1.2 }, lenCm: [100, 220], kg: [15, 90], mouth: 3, bite: { nibbles: [0, 1] },
    pricePerKg: 1300, trophyBonus: 0.5, xp: 140, fantasy: { bands: ['day'], weather: ['clear'] },
    look: { body: 'shark', depth: 0.17, colors: ['#cc5c86', '#f08ab0', '#ffe2ee', '#d06a90'], pattern: 'none', patternColor: null, glow: '#ff70b0' } },
];
```

#### 7.3.3 강 — `data/species/river.js` (P12 · 시드) — 컬럼비아강 보너빌 댐 하류

```js
export const RIVER_SPECIES = [
  { id: 'whiteSturgeon', stage: 'river', layers: ['bottom'], time: 'HNLNH', method: 'bottom', baits: ['live', 'shrimp'],
    style: 'heavy', traits: ['rareJump'], fight: { stamina: 2.5 }, lenCm: [90, 300], kg: [5, 150], mouth: 3,
    pricePerKg: 1400, trophyBonus: 0.5, xp: 40, fantasy: null,
    look: { body: 'benthic', depth: 0.14, colors: ['#585c56', '#9a9e96', '#e2e4de', '#6a6e66'], pattern: 'scutes', patternColor: '#d8dad2', barbels: 4 } },
  { id: 'chinookSalmon', stage: 'river', layers: ['mid'], time: 'HHNLL', method: 'float', baits: ['live', 'shrimp'],
    style: 'runner', traits: ['longRun'], fight: { force: 1.15 }, lenCm: [60, 130], kg: [3, 25], mouth: 3, bite: { nibbles: [0, 1] },
    pricePerKg: 5500, trophyBonus: 0.4, xp: 30, fantasy: null,
    look: { body: 'fusiform', depth: 0.25, colors: ['#384a52', '#bac2c6', '#f0f2f2', '#4a5a62'], pattern: 'spots', patternColor: '#1a1e20' } },
  { id: 'steelhead', stage: 'river', layers: ['mid', 'surface'], time: 'NHLHL', method: 'float', baits: ['shrimp', 'worm'],
    style: 'jumper', traits: ['multiJump'], lenCm: [50, 100], kg: [2, 10], mouth: 2, bite: { nibbles: [0, 1] },
    pricePerKg: 6000, trophyBonus: 0.4, xp: 22, fantasy: null,
    look: { body: 'fusiform', depth: 0.24, colors: ['#3a4e46', '#c2caca', '#f2f2f0', '#5a6a64'], pattern: 'stripe', patternColor: '#d87890' } },
  { id: 'walleye', stage: 'river', layers: ['bottom'], time: 'NLLHH', method: 'bottom', baits: ['worm', 'live'],
    style: 'heavy', traits: ['shake'], fight: { force: 0.8 }, lenCm: [30, 80], kg: [0.4, 7], mouth: 3, bite: { nibbles: [0, 1] },
    pricePerKg: 4500, trophyBonus: 0.3, xp: 12, fantasy: null,
    look: { body: 'fusiform', depth: 0.22, colors: ['#5a4e1e', '#b2a252', '#eae6ca', '#7a6a2a'], pattern: 'mottled', patternColor: '#2e2810' } },
  { id: 'smallmouthBass', stage: 'river', layers: ['mid'], time: 'NHHNL', method: 'float', baits: ['worm', 'live'],
    style: 'jumper', traits: [], lenCm: [20, 50], kg: [0.2, 3], mouth: 2,
    pricePerKg: 4500, trophyBonus: 0.35, xp: 10, fantasy: null,
    look: { body: 'fusiform', depth: 0.28, colors: ['#483e1e', '#9a8042', '#e2dab2', '#6a5a2a'], pattern: 'bars', patternColor: '#382e16' } },
  { id: 'channelCatfish', stage: 'river', layers: ['bottom'], time: 'NLLNH', method: 'bottom', baits: ['worm', 'live'],
    style: 'heavy', traits: [], lenCm: [30, 90], kg: [0.5, 12], mouth: 3,
    pricePerKg: 3000, trophyBonus: 0.3, xp: 11, fantasy: null,
    look: { body: 'benthic', depth: 0.17, colors: ['#485058', '#8a96a2', '#e2e6ea', '#5a646e'], pattern: 'spots', patternColor: '#1e2228', barbels: 8 } },
  { id: 'americanShad', stage: 'river', layers: ['surface', 'mid'], time: 'NHLHL', method: 'float', baits: ['shrimp', 'krill'],
    style: 'thrasher', traits: [], fight: { force: 0.8, speed: 1.3 }, lenCm: [30, 55], kg: [0.4, 2.5], mouth: 1,
    pricePerKg: 3500, trophyBonus: 0.3, xp: 8, fantasy: null,
    look: { body: 'compressed', depth: 0.30, colors: ['#385a6a', '#cad6de', '#f4f6f8', '#7a96a4'], pattern: 'spots', patternColor: '#1a2a32' } },
  { id: 'pikeminnow', stage: 'river', layers: ['mid'], time: 'LNHNL', method: 'float', baits: ['worm'],
    style: 'small', traits: [], lenCm: [20, 50], kg: [0.2, 2], mouth: 2,
    pricePerKg: 2500, trophyBonus: 0.3, xp: 5, fantasy: null,
    look: { body: 'fusiform', depth: 0.19, colors: ['#485036', '#a8b292', '#eaecd8', '#6a7254'], pattern: 'none', patternColor: null } },
  { id: 'cutthroatTrout', stage: 'river', layers: ['surface'], time: 'HNLHL', method: 'float', baits: ['worm', 'krill'],
    style: 'thrasher', traits: [], fight: { force: 0.85 }, lenCm: [20, 45], kg: [0.2, 1.5], mouth: 2,
    pricePerKg: 6500, trophyBonus: 0.35, xp: 9, fantasy: null,
    look: { body: 'fusiform', depth: 0.24, colors: ['#4a4e2e', '#c2b282', '#f2ead2', '#6a6a3e'], pattern: 'spots', patternColor: '#2a2a16', accent: '#c83020' } },
  { id: 'largescaleSucker', stage: 'river', layers: ['bottom'], time: 'LNHNL', method: 'bottom', baits: ['worm', 'corn'],
    style: 'heavy', traits: [], fight: { force: 0.8 }, lenCm: [25, 55], kg: [0.3, 2.5], mouth: 1,
    pricePerKg: 2000, trophyBonus: 0.3, xp: 5, fantasy: null,
    look: { body: 'fusiform', depth: 0.20, colors: ['#3a3a2e', '#8a8672', '#e2ded2', '#5a5848'], pattern: 'scales', patternColor: '#2a2a20' } },
  { id: 'burbot', stage: 'river', layers: ['bottom'], time: 'NL0NH', method: 'bottom', baits: ['live'],
    style: 'heavy', traits: ['twist'], lenCm: [30, 80], kg: [0.4, 5], mouth: 3, bite: { nibbles: [0, 1] },
    pricePerKg: 3800, trophyBonus: 0.3, xp: 12, fantasy: null,
    look: { body: 'eel', depth: 0.14, colors: ['#4a3e1e', '#8a7a42', '#dad2aa', '#5a4e2a'], pattern: 'mottled', patternColor: '#22180a', barbels: 1 } },
  { id: 'paleKing', stage: 'river', layers: ['mid'], time: 'H0000', method: 'float', baits: ['live'],
    style: 'runner', traits: ['vanish'], fight: { stamina: 1.2 }, lenCm: [100, 180], kg: [15, 50], mouth: 3, bite: { nibbles: [0, 1] },
    pricePerKg: 5000, trophyBonus: 0.5, xp: 130, fantasy: { bands: ['dawn'], weather: ['cloudy'] },
    look: { body: 'fusiform', depth: 0.25, colors: ['#c6d2da', '#e8f0f4', '#ffffff', '#d0dce4'], pattern: 'ghost', patternColor: '#a0e0ff', glow: '#a0e0ff' } },
];
```

- 이름은 문자열 `species.<id>`(부록 B). 판타지 4종은 `time`에서 조건 시간대만 `H`, 나머지 `0`이다(도감 표시용 — 출현은 §5.4.3의 섞기로만).
- **`lenCm` · `kg` · `pricePerKg` · `trophyBonus` · `xp` · `style` · `fight`는 🔒**(§7.12의 산수). `look` · `bite` · `traits`의 연출성 필드는 소유 패키지 재량.

#### 7.3.4 파생 값 — `derive.js` (P0 완성)

```
σ = (ln L999 − ln L5) / (Z999 − Z05) ;  μ = ln L5 − Z05 × σ          (L5, L999 = lenCm ; Z05 = −1.6449 · Z999 = 3.0902)
b = ln(W999 / W5) / ln(L999 / L5) ;  a = W5 / L5^b                   (W5, W999 = kg — 두 점을 정확히 지난다)
medianCm = e^μ · medianKg = a·medianCm^b
trophyCm = e^(μ + 1.28155σ) · trophyKg = a·trophyCm^b                (90 퍼센타일)
legendCm = e^(μ + 2.32635σ) · legendKg = a·legendCm^b                (99 퍼센타일)
priceMul.normal = 1
priceMul.trophy = 2 + trophyBonus                                     (기본 2배 + α — 브리프 §4)
priceMul.legend = PRICE.legendTargetRatio × priceMul.trophy / exp(PRICE.dzLegendTrophy × b × σ)
                  → 레전드 중앙가 / 트로피 중앙가 = 5.0 (퍼센타일 99.5 · 94.5 의 무게비를 배율이 메운다)
```

산출 표(검산용 — `derive.js`의 결과가 이 값과 소수 2자리까지 같아야 한다):

| 어종 | 중앙 cm | 중앙 kg | 트로피 kg | 레전드 kg | 레전드 배율 | 중앙가 | 트로피 중앙가 | 레전드 중앙가 |
|---|---|---|---|---|---|---|---|---|
| crucian | 22.0 | 0.27 | 0.60 | 1.13 | 6.33 | 1,112 | 7,327 | 36,634 |
| carp | 56.8 | 3.06 | 7.31 | 14.87 | 6.17 | 3,651 | 28,288 | 141,440 |
| israeliCarp | 53.0 | 2.56 | 5.33 | 9.69 | 6.57 | 3,934 | 24,250 | 121,251 |
| largemouthBass | 33.9 | 0.74 | 1.49 | 2.63 | 6.88 | 1,515 | 9,143 | 45,714 |
| bluegill | 13.7 | 0.10 | 0.18 | 0.29 | 7.49 | 429 | 2,102 | 10,511 |
| mandarinFish | 33.9 | 0.70 | 1.37 | 2.35 | 7.23 | 4,355 | 25,564 | 127,819 |
| catfish | 45.6 | 1.42 | 3.18 | 6.17 | 6.20 | 2,615 | 17,898 | 89,489 |
| snakehead | 55.0 | 1.78 | 3.32 | 5.52 | 7.30 | 3,349 | 18,201 | 91,003 |
| steedBarbel | 33.9 | 0.67 | 1.24 | 2.07 | 7.15 | 1,256 | 6,680 | 33,400 |
| skygager | 40.3 | 0.74 | 1.49 | 2.63 | 6.74 | 1,136 | 6,711 | 33,556 |
| bullhead | 15.5 | 0.09 | 0.15 | 0.22 | 7.94 | 489 | 2,158 | 10,789 |
| goldenDragon | 99.5 | 16.86 | 25.33 | 35.30 | 9.16 | 48,607 | 210,112 | 1,050,560 |
| opaleye | 33.9 | 0.74 | 1.49 | 2.63 | 6.88 | 3,788 | 22,858 | 114,288 |
| blackSeabream | 33.9 | 0.89 | 1.66 | 2.76 | 7.46 | 5,024 | 27,882 | 139,412 |
| barredKnifejaw | 41.2 | 1.85 | 3.57 | 6.09 | 7.43 | 12,174 | 71,994 | 359,969 |
| redSeabream | 45.6 | 1.51 | 3.56 | 7.19 | 6.23 | 6,930 | 52,901 | 264,507 |
| scorpionfish | 20.1 | 0.21 | 0.36 | 0.57 | 7.49 | 877 | 4,300 | 21,500 |
| rockfish | 16.5 | 0.11 | 0.21 | 0.34 | 7.15 | 576 | 3,062 | 15,309 |
| rabbitfish | 26.5 | 0.43 | 0.78 | 1.26 | 7.31 | 1,133 | 5,801 | 29,004 |
| threelineGrunt | 26.5 | 0.40 | 0.69 | 1.08 | 7.59 | 1,603 | 7,680 | 38,398 |
| morayEel | 67.8 | 1.61 | 2.78 | 4.33 | 7.59 | 3,359 | 16,091 | 80,454 |
| amberjack | 69.7 | 5.12 | 10.66 | 19.38 | 6.86 | 13,351 | 85,884 | 429,419 |
| zombieShark | 154.9 | 37.27 | 60.53 | 89.88 | 8.63 | 42,645 | 204,697 | 1,023,486 |
| pinkShark | 131.5 | 27.95 | 45.40 | 67.41 | 8.63 | 34,649 | 166,317 | 831,583 |
| whiteSturgeon | 136.7 | 16.30 | 40.92 | 86.65 | 6.19 | 20,846 | 179,774 | 898,872 |
| chinookSalmon | 78.5 | 6.27 | 11.12 | 17.76 | 7.75 | 32,577 | 169,188 | 845,940 |
| steelhead | 63.6 | 3.50 | 5.41 | 7.71 | 8.61 | 20,111 | 86,720 | 433,602 |
| walleye | 42.2 | 1.08 | 2.35 | 4.41 | 6.37 | 4,509 | 29,401 | 147,006 |
| smallmouthBass | 27.5 | 0.51 | 1.07 | 1.94 | 6.72 | 2,146 | 13,515 | 67,576 |
| channelCatfish | 43.9 | 1.51 | 3.56 | 7.19 | 5.97 | 4,158 | 30,418 | 152,091 |
| americanShad | 37.0 | 0.76 | 1.24 | 1.86 | 7.88 | 2,520 | 11,297 | 56,484 |
| pikeminnow | 27.5 | 0.45 | 0.83 | 1.38 | 7.15 | 1,047 | 5,567 | 27,834 |
| cutthroatTrout | 26.5 | 0.40 | 0.69 | 1.08 | 7.75 | 2,481 | 12,144 | 60,718 |
| largescaleSucker | 32.9 | 0.63 | 1.11 | 1.78 | 7.42 | 1,185 | 5,896 | 29,480 |
| burbot | 42.2 | 0.96 | 1.91 | 3.33 | 6.83 | 3,418 | 19,718 | 98,588 |
| paleKing | 122.7 | 22.79 | 31.57 | 41.17 | 9.75 | 110,362 | 427,685 | 2,138,426 |

(「중앙가」= 45 퍼센타일 무게 × 단가 — 비트로피 구간의 중앙값. 「트로피 중앙가」= 94.5 퍼센타일 · 「레전드 중앙가」= 99.5 퍼센타일.)

### 7.4 스테이지 — `data/stages/*.js`

좌표는 §0.2. `walk`는 볼록 다각형이고 꼭짓점 순서는 **`Σ(xᵢ·zᵢ₊₁ − xᵢ₊₁·zᵢ) > 0`**(테스트가 본다). 낚시 자리의 `stand`는 `walk` 안, 상호작용 점은 `walk` 안이거나 경계에서 `radius` 안. `pool`의 판타지 어종 `w`는 1(쓰지 않는다).
`edgeM`은 stand에서 facing 방향으로 해안선(`shore`)을 만나는 거리다(데이터 테스트가 ±0.15m로 검산 — 물고기 최소 거리 · 뜰채 범위의 기준). `farFromM`이 있는 자리는 그 거리 너머에서 `farMul` 어종이 더 문다(흘림 · 원투 · 비거리 장비의 보상 — 봇은 흘리지 않으므로 측정에는 들어가지 않는다).

#### 7.4.1 집 — `data/stages/home.js` (P3 · 시드)

```js
export const HOME = {
  id: 'home', kind: 'interior', unlockLevel: 1,
  spawn: { x: 0, z: 1.2, yaw: 0 },
  walk: [{ x: -3.1, z: -2.6 }, { x: 3.1, z: -2.6 }, { x: 3.1, z: 2.6 }, { x: -3.1, z: 2.6 }],
  shore: [],
  points: [
    { kind: 'pc',   id: 'pc',   x: -2.2, z: -2.3, yaw: 0,            radius: 1.3, approach: { x: -2.2, z: -1.4 } },   // 책상 + PC — 북쪽(−Z) 벽
    { kind: 'bed',  id: 'bed',  x: 2.3,  z: 1.6,  yaw: -Math.PI / 2,  radius: 1.3, approach: { x: 1.4, z: 1.0 } },
    { kind: 'door', id: 'door', x: 0,    z: 2.6,  yaw: Math.PI,       radius: 1.2, approach: { x: 0, z: 1.6 } },     // 남쪽(+Z) 벽의 문
  ],
  obstacles: [{ x: -2.2, z: -2.55, r: 0.55 }, { x: 2.3, z: 1.7, r: 0.85 }],     // 책상 · 침대
  spots: [], ambience: 'indoor', waves: { amp: 0, period: 1 },
  weatherWeights: { clear: 1, cloudy: 0, rain: 0 },     // 쓰지 않는다(집의 current 는 lake 의 날씨)
  look: { room: { w: 7.0, d: 6.0, h: 2.6 }, wall: '#d9cfbf', floor: '#8a6a48', ceiling: '#efe9df', window: { wall: '+x', z: -0.6, w: 1.6, h: 1.1 } },
};
```

#### 7.4.2 호수 — `data/stages/lake.js` (P3 · 시드) — 충주호 청풍 연안

```js
export const LAKE = {
  id: 'lake', kind: 'outdoor', unlockLevel: 1,                                            // 🔒 unlockLevel
  spawn: { x: 0, z: 22, yaw: 0 },
  walk: [{ x: -50, z: 1.4 }, { x: 50, z: 1.4 }, { x: 50, z: 36 }, { x: -50, z: 36 }],
  shore: [{ x: -120, z: 6 }, { x: -60, z: 0.6 }, { x: -30, z: -0.4 }, { x: 0, z: 0 }, { x: 30, z: -0.8 }, { x: 60, z: 0.4 }, { x: 120, z: 6 }],
  points: [
    { kind: 'npc',  id: 'vendor', x: 14,  z: 9,  yaw: 0.6,  radius: 1.8, approach: { x: 14, z: 7.6 } },    // 좌판
    { kind: 'camp', id: 'camp',   x: -15, z: 12, yaw: -0.4, radius: 1.8, approach: { x: -15, z: 10.6 } },
  ],
  obstacles: [{ x: 14, z: 10, r: 1.2 }, { x: -15, z: 12.6, r: 1.4 }],           // 좌판 · 캠프(텐트 + 모닥불)
  spots: [
    { id: 'lake_shallows', stand: { x: -32, z: 1.6 }, facing: 0.25, arc: 0.6, edgeM: 2.0, depth: [[0, 0.2], [10, 1.2], [25, 2.2], [45, 3.0]],
      minCastM: 6, maxDriftM: 60, farFromM: null, flow: { x: 0, z: 0 }, snag: { fromM: 26, rate: 0.08 }, abrasion: 0.3, bottom: 'mud',
      pool: [{ id: 'crucian', w: 1.0 }, { id: 'bluegill', w: 1.0 }, { id: 'snakehead', w: 0.6 }, { id: 'largemouthBass', w: 0.6 },
             { id: 'catfish', w: 0.4 }, { id: 'bullhead', w: 0.5 }, { id: 'carp', w: 0.3 }, { id: 'skygager', w: 0.3 }] },
    { id: 'lake_gravel', stand: { x: 0, z: 1.6 }, facing: 0, arc: 0.6, edgeM: 1.6, depth: [[0, 0.3], [10, 2.0], [25, 4.5], [45, 7.0]],
      minCastM: 6, maxDriftM: 60, farFromM: null, flow: { x: 0.05, z: 0 }, snag: { fromM: 31, rate: 0.12 }, abrasion: 0, bottom: 'gravel',
      pool: [{ id: 'crucian', w: 1.0 }, { id: 'carp', w: 0.6 }, { id: 'israeliCarp', w: 0.6 }, { id: 'steedBarbel', w: 0.8 },
             { id: 'largemouthBass', w: 0.4 }, { id: 'bluegill', w: 0.5 }, { id: 'catfish', w: 0.4 }, { id: 'bullhead', w: 0.4 },
             { id: 'skygager', w: 0.4 }, { id: 'goldenDragon', w: 1 }] },
    { id: 'lake_cape', stand: { x: 36, z: 1.6 }, facing: -0.3, arc: 0.6, edgeM: 2.2, depth: [[0, 1.0], [8, 5.0], [20, 10.0], [45, 16.0]],
      minCastM: 6, maxDriftM: 60, farFromM: 30, flow: { x: 0, z: 0 }, snag: { fromM: 34, rate: 0.08 }, abrasion: 0.5, bottom: 'rock',
      pool: [{ id: 'mandarinFish', w: 0.8, farMul: 2 }, { id: 'skygager', w: 0.6, farMul: 2 }, { id: 'largemouthBass', w: 0.5 }, { id: 'carp', w: 0.5 },
             { id: 'catfish', w: 0.4 }, { id: 'steedBarbel', w: 0.4 }, { id: 'crucian', w: 0.3 }, { id: 'israeliCarp', w: 0.3 },
             { id: 'goldenDragon', w: 1 }] },
  ],
  ambience: 'lake', waves: { amp: 0.03, period: 3.5 },
  weatherWeights: { clear: 0.5, cloudy: 0.3, rain: 0.2 },
  look: {
    terrain: { ground: '#5b6b3a', shore: '#8a7d62', seabed: '#4a4a36', hillAmp: 6, hillScale: 60, noiseSeed: 11 },
    ridge: { height: 380, dist: 1400, color: '#4c5e48', farBankZ: -900 },          // 호수 건너편 산 · 맞은편 기슭
    water: { shallow: '#4e7f78', deep: '#1d4652', opacity: 0.86 },
    sky: { zenith: '#5e8fd0', horizon: '#c9dbe8' }, fog: { color: '#b8c8d0', density: 0.0045 },
    vendor: 'stall', reeds: true,
  },
};
```

#### 7.4.3 갯바위 — `data/stages/coast.js` (P11 · 시드) — 조가사키 해안

```js
export const COAST = {
  id: 'coast', kind: 'outdoor', unlockLevel: 5,                                           // 🔒 unlockLevel
  spawn: { x: 0, z: 20, yaw: 0 },
  walk: [{ x: -45, z: 1.6 }, { x: 45, z: 1.6 }, { x: 45, z: 30 }, { x: -45, z: 30 }],
  shore: [{ x: -120, z: 4 }, { x: -40, z: 0.4 }, { x: -20, z: -0.5 }, { x: 0, z: 0.6 }, { x: 25, z: -0.4 }, { x: 40, z: 0.8 }, { x: 120, z: 5 }],
  points: [
    { kind: 'npc',  id: 'vendor', x: 12,  z: 11, yaw: 0.5,  radius: 2.0, approach: { x: 12, z: 9.4 } },    // 어판장 트럭
    { kind: 'camp', id: 'camp',   x: -13, z: 13, yaw: -0.3, radius: 1.8, approach: { x: -13, z: 11.6 } },
  ],
  obstacles: [{ x: 12, z: 12.8, r: 2.0 }, { x: -13, z: 13.6, r: 1.4 }],         // 어판장 트럭 · 캠프
  spots: [
    { id: 'coast_shoal', stand: { x: -26, z: 2.0 }, facing: 0.2, arc: 0.6, edgeM: 2.3, depth: [[0, 1.0], [10, 3.0], [25, 6.0], [45, 9.0]],
      minCastM: 6, maxDriftM: 80, farFromM: null, flow: { x: 0.3, z: 0 }, snag: { fromM: 30, rate: 0.10 }, abrasion: 1.0, bottom: 'rock',
      pool: [{ id: 'opaleye', w: 1.0 }, { id: 'rabbitfish', w: 0.8 }, { id: 'blackSeabream', w: 0.6 }, { id: 'rockfish', w: 0.6 },
             { id: 'scorpionfish', w: 0.5 }, { id: 'threelineGrunt', w: 0.5 }, { id: 'barredKnifejaw', w: 0.3 }, { id: 'morayEel', w: 0.3 },
             { id: 'pinkShark', w: 1 }] },
    { id: 'coast_channel', stand: { x: 4, z: 2.2 }, facing: 0, arc: 0.6, edgeM: 1.8, depth: [[0, 2], [10, 7], [30, 13], [60, 17]],
      minCastM: 6, maxDriftM: 100, farFromM: 40, flow: { x: 0.7, z: -0.1 }, snag: { fromM: 45, rate: 0.08 }, abrasion: 0.6, bottom: 'rock',
      pool: [{ id: 'redSeabream', w: 0.8, farMul: 2 }, { id: 'opaleye', w: 0.6 }, { id: 'blackSeabream', w: 0.6 }, { id: 'threelineGrunt', w: 0.6 },
             { id: 'amberjack', w: 0.4, farMul: 2 }, { id: 'rockfish', w: 0.4 }, { id: 'scorpionfish', w: 0.3 }, { id: 'rabbitfish', w: 0.3 },
             { id: 'zombieShark', w: 1 }, { id: 'pinkShark', w: 1 }] },
    { id: 'coast_cape', stand: { x: 34, z: 2.4 }, facing: -0.35, arc: 0.6, edgeM: 2.2, depth: [[0, 4], [10, 11], [30, 20], [60, 28]],
      minCastM: 6, maxDriftM: 90, farFromM: null, flow: { x: 0.4, z: 0 }, snag: { fromM: 40, rate: 0.10 }, abrasion: 1.0, bottom: 'rock',
      pool: [{ id: 'barredKnifejaw', w: 0.7 }, { id: 'amberjack', w: 0.6 }, { id: 'redSeabream', w: 0.6 }, { id: 'morayEel', w: 0.5 },
             { id: 'scorpionfish', w: 0.4 }, { id: 'blackSeabream', w: 0.4 }, { id: 'rockfish', w: 0.3 }, { id: 'zombieShark', w: 1 }] },
  ],
  ambience: 'waves', waves: { amp: 0.18, period: 6.0 },
  weatherWeights: { clear: 0.45, cloudy: 0.3, rain: 0.25 },
  look: {
    terrain: { ground: '#3a3634', shore: '#2c2a28', seabed: '#3a4a48', hillAmp: 9, hillScale: 35, noiseSeed: 23, rocky: true },
    ridge: { height: 300, dist: 1100, color: '#3e4e3a', farBankZ: null },             // 이즈의 녹색 구릉 · 바다는 수평선까지
    water: { shallow: '#2f8a8a', deep: '#0d3550', opacity: 0.9, foam: true },
    sky: { zenith: '#4f8ad8', horizon: '#d2e2ee' }, fog: { color: '#c4d4dc', density: 0.0035 },
    vendor: 'truck', lighthouse: { x: 120, z: -40 },
  },
};
```

#### 7.4.4 강 — `data/stages/river.js` (P12 · 시드) — 보너빌 댐 하류

```js
export const RIVER = {
  id: 'river', kind: 'outdoor', unlockLevel: 10,                                          // 🔒 unlockLevel
  spawn: { x: 0, z: 20, yaw: 0 },
  walk: [{ x: -50, z: 1.4 }, { x: 50, z: 1.4 }, { x: 50, z: 32 }, { x: -50, z: 32 }],
  shore: [{ x: -150, z: 2 }, { x: -60, z: 0.5 }, { x: 0, z: 0 }, { x: 60, z: -0.5 }, { x: 150, z: 1 }],
  points: [
    { kind: 'npc',  id: 'vendor', x: 16,  z: 8,  yaw: 0.4,  radius: 2.0, approach: { x: 16, z: 6.6 } },    // 도크
    { kind: 'camp', id: 'camp',   x: -16, z: 14, yaw: -0.3, radius: 1.8, approach: { x: -16, z: 12.6 } },
  ],
  obstacles: [{ x: 16, z: 9.6, r: 1.6 }, { x: -16, z: 14.6, r: 1.4 }],          // 도크 판매 오두막 · 캠프
  spots: [
    { id: 'river_tailrace', stand: { x: -40, z: 1.6 }, facing: 0.15, arc: 0.55, edgeM: 1.3, depth: [[0, 2], [15, 8], [40, 13], [70, 15]],
      minCastM: 6, maxDriftM: 120, farFromM: 50, flow: { x: 1.3, z: 0.2 }, snag: { fromM: 60, rate: 0.08 }, abrasion: 0.6, bottom: 'rock',
      pool: [{ id: 'chinookSalmon', w: 0.9, farMul: 2 }, { id: 'steelhead', w: 0.8, farMul: 2 }, { id: 'americanShad', w: 0.9 }, { id: 'walleye', w: 0.4 },
             { id: 'whiteSturgeon', w: 0.3 }, { id: 'smallmouthBass', w: 0.4 }, { id: 'pikeminnow', w: 0.4 }, { id: 'paleKing', w: 1 }] },
    { id: 'river_trench', stand: { x: 0, z: 1.6 }, facing: 0, arc: 0.6, edgeM: 1.6, depth: [[0, 1], [10, 6], [30, 14], [60, 20]],
      minCastM: 6, maxDriftM: 120, farFromM: null, flow: { x: 0.7, z: 0 }, snag: { fromM: 65, rate: 0.06 }, abrasion: 0.4, bottom: 'gravel',
      pool: [{ id: 'whiteSturgeon', w: 0.8 }, { id: 'channelCatfish', w: 0.8 }, { id: 'walleye', w: 0.7 }, { id: 'burbot', w: 0.5 },
             { id: 'largescaleSucker', w: 0.5 }, { id: 'chinookSalmon', w: 0.4 }, { id: 'pikeminnow', w: 0.4 }, { id: 'paleKing', w: 1 }] },
    { id: 'river_riffle', stand: { x: 40, z: 1.6 }, facing: -0.1, arc: 0.6, edgeM: 2.0, depth: [[0, 0.3], [10, 1.0], [30, 2.2], [60, 3.0]],
      minCastM: 6, maxDriftM: 120, farFromM: null, flow: { x: 1.0, z: 0 }, snag: { fromM: 55, rate: 0.06 }, abrasion: 0.3, bottom: 'gravel',
      pool: [{ id: 'smallmouthBass', w: 1.0 }, { id: 'pikeminnow', w: 1.0 }, { id: 'cutthroatTrout', w: 0.7 }, { id: 'largescaleSucker', w: 0.7 },
             { id: 'americanShad', w: 0.6 }, { id: 'steelhead', w: 0.5 }, { id: 'walleye', w: 0.3 }] },
  ],
  ambience: 'river', waves: { amp: 0.06, period: 2.5 },
  weatherWeights: { clear: 0.45, cloudy: 0.35, rain: 0.2 },
  look: {
    terrain: { ground: '#6a6a50', shore: '#8a8470', seabed: '#4a4a3c', hillAmp: 4, hillScale: 50, noiseSeed: 37 },
    ridge: { height: 520, dist: 900, color: '#3a4a3a', farBankZ: -260 },              // 컬럼비아 협곡 절벽 · 강폭 약 260m
    water: { shallow: '#4a7a6a', deep: '#1a3a44', opacity: 0.88, flowDir: { x: 1, z: 0 } },
    sky: { zenith: '#5a8ccc', horizon: '#d0dce4' }, fog: { color: '#bcc8cc', density: 0.004 },
    vendor: 'dock', dam: { x: -900, z: -120, width: 700, height: 60 },
  },
};
```

### 7.5 입질 · 캐스팅 · 신호 — `data/bite.js` (P1 · 시드)

```js
export const BITE = {
  t0: 28, minWait: 5,                                    // 🔒 평균 대기 = minWait + t0 / W
  timeCoef: { '0': 0, L: 0.25, N: 0.6, H: 1.0 },         // 🔒
  stepUp: { '0': '0', L: 'N', N: 'H', H: 'H' },
  baitFit: [1.0, 0.8, 0.6], baitOther: 0.2,              // 🔒 선호 1·2·3순위 · 그 밖
  layerFit: [1.0, 0.3, 0.08],                            // 🔒 층 차이 0·1·2
  hookBigger: [1.0, 0.6, 0.3],                           // 바늘 − 입 = 0 이하 · 1 · 2 → 입질 배율
  hookSmallerHookOff: [1.0, 1.5, 2.2],                   // 입 − 바늘 = 0 이하 · 1 · 2 → 바늘 빠짐 배율
  fantasyShare: 0.035, fantasyBaitFloor: 0.6,            // 🔒
  driftMinFlow: 0.15, driftMul: 1.4,                     // 흘림: 흐름 ≥ 0.15m/s 에서만 · 입질 ×1.4(+ 먼 곳의 farMul — §5.4.2)
  bottomSlipMul: 0.5, bottomSlipSpeed: 0.5,              // 봉돌이 밀리면 입질 ×0.5 · (흐름 − 버팀) × 0.5 m/s 로 밀린다
  zMin: -2.5, zMax: 3.3,
};
export const LAYER = { surfaceMaxM: 1.2, surfaceFrac: 0.25, bottomGapM: 0.5 };
export const CAST = {
  gaugePeriod: 1.6,                 // 🔒 왕복 1.6초(0 → 1에 0.8초)
  minFactor: 0.3, slope: 0.65,      // 완벽 밖: 비거리 = castMax × (0.3 + 0.65 × power) — 완벽 = ×1.0
  flightBase: 0.5, flightPerM: 0.0286,
  lineReserveM: 10, minLineM: 20, retrieveDoneM: 2.0,   // minLineM ≥ minCastM + lineReserveM + 4 — 거리 상 · 하한이 뒤집히지 않는다
  emptyRetrieveMul: 3,              // 빈 채비 회수 = 릴 회수 속도 × 3(28m 약 6초)
  driftReserveM: 40, driftArc: 1.3, shoreMarginM: 1.0,  // 흘림 상한 = lineM − 40 · 흘림 · 봉돌 밀림은 facing ± 1.3rad 안 · 물가에서 1m 안쪽(§5.2)
  depthMinM: 0.5, depthMaxM: 30, depthStepM: 0.25,
};
export const SIGNAL = {
  firstDelay: [0.3, 0.8], baseStrength: 0.6,
  float:  { nibbles: [1, 3], nibbleDur: 0.25, gap: [0.5, 1.2], takeWindow: 0.9, liftWindowAdd: 0.3 },   // 🔒 takeWindow · 찌올림 본신은 창 +0.3초
  bottom: { tremble: [1.0, 2.5], pulse: 0.4, takeWindow: 1.1 },                     // 🔒 takeWindow
  earlyGrace: 0.10,
};
export const RIG = { failNotice: 1.0, netTime: 0.8 };                               // 🔒 failNotice
```

### 7.6 장비 · 미끼 — `data/gear.js` · `data/baits.js` (P4 · 시드)

| ID | 슬롯 | 세트 | 단계 | 가격 | 주요 값 | 잃을 때 |
|---|---|---|---|---|---|---|
| `rod_float_1` | rod | float | 1 | 0 | castM 24 · maxLoadKg 2.6 · sensitivity 1.0 · lengthM 3.6 | — |
| `rod_float_2` | rod | float | 2 | 40,000 🔒 | castM 30 · maxLoadKg 6 · sensitivity 1.15 · lengthM 3.9 | — |
| `rod_float_3` | rod | float | 3 | 260,000 | castM 38 · maxLoadKg 12 · sensitivity 1.3 · lengthM 4.2 | — |
| `rod_bottom_1` | rod | bottom | 1 | 0 | castM 32 · maxLoadKg 3.2 · sensitivity 1.0 · lengthM 2.7 | — |
| `rod_bottom_2` | rod | bottom | 2 | 45,000 🔒 | castM 42 · maxLoadKg 8 · sensitivity 1.15 · lengthM 3.0 | — |
| `rod_bottom_3` | rod | bottom | 3 | 300,000 | castM 52 · maxLoadKg 16 · sensitivity 1.3 · lengthM 3.3 | — |
| `reel_1` | reel | — | 1 | 0 | maxDragKg 5 · speedMS 1.5 · capacityM 120 · castBonus 0 | — |
| `reel_2` | reel | — | 2 | 190,000 🔒 | maxDragKg 9 · speedMS 1.7 · capacityM 200 · castBonus 0.05 | — |
| `reel_3` | reel | — | 3 | 2,000,000 | maxDragKg 16 · speedMS 2.0 · capacityM 300 · castBonus 0.10 | — |
| `line_1` | line | — | 1 | 0 | strengthKg 4 · biteMul 1.0 · abrasionMul 1.0 · pricePerM 5(집에서는 무료) | 끊긴 길이 |
| `line_2` | line | — | 2 | 0(감기만) | strengthKg 8 · biteMul 0.94 · abrasionMul 0.75 · pricePerM 25 | 끊긴 길이 |
| `line_3` | line | — | 3 | 0(감기만) | strengthKg 18 · biteMul 0.88 · abrasionMul 0.5 · pricePerM 60 | 끊긴 길이 |
| `hook_s` · `hook_m` · `hook_l` | hook | — | 1 | 0 | size 1 · 2 · 3 | lossCost 100 |
| `float_1` | float | — | 1 | 0 | sensitivity 1.0 · stability 0.5 · driftMul 1.0 | lossCost 300 |
| `float_2` | float | — | 2 | 12,000 | sensitivity 1.25 · stability 0.75 · driftMul 1.0 | lossCost 1,000 |
| `float_3` | float | — | 3 | 80,000 | sensitivity 1.5 · stability 1.0 · driftMul 1.0 | lossCost 3,000 |
| `sinker_1` | sinker | — | 1 | 0 | castBonusM 0 · holdMS 0.5 | lossCost 150 |
| `sinker_2` | sinker | — | 2 | 10,000 | castBonusM 4 · holdMS 0.9 | lossCost 500 |
| `sinker_3` | sinker | — | 3 | 70,000 | castBonusM 8 · holdMS 1.4 | lossCost 1,500 |

`export const GEAR = [ … ]` — 위 표의 행마다 `GearDef` 하나(§3.3의 필드 이름 그대로 · 그 슬롯이 쓰지 않는 필드는 생략 · `lossCost`가 없으면 0). `export const GEAR_BY_ID`도 같이.

```js
export const GEAR_GATES = { tier2Level: 5, tier3Level: 12, tier3Mastery: 2 };   // 🔒 (브리프 §4)
export const BAITS = [   // 🔒 가격
  { id: 'worm', packSize: 20, packPrice: 3000 }, { id: 'paste', packSize: 20, packPrice: 2400 }, { id: 'corn', packSize: 20, packPrice: 2000 },
  { id: 'shrimp', packSize: 10, packPrice: 3000 }, { id: 'krill', packSize: 10, packPrice: 2500 }, { id: 'live', packSize: 5, packPrice: 3000 },
];
```

- **라인은 m 단위 소모품이다**: 「라인 감기」(`refillLine`)는 그 세트 릴을 그 라인으로 가득 채운다. 같은 라인이면 모자란 만큼 × `pricePerM`, 다른 라인이면 기존 라인을 버리고 `capacityM × pricePerM`. `line_2` · `line_3`은 레벨 문턱(2단계 5 · 3단계 12+숙련 2)을 따른다. 상점 항목은 세트 × 라인마다 하나(`refill_<set>_<lineId>` — §3.6). 라인이 30m 아래로 줄면 예비 스풀(§5.6).
- 로드 · 릴 · 찌 · 봉돌의 2·3단계는 **보유 수**가 있다(`owned`). 같은 장비를 두 세트에 끼우려면 2개가 있어야 한다(`availableCount`). 1단계와 바늘은 무한.
- 구매 문턱: 2단계 = `level ≥ 5`, 3단계 = `level ≥ 12 && skills.mastery ≥ 2`(브리프 §4 — 부위별로 나누지 않는다). 상점은 잠긴 항목도 보이고 사유를 적는다(`reason.level{n}` · `reason.mastery{n}` · `reason.money` — `reasonParams`).
- 3단계 가격은 「3단계 완비가 레벨 캡보다 먼저 오되 너무 빨리 끝나지 않게」 잡았다(§7.12 M16 — 진행 봇 기준 10~11.5일 · 레벨 20은 20~22일). 3단계 로드 파손은 강 하루 수입의 약 30~35%(M9b).
- 되팔기 없음.

### 7.7 스킬 — `data/skills.js` (P4 · 시드)

0단계 값이 기본(스킬 없음)이다. 랭크는 1 → 2 → 3 순서로만, 1포인트씩. 레벨마다 1포인트(시작 1) → 레벨 20에 누적 20포인트 · 30칸 중 20칸.

| 스킬 | 필드 | 0 | 1 | 2 | 3 |
|---|---|---|---|---|---|
| `casting` 캐스팅 숙련 | castMul · perfectWindow | 1.00 · 0.06 | 1.06 · 0.09 | 1.12 · 0.12 | 1.20 · 0.15 |
| `hookset` 챔질 감각 | hookWindowAdd(s) · earlyBaitKeep | 0 · 0 | 0.12 · 0.25 | 0.24 · 0.50 | 0.36 · 0.75 |
| `dragSense` 드랙 감각 | dragNotches · lineStrMul | 20 · 1.00 | 25 · 1.04 | 30 · 1.08 | 40 · 1.12 |
| `lineCare` 라인 관리 | slackRateMul · abrasionMul | 1 · 1 | 0.8 · 0.8 | 0.65 · 0.65 | 0.5 · 0.5 |
| `pumping` 펌핑 기술 | pumpDrainMul · jumpPumpMul | 1 · 1 | 1.15 · 0.75 | 1.30 · 0.55 | 1.45 · 0.40 |
| `knowledge` 어종 지식 | knowledge | 0 | 1(도감 활동 시간대 · PC 활동 어종) | 2(+ 선호 미끼) | 3(+ 파이팅 체력 바) |
| `baitCraft` 미끼 효율 | biteRateMul · baitKeepOnFail | 1 · 0 | 1.08 · 0.15 | 1.16 · 0.30 | 1.25 · 0.45 |
| `netting` 뜰채 숙련 | netRangeAdd(m) · landStaminaAdd | 0 · 0 | 0.5 · 0.05 | 1.0 · 0.10 | 1.5 · 0.15 |
| `haggling` 흥정 | sellMul | 1.00 | 1.05 | 1.10 | 1.15 |
| `mastery` 낚시 숙련 | signalMul · tier3Unlocked | 1 · false | 1.15 · false | 1.30 · true | 1.50 · true |

`export const SKILLS = [{ id: 'casting', effects: { castMul: [1.00, 1.06, 1.12, 1.20], perfectWindow: [0.06, 0.09, 0.12, 0.15] } }, …]` — 위 표의 필드 이름(= `Modifiers` 필드)과 0~3단계 값 그대로. `computeModifiers(profile)`는 `mods[필드] = effects[필드][skills[id]]`.

`dragNotches`가 바뀌면(`dragSense` — P4 `learnSkill`) 각 세트의 `profile.sets[*].dragNotch`를 같은 비율로 옮긴다(`round(old × new / oldNotches)`). 릴을 바꾸면(P4 `equip`) 그 세트의 드랙 kg을 보존한다: `dragNotch = clamp(round(oldDragKg / newDragNotchKg), 0, dragNotches)`(같은 눈금에서 kg이 튀지 않는다). 어느 경우든 끝에 `ctx.refresh()` → `syncRig`가 rig의 `dragNotch` · `dragNotches` · `dragKg`를 맞춘다 — rig 쪽 필드는 언제나 `syncRig`가 profile에서 맞춘다(§5.2의 `dragSteps` · `applyLoss`의 드랙 낮추기도 profile을 바꾼 뒤 `syncRig`).

### 7.8 파이팅 — `data/fight.js` · `data/fightStyles.js` (P2 · 시드)

```js
export const FIGHT = {
  forceExp: 0.75, speedExp: 0.5, enduranceExp: 0.3,                 // 🔒
  fatigueFloor: 0.3, runFatigueMin: 0.4,
  reelLoadK: 0.25, reelLoadExp: 0.6,
  pumpTension: 0.35, pumpLiftTime: 0.8, rodLowerTime: 0.4, pumpDrain: 1.7,   // 🔒 pumpTension · pumpDrain
  pumpStroke: 2.4, pumpGainFrom: 0.5,                                // 펌핑 거리는 rodLift 0.5 → 1 구간에서만(완전한 스트로크 = 2.4 × 0.5 = 1.2m)
  baseDrain: 0.18, recoverRate: 0.25, recoverBelow: 0.35,            // 🔒 baseDrain
  slipRef: 0.25, minSlipSp: 0.3, stick: 0.5, stickTime: 0.25,        // 🔒 stick · stickTime
  hookGrace: 0.6, startTele: 0.6,                                    // 챔질 뒤 0.6초는 정지 마찰 과부하 없음 · 시작 상태가 질주류면 0.6초 예고
  tensionLambda: 18, minDistPad: 0.5, slackFlowFrac: 0.5, flowLoadK: 0.02,   // 최소 거리 = spot.edgeM + 0.5
  teleF: 0.4, teleAlong: 0.5, teleSp: 0.3, teleDepth: 1.5,
  jumpSpike: 1.1, lowRodAbsorb: 0.55,
  shakePulse: 0.3, shakePulseOn: 0.1, shakeAmp: 0.6,
  coverRate: 0.35, coverEscape: 0.5, coverDecay: 0.3, coverAbrasion: 0.03, maxAbrasion: 0.9,
  netReachM: 1.4, landStamina: 0.15, netRunReset: 3.0, netBufferS: 0.3,   // 🔒 netReachM · landStamina — 뜰채 범위 = spot.edgeM + netReachM(+ 스킬)
  rodStressAt: 0.85, lineDangerAt: 0.85, rodBreakHold: 0.3,          // 🔒 rodBreakHold — 세운 로드가 상한을 0.3초 넘겨야 부러진다
  tiredStamina: 0.3, tiredDepth: 0.4, midDepthFrac: 0.5, depthSpeed: 1.5,
  bearingSlack: 0.35, bearingMinDist: 3.0, nearArc: 0.3, nearDist: 8, maxArc: 1.3,
};
export const HOOK = {                                                // 🔒 전부
  slackFracLine: 0.06, slackFracFish: 0.2, slackRate: 0.06, slackCap: 4, slackDecay: 2,
  jumpPumpP: 0.30, jumpLowP: 0.03, jumpLooseP: 0.25,                 // 세우고 맞으면 0.30 + 0.25 × 예고 직전 느슨함 · 숙이면 0.03
  shakeP: 0.08, tightRef: 0.7,                                       // 흔들기 상태 진입마다 한 번
  activeRate: 0.035, looseBase: 0.1,
};
```

```js
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
```

### 7.9 경제 · 경험치 — `data/economy.js` (P4 · 시드)

```js
export const START = {
  money: 5000, level: 1, skillPoints: 1,                                         // 🔒
  baits: { worm: 20, paste: 20, corn: 0, shrimp: 0, krill: 0, live: 0 },
  sets: {
    float:  { rod: 'rod_float_1',  reel: 'reel_1', hook: 'hook_m', float: 'float_1', sinker: null,       bait: 'worm',  lineId: 'line_1', lineM: 120, depthM: 2.0, dragNotch: 5 },
    bottom: { rod: 'rod_bottom_1', reel: 'reel_1', hook: 'hook_m', float: null,      sinker: 'sinker_1', bait: 'paste', lineId: 'line_1', lineM: 120, depthM: 2.0, dragNotch: 5 },
  },
};
export const XP = {                                                             // 🔒 전부
  base: 45, exp: 1.36, levelCap: 20,           // 다음 레벨까지 = round(45 × L^1.36): 45 · 116 · 200 · 296 · 402 · 515 · 635 · 761 · 893 · 1,031 … 2,468 — 누적 L5 657 · L10 3,863 · L20 21,116
  tierMul: { normal: 1, trophy: 2, legend: 5 }, releaseMul: 0.7,
  firstBase: 8, firstPerXp: 1,                 // 첫 포획 보너스 = 8 + 어종 xp (첫날 정상 경험치의 약 25%)
  recordMul: 0.5,                              // 무게 신기록(첫 포획 제외) 보너스 = round(0.5 × 어종 xp)
  pointsPerLevel: 1,
};
export const PRICE = { trophyPct: 0.90, legendPct: 0.99, legendTargetRatio: 5.0, dzLegendTrophy: 0.97763 };   // 🔒
export const HOLD = { capacity: 12 };                                           // 🔒
export const FREE_BAIT = { baitId: 'worm', count: 10, moneyBelow: 2000 };        // moneyBelow = 가장 싼 미끼 팩 값 — 살 수 없으면 준다
```

- 경험치 = `round(xp × tierMul[tier])` + (첫 포획이면 `firstBase + firstPerXp × xp`) + (무게 신기록이면 `round(recordMul × xp)`) → `xpKeep`. 방생은 `round(xpKeep × releaseMul)`. 실패는 0.
- 시작 시 `dragNotch 5/20` = 1.25kg = 1단계 라인(4kg)의 31% — **드랙을 만지지 않는 플레이어가 기본 봇과 같다.**
- 시작 찌 세트의 바늘은 `hook_m` — 호수 찌낚시의 주 어종(배스 · 가물치 입 3 · 강준치 입 2)에서 빠짐 배율이 1.5를 넘지 않게. 입이 작은 어종(붕어 · 블루길)은 입질 ×0.6 — 채비 패널의 바늘 항목에 「입 크기 소/중/대에 맞음」을 보인다.

### 7.10 봇 — `data/bot.js` (P10 · 시드)

```js
export const BOT = {
  react: { mean: 0.40, sd: 0.12, min: 0.18, max: 0.9 },    // 신호를 보고 Space까지(s) — 본신 창 0.9s 안
  earlyRate: 0.10,                                           // 🔒 예신에 성급히 챔질할 확률(입질당 — 챔질 성공 ≈ 0.90)
  castPower: { target: 0.90, sd: 0.04 },                     // 놓는 게이지 값(완벽 띠를 노린다)
  netReact: 0.30,
  dragEveryTicks: 2,                                         // 🔒 드랙은 2틱에 1눈금까지만 바꾼다(사람의 휠 · Z/C 속도 — 초당 30눈금)
  basic:      { dragRatio: 0.30, reelBelow: 0.50 },          // 🔒 브리프 §7 — 드랙 = 라인 강도의 30% 고정 · 텐션 50% 아래면 릴링 · 펌핑 없음
  controlled: { restDrag: 0.70, runDrag: 0.45, snagDrag: 0.80, rodCap: 0.90, panic: 0.80, reelBelow: 0.70, pumpStart: 0.50, pumpStop: 0.80, teleReact: 0.30 },
  mindless:   { pumpCycle: [0.8, 0.4] },                     // 드랙 최대 · 항상 릴링 · 세우기 0.8s / 숙이기 0.4s 반복
  locked:     { dragRatio: 0.85 },                           // 측정 전용 — 드랙 = 라인의 85% 고정 · 항상 릴링 · 펌핑 · 점프 대응 없음(「드랙 잠그고 감기만」의 반복 전략)
  plans: {   // byBand: [자리, 세트, 미끼]
    lakeDay:  { stage: 'lake',  byBand: { dawn: ['lake_gravel', 'bottom', 'paste'], morning: ['lake_gravel', 'bottom', 'paste'], day: ['lake_gravel', 'bottom', 'paste'],
                                          evening: ['lake_gravel', 'bottom', 'paste'], night: ['lake_gravel', 'bottom', 'worm'] } },
    coastDay: { stage: 'coast', byBand: { dawn: ['coast_channel', 'float', 'krill'], morning: ['coast_shoal', 'float', 'krill'], day: ['coast_shoal', 'float', 'krill'],
                                          evening: ['coast_channel', 'float', 'krill'], night: ['coast_cape', 'bottom', 'shrimp'] } },
    riverDay: { stage: 'river', byBand: { dawn: ['river_tailrace', 'float', 'shrimp'], morning: ['river_tailrace', 'float', 'shrimp'], day: ['river_riffle', 'float', 'worm'],
                                          evening: ['river_trench', 'bottom', 'live'], night: ['river_trench', 'bottom', 'live'] } },
    progress: { coastFromLevel: 5, riverFromLevel: 10, riverHook: 'hook_l',      // 강에서는 두 세트에 큰 바늘(입 3 어종 — 1단계라 무료 · equip)
                buyOrder: ['rod_float_2', 'reel_2', 'line_2', 'float_2', 'rod_bottom_2', 'reel_2', 'sinker_2', 'rod_bottom_3', 'reel_3', 'line_3', 'sinker_3', 'rod_float_3', 'reel_3', 'float_3'],
                skillOrder: ['hookset', 'dragSense', 'mastery', 'mastery', 'netting', 'baitCraft', 'lineCare', 'casting', 'pumping', 'haggling', 'knowledge', 'dragSense', 'netting', 'baitCraft', 'lineCare', 'hookset', 'casting', 'pumping', 'haggling', 'mastery'] },
  },
};
```

### 7.11 화질 · 설정 — `data/settings.js` (P5 · 시드)

```js
export const DEFAULT_SETTINGS = { version: 1, mouseSens: 1.0, invertY: false, quality: 'medium', fov: 70,
  volume: { master: 0.8, sfx: 1.0, ambience: 0.7, ui: 0.8 }, hints: true };
export const QUALITY = {
  low:    { pixelRatio: 1.0, shadows: false, shadowMap: 0,    waterReflect: 'none',   fogParticles: 0,   rainDrops: 600,  terrainSeg: 96 },
  medium: { pixelRatio: 1.5, shadows: true,  shadowMap: 1024, waterReflect: 'sky',    fogParticles: 60,  rainDrops: 1500, terrainSeg: 160 },
  high:   { pixelRatio: 2.0, shadows: true,  shadowMap: 2048, waterReflect: 'planar', fogParticles: 140, rainDrops: 3000, terrainSeg: 256 },
};
export const MOUSE = { radPerPx: 0.0022, spikeClampPx: 120, keyYawRate: 1.2 };   // rad/px(× mouseSens) · 한 이벤트 이동량 상한(스파이크는 버리지 않고 자른다) · 낚시 모드 A/D 조준(rad/s — §11.3)
```

### 7.12 측정 목표 산수 (브리프 §7)

**근거**: 설계 단계에서 §5.3의 파이팅 모델 · §5.4의 입질 모델 · §12.1의 봇 전략 넷 · §7의 값을 Node 스크립트로 그대로 구현해 돌렸다 — 파이팅은 틱 단위(전략마다 물고기 2,000~4,000마리), 하루 · 진행은 대기를 지수분포로 뽑고 파이팅만 틱으로 미는 이벤트 시뮬레이션(하루 20~80시드 · 진행 8~12시드). 아래 「설계 측정」이 그 결과다 — 구현이 계약대로면 같은 근처가 나와야 한다. 벗어나면 먼저 구현을 계약과 대조한다. 설계 스크립트는 바뀌기 전 규칙 · 값으로 돌리면 이 표의 옛 숫자(파이팅 대비 랜딩 89% · 한 판 19/38/99초 · 중형 조절 93/기본 82/무지성 55% · 무지성 파손 17%)를 거의 그대로 낸다(89% · 20/40/97초 · 91/80/58% · 16.5%) — 모델이 계약 본문과 맞는다는 확인이다.

| 목표(브리프) | 설계 산수 · 측정 | 판정 | 조정 손잡이 |
|---|---|---|---|
| 한 판 길이(기본 봇): 소 10–25 · 중 25–60 · 대 60–150초 | 호수 자갈(1단계 · 바닥 · lakeDay 시간대 섞기): 소(<1kg) **21초** · 중(1–5kg) **36초** · 대(≥5kg) **약 100초**(입질 신호 2초 + 뜰채 0.8초 포함) | ○ | `STYLES.*.endurance` · `FIGHT.baseDrain` · 릴 `speedMS` |
| 첫 입질 대기(입문 · 호수): 15–45초 · 부적합 · 비활동 2–4배 | 자갈 · 바닥 · 떡밥 · 아침: W = 1.29 → 5 + 28/1.29 = **26.7초**. 크릴(호수 풀에 선호 어종 없음): W = 0.47 → 65.0초(**2.4배**). 크릴 + W 최저 시간대(낮): W = 0.39 → 76.7초(**2.9배**) | ○ | `BITE.t0` · `BITE.baitOther` |
| 처음 성공까지 1–3회 | 입질당 랜딩 ≈ 0.77 → 3회 안에 랜딩 못 할 확률 1.2% | ○ | — |
| 랜딩 성공률 60–80% · 끊김 ≤ 15% · 빠짐 ≤ 20% (기본 봇 · 입질 대비) | 챔질 성공 0.90(성급 10%) × 파이팅 대비 랜딩 85% = **77%**(하루 시뮬레이션 80시드도 77%). 끊김 11%(대부분 31m부터의 장애물 띠 — 드랙 31%면 중형이 띠로 달아난다) · 빠짐 2% · 헛챔질 10% | ○(상한까지 3%p) | `lake_gravel.snag` · `BOT.earlyRate` · `HOOK.activeRate` |
| 드랙이 의미 있다(중형 이상 ≥ 1kg) | 랜딩: 조절 **94%** · 기본 73% · 무지성 65% → **조절 − 무지성 29%p** · **조절 − 기본 20%p**. 「드랙 고정(85%) + 감기만」(locked): 중형 92%(라인보다 한참 약한 물고기는 그래도 잡힌다 — 현실 그대로) · **대형(≥5kg) 조절 64% vs 고정 52%(12%p)** | ○ | `FIGHT.stick` · `FIGHT.stickTime` · `lake_gravel.snag` |
| 장비가 의미 있다(흰철갑상어 중앙값 16.3kg · 강 깊은 홈) | 1단계: 기본 0% · 조절 0%(스풀 바닥 37% · 끊김 53%) / 3단계 + 조절 **97%** · 2단계 + 조절 94% | ○ | `whiteSturgeon.fight.stamina`(2.5) · `reel_1.capacityM` |
| 성격이 다르다 | 6종의 텐션 최대 · 분산 · 질주 수 · 슬랙 비율을 `styles.report.test.js`가 표로 낸다(서로 다른 2개 이상 지표가 갈린다 — §12.3). 무게형은 질주가 시간의 약 12%라 변동계수 · 분당 질주 수가 돌진형의 절반 아래 | 보고 | `STYLES` 상태 표 |
| 성격마다 공정하다(M14 — 대응하면 잡힌다) | 성격 6 × 대표 어종 중앙값(붕어 · 참돔 · 쏘가리 · 큰입배스 · 돌돔 · 블루길) × 그 자리 · 그 스테이지 장비 단계 · 입에 맞는 바늘: 조절 **89–100%** · 기본 88–100% · 바늘 빠짐 최대 12%(큰입배스 — 점프) | ○ | `HOOK.*` · `STYLES.*.states` |
| 라인 끊김 손실 ≤ 소형 2마리 | 찌 세트: 미끼 150 + 바늘 100 + 찌 300 + 라인 30m × 5 = **700** · 바닥: 120 + 100 + 150 + 150 = **520** ≤ 블루길 중앙가 429 × 2 = **858** | ○ | `lossCost` · `line_1.pricePerM` |
| 2단계 로드 파손 = 하루 수입 20–40% | 호수 기본 봇 하루 매출 평균 약 12.4만(아래) → `rod_float_2` 40,000 = **32%** · `rod_bottom_2` 45,000 = **36%** | ○ | 로드 가격 |
| 3단계 로드 파손 = 강 하루 수입 20–40%(M9b) | 강 3단계 · 조절 봇 `riverDay` 하루 매출 중앙 약 86만 → `rod_float_3` 260,000 = **30%** · `rod_bottom_3` 300,000 = **35%** | ○ | 3단계 로드 가격 |
| 로드 파손 빈도(중형 이상 파이팅당): 조절 ≤ 2% · 기본 ≤ 5% · 무지성 ≥ 15% | 조절 0% · 기본 0%(펌핑 안 함) · 무지성 **16%**(1단계 로드 3.2kg < 라인 4kg < 최대 드랙 5kg · 상한을 `rodBreakHold` 0.3초 넘겨야 부러진다). 1kg 미만은 로드 상한에 닿지 않아 표본에서 뺀다 | ○(무지성 하한 근처) | `FIGHT.rodBreakHold` · `rod_*_1.maxLoadKg` |
| 실패 → 재도전 2초 · 입력 2번 | 알림 1.0초 + 충전 0.7초(게이지 0.88) = **1.7초** · 누름/뗌. 라인이 모자라도 예비 스풀(§5.6)로 같다 | ○ | `RIG.failNotice` · `CAST.gaugePeriod` |
| 하루 수입(입문 · 호수 · 기본 봇) = 미끼 20 + 2단계 한 부위의 50–100% | 하루(06:00 → 다음 06:00 · 이동을 빼고 약 21.5시간 낚시 · 80시드): 입질 62 · 랜딩 48 · 매출 평균 **12.4만** · 중앙 12.3만 · p10 10.0만 · p90 15.4만(트로피 · 레전드 몫 21%). 지출(캐스팅 62번 ≈ 미끼 7.5천 · 채비 · 라인) 뒤 **순수입 중앙 11.0만** = 미끼 20개(2,700) + `reel_2` 190,000의 **56%** | ○ | 호수 어종 `pricePerKg` · `reel_2` 가격 |
| 첫 장비 업그레이드 0.5–1.5일 | 돈은 0.3일에 4만(로드)을 넘는다 · 레벨 5 문턱이 먼저 → 레벨 5 직후 집에 들러 **약 1.2–1.4일**(진행 봇 — §12.1) | ○ | `XP.base` |
| 레벨 5 · 10 (기본 봇 · 매 시간대): 1–2 · 4–7일 | 일일 경험치(정상 + 첫날의 첫 포획): 호수 1단계 약 475 + 120 · 갯바위 1–2단계 약 880 + 175 · 강 2단계 약 850 + 230. 누적 657 → **1.13–1.33일** · 3,863 → **5.1–5.4일**(진행 8시드) | ○ | `XP.base · exp` · 어종 `xp` |
| 레벨 20(조절 봇): 15–30일 | 누적 21,116 · 강 3단계 조절 하루 약 1,030 + 첫 포획 → **20.4–22.2일**(진행 12시드 — 부러진 로드 · 예비 스풀로 내려간 라인을 다시 사는 진행 봇) | ○ | `XP.exp` |
| 강 진입이 보상이다(M15) | 레벨 10 · 2단계 · 조절 봇: `riverDay` 순수입 중앙 약 43만 vs `coastDay` 약 39만 → **1.1배** · 입질 대비 랜딩 81%(진행 봇은 강에서 `hook_l`) | ○ | `chinookSalmon.fight.force` 먼저 · `GEAR_GATES.tier3Level`은 브리프 §4 변경이라 Jay가 정할 것 |
| 돈이 레벨보다 먼저 끝나지 않는다(M16) | 3단계 완비(약 474만) **10.0–11.5일**(그때 레벨 약 14–15) — 레벨 20(20–22일)까지 돈은 미끼 · 라인 · 파손 재구매와 기록 경신용으로 남는다(내구도 · 수리는 로드맵 v0.3) | ○(하한 근처) | `reel_3` 가격 |
| 후반 한 판 길이(M1b) | 조절 봇: 흰철갑상어 3단계 중앙 **71초** · 트로피급 153초 · 치누크 3단계 27초 · 트로피급 57초 · 갯바위 2단계 돌돔 20초 · 참돔 16초 — 몇 분씩 누르는 판이 없다 | ○ | `whiteSturgeon.fight.stamina` · `STYLES.heavy.endurance` |
| 시간대 출현 분포 | 표본이 위 가중치 식을 따르는지 검사(§12.2 biteModel) · 계수 0이면 0 | 테스트 | — |
| 트로피 · 레전드 비율 9–11% · 0.7–1.3% | 분포에서 직접 — 10,000 표본의 이항 오차 ±0.6%p · ±0.2%p | 테스트 | — |
| 가격 비율: 트로피/비트로피 ≥ 2.0 · 레전드/트로피 4–6 | 트로피 배율 ≥ 2.3 × 무게비 > 1 → ≥ 2.3. 레전드/트로피 = 5.0(배율로 맞춤 — §7.3.4) | ○ | `trophyBonus` |
| 판타지 희귀도: 조건 안 2–5% · 밖 0 | 선호 미끼 3.5% · 그 밖 미끼 2.1%(바닥 0.6) · 조건 밖 확률 0 | ○ | `BITE.fantasyShare` |
| 결정성 · 예외 0 · NaN 0 · 돈 음수 0 | 순수 sim · 시드 난수 · 상태 해시(§12.4) | 테스트 | — |
| 데이터 완결성 | 36행 · 스테이지마다 12종(≥ 10) · 층 × 시간대마다 ≥ 1종(§12.2) | 테스트 | — |

측정의 한계(봇이 쓰지 않는 수단): 마우스 조준(봇은 정면 yaw) · 흘림과 먼 곳의 `farMul` · 수심 미세 조정 · 파이팅 중 베일 · 시간 건너뛰기(측정은 매 시간대 낚시) · 뜰채 스킬 외 장비 선택의 최적화 — `NOTES-BALANCE.md`에 적는다. 하루 · 진행 산수는 걷기 · 판매 동선을 상수 시간으로 셌다(판매 25초 · 집 왕복 2시간).

## §8 콘텐츠 프레임워크

여러 개 만드는 것 — 어종 · 파이팅 성격 · 스테이지 · 낚시 자리 · 장비 · 미끼 · 스킬 — 은 **데이터 행 + (필요하면) 소품 빌더 하나**로 들어온다. 로직 파일(`sim/` · `view/` 레이어)은 ID별 분기를 두지 않는다. W2의 P11 · P12는 **프레임워크 파일을 한 줄도 고치지 않고** 갯바위 · 강을 완성한다.

### 8.1 어종 하나 더하기

1. 그 스테이지의 `data/species/<stage>.js` 배열에 `SpeciesRow` 한 행(§3.3 — `look` 포함).
2. 그 스테이지 `data/stages/<stage>.js`의 한 자리 이상 `pool`에 `{id, w}`.
3. `data/strings.ko.js`에 `species.<id>` 이름(부록 B). — 이것만 P8 소유 파일이라 W2에서는 NOTES로 요청한다(P0이 36종 이름을 W0에 넣어 두므로 v0.1에는 필요 없다).
4. 끝. `derive.js`가 분포 · 문턱 · 가격 배율을 붙이고, `data.schema.test.js`가 새 행을 자동으로 덮는다(필수 필드 · 참조 · 분포 · 체형 · 완결성).

`look.body`는 체형 템플릿 5종 중 하나다. 새 체형(가오리형 · 복어형 — 로드맵 v0.3)은 `fishModel.js`의 템플릿 표에 한 항목과 `BODY_TEMPLATES`에 이름 하나를 더하는 모양으로 들어온다.

### 8.2 파이팅 성격 · 특성 — `buildBrain(species)` (P2)

성격(`STYLES`) 6종이 상태 기계의 뼈대이고, 특성(`TRAITS`)은 그 표를 **데이터로 고치는** 수정이다. 어종의 `fight` 배율은 힘 · 속도 · 체력에만 곱한다.

합치는 규칙(이 순서, `species.traits` 순서대로):

```
states = structuredClone(STYLES[style].states) ; start = STYLES[style].start ; abrasionMul = 1 ; visual = []
특성마다:
  addStates     : 이름 그대로 넣는다(같은 이름이 있으면 특성 쪽으로 바꾼다)
  addNext       : {출발 상태: {도착: 가중치}} — 출발 상태가 없으면 그 항목은 무시. 도착 가중치에 더한다
  scaleByKind   : {kind: {f, sp, durMul, lateral}} — 그 kind 의 모든 상태에 곱한다(dur 은 양끝에 durMul)
  nextMulByKind : {kind: 배율} — 모든 상태의 next 중 도착 상태의 kind 가 일치하는 가중치에 곱한다
  start         : 시작 상태 이름 바꾸기
  abrasionMul   : 곱한다
  visual        : 모은다
검증(fishBrain.test): start 가 있다 · 모든 next 도착 상태가 있다 · 모든 상태의 next 가중치 합 > 0 · 모든 상태가 start 에서 닿는다
```

- `fight.js` · `fishBrain.js`에 **어종 ID 문자열이 나오면 실패**(테스트가 소스를 훑는다). 「포악한 개체는 요동, 붕어는 단순히 무겁다」는 전부 표의 차이다.
- 새 특성은 `TRAITS`에 한 항목. 새 행동 kind는 `BEHAVIOR_KINDS`와 `updateFight`의 특수 처리(5)에 한 갈래 — 이것만 프레임워크 변경이다.

### 8.3 스테이지 · 낚시 자리

스테이지 하나 = `data/stages/<id>.js`(sim이 읽는 배치 · 자리 · 풀 + view의 `look`) + `view/stages/<id>Props.js`(그 장소의 소품 — §9.4) + `data/species/<id>.js`(어종 행). 레지스트리(`data/stages/index.js` · `data/species/index.js` · `view/stages/index.js`)는 v0.1의 세 스테이지를 이미 담고 있다. 4번째 스테이지(로드맵 v0.3)는 레지스트리 세 줄과 `SCENE_IDS` · `STAGE_IDS`에 이름 하나를 더한다.

- WorldLayer(P5)는 `look.terrain` · `look.water` · `look.ridge` · `look.sky` · `look.fog`와 `shore` · `walk` · `spots`만으로 지형 · 물 · 하늘 · 자리 표식 · 장애물 띠 표식 · NPC · 캠프를 **일반적으로** 그린다. 장소의 개성(갯바위의 용암 암반 · 등대 · 어판장 트럭, 강의 댐 · 협곡 · 도크, 호수의 갈대 · 좌판)은 그 스테이지의 Props가 그린다.
- 낚시 자리 하나 = `SpotDef` 한 행. 수심 프로필 · 흐름 · 장애물 띠 · 암반 · 풀이 그 자리의 성격을 정한다.

### 8.4 장비 · 미끼 · 스킬

- 장비 = `GEAR` 한 행(§7.6). 슬롯 6개는 고정이다. 4 · 5단계(로드맵 v0.3)는 행 + `GEAR_GATES`의 문턱 하나.
- 미끼 = `BAITS` 한 행 + `BAIT_IDS`에 이름. 어종의 `baits`가 그 ID를 참조한다.
- 스킬 = `SKILLS` 한 행: `{id, effects: {<Modifiers 필드>: [0단계, 1, 2, 3]}}`. `computeModifiers`는 각 필드에 `effects[필드][랭크]`를 넣는다. **한 필드는 스킬 하나만 건드린다**(스키마 테스트). 새 효과 필드는 `Modifiers` · `RigStats`에 필드를 더하고 그 값을 쓰는 곳을 고치는 계약 변경이다.

### 8.5 로드맵이 열려 있게 둔 자리 (v0.1에서 구현하지 않는다)

- 루어낚시(v0.2): `SET_IDS`에 `'lure'`, `RigPhase`에 리트리브 단계, 입질 모델에 「액션 적합도」 곱 하나. 지금의 rig 단계 기계는 세트별 분기를 `set === 'bottom'` 한 곳(층 · 봉돌 밀림 · 신호 모양)에만 둔다.
- 다중 로드 거치대(v0.2): `state.rig`를 배열로 바꾸는 계약 변경이다 — v0.1은 단일 로드로 확정한다.
- 내구도 · 수리 · 되팔기(v0.3): `owned`를 개체 배열로 바꾸는 계약 변경.

---

## §9 view 계약 (P5 · P6 · P7 · P11 · P12)

### 9.1 공통

- view는 `GameState`를 **읽기만** 한다. 상태 객체에 필드를 붙이거나 고치지 않는다. 뷰 쪽 기억은 자기 객체에 둔다.
- 레이어 모양: `constructor(deps)` · `update(state, alpha, dt)` · `dispose()`. `dt`는 렌더 프레임 시간(초, 일시정지 중에도 연출 시간은 흐른다 — 물결 · 불꽃). `alpha`는 §5.9의 보간 계수.
- 레이어는 필요한 이벤트를 **스스로 구독**하고 `dispose`에서 끊는다. **이벤트 누락에 안전**: `update`에서 `state.scene` · `state.player.mode` · `state.rig.phase` · `state.fight`의 유무가 자기 캐시와 다르면 이벤트를 받은 것과 같은 전환을 스스로 한다(최소 부트 · 디버그 경로 · 불러오기에서 이벤트 없이 상태만 바뀌어도 화면이 따라온다).
- 씬 그래프: `rc.scene` 아래 레이어마다 자기 `THREE.Group` 하나 — `worldRoot`(P5) · `tackleRoot`(P6 — 월드 공간의 라인 · 찌) · `fishRoot`(P6) · `fxRoot`(P7). 1인칭 로드는 `rc.camera`의 자식 그룹 `viewModel`(P6) — 렌더러(P5)가 카메라를 `rc.scene`에 넣어 둔다. 남의 그룹에 자식을 넣지 않는다.
- sim → three: 위치 `(x, y, z)`의 y는 view가 정한다(지형 `heightAt` · 수면 0 · 물고기 `−depth`). 회전 `rotation.y = yaw`(모델은 −Z가 앞).
- 외부 에셋 0 — 지오메트리 조합 · 절차 텍스처 · 셰이더만. **절차 텍스처는 `THREE.DataTexture`(Uint8Array에 직접 그린다)로 만든다 — DOM 없이 Node 테스트에서도 빌더가 돈다**(`CanvasTexture` 금지). 폰트도 시스템 폰트.
- 같은 판을 여러 번 해도 쌓이지 않는다(QUALITY §6): 물고기 모델 · 입자는 **풀**에서 꺼내 쓰고, 씬은 부팅 때 한 번 만든다. `rc.renderer.info.memory`의 geometries · textures가 판을 반복해도 늘지 않는다(테스트 · 화면 패스에서 잰다).
- 첫 진입의 멈칫: app이 씬 전환 막 아래에서 `rc.prewarm()`을 부른다(셰이더 컴파일).

### 9.2 렌더러 · 화질 — `view/renderer.js` (P5)

- `WebGLRenderer({antialias: quality !== 'low', powerPreference: 'high-performance'})` · `outputColorSpace = SRGB` · `toneMapping = ACESFilmic` · 노출 1.0 · 그림자 PCF(`QUALITY[q].shadows`).
- 픽셀 비율 = `min(devicePixelRatio, QUALITY[q].pixelRatio)`. 캔버스 크기의 주인은 렌더러(`window` resize 구독).
- 후처리 없음(블룸 · 비네트를 쓰지 않는다 — 연출이 정보를 가리지 않게 · 성능). 발광은 `emissive`와 밝은 색으로.
- `setQuality(q)`: 픽셀 비율 · 그림자 · 물 반사 · 안개 입자 · 빗방울 수를 바꾼다(레이어는 `SETTINGS_CHANGED`에서 `QUALITY[settings.quality]`를 다시 읽는다).
- WebGL 생성 실패 → `createRenderContext`가 던진다 · `webglcontextlost` → app이 일시정지 + 안내(§11.10).

### 9.3 월드 — `view/WorldLayer.js` (P5)

부팅 때 네 씬(집 · 호수 · 갯바위 · 강)을 전부 만들고 `state.scene`에 맞춰 `visible`만 바꾼다(로딩 없음).

| 요소 | 규칙 |
|---|---|
| 하늘 | 돔 셰이더: `look.sky.zenith/horizon`을 `clock.light`로 어둡게 · 일출/일몰(해 고도 −0.1..0.3 rad)에 지평선 주황 · 해 원반(`sunAzim` · `sunElev`) · 밤에 달(해의 반대 방향, 고도 −sunElev) · 별(light < 0.3에서 나타난다). 흐림 · 비는 채도를 낮추고 구름층(셰이더 노이즈)을 덮는다 |
| 조명 | 방향광 1개(해 또는 달 — 그림자 광원은 이것뿐) + 반구광. 세기 · 색은 `clock.light` · 해 고도. 밤: 달빛 0.12 수준 + **헤드랜턴**(`env.headlamp` — 카메라에 붙은 스포트라이트, 거리 25m · 각 0.5rad · 그림자 없음)으로 찌 · 초리 · 가까운 수면이 보인다 |
| 안개 | `FogExp2`: 밀도 = `look.fog.density × weather.fog`, 색 = 하늘 지평선색 × light. 실내는 안개 없음 |
| 지형 | 하이트맵 메시: 해안선(`shore`) 바깥 땅은 +Z로 갈수록 완만히 오르고(노이즈 `look.terrain`), 물 쪽은 각 자리의 `depth` 프로필을 해안선 거리로 펴 바닥을 만든다(가장 가까운 자리의 프로필 · 자리 사이는 보간). 먼 산/절벽(`look.ridge`)은 저폴리 띠. `heightAt(x, z)`는 **이 메시를 만든 같은 함수**다 |
| 설 자리 높이 | `heightAt(stand) ∈ [0.3, 1.2]`(물가의 둑 · 바위 위). 걷는 영역 안의 경사는 30° 이하 |
| 물 | `y = 0` 평면(호수 · 갯바위는 반경 3km, 강은 `farBankZ`까지). 셰이더: 파도(`env.waveAmp` · `wavePeriod` — 정점 변위는 high만, 그 밖은 노멀만) · 흐름 방향(`look.water.flowDir`)으로 흐르는 무늬 · 깊이에 따른 색(`shallow` → `deep`) · 프레넬 하늘 반사(`QUALITY.waterReflect`: none = 단색 · sky = 하늘색 반사 · planar = 반사 렌더 타깃 1/2 해상도) · 밤에는 어둡고 달빛 반짝임 · 비가 오면 빗방울 파문(medium 이상) · 갯바위는 해안선 거품(`look.water.foam`) |
| 비 | `env.rain > 0` && 야외: 카메라를 따라다니는 빗줄기(`QUALITY.rainDrops` 개의 선분 · 한 번의 draw call) |
| 자리 표식 | 낚시 자리마다 바닥 고리(반경 1.2m · 반투명 흰 선 · 발광 약하게) + 작은 깃대(높이 1.1m). `player.nearby.kind === 'spot'`이면 고리가 밝아진다. 낚시 중인 자리의 고리는 숨긴다 |
| 장애물 띠 | 자리마다 `snag.fromM … fromM + 8m`, `facing ± arc` 부채꼴 수면에 **수초(호수) · 물 위로 솟은 바위 끝(갯바위) · 쓰러진 나무(강)** 표시. 일반형은 P5가 `spot.bottom`으로 고른다(mud → 수초 · rock → 바위 · gravel → 쓰러진 나무/큰 돌) |
| NPC | 단순 관절 인형(머리 · 몸통 · 팔 · 다리 — 앞치마/모자 색은 스테이지별 `look.vendor`로), 숨쉬는 대기 동작 · 플레이어가 반경 안이면 고개를 돌린다. 판매 구조물(좌판 · 트럭 · 도크)은 그 스테이지 Props가 `points`의 npc 위치에 그린다 |
| 캠프 | 텐트 + 모닥불(밤에 점광원 · 불꽃 셰이더) + 접이식 의자 — 일반형(P5) |
| 집 | 방 셸(벽 · 바닥 · 천장 · 창 — 창밖은 `clock`으로 하늘색) + homeProps(책상 · 모니터(발광 화면) · 의자 · 침대 · 문 · 선반의 로드 걸이) — 상호작용 대상이 한눈에 보인다 |

### 9.4 스테이지 소품 — `view/stages/<id>Props.js` (P5 · P11 · P12)

```js
/** @param {{stage:StageDef, quality:'low'|'medium'|'high', heightAt:(x:number,z:number)=>number}} args
 *  @returns {{group:THREE.Group, update(env:PropsEnv, dt:number):void, setQuality(q):void, dispose():void}} */
export function buildCoastProps(args)
/** @typedef {{hour:number, light:number, night:boolean, sunDir:THREE.Vector3, weather:WeatherId, waveAmp:number, wavePeriod:number, time:number, camPos:THREE.Vector3}} PropsEnv
 *  time: 렌더 시계(초) — 물결 · 깃발 · 불빛 연출용 */
```

- WorldLayer가 부팅 때 한 번 부르고 그 씬의 그룹에 넣는다. 매 프레임 `update(env, dt)`(그 씬이 보일 때만).
- 소품은 지형 위에 `heightAt`으로 놓는다. **걷는 영역(`walk`) 안에서 높이 0.5m를 넘는 것은 `stage.obstacles` 원 안에만 둔다**(걷기 충돌은 다각형 + 그 원뿐 — 1인칭 카메라가 물체를 뚫지 않게). 판매 구조물은 npc 쪽 obstacles 원 안, 캠프(P5 일반형)는 camp 쪽 원 안.
- 낚시 자리에서 `facing ± arc` · 60m 안의 수면 시야를 가리는 것을 두지 않는다(장애물 띠 표식은 WorldLayer가 그린다).
- 스테이지의 개성: **호수**(P5) — 갈대 군락 · 자갈 물가 · 수몰 나무 · 좌판(파라솔 + 아이스박스) · 건너편 산 능선(청풍). **갯바위**(P11) — 검은 용암 암반(각진 저폴리 덩어리) · 파도 부서짐 거품 · 해안 절벽 · 등대 · 어판장 트럭 · 소나무. **강**(P12) — 넓은 강폭 · 강물 흐름이 보이는 물결 · 하류 쪽 자갈톱 · 상류의 보너빌 댐 구조물(실루엣 · 방류구 물보라) · 협곡 절벽 · 나무 도크와 판매 오두막.

### 9.5 카메라 — `view/CameraRig.js` (P5)

- 위치 = 보간 `player.pos` + `(0, heightAt(pos) + WORLD.eyeHeight, 0)`. 회전 = app의 `look`(보간 없음). `fov` = `settings.fov`.
- 걷기 흔들림: `player.speed > 0.1`이면 진폭 0.03m · 빈도 1.8Hz × (speed / walkSpeed). 낚시 모드 · 패널 중에는 없다.
- `PLAYER_PLACED` · `SCENE_CHANGED`에서 한 프레임에 붙는다(보간 · 스무딩 없음). 그 밖에 한 프레임 순간이동 금지.
- 집 실내: 걷는 영역이 벽에서 0.4m 안쪽이라 카메라가 벽을 뚫지 않는다. 시야 근평면 0.05m.

### 9.6 물고기 모델 — `view/fish/fishModel.js` (P6)

`buildFishModel(species, lengthM, {silhouette, lod})` → `THREE.Group`: 머리 −Z · 원점 = 몸 중심 · **Z 길이 = lengthM(±3%)** · 높이 = `look.depth × lengthM` · 폭 = 템플릿 폭 비 × lengthM.

| 템플릿 | 몸통 단면 · 옆모습 | 폭 비 | 꼬리 · 지느러미 | 대표 |
|---|---|---|---|---|
| `fusiform` 방추형 | 둥근 단면 · 앞 1/3이 가장 높은 어뢰형 | 0.16 | 갈라진 꼬리 · 등지느러미 1~2 | 배스 · 연어 · 쏘가리 |
| `compressed` 측편형 | 납작한 타원 단면 · 높은 등 | 0.10 | 갈라진 꼬리 · 긴 등지느러미 | 붕어 · 잉어 · 돔 |
| `eel` 장형 | 긴 원통 · 일정한 높이 | 0.09 | 둥근 꼬리 · 등~꼬리로 이어진 긴 지느러미 | 가물치 · 곰치 · 버봇 |
| `shark` 상어형 | 둥근 단면 · 뾰족한 주둥이 | 0.17 | 위가 긴 비대칭 꼬리 · 큰 삼각 등지느러미 · 큰 가슴지느러미 · 아가미 틈 | 좀비 · 핑크 상어 |
| `benthic` 저서형 | 넓고 납작한 머리 · 배가 평평 | 0.20 | 둥근/비대칭 꼬리(`scutes`면 철갑상어 꼬리) · 수염(`barbels`) | 메기 · 철갑상어 · 동자개 |

- 무늬는 `DataTexture`(어종별로 한 번 만들어 캐시): bars(세로 띠) · spots · stripe(옆줄 띠) · mottled · scales(비늘 음영) · mirror(드문 큰 비늘) · scutes(등 · 옆의 골판 줄) · gold(금속 · 반짝임) · zombie(탈색 + 어두운 상처 + 갈비뼈 무늬) · ghost(반투명 0.55 + 발광). `glow`는 `emissive`(강도 0.6 — 밤 물속에서 빛난다). `accent`는 아가미 아래 작은 띠.
- 눈(흰자 + 검은 동공)과 입을 반드시 그린다 — 실루엣만으로 체형이 갈리고, 색 · 무늬로 같은 체형 안의 어종이 갈린다(결과 패널에서 회전하며 보인다 — 브리프 §5).
- `silhouette: true`: 검은 무광 재질(도감의 안 잡은 어종). `lod 1`: 삼각형 ≤ 400(점프 · 뜰채) · `lod 0`: ≤ 3,000(미리보기).

### 9.7 1인칭 채비 — `view/tackle/TackleLayer.js` (P6)

카메라 자식 `viewModel`: 오른손 + 로드(로드 손잡이 = 카메라 공간 `(0.26, −0.30, −0.42)`) + 릴 + 왼손(뜰채 때만). 월드 공간(`tackleRoot`): 라인 · 찌 · 캐스팅 궤적.

| 단계 | 로드 각(수평 위, °) | 그 밖 |
|---|---|---|
| 걷기(`idle`) | 숨김(빈손) | — |
| `ready` | 35 | 찌 · 봉돌이 로드 끝에 매달려 흔들린다 |
| `charging` | 35 → 110(머리 뒤, `power`로 ease) | 게이지는 ui. **`aimPreview` 고리**(P6 — `tackleRoot`의 수면 y 0.02 링 · 반경 0.6m · 중심 `rig.aimPreview`(x, z) · `power ≥ perfectFrom`이면 밝게) — 장애물 띠 표식과 같은 화면에서 착수점이 보인다 |
| `casting` | 110 → 20을 0.18초에 휘두른 뒤 25 | 찌/봉돌이 로드 끝 → 착수점 포물선(`castT`, 꼭대기 = 0.25 × distM) |
| `waiting` · `retrieving` · `bite` | 찌 25 · 바닥 30 | 라인: 로드 끝 → `bobber`(늘어짐 0.08 × dist) · 릴 손잡이는 `retrieving`에서 돈다 |
| 찌 신호 | — | 찌 높이(보이는 크기 `scale` 적용 전 m): 예신 = `−strength × 0.5 × 안테나 길이(0.30m)` 0.25초 톡(안테나 절반까지 잠긴다) · 본신 sink = 완전히 잠김 / lift = 0.15초에 걸쳐 +0.12m 솟고 창이 끝날 때까지 누운 채 |
| 바닥 신호 | 예신 = 로드 끝 떨림(±0.02rad × strength, 18Hz) · 본신 = 끝이 15° 숙여지고 끝의 방울이 흔들린다 | — |
| `fighting` | `lerp(15, 75, rodLift)` · 로드가 물고기 방향(bearing)으로 60% 돌아간다 | **휨** = `clamp(sqrt(tension / rodMaxLoadKg), 0, 1.1)` → 끝 곡률 최대 70°(보이는 값만 sqrt — 0.1kg 블루길도 움직임이 보인다 · 판정은 그대로) · 힘이 작은 물고기(`k.Fmax < 0.5`)는 상시 잔떨림(0.004rad · 12Hz) · `rodStress` 또는 `lineDanger`면 떨림(0.01~0.03rad) · 라인은 로드 끝 → 물고기 입수점(늘어짐 = 0.15 × dist × (1 − clamp(tensionRatio × 4, 0, 1))) · 릴 손잡이 회전 = `gainSpeed` · 베일 암 = `bailOpen` |
| `landing` | 60 · 왼손 뜰채(손잡이 길이 = `fight.netRangeM − 0.75`(팔 0.4 + 테 0.35) · 테 반경 0.35m — 스킬로 늘면 뜰채가 길어진다)가 물고기를 떠 올린다(0.8초) | — |
| `FIGHT_END{rodBreak}` | 로드 끝 1/3이 꺾여 떨어진다 → `RIG_RESTORED`에서 예비 로드가 아래에서 올라온다(0.3초) | — |
| `FIGHT_END{landed}` | 로드는 파이팅 자세 그대로 landing 으로 넘어간다 — 원위치는 `CATCH_RESULT`(성공) · `FAIL`에서 | — |

- **찌의 보이는 크기**: 몸통 0.10m + 안테나 0.30m(주황 · 노랑 띠)를 `scale = clamp(dist / 7, 1, 18)`로 키운다 — 7m 너머에서는 화면 크기가 거의 같다(120m 흘림에서도 예신 침하 ≥ 6px @ 1280×720 · FOV 70 — §9.10). 위치는 정확히 `bobber`. `env.headlamp`이면 안테나 위 1/3이 연두로 발광(emissive 1.0 — 장비가 아닌 상시 연출 · 케미라이트 장비는 v0.2) — 헤드랜턴 사거리(25m) 밖의 밤 찌도 보인다.
- 로드 · 릴의 생김새는 단계로 갈린다: 1단계 무광 회녹색 · 2단계 카본 검정 + 붉은 감기 · 3단계 광택 검정 + 금색 감기. 길이는 `rodLengthM`.

### 9.8 물고기 그림자 · 점프 — `view/fish/FishLayer.js` (P6)

- 파이팅 중: 물고기 위치 = `origin + fwd(bearing) × dist`(보간), 수면 아래 `−depth`. **그림자**(어두운 타원 데칼, 길이 = `roll.lengthCm/100`, 폭 0.35×) — 불투명도 `clamp(0.55 × (1 − depth / 8), telegraph ? 0.35 : 0.15, 0.55)`(깊은 자리에서도 예고는 보인다 — sim이 예고 중 수심을 `FIGHT.teleDepth`로 올린다 §5.3.4), 질주(kind run · dive)면 V자 물결 자국, 예고 중에는 그림자 위 수면에 V자 물결.
- `fight.inCover ≥ 0.5`(박힘)면 그림자가 바닥 쪽으로 가라앉아 흐려지고 둘레에 흙탕 얼룩.
- `FIGHT_END{landed}`부터 landing 동안 그림자 대신 뜰채 속 모델. 그림자 퇴장은 `CATCH_RESULT` · `FAIL`에서.
- 예고: `telegraph.kind === 'jump'` → 그림자가 수면으로 올라오며 진해지고 커진다 · `'run'` → 그림자가 꼬리를 친다(앞뒤 흔들림) · `'charge'`(사라짐) → 그림자가 옅어진다(0.1).
- 점프(`airborne > 0`): `lod 1` 모델이 수면 위로 `airborne × (0.3 + 0.5 × lengthM)` m 솟아 몸을 뒤튼다. 뜰채(`landing`): 그물 안에 모델.
- 특성 `visual`: `tremble` → 그림자 잔떨림 · `spin` → 그림자 회전. 판타지 `glow` → 밤에 그림자 대신 희미한 빛.

### 9.9 연출 — `view/fx/FxLayer.js` (P7)

| 이벤트 | 연출 | 상한 |
|---|---|---|
| `CAST_SPLASH` | 물보라(입자 20) + 파문 고리 1 | — |
| `BITE_NIBBLE` | 찌 둘레 작은 파문(바닥 세트는 없음) | — |
| `BITE_TAKE` | 찌 자리 파문 2 | — |
| `HOOK_SET` | 입수점 물보라 작게 | — |
| `FIGHT_BEHAVIOR{run}` · `slipping` | 입수점에서 라인이 물을 가르는 물보라 줄기(속도 ∝ slipSpeed) | — |
| `FIGHT_JUMP`(leave · land) | 큰 물보라(입자 40 · 크기 ∝ lengthM) + 파문 | — |
| `NET_START` | 뜰채 물보라 | — |
| `CATCH_RELEASED` | 발밑 물보라 작게 | — |
| 비(`env.rain`) | 수면 빗방울 튐(medium 이상) | — |
- 입자 · 고리는 미리 만든 풀(입자 400 · 고리 24)에서 꺼낸다. **화면 전체를 덮는 섬광 · 점멸 · 비네트 없음**(QUALITY §4). 물보라는 불투명도 0.8 이하.

### 9.10 판정과 보이는 것 (한 표)

| 무엇 | 판정 | 보이는 것 | 허용 차 |
|---|---|---|---|
| 낚시 자리 상호작용 | `dist(player, stand) ≤ WORLD.spotRadius`(1.4m) | 바닥 고리 반경 1.2m + 깃대 | 0.2m |
| NPC · 캠프 · PC · 침대 · 문 | `≤ point.radius`(1.2~2.0m) && 시선이 `WORLD.interactFov`(±70°) 안 | 물체 외곽이 반경 − 0.4m 안 | 0.4m |
| 착수점 | `rig.bobber` | 찌 · 물보라의 중심 | 0 |
| 조준 | `aimYaw = facing ± arc` | `aimPreview` 고리(충전 중 수면 — P6 TackleLayer) | 0 |
| 찌 신호 | `signal`(예신 · 본신) | 찌 예신 침하 ≥ 6px @ 1280×720 · FOV 70 · `dist ≤ maxDriftM`(§9.7 `scale`) | — |
| 물고기 위치 | `origin + fwd(bearing) × dist` · `−depth` | 그림자 · 점프 모델 중심 | 0 |
| 뜰채 범위 | `dist ≤ netRangeM`(= `spot.edgeM` + 1.4m + 스킬) | 팔 0.4m + 손잡이(`netRangeM − 0.75`) + 테 0.35m = `netRangeM` · 물고기는 `edgeM + 0.5` 안으로 오지 않는다(땅 위에 그려지지 않는다) | ≤ 0.35m |
| 장애물 띠 | `dist ≥ snag.fromM` | 수초 · 바위 · 나무 띠가 `fromM`부터 | 1m |
| 로드 휨 · 떨림 | `rodLoadRatio` · `rodStress` | §9.7 | — |
| 텐션 | `fight.tension`(평활된 판정 값) | 게이지(`limitRatio`) · 로드 휨(`tension / rodMaxLoadKg`의 sqrt) · 라인 톤(`limitRatio`)이 **같은 tension**에서 나온다 | 0 |

### 9.11 화질 단계 (`QUALITY` — §7.11)

| | low | medium | high |
|---|---|---|---|
| 픽셀 비율 상한 | 1.0 | 1.5 | 2.0 |
| 그림자 | 없음 | 1024 | 2048 |
| 물 반사 | 단색 | 하늘색 반사 | 평면 반사(½ 해상도) |
| 물 정점 파도 | 없음 | 없음 | 있음 |
| 안개 입자 · 빗방울 | 0 · 600 | 60 · 1,500 | 140 · 3,000 |
| 지형 분할 | 96 | 160 | 256 |

목표: 중급 GPU · medium · 1080p에서 60fps. 레이어는 `SETTINGS_CHANGED`에서 바꾼다.

### 9.12 소리 — `audio/AudioEngine.js` (P7)

그래프: `AudioContext` → 버스(`sfx` · `ambience` · `ui` 게인) → 마스터 게인(`settings.volume.master`) → **리미터**(`DynamicsCompressor` threshold −6dB · ratio 20 · attack 0.003 · release 0.25) → 출력. 외부 음원 없이 전부 합성(오실레이터 · 노이즈 버퍼 · 필터 · 엔벌로프). 동시 목소리 상한 24 — 넘으면 가장 오래된 일회성 소리를 끊는다.

| 이벤트 | 소리 |
|---|---|
| `CAST_RELEASE` | 휙(필터 노이즈 스윕 0.25초 · 완벽이면 한 음 높게) |
| `CAST_SPLASH` | 퐁당(노이즈 버스트 + 낮은 사인 하강 · 거리로 감쇠) |
| `BITE_NIBBLE` | 찌: 물방울 톡(사인 블립 900→600Hz, 크기 ∝ strength) / 바닥: 방울 작게 |
| `BITE_TAKE` | 찌: 퐁(낮은 블립) / 바닥: 방울 딸랑딸랑(종 배음 3번) |
| `HOOK_SET` · `HOOK_MISS` | 챔질 휙 + 로드 퉁 · 헛 바람 |
| `FIGHT_TELEGRAPH` | run · dive: 물살이 부푸는 노이즈(payload `lead`초 동안) / jump: 물속 꿀렁 / charge: 라인 늘어지는 낮은 휘파람 |
| `FIGHT_JUMP` | 철썩(큰 물보라 · 크기 ∝ lengthM) |
| `FIGHT_SHAKE` | 로드 덜컹(짧은 저음) |
| `ROD_STRESS{on}` | 로드 삐걱(공진 노이즈 — on 동안 반복) |
| `FIGHT_END` | lineBreak · spoolEmpty: 탁(날카로운 클릭 + 고음 노이즈) / rodBreak: 우지끈 / hookOff: 툭 / landed: 없음 |
| `NET_START` · `CATCH_RELEASED` | 뜰채 첨벙 · 작은 첨벙 |
| `CATCH_RESULT` · `RECORD` · `LEVEL_UP` | 짧은 성공 화음 · 트로피/레전드 팡파르 · 레벨 업 아르페지오 |
| `SOLD` · `BOUGHT` · `SKILL_LEARNED` | 동전 · UI 차임 |
| `DRAG_CHANGED` · `BAIL_CHANGED` | 딸깍(조이면 높게 · 풀면 낮게) · 베일 딸깍 |
| `CAST_BLOCKED` · 사유 알림 · 패널 열기/닫기 | UI 부정음 · UI 클릭 |

지속음(`update(state, dt)` — 30ms로 평활):
- **라인 텐션 톤**: 파이팅 중 삼각파 `160 + 540 × clamp(sqrt(limitRatio), 0, 1.1)` Hz · 게인 `0.02 + 0.10 × limitRatio`(보이는 게이지와 같은 `limitRatio` — 로드가 묶고 있으면 로드 한계 기준). `limitRatio ≥ 0.85`부터 삐걱 노이즈(밴드패스 800–1500Hz)를 `(ratio − 0.85) / 0.15`만큼 섞는다.
- **드랙 클리커**: `slipping` 동안 클릭(3ms 고역 노이즈)을 초당 `6 + 40 × slipSpeed`번 — 「지이익」.
- **릴 톱니**: `gainSpeed > 0`(또는 `retrieving`) 동안 초당 `10 + 25 × 속도`번.
- **물살**: 질주 · 잠수 중 미끄러질 때 노이즈 스위시, 좌우 팬 = `sin(bearing − 카메라 yaw)`.
- **환경음**(씬 × 시간대 × 비, 2초 교차): 호수 — 새벽 새 · 낮 바람 · 밤 귀뚜라미 / 갯바위 — 파도(저역 노이즈 × `wavePeriod` LFO) · 낮 갈매기 / 강 — 끊이지 않는 물살 + 먼 댐 울림 / 집 — 낮은 실내음 + 시계 째깍 / 비 — 고역 빗소리 층.
- 정리: `FIGHT_END` · `FISHING_EXIT` · `SCENE_CHANGED`에서 파이팅 지속음을 끈다. `setPaused(true)`면 `suspend()`.

---

## §10 ui 계약 (P8)

### 10.1 진입점 · 공통

- `UIRoot`는 `#ui-root`(전체 화면 · `pointer-events: none` — 패널만 `auto`) 아래 DOM을 만든다. 스타일은 `ui/style.css`(UIRoot가 import — vite가 번들에 넣는다). 폰트는 시스템 폰트(`system-ui, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif`) — 외부 폰트 없음.
- ui는 **상태를 읽고 sim 명령을 부른다.** 상태를 고치지 않는다. 숫자 · 퍼센트 표시는 `Intl.NumberFormat('ko-KR')`.
- 매 프레임 `update(state, dt)`에서 HUD 값을 갱신한다(바뀐 것만 DOM에 쓴다). 이벤트는 알림 · 배너 · 패널 열기에만 쓴다.
- **패널 자가 동기화**(`update` 안 — 이벤트를 놓쳐도 막히지 않는다): result 패널이 스택에 있는데 `rig.phase !== 'result'`면 그것을 닫는다 · 자동 패널이 켜져 있고(`setAutoPanels`) 스택이 비어 있고 `rig.phase === 'result' && state.pendingCatch`면 `openPanel('result')` · sell · camp · map · bed · pc 패널은 `state.scene`이 바뀌거나 `player.nearby`가 그 대상이 아니게 되면 닫힌다.
- 1280×720과 1920×1080에서 겹침 · 잘림 없음(QUALITY §4) — 화면 비례 단위(`clamp()` · `vh`)로 배치하고 화면 패스에서 두 해상도를 본다.
- 문자열 키가 화면에 그대로 보이면 실패다(`t()`가 없는 키를 만나면 개발 중 경고 · `ui.strings.test.js`가 소스의 `t('…')` 리터럴 키가 모두 있는지 본다).

### 10.2 패널 목록

| 패널 | 여는 것 | 읽는 상태 | 부르는 명령 | 키 |
|---|---|---|---|---|
| `title` | 부팅 · `quitToTitle` | 세이브 유무 · 손상 · 미래 버전(app이 args로) · 안내 문구 | `actions.newGame()` · `continueGame()` | ↑↓ · Enter/Space. 「새 게임」에 세이브가 있으면 `confirm{danger:true}`(본문 「기존 기록(레벨 n · 돈 n원)은 백업된다」) |
| `pause` | Esc(패널 없음 · 걷기 또는 파이팅 중) · 포커스 잃음 — **다른 패널 위에 겹친다**(§10.4) | `settings` | `actions.resume()` · `applySettings(partial)` · `quitToTitle()` | 탭: 설정(감도 · Y반전 · 볼륨 4종 · 화질 3단계 · FOV · 안내 문구 — 쿼리로 덮인 항목은 「이번 실행만」 표시) / 조작 안내 / 타이틀로. Esc는 닫는다(= resume — 아래 패널이 다시 보인다) |
| `tackle` | Tab(걷기 · `ready` · `charging` · `waiting` · `retrieving` · `failed`에서 — 입질 · 파이팅 · 랜딩 · 결과 중에는 열지 않고 `reason.busy` 알림) | `profile.sets` · `getRigStats` · `previewEquip` · `getDex` · `previewSkill` | `equip` · `setBait` · `setDepth` · `learnSkill` | 탭 3개: 채비 · 도감 · 스킬. Tab · Esc로 닫는다. 바늘 항목에 「입 크기 소/중/대에 맞음」 |
| `result` | `CATCH_RESULT`(자동 패널) · 자가 동기화(§10.1) | `state.pendingCatch` · `HOLD` · `profile.hold` · `getSellQuote` | `keepCatch(opts)` · `releaseCatch()` | **Space = 어창**. 어창이 차 있으면 Space = 「어창에서 가장 싼 것(이름 · 가격)과 바꾸기」(`keepCatch({swapUid})`), 새 물고기가 그것보다 싸면 Space 비활성 · 안내 · **KeyX = 방생**. 열린 뒤 0.25초 키 무시 |
| `sell` | `INTERACT{npc}` | `profile.hold` · `getSellQuote` · `getShop`(미끼 · 라인 감기만) | `sellAll` · `sellOne` · `buy('bait_*')` · `refillLine` | 탭: 판매 · 미끼 · 라인 |
| `pc` | `INTERACT{pc}` | `getShop` · `getForecast` · `getDex` · `previewSkill` | `buy` · `equip`(「사고 바로 끼우기」) · `refillLine` · `learnSkill` | 탭 4개: 상점 · 날씨 · 도감 · 스킬 |
| `camp` | `INTERACT{camp}` | `clock` · 다음 시간대 | `actions.waitNextBand()` · `actions.travel('home')` | 항목 3: 기다리기(→ 「HH:MM 저녁」) · 집으로 · 닫기 |
| `map` | `INTERACT{door}` | `getTravel()` | `actions.travel(id)` | 스테이지 카드 3: 이름 · 참고 장소 · 오늘 날씨 · 잠김 사유(「레벨 5 필요」) |
| `bed` | `INTERACT{bed}` | `clock` | `actions.sleep()` | 「다음 날 06:00까지 잔다」 확인 |
| `confirm` | 다른 패널 · app — 위에 겹친다 | args `{titleKey, bodyKey, bodyParams, onYes, danger}` | — | Enter/Space는 포커스된 항목 실행 · Esc 아니오. 처음 포커스: 보통 「예」 · `danger`면 「아니오」(연타로 덮어쓰지 않는다) |

- **사기 전 · 후 수치를 나란히**(QUALITY §3): 상점 · 채비의 장비 항목은 `ShopItem.previews`(세트별 — 공용 부위는 찌 · 바닥 둘 다) 또는 `previewEquip`의 RigStats에서 비거리 · 로드 상한 · 최대 드랙 · 회수 속도 · 라인 강도 · 스풀 · 감도를 `현재 → 바꾸면`으로 보이고, 오르는 값은 초록 · 내리는 값은 주황. 스킬은 `SkillPreview.before/after`. 라인 감기는 세트 × 라인마다 한 줄(그 세트 기준 비용).
- 잠긴 항목도 보인다(사유 문구 `t('reason.' + reason, reasonParams)` — 「레벨 5가 필요하다」).
- 결과 패널: 어종 이름 · `FishPreview` 회전 모델 · 길이 cm · 무게 kg · 등급 배지(트로피 ★ · 레전드 ★★) · 첫 포획/신기록 배지 · 추정가(흥정 반영) · 받을 경험치(어창 / 방생 둘 다) · 어창 n/12.
- 도감 카드(PC와 Tab 공용 컴포넌트): 스테이지 탭 → 12장. 카드의 모델은 `FishPreview.snapshot` 이미지(안 잡음은 실루엣), 포커스된 카드 하나만 회전 캔버스(`show`). 안 잡음: 실루엣 · 이름 · 서식층 · (지식 1) 활동 시간대 막대 · (지식 2) 선호 미끼. 잡음: 컬러 모델 · 최대 길이 · 최대 무게 · 마릿수 · 첫 포획일 · 트로피 ★ / 레전드 ★★ · 트로피 문턱 무게. 판타지는 「전설」 표식(금테).

### 10.3 HUD

| 자리 | 내용 |
|---|---|
| 좌상단 | 시계 `HH:MM`(`formatClock`) · 시간대 아이콘 · 일출/일몰 띠(05:30–19:30 위의 지금 위치) · 날씨 아이콘 · 돈 · 레벨 + 경험치 바(캡이면 가득 · `hud.levelMax` 「MAX」) · `profile.skillPoints > 0`이면 배지 「스킬 +n (Tab)」 |
| 우상단 | 어창 `n/12`(차면 주황) · 스테이지 이름 |
| 하단 중앙(낚시 모드) | 채비 요약: 세트(찌/바닥) · 로드 이름 · 라인 kg · **라인 잔량 m**(물속에 있을 때 `lineM − dist < CAST.driftReserveM`이면 주황 — 걸면 질주를 버틸 여유가 적다) · 미끼 이름 × 개수 · (찌) 수심 m · 드랙 눈금 · 지금 층(표층/중층/바닥) |
| 화면 중앙 아래 | 상호작용 프롬프트(「E 낚시 자리에 서기」 · 「E 판매상」 …) · 낚시 단계 안내(「좌클릭을 누르고 있다가 놓아 던진다」 — 첫 몇 번) · 포인터 락이 없고 드래그 대체도 아니면 `prompt.clickToLook`(「클릭해서 시점 고정」) |
| 캐스팅 | 파워 게이지(가로 막대 · 완벽 띠 `perfectFrom..1` 강조 · 현재 `power`) |
| 파이팅(우하단 · 대상을 가리지 않는 자리) | **텐션 게이지**(`fight.limitRatio` — 지금 묶인 한계 대비 %: < 60 녹 · 60–85 황 · ≥ 85 적 — 적에서 테두리만 점멸 · `limitBy === 'rod'`면 게이지 머리에 로드 아이콘) · **드랙 눈금**(릴 최대 대비 · 라인 유효 강도 위치에 빨간 눈금 · 로드 상한 위치에 주황 눈금) · 거리 m · 라인 잔량 m(30m 아래 주황) · 예고 아이콘(질주 · 점프 · 잠수 · 사라짐 — `telegraph`) · 장애물 경고(`inSnag`) · 「박힘」(`inCover ≥ 0.5`) · 로드 경고(`rodStress`) · (지식 3) 물고기 체력 바 · 「Space 뜰채」(canNet) |
| 알림 | 실패(`FAIL` — 잃은 것 한 줄 + 바늘 빠짐 원인 한 줄 · 예비 로드 · 예비 스풀 · 낮춘 드랙) · 헛챔질/늦음 · 미끼 없음 · 라인 부족 · 어창 가득 · 어창이 찬 채 캐스팅 시작(그 낚시 진입에서 한 번 `reason.holdFullCast` 「어창이 가득 — 잡으면 바꾸거나 방생해야 한다」) · 무료 미끼 지급 · `RIG_BUSY` — 화면 위쪽 가운데 · 쌓이면 최대 3줄 |
| 배너 | 트로피 · 레전드 · 첫 포획 · 신기록 · 레벨 업(「Tab → 스킬」 포함) · 새 스테이지 · 3단계 해금(`LEVEL_UP` · `SKILL_LEARNED`의 `unlocks`) — 화면 위 1/4 띠(대상 · 찌를 가리지 않는다) · 2.5초 |
| 안내 문구(`HINT_IDS` 10종) | `start` 새 게임 첫 play 프레임(집: 「WASD 이동 · 마우스 둘러보기 · E 상호작용 — 문으로 나가 호수로 · PC: 상점 · 날씨 · 도감 · 스킬」) · `stage` 첫 야외 도착(「바닥의 흰 고리가 낚시 자리(E) · 판매상에게 판다 · 캠프: 다음 시간대로 건너뛰기 · 집으로」) · `controls` 첫 낚시 진입(낚시 조작 · A/D 조준 · Esc 일어나기) · `cast` 첫 캐스팅 · `bite` 첫 입질(챔질의 뜻) · `fight` 첫 파이팅(**드랙 · 텐션의 뜻**) · `net` 첫 뜰채 · `drift` 흐르는 자리 첫 찌 · `bottomRig` 첫 바닥 채비 · `holdFull` 어창이 처음 찼을 때 — 비차단 카드 6초 또는 클릭 · `sim.markHintSeen(id)` · `settings.hints`가 false면 없음 |

- **알림 · 배너 · 안내 카드의 수명**은 `ui.update(state, dt)`의 `dt`로 깎고, `PAUSED{true}`이거나 `isBlocking()`인 동안 멈춘다(정지 화면 확인 · 패널 동안 사라지지 않는다). `FAIL` 알림은 `rig.phase === 'failed'`인 동안 보이고 그 뒤 0.3초 페이드.

### 10.4 입력 포커스 규칙

- **패널 스택**(깊이 ≤ 3): 바탕 패널(title · tackle · result · sell · pc · camp · map · bed) 위에 `confirm` · `pause`가 겹친다. `openPanel(바탕 패널)`은 스택의 바탕을 교체하고(위의 겹친 패널은 닫는다), `openPanel('confirm' | 'pause')`는 위에 쌓는다. `pause`가 맨 위면 `confirm`만 그 위에 열리고 다른 요청은 무시한다. `title`은 스택을 비우고 연다. `closePanel()`은 맨 위만 닫고, 아래 패널은 같은 args로 다시 보인다(`PANEL_INPUT_GRACE`를 다시 적용). **포커스 잃음 · 탭 숨김으로 열린 pause가 결과 · 타이틀 · 확인 패널을 지우지 않는다.**
- 스택이 비어 있지 않으면 `isBlocking() = true` → app이 sim을 멈추고(§5.8) 키를 `ui.handleKey`에 먼저 준다. 패널이 처리한 키는 게임 입력으로 새지 않는다(`InputCollector.setCapture(false)` — 에지를 버리고 홀드만 추적).
- 닫힌 뒤: 패널이 열려 있는 동안 누르기 시작해 지금도 누르고 있는 이동 키는 「눌림」으로 잡힌다(QUALITY §1 — InputCollector가 물리 키 상태를 늘 추적한다).
- 패널이 열린 뒤(또는 다시 보인 뒤) `PANEL_INPUT_GRACE`(0.25초) 동안 그 패널의 확인 키(Space · Enter · KeyX)를 버린다 — 뜰채 Space 연타가 결과를 고르지 않는다.
- Esc 순서: 스택이 있으면 맨 위를 닫는다(`result`는 닫히지 않는다 — 고를 때까지 · `title`도 닫히지 않는다) → 낚시 모드 + (`ready` · `charging` · `casting` · `waiting` · `retrieving` · `failed`)면 `exitFishing` → 그 밖이면 `pause`. app이 풀지 않은 포인터 락 상실도 이 순서로 한 번 처리한다(§11.2).

### 10.5 키보드만으로

모든 패널: ↑↓(목록) · **Q/E = 언제나 탭 전환** · ←→ = 포커스된 항목이 값 조절형(수심 · 슬라이더 · 화질 3단계)이면 그 값(수심 ±0.25m · 슬라이더 ±5% · 단계 ±1), 아니면 탭 전환 · Enter/Space(실행) · Esc(닫기). 값 조절형 항목에는 「◀ ▶」 표식을 둔다. 포커스된 항목은 테두리 + 밝기로 보인다. 마우스 클릭도 된다.

### 10.6 문자열 — `data/strings.ko.js` (P8) · `ui/i18n.js`

- `export const STRINGS = { 'hud.tension': '텐션', … }` — **평평한 객체**(키 = 점 경로 문자열). `t(key, {n})`는 `{n}` 치환.
- 데이터 이름은 규칙 키: `species.<id>` · `stage.<id>` · `stagePlace.<id>` · `spot.<id>` · `gear.<id>` · `bait.<id>` · `skill.<id>` · `skillDesc.<id>.<rank>` · `band.<id>` · `weather.<id>` · `layer.<id>` · `set.<id>` · `tier.<id>` · `fail.<reason>` · `reason.<reason>` · `hint.<id>.title` · `hint.<id>.body` · `style.<id>` · `npc.<stage>.greet`. P0이 부록 B의 키를 W0에 다 넣는다.
- UI 문면은 이 파일 하나(CLAUDE.md). 다른 파일에 한국어 문자열 리터럴을 두지 않는다(데이터 표 포함 — 이름은 키로).

---

## §11 app 계약 (P9)

### 11.1 부트스트랩 — `main.js` · `app/Game.js`

`main.js`는 `new Game(document).start()`만 한다(예외는 `markError`). `Game.start()`의 순서(의존 순서 그대로):

```js
// 0. 오류 수집: window 'error' · 'unhandledrejection' → errors[] 에 쌓고, 부팅 표식 전이면 markError(사유)
persisted = storage.loadSettings()                     // 저장된 설정
query    = parseQuery(location.search)                 // §11.6
settings = {...persisted, ...query.overrides}          // 레이어에 주는 Settings — 이후 같은 객체를 유지(필드만 바꾼다). writeSettings 는 persisted 만(§11.5)
bus      = new EventBus()
loaded   = query.devSession ? {save: null, broken: false, future: false} : storage.loadSave()
seed     = query.seed ?? newSeed()                     // newSeed = (Date.now() ^ (Math.random() * 2**32)) >>> 0 — app에서만
profile  = (query.level || query.money) ? makeDevProfile({level: query.level, money: query.money}) : undefined
sim      = new GameSim({ bus, seed, save: loaded.save, profile,
                         session: { ignoreGates: !!(query.scene || query.spot), devSession: query.devSession },
                         start: { scene: query.scene, spotId: query.spot, hour: query.time, weather: query.weather } })
try { rc = createRenderContext(canvas, settings) }
catch (e) { ui(최소) · showFatal('fatal.webglTitle', 'fatal.webglBody') ; markError('webgl') ; return }
world   = new WorldLayer({ rc, bus, settings })
camera  = new CameraRig({ camera: rc.camera, settings, world })
tackle  = new TackleLayer({ rc, bus, settings, world })
fish    = new FishLayer({ rc, bus, settings, world })
fx      = new FxLayer({ rc, bus, settings, world })
audio   = new AudioEngine({ bus, settings })
preview = new FishPreview()
ui      = new UIRoot({ root, bus, sim, settings, actions, fishPreview: preview })
input   = new InputCollector({ canvas, settings, bus })
installDebugApi(window, game)
bus.on(EV.PLAYER_PLACED, p => input.setLook(p.yaw, p.pitch))
sim.start()                                            // 레이어가 받는 첫 SCENE_CHANGED
query.fixture ? sim.debugLoadState(makeFixtureState(query.fixture)) · fixtureMode = true   // §11.6 — sim 을 밀지 않는다
query.bot ? (bot = createBot({...}) · ui.setAutoPanels(false))
query.devSession ? 화면 'play' (+ query.panel 이면 그 패널) : ui.openPanel('title', {hasSave, saveBroken: loaded.broken, saveFuture: loaded.future})
루프 시작 → 첫 프레임을 그린 직후 markReady()
```

매 프레임(이 순서):

```
frameDt → input.setMode(state.player.mode) · input.tick(frameDt)
(멈춤 · fixtureMode 가 아니고 ui.isBlocking() 이 false 면) §5.9 누산 루프:
  사람: sim.step(input.buildFrame())
  봇:   a = bot.decide(state, sim) → a.command 가 있으면 step 전에 실행(travel · waitNextBand · sleep 은 actions.*(전환 막), 그 밖은 sim[name](...args))
        → rig.phase === 'result' 면 그 틱은 step 하지 않는다 · 아니면 sim.step(a.input)   (결과 단계에서도 decide 는 프레임마다 한 번 부른다 — 명령으로 풀린다)
look = input.look
camera.update(state, alpha, dt, look)
world.update · tackle.update · fish.update · fx.update (state, alpha, dt)
audio.update(state, dt) ; ui.update(state, dt)
rc.render()
저장 요청이 있었으면 한 번 저장(§11.5)
```

### 11.2 화면 상태 기계 — `app/screens.js`

```
boot ──▶ title ──(새 게임 / 이어하기)──▶ play ◀──(이동 · 기다리기 · 수면 — 전환 막)──▶ play
            ▲                              │
            └──────(타이틀로)───────────────┘        pause · 패널은 play 위의 오버레이
```

| 전이 | 절차 |
|---|---|
| title → play(이어하기) | `fade(true, 0.3)` → `ui.closePanel()` → `screen = 'play'` → `settle()` → `fade(false, 0.4)` |
| title → play(새 게임) | 세이브가 있으면 `confirm{danger:true}`(「기존 기록(레벨 n · 돈 n원)은 백업된다」) → `storage.backupSave()` → `sim.newGame(newSeed())`(§6.3 — 파이팅 · 결과 중이었어도 남는 것이 없다) → 위와 같은 막 |
| 이동 `actions.travel(id)` | `fade(true, TRANSITION.out)` → `ui.closePanel()` → `r = sim.travel(id)`(실패면 `toast(reason)` · 막 걷기) → `rc.prewarm()` → `settle()` → `fade(false, TRANSITION.in)` — **합 1초 이내**(브리프 §3.1) |
| 기다리기 `waitNextBand` · 수면 `sleep` | 같은 막 · `sim.waitNextBand()` / `sim.sleep()` |
| 타이틀로 | 저장 → 막 → `screen = 'title'` → `ui.openPanel('title')` |

- `TRANSITION = {out: 0.45, in: 0.45}`(`app/screens.js` 상수). `settle()` = 렌더한 프레임 2개 또는 250ms 중 먼저(숨은 탭에서도 걷힌다).
- 전이 중에는 다른 전이 요청을 무시한다. 전이 중 들어온 일시정지 요청은 `pendingPause = true`로 기억하고, 전이가 끝난 직후(`fade(false)` resolve) `document.hasFocus() === false`이거나 숨은 상태면 그때 일시정지한다. 낚시 모드에서는 이동 · 기다리기를 부를 수 없다(sim이 `busy` — 캠프 · 문은 걷기 상호작용이다).

**일시정지**:
- Esc는 §10.4 순서로 처리한다(패널 닫기 → 낚시 일어나기 → `pause`).
- **app이 풀지 않은 포인터 락 상실**(브라우저가 Esc로 락을 푼 경우 — Escape keydown이 페이지에 오지 않을 수 있다)은 **Esc 한 번**으로 다룬다(§10.4 순서). 같은 200ms 안의 Escape keydown과 겹치면 한 번만 처리한다. 그래서 낚시 자리에서 Esc는 브라우저와 무관하게 「일어나기」다.
- **무조건 일시정지**는 창 포커스 잃음(`blur` · `visibilitychange → hidden`)뿐이다: `screen === 'play'`이면 `input.releaseAll()` · `audio.setPaused(true)` · `ui.openPanel('pause')`(스택 위에 겹친다 — §10.4) · `PAUSED{true}`. `title` · 전이 중에는 `input.releaseAll()` · `audio.setPaused(true)`만(타이틀 패널을 지우지 않는다).
- `PANEL_CLOSED{pause}`면 누가 닫았든 `PAUSED{false}`. 돌아오면 루프 기준 시각을 다시 잡고 `acc = 0`(돌아온 프레임에 틱이 몰리지 않는다). `?nopause=1`이면 포커스 잃음으로 멈추지 않는다(개발용).
- Chrome · Edge에서 「락 중 Esc → 일어나기 · 패널 Esc 닫기 → 클릭으로 시점 다시 고정」이 한 번씩만 처리되는지는 「사람이 확인할 것」(README)에 적는다.

### 11.3 입력 — `app/input.js` · `data/keybinds.js`

```js
// data/keybinds.js (P9 · 시드) — KeyboardEvent.code · 마우스 'Mouse0'(좌) 'Mouse1'(가운데) 'Mouse2'(우)
export const KEYBINDS = {
  forward: ['KeyW'], back: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
  interact: ['KeyE'], hook: ['Space'], bail: ['KeyR'],
  dragTighten: ['KeyZ'], dragLoosen: ['KeyC'],                // + 휠 ↑ 조이기 / 휠 ↓ 풀기 (브리프 §6)
  depthDeeper: ['ArrowUp'], depthShallower: ['ArrowDown'],
  setFloat: ['Digit1'], setBottom: ['Digit2'],
  tackle: ['Tab'], pause: ['Escape'], release: ['KeyX'],
  primary: ['Mouse0'], secondary: ['Mouse2'], lookDrag: ['Mouse1'],
};
export const WHEEL = { pxPerStep: 100, linePx: 33 };          // deltaY 100px = 1눈금 (DOM_DELTA_LINE은 ×33) · 누적해서 정수만 내보낸다
```

- 키는 `event.code`로 읽는다(한글 IME). **`ctrlKey` · `altKey` · `metaKey`가 눌린 이벤트는 건드리지 않는다**(매핑 · preventDefault 둘 다 안 함).
- 게임 중(`screen === 'play'`) 막는 기본 동작: Tab · Space · 화살표 · 휠 스크롤 · 우클릭 메뉴(`contextmenu`) · 마우스 옆 버튼(3 · 4 — 뒤로/앞으로). 타이틀 · 패널에서도 Tab · Space · 화살표는 패널 탐색에 쓰고 페이지로 넘기지 않는다.
- **에지 규칙**: `buildFrame()`은 지난 `buildFrame` 이후 쌓인 에지를 그 틱에 한 번 내보내고 비운다. 렌더 프레임에 틱이 0번이면 에지는 다음 틱까지 남는다(씹히지 않는다). 한 프레임에 틱이 여럿이면 첫 틱에만.
- 홀드(이동 · 좌 · 우클릭)는 물리 상태를 늘 추적한다 — 패널이 열려 있던 동안 누른 키도 닫힌 뒤 「눌림」이다.
- **시선**: 포인터 락이면 `movementX/Y`를 이벤트당 `MOUSE.spikeClampPx`로 **잘라서**(버리지 않는다) `yaw −= dx × MOUSE.radPerPx × settings.mouseSens`, `pitch −= dy × … × (invertY ? −1 : 1)` → `[pitchMin, pitchMax]`.
- **포인터 락 규칙**:
  1. `requestPointerLock`은 사용자 활성화가 있는 처리기 안에서만 부른다 — `pointerdown` · `click` · Enter/Space `keydown`(그 키로 패널이 닫힌 경우 포함). Esc · Tab으로 패널이 닫힌 뒤에는 부르지 않고 HUD에 `prompt.clickToLook`(「클릭해서 시점 고정」)을 띄운다(브라우저는 Esc를 활성화로 치지 않고, Esc로 푼 직후 재요청을 잠시 거부한다).
  2. 락이 없을 때 캔버스의 `pointerdown`은 **락만 요청하고 삼킨다** — `primary` · `primaryPressed` · `secondary`로 내보내지 않고, 그 버튼을 뗄 때까지 홀드도 무시한다(락을 잡으려는 클릭이 캐스팅 충전을 시작하지 않는다).
  3. `POINTER_LOCK.available`은 API가 없거나 **한 번도 성공한 적 없이** 첫 요청이 실패했을 때만 false다. 한 번이라도 성공했으면 이후 실패해도 `available:true · locked:false`이고 드래그 대체로 바꾸지 않는다.
  4. available이 false면 **드래그 대체**: 가운데 버튼 드래그는 언제나, 걷기 모드에서는 좌 · 우 드래그도 시선이 된다. 안내 문구는 「가운데 버튼을 누른 채 끌어 둘러보기」.
- **낚시 모드의 키 조준**: `setMode('fish')`이면 KeyA/KeyD가 `look.yaw`를 `MOUSE.keyYawRate`(1.2 rad/s) × dt로 돌린다(락 유무와 무관 — 가운데 버튼이 없는 터치패드도 조준 · 파이팅 중 물고기 쪽 보기가 된다). sim은 지금처럼 `input.yaw`만 읽는다(낚시 모드의 `moveX` · `moveZ`는 sim이 쓰지 않는다).
- 첫 사용자 제스처(`keydown` · `pointerdown`)에서 `audio.unlock()` · `AUDIO_UNLOCKED`.

### 11.4 화면 크기 · 터치

- 캔버스는 100vw × 100vh(렌더러가 크기의 주인). 터치만 있는 기기(`(pointer: coarse)` && !`(any-pointer: fine)`)면 타이틀에 「키보드 · 마우스가 필요하다」(`title.needInput`).

### 11.5 저장 — `app/storage.js`

| 시점 | 방법 |
|---|---|
| `SAVE_REQUEST`(랜딩 결정 · 실패 손실 · 판매 · 구매 · 라인 · 장착 · 미끼/수심 · 스킬 · 안내 · 씬 전환 · 날 바뀜 · 수면 · 새 게임 — §4.2) | 플래그만 세우고 그 프레임 끝에 한 번 `writeSave(createSaveData(sim.state, Date.now()))` |
| `visibilitychange → hidden` · `pagehide` · `beforeunload` | `screen === 'play'`이고 개발 세션이 아니면 **플래그와 무관하게** 즉시 한 번(시계 · 드랙 · 결과 대기 중인 물고기까지 — `createSaveData`가 pendingCatch를 반영한다) |
| 개발 세션(`devSession`) | **읽지도 쓰지도 않는다**(설정은 쓴다) |

- `loadSave()`: 없음 → `{save:null}` · `parseSave`가 `'future'` → 원문을 백업하고 `{save:null, future:true}`(타이틀 `title.saveFuture` 「더 새 버전의 세이브다 — 백업하고 새로 시작한다」) · 그 밖의 실패(json · game · fields) → 원문을 백업하고 `{save:null, broken:true}`(`title.saveBroken`) · 성공 → `{save}`. 손상 원문을 백업한 직후 `SAVE_KEY`를 지운다(부팅할 때마다 같은 원문을 다시 백업하지 않는다). **던지지 않는다.**
- **백업**: `backupSave(raw = 지금 SAVE_KEY 값)`은 `${SAVE_BACKUP_KEY}.<ms>`에 쓰고 목록 `${SAVE_BACKUP_KEY}.index`(ms 배열)에 더한 뒤 최신 3개만 남긴다(앞의 정상 백업을 손상 원문이 덮지 않는다).
- `localStorage`가 막혀 있으면(`canPersist() === false`) 타이틀에 `title.noStorage` · 저장 호출은 조용히 false.
- 쓰기 실패(용량 등)는 한 번만 `toast('save.failed')`.
- **설정**: app은 `persisted`(localStorage에서 읽은 값)와 `overrides`(쿼리 `?quality` · `?mute`)를 따로 들고, 레이어에 주는 `settings`는 `{...persisted, ...overrides}`를 같은 객체에 다시 채워 만든다. `applySettings(partial)`은 persisted를 고치고 `writeSettings(persisted)` — 쿼리 덮어쓰기가 영구 설정이 되지 않는다. 덮인 항목은 일시정지 설정 탭에 「이번 실행만」.

### 11.6 개발용 URL 쿼리 — `app/query.js`

| 쿼리 | 뜻 |
|---|---|
| `?fresh=1` | 새 프로필로 시작 — 실제 세이브를 읽지도 쓰지도 않는다 |
| `?scene=<home\|lake\|coast\|river>` | **레벨 게이트를 무시하고** 그 씬의 spawn에서 시작(일회용 세션) |
| `?spot=<spotId>` | 그 자리의 씬에서 낚시 모드로 시작(게이트 무시) |
| `?level=<1..20>` | 그 레벨 · 스킬 포인트 = 레벨로 시작 |
| `?money=<n>` | 시작 돈 |
| `?time=<0..24>` · `?weather=<clear\|cloudy\|rain>` · `?seed=<n>` | 시작 시각 · 오늘 날씨(모든 스테이지) · 시드 |
| `?bot=<1\|basic\|controlled\|mindless\|locked>` | 봇이 플레이(1 = basic · 자동 패널 끔 — §11.1). `?spot`이 있으면 계획 `stay`, 없으면 `lakeDay` |
| `?panel=<tackle\|pc\|sell\|camp\|map\|bed\|pause\|result>` | 시작하자마자 그 패널(`result`는 `debugSkipToResult`로 붕어를 만든다) |
| `?fixture=<이름>` | 고정 상태(아래 표)를 `sim.debugLoadState`로 세우고 **sim을 밀지 않는다** — 레이어 · ui만 돈다(`__game.step(n)`은 레이어 · ui `update`를 `dt = DT`로 n번). `?panel`과 함께 쓸 수 있다 |
| `?quality=<low\|medium\|high>` · `?mute=1` · `?nopause=1` | 화질 덮어쓰기(저장 안 함 — `overrides`) · 소리 끔 · 포커스 잃어도 계속 |

`quality` · `mute` · `nopause`를 뺀 쿼리가 하나라도 있으면 **개발 세션**(`devSession`) — 타이틀 없이 바로 시작하고 세이브를 읽지도 쓰지도 않는다. README 첫 화면에 레벨 게이트를 건너뛰는 예(`?scene=coast&level=6&money=300000` · `?spot=river_trench&level=12&money=3000000`)를 적는다.

**고정 상태** — `src/debug/fixtures.js`(P0 완성): `export const FIXTURE_NAMES` · `export function makeFixtureState(name) → GameState`. 각 상태는 §3.4의 필드를 빠짐없이 채운 순수 객체(시드 고정 · `fight.k`는 `fightConstants`로 · `rigStats`와 맞는 값)이고 `fixtures.test.js`가 모양 · 유한수를 검사한다. W1의 화면 패키지가 sim 없이 자기 화면을 보는 수단이다(§1.1-6). `parseQuery`가 돌려주는 `DevQuery`의 모양은 `src/types.js`에 있다(§3에 없던 이름 — W0 확정 · 필드는 P9 재량).

| 이름 | 상태 |
|---|---|
| `walkLake` | 호수 · 08:00 맑음 · 걷기 · 판매상 앞(`nearby` npc) |
| `ready` | 호수 자갈 · 08:00 · 바닥 세트 `ready` |
| `charging` | 같은 자리 · `charging` · power 0.9 · `aimPreview` 28m(완벽 띠 근처) |
| `waiting` | 같은 자리 · 찌 세트 `waiting` · 그 세트 최대 비거리(1단계 찌 로드 24m — 28m 은 1단계 찌 세트로 닿지 않는다 · W0 확정) · 수심 2m |
| `driftRiver` | 강 꼬리물 · 찌 세트 흘림 중(`drifting` · 70m · 베일 열림) |
| `nibble` · `take` | 호수 자갈 찌 세트 · 예신 진행 중(`signal` nibble) / 본신 첫 틱(`hookWindow.open`) |
| `fightRun` | 잉어 트로피(7.3kg) · 질주 · 미끄러짐(`slipping` · 클리커) · 텐션 = 드랙 · 35m |
| `fightJump` | 큰입배스 · 점프 공중(`airborne` 0.8) · 로드 세움 |
| `fightStress` | 잉어 · 펌핑 중 로드 상한 92%(`rodStress` · `limitBy:'rod'`) · `lineDanger` |
| `netReady` | 붕어 · 거리 2.4m · `canNet` · 「Space 뜰채」 |
| `landing` | 붕어 · 뜰채 중(`landing` phaseTime 0.4) |
| `result` | 결과 단계 · 잉어 트로피 `pendingCatch`(첫 포획 — `recordWeight`는 첫 포획을 제외하므로 false · §3.5 · W0 확정) · 어창 11/12 |
| `failedRodBreak` | `failed` · 2단계 바닥 로드 파손 `lastLoss`(rodLost · dragKgAfter) |
| `night` · `rain` | 호수 자갈 22:00 대기(헤드랜턴) / 갯바위 조류 홈 18:30 비 대기 |
| `shopL12` | 집 · 레벨 12 · 돈 3,000,000 · 숙련 2 · 2단계 일부 보유(상점 전 · 후 비교) |

### 11.7 디버그 API — `window.__game` (`app/debugApi.js`)

| 메서드 | 동작 |
|---|---|
| `getState()` | `sim.state`(읽기 전용으로 쓴다) |
| `pause(on)` | 루프의 sim 진행을 멈춘다(렌더는 계속). 반환 = 지금 값 |
| `step(n = 1)` | n틱을 동기로 밀고(`NEUTRAL_INPUT` 또는 봇 — 봇 규칙은 §11.1) **렌더까지** → `Promise<void>`. `?fixture` 모드면 sim은 밀지 않고 레이어 · ui `update`를 n번(§5.9) |
| `setBot(on \| strategy)` | 봇 켜기/끄기(`'basic'` · `'controlled'` · `'mindless'` · `'locked'`) — 켜면 `ui.setAutoPanels(false)`, 끄면 true |
| `loadFixture(name)` | 고정 상태로 바꾸고 fixture 모드(§11.6) |
| `errors()` | 잡히지 않은 예외 · 거부된 Promise · `console.error` 문면 배열(새로 읽은 뒤의 것) |
| `screen()` · `startGame()` | 지금 화면 · 타이틀을 건너뛰고 새 개발 세션으로 play |
| `openPanel(id, args)` · `closePanel()` | 패널 바로 띄우기 |
| `setTime(hour)` · `setWeather(id)` · `gotoScene(id)` · `gotoSpot(id)` | sim의 `debug*` |
| `forceBite(speciesId, percentile)` | 그 어종 · 퍼센타일로 바로 입질 |
| `forceFight(speciesId, percentile)` | 입질 · 챔질을 건너뛰고 바로 파이팅(`debugForceFight` — 봇과 함께 쓰면 파이팅 화면을 정지 화면으로 볼 수 있다) |
| `grant({money, xp})` · `setGear(slot, id, set?)` · `skipToResult(speciesId?, pct?)` | sim의 `debug*` |
| `hash()` · `fps()` · `memory()` | 상태 해시 · 최근 fps · `{geometries, textures, programs, domNodes, listeners, audioNodes, particles}`(누수 검사) |

### 11.8 최소 부트 — W0의 `src/main.js` (P0이 쓰고, W2에서 P9가 `Game`으로 교체)

- 스텁 위에서 돈다: `EventBus` → `GameSim`(`start.scene` = `?scene` 또는 `'lake'`) → `createRenderContext` → **§11.1의 생성 순서 그대로 모든 레이어를 계약 deps 전부로**: `WorldLayer` · `CameraRig` · `TackleLayer` · `FishLayer` · `FxLayer` · `AudioEngine` · `FishPreview` · `UIRoot`(`actions` · `fishPreview` 포함) → rAF 누산 루프(§5.9) — 매 프레임 §11.1의 순서로 `update`를 부른다 → 첫 렌더 뒤 `markReady()`. W1에서 각 패키지가 자기 레이어를 채우면 최소 부트에 그대로 뜬다(main.js를 고치지 않는다).
- `actions`는 sim 명령을 그대로 부르는 스텁: `{newGame: () => sim.newGame(1), continueGame() {}, resume() {}, quitToTitle() {}, applySettings() {}, travel: id => sim.travel(id), waitNextBand: () => sim.waitNextBand(), sleep: () => sim.sleep(), requestPointerLock() {}}`.
- 입력: `main.js` 안의 최소 수집기 — 키보드(이동 · E · Space · R · Z/C · ↑↓ · 1/2 · Esc · Tab은 `ui.handleKey` 먼저) · 마우스(좌 · 우 홀드와 에지 · 휠 → dragSteps · 가운데 드래그 시선)로 `makeInput()`을 채운다. 포인터 락 · A/D 조준은 P9의 몫.
- `window.__game`: `getState` · `pause` · `step` · `errors` · `screen`(`'play'`) · `gotoScene` · `gotoSpot` · `openPanel` · `closePanel` · `loadFixture` · `setBot`(no-op).
- 쿼리: `?scene` · `?spot` · `?time` · `?weather` · `?panel` · `?fixture` · `?fresh`(무시 — 세이브를 쓰지 않으니까).
- 예외 · WebGL 실패 → `markError(사유)`. `index.html`에 `<link rel="icon" href="data:,">` · `<noscript>`.

### 11.9 부팅 표식

- `src/app/bootMarker.js`(P0 완성 · 아무도 고치지 않는다)의 `markReady()` · `markError(reason)`만 `document.documentElement.dataset.gameReady/gameError`를 쓴다. **진입점을 다시 써도 이 두 호출은 남는다**: P9의 `Game.start()`는 첫 프레임(타이틀이든 play든)을 그린 직후 `markReady()`, 부팅 실패(WebGL · 생성자 예외 · 첫 프레임 전의 잡히지 않은 예외)에서 `markError`.
- `purity.test.js`가 확인한다: `src/main.js` 또는 `src/app/Game.js`가 `./app/bootMarker.js`(또는 `./bootMarker.js`)에서 `markReady` · `markError`를 import 한다 · 그 밖의 파일에 `dataset.gameReady` · `dataset.gameError` 문자열이 없다.
- `check:dist`: 사용자 입력 없이 실제 20초 안에 `data-game-ready="1"` · 잡히지 않은 예외 0 — 타이틀 화면(뒤에 지금 씬 — 새 프로필이면 집 실내 — 이 렌더된 상태)에서 붙는다.

### 11.10 견고성

| 상황 | 동작 |
|---|---|
| WebGL 생성 실패 | `ui.showFatal` 안내 · `markError('webgl')` · 루프 시작 안 함 |
| `webglcontextlost` | 일시정지 + 알림 · `webglcontextrestored`에서 알림을 지우고 루프 기준 시각을 다시 잡는다 |
| localStorage 막힘 | 타이틀 안내 · 저장 없이 플레이 |
| 터치 기기 | 타이틀 안내 |
| 탭 숨김 | 일시정지 · `audio.setPaused(true)`(suspend) |
| 같은 판 반복 | `__game.memory()`의 수치가 늘지 않는다(§12.5 S4) |

---

## §12 봇과 테스트 계획

### 12.1 봇 행동 규칙 (P10)

- **사람처럼**: 매 틱 `InputFrame` 하나 + 필요하면 UI와 같은 명령 하나(§6.8). 보는 것도 사람이 보는 것만 — 찌/초리 신호(`rig.signal`) · 텐션 · 드랙 · 거리 · 라인 잔량 · 예고(`fight.telegraph`) · `canNet` · 장애물 경고 · (지식 3) 체력 바 · 데이터 표(PC에서 보는 정보: 수심 프로필 · 어종 활동 시간대 · 선호 미끼). **보지 않는 것**: `rig.bite` · `fight.speciesId` · `fight.k` · `fight.brain` · 지식 3 전의 `fight.stamina` · `biteInfo()`.
- **반응 지연 · 실수**: 본신을 본 뒤 `BOT.react`(정규, 잘라서) 뒤에 Space · 입질마다 `BOT.earlyRate` 확률로 예신에 성급히 챔질 · 캐스팅은 게이지가 `castPower.target ± sd`를 올라가며 지날 때 뗀다 · 뜰채는 `canNet`을 본 뒤 `BOT.netReact`.
- **손의 속도**: 드랙 눈금은 `BOT.dragEveryTicks`(2) 틱에 1눈금까지만 바꾼다 — `|dragSteps| ≤ 1`이고 연속 두 틱에 0이 아닌 값을 내지 않는다(사람의 휠 · Z/C로 낼 수 있는 속도). `bot.test`가 검사한다.
- **파이팅 전략**(브리프 §7 · `bot/policy.js`):
  - `basic`: 드랙 = 라인 강도의 30%(가장 가까운 눈금) 고정 · `tension < 0.5 × lineEffKg`면 릴링 · 펌핑 · 베일 안 함.
  - `controlled`: 목표 드랙 = 휴식/버팀/방향 전환 `0.70 × lineEffKg`, 질주 · 잠수 · 점프 예고를 본 뒤(`teleReact` 0.30초)와 질주 · 잠수 · 점프 중 `0.45 × lineEffKg`, 장애물 경고(`inSnag`) 중 `0.80 × lineEffKg`(띠에서 끌어낸다), 모두 `min(…, maxDrag, 0.9 × rodMaxLoad)`. 텐션이 `0.80 × lineEffKg`를 넘으면 손의 속도 안에서 푼다. 릴링 `tension < 0.70 × lineEffKg`. 펌핑: 휴식 · 버팀 · 방향 전환이고 텐션 < `0.50 × min(lineEffKg, rodMaxLoad)`면 세우기 시작, 텐션 > `0.80 × rodMaxLoad` · 다 세움 · 질주/점프 예고면 숙인다.
  - `mindless`: 드랙 최대 · 항상 릴링 · 펌핑 0.8초 세우기 / 0.4초 숙이기 반복 · 점프 무시.
  - `locked`(측정 전용): 드랙 = 라인 강도의 85% 고정 · 항상 릴링 · 펌핑 · 점프 대응 없음 — 「드랙을 잠그고 감기만」이 이기는 루프가 아닌지 잰다(M5).
- **이동 · 하루**: 걷기 영역이 볼록이고 장애물은 둘레로 미끄러지므로 목표 점으로 곧게 걷는다(yaw = 목표 방향 · `moveZ = 1`). 목표는 상호작용 점의 `approach` · 자리의 `stand` → 0.3m 안에 닿으면 대상 쪽을 보고 E. 계획(`BOT.plans`):
  - `lakeDay`: 06:00 집 → 문(지도) → `travel('lake')`(07:00) → `byBand`의 자리 · 세트 · 미끼 → 어창이 차면 판매상 `sellAll` · 미끼가 5개 아래면 판매상에서 미끼 팩 → 다음 날 04:30에 캠프 → 집(05:30 · 자동 판매) → 침대(06:00). 게임 하루 = 06:00 → 06:00, 낚시 약 21.5시간.
  - `progress`: `lakeDay`로 시작 → `buyOrder`의 다음 항목을 살 수 있게 되면(레벨 · 숙련 · 돈 + 미끼 여유) **그 판이 끝난 뒤 바로** 캠프 → 집 → PC에서 사고 끼우고 돌아온다(`line_*` 항목은 두 세트에 `refillLine`) — 첫 업그레이드가 하루 끝에 묶이지 않는다 · **잃은 것을 되돌린다**: 부러진 2·3단계 로드는 다음 귀가에 다시 사고(`buyOrder`보다 먼저), 예비 스풀로 내려간 라인 · 70% 아래로 준 라인은 판매상 · PC에서 산 것 중 최고 단계로 다시 감는다 · 스킬 포인트는 `skillOrder` → 레벨 5부터 `coastDay` · 10부터 `riverDay`(강에서는 두 세트에 `riverHook` 바늘을 끼운다). 찌 세트의 수심은 그 자리 캐스팅 거리 수심의 절반(중층)으로 맞춘다(↑↓ 입력). 릴은 첫 `reel_2`를 찌 세트(갯바위는 찌 위주), 첫 `reel_3`를 바닥 세트(강 깊은 홈 철갑상어)에 끼운다.
  - `stay`: 지금 자리에서 계속(개발용 `?bot=1&spot=…`).
- 봇이 쓰지 않는 수단: 정밀 조준 · 흘림(베일)과 먼 곳의 `farMul` · 파이팅 중 베일 · 시간 건너뛰기 → 측정의 한계(§7.12).
- **W1 테스트가 봇을 기다리지 않는다**: P2의 `fight.test` · `styles.report`는 `createFightPolicy`로 파이팅만 돌리고, P11 · P12의 스테이지 테스트는 `createAngler`(자리 봇)로 W1 완성본의 `GameSim` 위에서 돈다. P10의 `createBot`은 그 둘 위에 걷기 · 계획만 더한다 — 측정과 화면의 봇이 같은 정책이다.

### 12.2 파일별 테스트

| 파일 | 소유 | 내용 |
|---|---|---|
| `core.test.js` | P0 | rng 결정성 · 분포(평균 · 분산) · `normalCdf/Inv` 왕복 오차 · math 각도 규약(`yawOf(fwd(θ)) = θ`) · `pointInConvex` · `piecewise` · 이벤트 버스(순서 · off · 재진입) · `hashState` 안정 |
| `purity.test.js` | P0 | 순수 계층(`core` · `data` · `sim` · `bot` · `debug`) 소스에 금지 토큰(`three` import · `window` · `document` · `AudioContext` · `localStorage` · `performance.` · `Date.now` · `Math.random` · `requestAnimationFrame` · `setTimeout`) 0 / 모든 상대 import 경로가 디스크 파일 이름과 **대소문자까지** 같다 / 부팅 표식 규칙(§11.9) / **한국어 문자열 리터럴은 `strings.ko.js`에만**: 대상은 `src/**/*.js`에서 `src/data/strings.ko.js`를 뺀 것 · `//` · `/* */` 주석과 JSDoc 블록을 먼저 지운 뒤 **문자열 리터럴(작은따옴표 · 큰따옴표 · 백틱) 안의 한글**만 본다(주석의 한국어는 된다) |
| `data.schema.test.js` | P0 | 어종 36행: 필수 필드 · `stage`/`baits`/`style`/`traits`/`body` 참조 유효 · `time` 형식 · `lenCm`/`kg` 증가 · `fantasy` 조건 유효 · 파생 값 유한 / 스테이지: `walk` 볼록 · 방향 · `stand` · `spawn`이 walk 안이고 `obstacles` 밖 · 상호작용 점의 `approach`가 walk 안 · obstacles 밖 · `radius` 안 · 캐스팅 부채꼴(facing ± arc × minCastM..80m)의 착수점이 해안선의 물 쪽(z < shoreZAt(x)) · `edgeM`이 stand에서 facing으로 shore를 만나는 거리와 ±0.15m · 자리의 `depth` 증가 · `snag.fromM > minCastM` · `farFromM`은 null 이거나 minCastM < farFromM ≤ maxDriftM · `farMul > 0` · `pool` 참조 · 모든 어종이 한 자리 이상의 풀에 / **완결성**: 스테이지마다 어종 ≥ 10 · 층 3 × 시간대 5 각 칸에 계수 > 0인 비판타지 어종 ≥ 1 / 장비 · 미끼 · 스킬(한 필드 한 스킬) · `CAST.minLineM ≥ 모든 자리 minCastM + CAST.lineReserveM` / `strings.ko.js`에 모든 데이터 ID의 이름 키 |
| `fixtures.test.js` | P0 | `FIXTURE_NAMES` 전부: `makeFixtureState`가 §3.4의 필드를 빠짐없이 가진 상태(fight · pendingCatch는 이름에 맞게 있거나 null) · `assertFiniteDeep` · `structuredClone` 가능 · 같은 이름이면 같은 해시 |
| `catch.test.js` | P1 | 어종마다 10,000 표본: 트로피(≥ 90%) 9–11% · 레전드(≥ 99%) 0.7–1.3% · 길이 범위(5–99.9 퍼센타일) 표본 비율 · `rollFish(pct)` 왕복 · 결정성 |
| `biteModel.test.js` | P1 | **시간대 출현 분포**: 어종마다 그 어종이 있는 자리 · 선호 미끼 · 맞는 층 · 맑음에서 5시간대 × 2,000 뽑기 → 관측 수와 기대 수(가중치 식) 비교: 기대 ≥ 400이면 상대 오차 ≤ 10%, 그 밖 관측과 기대의 차의 절댓값 ≤ 4√기대 + 2 · 계수 0인 시간대 0 / **판타지**: 조건 안 2–5%(선호 미끼 · 그 밖 미끼 모두) · 조건 밖 0 / 대기 산수(§7.12의 26.7초 · 2.4배 · 2.9배 ±5%) / 층 판정 / 흐림 한 단계 |
| `rig.test.js` | P1 | 단계 기계 전부(§5.2): 캐스팅 거리(상 · 하한 — `lineM = minLineM`에서도 뒤집히지 않는다) · 완벽 · 조준 자르기 · 미끼 소모/환불(`castBaitId` — 대기 중 미끼를 바꿔도 물속 미끼로 가중치 · 환불) · 흘림 · 봉돌 밀림의 **경계**(arc · 최소 거리 · 해안선 — 강 꼬리물에서 땅으로 가지 않는다) · 빈 채비 회수 속도 · 대기 중 수심 변경(minWait 다시 세기) · 세트 전환 규칙(즉시 · 회수 후 · pendingSet · `RIG_BUSY`) · `syncRig`(장착 · 스킬 뒤 rig 드랙 = profile) · 예신 → 본신 → 챔질 창(첫 틱 · 마지막 틱 · 선입력 · 헛챔질 · 늦음 · 찌올림 +0.3초) · 실패 → 1초 → ready · **버퍼된 좌클릭으로 1.7초 안 재캐스팅** · 결과 → keep/release/swap · 어창 가득 · `exitSpot` 제한 — 파이팅 결과는 `fightImpl`을 가짜로 바꿔 끼워 검사(P2를 기다리지 않는다) / **`createAngler`**: 자리에서 캐스팅 → 입질 → 챔질 → (가짜 파이팅) → keep 을 50번 되풀이(updateRig 와 rig 명령으로 직접 — GameSim 없이) · 명령은 §6.8 목록뿐 |
| `fight.test.js` | P2 | 드랙 아래 버팀/위 미끄러짐 · 정지 마찰 과부하(챔질 뒤 `hookGrace` 동안 없음) · 시작 예고(`startTele`) · 라인 끊김 · 스풀 바닥 · 로드 파손은 세운 상태에서 `rodBreakHold` 이어질 때만(0.2초 스파이크는 무사) · 바늘 빠짐(슬랙 · 미끄러지는 동안 loose 0 · 점프는 숙이면 `jumpLowP`뿐 · 흔들기는 상태 진입에 한 번) · 펌핑 거리는 `pumpGainFrom` 위에서만(우클릭 10Hz 연타로 거리 이득 없음) · 쓸림은 미끄러질 때만 박힌다 · charge 를 감으며 세우면 슬랙 없음 · 뜰채 우선(같은 틱) · 뜰채 선입력(`netBufferS`) · 뜰채 범위 재질주 · 최소 거리 · `halfArc` · 장애물 띠 쓸림 · NaN 없음 / **봇 전략 넷 미니 측정**(`createFightPolicy` · 호수 자갈 · 1단계 · lakeDay 섞기 2,000마리): §7.12의 한 판 길이 · 파이팅 대비 랜딩 · 중형 이상의 드랙 의미(조절 − 무지성 ≥ 25%p · 조절 − 기본 ≥ 10%p) · 대형의 조절 − 고정 ≥ 10%p · 파손 빈도가 범위 안 |
| `fishBrain.test.js` | P2 | 36종 `buildBrain` 검증(§8.2) · 특성 적용 · 결정성 · `sim/fight/*.js`에 어종 ID 문자열 없음 |
| `styles.report.test.js` | P2 | 성격 6종 × 대표 어종 중앙값 크기 × 기본 봇 300판: 텐션 최대 · 평균 · 분산 · 질주 수 · 점프 수 · 슬랙 비율 · 길이를 표로 출력하고, 각 성격 쌍이 지표 2개 이상에서 25% 넘게 다르다 · **무게형의 텐션 변동계수 ≤ 돌진형의 0.5배 · 분당 질주 수 ≤ 돌진형의 0.4배**(「붕어는 단순히 무겁다」) |
| `clock.test.js` | P3 | 틱 → 시각 · 시간대 경계(04 · 07 · 11 · 17 · 20 · 자정) · 해 고도 부호(일출 · 일몰) · 건너뛰기(캠프 · 이동 · 수면 — 자정 넘김 · 이벤트 순서) · 날씨 결정성 · 예보 = 다음 날 실제 |
| `world.test.js` | P3 | 볼록 충돌(벽 따라 미끄러짐) · 상호작용 반경 · 시선 범위 · 자리 진입(`updateWalk`가 `enterSpotId`를 돌려준다) · 이동 게이트(잠김 · 야외 → 야외 `notHere`) · 집 도착 처리의 **순서**(자동 판매 → line_1 무료 감기 → 무료 미끼 — 어창에 물고기가 있으면 무료 미끼를 주지 않는다) |
| `gameSim.test.js` | P3 | 틱 순서 · 플러시(재진입) · 명령의 결과 모양(`params` 포함) · `ctx.stage/spot` 대입 · `newGame`의 리셋(파이팅 중 호출 → fight · pendingCatch null · 집 · 이벤트 순서) · `debugLoadState`(고정 상태 → ctx 다시 계산 · 이벤트 없음) · `debugForceFight` · 세이브 → 새 GameSim → 같은 프로필 · 패널 없이 1시간 돌려 예외 0 |
| `progression.test.js` | P4 | 경험치 곡선(누적 L5 657 · L10 3,863 · L20 21,116) · 레벨 업 · 포인트 · `unlocks`(스테이지 · `tier:2` · 숙련으로 열리는 `tier:3`) · 캡의 `xpToNext` null · 스킬 랭크 순서 · Modifiers · RigStats 식(`netReachM`) · 도감 · 첫 포획 · 신기록 · 방생 70% · 어창 swap(뺀 것은 경험치 · 도감 변화 없음) |
| `economy.test.js` | P4 | 가격 식 · **가격 비율**(어종마다 10,000 표본: 트로피 중앙/비트로피 중앙 ≥ 2.0 · 레전드 중앙/트로피 중앙 4–6) · 판매 · 흥정 · 구매 문턱(레벨 · 숙련 · 돈 · `reasonParams`) · `buy` qty 0 · −1 · 1.5 · NaN → invalid · 돈 불변 · `sellOne` 없는 uid → invalid · 라인 감기(세트 × 라인 항목 · 세트별 비용) · 손실(§5.6 표 · 물속 미끼 기준) · **예비 스풀**(돈 0 · 두 세트 line_2 · 끊김으로 lineM 0 → 바로 캐스팅 가능) · 로드 파손 뒤 드랙 낮추기 · 릴 장착의 드랙 kg 보존 · **돈 음수 0** · 무료 미끼 하루 1회 · 장착 보유 수 |
| `save.test.js` | P4 | 왕복 · 손상 JSON · 다른 game · **미래 버전 → 'future'** · 과거 버전 → migrateSave 를 거친다 · 필드 누락/범위 밖 → sanitize · 던지지 않음 · result 단계의 `createSaveData`가 pendingCatch 를 반영(자리 있으면 어창 · 없으면 방생 경험치) · 로드 파손 → 저장 → parseSave → owned 에 그 로드가 없다 |
| `fishModel.test.js` | P6 | 36종 모델을 Node에서 만들기(three 지오메트리만): Z 길이 = lengthM ± 3% · 높이 비 · 삼각형 수 상한 · 템플릿 5종 모두 · 실루엣 모드 · dispose 뒤 재생성 |
| `ui.strings.test.js` | P8 | `src/ui/**`의 `t('…')` 리터럴 키가 전부 `STRINGS`에 있다 · 부록 B 키 전부 존재 |
| `app.query.test.js` | P9 | 쿼리 파싱 · devSession 판정 · 잘못된 값 무시 |
| `app.input.test.js` | P9 | `frameFromState`: 바인딩 · 에지 한 번 · 휠 누적 → 정수 눈금 · 수정키 무시 · 락을 요청하는 pointerdown 은 primary 에지 · 홀드로 나가지 않는다 · 낚시 모드 A/D → yaw 회전(`keyYawRate`) |
| `bot.test.js` | P10 | 봇이 낸 명령은 §6.8 목록뿐 · 숨은 값을 읽지 않는다(상태 프록시로 접근 기록 — angler · policy 포함) · 각 전략의 드랙/펌핑 규칙 단위 검사 · **손의 속도**(`dragSteps`의 절댓값 ≤ 1 · 연속 두 틱에 0이 아닌 값 없음) |
| `headless.test.js` | P10 | §12.4 |
| `measure.test.js` | P10 | §12.5 |
| `stage.coast.test.js` · `stage.river.test.js` | P11 · P12 | 그 스테이지의 데이터 완결성 · 자리마다 `createAngler`(기본/조절) 100판 예외 0 · 흘림 · 봉돌 밀림이 땅으로 가지 않는다(강 꼬리물 · 조류 홈) · 그 스테이지 판타지 조건 · 소품 빌더가 Node에서 만들어진다(three만) |

### 12.3 순수 계층 · 결정성

- 순수 계층은 Node에서 `GameSim`을 그대로 돌린다(app · view 없음). 테스트는 `test/helpers.js`로 상태 · 문맥을 만든다.
- 결정성: 같은 시드 · 같은 입력열 → 같은 `hashState`. sim은 `state.rng` 하나만 쓴다(Map 순회 순서 · 객체 키 순서에 기대지 않는다).

### 12.4 헤드리스 봇 시나리오 — `headless.test.js`

**헤드리스 러너 규칙**(§6.8과 같다): 틱마다 `a = bot.decide(state, sim)` → `a.command`가 있으면 step 전에 실행(`travel` · `waitNextBand` · `sleep`도 바로 — 전환 막이 없다) → `rig.phase === 'result'`면 step 하지 않고 다음 decide → 아니면 `sim.step(a.input)`. 결과 단계에서 시계가 가지 않아 브라우저(패널이 sim을 멈춘다)와 같은 시간 모델이다.

| ID | 시나리오 | 통과 |
|---|---|---|
| H1 | **핵심 루프 완주**: 새 프로필 · `lakeDay` · basic · 1 게임 일(집 → 호수 → 낚시 · 판매 → 집 → 침대 → 다음 날 06:00) | 예외 0 · 600틱마다 `assertFiniteDeep(state)` · 돈 ≥ 0 · 랜딩 ≥ 25 · 판매 ≥ 1 · 실패 ≥ 1과 그 뒤 재캐스팅 · `SCENE_CHANGED` ≥ 3(start · lake · home) · `CLOCK_DAY` 1 |
| H2 | **결정성**: 같은 시드 · 같은 봇으로 0.25 게임 일 두 번 | 해시 같음 · 시드를 바꾸면 다름 |
| H3 | **무작위 입력 퍼즈**: `randomInputs` 50,000틱 × 자리 3곳(호수) | 예외 0 · NaN 0 · 돈 ≥ 0 · `rig.phase` ∈ RIG_PHASES |
| H4 | **세이브 왕복**: H1 도중(정오) 저장 → `parseSave` → 새 GameSim → 같은 봇 | 프로필 동일 · 이어서 1시간 예외 0 |
| H5 | **모든 자리**: 9자리 × (1·3단계 장비 — `debugSetGear`) × 조절 봇 × 입질 30 | 예외 0 · NaN 0 · 자리마다 랜딩 ≥ 1 |

### 12.5 측정 목표 — `measure.test.js` (브리프 §7 · §7.12의 기준)

| ID | 측정 | 표본 | 통과 |
|---|---|---|---|
| M1 | 한 판 길이(입질 → 랜딩, 기본 봇, 호수 자갈, 1단계) 크기별 중앙값 — 소 < 1kg · 중 1–5kg · 대 ≥ 5kg(호수의 대형 = 잉어 · 향어 · 메기의 트로피급 — 대형은 크기를 대형으로 뽑은 파이팅을 따로 모은다) | 랜딩 600 · 대형 랜딩 30 이상 | 소 10–25 · 중 25–60 · 대 60–150초 |
| M1b | 후반 한 판 길이(조절 봇): 강 깊은 홈 3단계 흰철갑상어 · 강 꼬리물 3단계 치누크 / 갯바위 2단계 돌돔 · 참돔 | 각 랜딩 200 | 중앙값 크기 ≤ 150초 · 트로피급 ≤ 240초 |
| M2 | 첫 입질 대기(자갈 · 바닥 · 떡밥 · 아침) 평균 · 크릴 · 크릴 + 낮 | 캐스팅 각 300 | 15–45초 · 2–4배 |
| M3 | 첫 랜딩까지 도전 수(새 프로필 · 기본 봇) | 시드 50 | 90% 이상이 3회 안 |
| M4 | 랜딩률 · 끊김 · 빠짐(기본 봇, 입질 대비 — 챔질 실패 포함) | 입질 1,000 | 60–80% · ≤ 15% · ≤ 20% |
| M5 | 드랙 의미: 중형 이상(≥1kg) · 같은 조건 / 대형(≥5kg)의 조절 vs 고정(locked) | 파이팅 각 800 · 대형 각 400 | 조절 − 무지성 ≥ 25%p · 조절 − 기본 ≥ 10%p / 대형 조절 − 고정 ≥ 10%p · 고정의 대형 랜딩 ≤ 60% |
| M6 | 장비 의미(흰철갑상어 중앙값 · 강 깊은 홈) | 각 200 | 1단계(기본 · 조절) ≤ 10% · 3단계 + 조절 ≥ 50% |
| M7 | 로드 파손 빈도(중형 이상 ≥1kg 파이팅당 — 1kg 미만은 로드 상한에 닿지 않는다) | 각 800 | 조절 ≤ 2% · 기본 ≤ 5% · 무지성 ≥ 15% |
| M8 | 실패 → 재도전(키 입력 수 · 시간 — 모든 FailReason, 예비 스풀 포함) | 실패 50 | 입력 2 · ≤ 2.0초 |
| M9 | 실패 손실 | 산수 + 실측 50 | 라인 끊김 손실 ≤ 소형 2마리 중앙가 · 2단계 로드 = 호수 하루 수입 20–40% |
| M9b | 3단계 로드 파손 = 강 하루 수입(3단계 · 조절 봇 · `riverDay`) | 시드 5 | 20–40% |
| M10 | 하루 수입(입문 · 호수 · 기본 봇 · `lakeDay`) | 시드 20 | 순수입(매출 − 미끼 · 라인 · 채비) **중앙값**이 미끼 20 + `reel_2`의 50–100% · 매출의 평균 · p10 · p90 · 트로피/레전드 몫을 같이 보고 |
| M11 | 첫 업그레이드 · 레벨 5 · 레벨 10(기본 봇 · `progress`) | 시드 3 | 0.5–1.5일 · 1–2일 · 4–7일 |
| M12 | 레벨 20(조절 봇 · `progress`) | 시드 3 | 15–30일 |
| M13 | 결정성 · 예외 · NaN · 돈 음수(1 게임 일) | H1 재사용 | 0 |
| M14 | 성격별 공정성: 성격 6 × 대표 어종 중앙값(crucian · redSeabream · mandarinFish · largemouthBass · barredKnifejaw · bluegill) × 그 어종이 사는 자리 × 진행 봇이 그 스테이지에서 가질 단계 장비(호수 1 · 갯바위 2) × 입에 맞는 바늘 | 각 300 | 조절 ≥ 65% · 기본 ≥ 45% · 어느 성격도 바늘 빠짐 > 25% 아님 |
| M15 | 강 진입: 레벨 10 · 2단계 전부 · 조절 봇 · `riverDay` vs 같은 조건 `coastDay` | 시드 5 | 강 순수입 중앙값 ≥ 갯바위 × 1.0 · 입질 대비 랜딩 ≥ 55% |
| M16 | 3단계 완비 시점(조절 봇 · `progress`) | 시드 3 | 10–20일 · 레벨 20(M12)보다 먼저 |

- `npm test` 전체 **120초 이내**. 넘으면 M1b · M9b · M11 · M12 · M14–M16을 `npm run measure`(`scripts/measure.mjs` — 같은 시나리오를 표로 출력)로 옮기고 `NOTES-P10.md`에 적는다. 측정 결과 표는 `npm run measure`가 언제나 낸다(밸런스 게이트가 읽는다).

### 12.6 밸런스 게이트 (마지막 웨이브 — 오케스트레이터 워크플로)

`npm run measure` → §7.12의 설계 값과 대조 → 벗어난 목표마다 「조정 손잡이」 열의 🔒 값을 조정(계약 §7과 §7.12 표를 같이 고친다) → 다시 측정 → `NOTES-BALANCE.md`(측정 표 · 바꾼 값 · 측정의 한계 · 사람이 확인할 것: 손맛 · 소리 · 포인터 락).

### 12.7 브라우저 스모크 (화면 패키지 · 통합 게이트)

`npm run probe:screen -- "<주소?쿼리>" --step <n> --out docs/_scratch/<이름>.png`로 정지 화면을 찍어 본다(내장 브라우저가 없을 때). **W1의 화면 패키지는 `?fixture`(sim 없이 고정 상태) 줄로**, 통합 게이트 · W2는 sim이 도는 줄로 본다. 최소 목록:

| 장면 | 쿼리 · eval |
|---|---|
| 타이틀 | `/` |
| 집 · PC 패널 | `/?scene=home&panel=pc` |
| 호수 아침 걷기 | `/?scene=lake&time=8` · (W1) `/?fixture=walkLake` |
| 호수 자리 · 캐스팅 게이지 · 대기 | `/?spot=lake_gravel&time=8&bot=1` · step 40(충전 중) / 240(찌 대기) · (W1) `/?fixture=charging` · `/?fixture=waiting` |
| 찌 신호 | (W1) `/?fixture=nibble` · `/?fixture=take` · `/?fixture=driftRiver` |
| 입질 · 파이팅 | `/?spot=lake_gravel&time=18&bot=controlled` + `--eval "api.forceFight('carp', 0.95)"` · step 120(초반 질주) / 600 · (W1) `/?fixture=fightRun` · `fightJump` · `fightStress` · `netReady` · `landing` |
| 결과 패널 | `/?spot=lake_gravel&panel=result` · (W1) `/?fixture=result&panel=result` |
| 실패 알림 | (W1) `/?fixture=failedRodBreak` |
| 갯바위 해 질 녘 · 비 | `/?spot=coast_channel&level=6&time=19&weather=rain` · (W1) `/?fixture=rain` |
| 강 밤(헤드랜턴) | `/?spot=river_trench&level=12&time=22` · (W1) `/?fixture=night` |
| 도감 · 상점 전/후 비교 | `/?scene=home&level=12&money=3000000&panel=pc` · (W1) `/?fixture=shopL12&panel=pc` |

---

## §13 패키지별 완료 정의

**P0 scaffold**
- 템플릿 설정 · `index.html` · 의존성(vite · three만) · `scripts/` 다섯 파일 그대로 + `scripts/measure.mjs` 스텁(`npm run measure` 스크립트 추가).
- `src/core` 전부(`shoreZAt` 포함) · `types.js` · 레지스트리 3 · `derive.js` · `bootMarker.js` · `debug/fixtures.js`(§11.6의 17개) · `sim/clock.js`(완성 상태로 — 소유 P3) · `test/helpers.js` · P0 테스트 4개(core · purity · data.schema · fixtures) **완성**.
- 모든 시드 데이터 파일이 §7의 값 그대로(어종 36행 · 스테이지 4(`edgeM` · `farFromM` · `farMul` 포함) · 장비 · 미끼 · 스킬 · 파이팅 · 입질 · 경제 · 봇 · 설정 · 키 바인딩) · `strings.ko.js`에 부록 B 키 전부.
- 나머지 파일은 §6.14의 스텁(머리에 `// OWNER: P<n> — 계약 §<절>` · `// STUB`) — 스텁이지만 완성으로 내는 것: `GameSim.debugLoadState` · `syncRig` · `rigStats` · `fightConstants`. 패키지마다 자기 테스트 파일 자리(`test.todo`).
- 최소 부트(§11.8): **모든 레이어를 계약 deps로 만들어 돌린다** · `?scene` · `?spot` · `?panel` · `?fixture` · `window.__game.step` · `loadFixture`. `npm run build` · `npm test` · `npm run check:dist` 통과 · `release/boot.png`와 `?fixture=fightRun` 정지 화면을 직접 본다.

**P1 sim-rig**
- §5.2의 단계 기계 · §5.4의 층 · 가중치(`farMul` 포함) · 위험률 · 어종 뽑기 · 판타지 섞기 · 신호 타임라인 · 크기 뽑기가 계약 그대로. `syncRig` · `castBaitId` · `pendingSet` · `RIG_BUSY` · 흘림/봉돌 밀림 경계 · 빈 채비 회수 · 대기 중 수심 변경.
- 챔질 창의 첫 틱 · 마지막 틱 · 선입력(`earlyGrace`) · 헛챔질 · 늦음 · 찌올림 +0.3초가 테스트로 고정.
- 실패 → 알림 1.0초 → `ready` → 버퍼된 좌클릭으로 **1.7초 안 재캐스팅**(테스트).
- `bot/angler.js`: 자리 봇이 rig 를 계약대로 끝없이 돈다(W2의 P10 · P11 · P12가 쓴다).
- `catch.test.js`(트로피 · 레전드 비율) · `biteModel.test.js`(시간대 분포 · 판타지 · 대기 산수) · `rig.test.js` 통과.
- 이벤트(`FISHING_ENTER` … `CATCH_RESULT` · `FAIL` · `RIG_RESTORED` · `RIG_BUSY`)가 §4.2의 payload 그대로.

**P2 sim-fight**
- §5.3의 식이 순서까지 그대로 — 드랙 버팀/미끄러짐 · 정지 마찰 과부하(`hookGrace`) · 시작 예고 · 펌핑(`pumpGainFrom`) · 체력 · 쓸림(미끄러질 때만) · 실패 순서(`rodBreakHold`) · 뜰채 우선 · 뜰채 선입력 · `halfArc` · `minDist` · `limitKg`.
- `buildBrain`이 성격 6 + 특성 16을 데이터로만 합친다 · 프레임워크 파일에 어종 ID 없음.
- `bot/policy.js`: 전략 넷(basic · controlled · mindless · locked)이 §12.1 그대로 · 손의 속도 제한.
- 미니 측정(`fight.test.js`)이 §7.12의 한 판 길이 · 랜딩률 · 드랙 의미(고정 전략 포함) · 파손 빈도 범위 안 · `styles.report.test.js`가 6종 구분과 무게형의 「단순히 무겁다」를 보고.
- `data/species/lake.js` 12행이 §7.3.1 그대로(조정은 🔒 밖에서만).

**P3 sim-world**
- `GameSim`의 틱 순서(§5.1) · 재진입 안전 플러시 · `ctx.refresh` · `ctx.stage/spot` 대입 · 모든 명령 · 조회 · 디버그 메서드(`debugLoadState` · `debugForceFight` 포함)가 §6.3 그대로. `newGame`이 무엇이 남아 있든 처음으로 되돌린다.
- 시계(틱 정본 · 시간대 · 해 · 빛) · 날씨(시드 해시 · 예보) · 건너뛰기(캠프 · 이동 · 수면 — 자정 넘김 이벤트 순서).
- 걷기(볼록 다각형 · 미끄러짐) · 상호작용(반경 · 시선) · 자리 진입은 `enterSpotId`로 · 이동 게이트(야외 → 집만) · 집 도착 처리(§5.6의 순서).
- 집 · 호수 스테이지 데이터가 §7.4 그대로 · `clock` · `world` · `gameSim` 테스트 통과.

**P4 progression**
- 프로필 · `sanitizeProfile`(던지지 않음) · Modifiers · RigStats 식 · 가격 · 판매(흥정) · 구매 문턱(`reasonParams`) · 입력 검증(qty · uid) · 라인 감기(세트 × 라인) · 장착(보유 수 · 드랙 kg 보존) · 손실(§5.6 — 물속 미끼 · 예비 스풀 · 파손 뒤 드랙 낮추기) · 무료 미끼.
- 경험치 곡선 · 레벨 업 · 포인트 · `unlocks` · 스킬 · 도감 · 첫 포획 · 신기록 · 방생 70% · 어창 swap — 이벤트는 P4 함수가 직접 낸다(§4.2).
- 가격 비율(트로피 ≥ 2 · 레전드/트로피 4–6) · 돈 음수 0 · 세이브 왕복/손상/미래 버전 · 결과 대기 물고기를 반영한 저장이 테스트로 고정.
- `previewEquip` · `previewSkill` · `shopList`가 사기 전 · 후 수치를 세트별로 준다.

**P5 view-world**
- 렌더러(화질 3단계 · 픽셀 비율 ≤ 2 · resize) · 1인칭 카메라(보간 위치 + 최신 시선 · 순간이동 규칙).
- 네 씬을 부팅 때 만들어 전환 시 visible만 — 하늘 · 해/달/별 · 시간대 색 · 안개 · 지형(`heightAt` = 메시 함수) · 물(깊이 색 · 흐름 · 파도 · 반사 단계) · 비 · 헤드랜턴 · 자리 표식 · 장애물 띠 · NPC · 캠프 · 집 실내 · 호수 소품.
- 정지 화면으로 호수 새벽 · 정오 · 해 질 녘 · 밤, 비, 집을 본다(W1은 최소 부트의 `?scene` · `?time` · `?fixture=night` · `rain`) — 「자리 표시처럼 보이면 실패」(QUALITY §4). 1280×720 · 1920×1080.
- 판을 반복해도 geometries · textures가 늘지 않는다.

**P6 view-tackle**
- 1인칭 로드 · 손 · 릴의 단계별 포즈(§9.7 표) · `aimPreview` 고리 · 캐스팅 궤적 · 라인 늘어짐 · 찌 신호(예신 · sink · lift)와 초리 신호(떨림 · 숙임 · 방울) · 찌 크기 규칙(7m 너머 화면 크기 유지 · 밤 발광).
- 파이팅의 로드 휨(sqrt — 소형도 보인다) · 한계 근처 떨림 · 로드 파손 연출 · 뜰채(길이 = `netRangeM − 0.75`) · 박힘 · 예고 중 그림자.
- `buildFishModel`: 템플릿 5 × 36종 — 실루엣으로 체형이 갈리고 색 · 무늬로 어종이 갈린다 · 그림자 · 점프 · 예고 연출 · `FishPreview`(하나를 재사용 · dispose).
- `FishPreview.snapshot`(도감 카드 이미지 · 캐시) · WebGL 컨텍스트는 하나.
- `fishModel.test.js` 통과 · 정지 화면으로 찌 예신/본신 · 파이팅 로드 휨 · 결과 패널 모델 36종 중 각 체형 하나 이상을 본다(W1은 `?fixture=nibble` · `take` · `fightRun` · `fightJump` · `fightStress` · `landing` · `result&panel=result`).

**P7 fx-audio**
- §9.9의 이벤트 → 연출 표 · 풀 상한 · 섬광 없음.
- WebAudio 합성 전부(§9.12의 소리 목록) · 첫 제스처에 켬 · 마스터 리미터 · 볼륨 4종 · 탭 숨김에 suspend · 판이 끝나면 지속음 정리 · 오디오 노드 수가 늘지 않는다.
- **텐션 톤**(음높이 ∝ `limitRatio` — 게이지와 같은 값, 85%부터 삐걱) · **드랙 클리커**(빈도 ∝ `slipSpeed`) · 릴 톱니(∝ `gainSpeed`) · 환경음(스테이지 × 시간대 × 비) · `RIG_BUSY` 부정음.
- 「사람이 확인할 것」에 소리 조정 손잡이(상수 이름 · 권장 범위)를 적는다.

**P8 ui**
- HUD(§10.3 — `limitRatio` 게이지 · 로드 아이콘 · 박힘 · 스킬 포인트 배지 · MAX) · 패널 10종(§10.2) · **패널 스택**과 자가 동기화(§10.1 · §10.4) · `setAutoPanels` · 키보드만으로 전부(Q/E · ←→ 규칙) · 결과 패널 0.25초 입력 무시 · 어창 swap · confirm `danger`.
- 사기 전 · 후 수치 비교(세트별) · 잠김 사유(`reasonParams`) · 도감 카드(snapshot 실루엣 → 컬러 · 트로피 ★ · 레전드 ★★ · 전설 표식).
- 안내 문구 10종(조작 · 드랙 · 텐션 · 챔질의 뜻 포함)이 게임 안에서 한 번씩 · 알림 수명이 일시정지 · 패널 동안 멈춘다.
- 1280×720 · 1920×1080에서 겹침 · 잘림 없음 · 문자열 키 노출 없음 · `ui.strings.test.js` 통과. W1은 `?fixture=*&panel=*`로 패널 · 파이팅 HUD를 본다.

**P9 app**
- `Game` 부트 순서 · 루프(누산기 · 프레임당 8틱 · 패널 · 결과 단계에서 멈춤 · 탭 복귀 폭주 없음) · **봇 모드**(명령을 step 전에 · 결과 단계는 명령으로만 · 자동 패널 끔) · `?fixture` 모드 · 화면 상태 기계 · 전환 막(1초 이내 · `pendingPause`) · 일시정지(포커스 잃음만 무조건 · 락 상실 = Esc 한 번).
- 입력(`event.code` · 수정키 무시 · 기본 동작 막기 · 에지 한 번 · 홀드 추적 · 휠 눈금 · 포인터 락 규칙 넷 · 드래그 대체 · 스파이크 자르기 · 낚시 A/D 조준).
- 저장 시점(손실 · 숨김/닫힘은 플래그와 무관) · 손상/미래 버전/백업 3개 · 새 게임 백업 · 설정 persisted/overrides · 개발 세션은 읽기/쓰기 없음 · 쿼리 전부 · `window.__game` 전부(§11.7) · 부팅 표식.
- README: 실행법(`npm.cmd --prefix jay-fishing run dev`) · 조작 표 · 게임 흐름 · 쿼리(레벨 게이트 건너뛰기를 첫 화면에) · 디버그 API · 알려진 한계.
- `check:dist` 통과 · 타이틀 → 호수 → 한 판 → 결과 → 판매 → 집 흐름을 정지 화면으로 확인.

**P10 bot**
- 봇이 InputFrame + UI 명령만 쓰고 숨은 값을 읽지 않는다(테스트) · 자리에서는 `createAngler`(P1) · 파이팅은 `createFightPolicy`(P2)를 그대로 쓰고 걷기 · 계획만 더한다 · 계획 넷(lakeDay · coastDay · riverDay · progress) + stay.
- `headless.test.js` H1–H5(러너 규칙 §12.4) · `measure.test.js` M1–M16 · `npm run measure`가 표를 낸다.
- 측정 결과 표와 측정의 한계를 `NOTES-P10.md`에 적는다(목표 밖이면 어느 손잡이인지까지).

**P11 coast**
- `data/stages/coast.js` · `data/species/coast.js`(§7.3.2 · §7.4.3 그대로에서 출발) · `coastProps.js`(용암 암반 · 파도 거품 · 절벽 · 등대 · 어판장 트럭 · 소나무) — 프레임워크 파일을 고치지 않는다.
- 판타지 2종(좀비 상어 비 · 밤 / 핑크 상어 맑음 · 낮)의 조건과 희귀도 · 조류 홈의 먼 곳(`farFromM` 40 · 참돔 · 잿방어).
- `stage.coast.test.js` 통과(`createAngler`) · 정지 화면으로 갯바위 아침 · 해 질 녘 · 비 · 밤.

**P12 river**
- `data/stages/river.js` · `data/species/river.js`(§7.3.3 · §7.4.4 그대로에서 출발) · `riverProps.js`(넓은 강 · 흐름 · 자갈톱 · 보너빌 댐 · 협곡 절벽 · 도크) — 프레임워크 파일을 고치지 않는다.
- 흰철갑상어로 장비 의미(M6)가 나오는지 확인 · 페일 킹(흐림 · 새벽)의 사라짐 특성이 「감으며 세우면 막히는」 슬랙 위험을 만든다 · 꼬리물의 흘림이 땅으로 가지 않고 먼 곳(`farFromM` 50)에서 연어류가 더 문다.
- `stage.river.test.js` 통과(`createAngler`) · 정지 화면으로 강 아침 · 밤(헤드랜턴 · 발광 찌) · 흐림.

---

## 부록 A 식별자 목록

| 종류 | ID |
|---|---|
| 씬 | `home` `lake` `coast` `river` |
| 낚시 자리 | `lake_shallows` `lake_gravel` `lake_cape` · `coast_shoal` `coast_channel` `coast_cape` · `river_tailrace` `river_trench` `river_riffle` |
| 호수 어종 | `crucian` `carp` `israeliCarp` `largemouthBass` `bluegill` `mandarinFish` `catfish` `snakehead` `steedBarbel` `skygager` `bullhead` `goldenDragon`(판타지) |
| 갯바위 어종 | `opaleye` `blackSeabream` `barredKnifejaw` `redSeabream` `scorpionfish` `rockfish` `rabbitfish` `threelineGrunt` `morayEel` `amberjack` `zombieShark`(판타지) `pinkShark`(판타지) |
| 강 어종 | `whiteSturgeon` `chinookSalmon` `steelhead` `walleye` `smallmouthBass` `channelCatfish` `americanShad` `pikeminnow` `cutthroatTrout` `largescaleSucker` `burbot` `paleKing`(판타지) |
| 장비 | `rod_float_1..3` `rod_bottom_1..3` `reel_1..3` `line_1..3` `hook_s` `hook_m` `hook_l` `float_1..3` `sinker_1..3` |
| 상점 미끼 항목 | `bait_worm` `bait_paste` `bait_corn` `bait_shrimp` `bait_krill` `bait_live`(팩 하나 = `packSize`개) |
| 미끼 | `worm` `paste` `corn` `shrimp` `krill` `live` |
| 스킬 | `casting` `hookset` `dragSense` `lineCare` `pumping` `knowledge` `baitCraft` `netting` `haggling` `mastery` |
| 성격 | `heavy` `runner` `thrasher` `jumper` `diver` `small` |
| 특성 | `dash` `shake` `twist` `rareJump` `shortRun` `longRun` `repeatRun` `multiJump` `stopBurst` `spin` `vanish` `firstRun` `cautious` `abrade` `tremble` `shortThrash` |
| 결과 사유(`reason.*`) | `stub` `busy` `locked` `same` `holdFull` `noBait` `noLine` `money` `level` `mastery` `notOwned` `inUse` `wrongSlot` `wrongSet` `maxRank` `noPoints` `notHere` `invalid` (알림 전용: `holdFullCast`) |
| 고정 상태(`?fixture`) | `walkLake` `ready` `charging` `waiting` `driftRiver` `nibble` `take` `fightRun` `fightJump` `fightStress` `netReady` `landing` `result` `failedRodBreak` `night` `rain` `shopL12` |
| 봇 전략 | `basic` `controlled` `mindless` `locked`(측정 전용) |

## 부록 B 문자열 키 시드 (`data/strings.ko.js` — P0이 W0에 넣는다 · 이후 P8)

**데이터 이름**

| 키 | 값 |
|---|---|
| `species.*` | crucian 붕어 · carp 잉어 · israeliCarp 향어 · largemouthBass 큰입배스 · bluegill 블루길 · mandarinFish 쏘가리 · catfish 메기 · snakehead 가물치 · steedBarbel 누치 · skygager 강준치 · bullhead 동자개 · goldenDragon 금룡 · opaleye 벵에돔 · blackSeabream 감성돔 · barredKnifejaw 돌돔 · redSeabream 참돔 · scorpionfish 쏨뱅이 · rockfish 볼락 · rabbitfish 독가시치 · threelineGrunt 벤자리 · morayEel 곰치 · amberjack 잿방어 · zombieShark 좀비 상어 · pinkShark 핑크 상어 · whiteSturgeon 흰철갑상어 · chinookSalmon 치누크연어 · steelhead 스틸헤드 · walleye 왈아이 · smallmouthBass 스몰마우스배스 · channelCatfish 채널메기 · americanShad 아메리칸 샤드 · pikeminnow 노던 파이크미노 · cutthroatTrout 컷스로트송어 · largescaleSucker 큰비늘서커 · burbot 버봇 · paleKing 페일 킹 |
| `stage.*` | home 집 · lake 호수 · coast 갯바위 · river 강 |
| `stagePlace.*` | lake 충주호 청풍 연안 (한국 충북) · coast 조가사키 해안 (일본 이즈 반도) · river 컬럼비아강 보너빌 댐 하류 (미국 오리건·워싱턴) |
| `spot.*` | lake_shallows 얕은 연안(수초) · lake_gravel 완경사 자갈 · lake_cape 깊은 곶 · coast_shoal 얕은 여 · coast_channel 조류 홈 · coast_cape 깊은 곶 · river_tailrace 댐 아래 소 · river_trench 깊은 홈 · river_riffle 자갈 여울 |
| `gear.*` | rod_float_1 입문 찌 로드 · rod_float_2 중급 찌 로드 · rod_float_3 고급 찌 로드 · rod_bottom_1 입문 바닥 로드 · rod_bottom_2 중급 바닥 로드 · rod_bottom_3 고급 바닥 로드 · reel_1 입문 릴 · reel_2 중급 릴 · reel_3 고급 릴 · line_1 나일론 4kg · line_2 카본 8kg · line_3 합사 18kg · hook_s 바늘(소) · hook_m 바늘(중) · hook_l 바늘(대) · float_1 막대찌 · float_2 고감도 막대찌 · float_3 장거리 막대찌 · sinker_1 조개봉돌 · sinker_2 고리봉돌 · sinker_3 삼각봉돌 |
| `bait.*` | worm 지렁이 · paste 떡밥 · corn 옥수수 · shrimp 새우 · krill 크릴 · live 생미끼 |
| `skill.*` | casting 캐스팅 숙련 · hookset 챔질 감각 · dragSense 드랙 감각 · lineCare 라인 관리 · pumping 펌핑 기술 · knowledge 어종 지식 · baitCraft 미끼 효율 · netting 뜰채 숙련 · haggling 흥정 · mastery 낚시 숙련 |
| `skillDesc.<id>.<1..3>` | §7.7 표의 효과를 한 줄로(예: `casting.1` 「비거리 +6% · 완벽 띠 넓게」) — 30개 |
| `band.*` · `weather.*` · `layer.*` | 새벽 · 아침 · 낮 · 저녁 · 밤 / 맑음 · 흐림 · 비 / 표층 · 중층 · 바닥 |
| `set.*` · `tier.*` · `style.*` | float 찌 채비 · bottom 바닥 채비 / normal 보통 · trophy 트로피 · legend 레전드 / heavy 무게형 · runner 돌진형 · thrasher 요동형 · jumper 점프형 · diver 잠수형 · small 소형 |
| `npc.<stage>.greet` | lake 「오늘 물 좋네요. 잡은 거 있으면 보여 줘요.」 · coast 「어서 오세요! 싱싱한 걸로 값 쳐 드릴게요.」 · river 「어서 와요! 오늘 연어 올라온다던데요.」 |

**실패 · 사유 · 안내**

| 키 | 값 |
|---|---|
| `fail.lineBreak` · `fail.spoolEmpty` · `fail.rodBreak` · `fail.hookOff` · `fail.early` · `fail.late` | 라인이 끊어졌다 · 스풀이 바닥났다 — 라인을 다 뺏겼다 · 로드가 부러졌다 — 예비 로드로 바꾼다 · 바늘이 빠졌다 · 헛챔질 — 너무 일렀다 · 늦었다 — 미끼만 뺏겼다 |
| `fail.loss` | 「미끼 {bait} · 채비 −{cost}원 · 라인 −{line}m」 |
| `fail.spareSpool` · `fail.dragLowered` · `fail.hookSmall` | 라인을 다 잃었다 — 예비 스풀(나일론 4kg)로 바꾼다 · 예비 로드 — 드랙을 {kg}kg으로 낮췄다 · 바늘이 작다(입이 큰 어종) |
| `fail.cause.slack` · `fail.cause.jump` · `fail.cause.shake` · `fail.cause.active` | 줄이 느슨했다 · 점프 때 로드를 세웠다 · 머리를 흔들 때 줄이 느슨했다 · 몸부림에 바늘이 빠졌다 |
| `reason.*` | busy 지금은 할 수 없다 · locked 아직 갈 수 없다(레벨 {n}) · holdFull 어창이 가득 찼다 — 바꾸거나 방생하자 · holdFullCast 어창이 가득 — 잡으면 바꾸거나 방생해야 한다 · noBait 미끼가 없다 — 채비(Tab)에서 바꾸거나 판매상에서 사자 · noLine 라인이 부족하다 — 판매상에서 감거나 집으로 · money 돈이 모자란다 · level 레벨 {n}이 필요하다 · mastery 낚시 숙련 {n}이 필요하다 · notOwned 가지고 있지 않다 · inUse 다른 채비에 끼워져 있다 · maxRank 이미 최고 단계다 · noPoints 스킬 포인트가 없다 · notHere 여기서는 할 수 없다 · stub 준비 중 · same 이미 여기다 · wrongSlot · wrongSet · invalid 잘못된 선택 |
| `hint.<id>.title` | start 시작 · stage 스테이지 · controls 낚시 조작 · cast 캐스팅 · bite 입질과 챔질 · fight 드랙과 텐션 · net 뜰채 · drift 흘림 · bottomRig 바닥 채비 · holdFull 어창 (아래 줄들은 각 `.body`) |
| `hint.start.body` | 「WASD 이동 · 마우스 둘러보기 · E 상호작용. 문으로 나가 호수로 가자 — PC에서는 상점 · 날씨 · 도감 · 스킬」 |
| `hint.stage.body` | 「바닥의 흰 고리가 낚시 자리다(E). 판매상에게 물고기를 판다 · 캠프에서 다음 시간대로 건너뛰거나 집으로 간다」 |
| `hint.controls.body` | 「좌클릭 캐스팅 · 릴링 · 우클릭 펌핑 · A/D 조준 · Space 챔질 · Esc 일어나기」 |
| `hint.holdFull.body` | 「어창(12마리)이 찼다 — 판매상에게 팔거나 집에 가면 비워진다. 그 전에 잡으면 어창의 가장 싼 것과 바꾸거나 방생한다」 |
| `hint.cast.body` | 「좌클릭을 누르고 있으면 힘이 오르내린다 — 밝은 띠에서 놓으면 가장 멀리 간다. 1 찌 채비 · 2 바닥 채비 · ↑↓ 찌 수심」 |
| `hint.bite.body` | 「찌가 톡톡 움직이는 건 예신. 쑥 잠기면(본신) Space로 챔질! 너무 이르면 헛챔질이다」 |
| `hint.fight.body` | 「텐션이 라인 강도를 넘으면 끊어진다. 드랙(휠 · Z/C)은 릴이 미끄러지기 시작하는 힘 — 물고기가 달릴 땐 풀고 쉴 땐 조여라. 좌클릭 릴링 · 우클릭 펌핑(로드를 세운다 — 세운 채 너무 당기면 로드가 부러진다)」 |
| `hint.net.body` | 「지친 물고기가 가까이 오면 Space로 뜰채」 |
| `hint.drift.body` | 「흐르는 자리다 — R로 베일을 열면 찌가 흐름을 타고 멀리 흘러간다. 다시 R로 멈춘다」 |
| `hint.bottomRig.body` | 「바닥 채비는 초리(로드 끝)를 본다 — 떨리다가 쑥 숙여지고 방울이 울리면 Space」 |
| `fatal.webglTitle` · `fatal.webglBody` · `title.noStorage` · `title.needInput` · `title.saveBroken` · `title.saveFuture` · `save.failed` | WebGL을 쓸 수 없다 · 브라우저의 하드웨어 가속을 켜고 다시 열어 주세요 · 저장할 수 없는 환경이다 — 진행이 남지 않는다 · 키보드와 마우스가 필요하다 · 세이브가 손상되어 백업하고 새로 시작한다 · 더 새 버전의 세이브다 — 백업하고 새로 시작한다 · 저장하지 못했다 |
| `prompt.clickToLook` · `hud.levelMax` · `hud.skillPoints` · `banner.levelUp` · `banner.tier3` | 클릭해서 시점 고정 · MAX · 스킬 +{n} (Tab) · 레벨 {n}! Tab → 스킬 · 3단계 장비 해금 |
| `confirm.newGame.title` · `confirm.newGame.body` · `result.swap` | 새 게임 · 기존 기록(레벨 {level} · 돈 {money}원)은 백업된다 · 어창의 {name}({price}원)과 바꾸기 |
| `hud.*` · `panel.*` · `prompt.*` · `banner.*` | 그 밖은 P8이 정한다(키 이름은 `hud.tension` · `prompt.spot` · `banner.trophy`처럼 영역.이름) |
