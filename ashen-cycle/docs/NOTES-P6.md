# NOTES-P6 (view-world)

계약과 어긋나게 처리한 것 · 통합 때 알아야 할 것. 전부 P6 소유 파일 안에서 해결했다.

1. **§9.2 「PCFSoft 그림자」** — three r186에서 `PCFSoftShadowMap`이 제거됐다(쓰면 매 프레임 경고 후 `PCFShadowMap`으로 바뀐다). `renderer.shadowMap.type = PCFShadowMap`으로 뒀다(r186의 PCF가 부드러운 필터다). 동작 차이 없음.
2. **§9.4 충돌 2번 「`world.colliders`의 원마다」 ↔ §7.8 · §9.3(부활 지점이 화톳불 바로 북쪽 · 카메라가 화톳불 위를 넘어 본다)** — 화톳불 원(r 0.9)까지 막으면 부활 직후 카메라가 `distMin`(1.2m)으로 등에 붙는다. `CameraRig`는 **시설 중심 · NPC 자리에 놓인 원(화톳불 · NPC 2명)을 카메라 장애물에서 뺀다**(낮아서 위로 넘는다). 아레나 기둥 · 안개문 기둥은 계약대로 막는다. 상자는 계약대로 검사하지 않는다.
3. **§9.2 후처리 체인** — 작업 지시(비네트)에 따라 `RenderPass → UnrealBloomPass → 비네트(ShaderPass) → OutputPass`다. `low`는 컴포저를 쓰지 않고 직접 렌더한다(블룸 · 비네트 · MSAA 타깃 없음 — 비용이 실제로 준다). 컴포저 렌더 타깃 MSAA는 medium 2 · high 4.
4. **`RenderContext` 추가 필드(P6 내부용)** — `rc.quality`(현재 단계 이름 — `WorldLayer`가 그림자 광원을 맞추려고 매 프레임 읽는다) · `rc.prewarm()`(부팅 때 네 월드의 셰이더 선컴파일). 계약 필드는 그대로다. `rc.setQuality`를 부르면 `WorldLayer`가 다음 `update`에서 그림자 맵 크기 · `sun.castShadow` · 떠다니는 입자 수를 따라 맞춘다.
5. **§9.4 `distMin`과 벽** — 플레이어가 경계에 등을 대면 `distMin` 1.2m가 강제되어 카메라가 경계 밖 최대 약 0.85m까지 나간다(계약 식 그대로). 그래서 경계 밖의 높은 구조물(회랑 기둥 · 성당 기둥 · 눈 둔덕 · 원판 가장자리)은 전부 반경 + 1m 밖에 뒀다.
6. **`data/camera.js`** — 계약 필드 값은 그대로이고 P6 내부용 필드를 더했다(`lock.yawMaxSpeed` · `nearDist` · `aim*`, `collide.growLambda`, `distLambda`, `shake`, `fx`). 록온 yaw는 `damp` + 각속도 상한 5.2 rad/s(순간이동 · 등 뒤로 넘어간 보스에 급회전하지 않게)이고 밀착(2.6m 안)에서는 λ가 줄어든다.
7. **안개문** — `data/world.js`에 두 기둥 사이를 막는 콜라이더가 없어 플레이어가 막을 지나 뒤(경계까지 약 2m)로 걸어갈 수 있다. 막은 양면으로 그렸다. 막고 싶으면 P2 데이터에 콜라이더를 더하면 된다(뷰는 그대로).
8. **조명 구성** — 광원 수가 테마마다 같다(반구광 1 · 그림자 방향광 1 · 점광원 4 — 안 쓰는 것은 세기 0). 전환 때 재질 재컴파일이 없게 하려는 것이다. P7의 점광원 풀도 켜고 끄지 말고 세기 0으로 두면 같은 이득을 본다.
9. **심연 제단의 룬** — 바닥 룬(보라 발광)은 텔레그래프와 색이 같아 일부러 어둡게(블룸에 거의 안 걸리게) 뒀다. 텔레그래프가 묻히면 `arenaScene.js` `buildVoid`의 `floorMat.emissiveIntensity`를 더 내리면 된다.
