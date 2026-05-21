# How to Use / Como usar

This guide explains how to run the project end-to-end using both scripts and UI.

Esta guia explica como ejecutar el proyecto end-to-end usando scripts y UI.

---

## English Guide

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
cd /home/ernesto/somnia
source ~/.nvm/nvm.sh
nvm use --lts
npm run build
```

### 2) Full flow with scripts (recommended first run)

1. Deploy contract

```bash
npm run deploy
```

2. Create market(s)

```bash
npm run create-market
```

- Quick mode default: creates 1 market with 60-second deadline.
- Full mode: `FULL_DEMO=true npm run create-market`.
- Market creation sends a bounty fee (default `0.02 STT`, override with `CREATION_FEE_STT`).

3. Place bets

```bash
npm run place-bet
```

- Quick mode default: one YES bet on first market.
- Full mode: `FULL_DEMO=true npm run place-bet`.

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

5. Claim payout/refund

```bash
npm run claim
```

- Optional market: `MARKET_ID=2 npm run claim`.

### 3) Full flow with UI

1. Start frontend server:

```bash
cd /home/ernesto/somnia/frontend
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

---

## Guia en Espanol

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
cd /home/ernesto/somnia
source ~/.nvm/nvm.sh
nvm use --lts
npm run build
```

### 2) Flujo completo por scripts (recomendado primero)

1. Desplegar contrato

```bash
npm run deploy
```

2. Crear mercado(s)

```bash
npm run create-market
```

- Modo rapido por defecto: crea 1 mercado con deadline de 60 segundos.
- Modo completo: `FULL_DEMO=true npm run create-market`.
- La creacion envia fee de bounty (default `0.02 STT`, override `CREATION_FEE_STT`).

3. Apostar

```bash
npm run place-bet
```

- Modo rapido por defecto: una apuesta YES al primer mercado.
- Modo completo: `FULL_DEMO=true npm run place-bet`.

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

5. Reclamar payout/reembolso

```bash
npm run claim
```

- Mercado especifico: `MARKET_ID=2 npm run claim`.

### 3) Flujo completo por UI

1. Levantar servidor frontend:

```bash
cd /home/ernesto/somnia/frontend
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
