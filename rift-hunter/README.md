<!-- OWNER: P9 — 계약 §11 · §13 P9 -->
# RIFT HUNTER — 균열 사냥꾼

쿼터뷰 3D 핵앤슬래시 ARPG(쿼터뷰 핵앤슬래시의 시스템 조사 · 분석용). 마을(대장장이 · 잡화상 · 도박꾼 · 신비술사 · 보관함 · 균열석)과 시드로 생성한 균열을 오가며 몬스터 떼와 속성을 단 챔피언 · 정예를 쓸고, 확률 드랍 장비 · 스킬 트리로 강해져 균열 레벨을 올린다. 클래스는 전사 · 마법사.

방향은 `docs/BRIEF.md`, 이름 · 시그니처 · 수치의 정본은 `docs/CONTRACT.md`, 측정 리포트는 `docs/MEASURE.md`.

## 바로 해 보기

dev 서버(`npm.cmd --prefix rift-hunter run dev`)를 띄운 뒤 주소창에 — 몇 시간 하지 않아도 균열 10 · 정예 속성 · 전설을 볼 수 있다. 이 주소들은 **개발 세션**이라 세이브를 읽지도 쓰지도 않는다(좌상단 「개발 세션 — 저장 안 됨」).

| 주소 | 무엇 |
|---|---|
| http://localhost:5400/?class=warrior&level=18&rift=10 | 전사 레벨 18(프리셋 빌드 A) · 균열 10에 바로 · 그 레벨에 맞춘 무작위 장비 |
| http://localhost:5400/?class=mage&level=20&rift=12&preset=1 | 마법사 레벨 20 · 프리셋 B(냉기 · 번개) · 균열 12 |
| http://localhost:5400/?fixture=riftAffixes | 정예 12마리가 줄지어 각 속성 하나씩 + 그 효과(감옥 · 역병 · 몰타르 · 냉기 노바 · 보호막 …) |
| http://localhost:5400/?fixture=riftLoot | 바닥 드랍 전 등급(전설 · 세트 빛기둥) · 골드 · 포션 · 구슬 · 재료 · 이름표 겹침(`Alt`) |
| http://localhost:5400/?class=warrior&level=24&rift=18&bot=1 | 봇 자동 사냥 관전(마을 → 균열 → 정비 → 다음 판을 스스로) |
| http://localhost:5400/?analytics=1 | 분석 패널(드랍 시뮬레이터 · 표 보기 · 세션 기록 · 봇) — 세이브를 쓰는 보통 세션 |
| http://localhost:5400/ | 타이틀 — 새 캐릭터(클래스 · 이름)로 처음부터. 진행은 자동 저장된다 |

## 실행

리포 루트의 PowerShell에서(Jay의 PC — 실행 정책 때문에 `npm.cmd`):

```
npm.cmd --prefix rift-hunter install
npm.cmd --prefix rift-hunter run dev          # http://localhost:5400
npm.cmd --prefix rift-hunter test             # node --test — 순수 계층 · 봇 헤드리스 · app 테스트
npm.cmd --prefix rift-hunter run build
npm.cmd --prefix rift-hunter run check:dist   # 프로덕션 빌드가 하위 경로 · http 에서 부팅하는지(헤드리스 Chrome)
npm.cmd --prefix rift-hunter run measure      # 봇 측정 → docs/MEASURE.md
```

## 조작

