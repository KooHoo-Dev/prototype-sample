---
name: proto-new
description: 새 프로토타입 제작 — Jay의 요청을 브리프로 바꾸고 저장 워크플로(proto-design → proto-build → proto-review)로 설계 · 병렬 구현 · 리뷰까지 돌려 플레이 가능한 프로토타입을 낸다. 에이전트 약 30개 규모라 Jay가 /proto-new 로 열 때만 쓴다.
disable-model-invocation: true
argument-hint: [만들 게임 — 장르 · 시점 · 핵심 루프 · 참고작. 한두 문장이면 된다]
---

# 새 프로토타입 제작

요청: **$ARGUMENTS**

너는 이 세션의 **오케스트레이터**다. Jay가 이 스킬을 연 것은 Workflow 도구로 저장 워크플로 `proto-design` · `proto-build` · `proto-review`를 차례로 실행하라는 지시다(웨이브 하나에 에이전트 최대 11개).

1. `docs/PIPELINE.md`를 처음부터 끝까지 읽는다 — 절차의 정본이다. `docs/QUALITY.md` · `docs/BRIEF-TEMPLATE.md` · `prototypes.json`도 읽는다.
2. `workflow-authoring` 스킬을 읽는다(저장 워크플로의 `name` · `args` · 재개 규칙).
3. PIPELINE §1(접수) → §2(설계) → §3(구현 — 웨이브마다) → §4(리뷰) → §5(마감)를 순서대로 한다. 단계가 끝날 때마다 `<dir>/docs/STATUS.md`에 한 줄을 더하고, 워크플로 사이의 「끝나면 오케스트레이터가」 목록을 건너뛰지 않는다.
4. 요청이 비어 있으면 무엇을 만들지 한 번 묻는다. 그 밖에는 PIPELINE §1의 「묻는 것」에 해당할 때만 묻는다 — 브리프 요약을 보여 준 뒤에는 기다리지 않는다.
5. 워크플로가 끊기면 PIPELINE §6으로 이어 간다. 세션을 넘겨야 하면 `STATUS.md`에 다음 할 일을 적고 `/proto-resume <slug>`를 안내한다.
