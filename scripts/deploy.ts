import { network } from "hardhat";
import { writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Deploys TruthMarket and persists deployment metadata for other scripts.
 */
async function main() {
  const { viem } = await network.create();
  const [deployer] = await viem.getWalletClients();
  console.log(`Deploying from: ${deployer.account.address}`);

  // Real LLM Inference agent ID from https://agents.testnet.somnia.network
  // (LLM Inference agent → Solidity tab). An unregistered ID makes
  // resolveMarket revert when it calls platform.createRequest.
  const agentIdRaw = process.env.LLM_AGENT_ID;
  if (!agentIdRaw) {
    throw new Error(
      "LLM_AGENT_ID is not set. Get the real LLM Inference agent ID from " +
        "https://agents.testnet.somnia.network and add it to .env"
    );
  }
  const llmAgentId = BigInt(agentIdRaw);
  console.log(`Using LLM agent ID: ${llmAgentId}`);

  const contract = await viem.deployContract("TruthMarket", [llmAgentId]);
  console.log(`\nTruthMarket deployed at: ${contract.address}`);

  writeFileSync(
    join(__dirname, "deployed.json"),
    JSON.stringify(
      { TruthMarket: contract.address, network: "somniaTestnet", llmAgentId: llmAgentId.toString() },
      null,
      2
    )
  );
  console.log("Saved → scripts/deployed.json");
}

main().catch(console.error);
