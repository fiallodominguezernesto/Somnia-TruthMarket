import { parseEther, type PublicClient } from "viem";
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

/** Resolved path of the scripts/ directory (works under ts-node ESM). */
export const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));

/** Somnia platform contract address (testnet + mainnet share the same address). */
export const PLATFORM = "0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776" as const;

/** Minimal platform ABI fragment used by scripts to read the request deposit. */
export const PLATFORM_DEPOSIT_ABI = [
  {
    name: "getRequestDeposit",
    type: "function" as const,
    stateMutability: "view" as const,
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** Human-readable market outcomes by enum index, matching TruthMarket.sol. */
export const OUTCOMES = ["Open", "YES", "NO", "UNKNOWN"] as const;

/** Human-readable market kinds by enum index, matching TruthMarket.sol. */
export const KINDS = ["STATEMENT", "PRICE", "WEB_FACT"] as const;

/** MarketKind enum index for WEB_FACT. */
export const KIND_WEB_FACT = 2;

/**
 * Full Market tuple as returned by `contract.read.markets([id])`. Field order
 * must match `struct Market` in contracts/TruthMarket.sol exactly.
 * [0]  question        string
 * [1]  deadline        uint256
 * [2]  yesPool         uint256
 * [3]  noPool          uint256
 * [4]  outcome         uint8  (Outcome enum)
 * [5]  requestId       uint256
 * [6]  bounty          uint256
 * [7]  resolver        address
 * [8]  kind            uint8  (MarketKind enum)
 * [9]  apiUrl          string
 * [10] jsonSelector    string
 * [11] decimals        uint8
 * [12] target          uint256
 * [13] comparator      uint8  (Comparator enum)
 * [14] sourceUrl       string
 * [15] resolveBudget   uint256
 */
export type MarketTuple = readonly [
  string,
  bigint,
  bigint,
  bigint,
  number,
  bigint,
  bigint,
  string,
  number,
  string,
  string,
  number,
  bigint,
  number,
  string,
  bigint,
];

/** Schema of scripts/deployed.json written by scripts/deploy.ts. */
export interface DeployedJson {
  TruthMarket: `0x${string}`;
  network: string;
  llmAgentId: string;
  jsonApiAgentId: string;
  parseAgentId: string;
}

/** Schema of scripts/markets.json written by scripts/createMarket.ts. */
export interface MarketsJson {
  address: `0x${string}`;
  marketIds: string[];
}

/**
 * Reads scripts/deployed.json and validates it has every field required by the
 * current contract. Throws a guiding error if the file is missing or stale so
 * scripts fail loudly instead of silently returning UNKNOWN later.
 */
export function loadDeployed(): DeployedJson {
  const path = join(SCRIPTS_DIR, "deployed.json");
  if (!existsSync(path)) {
    throw new Error(
      "scripts/deployed.json not found. Run `npm run deploy` first to deploy " +
        "the contract and write deployment metadata."
    );
  }
  let parsed: Partial<DeployedJson>;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    throw new Error(
      `scripts/deployed.json is not valid JSON: ${(error as Error).message}`
    );
  }
  const missing: string[] = [];
  if (!parsed.TruthMarket) missing.push("TruthMarket");
  if (!parsed.llmAgentId) missing.push("llmAgentId");
  if (!parsed.jsonApiAgentId) missing.push("jsonApiAgentId");
  if (!parsed.parseAgentId) missing.push("parseAgentId");
  if (missing.length > 0) {
    throw new Error(
      `scripts/deployed.json is stale (missing: ${missing.join(", ")}). ` +
        "This file was produced by an older version of the contract. " +
        "Re-run `npm run deploy` to regenerate it for the current 3-agent contract."
    );
  }
  return parsed as DeployedJson;
}

/**
 * Reads scripts/markets.json and validates it points to the same contract as
 * scripts/deployed.json. Catches the common bug of resolving/claiming against a
 * stale market list created against a prior deployment.
 */
export function loadMarkets(expectedAddress?: `0x${string}`): MarketsJson {
  const path = join(SCRIPTS_DIR, "markets.json");
  if (!existsSync(path)) {
    throw new Error(
      "scripts/markets.json not found. Run `npm run create-market` first."
    );
  }
  const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<MarketsJson>;
  if (!parsed.address || !Array.isArray(parsed.marketIds)) {
    throw new Error(
      "scripts/markets.json is malformed (expected { address, marketIds: [] })."
    );
  }
  if (expectedAddress && parsed.address.toLowerCase() !== expectedAddress.toLowerCase()) {
    throw new Error(
      `scripts/markets.json points to ${parsed.address} but scripts/deployed.json ` +
        `points to ${expectedAddress}. Re-run \`npm run create-market\` against the current deployment.`
    );
  }
  return parsed as MarketsJson;
}

/**
 * Reads the platform's required request deposit. Wrapped so scripts share one
 * code path and pick up retry/backoff behavior consistently.
 */
export async function getPlatformDeposit(publicClient: PublicClient): Promise<bigint> {
  return withRetry(
    () =>
      publicClient.readContract({
        address: PLATFORM,
        abi: PLATFORM_DEPOSIT_ABI,
        functionName: "getRequestDeposit",
      }) as Promise<bigint>,
    { label: "platform.getRequestDeposit" }
  );
}

/**
 * Returns true when an error looks like a transient RPC/network failure that
 * should be retried (HTTP 403/429/5xx, fetch failures, timeouts).
 */
function isTransientRpcError(error: unknown): boolean {
  const message = (error as { message?: string })?.message ?? String(error);
  if (!message) return false;
  const transient = [
    "403",
    "Forbidden",
    "429",
    "Too Many Requests",
    "500",
    "502",
    "503",
    "504",
    "fetch failed",
    "ECONNRESET",
    "ETIMEDOUT",
    "ENOTFOUND",
    "EAI_AGAIN",
    "socket hang up",
    "network connection",
    "request timed out",
    "HttpRequestError",
  ];
  return transient.some((needle) => message.includes(needle));
}

/**
 * Retries a thunk on transient RPC failures with exponential backoff. Non-RPC
 * errors (revert reasons, invalid params, etc.) propagate immediately so the
 * caller still sees real failures.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { attempts?: number; baseMs?: number; label?: string } = {}
): Promise<T> {
  const attempts = options.attempts ?? 5;
  const baseMs = options.baseMs ?? 800;
  const label = options.label ?? "rpc call";
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isTransientRpcError(error) || i === attempts - 1) throw error;
      const wait = baseMs * Math.pow(2, i);
      const message = (error as { shortMessage?: string; message?: string })?.shortMessage
        ?? (error as { message?: string })?.message
        ?? String(error);
      console.warn(
        `⚠️  ${label} failed (attempt ${i + 1}/${attempts}): ${message.split("\n")[0].slice(0, 160)}`
      );
      console.warn(`   retrying in ${wait}ms...`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastError;
}

/**
 * Per-validator topup budgeted by scripts on top of the platform deposit.
 * Mirrors the realistic per-validator agent cost. Together with
 * SUBCOMMITTEE_SIZE this produces the canonical 1.2 STT topup per stage.
 */
const TOPUP_PER_VALIDATOR_STT = "0.4";
const SUBCOMMITTEE_SIZE = 3;

/** Total topup per request stage (e.g. 0.4 * 3 = 1.2 STT). */
export const STAGE_TOPUP = parseEther(TOPUP_PER_VALIDATOR_STT) * BigInt(SUBCOMMITTEE_SIZE);

/**
 * Computes the canonical msg.value to send to `resolveMarket` for a given
 * market kind, mirroring the on-chain budget formula. WEB_FACT chains two
 * agents (Parse Website -> LLM Inference) so it needs roughly twice the
 * deposit plus a topup for each stage.
 *
 * Overridable per-script via RESOLVE_TOPUP_STT (treated as the topup PER
 * STAGE, applied to both stages of WEB_FACT). The WEB_FACT branch also
 * enforces a floor matching the contract's `require` so an aggressive
 * override can never underfund the on-chain LLM reservation and revert.
 */
export function computeResolveValue(kind: number, deposit: bigint): bigint {
  const topupOverride = process.env.RESOLVE_TOPUP_STT;
  const stageTopup = topupOverride ? parseEther(topupOverride) : STAGE_TOPUP;
  if (kind === KIND_WEB_FACT) {
    // Stage 1 (Parse Website) needs `deposit + stageTopup` and the contract
    // reserves `deposit + STAGE_TOPUP` for stage 2 (LLM Inference). Mirror
    // both budgets and clamp to the contract floor so the resolveMarket
    // `require(msg.value > llmBudget && msg.value - llmBudget >= deposit)`
    // can never trip.
    const contractFloor = deposit * 2n + STAGE_TOPUP + 1n;
    const desired = deposit * 2n + stageTopup * 2n;
    return desired > contractFloor ? desired : contractFloor;
  }
  return deposit + stageTopup;
}
