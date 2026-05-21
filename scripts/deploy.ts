import hre from "hardhat";
import { writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const [deployer] = await hre.viem.getWalletClients();
  console.log(`Deploying from: ${deployer.account.address}`);

  const contract = await hre.viem.deployContract("TruthMarket");
  console.log(`\nTruthMarket deployed at: ${contract.address}`);

  writeFileSync(
    join(__dirname, "deployed.json"),
    JSON.stringify({ TruthMarket: contract.address, network: hre.network.name }, null, 2)
  );
  console.log("Saved → scripts/deployed.json");
}

main().catch(console.error);
