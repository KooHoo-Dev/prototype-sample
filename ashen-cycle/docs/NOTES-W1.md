# NOTES-W1 (웨이브 1 통합 게이트)

P1~P8의 완성본이 한 번에 맞물리는지 확인한 결과. 계약 수정은 `docs/CONTRACT.md`에 **「W1 확정」** 표시로 들어 있다(35곳 — 검색어 `W1 확정`).

## 게이트 결과

| 항목 | 결과 |
|---|---|
| `npm run build` | 오류 0 · 경고 0 |
| `npm test` | tests 412 · pass 409 · fail 0 · todo 3(`bot.fight` · `boss.fenrir` · `boss.nihil` 자리 표시 — W2 몫) |
| 헤드리스 통합 스모크(실제 P1~P4, 임시 스크립트 — 지웠다) | 발더 60초 스크립트 대전, 무작위 입력 퍼즈 40판(무기 3종 × 순환 0~2 × godMode/일반/가드 위주 + 펜리르 · 니힐 스텁) + 마을 20000틱: **예외 0 · NaN 0 · 불변식 위반 0**. 사망 → `REWARD_GRANTED` → `FIGHT_ENDED`, HP 디버그 → 2페이즈 → 격파 → 해금, 세 보스 격파 → `CYCLE_ADVANCED`, 패링 15회 → 그로기 → 처형, 가드 · 완충 강공격 · 플라스크 · 포기(`forfeitFight`) 흐름 전부 확인. 같은 시드 · 같은 입력의 전체 한 판이 두 번 같다 |
| 브라우저 스모크(최소 부트) | 마을 · `?boss=valder`(인트로 → 예고 · 텔레그래프 → 피격 → 사망 → 결과 패널 → `R` 재도전 → 2페이즈 → 장판 → 그로기 · 처형 → 격파 → 결과 → 마을) · `?boss=fenrir` · `?boss=nihil`(스텁 보스) · 패널 7종 전부: **콘솔 오류 0 · 경고 0** |

## 고친 것

| 파일 | 내용 |
|---|---|
| `src/main.js` | keydown 첫 줄에 `event.defaultPrevented`면 돌아가게 했다. UI가 처리한 키가 게임 입력으로 샜다 — 결과 패널의 `[E] 마을로`가 곧바로 화톳불 상호작용이 돼 화톳불 패널이 열렸고, `[R] 재도전`이 플라스크 한 병을 마셨다(브라우저에서 재현 · 수정 뒤 재확인) |
| `src/types.js` | 구현이 덧붙인 필드를 선택 필드로 올렸다: `PlayerState.lightLock · heavyLock`(P1) · `BossState.fw` · `BossAttackRuntime.fw`(P3) · `Hazard.facing`(P2). `test/helpers.js`의 리터럴 빌더는 그대로다(필드가 없는 상태를 받는 것이 P1 테스트의 단언이다) |
| `docs/CONTRACT.md` | 아래 「계약 수정 목록」 |

패키지 사이의 시그니처 · payload 불일치는 **없었다**. EV 52개의 발행 지점과 구독 지점을 짝지어 본 결과: 발행자가 넣는 필드와 fx · audio · ui · view가 읽는 필드가 전부 계약과 같다. `SCREEN_CHANGED` · `PAUSED` · `SETTINGS_CHANGED` · `SAVED`는 아직 발행자가 없다(P9 몫). `FIGHT_STARTED` · `FIGHT_PHASE` · `REWARD_GRANTED` · `NEAR_FACILITY_CHANGED` · `HITSTOP`는 구독자가 없다 — UI · 오디오가 이벤트 대신 `state`를 읽는다(문제 없음). UI가 부르는 `Progression` 메서드 11종 · `actions` 9종 · `sim.restAtBonfire`는 전부 있다. 문자열 키는 정적 키 · 동적 키 계열 전부 `STR`에 있다(`key.KeyW` 류는 `dom.js`가 `Key`를 떼어 표기).

## 계약 수정 목록 (전부 「W1 확정」 표시)

