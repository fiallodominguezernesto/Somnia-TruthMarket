# How to Use / Como usar

This guide explains how to run the project end-to-end using both scripts and UI.

Esta guia explica como ejecutar el proyecto end-to-end usando scripts y UI.

---

## English Guide

### 0) Clone repo and prepare environment

1. Clone and enter project:

```bash
git clone git@github.com:fiallodominguezernesto/Somnia-TruthMarket.git
cd Somnia-TruthMarket
```

2. Prepare base tools in WSL Ubuntu:

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

3. Install project dependencies:

```bash
npm install
```

4. Create `.env` from template:

```bash
cp .env.example .env
```

5. Set required variables in `.env`:

- `PRIVATE_KEY=0x...`
- `SOMNIA_RPC_URL=https://api.infra.testnet.somnia.network`

The three agent IDs come pre-filled in `.env.example`, so you normally only add `PRIVATE_KEY`:

- `LLM_AGENT_ID=12847293847561029384` — LLM Inference (STATEMENT + WEB_FACT)
- `JSON_API_AGENT_ID=13174292974160097713` — JSON API Request (PRICE)
- `PARSE_AGENT_ID=12875401142070969085` — LLM Parse Website (WEB_FACT)

6. Optional but recommended: install Foundry tools:

```bash
curl -L https://foundry.paradigm.xyz | bash
~/.foundry/bin/foundryup
~/.foundry/bin/forge --version
```

7. Validate environment before deploy:

```bash
npm run sim-platform
npm run build
```

### 1) Prerequisites

- Use WSL Ubuntu terminal.
- Have STT on your wallet from faucet.
- Ensure `.env` exists with:
  - `PRIVATE_KEY=0x...`
  - `SOMNIA_RPC_URL=https://api.infra.testnet.somnia.network`
  - `LLM_AGENT_ID`, `JSON_API_AGENT_ID`, `PARSE_AGENT_ID` (already pre-filled in `.env.example`)

The agent IDs ship pre-filled in `.env.example`. To confirm or replace one, open `https://agents.testnet.somnia.network` and read the `agentId` from the **Solidity** tab of the LLM Inference / JSON API Request / LLM Parse Website agent.

Optional validation before deploy:

```bash
npm run sim-platform
```

`sim-platform` works before deploy and does not require `scripts/deployed.json`.

Commands:

```bash
PROJECT_ROOT=/path/to/your/somnia-repo
cd "$PROJECT_ROOT"
source ~/.nvm/nvm.sh
nvm use --lts
npm run build
```

### 2) Full flow with scripts (recommended first run)

1. Deploy contract

```bash
npm run deploy
```

Expected output (minimum):
- `Deploying from: 0x...`
- `TruthMarket deployed at: 0x...`
- `Saved -> scripts/deployed.json`

2. Create market(s)

```bash
npm run create-market
```

- Quick mode default: creates 1 market with 60-second deadline.
- Full mode: `FULL_DEMO=true npm run create-market`.
- Market creation sends a bounty fee (default `0.02 STT`, override with `CREATION_FEE_STT`).

Pick the market kind (and its agent) with `MARKET_KIND` (default `statement`):

```bash
# STATEMENT — LLM Inference judges a fact
QUESTION="2 + 2 equals 4." npm run create-market

# PRICE — JSON API Request fetches a number and compares it to TARGET
#   COMPARATOR: 0 GT, 1 GTE, 2 LT, 3 LTE ; fetched value is scaled by DECIMALS
MARKET_KIND=price \
QUESTION="Is BTC above 1000 USD?" \
API_URL="https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd" \
JSON_SELECTOR="bitcoin.usd" DECIMALS=0 TARGET=1000 COMPARATOR=0 \
npm run create-market

# WEB_FACT — LLM Parse Website extracts evidence from a page,
#   then chained LLM Inference judges the question against it
MARKET_KIND=web_fact \
QUESTION="Did Satoshi Nakamoto create Bitcoin?" \
SOURCE_URL="https://en.wikipedia.org/wiki/Bitcoin" \
npm run create-market
```

Expected output (minimum):
- `Market #...`
- `Deadline: ... (+60s)`
- `Saved -> scripts/markets.json`

3. Place bets

```bash
npm run place-bet
```

- Quick mode default: one YES bet on first market.
- Full mode: `FULL_DEMO=true npm run place-bet`.

