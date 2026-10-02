# ASHEN CYCLE — 구현 계약 (CONTRACT)

> `docs/BRIEF.md`가 방향이고, 이 문서가 **이름 · 단위 · 시그니처 · 수치**의 정본이다.
> 병렬 작업자는 서로의 파일을 보지 않고 이 문서만으로 맞물린다. 이 문서에 적힌 export 이름 · 필드 이름 · 이벤트 이름 · 단위는 **글자 그대로** 쓴다.
> 문서에 없는 것은 소유 패키지의 재량이다. 문서와 구현이 어긋나야 할 사정이 생기면 **자기 파일 안에서만** 해결하고(공개 시그니처는 유지), 사유를 `docs/NOTES-P#.md`(자기 패키지 번호)에 세 줄 이내로 남긴다.

## 목차

- §0 공통 규약 (단위 · 좌표 · 각도 · 벡터 · 코드 스타일)
- §1 디렉터리 트리와 파일 소유
- §2 의존 규칙
- §3 타입 카탈로그
- §4 이벤트 카탈로그
- §5 틱 순서 · 시간 처리 · 렌더 보간
- §6 모듈별 공개 API
- §7 데이터 표와 수치 (+ 밸런스 산수)
- §8 보스 프레임워크
- §9 view 계약
- §10 ui 계약
- §11 app 계약
- §12 테스트 계획
- §13 패키지별 완료 정의
- 부록 A 식별자 목록(ID · 문자열 키)

---

## §0 공통 규약

### 0.1 단위

| 항목 | 규약 |
|---|---|
| 시간 | **전부 초(second)**. 데이터 표 · 상태 · 이벤트 payload 어디에도 "프레임" 단위는 없다. 참고 환산: 1프레임 = 1/60초 = 0.0167초 |
| 고정 틱 | `DT = 1/60`초. `GameSim.step(dt, input)`의 `dt`는 항상 `DT`다 |
| 길이 | 미터(m). 플레이어 키 1.8, 몸통 반경 0.4 |
| 속도 | m/s · 각속도 rad/s |
| 각도 | **라디안**. 데이터 표에서도 라디안(주석으로 도 병기 가능) |
| 비율 | 0..1 실수 (퍼센트 아님) |
| 피해 · HP · 잔불 | HP에 적용하는 순간 `Math.round` 한 정수. 스태미나 · 체간은 실수 |

### 0.2 좌표와 각도 (가장 중요 — 모든 패키지가 같은 식을 쓴다)

- three.js 기본 그대로 **오른손 좌표계 · Y-up**. 전투는 **XZ 평면**. sim에는 Y가 없다(표현용 높이 `y`만 일부 상태에 있다).
- **facing(바라보는 각) θ의 방향 벡터 = `(x, z) = (sin θ, cos θ)`.**
  - θ = 0 → **+Z**를 본다. θ = +π/2 → **+X**를 본다. θ = π → −Z.
  - 두 점 사이 각: `angleOf(dx, dz) = Math.atan2(dx, dz)`.
  - three.js에서 그대로 `object.rotation.y = θ` 다(모든 캐릭터 모델은 **+Z를 앞**으로 만든다).
- **오른쪽 벡터** = `(−cos θ, sin θ)`. 즉 +Z를 보고 선 캐릭터의 오른손은 **−X 쪽**이다. (리그의 `R` 관절은 x < 0, `L` 관절은 x > 0)
- 로컬 → 월드: `world = pos + fwd·(sin θ, cos θ) + side·(−cos θ, sin θ)` (`side` 양수 = 오른쪽). `core/math2d.js`의 `localToWorld`.
- 각도는 `wrapAngle`로 `(−π, π]`에 둔다. 각도 차는 `angleDiff(from, to)`(부호 있음, +는 θ가 커지는 방향).
- 카메라 `yaw`도 같은 규약(카메라가 **바라보는** 수평 방향). 마우스를 오른쪽으로 움직이면 `yaw`가 **감소**한다.

### 0.3 2D 벡터

- sim의 2D 벡터는 **`{x, z}` 순수 객체** 하나로 통일한다(`Vec2`). 배열 · three `Vector2/3` 금지.
- 함수 인자는 숫자 쌍 `(x, z)`를 받는 것을 허용한다(할당 회피). 반환이 벡터면 `{x, z}`.
- 상태에 저장하는 위치는 `pos: {x, z}`, 이전 틱 위치는 `prevPos: {x, z}`.

### 0.4 코드 스타일

- ES 모듈, **named export만**(default export 금지). 파일 이름: 클래스 파일은 `PascalCase.js`, 나머지는 `camelCase.js`.
- sim 상태는 **순수 객체**(클래스 인스턴스 · Map · Set · 함수 참조를 상태에 넣지 않는다 — `structuredClone` 가능해야 한다). 로직은 `updateX(ctx, …)` 형태의 함수.
- **sim · bot의 수치는 `src/data/`에만 둔다.** 로직 파일의 숫자 리터럴은 0 · 1 · 2 · 0.5 · π 같은 수학 상수뿐이다. 이 문서 본문이 로직 규칙에 숫자를 적은 경우에도 그 값은 데이터 표에 이름이 있다(`PLAYER` · `COMBAT` · `BOSS_AI` · `BOT` · `CAMERA`). view · ui · audio의 연출 상수(색 · 입자 수 · 이징 길이)는 그 파일 상단의 `const`로 모은다.
- 모듈 최상위(import 시점)에서 `window` · `document` · `AudioContext` · `localStorage`를 건드리지 않는다 — 생성자/함수 안에서만.
- 타입은 `src/types.js`의 JSDoc `@typedef`를 `/** @typedef {import('../types.js').PlayerState} PlayerState */`로 끌어 쓴다.
- 과설계 금지: ECS · DI 컨테이너 · 상태 관리 라이브러리 · 제네릭 FSM 프레임워크를 만들지 않는다. `switch (state)` + 데이터 표.

---

## §1 디렉터리 트리와 파일 소유

**규칙**
1. 한 파일 = 한 소유 패키지. 웨이브 0(P0)이 **모든 파일을 스텁으로 먼저 만든다**. 그 뒤로는 표의 소유 패키지만 그 파일을 고친다.
2. 스텁은 이 문서의 시그니처 그대로 export 하고, **던지지 않는다** — §6.9 「스텁 값」에 적힌 중립 값을 반환한다(거기 없는 것은 `undefined`/빈 배열/`null`). 스텁 상태에서도 `npm run build`와 `npm test`가 통과해야 한다.
3. 패키지는 **자기 소유 폴더 안에** 내부 파일을 더 만들 수 있다(다른 패키지가 import하지 않는 파일). 폴더 소유는 표 아래에 적는다.
4. 「시드」라고 표시된 데이터 파일은 P0이 이 문서의 값으로 **완성해서** 만든다(다른 패키지가 웨이브 1에서 읽기 때문). 이후 값 조정은 소유 패키지만 한다.
5. 「완전 구현」이라고 표시된 `core/` 파일은 P0이 웨이브 0에서 끝낸다. 웨이브 1부터는 아무도 고치지 않는다(결함은 `NOTES-P#`에 적고 통합 게이트에서 고친다).

**웨이브**

| 웨이브 | 패키지 | 진행 | 게이트(§12.1) |
|---|---|---|---|
| W0 | P0 scaffold | 한 명 | 전체 `npm test` · `npm run build` |
| W1 | P1 · P2 · P3 · P4 · P5 · P6 · P7 · P8 | 8명 병렬 — 서로의 작업 중 파일을 보지 않는다 | 패키지 게이트(자기 테스트 파일 + 자기 파일이 원인인 빌드 오류 0) |
| W2 | P9 · P10 · P11 | 3명 병렬 — W1의 완성본 위에서 | 패키지 게이트 |
| W3 | 통합 게이트(오케스트레이터) | 패키지 아님 — 어떤 파일이든 고칠 수 있다 | 전체 `npm test` · `npm run build` · 봇 대전 전 보스(§12.4) · 브라우저 스모크(§12.5) |

```
AshenCycle/
├─ package.json                      P0
├─ vite.config.js                    P0
├─ index.html                        P0
├─ .gitignore                        P0
├─ README.md                         P9
├─ docs/
│  ├─ BRIEF.md                       (고정)
│  ├─ CONTRACT.md                    (고정)
│  └─ NOTES-P#.md                    각 패키지(선택)
├─ src/
│  ├─ main.js                        P9   (W0: P0이 「최소 부트」 스텁을 쓴다 — §11.6. W2에서 P9가 통째로 교체)
│  ├─ types.js                       P0   JSDoc typedef 전부(§3)
│  ├─ core/                               전부 완전 구현
│  │  ├─ constants.js                P0
│  │  ├─ events.js                   P0   EventBus + EV
│  │  ├─ inputFrame.js               P0   NEUTRAL_INPUT · makeInput
│  │  ├─ math2d.js                   P0
│  │  ├─ rng.js                      P0
│  │  ├─ hitShapes.js                P0   resolveShape · shapeHitsCircle · ringFromGrow (§6.1)
│  │  └─ collide.js                  P0   resolveCircleVsWorld · pushOutOfCircle · circleOverlapsWorld · sweepCircleVsWorld · segmentHitsCircle (§6.1)
│  ├─ data/
│  │  ├─ player.js                   P1   (시드)
│  │  ├─ weapons.js                  P1   (시드: 머리 필드 + §7.3 무브 표를 P0이 옮겨 둔다 · 이후 조정은 P1)
│  │  ├─ combat.js                   P2   (시드)
│  │  ├─ world.js                    P2   (시드)
│  │  ├─ bossCommon.js               P3   (시드) BOSS_AI
│  │  ├─ stats.js                    P4
│  │  ├─ economy.js                  P4
│  │  ├─ relics.js                   P4
│  │  ├─ camera.js                   P6   (시드) CAMERA
│  │  ├─ bot.js                      P9   (시드) BOT
│  │  ├─ bosses/
│  │  │  ├─ index.js                 P0   BOSS_DEFS · getBossDef
│  │  │  ├─ valder.js                P3
│  │  │  ├─ fenrir.js                P10
│  │  │  └─ nihil.js                 P11
│  │  ├─ keybinds.js                 P0   (완성)
│  │  ├─ settings.js                 P0   (완성)
│  │  ├─ palette.js                  P0   (완성)
│  │  └─ strings.ko.js               P8
│  ├─ sim/
│  │  ├─ GameSim.js                  P2
│  │  ├─ projectiles.js              P2
│  │  ├─ hazards.js                  P2
│  │  ├─ dummy.js                    P2
│  │  ├─ combat/
│  │  │  ├─ damage.js                P2
│  │  │  └─ hitRegistry.js           P2
│  │  ├─ world/
│  │  │  └─ town.js                  P2
│  │  ├─ player/
│  │  │  └─ playerSim.js             P1
│  │  ├─ boss/
│  │  │  ├─ bossSim.js               P3
│  │  │  ├─ bossAI.js                P3
│  │  │  ├─ bossTimeline.js          P3
│  │  │  ├─ validateBossDef.js       P3
│  │  │  └─ hooks/
│  │  │     ├─ index.js              P0   getBossHooks
│  │  │     ├─ valder.js             P3
│  │  │     ├─ fenrir.js             P10
│  │  │     └─ nihil.js              P11
│  │  └─ progression/
│  │     ├─ profile.js               P4
│  │     ├─ stats.js                 P4
│  │     ├─ economy.js               P4
│  │     ├─ Progression.js           P4
│  │     └─ save.js                  P4
│  ├─ bot/
│  │  └─ bot.js                      P9   헤드리스 봇(순수 JS)
│  ├─ view/
│  │  ├─ renderer.js                 P6
│  │  ├─ CameraRig.js                P6
│  │  ├─ world/
│  │  │  ├─ WorldLayer.js            P6
│  │  │  ├─ townScene.js             P6
│  │  │  ├─ arenaScene.js            P6
│  │  │  └─ proceduralTextures.js    P6
│  │  ├─ characters/
│  │  │  ├─ CharacterLayer.js        P5
│  │  │  ├─ rig.js                   P5   Rig · 빌더 3종
│  │  │  ├─ pose.js                  P5   포즈 수학 · attackPose · 이징
│  │  │  ├─ playerView.js            P5
│  │  │  ├─ weaponMeshes.js          P5
│  │  │  └─ npcView.js               P5   허수아비 · 대장장이 · 상인
│  │  ├─ bosses/
│  │  │  ├─ index.js                 P0   createBossView 레지스트리
│  │  │  ├─ valderView.js            P5
│  │  │  ├─ fenrirView.js            P10
│  │  │  └─ nihilView.js             P11
│  │  └─ fx/
│  │     ├─ FxLayer.js               P7
│  │     ├─ particles.js             P7
│  │     ├─ trails.js                P7
│  │     ├─ telegraphs.js            P7
│  │     ├─ projectileFx.js          P7
│  │     └─ damageNumbers.js         P7
│  ├─ audio/
│  │  ├─ AudioEngine.js              P7
│  │  ├─ sfx.js                      P7
│  │  └─ music.js                    P7
│  ├─ ui/
│  │  ├─ UIRoot.js                   P8
│  │  ├─ i18n.js                     P8
│  │  ├─ hud.js                      P8
│  │  ├─ styles.css                  P8
│  │  └─ panels/
│  │     ├─ titlePanel.js            P8
│  │     ├─ pausePanel.js            P8
│  │     ├─ bonfirePanel.js          P8
│  │     ├─ blacksmithPanel.js       P8
│  │     ├─ merchantPanel.js         P8
│  │     ├─ gatePanel.js             P8
│  │     └─ resultPanel.js           P8
│  └─ app/
│     ├─ Game.js                     P9
│     ├─ loop.js                     P9
│     ├─ screens.js                  P9
│     ├─ input.js                    P9
│     ├─ storage.js                  P9
│     └─ debugApi.js                 P9
└─ test/
   ├─ helpers.js                     P0
   ├─ core.test.js                   P0   수학 · 난수 · 버스 · 셰이프 판정 · 충돌
   ├─ layering.test.js               P0   금지 import 검사(전 계층) + sim/data/core/bot 순수성 토큰 검사 · 전 파일 import 스모크
   ├─ player.test.js                 P1
   ├─ combat.test.js                 P2
   ├─ gamesim.test.js                P2
   ├─ boss.framework.test.js         P3
   ├─ boss.valder.test.js            P3
   ├─ progression.test.js            P4
   ├─ economy.test.js                P4
   ├─ save.test.js                   P4
   ├─ rig.test.js                    P5
   ├─ bot.fight.test.js              P9
   ├─ boss.fenrir.test.js            P10
   └─ boss.nihil.test.js             P11
```

**폴더 소유(내부 파일 추가 허용 범위)**

| 폴더 | 패키지 | 폴더 | 패키지 |
|---|---|---|---|
| `src/core/` | P0 | `src/view/characters/` | P5 |
| `src/sim/player/` | P1 | `src/view/` 루트 · `src/view/world/` | P6 |
| `src/sim/` 루트 · `sim/combat/` · `sim/world/` | P2 | `src/view/fx/` · `src/audio/` | P7 |
| `src/sim/boss/`(hooks의 fenrir · nihil 제외) | P3 | `src/ui/` | P8 |
| `src/sim/progression/` | P4 | `src/app/` · `src/bot/` | P9 |

- 폴더 소유가 없는 곳: **`src/data/`는 트리에 적힌 파일만** 쓴다(새 데이터 파일을 만들지 않는다). **`src/view/bosses/`** 는 `<boss>*.js` 이름으로 그 보스의 소유 패키지가(`valder*` P5 · `fenrir*` P10 · `nihil*` P11). **`test/`** 는 자기 테스트 파일과 `<자기 테스트 이름>.*.js`(예: `player.fixtures.js`)만.
- P10 · P11은 트리에 적힌 자기 파일 4개씩만 쓴다(추가 파일이 필요하면 `fenrir*.js` / `nihil*.js` 이름으로 같은 폴더에 둔다).

**package.json (P0 고정 사항)**: `"type": "module"`, dependencies `three`(최신), devDependencies `vite`(최신). scripts — `dev: "vite"`, `build: "vite build"`, `preview: "vite preview"`, `test: "node --test \"test/**/*.test.js\""`. Node 22 기준. 그 밖의 의존성은 추가하지 않는다. (W0 확정: `three` 0.186 · `vite` 8. `vite.config.js` — `base: './'` · 개발/미리보기 서버 포트 **5183**(`strictPort`) · `build.target: 'es2022'`. `README.md`는 W0에 P0이 임시본을 쓰고 W2에서 P9가 다시 쓴다.)

**index.html (P0 고정 사항)**: `<canvas id="game-canvas">`, `<div id="ui-root">`, `<script type="module" src="/src/main.js">`. body 여백 0 · overflow hidden · 배경 `#0b0b0e`. 인라인 스타일 두 줄을 넣는다(크기와 클릭 통과는 이 두 줄이 정본이다):

```css
#game-canvas { display: block; width: 100vw; height: 100vh; }
#ui-root     { position: fixed; inset: 0; pointer-events: none; }
```

---

## §2 의존 규칙

```
core  ←  data  ←  sim  ←  bot
  ↑        ↑       ↑
  └────────┴───────┴──  view · audio · ui  ←  app
```

| 계층 | import 할 수 있는 것 | 금지 |
|---|---|---|
| `core/` | 없음(자기 계층만) | 전부 |
| `data/` | `core/` · `data/` | `three` · DOM · sim · view · ui |
| `sim/`(progression 포함) | `core/` · `data/` · `sim/` | **`three` · DOM(`window`/`document`) · WebAudio · `localStorage` · `performance` · `Date.now` · `Math.random`** |
| `bot/` | `core/` · `data/` | three · DOM · `sim/`(봇은 `GameState`를 인자로 받아 읽기만 한다) |
| `view/` | `three` · `three/addons/*` · `core/` · `data/` · `view/` (sim은 **타입만** — JSDoc `import('…')`) | `sim/` 런타임 import · sim 상태 변경 · `ui/` · `app/` · `audio/` |
| `audio/` | `core/` · `data/` | three · sim 상태 변경 |
| `ui/` | `core/` · `data/` · `ui/` | three · `view/` · `audio/` · `sim/` 런타임 import(생성자로 받은 `sim` · `progression` 객체만 쓴다) · sim 상태 직접 변경(명령 메서드만) |
| `app/` | 전부 | — |

- 셰이프 판정과 월드 충돌 기하는 **`core/hitShapes.js` · `core/collide.js`** 에 있다 — sim · bot · view(텔레그래프 · 카메라 충돌) · 테스트가 전부 같은 함수를 쓴다. 같은 기하를 자기 폴더에 다시 구현하지 않는다.
- **sim 안의 순환 금지 지점**: `sim/player/` ↔ `sim/boss/` 는 **서로 import하지 않는다.** 둘 다 `sim/combat/` · `sim/GameSim.js`를 import하지 않는다. 둘을 엮는 것은 `GameSim.js`와 `sim/combat/damage.js`뿐이다(P2가 P1 · P3 · P4의 공개 함수를 호출한다). 플레이어와 보스는 `ctx.state`의 **상대 상태를 읽기만** 한다.
- `sim/progression/`은 `sim/`의 다른 폴더를 import하지 않는다(`core/` · `data/`만).
- `data/bosses/index.js` → `valder.js · fenrir.js · nihil.js` 한 방향. `sim/boss/hooks/index.js` → 훅 3개 한 방향. `view/bosses/index.js` → 뷰 3개 한 방향.
- view의 세 레이어(`WorldLayer` · `CharacterLayer` · `FxLayer`)는 서로 import하지 않는다. `FxLayer`는 생성자 인자로 받은 `characters` 객체의 `getSocketWorld`만 호출한다.
- 난수는 `ctx.rng`(시드)만 쓴다. view/fx의 연출용 난수는 `Math.random` 허용.
- `test/layering.test.js`가 `src/sim/** · src/data/** · src/core/** · src/bot/**`의 import 문을 훑어 금지 의존(`three` · 상위 계층 경로)을 잡는다.

---

## §3 타입 카탈로그

P0이 아래를 `src/types.js`에 그대로 옮긴다(파일 끝에 `export {}`). 주석의 단위 · 범위가 계약이다.

### 3.1 기초 · 입력

```js
/** @typedef {{x:number, z:number}} Vec2  XZ 평면 벡터(m) */

/** @typedef {'valder'|'fenrir'|'nihil'} BossId */
/** @typedef {'longsword'|'greatsword'|'spear'} WeaponId */
/** @typedef {'vit'|'end'|'str'|'dex'} StatId */
/** @typedef {'bonfire'|'blacksmith'|'merchant'|'gate'} FacilityId */
/** @typedef {'fire'|'frost'|'void'|'danger'} FxStyle */

/**
 * 한 틱의 입력. app(또는 봇)이 만든다. sim은 읽기만 한다.
 * @typedef {Object} InputFrame
 * @property {number} moveX  월드 공간 이동 의도 x (−1..1). 카메라 기준 → 월드 변환은 app이 끝낸다
 * @property {number} moveZ  월드 공간 이동 의도 z (−1..1). (moveX, moveZ)의 길이 ≤ 1
 * @property {boolean} sprint        달리기 홀드
 * @property {boolean} guard         가드 홀드
 * @property {boolean} heavyHeld     강공격 홀드(차지 유지 판정)
 * @property {boolean} lightPressed  이번 틱에 눌림(에지). 한 번 누르면 정확히 한 틱만 true
 * @property {boolean} heavyPressed  에지
 * @property {boolean} rollPressed   에지
 * @property {boolean} flaskPressed  에지
 * @property {boolean} lockOnPressed 에지
 * @property {boolean} interactPressed 에지
 */
```

### 3.2 히트 셰이프

```js
/**
 * 데이터에 적는 상대 셰이프. 원점 = 소유자 pos, 기준 방향 = 소유자 facing.
 * fwd = 앞(+) 거리 m, side = 오른쪽(+) 거리 m.
 * @typedef {(
 *   {type:'circle', r:number, fwd?:number, side?:number} |
 *   {type:'arc', r:number, rInner?:number, halfAngle:number, dirOffset?:number} |
 *   {type:'ring', rInner:number, rOuter:number} |
 *   {type:'capsule', fwd0:number, fwd1:number, side?:number, r:number}
 * )} ShapeDef
 *   arc: 원점에서 반경 rInner..r, 중심 방향 facing+dirOffset, 좌우 halfAngle(rad). halfAngle ≥ π면 원
 *   ring: 원점 중심의 띠
 *   capsule: 원점에서 앞쪽 fwd0..fwd1 선분(옆으로 side 만큼 평행 이동)을 r로 부풀린 것
 */

/**
 * 월드 공간으로 푼 셰이프(판정 · 텔레그래프 그리기 공용).
 * @typedef {(
 *   {type:'circle', x:number, z:number, r:number} |
 *   {type:'arc', x:number, z:number, r:number, rInner:number, dir:number, halfAngle:number} |
 *   {type:'ring', x:number, z:number, rInner:number, rOuter:number} |
 *   {type:'capsule', ax:number, az:number, bx:number, bz:number, r:number}
 * )} HitShape
 */

/**
 * 공격자가 "이번 틱에 살아 있는 판정"으로 내놓는 것. P1 · P3가 만들고 P2가 판정한다.
 * @typedef {Object} OutgoingHit
 * @property {'player'|'boss'|'projectile'|'hazard'} source
 * @property {string} attackId     플레이어: MoveDef.id / 보스: BossAttackDef.id / 그 외: kind
 * @property {number} hitId        판정 인스턴스 번호(ctx.nextHitId()). 같은 hitId는 한 대상을 한 번만 때린다
 * @property {ShapeDef} shapeDef
 * @property {number} x            셰이프 원점 x
 * @property {number} z
 * @property {number} facing       셰이프 기준 방향
 * @property {number} damage       공격 측 배율을 모두 곱한 피해(대상 측 보정 전, 실수)
 * @property {number} posture      보스에게 쌓는 체간(플레이어 → 보스만. 그 외 0)
 * @property {boolean} guardable   가드로 막을 수 있는가(플레이어 → 보스에서는 무시)
 * @property {boolean} parryable   패링할 수 있는가
 * @property {boolean} knockdown   맞으면 넘어지는가(보스 → 플레이어)
 * @property {boolean} heavy       강타 연출(스파크 · 흔들림 크게)
 * @property {boolean} execute     처형 타격(자동 명중 · 체간 누적 없음)
 * @property {number} hitstop      명중 시 요청할 히트스톱(초). 0이면 P2가 data/combat 기본값을 쓴다
 *                                 (W1 확정: 기본값이 있는 것은 **플레이어가 맞는 쪽**(`bossHitHitstop` 등)뿐이다 — 플레이어 타격의 0은 히트스톱 없음)
 *
 * 만드는 쪽별 채움 규칙:
 *   플레이어(P1)  — 전 필드를 MoveDef에서. guardable · parryable · knockdown = false
 *   보스(P3)      — heavy = hit.knockdown, hitstop = 0, posture = 0, execute = false. 나머지는 BossHitDef에서
 *   투사체(P2)    — parryable = spec.parryable, heavy = knockdown, hitstop = 0, posture = 0, execute = false,
 *                   shapeDef = {type:'circle', r}, facing = 진행 방향 dir
 *   장판(P2)      — parryable = false, heavy = knockdown, hitstop = 0, posture = 0, execute = false,
 *                   facing = 생성 시 facing (판정은 Hazard.shape — 이미 월드 공간 — 를 바로 쓴다)
 */

/**
 * @typedef {Object} DamageResult
 * @property {'player'|'boss'|'projectile'|'hazard'} source
 * @property {'player'|'boss'|'dummy'} target
 * @property {'hit'|'guard'|'parry'|'dodge'|'immune'} outcome
 * @property {number} damage       실제로 깎인 HP(정수, 0 이상)
 * @property {number} rawDamage    경감 전 피해
 * @property {number} posture      보스에 실제로 쌓인 체간
 * @property {number} staminaDamage 가드로 깎인 스태미나
 * @property {boolean} crit        치명(패링당함/그로기 상태의 보스를 때림)
 * @property {boolean} heavy
 * @property {boolean} execute
 * @property {boolean} knockdown
 * @property {boolean} guardBreak  이 타격으로 가드가 깨졌는가
 * @property {boolean} postureBroken 이 타격으로 체간이 가득 찼는가
 * @property {boolean} lethal      이 타격으로 대상 HP가 0이 됐는가
 * @property {number} x  충돌 지점 x(대상 원의 공격자 쪽 표면)
 * @property {number} z
 * @property {number} y  표현용 높이(m). 플레이어 1.1, 보스 def.height×0.55, 허수아비 1.0
 * @property {number} dir  힘의 방향(rad) — 공격 원점에서 대상을 향하는 각
 * @property {string} attackId
 * @property {number} hitId
 */
```

### 3.3 능력치 · 무기 · 유물

```js
/**
 * 파생 능력치. P4의 computeStatBlock(profile)이 만들고 P1 · P2가 읽는다. 유물 효과가 이미 반영돼 있다
 * (P1 · P2는 유물 ID를 모른다).
 * @typedef {Object} StatBlock
 * @property {number} level            1 + 투자 점수 합
 * @property {number} hpMax
 * @property {number} staminaMax
 * @property {number} staminaRegen     초당
 * @property {WeaponId} weaponId
 * @property {number} weaponLevel      0..10
 * @property {number} weaponDamage     무기 기본 피해 × 강화 배율
 * @property {number} damageMul        근력 배율(1.0~)
 * @property {number} postureMul       기량 × 무기 강화의 체간 배율(1.0~)
 * @property {number} critMul          패링당함/그로기 보스에 대한 피해 배율(1.25~)
 * @property {number} executeMul       처형 피해 배율(1.0~)
 * @property {number} guardReduction   가드 피해 경감 0..1 (무기)
 * @property {number} guardStaminaFactor 가드 시 스태미나 소모 = 들어온 피해 × 이 값 (무기 × 유물)
 * @property {number} flaskCharges     플라스크 최대 충전
 * @property {number} flaskHeal        1회 회복량(HP)
 * @property {number} parryWindow      패링 창(초)
 * @property {number} parryPosture     패링 1회가 보스에 쌓는 체간
 * @property {number} postRollDmgMul   구르기 직후 피해 배율(기본 1)
 * @property {number} postRollWindow   그 지속(초, 기본 0)
 * @property {number} lifesteal        준 피해 중 HP로 돌아오는 비율(기본 0)
 * @property {number} lowHpThreshold   저체력 기준 0..1 (기본 0)
 * @property {number} lowHpDmgMul      저체력 시 피해 배율(기본 1)
 * @property {number} emberGainMul     잔불 획득 배율(기본 1)
 */

/**
 * 플레이어 공격 한 타. 시간은 전부 초.
 * @typedef {Object} MoveDef
 * @property {string} id            'light1'..'light4' | 'heavy' | 'dash' | 'rollAtk'  ('execute'는 무브 표에 없다 — attackId 전용, §7.1 처형)
 * @property {'light'|'heavy'|'dash'|'roll'} kind
 * @property {string} motion        포즈 계열(§9.6): 'slashR'|'slashL'|'slashUp'|'overhead'|'thrust'|'spin'|'sweep'
 * @property {number} windup        예고(초)
 * @property {number} active        판정(초)
 * @property {number} recovery      후딜(초)
 * @property {number} chargeMax     홀드 차지 최대(초). heavy만 > 0, 나머지 0
 * @property {number} dmgMul        피해 배율
 * @property {number} chargeDmgMul  완충 시 피해 배율(차지 0→1에 따라 1→이 값으로 선형). 체간은 PLAYER.chargePostureMul을 쓴다
 * @property {number} posture       체간 피해(기본값. StatBlock.postureMul을 곱한다)
 * @property {number} stamina       소모
 * @property {ShapeDef} shape
 * @property {number} lunge         전진 거리(m). 예고 끝 PLAYER.attack.lungeLead초 전 ~ 판정 끝 사이에 이동
 * @property {number} comboAt       후딜 진입 후 이 시간(초)부터 다음 공격으로 넘어갈 수 있다. 연속기 끝이면 recovery와 같다
 *                                  (예외: 강공격 뒤의 강공격은 comboAt이 아니라 후딜이 끝난 뒤에만 시작한다 — §7.1)
 * @property {number} rollCancelAt  후딜 진입 후 이 시간부터 구르기 · 가드 · 플라스크로 캔슬 가능
 * @property {string|null} next     다음 약공격 id(연속기). 없으면 null
 * @property {number} hitstop       명중 시 히트스톱(초)
 * @property {boolean} heavy        강타 연출 여부
 */

/**
 * @typedef {Object} WeaponDef
 * @property {WeaponId} id
 * @property {'oneHand'|'twoHand'|'polearm'} grip   view가 쥐는 자세 · 메시 선택에 쓴다
 * @property {number} baseDamage
 * @property {number} guardReduction      0..1
 * @property {number} guardStaminaFactor
 * @property {number} reach               봇 · UI용 대략 사거리(m, 플레이어 중심에서)
 * @property {number} length              무기 메시 길이(m) — view · 궤적용
 * @property {Record<string, MoveDef>} moves  키 = MoveDef.id
 */

/**
 * @typedef {Object} RelicDef
 * @property {string} id
 * @property {number} price                잔불
 * @property {Partial<StatBlock>} mods     더하는 값(add) — 아래 mul과 중복 키 금지
 * @property {Partial<StatBlock>} mul      곱하는 값
 * @property {Partial<StatBlock>} set      덮어쓰는 값(lowHpThreshold 같은 것)
 */
```

### 3.4 플레이어 상태

```js
/**
 * @typedef {'idle'|'move'|'roll'|'backstep'|'attack'|'guard'|'guardHit'|'guardBreak'|'parry'|
 *           'flask'|'stagger'|'knockdown'|'getup'|'execute'|'dead'} PlayerStateName
 *   idle      서 있음
 *   move      걷기/달리기(sprinting 플래그로 구분)
 *   roll      구르기(방향 입력 있음)        backstep  백스텝(방향 입력 없음)
 *   attack    공격(세부는 attack 필드)
 *   guard     가드 홀드(이동 가능, 느림)    guardHit  가드 중 피격 경직
 *   guardBreak 가드 붕괴(스태미나 0)        parry     패링 성공 자세
 *   flask     플라스크 사용
 *   stagger   피격 경직                     knockdown 넘어짐       getup 일어남
 *   execute   처형 연출                     dead      사망
 */

/**
 * @typedef {Object} PlayerAttack
 * @property {string} moveId
 * @property {WeaponId} weaponId
 * @property {'light'|'heavy'|'dash'|'roll'|'execute'} kind
 * @property {string} motion
 * @property {number} comboIndex   0부터. 약공격 연속기의 몇 번째인가
 * @property {'windup'|'charge'|'active'|'recovery'} phase
 * @property {number} phaseT       현재 구간 진행도 0..1 (charge에서는 차지량 0..1)
 * @property {number} charge       확정된 차지량 0..1 (active 진입 시 고정)
 * @property {number} hitId        이 휘두르기의 판정 번호
 */

/**
 * @typedef {Object} InputBuffer
 * @property {'light'|'heavy'|'roll'|'flask'|null} action  한 칸. 새 입력이 덮어쓴다
 * @property {number} t            남은 유효 시간(초). 저장할 때 attack 상태면 PLAYER.bufferAttack, 아니면 PLAYER.buffer(W5 확정: 공격 중의 roll · flask는 캔슬 창까지 — §7.1)
 * @property {number} dirX         버퍼 순간의 이동 의도(구르기 방향용 — 소비 틱에 이동 의도가 없을 때만 쓴다)
 * @property {number} dirZ
 */

/**
 * @typedef {Object} PlayerState
 * @property {Vec2} pos
 * @property {Vec2} prevPos        이전 틱 위치(렌더 보간용)
 * @property {Vec2} vel            m/s
 * @property {number} facing       rad
 * @property {number} prevFacing
 * @property {number} radius       0.4
 * @property {number} hp
 * @property {number} stamina
 * @property {number} staminaDelay 스태미나 회복 재개까지 남은 시간(초)
 * @property {boolean} exhausted   스태미나 0을 찍어 달리기/가드가 막힌 상태
 * @property {StatBlock} stats     현재 파생 능력치(hpMax · staminaMax는 여기서 읽는다)
 * @property {PlayerStateName} state
 * @property {number} stateTime    현재 상태 진입 후 경과(초)
 * @property {number} stateDur     현재 상태의 예정 길이(초). 무기한이면 0
 * @property {PlayerAttack|null} attack  state === 'attack' | 'execute' 일 때만 non-null
 * @property {boolean} iframe      이번 틱에 무적인가(구르기 창 · 넘어짐 · 처형 · 패링 자세 · 피격 직후 포함)
 * @property {boolean} guarding    이번 틱에 가드 판정이 서 있는가
 * @property {boolean} parryActive 이번 틱이 패링 창 안인가 (= state === 'guard' && parryT > 0)
 * @property {number} parryT       패링 창 남은 시간(초)
 * @property {number} parryArmT    가드 버튼을 누른 뒤, guard 상태에 들어가면 패링 창이 열리는 유예 남은 시간(초). 0이면 창이 열리지 않는다
 * @property {number} parryRearm   패링 창 재사용까지 남은 시간(초). 가드 입력을 뗀 틱에 건다
 * @property {boolean} guardHeldPrev 이전 틱의 input.guard(상승 에지 검출용. 히트스톱 틱에는 갱신하지 않는다)
 * @property {boolean} canExecute  이번 틱의 약공격 입력이 처형이 되는가(§7.1 처형 조건 && 현재 상태가 약공격을 받는다). P1이 매 틱 갱신
 * @property {boolean} lockOn      록온 중인가(대상은 항상 보스)
 * @property {boolean} sprinting
 * @property {number} sprintTime   달리기 지속(초) — 대시 공격 조건
 * @property {Vec2} rollDir        구르기 방향(단위 벡터)
 * @property {number} flasks       남은 플라스크
 * @property {InputBuffer} buffer
 * @property {number} hurtInvuln   피격 직후 무적 남은 시간(초)
 * @property {number} postRollT    구르기 직후 피해 증가 남은 시간(초)
 * @property {number} stepDist     발소리용 누적 이동 거리(m)
 * @property {Vec2} knockVel       넉백 속도(m/s) — 감쇠하며 pos에 더해진다
 * @property {number} [lightLock]  (W1 확정) 후딜을 구르기 · 가드 · 플라스크로 캔슬한 뒤 약공격이 다시 허용되기까지 남은 시간(초). P1 내부용 —
 *                                 `createPlayerState`가 0으로 만든다. 필드가 없는 상태(`makeTestPlayer` 리터럴)는 0으로 본다. 다른 패키지는 읽지 않는다
 * @property {number} [heavyLock]  (W1 확정) 같은 뜻의 강공격 잠금(초) — §7.1 「후딜 캔슬 잠금」
 */
```

### 3.5 보스 상태 · 보스 정의

```js
/**
 * @typedef {'intro'|'idle'|'chase'|'attack'|'parried'|'groggy'|'executed'|'recover'|'phaseShift'|'dead'} BossStateName
 *   intro      등장 연출(무적)             idle     다음 행동 고르는 중(플레이어 쪽으로 돈다)
 *   chase      거리 조절 이동(moveIntent)  attack   공격(세부는 attack 필드)
 *   parried    패링당해 튕겨남             groggy   체간 붕괴(처형 가능)
 *   executed   처형 타격을 맞는 중         recover  일어남
 *   phaseShift 2페이즈 전환 포효(무적)     dead     사망
 */

/**
 * @typedef {Object} BossAttackRuntime
 * @property {string} id           BossAttackDef.id
 * @property {number} seq          공격 인스턴스 일련번호(1부터 증가)
 * @property {string} pose         view용 포즈 키(BossAttackDef.pose)
 * @property {FxStyle|'none'} glow 예고 발광 색
 * @property {'windup'|'active'|'recovery'} phase
 * @property {number} phaseT       구간 진행도 0..1
 * @property {number} t            공격 시작 후 경과(초)
 * @property {number} windup       이번 인스턴스의 실제 예고 길이(초) — 페이즈/순환 배속 반영
 * @property {number} active       실제 판정 길이(초)
 * @property {number} recovery     실제 후딜 길이(초)
 * @property {boolean} locked      방향이 고정됐는가
 * @property {number} aimX         고정된 조준점(도약 착지 · 순간이동 기준). 고정 전에는 플레이어 현재 위치
 * @property {number} aimZ
 * @property {boolean} chained     연속기로 이어진 공격인가
 * @property {number[]} fired      이미 실행한 타임라인 이벤트 인덱스
 * @property {number[]} hitIds     hits[i]의 현재 hitId(틱 판정이면 틱마다 갱신)
 * @property {Object} [fw]         (W1 확정) 프레임워크(P3) 내부 기억 — 순수 값 · `structuredClone` 가능. 없으면 P3가 그 자리에서 만든다. 다른 패키지는 읽지 않는다
 */

/**
 * @typedef {Object} BossState
 * @property {BossId} id
 * @property {Vec2} pos
 * @property {Vec2} prevPos
 * @property {number} facing
 * @property {number} prevFacing
 * @property {number} y            표현용 높이(m). 도약 · 부유. 판정에는 안 쓴다
 * @property {number} prevY
 * @property {number} radius       몸통 원 반경
 * @property {number} hp
 * @property {number} hpMax        순환 배율 반영
 * @property {number} posture      0..postureMax
 * @property {number} postureMax
 * @property {number} postureIdle  마지막 체간 피해 후 경과(초)
 * @property {boolean} [postureGuard] (W5 확정) 체간 잠금 — 그로기에서 일어난 뒤 다음 공격의 판정이 시작될 때까지 true. 그동안 체간이 쌓이지 않는다(§8.7). 없으면 false
 * @property {1|2} phase
 * @property {boolean} pendingPhase 2페이즈 전환이 예약됐는가
 * @property {BossStateName} state
 * @property {number} stateTime
 * @property {number} stateDur
 * @property {BossAttackRuntime|null} attack   state === 'attack' 일 때만 non-null
 * @property {string[]} lastAttacks  최근 공격 id(최신이 [0], 길이 ≤ 2)
 * @property {Record<string, number>} cooldowns  attackId → 남은 초
 * @property {'approach'|'strafe'|'retreat'|'hold'} moveIntent
 * @property {1|-1} strafeDir
 * @property {number} chaseTime    후보 없이 chase를 이어 온 시간(초)
 * @property {boolean} invulnerable 피해 · 체간을 받지 않는가
 * @property {number} dmgMul       현재 피해 배율(순환 × 페이즈)
 * @property {number} speedMul     현재 공격 배속(순환 × 페이즈). windup · recovery를 이 값으로 나눈다
 * @property {number} stepDist     발소리용 누적 이동 거리
 * @property {Object} ext          보스별 확장 필드(훅이 쓴다). §8.10~8.12의 보스별 절에 필드를 적는다
 * @property {Object} [fw]         (W1 확정) 프레임워크(P3) 내부 기억(onCreate 호출 여부 · seq 카운터 · 스트레이프 타이머 등). 훅 · 다른 패키지는 읽지도 쓰지도 않는다
 */

/**
 * @typedef {Object} BossHitDef
 * @property {number} t0           판정 시작 = 0 기준(초). §8.1의 tA
 * @property {number} t1           판정 끝
 * @property {number} interval     > 0이면 t0부터 이 간격으로 반복 타격(브레스). 0이면 한 번
 * @property {ShapeDef} shape
 * @property {number} damage
 * @property {boolean} guardable
 * @property {boolean} parryable
 * @property {boolean} knockdown
 * @property {boolean} telegraph   예고 중 바닥 표식을 그릴까
 * @property {ShapeDef} [telegraphShape]  표식만 다른 모양일 때(돌진의 긴 선 · 광선이 쓸고 가는 부채 전체)
 * @property {'self'|'aim'} [telegraphAt]  표식 원점. 기본 'self'(보스 위치·방향), 'aim'은 조준점
 */

/**
 * @typedef {Object} BossMoveDef
 * @property {'lunge'|'charge'|'leap'|'hop'} kind
 * @property {number} t0           이동 시작(tA 기준 초, 음수 = 예고 중)
 * @property {number} t1           이동 끝
 * @property {number} dist         최대 이동 거리(m)
 * @property {number} [stopShort]  lunge · leap: 대상 중심에서 이만큼 못 미쳐 멈춘다(m). 기본 radius + BOSS_AI.stopShortPad
 * @property {number} [height]     leap · hop: 정점 높이(m, 표현용 y)
 * @property {number} [aimLock]    leap: 조준점이 고정되는 시각(tA 기준 초, 음수)
 */

/**
 * @typedef {Object} BossTimelineEvent
 * @property {number} t            실행 시각(tA 기준 초)
 * @property {'projectile'|'hazard'|'teleport'|'cue'|'hook'} type
 * @property {1|2} [phase]         이 페이즈에서만 실행(없으면 항상)
 * @property {ProjectileSpec} [proj]     type 'projectile'
 * @property {number} [count]            projectile · hazard 개수(기본 1)
 * @property {number} [interval]         개수 > 1일 때 발사/소환 간격(초)
 * @property {number} [spread]           projectile: 부채 전체 각(rad)
 * @property {{fwd:number, side:number}} [origin]  projectile 발사점(보스 로컬)
 * @property {HazardSpec} [hazard]       type 'hazard'
 * @property {HazardPlace} [place]       type 'hazard'
 * @property {'away'|'behindTarget'|'flank'|'center'} [to]  type 'teleport'
 * @property {number} [dist]             teleport: 대상에서의 거리(m)
 * @property {string} [cue]              type 'cue' — §4의 큐 어휘
 * @property {number[]} [shake]          cue: [진폭 m, 길이 초] — 있으면 CAMERA_SHAKE도 낸다
 * @property {Object} [params]           cue payload에 그대로 실린다(length · halfAngle 등)
 * @property {string} [name]             type 'hook' — hooks.onTimelineEvent로 넘어간다
 */

/**
 * @typedef {Object} HazardPlace
 * @property {'self'|'target'|'aim'|'scatter'|'ringAround'|'chase'} mode
 *   self: 보스 위치 · 방향   target: 플레이어 현재 위치   aim: 공격의 조준점
 *   scatter: 플레이어 중심 radius 안의 무작위 count개(첫 개는 플레이어 위치)
 *   ringAround: 보스 중심 radius 원 위에 count개 균등
 *   chase: interval마다 그 순간의 플레이어 위치(+lead초 예측)에 하나씩, count개
 * @property {number} [radius]
 * @property {number} [lead]       초. 플레이어 속도 × lead 만큼 앞을 겨눈다
 */

/**
 * @typedef {Object} BossAttackSelect
 * @property {number} minRange     중심 간 거리(m)
 * @property {number} maxRange
 * @property {number} [minAngle]   |정면에서 플레이어까지의 각| 하한(rad). 기본 0
 * @property {number} [maxAngle]   상한. 기본 π
 * @property {number} weight
 * @property {number} cooldown     초
 * @property {1|2} [minPhase]      기본 1
 * @property {1|2} [maxPhase]      기본 2
 */

/**
 * @typedef {Object} BossChainDef
 * @property {string} next
 * @property {number} chance       1페이즈 확률
 * @property {number} chanceP2     2페이즈 확률
 * @property {number} at           후딜 진입 후 이 시간(초)에 판정해 넘어간다
 * @property {number} [maxRange]   플레이어가 이 거리 안일 때만
 */

/**
 * @typedef {Object} BossAttackDef
 * @property {string} id
 * @property {string} pose               view 포즈 키
 * @property {FxStyle|'none'} glow
 * @property {number} windup             예고(초) — 0.45 이상
 * @property {number} active             판정 구간 전체 길이(초)
 * @property {number} recovery           후딜(초)
 * @property {BossAttackSelect|null} sel null이면 연속기 전용(AI가 직접 고르지 않는다)
 * @property {BossHitDef[]} hits
 * @property {BossMoveDef|null} move
 * @property {{turnRate:number, lockLead:number, activeTurnRate?:number, sweep?:{from:number,to:number}}} track
 *   turnRate: 예고 중 추적 각속도(rad/s). lockLead: 판정 시작 이만큼 전에 방향 고정(초).
 *   activeTurnRate: 판정 중 추적 각속도(브레스). sweep: 판정 중 고정 방향 기준 from→to로 회전(광선)
 * @property {BossTimelineEvent[]} events
 * @property {BossChainDef[]} chain
 */

/**
 * @typedef {Object} BossDef
 * @property {BossId} id
 * @property {'humanoid'|'quadruped'|'floater'} rig
 * @property {string} arenaId            data/world.js의 WORLDS 키
 * @property {FxStyle} style             대표 색
 * @property {number} hp
 * @property {number} postureMax
 * @property {number} postureDecayDelay  초
 * @property {number} postureDecayRate   초당
 * @property {number} radius             중심 원 반경(m). 월드 충돌 · AI 거리 · 플레이어의 전진 정지/처형 거리 · 봇 사거리는 이 원만 본다
 * @property {BossBodyPart[]} [bodyParts] 몸통 원들. 생략하면 [{fwd: 0, r: radius}]. **P2만 쓴다** — 플레이어 타격의 명중 검사(어느 한 원)와
 *                                        몸통 밀어내기(모든 원). 긴 몸(사족)이 머리 · 엉덩이에서도 맞고 막히게 한다
 * @property {number} height             표현용 키(m)
 * @property {number} moveSpeed          m/s
 * @property {number} turnRate           idle/chase 회전(rad/s)
 * @property {number} preferredRange     chase가 맞추려는 거리(m)
 * @property {boolean} kite              true면 플레이어가 가까울 때 물러난다(원거리형)
 * @property {number} stride             발소리 간격(m). 0이면 발소리 없음
 * @property {[number, number]} think    공격 사이 고민 시간 [min, max] 초
 * @property {number} introDur
 * @property {number} parriedDur
 * @property {number} groggyDur
 * @property {number} executedDur
 * @property {number} recoverDur
 * @property {number} phaseShiftDur
 * @property {{hpFrac:number, speedMul:number, dmgMul:number, thinkMul:number, moveSpeedMul:number}} phase2
 * @property {string} fallbackAttack     후보가 계속 없을 때 강제로 쓰는 공격 id
 * @property {number} reward             격파 기본 잔불
 * @property {Record<string, BossAttackDef>} attacks
 */

/**
 * 보스 전용 로직의 확장 지점. 전부 선택.
 * @typedef {Object} BossHooks
 * @property {(ctx:SimCtx)=>void} [onCreate]              ext 초기화
 * @property {(ctx:SimCtx, dt:number)=>void} [onTick]     매 틱(상태 갱신 뒤)
 * @property {(ctx:SimCtx, cands:{id:string, weight:number}[])=>void} [adjustWeights]  후보 가중치를 제자리에서 고친다
 * @property {(ctx:SimCtx)=>string|null} [forceAttack]    non-null이면 AI 선택을 건너뛰고 이 공격
 * @property {(ctx:SimCtx, atk:BossAttackRuntime)=>void} [onAttackStart]
 * @property {(ctx:SimCtx, atk:BossAttackRuntime)=>void} [onAttackEnd]
 * @property {(ctx:SimCtx, ev:BossTimelineEvent)=>void} [onTimelineEvent]  type 'hook'
 * @property {(ctx:SimCtx, phase:number)=>void} [onPhaseChange]
 */

/** 보스 몸통을 이루는 원 하나. 보스 로컬(facing 기준) — 중심에서 앞으로 fwd(m), 반경 r(m).
 * @typedef {{fwd:number, r:number}} BossBodyPart */
```

### 3.6 투사체 · 장판 · 텔레그래프

```js
/**
 * @typedef {Object} ProjectileSpec
 * @property {string} kind         표현 키(부록 A)
 * @property {FxStyle} style
 * @property {number} speed        m/s
 * @property {number} r            반경(m)
 * @property {number} life         초
 * @property {number} homing       유도 각속도(rad/s). 0이면 직선
 * @property {number} homingTime   유도가 유지되는 시간(초)
 * @property {number} damage
 * @property {boolean} guardable
 * @property {boolean} parryable   패링으로 쳐낼 수 있는가(쳐내면 소멸 + 보스 체간 — §6.4)
 * @property {boolean} knockdown
 * @property {number} y            표현용 높이(m)
 */

/**
 * @typedef {Object} Projectile
 * @property {number} id
 * @property {string} kind
 * @property {FxStyle} style
 * @property {number} x
 * @property {number} z
 * @property {number} prevX
 * @property {number} prevZ
 * @property {number} y
 * @property {number} dir          진행 방향(rad)
 * @property {number} speed
 * @property {number} r
 * @property {number} age          초
 * @property {number} life
 * @property {number} homing
 * @property {number} homingTime
 * @property {number} damage       순환/페이즈 배율이 곱해진 값
 * @property {boolean} guardable
 * @property {boolean} parryable
 * @property {boolean} knockdown
 * @property {number} hitId
 */

/**
 * 장판은 항상 패링 불가다(필드 없음).
 * @typedef {Object} HazardSpec
 * @property {string} kind         표현 키(부록 A)
 * @property {FxStyle} style
 * @property {ShapeDef} [shape]    장판 원점 · 방향 기준. grow가 있으면 생략한다(shape와 grow 중 정확히 하나)
 * @property {number} warn         경고 시간(초). 이 동안 바닥 표식만 보인다
 * @property {number} active       판정 시간(초)
 * @property {number} interval     > 0이면 active 동안 이 간격으로 반복 타격. 0이면 한 번
 * @property {number} damage
 * @property {boolean} guardable
 * @property {boolean} knockdown
 * @property {{r0:number, r1:number, width:number}} [grow]  충격파: active 동안 띠 중심 반경이 r0→r1로 커진다
 */

/**
 * @typedef {Object} Hazard
 * @property {number} id
 * @property {string} kind
 * @property {FxStyle} style
 * @property {'warn'|'active'} state
 * @property {number} t            현재 state에서의 경과(초)
 * @property {number} warn
 * @property {number} active
 * @property {number} interval
 * @property {HitShape} shape      **월드 공간** 현재 모양(grow면 매 틱 갱신)
 * @property {number} damage
 * @property {boolean} guardable
 * @property {boolean} knockdown
 * @property {number} hitId
 * @property {number} nextTick     다음 반복 타격까지 남은 시간(초)
 * @property {{r0:number, r1:number, width:number}|null} grow
 * @property {number} x            원점
 * @property {number} z
 * @property {number} [facing]     (W1 확정) 생성 시 방향(rad) — 장판 판정의 `OutgoingHit.facing` 출처(§3.2). `spawnHazard`가 채운다. 없으면 0으로 본다
 */

/**
 * 바닥 예고 표식. GameSim이 매 틱 다시 만든다(state.telegraphs). view는 id로 생성/갱신/제거한다.
 * @typedef {Object} Telegraph
 * @property {string} id           'atk:<seq>:<hitIndex>' | 'hz:<hazardId>'
 * @property {HitShape} shape      월드 공간
 * @property {number} progress     0..1 — 1이 되는 순간 판정이 시작된다
 * @property {FxStyle} style
 * @property {'boss'|'hazard'} source
 */

/** P3가 내놓는 미해결 텔레그래프(P2가 월드로 푼다).
 * @typedef {{id:string, shapeDef:ShapeDef, x:number, z:number, facing:number, progress:number, style:FxStyle}} TelegraphSrc */
```

### 3.7 월드

```js
/**
 * @typedef {({type:'circle', x:number, z:number, r:number} |
 *            {type:'box', x:number, z:number, hw:number, hd:number})} Collider
 *   box는 축 정렬. hw = x 반폭, hd = z 반폭
 */

/**
 * @typedef {Object} WorldDef
 * @property {string} id            'town' | 'arena_valder' | 'arena_fenrir' | 'arena_nihil'
 * @property {'town'|'arena'} kind
 * @property {'town'|'ember'|'frost'|'void'} theme
 * @property {number} radius        원형 경계 반경(m). 중심은 원점
 * @property {Collider[]} colliders
 * @property {{x:number, z:number, facing:number}} playerSpawn
 * @property {{x:number, z:number, facing:number}|null} bossSpawn
 * @property {{id:FacilityId, x:number, z:number, r:number}[]} facilities  상호작용 지점과 반경(마을만)
 * @property {{x:number, z:number}|null} dummy   허수아비 위치(마을만)
 * @property {{id:string, x:number, z:number, facing:number}[]} npcs  'blacksmith' | 'merchant'
 */
```

### 3.8 게임 상태

```js
/**
 * @typedef {Object} FightState
 * @property {BossId} bossId
 * @property {'intro'|'fight'|'outro'|'done'} phase
 * @property {number} time          'fight' 구간 누적(초)
 * @property {number} phaseTime     현재 phase 경과(초)
 * @property {number} damageDealt   보스에게 준 피해 합(HP 기준, hpMax를 넘지 않는다)
 * @property {number} damageTaken
 * @property {number} parries
 * @property {number} executions
 * @property {null|'victory'|'death'} outcome
 * @property {RewardResult|null} reward
 */

/**
 * @typedef {Object} DummyState
 * @property {number} x
 * @property {number} z
 * @property {number} radius        0.5
 * @property {number} lastDamage    마지막 타격 피해
 * @property {number} total         누적 피해(3초 맞지 않으면 0으로)
 * @property {number} sinceHit      마지막 타격 후 경과(초)
 */

/**
 * @typedef {Object} GameState
 * @property {'town'|'boss'} mode
 * @property {number} tick          step 호출 횟수(히트스톱 틱 포함)
 * @property {number} time          시뮬레이션 시간(초). 히트스톱 중에는 멈춘다
 * @property {number} hitstop       남은 히트스톱(초)
 * @property {WorldDef} world       현재 월드(data/world.js의 객체 참조 — 고치지 않는다)
 * @property {PlayerState} player
 * @property {BossState|null} boss
 * @property {DummyState|null} dummy
 * @property {Projectile[]} projectiles
 * @property {Hazard[]} hazards
 * @property {Telegraph[]} telegraphs
 * @property {FightState|null} fight
 * @property {FacilityId|null} nearFacility  마을에서 상호작용 가능한 시설(없으면 null)
 * @property {Profile} profile      살아 있는 프로필 참조(Progression과 같은 객체)
 * @property {{godMode:boolean, noStamina:boolean}} debug
 * @property {{name:string, payload:Object}[]} events  이번 틱에 쌓인 이벤트 큐(플러시 뒤 빈다)
 * @property {{hitId:number, target:'player'|'boss'|'dummy'}[]} hitLog  판정 등록부(같은 hitId × 대상은 한 번만).
 *                                  등록 시 push, 길이가 COMBAT.hitLogMax를 넘으면 앞에서 버린다. 모드 전환 때 비운다
 * @property {number} rngState      시드 난수 상태(uint32)
 * @property {number} nextId        hitId · 투사체 · 장판 id 공용 카운터
 */

/**
 * P1 · P3가 받는 틱 컨텍스트. GameSim이 한 번 만들어 재사용한다.
 * @typedef {Object} SimCtx
 * @property {GameState} state
 * @property {Rng} rng
 * @property {(name:string, payload?:Object)=>void} emit       state.events에 쌓는다
 * @property {()=>number} nextHitId
 * @property {(seconds:number)=>void} requestHitstop           max(현재, 요청), 상한 COMBAT.hitstopMax
 * @property {(amp:number, dur:number)=>void} shake            CAMERA_SHAKE를 쌓는다
 * @property {(spec:ProjectileSpec, x:number, z:number, dir:number, damageMul:number)=>Projectile} spawnProjectile
 * @property {(spec:HazardSpec, x:number, z:number, facing:number, damageMul:number)=>Hazard} spawnHazard
 * @property {BossDef|null} bossDef      현재 보스 정의(마을이면 null). P3는 레지스트리 대신 이것을 읽는다
 * @property {BossHooks} bossHooks       현재 보스 훅(없으면 {})
 * @property {CycleScaling} scaling      현재 순환 배율(마을이면 전부 1)
 */
```

### 3.9 진행 · 보상 · 저장 · 설정

```js
/**
 * @typedef {Object} BossProgress
 * @property {boolean} unlocked
 * @property {number} attempts        누적 도전 횟수
 * @property {number} totalKills
 * @property {number} killsThisCycle
 * @property {number} bestFraction    이번 순환 최고 피해 비율 0..1
 * @property {number} milestones      이번 순환에 받은 파편 구간 수(0..3 — 0.25 · 0.5 · 0.75)
 */

/**
 * @typedef {Object} Profile
 * @property {number} embers
 * @property {number} shards
 * @property {{vit:number, end:number, str:number, dex:number}} stats   투자 점수(0..40)
 * @property {Record<WeaponId, {level:number}>} weapons
 * @property {WeaponId} equippedWeapon
 * @property {number} flaskChargeLv   0..3
 * @property {number} flaskHealLv     0..5
 * @property {string[]} relicsOwned
 * @property {[string|null, string|null]} relicsEquipped
 * @property {number} cycle           0부터
 * @property {Record<BossId, BossProgress>} bosses
 * @property {{deaths:number, kills:number, embersEarned:number, playTime:number}} totals  applyReward가 갱신한다(playTime = 교전 시간 합, 초)
 * @property {number} seed            uint32 — 다음 보스전 시드의 재료
 */

/**
 * @typedef {Object} RewardResult
 * @property {BossId} bossId
 * @property {number} cycle           이 보상이 계산된 순환
 * @property {boolean} victory
 * @property {number} damageFraction  0..1
 * @property {number} duration        이 판의 교전 시간(초) = fight.time
 * @property {number} embers          이번에 받은 잔불(정수)
 * @property {number} shards          이번에 받은 파편
 * @property {number[]} milestones    새로 달성한 구간 [0.25, 0.5 …]
 * @property {boolean} firstKill      이번 순환 첫 격파인가
 * @property {number} repeatMul       재도전 감쇠 배율(1 · 0.5 · 0.25)
 * @property {BossId|null} unlocked   새로 열린 보스
 * @property {boolean} cycleAdvanced  이 보상으로 순환이 올랐는가
 * @property {number} embersAfter     지급 후 보유 잔불
 */

/**
 * @typedef {Object} Settings
 * @property {number} mouseSensitivity 0.2..3 (기본 1)
 * @property {boolean} invertY
 * @property {number} volumeMaster    0..1 (기본 0.8)
 * @property {number} volumeSfx       0..1 (기본 1)
 * @property {number} volumeMusic     0..1 (기본 0.6)
 * @property {'low'|'medium'|'high'} quality  (기본 'medium')
 * @property {number} cameraShake     0..1 (기본 1)
 * @property {boolean} damageNumbers  (기본 true)
 */

/**
 * 설정은 세이브에 넣지 않는다 — 별도 키(SETTINGS_KEY)에 따로 저장한다(§11.4).
 * @typedef {Object} SaveData
 * @property {number} version         현재 1
 * @property {number} savedAt         epoch ms(app이 채운다 — sim은 Date를 쓰지 않는다)
 * @property {Profile} profile
 */

/** @typedef {{ok:boolean, reason?:'embers'|'shards'|'max'|'locked'|'owned'|'invalid'}} CmdResult */

/**
 * @typedef {Object} CycleScaling
 * @property {number} hpMul
 * @property {number} dmgMul
 * @property {number} rewardMul
 * @property {number} speedMul        공격 배속에 곱한다
 * @property {number} thinkMul        고민 시간에 곱한다
 * @property {number} chainBonus      연속기 확률에 더한다
 */

/** @typedef {{next:()=>number, range:(a:number,b:number)=>number, int:(a:number,b:number)=>number,
 *             chance:(p:number)=>boolean, pick:<T>(arr:T[])=>T, getState:()=>number, setState:(s:number)=>void}} Rng */
```

---

## §4 이벤트 카탈로그

### 4.1 버스 규칙

- 버스는 하나다: `new EventBus()`를 app이 만들어 모든 계층에 넘긴다. 이름은 `core/events.js`의 `EV` 상수만 쓴다(문자열 리터럴 금지).
- **sim 이벤트는 큐에 쌓였다가 틱 끝에 한꺼번에 발행된다.** sim 코드는 `bus.emit`을 직접 부르지 않고 `ctx.emit(name, payload)`만 쓴다. `GameSim.step`의 마지막 단계와 `GameSim`의 **모든 공개 명령 메서드**(`enterTown` · `startBossFight` · `restAtBonfire` · `refreshStats` · `forfeitFight` · `debug*`)의 끝에서 `state.events`를 순서대로 `bus.emit` 하고 비운다. → 구독자는 항상 **틱이 끝난 일관된 상태**를 본다.
- **플러시는 재진입에 안전해야 한다.** 리스너가 플러시 도중에 명령 메서드를 부르는 일은 정상 경로다(`INTERACT` → app이 패널을 연다 → 패널이 `sim.restAtBonfire()`를 부른다). 구현은 이 모양 그대로다:

  ```js
  _flush() {
    if (this._flushing) return;            // 안쪽 호출은 큐에 쌓기만 한다
    this._flushing = true;
    try {
      while (this.state.events.length) {
        const q = this.state.events; this.state.events = [];
        for (const e of q) this.bus.emit(e.name, e.payload);
      }
    } finally { this._flushing = false; }
  }
  ```

  안쪽에서 쌓인 이벤트는 바깥 `while`이 이어서 발행한다 → 어떤 이벤트도 두 번 나가거나 사라지지 않는다. `_flushing`은 인스턴스 필드다(`state`에 넣지 않는다).
- sim 로직은 이벤트에 의존하지 않는다(이벤트는 표현용 알림이다). sim 안의 상호작용은 §6의 함수 호출로만 한다.
- progression · ui · app 이벤트는 즉시 발행한다.
- payload는 순수 객체. 위치는 `x`, `z`(+ 표현용 높이 `y`가 있으면 m).
- 구독자는 payload를 고치지 않는다. 리스너 예외는 삼키지 않는다(그대로 전파 — 테스트가 잡는다).

### 4.2 sim 이벤트 (발행: 표의 패키지 · 틱 끝 플러시)

| EV 키 | 문자열 | payload | 발행 | 주요 구독 |
|---|---|---|---|---|
| `MODE_CHANGED` | `mode/changed` | `{mode:'town'\|'boss', worldId, bossId:BossId\|null}` | P2 | world(씬 교체) · characters(보스 뷰 생성/제거) · fx(전부 정리) · audio(분위기 음) · ui(HUD 구성) · app(저장) |
| `FIGHT_STARTED` | `fight/started` | `{bossId, cycle, hpMax}` | P2 | ui(보스 바) · audio(보스 음악) |
| `FIGHT_PHASE` | `fight/phase` | `{phase:'intro'\|'fight'\|'outro'\|'done'}` | P2 | ui · camera |
| `FIGHT_ENDED` | `fight/ended` | `{bossId, outcome:'victory'\|'death', reward:RewardResult, duration, damageFraction}` | P2(outro 끝) | app(결과 화면) · audio |
| `REWARD_GRANTED` | `reward/granted` | `{reward:RewardResult}` | P2(사망/승리 순간 · `forfeitFight`) | app(저장) · ui(잔불 카운터 증가 연출) |
| `CYCLE_ADVANCED` | `cycle/advanced` | `{cycle}` | P2 | ui(배너) |
| `PLAYER_ATTACK_START` | `player/attackStart` | `{moveId, kind, motion, weaponId, comboIndex}` | P1(예고 시작) | audio(기합/준비음) |
| `PLAYER_SWING` | `player/swing` | `{moveId, kind, motion, weaponId, charge, heavy, dur}` — `dur` = 판정 길이(초). 처형은 `{moveId:'execute', kind:'execute', heavy:true, dur: DT}` | P1(판정 시작) | fx(무기 궤적 시작) · audio(휘두르기) |
| `PLAYER_CHARGE_FULL` | `player/chargeFull` | `{x, z}` | P1 | fx(반짝) · audio |
| `PLAYER_ROLL` | `player/roll` | `{x, z, dir, backstep:boolean}` | P1 | fx(먼지) · audio |
| `PLAYER_STEP` | `player/step` | `{x, z, sprint:boolean}` | P1(보폭마다) | audio(발소리) · fx(작은 먼지) |
| `PLAYER_GUARD` | `player/guard` | `{on:boolean}` | P1 | audio |
| `PLAYER_FLASK` | `player/flask` | `{phase:'start'\|'heal'\|'empty', amount, left}` | P1 | fx(회복 빛) · audio · ui |
| `PLAYER_STAMINA_OUT` | `player/staminaOut` | `{}` | P1(0을 찍은 순간) | ui(바 깜빡임) · audio |
| `PLAYER_DODGED` | `player/dodged` | `{attackId, x, z}` | P2(구르기 무적으로 흘린 순간 · hitId당 1회) | fx(잔상) · audio(휙) |
| `LOCKON_CHANGED` | `player/lockOn` | `{on:boolean}` | P1(토글 · 자동 해제) · P2(보스전 시작 시 자동 록온) | camera · ui · audio |
| `EXECUTE_STARTED` | `player/execute` | `{x, z, bossX, bossZ}` | P1 | camera(당김) · audio |
| `PLAYER_RESTED` | `player/rested` | `{}` | P2(`restAtBonfire`) | fx · audio |
| `PLAYER_DIED` | `player/died` | `{x, z, bossId}` | P2 | ui(`YOU DIED`) · audio · camera |
| `HIT` | `combat/hit` | `DamageResult` 전체 필드 + `{kind:string}`(무기 id · 투사체/장판 kind · 보스 attackId) | P2 | fx(스파크/피격/가드/패링) · audio · characters(피격 점멸) · ui(피해 수치) · fx(피해 숫자) |
| `HITSTOP` | `combat/hitstop` | `{dur}` | P2 | (디버그 · 선택) |
| `CAMERA_SHAKE` | `camera/shake` | `{amp, dur}` — 진폭 m, 길이 초 | P2(타격) · P3(큐) | camera |
| `BOSS_ATTACK_WINDUP` | `boss/windup` | `{bossId, attackId, seq, pose, glow, windup, x, z, facing}` | P3 | audio(예고음) · fx(발광) |
| `BOSS_ATTACK_ACTIVE` | `boss/active` | `{bossId, attackId, seq, pose, active, x, z, facing}` | P3 | fx(보스 무기 궤적) · audio |
| `BOSS_ATTACK_END` | `boss/attackEnd` | `{bossId, attackId, seq, interrupted:boolean}` — 후딜 끝 · 연속기 전환 · 중단(패링/그로기/사망) | P3 | fx(광선/브레스 정리) |
| `BOSS_CUE` | `boss/cue` | `{bossId, attackId, seq, cue, style, x, z, facing, ...params}` — 공격 밖의 큐(인트로 · 페이즈 포효)는 `attackId: ''`, `seq: 0` | P3 | fx · audio (§9.7 표) |
| `BOSS_STEP` | `boss/step` | `{x, z, heavy:boolean}` | P3 | audio(쿵) · fx(먼지) |
| `BOSS_PHASE_CHANGED` | `boss/phase` | `{bossId, phase:2}` — phaseShift 진입 순간 | P3 | ui(바 연출) · audio(음악 강화) · fx · world(조명) |
| `BOSS_GROGGY` | `boss/groggy` | `{bossId, on:boolean, x, z}` — `on:false`는 그로기를 벗어나는 **모든** 경로(처형 · 자연 종료 · 사망)에서 낸다 | P3 | fx(머리 위 표식) · audio |
| `BOSS_TELEPORT` | `boss/teleport` | `{fromX, fromZ, toX, toZ}` | P3 | fx · audio |
| `BOSS_DEFEATED` | `boss/defeated` | `{bossId, x, z}` | P2 | ui(`보스 격파`) · fx · audio · camera |
| `PROJECTILE_SPAWNED` | `proj/spawned` | `{id, kind, style, x, z, y}` | P2 | fx · audio |
| `PROJECTILE_ENDED` | `proj/ended` | `{id, kind, style, x, z, y, reason:'hit'\|'guard'\|'parry'\|'wall'\|'expire'\|'clear'}` — `'clear'`(승리 · 사망 · 모드 전환의 일괄 정리)는 **폭발 · 소리 없이** 제거한다 | P2 | fx(폭발) · audio |
| `HAZARD_SPAWNED` | `hazard/spawned` | `{id, kind, style, x, z, warn, active, shape:HitShape}` — `shape`는 생성 시점의 월드 모양(grow면 u = 0의 띠) | P2 | fx(warn 동안의 연출 — 떨어지는 검 등) · audio |
| `HAZARD_ACTIVATED` | `hazard/activated` | `{id, kind, style, shape:HitShape}` | P2(warn → active) | fx(분출) · audio · camera |
| `HAZARD_ENDED` | `hazard/ended` | `{id, reason:'expire'\|'clear'}` | P2 | fx |
| `NEAR_FACILITY_CHANGED` | `town/near` | `{id:FacilityId\|null}` | P2 | ui(프롬프트) |
| `INTERACT` | `town/interact` | `{id:FacilityId}` | P2 | app → ui(패널 열기) |

**W1 확정(발행 쪽이 정한 세부 — 구독자는 이것을 전제로 한다)**
- `HIT`는 반응 호출(`onBossDamaged` · `onBossParried` · `onPlayerDamaged` · `onPlayerDealtHit`) **뒤에** 큐에 들어간다 — 같은 플러시에서 `BOSS_GROGGY` · `BOSS_ATTACK_END`가 그 `HIT`보다 먼저 나올 수 있다.
- 모드 전환의 일괄 정리(`PROJECTILE_ENDED{clear}` · `HAZARD_ENDED{clear}`)는 **`MODE_CHANGED` 뒤에** 나온다(전환의 첫 이벤트는 언제나 `MODE_CHANGED`). 구독자는 이미 치운 id의 `*_ENDED{clear}`를 무시한다. 평소에는 승리 · 사망 · 포기 · outro 끝(`done` 직전)에 이미 치워져 전환 때 남는 것이 없다.
- 마을을 떠날 때(`enterTown` · `startBossFight`) `nearFacility`가 non-null이었으면 `MODE_CHANGED` 뒤에 `NEAR_FACILITY_CHANGED{id:null}`을 낸다. 마을에 들어온 첫 틱에 `{id:'bonfire'}`가 나온다.
- `HITSTOP{dur}`는 요청마다 나간다(`dur` = 병합 뒤 남은 히트스톱). `PLAYER_GUARD`는 `guarding`이 바뀔 때만. `PLAYER_FLASK.amount`는 `start` · `empty`에서 0, `heal`에서 실제로 찬 HP. `PLAYER_SWING`(처형)은 `motion` · `weaponId` · `charge: 0`도 싣는다.
- `BOSS_STEP.heavy` = `moveIntent`가 `approach` · `retreat`면 true, `strafe`면 false. `BOSS_TELEPORT`는 목적지를 못 찾으면 from = to로 나간다.

**큐 어휘(`BOSS_CUE.cue`)** — P3 · P10 · P11은 이 목록의 값만 쓴다(P7이 전부 구현한다):
`roar` · `howl` · `slam` · `stomp` · `whoosh` · `charge_start` · `land` · `cast` · `blink_out` · `blink_in` · `breath_start` · `breath_end` · `beam_start` · `beam_end` · `enchant` · `shatter`.

- `breath_start` · `beam_start`의 params: `{length, halfAngle | width, socket?: string, y?: number}`. fx는 `*_end` 또는 **같은 `seq`의** `BOSS_ATTACK_END`까지 매 프레임 따라 그린다 — 원점은 `characters.getSocketWorld('boss', socket)`, 실패하면(소켓 없음 · 스텁 뷰) 보스 보간 위치 + `(0, y ?? def.height × 0.55, 0)`. 방향은 보스의 보간 facing, 수평.
- 지속 연출(브레스 · 광선 · 예고 발광)의 시작과 끝은 `seq`로 짝짓는다 — 연속기에서 같은 `attackId`가 다시 나와도 섞이지 않는다.

### 4.3 progression 이벤트 (발행: P4 `Progression` · 즉시)

| EV 키 | 문자열 | payload | 구독 |
|---|---|---|---|
| `PROFILE_CHANGED` | `profile/changed` | `{reason:'levelUp'\|'upgrade'\|'equip'\|'buy'\|'relic'\|'reward'\|'reset'\|'debug'}` — `'reward'`는 P2가(틱 끝 플러시), `'reset'`은 app이(새 게임 · 이어하기로 profile 내용을 갈아 끼운 직후) 낸다 | **GameSim(마을이면 `refreshStats(true)`)** · ui(패널/HUD 갱신) · app(저장) |
| `LEVEL_UP` | `profile/levelUp` | `{stat:StatId, points, level, cost}` | ui · audio · fx |
| `WEAPON_UPGRADED` | `profile/weaponUp` | `{weaponId, level}` | ui · audio |
| `WEAPON_EQUIPPED` | `profile/weaponEquip` | `{weaponId}` | characters(무기 메시 교체) · audio |
| `ITEM_PURCHASED` | `profile/buy` | `{itemId}` | ui · audio |
| `RELIC_EQUIPPED` | `profile/relic` | `{slot:0\|1, relicId:string\|null}` | ui · audio |
| `PURCHASE_FAILED` | `profile/fail` | `{reason}` | ui(흔들림) · audio(거절음) |

### 4.4 ui · app 이벤트 (즉시)

| EV 키 | 문자열 | payload | 발행 | 구독 |
|---|---|---|---|---|
| `UI_OPENED` | `ui/opened` | `{panel, blocking:boolean}` | P8 | app(입력 차단 · 포인터 락 해제) · audio |
| `UI_CLOSED` | `ui/closed` | `{panel}` | P8 | app(포인터 락 재요청) · audio |
| `UI_SOUND` | `ui/sound` | `{kind:'hover'\|'click'\|'confirm'\|'deny'}` | P8 | audio |
| `SCREEN_CHANGED` | `app/screen` | `{from, to}` | P9 | ui · audio |
| `PAUSED` | `app/paused` | `{paused:boolean}` | P9 | audio(덕킹) · ui |
| `SETTINGS_CHANGED` | `app/settings` | `{settings:Settings}` | P9 | app 자신(`rc.setQuality` 호출 · 설정 저장) · camera(감도) · audio(볼륨) · fx(입자 예산 · 피해 숫자) |
| `SAVED` | `app/saved` | `{}` | P9 | ui(저장 아이콘 · 선택) |

---

## §5 틱 순서 · 시간 처리 · 렌더 보간

### 5.1 `GameSim.step(dt, input)` — 이 순서 그대로

```
A. tick += 1
   prev 복사: player.prevPos ← pos, prevFacing ← facing
              boss.prevPos/prevFacing/prevY ← 현재값
              projectiles[i].prevX/prevZ ← x/z
B. fight?.phase === 'done' 이면 → M(플러시)로 가서 끝.            (결과 화면 동안 세계 정지)
C. hitstop > 0 이면:
     hitstop = max(0, hitstop − dt)
     bufferPlayerInput(ctx, input, dt)      [P1] 선입력 + 록온 토글만 받는다(상태 · 타이머는 안 움직인다)
     → M으로 가서 끝.                        (time은 진행하지 않는다)
D. time += dt
E. updatePlayer(ctx, input, dt)             [P1] 상태 기계 · 스태미나 · pos 적분(충돌 전)
F. boss 있으면 updateBoss(ctx, dt)          [P3] AI · 공격 타임라인 · 이동 · 투사체/장판 소환 요청
G. 충돌 해소                                 [P2]
     G1. 플레이어 vs 월드(원형 경계 · 콜라이더)
     G2. 보스 vs 월드(중심 원 radius)
     G3. 플레이어 vs 보스 몸통(bodyParts의 모든 원 — 플레이어만 밀려난다) · 플레이어 vs 허수아비
         boss.state === 'dead'면 보스 몸통은 건너뛴다(쓰러진 보스는 밀지 않는다)
         (W3 확정) 보스가 돌진(move.kind 'charge'의 t0..t1) 중이면 중심선 방향이 아니라 **진행 방향에 수직으로만**
         비켜 세운다 — 한 틱에 최대 COMBAT.chargeShoveSpeed × DT, 그동안의 겹침은 허용. 일직선의 플레이어를 밀고 가지 않고 지나친다
     G4. 플레이어 vs 월드를 한 번 더(G3이 밀어낸 결과를 경계 · 콜라이더 안으로 되돌린다.
         그 결과 보스 원과 다시 겹치는 것은 허용한다 — 벽이 우선이다)
H. updateProjectiles(ctx, dt) · updateHazards(ctx, dt)   [P2] 이동 · 유도 · 수명 · warn→active
I. 판정 해소                                 [P2]
     I0. pHit = getPlayerHit(ctx), bHits = getBossHits(ctx) 를 **먼저 둘 다 수집**한다
     I1. 플레이어 → 보스(boss 모드) / 허수아비(town): pHit 해소
         이 결과 boss.hp === 0 이면 I2~I4를 건너뛴다(승리 틱에는 플레이어가 맞지 않는다)
     I2. 보스 → 플레이어: 수집해 둔 bHits를 배열 순서대로 해소
         (I1이 공격을 중단시켰어도 — 그로기 · 패링 — 이번 틱에 수집한 판정은 유효하다 = 맞교환)
     I3. 투사체 → 플레이어 · 콜라이더 · 경계
     I4. 장판(active) → 플레이어
     **틱당 플레이어 피격은 최대 1회**: I2~I4를 거치는 동안 플레이어가 outcome hit · guard · parry 중
     하나를 받으면, 그 틱의 남은 플레이어 대상 판정은 전부 건너뛴다(레지스트리에 등록하지 않는다 —
     다음 틱에 다시 본다. 그때는 P1이 세운 무적/가드 상태가 적용된다).
J. 보스전 흐름                                [P2] — **HP로 판정한다**(상태 이름에 기대지 않는다)
     intro: boss.state !== 'intro' || fight.phaseTime ≥ ctx.bossDef.introDur → phase = 'fight'
     fight: boss.hp <= 0 → 승리 / (아니고) player.hp <= 0 → 사망
            → 투사체 · 장판 정리('clear') → 보상 계산 · 지급 · 이벤트 · phase = 'outro'
     outro: phaseTime ≥ 길이(COMBAT.outroVictory | outroDeath) → phase = 'done' · FIGHT_ENDED
     (intro · fight · outro에서 fight.phaseTime += dt, fight에서 fight.time += dt)
K. 마을: nearFacility 갱신 · input.interactPressed면 INTERACT · 허수아비 타이머
L. state.telegraphs 재구성(getBossTelegraphs + warn 중인 hazards)
M. state.rngState ← rng.getState(); 플러시(§4.1)
```

- E · F는 **상대 상태를 읽기만** 한다(F는 E가 끝난 플레이어 위치를 본다 — 한 틱 차이는 허용).
- I의 세부(무적 · 가드 · 패링 · 치명)는 §6.4 `damage.js`.
- 마을에서는 F · I2~I4 · J가 없다. 보스 모드에서는 K가 없다.
- J의 승리/사망 순간에 내는 이벤트 순서: `BOSS_DEFEATED` | `PLAYER_DIED` → `REWARD_GRANTED` → `PROFILE_CHANGED{reason:'reward'}` → (순환이 올랐으면) `CYCLE_ADVANCED` → `FIGHT_PHASE{outro}`. 보상은 `computeReward(profile, bossId, {victory, damageFraction: fight.damageDealt / boss.hpMax, duration: fight.time})` → `applyReward(profile, reward)` → `fight.reward = reward` · `fight.outcome`.
- 승리 틱에는 플레이어가 맞지 않으므로(I1) 승리와 사망이 한 틱에 겹치지 않는다. 그래도 둘 다 참이면(디버그로 HP를 직접 쓴 경우) 승리로 본다.

### 5.2 히트스톱

- sim 내부 상태다(`state.hitstop`). 요청은 `ctx.requestHitstop(초)` — `hitstop = min(COMBAT.hitstopMax, max(hitstop, 요청))`.
- 히트스톱 틱에는 **A(prev 복사)는 돈다** → prev = cur이 되어 화면에서 캐릭터가 멈춘다. 플레이어 · 보스 · 투사체 · 장판 · 쿨다운 · `time` 전부 정지. 선입력과 록온 토글만 받는다(조작이 씹히지 않게).
- view의 파티클 · 카메라 흔들림 · UI는 렌더 시간으로 계속 돈다(멈춘 화면 위로 스파크가 튄다).

### 5.3 일시정지 · 배속 · 패널

- **일시정지**: app이 `step`을 부르지 않는다. 렌더는 계속하되 레이어에 `dt = 0`을 넘긴다.
- **블로킹 패널**(화톳불 등)이 열린 동안: app은 `step`을 계속 부르되 입력을 `NEUTRAL_INPUT`으로 바꾼다(마을은 위험이 없다).
- **배속**(디버그): app이 프레임 시간에 `timeScale`을 곱해 누산한다. sim의 `dt`는 항상 `DT`.

### 5.4 루프와 렌더 보간 (app)

```
acc += min(frameDt, MAX_FRAME_DT) × timeScale
steps = 0
while (acc >= DT && steps < MAX_STEPS_PER_FRAME) { sim.step(DT, input.consume(cameraRig.yaw)); acc -= DT; steps++ }
if (steps === MAX_STEPS_PER_FRAME) acc = 0          // 죽음의 나선 방지
alpha = acc / DT                                     // 0..1
layers.update(state, alpha, frameDt × timeScale)
```

- **보간**: `renderPos = prevPos + (pos − prevPos) × alpha`, `renderFacing = lerpAngle(prevFacing, facing, alpha)`, 보스 `y`도 같다. 투사체는 `prevX/prevZ`.
- **순간 이동 규칙**: 모드 전환 · 스폰 · 보스 순간이동처럼 위치가 튀는 순간에는 **쓰는 쪽이 `prevPos`도 같이 덮어쓴다**(보간 궤적이 화면을 가로지르지 않게).
- 에지 입력(`*Pressed`)은 `input.consume()`이 **한 틱에만** true로 주고 지운다. 한 프레임에 틱이 0번이면 에지를 다음 프레임까지 보존한다(§11.3).

---

## §6 모듈별 공개 API

다른 패키지가 호출하는 것만 적는다. 여기 없는 것은 내부 재량이다. view · ui · app의 API는 §9 · §10 · §11에 있다.

### 6.1 core (P0 — 웨이브 0에서 **완전 구현**)

**`core/constants.js`**

```js
export const DT = 1 / 60;
export const TAU = Math.PI * 2;
export const EPS = 1e-6;
export const MAX_STEPS_PER_FRAME = 5;
export const MAX_FRAME_DT = 0.1;
export const GAME_VERSION = '0.1.0';
export const SAVE_KEY = 'ashen-cycle/save';
export const SAVE_BACKUP_KEY = 'ashen-cycle/save.bak';   // 읽지 못한 세이브 원문을 옮겨 두는 곳
export const SETTINGS_KEY = 'ashen-cycle/settings';
export const SAVE_VERSION = 1;
export const BOSS_IDS = ['valder', 'fenrir', 'nihil'];          // 해금 순서
export const WEAPON_IDS = ['longsword', 'greatsword', 'spear'];
export const STAT_IDS = ['vit', 'end', 'str', 'dex'];
export const FACILITY_IDS = ['bonfire', 'blacksmith', 'merchant', 'gate'];
export const PANEL_IDS = ['title', 'pause', 'bonfire', 'blacksmith', 'merchant', 'gate', 'result'];
export const CUE_IDS = [ /* §4.2 큐 어휘 16종 */ ];            // validateBossDef 규칙 7 · fx · audio가 같은 목록을 본다
export const PROJECTILE_KINDS = ['void_orb'];                 // 부록 A
export const HAZARD_KINDS = ['shockwave', 'fire_trail', 'fire_pillar', 'ice_spike', 'void_burst', 'void_sword'];   // 부록 A
```

**`core/inputFrame.js`**

```js
export const NEUTRAL_INPUT;                 // Object.freeze 된 InputFrame(전부 0/false)
export function makeInput(partial = {});    // → 새 InputFrame (NEUTRAL + partial)
```

**`core/events.js`**

```js
export const EV = { /* §4의 키 → 문자열 전부 */ };
export class EventBus {
  on(name, fn)      // → off 함수
  once(name, fn)    // → off 함수
  off(name, fn)
  onAny(fn)         // fn(name, payload). → off 함수 (디버그 로그 · 테스트)
  emit(name, payload = {})   // 등록 순서대로 동기 호출. 예외는 전파. onAny 리스너가 이름 리스너보다 먼저 불린다.
                             //   emit은 시작 시점의 리스너 목록으로 돈다(도중에 on 한 것은 다음 emit부터, 도중에 off 한 것은 건너뛴다)
  clear()
}
```

**`core/math2d.js`** — 전부 순수 함수

```js
export function clamp(v, lo, hi)
export function clamp01(v)
export function lerp(a, b, t)
export function invLerp(a, b, v)            // clamp 없음
export function smoothstep(t)               // 0..1 → 0..1
export function approach(cur, target, maxDelta)
export function damp(cur, target, lambda, dt)   // 지수 감쇠: lerp(cur, target, 1 − exp(−lambda·dt))
export function len(x, z)
export function dist(ax, az, bx, bz)
export function distSq(ax, az, bx, bz)
export function normalize(x, z)             // → Vec2 (길이 0이면 {0,0})
export function angleOf(dx, dz)             // = Math.atan2(dx, dz)
export function dirX(a)                     // = Math.sin(a)
export function dirZ(a)                     // = Math.cos(a)
export function fromAngle(a, length = 1)    // → Vec2
export function wrapAngle(a)                // → (−π, π]
export function angleDiff(from, to)         // → wrapAngle(to − from)
export function turnToward(cur, target, maxStep)  // → 새 각(wrap 됨)
export function lerpAngle(a, b, t)          // 최단 호
export function localToWorld(x, z, facing, fwd, side)  // → Vec2 (§0.2 식)
export function distPointSegment(px, pz, ax, az, bx, bz)
export function isFiniteVec(v)
```

**`core/rng.js`**

```js
export function createRng(seed)   // → Rng (mulberry32). seed는 uint32로 강제
export function hashSeed(a, b)    // → uint32. 두 정수를 섞는다(보스전 시드 = hashSeed(profile.seed, attempts))
```

`Rng`의 범위(W0 확정): `next()` ∈ [0, 1) · `range(a, b)` ∈ [a, b) 실수 · **`int(a, b)` = a..b 정수(양끝 포함)** · `chance(p)` = `next() < p`(p ≤ 0이면 항상 false, p ≥ 1이면 항상 true — 어느 경우든 난수 하나를 소비한다) · `pick(arr)` = 원소 하나(빈 배열이면 `undefined`).

**`core/hitShapes.js`** — 셰이프 판정. sim · bot · fx(텔레그래프) · 테스트가 전부 이 함수를 쓴다.

```js
export function resolveShape(def, x, z, facing)        // ShapeDef → HitShape (월드 공간)
export function shapeHitsCircle(shape, cx, cz, cr)     // HitShape × 원 → boolean
export function ringFromGrow(x, z, grow, u)            // u 0..1 → {type:'ring', x, z, rInner, rOuter}
                                                       //   중심 반경 c = lerp(r0, r1, u), rInner = max(0, c − width/2), rOuter = c + width/2
```

판정식(구현이 이 식과 같아야 한다). `d` = 셰이프 원점(캡슐은 선분)에서 대상 원 중심까지 거리:

| 타입 | 명중 조건 |
|---|---|
| circle | `d ≤ r + cr` |
| ring | `d + cr ≥ rInner && d − cr ≤ rOuter` |
| arc | `d − cr ≤ r && d + cr ≥ rInner && (halfAngle ≥ π \|\| d ≤ cr \|\| abs(angleDiff(dir, angleOf(c − o))) ≤ halfAngle + asin(min(1, cr/d)))` |
| capsule | `distPointSegment(c, a, b) ≤ r + cr` |

`resolveShape`: circle → 중심 `localToWorld(x, z, facing, fwd ?? 0, side ?? 0)` · arc → `dir = wrapAngle(facing + (dirOffset ?? 0))`, `rInner ?? 0` · ring → 원점 그대로 · capsule → `a = localToWorld(…, fwd0, side ?? 0)`, `b = localToWorld(…, fwd1, side ?? 0)`.

**`core/collide.js`** — 월드 충돌 기하.

```js
export function resolveCircleVsWorld(pos, radius, world)   // pos를 제자리에서 고친다. 콜라이더(원 · 축 정렬 상자) 밖으로 민 뒤
                                                           //   경계 안으로: len(pos) ≤ world.radius − radius. → 고쳤으면 true
export function pushOutOfCircle(pos, radius, ox, oz, or)   // pos를 원 (ox, oz, or) 밖으로 민다(겹침이 없으면 그대로). → 밀었으면 true
                                                           //   중심이 정확히 겹치면 +Z 쪽으로 민다(NaN 금지)
export function circleOverlapsWorld(x, z, radius, world)   // → boolean. 콜라이더와 겹치거나 경계 밖이면 true (순간이동 목적지 · 스폰 검사)
export function sweepCircleVsWorld(x, z, dx, dz, dist, radius, world)   // → number(0..dist). (W5 확정) 원을 단위 방향 (dx, dz)로 곧게 옮길 때 콜라이더 · 경계에 처음 닿기까지의 거리.
                                                                        //   이미 맞닿은 원 콜라이더는 파고드는 방향일 때만 막는다(0). 상자는 radius만큼 부풀린 상자로 본다. 도약의 착지점 계산(§8.4)
export function segmentHitsCircle(ax, az, bx, bz, cx, cz, cr)  // → number | null. 선분 a→b가 원에 처음 닿는 매개변수 t(0..1). a가 이미 원 안이면 0. 안 닿으면 null (카메라 충돌 · 시선 검사)
```

`circleOverlapsWorld`는 맞닿은 것(`EPS` 이내)을 겹침으로 보지 않는다 — `resolveCircleVsWorld`가 고친 위치는 `false`다. 상자 안에 중심이 든 원은 가장 얕은 축으로 밀려난다.

### 6.2 data (순수 데이터 · 조회 함수)

| 파일 | export | 비고 |
|---|---|---|
| `data/player.js` (P1) | `PLAYER` | §7.1 |
| `data/weapons.js` (P1) | `WEAPONS: Record<WeaponId, WeaponDef>` · `getWeaponDef(id)` · `getMoveDef(weaponId, moveId)` | §7.3 |
| `data/combat.js` (P2) | `COMBAT` | §7.2 |
| `data/world.js` (P2) | `WORLDS: Record<string, WorldDef>` · `getWorld(id)` | §7.8 |
| `data/bossCommon.js` (P3) | `BOSS_AI` | §8.6 — 세 보스 공통 AI · 프레임워크 상수 |
| `data/stats.js` (P4) | `STATS` | §7.4. W0: P0이 §7.4의 값을 그대로 옮겨 둔다(로직은 스텁) |
| `data/economy.js` (P4) | `ECONOMY` | §7.5. W0: 〃 |
| `data/relics.js` (P4) | `RELICS: Record<string, RelicDef>` · `RELIC_IDS` | §7.5. W0: 〃(유물 7종 · 표의 순서) |
| `data/camera.js` (P6) | `CAMERA` | §9.4 |
| `data/bot.js` (P9) | `BOT` | §12.3 |
| `data/bosses/index.js` (P0) | `BOSS_DEFS: Record<BossId, BossDef>` · `getBossDef(id)` | 세 파일을 모아 다시 내보낸다 |
| `data/bosses/valder.js` (P3) | `VALDER: BossDef` | §8.10. 스텁 값: §8.8의 자리 표시 정의 |
| `data/bosses/fenrir.js` (P10) | `FENRIR: BossDef` (+ 훅 수치용 `FENRIR_EXT` — 선택) | §8.11. 스텁 값: 〃 |
| `data/bosses/nihil.js` (P11) | `NIHIL: BossDef` (+ 훅 수치용 `NIHIL_EXT`) | §8.12. 스텁 값: 〃 |
| `data/keybinds.js` (P0) | `KEYBINDS` · `GAMEPAD` | §11.3 |
| `data/settings.js` (P0) | `DEFAULT_SETTINGS: Settings`(동결 — 쓰는 쪽이 복사한다) · `QUALITY` · `SETTINGS_RANGE`(`{mouseSensitivity, volumeMaster, volumeSfx, volumeMusic, cameraShake}` → `[min, max]` — `sanitizeSettings`와 일시정지 패널이 읽는다) | §9.9 · §3.9 |
| `data/palette.js` (P0) | `PALETTE` | §9.10 |
| `data/strings.ko.js` (P8) | `STR: Record<string, string>` | §10.6 |

### 6.3 sim/player (P1)

**`sim/player/playerSim.js`**

```js
/** 새 플레이어 상태. hp/stamina/flasks는 가득, state 'idle', prevPos = pos. */
export function createPlayerState(stats, spawn /* {x, z, facing} */)   // → PlayerState

/** 능력치를 갈아 끼운다(마을에서 구매 직후). refill이면 hp · stamina · flasks를 최대로. */
export function applyStatsToPlayer(player, stats, refill)

/** 한 틱 진행. ctx.state.player만 쓴다(읽기는 state 전체). pos를 속도로 적분한다 — 충돌은 P2가 뒤에서 푼다. */
export function updatePlayer(ctx, input, dt)

/** 히트스톱 틱용: 에지 입력(light · heavy · roll · flask)을 버퍼에 넣고, lockOnPressed는 **즉시** 처리한다
 *  (§7.1 록온 토글 규칙 그대로 · LOCKON_CHANGED). 그 밖의 타이머 · 상태 · guardHeldPrev는 건드리지 않는다. */
export function bufferPlayerInput(ctx, input, dt)

/** 이번 틱에 살아 있는 플레이어 판정. attack.phase === 'active'인 동안 같은 hitId로 매 틱 반환.
 *  처형은 타격 시각의 한 틱에만 execute:true로 반환. 없으면 null. */
export function getPlayerHit(ctx)   // → OutgoingHit | null

/** 플레이어의 타격이 명중한 뒤 P2가 부른다(흡혈 등). 수치(보스 HP · 체간)는 이미 P2가 적용했다. */
export function onPlayerDealtHit(ctx, result /* DamageResult */)

/** 플레이어가 맞은 뒤 P2가 부른다. hp · stamina는 이미 깎였다. 여기서 상태 전이만 한다(§7.1 반응 표). */
export function onPlayerDamaged(ctx, result /* DamageResult */)
```

- `getPlayerHit`의 `damage` = `stats.weaponDamage × move.dmgMul × lerp(1, move.chargeDmgMul, charge) × stats.damageMul × (postRollT > 0 ? stats.postRollDmgMul : 1) × (hp/hpMax ≤ stats.lowHpThreshold ? stats.lowHpDmgMul : 1)`. `posture` = `move.posture × lerp(1, PLAYER.chargePostureMul, charge) × stats.postureMul`. 치명 배율은 **P2가** 곱한다.
- P1이 유지하는 플래그(매 틱 갱신 — P2 · ui · 봇이 읽는다): `iframe` · `guarding` · `parryActive` · `canExecute`.
- `onPlayerDamaged`는 outcome `hit` · `parry`에서 그 자리에서 `player.iframe = true`도 세운다(틱 끝 상태가 일관되게 — 다음 틱의 E가 다시 계산한다).
- `updatePlayer`는 매 틱 `hp <= 0 && state !== 'dead'`면 `dead`로 전이한다(`onPlayerDamaged`의 lethal 처리와 같은 일 — 중복 무해. 디버그/테스트가 HP를 직접 써도 상태가 따라온다).

### 6.4 sim 루트 · combat · world (P2)

**`sim/GameSim.js`**

```js
export class GameSim {
  /** @param {{profile:Profile, bus:EventBus, seed?:number}} opts
   *  생성 직후 상태는 마을이다(플레이어 · 허수아비가 있는 유효한 GameState). **생성자는 이벤트를 내지 않는다.**
   *  PROFILE_CHANGED를 구독한다 — mode === 'town'이면 refreshStats(true)(레벨업 · 구매 직후 바가 가득 찬 채 늘어난다).
   *  난수: 보스전마다 createRng(hashSeed(seed ?? profile.seed, 그 보스의 attempts)). 마을은 createRng(seed ?? profile.seed).
   *  (W1 확정: attempts는 noteAttempt **뒤의** 값이다 — 첫 도전 = 1.) */
  constructor(opts)

  /** @type {GameState} 바깥은 읽기만 한다 */
  state

  /** 마을로. computeStatBlock(profile)을 다시 계산해 플레이어를 playerSpawn에 새로 만든다(HP · 스태미나 · 플라스크 가득).
   *  보스 · 투사체 · 장판 · fight · hitLog 제거. MODE_CHANGED를 내고 플러시. */
  enterTown()

  /** 보스전 시작. noteAttempt → 능력치 재계산 → 플레이어/보스 생성 → fight = {phase:'intro'} · hitLog 비움.
   *  PLAYER.lockOn.autoOnFight면 player.lockOn = true.
   *  MODE_CHANGED · FIGHT_STARTED · FIGHT_PHASE(· LOCKON_CHANGED{on:true})를 내고 플러시. 해금 여부는 검사하지 않는다(호출자 책임).
   *  @param {BossId} bossId
   *  @param {{def?:BossDef, hooks?:BossHooks}} [override] 테스트용 주입 */
  startBossFight(bossId, override)

  /** 보스전을 포기하고 **지금까지 준 피해만큼 사망 보상을 받는다**(일시정지 → 마을로). fight.phase === 'fight'일 때만 동작:
   *  투사체 · 장판 정리 → computeReward(victory:false) → applyReward → fight.outcome = 'death' · fight.reward
   *  → REWARD_GRANTED · PROFILE_CHANGED{reward} · FIGHT_PHASE{done} → phase = 'done'. (outro · PLAYER_DIED · FIGHT_ENDED 없음)
   *  그 밖의 phase(intro · outro · done)나 마을에서는 아무것도 하지 않는다.
   *  @returns {RewardResult|null} */
  forfeitFight()

  /** 마을에서만: HP · 스태미나 · 플라스크 가득. PLAYER_RESTED. */
  restAtBonfire()

  /** computeStatBlock(profile)을 다시 불러 플레이어에 적용(applyStatsToPlayer). */
  refreshStats(refill)

  /** §5.1 */
  step(dt, input)

  /** 디버그 */
  setDebug(partial /* {godMode?, noStamina?} */)
  debugDamageBoss(amount)        // 판정 파이프라인을 거쳐 보스에 피해(HIT 이벤트 포함). 무적 무시
                                 //   (W1 확정: 셰이프 · 치명 · 히트스톱 · 흡혈은 건너뛰고 HIT · onBossDamaged · fight.damageDealt만 반영. 승패는 다음 step의 J가 판정)
  debugSetBossHpFraction(f)      // hp만 바꾼다(다음 틱에 updateBoss의 폴링이 페이즈 전환/사망을 처리한다 — §8.7)

  dispose()                      // 구독 해제
}
```

**`sim/combat/hitRegistry.js`** — 모듈 전역 상태를 두지 않는다(정본은 `state.hitLog`).

```js
export function hasHit(state, hitId, target)    // → boolean
export function markHit(state, hitId, target)   // push. 길이가 COMBAT.hitLogMax를 넘으면 앞에서 버린다
```

**`sim/combat/damage.js`** — 호출자는 `GameSim`뿐이지만 규칙은 모든 패키지가 알아야 한다.

```js
export function resolveHitOnBoss(ctx, hit)     // → DamageResult | null(레지스트리에 이미 있음/빗나감)
export function resolveHitOnDummy(ctx, hit)    // → DamageResult | null
export function resolveHitOnPlayer(ctx, hit)   // → DamageResult | null
```

공통: 셰이프를 `core/hitShapes.js`의 `resolveShape`로 풀어 대상 원과 `shapeHitsCircle` → 맞으면 히트 레지스트리(`hitId` × 대상)에 등록(같은 조합은 다시 안 맞는다) → 아래 규칙 → `HIT` 이벤트.
`hit.execute === true`는 셰이프 검사를 건너뛴다(자동 명중).

*플레이어 → 보스*

0. 대상 원 = `ctx.bossDef.bodyParts ?? [{fwd: 0, r: boss.radius}]`의 각 원(중심 `localToWorld(boss.pos, boss.facing, fwd, 0)`). **어느 한 원에라도 닿으면 명중**이다. `result.x/z`는 닿은 원(여럿이면 플레이어에 가장 가까운 원)의 공격자 쪽 표면. 처형은 중심 원 기준.
1. `boss.invulnerable` → outcome `'immune'`, 피해 0, 체간 0, `HIT`는 낸다(튕기는 스파크).
   - (W1 확정) **`boss.hp <= 0`이면 `null`** — 레지스트리 등록도 `HIT`도 없다(승리 outro 동안 쓰러진 보스를 베어도 스파크가 튀지 않는다). `immune`에서는 `HIT`만 내고 규칙 6 · 7(히트스톱 · 흔들림 · `onBossDamaged` · `onPlayerDealtHit`)을 건너뛴다. `boss.invulnerable`이면 패링 체간도 쌓지 않는다.
2. `crit = !hit.execute && (boss.state === 'parried' || boss.state === 'groggy')`. `dmg = round(hit.damage × (crit ? stats.critMul : 1))`. 처형은 `round(hit.damage)`.
3. `boss.hp = max(0, boss.hp − dmg)`; `result.damage` = 실제로 깎인 양; `fight.damageDealt += result.damage`.
4. 체간: `boss.state`가 `groggy · executed · recover · phaseShift`가 아니고 처형이 아니면 `boss.posture = min(postureMax, posture + hit.posture)`, `postureIdle = 0`. 가득 차면 `postureBroken = true`.
   - (W5 확정) **한 번에 쌓이는 체간은 `postureMax × COMBAT.postureHitCap`(0.6)까지다**(패링 체간도 같다) — 빈 체간을 한 방에 채우지 못한다. **`boss.postureGuard`가 true면 쌓이지 않는다**(체간 0 · `postureIdle`도 그대로 · 피해는 들어간다 — §8.7). 대검 + 기량에서 완충 강공격 한 방이 체간 전부(26 × 2 × `postureMul` ≥ 90~120)를 채워, 일어나는 틱에 맞춰 둔 한 방으로 「그로기 → 처형 → 다시 그로기」가 끝없이 이어졌다(보스가 한 번도 공격하지 못한다).
5. `lethal = boss.hp === 0`.
6. 히트스톱 `hit.hitstop`(처형이면 `COMBAT.executeHitstop`), 흔들림 `COMBAT.shake.playerLight | playerHeavy | execute`.
7. `onBossDamaged(ctx, result)` [P3] → `onPlayerDealtHit(ctx, result)` [P1].

*보스 · 투사체 · 장판 → 플레이어*

0. 판정하지 않는 경우(`null`, 레지스트리 등록 없음): `player.hp <= 0` · `state.mode === 'town'` · `fight.phase !== 'fight'` · `boss.hp <= 0` · **이번 틱에 플레이어가 이미 outcome `hit` · `guard` · `parry`를 받았다**(§5.1 I — 틱당 최대 1회).
1. `player.iframe` 또는 `state.debug.godMode` → outcome `'dodge'`, 피해 0. 레지스트리에 등록한다(**흘린 공격은 다시 맞지 않는다**). `player.state`가 `roll`/`backstep`이면 `PLAYER_DODGED`. `HIT`는 내지 않는다. `onPlayerDamaged`도 부르지 않는다.
2. `frontal = abs(angleDiff(player.facing, angleOf(hit.x − player.x, hit.z − player.z))) ≤ PLAYER.guard.arcHalf`. (투사체는 투사체 위치, 장판은 장판 원점 기준. 장판 원점이 플레이어와 겹치면 frontal = true — W1 확정: 출처와 무관하게 판정 원점이 플레이어 원 안이면 frontal = true)
   - (W5 확정) **발밑에서 솟는 장판은 방향을 보지 않는다**: `source === 'hazard'`이고 셰이프가 원 · 캡슐이며(띠 `ring` · 부채꼴 `arc`처럼 원점에서 뻗는 것은 제외) **플레이어 중심이 그 셰이프 안**이면 frontal = true. 장판의 원점(원의 중심 · 불길 줄의 시작점)이 등 뒤에 있는지는 화면에서 읽을 수 없어, 가드를 든 채 발밑의 장판을 25~48% 그대로 맞았다. 밖에서 몸에 걸친 장판(중심이 셰이프 밖)과 충격파 띠는 종전대로 원점 방향을 본다.
3. `player.parryActive && hit.parryable && frontal` → outcome `'parry'`: 피해 0 · 스태미나 0. 히트스톱 `COMBAT.parryHitstop`. `fight.parries += 1`. 체간은 출처별로:
   - `source === 'boss'`: `boss.posture += stats.parryPosture`(「플레이어 → 보스」 규칙 4와 같은 조건 · 상한) 후 `onBossParried(ctx, result)` [P3].
   - `source === 'projectile'`: `boss.posture += stats.parryPosture × COMBAT.projectileParryPostureMul`(같은 조건 · 상한, `postureIdle = 0`). `onBossParried`는 **부르지 않는다**(보스의 현재 공격은 끊기지 않는다) — 가득 찼으면 다음 틱에 `updateBoss`의 폴링이 그로기로 보낸다(§8.7).
4. 아니고 `player.guarding && hit.guardable && frontal` → outcome `'guard'`: `dmg = round(hit.damage × (1 − stats.guardReduction))`, `staminaDamage = (hit.damage / ctx.scaling.dmgMul) × stats.guardStaminaFactor`(순환 피해 배율은 가드 스태미나에 싣지 않는다 — 페이즈 배율은 남는다), `player.stamina −= staminaDamage`; 0 이하면 `stamina = 0`, `guardBreak = true`. `exhausted` · `staminaDelay`는 P2가 건드리지 않는다(`onPlayerDamaged`의 일 — §7.1 반응 표).
5. 아니면 outcome `'hit'`: `dmg = round(hit.damage)`.
6. `player.hp = max(0, hp − dmg)`; `lethal`; `fight.damageTaken += dmg`. 히트스톱 `COMBAT.bossHitHitstop`(knockdown이면 `bossKnockdownHitstop`, guard면 `guardHitstop`), 흔들림 `COMBAT.shake.*`.
7. `onPlayerDamaged(ctx, result)` [P1]. 투사체가 맞았으면(dodge를 뺀 어떤 outcome이든) 투사체 소멸 — `PROJECTILE_ENDED`의 `reason`은 outcome 그대로(`'hit'` · `'guard'` · `'parry'`).

*플레이어 → 허수아비*: 피해 = `round(hit.damage)`, `dummy.lastDamage/total` 갱신, `HIT`(target `'dummy'`), 히트스톱 · 흔들림은 보스와 같다. `onPlayerDealtHit`은 부르지 않는다.

**충돌 해소(§5.1 G)** — `core/collide.js`를 쓴다. 보스 몸통은 `bodyParts`의 모든 원에 대해 `pushOutOfCircle(player.pos, player.radius, 원)`을 차례로 부른다.
(W3 확정) **돌진 중의 옆 밀기**: 보스의 현재 공격이 `move.kind === 'charge'`이고 `tA ∈ [t0, t1]`이면 `pushOutOfCircle` 대신 옆 밀기를 쓴다 — 겹친 원마다 플레이어를 돌진 방향(`boss.facing`)에 **수직인 축으로만** 원 밖을 향해 옮긴다(서 있던 쪽으로. 정확히 중심선 위면 아레나 중심에 가까운 쪽). 한 틱의 이동은 `COMBAT.chargeShoveSpeed × DT`까지이고 남은 겹침은 허용한다(보스가 지나가며 쓸어 낸다). 돌진 방향으로는 밀지 않는다. W1에는 일직선의 가드/무적 플레이어가 3~9m 밀려갔다(`NOTES-W1` · `NOTES-P10` #5).

**`sim/projectiles.js` · `sim/hazards.js`** — `GameSim`이 `ctx.spawnProjectile` · `ctx.spawnHazard`로 감싸 제공한다. 다른 패키지는 ctx만 쓴다.

- `ctx.spawnProjectile(spec, x, z, dir, damageMul)`: `damage = spec.damage × damageMul`. `PROJECTILE_SPAWNED`. 매 틱 `homingTime` 동안 플레이어 쪽으로 `homing` rad/s 회전 후 전진. 플레이어 원에 닿거나(판정 → 소멸), 콜라이더 · 경계에 닿거나(`'wall'`), 수명이 다하면(`'expire'`) `PROJECTILE_ENDED`.
- `ctx.spawnHazard(spec, x, z, facing, damageMul)`: `HAZARD_SPAWNED`. `warn` 동안 `state:'warn'`(텔레그래프만) → `'active'`(`HAZARD_ACTIVATED`) → `active` 뒤 제거(`HAZARD_ENDED{reason:'expire'}`). `warn === 0`이면 바로 active. `interval > 0`이면 반복 타격마다 새 `hitId`.
- 승리 · 사망 · 포기 · 모드 전환 때 전부 제거한다 — `PROJECTILE_ENDED{reason:'clear'}` · `HAZARD_ENDED{reason:'clear'}`(연출 없이 사라진다).

**`data/world.js` 검사**(gamesim.test) — 모든 `WORLDS`에서 `playerSpawn` · `bossSpawn` · `dummy`가 콜라이더와 겹치지 않고(여유 1m: `circleOverlapsWorld(x, z, 0.4 + 1, world) === false`), `playerSpawn → bossSpawn` 선분이 어떤 콜라이더 원과도 만나지 않는다(`segmentHitsCircle`).

### 6.5 sim/boss (P3 — 프레임워크. P10 · P11은 데이터와 훅만 쓴다)

**`sim/boss/bossSim.js`**

```js
/** 새 보스 상태. state 'intro', hp = round(def.hp × scaling.hpMul), posture 0, phase 1, prevPos = pos.
 *  끝에서 hooks.onCreate를 부르지 않는다(ctx가 없다) — 첫 updateBoss에서 한 번 부른다. */
export function createBossState(def, scaling /* CycleScaling */, spawn)   // → BossState

/** 한 틱 진행. ctx.bossDef · ctx.bossHooks를 쓴다. ctx.state.boss만 쓴다(+ ctx.spawn* · emit). */
export function updateBoss(ctx, dt)

/** 이번 틱에 살아 있는 보스 판정들(공격의 active 구간 · 각 hit의 t0..t1). damage에 boss.dmgMul이 곱해져 있다. */
export function getBossHits(ctx)          // → OutgoingHit[]

/** 예고 중인 표식(telegraph:true인 hit). 공격 시작부터 그 hit의 t0까지. */
export function getBossTelegraphs(ctx)    // → TelegraphSrc[]

/** 보스가 맞은 뒤 P2가 부른다. hp · posture는 이미 적용됐다. 사망 · 그로기 · 처형 반응 · 페이즈 예약을 처리. */
export function onBossDamaged(ctx, result)

/** 보스의 공격이 패링당한 뒤 P2가 부른다. posture는 이미 적용됐다. 공격 중단 → 'parried'(체간이 가득이면 'groggy'). */
export function onBossParried(ctx, result)
```

**`sim/boss/validateBossDef.js`**

```js
/** 정의 검사 — 오류 문자열 배열(빈 배열이면 통과). §8.9의 규칙. */
export function validateBossDef(def)      // → string[]
```

**`sim/boss/hooks/index.js`** (P0)

```js
export function getBossHooks(bossId)      // → BossHooks (없으면 {})
```

`hooks/valder.js` → `export const valderHooks`, `hooks/fenrir.js` → `fenrirHooks`, `hooks/nihil.js` → `nihilHooks` (전부 `BossHooks`. 스텁 값 `{}`).

P3는 보스 정의 · 훅 · 순환 배율을 레지스트리에서 찾지 않고 `ctx.bossDef` · `ctx.bossHooks` · `ctx.scaling`(§3.8)에서 읽는다 — GameSim이 보스전 시작 때 채우고, 테스트는 합성 정의를 넣는다.

### 6.6 sim/progression (P4)

**`sim/progression/profile.js`**

```js
export function createNewProfile(seed = 1)     // → Profile (§7.5 「새 프로필」)
```

**`sim/progression/stats.js`**

```js
export function computeStatBlock(profile)      // → StatBlock (유물 반영)
export function totalPoints(profile)           // → 투자 점수 합
export function levelUpCost(points)            // → 잔불. points = 지금까지 투자한 점수 합
export function affordableLevelUps(profile)    // → 보유 잔불로 연속해서 살 수 있는 레벨업 횟수(어느 능력치든 — 비용은 점수 합에만 달렸다)
export function previewLevelUp(profile, statId)
  // → {cost:number, canAfford:boolean, maxed:boolean, before:StatBlock, after:StatBlock,
  //    changes:{key:string, before:number, after:number}[],   바뀌는 StatBlock 필드만, 표시 순서대로(hpMax · staminaMax · staminaRegen ·
  //                                                            damageMul · postureMul · critMul · executeMul · parryPosture)
  //    diminished:boolean,                                     이번 한 점의 증가분이 직전 한 점보다 작은가(구간 경계 15 · 30점을 넘는 순간)
  //    nextCost:number|null,                                   이번에 올린 뒤의 다음 비용(전 능력치가 상한이면 null)
  //    affordableCount:number}                                 = affordableLevelUps(profile)
```

**`sim/progression/economy.js`**

```js
export function getCycleScaling(cycle)         // → CycleScaling
export function weaponUpgradeCost(level, catchUp = false)   // → {embers, shards} | null(최대). catchUp이면 잔불 × ECONOMY.weapon.catchUpEmberMul · 파편 0
export function repeatMulFor(killsThisCycle)   // → 1 | 0.5 | 0.25
/** 순수 계산 — profile을 고치지 않는다. */
export function computeReward(profile, bossId, outcome /* {victory:boolean, damageFraction:number, duration:number} */)  // → RewardResult
/** 지급: embers · shards · bosses[...] · totals · 해금 · 순환을 profile에 반영(§7.5). */
export function applyReward(profile, reward)
/** 도전 횟수 +1. */
export function noteAttempt(profile, bossId)
```

**`sim/progression/Progression.js`** — UI가 부르는 명령 창구

```js
export class Progression {
  constructor(profile, bus)
  profile                                    // 살아 있는 Profile(GameSim과 같은 객체)
  getStatBlock()                             // → StatBlock
  previewLevelUp(statId)                     // → previewLevelUp(profile, statId)
  getAffordableLevelUps()                    // → affordableLevelUps(profile)  (결과 패널 · 화톳불 머리줄)
  levelUp(statId)                            // → CmdResult. 성공: LEVEL_UP · PROFILE_CHANGED
  getWeaponInfo(weaponId)
    // → {id, level, maxed, equipped, catchUp:boolean, cost:{embers, shards}|null, canAfford, damageNow, damageNext}
    //   catchUp = level < max(다른 두 무기의 level) — 그 단계는 이미 다른 무기로 넘어 봤으므로 파편 없이 반값
  upgradeWeapon(weaponId)                    // → CmdResult. WEAPON_UPGRADED · PROFILE_CHANGED. 비용은 getWeaponInfo().cost 그대로
  equipWeapon(weaponId)                      // → CmdResult. WEAPON_EQUIPPED · PROFILE_CHANGED
  getShopItems()
    // → [{id, kind:'flask_charge'|'flask_heal'|'relic', level, maxLevel, price, canAfford, owned, soldOut,
    //     valueNow:number|null, valueNext:number|null,   flask_charge: 충전 수 · flask_heal: 1회 회복량 · relic: null
    //     equippedSlot: 0|1|null}]                        relic만. 그 밖은 null
  buy(itemId)                                // → CmdResult. ITEM_PURCHASED · PROFILE_CHANGED.
                                             //   유물은 빈 칸이 있으면 가장 앞 빈 칸에 **자동 장착**한다(RELIC_EQUIPPED도 낸다). 두 칸이 다 차 있으면 보유만
  equipRelic(slot, relicId /* string|null */) // → CmdResult. RELIC_EQUIPPED · PROFILE_CHANGED
  getBossList()
    // → [{id, unlocked, attempts, killsThisCycle, totalKills, bestFraction, victoryEmbers, victoryShards, repeatMul, shardsLeft}]  BOSS_IDS 순서
    //   victoryEmbers · victoryShards = 지금 격파하면 받는 양(감쇠 · 남은 구간 포함). shardsLeft = 이번 순환에 이 보스에게서 더 받을 수 있는 파편 합
  grant(embers = 0, shards = 0)              // 디버그. PROFILE_CHANGED {reason:'debug'}
}
```

실패한 명령은 `{ok:false, reason}`을 반환하고 `PURCHASE_FAILED`를 낸다. profile은 바뀌지 않는다.

**W1 확정(P4가 정한 세부 — UI · app · 봇은 이것을 전제로 한다)**
- 성공한 명령의 이벤트 순서: 세부 이벤트 → `PROFILE_CHANGED` 한 번(profile은 이벤트 전에 전부 바뀌어 있다). 유물 구매는 `ITEM_PURCHASED` → (자동 장착 시) `RELIC_EQUIPPED` → `PROFILE_CHANGED{buy}`.
- **바뀌는 것이 없는 명령**(`equipWeapon(이미 든 무기)` · `equipRelic(칸, 이미 그 칸의 값)`)은 `{ok: true}`를 돌려주고 **이벤트를 내지 않는다**.
- `equipRelic(slot, 다른 칸에 끼운 유물)`은 실패가 아니라 **두 칸을 맞바꾼다**(`RELIC_EQUIPPED` 두 번 → `PROFILE_CHANGED` 한 번) — 같은 유물이 두 칸에 드는 상태는 생기지 않는다. 미보유는 `'locked'`, 모르는 id · 칸 번호는 `'invalid'`.
- `upgradeWeapon`은 잔불 부족(`'embers'`)을 파편 부족(`'shards'`)보다 먼저 본다.
- `previewLevelUp`: 그 능력치가 상한이면 `canAfford false` · `after = before` · `changes []` · `nextCost`는 지금 비용(전 능력치가 상한일 때만 null). 모르는 `statId`는 던지지 않는다.
- `getShopItems`: 순서는 `flask_charge` · `flask_heal` · 유물 7종(`RELIC_IDS` 순서). 품절 플라스크는 `price 0` · `valueNext = valueNow` — UI는 `soldOut`으로 분기한다. 유물은 `level` 보유 1 / 미보유 0 · `maxLevel 1` · `soldOut = owned`. 플라스크의 `owned`는 항상 false.
- `getWeaponInfo`의 `damageNow/damageNext` = 무기 피해(`baseDamage × 강화 배율` = `StatBlock.weaponDamage` — 근력 배율은 넣지 않는다). 최대 단계면 `damageNext = damageNow`.
- `computeReward`의 `damageFraction`은 받은 값을 0..1로 자른 그대로다(승리여도 1로 덮지 않는다 — 승리를 f = 1로 보는 것은 구간 파편과 `bestFraction`뿐). `BOSS_IDS`에 없는 `bossId`는 던지지 않고 잔불 0 · 파편 0. 포기(`forfeitFight`)는 `totals.deaths`에 센다.
- `STATS.precision`(= 1e6): `StatBlock` · 순환 배율 · 무기 피해를 1/precision 단위로 정리한다(부동소수 잡음 `1.1800000000000002`가 UI에 찍히지 않게). 계약의 `STATS` 구조에 필드 하나가 늘었다.
- 추가 export(내부용): `stats.js`의 `weaponDamageAt(weaponId, level)` · `economy.js`의 `shardsLeftFor(bossProgress)`. v0 세이브(§12.2)의 모양은 `save.js`의 `migrateV0`가 정본이다(`version`이 없으면 v0).

**`sim/progression/save.js`**

```js
export function createSaveData(profile, savedAt)             // → SaveData (깊은 복사)
export function serializeSave(save)                          // → string (JSON)
export function parseSave(text)                              // → Object | null (JSON이 깨졌거나 객체가 아니면 null)
export function migrateSave(raw)                             // → SaveData | null. raw.version → SAVE_VERSION까지 순차 변환. 미래 버전 · 모르는 형태면 null
export function sanitizeProfile(profile)                     // → Profile. createNewProfile() 위에 병합(빠진 필드는 기본값)하고 범위로 자른다:
                                                             //   stats 0..STATS.maxPoints 정수 · weapon level 0..10 · flaskChargeLv 0..3 · flaskHealLv 0..5 ·
                                                             //   embers/shards/cycle ≥ 0 정수(NaN → 0) · 모르는 유물 id 제거 · relicsEquipped는 보유한 것만(중복 금지) ·
                                                             //   equippedWeapon이 무효면 'longsword' · bosses.valder.unlocked는 항상 true
export function sanitizeSettings(settings)                   // → Settings. DEFAULT_SETTINGS 위에 병합 + 범위 clamp(모르는 quality → 기본값)
export function validateProfile(profile)                     // → string[] (오류 목록. 빈 배열이면 통과)
/** 전체 사슬: parseSave → migrateSave → sanitizeProfile → validateProfile. 어느 단계든 실패하면 null. */
export function loadProfileFromText(text)                    // → SaveData | null
```

localStorage 읽기/쓰기는 `app/storage.js`(P9)가 한다. sim은 저장소를 모른다.

### 6.7 bot (P9)

```js
/** @param {{seed?:number, dodgeChance?:number, reaction?:number, aggression?:number}} opts */
export function createBot(opts)   // → {decide(state: GameState): InputFrame, reset(): void}
```

행동 규칙은 §12.3.

### 6.8 test/helpers.js (P0 — 웨이브 1의 단위 테스트가 서로를 기다리지 않게)

```js
export function makeTestStats(overrides = {})        // → StatBlock (§7.4 기본 블록 리터럴 — P4에 의존하지 않는다)
export function makeTestProfile(opts = {})           // → Profile 리터럴(§7.5 새 프로필). opts: {points?: {vit,end,str,dex}, weaponLevel?, embers?, shards?, cycle?, seed?}
                                                     //   weaponLevel = 장착 무기(장검)의 강화 단계. seed 기본값 1
export function makeTestPlayer(stats, overrides = {}) // → PlayerState 리터럴 — §3.4 **전 필드**(state 'idle', hp/stamina/flasks 가득, pos {0,0}).
                                                     //   createPlayerState를 부르지 않는다(P1에 의존하지 않는다)
export function makeTestBoss(def, overrides = {})    // → BossState 리터럴 — §3.5 **전 필드**(state 'idle', hp = hpMax = def.hp, phase 1, invulnerable false,
                                                     //   dmgMul 1, speedMul 1, pos {0, 6}, facing π). createBossState를 부르지 않는다(P3에 의존하지 않는다)
export function makeTestState(opts = {})             // → GameState. opts: {mode?, bossDef?, stats?, world?, profile?, seed?}
                                                     //   플레이어는 항상 원점에 있다. bossDef는 상태에 들어가지 않는다 — makeTestCtx(state, {bossDef})로 다시 넘긴다(기본 null)
                                                     //   makeTestPlayer · makeTestBoss의 overrides는 얕게 덮어쓴다(pos만 주면 prevPos도 같은 값이 된다)
                                                     //   player = makeTestPlayer(…), boss = bossDef ? makeTestBoss(bossDef) : null,
                                                     //   bossDef가 있으면 mode 'boss' · fight = {phase:'fight', …0} · world = 그 아레나, 없으면 town
export function makeTestCtx(state, opts = {})        // → SimCtx + {events: [], spawned: {projectiles: [], hazards: []}}
                                                     //   opts: {seed?, bossDef?, bossHooks?, scaling?}. emit은 ctx.events에도 쌓는다.
                                                     //   spawn*은 기록만 하고 최소 객체를 돌려준다. requestHitstop · shake는 state/이벤트에 반영
export function makeSynthBossDef(overrides = {})     // → BossDef. validateBossDef를 통과하는 합성 정의(공격 2개: 근접 arc · 원거리 capsule)
export function runTicks(n, fn)                      // fn(i)를 n번
export function countEvents(events, name)            // → number
export function assertFiniteDeep(obj, path = 'state')// 숫자 필드에 NaN/Infinity가 있으면 assert 실패(경로 표시)
```

테스트가 자기 패키지의 생성 함수(`createPlayerState` · `createBossState`)로 만든 상태를 끼워 넣고 싶으면 `state.player = createPlayerState(…)`처럼 덮어쓴다.

### 6.9 스텁 값 (P0이 웨이브 0에 쓰는 스텁의 동작)

스텁은 **던지지 않고, 유효한 모양의 값을 돌려준다.** 웨이브 1의 테스트와 최소 부트(§11.6)가 스텁 위에서 돈다. 아래에 없는 export는 no-op / `undefined` / `[]` / `null`.

| 모듈 | 스텁 동작 |
|---|---|
| `sim/player/playerSim.js` | `createPlayerState` = §3.4 전 필드를 채운 유효 상태 · `applyStatsToPlayer` = `stats` 교체(+ refill이면 hp · stamina · flasks 최대) · `updatePlayer` · `bufferPlayerInput` · `onPlayerDealtHit` = no-op · `getPlayerHit` = `null` · `onPlayerDamaged` = `result.lethal`이면 `state = 'dead'` |
| `sim/boss/bossSim.js` | `createBossState` = §3.5 전 필드를 채운 유효 상태(`state 'intro'`, `hp = hpMax = round(def.hp × scaling.hpMul)`, `invulnerable true`) · `updateBoss` = `stateTime += dt`, `intro`가 `introDur`에 닿으면 `state 'idle'` · `invulnerable false` · `getBossHits` · `getBossTelegraphs` = `[]` · `onBossDamaged` = `result.lethal`이면 `state = 'dead'` · `onBossParried` = no-op |
| `sim/boss/validateBossDef.js` | `[]` |
| `sim/boss/hooks/*.js` | `{}` |
| `sim/progression/profile.js` | `createNewProfile` = §7.5 「새 프로필」 그대로(완성) |
| `sim/progression/stats.js` | `computeStatBlock` = §7.4 기본 StatBlock(프로필 무시) · `totalPoints` = 0 · `levelUpCost` = 0 · `affordableLevelUps` = 0 · `previewLevelUp` = `{cost: 0, canAfford: false, maxed: false, before: 기본, after: 기본, changes: [], diminished: false, nextCost: null, affordableCount: 0}` |
| `sim/progression/economy.js` | `getCycleScaling` = `{hpMul: 1, dmgMul: 1, rewardMul: 1, speedMul: 1, thinkMul: 1, chainBonus: 0}` · `weaponUpgradeCost` = `null` · `repeatMulFor` = 1 · `computeReward` = `{bossId, cycle: profile.cycle, victory, damageFraction, duration, embers: 0, shards: 0, milestones: [], firstKill: false, repeatMul: 1, unlocked: null, cycleAdvanced: false, embersAfter: profile.embers}` · `applyReward` · `noteAttempt` = no-op |
| `sim/progression/Progression.js` | 생성자는 `profile` · `bus`를 보관. `getStatBlock` = 기본 StatBlock · `getWeaponInfo` = `{id, level: 0, maxed: false, equipped: id === 'longsword', catchUp: false, cost: null, canAfford: false, damageNow: 0, damageNext: 0}` · `getShopItems` · `getBossList` = `[]` · `getAffordableLevelUps` = 0 · 명령은 전부 `{ok: false, reason: 'invalid'}`(이벤트 없음) |
| `sim/progression/save.js` | `createSaveData` = `{version: SAVE_VERSION, savedAt, profile: structuredClone(profile)}` · `serializeSave` = `JSON.stringify` · `parseSave` · `migrateSave` · `loadProfileFromText` = `null` · `sanitizeProfile` · `sanitizeSettings` = 인자 그대로 · `validateProfile` = `[]` |
| `sim/GameSim.js` | 생성자가 마을 `GameState`를 만든다(`makeTestState()`와 같은 모양 — 플레이어는 `createPlayerState`). `enterTown` · `startBossFight`는 `mode` · `world` · `boss`(= `createBossState`) · `fight`를 바꾸고 `MODE_CHANGED`를 낸다(`startBossFight`는 이어서 `FIGHT_STARTED` · `FIGHT_PHASE{intro}`도). `step`은 `tick += 1` · prev 복사만(`updatePlayer` · `updateBoss`를 부르지 않는다 — 스텁 위에서는 보스가 `intro`에 머문다). `setDebug`는 `state.debug`에 반영. 플러시는 §4.1 그대로. 나머지 no-op |
| `sim/combat/*` · `sim/projectiles.js` · `sim/hazards.js` · `sim/dummy.js` · `sim/world/town.js` | no-op / `null` |
| `data/bosses/*.js` | §8.8의 자리 표시 정의 |
| `view/` 레이어 · `CameraRig` · `audio/` · `ui/` | 시그니처대로의 클래스. `FxLayer` · `AudioEngine` · `UIRoot`의 메서드는 no-op. `createRenderContext`는 실제 `WebGLRenderer` · `Scene` · `PerspectiveCamera`만 만들고 `render`가 그린다(후처리 없음 · 리사이즈는 스스로). **최소 부트(§11.6)가 "빈 마을 · 캡슐 보스"(§13 P0)를 보여 주도록 세 스텁은 자리 표시를 그린다**: `WorldLayer` = 현재 월드의 바닥 원판 · 경계 고리 · 콜라이더 자리 표시 · 기본 조명 / `CharacterLayer` = 플레이어 캡슐 · 허수아비 원기둥 · `createBossView`의 보스 뷰를 보간 위치에(`getSocketWorld`는 `false`) / `CameraRig` = §9.4의 자유 시점 궤도(록온 · 충돌 · 흔들림 없음). `UIRoot.fade`는 즉시 resolve, `activePanel` = `null`, `isBlocking()` · `canClose()` = `false`. `pose.js`의 `ease`와 `ui/i18n.js`의 `t`는 동작한다 |
| `view/bosses/*View.js` | §9.6의 스텁 뷰(캡슐 + 상자) |
| `bot/bot.js` | `createBot` = `{decide: () => NEUTRAL_INPUT, reset() {}}` |
| `app/*` | 빈 export(시그니처만). `main.js`는 스텁이 아니라 §11.6의 최소 부트 |

---

## §7 데이터 표와 수치

모든 값은 `src/data/`에 둔다. 시간은 초. 소유 패키지는 **이름 · 구조 · ID는 고정**하고, 수치는 봇 대전/플레이 감각을 보고 **±20% 안에서** 조정할 수 있다(조정하면 `docs/NOTES-P#.md`에 한 줄). 보스 HP · 기본 보상 · 레벨업 비용 공식 · 사망 보상 공식 · 순환 배율은 §7.7의 산수에 묶여 있으므로 패키지가 바꾸지 않는다(통합 게이트 W3에서 §12.4 시나리오 E의 결과로만 조정한다).

**(W3 확정 — 통합 게이트가 조정한 값. 근거와 측정 표는 `docs/NOTES-W3.md`)** 레벨업 비용 `60 + 10n + 0.3n²` → **`60 + 8n`** · 순환 배율 `hpPer 0.75 → 0.50` · `dmgPer 0.30 → 0.20` · 펜리르 HP `1900 → 1700` · 니힐 HP `2400 → 2800` + 피해 전부 약 +20% · 발더 피해 전부 약 −13% · 플레이어 `stamina.exhaustedDelay 0.9 → 0.75` · `exhaustedUntil 20 → 16`. 이 절과 §8.10~8.12의 표는 조정 뒤의 값이다.

### 7.1 플레이어 기본치 — `data/player.js` (P1 · 시드)

```js
export const PLAYER = {
  radius: 0.4, height: 1.8,
  base: { hp: 100, stamina: 100, staminaRegen: 45, flaskCharges: 3, flaskHeal: 45,
          parryWindow: 0.18, parryPosture: 30 },
  move: { walkSpeed: 5.0, sprintSpeed: 7.4, guardSpeed: 2.4, flaskSpeed: 1.6,
          accel: 40, decel: 50,                 // m/s²
          turnRate: 14, lockTurnRate: 12, attackTurnRate: 6,   // rad/s
          attackSnapTurnRate: 40, attackSnapDur: 0.08,         // 공격 시작 직후의 빠른 조준(rad/s · 초)
          strideWalk: 1.7, strideSprint: 2.3,   // 발소리 간격(m)
          sprintIntentMin: 0.1, dirIntentMin: 0.3 },           // 이동 의도 길이 하한: 달리기 인정 · 방향 입력(구르기 방향 · 공격 조준) 인정
  stamina: { regenDelay: 0.7, exhaustedDelay: 0.75, exhaustedUntil: 16,   // (W3 확정) 0.9 → 0.75 · 20 → 16
             sprintDrain: 12, guardRegenMul: 0.35 },
  roll:     { dur: 0.62, moveDur: 0.50, dist: 4.2, iStart: 0.03, iEnd: 0.40, cost: 22, actAt: 0.48 },
  backstep: { dur: 0.45, moveDur: 0.30, dist: 2.2, iStart: 0.03, iEnd: 0.22, cost: 14, actAt: 0.36 },
  guard: { arcHalf: 1.75, rearm: 0.40, hitDur: 0.28, breakDur: 1.20 },
  parry: { dur: 0.35, actAt: 0.12, pressGrace: 0.15 },
  flask: { dur: 1.30, healAt: 0.70, actAt: 1.05 },
  buffer: 0.35,                                 // 선입력 유효 시간(초)
  bufferAttack: 0.70,                           // bufferLongStates에서 저장한 선입력의 유효 시간(긴 무브의 캔슬 창 · 구르기/경직의 끝까지 살아 있게)
  bufferLongStates: ['attack', 'roll', 'backstep', 'stagger', 'knockdown', 'getup'],   // (W3 확정) bufferAttack을 쓰는 상태
  bufferCancelSlack: 0.10,                      // (W5 확정) 공격 중의 roll · flask 선입력 = max(bufferAttack, 캔슬 창까지 남은 시간 + 이 값)
  hurt: { staggerDur: 0.45, knockdownDur: 1.10, getupDur: 0.45, invuln: 0.50, wakeInvuln: 0.20,
          staggerPush: 3.5, knockdownPush: 9.0, guardPush: 2.5, knockDecay: 12 },
  attack: { lungeLead: 0.12, lockStopGap: 0.6 },// 전진 시작 = 예고 끝 lungeLead초 전 · 록온 전진은 보스 표면 lockStopGap m 앞에서 멈춤
  chargePostureMul: 2.0,                        // 완충 강공격의 체간 배율(차지 0→1에 따라 1→이 값)
  execute: { range: 2.4, frontHalf: 1.4, dur: 1.60, hitAt: 0.70, dmgMul: 5.0 },
  dashAttackMinSprint: 0.30,
  lockOn: { maxRange: 60, autoOnFight: true },
  deadPoseDur: 1.2,                             // view용: 쓰러지는 데 걸리는 시간(초)
};
```

**이동**
- 속도는 목표 속도(이동 의도 × 상태별 속력)로 `accel`/`decel`만큼 접근한다. `sprint` = 홀드 && 이동 의도 > 0.1 && `!exhausted` && `stamina > 0`. 달리는 동안 `sprintDrain`/초 소모. (이 절의 「이동 의도 > 0.1」 · 「> 0.3」은 `move.sprintIntentMin` · `move.dirIntentMin`이다.)
- 록온이 아니면 이동 방향으로 `turnRate`로 돈다. 록온이면 보스 쪽으로 `lockTurnRate`로 돌며 스트레이프한다(달리기 중에는 이동 방향을 본다).
- 록온: `lockOnPressed`로 토글(`LOCKON_CHANGED`). 보스가 없거나 `boss.state === 'dead'`거나 `lockOn.maxRange` 밖이면 켜지지 않고, 켜져 있었다면 꺼진다. 마을에서는 항상 false. 보스전은 **록온이 켜진 채 시작한다**(`autoOnFight` — P2가 `startBossFight`에서 켠다. 죽고 재도전할 때마다 다시 누르지 않는다).
- `hp <= 0 && state !== 'dead'`면 그 틱에 `dead`(§6.3).

**스태미나**
- 스태미나를 쓰는 행동은 `stamina > 0`이면 시작할 수 있다(모자라도 시작 — 0에서 멈춘다). 0을 찍으면 `exhausted = true` · `PLAYER_STAMINA_OUT` · 회복 지연 `exhaustedDelay`. `stamina ≥ exhaustedUntil`이면 `exhausted = false`.
- (W3 확정) **이미 `exhausted`인 채로 다시 0을 찍는 것은 새 탈진이 아니다** — `PLAYER_STAMINA_OUT`을 다시 내지 않고 회복 지연도 평소의 `regenDelay`다. 스태미나가 바닥난 채 연타하면 회복 지연 간격으로 공격이 한 번씩 나갈 뿐, 매 타마다 탈진 연출과 긴 지연에 묶이지 않는다. 가드 붕괴(`onPlayerDamaged`)의 탈진은 그대로다.
- `exhausted` 동안: 달리기 · 가드 불가(구르기 · 공격은 `stamina > 0`이면 된다). 회복은 마지막 소모 후 `regenDelay` 뒤에 `stats.staminaRegen`/초. 가드 중에는 `guardRegenMul` 배. 공격 · 구르기 · 달리기 중에는 회복하지 않는다.
- `state.debug.noStamina`면 소모 0.

**구르기 · 백스텝**
- `rollPressed`: 이동 의도 > 0.3이면 그 방향으로 `roll`, 아니면 facing 반대로 `backstep`. 버퍼에서 꺼낸 구르기의 방향은 **소비 틱의 이동 의도 > 0.3이면 그 방향**, 아니면 버퍼에 저장된 `dirX/dirZ`(길이 > 0.3일 때), 둘 다 없으면 `backstep`.
- **`roll` 진입 틱에 `facing = angleOf(rollDir.x, rollDir.z)`로 스냅한다**(`prevFacing`은 그대로 — 한 틱 보간으로 돈다). 록온 중에도 같다. `actAt`까지 facing 고정. `actAt` 이후에는 록온이면 `lockTurnRate`로 보스 쪽으로 돌아가고, 아니면 그대로 둔다. view는 구르기를 항상 **facing 방향 앞구르기**로 그린다(옆 · 뒤 구르기 자세는 없다).
- `backstep`은 facing을 바꾸지 않고 facing 반대로 이동한다.
- 이동: `moveDur` 동안 `dist`를 easeOutQuad로 간다. 무적: `stateTime ∈ [iStart, iEnd)`. `actAt` 이후 버퍼 소비(약공격이면 `rollAtk`, 구르기면 재구르기). 끝나면 `postRollT = stats.postRollWindow`.

**가드 · 패링**
- 가드 홀드 && `!exhausted` → `guard`. `guarding`은 `guard` · `guardHit`에서 true.
- **패링 창은 가드 입력의 상승 에지에서만 열린다**(홀드만으로는 열리지 않는다):
  1. 상승 에지(`input.guard && !guardHeldPrev`)에서 `parryRearm === 0`이면 `parryArmT = parry.pressGrace`. 매 틱 `parryArmT`를 줄인다.
  2. `guard` 상태에 **들어가는 틱**에 `parryArmT > 0`이면 `parryT = stats.parryWindow` · `parryArmT = 0`. `parryActive = (state === 'guard' && parryT > 0)`. 매 틱 `parryT`를 줄이고, `guard`를 벗어나면 `parryT = 0`.
     - (W5 확정) **탭 패링**: `guard` 상태에서 `parryT > 0`인 동안은 가드 입력을 떼도 `guard`를 유지한다(탈진은 예외 — 곧바로 내린다). 창이 끝나는 틱에 입력이 없으면 `idle`로 가고 그 틱에 `parryRearm = guard.rearm`을 다시 건다(연타 방지는 가드가 실제로 내려간 틱부터 센다). 짧게 누르고 뗀 클릭(60~120ms)이 창 안의 타격을 패링도 가드도 아닌 전액 피격으로 받던 것을 고쳤다. 버퍼 소비가 먼저라 탭 직후의 구르기 · 공격은 그대로 나간다.
  3. 가드 **입력을 뗀 틱**(`!input.guard && guardHeldPrev`)에 `parryRearm = guard.rearm`(가드 연타로 창을 되살리지 못하게). 상태 이탈이 아니라 입력 기준이다.
  4. 홀드를 유지한 채 다른 상태(공격 후딜 · 구르기 · `guardHit` · `parry`)에서 `guard`로 돌아오면 에지가 없으므로 **창이 없다** — 다단 공격을 자동으로 연속 패링하지 못한다. 다시 패링하려면 뗐다가(`rearm` 대기) 다시 누른다.
  5. 틱의 끝에 `guardHeldPrev = input.guard`(히트스톱 틱에는 갱신하지 않는다 — 히트스톱 중에 누른 가드는 다음 정상 틱에 에지로 잡힌다).
- 판정(P2): 정면 `arcHalf` 안의 공격만 막는다/패링한다. 패링 성공 → `parry` 상태(`dur`, 무적, `actAt` 이후 공격/구르기 가능).

**플라스크**
- `flasks > 0`이고 `idle/move/guard`에서 가능(`guard`에서 누르면 가드를 풀고 바로 마신다). 공격 후딜의 `rollCancelAt` 이후에도 가능. `healAt`에 `hp += stats.flaskHeal`(상한 hpMax) · `flasks −= 1` · `PLAYER_FLASK{phase:'heal'}`. 그 전에 맞으면 중단되고 **충전은 줄지 않는다**. `flasks === 0`에서 누르면 `PLAYER_FLASK{phase:'empty'}`만. `actAt` 전에는 어떤 행동으로도 취소할 수 없다. 이동 속력 `flaskSpeed`.

**선입력**
- 지금 실행할 수 없는 에지 입력(`light · heavy · roll · flask`)은 `buffer`에 한 칸으로 저장한다(새 입력이 덮어쓴다). 유효 시간 `t`는 저장하는 틱의 상태가 `PLAYER.bufferLongStates`(공격 · 구르기 · 백스텝 · 경직 · 넉다운 · 기상) 안이면 `PLAYER.bufferAttack`, 그 밖이면 `PLAYER.buffer`. 매 틱 `t −= dt`. 상태가 허용하는 첫 틱에 소비한다.
- (W5 확정) **공격 중에 누른 `roll` · `flask`**의 유효 시간은 `max(bufferAttack, 그 무브의 캔슬 창(windup + active + rollCancelAt)까지 남은 시간 + PLAYER.bufferCancelSlack)`이다. 예고 · 차지 중에는 끝까지 모았을 때(`+ chargeMax`)를 기준으로 잡는다(일찍 놓으면 그만큼 일찍 나갈 뿐이다). 대검의 전 무브(캔슬 창 0.78~1.08초)와 모든 무기의 강공격(0.77~0.80초 + 차지)은 0.70초보다 멀어, 예고 초반에 누른 구르기가 버려졌다. `light` · `heavy`는 `bufferAttack` 그대로다.
- (W5 게이트) **넉다운 중에 누른 `roll` · `flask`**도 같은 규칙이다: 유효 시간 = `max(bufferAttack, 남은 넉다운 + hurt.getupDur + PLAYER.bufferCancelSlack)` — 일어나는 틱(`getup` → `idle`)에 나간다. 넉다운 1.10초 + 기상 0.45초는 0.70초보다 멀어, 넘어지자마자 한 번 누른 구르기가 버려졌다(W3의 `bufferLongStates`가 막으려던 것). `light` · `heavy`는 그대로다. 봇(`bot.js canPressRoll`)은 넉다운 중에는 일어나기 0.70초 전부터만 구르기를 누른다(1.5초 묵은 구르기를 만들지 않는다 — 메타 루프 40시드: 발더 4.88 → 4.75회 · 펜리르 3.65 → 3.67 · 니힐 4.28 → 4.05, 잡음 범위).
- (W3 확정) W1까지는 `attack`만 `bufferAttack`이었다 — 구르기(행동 가능 0.48초) · 경직(0.45초)은 `buffer`(0.35초)보다 길어서, **구르자마자 연타한 두 번째 구르기**와 **맞자마자 누른 구르기**가 버려졌다(입력이 씹히는 경로). 곧 풀리는 잠금 상태 전부를 `bufferAttack`으로 올렸다. 긴 잠금(`flask` · `guardBreak` · `execute`)과 자유 상태는 `buffer` 그대로다.
- **`dead`를 뺀 모든 상태가 에지 입력을 버퍼에 받는다**(`guardBreak` · `knockdown` · `getup` · `execute` · `stagger` · `flask` 포함). 아래 표의 「버퍼만」은 "지금은 실행하지 않고 저장만 한다"는 뜻이다.
- 같은 틱에 여러 에지가 오면 우선순위: `roll > flask > heavy > light`.
- (W1 확정) **빈 플라스크는 버퍼에 넣지 않는다**: `flasks === 0`에서 누르면 그 틱에(히트스톱 틱 포함) `PLAYER_FLASK{phase:'empty', amount: 0, left: 0}`만 내고 버퍼 칸을 차지하지 않는다 — 같은 틱의 강 · 약 에지가 대신 들어간다.
- (W1 확정) **후딜 캔슬 잠금**: 공격 후딜을 구르기 · 가드 · 플라스크로 캔슬하면(`rollCancelAt` 이후), 그 무브가 원래 약/강을 허용했을 시각까지 `player.lightLock` · `player.heavyLock`(초 — §3.4)을 건다. 잠긴 동안 `attack`이 아닌 상태에서의 약/강 입력은 실행되지 않고 버퍼에 남는다(유효 시간 안에 잠금이 풀리면 그 틱에 나간다). 가드 · 구르기 자체는 늦어지지 않고 처형은 잠기지 않는다. → 아래 표의 `guard`가 약 · 강을 받더라도 「강 → 가드 캔슬 → 강」이 후딜 끝보다 당겨지지 않는다.

**상태별 허용 표**

| 상태 | 길이 | 받는 행동 | 무적 |
|---|---|---|---|
| `idle` · `move` | — | 전부 | — |
| `roll` | 0.62 | `actAt` 이후: 약 → `rollAtk` · 강 · 구르기 · 플라스크 · 가드 · 이동. 그 전에는 버퍼만 | 0.03~0.40 |
| `backstep` | 0.45 | `actAt` 이후: 위와 같다(약 → `light1`) | 0.03~0.22 |
| `attack` | 무브 합계 | 후딜 `comboAt` 이후: 약(→ `next`. `next`가 없으면 후딜 끝까지 대기 후 `light1`) · 강(**지금 공격이 `heavy`면 후딜이 끝난 틱에**). 후딜 `rollCancelAt` 이후: 구르기 · 가드 · 플라스크. 예고 · 판정 중에는 버퍼만(구르기 캔슬 **불가**). 후딜 끝 → `idle` | — |
| `guard` | 홀드 | 구르기 · 약 · 강 · 플라스크(가드를 풀고 바로) · 이동(`guardSpeed`) | — |
| `guardHit` | 0.28 | 버퍼만. `guarding` 유지. 끝나면 홀드 중이면 `guard`(패링 창 없음) | — |
| `guardBreak` | 1.20 | 버퍼만 | — |
| `parry` | 0.35 | 0.12 이후 약 · 강 · 구르기. 그 전에는 버퍼만 | 전 구간 |
| `flask` | 1.30 | 1.05 이후 전부. 그 전에는 버퍼만 | — |
| `stagger` | 0.45 | 버퍼만 | `hurt.invuln` 0.50 |
| `knockdown` → `getup` | 1.10 → 0.45 | 버퍼만 | 전 구간 + 기상 후 `hurt.wakeInvuln` 0.20 |
| `execute` | 1.60 | 버퍼만 | 전 구간 |
| `dead` | — | 없음(버퍼도 받지 않는다) | — |

(W1 확정 — 틱 양자화: 상태에 들어간 틱의 `stateTime`은 0, 모든 경계는 `stateTime ≥ 경계`인 첫 틱(올림)이다. 예: 0.27초 예고 → 17번째 틱에 판정. `roll` · `flask`의 `actAt` 뒤에는 이동 의도나 가드 홀드만으로도 상태를 빠져나간다 — 방향을 누른 채 구르면 0.48초에 `move`가 된다. 차지 중 `stateDur`는 「지금 놓았을 때의 총 길이」로 매 틱 갱신된다. 처형은 스태미나를 쓰지 않는다.)

`iframe` = 표의 무적 구간 || `hurtInvuln > 0`. `getup`이 끝나는 틱에 `hurtInvuln = hurt.wakeInvuln`(오래 남는 장판 위에서 일어나도 한 번은 대응할 수 있다).

**공격**
- 시작 순간 조준 방향: 록온이면 보스 방향, 아니면 이동 의도 > 0.3일 때 그 방향, 아니면 현재 facing(W1 확정: 조준 방향을 따로 저장하지 않는다 — 록온이면 매 틱 보스 방향, 아니면 예고(차지 포함) 동안 **그 틱의 이동 의도**를 조준으로 읽고 의도가 없으면 돌지 않는다). **모든 공격(연속기의 각 타 포함)은 시작 후 `attackSnapDur` 동안 `attackSnapTurnRate`로 그 방향을 향해 돈다**(0.08초에 3.2 rad — 등 뒤의 보스까지 돌아선다). 그 뒤 예고(차지 포함) 끝까지는 `attackTurnRate`로 따라 돈다. **판정 시작부터 후딜 끝까지 방향 고정.**
- 약공격: `light1 → next → …`. 마지막 타 뒤의 약 입력은 후딜이 끝나고 `light1`.
- 강공격: `windup` 뒤 `heavyHeld`면 `charge` 구간(최대 `chargeMax`) — 놓거나 가득 차면 `active`. 차지량 0..1에 따라 피해 배율이 `1 → move.chargeDmgMul`, 체간 배율이 `1 → PLAYER.chargePostureMul`로 선형(완충 강공격은 체간 붕괴용 선택지다). 가득 차는 순간 `PLAYER_CHARGE_FULL`. **강 → 강은 `comboAt`으로 당겨지지 않는다** — 강공격 뒤의 강공격은 후딜이 끝난 뒤에만 시작한다(강 연타가 약 연속기를 압도하지 않게: 장검 1.14초 주기 = 29.8/초, 대검 1.56초 = 39.2/초). 약 → 강, 강 → 약(`next`)은 `comboAt`에서 이어진다.
- 대시 공격: `sprinting && sprintTime ≥ dashAttackMinSprint`에서 약 → `dash`.
- 구르기 직후 공격: `roll`의 `actAt` 이후 버퍼된 약 → `rollAtk`.
- 스태미나는 공격 시작 때 낸다. 전진(`lunge`)은 예고 끝 `attack.lungeLead`초 전부터 판정 끝까지 선형. 록온 중이면 보스 표면(중심 거리 − `boss.radius` − `attack.lockStopGap`) 앞에서 전진을 멈춘다.
- 피격되면(outcome `hit`) 어떤 공격도 중단된다(플레이어에게 슈퍼아머 없음).

**처형**
- 조건: `boss.state === 'groggy'` && 중심 거리 ≤ `execute.range + boss.radius` && 플레이어가 보스 정면 `frontHalf` 안(`abs(angleDiff(boss.facing, angleOf(player − boss))) ≤ frontHalf`). 이때의 약공격 입력(버퍼 포함)이 처형이 된다.
- **`player.canExecute`** = 위 조건 && 현재 상태가 약공격을 받는다(표). P1이 매 틱 갱신한다 — HUD의 처형 프롬프트와 봇이 이 값을 읽는다(조건식을 다시 구현하지 않는다). 마을에서는 항상 false.
- `execute` 상태: 보스를 바라보게 스냅, `EXECUTE_STARTED`, 무적. `hitAt`에 한 틱 동안 `execute:true` 판정 — `damage = weaponDamage × damageMul × execute.dmgMul × stats.executeMul`, `attackId 'execute'`, `heavy true`.
- 처형 중의 `attack` 필드: `{moveId: 'execute', weaponId, kind: 'execute', motion: 'thrust', comboIndex: 0, charge: 0, hitId}`. `phase`는 `stateTime < hitAt`이면 `'windup'`(`phaseT = stateTime / hitAt`), 타격 틱은 `'active'`, 이후 `'recovery'`(`phaseT = (stateTime − hitAt) / (dur − hitAt)`). 타격 틱에 `PLAYER_SWING {moveId: 'execute', kind: 'execute', heavy: true, dur: DT}`.

**피격 반응 — `onPlayerDamaged(ctx, result)`**

| outcome | 전이 |
|---|---|
| `hit` && `lethal` | `dead` |
| `hit` && `knockdown` | `knockdown`(→ `getup` → `idle`). `knockVel = fromAngle(result.dir, knockdownPush)` |
| `hit` | `stagger`. `knockVel = fromAngle(dir, staggerPush)`. `hurtInvuln = hurt.invuln` |
| `guard` && `guardBreak` | `guardBreak`. `knockVel = guardPush`. **`exhausted = true` · `staminaDelay = stamina.exhaustedDelay` · `PLAYER_STAMINA_OUT`** |
| `guard` | `guardHit`. `knockVel = guardPush`. **`staminaDelay = stamina.regenDelay`** |
| `parry` | `parry` |
| `dodge` | 호출되지 않는다 |

`hit` · `parry`에서는 `iframe = true`도 그 자리에서 세운다. `knockVel`은 매 틱 `knockDecay`로 지수 감쇠하며 `pos`에 더한다.

### 7.2 전투 공통 — `data/combat.js` (P2 · 시드)

```js
export const COMBAT = {
  hitstopMax: 0.20,
  bossHitHitstop: 0.07, bossKnockdownHitstop: 0.10, guardHitstop: 0.04,
  parryHitstop: 0.12, executeHitstop: 0.16,
  shake: {                       // [진폭 m, 길이 초]
    playerLight: [0.04, 0.10], playerHeavy: [0.10, 0.16], execute: [0.30, 0.35],
    playerHurt: [0.16, 0.22], playerKnockdown: [0.26, 0.30], guard: [0.08, 0.12], parry: [0.12, 0.16],
  },
  outroDeath: 1.8, outroVictory: 2.6,          // 초
  dummy: { radius: 0.5, resetAfter: 3.0 },
  hitY: { player: 1.1, dummy: 1.0, bossFrac: 0.55 },
  interactCooldown: 0.3,
  projectileParryPostureMul: 0.5,              // 투사체를 패링했을 때 보스에 쌓는 체간 = stats.parryPosture × 이 값
  hitLogMax: 128,                              // state.hitLog 길이 상한
  chargeShoveSpeed: 14,                        // (W3 확정) 돌진하는 보스 몸통이 플레이어를 옆으로 비켜 세우는 속력(m/s) — §5.1 G3
  postureHitCap: 0.6,                          // (W5 확정) 한 번의 타격 · 패링이 쌓는 체간의 상한 = boss.postureMax × 이 값 — §6.4 규칙 4
};
```

### 7.3 무기 3종 — `data/weapons.js` (P1 · 머리 필드는 시드)

머리 필드:

| id | grip | baseDamage | guardReduction | guardStaminaFactor | reach | length | 성격 |
|---|---|---|---|---|---|---|---|
| `longsword` | oneHand | 20 | 0.75 | 0.90 | 2.6 | 1.1 | 균형 |
| `greatsword` | twoHand | 34 | 0.85 | 0.70 | 3.3 | 1.7 | 느리고 강함 · 체간 큼 |
| `spear` | polearm | 15 | 0.65 | 1.10 | 4.0 | 2.4 | 빠른 찌르기 · 긴 사거리(화력 · 체간은 낮다) |

무브 표(초 · m · rad). 셰이프 표기: `arc r/half` = `{type:'arc', r, halfAngle}`, `cap a→b/r` = `{type:'capsule', fwd0:a, fwd1:b, r}`. `chargeMax`와 `chargeDmgMul`은 heavy만(나머지 0 · 1). `heavy` 플래그는 `hitstop ≥ 0.07`인 타.

**장검 `longsword`**

| id | kind | motion | windup | active | recovery | dmgMul | posture | stamina | shape | lunge | comboAt | rollCancelAt | next | hitstop |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `light1` | light | slashR | 0.27 | 0.10 | 0.38 | 1.00 | 6 | 12 | arc 2.6/0.96 | 0.8 | 0.12 | 0.15 | light2 | 0.05 |
| `light2` | light | slashL | 0.24 | 0.10 | 0.38 | 1.00 | 6 | 12 | arc 2.6/0.96 | 0.7 | 0.12 | 0.15 | light3 | 0.05 |
| `light3` | light | slashUp | 0.27 | 0.10 | 0.42 | 1.10 | 7 | 13 | arc 2.7/1.05 | 0.8 | 0.14 | 0.17 | light4 | 0.05 |
| `light4` | light | overhead | 0.36 | 0.12 | 0.58 | 1.40 | 10 | 17 | cap 0.3→3.0/0.7 | 1.0 | 0.58 | 0.24 | null | 0.07 |
| `heavy` | heavy | thrust | 0.42 | 0.12 | 0.60 | 1.70 | 14 | 24 | cap 0.3→3.2/0.8 | 1.2 | 0.25 | 0.26 | light1 | 0.08 |
| `dash` | dash | thrust | 0.24 | 0.14 | 0.52 | 1.30 | 8 | 16 | cap 0.3→3.2/0.6 | 2.6 | 0.22 | 0.22 | light2 | 0.06 |
| `rollAtk` | roll | slashUp | 0.20 | 0.10 | 0.42 | 1.10 | 6 | 12 | arc 2.6/1.05 | 0.9 | 0.14 | 0.16 | light2 | 0.05 |

heavy: `chargeMax 0.80`, `chargeDmgMul 1.50`. 1타 박자 = 0.27 + 0.10 + 0.12 = **0.49초**.

**대검 `greatsword`**

| id | kind | motion | windup | active | recovery | dmgMul | posture | stamina | shape | lunge | comboAt | rollCancelAt | next | hitstop |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `light1` | light | slashR | 0.42 | 0.14 | 0.55 | 1.00 | 12 | 20 | arc 3.3/1.22 | 0.9 | 0.18 | 0.24 | light2 | 0.08 |
| `light2` | light | slashL | 0.40 | 0.14 | 0.58 | 1.05 | 12 | 20 | arc 3.3/1.22 | 0.9 | 0.18 | 0.24 | light3 | 0.08 |
| `light3` | light | overhead | 0.52 | 0.14 | 0.75 | 1.40 | 18 | 26 | cap 0.4→3.8/0.9 | 1.1 | 0.75 | 0.30 | null | 0.10 |
| `heavy` | heavy | spin | 0.60 | 0.16 | 0.80 | 1.80 | 26 | 38 | arc 3.6/1.75 | 1.0 | 0.30 | 0.32 | light1 | 0.11 |
| `dash` | dash | thrust | 0.34 | 0.16 | 0.70 | 1.35 | 14 | 24 | cap 0.4→3.8/0.8 | 2.8 | 0.28 | 0.28 | light2 | 0.09 |
| `rollAtk` | roll | slashUp | 0.30 | 0.14 | 0.58 | 1.10 | 12 | 20 | arc 3.3/1.22 | 1.0 | 0.18 | 0.24 | light2 | 0.08 |

heavy: `chargeMax 1.00`, `chargeDmgMul 1.50`. 1타 박자 = **0.74초**.

**창 `spear`**

| id | kind | motion | windup | active | recovery | dmgMul | posture | stamina | shape | lunge | comboAt | rollCancelAt | next | hitstop |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `light1` | light | thrust | 0.22 | 0.09 | 0.33 | 1.00 | 4 | 10 | cap 0.4→4.0/0.45 | 0.7 | 0.10 | 0.13 | light2 | 0.04 |
| `light2` | light | thrust | 0.20 | 0.09 | 0.33 | 1.00 | 4 | 10 | cap 0.4→4.0/0.45 | 0.7 | 0.10 | 0.13 | light3 | 0.04 |
| `light3` | light | thrust | 0.20 | 0.09 | 0.35 | 1.05 | 4 | 10 | cap 0.4→4.0/0.45 | 0.7 | 0.10 | 0.13 | light4 | 0.04 |
| `light4` | light | sweep | 0.30 | 0.12 | 0.52 | 1.45 | 7 | 16 | arc 4.0/0.87 | 0.6 | 0.52 | 0.22 | null | 0.07 |
| `heavy` | heavy | thrust | 0.40 | 0.12 | 0.58 | 1.75 | 11 | 22 | cap 0.4→4.8/0.55 | 1.8 | 0.24 | 0.25 | light1 | 0.08 |
| `dash` | dash | thrust | 0.20 | 0.14 | 0.50 | 1.40 | 8 | 15 | cap 0.4→4.6/0.5 | 3.2 | 0.20 | 0.20 | light2 | 0.06 |
| `rollAtk` | roll | thrust | 0.18 | 0.09 | 0.38 | 1.10 | 4 | 10 | cap 0.4→4.0/0.45 | 1.0 | 0.12 | 0.14 | light2 | 0.04 |

heavy: `chargeMax 0.70`, `chargeDmgMul 1.50`. 1타 박자 = **0.41초**.

**한 사이클 화력**(약 연속기를 끝까지 · 한 타의 박자 = windup + active + comboAt):

| 무기 | 사이클 | 피해 | 화력 | 스태미나 | 체간 | 성격 |
|---|---|---|---|---|---|---|
| 장검 | 0.49 + 0.46 + 0.51 + 1.06 = 2.52초 | 90 | **35.7/초** | 54 | 29 (11.5/초) | 기준 |
| 대검 | 0.74 + 0.72 + 1.41 = 2.87초 | 117 | **40.9/초** | 66 | 42 (14.6/초) | 틈이 길어야 본전 · 체간 큼 |
| 창 | 0.41 + 0.39 + 0.39 + 0.94 = 2.13초 | 67.5 | **31.7/초** | 46 | 19 (8.9/초) | 사거리와 안전을 화력 11% · 체간 23%와 바꾼다 |

보스전 실효 화력 = 이 값 × 공격 가능 시간 35~45%(장검 초기 12.5~16 DPS). P1이 무브 시간을 조정할 때는 세 무기의 사이클 화력 비 **1 : 1.15 : 0.89**를 ±5% 안으로 유지한다.

### 7.4 능력치 곡선 — `data/stats.js` (P4)

```js
export const STATS = {
  maxPoints: 40,                       // 능력치당 상한
  tiers: [15, 30, 40],                 // 1~15 / 16~30 / 31~40 점 구간
  vit: { hpPerPoint: [14, 9, 5] },
  end: { staminaPerPoint: [5, 3, 1.5], regenPerPoint: [1.2, 0.8, 0.4] },
  str: { dmgPerPoint: [0.06, 0.035, 0.02] },
  dex: { posturePerPoint: [0.05, 0.03, 0.015],
         critBase: 1.25, critPerPoint: [0.03, 0.02, 0.01],
         executePerPoint: [0.05, 0.03, 0.015] },
  levelCost: { base: 60, linear: 8, quad: 0 },   // (W3 확정) 60 + 10n + 0.3n² → 60 + 8n
};
```

- `tiered(points, perPoint)` = 구간별 합. 예: 생명력 17점 = 15×14 + 2×9 = 228.
- `hpMax = PLAYER.base.hp + tiered(vit)` · `staminaMax = 100 + tiered(end)` · `staminaRegen = 45 + tiered(end, regen)` · `damageMul = 1 + tiered(str)` · `postureMul = (1 + tiered(dex, posture)) × (1 + 0.03 × weaponLevel)` · `critMul = 1.25 + tiered(dex, crit)` · `executeMul = 1 + tiered(dex, execute)` · `parryPosture = 30 × (1 + tiered(dex, posture))`.
- `weaponDamage = baseDamage × (1 + 0.10 × weaponLevel)`.
- `level = 1 + 투자 점수 합`.
- **레벨업 비용** `levelUpCost(n) = Math.round(base + linear·n + quad·n²)` = **`60 + 8n`**(W3 확정 — `quad 0`), n = 지금까지 투자한 점수 합(능력치 구분 없음). 보상은 순환에 선형으로 자라고 점수도 순환마다 거의 일정하게 쌓이므로, 비용이 선형이어야 어느 순환에서든 "한 번 다녀오면 한 점은 산다"(§7.7 (4) 전선 보증). 능력치의 체감 감소는 구간(`tiers`)이 맡는다 — 비용까지 제곱으로 오르면 순환 2부터 30% 사망이 레벨업 0.7회분이 된다(W1의 한계).

| n | 0 | 1 | 2 | 3 | 4 | 6 | 8 | 10 | 12 | 18 | 20 | 24 | 30 | 36 | 40 | 100 | 159 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 비용 | 60 | 68 | 76 | 84 | 92 | 108 | 124 | 140 | 156 | 204 | 220 | 252 | 300 | 348 | 380 | 860 | 1332 |

누적(0점에서 그 점수까지 올리는 데 드는 합 = `Σ levelUpCost(k)` = `60n + 4n(n−1)`, k = 0..n−1): 3점 204 · 5점 380 · 10점 960 · 12점 1248 · 20점 2720 · 24점 3648 · 28점 4704 · 30점 5280 · 40점 8640 · 상한 160점 111360.

**기본 StatBlock**(점수 0 · 장검 +0 · 유물 없음 — `makeTestStats()`와 스텁의 값):
`level 1 · hpMax 100 · staminaMax 100 · staminaRegen 45 · weaponId 'longsword' · weaponLevel 0 · weaponDamage 20 · damageMul 1 · postureMul 1 · critMul 1.25 · executeMul 1 · guardReduction 0.75 · guardStaminaFactor 0.9 · flaskCharges 3 · flaskHeal 45 · parryWindow 0.18 · parryPosture 30 · postRollDmgMul 1 · postRollWindow 0 · lifesteal 0 · lowHpThreshold 0 · lowHpDmgMul 1 · emberGainMul 1`.

능력치 한 점의 체감(미리보기에 그대로 보인다): 생명력 +14 HP(+14%) · 지구력 +5 스태미나 & +1.2 회복/초 · 근력 +6% 피해 · 기량 +5% 체간 & +3%p 치명 & +5% 처형.

### 7.5 경제 — `data/economy.js` · `data/relics.js` (P4)

```js
export const ECONOMY = {
  death: { floor: 0.05, floorFullAt: 0.10, perFraction: 0.60 },
  repeatMul: [1, 0.5, 0.25],             // 이번 순환 격파 수 0 · 1 · 2 이상
  shardMilestones: [0.25, 0.5, 0.75],    // 각 1개. 보스별 · 순환별 1회
  shardsFirstKill: 3, shardsRepeatKill: 1,
  shardsRepeatKillMax: 2,                // 재격파 파편은 보스별 · 순환별 2번까지(그 뒤 재격파는 파편 0)
  cycle: { hpPer: 0.50, dmgPer: 0.20, rewardPer: 1.0,          // (W3 확정) 0.75 → 0.50 · 0.30 → 0.20
           softCap: 8, hpPerAfter: 0.25, dmgPerAfter: 0.10,   // 순환 8을 넘으면 HP · 피해 증가가 완만해진다(보상은 계속 선형)
           speedPer: 0.04, speedMax: 1.12, thinkBase: 0.85, thinkMin: 0.5,
           chainPer: 0.15, chainMax: 0.30 },
  weapon: { maxLevel: 10, dmgPerLevel: 0.10, posturePerLevel: 0.03,
            embers: [80, 130, 200, 290, 400, 530, 680, 850, 1040, 1250],   // +0→+1 … +9→+10
            shards: [1, 1, 1, 2, 2, 2, 3, 3, 3, 4],                         // 합 22
            catchUpEmberMul: 0.5 },                                         // 따라잡기 강화: 잔불 반값 · 파편 0
  shop: { flaskCharge: { prices: [350, 700, 1200] },                        // 3 → 6개
          flaskHeal: { prices: [200, 350, 550, 800, 1100], perLevel: 10 } },// 45 → 95
  relicSlots: 2,
};
```

**보상 공식** (`computeReward`)

```
R        = bossDef.reward × rewardMul(cycle) × repeatMul[min(killsThisCycle, 2)] × statBlock.emberGainMul
           rewardMul(c) = 1 + 1.0 × c
승리 잔불 = round(R)
사망 잔불 = round(R × (floor × min(1, f / floorFullAt) + perFraction × f))     f = damageFraction (0..1)
           = round(R × (0.05 × min(1, f / 0.10) + 0.60 × f))
파편     = (새로 넘긴 구간 수: f ≥ 0.25/0.5/0.75 중 아직 안 받은 것 — 승리는 f = 1)
         + (승리면: 이번 순환 첫 격파 3 / 재격파는 killsThisCycle ≤ 2일 때만 1 / 그 뒤 0)
```

- 바닥(`floor`)은 준 피해에 따라 열린다: f = 0이면 **0**(가만히 서서 죽는 것으로는 아무것도 못 번다), f ≥ 0.10부터 5% 전부. 발더 순환 0: f 0.05 → 66 · f 0.10 → 132 · f 0.20 → 204 · f 0.30 → **276** · f 0.50 → 420 · f 0.65 → 528 · f 1(사망) → 780 < 격파 1200. 펜리르: f 0.30 → 460 · f 0.50 → 700. 니힐: f 0.30 → 690 · f 0.50 → 1050. (보상 공식과 기본 보상은 W3에서 바꾸지 않았다.)
- 보스 기본 보상 `reward`: 발더 **1200** · 펜리르 **2000** · 니힐 **3000**.
- 재격파 파편의 `killsThisCycle`은 지급 **전**의 값이다: 0 → 첫 격파 3개 · 1, 2 → 1개 · 3 이상 → 0개. 보스별 · 순환별 파편 상한 = 구간 3 + 첫 격파 3 + 재격파 2 = **8**(세 보스 24 ≥ 한 무기 +10의 22).
- `applyReward`: 잔불 · 파편 지급 → `bestFraction = max` · `milestones` 갱신 → 승리면 `killsThisCycle += 1` · `totalKills += 1` · 다음 보스(`BOSS_IDS` 순서) 해금 → 세 보스 모두 `killsThisCycle ≥ 1`이면 **`cycle += 1`** 하고 전 보스의 `killsThisCycle · bestFraction · milestones`를 0으로(해금은 유지). `totals`: `playTime += reward.duration` · `embersEarned += reward.embers` · 승리면 `kills += 1` · 아니면 `deaths += 1`.
- **순환 배율** `getCycleScaling(c)` — `a = min(c, softCap)`, `b = max(0, c − softCap)`: `hpMul = 1 + 0.50a + 0.25b` · `dmgMul = 1 + 0.20a + 0.10b` · `rewardMul = 1 + 1.0c` · `speedMul = min(1.12, 1 + 0.04c)` · `thinkMul = max(0.5, 0.85^c)` · `chainBonus = min(0.30, 0.15c)`. 예: c = 1 → hp 1.5 · dmg 1.2 · reward 2 / c = 8 → 5.0 · 2.6 · 9 / c = 12 → 6.0 · 3.0 · 13. (W3 확정: W1의 0.75 · 0.30으로는 숙련 고정 봇이 순환 2의 펜리르에서 20회 넘게 막혔다 — 성장의 체감 감소(능력치 구간 · 무기 +10 상한)가 순환당 +75% HP를 따라가지 못한다.)
- **무기 강화 비용** `weaponUpgradeCost(level, catchUp)`: 기본 `{embers: embers[level], shards: shards[level]}`. `catchUp`(그 무기의 단계가 다른 두 무기 중 높은 쪽보다 낮다)이면 `{embers: round(embers[level] × catchUpEmberMul), shards: 0}` — 파편은 "어떤 무기로든 그 단계에 처음 도달할 때"만 든다. 예: 장검 +4일 때 대검 +0 → +1 = 잔불 40 · 파편 0. 무기를 바꿔 써 보는 비용이 절반이고 관문 재화를 다시 먹지 않는다.

**유물** (`RELICS`) — 2칸 장착. 상점 itemId는 `relic:<id>`.

| id | 가격 | 효과(StatBlock에 반영) |
|---|---|---|
| `ember_fang` | 500 | 구르기 직후 1.5초 피해 +25% — set `postRollDmgMul 1.25`, `postRollWindow 1.5` |
| `watcher_ring` | 500 | 패링 창 +0.08초 — add `parryWindow 0.08` |
| `green_moss` | 400 | 스태미나 회복 +25% — mul `staminaRegen 1.25` |
| `leech_seal` | 700 | 준 피해의 5% 흡혈 — set `lifesteal 0.05` |
| `red_tear` | 600 | HP 30% 이하에서 피해 +30% — set `lowHpThreshold 0.3`, `lowHpDmgMul 1.3` |
| `ash_idol` | 450 | 잔불 획득 +15% — mul `emberGainMul 1.15` |
| `stone_ward` | 450 | 가드 스태미나 소모 −30% — mul `guardStaminaFactor 0.7` |

상점 품목 id: `flask_charge` · `flask_heal` · `relic:<id>`. 무기는 처음부터 3종 모두 보유(+0), 강화 단계는 무기별.

**새 프로필** (`createNewProfile`): `embers 0 · shards 0 · stats {vit:0,end:0,str:0,dex:0} · weapons 3종 {level:0} · equippedWeapon 'longsword' · flaskChargeLv 0 · flaskHealLv 0 · relicsOwned [] · relicsEquipped [null, null] · cycle 0 · bosses {valder:{unlocked:true,…0}, fenrir:{unlocked:false,…}, nihil:{unlocked:false,…}} · totals 전부 0 · seed`.

### 7.6 보스 3종

→ 표가 길어 §8 뒤(§8.10~8.12)에 둔다. 요약: 발더 HP **1400** · 체간 100 · 보상 1200 / 펜리르 HP **1700** · 체간 120 · 보상 2000 / 니힐 HP **2800** · 체간 90 · 보상 3000. (W3 확정: 펜리르 1900 → 1700 · 니힐 2400 → 2800 — 같은 프로필 · 같은 봇으로 잰 「버티는 시간 ÷ 잡는 시간」이 W1 값으로는 발더 1.09 → 펜리르 0.71 → 니힐 0.67로, 발더 → 펜리르의 단이 너무 높고 펜리르 → 니힐의 단은 없었다. 조정 뒤 1.28 → 0.76 → 0.51. §7.7 (2).)

### 7.7 밸런스 산수 — 브리프 §2의 목표 맞추기

> **(W3 확정)** 이 절은 통합 게이트가 봇 대전으로 잰 값으로 다시 썼다. W1의 산수는 "보통 플레이어"의 화력을 15~27 DPS로 잡았는데, 숙련 고정 봇(`dodgeChance 0.55 · aggression 0.6`)의 실측은 새 프로필 7~8 DPS · 도달 프로필 16~22 DPS였다. 측정 표 전체와 조정 과정은 `docs/NOTES-W3.md`.

**재는 방법**: 숙련 고정 봇이 새 프로필에서 시작해 죽을 때마다 자동 구매하고 재도전한다(§12.4 시나리오 E · F). 봇은 판을 거듭해도 실력이 늘지 않으므로 이 수치가 **하한**이다 — 사람은 패턴을 익히는 만큼 더 빨리 잡는다.

**(1) 첫 도전: 30% 깎고 죽으면 레벨업 3회**

- 사망 잔불 = 1200 × (0.05 + 0.60 × 0.30) = **276**. 레벨업 비용 60 + 68 + 76 = 204 ≤ 276 → **3회**(4회째 84는 못 산다). ✔
- 25% 구간 파편 1개 → 무기 +1(잔불 80 · 파편 1)을 대신 고르면 레벨 2회(60 + 68)와 합쳐 208 ≤ 276.
- 덜 깎았을 때: f = 0.20 → 204 → 3회 · f = 0.10 → 132 → 2회 · f = 0.05 → 66 → 1회 · f = 0 → 0(무조작 사망은 벌지 못한다 — 파밍 차단). "한 대라도 때리고 오면 뭔가 산다." ✔
- 봇의 첫 판 실측: f 평균 0.50(최소 0.13) → 잔불 약 420 → 무기 +1과 레벨 4회.

**(2) 보스마다 3~6회 도전에 격파** (봇 실측 — 시드 40개 · 순환 0)

| 보스 | 진입 성장(평균) | 격파까지 도전 | 분포 | 격파 판 | 사망 판 | 사망 f |
|---|---|---|---|---|---|---|
| 발더 | 0점 · +0 | 평균 **5.0** (2~9) | 3~6회 78% · 8회 이하 98% | 71초 (45~87) | 66초 (29~91) | 0.67 |
| 펜리르 | 20점 · +2.7 | 평균 **3.9** (1~7) | 5회 이하 93% | 76초 (57~100) | 75초 (55~111) | 0.78 |
| 니힐 | 35점 · +4.0 | 평균 **3.4** (1~8) | 5회 이하 90% | 107초 (68~137) | 108초 (71~153) | 0.73 |

- 발더의 벽은 2페이즈(HP 50%)다 — 사망의 대부분이 f 0.5~0.8에서 난다. 사망 보상 기울기(`perFraction 0.60`)가 f에 비례하므로 벽 앞에서 죽을수록 다음 판의 성장이 크다.
- 같은 프로필(22점 · +3) · 같은 봇으로 잰 「버티는 시간 ÷ 잡는 시간」: W1 값으로는 발더 1.09 · 펜리르 0.71 · 니힐 0.67 — 발더 → 펜리르에서만 1.5배의 성장을 요구하고(봇 7.5회) 그동안 과성장해 니힐은 1.6회에 잡혔다. 펜리르 HP를 내리고(1900 → 1700) 니힐을 올려(HP 2400 → 2800 · 피해 +20% · 훅의 덤 kite 제거) 조정 뒤 **1.28 · 0.76 · 0.51** — 단이 고르게 높아진다(받는 피해 초당 4.7 · 4.9 · 4.3, 주는 피해 초당 22 · 17 · 16).
- 발더는 받는 피해가 셋 중 가장 컸다(초당 5.3 대 4.4 · 3.6) — 첫 보스의 피해를 약 13% 내렸다(HP는 그대로 — 판이 짧아지지 않게).

**(3) 한 판 60~150초**

- 메타 루프 전체(시나리오 F · 38판)의 한 판 평균 **71초**(35~109초). 보스별 평균은 위 표 — 발더 66~71초 · 펜리르 75~76초 · 니힐 107~108초. ✔
- godMode 격파 시간(§12.4 시나리오 C — 그 보스의 도달 프로필 · 기본 봇 · 시드 20개): 발더 59초(50~70) · 펜리르 80초(65~97) · 니힐 84초(61~111). 허용 범위 45~180초 안. ✔
- 새 프로필로 운이 나쁘면 20~40초에 죽는 판이 있다(발더 최소 22초 · 펜리르 16초). 과성장 프로필(70점 · +8)은 발더를 13~16초에 잡는다 — 지나온 보스를 되짚는 판은 짧다.

**(4) 순환과 전선 보증**

- 순환 배율(§7.5): 순환마다 HP +50% · 피해 +20% · 보상 +100%. 봇 실측(시드 24개 · 가장 값싼 성장부터 구매 — 격파까지의 평균 도전 수):

| 순환 | 발더 | 펜리르 | 니힐 | 진입 점수(발더 / 펜리르 / 니힐) |
|---|---|---|---|---|
| 0 | 5.2회 | 3.9회 | 3.3회 | 0 / 21 / 36 |
| 1 | 1.0회 | 3.0회 | 2.7회 | 50 / 54 / 68 |
| 2 | 1.2회 | 2.7회 | 4.3회 | 83 / 88 / 101 |
| 3 | 1.3회 | 4.3회 | 3.7회 | 125 / 129 / 146 |

  순환 +1에서 정체하지도 발산하지도 않는다(W1 값으로는 순환 1 펜리르 8.9회 · 순환 2 펜리르 20회 이상 — 10개 시드 중 8개가 25회 안에 잡지 못했다). 성장은 순환 3~4에서 상한(160점 · +10)에 닿고, 그 뒤는 배율만 오르는 도전 과제 구간이다(순환 8에서 HP ×5.0 · 피해 ×2.6).
- **전선 보증**(그 전선에 처음 닿았을 때의 평균 투자 점수 n에서, f = 0.30 사망 잔불 ≥ `levelUpCost(n)`) — `economy.test`가 전부 검사한다:

| 전선 | n | f 0.30 사망 잔불 | levelUpCost(n) | |
|---|---|---|---|---|
| 발더 · 순환 0 | 0 | 276 | 60 | ✔ |
| 펜리르 · 순환 0 | 21 | 460 | 228 | ✔ |
| 니힐 · 순환 0 | 36 | 690 | 348 | ✔ |
| 발더 · 순환 1 | 50 | 552 | 460 | ✔ |
| 펜리르 · 순환 1 | 54 | 920 | 492 | ✔ |
| 니힐 · 순환 1 | 68 | 1380 | 604 | ✔ |
| 발더 · 순환 2 | 83 | 828 | 724 | ✔ |
| 펜리르 · 순환 2 | 88 | 1380 | 764 | ✔ |
| 니힐 · 순환 2 | 101 | 2070 | 868 | ✔ |
| 발더 · 순환 3 | 125 | 1104 | 1060 | ✔ |
| 펜리르 · 순환 3 | 129 | 1840 | 1092 | ✔ |
| 니힐 · 순환 3 | 146 | 2760 | 1228 | ✔ |
| 어느 보스든 · 순환 4 이상 | 159(마지막 한 점) | ≥ 1380 | 1332 | ✔ |

  "한 번 다녀오면 한 점은 산다"가 어느 순환에서든 성립한다(W1의 `60 + 10n + 0.3n²`로는 순환 2부터 가장 쉬운 보스의 30% 사망이 레벨업 0.7회분이었다). 가장 빠듯한 전선은 각 순환의 발더다 — 평균 1.05~1.22배, 많이 죽어 점수가 평균보다 20점쯤 많은 판에서는 f 0.32~0.34가 필요하다(순환 3 최악 0.88배). 봇의 실제 사망은 그 전선에서 f 0.8 이상이라 레벨업 2회 이상을 산다(사망 뒤 살 수 있는 레벨업의 실측 최소가 순환 3까지 2회 — 성장 상한에 닿은 판 제외).
- 수입(순환 0 · 봇 실측 평균): 격파 6200 + 사망 보상 약 8500(발더 4회 × 약 500 · 펜리르 3회 × 약 950 · 니힐 2.4회 × 약 1500) ≈ **15000 잔불** → 순환 1 진입 때 50점 · 무기 +5. 지출처: 레벨 50점 12800 · 무기 +5 1100(파편 7) · 나머지가 플라스크 · 유물. 상점 전부는 8850(충전 2250 · 회복 3000 · 유물 7종 3600)이라 순환 1~2까지 살 것이 남는다.
- 파편: 보스당 구간 3 + 첫 격파 3 = 6개 × 3 = 18 → 한 무기 +9까지(누적 18). 재격파 2회씩을 더하면 24 ≥ +10의 22. 다른 무기는 따라잡기 강화(잔불 반값 · 파편 0)로 올린다.

### 7.8 월드 — `data/world.js` (P2 · 시드)

전부 원점 중심 원형. 좌표 (x, z), m.

**`town`** — `kind 'town'`, `theme 'town'`, `radius 18`

| 요소 | 값 |
|---|---|
| playerSpawn | `{x: 0, z: 2.4, facing: 0}` (화톳불 바로 북쪽 — 화톳불 상호작용 원 안이라 부활 즉시 `[E]` 프롬프트가 뜬다. 북쪽 안개문을 보고, 대장장이 · 상인이 좌우 앞 시야에 든다. 안개문 원까지 8.4m) |
| facilities | `bonfire {0, 0, r 2.6}` · `blacksmith {-8, 5, r 2.6}` · `merchant {8, 5, r 2.6}` · `gate {0, 14, r 3.2}` |
| npcs | `blacksmith {x:-8.8, z:5.8, facing: 2.3}` · `merchant {x:8.8, z:5.8, facing: -2.3}` (광장 중심을 본다) |
| dummy | `{x: -6, z: -6}` |
| colliders | 화톳불 `circle(0, 0, 0.9)` · 대장간 `box(-10.5, 7, hw 2.0, hd 1.5)` · 좌판 `box(10.5, 7, hw 2.0, hd 1.5)` · NPC `circle(-8.8, 5.8, 0.5)`, `circle(8.8, 5.8, 0.5)` · 안개문 기둥 `circle(-2.4, 15.5, 0.8)`, `circle(2.4, 15.5, 0.8)` · **(W3 확정) 안개문 벽 `box(0, 15.5, hw 9.4, hd 0.3)`** |

상호작용: 플레이어가 시설 원(`r`) 안이면 가장 가까운 것이 `nearFacility`. 허수아비는 상호작용 대상이 아니다(때리는 대상).

(W3 확정) **안개문 벽**: 두 기둥 사이(안개 막)와 기둥 바깥에서 광장 가장자리까지를 한 줄로 막는 상자다 — 막을 지나거나 기둥을 돌아 문 뒤(경계까지 약 2m)로 걸어 들어갈 수 없다. 플레이어는 막 0.7m 앞(z ≤ 14.8)에서 멈추고 거기서 `gate` 상호작용이 잡힌다. 네 곳이 함께 간다: `data/world.js`(콜라이더 8개) · `view/world/townScene.js`(**`gate` 시설 원 안에 중심이 있는 상자는 건물이 아니다** — 대장간 · 좌판 상자를 고를 때 빼고, 기둥 바깥 구간을 무너진 담으로 그린다) · `gamesim.test`(개수 8 · 「문 뒤로 걸어 들어갈 수 없다」) · 이 절. 카메라는 상자를 검사하지 않는다(§9.4 그대로).

**아레나**

| id | theme | radius | colliders | playerSpawn | bossSpawn |
|---|---|---|---|---|---|
| `arena_valder` | ember | 20 | 없음 | `{0, -13, 0}` | `{0, 5, π}` |
| `arena_fenrir` | frost | 24 | 얼음 기둥 5개: 반경 15의 원 위, 각 `k×1.2566`(k = 0..4), `r 1.3` → (0, 15) · (14.3, 4.6) · (8.8, −12.1) · (−8.8, −12.1) · (−14.3, 4.6) | `{0, -16, 0}` | `{0, 6, π}` |
| `arena_nihil` | void | 22 | 석주 4개: 반경 11의 원 위, 각 `0.785 + k×1.5708`(k = 0..3), `r 1.0` | `{0, -15, 0}` | `{0, 6, π}` |

기둥 위치는 `(R sin a, R cos a)`. 투사체는 기둥에 닿으면 사라진다(엄폐). 광선 · 장판 · 근접 판정은 기둥을 무시한다. 스폰은 콜라이더에서 1m 이상 떨어져 있고 두 스폰 사이 시선은 비어 있다(§6.4 「`data/world.js` 검사」가 지킨다 — 펜리르 스폰에서 가장 가까운 기둥까지 9.6m).

---

## §8 보스 프레임워크 (P3)

목표: **보스 2 · 3은 데이터(`BossDef`) + 작은 훅만으로** 만들어진다. 프레임워크가 모르는 동작이 필요하면 훅으로 넣고, 프레임워크 파일은 P3만 고친다.

### 8.1 공격의 시간축 — `tA`

- 한 공격 = `windup → active → recovery`. 실제 길이: `windup' = max(BOSS_AI.minWindup, def.windup / boss.speedMul)`(= 0.40초 하한), `active' = def.active`(배속 없음), `recovery' = def.recovery / boss.speedMul`. 이 절(§8)의 본문에 적힌 프레임워크 상수는 전부 `data/bossCommon.js`의 `BOSS_AI`(§8.6)에 이름이 있다.
- **`tA` = 판정 시작을 0으로 한 시각(초)** = `attack.t − windup'`. 음수 = 예고 중, `0..active` = 판정 중, 그 이상 = 후딜.
- `hits[].t0/t1` · `move.t0/t1/aimLock` · `events[].t` · `track.lockLead`는 **전부 `tA` 기준**이고 배속을 받지 않는다(판정 시작에 고정된 박자). 데이터 규칙: 음수 오프셋의 절댓값 ≤ `def.windup × 0.75`.
- 구간 전환 때 이벤트: 공격 시작 `BOSS_ATTACK_WINDUP` · `tA = 0`에서 `BOSS_ATTACK_ACTIVE` · 끝(후딜 종료 · 연속기 전환 · 중단)에서 `BOSS_ATTACK_END`.

### 8.2 다단 히트 · 지속 판정

- `hits[]`의 각 원소가 한 번의 판정 창이다. 창이 열릴 때 `hitId`를 새로 받는다 → 한 공격에 창이 둘이면 두 번 맞을 수 있다.
- `interval > 0`이면 `t0`부터 `interval`마다 `hitId`를 갱신한다(브레스: 0.35초마다 한 틱).
- 셰이프 원점 = 보스 현재 `pos`, 기준 방향 = 보스 현재 `facing`(돌진 · 광선처럼 움직이는 판정이 자동으로 따라간다).
- `getBossHits`의 `damage = hit.damage × boss.dmgMul`. 나머지 `OutgoingHit` 필드는 §3.2의 채움 규칙(보스) 그대로: `heavy = hit.knockdown` · `hitstop = 0` · `posture = 0` · `execute = false`.

### 8.3 추적과 방향 고정

- 예고 중(`tA < −lockLead`): `track.turnRate`로 플레이어를 향해 돈다. `aimX/aimZ`는 플레이어 현재 위치를 따라간다.
- `tA ≥ −lockLead`: **`attack.locked = true`. 방향 고정.** 이 순간 이후의 구르기는 반드시 피할 수 있다.
- 판정 중: 회전 없음. 예외 둘 — `track.activeTurnRate`(브레스: 판정 중에도 느리게 추적), `track.sweep`(광선: 고정 방향 `L` 기준, 고정 순간부터 `tA = 0`까지 `L + sweep.from`으로 선형 회전, 판정 동안 `L + from → L + to`로 선형 회전).
- 후딜: 회전 없음(뒤를 잡을 수 있다).
- 연속기로 이어진 공격은 다시 예고부터 시작하므로 다시 추적한다.
- **`track.sweep`이 있는 공격의 텔레그래프**: `TelegraphSrc.facing`은 고정 방향 `L`이다(고정 전에는 현재 facing). 고정 뒤 `L + from`으로 돌아가는 회전을 표식은 따라가지 않는다 — 표식(`telegraphShape`)은 쓸리는 범위 전체를 그린다.

### 8.4 이동 (`move`)

| kind | 동작 |
|---|---|
| `lunge` | `t0..t1` 동안 현재 facing으로 `dist`만큼 전진(easeOutQuad). 플레이어 중심에서 `stopShort` 앞에서 멈춘다 |
| `charge` | `t0..t1` 동안 **고정된** facing으로 등속 `dist` 전진. 플레이어를 지나친다(몸통 충돌은 P2가 민다 — W3 확정: 돌진 중에는 옆으로만 비켜 세운다. §5.1 G3 · §6.4) |
| `leap` | `aimLock`에 조준점 고정(플레이어 위치. 이동 거리가 `dist`를 넘으면 그 안으로 당긴다). `t0..t1` 동안 현재 위치 → `조준점 − 방향 × stopShort`로 이동, `y = height × sin(π·u)` |
| `hop` | `t0..t1` 동안 facing **반대**로 `dist` 이동, `y = height × sin(π·u)` |

- 이동 중 위치는 P3가 직접 쓰고, 월드 경계/기둥은 P2가 같은 틱에 되민다.
- `leap`의 텔레그래프(`telegraphAt: 'aim'`)는 고정 전에는 플레이어를 따라다니고, 고정 후에는 멈춘다.
- (W5 확정) **막힌 도약은 그 앞에 내려앉는다**: 조준점을 잡을 때(고정 전의 매 틱) 현재 위치 → 착지점(`조준점 − 방향 × stopShort`)의 직선을 `sweepCircleVsWorld`(§6.1)로 훑어, 기둥 · 경계에 막히면 닿는 자리를 착지점으로 삼고 **조준점도 `착지점 + 방향 × stopShort`로 당긴다**(바닥 표식과 착지 판정이 같은 자리에 온다). 종전에는 「남은 거리의 비율」로 가다가 P2의 밀어내기에 매 틱 되밀려 공중에 멈춰 있었고, 마지막 틱에 남은 거리 전부(최대 5.2m)를 한 번에 뛰어 기둥 반대편에 내렸다(착지 판정이 표식에서 2.2m 어긋났다 — 펜리르 `pounce`의 16%).

### 8.5 타임라인 이벤트 (`events`)

`tA ≥ ev.t`가 되는 첫 틱에 한 번 실행(`attack.fired`에 인덱스 기록). `ev.phase`가 있으면 그 페이즈에서만. 공격이 중단되면 남은 이벤트는 버린다. `count > 1 && interval > 0`이면 `ev.t + k×interval`에 나눠 실행한다.

| type | 동작 |
|---|---|
| `projectile` | `origin`(보스 로컬)에서 플레이어 방향(`spread`가 있으면 부채로 벌려)으로 `ctx.spawnProjectile(proj, x, z, dir, boss.dmgMul)` |
| `hazard` | `place` 규칙으로 위치를 정해 `ctx.spawnHazard(hazard, x, z, facing, boss.dmgMul)`. `scatter`의 난수는 `ctx.rng` |
| `teleport` | 목적지 계산 → `pos`와 **`prevPos`를 함께** 덮어쓴다 → `BOSS_TELEPORT`. 목적지는 `world.radius − radius − 1` 안으로, 콜라이더와 겹치지 않게 조정. `away`: 플레이어에서 `dist`만큼, 플레이어 → 원점 방향(가장 넓은 쪽). `behindTarget`: 플레이어 등 뒤 `dist`. `flank`: 플레이어 옆(좌우 난수) `dist`. `center`: 원점. 이동 뒤 facing은 플레이어 쪽 |
| `cue` | `BOSS_CUE {bossId, attackId, seq: attack.seq, cue, style: def.style, x, z, facing, ...params}`. `shake`가 있으면 `ctx.shake` |
| `hook` | `hooks.onTimelineEvent(ctx, ev)` |

(W1 확정) `count`는 `projectile` · `hazard`에만 뜻이 있다. `place`가 없으면 `'self'`. `scatter`의 첫 개는 플레이어 위치. self가 아닌 장판 위치는 `world.radius` 안으로 당긴다. `ringAround`는 `boss.facing`에서 시작해 균등 배치하고 장판의 facing은 바깥쪽, 그 밖의 장판 facing은 `boss.facing`. 순간이동은 `prevFacing`도 함께 덮어쓴다. `height`가 있는 이동(`leap` · `hop`)은 공격이 끝나거나 끊기면 `boss.y = 0`으로 돌린다 — **부유 보스는 훅의 `onTick`에서 매 틱 다시 올린다**. 텔레그래프의 `style` = 공격의 `glow`(`'none'`이면 `def.style`) — `danger` 공격의 바닥 표식은 붉다.

### 8.6 AI 선택

세 보스 공통 상수 — `data/bossCommon.js` (P3 · 시드). 아래 의사 코드와 §8.1 · §8.4 · §8.5 · §8.7의 숫자는 이 표의 값이다.

```js
export const BOSS_AI = {
  minWindup: 0.40,            // 배속을 받아도 예고는 이보다 짧아지지 않는다(초)
  negOffsetMax: 0.75,         // 음수 오프셋 절댓값 ≤ windup × 이 값(§8.9 규칙 4)
  reselect: 0.3,              // chase 중 재선택 간격(초)
  fallbackAfter: 3.0,         // 후보 없이 chase가 이만큼 이어지면 fallbackAttack(초)
  repeatPenalty: [0.3, 0.6],  // 직전 · 전전 공격과 같으면 가중치에 곱한다
  maxChain: 3,                // 연속기 최대 횟수
  approachBand: 1,            // d > preferredRange + 이 값이면 approach(m)
  kiteNear: 0.6,              // kite 보스: d < preferredRange × 이 값이면 retreat
  strafeSpeedMul: 0.6, strafeFlip: [1.5, 3.0],   // 스트레이프 속력 배율 · 방향 재추첨 간격 [min, max] 초
  stopShortPad: 0.9,          // lunge · leap의 stopShort 기본값 = radius + 이 값(m)
  teleportMargin: 1,          // 순간이동 목적지는 world.radius − radius − 이 값 안(m)
  introRoarAt: 0.5, phaseRoarAt: 0.6, phaseShake: [0.3, 0.6],   // 포효 큐 시각(초) · 페이즈 포효 흔들림 [진폭 m, 길이 초]
  rearChance: 0.5,            // (W3 확정) 공격을 끝냈을 때 뒤를 잡혀 있으면 이 확률로 돌아서지 않는다
  rearThinkMul: 0.3,          // (W3 확정) 그때의 고민 시간 배율
};
```

```
공격 종료(· 인트로 · 패링당함 · 회복 · 페이즈 전환의 끝) → 고민. think = rng.range(think[0], think[1]) × thinkMul(페이즈 × 순환)
  (W3 확정) 고민하는 방식은 셋이다 — 싸울 상대가 있을 때(select() 0단계와 같은 조건):
    a. 뒤를 잡혔다: 지금 각도로 고를 수 있는 「등 뒤 전용」 공격(sel.minAngle > 0 · 거리 · 쿨다운 · 페이즈 충족)이 있고
       rng.chance(rearChance) → state 'idle', stateDur = think × rearThinkMul, **돌아서지 않는다**
       (고민하며 돌아서 버리면 등 뒤 공격은 영영 나오지 않는다 — 발더 spin_slash · 펜리르 tail_sweep이 W1에는 0~1%였다)
    b. 선호 거리 밖이다: d > preferredRange + 1, 또는 kite && d < preferredRange × 0.6
       → state 'chase', stateDur = think. **걸으면서 고민한다** — 아래 chase의 규칙으로 움직이되 think가 끝나야 select()
    c. 그 밖 → state 'idle', stateDur = think
idle: 플레이어 쪽으로 turnRate 회전(a면 회전 없음). 제자리.
idle 종료(또는 chase 중 0.3초마다) → select():
  0. player.state === 'dead' 또는 fight.phase !== 'fight' → idle 유지(공격하지 않는다)
  1. hooks.forceAttack?.(ctx) 가 id를 주면 그 공격
  2. 후보 = sel이 있는 공격 중:
       minPhase ≤ phase ≤ maxPhase && cooldowns[id] === 0
       && minRange ≤ d ≤ maxRange            (d = 중심 간 거리)
       && minAngle ≤ |a| ≤ maxAngle          (a = angleDiff(boss.facing, 플레이어 방향))
  3. 가중치 = sel.weight × (id === lastAttacks[0] ? 0.3 : 1) × (id === lastAttacks[1] ? 0.6 : 1)
  4. hooks.adjustWeights?.(ctx, cands)
  5. 후보가 있으면 rng 가중 추첨 → 공격 시작(cooldowns[id] = sel.cooldown, lastAttacks 갱신, chaseTime = 0)
  6. 없으면 state 'chase'(stateDur = 0.3초 — 재선택 간격). chaseTime ≥ 3.0초면 def.fallbackAttack을 거리 · 쿨다운 무시하고 시작
chase: moveIntent =
         d > preferredRange + 1            → 'approach' (플레이어 쪽으로 moveSpeed)
         def.kite && d < preferredRange×0.6 → 'retreat'  (반대로 moveSpeed)
         그 외                              → 'strafe'   (strafeDir 방향 원운동, moveSpeed×0.6. 1.5~3초마다 방향 재추첨)
       항상 플레이어 쪽으로 turnRate 회전. stride마다 BOSS_STEP.
```

- 쿨다운은 매 틱(히트스톱 제외) 감소. 2페이즈 `moveSpeed × phase2.moveSpeedMul`.
- (W3 확정) **걸으며 고민**(위 b)은 W1의 「보스가 선호 거리 밖에서도 제자리에서 돌기만 한다」를 고친 것이다 — 후보 공격이 늘 있는 보스는 `chase`에 들어갈 일이 없어 한 발짝도 걷지 않았다(봇 대전에서 걷는 시간 0%). 이제 발더 · 펜리르는 멀어진 플레이어에게 고민하는 동안 걸어 들어오고(걷는 시간 3~7%), kite 보스(니힐)는 6m 안으로 들어온 플레이어에게서 물러난다(10~12%). `chaseTime`은 고민하며 걸은 시간도 센다(공격을 시작하면 0). 뷰는 종전대로 `state === 'chase'`와 `moveIntent`로 걸음을 그린다. 니힐의 훅이 따로 하던 kite(`ext.kiteT`)는 없앴다(§8.12).
- **연속기**: 후딜 `chain[i].at`에 도달하면 `chain`을 순서대로 본다 — `(maxRange 없음 || d ≤ maxRange)` && `rng.chance((phase === 2 ? chanceP2 : chance) + scaling.chainBonus)`인 첫 항목으로 넘어간다(남은 후딜 버림 · `chained = true` · 쿨다운 무시). 연속기는 최대 3번까지 이어진다.
  - (W1 확정) **그 페이즈의 확률이 0인 항목에는 `chainBonus`를 더하지 않는다**(0 = 「그 페이즈에는 없다」) — 순환이 올라도 2페이즈 전용 연속기(`chance 0 / chanceP2 > 0`)가 1페이즈에 새지 않는다. 0보다 큰 항목은 식 그대로다. `chain[].at`은 배속을 받지 않는 초다. 연속기 판정은 플레이어가 살아 있고 `fight.phase === 'fight'`일 때만 한다. 쿨다운 · `lastAttacks`는 공격이 시작되는 **모든 경로**(AI 선택 · `forceAttack` · fallback · 연속기)에서 갱신한다.
  - (W1 확정) `select()` 0단계는 `player.hp <= 0`도 사망으로 본다. `state.fight`가 null이면(손수 만든 상태) 교전 중으로 본다. `forceAttack`은 선택 시점(idle 끝 · chase의 0.3초마다)에만 불리고 없는 id는 무시한다. `adjustWeights`는 후보가 비어 있어도 불리고 후보를 추가해도 된다. `onTick`은 `dead`를 포함해 매 틱 불린다. `onAttackEnd` 때 `boss.attack`은 이미 null이다.
  - (W1 확정) `BOSS_AI`에 이름이 늘었다(값은 본문의 숫자 그대로): `teleportTries` · `validate.{windupMin, recoveryMin, hitEndEps, minDamagingP1, rangeMax, preferredBand}`.

### 8.7 체간 · 패링 · 그로기 · 처형 · 페이즈 · 사망

- **폴링**: `updateBoss`는 매 틱 HP와 체간을 직접 본다 — `hp <= 0 && state !== 'dead'`면 사망 처리, `phase === 1 && hp ≤ hpMax × phase2.hpFrac`면 `pendingPhase = true`, `posture ≥ postureMax`이고 `groggy · executed · recover · phaseShift · dead`가 아니면 공격을 중단하고 `groggy`. `onBossDamaged` · `onBossParried`는 같은 처리를 그 자리에서 즉시 할 뿐이다(중복 무해). 디버그의 `debugSetBossHpFraction`과 투사체 패링(§6.4 규칙 3 — `onBossParried`를 부르지 않는다)이 이 경로로 반영된다.
- **체간 감쇠**: `postureIdle ≥ postureDecayDelay`면 초당 `postureDecayRate` 감소(그로기 중 제외).
- **패링당함** `onBossParried`: 공격 중단 → `posture ≥ postureMax`면 `groggy`, 아니면 `parried`(`parriedDur`) → `idle`.
- **체간 붕괴** `onBossDamaged`에서 `result.postureBroken`: 공격 중단 → `groggy`(`groggyDur`) · `BOSS_GROGGY{on:true}`. 그로기 동안 체간은 가득인 채 고정, 회전/이동 없음. `player.state === 'execute'`인 동안 그로기 타이머는 멈춘다.
- (W5 확정) **체간 잠금**: `recover`에 들어갈 때(처형 뒤 · 그로기의 자연 종료) `boss.postureGuard = true`, **그 뒤 첫 공격의 판정이 시작되는 틱**(`BOSS_ATTACK_ACTIVE`를 내는 틱 — 판정이 없는 공격도 `tA = 0`에서)에 false. 잠겨 있는 동안 체간은 쌓이지 않는다(§6.4 규칙 4 — 패링 체간 포함. 그 첫 공격을 패링한 체간은 쌓인다: 판정 시작 틱에 먼저 풀린다). 일어난 보스가 공격 한 번 못 하고 다시 그로기가 되는 일이 없다. 뷰 · UI가 읽어도 된다(체간 바의 잠금 표시).
- **처형 타격** `result.execute`: `executed`(`executedDur`, `invulnerable = true`) → `recover`(`recoverDur`) → `idle`. `posture = 0`. 처형 없이 그로기가 끝나도 `recover` → `idle`, `posture = 0`. **`groggy`를 벗어나는 모든 경로(처형 · 자연 종료 · 사망)에서 `BOSS_GROGGY{on:false}`를 낸다**(머리 위 표식이 남지 않게).
- **페이즈 전환**: `phase === 1 && hp ≤ hpMax × phase2.hpFrac` → `pendingPhase = true`. `idle/chase`에 있거나, 공격 후딜이 끝나거나(연속기보다 우선), `parried/recover`가 끝나는 순간 `phaseShift`(`phaseShiftDur`, `invulnerable = true`) 진입 · `BOSS_PHASE_CHANGED` · `phase = 2` · `posture = 0` · `dmgMul`/`speedMul` 갱신 · `hooks.onPhaseChange`. 0.6초에 `BOSS_CUE{cue:'roar'}` + 흔들림 `[0.3, 0.6]`. 끝나면 `idle`.
- **사망**: `result.lethal` → 즉시 `dead`(공격 중단, `invulnerable = true`). 사망은 다른 모든 전이보다 우선한다.
- **인트로**: `intro`(`introDur`, `invulnerable = true`, 0.5초에 `roar` 큐) → `idle`.
- 공격 중단 시 `BOSS_ATTACK_END{interrupted:true}`. 보스는 일반 피격으로는 경직되지 않는다(슈퍼아머).
- `boss.dmgMul = scaling.dmgMul × (phase === 2 ? phase2.dmgMul : 1)` · `boss.speedMul = scaling.speedMul × (phase === 2 ? phase2.speedMul : 1)` · `thinkMul = scaling.thinkMul × (phase === 2 ? phase2.thinkMul : 1)`.

### 8.8 확장 지점과 스텁

- 훅(`BossHooks`): `onCreate` · `onTick` · `adjustWeights` · `forceAttack` · `onAttackStart` · `onAttackEnd` · `onTimelineEvent` · `onPhaseChange`. 훅은 `ctx.state.boss.ext`에 자기 필드를 둔다(순수 값만).
- 훅이 해도 되는 것: `boss.ext` · `boss.y` · `boss.cooldowns` 쓰기, `ctx.spawn*` · `ctx.emit(EV.BOSS_CUE, …)` · `ctx.shake` 호출. 하면 안 되는 것: 플레이어 상태 쓰기, `boss.state/attack` 직접 바꾸기(공격을 바꾸려면 `forceAttack`).
- **스텁 보스 정의**(P0이 `valder.js · fenrir.js · nihil.js`에 넣는 자리 표시): §8.10~8.12 머리 표의 값 + 공격 하나 `stub_swipe`(`sel 0~6m · weight 1 · cooldown 0`, `windup 0.8 · active 0.15 · recovery 1.2`, `arc r 4 / half 1.2 · damage 20 · G P`, pose `'slashR'`, glow `'none'`, `track {turnRate 4, lockLead 0.15}`, `move null · events [] · chain []`, `fallbackAttack 'stub_swipe'`). → 웨이브 1에서도 세 보스 모두 보스전이 돈다(스텁 정의는 `validateBossDef` 규칙 6을 통과하지 않는다 — 검사 대상은 완성된 정의뿐이다).

### 8.9 `validateBossDef` 규칙 (P3 · P10 · P11의 테스트가 호출)

1. 머리 필드가 전부 있고 유한한 수다. `hp > 0`, `think[0] ≤ think[1]`.
2. 공격마다: `windup ≥ 0.45`, `active ≥ 0`, `recovery ≥ 0.3`. `id`가 키와 같다. `pose`가 문자열.
3. `hits[]`: `0 ≤ t0 < t1 ≤ active + 1e-6`, `damage > 0`, 셰이프 필드가 타입에 맞다. `events[]`의 `hazard`는 `shape`와 `grow` 중 **정확히 하나**가 있다. `proj` · `hazard`의 필수 필드(§3.6)가 전부 있다. **(W1 확정 — P10 · P11 주의)** `validateBossDef`는 §3.5 · §3.6의 필수 필드를 **전부** 요구한다: `hits[]`의 `interval` · `guardable` · `parryable` · `knockdown` · `telegraph`, `hazard`의 `interval` · `guardable` · `knockdown`, `proj`의 전 필드. §8.11 · §8.12 표에 생략된 값(`interval: 0` · `telegraph: false` 등)도 데이터에는 명시한다.
4. 음수 오프셋(`move.t0` · `aimLock` · `events[].t` · `−lockLead`)의 절댓값 ≤ `windup × 0.75`.
5. `chain[].next`와 `fallbackAttack`이 존재하는 공격이다.
6. 피해를 주는 공격(히트 · 투사체 · 장판 중 하나라도)이 1페이즈에 2개 이상 선택 가능하다. `[0, 20]m` 거리 중 1페이즈에서 **어떤 공격도 고를 수 없는 구간**이 `preferredRange` 근처(±1m)에 걸치지 않는다.
7. `cue` 값이 §4.2의 큐 어휘 안에 있다. `hazard.kind` · `proj.kind`가 부록 A에 있다.
8. `bodyParts`가 있으면 원소마다 `r > 0`이고, `fwd === 0`인 원이 하나 이상 있다(중심 원).

**glow 규칙(데이터 작성 규칙 — 표의 glow 열이 정본이고 검사 대상은 아니다)**: `'danger'`(붉은 발광 + §9.7의 경고 표식)는 **"패링 불가 — 구르거나 막아라"** 신호다. 직접 타격(`hits`)이 있고 그 타격이 `parryable: false`인 근접 · 돌진 · 도약 공격에 쓴다. 패링 가능한 공격에는 절대 쓰지 않는다. 브레스 · 광선 · 장판 시전은 보스 대표 색, 평범한 패링 가능 근접 공격은 `'none'`이다.

### 8.10 보스 1 — 잿빛 기사 발더 `valder` (P3)

| 필드 | 값 | 필드 | 값 |
|---|---|---|---|
| rig | humanoid | arenaId | `arena_valder` |
| style | fire | hp | **1400** |
| postureMax | 100 | postureDecayDelay / Rate | 5.0 / 6 |
| radius | 0.8 | height | 2.7 |
| moveSpeed | 3.2 | turnRate | 3.5 |
| preferredRange | 3.2 | kite | false |
| stride | 1.6 | think | [0.55, 0.95] |
| introDur | 1.6 | parriedDur | 1.0 |
| groggyDur | 5.0 | executedDur / recoverDur | 1.2 / 0.8 |
| phaseShiftDur | 2.6 | phase2 | hpFrac 0.5 · speedMul 1.12 · dmgMul 1.15 · thinkMul 0.7 · moveSpeedMul 1.2 |
| fallbackAttack | `thrust_charge` | reward | **1200** |

`ext`: `{enchanted: boolean}` — `valderHooks.onPhaseChange`가 true로 하고 `enchant` 큐를 낸다(view가 대검에 불을 붙인다).

**선택 · 타이밍** (거리 m, 각 rad, 시간 초. `G` 가드 가능 · `P` 패링 가능 · `K` 넉다운 · `T` 바닥 표식)

| id | pose | glow | 거리 | 각 | 가중 | 쿨 | 페이즈 | windup | active | recovery | turnRate / lockLead |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `slash_r` | slashR | none | 0~4.6 | ≤ 1.2 | 3 | 0 | 1~2 | 0.70 | 0.15 | 1.00 | 4.5 / 0.15 |
| `slash_l` | slashL | none | (연속기 전용) | | | | | 0.50 | 0.15 | 1.10 | 5.0 / 0.15 |
| `overhead` | overhead | none | 0~**4.5** | ≤ 0.7 | 2 | 4 | 1~2 | 0.95 | 0.12 | 1.40 | 4.0 / 0.18 |
| `thrust_charge` | thrust | danger | **5**~14 | ≤ 0.6 | 3 | 6 | 1~2 | 0.85 | 0.40 | 1.30 | 3.5 / 0.22 |
| `leap_slam` | leap | danger | **6**~16 | ≤ 1.2 | 2 | 8 | 1~2 | 1.10 | 0.15 | 1.50 | 4.0 / 0.35 |
| `spin_slash` | spin | none | 0~**3.5** | ≥ **1.2** | 6 | 2.5 | 1~2 | 0.60 | 0.18 | 1.10 | 0 / 0 |
| `fire_wave` | slamGround | fire | 0~10 | 전부 | 2.5 | 9 | 2 | 1.00 | 0.12 | 1.60 | 3.0 / 0.25 |
| `delayed_cleave` | delayed | fire | 0~5.0 | ≤ 1.3 | 2.5 | 5 | 2 | 1.45 | 0.15 | 1.20 | 6.0 / 0.12 |
| `ember_burst` | cast | fire | **6.5**~20 | 전부 | 2 | 7 | 2 | 0.90 | 0.70 | 1.20 | 3.0 / 0.20 |

(W3 확정 — 선택 조건 넷) `thrust_charge` 6 → 5m: 1페이즈의 5~6m 거리 공백을 메웠다. `spin_slash` 각 1.4 → 1.2: `slash_r`(≤ 1.2)와의 옆구리 공백을 메웠다. `leap_slam` 7 → 6m · `ember_burst` 8 → 6.5m: 보스가 걸어 들어오게 되어(§8.6) 먼 거리가 유지되는 시간이 줄었다 — 물러나 회복하는 플레이어에게 도약 · 불기둥이 나올 거리를 남겼다.

**판정 · 이동 · 이벤트 · 연속기**

| id | hits | move | events | chain |
|---|---|---|---|---|
| `slash_r` | arc r**3.3** half1.22 · 0~0.15 · **19** · G P | lunge −0.20~0.05 · 1.4m | cue `whoosh` @−0.15 | `slash_l` 0.45 / 0.70 @0.30 (≤ **4.8**m) |
| `slash_l` | arc r**3.6** half1.31 · 0~0.15 · **21** · G P | lunge −0.18~0.05 · 1.2m | cue `whoosh` @−0.15 | `overhead` 0.30 / 0.55 @0.30 (≤ **4.5**m) |
| `overhead` | cap 0.6→**2.8** r0.9 · 0~0.12 · **30** · G P K | lunge −0.15~0 · 0.8m | cue `slam` @0 shake [0.20, 0.25] · (2페이즈) hazard `fire_trail` @0.05 place self: cap 1.0→9.0 r0.9 · warn 0.35 · active 1.0 · interval 0.4 · **8** · G | — |
| `thrust_charge` | cap 0→3.4 r0.8 · 0~0.40 · **24** · G · T(telegraphShape cap 0→13.4 r0.8) | charge 0~0.40 · 10m | cue `charge_start` @0 | — |
| `leap_slam` | circle r3.2 fwd1.6 · 0~0.15 · **31** · G K · T(telegraphAt aim, telegraphShape circle r3.2) | leap −0.60~0 · 14m · stopShort 1.6 · height 3.0 · aimLock −0.35 | cue `land` @0 shake [0.35, 0.40] · (2페이즈) hazard `shockwave` @0 place self: grow 2→10 width 1.0 · warn 0 · active 0.8 · **16** · G | — |
| `spin_slash` | circle r**3.3** · 0~0.18 · **18** · G P | — | cue `whoosh` @−0.15 | — |
| `fire_wave` | circle r2.8 fwd1.2 · 0~0.12 · **23** · G K · T | — | cue `slam` @0 shake [0.30, 0.35] · hazard `shockwave` @0 place self: grow 1.5→12 width 1.1 · warn 0 · active 1.0 · **19** · G | — |
| `delayed_cleave` | arc r**3.4** half1.4 · 0~0.15 · **33** · G P K | lunge −0.18~0.05 · 1.6m | cue `whoosh` @−0.15 | — |
| `ember_burst` | (없음) | — | cue `cast` @−0.6 · hazard `fire_pillar` @0 place chase count 3 interval 0.35 lead 0.25: circle r2.0 · warn 0.8 · active 0.2 · **19** · G | — |

(W3 확정 — 피해) 굵은 수는 W1 값의 약 0.87배다: 22 · 24 · 34 · 9 · 28 · 36 · 18 · 20 · 26 · 22 · 38 · 22 → 19 · 21 · 30 · 8 · 24 · 31 · 16 · 18 · 23 · 19 · 33 · 19.

(W5 확정 — 근접 판정 = 보이는 칼) 표식(`T`)이 없는 근접 공격의 판정을 **보이는 칼끝의 최대 도달 + 약 0.35m**로 줄였다(칼끝은 뷰의 `weaponTip` 소켓으로 쟀다 — 보스 중심 기준 수평 거리): `slash_r` 4.2 → 3.3(칼끝 2.93) · `slash_l` 4.2 → 3.6(3.23) · `overhead` 끝 5.9 → 3.7(3.38) · `spin_slash` 4.0 → 3.3(2.89) · `delayed_cleave` 4.6 → 3.4(3.01). 종전에는 칼끝에서 1.3~2.5m 떨어진 플레이어가 맞았다(거리로 피하는 학습이 성립하지 않았다). 선택 거리 · 연속기 거리는 「전진 + 판정 + 플레이어 반경 0.4 ≥ 거리」가 되게 함께 줄였다(`overhead` 5.0 → 4.5 · `spin_slash` 4.0 → 3.5 · 연속기 5.5 → 4.8 · 4.5). 표식이 있는 공격(`thrust_charge` · `leap_slam` · `fire_wave`)은 표식이 판정이라 그대로다. `test/regress.w5.test.js`가 「판정 ≤ 보이는 도달 + 0.7m」를 뷰의 메시로 재서 단언한다 — 무기 메시나 판정을 바꾸면 함께 맞춘다.

발더의 pose 키(P5 `valderView.js`가 전부 구현): `slashR · slashL · overhead · thrust · leap · spin · slamGround · delayed · cast` + 스텁용 `slashR`.
`delayed` 포즈는 `holdAt 0.35`다 — 예고의 35% 지점에서 자세가 완성된 채 멈췄다가(가짜 정지) 마지막 0.18초에 내려친다. 예고가 길고 추적이 빠르다(구르기를 일찍 누르면 맞는다). 다른 포즈는 기본 `holdAt 0.6`이고, 모든 근접 공격은 판정 0.18초 전에 무기가 출발한다(§9.5 `releaseT`) — `whoosh` 큐(@−0.15)가 그 출발을 소리로 알린다.
붉은 발광(`danger`)인 `thrust_charge` · `leap_slam`은 패링할 수 없다(가드 · 구르기만).

### 8.11 보스 2 — 서리 송곳니 펜리르 `fenrir` (P10)

| 필드 | 값 | 필드 | 값 |
|---|---|---|---|
| rig | quadruped | arenaId | `arena_fenrir` |
| style | frost | hp | **1700** (W3 확정: 1900 → 1700) |
| postureMax | 120 | postureDecayDelay / Rate | 4.0 / 8 |
| radius | 1.3 | height | 2.4 (어깨 높이. 몸길이 5.6 — `bodyParts`가 덮는 범위와 같게 만든다) |
| bodyParts | `[{fwd: 1.9, r: 1.0}, {fwd: 0, r: 1.3}, {fwd: -1.7, r: 1.0}]` (머리 · 몸통 · 엉덩이 — 앞 2.9m ~ 뒤 2.7m) | | |
| moveSpeed | 5.5 | turnRate | 4.5 |
| preferredRange | 4.0 | kite | false |
| stride | 2.4 | think | [0.40, 0.80] |
| introDur | 1.6 | parriedDur | 0.9 |
| groggyDur | 4.5 | executedDur / recoverDur | 1.2 / 0.8 |
| phaseShiftDur | 2.6 | phase2 | hpFrac 0.5 · speedMul 1.12 · dmgMul 1.12 · thinkMul 0.7 · moveSpeedMul 1.15 |
| fallbackAttack | `charge` | reward | **2000** |

| id | pose | glow | 거리 | 각 | 가중 | 쿨 | 페이즈 | windup | active | recovery | turnRate / lockLead |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `bite` | bite | none | 0~4.4 | ≤ 0.9 | 4 | 0 | 1~2 | 0.50 | 0.12 | 0.80 | 6.0 / 0.12 |
| `bite2` | bite | none | (연속기 전용) | | | | | 0.45 | 0.12 | 1.00 | 6.0 / 0.12 |
| `claw_swipe` | claw | none | 0~**4.4** | ≤ 1.4 | 3 | 2 | 1~2 | 0.60 | 0.15 | 0.95 | 5.0 / 0.15 |
| `tail_sweep` | tail | danger | 0~**4.5** | ≥ 1.7 | 6 | 2 | 1~2 | 0.65 | 0.20 | 1.00 | 0 / 0 |
| `charge` | charge | danger | 7~**17** | ≤ 0.6 | 3 | 5 | 1~2 | 0.90 | 0.55 | 1.40 | 4.0 / 0.22 |
| `pounce` | pounce | danger | 5~13 | ≤ 1.2 | 3 | 6 | 1~2 | 0.80 | 0.15 | 1.20 | 5.0 / 0.30 |
| `frost_breath` | breath | frost | 3~**9** | ≤ 0.8 | 2 | 9 | 1~2 | 1.10 | 1.40 | 1.30 | 4.0 / 0.20 · activeTurnRate 0.9 |
| `backhop` | hop | none | 0~3.5 | 전부 | 1.5 | 7 | 1~2 | 0.45 | 0.35 | 0.30 | 5.0 / 0 |
| `ice_spikes` | howl | frost | 0~24 | 전부 | 2.5 | 10 | 2 | 1.00 | 0.30 | 1.20 | 3.0 / 0.20 |

| id | hits | move | events | chain |
|---|---|---|---|---|
| `bite` | arc r3.8 half0.7 · 0~0.12 · 24 · G P | lunge −0.15~0.05 · 1.8m | cue `whoosh` @−0.15 | `bite2` 0.50 / 0.70 @0.25 (≤ 6m) |
| `bite2` | arc r3.8 half0.7 · 0~0.12 · 22 · G P | lunge −0.15~0.05 · 2.2m | cue `whoosh` @−0.15 | `tail_sweep` 0.25 / 0.50 @0.30 (≤ **4.5**m) |
| `claw_swipe` | circle r**2.1** fwd**1.3** · 0~0.15 · 26 · G P | lunge −0.15~0.05 · 1.0m | cue `whoosh` @−0.15 | `bite` 0 / 0.50 @0.30 (≤ 6m) |
| `tail_sweep` | arc r**4.3** half1.75 dirOffset π · 0~0.20 · 24 · G | — | cue `whoosh` @−0.15 | — |
| `charge` | cap −0.5→2.6 r1.4 · 0~0.55 · 32 · G K · T(telegraphShape cap 0→15.8 r1.4) | charge 0~0.55 · 13.2m | cue `charge_start` @0 · (2페이즈) hazard `ice_spike` @0.55 place self: cap −13→0 r1.2 · warn 0.5 · active 0.3 · 20 · G (달려온 궤적을 따라 가시가 솟는다) | — |
| `pounce` | circle r3.0 fwd1.8 · 0~0.15 · 34 · G K · T(telegraphAt aim, telegraphShape circle r3.0) | leap −0.50~0 · 12m · stopShort 1.8 · height 2.4 · aimLock −0.30 | cue `land` @0 shake [0.30, 0.35] · (2페이즈) hazard `ice_spike` @0.05 place ringAround count 6 radius 4.5: circle r1.4 · warn 0.6 · active 0.25 · 20 · G | — |
| `frost_breath` | arc r9.0 rInner1.0 half0.5 · 0~1.40 · interval 0.35 · 11 · G · T | — | cue `breath_start` @0 params {length 9, halfAngle 0.5, socket 'mouth'} · (2페이즈) hazard `ice_spike` @0.70 place scatter count 4 radius 5 (`ice_spikes`와 같은 spec) · cue `breath_end` @1.40 | — |
| `backhop` | (없음) | hop 0~0.35 · 6m · height 1.2 | — | `charge` 0.40 / 0.30 @0.10 · `frost_breath` 0.30 / 0.40 @0.10 |
| `ice_spikes` | (없음) | — | cue `howl` @−0.6 shake [0.20, 0.50] · hazard `ice_spike` @0 place scatter count 6 radius 7: circle r1.8 · warn 0.9 · active 0.25 · 26 · G · cue `shatter` @0.9 | — |

(W3 확정) `charge`의 선택 거리 18 → 17m(판정이 닿는 거리는 17.2m다) · `frost_breath` 10 → 9m(부채꼴이 닿는 거리는 9.4m다) — 끝자락의 서 있는 플레이어 앞에서 헛치고 멈추던 것을 없앴다(`NOTES-P10` #1 · #2). `tail_sweep`은 §8.6의 「뒤를 잡혔다」 규칙으로 나온다(봇 대전에서 3~7%. 발더 `spin_slash`는 9~17%).

(W5 확정 — 근접 판정 = 보이는 몸) `claw_swipe`: 부채꼴 r4.4 ±80° → **가슴 앞의 원**(중심 앞 1.3m · r 2.1 — 앞 3.4m · 옆 2.1m. 보이는 몸은 앞 3.0m · 옆 1.5m). 종전에는 코에서 57° 비켜 선 4.5m의 플레이어가 빈 얼음 너머에서 맞았다. 옆구리(1.2 rad · 2.6m)에는 여전히 닿는다(물기는 닿지 않는다). `tail_sweep` r 5.2 → 4.3(보이는 꼬리 끝 3.9m). 선택 거리 4.8 → 4.4 · 5.2 → 4.5, `bite2 → tail_sweep` 연속기 5 → 4.5m.

`ext`: P10 재량(예: 연속 백홉 방지 카운터). pose 키: `bite · claw · tail · charge · pounce · breath · hop · howl`(뷰도 P10이므로 자유롭게 조정 가능).
성격: 주기가 짧고(고민 0.6 + 예고 0.5~0.65) 사거리 밖으로 자주 빠진다 — **거리 조절과 뒤를 잡지 않는 위치 선정**이 핵심. 붉은 발광(`danger`)인 `tail_sweep` · `charge` · `pounce`는 패링할 수 없다.
2페이즈의 차이: `ice_spikes`(신규) · `pounce` 착지 가시 고리 · `charge` 궤적 가시 · `frost_breath` 도중의 가시 4개 · `claw_swipe → bite` 연속기 — 얼음 가시 장판이 거의 모든 큰 공격에 따라붙는다.
`bodyParts`는 P2만 쓴다(플레이어 타격의 명중 · 몸통 밀어내기). 펜리르 자신의 공격 셰이프 원점 · `stopShort` · AI 거리 · 월드 충돌은 `pos`/`radius` 그대로다. 사족 리그는 머리 끝이 앞 2.9m · 엉덩이 끝이 뒤 2.7m를 넘지 않게 만든다(보이는 몸 = 맞는 몸).

### 8.12 보스 3 — 심연의 군주 니힐 `nihil` (P11)

| 필드 | 값 | 필드 | 값 |
|---|---|---|---|
| rig | floater | arenaId | `arena_nihil` |
| style | void | hp | **2800** (W3 확정: 2400 → 2800) |
| postureMax | 90 | postureDecayDelay / Rate | 8.0 / 5 |
| radius | 0.8 | height | 2.8 (부유 높이 0.8 포함) |
| moveSpeed | 2.6 | turnRate | 5.0 |
| preferredRange | 10 | kite | **true** |
| stride | 0 (발소리 없음) | think | [0.60, 1.00] |
| introDur | 1.6 | parriedDur | 1.0 |
| groggyDur | 5.0 | executedDur / recoverDur | 1.2 / 0.8 |
| phaseShiftDur | 2.6 | phase2 | hpFrac 0.5 · speedMul 1.10 · dmgMul 1.12 · thinkMul 0.6 · moveSpeedMul 1.2 |
| fallbackAttack | `void_orbs` | reward | **3000** |

| id | pose | glow | 거리 | 각 | 가중 | 쿨 | 페이즈 | windup | active | recovery | turnRate / lockLead |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `void_orbs` | castOrbs | void | 5~22 | 전부 | 3 | 3 | 1~2 | 0.90 | 0.60 | 1.10 | 5.0 / 0.10 |
| `blink` | blink | void | 0~4.5 | 전부 | 4 | 5 | 1~2 | 0.45 | 0.10 | 0.40 | 0 / 0 |
| `beam_sweep` | beam | void | 4~22 | ≤ 1.0 | 2 | 8 | 1~2 | 1.20 | 1.50 | 1.40 | 5.0 / 0.25 · sweep −0.95→0.95 |
| `ground_burst` | castGround | void | 0~22 | 전부 | 3 | 6 | 1~2 | 0.80 | 1.00 | 1.00 | 5.0 / 0.10 |
| `sword_rain` | castSky | void | 0~22 | 전부 | 2 | 12 | 1~2 | 1.10 | 2.00 | 1.20 | 5.0 / 0.10 |
| `void_nova` | nova | danger | 0~4.8 | 전부 | 3 | 6 | 1~2 | 0.85 | 0.15 | 1.50 | 0 / 0 |
| `scythe_slash` | scythe | none | 0~**4.0** | ≤ 1.4 | 2.5 | 2 | 1~2 | 0.60 | 0.15 | 1.10 | 5.0 / 0.15 |
| `blink_strike` | blink | void | 6~22 | 전부 | 2.5 | 9 | 2 | 0.50 | 0.10 | 0.30 | 0 / 0 |
| `cataclysm` | castSky | void | 0~22 | 전부 | 1.5 | 16 | 2 | 1.30 | 2.40 | 2.00 | 5.0 / 0.10 |

| id | hits | move | events | chain |
|---|---|---|---|---|
| `void_orbs` | (없음) | — | cue `cast` @0 · projectile `void_orb` @0 count 3 interval 0.25 spread 0.5 origin {fwd 0.8, side 0} · (2페이즈) projectile `void_orb` @0.12 count 2 interval 0.25 spread 0.9 | `beam_sweep` 0 / 0.50 @0.40 |
| `blink` | (없음) | — | cue `blink_out` @−0.05 · teleport @0 to away dist 11 · cue `blink_in` @0.02 | `void_orbs` 0.50 / 0.30 @0.10 · `ground_burst` 0.30 / 0.40 @0.10 |
| `beam_sweep` | cap 1.0→22 r0.6 · 0~1.50 · **36** · G · T(telegraphShape arc r22 rInner1.0 half0.95 — 쓸리는 부채 전체, §8.3) | — | cue `beam_start` @0 params {length 22, width 1.2, socket 'handL'} · cue `beam_end` @1.50 | — |
| `ground_burst` | (없음) | — | cue `cast` @0 · hazard `void_burst` @0 place chase count 3 interval 0.45 lead 0.3: circle r2.6 · warn 0.9 · active 0.2 · **36** · G K | — |
| `sword_rain` | (없음) | — | cue `cast` @0 · hazard `void_sword` @0 place scatter count 10 interval 0.2 radius 6: circle r1.3 · warn 0.7 · active 0.15 · **24** · G | — |
| `void_nova` | circle r5.0 · 0~0.15 · **34** · G K · T | — | cue `slam` @0 shake [0.30, 0.35] | — |
| `scythe_slash` | arc r**3.0** half1.4 · 0~0.15 · **29** · G P (W5 확정: r 4.0 → 3.0 — 보이는 낫 끝 2.7m) | lunge −0.15~0.05 · 1.0m | cue `whoosh` @−0.15 | — |
| `blink_strike` | (없음) | — | cue `blink_out` @−0.05 · teleport @0 to behindTarget dist 2.5 · cue `blink_in` @0.02 | `void_nova` 1 / 1 @0.05 |
| `cataclysm` | (없음) | — | cue `roar` @−0.8 · hazard `void_sword` @0 place scatter count 12 interval 0.2 radius 7 (위와 같은 spec) · hazard `void_burst` @0.3 place chase count 4 interval 0.6 lead 0.3 (위와 같은 spec) | — |

(W3 확정 — 피해) 굵은 수와 구체의 피해는 W1 값의 약 1.2배다: 30 · 30 · 20 · 28 · 24 · 구체 18 → 36 · 36 · 24 · 34 · 29 · 구체 22. 같은 프로필 · 같은 봇이 받는 피해가 초당 3.6으로 셋 중 가장 낮았다(발더 5.3 · 펜리르 4.4).

투사체 `void_orb`: `speed 9 · r 0.45 · life 5 · homing 2.2 · homingTime 2.5 · damage 22 · guardable true · parryable true · knockdown false · y 1.4 · style void`. 구체를 패링하면 사라지고 니힐에 체간 `parryPosture × 0.5`(기본 15)가 쌓인다(§6.4 규칙 3) — 원거리 보스에게 체간을 쌓는 주 수단이다(체간 90 = 구체 6개. 감쇠 지연이 8초로 길어 구체 사이에 깎이지 않는다).
`ext`: `{hoverY: 0.8, crowdT: number}` — `nihilHooks.onTick`이 `boss.y = hoverY`로 두고, 플레이어가 3.5m 안에 1.5초 넘게 붙어 있으면 `forceAttack`이 `blink`(쿨다운이 0일 때) 또는 `void_nova`를 낸다. 훅이 쓰는 수치는 `data/bosses/nihil.js`에 `export const NIHIL_EXT = { hoverY: 0.8, crowdRange: 3.5, crowdTime: 1.5 }`로 둔다(훅 파일에 숫자를 박지 않는다 — 펜리르의 훅 수치도 같은 방식으로 `FENRIR_EXT`).
(W3 확정) **거리 벌리기(kite)는 프레임워크가 한다** — 고민하는 동안 플레이어가 `preferredRange × kiteNear`(6m) 안이면 물러나고, 11m 밖이면 떠서 다가온다(§8.6 「걸으며 고민」). W2의 P11은 프레임워크의 `chase`가 후보가 없을 때만 들어가서(니힐은 늘 후보가 있다 — chase 0%) 훅으로 우회했다(`ext.kiteT` · `NIHIL_EXT.kiteRange/kiteTime`). 프레임워크가 같은 일을 하게 되어 훅의 kite는 없앴다(둘 다 두면 공격 사이의 빈 시간이 두 배가 된다). 구체는 유도가 강해 옆으로 굴러서는 둘째 구체를 피하지 못한다 — **가드**(스태미나 구체당 약 20) 또는 패링이 답이다(봇도 가드로 받는다 — §12.3).
성격: 긴 후딜(1.0~2.0초)은 **멀리서** 생긴다 — 장판 사이를 달려 들어가 1~2타 넣고 `void_nova` 예고(붉은 발광 `danger` — 패링 불가)를 보면 빠진다. 기둥은 구체를 막는 엄폐물이다.

---

## §9 view 계약 (P5 · P6 · P7 · P10 · P11)

### 9.1 공통

- view는 `GameState`를 **읽기만** 한다. 상태 객체에 필드를 붙이거나 고치지 않는다. 뷰 쪽 기억은 자기 객체에 둔다.
- 모든 레이어의 모양: `constructor(deps)` · `update(state, alpha, dt)` · `dispose()`. `dt`는 렌더 프레임 시간(초, 일시정지면 0). `alpha`는 §5.4의 보간 계수.
- 레이어는 필요한 이벤트를 **스스로 구독**한다(app이 이벤트를 중계하지 않는다). `MODE_CHANGED`에서 자기 것을 정리/교체한다.
- **이벤트 누락에 안전해야 한다**: 레이어 생성자는 월드 · 보스 뷰를 전부 숨긴 채 시작하고, 첫 `MODE_CHANGED`(부팅 끝의 `sim.enterTown()` — §11.1) 전의 `update`도 예외 없이 돈다. `update(state, …)`에서 `state.mode` · `state.world.id` · `state.boss?.id`가 자기 캐시와 다르면 `MODE_CHANGED`를 받은 것과 같은 전환을 스스로 한다(최소 부트 · 디버그 경로에서 이벤트 없이 상태만 바뀌어도 화면이 따라온다).
- 씬 그래프: `rc.scene` 아래 레이어마다 자기 `THREE.Group` 하나 — `worldRoot`(P6) · `charRoot`(P5) · `fxRoot`(P7). 남의 그룹에 자식을 넣지 않는다.
- sim → three 변환: 위치 `(x, y표현, z)` 그대로, 회전 `rotation.y = facing`. 모델은 **+Z가 앞**.
- 발광(블룸에 걸릴 것): `MeshStandardMaterial.emissive` + `emissiveIntensity ≥ 2`, 또는 `MeshBasicMaterial`에 1을 넘는 HDR 색(`toneMapped: false`). 블룸 임계값은 P6이 약 0.9로 둔다.
- 그림자: 캐릭터 · 기둥은 `castShadow`, 바닥은 `receiveShadow`. 그림자 광원은 P6의 방향광 1개뿐. fx의 점광원(풀 3개 이하)은 그림자 없음.
- 외부 에셋 0 — 지오메트리 조합 · 캔버스/셰이더 텍스처만.

### 9.2 렌더러 · 후처리 — `view/renderer.js` (P6)

```js
/** @returns {RenderContext} */
export function createRenderContext(canvas, settings)

/** @typedef {Object} RenderContext
 * @property {THREE.WebGLRenderer} renderer   ACESFilmic 톤매핑 · sRGB 출력 · PCF 그림자(W1 확정: three r186에서 PCFSoftShadowMap이 제거됐다 — PCFShadowMap을 쓴다)
 * @property {THREE.Scene} scene              배경 PALETTE.bg · FogExp2
 * @property {THREE.PerspectiveCamera} camera fov 60 · near 0.1 · far 200
 * @property {(q:'low'|'medium'|'high')=>void} setQuality
 * @property {(w:number, h:number)=>void} resize
 * @property {(dt:number)=>void} render       후처리 포함 한 프레임
 * @property {()=>void} dispose
 */
```

후처리 체인: RenderPass → UnrealBloomPass → (W1 확정: 비네트 ShaderPass →) OutputPass(`three/addons/postprocessing/*`). **`low`는 컴포저를 쓰지 않고 직접 렌더한다**(블룸 · 비네트 · 그림자 없음) — 그래서 `ShaderMaterial`을 쓰는 레이어는 프래그먼트 끝에 `#include <tonemapping_fragment>` · `#include <colorspace_fragment>`를 넣어야 low와 medium/high의 색이 같다. `RenderContext`에는 P6 내부용 `quality`(현재 단계 이름) · `prewarm()`이 더 있다(다른 패키지는 `setQuality`만 부른다). `createRenderContext`는 `bus`를 받지 않는다 — 화질 변경은 app이 `SETTINGS_CHANGED`에서 `rc.setQuality(settings.quality)`를 부른다(§11.1).

**캔버스 크기의 주인은 렌더러다.** `createRenderContext`는 생성 시 `canvas.clientWidth/clientHeight`(index.html의 스타일로 100vw × 100vh)로 초기 크기를 잡고, `window`의 `resize`를 **스스로 구독**해 renderer · composer · `camera.aspect`를 갱신한다(`dispose`에서 해제). `resize(w, h)`는 수동 호출용으로 남긴다. app은 resize를 부르지 않는다. `fov · near · far`는 `CAMERA`(§9.4)에서 읽는다.

### 9.3 월드 — `view/world/WorldLayer.js` (P6)

```js
export class WorldLayer {
  constructor({rc, bus, settings})      // 마을 + 아레나 3종을 **부팅 때 전부 만들어** 둔다(전환 시 visible만 바꾼다 — 로딩 없음)
  update(state, alpha, dt)              // 화톳불 일렁임 · 안개문 셰이더 · 그림자 광원이 플레이어를 따라감
  dispose()
}
```

- 배치는 `data/world.js`를 그대로 읽는다(반경 · 기둥 · 시설 위치). 마을: 중앙 화톳불(불빛 점광원 + 발광), 대장간(모루 · 화로), 상인 좌판, 북쪽 안개문(반투명 셰이더 막), 허수아비 **받침대는 그리지 않는다**(허수아비 자체는 P5).
- 테마: `town` 따뜻한 잿빛 폐허 · `ember` 불타는 성채 폐허(잔불 입자 느낌의 붉은 안개) · `frost` 설원의 얼음 호수(푸른 안개 · 얼음 기둥) · `void` 심연의 제단(보라 안개 · 떠 있는 석주). 경계는 벽/절벽/안개 장막으로 **눈에 보이게** 한다.
- `BOSS_PHASE_CHANGED`에서 조명을 2페이즈 톤으로 바꾼다(대표 색 `PALETTE.style[def.style]` 쪽으로).
- 바닥은 y = 0 평면. 캐릭터 · 표식이 묻히지 않게 바닥 장식은 y ≤ 0.02.
- 화톳불 불꽃 메시는 높이 1.6m 이하로 둔다 — 부활 지점이 화톳불 바로 북쪽(§7.8)이라 카메라가 화톳불 위를 넘어 플레이어를 본다(가리지 않게).
- (W4 확정 — 화면 패스) **카메라 채움광**: 공용 조명에 그림자 없는 방향광 하나가 더 있다. 매 프레임 카메라가 보는 **수평** 방향으로 비춘다(env의 `fillColor` · `fillIntensity` — 마을 0.5 · ember 1.15 · frost 0.45 · void 0.8). 록온 카메라는 늘 보스의 정면(해를 등진 면)을 보기 때문에, 이것이 없으면 어두운 갑옷의 보스가 실루엣만 남는다. 방향이 수평이라 바닥은 거의 밝히지 않는다. 심연 제단의 바닥 룬은 텔레그래프(`PALETTE.style.void`)와 다른 색(남색 `0x3c50c8`) · 낮은 발광(0.36) · **점선 고리**다 — 표식의 실선 원과 색 · 밝기 · 모양으로 갈린다.

### 9.4 카메라 — `view/CameraRig.js` · `data/camera.js` (P6)

```js
export class CameraRig {
  constructor({camera, bus, settings})
  yaw                                   // 카메라가 보는 수평 방향(rad, §0.2). app이 이동 입력 변환에 읽는다
  pitch                                 // 양수 = 위에서 내려다봄. 자유 시점 [pitchMin, pitchMax], 록온 [lock.pitchMin, lock.pitchMax]
  update(state, alpha, dt, look)        // look = {dx, dy} 이번 프레임 마우스 이동량(픽셀). 게임패드는 app이 픽셀 상당량으로 환산
  snapBehind(facing)                    // yaw = facing, pitch = pitchDefault
  addShake(amp, dur)
  dispose()
}
```

```js
// data/camera.js (P6 · 시드)
export const CAMERA = {
  fov: 60, near: 0.1, far: 200,
  pivotY: 1.5, lookAtY: 0.2,              // 피벗 = 플레이어 발밑 + pivotY, 바라보는 점 = 피벗 + lookAtY (m)
  rotSpeed: 0.0022,                       // rad/픽셀 (× settings.mouseSensitivity)
  pitchMin: -0.45, pitchMax: 1.2, pitchDefault: 0.30,
  distTown: 4.4, distBoss: 5.0, distMin: 1.2,
  lock: { yawLambda: 8,                   // 록온 yaw 추종(damp λ)
          pitchMin: 0.15, pitchMax: 0.80, pitchEnter: 0.34, pitchLambda: 6,
          distFrom: 6, distPerMeter: 0.12, distExtraMax: 1.6,     // 보스가 멀수록 물러난다
          bossRadiusRef: 0.8, bossRadiusMul: 1.5,                 // 큰 보스일수록 물러난다
          aimBlend: 0.3 },                                        // 조준점 = 플레이어 → 보스의 30% 지점
  collide: { wallPad: 0.4, hitPad: 0.3, minY: 0.4, liftPerMeter: 0.14, liftMax: 0.5 },
};
```

- 회전(자유 시점): `yaw −= dx × rotSpeed × mouseSensitivity`, `pitch += dy × rotSpeed × mouseSensitivity × (invertY ? −1 : 1)`, `[pitchMin, pitchMax]`로 자른다.
- 위치: `pivot = 플레이어 보간 위치 + (0, pivotY, 0)`. `cam = pivot − (sin yaw, 0, cos yaw) × cos(pitchEff) × dist + (0, sin(pitchEff) × dist, 0)`. 원하는 거리 `distWanted`: 마을 `distTown` · 보스전 `distBoss`. `lookAt(pivot + (0, lookAtY, 0))`.
- **록온**(`state.player.lockOn && state.boss`):
  - 목표 yaw = 플레이어 → 보스 각. yaw는 `damp`(λ = `lock.yawLambda`)로 따라간다. 마우스 `dx`는 무시한다.
  - **pitch는 마우스 `dy`로 `[lock.pitchMin, lock.pitchMax]` 안에서 조절한다**(바닥 장판을 내려다보고 싶으면 올린다). 록온에 들어간 순간부터 `lock.pitchEnter`(0.34) 쪽으로 `damp`(λ = `lock.pitchLambda`)하다가, `dy` 입력이 한 번이라도 들어오면 그 뒤로는 사용자의 값을 유지한다.
  - `distWanted = distBoss + clamp((d − lock.distFrom) × lock.distPerMeter, 0, lock.distExtraMax) + max(0, boss.radius − lock.bossRadiusRef) × lock.bossRadiusMul` (d = 플레이어 ↔ 보스 중심 거리. 펜리르 +0.75m).
  - 조준점은 플레이어와 보스 사이 `lock.aimBlend` 지점(보간 위치 기준).
- **충돌** — 피벗 → 카메라 선분(XZ)을 검사해 `dist`를 줄인다(`core/collide.js`):
  1. 경계: 카메라 XZ가 `world.radius − collide.wallPad` 밖이면 선분이 그 원을 나가는 점까지로 줄인다.
  2. 기둥: `world.colliders`의 **원**마다 `segmentHitsCircle(pivot, cam, 원 중심, r + collide.hitPad)` — 가장 이른 교차까지로 줄인다(펜리르 · 니힐 아레나의 기둥이 시야를 막지 않는다). 상자 콜라이더는 2b에서 따로 검사한다(W4 — 종전에는 검사하지 않았다). (W1 확정: **시설 중심 · NPC 자리에 놓인 원(화톳불 · NPC 2명)은 카메라 장애물에서 뺀다** — 낮아서 위로 넘는다. 막으면 부활 직후 카메라가 `distMin`으로 등에 붙어 §9.3의 「화톳불 위를 넘어 본다」와 어긋난다. 아레나 기둥 · 안개문 기둥은 그대로 막는다.)
  2b. (W4 확정) **상자 콜라이더도 검사한다**(안개문 옆 담 · 대장간 · 좌판 — 선분 대 축 정렬 상자, `hitPad`만큼 키워서). 담은 경계 밖 구조물과 달리 바로 등 뒤에 있어 `distMin`으로도 넘는다 — 상자가 허락하는 수평 거리가 `dist × cos(pitchEff)`보다 짧으면 **수평 투영이 담 앞에서 멎을 때까지 pitch를 올린다**(상한 1.42 rad — 담을 등지면 머리 위에서 내려다본다. 화면이 벽 속으로 들어가지 않는다).
  3. `dist = max(distMin, 줄인 거리)`. **줄어든 만큼 올려다본다**: `pitchEff = pitch + min(collide.liftMax, (distWanted − dist) × collide.liftPerMeter)` — 벽을 등져도 카메라가 플레이어 등에 붙어 화면을 가리지 않고 머리 위로 올라간다. (W5 확정 — 리뷰) **줄어들 때는 속도 상한 25m/s로**(3.8m를 약 0.15초에), 다시 늘어날 때는 `damp`(λ = 6)로 부드럽게. 기둥 · 상자 모서리가 선을 스치는 순간 충돌 목표는 불연속으로 꺾인다 — 종전의 「줄어들 때는 즉시」는 그 값을 한 프레임에 넣어 화면이 3~4m 순간이동했다(펜리르전 분당 약 3회). 올려다보는 각은 이 부드러워진 `dist`로 계산한다. 2b의 담 올려다보기는 **목표 거리 기준**으로 필요한 각을 구해 8rad/s 상한으로 따라간다(내려올 때는 `damp` λ = 6). `snapBehind` 뒤 첫 `update`만 목표를 그대로 넣는다. 두 상한은 `CAMERA.collide.shrinkSpeed`(25) · `boxLiftSpeed`(8)다(W5 게이트 — 파일 상수에서 `data/camera.js`로 옮겼다. `test/camera.test.js`). `cam.y ≥ collide.minY`.
- 흔들림: `CAMERA_SHAKE`를 구독. 오프셋 = 난수 × amp × 감쇠 × `settings.cameraShake`. 겹치면 큰 쪽.
- 감도 · Y반전은 매 프레임 `settings`(app이 필드를 고치는 같은 객체)에서 읽는다.
- 연출(재량): `EXECUTE_STARTED` 줌인, `PLAYER_DIED` 느린 후퇴, `BOSS_PHASE_CHANGED` 보스 쪽으로 살짝 당김, `MODE_CHANGED`에서 `snapBehind(player.facing)`.
- (W1 확정) `MODE_CHANGED`를 받거나 `state.world.id`가 바뀌면 다음 `update`에서 스스로 `snapBehind(player.facing)` 한다. 록온 yaw는 `damp` + 각속도 상한(`lock.yawMaxSpeed`)이다. `CAMERA`에는 P6 내부용 필드(`lock.yawMaxSpeed/nearDist/aim*` · `collide.growLambda` · `distLambda` · `shake` · `fx`)가 더 있다 — 위 계약 필드의 이름 · 값은 그대로다.

### 9.5 리그 — `view/characters/rig.js` · `pose.js` (P5)

```js
export class Rig {
  root        // THREE.Group — 발밑(지면) 원점. 위치 · rotation.y는 CharacterLayer가 넣는다
  joints      // Record<string, THREE.Object3D> — 아래 표준 이름
  sockets     // Record<string, THREE.Object3D> — 부착점
  height      // m
  applyPose(pose)             // 모든 관절에 적용. 포즈에 없는 관절은 0 회전 / 0 오프셋
  setFlash(amount)            // 0..1 피격 점멸(전 재질 emissive를 흰색 쪽으로)
  setGlow(style, intensity)   // 예고 발광(강조 재질만). style: FxStyle | 'none'
  dispose()
}
export function buildHumanoidRig(opts)    // {height, bulk, palette:{armor, cloth, skin, accent}, helmet:'knight'|'hood'|'none', cape:boolean}
export function buildQuadrupedRig(opts)   // {length, shoulderHeight, palette:{fur, dark, accent}, spikes:boolean}
export function buildFloaterRig(opts)     // {height, hover, palette:{robe, trim, accent}, halo:boolean}
```

(W1 확정 — P10 · P11이 빌더를 고치지 않고 쓰는 법. 자세한 것은 `docs/NOTES-P5.md`)
- **부유체**: 몸은 root 위 `[hover, height]`를 차지한다. sim이 `boss.y = hoverY`로 root를 이미 올리므로(`CharacterLayer`가 `root.position.y`에 넣는다) **`hover: 0, height: def.height − hoverY`로 만들어야 두 번 뜨지 않는다.** 무기 메시는 없다 — `sockets.weapon`에 붙이고 `weaponBase/Tip`의 `position.y`를 맞춘다(날의 축 = 소켓 로컬 +Y).
- **사족**: root 원점 = 몸 중심(보스 `pos`). 코끝 z = +0.518 × length, 엉덩이 끝 z = −0.482 × length. 다리 관절은 rest에서 회전 0이 선 자세다. `rig.height` = `shoulderHeight`.
- `Rig`의 덤(선택): `cape` · `ikLeftHand(target, weight)` · `groundFeet(weight)`(인간형 전용) · `setBoost(x)`(2페이즈 발광) · `setOpacity(a)`(사망 소멸) · 소켓 `gripL`. `buildHumanoidRig`의 선택 opts: `helmet: 'horned'` · `heavy` · `accentGlow` · `apron`. `pose.js`의 덤: `poseDeg` · `withPose` · `copyPose` · `addRot` · `addPos` · `applyGait`. 내부 파일 `geo.js`(P10 · P11이 써도 된다).
- 재질은 리그마다 따로이고 `setGlow`는 accent 재질만 바꾼다. 리그 재질에는 제 색의 약한 자체 발광(`rig.js`의 `FILL`, 블룸 임계 아래)이 들어 있다 — 어두운 아레나에서 실루엣이 검게 뭉개지지 않게 한다.

**포즈 표현**

```js
/** @typedef {{rot: Record<string, [number, number, number]>, pos?: Record<string, [number, number, number]>}} Pose
 *  rot: 관절별 로컬 오일러 XYZ(rad) — rest(0,0,0) 기준 절대값
 *  pos: 관절별 위치 오프셋(m) — rest 위치에 더한다. 주로 hips(웅크림 · 도약) */
```

**관절 축 규약** — rest 자세에서 모든 관절의 로컬 축은 root와 평행하다: **+X = 캐릭터의 왼쪽, +Y = 위, +Z = 앞.** rest = 똑바로 서서 팔을 내린 자세(사족은 네 발로 선 자세).

| 회전 | 뜻 |
|---|---|
| `spine/chest/head` rx > 0 | 앞으로 숙임 |
| `shoulder*` rx < 0 | 팔을 앞으로 듦(−π/2면 수평 앞) |
| `elbow*` rx < 0 | 팔꿈치 굽힘 |
| `hip*` rx < 0 | 다리를 앞으로 듦 |
| `knee*` rx > 0 | 무릎 굽힘 |
| 모든 관절 ry > 0 | 왼쪽으로 비틂(위에서 보아 +Z → +X) |
| `shoulderL` rz > 0 / `shoulderR` rz < 0 | 팔을 옆으로 벌림 |
| `spine` rz > 0 | 몸통을 오른쪽(−X)으로 기울임 |

**표준 관절 이름**

| 리그 | joints | sockets |
|---|---|---|
| humanoid | `hips · spine · chest · head · shoulderL · elbowL · handL · shoulderR · elbowR · handR · hipL · kneeL · footL · hipR · kneeR · footR` | `weapon`(handR 아래) · `weaponBase` · `weaponTip` · `head` · `chest` · `handL` |
| quadruped | `hips · spine · chest · neck · head · jaw · shoulderFL · elbowFL · pawFL · shoulderFR · elbowFR · pawFR · hipBL · kneeBL · pawBL · hipBR · kneeBR · pawBR · tail1 · tail2 · tail3` | `mouth` · `head` · `chest` · `tailTip` |
| floater | `core · chest · head · shoulderL · elbowL · handL · shoulderR · elbowR · handR · robe1 · robe2 · robe3 · halo` | `weapon` · `weaponBase` · `weaponTip` · `head` · `chest` · `handL` |

`L` 관절은 x > 0, `R` 관절은 x < 0에 있다(§0.2). 무기는 오른손. `weaponBase → weaponTip`이 날의 축이다(궤적용).

**포즈 수학 — `pose.js`**

```js
export const ease = { linear, inQuad, outQuad, inOutQuad, inCubic, outCubic, outQuint, outBack };
export function emptyPose()                         // → {rot: {}, pos: {}}
export function lerpPose(a, b, t, out)              // 관절별 선형 보간(없는 관절은 0으로 본다). → out 또는 새 포즈
export function addPose(base, add, weight, out)     // base + add × weight (덧포즈: 호흡 · 흔들림)
/** 공격 포즈 규칙(플레이어 · 보스 공용). W = set.windup, A = set.active,
 *  releaseT = 예고의 끝에서 "무기가 출발하는" 구간의 비율(0..0.4), h = min(set.holdAt ?? 0.6, 1 − releaseT):
 *   windup  p < h               : lerp(idle, W, outCubic(p / h))             — 자세 완성
 *           h ≤ p < 1 − releaseT: W                                           — "멈춰 읽히는" 시간
 *           p ≥ 1 − releaseT    : lerp(W, A, RELEASE_FRAC × inQuad((p − (1 − releaseT)) / releaseT))
 *                                                                             — 무기가 움직이기 시작한다(반응 신호)
 *   charge  p: W + 떨림(진폭 ∝ p)                                             — 플레이어 강공격만
 *   active  p: lerp(S, A, outQuint(min(1, p / 0.5)))    S = releaseT > 0 ? lerp(W, A, RELEASE_FRAC) : W
 *   recovery p: p < 0.3 → lerp(A, set.follow ?? A, p / 0.3)
 *               p ≥ 0.3 → lerp(그 포즈, idle, inOutQuad((p − 0.3) / 0.7))
 *  set = {windup: Pose, active: Pose, follow?: Pose, holdAt?: number(예고 완성 지점, 기본 0.6)}
 *  RELEASE_FRAC = 0.35 (pose.js 상단 const). releaseT = 0이면 예고 끝 = W 그대로다. */
export function attackPose(set, idle, phase, phaseT, out, releaseT = 0)
/** 보스 뷰가 쓰는 releaseT: 판정 BOSS_RELEASE_LEAD(0.18초) 전에 무기가 출발한다. windupSec = attack.windup(실제 예고 길이). */
export function bossReleaseT(windupSec)             // → clamp(0.18 / windupSec, 0, 0.4)
/** 상태가 튀어도 관절이 부드럽게 따라가게 하는 지수 감쇠 블렌더 */
export class PoseBlender { constructor(rig, halfLife = 0.05); update(targetPose, dt, halfLife = this.halfLife); snap(targetPose) }
```

- **플레이어**는 `releaseT = 0`(예고가 0.18~0.6초로 짧아 출발 구간이 필요 없다). **보스**(세 뷰 공통)는 `attackPose(POSES[attack.pose], idle, attack.phase, attack.phaseT, out, bossReleaseT(attack.windup))` — 무기가 멈춰 있다가 판정 첫 틱에 순간 이동하지 않고, 판정 0.18초 전에 움직이기 시작해 궤적의 35%를 지난 채 판정에 들어간다. 같은 시각(@−0.15)에 `whoosh` 큐가 난다.
- 보스의 `attack` 상태에서는 `PoseBlender.update(pose, dt, 0.015)`(화면의 무기가 sim 판정보다 늦지 않게), `attack.phase`가 `'active'`로 바뀐 프레임에는 `snap`. 그 밖의 상태는 기본 `halfLife`.

실루엣 규칙: **예고 = 무기를 크게 뒤로/위로 당긴 자세(몸 중심에서 멀어진다)**, **판정 = 반대편 끝까지 뻗은 자세**, **후딜 = 무기가 바닥/옆에 처지고 몸이 숙여진 자세**. 세 자세의 무기 끝 위치가 서로 1m 이상(보스는 2m 이상) 떨어져야 한다.

### 9.6 캐릭터 레이어 — `view/characters/CharacterLayer.js` (P5)

```js
export class CharacterLayer {
  constructor({scene, bus, settings})
  update(state, alpha, dt)
  /** 소켓의 월드 좌표를 out(THREE.Vector3)에 쓴다. 대상/소켓이 없으면 false. */
  getSocketWorld(who /* 'player' | 'boss' */, socket, out)
  dispose()
}
```

- 관리 대상: 플레이어 뷰(항상) · 보스 뷰(`state.boss`가 있을 때 — `MODE_CHANGED`에서 `createBossView(bossId)`로 만들고 이전 것은 `dispose`) · 허수아비 · NPC 2명(마을에서만 보임, 위치는 `state.world.dummy/npcs`).
- 매 프레임: 보간 위치 · facing(· 보스 `y`)을 `root`에 넣은 뒤 각 뷰의 `update`를 부른다. **`update`의 끝에서 `charRoot.updateMatrixWorld(true)`를 부른다** — `getSocketWorld`는 그 월드 행렬에서 `out.setFromMatrixPosition(socket.matrixWorld)`로 읽는다(호출 측은 행렬을 갱신하지 않는다). 프레임 순서가 characters → fx → render이므로, 이렇게 해야 무기 궤적 · 록온 표식 · 인챈트 불씨가 한 프레임 늦지 않는다.
- (W4 확정) **피격 점멸은 블룸에 걸리지 않는다**: `setFlash(1)`의 발광은 선형 0.18(색은 흰색 쪽 70%)이다. 어두운 재질에는 흰 발광을 조금만 더해도 음영이 사라진 흰 판이 되고, 블룸 임계를 넘기면 대상이 통째로 날아간다 — 「밝아졌다」로만 읽히게 하고 번쩍임은 fx(스파크 · 점광원)가 맡는다. 플레이어의 공격 포즈는 `active`를 진행도 0.1(휘두르기의 약 2/3 — 닿는 자리)에서 시작한다(판정 틱의 히트스톱이 예고 자세에서 멈추지 않게). 처형의 찌르기는 타격 시각(`execute.hitAt`)에 **끝난다**.
- 구독: `HIT`(대상 점멸 0.12초, 허수아비 흔들림) · `WEAPON_EQUIPPED`/`PROFILE_CHANGED`(무기 메시 교체 — `state.player.stats.weaponId`) · 보스 관련 이벤트는 보스 뷰의 `onEvent`로 넘긴다.
- (W1 확정) 무기 메시 교체는 이벤트를 구독하지 않고 **매 프레임 `state.player.stats.weaponId`를 본다**(결과는 같고 이벤트 누락에 안전하다). 피격 점멸은 레이어가 `bossView.rig.setFlash`로 건다 — 보스 뷰가 따로 하지 않는다. 보스 뷰는 `MODE_CHANGED`마다(재도전 포함) 새로 만든다. (W5 확정 — 리뷰) **물러난 뷰 하나를 보스마다 씬 밖에 쥐고 있는다**(레이어 `dispose`에서 치운다) — three는 프로그램을 쓰는 마지막 재질이 dispose되면 셰이더 프로그램을 버리므로, 판마다 뷰를 버리면 격파 소멸(투명 변형) · 니힐의 등장에서 매 판 76~147ms씩 다시 컴파일했다. 쥔 뷰가 없는 보스의 새 뷰는 첫 프레임에 불투명 재질을 `transparent`로 한 번 그려(전환 막 아래) 소멸용 변형까지 미리 컴파일하고 둘째 프레임에 되돌린다 — 컴파일은 보스마다 세션에 한 번, 첫 진입 프레임에만 난다(`test/rig.test.js`). `onEvent(name, payload)`의 `name`은 `EV` 문자열 값이다(`HIT` · `BOSS_ATTACK_WINDUP/ACTIVE/END` · `BOSS_CUE` · `BOSS_STEP` · `BOSS_PHASE_CHANGED` · `BOSS_GROGGY` · `BOSS_TELEPORT` · `BOSS_DEFEATED`). `getSocketWorld`는 첫 `update` 전에는 false다.

**플레이어 상태 → 포즈** (P5)

| `player.state` | 포즈 |
|---|---|
| `idle` | 대기 + 호흡(덧포즈). 록온이면 전투 자세(무기 앞) |
| `move` | 걷기/달리기 사이클 — 위상 = 이동 거리 / 보폭. 록온 스트레이프는 `vel`과 `facing`의 각으로 앞/옆/뒤 걸음 섞기. 속력으로 진폭 |
| `roll` · `backstep` | `stateTime / stateDur`로 몸을 말아 한 바퀴(`hips` 위치 낮춤 + 전신 rx 회전). 구르기는 **항상 facing 방향 앞구르기**다 — sim이 진입 틱에 facing을 구르는 방향으로 스냅한다(§7.1). 옆 · 뒤 구르기 포즈는 만들지 않는다. 백스텝은 facing을 유지한 채 뒤로 뛰는 자세 |
| `attack` | `attackPose(MOTIONS[attack.motion][grip], idle, attack.phase, attack.phaseT)`. motion 7종 × grip 3종(없는 조합은 가까운 것으로) |
| `guard` · `guardHit` | 무기를 몸 앞에 세움. `guardHit`은 뒤로 밀리는 덧포즈. `parryActive` 동안 무기를 바깥으로 쳐내는 짧은 동작 |
| `parry` | 쳐낸 뒤 무기가 벌어진 자세 |
| `guardBreak` | 팔이 벌어지고 뒤로 젖혀짐 |
| `flask` | 왼손을 입으로(0.7초 지점에 회복 빛은 fx) |
| `stagger` | 상체가 `knockVel` 반대로 젖혀짐 |
| `knockdown` · `getup` | 쓰러짐 → 일어남(`stateTime / stateDur`) |
| `execute` | 0.7초(타격)까지 찌르기 예고 → 관통 → 뽑기 |
| `dead` | 무릎 꿇고 쓰러짐(1.2초에 걸쳐) |

**보스 뷰 인터페이스** — `view/bosses/index.js`(P0)가 `createBossView(bossId)`로 아래 셋을 고른다.

```js
/** @typedef {Object} BossView
 * @property {THREE.Object3D} root            // CharacterLayer가 위치 · 회전을 넣는다
 * @property {Rig} rig
 * @property {(boss:BossState, info:{alpha:number, dt:number, time:number, state:GameState})=>void} update
 * @property {(name:string, payload:Object)=>void} [onEvent]   // HIT · BOSS_* 이벤트
 * @property {()=>void} dispose
 */
export const VALDER_POSES            // view/bosses/valderView.js — Record<pose 키, {windup, active, follow?, holdAt?}> (테스트가 키를 검사)
export const MOTIONS                 // view/characters/playerView.js — Record<motion, Record<grip, {windup, active, follow?, holdAt?}>>
export function createValderView()   // view/bosses/valderView.js (P5)
export function createFenrirView()   // view/bosses/fenrirView.js (P10)
export function createNihilView()    // view/bosses/nihilView.js  (P11)
```

**보스 상태 → 포즈 규칙**(세 보스 공통)

| `boss.state` | 포즈 |
|---|---|
| `intro` | 등장 자세 → 0.5초에 포효 |
| `idle` | 대기 + 호흡 |
| `chase` | 걷기 사이클(`stepDist` 위상). 부유체는 기울임 |
| `attack` | `attackPose(POSES[attack.pose], idle, attack.phase, attack.phaseT, out, bossReleaseT(attack.windup))`(§9.5) + `rig.setGlow(attack.glow, 예고 진행도)` |
| `parried` | 무기가 튕겨 나가 벌어진 자세 |
| `groggy` | 무릎 꿇음/엎드림 — 머리 위 표식은 fx |
| `executed` | 크게 젖혀짐 |
| `recover` | 일어남 |
| `phaseShift` | 웅크림 → 0.6초에 포효(팔을 벌리고 젖힘) |
| `dead` | 쓰러져 `stateTime / (COMBAT.outroVictory − 0.4)`(= 2.2초)에 걸쳐 가라앉으며 흩어짐(스케일/투명도). 끝나면 `root.visible = false` — outro(2.6초)가 끝나 세계가 멈추기 전에 연출이 끝난다 |

- 스텁 뷰(P0): 반경 · 키에 맞춘 캡슐 + 앞을 가리키는 상자. `rig`는 관절 없는 `Rig`.
- 발더 뷰는 §8.10의 pose 키 9종을 전부 가진다. 모르는 pose 키가 오면 첫 번째 포즈로 대체하고 경고를 한 번만 찍는다(죽지 않는다).
- 2페이즈: `boss.phase === 2`면 강조 재질 발광 상승. 발더는 `boss.ext.enchanted`면 대검에 불(발광 + fx가 `weaponBase/Tip` 소켓을 읽어 불씨를 붙인다).

### 9.7 연출 — `view/fx/FxLayer.js` · `audio/AudioEngine.js` (P7)

```js
export class FxLayer {
  constructor({scene, camera, bus, characters, settings})   // characters = CharacterLayer (getSocketWorld만 쓴다)
  update(state, alpha, dt)
  dispose()
}
export class AudioEngine {
  constructor({bus, settings})
  unlock()              // 첫 사용자 제스처에서 app이 부른다(AudioContext 생성 · resume). 그 전에는 전부 무음 no-op
  update(state, dt)     // 분위기 음 강도(보스 HP · 페이즈 · 거리)
  setPaused(paused)
  dispose()
}
```

**이벤트 → 연출 표** (P7이 전부 구현. 소리는 전부 WebAudio 합성)

| 이벤트 | fx | audio |
|---|---|---|
| `PLAYER_SWING` | 무기 궤적 시작(`dur` 동안 `weaponBase/Tip`을 매 프레임 샘플한 리본) | 휘두르기(무기별 음높이 · heavy면 낮고 길게) |
| `PLAYER_ATTACK_START` | — | 옷 스침(작게) |
| `PLAYER_CHARGE_FULL` | 무기 끝 섬광 | 띵 |
| `HIT` outcome `hit` · target `boss`/`dummy` | 스파크 다발(`dir` **축**의 원뿔 — W1 확정: 맞은 표면에서 **바깥쪽 = 공격자 쪽(`−dir`)** 으로 튄다. `+dir`은 대상의 몸 안이라 가려진다. 가드 · 패링 · 무적 스파크도 같다) · crit/heavy면 크게 · 피해 숫자 | 타격음(heavy/crit/execute 변주) |
| `HIT` outcome `hit` · target `player` | 붉은 파편 · 화면 가장자리 붉은 번쩍(재량) | 둔탁한 피격음 |
| `HIT` outcome `guard` | 흰 스파크(작게) | 금속 막는 소리. `guardBreak`면 깨지는 소리 |
| `HIT` outcome `parry` | 큰 고리 섬광 + 스파크 | 맑고 높은 금속음 |
| `HIT` outcome `immune` | 회색 스파크 | 둔탁한 튕김 |
| `PLAYER_DODGED` | 잔상 한 장(재량) | 짧은 휙 |
| `PLAYER_ROLL` | 발밑 먼지 | 구르는 소리 |
| `PLAYER_STEP` · `BOSS_STEP` | 작은 먼지(보스는 크게) | 발소리(달리기는 빠르게 · 보스 heavy는 쿵) |
| `PLAYER_FLASK` | `heal`: 초록 상승 입자 | `start` 꿀꺽 · `heal` 회복음 · `empty` 빈 병 |
| `PLAYER_STAMINA_OUT` | — | 헉 |
| `EXECUTE_STARTED` | — | 낮은 예고음 |
| `BOSS_ATTACK_WINDUP` | `glow !== 'none'`이면 보스 가슴/무기에 모이는 입자. **`glow === 'danger'`면 보스 머리 위에 붉은 경고 섬광(빌보드 · 0.35초)** — 패링 불가 신호라 색만이 아니라 모양으로도 구분한다(발더의 불색과 섞이지 않게) | 짧은 준비음(0.25초 이하 — 끝을 판정 시각에 맞추지 않는다. 히트스톱으로 실시간과 sim 시각이 어긋나기 때문). `danger`면 날카로운 경고음을 겹친다. 타격 박자는 `whoosh` 큐(@−0.15)가 알린다 |
| `BOSS_ATTACK_ACTIVE` | 보스 무기 궤적(소켓이 있으면) | 큰 휘두르기 |
| `BOSS_CUE` | 큐별: `slam/land/stomp` 먼지 고리 + 파편 · `roar/howl` 충격 고리 · `charge_start` 먼지 줄기 · `cast` 손 섬광 · `blink_out/in` 잔상 + 입자 · `breath_start` 원뿔 냉기(끝까지 유지) · `beam_start` 광선 메시(끝까지 유지) · `enchant` 불 붙음 · `shatter` 얼음 파편 | 큐별 합성음 |
| `BOSS_PHASE_CHANGED` | 화면 전체 충격 고리 | 음악 2페이즈 층 추가 |
| `BOSS_GROGGY` on | 보스 머리 위 표식(붉은 점 — 처형 가능) | 무너지는 소리 |
| `BOSS_TELEPORT` | from 소멸 입자 · to 등장 입자 | 순간이동음 |
| `PROJECTILE_SPAWNED/ENDED` | 구체 메시 + 꼬리 생성 / 폭발 입자(`reason 'parry'`면 쳐내는 섬광. **`'clear'`면 연출 없이 제거**) | 발사음 / 폭발음(`'clear'`는 무음) |
| `HAZARD_SPAWNED` | `warn` 동안의 예비 연출 — `void_sword`: `warn`초에 걸쳐 위에서 떨어지는 검(착지 = 활성화 시각). 그 밖의 kind는 텔레그래프만으로 충분하면 없음 | 작은 경고음 |
| `HAZARD_ACTIVATED` | kind별 분출: `shockwave` 달리는 고리 · `fire_trail` 불길 줄 · `fire_pillar` 불기둥 · `ice_spike` 얼음 가시 솟음 · `void_burst` 보라 폭발 · `void_sword` 떨어지는 검 | kind별 |
| `PLAYER_DIED` · `BOSS_DEFEATED` | 재가 흩날림 / 큰 섬광 + 입자 | 사망 음 / 승리 음 |
| `MODE_CHANGED` | 전부 정리 | 분위기 음 교체(`town` 잔잔한 드론 · 보스별 드론 + 타악 펄스) |
| `LEVEL_UP` · `WEAPON_UPGRADED` · `ITEM_PURCHASED` | (마을) 플레이어 발밑 상승 빛 | 성장음 |
| `UI_SOUND` · `UI_OPENED/CLOSED` · `PURCHASE_FAILED` | — | UI 음 |
| `PAUSED` · `SETTINGS_CHANGED` | — | 덕킹 / 볼륨 반영 |

(W4 확정 — 화면 패스) **연출이 대상을 가리지 않는다**: ① 번쩍임 점광원은 완만한 감쇠(`d^0.6` · 사거리 9m)다 — 맞은 자리(= 몸의 표면)에 놓이므로 거리 제곱 감쇠면 닿은 면이 수백 배로 탄다. 호출부의 세기는 `LIGHT_GAIN 0.14`를 곱해 들어간다(1m 거리의 조도 ≈ 값 × 0.14). ② 피격 비네트는 화면 중심의 약 60% 밖 가장자리 띠만 물들인다(세기 0.4 · 넉다운 0.55). ③ 텔레그래프의 「판정 시작」 번쩍임과 활성 구역(불길 · 광선 · 브레스)의 바닥은 블룸 임계 근처까지만 밝다 — 큰 원(도약 착지)이 화면을 하얗게 덮지 않는다. ④ 광선은 심지 HDR 1.9 · 겉빛 0.9(불투명도 0.3). ⑤ 무릎 꿇은 보스(`groggy` · `executed` · `recover`)의 피격 스파크 · 피해 숫자는 몸 키의 42% 높이로 내린다(sim의 `DamageResult.y`는 선 자세 기준).

(W1 확정) `FxLayer`는 버스 이벤트를 큐에 쌓았다가 **`update()`에서** 순서대로 처리한다(같은 프레임의 `state` · 보간 위치 · 소켓을 쓰려고) — `update`가 불리지 않으면 연출도 나오지 않는다. `characters`가 null이거나 `getSocketWorld`가 false여도 돈다(궤적 · 인챈트 불씨만 생략, 표식 · 브레스 · 광선은 보스 보간 위치 + 높이 비율로 대체). `fxRoot` 아래에 점광원 3개가 세기 0으로 항상 있다(광원 수가 바뀌면 전 재질이 다시 컴파일된다). 브레스 · 광선 · 예고 발광은 끝 이벤트를 놓쳐도 `attack.active + 1.5초`(정보가 없으면 6초) 뒤 스스로 멎는다. (W5 확정 — 리뷰) **교전이 끝나면(`fight.phase === 'done'`) 지속 연출과 지속음을 접는다** — 사망 뒤 아웃트로에서 보스가 시작한 브레스 · 광선은 sim이 멈춰 끝 이벤트가 오지 않는다: `FxLayer`는 상태를 보고, `AudioEngine`은 `FIGHT_PHASE{done}` · `FIGHT_ENDED`와 `update`의 상태 확인으로 끈다(`test/fx.test.js` · `test/audio.test.js`). `AudioEngine.update`는 매 프레임 불러야 타악이 예약된다. `BOSS_ATTACK_ACTIVE`의 큰 휘두르기 소리는 그 공격의 `hits`가 비어 있으면 내지 않는다.

**상태를 읽어 매 프레임 그리는 것** (이벤트가 아니라 `state`에서)

| 대상 | 읽는 것 | 그리기 |
|---|---|---|
| 텔레그래프 | `state.telegraphs` | `id`로 메시를 생성/갱신/제거. 모양별 평면 메시(y = 0.03): 테두리는 항상 보이고 **안쪽 채움이 `progress`에 따라 차오른다**(1에서 번쩍). 색 = `PALETTE.style[style]`. 월드 좌표 변환은 §0.2 식(`dir` 방향의 점 = `(x + r sin dir, z + r cos dir)`) |
| 투사체 | `state.projectiles` | `id`별 메시, `prevX/prevZ → x/z` 보간, 높이 `y` |
| 장판 | `state.hazards` | `state === 'active'`인 동안 지속 연출(`grow`면 `shape`의 띠를 따라감) |
| 록온 표식 | `state.player.lockOn` + `characters.getSocketWorld('boss', 'chest')` | 빌보드 고리 스프라이트 |
| 피해 숫자 | `HIT`(target boss/dummy) · `settings.damageNumbers` | 떠오르는 숫자 스프라이트(풀 16개 · 캔버스 텍스처). crit은 크게/노랗게 |

### 9.8 무기 궤적

`PLAYER_SWING`에서 시작해 `dur + 0.08`초 동안 매 프레임 `characters.getSocketWorld('player', 'weaponBase' | 'weaponTip')`을 샘플해 리본(최근 12점)을 만든다. 가산 혼합 · 끝으로 갈수록 투명. `BOSS_ATTACK_ACTIVE`도 보스에 `weaponBase/Tip` 소켓이 있으면 같은 방식(`active + 0.1`초, 더 굵게, 2페이즈/발광 색). (W1 확정: 리본은 날 전체가 아니라 **바깥쪽**만 덮는다 — 플레이어 55% · 보스 40%. 보스 대검의 날 전체를 덮으면 부채꼴이 화면을 가린다. 두 소켓이 둘 다 true일 때만 그린다.)

### 9.9 화질 단계 — `data/settings.js`의 `QUALITY`

| 단계 | pixelRatio 상한 | 그림자 | 블룸 | 입자 예산 | 안개 |
|---|---|---|---|---|---|
| `low` | 1.0 | 끔 | 끔 | 150 | 켬 |
| `medium`(기본) | 1.5 | 1024 | 켬(절반 해상도) | 400 | 켬 |
| `high` | 2.0 | 2048 | 켬(전체 해상도) | 800 | 켬 |

```js
export const QUALITY = {
  low:    { pixelRatio: 1.0, shadows: false, shadowMapSize: 0,    bloom: false, bloomScale: 0,   particles: 150 },
  medium: { pixelRatio: 1.5, shadows: true,  shadowMapSize: 1024, bloom: true,  bloomScale: 0.5, particles: 400 },
  high:   { pixelRatio: 2.0, shadows: true,  shadowMapSize: 2048, bloom: true,  bloomScale: 1.0, particles: 800 },
};
```

실제 pixelRatio = `min(window.devicePixelRatio, 상한)`. 입자 예산은 P7이 지킨다(초과분은 가장 오래된 것부터 버림).

### 9.10 팔레트 — `data/palette.js` (P0 완성)

```js
export const PALETTE = {
  bg: 0x0b0b0e,
  fog:   { town: 0x1a1714, ember: 0x1c1512, frost: 0x141a22, void: 0x120d1c },
  style: { fire:   { core: 0xffc27a, glow: 0xff5a1e },
           frost:  { core: 0xd6f1ff, glow: 0x4aa8ff },
           void:   { core: 0xe0c2ff, glow: 0x8a3cff },
           danger: { core: 0xffd6c8, glow: 0xff2a2a } },
  player: { armor: 0x70757f, cloth: 0x3a2f2a, skin: 0xc9a98a, accent: 0xb08a4a },
  valder: { armor: 0x4a4a52, cloth: 0x2a2224, skin: 0x1a1a1c, accent: 0xff6a2a },
  fenrir: { fur: 0x9fb4c8, dark: 0x3a4658, accent: 0x7fd4ff },
  nihil:  { robe: 0x1a1226, trim: 0x6a3cff, accent: 0xc59bff },
  npc:    { armor: 0x5a5148, cloth: 0x4a3a2c, skin: 0xc9a98a, accent: 0x9a7a4a },
  spark: 0xffd9a0, blood: 0x8a1a1a, heal: 0x7dff9a, ember: 0xff8a3a, steel: 0xb8bcc4,
};
```

---

## §10 ui 계약 (P8)

### 10.1 진입점 — `ui/UIRoot.js`

```js
export class UIRoot {
  /** @param {{root:HTMLElement, bus:EventBus, sim:GameSim, progression:Progression,
   *           settings:Settings, actions:UiActions}} deps */
  constructor(deps)
  update(state, dt)                 // HUD 갱신(매 렌더 프레임. 값이 바뀔 때만 DOM을 건드린다)
  openPanel(id, params)             // id ∈ PANEL_IDS. 이미 열린 패널은 닫고 연다. UI_OPENED.
                                    //   예외: id === 'pause'는 다른 패널이 열려 있으면 **무시한다**(result · 시설 패널을 닫지 않는다)
  closePanel()                      // UI_CLOSED
  activePanel                       // string | null (getter)
  isBlocking()                      // 패널이 열려 있으면 true(전부 블로킹)
  canClose()                        // Esc로 닫을 수 있는 패널인가 — 시설 패널 4종만 true (title · result · pause는 false)
  navigate(dx, dy)                  // 패널 포커스 이동. dy: −1 위 / +1 아래, dx: −1 왼쪽 / +1 오른쪽(탭 · 슬라이더 · 유물 칸)
  confirm()                         // 포커스된 항목 실행(= 그 버튼 클릭)
  cancel()                          // 시설 패널: 닫기 / pause: actions.resume() / result: actions.toTown() / title: 없음
  setPointerLocked(locked)          // app이 포인터 락 상태를 알린다(HUD의 「클릭하면 시점 고정」 안내용)
  setHudVisible(visible)
  setNotice(id, text, hold = 0)     // (W5 확정) 화면 아래 가운데의 알림 한 줄(app이 띄운다 — 저장 실패 · 그래픽 장치 끊김 · 게임패드 끊김).
                                    //   text === null이면 지운다. hold(초) 뒤 스스로 사라진다(0 = 지울 때까지). 패널이 열려 있어도 보인다
  setTitleNotes(keys)               // (W5 확정) 타이틀 패널에 덧붙일 환경 안내의 문자열 키(저장할 수 없는 브라우저 · 터치만 있는 기기)
  showFatal(title, body)            // (W5 확정) 게임을 띄울 수 없다(WebGL2 없음) — 안내만 남기고 HUD · 패널을 치운다
  fade(toOpaque, dur)               // → Promise<void>. 전체 화면 검은 막(전환용)
  dispose()
}

/** app이 넘겨주는 콜백 묶음
 * @typedef {Object} UiActions
 * @property {()=>boolean} hasSave
 * @property {()=>void} newGame
 * @property {()=>void} continueGame
 * @property {(bossId:BossId)=>void} startBoss
 * @property {()=>void} retry
 * @property {()=>void} toTown        마을로. 보스전 교전 중이면 app이 sim.forfeitFight()를 먼저 부른다(§11.2)
 * @property {()=>void} resume
 * @property {()=>void} quitToTitle
 * @property {(partial:Partial<Settings>)=>void} applySettings
 */
```

- `import './styles.css'`는 `UIRoot.js`에서 한다(Vite가 처리). DOM은 전부 `deps.root`(`#ui-root`) 아래에 만든다.
- **패널을 여는 것은 app뿐이다**(`INTERACT` → 시설 패널, Esc · 락 상실 → `pause`, `FIGHT_ENDED` → `result`, 부팅 → `title`). 닫는 것은 UI(닫기 버튼 · `cancel()`)나 app(Esc → `ui.canClose() && ui.closePanel()`). **Esc 키는 app만 듣는다** — UI는 Esc를 직접 처리하지 않는다(이중 처리 방지).
- **pause는 Esc로 닫히지 않는다.** Esc는 브라우저가 "사용자 활성화"로 치지 않아, Esc로 재개하면 포인터 락을 되찾지 못한다. 재개는 `[계속]` 클릭 · `KeyE`/`Enter`/`Space`(기본 포커스가 `[계속]`) · `KeyQ` · 게임패드 Start/A/B — 전부 활성화 제스처다.
- 패널이 열리면 `UI_OPENED {panel, blocking:true}` → app이 sim 입력을 `NEUTRAL_INPUT`으로 바꾸고 포인터 락을 푼다. 닫히면 `UI_CLOSED` → app이 포인터 락을 다시 요청한다.
- UI는 `sim.state`와 `progression`을 읽고, **상태 변경은 `progression`의 명령 · `actions` · `sim.restAtBonfire()`로만** 한다.
- (W1 확정 — app이 전제로 할 것. 자세한 것은 `docs/NOTES-P8.md`)
  - **UI는 `actions.*`를 부른 뒤 스스로 패널을 닫지 않는다**(`startBoss` · `retry` · `toTown` · `newGame` · `continueGame` · `quitToTitle` · `resume`). 닫는 것은 app의 전이(§11.2의 `ui.closePanel()`)와 `actions.resume() = ui.closePanel()`이다. `openPanel`이 열린 패널을 교체하면 `UI_CLOSED{이전}` → `UI_OPENED{새}` 순으로 난다.
  - 락 안내의 초기값은 「락 없음」이다 — app은 락 상태가 **바뀔 때마다**(요청이 실패해 드래그 모드로 남을 때 포함) `ui.setPointerLocked(input.locked)`를 부른다. (W4 확정) 둘째 인자로 `input.dragMode`를 넘긴다 — `setPointerLocked(locked, dragMode)`. 드래그 모드(락을 줄 수 없는 환경)에서는 안내 문구가 `hud.dragToLook`(`마우스를 누른 채 끌면 시점이 돈다`)으로 바뀌고 6초 뒤 사라진다(「클릭하면 고정된다」가 내내 떠 있지 않는다).
  - 타이틀 패널이 열려 있는 동안 HUD는 스스로 숨는다(`setHudVisible`을 부르지 않아도 된다). 패널이 열리면 프롬프트 · 조작 힌트 · 락 안내 · 배너를 숨긴다.
  - `fade(false, dur)`는 시작하는 순간 클릭 통과로 돌아간다. 겹친 `fade`는 앞의 Promise를 즉시 resolve 한다. `dur ≤ 0`이면 즉시 resolve.
  - 패널 키는 `Ctrl` · `Alt` · `Meta`가 눌려 있으면 건드리지 않는다. 입력 지연 중에도 패널 키에는 `preventDefault`만 건다. **UI가 처리한 keydown은 `defaultPrevented`다 — app의 입력 수집은 그 keydown을 게임의 에지(`*Pressed`)로 받지 않는다**(§11.3의 「`UI_CLOSED` 뒤 0.15초 에지 버림」과 같은 목적: 결과 패널의 `[E] 마을로`가 곧바로 화톳불 상호작용이 되거나 `[R] 재도전`이 플라스크가 되지 않게). (W5 확정) **홀드는 받는다** — 패널이 떠 있는 동안(전환 페이드아웃 0.3초 포함) 누른 이동 키가 패널이 닫힌 뒤에도 눌린 것으로 읽혀야 한다(§11.3 「홀드와 에지」).
  - HUD는 `state.fight` 객체의 **참조**가 바뀌면 새 판으로 보고 보스 바 등장 연출 · 누적 피해 · 잔상을 초기화한다 — `ui.update`에 `structuredClone`한 상태를 넘기지 않는다.
  - 설정 슬라이더는 `actions.applySettings(partial)` 직후 `deps.settings`(같은 객체)를 다시 읽어 그린다 — app이 그 객체를 **동기적으로** 고쳐야 값이 움직인다(§11.1).
  - 프롬프트 위치: 상호작용 프롬프트는 화면 82% 높이, 처형 프롬프트는 정중앙, 락 안내는 상단 중앙의 HP 바 줄 아래(§10.2 표의 위치를 겹침 없이 읽은 것). 내부 파일 `ui/dom.js` · `ui/panels/panelBase.js`, `i18n.js`의 `hasStr(key)`.

**패널 키 조작** — 마우스 클릭과 **같은 일을 키보드 · 게임패드로도** 한다(루프의 핵심 동작이 마우스를 락에서 풀어 버튼을 찾는 일이 되지 않게).

| 입력 | 동작 |
|---|---|
| `KeyW` · `ArrowUp` / `KeyS` · `ArrowDown` | `navigate(0, ∓1)` — 포커스 위/아래 |
| `KeyA` · `ArrowLeft` / `KeyD` · `ArrowRight` | `navigate(∓1, 0)` — 탭 · 슬라이더 · 유물 칸 |
| `KeyE` · `Enter` · `Space` | `confirm()` |
| `KeyQ` | `cancel()` |
| `KeyR` | result 패널이 **사망 결과일 때만** `actions.retry()` |
| 게임패드 | app이 D-pad/왼쪽 스틱(반복 0.18초) → `navigate`, A(0) → `confirm`, B(1) → `cancel`로 넘긴다(§11.3) |

- 키보드는 **UI가 직접 듣는다**(`window` keydown, 패널이 열려 있을 때만. 처리한 키에는 `preventDefault`). `event.repeat`인 keydown은 무시한다.
- **패널이 열린 뒤 `PANEL_INPUT_DELAY`(0.25초 — result는 0.5초) 동안은 키 · 클릭 · `navigate/confirm/cancel`을 받지 않는다** — `E`로 패널을 연 그 입력이나, 죽는 순간 연타하던 `R`이 곧바로 확정으로 이어지지 않는다.
- 포커스는 UI가 자체 클래스(`.focused` — 잔불색 테두리)로 그린다. 버튼은 DOM 포커스를 받지 않는다(`tabindex="-1"`). 마우스 hover도 포커스를 옮긴다. 버튼 hover/click · 포커스 이동에 `UI_SOUND`.
- **열릴 때의 기본 포커스**:

| 패널 | 기본 포커스 |
|---|---|
| `title` | 저장이 있으면 `[이어하기]`, 없으면 `[새 게임]` |
| `pause` | `[계속]` |
| `bonfire` | 이 세션에서 마지막으로 올린 능력치 행(없으면 `vit`) |
| `blacksmith` | 장착 무기의 `[강화]` |
| `merchant` | 살 수 있는 첫 품목(없으면 첫 품목) |
| `gate` | 해금된 보스 중 `killsThisCycle === 0`인 첫 보스(없으면 `valder`) → 안개문에서 **`E`, `E` 두 번에 출발** |
| `result` | 사망이면 `[즉시 재도전]`, 승리면 `[마을로]` |

### 10.2 HUD — `ui/hud.js`

| 요소 | 위치 | 읽는 것 |
|---|---|---|
| HP 바 | 좌상단 | `player.hp / player.stats.hpMax` (감소분은 흰 잔상이 0.5초 뒤 따라 줄어든다) |
| 스태미나 바 | HP 아래 | `player.stamina / stats.staminaMax`. `exhausted`면 붉게 깜빡 |
| 플라스크 | 바 아래 | `player.flasks / stats.flaskCharges` |
| 잔불 · 파편 | 우상단(또는 우하단) | `profile.embers` · `profile.shards` (증가는 숫자가 굴러 올라감) |
| 보스 이름 + HP 바 | 하단 중앙 | `boss.hp / boss.hpMax` · 이름 `t('boss.<id>.name')` · 2페이즈 표시 |
| 보스 체간 바 | 보스 HP 아래 | `boss.posture / boss.postureMax`. `groggy`면 번쩍. (W5 게이트) `boss.postureGuard`(체간 잠금 — §8.7)인 동안 바를 흐리게 · 테를 점선으로, 왼쪽 글자를 `t('hud.postureGuard')`(「체간 잠김」)로 — 일어난 보스를 때려도 바가 0에서 움직이지 않는 이유를 보여 준다 |
| 누적 피해 수치 | 보스 바 오른쪽 위 | 최근 연속 타격 합(`HIT` target boss를 2초 창으로 합산) |
| 허수아비 피해 | 하단 중앙(마을) | `state.dummy.lastDamage` · `state.dummy.total` (`sinceHit < 3`일 때만) |
| 상호작용 프롬프트 | 화면 중앙 아래 | `state.nearFacility` → `t('prompt.<id>')` (`[E] 화톳불에서 쉰다`) |
| 처형 프롬프트 | 화면 중앙 | `player.canExecute` → `t('prompt.execute')`(`[좌클릭] 처형`). `boss.state === 'groggy'`인데 `canExecute`가 false면 `t('prompt.executeFront')`(`정면으로`) — 조건식을 UI가 다시 계산하지 않는다 |
| 조작 힌트 | 우하단 | `profile.totals.kills === 0`인 동안: 마을에서는 항상, 보스전에서는 `profile.bosses.valder.attempts ≤ 2`일 때 `fight.time < 10` 동안. `KEYBINDS`에서 만든 10줄(`t('action.<키>')` + 키 이름: 이동 · 카메라 · 약공격 · 강공격 · 가드/패링 · 구르기/달리기 · 록온 · 플라스크 · 상호작용 · (W5 확정) 일시정지/설정 — 조작 표와 전투 요령이 그 패널에 있다) |
| 락 안내 | 상단 중앙 | 패널이 없고 포인터 락이 없을 때(`setPointerLocked(false)`) `t('hud.clickToLock')`(`화면을 클릭하면 마우스로 시점을 돌린다`) |
| 배너 | 화면 중앙 | `PLAYER_DIED` → `YOU DIED` · `BOSS_DEFEATED` → `보스 격파` · `CYCLE_ADVANCED` → `순환 +1` |
| 록온 | — | fx가 3D로 그린다(§9.7). HUD에는 없다 |

HUD는 `mode`에 따라 구성(마을에서는 보스 바 숨김). `fight.phase === 'intro'`에 보스 바가 차오르는 연출.

### 10.3 패널

| 패널 | 여는 계기 | 읽는 것 | 부르는 것 |
|---|---|---|---|
| `title` | 부팅 · `quitToTitle` | `actions.hasSave()` · `params.saveBroken` | `newGame()` · `continueGame()`(저장이 없으면 비활성). 새 게임이 저장을 덮을 때 확인 한 번 — (W5 확정) 첫 입력은 무장만 하고, **무장 뒤 0.7초 안의 입력은 확정으로 치지 않는다**(더블클릭 · `E` 연타가 확인 문구를 읽기 전에 저장을 덮지 않게. 「한 번 더 누르면 확정」을 쓰는 버튼 공통 — `panelBase.confirmTwice`). `memory.titleNotes`(`setTitleNotes`)의 환경 안내를 버튼 아래에 한 줄씩 그린다. `params.saveBroken`이면 `t('panel.title.saveBroken')` 한 줄(읽지 못한 세이브는 백업 키에 보존됐다 — §11.4) |
| `pause` | Esc · 락 상실 · 창 포커스 잃음(§11.2) | `settings` · `data/keybinds.js`(조작 안내 표) · `sim.state.fight` | `applySettings(partial)`(감도 · 볼륨 3종 · 화질 · Y반전 · 흔들림 · 피해 숫자) · `resume()` · `toTown()` · `quitToTitle()`. 보스전 교전 중의 `[마을로]`는 확인 한 번 — `t('panel.pause.forfeit')`(`지금까지 준 피해만큼 잔불을 받고 마을로 돌아간다`). (W5 확정) **교전 중의 `[타이틀로]`도 같은 확인을 거친다**(`panel.pause.forfeitTitle` — 같은 포기다). **죽어서 얻는 것과 같은 보상**을 받으므로(`forfeitFight` — §6.4) 일부러 죽을 이유가 없다 |
| `bonfire` | `INTERACT bonfire` | `progression.getStatBlock()` · `previewLevelUp(stat)` × 4 · `profile.embers` | 열릴 때 `sim.restAtBonfire()`. 머리줄에 `잔불 {embers} · 레벨업 {affordableCount}회 가능`. 능력치 행마다 `[+]` → `levelUp(stat)`. **올리기 전/후 수치 비교**: 포커스(hover)된 행의 `preview.changes`를 `현재 → 다음 (+증가분)`으로 나란히 그린다(UI가 StatBlock을 직접 비교하지 않는다). `preview.diminished`면 `t('panel.bonfire.diminish')` 표식(구간 경계 — 이번 점부터 효율이 줄어든다), `preview.nextCost`로 다음 비용 |
| `blacksmith` | `INTERACT blacksmith` | `getWeaponInfo(id)` × 3 · `profile.embers/shards` | `upgradeWeapon(id)` · `equipWeapon(id)`. 현재/다음 단계 피해, 비용(잔불 · 파편), 무기 성격 한 줄. `catchUp`이면 `t('panel.blacksmith.catchUp')`(`따라잡기 — 잔불 반값 · 파편 없음`) |
| `merchant` | `INTERACT merchant` | `getShopItems()` · `profile.relicsEquipped` · `profile.embers` | `buy(itemId)` · `equipRelic(slot, id|null)`. 플라스크 품목은 `valueNow → valueNext`. 유물 2칸 장착 UI(`equippedSlot`) — 산 유물은 빈 칸에 자동 장착된다. (W5 확정) 다른 칸으로 옮길 때는 `equipRelic(slot, id)` **한 번만** 부른다(§6.6 — 두 칸을 맞바꾼다. 먼저 떼면 그 칸의 유물이 조용히 빠진다). 유물을 산 직후 0.7초 동안 그 유물의 칸 버튼은 입력을 받지 않는다(구매의 연타가 해제가 되지 않게) |
| `gate` | `INTERACT gate` | `getBossList()` · `profile.cycle` | `actions.startBoss(id)`. 잠긴 보스는 비활성 + 해금 조건 문구. 보스마다 도전 횟수 · 최고 피해 % · 격파 보상(`victoryEmbers` · `victoryShards` — 감쇠 반영) · 남은 파편(`shardsLeft`) |
| `result` | `FIGHT_ENDED` | `params.reward`(RewardResult) · `params.outcome` · `params.duration` · `sim.state.fight`(받은 피해 · 패링 · 처형) · `progression.getAffordableLevelUps()` | `retry()` · `toTown()`. 준 피해 % · 획득 잔불/파편 · 새 구간/해금/순환 표시. **사망**: `[R] 즉시 재도전`(기본 포커스) · `[Q] 마을로` + `t('panel.result.afford', {n})`(`레벨업 {n}회 가능` — n ≥ 1이면 `[마을로]`를 강조). **승리**: `[마을로]`(기본 포커스) · `t('panel.result.rematch', {mul})`(`다시 싸운다 — 보상 ×{mul}`. `mul` = `getBossList()`의 그 보스 `repeatMul`), `R` 단축키는 끈다(순환이 오른 직후 실수로 다시 들어가지 않게) |

- 명령이 `{ok:false}`면 해당 버튼을 흔들고(`reason`별 문구) 아무것도 바꾸지 않는다. 성공하면 `PROFILE_CHANGED`를 받아 패널을 다시 그린다(포커스는 유지).
- 시설 패널은 닫기 버튼 · `Q` · Esc(app 경유)로 닫힌다. 한 번에 하나만 열린다.

### 10.4 입력 포커스 규칙

| 상황 | sim 입력 | sim.step | 포인터 락 |
|---|---|---|---|
| 패널 없음(마을 · 보스전) | 실제 입력 | 돈다 | 요청 |
| 시설 패널(`bonfire/blacksmith/merchant/gate`) | `NEUTRAL_INPUT` | 돈다(마을은 안전) | 해제 |
| `pause` | — | **멈춘다** | 해제 |
| `result` | `NEUTRAL_INPUT` | 돈다(`fight.phase === 'done'`이라 세계는 정지) | 해제 |
| `title` | — | 멈춘다(배경으로 마을을 렌더) | 해제 |

### 10.5 스타일

다크 판타지 · 세리프 계열(시스템 폰트 스택) · 낮은 채도 + 잔불색(`#ff8a3a`) 포인트. 1280×720에서 겹침 · 잘림 없이 읽혀야 한다.

**클릭 통과 규칙**: `#ui-root` 자체는 `pointer-events: none`이다(index.html — §1). HUD와 그 컨테이너도 `none`. **패널과 패널 배경만 `pointer-events: auto`.** 페이드 막은 불투명도가 0일 때 `none`(전환 중에만 클릭을 막는다). 이 규칙이 깨지면 캔버스의 mousedown(공격 · 가드 · 포인터 락 요청 · 드래그 카메라)이 전부 죽는다.

### 10.6 문자열 — `data/strings.ko.js` · `ui/i18n.js`

```js
export const STR = { 'hud.embers': '잔불', /* … */ };          // data/strings.ko.js
export function t(key, params)   // ui/i18n.js — STR[key]의 {name} 자리를 params로 치환. 없는 키는 key 그대로 반환(+ 경고 1회)
```

키 규칙: `<영역>.<대상>[.<세부>]`, 소문자 · 점 구분. 데이터 ID는 그대로 키에 들어간다:

| 패턴 | 예 |
|---|---|
| `boss.<BossId>.name` · `.title` · `.hint` | `boss.valder.name` = `잿빛 기사 발더` |
| `weapon.<WeaponId>.name` · `.desc` | `weapon.spear.desc` |
| `stat.<StatId>.name` · `.desc` | `stat.vit.name` = `생명력` |
| `relic.<id>.name` · `.desc` | `relic.ember_fang.desc` |
| `item.flask_charge.name` · `item.flask_heal.name` · `.desc` | |
| `facility.<FacilityId>.name` · `prompt.<FacilityId>` · `prompt.execute` · `prompt.executeFront` | `prompt.gate` = `[E] 안개문으로 들어간다` |
| `panel.<PanelId>.title` · `panel.<PanelId>.<요소>` | `panel.result.retry` · `panel.result.afford` · `panel.result.rematch` · `panel.title.saveBroken` · `panel.pause.forfeit` · `panel.bonfire.diminish` · `panel.blacksmith.catchUp` |
| `hud.<요소>` · `banner.died` · `banner.victory` · `banner.cycle` | `hud.clickToLock` · `hud.hints` · (W5 확정) `hud.notice.<saveFailed|contextLost|padLost>` · `fatal.webgl.title` · `.body` |
| `reason.<CmdResult.reason>` | `reason.embers` = `잔불이 부족하다` |
| `settings.<Settings 필드>` · `quality.<low|medium|high>` · `action.<KEYBINDS 키>` · `action.move` · `action.camera` | 조작 안내 표 · HUD 조작 힌트(이동 4키는 `action.move` 한 줄로 묶고, 카메라는 `action.camera`) |

UI 코드에 한국어 리터럴을 쓰지 않는다 — 전부 `t()`를 거친다.

---

## §11 app 계약 (P9)

### 11.1 부트스트랩 — `app/Game.js` · `main.js`

`main.js`는 `new Game(document).start()`만 한다. `Game`의 생성 순서(의존 순서 그대로):

```js
bus         = new EventBus()
settings    = storage.loadSettings()                   // Settings. 이후 같은 객체를 유지한다(필드만 바꾼다)
loaded      = storage.loadSave()                       // {save: SaveData|null, broken: boolean}
profile     = loaded.save?.profile ?? createNewProfile(newSeed())
progression = new Progression(profile, bus)
sim         = new GameSim({ profile, bus })
rc          = createRenderContext(canvas, settings)
world       = new WorldLayer({ rc, bus, settings })
cameraRig   = new CameraRig({ camera: rc.camera, bus, settings })
characters  = new CharacterLayer({ scene: rc.scene, bus, settings })
fx          = new FxLayer({ scene: rc.scene, camera: rc.camera, bus, characters, settings })
audio       = new AudioEngine({ bus, settings })
ui          = new UIRoot({ root, bus, sim, progression, settings, actions })
input       = new InputCollector(canvas, settings)
debugApi.install(window, game)

// Game.start() — 모든 레이어 · UI가 만들어진 뒤
sim.enterTown()                                        // 레이어가 받는 **첫 MODE_CHANGED**(화면은 아직 'title' — 저장하지 않는다)
ui.openPanel('title', { saveBroken: loaded.broken })   // 타이틀 뒤로 마을이 렌더된다
```

- `newSeed()` = `(Date.now() ^ (Math.random() * 2 ** 32)) >>> 0` — app에서만 만든다(sim은 시계 · `Math.random`을 쓰지 않는다).
- **새 게임**: `Object.assign(profile, createNewProfile(newSeed()))`(`sim` · `progression`이 참조를 쥐고 있으므로 **같은 객체를 유지한 채** 내용만 갈아 끼운다) → `bus.emit(EV.PROFILE_CHANGED, {reason: 'reset'})` → town 전이(§11.2). 첫 저장은 그 전이의 `MODE_CHANGED`에서 일어난다. (W5 확정) 갈아 끼우기 **직전에 `storage.backupSave()`** — 덮일 세이브의 원문을 `SAVE_BACKUP_KEY`에 남긴다(§11.4).
- (W5 확정) **렌더러를 만들지 못하면**(`createRenderContext`가 던진다 — WebGL2 없음 · 하드웨어 가속 꺼짐) `Game.start()`는 `ui.showFatal(t('fatal.webgl.title'), t('fatal.webgl.body'))`만 하고 돌아온다(타이틀 · 루프를 시작하지 않는다 — 검은 화면에 메뉴만 뜨지 않는다). `index.html`에는 `<noscript>` 안내가 있다.
- (W5 확정) 부팅 때 `ui.setTitleNotes([...])`: `!storage.canPersist()`면 `panel.title.noStorage`, 터치만 있는 기기(`(pointer: coarse)` && !`(any-pointer: fine)`)면 `panel.title.needInput`.
- **이어하기**: 부팅 때 읽은 `profile` 그대로 town 전이.
- **설정 변경** `actions.applySettings(partial)`: `Object.assign(settings, sanitizeSettings({...settings, ...partial}))` → `rc.setQuality(settings.quality)` → `SETTINGS_CHANGED` → `storage.writeSettings(settings)`.

매 프레임(렌더 순서):

```
frameDt 계산 → (일시정지 아니면) §5.4 누산 루프 → alpha
look = input.consumeLook()
cameraRig.update(state, alpha, dt, look)
world.update(state, alpha, dt); characters.update(state, alpha, dt); fx.update(state, alpha, dt)
audio.update(state, dt); ui.update(state, dt)
rc.render(dt)
저장 요청이 있었으면 한 번 저장(§11.4)
```

### 11.2 화면 상태 기계 — `app/screens.js`

```
boot ──▶ title ──(새 게임/이어하기)──▶ town ──(안개문에서 보스 선택)──▶ boss
                                        ▲                               │
                                        │                         FIGHT_ENDED
                                        │                               ▼
                                        └────────(마을로)──────────── result ──(즉시 재도전)──▶ boss
            pause는 town · boss 위의 오버레이(화면 상태는 유지, paused 플래그)
```

| 전이 | 절차 |
|---|---|
| → `town` | `await ui.fade(true, 0.3)` → `ui.closePanel()` → `screen = 'town'` → `sim.enterTown()` → `cameraRig.snapBehind(player.facing)` → `ui.fade(false, 0.4)` (저장은 `MODE_CHANGED`가 부른다) |
| → `boss` | `await ui.fade(true, 0.3)` → `ui.closePanel()` → `screen = 'boss'` → `sim.startBossFight(id)` → `snapBehind` → `ui.fade(false, 0.4)` (합 0.7초 — 1초 이내) |
| `boss` → `result` | `FIGHT_ENDED` 수신 → `screen = 'result'` → `ui.openPanel('result', {reward, outcome, duration})` |
| `result` → `boss` | `retry()` = 마지막 `bossId`로 → `boss` 전이 |
| `toTown()` | `screen === 'boss' && fight.phase === 'fight'`면 먼저 `sim.forfeitFight()`(지금까지 준 피해만큼 사망 보상 — §6.4) → `town` 전이. 그 밖(intro · outro · result · 마을)에서는 바로 `town` 전이 |
| `quitToTitle()` | 교전 중이면 `sim.forfeitFight()` → 저장 → `await ui.fade(true, 0.3)` → `screen = 'title'` → `sim.enterTown()` → `ui.openPanel('title', {saveBroken: false})` → `ui.fade(false, 0.4)` |

(W5 게이트) **막은 새 화면이 두 프레임 그려진 뒤에 걷는다**: 위 세 전이 모두 `snapBehind`(title은 `openPanel`) 뒤 · `ui.fade(false, 0.4)` 앞에서 `await settle()`을 기다린다 — `ScreenMachine`의 선택 의존성 `settle: () => Promise<void>`(Game이 준다: 렌더한 프레임 2개 또는 250ms 중 먼저 오는 쪽. 숨은 탭처럼 프레임이 돌지 않으면 250ms 뒤 그냥 걷는다). 보스별 세션 첫 진입의 셰이더 컴파일(0.1~0.3초 — §9.6)이 불투명한 막 아래에서 끝난다. `instant` 전이는 기다리지 않는다. 기다리는 동안도 「전이 중」이다.

화면이 바뀔 때 `SCREEN_CHANGED {from, to}`. 전이 중(`fade` · `settle` 대기 중)에는 추가 전이 요청 · pause 요청을 무시한다. **`screen`을 먼저 바꾼 뒤 sim 명령을 부른다**(그 명령이 내는 `MODE_CHANGED`의 저장 판정이 새 화면 기준이 되게).

**일시정지**

- **여는 조건**(공통: 패널 없음 · `screen ∈ {town, boss}` · 전이 중 아님):
  1. Esc keydown.
  2. 락 상실 — `pointerlockchange`로 락이 풀렸고, 직전에 락을 쥐고 있었고, app이 스스로 `exitPointerLock`을 부른 것이 아닐 때(포인터 락 중의 Esc는 브라우저에 따라 keydown 없이 이 경로로만 온다).
  3. 창 포커스 잃음 — 아래.
  4. (W5 확정) 쓰던 게임패드가 사라짐 — 마지막 입력 장치가 그 패드였을 때만. 보스전의 `intro` · `fight`에서만 연다(`screens.pauseIfFighting()`) + `setNotice('pad', …)`.
  5. (W5 확정) WebGL 컨텍스트 로스트(`webglcontextlost`) — `setNotice('webgl', …)`, `webglcontextrestored`에서 알림을 지우고 루프의 시계를 다시 잡는다.
- 열리면 `ui.openPanel('pause')` · `paused = true` · `PAUSED{true}`. **pause가 이미 열려 있으면 Esc · 락 상실은 무시한다** — pause는 Esc로 닫히지 않으므로(§10.1), keydown과 `pointerlockchange`가 둘 다 오는 브라우저에서도 열자마자 닫히는 일이 없다.
- **닫기**: app은 `UI_CLOSED{panel: 'pause'}`를 받으면 **누가 닫았든** `paused = false` · `PAUSED{false}`를 낸다(패널 없이 멈춘 상태가 생기지 않는다). `actions.resume()` = `ui.closePanel()`.
- 패널이 있고 `ui.canClose()`면(시설 패널) Esc는 그 패널을 닫는다.

**창 포커스 잃음** — `window`의 `blur` 또는 `visibilitychange → hidden`:

1. `input.releaseAll()` — 모든 홀드 · 에지 · look 누적을 0으로(keyup이 오지 않아 달리기 · 가드가 고착되는 것을 막는다).
2. `audio.setPaused(true)`(마을 포함 — 숨은 탭에서 소리가 나지 않는다).
3. `screen === 'boss'` && 패널 없음 && `fight.phase ∈ {intro, fight}`일 때만 pause를 연다. 다른 패널(result · 시설)이 열려 있으면 아무것도 열지 않는다(`openPanel('pause')`가 무시한다 — §10.1).
4. (W5 확정) **전이 중(페이드 0.3초)에 잃은 포커스는 전이가 끝난 직후에 다시 본다** — `ScreenMachine.unfocused`(`focusLost()` ~ `focusBack()`)가 참이고 도착한 화면이 보스전이면 그때 pause를 연다(안개문 `E`, `E` · 결과의 `R` 직후 Alt+Tab).
5. (W5 확정) 탭이 숨었거나(`hidden`) 창이 포커스를 잃었으면 `AudioContext`를 `suspend()`한다(덕킹만으로는 낮은 드론이 계속 난다). 돌아오면 `resume()`. 단 창은 보이는데 포커스만 없고 보스전이 멈추지 않은 채 돌고 있으면(`?nopause` · 일회용 세션) 재우지 않는다(멈춘 시계에 효과음이 쌓인다).

복귀(`focus` / `visible`): `audio.setPaused(paused)`, 루프의 기준 시각을 현재로 다시 잡고 `acc = 0`(돌아온 프레임에 틱이 몰아 돌지 않게).

**이탈 확인**: `screen === 'boss'` && `fight.phase === 'fight'`인 동안에만 `beforeunload`에서 `event.preventDefault()`(마우스 뒤로 가기 · 탭 닫기로 그 판이 통째로 사라지는 것을 막는다). 마을 · 결과에서는 걸지 않는다.

### 11.3 입력 수집 — `app/input.js` · `data/keybinds.js`

```js
export const KEYBINDS = {          // KeyboardEvent.code · 마우스는 'Mouse0'(좌) 'Mouse1'(휠) 'Mouse2'(우)
  moveForward: ['KeyW', 'ArrowUp'], moveBack: ['KeyS', 'ArrowDown'],
  moveLeft: ['KeyA', 'ArrowLeft'],  moveRight: ['KeyD', 'ArrowRight'],
  light: ['Mouse0'], heavy: ['KeyF', 'Mouse1'], guard: ['Mouse2'],
  roll: ['Space'], sprint: ['ShiftLeft', 'ShiftRight'],
  lockOn: ['KeyQ', 'Tab'], flask: ['KeyR'], interact: ['KeyE'], pause: ['Escape'],
};
export const GAMEPAD = {           // 표준 매핑 버튼 인덱스
  light: 5, heavy: 7, guard: 4, roll: 1, sprint: 1, lockOn: 11, flask: 2, interact: 0, pause: 9,
  deadzone: 0.18, lookSpeed: 900,  // 오른쪽 스틱 최대 기울임 = 초당 900픽셀 상당
  tapMax: 0.22,                    // B: 이 시간 안에 떼면 구르기, 넘기면 달리기
  navRepeat: 0.18,                 // 패널에서 D-pad/스틱을 누르고 있을 때 navigate 반복 간격(초)
};
```

`InputCollector`(내부 클래스)의 계약:

- `consume(camYaw) → InputFrame`: 한 틱분. 에지(`*Pressed`)는 **한 번 반환하면 지운다**. 한 프레임에 틱이 여러 번이면 첫 틱만 에지를 받는다. 틱이 0번인 프레임은 에지가 다음으로 넘어간다.
- 이동 변환: `fwd = forward − back`, `side = right − left`(길이 > 1이면 정규화) → `{moveX, moveZ} = localToWorld(0, 0, camYaw, fwd, side)` (§0.2 — 카메라 기준 앞 · 오른쪽).
- `consumeLook() → {dx, dy}`: 이번 프레임 누적 마우스 이동(픽셀) + 게임패드 오른쪽 스틱 환산분. 반환 후 0.
- `releaseAll()`: 모든 홀드 · 에지 · look 누적을 0으로(§11.2 창 포커스 잃음).
- `locked`(getter): 지금 포인터 락을 쥐고 있는가. 바뀔 때 app이 `ui.setPointerLocked(locked)`를 부른다.
- **리스너 타깃**: `mousedown` · `contextmenu` · `auxclick` · 포인터 락 요청은 **canvas**, `mouseup` · `mousemove` · `keydown` · `keyup` · `blur`는 **window**.
- **포인터 락**:
  - 락이 없을 때의 캔버스 `mousedown`은 **락 요청에만 쓴다** — 공격 · 가드 입력으로 내보내지 않는다(시점을 고정하려던 클릭에 칼이 나가지 않게).
  - 요청이 거부되거나(`pointerlockerror` · reject) 0.5초 안에 락을 얻지 못하면 삼키고 **드래그 모드**로 계속한다(pause로 보지 않는다): 마우스 버튼(아무거나)을 누른 채 끄는 동안만 `dx/dy`를 쌓는다. **한 번이라도 실패한 뒤에는 락 없는 클릭도 정상 입력으로 내보낸다**(자동화 · 락을 못 얻는 환경에서도 게임이 돈다). 캔버스를 클릭할 때마다 요청은 다시 해 본다.
  - `UI_OPENED`에서 app이 `exitPointerLock`(스스로 푼 것으로 표시), `UI_CLOSED`에서 다시 요청한다. 이 재요청은 사용자 제스처가 아니면 실패할 수 있다 — 실패해도 위 규칙대로 계속하고, HUD의 락 안내(§10.2)가 클릭을 유도한다.
- 브라우저 기본 동작 차단: `Tab` · `Space` · 화살표 · `contextmenu` · 휠 클릭(`auxclick`/`mousedown button 1`)에 `preventDefault`. **마우스 옆 버튼(뒤로/앞으로 — `button 3 · 4`)의 `mousedown` · `mouseup` · `auxclick`도 막는다**(게임 화면 · 패널 공통). **`Ctrl` 조합은 건드리지 않는다.**
- 패널이 열려 있으면(`ui.isBlocking()`) `consume`은 `NEUTRAL_INPUT`을 반환하고 에지를 버린다. **`UI_CLOSED` 뒤 0.15초 동안의 에지도 버린다**(패널을 닫은 `E` · `Q` · 클릭이 상호작용 · 록온 · 공격으로 새지 않게).
- (W5 확정) **홀드와 에지**: 홀드(`_held`)는 「지금 물리적으로 눌려 있는가」다 — UI가 처리한(`defaultPrevented`) keydown · 자동 반복(`repeat`) keydown도 홀드에 넣고 `keyup` · `blur`에서 뺀다. 에지(`*Pressed`)만 「UI가 처리하지 않은 · 반복이 아닌 keydown」에서 선다. 캔버스 밖(패널 · 전환 막)의 `mousedown`은 `window`(capture)에서 듣고 **버튼의 홀드만** 기록한다(에지 없음) — 전환 막이 덮인 동안 미리 쥔 우클릭(가드) · 이동 키가 막이 걷힌 뒤 그대로 먹는다.
- (W5 확정) **`SCREEN_CHANGED` 뒤 0.5초 동안의 에지를 버린다**(막이 걷히는 0.4초 + 여유). 그 창에서 버려진 입력과 같은 입력이 0.35초 안에 다시 오면 그것도 버린다 — 연타가 멎은 뒤의 첫 입력부터 받는다(결과 · 타이틀을 넘기던 `E` 연타가 화톳불 패널 → 레벨업으로, `R` 연타가 풀피 플라스크로 이어지지 않게). 일시정지 재개 같은 `UI_CLOSED`만의 경우는 0.15초뿐이다(전투 중 입력이 씹히지 않는다).
- (W5 확정) `mousemove` 한 번의 이동량은 **버리지 않고 자른다**: 상한 = `max(300px, 90° ÷ (CAMERA.rotSpeed × mouseSensitivity))`. 락을 얻은 직후의 첫 `mousemove` 하나만 버린다(튐).
- (W5 확정) 게임패드: 패널에서 B(`cancel`)를 누른 채 패널이 닫히면 그 B를 뗄 때까지 구르기 탭으로 보지 않는다. 쓰던 패드가 사라지면 `handlers.onPadLost()`(§11.2).
- 패널이 열려 있는 동안 게임패드는 `ui.navigate(dx, dy)`(D-pad · 왼쪽 스틱, `navRepeat` 간격) · `ui.confirm()`(A) · `ui.cancel()`(B)으로 넘긴다. 키보드의 패널 조작은 UI가 직접 듣는다(§10.1). Start는 Esc와 같다.
- 봇 조종이 켜져 있으면 `consume` 대신 `bot.decide(sim.state)`를 쓴다.
- 첫 키/클릭에서 `audio.unlock()`. (W5 확정) 클릭은 캔버스뿐 아니라 **화면 어디든**(패널 버튼 포함 — `window` capture의 `mousedown` · `pointerup`)이다 — 타이틀을 마우스로 넘겨도 소리가 난다.

### 11.4 저장 — `app/storage.js`

```js
export function loadSave()                // → {save: SaveData|null, broken: boolean}
                                          //   localStorage[SAVE_KEY] → loadProfileFromText(text)(§6.6: parse → migrate → sanitize → validate).
                                          //   텍스트가 있는데 null이면(깨짐 · 미래 버전 · 검증 실패) 원문을 SAVE_BACKUP_KEY에 복사하고 {save: null, broken: true}
export function writeSave(profile)        // createSaveData(profile, Date.now()) → serializeSave → setItem(SAVE_KEY). 실패해도 던지지 않는다
export function clearSave()
export function loadSettings()            // → Settings. localStorage[SETTINGS_KEY] → JSON.parse → sanitizeSettings. 없거나 깨졌으면 DEFAULT_SETTINGS의 복사본
export function writeSettings(settings)   // setItem(SETTINGS_KEY). 실패해도 던지지 않는다
```

- **프로필과 설정은 다른 키다.** 세이브가 깨지거나 지워져도 감도 · 볼륨은 남는다.
- **프로필 저장 시점**: `MODE_CHANGED`(마을 · **보스전 진입 모두** — 도전 횟수가 남아야 다음 판의 시드가 달라진다) · `PROFILE_CHANGED`(구매 · 레벨업 · 보상) · `REWARD_GRANTED`. 이벤트마다 쓰지 않고 **더티 플래그를 세워 그 프레임 끝에 한 번** 쓴다 → `SAVED`.
- **`screen ∈ {town, boss, result}`일 때만 쓴다.** `boot` · `title`에서는 어떤 이벤트에도 `writeSave`를 부르지 않는다 — 타이틀 배경용 `enterTown()`이 빈 프로필을 저장해 「이어하기」가 켜지거나, 읽지 못한 세이브를 사용자 조작 없이 덮는 일이 없다.
- **설정 저장**: `SETTINGS_CHANGED`에서 `writeSettings`(화면 무관).
- `actions.hasSave()` = 부팅 때 `loaded.save !== null`이었거나 이 세션에서 한 번이라도 `writeSave`가 성공했다.
- localStorage가 없거나 막혀 있어도 게임은 돈다(읽기는 기본값, 쓰기는 무시).
- (W5 확정) `backupSave()`: 지금의 `SAVE_KEY` 원문을 `SAVE_BACKUP_KEY`에 복사한다(세이브가 없으면 아무것도 하지 않는다) — 「새 게임」이 덮기 직전에 부른다. `canPersist()`: 탐침 키를 썼다 지워 저장할 수 있는 브라우저인지 본다.
- (W5 확정) **`writeSave`가 실패하면 조용히 넘기지 않는다**: 한 번 `ui.setNotice('save', t('hud.notice.saveFailed'), 10)`을 띄우고 5초 뒤 다시 써 본다(창을 떠날 때 · 타이틀로 나갈 때는 기다리지 않고 쓴다). 성공하면 알림을 지운다.

### 11.5 디버그 API — `app/debugApi.js` → `window.__ashen`

| 메서드 | 동작 |
|---|---|
| `version` | `GAME_VERSION` |
| `getState()` | `structuredClone(sim.state)`(`profile` · `world` 포함) |
| `getProfile()` | `structuredClone(profile)` |
| `getScreen()` | `{screen, paused, panel, pointerLocked}` |
| `newGame()` · `continueGame()` | 타이틀을 건너뛰고 시작 |
| `toTown()` | 마을로 |
| `startBoss(bossId)` | 해금 무시하고 보스전 시작(페이드 포함. Promise 반환) |
| `openPanel(id)` · `closePanel()` | 패널 |
| `giveEmbers(n)` · `giveShards(n)` | `progression.grant` |
| `levelUp(statId, times = 1)` · `upgradeWeapon(weaponId, times = 1)` · `equipWeapon(weaponId)` | 진행 명령 |
| `setBot(on, opts)` | 봇 조종 on/off (`opts` → `createBot`) |
| `setTimeScale(x)` | 0.1~8 |
| `setGodMode(on)` · `setNoStamina(on)` | `sim.setDebug` |
| `damageBoss(amount)` · `setBossHp(frac)` · `killBoss()` | 보스 조작(`killBoss` = `damageBoss(1e9)`) |
| `forfeit()` | `sim.forfeitFight()` |
| `step(n = 1, input)` | 일시정지 상태에서 n틱 수동 진행. (W1 확정: **틱을 민 뒤 레이어 `update` + `rc.render`도 한 번 한다** — 숨은 탭 · 자동화 pane에서는 `requestAnimationFrame`이 돌지 않아, 이 메서드가 화면까지 밀어 줘야 §12.5 스모크의 스크린샷이 찍힌다. 일시정지가 아니어도 동작한다) |
| `setInput(partial)` · `clearInput()` | 다음 틱들의 입력을 덮어쓴다(자동화용) |
| `pause(on)` | 일시정지 |
| `events(n = 50)` | 최근 이벤트 로그 `[{t, name, payload}]`(`bus.onAny`로 200개 링 버퍼) |
| `errors()` | `window.onerror` · `unhandledrejection` 수집 목록 |
| `sim` · `bus` · `progression` | 원본 참조(콘솔용) |

### 11.6 최소 부트 — W0의 `src/main.js` (P0이 쓰고, W2에서 P9가 통째로 교체)

W0의 `main.js`는 빈 스텁이 아니라 **돌아가는 최소 부트**다. 목적: W1의 view · ui 패키지(P5~P8)가 자기 레이어를 실제 화면에 띄워 실루엣 · 텔레그래프 · HUD 가독성을 눈으로 확인한다(우선순위 1번의 결함을 통합 전에 잡는다).

- §11.1의 순서로 `bus → profile(createNewProfile(1)) → Progression → GameSim → createRenderContext → WorldLayer → CameraRig → CharacterLayer → FxLayer → AudioEngine → UIRoot`를 만든다. **모듈마다 `try { const m = await import('…'); … } catch (e) { console.error(e); }`로 감싼다** — 실패한 레이어는 건너뛰고 나머지로 돈다(남의 작업 중 파일이 깨져 있어도 자기 레이어는 뜬다).
- §5.4 루프 + 최소 입력: `WASD` · `Shift` · `Space` · `F` · `R` · `Q` · `E` · 마우스 버튼 3개 → `makeInput`, 마우스 버튼을 누른 채 드래그 = 카메라. 포인터 락 · 게임패드 · 일시정지 · 저장은 없다.
- 쿼리: `?boss=valder|fenrir|nihil`이면 `sim.startBossFight(id)`, 없으면 `sim.enterTown()`. `?panel=<PanelId>`면 그 패널을 연다. `?god=1`이면 `sim.setDebug({godMode: true})`.
- 최소 배선: `INTERACT` → `ui.openPanel(id)` · `FIGHT_ENDED` → `ui.openPanel('result', {reward, outcome, duration})` · Esc → `ui.closePanel()`. `actions`는 `startBoss(id)` → `sim.startBossFight(id)` · `retry()` → 같은 보스 · `toTown()` → `sim.enterTown()` · `resume()` → 닫기(각각 뒤에 `ui.closePanel()`), `hasSave()` → `false`, 나머지는 no-op.
- `window.__ashen = { sim, bus, progression }`.
- 임시 파일이므로 키 코드 · 수치를 이 파일 안에 둔다(100줄 안팎).
- (W1 확정) keydown 처리의 첫 줄에서 `event.defaultPrevented`면 돌아간다 — UI(패널)가 처리한 키가 게임 입력으로 새지 않는다(§10.1).
- (W3 확정 — P9가 실제 앱에서 정한 것을 계약으로 받는다. 세부는 `docs/NOTES-P9.md`) 개발용 쿼리: `?boss` · `?panel` · `?god` · `?town=1` · `?bot=1` · `?fresh=1` · `?save=1` · `?nopause=1`. **타이틀을 건너뛰는 쿼리(`boss` · `town` · `panel`)와 `fresh`는 일회용 세션이다** — `createNewProfile(1)`로 시작하고 프로필 세이브를 읽지도 쓰지도 않으며 포커스/락 상실로 멈추지 않는다(`save=1`이면 실제 세이브). `__ashen.step(n, input)`은 `ceil(n / 240)`틱마다 레이어를 갱신하고 렌더는 끝에 한 번, 입력 우선순위는 `input` 인자 > `setInput` > 봇 > 실제 입력, 에지는 첫 틱만. `__ashen.pause(on)`은 패널 없는 일시정지. 누산 루프의 스텝 상한은 `MAX_STEPS_PER_FRAME × ceil(timeScale)`(§5.4의 식은 정속에서만 그대로다). 포인터 락의 「실패」는 사용자의 캔버스 클릭에서 온 요청만 센다. `test/bot.fight.app.test.js`(누산기 · 화면 기계 · 저장)는 §1의 `<자기 테스트 이름>.*.js` 규칙 안의 P9 파일이다.

---

## §12 테스트 계획

### 12.1 게이트

게이트는 둘이다(§1 웨이브 표).

| 게이트 | 언제 | 기준 |
|---|---|---|
| **통합 게이트** | W0의 끝 · W3 | `npm run build` 오류 0(경고는 청크 크기 경고만 허용) · `npm test` 전부 통과. W3은 여기에 봇 대전 전 보스(§12.4) · 브라우저 스모크(§12.5)를 더한다 |
| **패키지 게이트** | W1 · W2 진행 중(패키지마다) | `node --test test/<자기 테스트 파일>`(§1 트리에서 자기 소유인 테스트 전부) 통과 + `npm run build`에서 **자기 파일이 원인인** 오류 0 |

- 병렬 웨이브 중에는 남의 파일이 작업 중이라 전체 `npm test` · `npm run build`가 깨질 수 있다. **남의 파일이 원인인 실패는 고치지 않는다** — `docs/NOTES-P#.md`에 한 줄 남기고 자기 게이트만 본다.
- 테스트 파일이 없는 패키지(P6 · P7 · P8)의 패키지 게이트는 빌드 + 최소 부트(§11.6)로 띄운 화면 확인(§12.5)이다.
- 테스트는 `node:test` + `node:assert/strict`만 쓴다(추가 의존성 없음). 한 파일이 30초를 넘기지 않는다(`bot.fight.test.js`만 90초까지).
- 웨이브 1의 각 패키지는 **자기 테스트 파일만** 책임진다. 다른 패키지의 구현에 기대는 테스트는 쓰지 않는다 — 필요한 상대 상태는 `test/helpers.js`의 리터럴 빌더(§6.8)로 만든다. 스텁(§6.9) 위에서도, 완성본 위에서도 통과해야 한다.
- 모든 sim 테스트의 공통 마무리: `assertFiniteDeep(state)`.

### 12.2 파일별 테스트 목록

**`core.test.js` (P0)**
- 각도 규약: `fromAngle(0) ≈ {0, 1}` · `fromAngle(π/2) ≈ {1, 0}` · `angleOf(1, 0) ≈ π/2` · `localToWorld(0,0,0, 0,1) ≈ {−1, 0}`(오른쪽 = −X) · `wrapAngle` 경계 · `angleDiff` 부호 · `turnToward`가 최단 호로 돌고 넘치지 않음 · `lerpAngle`이 ±π를 건넘.
- `distPointSegment` 끝점/중간. `damp` · `approach` 수렴.
- `createRng`: 같은 시드 → 같은 수열, `getState/setState` 왕복, `range/int/chance/pick` 범위.
- `EventBus`: 등록 순서 호출 · `off` · `once` · `onAny` · 리스너 예외 전파.
- `makeInput` / `NEUTRAL_INPUT` 동결.
- **셰이프 4종**(`core/hitShapes.js`): 명중/빗나감 경계(부채꼴 등 뒤 · 안쪽 반경 · 캡슐 끝 · 띠의 안쪽 구멍), `resolveShape`의 fwd/side/dirOffset, `ringFromGrow`의 u = 0 · 1.
- **충돌 기하**(`core/collide.js`): `resolveCircleVsWorld`(경계 안으로 · 원/상자 밀어내기) · `pushOutOfCircle`(중심이 겹쳐도 NaN 없음) · `circleOverlapsWorld` · `segmentHitsCircle`(관통 · 스침 · 빗나감 · 시작점이 원 안이면 0) · (W5 확정) `sweepCircleVsWorld`(원 · 상자 · 경계 · 맞닿은 채 파고듦/멀어짐).

**`layering.test.js` (P0)**
- `src/sim · src/data · src/core · src/bot`의 모든 `.js`에서 import 경로를 정규식으로 뽑아 §2 금지 의존이 없는지. (W0 확정: 같은 검사를 `view · audio · ui`에도 §2 표대로 건다 + sim 안의 순환 금지 지점 · 레지스트리 한 방향 · view 세 레이어 상호 import · 깨진 상대 경로 · `export default`.)
- 위 네 폴더의 코드(주석 · 문자열 제외)에 `window` · `document` · `navigator` · `AudioContext` · `localStorage` · `sessionStorage` · `performance.` · `Date.now` · `new Date` · `Math.random` · `requestAnimationFrame` · `THREE` 토큰이 없는지. (정규식 리터럴 안에 따옴표를 쓰면 주석 제거기가 오판할 수 있다 — 순수 계층에서는 피한다.)
- `GameSim`이 스텁이든 완성본이든 §3의 전 필드를 가진 상태로 뜨고(`structuredClone` 가능), 생성자는 이벤트를 내지 않고, `startBossFight` · `enterTown`의 첫 이벤트가 `MODE_CHANGED`다.
- 위 폴더의 모든 파일을 `import()` — 예외 없이 로드된다(Node에서).
- `EV`의 값이 서로 다르다. `BOSS_IDS`의 세 정의가 `getBossDef`로 나온다.

**`player.test.js` (P1)**
1. 이동: 걷기 속력이 `walkSpeed`로 수렴, 달리기는 `sprintSpeed` + 초당 12 소모, 록온 시 보스를 향한다.
2. 구르기: 길이 0.62초, 이동 거리 4.2 ± 0.15, `iframe`이 정확히 [0.03, 0.40) 구간에서만 true, 소모 22, 방향 입력 없으면 `backstep`. **`roll` 진입 틱에 `facing`이 구르는 방향으로 스냅되고(록온 중에도) `actAt`까지 고정, `backstep`은 facing 불변.**
3. 약공격: 구간 전환 시각(예고 → 판정 → 후딜)이 표와 ±1틱, `getPlayerHit`은 판정 구간에만 non-null이고 `hitId`가 휘두르기 동안 같다, `damage` 공식. **시작 스냅: facing이 보스 반대인 상태에서 록온 약공격 → 판정 시작 시 보스 방향 ±0.2 rad.**
4. 연속기: 후딜 중 선입력 → `comboAt`에 다음 타 시작, 마지막 타 뒤에는 후딜 끝까지 대기. **강 → 강은 `comboAt`이 아니라 후딜이 끝난 틱에 시작**(약 → 강, 강 → 약은 `comboAt`).
5. 선입력: 구르기 중 약 → `actAt`에 `rollAtk`. `buffer`(0.35초)가 지나면 소멸(W3 확정: 경계는 `flask` 상태에서 잰다), **`bufferLongStates`(공격 · 구르기 · 백스텝 · 경직 · 넉다운 · 기상)에서 저장한 입력은 `bufferAttack`(0.70초)** — 구르자마자 연타한 두 번째 구르기가 첫 구르기의 `actAt`에 나간다 — 대검 `light1` 시작 0.2초의 클릭이 `comboAt`에 `light2`로 나간다. `dead`를 뺀 모든 상태(`guardBreak` · `knockdown` · `execute` 포함)가 버퍼를 받는다. 우선순위 `roll > flask > heavy > light`. 버퍼된 구르기의 방향(소비 틱의 이동 의도 → 저장된 방향 → 백스텝).
6. 강공격 차지: 홀드 → `charge` 구간(최대 `chargeMax`), 일찍 놓으면 그만큼만, 피해 배율 `1 → chargeDmgMul` · **체간 배율 `1 → PLAYER.chargePostureMul`**, `PLAYER_CHARGE_FULL`.
7. 대시 공격 조건(`sprintTime ≥ 0.30`).
8. 가드/패링: `guarding` 플래그, `parryActive` 길이 = `stats.parryWindow`, 놓았다 바로 다시 눌러도 `rearm` 동안 창이 없다. **창은 가드 입력의 상승 에지에서만 열린다 — 홀드를 유지한 채 구르기 · 공격 · `guardHit` 뒤에 `guard`로 돌아오면 `parryActive`가 false.** 에지 뒤 `pressGrace` 안에 `guard`에 들어가면 창이 열린다.
9. 스태미나: 0 → `exhausted` · `PLAYER_STAMINA_OUT`, `exhaustedUntil`(16)까지 달리기/가드 불가, 회복 지연(`exhaustedDelay` 0.75). (W3 확정) 탈진한 채 다시 0을 찍어도 `PLAYER_STAMINA_OUT`을 다시 내지 않고 지연은 `regenDelay`다.
10. 플라스크: 0.70초에 회복 · 차감, 그 전에 피격 → 차감 없음, 0개면 `empty`, `guard`에서 누르면 바로 마신다, 공격 후딜의 `rollCancelAt` 이후에 나간다.
11. `onPlayerDamaged` 전이 6종(표 그대로) + `knockVel` 감쇠. 가드 피격 → `staminaDelay`, 가드 붕괴 → `exhausted` · `PLAYER_STAMINA_OUT`. `hit` · `parry` 직후 `iframe === true`. `getup`이 끝난 틱에 `hurtInvuln = wakeInvuln`.
12. 처형: 조건 충족 시 `execute`, `hitAt`의 한 틱에 `execute:true` 판정, 조건 불충족 시 일반 공격. **`canExecute`가 조건(거리 · 정면각 · 상태)과 같이 움직인다.** 처형 중 `attack` 필드와 `PLAYER_SWING{moveId:'execute'}`.
13. `bufferPlayerInput`은 `stateTime`을 움직이지 않는다. **히트스톱 틱의 `lockOnPressed`는 즉시 토글된다**(`LOCKON_CHANGED`).
14. 무기 3종 × 전 무브를 한 번씩 끝까지: 예외 0 · NaN 0 · 표의 필드 완비.
15. `hp`를 직접 0으로 쓰면 다음 틱에 `dead`.

**`combat.test.js` (P2)**
- 플레이어 피격: 무적 → `dodge` + 레지스트리 등록(같은 hitId 재명중 없음) · 정면 패링 vs 등 뒤(패링 불가) · 패링 불가 공격은 가드로 · 가드 경감/스태미나(**순환 배율은 스태미나에 실리지 않는다**) · 가드 붕괴 · 일반 피격 · 마을/`godMode`에서 피해 없음.
- **틱당 피격 1회**: 같은 틱에 보스 타격 + active 장판(또는 투사체)이 겹쳐도 `HIT`(target player)는 1회, 건너뛴 판정은 레지스트리에 없다.
- **투사체 패링**: `parryable` 투사체를 패링 창에서 맞으면 소멸(`PROJECTILE_ENDED{reason:'parry'}`) · 보스 체간 `parryPosture × projectileParryPostureMul` · `onBossParried` 미호출. `parryable:false` 투사체는 가드/피격.
- 보스 피격: 체간 누적 · `postureBroken` · 그로기 중 치명 배율 · `invulnerable` → `immune` · 처형 자동 명중 · `fight.damageDealt`가 hpMax를 넘지 않음. **`bodyParts`: 중심 원에서는 빗나가는 타격이 머리 원에는 맞는다.**
- 히트스톱 요청: max 병합 · 상한. `hitLog` 길이 상한.
- 투사체: 유도 → 직선 전환, 플레이어 명중, 기둥/경계 소멸, 수명. 장판: warn → active → 제거, interval 반복(틱마다 새 hitId), `grow` 띠 반경. `'clear'` 정리.
- 충돌 해소(§5.1 G): 플레이어만 보스에게서 밀림 · `bodyParts`의 모든 원이 민다 · 죽은 보스는 밀지 않는다 · **벽 앞 플레이어 + 미는 보스 → `len(player.pos) ≤ world.radius − radius`**(G4) · (W3 확정) **돌진 중에는 옆으로 비켜 세운다** — 돌진선 위의 플레이어가 진행 방향으로는 한 치도 밀리지 않고, 한 틱의 옆 이동 ≤ `chargeShoveSpeed × DT`.

**`gamesim.test.js` (P2)**
- 생성자는 이벤트를 내지 않는다. 생성 직후 마을, `enterTown`/`startBossFight`의 이벤트 순서(`MODE_CHANGED → FIGHT_STARTED → FIGHT_PHASE`). 보스전 시작 시 `player.lockOn === true` · `LOCKON_CHANGED`.
- **플러시 재진입**: `INTERACT` 리스너 안에서 `restAtBonfire()`를 불러도 `INTERACT` 1회 · `PLAYER_RESTED` 1회만 발행된다.
- 히트스톱 틱: `time` 정지 · `prevPos === pos` · 선입력 보존.
- 보스전 흐름(스텁/합성 보스): `debugDamageBoss`로 격파 → `BOSS_DEFEATED` → `REWARD_GRANTED` → outro → `FIGHT_ENDED`. 플레이어 사망 흐름도 같다(HP 기준 — P1 · P3가 스텁이어도 돈다). 승리 틱에는 플레이어가 맞지 않는다. 디버그로 둘 다 0이면 승리.
- **맞교환**: 같은 틱의 플레이어 타격이 보스 공격을 중단시켜도(그로기) 그 틱에 수집한 보스 판정은 플레이어를 때린다.
- `forfeitFight`: `fight` 중에만 사망 보상 지급 · `phase 'done'` · `FIGHT_ENDED` 없음. intro · 마을에서는 no-op.
- `fight.phase === 'done'` 이후 세계 정지.
- 텔레그래프: `telegraph:true` 공격 예고 중 `state.telegraphs`에 나타나고 `progress`가 단조 증가.
- 마을: 시설 근처 `nearFacility`(부활 지점에서 바로 `bonfire`) · `INTERACT` · 허수아비 타격(`HIT` target dummy) · `PROFILE_CHANGED` → 능력치 재계산 + `player.hp === stats.hpMax`.
- **`data/world.js` 검사**(§6.4): 스폰 · 허수아비의 콜라이더 여유 1m, 스폰 사이 시선. (W3 확정) 마을 콜라이더 8개 · 안개문 벽 상자 · **막을 향해 걷든 기둥 바깥으로 돌든 문 뒤(z > 15.5)에 닿지 못한다**.
- **결정성**: 같은 시드 · 같은 입력 열 → 600틱 뒤 `JSON.stringify(state)`가 같다. `structuredClone(state)` 성공.

**`boss.framework.test.js` (P3)** — 합성 `BossDef`로
- 구간 타이밍(`tA`) · `BOSS_ATTACK_WINDUP/ACTIVE/END`(payload의 `seq`가 인스턴스마다 증가) · 배속(`speedMul`)과 최소 예고 `BOSS_AI.minWindup`.
- 추적 → `lockLead`에 고정(이후 facing 불변) · `activeTurnRate` · `sweep`(텔레그래프 facing은 고정 방향 `L`).
- 이동 4종의 변위 · `leap`의 `y` 포물선 · 조준점 고정.
- 타임라인 이벤트 5종이 정확히 한 번씩 · `phase` 조건 · `count/interval` · 중단 시 폐기 · 순간이동이 `prevPos`도 덮음 · 아레나 안.
- 다단 히트 · `interval` 틱마다 hitId 갱신.
- AI: 거리/각/쿨다운/페이즈 필터 · 직전 공격 감쇠(시드 200개 통계) · 후보 없음 → chase → 3초 뒤 fallback · 플레이어 사망 시 공격 안 함.
- (W3 확정) 고민하는 동안의 움직임(§8.6): 선호 거리 밖이면 `chase`로 걸으며 고민(고민이 끝나야 고른다) · kite 보스는 가까우면 물러난다 · 뒤를 잡히면 `rearChance` 확률로 돌아서지 않고 `think × rearThinkMul` 뒤 등 뒤 공격. (합성 정의의 기본 `preferredRange`는 6 — 보스가 선 자리가 선호 거리 안이라 나머지 테스트는 제자리 고민을 본다.)
- 연속기 확률/거리 조건/최대 3회.
- 체간 감쇠 · 패링당함 · 그로기 → recover · 처형 반응 · 처형 중 그로기 타이머 정지 · **그로기를 벗어나는 세 경로(처형 · 자연 종료 · 사망) 모두 `BOSS_GROGGY{on:false}`**.
- 페이즈 전환: 50%에서 예약 → 후딜 끝에 `phaseShift` · 무적 · `dmgMul/speedMul` 갱신. 사망이 최우선.
- **폴링**: `boss.hp`를 직접 낮추면 다음 틱에 페이즈 예약/사망, `boss.posture`를 직접 가득 채우면 다음 틱에 `groggy`.
- 훅 8종이 불린다. `validateBossDef`가 §8.9의 각 규칙 위반을 잡는다.

**`boss.valder.test.js` (P3)** · **`boss.fenrir.test.js` (P10)** · **`boss.nihil.test.js` (P11)**
- `validateBossDef(def)`가 빈 배열. 머리 필드의 HP · 보상 · 반경이 §8.10~12와 같다.
- 공격 전부를 `forceAttack`으로 하나씩 끝까지: 예외 0 · NaN 0 · 히트가 있는 공격은 `getBossHits`가 판정 구간에 non-empty · 이벤트가 있는 공격은 투사체/장판/순간이동이 표의 개수만큼.
- 2페이즈 전용 공격은 1페이즈에서 선택되지 않는다.
- 가만히 서 있는 플레이어를 상대로 60초: 보스가 공격을 4종 이상 쓰고, 플레이어 원과 겹치는 판정(`getBossHits`의 셰이프 · `spawned` 장판/투사체)이 한 번 이상 나온다(`makeTestCtx` 위에서 — P2의 판정 해소에 기대지 않는다).
- 보스별: (발더) 2페이즈에서 `ext.enchanted` · 충격파 장판 / (펜리르) `bodyParts` 3개 · 브레스 다단 히트 · 백홉이 뒤로 이동 · 얼음 가시 개수(2페이즈: `ice_spikes` 6 · `pounce` 6 · `charge` 1 · `frost_breath` 4. 1페이즈의 `pounce` · `charge` · `frost_breath`는 0) / (니힐) 순간이동이 아레나 안 · 구체 3/5발(`parryable`) · 광선 회전 각 · 검 비 개수 · `boss.y === hoverY`.

**`progression.test.js` (P4)**
- `levelUpCost` 표 값(W3 확정: 0→60, 1→68, 2→76, 3→84, 10→140, 20→220, 30→300, 40→380, 159→1332). 기본 `StatBlock`이 §7.4와 같다.
- 구간 경계(15↔16, 30↔31), 능력치 4종 각각, 상한 40, 무기 강화 배율, 유물 7종의 효과와 2칸 조합.
- `previewLevelUp`의 before/after · `changes`(바뀐 필드만 · 표시 순서) · `diminished`(15 · 30점 경계) · `nextCost` · `affordableCount`. `affordableLevelUps`(잔불 276 · 0점 → 3).
- `Progression` 명령 성공/실패(잔불 부족 · 파편 부족 · 최대 · 미보유) · 이벤트 · 실패 시 profile 불변.
- **따라잡기 강화**: 장검 +4일 때 대검 +0 → +1 = 잔불 40 · 파편 0(`getWeaponInfo().catchUp === true`). 가장 높은 무기는 정가.
- `buy('relic:<id>')`: 빈 칸에 자동 장착(`RELIC_EQUIPPED`) · 두 칸이 차 있으면 보유만. `equipRelic`: 미보유 불가 · 같은 유물 두 칸 불가(W1 확정: 다른 칸의 유물을 고르면 실패가 아니라 두 칸을 맞바꾼다 — §6.6) · null로 해제.
- `getShopItems`의 `valueNow/valueNext/equippedSlot` · `getBossList`의 `victoryEmbers/victoryShards/shardsLeft`.

**`economy.test.js` (P4)**
- 사망 보상(발더 · 순환 0): f = 0 → 0 · f = 0.05 → 66 · f = 0.10 → 132 · f = 0.30 → 276 · f = 1(사망) → 780. 승리 1200. 재도전 감쇠 1 · 0.5 · 0.25. `ash_idol` 배율.
- **브리프 보증**: f = 0.30 보상(276)으로 새 프로필의 `affordableLevelUps` ≥ 2(실제 3) · f = 0.10 보상 ≥ `levelUpCost(0)`.
- **전선 보증**(§7.7 (4)): 표의 열두 줄(순환 0~3 × 세 보스 — n은 봇 메타 루프의 평균 진입 점수)에서 f = 0.30 사망 잔불 ≥ `levelUpCost(n)` + 순환 4 이상은 마지막 한 점(n = 159)까지. (W3 확정 — W1에는 앞의 네 줄뿐이었고 순환 2부터는 성립하지 않았다.)
- 파편: 구간은 순환당 한 번씩, 승리 시 남은 구간 + 3, 재격파 1 · 2번째는 1개, **3번째부터 0**. 보스별 · 순환별 합 ≤ 8.
- 해금 순서 · 세 보스 격파 시 `cycle += 1`과 초기화 · `getCycleScaling` 값(c = 0 · 1 · 8 · 12 — W3 확정: hp 1 · 1.5 · 5 · 6, dmg 1 · 1.2 · 2.6 · 3) · `weaponUpgradeCost` 표(+ `catchUp`).
- `applyReward`가 `totals`(playTime · embersEarned · kills · deaths)를 갱신한다.
- `computeReward`는 profile을 고치지 않는다(전후 깊은 비교).

**`save.test.js` (P4)**
- 왕복(`serialize → loadProfileFromText`) 후 깊은 동등. 깨진 JSON → null. 미래 버전 → null. v0 픽스처(임의의 옛 형태 하나) → v1.
- `sanitizeProfile`: 빠진 필드는 기본값 · 범위 밖 값 자르기(stats 99 → 40 · weapon level 15 → 10 · embers NaN → 0) · 모르는 유물 제거 · 무효 `equippedWeapon` → `'longsword'` · 미보유 유물 장착 해제.
- `sanitizeSettings`: 범위 clamp · 모르는 `quality` → 기본값. `validateProfile`.

**`rig.test.js` (P5)** — Node에서 three만으로(WebGL 없이)
- 리그 3종: 표준 관절 · 소켓 이름이 전부 있다. `applyPose` 뒤 `updateMatrixWorld` — NaN 0. 포즈를 바꾸고 `root.updateMatrixWorld(true)`를 부르면 소켓의 월드 위치가 따라 바뀐다.
- `lerpPose`/`attackPose`의 끝점 — `releaseT = 0`: 예고 p=1 → windup 포즈, 판정 p=1 → active 포즈, 후딜 p=1 → idle. `releaseT = 0.3`: 예고 p=0.7 → windup 포즈, p=1 → `lerp(W, A, 0.35)`, 판정 p=0이 그 포즈와 같다(끊김 없음). `bossReleaseT(0.9) = 0.2` · `bossReleaseT(0.2) = 0.4`.
- `valderView.js`가 export 하는 `VALDER_POSES`의 키가 §8.10의 pose 9종을 포함한다(`delayed.holdAt === 0.35`). 플레이어 `MOTIONS`가 motion 7종을 포함한다.
- 실루엣 규칙: 발더의 각 포즈에서 windup과 active의 `weaponTip` 월드 위치가 2m 이상 떨어진다.

**`bot.fight.test.js` (P9)** — §12.3 · §12.4

**`regress.w5.test.js` (W5 확정 — 리뷰 지적의 회귀. 실제 `GameSim`으로)**
- 체간 루프: 대검 + 기량(완충 강공격의 체간 ≥ `postureMax`)의 무적 · 스태미나 무한 플레이어가 「일어나는 틱에 맞춘 완충 강공격」을 반복해도 **그로기와 그로기 사이에 `BOSS_ATTACK_ACTIVE`가 한 번은 나온다** · 한 타의 체간 ≤ `postureMax × postureHitCap` · 잠금 중 체간 0(보스 3 · 순환 0/3).
- 도약 × 기둥: 펜리르 `pounce`를 기둥 뒤의 플레이어에게(축 위 · 0.5m · 2m 옆) — 틱당 이동 ≤ 순항의 1.5배 · 공중 정지 0틱 · 착지 판정 = 마지막 표식(±0.05m) · 기둥과 겹치지 않는다.
- 근접 판정 = 보이는 것: 표식 없는 근접 타격 9종의 판정 도달 거리가 **뷰 메시의 도달 거리 − 0.3m ~ + 0.7m** 안(헤드리스 `CharacterLayer`로 잰다) · 선택/연속기 거리의 끝에 선 플레이어에게 닿는다 · 발더 `slash_r`의 칼끝 밖 4.5m는 맞지 않는다.
- 탭 패링: 판정 0.10초 전에 누르고 1~5틱만에 떼도 `parry`.

### 12.3 헤드리스 봇 — `bot/bot.js` · `data/bot.js`

```js
// data/bot.js (P9 · 시드)
export const BOT = {
  dodgeChance: 0.85, reaction: 0.18, aggression: 1,       // createBot 기본값
  threatPad: 0.6, hazardPad: 0.3,                          // 위협 판정 여유(m)
  ringNear: 1.5, projLead: 0.4,                            // 충격파 띠 접근 거리(m) · 투사체 반응 시간(초)
  bigRadius: 4,                                            // 이보다 큰 원/띠는 중심 쪽으로 굴러 뚫는다(m)
  healBelow: 0.4, healSafeDist: 7, healRecovery: 1.2,      // 회복: HP 비율 · 안전 거리(m) · 보스 남은 후딜(초)
  executeStand: 1.6,                                       // 처형하러 설 지점 = 보스 정면 radius + 이 값(m)
  punishRecovery: 0.45, reachPad: 0.3, attackStamina: 25,  // 반격: 남은 후딜(초) · 사거리 여유(m) · 필요 스태미나
  sprintDist: 8, sprintStamina: 40, retreatStamina: 20,    // 거리 유지
  // (P9 추가) seed · attackCommit · edgeBand · wallMargin · projAimCos · flaskDrift · memoryMax — data/bot.js 참조
  guardStamina: 20,                                        // (W3 확정) 막을 수 있는 투사체를 가드로 받는 데 필요한 스태미나
  coneNear: 3, coneInward: 0.9,                            // (W3 확정) 지속 판정에서 벗어나는 방향: 이 거리(m)보다 멀면 보스 쪽을 이 비중으로 섞는다
};
```

`createBot({seed, dodgeChance = BOT.dodgeChance, reaction = BOT.reaction, aggression = BOT.aggression})`. 매 틱 `decide(state) → InputFrame`. 자체 시드 난수를 쓴다(`createRng`). 규칙(위에서부터 우선. 본문의 숫자는 `BOT`의 값이다):

1. **없음**: 보스가 없거나 플레이어가 `dead`거나 `fight.phase === 'done'` → `NEUTRAL_INPUT`.
2. **록온**: `!player.lockOn`이면 `lockOnPressed`.
3. **위협 평가** — 가장 이른 피격 예상 시각 `tHit`:
   - 보스 공격: 현재 공격의 각 hit 셰이프를 보스 현재 위치 · facing(또는 조준점)으로 풀어 플레이어 원(+0.6m 여유)과 겹치면, 예고 중이면 `남은 예고 + t0`, 판정 중이면 0.
   - 장판: `warn` 중인 장판이 플레이어(+0.3m)를 덮으면 `warn − t`. `active` 장판(충격파 띠)이 1.5m 안으로 다가오면 `거리 / 띠 속도`.
   - 투사체: 플레이어를 향해 오고 `거리 / 속도 ≤ 0.4`이면 그 값.
4. **구르기**: `tHit ≤ reaction`이고 구르기가 가능하면(스태미나 > 0 · 상태 허용) — 공격 인스턴스당 한 번 `rng.chance(dodgeChance)`를 굴려 성공이면 `rollPressed`. 방향: 기본은 보스 방향에 수직(인스턴스 번호의 홀짝으로 좌우), 큰 원/띠(반경 > 4m)는 **중심을 향해**(무적으로 뚫는다), 돌진 선은 선에 수직.
   - (W3 확정) **4a. 막을 수 있는 투사체는 가드로 받는다**: 가장 이른 위협이 `guardable` 투사체이고 `!exhausted && stamina ≥ guardStamina`이면, 같은 주사위(인스턴스당 `dodgeChance`)가 성공일 때 닿을 때까지 `guard`를 쥔다(구르지 않는다). 스태미나가 모자라면 규칙 4대로 구른다. 유도 구체는 0.25초 간격으로 3~5발이 와서 구르기 한 번의 무적(0.37초)으로 다 흘릴 수 없다 — W2의 봇은 구체에 가장 많이 맞았다(니힐 피격의 46~70%). 봇은 여전히 패링 · 강공격을 쓰지 않는다.
5. **장판 탈출**: `warn` 장판 안이고 `tHit > reaction`이면 중심에서 멀어지는 방향으로 달린다.
   - (W3 확정) **지속 판정도 달려 나간다**: 보스의 판정이 `interval > 0`(브레스)이고 방향이 고정됐으면(`attack.locked`) 부채꼴 밖으로 달린다 — 서 있는 쪽 가장자리를 향해, 보스에서 `coneNear`(3m)보다 멀면 「보스 쪽」을 `coneInward`(0.9) 비중으로 섞어 옆구리로 비스듬히 파고든다(부채꼴은 보스 쪽이 좁고, 벗어난 자리가 곧 반격 자리다. 옆으로만 달리면 5m 밖에서는 판정 중의 추적 0.9 rad/s를 따돌리지 못해 둘째 틱에 맞는다 — 완벽 회피 봇의 브레스 피격률 35% → 4%). 구를 때도 같은 방향이다. 고정 전(추적 중)에는 달아나지 않는다.
6. **회복**: `hp / hpMax < 0.4` && `flasks > 0` && (거리 > 7m || 보스가 후딜 중이고 남은 후딜 > 1.2초) → `flaskPressed`. 조건이 안 되면 보스에게서 멀어지며 달린다.
7. **처형**: `boss.state === 'groggy'` → 보스 정면 지점(`boss.pos + fromAngle(boss.facing, radius + 1.6)`)으로 이동, **`player.canExecute`면** `lightPressed`(조건식을 봇이 다시 계산하지 않는다).
8. **반격**: (보스가 후딜 중이고 남은 후딜 ≥ 0.45초) 또는 `parried` 또는 (`idle/chase`이고 `aggression` 확률) && 거리 ≤ `weapon.reach + boss.radius − 0.3` && `stamina ≥ 25` → `lightPressed`(공격 중이면 후딜에 들어설 때마다 다시).
9. **거리 유지**: 사거리 밖이면 보스 쪽으로(8m 넘고 스태미나 > 40이면 달리기). 사거리 안이고 보스가 예고 중이면 멈춰서 3을 기다린다. `stamina < 20`이면 물러난다.
10. 그 밖에는 사거리 끝에서 옆걸음.

봇은 `data/` · `core/`(셰이프 판정은 `core/hitShapes.js`)만 import한다. `GameState`를 읽기만 한다.

(W3 확정) P9가 규칙 1~10 안에 채운 것(`NOTES-P9` 「봇」 1~9)을 계약으로 받는다: 예고 중의 위협은 **보스가 전진 · 도약 · 돌진한 뒤의 자리**(바닥 표식이 있으면 그것)로 어림한다 · 이미 해소된 판정(`state.hitLog`)은 위협에서 뺀다 · 연속기 판정(`chain[].at`)이 남은 후딜에는 반격하지 않는다 · `recover`도 반격의 틈이다 · 위협이 `attackCommit`(0.6초) 안이면 새 공격을 시작하지 않는다 · 선입력한 구르기의 방향을 소비 틱까지 쥐고 있는다 · 구르기 도착점이 벽 · 기둥이면 반대쪽/중심 쪽. **`reaction`은 반응 지연이 아니라 「피격 몇 초 전에 구르기를 누르는가」다** — 봇은 예고를 틀리게 읽지 않는다. 사람과의 차이는 `dodgeChance`(공격마다 대응에 실패할 확률)로 넣는다: 기본 0.85는 숙련자, **0.55 · `aggression 0.6`이 「보통 사람」(= 숙련 고정)** 이고 밸런스는 이 설정으로 쟀다(§7.7).

### 12.4 봇 대전 통과 기준 (`bot.fight.test.js`)

| 시나리오 | 설정 | 통과 기준 |
|---|---|---|
| A 표준 | **그 보스의 도달 프로필**(아래 — W3 확정) · 봇 기본값 · 최대 300초(18000틱) | 예외 0 · 60틱마다 `assertFiniteDeep` · `fight.damageDealt > 0` · `fight.damageTaken > 0` · **`BOSS_PHASE_CHANGED` 발생** · `REWARD_GRANTED`와 `FIGHT_ENDED` 발생(승패 무관) · `reward.embers > 0` |
| B 사망 | 새 프로필 · `dodgeChance 0` · `aggression 0.3` · 최대 300초 | `PLAYER_DIED` → `REWARD_GRANTED{victory:false}` · `reward.damageFraction > 0`이면 `reward.embers > 0` · `profile.embers`가 `reward.embers`만큼 증가 |
| C 승리 | A의 프로필 · `godMode` · 최대 600초 | `BOSS_DEFEATED` → `REWARD_GRANTED{victory:true, embers = round(R)}` · 다음 보스 해금(니힐은 `cycleAdvanced` — 세 보스를 순서대로 잡았을 때) · **격파 시간 45~180초**(W3 확정 — 단언) · 로그 출력 |
| D 결정성 | A를 같은 시드로 두 번 | `outcome` · `fight.time` · `damageDealt`가 같다 |
| E 메타 루프(발더만) | 새 프로필 · 봇 `dodgeChance 0.55 · aggression 0.6`(숙련 고정) · 반복 도전. 사망마다 자동 구매 — 장착 무기 강화가 되면 강화 → 남은 잔불로 `str` · `vit`를 번갈아 `levelUp`. 격파하거나 12회에 닿을 때까지(판마다 최대 300초) | **단언**: 예외 0 · NaN 0 · f ≥ 0.10으로 죽은 첫 판 뒤 `affordableLevelUps ≥ 2` · **12회 안에 격파** · (W3 확정) **8회 이하**. **로그**: 판별 f · `fight.time` · 받은 잔불 · 산 것 · 격파까지의 도전 수 |
| F 메타 루프(세 보스 — W3) | E와 같은 봇 · 같은 자동 구매. 시드 3개 × (발더 → 펜리르 → 니힐 → 순환 1의 발더) | **단언**: 예외 0 · NaN 0 · 각 보스 12회 안에 격파 · **f ≥ 0.30으로 죽은 판 뒤에는 언제나 `affordableLevelUps ≥ 1`**(순환 1 포함) · 세 보스 격파 뒤 `cycle === 1` · 한 판 평균 55~150초. **로그**: 보스별 도전 수 · 판 길이 |
| G 통계(W3) | 보스마다: 도달 프로필 · 숙련 고정 봇 8판 + 「거리를 두는 합성 입력」(무적 · 2페이즈) 60초 × 2 | **단언**: 30초 넘게 양쪽 다 피해가 없는 구간(교착) 0 · 한 공격이 봇 대전의 60%를 넘지 않는다 · **정의의 모든 공격이 한 번은 나온다** · 보스가 걷는다(`chase` 시간 ≥ 1%) · 돌진(발더 `thrust_charge` · 펜리르 `charge`)이 일직선의 무적 플레이어를 0.6m 넘게 밀지 않고 지나친다 |

**도달 프로필**(W3 확정 — A · C · D · G가 쓴다. F의 평균 진입 성장에서 왔다): 발더 `{vit 4, str 4}` · 무기 +2 / 펜리르 `{vit 10, end 2, str 10}` · 무기 +3 / 니힐 `{vit 16, end 4, str 16, dex 2}` · 무기 +4. W2까지의 공용 프로필(`{vit 12, end 8, str 12, dex 6}` · +5)은 발더에게 과성장이라 C가 22~31초에 끝났다(`NOTES-P9`).

- (W3 확정) **펜리르 · 니힐의 A~D는 켜져 있다**(skip 없음 · `ASHEN_BOT_ALL` 환경 변수는 없앴다). 아래 두 줄은 W2의 경위다.
- **누가 언제 돌리나**: 테스트는 세 보스를 `BOSS_IDS`로 돈다. **W2의 P9 패키지 게이트는 발더의 A~E**다(그때 펜리르 · 니힐은 스텁 정의이거나 P10 · P11이 작업 중인 정의다 — 그 둘의 A~D는 실패해도 P9의 게이트가 아니다). **펜리르 · 니힐의 A~D는 W3 통합 게이트**다. P10 · P11의 패키지 게이트는 자기 `boss.<id>.test.js`뿐이다.
- A에서 봇이 2페이즈 전에 죽으면 **먼저 봇 규칙을 고친다**(보스 수치를 낮추지 않는다). W3에서 펜리르 · 니힐이 실패하면 통합 담당이 봇 규칙(`bot.js`)과 보스 데이터 중 어느 쪽을 고칠지 정한다.
- C의 소요 시간이 60~150초 범위에서 크게 벗어나면(봇은 사람보다 공격적이므로 45~180초를 허용) `docs/NOTES-P9.md`에 수치와 함께 기록한다.
- **E의 목표(단언이 아니라 W3이 보는 값)**: **8회 이하 격파 · 각 판 40~170초**(§7.7 (2)의 "숙련 고정" 하한을 잰다). 벗어나면 P9는 `docs/NOTES-P9.md`에 로그를 남기고, 통합 게이트가 **봇이 아니라 §7.5 · §8.10의 값**(사망 보상 기울기 · 레벨업 비용 · 발더 HP)을 조정한다 — §7 서두의 「패키지가 바꾸지 않는 값」을 바꾸는 유일한 경로다.
- E의 단언(12회 안에 격파)이 W2에서 깨지면 P9는 먼저 봇 규칙의 결함(회복 · 처형 · 반격 타이밍)을 고친다. 그래도 깨지면 로그를 `NOTES-P9.md`에 남기고 그 단언만 `{ skip: 'W3' }`로 넘긴다 — W3이 수치를 조정하고 skip을 푼다(P9는 P4 · P3의 데이터를 고치지 않는다).

### 12.5 브라우저 스모크

- **W1(P5 · P6 · P7 · P8 — 권장)**: `npm run dev` 후 최소 부트(§11.6)로 자기 레이어를 띄워 스크린샷 1장 이상을 확인한다 — `?boss=valder`(캐릭터 · 아레나 · 텔레그래프 · 보스 HUD), 쿼리 없음(마을 · 프롬프트), `?panel=bonfire`(패널).
- (W1 확정 — 환경 주의) 자동화 pane · 숨은 탭에서는 `requestAnimationFrame`이 거의 돌지 않는다(스크린샷을 찍는 순간에만 한두 프레임). 「10초 뒤」를 실제 시간으로 기다리지 말고 `__ashen.step(n)`(§11.5)으로 틱과 화면을 민다. CSS 전환(프롬프트 · 배너의 opacity)은 실제 시간으로 흐르므로 스크린샷에서 덜 진행된 채 찍힐 수 있다 — DOM 클래스로 확인한다.
- **W2(P9) · W3**: `window.__ashen`으로 `newGame()` → `getScreen().screen === 'town'` → `startBoss('valder')` → `setBot(true)` → 10초 뒤 `getState().fight.damageDealt > 0` → `errors().length === 0`. 타이틀 · 마을 · 보스전 스크린샷 각 1장에서 HUD가 읽힌다.
- 저장(P9): 타이틀에서 새로고침해도 `localStorage['ashen-cycle/save']`가 생기지 않는다 · 깨진 문자열을 넣고 부팅하면 `ashen-cycle/save.bak`에 원문이 남고 타이틀에 안내 한 줄이 뜬다 · 설정은 타이틀에서도 저장된다.

---

## §13 패키지별 완료 정의

공통: 자기 소유 파일(§1)만 고쳤다 · **자기 패키지 게이트(§12.1)를 통과한다** — 자기 테스트 파일 전부 + 자기 파일이 원인인 빌드 오류 0(P0과 W3은 전체 `npm run build` · `npm test`) · 이 문서의 공개 시그니처 · 이름 · 단위를 지켰다 · sim · bot의 수치를 로직에 박지 않았다(§0.4).

**P0 scaffold** (W0)
- §1의 **모든 파일**이 있다(다른 패키지 소유 파일은 §6.9의 스텁으로). `npm install` · `npm run build` · `npm test`가 스텁 상태에서 통과한다.
- `core/*` 완전 구현(`hitShapes.js` · `collide.js` 포함) + `core.test.js` · `layering.test.js` 통과.
- `types.js`에 §3 전부(+ §9의 `Pose` · `PoseSet`(= `{windup, active, follow?, holdAt?}`) · `BossView` · `RenderContext`, §10의 `UiActions` · `PanelId`).
- 시드 데이터(`player.js` · `weapons.js` 머리 필드 · `combat.js` · `world.js` · `bossCommon.js` · `camera.js` · `bot.js`)와 완성 데이터(`keybinds.js` · `settings.js` · `palette.js`)가 §7 · §8.6 · §9 · §11 · §12.3의 값과 같다. 스텁 보스 정의 3개(§8.8) · 스텁 보스 뷰 3개 · 레지스트리 3개(`data/bosses/index.js` · `sim/boss/hooks/index.js` · `view/bosses/index.js`).
- `test/helpers.js` 구현(§6.8 — P1 · P3 · P4의 생성 함수에 기대지 않는 리터럴 빌더).
- `src/main.js`는 §11.6의 **최소 부트**다 — `npm run dev`로 스텁만으로도 오류 없이 뜨고(빈 마을 · 캡슐 보스), `?boss=valder` · `?panel=bonfire`가 동작한다.

**P1 sim-player** (W1)
- §7.1 · §7.3의 전 동작이 `player.test.js` 15항목으로 검증된다. `weapons.js`에 3종 × 무브 전부(장검 7 · 대검 6 · 창 7).
- 조작이 씹히지 않는다: `dead`를 뺀 어떤 상태에서 누른 `light/heavy/roll/flask`도 버퍼에 들어가고(`buffer` 0.35초 · 공격 중 `bufferAttack` 0.70초), 그 안에 상태가 허용하면 실행된다. 히트스톱 중의 록온 토글도 먹는다.
- `iframe · guarding · parryActive · canExecute` 플래그가 매 틱 정확하다. 패링 창은 가드 입력의 상승 에지에서만 열린다. §4.2의 P1 이벤트를 전부 낸다.

**P2 sim-combat** (W1)
- `GameSim`이 §5.1 순서대로 돈다(I0 선수집 · 틱당 피격 1회 · G4 재클램프 · HP 기준 승패). 플러시가 재진입에 안전하다(§4.1). 판정 규칙이 §6.4와 같다(`bodyParts` · 투사체 패링 포함). 투사체 · 장판 · 충돌 · 마을 상호작용 · 허수아비 · 보스전 흐름 · `forfeitFight` · 보상 호출 · 텔레그래프 구성.
- `combat.test.js` · `gamesim.test.js` 통과(결정성 포함). P1 · P3 · P4가 스텁이어도, 완성본이어도 자기 테스트는 통과한다(합성 상태 사용).
- §4.2의 P2 이벤트를 전부 낸다.

**P3 sim-boss** (W1)
- 프레임워크가 §8.1~8.9를 구현하고 `boss.framework.test.js`를 통과한다. 프레임워크 코드에 보스 ID 분기(`if (id === 'valder')`)가 없다. 프레임워크 상수는 `BOSS_AI`에서 읽는다.
- 발더 데이터 9종 공격 + 훅, `boss.valder.test.js` 통과. `validateBossDef(VALDER)` = `[]`.
- P10 · P11이 프레임워크 파일을 고치지 않고 §8.11 · §8.12를 구현할 수 있다(이동 4종 · 이벤트 5종 · sweep · activeTurnRate · kite · 훅 8종 · HP/체간 폴링이 전부 동작).

**P4 progression** (W1)
- §7.4 · §7.5의 공식 · 표 · 유물 · 상점 · 따라잡기 강화 · 순환(softCap) · 저장(sanitize 사슬)이 구현되고 `progression/economy/save.test.js`를 통과한다.
- `economy.test.js`의 「브리프 보증」 두 항목과 「전선 보증」 네 항목이 있다.
- `Progression`의 모든 조회 메서드가 UI가 그대로 그릴 수 있는 값을 준다(추가 계산 불필요 — `changes` · `affordableCount` · `valueNow/Next` · `shardsLeft`).

**P5 view-characters** (W1)
- 리그 3종 빌더 · 포즈 수학(`attackPose`의 `releaseT` · `bossReleaseT` 포함) · `PoseBlender` · 플레이어 뷰(상태 15종 · motion 7종 × grip 3종) · 무기 메시 3종 · 발더 뷰(pose 9종 + 상태 10종) · 허수아비 · NPC 2명 · `CharacterLayer`.
- `rig.test.js` 통과. 예고 · 판정 · 후딜이 실루엣으로 구분된다(§9.5 실루엣 규칙). 보스의 무기는 판정 0.18초 전에 출발한다.
- `getSocketWorld('player'|'boss', 'weaponBase'|'weaponTip'|'chest'|'head')`가 **같은 프레임의** 위치를 준다(`update` 끝의 `updateMatrixWorld`).

**P6 view-world** (W1)
- `createRenderContext`(블룸 · 톤매핑 · 화질 3단계 · **스스로 하는 리사이즈**) · `WorldLayer`(마을 + 아레나 3테마, `data/world.js`와 배치 일치, 전환 시 생성 비용 0, 이벤트 없이도 `state`를 보고 전환) · `CameraRig`(궤도 · 록온(yaw 자동 · pitch 조절) · 경계 + 기둥 충돌과 올려다보기 · 흔들림 · `snapBehind`). 카메라 상수는 `CAMERA`에서 읽는다.
- 빌드 통과. Node import 시 최상위에서 DOM을 건드리지 않는다. 캔버스 텍스처는 생성자 안에서만 만든다.
- 중급 GPU 60fps 기준: 드로 콜을 줄인다(정적 지오메트리 병합 · 인스턴싱).

**P7 fx-audio** (W1)
- §9.7의 두 표 전부(이벤트 연출 · 상태 그리기), 큐 어휘 16종, 장판 kind 6종, 투사체 kind 1종, 텔레그래프 4모양, 무기 궤적, 록온 표식, 피해 숫자, `danger` 경고 표식.
- 합성 SFX 전 항목 + 분위기 음 4종(마을 · 보스 3) + 2페이즈 층. 볼륨 3종 · 일시정지 덕킹. `unlock()` 전에는 no-op.
- 입자 예산(§9.9)을 지킨다. 풀링으로 프레임 중 할당을 최소화한다. `'clear'`로 정리되는 투사체 · 장판은 폭발 · 소리 없이 사라진다.

**P8 ui** (W1)
- HUD 전 요소(§10.2 — 조작 힌트 · 락 안내 · 처형 프롬프트 포함) · 패널 7종(§10.3) · 페이드 · 배너 · 문자열 전부(`strings.ko.js`, 부록 A의 ID 전부에 대한 키) · CSS.
- **패널 전부를 키보드만으로 조작할 수 있다**(§10.1 패널 키 조작 · 기본 포커스 · 입력 지연) — 안개문에서 `E`, `E`로 출발, 결과에서 `R`로 재도전. `navigate/confirm/cancel`이 게임패드 경로로도 같은 일을 한다.
- 화톳불의 **올리기 전/후 수치 비교**가 보인다. 실패한 명령은 사유를 보여 준다. 사망 결과에 「레벨업 n회 가능」이 보인다.
- UI 코드에 한국어 리터럴 0. 1280×720에서 겹침 · 잘림 없음. sim 상태를 직접 고치지 않는다. HUD는 클릭을 가로채지 않는다(§10.5).

**P9 app-integration** (W2)
- 부트 → 타이틀 → 마을 ⇄ 보스전 → 결과 루프가 끝까지 돈다. 전환 페이드 합 ≤ 1초. 입력(키보드 · 마우스 · 포인터 락/드래그 대체 · 게임패드, 패널에서는 게임패드 → `navigate/confirm/cancel`) → `InputFrame`. 일시정지 · 창 포커스 처리 · 브라우저 기본 동작 차단(§11.2 · §11.3).
- 저장/이어하기: 프로필과 설정이 다른 키, 타이틀에서는 저장하지 않는다, 읽지 못한 세이브는 백업 키에 보존(§11.4).
- `window.__ashen` 전 메서드(§11.5). 봇(§12.3) + `bot.fight.test.js`의 **발더 A~E** 통과(§12.4 — 펜리르 · 니힐의 A~D는 W3 게이트).
- 세 레이어 · 오디오 · UI가 실제로 붙어 화면에 나온다(§12.5 스모크). `README.md`(실행 · 조작 · 디버그 API 요약).

**P10 boss-fenrir** (W2)
- `data/bosses/fenrir.js`(§8.11 — `bodyParts` · 2페이즈 가시 포함) · `hooks/fenrir.js` · `view/bosses/fenrirView.js`(사족 리그 · pose 8종 · 상태 10종 · 몸길이가 `bodyParts` 범위와 일치) · `boss.fenrir.test.js` 통과. 자체 검증은 이 테스트로 한정한다.
- 프레임워크 · 리그 빌더 · 봇을 고치지 않았다. 봇 대전(§12.4)은 W3에서 돈다 — 그 전에 `?boss=fenrir`(최소 부트 또는 P9의 앱)로 눈으로 확인하는 것을 권장한다.

**P11 boss-nihil** (W2)
- `data/bosses/nihil.js`(§8.12 — `void_orb.parryable` 포함) · `hooks/nihil.js` · `view/bosses/nihilView.js`(부유 리그 · pose 7종 · 순간이동 소멸/등장 · 광선/검 비는 fx가 그리므로 뷰는 시전 자세 · `handL` 소켓이 광선 원점) · `boss.nihil.test.js` 통과. 자체 검증은 이 테스트로 한정한다.
- 프레임워크 · 리그 빌더 · 봇을 고치지 않았다. 봇 대전은 W3에서 돈다.

**W3 통합 게이트** (오케스트레이터 — 패키지 아님)
- 전체 `npm run build` · `npm test` 통과. `bot.fight.test.js`의 세 보스 A~D + 발더 E. 브라우저 스모크(§12.5).
- 시나리오 E의 목표(8회 이하 · 40~170초)와 C의 격파 시간(45~180초)을 보고 §7 서두의 묶인 값(보스 HP · 보상 · 레벨업 비용 · 사망 보상 · 순환 배율)을 조정한다. `NOTES-P#.md`에 쌓인 `core/` 결함 · 계약 이탈을 여기서 정리한다.
- (W3 확정 — 시뮬레이션 · 밸런스 단계의 결과) `npm test` 625개 전부 통과(skip 0) · 빌드 오류 0. 조정한 값 · 고친 것 · 남은 문제는 `docs/NOTES-W3.md`. 이 문서에서 `W3 확정`을 검색하면 바뀐 곳이 전부 나온다. 화면 · 연출 · 소리(view · fx · ui · audio)의 통합 점검은 다음 단계가 한다.

---

## 부록 A 식별자 목록

| 종류 | 값 |
|---|---|
| BossId (해금 순서) | `valder` · `fenrir` · `nihil` |
| WeaponId | `longsword` · `greatsword` · `spear` |
| MoveDef.id | `light1` · `light2` · `light3` · `light4`(장검 · 창만) · `heavy` · `dash` · `rollAtk` |
| attackId 전용(무브 표에 없다) | `execute` — 처형의 `PlayerAttack.moveId` · `OutgoingHit.attackId` · `PLAYER_SWING.moveId` |
| motion | `slashR` · `slashL` · `slashUp` · `overhead` · `thrust` · `spin` · `sweep` |
| StatId | `vit`(생명력) · `end`(지구력) · `str`(근력) · `dex`(기량) |
| 유물 id | `ember_fang` · `watcher_ring` · `green_moss` · `leech_seal` · `red_tear` · `ash_idol` · `stone_ward` |
| 상점 itemId | `flask_charge` · `flask_heal` · `relic:<유물 id>` |
| FacilityId | `bonfire` · `blacksmith` · `merchant` · `gate` |
| PanelId | `title` · `pause` · `bonfire` · `blacksmith` · `merchant` · `gate` · `result` |
| 월드 id | `town` · `arena_valder` · `arena_fenrir` · `arena_nihil` |
| 투사체 kind | `void_orb` |
| 장판 kind | `shockwave` · `fire_trail` · `fire_pillar` · `ice_spike` · `void_burst` · `void_sword` |
| FxStyle | `fire` · `frost` · `void` · `danger` |
| 큐 어휘 | `roar` · `howl` · `slam` · `stomp` · `whoosh` · `charge_start` · `land` · `cast` · `blink_out` · `blink_in` · `breath_start` · `breath_end` · `beam_start` · `beam_end` · `enchant` · `shatter` |
| 발더 pose | `slashR` · `slashL` · `overhead` · `thrust` · `leap` · `spin` · `slamGround` · `delayed` · `cast` |
| 펜리르 pose | `bite` · `claw` · `tail` · `charge` · `pounce` · `breath` · `hop` · `howl` |
| 니힐 pose | `castOrbs` · `blink` · `beam` · `castGround` · `castSky` · `nova` · `scythe` |
| 플레이어 상태 | `idle` · `move` · `roll` · `backstep` · `attack` · `guard` · `guardHit` · `guardBreak` · `parry` · `flask` · `stagger` · `knockdown` · `getup` · `execute` · `dead` |
| 보스 상태 | `intro` · `idle` · `chase` · `attack` · `parried` · `groggy` · `executed` · `recover` · `phaseShift` · `dead` |
| glow | `none` · `fire` · `frost` · `void` · `danger`(패링 불가 신호 — §8.9) |
| 데이터 상수 블록 | `PLAYER` · `WEAPONS` · `COMBAT` · `WORLDS` · `BOSS_AI` · `STATS` · `ECONOMY` · `RELICS` · `CAMERA` · `BOT` · `KEYBINDS` · `GAMEPAD` · `DEFAULT_SETTINGS` · `QUALITY` · `PALETTE` · `STR` |
| 리그 소켓 | humanoid · floater: `weapon` · `weaponBase` · `weaponTip` · `head` · `chest` · `handL` / quadruped: `mouth` · `head` · `chest` · `tailTip` |
| DOM id | `#game-canvas` · `#ui-root` |
| localStorage 키 | `ashen-cycle/save`(프로필) · `ashen-cycle/save.bak`(읽지 못한 세이브 원문) · `ashen-cycle/settings`(설정) |

