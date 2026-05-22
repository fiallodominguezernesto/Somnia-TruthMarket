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
