# NOTES-P10 — ui-core (W2)

P10 소유 파일만 고쳤다. 공개 API(`UIRoot` · `PANELS` 의 P10 패널 11 · `widgets` · `t` · `format`)의 이름 · 시그니처는 계약 그대로이고, 아래는 계약에 없어 P10 이 정한 동작과 통합 때 알아야 할 것이다.

## 1. 다른 패키지가 알아야 할 것

**P11 · P12 (패널)**
- **INTERACT → 패널은 UIRoot 가 연다**(npc → `blacksmith|general|gambler|mystic` · `stash` · `riftStone` · 포털은 없음 · 봇이 켜져 있으면 열지 않는다 · args `{from:'interact', object}`). 패널 쪽에서 INTERACT 를 따로 구독해 열지 않는다(열어도 같은 패널이 앞으로 올 뿐이지만 open() 이 두 번 불린다).
- `BAG_PANELS`(대장장이 · 잡화상 · 도박꾼 · 신비술사 · 보관함)가 열리면 UIRoot 가 인벤토리를 닫는다(§10.2).
- 장면이 바뀌면 UIRoot 가 `death riftComplete map inventory skills character` · 상점 4 · `stash` · `riftStone` 을 닫는다. 봇을 켜면 `death riftComplete hint confirm` · 상점 · `stash` · `riftStone` 을 닫는다(일시정지 · 설정 · 도움말 · 분석 · 타이틀 쪽은 남긴다).
- **위젯**(`ctx.widgets`): `gridNav(el, cols, rows, onPick, opts?)` · `listNav(el, onPick, opts?)` → `{handleKey(e) → boolean, focus(i, silent?), index, blur(), refresh(), setSize(c, r), active, destroy()}` — 칸 = `el` 의 자식(인덱스 = 행 × cols + 열) · 포커스 칸에 `is-focus` · 마우스 올림 = 포커스 · 클릭 = `onPick(i, 'pointer')` · Enter/Space = `onPick(i, 'key')`. `opts = {onFocus(i), onEdge(dir) → true 면 먹음(옆 영역으로 — §10.5-8), wrap, start}`. `tabs(el, keys, onChange?)` → `{select(i, silent?), index, handleKey(e), destroy()}`(`[` `]`). `button(labelKey, onClick, hotkey?, params?)` — DOM 포커스를 받지 않는다 · `data-hotkey`. `bar(host?)` → `{el, fill, set(v 0..1, text?)}`. `confirm(textKey, params) → Promise<boolean>`. 더해서 `el(tag, cls, text)`.
- **키 대체 경로**: 맨 위 패널의 `handleKey` 가 false 를 돌려준 keydown 은 UIRoot 가 그 패널 안의 ① 탭 ② 가장 최근에 쓴(포커스 · 마우스) 활성 nav ③ `data-hotkey` 가 그 `event.code` 인 보이는 버튼에 넘긴다. 패널은 nav 의 `handleKey` 를 직접 불러도 되고 안 불러도 된다. 영역 둘이면 쓰지 않는 nav 는 `active = false` 로 둔다.
- 모달 패널의 Escape: 패널 `handleKey` 가 먹지 않으면 UIRoot 가 그 패널을 닫는다(by `'esc'`). 겹쳐 보는 패널은 `keys` 에 든 키만 그 패널로 가고, 거기서 먹지 않은 Escape · 자기 토글 키(I · S · C · Tab)는 UIRoot 가 닫는다.
- **CSS**(hud.css 공통 클래스): `.panel`(panelFrame — `ui-block` 이 붙어 마우스를 막는다) · `.panel-title` · `.is-focus` · `.menu` / `.menu-item` · `.btn` / `.btn-row` / `.is-primary` · `.tabs` / `.tab.is-on` · `.bar` / `.bar-fill` / `.bar-text` · `.form-row` · `.panel-foot` / `.panel-hint` / `.panel-error` · `.r-<rarity>` · `.rank-<rank>` · `.affix-chip` · `.good` / `.bad` · 색 변수 `--r-*` `--good` `--bad` `--ui-*`. 패널 층은 **CSS grid 한 칸에 겹친다**(`.panel-layer > *` — `position: relative` · 맨 위 `is-top` z 2 · 아래는 `is-under` 어둡게 · 마우스 없음). 겹쳐 보는 패널을 옆에 두려면 `justify-self: end` 같은 grid 정렬을 쓴다.
- **계측 HUD(P12)**: UIRoot 가 `createMeterHud({root: HUD 왼쪽 자리, sim, bus, settings, actions, t, ui, widgets})` 로 만들고 매 프레임 `setVisible(settings.meterHud && HUD 보임)` · `update(state, dtReal)` 을 부른다 — P12 가 스스로 붙이지 않는다.

