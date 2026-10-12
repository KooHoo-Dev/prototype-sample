# NOTES-P12 — analytics (W2)

P12 소유 파일만 고쳤다(`src/ui/analytics/*` 8개 · `test/analytics.test.js`). 공개 API(`createAnalyticsPanel` · `createMeterHud` · `toJson` · `toCsv`)의 이름 · 시그니처는 계약 그대로다.

## 1. 통합 게이트가 할 일 — 문자열 키 59개(`strings.ko.js` · 소유 P10)

부록 B 에 없는 키다. 더하기 전에는 화면에 키가 그대로 보이고 `ui.strings.test` 가 실패한다(실패 63줄 = 아래 56키 · 전부 `src/ui/analytics/` — 다른 패키지 원인 0). 마지막 셋(`analytics.result.*`)은 `'analytics.result.' + result` 로 이어 붙여 쓰므로 테스트가 잡지 못한다 — 같이 더한다.
문면은 브라우저에서 실제로 넣어 보고(런타임 주입 · 스크래치) 1280×720 · 1920×1080 에서 잘림 · 겹침이 없음을 확인했다. 그대로 붙여 넣으면 된다.

```js
  // ── P12 W2 — 분석 패널 ──
  'analytics.f.level': '균열 레벨',
  'analytics.f.rank': '몬스터 등급',
  'analytics.f.blp': '불운 보정',
  'analytics.f.cls': '클래스',
  'analytics.f.seed': '시드',
  'analytics.sec.summary': '처치당 기대값',
  'analytics.sec.rarity': '등급 분포(장비 하나당)',
  'analytics.sec.slot': '부위 분포',
  'analytics.sec.affixCount': '옵션 수',
  'analytics.sec.tier': '옵션 티어(옵션 하나당)',
  'analytics.gearPerKill': '장비 / 처치',
  'analytics.goldPerKill': '골드 / 처치',
  'analytics.legPerKill': '전설 / 처치',
  'analytics.killsToLegendMean': '전설까지 처치(평균)',
  'analytics.maxGap': '전설·세트 없는 최장',
  'analytics.state.idle': '값을 고르고 Enter — 굴리기',
  'analytics.state.running': '굴리는 중 — {n} / {m}회',
  'analytics.state.done': '완료 — {n}회 · {sec}초',
  'analytics.state.cancelled': '취소됨 — {n} / {m}회까지의 결과',
  'analytics.hist.stats': '평균 {mean} · 중앙값 {median} · 최대 {max} · 표본 {n} · 오른쪽 밖 {over}',
  'analytics.hist.none': '아직 전설이 나오지 않았다',
  'analytics.hist.theory': '점선 = 이론 평균 {v}처치',
  'analytics.errNote': '오차 = (시뮬 − 이론) ÷ 이론 · z = 표본 오차(σ)의 배수 — |오차| ≤ 3% 또는 |z| < 4 면 초록 · 이론 1% 미만 칸은 흐리게 · 불운 보정 켬의 이론값은 불운 수의 정상 분포로 섞은 값',
  'analytics.hint.sim': '↑↓ 줄 · ←→ 값 · Enter 굴리기 · X 취소 · [ ] 탭 · Esc 닫기 — 닫으면 굴리던 것은 멈춘다',
  'analytics.hint.tables': '↑↓ 표 · ←→ 정렬 열 · Enter 정렬 방향 · PageUp/PageDown 스크롤 · 머리줄 클릭 = 정렬 · [ ] 탭',
  'analytics.hint.session': 'J — JSON · C — CSV · ↑↓ ←→ PageUp/PageDown 스크롤 · [ ] 탭 · Esc 닫기',
  'analytics.hint.bot': '↑↓ 줄 · ←→ 값 · Enter 켜기/끄기 · [ ] 탭 · Esc 닫기',
  'analytics.tbl.rift': '균열 레벨 곡선',
  'analytics.tbl.rarity': '등급 가중치',
  'analytics.tbl.affixes': '옵션 풀',
  'analytics.tbl.monAffixes': '정예 속성',
  'analytics.tbl.monsters': '몬스터',
  'analytics.tbl.ranks': '몬스터 등급 배율',
  'analytics.tbl.skills': '스킬 노드',
  'analytics.tbl.treasure': '드랍 묶음',
  'analytics.tbl.economy': '경제 가격',
  'analytics.ses.total': '누적 {n}판 · 완료 {complete} · 붕괴 {collapse} · 포기 {abandon} · {time}',
  'analytics.ses.empty': '아직 기록이 없다 — 균열을 한 판 마치면 쌓인다',
  'analytics.ses.noChar': '캐릭터를 불러오면 그 캐릭터의 기록이 보인다',
  'analytics.ses.result': '결과',
  'analytics.ses.charLevel': '캐릭터 레벨',
  'analytics.ses.sum': '누적 합',
  'analytics.ses.saved': '내려받았다 — {name}',
  'analytics.result.complete': '완료',
  'analytics.result.collapse': '붕괴',
  'analytics.result.abandon': '포기',
  'analytics.bot.strategy': '전략',
  'analytics.bot.preset': '프리셋',
  'analytics.bot.on': '봇이 사냥 중이다',
  'analytics.bot.off': '봇이 꺼져 있다',
  'analytics.bot.note': '켜면 이 패널이 닫히고 관전이 시작된다 — 봇이 마을 → 균열 → 정비 → 다음 판을 스스로 돈다. 끄려면 ` 로 다시 열어 끈다.',
  'analytics.bot.noChar': '캐릭터가 있어야 켤 수 있다',
  'analytics.bot.log': '관전 기록(최근 10줄)',
  'analytics.bot.logEmpty': '아직 기록이 없다 — 봇을 켜면 쌓인다',
  'analytics.log.botOn': '봇 켬',
  'analytics.log.botOff': '봇 끔',
  'analytics.log.complete': '균열 {n} 완료 — {t} · 사망 {d}',
  'analytics.log.collapse': '균열 {n} 붕괴',
  'analytics.log.town': '마을 정비 — 거래 {trades} · 장착 {equips} · 골드 {gold}',
