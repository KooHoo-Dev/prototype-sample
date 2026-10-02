# 프로토타입 리포 운영 규칙

이 리포는 **서로 독립인 웹 게임 프로토타입의 모음**이다. 조율과 최종 결정은 **Jay**가 한다.
판단 기준은 하나다 — **Jay가 한 판 해 보고 이 방향을 더 팔지 정할 수 있는가.**

| 정본 | 무엇 |
|---|---|
| `CLAUDE.md`(이 파일) | 규칙 — 모든 세션과 서브에이전트에 주입된다 |
| `docs/PIPELINE.md` | 제작 절차(오케스트레이터용) — 단계 · 게이트 · 워크플로 인수 · 재개 |
| `docs/QUALITY.md` | 공통 품질 기준 — 설계 · 구현 · 리뷰가 같이 본다 |
| `docs/BRIEF-TEMPLATE.md` | 브리프 양식 |
| `prototypes.json` | 프로토타입 목록 — slug · 폴더 · 포트 · 상태 · 공개 여부 |
| `<dir>/README.md` · `<dir>/docs/` | 그 프로토타입의 실행법 · 브리프 · 계약 · 작업 기록 |

## 불변 규칙

1. **한 프로토타입 = 최상위 폴더 하나.** 폴더는 `prototypes.json`의 `dir`이다(새로 만들 때는 slug와 같게 — 소문자 kebab-case). 자기 `package.json` · `docs/` · 테스트를 갖는다.
2. **프로토타입끼리 코드를 공유하지 않는다.** 다른 프로토타입 폴더를 import하지 않는다(읽고 베끼는 것은 된다). `templates/`는 복사해 쓰는 원본이다. 한 폴더를 떼어 새 리포로 옮길 수 있어야 한다.
3. **맡은 프로토타입 폴더 밖은 쓰지 않는다.** 임시 파일은 `<dir>/docs/_scratch/`에 만들고 끝나면 지운다. 예외: 오케스트레이터는 `prototypes.json`의 자기 항목 · `docs/RETRO.md`(덧붙이기만) · 갤러리 미리보기의 `_site/`를 쓴다.
4. **운영 자산은 Jay가 시킬 때만 고친다** — `CLAUDE.md` · `docs/` · `.claude/` · `.github/` · `tools/` · `templates/`. 고칠 것이 보이면 `docs/RETRO.md`에 한 줄 남긴다.
5. **git 쓰기는 Jay가 말할 때, 메인 세션만 한다.** 서브에이전트의 git은 읽기 명령뿐이다(훅). 커밋은 경로를 명시한다 — `git add -- <dir>/ prototypes.json`(같은 작업 트리를 여러 세션이 쓴다 · `-A` 금지). push는 따로 시킬 때만.
6. **공개는 Jay만 정한다.** 갤러리(GitHub Pages)에는 `prototypes.json`에서 `public: true`인 것만 올라간다 — 에이전트는 `public`을 바꾸지 않고, 배포 워크플로를 실행하지 않는다.
7. **외부 에셋과 추가 의존성은 브리프가 허락한 것만.** 기본은 외부 에셋 0(모델 · 텍스처 · 소리를 코드로 만든다) · 의존성은 `vite`와 (3D면) `three`.
8. **돌려 보지 않은 것을 됐다고 쓰지 않는다.** 게이트는 실제로 실행하고, 이 환경에서 확인할 수 없는 것(실시간 재생 · 소리 · 포인터 락 · 게임패드)은 「사람이 확인할 것」으로 남긴다.

## 우선순위

플레이어가 만지는 것(조작감 · 읽히는 화면) > 루프의 완결(시작 → 끝 → 다시) > 브리프의 측정 목표 > 콘텐츠 양 > 연출 > 코드 위생.
막는 것은 셋이다 — 돌아가지 않는 것(빌드 · 테스트 · 콘솔 오류 · 조용한 실패) · 규칙 위반 · `docs/QUALITY.md`의 실패 조건. 나머지는 기록하고 지나간다.

