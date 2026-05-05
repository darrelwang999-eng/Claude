'use strict';

require('dotenv').config();
const express = require('express');
const http    = require('http');
const { WebSocketServer } = require('ws');
const path    = require('path');
const { build402Payload, verifyPayment } = require('../seller-service/lib/x402');

const PORT      = parseInt(process.env.PORT ?? process.env.MARKET_PORT ?? '9090');
const NETWORK   = process.env.NETWORK       ?? 'eip155:196';
const ASSET     = process.env.ASSET_ADDRESS ?? '0x4ae46a509f6b1d9056937ba4500cb143933d2dc8';
const PAY_TO    = process.env.PAY_TO_ADDRESS ?? '';
const DEMO_MODE = process.env.DEMO_MODE !== 'false';

// ── Skill catalog ─────────────────────────────────────────────────────────────

const CATALOG = [
  {
    id:           'yieldflow-signal',
    name:         'YieldFlow Rebalancing Signal',
    category:     'trading-signal',
    categoryLabel:'Trading Signal',
    seller:       'YieldFlow Labs',
    description:  'Real-time stablecoin yield optimization signal across 6 DeFi pools on Base, Solana and X Layer. Achieve 7%+ APY with automated pool rotation.',
    price:        '100000',
    priceHuman:   '0.10',
    tags:         ['DeFi', 'stablecoin', 'yield', 'auto-rebalance'],
    rating:       4.9,
    callCount:    1247,
  },
  {
    id:           'defi-analytics',
    name:         'DeFi Pool Analytics Report',
    category:     'analytics',
    categoryLabel:'Data Analytics',
    seller:       'ChainData Pro',
    description:  'Comprehensive APY analysis and ranking across 20+ DeFi protocols. Includes 7d/30d trend, TVL, and risk-adjusted yield score.',
    price:        '500000',
    priceHuman:   '0.50',
    tags:         ['analytics', 'APY', 'multi-chain', 'TVL'],
    rating:       4.7,
    callCount:    834,
  },
  {
    id:           'whale-tracker',
    name:         'Whale Wallet Intelligence',
    category:     'intelligence',
    categoryLabel:'Market Intel',
    seller:       'AlphaHunt',
    description:  'Track top-100 whale DeFi positions and recent moves on Base and Solana. Includes entry/exit signals and PnL analysis.',
    price:        '200000',
    priceHuman:   '0.20',
    tags:         ['whale', 'alpha', 'wallet', 'smart-money'],
    rating:       4.6,
    callCount:    952,
  },
  {
    id:           'risk-score',
    name:         'Protocol Risk Scoring Engine',
    category:     'risk',
    categoryLabel:'Risk Analysis',
    seller:       'RiskShield',
    description:  'ML-based risk score (0–100) for any DeFi protocol. Covers audit status, TVL volatility, depeg history, and team transparency.',
    price:        '300000',
    priceHuman:   '0.30',
    tags:         ['risk', 'security', 'audit', 'ML'],
    rating:       4.8,
    callCount:    621,
  },
  {
    id:           'sentiment-feed',
    name:         'Crypto Sentiment Feed',
    category:     'intelligence',
    categoryLabel:'Market Intel',
    seller:       'SentimentAI',
    description:  'Aggregated sentiment score from 50+ sources: X, Telegram, Discord, Reddit. DeFi and stablecoin focus. Updated every 5 minutes.',
    price:        '150000',
    priceHuman:   '0.15',
    tags:         ['sentiment', 'NLP', 'social', 'alpha'],
    rating:       4.5,
    callCount:    2183,
  },
  {
    id:           'arb-scanner',
    name:         'Cross-Chain Arb Scanner',
    category:     'trading-signal',
    categoryLabel:'Trading Signal',
    seller:       'ArbBot Labs',
    description:  'Real-time arbitrage opportunities across Base, Solana, and X Layer. Configurable spread threshold. Includes gas-adjusted net profit estimates.',
    price:        '400000',
    priceHuman:   '0.40',
    tags:         ['arbitrage', 'cross-chain', 'MEV', 'alpha'],
    rating:       4.7,
    callCount:    718,
  },
];

