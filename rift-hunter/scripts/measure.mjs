// OWNER: P15 — 계약 §12.5 (npm run measure → docs/MEASURE.md)
// STUB — W2 에서 P15 가 채운다(두 클래스 × 전략 · 속성 탐침 · 빌드/장비 비교 · 드랍 표). W0: 「아직 없다」 한 줄을 쓰고 끝
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'docs', 'MEASURE.md');
writeFileSync(out, '<!-- OWNER: P15 — 계약 §12.5 · STUB -->\n# MEASURE — rift-hunter\n\n아직 측정 없음 — 봇과 측정 스크립트는 웨이브 2(P15)에서 채운다.\n');
console.log(`MEASURE stub — ${out}`);
