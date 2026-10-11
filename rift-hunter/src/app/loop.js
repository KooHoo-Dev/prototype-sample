// OWNER: P9 — 계약 §5.12 · §11.3
// STUB — W2 에서 P9 가 채운다(고정 틱 누산기 · 스텝 상한 · 폭주 방지 · 히트스톱 · 렌더 보간 alpha). P9 내부 파일 — 이름 · 시그니처는 P9 재량

/** STUB @param {{step:(n:number) => void, render:(alpha:number, dtReal:number) => void}} hooks */
export function createLoop(hooks) {
  return { start() {}, stop() {}, get running() { return false; } };
}
