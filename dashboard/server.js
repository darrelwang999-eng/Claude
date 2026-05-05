'use strict';

require('dotenv').config({ path: '../rebalancer/.env' });
const express    = require('express');
const http       = require('http');
const { WebSocketServer } = require('ws');
const path       = require('path');
const { fetchAllYields }              = require('../rebalancer/lib/yields');
const { decide }                      = require('../rebalancer/lib/rebalance');
const { build402Payload, verifyPayment } = require('../seller-service/lib/x402');

const PORT      = parseInt(process.env.PORT ?? process.env.DASHBOARD_PORT ?? '8080');
const CAPITAL   = parseFloat(process.env.CAPITAL      ?? '10000');
const DEMO_MODE = process.env.DEMO_MODE !== 'false';
const POLL_MS   = parseInt(process.env.POLL_MS ?? String(DEMO_MODE ? 3_000 : 60_000));

// x402 signal payment config
const SIGNAL_NETWORK  = process.env.NETWORK       ?? 'eip155:196';
const SIGNAL_ASSET    = process.env.ASSET_ADDRESS  ?? '0x4ae46a509f6b1d9056937ba4500cb143933d2dc8';
const SIGNAL_PAY_TO   = process.env.PAY_TO_ADDRESS ?? '';
const SIGNAL_AMOUNT   = '100000'; // 0.1 USDG (6 decimals)

const POOL_META = {
  aave_base:     { label: 'Aave V3 · Base',    chain: 'Base',    gasCost: 0.25  },
  compound_base: { label: 'Compound · Base',   chain: 'Base',    gasCost: 0.25  },
  kamino_sol:    { label: 'Kamino · Solana',   chain: 'Solana',  gasCost: 0.001 },
  marginfi_sol:  { label: 'MarginFi · Solana', chain: 'Solana',  gasCost: 0.001 },
  save_sol:      { label: 'Save · Solana',     chain: 'Solana',  gasCost: 0.001 },
  xlayer_aave:   { label: 'Aave V3 · X Layer', chain: 'X Layer', gasCost: 0.05  },
};

// ── In-memory state ───────────────────────────────────────────────────────────

const startTime = Date.now();

const state = {
  ts:             new Date().toISOString(),
  demoMode:       DEMO_MODE,
  capital:        CAPITAL,
  balance:        CAPITAL,
  pnl:            0,
  pnlPct:         0,
  annualizedApy:  0,
  currentPool:    null,
  currentApy:     0,
  yields:         {},
  signal:         { action: 'hold', reason: 'Initializing...' },
  rotations:      [],   // last 50
  balanceHistory: [],   // last 720 ticks
  poolMeta:       POOL_META,
};

// Pre-seed balance history from backtest sim so chart isn't empty on cold start
function seedHistory() {
  const seed30 = (() => {
    // Deterministic walk matching backtest fallback data
    const s = (mean, vol, sd) => {
      let v = mean, s2 = sd;
      return Array.from({ length: 30 }, (_, i) => {
        s2 = (s2 * 16807) % 2147483647;
        const noise = ((s2 / 2147483647) - 0.5) * 2 * vol;
        v = Math.max(mean * 0.4, Math.min(mean * 2.2, v + noise));
        return parseFloat(v.toFixed(4));
      });
    };
    return {
      aave_base:     s(0.071, 0.005, 1002),
      compound_base: s(0.068, 0.005, 1004),
      kamino_sol:    s(0.089, 0.009, 2001),
      marginfi_sol:  s(0.076, 0.007, 2002),
      save_sol:      s(0.072, 0.006, 2003),
      xlayer_aave:   s(0.082, 0.010, 3001),
    };
  })();

  let bal = CAPITAL;
  const THRESHOLD = 0.005;
  let pool = 'kamino_sol';

  for (let i = 0; i < 30; i++) {
    const dayYields = Object.fromEntries(
      Object.entries(seed30).map(([k, arr]) => [k, arr[i]])
    );
    const best = Object.entries(dayYields).sort(([, a], [, b]) => b - a)[0];
    if (best[0] !== pool && best[1] - (dayYields[pool] ?? 0) >= THRESHOLD) {
      bal -= POOL_META[best[0]]?.gasCost ?? 0.25;
      pool = best[0];
    }
    bal += bal * (dayYields[pool] ?? 0) / 365;

    const d = new Date(Date.now() - (30 - i) * 86_400_000);
    state.balanceHistory.push({ ts: d.toISOString(), balance: parseFloat(bal.toFixed(4)), pool });
  }
  state.balance = bal;
  state.currentPool = pool;
  state.pnl    = bal - CAPITAL;
  state.pnlPct = state.pnl / CAPITAL * 100;
  state.annualizedApy = state.pnlPct * (365 / 30);
}

