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
- `LLM_AGENT_ID=<real LLM Inference ID>`

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
  - `LLM_AGENT_ID=<real LLM Inference ID>`

Get `LLM_AGENT_ID` from `https://agents.testnet.somnia.network` (LLM Inference -> Solidity tab).

Optional validation before deploy:

```bash
npm run sim-platform
```

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

- Default resolve value is `getRequestDeposit() + 1.2 STT`.
- Optional: `RESOLVE_TOPUP_STT=0.8 npm run resolve-market`.
- Optional market: `MARKET_ID=2 npm run resolve-market`.

4b. Autonomous resolve with keeper (agent loop)

```bash
npm run keeper
```

- Keeper scans markets continuously, resolves expired `Open` markets, and collects bounty.
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
   - Use `180` seconds if you need more signing time.
   - Creation includes bounty fee for resolver incentives.
6. Load market snapshot and note the market ID.
7. Place bet using that exact market ID.
8. After deadline passes, click `Resolve Market (LLM)`.
   - Or run `npm run keeper` in terminal and let it resolve autonomously.
9. Reload snapshot until outcome changes from `Open`.
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
- `LLM_AGENT_ID=<ID real de LLM Inference>`

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
  - `LLM_AGENT_ID=<ID real de LLM Inference>`

Obtiene `LLM_AGENT_ID` desde `https://agents.testnet.somnia.network` (LLM Inference -> pestaña Solidity).

Validacion opcional antes de deploy:

```bash
npm run sim-platform
```

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

- El valor por defecto es `getRequestDeposit() + 1.2 STT`.
- Opcional: `RESOLVE_TOPUP_STT=0.8 npm run resolve-market`.
- Mercado especifico: `MARKET_ID=2 npm run resolve-market`.

4b. Resolucion autonoma con keeper (bucle agente)

```bash
npm run keeper
```

- El keeper escanea mercados continuamente, resuelve los vencidos en `Open`, y cobra bounty.
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
   - Usa `180` segundos si necesitas mas tiempo para firmar.
   - La creacion incluye fee bounty para incentivar al resolver.
6. Carga el snapshot y anota el market ID.
7. Apuesta usando ese mismo market ID.
8. Cuando pase el deadline, pulsa `Resolve Market (LLM)`.
   - O ejecuta `npm run keeper` en terminal para resolucion autonoma.
9. Recarga snapshot hasta que outcome deje de ser `Open`.
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
