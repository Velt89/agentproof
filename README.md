# AgentProof

**On-chain work receipts for Agent ID holders** — built for the
**Binance Wallet Agent ID Hackathon** (BNB Chain, submissions close 2026-12-09 08:00 UTC).

## What it is

When one agent does work for another — delivers an audit, a review, a service, help in a
community — there is normally no portable, trustworthy record that it happened. AgentProof
creates that record:

1. An **issuer** creates a receipt for work that was delivered: recipient, category, a short
   title, and an optional evidence link.
2. The **recipient** confirms the receipt on-chain. Only confirmation counts.
3. Confirmed receipts build **reputation counters** (`reputationOf`) that anyone can read
   and any other contract can build on.

Receipts are attestations by the issuer — AgentProof does **not** verify the underlying
work. Confirmation by the recipient is the trust signal, and both parties must opt in
on-chain. There are no tokens, no payments, and no returns promised or implied.

## How Agent ID is core to the flow

- **Both sides must hold an Agent ID.** `issueReceipt` checks
  `registry.balanceOf(issuer) > 0` and `registry.balanceOf(recipient) > 0` against the
  SPACE ID Agent ID registry (`0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F`, BNB Chain).
  There is no way to use AgentProof without one.
- **Reputation is non-transferable by construction.** An Agent ID is a soulbound,
  one-per-person ERC-721. AgentProof reputation is derived only from confirmed receipts
  between Agent ID holders, so it inherits that property: you cannot buy, sell, or move
  someone else's reputation.
- The frontend reads the connected wallet's own handle (`handleOf`) to display e.g.
  `velt.ai`, and shows non-holders exactly how to claim an Agent ID (Binance App only).

Registry interface was verified live before coding — see [NOTES.md](NOTES.md)
(Sourcify exact_match; `balanceOf`, `handleOf`, `ownerOf`, `name`, `symbol` confirmed;
live reads for the reference wallet recorded).

## Agent interface (BAW) — the primary path for agent-native users

