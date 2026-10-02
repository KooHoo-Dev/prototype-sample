// OWNER: P0 — 계약 §6.2 · §8.3 (W0 완성 · 이후 고치지 않는다 — 결함은 NOTES-P#)
// 스테이지 소품 빌더 레지스트리 — WorldLayer 가 부팅 때 씬마다 한 번 부른다(§9.4).

import { buildHomeProps } from './homeProps.js';
import { buildLakeProps } from './lakeProps.js';
import { buildCoastProps } from './coastProps.js';
import { buildRiverProps } from './riverProps.js';

export const STAGE_PROPS = { home: buildHomeProps, lake: buildLakeProps, coast: buildCoastProps, river: buildRiverProps };
