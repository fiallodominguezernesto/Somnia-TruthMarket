// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IAgentRequester.sol";

/// @title TruthMarket
/// @notice On-chain YES/NO prediction market settled through Somnia's agent platform.
/// @dev Markets are resolved asynchronously by calling the platform and handling
/// the callback in `handleResolution`.
contract TruthMarket {
    // Real LLM Inference agent ID from the Somnia Agent Explorer
    // (https://agents.testnet.somnia.network). Set at deploy time — using an
    // unregistered ID makes platform.createRequest revert with no reason.
    /// @notice LLM Inference agent ID registered in Somnia platform.
    uint256 public immutable llmAgentId;
    /// @notice JSON API Request agent ID registered in Somnia platform.
    uint256 public immutable jsonApiAgentId;
    /// @notice Somnia platform contract used to create async requests.
    address constant PLATFORM = 0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776;
    /// @notice Minimum stake accepted by `placeBet`.
    uint256 constant MIN_BET = 0.01 ether;
    /// @notice Minimum fee accepted by `createMarket` and assigned as bounty.
    uint256 constant MIN_CREATION_FEE = 0.02 ether;

    /// @param _llmAgentId LLM Inference agent ID from Somnia Agent Explorer.
    /// @param _jsonApiAgentId JSON API Request agent ID from Somnia Agent Explorer.
    constructor(uint256 _llmAgentId, uint256 _jsonApiAgentId) {
        require(_llmAgentId != 0, "LLM agent ID required");
        require(_jsonApiAgentId != 0, "JSON agent ID required");
        llmAgentId = _llmAgentId;
        jsonApiAgentId = _jsonApiAgentId;
    }

    /// @notice Market lifecycle and settlement outcome.
    enum Outcome { Open, YES, NO, UNKNOWN }

    /// @notice Resolution strategy and agent used to settle a market.
    /// STATEMENT: LLM Inference judges a factual statement.
    /// PRICE: JSON API Request fetches a number and compares it to a target.
    enum MarketKind { STATEMENT, PRICE }

    /// @notice Comparator applied to PRICE markets: fetched value CMP target -> YES.
    /// 0: >, 1: >=, 2: <, 3: <=
    enum Comparator { GT, GTE, LT, LTE }

    /// @notice Market state tracked on-chain.
    struct Market {
        string question;
        uint256 deadline;
        uint256 yesPool;
        uint256 noPool;
        Outcome outcome;
        uint256 requestId;
        uint256 bounty;     // resolver reward, funded by creation fee — separate from pools
        address resolver;   // whoever triggered resolution
        MarketKind kind;    // resolution strategy / agent
        // PRICE markets only:
        string apiUrl;      // public JSON endpoint
        string jsonSelector; // JSON-path-like selector, e.g. "bitcoin.usd"
        uint8 decimals;     // scale applied by fetchUint
        uint256 target;     // threshold compared against fetched value (scaled to `decimals`)
        Comparator comparator; // comparison applied: fetched CMP target -> YES
    }

    uint256 public marketCount;
    mapping(uint256 => Market) public markets;
    mapping(uint256 => mapping(address => uint256)) public yesBets;
    mapping(uint256 => mapping(address => uint256)) public noBets;
    mapping(uint256 => uint256) public requestToMarket;

    event MarketCreated(uint256 indexed id, string question, uint256 deadline, uint256 bounty);
    event BetPlaced(uint256 indexed id, address indexed bettor, bool isYes, uint256 amount);
    event MarketResolved(uint256 indexed id, Outcome outcome);
    event ResolutionText(uint256 indexed id, string text);
    event ResolutionData(uint256 indexed id, uint256 value);
    event BountyPaid(uint256 indexed id, address indexed resolver, uint256 amount);
    event Claimed(uint256 indexed id, address indexed bettor, uint256 amount);

    /// @notice Creates a new STATEMENT market settled by the LLM Inference agent.
    /// @param question Factual statement to resolve as YES/NO/UNKNOWN.
    /// @param deadline Unix timestamp when betting closes and resolution can begin.
    /// @return id Newly created market ID.
    function createMarket(string calldata question, uint256 deadline) external payable returns (uint256 id) {
        require(deadline > block.timestamp, "Past deadline");
        require(msg.value >= MIN_CREATION_FEE, "Creation fee");
        id = ++marketCount;
        markets[id].question = question;
        markets[id].deadline = deadline;
        markets[id].bounty = msg.value;
        markets[id].kind = MarketKind.STATEMENT;
        emit MarketCreated(id, question, deadline, msg.value);
    }

    /// @notice Creates a PRICE market settled deterministically by the JSON API agent.
    /// @dev Resolution fetches `apiUrl`/`jsonSelector` (scaled by `decimals`) and
    /// settles YES when `value comparator target` holds, NO otherwise.
    /// @param question Human-readable description of the price condition.
    /// @param deadline Unix timestamp when betting closes and resolution can begin.
    /// @param apiUrl Public JSON endpoint to query.
    /// @param jsonSelector JSON-path-like selector, e.g. "bitcoin.usd".
    /// @param decimals Decimal scale applied by `fetchUint`.
    /// @param target Threshold compared against the fetched value (scaled to `decimals`).
    /// @param comparator Comparison applied: fetched CMP target -> YES.
    /// @return id Newly created market ID.
    function createPriceMarket(
        string calldata question,
        uint256 deadline,
        string calldata apiUrl,
        string calldata jsonSelector,
        uint8 decimals,
        uint256 target,
        Comparator comparator
    ) external payable returns (uint256 id) {
        require(deadline > block.timestamp, "Past deadline");
        require(msg.value >= MIN_CREATION_FEE, "Creation fee");
        require(bytes(apiUrl).length > 0, "apiUrl required");
        require(bytes(jsonSelector).length > 0, "selector required");
        id = ++marketCount;
        Market storage m = markets[id];
        m.question = question;
        m.deadline = deadline;
        m.bounty = msg.value;
        m.kind = MarketKind.PRICE;
        m.apiUrl = apiUrl;
        m.jsonSelector = jsonSelector;
        m.decimals = decimals;
        m.target = target;
        m.comparator = comparator;
        emit MarketCreated(id, question, deadline, msg.value);
    }

    /// @notice Places a YES or NO bet on an open market.
    /// @param marketId Target market ID.
    /// @param isYes True for YES side, false for NO side.
    function placeBet(uint256 marketId, bool isYes) external payable {
        require(msg.value >= MIN_BET, "Min 0.01 STT");
        Market storage m = markets[marketId];
        require(m.deadline > 0, "No market");
        require(m.outcome == Outcome.Open, "Not open");
        require(block.timestamp < m.deadline, "Expired");
        if (isYes) {
            m.yesPool += msg.value;
            yesBets[marketId][msg.sender] += msg.value;
        } else {
            m.noPool += msg.value;
            noBets[marketId][msg.sender] += msg.value;
        }
        emit BetPlaced(marketId, msg.sender, isYes, msg.value);
    }

    /// @notice Starts asynchronous resolution through Somnia platform.
    /// @dev Caller sends `getRequestDeposit()` plus optional top-up and receives
    /// the market bounty immediately as resolver incentive.
    /// @param marketId Target market ID.
    function resolveMarket(uint256 marketId) external payable {
        Market storage m = markets[marketId];
        require(m.deadline > 0, "No market");
        require(m.outcome == Outcome.Open, "Not open");
        require(block.timestamp >= m.deadline, "Not expired");
        require(m.requestId == 0, "Already resolving");

        IAgentRequester platform = IAgentRequester(PLATFORM);
        uint256 deposit = platform.getRequestDeposit();
        require(msg.value >= deposit, "Insufficient deposit");

        bytes memory payload;
        uint256 agentId;
        bytes4 selector;

        if (m.kind == MarketKind.PRICE) {
            // JSON API Request: fetch a number and compare it to the target.
            agentId = jsonApiAgentId;
            selector = this.handlePriceResolution.selector;
            payload = abi.encodeWithSelector(
                IJsonApiAgent.fetchUint.selector,
                m.apiUrl,
                m.jsonSelector,
                m.decimals
            );
        } else {
            // STATEMENT: LLM Inference judges the factual statement.
            agentId = llmAgentId;
            selector = this.handleResolution.selector;
            string[] memory allowed = new string[](3);
            allowed[0] = "YES";
            allowed[1] = "NO";
            allowed[2] = "UNKNOWN";
            payload = abi.encodeWithSelector(
                ILLMAgent.inferString.selector,
                string.concat(
                    "Is the following statement factually true? Answer YES, NO, or UNKNOWN. Statement: ",
                    m.question
                ),
                "You are a precise fact-checking oracle. Respond with exactly one of the allowed values.",
                false,
                allowed
            );
        }

        uint256 reqId = platform.createRequest{value: msg.value}(
            agentId,
            address(this),
            selector,
            payload
        );
        m.requestId = reqId;
        requestToMarket[reqId] = marketId;

        // Pay the resolver bounty: permissionless incentive for any agent to
        // trigger resolution of expired markets. Funded by the creation fee,
        // held separately from yes/no pools so claim accounting is unaffected.
        uint256 reward = m.bounty;
        m.bounty = 0;
        m.resolver = msg.sender;
        if (reward > 0) {
            emit BountyPaid(marketId, msg.sender, reward);
            (bool ok,) = msg.sender.call{value: reward}("");
            require(ok, "Bounty transfer failed");
        }
    }

    /// @notice Callback invoked by Somnia platform with LLM responses.
    /// @dev Only `PLATFORM` can call this function.
    /// @param requestId Platform request ID created in `resolveMarket`.
    /// @param responses Validator responses returned by the platform.
    /// @param status Global request status.
    function handleResolution(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        Request memory
    ) external {
        require(msg.sender == PLATFORM, "Unauthorized");
        uint256 marketId = requestToMarket[requestId];
        require(marketId != 0, "Unknown request");

        Market storage m = markets[marketId];
        Outcome outcome;

        if (status == ResponseStatus.Success && responses.length > 0) {
            string memory result = abi.decode(responses[0].result, (string));
            emit ResolutionText(marketId, result);
            if (keccak256(bytes(result)) == keccak256("YES")) {
                outcome = Outcome.YES;
            } else if (keccak256(bytes(result)) == keccak256("NO")) {
                outcome = Outcome.NO;
            } else {
                outcome = Outcome.UNKNOWN;
            }
        } else {
            outcome = Outcome.UNKNOWN;
        }

        m.outcome = outcome;
        emit MarketResolved(marketId, outcome);
    }

    /// @notice Callback invoked by Somnia platform with JSON API responses.
    /// @dev Only `PLATFORM` can call this function. Settles PRICE markets
    /// deterministically by comparing the fetched value to the target.
    /// @param requestId Platform request ID created in `resolveMarket`.
    /// @param responses Validator responses returned by the platform.
    /// @param status Global request status.
    function handlePriceResolution(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        Request memory
    ) external {
        require(msg.sender == PLATFORM, "Unauthorized");
        uint256 marketId = requestToMarket[requestId];
        require(marketId != 0, "Unknown request");

        Market storage m = markets[marketId];
        Outcome outcome;

        if (status == ResponseStatus.Success && responses.length > 0) {
            uint256 value = abi.decode(responses[0].result, (uint256));
            emit ResolutionData(marketId, value);
            outcome = _compare(value, m.comparator, m.target) ? Outcome.YES : Outcome.NO;
        } else {
            outcome = Outcome.UNKNOWN;
        }

        m.outcome = outcome;
        emit MarketResolved(marketId, outcome);
    }

    /// @notice Applies a PRICE market comparator: `value comparator target`.
    function _compare(uint256 value, Comparator c, uint256 target) internal pure returns (bool) {
        if (c == Comparator.GT) return value > target;
        if (c == Comparator.GTE) return value >= target;
        if (c == Comparator.LT) return value < target;
        return value <= target; // LTE
    }
    /// @dev For `UNKNOWN`, user gets refund of both sides. For YES/NO, payout is
    /// proportional to the winning pool.
    /// @param marketId Target market ID.
    function claim(uint256 marketId) external {
        Market storage m = markets[marketId];
        require(m.outcome != Outcome.Open, "Not resolved");

        uint256 totalPool = m.yesPool + m.noPool;
        uint256 payout;

        // Refund both sides on UNKNOWN, or when the winning pool is empty
        // (no winners to distribute to -> return every stake).
        bool refund = m.outcome == Outcome.UNKNOWN
            || (m.outcome == Outcome.YES && m.yesPool == 0)
            || (m.outcome == Outcome.NO && m.noPool == 0);

        if (refund) {
            uint256 yb = yesBets[marketId][msg.sender];
            uint256 nb = noBets[marketId][msg.sender];
            yesBets[marketId][msg.sender] = 0;
            noBets[marketId][msg.sender] = 0;
            payout = yb + nb;
        } else if (m.outcome == Outcome.YES) {
            uint256 bet = yesBets[marketId][msg.sender];
            yesBets[marketId][msg.sender] = 0;
            if (bet > 0) payout = (bet * totalPool) / m.yesPool;
        } else {
            uint256 bet = noBets[marketId][msg.sender];
            noBets[marketId][msg.sender] = 0;
            if (bet > 0) payout = (bet * totalPool) / m.noPool;
        }

        require(payout > 0, "Nothing to claim");
        emit Claimed(marketId, msg.sender, payout);
        (bool ok,) = msg.sender.call{value: payout}("");
        require(ok, "Transfer failed");
    }

    /// @notice Allows the contract to receive native STT.
    receive() external payable {}
}