```

그대로 다시 쓴 기존 키: `analytics.tab.*` · `run` · `cancel` · `n` · `theory` · `sim` · `err` · `killsToLegend` · `json` · `csv` · `botOn` · `botOff` · `strategy.*` · `meter.*` · `riftStone.level`(균열 {n}) · `rank.*` · `rarity.*` · `islot.*` · `class.*` · `stat.magicFind` · `char.effMf` · `settings.on/off` · `complete.*`(시간 · 처치 · 사망 · 획득 · 골드 · 경험치 · 업그레이드 · 기타) · `hud.level` · `hud.gauge` · `hud.lives` · `tileset.*` · `banner.riftOpened` · `banner.levelUp` · `notice.unlock` · `death.title` · `death.lives` · `preset.<cls>.<i>` · `afx.<id>.line` · `affix.<id>.name` · `mon.<id>` · `node.<id>.name` · `skill.<id>.name` · `reason.*`.

## 2. 계약과 다르게 · 더 정한 것(내 파일 안에서)

1. **봇 로그 마지막 10줄**(§10.9): ui 는 봇 인스턴스(`bot.log`)를 읽을 통로가 없다(§2.1 ui → bot ✕ · `actions` 에 없음). → 봇이 켜져 있는 동안의 **공개 이벤트**(BOT · RIFT_OPENED · RIFT_COMPLETE · RIFT_COLLAPSE · PLAYER_DIED · LEVEL_UP · UNLOCK · 마을 정비 = TRADE · EQUIPPED · GOLD 를 마을을 떠날 때 한 줄)로 「관전 기록」을 쓴다. 패널이 처음 만들어진 뒤(처음 연 뒤)부터 센다. 봇의 결정 기록 자체가 필요하면 통합 때 `actions.botLog()`(app 이 `this.bot?.log` 를 돌려준다)를 더하고 botTab 이 그것을 우선 읽게 바꾸면 된다(한 줄).
2. **이론값(불운 보정 켬)**: `rarityDist(blp = n)` 은 불운 수 n 에서의 분포라 한 값으로는 시뮬과 비교할 수 없다(일반 균열 1 에서 끔 0.373% · 켬의 실제 비율 0.573% — 그대로 대면 −35% 「오차」). → 불운 수 사슬의 정상 분포(장비 드랍마다 +1 · 전설 · 세트면 0 · `BLP.hard` 에서 전설 확정)로 `rarityDist(blp = n)` 을 섞은 값을 이론값으로 보인다. 보장 장비가 처치 끝에 몰린 수호자는 처치 단위 사슬을 수렴시킨다. 부위는 `slotDist` 의 선형성으로(일반 · 마법 · 희귀 = `slotDist(cls)` · 전설 = `blp = BLP.hard` · 세트는 한 번 더 부른 값에서 푼다) — P5 함수만 부르고 식은 다시 쓰지 않았다. 검증: Node 에서 수호자 L20 10만 처치(시드 5개 × 2만 · 장비 56만) 등급 · 부위 모든 칸 |z| < 2.1 · 엘리트 L12 · 수호자 L5 10만 처치 |z| < 2.7(아래 §4).
3. **판정 색**: |상대 오차| ≤ 3%(브리프) 또는 |z| < 4 면 초록 · 이론 1% 미만 칸은 흐리게(브리프 「빈도 1% 이상 칸」 · NOTES-P5 #8 의 표본 오차 문제). 3σ 로 두었더니 수호자 L20 1만 처치에서 우연한 3.1σ · 3.5σ 칸이 붉었다(같은 조건 시드 5개 · 10만 처치를 모으면 0.4σ · 1.5σ — 시드 1 의 처음 1만 처치가 치우친 것 · Node 와 브라우저 결과가 같다) — 칸이 30개 남짓이라 4σ.
4. **표 보기의 열 이름 = 데이터 필드 이름 그대로**(`hpMul` · `rarityMul.legendary` · `w.gear` …) — 「가공 없이」를 지키려고 번역하지 않았다. 계산해서 덧붙인 열은 둘이고 이름이 식이다: `earlyDmgMul(L)`(data/rift.js 함수 · 균열 1~4 피해 경사) · `GROWTH.item^(L−1)`(§7.3 「아이템 위력」 열). 표마다 같은 파일의 스칼라 상수를 아래 줄에 `이름 = 값` 으로. 소수는 셋째 자리(0.01 미만은 유효 숫자 셋). 표 「몬스터 등급 배율」(RANKS)을 하나 더 넣었다(챔피언 × 3.5 · 정예 × 7 이 정예 분석의 바탕).
5. **패널을 닫으면 굴리던 시뮬레이터를 멈춘다**(결과는 남고 「취소됨 — n / m회까지의 결과」). 닫힌 뒤 게임과 메인 스레드를 다투지 않게. 탭만 바꾸면 계속 돈다. 탭이 숨으면(app 이 일시정지 패널을 위에 연다) 계속 돈다.
6. **단축키**: 취소 `KeyX` · JSON `KeyJ` · CSV `KeyC` · 표 스크롤 `PageUp/PageDown` — `data/keybinds.js` 의 `PANEL_KEYS` 에 analytics 가 없어 코드 안 기본값을 쓰고, `PANEL_KEYS.analytics = {cancel, json, csv}` 가 생기면 그 값을 읽는다(소유 P9 — 넣을지는 통합이 고른다).
7. 시뮬레이터의 「몬스터 등급」 선택지 = 장비가 나올 수 있는 등급(normal · champion · elite · minion · guardian — split · spawn 은 장비 0). 아이템 발견 0 · 25 · 50 · 100 · 150 · 200 · 300 · 400 · 600%(브리프의 0 · 100 · 300 · 600 포함 · 유효 MF 함께). 처음 열 때 지금 캐릭터의 클래스 · 균열 레벨(없으면 해금 최고)로.
8. open args `{tab: 'sim'|'tables'|'session'|'bot'}`(또는 0..3)를 받는다 — 화면 확인용(`__game.openPanel('analytics', {tab:'tables'})`). 시뮬레이터 탭은 끝날 때 `el.dataset.slices` · `maxSliceMs` · `scheduler` 를 남긴다(헤드리스 검사가 읽는다).
9. 계측 HUD 는 균열이 없으면(`state.rift` 없음) 감춘다. 멈춘 화면(`__game.step` — dtReal 0)에서도 틱이 0.25초어치(8틱) 지나면 다시 읽는다.
10. 봇 탭에서 켜면 app(`_setBot`)이 패널을 닫는다 — app 이 닫지 않았으면 탭이 `ui.closePanel('analytics')` 를 한 번 더 부른다(무해한 중복).

## 3. 다른 패키지 · 통합이 알아야 할 것

- **P9**: `actions.setBot(on, {strategy, preset})` · `actions.downloadFile(name, mime, text)` 의 결과 `{ok:false, reason}` 이면 탭이 `t('reason.' + reason)` 을 보인다. 내려받기 이름 `rift-hunter-<cls>-<slot>-records.json|csv` · mime `application/json` · `text/csv`.
- **P10**: `UIRoot.botOn` 을 봇 탭이 처음 값으로 읽는다(계약 밖 필드 — 없으면 `BOT` 이벤트만). 분석 패널은 탭 전환 `[` `]` 을 스스로 먹고, 먹지 않은 Escape · Backquote 는 UIRoot 가 닫는다.
- 헤드리스(SwiftShader) 에서는 게임의 3D 렌더 한 프레임이 ~500ms 라 시뮬레이터 조각이 렌더 사이에서 굶는다(10만 회가 9초 안에 끝나지 않음 · 롱태스크 = 렌더). 측정은 `requestAnimationFrame` 을 끈 페이지에서 했다(아래). 실제 GPU 에서의 프레임 시간은 사람이 확인할 것.

## 4. 확인한 것(실행 근거)

- `node --test test/analytics.test.js` 20/20(0.95초): toJson 왕복 · toCsv 고정 열 순서 · 이스케이프(쉼표 · 따옴표 · CRLF · 배열 · 계약 밖 필드 뒤에 덧붙음)를 RFC 4180 파서로 다시 읽어 원래 기록과 같음 · 누적 합 · 히스토그램 · 조각 실행기(가짜 시계 · 가짜 스케줄러: 10만 회 조각마다 ≤ 8ms · 취소 뒤 굴리지 않음 · 멈춘 step · 0 회) · 나눠 굴려도 한 번에 굴린 것과 같은 결과 · MessageChannel 스케줄러 · 이론값 = P5 함수 · 불운 보정 켬 이론 = 시뮬(|z| < 4.5) · 표 값 = 데이터(RIFT_LEVELS 30줄 · L21/L20 = hpLate) · 계측 HUD 문면.
- `node --test test/purity.test.js` 10/10 · `npm run build` 오류 0 · `npm test` 554 중 fail 1 = `ui.strings`(§1 의 키 — 전부 analytics).
- 헤드리스 화면(`probe:screen` · dev 5405 · `errors()` 전부 0): `?analytics=1`(타이틀 위 · 정지 화면) · 엘리트 L12 10만 회 결과(모든 칸 초록) · 수호자 L20 1만 회 · 표 보기(균열 곡선 · 옵션 풀 · 몬스터 hp 정렬 ▼ · 키보드 →×4 Enter 정렬) · 세션 기록(실제 기록 6판 · 누적 합 · J/C → `downloadFile` 에 JSON 1,910자 · CSV 머리줄 고정 열) · 봇 탭(켬 → 패널 닫힘 · BOT · 관전 기록 5줄) · 계측 HUD(균열 · 왼쪽 위 12,64–205,236 — 대상 프레임 370–910 · 8–24 와 겹치지 않음) · 1920×1080(스크래치 사본 프로브) · 제안 문면을 런타임에 넣은 화면.
- 반응성(rAF 를 끈 헤드리스 · 엘리트 L12 10만 회): 1.65~2.4초 · 조각 181~196개 · 가장 긴 조각 9.7~17.8ms(GC 튐) · 20ms 타이머의 최대 간격 34~44ms(굴리는 동안 페이지가 늘 응답) · 굴리는 동안 롱태스크 0(보고된 67~80ms 하나는 굴리기 전 값 클릭 묶음).
- 숨은 탭(가짜 visibilitychange): 일시정지 패널이 위에 열리고 시뮬레이터는 끝까지(100%) · Escape 로 분석 패널로 돌아옴. 취소: X → 「취소됨」 · 진행 멈춤 · 굴리는 중 값 바꾸기 막힘 · Escape 로 닫으면 멈추고 다시 열면 부분 결과.

## 5. 확인하지 못한 것(사람이 확인할 것)

- 실제 GPU 브라우저에서 10만 회(특히 수호자 10만 회 · 약 7초) 동안 화면 · 마우스가 끊기지 않는가 — 손잡이: `dropSimTab.js` 의 `SLICE_MS`(8 · 줄이면 더 부드럽고 오래 걸린다) · `RENDER_EVERY_MS`(120).
- 실제로 탭을 숨겼을 때(다른 탭으로) 진행이 계속되는가(MessageChannel — Chrome 의 타이머 억제 대상이 아니다) — 숨겼다 돌아와 진행 막대를 본다.
- 브라우저의 실제 내려받기(파일 저장 대화상자 · 파일 이름 · 표 계산기에서 CSV 가 한글 없이 그대로 열리는가 — 값은 영어 식별자 · 수뿐).
- 마우스: 표 머리줄 클릭 정렬 · ◀ ▶ 클릭 · 히스토그램 막대 title 툴팁.