- **§3.2** 플레이어 타격의 `hitstop 0`은 히트스톱 없음(기본값은 플레이어가 맞는 쪽에만 있다).
- **§3.4 · §3.5 · §3.6** 선택 필드: `lightLock` · `heavyLock` · `fw` · `Hazard.facing`.
- **§4.2** `HIT`는 반응 호출 뒤에 큐에 든다 · `*_ENDED{clear}`는 `MODE_CHANGED` 뒤에 온다 · 마을을 떠날 때 `NEAR_FACILITY_CHANGED{null}` · `HITSTOP` · `PLAYER_GUARD` · `PLAYER_FLASK.amount` · `BOSS_STEP.heavy`의 세부.
- **§6.4** 보스전 시드의 attempts는 `noteAttempt` 뒤 값 · 쓰러진 보스(hp 0)는 맞지 않는다(`null`) · `immune`은 `HIT`만 · 정면 판정의 원점 겹침 · `debugDamageBoss`의 범위.
- **§6.6** 이벤트 순서 · 바뀌는 것이 없는 명령은 `{ok:true}`에 이벤트 없음 · **`equipRelic`은 다른 칸의 유물을 고르면 두 칸을 맞바꾼다**(§12.2 문구도 고침) · `previewLevelUp` 상한 · `getShopItems` 품절 · `getWeaponInfo`의 피해 · `computeReward.damageFraction` · `STATS.precision`.
- **§7.1** 틱 양자화 · 구르기/플라스크 꼬리 · 조준 방향 · 빈 플라스크는 버퍼에 넣지 않는다 · **후딜 캔슬 잠금**(「강 → 가드 캔슬 → 강」 구멍을 막는 `lightLock` · `heavyLock`).
- **§8.5 · §8.6** 타임라인 이벤트 세부 · **확률 0인 연속기 항목에는 `chainBonus`를 더하지 않는다** · `select()` 0단계 · 훅 호출 시점 · `BOSS_AI` 추가 이름.
- **§8.9** `validateBossDef`는 필수 필드를 전부 요구한다(P10 · P11 주의).
- **§9.2** PCFShadowMap(r186) · 비네트 패스 · `low`는 컴포저 없이 직접 렌더(→ `ShaderMaterial`에 톤매핑 · 색공간 include 필요) · `rc.quality` · `rc.prewarm()`.
- **§9.4** 화톳불 · NPC 원은 카메라 장애물에서 뺀다 · 스스로 `snapBehind` · `CAMERA` 내부 필드.
- **§9.5** 부유 리그는 `hover: 0, height: def.height − hoverY` · 사족 리그 치수 · `Rig` · `pose.js`의 덤.
- **§9.6** 무기 메시 교체는 `stats.weaponId` 폴링 · 피격 점멸은 레이어가 건다 · `onEvent`의 name은 EV 문자열.
- **§9.7 · §9.8** 스파크는 `dir` 축 · 표면 바깥쪽(`−dir`) · `FxLayer`는 `update()`에서 이벤트를 처리한다 · 궤적 리본은 날의 바깥쪽만.
- **§10.1** UI는 `actions.*` 뒤에 스스로 닫지 않는다 · 락 안내 초기값 · 타이틀에서 HUD 자동 숨김 · `fade` 세부 · **UI가 처리한 keydown은 `defaultPrevented` — app은 그 키를 게임 입력으로 받지 않는다** · HUD는 `state.fight` 참조로 새 판을 안다 · 설정 객체는 동기적으로 고친다.
- **§11.5** `__ashen.step(n)`은 틱을 민 뒤 레이어 update + render도 한 번 한다(숨은 탭 스모크용).
- **§11.6** 최소 부트의 `defaultPrevented` 검사. **§12.5** 숨은 탭에서는 rAF가 돌지 않는다는 환경 주의.

## W2(P9 · P10 · P11)가 알아야 할 것

