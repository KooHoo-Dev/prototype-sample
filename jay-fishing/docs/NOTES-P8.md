# NOTES-P8 — ui (W1)

## 다른 패키지가 알아야 할 것 (계약에 없던 공개 동작)

1. **키 처리 분담**(§10.4): `ui.handleKey(e)`는
   - 스택이 비어 있을 때: `Tab`만 처리한다(채비 패널 열기 — 입질 · 파이팅 · 랜딩 · 결과 중이면 열지 않고 `reason.busy` 알림, `true` 반환). `Escape`는 `false` — **낚시 일어나기(`exitFishing`) · `pause` 열기는 app(P9)이 §10.4 순서로 한다.**
   - 스택이 있을 때: `Escape` = 맨 위 닫기(`result` · `title`은 닫히지 않음 — `true`로 삼킨다) · `Tab` = 채비 패널이면 닫기(그 밖은 삼킨다) · 나머지는 맨 위 패널(↑↓ · Q/E · ←→ · Enter/Space · 결과의 KeyX). 처리한 키는 `preventDefault`.
   - 전환 막(`fade(true)`) 중이고 패널이 없으면 모든 키를 삼킨다(`true`).
   - 확인 키(Space · Enter · KeyX)는 패널이 열리거나 다시 보인 뒤 `PANEL_INPUT_GRACE`(0.25초, **실제 시간 `performance.now`**) 동안, 그리고 **키 반복(`e.repeat`)이면 언제나** 버린다 — 뜰채 Space 를 누른 채여도 결과를 고르지 않는다.
2. **`openPanel('tackle')`도 단계 검사를 한다**(app이 직접 불러도 같은 규칙).
3. **결과 · 타이틀 바탕은 `title` 말고는 다른 바탕으로 교체되지 않는다**(`openPanel('sell')` 등이 무시된다). `closePanel('code')`로는 닫힌다(자가 동기화가 결과 단계면 다시 연다 — 자동 패널이 켜져 있을 때).
4. **pause 패널의 「계속하기」**: `actions.resume()`를 부른 뒤, 그 pause 항목이 아직 스택 맨 위면 `closePanel('confirm')`. app의 `resume`이 스스로 닫아도 두 번 닫히지 않는다(아래 패널을 지우지 않는다). Esc 는 `closePanel('esc')`만 — app은 `PANEL_CLOSED{pause}`로 `PAUSED{false}`(§11.2).
5. **pause 설정 탭의 「이번 실행만」**: `openPanel('pause', {overridden: ['quality', 'mute', …]})`로 덮인 설정 키를 넘기면 표시한다(`mute` 또는 `volume`이면 볼륨 줄 넷). 값은 `ctx.settings`(app이 준 같은 객체)를 읽고, 바꾸기는 `actions.applySettings(partial)`만(`volume`은 객체 통째로). `SETTINGS_CHANGED`가 오면 다시 그린다.
6. **타이틀 「새 게임」**: 세이브가 있으면(`args.hasSave`) **ui가 `confirm{danger:true}`를 열고**(본문 레벨 · 돈은 `sim.state.profile` — 불러온 세이브) 「예」에서 `actions.newGame()`를 부른다. **P9의 `actions.newGame()`은 두 번째 확인을 띄우지 말고** 백업 → `sim.newGame` → 막으로 가면 된다. 「이어하기」는 `actions.continueGame()`. 타이틀은 app이 막 아래에서 `closePanel()` 한다(ui는 스스로 닫지 않는다).
7. **캠프 · 지도 · 침대**: 패널을 먼저 `closePanel('confirm')`로 닫고 `actions.waitNextBand()` / `travel(id)` / `sleep()`를 부른다(같은 동기 호출 안 — app의 `fade(true)`가 `isBlocking`을 이어받는다). app 전이의 `ui.closePanel()`은 빈 스택이면 아무것도 안 한다. action이 `{ok:false, reason}`을 돌려주면 알림.
8. **알림 · 배너 · 안내 카드**: 수명은 ui `dt`로 깎고 `PAUSED{true}` 또는 `isBlocking()` 동안 멈춘다. 안내 카드는 패널 · 타이틀 동안 숨겼다가(수명 멈춤) 닫히면 남은 시간만큼 다시 보인다. 알림은 패널 아래(배경 막 밑)에 남아 있다.
9. **FAIL 알림**: `FAIL{loss}` 또는 (이벤트를 놓쳤으면) `rig.phase === 'failed' && rig.lastLoss`에서 세운다 — 첫 줄 `fail.<reason>`, 다음 줄 잃은 것(`fail.part.*` 조각 · 미끼 보존이면 「지켰다」) · 원인(`fail.cause.*` · `fail.hookSmall`) · 잃은 로드 · 예비 스풀 · 낮춘 드랙. `HOOK_MISS`는 따로 알리지 않는다(FAIL이 같은 내용).
10. **안내 문구 10종**: 보일 때 `sim.markHintSeen(id)`(실패해도 이 실행에서는 다시 띄우지 않는다). `bite`는 **첫 대기(`waiting`)부터** 띄운다(첫 입질이 오기 전에 「톡톡 = 예신 · 쑥 = 본신 → Space」를 알아야 첫 챔질이 된다 — 계약의 「첫 입질」보다 이르다). `bite` · `fight` · `net`은 보이는 카드를 밀어낸다. `drift`는 찌 세트 && 자리 흐름 ≥ `BITE.driftMinFlow`.
11. **HUD의 RigStats**는 `sim.getRigStats()`를 0.25초마다 또는 장착 · 세트 · 스킬 · 복구 · 감기 · 챔질 · 씬 이벤트 뒤에 다시 읽는다(프레임마다 할당하지 않는다).
12. **도감 카드**: `fishPreview.snapshot(id, 0, {silhouette: !caught, size: 160})` 이미지 · 상세(오른쪽)에 회전 캔버스 하나(`show` — 포커스 카드, 처음엔 첫 카드). 결과 패널도 같은 캔버스를 옮겨 붙인다(한 번에 하나만 보인다). 패널이 닫히면 `hide()`.
13. 내부 파일을 더했다: `src/ui/stack.js`(순수 패널 스택 — `ui.strings.test.js`가 규칙을 검사) · `src/ui/widgets.js` · `src/ui/panels/shared.js`.