Expected output (minimum):
- `✅ Market #... -> ...`

4. Resolve market

```bash
npm run resolve-market
```

- Default resolve value is `getRequestDeposit() + 1.2 STT` (STATEMENT/PRICE), or `+ 2.0 STT` for WEB_FACT (it chains Parse Website -> LLM Inference and reserves the LLM budget on-chain).
- Optional: `RESOLVE_TOPUP_STT=0.8 npm run resolve-market`.
- Optional market: `MARKET_ID=2 npm run resolve-market`.
- For WEB_FACT the script prints the `EvidenceExtracted` event (the text the Parse Website agent returned) before the LLM verdict.

4b. Autonomous resolve with keeper (agent loop)

```bash
npm run keeper
```

- Keeper scans markets continuously, resolves expired `Open` markets, and collects bounty.
- It reads each market's kind on-chain and sizes the top-up automatically (`1.2 STT`, or `2.0 STT` for WEB_FACT).
- Optional scan interval: `KEEPER_SCAN_MS=5000 npm run keeper`.

Expected output (minimum):
- `TruthMarket keeper started`
- `Market #... expired. Resolving autonomously...`
- `resolveMarket tx 0x...`
- `Market #... settled -> YES/NO/UNKNOWN`

5. Claim payout/refund

```bash
npm run claim
```

- Optional market: `MARKET_ID=2 npm run claim`.

Expected output (minimum):
- `Outcome: ...`
- `✅ Claimed: ... STT`

### 3) Full flow with UI

1. Start frontend server:

```bash
PROJECT_ROOT=/path/to/your/somnia-repo
cd "$PROJECT_ROOT/frontend"
python3 -m http.server 8080 --bind 0.0.0.0
```

2. Open browser at `http://localhost:8080`.
3. Connect wallet.
4. Paste deployed address from `scripts/deployed.json` and click `Save Address`.
5. Create market.
   - Pick the **Market Kind**: STATEMENT (just the statement), PRICE (API URL, JSON selector, target, comparator, decimals — pre-filled with a CoinGecko BTC example), or WEB_FACT (a Source URL — pre-filled with the Bitcoin Wikipedia page).
   - Use `180` seconds if you need more signing time.
   - Creation includes bounty fee for resolver incentives.
6. Load market snapshot and note the market ID.
7. Place bet using that exact market ID.
8. After deadline passes, click `Resolve Manually (agent)`.
   - The UI auto-detects the kind and sends deposit + `1.2 STT` (or `2.0 STT` for WEB_FACT).
   - Or run `npm run keeper` in terminal and let it resolve autonomously.
9. Reload snapshot until outcome changes from `Open`. For WEB_FACT the snapshot also shows the evidence extracted by the Parse Website agent; for PRICE it shows the fetched condition.
10. Click `Claim Winnings` using the same market ID.

### 4) Diagnose if resolution is UNKNOWN

If you have a resolve tx hash, run:

```bash
RESOLVE_TX=0x... npm run diagnose
```

Optional:

```bash
MARKET_ID=2 RESOLVE_TX=0x... npm run diagnose
```

You will see request payload details, agent id, per-agent budget, and emitted resolution events.

### 5) Fast troubleshooting

- `Expired` on `placeBet`: market expired before tx mined. Recreate market with bigger deadline.
- `Not expired` on resolve: wait a few seconds and retry.
- Market stays `Open`: likely resolved another market ID. Resolve the correct one.
- `Nothing to claim`: no valid bet for your address on that market.
- Repeated `UNKNOWN`: increase top-up (`RESOLVE_TOPUP_STT`).

Decision flow:

```text
Bet failed?
  -> Expired: recreate market with longer deadline (120-180s)
  -> Not open: load correct market ID and check status

Market still Open after deadline?
  -> Is keeper running? if no, start it
  -> If yes, wait 1-2 scan cycles
  -> If still open, run diagnose with RESOLVE_TX

Claim failed?
  -> Check same market ID used for bet/resolve/claim
  -> If no user stake, claim will revert with Nothing to claim
```

---

## Guia en Espanol

### 0) Clonar repo y preparar entorno

1. Clona y entra al proyecto:

```bash
git clone git@github.com:fiallodominguezernesto/Somnia-TruthMarket.git
cd Somnia-TruthMarket
```

2. Prepara herramientas base en WSL Ubuntu:

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

