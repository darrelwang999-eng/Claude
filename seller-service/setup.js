#!/usr/bin/env node
'use strict';

const { execSync, spawnSync } = require('child_process');
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const XLAYER_RPC = 'https://rpc.xlayer.tech';
const XLAYER_CHAIN_INDEX = '196';
const DEFAULT_ASSET = '0x4ae46a509f6b1d9056937ba4500cb143933d2dc8'; // USDG on X Layer

function runJson(cmd) {
  try {
    const out = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return JSON.parse(out);
  } catch {
    return null;
  }
}

async function queryTokenDomain(assetAddress) {
  const provider = new ethers.JsonRpcProvider(XLAYER_RPC);
  const abi = [
    'function name() view returns (string)',
    'function version() view returns (string)',
  ];
  const token = new ethers.Contract(assetAddress, abi, provider);
  const [name, version] = await Promise.allSettled([token.name(), token.version()]);
  return {
    name: name.status === 'fulfilled' ? name.value : 'USDG',
    version: version.status === 'fulfilled' ? version.value : '1',
  };
}

async function main() {
  console.log('=== OKX OnchainOS x402 Seller Setup ===\n');

  // Step 1: ensure onchainos is available
  try {
    execSync('onchainos --version', { stdio: 'pipe' });
  } catch {
    console.error('onchainos not found. Install from https://github.com/okx/onchainos-skills');
    process.exit(1);
  }

  // Step 2: login if needed
  let status = runJson('onchainos wallet status');
  if (!status?.data?.loggedIn) {
    console.log('Not logged in. Starting wallet login...\n');
    const result = spawnSync('onchainos', ['wallet', 'login'], { stdio: 'inherit' });
    if (result.status !== 0) {
      console.error('\nLogin failed. Run manually: onchainos wallet login');
      process.exit(1);
    }
    status = runJson('onchainos wallet status');
  }

  if (!status?.data?.loggedIn) {
    console.error('Login verification failed. Exiting.');
    process.exit(1);
  }

  console.log(`Logged in as: ${status.data.currentAccountName}`);

  // Step 3: get the seller's X Layer address
  const balanceResult = runJson(`onchainos wallet balance --chain ${XLAYER_CHAIN_INDEX}`);
  const sellerAddress = balanceResult?.data?.address ?? balanceResult?.data?.accounts?.[0]?.address;

  if (!sellerAddress) {
    console.error(
      '\nCould not determine your X Layer address. ' +
      'Make sure your wallet has an account on X Layer (chain 196).'
    );
    process.exit(1);
  }

  console.log(`Seller receive address: ${sellerAddress}`);

  // Step 4: query USDG contract for correct EIP-712 domain params
  process.stdout.write('Querying USDG token domain from X Layer... ');
  let domain = { name: 'USDG', version: '1' };
  try {
    domain = await queryTokenDomain(DEFAULT_ASSET);
    console.log(`OK (name="${domain.name}", version="${domain.version}")`);
  } catch {
    console.log(`skipped (using defaults: name="${domain.name}", version="${domain.version}")`);
  }

  // Step 5: write .env
  const envPath = path.join(__dirname, '.env');
  const lines = [
    `PAY_TO_ADDRESS=${sellerAddress}`,
    `ASSET_ADDRESS=${DEFAULT_ASSET}`,
    `PAYMENT_AMOUNT=1000000`,
    `NETWORK=eip155:196`,
    `MAX_TIMEOUT_SECONDS=300`,
    `TOKEN_DOMAIN_NAME=${domain.name}`,
    `TOKEN_DOMAIN_VERSION=${domain.version}`,
    `PORT=3000`,
  ];
  fs.writeFileSync(envPath, lines.join('\n') + '\n');

  console.log('\n.env written successfully:');
  lines.forEach(l => console.log('  ' + l));
  console.log('\nStart the seller service with:\n  npm start\n');
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
