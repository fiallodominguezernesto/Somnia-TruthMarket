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

  const fullDemo = (process.env.FULL_DEMO ?? "false").toLowerCase() === "true";

  // Fast mode for short deadlines: one bet per market
  const bets: Array<{ marketId: bigint; isYes: boolean; amount: bigint; label: string }> = fullDemo
    ? [
        { marketId: BigInt(marketIds[0]), isYes: true, amount: parseEther("0.05"), label: "YES (correct)" },
        { marketId: BigInt(marketIds[0]), isYes: false, amount: parseEther("0.02"), label: "NO (wrong)" },
        { marketId: BigInt(marketIds[1]), isYes: true, amount: parseEther("0.05"), label: "YES (correct)" },
        { marketId: BigInt(marketIds[1]), isYes: false, amount: parseEther("0.02"), label: "NO (wrong)" },
        { marketId: BigInt(marketIds[2]), isYes: false, amount: parseEther("0.05"), label: "NO (correct)" },
        { marketId: BigInt(marketIds[2]), isYes: true, amount: parseEther("0.02"), label: "YES (wrong)" },
      ]
    : [{ marketId: BigInt(marketIds[0]), isYes: true, amount: parseEther("0.05"), label: "YES" }];

  for (const { marketId, isYes, amount, label } of bets) {
    try {
      const hash = await contract.write.placeBet([marketId, isYes], { value: amount });
      await publicClient.waitForTransactionReceipt({ hash });
      console.log(`✅ Market #${marketId} → ${label} — ${formatEther(amount)} STT  [${hash.slice(0, 10)}…]`);
    } catch (error) {
      console.log(`⚠️ Market #${marketId} skipped (${label}): ${(error as Error).message.split("\n")[0]}`);
    }
  }

  console.log("\nBet script finished. Wait for expiry, then run resolveMarket.ts.");
}

main().catch(console.error);
