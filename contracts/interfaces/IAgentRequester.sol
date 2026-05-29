// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Consensus mode used by the platform request.
enum ConsensusType {
    Majority,
    Threshold
}

/// @notice High-level execution status for platform requests and responses.
enum ResponseStatus {
    None,
    Pending,
    Success,
    Failed,
    TimedOut
}

/// @notice Individual validator response returned by the platform.
struct Response {
    address validator;
    bytes result;
    ResponseStatus status;
    uint256 receipt;
    uint256 timestamp;
    uint256 executionCost;
}

/// @notice Full platform request state.
struct Request {
    uint256 id;
    address requester;
    address callbackAddress;
    bytes4 callbackSelector;
    address[] subcommittee;
    Response[] responses;
    uint256 responseCount;
    uint256 failureCount;
    uint256 threshold;
    uint256 createdAt;
    uint256 deadline;
    ResponseStatus status;
    ConsensusType consensusType;
    uint256 remainingBudget;
    uint256 perAgentBudget;
}

/// @notice Minimal interface for Somnia platform request creation and inspection.
interface IAgentRequester {
    event RequestCreated(
        uint256 indexed requestId,
        uint256 indexed agentId,
        uint256 perAgentBudget,
        bytes payload,
        address[] subcommittee
    );

    event RequestFinalized(uint256 indexed requestId, ResponseStatus status);
    event SubcommitteePaid(uint256 indexed requestId, uint256 totalPaid, uint256 perMember);
    event CommitteeDepositFailed(uint256 indexed requestId, uint256 attemptedAmount);

    /// @notice Creates a basic request for a single agent flow.
    /// @param agentId Target base agent ID.
    /// @param callbackAddress Contract that receives the callback.
    /// @param callbackSelector Callback function selector in `callbackAddress`.
    /// @param payload Calldata consumed by the target base agent.
    /// @return requestId Newly created request ID.
    function createRequest(
        uint256 agentId,
        address callbackAddress,
        bytes4 callbackSelector,
        bytes calldata payload
    ) external payable returns (uint256 requestId);

    /// @notice Creates an advanced request with explicit committee parameters.
    /// @return requestId Newly created request ID.
    function createAdvancedRequest(
        uint256 agentId,
        address callbackAddress,
        bytes4 callbackSelector,
        bytes calldata payload,
        uint256 subcommitteeSize,
        uint256 threshold,
        ConsensusType consensusType,
        uint256 timeout
    ) external payable returns (uint256 requestId);

    /// @notice Returns the full request state.
    function getRequest(uint256 requestId) external view returns (Request memory);
    /// @notice Returns true if request exists and is retrievable.
    function hasRequest(uint256 requestId) external view returns (bool);
    /// @notice Returns minimum value required by `createRequest`.
    function getRequestDeposit() external view returns (uint256);
    /// @notice Returns minimum value required by `createAdvancedRequest`.
    function getAdvancedRequestDeposit(uint256 subcommitteeSize) external view returns (uint256);
}

/// @notice Generic callback interface used by platform-integrated contracts.
interface IAgentRequesterHandler {
    /// @notice Called by platform with finalized response set.
    function handleResponse(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        Request memory details
    ) external;
}

// LLM Inference base agent. createRequest payload must be function calldata
// (selector + args), not plain abi.encode bytes.
interface ILLMAgent {
    /// @notice Runs inference constrained to the provided allowed values.
    function inferString(
        string calldata prompt,
        string calldata system,
        bool chainOfThought,
        string[] calldata allowedValues
    ) external returns (string memory response);
}

// JSON API Request base agent. Fetches a public HTTP endpoint and extracts a
// numeric value with a JSON-path-like selector (e.g. "bitcoin.usd"), scaled by
// `decimals`. Payload must be function calldata (selector + args).
interface IJsonApiAgent {
    /// @notice Fetches `url`, extracts `selector` and returns it scaled to `decimals`.
    function fetchUint(
        string calldata url,
        string calldata selector,
        uint8 decimals
    ) external returns (uint256 value);
}

// LLM Parse Website base agent. Visits `url`, optionally resolving links across
// `numPages`, and extracts a value guided by `prompt`/`description`. Payload must
// be function calldata (selector + args).
interface IParseWebsiteAgent {
    /// @notice Extracts a free-form string (or one of `options` when non-empty).
    function ExtractString(
        string memory key,
        string memory description,
        string[] calldata options,
        string memory prompt,
        string memory url,
        bool resolveUrl,
        uint8 numPages,
        uint8 confidenceThreshold
    ) external returns (string memory);

    /// @notice Extracts a numeric value bounded by [min, max].
    function ExtractANumber(
        string memory key,
        string memory description,
        uint256 min,
        uint256 max,
        string memory prompt,
        string memory url,
        bool resolveUrl,
        uint8 numPages,
        uint8 confidenceThreshold
    ) external returns (uint256);
}
