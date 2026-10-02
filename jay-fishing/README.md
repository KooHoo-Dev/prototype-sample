# Jay Fishing v0.1

<!-- OWNER: P9 — 계약 §13 P9 -->

1인칭 3D 낚시 RPG. 집(PC로 정비)과 실제 장소를 본뜬 스테이지 3곳(충주호 · 조가사키 해안 · 컬럼비아강)을 오가며 찌낚시 · 바닥낚시로 물고기를 잡는다. 드랙 · 텐션 손맛으로 랜딩해 팔고, 레벨과 장비로 더 큰 물고기를 노린다. 실제 1시간이 게임 하루다.

## 바로 해 보기 — 레벨 게이트 건너뛰기

dev 서버를 띄운 뒤 아래 주소를 연다. 주소에 개발용 쿼리가 붙으면 **일회용 세션**이 된다(타이틀 없음 · 실제 세이브를 읽지도 쓰지도 않음).

| 보고 싶은 것 | 주소 |
|---|---|
| 처음부터(타이틀 → 새 게임) | `http://localhost:5300/` |
| 호수 자리에서 바로 낚시 | `http://localhost:5300/?spot=lake_gravel&time=18` |
| 갯바위(레벨 5 게이트 건너뛰기 · 2단계 장비) | `http://localhost:5300/?scene=coast&level=6&gear=2&money=300000` |
| 강 깊은 홈(레벨 10 게이트 건너뛰기 · 2단계 장비) | `http://localhost:5300/?spot=river_trench&level=12&gear=2&money=3000000` — 3단계는 `&gear=3`. `gear`를 빼면 1단계 장비라 강에서 거의 진다(꼬리물 랜딩 13–36%) |
| 봇이 하루를 대신 낚는다 | `http://localhost:5300/?bot=1`(호수) · `?scene=coast&level=6&gear=2&bot=1`(갯바위) · `?scene=river&level=12&gear=2&bot=controlled`(강) · 자리에서만: `?spot=lake_gravel&bot=1` |

## 실행

리포 루트의 PowerShell에서 실행한다. 실행 정책 때문에 `npm` 대신 `npm.cmd`를 쓴다.

```
npm.cmd --prefix jay-fishing install
npm.cmd --prefix jay-fishing run dev        # http://localhost:5300
```

| 명령(`npm.cmd --prefix jay-fishing …`) | 뜻 |
|---|---|
| `run dev` | 개발 서버(포트 5300) |
| `run build` | 프로덕션 빌드(`dist/`) |
| `test` | `node --test` — 순수 계층 · 데이터 · 봇 헤드리스 · 패키지별 테스트 |
| `run check:dist` | 빌드를 갤러리와 같은 하위 경로 · http에서 헤드리스로 부팅한다(`release/boot.png`) |
| `run probe:screen -- "<주소?쿼리>" --step <n> --out docs/_scratch/<이름>.png` | 떠 있는 서버의 정지 화면을 찍는다 |
| `run measure` | 봇 측정 표 |

## 게임 흐름

1. **타이틀**: 「이어하기」 또는 「새 게임」을 고른다. 세이브가 있는데 새 게임을 고르면 확인을 한 번 받고, 기존 기록은 백업된다.
2. **집**: PC(`E`)에서 상점 · 날씨 · 도감 · 스킬을 본다. 문(`E`)으로 나가 지도에서 스테이지를 고른다. 침대(`E`)에서 자면 다음 날 06:00이 된다.
3. **스테이지**: 주황 깃발과 바닥의 흰 고리가 낚시 자리다. `E`로 서서 캐스팅 → 입질 → 챔질 → 파이팅 → 뜰채 순서로 진행하고, 결과 패널에서 어창에 넣거나(`Space`) 방생한다(`X`).
4. **판매상**(`E`): 어창의 물고기를 팔고, 미끼와 라인을 산다.
5. **캠프**(`E`): 다음 시간대까지 기다리거나 집으로 간다. 이동 · 기다리기 · 수면에는 1초 안팎의 전환 막이 있다.
6. **다시 집**: 남은 물고기는 자동으로 팔린다. 입문 라인은 무료로 다시 감긴다.

저장은 자동이다. 랜딩 결정 · 실패 손실 · 판매 · 구매 · 장착 · 씬 전환 · 날 바뀜 · 수면 때 저장하고, 탭을 숨기거나 닫을 때도 저장한다. 결과 패널에서 아직 고르지 않은 물고기도 남는다(어창에 자리가 있으면 어창으로).

## 조작