## 기술 기본값 (브리프가 바꾸지 않으면 이대로)

- **스택**: Vite + 바닐라 JS ES 모듈(+ 3D면 `three`). TypeScript · 프레임워크 · 물리 엔진을 쓰지 않는다. 타입은 JSDoc `@typedef`.
- **계층**(폴더 이름 고정): `src/core`(수학 · 시드 난수 · 이벤트 버스 · 상수) · `src/data`(수치 · 정의 · 문자열) · `src/sim`(규칙과 상태) · `src/bot`(자동 플레이어) · `src/view` · `src/audio` · `src/ui` · `src/app`(루프 · 입력 · 저장 · 화면 전환 · 디버그 API).
- **`core` · `data` · `sim` · `bot`은 순수 JS다.** `three` · DOM · WebAudio · 시계 · `Math.random`을 쓰지 않고(고정 틱 · 시드 난수) Node에서 그대로 돈다. 상태의 정본은 sim이다 — view · ui · audio는 읽고 이벤트를 구독하며 명령 메서드로만 바꾼다. 입력은 app이 매 틱 순수 객체(`InputFrame`)로 만들어 넘긴다 — 봇도 같은 것을 만든다.
- **수치는 `src/data/`에만 둔다.** UI 문면은 한국어 · `src/data/strings.ko.js` 한 파일. 식별자는 영어, 문서는 한국어.
- **검증 게이트**: `npm run build` 오류 0 · `npm test`(`node --test`) 실패 0 — 순수 계층 검사와 **봇이 핵심 루프를 끝까지 도는 헤드리스 테스트**(예외 0 · NaN 0 · 결정성 · 브리프의 측정 목표)를 포함한다 · `npm run check:dist`(프로덕션 빌드가 배포되는 모양 — 하위 경로 · http — 에서 부팅 · 헤드리스 Chrome).
- **디버그 API** `window.__game`: `getState()` · `pause(on)` · `step(n)`(틱을 민 뒤 렌더까지) · `setBot(on)` · `errors()` + 화면을 건너뛰는 메서드. 개발용 URL 쿼리(`?fresh=1` 등)는 실제 세이브를 읽지도 쓰지도 않는다. 목록은 그 프로토타입 README에 적는다.
- **부팅 표식**: 첫 화면이 그려지면 `document.documentElement.dataset.gameReady = '1'`, 부팅에 실패하면 `dataset.gameError`에 사유 — `check:dist`가 읽는다(사용자 입력 없이 20초 안 · 잡히지 않은 예외 0). 진입점을 다시 써도 남긴다.
- **단일 번들**: 동적 `import()`를 쓰지 않는다(`check:dist`가 청크 수를 본다 — 선택 명령 `build:standalone`이 HTML 한 장으로 합칠 수 있어야 한다).
- **전달**: 기본은 갤러리 URL이다. 오프라인 파일(단일 HTML — `build:standalone` → `check:standalone`)은 Jay가 달라고 할 때만 만든다.
- **입력**: 키는 `event.code`로 읽는다(한글 IME) · `Ctrl` · `Alt` · `Meta` 조합은 건드리지 않는다 · 포인터 락을 못 얻어도 돌아간다.
- **저장**: localStorage, 키 접두사는 slug. 깨진 세이브에서 throw하지 않는다.

## 환경 (이 PC — 실측)