**공통**
- `docs/CONTRACT.md`에서 `W1 확정`을 검색해 자기 절의 항목을 읽는다. 패키지별 세부는 `NOTES-P1`~`P8`.
- **포트 5183은 이미 다른 vite(PID 2904 — 이 폴더를 서빙 중, 누가 띄웠는지 모름)가 쥐고 있다.** `vite.config.js`가 `strictPort`라 `npm run dev`가 실패한다 — 그 서버를 그대로 쓰거나(같은 소스를 서빙한다) `npx vite --port <다른 포트> --strictPort`로 띄운다. 끝나면 **자기 PID만** 종료한다(TaskStop만으로는 node 자식이 남는다 — `netstat -ano`로 PID를 확인해 `taskkill`).
- **Browser pane이 숨겨져 있어 `requestAnimationFrame`이 돌지 않는다**(3초에 0프레임 — 스크린샷을 찍을 때만 한두 프레임). 최소 부트로 확인하려면: `requestAnimationFrame`을 감싸 이름이 `frame`인 콜백을 `window.__cb`에 잡아 두고 `for (…) { t += 1000/60; __cb(t); }`로 프레임을 손으로 민다. 이때 아무 일도 안 하는 네이티브 rAF 루프(`const loop = () => nativeRaf(loop)`)를 하나 돌려 두지 않으면 스크린샷이 5초 타임아웃으로 실패한다. 프레임을 민 직후의 첫 스크린샷은 가끔 타임아웃 난다 — 한 번 더 찍으면 된다. 뷰포트 에뮬레이션(`resize_window`)은 반영이 늦고 스크린샷이 잘려 나올 수 있다. CSS 전환(프롬프트 · 배너 opacity)과 UI의 입력 지연(0.25초 · result 0.5초)은 **실제 시간**이라, 프레임만 밀고 곧바로 키를 보내면 무시된다.
- 이 PC의 측정(RTX 3070 · 1920×1080 버퍼 · medium · 발더전): 프레임당 평균 5.6ms(readPixels 동기 포함), CPU만 1.9ms.

**P9 (app)**
- 입력 수집은 `event.defaultPrevented`인 keydown을 받지 않는다(UI 리스너가 먼저 등록돼 있어야 한다 — `UIRoot`를 `InputCollector`보다 먼저 만든다. §11.1 순서 그대로). §11.3의 「`UI_CLOSED` 뒤 0.15초 에지 버림」도 함께.
- `__ashen.step(n)`이 화면까지 밀어야 W3 스모크가 숨은 탭에서 돈다(§11.5 W1 확정). `setBot(true)` 뒤 「10초 대기」는 숨은 탭에서 성립하지 않는다.
- `GameSim`은 `PROFILE_CHANGED`를 스스로 구독한다(마을이면 `refreshStats(true)`). 새 게임은 `Object.assign(profile, …)` → `PROFILE_CHANGED{reset}` → town 전이 순서만 지키면 된다.
- 보스전 시작 때 자동 록온(`LOCKON_CHANGED{on:true}`), 보스가 죽으면 P1이 록온을 끈다(`LOCKON_CHANGED{on:false}`).
- `test/gamesim.fixtures.js`(P2)의 `makeSim` · `neutralize` · `startNeutralFight` 등을 `bot.fight.test.js`에서 재사용할 수 있다. 봇이 읽을 값: `player.canExecute` · `boss.attack.{id, phase, t, windup, active, locked, aimX, aimZ}` · `getBossDef(id).attacks[id].hits` · `state.hazards[].{state, t, warn, shape, grow}` · `state.projectiles` · `state.telegraphs`.
- 봇 없이 돌린 참고치(새 프로필 · 장검 · 접근 + 약공격 연타): 4대 맞고 약 10~15초에 죽고 f ≈ 0.10~0.15(잔불 130~170). godMode 연타로 격파 65~70초(처형 2~3회). 패링만으로 54초에 1220 피해(패링 15 · 처형 5). 순환 1 godMode 격파 64~140초.
- 스태미나가 모자라도 공격 · 구르기는 나가고 0을 찍는다(`PLAYER_STAMINA_OUT` · `exhausted`) — 봇이 연타하면 거의 매 타 탈진한다. §12.3의 `attackStamina: 25` 조건을 지켜야 한다.
- 발더는 후보 공격이 있으면 `idle`에서 제자리로 돌기만 하다가 공격한다(걷는 것은 후보가 없을 때의 `chase`뿐 — 계약 §8.6 그대로). 5~6m는 1페이즈 공백이다(`NOTES-P3`).

**P10 (펜리르)**
- `validateBossDef`가 `hits[]`의 `interval · guardable · parryable · knockdown · telegraph`와 `hazard`의 `interval · guardable · knockdown`을 전부 요구한다(§8.11 표에 생략돼 있어도 쓴다).
- 사족 리그: root 원점 = 몸 중심, 코끝 +0.518 × length, 엉덩이 −0.482 × length → `bodyParts`의 `fwd` 범위와 몸길이를 맞춘다. 사족에는 `weaponBase/Tip` 소켓이 없어 보스 궤적은 그려지지 않는다(정상). `howl` 큐는 `mouth` 소켓을 읽는다. 브레스는 `breath_start` 큐의 `{length, halfAngle, socket: 'mouth'}`.
- 확률 0인 연속기 항목(`chance 0 / chanceP2 0.5`)은 순환이 올라도 1페이즈에 나오지 않는다.
- 몸통 밀어내기(G3)는 `bodyParts`의 모든 원이 민다. 돌진이 일직선의 플레이어를 앞으로 밀고 간다(발더 `thrust_charge` 측정: 8m 앞의 플레이어가 3.2m 밀림 · 피해는 한 번) — 어색하면 `NOTES-P10`에 남긴다(G3는 P2 파일이다).
- 스텁 상태의 `?boss=fenrir`는 오류 없이 돈다(얼음 호수 아레나 · 캡슐 보스 · `stub_swipe`).

