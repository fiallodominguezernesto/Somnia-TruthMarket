import { network } from "hardhat";
import { formatEther, parseEventLogs } from "viem";
import {
  OUTCOMES,
  loadDeployed,
  loadMarkets,
  withRetry,
  type MarketTuple,
} from "./_lib.js";

/**
 * Reads user position and submits claim for winnings or UNKNOWN refund.
 */
async function main() {
  const { viem } = await network.create();
  const { TruthMarket: deployedAddress } = loadDeployed();
  const { address, marketIds } = loadMarkets(deployedAddress);

  const marketId = BigInt(process.env.MARKET_ID ?? marketIds[0]);

  const publicClient = await viem.getPublicClient();
  const contract = await viem.getContractAt("TruthMarket", address);
  const [wallet] = await viem.getWalletClients();
  const account = wallet.account.address;

  const market = await withRetry(
    () => contract.read.markets([marketId]) as Promise<MarketTuple>,
    { label: `markets(${marketId})` }
  );
  const question = market[0];
  const outcomeIdx = market[4];
  const outcome = OUTCOMES[outcomeIdx] ?? "Unknown";

  console.log(`Market #${marketId}: "${question}"`);
  console.log(`Outcome: ${outcome}`);

  if (outcome === "Open") {
    console.log("Market is still open. Run resolveMarket.ts first.");
    return;
  }

  const [yesBet, noBet] = await Promise.all([
    withRetry(
      () => contract.read.yesBets([marketId, account]) as Promise<bigint>,
      { label: "yesBets" }
    ),
    withRetry(
      () => contract.read.noBets([marketId, account]) as Promise<bigint>,
      { label: "noBets" }
    ),
  ]);

  console.log("\nYour bets:");
  console.log(`  YES: ${formatEther(yesBet)} STT`);
  console.log(`  NO:  ${formatEther(noBet)} STT`);

  if (yesBet === 0n && noBet === 0n) {
    console.log("You have no bets in this market.");
    return;
  }

  const yesPool = market[2];
  const noPool = market[3];
  const totalPool = yesPool + noPool;

  // Calculate estimated payout before sending tx
  let estimatedPayout = 0n;
  if (outcome === "UNKNOWN") {
    estimatedPayout = yesBet + noBet;
  } else if (outcome === "YES" && yesBet > 0n) {
    estimatedPayout = (yesBet * totalPool) / yesPool;
  } else if (outcome === "NO" && noBet > 0n) {
    estimatedPayout = (noBet * totalPool) / noPool;
  }

  if (estimatedPayout === 0n) {
    console.log("No winnings available to claim for this market.");
    return;
  }

  console.log(`\nEstimated payout: ${formatEther(estimatedPayout)} STT`);

  const hash = await withRetry(
    () => contract.write.claim([marketId]),
    { label: `claim(${marketId})` }
  );
  const receipt = await withRetry(
    () => publicClient.waitForTransactionReceipt({ hash }),
    { label: `waitForTransactionReceipt(${hash})` }
  );

  const events = parseEventLogs({
    abi: contract.abi,
    logs: receipt.logs,
    eventName: "Claimed",
  });

  const claimed = (events[0]?.args as { amount?: bigint } | undefined)?.amount ?? estimatedPayout;
  console.log(`\n✅ Claimed: ${formatEther(claimed)} STT`);
  console.log(`Tx: ${hash}`);
}

main().catch(console.error);
