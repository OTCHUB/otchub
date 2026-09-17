// CONSOLIDATE & SWAP (OTC desk native earnings): after a claim run lands stock tokens in the
// wallet, convert everything that arrived into one chosen output token. Same safety chain as
// the $HUB terminal's pipeline: fresh validated Jupiter quote per token (host relay) → built-tx
// fee-payer + destination checks → unsigned RPC sim → Blowfish pre-flight (env-gated) → ONE
// signAll prompt → per-token send/confirm with a signature-status landed-check. Per-token
// isolation throughout: anything that fails stays in the wallet with the reason reported.
import React, { useMemo, useState } from "react";
import { Buffer } from "buffer";
import { Connection, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { getQuote, getSwapTx } from "@/lib/jupiterSwap";
import { abortPendingSigns, getSignerForAddress } from "@/lib/walletSigner";
import { LINEUP_STOCKS } from "@/lib/otcClaim";
import { validateBuiltSwapTx } from "@/hub/lib/swap";
import { blowfishScanTx } from "@/hub/lib/blowfish";
import TokenCoin from "@/components/otc/TokenCoin";
import StepTracker from "@/components/otc/StepTracker";
import TxStatusOverlay from "@/components/otc/TxStatusOverlay";
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

const HUB_MINT = "5yrUrzyDBs5NrZdiGtW1BEYUjHyHBLx1L5vTAKUxvo1V";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SLIPPAGES = [50, 100, 300];

/** One public mainnet connection for sim/send/confirm — same posture as otcClaim.js. */
let _conn = null;
const conn = () => (_conn ??= new Connection("https://api.mainnet-beta.solana.com", "confirmed"));

export function consolidateTargets() {
  return [
    { symbol: "HUB", mint: HUB_MINT, decimals: 6 },
    { symbol: "SOL", mint: SOL_MINT, decimals: 9 },
    { symbol: "USDC", mint: USDC_MINT, decimals: 6 },
    ...LINEUP_STOCKS.map((s) => ({ symbol: s.symbol, mint: s.mint, decimals: s.decimals })),
  ];
}

const fmtAmt = (units, decimals) =>
  (Number(units) / 10 ** decimals).toLocaleString(undefined, { maximumFractionDigits: 4 });

/** Balance snapshot of the 13 lineup mints for `address` (all Token-2022) — the before/after
 *  pair around a claim run tells us exactly what arrived, so only *newly claimed* tokens are
 *  offered for conversion (pre-existing balances are never swept). */
export async function snapshotLineupBalances(address) {
  const out = new Map();
  const owner = new PublicKey(address);
  await Promise.all(
    LINEUP_STOCKS.map(async (s) => {
      const mint = new PublicKey(s.mint);
      const ata = getAssociatedTokenAddressSync(mint, owner, true, TOKEN_2022_PROGRAM_ID);
      const bal = await conn()
        .getTokenAccountBalance(ata, "confirmed")
        .then((b) => BigInt(b.value.amount))
        .catch(() => 0n);
      out.set(s.mint, bal);
    }),
  );
  return out;
}

/** before/after snapshot pair → [{ mint, units }] of tokens that GREW during the claim run. */
export function diffLineupBalances(before, after) {
  const out = [];
  for (const [mint, prev] of before) {
    const delta = (after.get(mint) ?? 0n) - prev;
    if (delta > 0n) out.push({ mint, units: delta });
  }
  return out;
}

/** Pipeline order for the step tracker (quote+sim+preflight per token → one sign prompt →
 *  send → confirm). */
const STEPS = [
  { id: "quote", label: "QUOTE+SIM" },
  { id: "sign", label: "SIGN" },
  { id: "send", label: "SEND" },
  { id: "confirm", label: "CONFIRM" },
];

export default function ConsolidateBar({ address, deltas, onDone, onDismiss }) {
  const targets = useMemo(consolidateTargets, []);
  const [targetSymbol, setTargetSymbol] = useState("SOL");
  const [slippageBps, setSlippageBps] = useState(100);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState(null);
  const [stepDetail, setStepDetail] = useState(null);
  const [failedStep, setFailedStep] = useState(null);
  const [logs, setLogs] = useState([]);
  const [done, setDone] = useState(null);
  const stepRef = React.useRef(null);
  stepRef.current = phase;
  const target = targets.find((t) => t.symbol === targetSymbol) ?? targets[1];
  // Accept bare {mint, units} deltas from the claim panel and enrich from the lineup catalog.
  const swappable = deltas
    .map((d) => ({ ...d, ...LINEUP_STOCKS.find((s) => s.mint === d.mint) }))
    .filter((d) => d.symbol && d.mint !== target.mint && d.units > 0n);
  const log = (msg) => setLogs((p) => [...p, msg]);

  const run = async () => {
    const signer = getSignerForAddress(address);
    if (!signer) return log("ERR: no signing wallet for this address.");
    setBusy(true);
    setLogs([]);
    setDone(null);
    setFailedStep(null);
    const built = [];
    const outcomes = [];
    try {
      let qi = 0;
      for (const d of swappable) {
        qi += 1;
        setPhase("quote");
        setStepDetail(`${qi}/${swappable.length} · ${d.symbol}`);
        try {
          const quote = await getQuote(d.mint, target.mint, d.units.toString(), slippageBps);
          const builtTx = await getSwapTx(quote, address);
          const unsigned = VersionedTransaction.deserialize(
            new Uint8Array(Buffer.from(builtTx.swapTransaction, "base64")),
          );
          const v = validateBuiltSwapTx(unsigned, address, target.mint);
          if ("reason" in v) throw new Error(v.reason);
          const sim = await conn().simulateTransaction(unsigned, { sigVerify: false });
          if (sim.value.err) throw new Error(`sim: ${JSON.stringify(sim.value.err)}`);
          const verdict = await blowfishScanTx({
            tx: unsigned,
            userAccount: address,
            rpcEndpoint: conn().rpcEndpoint,
          });
          if (verdict?.action === "BLOCK")
            throw new Error(`Blowfish BLOCK: ${verdict.messages.join("; ") || "unsafe"}`);
          built.push({ d, tx: unsigned, msg: v.message });
          log(`${d.symbol}: quote+sim OK (est. out ${quote.outAmount})`);
        } catch (e) {
          log(`SKIP ${d.symbol}: ${e.message}`);
          outcomes.push({ symbol: d.symbol, ok: false, reason: e.message });
        }
      }
      if (built.length) {
        setStepDetail(null);
        setPhase("sign");
        const signed = await signer.signAllTransactionsRaw(built.map((b) => b.tx));
        for (const [i, b] of built.entries()) {
          try {
            setPhase("send");
            setStepDetail(`${i + 1}/${built.length} · ${b.d.symbol}`);
            const bytes = signed[i];
            if (!bytes) throw new Error("wallet returned fewer signatures than transactions");
            const signedTx = VersionedTransaction.deserialize(new Uint8Array(bytes));
            if (!Buffer.from(signedTx.message.serialize()).equals(b.msg))
              throw new Error("wallet returned a changed transaction");
            const sig = await conn().sendRawTransaction(bytes, { skipPreflight: true, maxRetries: 3 });
            setPhase("confirm");
            try {
              const bh = await conn().getLatestBlockhash("confirmed");
              const conf = await conn().confirmTransaction({ signature: sig, ...bh }, "confirmed");
              if (conf.value.err) throw new Error(JSON.stringify(conf.value.err));
            } catch {
              const st = await conn()
                .getSignatureStatus(sig, { searchTransactionHistory: true })
                .catch(() => null);
              const landed =
                st?.value && !st.value.err && ["confirmed", "finalized"].includes(st.value.confirmationStatus);
              if (!landed) throw new Error("not confirmed");
            }
            outcomes.push({ symbol: b.d.symbol, ok: true, sig });
            log(`${b.d.symbol} → ${target.symbol}: LANDED ${sig.slice(0, 8)}…`);
          } catch (e) {
            outcomes.push({ symbol: b.d.symbol, ok: false, reason: e.message });
            log(`${b.d.symbol} FAILED: ${e.message} — tokens stay in your wallet`);
          }
        }
      } else {
        log("nothing passed quote/sim — nothing to sign.");
      }
      setDone(outcomes);
      onDone?.();
    } catch (e) {
      log(`ABORT: ${e.message}`);
      setFailedStep(stepRef.current || "quote");
    } finally {
      setBusy(false);
      setPhase(null);
      setStepDetail(null);
    }
  };

  if (!deltas.length) return null;
  return (
    <div className="mt-2 border border-cyan-500/30 bg-cyan-500/5 p-2 font-mono">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="text-[10px] font-bold uppercase tracking-widest text-cyan-300">
          CONSOLIDATE &amp; SWAP
        </span>
        <span className="text-green-600">
          {swappable.length} token(s) just claimed — convert to:
        </span>
        <span className="flex items-center gap-1 border border-green-500/30 bg-black px-1">
          <TokenCoin symbol={target.symbol} className="h-4 w-4" />
          <select
            value={targetSymbol}
            onChange={(e) => setTargetSymbol(e.target.value)}
            disabled={busy}
            aria-label="output token"
            className="bg-black py-1 text-[11px] font-bold text-cyan-300 outline-none"
          >
            {targets.map((t) => (
              <option key={t.mint} value={t.symbol}>
                {t.symbol === "HUB" ? "$HUB (protocol)" : t.symbol}
              </option>
            ))}
          </select>
        </span>
        <span className="flex gap-1 text-[10px]">
          {SLIPPAGES.map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => setSlippageBps(b)}
              disabled={busy}
              className={`border px-1.5 py-0.5 ${slippageBps === b ? "border-emerald-500/60 text-emerald-300" : "border-green-500/30 text-green-500/60"}`}
            >
              {b / 100}%
            </button>
          ))}
        </span>
        <button
          type="button"
          onClick={run}
          disabled={busy || !swappable.length}
          className="ml-auto border border-cyan-400/60 px-2.5 py-1 font-bold text-cyan-300 hover:bg-cyan-500/10 disabled:opacity-30"
        >
          {busy ? `${phase ?? "prep"}…`.toUpperCase() : `[CONVERT → ${target.symbol}]`}
        </button>
        {onDismiss && !busy && (
          <button type="button" onClick={onDismiss} className="text-[10px] text-green-700 underline hover:text-green-400">
            [keep tokens]
          </button>
        )}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-green-500">
        {swappable.map((d) => (
          <span key={d.mint}>
            {d.symbol} <span className="text-green-300">{fmtAmt(d.units, d.decimals)}</span>
          </span>
        ))}
      </div>
      {(busy || done || failedStep) && (
        <div className="mt-2">
          <StepTracker
            title="CONSOLIDATE PIPELINE"
            steps={STEPS}
            current={phase}
            done={!!done && !failedStep}
            failed={failedStep}
            detail={stepDetail}
            onDismiss={
              !busy
                ? () => {
                    setDone(null);
                    setFailedStep(null);
                    if (!done) onDismiss?.();
                  }
                : null
            }
          />
        </div>
      )}
      <TxStatusOverlay
        phase={busy ? phase || "quote" : null}
        detail={stepDetail}
        onCancel={phase === "sign" ? () => abortPendingSigns() : null}
      />
      {logs.length > 0 && (
        <div className="mt-1.5 max-h-28 space-y-0.5 overflow-y-auto border-t border-cyan-500/20 pt-1 text-[10px] text-green-500">
          {logs.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      )}
      {done && (
        <div className="mt-1 border-t border-cyan-500/20 pt-1 text-[10px] text-green-400">
          DONE: {done.filter((o) => o.ok).length}/{done.length} converted
          {done.some((o) => !o.ok) ? " — failures left in wallet (see log)" : ""}
        </div>
      )}
    </div>
  );
}
