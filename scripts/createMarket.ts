import { network } from "hardhat";
import { parseEventLogs, parseEther } from "viem";
import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

/**
 * Creates a PRICE market settled deterministically by the JSON API agent.
 * Configurable via env vars, with a BTC > target preset for the quick demo.
 */
async function createPriceMarket(contract: any, publicClient: any, deadline: bigint, bounty: bigint) {
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

  const hash = await contract.write.createPriceMarket(
    [question, deadline, apiUrl, jsonSelector, decimals, target, comparator],
    { value: bounty }
  );
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const [event] = parseEventLogs({ abi: contract.abi, logs: receipt.logs, eventName: "MarketCreated" });
  const id = event.args.id!;
  console.log(`✅ PRICE Market #${id}: "${question}"`);
  console.log(`   source: ${apiUrl} [${jsonSelector}] ${process.env.COMPARATOR ?? "gt"} ${target} (decimals ${decimals})`);
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
  const { TruthMarket: address } = JSON.parse(
    readFileSync(join(__dirname, "deployed.json"), "utf-8")
  );

  const publicClient = await viem.getPublicClient();
  const contract = await viem.getContractAt("TruthMarket", address);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS);

  const marketIds: string[] = [];
  const bounty = parseEther(CREATION_FEE_STT);

  if (kind === "price") {
    marketIds.push(await createPriceMarket(contract, publicClient, deadline, bounty));
  } else {
    for (const question of selectedQuestions) {
      const hash = await contract.write.createMarket([question, deadline], { value: bounty });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      const [event] = parseEventLogs({
        abi: contract.abi,
        logs: receipt.logs,
        eventName: "MarketCreated",
      });

      const id = event.args.id!;
      console.log(`✅ Market #${id}: "${question}" (bounty ${CREATION_FEE_STT} STT)`);
      marketIds.push(id.toString());
    }
  }

  const expiry = new Date(Number(deadline) * 1000);
  console.log(`\n⏰ Deadline: ${expiry.toLocaleTimeString()} (+${DEADLINE_SECONDS}s)`);
  console.log("Run placeBet.ts now, then wait for expiry to resolve.");
  if (!fullDemo && kind !== "price") {
    console.log("Tip: set FULL_DEMO=true to create all 3 markets, or MARKET_KIND=price for a JSON API market.");
  }

  writeFileSync(
    join(__dirname, "markets.json"),
    JSON.stringify({ address, marketIds }, null, 2)
  );
  console.log("Saved → scripts/markets.json");
}

main().catch(console.error);
