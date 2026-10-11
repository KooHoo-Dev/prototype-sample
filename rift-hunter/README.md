<!-- OWNER: P9 — 계약 §11 · §13 P9 (W0: P0 임시본 — W2 에서 P9 가 「바로 해 보기」 · 조작 표 · 디버그 API 를 완성한다) -->
# RIFT HUNTER — 균열 사냥꾼

쿼터뷰 3D 핵앤슬래시 ARPG(시스템 분석용). 마을(상점 4곳 · 보관함 · 균열석)과 시드로 생성한 균열을 오가며 몬스터 떼와 속성을 단 챔피언 · 정예를 쓸고, 확률 드랍 장비 · 스킬 트리로 강해져 균열 레벨을 올린다. 전사 · 마법사.

> **지금은 스캐폴드(웨이브 0)다.** 화면은 자리 표시 도형(원기둥 · 상자 · 테두리 선)이고 게임 규칙은 스텁이다. 웨이브 1 · 2 에서 채운다.
> 방향은 `docs/BRIEF.md`, 이름 · 시그니처 · 수치의 정본은 `docs/CONTRACT.md`.

## 실행

리포 루트의 PowerShell 에서(Jay 의 PC):

```
npm.cmd --prefix rift-hunter install
npm.cmd --prefix rift-hunter run dev        # http://localhost:5400
npm.cmd --prefix rift-hunter test
npm.cmd --prefix rift-hunter run build
npm.cmd --prefix rift-hunter run check:dist
```

## 지금 볼 수 있는 것(최소 부트 — 계약 §11.10)

| 주소 | 무엇 |
|---|---|
| `/` | 마을(48 × 48m 광장 · 물체 7 · 건물) · 전사 |
| `/?class=mage` | 마법사로 |
| `/?scene=rift` | 스텁 균열 1(60 × 60m 방 · 잠든 구울 팩) |
| `/?fixture=<id>` | 고정 상태(§11.9) — `town` `riftSwarm` `riftElites` `riftAffixes` `riftGuardian` `riftWitch` `riftWarrior` `riftMage` `riftLoot` `riftDeath` `riftComplete` `bag` `shops` `skillTree` `lowLife` |
| `/?panel=<PanelId>` | 그 패널을 바로 연다(지금은 제목뿐) |
| `/?seed=n` | 세션 시드 |

`?fresh` 는 받아 두기만 한다 — 지금은 아무것도 저장하지 않는다(개발 세션). **균열 진행은 저장되지 않는다**(브리프 §3.1 — 새로 고치면 마을에서 시작한다).

## 조작(지금)

| 행동 | 키 |
|---|---|
| 이동 | 좌클릭(누르고 있으면 커서를 따라) |
| 카메라 줌 | 휠 |
| 패널 닫기 · 일시정지 | `Escape` |

스킬(우클릭 · `Digit1`~`4`) · 포션(`KeyQ`) · 귀환(`KeyT`)은 입력만 모으고 아직 동작하지 않는다.

## 구조

`src/core`(수학 · 시드 난수 · 이벤트 · 모양) · `src/data`(수치 · 문자열) · `src/sim`(규칙과 상태) · `src/bot` · `src/debug`(고정 상태) · `src/view`(three) · `src/audio` · `src/ui` · `src/app`. 순수 계층(core · data · sim · bot · debug)은 Node 에서 그대로 돈다(`test/purity.test.js`).

## 디버그 API(`window.__game` — 최소 부트)

`getState()` · `pause(on)` · `step(n)`(틱을 민 뒤 렌더까지 · Promise) · `errors()` · `screen()` · `panel()` · `openPanel(id, args)` · `closePanel()` · `loadFixture(id)` · `setBot()`(아직 없음) · `hash()` · `memory()`.

화면 확인(내장 브라우저가 없을 때): `npm run probe:screen -- "http://127.0.0.1:<port>/?fixture=riftSwarm" --step 1 --out docs/_scratch/swarm.png`.
