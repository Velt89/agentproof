#!/usr/bin/env node
/**
 * AgentProof — agent interface (Binance Agentic Wallet / baw).
 *
 * Lets an agent use AgentProof on BNB Chain through the user's OWN paired
 * Binance Agentic Wallet, without opening the web dApp:
 *
 *   node agent/agentproof.js status [--address <addr>]
 *   node agent/agentproof.js feed [--limit n]
 *   node agent/agentproof.js reputation <address>
 *   node agent/agentproof.js preview-issue <recipient> <category> <title> [evidenceURI] [--from <addr>]
 *   node agent/agentproof.js preview-confirm <receiptId> [--from <addr>]
 *   node agent/agentproof.js preview-cancel <receiptId> [--from <addr>]
 *   node agent/agentproof.js execute <requestId>
 *
 * Run from the repo root (uses the root node_modules ethers v6).
 *
 * SAFETY MODEL (see agent/SKILL.md):
 * - Reads are plain RPC calls — no wallet, no keys, no signing.
 * - Writes are ALWAYS two-phase: `preview-*` runs `baw contract-call preview`
 *   (a simulation — it broadcasts nothing and creates no app notification),
 *   and `execute` is a separate, explicit step to run ONLY after the user has
 *   seen the preview summary and said go.
 * - Value is always 0. The AgentProof contract has no payable functions, no
 *   transfers and no approvals, so allowance/authority changes in any preview
 *   MUST be empty — this script prints them and warns if they are not.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { ethers } = require("ethers");

// ---------------------------------------------------------------- constants

const CHAIN_ID = 56;
const AGENTPROOF = "0xF6d6f95A89E5C9b896005C60f52FeDa5f7df26cb";
const REGISTRY = "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F";
const BSCSCAN = "https://bscscan.com";

const CATEGORIES = [
  "Work Delivered",
  "Audit / Review",
  "Mentorship / Help",
  "Trade / Service",
  "Community",
  "Other",
];
const STATUSES = ["Pending", "Confirmed", "Cancelled"];

const RPC_ENDPOINTS = [
  "https://bsc-rpc.publicnode.com",
  "https://bsc-dataseed.binance.org",
  "https://bsc-dataseed1.defibit.io",
  "https://bsc-dataseed2.bnbchain.org",
];
const BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const ABI_PATH = path.join(__dirname, "..", "deploy-package", "AgentProof.abi.json");
const agentProofAbi = JSON.parse(fs.readFileSync(ABI_PATH, "utf8"));
const iface = new ethers.Interface(agentProofAbi);

const registryAbi = [
  "function balanceOf(address owner) view returns (uint256)",
  "function handleOf(address account) view returns (string)",
];

// ------------------------------------------------------------------- errors

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------------- RPC
// Sequential endpoint rotation: ethers v6 JsonRpcProvider with a browser
// User-Agent (BSC dataseed 403s the default UA) and a hard request timeout
// (a hung RPC otherwise stalls forever).

let _provider = null;

function makeProvider(url) {
  const req = new ethers.FetchRequest(url);
  req.setHeader("User-Agent", BROWSER_UA);
  req.timeout = 20000;
  return new ethers.JsonRpcProvider(req, CHAIN_ID, { staticNetwork: true });
}

async function provider() {
  if (_provider) return _provider;
  let lastErr;
  for (const url of RPC_ENDPOINTS) {
    const p = makeProvider(url);
    try {
      await p.getBlockNumber();
      _provider = p;
      return p;
    } catch (e) {
      lastErr = e;
    }
  }
  fail(`all BSC RPC endpoints failed (last error: ${lastErr && lastErr.message})`);
}

async function read(contractAddr, abi, fn, args = []) {
  const p = await provider();
  const c = new ethers.Contract(contractAddr, abi, p);
  try {
    return await c[fn](...args);
  } catch (e) {
    // Rotate once on transport-level failure, then retry on the next endpoint.
    _provider = null;
    const p2 = await provider();
    const c2 = new ethers.Contract(contractAddr, abi, p2);
    return await c2[fn](...args);
  }
}

const apRead = (fn, args) => read(AGENTPROOF, agentProofAbi, fn, args);
const regRead = (fn, args) => read(REGISTRY, registryAbi, fn, args);

// ---------------------------------------------------------------------- baw

function bawBin() {
  const probe = spawnSync("baw", ["--version"], { encoding: "utf8" });
  if (!probe.error && probe.status !== null) return "baw";
  const abs = path.join(os.homedir(), "workspace/tools/baw-cli/bin/baw");
  if (fs.existsSync(abs)) return abs;
  fail("baw CLI not found on PATH or at ~/workspace/tools/baw-cli/bin/baw — install the Binance Agentic Wallet CLI first.");
}

function runBaw(args) {
  const bin = bawBin();
  const env = { ...process.env };
  env.PATH = `${path.join(os.homedir(), "workspace/tools/baw-cli/bin")}:${env.PATH || ""}`;
  const res = spawnSync(bin, args, { encoding: "utf8", env, timeout: 120000 });
  if (res.error) fail(`baw invocation failed: ${res.error.message}`);
  const out = (res.stdout || "").trim();
  try {
    return JSON.parse(out);
  } catch {
    fail(`baw returned non-JSON output for \`${args.join(" ")}\`:\n${out}\n${res.stderr || ""}`);
  }
}

function bawWalletStatus() {
  const j = runBaw(["wallet", "status", "--json"]);
  if (j && j.success && j.data) return j.data.status || "UNKNOWN";
  return "UNKNOWN";
}

/** Best-effort: pull the EVM (chain 56) address out of `baw wallet address`. */
function bawWalletAddress() {
  const j = runBaw(["wallet", "address", "--json"]);
  if (!j || !j.success) return null;
  const hits = [];
  (function walk(node, keyHint) {
    if (typeof node === "string") {
      if (/^0x[0-9a-fA-F]{40}$/.test(node)) hits.push({ addr: node, hint: keyHint || "" });
    } else if (Array.isArray(node)) {
      node.forEach((v) => walk(v, keyHint));
    } else if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) walk(v, k);
    }
  })(j.data, "");
  if (!hits.length) return null;
  const pref = hits.find((h) => /evm|bsc|bnb|56/i.test(h.hint));
  return (pref || hits[0]).addr;
}

