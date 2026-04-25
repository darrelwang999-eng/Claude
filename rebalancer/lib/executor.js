'use strict';

const { ethers } = require('ethers');
const { RPC, POOLS } = require('../config');

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
];

const AAVE_POOL_ABI = [
  'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)',
  'function withdraw(address asset, uint256 amount, address to) returns (uint256)',
];

const ATOKEN_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
];

const COMET_ABI = [
  'function supply(address asset, uint256 amount)',
  'function withdraw(address asset, uint256 amount)',
  'function balanceOf(address owner) view returns (uint256)',
];

const SUSDE_ABI = [
  'function deposit(uint256 assets, address receiver) returns (uint256)',
  'function redeem(uint256 shares, address receiver, address owner) returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function convertToAssets(uint256 shares) view returns (uint256)',
];

const USDE_ADDRESS = '0x4c9EDD5852cd905f086C759E8383e09bff1E68B3';

// ── Wallet ────────────────────────────────────────────────────────────────────

function wallet(chain) {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error('PRIVATE_KEY not set in .env');
  return new ethers.Wallet(pk, new ethers.JsonRpcProvider(RPC[chain]));
}

// ── Withdraw from current pool ────────────────────────────────────────────────

async function withdrawAll(poolId) {
  const pool = POOLS[poolId];
  const signer = wallet(pool.chain);
  const address = signer.address;

  if (poolId.startsWith('aave')) {
    const aToken = new ethers.Contract(pool.aToken, ATOKEN_ABI, signer);
    const aavePool = new ethers.Contract(pool.pool, AAVE_POOL_ABI, signer);
    const balance = await aToken.balanceOf(address);
    if (balance === 0n) return 0n;
    const tx = await aavePool.withdraw(pool.asset, ethers.MaxUint256, address);
    await tx.wait();
    return balance;
  }

  if (poolId.startsWith('compound')) {
    const comet = new ethers.Contract(pool.comet, COMET_ABI, signer);
    const balance = await comet.balanceOf(address);
    if (balance === 0n) return 0n;
    const tx = await comet.withdraw(pool.asset, balance);
    await tx.wait();
    return balance;
  }

  if (poolId === 'susde') {
    const susde = new ethers.Contract(pool.susde, SUSDE_ABI, signer);
    const shares = await susde.balanceOf(address);
    if (shares === 0n) return 0n;
    const assets = await susde.convertToAssets(shares);
    const tx = await susde.redeem(shares, address, address);
    await tx.wait();
    return assets;
  }

  throw new Error(`withdrawAll: unknown pool ${poolId}`);
}

// ── Deposit into target pool ──────────────────────────────────────────────────

async function depositAll(poolId, amount) {
  if (amount === 0n) return;
  const pool = POOLS[poolId];
  const signer = wallet(pool.chain);
  const address = signer.address;
  const token = new ethers.Contract(pool.asset, ERC20_ABI, signer);

  if (poolId.startsWith('aave')) {
    await (await token.approve(pool.pool, amount)).wait();
    const aavePool = new ethers.Contract(pool.pool, AAVE_POOL_ABI, signer);
    await (await aavePool.supply(pool.asset, amount, address, 0)).wait();
    return;
  }

  if (poolId.startsWith('compound')) {
    await (await token.approve(pool.comet, amount)).wait();
    const comet = new ethers.Contract(pool.comet, COMET_ABI, signer);
    await (await comet.supply(pool.asset, amount)).wait();
    return;
  }

  if (poolId === 'susde') {
    // amount is USDC; for sUSDe we need USDe — note bridging/swap is out of scope,
    // so we expect the caller to have USDe ready and pass its contract address.
    const usde = new ethers.Contract(USDE_ADDRESS, ERC20_ABI, signer);
    const susde = new ethers.Contract(pool.susde, SUSDE_ABI, signer);
    const usdeBalance = await usde.balanceOf(address);
    if (usdeBalance === 0n) {
      console.warn('[executor] No USDe balance to deposit into sUSDe — skipping');
      return;
    }
    await (await usde.approve(pool.susde, usdeBalance)).wait();
    await (await susde.deposit(usdeBalance, address)).wait();
    return;
  }

  throw new Error(`depositAll: unknown pool ${poolId}`);
}

// ── Public: rotate from → to ─────────────────────────────────────────────────

async function rotate(fromId, toId) {
  console.log(`[executor] Withdrawing from ${fromId}...`);
  const amount = await withdrawAll(fromId);
  console.log(`[executor] Withdrawn: ${amount.toString()}`);

  console.log(`[executor] Depositing into ${toId}...`);
  await depositAll(toId, amount);
  console.log(`[executor] Rotation complete: ${fromId} → ${toId}`);
}

module.exports = { rotate, withdrawAll, depositAll };
