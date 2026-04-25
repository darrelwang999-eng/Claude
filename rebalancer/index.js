'use strict';

require('dotenv').config();
const { POLL_MS } = require('./config');
const { fetchAllYields } = require('./lib/yields');
const { decide } = require('./lib/rebalance');
const { rotate } = require('./lib/executor');

// Start in the pool set by env, or null (monitor-only until first rebalance)
let currentPool = process.env.CURRENT_POOL ?? null;
const DRY_RUN   = process.env.DRY_RUN !== 'false'; // default: dry-run

function fmt(yields) {
  return Object.entries(yields)
    .sort(([, a], [, b]) => b - a)
    .map(([id, apy]) => `${id}=${(apy * 100).toFixed(2)}%`)
    .join('  ');
}

async function tick() {
  const ts = new Date().toISOString();
  let yields;
  try {
    yields = await fetchAllYields();
  } catch (err) {
    console.error(`[${ts}] yield fetch error:`, err.message);
    return;
  }

  console.log(`[${ts}] ${fmt(yields)}`);

  if (!currentPool) {
    // Pick best pool on first run
    const best = Object.entries(yields).sort(([, a], [, b]) => b - a)[0];
    if (best) {
      currentPool = best[0];
      console.log(`[${ts}] Initial pool set to ${currentPool}`);
    }
    return;
  }

  const decision = decide(yields, currentPool);
  console.log(`[${ts}] Decision: ${decision.action} — ${decision.reason}`);

  if (decision.action === 'hold') return;

  const from = decision.from ?? currentPool;
  const to   = decision.to;

  if (DRY_RUN) {
    console.log(`[${ts}] DRY RUN — would rotate ${from} → ${to}`);
    currentPool = to;
    return;
  }

  try {
    await rotate(from, to);
    currentPool = to;
    console.log(`[${ts}] ✓ Now in ${currentPool}`);
  } catch (err) {
    console.error(`[${ts}] Rotation failed:`, err.message);
  }
}

async function main() {
  console.log('=== Stablecoin Rebalancer ===');
  console.log(`  dry-run    : ${DRY_RUN}`);
  console.log(`  poll every : ${POLL_MS / 1000}s`);
  console.log(`  start pool : ${currentPool ?? '(auto-detect on first tick)'}`);
  console.log('');

  await tick();
  setInterval(tick, POLL_MS);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
