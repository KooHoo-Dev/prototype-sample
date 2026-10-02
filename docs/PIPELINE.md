# 제작 파이프라인

오케스트레이터(메인 세션)의 절차서다. 규칙은 `CLAUDE.md`, 품질 기준은 `docs/QUALITY.md`가 정본이고 여기서는 **순서 · 게이트 · 워크플로 인수**만 정한다.
아래에서 `<dir>`은 그 프로토타입의 폴더, `root`는 그 절대 경로(슬래시 표기), `port`는 `prototypes.json`의 값이다.

## 0. 한눈에

| # | 단계 | 누가 | 산출물(`<dir>/docs/`) | 넘어가는 조건 |
|---|---|---|---|---|
| 1 | 접수 | 오케스트레이터 | `BRIEF.md` · `STATUS.md` · `prototypes.json` 항목 | 방향이 갈리는 결정이 남지 않았다 |
| 2 | 설계 | 워크플로 `proto-design` | `CONTRACT.md` · `_packages.json` · 스캐폴드 | 스텁 상태로 게이트(빌드 · 테스트 · `check:dist`) 통과 |
| 3 | 구현 | 워크플로 `proto-build` × 웨이브 수 | 구현 · `NOTES-P#` · `NOTES-W#` · (마지막) `NOTES-BALANCE` · `NOTES-VISUAL` | 게이트 통과 + 직접 본 화면 |
| 4 | 리뷰 | 워크플로 `proto-review` | 수정 · 회귀 테스트 · `NOTES-REVIEW.md` | 프로덕션 빌드로 전체 루프 오류 0 |
| 5 | 마감 | 오케스트레이터 | 부팅 검사 · README · 종료 보고 | — |
| 6~8 | 재개 · 피드백 · 전달 | 오케스트레이터 | `NOTES-FEEDBACK.md` 등 | — |

## 1. 접수

1. **묻는 것**: 요청만으로 한 판의 모습이 둘 이상으로 갈릴 때만(장르 · 시점 · 플랫폼 · 한 판의 단위) 한 번에 모아 묻는다. 이름 · 조작 키 · 수치 · 콘텐츠 수 · 톤은 정해서 적는다.
2. slug(소문자 kebab-case — 폴더 이름과 같다)와 제목을 정하고 `prototypes.json`에 항목을 더한다: `status: "making"` · `public: false` · `port`는 5300부터 100 단위로 비어 있는 첫 번호.
3. `docs/BRIEF-TEMPLATE.md`를 `<dir>/docs/BRIEF.md`로 복사해 쓴다. 빈칸을 남기지 않는다. 「측정 목표」는 봇으로 잴 수 있는 수치로, 「기술 제약」은 기본값과 다른 것만.
4. `<dir>/docs/STATUS.md`를 만든다(§9 형식).
5. Jay에게 브리프 요약(10줄 이내 — 한 줄 · 루프 · 조작 · 콘텐츠 수 · 범위 밖)을 보여 주고 **기다리지 않고** §2로 간다.

## 2. 설계

```js
Workflow({ name: 'proto-design', args: { slug, root, port } })
```

계약 작성 → 세 관점 비평(통합 · 핵심 감각 · 루프/경제/UX) → 개정 → P0 스캐폴드. 끝나면 오케스트레이터가:

1. `<dir>`에서 `npm run build` · `npm test` · `npm run check:dist`를 직접 다시 돌린다.
2. `node tools/check-packages.mjs <slug>` — 파일 소유 중복 0 · 파일 존재 · 웨이브 구성. 어긋나면 `_packages.json`과 계약의 소유 표를 맞춘다.
3. 계약의 목차와 `_packages.json`의 `focus`를 읽는다. `focus`가 "무엇이면 실패인가"를 그 게임의 말로 말하지 않으면 고쳐 쓴다 — 완성도는 여기서 갈린다.
4. `STATUS.md`에 한 줄(run ID 포함).

## 3. 구현

```js
Workflow({ name: 'proto-build', args: { slug, root, port, wave, packages, last } })
```

웨이브마다 한 번 연다. `packages`와 `last`는 `check-packages.mjs`가 웨이브별로 찍어 주는 JSON을 그대로 쓴다. 패키지 병렬 구현 → 통합 게이트이고, 마지막 웨이브(`last: true`)에는 밸런스 게이트와 화면 패스가 붙는다. 웨이브가 끝날 때마다:

