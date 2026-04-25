'use strict';

const fetch = require('node-fetch');

const TARGETS = [
  { id: 'aave_base',     project: 'aave-v3',     chain: 'Base',   symbol: 'USDC' },
  { id: 'compound_base', project: 'compound-v3',  chain: 'Base',   symbol: 'USDC' },
  { id: 'kamino_sol',    project: 'kamino',        chain: 'Solana', symbol: 'USDC' },
  { id: 'marginfi_sol',  project: 'marginfi',      chain: 'Solana', symbol: 'USDC' },
  { id: 'save_sol',      project: 'save',          chain: 'Solana', symbol: 'USDC' },
  { id: 'xlayer_aave',   project: 'aave-v3',       chain: 'XLayer', symbol: 'USDC' },
];

// Cache pool IDs after first lookup so we don't re-scan 5000 pools every tick
let _poolIds = null;

async function resolvePoolIds() {
  if (_poolIds) return _poolIds;
  const res  = await fetch('https://yields.llama.fi/pools', { timeout: 10000 });
  const data = (await res.json()).data;
  _poolIds = {};
  for (const t of TARGETS) {
    const match = data
      .filter(p =>
        p.project === t.project &&
        p.chain   === t.chain   &&
        p.symbol.toUpperCase().includes(t.symbol)
      )
      .sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0))[0];
    if (match) _poolIds[t.id] = match.pool;
  }
  return _poolIds;
}

async function fetchAllYields() {
  const ids = await resolvePoolIds();

  const results = await Promise.allSettled(
    Object.entries(ids).map(async ([id, poolId]) => {
      const res  = await fetch(`https://yields.llama.fi/chart/${poolId}`, { timeout: 8000 });
      const data = (await res.json()).data ?? [];
      const last = data.filter(d => d.apy != null).at(-1);
      if (!last) throw new Error('no data');
      return { id, apy: last.apy / 100 };
    })
  );

  const yields = {};
  for (const r of results) {
    if (r.status === 'fulfilled') {
      yields[r.value.id] = r.value.apy;
    } else {
      console.warn(`[yields] fetch failed: ${r.reason?.message ?? r.reason}`);
    }
  }
  return yields;
}

module.exports = { fetchAllYields };
