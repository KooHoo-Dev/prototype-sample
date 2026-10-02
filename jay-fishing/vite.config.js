// OWNER: P0 — 계약 §1.3 (템플릿 · port 5300)
import { defineConfig } from 'vite';

// port 는 리포 루트 prototypes.json 의 이 프로토타입 항목과 같다(dev · preview 공용).
// base './' 는 하위 경로 배포(갤러리 — scripts/check-dist.mjs 가 본다)를, 에셋 인라인은 선택 명령인 단일 HTML(scripts/make-standalone.mjs)을 위한 것이다.
export default defineConfig({
  base: './',
  server: { port: 5300, strictPort: true },
  preview: { port: 5300, strictPort: true },
  build: {
    target: 'es2022',
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    chunkSizeWarningLimit: 2000,
  },
});