// ── In-memory state ───────────────────────────────────────────────────────────

const txLog = [];   // max 100
let totalRevenue = 0;

// Seed realistic historical tx log
const FAKE_WALLETS = [
  '0x1a2b3c4d5e6f', '0xdeadbeef1234', '0xcafe0000babe',
  '0x9f8e7d6c5b4a', '0x0011223344ff',
];
(function seedTxLog() {
  const skills = [...CATALOG].sort(() => Math.random() - 0.5);
  for (let i = 0; i < 12; i++) {
    const skill  = skills[i % skills.length];
    const payer  = FAKE_WALLETS[i % FAKE_WALLETS.length];
    const minsAgo = (12 - i) * Math.floor(Math.random() * 8 + 4);
    txLog.push({
      id:          Date.now() - minsAgo * 60000 + i,
      ts:          new Date(Date.now() - minsAgo * 60000).toISOString(),
      payer:       payer + '…',
      skillId:     skill.id,
      skillName:   skill.name,
      priceHuman:  skill.priceHuman,
      category:    skill.categoryLabel,
      demo:        true,
    });
    totalRevenue += parseFloat(skill.priceHuman);
  }
})();

// ── Express + WebSocket ───────────────────────────────────────────────────────

const app    = express();
app.use(express.json());
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, 'public')));

wss.on('connection', ws => {
  ws.send(JSON.stringify({ type: 'init', txLog: txLog.slice(0, 20), stats: getStats() }));
});

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const ws of wss.clients) {
    if (ws.readyState === 1) ws.send(data);
  }
}

function getStats() {
  return {
    totalSkills:  CATALOG.length,
    totalCalls:   CATALOG.reduce((a, s) => a + s.callCount, 0),
    totalRevenue: parseFloat(totalRevenue.toFixed(2)),
    txCount:      txLog.length,
    demoMode:     DEMO_MODE,
  };
}

// ── Catalog (free) ────────────────────────────────────────────────────────────

app.get('/api/catalog', (_req, res) => {
  res.json({
    skills: CATALOG.map(enrichSkill),
    stats: getStats(),
    network: NETWORK,
    asset: ASSET,
  });
});

app.get('/api/catalog/:id', (req, res) => {
  const skill = CATALOG.find(s => s.id === req.params.id);
  if (!skill) return res.status(404).json({ error: 'Skill not found' });
  res.json(enrichSkill(skill));
});

function enrichSkill(s) {
  return {
    ...s,
    endpoint:       `/api/skills/${s.id}`,
    paymentNetwork: NETWORK,
    paymentAsset:   ASSET,
    payTo:          PAY_TO || '(configure PAY_TO_ADDRESS)',
  };
}

// ── x402 middleware ───────────────────────────────────────────────────────────

function requirePayment(skillId) {
  const skill = CATALOG.find(s => s.id === skillId);
  return async (req, res, next) => {
    const header = req.headers['payment-signature'] || req.headers['x-payment'];
    if (!header) {
      if (!PAY_TO) return res.status(503).json({ error: 'PAY_TO_ADDRESS not configured' });
      const payload = build402Payload({
        network: NETWORK, amount: skill.price,
        payTo: PAY_TO, asset: ASSET, maxTimeoutSeconds: 300,
      });
      return res.status(402).send(Buffer.from(JSON.stringify(payload)).toString('base64'));
    }
    const result = await verifyPayment(header, {
      payTo: PAY_TO, asset: ASSET, amount: skill.price, network: NETWORK,
    });
    if (!result.valid) {
      console.warn(`[x402] rejected ${skillId}: ${result.error}`);
      return res.status(402).json({ error: result.error });
    }
    req.payer = result.payer;
    next();
  };
}

