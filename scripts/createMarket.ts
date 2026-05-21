import hre from "hardhat";
import { parseEventLogs } from "viem";
import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Hechos históricos verificables con respuesta clara para el LLM
const QUESTIONS = [
  "Bitcoin's genesis block was mined on January 3, 2009.",          // → YES
  "Ethereum's Merge (switch to Proof of Stake) occurred in September 2022.", // → YES
  "Vitalik Buterin created Bitcoin.",                               // → NO
];

const DEADLINE_MINUTES = 5;

async function main() {
  const { TruthMarket: address } = JSON.parse(
    readFileSync(join(__dirname, "deployed.json"), "utf-8")
  );

  const publicClient = await hre.viem.getPublicClient();
  const contract = await hre.viem.getContractAt("TruthMarket", address);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_MINUTES * 60);

  const marketIds: string[] = [];

  for (const question of QUESTIONS) {
    const hash = await contract.write.createMarket([question, deadline]);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    const [event] = parseEventLogs({
      abi: contract.abi,
      logs: receipt.logs,
      eventName: "MarketCreated",
    });

    const id = event.args.id!;
    console.log(`✅ Market #${id}: "${question}"`);
    marketIds.push(id.toString());
  }

  const expiry = new Date(Number(deadline) * 1000);
  console.log(`\n⏰ Deadline: ${expiry.toLocaleTimeString()} (${DEADLINE_MINUTES} min)`);
  console.log("Run placeBet.ts now, then wait for expiry to resolve.");

  writeFileSync(
    join(__dirname, "markets.json"),
    JSON.stringify({ address, marketIds }, null, 2)
  );
  console.log("Saved → scripts/markets.json");
}

main().catch(console.error);
