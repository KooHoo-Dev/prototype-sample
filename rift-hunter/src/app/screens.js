// OWNER: P9 — 계약 §11.3
// STUB — W2 에서 P9 가 채운다(boot → title ⇄ play · fatal · step 을 부르는 조건). P9 내부 파일

/** STUB */
export function createScreens(deps) {
  return { get current() { return 'boot'; }, go(to) {}, canStep() { return false; } };
}
