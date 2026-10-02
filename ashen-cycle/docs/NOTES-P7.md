# NOTES-P7 (fx-audio)

## 계약과 다르게 한 것 (자기 파일 안에서 해결)

1. **§9.7 `HIT` 스파크 방향** — 표는 「`dir` 방향 원뿔」이지만, `dir`은 공격 원점 → 대상 방향이고 `x, z`는 대상 원의 공격자 쪽 표면이라 `+dir`로 뿌리면 스파크가 대상의 몸 안으로 들어가 가려진다(화면에서 확인). `dir` 축은 그대로 쓰되 **표면에서 바깥(공격자 쪽 = `−dir`)** 으로 튀게 했다. 플레이어 피격의 붉은 파편은 `+dir`(뒤로 튐) 그대로다.
2. **마스터 컴프레서/리미터** — Chrome의 `DynamicsCompressorNode`는 작은 소리에 메이크업 게인(이 설정에서 약 1.9배)을 걸고 순간 피크는 그대로 통과시킨다(OfflineAudioContext로 측정: 평범한 타격이 피크 0.66). 그래서 `컴프레서 → 보정 게인(0.62) → 소프트 클립(WaveShaper)` 으로 구성했다. 측정값: 타격 0.32 · 패링 0.40 · 발소리 0.08 · 최악의 겹침(처형 + 패링 + 포효 + 착지 + 페이즈 + 격파 동시) 0.53 — 클리핑 없음.
3. **이벤트 처리 시점** — `FxLayer`는 버스 이벤트를 큐에 쌓았다가 `update()`에서 순서대로 처리한다(그 프레임의 `state` · 보간 위치 · 소켓을 같이 쓰려고). sim 이벤트는 틱 끝에 플러시되고 `fx.update`는 같은 프레임에 불리므로 한 프레임도 늦지 않는다.

## 내부 파일 추가 (`src/view/fx/` — P7 폴더 소유)

`fxColors.js`(팔레트 → THREE.Color) · `markers.js`(록온 · 그로기 · danger 표식) · `overlay.js`(피격 가장자리 번쩍 · 화면 섬광). `FxLayer.js`만 import 한다.

## 통합 때 알아 둘 것

- `FxLayer`는 `fxRoot` 아래에 **점광원 3개를 항상 켜 둔다**(세기 0 — 개수가 바뀌면 전 재질이 다시 컴파일되기 때문). 씬의 광원 수가 3 늘어난다.
- 무기 궤적은 `getSocketWorld(who, 'weaponBase' | 'weaponTip')`가 둘 다 `true`일 때만 그린다. 리본은 날의 바깥쪽(플레이어 55% · 보스 40%)만 덮는다 — 날 전체를 덮으면 보스 대검의 부채꼴이 화면을 가렸다.
- 브레스 · 광선 · 예고 발광은 `seq`로 끝난다(`*_end` 큐 또는 `BOSS_ATTACK_END`). 끝 이벤트를 놓쳐도 `attack.active + 1.5초`(공격 정보가 없으면 6초) 뒤 스스로 멎는다. 오디오의 지속음도 6초 상한.
- 떨어지는 검(`void_sword`)의 높이는 `hazard.t / hazard.warn`(sim 시각)에서 계산한다 — 히트스톱에도 착지가 활성화 틱과 맞는다.
- `AudioEngine.update(state, dt)`를 매 프레임 불러야 타악이 예약된다(0.18초 앞까지만 예약). `unlock()` 전의 `MODE_CHANGED`를 놓쳐도 `update`가 `state.mode`를 보고 분위기 음을 맞춘다.
- `BOSS_ATTACK_ACTIVE`의 「큰 휘두르기」 소리는 `getBossDef(bossId).attacks[attackId].hits`가 비어 있으면 내지 않는다(시전 · 순간이동 공격).

## 검증 메모

- 브라우저 pane이 백그라운드라 `requestAnimationFrame`이 돌지 않았다 → 임시 하네스(프레임을 손으로 밀고 캔버스를 `<img>`로 옮김)로 실제 `GameSim` + `WorldLayer` + `CharacterLayer` 위에서 확인했다(하네스 · 측정 스크립트는 지웠다). 소리는 `OfflineAudioContext`로 파형을 뽑아 크기만 쟀다 — **귀로 듣지는 못했다.**
