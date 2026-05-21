import { network } from "hardhat";
import { formatEther, parseEventLogs } from "viem";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const OUTCOMES = ["Open", "YES", "NO", "UNKNOWN"];

async function main() {
  const { viem } = await network.create();
  const { address, marketIds } = JSON.parse(
    readFileSync(join(__dirname, "markets.json"), "utf-8")
  );

  const marketId = BigInt(process.env.MARKET_ID ?? marketIds[0]);

  const publicClient = await viem.getPublicClient();
  const contract = await viem.getContractAt("TruthMarket", address);
  const [wallet] = await viem.getWalletClients();
  const account = wallet.account.address;

  const market = await contract.read.markets([marketId]);
  const question = market[0];
  const outcomeIdx = market[4] as number;
  const outcome = OUTCOMES[outcomeIdx] ?? "Unknown";

  console.log(`Market #${marketId}: "${question}"`);
  console.log(`Outcome: ${outcome}`);

  if (outcome === "Open") {
    console.log("Market is still open. Run resolveMarket.ts first.");
    return;
  }

  const [yesBet, noBet] = await Promise.all([
    contract.read.yesBets([marketId, account]),
    contract.read.noBets([marketId, account]),
  ]);

  console.log("\nYour bets:");
  console.log(`  YES: ${formatEther(yesBet)} STT`);
  console.log(`  NO:  ${formatEther(noBet)} STT`);

  if (yesBet === 0n && noBet === 0n) {
    console.log("You have no bets in this market.");
    return;
  }

  const [yesPool, noPool] = [market[2] as bigint, market[3] as bigint];
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

  const hash = await contract.write.claim([marketId]);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  const events = parseEventLogs({
    abi: contract.abi,
    logs: receipt.logs,
    eventName: "Claimed",
  });

  const claimed = events[0]?.args.amount ?? estimatedPayout;
  console.log(`\n✅ Claimed: ${formatEther(claimed)} STT`);
  console.log(`Tx: ${hash}`);
}

main().catch(console.error);
