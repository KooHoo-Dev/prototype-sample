<!-- OWNER: P9 — 계약 §11 · §13 P9 -->
# RIFT HUNTER — 균열 사냥꾼

쿼터뷰 3D 핵앤슬래시 ARPG(쿼터뷰 핵앤슬래시의 시스템 조사 · 분석용). 마을(대장장이 · 잡화상 · 도박꾼 · 신비술사 · 보관함 · 균열석)과 시드로 생성한 균열을 오가며 몬스터 떼와 속성을 단 챔피언 · 정예를 쓸고, 확률 드랍 장비 · 스킬 트리로 강해져 균열 레벨을 올린다. 클래스는 전사 · 마법사.

방향은 `docs/BRIEF.md`, 이름 · 시그니처 · 수치의 정본은 `docs/CONTRACT.md`, 측정 리포트는 `docs/MEASURE.md`.

## 바로 해 보기

**갤러리(설치 없이)**: https://koohoo-dev.github.io/prototype-sample/rift-hunter/ — 아래 표의 쿼리(`?class=…` 등)를 이 주소 뒤에 그대로 붙여도 된다. 예: [전사 균열 10](https://koohoo-dev.github.io/prototype-sample/rift-hunter/?class=warrior&level=18&rift=10) · [정예 속성 12](https://koohoo-dev.github.io/prototype-sample/rift-hunter/?fixture=riftAffixes) · [봇 관전](https://koohoo-dev.github.io/prototype-sample/rift-hunter/?class=warrior&level=24&rift=18&bot=1) · [분석 패널](https://koohoo-dev.github.io/prototype-sample/rift-hunter/?analytics=1). 공개 빌드에도 디버그 API(`window.__game`)와 개발용 쿼리가 들어 있다 — 싱글 · 로컬 저장 게임이라 그대로 둔다.

**로컬**: dev 서버(`npm.cmd --prefix rift-hunter run dev`)를 띄운 뒤 주소창에 — 몇 시간 하지 않아도 균열 10 · 정예 속성 · 전설을 볼 수 있다. 이 주소들은 **개발 세션**이라 세이브를 읽지도 쓰지도 않는다(좌상단 「개발 세션 — 저장 안 됨」).

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
npm.cmd --prefix rift-hunter run preview        # 방금 빌드한 dist 를 http://localhost:5400 에서(프로덕션 모양)
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
| 귀환 두루마리(1.5초 시전 · 맞으면 끊긴다) · 완료한 균열에서는 두루마리 없이 바로 마을로(HUD 칸이 「T 마을」로 바뀐다) | `T` |
| 이름표 보기 · 고급 툴팁(옵션 티어 · 값 범위) | `Alt` 누르고 있기(누르고 있는 동안 `Q` · `T` · `1`~`4`는 나가지 않는다 — 알림이 뜬다 · `Shift`+클릭은 된다) |
| 인벤토리 · 스킬 트리 · 캐릭터 시트 | `I` · `S` · `C`(다시 누르면 닫힌다 · 인벤토리는 오른쪽 · 캐릭터는 왼쪽에 붙어 나란히 열린다 — 게임은 계속 돈다) |
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

## 게임 흐름

