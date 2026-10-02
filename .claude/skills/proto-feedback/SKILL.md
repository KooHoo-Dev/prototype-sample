---
name: proto-feedback
description: Jay가 프로토타입을 해 보고 준 피드백을 반영한다 — 항목으로 쪼개 재현 · 수정 · 게이트 재확인 뒤 기록한다. Jay가 /proto-feedback <slug> <피드백> 으로 연다.
disable-model-invocation: true
argument-hint: <slug> <해 본 느낌과 고칠 것 — 여러 개를 한 번에 적어도 된다>
---

# 플레이 피드백 반영

입력: **$ARGUMENTS**

첫 낱말이 slug, 나머지가 Jay의 피드백이다. slug가 없거나 `prototypes.json`에 없으면 어느 프로토타입인지 묻는다.

1. `docs/PIPELINE.md` §7과 `docs/QUALITY.md`를 읽는다. 그 프로토타입의 `README.md` · `docs/BRIEF.md` · `docs/NOTES-REVIEW.md` · `docs/NOTES-VISUAL.md` · `docs/NOTES-BALANCE.md`(「사람이 확인할 것」과 조정 손잡이) · `docs/NOTES-FEEDBACK.md`(앞선 라운드)를 읽는다.
2. PIPELINE §7을 순서대로 한다. 피드백이 실시간 감각(타이밍 · 속도 · 세기)에 관한 것이면 먼저 조정 손잡이에서 해당 상수를 찾는다.
3. 뜻이 둘로 읽히는 항목만 묻는다. 방향을 바꾸는 항목은 브리프의 바뀐 줄을 보여 주고 진행한다.
4. 끝나면 항목마다 한 줄로 보고한다: 한 것 · 하지 않은 것과 이유 · Jay가 다시 볼 것. 바로 해 볼 명령(`npm.cmd --prefix <dir> run dev`)을 붙인다.

서로 독립인 묶음이 셋 이상일 때만 Agent를 병렬로 쓴다(소유 파일을 나눠서). 저장 워크플로를 다시 돌려야 할 만큼 크면 멈추고 Jay에게 묻는다.
