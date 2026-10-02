# NOTES — P5 view-characters

계약(§9.5 · §9.6)의 공개 이름 · 시그니처는 그대로다. 아래는 계약 밖에서 정한 것과, W2(P10 · P11) · W3이 알아야 할 것.

## 계약 밖에서 정한 것 (자기 파일 안)

- **내부 파일 추가**: `src/view/characters/geo.js`(절차 지오메트리 조각 + 「관절 × 재질」 병합). rig · 무기 · NPC · 발더가 쓴다. P10 · P11이 장식 메시를 덧붙일 때 써도 된다.
- **`Rig`의 덤**(계약의 `applyPose · setFlash · setGlow · dispose`는 그대로): `cape`(망토 — 뷰가 매 프레임 `cape.update`) · `ikLeftHand(target, weight)`(양손 무기의 왼손 2관절 IK) · `groundFeet(weight)`(인간형: 낮은 발을 지면에 붙이고 hips 높이를 맞춘다) · `setBoost(x)`(2페이즈 발광) · `setOpacity(a)`(사망 소멸). 소켓 `gripL`(왼손 자리, 인간형만).
- **`buildHumanoidRig` opts 확장**(전부 선택): `helmet: 'horned'` · `heavy` · `accentGlow` · `apron`. 계약의 6개 필드만 줘도 된다.
- **`pose.js`의 덤**: `poseDeg` · `withPose` · `copyPose` · `addRot` · `addPos` · `applyGait`. 포즈 표를 도(°)로 적고 걸음 사이클을 얹는 도구다.
- **무기 메시 교체**는 `WEAPON_EQUIPPED` · `PROFILE_CHANGED`를 구독하지 않고 매 프레임 `state.player.stats.weaponId`를 본다(결과는 같고 이벤트 누락에 안전하다).
- **재질의 자체 발광(fill)**: 아레나 조명이 어두워 금속 재질이 검게 뭉개져서, 모든 리그 재질이 제 색 × 0.1~0.2로 약하게 빛난다(블룸 임계 아래). P6 조명이 밝아지면 `rig.js`의 `FILL`만 낮추면 된다.
- **느린 걸음**(가드 · 플라스크, 걷기 속력의 62% 미만)은 보폭을 `strideWalk`의 절반으로 그린다 — `PLAYER_STEP` 한 번에 두 걸음.

## P10 · P11에게 (리그 빌더를 고치지 않고 쓰는 법)

- **사족**: root 원점 = 몸 중심(보스 `pos`). 코끝 z = +0.518 × length, 엉덩이 끝 z = −0.482 × length(꼬리는 더 뒤). 다리 관절은 rest에서 지그재그로 놓여 있어 회전 0이 선 자세다. `rig.height` = shoulderHeight.
- **부유체**: 몸은 root 위 `[hover, height]`를 차지한다. **sim이 `boss.y = hoverY`로 root를 이미 올리므로 `hover: 0, height: def.height − hoverY`로 만들어야 두 번 뜨지 않는다.** 무기 메시는 없다 — `sockets.weapon`에 붙이고 `weaponBase/Tip`의 `position.y`를 맞춘다(날의 축 = 소켓 로컬 +Y).
- 재질은 리그마다 따로다. `setGlow`는 accent 재질만 바꾼다. 점멸(`setFlash`)은 CharacterLayer가 `HIT`에서 건다 — 보스 뷰가 따로 할 필요 없다.
- CharacterLayer는 `MODE_CHANGED`마다 보스 뷰를 **새로 만든다**(재도전 포함). 뷰의 `onEvent(name, payload)`에는 `HIT` · `BOSS_*`가 EV 문자열 이름으로 온다.

## 개발 도구

- 포즈를 한 장에 늘어놓고 보던 개발용 뷰어는 납품 전에 지웠다(게임 빌드와 무관). 포즈 수치 점검은 `rig.test.js`의 실루엣 테스트가 대신한다.