Agent ID holders are, by definition, people running agents with a Binance
Agentic Wallet — so AgentProof's primary interface is not this web page, it's
the user's own agent. With the AgentProof skill, an agent uses AgentProof
through the user's paired `baw` wallet: **no wallet browser, no website
login, no QR/pairing-code web flow** (pairing lives in the user's Binance
App, exactly as in Binance's official agentic-wallet skill).

- **Skill:** [agent/SKILL.md](agent/SKILL.md) — give it to your agent, then
  just say e.g. *"Issue an AgentProof receipt to 0x… for delivering the audit,
  category Audit/Review, evidence <link>"* or *"Confirm receipt #3 for me."*
- **Helper CLI:** [agent/agentproof.js](agent/agentproof.js) — read commands
  (`status`, `reputation`, `feed`) over plain RPC, plus two-phase writes
  (`preview-issue` / `preview-confirm` / `preview-cancel`, then `execute`).
  See [agent/README.md](agent/README.md) for the quickstart and flow diagram.
- **Manifest:** `frontend/public/agent.json`, served by the dApp at
  `/agent.json` — machine-readable contract/registry addresses, ABI + skill
  URLs, `baw` command templates, categories and safety rules.

The write flow is preview-first, always: the agent runs
`baw contract-call preview` (a simulation — nothing broadcasts, no app
notification is created), shows the user the decoded summary (from / to /
function + args / **value 0** / risks must be none / allowance and authority
changes must be empty), and runs `execute` only on the user's explicit
go-ahead for that specific preview. Stale previews are re-previewed, never
executed. The script also refuses locally — before ever calling `baw` — when
the recipient holds no Agent ID, on self-issue, or when a confirm/cancel
targets a receipt that isn't pending or isn't the caller's to act on.

The web dApp remains for judges, manual users, and anyone who prefers a
browser; both paths hit the same contract with the same rules.

## Architecture

```
contracts/
  AgentProof.sol    — the whole product. No deps, Solidity 0.8.24.
  MockAgentID.sol   — LOCAL TESTS ONLY stand-in registry (balanceOf + setHolder).
test/
  AgentProof.test.js — Hardhat + ethers v6, 12 tests.
scripts/
  check-registry.js — read-only live registry verification (no keys, no writes).
frontend/           — Vite + React + TypeScript, viem + injected wallet (no wagmi).
agent/              — agent interface: SKILL.md + agentproof.js (baw preview-first
                      writes, RPC reads) + README. See "Agent interface (BAW)" above.
```

Contract design notes:

- Receipt lifecycle: `Pending → Confirmed` (by recipient) or `Pending → Cancelled`
  (by issuer). Reputation increments only on confirmation.
- Categories: 0 Work Delivered · 1 Audit/Review · 2 Mentorship/Help ·
  3 Trade/Service · 4 Community · 5 Other.
- Per-user `receivedIds` / `issuedIds` arrays with paginated getters, so the frontend
  inbox works from plain contract reads — no event indexing service needed.
- Title ≤ 140 bytes, evidence URI ≤ 200 bytes, category ≤ 5, self-issue forbidden.

## Safety compliance vs the hackathon red lines

| Red line | AgentProof |
|---|---|
| No web QR / pairing-code login for Agentic Wallet | ✅ Login is a standard injected-wallet connect (MetaMask / Binance Wallet). No QR, no pairing codes, no server-side sessions. |
| No bypassing user transaction confirmation | ✅ Every write is a normal wallet transaction the user sees and confirms in their own wallet. No auto-signing anywhere. |
| No unauthorized / hidden asset transfers | ✅ The contract handles **no money at all**: zero payable functions, no transfer/approve logic, never custodies funds. |
| No unlimited approvals solicited | ✅ AgentProof never asks for any token approval — there is nothing to approve. |
| Contracts open-source with disclosed owner permissions | ✅ MIT source, to be verified on BscScan at deployment. There is **no owner/admin at all** — no mint, pause, freeze, tax, withdrawal, or upgrade functions exist. The registry address is `immutable`. |
| No Binance/BNB brand impersonation | ✅ Named "AgentProof"; no Binance/BNB in the project or token name (there is no token). |
| No collecting seeds / keys / secrets | ✅ Nothing is collected; the app only talks to the user's own wallet extension/app. |
| No promising returns | ✅ No returns, yields, or income language anywhere in contract or UI. No token exists. |
| Agent ID not packaged as name→wallet lookup | ✅ Deliberately not implemented. The registry's `ownerOfHandle` is **not used**. The reputation lookup takes a wallet address the user supplies and returns that address's AgentProof counters — it never resolves names to wallets. |
| Trading risk warnings | N/A — AgentProof involves no trading. The UI states plainly that receipts are unverified attestations. |

## Local build & test

```bash
# contracts + tests (repo root)
npm install
npx hardhat compile
npx hardhat test            # 12 tests, all passing
node scripts/check-registry.js   # read-only live registry check (optional)

# frontend
cd frontend
npm install
npm run build               # tsc + vite build must pass
npm run dev                 # local preview
```

Status of this repo: **locally verified build only — NOT deployed.** The frontend's
`src/config.ts` carries a clearly marked placeholder AgentProof address.

## Deployment + BscScan verification (for later — NOT executed here)

1. Deploy `AgentProof` to BNB Chain mainnet (chain 56) with constructor argument
   `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F`, from the project wallet, via the user's
   own wallet confirmation flow.
2. Verify on BscScan: Solidity 0.8.24, optimizer enabled (200 runs), MIT license,
   constructor argument as above. Cross-check the verified source matches this repo.
3. Put the deployed address into `frontend/src/config.ts` (`AGENTPROOF_ADDRESS`),
   rebuild, and host the frontend.
4. Sanity-check live: `hasAgentId(<a known holder>) == true`, issue + confirm one real
   receipt between two Agent ID holders.

## Hackathon submission fields (draft)

- **Project name:** AgentProof
- **Description:** AgentProof is an on-chain work-receipt and reputation layer for Agent ID
  holders on BNB Chain. When an agent delivers work — an audit, a service, community help —
  the counterparty issues a receipt and the recipient confirms it on-chain. Confirmed
  receipts accumulate into public reputation counters that any dApp can read, giving agents
  a portable track record that cannot be bought or transferred.
- **Agent ID usage description:** Agent ID is the identity root of the product. Both the
  issuer and the recipient of every receipt must hold a SPACE ID Agent ID (checked on-chain
  against the registry `balanceOf` on every issue). Because Agent IDs are soulbound and
  one-per-person, AgentProof reputation derived from confirmed receipts is non-transferable
  and Sybil-resistant by construction. The frontend also reads the holder's own handle for
  display and routes non-holders to claim an Agent ID in the Binance App.
- **Contracts:** AgentProof — `<to fill after deployment>` (BNB Chain, verified on BscScan)
- **Website:** `<to fill after hosting>`

## Reaching 30+ Agent ID interactors (Innovation Award threshold)

The Innovation Award requires ≥30 distinct Agent ID addresses interacting with the
contract during the submission period. Plan:

1. Launch post on **Boltbook b/alpha** (where the Agent ID holder community already
   congregates): what AgentProof is, the contract address, and a simple ask — "did an
   agent do good work for you? Issue them a receipt; if you received one, confirm it."
2. Seed both directions: issue receipts for real, recent collaborations with known
   Boltbook agents (each issue + their confirm = 2 interactors per pair).
3. Follow-up posts as the confirmed-receipt count grows; every interaction is gas-only
   (no funds move), which keeps the ask friction-low and inside the safety rules.
4. Track distinct interactors from contract events (`ReceiptIssued` / `ReceiptConfirmed`)
   and report the count honestly — no wash interactions, no mass-registration tricks
   (both are disqualifying under the campaign rules).
