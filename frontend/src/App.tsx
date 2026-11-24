import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  isAddress,
  type Address,
} from "viem";
import {
  AGENT_ID_REGISTRY,
  AGENTPROOF_ADDRESS,
  AGENTPROOF_DEPLOYED,
  CATEGORIES,
  CHAIN,
  STATUSES,
} from "./config";
import { agentProofAbi, registryAbi } from "./abi";

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown }) => Promise<unknown>;
      on?: (event: string, handler: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
    };
  }
}

type Receipt = {
  id: bigint;
  issuer: Address;
  recipient: Address;
  category: number;
  title: string;
  evidenceURI: string;
  issuedAt: bigint;
  confirmedAt: bigint;
  status: number;
};

// Live Agent ID check for the Issue form's recipient field. "unknown" means
// the read itself failed (RPC/network) — it must never hard-block the form,
// because the contract re-checks holder status on-chain anyway.
type RecipientCheck = {
  status: "idle" | "invalid" | "checking" | "holder" | "nonholder" | "self" | "unknown";
  address: string;
};

const publicClient = createPublicClient({ chain: CHAIN, transport: http() });

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function fmtTime(unix: bigint) {
  if (unix === 0n) return "—";
  return new Date(Number(unix) * 1000).toLocaleString();
}

function errorCode(e: unknown): number | undefined {
  if (typeof e === "object" && e !== null && "code" in e) {
    const c = (e as { code?: unknown }).code;
    return typeof c === "number" ? c : undefined;
  }
  return undefined;
}

