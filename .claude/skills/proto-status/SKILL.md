---
name: proto-status
description: 프로토타입 현황 — 목록 · 상태 · 포트 · 각 프로토타입의 마지막 진행 기록과 다음 단계를 본다. 읽기 전용. Jay가 /proto-status 로 연다.
disable-model-invocation: true
argument-hint: [비움 = 전체 표 | slug = 한 프로토타입 상세]
---

# 프로토타입 현황

인수: **$ARGUMENTS**

이 세션에서 너는 **관찰자**다. 아무것도 쓰지 않는다.

1. `node tools/status.mjs $ARGUMENTS`를 돌린다. **출력이 곧 보고다** — 표를 그대로 다 보여 주고, 아래만 뒤에 덧붙인다.
2. `making`인 프로토타입마다 `<dir>/docs/STATUS.md`의 마지막 줄과 도구의 「다음 단계」를 한 줄로 적는다. 둘이 어긋나면 `STATUS.md`가 정본이라고 말한다.
3. `playable`인 것 가운데 `docs/NOTES-REVIEW.md`에 「Jay가 정할 것」이 남아 있으면 그 제목만 나열한다.
4. Jay가 이어서 하자고 하면 `/proto-resume <slug>`, 고칠 것을 말하면 `/proto-feedback <slug> …`를 안내한다.
