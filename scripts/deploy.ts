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

  // Real agent IDs from https://agents.testnet.somnia.network (Solidity tab).
  // Unregistered IDs make resolveMarket revert when it calls platform.createRequest.
  const agentIdRaw = process.env.LLM_AGENT_ID;
  if (!agentIdRaw) {
    throw new Error(
      "LLM_AGENT_ID is not set. Get the real LLM Inference agent ID from " +
        "https://agents.testnet.somnia.network and add it to .env"
    );
  }
  const jsonApiIdRaw = process.env.JSON_API_AGENT_ID;
  if (!jsonApiIdRaw) {
    throw new Error(
      "JSON_API_AGENT_ID is not set. Get the real JSON API Request agent ID from " +
        "https://agents.testnet.somnia.network and add it to .env"
    );
  }
  const llmAgentId = BigInt(agentIdRaw);
  const jsonApiAgentId = BigInt(jsonApiIdRaw);
  console.log(`Using LLM agent ID: ${llmAgentId}`);
  console.log(`Using JSON API agent ID: ${jsonApiAgentId}`);

  const contract = await viem.deployContract("TruthMarket", [llmAgentId, jsonApiAgentId]);
  console.log(`\nTruthMarket deployed at: ${contract.address}`);

  writeFileSync(
    join(__dirname, "deployed.json"),
    JSON.stringify(
      {
        TruthMarket: contract.address,
        network: "somniaTestnet",
        llmAgentId: llmAgentId.toString(),
        jsonApiAgentId: jsonApiAgentId.toString(),
      },
      null,
      2
    )
  );
  console.log("Saved → scripts/deployed.json");
}

main().catch(console.error);
