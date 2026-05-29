import { network } from "hardhat";
import { formatEther, parseAbiItem, type PublicClient } from "viem";
import {
  KINDS,
  OUTCOMES,
  computeResolveValue,
  getPlatformDeposit,
  loadDeployed,
  loadMarkets,
  withRetry,
  type MarketTuple,
} from "./_lib.js";

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
  const dataEvent = parseAbiItem("event ResolutionData(uint256 indexed id, uint256 value)");
  const evidenceEvent = parseAbiItem("event EvidenceExtracted(uint256 indexed id, string evidence)");

  let searchFrom = startBlock;

  console.log("⏳ Polling for MarketResolved (sliding window, max 1000 blocks/query)...");

  while (Date.now() < deadline) {
    const latest = await withRetry(() => publicClient.getBlockNumber(), { label: "getBlockNumber" });

    // Sliding window: scan all new blocks in chunks of 1000
    for (let from = searchFrom; from <= latest; from += BLOCK_WINDOW) {
      const to = from + BLOCK_WINDOW - 1n > latest ? latest : from + BLOCK_WINDOW - 1n;

      const logs = await withRetry(
        () =>
          publicClient.getLogs({
            address: contractAddress,
            event,
            args: { id: marketId },
            fromBlock: from,
            toBlock: to,
          }),
        { label: `getLogs MarketResolved ${from}-${to}` }
      );

      if (logs.length > 0) {
        const outcome = OUTCOMES[Number(logs[0].args.outcome)] ?? "Unknown";
        const evidenceLogs = await withRetry(
          () =>
            publicClient.getLogs({
              address: contractAddress,
              event: evidenceEvent,
              args: { id: marketId },
              fromBlock: startBlock,
              toBlock: to,
            }),
          { label: "getLogs EvidenceExtracted" }
        );
        if (evidenceLogs.length > 0) {
          console.log(`Parse Website evidence: ${evidenceLogs[evidenceLogs.length - 1].args.evidence}`);
        }
        const textLogs = await withRetry(
          () =>
            publicClient.getLogs({
              address: contractAddress,
              event: textEvent,
              args: { id: marketId },
              fromBlock: from,
              toBlock: to,
            }),
          { label: "getLogs ResolutionText" }
        );
        if (textLogs.length > 0) {
          console.log(`LLM text: ${textLogs[textLogs.length - 1].args.text}`);
        }
        const dataLogs = await withRetry(
          () =>
            publicClient.getLogs({
              address: contractAddress,
              event: dataEvent,
              args: { id: marketId },
              fromBlock: from,
              toBlock: to,
            }),
          { label: "getLogs ResolutionData" }
        );
        if (dataLogs.length > 0) {
          console.log(`JSON API value: ${dataLogs[dataLogs.length - 1].args.value}`);
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
  const { TruthMarket: address } = loadDeployed();
  const { address: marketsAddress, marketIds } = loadMarkets(address);

  // Sanity check: refuse to operate on a markets.json that points at a stale
  // deployment, so we don't silently send funds to a contract that no longer
  // has this market.
  if (marketsAddress.toLowerCase() !== address.toLowerCase()) {
    throw new Error(
      `markets.json (${marketsAddress}) and deployed.json (${address}) disagree.`
    );
  }

  const marketId = BigInt(process.env.MARKET_ID ?? marketIds[0]);

  const publicClient = (await viem.getPublicClient()) as unknown as PublicClient;
  const contract = await viem.getContractAt("TruthMarket", address);

  const market = (await withRetry(
    () => contract.read.markets([marketId]) as Promise<MarketTuple>,
    { label: `markets(${marketId})` }
  ));
  const question = market[0];
  const deadlineTs = market[1];
  const kind = market[8];
  console.log(`Market #${marketId}: "${question}" [${KINDS[kind] ?? `kind=${kind}`}]`);
  console.log(`Deadline: ${new Date(Number(deadlineTs) * 1000).toLocaleString()}`);

  // Wait if market is still before deadline
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  if (nowSec < deadlineTs) {
    const waitMs = Number(deadlineTs - nowSec) * 1000 + 2000;
    console.log(`\n⏰ Market not expired yet. Waiting ${Math.ceil(waitMs / 1000)}s...`);
    await new Promise((r) => setTimeout(r, waitMs));
  }

  // Read required platform deposit and compute msg.value from the canonical
  // formula in _lib (mirrors the contract's WEB_FACT reserve so the chained
  // LLM stage isn't underfunded).
  const deposit = await getPlatformDeposit(publicClient);
  const totalValue = computeResolveValue(kind, deposit);

  console.log(`\nRequired deposit: ${formatEther(deposit)} STT (${deposit} wei)`);
  console.log(`Total value sent: ${formatEther(totalValue)} STT (${totalValue} wei)`);
  if (kind === 2) {
    console.log(
      "  WEB_FACT splits the value across Parse Website (stage 1) and the chained " +
        "LLM Inference (stage 2). Each stage gets ~1.2 STT topup."
    );
  }

  const hash = await withRetry(
    () => contract.write.resolveMarket([marketId], { value: totalValue }),
    { label: `resolveMarket(${marketId})` }
  );
  console.log(`resolveMarket tx: ${hash}`);

  const receipt = await withRetry(
    () => publicClient.waitForTransactionReceipt({ hash }),
    { label: `waitForTransactionReceipt(${hash})` }
  );
  console.log(`Confirmed in block ${receipt.blockNumber}. Waiting for LLM callback...`);

  await pollResolution(publicClient, address, marketId, receipt.blockNumber);
}

main().catch(console.error);
