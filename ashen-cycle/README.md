# ASHEN CYCLE — 잿빛 순환

3인칭 소울라이크 보스 러시. **마을(정비) ↔ 보스전**을 짧게 오가며, 죽어도 성장하고 곧바로 다시 도전한다.
Three.js + Vite + 바닐라 JS(ES 모듈). 외부 에셋 0 — 모델 · 텍스처 · 소리 전부 절차 생성이다.

> 방향은 [`docs/BRIEF.md`](docs/BRIEF.md), 이름 · 단위 · 시그니처 · 수치의 정본은 [`docs/CONTRACT.md`](docs/CONTRACT.md)다.
> 프로토타입 리포의 한 폴더다 — 리포 규칙은 루트 `CLAUDE.md`. 그 규칙이 생기기 전에 만든 것이라 몇 가지가 기준과 다르다: 디버그 API는 `window.__ashen`, 단일 HTML(선택 명령)은 `release/AshenCycle.html`이고 `check:standalone`이 없다. 갤러리에는 올리지 않는다(Jay · 2026-10-02).

## 실행

Node 22 이상. 브라우저는 WebGL2가 되는 데스크톱 Chrome · Edge · Firefox(키보드 · 마우스 또는 게임패드 — 터치로는 조작할 수 없다).

```bash
npm install
npm run dev       # http://localhost:5183 — 포트가 이미 쓰이고 있으면: npx vite --port 5191 --strictPort
npm run build     # dist/
npm run preview   # 빌드 결과 확인(같은 포트)
npm test          # node --test "test/**/*.test.js"
npm run check:dist         # 게이트 — dist/ 를 하위 경로 http 로 내주고 헤드리스 Chrome 으로 부팅 표식을 본다(스크린샷 release/boot.png)
npm run build:standalone   # 선택 — release/AshenCycle.html, 더블클릭으로 열리는 HTML 한 장
```

- **다른 PC에 전달**(오프라인 파일이 필요할 때): `release/AshenCycle.html` 한 파일만 보내면 된다(설치 · 서버 · 인터넷 불필요 — 브라우저로 연다). `dist/`는 웹 서버에 올릴 때 쓴다 — `dist/index.html`을 더블클릭하면 브라우저가 `file://`의 모듈 스크립트를 막아 빈 화면이 된다.
- PowerShell에서 `npm`이 실행 정책에 막히면 `npm.cmd`로 부른다(예: `npm.cmd run build:standalone`). 리포 루트에서는 폴더를 붙인다 — `npm.cmd --prefix ashen-cycle run dev`.

- `npm run dev`는 5183 고정(`strictPort`)이다. `npm run preview`도 같은 포트를 쓰므로 둘을 같이 띄우려면 `npx vite preview --port 5191 --strictPort`처럼 포트를 준다.
- 테스트는 전부 Node에서 돈다(브라우저 없음 · 676개 · 약 4초): 수학 · 판정 · 플레이어 · 보스 · 경제 · 저장 · 리그 · 카메라 · 연출 · 소리 · 입력/화면 전환 + **헤드리스 봇 대전**(`test/bot.fight.test.js`) + 리뷰 회귀(`test/regress.w5.test.js`).
- 봇 대전(`node --test test/bot.fight.test.js`)은 세 보스의 A~D · 발더의 E · 세 보스 메타 루프 F · 통계 G를 전부 돈다(약 2초). 측정 표와 밸런스 조정 내역은 `docs/NOTES-W3.md`, 리뷰 뒤 바뀐 수치는 `docs/NOTES-REVIEW.md`.

## 게임 흐름

```
타이틀(새 게임 · 이어하기)
   └▶ 마을 ──안개문──▶ 보스전 ──▶ 결과(획득 잔불 · 준 피해 %)
        ▲                              │
        └────────[마을로]──────────────┤
                 [즉시 재도전] ─────────┘ (같은 보스로 곧바로)
```

- **마을**: 화톳불(레벨업 · 플라스크 보충) · 대장장이(무기 강화 · 교체) · 상인(플라스크 · 유물) · 안개문(보스 선택) · 허수아비(연습). 시설 앞에서 `E`.
- **보스전**: 발더 → 펜리르 → 니힐 순서로 해금된다. 셋을 모두 잡으면 **순환 +1**(더 강해지고 보상도 커진다).
- **죽어도 잃지 않는다**: 보스에게 준 피해만큼 잔불을 받는다. 일시정지 → `[마을로]`로 포기해도 같은 보상이다.
- **전환**은 페이드 0.3초 + 0.4초(로딩 없음 — 막은 새 화면이 두 프레임 그려진 뒤에 걷힌다). 결과 화면에서 `R`이면 바로 다시 싸운다.
- **저장**은 자동이다(마을 · 보스전 진입 · 구매 · 보상). 타이틀에서는 쓰지 않는다. 설정(감도 · 볼륨 · 화질)은 세이브와 다른 키에 따로 남는다.
  읽지 못한 세이브는 지우지 않고 `ashen-cycle/save.bak`에 원문을 보관한다. 「새 게임」으로 덮기 직전의 세이브도 같은 키에 한 벌 남긴다
  (타이틀의 「새 게임」은 저장이 있으면 한 번 더 눌러야 하고, 첫 입력 뒤 0.7초 안의 입력은 확정으로 치지 않는다).
  브라우저가 사이트 데이터 저장을 막고 있으면 타이틀과 화면 아래에 「진행이 저장되지 않는다」가 뜬다.

