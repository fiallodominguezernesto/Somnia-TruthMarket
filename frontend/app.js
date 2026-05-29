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
    name: "createPriceMarket",
    stateMutability: "payable",
    inputs: [
      { name: "question", type: "string" },
      { name: "deadline", type: "uint256" },
      { name: "apiUrl", type: "string" },
      { name: "jsonSelector", type: "string" },
      { name: "decimals", type: "uint8" },
      { name: "target", type: "uint256" },
      { name: "comparator", type: "uint8" },
    ],
    outputs: [{ name: "id", type: "uint256" }],
  },
  {
    type: "function",
    name: "createWebFactMarket",
    stateMutability: "payable",
    inputs: [
      { name: "question", type: "string" },
      { name: "deadline", type: "uint256" },
      { name: "sourceUrl", type: "string" },
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
      { name: "bounty", type: "uint256" },
      { name: "resolver", type: "address" },
      { name: "kind", type: "uint8" },
      { name: "apiUrl", type: "string" },
      { name: "jsonSelector", type: "string" },
      { name: "decimals", type: "uint8" },
      { name: "target", type: "uint256" },
      { name: "comparator", type: "uint8" },
      { name: "sourceUrl", type: "string" },
      { name: "resolveBudget", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "evidence",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
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
const KINDS = ["STATEMENT", "PRICE", "WEB_FACT"];
const COMPARATORS = [">", ">=", "<", "<="];

// Budget on top of getRequestDeposit() so the agent subcommittee can run.
// Too little here makes the agent fail and the market resolves UNKNOWN.
// WEB_FACT needs ~2x the top-up because resolution chains two agent calls
// (Parse Website -> LLM Inference). The contract reserves ~1.2 STT for the
// chained LLM stage and the script must also fund the Parse Website stage,
// so we send `2 * deposit + 2.4 STT` total (~1.2 STT topup per stage).
const RESOLVE_TOPUP = parseEther("1.2");
const RESOLVE_TOPUP_WEB_FACT = parseEther("2.4");

// Minimum creation fee enforced by the contract (MIN_CREATION_FEE). The fee
// becomes the resolver bounty for that market.
const MIN_CREATION_FEE = parseEther("0.02");

// Auto-refresh polling interval for the keeper-watch view.
const AUTO_REFRESH_MS = 5000;

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
  marketKind: $("marketKind"),
  question: $("question"),
  priceFields: $("priceFields"),
  webFactFields: $("webFactFields"),
  apiUrl: $("apiUrl"),
  jsonSelector: $("jsonSelector"),
  decimals: $("decimals"),
  target: $("target"),
  comparator: $("comparator"),
  sourceUrl: $("sourceUrl"),
  deadlineSeconds: $("deadlineSeconds"),
  feeAmount: $("feeAmount"),
  betMarketId: $("betMarketId"),
  side: $("side"),
  betAmount: $("betAmount"),
  actionMarketId: $("actionMarketId"),
  inspectMarketId: $("inspectMarketId"),
  marketView: $("marketView"),
  autoRefreshBtn: $("autoRefreshBtn"),
  refreshState: $("refreshState"),
  log: $("log"),
};

els.address.value = contractAddress;

/**
 * Shows the extra input fields that match the selected market kind.
 * STATEMENT needs nothing extra, PRICE needs the JSON API config and
 * WEB_FACT needs the source URL the Parse Website agent will read.
 */
function syncMarketKindFields() {
  const kind = els.marketKind.value;
  els.priceFields.style.display = kind === "price" ? "" : "none";
  els.webFactFields.style.display = kind === "web_fact" ? "" : "none";
}

els.marketKind.addEventListener("change", syncMarketKindFields);
syncMarketKindFields();

/**
 * Prepends a timestamped line to the UI log panel.
 */
function log(message) {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  els.log.textContent = `${line}\n${els.log.textContent}`.trim();
}

/**
 * Validates and returns the configured TruthMarket contract address.
 */
function requireAddress() {
  const value = els.address.value.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error("Set a valid contract address first.");
  }
  contractAddress = value;
  return value;
}

/**
 * Ensures an injected wallet is connected before write actions.
 */
function requireWallet() {
  if (!walletClient || !account) {
    throw new Error("Connect wallet first.");
  }
}

/**
 * Returns a viem contract client bound to current address and wallet.
 */
function getContractClient() {
  const address = requireAddress();
  return getContract({
    address,
    abi: truthMarketAbi,
    client: { public: publicClient, wallet: walletClient },
  });
}

/**
 * Waits for transaction finality and logs the mined block number.
 */
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
    const kind = els.marketKind.value;
    const question = els.question.value.trim();
    if (!question) throw new Error("Question cannot be empty.");
    const secs = Number(els.deadlineSeconds.value);
    if (!Number.isFinite(secs) || secs < 10) throw new Error("Deadline seconds must be >= 10.");
    const fee = parseEther(els.feeAmount.value || "0.02");
    if (fee < MIN_CREATION_FEE) throw new Error("Bounty must be at least 0.02 STT.");
    const deadline = BigInt(Math.floor(Date.now() / 1000) + secs);

    let hash;
    if (kind === "price") {
      const apiUrl = els.apiUrl.value.trim();
      const jsonSelector = els.jsonSelector.value.trim();
      if (!apiUrl) throw new Error("API URL cannot be empty for a PRICE market.");
      if (!jsonSelector) throw new Error("JSON selector cannot be empty for a PRICE market.");
      const decimals = Number(els.decimals.value || "0");
      if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
        throw new Error("Decimals must be an integer between 0 and 18.");
      }
      const target = BigInt(els.target.value);
      const comparator = Number(els.comparator.value);
      hash = await contract.write.createPriceMarket(
        [question, deadline, apiUrl, jsonSelector, decimals, target, comparator],
        { account, value: fee },
      );
      log(`PRICE market: ${apiUrl} [${jsonSelector}] ${COMPARATORS[comparator]} ${target} (10^${decimals}).`);
    } else if (kind === "web_fact") {
      const sourceUrl = els.sourceUrl.value.trim();
      if (!sourceUrl) throw new Error("Source URL cannot be empty for a WEB_FACT market.");
      hash = await contract.write.createWebFactMarket(
        [question, deadline, sourceUrl],
        { account, value: fee },
      );
      log(`WEB_FACT market: Parse Website will read ${sourceUrl}, then LLM judges it.`);
    } else {
      hash = await contract.write.createMarket([question, deadline], { account, value: fee });
    }

    await waitTx(hash);
    log(`${KINDS[["statement", "price", "web_fact"].indexOf(kind)]} market created with ${formatEther(fee)} STT resolver bounty.`);
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
    const market = await contract.read.markets([marketId]);
    const kind = Number(market[8]);
    const deposit = await publicClient.readContract({
      address: PLATFORM,
      abi: platformAbi,
      functionName: "getRequestDeposit",
    });
    // WEB_FACT chains Parse Website (stage 1) -> LLM Inference (stage 2). The
    // contract reserves a stage-2 LLM budget of `deposit + 1.2 STT`, so the
    // caller must send `2 * deposit + 2.4 STT` total to leave Parse with a
    // real budget after the reserve. STATEMENT/PRICE single-stage flows just
    // need `deposit + 1.2 STT`.
    const value =
      kind === 2
        ? deposit * 2n + RESOLVE_TOPUP_WEB_FACT
        : deposit + RESOLVE_TOPUP;
    const topupLabel = kind === 2
      ? `${formatEther(RESOLVE_TOPUP_WEB_FACT)} STT split across 2 stages`
      : `${formatEther(RESOLVE_TOPUP)} STT`;
    log(`${KINDS[kind] || "market"} resolve: deposit ${formatEther(deposit)} + top-up ${topupLabel} = ${formatEther(value)} STT`);
    const hash = await contract.write.resolveMarket([marketId], { account, value });
    await waitTx(hash);
    log(`Resolution requested for market #${marketId}. Wait for async agent callback.`);
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

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Derives a user-friendly market status string from market fields.
 */