1. **타이틀** → 「새 캐릭터」(전사 · 마법사 · 이름) → 마을. 시작 장비 · 포션 5 · 두루마리 3 · 스킬 0점.
2. **마을 → 균열석**(클릭해 걸어가면 열린다) → 레벨 고르기(해금된 최고까지 · 몬스터 생명 · 피해 배율과 「앞 레벨보다 +n%」 · 보상 배율) → `Enter`.
3. **균열**: 떼를 쓸며 처치마다 균열 게이지가 오른다(일반 < 챔피언 < 정예). 100% → 균열 수호자(뼈 거인 · 잿빛 마녀) → 처치하면 보장 드랍 · 「균열 완료」 패널(그 순간 해금 · 기록 · 경험치가 저장된다). `Enter` = 계속 줍기 · `T` = 바로 마을로(무료).
4. **사망**: 「마을에서 부활」(`Enter`) → 마을의 「균열로 돌아가기」(`Enter`) — 키 2번. 장비 내구도 −10% · 균열 목숨 −1. 목숨 0에서 또 쓰러지면 **균열 붕괴**(그 판의 수호자 보상 · 해금을 잃는다 — 주운 것 · 골드 · 경험치는 남는다).
5. **정비(마을)**: 대장장이(사기 · 되사기 · 팔기 · 일괄 판매 · 수리 · 분해 · 제작) · 잡화상(포션 · 두루마리 · 장신구) · 도박꾼(부위별 확률 공개) · 신비술사(옵션 재굴림 · 스킬 초기화) · 보관함(계정 공유 60칸). 모든 거래에 전 · 후 수치가 나란히 나온다.
6. **성장**: 레벨마다 스킬 포인트 1(`S`) · 장비(`I` · 툴팁에 시트 DPS · 생명 · 방어 변화) → 클리어 +1 · 무사망 +2 해금 → 다음 판.

## 팁

