# Somnia TruthMarket

Autonomous micro prediction market MVP for Somnia Agentathon.

Users create YES/NO factual markets, place STT bets, and resolve outcomes through Somnia Agents. After deadline, the contract sends an asynchronous LLM request and settles on-chain as `YES`, `NO`, or `UNKNOWN`.

## Start Here

- Full step-by-step guide in English and Spanish: `HOW_TO_USE.md`
- Recommended first test path: Scripts flow (`deploy -> create -> bet -> resolve -> claim`)

## Network and Agent Context

- Network: Somnia Testnet (Chain ID `50312`)
- RPC: `https://api.infra.testnet.somnia.network`
- Platform contract: `0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776`
- LLM Inference Agent ID used by contract: `12847293847561029384`

## Tech Stack

- Solidity `^0.8.20` (`viaIR: true`)
- Hardhat + Viem + TypeScript
- Optional Foundry (`forge`, `cast`) for extra tooling

## Repository Layout

- `contracts/TruthMarket.sol` - core market logic and Somnia callback handler
- `contracts/interfaces/IAgentRequester.sol` - Somnia platform interfaces
- `scripts/deploy.ts` - deploy contract and write `scripts/deployed.json`
- `scripts/createMarket.ts` - create quick/full demo markets and write `scripts/markets.json`
- `scripts/placeBet.ts` - place quick/full demo bets
- `scripts/resolveMarket.ts` - resolve market via Somnia LLM and poll outcome events
- `scripts/claim.ts` - claim winnings or refunds
- `scripts/diagnose.ts` - decode payload + inspect request telemetry for a resolve tx
- `frontend/index.html` - minimal UI
- `frontend/app.js` - browser logic with viem CDN

## Prerequisites

Use WSL Ubuntu for all commands.

```bash
source ~/.nvm/nvm.sh
nvm use --lts
node --version
npm --version
~/.foundry/bin/forge --version
```

## Environment Setup

```bash
cp .env.example .env
```

Set at least:

- `PRIVATE_KEY=0x...`
- `SOMNIA_RPC_URL=https://api.infra.testnet.somnia.network`

Fund the wallet from faucet:

- `https://testnet.somnia.network/faucet`

## Build

```bash
npm run build
```

## NPM Commands

- `npm run build` - compile contracts
- `npm run deploy` - deploy `TruthMarket` to Somnia testnet
- `npm run create-market` - create market(s)
- `npm run place-bet` - place demo bets
- `npm run resolve-market` - send async LLM request and wait for resolution event
- `npm run claim` - claim payout/refund
- `npm run diagnose` - inspect resolve tx and decode request internals

## Script Flow (Detailed)

1) Deploy

```bash
npm run deploy
```

Expected:
- Deploy tx confirmed
- Contract address written to `scripts/deployed.json`

2) Create market(s)

```bash
npm run create-market
```

Behavior:
- Quick mode default: creates 1 market with 20-second deadline
- Full mode: `FULL_DEMO=true npm run create-market` creates 3 factual markets
- IDs written to `scripts/markets.json`

3) Place bets

```bash
npm run place-bet
```

Behavior:
- Quick mode default: one YES bet on first market
- Full mode: `FULL_DEMO=true npm run place-bet` places 6 mixed bets

4) Resolve

```bash
npm run resolve-market
```

Behavior:
- Waits if deadline not reached yet
- Sends `getRequestDeposit() + top-up`
- Default top-up: `1.2 STT`
- Override example: `RESOLVE_TOPUP_STT=0.6 npm run resolve-market`

Optional specific market:

```bash
MARKET_ID=2 npm run resolve-market
```

5) Claim

```bash
npm run claim
```

Optional specific market:

```bash
MARKET_ID=2 npm run claim
```

## UI Flow (Detailed)

Run frontend server:

```bash
cd frontend
python3 -m http.server 8080 --bind 0.0.0.0
```

Open in browser:

- `http://localhost:8080`

UI sequence:
- Connect wallet
- Paste deployed contract address from `scripts/deployed.json`
- Create market (20s is default, increase to 120-180s if you need more signing time)
- Place bet using the same market ID
- Resolve after deadline (UI also sends deposit + `1.2 STT` top-up)
- Claim using the same market ID after outcome is not `Open`

## Diagnosing UNKNOWN Outcomes

Use diagnose command with resolve tx hash:

```bash
RESOLVE_TX=0x... npm run diagnose
```

Useful overrides:

```bash
MARKET_ID=2 RESOLVE_TX=0x... npm run diagnose
```

What diagnose shows:
- `RequestCreated` telemetry from tx receipt
- sent `agentId`, `perAgentBudget`, payload selector and decoded inferString args
- contract events (`ResolutionText`, `MarketResolved`) after resolve block

## Common Issues

- `Expired` on bet: deadline passed before tx mined -> recreate market with longer deadline
- `Not expired` on resolve: wait a few seconds and retry
- market stays `Open`: resolve was called for another market ID -> resolve the correct ID
- `Nothing to claim`: no valid bet on that market for your account
- frequent `UNKNOWN`: increase resolve top-up (`RESOLVE_TOPUP_STT`)

## Optional Foundry Build

```bash
~/.foundry/bin/forge build
```