## 조작

| 행동 | 키보드 · 마우스 | 게임패드(표준 매핑) |
|---|---|---|
| 이동 | `W` `A` `S` `D` (화살표) | 왼쪽 스틱 |
| 카메라 | 마우스 | 오른쪽 스틱 |
| 약공격(연속기) | 좌클릭 | RB |
| 강공격(누르고 있으면 차지) | `F` 또는 휠 클릭 | RT |
| 가드 / 패링(막는 순간에 맞춰 누름) | 우클릭 홀드 | LB |
| 구르기 / 백스텝(방향 없이) | `Space` | B(짧게) |
| 달리기 | `Shift` 홀드 | B(길게) |
| 록온 | `Q` 또는 `Tab` | R3 |
| 플라스크 | `R` | X |
| 상호작용 | `E` | A |
| 일시정지 · 설정 | `Esc` | Start |

- 화면을 한 번 클릭하면 마우스가 잡혀(포인터 락) 마우스로 시점을 돌린다. 락을 얻지 못하는 환경에서는 **마우스 버튼을 누른 채 끌어** 카메라를 돌린다.
- 패널은 키보드만으로 조작한다: `W` `S` 선택 · `A` `D` 값 조절 · `E` 확인 · `Q` 닫기(게임패드: D-pad · A · B). 안개문에서 `E`, `E` 두 번이면 출발한다.
- 전투 요령은 아래 「팁」과 일시정지 패널(`Esc`)에 있다.
- 창이 포커스를 잃으면 보스전은 스스로 멈춘다(전환 페이드 중에 잃어도 도착한 보스전에서 멈춘다). 쓰던 게임패드가 끊기거나 그래픽 장치가 끊겨도 멈춘다. 숨은 탭 · 포커스 없는 창에서는 소리도 멈춘다.
- 이동 · 가드 · 달리기는 「지금 눌려 있는가」로 읽는다 — 재도전 · 입장의 페이드 중에 미리 눌러 둔 키가 그대로 먹는다. 화면이 바뀐 직후 0.5초 동안의 누름(공격 · 구르기 · 플라스크 · 상호작용)은 버리고, 그때 연타하던 키는 연타가 멎은 뒤부터 받는다(결과 화면을 넘기던 `E` · `R` 연타가 레벨업 · 플라스크로 새지 않게). 키 표는 `src/data/keybinds.js`에 있다(`Ctrl`은 쓰지 않는다).

## 팁

- **패링**: 공격이 닿기 직전에 가드를 누른다(창 0.18초). 짧게 눌렀다 떼도 된다 — 창이 열려 있는 동안은 가드가 유지된다. 연타로는 창이 더 자주 열리지 않는다(다시 올릴 때까지 0.4초).
- **붉게 빛나는 공격**은 패링할 수 없다 — 구르거나 가드로 받는다. 발밑에서 솟는 장판은 그 안에 서 있으면 어느 쪽을 보든 가드로 받을 수 있다.
- **체간**: 약공격 · 강공격(차지할수록 크다) · 패링이 보스의 체간 바를 채운다. 가득 차면 보스가 무너지고, 정면에서 약공격으로 **처형**한다. 한 방으로는 체간을 다 채울 수 없고(최대 60%), 무너졌다 일어난 보스는 **다음 공격을 낼 때까지 체간이 쌓이지 않는다**(체간 바가 흐려지고 「체간 잠김」이 뜬다 — 피해는 들어간다).
- **보스의 근접 공격은 보이는 무기 · 몸이 닿는 곳까지만 맞는다.** 뒤로 걸어 칼끝을 벗어나는 것도 회피다. 바닥 표식이 있는 공격(돌진 · 도약 · 장판 · 광선)은 표식이 판정이다.
- **구르기 · 플라스크는 미리 눌러 둬도 된다**: 공격 중이면 그 공격의 캔슬 창에서, 넘어져 있으면 일어나는 순간에 나간다. 방향 입력 없이 구르면 백스텝이다.
- **보스별**: 발더는 휘두른 뒤의 빈틈이 길다 · 펜리르는 물기가 빠르다(후딜에만 때리고, 브레스는 옆구리 쪽으로 파고든다 · 도약은 기둥 뒤에 서면 기둥 앞에 내려앉는다) · 니힐의 구체는 구르기 한 번으로 다 못 피한다(가드 · 패링).
- **성장**: 죽어도 준 피해만큼 잔불을 받는다. 결과 화면의 「레벨업 N회 가능」을 보고 `[마을로]` → 화톳불. 무기 강화는 파편이 든다(피해 25 · 50 · 75% 구간과 격파에서 나온다). 유물은 상인에게서 사고 두 칸에 끼운다(다른 칸의 버튼을 누르면 맞바뀐다).

