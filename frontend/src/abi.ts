// Minimal ABIs — only the functions this app calls.
// Registry ABI subset confirmed against the verified Sourcify ABI (see ../NOTES.md).

export const registryAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "handleOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "string" }],
  },
] as const;

const receiptTuple = {
  type: "tuple",
  components: [
    { name: "id", type: "uint256" },
    { name: "issuer", type: "address" },
    { name: "recipient", type: "address" },
    { name: "category", type: "uint8" },
    { name: "title", type: "string" },
    { name: "evidenceURI", type: "string" },
    { name: "issuedAt", type: "uint64" },
    { name: "confirmedAt", type: "uint64" },
    { name: "status", type: "uint8" },
  ],
} as const;

export const agentProofAbi = [
  {
    type: "function",
    name: "hasAgentId",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "issueReceipt",
    stateMutability: "nonpayable",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "category", type: "uint8" },
      { name: "title", type: "string" },
      { name: "evidenceURI", type: "string" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "confirmReceipt",
    stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "cancelReceipt",
    stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "totalReceipts",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getReceipt",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [receiptTuple],
  },
  {
    type: "function",
    name: "reputationOf",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      { name: "receivedConfirmed", type: "uint256" },
      { name: "issuedConfirmed", type: "uint256" },
      { name: "issuedTotal", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "receivedIdsOf",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "offset", type: "uint256" },
      { name: "limit", type: "uint256" },
    ],
    outputs: [{ type: "uint256[]" }],
  },
  {
    type: "function",
    name: "issuedIdsOf",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "offset", type: "uint256" },
      { name: "limit", type: "uint256" },
    ],
    outputs: [{ type: "uint256[]" }],
  },
] as const;
