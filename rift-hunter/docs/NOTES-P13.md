# NOTES-P13 — fx (W2)

소유: `src/view/FxLayer.js` · `src/view/fx/`(style · decals · particles · batches · actors) · `test/view.fx.test.js`. 공개 API(§6.14)는 그대로 — 진단용 `info()`만 더했다(계약 밖 · 읽기 전용).

## 계약 해석 · 정한 것

1. **궁수 조준선(`telegraph: 'aimLine'`)과 시전 빛(`'glow'`)은 P13이 그린다** — §9.5 · §9.7 어디에도 조준선의 주인이 없다. 상태(`mon.act` windup/cast · 공격 행의 `telegraph` · `mon.aim` · `aimLocked`)로 그린다: 붉은 선(조준이 멈추면 굵게) · 손 빛(색 = 공격 type) · `cast` + `aim`이면 대상 자리 빛기둥(주술사 부활). P8이 같은 것을 그리지 않게.
2. **입자 상한 2,000 = 시뮬 입자(가산 1,100 + 먼지 300) + 프레임 스프라이트 600**(오라 · 상태 · 포털 · 투사체 후광). 데칼 200 = 상태의 효과 + 순간 표식 합. 투사체 256. 넘는 것은 그리지 않는다(풀이 자라지 않는다 · `view.fx.test`).
3. **순간 연출은 이벤트 + 상태 대체 경로** — `EFFECT_HIT` · `ACTION_HIT`을 놓쳤을 때(고정 상태가 판정 틱에 서 있음 · 레이어가 늦게 붙음) 같은 연출을 상태(효과 ID · 플레이어 `actId`)로 한 번 세운다. 이벤트 payload에 틱이 없어 마지막으로 그린 상태(= `sim.state` 같은 객체)의 `tick`을 적는다(플러시는 step 끝이라 그 틱이 맞다).
4. 버프 연출은 `getSkillDef(buff.id).behavior`로 고른다(`buff` → 금빛 고리 · 남은 시간 = `params.buffSec` · `shield` → 푸른 구체 · 불투명도 = `player.shield / buff.value`) — `Buff.id` = 스킬 노드 ID(§3.7).
5. `ACTION_HIT` 좌표: 도약은 `x, z` = 착지점 · 순간이동은 `x, z` = 출발 · `tx, tz` = 도착(P1 구현 그대로 썼다).
6. 표에 없는 효과 kind · 투사체 visual은 기본 모양(적대 = 붉은 테두리 + 연한 안쪽 · 비적대 = 흰 테두리)으로 그린다.

## 다른 패키지가 알 것

- **P16**: 몰타르 포탄 · 잿불 비의 낙하체는 효과의 `from`이 있을 때만 그린다(고정 상태는 넣는다). 훅에서 `spawnEffect({..., from: {x: mon.pos.x, z: mon.pos.z}})`를 주면 포탄이 몬스터에서 날아온다(없으면 바닥 표식만).
- **P9 · 오케스트레이터(화면 확인)**: `?fixture=<id>`로 띄운 뒤 probe가 멈추기 전에 게임이 몇 프레임 돌아 고정 상태의 순간(회오리 채널 · 판정 틱)이 지나간다. 정확한 순간은 `npm run probe:screen -- "<주소>?fixture=<id>" --step 0 --eval "api.loadFixture('<id>')"`.
- **P8**: 얼음 껍질 · 기절 별 · 보호막 구체 · 속성 오라는 P13(§9.5 그대로). 강인함은 P8 재질만(P13 입자 없음).

## 사람이 확인할 것(이 환경에서 못 본 것 — 조정 손잡이는 전부 `src/view/fx/style.js`)

- 실시간 움직임: 불꽃 · 먼지 · 불씨 입자의 속도 · 수명(`BURSTS.*` speed · life · grav), 오라의 회전 속도(`AURA.wind.spin` 6.5 · `AURA.chains.spin` 0.8), 번개 아크의 깜빡임(`AURA.arcs.hz` 14).
- 표식 밝기: 채움 `DECAL.fillA` 0.30(0.25~0.4) · 테두리 `DECAL.borderA` 0.92 · 판정 순간 `DECAL.flashA` 0.6(상한 — 올리지 않는다).
- 지면 강타 부채 · 화염구 폭발 구의 세기(`_transients`의 fan 0.4 · sphere 0.95) — 정지 화면에서는 적당했다. 실시간으로 눈이 부시면 낮춘다.
- 중급 GPU에서 떼 + 바닥 효과가 많을 때의 프레임(연출 드로콜은 효과 수와 무관하게 최대 17 — 데칼 2 · 입자 3 · 인스턴스 12).