function recordTx(payer, skillId) {
  const skill = CATALOG.find(s => s.id === skillId);
  skill.callCount++;
  totalRevenue += parseFloat(skill.priceHuman);
  const tx = {
    id: Date.now(), ts: new Date().toISOString(),
    payer: payer.slice(0, 14) + '…',
    skillId, skillName: skill.name,
    priceHuman: skill.priceHuman, category: skill.categoryLabel,
  };
  txLog.unshift(tx);
  if (txLog.length > 100) txLog.pop();
  broadcast({ type: 'tx', tx, stats: getStats() });
  console.log(`[SALE] ${skill.name}  ${skill.priceHuman} USDG  ← ${payer.slice(0, 10)}…`);
}

// ── Skill endpoints ────────────────────────────────────────────────────────────

const POOLS = {
  aave_base:     { label: 'Aave V3 · Base',    baseApy: 0.071 },
  compound_base: { label: 'Compound · Base',   baseApy: 0.068 },
  kamino_sol:    { label: 'Kamino · Solana',   baseApy: 0.089 },
  marginfi_sol:  { label: 'MarginFi · Solana', baseApy: 0.076 },
  save_sol:      { label: 'Save · Solana',     baseApy: 0.072 },
  xlayer_aave:   { label: 'Aave V3 · X Layer', baseApy: 0.082 },
};

app.get('/api/skills/yieldflow-signal', requirePayment('yieldflow-signal'), (req, res) => {
  const yields = {};
  for (const [k, v] of Object.entries(POOLS)) {
    yields[k] = +(v.baseApy + (Math.random() - 0.5) * 0.01).toFixed(4);
  }
  const [bestId, bestApy] = Object.entries(yields).sort(([, a], [, b]) => b - a)[0];
  recordTx(req.payer, 'yieldflow-signal');
  res.json({
    skill: 'yieldflow-signal', ts: new Date().toISOString(),
    action: 'rebalance', pool: bestId, poolLabel: POOLS[bestId].label, apy: bestApy,
    reason: `${POOLS[bestId].label} leads at ${(bestApy * 100).toFixed(2)}% APY`,
    yields, paidBy: req.payer,
  });
});

app.get('/api/skills/defi-analytics', requirePayment('defi-analytics'), (req, res) => {
  const protocols = Object.entries(POOLS).map(([id, p]) => ({
    id, label: p.label,
    apy7d:  +(p.baseApy + (Math.random() - 0.5) * 0.008).toFixed(4),
    apy30d: +(p.baseApy + (Math.random() - 0.5) * 0.005).toFixed(4),
    tvlM:   +(Math.random() * 400 + 50).toFixed(1),
    trend:  Math.random() > 0.5 ? 'up' : 'down',
  })).sort((a, b) => b.apy7d - a.apy7d);
  recordTx(req.payer, 'defi-analytics');
  res.json({
    skill: 'defi-analytics', ts: new Date().toISOString(), protocols,
    top: protocols[0].label, topApy: protocols[0].apy7d, paidBy: req.payer,
  });
});

app.get('/api/skills/whale-tracker', requirePayment('whale-tracker'), (req, res) => {
  const poolKeys = Object.keys(POOLS);
  const moves = ['0x3a4f', '0xb12c', '0x9e71', '0xd4a0', '0x55ff'].map(w => ({
    wallet:   w + Math.random().toString(16).slice(2, 8) + '…',
    action:   Math.random() > 0.5 ? 'deposit' : 'withdraw',
    protocol: POOLS[poolKeys[Math.floor(Math.random() * poolKeys.length)]].label,
    amountM:  +(Math.random() * 5 + 0.2).toFixed(2),
    asset:    'USDC',
    ts:       new Date(Date.now() - Math.random() * 3_600_000).toISOString(),
    pnlPct:   +((Math.random() - 0.3) * 15).toFixed(2),
  }));
  recordTx(req.payer, 'whale-tracker');
  res.json({ skill: 'whale-tracker', ts: new Date().toISOString(), moves, paidBy: req.payer });
});