3. Instala dependencias del proyecto:

```bash
npm install
```

4. Crea `.env` desde la plantilla:

```bash
cp .env.example .env
```

5. Configura variables requeridas en `.env`:

- `PRIVATE_KEY=0x...`
- `SOMNIA_RPC_URL=https://api.infra.testnet.somnia.network`

Los tres IDs de agente vienen pre-rellenados en `.env.example`, asi que normalmente solo agregas `PRIVATE_KEY`:

- `LLM_AGENT_ID=12847293847561029384` — LLM Inference (STATEMENT + WEB_FACT)
- `JSON_API_AGENT_ID=13174292974160097713` — JSON API Request (PRICE)
- `PARSE_AGENT_ID=12875401142070969085` — LLM Parse Website (WEB_FACT)

6. Opcional pero recomendado: instalar herramientas Foundry:

```bash
curl -L https://foundry.paradigm.xyz | bash
~/.foundry/bin/foundryup
~/.foundry/bin/forge --version
```

7. Valida el entorno antes del deploy:

```bash
npm run sim-platform
npm run build
```

### 1) Prerrequisitos

- Usa terminal WSL Ubuntu.
- Ten STT en tu wallet desde faucet.
- Asegura que exista `.env` con:
  - `PRIVATE_KEY=0x...`
  - `SOMNIA_RPC_URL=https://api.infra.testnet.somnia.network`
  - `LLM_AGENT_ID`, `JSON_API_AGENT_ID`, `PARSE_AGENT_ID` (ya pre-rellenados en `.env.example`)

Los IDs de agente vienen pre-rellenados en `.env.example`. Para confirmar o reemplazar uno, abre `https://agents.testnet.somnia.network` y lee el `agentId` en la pestaña **Solidity** del agente LLM Inference / JSON API Request / LLM Parse Website.

Validacion opcional antes de deploy:

```bash
npm run sim-platform
```

`sim-platform` funciona antes del deploy y no requiere `scripts/deployed.json`.

Comandos:

```bash
PROJECT_ROOT=/path/to/your/somnia-repo
cd "$PROJECT_ROOT"
source ~/.nvm/nvm.sh
nvm use --lts
npm run build
```

### 2) Flujo completo por scripts (recomendado primero)

1. Desplegar contrato

```bash
npm run deploy
```

Salida esperada (minima):
- `Deploying from: 0x...`
- `TruthMarket deployed at: 0x...`
- `Saved -> scripts/deployed.json`

2. Crear mercado(s)

```bash
npm run create-market
```

- Modo rapido por defecto: crea 1 mercado con deadline de 60 segundos.
- Modo completo: `FULL_DEMO=true npm run create-market`.
- La creacion envia fee de bounty (default `0.02 STT`, override `CREATION_FEE_STT`).

Elige el tipo de mercado (y su agente) con `MARKET_KIND` (default `statement`):

```bash
# STATEMENT — LLM Inference juzga un hecho
QUESTION="2 + 2 equals 4." npm run create-market

# PRICE — JSON API Request obtiene un numero y lo compara con TARGET
#   COMPARATOR: 0 GT, 1 GTE, 2 LT, 3 LTE ; el valor obtenido se escala por DECIMALS
MARKET_KIND=price \
QUESTION="Is BTC above 1000 USD?" \
API_URL="https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd" \
JSON_SELECTOR="bitcoin.usd" DECIMALS=0 TARGET=1000 COMPARATOR=0 \
npm run create-market

# WEB_FACT — LLM Parse Website extrae evidencia de una pagina,
#   y luego el LLM Inference encadenado juzga la pregunta contra ella
MARKET_KIND=web_fact \
QUESTION="Did Satoshi Nakamoto create Bitcoin?" \
SOURCE_URL="https://en.wikipedia.org/wiki/Bitcoin" \
npm run create-market
```

Salida esperada (minima):
- `Market #...`
- `Deadline: ... (+60s)`
- `Saved -> scripts/markets.json`

3. Apostar

```bash
npm run place-bet
```

- Modo rapido por defecto: una apuesta YES al primer mercado.
- Modo completo: `FULL_DEMO=true npm run place-bet`.

Salida esperada (minima):
- `✅ Market #... -> ...`

4. Resolver mercado

```bash
npm run resolve-market
```