function resolutionStatus(outcome, requestId, deadline, resolver) {
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (Number(outcome) !== 0) {
    const by = resolver && resolver !== ZERO_ADDRESS ? ` (resolved by ${resolver})` : "";
    return `Settled${by}`;
  }
  if (requestId !== 0n) return "Resolution requested — awaiting agent callback";
  if (deadline > 0n && now >= deadline) return "Expired — awaiting keeper/agent to resolve";
  return "Open — accepting bets";
}

/**
 * Loads market state plus current account bets and renders a JSON snapshot.
 */
async function loadMarket(marketId) {
  const contract = getContractClient();
  const market = await contract.read.markets([marketId]);

  let yesBet = 0n;
  let noBet = 0n;
  if (account) {
    [yesBet, noBet] = await Promise.all([
      contract.read.yesBets([marketId, account]),
      contract.read.noBets([marketId, account]),
    ]);
  }

  const [
    question,
    deadline,
    yesPool,
    noPool,
    outcome,
    requestId,
    bounty,
    resolver,
    kind,
    apiUrl,
    jsonSelector,
    decimals,
    target,
    comparator,
    sourceUrl,
  ] = market;

  const snapshot = {
    marketId: marketId.toString(),
    kind: KINDS[Number(kind)] || "Unknown",
    question,
    status: resolutionStatus(outcome, requestId, deadline, resolver),
    deadlineLocal: new Date(Number(deadline) * 1000).toLocaleString(),
    yesPoolSTT: formatEther(yesPool),
    noPoolSTT: formatEther(noPool),
    totalPoolSTT: formatEther(yesPool + noPool),
    outcome: OUTCOMES[Number(outcome)] || "Unknown",
    bountySTT: formatEther(bounty),
    resolver: resolver === ZERO_ADDRESS ? "none yet" : resolver,
    requestId: requestId.toString(),
    account: account || "not connected",
    yourYesBetSTT: formatEther(yesBet),
    yourNoBetSTT: formatEther(noBet),
  };

  if (Number(kind) === 1) {
    snapshot.priceFeed = apiUrl;
    snapshot.jsonSelector = jsonSelector;
    snapshot.condition = `value ${COMPARATORS[Number(comparator)] || "?"} ${target.toString()} (scaled 10^${Number(decimals)})`;
  } else if (Number(kind) === 2) {
    snapshot.sourceUrl = sourceUrl;
    try {
      const extracted = await contract.read.evidence([marketId]);
      snapshot.evidence = extracted && extracted.length ? extracted : "(not extracted yet)";
    } catch (error) {
      snapshot.evidence = "(unavailable)";
    }
  }

  els.marketView.textContent = JSON.stringify(snapshot, null, 2);
  return { outcome: Number(outcome), requestId };
}