app.get('/api/skills/risk-score', requirePayment('risk-score'), (req, res) => {
  const protocols = Object.entries(POOLS).map(([id, p]) => ({
    id, label: p.label,
    score:       Math.floor(Math.random() * 25 + 68),
    auditStatus: Math.random() > 0.15 ? 'audited' : 'partial',
    depegRisk:   Math.random() > 0.8 ? 'low' : 'very-low',
    verdict:     Math.random() > 0.25 ? 'safe' : 'caution',
  })).sort((a, b) => b.score - a.score);
  recordTx(req.payer, 'risk-score');
  res.json({ skill: 'risk-score', ts: new Date().toISOString(), protocols, paidBy: req.payer });
});

app.get('/api/skills/sentiment-feed', requirePayment('sentiment-feed'), (req, res) => {
  const overall = +(Math.random() * 35 + 50).toFixed(1);
  const label   = overall > 70 ? 'Greed' : overall > 55 ? 'Optimistic' : overall > 40 ? 'Neutral' : 'Fear';
  recordTx(req.payer, 'sentiment-feed');
  res.json({
    skill: 'sentiment-feed', ts: new Date().toISOString(),
    overall, label,
    defi:        +(overall + (Math.random() - 0.5) * 10).toFixed(1),
    stablecoin:  +(overall + (Math.random() - 0.5) * 8).toFixed(1),
    sources:     52, paidBy: req.payer,
  });
});

app.get('/api/skills/arb-scanner', requirePayment('arb-scanner'), (req, res) => {
  const chains = ['Base', 'Solana', 'X Layer'];
  const opps = Array.from({ length: 4 }, (_, i) => {
    const buy  = chains[Math.floor(Math.random() * 3)];
    const sell = chains.filter(c => c !== buy)[Math.floor(Math.random() * 2)];
    return {
      id:           'arb-' + i,
      asset:        'USDC',
      buyChain:     buy, sellChain: sell,
      spreadPct:    +(Math.random() * 0.5 + 0.05).toFixed(3),
      grossProfit:  +(Math.random() * 80 + 5).toFixed(2),
      gasCost:      +(Math.random() * 2 + 0.05).toFixed(3),
      netProfit:    +(Math.random() * 70 + 3).toFixed(2),
      expiresInSec: Math.floor(Math.random() * 30 + 5),
    };
  }).sort((a, b) => b.netProfit - a.netProfit);
  recordTx(req.payer, 'arb-scanner');
  res.json({ skill: 'arb-scanner', ts: new Date().toISOString(), opportunities: opps, paidBy: req.payer });
});

// ── Demo simulation ───────────────────────────────────────────────────────────

if (DEMO_MODE) {
  const DEMO_PAYERS = [
    '0xAgentAlpha001', '0xAgentBeta0042', '0xAgentGamma77',
    '0xAgentDelta999', '0xAgentEpsilon3',
  ];
  function simulateNextTx() {
    const skill  = CATALOG[Math.floor(Math.random() * CATALOG.length)];
    const payer  = DEMO_PAYERS[Math.floor(Math.random() * DEMO_PAYERS.length)];
    skill.callCount++;
    totalRevenue += parseFloat(skill.priceHuman);
    const tx = {
      id: Date.now(), ts: new Date().toISOString(),
      payer: payer + '…',
      skillId: skill.id, skillName: skill.name,
      priceHuman: skill.priceHuman, category: skill.categoryLabel,
      demo: true,
    };
    txLog.unshift(tx);
    if (txLog.length > 100) txLog.pop();
    broadcast({ type: 'tx', tx, stats: getStats() });
    setTimeout(simulateNextTx, Math.random() * 12000 + 8000);
  }
  setTimeout(simulateNextTx, 5000);
}

// ── Start ─────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`\nSkill Market  → http://localhost:${PORT}`);
  console.log(`Catalog API   → http://localhost:${PORT}/api/catalog`);
  console.log(`Demo mode     → ${DEMO_MODE}\n`);
});
