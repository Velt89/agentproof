---
name: agentproof
description: |
  Use when the user wants to use AgentProof — on-chain work receipts between
  Agent ID holders on BNB Chain — through their agent instead of the web dApp:
  issue an AgentProof receipt to another Agent ID holder, confirm a receipt
  addressed to them, cancel their own pending receipt, check their AgentProof
  reputation, someone else's reputation, their pending inbox, or the recent
  receipts feed. Drives the Binance Agentic Wallet (baw) CLI: preview-first
  contract calls against the AgentProof contract
  0xF6d6f95A89E5C9b896005C60f52FeDa5f7df26cb (BNB Chain, chainId 56).
  All values are 0 BNB; the contract has no payable functions, no transfers
  and no approvals.
metadata:
  author: velt (AgentProof)
  version: '0.1.0'
  openclaw:
    requires:
      bins:
        - baw
        - node
---

# AgentProof Skill (via Binance Agentic Wallet)

AgentProof records **work receipts** between Agent ID holders: an issuer
attests that someone delivered work; the recipient confirms on-chain; only
confirmed receipts build reputation. This skill lets the user do all of that
through their agent + their own paired Binance Agentic Wallet (`baw`) —
**no website, no wallet browser, no QR/pairing-code web login**. The flow uses
the user's already-paired `baw` session, exactly like Binance's official
agentic-wallet skill.

- Contract: `0xF6d6f95A89E5C9b896005C60f52FeDa5f7df26cb` (BNB Chain, chainId 56)
- Agent ID registry: `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F`
- Helper script (run from the AgentProof repo root): `node agent/agentproof.js …`
  (needs `npm install` at the repo root once, for ethers v6)
- Web dApp (for judges / manual use): https://agentproof-topaz.vercel.app
- Machine-readable manifest: https://agentproof-topaz.vercel.app/agent.json

## Prerequisites

1. `baw` CLI installed and the user's Agentic Wallet **paired by the user in
   the Binance App** (this skill never pairs, never asks for seeds, keys,
   pairing codes or passwords).
2. `baw --json wallet status` returns `{"status": "CONNECTED"}`. If it does
   not, stop and ask the user to connect/re-pair in the Binance App first.
3. The sender must hold an Agent ID (`hasAgentId`); recipients of receipts
   must hold one too. The script checks this on-chain before previewing.

## Commands

| User intent | Command |
|---|---|
| My AgentProof status / am I a holder / my inbox | `node agent/agentproof.js status` |
| Status of a specific address (read-only) | `node agent/agentproof.js status --address <addr>` |
| Someone's reputation | `node agent/agentproof.js reputation <address>` |
| Recent receipts feed | `node agent/agentproof.js feed [--limit n]` |
| Issue a receipt | `node agent/agentproof.js preview-issue <recipient> <category> <title> [evidenceURI]` |
| Confirm a receipt sent to me | `node agent/agentproof.js preview-confirm <receiptId>` |
| Cancel my own pending receipt | `node agent/agentproof.js preview-cancel <receiptId>` |
| Execute an approved preview | `node agent/agentproof.js execute <requestId>` |

Categories: `0` Work Delivered · `1` Audit / Review · `2` Mentorship / Help ·
`3` Trade / Service · `4` Community · `5` Other. The script also accepts the
name (e.g. `Audit/Review`, `audit`, `Community`).

Limits enforced by the contract (the script checks them before previewing):
title 1–140 bytes, evidence URI ≤ 200 bytes, no self-issue, recipient must be
an Agent ID holder.

## The two-phase write flow (mandatory)

Every write goes through these steps, in order, with no shortcuts:

1. **Preview.** Run the matching `preview-*` command. This calls
   `baw contract-call preview` — a simulation. It broadcasts nothing and
   creates **no** notification in the user's Binance App.
2. **Show the user the preview summary** before anything else: from (their
   wallet), to (the AgentProof contract), function + decoded arguments
   (recipient, category, title, evidence / receipt id), **value 0**, the
   simulation verdict, `requireConfirmation`, and the risk fields.
   `allowanceChanges` and `authorityChanges` must be **empty** and `risks`
   must be **none** — if any of them is not, STOP, show the user, and do not
   execute.
3. **Wait for the user's explicit go-ahead** ("execute", "go", "confirm" —
   in their own words, after seeing the summary). A request to *prepare* or
   *preview* is never a go-ahead to execute.
4. **Execute.** Only then run `node agent/agentproof.js execute <requestId>`
   with the requestId from step 1. If the preview has expired
   (`expiresAt` in the past) or anything about the call changed, discard it
   and go back to step 1 — **never execute a stale preview**.
5. **Report and verify.** After execution, report the outcome exactly as
   returned: if `PENDING_CONFIRMATION`, tell the user a confirmation is
   waiting for their tap in the Binance App (it only exists *after* execute —
   never tell the user to tap for a mere preview). If `BROADCASTED`, report
   the tx hash + BscScan link and the on-chain verification the script prints
   (receipt status / totalReceipts). If it failed or reverted, say so plainly
   with the reason given.

## Safety rules (non-negotiable)

- **Preview first, always.** No `execute` without a fresh, clean preview that
  the user has seen.
- **Execute only on the user's explicit go-ahead**, for that specific
  preview's requestId. One go-ahead covers one execute.
- **Value is always 0.** AgentProof moves no funds; the contract has no
  payable functions. Never add a value, a token approval, or any extra call.
- **Never ask for or handle** seed phrases, private keys, pairing codes,
  passwords or session tokens. Pairing happens only in the user's Binance App.
- **No name→wallet lookup.** AgentProof never resolves an Agent ID handle to
  someone else's wallet. Work with addresses the user supplies.
- **Receipts are attestations, not proof.** AgentProof does not verify the
  underlying work; never describe a receipt as verified work, and never
  promise returns — there are no tokens, payments or rewards in AgentProof.
- If `baw` reports the wallet is not CONNECTED, stop and hand the connection
  step back to the user (Binance App). Do not attempt sign-in flows for them.

## Example user prompts

- "Issue an AgentProof receipt to 0x1234…abcd for delivering the contract
  audit, category Audit/Review, evidence https://example.com/audit-report"
- "Confirm the AgentProof receipt #3 that was sent to me."
- "Cancel my pending AgentProof receipt #5."
- "What's my AgentProof reputation?"
- "How many AgentProof receipts are waiting in my inbox?"
- "Show me the recent AgentProof receipts."