## 폴더 구조

```
src/
  main.js  진입점 — new Game(document).start()
  core/    순수 유틸(상수 · 이벤트 버스 · 2D 수학 · 시드 난수 · 셰이프 판정 · 충돌 기하)   ← 아무것도 import하지 않는다
  data/    수치 · 정의(플레이어 · 무기 · 보스 · 월드 · 경제 · 봇 · 키 · 문자열)           ← core
  sim/     순수 JS 시뮬레이션(고정 틱 1/60초 · XZ 평면 · 시드 난수). 상태의 정본          ← core · data
  bot/     헤드리스 봇 — 상태를 읽고 InputFrame만 만든다(테스트 · 자동화 · 구경)          ← core · data
  view/    three.js 표현(월드 · 캐릭터 · 연출 · 카메라). sim 상태를 읽기만 한다           ← three · core · data
  audio/   WebAudio 합성                                                                ← core · data
  ui/      HTML/CSS HUD · 패널                                                          ← core · data
  app/     조립: Game(부트 · 프레임) · loop(고정 틱 누산) · screens(화면 상태 기계)
           · input(키보드 · 마우스 · 게임패드) · storage(localStorage) · debugApi         ← 전부
  types.js JSDoc typedef 전부(런타임 export 없음)
test/      node:test — 패키지별 테스트 + layering(의존 규칙 · 순수성) + 봇 대전
docs/      BRIEF · CONTRACT · 패키지별 NOTES
```

- 좌표: Y-up, 단위 m. facing θ의 방향 = `(sin θ, cos θ)` — θ = 0이면 +Z를 본다. 시간은 전부 초.
- sim은 `three` · DOM · WebAudio · 시계 · `Math.random`을 쓰지 않는다(`test/layering.test.js`가 지킨다) — Node에서 그대로 돈다.
- 입력은 app이 매 틱 `InputFrame`(순수 객체)으로 만들어 sim에 넘긴다. 봇도 같은 형태를 만든다.
- 수치는 전부 `src/data/`에 둔다. 로직에 박지 않는다.

## 디버그

### URL 쿼리

| 쿼리 | 동작 |
|---|---|
| `?boss=valder` · `fenrir` · `nihil` | 타이틀을 건너뛰고 그 보스전으로 |
| `?town=1` | 타이틀을 건너뛰고 마을로 |
| `?panel=bonfire` · `blacksmith` · `merchant` · `gate` · `result` · `pause` | 마을(또는 `?boss`의 보스전)에서 그 패널을 연다 |
| `?god=1` | 무적 |
| `?bot=1` | 봇이 조종한다(`?boss=valder&bot=1`로 구경) |
| `?fresh=1` | 세이브를 읽지도 쓰지도 않는 새 프로필로(타이틀부터) |
| `?save=1` | 위 쿼리와 함께 써도 실제 세이브를 읽고 쓴다 |
| `?nopause=1` | 포커스 · 포인터 락을 잃어도 일시정지하지 않는다 |

타이틀을 건너뛰는 쿼리(`boss` · `town` · `panel`)와 `fresh`는 **일회용 세션**이다: 시드 1의 새 프로필로 시작하고, localStorage의 프로필을 건드리지 않으며(설정은 평소대로), 포커스를 잃어도 멈추지 않는다 — 자동화와 스크린샷이 매번 같은 판을 본다.

### `window.__ashen`

