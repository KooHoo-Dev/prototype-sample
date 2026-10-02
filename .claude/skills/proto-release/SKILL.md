---
name: proto-release
description: 프로토타입을 전달 · 공개할 수 있게 준비한다 — 게이트 재확인, 배포 모양 부팅 검사, 공개 전 점검, 갤러리 미리보기(오프라인 파일은 달라고 할 때만). 배포와 공개 전환은 하지 않는다. Jay가 /proto-release <slug> 로 연다.
disable-model-invocation: true
argument-hint: <slug> [offline — 오프라인으로 건넬 HTML 한 장도 만든다]
---

# 전달 · 공개 준비

대상: **$ARGUMENTS**

1. `docs/PIPELINE.md` §8을 읽고 순서대로 한다. slug가 `prototypes.json`에 없으면 어느 프로토타입인지 묻는다.
2. 게이트는 전부 실제로 돌린다. 하나라도 실패하면 고치고 다시 돌린다 — 실패한 채로 공개 준비가 됐다고 하지 않는다.
3. `release/boot.png`를 직접 열어 본다(빈 화면 · 오류 문구가 아닌지).
4. 오프라인 파일(§8-5)은 인수에 `offline`이 있거나 Jay가 달라고 했을 때만 만든다.
5. 보고: 게이트 결과 · 공개 전 점검에서 걸린 것 · 올라갈 주소 · (만들었으면) 전달 파일의 경로와 크기 · 받는 쪽이 알아야 할 것(브라우저 · 조작 장치 · 저장 위치).
6. `prototypes.json`의 `public`을 바꾸지 않고, 커밋 · push · 배포 워크플로 실행을 하지 않는다 — Jay가 할 순서(PIPELINE §8-4)만 알려 준다.
