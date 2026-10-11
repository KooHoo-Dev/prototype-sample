// OWNER: P9 — 계약 §11.6
// STUB — W2 에서 P9 가 채운다(localStorage · 키 SAVE_KEYS · 백업 · 시점 · 깨진 세이브). P9 내부 파일

/** STUB */
export function createStorage(deps = {}) {
  return {
    available() { return false; },
    loadSettings() { return {}; },
    writeSettings(s) { return false; },
    loadAccount() { return null; },
    writeAccount(state) { return false; },
    loadChar(slot) { return null; },
    writeChar(char) { return false; },
    backup(key) {},
    removeChar(slot) {},
  };
}
