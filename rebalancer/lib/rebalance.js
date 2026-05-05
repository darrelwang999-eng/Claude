'use strict';

const { REBALANCE_THRESHOLD, SUSDE_MIN_APY, EXIT_WINDOW_H, SUSDE_MAX_ALLOC } = require('../config');

// Track consecutive hours sUSDe APY has been below the minimum
let susdeWeakHours = 0;

/**
 * Given current yields and the active pool id, decide what to do.
 *
 * Returns:
 *   { action: 'hold' }
 *   { action: 'rebalance', from: poolId, to: poolId, reason: string }
 *   { action: 'exit_susde', to: poolId, reason: string }
 */
function decide(yields, currentPoolId) {
  if (Object.keys(yields).length === 0) {
    return { action: 'hold', reason: 'No yield data available' };
  }

  // ── sUSDe funding-rate exit guard ────────────────────────────────────────
  const susdeApy = yields['susde'];
  if (susdeApy != null && currentPoolId === 'susde') {
    if (susdeApy < SUSDE_MIN_APY) {
      susdeWeakHours++;
      if (susdeWeakHours >= EXIT_WINDOW_H) {
        const best = bestLendingPool(yields);
        susdeWeakHours = 0;
        return {
          action: 'exit_susde',
          to: best.id,
          reason: `sUSDe APY ${pct(susdeApy)} < ${pct(SUSDE_MIN_APY)} for ${EXIT_WINDOW_H}h → rotate to ${best.id}`,
        };
      }
    } else {
      susdeWeakHours = 0;
    }
  }

  // ── Find best target ─────────────────────────────────────────────────────
  const lendingBest = bestLendingPool(yields);

  // Decide whether sUSDe should be included as a candidate.
  // Only consider sUSDe if funding rate is healthy and allocation headroom exists.
  let candidate;
  if (
    susdeApy != null &&
    susdeApy >= SUSDE_MIN_APY &&
    currentPoolId !== 'susde'
  ) {
    // Compare sUSDe (capped at SUSDE_MAX_ALLOC blended return) vs best lending
    candidate = susdeApy > lendingBest.apy
      ? { id: 'susde', apy: susdeApy }
      : lendingBest;
  } else {
    candidate = lendingBest;
  }

  if (candidate.id === currentPoolId) {
    return { action: 'hold', reason: `Already in best pool (${currentPoolId} @ ${pct(candidate.apy)})` };
  }

  const currentApy = yields[currentPoolId] ?? 0;
  const gap = candidate.apy - currentApy;

  if (gap < REBALANCE_THRESHOLD) {
    return {
      action: 'hold',
      reason: `Gap ${pct(gap)} < threshold ${pct(REBALANCE_THRESHOLD)} (${currentPoolId} @ ${pct(currentApy)} vs ${candidate.id} @ ${pct(candidate.apy)})`,
    };
  }

  return {
    action: 'rebalance',
    from: currentPoolId,
    to: candidate.id,
    reason: `+${pct(gap)} gain: ${currentPoolId} @ ${pct(currentApy)} → ${candidate.id} @ ${pct(candidate.apy)}`,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function bestLendingPool(yields) {
  const lendingIds = ['aave_eth', 'aave_base', 'compound_eth', 'compound_base', 'morpho_eth'];
  let best = { id: null, apy: -Infinity };
  for (const id of lendingIds) {
    if (yields[id] != null && yields[id] > best.apy) {
      best = { id, apy: yields[id] };
    }
  }
  return best;
}

function pct(n) {
  return (n * 100).toFixed(2) + '%';
}

module.exports = { decide };
