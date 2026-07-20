# Changelog

## Agent Wallet v3 — 2026-07-20

Building on v2's performance win (~5x faster CLI startup), v3 focuses on smoother
onboarding and fewer failed transactions.

### Onboarding improvements

- One unified `mm login browser` path (Google or email).
- Server wallets are auto-rehydrated on login, so returning users skip `mm init` —
  leading to a 5x faster dashboard login.

### Cross-chain swaps

- New `--refuel` flag tops up destination-chain gas on bridge transactions.

### Perps & swaps

- Deposit preflight checks.
- HIP-3 withdraw/query fixes.
- 2FA and swap fixes.

### Bug fixes

- Lots of bug fixes!

### Breaking changes

- `mm login google` and `mm login email` are no longer valid — use
  `mm login browser` instead.

---

## Agent Wallet v2

- ~5x faster CLI startup.