- El valor por defecto es `getRequestDeposit() + 1.2 STT` (STATEMENT/PRICE), o `+ 2.0 STT` para WEB_FACT (encadena Parse Website -> LLM Inference y reserva el presupuesto del LLM on-chain).
- Opcional: `RESOLVE_TOPUP_STT=0.8 npm run resolve-market`.
- Mercado especifico: `MARKET_ID=2 npm run resolve-market`.
- Para WEB_FACT el script imprime el evento `EvidenceExtracted` (el texto que devolvio el agente Parse Website) antes del veredicto del LLM.

4b. Resolucion autonoma con keeper (bucle agente)

```bash
npm run keeper
```

- El keeper escanea mercados continuamente, resuelve los vencidos en `Open`, y cobra bounty.
- Lee el tipo de cada mercado on-chain y ajusta el top-up automaticamente (`1.2 STT`, o `2.0 STT` para WEB_FACT).
- Intervalo opcional: `KEEPER_SCAN_MS=5000 npm run keeper`.

Salida esperada (minima):
- `TruthMarket keeper started`
- `Market #... expired. Resolving autonomously...`
- `resolveMarket tx 0x...`
- `Market #... settled -> YES/NO/UNKNOWN`

5. Reclamar payout/reembolso

```bash
npm run claim
```

- Mercado especifico: `MARKET_ID=2 npm run claim`.

Salida esperada (minima):
- `Outcome: ...`
- `✅ Claimed: ... STT`

### 3) Flujo completo por UI

1. Levantar servidor frontend:

```bash
PROJECT_ROOT=/path/to/your/somnia-repo
cd "$PROJECT_ROOT/frontend"
python3 -m http.server 8080 --bind 0.0.0.0
```

2. Abre `http://localhost:8080` en navegador.
3. Conecta wallet.
4. Pega la direccion desplegada desde `scripts/deployed.json` y pulsa `Save Address`.
5. Crea mercado.
   - Elige el **Market Kind**: STATEMENT (solo el enunciado), PRICE (API URL, selector JSON, target, comparador, decimales — pre-rellenado con un ejemplo BTC de CoinGecko), o WEB_FACT (un Source URL — pre-rellenado con la pagina de Bitcoin en Wikipedia).
   - Usa `180` segundos si necesitas mas tiempo para firmar.
   - La creacion incluye fee bounty para incentivar al resolver.
6. Carga el snapshot y anota el market ID.
7. Apuesta usando ese mismo market ID.
8. Cuando pase el deadline, pulsa `Resolve Manually (agent)`.
   - La UI detecta el tipo y envia deposito + `1.2 STT` (o `2.0 STT` para WEB_FACT).
   - O ejecuta `npm run keeper` en terminal para resolucion autonoma.
9. Recarga snapshot hasta que outcome deje de ser `Open`. Para WEB_FACT el snapshot muestra ademas la evidencia extraida por el agente Parse Website; para PRICE muestra la condicion obtenida.
10. Pulsa `Claim Winnings` con el mismo market ID.

### 4) Diagnostico si sale UNKNOWN

Si tienes el hash de la tx de resolve:

```bash
RESOLVE_TX=0x... npm run diagnose
```

Opcional:

```bash
MARKET_ID=2 RESOLVE_TX=0x... npm run diagnose
```

Vas a ver detalles del payload, agent id, presupuesto por agente, y eventos de resolucion.

### 5) Troubleshooting rapido

- `Expired` en `placeBet`: el mercado expiro antes de minar la tx. Crea otro con mayor deadline.
- `Not expired` en resolve: espera unos segundos y reintenta.
- Mercado sigue en `Open`: probablemente resolviste otro market ID. Resuelve el correcto.
- `Nothing to claim`: no hay apuesta valida de tu address en ese mercado.
- `UNKNOWN` repetido: sube el top-up (`RESOLVE_TOPUP_STT`).

Flujo de decision:

```text
Falla apuesta?
  -> Expired: recrear con deadline mayor (120-180s)
  -> Not open: cargar market ID correcto y revisar status

Sigue Open tras deadline?
  -> Keeper corriendo? si no, arrancarlo
  -> Si si, esperar 1-2 ciclos de scan
  -> Si persiste, ejecutar diagnose con RESOLVE_TX

Falla claim?
  -> Verificar mismo market ID en bet/resolve/claim
  -> Si no hay stake del usuario, claim revierte con Nothing to claim
```
