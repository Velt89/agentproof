# AgentProof — agent interface (Binance Agentic Wallet)

The agent-native way to use AgentProof. If you run an agent with the
**Binance Agentic Wallet (`baw`)**, you never need to open the web dApp:
your agent reads AgentProof over plain RPC and writes through your own
paired `baw` wallet, preview-first, with your confirmation in the loop.

- Contract: `0xF6d6f95A89E5C9b896005C60f52FeDa5f7df26cb` (BNB Chain, chainId 56)
- Agent ID registry: `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F`
- Skill file for agents: [SKILL.md](SKILL.md)
- Machine-readable manifest (also served by the dApp): `/agent.json`
  → https://agentproof-topaz.vercel.app/agent.json

## Install

```bash
git clone https://github.com/Velt89/agentproof
cd agentproof
npm install          # repo root — provides ethers v6 for the helper script
```

Prerequisites: `baw` installed, and your Agentic Wallet paired **by you** in
the Binance App with `baw --json wallet status` returning `CONNECTED`.
The helper finds `baw` on PATH, or at `~/workspace/tools/baw-cli/bin/baw`.

## Quickstart

```bash
# reads (no wallet needed for the --address / reputation / feed forms)
node agent/agentproof.js status                  # your wallet, via baw
node agent/agentproof.js status --address 0x…    # any address, read-only
node agent/agentproof.js reputation 0x…
node agent/agentproof.js feed --limit 10

# writes — always preview first, execute only after YOUR explicit go-ahead
node agent/agentproof.js preview-issue 0xRecipient… "Audit/Review" "Delivered the contract audit" "https://…"
node agent/agentproof.js execute <requestId>     # only when you say go

node agent/agentproof.js preview-confirm 3
node agent/agentproof.js preview-cancel 5
```

Categories: `0` Work Delivered · `1` Audit / Review · `2` Mentorship / Help ·
`3` Trade / Service · `4` Community · `5` Other (index or name both work).

## The flow

```
 user: "issue a receipt to 0x… for X, category Audit/Review"
        │
        ▼
 agent: preview-issue ──► on-chain pre-checks (sender + recipient hold
        │                 Agent IDs, not a self-issue, limits ok)
        │                 └─► refuses locally if any check fails
        ▼
        baw contract-call preview  (simulation only — nothing broadcast,
        │                          no app notification created)
        ▼
 agent shows YOU the summary: from / to / function + args / value 0 /
        simulation verdict / risks (must be none) / allowance+authority
        changes (must be empty) / requestId + expiry
        │
        ▼
 you: "execute"  ──►  agent runs execute <requestId>
        │                 └─► baw may ask you to tap confirm in the
        │                     Binance App (PENDING_CONFIRMATION), or
        │                     broadcast under Developer Mode
        ▼
 agent reports tx hash + BscScan link and verifies the effect on-chain
 (receipt status / totalReceipts) before calling it done
```

## Safety notes

- **Preview-first, always.** A preview is a simulation; only `execute` can
  broadcast, and only on your explicit go-ahead for that specific preview.
  Stale previews (past `expiresAt`) are discarded and re-previewed.
- **Value is always 0.** The AgentProof contract has no payable functions,
  no transfers and no approvals — a correct preview always shows empty
  allowance/authority changes and no risks.
- **Your keys never move.** Pairing and confirmations happen in your Binance
  App through `baw`'s own session. Nothing here asks for seeds, private keys
  or pairing codes, and there is no website login of any kind in this flow.
- Receipts are **attestations by the issuer** — AgentProof does not verify
  the underlying work. Confirmation by the recipient is the trust signal.
  No tokens, no payments, no returns are promised or involved.
