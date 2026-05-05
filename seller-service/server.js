'use strict';

require('dotenv').config();
const express = require('express');
const { build402Payload, verifyPayment } = require('./lib/x402');

const {
  PORT = 3000,
  PAY_TO_ADDRESS,
  ASSET_ADDRESS,
  PAYMENT_AMOUNT = '1000000',
  NETWORK = 'eip155:196',
  MAX_TIMEOUT_SECONDS = '300',
  TOKEN_DOMAIN_NAME,
  TOKEN_DOMAIN_VERSION,
} = process.env;

if (!PAY_TO_ADDRESS || !ASSET_ADDRESS || !TOKEN_DOMAIN_NAME || !TOKEN_DOMAIN_VERSION) {
  console.error('Missing required env vars. Run: node setup.js');
  process.exit(1);
}

const app = express();
app.use(express.json());

const paymentConfig = {
  network: NETWORK,
  amount: PAYMENT_AMOUNT,
  payTo: PAY_TO_ADDRESS,
  asset: ASSET_ADDRESS,
  maxTimeoutSeconds: parseInt(MAX_TIMEOUT_SECONDS),
};

function send402(res) {
  const encoded = Buffer.from(JSON.stringify(build402Payload(paymentConfig))).toString('base64');
  res.status(402).send(encoded);
}

async function requirePayment(req, res, next) {
  const header = req.headers['payment-signature'] || req.headers['x-payment'];
  if (!header) return send402(res);

  const result = await verifyPayment(header, {
    payTo: PAY_TO_ADDRESS,
    asset: ASSET_ADDRESS,
    amount: PAYMENT_AMOUNT,
    network: NETWORK,
  });

  if (!result.valid) {
    console.warn(`[x402] rejected: ${result.error}`);
    return res.status(402).json({ error: result.error });
  }

  req.payer = result.payer;
  next();
}

// ── Protected routes ──────────────────────────────────────────────────────────

app.get('/api/data', requirePayment, (req, res) => {
  res.json({
    payer: req.payer,
    data: { content: 'Paid content delivered.', timestamp: new Date().toISOString() },
  });
});

// ── Health check (free) ───────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', network: NETWORK, asset: ASSET_ADDRESS, payTo: PAY_TO_ADDRESS });
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[x402] OKX OnchainOS seller service on :${PORT}`);
  console.log(`  network : ${NETWORK}`);
  console.log(`  asset   : ${ASSET_ADDRESS}  (${TOKEN_DOMAIN_NAME} v${TOKEN_DOMAIN_VERSION})`);
  console.log(`  pay to  : ${PAY_TO_ADDRESS}`);
  console.log(`  amount  : ${PAYMENT_AMOUNT} (minimal units)`);
});
