import { network } from "hardhat";
import { parseAbiItem, parseEther, type PublicClient } from "viem";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PLATFORM = "0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776" as const;
const PLATFORM_ABI = [
  {
    name: "getRequestDeposit",
    type: "function" as const,
    stateMutability: "view" as const,
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** Human-readable market outcomes by enum index. */
const OUTCOMES = ["Open", "YES", "NO", "UNKNOWN"];
const BLOCK_WINDOW = 1000n;   // Somnia: max 1000 blocks per getLogs query
const POLL_MS = 5_000;        // polling interval
const TIMEOUT_MS = 180_000;   // 3 minute timeout

/**
 * Polls MarketResolved and ResolutionText events until settlement or timeout.
 */
async function pollResolution(
  publicClient: PublicClient,
  contractAddress: `0x${string}`,
  marketId: bigint,
  startBlock: bigint
): Promise<string | null> {
  const deadline = Date.now() + TIMEOUT_MS;
  const event = parseAbiItem("event MarketResolved(uint256 indexed id, uint8 outcome)");
  const textEvent = parseAbiItem("event ResolutionText(uint256 indexed id, string text)");

  let searchFrom = startBlock;

  console.log("⏳ Polling for MarketResolved (sliding window, max 1000 blocks/query)...");

  while (Date.now() < deadline) {
    const latest = await publicClient.getBlockNumber();

    // Sliding window: scan all new blocks in chunks of 1000
    for (let from = searchFrom; from <= latest; from += BLOCK_WINDOW) {
      const to = from + BLOCK_WINDOW - 1n > latest ? latest : from + BLOCK_WINDOW - 1n;

      const logs = await publicClient.getLogs({
        address: contractAddress,
        event,
        args: { id: marketId },
        fromBlock: from,
        toBlock: to,
      });

      if (logs.length > 0) {
        const outcome = OUTCOMES[Number(logs[0].args.outcome)] ?? "Unknown";
        const textLogs = await publicClient.getLogs({
          address: contractAddress,
          event: textEvent,
          args: { id: marketId },
          fromBlock: from,
          toBlock: to,
        });
        if (textLogs.length > 0) {
          console.log(`LLM text: ${textLogs[textLogs.length - 1].args.text}`);
        }
        console.log(`\n✅ Market #${marketId} resolved → ${outcome}`);
        return outcome;
      }
    }

    searchFrom = latest + 1n;
    const elapsed = Math.round((TIMEOUT_MS - (deadline - Date.now())) / 1000);
    process.stdout.write(`\r  ${elapsed}s - current block: ${latest}   `);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }

  console.log("\n⏰ Timeout. Verifica el estado con: contract.read.markets([marketId])");
  return null;
}

/**
 * Resolves a selected market by sending the required platform deposit + top-up.
 */
async function main() {
  const { viem } = await network.create();
  const { address, marketIds } = JSON.parse(
    readFileSync(join(__dirname, "markets.json"), "utf-8")
  );

  // Use MARKET_ID env var or the first market by default
  const marketId = BigInt(process.env.MARKET_ID ?? marketIds[0]);

  const publicClient = await viem.getPublicClient();
  const contract = await viem.getContractAt("TruthMarket", address);

  const market = await contract.read.markets([marketId]);
  const question = market[0];
  const deadlineTs = market[1];
  console.log(`Market #${marketId}: "${question}"`);
  console.log(`Deadline: ${new Date(Number(deadlineTs) * 1000).toLocaleString()}`);

  // Wait if market is still before deadline
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  if (nowSec < deadlineTs) {
    const waitMs = Number(deadlineTs - nowSec) * 1000 + 2000;
    console.log(`\n⏰ Market not expired yet. Waiting ${Math.ceil(waitMs / 1000)}s...`);
    await new Promise((r) => setTimeout(r, waitMs));
  }

  // Read required platform deposit
  const deposit = await publicClient.readContract({
    address: PLATFORM,
    abi: PLATFORM_ABI,
    functionName: "getRequestDeposit",
  });
  const topupStt = process.env.RESOLVE_TOPUP_STT ?? "1.2";
  const topup = parseEther(topupStt);
  const totalValue = deposit + topup;

  console.log(`\nRequired deposit: ${deposit} wei`);
  console.log(`Top-up value: ${topup} wei (${topupStt} STT)`);
  console.log(`Total value sent: ${totalValue} wei`);

  const hash = await contract.write.resolveMarket([marketId], { value: totalValue });
  console.log(`resolveMarket tx: ${hash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`Confirmed in block ${receipt.blockNumber}. Waiting for LLM callback...`);

  await pollResolution(publicClient, address, marketId, receipt.blockNumber);
}

main().catch(console.error);
