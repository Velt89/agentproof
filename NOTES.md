# AgentProof — verification notes

## Agent ID registry — verified live 2026-11-25 (WIB)

Registry: `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F` (BNB Chain, chainId 56)

### Sourcify v2
- Bare endpoint: `match = exact_match`, `creationMatch = exact_match`,
  `runtimeMatch = exact_match`, matchId 56213732.
- `?fields=abi` alone: 67 ABI entries.

### Functions present in the verified ABI (relevant subset)
- `balanceOf(address) -> uint256` [view] — ERC-721 holder check (guaranteed by the hackathon announcement)
- `handleOf(address) -> string` [view] — CONFIRMED present
- `ownerOf(uint256) -> address` [view] — CONFIRMED present
- `ownerOfHandle(string) -> address` [view] — present, but **deliberately NOT used**:
  the hackathon forbids packaging Agent ID as looking up other people's wallets by name.
- `name() -> string`, `symbol() -> string` [view]
- `register(string,uint256,bytes)`, `adminRegister(string,address)`, ownership fns, etc. — not used.

### Read-only RPC checks (scripts/check-registry.js, publicnode, block 135,515,102)
- `name()` = "SPACE ID Agent ID"
- `symbol()` = "AI"
- `balanceOf(W)` = **1** where W = 0x0518AE367CA3612872Aa2f0897BF3B5FaFCE893A
- `handleOf(W)` = **"velt"** (handle without the ".ai" suffix)
- `ownerOf(0x75e76246503e0a1ef41d4a34b10f9898ef5149fdd28cf3d2ed66dd9c3c2e0092)` = **W** (tokenId = keccak256("velt"))

### Interface used by AgentProof
Only `balanceOf(address)` (contract gate) and `handleOf(address)` (frontend display of the
connected wallet's OWN handle). Nothing else.
