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
    /// @notice Somnia platform contract used to create async requests.
    address constant PLATFORM = 0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776;
    /// @notice Minimum stake accepted by `placeBet`.
    uint256 constant MIN_BET = 0.01 ether;
    /// @notice Minimum fee accepted by `createMarket` and assigned as bounty.
    uint256 constant MIN_CREATION_FEE = 0.02 ether;

    /// @param _llmAgentId LLM Inference agent ID from Somnia Agent Explorer.
    constructor(uint256 _llmAgentId) {
        require(_llmAgentId != 0, "Agent ID required");
        llmAgentId = _llmAgentId;
    }

    /// @notice Market lifecycle and settlement outcome.
    enum Outcome { Open, YES, NO, UNKNOWN }

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
    event BountyPaid(uint256 indexed id, address indexed resolver, uint256 amount);
    event Claimed(uint256 indexed id, address indexed bettor, uint256 amount);

    /// @notice Creates a new market and escrow the resolver bounty.
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

        string[] memory allowed = new string[](3);
        allowed[0] = "YES";
        allowed[1] = "NO";
        allowed[2] = "UNKNOWN";
        // Payload = calldata for inferString(prompt, system, chainOfThought, allowedValues)
        bytes memory payload = abi.encodeWithSelector(
            ILLMAgent.inferString.selector,
            string.concat(
                "Is the following statement factually true? Answer YES, NO, or UNKNOWN. Statement: ",
                m.question
            ),
            "You are a precise fact-checking oracle. Respond with exactly one of the allowed values.",
            false,
            allowed
        );

        uint256 reqId = platform.createRequest{value: msg.value}(
            llmAgentId,
            address(this),
            this.handleResolution.selector,
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

    /// @notice Claims payout for the caller after market settlement.
    /// @dev For `UNKNOWN`, user gets refund of both sides. For YES/NO, payout is
    /// proportional to the winning pool.
    /// @param marketId Target market ID.
    function claim(uint256 marketId) external {
        Market storage m = markets[marketId];
        require(m.outcome != Outcome.Open, "Not resolved");

        uint256 totalPool = m.yesPool + m.noPool;
        uint256 payout;

        if (m.outcome == Outcome.UNKNOWN) {
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
