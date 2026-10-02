# prototype-sample — 프로토타입 모음

웹 게임 프로토타입을 한 리포에 모은다. **폴더 하나가 프로토타입 하나**이고 서로 코드를 공유하지 않는다 — 어느 폴더든 떼어 내면 그대로 독립 프로젝트다.

목록과 상태는 [`prototypes.json`](prototypes.json)이 정본이다. 터미널에서는 `node tools/status.mjs`.

## 해 보기

Node 22 이상, 데스크톱 Chrome · Edge · Firefox, 키보드와 마우스가 필요하다. 리포 루트에서(PowerShell은 `npm` 대신 `npm.cmd`):

```bash
npm.cmd --prefix <폴더> install
npm.cmd --prefix <폴더> run dev
```

터미널에 찍히는 주소(`http://localhost:<port>`)를 연다. 포트는 프로토타입마다 다르다(`prototypes.json`).

## 남에게 보여 주기

기본은 **갤러리 URL**이다 — 아래 「공개 (갤러리)」. 공개하기로 고른 것만 올라간다.

오프라인으로 건넬 파일이 필요할 때만:

```bash
npm.cmd --prefix <폴더> run build:standalone
```

`<폴더>/release/`에 생기는 **HTML 한 장**을 보낸다(받는 쪽은 더블클릭). `dist/`는 웹 서버에 올리는 것이고 더블클릭으로는 열리지 않는다.

## 새 프로토타입 만들기

Claude Code 세션을 이 리포에서 열고:

```
/proto-new 탑다운 슈팅 로그라이트. 방 하나를 30초 안에 비우고 강화를 하나 고른다
```

| 스킬 | 언제 |
|---|---|
| `/proto-new <설명>` | 새로 만든다 — 브리프 → 설계 → 병렬 구현 → 리뷰 (에이전트 약 30개 · 수 시간) |
| `/proto-resume <slug>` | 끊긴 제작을 이어서 한다 |
| `/proto-feedback <slug> <해 본 느낌>` | 해 보고 고칠 것을 반영한다 |
| `/proto-release <slug>` | 공개할 수 있게 준비한다(게이트 · 점검 · 미리보기 — 공개 전환과 배포는 하지 않는다) |
| `/proto-status` | 현황을 본다 |

## 공개 (갤러리)

GitHub Pages에는 `prototypes.json`에서 `public: true`인 프로토타입만 올라간다. 나머지는 빌드도 배포도 되지 않는다(리포가 공개면 소스는 보인다).

1. `prototypes.json`에서 공개할 것의 `public`을 `true`로 바꾸고 커밋 · push 한다.
2. GitHub 리포의 Settings → Pages → Source를 **GitHub Actions**로 둔다(처음 한 번 — 비공개 리포의 Pages는 유료 플랜에서만 된다).
3. Actions 탭에서 **Deploy gallery**를 수동 실행한다 → `https://<조직>.github.io/<리포>/<slug>/`.
4. 내릴 때는 `public`을 `false`로 되돌려 커밋 · push 하고 다시 실행한다(다시 실행하기 전까지는 이전 배포가 떠 있다).

로컬에서 미리 보려면 `node tools/build-site.mjs --all --serve 5290` → `http://localhost:5290`. 하나만 보려면 `--all` 대신 `--only <slug>`, 실제로 올라갈 것만 보려면 둘 다 뺀다.

## 운영 문서

| 파일 | 무엇 |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | 규칙 — 모든 세션과 서브에이전트가 따른다 |
| [`docs/PIPELINE.md`](docs/PIPELINE.md) | 제작 절차 |
| [`docs/QUALITY.md`](docs/QUALITY.md) | 공통 품질 기준 |
| [`docs/BRIEF-TEMPLATE.md`](docs/BRIEF-TEMPLATE.md) | 브리프 양식 |
| [`docs/RETRO.md`](docs/RETRO.md) | 제작마다 쌓이는 회고 |
| `.claude/` | 스킬 · 저장 워크플로 · 훅 |
| `tools/` | 현황 · 패키지 검사 · 워크플로 건조 실행 · 갤러리 빌드 |
| `templates/prototype/` | 새 프로토타입이 복사해 쓰는 설정과 스크립트 |
