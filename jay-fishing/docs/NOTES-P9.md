# NOTES-P9 — app

## 계약과 다르게 · 계약 밖에서 정한 것

1. **마우스 버튼은 `mousedown` / `mouseup`으로 읽는다.** 계약 §11.3에는 `pointerdown`이라고 적혀 있다. 하지만 Pointer Events는 버튼을 겹쳐 누르면(좌클릭을 누른 채 우클릭 = 릴링 + 펌핑) 두 번째 버튼에 대해 `pointerdown`을 내지 않는다. `mousedown`도 사용자 활성화로 인정되므로 락 규칙 ①은 그대로 지켜진다.
2. **키로 연 락 요청은 soft로 처리한다.** 이어하기 · 새 게임 · 일시정지 「계속」 · `PANEL_CLOSED{by:'confirm'}`처럼 Enter/Space로 연 요청이 실패해도 `available`을 false로 내리지 않는다. 규칙 ③을 그대로 따르면, 키보드 활성화를 인정하지 않는 브라우저나 헤드리스에서 합성 키가 첫 요청을 실패시키는 순간 세션 전체가 드래그 모드로 굳는다(헤드리스에서 실제로 이렇게 굳는 것을 봤다). 클릭(`mousedown`)으로 연 요청의 실패만 규칙 ③을 적용한다.
3. **디버그 API 중 sim을 바꾸는 호출**(`goto*` · `setTime` · `force*` · `grant` · `setGear` · `skipToResult` · `loadFixture` · `startGame`)을 부르면 그 실행을 개발 세션으로 바꾼다. 실제 세이브가 디버그 상태로 덮이지 않게 하려는 것이다.
4. **봇 명령 `travel` · `waitNextBand` · `sleep`은 전환 막을 거친다.** `__game.step(n)`은 막이 열리면 끝날 때까지 기다렸다가 이어서 민다. 그래서 `?bot=1`로 연 호수 하루 계획이 첫 문에서 멈추지 않는다.
5. **`setBot(on)`은 자동 패널을 끄고, 이미 열려 있던 바탕 패널(결과 · 장소 · 채비)을 닫는다.** 봇은 패널이 막는 동안 결정할 수 없기 때문이다. title · pause · confirm은 사람의 것이라 남긴다.
6. `parseQuery`: 숫자 쿼리는 범위로 자른다(`level` 1..20 · `time` 24 → 0). 숫자가 아니거나 음수 돈 · 범위 밖 시각 · 모르는 ID는 무시한다. devSession은 **유효한 값**의 쿼리만 센다.
7. `storage.*`는 선택 인자로 가짜 Storage를 받는다(테스트용 · 계약 시그니처와 호환). `listBackups()`를 더했다.
8. 사용자가 일시정지 설정 탭에서 쿼리로 덮인 항목(예: `?quality`)을 바꾸면, 그 덮어쓰기는 이번 실행에서 풀리고 바꾼 값이 persisted에 저장된다. 사용자가 직접 고른 값이고 쿼리 값이 아니므로 영구 저장해도 된다. `overridden` 배열은 같은 객체라서 열린 패널이 다시 그릴 때 「이번 실행만」 표시가 빠진다.

## 남의 파일 · 계약에 대해

- **[minor · P8 strings] WebGL 컨텍스트 상실 안내 문구 키가 없다**(§11.10 「일시정지 + 알림」). 지금은 일시정지 패널만 띄운다. `notice.contextLost` 같은 키를 P8이 더하면 `Game._wireWindow`의 `webglcontextlost` 처리기에서 `ui.toast`로 띄우면 된다.
- **[minor · 계약 §11.2] 전환 막의 합이 1초를 넘을 수 있다.** 막은 out 0.45 + settle + in 0.45다. settle의 상한이 250ms라서 최악은 1.15초다. 렌더 두 프레임이 먼저 끝나는 보통의 GPU에서는 약 0.93초다. 헤드리스(소프트웨어 렌더 · 5fps)에서는 fade의 setTimeout이 늦어 1.9–2.6초를 쟀다. 1초를 보장하려면 `SETTLE_MS`를 100으로 낮추면 된다. 계약 값이라 바꾸지 않았다.
- `ui` 타이틀 패널 위의 confirm(새 게임)에서 「예」를 누르면 `actions.newGame()`이 confirm 처리기 안에서 불린다. 거기서 락을 soft로 요청한다.