/**
 * Resolve the sender for previews: explicit --from, then the paired baw
 * wallet's own address, then $AGENTPROOF_WALLET. Never invents an address.
 */
function resolveSender(flagFrom) {
  if (flagFrom) {
    if (!ethers.isAddress(flagFrom)) fail(`--from is not a valid address: ${flagFrom}`);
    return ethers.getAddress(flagFrom);
  }
  const st = bawWalletStatus();
  if (st === "CONNECTED") {
    const a = bawWalletAddress();
    if (a) return ethers.getAddress(a);
    fail("baw is CONNECTED but `baw wallet address` returned no EVM address.");
  }
  if (process.env.AGENTPROOF_WALLET && ethers.isAddress(process.env.AGENTPROOF_WALLET)) {
    return ethers.getAddress(process.env.AGENTPROOF_WALLET);
  }
  fail(
    `baw wallet status is ${st} (not CONNECTED) — previews need the user's paired, connected ` +
      `Agentic Wallet. Ask the user to re-pair/connect in the Binance App, or pass --from <address> ` +
      `for a read-only sender override (baw will still refuse to preview while disconnected).`
  );
}

// ------------------------------------------------------------------ helpers

function parseCategory(input) {
  if (input === undefined) fail("category is required (index 0-5 or a name).");
  if (/^[0-5]$/.test(String(input).trim())) return Number(input);
  const norm = String(input).toLowerCase().replace(/[^a-z]/g, "");
  const table = {
    workdelivered: 0, work: 0, delivered: 0,
    auditreview: 1, audit: 1, review: 1,
    mentorshiphelp: 2, mentorship: 2, help: 2,
    tradeservice: 3, trade: 3, service: 3,
    community: 4,
    other: 5,
  };
  if (norm in table) return table[norm];
  fail(`unknown category "${input}". Use an index 0-5 or one of: ${CATEGORIES.join(", ")}`);
}

