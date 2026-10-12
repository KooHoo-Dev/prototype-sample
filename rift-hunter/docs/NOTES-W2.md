# NOTES-W2 — 웨이브 2 통합 게이트

W2 여덟 패키지(P9 app · P10 ui-core · P11 ui-panels · P12 analytics · P13 fx · P14 audio · P15 bot · P16 content)를 W1 완성본 위에서 한 번에 맞물렸다. 고친 것은 최소한이고, 방향은 계약의 공개 API 쪽이다. 계약이 비어 있었거나 구현과 어긋난 곳은 CONTRACT.md에 「W2 확정」으로 적었다(20곳).

## 1. 게이트 결과(마지막 실행)

| 명령 | 결과 |
|---|---|
| `npm run build` | ✓ built in 1.64s · 오류 0 · JS 1 청크(1,361 kB / gzip 412 kB) |
| `npm test` | tests 633 · pass 633 · fail 0 · todo 0 · 54초 |
| `npm run check:dist` | `DIST ok — /gallery/rift-hunter/ · 요청 3건(200 3) · JS 청크 1개 · 표식까지 2818ms` |
| `release/boot.png` | 직접 봤다 — 마을 위 타이틀 패널(계속하기 흐림 · 캐릭터 선택 · 새 캐릭터 포커스 · 버전 0.1.0) |

게이트를 열 때의 상태는 `npm test` 633개 중 2개 실패였다.
- `gameSim.test` 「디버그 명령 … killAll」: P16 분열 사본이 살아 남았다.
- `ui.strings.test`: P12 분석 키 56개가 없었다.

## 2. 고친 것

