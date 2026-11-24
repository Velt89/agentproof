# AgentProof — Deployment Package Summary

Generated 2026-11-24 19:18 UTC (2026-11-25 02:18 WIB), BSC block 135,517,581,
via https://bsc-rpc.publicnode.com (first endpoint succeeded; no rotation needed).
**Nothing has been broadcast or signed. This package is preparation only.**

## Compiler settings (exact, from hardhat.config.js + build info)

| Setting | Value |
|---|---|
| Solidity | 0.8.24 (`0.8.24+commit.e11b9ed9`) |
| Optimizer | enabled, 200 runs |
| EVM version | paris (Hardhat/solc default — not explicitly set in config) |
| License | MIT |

Recompiled cleanly with `npx hardhat compile --force` ("Compiled 2 Solidity files
successfully (evm target: paris)").

## Bytecode

| Item | Value |
|---|---|
| Creation bytecode | 5,330 bytes — `bytecode.txt` |
| Creation bytecode keccak256 | `0xfaf95cbbc600566e351a194bf303fd44dfc21a46fc414395b92c53697aec5806` |
| Constructor args (ABI-encoded) | `0x00000000000000000000000060b9262456de011f7d15a54cdd8c48baaa8b022f` — `constructor-args.txt` |
| Full deployment data (bytecode + args) | 5,362 bytes |
| Deployment data keccak256 | `0x26e86d7cf5e05e9cd38256f9df8ab3f26a199211007726e197d3a5a0e2794ec0` |
| ABI | `AgentProof.abi.json` |
| Flattened source | `AgentProof.flat.sol` — compiles standalone under the same settings; executable bytecode identical to the original build (only the CBOR metadata hash in the last ~43 bytes differs, as expected when source text differs) |

## Live gas estimate (read-only, from W)

| Item | Value |
|---|---|
| From (W) | `0x0518AE367CA3612872Aa2f0897BF3B5FaFCE893A` |
| Gas price (eth_gasPrice) | 0.05 gwei (50,000,000 wei) |
| eth_estimateGas (creation) | **1,166,569 gas** |
| Local Hardhat actual deploy gasUsed (cross-check) | 1,156,225 gas |
| Recommended gas limit (estimate × 1.2, rounded up) | **1,399,883** |
| Estimated deployment cost | **0.0000583 BNB ≈ $0.032** (at BNB $550.53, Finnhub, 2026-11-24 19:16 UTC) |
| Worst-case cost at recommended limit | 0.0000700 BNB ≈ $0.039 |
| W balance | **0.000098607 BNB ≈ $0.054** |

## Local interaction gas (Hardhat, MockAgentID + AgentProof, actual receipts)

| Call | gasUsed |
|---|---|
| `issueReceipt` (title + evidence URI) | 221,416 |
| `issueReceipt` (second receipt, longer title, empty evidence) | 254,437 |
| `confirmReceipt` | 80,124 |
| `cancelReceipt` | 35,316 |

## Coverage verdict

- **Deployment alone: ✅ COVERED.** Even at the full recommended gas limit
  (0.0000700 BNB), W's 0.000098607 BNB pays for it, leaving ~0.0000403 BNB
  (~805,000 gas) after a typical-cost deployment.
- **Deployment + ~10 test interactions paid entirely by W: ❌ NOT covered.**
  5 issues (worst-case 254,437) + 5 confirms (80,124) = 1,672,805 gas ≈
  0.0000836 BNB; deploy + 10 = ~0.0001420 BNB vs balance 0.0000986 BNB —
  shortfall ≈ **0.0000434 BNB**. In practice confirms are paid by recipients,
  so W alone can fund ~2 full issue+confirm pairs after deploying.
- **Recommended top-up: 0.0005 BNB** (brings W to ~0.0006 BNB ≈ $0.33 — covers
  deployment, all local-style tests, and a buffer for seeding the first real
  receipts). 0.001 BNB if you want comfortable margin for the whole
  30-interactor drive.

## BAW verdict

- `baw --json wallet status`: **CONNECTED**; Developer Mode enabled, expires
  **2026-11-29T22:30:12Z**.
- **BAW cannot deploy this contract.** The CLI has no deploy/create command;
  `contract-call preview` requires `--to <existing contract address>` and
  `--inputData` calldata — a contract-creation transaction has no `--to`.
  Route A (Remix + own wallet) in DEPLOY.md is the deployment path.

## Files in this package

- `bytecode.txt` — creation bytecode (0x-prefixed hex)
- `AgentProof.abi.json` — ABI
- `constructor-args.txt` — ABI-encoded constructor argument (registry address)
- `AgentProof.flat.sol` — flattened source for BscScan verification
- `DEPLOY.md` — pre-flight summary, both routes, post-deploy checklist
- `SUMMARY.md` — this file
