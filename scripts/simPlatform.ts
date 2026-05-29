import { network } from "hardhat";
import {
  encodeFunctionData,
  toFunctionSelector,
  encodeAbiParameters,
  formatEther,
} from "viem";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  PLATFORM,
  SCRIPTS_DIR,
  STAGE_TOPUP,
  computeResolveValue,
  getPlatformDeposit,
  KIND_WEB_FACT,
} from "./_lib.js";

/**
 * Agent selector accepted on the command line via `AGENT=...`. Determines
 * which of the 3 Somnia base agents we validate the wiring against.
 */
type AgentKey = "statement" | "price" | "web_fact";

const AGENT_ENV = (process.env.AGENT ?? "statement").toLowerCase();
const AGENT: AgentKey =
  AGENT_ENV === "price" || AGENT_ENV === "json" || AGENT_ENV === "jsonapi"
    ? "price"
    : AGENT_ENV === "web_fact" || AGENT_ENV === "webfact" || AGENT_ENV === "parse"
    ? "web_fact"
    : "statement";

/** Solidity selectors for each base agent's payload function. */
const INFER_STRING_SELECTOR = toFunctionSelector(
  "inferString(string,string,bool,string[])"
);
const FETCH_UINT_SELECTOR = toFunctionSelector(
  "fetchUint(string,string,uint8)"
);
const EXTRACT_STRING_SELECTOR = toFunctionSelector(
  "ExtractString(string,string,string[],string,string,bool,uint8,uint8)"
);

const platformAbi = [
  {
    name: "getRequestDeposit",
    type: "function" as const,
    stateMutability: "view" as const,
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "createRequest",
    type: "function" as const,
    stateMutability: "payable" as const,
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "callbackAddress", type: "address" },
      { name: "callbackSelector", type: "bytes4" },
      { name: "payload", type: "bytes" },
    ],
    outputs: [{ name: "requestId", type: "uint256" }],
  },
] as const;

/**
 * Returns the env var name and registered agent ID for the selected agent.
 * Throws a guiding error when the corresponding env var is missing.
 */
function resolveAgentId(): { envName: string; id: bigint; label: string; selector: `0x${string}` } {
  if (AGENT === "price") {
    const raw = process.env.JSON_API_AGENT_ID;
    if (!raw) {
      throw new Error(
        "JSON_API_AGENT_ID is not set. Add the JSON API Request agent ID to .env before running AGENT=price sim-platform."
      );
    }
    return { envName: "JSON_API_AGENT_ID", id: BigInt(raw), label: "JSON API Request", selector: FETCH_UINT_SELECTOR };
  }
  if (AGENT === "web_fact") {
    const raw = process.env.PARSE_AGENT_ID;
    if (!raw) {
      throw new Error(
        "PARSE_AGENT_ID is not set. Add the LLM Parse Website agent ID to .env before running AGENT=web_fact sim-platform."
      );
    }
    return { envName: "PARSE_AGENT_ID", id: BigInt(raw), label: "LLM Parse Website", selector: EXTRACT_STRING_SELECTOR };
  }
  const raw = process.env.LLM_AGENT_ID;
  if (!raw) {
    throw new Error(
      "LLM_AGENT_ID is not set. Add the LLM Inference agent ID to .env before running sim-platform."
    );
  }
  return { envName: "LLM_AGENT_ID", id: BigInt(raw), label: "LLM Inference", selector: INFER_STRING_SELECTOR };
}

/**
 * Builds the payload calldata that the platform would forward to the agent.
 * Each base agent has its own ABI signature, mirroring TruthMarket.sol's
 * `resolveMarket` branches.
 */
function buildPayload(selector: `0x${string}`): `0x${string}` {
  if (selector === FETCH_UINT_SELECTOR) {
    // fetchUint(url, selector, decimals)
    const args = encodeAbiParameters(
      [{ type: "string" }, { type: "string" }, { type: "uint8" }],
      [
        "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
        "bitcoin.usd",
        0,
      ]
    );
    return (selector + args.slice(2)) as `0x${string}`;
  }
  if (selector === EXTRACT_STRING_SELECTOR) {
    // ExtractString(key, description, options[], prompt, url, resolveUrl, numPages, confidenceThreshold)
    const args = encodeAbiParameters(
      [
        { type: "string" },
        { type: "string" },
        { type: "string[]" },
        { type: "string" },
        { type: "string" },
        { type: "bool" },
        { type: "uint8" },
        { type: "uint8" },
      ],
      [
        "evidence",
        "Bitcoin was created by a person or group under the name Satoshi Nakamoto.",
        [],
        "Bitcoin was created by a person or group under the name Satoshi Nakamoto.",
        "https://en.wikipedia.org/wiki/Bitcoin",
        true,
        3,
        70,
      ]
    );
    return (selector + args.slice(2)) as `0x${string}`;
  }
  // inferString(prompt, system, chainOfThought, allowedValues)
  const args = encodeAbiParameters(
    [{ type: "string" }, { type: "string" }, { type: "bool" }, { type: "string[]" }],
    [
      "Is the following statement factually true? Answer YES, NO, or UNKNOWN. Statement: 2 + 2 equals 4.",
      "You are a precise fact-checking oracle. Respond with exactly one of the allowed values.",
      false,
      ["YES", "NO", "UNKNOWN"],
    ]
  );
  return (selector + args.slice(2)) as `0x${string}`;
}