seedHistory();

// Yield cache — keeps last known values so a single failed fetch doesn't drop APY to 0
const yieldCache = {};

// Subscriber registry  { address → { registeredAt, signalsReceived, lastSignal } }
const subscribers = new Map();

function pushSignalToSubscribers() {
  if (subscribers.size === 0) return;
  const payload = {
    action:      state.signal.action,
    reason:      state.signal.reason,
    currentPool: state.currentPool,
    currentApy:  state.currentApy,
    yields:      state.yields,
    ts:          state.ts,
  };
  for (const [addr, sub] of subscribers) {
    sub.signalsReceived++;
    sub.lastSignal = payload;
    console.log(`[signal→wallet] ${addr.slice(0,8)}…  ${payload.action.toUpperCase()} @ ${(payload.currentApy*100).toFixed(2)}%`);
    // Production: call buyer webhook / onchainos wallet notification here
  }
}

// ── Express + WebSocket ───────────────────────────────────────────────────────

const app    = express();
app.use(express.json());
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, 'public')));

wss.on('connection', ws => {
  ws.send(JSON.stringify({ ...state, subscribers: subscribers.size }));
});

// ── Signal info (free) ────────────────────────────────────────────────────────
app.get('/api/signal-info', (_req, res) => {
  res.json({
    amount:       SIGNAL_AMOUNT,
    amountHuman:  '0.10',
    currency:     'USDG',
    network:      SIGNAL_NETWORK,
    payTo:        SIGNAL_PAY_TO || '(run seller setup first)',
    asset:        SIGNAL_ASSET,
    subscribers:  subscribers.size,
  });
});

// ── Paid signal endpoint (x402, 0.1 USDG) ────────────────────────────────────
app.get('/api/signal', async (req, res) => {
  const header = req.headers['payment-signature'] || req.headers['x-payment'];

  if (!header) {
    if (!SIGNAL_PAY_TO) return res.status(503).json({ error: 'PAY_TO_ADDRESS not configured' });
    const payload = build402Payload({
      network:           SIGNAL_NETWORK,
      amount:            SIGNAL_AMOUNT,
      payTo:             SIGNAL_PAY_TO,
      asset:             SIGNAL_ASSET,
      maxTimeoutSeconds: 300,
    });
    return res.status(402).send(Buffer.from(JSON.stringify(payload)).toString('base64'));
  }

  const result = await verifyPayment(header, {
    payTo:   SIGNAL_PAY_TO,
    asset:   SIGNAL_ASSET,
    amount:  SIGNAL_AMOUNT,
    network: SIGNAL_NETWORK,
  });

  if (!result.valid) {
    console.warn(`[signal] payment rejected: ${result.error}`);
    return res.status(402).json({ error: result.error });
  }

  // Register subscriber
  if (!subscribers.has(result.payer)) {
    subscribers.set(result.payer, { registeredAt: new Date().toISOString(), signalsReceived: 0, lastSignal: null });
    console.log(`[signal] new subscriber: ${result.payer}`);
    broadcast({ type: 'subscriber_joined', address: result.payer, total: subscribers.size });
  }
  const sub = subscribers.get(result.payer);
  sub.signalsReceived++;
  sub.lastSignal = state.signal;

  res.json({
    signal:      state.signal,
    currentPool: state.currentPool,
    currentApy:  state.currentApy,
    yields:      state.yields,
    ts:          state.ts,
    subscriber:  result.payer,
    message:     `Signal delivered. Wallet ${result.payer} registered for push notifications.`,
  });
});