| 행동 | 키 |
|---|---|
| 이동 | `W` `A` `S` `D` |
| 둘러보기 | 마우스. 화면을 한 번 클릭하면 시점이 고정되고, 그 클릭으로 던지지는 않는다. 시점 고정을 쓸 수 없는 환경이면 가운데 버튼을 누른 채 끌어서 둘러본다(걷기 중에는 좌 · 우 드래그도 된다) |
| 낚시 중 조준 | `A` / `D`(시점 고정 없이도 된다) |
| 상호작용(자리 · 판매상 · 캠프 · PC · 침대 · 문) | `E` |
| 캐스팅(누르고 있다가 놓기) · 릴링 · 회수 | 좌클릭(홀드) |
| 펌핑(로드 세우기) | 우클릭(홀드) |
| 챔질 · 뜰채 | `Space` |
| 드랙 조이기 / 풀기 | 휠 ↑ / ↓ · `Z` / `C` |
| 베일 열기/닫기(찌 흘리기 · 줄 풀기) | `R` |
| 찌 수심 깊게 / 얕게 | `↑` / `↓` |
| 채비 세트 | `1` 찌 · `2` 바닥 |
| 채비 · 도감 · 스킬 패널 | `Tab` |
| 결과: 어창 / 방생 | `Space` / `X` |
| 패널 닫기 → 낚시 자리에서 일어나기 → 일시정지 | `Esc`(이 순서대로 하나만 처리한다) |
| 패널 안 | `↑` `↓` 항목 · `Q` / `E` 탭 · `←` `→` 값 · `Enter` / `Space` 실행 |

창이 포커스를 잃거나 탭이 숨으면 자동으로 일시정지한다. `Ctrl` · `Alt` · `Meta` 조합 키는 게임이 건드리지 않는다.

## 개발용 쿼리

`quality` · `mute` · `nopause`를 뺀 쿼리가 하나라도 있으면 **개발 세션**이다. 개발 세션은 타이틀 없이 바로 시작하고, 실제 세이브를 읽지도 쓰지도 않는다. 설정은 저장한다. 값이 잘못된 쿼리는 무시한다.

| 쿼리 | 뜻 |
|---|---|
| `?fresh=1` | 새 프로필로 시작 |
| `?scene=<home\|lake\|coast\|river>` | 레벨 게이트를 무시하고 그 씬의 시작점에서 시작 |
| `?spot=<자리 ID>` | 그 자리에서 낚시 모드로 시작(게이트 무시). `lake_shallows` `lake_gravel` `lake_cape` `coast_shoal` `coast_channel` `coast_cape` `river_tailrace` `river_trench` `river_riffle` |
| `?level=<1..20>` · `?money=<n>` | 그 레벨(스킬 포인트 = 레벨) · 돈으로 시작. 범위 밖이면 범위로 자른다 |
| `?gear=<1\|2\|3>` | 두 세트의 로드 · 릴 · 라인 · 찌/봉돌을 그 단계로 끼우고 시작(바늘 · 미끼 · 드랙 눈금은 그대로). 갯바위는 2, 강은 2 · 3이 그 스테이지에 올 때의 장비다 |
| `?time=<0..24>` · `?weather=<clear\|cloudy\|rain>` · `?seed=<n>` | 시작 시각 · 오늘 날씨(모든 스테이지) · 시드 |
| `?bot=<1\|basic\|controlled\|mindless\|locked>` | 봇이 플레이한다(1 = basic · 자동 패널 끔). `?spot`이 있으면 그 자리에 머물고, 없으면 지금 씬의 하루 계획(호수 · 갯바위 · 강 — 집에서 시작하면 호수)을 돈다 |
| `?panel=<tackle\|pc\|sell\|camp\|map\|bed\|pause\|result>` | 시작하자마자 그 패널을 연다(`result`면 붕어 결과를 만든다) |
| `?fixture=<이름>` | 고정 상태를 세우고 sim을 진행하지 않는다(레이어 · ui만 돈다). `walkLake` `ready` `charging` `waiting` `driftRiver` `nibble` `take` `fightRun` `fightJump` `fightStress` `netReady` `landing` `result` `failedRodBreak` `night` `rain` `shopL12`. `?panel`과 함께 쓸 수 있다 |
| `?quality=<low\|medium\|high>` · `?mute=1` | 화질 · 소리 끔. **이번 실행만** 적용되고 저장하지 않는다(일시정지 설정 탭에 「이번 실행만」으로 표시) |
| `?nopause=1` | 포커스를 잃어도 일시정지하지 않는다 |

## 디버그 API — `window.__game`