**P11 (니힐)**
- 부유: 훅의 `onTick`에서 매 틱 `boss.y = hoverY`(프레임워크가 `leap/hop` 뒤 0으로 돌린다). 뷰는 `buildFloaterRig({hover: 0, height: def.height − hoverY, …})` — 아니면 두 번 뜬다.
- `validateBossDef` 필수 필드는 P10과 같다 + `proj`의 전 필드.
- 광선 원점은 `handL` 소켓, `cast` 큐도 `handL`. `void_sword` 낙하는 `hazard.t / hazard.warn`에서 계산한다(`state.hazards`에 그 id가 있어야 한다). 순간이동은 `prevPos` · `prevFacing`을 함께 덮는다.
- 심연 제단의 바닥 룬이 텔레그래프(보라)와 같은 색이다 — 화면에서 묻히면 `arenaScene.js` `buildVoid`의 `floorMat.emissiveIntensity`를 내려야 한다(P6 파일 — `NOTES-P11`에 남긴다).
- 투사체 패링: `parryable` 투사체를 패링하면 소멸 + 보스 체간 `parryPosture × 0.5`, `onBossParried`는 불리지 않는다(그로기는 다음 틱 폴링).

## 남은 문제 (고치지 않은 것)

| 심각도 | 영역 | 내용 |
|---|---|---|
| major | 검증 | **실시간 재생을 보지 못했다.** pane이 숨겨져 rAF가 돌지 않아 프레임을 손으로 밀며 정지 화면만 봤다 — 조작감(입력 → 화면 지연) · 걸음의 발 미끄러짐 · 히트스톱의 체감 · 카메라 추종의 멀미 여부 · 실제 fps는 미확인. 소리는 아무도 귀로 듣지 못했다(P7이 파형의 크기만 쟀다) |
| major | 환경 | 포트 5183을 출처 모를 vite(PID 2904)가 쥐고 있다. 내 것이 아니라 종료하지 않았다. 남의 탭 3개(`tab-1` file://…/index.html · `tab-2` localhost:5183 · `tab-5` 지워진 `poseViewer.html`)도 그대로다 |
| minor | 가독성 | 발더(갑옷 `0x4a4a52`)가 어두운 ember 아레나에서 실루엣이 어둡다. 자세 · 무기 발광 · 텔레그래프 · danger 표식으로 읽히기는 한다. 밝히려면 `rig.js`의 fill 값이나 P6 아레나 채움빛 |
| minor | 연출 | 플레이어 피격 점멸이 전신 순백 + 블룸이라 0.12초 동안 흰 덩어리로 보인다. 피격 비네트도 강한 편 |
| minor | 월드 | 안개문 두 기둥 사이에 콜라이더가 없어 막을 지나 뒤로 걸어갈 수 있다(`NOTES-P6` 7번). 상자 콜라이더를 더하면 `townScene.js`가 건물로 그리고 `gamesim.test`의 개수 단언이 깨져 손대지 않았다 |
| minor | 전투 | 돌진(`charge`)이 일직선의 플레이어를 밀고 간다(3.2m) · 발더 1페이즈의 5~6m 거리 공백과 옆구리 1.2~1.4 rad 공백(`NOTES-P3`) · 보스가 거의 걷지 않는다(후보가 늘 있다) |
| minor | UI | 승리 결과의 「준 피해 %」는 실제로 준 비율이다(디버그로 HP를 깎아 이기면 14%처럼 나온다 — 정상 플레이에서는 100%) |
| 보류 | 밸런스 | 격파 시간 · 도전 횟수 · 보상 곡선은 봇(P9)이 생긴 뒤 W3이 본다. W1에서는 수치를 하나도 바꾸지 않았다 |
