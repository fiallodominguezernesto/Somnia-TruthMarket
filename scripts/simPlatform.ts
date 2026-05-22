import { network } from "hardhat";
import {
  parseEther,
  encodeFunctionData,
  toFunctionSelector,
  encodeAbiParameters,
} from "viem";
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PLATFORM = "0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776" as const;
// Set LLM_AGENT_ID in .env to the real ID from the Agent Explorer to verify it
// before deploying.
const agentIdRaw = process.env.LLM_AGENT_ID;
if (!agentIdRaw) {
  throw new Error(
    "LLM_AGENT_ID is not set. Add the real LLM Inference ID to .env before running sim-platform."
  );
}
const LLM_AGENT_ID = BigInt(agentIdRaw);

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

// inferString(string,string,bool,string[]) selector
const inferStringSelector = toFunctionSelector(
  "inferString(string,string,bool,string[])"
);
// handleResolution(uint256,(address,bytes,uint8,uint256,uint256,uint256)[],uint8,(...)) — only the selector matters here.
// We reuse the deployed contract ABI to get the exact selector.

async function main() {
  const { viem } = await network.create();
  const publicClient = await viem.getPublicClient();
  const [wallet] = await viem.getWalletClients();

  const deployedPath = join(__dirname, "deployed.json");
  const deployedExists = existsSync(deployedPath);
  const deployed = deployedExists
    ? JSON.parse(readFileSync(deployedPath, "utf-8"))
    : null;

  // Use deployed TruthMarket callback when available. If this is a pre-deploy
  // check, fallback to a safe callback target so we can still validate
  // platform + agent ID wiring without requiring deployed.json.
  let callbackAddress =
    (process.env.CALLBACK_ADDRESS as `0x${string}` | undefined) ??
    (deployed?.TruthMarket as `0x${string}` | undefined) ??
    PLATFORM;
  let callbackSelector: `0x${string}` = "0x12345678";

  if (deployed?.TruthMarket) {
    const contract = await viem.getContractAt("TruthMarket", deployed.TruthMarket as `0x${string}`);
    const handleResolutionItem = (contract.abi as any[]).find(
      (i) => i.type === "function" && i.name === "handleResolution"
    );
    callbackSelector = toFunctionSelector(handleResolutionItem);
  }

  const payload = (inferStringSelector +
    encodeAbiParameters(
      [
        { type: "string" },
        { type: "string" },
        { type: "bool" },
        { type: "string[]" },
      ],
      [
        "Is the following statement factually true? Answer YES, NO, or UNKNOWN. Statement: 2 + 2 equals 4.",
        "You are a precise fact-checking oracle. Respond with exactly one of the allowed values.",
        false,
        ["YES", "NO", "UNKNOWN"],
      ]
    ).slice(2)) as `0x${string}`;

  const deposit = (await publicClient.readContract({
    address: PLATFORM,
    abi: platformAbi,
    functionName: "getRequestDeposit",
  })) as bigint;
  const value = deposit + parseEther("1.2");

  console.log(`callbackSelector: ${callbackSelector}`);
  console.log(`Simulating platform.createRequest from EOA ${wallet.account.address}`);
  if (!deployedExists) {
    console.log("Note: scripts/deployed.json not found. Running pre-deploy simulation mode.");
    console.log(`Using callback fallback: ${callbackAddress} with selector ${callbackSelector}`);
    console.log("Tip: set CALLBACK_ADDRESS=0x... to override callback fallback.");
  }

  console.log(`callbackAddress: ${callbackAddress}, value: ${value} wei\n`);

  const data = encodeFunctionData({
    abi: platformAbi,
    functionName: "createRequest",
    args: [LLM_AGENT_ID, callbackAddress, callbackSelector, payload],
  });

  try {
    const res = await publicClient.call({
      account: wallet.account.address,
      to: PLATFORM,
      data,
      value,
    });
    console.log("✅ platform.createRequest simulate OK. return:", res.data);
  } catch (err: any) {
    const walk = typeof err?.walk === "function" ? err.walk() : null;
    console.log("✗ platform.createRequest reverted.");
    console.log("  walk.data:", walk?.data);
    console.log("  raw:", (err?.message ?? String(err)).slice(0, 600));
  }
}

main().catch(console.error);