$("inspectBtn").addEventListener("click", async () => {
  try {
    const marketId = BigInt(els.inspectMarketId.value);
    await loadMarket(marketId);
    log(`Loaded market #${marketId}.`);
  } catch (error) {
    log(`Load failed: ${error.message}`);
  }
});

let autoRefreshTimer = null;
let lastSeenOutcome = null;

/**
 * Stops auto-refresh polling and resets watcher labels.
 */
function stopAutoRefresh() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  autoRefreshTimer = null;
  lastSeenOutcome = null;
  els.autoRefreshBtn.textContent = "Auto-refresh: OFF";
  els.refreshState.textContent = "Turn on auto-refresh to watch the keeper resolve this market live.";
}

/**
 * Starts periodic market refresh and auto-stops once outcome is settled.
 */
function startAutoRefresh() {
  let marketId;
  try {
    requireAddress();
    marketId = BigInt(els.inspectMarketId.value);
  } catch (error) {
    log(`Auto-refresh failed: ${error.message}`);
    return;
  }

  els.autoRefreshBtn.textContent = "Auto-refresh: ON";
  els.refreshState.textContent = `Watching market #${marketId} every ${AUTO_REFRESH_MS / 1000}s for autonomous resolution...`;
  log(`Auto-refresh ON for market #${marketId}.`);

  const tick = async () => {
    try {
      const { outcome } = await loadMarket(marketId);
      if (lastSeenOutcome !== null && outcome !== lastSeenOutcome && outcome !== 0) {
        log(`Market #${marketId} resolved autonomously → ${OUTCOMES[outcome] || outcome}`);
        els.refreshState.textContent = `Market #${marketId} settled → ${OUTCOMES[outcome] || outcome}. Auto-refresh stopped.`;
        stopAutoRefresh();
        return;
      }
      lastSeenOutcome = outcome;
    } catch (error) {
      log(`Auto-refresh tick failed: ${error.message}`);
    }
  };

  tick();
  autoRefreshTimer = setInterval(tick, AUTO_REFRESH_MS);
}

els.autoRefreshBtn.addEventListener("click", () => {
  if (autoRefreshTimer) {
    stopAutoRefresh();
    log("Auto-refresh OFF.");
  } else {
    startAutoRefresh();
  }
});

log("UI ready. Connect wallet, set address, then interact.");