1. 빌드 · 테스트 · `check:dist`를 직접 다시 돌린다.
2. `NOTES-W<n>.md`의 남은 문제를 읽는다. blocker는 다음 웨이브 전에 닫는다(직접 고치거나 Agent 하나).
3. 직접 본다: dev 서버를 `port`로 띄우고(Bash 백그라운드) 자기 탭에서 주요 장면의 스크린샷과 `__game.errors()`.
4. 정리: `netstat -ano`에서 `port … port+29`에 남은 LISTENING PID(에이전트가 남긴 서버)를 끄고 남은 탭을 닫는다.
5. `STATUS.md`에 한 줄.

## 4. 리뷰

```js
Workflow({ name: 'proto-review', args: { slug, root, port } })
```

다섯 관점의 결함 탐색(증거 필수) → 영역별 수정(먼저 반증) → 최종 게이트(프로덕션 빌드로 전체 루프 · 배포 모양 부팅 검사). 끝나면 빌드 · 테스트 · `check:dist` 재실행, `NOTES-REVIEW.md`의 「Jay가 정할 것」 · 「사람이 확인할 것」 확인, 화면 확인, 정리, `STATUS.md` 한 줄.

## 5. 마감

1. `npm run build` → `npm run check:dist` → `release/boot.png`를 직접 본다.
2. README 확인: 실행법 · 조작 표 · 게임 흐름 · 디버그 API와 쿼리 · 알려진 한계.
3. `prototypes.json`: `status: "playable"` · `summary` 갱신(`public`은 건드리지 않는다).
4. 정리: 서버 · 탭 · `docs/_scratch/`.
5. `docs/RETRO.md`에 이번 제작에서 배운 것을 한 줄씩(규칙이 됐으면 하는 것 · 새로 실측한 환경 사실).
6. `STATUS.md` 마지막 줄 → 종료 보고(만든 것 · 확인한 것 · 확인하지 못한 것 · Jay가 정할 것) + 바로 해 볼 명령(`npm.cmd --prefix <dir> run dev`와 주소) + 스크린샷 2~4장.

## 6. 재개 (`/proto-resume`)

같은 세션에서 끊긴 워크플로는 `resumeFromRunId`가 먼저다(끝난 에이전트는 캐시). 세션이 바뀌었으면 디스크 상태로 가린다:

| 디스크 상태 | 다음 |
|---|---|
| `BRIEF.md`만 있다 | `proto-design` |
| `CONTRACT.md`는 있고 `_packages.json`이 없다 | `proto-design` `from: 'critique'` — `_critique-*.json` 셋이 다 있으면 `from: 'revise'` |
| `_packages.json`은 있고 `package.json`이 없다 | `proto-design` `from: 'scaffold'` |
| 스캐폴드는 있고 `NOTES-W1.md`가 없다 | `proto-build` 웨이브 1을 다시 연다(작업자는 자기 파일의 현재 상태에서 이어 간다). `npm test`에 그 웨이브의 자리 표시(todo)도 실패도 없으면 `from: 'integrate'` |
| `NOTES-W<n>.md`가 있다 | 다음 웨이브. 마지막 웨이브에서 `NOTES-BALANCE.md`가 없으면 `from: 'balance'`, `NOTES-VISUAL.md`가 없으면 `from: 'visual'` |
| `NOTES-VISUAL.md`는 있고 `NOTES-REVIEW.md`가 없다 | `proto-review` — `_review-*.json` 다섯이 다 있으면 `from: 'fix'` |
| `NOTES-REVIEW.md`가 있다 | §5 마감 |

끊긴 에이전트가 문서나 코드를 반쯤 고쳐 놓았을 수 있다 — 워크플로의 프롬프트는 그것을 전제한다(현재 상태와 대조하고 남은 것만 한다).

## 7. 피드백 라운드 (`/proto-feedback`)

