---
name: proto-resume
description: 끊긴 프로토타입 제작을 이어서 한다 — STATUS.md와 디스크 상태에서 다음 단계를 가려 저장 워크플로를 그 지점부터 다시 연다. Jay가 /proto-resume <slug> 로 연다.
disable-model-invocation: true
argument-hint: [slug — 비우면 status가 making인 것]
---

# 프로토타입 제작 재개

대상: **$ARGUMENTS**

너는 이 세션의 **오케스트레이터**다. Jay가 이 스킬을 연 것은 Workflow 도구로 저장 워크플로(`proto-design` · `proto-build` · `proto-review`)를 끊긴 지점부터 실행하라는 지시다.

1. `docs/PIPELINE.md`를 처음부터 끝까지 읽는다(재개는 §6). `workflow-authoring` 스킬도 읽는다.
2. `node tools/status.mjs <slug>`를 돌린다 — 인수가 비었으면 `node tools/status.mjs`에서 `making`인 것을 고르고, 둘 이상이면 어느 것인지 묻는다.
3. `<dir>/docs/STATUS.md`의 마지막 몇 줄과 도구가 낸 「다음 단계」를 대조한다. 어긋나면 `STATUS.md`의 기록이 정본이다.
4. 다음 단계를 한 줄로 알리고 **기다리지 않고** 그 단계부터 PIPELINE의 순서대로 진행한다. 같은 세션에서 끊긴 워크플로면 `resumeFromRunId`를 쓴다.
5. 다시 여는 단계의 산출물이 반쯤 쓰여 있을 수 있다 — 지우지 않는다. 워크플로가 현재 상태와 대조하고 남은 것만 한다.
