import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useHub } from "../HubProvider";
import { useWallet } from "../WalletProvider";
import { parsePubkey } from "../hooks/useDeskTier";
import { useProtocolState } from "../hooks/useProtocolState";
import { useWalletPortfolio } from "../hooks/useWalletPortfolio";
import { ActivateFlow } from "../components/ActivateFlow";
import { WalletConnect } from "../components/WalletConnect";
import { BackLink } from "../components/ui/BackLink";
import { Panel } from "../components/ui/Panel";
import { AddressLink } from "../components/ui/AddressLink";
import { ErrorBox, LoadingBox, UninitializedBox } from "../components/ui/StateBox";
import { StockIcon } from "../components/ui/StockIcon";
import { Turnstile } from "../components/ui/Turnstile";
import { shortKey } from "../lib/format";
import {
  FaucetHttpError,
  dripTokens,
  fetchFaucetStatus,
  TURNSTILE_SITE_KEY,
  type DripResult,
} from "../lib/faucet";

const btn =
  "border px-3 py-1.5 text-xs font-bold disabled:opacity-30 border-emerald-500/60 text-emerald-300 hover:bg-emerald-500/10";

const SOLANA_FAUCET_URL = "https://faucet.solana.com";

/** Mirrors DRIP_UNITS in hubconnect/web/workers/faucet-config.ts — the *server's* per-drip sizes.
 *  Shown to the user before they claim so the "what am I about to get" preview always matches
 *  what `POST /api/faucet/drip` actually mints; the post-drip receipt below uses the live
 *  `dripResult.amounts` from that same response instead of these constants. */
const DRIP_PREVIEW: { symbol: string; amount: string }[] = [
  { symbol: "HUB", amount: "100,000" },
  { symbol: "OTC", amount: "100,000" },
  { symbol: "CRCLx", amount: "10" },
  { symbol: "NVDAx", amount: "10" },
  { symbol: "SPCXx", amount: "10" },
];
const DRIP_COOLDOWN_LABEL = "1 request / wallet / 8h";

/** Compact "icon + amount" chip shared by the pre-drip preview and the post-drip receipt. */
function TokenChip({ symbol, amount }: { symbol: string; amount: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <StockIcon symbol={symbol} className="h-4 w-4" />
      {amount} {symbol}
    </span>
  );
}

/** otchub.dev/drip — the faucet page (backed by the devnet Worker deployed at otchub.dev/devnet
 * + otchub.dev/drip, see wrangler.jsonc's `devnet` env + workers/faucet.ts). Gated on the
 * connected cluster rather than the URL so a dev pointed at devnet from any host sees the same
 * faucet, and mainnet never can. */
