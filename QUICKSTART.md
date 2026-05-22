# Quickstart (3 Minutes)

Use this if you want the fastest end-to-end verification.

## 0) Setup from zero (clone + tools + env)

1. Clone and enter repo:

```bash
git clone git@github.com:fiallodominguezernesto/Somnia-TruthMarket.git
cd Somnia-TruthMarket
```

2. Prepare tooling in WSL Ubuntu:

```bash
sudo apt update
sudo apt install -y git curl build-essential python3
export NVM_DIR="$HOME/.nvm"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash; fi
source ~/.nvm/nvm.sh
nvm install --lts
nvm use --lts
node --version
npm --version
```

3. Install dependencies:

```bash
npm install
```

4. Create environment file:

```bash
cp .env.example .env
```

5. Set minimum values in `.env`:

- `PRIVATE_KEY=0x...`
- `SOMNIA_RPC_URL=https://api.infra.testnet.somnia.network`
- `LLM_AGENT_ID=<real LLM Inference agent ID>`

6. Fund wallet with testnet STT:

- `https://testnet.somnia.network/faucet`

Optional pre-check (no deployment):

```bash
npm run sim-platform
```

## 1) Path A (Recommended): Autonomous Keeper Flow

```bash
PROJECT_ROOT=/path/to/your/somnia-repo
cd "$PROJECT_ROOT"
source ~/.nvm/nvm.sh
nvm use --lts
npm run build
npm run sim-platform
npm run deploy
npm run create-market
npm run place-bet
npm run keeper
```

Then, in a second terminal:

```bash
PROJECT_ROOT=/path/to/your/somnia-repo
cd "$PROJECT_ROOT"
source ~/.nvm/nvm.sh
nvm use --lts
npm run claim
```

What to expect:
- `sim-platform` validates `LLM_AGENT_ID` before deploy.
- Deploy prints new contract address.
- Create writes market ids to `scripts/markets.json`.
- Create includes resolver bounty fee (`0.02 STT` default).
- Keeper resolves expired markets autonomously.
- Claim returns payout/refund depending on outcome.

## 2) Path B: Manual Resolve Fallback

```bash
npm run resolve-market
npm run claim
```

## 3) Optional: Resolve Specific Market

```bash
MARKET_ID=1 npm run resolve-market
MARKET_ID=1 npm run claim
```

## 4) Optional: Diagnose UNKNOWN

```bash
RESOLVE_TX=0x... npm run diagnose
```

This prints payload selector, agent id, per-agent budget, and resolution events.

## 5) Fast UI Check

```bash
PROJECT_ROOT=/path/to/your/somnia-repo
cd "$PROJECT_ROOT/frontend"
python3 -m http.server 8080 --bind 0.0.0.0
```

Open `http://localhost:8080`, connect wallet, set contract address from `scripts/deployed.json`, then create -> bet -> resolve -> claim.

UI note: market creation includes bounty fee, and resolve sends deposit + top-up.
