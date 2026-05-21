# Somnia TruthMarket

Autonomous micro prediction market MVP for Somnia Agentathon.

Somnia TruthMarket is a fully on-chain prediction workflow where users create factual YES/NO markets, fund positions with STT, and let the protocol finalize outcomes through Somnia's agent infrastructure. After each market reaches its deadline, the contract emits an asynchronous request to the LLM Inference agent and receives a callback that updates settlement state to `YES`, `NO`, or `UNKNOWN`.

The system is designed to run as an autonomous loop instead of a one-off manual script. Market resolution is permissionless and economically incentivized: each new market includes a resolver bounty, and any actor can trigger resolution once expiration is reached. A keeper agent (`scripts/keeper.ts`) continuously scans expired markets, submits resolve transactions, and captures the bounty while the contract handles final state transitions and payouts.

Core behavior implemented in this repository:

- Asynchronous agent invocation with verifiable on-chain callback handling
- Permissionless market resolution with built-in resolver incentives
- Deterministic payout logic for winners and explicit refund path for `UNKNOWN`
- Operational tooling for repeatable deploy/test flows and request diagnostics
- Browser UI plus script-based execution paths for reproducible demonstrations

## Start Here

- 3-minute path: `QUICKSTART.md`
- Full step-by-step guide in English and Spanish: `HOW_TO_USE.md`
- Recommended first test path: Scripts flow (`deploy -> create -> bet -> resolve -> claim`)

## Network and Agent Context

- Network: Somnia Testnet (Chain ID `50312`)
- RPC: `https://api.infra.testnet.somnia.network`
- Platform contract: `0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776`
- LLM Inference Agent ID: configured at deploy time via `LLM_AGENT_ID` in `.env`

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
- `scripts/keeper.ts` - autonomous resolver agent: scans for expired markets and resolves them, earning the bounty
- `scripts/claim.ts` - claim winnings or refunds
- `scripts/diagnose.ts` - decode payload + inspect request telemetry for a resolve tx
- `scripts/simPlatform.ts` - dry-run platform request simulation to validate `LLM_AGENT_ID`
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
- `LLM_AGENT_ID=...` — the real LLM Inference agent ID

Get the real `LLM_AGENT_ID` from the Agent Explorer: open `https://agents.testnet.somnia.network`, select the **LLM Inference** agent, open the **Solidity** tab, and copy the `agentId`. A placeholder/unregistered ID makes `resolveMarket` revert with no reason when it calls `platform.createRequest`. The contract reads this ID at deploy time (constructor arg), so set it before `npm run deploy`.

Verify an agent ID is valid before deploying (no funds spent):

```bash
LLM_AGENT_ID=<id> npm run sim-platform
```

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
- `npm run keeper` - run the autonomous resolver agent (continuous loop)
- `npm run claim` - claim payout/refund
- `npm run diagnose` - inspect resolve tx and decode request internals
- `npm run sim-platform` - dry-run `platform.createRequest` using your current `LLM_AGENT_ID`

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
- Quick mode default: creates 1 market with 60-second deadline
- Full mode: `FULL_DEMO=true npm run create-market` creates 3 factual markets
- IDs written to `scripts/markets.json`
- Each market is created with a bounty (default `0.02 STT`, override with `CREATION_FEE_STT`). The contract requires at least `MIN_CREATION_FEE` (`0.02 STT`). This bounty is paid to whoever resolves the market.

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

4b) Autonomous resolution via keeper (recommended for the demo)

Instead of resolving by hand, run the keeper agent. It scans every market, finds expired ones still `Open`, resolves them autonomously, and collects the bounty:

```bash
npm run keeper
```

Behavior:
- Scans on an interval (default `10s`, override with `KEEPER_SCAN_MS`)
- Sends `getRequestDeposit() + top-up` per resolution (`RESOLVE_TOPUP_STT`, default `1.2`)
- Skips markets already being resolved; rechecks if a callback is slow
- Runs continuously until stopped (`Ctrl+C`)

This is the main autonomous operating loop: create + bet, then start keeper and let markets settle without manual resolve calls.

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
- Create market (60s default, increase to 120-180s if you need more signing time)
- Place bet using the same market ID
- Optional manual resolve after deadline (UI sends deposit + `1.2 STT` top-up)
- Or run `npm run keeper` and watch autonomous settlement (UI supports auto-refresh)
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
