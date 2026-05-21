// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IAgentRequester.sol";

contract TruthMarket {
    uint256 constant LLM_AGENT_ID = 12847293847561029384;
    address constant PLATFORM = 0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776;
    uint256 constant MIN_BET = 0.01 ether;

    enum Outcome { Open, YES, NO, UNKNOWN }

    struct Market {
        string question;
        uint256 deadline;
        uint256 yesPool;
        uint256 noPool;
        Outcome outcome;
        uint256 requestId;
    }

    uint256 public marketCount;
    mapping(uint256 => Market) public markets;
    mapping(uint256 => mapping(address => uint256)) public yesBets;
    mapping(uint256 => mapping(address => uint256)) public noBets;
    mapping(uint256 => uint256) public requestToMarket;

    event MarketCreated(uint256 indexed id, string question, uint256 deadline);
    event BetPlaced(uint256 indexed id, address indexed bettor, bool isYes, uint256 amount);
    event MarketResolved(uint256 indexed id, Outcome outcome);
    event ResolutionText(uint256 indexed id, string text);
    event Claimed(uint256 indexed id, address indexed bettor, uint256 amount);

    function _lower(bytes1 c) internal pure returns (bytes1) {
        if (c >= 0x41 && c <= 0x5A) return bytes1(uint8(c) + 32);
        return c;
    }

    function _contains(bytes memory text, bytes memory needle) internal pure returns (bool) {
        if (needle.length == 0 || text.length < needle.length) return false;
        for (uint256 i = 0; i <= text.length - needle.length; i++) {
            bool match_ = true;
            for (uint256 j = 0; j < needle.length; j++) {
                if (_lower(text[i + j]) != _lower(needle[j])) {
                    match_ = false;
                    break;
                }
            }
            if (match_) return true;
        }
        return false;
    }

    function _startsWith(bytes memory text, bytes memory prefix) internal pure returns (bool) {
        if (text.length < prefix.length) return false;
        for (uint256 i = 0; i < prefix.length; i++) {
            if (_lower(text[i]) != _lower(prefix[i])) return false;
        }
        return true;
    }

    function createMarket(string calldata question, uint256 deadline) external payable returns (uint256 id) {
        require(deadline > block.timestamp, "Past deadline");
        id = ++marketCount;
        markets[id].question = question;
        markets[id].deadline = deadline;
        emit MarketCreated(id, question, deadline);
    }

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
        bytes memory payload = abi.encode(
            string.concat(
                "Is this statement factually true? Reply with exactly one token: YES, NO, or UNKNOWN. Statement: ",
                m.question
            ),
            allowed,
            false
        );

        uint256 reqId = platform.createRequest{value: msg.value}(
            LLM_AGENT_ID,
            address(this),
            this.handleResolution.selector,
            payload
        );
        m.requestId = reqId;
        requestToMarket[reqId] = marketId;
    }

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
                bytes memory r = bytes(result);
                bool hasUnknown = _contains(r, bytes("unknown"));
                bool hasYes = _startsWith(r, bytes("yes")) || _contains(r, bytes(" yes"));
                bool hasNo = _startsWith(r, bytes("no")) || _contains(r, bytes(" no"));
                if (hasUnknown) {
                    outcome = Outcome.UNKNOWN;
                } else
                if (hasYes && !hasNo) {
                    outcome = Outcome.YES;
                } else if (hasNo && !hasYes) {
                    outcome = Outcome.NO;
                } else {
                    outcome = Outcome.UNKNOWN;
                }
            }
        } else {
            outcome = Outcome.UNKNOWN;
        }

        m.outcome = outcome;
        emit MarketResolved(marketId, outcome);
    }

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

    receive() external payable {}
}
