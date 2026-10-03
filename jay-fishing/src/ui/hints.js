// OWNER: P8 — 계약 §10.3(안내 문구) · 리뷰 수정(ui-app)
// 안내 카드의 순수 규칙: 지금 보일 만한 안내(우선순위 순) · 상황이 끝나 내려야 하는 안내. DOM 없음(Node 테스트 — ui.review.test).

import { BITE } from '../data/bite.js';
import { HOLD } from '../data/economy.js';
import { getSpot } from '../data/stages/index.js';

/** 파이팅 · 랜딩 단계 */
const FIGHT_PHASES = ['fighting', 'landing'];

/**
 * 지금 보일 만한 안내(우선순위 순) — 없으면 ''.
 * @param {any} s GameState @param {(id:string) => boolean} seen 이미 본 안내인가
 * @returns {string}
 */
export function hintCandidate(s, seen) {
  const fishing = s.player.mode === 'fish';
  const rig = s.rig;
  const ph = rig.phase;
  /** @param {string} id @param {boolean} cond */
  const ok = (id, cond) => cond && !seen(id);
  if (ok('net', !!s.fight && !!s.fight.canNet && ph === 'fighting')) return 'net';
  if (ok('fight', ph === 'fighting')) return 'fight';
  if (ok('bite', fishing && (ph === 'waiting' || ph === 'bite'))) return 'bite';
  if (ok('start', s.scene === 'home' && !fishing)) return 'start';
  if (ok('stage', s.scene !== 'home')) return 'stage';
  if (ok('controls', fishing)) return 'controls';
  // 강 첫 낚시(Jay 결정 2026-10-03 — NOTES-BALANCE 7절 #1 (c)): 흐름 하중이 고정 드랙을 넘는다
  if (ok('riverDrag', fishing && s.scene === 'river' && (ph === 'ready' || ph === 'charging' || ph === 'waiting'))) return 'riverDrag';
  if (ok('cast', fishing && (ph === 'ready' || ph === 'charging'))) return 'cast';
  if (ok('bottomRig', fishing && rig.set === 'bottom')) return 'bottomRig';
  if (fishing && rig.set === 'float' && !seen('drift') && s.player.spotId) {
    let flow = 0;
    try {
      const sp = getSpot(s.player.spotId);
      flow = Math.hypot(sp.flow.x, sp.flow.z);
    } catch (e) { void e; }
    if (flow >= BITE.driftMinFlow) return 'drift';
  }
  if (ok('holdFull', s.profile.hold.length >= HOLD.capacity)) return 'holdFull';
  return '';
}

/**
 * 보이던 안내의 상황이 끝났는가 — 끝났으면 남은 수명과 무관하게 내린다(패널에 가려진 동안에도 본다).
 * 씬에 묶인 안내(start · stage)는 씬이 바뀌면(W1 통합). 상황 안내는 그 단계를 벗어나면(리뷰 수정 — 뜰채 안내가 결과 패널 뒤
 * 다음 캐스팅 화면에 남은 수명만큼 다시 떴다): 뜰채는 파이팅 · 랜딩 밖, 파이팅은 파이팅 · 랜딩 · 실패 밖(실패 알림과 같이
 * 남아 왜 졌는지 읽힌다), 입질은 결과 단계. 낚시 안내는 낚시 모드를 벗어나면.
 * @param {string} id @param {any} s GameState @returns {boolean}
 */
export function hintStale(id, s) {
  const fishing = s.player.mode === 'fish';
  const ph = s.rig.phase;
  switch (id) {
    case 'start': return s.scene !== 'home';
    case 'stage': return s.scene === 'home';
    case 'net': return !fishing || !FIGHT_PHASES.includes(ph);
    case 'fight': return !fishing || !(FIGHT_PHASES.includes(ph) || ph === 'failed');
    case 'bite': return !fishing || ph === 'result';
    case 'controls':
    case 'cast':
    case 'bottomRig':
    case 'drift':
    case 'riverDrag': return !fishing;
    default: return false;
  }
}