| 파일(소유) | 무엇 · 왜 |
|---|---|
| `src/data/strings.ko.js`(P10) | P12 분석 패널 키 59개(NOTES-P12 §1 — 이어 붙여 쓰는 `analytics.result.*` 셋 포함)를 더했다. `shop.salvageConfirm` 「{name}을(를) 분해한다 — 되돌릴 수 없다」도 더했다(NOTES-P11 #1). |
| `src/ui/pnlShop.js`(P11) | 전설 · 세트 한 개를 분해할 때 확인 문면이 「분해」 한 단어뿐이었다. 이제 `shop.salvageConfirm`에 아이템 이름(`lineText(itemLines(item)[0])`)을 넣어 묻는다. |
| `src/ui/analytics/tablesTab.js`(P12) | 몬스터 표의 저항 열 머리 `'res.phys'` 등 리터럴이 문자열 키 검사(`res.` 접두)에 걸렸다. 이 머리는 데이터 필드 경로다. 그래서 `DMG_TYPES`에서 만들도록 바꿨고, 값도 `m.res[d]`로 읽는다. 화면은 그대로다. |
| `src/sim/GameSim.js`(P2) | `debugKillAll`이 사망 훅이 새로 세운 몬스터(분열 사본 — §8.2)를 남겼다. 이제 살아 있는 것이 없을 때까지 `resolveDeaths`를 되풀이한다(상한 4번). 브라우저 `__game.killAll()`도 같이 고쳐진다. |
| `src/data/keybinds.js`(P9) | `PANEL_KEYS.analytics = {cancel:'KeyX', json:'KeyJ', csv:'KeyC'}`를 더했다. P12 코드 기본값과 같은 값이라 데이터 표에서 읽게만 바뀐다(NOTES-P12 §2-6). |
| `src/sim/monsters/guardians/ashWitch.js`(P16) | 잿빛 마녀가 순간이동할 때 연출과 소리가 없어 「뚝 옮겨」 보였다(NOTES-P16). 이제 `MON_ACT{actId:'blink'}`과 함께 `AFFIX teleportOut`(떠난 자리) · `teleportIn`(도착 자리)을 `affixId: null`로 낸다. P13 · P14는 이 두 `what`을 이미 그리고 울린다(보라 빛기둥 · `teleportFx`) — 그쪽 코드는 고치지 않았다. `content.test` · `guardians.test` 통과. |
| `docs/CONTRACT.md` | 「W2 확정」 20곳(아래 3). |

## 3. 계약 수정 목록(「W2 확정」)

1. **§4.2 `AFFIX`**: `jailWarn` · `plagueWarn` · `mortarFire`의 x, z는 시전한 몬스터의 자리다. 마녀 순간이동은 `teleportOut/In`을 `affixId: null`로 낸다. 구독자는 `affixId`에 기대지 않는다.
2. **§4.3 `PAUSED.reason`**: reason은 `menu` · `modal` · `blur` · `hidden` · `debug` · `context` 여섯이다.
   - `menu`는 맨 위 패널이 일시정지 · 설정 · 도움말일 때, `modal`은 그 밖의 모달일 때다.
   - 전환 막 · 히트스톱 · 마을 패널은 일시정지가 아니다.
   - audio는 `menu` · `modal`에서 지속음만 줄인다. 탭 숨김에서는 app이 `setPaused(true)`를 부른다.
3. **§6.8 `debugKillAll`**: 분열 사본까지 되풀이해 쓰러뜨린다.
4. **§6.12 audio가 읽는 상태를 넓혔다**:
   - `player.pos` · `recall` · `lowLife` · `dead`
   - 처음 보는 몬스터 ID마다 한 번 `rift.mons[].{typeId, rank}`
5. **§6.16 봇**:
   - 버스를 구독하지 않는다. INTERACT는 `state.town.lastInteract`로 읽는다.
   - 덧붙인 것: `RANDOM_BUILD` · `levelOverride` · `abandonRift` · `runSession` 선택 인자 · `BOT.priority` guardian/minion.
6. **§8.2 감옥 보수 규칙(P16)**:
   - 끝나지 않은 적대 지속 효과와 겹치면 감옥을 시작하지 않는다.
   - 바닥 위협은 11m 안 + 벽 시야일 때만, 사라짐 중에는 시작하지 않는다.
   - 쓰러뜨린 적중에도 번개 불꽃이 난다. 수호자는 분열하지 않는다.
7. **§8.3 잿빛 마녀**:
   - 이동: 10m 밖이거나 시야가 없으면 다가오고, 안에서는 제자리에 선다. 거리는 순간이동이 벌린다.
   - 시전은 피해로 끊기지 않는다(기절 · 빙결만 끊는다).
   - 소환은 위협 거리 안에서만 한다.
8. **§9.7 연출(P13)**:
   - 궁수 조준선과 시전 빛은 P13이 그린다.
   - 입자 2,000 = 시뮬 1,100 + 먼지 300 + 스프라이트 600.
   - 낙하체는 `from`이 있을 때만 그린다. 순간 연출에는 상태 대체 경로가 있다.
9. **§9.11 소리(P14)**:
   - UI 버스 볼륨 = `volSfx × MIX.ui`.
   - 일시정지는 두 가지다(위 2).
   - 몰림을 줄이고, 우선순위 5는 예외다.
   - 일반 버튼 클릭 이벤트는 없다.
10. **§10.1 위젯 확장**:
    - `gridNav` · `listNav`의 `opts{onFocus, onEdge, wrap, start}` · `tabs(…, onChange)` · `button(…, params)` · `bar(host)` · `el`.
    - 키 대체 경로.
    - UIRoot에 `isOpen` · `respawnFromPanel` · `botOn` · `minimap.tiles`를 더했다.
    - INTERACT 패널은 UIRoot가 연다.
    - 계측 HUD는 UIRoot가 만든다.
11. **§10.2 패널 규칙**:
    - 새 캐릭터 덮어쓰기 확인은 패널이 한 번 묻고, app은 백업만 한다.
    - 사망 패널의 Escape는 일시정지를 연다.
    - Enter 버퍼가 둘이다(사망 전 · 막 걷히는 중 1.2초).
    - 봇이 켜져 있으면 모달 안내도 비모달로 낸다.
    - 디버그 step에서 막 · Enter 버퍼는 벽시계로 흐른다.
12. **§10.9 분석(P12)**:
    - 봇 로그 = 공개 이벤트로 쓴 관전 기록.
    - 불운 보정 켬의 이론값 = 정상 분포로 섞은 값.
    - 판정 색: |오차| ≤ 3% 또는 |z| < 4.
    - 표 열 이름 = 데이터 필드 이름.
    - 패널을 닫으면 시뮬레이터가 멈춘다.
13. **§11.4 전환 막(P9)**:
    - commit 직전에 `ui.closeAll('code')`를 부른다.
    - 막이 걷히는 중에 새 요청이 오면 막을 다시 내린다.
    - 막 없이 남은 `pendingTravel`은 다음 프레임에 처리한다.
14. **§11.5 `PANEL_KEYS.analytics`**.
15. **§11.7 쿼리 해석**:
    - 상태가 필요한 패널을 `?panel` 하나로만 주면 `PANEL_FIXTURE` + dev로 띄운다.
    - 모르는 키는 dev로 바꾸지 않는다.
    - `?class` · `?level` · `?rift` · `?scene=town` 조합 규칙.
16. **§11.8 `__game`**: `sim` · `actions`를 더했다. `step(n)`은 막만 진행하고, 봇 입력을 쓰고, 모달이 열려 있어도 step한다(디버그 전용).
17. **§11.13 봇 + 포커스**: 봇이 켜져 있으면 blur에서 멈추지 않는다. 멈추게 하는 패널은 `BOT_HALT_PANELS`다.
18. **§12.1 마법사 카이팅의 박자 · 싸움 기억 · 봇이 읽는 자기 상태(P15)**.
19. **§12.4 S1 · S4 · measure.test의 해석(P15)**.
20. **부록 B**: W2에 더한 키 목록, `reason.level` 문면, `notice.saveFuture`.

## 4. 교차 대조(테스트가 못 잡는 것 — 스크래치 스크립트로 확인)

- **이벤트 69개(`EV` 전부)**: 발행 지점과 구독 지점을 이벤트 이름으로 짝지었다. 발행 payload의 키와 구독자가 읽는 필드를 비교한 결과, 발행하지 않는 필드를 읽는 곳은 0이다.
  - payload를 통째로 넘기는 처리기도 직접 읽었다: FxLayer `_onEffectHit · _onHit · _onMonDied · _onActionStart/Hit · _onAffix · _onMonSpawned · _onGuardian · _onProjEnd`, AudioEngine `_onHit · _onMonAct · _onMonDied · _onPaused`, UIRoot `_onDrop · _onInteract · _onSkillFail · _onScene · _onFade · _onScreen`, labels `addHit`.
  - 구독자가 없는 이벤트: `GAUGE` · `LIVES` · `PORTAL_CLOSED` · `MATERIALS` · `XP` · `STATS_CHANGED`(일부는 P11 패널이 다시 그릴 신호로만 쓴다). 모두 상태에서 읽으므로 문제없다.
  - `HIT`의 출처는 전부 플레이어 쪽(직접 · 화상 · 가시)이다. 그래서 ui의 「플레이어가 준 피해 숫자」 규칙과 맞는다.
- **RunSummary**: 완료 · 사망 패널, 봇 탭, 세션 탭, 내보내기가 읽는 필드가 모두 §3.9 안에 있다.
- **ui · app이 부르는 `sim.*` 명령**: 전부 `GameSim.prototype`에 있다(33개 확인). `actions.*` · `ui.*` 호출도 전부 실제 메서드다.
- **이어 붙여 만드는 문자열 키**를 실제 표로 풀어 확인했다: 설정 · 패널 제목 · 안내 · 분석 표 · 탭 · 결과 · 전략, 도움말 탭 · 조작 줄 · 규칙, 그리고 모든 노드 × 랭크의 `nodeStatRows`. 빠진 키는 0이다.
- **화면에 키 원문이 보이는가**: 렌더된 `#ui-root` 텍스트를 훑었다. 대상은 상점 4 · 보관함 · 균열석 · 인벤토리 · 스킬 · 캐릭터 · 대장장이 탭 4 · 분석 탭 4와 표 9 · 도움말 탭 3 · 설정 · 일시정지 · 지도 · 고정 상태 8 · 계측 HUD다. 키 원문은 0이다. 몬스터 표의 `res.phys` 등 저항 열 머리는 의도한 데이터 필드 이름이다.

## 5. 헤드리스 통합 스모크(실제 구현 전부 — `docs/_scratch/smoke.mjs` · 지웠다)

1. **시작 캐릭터 두 클래스**: 마을 → 균열 1을 스크립트 입력(`scriptedClear` learn)으로 끝까지 돌렸다.
   - 전사: 502초 · 사망 0 · HIT 1022 · MON_DIED 310 · PLAYER_HIT 1364.
   - 마법사: 473초 · 사망 1.
   - 완료 뒤 `RIFT_COMPLETE` 1 · `UNLOCK` · XP · DROP_SPAWN · LEVEL_UP이 났고, 해금 2 · 기록 complete가 남았다.
   - 이어서 `leaveRift` → 마을 → `sellMany` · `repairAll`(마법사: 15골드에 2칸) → 균열 2 열기 → 300틱. 불변식(유한수 · 생명 범위 · 골드 · 재료 ≥ 0 · 아이템 ID 유일)이 지켜졌다.
2. **실패 종료**: 시작 전사로 균열 10을 돌렸다.
   - 사망 3 → 붕괴(`RIFT_COLLAPSE` 1 · `PLAYER_DIED` 4).
   - 해금은 그대로였고, 부활하면 마을이다. 붕괴한 균열로 돌아가기는 막힌다. 기록은 collapse다.
3. **봇**(basic · autoCommit) 두 클래스, 3만 틱:
   - 전사: 2판 완료, 레벨 6, 해금 4, 거래 5, 장착 21.
   - 마법사: 3판 완료, 레벨 7, 해금 5.
   - 같은 시드로 두 번 돌린 해시가 같다.
4. **퍼즈**: 균열 3에서 `randomInputs`로 1만 틱, 무작위 명령 104번(장착 · 팔기 · 스킬 · 정렬 · 팩 소환 · 바 배정), 사망 8. 예외 · NaN 0, 불변식이 지켜졌다.
5. **W2 콘텐츠**:
   - 균열 8에 속성 6을 하나씩 단 정예 6팩을 세웠다. AFFIX가 실제로 났다: mortarFire 15 · plagueWarn 13 · jailWarn 9 · sparks 6 · teleportOut/In 7/7. 그 뒤 `debugKillAll`이 사본까지 0으로 만든다.
   - 잿빛 마녀 판(균열 3 · 마법사 L10 · 무적 · 시드 1)은 게이지 570초 → 수호자 단계 약 120초 → 완료(`RIFT_COMPLETE` 1).

## 6. 브라우저 스모크(헤드리스 `probe:screen` · dev 5420 — 내장 브라우저 없음)

- **고정 상태 15개 전부**(`--step 0 --eval "api.loadFixture(id)"`): errors() 0이고, 스크린샷을 모두 직접 봤다.
  - riftAffixes: 감옥 원 · 역병 웅덩이 · 몰타르 표식 · 냉기 노바 · 보호막 구체 · 순간이동 보라 · 불꽃이 보인다.
  - riftWitch: 잿불 비 원 5 · 하수인 · 수호자 바 · 속성.
  - riftGuardian: 대지 분쇄 부채.
  - riftDeath: 사망 패널(처치자 · 생명 1 · 수리비).
  - riftComplete: 완료 패널(해금 · 무사망 · 최고 기록).
  - lowLife: 귀환 바 · 감속 · 속박.
  - riftLoot: 이름표 쌓임 · 빛기둥.
- **패널**: inventory · stash · character · blacksmith · general · gambler · mystic · skills · riftStone · map · title · help · settings · analytics · `?fresh=1`. 모두 errors() 0이다.
  - 툴팁의 장착 중 비교와 변화 줄이 녹/적으로 갈린다.
  - 대장장이의 일괄 판매 전 · 후, 신비술사의 후보 · 비용 전 · 후, 균열석의 추천이 보인다.
- **실제 sim 장면**:
  - `?class=warrior&rift=3` · `?class=mage&rift=3`: 첫 균열이라 조작 안내 카드가 뜬다(계약대로).
  - `?class=warrior&level=18&rift=10` + 정예(감옥 · 몰타르) · 챔피언 팩, `?class=mage&level=20&rift=12&preset=1` + 정예(역병 · 순간이동).
  - `?class=warrior&level=6&rift=2&bot=1`, 1500틱: 게이지 21% · 봇 관전 배지 · 비모달 안내.
- **1920×1080**(스크래치 사본 프로브 `PROBE_W/H`): riftElites · blacksmith · analytics · riftComplete · inventory. 겹침이나 잘림이 없다.
- **끝까지 이어지는 흐름**: 합성 키와 actions로 실제 순서를 밟았다. errors() 0이다.
  1. `?fresh=1` → `newChar`
  2. 마을 안내 카드 → Enter
  3. `actions.openRift(1)` → 막 → 균열 → 조작 안내 카드 → Enter
  4. 정예 + 생명 1 → 쓰러짐 → 사망 패널이 뜨기 전 Enter(버퍼) → 부활 막 → 마을(생명 2 · 복귀 안내)
  5. Enter → 막 → 균열 복귀
  6. `completeRift` → 완료 패널 → T → 마을. 기록 complete · 해금 2.
  7. I → 인벤토리, Esc → 닫힘, Esc → 일시정지, Esc → 닫힘, ` → 분석.
  8. `quitToTitle` → 타이틀.
- **같은 판 반복(S6 약식)**: `memory()`를 봤다.
  - 새 시드로 6판: 지오메트리 162 → 176(판마다 +2~5).
  - 같은 시드로 10판: 162 → 170, 7판째부터 그대로다.
  - 텍스처 2 · 프로그램 30 · DOM 295 · 리스너 117은 변하지 않는다.
  - 판단: 맵마다 새는 것이 아니라, 처음 보는 외형(템플릿 · 장비 · 소품 변형)마다 캐시가 느는 꼴로 보인다(같은 시드에서 멈춘다). 확정은 리뷰 S6에서 20판 이상으로 한다.

### 디버그 step 흐름 검사의 함정(다음 화면 확인 담당이 알 것)

- `__game.step(n)`은 모달이 열려 있어도 sim을 민다. 그래서 안내 카드가 떠 있는 동안 몬스터가 플레이어를 칠 수 있다. 실제 루프는 모달에서 멈춘다(§11.3).
- 전환 막은 둘로 나뉘어 흐른다. app의 막은 step의 DT로 끝나고, UI의 막 판단 · Enter 버퍼는 벽시계로 흐른다. 마을 step은 한 번에 약 3ms라, 막이 끝난 직후 Enter를 합성하면 ui가 그것을 「막 동안의 Enter」로 받아 실제 시간 0.2초 뒤에 처리한다.
- 그래서 흐름 스크립트는 전환 뒤에 실제 시간을 기다려야 한다(`await sleep(600)`). 실제 플레이에서는 두 막이 같은 `dtReal`로 흐르므로 문제가 아니다.
- `probe:screen`의 CDP 응답 대기는 10초다. 긴 흐름은 스크래치 사본에서 대기를 늘려 돌렸다. `scripts/`는 템플릿이라 고치지 않았다.

## 7. 다음 단계(밸런스 게이트 · 화면 패스 · 리뷰)가 패키지별로 알아야 할 것

- **밸런스 게이트(§12.7 — 첫 과제)**: P15의 `docs/MEASURE.md`는 ✓17 ✗20 —4다. 게임이 봇에게 쉽다.
  - 적정 레벨 사망/판이 0.01 / 0.00이고, 무회피도 0이다.
  - 해금 + 3 붕괴가 30% / 0%다.
  - 균열 10 해금이 약 1.06시간, 레벨 30이 약 2.5시간으로, 둘 다 목표의 절반이다. 상승 조건 충족이 약 100%다.
  - 챔피언 · 정예 처치 시간이 짧다.
  - 균열 30을 넘으면 업그레이드가 0%다. 요구 레벨 = 아이템 레벨이 캐릭터 캡 30을 넘기 때문이다. 이것은 설계 결정 거리다.
  - 손잡이는 MEASURE.md의 ✗ 행에 있다. P16 마녀 손잡이(`hp` 0.9 · 소환 쿨 · cap)와 속성별 효과 크기(감옥은 서서 싸우는 상대에게 0%, 번개는 전사에게 경계선)도 같이 본다.
  - 수치를 바꾸면 `npm run measure`를 다시 돌린다(약 7분 · 결정적).
- **P9 app**: 개발용 캐릭터(`?class` · `?rift` 「바로 해 보기」)는 안내를 저장하지 않는다. 그래서 세션마다 첫 균열에서 조작 안내 카드(모달 · Enter 한 번)가 뜬다. 계약대로라 두었다. 귀찮다는 피드백이 오면 `makeDevCharacter` 뒤에 `char.hints`를 채우면 된다.
- **P10 ui-core**:
  - 스킬 바 아이콘이 이름 첫 글자라, 전사의 「지면 강타」와 「지진」이 둘 다 「지」다. 색이 같은 갈래라 구분이 약하다(화면 패스).
  - 큰 지도(Tab)가 비모달 큰 안내 카드와 오른쪽에서 겹친다(안내 6초 · 지도는 투명 바탕).
- **P11 ui-panels**: 대장장이 · 잡화상을 열면 재고 첫 줄 툴팁이 키보드 포커스로 바로 뜬다. 그 툴팁이 오른쪽 가방 격자 위를 덮는다(1280 · 1920 둘 다). 마우스를 움직이면 사라지는 설계이지만, 처음 화면에서 가방이 안 보인다. 화면 패스에서 툴팁 자리(재고 목록 왼쪽 · 위)를 고를 것.
- **P12 analytics**: 봇의 결정 기록(`bot.log`)을 보이려면 `actions.botLog()`가 필요하다(app이 `this.bot?.log`). 지금은 공개 이벤트로 쓴 관전 기록이다(계약 §10.9 W2 확정).
- **P13 fx · P14 audio**: 마녀 순간이동은 이제 `AFFIX teleportOut/In`으로 보라 빛기둥과 소리가 난다. 실시간 느낌은 사람이 확인한다.
- **P15 bot**: 브라우저에서 봇(1500틱)이 게이지를 올리며 돌았고 errors() 0이다.
- **P16 content**: 감옥 보수 규칙과 마녀 이동 해석은 계약에 반영했다(§8.2 · §8.3 W2 확정).
- **리뷰(S6)**: 위 6의 지오메트리 추이를 새 시드 20판 이상으로 확인한다. 캐시 상한이 있는지(ActorLayer 외형 · WorldLayer 소품 변형) 본다.

## 8. 남은 문제

| 심각도 | 영역 | 문제 | 제안 |
|---|---|---|---|
| major | 밸런스(P2 · P3 · P6 데이터) | 봇 측정이 목표 20개를 벗어난다(쉽다 · 진행이 2배 빠르다 · 균열 30 위에서 업그레이드 0). | 밸런스 게이트(§12.7)에서 MEASURE.md ✗ 행의 손잡이로 조정한다. 레벨 캡과 요구 레벨은 Jay의 결정 거리다. |
| minor | view · 메모리 | 새 시드마다 지오메트리가 +2~5씩 는다(같은 시드는 +8에서 멈춘다). | 리뷰 S6에서 20판 이상 돌리고, 캐시 키를 확인한다. |
| minor | P11 화면 | 상점을 처음 열면 툴팁이 가방 격자를 덮는다. | 툴팁을 포커스 칸의 반대쪽(재고 목록 왼쪽)에 놓는다. |
| minor | P10 화면 | 스킬 아이콘의 첫 글자가 겹친다(「지」 × 2). | 두 글자로 하거나 갈래 안 순번 · 모양을 덧붙인다. |
| minor | P14 | 일반 버튼(균열석 레벨 고르기 등)에 딸깍 소리가 없다(`EV.UI_CLICK`이 없다). | 원하면 계약에 즉시 이벤트를 더한다. 계약 변경이라 Jay · 리뷰가 고른다. |

## 9. 확인하지 못한 것(사람이 확인할 것)

- 실시간 재생: 막의 CSS 전환, 알림 · 배너 · 피해 숫자, 입자 · 오라 움직임, 마녀 순간이동의 보라 잔상, 몰타르 포물선, 봇 관전의 자연스러움. 헤드리스에서는 정지 화면만 봤다.
- 소리 전부: unlock(첫 제스처), 고유 예고음 넷, 떼 소리 밀도, 메뉴에서 줄어드는 환경음. 손잡이는 NOTES-P14의 표에 있다.
- 실제 마우스: 끌어서 놓기, 툴팁 따라감, 슬라이더 끌기, 휠 줌, 표 머리줄 클릭. 실제 `Alt`와 한글 IME.
- 실제 창의 blur/focus, 탭 숨김, `pagehide`, webglcontextlost, localStorage가 막힌 브라우저, 터치 기기.
- 중급 GPU에서의 60fps와 분석 시뮬레이터 10만 회 중의 부드러움. 헤드리스는 소프트웨어 GL이다.

## 10. 정리

- dev 서버(5420)는 내가 띄운 vite PID만 껐다.
- `docs/_scratch/`의 내 파일을 모두 지웠다: 스크린샷, 스모크 · 흐름 · 교차 대조 스크립트, 프로브 사본, 계약 수정 스크립트와 백업.
