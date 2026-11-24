# AgentProof — Deployment Guide

**Status: PREPARATION ONLY. Nothing has been broadcast, signed, or deployed.**
All figures from the live read-only estimate of 2026-11-24 19:18 UTC
(BSC block 135,517,581) — see SUMMARY.md. Re-check gas/balance at deploy time;
BSC gas price moves, though it has been ~0.05 gwei.

## Pre-flight summary (one line)

> BSC mainnet (chain 56) · from W `0x0518AE367CA3612872Aa2f0897BF3B5FaFCE893A` · to: **new contract creation** (no recipient) · value **0 BNB** · constructor arg: Agent ID registry `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F` · est. **1,166,569 gas** (recommended limit **1,399,883**) · est. cost **0.0000583 BNB (~$0.032)**, worst case at limit 0.0000700 BNB · **no approvals, no spenders, no token transfers** — the contract handles no money at all.

Balance check at estimate time: W held **0.000098607 BNB** — enough for the
deployment alone, **not** enough for deployment + ~10 self-paid test
interactions (shortfall ≈ 0.0000434 BNB).
**Recommended top-up before deploying: 0.0005 BNB** (0.001 BNB for comfortable
margin through the interactor drive).

---

## Route A — Remix + Binance Wallet / MetaMask (RECOMMENDED)

You deploy from your own wallet and confirm in your own wallet app. Nobody
else's keys are involved at any point.

1. **Top up W** with ~0.0005 BNB on BSC if not already done (see above).
2. Open **Remix IDE** (remix.ethereum.org) in a browser where your wallet
   (Binance Wallet extension or MetaMask) is connected to **BNB Smart Chain
   mainnet (chain ID 56)** with address
   `0x0518AE367CA3612872Aa2f0897BF3B5FaFCE893A`.
3. **File explorer:** create a file `AgentProof.sol` and paste the full
   contents of `AgentProof.flat.sol` from this package (it is self-contained —
   the contract has no imports). Alternatively paste the original
   `contracts/AgentProof.sol` from the repo; use the SAME file later for
   BscScan verification.
4. **Solidity Compiler tab:**
   - Compiler: **0.8.24** (exactly `v0.8.24+commit.e11b9ed9`)
   - Enable optimization: **yes, 200 runs**
   - EVM version: leave default (paris)
   - Click **Compile AgentProof.sol** — expect no errors.
5. **Deploy & Run tab:**
   - Environment: **Injected Provider** (your wallet)
   - Account: your W address (above)
   - Contract: **AgentProof**
   - Constructor field `registry`: paste
     `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F`
   - Value: **0** (leave empty — deployment sends no BNB)
   - (Optional, under Advanced > Gas limit: `1399883`)
   - Click **Deploy** and confirm the transaction in your wallet app.
     Expected fee ≈ 0.000058 BNB. If the wallet shows a wildly higher fee or
     any token approval request, STOP — deployment needs neither.
6. Copy the deployed contract address from Remix (it appears under
   "Deployed Contracts") and the transaction hash. That address is needed for
   the frontend config, BscScan verification, and the hackathon submission.

## Route B — BAW (Binance Agentic Wallet CLI): NOT FEASIBLE for deployment

Checked locally 2026-11-24 (`baw --help`, `baw contract-call preview --help`,
`baw --json wallet status`, `baw --json wallet settings`):

- Wallet status: **CONNECTED**, Developer Mode enabled until
  **2026-11-29T22:30:12Z**.
- BUT the CLI has **no contract-deploy / create command**. Its only write path
  to contracts is `contract-call preview` → `execute`, which **requires
  `--to <existing contract address>`** plus `--inputData` calldata. A contract
  creation transaction has no `--to`, so creation bytecode cannot be sent
  through baw.
- Verdict: **use Route A to deploy.** After deployment, baw *can* be used for
  ordinary calls to the deployed contract (e.g. `issueReceipt` /
  `confirmReceipt` previews) if ever wanted — each still needs its own
  preview + your confirmation; nothing about that is set up or authorised by
  this package.

---

## Post-deploy checklist

1. **Frontend config** — in `frontend/src/config.ts`:
   - Set `AGENTPROOF_ADDRESS` to the deployed address (replace the zero
     address). `AGENTPROOF_DEPLOYED` flips to `true` automatically.
   - Rebuild: `cd frontend && npm run build` (must pass).
2. **BscScan verification** (contract page → "Verify and Publish"):
   - Contract address: the deployed address
   - Compiler type: **Solidity (Single file)** if you deployed from the flat
     file (recommended), or Standard-JSON/Multi-part if from the repo sources
   - Compiler version: **v0.8.24+commit.e11b9ed9**
   - Open Source License Type: **MIT**
   - Optimization: **Yes, 200 runs**
   - Source: paste `AgentProof.flat.sol` from this package
   - Constructor Arguments (ABI-encoded): paste the contents of
     `constructor-args.txt`:
     `00000000000000000000000060b9262456de011f7d15a54cdd8c48baaa8b022f`
     (without the `0x` prefix if BscScan asks for raw hex)
   - Cross-check the verified source matches the repo.
3. **Sourcify alternative** — submit the same flattened source + compiler
   settings at sourcify.dev for a second verification record.
4. **Live sanity check** (read-only): `hasAgentId(W)` should return `true`;
   then one real issue + confirm between two Agent ID holders as the first
   live receipt.
5. **Publish:**
   - Push the repo (including this `deploy-package/`) to GitHub
     (github.com/Velt89 — repo name suggestion: `agentproof`).
   - Deploy `frontend/` to Vercel; confirm the live site connects, shows the
     Agent ID status card, and reads the deployed contract.
6. **Hackathon submission** (before 2026-12-09 08:00 UTC) — fields from the
   README draft:
   - Project name: **AgentProof**
   - Website: the Vercel URL from step 5
   - Contract address(es): the deployed AgentProof address (BNB Chain)
   - Description + Agent ID usage description: use the drafts in
     `README.md` → "Hackathon submission fields (draft)"
   - Reward receiving address: W
     `0x0518AE367CA3612872Aa2f0897BF3B5FaFCE893A`
7. **Interactor drive:** follow the Boltbook b/alpha plan in `README.md`
   (≥30 distinct Agent ID addresses must interact during the submission
   period for the Innovation Award).
