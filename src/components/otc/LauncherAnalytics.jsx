import React, { useEffect, useId, useRef, useState } from "react";
import { Globe, Send, Twitter } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { fmtUsd } from "@/lib/format";
import { useLauncherLive } from "@/lib/useLauncherLive";
import { usePumpSample } from "@/lib/usePumpSample";
import Pager from "@/components/otc/Pager";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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
// Launch-age windows for the tape; ALL shows every launch, historical included.
const TIMEFRAMES = [["1H", 1], ["24H", 24], ["7D", 168], ["30D", 720], ["ALL", null]];
const EMPTY_COUNTS = Object.fromEntries(STATUSES.map((s) => [s, 0]));

// Also validate in the client for older/cached feeds and defensive rendering.
function metadataUrl(value) {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value.trim());
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}
const logoOf = (token) => metadataUrl(token.logoUrl) || metadataUrl(token.image);
const momentum = (value) => Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${value.toFixed(1)}%` : "—";

function TokenAsset({ token, large = false }) {
  const [failedUrl, setFailedUrl] = useState("");
  const src = logoOf(token), label = token.name || token.symbol || token.mint;
  return (
    <span className={`inline-flex shrink-0 items-center justify-center overflow-hidden border border-green-500/30 bg-green-500/10 ${large ? "h-56 w-56 max-w-full text-3xl" : "h-8 w-8 text-[10px]"}`}>
      {src && src !== failedUrl ? <img src={src} alt={`${label} ${large ? "token image" : "logo"}`}
        width={large ? 224 : 32} height={large ? 224 : 32} loading={large ? "eager" : "lazy"}
        decoding="async" referrerPolicy="no-referrer" onError={() => setFailedUrl(src)}
        className={`h-full w-full ${large ? "object-contain" : "object-cover"}`} />
        : <span role="img" aria-label={`${label} image unavailable`}>{(token.symbol || "?").slice(0, 2)}</span>}
    </span>
  );
}

function TokenDetails({ token }) {
  const socials = [{ key: "twitter", label: "Twitter / X", Icon: Twitter }, { key: "telegram", label: "Telegram", Icon: Send },
    { key: "website", label: "Website", Icon: Globe }]
    .map(({ key, label, Icon }) => ({ label, Icon, url: metadataUrl(token.socials?.[key]) })).filter((link) => link.url);
  const payout = token.payoutInfo;
  const basket = Array.isArray(payout?.rewardBasket) ? payout.rewardBasket : [];
  const logo = logoOf(token);
  return <>
    <DialogHeader className="pr-6 text-left">
      <DialogTitle className="break-words text-green-300">{token.name || token.symbol || "Launcher token"} · ${token.symbol || "?"}</DialogTitle>
      <DialogDescription className="text-green-500/70">Token details · [{statusOf(token)}] · source snapshots may lag</DialogDescription>
    </DialogHeader>
    <div className="grid min-w-0 gap-4 sm:grid-cols-[224px_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col items-center gap-2">
        <TokenAsset key={token.mint} token={token} large />
        {logo && <a href={logo} target="_blank" rel="noopener noreferrer" className="text-xs text-cyan-300 underline">Open original image ↗</a>}
      </div>
      <div className="min-w-0 space-y-3">
        <div className="break-all font-mono text-[11px] text-green-500/70">{token.mint} <CopyCa mint={token.mint} /></div>
        <div className="flex flex-wrap gap-2" aria-label="Token social links">
          {socials.map(({ label, Icon, url }) => <a key={label} href={url} target="_blank" rel="noopener noreferrer"
            aria-label={label} className="inline-flex min-h-11 items-center gap-1.5 border border-green-500/30 px-3 text-xs text-cyan-300 hover:bg-green-500/10">
            <Icon size={16} aria-hidden="true" />{label}
          </a>)}
          {!socials.length && <span className="text-xs text-green-500/60">Social links unavailable.</span>}
        </div>
        <dl className="grid grid-cols-2 gap-2 text-xs">
          {[["24h Volume", fmtUsd(token.vol24)], ["24h Momentum", momentum(token.change24h)],
            ["Market Cap", fmtUsd(token.mcap)], ["Liquidity", fmtUsd(token.liquidity)]].map(([label, value]) =>
            <div key={label} className="min-w-0 border border-green-500/20 p-2">
              <dt className="text-green-500/60">{label}</dt><dd className="break-words font-mono text-green-300">{value}</dd>
            </div>)}
        </dl>
        <div className="border border-green-500/20 p-2"><CurveProgress token={token} />
          <p className="mt-1 text-[10px] text-green-500/60">Reserve-derived funding progress, not market cap.</p></div>
        <p className="text-[10px] text-green-500/60">Market snapshot: {token.metricsAt ? new Date(token.metricsAt).toLocaleString() : "unavailable"}
          <br />Status evidence: {token.statusAt ? new Date(token.statusAt).toLocaleString() : "unavailable"}</p>
      </div>
    </div>
    <section aria-label="Stonk payout" className="min-w-0 space-y-2 border border-amber-400/30 bg-amber-400/5 p-3 text-xs">
      <h3 className="font-bold uppercase tracking-widest text-amber-300">Stonk payout</h3>
      {payout ? <>
        <p className="break-words text-green-300">Reported primary reward: {payout.rewardSymbol ? `$${payout.rewardSymbol}` : "symbol unavailable"}</p>
        {payout.rewardMint && <a href={`https://solscan.io/token/${encodeURIComponent(payout.rewardMint)}`} target="_blank" rel="noopener noreferrer"
          className="block break-all font-mono text-cyan-300 underline">{payout.rewardMint} ↗</a>}
        {!!basket.length && <div><p className="text-green-300">Reported reward basket ({basket.length} tokens)</p>
          <ul className="mt-1 space-y-1">{basket.map((mint, i) => <li key={mint} className="break-all font-mono">
            <span className="text-green-500/60">{i + 1}. </span><a href={`https://solscan.io/token/${encodeURIComponent(mint)}`}
              target="_blank" rel="noopener noreferrer" className="text-cyan-300 underline">{mint} ↗</a>
          </li>)}</ul>
        </div>}
        <p className="text-green-500/70">Reported rewardCycle: {Number.isSafeInteger(payout.rewardCycle) && payout.rewardCycle >= 0 ? payout.rewardCycle : "unavailable"} · units/meaning unverified</p>
      </> : <p className="text-green-500/70">Payout metadata unavailable; this does not mean no rewards.</p>}
      <p className="text-[11px] text-amber-200/70">Allocation, eligibility and payout timing are not provided by this feed. These are source-reported settings, not verified distributions or guaranteed returns.</p>
    </section>
    <p className="text-[10px] text-green-500/60">Assets and links are third-party metadata, not endorsements. Verify payout mints and launch terms before trading.</p>
  </>;
}

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
  const [status, setStatus] = useState("ALL");
  const [search, setSearch] = useState("");
  const [detailMint, setDetailMint] = useState(null);
  const detailTrigger = useRef(null), panelRef = useRef(null);
  const detailId = useId();
  const [timeframe, setTimeframe] = useState("ALL");
  const [page, setPage] = useState(1);
  const maxAgeHours = TIMEFRAMES.find(([tf]) => tf === timeframe)?.[1] ?? null;
  // The FULL tape (every launch, historical included) is filtered, sorted and
  // paged server-side; the poller re-fetches whenever the view changes.
  const live = useLauncherLive({
    page, pageSize: 50, status, sort: kpi,
    ...(search.trim() ? { search: search.trim().toLowerCase() } : {}),
    ...(maxAgeHours != null ? { maxAgeHours } : {}),
  });
  // Browser-side pump.fun market sample (large GeckoTerminal pool scan); the
  // server payload ships a small search-based fallback until this arrives.
  const pump = usePumpSample();

  useEffect(() => { if (live.data) onSnapshot?.(live.data); }, [live.data, onSnapshot]);

  useEffect(() => {
    let mounted = true;
    let pending = false;
    const load = async () => {
      if (pending || document.hidden) return;
      pending = true;
      try {
        const res = await base44.functions.invoke("getLauncherAnalytics");
        if (res?.data?.error) throw new Error(res.data.error);
        if (mounted) { setData(res.data); setErr(null); }
      } catch (e) { if (mounted) setErr(e.message || "fetch failed"); }
      finally { pending = false; }
    };
    load();
    const t = setInterval(load, 60_000);
    return () => { mounted = false; clearInterval(t); };
  }, []);

  const c = data?.cohort, n = pump || data?.native;
  const feed = live.data;
  // Server-filtered, sorted and paged slice of the full launch tape.
  const ranked = feed?.ranked ?? [];
  const counts = feed?.statusCounts ?? EMPTY_COUNTS;
  const pageCount = feed?.pageCount ?? 1;
  const matches = feed?.matches ?? 0;
  // The server clamps pages past the end when filters shrink the result set.
  useEffect(() => {
    if (feed && Number.isFinite(feed.page) && feed.page !== page) setPage(feed.page);
  }, [feed, page]);
  // Keep the modal attached to a mint, not a stale row or current ranking/filter.
  const detailToken = (feed?.ranked || []).find((row) => row.mint === detailMint);

  return (
    <Dialog open={detailMint !== null} onOpenChange={(open) => { if (!open) setDetailMint(null); }}>
    <div ref={panelRef} tabIndex={-1} className="flex h-full flex-col border border-green-500/30 bg-black p-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-green-500/70">
          OTC_ANALYTICS :: LAUNCHER ECOSYSTEM
        </span>
        <span className="text-[9px] text-green-500/40">{feed ? `${counts.ALL} matching · ${feed.stale || live.error ? "STALE" : "30s POLL"}` : "…"}</span>
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
          onClick={() => { setStatus(s); setPage(1); }} className={`border px-1.5 py-1 text-[9px] ${status === s ? "border-cyan-400 text-cyan-300" : "border-green-500/30 text-green-500/70"}`}>
          {s} ({counts[s] ?? 0})
        </button>)}
      </div>
      <div role="tablist" aria-label="Launch timeframe" className="mt-1 flex flex-wrap items-center gap-1">
        <span className="text-[9px] uppercase tracking-widest text-green-500/50">SINCE</span>
        {TIMEFRAMES.map(([tf]) => <button key={tf} type="button" role="tab" aria-selected={timeframe === tf}
          onClick={() => { setTimeframe(tf); setPage(1); }}
          className={`border px-1.5 py-1 text-[9px] ${timeframe === tf ? "border-cyan-400 text-cyan-300" : "border-green-500/30 text-green-500/70"}`}>
          {tf}
        </button>)}
      </div>
      <input aria-label="Search launcher tokens" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        placeholder="Symbol, name or mint · searches the full tape"
        className="mt-2 w-full border border-green-500/30 bg-black px-2 py-1 text-[10px] text-green-300" />

      {/* KPI ranking */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[9px] uppercase tracking-widest text-green-500/50">RANK BY</span>
        {KPIS.map((k) => (
          <button key={k.key} type="button" onClick={() => { setKpi(k.key); setPage(1); }}
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
            <button type="button" aria-label={`View details for ${t.name || t.symbol || t.mint}`} aria-haspopup="dialog"
              aria-controls={detailMint === t.mint ? detailId : undefined} aria-expanded={detailMint === t.mint}
              onClick={(e) => { e.stopPropagation(); detailTrigger.current = e.currentTarget; setDetailMint(t.mint); }}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center hover:bg-green-500/10 focus-visible:outline focus-visible:outline-cyan-400">
              <TokenAsset token={t} />
            </button>
            <button type="button" onClick={() => onTrade?.(t)} disabled={tradingDisabled || !onTrade}
              className="max-w-full break-all text-left font-bold text-green-300 hover:text-emerald-300 disabled:opacity-40" title={`${t.name || t.symbol} — select for in-app swap`}>
              ${t.symbol || t.mint.slice(0, 6)}
            </button>
            <span className={t.status === "GRADUATED" ? "text-emerald-400" : "text-cyan-400/80"}>[{statusOf(t)}]</span>
            <span className="text-green-500/50">{fmtAge(t.ageH)}</span>
            <span className="ml-auto flex flex-wrap items-center gap-2 font-mono text-green-500/70">
              {Number.isFinite(t.change24h) && (
                <span className={t.change24h >= 0 ? "text-emerald-400" : "text-red-400"}>
                  {momentum(t.change24h)}
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
        {!ranked.length && <div className="px-2 py-3 text-center text-[10px] text-green-500/50">{feed ? "NO MATCHING LAUNCHES · try another status, timeframe or search" : live.error ? "UNAVAILABLE" : "LOADING…"}</div>}
      </div>
      <Pager page={page - 1} pages={pageCount} onPage={(p) => setPage(p + 1)} total={matches} label="LAUNCHES" />
      <div className="mt-1 text-[9px] text-green-500/50">
        PAGE {feed?.page ?? page}/{pageCount} · {matches} matches · {feed?.rosterTotal ?? "—"} launches total ·
        statuses checked for {feed?.statusChecked ?? 0}/{feed?.candidateCount ?? 0} candidates
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
            {n ? `grad ${(n.graduatedShare * 100).toFixed(1)}% · med vol ${fmtUsd(n.medianVol24)} · n=${n.n}${n.source === "browser" ? " ● BROWSER_SCAN" : ""}` : "— sample unavailable"}
          </div>
        </div>
      </div>
      <div className="mt-1 text-[8px] text-green-500/40">*Cohort/comparison cached 5 min{data?.stale ? " · STALE" : ""}; grad rate = top-200 by 24h volume · pump.fun sample biased to active pairs</div>
      <div className="mt-1 border border-red-500/20 bg-red-500/5 px-2 py-1 text-[8px] text-red-400/80">
        NOT AFFILIATED WITH THE TOKEN LAUNCHES SHOWN · DYOR BEFORE BUYING · HIGH VOLUME &amp; LIQUIDITY PREFERRED
        — THIS IS THE TRENCH: YOU WIN BIG OR LOSE IT ALL
      </div>
    </div>
    <DialogContent id={detailId} className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto border-green-500/40 bg-black p-4 text-green-300 sm:p-6"
      onCloseAutoFocus={(e) => {
        e.preventDefault();
        // A refresh/filter may have removed the original logo from the list.
        const target = detailTrigger.current?.isConnected ? detailTrigger.current : panelRef.current;
        target?.focus();
      }}>
      {detailToken ? <TokenDetails token={detailToken} /> : <DialogHeader>
        <DialogTitle>Token unavailable</DialogTitle>
        <DialogDescription>This token is no longer in the latest launcher feed. Close this view to continue.</DialogDescription>
      </DialogHeader>}
      {(feed?.stale || live.error) && <p role="status" className="text-xs text-amber-300">STALE · showing the last available token snapshot.</p>}
    </DialogContent>
    </Dialog>
  );
}