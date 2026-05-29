import { network } from "hardhat";
import { parseEventLogs, parseEther, type PublicClient } from "viem";
import { writeFileSync } from "fs";
import { join } from "path";
import { SCRIPTS_DIR, loadDeployed, withRetry } from "./_lib.js";

/** Verifiable historical facts with clear LLM answers. */
const QUESTIONS = [
  "Bitcoin's genesis block was mined on January 3, 2009.",          // → YES
  "Ethereum's Merge (switch to Proof of Stake) occurred in September 2022.", // → YES
  "Vitalik Buterin created Bitcoin.",                               // → NO
];

const QUICK_DEMO_QUESTION = "2 + 2 equals 4.";

/** Market lifetime used by this script in seconds. */
const DEADLINE_SECONDS = 60;

// Must be >= MIN_CREATION_FEE in the contract. Funds the resolver bounty.
const CREATION_FEE_STT = process.env.CREATION_FEE_STT ?? "0.02";

/** Comparator enum mapping (matches contract): GT=0, GTE=1, LT=2, LTE=3. */
const COMPARATORS: Record<string, number> = { gt: 0, gte: 1, lt: 2, lte: 3 };

/** Hardhat-viem's typed contract client is opaque; relax to any so tuple
 *  args and write calls type-check without re-declaring every signature. */
type ContractClient = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Reads the MarketCreated event id from the receipt logs via parseEventLogs.
 * Wraps the (intentionally permissive) viem typing in one place so callers
 * can stay strict-typed.
 */
function extractMarketId(contract: ContractClient, logs: readonly unknown[]): bigint {
  const events = parseEventLogs({
    abi: contract.abi,
    // viem's typing for `logs` is wider than what we hand in (we always pass a
    // receipt's logs which match `Log[]`); cast here once.
    logs: logs as never,
    eventName: "MarketCreated",
  }) as unknown as Array<{ args: { id: bigint } }>;
  const id = events[0]?.args.id;
  if (id === undefined) {
    throw new Error("MarketCreated event not found in receipt logs");
  }
  return id;
}

/**
 * Creates a PRICE market settled deterministically by the JSON API agent.
 * Configurable via env vars, with a BTC > target preset for the quick demo.
 */
async function createPriceMarket(
  contract: ContractClient,
  publicClient: PublicClient,
  deadline: bigint,
  bounty: bigint
): Promise<string> {
  const apiUrl =
    process.env.API_URL ??
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd";
  const jsonSelector = process.env.JSON_SELECTOR ?? "bitcoin.usd";
  const decimals = Number(process.env.DECIMALS ?? "0");
  const target = BigInt(process.env.TARGET ?? "1000");
  const comparator = COMPARATORS[(process.env.COMPARATOR ?? "gt").toLowerCase()] ?? 0;
  const question =
    process.env.QUESTION ??
    `BTC/USD ${process.env.COMPARATOR ?? "gt"} ${target} at resolution time.`;

  const hash = await withRetry(
    () =>
      contract.write.createPriceMarket(
        [question, deadline, apiUrl, jsonSelector, decimals, target, comparator],
        { value: bounty }
      ) as Promise<`0x${string}`>,
    { label: "createPriceMarket" }
  );
  const receipt = await withRetry(
    () => publicClient.waitForTransactionReceipt({ hash }),
    { label: `waitForTransactionReceipt(${hash})` }
  );
  const id = extractMarketId(contract, receipt.logs);
  console.log(`✅ PRICE Market #${id}: "${question}"`);
  console.log(`   source: ${apiUrl} [${jsonSelector}] ${process.env.COMPARATOR ?? "gt"} ${target} (decimals ${decimals})`);
  return id.toString();
}

/**
 * Creates a WEB_FACT market settled by chaining Parse Website -> LLM Inference.
 * Configurable via env vars, with an AFCON-style preset for the quick demo.
 */
async function createWebFactMarket(
  contract: ContractClient,
  publicClient: PublicClient,
  deadline: bigint,
  bounty: bigint
): Promise<string> {
  const sourceUrl = process.env.SOURCE_URL ?? "https://en.wikipedia.org/wiki/Bitcoin";
  const question =
    process.env.QUESTION ??
    "Bitcoin was created by a person or group under the name Satoshi Nakamoto.";

  const hash = await withRetry(
    () =>
      contract.write.createWebFactMarket(
        [question, deadline, sourceUrl],
        { value: bounty }
      ) as Promise<`0x${string}`>,
    { label: "createWebFactMarket" }
  );
  const receipt = await withRetry(
    () => publicClient.waitForTransactionReceipt({ hash }),
    { label: `waitForTransactionReceipt(${hash})` }
  );
  const id = extractMarketId(contract, receipt.logs);
  console.log(`✅ WEB_FACT Market #${id}: "${question}"`);
  console.log(`   source: ${sourceUrl} (Parse Website -> LLM Inference)`);
  return id.toString();
}

/**
 * Creates one or more markets and stores generated IDs in scripts/markets.json.
 */
async function main() {
  const { viem } = await network.create();
  const kind = (process.env.MARKET_KIND ?? "statement").toLowerCase();
  const fullDemo = (process.env.FULL_DEMO ?? "false").toLowerCase() === "true";
  const selectedQuestions = fullDemo ? QUESTIONS : [QUICK_DEMO_QUESTION];
  const { TruthMarket: address } = loadDeployed();

  const publicClient = (await viem.getPublicClient()) as unknown as PublicClient;
  const contract = await viem.getContractAt("TruthMarket", address);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS);

  const marketIds: string[] = [];
  const bounty = parseEther(CREATION_FEE_STT);

  if (kind === "price") {
    marketIds.push(await createPriceMarket(contract, publicClient, deadline, bounty));
  } else if (kind === "web_fact" || kind === "webfact") {
    marketIds.push(await createWebFactMarket(contract, publicClient, deadline, bounty));
  } else {
    for (const question of selectedQuestions) {
      const hash = await withRetry(
        () =>
          contract.write.createMarket([question, deadline], { value: bounty }) as Promise<`0x${string}`>,
        { label: "createMarket" }
      );
      const receipt = await withRetry(
        () => publicClient.waitForTransactionReceipt({ hash }),
        { label: `waitForTransactionReceipt(${hash})` }
      );

      const id = extractMarketId(contract, receipt.logs);
      console.log(`✅ Market #${id}: "${question}" (bounty ${CREATION_FEE_STT} STT)`);
      marketIds.push(id.toString());
    }
  }

  const expiry = new Date(Number(deadline) * 1000);
  console.log(`\n⏰ Deadline: ${expiry.toLocaleTimeString()} (+${DEADLINE_SECONDS}s)`);
  console.log("Run placeBet.ts now, then wait for expiry to resolve.");
  if (!fullDemo && kind !== "price") {
    console.log("Tip: set FULL_DEMO=true to create all 3 markets, MARKET_KIND=price for a JSON API market, or MARKET_KIND=web_fact for a Parse Website -> LLM market.");
  }

  writeFileSync(
    join(SCRIPTS_DIR, "markets.json"),
    JSON.stringify({ address, marketIds }, null, 2)
  );
  console.log("Saved → scripts/markets.json");
}

main().catch(console.error);
