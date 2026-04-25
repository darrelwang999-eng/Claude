'use strict';

// Rebalance only when yield gap exceeds this (absolute, e.g. 0.005 = 0.5%)
const REBALANCE_THRESHOLD = parseFloat(process.env.REBALANCE_THRESHOLD ?? '0.005');

// Funding-rate warning: exit sUSDe if APY stays below this for EXIT_WINDOW_H hours
const SUSDE_MIN_APY    = parseFloat(process.env.SUSDE_MIN_APY    ?? '0.03');
const EXIT_WINDOW_H    = parseInt(process.env.EXIT_WINDOW_H       ?? '48');

// Max allocation to sUSDe (0–1). Remaining goes to lending markets.
const SUSDE_MAX_ALLOC  = parseFloat(process.env.SUSDE_MAX_ALLOC  ?? '0.30');

// Poll interval in milliseconds
const POLL_MS          = parseInt(process.env.POLL_MS            ?? String(60 * 60 * 1000));

// ── Protocol pool definitions ────────────────────────────────────────────────

const USDC = {
  ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  base:     '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
};

const RPC = {
  ethereum: process.env.RPC_ETHEREUM ?? 'https://eth.llamarpc.com',
  base:     process.env.RPC_BASE     ?? 'https://mainnet.base.org',
};

const POOLS = {
  aave_eth: {
    id:       'aave_eth',
    label:    'Aave V3 (Ethereum)',
    chain:    'ethereum',
    asset:    USDC.ethereum,
    pool:     '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
    aToken:   '0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c',
  },
  aave_base: {
    id:       'aave_base',
    label:    'Aave V3 (Base)',
    chain:    'base',
    asset:    USDC.base,
    pool:     '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
    aToken:   '0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB',
  },
  compound_eth: {
    id:       'compound_eth',
    label:    'Compound V3 (Ethereum)',
    chain:    'ethereum',
    asset:    USDC.ethereum,
    comet:    '0xc3d688B66703497DAA19211EEdff47f25384cdc3',
  },
  compound_base: {
    id:       'compound_base',
    label:    'Compound V3 (Base)',
    chain:    'base',
    asset:    USDC.base,
    comet:    '0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf',
  },
  morpho_eth: {
    id:       'morpho_eth',
    label:    'Morpho (Ethereum)',
    chain:    'ethereum',
    asset:    USDC.ethereum,
  },
  susde: {
    id:       'susde',
    label:    'Ethena sUSDe',
    chain:    'ethereum',
    asset:    '0x9D39A5DE30e57443BfF2A8307A4256c8797A3497', // USDe
    susde:    '0x9D39A5DE30e57443BfF2A8307A4256c8797A3497',
  },
};

module.exports = { REBALANCE_THRESHOLD, SUSDE_MIN_APY, EXIT_WINDOW_H, SUSDE_MAX_ALLOC, POLL_MS, RPC, POOLS };