function fmtReceipt(r) {
  const when = (t) => (t === 0n ? "—" : new Date(Number(t) * 1000).toISOString());
  return {
    id: r.id.toString(),
    issuer: r.issuer,
    recipient: r.recipient,
    category: `${r.category} (${CATEGORIES[Number(r.category)] || "?"})`,
    title: r.title,
    evidenceURI: r.evidenceURI,
    issuedAt: when(r.issuedAt),
    confirmedAt: when(r.confirmedAt),
    status: `${r.status} (${STATUSES[Number(r.status)] || "?"})`,
  };
}

async function pendingInboxCount(addr) {
  const ids = await apRead("receivedIdsOf", [addr, 0n, 500n]);
  let pending = 0;
  for (const id of ids) {
    const r = await apRead("getReceipt", [id]);
    if (Number(r.status) === 0) pending++;
  }
  return { receivedTotal: ids.length, pending };
}

async function holderInfo(addr) {
  const holder = await apRead("hasAgentId", [addr]);
  let handle = null;
  if (holder) {
    try {
      handle = await regRead("handleOf", [addr]);
    } catch {
      handle = null;
    }
  }
  return { holder, handle };
}

async function reputation(addr) {
  const [receivedConfirmed, issuedConfirmed, issuedTotal] = await apRead("reputationOf", [addr]);
  return {
    receivedConfirmed: receivedConfirmed.toString(),
    issuedConfirmed: issuedConfirmed.toString(),
    issuedTotal: issuedTotal.toString(),
  };
}

// ------------------------------------------------------------------ preview

function runPreview({ from, calldata, decoded }) {
  const args = [
    "contract-call", "preview",
    "--binanceChainId", String(CHAIN_ID),
    "--from", from,
    "--to", AGENTPROOF,
    "--value", "0",
    "--inputData", calldata,
    "--json",
  ];
  const j = runBaw(args);
  console.log("— Decoded call ————————————————————————————————");
  for (const [k, v] of Object.entries(decoded)) console.log(`  ${k}: ${v}`);
  console.log(`  value: 0 (always)`);
  console.log("— baw preview verdict ———————————————————————————");
  if (!j.success) {
    console.log(JSON.stringify(j, null, 2));
    fail("baw preview did not succeed — nothing to execute. Show the user this error.");
  }
  const d = j.data || {};
  const sim = d.simulationResult || {};
  const risks = d.risks || {};
  const riskCount = (risks.riskDetails || []).length + (risks.riskBehaviors || []).length;
  const allowance = sim.allowanceChanges || [];
  const authority = sim.authorityChanges || [];
  console.log(`  requestId:          ${d.requestId}`);
  console.log(`  expiresAt:          ${d.expiresAt ? new Date(d.expiresAt).toISOString() : "?"} (${d.expiresAt})`);
  console.log(`  simulationCode:     ${sim.simulationCode}`);
  console.log(`  simulationError:    ${sim.simulationErrorDetail || "none"}`);
  console.log(`  balanceChanges:     ${JSON.stringify(sim.balanceChanges || [])}`);
  console.log(`  allowanceChanges:   ${JSON.stringify(allowance)}${allowance.length ? "  <-- WARNING: expected EMPTY" : ""}`);
  console.log(`  authorityChanges:   ${JSON.stringify(authority)}${authority.length ? "  <-- WARNING: expected EMPTY" : ""}`);
  console.log(`  risks:              ${riskCount === 0 ? "none" : JSON.stringify(risks)}`);
  console.log(`  requireConfirmation:${d.requireConfirmation}`);
  console.log("——————————————————————————————————————————————————");
  console.log(
    "PREVIEW ONLY — nothing was broadcast and no app notification was created.\n" +
      "Show this summary to the user. Execute ONLY on their explicit go-ahead:\n" +
      `  node agent/agentproof.js execute ${d.requestId}`
  );
  return d;
}

// ----------------------------------------------------------------- commands

