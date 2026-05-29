import { network } from "hardhat";
import { writeFileSync } from "fs";
import { join } from "path";
import { SCRIPTS_DIR, withRetry, type DeployedJson } from "./_lib.js";

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
  const parseIdRaw = process.env.PARSE_AGENT_ID;
  if (!parseIdRaw) {
    throw new Error(
      "PARSE_AGENT_ID is not set. Get the real LLM Parse Website agent ID from " +
        "https://agents.testnet.somnia.network and add it to .env"
    );
  }
  const llmAgentId = BigInt(agentIdRaw);
  const jsonApiAgentId = BigInt(jsonApiIdRaw);
  const parseAgentId = BigInt(parseIdRaw);
  console.log(`Using LLM agent ID: ${llmAgentId}`);
  console.log(`Using JSON API agent ID: ${jsonApiAgentId}`);
  console.log(`Using Parse Website agent ID: ${parseAgentId}`);

  const contract = await withRetry(
    () => viem.deployContract("TruthMarket", [llmAgentId, jsonApiAgentId, parseAgentId]),
    { label: "deployContract(TruthMarket)" }
  );
  console.log(`\nTruthMarket deployed at: ${contract.address}`);

  const deployed: DeployedJson = {
    TruthMarket: contract.address,
    network: "somniaTestnet",
    llmAgentId: llmAgentId.toString(),
    jsonApiAgentId: jsonApiAgentId.toString(),
    parseAgentId: parseAgentId.toString(),
  };
  writeFileSync(join(SCRIPTS_DIR, "deployed.json"), JSON.stringify(deployed, null, 2));
  console.log("Saved → scripts/deployed.json");
}

main().catch(console.error);
