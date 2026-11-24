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

const publicClient = createPublicClient({ chain: CHAIN, transport: http() });

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function fmtTime(unix: bigint) {
  if (unix === 0n) return "—";
  return new Date(Number(unix) * 1000).toLocaleString();
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

  // issue form
  const [fRecipient, setFRecipient] = useState("");
  const [fCategory, setFCategory] = useState(0);
  const [fTitle, setFTitle] = useState("");
  const [fEvidence, setFEvidence] = useState("");

  // reputation lookup
  const [lookup, setLookup] = useState("");
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
    if (!AGENTPROOF_DEPLOYED) return;
    const total = await publicClient.readContract({
      address: AGENTPROOF_ADDRESS,
      abi: agentProofAbi,
      functionName: "totalReceipts",
    });
    const n = Number(total);
    const ids = Array.from({ length: Math.min(n, 10) }, (_, i) => BigInt(n - 1 - i));
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
  }, []);

  const loadMine = useCallback(
    async (me: Address) => {
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
    },
    []
  );

  useEffect(() => {
    loadFeed().catch(() => {});
  }, [loadFeed]);

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
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0x38" }],
        });
      }
      const me = accounts[0] as Address;
      setAccount(me);
      await loadMine(me);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection failed");
    }
  }

  async function write(fn: "issueReceipt" | "confirmReceipt" | "cancelReceipt", args: unknown[]) {
    if (!walletClient || !account) return;
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transaction failed");
    } finally {
      setBusy("");
    }
  }

  async function submitIssue(ev: React.FormEvent) {
    ev.preventDefault();
    if (!isAddress(fRecipient)) {
      setError("Recipient is not a valid address.");
      return;
    }
    await write("issueReceipt", [fRecipient, fCategory, fTitle.trim(), fEvidence.trim()]);
    setFTitle("");
    setFEvidence("");
  }

  async function submitLookup(ev: React.FormEvent) {
    ev.preventDefault();
    setError("");
    if (!isAddress(lookup)) {
      setError("Enter a valid wallet address to look up its AgentProof reputation.");
      return;
    }
    try {
      const isHolder = await publicClient.readContract({
        address: AGENTPROOF_ADDRESS,
        abi: agentProofAbi,
        functionName: "hasAgentId",
        args: [lookup as Address],
      });
      const [received, issuedConfirmed, issuedTotal] = await publicClient.readContract({
        address: AGENTPROOF_ADDRESS,
        abi: agentProofAbi,
        functionName: "reputationOf",
        args: [lookup as Address],
      });
      setRep({ address: lookup, isHolder, received, issuedConfirmed, issuedTotal });
    } catch {
      setRep(null);
      setError(
        AGENTPROOF_DEPLOYED
          ? "Lookup failed."
          : "AgentProof contract is not deployed yet — reputation lookup goes live after deployment."
      );
    }
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

      {account && (
        <section>
          <h2>Your Agent ID</h2>
          {holder === null ? (
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
      )}

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
              required
            />
          </label>
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
              onChange={(e) => setFTitle(e.target.value)}
              maxLength={140}
              placeholder="e.g. Delivered the contract audit report"
              required
            />
          </label>
          <label>
            Evidence link / note (optional, ≤200 characters)
            <input
              value={fEvidence}
              onChange={(e) => setFEvidence(e.target.value)}
              maxLength={200}
              placeholder="ipfs://…, https://…, or a tx hash"
            />
          </label>
          <button type="submit" disabled={!account || !holder || busy !== "" || !AGENTPROOF_DEPLOYED}>
            {busy === "issueReceipt" ? "Confirm in your wallet…" : "Issue receipt"}
          </button>
          <p className="meta">
            You confirm this transaction in your own wallet. AgentProof never moves funds —
            the contract has no payable functions at all.
          </p>
        </form>
      </section>

      {account && (
        <section>
          <h2>Inbox — receipts waiting for you</h2>
          {inbox.filter((r) => r.status === 0).length === 0 && <p className="meta">Nothing pending.</p>}
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
          {issued.length === 0 && <p className="meta">None yet.</p>}
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
            />
          </label>
          <button type="submit">Look up</button>
          <p className="meta">
            This shows the AgentProof reputation counters of an address you supply. It is{" "}
            <strong>not</strong> a name-to-wallet lookup — AgentProof never resolves Agent ID
            names to wallets.
          </p>
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
        {feed.length === 0 && (
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