export function DripPage() {
  const { cluster } = useHub();
  const wallet = useWallet();
  const qc = useQueryClient();
  const [connectOpen, setConnectOpen] = useState(false);
  const [dripBusy, setDripBusy] = useState(false);
  const [dripErr, setDripErr] = useState<string | null>(null);
  const [dripResult, setDripResult] = useState<DripResult | null>(null);
  // Manual override: drip to any pasted devnet address without connecting a wallet at all. When
  // empty, falls back to the connected wallet (if any) — see `targetAddress` below.
  const [manualAddress, setManualAddress] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  // True once the post-drip desk poll below (`pollForDesk`) has retried and still can't see the
  // freshly-minted desk — swaps the "locating…" spinner for a manual [RECHECK] so the panel never
  // gets stuck forever if the RPC's Core program-account index is unusually slow.
  const [deskPollExhausted, setDeskPollExhausted] = useState(false);
  const activateRef = useRef<HTMLDivElement>(null);

  const status = useQuery({
    queryKey: ["faucet", "status"],
    queryFn: fetchFaucetStatus,
    enabled: cluster === "devnet",
    staleTime: 30_000,
  });

  const trimmedManual = manualAddress.trim();
  const manualKey = trimmedManual ? parsePubkey(trimmedManual) : null;
  const manualInvalid = trimmedManual !== "" && !manualKey;
  const targetAddress = trimmedManual ? (manualKey?.toBase58() ?? null) : wallet.address;
  const requireTurnstile = !!TURNSTILE_SITE_KEY;
  // Activation needs a real signer — only offer the inline step when the drip actually landed on
  // the wallet connected right here (never for a manually-pasted foreign address; that case keeps
  // pointing at the dashboard below, same as before).
  const canActivateInline = !!wallet.address && !!targetAddress && targetAddress === wallet.address;
  const protocol = useProtocolState();
  const protocolState = protocol.status.kind === "ready" ? protocol.status.state : null;
  const portfolio = useWalletPortfolio(canActivateInline ? wallet.address : null, protocolState);
  // The faucet desk the inline activation step targets — resolved from the shared portfolio query.
  const dripDesk = dripResult
    ? (portfolio.data?.desks.find((d) => d.asset === dripResult.desk.asset) ?? null)
    : null;

  useEffect(() => {
    setDripResult(null);
    setDripErr(null);
    setTurnstileToken(null);
    setDeskPollExhausted(false);
  }, [wallet.address, manualAddress]);

  // Freshly-minted Metaplex Core desk assets can lag the RPC's program-account index by a few
  // seconds — a single `portfolio.refetch()` right after the drip lands often still misses it, so
  // ACTIVATE_DESK gets stuck on "locating your new desk…" until *something else* happens to
  // refetch. Poll with backoff (~15s total) instead; give up (and offer a manual recheck) only if
  // the index is still behind after that.
  const DESK_POLL_DELAYS_MS = [500, 1000, 1500, 2500, 4000, 6000];
  const pollForDesk = async (asset: string) => {
    setDeskPollExhausted(false);
    for (const delay of DESK_POLL_DELAYS_MS) {
      await new Promise((r) => setTimeout(r, delay));
      const { data } = await portfolio.refetch();
      if (data?.desks.some((d) => d.asset === asset)) return;
    }
    setDeskPollExhausted(true);
  };

  // Carry the eye straight down to the activation step once the starter kit (and its desk) lands.
  useEffect(() => {
    if (dripResult && canActivateInline) {
      activateRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [dripResult, canActivateInline]);

  if (cluster !== "devnet") {
    return (
      <div className="space-y-2 font-mono">
        <BackLink />
        <Panel title="FAUCET :: DEVNET ONLY">
          <p className="text-xs text-green-400/90">
            This faucet only exists on devnet (otchub.dev/devnet) — it mints test $HUB/$OTC/M.I.M
            ETF basket tokens and Mock OTC Desk NFTs, and is never deployed for mainnet-beta. This
            app is currently connected to <span className="text-amber-300">{cluster}</span>.
          </p>
          <Link to=".." relative="route" className="mt-2 inline-block text-xs text-cyan-300 underline">
            → go to the dashboard
          </Link>
        </Panel>
      </div>
    );
  }

  const runDrip = async () => {
    if (!targetAddress) return setDripErr("connect a wallet or paste a valid devnet address first");
    if (requireTurnstile && !turnstileToken) {
      return setDripErr("complete the verification challenge below first");
    }
    setDripBusy(true);
    setDripErr(null);
    try {
      const result = await dripTokens(targetAddress, turnstileToken ?? undefined);
      setDripResult(result);
      // Refresh $HUB/$OTC/SOL (ActivateFlow's usePayerBalances) right away instead of waiting up
      // to its 20s poll interval; the desk itself is polled separately (see `pollForDesk`) since
      // it commonly lags the balance/token-account state by a few extra seconds.
      if (canActivateInline) {
        void qc.invalidateQueries({ queryKey: ["hub", "payer-balances"] });
        void pollForDesk(result.desk.asset);
      }
    } catch (e) {
      setDripErr(e instanceof FaucetHttpError ? e.message : "drip failed — try again");
    } finally {
      setDripBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-2 font-mono">
      <div className="flex items-center justify-between">
        <BackLink />
        <span className="text-[10px] uppercase tracking-widest text-green-600">
          devnet drip — starter kit
        </span>
      </div>

      <Panel title="1 · WALLET" collapsible>
        {wallet.address ? (
          <div className="flex items-center justify-between text-xs">
            <span>
              connected: <AddressLink address={wallet.address} full />
            </span>
            <button
              type="button"
              onClick={() => wallet.disconnect()}
              className="text-[10px] text-amber-400 underline hover:text-amber-200"
            >
              disconnect
            </button>
          </div>
        ) : connectOpen ? (
          <WalletConnect
            onConnected={(pk) => {
              wallet.connect(pk);
              setConnectOpen(false);
            }}
          />
        ) : (
          <button type="button" onClick={() => setConnectOpen(true)} className={btn}>
            [CONNECT WALLET]
          </button>
        )}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-green-500/10 pt-2 text-[10px] text-green-600">
          <span>or paste a devnet address below — no connection needed</span>
          <a
            href={SOLANA_FAUCET_URL}
            target="_blank"
            rel="noreferrer"
            className="text-cyan-300 underline hover:text-cyan-100"
          >
            need gas SOL? get some free ↗
          </a>
        </div>
        <input
          value={manualAddress}
          onChange={(e) => setManualAddress(e.target.value)}
          placeholder="paste a base58 Solana address..."
          spellCheck={false}
          className={`mt-1 w-full border bg-black px-2 py-1.5 text-xs text-green-400 outline-none placeholder:text-green-500/30 focus:border-green-400 ${
            manualInvalid ? "border-amber-500/60" : "border-green-500/30"
          }`}
        />
        {manualInvalid && (
          <div className="mt-1 text-[10px] text-amber-400">
            ERR: not a valid base58 Solana address
          </div>
        )}
      </Panel>

      <Panel
        title="2 · GET STARTER KIT"
        right={
          status.data
            ? `faucet ${status.data.solLamports / 1e9} SOL`
            : status.isError
              ? "offline"
              : "…"
        }
      >
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-green-300">
          {DRIP_PREVIEW.map((t) => (
            <TokenChip key={t.symbol} symbol={t.symbol} amount={t.amount} />
          ))}
          <span className="inline-flex items-center gap-1 text-amber-300">
            + 1 Mock OTC Desk NFT
          </span>
        </div>
        <div className="mb-2 text-[10px] text-green-700">
          {DRIP_COOLDOWN_LABEL} · desk arrives unactivated (owner must sign{" "}
          <code>activate_tier</code> itself) —{" "}
          {canActivateInline ? "activate it right below after claiming" : (
            <Link to=".." relative="route" className="underline">
              activate it on the dashboard
            </Link>
          )}
          , the same flow a real desk owner follows on mainnet.
        </div>
        {targetAddress && (
          <div className="mb-2 text-[11px] text-green-600">
            dripping to: <AddressLink address={targetAddress} full />
          </div>
        )}
        <Turnstile
          siteKey={TURNSTILE_SITE_KEY}
          onVerify={setTurnstileToken}
          onExpire={() => setTurnstileToken(null)}
          className="mb-2"
        />
        <button
          type="button"
          onClick={runDrip}
          disabled={dripBusy || !targetAddress || (requireTurnstile && !turnstileToken)}
          className={btn}
        >
          {dripBusy ? "[CLAIMING…]" : "[GET STARTER KIT]"}
        </button>
        {dripErr && <div className="mt-2 text-[11px] text-amber-400">ERR: {dripErr}</div>}
        {dripResult && (
          <div className="mt-2 space-y-1.5 border-t border-green-500/10 pt-2 text-[11px] text-green-400/90">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <TokenChip symbol="HUB" amount={dripResult.amounts.hub} />
              <TokenChip symbol="OTC" amount={dripResult.amounts.otc} />
              <TokenChip symbol="CRCLx" amount={dripResult.amounts.crclx} />
              <TokenChip symbol="NVDAx" amount={dripResult.amounts.nvdax} />
              <TokenChip symbol="SPCXx" amount={dripResult.amounts.spcxx} />
              <a
                href={dripResult.explorer}
                target="_blank"
                rel="noreferrer"
                className="text-cyan-300 underline hover:text-cyan-100"
              >
                {shortKey(dripResult.signature, 8)} ↗
              </a>
            </div>
            <div className="flex items-center gap-2 border border-green-500/20 bg-green-500/5 p-1.5">
              {dripDesk?.art?.image ? (
                <img
                  src={dripDesk.art.image}
                  alt={dripDesk.art.name ?? "Mock OTC Desk NFT"}
                  className="h-10 w-10 shrink-0 border border-green-500/30 bg-black object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-10 w-10 shrink-0 items-center justify-center border border-green-500/30 bg-black text-amber-300">
                  <StockIcon symbol="OTC" className="h-6 w-6" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="text-amber-300">
                  Mock OTC Desk #{dripResult.desk.deskNumber} · unactivated
                </div>
                <div className="truncate">
                  <AddressLink address={dripResult.desk.asset} />{" "}
                  <a
                    href={dripResult.desk.explorer}
                    target="_blank"
                    rel="noreferrer"
                    className="text-cyan-300 underline hover:text-cyan-100"
                  >
                    {shortKey(dripResult.desk.signature, 8)} ↗
                  </a>
                </div>
              </div>
            </div>
            {canActivateInline ? (
              <button
                type="button"
                onClick={() =>
                  activateRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
                }
                className="font-bold text-emerald-300 underline hover:text-emerald-100"
              >
                ↓ activate it below
              </button>
            ) : (
              <Link
                to=".."
                relative="route"
                className="font-bold text-emerald-300 underline hover:text-emerald-100"
              >
                → activate it on the dashboard
              </Link>
            )}
          </div>
        )}
      </Panel>

      {dripResult && canActivateInline && wallet.address && (
        <div ref={activateRef} className="space-y-2">
          <Panel
            title="3 · ACTIVATE YOUR DESK"
            right={`desk #${dripResult.desk.deskNumber}`}
          >
            {protocol.status.kind === "ready" ? (
              dripDesk ? (
                <ActivateFlow
                  address={wallet.address}
                  state={protocol.status.state}
                  desk={dripDesk}
                  onChanged={() => {
                    void portfolio.refetch();
                    void qc.invalidateQueries({ queryKey: ["hub", "payer-balances"] });
                  }}
                />
              ) : deskPollExhausted ? (
                <div className="space-y-1.5 text-xs">
                  <div className="text-amber-400">
                    still can't see it — the RPC's desk index can occasionally lag past 15s.
                  </div>
                  <button
                    type="button"
                    onClick={() => void pollForDesk(dripResult.desk.asset)}
                    className={btn}
                  >
                    [RECHECK]
                  </button>
                </div>
              ) : (
                <div className="text-xs text-green-700">locating your new desk…</div>
              )
            ) : protocol.status.kind === "error" ? (
              <ErrorBox message={protocol.status.message} />
            ) : protocol.status.kind === "uninitialized" ? (
              <UninitializedBox />
            ) : (
              <LoadingBox label="LOADING PROTOCOL STATE" />
            )}
          </Panel>
        </div>
      )}

      <div className="text-[10px] text-green-700">
        devnet only · not affiliated with OTC Desks · faucet balances are public via{" "}
        <code>GET /api/faucet/status</code>
      </div>
    </div>
  );
}