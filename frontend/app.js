import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  formatEther,
  getContract,
  http,
  parseEther,
} from "https://esm.sh/viem@2.50.4";

const SOMNIA_RPC = "https://api.infra.testnet.somnia.network";
const PLATFORM = "0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776";

const somniaTestnet = defineChain({
  id: 50312,
  name: "Somnia Testnet",
  nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
  rpcUrls: {
    default: { http: [SOMNIA_RPC] },
    public: { http: [SOMNIA_RPC] },
  },
});

const truthMarketAbi = [
  {
    type: "function",
    name: "createMarket",
    stateMutability: "payable",
    inputs: [
      { name: "question", type: "string" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "id", type: "uint256" }],
  },
  {
    type: "function",
    name: "placeBet",
    stateMutability: "payable",
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "isYes", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "resolveMarket",
    stateMutability: "payable",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "markets",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "question", type: "string" },
      { name: "deadline", type: "uint256" },
      { name: "yesPool", type: "uint256" },
      { name: "noPool", type: "uint256" },
      { name: "outcome", type: "uint8" },
      { name: "requestId", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "yesBets",
    stateMutability: "view",
    inputs: [
      { name: "", type: "uint256" },
      { name: "", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "noBets",
    stateMutability: "view",
    inputs: [
      { name: "", type: "uint256" },
      { name: "", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
];

const platformAbi = [
  {
    type: "function",
    name: "getRequestDeposit",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
];

const OUTCOMES = ["Open", "YES", "NO", "UNKNOWN"];

const publicClient = createPublicClient({
  chain: somniaTestnet,
  transport: http(SOMNIA_RPC),
});

let walletClient;
let account;
let contractAddress = localStorage.getItem("truthMarketAddress") || "";

const $ = (id) => document.getElementById(id);

const els = {
  account: $("account"),
  address: $("contractAddress"),
  question: $("question"),
  deadlineSeconds: $("deadlineSeconds"),
  betMarketId: $("betMarketId"),
  side: $("side"),
  betAmount: $("betAmount"),
  actionMarketId: $("actionMarketId"),
  inspectMarketId: $("inspectMarketId"),
  marketView: $("marketView"),
  log: $("log"),
};

els.address.value = contractAddress;

function log(message) {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  els.log.textContent = `${line}\n${els.log.textContent}`.trim();
}

function requireAddress() {
  const value = els.address.value.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error("Set a valid contract address first.");
  }
  contractAddress = value;
  return value;
}

function requireWallet() {
  if (!walletClient || !account) {
    throw new Error("Connect wallet first.");
  }
}

function getContractClient() {
  const address = requireAddress();
  return getContract({
    address,
    abi: truthMarketAbi,
    client: { public: publicClient, wallet: walletClient },
  });
}

async function waitTx(hash) {
  log(`Waiting tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  log(`Confirmed in block ${receipt.blockNumber}`);
  return receipt;
}

$("connectBtn").addEventListener("click", async () => {
  try {
    if (!window.ethereum) {
      throw new Error("No injected wallet detected (MetaMask/Rabby).");
    }
    walletClient = createWalletClient({
      chain: somniaTestnet,
      transport: custom(window.ethereum),
    });
    const [selected] = await walletClient.requestAddresses();
    account = selected;
    els.account.textContent = account;
    log(`Connected: ${account}`);
  } catch (error) {
    log(`Connect failed: ${error.message}`);
  }
});

$("saveAddressBtn").addEventListener("click", () => {
  try {
    const address = requireAddress();
    localStorage.setItem("truthMarketAddress", address);
    log(`Saved contract address: ${address}`);
  } catch (error) {
    log(`Save failed: ${error.message}`);
  }
});

$("createBtn").addEventListener("click", async () => {
  try {
    requireWallet();
    const contract = getContractClient();
    const question = els.question.value.trim();
    if (!question) throw new Error("Question cannot be empty.");
    const secs = Number(els.deadlineSeconds.value);
    if (!Number.isFinite(secs) || secs < 10) throw new Error("Deadline seconds must be >= 10.");
    const deadline = BigInt(Math.floor(Date.now() / 1000) + secs);
    const hash = await contract.write.createMarket([question, deadline], { account });
    await waitTx(hash);
    log("Market created.");
  } catch (error) {
    log(`Create failed: ${error.message}`);
  }
});

$("betBtn").addEventListener("click", async () => {
  try {
    requireWallet();
    const contract = getContractClient();
    const marketId = BigInt(els.betMarketId.value);
    const isYes = els.side.value === "yes";
    const amount = parseEther(els.betAmount.value);
    const hash = await contract.write.placeBet([marketId, isYes], { account, value: amount });
    await waitTx(hash);
    log(`Bet placed on market #${marketId} (${isYes ? "YES" : "NO"}).`);
  } catch (error) {
    log(`Bet failed: ${error.message}`);
  }
});

$("resolveBtn").addEventListener("click", async () => {
  try {
    requireWallet();
    const contract = getContractClient();
    const marketId = BigInt(els.actionMarketId.value);
    const deposit = await publicClient.readContract({
      address: PLATFORM,
      abi: platformAbi,
      functionName: "getRequestDeposit",
    });
    log(`Platform deposit: ${formatEther(deposit)} STT`);
    const hash = await contract.write.resolveMarket([marketId], { account, value: deposit });
    await waitTx(hash);
    log(`Resolution requested for market #${marketId}. Wait for async callback.`);
  } catch (error) {
    log(`Resolve failed: ${error.message}`);
  }
});

$("claimBtn").addEventListener("click", async () => {
  try {
    requireWallet();
    const contract = getContractClient();
    const marketId = BigInt(els.actionMarketId.value);
    const hash = await contract.write.claim([marketId], { account });
    await waitTx(hash);
    log(`Claim submitted for market #${marketId}.`);
  } catch (error) {
    log(`Claim failed: ${error.message}`);
  }
});

$("inspectBtn").addEventListener("click", async () => {
  try {
    const contract = getContractClient();
    const marketId = BigInt(els.inspectMarketId.value);
    const market = await contract.read.markets([marketId]);

    let yesBet = 0n;
    let noBet = 0n;
    if (account) {
      [yesBet, noBet] = await Promise.all([
        contract.read.yesBets([marketId, account]),
        contract.read.noBets([marketId, account]),
      ]);
    }

    const [question, deadline, yesPool, noPool, outcome, requestId] = market;
    const snapshot = {
      marketId: marketId.toString(),
      question,
      deadlineUnix: deadline.toString(),
      deadlineLocal: new Date(Number(deadline) * 1000).toLocaleString(),
      yesPoolSTT: formatEther(yesPool),
      noPoolSTT: formatEther(noPool),
      totalPoolSTT: formatEther(yesPool + noPool),
      outcome: OUTCOMES[Number(outcome)] || "Unknown",
      requestId: requestId.toString(),
      account: account || "not connected",
      yourYesBetSTT: formatEther(yesBet),
      yourNoBetSTT: formatEther(noBet),
    };

    els.marketView.textContent = JSON.stringify(snapshot, null, 2);
    log(`Loaded market #${marketId}.`);
  } catch (error) {
    log(`Load failed: ${error.message}`);
  }
});

log("UI ready. Connect wallet, set address, then interact.");
