# Somnia Agentathon Workspace

Este repositorio ya queda preparado para compilar y desplegar contratos en Somnia Testnet (`50312`) con dos toolchains:

- `Hardhat + Viem` (scripts de deploy e interaccion)
- `Foundry` (compilacion alternativa, utilidades `cast`)

## 1) Requisitos

Trabaja en WSL (Ubuntu), no desde ruta UNC en PowerShell.

```bash
source ~/.nvm/nvm.sh
nvm use --lts
node --version
npm --version
~/.foundry/bin/forge --version
```

## 2) Variables de entorno

```bash
cp .env.example .env
```

Rellena `PRIVATE_KEY` con la wallet de testnet (con STT del faucet).

## 3) Comandos base

```bash
npm run build
npm run deploy
```

Comandos previstos para scripts de flujo:

```bash
npm run create-market
npm run place-bet
npm run resolve-market
npm run claim
```

## 4) Foundry opcional

```bash
~/.foundry/bin/forge build
```

Si quieres `forge/cast/anvil` en PATH en cada shell:

```bash
echo 'export PATH="$HOME/.foundry/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```