async function cmdStatus(argv) {
  let addr = null;
  const ai = argv.indexOf("--address");
  if (ai >= 0) addr = argv[ai + 1];
  let bawStatus = null;
  try {
    bawStatus = bawWalletStatus();
  } catch {
    bawStatus = "UNAVAILABLE";
  }
  if (!addr) {
    if (bawStatus !== "CONNECTED") {
      console.log(`baw wallet status: ${bawStatus}`);
      fail("no --address given and the baw wallet is not CONNECTED, so no wallet address can be determined. Re-pair/connect in the Binance App, or pass --address <addr> for a read-only status.");
    }
    addr = bawWalletAddress();
    if (!addr) fail("baw is CONNECTED but returned no EVM address.");
  }
  addr = ethers.getAddress(addr);
  const { holder, handle } = await holderInfo(addr);
  const rep = await reputation(addr);
  const inbox = await pendingInboxCount(addr);
  console.log(`address:            ${addr}`);
  console.log(`baw wallet status:  ${bawStatus}`);
  console.log(`Agent ID holder:    ${holder}${handle ? ` (handle: ${handle}.ai)` : ""}`);
  console.log(`reputation:         receivedConfirmed=${rep.receivedConfirmed} issuedConfirmed=${rep.issuedConfirmed} issuedTotal=${rep.issuedTotal}`);
  console.log(`inbox:              ${inbox.receivedTotal} received, ${inbox.pending} pending confirmation`);
}

async function cmdFeed(argv) {
  let limit = 10;
  const li = argv.indexOf("--limit");
  if (li >= 0) limit = Math.max(1, parseInt(argv[li + 1], 10) || 10);
  const total = await apRead("totalReceipts", []);
  const n = Number(total);
  console.log(`totalReceipts: ${n}`);
  if (n === 0) {
    console.log("No receipts yet.");
    return;
  }
  const rows = [];
  for (let id = n - 1; id >= 0 && rows.length < limit; id--) {
    rows.push(fmtReceipt(await apRead("getReceipt", [BigInt(id)])));
  }
  console.log(JSON.stringify(rows, null, 2));
}

async function cmdReputation(argv) {
  const addr = argv[0];
  if (!addr || !ethers.isAddress(addr)) fail("usage: reputation <address>");
  const a = ethers.getAddress(addr);
  const { holder, handle } = await holderInfo(a);
  const rep = await reputation(a);
  console.log(`address:            ${a}`);
  console.log(`Agent ID holder:    ${holder}${handle ? ` (handle: ${handle}.ai)` : ""}`);
  console.log(`receivedConfirmed:  ${rep.receivedConfirmed}`);
  console.log(`issuedConfirmed:    ${rep.issuedConfirmed}`);
  console.log(`issuedTotal:        ${rep.issuedTotal}`);
}

function takeFromFlag(argv) {
  const fi = argv.indexOf("--from");
  if (fi < 0) return { from: null, rest: argv };
  const from = argv[fi + 1];
  return { from, rest: argv.filter((_, i) => i !== fi && i !== fi + 1) };
}