**P9 (app)**
- `handleKey`: keyup 은 보통 false(누르고 있던 키를 놓게) — 모달이 맨 위일 때 Enter · NumpadEnter · Space 의 keyup 만 true. UIRoot 가 Escape(패널 없음 → 일시정지) · I/S/C/Tab · Backquote · Enter(복귀 안내 · 사망 버퍼)를 먼저 먹는다(true) — app 의 `onAppKey` 는 그 뒤의 대체 경로로만 닿는다.
- **Enter 버퍼 둘**: ① 쓰러진 뒤 사망 패널이 뜨기 전 Enter → 패널이 뜨는 틱에 `actions.respawn()`(겹쳐 보는 패널이 열려 있어도 이것이 먼저) ② 전환 막(FADE)이 걷히는 동안의 Enter → 막이 걷힌 뒤 복귀 안내가 떠 있으면 `actions.returnToRift()`(유효 1.2초). 사망 → 부활 → 복귀가 Enter 두 번(미리 눌러도 씹히지 않는다 — 실측 아래).
- 사망 패널 Enter → `actions.respawn()` 이 `{ok:false}` 가 아니면 패널을 닫고 상태가 따라오기를 3초 기다린다(그 안에는 다시 열지 않는다). 사망 패널의 Escape 는 닫지 않고 일시정지를 연다.
- 일시정지 패널이 'code' 밖의 길(Esc · 계속)로 닫히면 UIRoot 가 `actions.resume()` 을 한 번 부른다(그 안에서 다시 closePanel 을 불러도 한 번).
- `PAUSED{on:true, reason: blur|hidden|context}` 이고 놀이 중이면 UIRoot 도 일시정지 패널을 연다(app 이 먼저 열었으면 그대로).
- `SCREEN_CHANGED{to:'title'}` → UIRoot 가 모두 닫고 타이틀을 연다 · `{to:'play'}` → 타이틀 · 캐릭터 선택 · 새 캐릭터를 닫는다.
- 새 캐릭터 패널은 고른 칸이 `account.chars[slot]` 로 차 있으면 **자기가 확인을 받고** `actions.newChar({slot, cls, name, confirmed:true})` 를 부른다 — app 은 `confirmed` 가 아니고 저장소에 `char:<slot>` 키가 있을 때만 다시 확인하면 된다(두 번 묻지 않게).
- 타이틀 패널은 open args 의 `touch` · `storageOk` · `readOnly` 를 보인다(`title.touch` · `notice.saveBlocked` · `notice.saveFuture`).
- `debugStep` 은 `dtReal = 0` 으로 그린다 → 전환 막 · Enter 버퍼는 벽시계로 진행한다(막의 보이는 불투명도는 CSS 전환). 알림 · 배너 · 피해 숫자 · 피격 흔들림은 `dtReal` 로만 흐르므로 step 정지 화면에서는 멈춰 있다(의도).
- 개발용 캐릭터(`?class` · `?rift` 「바로 해 보기」)는 안내를 저장하지 않으니 균열에 들어설 때마다 조작 안내 카드(모달 · Enter 한 번)가 뜬다 — 계약대로다. 귀찮으면 P9 가 개발용 캐릭터의 `char.hints` 를 미리 채우면 된다(Jay 결정 거리 아님 — 통합 때 고른다).
- `blocksPointer(px, py)` 는 `elementFromPoint` — 패널(모달이면 바탕 막까지) · HUD 아래 묶음(구슬 · 스킬 바 · 경험치 바)이 막는다. 이름표 · 미니맵 · 알림 · 큰 지도는 막지 않는다(클릭은 캔버스로 — 이름표 대상은 `labelHover()`).

## 2. 계약과 다르게 · 더 정한 것 (자기 파일 안에서)

