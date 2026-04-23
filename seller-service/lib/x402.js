const { ethers } = require('ethers');

// In-memory nonce store to prevent replay attacks.
// Replace with a persistent store (Redis/DB) in production.
const usedNonces = new Set();

function build402Payload({ network, amount, payTo, asset, maxTimeoutSeconds = 300 }) {
  return {
    x402Version: 2,
    accepts: [
      {
        network,
        amount,
        payTo,
        asset,
        maxTimeoutSeconds,
      },
    ],
  };
}

async function verifyPayment(headerValue, { payTo, asset, amount, network }) {
  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(headerValue, 'base64').toString('utf8'));
  } catch {
    return { valid: false, error: 'Malformed payment header' };
  }

  const { payload } = decoded;
  if (!payload?.signature || !payload?.authorization) {
    return { valid: false, error: 'Missing signature or authorization' };
  }

  const { signature, authorization } = payload;
  const now = Math.floor(Date.now() / 1000);

  if (authorization.to.toLowerCase() !== payTo.toLowerCase()) {
    return { valid: false, error: 'Payment recipient mismatch' };
  }

  if (String(authorization.value) !== String(amount)) {
    return { valid: false, error: 'Payment amount mismatch' };
  }

  if (parseInt(authorization.validBefore) <= now) {
    return { valid: false, error: 'Payment authorization expired' };
  }

  if (parseInt(authorization.validAfter) > now) {
    return { valid: false, error: 'Payment authorization not yet valid' };
  }

  if (usedNonces.has(authorization.nonce)) {
    return { valid: false, error: 'Nonce already used (replay attack)' };
  }

  // Verify EIP-3009 signature off-chain
  const chainId = parseInt(network.split(':')[1]);
  const domain = {
    name: process.env.TOKEN_DOMAIN_NAME || 'USD Coin',
    version: process.env.TOKEN_DOMAIN_VERSION || '2',
    chainId,
    verifyingContract: asset,
  };

  const types = {
    TransferWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
    ],
  };

  const message = {
    from: authorization.from,
    to: authorization.to,
    value: BigInt(authorization.value),
    validAfter: BigInt(authorization.validAfter),
    validBefore: BigInt(authorization.validBefore),
    nonce: authorization.nonce,
  };

  let recoveredAddress;
  try {
    recoveredAddress = ethers.verifyTypedData(domain, types, message, signature);
  } catch (err) {
    return { valid: false, error: `Signature verification failed: ${err.message}` };
  }

  if (recoveredAddress.toLowerCase() !== authorization.from.toLowerCase()) {
    return { valid: false, error: 'Signer address mismatch' };
  }

  // Mark nonce as consumed to prevent replays
  usedNonces.add(authorization.nonce);

  return { valid: true, payer: authorization.from };
}

module.exports = { build402Payload, verifyPayment };
