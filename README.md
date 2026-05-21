# Somnia TruthMarket

Autonomous micro prediction market MVP for Somnia Agentathon.

Users create YES/NO factual markets, place STT bets, and resolve outcomes through Somnia Agents. After deadline, the contract requests LLM inference asynchronously and settles funds on-chain as YES, NO, or UNKNOWN.

## Network and Agent Context

- Network: Somnia Testnet (Chain ID `50312`)
- RPC: `https://api.infra.testnet.somnia.network`
- Platform contract: `0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776`
- LLM Inference Agent ID: `12847293847561029384`

## Tech Stack

- Solidity `^0.8.20` (`viaIR: true`)
- Hardhat + Viem + TypeScript
- Optional Foundry (`forge`, `cast`) for extra tooling

## Project Structure

- `contracts/TruthMarket.sol` - core market logic and Somnia callback handler
- `contracts/interfaces/IAgentRequester.sol` - Somnia platform interface
- `scripts/deploy.ts` - deploy contract
- `scripts/createMarket.ts` - create demo markets
- `scripts/placeBet.ts` - place demo bets
- `scripts/resolveMarket.ts` - request LLM resolution and poll events
- `scripts/claim.ts` - claim payouts/refunds
- `frontend/index.html` - minimal browser demo UI
- `frontend/app.js` - viem-based frontend logic

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

## End-to-End Flow

1) Deploy contract

```bash
npm run deploy
```

2) Create market(s) (20-second deadline)

```bash
npm run create-market
```

Quick mode creates one market for faster demos.
Default quick market question is deterministic: `2 + 2 equals 4.`
Use full market set if needed:

```bash
FULL_DEMO=true npm run create-market
```

3) Place demo bets

```bash
npm run place-bet
```

Quick mode places one bet on market #1 for short deadlines.
Use full 6-bet distribution demo if needed:

```bash
FULL_DEMO=true npm run place-bet
```

4) Resolve with LLM (waits for deadline if needed)

```bash
npm run resolve-market
```

By default, resolve sends `getRequestDeposit() + 0.15 STT` to improve success rate for agent execution.
Override with:

```bash
RESOLVE_TOPUP_STT=0.12 npm run resolve-market
```

Optional specific market:

```bash
MARKET_ID=2 npm run resolve-market
```

5) Claim winnings/refunds

```bash
npm run claim
```

Optional specific market:

```bash
MARKET_ID=2 npm run claim
```

## Frontend Demo

Serve frontend locally:

```bash
cd frontend
python3 -m http.server 8080
```

Open:

- `http://localhost:8080`

Then:

1) Connect wallet
2) Set deployed contract address
3) Create market, bet, resolve, and claim from UI

## Notes for Demo Video

- Use clear factual statements with deterministic answers:
  - `Bitcoin's genesis block was mined on January 3, 2009.`
  - `Ethereum's Merge occurred in September 2022.`
  - `Vitalik Buterin created Bitcoin.`
- Show asynchronous flow: contract -> Somnia Agent -> callback -> settlement
- Mention `UNKNOWN` path and refund behavior

## Optional Foundry Build

```bash
~/.foundry/bin/forge build
```
