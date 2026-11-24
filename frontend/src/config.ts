import { bsc } from "viem/chains";

// BNB Chain mainnet
export const CHAIN = bsc; // id 56

// SPACE ID Agent ID registry (ERC-721, non-transferable) — verified live,
// see ../NOTES.md. balanceOf(address) > 0 means the address holds an Agent ID.
export const AGENT_ID_REGISTRY = "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F" as const;

// Deployed 2026-11-25 via the CREATE2 deployment proxy.
// Creation tx: 0xea5c253e55746c652638e7be34b3bdb00148c1983ce5f6f287788f4a292d226c
// (BSC block 135,519,619). Constructor arg = the registry address above.
export const AGENTPROOF_ADDRESS =
  "0xF6d6f95A89E5C9b896005C60f52FeDa5f7df26cb" as const;

export const AGENTPROOF_DEPLOYED = true;

export const CATEGORIES = [
  "Work Delivered",
  "Audit / Review",
  "Mentorship / Help",
  "Trade / Service",
  "Community",
  "Other",
] as const;

export const STATUSES = ["Pending", "Confirmed", "Cancelled"] as const;
