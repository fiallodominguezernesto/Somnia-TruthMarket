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

The three agent IDs are already pre-filled in `.env.example` (so you usually only add `PRIVATE_KEY`):

- `LLM_AGENT_ID=12847293847561029384` — LLM Inference (STATEMENT + WEB_FACT)
- `JSON_API_AGENT_ID=13174292974160097713` — JSON API Request (PRICE)
- `PARSE_AGENT_ID=12875401142070969085` — LLM Parse Website (WEB_FACT)

6. Fund wallet with testnet STT:

- `https://testnet.somnia.network/faucet`

Optional pre-check (no deployment):

```bash
npm run sim-platform
```

`sim-platform` works before deploy and does not require `scripts/deployed.json`.

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

## 3b) Try the Three Market Kinds

`create-market` selects the agent flow via `MARKET_KIND` (default `statement`):

```bash
# STATEMENT — LLM Inference judges a fact
QUESTION="2 + 2 equals 4." npm run create-market

# PRICE — JSON API Request fetches a number and compares it
#   COMPARATOR: 0 GT, 1 GTE, 2 LT, 3 LTE ; fetched value scaled by DECIMALS
MARKET_KIND=price \
QUESTION="Is BTC above 1000 USD?" \
API_URL="https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd" \
JSON_SELECTOR="bitcoin.usd" DECIMALS=0 TARGET=1000 COMPARATOR=0 \
npm run create-market

# WEB_FACT — LLM Parse Website extracts evidence, then chained LLM Inference judges it
MARKET_KIND=web_fact \
QUESTION="Did Satoshi Nakamoto create Bitcoin?" \
SOURCE_URL="https://en.wikipedia.org/wiki/Bitcoin" \
npm run create-market
```

Then bet/resolve/claim as usual. WEB_FACT resolution automatically sends `2*deposit + 2.4 STT` (vs `deposit + 1.2 STT` for the others) so both chained stages (Parse Website + LLM Inference) get a real ~1.2 STT topup each.

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

UI note: in **Create Market** pick the **Market Kind** (STATEMENT / PRICE / WEB_FACT) — extra fields appear for PRICE and WEB_FACT. Market creation includes the bounty fee, and resolve auto-detects the kind to size the top-up (`deposit + 1.2 STT` for STATEMENT/PRICE; `2*deposit + 2.4 STT` for WEB_FACT, split across its two chained stages). The **Market Snapshot** shows the PRICE condition or the WEB_FACT evidence extracted by the Parse Website agent.
