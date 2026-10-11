# NOTES-P7 — view-world (W1)

계약과 어긋나야 했던 곳 · 계약에 더한 공개 동작 · 통합 때 볼 것. 공개 API(§6.14) 이름 · 시그니처는 계약 그대로다.

## 계약과 다르게 한 것 (P7 파일 안에서 해결)

1. **안개 밀도** — §9.2 의 FogExp2 밀도(0.035 · 0.03 · 0.015)를 그대로 쓰면 기본 거리에서 카메라→플레이어가 26.5m 라 플레이어 자리가 이미 58%(crypt) 안개 → 빛 반경 · 횃불이 보이지 않는다. 종류(FogExp2) · 색은 그대로, 밀도 × `FOG_K` 0.5(`view/world/style.js`) + 줌하면 밀도 ∝ 24/거리(플레이어 자리 안개 양 일정 — `CameraRig.update`). 조정 손잡이 `FOG_K` 0.4~1.0.
2. **빛 세기 단위** — §9.2 · §7.12 의 세기(플레이어 2.2 · 촛불 1.2 …)는 상대값으로 읽고 three 물리 단위로 × `LIGHT_SCALE` 24 · decay 1.0, 반구광 「0.25」 × `HEMI_SCALE` 12(style.js — 화면을 보고 맞춘 값).
3. **「위 · 아래 각 11.4m」(§9.3)** — 계약 식(대상 = 플레이어(y 1) + 0.12 × 거리)을 그대로 쓰면 y 1.0 평면에서 위 11.43 · 아래 11.38m(= BOT.viewR), 땅(y 0)에서는 위 12.86 · 아래 11.11m(≥ MON.threatRange 11). 식은 바꾸지 않았고 테스트가 둘 다 본다. §9.2 의 「(§9.5)」는 §9.4 의 오기로 읽었다.

## 계약에 더한 것 (호환)

- `rc` 추가 필드: `lights`(반구광 · 해 · 플레이어 빛 · 맵 빛 풀 maxLights − 1) · `quality`(지금 화질 ID) · `setAtmosphere(tileset)`. `rc.render()`가 `settings.quality` 변화를 보고 `setQuality`를 부른다(SETTINGS_CHANGED 를 잇지 않아도 된다 — settings 는 같은 객체를 필드만 바꾼다 §11.1). antialias 는 만들 때만 정해진다.
- 가림: 키 큰 막는 소품(h ≥ 1.6 — 기둥 · 석순)도 플레이어를 가리면 0.6m 로(좁은 판정 `propOccludesPlayer`) · 마을 건물은 플레이어를 가리면 0.15초에 반투명(0.28 — 카메라 쪽 광선). 한 프레임에 2.5m 넘게 옮기면(순간이동 · 상태 교체) 낮추기를 바로 맞춘다.
- `CameraRig`는 `PLAYER_SPAWNED` · `SHAKE`를 스스로 구독한다(app 의 `camera.snap()`은 중복이지만 무해). 이벤트의 x, z 로 `target`을 그 자리에서 바로 옮겨 같은 프레임의 world · actors 갱신(카메라보다 먼저)이 새 자리 기준이 된다. `update` 안에서 `camera.updateMatrixWorld()` — `project` · `groundAt`이 렌더 전에도 맞다.
- 시간: `dtReal > 0`이면 그것, 0(`__game.step`)이면 민 틱 × DT — 정지 화면에서도 벽 낮추기 · 카메라 따라가기 · 줌이 진행한다(§9.1).
- high 그림자는 플레이어 점광원만 · 벽은 드리우지 않는다(받기만 — 큐브 6면 비용이 벽 수에 비례).
- 균열 포털(`rift.portals`) = 서 있는 빛 고리 + 바닥 고리 + 안쪽 후광(귀환 파랑 · 출구 금빛) + 포털 빛. 소용돌이 입자는 P13. 마을 포털 안쪽 발광 · 빛은 `town.portalOpen`일 때만 · 균열석 흰 고리는 `char.runs === 0`.

## 통합 때 볼 것

- **NPC 몸은 P8**(§9.5) — 스텁 WorldLayer 가 그리던 NPC 원기둥은 없앴다. P8 `ActorLayer.setMap`이 NPC 를 그리지 않으면 마을에 NPC 가 보이지 않는다.
- P9: 화질은 `settings.quality`만 바꾸면 된다 · `webglcontextrestored` → `world.setMap(map)` 다시(이전 자원 해제 · 재생성). 균열 맵 캐시는 두지 않는다(마을 ↔ 균열마다 다시 짓는다 — 30~60ms, 전환 막 아래).
- 낮춘 벽은 윗면이 어두운 낮은 덩어리로 보인다(빛이 윗면을 비추지 않는다) — 벽에 가린 몸의 외곽선은 P8.
- 성능(헤드리스 SwiftShader 실측): 생성 균열 medium 그리기 호출 12 · 삼각형 13~15만(대부분 벽 인스턴스) · high 54 호출 · 24~27만(그림자 6면) · setMap 반복에 지오메트리 수 그대로.