function broadcast() {
  const msg = JSON.stringify({ ...state, subscribers: subscribers.size });
  for (const ws of wss.clients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

// ── Simulated yields (offline fallback) ───────────────────────────────────────

let _simSeed = { aave_base:1002, compound_base:1004, kamino_sol:2001, marginfi_sol:2002, save_sol:2003, xlayer_aave:3001 };
let _simVals = { aave_base:0.071, compound_base:0.068, kamino_sol:0.089, marginfi_sol:0.076, save_sol:0.072, xlayer_aave:0.082 };
const _simVol = { aave_base:0.005, compound_base:0.005, kamino_sol:0.009, marginfi_sol:0.007, save_sol:0.006, xlayer_aave:0.010 };
const _simMean= { aave_base:0.071, compound_base:0.068, kamino_sol:0.089, marginfi_sol:0.076, save_sol:0.072, xlayer_aave:0.082 };

function simulatedYields() {
  const out = {};
  for (const k of Object.keys(_simVals)) {
    _simSeed[k] = (_simSeed[k] * 16807) % 2147483647;
    const noise = ((_simSeed[k] / 2147483647) - 0.5) * 2 * _simVol[k];
    _simVals[k] = Math.max(_simMean[k] * 0.4, Math.min(_simMean[k] * 2.2, _simVals[k] + noise));
    out[k] = parseFloat(_simVals[k].toFixed(4));
  }
  return out;
}

// ── Polling tick ──────────────────────────────────────────────────────────────

async function tick() {
  let fresh;
  try {
    fresh = await fetchAllYields();
  } catch {
    fresh = {};
  }

  // Merge fresh data into cache; fall back to simulation for any missing pools
  const sim = simulatedYields();
  for (const k of Object.keys(sim)) {
    if (fresh[k] != null) yieldCache[k] = fresh[k];       // real data wins
    else if (yieldCache[k] == null) yieldCache[k] = sim[k]; // first-run seed
    // else: keep previous cached value — no drop to 0%
  }
  const yields = { ...yieldCache };

  const now     = new Date().toISOString();
  const signal  = decide(yields, state.currentPool);

  // Rotation
  if ((signal.action === 'rebalance' || signal.action === 'exit_susde') && signal.to) {
    const gas  = POOL_META[signal.to]?.gasCost ?? 0.25;
    const prev = state.balance;
    state.balance -= gas;
    state.rotations.unshift({
      ts:            now,
      from:          state.currentPool,
      to:            signal.to,
      reason:        signal.reason,
      balanceBefore: prev,
      balanceAfter:  state.balance,
      apyBefore:     yields[state.currentPool] ?? 0,
      apyAfter:      yields[signal.to] ?? 0,
      gas,
    });
    if (state.rotations.length > 50) state.rotations.pop();
    state.currentPool = signal.to;
    console.log(`[ROTATE] ${signal.from} → ${signal.to}  gas=$${gas}  reason: ${signal.reason}`);
  } else if (!state.currentPool) {
    state.currentPool = Object.entries(yields).sort(([, a], [, b]) => b - a)[0]?.[0];
  }

  // Accrue interest for this tick
  const currentApy   = yields[state.currentPool] ?? 0;
  const tickFraction = POLL_MS / (365 * 24 * 3600 * 1000);
  state.balance += state.balance * currentApy * tickFraction;

  // PnL
  const daysElapsed   = (Date.now() - startTime) / 86_400_000 + 30; // +30 seeded days
  state.pnl           = state.balance - CAPITAL;
  state.pnlPct        = state.pnl / CAPITAL * 100;
  state.annualizedApy = state.pnlPct * (365 / daysElapsed);

  // Balance history (keep 720 ticks)
  state.balanceHistory.push({ ts: now, balance: parseFloat(state.balance.toFixed(4)), pool: state.currentPool });
  if (state.balanceHistory.length > 720) state.balanceHistory.shift();

  state.ts         = now;
  state.yields     = yields;
  state.currentApy = currentApy;
  state.signal     = signal;

  broadcast();
  pushSignalToSubscribers();
  console.log(`[${now.slice(11, 19)}] pool=${state.currentPool} apy=${(currentApy * 100).toFixed(2)}% bal=$${state.balance.toFixed(2)} pnl=+$${state.pnl.toFixed(2)}`);
}

// ── Start ─────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`\nDashboard → http://localhost:${PORT}\n`);
  tick();
  setInterval(tick, POLL_MS);
});