| 메서드 | 동작 |
|---|---|
| `getState()` | sim 상태(읽기 전용으로 쓴다) |
| `pause(on)` | 루프의 sim 진행을 멈춘다(렌더는 계속). 반환값은 지금 값 |
| `step(n = 1)` | n틱을 동기로 밀고 렌더까지 한다 → Promise. 봇이 켜져 있으면 봇의 입력 · 명령으로 민다(전환 막이 열리면 끝날 때까지 기다린다). 패널이 열려 있거나 결과 단계면 멈춘다. `?fixture` 모드면 sim은 그대로 두고 레이어 · ui `update`만 n번 돈다 |
| `setBot(on \| strategy)` | 봇 켜기/끄기(`'basic'` · `'controlled'` · `'mindless'` · `'locked'`). 켜면 자동 패널이 꺼지고, 열려 있던 결과 · 장소 패널이 닫힌다 |
| `loadFixture(name)` | 고정 상태로 바꾸고 fixture 모드로 들어간다 |
| `errors()` | 잡히지 않은 예외 · 거부된 Promise · `console.error` 문면 |
| `screen()` · `startGame()` | 지금 화면(`title` · `play`) · 타이틀을 건너뛰고 새 개발 세션으로 play |
| `openPanel(id, args)` · `closePanel()` | 패널을 바로 연다 · 닫는다 |
| `setTime(h)` · `setWeather(id)` · `gotoScene(id)` · `gotoSpot(id)` | sim의 `debug*`를 부른다 |
| `forceBite(speciesId, pct)` · `forceFight(speciesId, pct)` · `skipToResult(speciesId?, pct?)` | 바로 입질 · 파이팅 · 결과 |
| `grant({money, xp})` · `setGear(slot, id, set?)` | 돈 · 경험치 · 장비 |
| `hash()` · `fps()` · `memory()` | 상태 해시 · 최근 fps · `{geometries, textures, programs, domNodes, listeners, audioNodes, particles}`(누수 검사용) |

sim을 바꾸는 디버그 메서드를 한 번이라도 부르면 그 실행은 개발 세션이 되어, 실제 세이브를 더 이상 쓰지 않는다.

예: `npm run probe:screen -- "http://127.0.0.1:5301/?spot=lake_gravel&time=18&bot=controlled" --eval "api.forceFight('carp', 0.95)" --step 120 --out docs/_scratch/fight.png`

## 저장 · 설정

- localStorage를 쓴다. 키는 `jay-fishing:save` · `jay-fishing:settings`다.
- 세이브가 손상됐거나 더 새 버전이면 원문을 `jay-fishing:save.bak.<ms>`에 백업하고(최신 3개만 남는다) 새로 시작한다. 타이틀에 그 사실을 표시한다.
- 새 게임을 시작하면 기존 세이브를 같은 방식으로 백업한다.
- localStorage를 쓸 수 없으면 타이틀에 안내를 띄우고, 저장 없이 플레이한다.

## 알려진 한계

- 터치만 있는 기기는 지원하지 않는다(타이틀에 안내가 뜬다).
- 전환 막의 합은 최대 1.0초다(0.45 + 렌더 두 프레임 또는 100ms 중 먼저 + 0.45). 하드웨어 가속이 없는 환경에서는 타이머가 늦어 더 길어진다(헤드리스 소프트웨어 렌더에서 약 2.9초를 쟀다).
- WebGL 컨텍스트를 잃으면 알림(「그래픽 장치가 초기화됐다」)과 함께 일시정지 패널을 띄운다. 복구되면 「계속하기」로 돌아간다.
- 장비 내구도 · 수리 · 루어낚시 · 멀티플레이는 없다(브리프 부록 A 로드맵).

## 사람이 확인할 것

이 환경에서는 정지 화면만 확인했다.

- **포인터 락**(Chrome · Edge · Firefox): 첫 클릭이 시점만 고정하고 캐스팅을 시작하지 않는지 확인한다.
- **Esc**: 시점 고정 중 낚시 자리에서 `Esc`를 한 번 누르면 일어나기만 하고, 일시정지는 열리지 않아야 한다. 걷는 중이면 일시정지가 열린다.
- **패널 닫기 후 시점**: 패널을 `Esc`로 닫으면 「클릭해서 시점 고정」이 뜨고, 클릭하면 다시 고정되어야 한다. 드래그 모드로 바뀌면 안 된다. `Enter`나 클릭으로 닫으면 바로 다시 고정된다.
- **좌클릭을 누른 채 우클릭**(릴링 + 펌핑)이 둘 다 먹는지 확인한다.
- **소리**: 첫 키 · 클릭에서 켜지고, 일시정지 · 탭 숨김에서 멈춘다.
- **탭 복귀**: 몇 분 숨겼다 돌아와도 시계가 튀지 않고 일시정지 패널이 떠 있어야 한다.
- **전환 막**의 실제 길이(1초 이내)를 확인한다.

## 구조

| 폴더 | 내용 |
|---|---|
| `src/core` | 수학 · 난수 · 이벤트 · 상수 |
| `src/data` | 수치 · 정의 · 문자열 |
| `src/sim` | 규칙과 상태 |
| `src/bot` | 자동 플레이어 |
| `src/debug` | 고정 상태 |
| `src/view` · `src/audio` · `src/ui` | 화면 · 소리 · UI |
| `src/app` | 부트 · 루프 · 입력 · 저장 · 화면 전환 · 디버그 API |

정본 문서는 `docs/BRIEF.md`(방향)와 `docs/CONTRACT.md`(이름 · 수치 · 시그니처)다.
