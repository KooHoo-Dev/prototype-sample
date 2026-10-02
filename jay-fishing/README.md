# Jay Fishing v0.1

<!-- OWNER: P9 — 계약 §13 P9 (W0: P0 임시본 — W2 에서 P9 가 다시 쓴다) -->

1인칭 3D 낚시 RPG — 집(PC로 정비)과 실제 장소를 본뜬 스테이지 3곳(충주호 · 조가사키 해안 · 컬럼비아강)을 오가며 찌낚시 · 바닥낚시로 잡고, 드랙 · 텐션 손맛으로 랜딩해 팔고 레벨과 장비로 더 큰 물고기를 노린다.

> **지금은 W0(스캐폴드) 상태다.** 화면에는 자리 표시 도형과 HUD 한 줄만 뜬다. 게임 규칙 · 화면 · 소리는 W1 · W2 에서 채운다.

## 실행

리포 루트의 PowerShell 에서(실행 정책 때문에 `npm.cmd`):

```
npm.cmd --prefix jay-fishing install
npm.cmd --prefix jay-fishing run dev        # http://localhost:5300
```

| 명령 | 뜻 |
|---|---|
| `run dev` | 개발 서버(포트 5300) |
| `run build` | 프로덕션 빌드(`dist/`) |
| `test` | `node --test` — 순수 계층 · 데이터 스키마 · 고정 상태 · 패키지별 테스트 |
| `run check:dist` | 빌드를 갤러리와 같은 하위 경로 · http 에서 헤드리스로 부팅(`release/boot.png`) |
| `run probe:screen -- "<주소?쿼리>" --step <n> --out docs/_scratch/<이름>.png` | 떠 있는 서버의 정지 화면 찍기 |
| `run measure` | 봇 측정 표(W2 — 지금은 스텁) |

## 개발용 쿼리 (W0 최소 부트)

레벨 게이트를 건너뛰어 갯바위 · 강을 바로 본다: `/?scene=coast` · `/?spot=river_trench&time=22`

| 쿼리 | 뜻 |
|---|---|
| `?scene=<home\|lake\|coast\|river>` | 그 씬의 spawn 에서 시작(게이트 무시). 기본은 `lake` |
| `?spot=<자리 ID>` | 그 자리에서 낚시 모드로 시작(예: `lake_gravel` · `coast_channel` · `river_tailrace`) |
| `?time=<0..24>` · `?weather=<clear\|cloudy\|rain>` · `?seed=<n>` | 시작 시각 · 날씨 · 시드 |
| `?level=<n>` · `?money=<n>` | 그 레벨 · 돈으로 시작 |
| `?panel=<tackle\|pc\|sell\|camp\|map\|bed\|pause\|result>` | 시작하자마자 그 패널 |
| `?fixture=<이름>` | 고정 상태(sim 을 밀지 않는다): `walkLake` `ready` `charging` `waiting` `driftRiver` `nibble` `take` `fightRun` `fightJump` `fightStress` `netReady` `landing` `result` `failedRodBreak` `night` `rain` `shopL12` — `?panel` 과 함께 쓸 수 있다 |
| `?quality=<low\|medium\|high>` | 화질 |

W0 는 세이브를 읽지도 쓰지도 않는다(`?fresh=1` 은 무시된다).

## 디버그 API — `window.__game` (W0)

| 메서드 | 동작 |
|---|---|
| `getState()` | sim 상태 |
| `pause(on)` | 루프의 sim 진행 멈춤(렌더는 계속) |
| `step(n)` | n 틱을 밀고 렌더까지(`?fixture` 모드면 sim 은 그대로 · 레이어와 ui 만 n 번) → Promise |
| `errors()` | 잡히지 않은 예외 · 거부된 Promise · `console.error` |
| `screen()` · `gotoScene(id)` · `gotoSpot(id)` · `openPanel(id)` · `closePanel()` · `loadFixture(name)` · `setBot()` | 화면 · 이동 · 패널 · 고정 상태 · 봇(W0 는 no-op) |

## 조작 (계획 — 브리프 §6)

| 행동 | 키 |
|---|---|
| 이동 | `W` `A` `S` `D` |
| 둘러보기 | 마우스(W0 는 가운데 버튼 드래그) |
| 상호작용 | `E` |
| 캐스팅 · 릴링 | 좌클릭(홀드) |
| 펌핑 | 우클릭(홀드) |
| 챔질 · 뜰채 | `Space` |
| 드랙 ± | 휠 · `Z` / `C` |
| 베일 | `R` |
| 찌 수심 | `↑` `↓` |
| 채비 세트 | `1` 찌 · `2` 바닥 |
| 채비 · 도감 · 스킬 | `Tab` |
| 닫기 · 일어나기 · 일시정지 | `Esc` |

## 구조

`src/core` 수학 · 난수 · 이벤트 · 상수 / `src/data` 수치 · 정의 · 문자열 / `src/sim` 규칙과 상태 / `src/bot` 자동 플레이어 / `src/debug` 고정 상태 / `src/view` · `src/audio` · `src/ui` / `src/app` 루프 · 입력 · 저장. 정본 문서는 `docs/BRIEF.md`(방향) · `docs/CONTRACT.md`(이름 · 수치 · 시그니처).
