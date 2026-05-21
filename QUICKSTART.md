# Quickstart (3 Minutes)

Use this if you want the fastest end-to-end verification.

## 0) Prerequisites

- Run in WSL Ubuntu
- `.env` exists with `PRIVATE_KEY`
- Wallet funded with testnet STT

## 1) One-pass Script Flow

```bash
cd /home/ernesto/somnia
source ~/.nvm/nvm.sh
nvm use --lts
npm run build
npm run deploy
npm run create-market
npm run place-bet
npm run keeper
npm run claim
```

What to expect:
- Deploy prints new contract address.
- Create writes market ids to `scripts/markets.json`.
- Create includes resolver bounty fee (`0.02 STT` default).
- Keeper resolves expired markets autonomously.
- Claim returns payout/refund depending on outcome.

Manual resolve alternative:

```bash
npm run resolve-market
```

## 2) Optional: Resolve Specific Market

```bash
MARKET_ID=1 npm run resolve-market
MARKET_ID=1 npm run claim
```

## 3) Optional: Diagnose UNKNOWN

```bash
RESOLVE_TX=0x... npm run diagnose
```

This prints payload selector, agent id, per-agent budget, and resolution events.

## 4) Fast UI Check

```bash
cd /home/ernesto/somnia/frontend
python3 -m http.server 8080 --bind 0.0.0.0
```

Open `http://localhost:8080`, connect wallet, set contract address from `scripts/deployed.json`, then create -> bet -> resolve -> claim.

UI note: market creation includes bounty fee, and resolve sends deposit + top-up.
