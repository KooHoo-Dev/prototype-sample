// OWNER: P0 — 계약 §8.3 · §2.2 (W0 완성 · 이후 고치지 않는다 — 결함은 NOTES-P#)
// 수호자 구현 레지스트리 — GUARDIANS 의 id → impl 모듈. monsters.js 만 이 파일을 import 한다.

import { impl as boneGiant } from './boneGiant.js';
import { impl as ashWitch } from './ashWitch.js';

export const GUARDIAN_IMPLS = Object.freeze({ boneGiant, ashWitch });
