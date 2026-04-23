require('dotenv').config();
const express = require('express');
const { build402Payload, verifyPayment } = require('./lib/x402');

const app = express();
app.use(express.json());

const {
  PORT = 3000,
  PAY_TO_ADDRESS,
  ASSET_ADDRESS,
  PAYMENT_AMOUNT = '1000000',   // 1 USDG (6 decimals)
  NETWORK = 'eip155:196',       // X Layer mainnet
  MAX_TIMEOUT_SECONDS = '300',
} = process.env;

if (!PAY_TO_ADDRESS || !ASSET_ADDRESS) {
  console.error('ERROR: PAY_TO_ADDRESS and ASSET_ADDRESS must be set in .env');
  process.exit(1);
}

const paymentConfig = {
  network: NETWORK,
  amount: PAYMENT_AMOUNT,
  payTo: PAY_TO_ADDRESS,
  asset: ASSET_ADDRESS,
  maxTimeoutSeconds: parseInt(MAX_TIMEOUT_SECONDS),
};

function send402(res) {
  const payload = build402Payload(paymentConfig);
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
  res.status(402).send(encoded);
}

async function requirePayment(req, res, next) {
  const paymentHeader =
    req.headers['payment-signature'] || req.headers['x-payment'];

  if (!paymentHeader) {
    return send402(res);
  }

  const result = await verifyPayment(paymentHeader, {
    payTo: PAY_TO_ADDRESS,
    asset: ASSET_ADDRESS,
    amount: PAYMENT_AMOUNT,
    network: NETWORK,
  });

  if (!result.valid) {
    console.warn(`Payment rejected: ${result.error}`);
    return res.status(402).json({ error: result.error });
  }

  req.payer = result.payer;
  next();
}

// ── Protected routes ──────────────────────────────────────────────────────────

app.get('/api/data', requirePayment, (req, res) => {
  res.json({
    message: 'Payment verified. Welcome!',
    payer: req.payer,
    data: {
      content: 'This is your paid content.',
      timestamp: new Date().toISOString(),
    },
  });
});

// ── Health check (free) ───────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ status: 'ok', network: NETWORK, asset: ASSET_ADDRESS });
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Seller service listening on port ${PORT}`);
  console.log(`  Network : ${NETWORK}`);
  console.log(`  Pay to  : ${PAY_TO_ADDRESS}`);
  console.log(`  Asset   : ${ASSET_ADDRESS}`);
  console.log(`  Amount  : ${PAYMENT_AMOUNT} (minimal units)`);
});