1. Jay의 말을 항목으로 쪼갠다: 버그 · 감각(조작 · 속도 · 난이도) · 가독성/연출 · 콘텐츠/범위 · 방향.
2. 방향을 바꾸는 항목(핵심 루프 · 범위)은 브리프를 먼저 고치고 바뀐 줄을 Jay에게 보여 준다.
3. 항목마다 재현(sim은 Node 스크립트 · 화면은 정지 화면) → 원인 → 수정 → 회귀 테스트. 수치는 `NOTES-*.md`의 조정 손잡이부터 본다.
4. 규모: 파일 몇 개면 직접, 서로 독립인 묶음이 셋 이상이면 소유 파일을 나눠 Agent 병렬. 전면 재작업이 필요하면 멈추고 워크플로를 다시 돌릴지 Jay에게 묻는다.
5. 게이트: 빌드 · 테스트 · `check:dist` · (화면이 바뀌었으면) 정지 화면.
6. `<dir>/docs/NOTES-FEEDBACK.md`에 라운드를 적는다: 날짜 · Jay의 말(원문) · 한 것 · 하지 않은 것과 이유 · Jay가 다시 볼 것. `STATUS.md` 한 줄.

## 8. 전달 · 공개 준비 (`/proto-release`)

전달의 기본은 **갤러리 URL**(GitHub Pages)이다. 갤러리에는 `prototypes.json`에서 `public: true`인 것만 올라간다 — 나머지는 빌드도 배포도 되지 않는다(리포가 공개라 소스는 보인다).

1. 게이트 전부: `build` · `test` · `check:dist`.
2. 공개 전 점검: 디버그 API와 개발용 쿼리가 빌드에 들어 있음을 Jay에게 알린다 · 외부 에셋 0(또는 라이선스 기록) · README의 조작 표 · 터치 기기 안내 · 세이브 키 접두사.
3. 갤러리 미리보기: `node tools/build-site.mjs --only <slug> --serve 5290`(Bash 백그라운드) → `http://localhost:5290/<slug>/` — 그 프로토타입만 빌드한다(다른 프로토타입의 폴더는 남의 것이다). 본 뒤 5290의 자기 PID를 끄고 `_site/`를 지운다.
4. 공개는 Jay가 한다: `public: true` → 커밋 · push → GitHub Actions 「Deploy gallery」 수동 실행(Pages 소스 = GitHub Actions) → `https://<조직>.github.io/<리포>/<slug>/`. 내릴 때는 `public: false`로 되돌려 커밋 · push 하고 다시 실행한다(다시 실행하기 전까지는 이전 배포가 떠 있다). 에이전트는 이것들을 하지 않는다.
5. 오프라인 파일은 Jay가 달라고 할 때만: `npm run build:standalone` → `npm run check:standalone` → `release/standalone.png`를 직접 본다. 전달 파일은 `<dir>/release/<slug>.html` 한 장이다(받는 쪽은 더블클릭).

## 9. 규모와 기록

- 실측(ashen-cycle · 2026-10-02): 워크플로 5회 · 에이전트 30개 · 워크플로 알림의 `subagent_tokens` 합 약 1,230만(끊긴 첫 실행 제외) · 벽시계 약 7시간. 게임이 작으면 패키지 수가 줄 뿐 단계는 같다.
- 웨이브 하나는 패키지 8개까지, 웨이브는 2개가 기본이다.
- `STATUS.md`는 표에 줄을 더하기만 한다: `| 날짜 | 단계 | 결과 | 비고(run ID · 다음 할 일) |`.

## 10. 운영 자산을 고칠 때 (Jay가 시켰을 때만)

- 워크플로(`.claude/workflows/`): 고친 뒤 `node tools/check-workflows.mjs`(에이전트 없이 건조 실행).
- 훅(`.claude/hooks/guard.mjs`): 고친 뒤 `node .claude/hooks/guard.mjs --selftest`. `settings.json`은 세션 시작 때, 훅 본문은 호출마다 읽힌다.
- 운영 자산을 고친 세션에서는 서브에이전트를 띄우는 일(`/proto-new` · `/proto-resume` · 병렬 Agent)을 하지 않는다 — 새 세션에서 연다. 그 세션의 서브에이전트에는 고치기 전의 `CLAUDE.md`가 주입되고 워크플로는 고친 것이 바로 잡혀 규칙이 섞인다(2026-10-02 실측).
- 템플릿의 `scripts/`를 고쳤으면 이미 만든 프로토타입의 `scripts/` 사본도 맞춘다(복사해 쓰는 원본이다).
- 규칙 하나는 한 줄로 쓰고, 같은 규칙을 두 문서에 쓰지 않는다(정본 한 곳 + 가리키기).
