import React, { useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { fmtUsd } from "@/lib/format";
import { useLauncherLive } from "@/lib/useLauncherLive";

// Live roster is independent of the five-minute cohort/comparison snapshot.

const fmtAge = (h) => (h == null ? "—" : h < 1 ? `${Math.round(h * 60)}m` : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`);
const KPIS = [
  { key: "vol24", label: "VOLUME_24H" },
  { key: "change24h", label: "TOP_GAINERS" },
  { key: "mcap", label: "MARKET_CAP" },
];
const SPLIT_CLS = ["bg-emerald-400/70", "bg-cyan-400/70", "bg-amber-400/70", "bg-fuchsia-400/70"];
const STATUSES = ["GRADUATED", "BONDING", "ABOUT_TO_GRADUATE", "ALL", "UNKNOWN"];
const statusOf = (row) => STATUSES.includes(row.status) && row.status !== "ALL" ? row.status : "UNKNOWN";

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

function CurveProgress({ token }) {
  const progress = Number.isFinite(token.curveProgress) ? Math.max(0, Math.min(100, token.curveProgress)) : null;
  const label = token.curveComplete && token.status !== "GRADUATED" ? "100% · migration pending" : progress == null ? "unavailable" : `${progress.toFixed(1)}%`;
  return (
    <span className="inline-flex min-w-24 flex-col gap-0.5" title="Bonding curve quote-asset funding progress from on-chain reserves; not market-cap progress">
      <span className="text-[8px] text-cyan-300">CURVE {label}</span>
      <span role="progressbar" aria-label={`${token.symbol || token.mint} bonding curve progress`}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress ?? undefined} aria-valuetext={label}
        className="flex h-1.5 w-24 overflow-hidden border border-green-500/30 bg-green-500/5">
        {progress != null && <span className="bg-cyan-400/80" style={{ width: `${progress}%` }} />}
      </span>
    </span>
  );
}

export default function LauncherAnalytics({ onTrade = undefined, selectedMint = undefined, tradingDisabled = false, onSnapshot = undefined } = {}) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [kpi, setKpi] = useState("vol24");
  const [status, setStatus] = useState("GRADUATED");
  const [search, setSearch] = useState("");
  const live = useLauncherLive();

  useEffect(() => { if (live.data) onSnapshot?.(live.data); }, [live.data, onSnapshot]);

  useEffect(() => {
    let live = true;
    let pending = false;
    const load = async () => {
      if (pending || document.hidden) return;
      pending = true;
      try {
        const res = await base44.functions.invoke("getLauncherAnalytics");
        if (res?.data?.error) throw new Error(res.data.error);
        if (live) { setData(res.data); setErr(null); }
      } catch (e) { if (live) setErr(e.message || "fetch failed"); }
      finally { pending = false; }
    };
    load();
    const t = setInterval(load, 60_000);
    return () => { live = false; clearInterval(t); };
  }, []);

  const ranked = useMemo(() => {
    const query = search.trim().toLowerCase();
    const rows = (live.data?.ranked || []).filter((t) => (status === "ALL" || statusOf(t) === status)
      && (!query || `${t.symbol} ${t.name} ${t.mint}`.toLowerCase().includes(query)));
    rows.sort((a, b) => {
      const aValue = Number.isFinite(a[kpi]) ? a[kpi] : -Infinity;
      const bValue = Number.isFinite(b[kpi]) ? b[kpi] : -Infinity;
      // Two unknowns are a stable tie, not -Infinity - -Infinity (NaN).
      return aValue === bValue ? 0 : bValue - aValue;
    });
    return rows.slice(0, 15);
  }, [live.data, kpi, status, search]);

  const c = data?.cohort, n = data?.native;
  const feed = live.data;
  const counts = (feed?.ranked || []).reduce((out, row) => {
    out[statusOf(row)]++; out.ALL++; return out;
  }, Object.fromEntries(STATUSES.map((s) => [s, 0])));

  return (
    <div className="flex h-full flex-col border border-green-500/30 bg-black p-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-green-500/70">
          OTC_ANALYTICS :: LAUNCHER ECOSYSTEM
        </span>
        <span className="text-[9px] text-green-500/40">{feed ? `${counts.ALL} launches · ${feed.stale || live.error ? "STALE" : "30s POLL"}` : "…"}</span>
      </div>

      {live.error && <div role="status" className="mt-2 text-[10px] text-amber-400">{live.error}</div>}
      {feed?.at && <div className="mt-1 text-[9px] text-green-500/50">Feed fetched {new Date(feed.at).toLocaleTimeString()} · source snapshots may lag</div>}

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

      <div role="tablist" aria-label="Launcher status" className="mt-2 flex flex-wrap gap-1">
        {STATUSES.map((s) => <button key={s} type="button" role="tab" aria-selected={status === s}
          onClick={() => setStatus(s)} className={`border px-1.5 py-1 text-[9px] ${status === s ? "border-cyan-400 text-cyan-300" : "border-green-500/30 text-green-500/70"}`}>
          {s} ({counts[s]})
        </button>)}
      </div>
      <input aria-label="Search launcher tokens" value={search} onChange={(e) => setSearch(e.target.value)}
        placeholder="Symbol, name or mint · ALL includes unchecked launches"
        className="mt-2 w-full border border-green-500/30 bg-black px-2 py-1 text-[10px] text-green-300" />

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
          <div key={t.mint} data-selected={selectedMint === t.mint} className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-green-500/10 px-2 py-1 text-[10px] last:border-0 ${selectedMint === t.mint ? "bg-cyan-500/10" : ""}`}>
            <span className="text-green-500/40">#{i + 1}</span>
            <button type="button" onClick={() => onTrade?.(t)} disabled={tradingDisabled || !onTrade}
              className="font-bold text-green-300 hover:text-emerald-300 disabled:opacity-40" title={`${t.name || t.symbol} — select for in-app swap`}>
              ${t.symbol || t.mint.slice(0, 6)}
            </button>
            <span className={t.status === "GRADUATED" ? "text-emerald-400" : "text-cyan-400/80"}>[{statusOf(t)}]</span>
            <span className="text-green-500/50">{fmtAge(t.ageH)}</span>
            <span className="ml-auto flex flex-wrap items-center gap-2 font-mono text-green-500/70">
              {t.change24h != null && (
                <span className={t.change24h >= 0 ? "text-emerald-400" : "text-red-400"}>
                  {t.change24h >= 0 ? "+" : ""}{t.change24h.toFixed(1)}%
                </span>
              )}
              <span>mc {fmtUsd(t.mcap)}</span>
              <span>vol {fmtUsd(t.vol24)}</span>
              <CurveProgress token={t} />
              <button type="button" onClick={() => onTrade?.(t)} disabled={tradingDisabled || !onTrade}
                 className="border border-emerald-500/50 px-1 font-mono text-[9px] text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-40"
                 title={`Trade $${t.symbol} here via Jupiter (route availability varies)`}>
                [⇄ TRADE]
              </button>
              <a href={`https://dexscreener.com/solana/${encodeURIComponent(t.mint)}`} target="_blank" rel="noreferrer" title="View market on DexScreener">[DEX ↗]</a>
              <CopyCa mint={t.mint} />
            </span>
          </div>
        ))}
        {!ranked.length && <div className="px-2 py-3 text-center text-[10px] text-green-500/50">{feed ? "NO MATCHING LAUNCHES · try ALL or another filter" : live.error ? "UNAVAILABLE" : "LOADING…"}</div>}
      </div>
      <div className="mt-1 text-[9px] text-green-500/50">
        Top 15 matches · statuses checked for {feed?.statusChecked ?? 0}/{feed?.candidateCount ?? 0} candidates
        (top 60 volume + top 60 gainers + newest 30). Others remain UNKNOWN.
        Near graduation = ≥{feed?.nearThreshold ?? 90}% funding; curve completion alone is not AMM migration.
      </div>
      {!!feed?.statusError?.length && <div className="mt-1 text-[9px] text-amber-400">Some status/progress checks unavailable; UNKNOWN is not BONDING.</div>}
      {tradingDisabled && <div className="mt-1 text-[9px] text-amber-400">Token selection locked while a swap is in progress.</div>}

      {/* fee model + comparison */}
      <div className="mt-2 border border-green-500/20 px-2 py-1.5 text-[9px] text-green-500/60">
        {err && <span className="text-amber-400">Cohort snapshot unavailable. </span>}
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
      <div className="mt-1 text-[8px] text-green-500/40">*Cohort/comparison cached 5 min{data?.stale ? " · STALE" : ""}; grad rate = top-200 by 24h volume · pump.fun sample biased to active pairs</div>
    </div>
  );
}
