import { network } from "hardhat";
import {
  decodeAbiParameters,
  decodeFunctionData,
  parseAbiItem,
  parseEventLogs,
  toFunctionSelector,
  formatEther,
  type PublicClient,
} from "viem";
import {
  KINDS,
  OUTCOMES,
  PLATFORM,
  loadDeployed,
  loadMarkets,
  withRetry,
  type MarketTuple,
} from "./_lib.js";

/** Human-readable request status labels by enum index. */
const RESPONSE_STATUS = ["None", "Pending", "Success", "Failed", "TimedOut"];
/** Maximum block range per `getLogs` query on Somnia. */
const BLOCK_WINDOW = 1000n;

/** Minimal platform ABI used for request state introspection. */
const RESPONSE_TUPLE = {
  type: "tuple[]",
  name: "responses",
  components: [
    { name: "validator", type: "address" },
    { name: "result", type: "bytes" },
    { name: "status", type: "uint8" },
    { name: "receipt", type: "uint256" },
    { name: "timestamp", type: "uint256" },
    { name: "executionCost", type: "uint256" },
  ],
} as const;

const PLATFORM_ABI = [
  {
    name: "getRequest",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "requestId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "id", type: "uint256" },
          { name: "requester", type: "address" },
          { name: "callbackAddress", type: "address" },
          { name: "callbackSelector", type: "bytes4" },
          { name: "subcommittee", type: "address[]" },
          RESPONSE_TUPLE,
          { name: "responseCount", type: "uint256" },
          { name: "failureCount", type: "uint256" },
          { name: "threshold", type: "uint256" },
          { name: "createdAt", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "status", type: "uint8" },
          { name: "consensusType", type: "uint8" },
          { name: "remainingBudget", type: "uint256" },
          { name: "perAgentBudget", type: "uint256" },
        ],
      },
    ],
  },
  {
    name: "hasRequest",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "requestId", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

/** ABI used to decode inferString payload content in RequestCreated logs. */
const LLM_ABI = [
  {
    name: "inferString",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "prompt", type: "string" },
      { name: "system", type: "string" },
      { name: "chainOfThought", type: "bool" },
      { name: "allowedValues", type: "string[]" },
    ],
    outputs: [{ name: "response", type: "string" }],
  },
] as const;

/**
 * Tries to decode a response payload as ABI string or raw UTF-8.
 */
function tryDecodeString(result: `0x${string}`): string {
  try {
    const [decoded] = decodeAbiParameters([{ type: "string" }], result);
    return `abi-string: "${decoded}"`;
  } catch {
    // Continue with best-effort raw decode.
  }

  try {
    const bytes = Buffer.from(result.slice(2), "hex");
    const text = bytes.toString("utf8").replace(/\0/g, "");
    if (text.trim().length > 0) {
      return `raw-utf8: "${text}"`;
    }
  } catch {
    // Keep fallback message below.
  }

  return "(not decodable)";
}

/**
 * Scans contract events in windows to avoid provider block-range limits.
 */
async function scanEvents(
  publicClient: PublicClient,
  address: `0x${string}`,
  fromBlock: bigint
): Promise<string[]> {
  const resolvedEvent = parseAbiItem("event MarketResolved(uint256 indexed id, uint8 outcome)");
  const textEvent = parseAbiItem("event ResolutionText(uint256 indexed id, string text)");
  const latest = await withRetry(() => publicClient.getBlockNumber(), { label: "getBlockNumber" });

  const found: string[] = [];
  for (let from = fromBlock; from <= latest; from += BLOCK_WINDOW) {
    const to = from + BLOCK_WINDOW - 1n > latest ? latest : from + BLOCK_WINDOW - 1n;

    const textLogs = await withRetry(
      () =>
        publicClient.getLogs({
          address,
          event: textEvent,
          fromBlock: from,
          toBlock: to,
        }),
      { label: `getLogs ResolutionText ${from}-${to}` }
    );
    for (const log of textLogs) {
      found.push(`  ResolutionText(market ${log.args.id}): "${log.args.text}"`);
    }

    const resolvedLogs = await withRetry(
      () =>
        publicClient.getLogs({
          address,
          event: resolvedEvent,
          fromBlock: from,
          toBlock: to,
        }),
      { label: `getLogs MarketResolved ${from}-${to}` }
    );
    for (const log of resolvedLogs) {
      found.push(`  MarketResolved(market ${log.args.id}): ${OUTCOMES[Number(log.args.outcome)]}`);
    }
  }

  return found;
}

/**
 * Diagnoses a market resolution by inspecting request payload, platform request
 * state, and emitted market events.
 */
