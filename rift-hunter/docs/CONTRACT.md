# RIFT HUNTER — 구현 계약 (CONTRACT)

> `docs/BRIEF.md`가 방향이고, 이 문서가 **이름 · 단위 · 시그니처 · 상태 모양 · 수치**의 정본이다.
> 병렬 작업자는 서로의 파일을 보지 않고 이 문서만으로 맞물린다. 여기 적힌 export 이름 · 필드 이름 · 이벤트 이름 · 문자열 ID · 단위는 **글자 그대로** 쓴다.
> 문서에 없는 것은 소유 패키지의 재량이다. 문서와 구현이 어긋나야 할 사정이 생기면 **자기 파일 안에서만** 해결하고(공개 시그니처 · 상태 필드 · 이벤트 payload는 유지), 사유를 `docs/NOTES-P#.md`에 세 줄 이내로 남긴다.
> 수치의 근거: 설계 단계에서 §7의 표 그대로 드랍 · 골드 · 경험치 · 처치 시간 · 불운 보정을 Node 스크립트로 계산했다(§7.14 — 결과와 식). 🔒 표시 값은 그 산수에 묶인 값이다 — 소유 패키지라도 혼자 바꾸지 않고, 바꿔야 하면 NOTES에 근거를 적고 통합 · 밸런스 게이트가 정한다. 그 밖의 값은 소유 패키지가 조정할 수 있다.

## 목차

- §0 공통 규약 (단위 · 틱 · 좌표 · 각도 · 벡터 · 이름 · 코드 스타일 · 결과 값)
- §1 디렉터리 트리 · 파일 소유 · 웨이브
- §2 의존 규칙
- §3 타입 카탈로그
- §4 이벤트 카탈로그
- §5 틱 순서 · 조작 · 전투 규칙 · 시간 처리 · 렌더 보간
- §6 모듈별 공개 API (+ 스텁 값)
- §7 데이터 표와 수치 (+ 측정 목표 산수)
- §8 콘텐츠 프레임워크 (몬스터 · 정예 속성 · 수호자 · 스킬 · 아이템 · 전설 · 타일셋)
- §9 view 계약 (렌더러 · 카메라 · 월드 · 캐릭터/몬스터 · 연출 · 판정 대조표)
- §10 ui 계약
- §11 app 계약 (부트 · 화면 · 루프 · 입력 · 저장 · 쿼리 · 디버그 API · 고정 상태 · 최소 부트 · 부팅 표식)
- §12 봇과 테스트 계획
- §13 패키지별 완료 정의
- 부록 A 식별자 목록 · 부록 B 문자열 키

---

## §0 공통 규약

### 0.1 단위

| 항목 | 규약 |
|---|---|
| 시간 | **초(s)**. 데이터 표 · 이벤트 payload · 문서의 모든 시간은 초다. |
| 고정 틱 | `TICK_HZ = 30` · `DT = 1/30`초. `GameSim.step(input)`은 항상 한 틱을 민다. |
| 상태 안의 시각 | **틱 정수**(결정성 — 부동소수 누적 오차로 판정 틱이 밀리지 않게). 이름 끝이 `At` · `Until`이면 절대 틱(`state.tick` 기준 — 예: `readyAt`, `stunUntil` · 행동의 `actStart` · `actHit` · `actEnd`와 `start` · `end` · `born` · `until` · `at`도 절대 틱), `T`이면 틱 수. 균열 하위의 절대 틱은 마을에 다녀오면 `shiftTicks`가 민다(§5.11) — 새 시각 필드는 이 이름 규칙을 따른다. 데이터의 초를 상태로 옮길 때는 반드시 `core/time.js`의 `ticks(sec) = Math.max(0, Math.round(sec × 30))`. 상태에서 초가 필요하면 `secOf(t) = t / 30`. |
| 길이 | 미터(m). 맵 타일 `TILE = 2m`, 내비 칸 `NAV_CELL = 0.5m`. |
| 속도 | m/s · 각속도 rad/s. |
| 각도 | **라디안**. 데이터 표의 원뿔 각도만 이름 끝 `Deg`(도) — 쓰는 쪽이 `deg2rad`. |
| 비율 · 확률 | 0..1 실수. 단, **아이템 옵션 값 · 패시브 노드 `stats` · 세트 효과와 시트 표시는 퍼센트 숫자**(예: `critChance` 옵션 `3.5` = 3.5%) — `computeStats`가 0..1로 바꿔 `PlayerStats`에 넣는다(§5.6). `PlayerStats` · 전투 식 · 상태 · 스킬의 `status` · `params` · 변형/전설 `patch`는 전부 0..1(§7.2). |
| 피해 · 생명 | 실수(반올림하지 않는다). 화면 표시만 `Math.round`. 생명 · 자원은 `[0, max]`로 자른다. |
| 골드 · 재료 · 가격 · 경험치 | **정수**. 계산 끝에서 `Math.round`. 차감은 먼저 충분한지 검사하고(부족하면 `{ok:false, reason:'gold'}`), 결과는 절대 음수가 되지 않는다. |
| 레벨 | 캐릭터 레벨 `1..30`(캡) · 균열 레벨 `1..`(표는 30까지 · 그 위는 같은 식) · 몬스터 레벨 = 균열 레벨 · 아이템 레벨(`ilvl`) = 그 드랍을 낸 몬스터 레벨. |

### 0.2 좌표와 각도 (가장 중요 — 모든 패키지가 같은 식을 쓴다)

- three.js 기본 그대로 **오른손 좌표계 · Y-up**. 게임 판은 **XZ 평면**, 바닥은 `y = 0`. sim은 높이를 모른다(도약 궤적 · 투사체 높이 · 쓰러짐 · 날아감은 view의 연출 — sim은 시작 · 끝 틱과 수평 위치만 준다).
- 맵 원점: 타일 `(i, j)`는 `x ∈ [2i, 2i+2)`, `z ∈ [2j, 2j+2)`. 내비 칸 `(u, v)`는 `x ∈ [0.5u, 0.5u+0.5)`. **모든 좌표는 0 이상**이다. 인덱스는 `j × w + i`(행 우선, z가 행).
- **yaw(수평 방향) θ의 앞 벡터 = `(x, z) = (sin θ, cos θ)`**. θ = 0 → **+Z**, θ = +π/2 → **+X**. 위(+Y)에서 내려다보면 θ가 커질수록 **반시계**로 돈다 — three.js의 `object.rotation.y = θ`와 같다.
  - 두 점 사이 yaw: `yawOf(dx, dz) = Math.atan2(dx, dz)` (`core/math.js`).
  - 몸의 오른쪽 벡터 = `(−cos θ, sin θ)`(= 앞 × 위. θ = 0이면 앞 +Z · 오른쪽 −X). `core/math.js`의 `rightX(θ)` · `rightZ(θ)`. sim에서 「옆」이 필요한 곳(돌진의 밀침 방향 · 원뿔의 좌우)은 이 식만 쓴다.
- **모든 모델은 +Z가 앞**(얼굴 · 무기 끝 · 짐승 머리)으로 만든다. 배치는 `object.rotation.y = facing` 그대로.
- **카메라**(view 전용 — sim은 카메라를 모른다): 방위 `CAM_AZIMUTH = π/4` 고정 · 앙각 `CAM_ELEVATION = 55°`. 카메라 위치 = 대상 + `d × (sin(az)·cos(el), sin(el), cos(az)·cos(el))` — 카메라는 대상의 **+X+Z 쪽 위**에 있고 −X−Z를 내려다본다. 화면 위쪽 = 월드 `(−1, 0, −1)/√2`(yaw −3π/4), 화면 오른쪽 = 월드 `(1, 0, −1)/√2`(yaw 3π/4).
- 커서는 app이 카메라 광선을 `y = 0` 평면과 만나게 해 **월드 점**으로 sim에 넘긴다(`InputFrame.cursor`). sim · bot은 화면 좌표를 모른다.

### 0.3 벡터

- sim의 2D 벡터는 **`{x, z}` 순수 객체**(`Vec2`) 하나로 통일한다. 배열 · three `Vector2/3`를 sim 상태에 넣지 않는다.
- 위치 필드는 `pos`, 직전 틱 값은 `prevPos`(렌더 보간용 — §5.12). 속도는 `vel`(m/s).
- 모양(판정 영역)은 §3.6의 `Shape` 하나로 통일한다(원 · 원뿔 · 선 · 고리 · 꺾은선).

### 0.4 이름 규칙

| 대상 | 규칙 | 예 |
|---|---|---|
| 파일 | 클래스 파일 `PascalCase.js`, 나머지 `camelCase.js`. import 경로는 디스크와 **대소문자까지** 같게 | `GameSim.js` · `rollDrops.js` |
| 콘텐츠 ID | camelCase 영어 | `ghoul` · `fireEnchanted` · `groundStomp` · `emberMaelstrom` |
| 클래스 ID | `'warrior'` · `'mage'` | |
| 장착 칸(`EquipSlot`) | `mainHand offhand helm chest gloves boots belt amulet ring1 ring2` | |
| 아이템 부위(`ItemSlot`) | `mainHand offhand helm chest gloves boots belt amulet ring` (반지는 한 부위 · 칸이 둘) | |
| 등급(`Rarity`) | `normal magic rare legendary set` | |
| 몬스터 등급(`MonRank`) | `normal champion elite minion guardian split spawn` | |
| 피해 종류(`DmgType`) | `phys fire cold lightning` | |
| 상호작용 물체 ID | 마을: `blacksmith general gambler mystic stash riftStone townPortal` · 균열: `portal:<n>`(n = 엔티티 ID) | |
| 엔티티 ID | 몬스터 · 투사체 · 효과 · 드랍: `state.nextId`에서 받는 **정수**(한 세션 안에서 유일) | |
| 아이템 ID | `'i' + account.nextItemId`(문자열 · 계정 전체에서 유일 · 저장된다) | `'i1042'` |
| 이벤트 이름 | `EV.UPPER_SNAKE` 상수 → 값 `'domain/verb'` | `EV.MON_DIED = 'mon/died'` |
| 문자열 키 | 점 경로 | `mon.ghoul` · `hud.potion` · `reason.gold` |
| 데이터 상수 | UPPER_SNAKE | `MONSTERS` · `ITEM_AFFIXES` · `RIFT` |
| 패널 ID | camelCase | `inventory` · `riftStone` · `analytics` |

### 0.5 코드 스타일

- ES 모듈, **named export만**(default export 금지).
- sim 상태는 **순수 객체**(클래스 인스턴스 · Map · Set · 함수 참조 · 타입 배열 금지 — `structuredClone` · `JSON.stringify` 가능해야 한다). 난수 상태도 상태 안의 `{s}` 숫자다(§6.1 `core/rng.js`).
- **맵(`MapData`)은 상태가 아니다**: 시드 · 레벨에서 결정적으로 다시 만들 수 있는 파생 데이터라 `ctx.map`에 둔다(타입 배열 허용). 상태에는 `rift.seed` · `rift.level` · `rift.mapId`만 있다. 맵 위에서 바뀌는 것(탐색한 타일)은 상태(`rift.explored`)에 둔다.
- **sim · bot의 수치는 `src/data/`에만 둔다.** 로직 파일의 숫자 리터럴은 0 · 1 · 2 · 0.5 · π · 배열 인덱스 같은 수학 상수뿐이다. view · ui · audio의 연출 상수(색 · 입자 수 · 이징 길이 · 주파수)는 그 파일 상단 `const`에 모은다.
- **콘텐츠 ID로 분기하는 로직 금지**(브리프 §8.5): `if (mon.typeId === 'ghoul')` · `if (affixId === 'mortar')` 같은 코드는 프레임워크에 없다. 차이는 데이터 필드와 훅 ID(`behavior` · `hook`)로만 낸다. 훅 구현 파일(§8) 안에서 자기 ID를 아는 것은 된다.
- 모듈 최상위(import 시점)에서 `window` · `document` · `AudioContext` · `localStorage`를 건드리지 않는다 — 생성자 · 함수 안에서만(Node 테스트가 import한다).
- 타입은 `src/types.js`의 JSDoc을 `/** @typedef {import('../types.js').MonsterState} MonsterState */`로 끌어 쓴다(상대 경로는 파일 위치에 맞춘다).
- **과설계 금지**: ECS · DI 컨테이너 · 상태 관리 라이브러리 · 범용 FSM 프레임워크를 만들지 않는다. `switch (act)` + 데이터 표 + 훅 함수 표(평범한 객체).

### 0.6 명령의 결과 값

- 상태를 바꾸는 명령(ui · 봇이 부르는 것)은 `{ok: true, …}` 또는 `{ok: false, reason: ReasonCode, params?: Record<string, number|string>}`를 돌려준다. `reason`은 부록 B의 `reason.*` 키 꼬리다. ui는 `t('reason.' + reason, params)` 하나로 보인다. **조용한 실패 금지** — 입력으로 시도한 행동이 안 되면 결과 · 이벤트(`SKILL_FAIL` · `PICKUP_FAIL` …) 중 하나가 반드시 있다.
- `ReasonCode` 전체 목록은 부록 A.

---

## §1 디렉터리 트리 · 파일 소유 · 웨이브

### 1.1 규칙

1. **한 파일 = 한 소유 패키지.** 웨이브 0(P0)이 **모든 파일을 먼저 만든다**(스텁 · 시드 · 완성). 그 뒤로는 표의 소유 패키지만 그 파일을 고친다.
2. **스텁**은 이 문서의 시그니처 그대로 export 하고 **import할 때도 호출할 때도 던지지 않는다** — §6.18의 중립 값을 돌려준다. 스텁 상태에서 `npm run build` · `npm test` · `npm run check:dist`가 통과한다.
3. 패키지는 **자기 소유 폴더 안에** 내부 파일을 더 만들 수 있다(다른 패키지가 import하지 않는 파일). 폴더 소유는 트리 아래.
4. **「시드」** 데이터 파일은 P0이 이 문서의 값으로 **완성해서** 만든다(다른 패키지가 웨이브 1에서 읽는다). 이후 값 조정은 소유 패키지만, 🔒 규칙 안에서.
5. **「완성」** 파일(`core/` 전부 · `types.js` · `data/index.js` · `sim/state.js` · `sim/entities.js` · `sim/world/nav.js` · 레지스트리 `index.js` 셋 · `bootMarker.js` · `debug/*` · `test/helpers.js` · P0 테스트)은 P0이 웨이브 0에서 끝낸다. 웨이브 1부터는 아무도 고치지 않는다(결함은 `NOTES-P#`에 적고 통합 게이트에서 고친다).
6. **W1의 화면 패키지(P7 · P8)는 W0의 최소 부트로 자기 화면을 본다**: 최소 부트(§11.10)가 모든 레이어를 계약 deps 그대로 만들어 돌리고, `?fixture=<id>`(§11.9 · `debug/fixtures.js`)가 떼 · 정예 · 수호자 · 전리품 같은 상태를 sim 없이 세운다.
7. **웨이브 2의 콘텐츠 패키지(P16)는 프레임워크 파일을 고치지 않는다**: 속성 훅 6개와 수호자 하나를 P0이 만든 자리(`affixHooks/<id>.js` · `guardians/ashWitch.js`)에 채운다(§8).

### 1.2 웨이브

| 웨이브 | 패키지 | 진행 | 게이트 |
|---|---|---|---|
| W0 | P0 scaffold | 한 명 | `npm run build` · `npm test` · `npm run check:dist` |
| W1 | P1 sim-player · P2 sim-session · P3 sim-monsters · P4 sim-world · P5 loot · P6 progression · P7 view-world · P8 view-actors | 8명 병렬 — 서로의 작업 중 파일을 보지 않는다. sim 패키지는 P0 스텁 위에서 자기 단위 테스트를, 화면 패키지는 최소 부트 + `?fixture`로 자기 화면을 본다 | 자기 테스트 통과 + 자기 파일이 원인인 빌드 오류 0 → 통합 게이트(전체 — 실제 구현끼리 균열 1을 스크립트 입력으로 끝까지) |
| W2 | P9 app · P10 ui-core · P11 ui-panels · P12 analytics · P13 fx · P14 audio · P15 bot · P16 content | 8명 병렬 — W1 완성본 위에서. P15의 봇 테스트는 W1 sim과 P0 이벤트만 쓴다(P9를 기다리지 않는다) | 자기 테스트 → 통합 게이트 → 밸런스 게이트(§12.7) → 화면 패스 |

### 1.3 트리와 소유

```
rift-hunter/
├─ package.json                         P0   (템플릿 · name "rift-hunter" · 의존성 vite(dev) · three · 스크립트에 "measure": "node scripts/measure.mjs")
├─ vite.config.js                       P0   (port 5400)
├─ index.html                           P0   (#game-canvas · #ui-root · <link rel="icon" href="data:,"> · <noscript> · CSS 셋 링크 — §10.1)
├─ .gitignore                           P0
├─ README.md                            P9   (W0: P0 임시본)
├─ scripts/                             P0   (템플릿 다섯 파일 — 고치지 않는다)
│  ├─ check-dist.mjs · boot-probe.mjs · screen-probe.mjs · make-standalone.mjs · check-standalone.mjs
│  └─ measure.mjs                       P15  (npm run measure → docs/MEASURE.md. W0: P0 스텁 — 「아직 없다」 한 줄을 쓰고 끝)
├─ docs/
│  ├─ BRIEF.md · CONTRACT.md            (고정)
│  ├─ MEASURE.md                        P15  (measure.mjs의 출력 — W0: P0이 「아직 측정 없음」 한 줄로 만든다)
│  └─ NOTES-P#.md                       각 패키지(선택)
├─ src/
│  ├─ main.js                           P9   (W0: P0의 「최소 부트」 — §11.10. W2에서 P9가 Game으로 교체)
│  ├─ types.js                          P0   완성 — §3의 typedef 전부(`export {}`)
│  ├─ core/                                  전부 P0 완성
│  │  ├─ constants.js · events.js · rng.js · math.js · time.js · hash.js · inputFrame.js · spatialHash.js · shapes.js
│  ├─ data/
│  │  ├─ index.js                       P0   완성 — 조회 표 · getX(id) · 참조 검사용 목록(§6.2)
│  │  ├─ classes.js                     P1   (시드) CLASSES
│  │  ├─ skills.js                      P1   (시드) SKILL_NODES · BASIC_SKILLS · TREE
│  │  ├─ combat.js                      P2   (시드) COMBAT · STATUS · PICKUP · DEATH · GAUGE · METER
│  │  ├─ rift.js                        P2   (시드) RIFT · riftRow(L) · RIFT_LEVELS
│  │  ├─ monsters.js                    P3   (시드) MONSTERS · RANKS · MON
│  │  ├─ monsterAffixes.js              P3   (시드) MON_AFFIXES · AFFIX_COUNT · AFFIX_RULES
│  │  ├─ packs.js                       P3   (시드) PACKS · TILESET_PACKS · ELITE_PACK
│  │  ├─ guardians.js                   P3   (시드) GUARDIANS
│  │  ├─ mapgen.js                      P4   (시드) MAPGEN
│  │  ├─ tilesets.js                    P4   (시드) TILESETS
│  │  ├─ town.js                        P4   (시드) TOWN
│  │  ├─ items.js                       P5   (시드) BASES · SLOT_WEIGHTS · BASE_TIERS · FIST · ITEM
│  │  ├─ itemAffixes.js                 P5   (시드) ITEM_AFFIXES · AFFIX_TIERS
│  │  ├─ drops.js                       P5   (시드) TREASURE · RARITY · BLP · MF · GUARANTEE · MATERIAL_DROP
│  │  ├─ legendaries.js                 P5   (시드) LEGENDARIES · SETS
│  │  ├─ economy.js                     P6   (시드) ECON · XP · PRICES · SALVAGE · CRAFT · REROLL · GAMBLE · SHOP · START
│  │  ├─ quality.js                     P7   (시드) QUALITY
│  │  ├─ settings.js                    P9   (시드) DEFAULT_SETTINGS · SETTINGS_SCHEMA
│  │  ├─ keybinds.js                    P9   (시드) KEYBINDS · PANEL_KEYS
│  │  ├─ strings.ko.js                  P10  (시드 — 부록 B의 키 전부) STRINGS
│  │  ├─ bot.js                         P15  (시드) BOT
│  │  └─ presets.js                     P15  (시드) PRESETS
│  ├─ sim/
│  │  ├─ GameSim.js                     P2   틱 순서의 주인 · 명령 · 플러시 · 장면 전환
│  │  ├─ ctx.js                         P2   SimCtx 만들기 · refreshStats
│  │  ├─ state.js                       P0   완성 — 상태 모양을 만드는 순수 함수(§6.3)
│  │  ├─ entities.js                    P0   완성 — 엔티티 추가/찾기/제거 · 모양 질의(§6.4)
│  │  ├─ combat.js                      P2   피해 식 · 적중 적용(양방향) · 회복
│  │  ├─ status.js                      P2   상태 이상(몬스터 · 플레이어)의 적용과 틱 · 버프
│  │  ├─ conds.js                       P2   조건부 패시브 판정(CONDS)
│  │  ├─ projectiles.js                 P2
│  │  ├─ effects.js                     P2   예고 · 바닥 효과 · 위협 간격 규칙
│  │  ├─ drops.js                       P2   바닥 드랍 생성 · 흩뿌림 · 줍기 · 자동 줍기
│  │  ├─ rift.js                        P2   균열 열기/닫기 · 게이지 · 수호자 출현 · 완료 · 붕괴 · 사망/부활 · 포털 · 탐색
│  │  ├─ town.js                        P2   마을 장면 · 상호작용 · 복귀 안내
│  │  ├─ meter.js                       P2   계측(DPS · 받은 피해 · 분당 처치 · 떼 순간)
│  │  ├─ pick.js                        P2   광선 → 마우스 아래 대상(Hover)
│  │  ├─ player/
│  │  │  ├─ controller.js               P1   클릭 해석 · 선입력 버퍼 · 경로 따라가기 · 이동 · 상호작용 도착
│  │  │  ├─ actions.js                  P1   행동 단계(예비 → 판정 → 후딜) · 자원 · 쿨다운 · 포션 · 귀환 시전
│  │  │  ├─ skills.js                   P1   스킬 동작 표(SKILL_BEHAVIORS) — 기본 공격 2 + 액티브 12 + 변형 6
│  │  │  └─ equipHooks.js               P1   전설 효과 훅(EQUIP_HOOKS) 12
│  │  ├─ monsters/
│  │  │  ├─ monsters.js                 P3   깨우기/잠재우기 · 이동(흐름장 · 밀어내기) · 공격 진행 · 훅 호출(ctx.hooks 구현) · 상한 — spawn.js의 넷을 다시 내보낸다
│  │  │  ├─ spawn.js                    P3   spawnMonster · monsterStats · startAttack · findGuardianSpot(레지스트리를 import하지 않는다 — §2.2)
│  │  │  ├─ behaviors.js                P3   종류별 행동(BEHAVIORS) 9
│  │  │  ├─ packs.js                    P3   팩 구성 · 배치 · 정예 이름 · 하수인 공유 · 균열 채우기
│  │  │  ├─ affixHooks/
│  │  │  │  ├─ index.js                 P0   완성 — AFFIX_HOOKS = {id: import}
│  │  │  │  ├─ fast.js · tough.js · fireEnchanted.js · coldEnchanted.js · vampiric.js · shielding.js        P3
│  │  │  │  └─ lightningEnchanted.js · teleporter.js · jailer.js · splitter.js · plague.js · mortar.js      P16
│  │  │  └─ guardians/
│  │  │     ├─ index.js                 P0   완성 — GUARDIAN_IMPLS = {id: import}
│  │  │     ├─ boneGiant.js             P3
│  │  │     └─ ashWitch.js              P16
│  │  ├─ world/
│  │  │  ├─ nav.js                      P0   완성 — 격자 질의 · 원 이동(미끄러짐) · 시야 광선 · 가장 가까운 걸을 수 있는 점(§6.5)
│  │  │  ├─ mapgen.js                   P4   균열 생성(방 · 통로 · 타일 · 소품 · 빛 · 팩 자리)
│  │  │  ├─ townMap.js                  P4   마을 MapData
│  │  │  ├─ path.js                     P4   A* + 줄 당기기
│  │  │  └─ flow.js                     P4   흐름장(플레이어 중심 BFS)
│  │  ├─ loot/
│  │  │  ├─ rollDrops.js                P5   드랍 묶음 → 드랍 목록(rollDrops)
│  │  │  ├─ rollItem.js                 P5   아이템 생성(rollItem) · 옵션 굴림 · 이름 · 가치
│  │  │  ├─ theory.js                   P5   이론 확률
│  │  │  ├─ simulate.js                 P5   드랍 시뮬레이터 집계기(분석 패널 · 측정 · 테스트 공용)
│  │  │  ├─ stats.js                    P5   computeStats · 시트 DPS · EHP · powerScore
│  │  │  └─ compare.js                  P5   장착 비교 · 업그레이드 판정
│  │  └─ progression/
│  │     ├─ character.js                P6   계정 · 캐릭터 생성 · 시작 장비
│  │     ├─ inventory.js                P6   가방 · 장착 · 보관함 · 정렬 · 내구도 · 사망 대가
│  │     ├─ shops.js                    P6   상점 4 · 보관함 이용 · 재고 · 거래 전부
│  │     ├─ progress.js                 P6   경험치 · 레벨 · 스킬 트리 · 스킬 바 · 해금 · 기록
│  │     ├─ save.js                     P6   직렬화 · 검증 · 이주 · 정화
│  │     └─ dev.js                      P6   개발용 캐릭터(?level · ?rift)
│  ├─ bot/                              P15  (폴더 P15)
│  │  ├─ bot.js · combat.js · town.js · loot.js · build.js · measure.js
│  ├─ debug/                            P0   (폴더 P0 — 완성)
│  │  ├─ fixtures.js                    고정 상태 15개(§11.9)
│  │  └─ fixtureMap.js                  ASCII → MapData(고정 상태 · 스텁 맵용)
│  ├─ view/
│  │  ├─ renderer.js                    P7
│  │  ├─ CameraRig.js                   P7
│  │  ├─ WorldLayer.js                  P7   던전 · 마을 · 소품 · 빛 · 벽 낮추기 · 포털 틀
│  │  ├─ world/                         P7   (내부 파일 폴더)
│  │  ├─ ActorLayer.js                  P8   플레이어 · 몬스터(인스턴싱) · NPC · 바닥 아이템 · 시체 · 가림 외곽선
│  │  ├─ actors/                        P8   (내부 파일 폴더 — templates · rig · poses · items …)
│  │  ├─ FxLayer.js                     P13  예고 · 바닥 효과 · 투사체 · 입자 · 오라 · 상태 표시
│  │  └─ fx/                            P13  (내부 파일 폴더)
│  ├─ audio/                            P14  (폴더 P14)
│  │  └─ AudioEngine.js
│  ├─ ui/
│  │  ├─ UIRoot.js · hud.js · labels.js · minimap.js · widgets.js · i18n.js · format.js · hud.css        P10
│  │  ├─ tooltip.js · itemText.js · pnlBagGrid.js · panels.css                                                             P11
│  │  ├─ panels/
│  │  │  ├─ index.js                    P0   완성 — PANELS = {id: createXPanel}
│  │  │  ├─ title.js · charSelect.js · newChar.js · pause.js · settings.js · help.js · death.js · riftComplete.js · confirm.js · hint.js · map.js   P10
│  │  │  └─ inventory.js · skills.js · character.js · blacksmith.js · general.js · gambler.js · mystic.js · stash.js · riftStone.js            P11
│  │  └─ analytics/                     P12  (폴더 P12)
│  │     ├─ AnalyticsPanel.js · dropSimTab.js · tablesTab.js · sessionTab.js · botTab.js · meterHud.js · exporters.js · analytics.css
│  └─ app/
│     ├─ bootMarker.js                  P0   완성 — markReady · markError (진입점을 다시 써도 남는다)
│     └─ Game.js · loop.js · screens.js · input.js · storage.js · query.js · debugApi.js      P9
└─ test/
   ├─ helpers.js                        P0   완성 — §6.17
   ├─ core.test.js                      P0   완성
   ├─ nav.test.js                       P0   완성 — nav.js
   ├─ purity.test.js                    P0   완성 — 순수 계층 금지 토큰 · import 대소문자 · 부팅 표식 사용 · 콘텐츠 ID 분기 검사(§12.3)
   ├─ data.schema.test.js               P0   완성 — 모든 데이터 행의 스키마 · 참조 · 완결성(§12.2)
   ├─ fixtures.test.js                  P0   완성 — 고정 상태 전부가 §3 모양 · 유한수 · 맵과 맞는다
   ├─ player.test.js · skills.test.js · equipHooks.test.js                          P1
   ├─ combat.test.js · effects.test.js · drops.test.js · rift.test.js · gameSim.test.js    P2
   ├─ balance.test.js                   W1 수정 — 첫 판 클리어 · 부활 뒤 같은 떼 · 첫 판 완화가 균열 5 이상으로 새지 않음 회귀(NOTES-W1FIX)
   ├─ monsters.test.js · behaviors.test.js · affixes.test.js · packs.test.js · guardians.test.js   P3
   ├─ mapgen.test.js · path.test.js · flow.test.js                                 P4
   ├─ rollItem.test.js · rollDrops.test.js · theory.test.js · stats.test.js        P5
   ├─ inventory.test.js · shops.test.js · progress.test.js · save.test.js          P6
   ├─ view.world.test.js                P7   (Node · three 지오메트리만 — 렌더러 없음)
   ├─ view.actors.test.js               P8   (Node · 포즈 순수 함수 · 템플릿 지오메트리 · 인스턴스 수)
   ├─ app.query.test.js · app.input.test.js · app.storage.test.js · app.loop.test.js   P9
   ├─ ui.format.test.js · ui.strings.test.js                                        P10
   ├─ ui.panels.test.js                 P11  (itemText · 비교 줄 — 순수 함수)
   ├─ analytics.test.js                 P12  (내보내기 · 히스토그램 · 조각 실행기 — 가짜 스케줄러)
   ├─ view.fx.test.js                   P13  (예고 지오메트리 치수 = 효과 모양)
   ├─ audio.test.js                     P14  (가짜 WebAudio)
   ├─ bot.test.js · headless.test.js · measure.test.js · perf.test.js               P15
   ├─ content.test.js                   P16  (속성 6 · 잿빛 마녀)
   ├─ feedback2.test.js · ui.feedback2.test.js · fixtures/botGear.json   피드백 2 — §12.2 끝(봇 장비 고정 자료 — balance.test 의 회전 베기 정타 기준)
   └─ (피드백 1 · 다른 라운드의 *.test.js — §12.2)
```

`src/ui/pnlBagGrid.js`(P11)는 가방 격자 조각이다 — 인벤토리 · 대장장이 · 잡화상 · 보관함 · 신비술사 패널이 같이 쓴다(§10.5-8).

폴더 소유: `src/view/world/` P7 · `src/view/actors/` P8 · `src/view/fx/` P13 · `src/audio/` P14 · `src/bot/` P15 · `src/ui/analytics/` P12 · `src/debug/` P0. `src/app/`는 `bootMarker.js`(P0)를 뺀 전부 P9. `src/ui/`의 소유는 파일 단위(위 표) — P10 · P11이 내부 파일을 더 만들 때는 이름 앞에 `hud`(P10) · `pnl`(P11)을 붙인다(`src/ui/hudOrbs.js` · `src/ui/pnlGrid.js`). 테스트 파일을 더 만들 때는 자기 패키지의 테스트 파일 이름 앞부분을 붙인다(`affixes.extra.test.js` → P3).

### 1.4 패키지 한눈에

| ID | 이름 | 웨이브 | 화면 | 한 줄 |
|---|---|---|---|---|
| P0 | scaffold | 0 | — | 설정 · core · 타입 · 상태 모양 · 엔티티 질의 · 내비 격자 · 스텁 · 시드 데이터 · 레지스트리 · 고정 상태 15 · 테스트 하네스 · 모든 레이어를 띄우는 최소 부트 |
| P1 | sim-player | 1 | — | 디아블로식 클릭 해석 · 선입력 · 경로 따라가기 · 행동 단계 · 자원(분노 · 마나) · 쿨다운 · 포션 · 귀환 시전 · 스킬 동작 20(기본 2 · 액티브 12 · 변형 6) · 전설 훅 12 · 클래스/스킬 데이터 |
| P2 | sim-session | 1 | — | GameSim(틱 순서 · 명령 · 플러시 · 장면 전환) · 피해 식 · 상태 이상 · 투사체 · 예고/바닥 효과 · 위협 간격 · 드랍 흩뿌림/줍기 · 균열 세션(게이지 · 수호자 · 완료 · 붕괴 · 생명 · 포털) · 마을 · 계측 · 마우스 대상 판별 |
| P3 | sim-monsters | 1 | — | 몬스터 프레임워크(생성 · 등급 보정 · 잠/깨움 · 흐름장 이동 · 밀어내기 · 공격 단계 · 상한 120) · 일반 8종 + 새끼 2 · 팩/챔피언/정예 구성과 이름 · 속성 프레임워크 + 속성 6 · 수호자 프레임워크 + 뼈 거인 |
| P4 | sim-world | 1 | — | 시드 맵 생성(방 10~14 · 통로 4~6m · 타일셋 2 · 소품 · 빛 · 팩 자리) · 마을 맵 · A* 경로 · 흐름장 |
| P5 | loot | 1 | — | 기본형 · 옵션 32 · 등급 · 드랍 묶음 · 불운 보정 · 아이템 발견 수확 체감 · rollDrops/rollItem · 이론 확률 · 시뮬레이터 집계 · 캐릭터 시트(computeStats) · 비교 · 업그레이드 판정 · 전설 12 · 세트 2 |
| P6 | progression | 1 | — | 계정 · 캐릭터 · 가방 30(피드백 2 — 옛 40) · 장착 10 · 보관함 60 · 내구도 · 대장장이/잡화상/도박꾼/신비술사 · 경험치/레벨 30 · 스킬 트리 규칙 · 균열 해금/기록 · 세션 기록 · 세이브 · 개발용 캐릭터 |
| P7 | view-world | 1 | ● | 렌더러 · 화질 3단계 · 쿼터뷰 카메라(따라가기 · 줌 · 흔들림) · 던전(지하 묘지 · 잿빛 동굴) · 마을 · 소품 · 빛 상한 · 가리는 벽 낮추기 · 포털/균열석/보관함 |
| P8 | view-actors | 1 | ● | 전사 · 마법사 리그와 장비 외형 · 몬스터 템플릿 5(인간형 · 소형 · 네발 · 덩어리 · 둥지) 인스턴싱 · 포즈 애니메이션(발 고정) · 등급 발광 · 시체/날아감 · NPC · 바닥 아이템 · 등급 빛기둥 · 가림 외곽선 |
| P9 | app | 2 | ● | 부트 · 루프 · 화면 상태 기계 · 입력(event.code · 커서 광선) · 전환 막 · 저장 · 쿼리 · 디버그 API · README |
| P10 | ui-core | 2 | ● | UIRoot · HUD(구슬 · 스킬 바 · 대상 프레임 · 게이지 · 생명 · 수호자 바 · 경험치) · 이름표 · 피해 숫자 · 미니맵/큰 지도 · 타이틀/캐릭터 · 일시정지/설정/도움말 · 사망 · 균열 완료 · 확인 · 안내 카드 · 문자열 |
| P11 | ui-panels | 2 | ● | 인벤토리+장비 · 툴팁(전/후 비교 · 고급) · 스킬 트리 · 캐릭터 시트 · 대장장이 · 잡화상 · 도박꾼 · 신비술사 · 보관함 · 균열석 |
| P12 | analytics | 2 | ● | 분석 패널(드랍 시뮬레이터 · 표 보기 · 세션 기록 · 봇) · 계측 HUD · JSON/CSV 내려받기 |
| P13 | fx | 2 | ● | 예고 표식 · 바닥 효과 · 투사체 · 타격 불꽃 · 속성 오라 · 상태 표시(화상 · 빙결 · 감전 · 기절) · 스킬 연출 · 포털 소용돌이 |
| P14 | audio | 2 | — | WebAudio 합성 소리 전부 · 리미터 · 동시 발음 상한 · 환경음 |
| P15 | bot | 2 | — | 봇(사람처럼 InputFrame) · 마을 정비 · 레벨 선택 · 프리셋 빌드 4 · 헤드리스 완주 · 측정 목표 · 성능 · `npm run measure` |
| P16 | content | 2 | ● | 속성 6(번개 강화 · 순간이동 · 감옥 · 분열 · 역병 · 몰타르) · 수호자 「잿빛 마녀」 — 프레임워크를 고치지 않고 |

---

## §2 의존 규칙

### 2.1 import 허용 표 (행 → 열을 import 해도 되는가)

| from \ to | core | data | sim | bot | debug | three | view | audio | ui | app |
|---|---|---|---|---|---|---|---|---|---|---|
| **core** | ○ | ✕ | ✕ | ✕ | ✕ | ✕ | ✕ | ✕ | ✕ | ✕ |
| **data** | ○ | ○ | ✕ | ✕ | ✕ | ✕ | ✕ | ✕ | ✕ | ✕ |
| **sim** | ○ | ○ | ○ | ✕ | ✕ | ✕ | ✕ | ✕ | ✕ | ✕ |
| **bot** | ○ | ○ | ○ (§6.16의 읽기 · 순수 함수만) | ○ | ✕ | ✕ | ✕ | ✕ | ✕ | ✕ |
| **debug** | ○ | ○ | W0에 완성인 것만: `sim/state.js` · `sim/entities.js` · `sim/world/nav.js` · `sim/loot/rollItem.js`(`makeItem`) · `sim/loot/stats.js` · `sim/monsters/spawn.js`(`monsterStats`) · `sim/progression/character.js`(`createCharacter`) | ✕ | ○ | ✕ | ✕ | ✕ | ✕ | ✕ |
| **view** | ○ | ○ | 순수 조회만(`sim/world/nav.js` · `sim/loot/stats.js`의 `weaponVisual`) | ✕ | ✕ | ○ | ○ | ✕ | ✕ | ✕ |
| **audio** | ○ | ○ | ✕ | ✕ | ✕ | ✕ | ✕ | ○ | ✕ | ✕ |
| **ui** | ○ | ○ | 순수 조회 · 계산만(`sim/loot/*` · `sim/progression/progress.js`의 `previewLearn` 등 §6.13 표) | ✕ | ✕ | ✕ | ✕ | ✕ | ○ | ✕ |
| **app** | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ |

- **순수 계층**(`core` · `data` · `sim` · `bot` · `debug`)은 `three` · DOM(`window` · `document`) · WebAudio · `localStorage` · 시계(`Date.now` · `performance.now` · `setTimeout` · `setInterval` · `requestAnimationFrame`) · `Math.random`을 쓰지 않는다. Node에서 그대로 돈다. `test/purity.test.js`가 소스를 훑어 막는다(문자열 리터럴 · 주석 안은 무시).
- view · audio · ui는 sim **상태를 읽기만** 하고 이벤트를 구독한다. 상태를 바꾸는 것은 `GameSim`의 명령 메서드뿐이다(ui · 봇 · app이 호출). ui가 sim 명령을 부르는 통로는 `UIRoot`가 받는 `sim` 참조와 `actions`(장면 전환처럼 app이 끼어야 하는 것 — §11.2)다.
- 시드 `seed`와 저장 시각 `savedAt`은 app이 만든다(`Date.now` · `Math.random`은 app에서만).
- `debug/*`는 app(`main.js` · `app/*`)과 `test/*`만 import한다.
- ui의 분석 패널(P12)이 조각 실행에 쓰는 `MessageChannel` · `setTimeout`은 ui 계층이라 허용이다(§10.9).

### 2.2 순환 금지 지점

- `sim/GameSim.js` → `ctx.js` · `rift.js` · `town.js` · `player/*` · `monsters/monsters.js` · `projectiles.js` · `effects.js` · `status.js` · `drops.js` · `meter.js` · `progression/*` 단방향. 아무도 `GameSim.js`를 import하지 않는다(app · bot · test만).
- `combat.js`는 `player/*` · `monsters/*` · `rift.js` · `drops.js`를 import하지 않는다. 피격 · 사망 뒤에 속성 훅 · 전설 훅이 돌아야 하는 곳과 플레이어 사망(`killPlayer` — rift.js)은 `ctx.hooks`로 부른다(아래). `status.js`는 `combat.js`를 import하지 않는다(화상 틱은 `combat.js`의 `tickBurns` — §5.1-6).
- **sim 패키지 사이의 역방향 호출(아래 → 위)은 전부 `ctx.hooks`를 거친다** — import 순환을 만들지 않기 위해서다. `ctx.hooks`는 `createCtx`(P2)가 채우는 함수 표다(§3.10이 정본): `onMonSpawn` · `onMonDamaged` · `onMonDeath` · `onMonHitPlayer`(P3 `monsters.js`) · `onPlayerKill`(P1 — 전설 처치 훅) · `onGlobe`(P1 `globeMods`) · `onPlayerDamaged`(P1) · `onPlayerKilled`(P2 — `rift.js`의 `killPlayer`). 그 밖의 모든 호출은 위 → 아래 직접 import다.
- 허용되는 직접 import 방향(위 → 아래): `player/*` → `combat` · `projectiles` · `effects` · `status` · `entities` · `world/*` · `loot/stats` · `progression/progress`(스킬 랭크 조회만) · `drops`(`pickupDrop`) · `rift`(`requestTravel` · `openRecallPortal` · `requestReturnToRift`) — `rift.js` · `drops.js`는 `player/*`를 import하지 않는다 / `monsters/*` → `combat` · `projectiles` · `effects` · `status` · `entities` · `world/*` · `monsters/spawn.js` / `drops.js` → `loot/*` · `progression/inventory` · `progression/progress` / `rift.js` → `monsters/*` · `world/*` · `drops` · `loot/*` · `progression/*` · `effects` / `effects.js` · `projectiles.js` → `combat` · `entities` · `world/nav` / `combat.js` → `status` · `conds` · `entities` / `progression/*` → `loot/*` · `entities`.
- `loot/*`는 `progression/*` · `combat` · `rift`를 import하지 않는다(순수 생성기 · 계산기).
- `monsters/affixHooks/*` · `monsters/guardians/*` → `combat` · `effects` · `projectiles` · `status` · `entities` · `world/nav` · `monsters/spawn.js`(`spawnMonster` · `startAttack` · `monsterStats` · `findGuardianSpot`) 단방향 — `monsters.js` · 레지스트리 `index.js`는 import하지 않는다(`monsters.js → index.js → <id>.js → monsters.js` 순환 · 초기화 전 `hook`을 읽는 TDZ 오류). `spawn.js`는 레지스트리를 import하지 않고, 스폰 직후 속성 `onSpawn`은 `ctx.hooks.onMonSpawn`으로 부른다. `monsters.js`는 `spawn.js`의 넷을 다시 내보낸다. 훅 파일끼리 import하지 않는다.
- `bot/*`는 `sim/GameSim.js`를 import하지 않는다(봇은 `sim` 인스턴스를 인자로 받고, 판을 새로 만드는 측정 함수는 `makeSim(seed, account) → GameSim`을 인자로 받는다 — §6.16).
- `test/purity.test.js`가 `src/sim`의 상대 import 그래프에 순환이 없는지 본다(§12.3-7).
- `data/*`끼리: `data/index.js` → 모든 데이터 파일. 다른 데이터 파일은 서로를 import하지 않는다(참조는 ID 문자열).

---

## §3 타입 카탈로그

`src/types.js`(P0 완성)에 아래 typedef를 **그대로** 옮긴다. 필드 주석의 단위 · 범위가 계약이다. **view · ui가 그려야 하는 것은 전부 상태에 있다** — view · ui가 sim 내부 규칙을 다시 계산하지 않는다(예고 진행도 · 쿨다운 남은 비율 · 가능 여부 플래그 모두 상태 필드나 §6.13의 조회 함수로 얻는다).

### 3.1 기초 ID · 열거

```js
/** @typedef {{x:number, z:number}} Vec2 */
/** @typedef {'warrior'|'mage'} ClassId */
/** @typedef {'town'|'rift'} SceneId */
/** @typedef {'mainHand'|'offhand'|'helm'|'chest'|'gloves'|'boots'|'belt'|'amulet'|'ring1'|'ring2'} EquipSlot */
/** @typedef {'mainHand'|'offhand'|'helm'|'chest'|'gloves'|'boots'|'belt'|'amulet'|'ring'} ItemSlot */
/** @typedef {'normal'|'magic'|'rare'|'legendary'|'set'} Rarity */
/** @typedef {'normal'|'champion'|'elite'|'minion'|'guardian'|'split'|'spawn'} MonRank
 *  split = 분열 속성의 사본 — RANKS.split 값 그대로(경험치 0.25 · 게이지 0.1 · tc 'split' — flags로 끄지 않는다)
 *  spawn = 둥지 새끼 · 마녀의 하수인 — RANKS.spawn(경험치 · 게이지 0 · tc null). 주술사가 되살린 소인은 rank normal + flags {noXp, noDrops, noGauge, revived}(§8.1) */
/** @typedef {'phys'|'fire'|'cold'|'lightning'} DmgType */
/** @typedef {'crypt'|'cavern'|'town'} TilesetId */
/** @typedef {'scrap'|'dust'|'essence'} MaterialId   고철 · 비전 가루 · 망각의 정수 */
/** @typedef {'str'|'int'} MainStat */
/** @typedef {'rage'|'mana'} ResourceKind */
/** @typedef {'active'|'guardian'|'complete'|'collapsed'} RiftPhase
 *  active = 게이지 모으는 중 · guardian = 게이지 100%(수호자 예고 · 전투) · complete = 수호자 처치 · collapsed = 붕괴(생명 0에서 사망) */
/** @typedef {'idle'|'move'|'attack'|'cast'|'channel'|'dash'|'leap'|'blink'|'recall'|'dead'} PlayerAct */
/** @typedef {'idle'|'move'|'windup'|'strike'|'recover'|'cast'|'channel'|'charge'|'stunned'|'frozen'|'flinch'|'swell'|'flee'|'vanish'|'spawning'|'dead'} MonAct */
/** @typedef {'humanoid'|'small'|'quadruped'|'blob'|'nest'} MonTemplate */
/** @typedef {'monster'|'drop'|'object'} HoverKind */
/** @typedef {({kind:'monster', id:number}|{kind:'drop', id:number}|{kind:'object', id:string}) & {src?:'pick'|'label'}} Hover
 *  object = 마을 물체(blacksmith · general · gambler · mystic · stash · riftStone · townPortal) · 균열 포털('portal:<n>')
 *  src = app이 고른 경로(광선 'pick' · 바닥 이름표 'label' — 봇은 'pick' · 없으면 'pick') — 대상 검사가 다르다(§5.2-1) */
/** @typedef {'npc'|'stash'|'riftStone'|'townPortal'|'riftPortal'} InteractKind */
/** @typedef {'item'|'gold'|'potion'|'globe'|'material'} DropKind */
/** @typedef {'circle'|'cone'|'line'|'ring'|'poly'} ShapeType */
/** @typedef {'low'|'medium'|'high'} QualityId */
/** @typedef {'title'|'charSelect'|'newChar'|'pause'|'settings'|'help'|'death'|'riftComplete'|'confirm'|'hint'|'map'
 *   |'inventory'|'skills'|'character'|'blacksmith'|'general'|'gambler'|'mystic'|'stash'|'riftStone'|'analytics'} PanelId */
/** @typedef {'boot'|'title'|'play'|'fatal'} ScreenId */
```

### 3.2 입력 — `InputFrame`

app의 `InputCollector`가 매 틱 하나 만든다. 봇도 같은 것을 만든다. **에지 필드(`…Down`)는 app이 다음 `step`까지 모아 둔다**(한 프레임에 여러 틱이면 첫 틱에만, 틱 없는 프레임이면 다음 틱으로 넘긴다 — 씹히지 않는다).

```js
/** @typedef {Object} InputFrame
 * @property {Vec2|null} cursor      커서 아래 바닥 점(월드 m · y=0 평면). 캔버스 밖 · 포커스 없음이면 null — null이면 누르고 있던 이동이 멈춘다(브리프 §6)
 * @property {Hover|null} hover      커서 아래 대상. sim은 그 대상이 살아 있고 cursor에서 가까운지(§5.2-1) 검사한 뒤 쓴다
 * @property {boolean} lmb           좌클릭 누르고 있음
 * @property {boolean} lmbDown       이번 틱의 누름 에지
 * @property {boolean[]} slot        길이 5 · [0] = 우클릭(스킬 바 0) · [1..4] = Digit1..4(스킬 바 1..4) 누르고 있음
 * @property {boolean[]} slotDown    길이 5 · 누름 에지
 * @property {boolean} shift         제자리 공격 · 시전(ShiftLeft/Right)
 * @property {boolean} potionDown    KeyQ 에지
 * @property {boolean} recallDown    KeyT 에지
 */
```

`core/inputFrame.js`: `NEUTRAL_INPUT`(동결 · cursor null · 전부 false) · `makeInput(partial = {})` → 새 InputFrame(배열은 새로 만든다).

### 3.3 데이터 정의 (`src/data/*` 행의 모양)

```js
/** @typedef {Object} ClassDef
 * @property {ClassId} id
 * @property {MainStat} mainStat
 * @property {ResourceKind} resource
 * @property {{base:number, growth:number}} life           생명 = base × growth^(레벨−1) × (1 + 활력 × COMBAT.vitLife + 생명%) (§5.6)
 * @property {{base:number, perLevel:number}} resourceMax  자원 최대 = base + perLevel × (레벨−1) (+ 장비 mana)
 * @property {{base:number, perLevel:number}} regen        마나/초 (분노는 0)
 * @property {null|{onBasicHit:number, perExtraTarget:number, extraCap:number, onHitTaken:number, takenCapPerSec:number, decayDelay:number, decayPerSec:number}} rage
 * @property {number} moveSpeed    m/s (6)
 * @property {number} radius       m (0.40)
 * @property {number} height       m (1.8 — view · 마우스 판별)
 * @property {string} basic        기본 공격 스킬 ID ('bash' | 'magicBolt')
 * @property {Array<{baseId:string, tier:number}>} startGear   일반 등급 · ilvl 1
 * @property {string[]} mainHandBases     낄 수 있는 주무기 기본형 ID
 * @property {string[]} offhandBases      낄 수 있는 보조 기본형 ID
 */

/** @typedef {'cleave'|'boltBasic'|'spinSlash'|'quake'|'dash'|'spin'|'buff'|'leap'|'fireball'|'meteor'|'nova'|'shield'|'chain'|'blink'} SkillBehaviorId */   // 피드백 1: meleeBasic → cleave(가르기) · cone → spinSlash(회전 베기)
/** @typedef {'aoe'|'melee'|'projectile'|'movement'|'buff'|'channel'|'dot'|'chain'} SkillTag */
/** @typedef {Object} SkillDef   (액티브 · 기본 공격의 동작 수치 — §7.2)
 * @property {SkillBehaviorId} behavior
 * @property {'target'|'direction'|'point'|'self'} targeting
 * @property {DmgType|null} type
 * @property {SkillTag[]} tags
 * @property {number} cost          자원(시전 시작에 지불)
 * @property {number} [costPerSec]  채널 유지 비용/초
 * @property {number} [gen]         시전에 얻는 자원
 * @property {number|number[]} cd   초(0 = 없음) · 배열이면 랭크별(순간이동)
 * @property {number} action        행동 길이(초) — scaled면 APS_REF(1.4)에서의 값
 * @property {boolean} scaled       true면 행동 길이 = action × APS_REF / stats.aps
 * @property {number} hitFrac       판정 시점 = 행동 시작 + action × hitFrac
 * @property {number} [range] @property {number} [radius] @property {number} [angleDeg] @property {number} [width]
 * @property {number} [reach]       근접 사거리 — 몸 가장자리 사이(m · 가르기 1.2 — 피드백 1 · §5.2-5의 bash.reach · 판정 부채꼴 반지름 = 몸 r + reach + PLAYER.reachTolerance) · 최소 거리는 params.minRange(돌진 · 도약 2)
 * @property {number[]} coef        랭크별 무기 피해 계수(길이 = maxRank)
 * @property {{stun?:number[], chill?:number|number[], burnFrac?:number, shockChance?:number, knock?:number, slowPct?:number, slowSec?:number}} [status]
 *                                  적중이 싣는 상태 이상(배열이면 랭크별 [rank−1] · 비율은 0..1 — §7.2)
 * @property {Object} [params]      동작 수치(§7.2 표의 「params」 · §8.4가 읽는 키 — 변형 · 전설 패치 키는 넣지 않는다 · 비율은 0..1)
 */
/** @typedef {Object} SkillNode
 * @property {string} id
 * @property {ClassId} cls
 * @property {0|1|2} branch
 * @property {1|2|3|4} tier         단계 해금 = 그 클래스 트리에 쓴 점수 TREE.tierPoints[tier−1](0 · 5 · 10 · 15)
 * @property {'active'|'passive'|'transform'} kind
 * @property {number} maxRank
 * @property {string} [req]         변형: 이 액티브가 1랭크 이상이어야 찍는다
 * @property {SkillDef} [skill]     액티브
 * @property {Object<string, number[]>} [stats]      패시브: StatKey → 랭크별 값(아이템 옵션과 같은 단위 — 퍼센트 숫자)
 * @property {string} [cond]        조건부 패시브: CondId(§5.7) — condStats는 그 조건이 참인 적중에만
 * @property {Object<string, number[]>} [condStats]
 * @property {string} [transforms]  변형: 대상 액티브 ID(= req)
 * @property {Object} [patch]       변형: 대상 액티브의 skill.params에 덮어쓸 값(§8.4)
 */

/** @typedef {Object} AttackDef     (몬스터 공격 한 가지)
 * @property {string} id
 * @property {'melee'|'projectile'|'charge'|'explode'|'spawn'|'cast'} kind
 * @property {number} windup        예고(초) — 이 동안 자세 · 표식이 보인다(바닥 표식 · cast 공격은 이 값이 그 효과의 예고 길이 — 빠름을 곱하지 않는다 §5.17-5)
 * @property {number} recover       후딜(초)
 * @property {number} cd            같은 공격의 재사용 대기(초)
 * @property {number} [reach]       근접: 몸 가장자리 사이 거리(m) — 시작은 중심 거리 ≤ mon.r + reach + player.r · 판정은 + MON.reachTolerance(0.3)
 * @property {number} [coneDeg]     근접 판정 원뿔(도 · 공격 시작 때의 facing 기준)
 * @property {number} [range]       원거리 · 돌진: 쓰기 시작하는 중심 거리 상한(m)
 * @property {number} [minRange]
 * @property {number} mul           × mon.dmg
 * @property {DmgType} type
 * @property {'pose'|'aimLine'|'groundLine'|'groundCircle'|'glow'} telegraph
 * @property {{speed:number, r:number, life:number, visual:string}} [proj]
 * @property {number} [aimLock]     원거리: 발사 전 이 초부터 조준이 멈춘다(그 전에는 플레이어를 따라간다)
 * @property {number} [push]        근접 적중 시 플레이어를 미는 거리(m · PLAYER.pushSec 0.15초에 걸쳐 — §5.6)
 * @property {number} [escape]      바닥 표식을 만드는 공격: 표식이 시작될 때 최악 자리에서 판정 밖까지 걷는 거리(m — H5 §5.9 · data 검사)
 * @property {{chillSec?:number}} [onHit]
 * @property {Object} [params]
 */
/** @typedef {Object} MonsterDef
 * @property {string} id
 * @property {MonTemplate} template
 * @property {Array<'melee'|'ranged'|'support'|'swarm'|'structure'|'spawnling'>} tags
 * @property {string} behavior      BEHAVIORS 키(§8.1)
 * @property {number} radius        m(등급 배율 전)
 * @property {number} height        m(마우스 판별 · view)
 * @property {number} speed         m/s
 * @property {number} turnRate      rad/s
 * @property {number} hp            × MON.hpBase
 * @property {number} dmg           × MON.dmgBase
 * @property {number} xp            × XP.base
 * @property {number} gauge         × 등급 게이지
 * @property {Record<DmgType, number>} res   저항(0..0.75 — 받는 피해 × (1 − res))
 * @property {number} aggro         m — 이 거리 안 · 시야가 트이면 깬다
 * @property {boolean} eliteOk      챔피언 · 정예가 될 수 있다
 * @property {AttackDef[]} attacks
 * @property {Object} params        행동별 값(§7.4)
 * @property {{color:string, variant:string}} look   view 힌트(색 · 변형 이름)
 */
/** @typedef {Object} RankDef
 * @property {MonRank} id
 * @property {number} hp @property {number} dmg @property {number} xp
 * @property {number} gauge         게이지 %(× 종류 gauge)
 * @property {string|null} tc       TREASURE 키(null = 드랍 없음)
 * @property {number} scale         몸 크기 배율(반지름 · 높이 · 모델)
 * @property {number} stunMul @property {number} freezeMul @property {number} knockMul
 * @property {number|null} flinchFrac   한 번에 최대 생명의 이 비율 이상 맞으면 경직(null = 경직 없음)
 */
/** @typedef {Object} MonAffixDef
 * @property {string} id
 * @property {string} hook          AFFIX_HOOKS 키(= id)
 * @property {{hpMul?:number, speedMul?:number, atkSpeedMul?:number, res?:Partial<Record<DmgType,number>>, immune?:Array<'flinch'|'knock'>}} mods
 * @property {Object} params        훅 수치(§7.5 — 바닥 위협을 만드는 속성은 예고 `delay` · 탈출 거리 `escape`를 둔다 · H5)
 * @property {boolean} minionShare  정예의 하수인에게도 붙는가
 * @property {boolean} hazard       바닥 위협을 만드는가(위협 간격 규칙 §5.9 대상)
 * @property {string[]} excludeTags     이 태그의 몬스터에는 안 붙는다
 * @property {string[]} excludeAffixes  같이 붙지 않는 속성
 * @property {number} minLevel
 * @property {number} weight
 */
/** @typedef {Object} PackDef
 * @property {string} id
 * @property {Array<{typeId:string, min:number, max:number}>} members
 * @property {number} minLevel
 */
/** @typedef {Object} GuardianDef   (MonsterDef와 같은 꼴 — sim · view · ui · bot은 getMonDef(typeId) 하나로 읽는다 · §6.2)
 * @property {string} id            GUARDIAN_IMPLS 키
 * @property {MonTemplate} template
 * @property {Array<'melee'|'ranged'>} tags
 * @property {'guardian'} behavior @property {number} xp   (1 — × RANKS.guardian.xp) @property {number} gauge   (0) @property {number} aggro   (99) @property {boolean} eliteOk   (false)
 * @property {number} radius @property {number} height @property {number} speed @property {number} turnRate
 * @property {number} hp @property {number} dmg   (× MON 기준 · 등급 guardian 배율은 따로)
 * @property {Record<DmgType, number>} res
 * @property {AttackDef[]} attacks  기본 공격 + 고유 기술 2(kind 'cast' — 훅이 실행)
 * @property {Object} params
 * @property {{color:string, variant:string}} look
 */

/** @typedef {Object} TilesetDef
 * @property {TilesetId} id
 * @property {number} weight                     균열 타일셋 뽑기 가중치(town은 0)
 * @property {Array<{kind:string, weight:number, block:boolean, r:number, h:number, where:'wall'|'floor'|'room'}>} props
 * @property {{perRoom:[number, number], kinds:Array<{kind:string, color:string, intensity:number, radius:number, flicker:number, y:number}>}} lights
 * @property {string} ambience                   소리 환경음 ID
 */
/** @typedef {Object} RiftRow   (§7.3 — data/rift.js riftRow(L))
 * @property {number} level @property {number} monLevel @property {number} ilvl
 * @property {number} hpMul @property {number} dmgMul @property {number} goldMul @property {number} xpMul
 * @property {number} champAffixes @property {number} eliteAffixes @property {number} guardianAffixes
 * @property {number} championPacks @property {number} elitePacks
 * @property {Record<'magic'|'rare'|'legendary'|'set', number>} rarityMul
 */

/** @typedef {Object} BaseDef    (아이템 기본형 — 무기는 피해 종류를 갖지 않는다: 시트의 weapon.type = 클래스 기본 공격의 type · §5.6)
 * @property {string} id
 * @property {ItemSlot} slot
 * @property {ClassId|null} cls     무기 · 보조는 클래스 전용, 나머지 null(공용)
 * @property {1|2} [hands]          주무기
 * @property {[number, number]} [dmg]   ilvl 1 · 단계 0의 최소 · 최대 피해
 * @property {number} [aps]         초당 공격
 * @property {number} [armor]       ilvl 1 · 단계 0
 * @property {number} [block]       방패 막기 확률(0..1)
 * @property {[number, number]} [bonus] 마법구 추가 피해(ilvl 1)
 * @property {number} [mana]        마법구 자원 최대 +
 * @property {number} weight        같은 부위 · 클래스 안의 뽑기 가중치
 * @property {string} look          view 메시 ID(§9.6)
 */
/** @typedef {'str'|'int'|'vit'|'weaponDmgPct'|'attackSpeedPct'|'critChance'|'critDamage'
 *   |'physPct'|'firePct'|'coldPct'|'lightningPct'|'skillPct'|'cdr'|'costReduce'|'lifePct'|'lifeRegen'|'lifeOnHit'|'lifePctOnHit'
 *   |'armor'|'armorPct'|'allRes'|'resPct'|'physRes'|'fireRes'|'coldRes'|'lightningRes'|'moveSpeed'|'aoePct'|'elitePct'|'thorns'
 *   |'goldFind'|'magicFind'|'xpPct'|'potionPct'|'globePct'|'manaRegenPct'|'dmgTakenReduce'|'rageOnHit'
 *   |'allPct'|'burnFrac'|'freezeAt'|'freezeDurPct'} StatKey
 *  allPct = 모든 종류 피해 %(dmgPct 넷에 더한다) · burnFrac = 화염 적중이 남기는 화상 % · freezeAt = 빙결 문턱 −점(PlayerStats.freezeAtReduce) · freezeDurPct = 빙결 길이 %
 *  아이템 옵션 · 패시브 · 세트 효과가 쓰는 능력치 키. 값의 단위는 §7.7 표(퍼센트 숫자 또는 고정값). */
/** @typedef {Object} ItemAffixDef
 * @property {string} id
 * @property {'prefix'|'suffix'} kind
 * @property {StatKey} stat
 * @property {ItemSlot[]} slots
 * @property {number} weight
 * @property {'flat'|'pow'} scale    pow면 값 × ITEM_GROWTH^(ilvl−1)
 * @property {Array<[number, number]>} tiers   T1..T5 값 범위(포함)
 * @property {MainStat} [main]       str/int 옵션 — 클래스 편향 가중치(§5.13)
 * @property {'skill'} [param]       skillPct — 굴릴 때 클래스 액티브 하나를 고른다
 * @property {0|1} decimals          값 반올림 자리
 */
/** @typedef {Object} TreasureDef
 * @property {string} id            'normal'|'minion'|'champion'|'elite'|'guardian'|'split'
 * @property {number} picks
 * @property {{none:number, gold:number, potion:number, globe:number, material:number, gear:number}} w
 * @property {number} goldMul       골드 더미 크기 배율
 * @property {number} [guaranteed]  희귀 이상 보장 장비 수
 */
/** @typedef {Object} LegendaryDef
 * @property {string} id @property {string} baseId @property {ClassId|null} cls
 * @property {string} hook          효과 이름(문자열 키 legfx.<id> · 사건형이면 EQUIP_HOOKS 키)
 * @property {string} [skill]       패치형: 대상 스킬 노드 ID @property {Object} [patch]   그 스킬 params에 덮어쓸 값(§8.5)
 * @property {'kill'|'globe'} [at]  사건형: 도는 사건 @property {Object} params
 * @property {[number, number]} affixes   추가 옵션 수 범위 @property {number} weight
 */
/** @typedef {Object} SetDef
 * @property {string} id @property {ClassId} cls
 * @property {Array<{id:string, baseId:string, slot:ItemSlot}>} pieces
 * @property {Object<string, number>} bonus2   StatKey → 값(2세트)
 * @property {Object<string, number>} bonus4   (4세트 — 2세트에 더해진다)
 */
```

### 3.4 맵 — `MapData` (상태 아님 · `ctx.map` · §0.5)

```js
/** @typedef {Object} MapData
 * @property {string} id            'town' | `rift:${seed}:${level}`
 * @property {'town'|'rift'} kind
 * @property {TilesetId} tileset
 * @property {number} w @property {number} h          타일 수(타일 = 2m)
 * @property {Uint8Array} tiles     w×h · TILE_VOID 0 · TILE_FLOOR 1 · TILE_WALL 2 (벽 = 바닥에 8방향으로 닿는 비바닥 타일)
 * @property {number} nw @property {number} nh        내비 칸 수(= w×4, h×4)
 * @property {Uint8Array} nav       nw×nh · 0 걷기 가능 · 1 막힘(벽 · 막는 소품)
 * @property {Room[]} rooms
 * @property {Array<{a:number, b:number, cells:Array<[number, number]>}>} corridors   방 a–b 연결 · 통로 타일 목록(view · 미니맵)
 * @property {Prop[]} props
 * @property {LightDef[]} lights
 * @property {{x:number, z:number, facing:number}} spawn   플레이어 시작(균열) · 마을 도착점
 * @property {PackSlot[]} packSlots       (균열) 팩 자리 — P3가 채운다
 * @property {MapObject[]} objects        (마을) 상호작용 물체 · 장식 건물
 * @property {{x0:number, z0:number, x1:number, z1:number}} bounds   바닥이 있는 영역(m)
 */
/** @typedef {{id:number, x0:number, z0:number, x1:number, z1:number, cx:number, cz:number, depth:number, kind:'start'|'room'|'big'}} Room
 *  좌표는 m(바닥 영역) · depth = 시작 방에서 그래프 거리 */
/** @typedef {{id:number, kind:string, x:number, z:number, facing:number, r:number, h:number, block:boolean}} Prop */
/** @typedef {{x:number, y:number, z:number, color:string, intensity:number, radius:number, flicker:number, kind:string}} LightDef */
/** @typedef {{id:number, roomId:number, x:number, z:number, kind:'normal'|'champion'|'elite', depth:number}} PackSlot */
/** @typedef {{id:string, kind:InteractKind|'deco', npc?:string, x:number, z:number, facing:number, r:number, w?:number, d?:number, h?:number, look:string}} MapObject
 *  r = 상호작용 반지름(클릭 판별 · 도착 판정 기준) · w/d/h = 장식 건물 상자 크기 · h = 높이(마우스 판별 · 대상 검사 — 상호작용 물체에 없으면 PICKUP.objectH) */
```

### 3.5 아이템 — `Item`

```js
/** @typedef {Object} ItemAffix
 * @property {string} id            ITEM_AFFIXES 키
 * @property {1|2|3|4|5} tier
 * @property {number} value         굴린 값(pow 옵션이면 ilvl 배율까지 곱한 뒤 decimals로 반올림)
 * @property {string} [param]       skillPct의 스킬 ID
 */
/** @typedef {Object} Item
 * @property {string} id            'i<n>' — 계정에서 유일
 * @property {string} baseId
 * @property {ItemSlot} slot
 * @property {ClassId|null} cls     기본형의 cls(방어구 · 장신구 null) — W1 확정: 전설은 그 행의 cls(공용 전설은 null) · 세트 조각은 그 세트의 cls(클래스 전용 · makeItem도 같다)
 * @property {Rarity} rarity
 * @property {number} ilvl          1..
 * @property {number} reqLevel      = min(ilvl, ITEM.reqLevelCap 30 — **피드백 2 D2**) (캐릭터 레벨이 이보다 낮으면 장착 불가 · 툴팁 붉게)
 * @property {0|1|2} tier           기본형 단계(일반 · 고급 · 정예)
 * @property {{dmg?:[number, number], aps?:number, armor?:number, block?:number, bonus?:[number, number], mana?:number}} base
 *                                  굴린 기본 값(ilvl · 단계 배율 · ±편차까지 곱한 결과 · dmg/armor/bonus는 정수)
 * @property {ItemAffix[]} affixes  순서 = 굴린 순서(접두 먼저 · 각 kind 안에서 굴린 순)
 * @property {string[]} name        문자열 키 배열 — ui가 t()로 바꿔 공백으로 잇는다(§10.8)
 * @property {string} [legendaryId] @property {string} [setId] @property {string} [setPieceId]
 * @property {number} dur @property {number} durMax     0..100 · 0이면 그 아이템의 능력치가 꺼진다
 * @property {number|null} rerollIdx   신비술사가 고정한 옵션 인덱스(null = 아직 안 고름)
 * @property {number} rerolls       그 아이템의 재굴림 횟수(비용 증가)
 * @property {number} value         골드 가치(정수 — 판매 · 수리 · 되사기의 기준 · §7.10)
 * @property {{gambled?:boolean, crafted?:boolean, bought?:boolean, start?:boolean, locked?:boolean}} flags
 *                                  locked = 잠금(KeyL — 일괄 판매 · 일괄 분해에서 빠지고, 하나씩 팔기 · 분해는 'itemLocked')
 */
```

### 3.6 모양 · 판정 값

```js
/** @typedef {Object} Shape
 * @property {ShapeType} type
 * @property {number} x @property {number} z           기준점(원 · 고리 · 원뿔 꼭짓점 · 선의 시작)
 * @property {number} [r]           원 · 원뿔 · 고리(바깥) 반지름
 * @property {number} [r0]          고리 안쪽 반지름
 * @property {number} [facing]      원뿔 · 선의 방향(yaw)
 * @property {number} [angle]       원뿔 전체 각(rad)
 * @property {number} [len] @property {number} [width]  선(직사각형: 시작점에서 facing 방향으로 len · 폭 width)
 * @property {Vec2[]} [pts]         poly(연쇄 번개 같은 꺾은선 — 판정 없음 · 연출용)
 *  몸(원 · 반지름 rb)과의 겹침: circle = 중심 거리 ≤ r + rb · cone = 거리 ≤ r + rb 이고 방향 차 ≤ angle/2(+ rb가 각도로 주는 여유 asin(rb/거리)) ·
 *  line = 선분까지 거리 ≤ width/2 + rb 이고 투영이 [−rb, len + rb] · ring = r0 − rb ≤ 거리 ≤ r + rb. (`core/shapes.js`의 `overlaps(shape, x, z, rb)` 하나가 정본)
 */
/** @typedef {Object} PlayerHitSpec   (플레이어 → 몬스터 적중 한 번의 정의)
 * @property {string} skillId       스킬 노드 ID 또는 'bash' · 'magicBolt' · 전설 훅 ID
 * @property {number} coef          무기 피해 계수
 * @property {DmgType} type
 * @property {SkillTag[]} tags
 * @property {number} actionId      시전 한 번의 번호(state.nextId) — 한 행동 안의 적중당 회복 · 분노 상한을 센다(채널 틱 · 플레이어 지속 효과 틱은 틱마다 새 번호 — §5.6)
 * @property {number} srcX @property {number} srcZ   넉백 방향 · 방패 정면 판정의 기준
 * @property {number} [stun]        초 @property {number} [knock] m @property {number} [chill] 점
 * @property {number} [burnFrac]    이 적중 피해의 비율만큼 3초 화상(패시브 연소와 더한다)
 * @property {number} [shockChance] @property {{pct:number, sec:number}} [slow]
 * @property {number} [maxTargets]  모양 적중의 대상 상한(가까운 순)
 * @property {boolean} [noProcs]    true면 전설 처치 훅 · 적중 회복 · 분노 생성이 돌지 않는다(훅이 만든 적중의 재귀 방지)
 * @property {number} [flat]        coef 대신 고정 피해(시체 폭발처럼 대상 생명 비례) — 주 능력치 · 치명타 미적용
 */
/** @typedef {Object} HitResult
 * @property {number} monId @property {number} dmg   실제로 깎인 생명
 * @property {boolean} crit @property {boolean} killed
 * @property {boolean} immune       보호막 속성 · 사라짐 중이라 0
 * @property {boolean} blocked      방패 해골 정면이라 줄었다
 */
/** @typedef {Object} MonAttackSpec   (몬스터 · 바닥 효과 → 플레이어)
 * @property {number} srcId         몬스터 ID(효과면 효과 ID)
 * @property {'melee'|'projectile'|'hazard'|'charge'|'explode'} via
 * @property {number} raw           감소 전 피해(= mon.dmg × mul)
 * @property {DmgType} type
 * @property {number} level         몬스터 레벨(방어도 · 저항 분모)
 * @property {number} [push]        m
 * @property {{chillSec?:number, slowPct?:number, rootSec?:number}} [onHit]
 * @property {boolean} [noAffix]   true면 속성 onHitPlayer가 돌지 않는다(속성 훅이 만든 피해 — 번개 불꽃 · 화염 추가 · 냉기 노바 · 화염 사망)
 */
/** @typedef {Object} PlayerHitResult
 * @property {number} dmg           생명에서 깎인 양 @property {number} absorbed   보호막이 막은 양
 * @property {boolean} blocked      방패 막기 @property {boolean} killed
 * @property {boolean} ignored      도착 보호 · 무적 · 사망 중이라 무시
 */
```

### 3.7 게임 상태 — `GameState`

```js
/** @typedef {Object} GameState
 * @property {number} v             STATE_VERSION
 * @property {number} tick          0부터 · step마다 +1(장면에 관계없이)
 * @property {number} seed          세션 시드(uint32)
 * @property {{combat:{s:number}, loot:{s:number}, ai:{s:number}, shop:{s:number}}} rng   난수 줄기 넷(§5.14)
 * @property {number} nextId        엔티티 · 행동 번호(1부터)
 * @property {SceneId} scene
 * @property {Travel|null} pendingTravel    장면 전환 대기(§5.11) — 있으면 step은 tick만 민다
 * @property {AccountState} account
 * @property {CharacterState|null} char     null = 캐릭터를 아직 고르지 않음(타이틀 뒤 마을 배경)
 * @property {PlayerState} player
 * @property {TownState} town
 * @property {RiftState|null} rift         열린 균열(마을에 있어도 남는다 · 마을에서는 step하지 않는다)
 * @property {MeterState} meter
 * @property {SimEvent[]} events            플러시 전 큐(§4.1)
 * @property {{invincible:boolean, devSession:boolean}} flags
 */
/** @typedef {{name:string, payload:Object}} SimEvent */
/** @typedef {{to:SceneId, reason:'openRift'|'recall'|'townPortal'|'riftPortal'|'respawn'|'exit'|'debug', level?:number, seed?:number}} Travel */

/** @typedef {Object} AccountState
 * @property {Array<null|{name:string, cls:ClassId, level:number, riftUnlocked:number}>} chars   길이 4(캐릭터 칸 요약)
 * @property {Array<Item|null>} stash       길이 60(계정 공유)
 * @property {number} nextItemId            다음 아이템 번호(1부터 · 저장된다)
 * @property {number} lastSlot              마지막으로 쓴 캐릭터 칸(-1 = 없음)
 */
/** @typedef {Object} CharacterState
 * @property {number} slot @property {string} name @property {ClassId} cls
 * @property {number} level         1..30
 * @property {number} xp            지금 레벨 안의 경험치(0 .. XP.req(level)) · 캡이면 0
 * @property {number} xpTotal       누적(기록용)
 * @property {number} gold
 * @property {Record<MaterialId, number>} materials
 * @property {number} potions       0..ECON.potionMax @property {number} scrolls   0..ECON.scrollMax
 * @property {{ranks:Object<string, number>, bar:Array<string|null>}} skills   bar 길이 5(0 = 우클릭)
 * @property {Record<EquipSlot, Item|null>} equip
 * @property {Array<Item|null>} bag         길이 BAG_SIZE 30(6 × 5 · 인덱스 = 행 × 6 + 열 — 피드백 2 D4 · 옛 40) · 넘친 옛 세이브는 길이 > 30(idx ≥ 30 = 칸 밖 · 빈자리 없이 끝에 붙는다 — §6.11 settleBag)
 * @property {number} riftUnlocked          고를 수 있는 최고 균열 레벨(1부터)
 * @property {Object<string, {timeSec:number, deaths:number}>} best   균열 레벨 → 최고 기록(완료한 것만)
 * @property {RunRecord[]} records          최근 RECORDS_MAX(200)개
 * @property {{count:number}} blp           불운 보정 — 전설 · 세트 없이 지나간 장비 드랍 수
 * @property {Array<{item:Item, price:number}>} buyback   최근 판 것 10개(새것이 앞)
 * @property {ShopState} shop
 * @property {Object<string, boolean>} hints  본 안내 카드
 * @property {number} playSec               누적 플레이 시간(초 — step한 틱 / 30 + 마을에서 패널이 열린 시간 `addPlaySec` · 측정용)
 * @property {number} runs                  연 균열 수(시드 파생)
 * @property {number} seed                  캐릭터 시드(생성 때 hash32(state.seed, slot) · 저장 — 상점 재고 시드 §6.11)
 * @property {number} lastRiftLevel         마지막으로 연 균열 레벨(1부터 · 소모품 · 초기화 가격의 PLc — §7.10)
 */
/** @typedef {Object} ShopState
 * @property {Item[]} blacksmith            재고(SHOP.blacksmithStock개 · 균열 한 판마다 새로 — stockRun)
 * @property {Item[]} general               장신구 재고
 * @property {number} restocks              재고 갱신 횟수(시드 파생)
 * @property {number} stockRun              재고를 굴린 때의 char.runs(-1 = 아직 없음 · 같으면 다시 굴리지 않는다 — §6.11)
 * @property {RerollOffer|null} reroll      진행 중인 재굴림 제안
 */
/** @typedef {{itemId:string, where:'bag'|'equip', idx:number, affixIdx:number, options:ItemAffix[], cost:{gold:number, dust:number, essence:number}}} RerollOffer
 *  options[0] = 기존 옵션, [1..2] = 새 후보 */

/** @typedef {Object} PlayerState
 * @property {Vec2} pos @property {Vec2} prevPos
 * @property {number} facing        yaw
 * @property {number} r             몸 반지름(m)
 * @property {number} life @property {number} lifeMax
 * @property {number} resource @property {number} resourceMax
 * @property {PlayerAct} act
 * @property {string|null} actSkill     지금 행동의 스킬 ID('bash' · 'magicBolt' · 노드 ID · 'recall')
 * @property {number} actStart @property {number} actHit @property {number} actEnd    틱(판정 없는 행동은 actHit = actStart)
 * @property {Vec2|null} actPoint       행동의 목표 지점(돌진 · 도약 · 순간이동 · 메테오)
 * @property {number|null} actTargetId
 * @property {number} actId             행동 번호(PlayerHitSpec.actionId)
 * @property {Vec2[]} path              남은 경유점(마지막 = 목적지)
 * @property {Intent} intent
 * @property {Buffered|null} buffer     선입력(§5.3)
 * @property {Object<string, number>} readyAt   스킬 ID → 다시 쓸 수 있는 틱(쿨다운)
 * @property {number} potionReadyAt
 * @property {Buff[]} buffs
 * @property {number} shield            마력 보호막 남은 흡수량
 * @property {{slowPct:number, slowUntil:number, rootUntil:number}} st   (감속 · 속박 — 냉기 강화 · 감옥)
 * @property {{start:number, end:number}|null} recall
 * @property {{skillId:string, nextAt:number, startedAt:number}|null} channel
 * @property {{from:Vec2, to:Vec2, start:number, end:number, kind:'dash'|'leap'}|null} air   돌진 · 도약 궤적(view — sim 위치는 §5.4 규칙으로 매 틱 pos에 있다)
 * @property {{hitIds:number[], hits:number, nextAt:number}} sk   지금 행동 · 채널의 스킬 스크래치(행동을 시작할 때 {hitIds:[], hits:0, nextAt:-1}로 새로 · 동작이 키를 더할 수 있다 — 순수 값 · 절대 틱 키는 At으로 끝난다)
 * @property {{vx:number, vz:number, until:number}|null} knock   몬스터 공격의 밀림(PLAYER.pushSec — §5.6)
 * @property {number} potionQueuedUntil   쿨다운 끝 직전에 누른 포션의 대기(틱 · 0 = 없음 — §5.3)
 * @property {{typeId:string, rank:MonRank, name:string[]|null}|null} killedBy   마지막 사망의 처치자(killPlayer가 세우고 부활 commit에서 null — 사망 패널)
 * @property {Hover|null} hover         이번 틱 입력의 대상(검사 통과한 것만)
 * @property {number|null} targetId     지금 공격 중인 몬스터(대상 프레임)
 * @property {number} combatUntil       분노 감소 시작 틱
 * @property {number} protectUntil      도착 보호(이 틱까지 피해 무시)
 * @property {number} invulnUntil       도약 공중 무적
 * @property {boolean} lowLife          생명 ≤ COMBAT.lowLife
 * @property {boolean} dead @property {number} deadAt
 * @property {number} speed             이번 틱 실제 이동 속력(m/s — 걷기 애니메이션)
 * @property {boolean} moving
 * @property {{windowStart:number, sum:number}} rageTaken   피격 분노의 초당 상한 집계(§5.5)
 * @property {{actionId:number, n:number}} loh             적중 회복 대상 수 집계(§5.6)
 * @property {number} hitstopAt         마지막 히트스톱 틱(§5.12)
 * @property {number} failAt            마지막 SKILL_FAIL 틱 · @property {string|null} failKey   (같은 실패 0.5초에 한 번)
 */
/** @typedef {{kind:'none'|'move'|'attack'|'standAttack'|'pickup'|'interact', point?:Vec2, targetId?:number, objectId?:string, follow?:boolean, held?:boolean}} Intent */
/** @typedef {{kind:'basic'|'skill'|'move'|'attack', slot?:number, skillId?:string, point?:Vec2, targetId?:number|null, stand?:boolean, until:number}} Buffered */
/** @typedef {{id:string, until:number, value:number}} Buff     id: 'warCry'(value = 방어도 배율 + · 0..1) · 'energyShield'(value = 처음 흡수량) */

/** @typedef {Object} TownState
 * @property {boolean} portalOpen       열린 균열이 있고 붕괴하지 않았다
 * @property {boolean} returnPrompt     부활 직후 「Enter — 포털로 돌아가기」(포털을 쓰거나 균열이 닫히면 false)
 * @property {string|null} lastInteract
 */

/** @typedef {Object} RiftState
 * @property {number} level @property {number} seed @property {TilesetId} tileset @property {string} mapId
 * @property {RiftPhase} phase
 * @property {number} gauge         0..100(%)
 * @property {number} lives         3에서 시작 · 사망마다 −1 · 0에서 사망하면 붕괴
 * @property {number} deaths
 * @property {number} openedAt      틱
 * @property {number} leftAt        마지막으로 균열을 떠난 틱(균열에서 pendingTravel이 선 틱 · 균열 안이면 -1 — 마을 → 균열 commit이 rift 하위 시각을 민다 §5.11)
 * @property {number} ticksIn       균열 장면에서 step한 틱 수(「한 판 길이」 · 기록)
 * @property {MonsterState[]} mons @property {Proj[]} projs @property {Effect[]} effects @property {Drop[]} drops
 * @property {PackState[]} packs
 * @property {Portal[]} portals
 * @property {number|null} guardianId
 * @property {{x:number, z:number, at:number}|null} guardianSpawn   출현 예고(at = 나타나는 틱)
 * @property {Vec2|null} returnPos      마을 포털로 돌아올 자리(귀환한 자리 · 사망이면 checkpoint)
 * @property {Vec2} checkpoint          안전 지점(§5.10)
 * @property {number} checkpointCalm    그 자리에서 조용했던 틱 수
 * @property {number[]} explored        w×h 타일 · 0/1(미니맵)
 * @property {number} rootLockUntil     감옥 속박 중 · 직후 — 새 바닥 위협이 플레이어 발밑에 시작하지 않는다(§5.9)
 * @property {RunStats} stats
 * @property {RunSummary|null} summary  완료 · 붕괴 때 만든 요약(패널이 읽는다)
 * @property {RunSummary|null} settled  리뷰 수정: 수호자 처치 틱에 정산한 완료 요약(해금 · 완료 경험치 · 기록이 이미 캐릭터에 있다 — `completeAt`에 `summary`로 옮긴다)
 * @property {number|null} completeAt   요약 패널을 띄울 틱
 * @property {string} guardianType      채울 때 정한 수호자 ID(GUARDIANS 키)
 * @property {number|null} calmAt       사망 뒤 몬스터를 재울 틱(§5.10 — W1 수정: `DEATH.calmSec` 0이면 사망한 틱에 재우고 늘 null · 0보다 크면 그 뒤 · 부활로 떠날 때 남아 있으면 그때)
 * @property {null} mods                로드맵 자리(균열 변형 옵션 — v0.1은 늘 null · §8.8)
 * @property {Record<number, {x:number, z:number, facing:number}>} homes   W1 수정(NOTES-W1FIX): 몬스터 ID → 처음 놓인 자리(`spawnMonster`가 쓴다 · 부활로 균열을 떠날 때 잠든 몬스터가 돌아간다 §5.10 · 시각 아님 — shiftTicks 대상 아님 · 균열 진행은 저장하지 않는다)
 */
/** @typedef {Object} RunStats
 * @property {{normal:number, champion:number, elite:number, minion:number, guardian:number, other:number}} kills   (split · spawn은 other)
 * @property {Record<Rarity, number>} drops      바닥에 떨어진 장비(등급별)
 * @property {number} gold @property {number} xp @property {number} upgrades     업그레이드 드랍 수(§5.13)
 * @property {number} recalls @property {number} potions
 * @property {number} maxTargeting  동시에 플레이어를 노린 몬스터 수의 최대
 * @property {number} swarmMoments  25마리 이상이 노린 순간 수(§5.15)
 * @property {number} dmgDealt @property {number} dmgTaken
 * @property {boolean} bagFullRecall  가방이 차서 귀환한 적이 있다
 */
/** @typedef {Object} MonsterState
 * @property {number} id @property {string} typeId @property {MonRank} rank
 * @property {number} packId @property {number} level
 * @property {string[]} affixes     MON_AFFIXES 키
 * @property {string[]|null} name   정예: [elite.a.N, elite.b.M] 문자열 키 · 그 밖 null(이름 = mon.<typeId>)
 * @property {Vec2} pos @property {Vec2} prevPos @property {number} facing @property {Vec2} vel
 * @property {number} r @property {number} height @property {number} scale
 *                                  r = def.radius × rank.scale · height = def.height × rank.scale — 이미 곱한 값(sim · view · pick은 그대로 쓰고 scale을 다시 곱하지 않는다 · scale은 모델 배율에만)
 * @property {number} hp @property {number} hpMax @property {number} dmg @property {number} speed
 * @property {Record<DmgType, number>} res
 * @property {boolean} awake
 * @property {boolean} targeting    플레이어를 노리는 중(깨어 있고 15m 안 · 도망 아님 — 떼 순간 집계)
 * @property {MonAct} act @property {string|null} actId
 * @property {number} actStart @property {number} actHit @property {number} actEnd
 * @property {Vec2|null} aim        조준점(궁수 조준선 · 돌진 끝 · 주술사 부활 대상) — view가 예고에 쓴다
 * @property {boolean} aimLocked    조준이 멈췄다(궁수 발사 직전 0.2초 · 돌진)
 * @property {Object<string, number>} readyAt    공격 ID → 다시 쓸 수 있는 틱
 * @property {MonStatus} st
 * @property {{vx:number, vz:number, until:number}|null} knock
 * @property {boolean} dead @property {number} deadAt
 * @property {boolean} gone        목록에서 뺄 표시(갱신 · 판정 · 질의 · 그리기에서 빠진다 — 배열에서는 cleanup이 뺀다 §5.14)
 * @property {{x:number, z:number}|null} launch   사망 때 날아가는 수평 속도(view 연출 — 큰 일격)
 * @property {Object<string, Object>} ax          속성 · 행동 훅의 상태(순수 객체 · 키 = 속성 ID 또는 'b' · 절대 틱은 이름 끝 At · Until로만 — shiftTicks §5.11)
 * @property {{noXp:boolean, noDrops:boolean, noGauge:boolean, revived:boolean}} flags
 * @property {{by:'player'|'env'|'mon', skillId:string|null, noProcs:boolean, frozen:boolean}|null} lastHit   마지막 피해(처치 훅 · 집계)
 * @property {number} sleepAt       깨어 있는데 멀어진 틱(다시 잠드는 판정)
 */
/** @typedef {Object} MonStatus
 * @property {number} stunUntil @property {number} stunImmuneUntil
 * @property {number} chill          0..100 점 @property {number} chillDecayAt   이 틱부터 감소
 * @property {number} freezeUntil @property {number} freezeImmuneUntil
 * @property {{dps:number, until:number, nextAt:number}|null} burn
 * @property {number} shockUntil
 * @property {{pct:number, until:number}|null} slow
 * @property {number} flinchUntil @property {number} flinchImmuneUntil @property {number} knockImmuneUntil
 * @property {number} invulnUntil    보호막 속성 · 사라짐
 */
/** @typedef {{id:number, kind:'normal'|'champion'|'elite'|'guardian', memberIds:number[], awake:boolean, nextHazardAt:number, fled:boolean, anchor:Vec2, depth?:number}} PackState
 *  W1 수정(NOTES-W1FIX): `depth` = 팩 자리(`PackSlot.depth`)의 방 깊이 — `populateRift`만 세운다(디버그 · 고정 상태 · 수호자 팩은 없다 = 깊은 팩으로 본다 · §5.17-1 초반 경사) */
/** @typedef {Object} Proj
 * @property {number} id @property {string} visual   §9.8의 투사체 연출 ID
 * @property {'player'|'mon'} owner @property {number} srcId
 * @property {Vec2} pos @property {Vec2} prevPos @property {Vec2} vel
 * @property {number} r @property {number} born @property {number} until   틱
 * @property {number} pierce        남은 관통(0 = 첫 적중에서 끝)
 * @property {number[]} hitIds      이미 맞힌 몬스터(관통 중복 방지)
 * @property {boolean} bounce       벽에 튕긴다(번개 불꽃)
 * @property {Object} spec          적중 정의(owner player: PlayerHitSpec · mon: MonAttackSpec) — 연출이 읽지 않는다
 * @property {{r:number, spec:Object, visual:string}|null} explode   끝날 때 폭발(화염구)
 */
/** @typedef {Object} Effect
 * @property {number} id @property {string} kind    §9.8의 효과 kind(예: 'spinEcho'(피드백 1 — 옛 'stomp') · 'quakeWave' · 'meteor' · 'jail' · 'plague' · 'mortar' · 'coldNova' · 'fireDeath' · 'bloaterBurst' · 'slam' · 'boneSpikes' · 'emberRain' · 'guardianSpawn' · 'chargeLine' · 'vortex' · 'poisonPool' · 'chainArc' …)
 * @property {'player'|'mon'|'env'} owner @property {number} srcId
 * @property {number} packId        적대 위협의 팩(위협 간격 §5.9 · 없으면 -1)
 * @property {boolean} cancelOnSrcDeath   출처가 죽으면 예고째 지운다(§5.16-6)
 * @property {boolean} hostile      플레이어를 다치게 한다(붉은 · 위협 색) — false면 플레이어 스킬(주황 · 파랑 · 흰)
 * @property {Shape} shape
 * @property {number} start @property {number} hitAt @property {number} end   틱. 예고 = [start, hitAt) · 판정 = hitAt · 지속 = [hitAt, end)
 * @property {number} tickT         지속 효과의 판정 간격(틱 · 0 = 지속 판정 없음 · 첫 지속 판정 = hitAt + tickT)
 * @property {number} nextTickAt
 * @property {boolean} resolved     hitAt 판정을 했다
 * @property {Object|null} spec     hitAt 판정 정의(null = 판정 없는 표시 전용 예고 — 돌진 선 · 연출이 읽지 않는다)
 * @property {Object|null} tickSpec 지속 틱 판정 정의(null이면 spec · 비적대는 만드는 쪽이 coef = coefPerSec × 틱 초를 넣는다)
 * @property {Vec2|null} from       몰타르 포탄 · 메테오 낙하의 출발점(연출)
 * @property {'player'} [follow]  피드백 1 — 있으면('player') 판정(hitAt) 전까지 매 틱 shape 중심 · spec 출처가 플레이어 자리로 간다(연속 회전 spinEcho · effects.js updateEffects) · 따라가지 않는 효과에는 키가 없다
 */
/** @typedef {Object} Drop
 * @property {number} id @property {DropKind} kind
 * @property {Vec2} pos @property {Vec2} from      떨어진 자리 → 놓인 자리(view의 튀어나오는 호)
 * @property {number} born          틱
 * @property {Item|null} item       kind 'item'
 * @property {number} amount        골드 · 포션 · 재료 개수 · 구슬은 1
 * @property {MaterialId|null} mat
 * @property {Rarity|null} rarity   item이면 item.rarity
 * @property {boolean} gone       주웠다 · 사라졌다(removeDrop이 표시 · 배열에서는 cleanup이 뺀다 §5.14)
 */
/** @typedef {{id:string, kind:'recall'|'exit', pos:Vec2, r:number, born:number}} Portal   id = 'portal:<n>' · r = RIFT.portalR(1.0) · getObject가 MapObject 꼴(kind 'riftPortal' · portalKind)로 정규화한다(§6.4) */

/** @typedef {Object} MeterState
 * @property {number[]} dealt       길이 METER.window(150틱 = 5초) 링 버퍼 — 틱별 준 피해
 * @property {number[]} taken       같은 모양 — 받은 피해
 * @property {number} idx           링 버퍼의 지금 칸
 * @property {number[]} killTicks   최근 처치 틱(최근 METER.killCap개 · 분당 처치)
 * @property {number} runXp @property {number} runGold   이번 균열에서 얻은 것
 * @property {number} targeting     이번 틱 노리는 몬스터 수
 * @property {boolean} swarmArmed   떼 순간을 다시 셀 준비(§5.15)
 */
```

### 3.8 캐릭터 시트 — `PlayerStats` (`computeStats`의 결과 · `ctx.stats`)

```js
/** @typedef {Object} PlayerStats
 * @property {ClassId} cls @property {number} level
 * @property {number} main @property {number} vit
 * @property {number} lifeMax @property {number} resourceMax @property {number} resourceRegen   (마나/초)
 * @property {{min:number, max:number, aps:number, type:DmgType, hands:1|2, baseId:string|null, fist:boolean}} weapon
 *           무기 로컬 옵션(weaponDmgPct)과 마법구 추가 피해까지 더한 값 · 무기가 없거나 내구도 0이면 fist(FIST 표)
 *           type = 그 클래스 기본 공격의 type(BASIC_SKILLS[CLASSES[cls].basic].type — warrior 'phys' · mage 'lightning') · 무기 기본형은 피해 종류를 갖지 않는다
 * @property {number} aps            weapon.aps × (1 + attackSpeedPct)
 * @property {number} critChance     0..COMBAT.critCap @property {number} critDamage  치명타 추가 배율(0.5 = +50%)
 * @property {Record<DmgType, number>} dmgPct       더하는 피해 보너스(0..)
 * @property {Object<string, number>} skillPct      스킬 ID → 보너스
 * @property {number} aoePct @property {number} elitePct
 * @property {number} cdr            0..COMBAT.cdrCap @property {number} costReduce  0..COMBAT.costCap
 * @property {number} lifeRegen      생명/초 @property {number} lifeOnHit   적중당 고정 회복
 * @property {number} lifePctOnHit   적중당 최대 생명 비율 회복(피의 갈증)
 * @property {number} armor          armorPct까지 곱한 값
 * @property {Record<DmgType, number>} res          (allRes 더하고 resPct 곱한 값)
 * @property {number} block          0..1(방패)
 * @property {number} moveSpeed      m/s (기본 × (1 + 이동 속도 · 상한 COMBAT.moveCap))
 * @property {number} thorns @property {number} goldFind @property {number} magicFind @property {number} xpPct
 * @property {number} potionPct @property {number} globePct @property {number} dmgTakenReduce @property {number} rageOnHit
 * @property {number} burnFrac       화염 적중의 화상 비율(0..) @property {number} freezeAtReduce   빙결 문턱 −점 @property {number} freezeDurPct
 * @property {number} manaRegenPct   (resourceRegen에 이미 곱했다 · 표시용)
 * @property {string[]} hooks        활성 전설 ID(LEGENDARIES의 id · 내구도 0 아이템 제외 — §8.5 「전설 ID 목록」)
 * @property {Object<string, number>} ranks     스킬 노드 랭크(skills.ranks 복사)
 * @property {string[]} transforms   찍은 변형 노드 ID
 * @property {Array<{cond:string, stats:Object<string, number>}>} conds   조건부 패시브(값은 PlayerStats 단위로 바꾼 것 — 키: allPct → dmgPct · freezeAt → freezeAtReduce · 그 밖은 같은 이름 · 퍼센트 키는 /100)
 * @property {EquipSlot[]} broken    내구도 0 칸
 * @property {Object<string, number>} setCounts   세트 ID → 낀 조각 수
 * @property {number} sheetDps       기본 공격 DPS(조건부 제외 · 치명타 기대값 포함 · 저항 없는 대상) — §5.6
 * @property {number} ehp            유효 생명(레벨 = 해금 최고 균열의 몬스터 기준 · §5.6)
 */
```

StatKey → PlayerStats 대응: `freezeAt` → `freezeAtReduce`(점 그대로) · 그 밖은 같은 이름(퍼센트 키는 /100 · 고정값 키 `lifeRegen` · `lifeOnHit` · `thorns` · `rageOnHit` · `armor` · 저항 · 주 능력치 · `vit`은 그대로 — §5.6).

### 3.9 진행 · 보상 · 결과

```js
/** @typedef {{amount:number, level:number, xp:number, toNext:number|null, levels:number}} XpResult   levels = 이번에 오른 레벨 수 */
/** @typedef {Object} RunSummary
 * @property {number} level @property {number} seed @property {TilesetId} tileset @property {ClassId} cls
 * @property {'complete'|'collapse'|'abandon'} result
 * @property {number} timeSec       ticksIn / 30
 * @property {RunStats['kills']} kills @property {number} deaths
 * @property {Record<Rarity, number>} drops @property {number} gold @property {number} xp @property {number} upgrades
 * @property {number} recalls @property {number} maxTargeting @property {number} swarmMoments
 * @property {number} unlockedTo    완료 뒤 riftUnlocked(붕괴면 그대로)
 * @property {boolean} noDeath @property {boolean} record   이 레벨의 새 최고 기록
 */
/** @typedef {RunSummary & {at:number, charLevel:number}} RunRecord   at = 그때의 playSec */
/** @typedef {Object} RiftPreview   (균열석 패널 — §6.13 previewRift)
 * @property {number} level @property {number} monLevel @property {number} ilvl
 * @property {number} hpMul @property {number} dmgMul @property {number} goldMul @property {number} xpMul
 * @property {Record<'magic'|'rare'|'legendary'|'set', number>} rarityMul
 * @property {number} champAffixes @property {number} eliteAffixes
 * @property {{timeSec:number, deaths:number}|null} best
 * @property {boolean} unlocked
 */
/** @typedef {{ok:true}|{ok:false, reason:string, params?:Object}} Result */
/** @typedef {Object} DropRoll     (rollDrops의 결과 한 줄)
 * @property {DropKind} kind @property {Item|null} item @property {number} amount @property {MaterialId|null} mat
 */
```

### 3.10 sim 문맥 — `SimCtx` (P2 `createCtx` · 테스트는 `makeTestCtx`)

```js
/** @typedef {Object} SimCtx
 * @property {GameState} state
 * @property {MapData|null} map              지금 장면의 맵(마을이면 마을 맵)
 * @property {MapData|null} riftMap          열린 균열의 맵(마을에 있어도 남는다)
 * @property {FlowField|null} flow           균열에서만(P4) — 균열 장면이면 null이 아니다: createCtx · commitTravel(openRift · townPortal) · debugLoadState가 createFlow(ctx.map)로 만든다
 * @property {SpatialHash} space             깨어 있는 살아 있는 몬스터(틱마다 다시 만든다)
 * @property {number} monVer                몬스터 목록 판(addMonster · removeMarked가 +1 — getMonster 색인 무효화 · §6.4)
 * @property {PlayerStats} stats             refreshStats()가 다시 계산
 * @property {{combat:Rng, loot:Rng, ai:Rng, shop:Rng}} rng   state.rng.* 위의 Rng(§6.1)
 * @property {(name:string, payload?:Object) => void} emit     state.events에 쌓는다(§4.1)
 * @property {() => number} nextId
 * @property {() => string} newItemId        'i' + account.nextItemId++
 * @property {() => void} refreshStats       stats = computeStats(char, …) · player.lifeMax/resourceMax 갱신(비율 유지 아님 — 현재 값은 max로 자르기만) · STATS_CHANGED
 * @property {{onMonSpawn:(ctx, mon)=>void, onMonDamaged:(ctx, mon, hit:HitResult, spec:Object)=>void, onMonDeath:(ctx, mon)=>void,
 *             onMonHitPlayer:(ctx, mon, res:PlayerHitResult, spec:MonAttackSpec)=>void,
 *             onPlayerKill:(ctx, mon, lastHit:Object)=>void, onGlobe:(ctx)=>{mul:number, radiusAdd:number}, onPlayerDamaged:(ctx, dmg:number)=>void,
 *             onPlayerKilled:(ctx, killer:MonsterState|null)=>void}} hooks
 *           역방향 호출 표(§2.2 — 이 목록이 정본) — onMonSpawn · onMonDamaged · onMonDeath · onMonHitPlayer = P3(monsters.js) · onPlayerKill · onGlobe(globeMods) · onPlayerDamaged = P1 · onPlayerKilled = P2(rift.js killPlayer).
 *           onGlobe → {mul: 구슬 회복 배율(1 또는 전설 2), radiusAdd: 줍기 반경 + m(0 또는 전설 1.0)}
 * @property {Object} dev                    {ignoreReqLevel?:boolean} 개발용
 */
/** @typedef {Object} FlowField   (P4 — 상태 아님)
 * @property {Uint16Array} dist      nw×nh · 플레이어 칸까지 걸음 수(0xffff = 닿지 않음 · 범위 밖)
 * @property {number} cx @property {number} cz   기준 칸 @property {number} builtAt   틱
 */
```

### 3.11 저장 · 설정

```js
/** @typedef {Object} AccountSave
 * @property {number} v             SAVE_VERSION @property {'rift-hunter'} game @property {number} savedAt   ms(app)
 * @property {AccountState['chars']} chars @property {Array<Item|null>} stash @property {number} nextItemId @property {number} lastSlot
 */
/** @typedef {Object} CharSave
 * @property {number} v @property {'rift-hunter'} game @property {number} savedAt
 * @property {Omit<CharacterState, 'shop'> & {shop:{restocks:number, stockRun:number, blacksmith:Item[], general:Item[]}}} char
 *                                  재고는 저장한다(새로 고침으로 재고가 바뀌지 않게 · 불러올 때 sanitizeItem) · 재굴림 제안만 저장하지 않는다
 */
/** @typedef {Object} Settings
 * @property {number} volMaster @property {number} volSfx @property {number} volAmbient   0..1
 * @property {QualityId} quality
 * @property {boolean} damageNumbers @property {boolean} alwaysLabels @property {boolean} hideNormal
 * @property {boolean} advancedTooltips @property {boolean} meterHud @property {boolean} screenShake
 */
```

- 세이브 키: `rift-hunter:account` · `rift-hunter:char:<slot>`(0..3) · `rift-hunter:settings` · 백업 `rift-hunter:backup:<원래 키>:<ms>`(키마다 최신 3개). 균열 진행 · 플레이어 런타임(생명 · 위치) · 재굴림 제안은 저장하지 않는다(브리프 §3.1).

---

## §4 이벤트 카탈로그

### 4.1 버스 규칙

- 버스는 하나다: app이 `new EventBus()`를 만들어 sim · view · audio · ui에 넘긴다. 이름은 `core/events.js`의 `EV` 상수만 쓴다(문자열 리터럴 금지 — purity 테스트가 `'mon/died'` 같은 리터럴을 sim · view · ui에서 찾는다).
- **sim 이벤트는 큐에 쌓였다가 한꺼번에 발행된다.** sim 코드는 `bus.emit`을 부르지 않고 `ctx.emit(name, payload)`만 쓴다. `GameSim.step`의 마지막 단계와 `GameSim`의 **모든 공개 명령 메서드의 끝**에서 `state.events`를 순서대로 `bus.emit` 하고 비운다 → 구독자는 항상 **틱(명령)이 끝난 일관된 상태**를 본다.
- **플러시는 재진입에 안전하다**(리스너가 플러시 도중에 명령을 부르는 것은 정상 경로 — `INTERACT` → ui가 패널을 연다 → 패널이 `sim.sell()`):

  ```js
  _flush() {
    if (this._flushing) return;                // 안쪽 호출은 큐에 쌓기만 한다
    this._flushing = true;
    try {
      while (this.state.events.length) {
        const q = this.state.events; this.state.events = [];
        for (const e of q) this.bus.emit(e.name, e.payload);
      }
    } finally { this._flushing = false; }
  }
  ```
- sim 로직은 이벤트에 의존하지 않는다(이벤트는 표현용 알림이다). sim 안의 상호작용은 §6의 함수 호출과 `ctx.hooks`로만 한다.
- ui · app 이벤트는 즉시 발행한다.
- payload는 순수 객체. 위치는 `x`, `z`(m). 구독자는 payload를 고치지 않는다. 리스너 예외는 삼키지 않는다(테스트가 잡는다).
- **이벤트 누락에 안전**: view · ui · audio는 이벤트를 놓쳐도 다음 `update(state)`에서 상태를 보고 스스로 맞춘다(§9.1) — 이벤트는 「순간」(소리 · 섬광 · 숫자)에만 쓴다. 지속되는 것(예고 표식 · 상태 이상 · 버프 · 구슬)은 상태에서 그린다.
- 고빈도 이벤트(`HIT` · `MON_ACT` · `MON_STRIKE`)는 한 틱에 수십 개가 될 수 있다. 소비자(audio · ui의 피해 숫자)가 자기 상한을 둔다(§9.11 · §10.4).

### 4.2 sim 이벤트 (`ctx.emit` → 플러시)

| EV 키 | 문자열 | payload | 발행 | 주요 구독 |
|---|---|---|---|---|
| `CHAR_LOADED` | `char/loaded` | `{slot, cls, name, level, isNew}` | P2(`newCharacter` · `loadCharacter`) | view(플레이어 리그 교체) · ui(HUD 구성) · audio |
| `MAP_LOADED` | `map/loaded` | `{mapId, kind, tileset}` | P2(`commitTravel` · `debugLoadState`) — `SCENE_CHANGED`보다 먼저 | view(월드 · 인스턴스 다시 짓기) · ui(미니맵) · fx(정리) |
| `SCENE_CHANGED` | `scene/changed` | `{from:SceneId\|null, to, reason:Travel.reason\|'load'\|'fixture'}` | P2 | audio(환경음) · ui(HUD 모드 · 패널 닫기) · app(저장) |
| `TRAVEL_REQUEST` | `scene/travel` | `{to, reason}` | P2(`requestTravel`) | app(막 내리기 → `commitTravel` → 막 올리기 · §11.4) · 봇 하네스(즉시 commit) |
| `PLAYER_SPAWNED` | `player/spawned` | `{x, z, facing, reason:'scene'\|'respawn'\|'portal'\|'debug'}` | P2 | camera(보간 끊고 바로 그 자리 — 막 아래에서만 생긴다) · view |
| `INTERACT` | `world/interact` | `{kind:InteractKind, id}` | P1(도착) | ui(npc → 상점 패널 · stash → 보관함 · riftStone → 균열석) — 포털은 sim이 직접 처리한다(이벤트는 audio용으로만) |
| `HINT` | `hint/show` | `{id:HintId}` | P2 · P6(조건이 처음 참일 때 · `char.hints[id]`가 없을 때) | ui(안내 카드 — 본 뒤 `sim.markHint(id)`) |
| `ACTION_START` | `player/actionStart` | `{skillId, act, x, z, facing, tx, tz, dur, hitIn}` (dur · hitIn 초) | P1 | audio(휘두름 · 시전 시작) · fx(시전 빛) |
| `ACTION_HIT` | `player/actionHit` | `{skillId, x, z, facing, tx, tz, rank, transforms}` — **판정 틱** | P1 | audio(타격음) · fx(스킬 연출의 순간) |
| `SKILL_FAIL` | `skill/fail` | `{skillId, reason:'resource'\|'cooldown'\|'noTarget'\|'rooted'\|'town'\|'empty'}` — 같은 (skillId, reason)은 0.5초에 한 번 | P1 | ui(구슬 깜빡 — 섬광 아님 · 짧은 알림) · audio(마른 소리) |
| `CHANNEL` | `skill/channel` | `{skillId, on}` | P1 | audio(회오리 지속음) · fx |
| `POTION` | `player/potion` | `{heal, left}` · 실패면 `POTION_FAIL` `player/potionFail` `{reason:'empty'\|'cooldown'\|'full'}` | P1 | ui · audio |
| `RECALL` | `player/recall` | `{phase:'start'\|'cancel'\|'done', reason?:'damage'\|'action'\|'scene', sec}` | P1 | ui(시전 바) · audio · fx |
| `BUFF` | `player/buff` | `{id, on, sec, value}` | P1(시전 — `on:true`) · P2(끝남 — 만료 · `removeBuff`만 `on:false` · `addBuff`는 내지 않는다 · W1 확정) | fx(오라 · 보호막 구체) · ui(버프 아이콘) · audio |
| `PLAYER_HIT` | `player/hit` | `{amount, absorbed, blocked, type, via, srcId, x, z, life, lifeMax}` | P2 | ui(생명 구슬 흔들림 · 붉은 테두리 0.15초 — 화면을 덮지 않는다) · audio · fx |
| `PLAYER_HEAL` | `player/heal` | `{amount, source:'potion'\|'globe'\|'skill'\|'legend'}` (적중 회복은 싣지 않는다) | P2 | ui(+n 녹색) · audio · fx |
| `PLAYER_STATUS` | `player/status` | `{kind:'slow'\|'root', on, sec}` | P2 | ui · fx(발밑 쇠사슬 · 서리) · audio |
| `SHIELD` | `player/shield` | `{amount, max, broken}` | P2 | fx(구체 투명도) · audio(깨짐) |
| `LOW_LIFE` | `player/lowLife` | `{on}` (생명 ≤ 35% 진입 · 이탈) | P2 | ui(구슬 맥동) · audio(심장 박동) |
| `PLAYER_DIED` | `player/died` | `{x, z, lives, collapse, killerId, killerName:string[]\|null, killerTypeId}` | P2 | ui(DEATH.panelDelay 뒤 사망 패널) · view(쓰러짐) · audio |
| `HIT` | `combat/hit` | `{targetId, x, z, amount, type, crit, killed, immune, blocked, dot, skillId, big}` (big = 대상 최대 생명의 25% 이상 · 또는 챔피언 이상 처치) | P2 | ui(피해 숫자 — 설정) · fx(종류별 불꽃) · audio(맞는 소리 — 상한) |
| `HITSTOP` | `fx/hitstop` | `{sec}` (COMBAT.hitstop 규칙 — §5.12) | P2 | app(그 실제 시간 동안 step을 멈추고 렌더만) |
| `SHAKE` | `fx/shake` | `{amp:0..1, sec}` | P1(스킬) · P2(효과 판정 — 효과 `spec.shake`가 있으면 hitAt에 한 번 · 수호자 기술 · 지진 · 메테오 · 여진도 이 길로 · P3는 직접 내지 않는다 · W1 확정) | camera(설정이 켜져 있을 때 · 진폭 상한 §9.3) |
| `MON_SPAWNED` | `mon/spawned` | `{id, typeId, rank, x, z, reason:'nest'\|'revive'\|'split'\|'summon'\|'guardian'\|'debug'}` (균열을 채울 때는 내지 않는다) | P3 | view(솟아오름) · fx · audio |
| `MON_WAKE` | `mon/wake` | `{packId, kind, x, z, count}` (팩 단위) | P3 | audio(울음 · 정예는 경보음) |
| `MON_ACT` | `mon/act` | `{id, typeId, act, actId, telegraph, x, z, facing, dur}` (예고 시작 — windup · cast · charge · swell) | P3 | audio(예고 소리) · fx(발광 예고) |
| `MON_STRIKE` | `mon/strike` | `{id, actId, x, z, facing}` (판정 틱) | P3 | audio(휘두름) · fx |
| `MON_STATUS` | `mon/status` | `{id, kind:'stun'\|'freeze'\|'burn'\|'shock'\|'flinch', on}` | P2 | fx · audio(얼음 깨짐) |
| `MON_DIED` | `mon/died` | `{id, typeId, rank, x, z, facing, launch:{x,z}\|null, byPlayer, elite}` (elite = 챔피언 이상) | P2 | view(쓰러짐 · 날아감) · fx(먼지 · 뼈) · audio · ui(대상 프레임) |
| `AFFIX` | `affix/fx` | `{monId, affixId, what, x, z}` · what ∈ `teleportOut teleportIn shieldWarn shieldOn shieldOff split sparks novaWarn jailWarn plagueWarn mortarFire fireArm heal` (W2 확정: `jailWarn` · `plagueWarn` · `mortarFire`의 x, z = 시전한 몬스터 자리 · 잿빛 마녀 순간이동은 `MON_ACT{actId:'blink'}`와 함께 연출용 `teleportOut`(떠난 자리) · `teleportIn`(도착 자리)을 `affixId: null`로 낸다 — 구독자는 `affixId`에 기대지 않는다) | P3 · P16 | audio(예고음 — 감옥 · 몰타르 · 보호막 · 냉기 노바는 고유) · fx |
| `PROJ_SPAWN` | `proj/spawn` | `{id, visual, owner, x, z, vx, vz}` | P2 | audio(발사음) |
| `PROJ_END` | `proj/end` | `{id, visual, x, z, reason:'hit'\|'wall'\|'expire'\|'cancel'}`(cancel = 사망 · 정리로 지움 — §5.14) | P2 | fx(터짐) · audio |
| `EFFECT_SPAWN` | `effect/spawn` | `{id, kind, hostile, shape, sec, dur}` (sec = 예고 길이 · dur = 지속) | P2 | audio(예고음) · fx(표식은 상태에서 그린다 — 이벤트는 등장 소리용) |
| `EFFECT_HIT` | `effect/hit` | `{id, kind, hostile, shape, hitPlayer, targets}` | P2 | fx(폭발) · audio(쾅) |
| `RIFT_OPENED` | `rift/opened` | `{level, seed, tileset, lives}` | P2 | ui(배너) · audio |
| `GAUGE` | `rift/gauge` | `{gauge, delta}` (처치로 오를 때만) | P2 | ui |
| `GAUGE_FULL` | `rift/gaugeFull` | `{x, z, sec}` (수호자가 나타날 자리 · 예고 길이) | P2 | ui(「균열 수호자가 나타난다」) · audio · fx |
| `GUARDIAN_APPEAR` | `rift/guardian` | `{id, typeId, x, z, name:string[]}` | P2 | ui(상단 대형 체력 바) · audio — (W1 수정 4) 출현 예고 중 사망 뒤 부활하면 부활 commit의 플러시(`SCENE_CHANGED{to:'town'}`과 같은 플러시)에서 난다 · 소비자는 `state.scene === 'rift'`일 때만 바 · 출현 소리를 낸다(마을에서 보스 바 · 소리 금지) |
| `RIFT_COMPLETE` | `rift/complete` | `{summary:RunSummary}` (수호자 처치 RIFT.completeDelay 뒤) | P2 | ui(균열 완료 패널) · audio(팡파르) |
| `RIFT_COLLAPSE` | `rift/collapse` | `{summary}` | P2 | ui(사망 패널 문구) · audio |
| `RIFT_CLOSED` | `rift/closed` | `{reason:'collapse'\|'newRift'\|'quit'\|'debug'}` | P2 | view(균열 맵 캐시 버림) · ui |
| `LIVES` | `rift/lives` | `{lives}` | P2 | ui |
| `PORTAL_OPENED` | `rift/portalOpen` | `{id, kind, x, z}` · `PORTAL_CLOSED` `rift/portalClose` `{id}` | P2 | view(포털 틀) · fx(소용돌이) · audio |
| `DROP_SPAWN` | `drop/spawn` | `{id, kind, rarity, x, z, fromX, fromZ}` | P2 | view(튀어나오는 호) · ui(이름표) · audio(등급별 — 전설 · 세트는 고유 종소리) |
| `DROP_PICKED` | `drop/picked` | `{id, kind, amount, itemId, rarity}` | P2 | audio(골드 짤랑) · ui |
| `PICKUP_FAIL` | `drop/pickupFail` | `{id, reason:'bagFull'\|'full'}` (`full` = 포션 상한에서 포션을 클릭해 주움 · W1 확정) | P2 | ui(「가방이 가득 찼다」 — 1초에 한 번) · audio |
| `GOLD` | `econ/gold` | `{gold, delta, reason}` (reason ∈ pickup sell buy buyback repair gamble reroll craft reset free grant) | P6 | ui(±n) |
| `MATERIALS` | `econ/materials` | `{materials, delta, reason}` | P6 | ui |
| `BAG` | `inv/bag` | `{reason}` (pickup equip unequip sell buy buyback salvage craft gamble move sort stash reroll grant) | P6 | ui(가방 · 보관함 다시 그림) |
| `EQUIPPED` | `inv/equipped` | `{slot, itemId, baseId, tier, rarity}` (벗으면 itemId · baseId null) | P6 | view(리그 무기 · 갑옷 외형) · ui · audio |
| `DURABILITY` | `inv/durability` | `{broken:EquipSlot[], fraction}` (사망 대가 뒤 · W1 확정: `broken` = 대가 뒤 내구도 0인 장착 칸 **전부** · `fraction` = 이번에 깎인 비율 `deathDurLoss / durMax`) | P6 | ui(경고 아이콘 · 알림) |
| `TRADE` | `shop/trade` | `{shop, kind, cost, itemId, rarity}` | P6 | audio · ui |
| `XP` | `prog/xp` | `{amount, level, xp, toNext}` (캡이면 toNext **null**) | P6 | ui(경험치 바) |
| `LEVEL_UP` | `prog/levelUp` | `{level, points}` (points = 남은 스킬 포인트) | P6 | ui(배너 · 스킬 버튼 표시) · audio · fx |
| `SKILLS` | `prog/skills` | `{reason:'learn'\|'reset'\|'bar', nodeId, rank}` | P6 | ui |
| `STATS_CHANGED` | `prog/stats` | `{sheetDps, lifeMax, armor}` | P2(`refreshStats`) | ui(시트 · 툴팁 비교 기준) |
| `UNLOCK` | `prog/unlock` | `{riftUnlocked, from}` | P6 | ui(알림) |
| `SAVE_REQUEST` | `save/request` | `{scope:'char'\|'account'\|'all', reason}` | P2 · P6(아래) | app(그 프레임 끝에 한 번 저장 — §11.6) |

발행 위치: P6 함수가 내는 이벤트(`GOLD` · `MATERIALS` · `BAG` · `EQUIPPED` · `DURABILITY` · `TRADE` · `XP` · `LEVEL_UP` · `SKILLS` · `UNLOCK`)는 P6 함수가 `ctx.emit`으로 직접 낸다(부르는 P1 · P2가 다시 내지 않는다). 골드 · 재료 · 포션 · 두루마리를 더하는 곳(줍기 · 디버그 · 보상 · 거래)은 P6 `addGold` · `addMaterials` · `addConsumable`만 쓴다 — `char.gold` · `materials` · `potions` · `scrolls`를 직접 고치는 곳은 P6 파일뿐이다(§6.11). `SAVE_REQUEST`는 그 일을 끝낸 쪽이 낸다 — P6: 장착 · 거래(사기 · 도박 · 재굴림 · 제작은 reason `'trade'`) · 스킬 · 레벨업 · 경험치(`'xp'` — 1초 묶음) · 보관(`scope` = 보관함이 바뀌면 `'all'`, 아니면 `'char'`) / P2: 줍기(`'char'`) · 장면 전환 · 균열 완료/붕괴 · 사망(`'char'`) · 캐릭터 생성/삭제(`'all'`) · `unloadCharacter`(`'all'` · `'quit'`) · 안내 카드(`markHint`).

`HintId`(발행 조건 · 보이는 꼴 — §10.2 `hint` · §10.6): `town`(새 캐릭터가 처음 마을에 섰을 때 — `newCharacter` · 또는 균열에서 처음 돌아왔을 때 · **모달 카드**) · `controls`(첫 균열 진입 · **모달 카드**) · `labels`(첫 장비 드랍) · `elites`(첫 챔피언 · 정예가 깸) · `bagFull`(첫 가방 가득) · `death`(첫 사망) · `skills`(첫 레벨업) · `gauge`(첫 게이지 100%) — 뒤의 여섯은 **비모달 안내**(게임을 멈추지 않는다).

### 4.3 ui · app 이벤트 (즉시)

| EV 키 | 문자열 | payload | 발행 | 구독 |
|---|---|---|---|---|
| `PANEL_OPENED` | `ui/opened` | `{panel:PanelId, modal, depth}` | P10(UIRoot) | app(입력 차단 · step 멈춤 규칙 §11.3) · audio(UI음) |
| `PANEL_CLOSED` | `ui/closed` | `{panel, depth, by:'esc'\|'key'\|'confirm'\|'pointer'\|'code'}` (depth = 닫은 뒤 남은 깊이) | P10 | app · audio |
| `SCREEN_CHANGED` | `app/screen` | `{from, to}` | P9 | ui · audio |
| `PAUSED` | `app/paused` | `{on, reason:'menu'\|'modal'\|'blur'\|'hidden'\|'debug'\|'context'}` | P9 | audio(멈춤) · ui |
| `SETTINGS_CHANGED` | `app/settings` | `{settings}` | P9 | renderer(화질) · camera(흔들림) · audio(볼륨) · ui(이름표 · 숫자 · 계측 HUD) |
| `AUDIO_UNLOCKED` | `app/audioUnlocked` | `{}` | P9 | ui(소리 안내 지우기) |
| `FADE` | `app/fade` | `{phase:'out'\|'in', sec}` | P9 | ui(전환 막 — 검은 막 · CSS 불투명도) |
| `LABELS` | `app/labels` | `{on}` (Alt 누름/뗌 — 설정 「늘 이름표」와 OR) | P9 | ui(바닥 이름표 · 고급 툴팁) |
| `BOT` | `app/bot` | `{on}` | P9 | ui(봇 탭 · 「봇 관전 중」 배지 · 켜져 있는 동안 자동 패널을 열지 않는다 — §11.13) |

- **W2 확정 — `PAUSED.reason`**: `menu` = 맨 위 패널이 `pause` · `settings` · `help` · `modal` = 그 밖의 모달(상점 · 사망 · 완료 · 안내 · 확인 · 분석 …) · `blur` · `hidden` · `debug` · `context`. 전환 막 · 히트스톱 · 마을에서 겹쳐 보는 패널로 step하지 않는 것은 일시정지가 아니다(PAUSED를 내지 않는다). audio는 `menu`·`modal`·`blur`·`debug`·`context`에서 전투 지속음만 멈추고 환경음을 줄인다(UI · 거래음은 난다) · 탭 숨김은 app이 `audio.setPaused(true)`를 직접 부른다(컨텍스트 suspend).

---

## §5 틱 순서 · 조작 · 전투 규칙 · 시간 처리 · 렌더 보간

### 5.1 `GameSim.step(input)` — 이 순서 그대로 (P2)

0. `state.tick += 1`. `pendingTravel`이 있거나 `char === null`이면 여기서 플러시하고 끝(§5.11).
1. `char.playSec += DT` · (피드백 2 D4) `char.bag.length > BAG_SIZE` 면 `settleBag(char)`(넘친 가방 — 칸 안이 비었으면 칸 밖 아이템을 당긴다 · 이벤트 없음 · 격자는 매 프레임 칸 참조를 비교한다 §10.6). 보간용 직전 값: `player.prevPos ← pos` · `rift.mons` 전부(잠든 것 · 시체 포함 — 마지막으로 움직인 뒤 떨리지 않게)와 투사체의 `prevPos ← pos`(값 두 개 복사).
2. **마을**(`scene === 'town'`): `updatePlayer(ctx, input)`(P1 — 이동 · 상호작용만. 스킬 입력은 `SKILL_FAIL{reason:'town'}` · 포션은 정상 · T는 「이미 마을이다」 `SKILL_FAIL{skillId:'recall', reason:'town'}`) → `updateTown(ctx)`(P2) → 7로.
3. **균열 준비**: `rift.ticksIn += 1` → `rebuildSpace(ctx)`(깨어 있고 살아 있는 몬스터를 `ctx.space`에) → `updateFlow(ctx.flow, ctx.map, player.pos, tick)`(P4 — §6.6의 갱신 조건).
4. **플레이어**: `updatePlayer(ctx, input)`(P1) — 대상 검사 → 행동 진행(판정 틱이면 스킬 동작의 `hit` — §5.4 · `tick ≥ actEnd`면 idle — **잠김이 풀린 첫 틱 = actEnd 틱**) → 입력 해석(§5.2) → 선입력 실행(§5.3) → 채널 틱 → 이동(경로 · 밀림 · 돌진 · 도약 · 회오리) → 자원 재생/감소 · 포션 · 귀환 진행(§5.5) → 도착 처리(줍기 · 상호작용).
5. **몬스터**: `updateMonsters(ctx)`(P3 — §5.17).
6. **세계**: `updateProjectiles(ctx)` → `updateEffects(ctx)` → `tickBurns(ctx)`(P2 `combat.js` — 화상 틱) → `updateStatus(ctx)`(P2 — 냉기 감소 · 빙결/기절/감속/넉백 면역 만료 · 플레이어 버프 · 감속/속박/밀림 만료 · 생명 재생 · 저생명 플래그).
7. **정리 · 진행**(균열만): `resolveDeaths(ctx)`(P2 — 생명 ≤ 0인 몬스터를 처리 §5.10) → `updatePickups(ctx)`(자동 줍기) → `updateRift(ctx)`(게이지 · 수호자 출현 · 완료 요약 · 탐색 · 안전 지점 · 진정) → `updateMeter(ctx)` → `cleanup(ctx)`(→ `removeMarked(ctx)`(P0) — `gone` 몬스터 · 시체 `DEATH.corpseSec` 지난 몬스터 · `until ≤ tick` 투사체 · `end ≤ tick` 효과 · `gone` 드랍을 배열에서 실제로 뺀다 · 팩 목록 정리 — 배열에서 빼는 곳은 여기뿐이다 §5.14).
8. 플러시(§4.1).

명령 메서드(`equip` · `sell` · `openRift` …)는 틱 밖에서 불린다(ui · 봇 · app). 각 명령은 상태를 바꾸고 끝에서 플러시한다. 모달 패널 · 일시정지 · 전환 막 동안 app은 `step`을 부르지 않는다(§5.12) — 그래서 명령과 틱이 섞이지 않는다.

### 5.2 클릭 해석 — `controller.js` (P1 · 브리프 §3.2 · Q1 A)

1. **대상 검사**(매 틱 맨 앞): `input.hover`를 받아 — monster면 그 몬스터가 있고 살아 있고(`gone` 아님) `cursor`가 몬스터 중심에서 `mon.r + PICKUP.validate(1.5m) + PICKUP.validateH(0.75) × mon.height` 안(앙각 55°에서 높이 h를 누르면 바닥 점이 카메라 쪽으로 0.70h 밀린다 — 뼈 거인의 머리를 눌러도 통과) · drop이면 있고, `src === 'label'`이면 플레이어에서 `PICKUP.labelReach`(20m) 안(이름표는 쌓여서 아래로 밀린다 — 커서 거리 검사 없음), 그 밖에는 `cursor`에서 1.5m 안 · object면 `getObject`로 찾고(마을 물체 · 균열 포털) `cursor`에서 `r + PICKUP.validate + PICKUP.validateH × h` 안일 때만 `player.hover`에 넣는다. 아니면 null. (봇이 화면에 없는 것을 클릭하지 못하게 하는 규칙이기도 하다 — 봇의 hover는 `src:'pick'`.)
2. **좌클릭 누름(`lmbDown`)** — 그 틱의 대상으로 의도를 정한다:
   - `shift` → `{kind:'standAttack', held:true}`(제자리 · 커서 방향 기본 공격).
   - hover monster → `{kind:'attack', targetId, held:true}`.
   - hover drop → `{kind:'pickup', targetId: dropId}`(골드 · 포션 · 구슬 · 재료도 클릭하면 걸어가서 줍는다).
   - hover object → `{kind:'interact', objectId}`.
   - 그 밖에 `cursor` → `{kind:'move', point: cursor, follow:true, held:true}` → `path = findPath(map, pos, cursor, {r: player.r})`. 막힌 곳이면 `findPath`가 가장 가까운 닿는 점까지의 경로를 준다(§6.6). 경로가 없으면(같은 칸 등) 의도만 남고 서 있다.
   - 행동 중(잠김 — §5.3)이면 선입력으로 넣는다.
3. **좌클릭 유지(`lmb` · `intent.held`)**:
   - move-follow: `ticks(PLAYER.repathSec 0.2)`(6틱)마다, 커서가 마지막 목표에서 `PLAYER.repathDist`(0.75m) 넘게 움직였으면 다시 경로. `cursor === null`이면 경로를 비우고 멈춘다(브리프 §6).
   - attack: 대상이 죽었거나 없어졌으면 다시 정한다 — hover가 몬스터면 그것을 공격, 아니면 move-follow로 바뀐다(떼 속에서 누르고 있으면 계속 싸운다).
   - standAttack: 누르고 있는 동안 커서 방향으로 계속 기본 공격.
4. **좌클릭 뗌**: `held = false`. move는 마지막 목적지까지 계속 간다. attack은 지금 휘두름을 끝내고 멈춘다(새 휘두름 없음). standAttack도 같다.
5. **공격 의도 실행**(행동 가능할 때): 근접(전사)은 중심 거리 ≤ `player.r + mon.r + bash.reach`면 기본 공격 시작, 아니면 대상 쪽으로 경로(대상이 1m 넘게 움직이면 6틱마다 다시). 원거리(마법사)는 거리 ≤ `magicBolt.range`이고 시야(`nav.losClear(…, {props:true})` — 막는 소품까지 · 투사체가 소품에서 끝나므로 · W1 확정)가 트이면 시작, 아니면 다가간다. 연쇄 번개의 대상 시야도 같다.
6. **스킬 칸**(`slot` · `slotDown`): 칸 i의 스킬 = `char.skills.bar[i]`. 누름 에지이거나 누르고 있고 행동 가능하면 시전을 시도한다(누르고 있으면 가능해질 때마다 반복 — 장르 표준). 목표 지점 = `cursor`(null이면 facing 앞 3m), 대상 = hover 몬스터. 빈 칸이면 `SKILL_FAIL{skillId:null, reason:'empty'}`. 채널(회오리)은 누르고 있는 동안 유지, 떼면 끝.
   - 한 틱에 시작하는 행동은 하나다. 우선순위: 스킬 칸(낮은 인덱스 먼저) > 좌클릭.
   - 스킬을 쓰면 이동 경로는 비운다 — 단 좌클릭이 눌려 있는 move-follow면 행동이 끝난 뒤 이어서 따라간다.
7. **포션**(`potionDown`)은 행동과 별개로 같은 틱에 된다(§5.5). **귀환**(`recallDown`)은 행동 가능할 때 시작하고, 행동 중이면 선입력(`kind:'recall'`이 아니라 행동이 끝난 첫 틱에 시작 — 아래 버퍼 규칙과 같다).
8. **이동**: 경로를 `stats.moveSpeed × (1 − st.slowPct)`로 따라간다(속박 중이면 0 · `player.knock`이 남아 있으면 경로 이동 대신 밀림 — §5.6). 경유점 도착 반경 0.15m. 벽과는 `nav.moveCircle`(미끄러짐). **플레이어 ↔ 몬스터 겹침은 여기서만 푼다**: 상대가 rank `normal` · `minion` · `split` · `spawn`이면 플레이어는 멈추지 않고 그 몬스터를 이동 방향으로 겹친 만큼 민다(그 몬스터에 `nav.moveCircle` · 미는 동안 플레이어 이동 × `PLAYER.shoveMul` 0.6 — 떼에 둘러싸여도 걸어서 빠져나와 폭발 · 감옥 · 역병을 피할 수 있다) · `champion` · `elite` · `guardian`과 태그 `structure`는 막는다(플레이어가 그 원에서 밀려 나온다 — 떼에 정예가 섞이면 갇힐 수 있다 · 장르의 긴장). 돌진 · 도약 · 순간이동 · 회오리 중에는 몬스터를 통과한다.
9. **도착**: pickup은 드랍에서 `PICKUP.itemReach`(1.0m) 안이면 `pickupDrop(ctx, drop)`(P2) — 장비는 `addToBag`, 실패면 `PICKUP_FAIL`(드랍은 그대로). interact는 물체 중심에서 `obj.r + PICKUP.interactReach`(0.8m) 안이면: npc · stash · riftStone → `INTERACT`(ui가 패널을 연다) · townPortal → `requestReturnToRift(ctx)`(P2 `rift.js`) · riftPortal(`portalKind` recall · exit) → 마을로(`requestTravel` reason `'riftPortal'` · `'exit'` — exit이면 먼저 `rift.returnPos = player.pos`).
10. **facing**: 이동 중에는 이동 방향으로 `PLAYER.turnRate`(18 rad/s)로 돈다. 행동을 시작하면 목표 방향으로 **즉시** 맞춘다(원뿔 · 투사체 방향은 그 facing).

### 5.3 행동 단계와 선입력 (P1 — QUALITY §1)

- 행동 = `{act, actSkill, actStart, actHit, actEnd}`. `[actStart, actHit)` 예비(잠김) → **`actHit` 틱에 판정**(스킬 동작의 `hit` · `ACTION_HIT`) → `[actHit, actEnd)` 후딜(잠김) → `actEnd` 틱에 `idle`(경로가 있으면 `move`).
- **행동 가능** = `act ∈ {idle, move}` · 살아 있음 · 속박이면 이동 스킬만 불가. 귀환 시전 중(`recall`)은 새 입력이 오면 귀환을 취소하고(`RECALL cancel 'action'`) 그 입력을 처리한다. **채널(`channel` — 회오리) 중** 다른 칸의 `slotDown` · `lmbDown` · `recallDown`은 그 틱에 채널을 끝내고(후딜 없이 · `CHANNEL{on:false}`) 같은 틱에 그 입력을 행동 가능 상태로 처리한다(장르 표준 — 회오리 중 누른 돌진이 바로 나간다). 채널 키를 떼면 `endRecover`(0.15초) 후딜이고 그 사이 입력은 버퍼로.
- 길이: 기본 공격 = `1 / aps_eff`초(`aps_eff` = `stats.aps` × (1 + 조건부 공격 속도 — 광전사)), 판정 = 시작 + 길이 × `hitFrac`. 스킬 = `action × (scaled ? APS_REF / aps_eff : 1)`. 틱 변환은 `ticks()` — 판정 틱은 최소 시작 + 1틱, 끝 틱은 최소 판정 + 1틱.
- **선입력 버퍼**(`player.buffer` — 하나 · 새 입력이 덮어쓴다): 잠긴 동안 들어온 `slotDown` · `lmbDown` · `recallDown`을 `{kind, slot, skillId, point, targetId, stand, until}`로 둔다. `until = max(tick + ticks(BUFFER.sec 0.5), actEnd + ticks(BUFFER.tail 0.1))` — **창은 잠김이 끝나기까지 남은 시간보다 늘 길다**(actEnd가 미리 정해지지 않은 행동 — `channel` · `recall` — 이면 `until = tick + ticks(BUFFER.sec)`). 잠김이 풀린 첫 틱(= `actEnd` 틱 — §5.1-4)에 실행한다: 목표 지점은 그때의 `cursor`(null이면 저장한 점), 대상은 저장한 ID가 살아 있으면 그것.
- 누르고 있는 키는 버퍼가 필요 없다 — 풀린 첫 틱에 반복 규칙으로 나간다.
- **잠김 밖의 곧 풀릴 불가 상태도 버퍼에 넣는다**(QUALITY §1): 쿨다운 남은 시간 ≤ `BUFFER.sec`인 스킬 · 속박 남은 시간 ≤ `BUFFER.sec`인 이동 스킬의 누름은 `SKILL_FAIL` 대신 버퍼(`until = 풀리는 틱 + ticks(BUFFER.tail)`)에 넣고 풀린 첫 틱에 실행한다(그보다 길면 바로 `SKILL_FAIL`). 포션도 같다 — 쿨다운 남은 ≤ `BUFFER.sec`이면 `player.potionQueuedUntil = potionReadyAt + ticks(BUFFER.tail)`에 두고 `potionReadyAt` 틱에 마신다(그때 생명이 가득이면 `POTION_FAIL full`).
- 실패(자원 · 쿨다운)는 버퍼에서 실행할 때 판정한다(그때 `SKILL_FAIL`).

### 5.4 스킬 동작 (P1 · 수치는 §7.2)

| 동작(`behavior`) | 시작 | 판정(`actHit`) | 메모 |
|---|---|---|---|
| `cleave`(가르기 · **피드백 1** — 옛 `meleeBasic` 강타) | 대상(또는 제자리면 커서 방향) 쪽으로 facing(행동 내내 그대로) | 판정 틱에 플레이어 중심 부채꼴(반지름 = 몸 r + `reach` + `PLAYER.reachTolerance` = 0.4 + 1.2 + 0.3 = **1.9m** · 전체 각 `angleDeg` **180°** · 방향 = facing)과 몸이 겹치는 살아 있는 몬스터 **모두**(`playerHitShape` — 가까운 순) · 대상 고정: 대상이 부채꼴 밖으로 비켜도 중심 거리 ≤ 1.9 + mon.r 이면 맞는다 · 태그 [melee](aoe 아님 — 방패 해골 정면 막기 · `aoePct` 안 걸림) | 분노 생성(§5.5 — 맞힌 수 n 이면 onBasicHit 8 + min(3, n − 1)) · 연출 `params.swing`(§9.6) |
| `boltBasic`(마력 화살) | facing → 대상/커서 | 투사체 발사(§7.2) | 비용 0 |
| `spinSlash`(회전 베기 · **피드백 1** — 옛 `cone` 지면 강타) | facing → 커서(act `attack` — 무기 동작) | 판정 틱에 플레이어 중심 원 **r 2.5 · 360°** 안 모두 · 넉백 `status.knock` 0.8m(플레이어 → 몬스터 바깥쪽 · 기절 없음 — 경직은 큰 적중의 flinch §5.8) · 흔들림 없음 | 변형 「연속 회전」(키 `aftershock` 그대로): 판정 0.5초 뒤 **그때의 플레이어 자리**에서 60% 한 번 더(플레이어 소유 효과 `spinEcho` · 원 r 2.5 · `follow:'player'` — 판정 전까지 매 틱 중심이 플레이어를 따라간다 · 예고 없이 판정만 · 파생 적중이라 넉백 없음). 전설 「진동 주먹」 `shockwave`: facing 으로 선(len 10 · 폭 2.0) |
| `quake`(지진) | 제자리 | 시전 자리 중심 원 6.0m · 파동 3번(+0.4 · +0.9 · +1.4초 — 플레이어 소유 효과 `quakeWave` 셋, 비적대 예고 고리) | 파동마다 흔들림 0.35 |
| `dash`(돌진) | 목표 = 커서(2~10m로 자름 · 벽 앞에서 멈춤) · act `dash` · `air{kind:'dash'}` | 매 틱 `pos`가 `speed × DT`만큼 목표로 간다 · 그 틱의 이동 선분(폭 1.6m)과 겹치는 모든 몬스터 중 이번 돌진에서 아직 맞지 않은 것(`player.sk.hitIds`) 각각 한 번 적중(대상 상한 없음 · 적중 수 `player.sk.hits`) · 옆으로 밀침(§0.2 오른쪽 벡터 — 각 몬스터가 선의 어느 쪽인지로 부호) | 판정 틱 = 시작 + 1틱 · 끝 = 도착 + 0.1초. 분노 +10 |
| `spin`(회오리) | 채널 시작(시작 비용 10) | 채널 틱마다 원 2.4m 적중(틱마다 새 actionId — §5.6) · 커서 쪽으로 이동 속도 × 0.7 직진(벽 미끄러짐 · 몬스터 통과) | 유지 비용/초 · 떼거나 분노가 모자라면 끝 → 후딜 0.15초 · 다른 입력은 채널을 끊고 바로 나간다(§5.3). 변형 「피의 회오리」 적중당 회복 |
| `buff`(전투 함성 · 마력 보호막은 `shield`) | 제자리 | 버프 · 자원 생성 | 행동 길이 고정 |
| `leap`(도약) | 목표 = 커서(2~9m · 가장 가까운 걷기 가능 점 · 시작점에서 목표까지 **벽 타일**이 막으면 그 앞) · act `leap` · `air{kind:'leap'}` | 착지(시작 + 0.55초): 원 3.5m 적중 · 감속 40% 2초 · 흔들림 | **sim 위치**: [시작, +0.10) 출발점 · [+0.10, +0.45] 출발 → 목표 선형 보간(매 틱 `pos` · 몬스터 몸 무시) · +0.45 뒤 목표. **공중 무적**: 시작 + 0.10 ~ 0.45초(`invulnUntil`) — 무적이 끝나는 틱에 몸은 이미 도착점에 있다(이동 스킬로 바닥 표식을 피하는 수단 · 착지 판정은 목표에서). 변형 「진동 착지」 기절 1.2초 |
| `fireball`(화염구) | facing → 커서 | 투사체 발사 — 첫 몬스터 · 벽 · 사거리 끝에서 폭발 원 2.5m | 변형 「분열 화염구」 ±15° 셋 · 70%. 전설 「꿰뚫는 화염」 관통 3 |
| `meteor`(메테오) | 목표 = 커서(18m로 자름) · **피드백 2 D8**: 플레이어 → 목표 선분이 벽 타일(`losClear` — 소품은 보지 않는다)에 막히면 그 선 위의 마지막 보이는 점에서 `COMBAT.sightBack`(0.3m) 플레이어 쪽(`sightClip(map, ax, az, bx, bz, back)` — `sim/player/skills.js` export · 벽 너머(시야 밖)에 떨어지지 않는다 · QUALITY §2 「안전 지대 없음」) | 플레이어 소유 효과 `meteor` 하나(delay 1.2 · dur 3 · tick 0.5 · 원 3.5m · `spec` = 충돌 · `tickSpec` = 불타는 바닥 — 같은 원) | 전설 「잿빛 왕관」 작은 메테오 둘(**피드백 2 D8** — 각 점도 플레이어 자리에서 가려지면 같은 규칙으로 자른다) |
| `nova`(서리 노바) | 제자리 | 원 5.0m 적중 · 냉기 점수 | 변형 「얼음 파편」 8발 투사체(관통) |
| `shield`(마력 보호막) | 제자리 | `player.shield` = 생명 최대 × 비율 · 버프 6초 | 다시 쓰면 갱신(합치지 않는다) |
| `chain`(연쇄 번개) | 첫 대상 = hover 몬스터(15m · 시야) → 없으면 커서에서 4m 안 · 플레이어에서 15m 안의 가장 가까운 몬스터 → 없으면 `SKILL_FAIL noTarget`(비용 없음) | 첫 대상 적중 → 튕김(6m 안 가장 가까운 · 맞지 않은 것) × 튕김 수 · 튕길 때마다 ×0.9 · 꺾은선 효과 `chainArc`(0.2초) | 감전 확률 |
| `blink`(순간이동) | 목표 = 커서(12m로 자름 · 가장 가까운 걷기 가능 점 · 벽을 건넌다) | 시작 + 0.15초에 위치 이동 | 변형 「번개 잔상」 출발 · 도착 폭발. 전설 「서리 걸음」 도착 서리 노바 |

- 스킬 동작은 `SKILL_BEHAVIORS[behavior] = {start(ctx, node, rank, cast) → boolean, hit(ctx, node, rank, cast), tick?(ctx, …), end?(ctx, …)}` 표 하나다(§8.4). 변형 · 전설은 `skillParams(ctx, nodeId)`가 **데이터의 패치를 params에 합친 값**으로만 동작에 닿는다(§8.4 · §8.5) — 동작 · 실행부에 노드 · 전설 ID 분기가 없다.
- 행동을 시작할 때 `player.sk = {hitIds:[], hits:0, nextAt:-1}`로 새로 만든다 — 동작이 여러 틱에 걸쳐 기억할 값(돌진의 맞은 ID · 분노의 뿔 적중 수 · 불타는 소용돌이 타이머)은 여기에 둔다.
- **플레이어 소유 효과**(`hostile:false`)는 몬스터만 다치게 한다. 예고 고리는 흰/주황/파랑(§9.8)이라 적의 붉은 표식과 섞이지 않는다.

### 5.5 자원 · 쿨다운 · 포션 · 귀환 (P1)

- **분노(전사)**: 기본 공격이 하나 이상 맞으면 `+onBasicHit(8 — W1 수정 · 6 → 8)` + 추가 대상마다 `+perExtraTarget(1)`(최대 +3) · 몬스터에게 맞을 때마다 `+onHitTaken(2)`(초당 최대 8 — `player.ax`가 아닌 `player.rageTaken {windowStart, sum}`로 센다) · 스킬 `gen` · 세트 `rageOnHit`(적중한 행동마다). 주거나 받은 적중이 있으면 `combatUntil = tick + ticks(3)`. `tick ≥ combatUntil`이면 초당 `decayPerSec(5)` 감소. 0..resourceMax로 자른다.
- **마나(마법사)**: 초당 `resourceRegen` 계속.
- **비용**: `cost × (1 − costReduce)`(채널은 초당 비용 × DT를 매 틱). 모자라면 `SKILL_FAIL resource` · 행동 없음.
- **쿨다운**: 시작 틱에 `readyAt[skillId] = tick + ticks(cd × (1 − cdr))`. `tick < readyAt`이면 `SKILL_FAIL cooldown`. 전설 「분노의 뿔」(패치 `refund`)은 한 돌진의 적중(`player.sk.hits`)이 `resetAt`(3) 이상이면 `readyAt = min(readyAt, tick + ticks(resetTo 1.0))`(남은 쿨다운을 1초로 — 돌진만 반복하는 무한 넉백 루프 금지).
- **포션**(`KeyQ`): `potions > 0` · `tick ≥ potionReadyAt` · `life < lifeMax`일 때 `life += lifeMax × POTION.heal(0.45) × (1 + potionPct)` · `potions −= 1`(쓰는 쪽 감소는 P1이 직접 — `addConsumable`은 더하기만 · W1 확정 · 균열이면 `rift.stats.potions += 1`도 P1) · `potionReadyAt = tick + ticks(POTION.cd 8)` · `POTION` · `PLAYER_HEAL{source:'potion'}`. 행동을 잠그지 않는다. 실패는 `POTION_FAIL{reason}`.
- **귀환 두루마리**(`KeyT`): `scrolls === 0`이면 `SKILL_FAIL{skillId:'recall', reason:'empty'}`(HUD 알림 `notice.noRecall` — 조용한 실패 금지). 균열 · 붕괴 아님 · 살아 있음 · `scrolls > 0`이면 act `recall`, `recall = {start, end: start + ticks(1.5)}` · 이동 멈춤 · `RECALL start`. 생명에 피해가 들어오면(보호막이 다 막은 적중은 아님) · 새 행동 입력 · 장면 전환이면 취소. 끝나면 `scrolls −= 1` → `openRecallPortal(ctx, pos)`(P2 — 포털 · `returnPos` · 기록 · `requestTravel{to:'town', reason:'recall'}`) → `RECALL done`. **리뷰 수정**: 완료된 균열(`phase 'complete'` · 요약 · 나가는 포털이 있다)에서는 T 가 두루마리 귀환이 아니라 나가는 포털과 같다 — 두루마리 · 시전 없이 `returnPos = player.pos` → `requestTravel{to:'town', reason:'exit'}`(`leaveRift`와 같은 규칙 · 완료 패널의 「T — 마을로」와 같다).

### 5.6 피해 식과 캐릭터 시트 (P5 `computeStats` · P2 `combat.js`)

**시트**(`computeStats(char, {riftLevel})` — 내구도 0 아이템은 없는 것으로 친다):

```
main  = 10 + 2 × (level − 1) + Σ 옵션(자기 클래스 주 능력치만)                 (다른 클래스의 주 능력치 옵션은 0)
vit   = Σ vit
lifeMax = class.life.base × class.life.growth^(level − 1) × (1 + vit × COMBAT.vitLife + lifePct/100)       vitLife = 0.012 🔒
resourceMax = class.resourceMax.base + perLevel × (level − 1) + Σ 마법구 mana
resourceRegen = (regen.base + regen.perLevel × (level − 1)) × (1 + manaRegenPct/100)
weapon: 주무기(내구도 > 0) → [min, max] = item.base.dmg × (1 + 그 무기의 weaponDmgPct/100) + 마법구 bonus(내구도 > 0) · aps = item.base.aps
        없거나 내구도 0 → FIST[cls](시작 무기와 같은 값 — 막히지 않는다 · 브리프 §4)
        weapon.type = 그 클래스 기본 공격의 type(BASIC_SKILLS[CLASSES[cls].basic].type — warrior 'phys' · mage 'lightning') · 무기 기본형은 피해 종류를 갖지 않는다
aps = weapon.aps × (1 + attackSpeedPct/100)
critChance = min(COMBAT.critCap, COMBAT.baseCrit + critChance/100)       baseCrit 0.05 · critCap 0.75
critDamage = COMBAT.baseCritDmg + critDamage/100                            baseCritDmg 0.5
dmgPct[t] = (tPct)/100 · skillPct[id] = Σ/100 · aoePct · elitePct /100
cdr = min(COMBAT.cdrCap 0.40, cdr/100) · costReduce = min(0.40, costReduce/100)
armor = (Σ 기본 armor + Σ armor 옵션) × (1 + armorPct/100)
res[t] = (allRes + tRes) × (1 + resPct/100)
block = 방패(내구도 > 0)의 base.block · moveSpeed = class.moveSpeed × (1 + min(COMBAT.moveCap 0.25, moveSpeed/100))
나머지 퍼센트 키는 /100 · lifeRegen · lifeOnHit · thorns · rageOnHit는 합 그대로(고정값)
세트: 낀 조각 수 ≥ 2면 bonus2, ≥ 4면 bonus2 + bonus4 · 패시브: stats[key][rank − 1] · 조건부 패시브는 conds로
sheetDps = (min + max)/2 × aps × (1 + main/100) × (1 + dmgPct[weapon.type]) × (1 + critChance × critDamage)
ehp = lifeMax / ((1 − DRa(armor, L)) × (1 − 평균 DRr(res[t], L)) × (1 − dmgTakenReduce))     L = riftLevel(기본 char.riftUnlocked)
powerScore = √(sheetDps × ehp)                                                                   (비교 · 봇 · 업그레이드 판정의 한 숫자)
```

**감소 식**(🔒 — §7.14 산수가 이 꼴에 묶여 있다):
`DRa(A, L) = min(0.75, A / (A + COMBAT.armorK(80) × ITEM_GROWTH^(L−1)))` · `DRr(R, L) = min(0.75, R / (R + COMBAT.resK(50) × ITEM_GROWTH^(L−1)))`. 맞춘 레벨의 장비라면 레벨이 올라도 감소율이 같다(레벨 불변) — 오래된 장비는 높은 균열에서 감소율이 떨어진다(「장비가 의미 있다」).

**플레이어 → 몬스터**(`playerHit(ctx, mon, spec)`):

```
if (mon.st.invulnUntil > tick) → 피해 0 · immune · 상태 이상 없음 · HIT{immune}
base  = spec.flat ?? rng.combat.range(weapon.min, weapon.max) × spec.coef            (대상마다 한 번 굴림)
add   = dmgPct[spec.type] + skillPct[spec.skillId] + (aoe 태그 ? aoePct : 0) + (champion·elite·guardian ? elitePct : 0) + Σ 참인 조건의 dmgPct
cc    = critChance + Σ 조건 critChance · cd = critDamage + Σ 조건 critDamage
crit  = !spec.flat && rng.combat.chance(cc)
dmg   = base × (spec.flat ? 1 : 1 + main/100) × (1 + add) × (crit ? 1 + cd : 1)
        × (shockUntil > tick ? 1 + STATUS.shockTaken(0.15) : 1) × (1 − mon.res[spec.type])
        × (정면 방패 ? 1 − MON.shieldFront(0.5) : 1)
정면 방패: 대상 종류의 params.frontBlock이 있고, aoe 태그가 아니고, 그 몬스터의 act ∈ {idle, move, windup}이고(strike · recover · 기절 · 빙결 · 경직 중에는 방패가 내려가 있다 — 밀치기 뒤 후딜 0.7초가 반격 창),
          몬스터 → (srcX, srcZ) 방향이 몬스터 facing에서 ±MON.frontDeg(45°) 안
hp −= dmg → 상태 이상(§5.8) → 경직 검사 → 적중 회복(lifeOnHit + lifePctOnHit × lifeMax — 같은 actionId에서 COMBAT.lohTargets(5)마리까지 ·
          채널 틱 · 플레이어 지속 효과 틱은 틱마다 새 actionId(state.nextId)이고 상한 COMBAT.lohTargetsTick(2) — 적중 회복 · rageOnHit · 분노 상한의 집계 단위)
→ ctx.hooks.onMonDamaged(ctx, mon, result, spec) → HIT
mon.lastHit = {by:'player', skillId, noProcs, frozen: 빙결 중이었나}
```

**몬스터 · 바닥 → 플레이어**(`monsterHitPlayer(ctx, mon, spec)` · `hazardHitPlayer(ctx, spec)`):

```
무시: 사망 · tick < protectUntil · tick < invulnUntil · flags.invincible · pendingTravel 있음 → {ignored:true}
dmg = spec.raw × (1 − DRa(armor × (1 + 전투 함성 value), spec.level)) × (1 − DRr(res[spec.type], spec.level))
      × max(COMBAT.minTaken 0.2, 1 − dmgTakenReduce − Σ 조건 dmgTakenReduce)
막기: via ∈ {melee, projectile, charge} 이고 rng.combat.chance(block) → × (1 − COMBAT.blockReduce 0.6) · blocked
보호막: absorbed = min(shield, dmg) → shield −= absorbed · dmg −= absorbed(0이 되면 SHIELD{broken} · 버프 끝)
life −= dmg → dmg > 0 이면 combatUntil · 분노 · 귀환 취소 · rift.stats.dmgTaken · meter
가시: via 'melee' 이고 thorns > 0 → damageMonsterRaw(mon, thorns × (1 + main/100), 'phys')
onHit: chillSec → st.slowPct = STATUS.playerChill(0.4) · slowUntil / rootSec → rootUntil(§5.9) /
       push → player.knock = 몬스터 → 플레이어 방향 · push를 PLAYER.pushSec(0.15)초에 걸쳐(nav.moveCircle · 그동안 경로 이동만 멈추고 행동 · 시전 · 채널은 계속 ·
       act ∈ {dash, leap, blink}이거나 tick < invulnUntil · protectUntil이면 밀리지 않는다)
monsterHitPlayer만: res.dmg > 0 이고 !spec.noAffix 면 ctx.hooks.onMonHitPlayer(ctx, mon, res, spec)(P3 — mon.affixes의 onHitPlayer)
PLAYER_HIT → life ≤ 0 이면 그 자리에서 ctx.hooks.onPlayerKilled(ctx, mon|null)(= rift.js killPlayer · §5.10 — combat은 rift.js를 import하지 않는다)
```

몬스터 투사체의 적중은 `updateProjectiles`가 `monsterHitPlayer(ctx, getMonster(ctx, proj.srcId), spec)`로 판정한다 — 출처가 없거나 죽었으면(`dead` · `gone`) `hazardHitPlayer`. 몬스터 소유 효과(바닥 표식)는 늘 `hazardHitPlayer`(속성 onHitPlayer 없음).

몬스터 수치: `hpMax = MON.hpBase × type.hp × rank.hp × row.hpMul × Π affix.mods.hpMul × earlyHpMul(L)`(밸런스 게이트 — 첫 판 생명 경사: 균열 1~11은 `RIFT.earlyHp[L − 1]`, 12 이상은 1 · **피드백 2 D1: 입문 구간 균열 1~6 은 `RIFT.earlyHp[L − 1]`, 7 이상은 1**) · `dmg = MON.dmgBase × type.dmg × rank.dmg × row.dmgMul × earlyDmgMul(L)`(W1 수정 2 — 첫 판 경사 · 밸런스 게이트: 균열 1~11은 `RIFT.earlyDmg[L − 1]`, 12 이상은 1 · **피드백 2 D1: 균열 1~6 은 `RIFT.earlyDmg[L − 1]`, 7 이상은 1**(본 곡선) · §7.3 · NOTES-W1FIX §2.0 · NOTES-BALANCE) · 공격 하나의 `raw = mon.dmg × atk.mul` · `res[t] = min(MON.resCap 0.5, type.res[t] + Σ affix.mods.res[t])`(수호자는 속성의 `mods.res`를 받지 않는다 — §8.3) · `r = type.radius × rank.scale` · `height = type.height × rank.scale`. `type`은 `getMonDef(typeId)`(일반 · 수호자 공용 — §6.2). 몬스터의 공격은 치명타가 없다.

### 5.7 조건부 패시브 — `CONDS` (P2 `conds.js`)

`CONDS[id] = (ctx, mon|null) => boolean`. 패시브 노드의 `cond`가 참인 적중(방어 쪽이면 피격)에만 `condStats`가 더해진다. 프레임워크는 ID를 모른다 — 표만 돈다.

| CondId | 참일 때 | 쓰는 노드 |
|---|---|---|
| `targetDisabled` | 대상이 기절 · 빙결 · 냉기(chill > 0) · 감속 중 · **피드백 2 D10**: 밀려나는 중(`mon.knock` · `tick < knock.until`)이거나 넉백이 끝난 뒤 `COND.knockSec`(0.5초) 안 — 끝 틱은 `status.knockEndTick(mon)`(= `st.knockImmuneUntil − ticks(STATUS.knockImmune)` · 넉백을 받은 적 없으면 -1 · 상태 필드를 더하지 않는다) · 넉백 면역(정예 `knockMul 0` · 수호자 · 구조물)은 켜지지 않는다 | 분쇄자(회전 베기 넉백으로 켜진다) |
| `targetBurning` | 대상이 화상 중 | 불의 심장(치명타 확률 부분) |
| `targetFrozen` | 대상이 빙결 중 | 파쇄 |
| `rage50` | 전사 · resource ≥ 50 | 광전사(공격 속도는 행동 시작 때 · 치명타는 적중 때) |
| `lifeBelow35` | life ≤ lifeMax × 0.35 | 불굴(받는 피해 감소) |

### 5.8 상태 이상 (P2 `status.js` · 수치 §7.6)

| 상태 | 걸림 | 효과 | 끝 · 면역 |
|---|---|---|---|
| 기절(stun) | 스킬 `status.stun` × rank.stunMul · `tick < stunImmuneUntil`이면 안 걸림 · **기절 중의 새 기절은 끝 틱을 늘리지 않는다** | act `stunned` · 예비 중인 공격은 취소(쿨다운은 쓴 채) | 끝나면 `stunImmuneUntil = 끝 + STATUS.stunImmune[rank]` |
| 냉기(chill) | 적중의 `chill` 점 그대로 | chill > 0이면 이동 · 새 공격 속도 × (1 − STATUS.chillSlow 0.30) | `chillDecayAt`(마지막 냉기 + `STATUS.chillDecayDelay` 3.0초)부터 초당 `chillDecayPerSec`(20)점 감소 — 서리 노바 1랭크(60) 두 번이면 빙결 |
| 빙결(freeze) | chill ≥ `STATUS.freezeAt − stats.freezeAtReduce` · `tick ≥ freezeImmuneUntil` | act `frozen` · chill = 0 · 길이 `STATUS.freezeSec`(1.5) × (1 + stats.freezeDurPct) × rank.freezeMul | 끝 + `STATUS.freezeImmune`(2.5초) 면역 |
| 화상(burn) | 화염 적중의 `burnFrac`(+ 연소) × 피해 | 3초 동안 같은 총량 · 0.5초마다 틱(`damageMonsterRaw` · 치명타 없음) | 새 화상은 dps가 큰 쪽 · 길이 갱신(쌓이지 않는다) |
| 감전(shock) | 번개 적중의 `shockChance` | 받는 피해 +15% | 3초 |
| 감속(slow) | 도약 착지 등 `slow` | 이동 × (1 − pct) | sec |
| 넉백(knock) | `knock` × rank.knockMul · 강인함 · structure 면역 · `tick < knockImmuneUntil`이면 안 걸림 | 0.2초에 걸쳐 그 거리(벽 미끄러짐) · 예비 공격 취소 | 끝 + `STATUS.knockImmune`(1.0초) 면역 — 그동안 넉백 · 그로 인한 예비 취소 없음(무한 경직 금지 — QUALITY §2) |
| 경직(flinch) | 한 적중 ≥ hpMax × rank.flinchFrac · 강인함 면역 · `tick ≥ flinchImmuneUntil` | act `flinch` 0.25초 · 예비 공격 취소 | 끝 + 1.2초 면역(무한 경직 금지 — QUALITY §2) |
| 무적(invuln) | 보호막 속성 · 순간이동 속성의 사라짐 | 피해 0 · 상태 이상 없음 | `invulnUntil` |
| 플레이어 감속 | 냉기 강화 적중 · 냉기 노바 | 이동 × 0.6 | sec(새로 걸리면 긴 쪽) |
| 플레이어 속박 | 감옥 | 이동 · 이동 스킬 불가(공격 · 시전은 된다) | 1.5초 · §5.9 |

- **파생 적중**(연속 회전(옛 여진 — 피드백 1) · 진동 주먹 충격파 · 진동 장화 지진 · 번개 잔상 · 얼음 파편 · 불타는 소용돌이 · 메테오의 불타는 바닥 · 시체 폭발 · 서리 반지 얼음 폭발 — 변형 · 전설이 만든 적중)은 기절 · 넉백을 싣지 않는다(피해 · 흔들림 · 그 행이 명시한 냉기/감전만).

### 5.9 위협 간격 규칙 — 피할 수 없는 연속 손해 금지 (P2 `effects.js` · 브리프 §3.5)

- **H1 팩 간격**: 같은 팩(챔피언 팩 · 정예 + 하수인 · 수호자 하나)의 바닥 위협(속성 `hazard: true`의 예고 · 수호자 고유 기술)은 `pack.nextHazardAt` 뒤에만 시작한다. 시작하면 `nextHazardAt = tick + ticks(HAZARD.packGap 1.2)`. 막힌 훅은 다음 틱에 다시 시도한다(타이머를 버리지 않는다).
- **H2 속박 잠금**: `tick < rift.rootLockUntil`이면 플레이어 발밑(`overlaps(shape, player.x, player.z, HAZARD.nearR 3.0)` — 선 · 원뿔도 같은 함수)에 새 적대 예고가 시작하지 않는다. 감옥이 플레이어를 묶으면 `rootLockUntil = 속박 끝 + ticks(HAZARD.afterRoot 0.8)`.
- **H3 감옥 조건**: 감옥은 `overlaps(shape, player.x, player.z, HAZARD.nearR)`인 적대 예고가 진행 중(start ≤ tick < hitAt)이면 시작하지 않는다.
- **H4 겹침 상한**: `overlaps(shape, player.x, player.z, HAZARD.countR 4.0)`인 진행 중 적대 예고는 동시에 `HAZARD.maxNear`(6)개까지 — 새 위협은 자기 개수(`count` — 몰타르 3 · 잿불 비 5 · 뼈 가시 5)를 더해 넘으면 시작하지 않는다.
- **H5 걸어서 피할 수 있다**: 모든 적대 바닥 예고의 길이(`hitAt − start`) ≥ `HAZARD.react`(0.25) + `escape` / `HAZARD.slowSpeed`(3.6 = 6 × (1 − STATUS.playerChill) — 같은 몬스터의 적중으로 감속된 채로도). `escape` = 표식이 시작되는 순간 플레이어가 있을 수 있는 가장 나쁜 자리에서 판정 밖까지의 거리(m)로, 효과를 만드는 데이터 행에 적는다(속성 `params.escape` · 공격 `AttackDef.escape`): 플레이어 자리 원 = r + 0.4 · 자기 중심 원 = r − 출처 r · 원뿔 · 선 · 여러 개 = 근접 거리 기준 실측. 데이터 검사(`data.schema.test.js`)가 이 부등식을 본다.
  값(escape → 필요한 예고 · 실제 예고): 감옥 1.6 → 0.70 · 0.8 / 역병 2.4 → 0.92 · 1.0 / 몰타르 1.9 → 0.78 · 1.2 / 냉기 노바 3.5 → 1.22 · **1.3** / 화염 사망 2.5 → 0.94 · 1.0 / 역병 덩어리 폭발 2.3 → 0.89 · 1.0 / 돌진 선 1.0 → 0.53 · 0.9 / 대지 분쇄 3.2 → 1.14 · 1.2 / 뼈 가시 3.9 → 1.33 · **1.4** / 잿불 비 3.1 → 1.11 · 1.2.
  예고 없이 생기는 적대 지속 효과는 `poisonPool` 하나다(출처를 죽이는 시점을 플레이어가 정한다 — 예외). 모든 지속 효과의 첫 지속 판정은 `hitAt + tickT`다(웅덩이가 놓이는 틱에 바로 맞지 않는다).
- **리뷰 수정 — 사망 위협과 속박**: H1~H4의 예외인 사망 위협(화염 강화 `fireDeath` · 역병 덩어리 `poisonPool`)도 플레이어가 묶여 있고(`tick < player.st.rootUntil`) 그 원이 몸과 겹치면 예고를 `max(delay, 남은 속박 + HAZARD.react + (원 r + 몸 r − 중심 거리) / HAZARD.slowSpeed)`로 늘린다(`rootSafeDelay(ctx, shape, delay)` — `effects.js`) — 전에는 감옥(묶임 1.5초)에 묶인 첫 순간들의 처치(가시 · 화상 · 범위 스킬 포함)가 묶인 채 맞는 폭발이 됐다(`affixes.test`).
- 함수: `canStartHazard(ctx, packId, x, z, {jail = false, count = 1, srcId = -1}) → boolean`(srcId 몬스터가 기절 · 빙결 중이면 false — §5.17-2) · `noteHazard(ctx, packId)`. 속성 · 수호자 훅은 위협을 만들기 전에 반드시 둘을 부른다(막히면 다음 틱에 다시 — 수호자는 그 기술을 시작하지 않는다).

### 5.10 사망 · 부활 · 붕괴 · 복귀 (P2 `rift.js`)

- **몬스터 사망**(`resolveDeaths` · 생명 ≤ 0이고 `dead`가 아닌 것, 목록 순서대로): `dead = true` · `deadAt` · act `dead` · `launch`(큰 일격이면 플레이어 → 몬스터 방향 × `COMBAT.launchSpeed`) → `ctx.hooks.onMonDeath(ctx, mon)`(P3 — 속성 onDeath: 분열 · 화염 강화 · 역병 덩어리 웅덩이) → 경험치 `grantXp`(P6 · `flags.noXp`가 아니면) → 게이지(§5.18) → 드랍(`flags.noDrops`가 아니면 `rollDrops` → `spawnDrops`) → 처치 집계 · `meter.killTicks` → `byPlayer`이고 `!lastHit.noProcs`면 `ctx.hooks.onPlayerKill(ctx, mon, lastHit)`(P1 — 전설 처치 훅) → `MON_DIED`. 시체는 `DEATH.corpseSec`(6초) 뒤에 목록에서 빠진다(주술사의 부활 대상).
- **플레이어 사망**(`killPlayer(ctx, killer)` — `monsterHitPlayer` · `hazardHitPlayer`에서 생명 ≤ 0이 된 그 자리에서 `ctx.hooks.onPlayerKilled`로): `dead` · `deadAt` · act `dead` · `killedBy`(killer의 typeId · rank · name — 없으면 null) · 경로 · 버퍼 · 채널 · 귀환 정리 · `rift.deaths += 1` · `applyDeathPenalty(ctx)`(P6 — 장착 전부 내구도 −10 · `DURABILITY`) · `SAVE_REQUEST{reason:'death'}`(새로 고침으로 대가를 피하지 못하게).
  - 생명 감소 · 붕괴는 `phase ∈ {active, guardian}`에서만이다(`complete`면 사망 대가(내구도)만 치르고 lives는 깎지 않는다). `rift.lives > 0` → `lives −= 1` · `LIVES`. `lives === 0`이었으면 → **붕괴**: `phase = 'collapsed'` · 요약(result `'collapse'`) · `RIFT_COLLAPSE` · `recordRun`(P6). 단, 수호자가 이미 생명 ≤ 0이면 붕괴하지 않는다(완료가 우선).
  - 적대 투사체 · 예고를 지우고(표시만 — 투사체 `until = tick` · `PROJ_END{cancel}` · 효과 `end = tick` · §5.14), **W1 수정 3(NOTES-W1FIX §2.0b)**: 플레이어가 남긴 피해원도 같은 틱에 지운다 — 플레이어 투사체(`until = tick` · `PROJ_END{cancel}`) · 플레이어 효과(`end = tick`) · 몬스터의 화상(`st.burn = null`) · 감전(`shockUntil = -1`)(각각 `MON_STATUS{off}`). 남겨 두면 마을에서 멈춰 있던 화살 · 지진 · 화상 틱이 복귀 뒤 잠든 몬스터를 맞혀 팩째(연결로 이웃 팩까지) 깨웠다(재검증 — 마법사). **진정** — W1 수정(NOTES-W1FIX): `DEATH.calmSec` 0 → **그 틱에** 깨어 있는 몬스터를 모두 재운다(생명은 그대로 · 그 자리에서 · `calmAt = null`). `calmSec` > 0이면 `rift.calmAt = tick + ticks(calmSec)`(옛 규칙 — 1초 안에 부활하면 진정이 shiftTicks로 복귀 뒤로 밀려 같은 떼가 안전 지점까지 따라왔다 · NOTES-W1 §7-3). `returnPos = rift.checkpoint`.
  - `PLAYER_DIED`.
- **부활**(`respawn()` — 사망 패널의 키 1번): 사망 중일 때만 → `requestTravel{to:'town', reason:'respawn'}` → commit: `refreshStats` → `resetPlayerForScene({full:true})`(생명 · 자원 — 마나 가득 · 분노 0) → `placePlayer(TOWN.respawn)`(마을 포털 옆) · `killedBy = null` · 붕괴였으면 균열을 닫는다(`RIFT_CLOSED{collapse}` — `rift = null`), 아니면 `town.returnPrompt = true`. **W1 수정(NOTES-W1FIX)**: 이 commit의 맨 앞(균열을 떠나는 순간 · 전환 막 아래)에서 `settleOnRespawn(ctx)`(P2 `rift.js`) — 깨어 있는 몬스터를 모두 재우고(남은 `calmAt` · 죽어 있는 동안 깬 팩 · W1 수정 2), 플레이어가 남긴 피해원을 한 번 더 지우고(W1 수정 3 — 사망한 틱 뒤 같은 틱의 처치 훅 등이 만든 것까지 · 떠나는 순간 플레이어의 것은 남지 않는다), 살아 있고 잠든 몬스터를 `rift.homes[id]`(처음 놓인 자리 · facing)로 옮긴다(`prevPos` 같이 · 넉백 · 속도 0 · 생명은 그대로 · 화상 · 감전 밖의 상태 이상(냉기 · 기절 · 빙결 · 감속)도 그대로 — 스스로 끝난다). 마지막으로 **복귀 지점을 다시 고른다**(W1 수정 3): `returnPos`(없으면 `checkpoint`)가 살아 있고 잠든 몬스터의 시야(`aggro + RIFT.checkpointSleepMargin` · 벽 시야 — 안전 지점과 같은 규칙) 안이면, 그 타일에서 바닥 타일을 너비 우선(4방향 · 결정적)으로 넓혀 처음 만나는 「어느 잠든 몬스터의 시야에도 없고 플레이어 몸이 들어가는」 타일 가운데로 `returnPos` · `checkpoint`를 옮긴다(없으면 그대로). 복귀한 플레이어가 같은 떼 앞에 서지 않는다 — 떼는 제 방에서 다시 기다린다(디아블로식 리시). **수호자도 같다(W1 수정 3에서 정함)**: 수호자 단계에 쓰러지면 수호자는 출현 자리로 돌아가 잠들고 **생명은 그대로 남는다**. 복귀 지점은 그 시야(`aggro` 99 · 벽 시야) 밖이므로 복귀만으로는 깨지 않는다 — 플레이어가 다가가 수호자의 시야에 들어가면(또는 때리면) 싸움이 남은 생명에서 다시 시작된다(옛 규칙은 안전 지점이 수호자 6~21m 앞이라 복귀 1~5틱 뒤 다시 깨 같은 자리에서 다시 쓰러졌다). 복귀 지점이 옮겨지는 거리는 실측 0~12.3m다(NOTES-W1FIX §3.8 · 출현 예고 중 사망이면 수호자가 넓은 방에 서므로 0~34.9m — §3.10). **출현 예고 중 사망(W1 수정 4)**: 게이지가 찬 뒤 출현 예고(`RIFT.guardianDelay` 2초) 안에 쓰러져 수호자가 아직 나오지 않은 채(`guardianId === null` · `guardianSpawn` 있음) 부활하면, `settleOnRespawn`이 맨 앞에서 수호자를 그때 세운다(`spawnGuardianNow` — `guardianId` · `GUARDIAN_APPEAR` · `guardianSpawn = null` · 출현 예고 효과 `end = tick`). 이어지는 진정 · 처음 자리 · 복귀 지점 다시 고르기를 이미 나온 수호자와 똑같이 받으므로 수호자는 출현 자리에 **잠든 채 · 생명 가득**으로 기다리고 복귀 지점은 그 시야 밖이다 — 싸움은 다가가면 시작된다. 미뤄 두면 남은 예고가 shiftTicks로 복귀 뒤로 밀려 수호자가 복귀 직후 깨어 나타나(출현은 깨어 있다) 복귀 지점으로 걸어왔다(재검증 354/354 · 사망 → 부활은 패널 0.3초 + 미리 누른 Enter라 예고 2초의 대부분이 이 길이다).
- **복귀**(`returnToRift()` · 마을 포털 도착 — 둘 다 `requestReturnToRift(ctx)`(P2 `rift.js`) · 「Enter」 안내 또는 마을 포털 클릭 · 키 1번): `rift`가 있고 붕괴가 아니고 마을이면 → `requestTravel{to:'rift', reason:'townPortal'}` → commit: rift 하위 시각을 민다(§5.11) → `placePlayer(returnPos ?? checkpoint)`(생명 · 자원 유지) · `protectUntil = tick + ticks(DEATH.protectSec 1.5)` · 귀환 포털이 있었으면 닫는다 · `returnPrompt = false`. 사망 → 부활 → 복귀 = 키 입력 2번 · 시스템 시간 `DEATH.panelDelay` 0.3 + 부활 막 0.2 + 0.2 + 복귀 막 0.3 + 0.3 = **1.3초**(+ 사람의 반응 두 번 ≈ 0.5초 → 약 1.8초) — 브리프 §7 「2초 안」. 사망 패널이 뜨기 전에 누른 Enter는 버리지 않는다(§10.5-6) · 그 사이의 안내는 큐로(§10.2).
- **안전 지점**(`checkpoint`): 15틱마다 15m 안에 깨어 있는 몬스터가 없고 살아 있으면 `checkpointCalm += 15` · 60틱 이상이면 `checkpoint = pos`. 몬스터가 다가오면 0으로. 균열 시작점이 처음 값. **W1 수정(NOTES-W1FIX)**: 살아 있는 **잠든** 몬스터가 `aggro + RIFT.checkpointSleepMargin`(2m) 안이고 `losClear`(벽)면 조용하지 않다(0으로 — 깨기 직전 자리가 안전 지점이 되지 않게 · 음수면 끈다). 안전 지점을 정한 뒤에 그 시야가 생긴 경우(나중에 나온 수호자 · 집으로 돌아간 떼)는 부활 때 복귀 지점을 다시 고른다(위 「부활」 · W1 수정 3).
- **판 경험치 집계**(W1 확정): `rift.stats.xp` · `meter.runXp`는 P2가 `grantXp` 결과의 `amount`(캡에서 버린 양을 뺀 실제 양)로 더한다 — P6 `grantXp`는 둘을 건드리지 않는다. 완료 정리로 사라지는 몬스터(`flags.no*` 전부)는 `onMonDeath`(사망 폭발 · 분열 · 웅덩이)를 돌리지 않고, 완료 때 남은 적대 투사체 · 예고도 지운다.
- **완료 뒤**: 수호자 사망 → `phase = 'complete'` · 수호자 드랍(보장 포함) · 남은 몬스터는 경험치 · 드랍 · 게이지 없이 사라진다(`flags.no*` 세우고 생명 0 — 다음 `resolveDeaths`에서 정리 · `MON_DIED`는 낸다) · `completeAt = tick + ticks(RIFT.completeDelay 1.5)`. **리뷰 수정 — 정산은 처치 틱에**(그 `resolveDeaths` 호출 끝 · `settleComplete`): 완료 경험치 `grantXp(ctx, round(XP.completeBonus × xpMul(L)), 'complete')`(P2 — W1 확정 · P6 `completeRun`은 경험치를 주지 않는다) → 요약(`timeSec` = 처치까지) → `completeRun(ctx, summary)`(P6 — 해금 · 최고 기록 · 기록 · 저장) → `rift.settled = 요약`. `completeAt` 틱에(`finishRift` — 연출만): `rift.summary = rift.settled`(패널) → `RIFT_COMPLETE` → 나가는 포털(`exit` · 수호자 자리 + 3m의 걷기 가능 점) `PORTAL_OPENED`. 균열은 다음 균열을 열 때까지 열려 있다(마을 포털로 돌아와 남은 전리품을 주울 수 있다). **밸런스 게이트**: `completeAt` 전에 균열을 떠나면(처치 직후 끝난 귀환 시전 · 부활) 마을로 가는 commit(`_enterTown` — 맵이 아직 균열 맵일 때)이 그 자리에서 같은 마무리를 한다(`finishRift`) — 전에는 마을에서 새 균열을 열면 그 판의 요약 · 해금 · 완료 경험치 · 기록이 조용히 사라졌다(`gameSim.test`). 전에는 정산도 `completeAt`에 해서, 그 1.5초 안의 「타이틀로」(`closeRift`가 `complete`를 마무리하지 않았다) · 탭 닫기(pagehide 저장)에서 해금 · 완료 경험치 · 기록이 사라졌다 — 이제 처치 틱에 캐릭터에 들어가고 `SAVE_REQUEST{char, complete}`가 나간다(`closeRift`도 정산되지 않은 `complete`를 정산한다 · `gameSim.test`).

### 5.11 장면 전환 — `pendingTravel` (P2)

- 장면을 바꾸는 모든 길(균열석 · 포털 · 귀환 · 부활 · 디버그)은 `requestTravel(ctx, travel)`로 `state.pendingTravel`을 세우고 `TRAVEL_REQUEST`를 낸다. app이 막을 내리고(0.3초 · 부활은 0.2초 — §11.4) `sim.commitTravel()`을 부르고 막을 올린다(같은 길이). 봇 하네스 · 헤드리스 테스트(`Bot{autoCommit:true}`)는 step 뒤 `pendingTravel`이 있으면 바로 `commitTravel()` — 브라우저의 봇은 commit하지 않는다(app의 막이 한다 · §11.13).
- `pendingTravel` 동안: step은 tick만 민다 · 플레이어는 피해를 받지 않는다 · 새 `requestTravel`은 무시된다(`{ok:false, reason:'busy'}`). 균열 장면에서 `pendingTravel`이 서는 틱에 `rift.leftAt = tick`(균열은 그때부터 step하지 않는다).
- `commitTravel()`:
  - `to:'rift'` · `openRift`: 열린 균열이 있으면 닫는다(활동 중이었으면 기록 `abandon` · `RIFT_CLOSED{newRift}`) → `seed = travel.seed ?? hash32(state.seed, char.runs + 1)` → `map = generateRift(seed, level)`(P4) → `createRiftState`(P0) → `populateRift(ctx)`(P3) → `ctx.flow = createFlow(map)` → `char.runs += 1` · `char.lastRiftLevel = level` → `refreshStats` → `resetPlayerForScene({full:true})` → `placePlayer(map.spawn)` · `protectUntil` → `RIFT_OPENED` → `HINT controls`.
  - `to:'rift'` · `townPortal`: 맵은 캐시(`ctx.riftMap`) — 없으면(불러오기 뒤 등) 같은 seed · level로 다시 만든다 · `ctx.flow = createFlow(ctx.map)` · **시각 밀기**: `delta = tick − rift.leftAt` → `shiftTicks(state.rift, delta)`(core/time.js — rift 하위 트리 전체) · `meter.killTicks`도 delta만큼 → `leftAt = -1` → `placePlayer(returnPos ?? checkpoint)`(생명 · 자원 유지). 그래서 마을에 있던 동안 예고 · 공격 · 속성 주기 · 시체 시간은 멈춰 있다(§5.16-4 — 돌아온 첫 틱에 밀린 위협이 한꺼번에 터지지 않는다). 플레이어의 시각 필드(`readyAt` · `potionReadyAt` · `buffs` · `st` · `protectUntil`)는 마을에서도 흐르므로 밀지 않는다.
  - `to:'town'`: 마을 맵(캐시) · `ctx.flow = null` · 도착점(`TOWN.arrive` · 부활이면 §5.10의 순서로 `TOWN.respawn`) — recall · riftPortal · exit은 `placePlayer`만(생명 · 자원 유지) · `restockShops(ctx)`(P6 — 그 판의 재고가 이미 있으면 아무것도 하지 않는다 §6.11) · `HINT town`.
  - 공통: `MAP_LOADED`(맵이 바뀌면) → `SCENE_CHANGED` → `PLAYER_SPAWNED` → `SAVE_REQUEST{reason:'scene'}` · `pendingTravel = null`.
- **`shiftTicks(obj, delta)`의 대상**(P0 `core/time.js` — 순수 · 재귀 · 제자리): 값 ≥ 0인 숫자 중 키 이름이 `At` · `Until`로 끝나거나 `until` · `start` · `end` · `born` · `at` · `actStart` · `actHit` · `actEnd`인 것, 그리고 키가 `readyAt`인 객체의 값 전부. `mon.ax` 안도 같다 — P3 · P16 훅은 절대 틱을 이 이름 규칙으로만 둔다(이름이 다른 숫자는 밀리지 않는다 · 틱 수는 끝이 `T`). 「없음」은 -1이나 null로 쓰고 Infinity를 상태에 넣지 않는다(`assertFiniteDeep` · JSON).
- 맵 생성(≤ 150ms)은 막이 내려간 뒤 `commitTravel` 안에서 끝난다(로딩 화면 없음 — 브리프 §3.1).

### 5.12 일시정지 · 시간 · 보간 · 히트스톱 (app P9 — sim은 모른다)

- app은 다음 동안 `step`을 부르지 않는다: 모달 패널이 열림(§10.2의 `modal: true`) · 마을에서 어떤 패널이든 열림 · 일시정지 · 전환 막 · `screen !== 'play'` · 탭 숨김 · 포커스 잃음 · WebGL 컨텍스트 잃음. 봇이 켜져 있으면 「마을에서 어떤 패널이든」은 보지 않는다(§11.13).
- **균열에서 겹쳐 보는 패널**(인벤토리 · 캐릭터 · 큰 지도 — `modal: false`)은 시간이 흐른다(장르 표준). **피드백 2 D6**(Jay 결정 2026-10-12): 스킬 트리(`S`)는 모달이다 — 균열에서 열어도 게임이 멈춘다(`PAUSED{reason:'modal'}` · 패널 폭 1000px 가 플레이어를 가린다 · 균열에서 스킬을 찍는 순간은 대개 싸움 뒤). 그 패널 위의 마우스는 게임 입력이 아니고, 패널이 쓰는 키(§10.5)는 게임 입력으로 새지 않는다.
- 루프: 고정 틱 누산기 — `acc += min(실제 dt, MAX_FRAME_DT 0.25)` → `while (acc ≥ DT && steps < MAX_STEPS_PER_FRAME 5)` step → 남은 `acc`가 2 × DT를 넘으면 버린다(폭주 금지). 렌더 보간 `alpha = acc / DT` — view는 `prevPos`와 `pos`를 `alpha`로 섞는다. **보간을 끊는 경우**: `PLAYER_SPAWNED` · `MON_SPAWNED`(첫 프레임) · 순간이동(`blink` 판정 틱 · 속성 순간이동 `teleportIn`)은 그 엔티티의 prev를 pos로 본다(view가 `actHit` · 이벤트로 안다).
- **히트스톱**: sim이 `HITSTOP{sec: COMBAT.hitstop.sec 0.05}`를 낸다 — 조건: 플레이어 한 적중이 (치명타이고 대상 최대 생명의 25% 이상) 또는 챔피언 이상을 처치 · 직전 히트스톱에서 `COMBAT.hitstop.gap`(0.4초) 이상 지남(`player.hitstopAt`로 센다 — 상태). app은 그 실제 시간 동안 step을 멈추고 렌더는 계속한다(누산기는 그동안 쌓지 않는다). 헤드리스는 무시.

### 5.13 드랍과 아이템 생성 (P5 · 브리프 §3.7)

`rollDrops(rng, opts)` — **순수 함수 하나** · 게임 · 봇 · 분석 패널 · 측정 · 테스트가 같은 것을 부른다. `opts = {rank, level, cls, mf, gf, blp, blpOn = true, newId}` → `{drops: DropRoll[], blp}`(입력을 고치지 않는다 — 호출자가 `char.blp.count = result.blp`).

1. **드랍 묶음**: `tc = TREASURE[RANKS[rank].tc]`(null이면 빈 결과). `picks`번 `rng.pick(tc.w)`:
   - `gold` → `amount = max(1, round(GOLD.base × tc.goldMul × row.goldMul × rng.range(0.5, 1.5) × (1 + gf)))`
   - `potion` · `globe` → 1 · `material` → `mat = rng.pick(MATERIAL_DROP)` · 1 · `none` → 없음 · `gear` → 2~5.
   - `tc.guaranteed`(수호자) → 그 수만큼 **보장 장비**: 등급을 `GUARANTEE` 가중치(희귀 · 전설 · 세트만)로.
2. **등급 굴림 — 가중치 한 번 뽑기**(상위부터 판정 방식이 아니다 · 이론 확률이 식 하나다):
   ```
   w.normal = RARITY.base.normal                                       (보장이면 0)
   w.r      = (보장 ? GUARANTEE[r] : RARITY.base[r] × RARITY.rank[rank][r]) × row.rarityMul[r] × (1 + effMF × MF.scale[r]) × (r === 'legendary' ? blpMul : 1)
   effMF    = mf × MF.k / (mf + MF.k)              mf는 비율(1.0 = 100%) · MF.k = 2.0 🔒  (0 → 0 · 1 → 0.667 · 3 → 1.2 · 6 → 1.5)
   blpMul   = blpOn ? 1 + BLP.rate × min(blp, BLP.capCount) : 1
   P(r)     = w.r / Σw
   ```
   `blpOn`이고 `blp ≥ BLP.hard`(400)면 이 굴림은 굴리지 않고 **전설**. 굴린 뒤: 전설 · 세트면 `blp = 0`, 아니면 `blp += 1`(장비 드랍만 센다).
3. **부위 · 기본형**: `slot = rng.pick(SLOT_WEIGHTS)` → 주무기 · 보조면 `itemCls = rng.chance(ITEM.ownClassChance 0.85) ? cls : 다른 클래스`(그 밖은 null) → `BASES` 중 slot · cls가 맞는 것을 `weight`로 → 단계 = `BASE_TIERS` 중 `minIlvl ≤ ilvl`인 것을 `weight`로. 전설은 `LEGENDARIES`를 가중치(자기 클래스 · 공용 × 1 · 다른 클래스 × `ITEM.otherClassLegend` 0.25)로 골라 그 기본형 · 단계 = 열린 가장 높은 단계. 세트는 자기 클래스 세트 `ITEM.ownSetChance`(0.8) · 아니면 다른 세트 → 조각 균등.
4. **아이템**: `rollItem(rng, {baseId, tier, rarity, ilvl, cls, legendaryId?, setPieceId?, newId})`:
   - 기본 값: `v = rng.range(1 − ITEM.baseVar, 1 + ITEM.baseVar)`(0.10 — 하나로 최소 · 최대 둘 다) → `dmg = round(base.dmg × BASE_TIERS[tier].mul × ITEM_GROWTH^(ilvl−1) × v)`(최대 ≥ 최소 + 1) · `armor` · `bonus`도 같은 꼴(각자 v) · `block` · `mana`는 그대로.
   - 옵션 수: `ITEM.affixCount[rarity]` 가중치(전설은 `def.affixes` 범위 균등 · 세트 3~4 균등 · 일반 0).
   - 옵션 고르기: 그 부위가 허용하는 `ITEM_AFFIXES`에서 가중치로 **중복 없이** · 접두 ≤ `ITEM.maxPrefix[rarity]` · 접미 ≤ `maxSuffix`(마법 1/1 · 그 밖 3/3) · 주 능력치 옵션 가중치 × (`main`이 그 아이템 클래스(공용이면 굴리는 캐릭터 클래스)의 주 능력치면 `ITEM.mainBias` 3 · 아니면 `ITEM.offMainBias` 0.3). 풀이 바닥나면 옵션이 그만큼 적다.
   - 티어: `AFFIX_TIERS.minIlvl[t] ≤ ilvl`인 티어를 `AFFIX_TIERS.weight`로 → 값 = `rng.range(min, max)` × (scale `pow`면 `ITEM_GROWTH^(ilvl−1)`) → `decimals`로 반올림.
   - `skillPct`의 `param` = 그 클래스 액티브 노드 6개 중 균등.
   - 이름(`name`): 일반 `['base.<id>.<tier>']` · 마법 `[접미어 키?, 접두어 키?, 기본형 키]`(`'afx.<id>.s'` · `'afx.<id>.p'` — 「곰의 예리한 장검」 꼴) · 희귀 `['rare.a.<i>', 'rare.b.<j>']`(i, j = `rng.int(0, 23)`) · 전설 `['leg.<id>']` · 세트 `['setp.<pieceId>']`.
   - 가치: `value = round(ITEM.slotValue[slotKey] × RARITY.value[rarity] × GOLD_GROWTH^(ilvl−1))`(slotKey: 주무기는 `mainHand1h` · `mainHand2h`).
   - `dur = durMax = ITEM.durMax(100)` · `rerollIdx null` · `rerolls 0` · `reqLevel = min(ilvl, ITEM.reqLevelCap)`(**피드백 2 D2** — 상한 30 = 캐릭터 레벨 캡 · 균열 30 위에서 주운 장비도 낀다 · 정화(`sanitizeItem` → `makeItem`)가 옛 세이브의 요구 레벨 31 이상도 30 으로 다시 계산한다).
5. **업그레이드 집계**(P2 `spawnDrops`): 장비 드랍이 바닥에 떨어질 때 `isUpgrade(ctx.stats, char, item, COMPARE.upgradeGain)`(P5)이면 `rift.stats.upgrades += 1`. `isUpgrade(stats, char, item, minGain = COMPARE.minGain)` = 클래스가 맞고(null 또는 같은 클래스) · `reqLevel ≤ level` · 그 부위에 꼈을 때의 `powerScore`(반지는 낮은 쪽을 바꾼 것 · 양손 무기는 보조를 뺀 것 · 보조는 양손 무기를 끼고 있으면 비교하지 않음)가 지금보다 `minGain` 넘게 크다. **피드백 2 D5**(Jay 결정 2026-10-12): 「업그레이드」로 **세는** 문턱은 `COMPARE.upgradeGain`(3%) — 균열 기록 `rift.stats.upgrades` · 완료 패널 「그중 더 나은 장비」(문면에 「장비 점수 +3% 넘게」 — 판정이 초과(`gains` — after > before × (1 + 문턱))라 「이상」이 아니다 · 피드백 2 다듬기 · `ui/pnlLogic.upgradeCountGain()`) · 봇 측정(업그레이드 판 비율)이 같은 키를 읽는다. 화면의 비교 화살표(녹 ▲ · `upgradeOf`) · 봇 장착은 기본값 `COMPARE.minGain`(0.5% — 「조금이라도 나으면」) 그대로.

### 5.14 난수 줄기 · 결정성 (P0 규약 · 전 패키지)

| 줄기 | 쓰는 곳 |
|---|---|
| `rng.combat` | 무기 피해 굴림 · 치명타 · 막기 · 감전 · 전설 확률 효과 |
| `rng.ai` | 몬스터 선택(공격 고르기 · 도망 방향) · 속성 훅(불꽃 방향 · 몰타르 흩어짐 · 순간이동 자리) · 둥지 · 분열 위치 |
| `rng.loot` | `rollDrops` · 드랍 흩뿌림 위치 |
| `rng.shop` | 상점 재고 · 도박 · 제작 (재굴림 후보는 W1 확정으로 파생 난수 `makeRng(seedRng(hash32(char.seed, 아이템 번호, rerolls, affixIdx, SEED_SALT.reroll)))` — 「제안 → 취소 → 제안」 · 새로 고침으로 후보를 공짜로 다시 보지 못하게. 같은 아이템 · 횟수 · 칸이면 같은 후보) |
| 맵 생성 | `makeRng(seedRng(hash32(seed, level, 1)))` — `generateRift` 안 |
| 균열 채우기 | `makeRng(seedRng(hash32(seed, level, 2)))` — `populateRift` 안(팩 구성 · 속성 · 정예 이름 · 수호자 종류) |

- 같은 `state.seed` · 같은 입력 열 → 같은 상태 해시(`hashState` — `events` · `flags`를 뺀 상태). 맵은 상태가 아니지만 시드로 같게 다시 만들어진다.
- 틱 안에서 목록을 도는 순서는 배열 순서(삽입 순)다. 새로 생긴 몬스터 · 투사체 · 효과는 **다음 틱부터** 갱신한다(그 틱의 반복 중에 추가된 것은 건너뛴다 — `for (let i = 0, n = arr.length; i < n; i++)`).
- `Object.keys` 순서에 기대는 판정을 하지 않는다(데이터의 배열 순서로 돈다).
- **배열에서 실제로 빼는 곳은 `cleanup`(§5.1-7 → `removeMarked`)뿐이다.** 그 밖의 곳(사망 정리 · 부활 · 줍기 · 같은 틱 반복 중)은 표시만 한다: 투사체 · 효과는 `until` / `end = tick`(투사체는 `PROJ_END{reason:'cancel'}`) · 몬스터는 `mon.gone = true` · 드랍은 `drop.gone = true`(`removeDrop`이 표시한다). 표시된 것은 갱신 · 판정 · 질의(`monstersIn` · `nearestMonster` · `rebuildSpace`) · 그리기에서 빠진다. `getMonster`의 색인은 `ctx.monVer`로 무효화한다(목록 길이 비교 금지 — 한 틱에 하나 빠지고 하나 생기면 길이가 같다).

### 5.15 계측 · 떼 순간 (P2 `meter.js`)

- 링 버퍼: 틱마다 `dealt[idx]` · `taken[idx]`에 그 틱의 피해를 쌓고 `idx = (idx + 1) % METER.window`(150). DPS(5초) = Σdealt / 5.
- `killTicks`: 처치 틱(최근 `METER.killCap` 300개) — 분당 처치 = 최근 60초 안의 수.
- 떼: `targeting` = 깨어 있고 살아 있고 `targeting` 플래그(15m 안 · 도망 아님)인 몬스터 수. `rift.stats.maxTargeting = max`. `targeting ≥ METER.swarmOn`(25)이고 `swarmArmed`면 `swarmMoments += 1` · `swarmArmed = false` · `targeting < METER.swarmOff`(15)면 다시 `swarmArmed = true`. (MeterState에 `swarmArmed:boolean`.)

### 5.16 같은 틱 충돌의 해소

1. 틱 순서가 우선순위다: 플레이어 판정(4) → 몬스터(5) → 투사체 · 효과(6). **생명 ≤ 0인 몬스터는 `dead` 처리 전이라도 그 틱의 행동 · 판정을 하지 않는다**(플레이어가 먼저 죽인 몬스터는 같은 틱에 때리지 못한다).
2. 플레이어가 죽은 뒤 같은 틱의 나머지 피해는 무시한다(`killPlayer`가 그 자리에서 `dead`).
3. 플레이어 사망과 수호자 처치가 같은 틱: 플레이어의 적중(4)이 먼저라 수호자 생명 ≤ 0 → 붕괴하지 않는다(§5.10) · 완료가 우선 · 사망 대가는 그대로.
4. 게이지 100%와 사망이 같은 틱: 게이지는 남고 수호자 예고는 플레이어가 돌아온 뒤 이어진다(마을에 있는 동안 균열은 step하지 않고, 돌아오면 rift 시각을 민다 — §5.11).
5. 포션(4)은 같은 틱의 적중(5 · 6)보다 먼저다. 귀환이 끝난 틱(4)에는 `pendingTravel`이 서서 그 뒤 피해를 받지 않는다.
6. 출처가 죽은 적대 예고: 효과의 `cancelOnSrcDeath`(몸에 붙은 예고 — 돌진 선 · 대지 분쇄 · 뼈 가시 · 부풀기)면 출처가 `dead`이거나 없어진 첫 틱에 판정 전에 지운다(`end = tick`). `hitAt` 틱에 생명 ≤ 0이 된 출처(아직 `dead` 아님)의 효과는 판정한다 — 역병 덩어리는 판정 틱에 스스로 생명 0이 되므로 이 규칙으로 한 번 터진다. 이미 바닥에 놓인 것(감옥 · 역병 · 몰타르 · 화염 강화 사망 폭발 · 냉기 노바 · 잿불 비 · 웅덩이)은 그대로 판정한다.
7. 두 드랍이 한 자리: 흩뿌림이 비켜 놓는다(§7.6 `PICKUP.scatter*`). 가방이 차면 먼저 주운 것만 들어간다.
8. 같은 몬스터가 한 틱에 여러 번 맞으면 HIT도 여러 번 · 사망 처리는 한 번(`resolveDeaths`).

### 5.17 몬스터 프레임워크 루프 — `updateMonsters(ctx)` (P3)

각 몬스터(살아 있고 `gone`이 아닌 것 · 배열 순서 · 이번 틱에 추가된 것은 다음 틱부터 — §5.14):

1. **잠**: `awake === false`면 `(tick + id) % MON.wakeCheckT === 0`(6틱)일 때만 깨우기 검사 — 플레이어가 `aggro` 안이고 `nav.losClear`면 `wakePack(ctx, packId, 'sight')`. 피격(`onMonDamaged`)도 그 팩을 깨운다. **팩 연결**: 깨는 팩의 구성원에서 `MON.linkRadius`(11m — W1 수정 · 8 → 11) 안의 다른 잠든 팩도 한 단계 깨운다. **초반 경사**(W1 수정 · NOTES-W1FIX): 깨는 팩 또는 대상 팩의 `depth`가 `MON.linkMinDepth`(2)보다 작으면 연결하지 않는다 — 시작 방과 그 이웃 방(깊이 0~1)은 시야 · 피격으로 팩 하나씩만 깨고, 깊이 2 이상은 방째 몰려온다(브리프의 20~40마리 「파도」 — 첫 스킬을 배운 뒤 만난다). `depth`가 없는 팩은 깊은 팩으로 본다. 깨어 있는 수가 `MON.maxAwake`(120)이면 새로 깨지 않는다(피격으로 깨는 것은 예외).
2. **상태 관문**: 기절 · 빙결 · 경직 · 사라짐(act `vanish`) 중이면 4~6을 건너뛴다(3 넉백 이동은 한다). 7 · 8 · 9는 깨어 있으면 늘 한다 — 다만 기절 · 빙결 중에는 `hazard: true` 속성의 새 위협을 시작하지 않는다(`canStartHazard(…, {srcId: mon.id})`가 false를 준다 — 훅은 다음 틱에 다시). **사라짐**: 훅이 `act='vanish'` · `actStart` · `actEnd`를 세우면 프레임워크가 `actEnd` 틱에 `act='idle'`로 돌린다 — 훅은 `onAwakeTick`에서 `tick ≥ mon.actEnd`인 첫 틱에 위치를 옮기고 `AFFIX teleportIn`을 낸다.
3. **넉백**: `knock`이 남아 있으면 `nav.moveCircle`로 그만큼 이동하고 4로 가지 않는다.
4. **행동 진행**: 공격 중이면 `actHit` 틱에 `BEHAVIORS[def.behavior].strike(ctx, mon, atk)`(기본 구현: 근접 = 중심 거리 ≤ r + reach + player.r + `MON.reachTolerance`(0.3) 이고 공격 시작 facing에서 cone/2 안이면 `monsterHitPlayer` · 원거리 = 투사체) → `MON_STRIKE` → `actEnd`에 `idle`. 속성 `onHitPlayer`는 `monsterHitPlayer` 안에서 돈다(§5.6 — 여기서 다시 부르지 않는다).
5. **생각**: 행동 가능하면 `BEHAVIORS[def.behavior].think(ctx, mon, def)` — 공격을 고르면 `startAttack(ctx, mon, atkId)`(예비 길이 = `windup / atkSpeed` — 단 속성 `atkSpeedMul`(빠름)은 telegraph `pose` · `aimLine` · `glow`인 공격의 예비 · 후딜에만 곱한다: `groundLine` · `groundCircle`과 kind `cast`의 예비(= 그 효과의 예고 길이)는 데이터 값 그대로이고 빠름은 그 공격의 쿨다운만 ÷ atkSpeedMul · 몬스터 냉기 감속(× 0.7)은 예비를 늘리는 쪽이라 모두에 곱한다 · facing은 시작 때 고정 · `MON_ACT`. 바닥 표식을 만드는 공격은 예비를 시작하는 그 틱에 효과를 만든다 — `delay` = 예비 길이 · §8.1 · §8.3), 아니면 이동 목표를 `mon.ax.b.move`에 둔다(`'chase'` · `'flee'` · `'kite'` · `'hold'` · `{x, z}`).
6. **이동**: 목표 방향 = chase면 `flowDir(ctx.flow, ctx.map, x, z)`(§6.6이 정본 · **리뷰 수정**: null(흐름장 `maxSteps` 밖 — 벽 너머 먼 경로)이면 먼 흐름장 `FLOW.far`(맵 전체 · 그런 몬스터가 있을 때만 `everySec` 1초마다 만든다 · 상태 아님)의 방향 · 그것도 null이면 플레이어 쪽 직선) · 플레이어가 3m 안이고 시야가 트이면 직선 · 정지 거리 = `r + 첫 근접 reach × 0.8 + player.r`. 속도 = `speed × 냉기 · 감속 · 속성 배율`. **밀어내기**: `ctx.space`에서 `r + 0.6` 안의 이웃과 겹친 만큼의 절반씩 밀고(최대 6 이웃) · 몬스터는 플레이어 원을 장애물로 보고 정지 거리에서 멈춘다(겹쳐 있으면 몬스터가 밀려난다 — 플레이어가 미는 것은 §5.2-8) → `nav.moveCircle`. facing은 이동 방향으로 `turnRate`(공격 예비 중에는 돌지 않는다).
7. **속성 틱**: 깨어 있으면 `mon.affixes`의 각 `AFFIX_HOOKS[id].onAwakeTick(ctx, mon, row, mon.ax[id])` — 단 `hazard: true` 속성은 **팩의 대표**(그 팩 `memberIds` 중 살아 있고 rank가 minion이 아닌 첫째 — 죽으면 다음)에게만 부른다(챔피언 팩이 같은 위협을 겹쳐 쏘지 않게 · 하수인은 위협을 만들지 않는다).
8. **다시 잠**: 깨어 있는데 플레이어에서 `MON.leash`(36m) 넘게 `MON.leashSec`(3초) 머물면 잠든다(그 자리에서 · 생명 유지). **리뷰 수정**: 어느 흐름장으로도 닿지 않아 직선으로 미는 chase 가 연속 `MON.leashSec` 이어져도 같다(`ax.b.lostAt` — 전에는 흐름장 밖 깬 몬스터가 벽에 붙어 영영 섰다 · 벽 너머 메테오의 안전 지대).
9. `targeting = awake && 거리 ≤ 15 && act !== 'flee'`.

### 5.18 게이지 · 수호자 (P2 `rift.js` + P3)

- 처치마다(`phase === 'active'` · `!flags.noGauge`) `gauge += RANKS[rank].gauge × type.gauge × early`(%) · `GAUGE` — `early` = rank ∈ {normal, minion}이면 `earlyGaugeMulOf(rift.level)`(밸런스 게이트 — 균열별 배열 `RIFT.earlyGaugeMul` [1.5, 1.35, 1.2, 1.1] · 균열 5 이상 1 · 옛 W1 수정: 균열 ≤ 2 × 1.6 — 균열 3 에서 1 로 끊겨 봇이 7.5분 판을 7~8번 돌았다 · **피드백 2**: 입문 구간 6칸 [1.25, 1.2, 1.15, 1.15, 1.1, 1.05] · 균열 7 이상 1 — 일반 생명 × 1.6 뒤 균열 4~6 판이 6분을 넘어 봇이 그 레벨에 묶였다), 아니면 1(첫 판들의 기본 공격뿐인 시간을 줄이는 손잡이 — §7.14). `gauge ≥ 100` → `gauge = 100` · `phase = 'guardian'` · 자리 = `findGuardianSpot(ctx)`(P3 — 플레이어에서 8~10m · 걷기 가능 · 시야) · `rift.guardianSpawn = {x, z, at: tick + ticks(RIFT.guardianDelay 2.0)}` · 비적대 효과 `guardianSpawn` · `GAUGE_FULL` · `HINT gauge`.
- `at` 틱: `spawnGuardian(ctx, x, z)`(P3 — 종류는 균열을 채울 때 정해 둔 `rift.guardianType`) → `guardianId` · `GUARDIAN_APPEAR`. 수호자는 바로 깨어 있다. (W1 수정 4) `at` 전에 플레이어가 쓰러져 부활로 떠나면 부활 commit(`settleOnRespawn`)에서 세우고 바로 재운다(§5.10).
- 수호자 처치 → §5.10 「완료 뒤」.

---

## §6 모듈별 공개 API

다른 패키지가 부르는 것만 적는다. 시그니처 · 반환 모양 · 이름은 고정이다. 「W0」은 P0이 웨이브 0에 낼 상태 — 스텁 동작은 §6.18.

### 6.1 core (P0 — W0에 **완성**)

**`core/constants.js`** (구조 상수만 — 밸런스 수치는 data)

```js
export const TICK_HZ = 30;  export const DT = 1 / 30;
export const MAX_STEPS_PER_FRAME = 5;  export const MAX_FRAME_DT = 0.25;
export const TILE = 2;  export const NAV_CELL = 0.5;  export const NAV_PER_TILE = 4;
export const TILE_VOID = 0, TILE_FLOOR = 1, TILE_WALL = 2;
export const APS_REF = 1.4;                       // 스킬 행동 길이의 기준 공격 속도
export const GAME_ID = 'rift-hunter';  export const GAME_VERSION = '0.1.0';
export const STATE_VERSION = 1;  export const SAVE_VERSION = 1;
export const SAVE_KEYS = { account: 'rift-hunter:account', charPrefix: 'rift-hunter:char:', settings: 'rift-hunter:settings', backupPrefix: 'rift-hunter:backup:' };
export const CHAR_SLOTS = 4;  export const BAG_SIZE = 30;  export const BAG_COLS = 6;  export const STASH_SIZE = 60;  export const SKILL_BAR = 5;  export const LEVEL_CAP = 30;
// 피드백 2 D4(Jay 결정 2026-10-12): BAG_SIZE 40 → 30 · BAG_COLS 8 → 6(6 × 5 — 도중 귀환이 쓰이게 · 드랍률은 그대로) · 옛 세이브의 31~40번째는 §6.11 「가방 칸 수」
export const CLASS_IDS = ['warrior', 'mage'];
export const EQUIP_SLOTS = ['mainHand', 'offhand', 'helm', 'chest', 'gloves', 'boots', 'belt', 'amulet', 'ring1', 'ring2'];
export const ITEM_SLOTS = ['mainHand', 'offhand', 'helm', 'chest', 'gloves', 'boots', 'belt', 'amulet', 'ring'];
export const RARITIES = ['normal', 'magic', 'rare', 'legendary', 'set'];
export const MON_RANKS = ['normal', 'champion', 'elite', 'minion', 'guardian', 'split', 'spawn'];
export const DMG_TYPES = ['phys', 'fire', 'cold', 'lightning'];
export const MATERIAL_IDS = ['scrap', 'dust', 'essence'];
export const TILESET_IDS = ['crypt', 'cavern', 'town'];
export const RIFT_PHASES = ['active', 'guardian', 'complete', 'collapsed'];
export const PLAYER_ACTS = ['idle', 'move', 'attack', 'cast', 'channel', 'dash', 'leap', 'blink', 'recall', 'dead'];
export const MON_ACTS = ['idle', 'move', 'windup', 'strike', 'recover', 'cast', 'channel', 'charge', 'stunned', 'frozen', 'flinch', 'swell', 'flee', 'vanish', 'spawning', 'dead'];
export const MON_TEMPLATES = ['humanoid', 'small', 'quadruped', 'blob', 'nest'];
export const PANEL_IDS = [/* §3.1 PanelId 21개 그대로 */];
// (W0 스캐폴드가 더한 것) 카메라 상수 — view 와 봇 시야 산수가 같은 값을 본다(§0.2 · §9.3)
export const CAM_AZIMUTH = π/4, CAM_ELEVATION = 55°(rad), CAM_FOV = 40, CAM_DISTANCE = 24, CAM_DISTANCE_MIN = 16, CAM_DISTANCE_MAX = 32, CAM_ZOOM_STEP = 2, CAM_LEAD = 0.12;
export const HINT_IDS = ['controls', 'labels', 'elites', 'bagFull', 'death', 'skills', 'gauge', 'town'];
export const TOWN_OBJECT_IDS = ['blacksmith', 'general', 'gambler', 'mystic', 'stash', 'riftStone', 'townPortal'];
export const SHOP_IDS = ['blacksmith', 'general', 'gambler', 'mystic'];
```

**`core/events.js`** — `EV`(§4의 키 → 문자열 전부)와:

```js
export class EventBus {
  on(name, fn)          // → off 함수
  once(name, fn)        // → off 함수
  off(name, fn)
  onAny(fn)             // fn(name, payload) — onAny 리스너가 이름 리스너보다 먼저. → off 함수
  emit(name, payload = {})   // 등록 순서대로 동기 호출. 예외 전파. 시작 시점의 리스너 목록으로 돈다
  clear()
  count()               // 등록된 리스너 수(누수 검사용)
}
```

**`core/rng.js`** — mulberry32. 상태는 `{s}` 순수 객체.

```js
export function seedRng(seed)          // → {s: uint32} (seed 0이면 0x9e3779b9)
export function makeRng(stateObj)      // → Rng — stateObj.s 를 직접 고친다
/** @typedef {Object} Rng
 *  next() → [0,1) · range(a, b) → [a, b) · int(a, b) 양끝 포함 · chance(p) · sign() → ±1
 *  pick(weights) → 키: Record<string, number> (데이터에 적힌 키 순서로 누적) 또는 Array<{id, w}> → id. 합 ≤ 0 이면 null
 *  pickIndex(arr) → 가중치 배열의 인덱스 · shuffle(arr) → 제자리 Fisher–Yates */
```

**`core/math.js`** — 전부 순수 함수

```js
export function clamp(v, lo, hi) / clamp01(v) / lerp(a, b, t) / invLerp(a, b, v) / smoothstep(e0, e1, x) / approach(cur, target, maxDelta)
export function deg2rad(d) / wrapAngle(a) /* (−π, π] */ / angleDiff(from, to) / lerpAngle(a, b, t) / turnToward(cur, target, maxStep)
export function fwdX(yaw) /* sin */ / fwdZ(yaw) /* cos */ / rightX(yaw) /* −cos */ / rightZ(yaw) /* sin */ / yawOf(dx, dz) /* atan2(dx, dz) */
export function v2(x, z) / v2add(a, b) / v2sub(a, b) / v2scale(a, k) / v2len(a) / v2dist(a, b) / v2dist2(a, b) / v2norm(a) /* 길이 0이면 {0,0} */ / v2lerp(a, b, t) / v2copy(a)
export function segPointDist(ax, az, bx, bz, px, pz)   // 선분–점 거리
export function round1(v) / roundTo(v, decimals)
```

**`core/time.js`**: `ticks(sec)`(= `Math.max(0, Math.round(sec × TICK_HZ))`) · `secOf(t)` · `progress(start, end, tick)`(0..1 · end ≤ start면 1) · `shiftTicks(obj, delta)`(§5.11의 이름 규칙으로 절대 틱을 제자리에서 민다 — 순수 · 재귀).

**`core/hash.js`**: `stableStringify(obj)`(키 정렬 · 타입 배열은 일반 배열로) · `fnv1a(str)` → 8자리 16진 · `hash32(...ints)` → uint32 · `hashState(state)`(= `fnv1a(stableStringify(events · flags를 뺀 상태))`).

**`core/inputFrame.js`**: `NEUTRAL_INPUT` · `makeInput(partial)`(§3.2).

**`core/spatialHash.js`**:

```js
export class SpatialHash {          // 순수 JS · 상태가 아니다(ctx.space)
  constructor(cell = 2)
  clear()
  insert(id, x, z, r)               // 원이 걸치는 칸마다 등록
  query(x, z, r, out = [])          // 그 원과 칸이 겹치는 id(중복 없이 · 삽입 순) → out
  get size()
}
```

**`core/shapes.js`**: `overlaps(shape, x, z, rb)`(§3.6의 정의 그대로 — 판정의 정본) · `shapeBounds(shape)` → `{x0, z0, x1, z1}` · `shapeArea(shape)`(테스트용) · `circle(x, z, r)` · `cone(x, z, r, facing, angle)` · `line(x, z, facing, len, width)` · `ring(x, z, r0, r)`(만들기 도우미).

### 6.2 `data/index.js` (P0 — **완성**)

```js
export const CLASSES_BY_ID, SKILL_NODES_BY_ID, MONSTERS_BY_ID, RANKS_BY_ID, MON_AFFIXES_BY_ID, PACKS_BY_ID, GUARDIANS_BY_ID,
             BASES_BY_ID, ITEM_AFFIXES_BY_ID, LEGENDARIES_BY_ID, SETS_BY_ID, SET_PIECES_BY_ID, TILESETS_BY_ID, TREASURE_BY_ID;
export function getClass(id) / getNode(id) / getMonster(id) / getRank(id) / getMonAffix(id) / getPack(id) / getGuardian(id)
              / getBase(id) / getItemAffix(id) / getLegendary(id) / getSet(id) / getSetPiece(id) / getTileset(id) / getTreasure(id)
              // 없는 ID면 throw(데이터 오류 — 테스트가 잡는다). 세이브 정화는 *_BY_ID[id] 존재 검사로 한다(throw 하지 않는다)
export function getMonDef(typeId)           // MONSTERS_BY_ID[typeId] ?? GUARDIANS_BY_ID[typeId] — 없으면 throw. sim · view · ui · bot의 몬스터 종류 조회는 전부 이것(두 표의 ID는 겹치지 않는다 — data.schema.test)
export function getSkillDef(id)             // 노드 ID면 node.skill · 'bash' · 'magicBolt'면 BASIC_SKILLS 행 — 없으면 throw(describeSkill · skillReady가 기본 공격도 받는다)
export function nodesOf(cls)                // 그 클래스 노드(배열 순서)
export function activesOf(cls)              // 액티브만
export function basesFor(slot, cls)         // 그 부위 · 클래스(cls null 공용 포함)
export function affixesFor(slot)            // 그 부위가 허용하는 ITEM_AFFIXES
```

### 6.3 `sim/state.js` (P0 — **완성**)

```js
export function createGameState({seed, account = null, devSession = false})   // char null · scene 'town' · rift null · rng 넷 = seedRng(hash32(seed, k)) k = 1..4
export function createAccount()                // chars [null×4] · stash [null×60] · nextItemId 1 · lastSlot -1
export function createPlayerState()            // §3.7 PlayerState 모든 필드(pos 0,0 · life 1 · lifeMax 1 · act 'idle' · sk {hitIds:[], hits:0, nextAt:-1} · knock null · potionQueuedUntil 0 · killedBy null …)
                                               //   life 1은 자리 값이다 — 캐릭터를 붙이는 쪽이 refreshStats → resetPlayerForScene({full:true})를 부른다(§6.8 · §5.11)
export function createTownState()
export function createRiftState({level, seed, tileset, mapId, map, tick = 0})   // openedAt = tick · phase 'active' · gauge 0 · lives RIFT.lives · leftAt -1 · explored 0×(w×h) · checkpoint = map.spawn · stats = createRunStats()
export function createRunStats()
export function createMeter()                  // dealt/taken 0×150 · killTicks [] · swarmArmed true
export function createMonStatus()              // 시각 필드는 -1(없음) · chill 0 — 「없음」인 절대 틱은 상태 전체에서 -1(player.deadAt · hitstopAt · failAt · mon.deadAt · sleepAt · rift.rootLockUntil)
export function emptyEquip()                   // {mainHand:null, …, ring2:null}
export function emptyArray(n)                  // [null × n]
```

### 6.4 `sim/entities.js` (P0 — **완성**)

```js
export function getMonster(ctx, id)            // → MonsterState|null (ctx 안의 id 색인 — ctx.monVer가 바뀌면 다시 만든다 · gone · dead도 돌려준다 — 부르는 쪽이 본다)
export function addMonster(ctx, mon)           // rift.mons.push · ctx.monVer += 1
export function monstersIn(ctx, shape, {alive = true, awakeOnly = false, exclude = null} = {})   // overlaps(shape, mon.pos, mon.r) · gone 제외 · awakeOnly면 ctx.space로 거르고, 아니면 shapeBounds로 걸러 전수
export function nearestMonster(ctx, x, z, maxR, filter = null)
export function rebuildSpace(ctx)              // 깨어 있고 살아 있는(hp > 0) 몬스터 → ctx.space
export function awakeCount(ctx) / aliveCount(ctx)
export function addProj(ctx, p) / addEffect(ctx, e) / addDrop(ctx, d)
export function getDrop(ctx, id) / removeDrop(ctx, id)   // getDrop은 gone이면 null · removeDrop = drop.gone 표시(배열에서는 removeMarked가 뺀다)
export function removeMarked(ctx)             // cleanup(§5.1-7)만 부른다 — gone · 시체 시간 지난 몬스터 · until ≤ tick 투사체 · end ≤ tick 효과 · gone 드랍을 배열에서 뺀다(뒤에서부터) · 몬스터가 빠졌으면 ctx.monVer += 1
export function getObject(ctx, id)             // 마을 map.objects 또는 rift.portals → MapObject 꼴 {id, kind, x, z, r, h, …}|null
                                               //   균열 포털은 {id, kind:'riftPortal', portalKind:'recall'|'exit', x: pos.x, z: pos.z, r, h: PICKUP.objectH}로 정규화 · h 없는 마을 물체는 h = PICKUP.objectH
export function playerRef(ctx)                 // = ctx.state.player
```

### 6.5 `sim/world/nav.js` (P0 — **완성** · 모든 sim 패키지가 쓴다)

```js
export function tileAt(map, x, z)              // TILE_* (밖이면 TILE_VOID)
export function cellIndex(map, x, z)           // 내비 칸 인덱스 · 밖이면 -1
export function cellCenter(map, idx)           // → Vec2
export function isWalkable(map, x, z)          // 그 점의 내비 칸이 0
export function isWalkableR(map, x, z, r)      // 반지름 r 원이 막힌 칸과 겹치지 않는다(칸 사각형과 원의 거리)
export function moveCircle(map, pos, r, dx, dz)   // → 새 Vec2 · 0.25m 이하 잘게 나눠 축별로 미끄러진다 · 막히면 그 축 성분 0 · 결과는 늘 걷기 가능
export function losClear(map, ax, az, bx, bz, {props = false} = {})   // 벽 타일(props면 막는 소품 칸도)이 선분을 막지 않는다
export function raycastWalk(map, ax, az, bx, bz, r)    // a에서 b로 가며 반지름 r이 지나갈 수 있는 마지막 점
export function nearestWalkable(map, x, z, maxR = 3)    // 나선 탐색 · 없으면 null
export function randomWalkableNear(map, rng, x, z, rMin, rMax, tries = 12)   // → Vec2|null (isWalkableR 0.5)
export function inBounds(map, x, z)
```

### 6.6 sim-world (P4)

```js
// world/mapgen.js
export function generateRift(seed, level)      // → MapData(kind 'rift') — 결정적 · ≤ 150ms · 모든 바닥이 spawn에서 닿는다 · 방 MAPGEN.rooms(10..14)
// world/townMap.js
export function buildTownMap()                 // → MapData(kind 'town') — data/town.js 배치 그대로 · objects 에 TOWN_OBJECT_IDS 전부 + 장식
// world/path.js
export function findPath(map, from, to, {r = 0.4, maxNodes = PATHING.maxNodes} = {})
       // W1 확정: 마지막 점은 몸 r에 맞는 점으로 옮긴다(≤ PATHING.fitR 1.5m) · 벽 한가운데를 누르면 이쪽 벽 앞 · 벽 너머 빈 곳은 to → from 선의 첫 바닥 ·
       //   더 가까이 갈 곳이 없으면 [] · maxNodes = 펼친 칸 수(경로 ~80m까지 늘 찾고 그 너머는 부분 경로)
       // → Vec2[] 경유점(시작점 제외 · 마지막 = 목적지). to가 막혔으면 nearestWalkable(to)로 · 닿지 않으면 탐색한 칸 중 to에 가장 가까운 칸까지.
       //   8방향 A*(모서리 자르기 금지 · r 여유는 isWalkableR) → 줄 당기기(losClear + isWalkableR 표본) · 시작과 목적지가 시야 안이면 [to]
       //   최종 게이트: 시작 칸에서만 — 시작점에서 대각선 이웃 칸 가운데까지 몸이 곧장 지나가면 모서리 규칙을 넘는다(벽을 눌러 r 앞에 선 자리에서 시작 칸을 못 떠나던 것)
// world/flow.js
export function createFlow(map)                // → FlowField(dist 0xffff로 채움)
export function updateFlow(flow, map, pos, tick, force = false, opts = null)   // (opts 리뷰 수정: {maxSteps, everySec, recenterCells} — 먼 흐름장) → boolean · 플레이어 칸이 FLOW.recenterCells(2칸) 넘게 바뀌었거나 ticks(FLOW.everySec 0.2) 지났거나 force면 BFS(8방향 · 최대 FLOW.maxSteps 걸음)
export function flowDir(flow, map, x, z)       // → 단위 Vec2|null — 이웃 8칸 중 dist가 가장 작은 칸 쪽(같으면 인덱스 작은 쪽) · 닿지 않으면 null (인자 넷 — 이것이 정본)
export function flowDist(flow, map, x, z)      // → 걸음 수|Infinity
// W1 확정: FlowField.dist는 정수 가중 거리(곧은 칸 FLOW.orthCost 5 · 대각 7 · 막힌 칸 옆 +4 — 균일 BFS의 45° 지그재그 · 벽 붙기 방지)다.
//   걸음 수가 필요하면 flowDist(= dist / orthCost)를 쓴다 — flow.dist를 직접 읽지 않는다. flowDir은 모서리 자르기 금지를 더했다.
```

### 6.7 sim-player (P1)

```js
// player/controller.js
export function updatePlayer(ctx, input)       // §5.1 4(균열) · 2(마을)의 플레이어 한 틱 전부
export function placePlayer(ctx, x, z, facing) // 위치 · prevPos · 경로 · 의도 · 행동 초기화(장면 전환 · 부활 · 디버그)
export function resetPlayerForScene(ctx, {full})   // full이면 생명 · 마나 가득 · 분노 0 · 버프 · 상태 · sk · knock 정리(캐릭터 붙이기 · 부활 · 새 균열 — refreshStats 뒤에 부른다 · 순서는 §5.11 · §6.8)
// player/actions.js
export function onPlayerDamaged(ctx, dmg)      // P2가 ctx.hooks로 부른다 — 분노 생성 · 귀환 취소
export function isActionable(player)
// player/skills.js
export const SKILL_BEHAVIORS                   // {cleave, boltBasic, spinSlash, quake, dash, spin, buff, leap, fireball, meteor, nova, shield, chain, blink} — 피드백 1: meleeBasic → cleave · cone → spinSlash
export function skillParams(ctx, nodeId)       // 행의 skill.params + 찍은 변형의 patch + 낀 전설(패치형 · 그 스킬)의 patch → 새 객체(§8.4)
export function describeSkill(stats, nodeId, rank)   // 순수 — {coefPct, dmgMin, dmgMax(치명타 전 · 저항 없는 대상), cost, cd, range, radius, extra:Object} · ui 툴팁 · 스킬 패널 전/후 · nodeId는 노드 ID 또는 BASIC_SKILLS ID('bash' · 'magicBolt')
export function skillReady(state, stats, nodeId)     // 순수 — {canAfford, cooldownLeft, cooldownTotal (초), ready} · HUD 쿨다운 부채 · BASIC_SKILLS ID도 받는다
// player/equipHooks.js
export const EQUIP_HOOKS                       // 전설 훅 12 — §8.5
export function onPlayerKill(ctx, mon, lastHit)      // ctx.hooks.onPlayerKill 구현(처치 폭발 · 빙결 파쇄 …)
export function globeMods(ctx)                 // ctx.hooks.onGlobe 구현 → {mul: 1|2, radiusAdd: 0|1.0} (사건형 전설 at 'globe' — 전설이 없으면 {mul:1, radiusAdd:0})
```

### 6.8 sim-session (P2)

```js
// ctx.js
export function createCtx(state, {map = null, riftMap = null} = {})   // §3.10 — emit은 state.events에 · hooks = §3.10 목록(P3 넷 · P1 셋 · onPlayerKilled = rift.js killPlayer) · monVer 0 · 균열 장면이면 ctx.flow = createFlow(map)
// combat.js
export function playerHit(ctx, mon, spec)      // → HitResult (§5.6)
export function playerHitShape(ctx, shape, spec)   // → HitResult[] (monstersIn · 가까운 순 · maxTargets)
export function monsterHitPlayer(ctx, mon, spec)   // → PlayerHitResult (spec = MonAttackSpec) · dmg > 0 이고 !spec.noAffix면 ctx.hooks.onMonHitPlayer(§5.6)
export function hazardHitPlayer(ctx, spec)         // → PlayerHitResult (출처가 효과 · 투사체)
export function damageMonsterRaw(ctx, mon, amount, type, by = 'player')   // 화상 · 가시 · 폭발 — 치명타 · 보너스 없음 · 저항만 · HIT{dot}
export function tickBurns(ctx)                 // §5.1-6 — 화상 틱(burn.nextAt마다 damageMonsterRaw · fire · dot) · status.js는 combat.js를 import하지 않는다
export function healPlayer(ctx, amount, source)    // PLAYER_HEAL(source가 'hit'이면 이벤트 없음)
export function healMonster(ctx, mon, amount)
export function DRa(armor, level) / DRr(res, level)   // §5.6 — loot/stats.js의 것을 다시 내보낸다(정본은 stats.js)
// status.js
// W1 확정: apply*에는 데이터 값을 넘긴다 — 등급 배율(stunMul · knockMul · freezeMul) · 강인함 · 구조물 · 면역 창은 status.js가 적용한다(부르는 쪽이 미리 곱하지 않는다).
//   기절 · 빙결 · 경직 · 넉백이 예비 공격을 취소하면 그 몬스터 몸에 붙은 예고(cancelOnSrcDeath · hitAt 전)도 end = tick으로 지운다.
export function applyStun(ctx, mon, sec) / applyChill(ctx, mon, pts) / applyBurn(ctx, mon, dps) / applyShock(ctx, mon) / applySlow(ctx, mon, pct, sec)
             / applyKnock(ctx, mon, fromX, fromZ, dist) / applyFlinch(ctx, mon) / setInvuln(ctx, mon, sec)
             / slowPlayer(ctx, pct, sec) / rootPlayer(ctx, sec) / addBuff(ctx, id, sec, value) / removeBuff(ctx, id)
export function updateStatus(ctx)
export function monSpeedMul(mon, tick)         // 냉기 · 감속 · 속성 배율 → 이동 배율(P3가 쓴다)
export function monAtkSpeedMul(mon, tick)
// conds.js
export const CONDS
export function condStatsFor(ctx, mon, side)   // side 'offense'|'defense' → 참인 조건의 합(PlayerStats 단위)
// projectiles.js
export function spawnProjectile(ctx, def)      // def = {visual, owner, srcId, x, z, facing | vx+vz, speed, range | life, r, pierce = 0, bounce = false, spec, explode = null}
                                               // → Proj · PROJ_SPAWN
// W1 확정: explode가 있는 투사체는 접촉마다 폭발만 한다(접촉한 몬스터도 폭발 원 안에서 한 번) — pierce가 남았으면 pierce − 1 하고 계속(§7.9 꿰뚫는 화염 「맞힐 때마다 폭발」) · 남지 않았으면 끝.
export function updateProjectiles(ctx)         // 이동 → 벽(bounce면 튕김 · 아니면 끝) → 대상 겹침(owner player: 몬스터 · mon: 플레이어 — monsterHitPlayer(ctx, getMonster(srcId), spec) · 출처가 없거나 죽었으면 hazardHitPlayer) → 적중 · 관통 · 폭발 → PROJ_END
// effects.js
// W1 확정: def.spec.shake(선택 · 0..1)가 있으면 hitAt 판정에 SHAKE{amp, sec: COMBAT.shakeSec} · def.spec.onHit.rootSec(선택)이면 판정이 rootPlayer + rootLockUntil(감옥 — raw 0이어도 된다) ·
//   EFFECT_HIT는 hitAt에 한 번 · 비적대 지속 틱은 틱마다 새 actionId + tickHit:true.
export function spawnEffect(ctx, def)          // def = {kind, owner, srcId, packId = -1, hostile, shape, delay (초 · 예고), dur = 0 (초 · 지속), tick = 0 (초 · 지속 판정 간격), spec (null = 표시 전용 예고), tickSpec = null (지속 판정 — null이면 spec), from = null, cancelOnSrcDeath = false}
                                               // → Effect · EFFECT_SPAWN — 시각: start = 지금 · hitAt = start + ticks(delay) · end = hitAt + max(1, ticks(dur)) · tickT = ticks(tick) · nextTickAt = tickT > 0 ? hitAt + tickT : -1
export function updateEffects(ctx)             // cancelOnSrcDeath 검사(§5.16-6) → hitAt에 spec 판정(spec null이면 없음 · 적대: 플레이어가 겹치면 hazardHitPlayer / 비적대: playerHitShape)
                                               //   → 지속 틱(hitAt + tickT부터 tickT마다 · tickSpec ?? spec · 비적대 지속 틱은 틱마다 새 actionId) · end가 지나면 끝(배열에서는 removeMarked) · EFFECT_HIT
// W1 확정: opts.shape(선택)를 받는다 — 플레이어 자리가 아닌 위협(자기 중심 원 · 원뿔 · 선)은 그 모양을 넘긴다(없으면 (x, z) 점). 진행 중 = start ≤ tick ≤ hitAt.
//   H2에 「묶는 예고(spec.onHit.rootSec)가 플레이어 발밑에서 진행 중이면 발밑 새 위협 금지」를 더한다. 돌진 선 · 역병 덩어리 폭발도 packId -1로 이 검사를 거친다.
export function canStartHazard(ctx, packId, x, z, {jail = false, count = 1, srcId = -1} = {})   // §5.9 H1~H4(count = 이번에 만들 표식 수 · srcId가 기절 · 빙결 중이면 false)
export function noteHazard(ctx, packId)
// drops.js
export function spawnDrops(ctx, rolls, x, z)   // DropRoll[] → 바닥 Drop(흩뿌림 §7.6) · DROP_SPAWN · 업그레이드 집계 · HINT labels
export function pickupDrop(ctx, drop)          // → Result — 골드 · 재료 · 포션은 P6 addGold · addMaterials · addConsumable · 구슬은 회복 · 아이템은 addToBag · 주우면 removeDrop(표시)
export function updatePickups(ctx)             // 자동 줍기 반경(골드 · 포션(상한 아래) · 재료 · 구슬 — 구슬 반경 PICKUP.globeR + onGlobe().radiusAdd · 회복 × onGlobe().mul)
// rift.js
export function requestTravel(ctx, travel)     // → Result (§5.11 — 균열에서면 rift.leftAt = tick)
export function requestReturnToRift(ctx)       // → Result — 열린 균열 · 붕괴 아님 · 마을 → requestTravel{to:'rift', reason:'townPortal'} (GameSim.returnToRift와 P1의 마을 포털 도착이 부른다)
export function openRecallPortal(ctx, pos)     // 귀환 완료(P1이 부른다)
export function killPlayer(ctx, killer)        // §5.10 — ctx.hooks.onPlayerKilled의 구현(combat은 import하지 않고 훅으로 부른다 · killer = MonsterState|null)
export function settleOnRespawn(ctx)           // W1 수정(NOTES-W1FIX · §5.10) — 부활 commit(GameSim._enterTown)이 균열을 떠날 때: (W1 수정 4) 출현 예고 중인 수호자를 지금 세움(예고 효과 끝) · 깨어 있는 몬스터를 모두 진정(남은 calmAt · 죽어 있는 동안 깬 팩) · (W1 수정 3) 플레이어 투사체 · 효과 · 화상 · 감전 지움 · 잠든 몬스터(수호자 포함)를 rift.homes 로 · (W1 수정 3) 복귀 지점이 잠든 몬스터의 시야 안이면 가장 가까운 시야 밖 바닥 타일로(returnPos · checkpoint)
export function resolveDeaths(ctx)
export function updateRift(ctx)
export function addGauge(ctx, pct)
export function riftElapsedSec(state)          // 순수 — ticksIn / 30
// town.js
export function updateTown(ctx)                // 복귀 안내 · 포털 상태
// meter.js
export function updateMeter(ctx)
export function meterView(state)               // 순수 — {dps, takenPerSec, killsPerMin, xpPerHour, goldPerHour, elapsedSec, gaugePerMin, targeting, drops}
// pick.js
export function pickHover(state, map, ray, {kinds = ['monster', 'drop', 'object']} = {})   // 순수 — ray = {ox, oy, oz, dx, dy, dz}(월드) → Hover|null(src 'pick')
       // 몬스터: 세로 원기둥(반지름 mon.r · 높이 mon.height — 이미 곱한 값) · 드랍: 높이 0.6 상자(반지름 0.45) · 물체: 원기둥(r · h — 균열 포털 2.5m)
       // kinds 안에서 가장 가까운 교차 · 같은 거리면 몬스터 > 드랍 > 물체 (app의 조합 순서는 §11.5)
```

**`sim/GameSim.js` (P2)**

```js
export class GameSim {
  /** @param {{bus:EventBus, seed:number, account?:AccountState|null, devSession?:boolean}} opts */
  constructor(opts)            // state = createGameState · 마을 맵 = buildTownMap() · ctx = createCtx
  state; ctx; bus;
  start()                      // MAP_LOADED(town) · SCENE_CHANGED{to:'town', reason:'load'} · PLAYER_SPAWNED — 플러시
  step(input)                  // §5.1
  commitTravel()               // → Result (§5.11)
  getMap()                     // → ctx.map
  getStats()                   // → ctx.stats
  // 캐릭터 (app이 세이브를 읽어 넘긴다 — sim은 저장소를 모른다)
  newCharacter({slot, cls, name})      // → {ok, char} | {ok:false, reason:'slot'|'name'} — createCharacter(seed = hash32(state.seed, slot)) · account.chars[slot] · 아래 붙이기 순서 · HINT town · SAVE_REQUEST{all}
  loadCharacter(slot, char)            // → Result — 정화된 CharacterState를 받아 붙인다(같은 붙이기 순서)
                                       //   붙이기 순서: char 붙이기 → refreshStats → resetPlayerForScene({full:true}) → restockShops(ctx) → placePlayer(TOWN.arrive) → CHAR_LOADED
                                       //   (생명 1 · 빈 상점으로 시작하지 않게 — 첫 마을의 대장장이 · 잡화상에 재고가 있다)
                                       //   피드백 2 D4: 붙인 뒤 inv.moveBagOverflowToStash(state) — 옛 세이브(가방 40칸 시절)의 칸 밖 아이템을 칸 안 빈자리 → 보관함 빈칸으로(옮긴 게 있으면 BAG{reason:'stash'} · SAVE_REQUEST{scope:'all', reason:'stash'}) · 둘 다 차면 칸 밖에 남는다(§6.11)
  deleteCharacter(slot)                // → Result — account.chars[slot] = null(지금 캐릭터면 char = null) · SAVE_REQUEST{account}
  unloadCharacter()                    // → Result — 열린 균열이 active · guardian이면 recordRun(result 'abandon') → RIFT_CLOSED{reason:'quit'} → rift = null → char = null
                                       //   W1 확정: abandon 기록은 떼기 전에 캐릭터에 들어간다 — app(quitToTitle)은 부르기 전에 캐릭터 참조를 잡아 두고 뒤에 그 참조로 한 번 더 저장한다
                                       //   → player = createPlayerState() → scene 'town' → SAVE_REQUEST{scope:'all', reason:'quit'} (actions.quitToTitle — app이 상태를 직접 고치지 않는다)
  // 가방 · 장비 (ItemRef = {where:'bag'|'stash'|'equip'|'stock'|'buyback', idx?, slot?, shop?})
  equip(ref, toSlot = null) / unequip(slot) / moveItem(from, to) / sortBag() / sortStash() / setItemLocked(ref, on)
  // 스킬
  learnSkill(nodeId) / setSkillBar(idx, nodeId) / resetSkills()
  // 상점 (마을에서만 · 균열이면 {ok:false, reason:'notInTown'})
  buy(shop, idx) / sell(ref) / sellMany(refs) / buyback(idx) / repairAll() / salvage(ref) / salvageMany(refs)
  craft(slot) / gamble(slot) / rerollOffer(ref, affixIdx) / rerollChoose(choice) / rerollCancel()
  buyPotions(n) / buyScrolls(n) / takeFree(what)       // what 'potion'|'scroll'
  // 균열
  openRift(level, seed = null)         // → Result — 마을 · 1 ≤ level ≤ riftUnlocked · requestTravel{openRift}
  returnToRift()                        // → Result — requestReturnToRift(ctx)(열린 균열 · 붕괴 아님 · 마을에서)
  leaveRift()                           // → Result — 완료 단계에서만(무료 나가는 포털과 같다 · 완료 패널의 「마을로」) · rift.returnPos = player.pos(남은 전리품을 주우러 그 자리로 돌아온다)
  respawn()                             // → Result — 사망 중
  markHint(id)
  addPlaySec(sec)                       // 마을에서 패널이 열려 step하지 않은 실제 시간을 app이 더한다(char.playSec — sim은 시계를 모른다 · 0 ≤ sec ≤ 60)
  // 조회(상태를 바꾸지 않는다)
  previewEquip(ref)                     // → compareEquip 결과(§6.10)
  previewRift(level)                    // → RiftPreview
  priceOf(ref, kind)                    // → 정수 | null — kind 'sell'|'buy'|'buyback'|'reroll'
  // 디버그(§11.8)
  debugGotoTown() / debugOpenRift(level, seed) / debugCompleteRift() / debugSpawnPack(typeId, rank, affixIds = null, at = null)
  debugKillAll() /* W2 확정: 사망 훅이 세운 몬스터(분열 사본)까지 — 살아 있는 것이 없을 때까지 resolveDeaths를 되풀이 */ / debugGrant({gold, xp, materials, items}) / debugDropItem({rarity, slot, ilvl}) / debugSetLevel(n) / debugSetRiftUnlocked(n)
  debugSetInvincible(on) / debugRevealMap() / debugResetSkills() /* 무료 — 브리프 §3.3 */ / debugLoadState(state, map, riftMap = null)
}
```

모든 명령은 끝에서 플러시한다. 명령은 틱 밖에서만 불린다(§5.1).

### 6.9 sim-monsters (P3)

```js
// monsters/spawn.js (레지스트리를 import하지 않는다 — §2.2 · monsters.js가 넷을 다시 내보낸다)
export function monsterStats(typeId, rank, level, affixes)   // 순수 — {hpMax, dmg, speed, r, height, scale, res, atkSpeedMul, immune} (§5.6 몬스터 수치 · getMonDef · 저항 상한 MON.resCap)
export function spawnMonster(ctx, {typeId, rank, level, affixes = [], packId = -1, x, z, facing = 0, awake = false, reason = null, flags = {}})
                                               // → MonsterState (수호자는 typeId = GUARDIANS 키 — getMonDef) · mods 적용 → ctx.hooks.onMonSpawn(속성 onSpawn) · reason이 있으면 MON_SPAWNED
export function startAttack(ctx, mon, atkId)   // 예비 시작(§5.17-5 — 빠름 규칙) · readyAt · MON_ACT
       // W1 확정: 선택 넷째 인자 opts {act, facing, aim, lockAim} · 반환 = 예비 길이(초) — 그 틱 spawnEffect의 delay로 쓰면 hitAt === actHit
export function findGuardianSpot(ctx)          // 플레이어에서 8~10m · 걷기 가능 · 시야
// monsters/monsters.js
export function updateMonsters(ctx)            // §5.17
export { monsterStats, spawnMonster, startAttack, findGuardianSpot } from './spawn.js'
export function wakePack(ctx, packId, why)     // 'sight'|'damage'|'link'|'debug' · MON_WAKE
export function onMonSpawn(ctx, mon)           // ctx.hooks 구현 — 속성 onSpawn
export function onMonDamaged(ctx, mon, hit, spec)   // ctx.hooks 구현 — 팩 깨움 · 시전 끊기(주술사 부활 · 마녀) · 속성 onDamaged
export function onMonHitPlayer(ctx, mon, res, spec)   // ctx.hooks 구현 — mon.affixes의 onHitPlayer(근접 · 투사체 · 돌진 적중 뒤 · spec.noAffix면 부르지 않는다)
export function onMonDeath(ctx, mon)           // ctx.hooks 구현 — 속성 onDeath · 행동 훅 death(역병 덩어리 웅덩이) · 팩 정리
// monsters/behaviors.js
export const BEHAVIORS                         // {melee, fallen, shaman, archer, shield, charger, bloater, nest, guardian} — §8.1
// monsters/packs.js
export function populateRift(ctx)              // map.packSlots → 팩 · 몬스터(잠든 채) · rift.guardianType · 채우기 난수 §5.14
export function spawnPack(ctx, {typeId, rank, affixes = null, x, z, awake = false})   // 디버그 · 측정용 — 챔피언 팩(2~4) · 정예(+하수인) · normal(그 종 팩 하나) → packId
export function rollAffixes(rng, typeDef, count, level)   // 배제 규칙 지키며 가중치로 → string[]
export function eliteName(rng)                 // → [elite.a.N, elite.b.M]
// 수호자
export function spawnGuardian(ctx, x, z)       // monsters.js — GUARDIAN_IMPLS[rift.guardianType].init 호출(findGuardianSpot은 spawn.js)
```

**훅 인터페이스**(§8.2 · §8.3에 자세히):

```js
// affixHooks/<id>.js — 각 파일이 이것 하나를 export
export const hook = {
  onSpawn(ctx, mon, row) {},             // 선택 — 스폰 직후(mods는 프레임워크가 이미 적용)
  onAwakeTick(ctx, mon, row, st) {},     // 선택 — 깨어 있는 매 틱(st = mon.ax[row.id] — 처음엔 {}) · hazard 속성은 팩의 대표에게만(§5.17-7) · 기절 · 빙결 · 사라짐 중에도 불린다(새 위협만 막힌다)
  onDamaged(ctx, mon, row, st, hit, spec) {},   // 선택 — 피해(dmg > 0)를 받은 뒤
  onHitPlayer(ctx, mon, row, st, res, spec) {}, // W1 확정: 여섯째 인자 spec(그 공격의 MonAttackSpec — 화염 강화 「같은 공격 피해의 30%」) · 선택 — monsterHitPlayer가 이 몬스터의 근접 · 투사체 · 돌진으로 dmg > 0을 준 뒤(res = PlayerHitResult — ctx.hooks.onMonHitPlayer · spec.noAffix면 안 돈다)
  onDeath(ctx, mon, row, st) {},         // 선택 — 사망 처리 중
};
// guardians/<id>.js
export const impl = {
  init(ctx, mon, def) {},                // 스폰 직후 — 고유 기술 타이머
  think(ctx, mon, def) {},               // 행동 가능할 때마다 — 고유 기술 시작(canStartHazard → startAttack → 그 틱에 spawnEffect(delay = 예비 길이 · 실제 spec) → noteHazard) 또는 이동 목표
  strike(ctx, mon, def, atk) {},         // 고유 기술의 판정 틱(kind 'cast') — 소환 · 투사체만(바닥 효과는 think에서 이미 만들었다 — §8.3)
};
```

### 6.10 loot (P5)

```js
// loot/rollDrops.js
export function rollDrops(rng, {rank, level, cls, mf = 0, gf = 0, blp = 0, blpOn = true, newId})   // → {drops: DropRoll[], blp}  (§5.13)
export function rollRarity(rng, {rank, level, mf, blp, blpOn, guaranteed = false})                 // → {rarity, blp}
export function rollGear(rng, {rarity, level, cls, newId, slot = null, slotWeights = SLOT_WEIGHTS, ownClassOnly = false})
       // → Item — slot이 있으면 그 부위(반지 'ring')로 · 없으면 slotWeights로 뽑는다 · ownClassOnly면 무기 · 보조가 자기 클래스만
       //   · 전설 · 세트 후보가 그 부위 · 클래스에 없으면 희귀로 내린다 · 부위 · 기본형 · 전설/세트 고르기 + rollItem
       //   (드랍 · 도박 · 제작 · 대장장이 재고 · 개발 캐릭터가 같은 함수를 쓴다 — P6이 고르기를 다시 구현하지 않는다)
// loot/rollItem.js
export function rollItem(rng, {baseId, tier, rarity, ilvl, cls, legendaryId = null, setPieceId = null, newId, slotBias = null})   // → Item
export function makeItem({baseId, tier = 0, ilvl = 1, rarity = 'normal', id, affixes = [], legendaryId = null, setPieceId = null})  // 난수 없이(v = 1) — 시작 장비 · 고정 상태 · 테스트
export function itemValue(item)                // §7.10
export function rerollAffix(rng, item, affixIdx, cls)   // → ItemAffix 후보 하나(같은 kind · 그 아이템의 다른 옵션과 중복 없음 · 같은 ilvl 티어 규칙)
export function tierFor(rng, ilvl) / affixValue(rng, def, tier, ilvl)
// loot/theory.js (순수 · 분석 패널 「이론값」 · 테스트)
export function rarityDist({rank, level, mf = 0, blp = 0, blpOn = false, guaranteed = false})   // → Record<Rarity, number> (합 1)
export function tcDist(rank)                   // → {none, gold, potion, globe, material, gear} 한 번 뽑기 확률
export function expectedPerKill({rank, level, mf = 0})   // → {gear, gold(개수), goldAmount(기대 골드), potion, globe, material, byRarity}
export function slotDist(cls)                  // → Record<ItemSlot, number> (일반 · 마법 · 희귀 = SLOT_WEIGHTS · W1 확정: 선택 둘째 인자 {rank, level, mf, blp, blpOn}면 전설 · 세트까지 섞은 정확한 분포)
export function specialCandidates(rarity, {slot, cls, ownClassOnly})   // W1 확정 — 전설 · 세트 후보의 정본 → Array<{id, w}>(빈 배열 = 희귀로 내림) · rollGear · gambleOdds가 같이 쓴다
export function affixCountDist(rarity)         // → Record<number, number>
export function tierDist(ilvl)                 // → [p1..p5]
export function effectiveMF(mf)                // §5.13
// loot/simulate.js (순수 · 분석 패널 · 측정 · 테스트 공용)
export function createDropSim({rank, level, cls, mf, blpOn, seed})   // → {run(n) → 실제로 굴린 수, result() → SimResult, reset()}
/** SimResult = {kills, gear, byRarity, bySlot, affixCount, tiers:[5], gold, goldAmount, killsToLegendary:number[](전설 사이 처치 수 목록), maxGearGap} */
// loot/stats.js
export function computeStats(char, {riftLevel = null} = {})   // → PlayerStats (§5.6 · char가 null이면 throw하지 않고 FIST · 레벨 1 시트)
export function DRa(armor, level) / DRr(res, level)
export function powerScore(stats)
export function weaponVisual(item)             // view용 — {look, tier, rarity, hands} | null
// loot/compare.js
export function compareEquip(char, item, {riftLevel = null, slot = null} = {})
       // → {slot:EquipSlot|null, ok:boolean, reason?:'class'|'level'|'slot', before:PlayerStats, after:PlayerStats,
       //    delta:{sheetDps, lifeMax, armor, res:Record<DmgType, number>, ehp, power}, upgrade:boolean}
       //   반지는 slot이 없으면 power가 더 크게 오르는 칸 · 양손 무기는 보조를 뺀 시트 · 보조는 양손 무기면 ok:false 'slot'
export function isUpgrade(stats, char, item, minGain = COMPARE.minGain)   // → boolean (§5.13-5) · 피드백 2 D5: 넷째 인자(선택) — 기본 0.5%(화면 화살표 · 봇 장착) · 균열 기록 · 측정은 COMPARE.upgradeGain(3%)을 넘긴다(sim/drops.js) · 유한수 ≥ 0 이 아니면 기본값
export function bestSlotFor(char, item)        // → EquipSlot|null
```

### 6.11 progression (P6)

```js
// progression/character.js
export function createCharacter({slot, cls, name, newId, seed = 1})   // → CharacterState (레벨 1 · START 그대로 · 시작 장비 makeItem · 상점 빈 재고 · stockRun -1 · char.seed = seed · lastRiftLevel 1)
export function summaryOf(char)                // → account.chars 한 칸
// progression/inventory.js
export function findItem(state, itemId)        // → ItemRef|null
export function itemAt(state, ref)             // → Item|null
export function addToBag(ctx, item, reason = 'pickup')   // → {ok:true, idx} | {ok:false, reason:'bagFull'} — 빈 첫 칸(피드백 2: freeBagIdx — 든 아이템 ≥ BAG_SIZE 면 'bagFull') · BAG{reason}
export function addGold(ctx, amount, reason)   // → number(더한 양) — 정수 · amount ≥ 0 · GOLD · 균열이면 rift.stats.gold · meter.runGold에도
export function addMaterials(ctx, mats, reason) // MATERIALS
export function addConsumable(ctx, what, n)    // what 'potion'|'scroll' → 실제로 더한 수(ECON 상한까지)
                                               // char.gold · materials · potions · scrolls를 고치는 곳은 P6 파일뿐(줍기 · 디버그 · 보상 · 거래 모두 이 함수로)
export function setItemLocked(ctx, ref, on)    // → Result — item.flags.locked · BAG{reason:'move'}
export function equip(ctx, ref, toSlot = null) // → Result — 클래스 · 레벨 · 부위 검사 · 양손 무기는 보조를 가방으로(바꾼 뒤 든 아이템이 BAG_SIZE 를 넘으면 'bagFull' — 피드백 2) · 낀 것은 원래 칸으로 · refreshStats · EQUIPPED · SAVE
export function unequip(ctx, slot)             // → Result — 가방으로(freeBagIdx — 넘친 가방이면 'bagFull')
export function moveItem(ctx, from, to)        // → Result — 가방 ↔ 가방(자리 바꿈) · 가방 ↔ 보관함(마을에서만 — 'notInTown') · 보관함 ↔ 보관함 · 피드백 2: 보관함 → 가방 빈칸은 「새로 넣기」(든 아이템 ≥ BAG_SIZE 면 'bagFull' · 칸 밖 빈자리 'invalid' · 자리 바꿈은 된다) · 가방이 낀 이동 뒤 settleBag
export function sortBag(ctx) / sortStash(ctx)  // 등급(높은 것 먼저) → 부위 → ilvl 내림 → id · 피드백 2: sortBag 뒤 settleBag
// 피드백 2 D4(Jay 결정 2026-10-12) — 가방 칸 수: 가방은 BAG_SIZE(30)칸이다. **가방 배열 길이는 BAG_SIZE 를 넘을 수 있다** — 옛 세이브(40칸 시절)의 31~40번째 ·
//   장착에서 밀려난 것이 보관함에도 못 들어가면 칸 밖(idx ≥ BAG_SIZE · 빈자리 없이 끝에 붙는다)에 그대로 남는다(사라지는 아이템 0). 든 아이템이 BAG_SIZE 아래로 줄 때까지
//   새로 넣지 못한다(줍기 · 사기 · 되사기 · 제작 · 도박 · 벗기 · 보관함에서 꺼내기 · 양손 무기가 보조를 밀어내기 — 모두 'bagFull'). 칸 밖 아이템은 장착 · 팔기 · 분해 · 보관함으로 · 잠금이 된다(ref.idx < bag.length).
//   칸 밖의 빈자리는 놓는 자리가 아니다(moveItem → 'invalid').
export function bagCount(ch)                   // 피드백 2 — 가방에 든 아이템 수(칸 밖 포함)
export function isBagFull(ch)                  // 피드백 2 — bagCount ≥ BAG_SIZE(넘친 옛 세이브 포함) · 줍기 · 봇 줍기 · 도중 귀환 판정(rift.stats.bagFullRecall)이 같은 것을 본다
export function settleBag(ch)                  // 피드백 2 — 제자리 · 아이템 수 그대로: 칸 밖 아이템을 칸 안 빈자리로 당기고 칸 밖 빈자리를 없앤다(길이 = BAG_SIZE + 남은 넘친 수 · 짧으면 BAG_SIZE 까지 null) → 당긴 수
                                               //   GameSim.step 이 bag.length > BAG_SIZE 인 틱마다 부른다(팔기 · 분해 · 보관 뒤 칸이 비면 다음 틱에 당겨진다) · moveItem(가방이 낀 것) · sortBag 뒤에도
export function freeBagIdx(ch)                 // 피드백 2 — 새 아이템을 넣을 칸: 든 아이템 ≥ BAG_SIZE 면 -1 · 아니면 settleBag 뒤 칸 안의 빈 첫 칸(addToBag · unequip · moveItem(보관함 → 가방) · shops 의 사전 검사)
export function moveBagOverflowToStash(state)  // 피드백 2 — 캐릭터를 붙일 때(GameSim.loadCharacter): 칸 밖 아이템 → 칸 안 빈자리 → 보관함 빈칸 순 · 둘 다 차면 칸 밖에 남긴다 → {toBag, toStash, left}
export function applyDeathPenalty(ctx)         // 장착 전부 dur −= ITEM.deathDurLoss(10) (0에서 멈춤) · refreshStats · DURABILITY
export function repairCost(char)               // → 정수 — round(Σ 장착 ITEM.slotValue[slotKey] × PRICES.repairBase × G^(ilvl−1) × (durMax − dur)/durMax) · 등급과 무관(§7.10)
// progression/shops.js (전부 마을에서만 · 결과는 Result + 필요한 필드)
export function restockShops(ctx)              // char.shop.stockRun !== char.runs일 때만: makeRng(seedRng(hash32(char.seed, char.runs, 7)))로
                                               //   대장장이 SHOP.blacksmithStock(rollGear · 장신구 뺀 SLOT_WEIGHTS · ownClassOnly) · 잡화상 장신구 SHOP.generalStock · stockRun = runs · restocks += 1
                                               //   — 같은 판에서 몇 번 돌아와도 같은 재고(산 것만 빠진다) · 새로 고침으로 바뀌지 않는다(저장 §3.11)
export function buy(ctx, shop, idx)            // 'gold' · 'bagFull' · 재고에서 빠진다 · flags.bought · 피드백 2: buy · buyback · craft · gamble 의 가방 사전 검사는 freeBagIdx(ch) < 0(골드만 빠지고 아이템이 안 들어가는 일 없음)
export function sell(ctx, ref) / sellMany(ctx, refs)   // 장착 중인 것은 'equipped' · 잠긴 것은 'itemLocked'(sellMany는 건너뛴다) · 판매가 = priceSell · 되사기 목록 앞에(10개 유지)
export function buyback(ctx, idx)              // 판 값 그대로(복사 · 이득 0)
export function repairAll(ctx)                 // 'nothing' · 골드가 모자라면 주무기 → 갑옷 → 보조 → 나머지 순으로 살 수 있는 만큼 고친다 → {ok:true, partial:true, repaired:EquipSlot[]} · 하나도 못 고치면 'gold'
export function salvage(ctx, ref) / salvageMany(ctx, refs)   // SALVAGE[rarity] → 재료 · 아이템 사라짐 · 잠긴 것은 'itemLocked'(salvageMany는 건너뛴다)
export function craft(ctx, slot)               // CRAFT 비용 → rollGear({rarity:'rare', slot, ownClassOnly:true}) · ilvl = riftUnlocked · flags.crafted → {ok:true, item, ref:ItemRef}
export function gamble(ctx, slot)              // priceGamble(char, slot) → 등급 GAMBLE.rarity로 → rollGear({rarity, slot, ownClassOnly:true})(리뷰 수정 — 주무기 · 보조도 자기 클래스 것만) — 그 부위 · 클래스에 전설 · 세트 후보가 없으면 희귀 · ilvl = riftUnlocked · flags.gambled → {ok:true, item, ref:ItemRef}
export function rerollOffer(ctx, ref, affixIdx)   // → {ok, offer} — 이미 다른 옵션을 고정했으면 'rerollLocked' · 비용 미리 계산 · 결제는 choose 때
export function rerollChoose(ctx, choice)      // 0 = 기존 유지 · 1|2 = 후보 — 비용 결제 · rerollIdx 고정 · rerolls += 1
export function rerollCancel(ctx)
export function buyPotions(ctx, n) / buyScrolls(ctx, n)   // 상한까지만 산다
export function takeFree(ctx, what)            // 0개이고 골드가 그 값보다 적을 때만 1개 · 아니면 'notEligible'
export function resetSkills(ctx)               // priceReset · ranks 비우고 bar 비움 · SKILLS{reset}
export function priceSell(item) / priceBuy(item) / priceGamble(char, slot) / priceReroll(item) / priceCraft(char) / priceReset(char) / pricePotion(char) / priceScroll(char)
export function salvageYield(item)             // → Partial<Record<MaterialId, number>>
export function canTakeFree(char, what)
export function gambleOdds(char, slot)         // (W1 확정: 후보 유무는 loot/theory.js specialCandidates로 본다) → Record<Rarity, number> — 그 부위 · 클래스에서의 실제 확률(후보가 없어 내린 몫은 희귀에 더한다 · 화면에 공개 — 브리프 §3.8)
// progression/progress.js
export function xpReq(level)                   // → 그 레벨에서 다음 레벨까지(캡이면 Infinity)
export function xpForKill(mon, charLevel, xpPct)   // 순수 — §7.11
export function grantXp(ctx, amount, source)   // → XpResult · 레벨업이면 refreshStats · 생명 · 자원 가득 · LEVEL_UP · HINT skills · SAVE_REQUEST{char, 'xp'}(레벨업이 없어도 — 1초 묶음)
export function pointsTotal(level) / pointsSpent(char) / pointsFree(char)
export function canLearn(char, nodeId)         // → Result ('points' · 'tier' · 'req' · 'maxRank' · 'class')
export function learnSkill(ctx, nodeId)        // → Result — 액티브를 처음 배우면(0 → 1랭크) 빈 바 칸 중 가장 앞(0 = 우클릭부터)에 놓는다(빈 칸이 없으면 놓지 않는다) · refreshStats · SKILLS · SAVE
export function setSkillBar(ctx, idx, nodeId)  // → Result — 배운 액티브만(null이면 비움 · 다른 칸에 있으면 자리 바꿈)
export function previewLearn(char, nodeId)     // 순수 — {ok, statsBefore, statsAfter, rankBefore, rankAfter}
export function unlockAfter(char, level, deaths)   // 순수 — 새 riftUnlocked (§7.3)
export function completeRun(ctx, summary)      // 해금 · 최고 기록 · recordRun · UNLOCK · SAVE
export function recordRun(ctx, summary)        // records 앞에 · RECORDS_MAX
export function previewRift(char, level)       // 순수 — RiftPreview(hpMul · dmgMul = 표 × earlyHpMul(L) · earlyDmgMul(L) — 몬스터에 실제로 곱하는 배율 · 리뷰 수정)
// progression/save.js
export function serializeAccount(state)        // → AccountSave (savedAt은 app이 덮어쓴다)
export function serializeChar(char)            // → CharSave
export function loadAccount(raw)               // raw = JSON 문자열|null → {account, broken:boolean, reason}  (throw 금지)
                                               // W1 확정: loadAccount · loadChar는 future:boolean을 더 준다(미래 버전 — reason 'future' · 읽기만 · app은 덮어쓰지 않는다) · broken 사유 json · shape · game · version · class
export function loadChar(raw, slot)            // → {char|null, broken, reason}
export function sanitizeItem(raw)              // → Item|null (모르는 기본형 → null · 모르는 옵션은 뺀다 · 숫자 아닌 값은 버린다)
export function dedupeItemIds(account, chars)  // ID가 겹치면 뒤의 것을 새 ID로 · nextItemId를 최대값 + 1 이상으로 → {changed:boolean}
export function rebuildAccount(charRaws)       // charRaws = 칸 0..3의 캐릭터 세이브 JSON|null → {account, chars:(CharacterState|null)[]} — 계정이 깨졌을 때:
                                               //   chars[slot] = summaryOf(char) · nextItemId = (모든 캐릭터 아이템 번호의 최대) + 1 · 보관함은 빈 채(§11.6)
// progression/dev.js
export function makeDevCharacter({slot = 0, cls, name, level = 1, rift = 1, preset = 0, seed = 1, newId})
       // → CharacterState — 그 레벨 · 프리셋 빌드(data/presets.js)대로 스킬 · rift면 riftUnlocked = rift · 장비 10칸을 rollGear({rarity: 마법 60% · 희귀 40%, level: rift, slot, ownClassOnly: true})로
```

### 6.12 sim → 다른 계층이 읽는 상태 · 함수 요약

- view: `state`(전부 읽기) · `sim.getMap()` · `MAP_LOADED` 때 다시 읽는다 · `weaponVisual(item)`(P5) · `nav.tileAt`(벽 낮추기 계산).
- ui: `state` · `sim.getStats()` · §6.13 조회 함수.
- audio: 이벤트와 `state.scene` · `rift.tileset` · `player.channel`(지속음)만. **W2 확정**: 그 밖에 `player.pos`(듣는 자리) · `player.recall`(귀환 시전음 — §9.11) · `player.lowLife` · `player.dead`와, 처음 보는 몬스터 ID마다 한 번 `rift.mons[].{typeId, rank}`(템플릿별 피격 · 정예 예고음 크기 — `HIT` · `MON_ACT` · `MON_STRIKE` payload에 등급이 없다 · `MAP_LOADED` · `RIFT_CLOSED`에서 캐시를 비운다)를 읽는다(읽기 전용).

### 6.13 ui가 부르는 순수 조회 · 계산 (import 허용 목록 — §2.1)

| 함수 | 파일 | 쓰는 패널 |
|---|---|---|
| `computeStats` · `compareEquip` · `powerScore` · `DRa` · `DRr` | `sim/loot/stats.js` · `compare.js` | 툴팁 · 캐릭터 시트 · 인벤토리 |
| `rarityDist` · `tcDist` · `expectedPerKill` · `slotDist` · `affixCountDist` · `tierDist` · `effectiveMF` · `createDropSim` | `sim/loot/theory.js` · `simulate.js` | 분석 패널 |
| `describeSkill` · `skillReady` | `sim/player/skills.js` | HUD 스킬 바 · 스킬 트리 |
| `canLearn` · `previewLearn` · `pointsFree` · `pointsSpent` · `xpReq` · `previewRift` | `sim/progression/progress.js` | 스킬 트리 · 균열석 · 경험치 바 |
| `priceSell` · `priceBuy` · `priceGamble` · `priceReroll` · `priceCraft` · `priceReset` · `pricePotion` · `priceScroll` · `salvageYield` · `canTakeFree` · `gambleOdds(char, slot)` · `repairCost` · `isUpgrade` | `sim/progression/shops.js` · `inventory.js` · `sim/loot/compare.js` | 상점 패널(일괄 판매 대상 고르기 포함) |
| `meterView` · `riftElapsedSec` | `sim/meter.js` · `sim/rift.js` | 계측 HUD · 분석 |
| `riftRow` · `RIFT_LEVELS` 등 데이터 표 | `data/*` | 표 보기 · 균열석 |
| (피드백 2) `isBagFull` · `bagCount`(sim 규칙의 정본) — ui 는 같은 판정을 순수 `pnlLogic.bagFill(bag, size, cols)` · `BAG_GRID`(core `BAG_SIZE` · `BAG_COLS`) · `upgradeCountGain()`(`COMPARE.upgradeGain`)로 모은다 | `sim/progression/inventory.js` · `ui/pnlLogic.js` | 가방 격자(넘친 칸 · 머리 n/30) · 줍기 실패 알림 · 균열 완료 |

### 6.14 view (P7 · P8 · P13)

```js
// view/renderer.js (P7)
export function createRenderContext(canvas, settings)
  // → RenderContext {renderer, scene, camera(PerspectiveCamera fov 40), layers:{world, actors, fx}(THREE.Group),
  //    resize(w, h), setQuality(q), render(), dispose(),
  //    project(x, y, z) → {x, y, visible}   (CSS px · ui 이름표 · 피해 숫자)
  //    rayFromScreen(px, py) → {ox, oy, oz, dx, dy, dz}   (app 입력 · pick)
  //    groundAt(px, py) → Vec2|null        (y = 0 평면 교차)
  //    stats() → {calls, triangles, geometries, textures, programs}}   (__game.memory)
  //  WebGL을 만들지 못하면 throw(app이 잡는다)
// view/CameraRig.js (P7)
export class CameraRig {
  constructor({rc, bus, settings})
  update(state, alpha, dtReal)             // 플레이어 보간 위치를 따라감(§9.3) · 흔들림 · 줌
  zoom(steps)                              // 휠(app이 부른다) — + 멀리 · − 가까이
  snap()                                   // 보간 없이 바로(PLAYER_SPAWNED에서 스스로도 부른다)
  get target()                             // 카메라가 보는 월드 점(벽 낮추기 · 컬링 기준)
  dispose()
}
// view/WorldLayer.js (P7)
export class WorldLayer {
  constructor({rc, bus, settings})
  setMap(map)                              // MAP_LOADED에서 app이 sim.getMap()을 넘긴다 — 이전 맵 지오메트리 해제
  update(state, alpha, dtReal, cameraTarget)   // 벽 낮추기 · 빛 고르기 · 포털 · 마을 물체 · 탐색 안 한 곳은 어둡게
  dispose()
}
// view/ActorLayer.js (P8)
export class ActorLayer {
  constructor({rc, bus, settings})
  setMap(map)                              // 마을 NPC · 맵 경계(컬링)
  update(state, alpha, dtReal, cameraTarget)   // 플레이어 리그 · 몬스터 인스턴스 · NPC · 바닥 아이템 · 시체
  dispose()
}
// view/FxLayer.js (P13)
export class FxLayer {
  constructor({rc, bus, settings})
  setMap(map)
  update(state, alpha, dtReal, cameraTarget)   // 효과 · 투사체 · 오라 · 상태 표시 · 입자
  dispose()
}
```

### 6.15 audio (P14)

```js
export class AudioEngine {
  constructor({bus, settings})             // AudioContext는 unlock()에서 처음 만든다(그 전 호출은 조용히 무시 — QUALITY §5)
  unlock()                                 // 첫 사용자 제스처(키 · 클릭)에서 app이 부른다 → AUDIO_UNLOCKED는 app이 낸다
  update(state, dtReal)                    // 지속음(회오리 · 환경음 · 귀환 시전) 상태 맞추기
  setPaused(on)                            // suspend/resume · 지속음 정리
  applySettings(settings)
  stats() → {voices, nodes}                // 누수 검사
  dispose()
}
```

### 6.16 bot (P15)

```js
// bot/bot.js
export class Bot {
  constructor({sim, strategy = 'basic', cls, preset = 0, seed = 1, params = BOT, autoCommit = true})   // strategy 'basic'|'noDodge'|'challenge'
                               // autoCommit false면 afterStep이 commitTravel을 부르지 않는다(브라우저 — app의 전환 막이 commit · §11.13)
  frame()                      // → InputFrame — 이번 틱의 입력(마을이면 걸어서 NPC로 · 거래는 명령으로 — 아래 · hover는 src 'pick')
  afterStep()                  // step 뒤: (autoCommit이면) pendingTravel이면 commitTravel · 마을 정비 명령 · 레벨 선택 · 스킬 배분 · 사망이면 respawn() · 마을 복귀 returnToRift()
  get log()                    // 결정 기록(측정용 · 순수 배열)
}
// bot/measure.js (순수 — 테스트 · scripts/measure.mjs 공용)
export function runSession({cls, strategy, preset, seed, hours, makeSim, riftLevel = null, char = null, onRun = null})   // → {runs: RunSummary[], timeline:[{playSec, level, riftUnlocked}], char}
export function runRift({sim, bot, maxSec})    // 균열 한 판 → RunSummary
export function affixProbe({cls, affixId, level, seed, makeSim})   // 그 속성 하나만 단 정예 팩 → {dmgTaken, ttkSec, deaths}
export function measureTable({…, makeSim})     // → MEASURE.md 마크다운 문자열
```

- `makeSim`은 `(seed, account) → GameSim`이다 — `scripts/measure.mjs`와 `test/*`가 `(seed, account) => new GameSim({bus: new EventBus(), seed, account, devSession: true})`를 넘긴다(bot/*는 GameSim을 import하지 않는다 — §2.2).
- 봇이 읽어도 되는 것: 화면에 보이는 것 — 플레이어 `BOT.viewR`(11.4m — 기본 카메라에서 위 · 아래로 보이는 거리 §9.3) 안의 몬스터(위치 · 등급 · 속성 · 생명 비율 · act · aim) · 효과(모양 · 시각) · 투사체 · 드랍 · 포털 · 맵(탐색한 타일) · 자기 시트 · 데이터 표. **읽지 않는 것**: 몬스터의 `ax`(훅 타이머) · `readyAt` · 잠든 팩의 위치(탐색하지 않은 곳) · 난수 상태.
- 봇이 부르는 명령: `GameSim`의 공개 명령(ui와 같은 것) + `commitTravel`. 거래는 사람이 NPC 앞에서 패널을 여는 것처럼 **INTERACT를 받은 뒤** 명령을 부른다.
- **W2 확정**: 봇은 버스를 구독하지 않는다(dispose가 없어 켜고 끌 때 리스너가 새지 않게) — 「INTERACT를 받았다」 = 그 물체로 가던 의도가 끝나고 `state.town.lastInteract`가 그 물체 · 반경 안(같은 step의 sim 동작을 상태로 읽는다). 계약에 더한 것(덧붙이기만): 프리셋 값 `RANDOM_BUILD`(−1 · 측정의 무작위 배분) · 측정 하네스용 내부 필드 `bot.levelOverride` · `bot.abandonRift` · `runSession`의 선택 인자 `maxRuns` · `maxRiftSec` · `snapshots`와 결과의 `levelAt` · `unlockAt` · `snaps` · `bot` · `runRift` 요약의 측정 누적 `m`. `BOT.priority`에 `guardian: 3` · `minion: 1`.

### 6.17 `test/helpers.js` (P0 완성 — W1 테스트가 서로를 기다리지 않게)

```js
export function makeTestChar(overrides = {})        // 레벨 1 전사 · 시작 장비(makeItem) · START 값 리터럴(createCharacter를 부르지 않는다) + 얕은 덮어쓰기
export function makeTestStats(overrides = {})       // FIST가 아닌 시작 검 · 레벨 1 전사 PlayerStats 리터럴(§7 값으로 계산한 수 — 시트 DPS 7.8925 · ehp 138) · overrides.cls 'mage'면 시작 마법봉 마법사(7.1033 · 103.5)
export function makeTestMap(ascii = DEFAULT_ROOM)   // debug/fixtureMap.js로 — 기본: 40×40m 방 하나 · 기둥 4 · 팩 자리 6
export function makeTestState({scene = 'rift', cls = 'warrior', level = 1, seed = 1, map = null} = {})   // 균열 1 상태(몬스터 없음) · 플레이어 spawn
export function makeTestCtx(state, {map = null, stats = null, hooks = {}} = {})
       // → SimCtx + {events: []} — emit은 state.events와 ctx.events 둘 다에 · stats 기본 makeTestStats() · refreshStats는 no-op(바꿀 수 있다) · hooks 기본 no-op(§3.10의 여덟 · onGlobe는 {mul:1, radiusAdd:0}) · monVer 0 · 균열이면 flow = createFlow(map)
export function addTestMonster(ctx, {typeId = 'ghoul', rank = 'normal', x, z, awake = true, hp = null})   // 데이터 수치로 MonsterState 리터럴(monsterStats를 부르지 않는다) · W1 수정 2: dmg에 earlyDmgMul(균열 레벨)을 같이 곱한다(monsterStats와 같은 식)
export function runTicks(n, fn)
export function countEvents(events, name)
export function assertFiniteDeep(obj, path = 'state')   // NaN · Infinity를 경로와 함께 실패
export function randomInputs(seed)                  // → (tick, state) => InputFrame (결정성 · 퍼즈 — 커서는 플레이어 주변 12m)
export function scriptedClear(sim, {maxTicks, untilComplete = false, learn = false, stopOnDeath = false})
       // W1 수정 3: stopOnDeath — 쓰러진 틱에 멈춘다(부활하지 않는다 — 검사가 사망 · 부활 · 복귀를 직접 밟는다)
       // W1 통합 게이트용 간이 자동 입력 — 흐름장으로 닿는 몬스터(깬 것 먼저)를 누르고 있고 스킬 칸 0을 반복 · 생명 40% 아래 포션 · 게이지 100%까지(untilComplete면 완료 · 붕괴까지 · 봇 아님)
       // W1 수정(NOTES-W1FIX): learn — 레벨업마다 프리셋 A를 한 점씩 · 스킬 칸 1을 3초마다 · 끼임 풀기(3초 동안 1m 안 · 준 피해 0이면 1초 동안 둘레 4m) · 피하기 · 우선 대상 · 구슬 줍기는 없다
       // → {ticks, gauge, phase, deaths, minLife(최저 생명 비율 · 사망이면 0), gaugeAt(게이지 100%의 ticksIn · 없으면 -1), riftTicks, stuck}
```

### 6.18 스텁 값 (P0이 W0에 쓰는 스텁의 동작)

**던지지 않고 유효한 모양의 값을 돌려준다.** 아래에 없는 export는 no-op / `null` / `[]` / `0` / `{ok:false, reason:'stub'}`.

| 모듈 | 스텁 동작 |
|---|---|
| `sim/GameSim.js` | 생성자: `createGameState` · `buildTownMap()`(스텁) · `createCtx`. `start()`는 `MAP_LOADED` · `SCENE_CHANGED` · `PLAYER_SPAWNED`. `step`은 §5.1의 0 · 1과 플러시만. 명령은 `{ok:false, reason:'stub'}`. **완성으로 내는 것**: `debugLoadState(state, map, riftMap)`(state 교체 · ctx 다시 만듦(균열이면 `ctx.flow = createFlow(map)`) · `MAP_LOADED` · `SCENE_CHANGED{reason:'fixture'}` · `PLAYER_SPAWNED` — `?fixture`가 W1에 쓴다) · `getMap` · `getStats` · `loadCharacter` · `newCharacter`(§6.8의 붙이기 순서 — 최소 부트 §11.10이 캐릭터를 붙인다) · `previewRift`. W0의 `step`은 0 · 1 뒤에 스텁 `updatePlayer`(직선 이동)도 부른다 |
| `sim/ctx.js` | **완성으로 낸다**(§3.10 그대로 · stats = `computeStats` 스텁 결과 · hooks는 실제 함수 import — 스텁이면 no-op) |
| `sim/combat.js` | `playerHitShape` = `monstersIn`으로 대상만 찾아 `{monId, dmg:0, crit:false, killed:false, immune:false, blocked:false}[]` · `playerHit` 같은 모양 하나 · `monsterHitPlayer` · `hazardHitPlayer` = `{dmg:0, absorbed:0, blocked:false, killed:false, ignored:true}` · `DRa` · `DRr`은 **완성**(§5.6 식) |
| `sim/projectiles.js` · `effects.js` | `spawnProjectile` · `spawnEffect`는 **완성**(def → Proj/Effect를 만들어 `addProj`/`addEffect` · 이벤트) · `update*`는 시간이 지난 것만 지운다 · `canStartHazard` → true |
| `sim/drops.js` | `spawnDrops`는 **완성**(흩뿌림 없이 원 위 등간격 · 이벤트) · `pickupDrop` `{ok:false, reason:'stub'}` |
| `sim/rift.js` | `requestTravel`은 **완성**(§5.11 앞부분) · 나머지 no-op · `riftElapsedSec` 완성 |
| `sim/meter.js` | `meterView` → 0으로 채운 모양 |
| `sim/pick.js` | `pickHover` → null |
| `sim/player/*` | `updatePlayer` = `lmbDown`이면 커서 쪽으로 직선 이동만(최소 부트에서 움직여 보려고 · 벽 `moveCircle`) · `describeSkill` → `{coefPct:100, dmgMin:0, dmgMax:0, cost:0, cd:0, range:0, radius:0, extra:{}}` · `skillReady` → `{canAfford:true, cooldownLeft:0, cooldownTotal:0, ready:true}` · `SKILL_BEHAVIORS`·`EQUIP_HOOKS` 키 전부 no-op 객체 · `globeMods` → `{mul:1, radiusAdd:0}` |
| `sim/monsters/*` | `updateMonsters` no-op · `spawn.js`의 `monsterStats`는 **완성**(§5.6 · `getMonDef` · 데이터만으로 계산) · `spawnMonster`는 **완성**(monsterStats + `addMonster` + `ctx.hooks.onMonSpawn`) · `startAttack`은 act · readyAt만 · `populateRift`는 각 팩 자리에 그 자리 종류대로 구울 6 · 챔피언 구울 3 · 정예 구울 1 + 하수인 3을 잠든 채로(최소 부트 · 화면 확인용) · `BEHAVIORS` 키 전부 `{think(){}, strike(){}}` · 훅 파일 전부 `export const hook = {}` · `impl = {init(){}, think(){}, strike(){}}` · `eliteName` → `['elite.a.0', 'elite.b.0']` · `findGuardianSpot` → 플레이어 + (0, 8) · `onMonSpawn` · `onMonHitPlayer` no-op |
| `sim/world/mapgen.js` | `generateRift` → `fixtureMap`과 같은 꼴의 60×60m 방 하나(sim은 debug를 import하지 못하니 같은 코드를 직접) · 팩 자리 12(normal 8 · champion 3 · elite 1) · 빛 6 · 소품 기둥 4 |
| `sim/world/townMap.js` | `buildTownMap` → 48×48m 광장 · `TOWN.objects` 위치 그대로(완성에 가깝게 — 데이터만으로) |
| `sim/world/path.js` · `flow.js` | `findPath` → `[nearestWalkable(to) ?? from]` · `createFlow` → 모양 · `updateFlow` → false · `flowDir` → null · `flowDist` → Infinity |
| `sim/loot/*` | `rollDrops` → `{drops:[], blp}` · `rollItem`/`rollGear` → `makeItem({baseId, …})` · **`makeItem` · `itemValue` · `computeStats` · `DRa` · `DRr` · `powerScore` · `weaponVisual`은 완성**(최소 부트 · 고정 상태 · 다른 패키지 테스트가 실제 시트를 쓴다) · `theory.*` → 균등 분포 모양 · `createDropSim` → `{run(){return 0}, result(){ 0 채운 SimResult }, reset(){}}` · `compareEquip` → `{slot:null, ok:false, reason:'slot', before, after:before, delta:0들, upgrade:false}` · `isUpgrade` false |
| `sim/progression/*` | **완성으로 낸다**: `createCharacter` · `summaryOf` · `addToBag` · `addGold` · `addMaterials` · `addConsumable` · `findItem` · `itemAt` · `xpReq`(최소 부트에 캐릭터가 있어야 한다) · 나머지 명령 `{ok:false, reason:'stub'}` · 가격 함수 → 0 · `loadAccount` → `{account: createAccount(), broken:false}` · `loadChar` → `{char:null, broken:false}` · `rebuildAccount` → `{account: createAccount(), chars:[null × 4]}` · `serialize*` 완성 · `makeDevCharacter` → `createCharacter` + level만 |
| `view/*` | `createRenderContext`는 **실제 렌더러 · 장면 · 카메라**(fov 40 · §0.2 방위 · 앙각 · 거리 24 · 카메라 쪽 앞당김 §9.3 · 바닥 회색 · 반구광 하나) · `project` · `rayFromScreen` · `groundAt` 완성. `CameraRig` 플레이어 보간 위치 고정 오프셋 · `WorldLayer` 바닥 타일 = 회색 판 하나 · 벽 = 상자 인스턴스 · `ActorLayer` 플레이어 = 파란 원기둥 · 몬스터 = 등급색 원기둥(InstancedMesh) · 드랍 = 등급색 작은 상자 · `FxLayer` 효과 = 붉은/흰 원판 테두리 · 투사체 = 작은 구 — 「자리 표시」로 상태를 읽어 그린다 |
| `audio/AudioEngine.js` | 모든 메서드 no-op · `stats` → `{voices:0, nodes:0}` |
| `ui/*` | `UIRoot`는 최소 HUD(장면 · 생명/최대 · 자원 · 균열 게이지 · 패널 ID 표시) + `openPanel` · `closePanel` · `handleKey`(Escape) · `topPanel` · `isModal` · `blocksPointer` · `labelHover` → null · 패널 모듈은 전부 `createXPanel` → 제목 하나 있는 빈 상자(`PANELS` 키 전부) |
| `app/*` | `bootMarker.js` 완성 · 나머지는 W2(P9) — W0에는 `main.js`(최소 부트)만 쓴다 |
| `bot/*` | `Bot.frame` → `NEUTRAL_INPUT` · `afterStep` no-op · `measure.*` → 빈 결과 · `measureTable` → `'(측정 없음)'` |

---

## §7 데이터 표와 수치

### 7.0 규칙

- 값은 이 절 그대로 P0이 시드로 넣는다. 코드 블록 안의 `🔒`는 문서 표시다 — 소스에는 주석(`// 🔒 §7.14`)으로만 남긴다. 🔒 = 측정 목표 산수(§7.14)에 묶인 값 — 소유 패키지라도 혼자 바꾸지 않는다(NOTES에 근거 → 밸런스 게이트).
- 시간은 초 · 거리는 m · 퍼센트 옵션 값은 퍼센트 숫자(§0.1).
- 데이터 행은 **배열**(순서가 뽑기 · 표시 순서)이고 ID 조회는 `data/index.js`가 만든다.
- 행을 더하면 `data.schema.test.js`가 그 행을 자동으로 본다(§12.2) — 표의 열이 스키마다.

### 7.1 클래스 — `data/classes.js` (P1 · 시드)

```js
export const PLAYER = { turnRate: 18, repathSec: 0.2, repathDist: 0.75, arriveR: 0.15, attackRepathDist: 1.0, standConeDeg: 70, reachTolerance: 0.3, shoveMul: 0.6, pushSec: 0.15 };
export const CLASSES = [
  { id: 'warrior', mainStat: 'str', resource: 'rage',
    life: { base: 120, growth: 1.09 },  🔒
    resourceMax: { base: 100, perLevel: 1 }, regen: { base: 0, perLevel: 0 },
    rage: { onBasicHit: 8, perExtraTarget: 1, extraCap: 3, onHitTaken: 2, takenCapPerSec: 8, decayDelay: 3, decayPerSec: 5 },   // W1 수정: onBasicHit 6 → 8
    moveSpeed: 6, radius: 0.40, height: 1.8, basic: 'bash',
    startGear: [{ baseId: 'sword', tier: 0 }, { baseId: 'chest', tier: 0 }],
    mainHandBases: ['sword', 'axe', 'mace', 'greatsword', 'greataxe'], offhandBases: ['shield'] },
  { id: 'mage', mainStat: 'int', resource: 'mana',
    life: { base: 100, growth: 1.09 },  🔒   // 밸런스 게이트: 90 → 100
    resourceMax: { base: 100, perLevel: 2 }, regen: { base: 10.5, perLevel: 0 },   // 피드백 2 다듬기: 7 + 0.15/레벨 → 10.5 고정(레벨 1 · 10 · 20 · 30 에서 × 1.50 · 1.26 · 1.07 · 0.93 — 아래 §7.3 「입문 경사 꼬리」)
    rage: null,
    moveSpeed: 6, radius: 0.40, height: 1.8, basic: 'magicBolt',
    startGear: [{ baseId: 'wand', tier: 0 }, { baseId: 'chest', tier: 0 }],
    mainHandBases: ['wand', 'staff'], offhandBases: ['orb'] },
];
```

### 7.2 스킬 — `data/skills.js` (P1 · 시드)

`export const TREE = { tierPoints: [0, 5, 10, 15], pointsPerLevel: 1 }` — 레벨 L의 총 포인트 = L − 1(레벨 30 = 29점) · 노드 합계 칸 57(클래스마다 — 브리프 50~60). 단계 해금 = 그 클래스 트리에 **쓴 점수 합**.

`coef` 열의 「a / +b」 = 랭크 r의 계수 `a + b × (r − 1)`. 「행동」의 ✓ = 공격 속도에 비례(`scaled`). 거리는 m.

**「상태 · params」 열의 규칙**: 액티브 행에서 `stun` · `chill` · `knock` · `slowPct` · `slowSec` · `shockChance` · `burnFrac`는 `skill.status`(적중이 싣는 것), 그 밖의 수치는 `skill.params`(§8.4가 읽는 키). 패시브 행의 백틱 키는 `stats`(StatKey · 퍼센트 숫자)와 `cond`, 변형 행은 `patch`. 대괄호 배열은 랭크별 값(`[rank − 1]`). **`status` · `params` · `patch`의 비율은 전부 0..1 소수다** — 패시브 `stats`와 아이템 옵션만 퍼센트 숫자(§0.1). 기절은 `skill.status.stun`만 쓰고 params에 두지 않는다. **기본 행의 `params`에는 변형 · 전설 키(`aftershock` · `split` · `shards` · `blast` · `shockwave` · `vortex` · `refund` · `castHeal` · `landQuake` · `landStun` · `pierce` · `shower` · `bouncesAdd` · `arrivalNova` · `healPerTarget` · `healTargetsCap`)를 넣지 않는다** — 그 키의 기본값은 §8.4 괄호 안의 값(null · 0 · false)이고, 값은 변형 노드의 `patch` · 전설 행의 `patch`에 있다(넣으면 변형을 찍지 않아도 늘 켜진다 — data.schema.test가 본다). `data/skills.js`는 이 목록을 `PATCH_KEYS`로, §8.4 표의 동작별 키를 `PATCH_KEYS_BY_BEHAVIOR`로 함께 낸다(W0 스캐폴드 — data 검사가 읽는다).

**기본 공격** — `BASIC_SKILLS`

| ID | 동작 | 대상 | 종류 · 태그 | 비용 | 행동 | 판정 | 모양 | coef | params |
|---|---|---|---|---|---|---|---|---|---|
| `bash` 가르기(**피드백 1** — 옛 강타) | cleave | target | phys · melee | 0(분노 생성 §5.5 — 맞힌 수만큼 +1 · 최대 +3) | `1/aps` | 0.45 | 대상 쪽 부채꼴 반지름 1.9(= 0.4 + reach 1.2 + 관용 0.3) · 180° · 닿는 적 모두 | 닿는 적마다 **1.00** 🔒(피드백 1 — 값 그대로 · 대상 하나 → 닿는 적 모두. 0.85 도 재 봤다 — 프리셋 B 「학살」이 A 보다 31% 느려져 1.00 으로 둔다) | swing `{from: 0.25, to: 0.5, arcFrom: -90, arcTo: 90}`(연출 — §9.5) |
| `magicBolt` 마력 화살 | boltBasic | direction | lightning · projectile | 0 | `1/aps` | 0.40 | 투사체 r 0.25 · 22 m/s · 사거리 15 | 1.00 🔒 | visual `magicBolt` |

**전사 노드** — `SKILL_NODES`(branch 0 분쇄 · 1 학살 · 2 수호)

| ID | 갈래 · 단계 | 종류 · 최대 | 동작 · 대상 | 비용 · 생성 | 쿨 | 행동 · 판정 | 모양 | coef | 상태 · params |
|---|---|---|---|---|---|---|---|---|---|
| `groundStomp` 회전 베기(**피드백 1** — 옛 지면 강타 · ID 그대로) | 0 · 1 | active · 5 | spinSlash · direction | 분노 14(W1 수정 · 20 → 14) | 0 | 0.60✓ · 0.50 | 원 r 2.5 · 360°(플레이어 중심) | **1.20 / +0.09**(피드백 1 — 정타 처치 수 · 전사 균열 10 해금 §7.14 · 옛 원뿔 r 4.0 · 120° · 1.05 / +0.11) | knock 0.8(옛 stun [0.8 … 1.2] · shake 0.25 는 뺐다) · swing `{from: 0.15, to: 0.55, arcFrom: -90, arcTo: 270}` · fxAftershock `spinEcho` · fxShockwave `shockwave` |
| `weaponMastery` 무기 숙련 | 0 · 1 | passive · 5 | — | — | — | — | — | — | `physPct` [6, 12, 18, 24, 30] |
| `earthquake` 지진 | 0 · 2 | active · 5 | quake · self | 분노 30 | 8 | 0.50✓ · 0.40 | 원 r 6.0(시전 자리) | 파동마다 0.85 / +0.095(밸런스 게이트 · 옛 1.10 / +0.12) | waves [0.4, 0.9, 1.4] · shake 0.35 |
| `aftershock` 연속 회전(**피드백 1** — 옛 여진 · ID · 패치 키 그대로) | 0 · 3 | transform · 1 · req `groundStomp` | — | — | — | — | — | — | patch `{aftershock: {delay: 0.5, mul: 0.6}}` — 0.5초 뒤 그때의 플레이어 자리에서 한 번 더 돈다 |
| `crusher` 분쇄자 | 0 · 4 | passive · 3 | — | — | — | — | — | — | cond `targetDisabled`(**피드백 2 D10** — 넉백 중 · 넉백 뒤 0.5초도 참 · 회전 베기로 켜진다 §5.7) · `allPct` [10, 20, 30] |
| `charge` 돌진 | 1 · 1 | active · 5 | dash · point | 생성 10 | 6 | 거리/22 + 0.1 · 1틱 | 선 폭 1.6 · 2~10 | 1.20 / +0.15 | knock 2.5 · speed 22 |
| `bloodthirst` 피의 갈증 | 1 · 1 | passive · 5 | — | — | — | — | — | — | `lifePctOnHit` [0.3, 0.6, 0.9, 1.2, 1.5] |
| `whirlwind` 회오리 | 1 · 2 | active · 5 | spin · point(따라감) | 시작 10 · 유지 10/초(밸런스 게이트 · 옛 12) | 0 | 채널 · 틱 0.30✓ | 원 r 2.4 | 틱마다 0.78 / +0.095(밸런스 게이트 · 옛 0.42 / +0.05) | moveMul 0.7 · endRecover 0.15 |
| `bloodWhirl` 피의 회오리 | 1 · 3 | transform · 1 · req `whirlwind` | — | — | — | — | — | — | patch `{healPerTarget: 0.006, healTargetsCap: 3}`(대상당 최대 생명 × 0.6% · 채널 틱당 대상 3까지 — 초당 최대 6%) |
| `berserker` 광전사 | 1 · 4 | passive · 3 | — | — | — | — | — | — | cond `rage50` · `attackSpeedPct` [5, 10, 15] · `critChance` [3, 6, 9] |
| `warCry` 전투 함성 | 2 · 1 | active · 5 | buff · self | 생성 30 | 15 | 0.40 · 0.50 | — | — | buffSec 8 · value [0.40, 0.46, 0.52, 0.58, 0.64](방어도 × (1 + value)) |
| `ironSkin` 강철 피부 | 2 · 1 | passive · 5 | — | — | — | — | — | — | `armorPct` [8, 16, 24, 32, 40] · `resPct` [5, 10, 15, 20, 25] |
| `leap` 도약 | 2 · 2 | active · 5 | leap · point | 0 | 8 | 공중 0.55 → 착지 판정 · 후딜 0.15 | 원 r 3.5 · 2~9 | 1.60 / +0.18 | slowPct 0.4 · slowSec 2 · invuln [0.10, 0.45] · shake 0.35 |
| `quakeLanding` 진동 착지 | 2 · 3 | transform · 1 · req `leap` | — | — | — | — | — | — | patch `{landStun: 1.2}` |
| `undying` 불굴 | 2 · 4 | passive · 3 | — | — | — | — | — | — | cond `lifeBelow35` · `dmgTakenReduce` [10, 20, 30] |

**마법사 노드**(branch 0 화염 · 1 냉기 · 2 번개 · 비전)

| ID | 갈래 · 단계 | 종류 · 최대 | 동작 · 대상 | 비용 | 쿨 | 행동 · 판정 | 모양 | coef | 상태 · params |
|---|---|---|---|---|---|---|---|---|---|
| `fireball` 화염구 | 0 · 1 | active · 5 | fireball · direction | 마나 16 | 0 | 0.55✓ · 0.45 | 투사체 r 0.35 · 18 m/s · 16 → 폭발 원 r 2.5 | **1.30 / +0.155**(피드백 2 — 일반 생명 × 1.6 뒤 마법사가 균열 4~9 에 묶였다 · 밸런스 게이트 1.25 / +0.15 · 옛 1.70 / +0.20) | speed 18 · range 16 · r 0.35 · explodeR 2.5 |
| `combustion` 연소 | 0 · 1 | passive · 5 | — | — | — | — | — | — | `burnFrac` [20, 40, 60, 80, 100](화염 적중 피해의 % → 3초 화상) |
| `meteor` 메테오 | 0 · 2 | active · 5 | meteor · point | 마나 40 | 2 | 0.60✓ · 0.30 | 예고 1.2 · 원 r 3.5 · 사거리 18 | **2.40 / +0.27**(피드백 2 — 팩이 촘촘해져 후반 마법사 판이 4분대 · 밸런스 게이트 2.70 / +0.30 · 옛 3.60 / +0.40) | delay 1.2 · burn `{dur: 3, tick: 0.5, coefPerSec: [0.35, 0.39, 0.43, 0.47, 0.51]}`(충돌과 같은 원 r 3.5 — 효과 하나의 tickSpec) · shake 0.4 |
| `splitFireball` 분열 화염구 | 0 · 3 | transform · 1 · req `fireball` | — | — | — | — | — | — | patch `{split: {n: 3, spreadDeg: 15, mul: 0.7}}` |
| `heartOfFire` 불의 심장 | 0 · 4 | passive · 3 | — | — | — | — | — | — | `firePct` [8, 16, 24] · cond `targetBurning` · `critChance` [5, 10, 15] |
| `frostNova` 서리 노바 | 1 · 1 | active · 5 | nova · self | 마나 20 | 4 | 0.45✓ · 0.50 | 원 r 5.0 | 1.00 / +0.12 | chill [60, 65, 70, 75, 80] |
| `coldCore` 냉기 핵심 | 1 · 1 | passive · 5 | — | — | — | — | — | — | `freezeAt` [8, 16, 24, 32, 40](빙결 문턱 −점) · `freezeDurPct` [10, 20, 30, 40, 50] |
| `energyShield` 마력 보호막 | 1 · 2 | active · 5 | shield · self | 마나 30 | 14 | 0.35 · 0.50 | — | — | absorbPct [0.30, 0.34, 0.38, 0.42, 0.46](흡수 = 최대 생명 × absorbPct) · dur 6 |
| `iceShards` 얼음 파편 | 1 · 3 | transform · 1 · req `frostNova` | — | — | — | — | — | — | patch `{shards: {n: 8, speed: 16, range: 9, r: 0.25, mul: 0.45, chill: 20}}` |
| `shatter` 파쇄 | 1 · 4 | passive · 3 | — | — | — | — | — | — | cond `targetFrozen` · `critDamage` [25, 50, 75] |
| `chainLightning` 연쇄 번개 | 2 · 1 | active · 5 | chain · target | 마나 14 | 0 | 0.50✓ · 0.45 | 사거리 15 · 튕김 6 · 커서 집기 4 | 1.15 / +0.14 | shockChance 0.35 · bounces [3, 3, 4, 4, 5] · bounceR 6 · decay 0.9 · pickR 4 |
| `manaFlow` 마나 순환 | 2 · 1 | passive · 5 | — | — | — | — | — | — | `manaRegenPct` [10, 20, 30, 40, 50] |
| `teleport` 순간이동 | 2 · 2 | active · 5 | blink · point | 마나 18 | [3.0, 2.8, 2.6, 2.4, 2.2] | 0.25 · 0.60(이동은 +0.15) | 사거리 12 | — | range 12 |
| `lightningAfterimage` 번개 잔상 | 2 · 3 | transform · 1 · req `teleport` | — | — | — | — | — | — | patch `{blast: {r: 3.0, coef: [1.4, 1.5, 1.6, 1.7, 1.8], type: 'lightning', shockChance: 0.5}}` |
| `arcaneLore` 비전 지식 | 2 · 4 | passive · 3 | — | — | — | — | — | — | `critDamage` [10, 20, 30] · `cdr` [4, 8, 12] |

- 쿨다운이 랭크별 배열이면 그 랭크의 값. 스킬 패널은 「찍기 전 · 후」를 `describeSkill`(P1)과 `previewLearn`(P6)으로 나란히 보인다(§10.6).
- **종류 · 태그**(`skill.type` · `skill.tags` — `aoePct` · 정면 방패 우회(aoe) · 종류 피해 % · 연소(화염 적중) · 저항이 여기에 걸린다): bash phys · [melee](피드백 1 — 가르기는 여럿을 맞혀도 aoe 태그가 아니다) · groundStomp phys · [aoe, melee] · earthquake phys · [aoe] · charge phys · [movement, melee] · whirlwind phys · [aoe, channel, melee] · warCry null · [buff] · leap phys · [movement, aoe] · fireball fire · [projectile, aoe] · meteor fire · [aoe, dot] · frostNova cold · [aoe] · energyShield null · [buff] · chainLightning lightning · [chain] · teleport null · [movement]. 파생 적중: 연속 회전 phys [aoe] · 진동 주먹 충격파 phys [aoe] · 진동 장화 지진 phys [aoe] · 불타는 소용돌이 fire [aoe, dot] · 메테오 불타는 바닥 fire [aoe, dot] · 분열 화염구 fire [projectile, aoe] · 얼음 파편 cold [projectile] · 번개 잔상 lightning [aoe] · 시체 폭발 phys [aoe] · 서리 반지 얼음 폭발 cold [aoe].

### 7.3 균열 레벨 곡선 — `data/rift.js` (P2 · 시드)

```js
export const GROWTH = { item: 1.10, hp: 1.14, dmg: 1.10, gold: 1.14, xp: 1.12, lateFrom: 30, hpLate: 1.12, dmgLate: 1.05 };   🔒 (모두) · 밸런스 게이트: lateFrom 20 → 30
export const RIFT = { lives: 3, guardianDelay: 2.0, completeDelay: 1.5, unlockClear: 1, unlockNoDeath: 2, maxLevel: 99, exitPortalOffset: 3, exploreR: 14,
  portalR: 1.0, earlyGaugeTo: 4, earlyGaugeMul: [1.25, 1.2, 1.15, 1.15, 1.1, 1.05],   // 피드백 2: 입문 구간 6칸(균열 7 부터 1) · 밸런스 게이트 [1.5, 1.35, 1.2, 1.1](earlyGaugeMulOf — 균열 3 의 1.6 → 1 절벽) · W1 수정(NOTES-W1FIX): 1.25 → 1.6 · (P2 W1 키) checkpointSleepMargin: 2 — §5.10 안전 지점
  earlyDmg: [0.0326, 0.0777, 0.1805, 0.3069, 0.4885, 0.74],   // 피드백 2 다듬기: 걸음이 뒤로 갈수록 준다(× 2.38 · 2.32 · 1.70 · 1.59 · 1.52 · 1.35 — 옛 [… 0.3277, 0.4836, 0.6045] 는 6 → 7 이 × 1.65) · 피드백 2 D1: 입문 구간 균열 1~6 · 균열 7 부터 1(MON.dmgBase 22 와 함께 균열 1 실제 배율 0.205 그대로) · 밸런스 게이트 11칸 [0.0293 … 0.7254](dmgBase 24.5) · 옛 W1 수정 3 [0.205, 0.305, 0.453, 0.673](dmgBase 3.5 기준)
  earlyHp: [0.3569, 0.47, 0.60, 0.73, 0.85, 0.96] };   // 피드백 2 다듬기: 앞이 무겁게(× 1.32 · 1.28 · 1.22 · 1.16 · 1.13 · 1.04 — 옛 기하 [0.3569 … 0.8422] 레벨당 × 1.187) · 피드백 2 D1 · D9: 첫 판 생명 경사(earlyHpMul) · 균열 7 부터 1 · 밸런스 게이트 11칸 [0.45 … 0.93]
  // (옛 W1 수정 2 · 3 — NOTES-W1FIX §2.0: 균열 L ≤ 4의 몬스터 피해 × earlyDmg[L − 1] · [0.2, 0.3, 0.45, 0.67] → [0.205, 0.305, 0.453, 0.673](레벨 비 ≤ 1.25) — 밸런스 게이트가 위 값으로 바꿨다)
export function earlyHpMul(L)         // 밸런스 게이트 · 순수 — RIFT.earlyHp[L − 1] · 표 밖 · 잘못된 값은 1(monsterStats가 hpMax에 곱한다 — §5.6)
export function earlyGaugeMulOf(L)    // 밸런스 게이트 · 순수 — RIFT.earlyGaugeMul 이 배열이면 [L − 1](표 밖 1) · 수면 L ≤ earlyGaugeTo 일 때 그 값(§5.18)
export function earlyDmgMul(L)        // W1 수정 2 · 순수 — RIFT.earlyDmg[L − 1] · 표 밖 · 잘못된 값은 1(monsterStats가 mon.dmg에 곱한다 — §5.6)
export function riftRow(L) {          // 순수 · 1..maxLevel · 30 위도 같은 식(NaN · Infinity 없음 — L은 정수로 자르고 [1, maxLevel])
  return { level: L, monLevel: L, ilvl: L,
    hpMul: GROWTH.hp ** (Math.min(L, GROWTH.lateFrom) - 1) * GROWTH.hpLate ** Math.max(0, L - GROWTH.lateFrom),
    dmgMul: GROWTH.dmg ** (Math.min(L, GROWTH.lateFrom) - 1) * GROWTH.dmgLate ** Math.max(0, L - GROWTH.lateFrom),
    goldMul: GROWTH.gold ** (L - 1), xpMul: GROWTH.xp ** (L - 1),   // L > 20: 캐릭터 레벨 캡(≈ 균열 19) 뒤 생명이 늘지 않으니 몬스터 성장을 늦춘다 — §7.14
    champAffixes: L < 10 ? 1 : 2, eliteAffixes: L < 5 ? 2 : L < 15 ? 3 : 4, guardianAffixes: L < 15 ? 3 : 4,
    championPacks: 4 + (L >= 8 ? 1 : 0) + (L >= 16 ? 1 : 0), elitePacks: L < 5 ? 2 : 3,
    rarityMul: { magic: 1 + 0.02 * (L - 1), rare: 1 + 0.035 * (L - 1), legendary: 1 + 0.05 * (L - 1), set: 1 + 0.05 * (L - 1) } };
}
export const RIFT_LEVELS = Array.from({ length: 30 }, (_, i) => riftRow(i + 1));   // 표 보기 · 균열석
```

- 본문의 `ITEM_GROWTH` · `GOLD_GROWTH` · `XP_GROWTH`는 `GROWTH.item` · `GROWTH.gold` · `GROWTH.xp`를 가리킨다(코드는 `GROWTH`를 import한다 — 같은 값을 다른 파일에 다시 적지 않는다). 아이템 가치 · 모든 가격 · 골드 더미가 `GROWTH.gold`, 무기 피해 · 방어도 · pow 옵션 · 감소 식의 분모가 `GROWTH.item`.
- **첫 판 피해 경사(W1 수정 2 · NOTES-W1FIX §2.0)**: `riftRow`의 `dmgMul`(🔒 곡선 — 아래 표)은 그대로 두고, 몬스터 피해에만 `earlyDmgMul(L)`을 곱한다(`monsterStats` · §5.6) — 균열 1 · 2 · 3 · 4 = × 0.205 · 0.305 · 0.453 · 0.673(W1 수정 3 — 옛 표 0.2 · 0.3 · 0.45 · 0.67) → 실제 피해 배율 0.21 · 0.34 · 0.55 · 0.90(균열 5 = 1.46부터 표 그대로). 이 구간은 레벨당 피해 × 1.634~1.637(표의 +10%가 아니다) · 어려움 √(생명 × 피해) +36.5~36.6%/레벨 · 보상(+9.4%)과의 비 **1.2475~1.2485**(§7.14 목표 0.8~1.25 안 — 옛 표는 L1→2 · L2→3 1.2537 · L4→5 1.2505로 밖이었다 · 균열 5에서 1이 되는 기하 경사라 균열 1이 0.2022보다 작으면 넘는다 · `monsters.test`가 본다) — `earlyGaugeMul`과 같은 「첫 판들만의 예외」이고, 브리프의 「레벨당 +8~15%」에서는 벗어난다(입문 구간 — Jay가 정할 것 · NOTES-W1FIX §7). 균열석 미리보기(`previewRift`)의 `dmgMul`에는 (리뷰 수정 뒤) 경사가 들어 있다 — ui는 더 곱하지 않는다.
- **밸런스 게이트(NOTES-BALANCE) — 첫 판 경사를 생명까지 · 균열 11 까지**: 몬스터 피해 🔒 `MON.dmgBase` 3.5 → 24.5(× 7) · 생명 🔒 `MON.hpBase` 19 → 36과 함께 경사를 넓혔다 — 피해 `earlyDmg`(11칸 · 레벨당 × 1.3785 · 균열 1 실제 배율 0.205 = 옛 값) · 생명 `earlyHp`(11칸 · 균열 1 × 0.45 → 레벨당 × 1.0753 · 균열 12 부터 1). 두 경사를 합친 레벨당 × 1.4822 → 어려움 √(생명 × 피해) ÷ 보상(+9.4%) 비 ≤ 1.2467(`monsters.test`). 균열 L 의 실제 피해 배율(옛 dmgBase 3.5 기준) 0.205 · 0.283 · 0.389 · 0.537 · 0.740 · 1.02 · 1.41 · 1.94 · 2.67 · 3.68 · 5.08 · (12 이상) 7 × 표 `dmgMul`. 입문 구간(브리프의 「레벨당 +8~15%」 밖)이 균열 1~4 → 1~11 로 늘었다 — Jay가 정할 것(NOTES-BALANCE). `previewRift`의 `hpMul` · `dmgMul`은 (리뷰 수정 뒤) 경사를 곱한 실제 배율이다(`monsterStats`와 같다 — `progress.test`) · 분석 패널 균열 표에 `earlyHpMul(L)` · `earlyDmgMul(L)` 열.
- **피드백 2 D1 — 입문 구간을 균열 1~6 으로**(Jay 결정 2026-10-12 · 위 두 문단의 「11칸」 · 「균열 12 부터 1」은 낡았다 · 이 문단의 균열 4~6 값 · 생명 기하 경사는 아래 「피드백 2 다듬기」가 바꿨다): `earlyDmg` · `earlyHp` 를 6칸으로 — 균열 7 에서 `earlyDmgMul = earlyHpMul = 1`(본 곡선). 🔒 `MON.dmgBase` 24.5 → 22(§7.4)와 함께 균열 L 의 실제 피해 배율(옛 dmgBase 3.5 기준) **0.205 · 0.488 · 1.135 · 2.060 · 3.040 · 3.800 · (7 이상) 6.286** × 표 `dmgMul` — 균열 1 은 그대로(첫 판 난도 불변 · 22 × 0.0326 = 0.717) · 피해 경사를 앞(균열 2~5 · 레벨당 × 2.38 · 2.32 · 1.82 · 1.48)에 몰아 6 → 7 을 × 1.65 로 낮췄다(캐릭터 레벨이 빨리 오르는 구간). 생명은 기하 경사(레벨당 × 1.187)이고 🔒 `RANKS.normal.hp` 1.6(D9 · §7.4)과 곱한 균열 1 일반 생명 = 밸런스 게이트 값(× 0.45)의 1.27배(시작 장비 회전 베기 정타 3.4번). **입문 구간(1~6 · 6 → 7 포함)에서만 레벨 비 상한 1.25 를 푼다** — `monsters.test` 는 입문 구간을 단조 증가만, 0.8~1.25 는 균열 7 부터 본다(레벨당 어려움 √(생명 × 피해) × 성장 = +88 · +86 · +64 · +48 · +36 · +57%). 게이지 배율 `earlyGaugeMul` 6칸(§5.18). 측정의 레벨 곡선 맞춤은 균열 7~20(입문 구간 제외 — §12.5). 근거: 밸런스 담당 4시드 세션 — 긴장 시작(균열 3~5 사망/판) 전사 0.32 · 마법사 0.41 · 첫 사망 24~47분(전: 균열 1~9 사망 0 · 첫 사망 148~173분).
- **피드백 2 다듬기 — 입문 경사 꼬리**(검증자 실측: 위 D1 표는 6 → 7 피해 걸음 × 1.65 가 그 앞 × 1.48 · 1.25 보다 커 균열 7 이 벽 — 처음 보는 시드 701~706 사망/판 6 → 7 전사 0.64 → 0.96 · 마법사 0.49 → 1.03 · 균열 10 해금 전사 1.96 · 마법사 3.00시간 · 클래스 차 53%): 걸음을 **앞이 무겁고 뒤로 갈수록 줄게** — `earlyDmg` [0.0326, 0.0777, 0.1805, **0.3069, 0.4885, 0.74**](걸음 × 2.38 · 2.32 · 1.70 · 1.59 · 1.52 · 1.35) · `earlyHp` [0.3569, **0.47, 0.60, 0.73, 0.85, 0.96**](걸음 × 1.32 · 1.28 · 1.22 · 1.16 · 1.13 · 1.04 — 옛 기하 × 1.19 고르게). 균열 L 의 실제 피해 배율(옛 dmgBase 3.5 기준) 0.205 · 0.488 · 1.135 · **1.929 · 3.071 · 4.651** · (7 이상) 6.286. 레벨당 어려움 √(생명 × 피해) × 성장 = +98 · +93 · +61 · +52 · +46 · **+33%**(6 → 7 — 입문 구간에서 가장 작다 · 옛 +57%) → 본 곡선 +12%. 균열 1 은 그대로(첫 판 · `balance.test`). `monsters.test` 「입문 경사의 꼴」이 피해 · 생명 · 합친 어려움의 걸음이 늘지 않고 6 → 7 이 가장 작음을 본다. **마법사 마나 재생** `regen` 7 + 0.15/레벨 → **10.5 고정**(§7.1 — 레벨 1 · 10 · 20 · 30 에서 × 1.50 · 1.26 · 1.07 · 0.93): 일반 생명 × 1.6(D9) 뒤 마법사의 광역(화염구 16 마나)이 마나에 묶여 균열 4~7 판이 6분을 넘고(봇의 +1 조건) 떼에 쓰러졌다 — 화염구 계수를 앞 랭크에 몰아 올린 실험(1.55/+0.09)은 해금 시간을 바꾸지 못했고(2.99시간) 재생 10 + 0.15/레벨은 1.88시간(마나가 병목). 후반은 조금 낮다(10 + 0.05/레벨로 잰 `npm run measure` 는 마법사 해금 + 3 붕괴 48% ✗ — 고정 10.5 로 57% ✓ · 마법사 한 판 4.9분 ✗ 은 둘 다 같다). 실측(basic 봇 세션 · 균열 10 해금까지 · 사망/판은 균열 12 해금까지): **처음 보는 시드 921~930(마지막 값)** — 균열 10 해금 전사 중앙 **2.17시간**(1.87~2.69) · 마법사 **2.73시간**(2.23~2.99) · 클래스 차 25% · 사망/판 균열 5 · 6 · 7 · 8 전사 0.55 · 1.19 · 0.74 · 0.58 / 마법사 0.84 · 0.69 · 0.87 · 0.75(균열 7 이 앞뒤보다 튀지 않는다 — 전: 6 → 7 이 두 배) · 첫 사망 중앙 전사 40분(30~45분 7/10) · 마법사 32분(30~45분 4/10 · 균열 3~4 에서 13 · 16 · 17분인 시드 3) · 균열 1 첫 판 20/20 완료 · 사망 0 · 한 판 평균 5.7 / 5.8분 · 분당 처치 중앙 66 / 64. 처음 보는 시드 901~910(마법사 regen 10 + 0.05/레벨 — 전사는 같은 값): 해금 전사 2.43 · 마법사 2.63시간 · 차 8% · 사망/판 6 · 7 · 8 전사 1.09 · 0.72 · 0.50 / 마법사 1.08 · 0.87 · 0.71. 회전 베기 정타(봇 장비) 중앙 2.63번 · 시작 장비 첫 판 평균 3.53번(`balance.test`). **남은 것**: 첫 사망 30~45분은 전사가 대체로 맞고 마법사가 이른 시드가 있다(균열 3~4 · 13~28분) — 클래스 사이 초반 생존력 차이라 경사(두 클래스 공용)로는 한쪽만 옮길 수 없다(Jay 가 정할 것).

| L | 몬스터 생명 배율 | 피해 배율 | 골드 · 가치 배율 | 경험치 배율 | 아이템 위력(1.10^) | 마법 · 희귀 · 전설 배율 | 챔피언/정예 속성 | 챔피언 · 정예 팩 |
|---|---|---|---|---|---|---|---|---|
| 1 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 · 1.00 · 1.00 | 1 / 2 | 4 · 2 |
| 5 | 1.69 | 1.46 | 1.69 | 1.57 | 1.46 | 1.08 · 1.14 · 1.20 | 1 / 3 | 4 · 3 |
| 10 | 3.25 | 2.36 | 3.25 | 2.77 | 2.36 | 1.18 · 1.32 · 1.45 | 2 / 3 | 5 · 3 |
| 15 | 6.26 | 3.80 | 6.26 | 4.89 | 3.80 | 1.28 · 1.49 · 1.70 | 2 / 4 | 5 · 3 |
| 20 | 12.06 | 6.12 | 12.06 | 8.61 | 6.12 | 1.38 · 1.67 · 1.95 | 2 / 4 | 6 · 3 |
| 25 | 21.25 | 7.81 | 23.21 | 15.18 | 9.85 | 1.48 · 1.84 · 2.20 | 2 / 4 | 6 · 3 |
| 30 | 37.44 | 9.96 | 44.69 | 26.75 | 15.86 | 1.58 · 2.02 · 2.45 | 2 / 4 | 6 · 3 |

해금(`unlockAfter`): 완료하면 `riftUnlocked = max(riftUnlocked, min(maxLevel, L + (deaths === 0 ? unlockNoDeath : unlockClear)))`. 붕괴 · 포기는 바꾸지 않는다.

### 7.4 몬스터 — `data/monsters.js` (P3 · 시드)

```js
export const MON = { hpBase: 36, dmgBase: 22,  🔒(피드백 2 D1 · D9: dmgBase 24.5 → 22 · 밸런스 게이트 · 옛 19 · 3.5)  wakeCheckT: 6, maxAwake: 120, leash: 36, leashSec: 3, shieldFront: 0.5, frontDeg: 45,
                     stopFrac: 0.8, sepPad: 0.1, sepMaxNeighbors: 6, targetingRange: 15, directChaseR: 3, linkRadius: 11, linkMinDepth: 2,
                     reachTolerance: 0.3, resCap: 0.5, threatRange: 11 };
```

**등급** — `RANKS`

| 등급 | hp | dmg | xp | gauge(%) | tc | scale | stunMul | freezeMul | knockMul | flinchFrac | 기절 면역(초) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| normal | **1.6** 🔒(피드백 2 D9 · 옛 1) | 1 | 1 | **0.27**(피드백 2 · 옛 0.25) | normal | 1.00 | 1.0 | 1.0 | 1.0 | 0.15 | 0.5 |
| champion | 8 🔒(밸런스 게이트 · 옛 3.5) | 1.5 | 4 | 1.0 | champion | 1.15 | 0.6 | 0.7 | 0.5 | 0.30 | 1.5 |
| elite | 15 🔒(밸런스 게이트 · 옛 7) | 1.7 | 12 | 3.0 | elite | 1.30 | 0.4 | 0.5 | 0 | null | 2.0 |
| minion | 2 | 1.2 | 2 | 0.5 | minion | 1.05 | 0.7 | 0.8 | 0.5 | 0.25 | 1.0 |
| guardian | **27** 🔒(피드백 2 D3 · 밸런스 게이트 32 · 옛 28) | **1.4**(피드백 2 D3 · 옛 2.0) | 60 | 0 | guardian | 1.00 | 0.25 | 0.3 | 0 | null | 3.0 |
| split | 0.6 | 0.5 | 0.25 | 0.1 | split | 0.60 | 1.0 | 1.0 | 1.0 | 0.15 | 0.5 |
| spawn | 1 | 1 | 0 | 0 | null | 1.00 | 1.0 | 1.0 | 1.0 | 0.15 | 0.5 |

(기절 면역 열은 `STATUS.stunImmune`에 둔다 — §7.6.)

**종류** — `MONSTERS`(반지름 · 높이 m · 속도 m/s · 선회 rad/s · hp/dmg/xp/gauge는 배율 · 저항 표기 없는 것은 0)

| ID | 이름 | 템플릿 · 태그 | behavior | r · h | 속도 · 선회 | hp | dmg | xp | gauge | 저항 | aggro | eliteOk |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `ghoul` | 굶주린 구울 | humanoid · melee swarm | melee | 0.45 · 1.7 | 2.6 · 8 | 1.0 | 1.0 | 1.0 | 1.0 | — | 12 | ✓ |
| `fallen` | 타락 소인 | small · melee swarm | fallen | 0.35 · 1.1 | 5.2 · 12 | 0.8 | 0.6 | 0.6 | 0.6 | — | 12 | ✓ |
| `fallenShaman` | 소인 주술사 | small · ranged support | shaman | 0.35 · 1.2 | 3.6 · 8 | 0.8 | 0.9 | 1.5 | 1.5 | fire 0.25 | 14 | ✗ |
| `skeletonArcher` | 해골 궁수 | humanoid · ranged | archer | 0.40 · 1.8 | 3.2 · 8 | 0.8 | **0.45**(피드백 2 · 밸런스 게이트 0.6 · 옛 0.8) | 1.0 | 1.0 | cold 0.25 | 14 | ✓ |
| `shieldSkeleton` | 방패 해골 | humanoid · melee | shield | 0.45 · 1.85 | 3.0 · 3.0 | 1.2 | 0.9 | 1.3 | 1.3 | cold 0.25 | 12 | ✓ |
| `charger` | 돌격 짐승 | quadruped · melee | charger | 0.60 · 1.3 | 3.8 · 6 | 1.3 | 1.2 | 1.5 | 1.5 | — | 14 | ✓ |
| `bloater` | 역병 덩어리 | blob · melee | bloater | 0.55 · 1.4 | 2.6 · 6 | 1.0 | 1.0 | 1.0 | 1.0 | — | 12 | ✗ |
| `boneNest` | 뼈 둥지 | nest · structure | nest | 0.90 · 1.6 | 0 · 0 | 6.0 | 0 | 3.0 | 3.0 | — | 16 | ✗ |
| `boneling` | 뼈 새끼 | small · melee spawnling | melee | 0.30 · 0.9 | 4.2 · 12 | 0.35 | 0.5 | 0 | 0 | — | 16 | ✗ |
| `ashling` | 잿빛 하수인 | small · melee spawnling | melee | 0.32 · 1.0 | 4.5 · 12 | 0.5 | 0.6 | 0 | 0 | fire 0.5 | 16 | ✗ |

**공격** — 각 행의 `attacks`(예비 · 후딜 · 쿨 초 · reach는 몸 가장자리 사이 m · 판정 = 예비 끝 틱)

| 종류 | 공격 ID · kind | 예비 | 후딜 | 쿨 | 거리 | mul · 종류 | 예고 | 기타 |
|---|---|---|---|---|---|---|---|---|
| ghoul | `claw` melee | 0.55 | 0.60 | 0 | reach 0.9 · 90° | 1.0 · phys | pose(팔 들기) | — |
| fallen | `jab` melee | 0.35 | 0.45 | 0 | reach 0.7 · 70° | 1.0 · phys | pose(찌르기 자세) | params `{fleeAt: 0.5, fleeSec: 2.5, fleeSpeedMul: 1.2}` |
| fallenShaman | `shamanFire` projectile | 0.50 | 0.50 | 2.8 | range 11 | 1.0 · fire | glow(주황 손) | proj `{speed: 9, r: 0.35, life: 1.6, visual: 'shamanFire'}` |
| fallenShaman | `revive` cast | 1.50(채널 · 맞으면 끊김) | 0.50 | 8 | range 8 | — | glow(녹색 빛기둥) | params `{max: 3, hp: 0.6, window: 6, keepMin: 7, keepMax: 10, backoff: 4, backoffMul: 0.3}` |
| skeletonArcher | `arrow` projectile | 0.60 | 0.40 | 1.8 | range 11 | 1.0 · phys | aimLine(붉은 조준선 · aimLock 0.2) | proj `{speed: 16, r: 0.2, life: 1.2, visual: 'arrow'}` · params `{keepMin: 7, keepMax: 10, backoff: 4, backoffMul: 0.3}` |
| shieldSkeleton | `shieldBash` melee | 0.50 | 0.70 | 0 | reach 0.9 · 80° | 1.0 · phys | pose(방패 들기) | push 1.2 · params `{frontBlock: true}` |
| charger | `gore` melee | 0.60 | 0.60 | 0 | reach 1.0 · 80° | 1.0 · phys | pose | — |
| charger | `charge` charge | 0.90 | 0.80 | 5 | range 5~11 | 6.0 · phys(밸런스 게이트 · 옛 2.0) | groundLine(바닥 직선 · 폭 2r · 발 구르기) | push 2.0 · escape 1.0 · params `{speed: 14, maxLen: 13, wallStun: 2.0}` |
| bloater | `burst` explode | 1.00 | 0 | 0 | range 2.2 | 7.5 · phys(밸런스 게이트 · 옛 2.5) | groundCircle(r 2.8 · 붉게 부풀기) | escape 2.3 · params `{r: 2.8, poolR: 1.6, poolSec: 3, poolTick: 0.5, poolMulPerSec: 0.3}` — 터지면 자신 사망(경험치 · 드랍 · 게이지 없음) · 죽으면(터지기 전 포함) 웅덩이 |
| boneNest | `spawn` spawn | 0.50 | 0 | 3.5 | range 11 | — | glow(맥동) | params `{child: 'boneling', cap: 6}` |
| boneling | `jab` melee | 0.35 | 0.50 | 0 | reach 0.6 · 70° | 1.0 · phys | pose | — |
| ashling | `claw` melee | 0.40 | 0.50 | 0 | reach 0.7 · 80° | 1.0 · fire | pose | — |

- **params 자리**(W0 스캐폴드 확정): 「기타」 열의 params 중 행동 전체에 걸린 값(소인 `fleeAt…` · 주술사 · 궁수 `keepMin…` · 방패 `frontBlock`)은 `MonsterDef.params`, 그 공격에만 걸린 값(돌진 `speed · maxLen · wallStun` · 폭발 `r · pool…` · 둥지 `child · cap` · 부활 `max · hp · window`)은 그 `AttackDef.params`에 둔다 — `combat.js`의 정면 방패는 `getMonDef(typeId).params.frontBlock`.
- **W1 수정(NOTES-W1FIX · 밸런스)**: `MON.linkRadius` 8 → 11 · `MON.linkMinDepth` 2(새 키 — §5.17-1 초반 경사) · `RANKS.guardian.hp` 35 → 28(🔒) · 궁수 `backoffMul` 0.8 → 0.3 · 소인 주술사 `backoff 4 · backoffMul 0.3`(MonsterDef.params — 같은 kite 규칙). **W1 수정 2**: 첫 수정이 낮춘 🔒 `MON.dmgBase`(3.5 → 0.9)와 궁수 dmg(0.8 → 0.5)는 되돌렸다 — 전역 완화가 균열 5 이상의 위협을 지웠다(검증 실측: 해금 최고 + 3 붕괴 0/36). 첫 판 완화는 균열 레벨에 묶은 `RIFT.earlyDmg`(§7.3 · 균열 1의 몬스터 피해 × 0.205 — W1 수정 3)가 맡는다. 근거와 실험 표는 NOTES-W1FIX.
- **피드백 2(Jay 결정 2026-10-12 · NOTES-FEEDBACK 라운드 2)**: 🔒 `MON.dmgBase` 24.5 → **22**(입문 구간이 균열 1~6 으로 줄어 균열 7 부터 본 곡선 · 팩이 촘촘해져 같은 레벨의 받는 피해가 늘었다 — 19 는 후반이 쉬워 9시간에 균열 42~44) · 🔒 `RANKS.normal.hp` 1 → **1.6**(D9 — 회전 베기 「정타 2~3번」을 봇이 모은 장비 기준으로: 고정 자료 `test/fixtures/botGear.json` 중앙 2.58 · 전 1.38~1.5 · 시작 장비 첫 판 3.4) · `RANKS.normal.gauge` 0.25 → **0.27**(판 길이 보정) · 🔒 `RANKS.guardian.hp` 32 → **27** · `dmg` 2.0 → **1.4**(D3 — 입문 구간이 짧아져 균열 7~11 수호자 생명이 옛 경사보다 최대 1.44배 · 예고 기술 × 2(§7.5b)만으로는 전사 수호자 몫 35~55% · 4시드 실측 수호자가 죽인 몫 전사 16 · 마법사 15%) · 해골 궁수 `dmg` 0.6 → **0.45**(팩 밀도를 올린 뒤 전사 사망의 절반이 화살 — 봇은 화살을 피하지 않는다). 팩 밀도는 §7.5c.
- **멀리서 오는 위협의 상한**: 모든 몬스터 · 수호자 공격의 `range`와 속성 `params.range`는 `MON.threatRange`(11m) 이하다 — 기본 카메라가 플레이어에서 위 · 아래 11.4m를 보인다(§9.3 · data 검사). 화면 밖에서 쏘거나 표식을 까는 몬스터가 없다.
- 근접 공격은 중심 거리 ≤ r + reach + player.r에서 **시작**하고(관용 없음) 판정은 + `MON.reachTolerance`(0.3)까지 맞는다 — 다가오는 몬스터의 첫 휘두름이 서 있는 플레이어를 헛치지 않고, 예비 동안 0.3m 넘게 물러나면 피한다(플레이어 강타의 대칭 — §5.4).

### 7.5 정예 속성 — `data/monsterAffixes.js` (P3 · 시드)

`export const AFFIX_RULES = { minLevelByCount: [1, 1, 1, 1] }` (속성 수는 `riftRow`) · 하수인은 정예 속성 중 `minionShare: true`인 것을 전부 받는다 · 챔피언 팩은 구성원이 같은 속성을 받는다.

| ID | 이름 | mods | params | 하수인 | hazard | 제외 태그 | 제외 속성 | minLv | w | 훅 소유 |
|---|---|---|---|---|---|---|---|---|---|---|
| `fast` | 빠름 | speedMul 1.30 · atkSpeedMul 1.25 | — | ✓ | ✗ | — | — | 1 | 100 | P3 |
| `tough` | 강인함 | hpMul 1.5 · immune [flinch, knock] | — | ✓ | ✗ | — | shielding | 1 | 100 | P3 |
| `fireEnchanted` | 화염 강화 | res fire +0.3 | `{extraFire: 0.3, delay: 1.0, deathR: 3.0, deathMul: 3.6(밸런스 게이트 · 옛 1.2), escape: 2.5}` | ✓ | ✓(사망 폭발은 H1~H4 예외 — 플레이어가 시점을 정한다) | — | — | 1 | 90 | P3 |
| `coldEnchanted` | 냉기 강화 | res cold +0.3 | `{chillSec: 1.5, novaEvery: 8, novaFirst: 3, novaR: 4.0, delay: 1.3, novaMul: 2.4(밸런스 게이트 · 옛 0.8), novaChillSec: 2.0, escape: 3.5}` | ✓(적중 감속만 · 노바는 하수인 제외) | ✓ | — | — | 1 | 90 | P3 |
| `vampiric` | 흡혈 | — | `{leech: 0.5, regenPctPerSec: 0.003}`(W1 수정 · 0.01 → 0.003 — 수호자 싸움) | ✓ | ✗ | — | — | 1 | 80 | P3 |
| `shielding` | 보호막 | — | `{every: 9, first: 4, warn: 0.5, dur: 3.0}` | ✗ | ✗ | — | tough | 3 | 70 | P3 |
| `lightningEnchanted` | 번개 강화 | res lightning +0.3 | `{chance: 0.25, icd: 0.5, n: 3, speed: 6, r: 0.35, life: 2.0, mul: 0.5}` | ✓ | ✗(투사체) | — | — | 2 | 90 | P16 |
| `teleporter` | 순간이동 | — | `{farDist: 8, cd: 4, minR: 2.5, maxR: 4, vanish: 0.4}` | ✗ | ✗ | ranged | — | 3 | 80 | P16 |
| `jailer` | 감옥 | — | `{every: 7, first: 2, r: 1.2, delay: 0.8, rootSec: 1.5, range: 11, escape: 1.6}` | ✗ | ✓ | — | — | 4 | 70 | P16 |
| `splitter` | 분열 | — | `{n: 3, spread: 1.5}`(사본 = 등급 split · 속성 없음) | ✗ | ✗ | structure | — | 2 | 70 | P16 |
| `plague` | 역병 | — | `{every: 6, first: 2, r: 2.0, delay: 1.0, dur: 5, tick: 0.5, mulPerSec: 0.75(밸런스 게이트 · 옛 0.25), range: 11, escape: 2.4}` | ✗ | ✓ | — | — | 3 | 80 | P16 |
| `mortar` | 몰타르 | — | `{minDist: 6, every: 5, first: 1.5, n: 3, spread: 2.0, r: 1.5, delay: 1.2, mul: 2.7(밸런스 게이트 · 옛 0.9), range: 11, escape: 1.9}` | ✗ | ✓ | melee | — | 2 | 80 | P16 |

- `every` · `first`는 초(깬 뒤 첫 사용까지 `first` · 그 뒤 `every`). 막히면(위협 간격) 다음 틱에 다시.
- 바닥 위협을 만드는 속성의 예고 길이는 `params.delay`, H5의 탈출 거리는 `params.escape`다(§5.9 · data 검사). 수호자에게 붙은 속성은 `mods.res`를 적용하지 않는다(§8.3) · 저항 합은 `MON.resCap`(0.5) 이하.
- 몰타르의 「근접 전용 종 제외」(브리프 §3.5 예시) = `excludeTags: ['melee']` — 정예가 될 수 있는 종 중에서는 해골 궁수만 받는다. 순간이동은 원거리 종에 붙지 않는다(거리 유지와 충돌).

### 7.5b 수호자 — `data/guardians.js` (P3 · 시드)

| ID | 이름 | 템플릿 · 태그 | r · h | 속도 · 선회 | hp | dmg | 저항 | 공격 |
|---|---|---|---|---|---|---|---|---|
| `boneGiant` | 뼈 거인 | humanoid(거대 · 뼈) · melee | 1.30 · 4.6 | 3.2 · 2.5 | 1.1 | 1.0 | cold 0.15 | `swing` melee 예비 0.8 · 후딜 0.7 · reach 2.0 · 120° · mul 1.5 / `slam` cast 예비 1.2 · 후딜 1.0 · 쿨 7 · range 6.0 · 원뿔 r 6.5 · 100° · mul **5.0**(피드백 2 D3 — 예고 기술 × 3 → × 2 · 밸런스 게이트 7.5 · 옛 2.5) · shake 0.5 · escape 3.2 / `spikes` cast 예비 1.4 · 후딜 0.8 · 쿨 10 · range 11 · escape 3.9 · 선 5개(플레이어 방향 ±50°를 25° 간격) · len 12 · width 1.4 · mul **3.6**(피드백 2 D3 · 밸런스 게이트 5.4 · 옛 1.8) |
| `ashWitch` | 잿빛 마녀 | humanoid(긴 옷) · ranged | 0.55 · 2.2 | 4.0 · 6 | 0.9 | 1.0 | fire 0.15 | `ashBolt` projectile 예비 0.5 · 후딜 0.5 · 쿨 1.6 · range 11 · mul 1.0 · fire · proj `{speed: 11, r: 0.4, life: 1.6, visual: 'ashBolt'}` / `emberRain` cast 예비 1.2 · 후딜 0.6 · 쿨 8 · range 11 · escape 3.1 · 원 5개 r 1.8(하나는 플레이어 자리 · 넷은 2.5~3.5m 고리 위 72° 이상 떨어져) · mul **3.6**(피드백 2 D3 · 밸런스 게이트 5.4 · 옛 1.8) · fire / `summon` cast 예비 1.0 · 후딜 0.5 · 쿨 14 · `{child: 'ashling', n: 4, cap: 8}` |

- 고유 기술의 모양은 그 공격의 `params`(W0 스캐폴드 확정 — data 검사가 읽는다): slam `{shape:'cone', r:6.5, angleDeg:100, shake:0.5}` · spikes `{shape:'line', n:5, spreadDeg:50, stepDeg:25, len:12, width:1.4, count:5}` · emberRain `{shape:'circle', n:5, r:1.8, ringMin:2.5, ringMax:3.5, minSepDeg:72, count:5}` · summon `{child:'ashling', n:4, cap:8, r:2}`.
- 공통 params: boneGiant `{}` · ashWitch `{keepMin: 7, keepMax: 10, blinkNear: 3, blinkAfter: 1.5, blinkCd: 6, blinkDist: 6}`.
- 두 행 공통(MonsterDef와 같은 꼴 — `getMonDef`로 읽는다): `behavior: 'guardian'` · `xp: 1`(× RANKS.guardian.xp 60) · `gauge: 0` · `aggro: 99` · `eliteOk: false`.
- 저항이 낮은 까닭: 화염만 쓰는 마법사가 잿빛 마녀를 만나도(1:1 무작위) 처치 시간이 목표(30~70초) 안에 들도록 — 종류 저항 0.15 · 속성 저항은 받지 않는다.
- 수호자는 `riftRow(L).guardianAffixes`개의 정예 속성을 받는다(`rollAffixes` · 수호자 태그로 배제 규칙 · 속성의 `mods.res`는 받지 않는다 — 효과 훅과 나머지 mods만). 수호자 종류는 균열을 채울 때 `GUARDIANS` 가중치(1:1 — `data/guardians.js`의 `GUARDIAN_WEIGHTS`)로.

### 7.5c 팩 — `data/packs.js` (P3 · 시드)

| 팩 ID | 구성 | minLevel |
|---|---|---|
| `ghoulPack` | ghoul **8~16**(피드백 2 · 옛 6~12) | 1 |
| `fallenPack` | fallen **7~11**(옛 5~8) · fallenShaman 1~2 | 1 |
| `skeletonPack` | skeletonArcher **4~6**(옛 3~5) · shieldSkeleton **3~6**(옛 2~4) | 1 |
| `chargerPack` | charger 2~3 · ghoul **3~5**(옛 2~4) | 1 |
| `bloaterPack` | bloater 3~5 · ghoul **3~4**(옛 2~3) | 2 |
| `nestPack` | boneNest 1 · skeletonArcher 1~3 | 3 |

- **피드백 2 D9(맵 밀도)**: 일반 생명 × 1.6 으로 늘어난 판 길이를 팩 밀도로 맞춘다 — 몸받이(구울 · 소인 · 방패 해골) ~1.35배 · 궁수 3~5 → 4~6 · 돌격 짐승 · 역병 덩어리 · 주술사 · 둥지는 그대로(위협 종을 늘리면 사망이 그쪽으로 쏠렸다 — 실험). 놓을 자리 `PACK_PLACE.normalR` [0.6, 4.5] → **[0.6, 5.2]**.

```js
export const TILESET_PACKS = {
  crypt:  { ghoulPack: 30, skeletonPack: 30, bloaterPack: 15, nestPack: 15, chargerPack: 10 },
  cavern: { fallenPack: 35, ghoulPack: 20, chargerPack: 20, bloaterPack: 15, skeletonPack: 10 },
};
export const ELITE_PACK = {
  types: { ghoul: 25, fallen: 25, skeletonArcher: 20, shieldSkeleton: 15, charger: 15 },   // 챔피언 · 정예가 될 종
  champion: { min: 2, max: 4, maxByType: { charger: 3 } },
  elite: { minions: [3, 5] },
  placeR: [2.5, 4.5],            // 팩 자리에서 구성원을 놓는 거리
};
```

### 7.6 전투 · 상태 · 줍기 · 사망 · 계측 — `data/combat.js` (P2 · 시드)

```js
export const COMBAT = { armorK: 80, resK: 50,  🔒  drCap: 0.75, minTaken: 0.2, baseCrit: 0.05, baseCritDmg: 0.5, critCap: 0.75,
  cdrCap: 0.40, costCap: 0.40, moveCap: 0.25, blockReduce: 0.6, lohTargets: 5, lohTargetsTick: 2, lowLife: 0.35, vitLife: 0.012,  🔒
  bigHitFrac: 0.25, hitstop: { sec: 0.05, gap: 0.4 }, launchSpeed: 7, dmgTakenCap: 0.5 };
export const STATUS = { stunImmune: { normal: 0.5, champion: 1.5, elite: 2.0, minion: 1.0, guardian: 3.0, split: 0.5, spawn: 0.5 },
  chillSlow: 0.30, chillDecayDelay: 3.0, chillDecayPerSec: 20, freezeAt: 100, freezeSec: 1.5, freezeImmune: 2.5,
  burnSec: 3, burnTick: 0.5, shockTaken: 0.15, shockSec: 3, knockSec: 0.2, knockImmune: 1.0, flinchSec: 0.25, flinchImmune: 1.2, playerChill: 0.40 };
export const POTION = { heal: 0.45, cd: 8 };
export const GLOBE = { heal: 0.20 };
export const PICKUP = { goldR: 2.5, potionR: 1.2, matR: 1.5, globeR: 1.2, itemReach: 1.0, interactReach: 0.8, validate: 1.5, validateH: 0.75, labelReach: 20, objectH: 2.5,
  scatterMin: 0.8, scatterMax: 2.2, scatterSep: 0.6, scatterTries: 8 };
export const DEATH = { corpseSec: 6, calmSec: 0, protectSec: 1.5, panelDelay: 0.3 };   // W1 수정: calmSec 1.0 → 0(§5.10 — 사망한 틱에 진정)
export const METER = { window: 150, killCap: 300, swarmOn: 25, swarmOff: 15 };
export const HAZARD = { packGap: 1.2, afterRoot: 0.8, nearR: 3.0, countR: 4.0, maxNear: 6, react: 0.25, slowSpeed: 3.6 };
export const BUFFER = { sec: 0.5, tail: 0.1 };
export const COND = { rageAt: 50, lifeFrac: 0.35, knockSec: 0.5 };   // P2 W1 — 조건부 패시브 문턱(§5.7) · 피드백 2 D10: knockSec — targetDisabled 가 넉백이 끝난 뒤 이 초까지도 참
// 피드백 2 D8: COMBAT.sightBack 0.3 — 지점 스킬(메테오 · 작은 메테오)의 목표가 벽 타일에 가려지면 마지막 보이는 점에서 이만큼(m) 플레이어 쪽(§5.4 sightClip)
```

- 흩뿌림: 드랍마다 `rng.loot`로 각도 · 거리(`scatterMin..scatterMax`)를 골라 걷기 가능하고 다른 드랍과 `scatterSep` 넘게 떨어진 첫 자리(최대 `scatterTries`번 · 실패하면 마지막 시도 자리).
- 자동 줍기: 골드 `goldR` · 재료 `matR` · 포션 `potionR`(소지 상한 아래일 때만) · 구슬 `globeR + onGlobe().radiusAdd`(전설 생명의 띠 +1.0) → 생명 `lifeMax × GLOBE.heal × (1 + globePct) × onGlobe().mul`.

### 7.7 아이템 · 옵션 — `data/items.js` · `data/itemAffixes.js` (P5 · 시드)

```js
export const ITEM = { baseVar: 0.10, durMax: 100, deathDurLoss: 10, ownClassChance: 0.85, otherClassLegend: 0.25, ownSetChance: 0.8,
  mainBias: 3, offMainBias: 0.3,
  affixCount: { normal: { 0: 1 }, magic: { 1: 50, 2: 50 }, rare: { 3: 30, 4: 35, 5: 25, 6: 10 } },     // 전설 = 행의 affixes 범위 · 세트 3~4
  maxPrefix: { normal: 0, magic: 1, rare: 3, legendary: 3, set: 3 }, maxSuffix: { normal: 0, magic: 1, rare: 3, legendary: 3, set: 3 },
  slotValue: { mainHand1h: 20, mainHand2h: 30, offhand: 15, helm: 12, chest: 18, gloves: 10, boots: 10, belt: 8, amulet: 20, ring: 15 },   🔒(slotValue)
  reqLevelCap: 30 };   // 피드백 2 D2: 요구 레벨 = min(ilvl, reqLevelCap) — 캐릭터 레벨 캡(LEVEL_CAP 30)과 같다(균열 30 위에서 주운 장비도 낀다 · §5.13-4)
export const BASE_TIERS = [ { minIlvl: 1, mul: 1.00, weight: 30 }, { minIlvl: 10, mul: 1.06, weight: 50 }, { minIlvl: 20, mul: 1.12, weight: 70 } ];
export const SLOT_WEIGHTS = { mainHand: 14, offhand: 8, helm: 10, chest: 10, gloves: 10, boots: 10, belt: 9, amulet: 7, ring: 12 };
export const FIST = { warrior: { dmg: [3, 7], aps: 1.40, type: 'phys' }, mage: { dmg: [3, 6], aps: 1.40, type: 'lightning' } };
export const COMPARE = { minGain: 0.005, upgradeGain: 0.03 };    // minGain: 화면 비교 화살표(▲) · 봇 장착의 최소 powerScore 증가(0.5%) · 피드백 2 D5 upgradeGain: 「업그레이드」로 세는 문턱 3%(rift.stats.upgrades · 완료 패널 · 측정 — §5.13-5)
```

**기본형** — `BASES`(ilvl 1 · 단계 0의 값 · 이름은 `base.<id>.<tier>`)

| ID | 부위 · 클래스 | 손 | 피해 | aps | 방어도 · 기타 | weight | look | 단계 이름(0 · 1 · 2) |
|---|---|---|---|---|---|---|---|---|
| `sword` | mainHand · warrior | 1 | 3~7 | 1.40 | — | 25 | sword | 낡은 검 · 장검 · 군주의 검 |
| `axe` | mainHand · warrior | 1 | 3~8 | 1.30 | — | 20 | axe | 손도끼 · 전투 도끼 · 처형자의 도끼 |
| `mace` | mainHand · warrior | 1 | 4~8 | 1.20 | — | 20 | mace | 곤봉 · 철퇴 · 성전의 철퇴 |
| `greatsword` | mainHand · warrior | 2 | 5~10 | 1.15 | — | 20 | greatsword | 양손검 · 대검 · 거인의 대검 |
| `greataxe` | mainHand · warrior | 2 | 6~11 | 1.05 | — | 15 | greataxe | 벌목 도끼 · 대도끼 · 파멸의 대도끼 |
| `shield` | offhand · warrior | — | — | — | 방어도 10 · 막기 0.12 | 1 | shield | 나무 방패 · 철 방패 · 탑 방패 |
| `wand` | mainHand · mage | 1 | 3~6 | 1.40 | — | 55 | wand | 나무 마법봉 · 수정 마법봉 · 별의 마법봉 |
| `staff` | mainHand · mage | 2 | 6~10 | 1.10 | — | 45 | staff | 지팡이 · 룬 지팡이 · 대마법사의 지팡이 |
| `orb` | offhand · mage | — | — | — | 추가 피해 0~2 · 마나 +10 | 1 | orb | 유리 구슬 · 마법구 · 별빛 구체 |
| `helm` | helm · 공용 | — | — | — | 방어도 6 | 1 | helm | 가죽 두건 · 강철 투구 · 군주의 투구 |
| `chest` | chest · 공용 | — | — | — | 방어도 12 | 1 | chest | 누빔 갑옷 · 사슬 갑옷 · 판금 갑옷 |
| `gloves` | gloves · 공용 | — | — | — | 방어도 4 | 1 | gloves | 가죽 장갑 · 사슬 장갑 · 건틀릿 |
| `boots` | boots · 공용 | — | — | — | 방어도 4 | 1 | boots | 가죽 장화 · 사슬 장화 · 판금 장화 |
| `belt` | belt · 공용 | — | — | — | 방어도 3 | 1 | belt | 끈 허리띠 · 가죽 허리띠 · 판금 허리띠 |
| `amulet` | amulet · 공용 | — | — | — | — | 1 | amulet | 목걸이 · 부적 목걸이 · 왕의 목걸이 |
| `ring` | ring · 공용 | — | — | — | — | 1 | ring | 반지 · 인장 반지 · 군주의 반지 |

- 모든 부위에 L1에서 나오는 기본형 ≥ 1(단계 0의 minIlvl 1) — 데이터 검사.
- 양손 무기의 기본 DPS는 한손의 약 1.15~1.25배다(대검 8.6 · 대도끼 8.9 / 검 7.0 · 도끼 7.15 · 철퇴 7.2 · 지팡이 8.8 / 마법봉 6.3 + 마법구 추가 피해 = 7.7) — 보조 칸 하나(기본 값 + 옵션 3~6)와 비슷하게 맞춘 값이라 「한손 + 방패/마법구」가 죽은 선택지가 되지 않는다.

**옵션** — `ITEM_AFFIXES`(32행 · 부위 약자 W 주무기 · O 보조 · H 투구 · C 갑옷 · G 장갑 · B 장화 · T 허리띠 · A 목걸이 · R 반지)

`export const AFFIX_TIERS = { minIlvl: [1, 6, 12, 18, 24], weight: [100, 70, 45, 25, 12] }` 🔒

| ID | kind | stat | 부위 | w | scale | T1 | T2 | T3 | T4 | T5 | dec |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `str` | prefix | str(main str) | W O H C G B T A R | 100 | flat | 4–8 | 9–15 | 16–25 | 26–38 | 39–55 | 0 |
| `int` | prefix | int(main int) | W O H C G B T A R | 100 | flat | 4–8 | 9–15 | 16–25 | 26–38 | 39–55 | 0 |
| `vit` | suffix | vit | O H C G B T A R | 100 | flat | 3–6 | 7–12 | 13–20 | 21–30 | 31–45 | 0 |
| `weaponDmg` | prefix | weaponDmgPct | W | 150 | flat | 8–14 | 15–22 | 23–32 | 33–45 | 46–60 | 0 |
| `attackSpeed` | suffix | attackSpeedPct | W G A R | 60 | flat | 3–5 | 5–7 | 7–9 | 9–11 | 11–13 | 0 |
| `critChance` | prefix | critChance | O H G A R | 70 | flat | 1–2 | 2–3 | 3–4 | 4–5 | 5–6 | 1 |
| `critDamage` | suffix | critDamage | W G A R | 70 | flat | 8–14 | 14–20 | 20–28 | 28–38 | 38–50 | 0 |
| `physDmg` | prefix | physPct | W O G A R | 40 | flat | 4–7 | 7–10 | 10–14 | 14–19 | 19–25 | 0 |
| `fireDmg` | prefix | firePct | W O G A R | 40 | flat | (위와 같음) | | | | | 0 |
| `coldDmg` | prefix | coldPct | W O G A R | 40 | flat | (위와 같음) | | | | | 0 |
| `lightningDmg` | prefix | lightningPct | W O G A R | 40 | flat | (위와 같음) | | | | | 0 |
| `skillDmg` | prefix | skillPct(param skill) | O H C B A | 60 | flat | 8–12 | 12–16 | 16–22 | 22–28 | 28–36 | 0 |
| `cdr` | suffix | cdr | O H G A R | 40 | flat | 2–3 | 3–4 | 4–5 | 5–6 | 6–8 | 1 |
| `costReduce` | suffix | costReduce | O H T R | 40 | flat | 3–5 | 5–7 | 7–9 | 9–11 | 11–14 | 0 |
| `lifePct` | suffix | lifePct | O C T A | 60 | flat | 3–5 | 5–7 | 7–9 | 9–11 | 11–14 | 0 |
| `lifeRegen` | suffix | lifeRegen | H C T A R | 50 | pow | 0.6–1.0 | 1.0–1.6 | 1.6–2.4 | 2.4–3.4 | 3.4–4.6 | 1 |
| `lifeOnHit` | suffix | lifeOnHit | W G A R | 50 | pow | 0.4–0.8 | 0.8–1.3 | 1.3–2.0 | 2.0–2.8 | 2.8–3.8 | 1 |
| `armor` | prefix | armor | O H C G B T | 100 | pow | 3–6 | 6–10 | 10–15 | 15–21 | 21–28 | 0 |
| `allRes` | suffix | allRes | O H C G B T A R | 50 | pow | 2–3 | 3–5 | 5–7 | 7–9 | 9–12 | 0 |
| `physRes` | suffix | physRes | O H C G B T A R | 35 | pow | 4–7 | 7–11 | 11–15 | 15–20 | 20–26 | 0 |
| `fireRes` · `coldRes` · `lightningRes` | suffix | (각자) | O H C G B T A R | 35 | pow | (physRes와 같음) | | | | | 0 |
| `moveSpeed` | prefix | moveSpeed | B | 120 | flat | 4–6 | 6–8 | 8–10 | 10–12 | 12–15 | 0 |
| `aoeDmg` | prefix | aoePct | C G A | 40 | flat | 3–5 | 5–8 | 8–11 | 11–14 | 14–18 | 0 |
| `eliteDmg` | prefix | elitePct | W A R | 40 | flat | 3–5 | 5–7 | 7–10 | 10–13 | 13–16 | 0 |
| `thorns` | suffix | thorns | O C T | 40 | pow | 2–4 | 4–7 | 7–11 | 11–16 | 16–22 | 0 |
| `goldFind` | suffix | goldFind | H T A R | 40 | flat | 5–10 | 10–15 | 15–22 | 22–30 | 30–40 | 0 |
| `magicFind` | suffix | magicFind | H B A R | 40 | flat | 4–7 | 7–10 | 10–14 | 14–19 | 19–25 | 0 |
| `xpPct` | suffix | xpPct | H A R | 30 | flat | 2–3 | 3–5 | 5–7 | 7–9 | 9–12 | 0 |
| `potionPct` | suffix | potionPct | T A | 40 | flat | 5–10 | 10–15 | 15–20 | 20–25 | 25–30 | 0 |
| `globePct` | suffix | globePct | B T R | 40 | flat | 5–10 | 10–20 | 20–30 | 30–40 | 40–50 | 0 |

- 모든 부위가 접두 ≥ 3 · 접미 ≥ 3을 허용한다(희귀 6옵션이 늘 가능) · 모든 옵션이 어느 부위에선가 나온다 — 데이터 검사.
- 스탯 키 중 옵션에 없는 것(`armorPct` · `resPct` · `allPct` · `lifePctOnHit` · `burnFrac` · `freezeAt` · `freezeDurPct` · `manaRegenPct` · `dmgTakenReduce` · `rageOnHit`)은 패시브 · 세트만 쓴다(§3.3 StatKey에 `allPct` · `burnFrac` · `freezeAt` · `freezeDurPct` 포함).

### 7.8 드랍 — `data/drops.js` (P5 · 시드)

```js
export const TREASURE = [   🔒 (전부)
  { id: 'normal',   picks: 1, goldMul: 1 / 3, w: { none: 552, gold: 270, potion: 5,  globe: 80, material: 8,   gear: 85 } },   // W1 수정: globe 25 → 80(none 787 → 732) · 피드백 1: gold 90 → 270 · goldMul 1.0 → 1/3(none 732 → 552)
  { id: 'minion',   picks: 1, goldMul: 0.6, w: { none: 300, gold: 300, potion: 30, globe: 150, material: 20, gear: 200 } },  // W1 수정: globe 80 → 150(none 520 → 450) · 피드백 1: gold 150 → 300 · goldMul 1.2 → 0.6(none 450 → 300)
  { id: 'champion', picks: 2, goldMul: 1.6, w: { none: 315, gold: 250, potion: 25, globe: 90, material: 45,  gear: 275 } },
  { id: 'elite',    picks: 4, goldMul: 2.2, w: { none: 150, gold: 300, potion: 50, globe: 60, material: 40,  gear: 400 } },
  { id: 'guardian', picks: 8, goldMul: 4.0, w: { none: 0,   gold: 400, potion: 50, globe: 0,  material: 100, gear: 450 }, guaranteed: 2 },
  { id: 'split',    picks: 1, goldMul: 0.5, w: { none: 900, gold: 60,  potion: 0,  globe: 40, material: 0,   gear: 0 } },
];
export const RARITY = {   🔒
  base: { normal: 1000, magic: 640, rare: 95, legendary: 6.5, set: 1.8 },
  rank: { normal:   { magic: 1.0, rare: 1.0, legendary: 1.0, set: 1.0 },
          minion:   { magic: 1.2, rare: 1.4, legendary: 1.4, set: 1.4 },
          champion: { magic: 1.5, rare: 2.2, legendary: 2.2, set: 2.2 },
          elite:    { magic: 2.0, rare: 3.2, legendary: 3.5, set: 3.5 },
          guardian: { magic: 2.5, rare: 5.0, legendary: 6.0, set: 6.0 },
          split:    { magic: 1.0, rare: 1.0, legendary: 1.0, set: 1.0 } },
  value: { normal: 1, magic: 2.5, rare: 6, legendary: 15, set: 15 },
};
export const GUARANTEE = { rare: 100, legendary: 3, set: 0.8 };   🔒
export const MF = { k: 2.0, scale: { magic: 1.0, rare: 0.8, legendary: 0.6, set: 0.6 } };   🔒
export const BLP = { rate: 0.004, capCount: 300, hard: 400 };   🔒
export const GOLD = { base: 3 };   🔒
export const MATERIAL_DROP = { scrap: 70, dust: 25, essence: 5 };
```

- **피드백 1(Jay 2026-10-12 「일반 몬스터가 골드 · 아이템을 드랍하는지」)**: 일반 몬스터는 처음부터 드랍했다(일반 처치 골드 9% · 장비 8.5% — 그 장비의 ~57% 가 Alt 를 눌러야 이름표가 보이는 일반 등급). 「적게 잡으면 아무것도 안 떨어진다」로 보여서 골드 더미를 **더 자주 · 더 작게** 했다 — normal · minion 의 none 무게를 gold 로 옮기고 goldMul 을 그만큼 낮춘다. 처치당 기대 골드 = 무게 × `expectedGoldPile(GOLD.base × goldMul × riftRow(L).goldMul)`(반올림 · 최소 1 을 넣은 정확한 적분)은 균열 1 · 6~30 에서 ±1% · 2~5 에서 ±3.6% · 30레벨 평균 +0.13%(normal) · −0.06%(minion) — §7.14 의 골드 · 경제 산수는 그대로다(`theory.test` 「피드백 1」). 장비 · 구슬 · 포션 · 재료 무게는 그대로. 「떨어지는 순간 흰 장비도 잠깐 이름표 · 골드 줍기 표시」는 ui(§10.4 — `Drop.born` · `DROP_PICKED{kind:'gold', amount}` · 문자열 `label.goldPicked`).

### 7.9 전설 · 세트 — `data/legendaries.js` (P5 · 시드 · 훅은 P1 `equipHooks.js`)

| ID | 이름 | 기본형 · 클래스 | hook | params | 추가 옵션 |
|---|---|---|---|---|---|
| `emberMaelstrom` | 불타는 소용돌이 | greatsword · warrior | `whirlwindVortex` | `{everySec: 0.6, r: 2.0, dur: 2.0, tick: 0.5, coefPerSec: 0.35}` 화염 | 3~4 |
| `quakeTreads` | 진동 장화 | boots · warrior | `leapQuake` | `{mul: 0.6}` — 도약 착지가 지진(파동 셋 · 비용 없음) | 3~4 |
| `ragingHorn` | 분노의 뿔 | helm · warrior | `chargeRefund` | `{ragePerHit: 5, resetAt: 3, resetTo: 1.0}` — 돌진 적중당 분노 · 한 돌진에 3마리 이상 맞히면 남은 쿨다운을 1초로(넉백 면역 1초와 함께 무한 넉백 루프가 없다) | 3~4 |
| `ancestorBelt` | 선조의 허리띠 | belt · warrior | `warCryHeal` | `{pct: 0.25}` | 3~4 |
| `tremorFists` | 진동 주먹 | gloves · warrior | `stompShockwave` | `{len: 10, width: 2.0, coef: 1.0}` — 회전 베기가 앞으로 충격파(피드백 1 — 옛 지면 강타) | 3~4 |
| `piercingFlame` | 꿰뚫는 화염 | wand · mage | `fireballPierce` | `{pierce: 3}` — 화염구가 관통하며 맞힐 때마다 폭발 | 3~4 |
| `stormOrb` | 폭풍의 구체 | orb · mage | `chainBounce` | `{extra: 2}` | 3~4 |
| `frostWalkers` | 서리 걸음 | boots · mage | `teleportNova` | `{}` — 순간이동 도착에 서리 노바(그 랭크 · 없으면 1랭크 · 비용 없음) | 3~4 |
| `ashenCrown` | 잿빛 왕관 | helm · mage | `meteorShower` | `{n: 2, r: 2.0, mul: 0.5, delay: 0.3}` | 3~4 |
| `rimeRing` | 서리 반지 | ring · mage | `frozenShatter` | `{r: 2.5, coef: 0.8}` — 빙결 중 처치하면 얼음 폭발(냉기) | 3~4 |
| `bloodPact` | 피의 서약 | amulet · 공용 | `killExplode` | `{chance: 0.10, r: 3.0, pctOfMax: 0.2}` — 처치 시 확률로 시체 폭발(그 대상 최대 생명의 20% · 물리 · flat) | 3~4 |
| `verdantSash` | 생명의 띠 | belt · 공용 | `globeDouble` | `{mul: 2, radiusAdd: 1.0}` | 3~4 |

모든 전설 `weight: 1`. 적용 방식(§8.5): `bloodPact` · `rimeRing` · `verdantSash`는 **사건형**(`at: 'kill'` · `'kill'` · `'globe'` — `EQUIP_HOOKS`), 나머지 아홉은 **패치형**(`skill` = 대상 노드 · `patch` = §8.4 표의 키 — 예 `{skill: 'fireball', patch: {pierce: 3}}` · `{skill: 'leap', patch: {landQuake: {mul: 0.6}}}`).

세트 — `SETS`:

| ID | 이름 | 클래스 | 조각(ID · 기본형) | 2세트 | 4세트(2세트에 더해) |
|---|---|---|---|---|---|
| `ironLord` | 강철 군주 | warrior | `ironLordHelm` helm · `ironLordPlate` chest · `ironLordGrips` gloves · `ironLordGreaves` boots | `armorPct` 25 · `str` 20 | `aoePct` 40 · `dmgTakenReduce` 10 |
| `ashSage` | 잿빛 현자 | mage | `ashSageCowl` helm · `ashSageRobe` chest · `ashSageGloves` gloves · `ashSageSteps` boots | `manaRegenPct` 40 · `int` 20 | `firePct` 30 · `coldPct` 30 · `cdr` 8 |

### 7.10 경제 — `data/economy.js` (P6 · 시드)

```js
export const ECON = { potionMax: 10, scrollMax: 10, recordsMax: 200, buybackMax: 10 };
export const START = { gold: 0, potions: 5, scrolls: 3, riftUnlocked: 1, materials: { scrap: 0, dust: 0, essence: 0 } };
export const PRICES = { sellRate: 0.15, buyMul: { normal: 1.5, magic: 1.5, rare: 2.5 }, repairBase: 5.0, potion: 15, scroll: 10, resetPerLevel: 30 };   🔒(sellRate · buyMul · repairBase · potion) · 밸런스 게이트: repairBase 4.0 → 5.0
export const GAMBLE = { price: 110, slotRef: 15, mainHandValue: 24, rarity: { magic: 720, rare: 240, legendary: 30, set: 10 } };   🔒
export const REROLL = { gold: 90, growth: 1.5, cap: 8, dustBase: 1, dustCap: 5, essenceFrom: 3 };   🔒
export const CRAFT = { gold: 150, scrap: 20, dust: 10, essence: 0 };
export const SALVAGE = { normal: { scrap: 1 }, magic: { scrap: 1, dust: 1 }, rare: { scrap: 1, dust: 2 }, legendary: { dust: 2, essence: 1 }, set: { dust: 2, essence: 1 } };
export const SHOP = { blacksmithStock: 9, generalStock: 4, stockRarity: { magic: 85, rare: 15 }, stockIlvlOffset: -1, generalSlots: { amulet: 1, ring: 3 } };
```

가격(전부 정수 · `PL = char.riftUnlocked` · `PLc = min(char.riftUnlocked, char.lastRiftLevel)` — 붕괴 뒤 낮춰 하는 사람이 소모품을 비싸게 사지 않게 · `G = GROWTH.gold`):

| 무엇 | 식 |
|---|---|
| 아이템 가치 | `round(ITEM.slotValue[slotKey] × RARITY.value[rarity] × G^(ilvl−1))` (§5.13) |
| 판매가 | `max(1, round(value × sellRate))` · 되사기 = 판 값 그대로 |
| 상점 구매가 | `round(value × buyMul[rarity])`(희귀 2.5 — 부위 · 옵션을 보고 골라 사는 희귀가 사냥을 앞지르지 않게 · §7.14) |
| 수리비 | `round(Σ 장착 ITEM.slotValue[slotKey] × repairBase × G^(ilvl−1) × (durMax − dur)/durMax)` — **등급과 무관**(전설 · 세트를 낄수록 사망이 비싸지지 않게) · 사망 1회(−10%) = 장착 slotValue 합(10칸 143) × 4.0 × 0.1 = 71.5 × G^(ilvl−1)(밸런스 게이트 repairBase 5 · 옛 4 = 57.2) |
| 포션 · 두루마리 | `round(potion × G^(PLc−1))` · `round(scroll × G^(PLc−1))` |
| 도박 | `round(GAMBLE.price × slotValue / GAMBLE.slotRef × G^(PL−1))`(부위의 `ITEM.slotValue` · 주무기는 `GAMBLE.mainHandValue` 24 · 부위 평균 ≈ 110) · ilvl = PL · 부위는 고른다 · 등급 확률은 `GAMBLE.rarity`에서 그 부위 · 클래스에 전설 · 세트가 없으면 그 몫을 희귀로 내린 값(`gambleOdds(char, slot)`)을 화면에 공개 |
| 재굴림 | 골드 `round(REROLL.gold × G^(ilvl−1) × growth^min(rerolls, cap))` + 비전 가루 `min(dustCap, dustBase + rerolls)` + 망각의 정수 `rerolls ≥ essenceFrom(3) ? 1 : 0`(깊은 재굴림 — 정수가 쓰이는 곳) |
| 제작 | 골드 `round(CRAFT.gold × G^(PL−1))` + 고철 20 · 가루 10 → 희귀(`rollGear` · 고른 부위) · ilvl = PL |
| 스킬 초기화 | `round(resetPerLevel × level × G^(PLc−1))` |
| 무료 | `potions === 0 && gold < 포션 값`이면 포션 1 · 두루마리도 같은 규칙(파밍 경로가 되지 않게 — 그 밖에는 0원이 아니다) |
| 상점 재고 | 대장장이 9: 자기 클래스 무기 · 보조 · 방어구(부위 가중치 = SLOT_WEIGHTS에서 장신구 제외) · 등급 `stockRarity` · ilvl = max(1, PL − 1) / 잡화상 4: 목걸이 1 · 반지 3 · 같은 규칙 — **균열 한 판마다 새로**(`char.shop.stockRun` — 같은 판에서 몇 번 돌아와도 같은 재고 · 저장되어 새로 고침으로 바뀌지 않는다 · 브리프 §3.8 「귀환할 때마다」를 「판마다」로 읽는다) |

### 7.11 경험치 — `data/economy.js`의 `XP` (P6 · 시드)

```js
export const XP = { base: 5, req: { a: 1300, g: 1.15 }, reqEarly: [60, 300, 700], completeBonus: 560,  🔒   // 밸런스 게이트: a 1100 → 1300 · W1 수정: [200, 500, 900] → [60, 300, 700]
  diff: { penaltyFrom: 12, penaltyStep: 0.1, penaltyMin: 0.3, bonusStep: 0.1, bonusMax: 0.5 } };
```

- 처치 경험치 = `round(XP.base × type.xp × rank.xp × riftRow(monLevel).xpMul × diffMul × (1 + xpPct))` · `diffMul` = (캐릭터 레벨 − 몬스터 레벨 = d) d > 12이면 `max(0.3, 1 − 0.1 × (d − 12))`(정상 경로의 d = 9~11은 감점 0 — 낮은 균열 파밍만 깎인다), d < 0이면 `min(1.5, 1 + 0.1 × −d)`, 그 밖 1.
- 균열 완료 보너스 = `round(completeBonus × xpMul(L))`.
- 레벨 n → n+1 필요량 `xpReq(n)` = n ≤ 3이면 `XP.reqEarly[n − 1]`(첫 판 안에 스킬 3점 — W1 수정: 레벨 2 ≈ 일반 12처치(첫 팩 안에 첫 스킬) · 레벨 3 ≈ 72 · 레벨 4 ≈ 212), 그 뒤 `round(1300 × 1.15^(n−1))`: 60, 300, 700, 1977, 2274, 2615, 3007, 3458, 3977, 4573, 5259, 6048, 6955, 7999, 9198, 10578, 12165, 13990, 16088, 18501, 21276, 24468, 28138, 32359, 37213, 42795, 49214, 56596, 65085 (누적: 레벨 10 = 18,368 · 레벨 30 = 486,866 — 밸런스 게이트(a 1300) · a 1100 이면 15,704 · 412,126). 캡(30) 뒤 경험치는 버린다.

### 7.12 맵 · 타일셋 · 마을 — `data/mapgen.js` · `tilesets.js` · `town.js` (P4 · 시드)

```js
export const MAPGEN = { rooms: [10, 14], roomTiles: [8, 13], bigRoomChance: 0.25, bigRoomTiles: [13, 16], corridorLen: [3, 8], corridorWidth: [2, 3],
  gridMax: 96, margin: 2, loops: [0, 2], attempts: 40, propsPerRoom: [2, 6], pillarRoomMin: 11,
  normalPerArea: 90, normalPerRoom: [2, 5], corridorSlotMinLen: 6, slotSpacing: 6, spawnClear: 18, eliteMinDepth: 2, startRoomTiles: [8, 9] };
// W1 확정: MAPGEN.normalMin 56 — 아래 규칙만으로는 일반 자리가 시드 100개 최소 38 · 평균 51이라 놓인 게이지가 100%를 못 넘을 수 있다(§7.14는 ~60을 가정).
//   규칙대로 놓은 뒤 넓은 방부터 더하고(6m · 18m 유지) 모자라면 같은 줄기로 다시 만든다 — 시드 3,000개 최소 56 · 평균 ~58.
export const PATHING = { maxNodes: 20000 };   // 밸런스 게이트: 6000 → 20000(생성 맵 8~30m 클릭 1,800쌍의 1.6% 가 [] — 벽 너머 먼 클릭이 씹혔다 · 20000 이면 0% · p99 7.7ms)
export const FLOW = { everySec: 0.2, recenterCells: 2, maxSteps: 100,
                      far: { maxSteps: 1000, everySec: 1.0, recenterCells: 16 } };   // 리뷰 수정: 먼 흐름장(흐름장 밖 깬 몬스터 · 필요할 때만 · updateFlow(…, opts))
```

- 생성(§8.7): 시작 방 → 「방에서 통로를 내고 방을 붙이기」 무작위 나무 → 가까운 방 사이 고리 0~2 → 타일(바닥 · 벽 = 바닥에 8방향으로 닿는 비바닥) → 소품 → 빛 → 팩 자리(normal: 방 면적 / 90m² 반올림을 [2, 5]로 · 길이 ≥ 6타일 통로에 1 · 서로 6m · 시작점에서 18m 안 금지 / champion · elite: `riftRow`의 수만큼 depth ≥ 2인 방에서 깊은 순 → 무작위). 통로 폭 2~3타일 = **4~6m**(떼가 몰려올 수 있게 — 브리프 §8.4).
- 타일셋: 균열은 `hash32(seed, level, 9) % 2`로 `crypt`/`cavern`(가중치 1:1).

| 타일셋 | 소품(kind · w · 막음 · r · h · 자리) | 빛(방마다 2~4) | 환경음 |
|---|---|---|---|
| `crypt` 지하 묘지 | pillar 3 ✓ 0.6 3.0 room · coffin 4 ✓ 0.7 0.8 wall · candles 5 ✗ 0.3 0.5 wall · bones 4 ✗ 0.4 0.2 floor · urn 3 ✓ 0.35 0.8 wall | candle `#ffb060` 1.2 r6 flicker 0.3 y1.0 · torch `#ff8a3a` 1.6 r8 0.25 y2.2 | `cryptWind` |
| `cavern` 잿빛 동굴 | rock 5 ✓ 0.8 1.2 floor · stalagmite 3 ✓ 0.5 2.0 room · lavaCrack 4 ✗ 1.2 0.05 floor · ashPile 3 ✗ 0.6 0.3 floor · crystal 2 ✗ 0.3 0.8 wall | lava `#ff5a1a` 1.8 r7 0.15 y0.3 · brazier `#ffa040` 1.5 r8 0.25 y1.4 | `cavernLava` |
| `town` 마을 | (data/town.js의 건물 · 장식) | bonfire `#ff9a40` 2.4 r12 0.3 y1.0 · torch | `townFire` |

**마을** — `TOWN`(24 × 24 타일 = 48m · 가장자리 1타일 벽 · 좌표 m)

| 물체 ID | 종류 · npc | 위치(x, z) | facing | r | look |
|---|---|---|---|---|---|
| `townPortal` | townPortal | (24, 16) | 0 | 1.2 | portal |
| `riftStone` | riftStone | (31, 22) | −π/2 | 1.2 | riftStone |
| `stash` | stash | (17, 22) | π/2 | 1.0 | stash |
| `blacksmith` | npc · blacksmith | (14, 31) | 3π/4 | 1.0 | npcSmith(건물 deco (8..16, 33..40)) |
| `general` | npc · general | (34, 31) | −3π/4 | 1.0 | npcGrocer(건물 (32..40, 33..40)) |
| `gambler` | npc · gambler | (14, 13) | π/4 | 1.0 | npcGambler(천막 (8..14, 8..13)) |
| `mystic` | npc · mystic | (34, 13) | −π/4 | 1.0 | npcMystic(탑 (35..40, 8..13)) |
| `bonfire` | deco(막음) | (24, 25) | 0 | 1.0 | bonfire |

`data/town.js`의 꼴(W0 스캐폴드 확정): `TOWN = {w:24, h:24, objects:[위 표 8행 — MapObject 꼴 · 모닥불은 kind 'deco' · block true], buildings:[{id, x0, x1, z0, z1, h, look}](smithy · grocery · tent · tower — 막는 상자), arrive, respawn, lights:[{kind, x, z}](kind = TILESETS town 의 lights.kinds)}` — `buildTownMap`은 buildings를 kind 'deco' · w/d/h MapObject로 objects에 더한다.
도착 `arrive` = (24, 20) facing π(−Z 쪽 · 포털을 본다) · 부활 `respawn` = (24, 18.5) — 포털 앞 1.5m · 빛: 모닥불 1 · 횃불 6(건물 앞).

### 7.13 화질 · 설정 · 키 · 봇 · 프리셋

```js
// data/quality.js (P7)
export const QUALITY = {
  low:    { pixelRatio: 1.0, shadows: false, maxLights: 3, particles: 0.4, outlines: true, wallFadeSmooth: false },
  medium: { pixelRatio: 1.5, shadows: false, maxLights: 5, particles: 0.7, outlines: true, wallFadeSmooth: true },
  high:   { pixelRatio: 2.0, shadows: true,  maxLights: 8, particles: 1.0, outlines: true, wallFadeSmooth: true },   // 그림자는 플레이어 빛 하나만
};
// data/settings.js (P9)
export const DEFAULT_SETTINGS = { volMaster: 0.8, volSfx: 0.9, volAmbient: 0.6, quality: 'medium', damageNumbers: true, alwaysLabels: false,
  hideNormal: false, advancedTooltips: false, meterHud: false, screenShake: true };
export const SETTINGS_SCHEMA = { /* 키 → {type:'number', min, max} | {type:'bool'} | {type:'enum', values} — 정화(clamp · 모르는 키 버림) */ };
// data/bot.js (P15) — §12.1
export const BOT = { reactSec: 0.30, reactSd: 0.08, dodgeNotice: 0.85, missClick: 0.04,   // 밸런스 게이트: 「보통 사람」(옛 0.22 · 0.06 · 0.9 · 0.02)
  missOffset: 1.0, potionAt: 0.40, kiteFrom: 4.0, kiteCount: 3,
  lootRadius: 12, lootSafeR: 10, upMaxSec: 360, downDeaths: 2, potionsTo: 10, scrollsTo: 5, viewR: 11.4, equipMinGain: 0.005,
  priority: { fallenShaman: 5, boneNest: 4, elite: 3, champion: 2, normal: 1 }, chaseGiveUpSec: 6, townSec: { blacksmith: 20, general: 8, riftStone: 4 } };
```

`data/presets.js` (P15) — `PRESETS[cls] = [A, B]` · `{id, nameKey, order: nodeId[29], bar: [nodeId × 5]}`(order는 레벨 2부터 한 점씩 · 단계 · req를 지키는 순서 — 데이터 검사가 배워지는지 확인):

| 프리셋 | order(레벨 2 → 30) | bar |
|---|---|---|
| warrior A 「분쇄 · 수호」 | groundStomp, warCry, groundStomp, weaponMastery, groundStomp, earthquake, leap, earthquake, weaponMastery, ironSkin, aftershock, groundStomp, earthquake, weaponMastery, quakeLanding, crusher, groundStomp, earthquake, crusher, earthquake, crusher, weaponMastery, leap, ironSkin, undying, leap, ironSkin, warCry, charge | groundStomp · earthquake · warCry · leap · charge |
| warrior B 「학살」 | charge, bloodthirst, charge, warCry, bloodthirst, whirlwind, whirlwind, whirlwind, bloodthirst, groundStomp, bloodWhirl, whirlwind, whirlwind, bloodthirst, charge, berserker, berserker, berserker, charge, charge, leap, ironSkin, ironSkin, undying, warCry, leap, weaponMastery, weaponMastery, undying | whirlwind · charge · warCry · groundStomp · leap |
| mage A 「화염」 | fireball, frostNova, fireball, combustion, fireball, meteor, teleport, meteor, combustion, fireball, splitFireball, meteor, combustion, fireball, energyShield, heartOfFire, heartOfFire, heartOfFire, meteor, meteor, combustion, combustion, frostNova, teleport, manaFlow, manaFlow, energyShield, coldCore, manaFlow | fireball · frostNova · meteor · teleport · energyShield |
| mage B 「냉기 · 번개」 | chainLightning, frostNova, chainLightning, coldCore, frostNova, teleport, energyShield, chainLightning, coldCore, frostNova, iceShards, lightningAfterimage, chainLightning, coldCore, frostNova, shatter, shatter, shatter, chainLightning, frostNova, coldCore, coldCore, manaFlow, manaFlow, teleport, energyShield, arcaneLore, arcaneLore, fireball | chainLightning · frostNova · teleport · energyShield · fireball |

`data/keybinds.js`(P9) — §11.5.

### 7.14 측정 목표 산수 (브리프 §7 · 설계 스크립트의 결과)

가정(봇이 실제로 재서 밸런스 게이트가 다시 맞춘다): 적정 레벨 한 판 = 일반 300 · 챔피언 12(팩 4 × 3) · 정예 2 · 하수인 8 · 수호자 1 처치. 맵에 놓인 게이지 ≈ 일반 팩 ~60 × 7마리 × 0.25% + 챔피언 4~6팩 × 3 × 1.0% + 정예 2~3 × (3.0 + 4 × 0.5)% ≈ 130% → 맵의 약 75%를 쓸면 100%. 균열 1 · 2는 일반 · 하수인 게이지 × `RIFT.earlyGaugeMul`(1.6 — W1 수정) → 일반 약 195처치(챔피언 · 정예 몫 ~22%를 뺀 78% ÷ (0.25% × 1.6) · 1.25였으면 ~250 · 실측 첫 판 처치 합 중앙 238 · 챔피언 · 하수인 · 수호자 단계 포함). 「적정 레벨」은 봇 basic이 고르는 레벨이고, 상승 규칙(직전 판 무사망 · 6분 안)이 적정 레벨을 「한 판이 6분 언저리가 되는 레벨」로 정한다(평형) — measure가 레벨별 「상승 조건 충족 비율」(목표 40~60%)을 같이 낸다.

| 목표(브리프) | 계산 | 결과 |
|---|---|---|
| 한 판 5~8분 · 분당 처치 40~80 | 일반 300 + 기타 ≈ 320처치 / 분당 ~58 ≈ 5.5분 + 수호자 ~45초 + 줍기 | **약 6.3분 · 분당 ~58** |
| 첫 판(균열 1 · 시작 장비 · 스킬 0점에서 시작) ≤ 9분(measure.test 3~9분) | W1 수정: 레벨 2 = 일반 ~12처치(첫 팩 · 실측 0.7분) → 액티브 1개(지면 강타 · 화염구) → 레벨 3 ≈ 72처치(실측 2.3분) → 레벨 4 ≈ 212처치(실측 4.6~5.3분) → 게이지 100% ≈ 처치 220(`earlyGaugeMul` 1.6 · 실측 6.3~6.7분) + 수호자(28 × 1.1배 · 실측 46~88초 · 중앙 68초 — 잿빛 마녀는 W1 스텁이라 공격하지 않는다) · 받는 피해는 `RIFT.earlyDmg`(균열 1 × 0.205 — W1 수정 2 · 3) | **실측 중앙 7.4분(전사) · 8.0분(마법사)** — `scriptedClear`(피하기 없음) 두 클래스 × 시드 1~8(NOTES-W1FIX · W1 수정 3 값) · 손잡이 `RIFT.earlyGaugeMul` · `XP.reqEarly` · `RANKS.guardian.hp` · `RIFT.earlyDmg[0]` |
| 일반 몬스터 기본 공격 2~4방 | 구울 생명 = 19 × 1.14^(L−1). 시작 전사(검 5 × 1.10 × 1.025 = 5.64) L1 **3.4방** · 시작 마법사(마법봉 4.5) **3.7방**. 적정 장비(ilvl L−1 · 옵션 2~4.8) L5 2.9 / L10 2.5 / L20 2.4 / L30 3.0(전사 · L > 20은 hpLate 1.12) · 마법사는 ×0.9. 종류 배율(소인 0.8 · 방패 1.2 · 짐승 1.3)을 곱해도 2~4(방패 해골 정면은 50% — 옆 · 뒤 · 범위 · 밀치기 뒤 후딜이면 그대로) · **피드백 1**: 가르기는 닿는 적마다 같은 계수 1.00(대상 하나 → 반원 안 모두) — 이 줄의 산수는 그대로 · 봇 실측 2.0방 | ✓ |
| 챔피언 팩 8~20초 · 정예 팩 15~35초 · 수호자 30~70초 | 기본 공격 DPS × 스킬 순환 1.7(단일) × 범위 효율 1.9(팩) · 속성 보정 +20~25%. 챔피언 팩(3 × 3.5배): L1 11.7 / L10 8.3 / L20 7.7초(전사) · 정예 팩(7배 + 하수인 4 × 2배): 23.7 / 16.7 / 15.5초 · 수호자(28 × 1.1배 — W1 수정 · 35 → 28): 51 / 36 / 34초(35였으면 64 / 45 / 42 · 균열 1은 강인함(생명 × 1.5)이 63%라 시작 장비 실측 50~95초 · **고레벨 실측은 계산보다 짧다**: 재검증(개발 캐릭터 · 무적) 전사 균열 5 / 10 / 15 = 51.6 / 24.3 / 23.2초 · 마법사 42.2 / 7.5 / 8.2초 — W1 설계 값이면 전사 68.8 / 39.8 / 43.8초. 하나씩 되돌리면 `guardian.hp` 35만 66.4 / 30.5 / 29.1 · 분노 6 · 지면 강타 20만 56.0 / 30.2 / 31.7 · 흡혈 0.01만 55.5 / 24.7 / 24.7 — 개발 장비만이 아니라 `guardian.hp` 28과 분노 8 / 지면 강타 14가 각각 약 절반씩 줄였다 · W2 봇으로 다시) · 마법사는 약 10% 빠르다 · 수호자 저항은 종류 0.15뿐(속성 저항 없음 — 화염 마법사 대 잿빛 마녀 ≈ ÷ 0.85) | 수호자 ✓ · 정예 ✓(경계) · 챔피언은 L10 이상에서 8초 경계 — 게이트가 `RANKS.champion.hp`를 3.5~4.0에서 본다 |
| 드랍(한 판 · MF 0) 장비 30~60 · 마법 10~25 · 희귀 3~8 · 전설 0.2~0.5 · 세트 0.05~0.15 | §7.8 표의 기대값(L5): 장비 42.5(수호자 전 36.9) · 일반 20.0 · 마법 16.9 · 희귀 5.24 · 전설 0.311(불운 보정 켬 ~0.41) · 세트 0.085. L1 → L30: 전설 0.28 → 0.47 · 희귀 5.0 → 6.5 | ✓ |
| 첫 전설 2~5판 | 몬테카를로 400캐릭터 × 20판(레벨 경로 1→7): 불운 보정 켬 첫 전설 판수 중앙 3 · 25% 2 · 75% 4 · 90% 6 / 끔 중앙 3 · 75% 5 · 90% 8. 전설 사이 장비 드랍 수 최대 = `BLP.hard` 400(끔: 687) | ✓ |
| 아이템 발견 수확 체감 | 일반 등급 L5의 희귀 이상 비율: MF 0 → 6.54% · 100% → 7.72% · 300% → 8.34% · 600% → 8.62% (증가분 1.18 → 0.62 → 0.28) | ✓ |
| 사망 수리비 = 한 판 골드의 10~20% | 한 판 골드 = 더미(기대 ~40개 × 3 × 등급 배율 → 168 × G^(L−1)) + 판매(전 등급 판매 224 × G^(L−1)) = **392 × G^(L−1)** ≈ L5 662 · L10 1275 · L20 4728. 수리(등급 무관 · §7.10): 사망 1회 = 143 × 4.0 × 0.1 × G^(ilvl−1) = 57.2 × G^(ilvl−1) → 장착 ilvl = L이면 14.6% · L−1이면 **12.8%** · L−2면 11.2% — 전설 · 세트를 모아도 같은 비율 | ✓ |
| 남는 골드 = 도박 1~3회 또는 재굴림 1~2회 | 수입 392 − 사망 0.6 × 수리 50 − 포션 구매 ~0.5개(드랍 ~3.1개가 소비 ~3개를 거의 메운다 — §7.8 포션 가중치) × 15 − 두루마리 0.5 × 10 ≈ **350 × G^(L−1)**(L5 591 · L10 1138) → 도박(평균 110 × G^(PL−1) · PL ≈ L + 2 → 143) **2.4회** · 재굴림 2번(90 + 135 = 225 × G^(ilvl−1)) **1.6세트** | ✓ |
| 도박 · 재굴림 기대 < 사냥 | 한 판 사냥 = 골드 392 × G^(L−1) + 장비 42(희귀 이상 5.6). 같은 골드로 도박 ≈ 2.7회 → 희귀 이상 0.77개(24% + 3% + 1% — 그 부위에 전설 · 세트가 없으면 희귀로 내려 희귀 이상 비율은 같다) | ✓ |
| 상점이 사냥을 앞지르지 않는다 | 상점 희귀 = 가치(15 × 6 × G^(ilvl−1)) × 2.5 = 225 × G^(PL−2)(ilvl = PL − 1) ≈ **256 × G^(L−1)** — 한 판 수입의 0.65 · 판당 보이는 희귀 9 × 15% = 1.35개(재고는 판마다 한 번 — 왕복 · 새로 고침으로 갱신되지 않는다). 골드당 희귀 이상: 상점 1/256 · 도박 0.28/143 = 1/511 — 상점은 「골라 사는 값」으로 비싸고, 사냥(판당 희귀 이상 5.6 + 골드)을 앞지르지 않는다 | ✓ |
| 재료가 쓰인다(공급 / 수요 0.8~1.3) | 공급: 드랍 판당 고철 3.3 · 가루 1.2 · 정수 0.24 + 전부 분해하면 고철 ~42 · 가루 ~28 · 정수 ~0.4(그만큼 판매 골드 224를 포기). 수요: 제작(고철 20 · 가루 10 · 골드 150 × G^(PL−1)) — 남는 골드로 ~2회 = 고철 40 · 가루 20 + 재굴림 가루 1~5 · 3회째부터 정수 1 → **≈ 1.0** · 「분해냐 판매냐」가 골드와 재료의 맞교환으로 남는다 | ✓ |
| 가방이 차서 도중 귀환 30~60% | 봇이 장비를 전부 줍는다 · 수호자 전 장비 수 ~ 36.9 ± 6 · 빈칸 38(가방 40 − 남겨 둔 2) → 몬테카를로 **38.5%**(가방 40 시절 — 피드백 2: 가방 30 · 빈칸 28 · 실측 40 / 53% — 이 절 끝) | ✓ |
| 경험치 — 레벨 10 = 30~50분 · 레벨 30 = 5~9시간 | 한 판 경험치 = (300 + 8 × 2 + 12 × 4 + 2 × 12 + 60) × 5 = 2240 + 완료 560 = 2800 × 1.12^(L−1) · 레벨 차 감점은 d > 12부터(정상 경로의 d = 9~11은 감점 0) · 레벨 1~3은 `XP.reqEarly`(W1 수정 [60, 300, 700] — 레벨 10까지 누적 −540 · 3%) · 한 판 7.2분(마을 포함) · 균열 경로(L5 = 6판 · L10 = 18판 · 그 뒤 3.3판/레벨)로: 레벨 10 = **5판 36분** · 레벨 20 = 19판 2.3시간 · 레벨 30 = **45판 5.4시간** | ✓ |
| 균열 L → L+1 몬스터 +8~15% · 보상 +8~15% · 비 0.8~1.25 | 「어려움」 = √(생명 × 피해): L1~L20 생명 +14% · 피해 +10% → **+11.98%/레벨** · L20 뒤 생명 +12% · 피해 +5% → +8.4%(캐릭터 캡 ≈ 균열 19 뒤 생명이 늘지 않는다 — L20→L30 처치 시간 × 1.20 · 받는 피해/생명 × 1.63, 늦추지 않으면 × 1.43 · × 2.59의 벽). 「보상(L)」 = √(E[업그레이드 드랍의 powerScore 증가 · 캐릭터 고정] × 골드/판): 무기 위력 +10% → powerScore +4.9%(√ — 맞춘 장비의 ehp는 레벨 불변) · 방어구 +1.5% · 골드 +14% → **+9.4%/레벨**. 두 증가율의 비(어려움/보상) **1.02~1.03**(L20 뒤 0.99) · measure가 같은 정의로 잰다(§12.5) · **W1 수정 2 · 3**: 균열 1~5는 `RIFT.earlyDmg` 경사(§7.3)로 레벨당 피해 × 1.634~1.637 · 어려움 +36.5%/레벨 · 비 1.2475~1.2485(≤ 1.25 · `monsters.test`) — 첫 판들만의 예외(레벨당 +8~15%는 벗어난다 · Jay가 정할 것) | ✓(비) · 균열 1~5의 레벨당 증가는 목표 밖 |
| 진행 속도 균열 5 = 30~60분 · 균열 10 = 1.5~3시간 | 봇의 상승은 힘(경험치 · 장비)이 균열 레벨당 +12%를 따라잡는 속도에 묶인다 — 초반(균열 1~5)은 캐릭터 레벨이 균열 레벨을 크게 앞서 판마다 +1 → 균열 5 ≈ 6판(43분) · 그 뒤 ~2.4판/레벨 → 균열 10 ≈ 15~18판(1.8~2.2시간) | 추정 — 봇 측정으로 확인 |
| 한 번 다녀오면 바뀐다 · 위협이 의미 있다 · 장비 · 스킬 · 클래스 균형 · 정예 속성 | 산수로 정할 수 없다 — 봇 측정(§12.6) | 측정 |

**W1 통합 게이트 실측(받는 피해 — 위 표가 다루지 않은 쪽 · 밸런스 게이트의 첫 과제)**: 실제 구현끼리 균열 1에 들어서면 2~3초 안에 시야 2팩 + 팩 연결(8m)로 40~50마리가 깬다(팩 62 · 몬스터 ~450 · 방마다 ~5팩이 6m 간격). 시작 전사(생명 120 · 시트 DPS 7.9)는 구울 6마리 한 팩만으로도 포션 없이는 버티지 못한다(받는 피해 ≈ (6+…+1) × 2.4초 × 구울 2.65/초 ≈ 134). 간이 스크립트(서서 싸움 · 포션 40% · 레벨업마다 프리셋)로 두 클래스 × 시드 4개 = 첫 판 전부 붕괴(36~97초 · 처치 3~24) · 15분에 레벨 4~5가 돼도 붕괴 반복. 손잡이 실험: 연결 0 · 시야 × 0.75 → 그래도 전부 붕괴 / 몬스터 피해 × 0.33 → 전부 붕괴 / × 0.2 → 8판 중 6판 완료(사망 0~3). 무적이면 같은 스크립트가 균열 1을 9~13분에 끝낸다(첫 판 목표 ≤ 9분 · 스킬 없이 기본 공격만이면 15분에 게이지 78~92%). 🔒 `MON.dmgBase` · 클래스 생명 · 맵 밀도(`MAPGEN.normalMin` · 팩 크기) · 연결 반경을 봇 측정으로 함께 맞춘다(NOTES-W1).

**W1 수정 실측(NOTES-W1FIX — 최종에 바뀐 🔒 값은 `TREASURE` 구슬 맞교환 · `RANKS.guardian.hp` 28 · `XP.reqEarly` 셋이다)**: 받는 피해의 총량이 회복(포션 5 · 구슬)을 크게 넘었고(실측 한 판 전사 ~10,000 · 마법사 ~6,500 — 생명 120/90), 그 절반이 몸 둘레 제한이 없는 궁수 화살이었다. 첫 수정은 🔒 `MON.dmgBase`(3.5 → 0.9)와 궁수 dmg(0.8 → 0.5)를 전역으로 낮췄는데, 검증이 균열 5 이상의 위협이 사라졌음을 실측으로 냈다(개발 캐릭터 · 해금 최고 + 3 붕괴 0/36 · 받는 피해 W1의 16~29%). **W1 수정 2**: `dmgBase` 3.5 · 궁수 0.8로 되돌리고, 첫 판 완화를 균열 레벨에 묶었다 — `RIFT.earlyDmg` [0.2, 0.3, 0.45, 0.67] → **W1 수정 3** [0.205, 0.305, 0.453, 0.673](§7.3 · 균열 5부터 × 1 · 레벨 비 ≤ 1.25). 남은 것: 🔒 `TREASURE` normal · minion의 globe ↔ none 맞교환(25 → 80 · 80 → 150 — 장비 · 골드 · 포션 · 재료의 뽑기당 확률은 그대로라 위 드랍 · 골드 · 경제 · 재료 행은 변하지 않는다) · 🔒 `RANKS.guardian.hp` 35 → **28**(위 수호자 행 · 35면 균열 1 수호자 ~90초에 사망이 몰린다) · 🔒 `XP.reqEarly`(위 경험치 행) · 궁수 · 주술사 뒷걸음 0.3 · 흡혈 재생 0.01 → 0.003 · 초반 경사(`MON.linkMinDepth` 2) · 깊은 방 파도(`MON.linkRadius` 11) · 첫 판(`earlyGaugeMul` 1.6 · 분노 8 · 지면 강타 14) · 사망 진정(§5.10). 결과(`scriptedClear` learn — 피하기 · 우선 대상 없음 · W1 수정 3 값): 균열 1 첫 판(시작 장비 · 두 클래스 × 시드 1~8) 완료 8/8 · 8/8 · 붕괴 0 · 사망 중앙 0 · 0(평균 0.75 · 0.50) · 판 길이 중앙 7.4 · 8.0분(최대 8.6) · 최저 생명 비율 중앙 0.388 · 0.394 · 25마리 이상 순간 중앙 4.5 · 3.5(시드 9~16도 완료 8/8 · 8/8 · 사망 중앙 0 · 0). 균열 5 이상(개발 캐릭터 (R, 레벨) = (5, 10) · (10, 18) · (15, 24) · 시드 1~6): 해금 최고 + 3 붕괴 7/36(W1 수정 2 6 · W1 수치 14 · 첫 수정 0 — W1 수정 3의 부활 규칙 몫 +1) · 적정 사망 평균 전사 0.67 · 0 · 0 · 받는 피해 W1의 67~117% — 남은 차이는 설계 수정(뒷걸음 · 흡혈 재생 · 분노 · 수호자 생명)의 몫이다(NOTES-W1FIX §3.3). 레벨 비(어려움 · 보상 0.8~1.25)는 균열 5~20은 그대로(1.02~1.03)이고 균열 1~5는 경사로 1.2475~1.2485다. 봇으로 다시 잴 것: 적정 레벨 사망 0.2~1.0 · 무회피 2배 · 해금 최고 + 3 붕괴 ≥ 50%(하네스로는 W1 수치로도 못 미친다 — 특히 마법사) · 시작 장비 균열 8 붕괴 ≥ 80%(하네스 8/8) · 속성 효과 ≥ 5% · 수호자 30~70초(재검증 무적 실측 전사 균열 10 · 15 = 24.3 · 23.2초 · 마법사 7.5 · 8.2초 — `guardian.hp` 28 · 분노 8 / 지면 강타 14가 각각 약 절반 · 개발 장비 몫과 섞여 있다).

**밸런스 게이트(NOTES-BALANCE) — 위 표의 산수 중 낡은 줄**: 이 문단 앞의 계산은 설계 · W1 값(🔒 `MON.dmgBase` 3.5 · `hpBase` 19 · `RANKS` 챔피언 3.5 · 정예 7 · 수호자 28 · `earlyGaugeMul` 1.6 · 수리 57.2 · `XP.req.a` 1100 · `BOT.reactSec` 0.22)로 했다. 게이트가 바꾼 값(§7.1 · 7.2 · 7.3 · 7.4 · 7.5 · 7.5b · 7.10 · 7.11 · 7.12 · 7.13 의 「밸런스 게이트」 표시)은 봇 실측(`npm run measure` → `docs/MEASURE.md` · 시드 1 · 9시간 세션)이 산수를 대신한다 — 한 판 6.0 / 5.2분(전사 / 마법사) · 첫 판 완료 사망 0 · 수리/수입 14 / 13% · 분당 처치 64 / 68 · 기본 공격 2.0방 · 챔피언 팩 11.9 / 8.8초 · 정예 팩 20.4 / 17.3초 · 수호자 50.6 / 38.7초 · 적정 사망/판 0.33 / 0.54 · 무회피 1.87 / 1.92배 · 해금 + 3 붕괴 88 / 60% · 레벨 곡선 비 1.19 / 1.20. 낡은 줄: 「첫 판」(일반 처치 수는 `earlyGaugeMul` [1.5, 1.35, 1.2, 1.1] 로 · 받는 피해는 `earlyDmg` · `earlyHp` 11칸으로 — §7.3) · 「챔피언 · 정예 · 수호자」(배율 8 · 15 · 32) · 「사망 수리비」(71.5 × G^(ilvl−1) → 장착 ilvl = L−1 이면 16.0% — 실측 13~14%) · 「경험치」(a 1300 → 레벨 10 = 18,368 · 30 = 486,866) · 「레벨 비」(균열 1~11 경사 · 성장을 더한 레벨당 어려움 +36.3% · 비 ≤ 1.2467 · 균열 12~20 1.02~1.03 그대로 — 실측 직선 맞춤 1.19 · 1.20). 「진행 속도」는 봇이 9시간 세션에서 잰 것이 정본이다(시드 1: 균열 5 29 / 24분 · 균열 10 1.83 / 1.77시간 · 레벨 30 6.52 / 4.99시간 — 시드마다 흔들린다 · 4시드는 NOTES-BALANCE §2).

**피드백 1(Jay 2026-10-12 · 게임플레이 담당) — 가르기 · 회전 베기 · 골드 더미 · 봇 규칙**: 바뀐 것 — `bash` 동작 meleeBasic → cleave(부채꼴 r 1.9 · 180° · 닿는 적 모두 · reach 1.1 → 1.2 · coef 1.00 🔒 그대로) · `groundStomp` cone(원뿔 r 4.0 · 120° · 1.05 / +0.11 · 기절) → spinSlash(원 r 2.5 · 360° · **1.20 / +0.09** · 넉백 0.8) · `aftershock` → 연속 회전(효과 `spinEcho` · `follow:'player'`) · `TREASURE` normal · minion 의 골드 무게 · goldMul(§7.8 — 기대 골드 그대로) · `BOT_RULES.spinSlash`(inner 0.5) · `spin.count` 3 → 2 · 회오리를 바에 둔 빌드는 회전 베기가 분노 30 을 남긴다 · 수호자 단계에서 미니맵의 수호자 점으로.
- **정타 처치 수(회전 베기 한 번 = 그 랭크의 판정 정의 그대로 · 넉백 빼고 같은 자리 · 60회 평균)** — 「적정 레벨」 = 봇 basic 4시드(601~604 · 4.5시간) 세션이 그 균열을 돌 때의 캐릭터 레벨(중앙). 구울 / 소인 / 궁수 / 방패 해골(정면 — 회전 베기는 aoe 라 정면 막기 없음):

| 균열 | 캐릭터 레벨 · 랭크 | 개발 장비(`makeDevCharacter` — 기준) | 봇 장비(그 판 시작의 봇 캐릭터) |
|---|---|---|---|
| 1 | 4.5 · 2 | 1.48 / 1.15 / 1.18 / 1.85 | 1.64 / 1.31 / 1.37 / 1.98 |
| 3 | 8 · 3 | 1.94 / 1.54 / 1.68 / 2.10 | 1.55 / 1.19 / 1.23 / 1.85 |
| 5 | 11.5 · 3 | 2.15 / 1.98 / 2.03 / 2.63 | 1.54 / 1.18 / 1.23 / 1.82 |
| 10 | 19 · 5 | 2.61 / 2.21 / 2.14 / 2.93 | 1.65 / 1.29 / 1.34 / 1.95 |
| 15 | 26 · 5 | 1.99 / 1.75 / 1.92 / 2.22 | 1.78 / 1.44 / 1.53 / 2.02 |
| 모두 | | 중앙 **1.99** · 평균 1.97 | 중앙 1.53 · 평균 1.54 |

  시작 장비 첫 판(새 캐릭터 검 · 갑옷 · 균열 1~3 · 레벨 2~8 · 랭크 1~3): 평균 **2.82**(2.15~3.97 · 같은 표에 옛 지면 강타 계수를 넣으면 3.06). 기준을 개발 장비로 둔 까닭: 봇 장비는 개발 장비의 약 2배 힘이고(봇 레벨이 판마다 +1 · 6분 규칙에 묶여 캐릭터 힘보다 늦게 오른다) 그 기준으로 2~3번이면 시작 장비 첫 판이 3.5~4번이 된다 — Jay가 처음 만지는 첫 판과 README 「바로 해 보기」 개발 캐릭터 둘 다 2~3번 안에 두는 값을 골랐다(`balance.test` 「피드백 1」이 데이터를 바꾸면 깨진다). 마법사 첫 광역(같은 표 · 2시드): 화염구 개발 1.72 · 봇 1.41 · 시작 2.9 / 서리 노바 개발 3.12 · 봇 2.44 · 시작 3.8 — 기준(개발 장비 1.5~3.5) 안이라 그대로.
- **가르기(기본 공격 · 개발 장비)**: 구울 1.9~3.6 · 소인 · 궁수 1.5~3.1 · 방패 해골 정면 3.6~7.9(정면 막기 50% — aoe 아님) · 등 뒤 2.0~4.3 / 봇 장비 구울 2.0~2.8. 봇 세션 「기본 공격 타수」 중앙 2.0(목표 2~4).
- **회귀(같은 하네스 · 옛 코드 = HEAD 사본 · 전사 시드 601~604 · 마법사 601 · 602 · 4.5시간 · 옛 → 새 · 아래 수치는 전사 4시드)**: 한 판 중앙 5.95~6.17 → 5.87~6.11분 · 분당 처치 58~64 → 59~68 · 사망/판 0.15~0.49 → 0.29~0.49 · 챔피언 팩 10.3~12.5 → 8.9~10.9초 · 정예 팩 17.4~18.6 → 16.2~21.0초 · 수호자 45.9~49.6 → 43.2~54.7초 · 전사 균열 10 해금 1.04~1.68 → 1.40~1.53시간(+0.12 성장이면 1.06~1.33 — 그래서 +0.09) · 처치당 골드(두 클래스 6세션 · ÷ 균열 골드 배율) 0.362 → 0.359 · 마법사(바뀐 것은 골드 · 봇 수호자 찾기뿐) 한 판 5.83~5.95 → 5.97~6.36분 · 사망/판 0.23~0.27 → 0.23~0.26. 첫 판(새 캐릭터 · basic 봇 · 시드 6 · 7 · 21~28): 전사 10/10 완료 · 사망 0 · 4.95~7.87분(옛 5.73~7.69) · 마법사 10/10 · 4.19~7.04분. 빌드 비교(레벨 12 · 균열 6 · 15판): 전사 A 6.77 / B 9.04분 → A 6.72 / B 8.53분(시드 1 · 2 평균) · 마법사 A 7.50 / B 8.64분. `npm run measure`(시드 1 · 9시간 · 새 코드): ✓ 26 · ✗ 11(옛 MEASURE.md ✓ 24 · ✗ 13) — 무회피 배수 2.27 / 2.26(✓ · 옛 1.87 / 1.92) · 경제 남는 골드 ✓ · 두 프리셋끼리 전사 26%(옛 26%) · 시작 장비 균열 8 붕괴 전사 50%(옛 75% — ✗ 넓어짐) · 균열 10 해금 1.72 / 2.06시간 · 클래스 차 11% · 20%.


---

**피드백 2(Jay 결정 2026-10-12 · NOTES-FEEDBACK 라운드 2) — 위 산수의 낡은 줄과 실측**: 바뀐 값 — 가방 40 → **30**(§6.1 · D4) · 입문 구간 균열 1~11 → **1~6**(§7.3 · D1) · 🔒 `MON.dmgBase` 24.5 → 22 · 🔒 `RANKS.normal.hp` 1 → 1.6 · `gauge` 0.25 → 0.27 · 🔒 `RANKS.guardian` hp 32 → 27 · dmg 2.0 → 1.4 · 궁수 dmg 0.45(§7.4) · 수호자 예고 × 3 → × 2(§7.5b · D3) · 일반 팩 밀도 ~× 1.35 · `PACK_PLACE.normalR` 5.2(§7.5c · D9) · 화염구 1.30/+0.155 · 메테오 2.40/+0.27(§7.2) · 요구 레벨 상한 30(§7.7 · D2) · 업그레이드로 세는 문턱 3%(§7.7 · D5). 낡은 줄: 「가방이 차서 도중 귀환」(빈칸 38 → **28**(30 − 남겨 둔 2) — 판당 장비 ~41 중 수호자 전 몫 ~35 가 빈칸을 넘는 판이 늘었다 · 실측 **40 / 53%** ✓ · 전 9 / 14%) · 「일반 몬스터 기본 공격」(일반 생명 × 1.6 · 실측 **3.0방** ✓) · 「첫 판」(받는 피해 · 생명 경사 6칸 · 게이지 `earlyGaugeMul` 6칸) · 「레벨 비」(입문 구간 1~6 은 예외 — 실측 맞춤은 균열 7~20) · 「업그레이드 판 비율」(문턱 0.5% → 3% — 같은 드랍에서 세는 수가 준다). **최종 `npm run measure`(시드 1 · 9시간 · 통합 단계에서 마지막 트리로 다시 돌림 — 밸런스 담당의 실행과 결과가 같다(결정성) · ✓ 26 · ✗ 11 · — 4)**: 한 판 5.7 / 5.0분(마법사 ✗ — 4.98 경계) · 첫 판 완료 사망 0 / 0 · 수리/수입 16 / 18% · 분당 처치 66 / 74 · 기본 공격 3.0방 · 챔피언 팩 10.9 / 11.7초 · 정예 팩 19.3 / 18.4초 · 수호자 48.2 / 36.5초 · 적정 사망/판 0.41 / 0.63 · 무회피 1.93 / 2.24배(전사 ✗) · 해금 + 3 붕괴 80 / 65% · 드랍 장비 41.0 / 40.9 · 전설 0.54 / 0.49(전사 ✗) · 업그레이드 판(3%) 균열 1~5 45 / 55% · 9~11 30 / 22% · 18~22 57 / 83%(모두 ✗ — 목표 범위가 0.5% 문턱 시절의 것 · Jay 가 정할 것) · 레벨 곡선 비(7~20) 1.01 / 1.03 · 균열 5 해금 28 / 23분(✗) · 균열 10 2.75 / 2.85시간 · 레벨 10 42 / 43분 · 레벨 30 6.02 / 5.73시간 · 도중 귀환 40 / 53% · 봇 장비 균열 8 붕괴 90 / 100%(✗ — §12.5 ⑤) · 균열 30 초과 판 업그레이드 33%(3판) / 50%(16판)(D2 — 전 0%).

**피드백 2 다듬기 — 바뀐 값과 최종 `npm run measure`(시드 1 · 9시간 · ✓ 28 · ✗ 9 · — 4 — 전 ✓ 26 · ✗ 11)**: 입문 경사 꼬리 `earlyDmg` · `earlyHp`(§7.3 — 6 → 7 걸음이 가장 작게) · 마법사 `regen` 10.5 고정(§7.1). 한 판 5.5 / 4.9분(마법사 ✗ — 전과 같다) · 첫 판 완료 사망 0 / 0 · 수리/수입 16 / 16% · 분당 처치 69 / 78 · 챔피언 팩 11.4 / 11.9초 · 정예 팩 26.4 / 22.3초 · 수호자 47.5 / 38.9초 · 적정 사망/판 0.48 / 0.53 · 무회피 3.05 / 1.83배(마법사 ✗ — 전 2.24 ✓ · 전사 ✓ — 전 1.93 ✗) · 해금 + 3 붕괴 83 / 57% · 전설 0.57 / 0.56(✗) · 첫 전설 2 / 4판(✓ — 전 6판 ✗) · 업그레이드 판(3%) 균열 1~5 58 / 64% · 9~11 43 / 43%(✓) · 18~22 50 / 83% · 레벨 곡선 비(7~20) 0.99 / 1.06 · 균열 5 해금 34 / 23분(마법사 ✗) · **균열 10 해금 2.20 / 2.58시간**(차 17%) · 레벨 10 41 / 39분 · 레벨 30 5.35 / 5.04시간 · 도중 귀환 45 / 47% · 봇 장비 균열 8 붕괴 100 / 55%(✗) · 스킬 트리 프리셋 vs 무작위 22 / −8% · 두 프리셋 20 / 3%(전사 ✗ 경계). 세션 기준(처음 보는 시드 10개 × 2 — §7.3)이 봇 세션 한 개(시드 1)보다 판단 근거다.

## §8 콘텐츠 프레임워크

원칙: **콘텐츠 = 데이터 행 + (새 동작이 필요할 때만) 훅 하나**. 프레임워크 파일(`monsters.js` · `packs.js` · `skills.js`의 실행부 · `combat.js` · `rollItem.js` · `computeStats`)에는 콘텐츠 ID가 없다(purity 테스트가 데이터의 모든 ID를 프레임워크 파일에서 찾아 0이어야 통과 — §12.3). 훅 레지스트리 `index.js`(P0)는 ID → 모듈을 잇기만 한다.

### 8.1 몬스터 종류 — 행 + `BEHAVIORS`

- 행(§7.4)이 수치 · 공격 · 예고 · 태그를 정한다. 행동은 `behavior` 키로 `BEHAVIORS`(P3 `behaviors.js`)의 항목을 고른다. 같은 behavior를 여러 종류가 쓴다(`melee`: 구울 · 뼈 새끼 · 잿빛 하수인).
- `BEHAVIORS[id] = {think(ctx, mon, def), strike?(ctx, mon, def, atk), onDamaged?(ctx, mon, def, hit), onDeath?(ctx, mon, def)}` — strike가 없으면 프레임워크 기본(근접 판정 · 투사체 발사).

| behavior | think 규칙(행동 가능할 때) |
|---|---|
| `melee` | chase. 중심 거리 ≤ r + reach + player.r(관용 없음 — 판정은 + `MON.reachTolerance` 0.3이라 예비 동안 0.3m 넘게 물러나면 피한다 · §7.4)이고 근접 공격이 준비됐으면 시작 |
| `fallen` | melee와 같다 + **도망**: 같은 팩의 fallen 중 `fleeAt`(50%) 이상이 죽었고 `pack.fled`가 아니면 팩의 fallen 전부 act `flee` `fleeSec` 동안 플레이어 반대쪽으로 `speed × fleeSpeedMul`(벽은 미끄러짐) → 끝나면 다시 chase. 팩당 한 번 |
| `shaman` | 플레이어와 `keepMin..keepMax`를 유지(kite — 가까우면 물러나고 멀면 다가감 · 시야가 막히면 다가감). `revive` 준비 · `window`초 안에 죽은 fallen 시체(되살린 적 없는 것)가 `range` 안이면 부활 채널(1.5초 · act `channel` · aim = 시체 위치) — **피해를 받으면 끊긴다**(쿨다운은 쓴 채) · 끝나면 시체 `max`(3)구를 생명 60%로 되살린다(`spawnMonster` rank `spawn` 아님 — 같은 종류 · rank normal · `flags {noXp, noDrops, noGauge, revived}` · `MON_SPAWNED{revive}` · 시체는 `gone` 표시 — §5.14). 아니면 `shamanFire`(시야 · 사거리) |
| `archer` | `keepMin..keepMax`(7~10m) 유지 · 플레이어가 `backoff`(4m) 안이면 `backoffMul` 속도로 뒷걸음(뒤가 막히면 그 자리에서 쏜다). `arrow`: 예비 0.6초 동안 aim이 플레이어를 따라가다 마지막 0.2초는 멈춘다(`aimLocked`) → 그 점으로 발사 — 옆으로 걸으면 피한다 |
| `shield` | melee와 같다 · 선회가 느리다(3 rad/s) → 옆 · 뒤가 열린다 · `shieldBash`는 플레이어를 1.2m 민다 · 정면 막기는 `combat.js`가 `params.frontBlock`으로(act idle · move · windup일 때만 — 밀치기 뒤 후딜 0.7초는 방패가 내려간 반격 창) |
| `charger` | 거리 5~11m · 시야 · `charge` 준비면 돌진 예비(0.9초 · 방향 고정 · 시작 틱에 효과 `chargeLine` 적대 · **spec null — 표시 전용(충돌은 이 행동이 판정한다)** · 선 길이 = 몸 중심이 가는 거리 min(maxLen 13, 거리 + 2)(벽 앞에서 자른다) + r(몸 앞 — 리뷰 수정: 판정의 끝과 같게 · 전에는 선 끝 바깥 r 까지 맞았다) · 폭 2r · `cancelOnSrcDeath`) → 판정 틱부터 act `charge`로 선을 따라 14 m/s(겹치면 한 번 `monsterHitPlayer{via:'charge', mul 2.0, push 2.0}`) · 벽에 막히면(이번 틱 이동이 계획의 50% 미만) `wallStun` 2초 기절 · 선 끝이면 후딜. 그 밖에는 `gore` |
| `bloater` | chase. `range`(2.2m) 안이면 `burst` 예비(act `swell` 1.0초) — 시작 틱에 효과 `bloaterBurst`(원 r 2.8 적대 · delay 1.0 · **실제 spec — P2 `updateEffects`가 판정** · `cancelOnSrcDeath`) → 판정 틱(strike): 자신의 생명 0 · `flags.noXp/noDrops/noGauge`만(피해는 효과가 준다 — 두 번 맞지 않는다 · §5.16-6). **onDeath**(어떤 이유든): 효과 `poisonPool`(r 1.6 · delay 0 · 3초 · 0.5초 틱 · spec null · tickSpec 초당 mul 0.3 · 위협 간격 · H5 예외 — 플레이어가 죽인 시점) |
| `nest` | 움직이지 않는다. 깨어 있고 살아 있는 자기 새끼 < `cap`(6)이고 `spawn` 준비면 예비 0.5초(맥동) → 판정: 둥지에서 1.0~1.5m에 `params.child`를 rank `spawn` · 깨어 있게 · 같은 팩으로(`MON_SPAWNED{nest}`) |
| `guardian` | `GUARDIAN_IMPLS[typeId].think` 위임(§8.3) · 고유 기술 판정은 `impl.strike` |

- 「상대는 살아 있어 보인다」(QUALITY §2): 닿지 않는 거리에서 공격을 시작하지 않는다(시작 조건이 거리) · 같은 자리에서 돌기만 하지 않는다(정지 거리 안이면 facing만 돌린다) · 원거리 종은 시야가 없으면 다가간다.

### 8.2 정예 속성 — 행 + `affixHooks/<id>.js`

- 프레임워크(`spawnMonster` — `spawn.js`)가 `mods`를 적용한다: `hpMax × hpMul` · `speed × speedMul` · 공격 속도 배율 · 저항 더하기(합은 `MON.resCap` 이하 · 수호자는 저항을 받지 않는다) · 면역 목록. 그 뒤 `ctx.hooks.onMonSpawn` → `hook.onSpawn`(spawn.js는 레지스트리를 모른다 — §2.2).
- 훅 호출 지점: `onAwakeTick`(§5.17-7 — hazard 속성은 팩의 대표에게만) · `onDamaged`(`onMonDamaged`에서 · dmg > 0) · `onHitPlayer`(`monsterHitPlayer`가 이 몬스터의 근접 · 투사체 · 돌진으로 dmg > 0을 준 뒤 — `ctx.hooks.onMonHitPlayer` · `spec.noAffix`면 안 돈다) · `onDeath`(`onMonDeath`에서). 훅의 상태는 `mon.ax[affixId]`(순수 객체 · 절대 틱은 `At` · `Until` 이름으로만 — `shiftTicks` §5.11). 속성 훅이 만든 피해(번개 불꽃 · 화염 추가 · 냉기 노바 · 화염 사망)는 `noAffix: true`.
- **챔피언 팩의 주기 행동**: `hazard: true` 속성의 `onAwakeTick`은 팩의 대표에게만 불린다(팩이 위협을 겹쳐 쏘지 않는다 — 정예 하수인의 노바 제외와 같은 규칙). hazard가 아닌 주기 속성(보호막)은 구성원 i(`memberIds` 순서 · 0부터 · n = 깰 때의 팩 크기)의 첫 사용 = `first + i × every / n` — 늘 팩의 일부만 무적이라 「다른 대상 공격」이 대응으로 남는다.
- 바닥 위협(`hazard: true`)을 만드는 훅은 `canStartHazard` → `spawnEffect` → `noteHazard` 순서를 지킨다(§5.9). 예고 · 연출 신호는 `AFFIX` 이벤트.
- 굴림(`rollAffixes`): `minLevel ≤ L` · 몬스터 태그가 `excludeTags`와 겹치지 않음 · 이미 고른 것과 `excludeAffixes`가 겹치지 않음 · 가중치로 중복 없이 count개.

| 속성 | 훅 동작(수치는 §7.5) |
|---|---|
| `fast` | mods만(훅 비어 있음) — 바람 줄 오라는 view가 `mon.affixes`로 |
| `tough` | mods만 — 금속광 · 몸 1.1배는 view |
| `fireEnchanted` | `onHitPlayer`: 같은 공격 피해의 30%를 화염으로 `hazardHitPlayer`(`noAffix`) 한 번 더 · `onDeath`: 효과 `fireDeath`(원 r 3.0 · 예고 `delay` 1.0초 · mul 1.2 · 화염 · 출처 사망 후에도 남는다) · `AFFIX fireArm` |
| `coldEnchanted` | `onHitPlayer`: `slowPlayer(0.4, 1.5)` · `onAwakeTick`(팩의 대표만 — 하수인은 대표가 되지 않는다): 깬 뒤 3초 · 이후 8초마다 효과 `coldNova`(자기 중심 r 4.0 · 예고 `delay` 1.3 · mul 0.8 · 적중 시 감속 2초 · `noAffix`) · `AFFIX novaWarn` |
| `vampiric` | `onHitPlayer`: `healMonster(res.dmg × 0.5)` · `onAwakeTick`: 초당 최대 생명 1% 회복 · `AFFIX heal`(1초에 한 번까지) |
| `shielding` | `onAwakeTick`: 깬 뒤 4초(챔피언 팩은 구성원마다 엇갈려 `first + i × every / n`) · 이후 9초마다 `AFFIX shieldWarn`(0.5초 금빛 반짝임 — 이 동안 `mon.ax.shielding.warnUntil`) → `setInvuln(3.0)` · `AFFIX shieldOn/Off` |
| `lightningEnchanted` | `onDamaged`: `rng.ai.chance(0.25)`이고 내부 쿨 0.5초 지났으면 불꽃 3발(투사체 `spark` · 120° 간격 + 무작위 회전 · 6 m/s · r 0.35 · 2초 · 벽에 튕김 · 적대 · mul 0.5 번개 · `noAffix`) · `AFFIX sparks` |
| `teleporter` | `onAwakeTick`: 플레이어가 8m 넘게 떨어졌거나(그리고) `onDamaged`로 표시됐으면, 쿨 4초가 지났을 때 act `vanish`(`actStart` · `actEnd` = +0.4초 · 무적 · `AFFIX teleportOut`) → `tick ≥ actEnd`인 첫 `onAwakeTick`에서 플레이어에서 2.5~4m · 시야 · 걷기 가능한 점으로 이동(`AFFIX teleportIn` · 보간 끊기 · act는 프레임워크가 `idle`로 — §5.17-2) |
| `jailer` | `onAwakeTick`: 깬 뒤 2초 · 이후 7초마다 · 11m 안 · `canStartHazard({jail:true})`면 효과 `jail`(플레이어 자리 r 1.2 · 예고 0.8) · 판정 때 플레이어가 안이면 `rootPlayer(1.5)` + `rootLockUntil` · `AFFIX jailWarn` |
| `splitter` | `onDeath`(rank가 split이 아닐 때): 시체 자리에서 1.5m 안 걷기 가능 점 3곳에 같은 종류 rank `split`(속성 없음 · 깨어 있게 · 같은 팩) · `MON_SPAWNED{split}` · `AFFIX split` |
| `plague` | `onAwakeTick`: 깬 뒤 2초 · 이후 6초마다 · 11m 안 · 위협 간격 통과면 효과 `plague`(플레이어 자리 r 2.0 · 예고 1.0 → 웅덩이 5초 · 0.5초 틱 · 초당 mul 0.25 — spec null · tickSpec) · `AFFIX plagueWarn` |
| `mortar` | `onAwakeTick`: 플레이어가 6m 넘게 · 11m 안이면 깬 뒤 1.5초 · 이후 5초마다 포탄 3발(플레이어 자리 + 0 · ±2m 무작위 두 발 · 각 효과 `mortar` r 1.5 · 예고 1.2 · `from` = 몬스터 자리 · mul 0.9) · 위협 간격은 세 발을 한 묶음으로 본다(H1 한 번 · H4는 `count: 3`) · `AFFIX mortarFire` |

- 같은 정예의 감옥 + 역병 + 몰타르: H1(팩 1.2초 간격)이 셋을 갈라 놓고 · H2가 속박 중 · 직후 0.8초에 새 표식을 막고 · H3가 다른 표식이 진행 중일 때 감옥을 막는다 → 「묶인 채 맞는」 연쇄가 없다.
- **W2 확정(P16)**: H3는 예고만 보므로, 감옥은 끝나지 않은 적대 지속 효과(역병 · 독 웅덩이 — 예고 중 포함)가 감옥 원(r + 플레이어 몸)과 겹치면 시작하지 않는다(`jailer.js` 안 — 없으면 웅덩이 위에서 묶인 채 틱을 맞았다). 감옥 · 역병 · 몰타르 · 잿불 비는 11m 안 **그리고 벽 시야**일 때만 시작하고, 순간이동으로 사라진 동안에는 바닥 위협을 시작하지 않는다. 번개 강화는 쓰러뜨린 적중(생명 ≤ 0 · 아직 dead 아님)에도 불꽃을 낸다. 수호자는 분열하지 않는다.

### 8.3 수호자 — 행 + `guardians/<id>.js`

- `spawnGuardian(ctx, x, z)`(P3 `monsters.js`): `GUARDIANS[rift.guardianType]` 행으로 `spawnMonster(rank 'guardian' · 속성 `riftRow.guardianAffixes`개 · 깨어 있게 · 팩 하나 · reason 'guardian')` → `impl.init`.
- 고유 기술은 행의 `attacks` 중 kind `cast` 둘. `impl.think`가 고른다: 바닥 표식을 만드는 기술(대지 분쇄 · 뼈 가시 · 잿불 비)은 `canStartHazard`(H1~H4 · `count`) → `startAttack` → **그 틱에** `spawnEffect`(delay = 예비 길이 · 실제 spec · `cancelOnSrcDeath`는 몸에 붙은 대지 분쇄 · 뼈 가시만) → `noteHazard` — 막히면 그 기술을 시작하지 않는다(다음 틱에 다시). `impl.strike`(판정 틱)는 소환 · 투사체만 만든다 — 효과를 다시 만들지 않는다(예비 1.2 + 예고 1.2 = 2.4초가 되지 않게 · 판정 주체는 효과 하나). 기본 공격(melee · projectile)은 프레임워크 기본 strike.
- 수호자는 속성의 `mods.res`를 받지 않는다(효과 훅 · 나머지 mods만) — 클래스 · 빌드가 수호자 종류(1:1 무작위)에 막히지 않게.

| 수호자 | 기술 | 규칙 |
|---|---|---|
| `boneGiant` 뼈 거인 | `slam` 대지 분쇄 | 6m 안 · 쿨 7초 · 효과 `slam`(원뿔 r 6.5 · 100° · 예고 1.2 · `cancelOnSrcDeath`) · 흔들림 0.5 |
| | `spikes` 뼈 가시 | 11m 안 · 쿨 10초 · 효과 `boneSpikes` 5개(선 len 12 · 폭 1.4 · 플레이어 방향 기준 −50 · −25 · 0 · +25 · +50° · 예고 1.4 · `cancelOnSrcDeath` · H4 `count: 5`) — 선 사이로 피한다 |
| `ashWitch` 잿빛 마녀 | `emberRain` 잿불 비 | 11m 안 · 쿨 8초 · 효과 `emberRain` 5개(§7.5b 배치 · 예고 1.2 · H4 `count: 5`) |
| | `summon` 재의 하수인 | 쿨 14초 · 살아 있는 하수인 < 8이면 4마리(마녀 주변 2m · rank spawn · 깨어 있게) |
| | (이동) | 7~10m 유지 · 플레이어가 3m 안에 1.5초 있으면 6m 떨어진 걷기 가능 점으로 순간이동(쿨 6 · `MON_ACT{actId:'blink'}` + 연출용 `AFFIX teleportOut/In` · `affixId: null` — W2 확정) · **W2 확정**: 「유지」 = 10m 밖이거나 시야가 없으면 다가오고 그 안에서는 제자리(뒷걸음질하지 않는다 — 거리는 순간이동이 벌린다) · 시전은 피해로 끊기지 않는다(기절 · 빙결의 공격 취소만 · `impl.onDamaged` 없음) · 소환은 플레이어가 `MON.threatRange` 안일 때만 |

### 8.4 스킬 — 노드 행 + `SKILL_BEHAVIORS`

- 노드(§7.2)가 수치를 · `skill.behavior`가 동작을 정한다. 실행부(`controller` · `actions`)는 노드 ID를 모른다: 비용 · 쿨 · 행동 길이 · 판정 틱 · 대상 고르기를 행으로 처리하고, 판정 틱에 `SKILL_BEHAVIORS[behavior].hit(ctx, node, rank, cast)`를 부른다.
- `cast = {nodeId, rank, actionId, x, z, facing, tx, tz, targetId, params}` — `params = skillParams(ctx, nodeId)`: **행의 `skill.params`에 찍은 변형 노드의 `patch`와 낀 전설의 `patch`(그 스킬 대상)를 차례로 덮어쓴 값**. 동작은 params의 키가 있으면 그 기능을 켠다 — 「여진」은 `params.aftershock`가 있으면 · 「꿰뚫는 화염」은 `params.pierce > 0`이면(그래서 기본 행의 params에는 패치 키가 없다 — §7.2). 적중이 싣는 상태 이상은 `skill.status`(배열이면 [rank − 1])에서 읽는다 — params가 아니다. 여러 틱에 걸친 값은 `player.sk`(§5.4).

| 동작 | 읽는 params 키(기본값) | 패치하는 것 |
|---|---|---|
| `cleave`(피드백 1) | `swing`(연출) | — |
| `spinSlash`(피드백 1 — 옛 `cone`) | `shake(0)` · `swing`(연출) · `fxAftershock` · `fxShockwave` · `aftershock(null)` · `shockwave(null)` | 연속 회전 `{aftershock:{delay:0.5, mul:0.6}}` · 진동 주먹 `{shockwave:{len:10, width:2.0, coef:1.0}}` |
| `quake` | `waves` · `shake` | — |
| `dash` | `speed` · `refund(null)` | 분노의 뿔 `{refund:{ragePerHit:5, resetAt:3, resetTo:1.0}}` |
| `spin` | `moveMul` · `endRecover` · `healPerTarget(0)` · `healTargetsCap(0)` · `vortex(null)` | 피의 회오리 `{healPerTarget:0.006, healTargetsCap:3}`(최대 생명 비율 · 채널 틱당) · 불타는 소용돌이 `{vortex:{everySec:0.6, r:2.0, dur:2.0, tick:0.5, coefPerSec:0.35}}` |
| `buff` | `buffSec` · `value` · `castHeal(0)` | 선조의 허리띠 `{castHeal:0.25}` |
| `leap` | `invuln` · `shake` · `landStun(0)` · `landQuake(null)` | 진동 착지 `{landStun:1.2}` · 진동 장화 `{landQuake:{mul:0.6}}` |
| `fireball` | `speed` · `range` · `r` · `explodeR` · `split(null)` · `pierce(0)` | 분열 화염구 `{split:{n:3, spreadDeg:15, mul:0.7}}` · 꿰뚫는 화염 `{pierce:3}` |
| `meteor` | `delay` · `burn` · `shake` · `shower(null)` — 피드백 2 D8: 목표 · 작은 메테오 점은 `sightClip`(§5.4 · `COMBAT.sightBack`)로 자른다(동작 안의 규칙 · 패치 키 아님) | 잿빛 왕관 `{shower:{n:2, r:2.0, mul:0.5, delay:0.3}}` |
| `nova` | `shards(null)` | 얼음 파편 `{shards:{n:8, speed:16, range:9, r:0.25, mul:0.45, chill:20}}` |
| `shield` | `absorbPct` · `dur` | — |
| `chain` | `bounces` · `bounceR` · `decay` · `pickR` · `bouncesAdd(0)` | 폭풍의 구체 `{bouncesAdd:2}` |
| `blink` | `range` · `blast(null)` · `arrivalNova(false)` | 번개 잔상 `{blast:{r:3.0, coef:[1.4, 1.5, 1.6, 1.7, 1.8], type:'lightning', shockChance:0.5}}` · 서리 걸음 `{arrivalNova:true}` |

- 스킬 하나 더하기 = 노드 행(+ 새 동작이면 `SKILL_BEHAVIORS` 항목 하나 · + 문자열 키). 트리 규칙 · 바 · 비용 · 쿨은 손대지 않는다.

### 8.5 전설 · 세트 — 행 + 패치 · `EQUIP_HOOKS`

- 전설 행(§7.9)은 둘 중 하나다: **패치형**(`skill` + `patch` — 스킬 동작의 params를 바꾼다 · §8.4) 또는 **사건형**(`at: 'kill'|'globe'` + `params` — `EQUIP_HOOKS[hook]`가 그 사건에서 돈다). 이 프로토타입의 사건형은 셋: `frozenShatter`(at kill — `lastHit.frozen`이면 얼음 폭발 r 2.5 · coef 0.8 · noProcs) · `killExplode`(at kill — 10% · r 3.0 · flat = 대상 hpMax × 0.2 · noProcs · 효과 `corpseBlast`) · `globeDouble`(at globe — 회복 × 2 · 줍기 반경 +1.0m).
- `computeStats`가 내구도 > 0인 전설만 `stats.hooks`에 넣는다(전설 ID 목록). `skillParams`는 그 목록의 패치형 중 `skill === nodeId`인 것을 합친다. `onPlayerKill` · `globeMods`는 사건형을 돈다.
- 세트 효과는 스탯 묶음(bonus2 · bonus4)뿐 — `computeStats`가 조각 수로 더한다. 훅 없음.
- 따라서 `LegendaryDef`(§3.3)는 `{id, baseId, cls, hook, skill?, patch?, at?, params, affixes, weight}`.

### 8.6 아이템 기본형 · 옵션

- 기본형 하나 더하기 = `BASES` 행 + 문자열 3(단계 이름) + view의 `look` 메시(없으면 같은 부위 기본 메시로 — §9.6).
- 옵션 하나 더하기 = `ITEM_AFFIXES` 행 + 문자열 2(이름 · 접두/접미어) — `stat`이 §3.3 StatKey에 있는 것이면 코드 변경 없음. 새 StatKey면 `computeStats`(P5)에 한 줄.
- 등급 · 드랍 묶음 · 불운 보정은 표만 바꾼다.

### 8.7 맵 생성 · 타일셋

- `generateRift(seed, level)`(P4): (1) 격자 96 × 96 타일에서 시작 방(8~9타일)을 가운데에 → (2) 나무 키우기: 지금 방 중 하나(최근 60% · 나머지 40% 균등)를 고르고 네 방향 중 하나로 통로(길이 3~8 · 폭 2~3타일) 끝에 방(8~13 · 25%는 13~16타일)을 붙인다 — 다른 방 · 통로와 `margin` 2타일 겹치면 다시(시도 40) → 방 수 = `rng.int(10, 14)` → (3) 고리: 같은 x 또는 z 범위가 겹치고 6~14타일 떨어진 방 쌍에서 0~2개 통로 → (4) 타일: 바닥 · 벽(바닥에 8방향으로 닿는 비바닥) → (5) 소품: 방마다 2~6(자리 규칙 `where` · 막는 소품은 통로 입구 2타일 안 금지 · 큰 방(≥ 11)에 기둥) · 막는 소품은 내비에 반영 → (6) 빛 → (7) 팩 자리(§7.12) → (8) 내비 칸 = 바닥 타일의 4 × 4 중 막는 소품 원과 겹치지 않는 칸 → (9) 검사: spawn에서 BFS로 모든 바닥 칸에 닿는다(닿지 않는 칸은 막힘으로 바꾼다 — 고립된 소품 틈).
- 타일셋 하나 더하기 = `TILESETS` 행 + `TILESET_PACKS` 행 + view 테마(§9.4) + 환경음 ID(§9.11).

### 8.8 로드맵이 열려 있게 둔 자리 (v0.1에서 구현하지 않는다)

- 균열 변형 옵션: `riftRow`에 배율을 곱하는 자리(`openRift(level, seed, mods?)`)를 만들지 않는다 — 다만 `RiftState`에 `mods: null` 필드를 둔다(저장 · 표시 없음).
- 파라곤: 캡 뒤 경험치는 버리되 `char.xpTotal`은 센다.
- 소켓 · 보석 · 룬워드: `Item`에 필드를 두지 않는다(세이브 이주로 더한다 — `SAVE_VERSION`).

---

## §9 view 계약 (P7 · P8 · P13)

### 9.1 공통

- 레이어는 매 프레임 `update(state, alpha, dtReal, cameraTarget)`에서 **상태를 읽어 그린다** — 이벤트는 순간 연출(불꽃 · 숫자 · 흔들림)에만. 이벤트를 놓쳐도 다음 프레임에 맞는다.
- 위치는 `lerp(prevPos, pos, alpha)`. 엔티티가 처음 보이는 프레임과 보간을 끊는 경우(§5.12)는 pos 그대로.
- 방향(facing)도 같은 `alpha`로 그린다 — sim에 직전 값이 없어 view가 엔티티마다 마지막 두 틱의 facing을 기억해 최단 호로 보간한다(`view/actors/poses.js` `trackFacing` · 몸에 붙는 fx도 같은 함수). 위치 보간을 끊는 경우 · 새 기록은 끊는다(리뷰 수정 — 틱 값 그대로면 돌아설 때 30Hz로 최대 34°씩 끊겼다).
- 시각 진행은 **틱으로 정한다**: 포즈 · 예고 채움 · 버프 고리는 `(state.tick + alpha − start) / (end − start)`. 실제 시간(`dtReal`)은 순수 장식(불꽃 흔들림 · 입자)에만 — 정지 화면(`__game.step`)에서도 같은 틱이면 같은 그림.
- 컬링: `cameraTarget`에서 32m 밖의 몬스터 · 드랍 · 효과는 그리지 않는다(인스턴스에서 뺀다).
- 레이어는 sim 상태를 고치지 않는다. 만든 지오메트리 · 재질 · 텍스처는 `setMap`(맵이 바뀔 때) · `dispose`에서 해제한다(QUALITY §6 — `rc.stats()`로 잰다).
- `update` 순서(app): `world` → `actors` → `fx` → `camera` → `rc.render()` → ui.

### 9.2 렌더러 · 화질 — `renderer.js` (P7)

- `WebGLRenderer({antialias: quality !== 'low'})` · `outputColorSpace = SRGB` · `toneMapping = ACESFilmic` · 픽셀 비율 = `min(devicePixelRatio, QUALITY[q].pixelRatio)`(상한 2).
- 안개: `FogExp2` — crypt `#0b0a0d` 0.035 · cavern `#120806` 0.03 · town `#1a1420` 0.015. 배경 = 안개 색.
- 기본 빛: 반구광(하늘/바닥 · 약하게 0.25) + 플레이어 머리 위 점광원(따뜻한 흰 `#ffe6c0` · 세기 2.2 · 반경 11m — 「플레이어 주변 빛 반경」) + 맵 빛 중 카메라 대상에서 가까운 `maxLights − 1`개(§9.4 — W1 확정: 「§9.5」는 오기).
- W1 확정(P7): 위의 안개 밀도는 × `FOG_K` 0.5(`view/world/style.js`)로 쓰고 줌하면 밀도 ∝ 24/거리(플레이어 자리 안개 양 일정 — 계약 값 그대로면 기본 거리에서 플레이어 자리가 이미 58% 안개). 빛 세기(여기와 §7.12)는 상대값 — 점광원 × `LIGHT_SCALE` 24 · decay 1 · 반구광 × `HEMI_SCALE` 12.
- `resize(w, h)`: 카메라 종횡비 · 렌더 크기. 1280×720 · 1920×1080에서 확인.

### 9.3 카메라 — `CameraRig.js` (P7)

| 값 | 규약 |
|---|---|
| 방위 · 앙각 | `CAM_AZIMUTH = π/4` 고정 · `CAM_ELEVATION = 55°`(§0.2) · fov 40° |
| 거리 | 기본 24m · 휠 한 칸 2m · 16 ~ 32m(두 배 범위 — 브리프 §5) · 줌은 0.2초 감쇠. 기본 거리에서 플레이어 기준 화면 위 · 아래 각 11.4m · 옆 15.5m가 보인다(16:9) — 위협 시작 거리 상한 `MON.threatRange` 11m · 봇 `BOT.viewR` 11.4m와 묶인 값(바꾸면 셋을 같이) |
| 따라가기 | 대상 = 플레이어 보간 위치(y 1.0) + 카메라 쪽으로 `0.12 × 거리`(기본 2.9m × (1, 0, 1)/√2 — 플레이어가 화면 세로 가운데에 와서 아래쪽(카메라 쪽)도 위쪽만큼 보인다) · 임계 감쇠 스프링 ω = 8/s(한 프레임 순간이동 없음) · `PLAYER_SPAWNED` · `snap()`만 바로 |
| 흔들림 | `SHAKE{amp, sec}` → 진폭 `amp × 0.25m` 상한 0.25m · 18Hz · 선형 감쇠 · 여럿이면 큰 쪽 · 설정 `screenShake` 끄면 0 |
| 벽 뚫기 | 카메라는 높이 있어 벽을 뚫지 않는다 — 가리는 벽은 WorldLayer가 낮춘다(§9.4) |

### 9.4 월드 — `WorldLayer.js` (P7)

- **바닥**: 바닥 타일을 타일셋 재질로 병합 지오메트리 하나(타일마다 색 잡음 ±6% · crypt 돌판 줄눈 · cavern 거친 바위 + `lavaCrack` 소품 자리의 주황 발광 줄).
- **벽**: 벽 타일마다 인스턴스(`InstancedMesh` — 타일셋 2종 모양: crypt 다듬은 돌 블록 + 위 장식 띠 · cavern 꼭짓점을 흔든 바위) · 높이 `WALL_H = 3.0m`. 
- **가리는 벽 낮추기**(브리프 §5): 플레이어에서 14m 안의 벽 인스턴스 중 `(벽 − 플레이어) · (sin az, cos az) > 0.5`(카메라 쪽)이고 화면 가로 거리 `|(벽 − 플레이어) · (1, 0, −1)/√2| < 5m`인 것은 높이 0.6m로 0.15초에 걸쳐 낮춘다(인스턴스 행렬 y 배율) · 돌아오는 것도 0.15초. 판정(sim)은 바뀌지 않는다.
- **소품**: kind별 메시(§7.12) · 막는 소품의 보이는 반지름 = 데이터 `r`(±0.1).
- **빛**: 맵 `lights`를 카메라 대상까지 거리로 정렬해 가까운 것만 실제 PointLight 풀(`maxLights − 1`)에 배정 · 깜빡임 = `flicker` × 잡음(실제 시간). 먼 빛은 발광 메시(촛불 · 용암 · 화로)만.
- **포털**: 마을 `townPortal`(돌 아치 · `town.portalOpen`이면 안쪽 발광) · 균열 `rift.portals`(빛 고리 — 소용돌이 입자는 P13). **균열석**(어두운 오벨리스크 · 보랏빛 균열 발광 · `char.runs === 0`인 동안 발밑에 비적대 흰 고리 — 첫 마을에서 어디로 가는지) · **보관함**(쇠 장식 상자) · 마을 건물(상자 + 지붕 + 문 · 대장장이 모루 · 잡화상 좌판 · 도박꾼 천막 · 신비술사 탑) · 모닥불.
- 탐색하지 않은 곳: 그리기는 하되 빛이 없어 어둡다(미니맵이 탐색을 보인다).
- **화면 패스 확정**: 용암 빛(`EMIT.lava` — `view/world/style.js`)은 바닥 후광을 작고 옅은 주황으로(지름 2.4 · 세기 0.3) · 실제 점광원은 높이 1.4m · 주황(`lightY` · `lightColor`) — 바닥 0.3m 의 붉은 빛이 적대 표식(붉은 원)과 같은 「붉은 원반」을 만들었다(NOTES-W1 7-4). 데이터(`tilesets.js`)의 값은 그대로다.

### 9.5 캐릭터 · 몬스터 — `ActorLayer.js` (P8)

**플레이어 리그**(코드로 만든 로우폴리 · +Z가 앞 · 키 1.8m): 골반 → 몸통 → 머리 / 위팔 · 아래팔 · 손 ×2 / 넓적다리 · 정강이 · 발 ×2. 무기는 오른손(`hand_R`)에, 방패 · 마법구는 왼손에 붙는다(손을 떠나지 않는다).

| 장비 외형(`EQUIPPED` · `weaponVisual`) | 규약 |
|---|---|
| 무기 | look별 모양 · 길이: sword 1.0 · axe 0.85 · mace 0.85 · greatsword 1.5 · greataxe 1.4 · wand 0.45 · staff 1.7(m) · 단계 2는 장식(가드 · 보석) · 전설은 주황 발광 띠 |
| 방어구 | 갑옷 · 투구 · 장갑 · 장화 단계별 색과 실루엣: 0 천/가죽(갈색) · 1 사슬(회색 + 어깨 보호대) · 2 판금(밝은 금속 + 투구 볏) · 세트는 녹색 띠 · 부위가 비면 그 부위 기본 옷 |
| 클래스 | 전사: 어깨 넓게(0.52m) · 마법사: 긴 옷자락 · 두건 |

| act | 포즈(시간은 §9.1의 틱 진행) |
|---|---|
| idle | 숨쉬기(실제 시간 OK) |
| move | 걷기 주기 = **이동한 거리 / 보폭**(보폭 1.4m at 6 m/s · 속도에 비례) — 발이 미끄러지지 않는다 |
| attack | `[actStart, actHit)` 예비(무기를 뒤로) → **`actHit`에 무기가 대상 쪽 끝에 닿는 자세** → 후딜에서 돌아옴. 양손 무기는 위에서 내려치기 · 한손은 대각 베기 · 마법봉은 찌르기. **피드백 1 — 횡베기(가르기 `cleave` · 회전 베기 `spinSlash`)**: `getSkillDef(p.actSkill)`의 `behavior`가 둘 중 하나면 무기 종류와 무관하게 수평으로 벤다 — 행의 `params.swing {from, to, arcFrom, arcTo}`로: 진행 k = (tick + alpha − actStart) / (actEnd − actStart) · u = clamp((k − from) / (to − from), 0, 1) · 칼끝 방위 = `p.facing` + deg2rad(arcFrom + (arcTo − arcFrom) × ease(u))(§0.2 — 몸의 오른쪽 = facing − 90° · 왼쪽 = + 90° · 가르기 −90 → +90(오른쪽 → 앞 → 왼쪽 180°) · 회전 베기 −90 → +270(오른쪽에서 시작해 앞 · 왼쪽 · 뒤를 지나 한 바퀴 — 위에서 보면 반시계)) · k < from 은 arcFrom 쪽으로 감는 예비 · k > to 는 후딜. 회전 베기는 몸통 yaw 도 칼끝을 따라 한 바퀴(발은 제자리) · 판정 틱(`actHit` — 가르기 k 0.45 · 회전 베기 k 0.50)은 u 0.8~0.9 |
| cast | 두 손을 앞으로(화염구 · 연쇄) · 위로(메테오) · 아래로(서리 노바) — 피드백 1: 회전 베기는 cast 가 아니라 attack(아래 swing) |
| channel(회오리) | 몸 전체 회전 초당 3바퀴 · 무기 수평 |
| dash | 앞으로 숙임 · 어깨 앞 |
| leap | `air` 진행: 웅크림 0.1 → 포물선(최고 2.0m at 중간) → 착지 찌그러짐 |
| blink | 시작 + 0.15초에 위치가 바뀐다 — 그 전후 0.1초 투명도(섬광 없음) |
| recall | 무릎 꿇고 손에 빛(P13) |
| dead | 0.6초에 쓰러짐 · 그대로 — **화면 패스 확정**: 쓰러지는 동안 몸을 화면 가로(카메라 방위 ± π/2 중 가까운 쪽 — `deadYawOffset`)로 돌려 눕힌다(시선 방향으로 누우면 55° 카메라에서 서 있는 T자로 읽혔다) |

- **피드백 1(view 단계 · `view/actors/player.js`)**: `PlayerPoser`는 `SWING_BEHAVIORS`(`cleave` · `spinSlash`)의 attack 을 `_swing`으로 그린다(칼끝 방위 = 위 식 `swingAt(sw, now, actStart, actEnd)`). **가르기** — 발은 디딘 채 골반 · 가슴이 칼끝 방위의 `bodyShare` 0.75 를 돌고(골반 몫 `hipShare` 0.4) 팔이 나머지 · 골반을 칼끝 쪽으로 `shift` 0.16m · 상체 숙임 `lean` 0.28(양손 0.12) · 양손 무기는 오른팔을 가슴 앞(`twoHandArm`)에 두고 몸이 돌아 왼손이 손잡이에 남는다. **회전 베기** — 오른팔을 옆으로 뻗고(`spinArm` −1.35rad) 몸 전체가 칼끝을 따라 한 바퀴 · 발은 몸이 `step` π/2 돌 때마다 번갈아 옮긴다(`plant` 0.5 · 드는 높이 `lift` 0.09m — 디딘 발 미끄럼 ≤ 2mm) · 끝에 두 발이 제자리 · 앞을 본다. 손잡이 표 `SWING_POSE`(view 튜닝 — `KIND_STYLE`과 같은 꼴) · 새 export `SWING_BEHAVIORS` · `SWING_POSE` · `aimRightArm` · `armForTip` · `tipForArm` · `footStair` · `swingAt`. 판정 틱의 칼끝: 방위는 식과 5~6° 안 · 높이 0.85~1.2m(몬스터 몸통) · 반지름은 §9.6 표. 가르기는 aps 1.4에서 판정 틱에 칼이 +80° 근처(반원 가운데를 지나는 것은 판정 2틱 ≈ 67ms 전) — 반원 안의 적은 모두 같은 틱에 맞으므로 식을 그대로 둔다(손잡이 `bash.params.swing.to`). 쓰이지 않게 된 옛 attack 포즈(slash · overhead · punch)와 `CAST_FAMILY.cone`(slamDown)은 `magicBolt` 찌르기만 옛 길을 쓴다 — 예비로 남겨 둔다.

**몬스터 템플릿 5** — 파라메트릭 로우폴리. 부위마다 `InstancedMesh` 하나(템플릿 × 부위 · 용량 `MAX_DRAWN = 160`) — **드로콜이 몬스터 수에 비례하지 않는다**(브리프 §8.7). 매 프레임 보이는 몬스터의 부위 행렬을 포즈로 계산해 넣는다.

| 템플릿 | 부위(대략) | 변형 params(종류별) |
|---|---|---|
| `humanoid` | 골반 · 몸통 · 머리 · 팔 4 · 다리 4 · 소품(무기/방패/활) | 구울: 굽은 등 · 긴 팔(팔 길이 0.9m = reach) · 회녹색 / 해골 궁수: 가는 뼈 · 활 · 흰 뼈색 / 방패 해골: 큰 방패(정면 표시 · `recover`와 기절 · 빙결 · 경직 동안은 방패를 내린 자세 — 정면 막기가 꺼진 것이 보인다) · 뼈 / 뼈 거인: 키 4.6m · 두꺼운 뼈 · 등뼈 가시 / 잿빛 마녀: 긴 옷 · 떠 있는 재 |
| `small` | 골반 · 몸통 · 큰 머리 · 팔 2 · 다리 2 · 소품 | 타락 소인: 붉은 피부 · 단검 / 주술사: 해골 가면 · 지팡이 · 녹색 깃털 / 뼈 새끼 · 잿빛 하수인: 작고 마른 |
| `quadruped` | 몸통 · 머리(뿔) · 다리 4 · 꼬리 | 돌격 짐승: 큰 뿔 · 낮은 머리 · 길이 1.6m |
| `blob` | 몸통(구) · 혹 3 · 작은 다리 | 역병 덩어리: 연두 부스럼 · 부풀기(swell)에 1.0 → 1.4배 + 붉은 발광 |
| `nest` | 뼈 무더기 · 갈비뼈 기둥 · 가운데 맥동 | 뼈 둥지: 반지름 0.9 · 높이 1.6 |

| act | 몬스터 포즈 |
|---|---|
| move | 걷기 주기 = 이동 거리 / 보폭(종류 크기 비례) |
| windup | **공격별 예고 자세**(브리프 §3.4 「예고」 열): 구울 팔 들기 · 소인 찌르기 자세 · 방패 들기 · 짐승 발 구르기(돌진) · 궁수 시위 당기기 |
| strike | `actHit` 틱에 팔 · 무기 · 머리가 공격 끝에 닿아 있다 |
| stunned · frozen | 정지(빙결은 마지막 자세 그대로) · 머리 위 별/얼음은 P13 |
| flinch | 0.25초 뒤로 젖힘 |
| flee | 뛰어 도망(팔 휘저음) |
| dead | 0.4초 쓰러짐 → `DEATH.corpseSec − 2`초 뒤부터 2초에 가라앉으며 투명. `launch`가 있으면 그 수평 속도 + 위 4m/s 포물선(중력 15)으로 날아가며 구른다(view 전용 높이) |

- **등급 표시**: champion = 몸 배율 1.15 + 파란 테두리 발광(`#3d7bff`) · elite = 1.30 + 노란(`#ffd23d`) · minion = 노란 기 약하게 · guardian = 자기 모델 · 마우스 대상 = 흰 테두리 맥동. 속성 오라 · 입자는 P13.
- **가림 외곽선**: 플레이어 · 챔피언 · 정예 · 수호자는 벽에 가려진 부분이 실루엣(깊이 비교 반대 패스 · 플레이어 흰 하늘색 · 등급색)으로 보인다(브리프 §5).
- **NPC**(마을): humanoid 변형 4(대장장이 앞치마 · 망치 / 잡화상 / 도박꾼 두건 / 신비술사 긴 옷) · 대기 동작.
- **바닥 아이템**: 부위별 작은 메시(검 · 투구 · 장갑 …)가 바닥에 누움 · 등급색 · 희귀 이상은 테두리 발광 · **전설 · 세트는 빛기둥**(원기둥 높이 4m · 가산 혼합 · 불투명도 0.35 · 주황/녹색 · 천천히 맥동) · 골드(동전 무더기 — 양에 따라 3단계) · 포션(붉은 병) · 구슬(붉은 구 r 0.3 · 위아래로 흔들림) · 재료(작은 결정 · 고철 회색 · 가루 파랑 · 정수 보라). 등장 = `from` → `pos` 0.35초 포물선(높이 1.0m).

### 9.6 판정과 보이는 것 — 한 표 (QUALITY §2 · 차이 ≤ 0.35m)

| 대상 | 판정(sim) | 보이는 것(view) | 차이 |
|---|---|---|---|
| 플레이어 몸 | 원 r 0.40 | 어깨 폭 0.48~0.52 · 발 사이 0.35 | ≤ 0.1 |
| 가르기(피드백 1 — 옛 강타 사거리) | 다가가기: 중심 거리 ≤ 0.4 + mon.r + reach 1.2 · 판정: 플레이어 중심 부채꼴 r **1.9**(0.4 + 1.2 + 관용 0.3) · **180°** · 방향 facing · 몸 겹침 | 칼끝 높이 궤적 띠(바깥 r 1.9) + 판정 순간 바닥 칼자국 반원 r 1.9 · 180°(P13 — 궤적이 정본) · 판정 틱 무기 끝(aps 1.4 실측 — view 단계): 검 1.72 · 도끼/둔기 1.58 · 대검 2.22 · 대도끼 2.13 · 맨손 0.80~0.84 | 0(호가 정본) · 무기 끝 ≤ 0.32 · 맨손 1.1(예외 — 호가 정본) |
| 회전 베기(피드백 1 — 옛 지면 강타 원뿔 r 4.0 · 120°) | 플레이어 중심 원 r **2.5** · 360° | 칼끝 높이 궤적 띠(바깥 r 2.5) + 판정 순간 바닥 칼자국 고리 r 2.5(P13 — 궤적이 정본) · 몸통이 한 바퀴 · 판정 틱 무기 끝(실측): 검 1.76 · 도끼/둔기 1.61 · 대검 2.05 · 대도끼 1.95 | 0(고리가 정본 — 회오리와 같은 규칙 · 무기 끝은 0.45~0.89 짧다: 팔 길이로 2.5에 닿지 않는다) |
| 연속 회전(피드백 1 — 옛 여진) | 원 r 2.5 · 판정(hitAt) 때의 플레이어 자리(`follow:'player'`) | 대기 `[start, hitAt)` 동안 플레이어(그린 자리)를 따라가는 옅은 바닥 호 → 판정 전 0.2초 잔상이 한 바퀴 → 판정 틱 바닥 고리 r 2.5 + 칼끝 높이 잔상 고리 — 효과 `spinEcho`의 지금 `shape` 중심 | 0 |
| 지진 | 원 r 6.0 · 파동 셋 | 퍼지는 고리 6.0(P13) | 0 |
| 회오리 | 원 r 2.4 | 바람 고리 2.4 + 무기 끝 회전 반지름 0.4 + 1.0 = 1.4~2.0 | ≤ 0.35(고리가 정본) |
| 돌진 | 선 폭 1.6 | 먼지 자취 폭 1.6 | 0 |
| 도약 착지 | 원 r 3.5 | 먼지 고리 3.5 | 0 |
| 화염구 폭발 | 원 r 2.5 | 불덩이 구 2.5(최대 크기 · 0.25초) | 0 |
| 메테오 | 원 r 3.5(예고 1.2 · 불타는 바닥도 같은 원) | 예고 고리 3.5 · 낙하 바위 · 불타는 바닥 3.5 | 0 |
| 서리 노바 | 원 r 5.0 | 퍼지는 서리 고리 5.0 | 0 |
| 연쇄 번개 | 대상 몸 · 튕김 6m | 꺾은선 번개 | — |
| 번개 잔상 | 원 r 3.0 | 번개 구 3.0 | 0 |
| 구울 할퀴기 | 중심 거리 ≤ 0.45 + 0.9 + 0.4(+ 관용 0.3) · 90° | 팔 길이 0.9 · 휘두름 호 90° | ≤ 0.3 |
| 소인 찌르기 | 0.35 + 0.7 + 0.4(+ 0.3) · 70° | 단검 + 팔 0.7 | ≤ 0.3 |
| 방패 해골 밀치기 | 0.45 + 0.9 + 0.4(+ 0.3) · 80° | 방패 내밀기 0.9 | ≤ 0.3 |
| 짐승 들이받기 | 0.6 + 1.0 + 0.4(+ 0.3) · 80° | 뿔 끝까지 1.0 | ≤ 0.3 |
| 뼈 거인 휘두르기 | 1.3 + 2.0 + 0.4(+ 0.3) · 120° | 팔 + 뼈 몽둥이 끝까지 2.0 · 휘두름 호 120° | ≤ 0.3 |
| 잿빛 하수인 할퀴기 · 뼈 새끼 찌르기 | 0.32 + 0.7 + 0.4 · 0.30 + 0.6 + 0.4(+ 0.3) | 팔 0.7 · 0.6 | ≤ 0.3 |
| 짐승 돌진 | 선 폭 1.2(= 2r) | 바닥 직선 표식 폭 1.2 | 0 |
| 화살 · 주술사 화염탄 · 마녀 재 화살 | 원 r 0.2 · 0.35 · 0.4 | 화살 막대 길이 0.8 · 구 0.35 · 0.4 | ≤ 0.1 |
| 역병 덩어리 폭발 | 원 r 2.8 | 바닥 원 2.8 | 0 |
| 감옥 · 역병 · 몰타르 · 냉기 노바 · 화염 사망 | 원 r 1.2 · 2.0 · 1.5 · 4.0 · 3.0 | 같은 반지름의 바닥 표식 | 0 |
| 번개 불꽃 | 원 r 0.35 | 전기 구 0.35 | 0 |
| 대지 분쇄 | 원뿔 r 6.5 · 100° | 부채 표식 6.5 · 100° | 0 |
| 뼈 가시 | 선 len 12 · 폭 1.4 | 선 표식 12 × 1.4 | 0 |
| 잿불 비 | 원 r 1.8 | 원 표식 1.8 | 0 |
| 몬스터 몸 | 원 mon.r(= def.radius × rank.scale — 이미 곱한 값) | 템플릿 몸 폭 = 2 × mon.r ± 0.1(강인함의 몸 1.1배는 view만 — 차이 ≤ 0.07) | ≤ 0.1 |
| 마우스 판별 | 원기둥 mon.r · 높이 mon.height | 모델 높이 | ≤ 0.2 |
| 구슬 줍기 | 원 1.2(이롭다 — 넉넉함은 허용) | 구 r 0.3 | (예외) |

`view.fx.test.js` · `view.actors.test.js`가 이 표의 0 칸을 지오메트리 치수로 확인한다(§12.2).

### 9.7 연출 — `FxLayer.js` (P13 · W2)

- **예고 표식**(효과 `start ≤ tick < hitAt`): 최종 크기의 테두리 + 안쪽 채움이 0 → 1로 자란다(진행 = 틱). **적대는 붉은 테두리(`#ff3b30`)가 공통** + 종류별 안쪽 색(감옥 쇠사슬 회색 무늬 · 역병 연두 `#a6e22e` · 냉기 노바 얼음 파랑 `#5ac8ff` · 몰타르 주황 · 화염 사망 주황 · 역병 덩어리 진홍 · 대지 분쇄 · 뼈 가시 뼈색 · 잿불 비 잿빛 주황). 플레이어 소유는 붉은색을 쓰지 않는다(흰 · 주황 · 하늘색). `hitAt`에 그 모양 안에서만 0.1초 밝아짐(불투명도 ≤ 0.6 · 화면 전체를 덮지 않는다 — QUALITY §4).
- **지속 효과**(`hitAt ≤ tick < end`): 웅덩이(역병 · 독 · 메테오의 불타는 바닥 · 소용돌이)는 바닥 데칼 + 약한 입자. `spec`이 null인 예고(돌진 선)도 같은 표식으로 그린다.
- **투사체**: `visual`별(마력 화살 하늘색 빛 화살 · 화염구 불덩이 + 꼬리 · 얼음 파편 · 화살 · 주술사 화염탄 녹주황 · 번개 불꽃 · 마녀 재 화살). 인스턴싱 + 풀(상한 256).
- **몰타르 포탄 · 메테오 바위**: `from` → 표식 중심 포물선(진행 = 틱).
- **속성 오라**(상태 `mon.affixes`): 빠름 바람 줄 · 강인함 금속광(P8 재질 — P13은 입자 없음) · 화염 강화 주황 발광 · 냉기 강화 서리 입자 · 번개 강화 전기 아크 · 흡혈 붉은 오라 · 순간이동 보라 잔상(`vanish`) · 감옥 쇠사슬 고리 · 보호막 금빛 반짝임(`ax.shielding.warnUntil` 동안) → 금빛 구체(`invulnUntil` 동안) · 분열 몸 균열 무늬 · 역병 연두 기포 · 몰타르 등의 포신.
- **상태 표시**: 화상 불꽃 · 빙결 얼음 껍질(몸 크기) · 감전 불꽃 튐 · 기절 머리 위 별 · 냉기 푸른 기.
- **스킬 연출**(`ACTION_HIT` · 효과 · 상태): 가르기 반원 칼자국 · 회전 베기 원 칼자국(피드백 1 — 옛 지면 강타 충격 부채) · 연속 회전 잔상 칼자국(`spinEcho`) · 지진 고리 · 회오리 바람 기둥 · 돌진 먼지 · 도약 착지 먼지 · 전투 함성 금빛 고리 + 버프 오라 · 마력 보호막 푸른 구체(흡수량 비율로 불투명도) · 서리 노바 · 연쇄 번개 꺾은선(0.2초) · 순간이동 출발/도착 빛 · 귀환 시전 빛기둥.
- **타격**: `HIT` → 종류별 불꽃(물리 흰 주황 · 화염 주황 · 냉기 하늘색 · 번개 흰 보라) · 치명타 크게 · `MON_DIED` → 먼지 · 뼈 조각(템플릿별).
- **포털 소용돌이** · 레벨업 금빛 기둥(플레이어 주변만 · 화면을 덮지 않는다) · 수호자 출현 예고(검은 균열 + 보라 소용돌이 2초).
- 화질: 입자 수 × `QUALITY.particles`. 입자 · 데칼 풀 상한(입자 2,000 · 데칼 200 — 브리프 §5 「투사체 · 바닥 효과 200」).
- **피드백 1(view 단계 · `FxLayer.js` · `fx/actors.js` · `fx/style.js`)**: 횡베기 연출은 셋 — ① **칼끝 궤적**(`swingTrail` — 매 프레임 상태로: `player.act === 'attack'` · `actStart/actEnd` · `facing` · `params.swing`) 칼끝 높이 `SWING_FX.y` 0.95m 의 띠(바깥 = 판정 반지름 · 안쪽 = × `inner` 0.72 · 꼬리 `tailDeg` 110° 로 흐려짐 · 휘두름이 끝나면 `fadeK` 0.14 안에 사라짐) — 가산 배치 `swoosh`(새 · 상한 `CAP.swooshVerts` 6000 · `info().swooshVerts`) ② **바닥 칼자국**(순간 연출 새 종류 `'slash'` — `ACTION_HIT{bash}` 반원 r = `slashReach(def)`(몸 r + reach + `PLAYER.reachTolerance`) · `angleDeg` · `ACTION_HIT{groundStomp}` 고리 r = `radius` · 띠 폭 `ground` 0.16m · 세기 `groundA` 0.55 · 0.3초) · 색 `PLAYER_FX.slash` 0xfff0d6(따뜻한 흰색 — 붉은색 없음 · 옛 `stomp` 충격 부채 · 균열 무늬 · 먼지는 없다) ③ **연속 회전**(`KIND_STYLE.spinEcho` — 예고 표식 없음 · pre `'spinGhost'`: 대기 동안 바닥 호가 진행만큼 자라며 `follow:'player'`면 그린 플레이어 자리를 따라간다(`echoPreA` 0.16) · 판정 전 `echoGhostSec` 0.2초 잔상이 한 바퀴를 돌아 판정 틱에 마친다 · hit `'slash'` 바닥 고리 + 칼끝 높이 잔상 고리(`sheet` 0.35 · `echoSheetSec` 0.15초) · 잔상 색 `SWING_FX.echo` 0xcfe6ff). 놓친 `ACTION_HIT`은 `HIT_ACTS`에 `'attack'`을 더해 상태(`actId` · `actHit`)로 한 번 세우고, 놓친 `EFFECT_HIT`은 `rift.effects`에서 `hitAt`이 막 지난 효과로(효과 ID마다 한 번) 세운다. 손잡이 표 `SWING_FX`(view 튜닝).
- **W2 확정(P13)**: 궁수 조준선(공격 행 `telegraph: 'aimLine'` · `mon.aim` · `aimLocked`면 굵게)과 시전 빛(`'glow'` · cast + aim이면 대상 자리 빛기둥)은 P13이 상태로 그린다(P8은 그리지 않는다). 입자 상한 2,000 = 시뮬 입자(가산 1,100 + 먼지 300) + 프레임 스프라이트(오라 · 상태 · 포털 · 후광) 600 · 데칼 200 = 상태 효과 + 순간 표식 합. 몰타르 · 잿불 비 낙하체는 효과의 `from`이 있을 때만(없으면 바닥 표식만). 순간 연출은 이벤트 + 상태 대체 경로(놓친 `EFFECT_HIT` · `ACTION_HIT`을 효과 ID · `player.actId`로 한 번 세운다).

### 9.8 연출 ID 목록 (효과 `kind` · 투사체 `visual` — 만드는 쪽 / 그리는 쪽 P13)

| 효과 kind | 만드는 쪽 | 적대 | 모양 |
|---|---|---|---|
| `spinEcho`(피드백 1 — 옛 `stomp` · 원 · `follow:'player'`) · `quakeWave` · `shockwave` · `meteor`(지속 구간 [hitAt, end)은 불타는 바닥) · `vortex` · `afterimageBlast` · `corpseBlast` · `iceBurst` · `chainArc` | P1 | ✗ | 원뿔 · 원 · 선 · 꺾은선 |
| `chargeLine` · `bloaterBurst` · `poisonPool` | P3 | ✓ | 선 · 원 |
| `fireDeath` · `coldNova` | P3 | ✓ | 원 |
| `jail` · `plague` · `mortar` | P16 | ✓ | 원 |
| `slam` · `boneSpikes` | P3 | ✓ | 원뿔 · 선 |
| `emberRain` | P16 | ✓ | 원 |
| `guardianSpawn` | P2 | ✗(env) | 원 r 2.0 |

| 투사체 visual | 만드는 쪽 |
|---|---|
| `magicBolt` · `fireball` · `fireballSplit` · `iceShard` | P1 |
| `arrow` · `shamanFire` | P3 |
| `spark` | P16 |
| `ashBolt` | P16 |

### 9.9 이벤트 → 연출 · 카메라 · 소리

| 이벤트 | fx(P13) | 카메라(P7) | 소리(P14) |
|---|---|---|---|
| `ACTION_START` | 시전 빛(손) | — | 휘두름 · 시전 시작 — 피드백 1: 가르기 = 휘두름(`swing` — 옛 강타와 같다) · 회전 베기 = 한 바퀴 휘두름(`spinSwoosh`) |
| `ACTION_HIT` | 스킬 순간 연출 | — | 스킬별 타격(종류마다 질감) |
| `HIT` | 불꽃 | — | 몬스터 피격(템플릿별 · 상한) |
| `HITSTOP` | — | — | — (app이 멈춘다) |
| `SHAKE` | — | 흔들림 | — |
| `MON_DIED` | 먼지 · 뼈 | — | 사망(템플릿별) |
| `MON_ACT` | 발광 예고(glow) | — | 예고음(공격 kind별 · 정예는 크게) |
| `AFFIX` | 속성 순간 연출 | — | 감옥 · 몰타르 · 보호막 · 냉기 노바는 고유 예고음 |
| `EFFECT_SPAWN` · `EFFECT_HIT` | (상태로 그림) · 폭발 | 큰 효과면 흔들림(발행 쪽이 `SHAKE`) | 예고음 · 쾅 — 피드백 1: 연속 회전(`spinEcho`) 판정 = 잔상 휘두름(`echoSwoosh`) |
| `DROP_SPAWN` | — | — | 등급별 · 전설 · 세트 고유 종소리 |
| `DROP_PICKED`(gold) | — | — | 짤랑 |
| `POTION` · `PLAYER_HEAL` | 붉은/녹색 기 | — | 마심 |
| `LEVEL_UP` | 금빛 기둥 | — | 레벨업 |
| `RECALL` · `PORTAL_*` · `TRAVEL_REQUEST` | 빛기둥 · 소용돌이 | — | 귀환 시전 · 포털 |
| `GAUGE_FULL` · `GUARDIAN_APPEAR` | 출현 예고 | — | 게이지 100% · 수호자 출현 |
| `CHANNEL` | 바람 기둥 | — | 회오리 지속음(시작/끝) |
| `PLAYER_HIT` | 붉은 튐(작게) | — | 맞는 소리 |
| `PLAYER_DIED` | — | — | 사망음 |

### 9.10 화질 단계

| | low | medium | high |
|---|---|---|---|
| 픽셀 비율 상한 | 1.0 | 1.5 | 2.0 |
| 실제 점광원 | 3 | 5 | 8 |
| 그림자 | 없음 | 없음 | 플레이어 빛 하나(1024) |
| 입자 배율 | 0.4 | 0.7 | 1.0 |
| 벽 낮추기 | 즉시 | 0.15초 | 0.15초 |

### 9.11 소리 — `AudioEngine.js` (P14 · W2)

- WebAudio 합성만(외부 에셋 0). `unlock()` 전 호출은 조용히 무시. 마스터 → `DynamicsCompressor`(리미터 · threshold −10dB · ratio 12) → 출력. 버스: 효과(sfx) · 환경(ambient) · UI — 볼륨은 설정.
- 동시 발음 상한 32 · 종류별 상한(피격 6 · 사망 6 · 발사 6 · 예고 4) · 같은 종류 30ms 안 재발음은 합친다.
- 지속음: 회오리(`player.channel`) · 귀환 시전(`player.recall`) · 환경음(마을 모닥불 `townFire` · 묘지 바람 `cryptWind` · 동굴 용암 `cavernLava` — `state.scene` · `rift.tileset`). 탭 숨김 · 일시정지 · 판 끝(장면 전환)에서 정리(QUALITY §5).
- 소리 목록(§9.9의 열 + UI 클릭 · 패널 열기/닫기 · 거래 · 실패음).
- **W2 확정(P14)**: UI 버스 볼륨 = `volSfx × MIX.ui`(설정에 UI 볼륨이 없다). 일시정지 둘 — `setPaused(true)`(탭 숨김) = 모든 소리를 끊고 suspend · `PAUSED{menu|modal|blur|debug|context}` = 전투 지속음만 멈추고 환경음 × 0.35(UI · 거래 · 실패음은 난다). 0.06초 안 4개를 넘는 몰림은 그 뒤 소리를 줄인다(우선순위 5 — 고유 예고 · 정예 경보 · 전설/세트 종 · 레벨업 · 사망 · 수호자는 제외). 일반 버튼 클릭 이벤트는 없다(딸깍은 `PANEL_OPENED/CLOSED` · `BAG` · `SKILLS` · `SETTINGS_CHANGED` · `TRADE` · 실패음으로).
- **피드백 1(수정 단계 · `audio/sounds.js`)**: `START_BY_BEHAVIOR` `cleave` → `swing`(옛 강타와 같은 휘두름) · `spinSlash` → `spinSwoosh`(새 레시피 — 대역 잡음이 올라갔다 내려오는 한 바퀴 휘두름 · 행동 0.6초 중 휘두르기 0.09~0.33초에 맞춘 층 지연) · `HIT_BY_BEHAVIOR` 둘 다 `null`(판정 틱의 소리는 맞은 적마다의 `HIT` 타격 — 30ms 합치기 · 옛 지면 강타의 쿵 `stomp`은 없다) · `EFFECT_BOOM.spinEcho` → `echoSwoosh`(새 — 가볍고 높은 잔상 휘두름 + 옅은 쇳소리 · 플레이어 소유라 `EFFECT_SPAWN`에는 소리가 없다). sim 이 더 만들지 않는 열(`meleeBasic` · `cone` · 효과 `stomp`)은 지웠다 — 레시피 `stomp`은 진동 주먹(`shockwave`)이 그대로 쓴다. `audio.test` 「피드백 1」이 실제 이벤트(`ACTION_START{bash|groundStomp}` · `EFFECT_HIT{spinEcho}`)로 세 소리가 나고 서로 다른 음색인지 본다.

---

## §10 ui 계약 (P10 · P11 · P12 — W2)

### 10.1 진입점 · 공통 — `UIRoot.js` (P10)

```js
export class UIRoot {
  constructor({root, bus, sim, settings, actions, view})   // view = {project(x, y, z) → {x, y, visible}} (rc.project)
  update(state, alpha, dtReal)       // HUD · 열린 패널 · 이름표 · 피해 숫자 · 미니맵 — 상태에서 다시 그린다
  openPanel(id, args = {})           // → boolean · PANEL_OPENED · 같은 것이 열려 있으면 앞으로
  closePanel(id = null, by = 'code') // id 없으면 맨 위 · PANEL_CLOSED
  closeAll(by = 'code')
  topPanel()                         // → PanelId|null
  isModal()                          // 열린 것 중 modal 패널이 있다
  ownsKey(code)                      // 피드백 2 D6 — 맨 위 패널이 모달이고 그 keys 에 code 가 있다(app 입력이 그 홀드 키를 뗄 때까지 먹는다 — 스킬 트리의 1~4 칸 배정 · §10.5)
  anyOpen()
  handleKey(e)                       // → boolean(처리했다 = 게임 입력이 아니다) — keydown · keyup 둘 다 받는다 · 맨 위 패널 하나에만 보낸다(패널끼리 키를 넘기지 않는다)
  blocksPointer(px, py)              // → boolean — 그 화면 점이 상호작용하는 UI 위다(app은 게임 입력으로 보내지 않는다)
  labelHover()                       // → Hover|null(src 'label') — 마우스 아래 바닥 이름표(app의 조합 순서는 §11.5)
  setLabels(on)                      // Alt(LABELS 이벤트로도 온다)
  notice(key, params = {}, {big = false, sec = 3} = {})   // 알림 열(오른쪽 가운데 · 3초 · 최대 4) · big이면 비모달 안내 꼴(6초 · 대상 프레임 · 플레이어를 가리지 않는 자리 — §10.2 hint)
  setSticky(key | null)              // 지우기 전까지 남는 알림(컨텍스트 잃음 · 저장 불가)
  showFatal(titleKey, bodyKey)       // 전체 화면 안내(WebGL 없음 등) — 게임은 멈춘다
  dispose()
}
```

- **패널 레지스트리**(`ui/panels/index.js` · P0 완성): `PANELS[id] = createXPanel` — 각 패널 파일은 `export function createXPanel(ctx)` 하나를 낸다(이름 = `'create'` + PanelId 첫 글자 대문자 + `'Panel'` — `createInventoryPanel` · `createRiftStonePanel` · 분석은 `ui/analytics/AnalyticsPanel.js`의 `createAnalyticsPanel`). `ctx = {root, sim, bus, settings, actions, t, ui, widgets}`. 반환 `Panel = {id, modal:boolean, el, open(args), close(), update(state), handleKey(e) → boolean, keys:string[], dispose()}` — `keys`는 그 패널이 먹는 `event.code` 목록(겹쳐 보는 패널에서 나머지는 게임으로 간다 — §10.5).
- **CSS**: `index.html`이 `src/ui/hud.css`(P10 — 공통 변수 · HUD · 공통 패널 틀) · `src/ui/panels.css`(P11) · `src/ui/analytics/analytics.css`(P12)를 링크한다. JS는 CSS를 import하지 않는다(Node 테스트가 ui 순수 파일을 import한다).
- **공통 위젯**(`ui/widgets.js` · P10): `panelFrame(titleKey)` · `gridNav(el, cols, rows, onPick)`(방향키 · Enter · 포커스 고리) · `listNav(el, onPick)` · `tabs(el, keys)`(`BracketLeft` · `BracketRight`) · `button(labelKey, onClick, hotkey)` · `bar(el)` · `confirm(textKey, params) → Promise<boolean>`(confirm 패널). P11 · P12는 이것만 써서 같은 조작감을 낸다. 가방 격자는 P11 내부 `pnlBagGrid.js`(gridNav 위 — 인벤토리 · 대장장이 · 잡화상 · 보관함 · 신비술사가 같이 쓴다).
- **문면**: `t(key, params)`(`ui/i18n.js`) 하나. 화면에 문자열 키가 그대로 나오면 실패(§10.8).
- 1280×720 · 1920×1080에서 겹침 · 잘림 없음(패널 최대 폭 1100px · 높이 640px · 그 안에서 스크롤).
- **W2 확정(P10 · P11 · P12)**: `gridNav(el, cols, rows, onPick, opts?)` · `listNav(el, onPick, opts?)`의 선택 인자 `opts = {onFocus(i), onEdge(dir) → boolean(true면 먹음 — §10.5-8의 영역 넘기기), wrap, start}` · 반환 `{handleKey, focus(i, silent?), index, blur, refresh, setSize, active, destroy}` · `tabs(el, keys, onChange?)` → `{select, index, handleKey, destroy}` · `button(labelKey, onClick, hotkey?, params?)`(DOM 포커스를 받지 않는다) · `bar(host?)` → `{el, fill, set(v, text?)}` · `el(tag, cls, text)`. 맨 위 패널이 먹지 않은 keydown은 UIRoot가 그 패널 안의 ① 탭 ② 가장 최근에 쓴 활성 nav ③ `data-hotkey`가 그 `event.code`인 보이는 버튼에 넘긴다. UIRoot에 더한 것: `isOpen(id)` · `respawnFromPanel()` · `botOn`(읽기) · `minimap.tiles`(큰 지도와 공유). `INTERACT` → 상점 · 보관함 · 균열석 패널은 **UIRoot가 연다**(args `{from:'interact', object}` · 봇이 켜져 있으면 열지 않는다 — P11 패널은 구독하지 않는다). 계측 HUD는 UIRoot가 `createMeterHud({root: HUD 왼쪽 자리, sim, bus, settings, actions, t, ui, widgets})`로 만들고 매 프레임 `setVisible(settings.meterHud && HUD 보임)` · `update(state, dtReal)`를 부른다.

### 10.2 패널 목록

| ID | 소유 | modal | 여는 것 | 읽는 상태 | 부르는 명령 |
|---|---|---|---|---|---|
| `title` | P10 | ✓ | 부트(쿼리가 없을 때) · `quitToTitle` | `account.chars` · `lastSlot` · 저장 가능 여부 | `actions.continueGame` · 캐릭터 선택 · 새 캐릭터 |
| `charSelect` | P10 | ✓ | 타이틀 | `account.chars`(이름 · 클래스 · 레벨 · 해금 균열) | `actions.selectChar(slot)` · 삭제(`Delete` → confirm → `actions.deleteChar`) |
| `newChar` | P10 | ✓ | 타이틀 · 캐릭터 선택 | — | `actions.newChar({slot, cls, name})` — 칸이 차 있으면 confirm(덮어쓰기 · 백업) |
| `pause` | P10 | ✓ | `Escape`(위에 패널 없음) · 포커스 잃음 | — | 계속 · 설정 · 도움말 · 타이틀로(`actions.quitToTitle`) — 「균열 진행은 저장되지 않는다」 문구(브리프 §3.1) |
| `settings` | P10 | ✓ | 일시정지 · 타이틀 | `settings` | `actions.applySettings(partial)` |
| `help` | P10 | ✓ | 일시정지 · 안내 카드 | `MON_AFFIXES` · 키 바인딩 | 탭: 조작 안내 · **정예 속성 설명**(12개 · 표시 · 대응 — 브리프 §3.4) · 규칙(생명 3 · 붕괴 · 수리) |
| `death` | P10 | ✓ | `PLAYER_DIED` + `DEATH.panelDelay`(0.3초 — 그 전에 누른 Enter는 버퍼로 패널이 뜨는 틱에 실행) | `rift.lives` · `phase` · `player.killedBy` · 수리비 · 붕괴면 `rift.summary` | `actions.respawn()`(Enter) — 붕괴면 문구 「균열 붕괴 — 보상과 해금을 잃었다」 + 그 판 요약(시간 · 처치 등급별 · 획득 등급별 · 골드 · 경험치)과 「잃은 것: 수호자 보장 드랍 2 · 해금 +1(무사망 +2)」 줄 |
| `riftComplete` | P10 | ✓ | `RIFT_COMPLETE` | `rift.summary` | 확인(Enter — 닫고 계속 줍는다) · 「마을로」(T 키 → `sim.leaveRift()` — 나가는 포털과 같다) |
| `confirm` | P10 | ✓ | 위젯 | args | 예/아니오(Enter/Escape) |
| `hint` | P10 | ✓ | `HINT{town \| controls}`만(다른 여섯은 `ui.notice(…, {big:true})` 비모달 안내 6초 → 보이면 `sim.markHint(id)` — 게임을 멈추지 않는다) | args.id | 닫기(Enter) → `sim.markHint(id)` · 「도움말 보기」 |
| `map` | P10 | ✗ | `Tab` 토글 | `rift.explored` · 맵 · 포털 · 플레이어 | — |
| `inventory` | P11 | ✗ | `KeyI` | `char.bag` · `char.equip` · `stats` | `equip` · `unequip` · `moveItem` · `sortBag` · `setItemLocked`(L) — 상점 · 보관함 · 신비술사 패널이 열리면 닫힌다(그 패널들이 가방을 자기 안에 그린다 · §10.5-8) |
| `skills` | P11 | ✓(**피드백 2 D6** · 옛 ✗ — 균열에서도 게임이 멈춘다 · `S` 또는 `Escape` 로 닫는다 · 열린 동안 `1`~`4` 는 칸 배정 키이고 닫은 뒤에도 뗄 때까지 게임 입력이 아니다) | `KeyS` · 레벨업 배너 | `char.skills` · `pointsFree` · `canLearn` · `describeSkill` · `previewLearn` | `learnSkill` · `setSkillBar` |
| `character` | P11 | ✗ | `KeyC` | `stats`(능력치 · 시트 DPS · 방어 · 저항 · 감소율 · MF · GF · 경험치) | — |
| `blacksmith` | P11 | ✓ | `INTERACT{npc blacksmith}` | 재고 · 되사기 · 수리비 · 재료 | `buy` · `sell` · `sellMany`(일괄 판매 V) · `buyback` · `repairAll` · `salvage(Many)` · `craft` — 가방 격자를 자기 안에 그린다(`pnlBagGrid` · 영역 둘 — §10.5-8) |
| `general` | P11 | ✓ | `INTERACT{npc general}` | 포션 · 두루마리 가격 · 장신구 재고 · 무료 자격 | `buyPotions` · `buyScrolls` · `buy` · `sell` · `sellMany`(V) · `takeFree` — 가방 격자를 자기 안에 |
| `gambler` | P11 | ✓ | `INTERACT{npc gambler}` | `priceGamble` · **`gambleOdds`(확률 공개)** | `gamble(slot)` → 그 자리에서 결과(등급 · 옵션 · 비교) |
| `mystic` | P11 | ✓ | `INTERACT{npc mystic}` | 아이템 · `priceReroll` · `char.shop.reroll` · `priceReset` | `rerollOffer` · `rerollChoose` · `rerollCancel` · `resetSkills`(confirm) — 가방 격자를 자기 안에 |
| `stash` | P11 | ✓ | `INTERACT{stash}` | `account.stash` · `char.bag` | `moveItem` · `sortStash` — 피드백 2: 왼쪽 보관함 10 × 6 · 오른쪽 가방 6 × 5 나란히(영역 축 'h' · 패널은 왼쪽에 붙어 오른쪽에 툴팁 카드 자리) |
| `riftStone` | P11 | ✓ | `INTERACT{riftStone}` | `previewRift(1..riftUnlocked + 3)`(잠긴 것은 회색) · 최고 기록 | `actions.openRift(level)` — 열린 균열이 `active` · `guardian`일 때만 confirm(「지금 균열을 닫는다」) · `complete`면 조용히 닫는다(줍지 않은 희귀 이상이 있으면 패널 안에 「남은 전리품 n개」 한 줄) · 기본 포커스는 §10.6 |
| `analytics` | P12 | ✓ | `Backquote` · `?analytics=1` | 데이터 표 · `char.records` · 시뮬레이터 | 봇 켬/끔(`actions.setBot`) · 내려받기(`actions.downloadFile`) |

- 모든 거래 패널은 **전 · 후 수치를 나란히** 보인다(골드 · 재료 · 시트 DPS · 생명 · 방어 · 저항 — QUALITY §3). 패널을 연 채 명령을 부르고, 결과 `{ok:false}`면 `t('reason.' + reason, params)`를 패널 안에 보인다.
- **봇이 켜져 있는 동안**(`BOT{on:true}`) ui는 `INTERACT` · `HINT` · `PLAYER_DIED` · `RIFT_COMPLETE`로 패널을 열지 않는다(봇이 모달에 막히지 않게 — §11.13) · 봇을 끄면 상태에 맞는 패널(사망 · 완료)을 연다.
- **피드백 1(ui 단계) — 저생명 포션 안내**: 첫 판들(`char.runs ≤ 3` · `UIRoot.POTION_NUDGE_RUNS`)에서 처음으로 `potionUrge`(§10.3)가 참이 되면(모달 없음 · 봇 끔 · 균열) 비모달 안내 `hint.potion.title|body`(`ui.notice(…, {big:true})` · 6초)를 한 번 낸다. ui 전용이다 — `HINT` 이벤트가 아니고 `HINT_IDS`에 없으며 저장하지 않는다(세션 · 캐릭터마다 한 번 · `CHAR_LOADED`에 되돌린다 · 새로 읽으면 다시 날 수 있다). 위 비모달 안내 여섯과 별개다.
- **안내 큐**: `PLAYER_DIED`부터 다음 `PLAYER_SPAWNED{reason:'portal'}`까지 받은 `HINT`는 큐에 두었다가 그 뒤 비모달 안내로 낸다(재도전 경로에 카드가 끼지 않는다 — 키 2번 · QUALITY §3).
- **W2 확정**: 새 캐릭터 덮어쓰기 확인은 **패널이** 한 번 받는다(`account.chars[slot]`이 차 있으면 confirm → `actions.newChar({slot, cls, name, confirmed:true})`) · app은 확인을 다시 묻지 않고 저장소에 `char:<slot>` 키가 있으면 백업만 한다. 사망 패널의 Escape는 패널을 닫지 않고 일시정지를 위에 연다(쓰러진 채 패널이 없는 상태 금지). Enter 버퍼 둘: ① 쓰러진 뒤 사망 패널이 뜨기 전의 Enter → 패널이 뜨는 틱에 `actions.respawn()`(겹쳐 보는 패널보다 먼저) ② 전환 막(FADE)이 걷히는 동안의 Enter → 막이 걷힌 뒤 복귀 안내가 떠 있으면 `actions.returnToRift()`(유효 1.2초 · 실제 시간). 봇이 켜져 있으면 모달 안내(town · controls)도 비모달 꼴로 내고 본 것으로 적는다. 막 · 알림 · 배너 · 피해 숫자는 `dtReal`(디버그 step이면 막과 Enter 버퍼만 벽시계)로 흐른다 — `__game.step` 정지 화면에서 막의 걷힘은 실제 시간이 지나야 끝난다(헤드리스 흐름 검사는 전환 뒤 실제 시간을 기다린다).

### 10.3 HUD (P10 · HTML/CSS · 한국어)

| 자리 | 요소 | 읽는 것 |
|---|---|---|
| 하단 중앙 왼쪽 | **생명 구슬** · 보호막 겹 · 저생명 맥동(섬광 아님) · 포션 수(Q) + 쿨다운 부채 — **피드백 1(ui 단계)**: 포션 칸은 구슬 왼쪽의 붉은 병(`.consum-potion` · 병 목 · 몸통 · 액체 · 큰 수 · Q 배지 · 아래 「포션」 · 쿨다운 부채는 병 몸통 위 `is-cd` · 0개면 빈 병 · 붉은 0 `is-empty` · 툴팁 `hud.potionTip`) · **재촉** `is-urge` = 순수 함수 `hud.potionUrge(p, ch, tick)`(살아 있고 `lowLife` · `potions > 0` · `potionReadyAt ≤ tick`) — 병과 Q 가 금빛으로 까딱인다(구슬의 붉은 맥동과 색 · 주기 · 자리가 다르다) | `player.life/lifeMax` · `shield` · `lowLife` · `char.potions` · `potionReadyAt` |
| 하단 중앙 | **스킬 바** 6칸: [좌클릭 기본] [우클릭] [1] [2] [3] [4] — 아이콘(이름 두 글자 + 갈래 색 — **화면 패스 확정** `skillGlyph`: 여러 낱말이면 낱말마다 첫 글자 · 한 낱말이면 앞 두 글자 · 첫 글자만이면 「지면 강타 · 지진」이 겹쳤다 · **리뷰 수정**: 규칙대로면 다른 낱말로 읽히는 것은 문자열 `glyph.<노드 ID>` 예외 — 전투 함성 「함성」 · 연쇄 번개 「연쇄」 · 화염구 「화구」 · 피드백 1: 회전 베기 「회전」(규칙대로면 「회베」)) · 키 표시 · 쿨다운 부채 · 자원 부족이면 흐림 · 빈 칸 점선 | `char.skills.bar` · `skillReady` |
| 하단 중앙 오른쪽 | **자원 구슬**(분노 붉은 주황 · 마나 파랑) · 두루마리 수(T) — **최종 게이트**: 완료한 균열(요약 있음 · 살아 있음)에서는 수 대신 녹색 「마을」(T = 무료 · 즉시 마을로 · controller.handleEdges 와 같은 조건) | `resource/resourceMax` · `char.scrolls` · `rift.phase` · `rift.summary` |
| 하단 끝 | **경험치 바**(전체 폭 · 레벨 숫자 · 캡이면 「최대」) · 스킬 포인트가 있으면 「S — 스킬」 표시 | `char.xp` · `xpReq` · `pointsFree` |
| 생명 구슬 위 | 버프 · 상태 아이콘(전투 함성 · 마력 보호막 · 감속 · 속박 · 부서진 장비 경고) | `player.buffs` · `st` · `stats.broken` |
| 상단 중앙 | **대상 프레임**: 이름(정예 이름 · 등급색) · 등급 · **속성 목록**(이름) · 생명 바 | `player.hover`(몬스터) 또는 `player.targetId` |
| 상단 중앙 아래 | **균열 게이지**(%) · **생명 3**(아이콘) · 수호자가 있으면 **대형 체력 바**(이름 · 속성) | `rift.gauge` · `lives` · `guardianId` |
| 우상단 | **미니맵** 200×200(탐색한 타일 · 플레이어 화살표 · 포털 · 희귀 이상 드랍 점 · 챔피언/정예 점 · 30m 안 깨어 있는 몬스터 붉은 점 · 마을에서 `char.runs === 0`이면 균열석 점) | `rift.explored` · 맵 · 엔티티 |
| 오른쪽 가운데 | 알림 열(레벨업 · 전설 드랍 · 가방 가득 · 해금 · 내구도) — 대상 프레임과 플레이어를 가리지 않는 자리 | 이벤트 |
| 화면 가운데 위 | 배너(균열 열림 · 게이지 100% · 수호자 출현 · 완료) 2.5초 — **리뷰 수정**: 위 묶음(대상 프레임 · 게이지 · 수호자 바)의 실제 아래끝 + 10px(21%보다 위로는 가지 않는다 — 수호자 체력 바를 덮었다) | 이벤트 |
| 스킬 바 위 | 귀환 시전 바 · 마을 복귀 안내 「Enter — 균열로 돌아가기」(`town.returnPrompt`) | `player.recall` · `town` |
| 왼쪽 | 계측 HUD(P12 · 설정 켬) | `meterView` |
| 좌상단 | 「개발 세션 — 저장 안 됨」 · 「봇 관전 중」 배지 | `flags.devSession` · `BOT` |

- HUD는 균열 · 마을 모두 같은 구성(마을에서는 게이지 · 목숨을 숨기고, 대상 프레임은 마우스 아래 NPC · 시설의 이름만 — **리뷰 수정**: `npc.<object id>` · 장식은 없음). 균열 목숨(◆)의 문면은 「목숨」(생명 = 체력과 겹치지 않게 — 리뷰 수정).

### 10.4 바닥 이름표 · 피해 숫자 (P10 `labels.js`)

- **이름표**: 등급색(일반 `#e8e8e8` · 마법 `#6f9bff` · 희귀 `#ffd84a` · 전설 `#ff9a2e` · 세트 `#4fe07a`) · 희귀 이상은 늘 · 그 아래는 `Alt`를 누르거나 「늘 이름표」 설정일 때 · 「일반 등급 숨기기」면 일반 등급 이름표를 감춘다(드랍은 그대로 있다) · 골드 · 재료는 `Alt`일 때만. 위치 = `project(drop.pos, y 0.4)` · 겹치면 화면 y 순으로 아래로 밀어 쌓는다 · 마우스를 올리면 `labelHover()`가 그 드랍(`src:'label'` — 쌓여 밀린 이름표도 sim이 받는다 §5.2-1 · 클릭 = 줍기 · 몬스터 원기둥과 겹치면 Alt를 누를 때만 이름표가 앞선다 §11.5). DOM 풀(상한 64).
- **피드백 1(ui 단계) — 떨어진 직후 이름표**: `labelVisible(drop, o)`가 선택 `o.fresh`를 받는다 — 떨어진 틱(`Drop.born`)부터 `FRESH_LABEL_SEC` 2.2초(게임 시간) 동안은 일반 · 마법 장비 · 골드 · 재료 · 포션도 이름표를 낸다(「일반 등급 숨기기」면 흰 장비는 그래도 숨김 · 구슬은 이름표가 없다). 불투명도 = 순수 `freshAlpha(born, tick)`(끝 0.4초에 1 → 0 · 그 뒤 0 — Alt · 「늘 이름표」 · 희귀 이상은 그대로 1). **주운 골드 숫자**: `DROP_PICKED{kind:'gold', amount}` → `labels.addGold(x, z, amount)` — 플레이어 머리 위(y 2.6) 「+n 골드」(`label.goldPicked`) · 0.6초 안의 줍기는 한 숫자로 합친다(실제 시간 — `__game.step` 정지 화면에서는 계속 합쳐진다) · 1.3초 · 피해 숫자 설정과 무관하게 낸다.
- **피해 숫자**(설정 `damageNumbers`): 플레이어가 준 `HIT`(amount > 0) · 같은 대상 0.1초 안이면 합친다 · 0.8초 떠오름 · 치명타 1.5배 크기 · 노랑 주황 · 화상 등 dot은 작은 회색 · 면역은 「면역」. 받은 피해는 플레이어 위에 작은 붉은 숫자. DOM 풀 48 — 넘으면 가장 오래된 것을 재사용.
- **최종 게이트**: 받은 피해 · 회복 숫자도 0.1초 안이면 합친다(전에는 몬스터 대상만 — 떼에게 맞으면 머리 위에 「22222」처럼 겹쳤다) · 1 미만의 양수는 「0」이 아니라 소수 한 자리(최소 0.1 — `format.fmtDmg` · 균열 1 몬스터 한 방 ≈ 0.3).

### 10.5 입력 포커스 규칙

1. app의 키 처리기: 텍스트 입력 칸(새 캐릭터 이름)에 포커스가 있으면 그 키는 ui만. 아니면 `ui.handleKey(e)` 먼저 — `true`면 게임 입력이 아니다.
2. **modal 패널**이 열려 있으면 게임 입력은 없다(모든 키가 ui로 · app은 step하지 않는다 — §5.12).
3. **겹쳐 보는 패널**(인벤토리 · 캐릭터 · 지도)은 자기 `keys`만 먹는다: 인벤토리 = 방향키 · Enter · KeyZ · KeyL · Escape · KeyI / 캐릭터 = Escape · KeyC / 지도 = Tab · Escape. 나머지(Q · T · 스킬 키 · 클릭)는 게임으로 간다. **피드백 2 D6**: 스킬 트리(keys = 방향키 · Enter · KeyR · Digit1~4 · Escape · KeyS)는 모달이 됐다(2번 규칙 — 모든 키가 ui로). 모달이 먹은 「누르고 있는」 게임 키는 7번대로 닫힌 뒤 「눌림」으로 남지만, **모달이 자기 `keys`로 쓴 홀드 키**(`ui.ownsKey(code)` — 스킬 트리의 1~4 칸 배정)는 겹쳐 보는 패널처럼 뗄 때까지 먹는다(`captured` — 칸 배정 키가 닫은 뒤 스킬로 새지 않는다 · `ui.feedback2.test`).
4. `Escape`: 맨 위 패널을 닫는다 · 없으면 일시정지를 연다. `KeyI` · `KeyS` · `KeyC` · `Tab`은 토글(modal이 열려 있으면 무시 — **피드백 2 D6**: 맨 위 모달이 그 토글 키의 패널이면 닫는다 · 모달 스킬 트리는 `S`로 닫힌다). `Backquote`는 분석 패널 토글.
5. 마우스: `ui.blocksPointer(x, y)`이면 그 누름 · 휠은 게임 입력이 아니다(누르고 있던 이동은 유지 — 패널 위로 커서가 지나가도 끊기지 않게, 떼면 끝).
6. **Enter 우선순위**: 열린 패널 > HUD 복귀 안내 — 마을에서 `town.returnPrompt`가 떠 있고 패널이 하나도 없으면 `Enter`는 HUD가 먹고 `actions.returnToRift()`(부활 → 복귀 「키 1번」). 사망 패널의 `Enter`는 `actions.respawn()` — 패널이 뜨기 전(`DEATH.panelDelay` 안)에 누른 Enter는 버리지 않고 패널이 뜨는 틱에 실행한다.
7. 패널을 닫은 직후 · 전환 막이 걷힌 직후 1틱은 에지(`…Down`)를 버린다 — 결과 패널의 연타가 다음 화면에서 포션 · 스킬을 쓰지 않는다(QUALITY §1). 그 동안 **누르고 있던** 키 · 버튼은 닫힌 뒤 「눌림」으로 잡힌다. **리뷰 수정**: 좌클릭은 sim이 누름 에지에서만 의도를 만들고 장면이 바뀌면 의도가 비므로, 전환 막이 걷힌 뒤의 버림(`input.dropEdges(1, {rearm:true})`)은 그 틱에 아직 누르고 있는 좌클릭을 다음 틱의 누름(`lmbDown`)으로 다시 낸다(막 동안 눌렀다 뗀 클릭은 그대로 버린다 · 패널 닫힘은 이어지는 의도가 남아 있으니 다시 내지 않는다). 뗌(keyup)은 창의 캡처 단계에서 먼저 눌림을 푼다(이름 칸처럼 전파를 막는 처리기가 있어도 Shift · 스킬 키 · Alt가 남지 않게) · 타이틀 → play 진입은 눌림을 모두 놓는다.
8. **상점 · 보관함 · 신비술사의 두 영역**: 이 패널들은 인벤토리 패널을 따로 열지 않고 가방 격자(`pnlBagGrid`)를 자기 `el` 안에 그린다. 포커스 영역 둘(왼쪽 재고 · 되사기 · 보관함 · 아이템 목록 / 오른쪽 가방) — 방향키가 격자 · 목록 끝을 넘으면 옆 영역으로, `KeyE`로 직접 바꾼다 · 포커스 영역에 고리. 가방 영역의 `KeyX` 팔기 · `KeyD` 분해 · `KeyF` 옮기기 · `KeyL` 잠금은 그 패널의 `keys`에 넣는다(가방 영역 포커스에서만) · `KeyV` 일괄 판매 · `KeyR` 수리는 어디서나. 키보드만으로 사고 · 팔고 · 고친다(브리프 §3.8).

### 10.6 패널 세부 (P10 · P11)

- **인벤토리**: 왼쪽 장비 10칸(인형 배치) · 오른쪽 가방 6 × 5(**피드백 2 D4** · 옛 8 × 5 — `pnlLogic.BAG_GRID` = core `BAG_SIZE` · `BAG_COLS`) · 정렬 버튼(Z) · 골드 · 재료. 칸을 고르면(마우스 위 · 방향키) **툴팁**. Enter = 장착/해제 · L = 잠금(자물쇠 표시 — 일괄 판매 · 분해에서 빠진다). 상점 · 보관함 · 신비술사에서는 같은 격자(`pnlBagGrid`)가 그 패널 안에 그려지고 X = 팔기 · D = 분해(대장장이) · F = 옮기기(보관함)가 더해진다. 끌어서 놓기(마우스)는 같은 명령.
- **툴팁**(P11 `tooltip.js` · `itemText.js`): 이름(등급색) · 등급 · 기본형(단계) · 기본 값(피해 · aps · 방어도 · 막기) · 옵션 줄(접두 · 접미 · 전설 효과 · 세트 효과와 낀 조각 수) · 요구 레벨(못 끼면 붉게) · 판매가 · 내구도(0이면 붉게 「능력치 꺼짐」). **장착 중인 것과 나란히**(같은 부위 · 반지는 둘 다) + 변화 줄(시트 DPS · 생명 · 방어도 · 저항 넷 — 오름 녹 `#5ad06a` / 내림 적 `#ff6a5a` · `compareEquip`). **고급 툴팁**(`Alt` 누름 · 또는 설정 늘 켜기): 옵션마다 `[T3 16–25]`처럼 티어와 값 범위(pow 옵션은 그 ilvl 배율을 곱한 범위).
- **스킬 트리**: 3갈래 × 4단계 격자 · 노드(이름 · 랭크/최대 · 잠김 사유) · 선택한 노드의 **찍기 전 · 후 수치**(피해 범위 · 비용 · 쿨다운 · 시트 DPS — `describeSkill` 두 번 + `previewLearn` · **피드백 1(ui 단계)**: 범위 스킬은 반경 줄 `skill.radius` 「반경 {n}m」(`describeSkill().radius`) · extra 줄 `skill.x.knock` 「넉백 0.8m」(`extra.knock` — 회전 베기 · 돌진 · `pnlLogic.SKILL_EXTRA_KEYS`) · 회전 베기는 기절 줄이 없다) · 남은 포인트 · Enter = 찍기 · 액티브면 R(우클릭 칸) · 1~4(바 칸)로 배정 · 스킬 바 미리보기. 변형은 대상 액티브에 붙은 작은 노드로.
- **캐릭터 시트**: 주 능력치 · 활력 · 생명 · 자원 · 시트 DPS · 공격 속도 · 치명타 · 방어도(그 레벨 감소율 %) · 저항 넷(감소율 %) · 피해 보너스(종류 · 범위 · 정예) · 쿨다운 감소 · 비용 감소 · 이동 속도 · 적중 회복 · 재생 · 가시 · 골드/아이템 발견(유효 MF 함께) · 경험치 % · 플레이 시간 · 해금 균열.
- **대장장이**: 탭(`[` `]`): 사기(재고 9) · 되사기(최근 10) · 분해(가방의 칸 · 결과 재료 미리보기 · 「일반 전부 분해」 = `salvageMany` 확인) · 제작(부위 고르기 · 비용 · ilvl · **결과 분포**: 옵션 수 `affixCountDist('rare')` · 티어 `tierDist(PL)` · 그 부위 기본형 단계 확률 — 도박의 확률 공개와 비교된다) · 위에 「일괄 수리 R — 비용」(골드가 모자라면 「부분 수리」 — 고칠 수 있는 부위만) · 「일괄 판매 V」(가방의 일반 · 마법 중 `isUpgrade`가 아니고 잠기지 않은 것 → confirm(개수 · 합계 골드) → `sellMany`). 오른쪽에 가방 격자(§10.5-8).
- **잡화상**: 포션 · 두루마리(수량 −/+ · 상한까지 · 가격) · 장신구 재고 4 · 무료 버튼(자격일 때만 보인다) · 「일괄 판매 V」 · 오른쪽에 가방 격자.
- **도박꾼**: 부위 9 · 부위마다 가격(`priceGamble(char, slot)`) · **고른 부위의 등급 확률 표**(`gambleOdds(char, slot)` — 기본 마법 72% · 희귀 24% · 전설 3% · 세트 1% · 그 부위 · 클래스에 전설 · 세트가 없으면 그 몫을 희귀에 더해 보인다) · 결과는 그 자리에서 툴팁 + 비교.
- **신비술사**: 왼쪽 아이템 고르기(가방 · 장착) → 옵션 고르기(이미 고정된 옵션이 있으면 그것만) → 비용(골드 · 가루 · 망각의 정수 — `priceReroll(item).essence`를 그대로 보인다: 식 `rerolls ≥ essenceFrom(3)`이라 그 아이템의 **4번째** 재굴림부터 · W1 확정 · 이번이 n번째) → 「굴리기」 → 후보 3(기존 + 새 둘) 중 고르기(Enter) — 취소하면 비용 없음 · 아래 「스킬 초기화 — 비용」(confirm).
- **보관함**: 왼쪽 보관함 60(10 × 6) · 오른쪽 가방 30(6 × 5) 나란히(**피드백 2** — 옛 위 · 아래 · 넘친 칸 줄이 생겨도 1280 × 720 에 들어간다 · 패널은 왼쪽에 붙는다) · Enter/F로 옮기기 · 정렬.
- **가방 격자 — 피드백 2 D4(넘친 옛 세이브)**: `createBagGrid(ctx, {head?, …})`(P11 `pnlBagGrid.js`)는 `BAG_GRID`(크기 · 열 · 행)를 읽고 `createItemGrid`에 `overflowAt: BAG_GRID.size`를 넘긴다 — 칸 밖(idx ≥ 30)에 아이템이 있으면 그 줄까지 「넘친 칸」(`.cell.is-over` · 붉은 빗금)을 더 그리고(`gridNav.setSize`) 비면 다시 줄인다. 넘친 칸은 꺼내기만(장착 · 팔기 · 옮기기 · 끌기) — 놓는 자리가 아니다(`grid.isOver(i)` · 끌어 놓기 거부). 격자 바로 밑 한 줄 `grid.note` 「가방이 넘쳤다 (n/30) — 정리할 때까지 줍지 못한다」(`inv.overflow` · 든 수 > 30 일 때만) · `opts.head`(영역 머리)는 「인벤토리  n/30」(넘치면 `.is-over`). 같은 문면이 줍기 실패(`PICKUP_FAIL{bagFull}`이고 넘친 가방일 때 — 아니면 `notice.bagFull`)와 캐릭터를 읽은 첫 보이는 프레임(한 번 · 봇 끔)에 알림으로 뜬다(UIRoot). 판정은 순수 `pnlLogic.bagFill(bag, size, cols)` → `{count, over, last, shown, full(= sim isBagFull), overflow(count > size)}`. 마을 패널을 연 채 팔아 칸 안이 비면 넘친 칸의 아이템은 패널을 닫은 뒤 다음 step(`settleBag` — §5.1)에서 칸 안으로 당겨진다(그 사이 넘친 칸은 보이되 「넘쳤다」는 count ≤ 30 이면 내지 않는다).
- **균열석**: 레벨 목록(1 ~ 해금 + 3 · 잠긴 것 회색) · 고른 레벨의 몬스터 레벨 · 생명/피해 배율 · 보상 배율(아이템 레벨 · 등급 · 골드 · 경험치) · 챔피언/정예 속성 수 · 최고 기록 · 「균열 열기 Enter」 · 「클리어 +1 · 무사망 +2 해금」 안내. **기본 포커스**(Enter 한 번이 다음 판): `last = char.records[0]` — 없으면 1 · 완료이고 사망 0이면 `min(riftUnlocked, last.level + 1)` · 붕괴 또는 사망 ≥ 2면 `max(1, last.level − 1)` · 그 밖은 `last.level`(봇 basic의 레벨 규칙과 같은 식 · 「추천」 표시).
- **균열 완료**: 시간 · 처치(등급별) · 사망 · 떨어진 장비(등급별 장비 수 — 주운 것이 아니다) · 골드(**피드백 1**: 문면 「주운 골드」 — `rift.summary.gold` = 수호자 처치 순간까지 이번 판에 실제로 주운 골드 `rift.stats.gold` · 그 뒤 줍는 수호자 보장 드랍의 골드는 들지 않는다) · 경험치 · 그중 더 나은 장비 수(**피드백 2 D5**: 값 옆 흐린 주석 「장비 점수 +3% 넘게」(피드백 2 다듬기: 「이상」 → 「넘게」 — 판정이 초과) — `complete.upgradesNote` · 문턱 = `pnlLogic.upgradeCountGain()` = `COMPARE.upgradeGain` · sim 이 세는 문턱과 같다 §5.13-5) · 다음 레벨 해금(무사망이면 +2 강조) · 최고 기록이면 표시. **리뷰 수정**: 해금 배지는 이번 판이 해금을 실제로 올렸을 때만(UIRoot가 `RIFT_OPENED`에 적은 열 때의 `riftUnlocked`보다 `summary.unlockedTo`가 클 때 · 무사망 배지는 +2가 `max(열 때, L + 1)`보다 더 열었을 때 — `pnlLogic.completeBadges`).
- **사망**: 「쓰러졌다」 · 처치자(`player.killedBy` — 정예면 생성된 이름) · 남은 목숨(0이면 다음 사망 붕괴 경고) · 수리비 · 「Enter — 마을에서 부활」 · 붕괴면 붕괴 문구 + 그 판 요약 · 잃은 것 줄(**리뷰 수정**: 해금 +n은 그 판을 깼다면 새로 열렸을 단계 수 — 이미 열려 있으면 「수호자 보장 드랍 2」만 · `pnlLogic.lostUnlock`).
- **겹쳐 보는 패널의 자리(리뷰 수정)**: 인벤토리는 화면 오른쪽 · 캐릭터 시트는 왼쪽에 붙는다(폭 ≤ 50vw − 30px · 1280 폭에서 가운데의 플레이어를 가리지 않고 둘을 나란히) · 아래에 깔린 쪽도 보이고 누르면 맨 위로(`UIRoot._raiseFrom` — 누름이 게임으로 새지 않는다). 스킬 트리(폭 1000px)는 가운데 그대로다(**피드백 2 D6** — 모달이라 게임이 멈춘 채 어둡게 깐 배경 위).
- **타이틀 · 캐릭터 · 새 캐릭터**: 계속하기(마지막 캐릭터) · 캐릭터 선택(칸 4) · 새 캐릭터(클래스 좌우 · 이름 입력 최대 12자 · 빈 이름이면 기본 이름 · **피드백 1**: 시작 지급 줄 `newChar.kit` — `START.potions` · `START.scrolls`를 읽는다) · 저장 불가 안내 · 터치 기기 안내(§11.12).
- **안내**: 모달 카드 둘 — `town`(시설 안내 + 「균열석을 클릭해 균열 1을 연다 · 좌클릭 이동」) · `controls`(클릭 이동 · 기본 공격 · 우클릭/1~4 스킬 · Shift 제자리 · Q 포션 · T 귀환 · Alt 이름표 · I/S/C 패널 · Tab 지도). 비모달 안내 여섯(`ui.notice(…, {big:true})` · 6초 · 「자세히: 일시정지 → 도움말」) — labels · elites · bagFull · death · skills(「배운 스킬은 빈 칸에 자동으로 놓인다 · S — 스킬 트리(여는 동안 게임이 멈춘다)」 — 피드백 2 D6) · gauge. 각 한 번. **피드백 1(ui 단계)**: `controls` 카드의 Q 줄(`help.controls.3`)은 `hint.controls.potion`(지금 개수 `char.potions` · 회복 `POTION.heal` % · 재사용 `POTION.cd`초)으로 바꾸고 강조한다(`.hint-potion`) · 저생명 포션 안내는 §10.2.

### 10.7 키보드만으로의 조작

모든 패널: 방향키 = 칸/목록 이동 · Enter(또는 Space) = 고르기/주 행동 · Escape = 닫기 · `[` `]` = 탭. 단축키(`PANEL_KEYS` — `data/keybinds.js`): 인벤토리(가방 격자) Z 정렬 · X 팔기 · V 일괄 판매 · D 분해 · F 보관 · L 잠금 · E 영역 바꾸기 / 대장장이 R 수리 / 스킬 R · 1~4 배정 / 잡화상 `+` `-`(Equal · Minus) 수량. 포커스 고리는 늘 보인다. 타이틀 · 사망 · 완료는 Enter 한 번이 주 행동.

### 10.8 문자열 — `data/strings.ko.js` (P10 · P0 시드) · `ui/i18n.js`

- `STRINGS`는 평평한 객체 `{키: 문면}`. 치환은 `{이름}`(`t('reason.level', {n: 12})` → 「레벨 12가 필요하다」). 키 규칙은 부록 B.
- `t(key)`에 없는 키면 키를 그대로 돌려주고 개발 콘솔에 한 번 경고 — `ui.strings.test.js`가 ui · app 소스의 `t('…')` 리터럴과 데이터 행의 모든 이름 키(`mon.<id>` · `affix.<id>.name/desc` · `node.<id>.name/desc` · `base.<id>.<tier>` · `afx.<id>.p/s/line` · `leg.<id>` · `legfx.<id>` · `set.<id>` · `setp.<id>` · `npc.<id>` · `reason.<code>` …)가 있는지 본다.
- W2의 ui 패키지(P11 · P12)가 부록 B에 없는 키가 필요하면 `NOTES-P#.md`에 적고 통합 게이트가 `strings.ko.js`에 더한다(파일 하나 · 소유 P10 — CLAUDE.md 「UI 문면은 한 파일」).
- 숫자 표시(`ui/format.js` · 순수): `fmtInt`(천 단위 쉼표) · `fmtPct(v, d)` · `fmtSec` · `fmtDps` · `fmtRange([a, b])`.

### 10.9 분석 패널 — `ui/analytics/*` (P12)

| 탭 | 내용 | 규칙 |
|---|---|---|
| 드랍 시뮬레이터 | 입력: 균열 레벨 · 몬스터 등급 · 아이템 발견 % · 불운 보정 켬/끔 · 클래스 · 횟수(1천 · 1만 · 10만) · 시드 → 결과: 등급 분포(**이론값 `rarityDist` vs 시뮬값** · 상대 오차) · 부위 분포 · 옵션 수 · 옵션 티어 분포 · 기대 골드 · 「전설 하나까지 처치 수」 히스토그램 | `createDropSim`(P5)을 **조각으로**: `MessageChannel`(없으면 `setTimeout 0`)로 한 조각 = 8ms 안에서 굴릴 수 있는 만큼(시간은 `performance.now` — ui 계층) · 진행 바 · 취소 · 숨은 탭에서도 진행(`requestAnimationFrame`을 쓰지 않는다 — 브리프 §8.6) |
| 표 보기 | 균열 레벨 곡선(`RIFT_LEVELS` · 1~30) · 등급 가중치 · 옵션 풀(가중치 · 티어 범위 · 부위) · 정예 속성 · 몬스터 · 스킬 노드 · 드랍 묶음 · 경제 가격 | 데이터를 그대로(정렬 가능 열) |
| 세션 기록 | `char.records` 표(레벨 · 시간 · 처치 등급별 · 사망 · 드랍 등급별 · 골드 · 경험치 · 업그레이드 · 결과) · 누적 합 · **JSON · CSV 내려받기** | `exporters.js`(순수 — `toJson(records)` · `toCsv(records)`) → `actions.downloadFile(name, mime, text)`(app이 Blob · `a[download]`) |
| 봇 | 「봇 자동 사냥」 켬/끔(`actions.setBot` = `__game.setBot`) · 전략(basic · noDodge · challenge) · 프리셋 · 지금 상태(봇 로그 마지막 10줄) | 켜면 패널을 닫고 관전 |

- **계측 HUD**(`meterHud.js` · 설정 `meterHud`): 왼쪽 작은 표 — DPS(최근 5초) · 받은 피해/초 · 분당 처치 · 시간당 경험치 · 시간당 골드 · 장비(등급별 이번 판) · 균열 경과 · 게이지 속도(%/분) · 동시에 노리는 수. `meterView`(P2)를 0.25초마다 읽는다.
- **W2 확정(P12)**: 봇 탭의 「봇 로그 마지막 10줄」 = 봇이 켜져 있는 동안의 공개 이벤트(BOT · RIFT_OPENED · RIFT_COMPLETE · RIFT_COLLAPSE · PLAYER_DIED · LEVEL_UP · UNLOCK · 마을을 떠날 때 TRADE · EQUIPPED · GOLD 한 줄)로 쓴 관전 기록이다(ui는 봇 인스턴스를 읽지 못한다 — §2.1). 불운 보정 켬의 이론값 = 불운 수 사슬의 정상 분포로 `rarityDist(blp = n)`을 섞은 값(수호자는 처치 단위 사슬) · 판정 색 = |상대 오차| ≤ 3% 또는 |z| < 4 · 이론 1% 미만 칸은 흐리게. 표 보기의 열 이름 = 데이터 필드 이름 그대로. 패널을 닫으면 굴리던 시뮬레이터를 멈춘다(부분 결과는 남는다). 단축키 `PANEL_KEYS.analytics`(§11.5).

---

## §11 app 계약 (P9 · W2)

### 11.1 부트스트랩 — `main.js` · `app/Game.js`

`main.js`는 `new Game(document).start()`만 한다(예외는 `markError`). `Game.start()`의 순서(의존 순서 그대로):

```js
// 0. 오류 수집: window 'error' · 'unhandledrejection' → errors[] · 부팅 표식 전이면 markError(사유)
query    = parseQuery(location.search)                         // §11.7
storageOk = storage.available()
persisted = storage.loadSettings()                              // 정화(SETTINGS_SCHEMA)
settings = {...DEFAULT_SETTINGS, ...persisted}                  // 레이어에 주는 Settings — 이후 같은 객체를 유지(필드만 바꾼다)
dev      = query.dev                                            // 개발용 쿼리가 하나라도 있으면 true(§11.7)
account  = dev ? createAccount() : storage.loadAccount()        // 깨졌으면 백업 뒤 rebuildAccount(칸 0..3의 캐릭터 세이브 — P6 · §11.6) · 알림
seed     = query.seed ?? newSeed()                              // newSeed = (Date.now() ^ (Math.random() * 2**32)) >>> 0 — app에서만
bus      = new EventBus()
sim      = new GameSim({ bus, seed, account, devSession: dev })
try { rc = createRenderContext(canvas, settings) }
catch (e) { ui = 최소 UIRoot ; ui.showFatal('fatal.webglTitle', 'fatal.webglBody') ; markError('webgl') ; return }
world  = new WorldLayer({ rc, bus, settings });  actors = new ActorLayer({ rc, bus, settings });  fx = new FxLayer({ rc, bus, settings })
camera = new CameraRig({ rc, bus, settings })
audio  = new AudioEngine({ bus, settings })
ui     = new UIRoot({ root, bus, sim, settings, actions, view: { project: rc.project } })
input  = new InputCollector({ canvas, bus, ui, rc, keybinds: KEYBINDS })
bus.on(EV.MAP_LOADED, () => { const m = sim.getMap(); world.setMap(m); actors.setMap(m); fx.setMap(m) })
bus.on(EV.TRAVEL_REQUEST, …전환 §11.4) ; bus.on(EV.SAVE_REQUEST, …저장 §11.6) ; bus.on(EV.HITSTOP, …) ; bus.on(EV.PLAYER_SPAWNED, () => camera.snap())
installDebugApi(window, game)
sim.start()                                                      // 레이어가 받는 첫 MAP_LOADED · SCENE_CHANGED
applyQuery(query)                                                // fixture → 캐릭터 → 균열 → 장면 → 패널 → 봇 순서(§11.7)
screen = dev ? 'play' : 'title'  (title이면 ui.openPanel('title'))
loop.start()  →  첫 프레임 렌더 직후 markReady()                 // §11.11
```

### 11.2 `actions`(ui → app)

```js
{ continueGame(), selectChar(slot), newChar({slot, cls, name}), deleteChar(slot),
  openRift(level),            // sim.openRift → TRAVEL_REQUEST가 전환을 탄다
  returnToRift(), respawn(), quitToTitle(), resume(), applySettings(partial), setBot(on, opts),
  downloadFile(name, mime, text) }
```

- `selectChar(slot)`: `storage.loadChar(slot)` → `loadChar`(P6 · 깨졌으면 백업 · 알림 · 새로 만들지 않고 칸을 비운 채 타이틀) → `dedupeItemIds(account, [char])`(바뀌었으면 바로 저장) → `sim.loadCharacter(slot, char)` → screen `play`.
- `newChar`: 덮어쓰기 confirm · 백업은 `account.chars[slot]`이 아니라 **저장소에 `char:<slot>` 키가 있는지**로 판단한다(계정이 깨져 요약이 비었어도 캐릭터를 말없이 덮지 않게) — 기존 키를 백업한 뒤 `sim.newCharacter`.
- `quitToTitle`: 저장(즉시) → `sim.unloadCharacter()`(열린 균열은 닫힌다 — 기록 `abandon` · `RIFT_CLOSED{quit}` · 브리프 §3.1) → title. app이 sim 상태를 직접 고치지 않는다.
- `applySettings(partial)`: `SETTINGS_SCHEMA`로 정화 → `Object.assign(settings, …)` → `SETTINGS_CHANGED` → 250ms 디바운스로 `writeSettings`(devSession에서도 · 슬라이더는 놓을 때) — 쓰기에 실패하면 지속 알림 `notice.settingsUnsaved`.
- `setBot(on, opts)`: §11.13.

### 11.3 화면 상태 기계 · step을 부르는 조건 — `screens.js`

`boot → title ⇄ play` · 어디서든 → `fatal`. `play`에서만 step한다. 그 안에서 step하지 않는 때(§5.12): `ui.isModal()` · 마을이면 `ui.anyOpen()`(봇이 켜져 있으면 보지 않는다 — §11.13) · 일시정지 · 전환 막 · 히트스톱 · 탭 숨김 · 포커스 잃음 · 컨텍스트 잃음. 렌더는 늘 한다(멈춘 화면도 그린다). 마을에서 패널이 열려 step하지 않는 동안의 실제 시간은 `sim.addPlaySec(sec)`로 더한다(플레이 시간 · 측정 — §12.6).

### 11.4 전환 막 · 에지 버림

- `TRAVEL_REQUEST` → 입력 에지 비움 → `FADE{out, f}` → f초 뒤 `sim.commitTravel()`(맵 생성이 막 아래에서) → `FADE{in, f}` — `f` = 0.3초(reason `respawn`만 0.2초 — 재도전 2초 안 §5.10) → 막이 걷힌 뒤 1틱 에지 버림(§10.5-6). 전환 중 step 없음. 탭이 숨어 있으면 바로 commit(타이머가 멈추지 않게 루프의 실제 시간으로 잰다).
- 첫 균열 입장의 셰이더 컴파일은 막 아래에서 `rc.renderer.compile(scene, camera)`로 끝낸다(QUALITY §4).
- **W2 확정(P9)**: 막 아래에서 `commitTravel` **직전에** `ui.closeAll('code')`(사망 · 완료 · 상점 · 균열석 패널이 새 장면에 남지 않게 — commit이 낸 `HINT` 카드는 그 뒤에 열린다). 막이 걷히는 중에 새 `TRAVEL_REQUEST`가 오면(부활 막 아래에서 미리 누른 「Enter — 복귀」) 막을 다시 내리고 그 끝에서 commit한다 · 막 없이 남은 `pendingTravel`은 다음 프레임에 막을 내린다.

### 11.5 입력 — `input.js` · `data/keybinds.js`

```js
export const KEYBINDS = { skill: ['Digit1', 'Digit2', 'Digit3', 'Digit4'], stand: ['ShiftLeft', 'ShiftRight'], potion: 'KeyQ', recall: 'KeyT',
  labels: ['AltLeft', 'AltRight'], inventory: 'KeyI', skills: 'KeyS', character: 'KeyC', map: 'Tab', analytics: 'Backquote', pause: 'Escape',
  confirm: ['Enter', 'NumpadEnter', 'Space'], up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', tabPrev: 'BracketLeft', tabNext: 'BracketRight' };
export const PANEL_KEYS = { inventory: { sort: 'KeyZ', sell: 'KeyX', sellAll: 'KeyV', salvage: 'KeyD', stash: 'KeyF', lock: 'KeyL', area: 'KeyE' }, blacksmith: { repair: 'KeyR' },
  skills: { bindRmb: 'KeyR' }, general: { more: 'Equal', less: 'Minus' },
  analytics: { cancel: 'KeyX', json: 'KeyJ', csv: 'KeyC' } };   // W2 확정 — analytics(P12의 시뮬레이터 취소 · 내려받기)
export const MOUSE = { move: 0, skill0: 2 };   // event.button
```

- 키는 `event.code`로만(한글 IME). `Ctrl` · `Meta` · `Alt` + 다른 키 조합은 건드리지 않는다(기본 동작도 막지 않는다). `Alt` 단독은 keydown/keyup의 기본 동작을 막아 메뉴 포커스를 막는다. **리뷰 수정**: Alt(이름표)를 누른 채 게임 키(Q · T · 1~4)를 누르면 조합이라 게임 입력이 아니다 — 대신 알림 `notice.altBlocked`를 Alt 한 번 누름에 한 번(play · 봇 아님 · 모달 없음). 제자리(Shift)는 마우스 이벤트의 `shiftKey`로도 읽는다(Alt를 누른 채 누른 Shift의 keydown은 조합이라 버려진다 · `shiftKey: false`면 남은 Shift 눌림을 푼다).
- 게임 중 막는 기본 동작: 우클릭 메뉴(`contextmenu`) · `Tab` · `Space` · 방향키 스크롤 · 휠(캔버스 위 · `passive:false`) · 옆 버튼(3 · 4).
- 매 프레임: 마우스 화면 좌표 → `rc.rayFromScreen` → `cursor = rc.groundAt`(캔버스 밖이면 null) → `hover = (이름표 켬(Alt · 늘 이름표) ? ui.labelHover() : null) ?? pickHover(state, map, ray, {kinds:['monster']}) ?? ui.labelHover() ?? pickHover(state, map, ray, {kinds:['drop', 'object']})` — 광선이 몬스터 원기둥과 만나면 이름표보다 몬스터가 앞선다(떼 속 좌클릭 공격이 줍기로 바뀌지 않게) · Alt를 누르고 있을 때만 이름표가 앞선다. 이름표에서 온 것은 `src:'label'`, 광선은 `src:'pick'`. 휠 → `camera.zoom`.
- 에지는 다음 step이 가져갈 때까지 모은다(§3.2) · `frame()`이 InputFrame을 만들고 에지를 비운다.
- 포커스를 잃거나 탭이 숨으면 눌린 키 · 버튼을 전부 놓고 일시정지(`PAUSED{blur|hidden}`) · 돌아오면 일시정지 패널이 떠 있다(시간 폭주 없음 — 루프의 dt 상한).
- 첫 사용자 제스처(키 · 클릭)에서 `audio.unlock()` → `AUDIO_UNLOCKED`.
- 포인터 락은 쓰지 않는다(커서 게임 — 브리프 §6).

### 11.6 저장 — `storage.js`

- 키: `SAVE_KEYS`(§6.1). `available()`(쓰기 · 지우기 시험) · `loadSettings()` · `writeSettings(s)` · `loadAccount()` → `loadAccount(raw)`(P6) · `writeAccount(state)` · `loadChar(slot)` · `writeChar(char)` · `writeCharAndAccount(state, char)`(피드백 2 다듬기 — 아래 「쓰기 순서」) · `backup(key)`(`backupPrefix + key + ':' + ms` · 키마다 최신 3개 · 목록 `backupPrefix + 'index'`) · `removeChar(slot)`(백업 뒤).
- **시점**: `SAVE_REQUEST{scope, reason}` → 그 프레임 끝에 한 번 쓴다. **캐릭터를 쓸 때는 계정도 같이 쓴다**(scope 'char'도 — `account.nextItemId` · 캐릭터 요약이 낡지 않게: 다시 읽은 뒤 새 아이템 ID가 가방 · 보관함의 ID와 겹치지 않는다). 캐릭터 저장은 최소 1초 간격으로 묶되 reason ∈ {scene, death, complete, collapse, new, delete, quit, trade}이면 바로(`trade` = 사기 · 도박 · 재굴림 · 제작 — 결과를 되돌리는 세이브 스컴 틈을 막는다). 탭 숨김 · `pagehide`에서는 캐릭터가 있고 dev가 아니면 **무조건** 캐릭터 + 계정을 쓴다(밀린 것이 없어도 — 경험치 · 플레이 시간). 브리프 §4의 시점(줍기 · 장착 · 거래 · 스킬 · 레벨업 · 장면 전환 · 균열 완료/붕괴 · 사망)은 §4.2의 발행 규칙이 덮는다.
- **피드백 2 다듬기 — 쓰기 순서(캐릭터 + 계정 한 쌍)**: 캐릭터를 쓰는 모든 길(`_flushSaves` · `_saveNow`)은 `storage.writeCharAndAccount(state, char)` — **계정 먼저** → 캐릭터. 계정 쓰기가 실패하면 캐릭터를 쓰지 않는다(둘 다 옛 세이브) · 캐릭터 쓰기가 실패하면 계정을 쓰기 전 값으로 되돌린다(둘 다 옛 세이브 — 옛 키가 없었으면 지운다). 보관함을 오간 아이템(넣기 · 꺼내기 · 바꾸기 · 붙일 때 칸 밖 → 보관함)이 어느 세이브에도 없는 순간이 생기지 않는다(옛 순서 캐릭터 → 계정은 계정 쓰기가 실패하면 보관함으로 옮긴 것을 잃었다 — 검증자 실측). 되돌리기마저 실패하면 계정만 새 것 — 넣은 것은 많아야 복제(다시 읽을 때 `dedupeItemIds`가 새 ID) · `nextItemId`는 캐릭터의 아이템 번호보다 뒤처지지 않는다. `scope: 'all'`(보관함 · 캐릭터 생성 · 「타이틀로」)은 1초 간격을 기다리지 않고 그 프레임에 한 쌍으로 쓴다(전에는 계정만 먼저 쓰고 캐릭터를 1초 뒤로 미뤄, 그 사이 꺼낸 아이템이 어느 세이브에도 없었다). `app.game.test` · `app.storage.test`.
- `devSession`이면 읽지도 쓰지도 않는다(설정만 예외 — 설정은 세이브가 아니다).
- **리뷰 수정 — 저장하지 않게 바뀌는 세션**: `persist() = !dev && storageOk && !readOnly && !botSandbox && !staleTab`. ① 보통 세션에서 봇을 켜면(§11.13) 켜기 직전에 한 번 쓰고 `botSandbox`(지속 알림 `notice.botNoSave`). ② 다른 탭이 이 저장소의 계정 · 캐릭터 키를 쓰면(window `storage` 이벤트 — 키 접두사로 거른다 · 이벤트는 ~1초 늦게 온다) 또는 쓰기 직전 저장소의 계정 `savedAt`이 이 탭이 마지막으로 읽거나 쓴 값보다 새로우면 `staleTab`(지속 알림 `notice.otherTab` · 쓰지 않는다 — 오래된 메모리 상태로 그 탭의 진행을 덮지 않게). ③ 저장하지 않는 세션에서 「타이틀로」 때 떼어 낸 캐릭터는 칸별로 메모리에 두고 같은 세션의 `selectChar` · `continueGame`이 다시 붙인다(새 캐릭터 · 삭제는 그 칸을 버린다).
- localStorage가 막혀 있으면 타이틀 · HUD에 지속 알림 「저장되지 않는다」 · 플레이는 그대로.
- **피드백 2 D4 — 옛 세이브의 가방(40칸 시절)**: 정화(`sanitizeChar` · P6)는 가방 31~40번째 · 장착에서 밀려난 것을 버리지 않는다 — 칸 안 빈자리, 없으면 칸 밖(가방 배열 끝 · idx ≥ BAG_SIZE · 읽는 칸 수 상한 200). 붙일 때(`loadCharacter`) 보관함 빈칸으로 옮기고 `SAVE_REQUEST{all, stash}` — 둘 다 차면 칸 밖에 남는다(ui 는 넘친 칸 줄 · 「가방이 넘쳤다」 — §10.6). 사라지는 아이템 0(`feedback2.test`).
- 깨진 세이브: 계정 → 백업 → `rebuildAccount`(P6 — 칸 0..3의 캐릭터 세이브로 `chars` 요약 · `nextItemId = 최대 + 1` · 보관함은 빈 채) · 알림 `notice.accountRebuilt` / 캐릭터 → 백업 → 그 칸 비움 · 알림. 세이브의 `v`가 미래 버전이면 덮어쓰지 않고 읽기 전용 안내.

### 11.7 개발용 URL 쿼리 — `query.js`

| 쿼리 | 뜻 |
|---|---|
| `?fresh=1` | 세이브를 읽지도 쓰지도 않는 일회용 세션(`dev`) — 타이틀 없이 「새 캐릭터」 화면 |
| `?class=warrior\|mage` | 그 클래스의 개발용 캐릭터로 바로 마을(`dev`) |
| `?level=n` | 그 레벨 · 스킬 포인트 · 프리셋 빌드(`?preset=0\|1`) — `makeDevCharacter` |
| `?rift=n` | 균열 n을 바로 연다 · 해금 n · 그 레벨에 맞춘 무작위 장비 자동 장착 |
| `?seed=n` | 세션 시드(균열 시드도 여기서 파생) |
| `?scene=town\|rift` | 시작 장면(rift면 `?rift` 없을 때 균열 1) |
| `?panel=<PanelId>` | 그 패널을 바로 연다(필요한 상태가 없으면 고정 상태를 함께 — 예: 상점 패널은 마을) |
| `?fixture=<id>` | 고정 상태(§11.9) — 다른 쿼리보다 먼저 |
| `?bot=1` | 봇 켬(`?strategy=basic\|noDodge\|challenge`) |
| `?analytics=1` | 분석 패널을 연다 |

`?panel` · `?analytics`만 있으면 `dev`가 아니다(세이브를 쓴다). 그 밖의 쿼리가 하나라도 있으면 `dev`. **W2 확정(P9)**: 캐릭터 상태가 필요한 패널(상점 · 보관함 · 균열석 · 인벤토리 · 스킬 · 캐릭터 · 사망 · 완료 · 지도)을 `?panel`로만 주면 고정 상태(`PANEL_FIXTURE` — `src/app/query.js`)를 띄우고 그때만 `dev`(고정 상태 캐릭터가 실제 세이브 칸에 쓰이지 않게) · 타이틀 · 설정 · 도움말 · 분석은 보통 세션. 모르는 쿼리 키는 `dev`로 바꾸지 않는다. `?class` 단독은 `createCharacter`(시작 장비) · `?level` 또는 `?rift`가 있으면 `makeDevCharacter` · `?scene=town`이면 `?rift`가 있어도 마을(해금만 n). README 첫 화면 「바로 해 보기」(P9): `/?class=warrior&level=18&rift=10` · `/?class=mage&level=20&rift=12&preset=1` · `/?fixture=riftAffixes` · `/?fixture=riftLoot` · `/?class=warrior&level=24&rift=18&bot=1` · `/?analytics=1`.

### 11.8 디버그 API — `window.__game` (`debugApi.js`)

| 메서드 | 뜻 |
|---|---|
| `getState()` | 살아 있는 상태 참조(읽기 · 고정 상태 실험용 · 고치면 책임은 부른 쪽) |
| `pause(on)` | 일시정지(패널 없이 — 화면 확인) · Promise |
| `step(n = 1)` | n틱 step(멈춘 상태에서도) → 렌더 → Promise(그 프레임이 그려진 뒤) |
| `setBot(on, opts)` | 봇 켬/끔(`opts = {strategy, preset}`) |
| `errors()` | 수집한 오류 목록(문자열) |
| `screen()` · `panel()` | 지금 화면 · 맨 위 패널 |
| `openPanel(id, args)` · `closePanel()` | |
| `loadFixture(id)` | §11.9 |
| `gotoTown()` · `openRift(level, seed?)` · `completeRift()` | 전환까지(막 없이 바로) |
| `spawnPack(monsterId, rank = 'normal', affixIds = null)` | 플레이어 앞 6m |
| `killAll()` · `revealMap()` · `setInvincible(on)` | |
| `grant({gold, xp, materials, items})` | items = 등급 이름 배열(`['legendary', 'set']`) 또는 Item |
| `dropItem({rarity, slot, ilvl})` | 플레이어 앞 바닥에 |
| `setLevel(n)` · `setRiftUnlocked(n)` · `resetSkills()` | 레벨 · 해금 바꾸기 · 스킬 초기화(무료 — 브리프 §3.3) |
| `rollDropsSample(opts)` | `createDropSim(opts).run(opts.n ?? 1000)`의 결과 |
| `hash()` | `hashState(state)` |
| `memory()` | `{rc: rc.stats(), dom: document.querySelectorAll('*').length, listeners: bus.count(), audio: audio.stats()}` |
| `stats()` | `sim.getStats()` |

- **W2 확정(P9)**: 더한 것 — `sim`(지금 GameSim) · `actions`(ui와 같은 actions — 화면 확인 스크립트가 타이틀 · 새 캐릭터 · 부활을 ui와 같은 길로). `step(n)`은 전환 막이 진행 중이면 그 틱만큼 막만 진행하고(그동안 sim은 step하지 않는다) 봇이 켜져 있으면 봇 입력을 쓴다 · 모달 패널이 열려 있어도 step한다(디버그 — 실제 루프는 §11.3대로 멈춘다).

### 11.9 고정 상태 — `debug/fixtures.js` (P0 완성 · `?fixture=<id>` · `__game.loadFixture`)

`FIXTURES[id] = (seed) → {state, map, riftMap}` — 맵은 `fixtureMap.js`의 ASCII로(타일셋 지정), 아이템은 `makeItem`(P5 — W0에 완성)로. 모든 고정 상태는 §3 모양 그대로(`fixtures.test.js`). 아래 표의 **15개**(W0 스캐폴드 확정 — 앞선 「14개」 표기는 표와 어긋났다). 마을 맵은 debug가 `data/town.js`로 직접 만든 것(`townMapFromData` — debug는 `townMap.js`를 import하지 못한다)이라, app은 화면에 띄울 때 `buildTownMap()`으로 바꿔 넘긴다(최소 부트가 그렇게 한다).

| ID | 무엇 | 쓰는 패키지 |
|---|---|---|
| `town` | 마을 · 전사 레벨 12 · 열린 균열(포털 켜짐) · 복귀 안내 | P7 · P8 · P10 |
| `riftSwarm` | 지하 묘지 방 · 전사 가르기(`bash` — 피드백 1 · 옛 강타) 판정 직후 · 일반 8종 + 새끼 40마리(걷기 · 예비 · 판정 · 경직 · 기절 · 빙결 · 사망 · 날아가는 시체 섞임) | P8 · P13 |
| `riftElites` | 잿빛 동굴 · 챔피언 팩(파랑 · 속성 2) + 정예(노랑 · 속성 4) + 하수인 4 · 대상 프레임 hover | P8 · P10 · P13 |
| `riftAffixes` | 정예 12마리가 줄지어 각 속성 하나 + 그 효과(감옥 원 · 역병 웅덩이 · 몰타르 예고 · 냉기 노바 예고 · 보호막 구체 · 사라짐 · 불꽃 · 화염 사망 원) | P13 · P16 · P10(도움말 대조) |
| `riftGuardian` | 뼈 거인 대지 분쇄 예고 중 · 수호자 바 | P8 · P13 · P10 |
| `riftWitch` | 잿빛 마녀 잿불 비 예고 + 하수인 | P8 · P13 · P16 |
| `riftWarrior` | 전사 회오리 채널 중 · 지진 파동 · 연속 회전 대기(피드백 1 — `spinEcho` 원 r 2.5 · `follow:'player'` · 판정 7틱 전 · 옛 지면 강타 원뿔 `stomp` r 4.0 · 120°) · 도약 공중 · 전투 함성 버프 | P8 · P13 |
| `riftMage` | 마법사 화염구 · 메테오 예고 · 서리 노바 · 연쇄 번개 꺾은선 · 마력 보호막 · 순간이동 직후 | P8 · P13 |
| `riftLoot` | 드랍 전 등급(전설 · 세트 빛기둥) · 골드 더미 3단계 · 포션 · 구슬 · 재료 · 이름표 겹침 | P8 · P10 |
| `riftDeath` | 플레이어 사망(생명 1 남음) · 사망 패널 | P10 |
| `riftComplete` | 완료 단계 · 나가는 포털 · 요약 | P7 · P10 |
| `bag` | 마을 · 가방 38개(전 등급 · 부서진 장비 · 못 끼는 레벨 · **피드백 2**: 30칸 + 칸 밖 8 — 넘친 옛 세이브 화면 · 고정 상태는 `loadCharacter`의 보관함 이동을 거치지 않는다) · 장착 10 · 보관함 20 | P11 |
| `shops` | 마을 · 상점 재고 · 되사기 5 · 재굴림 제안 진행 중 · 골드 · 재료 | P11 |
| `skillTree` | 마법사 레벨 18 · 프리셋 B 중간까지 · 포인트 3 남음 | P11 |
| `lowLife` | 전사 생명 20% · 감속 · 속박 · 귀환 시전 중 · 저생명 | P10 · P13 |

### 11.10 최소 부트 — W0의 `src/main.js` (P0이 쓰고, W2에서 P9가 `Game`으로 교체)

- 스텁 위에서 돈다: `EventBus` → `GameSim`(`seed` = `?seed` 또는 1 · `devSession: true`) → `sim.start()` → `?class`(기본 warrior)로 `sim.loadCharacter(0, createCharacter(...))`(P6 — W0 완성) → `?scene=rift`면 main.js가 `generateRift(seed, 1)`(스텁 맵) · `createRiftState` · `populateRift`(스텁 — 잠든 구울 팩)로 균열 상태를 직접 세워 `sim.debugLoadState(state, riftMap, riftMap)`(지금 장면이 균열이니 map = riftMap) → `createRenderContext` → **§11.1의 생성 순서 그대로 모든 레이어를 계약 deps 전부로**(`WorldLayer` · `ActorLayer` · `FxLayer` · `CameraRig` · `AudioEngine` · `UIRoot`) → rAF 누산 루프(§5.12) — 매 프레임 §9.1의 순서로 `update` → 첫 렌더 뒤 `markReady()`. W1에서 각 패키지가 자기 레이어를 채우면 최소 부트에 그대로 뜬다(main.js를 고치지 않는다).
- 입력: `main.js` 안의 최소 수집기 — 좌클릭 · 우클릭 · Digit1~4 · Shift · Q · T · Escape(`ui.handleKey` 먼저) · 마우스 위치 → `rc.groundAt` → `makeInput()`.
- `window.__game`: `getState` · `pause` · `step` · `errors` · `screen`(`'play'`) · `openPanel` · `closePanel` · `loadFixture` · `setBot`(no-op) · `hash` · `memory`.
- 쿼리: `?fixture` · `?panel` · `?class` · `?scene` · `?seed` · `?fresh`(무시 — 저장하지 않으니까).
- 예외 · WebGL 실패 → `markError(사유)`.

### 11.11 부팅 표식

- `src/app/bootMarker.js`(P0 완성 · 아무도 고치지 않는다)의 `markReady()` · `markError(reason)`만 `document.documentElement.dataset.gameReady/gameError`를 쓴다. **진입점을 다시 써도 이 두 호출은 남는다**: P9의 `Game.start()`는 첫 프레임(타이틀이든 play든 — 뒤에 마을이 그려진 상태)을 그린 직후 `markReady()`, 부팅 실패(WebGL · 생성자 예외 · 첫 프레임 전의 잡히지 않은 예외)에서 `markError`.
- `purity.test.js`가 확인한다: `src/main.js` 또는 `src/app/Game.js`가 `bootMarker.js`에서 `markReady` · `markError`를 import 한다 · 그 밖의 파일에 `dataset.gameReady` · `dataset.gameError` 문자열이 없다.
- `check:dist`: 사용자 입력 없이 실제 20초 안에 `data-game-ready="1"` · 잡히지 않은 예외 0.

### 11.12 견고성

| 상황 | 동작 |
|---|---|
| WebGL 생성 실패 | `ui.showFatal` 안내 · `markError('webgl')` · 루프 시작 안 함 |
| `webglcontextlost` | 일시정지 + 지속 알림 · `webglcontextrestored`에서 레이어 `setMap`으로 다시 짓고 알림을 내린다 · 일시정지 패널에서 「계속」으로 돌아간다 |
| localStorage 막힘 | 타이틀 · HUD 지속 알림 · 저장 없이 플레이 |
| 터치 기기(`matchMedia('(pointer: coarse)')` 이고 마우스 없음) | 타이틀 안내 「키보드와 마우스가 필요하다」 |
| 탭 숨김 | 일시정지 · `audio.setPaused(true)` · 밀린 저장 |
| 같은 판 반복 | `__game.memory()`의 지오메트리 · 텍스처 · DOM · 리스너 · 오디오 노드 수가 늘지 않는다(§12.4 S6) |

### 11.13 봇 구동 (P9 · 브라우저)

- `actions.setBot(on, {strategy, preset})` · `__game.setBot` · `?bot=1`: 켜면 `new Bot({sim, strategy, cls: char.cls, preset, seed, autoCommit: false})` → `BOT{on:true}` · 분석 패널 봇 탭에서 켰으면 그 패널은 닫는다.
- 봇이 켜져 있으면 루프는 매 틱 `input = bot.frame()`(사람의 입력과 에지는 버린다) → `sim.step(input)` → `bot.afterStep()`을 돈다. `autoCommit: false`라 afterStep은 `commitTravel`을 부르지 않고 app의 전환 막(§11.4)이 commit한다(두 번 commit하지 않는다).
- 봇이 켜져 있는 동안 ui는 `INTERACT` · `HINT` · `PLAYER_DIED` · `RIFT_COMPLETE`로 패널을 열지 않는다(§10.2) · step 조건은 「마을이면 `ui.anyOpen()`」을 보지 않는다 — 사람이 연 일시정지 · 분석 패널(모달)만 멈춘다. 봇은 사망하면 `sim.respawn()` → 마을에서 `sim.returnToRift()`를 직접 부른다(사람의 Enter와 같다) · 거래는 `INTERACT`를 받은 뒤 명령으로.
- 끄면 `BOT{on:false}` · 그 틱부터 사람 입력 · ui가 상태에 맞는 패널(사망 · 완료)을 연다.
- **리뷰 수정**: 보통 세션(`persist()`)에서 봇을 켜면 켜기 직전의 진행을 바로 쓰고 그 세션은 저장하지 않는다(§11.6 — 봇은 잠기지 않은 가방 장비를 팔고 남은 스킬 포인트를 찍는다 · 실제 세이브는 봇 전 그대로 · 봇을 꺼도 새로 고칠 때까지 저장하지 않는다). 분석 패널 봇 탭 문면이 이를 알린다.
- **W2 확정(P9)**: 봇이 켜져 있으면 창 포커스를 잃어도 일시정지 패널을 띄우지 않고 멈추지 않는다(관전 중 다른 창을 눌러도 돈다) · 탭 숨김은 멈춘다. 봇이 켜져 있어도 멈추게 하는 모달 = `BOT_HALT_PANELS`(pause · settings · help · confirm · analytics · 타이틀 계열 — `src/app/screens.js`).

---

## §12 봇과 테스트 계획

### 12.1 봇 행동 규칙 (P15 · `src/bot/*` · 수치는 `data/bot.js`)

- **사람처럼**: 매 틱 `InputFrame` 하나(커서 = 노리는 월드 점 · hover = 노리는 대상 — sim의 대상 검사 §5.2-1을 통과해야 한다). 마을 거래는 NPC 앞까지 걸어가 `INTERACT`를 받은 뒤에만 그 상점의 명령을 부른다(사람이 패널을 연 것과 같다). 전환은 `pendingTravel`이 서면 `commitTravel()`(`autoCommit` — 브라우저에서는 app의 막이 한다 · §11.13).
- **보는 것**: 플레이어에서 `viewR`(11.4m — 기본 카메라 화면에 보이는 거리 §9.3 · 사람보다 많이 보지 않는다) 안의 몬스터(위치 · 등급 · 속성 · 생명 비율 · `act` · `aim` · `aimLocked`) · 효과(모양 · `start` · `hitAt` · `hostile`) · 투사체 · 드랍 · 포털 · 탐색한 타일 · 맵의 방/통로 배치(미니맵 · 큰 지도로 보이는 것 — 몬스터 배치는 아니다) · 자기 시트 · 데이터 표. **보지 않는 것**: 몬스터의 `ax`(훅 타이머) · `readyAt` · 잠든 팩 위치 · 난수 상태.
- **반응 지연**: 새 자극(적대 예고 시작 · 생명 하락 · 새 대상)에 대한 결정은 `react ~ N(reactSec 0.30, reactSd 0.08)`을 [0.1, 0.5]로 자른 뒤에 한다(틱으로 · 밸런스 게이트 「보통 사람」 — 옛 0.22 · 0.06 · [0.1, 0.4]).
- **실수**: 클릭의 `missClick`(4% — 밸런스 게이트 · 옛 2%)은 커서를 1m 안에서 흐트린다 · 적대 예고를 알아챌 확률 `dodgeNotice`(0.85 — 밸런스 게이트 · 옛 0.9 · 무회피 전략 0) — 알아챔은 **공격 한 번(출처 · 시작 틱이 같은 예고 묶음)에 한 번** 굴린다(잿불 비 원 다섯을 따로 굴리면 다섯 중 하나는 늘 놓쳤다).
- **피하기**: 알아챈 적대 예고가 플레이어 자리(+0.5m 여유)를 덮고 `hitAt − 지금 ≤ 걸어 나가는 시간 + 0.2초 + 자기 동작의 남은 잠김 + dodgeLead 0.8초`면 — 16방향 × 1~7m 표본 중 걷기 가능하고(직선으로 닿고) 진행 중인 모든 적대 예고 밖(몸 + 0.3m · 그런 점이 없으면 몸만)이며 **정예 · 챔피언 · 수호자 · 구조물의 몸을 지나지 않고 · 지금 서 있지 않은 다른 예고를 가로지르지 않는** 점 중 대상에 가까운 점으로 이동(좌클릭 땅). 걸어서 못 나가면 이동 스킬(도약 · 순간이동 · 돌진)을 그 점으로. (밸런스 게이트 — 옛 「12방향 × 2~5m · 걸어 나가는 시간 + 0.2초」는 그 사이 새 공격의 잠김에 걸려 감옥 70% · 화염 강화 폭발 55~100% 를 맞았다 · 수치는 `BOT_RULES.dodge*`.)
- **대상**: 점수 = `priority[종류 또는 등급] / 거리` (주술사 5 · 둥지 4 · 정예 3 · 챔피언 2 · 일반 1) · 대상이 죽거나 12m 넘게 멀어지거나 `chaseGiveUpSec`(6초) 동안 못 때리면 다시 고른다.
- **스킬 — 가능한 한 모든 수단**: 바의 스킬을 **동작(behavior)별 사용 규칙**으로 쓴다(노드 ID가 아니라 — 무작위 배분 빌드도 같은 규칙으로 돈다):

| 동작 | 쓰는 때 |
|---|---|
| spinSlash(**피드백 1** — 옛 cone 「전방 4m 원뿔 안 ≥ 2마리 또는 정예 대상」) | 원(행의 radius 2.5 − `inner` 0.5 = 2.0 · 몸 반지름 포함) 안 ≥ 2마리 또는 정예급 대상이 그 안 · 분노 ≥ 비용 + `rageKeep`(0) — 등 뒤도 센다. inner: 판정(시작 + 0.3초)까지 물러서는 적(궁수 · 주술사 뒷걸음)이 원 밖으로 나가 헛돌았다(첫 판 챔피언 궁수 팩 72~148초) · 수치는 `BOT_RULES.spinSlash` |
| quake | 6m 안 ≥ 5마리 또는 정예/수호자 6m 안 |
| dash | 대상이 6~10m · 또는 피하기 이동 |
| spin | 2.4m 안 ≥ 2마리(**피드백 1** — 옛 3) · 분노 ≥ 30 — 누르고 있는 동안 커서는 가장 촘촘한 쪽. 바에 회오리가 있으면 다른 분노 스킬(회전 베기)은 비용 + 30 이 있을 때만(`channelReserve` — 회오리는 분노당 피해가 회전 베기의 ~3배인데 회전 베기가 분노를 먼저 써 회오리가 거의 시작되지 않았다 · 프리셋 B) |
| buff | 전투 중(10m 안 깨어 있는 몬스터) · 준비됨 |
| leap | 대상 6~9m · 또는 피하기 · 또는 정예 팩 한가운데(정예 · 챔피언 · 하수인 무게중심의 `leap.packR` 4m 안 ≥ 2 — 피드백 1: 옛 `cone.range`를 빌려 쓰던 값) |
| fireball | 대상 · 자원 충분(마나 > 비용 + 20 — 보호막 여유) |
| meteor | 3.5m 안에 4마리 이상 모인 점 또는 정예 · 수호자 — **피드백 2 D8**: 플레이어 자리에서 벽 타일에 가려지지 않은 대상만(`Situation.visible(x, z)` · bot.js 가 `losClear`로 채운다 · 없으면 늘 참 — sim 이 가려진 목표를 이쪽 벽 앞에서 자르므로 헛친다) |
| nova | 5m 안 ≥ 3마리 |
| shield | 전투 중 · 생명 < 70% |
| chain | 대상 15m 안 |
| blink | 근접 종 `kiteCount`(3) 이상이 `kiteFrom`(4m) 안 → 반대쪽 10m · 또는 피하기 |

  기본 공격은 위의 어느 것도 아닐 때(분노 · 마나가 모자랄 때 포함). 마법사는 근접 종 3마리 이상이 4m 안이면 뒷걸음질(카이팅) 먼저.
- **생존**: 생명 < `potionAt`(40%)면 포션 · 생명 < 70%이고 8m 안에 구슬이 있고 그 길에 적대 예고가 없으면 구슬로.
- **줍기**: 10m(`lootSafeR`) 안에 깨어 있는 몬스터가 없을 때 12m(`lootRadius`) 안의 장비를 전부(전설 · 세트 · 희귀 먼저) 줍는다 · 주운 장비는 `compareEquip`로 바로 비교해 `equipMinGain` 넘게 좋으면 장착. **리뷰 수정**: 화면 안 드랍은 닿는 것만 고른다(흐름장 걸음 수 ≤ 직선 칸 × `reachMul` + `reachPad` — 몬스터 대상과 같은 규칙) · 쫓던 드랍은 화면(`viewR`) · `lootRadius`를 `lootMemoryPad`만큼 넘어도 그대로 고른다 · 드랍 ID 시계와 따로, 줍기를 이어 가는 동안 바닥 드랍 수가 `lootGiveUpSec` 넘게 줄지 않으면 지금 것을 버린다(`bot.lootStall`) — 벽 너머 긴 우회의 마법 드랍과 바로 닿는 일반 드랍을 6틱마다 번갈아 눌러 균열에 영영 멈췄다(`bot.test`).
- **가방**: 가방이 차서 줍지 못한 장비가 있고 두루마리가 있으면 귀환 → 마을 정비 → 포털로 복귀(`rift.stats.bagFullRecall`).
- **탐색**: 탐색하지 않은 가장 가까운 방 가운데로(방/통로 그래프) · 게이지 100%면 수호자 자리로(**피드백 1**: 수호자가 탐색한 칸에 있으면 — 미니맵의 수호자 점 — 그 자리로. 출현 자리에서 멀리 쫓아온 뒤 잠든 수호자를 출현 자리에서 영영 기다렸다 · 빌드 비교 1/150판 20분 포기) · 완료 뒤 남은 장비를 줍고 나가는 포털.
- **사망**: 반응 지연 뒤 Enter(부활) → 마을에서 Enter(복귀).
- **마을 정비**: 대장장이 → 가방 전부 팔기(`sellMany` · 장착 후보로 남길 것 없음) → 일괄 수리 → 잡화상 → 포션 `potionsTo`(10) · 두루마리 `scrollsTo`(5)까지 → 스킬(프리셋 순서대로 남은 포인트) → 균열석 → 레벨 선택 → 열기. 도박 · 재굴림 · 제작 · 보관함은 쓰지 않는다(측정의 한계 — §12.6). 상점마다 명령 뒤 `BOT.townSec`(대장장이 20 · 잡화상 8 · 균열석 4초)만큼 마을에서 서서 step한다(사람이 패널을 보는 시간의 모델 — `playSec`에 들어간다).
- **레벨 선택**(전략): `basic` — 첫 판 1 · 직전 판이 완료 · 사망 0 · `timeSec ≤ upMaxSec`(360)이면 +1(해금 안에서) · 사망 ≥ `downDeaths`(2) 또는 붕괴면 −1(최소 1) · 그 밖은 같은 레벨 / `noDodge` — basic과 같고 피하지 않는다 / `challenge` — 늘 해금된 최고. 「적정 레벨」 = basic이 고르는 레벨.
- **결정성**: 봇의 난수는 자기 `{s}`(생성자의 seed) — sim의 줄기를 쓰지 않는다.
- **W2 확정(P15)**: 마법사 카이팅 = 몰려들면(근접 종 `kiteCount` 이상이 `kiteFrom` 안) **한 번** `kiteSec`(0.5초) 물러서고 그 자리에서 싸운다 · 몰림이 `kiteRearmSec`(1초) 풀린 뒤에야 다시 · 최소 간격 `kiteGapSec`(1.5초) · 보이는 잠든 몬스터 14m 안으로는 물러서지 않는다(문자 그대로 매번 물러서면 화력을 잃었다 — 균열 1 7.3~9.2분 → 5.0~6.5분). 깨어 있는 몬스터가 화면에서 사라진 뒤 `fightMemorySec`(4초) 동안 마지막으로 본 자리로 돌아선다. 봇은 자기 플레이어의 `readyAt` · `potionReadyAt` · `actEnd`(HUD 쿨다운 · 자기 동작)와 미니맵에 보이는 장비 드랍(40m)을 읽는다. 수치는 `BOT_RULES`(`data/bot.js`).
- **밸런스 게이트 확정(NOTES-BALANCE)**: 「보통 사람」 설정(위 반응 · 실수 · 알아챔)이 측정 기준이다. 가방이 차도 수호자 단계에서는 귀환하지 않는다(원거리 마법사가 `lootSafeR` 밖에서 보스와 싸우다 귀환했다). 화면 밖 장비(미니맵 · `lootMemoryR` 40m)는 쫓던 것이면 `lootMemoryPad`(8m) 더 멀어도 놓지 않고, 잠깐 다른 일을 해도(`lootTryGapSec` 2초 안) 쫓은 시간을 이어 세어 `lootGiveUpSec` 뒤 포기한다(40m 경계에서 줍기 ↔ 탐색이 틱마다 뒤집혀 30초 ~ 30분 제자리에서 떨었다 — 세션이 끊겼다 · `bot.test`). 나가는 포털이 `exitClickR`(8m) 밖이면 탐색과 같은 타일 경유점으로 걷고 안에서 누른다(완료 뒤 먼 포털을 직접 클릭하면 경로 상한에 걸려 [] → 봇이 그 자리에 섰다 · §7.12 `PATHING.maxNodes` 20000 과 함께). 조준선(궁수 · 주술사 화살)과 날아오는 투사체를 피하는 규칙은 넣었다가 뺐다 — 사람처럼 옆걸음을 치게 했더니 싸움을 끊어 첫 판이 길어지고 사망이 늘었다(실측 첫 판 두 클래스 × 시드 12: 투사체 피하기를 켜면 완료 21/24 · 최대 20분 → 끄면 24/24 · 최대 10.3분). 봇은 투사체를 피하지 않는다(측정의 한계 §12.6).

### 12.2 파일별 테스트 (패키지마다 자기 파일 — `node --test`)

| 파일 | 소유 | 확인하는 것 |
|---|---|---|
| `core.test.js` | P0 | rng 결정성 · 분포(평균 · pick 가중치) · math(yaw 규약: `fwd(0) = +Z` · `yawOf(1, 0) = π/2` · 오른쪽 벡터) · shapes `overlaps`(원 · 원뿔 경계 · 선 · 고리 — 몸 반지름 포함) · spatialHash · hash 안정성 · time `ticks` |
| `nav.test.js` | P0 | `moveCircle` 벽 미끄러짐 · 모서리 끼임 없음 · 결과 늘 걷기 가능 · `losClear` · `nearestWalkable` · `raycastWalk` |
| `purity.test.js` | P0 | §12.3 |
| `data.schema.test.js` | P0 | **모든 데이터 행**: 필드 · 타입 · 범위 · 참조(클래스 · 부위 · 기본형 · 옵션 · 훅 ID가 레지스트리에 있다 · 노드 req가 같은 클래스 액티브 · 프리셋 order가 단계 · req · 최대 랭크를 지키며 29점에 배워지고 bar가 배운 액티브) · 완결성(모든 부위에 L1 기본형 · 모든 옵션이 어느 부위에선가 · 부위마다 접두 ≥ 3 · 접미 ≥ 3 · 티어 범위 증가 · 모든 정예 가능 종에 붙을 수 있는 속성 ≥ 4 · 팩 구성원이 있는 종 · 타일셋마다 팩 가중치 · 마을 물체 7) · **위협 부등식 H5**(`delay` ≥ `HAZARD.react + escape / HAZARD.slowSpeed` — 속성 `params.delay` · `params.escape` · 공격 `windup` · `escape` · telegraph `groundLine` · `groundCircle` 공격은 escape가 있어야 한다) · **위협 거리**(모든 몬스터 · 수호자 공격 `range` · 속성 `params.range` ≤ `MON.threatRange`) · cast 공격의 range ≤ 그 효과 도달 거리(원뿔 r · 선 len) − 0.5 · **액티브 · 기본 공격 행의 `params`에 §8.4 패치 키가 없다** · 일반 · 수호자 ID가 겹치지 않는다(`getMonDef`) · 문자열 키가 데이터의 모든 이름에 있다 |
| `fixtures.test.js` | P0 | 고정 상태 15개가 §3 모양 · 유한수 · 엔티티가 맵의 걷기 가능 칸 위 · ID 유일 |
| `player.test.js` | P1 | 클릭 해석(§5.2 규칙 1~10 각각) · 누르고 있는 이동의 재경로 · 커서 null이면 멈춤 · 대상 검사 · **선입력**(잠긴 동안의 누름이 풀린 첫 틱에 나간다 · 창 ≥ 남은 잠김) · 누르고 있는 스킬 반복 · 우선순위 · **actEnd 틱에 버퍼의 행동이 시작한다** · 채널 중 다른 입력이 채널을 끊고 같은 틱에 나간다 · 곧 풀릴 쿨다운 · 속박 · 포션 누름이 버퍼로 · 일반 몬스터는 밀고 정예 · 구조물에는 막힘 · 밀림(knock) · 이름표 hover(src label · 20m) · 큰 몬스터 꼭대기 클릭이 대상 검사를 통과 · 줍기/상호작용 도착(마을 포털 → requestReturnToRift) |
| `skills.test.js` | P1 | 동작 14개: 판정 틱 · 모양 치수(§9.6) · 비용 · 쿨 · 분노 생성/감소 · 마나 재생 · 채널 유지/끝 · 도약 공중 무적 창과 sim 위치 보간 · 돌진은 한 몬스터에 한 번 · 순간이동 벽 넘기 · 연쇄 번개 대상 고르기 · 변형 패치 6 · `describeSkill` 수치 · `skillReady` |
| `equipHooks.test.js` | P1 | 전설 12의 효과(패치형은 params 비교 · 사건형은 처치/구슬에서) · 내구도 0이면 꺼짐 · noProcs로 재귀 없음 |
| `combat.test.js` | P2 | §5.6 식을 손 계산과 대조(치명타 · 보너스 합 · 저항 · 감전 · 정면 방패 · 면역) · DR 식 레벨 불변 · 막기 · 보호막 흡수 · 가시 · 적중 회복 상한(채널 틱 2) · 최소 피해 20% · 상태 이상 표(§5.8) 각각 · 경직 · 넉백 면역(무한 경직 없음) · 기절 연장 없음 · 정면 방패는 idle · move · windup에서만 · 저항 상한 0.5 · onMonHitPlayer(근접 · 투사체 · noAffix면 없음) · 조건부 패시브 |
| `effects.test.js` | P2 | 예고 → 판정 틱 · spec null(표시 전용)은 판정 없음 · tickSpec · 첫 지속 판정 = hitAt + tickT · 출처 사망 시 취소 규칙(역병 덩어리는 한 번만 맞힌다 · 돌진 선은 피해 0) · 위협 간격 H1~H4(감옥 + 역병 + 몰타르 동시 시도 → 묶인 채 맞는 판정 0) · 투사체 벽 · 관통 · 튕김 · 폭발 |
| `drops.test.js` | P2 | 흩뿌림(걷기 가능 · 간격) · 자동 줍기 반경 · 포션 상한 · 가방 가득 → 드랍 남음 + `PICKUP_FAIL` · 업그레이드 집계 · 골드 음수 없음 |
| `rift.test.js` | P2 | 게이지 → 수호자 예고 → 출현 · 완료 → 요약 · 해금 +1/+2 · 사망 → 생명 −1 · 0에서 사망 → 붕괴 · 부활 → 마을 · 복귀 → `returnPos`/`checkpoint` · 도착 보호 · 귀환 포털 · 같은 틱 충돌 §5.16 1~8 · **마을에 다녀와도 예고 · 공격 · 속성 주기 · 시체 시간이 멈춰 있다**(shiftTicks) · complete 단계 사망은 lives를 깎지 않는다 · 반복 중 제거 0(표시 → removeMarked) · (W1 수정 3) 사망한 틱에 플레이어 투사체 · 효과 · 화상 · 감전 지움 · (W1 수정 4) 출현 예고 중 사망 → `settleOnRespawn`이 수호자를 잠든 채 세우고 예고 효과를 끝낸다(원래 출현 시각에 다시 세우지 않는다) |
| `gameSim.test.js` | P2 | 틱 순서 · 재진입 안전 플러시 · 명령의 Result · `pendingTravel` 동안 step · `commitTravel` 전부 · `debugLoadState` · 마을/균열 왕복 상태 보존 · newCharacter/loadCharacter 뒤 생명 가득 · 첫 마을 재고 있음 · `unloadCharacter` · 균열 장면이면 ctx.flow가 늘 있다 · (밸런스 게이트) 완료 마무리 전에 귀환해도 요약 · 해금이 남는다 |
| `balance.test.js` | W1 수정 · 밸런스 게이트 | (밸런스 게이트) **basic 봇**이 시작 캐릭터 두 클래스로 균열 1 첫 판을 완료(사망 ≤ 1 · 9분 안 · 시드 6 · 7 — 브리프 「처음 성공까지」) · `scriptedClear` learn(피하기 없음)은 느슨하게(완료 · 사망 ≤ 2 · 12분 안 · 최저 생명 < 60%) · 강제 · 자연 사망 시나리오의 개발 캐릭터는 균열 10(수호자 단계 사망은 마법사 균열 14) — 몬스터 피해 × 7 뒤에도 같은 경로를 탄다 · (W1 수정) 시작 캐릭터 두 클래스가 균열 1 첫 판을 완료(사망 ≤ 1 · 9분 안 · 최저 생명 < 60% · 시드 6 · 7 — 수호자 뼈 거인 · `scriptedClear` learn) · 사망 → 부활 → 복귀(강제 사망 전사 5 · 마법사 3 · 마법사 7 떼 12(날아가는 화살) · 자연 사망 개발 캐릭터 균열 8 마법사 9(두 번) · 12 · 전사 9): 그 틱에 진정 · (W1 수정 3) 플레이어 투사체 · 효과 · 화상 · 감전 없음 · 부활로 떠날 때 `rift.homes`로 · 복귀 뒤 3초 동안 깬 팩 0 · 복귀 지점 aggro 안에 깨어 있는 몬스터 0 · (W1 수정 3) 수호자 단계 사망(마법사 10): 복귀 지점은 수호자 시야 밖 · 생명 그대로 · 다가가면 다시 깬다 · (W1 수정 4) 출현 예고 중 사망 → 그 안에 부활(마법사 시작 캐릭터 시드 21 · 균열 1 · 게이지 100% 20틱 뒤 · 9틱 뒤 부활): 수호자는 부활 commit에서 잠든 채 · 생명 가득 · 복귀 3초 동안 aggro 안에 깨어 있는 몬스터 0 · 복귀 지점은 그 시야 밖 · 다가가면 깬다 · (W1 수정 2) 개발 캐릭터(L10 · 장비 ilvl 5)가 균열 8(해금 최고 + 3)에서 피하기 없이 2번 이상 쓰러진다 · 시드 3(뼈 거인) 첫 판 사망 ≤ 2(민감도) — 첫 판 완화(`RIFT.earlyDmg`)가 해금 최고 + 3 의 위협을 지우지 않는다(NOTES-W1FIX · 밸런스 게이트: 경사는 균열 1~11) |
| `monsters.test.js` | P3 | `monsterStats`(§5.6) · 잠/깨움 · 팩 연결 · 상한 120 · 흐름장 · 직선 추적 · 밀어내기(겹침 해소 · 플레이어 원) · 다시 잠 · 공격 진행(예비 facing 고정 · 판정 틱 · 후딜 · 시작 관용 없음 · 판정 관용 0.3) · 빠름이 바닥 예고를 줄이지 않는다 · 상태 관문(사라짐이 actEnd에 끝난다) · 팩 대표만 hazard onAwakeTick · prevPos 전부 · 생명 ≤ 0이면 행동 없음 |
| `behaviors.test.js` | P3 | 9 행동: 소인 도망(팩당 한 번) · 주술사 부활(끊김 · 되살린 것 flags) · 궁수 거리 유지 · 조준 고정 0.2초(옆걸음으로 빗나감) · 방패 정면 · 짐승 돌진 · 벽 기절 · 역병 덩어리 폭발/웅덩이 · 둥지 상한 · 「닿지 않는 거리에서 헛동작 없음」 |
| `affixes.test.js` | P3 | 프레임워크(mods 적용 · 훅 호출 지점 · 배제 규칙 · 하수인 공유 · 챔피언 팩 보호막 엇갈림 · 수호자 저항 없음) + 속성 6(fast · tough · fireEnchanted · coldEnchanted · vampiric · shielding) 각각의 효과 |
| `packs.test.js` | P3 | 균열 채우기 결정성 · 팩 구성 범위 · 챔피언/정예 수 = riftRow · 속성 수 · 정예 이름 · 게이지 합 ≥ 115%(§7.14) |
| `guardians.test.js` | P3 | 뼈 거인(대지 분쇄 · 뼈 가시 · 선 사이로 피함) · 출현 자리 규칙 |
| `mapgen.test.js` | P4 | 결정성(같은 시드 = 같은 타일) · 방 10~14 · 통로 폭 4~6m · 모든 바닥이 spawn에서 닿는다 · 팩 자리 규칙(18m · 6m · 깊이) · 생성 ≤ 150ms(시드 20개 최대) · 마을 맵 물체 |
| `path.test.js` | P4 | 벽 돌아가기 · 막힌 곳 → 가장 가까운 점 · 줄 당기기 결과가 벽을 뚫지 않는다(r 여유) · 노드 상한 |
| `flow.test.js` | P4 | 갱신 조건 · 방향이 거리를 줄인다 · 닿지 않는 곳 null |
| `rollItem.test.js` | P5 | 옵션 수 · 접두/접미 상한 · 중복 없음 · 티어 ilvl 규칙 · 값 범위(pow 배율) · 클래스 편향 · 이름 키 · 가치 식 · 결정성 · `makeItem` · `rerollAffix` |
| `rollDrops.test.js` | P5 | **10만 회 시뮬 vs 이론값**: 등급 · 부위 · 옵션 티어 상대 오차 ≤ 3%(빈도 1% 이상 칸) · MF 0/100/300/600% 희귀 이상 비율 증가 · 증가분 감소 · 불운 보정 켬 → 전설 사이 장비 드랍 수 최대 ≤ 400 · 끔과 비교 · 보장 드랍 |
| `theory.test.js` | P5 | 합 1 · 손 계산 대조 · §7.14 표의 한 판 기대값(L5: 장비 42.5 · 마법 16.9 · 희귀 5.24 · 전설 0.311) |
| `stats.test.js` | P5 | `computeStats` 손 계산(시작 전사 시트 DPS 7.9 · 생명 120 · 방어도 12) · 내구도 0 → 꺼짐 · 맨손 · 세트 2/4 · 패시브 · 상한(치명 · 쿨감 · 비용 · 이동) · `compareEquip`(반지 · 양손 · 보조) · `isUpgrade` |
| `inventory.test.js` | P6 | 장착 규칙(클래스 · 레벨 · 양손/보조 · 가방 가득) · 이동 · 정렬 · 사망 대가 · **아이템 복사 0**(모든 경로 뒤 ID 유일 · 개수 보존) |
| `shops.test.js` | P6 | 사기 · 팔기 · 되사기(이득 0) · 수리 · 분해 · 제작 · 도박 확률(10만 회 vs GAMBLE) · 재굴림(고정 · 비용 증가 · 취소 무료) · 무료 규칙 · 골드 · 재료 음수 0 · 재고 갱신(같은 판이면 같은 재고 · 다음 판에 새로) · 부분 수리 · 수리비가 등급과 무관 · 잠긴 아이템 · 일괄 판매 · 도박 부위별 확률 · 가격 · 재굴림 정수 |
| `progress.test.js` | P6 | 경험치 곡선(§7.11 표 · reqEarly) · 레벨 차 보정(d > 12) · 캡 · 포인트 · 단계 해금 · req · 바 배정(새 액티브 자동 배치) · 초기화 · 해금 규칙 · 기록 |
| `save.test.js` | P6 | 직렬화 왕복(상점 재고 포함) · 깨진 JSON · 모르는 ID 정화 · 숫자 아닌 값 · ID 중복 정리 · 버전 이주 자리 · throw 0 · **계정만 깨짐 → rebuildAccount로 캐릭터 목록 복원 · ID 충돌 0** · 드랍 100개 → 캐릭터 저장(계정 함께) → 다시 읽기 → 새 드랍 ID가 가방 · 보관함과 겹치지 않는다 |
| `view.world.test.js` | P7 | MapData → 지오메트리(바닥 · 벽 인스턴스 수 = 벽 타일 수) · 벽 낮추기 선택(순수 함수 — 카메라 쪽 · 가로 5m) · 카메라 거리 범위 · 화질 표 · `setMap` 두 번에 지오메트리 수 그대로(누수 없음) |
| `view.actors.test.js` | P8 | 포즈 순수 함수(걷기 주기 = 거리/보폭 — 미끄러짐 없음 · 판정 틱에 무기 끝 자세) · 템플릿 지오메트리 치수(§9.6 표 — 몸 폭 · 팔 길이) · 몬스터 10 → 120에서 InstancedMesh 수 그대로 |
| `app.*.test.js` | P9 | 쿼리 해석 · 입력 에지 모으기/버리기 · 키 → InputFrame · 저장 시점 · 백업 · 설정 정화 · 루프 누산기(스텝 상한 · 폭주 없음) — 가짜 localStorage · 가짜 시계 |
| `ui.format.test.js` · `ui.strings.test.js` | P10 | 숫자 형식 · 쓰인 키가 전부 있다(§10.8) |
| `ui.panels.test.js` | P11 | `itemText`(툴팁 줄 · 고급 티어 범위 · 비교 색 방향) |
| `analytics.test.js` | P12 | `toJson` · `toCsv`(이스케이프) · 히스토그램 · 조각 실행기(가짜 스케줄러로 시간 예산 · 취소) |
| `view.fx.test.js` | P13 | 효과 모양 → 데칼 치수(§9.6 표의 0 칸) · 적대 = 붉은 테두리 · 풀 상한 |
| `audio.test.js` | P14 | 가짜 WebAudio: unlock 전 무시 · 리미터 있음 · 발음 상한 · 지속음 정리 · 일시정지 |
| `bot.test.js` | P15 | 반응 지연 · 피하기(예고 밖으로) · 무회피 · 레벨 선택 규칙 · 마을 정비 · 스킬 사용 규칙(동작별) · (밸런스 게이트) 피하기 dodgeLead · 화면 밖 장비 쫓기의 거리 여유 · 끊겨도 이어 세는 포기 시계 |
| `headless.test.js` · `measure.test.js` · `perf.test.js` | P15 | §12.4 · §12.5 |
| `content.test.js` | P16 | 속성 6(번개 강화 · 순간이동 · 감옥 · 분열 · 역병 · 몰타르) 각각 + 잿빛 마녀(잿불 비 배치 · 하수인 상한 · 순간이동) · 위협 간격과 함께 |

- 스텁 상태에서는 패키지 테스트 파일이 `test.todo` 자리로 있다(P0) — 실패 0.

- **피드백 1(게임플레이 담당)이 더한 검사**: `skills.test` 회전 베기 360°(앞 · 옆 · 뒤 · 반지름 밖) · 가르기 반원(부채꼴 밖 · 등 뒤 · 사거리 밖 · 분노 = 8 + min(3, n − 1)) · 대상 고정 · Shift 반원 · 연속 회전(follow) / `balance.test` 회전 베기 정타 처치 수(개발 캐릭터 균열 3 · 5 · 10 · 15 중앙 1.9~3 · 시작 장비 첫 판 평균 2.2~3.0 — 수정 단계가 3.2 → 3.0) / `theory.test` 일반 · 하수인 골드 기대값 불변(균열 1~30) · 굴림 표본 / `save.test` 옛 세이브의 groundStomp · aftershock 랭크 · 바 / `bot.test` spinSlash 규칙(inner · 회오리 분노 남기기) · 회오리 2마리 · 수호자 미니맵 찾기. ~~todo 2~~ → 0: `view.fx.test` 「회전 베기 고리 r 2.5 · 가르기 호 r 1.9 · 180°」 · 칼끝 궤적 · 연속 회전(view 단계) / `audio.test` 「가르기 휘두름 · 회전 베기 spinSwoosh · 연속 회전 echoSwoosh — 실제 이벤트로」(수정 단계).
- **피드백 1(view · ui · 수정 단계가 더한 검사)**: `view.actors.test` 가르기 무기 5종(판정 틱 칼끝 반지름 1.9 ± 0.35 · 방위 식 ± 12° · 되돌아 휘두르지 않음 · 발 제자리 · 양손 손잡이) · 회전 베기 무기 5종(한 바퀴 · 판정 틱 90% 넘게 · 디딘 발 미끄럼 < 2mm · 끝에 제자리) / `ui.feedback1.test` 떨어진 직후 이름표 · `freshAlpha` · `potionUrge` · 새 문자열 · 넉백 줄 · 완료 골드 = 주운 골드 합 · 새 캐릭터 시작 포션 `START.potions`(> 0)을 받고 첫 균열에서 Q 로 마신다 / `fixtures.test` 효과 `follow` 선택 키 · `spinEcho` / `balance.test` 시작 장비 첫 판 위 끝 3.2 → 3.0(Jay 「두세 번」 — 옛 계수 1.05/+0.11은 3.02 로 걸린다).
- **피드백 2(밸런스 · sim 담당 · ui 담당 · 통합이 더한 검사)**: `feedback2.test`(11개) — D2 요구 레벨 min(ilvl, 30) · 옛 세이브 재계산 · 레벨 30 이 균열 40 장비를 낀다 / D3 수호자 예고 mul 5.0 · 3.6 · 3.6 / D4 옛 세이브(가방 40 + 밀린 장착 1) 41개 보존(왕복) · 붙일 때 보관함 이동(빈칸 20 → 11개 모두 · 빈칸 4 → 4 + 칸 밖 7) · 30 아래까지 줍기 'bagFull' · 꺼내기 · 양손 무기 · settleBag 수 보존 · 아이템 ID 유일 / D5 문턱(1~2.5% 반지는 화살표 참 · 기록 거짓) / D8 메테오 벽 자르기(작은 메테오 포함) · `sightClip` · 봇 규칙 / D10 넉백 0.5초 창 · 분쇄자 condStats. `ui.feedback2.test`(9개) — `BAG_GRID` = core · `bagFill` · 가방 격자 넘친 줄 더하기/빼기 · 키보드가 넘친 줄에 닿는다 · 머리 n/30 · 넘침 문면 키 하나(`inv.overflow`) · 완료 패널 문턱 = `COMPARE.upgradeGain` · 스킬 트리 모달 · `stepAllowed`/`pauseReason` · `S` 로 닫힘 · `ownsKey` · 모달 스킬 트리의 1 이 닫힌 뒤 홀드 키로 새지 않는다. `balance.test` 회전 베기 정타 수는 봇 장비 고정 자료 `test/fixtures/botGear.json`(전사 basic 세션 시드 601 · 균열 3 · 5 · 7 · 9 · 11 을 처음 연 판의 시작 사본) 기준(중앙 2~3 · 값마다 1.2~4.5 · 시작 장비 첫 판 평균 2.8~4.0 · 개발 장비는 진단만) · 강제 사망 「날아가는 화살」 시드 7 → 4 · 수호자 단계 사망은 무적으로 수호자 출현까지 간 뒤 무적을 끈다. `monsters.test` 레벨 비: 입문 구간 1~6(6 → 7 포함)은 단조 증가만 · 0.8~1.25 는 균열 7 부터. `app.storage.test` 아이템 ID 검사는 min(100, BAG_SIZE + STASH_SIZE)개.
- **피드백 2 다듬기(수정 담당이 더한 검사 — 검증자의 돌연변이 생존 (a)~(d) · 세이브 순서)**: `feedback2.test` — 넘친 가방의 칸 안 구멍(정리 전 · step 없이) → `addToBag` · `buy` · `buyback` · `craft` · `gamble` · `moveItem`(보관함 → 명시한 빈칸 · 빈 첫 칸)이 모두 'bagFull' · 골드 · 재고 · 되사기 · 보관함 · `nextItemId` 그대로 / 칸 안 구멍 둘 + 칸 밖 1개(든 것 29)에서 `addToBag` 은 칸 밖을 먼저 당긴 뒤 다음 구멍 · 길이 BAG_SIZE / 작은 메테오 하나만 벽 기둥에 가려지는 지형(큰 메테오는 트인 곳 그대로) — 그 하나만 `sightClip`. 되돌린 사본(`bag.indexOf(null)` · `buy`/`gamble`/`buyback` 사전 검사 · `moveItem` 의 `isBagFull` 빼기 · 작은 메테오 `sightClip` 빼기)에서 모두 실패를 확인했다. `app.game.test` — 가짜 저장소에서 계정 · 캐릭터 한쪽 쓰기 실패(가방 → 보관함 · 보관함 → 가방 · 계정 실패 · 붙일 때 칸 밖 → 보관함)에도 그 아이템 ID 가 저장소에 정확히 1번 · 보관함 이동은 그 프레임에 한 쌍(되돌린 사본: 캐릭터 먼저 · 되돌리기 없음 · 계정 실패에도 캐릭터 쓰기 · 'all' 을 1초 묶음 — 모두 실패). `monsters.test` 「입문 경사의 꼴」(§7.3). `ui.feedback2.test` 완료 패널 문면 「넘게」(「이상」 아님).

### 12.3 순수 계층 · 규칙 검사 — `purity.test.js` (P0)

1. 순수 계층(`src/core` · `src/data` · `src/sim` · `src/bot` · `src/debug`)의 소스에서(문자열 · 주석 제외) `three` import · `window` · `document` · `AudioContext` · `localStorage` · `performance.` · `Date.now` · `Math.random` · `setTimeout` · `setInterval` · `requestAnimationFrame`이 0.
2. `src` 전체의 상대 import 경로가 디스크 파일 이름과 **대소문자까지** 같다 · 동적 `import(` 0(단일 번들).
3. 부팅 표식(§11.11).
4. 이벤트 이름 문자열 리터럴(`'mon/died'` 꼴 — `EV` 값 목록)이 `core/events.js` 밖에 0.
5. **콘텐츠 ID 분기 금지**: 프레임워크 파일(`sim/monsters/monsters.js` · `spawn.js` · `packs.js` · `sim/player/controller.js` · `actions.js` · `sim/combat.js` · `status.js` · `effects.js` · `projectiles.js` · `drops.js` · `rift.js` · `sim/loot/*` · `sim/progression/*`)의 문자열 리터럴에 데이터 행 ID(몬스터 · 속성 · 노드 · 전설 · 세트 · 기본형 · 옵션 ID)가 0 — 훅 파일 · 데이터 파일 · 테스트는 제외.
6. 일부러 위반 파일을 넣어 실제로 잡는지 P0이 확인한 뒤 지운다.
7. **sim import 순환 0**: `src/sim`의 상대 import 그래프(DFS)에 순환이 없다(§2.2 — `monsters.js ↔ affixHooks` · `combat ↔ status` 같은 순환을 막는다).
8. (W0 스캐폴드가 더한 것) §2.1 표 전체(view · ui · audio 의 sim import 범위 · 외부 모듈은 three(view · app)뿐 · debug 는 위 표의 W0 완성 이름만) · §2.2의 금지 방향(combat · status · loot · spawn · 훅 파일 · GameSim · debug) · `export default` 0 · 한국어 문자열 리터럴은 `data/strings.ko.js`에만(CLAUDE.md — `src/bot/`의 측정 리포트 문면은 예외 · 오류 메시지는 영어).

### 12.4 헤드리스 봇 시나리오 — `headless.test.js` · `perf.test.js` (P15)

| # | 시나리오 | 통과 |
|---|---|---|
| S1 | 두 클래스 각각: 새 캐릭터 → 마을 → 균열 1(basic 봇) **클리어**(사망 ≤ 1) → 마을 정비(팔기 · 수리 · 장착 ≥ 1) → 균열 2 열기 → 600틱 | 예외 0 · NaN 0(300틱마다 `assertFiniteDeep`) · 골드 · 재료 ≥ 0 · 아이템 ID 유일 · 균열 1 클리어 · 브리프 「처음 성공까지」 |
| S2 | 결정성: 같은 시드 · 같은 봇으로 균열 3판 → 상태 해시 같음 / 다른 시드 → 다름 | 해시 |
| S3 | 퍼즈: 균열 3에서 `randomInputs` 10,000틱 + 무작위 명령(장착 · 팔기 · 스킬) | 예외 0 · NaN 0 · 불변식(생명 ∈ [0, max] · 자원 · 골드 ≥ 0 · ID 유일 · 몬스터 위치 걷기 가능) |
| S4 | 새 캐릭터의 **첫 사망**(안내가 끼는 경로) → 부활 → 복귀: 키 입력 2번(Enter · Enter)과 전환 commit만으로 다시 균열 · 그 사이 모달 안내 카드 0 · 시스템 시간 합 `DEATH.panelDelay` 0.3 + 막(0.2 + 0.2 + 0.3 + 0.3) = 1.3초 ≤ 1.7 | 브리프 「실패 → 재도전」 |
| S5 | 성능: 생성 맵에 깨어 있는 몬스터 120 + 투사체 200 → 300틱 평균 step ≤ 4ms(Node) · `generateRift` 시드 20개 각 ≤ 150ms | 브리프 §7 성능 |
| S6 | (브라우저 · 리뷰) 균열 5판 반복 후 `__game.memory()` 증가 없음 | QUALITY §6 |

`npm test` 전체 3분 안(브리프 §8.8) — S1 두 판 + S2 세 판 × 2 + S3 + S4 + S5.

- **W2 확정(P15)**: S1의 둘째 판은 하네스가 `levelOverride = 2`로 연다(첫 판이 5~7분이라 +1 조건 `upMaxSec` 6분이 갈린다 — 봇의 레벨 규칙은 그대로) · S4의 시스템 시간은 계약 상수(`DEATH.panelDelay` + 막 넷)로 계산하고 봇의 결정 시간을 실제 틱으로 더한다(헤드리스에는 막이 없다) · `measure.test`의 「떼 순간 ≥ 1」은 클래스마다 세 판의 합.

### 12.5 측정 — `npm run measure` → `docs/MEASURE.md` (P15 `scripts/measure.mjs` + `bot/measure.js`)

- 실행: 두 클래스 × (basic 9시간 분량 · noDodge 같은 레벨 경로 40판 · 해금 + 3 40판 · challenge 20판) + 속성 탐침(12종 × 두 클래스 · 각 8회) + 빌드 비교(같은 장비 · 레벨 · 프리셋 A/B · 무작위 배분 3시드 × 15판) + 장비 비교(시작 장비로 균열 8 · 봇 장비로 균열 8 · 각 20판) + 드랍 표(10만 회). 판 수는 `BOT_MEASURE`(`data/bot.js`)가 정본이다(밸런스 게이트 — 20판 · 10판 비율이 측정마다 크게 흔들려 늘렸다 · `scripts/measure.mjs`가 그 값을 읽는다). 시간은 틱으로 민다(실제 몇 분 ~ 수십 분).
- 출력 표(균열 레벨별 행): 판 수 · 클리어 시간 평균/중앙 · 사망/판 · 붕괴율 · 처치 구성(등급별) · 분당 처치 · 떼 순간/판 · 드랍 등급별/판 · 골드/판 · 경험치/판 · 업그레이드 판 비율 · 도중 귀환 비율 · 수리비/골드 수입 · 캐릭터 레벨 도달 시간(5 · 10 · 20 · 30) · 균열 레벨 도달 시간(5 · 10 · 20). · 상승 조건 충족 비율(무사망 · 6분 안 — 목표 40~60%) · 「보상(L)」 = √(E[업그레이드 드랍의 powerScore 증가 · 캐릭터 고정] × 골드/판)(§7.14와 같은 정의) · 9시간 시점 도달 균열 레벨. 그리고 브리프 §7의 각 목표를 **목표 · 측정값 · 판정** 세 열로.
- **피드백 2(측정 정의)**: ① 「업그레이드 판 비율」 = 판에서 `rift.stats.upgrades > 0` — 세는 문턱이 `COMPARE.upgradeGain`(3% · D5)이고 행 이름에 문턱을 적는다(「장비 점수 +3% 넘게」 · 화면 화살표의 0.5% 가 아니다). ② 「레벨 곡선 비」의 직선 맞춤은 균열 `introTo + 1` ~ 20(`introTo` = `RIFT.earlyDmg` · `earlyHp` 칸 수 6 — 입문 구간 1~6 은 브리프 §7 의 예외라 뺀다 · D1). ③ 균열 30 초과 판 줄은 「요구 레벨 = min(아이템 레벨, 30)」(D2). ④ 빌드 비교 캐릭터 `BOT_MEASURE.buildChar` {레벨 12 · 균열 6} → **{레벨 14 · 균열 5}**(입문 구간이 균열 6 에서 끝나 개발 장비로는 균열 6 판이 무너져 「무너지기까지의 시간」을 쟀다 · 봇 세션이 균열 5 를 도는 레벨 12~14). ⑤ 「장비가 의미 있다 — 봇 장비(균열 8 해금 시점)로 균열 8 붕괴 ≤ 20%」는 D1 의 구조적 결과로 ✗(90~100%)다 — 균열 8 해금은 균열 6 무사망 클리어(+2) 직후인데 균열 8 은 입문 구간이 끝난 뒤 두 단계 위(피해 × 1.7 · 생명 × 1.6). 측정 정의(「균열 8 을 처음 돌 때」)를 바꿀지는 Jay 가 정할 것.
- `measure.test.js`(npm test 안 · 60초 이하): 각 클래스 균열 1~3 세 판 — 한 판 3~9분(느슨) · 게이지 100% 도달 · 떼 순간 ≥ 1 · 드랍 장비 20~70 · 분당 처치 25~100 — 밸런스가 크게 무너졌는지만 본다(정밀한 판정은 MEASURE.md).

### 12.6 측정 목표 대조표 (브리프 §7 → 어디서 재는가)

| 목표 | 재는 곳 | 비고 |
|---|---|---|
| 한 판 5~8분 · 분당 처치 40~80 · 떼 순간 ≥ 3 | measure(basic · 적정) | §7.14 산수 6.3분 |
| 균열 1 첫 시도 클리어(사망 ≤ 1) · 두 클래스 | headless S1 | |
| 실패 대가: 수리 = 골드의 10~20% · 붕괴 = 보장 + 해금 | measure · rift.test | |
| 재도전 키 2번 · 2초 | headless S4 | 시스템 1.3초 + 반응 |
| 처치 시간(2~4방 · 8~20 · 15~35 · 30~70초) | measure(처치 기록에 시간) | |
| 사망 0.2~1.0/판 · 무회피 ≥ 2배 · +3레벨 붕괴 ≥ 50% | measure(basic · noDodge · challenge) | |
| 정예 속성 12종 차이 ≥ 5% | measure(`affixProbe`) | |
| 드랍 수 · 첫 전설 2~5판 | measure · rollDrops.test | |
| 업그레이드 판 비율(1~5 · 10 · 20) | measure | 피드백 2 D5: 문턱 3%(`COMPARE.upgradeGain`) |
| 레벨 곡선 비 0.8~1.25 | measure(표) · §7.3 | 산수 1.02~1.03(보상 정의 §7.14) · 피드백 2 D1: 맞춤은 균열 7~20(입문 구간 1~6 제외) |
| 진행 속도(균열 5 · 10 · 레벨 10 · 30) | measure(basic 6시간) | |
| 도중 귀환 30~60% | measure | 산수 38.5%(가방 40 시절) · 피드백 2 D4: 가방 30 — 실측 §7.14 |
| 경제(남는 골드 · 도박/재굴림 기대 < 사냥) | measure + §7.14 산수 | 도박 · 재굴림은 봇이 쓰지 않는다 → 기대값 산수 |
| 장비가 의미 있다(균열 8: 시작 장비 ≥ 80% 붕괴 · 봇 장비 ≤ 20%) | measure | |
| 스킬 트리(프리셋 vs 무작위 ≥ 15% · 프리셋끼리 ≤ 20%) | measure | |
| 클래스 균형(≤ 25% · ≤ 30%) | measure | |
| 드랍 확률 = 표 · 수확 체감 · 불운 상한 | rollDrops.test | |
| 성능 · 결정성 · 견고성 · 데이터 완결성 | perf · headless · data.schema | |

- 봇의 마을 시간은 `BOT.townSec` 모델(§12.1) · 사람의 마을 패널 시간은 `addPlaySec`로 플레이 시간에 들어간다 — 진행 속도 목표는 이 둘을 포함한 `playSec`로 잰다.
- **측정의 한계**(MEASURE.md에 적는다): 봇은 도박 · 재굴림 · 제작 · 보관함을 쓰지 않는다 · 수동 조준의 정밀함(봇은 커서를 정확히 둔다 — 실수율로 흐린다) · 소리 · 화면 읽기는 재지 못한다 · (밸런스 게이트) 봇은 날아오는 투사체와 조준선을 피하지 않고 · 스킬 바를 프리셋대로만 · 레벨을 basic 규칙대로만 고른다(NOTES-BALANCE §6).

### 12.7 밸런스 게이트 (마지막 웨이브 — 오케스트레이터 워크플로)

- `npm run measure`를 돌려 MEASURE.md의 판정 열을 본다. 벗어난 목표는 **조정 손잡이**로 맞춘다: 몬스터 생명/피해(`MON.hpBase` · `RANKS.*.hp` · `GROWTH.hp`) · 처치 시간(`RANKS.champion.hp` 3.5~4.0) · 위협(속성 `params`의 주기 · 예고) · 드랍(`TREASURE.*.w.gear` · `RARITY.base`) · 첫 판(`XP.reqEarly` · `RIFT.earlyGaugeMul`) · 진행(`XP.req` · `BOT.upMaxSec`) · 경제(`PRICES` · `PRICES.repairBase` · `GOLD.base` · `CRAFT` · `REROLL`) · 후반(`GROWTH.hpLate` · `GROWTH.dmgLate`) · 맵 밀도(`MAPGEN.normalPerArea`) · (W1 수정 — NOTES-W1FIX §5) 받는 피해(`MON.dmgBase` · 궁수 `dmg` — 균열 5 이상) · 첫 판 받는 피해(`RIFT.earlyDmg` — 균열 1~4만) · 파도(`MON.linkRadius` · `MON.linkMinDepth`) · 회복(`TREASURE` globe). 🔒 값을 바꾸면 §7.14 표를 같이 고친다.
- **밸런스 게이트 실행 기록**: `docs/NOTES-BALANCE.md`(측정 표 · 바꾼 값과 이유 · 남은 문제 · 측정의 한계) · 손잡이에 더해 쓴 것: `RIFT.earlyHp`(첫 판 생명 경사 · §7.3) · 정예 속성 · 수호자 · 돌진 · 폭발의 피해 배율 × 3(배율은 dmgBase 에 곱하므로 예고된 공격이 일반 공격보다 3배 더 무거워졌다 — 피하기의 값 · 무회피 2배 목표) · 스킬 계수(§7.2) · 마법사 생명 · `PATHING.maxNodes`.

### 12.8 브라우저 스모크 (화면 패키지 · 통합 게이트)

- dev 서버(`port + k`)에서 `npm run probe:screen -- "<주소?쿼리>" --step <n> --out docs/_scratch/<이름>.png` → Read로 본다: `?fixture=` 15개 · `?class=warrior&rift=3` · `?class=mage&rift=3` · 1280×720 · 1920×1080 · `__game.errors()` 0.

---

## §13 패키지별 완료 정의

**P0 scaffold**
- 템플릿 설정 · `index.html`(캔버스 · UI 루트 · CSS 셋 · favicon) · 의존성(vite · three만) · `scripts/` 다섯 파일 그대로 + `measure.mjs` 스텁 · `npm run measure` 스크립트 · `docs/MEASURE.md` 자리 한 줄.
- 완성: `core/` 9 · `types.js` · `data/index.js` · `sim/state.js` · `sim/entities.js` · `sim/world/nav.js` · 레지스트리 3(`affixHooks/index.js` · `guardians/index.js` · `ui/panels/index.js`) · `bootMarker.js` · `debug/*`(고정 상태 15) · `test/helpers.js` · P0 테스트 5개(core · nav · purity · data.schema · fixtures) + 각 패키지 테스트 파일의 todo 자리.
- 스텁이지만 완성으로 내는 것(§6.18): `GameSim.debugLoadState` · `ctx.js` · `DRa`/`DRr` · `spawnProjectile`/`spawnEffect`/`spawnDrops`/`requestTravel` · `monsterStats`/`spawnMonster` · `makeItem`/`itemValue`/`computeStats`/`powerScore`/`weaponVisual` · `createCharacter`/`summaryOf`/`addToBag`/`findItem`/`itemAt`/`xpReq` · `serialize*` · `createRenderContext`(실제 렌더러).
- 모든 시드 데이터가 §7 값 그대로 · `strings.ko.js`에 부록 B 전부. 나머지 파일은 §6.18 스텁(머리에 `// OWNER: P<n> — 계약 §<절>` · `// STUB`).
- 최소 부트(§11.10)가 모든 레이어를 계약 deps로 돌린다 · `?fixture` 15개 · `?scene=rift`가 자리 표시 도형으로 그려진다. `npm run build` · `npm test` · `npm run check:dist` 통과 · `release/boot.png`와 `?fixture=riftSwarm` 정지 화면을 직접 본다.

**P1 sim-player**
- §5.2 클릭 해석 10규칙 · §5.3 선입력(창 ≥ 남은 잠김 · actEnd 틱 실행 · 채널 끊기 · 곧 풀릴 쿨다운 · 속박 · 포션) · 누르고 있는 이동/공격/스킬 · 일반 몬스터 밀기 · 정예 막힘 · 밀림 · 대상 검사(높이 · 이름표) · 도착 처리가 테스트로 고정.
- §5.4의 동작 14개가 §7.2 수치 · §9.6 치수 그대로 · 변형 6 · 전설 12(패치형 9 · 사건형 3)가 `skillParams` · `EQUIP_HOOKS`로만(실행부에 노드/전설 ID 없음).
- 자원(분노 생성 · 감소 · 마나) · 쿨다운 · 포션 · 귀환(1.5초 · 피격 취소) · `describeSkill` · `skillReady`.
- `player` · `skills` · `equipHooks` 테스트 통과.

**P2 sim-session**
- `GameSim` 틱 순서(§5.1) · 재진입 안전 플러시 · 모든 명령 · 조회 · 디버그 메서드(§6.8) · `pendingTravel`/`commitTravel`.
- 피해 식(§5.6)과 상태 이상(§5.8) · 조건부 패시브 · 투사체 · 효과(spec null · tickSpec · 같은 틱 취소 규칙) · **위협 간격 H1~H5** · 시각 밀기(`shiftTicks`) · 표시 뒤 cleanup만 제거 · `onPlayerKilled` · `requestReturnToRift` · `unloadCharacter` · 드랍 흩뿌림/줍기 · 업그레이드 집계 · 게이지/수호자/완료/붕괴/사망/부활/복귀/안전 지점 · 같은 틱 규칙(§5.16) · 계측 · 마우스 대상.
- 데이터 `combat.js` · `rift.js`가 §7.3 · §7.6 그대로.
- W1 통합 게이트에서 `scriptedClear`로 균열 1이 실제 구현끼리 끝까지 돈다. (W1 확정: `gameSim.test.js`의 두 검사 — 시작 캐릭터는 「끝(완료 또는 붕괴)까지 · 붕괴면 부활 → 마을 · 닫힘」, 완료 경로는 개발 캐릭터(L10 · 프리셋 A) · 무적으로 게이지 → 수호자 → `RIFT_COMPLETE` · `UNLOCK` · 나가는 포털 → 마을 · 재고 갱신. 시작 캐릭터의 완료는 밸런스 게이트 — §7.14 실측 · W1 수정: `balance.test.js`가 시작 캐릭터의 첫 판 완료(사망 ≤ 1)를 본다)

**P3 sim-monsters**
- 프레임워크(§5.17): 잠/깨움 · 팩 연결 · 상한 120 · 흐름장/직선 · 밀어내기 · 공격 진행(시작 관용 없음 · 판정 관용 0.3 · 빠름 규칙) · 상태 관문 · 팩 대표 · 다시 잠 · 사망 훅 — 콘텐츠 ID 없음 · `spawn.js`가 레지스트리를 import하지 않는다(순환 0).
- 일반 8 + 새끼 2 · 9 행동이 §7.4 · §8.1 규칙 그대로(예고 → 판정 → 후딜 · 헛동작 없음).
- 팩 · 챔피언 · 정예 구성 · 이름 · 하수인 공유 · `populateRift` 결정성 · `spawnPack`.
- 속성 프레임워크 + 6(fast · tough · fireEnchanted · coldEnchanted · vampiric · shielding) · 수호자 프레임워크 + 뼈 거인 · `findGuardianSpot` · `spawnGuardian`.
- `monsters` · `behaviors` · `affixes` · `packs` · `guardians` 테스트 통과.

**P4 sim-world**
- `generateRift`(§8.7) 결정성 · ≤ 150ms · 방 10~14 · 통로 4~6m · 전부 닿음 · 타일셋 2의 소품 · 빛 · 팩 자리 규칙.
- `buildTownMap`이 §7.12 배치 그대로 · `findPath`(돌아가기 · 가장 가까운 점 · 줄 당기기 · r 여유) · 흐름장(갱신 조건 · 방향).
- `mapgen` · `path` · `flow` 테스트 통과.

**P5 loot**
- `rollDrops` · `rollItem` · `rollGear`가 §5.13 그대로 · 이론 함수와 시뮬레이터 집계기 · 10만 회 대조 ≤ 3% · MF 수확 체감 · 불운 상한 400.
- `computeStats`(§5.6) · `compareEquip` · `isUpgrade` · `powerScore` · 전설 12 · 세트 2 데이터.
- 데이터 4파일이 §7.7~7.9 그대로 · `rollItem` · `rollDrops` · `theory` · `stats` 테스트 통과.

**P6 progression**
- 가방 · 장착 · 보관함 · 정렬 · 내구도 · 사망 대가 · 상점 4의 모든 거래(§6.11) · 가격 식(§7.10) · 무료 규칙 · 재굴림 고정/비용 증가.
- 경험치 곡선(§7.11) · 레벨업 · 스킬 트리 규칙 · 바 · 해금 · 기록 · 세이브 직렬화/정화/ID 중복 정리 · `makeDevCharacter`.
- **골드 · 재료 음수 0 · 아이템 복사 0**이 모든 경로의 테스트로 고정.

**P7 view-world**
- 렌더러 · 화질 3단계 · 카메라(§9.3 — 따라가기 · 줌 2배 · 흔들림 상한 · 순간이동 없음) · 던전 2타일셋(돌 · 촛불 · 관 / 바위 · 용암 균열)이 「자리 표시」로 보이지 않는다 · 가리는 벽 낮추기 · 빛 상한 · 마을 건물 · 포털 · 균열석 · 보관함.
- `?fixture=town` · `riftSwarm` · `riftElites`(잿빛 동굴) 정지 화면을 1280×720 · 1920×1080에서 본다 · 벽이 플레이어를 가리지 않는다.
- `view.world.test.js` 통과 · `setMap` 반복에 누수 없음.

**P8 view-actors**
- 전사 · 마법사 리그와 장비 외형(무기 7종 · 방어구 단계 3) · 몬스터 템플릿 5의 10종 + 수호자 2가 실루엣만으로 구분된다 · 인스턴싱(드로콜이 수와 무관).
- 포즈: 걷기 발 고정 · 판정 틱에 무기 닿음 · 예고 자세(브리프 §3.4) · 쓰러짐/날아감 · 등급 발광 · 가림 외곽선 · NPC · 바닥 아이템과 빛기둥.
- `?fixture=riftSwarm` · `riftWarrior` · `riftMage` · `riftGuardian` · `riftLoot` 정지 화면 · `view.actors.test.js` 통과.

**P9 app**
- §11 전부: 부트 순서 · actions · 화면 기계 · step 조건 · 봇 구동(§11.13 — 모달에 멈추지 않고 두 번 commit하지 않는다) · 전환 막(맵 생성 · 셰이더 컴파일이 막 아래) · 입력(event.code · 기본 동작 막기 · 포커스 · 에지) · 저장 시점 · 백업 · 쿼리 10 · 디버그 API · README(「바로 해 보기」 · 조작 표 · 균열 진행은 저장되지 않는다 · 디버그 API).
- 부팅 표식 · 견고성 표 · `app.*` 테스트 통과 · 실제 sim으로 마을 → 균열 → 사망 → 부활 → 복귀 → 완료 → 마을 정비가 화면에서 이어진다.

**P10 ui-core**
- HUD(§10.3)가 상태를 읽어 늘 맞다 · 안내 모달 둘 · 비모달 여섯 · 안내 큐 · 봇 중 자동 패널 없음 · 이름표(src label) · 피해 숫자 풀 · 미니맵/큰 지도 · 타이틀/캐릭터/새 캐릭터 · 일시정지/설정/도움말(정예 속성 12 설명) · 사망 · 완료 · 확인 · 안내 카드 · 위젯 · 입력 포커스 규칙(§10.5).
- 1280×720 · 1920×1080 겹침 · 잘림 없음 · 문자열 키 노출 0 · 키보드만으로 조작 · `ui.*` 테스트 통과.

**P11 ui-panels**
- 인벤토리 · 툴팁(나란히 비교 · 고급 티어 범위) · 스킬 트리(전/후 수치) · 캐릭터 시트 · 상점 4 · 보관함 · 균열석이 §10.6 그대로 · 모든 거래가 전/후를 보인다 · 가방 격자 두 영역 · 일괄 판매 · 잠금 · 균열석 기본 포커스 · 키보드만으로.
- `?fixture=bag` · `shops` · `skillTree` 정지 화면 · `ui.panels.test.js` 통과.

**P12 analytics**
- 탭 넷(§10.9) — 시뮬레이터가 조각으로 돌아 화면이 멈추지 않고(10만 회) 이론값과 나란히 · 표 보기 · 세션 기록 JSON/CSV · 봇 탭 · 계측 HUD.
- `analytics.test.js` 통과 · `?analytics=1` 정지 화면.

**P13 fx**
- 예고 표식(적대 붉은 테두리 · 종류별 색 · 채움 진행 = 틱 · 판정 순간 모양 안만 밝게) · 지속 효과 · 투사체 · 타격 불꽃 · 속성 오라 12 · 상태 표시 · 스킬 연출 · 포털 소용돌이 — 화면을 덮는 섬광 0.
- §9.6 표의 치수가 데칼과 같다(`view.fx.test.js`) · 풀 상한 · `?fixture=riftAffixes` · `riftWarrior` · `riftMage` · `riftGuardian` · `riftWitch` 정지 화면.

**P14 audio**
- §9.9 · §9.11의 소리 전부 합성 · 리미터 · 발음 상한 · 지속음 정리 · 탭 숨김 · unlock 규칙 · `audio.test.js` 통과. 실제 소리는 「사람이 확인할 것」에 무엇을 어떻게 들을지 + 조정 손잡이와 함께.

**P15 bot**
- §12.1 봇(세 전략 · 반응 지연 · 실수 · 피하기 · 동작별 스킬 규칙 · 마을 정비 · 레벨 선택 · 프리셋 4) · `headless` S1~S5 · `measure.test.js` · `perf.test.js` 통과 · `npm run measure` → `docs/MEASURE.md`(목표 · 측정값 · 판정).
- `__game.setBot(true)`로 화면에서 봇이 마을 → 균열 → 정비를 스스로 돈다(`autoCommit:false` — 모달에 멈추지 않는다 · §11.13). 측정 함수는 `makeSim`을 받는다.

**P16 content**
- 속성 6(번개 강화 · 순간이동 · 감옥 · 분열 · 역병 · 몰타르)과 잿빛 마녀가 §7.5 · §7.5b · §8.2 · §8.3 그대로 — **프레임워크 파일 · 레지스트리를 고치지 않고** 자기 훅 파일만.
- 위협 간격(감옥 + 역병 + 몰타르 동시)에서 묶인 채 맞는 판정 0 · `content.test.js` 통과 · `?fixture=riftAffixes` · `riftWitch`에서 자기 효과가 보인다(P13과 함께).

---

## 부록 A 식별자 목록

- **ReasonCode**(`reason.*`): `stub` · `busy` · `gold` · `materials` · `bagFull` · `stashFull` · `equipped` · `class` · `level` · `slot` · `twoHanded` · `notInTown` · `notInRift` · `noRift` · `collapsed` · `dead` · `notDead` · `locked`(균열 레벨) · `points` · `tier` · `req` · `maxRank` · `notLearned` · `name` · `slotTaken` · `rerollLocked` · `noOffer` · `nothing` · `notEligible` · `full` · `empty` · `cooldown` · `resource` · `noTarget` · `rooted` · `town` · `noItem` · `invalid` · `itemLocked`.
- **HintId**: §4.2.
- **효과 kind** · **투사체 visual**: §9.8.
- **look**(view 메시 ID): 무기 `sword axe mace greatsword greataxe wand staff` · 보조 `shield orb` · 방어구 `helm chest gloves boots belt` · 장신구 `amulet ring` · 마을 `portal riftStone stash npcSmith npcGrocer npcGambler npcMystic bonfire` · 마을 장식 건물 `smithy grocery tent tower`(`TOWN.buildings` — MapObject kind 'deco' · w/d/h 상자) · 균열 포털 `riftPortal`(getObject 정규화) · 소품은 tileset props의 kind.
- **환경음**: `cryptWind` · `cavernLava` · `townFire`.
- **PlayerStats 키**: §3.8. **StatKey**: §3.3 + `allPct` · `burnFrac` · `freezeAt` · `freezeDurPct`.

## 부록 B 문자열 키 (`data/strings.ko.js` — P0이 W0에 넣는다 · 이후 P10)

**데이터에서 나오는 키**(행마다 — 문면은 §7 표의 한국어 이름):

| 키 꼴 | 예 | 문면 출처 |
|---|---|---|
| `class.<id>` | `class.warrior` 전사 · `class.mage` 마법사 | |
| `res.<rage\|mana>` | 분노 · 마나 | |
| `dmg.<type>` | 물리 · 화염 · 냉기 · 번개 | |
| `rarity.<id>` | 일반 · 마법 · 희귀 · 전설 · 세트 | |
| `rank.<id>` | 일반 · 챔피언 · 정예 · 하수인 · 균열 수호자 · 사본 · 소환체 | |
| `slot.<EquipSlot>` · `islot.<ItemSlot>` | 주무기 · 보조 · 투구 · 갑옷 · 장갑 · 장화 · 허리띠 · 목걸이 · 반지 1 · 반지 2 / 반지 | |
| `mat.<id>` | 고철 · 비전 가루 · 망각의 정수 | |
| `mon.<id>` | §7.4 「이름」 열 · 수호자 §7.5b | |
| `affix.<id>.name` · `affix.<id>.desc` | 빠름 / 「이동 · 공격 속도가 빠르다 · 몸 주변 바람 줄 · 붙어서 처치하라」 | §7.5 이름 + 브리프 §3.5의 효과 · 표시 · 대응을 한 문장 |
| `node.<id>.name` · `node.<id>.desc` | 회전 베기 / 「무기를 뻗어 한 바퀴 돌며 둘레의 적 모두를 베고 살짝 밀어낸다」(피드백 1) | §7.2 + 브리프 §3.3 개념 |
| `branch.<cls>.<0..2>` | 분쇄 · 학살 · 수호 / 화염 · 냉기 · 번개 · 비전 | |
| `base.<id>.<tier>` | `base.sword.0` 낡은 검 | §7.7 단계 이름 |
| `afx.<id>.line` | `afx.str.line` 「힘 +{v}」 · `afx.skillDmg.line` 「{skill} 피해 +{v}%」 · `afx.cdr.line` 「재사용 대기시간 −{v}%」 | 아래 표 |
| `afx.<id>.p` / `afx.<id>.s` | 접두어(형용사) / 접미어(「~의」) | 아래 표 |
| `leg.<id>` · `legfx.<id>` | 불타는 소용돌이 / 「회오리가 0.6초마다 불타는 소용돌이를 남긴다」 | §7.9 |
| `set.<id>` · `setp.<pieceId>` · `set.<id>.b2` · `set.<id>.b4` | 강철 군주 · 강철 군주의 투구 … | §7.9 |
| `npc.<id>` · `npc.<id>.greet` | 대장장이 / 「무기든 갑옷이든, 고칠 건 고치고 팔 건 팔게.」(인사 한 줄 — 브리프 §9) · 잡화상 · 도박꾼 · 신비술사 · 보관함 · 균열석 · 마을 포털 | |
| `tileset.<id>` | 지하 묘지 · 잿빛 동굴 · 마을 | |
| `stat.<PlayerStats 키>` | `stat.sheetDps` 초당 피해 · `stat.ehp` 유효 생명 … | |
| `reason.<code>` | 부록 A 전부 — 예 `reason.gold` 「골드가 모자라다」 · `reason.level` 「레벨 {n}이 필요하다」 · `reason.bagFull` 「가방이 가득 찼다」 | |
| `hint.<id>.title` · `hint.<id>.body` | HintId 8 | §10.6 |
| `rare.a.0..23` · `rare.b.0..23` | 아래 | |
| `elite.a.0..15` · `elite.b.0..15` | 아래 | |
| `preset.<cls>.<0\|1>` | 분쇄 · 수호 / 학살 / 화염 / 냉기 · 번개 | |

**옵션 문면**(`afx.<id>.line` · 접두/접미어):

| ID | line | 어(p/s) | ID | line | 어(p/s) |
|---|---|---|---|---|---|
| str | 힘 +{v} | p 강인한 | lifeRegen | 초당 생명 회복 +{v} | s 재생의 |
| int | 지능 +{v} | p 현명한 | lifeOnHit | 적중 시 생명 +{v} | s 흡혈귀의 |
| vit | 활력 +{v} | s 곰의 | armor | 방어도 +{v} | p 단단한 |
| weaponDmg | 무기 피해 +{v}% | p 날카로운 | allRes | 모든 저항 +{v} | s 수호의 |
| attackSpeed | 공격 속도 +{v}% | s 신속의 | physRes | 물리 저항 +{v} | s 바위의 |
| critChance | 치명타 확률 +{v}% | p 정밀한 | fireRes | 화염 저항 +{v} | s 화로의 |
| critDamage | 치명타 피해 +{v}% | s 학살의 | coldRes | 냉기 저항 +{v} | s 겨울의 |
| physDmg | 물리 피해 +{v}% | p 무거운 | lightningRes | 번개 저항 +{v} | s 폭풍의 |
| fireDmg | 화염 피해 +{v}% | p 불타는 | moveSpeed | 이동 속도 +{v}% | p 날랜 |
| coldDmg | 냉기 피해 +{v}% | p 얼어붙은 | aoeDmg | 범위 피해 +{v}% | p 파괴적인 |
| lightningDmg | 번개 피해 +{v}% | p 번뜩이는 | eliteDmg | 정예에게 주는 피해 +{v}% | p 사냥하는 |
| skillDmg | {skill} 피해 +{v}% | p 숙련된 | thorns | 가시 피해 +{v} | s 가시의 |
| cdr | 재사용 대기시간 −{v}% | s 시간의 | goldFind | 골드 획득 +{v}% | s 탐욕의 |
| costReduce | 자원 비용 −{v}% | s 절제의 | magicFind | 아이템 발견 +{v}% | s 행운의 |
| lifePct | 생명 +{v}% | s 거인의 | xpPct | 경험치 +{v}% | s 배움의 |
| potionPct | 포션 회복 +{v}% | s 약초꾼의 | globePct | 체력 구슬 회복 +{v}% | s 샘물의 |

**희귀 이름**: `rare.a` = 핏빛 · 잿빛 · 서리 · 폭풍 · 어둠 · 해골 · 망령 · 균열 · 무쇠 · 황혼 · 독사 · 늑대 · 까마귀 · 용암 · 묘지 · 저주 · 은빛 · 칠흑 · 피안 · 맹세 · 사냥 · 파멸 · 고대 · 침묵(24) / `rare.b` = 송곳니 · 손아귀 · 갈퀴 · 비명 · 맹세 · 이빨 · 수의 · 서약 · 장막 · 심장 · 뿔 · 발톱 · 그림자 · 낫 · 가시 · 왕관 · 눈 · 날개 · 껍질 · 혀 · 망치 · 노래 · 종말 · 표식(24).
**정예 이름**: `elite.a` = 부패한 · 굶주린 · 미쳐버린 · 저주받은 · 타오르는 · 얼어붙은 · 썩어가는 · 피에 젖은 · 잊힌 · 분노한 · 끝없는 · 비틀린 · 검은 · 울부짖는 · 고대의 · 버려진(16) / `elite.b` = 도살자 · 포식자 · 망령 · 군주 · 사냥꾼 · 파수꾼 · 학살자 · 약탈자 · 고문자 · 수확자 · 집행자 · 감시자 · 파괴자 · 순례자 · 배신자 · 몰락자(16).

**ui · app 키**(P10이 문면을 다듬는다 · 꼴은 고정):

- `hud.*`: `life` 생명 · `potion` 포션 · `scroll` 귀환 두루마리 · `scroll.exit` 마을 · `scroll.exitTip` 균열을 깼다 — T 로 바로 마을로(두루마리를 쓰지 않는다)(최종 게이트) · `xp` 경험치 · `level` 레벨 {n} · `levelMax` 최대 · `points` 스킬 포인트 {n} — S · `gauge` 균열 게이지 · `lives` 생명 · `guardian` 균열 수호자 · `recall` 귀환 중… · `returnPrompt` Enter — 균열로 돌아가기 · `devBadge` 개발 세션 — 저장 안 됨 · `botBadge` 봇 관전 중 · `broken` 부서진 장비 · `target.affixes` 속성 · `key.lmb` 좌 · `key.rmb` 우.
- `banner.*`: `riftOpened` 균열 {n} — {tileset} · `gaugeFull` 균열 수호자가 나타난다 · `guardian` {name} · `complete` 균열 완료 · `levelUp` 레벨 {n}.
- `notice.*`: `bagFull` 가방이 가득 찼다 · `legendary` 전설: {name} · `set` 세트: {name} · `unlock` 균열 {n} 해금 · `durability` 장비 내구도가 떨어졌다 · `broken` {slot}이(가) 부서졌다 — 대장장이에게 · `saveBlocked` 저장되지 않는다(브라우저 저장소가 막혀 있다) · `saveBroken` 세이브가 손상돼 백업하고 새로 시작한다 · `contextLost` 그래픽 장치를 잃었다 — 복구를 기다린다 · `contextRestored` 복구됐다 · `noRecall` 귀환 두루마리가 없다 · `freeGiven` 잡화상이 {what} 하나를 그냥 주었다 · `accountRebuilt` 계정을 복구했다 — 보관함은 백업에 있다 · `settingsUnsaved` 설정이 저장되지 않는다.
- `panel.<id>.title` — PanelId 21개 전부(인벤토리 · 스킬 · 캐릭터 · 대장장이 · 잡화상 · 도박꾼 · 신비술사 · 보관함 · 균열석 · 균열 완료 · 쓰러짐 · 일시정지 · 설정 · 도움말 · 확인 · 안내 · 지도 · 분석 · 타이틀 · 캐릭터 선택 · 새 캐릭터).
- `title.*`: `name` RIFT HUNTER — 균열 사냥꾼 · `continue` 계속하기 · `select` 캐릭터 선택 · `new` 새 캐릭터 · `emptySlot` 빈 칸 · `delete` 삭제 · `deleteConfirm` {name}을(를) 지운다(백업은 남는다) · `overwriteConfirm` 이 칸의 {name}을(를) 덮어쓴다(백업은 남는다) · `touch` 키보드와 마우스가 필요하다 · `namePlaceholder` 이름(12자) · `defaultName.<cls>` 이름 없는 전사 · 이름 없는 마법사.
- `pause.*`: `resume` 계속 · `settings` 설정 · `help` 도움말 · `quit` 타이틀로 · `riftNote` 균열 진행은 저장되지 않는다 — 새로 고치면 마을에서 시작하고 열린 균열은 닫힌다(주운 것 · 장비 · 골드 · 경험치는 남는다).
- `settings.*`: `volMaster` 마스터 볼륨 · `volSfx` 효과음 · `volAmbient` 환경음 · `quality` 화질 · `quality.low/medium/high` 낮음/보통/높음 · `damageNumbers` 피해 숫자 · `alwaysLabels` 늘 이름표 · `hideNormal` 일반 등급 숨기기 · `advancedTooltips` 고급 툴팁 늘 켜기 · `meterHud` 계측 HUD · `screenShake` 화면 흔들림.
- `help.*`: `tab.controls` 조작 · `tab.affixes` 정예 속성 · `tab.rules` 규칙 · `controls.<n>`(§10.6 안내 카드의 줄들) · `rules.lives` 균열마다 생명 3 — 생명 0에서 쓰러지면 균열이 무너지고 수호자 보상과 해금을 잃는다 · `rules.repair` 쓰러지면 장착 장비 내구도 −10% · `rules.unlock` 클리어하면 다음 레벨 · 무사망이면 +2 · `rules.telegraph` 붉은 테두리 표식은 적의 공격이다 — 걸어서 피할 수 있다.
- `death.*`: `title` 쓰러졌다 · `lives` 남은 생명 {n} · `lastLife` 다음에 쓰러지면 균열이 무너진다 · `repair` 수리비 {n} 골드 · `respawn` Enter — 마을에서 부활 · `collapse` 균열 붕괴 — 수호자 보상과 해금을 잃었다(주운 것은 남는다) · `toTown` Enter — 마을로 · `killedBy` {name}에게 쓰러졌다 · `lost` 잃은 것: 수호자 보장 드랍 2 · 해금 +{n}.
- `complete.*`: `title` 균열 {n} 완료 · `time` 시간 · `kills` 처치 · `deaths` 사망 · `drops` 획득 · `gold` 골드 · `xp` 경험치 · `upgrades` 업그레이드 · `unlock` 균열 {n} 해금 · `noDeathBonus` 무사망 +2 · `record` 최고 기록 · `ok` Enter — 계속 줍기 · `toTown` T — 마을로. (피드백 1: `gold` 문면 → 「주운 골드」)
- `inv.*`: `equip` 장착 · `unequip` 해제 · `sell` 팔기 X · `salvage` 분해 D · `toStash` 보관 F · `sort` 정렬 Z · `gold` 골드 · `compare` 장착 중 · `delta` 변화 · `req` 요구 레벨 {n} · `sellPrice` 판매가 {n} · `dur` 내구도 {n}/{m} · `durZero` 내구도 0 — 능력치 꺼짐 · `tier` 티어 {t} · `range` {a}–{b} · `setCount` ({n}/4) · `lock` 잠금 L · `locked` 잠김 · `area` E — 영역 바꾸기.
- `skill.*`: `points` 남은 포인트 {n} · `rank` {r}/{m} · `learn` 찍기 Enter · `bindRmb` 우클릭 칸 R · `bind` 칸 {n} · `before` 지금 · `after` 찍으면 · `locked.tier` {n}점을 더 써야 열린다 · `locked.req` {name}이(가) 먼저 필요하다 · `cost` 비용 {n} · `cd` 재사용 {n}초 · `dmg` 피해 {a}–{b} · `transform` 변형.
- `char.*`: 시트 줄 이름(= `stat.*`) · `drArmor` 피해 감소 {p}% · `drRes` {type} 감소 {p}% · `effMf` (유효 {p}%) · `playTime` 플레이 시간.
- `shop.*`: `buy` 사기 · `buyback` 되사기 · `repair` 일괄 수리 R — {n} 골드 · `repairNothing` 고칠 것이 없다 · `salvage` 분해 · `salvageAllNormal` 일반 등급 전부 분해 · `craft` 제작 · `craftCost` 고철 {a} · 가루 {b} · {n} 골드 · `potions` 체력 포션 · `scrolls` 귀환 두루마리 · `qty` 수량 {n} · `free` 무료로 받기 · `gamble` 도박 · `gambleOdds` 나올 확률 · `reroll` 옵션 재굴림 · `rerollCost` {n} 골드 · 가루 {d} · {k}번째 · `rerollPick` 하나를 고른다 · `rerollKeep` 기존 유지 · `reset` 스킬 초기화 — {n} 골드 · `resetConfirm` 스킬 포인트를 전부 돌려받는다 · `before` 전 · `after` 후 · `lack` {n} 모자람(최종 게이트 — `pnlCommon.costRows`: 모자라면 「후」에 음수 대신 모자란 양 · 붉게) · `stashTitle` 보관함(계정 공유) · `bulkSell` 일괄 판매 V · `bulkSellConfirm` {n}개를 {g} 골드에 판다 · `repairPartial` 부분 수리 — {n} 골드 · `craftDist` 나올 옵션 수 · 티어 · `gambleSlotPrice` {slot} — {n} 골드.
- `riftStone.*`: `level` 균열 {n} · `monLevel` 몬스터 레벨 {n} · `hp` 몬스터 생명 ×{v} · `dmg` 몬스터 피해 ×{v} · `ilvl` 아이템 레벨 {n} · `rarity` 등급 보정 · `gold` 골드 ×{v} · `xp` 경험치 ×{v} · `affixes` 챔피언 속성 {a} · 정예 속성 {b} · `best` 최고 기록 {t} · `none` 기록 없음 · `locked` 잠김 · `open` Enter — 균열 열기 · `closeOpen` 열린 균열을 닫는다 · `unlockRule` 클리어 +1 · 무사망 +2 · `leftLoot` 남은 전리품 {n}개 · `recommended` 추천 · `step` 균열 {n}보다 생명 {h} · 피해 {d}(최종 게이트 — 균열 2 이상 · 앞 레벨 대비 % · 배율은 0.1 아래면 소수 셋째 자리).
- `analytics.*`: `tab.sim` 드랍 시뮬레이터 · `tab.tables` 표 보기 · `tab.session` 세션 기록 · `tab.bot` 봇 · `run` 굴리기 · `cancel` 취소 · `n` 횟수 · `theory` 이론값 · `sim` 시뮬값 · `err` 오차 · `killsToLegend` 전설 하나까지 처치 수 · `json` JSON 내려받기 · `csv` CSV 내려받기 · `botOn` 봇 자동 사냥 켜기 · `botOff` 끄기 · `strategy.<id>` 기본 · 무회피 · 도전 · `meter.<key>`(DPS · 받은 피해/초 · 분당 처치 · 시간당 경험치 · 시간당 골드 · 이번 판 장비 · 경과 · 게이지 속도 · 노리는 수).
- `confirm.yes` 예 Enter · `confirm.no` 아니오 Esc · `fatal.webglTitle` 그래픽을 시작하지 못했다 · `fatal.webglBody` 이 브라우저나 기기에서 WebGL을 쓸 수 없다 — 다른 브라우저로 열어 본다 · `audio.hint` 클릭하거나 키를 누르면 소리가 켜진다.
- **W2 확정(통합 게이트)**: `strings.ko.js`에 더한 키 — P10 W2 단락(`hud.status.slow|root` · `hud.immune` · `hud.portal.recall|exit` · `hud.gaugeDone` · `hud.collapsed` · `label.gold|potion|material` · `notice.potionFull|noPotion|lifeFull|recallCancel|skillEmpty|saveFuture` · `title.charLine|slot|deleteHint|back|navHint|version|continueNone` · `newChar.*` · `pause.quitConfirm|hint` · `settings.on|off|hint` · `help.hint|affixes.intro|rules.potion|rules.recall` · `death.summary` · `complete.other` · `hint.close|openHelp` · `map.hint`) · P12 단락(`analytics.f.*` · `analytics.sec.*` · `analytics.state.*` · `analytics.hist.*` · `analytics.hint.*` · `analytics.tbl.*` · `analytics.ses.*` · `analytics.result.complete|collapse|abandon` · `analytics.bot.*` · `analytics.log.*` · `analytics.gearPerKill|goldPerKill|legPerKill|killsToLegendMean|maxGap|errNote` — 59개) · `shop.salvageConfirm` {name}을(를) 분해한다 — 되돌릴 수 없다(전설 · 세트 한 개 분해 확인). `reason.level` 문면은 「레벨 {n} 이상이어야 한다」(숫자 뒤 조사가 수마다 달라서 — 꼴만 고정). `notice.saveFuture`는 §11.6의 「미래 버전 세이브 — 읽기 전용 안내」.
- **피드백 1(2026-10-12 · 게임플레이 담당)**: 바꾼 문면 — `skill.bash.name|desc` 가르기 · 「앞쪽 반원을 가로로 베어 닿는 적 모두를 친다 …」 · `node.groundStomp.name|desc` 회전 베기 · 「무기를 뻗어 한 바퀴 돌며 둘레의 적 모두를 베고 살짝 밀어낸다」 · `node.aftershock.name|desc` 연속 회전 · 「회전 베기 0.5초 뒤 한 번 더 돈다 — 그때 서 있는 자리에서 약하게」 · `skill.x.aftershock` 연속 회전 · `legfx.tremorFists` 「회전 베기가 앞으로 뻗는 충격파를 낸다」. 더한 키(ui 단계가 쓴다 — 지금은 아무도 읽지 않는다): `skill.x.knock|.v` 「넉백」 「{v}m」(스킬 패널 extra — `describeSkill().extra.knock`) · `label.goldPicked` 「+{n} 골드」(골드를 주운 순간 머리 위 숫자 — `DROP_PICKED{kind:'gold', amount}`) · `newChar.kit` 「시작 지급 — 체력 포션 {potions} · 귀환 두루마리 {scrolls} · 기본 무기 · 갑옷」(`data/economy.js` `START.potions` 5 · `START.scrolls` 3) · `hint.potion.title|body` — ui 단계가 문면을 바꿨다: 「Q — 체력 포션」 · 「생명이 낮다 — Q로 체력 포션을 마시면 생명을 바로 {heal}% 채운다(지금 {n}개 · 재사용 대기 {cd}초) …」(`POTION.heal` · `POTION.cd`).
- **피드백 1(ui 단계가 더하거나 바꾼 키)**: `hud.potionTip` 「체력 포션 — Q 로 마신다(생명을 바로 채운다)」 · `hint.controls.potion` 「Q: 체력 포션 — 지금 {n}개 · 생명을 바로 {heal}% 채운다(재사용 대기 {cd}초) · 생명 구슬 왼쪽의 붉은 병」 · `skill.radius` 「반경 {n}m」 · `glyph.groundStomp` 「회전」(규칙대로면 「회베」) · `complete.gold` 「골드」 → 「주운 골드」 · `hint.potion.*` 새 문면(위). 이제 읽는 곳: `skill.x.knock|.v`(pnlLogic) · `label.goldPicked`(labels.addGold) · `newChar.kit`(새 캐릭터 패널) · `hint.potion.*`(UIRoot 저생명 안내).
- **피드백 2(2026-10-12)**: 더한 키 — `inv.overflow` 「가방이 넘쳤다 ({n}/{max}) — 정리할 때까지 줍지 못한다」(D4 — 한 키를 가방 격자 밑 줄 · 넘친 가방의 줍기 실패 알림 · 캐릭터를 읽었을 때 알림이 같이 쓴다 · ui 담당이 따로 더한 같은 문면의 `notice.bagOverflow`는 통합에서 이 키로 합쳤다) · `complete.upgradesNote` 「장비 점수 +{pct}% 넘게」(피드백 2 다듬기: 「이상」 → 「넘게」 · D5 — 완료 패널 「그중 더 나은 장비」의 문턱 · {pct} = `COMPARE.upgradeGain` × 100). 바꾼 문면 — `hint.skills.body` 끝에 「(여는 동안 게임이 멈춘다)」(D6) · `node.crusher.desc` 「기절 · 빙결 · 냉기 · 감속 중이거나 막 밀려난(넉백 뒤 0.5초) 대상에게 주는 피해가 늘어난다」(D10) · `node.meteor.desc` 「잠시 뒤 지점에 운석이 떨어지고 바닥이 불탄다 — 벽 너머를 누르면 이쪽 벽 앞에 떨어진다」(D8).