- Jay의 터미널은 PowerShell이고 실행 정책이 `npm`을 막는다 → Jay에게 주는 명령은 `npm.cmd --prefix <dir> run …`(리포 루트에서). 에이전트의 Bash 도구(Git Bash)에서는 `npm`이 그대로 된다.
- Bash heredoc은 백슬래시와 따옴표를 깬다 → 스크립트 · 긴 문서는 Write 도구로 파일을 만들고 실행만 한다.
- **포트**: 프로토타입의 `port`(`prototypes.json` — dev · preview 공용 · strictPort). 에이전트의 임시 서버는 지시받은 `port+1 … port+29`. **자기가 띄운 PID만 끈다**(`netstat -ano`로 그 포트의 PID → `taskkill //F //PID <pid>`) — 이름으로 node를 통째로 끄지 않는다(훅).
- **브라우저 창이 숨겨져 있으면 `requestAnimationFrame`이 돌지 않는다** → 화면은 `__game.pause(true)` 뒤 `__game.step(n)`으로 밀어 정지 화면으로 본다. CSS 전환과 실제 시간 지연은 진행되지 않는다. 다른 작업자가 파일을 고치는 동안 dev 서버가 페이지를 다시 읽어 콘솔에 옛 오류가 남는다 — 새로 읽은 뒤의 `__game.errors()`로 판단한다.
- 브라우저 도구는 **자기 탭만** 쓴다(`tabs_create`로 만들고 모든 호출에 `tabId`) · 끝나면 자기 탭만 닫는다.
- 내장 브라우저는 `file://`을 열지 못한다 → 단일 HTML(선택 명령)은 `npm run check:standalone`(헤드리스 Chrome)으로 확인한다.
- Chrome · Edge는 `scripts/`의 검사 스크립트로만 띄운다 — `chrome.exe --version` 같은 직접 실행은 Jay의 프로필로 창을 연다. 헤드리스의 `--virtual-time-budget`은 `requestAnimationFrame`을 1~3번만 돌린다(검사 스크립트는 실제 시간으로 기다린다).
- 파일 이름과 import 경로의 대소문자를 디스크와 똑같이 쓴다 — Windows는 틀려도 돌지만 갤러리를 빌드 · 서빙하는 리눅스에서는 깨진다.

## 서브에이전트

- 지시받은 **소유 파일만** 쓴다. 남의 파일의 결함 · 계약의 모순은 고치지 않고 `<dir>/docs/NOTES-<패키지 ID>.md`에 적어 보고에 넣는다(통합 게이트 · 수정 담당은 지시가 넓혀 준 범위까지).
- 계약(`<dir>/docs/CONTRACT.md`)의 공개 API · 이벤트 · 상태 필드가 다른 작업자와 맞물리는 유일한 근거다 — 이름과 시그니처를 바꾸지 않는다.
- 병렬 작업 중 남의 파일 때문에 전체 빌드 · 테스트가 깨질 수 있다 — 자기 파일 원인의 실패만 책임진다.
- 다른 서브에이전트를 띄우지 않는다. 의존성을 추가하지 않는다.
- 보고는 실행한 명령과 실제 출력에 근거한다. 추측은 「확인하지 못한 것」에 적는다.

## 메인 세션 (오케스트레이터)

- 일은 스킬로 연다: `/proto-new`(제작) · `/proto-resume`(재개) · `/proto-feedback`(Jay의 플레이 피드백 반영) · `/proto-release`(전달 · 공개 준비) · `/proto-status`(현황). 절차는 `docs/PIPELINE.md`.
- 제작 요청이 스킬 없이 오면 `/proto-new`의 규모(에이전트 약 30개 · 수 시간)를 한 줄로 알리고 그 스킬로 열지 확인한다. 작은 수정은 그냥 한다.
- Jay에게 묻는 것은 **방향이 갈리는 결정**뿐이다. 나머지는 기본값을 정해 브리프에 적고 진행한다.
- 워크플로 사이마다 직접 확인한다(게이트 재실행 · 화면). 끝나면 자기가 띄운 서버와 탭을 정리한다.
- 다른 세션이 이 리포를 동시에 쓴다 — 다른 프로토타입의 폴더 · 서버 · 탭은 남의 것이다.
- 종료 보고는 넷으로 쓴다: 만든 것 · 확인한 것 · 확인하지 못한 것 · Jay가 정할 것.
