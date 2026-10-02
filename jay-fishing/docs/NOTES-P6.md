# NOTES-P6 (view-tackle) — W1

소유: `src/view/tackle/TackleLayer.js` · `src/view/fish/fishModel.js` · `src/view/fish/FishLayer.js` · `src/view/fish/FishPreview.js` · `test/fishModel.test.js` + 폴더 내부 파일 `src/view/tackle/netPose.js`(뜰채 자세 · 물고기 위치 — 두 레이어가 같은 식을 쓴다).

## 계약에서 보수적으로 벗어난 것(판정 = 보이는 것의 「중심」은 그대로)

1. **aimPreview 고리 반경**: 계약 0.6m 그대로면 28m 에서 세로 2px 미만이라 보이지 않는다(정지 화면으로 확인). 7m 너머는 찌와 같은 `clamp(dist / 7, 1, 18)`로 키우고 중심에 세로 표식(핀)을 더했다. 중심은 정확히 `rig.aimPreview`(테스트로 고정). 계약 §9.7 문구를 「반경 0.6m × 찌 배율」로 고치면 맞는다.
2. **물고기 그림자 크기**: 낮은 시선각(35m 에서 약 4°)에서 길이 = `lengthCm/100` 데칼은 몇 px 로 눌린다. 그림자 · V자 물결에 `clamp(dist / 10, 1, 3.5)` 읽힘 배율을 곱했다(위치 · 불투명도 식은 계약 그대로). 그림자는 `−depth`에 놓지 않고 수면 바로 위(y 0.012) 데칼로 그리고 깊이는 계약의 불투명도 식으로만 말한다(물 셰이더에 가려지지 않게).
3. **더한 연출**: 수심 < 0.35m(점프 예고 · 지친 물고기)이면 lod 1 모델의 등이 수면을 가른다 — 「점프 예고 = 그림자 상승」이 먼 거리에서도 보인다. 점프 모델은 시선에 옆으로 몸을 틀어(broadside) 보인다.
4. **로드 휨의 모양**: 계약의 휨 값(sqrt · 70°)은 그대로. 1인칭에서 휨이 깊이 방향으로 숨지 않도록 휨 평면을 첫 마디에서 −0.75rad 돌리고(`BEND_ROLL`), 세운 정도(`rodLift`)만큼 로드를 오른쪽으로 0.2rad 눕힌다(`LIFT_LEAN`). 곡률은 끝으로 갈수록 크게(지수 1.3).
5. **로드 각 「수평 위」**는 월드 수평으로 읽었다(카메라 pitch 를 빼서 카메라 공간 각으로 바꾼다). 75°(완전히 세움)에서는 로드 끝이 화면 위로 나간다 — 그때 휨은 화면 안의 중간 마디와 떨림으로 보인다.

## 계약의 빈칸 — 이 패키지가 정한 공개 동작

- `FishPreview.ok`: 「아직 WebGL 생성에 실패하지 않았다」. document 가 있으면 생성 직후 true, 첫 `show`/`snapshot`에서 만들다 실패하면 false(그 뒤 snapshot → ''). Node(document 없음)는 false · canvas null.
- `FishPreview.snapshot`: PNG dataURL · 투명 배경 · 크기 `size × round(size × 0.625)`(16:10). 캐시 키는 (speciesId · silhouette) — 같은 키의 두 번째 호출은 첫 크기의 이미지를 그대로 준다. `lengthCm`는 모델 크기에 쓰지 않는다(화면에 맞춘다 · 크기는 패널 숫자가 말한다).
- `FishPreview.render(dt)`: 캔버스의 `clientWidth/Height`(없으면 320×200)에 맞춰 크기를 바꾼다 — ui 는 CSS 로 크기만 주면 된다.
- `buildFishModel`: 지오메트리 · 무늬 텍스처는 (어종 · lod) 캐시(상한 36 × 2 · 길이 1을 안쪽 그룹 scale 로 키운다), `disposeFishModel`은 재질만 정리하고 부모에서 뗀다. 반환 그룹 아래 메시 이름: `body` · `fins` · `eyes` · `pupils` · `mouth`. 추가 export: `fishModelCacheStats()` · `fishTriangleCount(group)`.
- `TackleLayer.js` 추가 export(순수 도우미 — 테스트용): `floatScale` · `rodBend` · `floatSignalOffset` · `rodAngleDeg`. `FishLayer.js`: `shadowOpacity`. `netPose.js`: `netPose` · `fishPoint` · `fishInNet` · `netHandleLength` · `LEFT_HAND_CAM` 등.
- 씬 그래프 이름: `tackleRoot` · `viewModel`(카메라 자식) · `fishRoot` · `aimPreview` · `float` · `sinker` · `fishingLine` · `landingNet` · `brokenTip` · `fishShadow` · `rodSeg0..11` · `rodTip` · `leftHand` · `rightHand`.

## 통합 때 볼 것(남의 몫)

- **오른손이 거의 화면 밖**: 계약의 손잡이 위치(카메라 공간 (0.26, −0.30, −0.42))는 FOV 70 에서 화면 아래 끝 바로 아래다 — 릴과 손잡이 위쪽만 보인다. 손을 보이게 하려면 계약 값을 (0.24, −0.24, −0.42) 근처로.
- **뜰채의 대부분이 화면 밖**: 물고기는 물가에서 2m 남짓 · 눈높이 2m 이상 아래(약 45° 아래)라, 낚시 자세의 카메라 pitch(−0.15)로는 뜨는 순간이 화면 아래다. 들어 올리는 끝(진행 0.6 → 1)에서 그물이 시야로 올라온다. landing 동안 카메라를 조금 숙이면(P5 CameraRig · P9) 뜨는 장면이 보인다.
- **35m 너머의 물고기**: 그림자 · 물결은 몇 px 이다. 먼 파이팅은 로드 휨 · 라인 방향 · HUD 게이지가 말한다(P7 의 질주 물보라가 입수점을 보탠다).
- `docs/_scratch/`를 다른 작업자가 통째로 지운 일이 있었다(내 확인 페이지가 사라졌다) — 작업자마다 하위 폴더를 쓰는 편이 안전하다.

## 사람이 확인할 것(실시간 · 조정 손잡이)

- 질주 예고의 꼬리침(`FishLayer.js` `RUN_WAG` 0.55rad · `RUN_WAG_HZ` 7 — 0.4–0.8 · 5–9), 한계 근처 로드 떨림(`TackleLayer.js` `STRESS_TREMBLE` [0.01, 0.03] · `STRESS_HZ` 17 — 계약 값), 소형어 잔떨림(`SMALL_TREMBLE` 0.004 · 12Hz — 계약 값), 챔질 때 로드가 서는 양(`HOOKSET_KICK` 14° · 0.25초 — 8–20°), 덜컹(`SHAKE_KICK` 0.05rad — 0.03–0.08).
- 꺼내기 · 세트 바꾸기 · 예비 로드 올라오기(`RAISE_TIME` 0.3초 · `RAISE_DROP` 0.6m · `SWAP_DROP` 0.35m), 부러진 끝이 떨어지는 모양(`BREAK_LIFE` 1.4초).
- 읽힘 배율(`VIS_REF` 10 · `VIS_MAX` 3.5 — 2–5), 휨 평면 돌림(`BEND_ROLL` −0.75 · `LIFT_LEAN` −0.2).
