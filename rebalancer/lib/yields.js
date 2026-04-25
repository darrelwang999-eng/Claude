'use strict';

const { ethers } = require('ethers');
const fetch = require('node-fetch');
const { RPC, POOLS } = require('../config');

const SECONDS_PER_YEAR = 365 * 24 * 3600;
const RAY = 10n ** 27n;

// ── RPC providers (lazy) ─────────────────────────────────────────────────────

const _providers = {};
function provider(chain) {
  if (!_providers[chain]) _providers[chain] = new ethers.JsonRpcProvider(RPC[chain]);
  return _providers[chain];
}

// ── Aave V3 ──────────────────────────────────────────────────────────────────

const AAVE_POOL_ABI = [
  'function getReserveData(address asset) view returns (uint256,uint128,uint128,uint128,uint128,uint128,uint40,uint16,address,address,address,address,uint128,uint128,uint128)',
];

async function fetchAave(pool) {
  const contract = new ethers.Contract(pool.pool, AAVE_POOL_ABI, provider(pool.chain));
  const data = await contract.getReserveData(pool.asset);
  // data[2] = currentLiquidityRate in RAY (1e27)
  const liquidityRate = data[2];
  const apr = Number(liquidityRate) / Number(RAY);
  const apy = (1 + apr / SECONDS_PER_YEAR) ** SECONDS_PER_YEAR - 1;
  return apy;
}

// ── Compound V3 ──────────────────────────────────────────────────────────────

const COMET_ABI = [
  'function getSupplyRate(uint256 utilization) view returns (uint64)',
  'function getUtilization() view returns (uint64)',
];

async function fetchCompound(pool) {
  const comet = new ethers.Contract(pool.comet, COMET_ABI, provider(pool.chain));
  const utilization = await comet.getUtilization();
  const ratePerSec = await comet.getSupplyRate(utilization);
  // ratePerSec is scaled by 1e18
  const apr = Number(ratePerSec) / 1e18 * SECONDS_PER_YEAR;
  const apy = (1 + Number(ratePerSec) / 1e18) ** SECONDS_PER_YEAR - 1;
  return apy;
}

// ── Morpho (GraphQL API) ─────────────────────────────────────────────────────

async function fetchMorpho(pool) {
  const query = `{
    markets(where: { collateralAsset_in: [], loanAsset: "${pool.asset.toLowerCase()}" }, orderBy: supplyApy, orderDirection: desc, first: 1) {
      items { supplyApy }
    }
  }`;
  const res = await fetch('https://blue-api.morpho.org/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  const best = json?.data?.markets?.items?.[0];
  if (!best) return null;
  return best.supplyApy; // already in decimal (e.g. 0.072 = 7.2%)
}

// ── Ethena sUSDe ─────────────────────────────────────────────────────────────

async function fetchSusde() {
  const res = await fetch('https://ethena.fi/api/yields/protocol-and-staking-yield');
  const json = await res.json();
  // { stakingYield: "10.5" } or similar
  const raw = json?.stakingYield ?? json?.sUSDe?.apy ?? json?.apy;
  if (raw == null) return null;
  return parseFloat(raw) / 100;
}

// ── Public API ────────────────────────────────────────────────────────────────

async function fetchAllYields() {
  const results = await Promise.allSettled([
    fetchAave(POOLS.aave_eth).then(apy => ({ id: 'aave_eth',      apy })),
    fetchAave(POOLS.aave_base).then(apy => ({ id: 'aave_base',     apy })),
    fetchCompound(POOLS.compound_eth).then(apy => ({ id: 'compound_eth',  apy })),
    fetchCompound(POOLS.compound_base).then(apy => ({ id: 'compound_base', apy })),
    fetchMorpho(POOLS.morpho_eth).then(apy => ({ id: 'morpho_eth',   apy })),
    fetchSusde().then(apy => ({ id: 'susde',         apy })),
  ]);

  const yields = {};
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.apy != null) {
      yields[r.value.id] = r.value.apy;
    } else if (r.status === 'rejected') {
      console.warn(`[yields] fetch failed: ${r.reason?.message ?? r.reason}`);
    }
  }
  return yields; // { aave_eth: 0.065, compound_base: 0.071, ... }
}

module.exports = { fetchAllYields };
