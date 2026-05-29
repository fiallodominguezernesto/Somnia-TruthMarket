import { network } from "hardhat";
import { parseEther } from "viem";
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

// How often the keeper scans for expired markets.
const SCAN_MS = Number(process.env.KEEPER_SCAN_MS ?? 10_000);
// Top-up sent on top of the platform deposit, same convention as resolveMarket.ts.
const TOPUP_STT = process.env.RESOLVE_TOPUP_STT ?? "1.2";

// Market struct field order from TruthMarket.sol (only the leading fields are
// read here; trailing PRICE fields are ignored):
// [question, deadline, yesPool, noPool, outcome, requestId, bounty, resolver,
//  kind, apiUrl, jsonSelector, decimals, target, comparator]
type MarketTuple = readonly [string, bigint, bigint, bigint, number, bigint, bigint, string, ...unknown[]];

/**
 * Runs an autonomous keeper loop that resolves expired, still-open markets.
 */
async function main() {
  const { viem } = await network.create();
  const { TruthMarket: address } = JSON.parse(
    readFileSync(join(__dirname, "deployed.json"), "utf-8")
  );

  const publicClient = await viem.getPublicClient();
  const [wallet] = await viem.getWalletClients();
  const contract = await viem.getContractAt("TruthMarket", address);

  console.log("🤖 TruthMarket keeper started");
  console.log(`   contract: ${address}`);
  console.log(`   resolver: ${wallet.account.address}`);
  console.log(`   scanning every ${SCAN_MS / 1000}s\n`);

  const inFlight = new Set<string>();

  /**
   * Finds candidate markets and dispatches one resolve task per market.
   */
  async function scan() {
    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    const count = (await contract.read.marketCount()) as bigint;

    for (let id = 1n; id <= count; id++) {
      const key = id.toString();
      if (inFlight.has(key)) continue;

      const m = (await contract.read.markets([id])) as MarketTuple;
      const deadline = m[1];
      const outcome = m[4];
      const requestId = m[5];
      const bounty = m[6];

      const isOpen = outcome === 0;        // Outcome.Open
      const expired = deadline > 0n && nowSec >= deadline;
      const unrequested = requestId === 0n;

      if (!(isOpen && expired && unrequested)) continue;

      inFlight.add(key);
      void resolve(id, bounty).finally(() => inFlight.delete(key));
    }
  }

  /**
   * Submits resolveMarket and then waits for asynchronous settlement.
   */
  async function resolve(id: bigint, bounty: bigint) {
    try {
      const deposit = (await publicClient.readContract({
        address: PLATFORM,
        abi: PLATFORM_ABI,
        functionName: "getRequestDeposit",
      })) as bigint;
      const value = deposit + parseEther(TOPUP_STT);

      console.log(`→ Market #${id} expired. Resolving autonomously (bounty ${bounty} wei)...`);
      const hash = await contract.write.resolveMarket([id], { value });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      console.log(`  resolveMarket tx ${hash} in block ${receipt.blockNumber}`);

      // Confirm settlement once the async LLM callback lands.
      await waitForResolution(id);
    } catch (err: any) {
      console.error(`  ✗ Market #${id} resolve failed: ${err?.shortMessage ?? err?.message ?? err}`);
    }
  }

  /**
   * Polls market state until outcome changes from Open or timeout is hit.
   */
  async function waitForResolution(id: bigint) {
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      const m = (await contract.read.markets([id])) as MarketTuple;
      if (m[4] !== 0) {
        console.log(`  ✅ Market #${id} settled → ${OUTCOMES[m[4]] ?? m[4]}`);
        return;
      }
      await new Promise((r) => setTimeout(r, 5_000));
    }
    console.log(`  ⏰ Market #${id}: no callback within timeout, will recheck next scan`);
  }

  // Run forever.
  await scan();
  setInterval(() => {
    scan().catch((e) => console.error("scan error:", e?.message ?? e));
  }, SCAN_MS);
}

main().catch(console.error);