async function main() {
  const { viem } = await network.create();
  const publicClient = (await viem.getPublicClient()) as unknown as PublicClient;

  const { TruthMarket: address } = loadDeployed();

  let marketId: bigint;
  try {
    const { marketIds } = loadMarkets(address);
    marketId = BigInt(process.env.MARKET_ID ?? marketIds[0]);
  } catch {
    marketId = BigInt(process.env.MARKET_ID ?? "1");
  }

  console.log("=".repeat(70));
  console.log(`TruthMarket contract: ${address}`);
  console.log(`Market analyzed:      #${marketId}`);
  console.log("=".repeat(70));

  const contract = await viem.getContractAt("TruthMarket", address);
  const market = await withRetry(
    () => contract.read.markets([marketId]) as Promise<MarketTuple>,
    { label: `markets(${marketId})` }
  );
  const requestId = market[5];
  const kind = market[8];

  console.log("\n[MARKET STATE]");
  console.log(`  question : "${market[0]}"`);
  console.log(`  kind     : ${KINDS[kind] ?? `unknown(${kind})`}`);
  console.log(`  outcome  : ${OUTCOMES[market[4]]}`);
  console.log(`  requestId: ${requestId}`);

  if (requestId === 0n) {
    console.log("\nWarning: requestId == 0. resolveMarket was not executed for this market.");
    return;
  }

  const expectedSelector = toFunctionSelector("inferString(string,string,bool,string[])");
  console.log(`\n[EXPECTED inferString SELECTOR]: ${expectedSelector}`);

  const resolveTx = process.env.RESOLVE_TX as `0x${string}` | undefined;
  let resolveBlock = 0n;

  if (resolveTx) {
    const receipt = await withRetry(
      () => publicClient.getTransactionReceipt({ hash: resolveTx }),
      { label: `getTransactionReceipt(${resolveTx})` }
    );
    resolveBlock = receipt.blockNumber;

    const created = parseEventLogs({
      abi: [
        parseAbiItem(
          "event RequestCreated(uint256 indexed requestId, uint256 indexed agentId, uint256 perAgentBudget, bytes payload, address[] subcommittee)"
        ),
      ],
      logs: receipt.logs,
    });

    if (created.length > 0) {
      const event = created[0].args;
      console.log(`\n[RequestCreated @ block ${resolveBlock}]`);
      console.log(`  agentId        : ${event.agentId}`);
      console.log(`  perAgentBudget : ${formatEther(event.perAgentBudget!)} STT`);
      console.log(`  subcommittee   : ${event.subcommittee!.length} validators`);

      const payload = event.payload as `0x${string}`;
      const sentSelector = payload.slice(0, 10);
      const selectorOk = sentSelector === expectedSelector ? "yes" : "no";
      console.log(`  payload selector: ${sentSelector} (matches inferString: ${selectorOk})`);

      try {
        const decoded = decodeFunctionData({ abi: LLM_ABI, data: payload });
        console.log(`  prompt        : "${decoded.args[0]}"`);
        console.log(`  system        : "${decoded.args[1]}"`);
        console.log(`  chainOfThought: ${decoded.args[2]}`);
        console.log(`  allowedValues : ${JSON.stringify(decoded.args[3])}`);
      } catch (error) {
        const message = (error as Error).message.split("\n")[0];
        console.log(`  Note: payload selector doesn't match inferString — likely a JSON API or Parse Website request (${message}).`);
      }
    }
  } else {
    console.log("\nTip: pass RESOLVE_TX=0x... to inspect RequestCreated payload details.");
  }

  console.log(`\n[Request on platform ${PLATFORM}]`);
  const exists = await withRetry(
    () =>
      publicClient.readContract({
        address: PLATFORM,
        abi: PLATFORM_ABI,
        functionName: "hasRequest",
        args: [requestId],
      }),
    { label: "platform.hasRequest" }
  );

  if (!exists) {
    console.log("  Warning: platform no longer has this requestId (possibly already purged).");
  } else {
    const req = await withRetry(
      () =>
        publicClient.readContract({
          address: PLATFORM,
          abi: PLATFORM_ABI,
          functionName: "getRequest",
          args: [requestId],
        }),
      { label: "platform.getRequest" }
    );

    console.log(`  status global  : ${RESPONSE_STATUS[Number(req.status)]} (${req.status})`);
    console.log(`  subcommittee   : ${req.subcommittee.length} validators`);
    console.log(`  responseCount  : ${req.responseCount}`);
    console.log(`  failureCount   : ${req.failureCount}`);
    console.log(`  threshold      : ${req.threshold}`);
    console.log(`  perAgentBudget : ${formatEther(req.perAgentBudget)} STT`);
    console.log(`  remainingBudget: ${formatEther(req.remainingBudget)} STT`);

    console.log(`\n  Individual responses (${req.responses.length}):`);
    req.responses.forEach((response, index: number) => {
      console.log(`   [${index}] validator=${response.validator}`);
      console.log(
        `       status=${RESPONSE_STATUS[Number(response.status)]}  executionCost=${formatEther(response.executionCost)} STT`
      );
      const size = (response.result.length - 2) / 2;
      const preview = response.result.slice(0, 80);
      const suffix = response.result.length > 80 ? "..." : "";
      console.log(`       result(${size} bytes)=${preview}${suffix}`);
      if (response.result !== "0x") {
        console.log(`       decode -> ${tryDecodeString(response.result)}`);
      }
    });
  }

  const latestBlock = await withRetry(() => publicClient.getBlockNumber(), { label: "getBlockNumber" });
  const defaultFrom = latestBlock - 5000n;
  const scanFrom = resolveBlock > 0n ? resolveBlock : defaultFrom;
  console.log(`\n[Contract events from block ${scanFrom}]`);
  const events = await scanEvents(publicClient, address, scanFrom > 0n ? scanFrom : 0n);
  if (events.length === 0) {
    console.log("  (none found in scanned range)");
  } else {
    events.forEach((line) => console.log(line));
  }

  console.log("\n" + "=".repeat(70));
  console.log("INTERPRETATION:");
  console.log("  - status Failed/TimedOut usually indicates budget/agent runtime issues.");
  console.log("  - status Success + empty/weird result usually indicates model output quality.");
  console.log("  - missing ResolutionText means handleResolution likely took non-success path.");
  console.log("=".repeat(70));
}

main().catch(console.error);
