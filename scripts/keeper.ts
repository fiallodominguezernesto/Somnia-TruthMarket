import { network } from "hardhat";
import {
  OUTCOMES,
  computeResolveValue,
  getPlatformDeposit,
  loadDeployed,
  withRetry,
  type MarketTuple,
} from "./_lib.js";

// How often the keeper scans for expired markets.
const SCAN_MS = Number(process.env.KEEPER_SCAN_MS ?? 10_000);

/**
 * Runs an autonomous keeper loop that resolves expired, still-open markets.
 */
async function main() {
  const { viem } = await network.create();
  const { TruthMarket: address } = loadDeployed();

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
    const count = await withRetry(
      () => contract.read.marketCount() as Promise<bigint>,
      { label: "marketCount" }
    );

    for (let id = 1n; id <= count; id++) {
      const key = id.toString();
      if (inFlight.has(key)) continue;

      const m = (await withRetry(
        () => contract.read.markets([id]) as Promise<MarketTuple>,
        { label: `markets(${id})` }
      ));
      const deadline = m[1];
      const outcome = m[4];
      const requestId = m[5];
      const bounty = m[6];
      const kind = m[8];

      const isOpen = outcome === 0;        // Outcome.Open
      const expired = deadline > 0n && nowSec >= deadline;
      const unrequested = requestId === 0n;

      if (!(isOpen && expired && unrequested)) continue;

      inFlight.add(key);
      void resolve(id, bounty, kind).finally(() => inFlight.delete(key));
    }
  }

  /**
   * Submits resolveMarket and then waits for asynchronous settlement.
   */
  async function resolve(id: bigint, bounty: bigint, kind: number) {
    try {
      const deposit = await getPlatformDeposit(publicClient);
      const value = computeResolveValue(kind, deposit);

      console.log(`→ Market #${id} expired. Resolving autonomously (bounty ${bounty} wei)...`);
      const hash = await withRetry(
        () => contract.write.resolveMarket([id], { value }),
        { label: `resolveMarket(${id})` }
      );
      const receipt = await withRetry(
        () => publicClient.waitForTransactionReceipt({ hash }),
        { label: `waitForTransactionReceipt(${hash})` }
      );
      console.log(`  resolveMarket tx ${hash} in block ${receipt.blockNumber}`);

      // Confirm settlement once the async LLM callback lands.
      await waitForResolution(id);
    } catch (err: unknown) {
      const message = (err as { shortMessage?: string; message?: string })?.shortMessage
        ?? (err as { message?: string })?.message
        ?? String(err);
      console.error(`  ✗ Market #${id} resolve failed: ${message}`);
    }
  }

  /**
   * Polls market state until outcome changes from Open or timeout is hit.
   */
  async function waitForResolution(id: bigint) {
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      try {
        const m = await withRetry(
          () => contract.read.markets([id]) as Promise<MarketTuple>,
          { label: `markets(${id}) settle-poll` }
        );
        if (m[4] !== 0) {
          console.log(`  ✅ Market #${id} settled → ${OUTCOMES[m[4]] ?? m[4]}`);
          return;
        }
      } catch (err: unknown) {
        const message = (err as { shortMessage?: string; message?: string })?.shortMessage
          ?? (err as { message?: string })?.message
          ?? String(err);
        console.warn(`  ⚠️ Market #${id} settle poll error: ${message.split("\n")[0].slice(0, 160)}`);
      }
      await new Promise((r) => setTimeout(r, 5_000));
    }
    console.log(`  ⏰ Market #${id}: no callback within timeout, will recheck next scan`);
  }

  // Run forever.
  await scan();
  setInterval(() => {
    scan().catch((e: unknown) => {
      const message = (e as { message?: string })?.message ?? String(e);
      console.error("scan error:", message);
    });
  }, SCAN_MS);
}

main().catch(console.error);