- 가방이 차면 `T`(두루마리) → 마을에서 팔기 · 분해 → 마을 포털을 누르면 떠난 자리로 돌아간다(목숨을 쓰지 않는다).
- `Alt`를 누르고 있으면 바닥 아이템 이름표가 모두 보이고, 이름표를 눌러 줍는다. 희귀 이상은 늘 보인다.
- **붉은 테두리 바닥 표식**은 모두 적의 위협이다(감옥 · 역병 · 몰타르 · 냉기 노바 · 돌진 선 · 잿불 비 …). 정예 속성 설명은 일시정지 → 도움말.
- 몬스터 · 바닥을 누르고 있으면 벽을 돌아 따라간다. `Shift`를 누르면 그 자리에서 커서 쪽으로 친다(떼 속에서 대상이 엇갈릴 때).
- 균열 1~4는 첫 판 경사로 몬스터 피해가 아주 낮다(×0.03~×0.10 — 균열석 표에 셋째 자리까지). 경사는 균열 11에서 끝난다 — 균열 12 무렵이 첫 벽이다.
- 봇 관전: 분석 패널(`` ` ``) → `]` 세 번(봇 탭) → `Enter`. 보통 세션이면 켜기 직전까지 저장하고 그 뒤로는 저장하지 않는다.

## 저장

- **균열 진행은 저장되지 않는다.** 새로 고치면 마을에서 시작하고 열려 있던 균열은 닫힌다 — 주운 것 · 장착 · 골드 · 경험치 · 해금 · 기록은 저장돼 있다(일시정지 메뉴에도 적혀 있다).
- localStorage · 키 접두사 `rift-hunter:` — 계정(`rift-hunter:account` — 캐릭터 목록 · 보관함 60칸 · 다음 아이템 번호) · 캐릭터(`rift-hunter:char:0`~`3`) · 설정(`rift-hunter:settings`).
- 자동 저장: 줍기 · 장착 · 거래 · 스킬 · 레벨업 · 장면 전환 · 균열 완료/붕괴 · 사망. 캐릭터를 쓸 때는 계정도 같이 쓴다. 잦은 저장(처치마다 경험치)은 1초에 한 번으로 묶고, 장면 전환 · 사망 · 완료 · 붕괴 · 거래(사기 · 도박 · 재굴림 · 제작)는 바로 쓴다. 탭을 숨기거나 닫을 때(`pagehide`)도 쓴다.
- 깨진 세이브는 백업(`rift-hunter:backup:<원래 키>:<ms>` · 키마다 최신 3개)한 뒤 — 계정이면 캐릭터 세이브로 목록을 다시 세우고(보관함은 백업에 남는다), 캐릭터면 그 칸을 비운다. 같은 칸에 새 캐릭터를 만들면 확인 뒤 기존 캐릭터를 백업하고 덮는다. 더 새 버전에서 만든 세이브는 덮어쓰지 않는다(읽기만).
- 저장소가 막혀 있으면(사생활 보호 모드 등) 「저장되지 않는다」 알림이 남고 플레이는 그대로 된다.
- **봇**: 보통 세션에서 분석 패널의 「봇 자동 사냥」을 켜면 켜기 직전까지 저장하고, 그 뒤로 이 세션은 저장하지 않는다(봇은 잠기지 않은 가방 장비를 팔고 남은 스킬 포인트를 찍는다 — 새로 고치면 봇을 켜기 전 세이브로 돌아간다 · 지속 알림).
- **여러 탭**: 같은 세이브를 두 탭에서 열면, 다른 탭이 저장한 뒤로 이 탭은 저장하지 않는다(오래된 상태로 그 탭의 진행을 덮지 않게 — 지속 알림 「다른 탭에서 저장했다 — 새로 고침」).
- 저장하지 않는 세션(개발 세션 · 저장 막힘 · 봇 관전 · 다른 탭)에서 「타이틀로」 나가도 같은 세션 안에서는 계속하기 · 캐릭터 선택으로 그 캐릭터에 돌아간다(새로 고치면 사라진다).

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

## 알려진 한계

- **균열 진행은 저장하지 않는다**(새로 고치면 마을 · 열려 있던 균열은 닫힌다 — 브리프 §3.1).
- 마을 도착 자리(기본 카메라 24m)에서 대장장이 · 잡화상 · 도박꾼이 화면 가장자리 밖이다 — 마우스를 올리면 위 대상 프레임에 이름이 나오고, 미니맵에 점으로 보인다(이름표 없음).
- 스킬 트리(`S`)는 비모달이라 균열에서 열면 가운데에서 플레이어를 가리고, 열린 동안 `1`~`4`는 칸 배정 키다(계약 §10.2 · §10.5-3 — Jay가 정할 것).
- `Alt`를 누른 동안 `Q` · `T` · `1`~`4`는 나가지 않는다(리포 규칙 「Alt 조합은 건드리지 않는다」 — 알림이 뜬다).
- 메테오 · 작은 메테오는 시야를 보지 않는다(목표 = 커서 · 18m) — 벽 너머로 떨어진다.
- 봇은 도박 · 재굴림 · 제작 · 보관함을 쓰지 않고 화살 · 조준선을 피하지 않는다(측정의 한계 — `docs/NOTES-BALANCE.md` §7).
- 소리 · 실제 프레임레이트 · 실제 GPU 그림자 · 실제 마우스 감각은 헤드리스로 확인하지 못했다(`docs/NOTES-REVIEW.md` 「사람이 확인할 것」).

## 구조

`src/core`(수학 · 시드 난수 · 이벤트 버스 · 모양) · `src/data`(수치 · 정의 · 문자열 — 전부 표) · `src/sim`(규칙과 상태 — 고정 틱 30Hz) · `src/bot`(자동 플레이어 · 측정) · `src/debug`(고정 상태) · `src/view`(three — 월드 · 캐릭터/몬스터 · 연출) · `src/audio`(WebAudio 합성) · `src/ui`(HTML/CSS HUD · 패널 · 분석) · `src/app`(부트 · 루프 · 입력 · 저장 · 쿼리 · 디버그 API). 순수 계층(core · data · sim · bot · debug)은 Node에서 그대로 돈다(`test/purity.test.js`가 지킨다).

- 부팅 표식: 첫 화면이 그려지면 `<html data-game-ready="1">`, 실패면 `data-game-error`(`check:dist`가 읽는다).
- 장면 전환은 검은 막 0.3초(부활은 0.2초) — 맵 생성 · 셰이더 컴파일은 막 아래에서 끝난다(로딩 화면 없음).
