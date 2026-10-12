# STATUS — rift-hunter

| 날짜 | 단계 | 결과 | 비고(run ID · 다음 할 일) |
|---|---|---|---|
| 2026-10-11 | 접수 | 브리프 작성(`docs/BRIEF.md` — Jay 결정 Q1~Q5 권장안 · 기본값 변경 없음) · `prototypes.json` 항목(port 5400 · making · public false) | 다음: `proto-design` |
| 2026-10-11 | 설계 | 계약 확정(3,562줄 · 비평 3관점 81건 중 80 반영) · 패키지 17개(W0 P0 · W1 P1–P8 · W2 P9–P16) · 스캐폴드 build ok · test 62 pass 0 fail 41 todo · check:dist ok · check-packages ok | run `wf_c34c2f74-365` · Jay가 정할 것 3(카메라 24m · 상점 재고 판마다 갱신 · 새 캐릭터 액티브 1랭크 시작 안 함) · 다음: proto-build W1 |
| 2026-10-11 | Jay 결정 | 설계의 「Jay가 정할 것」 3건 모두 권장안(카메라 24m · 재고 판마다 · 스킬 0점 시작) — 계약 그대로 · 브리프 머리 · §3.8 · §5 문장 맞춤 | W1(run `wf_e89b149d-0eb`) 진행 중 — 계약 변경 없음 |
| 2026-10-11 | 구현 W1 | P1–P8 → 통합 게이트 · build ok · test 452(437 pass · 0 fail · 15 todo) · check:dist ok · 정지 화면(마을 · riftSwarm · riftElites · riftMage) 직접 확인 | run `wf_e89b149d-0eb` · **blocker 1**(시작 캐릭터가 균열 1을 못 깬다) · major 2(첫 판 길이 · 부활 뒤 같은 떼) → W2 전에 닫는다(밸런스 수정 워크플로 `wf_dd6a2ec2-894`) |
| 2026-10-11 | W1 밸런스 수정 | blocker 1 · major 2 닫음(NOTES-W1FIX — 수정 4라운드) · 균열 1 첫 판 두 클래스 × 시드 1~16 완료 32/32 · 사망 중앙 0 · 7.4/8.0분 · 부활 · 출현 예고 스윕 재각성 0 · 3관점 재검증 통과 · build ok · test 463(448 pass · 0 fail · 15 todo) · check:dist ok | run `wf_dd6a2ec2-894` · `wf_ed29996a-e5b` · Jay가 정할 것: 균열 1~4 입문 피해 경사(레벨당 ×1.63 — 브리프 +8~15% 밖, 권장 유지) · 다음: proto-build W2 |
| 2026-10-12 | 구현 W2 | P9–P16 → 통합 · 밸런스 게이트(봇 측정 ✓ 24 · ✗ 13 · MEASURE.md) · 화면 패스 · build ok · test 642 pass 0 fail · check:dist ok · 정지 화면(봇 판 전사 · 마법사 · 정예 · 대장장이 · 스킬 트리 · 분석) 직접 확인 | run `wf_068bc73b-7a1` · Jay가 정할 것(NOTES-BALANCE §6): 초반 경사 균열 1~11 · 레벨 캡 30 대 요구 레벨 · 업그레이드 판 비율 · 수호자 사망 몫 · 다음: proto-review |
| 2026-10-12 | 리뷰 | 5관점 결함 26건 → 수정 24 · 보류 2(Jay가 정할 것) · 프로덕션 빌드 전체 루프(실제 키 · 마우스 · 두 탭 · 새로 고침) 오류 0 · build ok · test 672 pass 0 fail · check:dist ok | run `wf_e2da267d-ebe` · Jay가 정할 것(NOTES-REVIEW §6): 균열 안 스킬 트리 모달 · Alt 조합 · 메테오 시야 + 이어 온 밸런스 4건 · 다음: 마감 |
| 2026-10-12 | 마감 | boot.png · 정지 화면 4장(봇 균열 18 · 정예 속성 12 · 균열석 · 균열 완료) 확인 · README 확인 · status playable · RETRO 추가 · 서버 · `_scratch` 정리 | 다음: Jay의 한 판 → `/proto-feedback rift-hunter`(Jay가 정할 것 8건 — NOTES-REVIEW §6 · NOTES-BALANCE §6 · 가방 칸 수) |
| 2026-10-12 | 전달(오프라인) | Jay 요청 — `build:standalone` → `check:standalone` ok(file:// · 표식 3.3초) · standalone.png 확인 · file:// 균열 5 봇 판 정지 화면 확인(errors 0) · `release/rift-hunter.html` 1.4MB 전달 | 다음: Jay의 한 판 → `/proto-feedback rift-hunter` |
| 2026-10-12 | 피드백 1 | 전사 가르기(전방 180°) · 회전 베기(360° · 연속 회전) · 포션 가시성(이미 5개 지급) · 골드 더 자주 · 더 작게(기대값 불변) · 떨어지는 순간 이름표 · 3관점 재검증 통과 · build ok · test 690 pass · check:dist ok · 단일 HTML ok(재전달) | run `wf_2957f9a3-93e` · NOTES-FEEDBACK.md · Jay가 정할 것 3(정타 2~3번의 장비 기준 · 분쇄자 조건 · 균열 1 「1 골드」) + 이어 온 8 |