async function cmdPreviewIssue(argv) {
  const { from: flagFrom, rest } = takeFromFlag(argv);
  const [recipientRaw, categoryRaw, title, evidenceRaw] = rest;
  if (!recipientRaw || categoryRaw === undefined || !title) {
    fail('usage: preview-issue <recipient> <categoryIndexOrName> <title> [evidenceURI] [--from <addr>]');
  }
  if (!ethers.isAddress(recipientRaw)) fail(`recipient is not a valid address: ${recipientRaw}`);
  const recipient = ethers.getAddress(recipientRaw);
  const category = parseCategory(categoryRaw);
  const evidence = evidenceRaw || "";
  if (Buffer.byteLength(title, "utf8") < 1 || Buffer.byteLength(title, "utf8") > 140) {
    fail("title must be 1-140 bytes (contract limit).");
  }
  if (Buffer.byteLength(evidence, "utf8") > 200) fail("evidenceURI must be <= 200 bytes (contract limit).");

  // Pre-flight refusals — checked on-chain BEFORE involving baw at all.
  // Recipient first: this refusal must fire even if the wallet is offline.
  const recip = await holderInfo(recipient);
  if (!recip.holder) {
    fail(`refusing to preview: recipient ${recipient} does not hold an Agent ID — issueReceipt would revert on-chain. No baw preview was called.`);
  }

  const from = resolveSender(flagFrom);

  const sender = await holderInfo(from);
  if (!sender.holder) fail(`refusing to preview: sender ${from} does not hold an Agent ID — issueReceipt would revert on-chain.`);
  if (recipient.toLowerCase() === from.toLowerCase()) {
    fail(`refusing to preview: recipient ${recipient} is the sender — AgentProof forbids issuing a receipt to yourself. No baw preview was called.`);
  }

  const calldata = iface.encodeFunctionData("issueReceipt", [recipient, category, title, evidence]);
  runPreview({
    from,
    calldata,
    decoded: {
      contract: `${AGENTPROOF} (AgentProof)`,
      from,
      function: "issueReceipt(address,uint8,string,string)",
      recipient: `${recipient}${recip.handle ? ` (${recip.handle}.ai)` : ""}`,
      category: `${category} (${CATEGORIES[category]})`,
      title,
      evidenceURI: evidence || "(none)",
    },
  });
}

async function loadReceiptOrFail(idRaw) {
  if (idRaw === undefined || !/^\d+$/.test(String(idRaw))) fail("receipt id must be a non-negative integer.");
  const total = await apRead("totalReceipts", []);
  const id = BigInt(idRaw);
  if (id >= total) fail(`refusing to preview: receipt ${idRaw} does not exist (totalReceipts=${total}). No baw preview was called.`);
  return { id, receipt: await apRead("getReceipt", [id]) };
}

async function cmdPreviewConfirm(argv) {
  const { from: flagFrom, rest } = takeFromFlag(argv);
  const { id, receipt } = await loadReceiptOrFail(rest[0]);
  const from = resolveSender(flagFrom);
  if (Number(receipt.status) !== 0) {
    fail(`refusing to preview: receipt ${id} is ${STATUSES[Number(receipt.status)]}, not Pending — confirmReceipt would revert. No baw preview was called.`);
  }
  if (receipt.recipient.toLowerCase() !== from.toLowerCase()) {
    fail(`refusing to preview: receipt ${id} is addressed to ${receipt.recipient}, not to the sender ${from} — only the recipient can confirm. No baw preview was called.`);
  }
  const calldata = iface.encodeFunctionData("confirmReceipt", [id]);
  runPreview({
    from,
    calldata,
    decoded: {
      contract: `${AGENTPROOF} (AgentProof)`,
      from,
      function: "confirmReceipt(uint256)",
      receiptId: id.toString(),
      title: receipt.title,
      issuer: receipt.issuer,
    },
  });
}

async function cmdPreviewCancel(argv) {
  const { from: flagFrom, rest } = takeFromFlag(argv);
  const { id, receipt } = await loadReceiptOrFail(rest[0]);
  const from = resolveSender(flagFrom);
  if (Number(receipt.status) !== 0) {
    fail(`refusing to preview: receipt ${id} is ${STATUSES[Number(receipt.status)]}, not Pending — cancelReceipt would revert. No baw preview was called.`);
  }
  if (receipt.issuer.toLowerCase() !== from.toLowerCase()) {
    fail(`refusing to preview: receipt ${id} was issued by ${receipt.issuer}, not by the sender ${from} — only the issuer can cancel. No baw preview was called.`);
  }
  const calldata = iface.encodeFunctionData("cancelReceipt", [id]);
  runPreview({
    from,
    calldata,
    decoded: {
      contract: `${AGENTPROOF} (AgentProof)`,
      from,
      function: "cancelReceipt(uint256)",
      receiptId: id.toString(),
      title: receipt.title,
      recipient: receipt.recipient,
    },
  });
}

/**
 * Execute a previously previewed request. Fully implemented, but ONLY to be
 * run on the user's explicit go-ahead after they have seen the preview
 * summary (see agent/SKILL.md). After broadcast it polls the receipt and
 * verifies the on-chain effect of the exact function that was called.
 */