| 메서드 | 동작 |
|---|---|
| `version` | 게임 버전 |
| `getState()` · `getProfile()` | 상태 · 프로필의 복사본 |
| `getScreen()` | `{screen, paused, panel, pointerLocked}` |
| `newGame()` · `continueGame()` · `toTown()` | 화면 전환(Promise) |
| `startBoss(bossId)` | 해금을 무시하고 보스전 시작(Promise) |
| `openPanel(id)` · `closePanel()` | 패널 |
| `giveEmbers(n)` · `giveShards(n)` | 재화 지급 |
| `levelUp(statId, times)` · `upgradeWeapon(weaponId, times)` · `equipWeapon(weaponId)` | 진행 명령 |
| `setBot(on, opts)` | 봇 조종. `opts` = `{seed, dodgeChance, reaction, aggression}` |
| `setTimeScale(x)` | 배속 0.1~8 |
| `setGodMode(on)` · `setNoStamina(on)` | 무적 · 스태미나 무한 |
| `damageBoss(n)` · `setBossHp(frac)` · `killBoss()` · `forfeit()` | 보스전 조작 |
| `step(n, input)` | n틱을 손으로 밀고 **화면까지 갱신한다**. `input`(부분 `InputFrame`)을 주면 그 n틱의 입력(에지 `*Pressed`는 첫 틱만) |
| `setInput(partial)` · `clearInput()` | 입력 덮어쓰기. 홀드는 지울 때까지, 에지는 다음 한 틱만. `moveX/moveZ`는 월드 좌표다 |
| `pause(on)` | 패널 없는 일시정지 |
| `events(n)` | 최근 이벤트 `[{t, tick, name, payload}]`(최대 200개) |
| `errors()` | 수집한 오류(`window.onerror` · `unhandledrejection` · 레이어 예외) |
| `sim` · `bus` · `progression` · `game` | 원본 참조 |

숨은 탭이나 자동화 창에서는 `requestAnimationFrame`이 돌지 않는다. 그때는 실제 시간을 기다리지 말고 `step`으로 민다
(자동화가 `window`에 보내는 실제 키 이벤트는 화면 전환 뒤 0.5초 동안 버려진다 — `step(n, input)` · `setInput`은 그 규칙을 거치지 않는다):

```js
await __ashen.newGame();            // 타이틀 → 마을
await __ashen.startBoss('valder');  // 페이드 포함
__ashen.setBot(true);
__ashen.step(600);                  // 10초 — 틱 + 레이어 update + 렌더
__ashen.getState().fight.damageDealt > 0;
__ashen.errors().length === 0;
```

## 알려진 한계

- **사람이 실시간으로 한 판을 해 본 적이 없다.** 개발 환경의 브라우저 창이 숨겨져 `requestAnimationFrame`이 돌지 않았다 — 전부 정지 화면(`__ashen.step`)과 Node 측정으로 확인했다. 조작감 · 카메라 추종 · 히트스톱의 체감 · 실제 fps · **소리 전부** · 포인터 락을 쥔 상태 · 실제 게임패드는 미확인이다(확인 목록: `docs/NOTES-REVIEW.md` 「사람이 확인할 것」).
- **밸런스는 봇 기준이다.** 봇은 패링 · 강공격 · 무기 교체 · 유물을 쓰지 않고 늘 붙어 싸운다. 패링을 쓰거나 거리로 피하는 사람에게는 봇 수치(발더 약 5회)보다 쉬울 수 있다. 대검 · 창은 예외 없음과 체간 루프만 확인했다.
- **잡지 않고 죽거나 포기하기를 반복하면 재격파 감쇠 없이 잔불을 번다**(순환 0 니힐 99% 포기 1,932 vs 재격파 750). 「죽어도 성장한다」와 맞닿은 값이라 그대로 뒀다 — 결정 사항은 `docs/NOTES-REVIEW.md`.
- 「새 게임」으로 덮은 세이브는 `localStorage`의 `ashen-cycle/save.bak`에 남지만 **되돌리는 화면은 없다**(개발자 도구에서 `ashen-cycle/save`로 옮겨야 한다).
- HP가 가득해도 플라스크를 마실 수 있다(한 병을 쓴다). 화면이 바뀐 직후의 연타는 걸러지지만 그 뒤의 `R`은 그대로 먹는다.
- 포인터 락을 얻지 못하는 환경(드래그 모드)에서는 왼쪽 버튼으로 끌면 약공격도 나간다 — 우클릭(가드)으로 끈다.
- 터치 조작 없음 · 키 재설정 화면 없음(`src/data/keybinds.js`를 고친다) · 언어는 한국어뿐.
- 빌드 결과는 JS 한 덩어리(약 1MB · gzip 0.3MB)다 — 코드 분할을 하지 않았다.

## 문서

- [`docs/BRIEF.md`](docs/BRIEF.md) — 디자인 방향과 제약
- [`docs/CONTRACT.md`](docs/CONTRACT.md) — 모듈 API · 이벤트 · 상태 · 수치의 정본(파일 소유 표는 §1)
- `docs/NOTES-P*.md` — 패키지별 결정 · 계약과 달라진 곳
- `docs/NOTES-W1.md` · `NOTES-W3.md` · `NOTES-VISUAL.md` — 통합 게이트(맞물림 · 밸런스 · 화면)의 결과
- [`docs/NOTES-REVIEW.md`](docs/NOTES-REVIEW.md) — 리뷰(W5)에서 고친 것 · 남은 것 · 사람이 확인할 것
