import React, { useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { fmtUsd } from "@/lib/format";

/* OTC_ANALYTICS — the launcher panel: launch feed + graduation status + KPI
   ranking + fee-model breakdown for otcdesks.cash launches, with a native
   pump.fun field sample for comparison. Data: getLauncherAnalytics (cached
   server-side 5 min). Terminal design language matches ArbitrageCard. */

const fmtAge = (h) => (h == null ? "—" : h < 1 ? `${Math.round(h * 60)}m` : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`);
const KPIS = [
  { key: "feesEst24h", label: "FEES_EST" },
  { key: "vol24", label: "VOLUME_24H" },
  { key: "velocity", label: "CURVE_VELOCITY" },
  { key: "change24h", label: "TOP_GAINERS" },
];
const SPLIT_CLS = ["bg-emerald-400/70", "bg-cyan-400/70", "bg-amber-400/70", "bg-fuchsia-400/70"];

function CopyCa({ mint }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      title={`${mint} — click to copy`}
      onClick={async (e) => {
        e.preventDefault(); e.stopPropagation();
        try { await navigator.clipboard.writeText(mint); setOk(true); setTimeout(() => setOk(false), 1200); } catch { /* Clipboard permission may be denied. */ }
      }}
      className={`border px-1 font-mono text-[9px] ${ok ? "border-emerald-400 text-emerald-300" : "border-green-500/30 text-green-500/60 hover:text-green-300"}`}
    >
      {ok ? "[✓]" : "[⧉ CA]"}
    </button>
  );
}

function SplitBar({ model, amount }) {
  return (
    <span className="flex h-1.5 w-16 overflow-hidden border border-green-500/20" title={
      model.map((s) => `${s.label} ${s.pct}%${amount != null ? ` · ${fmtUsd((amount * s.pct) / 100)}` : ""}`).join("\n")
    }>
      {model.map((s, i) => <span key={s.key} className={SPLIT_CLS[i]} style={{ width: `${s.pct}%` }} />)}
    </span>
  );
}

export default function LauncherAnalytics() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [kpi, setKpi] = useState("feesEst24h");

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const res = await base44.functions.invoke("getLauncherAnalytics");
        if (res?.data?.error) throw new Error(res.data.error);
        if (live) { setData(res.data); setErr(null); }
      } catch (e) { if (live) setErr(e.message || "fetch failed"); }
    };
    load();
    const t = setInterval(load, 60_000);
    return () => { live = false; clearInterval(t); };
  }, []);

  const ranked = useMemo(() => {
    // Unknown 24h changes rank below actual losers; other KPIs default to zero.
    const nullFloor = kpi === "change24h" ? -Infinity : 0;
    const rows = [...(data?.ranked || [])].sort((a, b) => {
      const aValue = a[kpi] ?? nullFloor;
      const bValue = b[kpi] ?? nullFloor;
      // Two unknowns are a stable tie, not -Infinity - -Infinity (NaN).
      return aValue === bValue ? 0 : bValue - aValue;
    });
    return rows.slice(0, 15);
  }, [data, kpi]);

  const c = data?.cohort, n = data?.native;

  return (
    <div className="flex h-full flex-col border border-green-500/30 bg-black p-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-green-500/70">
          OTC_ANALYTICS :: LAUNCHER ECOSYSTEM
        </span>
        <span className="text-[9px] text-green-500/40">{data ? `${data.ranked.length} tracked${data.stale ? " · STALE" : ""}` : "…"}</span>
      </div>

      {err && <div className="mt-2 border border-amber-500/40 bg-amber-500/5 px-2 py-1 text-[10px] text-amber-400">ERR: {err}</div>}

      {/* cohort KPIs */}
      <div className="mt-2 grid grid-cols-2 gap-1.5 text-center sm:grid-cols-4">
        {[
          ["LAUNCHES", c?.launches ?? "—"],
          ["24H VOLUME", c ? fmtUsd(c.vol24h) : "—"],
          ["GRAD RATE*", c?.gradSample?.rate != null ? `${(c.gradSample.rate * 100).toFixed(1)}%` : "—"],
          ["MEDIAN AGE", c ? fmtAge(c.medianAgeH) : "—"],
        ].map(([k, v]) => (
          <div key={k} className="border border-green-500/20 p-1.5">
            <div className="text-[9px] uppercase tracking-widest text-green-500/50">{k}</div>
            <div className="font-mono text-sm font-bold text-green-300">{v}</div>
          </div>
        ))}
      </div>

      {/* KPI ranking */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[9px] uppercase tracking-widest text-green-500/50">RANK BY</span>
        {KPIS.map((k) => (
          <button key={k.key} type="button" onClick={() => setKpi(k.key)}
            className={`border px-1.5 py-0.5 text-[9px] ${kpi === k.key ? "border-green-400 bg-green-500/10 text-green-300" : "border-green-500/30 text-green-500/60"}`}>
            [ {k.label} ]
          </button>
        ))}
      </div>

      {/* launch feed */}
      <div className="mt-2 min-h-0 flex-1 overflow-y-auto border border-green-500/20 max-h-80 lg:max-h-none">
        {ranked.map((t, i) => (
          <div key={t.mint} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-green-500/10 px-2 py-1 text-[10px] last:border-0">
            <span className="text-green-500/40">#{i + 1}</span>
            <a href={t.pairUrl || `https://dexscreener.com/solana/${t.mint}`} target="_blank" rel="noreferrer"
               className="font-bold text-green-300 hover:text-emerald-300" title={`${t.name} — view on DexScreener`}>
              ${t.symbol}
            </a>
            {t.graduated == null ? null : t.graduated
              ? <span className="text-emerald-400">[GRAD]</span>
              : <span className="text-cyan-400/80">[BONDING]</span>}
            <span className="text-green-500/50">{fmtAge(t.ageH)}</span>
            <span className="ml-auto flex flex-wrap items-center gap-2 font-mono text-green-500/70">
              {t.change24h != null && (
                <span className={t.change24h >= 0 ? "text-emerald-400" : "text-red-400"}>
                  {t.change24h >= 0 ? "+" : ""}{t.change24h.toFixed(1)}%
                </span>
              )}
              <span>mc {fmtUsd(t.mcap)}</span>
              <span>vol {fmtUsd(t.vol24)}</span>
              <span className="text-amber-400/90" title="est. 24h curve fees (vol × 1%)">fees {fmtUsd(t.feesEst24h)}</span>
              <SplitBar model={data?.feeModel || []} amount={t.feesEst24h} />
              <a href={`https://jup.ag/swap/SOL-${t.mint}`} target="_blank" rel="noreferrer"
                 className="border border-emerald-500/50 px-1 font-mono text-[9px] text-emerald-300 hover:bg-emerald-500/10"
                 title={`Buy $${t.symbol} on Jupiter — mint pre-loaded as the output token`}>
                [⇄ TRADE]
              </a>
              <CopyCa mint={t.mint} />
            </span>
          </div>
        ))}
        {!ranked.length && <div className="px-2 py-3 text-center text-[10px] text-green-500/50">{err ? "UNAVAILABLE" : "LOADING…"}</div>}
      </div>

      {/* fee model + comparison */}
      <div className="mt-2 border border-green-500/20 px-2 py-1.5 text-[9px] text-green-500/60">
        FEE_SPLIT :: {(data?.feeModel || []).map((s, i) => (
          <span key={s.key} className="mr-2"><span className={`inline-block h-1.5 w-1.5 ${SPLIT_CLS[i]}`} /> {s.label} {s.pct}%</span>
        ))}
        <span className="text-green-500/40">est from 24h vol × 1% curve fee</span>
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-1.5 text-center text-[9px]">
        <div className="border border-emerald-500/30 p-1.5">
          <div className="uppercase tracking-widest text-emerald-400/80">OTC LAUNCHER</div>
          <div className="mt-0.5 font-mono text-green-300">
            grad {(c?.gradSample?.rate != null ? (c.gradSample.rate * 100).toFixed(1) : "—")}% · vol {fmtUsd(c?.vol24h)} · n={c?.launches ?? "—"}
          </div>
        </div>
        <div className="border border-fuchsia-500/30 p-1.5">
          <div className="uppercase tracking-widest text-fuchsia-400/80">PUMP.FUN SAMPLE</div>
          <div className="mt-0.5 font-mono text-green-300">
            {n ? `grad ${(n.graduatedShare * 100).toFixed(1)}% · med vol ${fmtUsd(n.medianVol24)} · n=${n.n}` : "— sample unavailable"}
          </div>
        </div>
      </div>
      <div className="mt-1 text-[8px] text-green-500/40">*grad rate = top-200 by 24h volume · pump.fun sample biased to active pairs</div>
    </div>
  );
}