/**
 * Simulates `platform.createRequest` to validate agent ID and payload wiring.
 * Works both pre-deploy and post-deploy.
 *
 * Run via `AGENT=statement|price|web_fact npm run sim-platform`. Defaults to
 * STATEMENT (LLM Inference) to preserve prior behavior.
 */
async function main() {
  const { viem } = await network.create();
  const publicClient = await viem.getPublicClient();
  const [wallet] = await viem.getWalletClients();

  const agent = resolveAgentId();
  console.log(`Agent under test: ${agent.label} (${agent.envName}=${agent.id})`);

  const deployedPath = join(SCRIPTS_DIR, "deployed.json");
  const deployedExists = existsSync(deployedPath);
  const deployed = deployedExists ? JSON.parse(readFileSync(deployedPath, "utf-8")) : null;

  // Use deployed TruthMarket callback when available. If this is a pre-deploy
  // check, fallback to a safe callback target so we can still validate
  // platform + agent ID wiring without requiring deployed.json.
  const callbackAddress =
    (process.env.CALLBACK_ADDRESS as `0x${string}` | undefined) ??
    (deployed?.TruthMarket as `0x${string}` | undefined) ??
    PLATFORM;
  let callbackSelector: `0x${string}` = "0x12345678";

  if (deployed?.TruthMarket) {
    const contract = await viem.getContractAt("TruthMarket", deployed.TruthMarket as `0x${string}`);
    // Each market kind has its own callback. Use the one that matches the
    // selected agent so the simulation routes calldata exactly like the real
    // resolveMarket() branch would.
    const callbackName =
      AGENT === "price" ? "handlePriceResolution" :
      AGENT === "web_fact" ? "handleEvidence" :
      "handleResolution";
    const item = (contract.abi as unknown as Array<{ type?: string; name?: string }>).find(
      (i) => i.type === "function" && i.name === callbackName
    );
    if (item) {
      callbackSelector = toFunctionSelector(item as Parameters<typeof toFunctionSelector>[0]);
    }
    console.log(`callback   : ${callbackName} (${callbackSelector})`);
  }

  const payload = buildPayload(agent.selector);
  const deposit = await getPlatformDeposit(publicClient);
  // For STATEMENT/PRICE single-stage: deposit + 1 topup (~1.2 STT).
  // For WEB_FACT: simulate stage 1 only here (Parse) — needs deposit + 1 topup
  // because the LLM stage 2 reservation happens inside resolveMarket, not in
  // this dry-run.
  const value =
    AGENT === "web_fact" ? deposit + STAGE_TOPUP : computeResolveValue(0, deposit);

  console.log(`callbackAddress: ${callbackAddress}`);
  console.log(`Simulating platform.createRequest from EOA ${wallet.account.address}`);
  if (!deployedExists) {
    console.log("Note: scripts/deployed.json not found. Running pre-deploy simulation mode.");
    console.log(`Using callback fallback: ${callbackAddress} with selector ${callbackSelector}`);
    console.log("Tip: set CALLBACK_ADDRESS=0x... to override callback fallback.");
  }
  console.log(`deposit       : ${formatEther(deposit)} STT`);
  console.log(`value sent    : ${formatEther(value)} STT (${value} wei)\n`);

  // Reference KIND_WEB_FACT so an importer can see at a glance which constant
  // we map AGENT="web_fact" to without grepping _lib.ts.
  void KIND_WEB_FACT;

  const data = encodeFunctionData({
    abi: platformAbi,
    functionName: "createRequest",
    args: [agent.id, callbackAddress, callbackSelector, payload],
  });

  try {
    const res = await publicClient.call({
      account: wallet.account.address,
      to: PLATFORM,
      data,
      value,
    });
    console.log(`✅ platform.createRequest simulate OK for ${agent.label}. return: ${res.data}`);
  } catch (err) {
    const walk = typeof (err as { walk?: () => unknown })?.walk === "function"
      ? (err as { walk: () => { data?: string } }).walk()
      : null;
    console.log(`✗ platform.createRequest reverted for ${agent.label}.`);
    console.log("  walk.data:", walk?.data);
    console.log(
      "  raw:",
      ((err as { message?: string })?.message ?? String(err)).slice(0, 600)
    );
  }
}

main().catch(console.error);