## 계약과 어긋난 점 · 다른 패키지에 요청

- **P4 (NOTES-P4 #2 · #3)**: 집의 `refill_*_line_1`은 ui가 「무료」로 보이고 눌리게 한다(실제 `refillLine`이 집에서 무료). 「이미 가득」 키 `reason.full`을 `strings.ko.js`에 더했다 — ui는 라인 항목의 `'same'`을 `reason.full`로 보인다. economy.js 를 `'full'`로 바꿔도 ui는 그대로 맞는다(사유 문면이 `reason.full`).
- **P9**: 위 1 · 4 · 5 · 6 · 7. 특히 `Escape`(빈 스택)는 app 몫, `Tab`(빈 스택)은 ui 몫 — app은 키를 `ui.handleKey`에 먼저 주고 `true`면 멈춘다(W0 `main.js`와 같다). 포커스 잃음 pause 는 `openPanel('pause')`(겹친다 — 결과 · 타이틀 · 확인을 지우지 않는다).
- `SkillPreview`에 `reasonParams`가 없다(§3.6) — 지금 스킬 사유(`noPoints` · `maxRank`)는 자리 값이 없어 문제없다.

## 사람이 확인할 것

- 실제 키보드로: 결과 패널에서 뜰채 Space 를 누른 채 두기 → 결과가 저절로 골라지지 않는다 / 패널 Esc · Tab 닫힘 / Q/E · ←→ 탭 · 값.
- 텐션 게이지 적색 테두리 점멸(`style.css` `jf-border` 0.5초 · 2단계 — 섬광 아님)이 거슬리지 않는지 — 손잡이: `style.css`의 `.tension.is-blink` 애니메이션 길이, `hud.js` `TENSION_WARN`(0.6) · `TENSION_DANGER`(0.85).
- 알림 수명 `UIRoot.js` `NOTICE_LIFE`(2.6초) · 배너 `BANNER_LIFE`(2.5초) · 안내 `HINT_LIFE`(6초) · 단계 안내를 보이는 첫 캐스팅 수 `hud.js` `PROMPT_CASTS`(5).
- 전환 막(`fade`)의 실제 시간 페이드.