export default function App() {
  const [account, setAccount] = useState<Address | null>(null);
  const [holder, setHolder] = useState<boolean | null>(null);
  const [handle, setHandle] = useState<string>("");
  const [busy, setBusy] = useState<string>("");
  const [error, setError] = useState<string>("");

  const [inbox, setInbox] = useState<Receipt[]>([]);
  const [issued, setIssued] = useState<Receipt[]>([]);
  const [feed, setFeed] = useState<Receipt[]>([]);
  const [feedLoading, setFeedLoading] = useState<boolean>(AGENTPROOF_DEPLOYED);
  const [feedError, setFeedError] = useState(false);
  const [mineLoading, setMineLoading] = useState(false);
  const [mineError, setMineError] = useState(false);

  // issue form
  const [fRecipient, setFRecipient] = useState("");
  const [fCategory, setFCategory] = useState(0);
  const [fTitle, setFTitle] = useState("");
  const [fEvidence, setFEvidence] = useState("");
  const [recipientCheck, setRecipientCheck] = useState<RecipientCheck>({
    status: "idle",
    address: "",
  });

  // reputation lookup
  const [lookup, setLookup] = useState("");
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [rep, setRep] = useState<{
    address: string;
    isHolder: boolean;
    received: bigint;
    issuedConfirmed: bigint;
    issuedTotal: bigint;
  } | null>(null);

  const walletClient = useMemo(() => {
    if (!window.ethereum) return null;
    return createWalletClient({ chain: CHAIN, transport: custom(window.ethereum) });
  }, [account]);

  const loadFeed = useCallback(async () => {
    if (!AGENTPROOF_DEPLOYED) {
      setFeedLoading(false);
      return;
    }
    setFeedLoading(true);
    setFeedError(false);
    try {
      const total = await publicClient.readContract({
        address: AGENTPROOF_ADDRESS,
        abi: agentProofAbi,
        functionName: "totalReceipts",
      });
      // BigInt-safe windowing: at most the 10 newest receipts, and a total
      // of 0 yields an empty id list (no negative indexes).
      const count = total > 10n ? 10 : Number(total);
      const ids = Array.from({ length: count }, (_, i) => total - 1n - BigInt(i));
      const rows = await Promise.all(
        ids.map((id) =>
          publicClient.readContract({
            address: AGENTPROOF_ADDRESS,
            abi: agentProofAbi,
            functionName: "getReceipt",
            args: [id],
          })
        )
      );
      setFeed(rows as unknown as Receipt[]);
    } catch {
      setFeedError(true);
    } finally {
      setFeedLoading(false);
    }
  }, []);

  const loadMine = useCallback(async (me: Address) => {
    setMineLoading(true);
    setMineError(false);
    try {
      const bal = await publicClient.readContract({
        address: AGENT_ID_REGISTRY,
        abi: registryAbi,
        functionName: "balanceOf",
        args: [me],
      });
      setHolder(bal > 0n);
      if (bal > 0n) {
        try {
          const h = await publicClient.readContract({
            address: AGENT_ID_REGISTRY,
            abi: registryAbi,
            functionName: "handleOf",
            args: [me],
          });
          setHandle(h);
        } catch {
          setHandle("");
        }
      } else {
        setHandle("");
      }
      if (!AGENTPROOF_DEPLOYED) return;
      const [recvIds, issIds] = await Promise.all([
        publicClient.readContract({
          address: AGENTPROOF_ADDRESS,
          abi: agentProofAbi,
          functionName: "receivedIdsOf",
          args: [me, 0n, 50n],
        }),
        publicClient.readContract({
          address: AGENTPROOF_ADDRESS,
          abi: agentProofAbi,
          functionName: "issuedIdsOf",
          args: [me, 0n, 50n],
        }),
      ]);
      const fetchAll = (ids: readonly bigint[]) =>
        Promise.all(
          ids.map((id) =>
            publicClient.readContract({
              address: AGENTPROOF_ADDRESS,
              abi: agentProofAbi,
              functionName: "getReceipt",
              args: [id],
            })
          )
        );
      setInbox((await fetchAll(recvIds)) as unknown as Receipt[]);
      setIssued((await fetchAll(issIds)) as unknown as Receipt[]);
    } catch {
      setMineError(true);
    } finally {
      setMineLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  // Follow wallet account/chain changes while the page is open, and remove
  // the listeners on unmount so they don't stack up (React StrictMode
  // mounts effects twice in dev).
  useEffect(() => {
    const eth = window.ethereum;
    if (!eth?.on) return;
    const onAccountsChanged = (...args: unknown[]) => {
      const accounts = Array.isArray(args[0]) ? (args[0] as string[]) : [];
      if (accounts.length === 0) {
        setAccount(null);
        setHolder(null);
        setHandle("");
        setInbox([]);
        setIssued([]);
      } else {
        const me = accounts[0] as Address;
        setAccount(me);
        loadMine(me);
      }
    };
    const onChainChanged = (...args: unknown[]) => {
      if (args[0] !== "0x38") {
        setError(
          "You switched away from BNB Chain — switch back to BNB Chain (56) in your wallet to issue or confirm receipts."
        );
      } else {
        setError("");
        loadFeed();
      }
    };
    eth.on("accountsChanged", onAccountsChanged);
    eth.on("chainChanged", onChainChanged);
    return () => {
      eth.removeListener?.("accountsChanged", onAccountsChanged);
      eth.removeListener?.("chainChanged", onChainChanged);
    };
  }, [loadMine, loadFeed]);

  // Debounced recipient pre-check for the Issue form. Runs the cheap
  // hasAgentId read before the user ever signs, so the most common failed
  // transaction (recipient is not an Agent ID holder) is caught in the UI.
  useEffect(() => {
    const raw = fRecipient.trim();
    if (!raw) {
      setRecipientCheck({ status: "idle", address: raw });
      return;
    }
    if (!isAddress(raw)) {
      setRecipientCheck({ status: "invalid", address: raw });
      return;
    }
    if (account && raw.toLowerCase() === account.toLowerCase()) {
      setRecipientCheck({ status: "self", address: raw });
      return;
    }
    if (!AGENTPROOF_DEPLOYED) {
      setRecipientCheck({ status: "unknown", address: raw });
      return;
    }
    setRecipientCheck({ status: "checking", address: raw });
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const ok = await publicClient.readContract({
          address: AGENTPROOF_ADDRESS,
          abi: agentProofAbi,
          functionName: "hasAgentId",
          args: [raw as Address],
        });
        if (!cancelled) {
          setRecipientCheck({ status: ok ? "holder" : "nonholder", address: raw });
        }
      } catch {
        if (!cancelled) setRecipientCheck({ status: "unknown", address: raw });
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [fRecipient, account]);

  // Only trust the check result if it was computed for the exact value
  // currently in the field (guards against a brief stale render mid-typing).
  const checkStatus: RecipientCheck["status"] =
    recipientCheck.address === fRecipient.trim() ? recipientCheck.status : "idle";
  const recipientBlocked =
    checkStatus === "nonholder" || checkStatus === "self" || checkStatus === "invalid";

  async function connect() {
    setError("");
    if (!window.ethereum) {
      setError("No injected wallet found. Open this page in MetaMask or the Binance Wallet browser.");
      return;
    }
    try {
      const accounts = (await window.ethereum.request({
        method: "eth_requestAccounts",
      })) as string[];
      // Make sure we are on BNB Chain (56 / 0x38); user confirms any switch in their wallet.
      const chainId = (await window.ethereum.request({ method: "eth_chainId" })) as string;
      if (chainId !== "0x38") {
        try {
          await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: "0x38" }],
          });
        } catch {
          setError(
            "Please switch to BNB Chain (56) in your wallet — AgentProof only works on BNB Chain."
          );
          return;
        }
      }
      const me = accounts[0] as Address;
      setAccount(me);
      await loadMine(me);
    } catch (e) {
      if (errorCode(e) === 4001) {
        setError("Connection request was rejected in your wallet — nothing was connected.");
      } else {
        setError(e instanceof Error ? e.message : "Connection failed");
      }
    }
  }

  async function write(
    fn: "issueReceipt" | "confirmReceipt" | "cancelReceipt",
    args: unknown[]
  ): Promise<boolean> {
    if (!walletClient || !account) return false;
    setBusy(fn);
    setError("");
    try {
      const hash = await walletClient.writeContract({
        address: AGENTPROOF_ADDRESS,
        abi: agentProofAbi,
        functionName: fn,
        args: args as never,
        account,
        chain: CHAIN,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      await loadMine(account);
      await loadFeed();
      return true;
    } catch (e) {
      if (errorCode(e) === 4001) {
        setError("Transaction was rejected in your wallet — nothing was sent.");
      } else {
        setError(e instanceof Error ? e.message : "Transaction failed");
      }
      return false;
    } finally {
      setBusy("");
    }
  }

  async function submitIssue(ev: React.FormEvent) {
    ev.preventDefault();
    const recipient = fRecipient.trim();
    if (!isAddress(recipient)) {
      setError("Recipient is not a valid address.");
      return;
    }
    if (account && recipient.toLowerCase() === account.toLowerCase()) {
      setError("You can't issue a receipt to yourself — the contract would reject it.");
      return;
    }
    if (checkStatus === "nonholder") {
      setError("That recipient does not hold an Agent ID — the transaction would fail.");
      return;
    }
    const ok = await write("issueReceipt", [
      recipient,
      fCategory,
      fTitle.trim(),
      fEvidence.trim(),
    ]);
    // Only clear the form when the receipt actually landed; on failure the
    // user keeps their text and can fix/retry instead of retyping.
    if (ok) {
      setFTitle("");
      setFEvidence("");
    }
  }

  async function doLookup(target: string) {
    const addr = target.trim();
    setLookupError("");
    if (!isAddress(addr)) {
      setRep(null);
      setLookupError("Enter a valid wallet address to look up its AgentProof reputation.");
      return;
    }
    setLookupBusy(true);
    try {
      const isHolder = await publicClient.readContract({
        address: AGENTPROOF_ADDRESS,
        abi: agentProofAbi,
        functionName: "hasAgentId",
        args: [addr as Address],
      });
      const [received, issuedConfirmed, issuedTotal] = await publicClient.readContract({
        address: AGENTPROOF_ADDRESS,
        abi: agentProofAbi,
        functionName: "reputationOf",
        args: [addr as Address],
      });
      setRep({ address: addr, isHolder, received, issuedConfirmed, issuedTotal });
    } catch {
      setRep(null);
      setLookupError(
        AGENTPROOF_DEPLOYED
          ? "Lookup failed — the contract could not be read. Check your connection and try again."
          : "AgentProof contract is not deployed yet — reputation lookup goes live after deployment."
      );
    } finally {
      setLookupBusy(false);
    }
  }

  async function submitLookup(ev: React.FormEvent) {
    ev.preventDefault();
    await doLookup(lookup);
  }

  const receiptCard = (r: Receipt, actions?: React.ReactNode) => (
    <div className="card" key={r.id.toString()}>
      <div className="row">
        <strong>#{r.id.toString()}</strong>
        <span className={`badge s${r.status}`}>{STATUSES[r.status]}</span>
        <span className="badge">{CATEGORIES[r.category]}</span>
      </div>
      <p className="title">{r.title}</p>
      <p className="meta">
        From {short(r.issuer)} → To {short(r.recipient)} · Issued {fmtTime(r.issuedAt)}
        {r.status === 1 && <> · Confirmed {fmtTime(r.confirmedAt)}</>}
      </p>
      {r.evidenceURI && (
        <p className="meta">
          Evidence:{" "}
          {r.evidenceURI.startsWith("http") ? (
            <a href={r.evidenceURI} target="_blank" rel="noreferrer">
              {r.evidenceURI}
            </a>
          ) : (
            r.evidenceURI
          )}
        </p>
      )}
      {actions}
    </div>
  );

  return (
    <div className="page">
      <header>
        <h1>AgentProof</h1>
        <p className="tagline">
          On-chain work receipts between Agent ID holders on BNB Chain. Issue a receipt when
          someone delivers; they confirm it; the confirmation builds reputation that is tied
          to a non-transferable Agent ID — so it can't be bought or moved.
        </p>
        {!account ? (
          <button onClick={connect}>Connect wallet</button>
        ) : (
          <p className="meta">
            Connected: {short(account)} (BNB Chain)
          </p>
        )}
        {error && <p className="error">{error}</p>}
      </header>

      <section>
        <h2>Your Agent ID status</h2>
        {!account ? (
          <div className="card placeholder">
            <p>Connect your wallet to see your Agent ID status.</p>
            <p className="meta">
              Once connected, this card shows whether your wallet holds an Agent ID — and
              your handle — verified against the SPACE ID Agent ID registry. Your Inbox
              below also appears after connecting.
            </p>
          </div>
        ) : mineError && holder === null ? (
          <div className="card warn">
            <p className="error">Couldn't check your Agent ID status.</p>
            <button onClick={() => account && loadMine(account)}>Retry</button>
          </div>
        ) : holder === null ? (
          <p>Checking…</p>
        ) : holder ? (
          <div className="card">
            <p>
              Agent ID holder ✓{handle ? <> — <strong>{handle}.ai</strong></> : null}
            </p>
            <p className="meta">
              Verified against the SPACE ID Agent ID registry ({short(AGENT_ID_REGISTRY)}).
            </p>
          </div>
        ) : (
          <div className="card">
            <p>This wallet holds no Agent ID yet.</p>
            <p className="meta">
              Agent IDs can only be claimed inside the Binance App: Wallet → homepage
              banner → Agent ID. Come back with the same wallet once you have one — both
              issuing and receiving receipts require an Agent ID.
            </p>
          </div>
        )}
      </section>

      {!AGENTPROOF_DEPLOYED && (
        <section>
          <div className="card warn">
            <p>
              <strong>Pre-deployment build:</strong> the AgentProof contract address is a
              placeholder in <code>src/config.ts</code>. Reads/writes below activate once the
              deployed address is filled in.
            </p>
          </div>
        </section>
      )}

      <section>
        <h2>Issue a receipt</h2>
        <form onSubmit={submitIssue} className="card">
          <label>
            Recipient wallet address (must hold an Agent ID)
            <input
              value={fRecipient}
              onChange={(e) => setFRecipient(e.target.value)}
              placeholder="0x…"
              autoComplete="off"
              spellCheck={false}
              required
            />
          </label>
          {checkStatus === "invalid" && (
            <p className="field-error">That doesn't look like a valid wallet address.</p>
          )}
          {checkStatus === "checking" && (
            <p className="meta">Checking whether this address holds an Agent ID…</p>
          )}
          {checkStatus === "holder" && (
            <p className="field-ok">Agent ID holder ✓ — this address can receive a receipt.</p>
          )}
          {checkStatus === "nonholder" && (
            <p className="field-error">
              This address does not hold an Agent ID — the transaction would fail. Receipts
              can only be issued to Agent ID holders.
            </p>
          )}
          {checkStatus === "self" && (
            <p className="field-error">
              That's your own address — you can't issue a receipt to yourself.
            </p>
          )}
          {checkStatus === "unknown" && (
            <p className="meta">
              Couldn't verify this address's Agent ID status (the network read failed) — you
              can still try; the contract enforces the holder check on-chain.
            </p>
          )}
          <label>
            Category
            <select value={fCategory} onChange={(e) => setFCategory(Number(e.target.value))}>
              {CATEGORIES.map((c, i) => (
                <option key={c} value={i}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label>
            What was delivered? (1–140 characters)
            <input
              value={fTitle}
              onChange={(e) => setFTitle(e.target.value.slice(0, 140))}
              maxLength={140}
              placeholder="e.g. Delivered the contract audit report"
              required
            />
            <span className="counter">{fTitle.length}/140</span>
          </label>
          <label>
            Evidence link / note (optional, ≤200 characters)
            <input
              value={fEvidence}
              onChange={(e) => setFEvidence(e.target.value.slice(0, 200))}
              maxLength={200}
              placeholder="ipfs://…, https://…, or a tx hash"
            />
            <span className="counter">{fEvidence.length}/200</span>
          </label>
          <button
            type="submit"
            disabled={
              !account || !holder || busy !== "" || !AGENTPROOF_DEPLOYED || recipientBlocked
            }
          >
            {busy === "issueReceipt" ? "Confirm in your wallet…" : "Issue receipt"}
          </button>
          <p className="meta">
            You confirm this transaction in your own wallet. AgentProof never moves funds —
            the contract has no payable functions at all.
          </p>
        </form>
      </section>

      <section>
        <h2>Use AgentProof through your agent</h2>
        <div className="card">
          <p>
            If you run an agent with the Binance Agentic Wallet (<code>baw</code>), you
            never need this page. Give your agent the AgentProof skill and a one-line
            instruction — it previews the call, you confirm, done:
          </p>
          <p className="meta">
            Skill:{" "}
            <a
              href="https://github.com/Velt89/agentproof/blob/main/agent/SKILL.md"
              target="_blank"
              rel="noreferrer"
            >
              github.com/Velt89/agentproof/blob/main/agent/SKILL.md
            </a>{" "}
            · Machine-readable manifest: <a href="/agent.json">/agent.json</a>
          </p>
          <p className="meta">
            Example instruction:{" "}
            <em>
              Issue an AgentProof receipt to &lt;address&gt; for "&lt;what was
              delivered&gt;", category Audit / Review, evidence &lt;link&gt;
            </em>
          </p>
          <p className="meta">
            Your agent checks both sides hold an Agent ID, runs a <code>baw</code> preview
            (a simulation — nothing is broadcast), shows you the summary, and only
            executes on your explicit go-ahead. Value is always 0; there are no
            approvals. Confirming receipts sent to you works the same way.
          </p>
        </div>
      </section>

      {!account ? (
        <section>
          <h2>Inbox — receipts waiting for you</h2>
          <div className="card placeholder">
            <p>Connect your wallet to see receipts waiting for you.</p>
            <p className="meta">
              Receipts other Agent ID holders issue to your address appear here, ready for
              you to confirm — confirming is what builds their reputation and yours.
            </p>
          </div>
        </section>
      ) : (
        <section>
          <h2>Inbox — receipts waiting for you</h2>
          {mineLoading && inbox.length === 0 && <p className="meta">Loading…</p>}
          {mineError && (
            <div className="card warn">
              <p className="error">Couldn't load your receipts.</p>
              <button onClick={() => account && loadMine(account)}>Retry</button>
            </div>
          )}
          {!mineLoading && !mineError && inbox.filter((r) => r.status === 0).length === 0 && (
            <p className="meta">Nothing pending.</p>
          )}
          {inbox
            .filter((r) => r.status === 0)
            .map((r) =>
              receiptCard(
                r,
                <button
                  disabled={busy !== ""}
                  onClick={() => write("confirmReceipt", [r.id])}
                >
                  {busy === "confirmReceipt" ? "Confirm in your wallet…" : "Confirm receipt"}
                </button>
              )
            )}
          <h3>Confirmed by you</h3>
          {inbox.filter((r) => r.status === 1).map((r) => receiptCard(r))}
        </section>
      )}

      {account && (
        <section>
          <h2>Receipts you issued</h2>
          {issued.length === 0 && !mineLoading && <p className="meta">None yet.</p>}
          {issued.map((r) =>
            receiptCard(
              r,
              r.status === 0 ? (
                <button disabled={busy !== ""} onClick={() => write("cancelReceipt", [r.id])}>
                  Cancel receipt
                </button>
              ) : undefined
            )
          )}
        </section>
      )}

      <section>
        <h2>Reputation lookup</h2>
        <form onSubmit={submitLookup} className="card">
          <label>
            Wallet address
            <input
              value={lookup}
              onChange={(e) => setLookup(e.target.value)}
              placeholder="0x…"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <button type="submit" disabled={lookupBusy}>
            {lookupBusy ? "Looking up…" : "Look up"}
          </button>
          <p className="meta">
            This shows the AgentProof reputation counters of an address you supply. It is{" "}
            <strong>not</strong> a name-to-wallet lookup — AgentProof never resolves Agent ID
            names to wallets.
          </p>
          {lookupError && (
            <div>
              <p className="error">{lookupError}</p>
              <button type="button" onClick={() => doLookup(lookup)} disabled={lookupBusy}>
                Retry
              </button>
            </div>
          )}
          {rep && (
            <div>
              <p>
                {short(rep.address)} — Agent ID holder: {rep.isHolder ? "yes ✓" : "no"}
              </p>
              <p className="meta">
                Confirmed receipts received: {rep.received.toString()} · Confirmed receipts
                issued: {rep.issuedConfirmed.toString()} · Total issued:{" "}
                {rep.issuedTotal.toString()}
              </p>
            </div>
          )}
        </form>
      </section>

      <section>
        <h2>Recent receipts</h2>
        {feedLoading && feed.length === 0 && <p className="meta">Loading…</p>}
        {feedError && (
          <div className="card warn">
            <p className="error">Couldn't load recent receipts.</p>
            <button onClick={() => loadFeed()}>Retry</button>
          </div>
        )}
        {!feedLoading && !feedError && feed.length === 0 && (
          <p className="meta">
            {AGENTPROOF_DEPLOYED ? "No receipts yet." : "Feed goes live after deployment."}
          </p>
        )}
        {feed.map((r) => receiptCard(r))}
      </section>

      <footer>
        <p className="meta">
          Receipts are attestations by the issuer; AgentProof does not verify the underlying
          work. Confirmation by the recipient is the trust signal. AgentProof promises no
          returns and involves no tokens, payments, or approvals — it only records who
          attested what, between Agent ID holders.
        </p>
        <p className="meta">
          Agent ID registry: {AGENT_ID_REGISTRY} · AgentProof contract:{" "}
          {AGENTPROOF_DEPLOYED ? AGENTPROOF_ADDRESS : "not deployed yet (placeholder in src/config.ts)"}
        </p>
      </footer>
    </div>
  );
}
