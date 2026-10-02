# STATUS — ashen-cycle

이 리포의 규칙이 생기기 전에 만든 첫 프로토타입이다. 아래는 그때의 제작 과정을 뒤에 옮겨 적은 것이다.

| 날짜 | 단계 | 결과 | 비고 |
|---|---|---|---|
| 2026-10-02 | 접수 | 브리프 작성 | Jay의 요청 한 문단에서 바로. 당시 폴더는 `Project-SAGA/AshenCycle` |
| 2026-10-02 | 설계 | 계약 확정(비평 70건 중 68건 반영) · 스캐폴드 빌드/테스트 통과 | 첫 실행이 개정 도중 끊겨 개정 → 스캐폴드부터 다시 돌렸다 |
| 2026-10-02 | 구현 W1 | P1~P8 병렬 → 통합 게이트 · 테스트 409 pass | `NOTES-W1.md` |
| 2026-10-02 | 구현 W2 | P9 app · P10 펜리르 · P11 니힐 → 밸런스 게이트 → 화면 패스 · 테스트 625 pass | 밸런스는 `NOTES-W3.md`(지금 기준의 `NOTES-BALANCE.md`) · `NOTES-VISUAL.md` |
| 2026-10-02 | 리뷰 | 지적 30건 중 29건 수정 · 1건은 Jay가 정할 것 · 테스트 676 pass | `NOTES-REVIEW.md` |
| 2026-10-02 | 마감 | 단일 HTML `release/AshenCycle.html` · `file://` 부팅 확인 | 실시간 재생 · 소리 · 포인터 락 · 게임패드는 「사람이 확인할 것」으로 남았다 |
| 2026-10-02 | 이사 | `prototype-sample/ashen-cycle`로 이동 · 새 위치에서 테스트 676 pass · 단일 HTML 빌드 통과 | 기준과 다른 점은 `prototypes.json`의 `notes` |
| 2026-10-02 | 정리 | 부팅 표식(`data-game-ready` · `data-game-error`)과 `check:dist` 추가 — 빌드 · `check:dist` · 테스트 676 pass | 게이트가 단일 HTML에서 하위 경로 http 부팅 검사로 바뀌었다. 갤러리에는 올리지 않는다(Jay) |
