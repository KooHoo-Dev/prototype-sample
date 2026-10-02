# NOTES-P1 (sim-rig) — W1

## 계약 해석 · 모순(내 파일 안에서 보수적으로 처리)

1. **landing 중 세트 전환**: §4.2 `RIG_BUSY` 설명은 「입질 · 파이팅 · 랜딩 · 결과 중의 세트 전환」인데 §5.2는 `failed` · `landing` → `pendingSet`이다. 더 구체적인 §5.2를 따랐다(landing 의 Digit1/2 는 미뤄 두고, landing 의 수심 입력은 `RIG_BUSY{depth}`). §4.2 문구를 고치면 맞는다.
2. **`biteWeights` · `biteRate`의 `weather` 인자**: 식은 `weather.biteMul`(WeatherDef)인데 판타지 조건은 `weather.current`(WeatherState)를 쓴다. WeatherId 문자열 · WeatherDef · WeatherState 셋 다 받는다. rig 는 `state.weather.current`(문자열)를 넘긴다.
3. **판타지 어종이 둘 이상일 때**(§5.4.3 `baitFit(f)`의 f): 조건을 만족하는 F 에서 하나를 균등으로 고른 뒤 그 어종의 미끼 적합도로 `chance(fantasyShare × clamp(fit, floor, 1))`. F 가 하나면 계약 그대로다.
4. **회수 ↔ 대기의 `phaseTime`**: §5.2 「떼면 waiting(minWait 는 다시 세지 않는다)」를 위해 waiting ↔ retrieving 전환에서 `phaseTime`을 0으로 돌리지 않는다(retrieving 의 phaseTime = 이번 대기가 시작된 뒤 경과). 수심 변경은 waiting · retrieving 모두 `phaseTime = 0`.
5. **첫 신호 전 Space**: bite 단계에 들어왔지만 첫 예신(`SIGNAL.firstDelay`) 전이면 헛챔질이 아니다(§5.2 「헛챔질은 입질 신호가 시작된 bite 단계에서만」). 본신까지 `earlyGrace` 안이면 선입력.
6. **`syncRig`가 더 맞추는 것**: 계약의 네 줄 + `perfectFrom = 1 − rigStats.perfectWindow` + (낚시 모드일 때만) `canCast` · `castBlock` — 결과/채비 패널에서 미끼를 사거나 바꾼 뒤(step 이 멈춘 동안) HUD 가 바로 맞는다. 걷기 모드는 `canCast false · castBlock null` 그대로(helpers 리터럴과 같다).
7. **`rollFish(pct)`**: `pct = Φ(z)`인데 Φ(Φ⁻¹(0.9)) 가 0.8999999… 로 'normal' 이 된다. z 가 [zMin, zMax] 로 잘리지 않았으면 받은 pct(클램프 값)를 그대로 쓴다(수학적으로 같은 값).
8. **1.7초 재캐스팅의 틱**: 실패 틱 → 알림 60틱 → ready 틱에 충전 시작 → 충전 42틱째(0.7초 · 게이지 0.875)에 떼면 실패 틱부터 정확히 102틱 = 1.7초(rig.test). 게이지를 「보고」 다음 틱에 떼면 1틱(1/60초) 늦다.
9. **충전 중 `!input.primary`도 뗌으로 본다**: 한 프레임 안의 누름+뗌(에지만 오고 홀드 없음)에서 충전이 끝없이 이어지지 않게. app 의 락 요청 클릭은 primary 로 나오지 않으므로(§11.3) 영향 없다.
10. **명령의 reason**: `keepCatch` · `releaseCatch`를 result 밖에서 부르면 `notHere` · 없는 swapUid 는 `invalid` · `setFloatDepth(NaN)` · 모르는 자리 · 모르는 어종은 `invalid`. 어창에 자리가 있는데 swapUid 를 주면 무시하고 그냥 넣는다.
11. **`BITE_NIBBLE.index`**: 이번 입질의 0부터 센 순번. `signal.count` = 지금까지 횟수(index + 1). 바닥 초리 떨림은 `pulse`마다 BITE_NIBBLE 이고 `signal.kind`는 떨림 동안 내내 'nibble'.
12. **데이터에 더한 값**(`data/bite.js` — 계약 값은 그대로): `BITE.pctMin/pctMax`(§5.4.5 의 0.0005 · 0.9995) · `RIG.timeEps`(누적 DT 비교 여유 1e-6) · `RIG.debugBiteCastFrac 0.8` · `RIG.debugFightCastFrac 0.6`(§6.5 · §6.3 의 디버그 착수 비율).
13. **fixture 로 `fighting`/`landing`인데 `state.fight`가 없으면** 조용히 ready 로 돌린다(던지지 않는다).

## biteModel.test 의 허용 오차

§12.2 는 「기대 ≥ 400 이면 상대 오차 ≤ 10%, 그 밖 |관측 − 기대| ≤ 4√기대 + 2」. 기대가 400 근처면 10% 는 약 2σ 라 36종 × 5칸 중 하나가 우연히 넘는다(붉돔 밤 429 vs 477 — 20만 뽑기로는 0.2383 vs 0.2385 로 치우침 없음). 두 허용 중 넓은 쪽을 쓴다(뽑기 수는 계약대로 2,000). 같은 파일에서 가중치 식 자체는 독립 참조식과 1e-12 로 대조한다.

## 다른 패키지가 알아야 할 것

- `fightImpl.createFight(ctx, {speciesId, roll, dist, bearing, depth})`는 `HOOK_SET` 직후 · `rig.phase = 'fighting'` 전에 불린다. `rig.dist` · `rig.bearing`은 흘림 경계(§5.2) 안이다. 파이팅 중 베일은 `rig.bailOpen`(rig 가 토글 · `BAIL_CHANGED`).
- `updateFight`가 `{type:'net'}`이면 landing(0.8초) → `evaluateCatch(ctx, fight.roll, fight.t)` → result. 그 밖이면 `applyLoss(ctx, set, type, {lineLostM, baitId: castBaitId, cause, hookSmall})`.
- 자리 봇 `createAngler`: ready 에서 세트(selectSet) → 미끼(`setBait` 명령 — 지정 미끼가 없으면 지금 미끼, 그것도 없으면 가장 많은 미끼) → 찌 수심(depthSteps, 2틱에 1눈금) → 누름. 게이지가 `BOT.castPower` 표본을 넘거나 꼭대기를 지나면 뗀다. 입질마다 `BOT.earlyRate`로 첫 예신에 성급히 챔질. 본신을 보고 `BOT.react` 뒤 Space. 파이팅은 `createFightPolicy(strategy, seed)` 그대로(`sim.getRigStats()`를 넘긴다). result 에서 keep — 어창이 차면 가장 싼 것보다 비쌀 때만 swap, 아니면 release. 미끼 · 라인이 없으면 ready 에서 손을 놓는다(계획 봇이 맡는다).

## 확인하지 못한 것

- 예비 스풀로 라인이 모자란 실패 뒤의 2초 재도전 — `applyLoss`(P4)가 W0 스텁이라 rig.test 는 라인 감소 · 예비 스풀을 볼 수 없다. 통합 뒤 `economy.test`(P4) · 헤드리스로 확인.
- 실제 파이팅(P2) · 실제 정책(P2 policy) 위에서 createAngler 가 도는지 — rig.test 는 §3.4 전 필드의 가짜 FightState 로만 돌렸다.
