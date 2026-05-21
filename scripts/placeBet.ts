import { network } from "hardhat";
import { formatEther, parseEther } from "viem";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const { viem } = await network.create();
  const { address, marketIds } = JSON.parse(
    readFileSync(join(__dirname, "markets.json"), "utf-8")
  );

  const publicClient = await viem.getPublicClient();
  const contract = await viem.getContractAt("TruthMarket", address);

  // Demo bets: correct majority + incorrect minority to show payout distribution
  const bets: Array<{ marketId: bigint; isYes: boolean; amount: bigint; label: string }> = [
    // Market 1: "Bitcoin genesis block mined Jan 3 2009" → YES
    { marketId: BigInt(marketIds[0]), isYes: true,  amount: parseEther("0.05"), label: "YES (correct)" },
    { marketId: BigInt(marketIds[0]), isYes: false, amount: parseEther("0.02"), label: "NO  (wrong)" },

    // Market 2: "Ethereum Merge Sep 2022" → YES
    { marketId: BigInt(marketIds[1]), isYes: true,  amount: parseEther("0.05"), label: "YES (correct)" },
    { marketId: BigInt(marketIds[1]), isYes: false, amount: parseEther("0.02"), label: "NO  (wrong)" },

    // Market 3: "Vitalik created Bitcoin" → NO
    { marketId: BigInt(marketIds[2]), isYes: false, amount: parseEther("0.05"), label: "NO  (correct)" },
    { marketId: BigInt(marketIds[2]), isYes: true,  amount: parseEther("0.02"), label: "YES (wrong)" },
  ];

  for (const { marketId, isYes, amount, label } of bets) {
    const hash = await contract.write.placeBet([marketId, isYes], { value: amount });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`✅ Market #${marketId} → ${label} — ${formatEther(amount)} STT  [${hash.slice(0, 10)}…]`);
  }

  console.log("\nBets placed. Wait for market deadline, then run resolveMarket.ts.");
}

main().catch(console.error);