async function cmdExecute(argv) {
  const requestId = argv[0];
  if (!requestId) fail("usage: execute <requestId>");
  const j = runBaw(["contract-call", "execute", "--requestId", requestId, "--json"]);
  console.log(JSON.stringify(j, null, 2));
  if (!j.success) fail("baw execute did not succeed.");
  const d = j.data || {};
  console.log(`orderId: ${d.orderId || "?"}`);
  console.log(`status:  ${d.status || "?"}`);
  if (d.status === "PENDING_CONFIRMATION") {
    console.log(
      "Waiting for the user to confirm in the Binance App. Once they tap confirm, " +
        "re-check the transaction in the app or on BscScan — no tx hash exists yet."
    );
    return;
  }
  const txHash = d.txHash;
  if (!txHash) {
    console.log("No tx hash returned yet — the order may still be processing. Check the Binance App / BscScan shortly.");
    return;
  }
  console.log(`txHash:  ${txHash}`);
  console.log(`BscScan: ${BSCSCAN}/tx/${txHash}`);

  const p = await provider();
  let rcpt = null;
  for (let i = 0; i < 30 && !rcpt; i++) {
    rcpt = await p.getTransactionReceipt(txHash);
    if (!rcpt) await new Promise((r) => setTimeout(r, 3000));
  }
  if (!rcpt) fail("tx not mined within ~90s — check BscScan for its final status.");
  console.log(`mined:   block ${rcpt.blockNumber}, status ${rcpt.status === 1 ? "SUCCESS" : "FAILED"}, gasUsed ${rcpt.gasUsed}`);
  if (rcpt.status !== 1) fail("transaction reverted on-chain.");

  // Verify the effect of the exact call that was broadcast.
  const tx = await p.getTransaction(txHash);
  const parsed = iface.parseTransaction({ data: tx.data, value: tx.value });
  if (parsed) {
    if (parsed.name === "issueReceipt") {
      const total = await apRead("totalReceipts", []);
      const id = total - 1n;
      const r = await apRead("getReceipt", [id]);
      console.log(`verified: totalReceipts=${total}; newest receipt #${id} issuer=${r.issuer} recipient=${r.recipient} status=${STATUSES[Number(r.status)]}`);
    } else if (parsed.name === "confirmReceipt" || parsed.name === "cancelReceipt") {
      const id = parsed.args[0];
      const r = await apRead("getReceipt", [id]);
      console.log(`verified: receipt #${id} status is now ${STATUSES[Number(r.status)]}`);
    }
  }
}

// --------------------------------------------------------------------- main

const HELP = `AgentProof agent interface (baw) — usage:
  node agent/agentproof.js status [--address <addr>]
  node agent/agentproof.js feed [--limit n]
  node agent/agentproof.js reputation <address>
  node agent/agentproof.js preview-issue <recipient> <categoryIndexOrName> <title> [evidenceURI] [--from <addr>]
  node agent/agentproof.js preview-confirm <receiptId> [--from <addr>]
  node agent/agentproof.js preview-cancel <receiptId> [--from <addr>]
  node agent/agentproof.js execute <requestId>          (ONLY on the user's explicit go-ahead)

Categories: ${CATEGORIES.map((c, i) => `${i}=${c}`).join(" · ")}
Contract: ${AGENTPROOF} (BNB Chain, chainId 56)`;

(async () => {
  const [cmd, ...argv] = process.argv.slice(2);
  try {
    switch (cmd) {
      case "status": await cmdStatus(argv); break;
      case "feed": await cmdFeed(argv); break;
      case "reputation": await cmdReputation(argv); break;
      case "preview-issue": await cmdPreviewIssue(argv); break;
      case "preview-confirm": await cmdPreviewConfirm(argv); break;
      case "preview-cancel": await cmdPreviewCancel(argv); break;
      case "execute": await cmdExecute(argv); break;
      case undefined:
      case "help":
      case "--help":
        console.log(HELP);
        break;
      default:
        fail(`unknown command "${cmd}".\n${HELP}`);
    }
  } catch (e) {
    fail(e && e.message ? e.message : String(e));
  }
})();
