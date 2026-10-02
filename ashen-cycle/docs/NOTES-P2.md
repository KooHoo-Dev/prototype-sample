# NOTES-P2 (sim-combat)

계약에 없어서 P2가 정한 것 · 계약의 빈 곳을 보수적으로 메운 것. 공개 시그니처 · 이벤트 이름 · payload는 계약 그대로다.

## 계약의 빈 곳을 메운 것

1. **`Hazard.facing` 필드 추가**(§3.6에는 없다). §3.2가 장판 판정의 `OutgoingHit.facing = 생성 시 facing`을 요구하는데 `Hazard`에 방향이 없어서, `spawnHazard`가 만든 장판에 `facing`을 덧붙인다(상위 호환 — 읽는 쪽은 무시해도 된다). `makeTestCtx`가 만든 장판처럼 필드가 없으면 0으로 본다.
2. **쓰러진 보스(hp 0)는 더 맞지 않는다** — `resolveHitOnBoss`가 `null`(등록 · HIT 없음). §6.4 규칙 1 그대로면 승리 outro 동안 시체를 벨 때마다 `immune` 스파크가 튄다(P3가 사망 시 `invulnerable = true`).
3. **`immune`에서는 `onBossDamaged` · `onPlayerDealtHit` · 히트스톱 · 흔들림을 건너뛴다**(§6.4 규칙 1 ↔ 6 · 7의 적용 범위가 모호 — 보스에게 아무 일도 없었으므로 HIT만 낸다).
4. **플레이어 타격의 `hitstop === 0`은 히트스톱 없음**이다. §3.2는 "0이면 P2가 data/combat 기본값"이라 하지만 `COMBAT`에는 보스 → 플레이어 기본값(`bossHitHitstop` 등)만 있다 — 그쪽에만 기본값을 쓴다.
5. **모드 전환의 일괄 정리(`'clear'`)는 `MODE_CHANGED` 뒤에 낸다**("전환의 첫 이벤트는 `MODE_CHANGED`"와 "모드 전환 때 `'clear'`"를 둘 다 지키려면 이 순서뿐이다). fx는 `MODE_CHANGED`에서 이미 전부 치웠을 수 있으니 모르는 id의 `*_ENDED{clear}`를 무시해야 한다. 평소에는 승리 · 사망 · 포기 · **outro 끝(`done` 직전)** 에 이미 치워서 전환 때 남는 것이 없다.
6. **마을을 떠날 때 `NEAR_FACILITY_CHANGED{id:null}`** 을 낸다(프롬프트가 남지 않게). 마을에 들어온 첫 틱에 `{id:'bonfire'}`가 나온다.
7. **보스전 난수 시드의 attempts는 `noteAttempt` 뒤의 값**이다(첫 도전 = 1).

## P2가 정한 세부

- `HIT`는 반응 호출(`onBossDamaged` · `onBossParried` · `onPlayerDamaged` · `onPlayerDealtHit`) **뒤에** 큐에 들어간다 — 같은 플러시 안에서 `BOSS_GROGGY` 등이 `HIT`보다 먼저 나올 수 있다.
- `DamageResult.knockdown`은 outcome `hit`일 때만 true(가드 · 패링에는 false). `staminaDamage`는 계산값 그대로(남은 스태미나로 자르지 않는다). `rawDamage`는 보스 대상이면 치명 배율을 곱한 반올림 전 값.
- `postureIdle = 0`은 체간이 실제로 쌓일 때만(체간 0짜리 타격은 감쇠 타이머를 건드리지 않는다). `boss.invulnerable`이면 패링 체간도 쌓지 않는다.
- 정면 판정: 판정 원점이 플레이어 원(반경 0.4) 안이면 출처와 무관하게 `frontal = true`(계약은 장판만 적었다).
- `debug.noStamina`면 가드 스태미나 소모 0. `debugDamageBoss`는 셰이프 · 무적 · 치명 · 히트스톱 · 흡혈을 건너뛰고 `fight.damageDealt`에는 더한다.
- 사망 뒤 보스가 마저 낸 투사체 · 장판은 outro 동안 피해 없이 진행하다 `done` 직전에 `'clear'`로 사라진다.
- `HITSTOP{dur}`는 요청마다 낸다(`dur` = 병합 뒤 남은 히트스톱).
- ctx의 내부 필드 `_playerHitTick`(틱당 피격 1회 표식) · `_interactCd`(상호작용 재입력 간격)는 상태가 아니다 — 다른 패키지는 쓰지 않는다.
- 테스트 이음매: `sim._ops = {updatePlayer, bufferPlayerInput, getPlayerHit, updateBoss, getBossHits, getBossTelegraphs}`. P2 테스트가 P1 · P3 구현과 무관하게 틱 순서를 검증하려고 갈아 끼운다(`test/gamesim.fixtures.js`). 런타임 코드는 건드리지 않는다.

## 수치

`data/combat.js` · `data/world.js`는 §7.2 · §7.8의 시드 값 그대로다(조정 없음).