1. `reason.level` 문면을 「레벨 {n}이 필요하다」 → 「레벨 {n} 이상이어야 한다」(숫자 뒤 조사 이/가가 수마다 달라 「레벨 12이」가 됐다 — 부록 B 의 예 「레벨 12가 필요하다」는 꼴만 맞췄다).
2. 부록 B 꼴로 키를 더했다(strings.ko.js 「P10 W2」 단락): `hud.status.slow|root` · `hud.immune` · `hud.portal.recall|exit` · `hud.gaugeDone` · `hud.collapsed` · `label.gold|potion|material` · `notice.potionFull|noPotion|lifeFull|recallCancel|skillEmpty|saveFuture`(saveFuture 는 P9 가 쓴다) · `title.charLine|slot|deleteHint|back|navHint|version|continueNone` · `newChar.*` · `pause.quitConfirm|hint` · `settings.on|off|hint` · `help.hint|affixes.intro|rules.potion|rules.recall` · `death.summary` · `complete.other` · `hint.close|openHelp` · `map.hint`.
3. 「잃은 것」 줄의 보장 드랍 수는 문면 고정값 2(부록 B `death.lost`)를 쓴다 — 데이터 `GUARANTEE` 를 바꾸면 문면도 같이 바꾼다.
4. 같은 정예 · 수호자를 대상 프레임과 수호자 바에 두 번 그리지 않는다(대상이 수호자면 대상 프레임을 숨긴다).
5. 비모달 안내 6 · 큐로 미룬 모달 안내는 화면에 붙는 순간 `sim.markHint(id)`. 봇이 켜져 있으면 모달 안내(town · controls)도 비모달 꼴로 내고 본 것으로 적는다(봇이 모달에 막히지 않게).

## 3. 확인한 것(실행 근거)

- `node --test test/ui.format.test.js test/ui.strings.test.js` 17/17 · `npm test` 522(513 pass · 0 fail · 9 todo — W2 다른 패키지 자리) · `npm run build` 오류 0 · purity 통과.
- `probe:screen`(dev 5403 · 1280×720 · 스크래치 사본으로 1920×1080): `?fixture=riftDeath`(사망 패널 · 처치자 정예 이름 · 생명 1 · 수리비) · 붕괴 변형(요약 · 잃은 것) · `riftComplete`(요약 · 해금 · 무사망 · 최고 기록 · 이름표 쌓임) · `lowLife`(저생명 · 감속 · 속박 아이콘 · 귀환 시전 바 · 비모달 안내) · `riftElites`(대상 프레임 · 속성 4) · `riftGuardian`(수호자 바) · `riftLoot`(Alt 이름표 쌓임 · 마우스 올림 → `player.hover = {drop, src:'label'}`) · `town`(복귀 안내 · 마을 미니맵) · 타이틀 · 큰 지도 · 도움말(정예 속성 12) · 설정(← → · Enter) · 마법사 스킬 바(쿨다운 부채 · 버프). `errors()` 전부 0.
- 흐름(합성 키 이벤트 · 실제 sim): `?fresh=1` 새 캐릭터 → 마을 안내 카드(모달) → Enter(본 것) → Esc 일시정지 · Esc → I · Tab 토글 / 균열 → 사망 1틱 뒤 Enter(버퍼) → 부활 → 마을 복귀 안내 → 막이 걷히는 중 Enter(버퍼) → 균열(생명 2) · 미뤄 둔 안내(death · town)가 비모달로 / 타이틀로 → 캐릭터 선택 → Delete → 확인(아니오 · 예) → 빈 칸 Enter → 새 캐릭터 / 봇 켬 → 사망 · 완료 패널 닫힘 · 안 열림 → 끔 → 완료 패널 다시 / 완료 패널 T → 마을.

## 4. 확인하지 못한 것

- 실시간 재생: 알림 · 배너 시간 · 피해 숫자 떠오름 · 전환 막 CSS 전환 · 저생명 맥동 · 구슬 흔들림 · 큰 지도의 균열석 맥동(정지 화면만 봤다).
- 실제 마우스 · 키보드: 설정 슬라이더 끌기 · 패널 위 마우스 올림 포커스 · 이름 칸의 한글 IME 조합 · 실제 Alt 누름(합성 이벤트로만).
- P11 · P12 패널과의 맞물림(지금은 스텁) — 인벤토리 위 키 대체 경로 · 상점 두 영역 · 계측 HUD.