| 행동 | 키 · 마우스 |
|---|---|
| 이동 · 기본 공격 · 줍기 · 상호작용(NPC · 포털 · 균열석 · 보관함) | 좌클릭 — 누르고 있으면 커서를 따라 계속 · 적 위에서 누르고 있으면 반복 공격 |
| 스킬 칸 1 | 우클릭 |
| 스킬 칸 2~5 | `1` `2` `3` `4` |
| 제자리 공격 · 시전(이동 없이 커서 방향) | `Shift` + 클릭 |
| 체력 포션 | `Q` |
| 귀환 두루마리(1.5초 시전 · 맞으면 끊긴다) | `T` |
| 이름표 보기 · 고급 툴팁(옵션 티어 · 값 범위) | `Alt` 누르고 있기 |
| 인벤토리 · 스킬 트리 · 캐릭터 시트 | `I` · `S` · `C`(다시 누르면 닫힌다) |
| 큰 지도 | `Tab` |
| 분석 패널(게임은 멈춘다) | `` ` ``(Backquote) |
| 카메라 줌(16 ~ 32m) | 휠 |
| 패널 닫기 · 일시정지 | `Esc` |
| 마을의 「균열로 돌아가기」 · 사망 패널의 「마을에서 부활」 | `Enter` |
| 패널 안 | 방향키 · `Enter` · `[` `]`(탭) · 상점 `X` 팔기 · `V` 일괄 판매 · `D` 분해 · `R` 수리 · `F` 보관 · `L` 잠금 · `Z` 정렬 |

- 키는 `event.code`로 읽는다(한글 입력 상태여도 된다). `Ctrl` · `Meta` · `Alt` + 다른 키 조합은 게임이 건드리지 않는다.
- 창이 포커스를 잃거나 탭이 숨으면 눌린 키를 모두 놓고 일시정지 패널이 뜬다(돌아와서 「계속」).
- 첫 키 · 클릭에서 소리가 켜진다. 터치만 있는 기기에서는 「키보드와 마우스가 필요하다」 안내가 뜬다.
- 조작 안내 · 정예 속성 설명 · 규칙은 게임 안(일시정지 → 도움말 · 첫 진입 안내 카드)에 있다.

## 저장

- **균열 진행은 저장되지 않는다.** 새로 고치면 마을에서 시작하고 열려 있던 균열은 닫힌다 — 주운 것 · 장착 · 골드 · 경험치 · 해금 · 기록은 저장돼 있다(일시정지 메뉴에도 적혀 있다).
- localStorage · 키 접두사 `rift-hunter:` — 계정(`rift-hunter:account` — 캐릭터 목록 · 보관함 60칸 · 다음 아이템 번호) · 캐릭터(`rift-hunter:char:0`~`3`) · 설정(`rift-hunter:settings`).
- 자동 저장: 줍기 · 장착 · 거래 · 스킬 · 레벨업 · 장면 전환 · 균열 완료/붕괴 · 사망. 캐릭터를 쓸 때는 계정도 같이 쓴다. 잦은 저장(처치마다 경험치)은 1초에 한 번으로 묶고, 장면 전환 · 사망 · 완료 · 붕괴 · 거래(사기 · 도박 · 재굴림 · 제작)는 바로 쓴다. 탭을 숨기거나 닫을 때(`pagehide`)도 쓴다.
- 깨진 세이브는 백업(`rift-hunter:backup:<원래 키>:<ms>` · 키마다 최신 3개)한 뒤 — 계정이면 캐릭터 세이브로 목록을 다시 세우고(보관함은 백업에 남는다), 캐릭터면 그 칸을 비운다. 같은 칸에 새 캐릭터를 만들면 확인 뒤 기존 캐릭터를 백업하고 덮는다. 더 새 버전에서 만든 세이브는 덮어쓰지 않는다(읽기만).
- 저장소가 막혀 있으면(사생활 보호 모드 등) 「저장되지 않는다」 알림이 남고 플레이는 그대로 된다.

## 개발용 쿼리 (`src/app/query.js` · 계약 §11.7)

`?panel` · `?analytics`만 있으면 보통 세션(세이브를 쓴다). 그 밖의 아래 쿼리가 하나라도 있으면 **개발 세션** — 세이브를 읽지도 쓰지도 않는다(설정은 예외). 모르는 쿼리(utm 등)는 무시한다.

| 쿼리 | 뜻 |
|---|---|
| `?fresh=1` | 일회용 세션 — 타이틀 없이 「새 캐릭터」 화면 |
| `?class=warrior\|mage` | 그 클래스의 개발용 캐릭터로 바로 마을(`?level` · `?rift`가 없으면 시작 장비) |
| `?level=n` | 그 레벨(1~30) · 스킬 포인트 · 프리셋 빌드(`?preset=0\|1`) |
| `?rift=n` | 균열 n을 바로 연다 · 해금 n · 그 레벨에 맞춘 무작위 장비(마법 60% · 희귀 40%) |
| `?seed=n` | 세션 시드(균열 시드도 여기서 파생 — 같은 시드면 같은 맵) |
| `?scene=town\|rift` | 시작 장면(rift면 `?rift`가 없을 때 균열 1 · town이면 `?rift`가 있어도 마을) |
| `?panel=<PanelId>` | 그 패널을 바로 연다 — 캐릭터 상태가 필요한 패널을 단독으로 주면 고정 상태를 함께 띄운다(개발 세션): 상점 넷 → `shops` · 인벤토리 · 캐릭터 · 보관함 → `bag` · 스킬 → `skillTree` · 균열석 · 안내 → `town` · 지도 → `riftSwarm` · 사망 → `riftDeath` · 균열 완료 → `riftComplete` |
| `?fixture=<id>` | 고정 상태(아래) — 다른 쿼리보다 먼저 |
| `?bot=1` | 봇 켬(`?strategy=basic\|noDodge\|challenge` · `?preset=0\|1`) |
| `?analytics=1` | 분석 패널을 연다 |

고정 상태(`src/debug/fixtures.js` — 화면 확인용 정지 상태 15): `town` `riftSwarm` `riftElites` `riftAffixes` `riftGuardian` `riftWitch` `riftWarrior` `riftMage` `riftLoot` `riftDeath` `riftComplete` `bag` `shops` `skillTree` `lowLife`.

## 디버그 API (`window.__game` · `src/app/debugApi.js` · 계약 §11.8)

| 메서드 | 뜻 |
|---|---|
| `getState()` | 살아 있는 상태 참조(읽기용 — 고치면 책임은 부른 쪽) |
| `pause(on = true)` | 일시정지(패널 없이 — 화면 확인) · Promise |
| `step(n = 1)` | n틱 step(멈춘 상태에서도 · 전환 막이 진행 중이면 그 틱만큼 막이 진행 · 봇이 켜져 있으면 봇의 입력) → 렌더 → Promise(값 = `state.tick`) |
| `setBot(on, {strategy, preset})` | 봇 켬/끔 |
| `errors()` | 수집한 오류 목록(문자열) — 새로 읽은 뒤의 값으로 판단한다 |
| `screen()` · `panel()` | 지금 화면(`boot` `title` `play` `fatal`) · 맨 위 패널 |
| `openPanel(id, args)` · `closePanel()` | 패널 열기 · 맨 위 닫기 |
| `loadFixture(id)` | 고정 상태로 바꾼다(이 세션은 개발 세션이 된다) |
| `gotoTown()` · `openRift(level, seed?)` · `completeRift()` | 장면 전환 · 균열 완료(막 없이 바로) |
| `spawnPack(monsterId, rank = 'normal', affixIds = null)` | 플레이어 앞 6m에 팩 |
| `killAll()` · `revealMap()` · `setInvincible(on)` | 전부 처치 · 지도 전부 · 무적 |
| `grant({gold, xp, materials, items})` | items = 등급 이름 배열(`['legendary', 'set']`) 또는 Item |
| `dropItem({rarity, slot, ilvl})` | 플레이어 앞 바닥에 아이템 |
| `setLevel(n)` · `setRiftUnlocked(n)` · `resetSkills()` | 레벨 · 해금 바꾸기 · 무료 스킬 초기화 |
| `rollDropsSample(opts)` | 드랍 시뮬레이터 표본(`{rank, level, cls, mf, blpOn, seed, n}`) |
| `hash()` · `memory()` · `stats()` | 상태 해시 · 누수 검사(`rc` · DOM · 리스너 · 오디오) · 캐릭터 시트 |
| `sim` · `actions` | 지금 GameSim · ui가 부르는 actions(화면 확인 스크립트용) |

화면 확인(내장 브라우저가 없을 때 — 헤드리스로 멈춰 찍는다):

```
npm run probe:screen -- "http://127.0.0.1:<port>/?fixture=riftSwarm" --step 1 --out docs/_scratch/swarm.png
npm run probe:screen -- "http://127.0.0.1:<port>/?class=mage&rift=3" --step 30 --eval "api.spawnPack('ghoul', 'elite')" --out docs/_scratch/elite.png
```

## 구조

`src/core`(수학 · 시드 난수 · 이벤트 버스 · 모양) · `src/data`(수치 · 정의 · 문자열 — 전부 표) · `src/sim`(규칙과 상태 — 고정 틱 30Hz) · `src/bot`(자동 플레이어 · 측정) · `src/debug`(고정 상태) · `src/view`(three — 월드 · 캐릭터/몬스터 · 연출) · `src/audio`(WebAudio 합성) · `src/ui`(HTML/CSS HUD · 패널 · 분석) · `src/app`(부트 · 루프 · 입력 · 저장 · 쿼리 · 디버그 API). 순수 계층(core · data · sim · bot · debug)은 Node에서 그대로 돈다(`test/purity.test.js`가 지킨다).

- 부팅 표식: 첫 화면이 그려지면 `<html data-game-ready="1">`, 실패면 `data-game-error`(`check:dist`가 읽는다).
- 장면 전환은 검은 막 0.3초(부활은 0.2초) — 맵 생성 · 셰이더 컴파일은 막 아래에서 끝난다(로딩 화면 없음).
