// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title AgentProof — on-chain work receipts for Agent ID holders
/// @notice Built for the Binance Wallet Agent ID Hackathon (BNB Chain).
///
/// HOW AGENT ID IS USED (core of the product, not a login checkbox):
/// Both sides of every receipt must hold an Agent ID (the soulbound
/// SPACE ID Agent ID ERC-721, registry 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F).
/// Because an Agent ID is non-transferable and one-per-person, the reputation
/// counters derived from confirmed receipts are effectively non-transferable
/// too: you cannot buy, sell, or move someone else's AgentProof reputation.
///
/// SAFETY / COMPLIANCE NOTES FOR REVIEWERS:
/// - This contract handles NO money at all: there are no payable functions,
///   no transfer / transferFrom / approve logic, and it never custodies funds.
/// - There is NO owner, NO admin, NO pause, NO upgradeability, and NO way to
///   change the registry address after deployment (it is immutable).
/// - Receipts are attestations by the issuer only. AgentProof does NOT verify
///   that the underlying work happened; confirmation by the recipient is the
///   trust signal, and both parties must opt in on-chain.
/// - Agent ID is never used to look up other people's wallets by name: the
///   contract only checks balanceOf(address) for addresses the caller supplies.

interface IAgentID {
    function balanceOf(address owner) external view returns (uint256);
}

contract AgentProof {
    // Status values for Receipt.status
    uint8 public constant STATUS_PENDING = 0;
    uint8 public constant STATUS_CONFIRMED = 1;
    uint8 public constant STATUS_CANCELLED = 2;

    // Categories (Receipt.category):
    //   0 = Work Delivered
    //   1 = Audit / Review
    //   2 = Mentorship / Help
    //   3 = Trade / Service
    //   4 = Community
    //   5 = Other
    uint8 public constant MAX_CATEGORY = 5;

    uint256 public constant MAX_TITLE_BYTES = 140;
    uint256 public constant MAX_EVIDENCE_BYTES = 200;

    /// @notice SPACE ID Agent ID registry on BNB Chain (immutable).
    IAgentID public immutable agentIdRegistry;

    struct Receipt {
        uint256 id;
        address issuer;
        address recipient;
        uint8 category;
        string title;
        string evidenceURI;
        uint64 issuedAt;
        uint64 confirmedAt; // 0 while pending/cancelled
        uint8 status; // 0=Pending, 1=Confirmed, 2=Cancelled
    }

    Receipt[] private _receipts;
    mapping(address => uint256[]) private _receivedIds;
    mapping(address => uint256[]) private _issuedIds;
    mapping(address => uint256) private _receivedConfirmed;
    mapping(address => uint256) private _issuedConfirmed;

    event ReceiptIssued(uint256 indexed id, address indexed issuer, address indexed recipient, uint8 category, string title);
    event ReceiptConfirmed(uint256 indexed id, address indexed issuer, address indexed recipient);
    event ReceiptCancelled(uint256 indexed id, address indexed issuer, address indexed recipient);

    constructor(address registry) {
        require(registry != address(0), "registry is zero address");
        agentIdRegistry = IAgentID(registry);
    }

    /// @notice True if `account` holds at least one Agent ID.
    function hasAgentId(address account) public view returns (bool) {
        return agentIdRegistry.balanceOf(account) > 0;
    }

    /// @notice Issue a pending receipt to another Agent ID holder.
    /// @dev Both issuer (msg.sender) and recipient must hold an Agent ID.
    function issueReceipt(
        address recipient,
        uint8 category,
        string calldata title,
        string calldata evidenceURI
    ) external returns (uint256 id) {
        require(hasAgentId(msg.sender), "issuer holds no Agent ID");
        require(recipient != address(0), "recipient is zero address");
        require(recipient != msg.sender, "cannot issue to yourself");
        require(hasAgentId(recipient), "recipient holds no Agent ID");
        require(category <= MAX_CATEGORY, "invalid category");
        uint256 titleLen = bytes(title).length;
        require(titleLen >= 1 && titleLen <= MAX_TITLE_BYTES, "title must be 1-140 bytes");
        require(bytes(evidenceURI).length <= MAX_EVIDENCE_BYTES, "evidenceURI over 200 bytes");

        id = _receipts.length;
        _receipts.push(
            Receipt({
                id: id,
                issuer: msg.sender,
                recipient: recipient,
                category: category,
                title: title,
                evidenceURI: evidenceURI,
                issuedAt: uint64(block.timestamp),
                confirmedAt: 0,
                status: STATUS_PENDING
            })
        );
        _issuedIds[msg.sender].push(id);
        _receivedIds[recipient].push(id);
        emit ReceiptIssued(id, msg.sender, recipient, category, title);
    }

    /// @notice Confirm a pending receipt addressed to you. This is the action
    /// that increments reputation for both parties.
    function confirmReceipt(uint256 id) external {
        Receipt storage r = _receiptAt(id);
        require(msg.sender == r.recipient, "only the recipient can confirm");
        require(r.status == STATUS_PENDING, "receipt is not pending");
        r.status = STATUS_CONFIRMED;
        r.confirmedAt = uint64(block.timestamp);
        _receivedConfirmed[r.recipient] += 1;
        _issuedConfirmed[r.issuer] += 1;
        emit ReceiptConfirmed(id, r.issuer, r.recipient);
    }

    /// @notice Cancel one of your own pending receipts.
    function cancelReceipt(uint256 id) external {
        Receipt storage r = _receiptAt(id);
        require(msg.sender == r.issuer, "only the issuer can cancel");
        require(r.status == STATUS_PENDING, "receipt is not pending");
        r.status = STATUS_CANCELLED;
        emit ReceiptCancelled(id, r.issuer, r.recipient);
    }

    // ----- Views -----

    function totalReceipts() external view returns (uint256) {
        return _receipts.length;
    }

    function getReceipt(uint256 id) external view returns (Receipt memory) {
        return _receiptAt(id);
    }

    /// @notice Reputation of an address, derived only from CONFIRMED receipts.
    /// @return receivedConfirmed receipts this address received and confirmed
    /// @return issuedConfirmed receipts this address issued that were confirmed
    /// @return issuedTotal all receipts this address ever issued
    function reputationOf(address user)
        external
        view
        returns (uint256 receivedConfirmed, uint256 issuedConfirmed, uint256 issuedTotal)
    {
        return (_receivedConfirmed[user], _issuedConfirmed[user], _issuedIds[user].length);
    }

    function receivedCount(address user) external view returns (uint256) {
        return _receivedIds[user].length;
    }

    function issuedCount(address user) external view returns (uint256) {
        return _issuedIds[user].length;
    }

    /// @notice Paginated receipt ids received by `user` (for an inbox UI).
    function receivedIdsOf(address user, uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory page)
    {
        return _page(_receivedIds[user], offset, limit);
    }

    /// @notice Paginated receipt ids issued by `user`.
    function issuedIdsOf(address user, uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory page)
    {
        return _page(_issuedIds[user], offset, limit);
    }

    // ----- Internals -----

    function _receiptAt(uint256 id) internal view returns (Receipt storage r) {
        require(id < _receipts.length, "receipt does not exist");
        r = _receipts[id];
    }

    function _page(uint256[] storage ids, uint256 offset, uint256 limit)
        internal
        view
        returns (uint256[] memory page)
    {
        if (offset >= ids.length || limit == 0) return new uint256[](0);
        uint256 end = offset + limit;
        if (end > ids.length) end = ids.length;
        page = new uint256[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            page[i - offset] = ids[i];
        }
    }
}
