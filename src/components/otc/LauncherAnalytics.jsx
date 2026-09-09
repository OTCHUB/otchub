import React, { useEffect, useId, useRef, useState } from "react";
import { Globe, Send, Twitter } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { fmtUsd } from "@/lib/format";
import { useLauncherLive } from "@/lib/useLauncherLive";
import { confirmPendingGraduations } from "@/lib/launcherGraduationConfirm";
import { usePumpSample } from "@/lib/usePumpSample";
import { fetchLauncherAnalyticsMirror } from "@/lib/launcherFeed";
import { isOfficialHubMint } from "@/lib/hubMint";
import { useDexQuotes } from "@/lib/useDexQuotes";
import Pager from "@/components/otc/Pager";
import RewardPayoutSection from "@/components/otc/RewardPayoutSection";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Live roster is independent of the five-minute cohort/comparison snapshot.

const fmtAge = (h) => (h == null ? "—" : h < 1 ? `${Math.round(h * 60)}m` : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`);
const KPIS = [
  { key: "vol24", label: "24h volume" },
  { key: "change24h", label: "Top gainers" },
  { key: "mcap", label: "Market cap" },
  { key: "curveProgress", label: "Progress" },
];
const SPLIT_CLS = ["bg-emerald-400/70", "bg-cyan-400/70", "bg-amber-400/70", "bg-fuchsia-400/70"];
const STATUSES = ["GRADUATED", "BONDING", "ABOUT_TO_GRADUATE", "ALL", "UNKNOWN"];
const statusOf = (row) => STATUSES.includes(row.status) && row.status !== "ALL" ? row.status : "UNKNOWN";
// Launch-age windows for the tape; ALL shows every launch, historical included.
/** @type {Array<[string, number|null]>} */
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
    <span className={`inline-flex shrink-0 items-center justify-center overflow-hidden border border-green-500/30 bg-green-500/10 ${large ? "h-56 w-56 max-w-full text-3xl" : "h-8 w-8 text-[12px]"}`}>
      {src && src !== failedUrl ? <img src={src} alt={`${label} ${large ? "token image" : "logo"}`}
        width={large ? 224 : 32} height={large ? 224 : 32} loading={large ? "eager" : "lazy"}
        decoding="async" referrerPolicy="no-referrer" onError={() => setFailedUrl(src)}
        className={`h-full w-full ${large ? "object-contain" : "object-cover"}`} />
        : <span role="img" aria-label={`${label} image unavailable`}>{(token.symbol || "?").slice(0, 2)}</span>}
    </span>
  );
}

function TokenDetails({ token, symbols = {} }) {
  const socials = [{ key: "twitter", label: "Twitter / X", Icon: Twitter }, { key: "telegram", label: "Telegram", Icon: Send },
    { key: "website", label: "Website", Icon: Globe }]
    .map(({ key, label, Icon }) => ({ label, Icon, url: metadataUrl(token.socials?.[key]) })).filter((link) => link.url);
  const payout = token.payoutInfo;
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
        <div className="break-all font-mono text-[13px] text-green-500/70">{token.mint} <CopyCa mint={token.mint} /></div>
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
          <p className="mt-1 text-[12px] text-green-500/60">Reserve-derived funding progress, not market cap.</p></div>
        <p className="text-[12px] text-green-500/60">Market snapshot: {token.metricsAt ? new Date(token.metricsAt).toLocaleString() : "unavailable"}
          <br />Status evidence: {token.statusAt ? new Date(token.statusAt).toLocaleString() : "unavailable"}</p>
      </div>
    </div>
    <RewardPayoutSection payout={payout} symbols={symbols} />
    <p className="text-[12px] text-green-500/60">Assets and links are third-party metadata, not endorsements. Verify payout mints and launch terms before trading.</p>
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
      className={`border px-1 font-mono text-[11px] ${ok ? "border-emerald-400 text-emerald-300" : "border-green-500/30 text-green-500/60 hover:text-green-300"}`}
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
      <span className="text-[10px] text-cyan-300">CURVE {label}</span>
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
    page, pageSize: 20, status, sort: kpi,
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
      } catch (e) {
        // Live endpoint down: fall back to the 5-min Supabase mirror.
        try {
          const mirror = await fetchLauncherAnalyticsMirror();
          if (mounted) { setData(mirror); setErr(null); }
        } catch {
          if (mounted) setErr(e.message || "fetch failed");
        }
      }
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
  // LIVE DEX QUOTES (browser): the upstream market snapshots lag minutes
  // behind DexScreener and the shared runtime egress IP is 429'd by it, so
  // the visitor's browser re-quotes the visible page's mcap/vol/liquidity/
  // 24h change every ~15s; merged over the served rows at render time.
  const { quotes: dexQuotes, at: dexAt } = useDexQuotes(
    ranked.slice(0, 30).map((t) => t.mint)
  );
  const withDexQuote = (t) => {
    const q = dexQuotes[t.mint];
    if (!q) return t;
    return {
      ...t,
      mcap: q.mcap ?? t.mcap,
      vol24: q.vol24 ?? t.vol24,
      liquidity: q.liquidity ?? t.liquidity,
      change24h: q.change24h ?? t.change24h,
      dexLive: true,
    };
  };
  const tape = ranked.map(withDexQuote);
  // GRAD RATE = verified GRADUATED launches vs ALL launches on the tape
  // (exact server-side counts from the live feed — no cohort sampling). Rows
  // outside the probed candidates stay UNKNOWN, so this is a verified
  // graduation share of every launch, not a high-volume cohort bias.
  const gradSample = counts.ALL
    ? { n: counts.ALL, graduated: counts.GRADUATED, rate: +(counts.GRADUATED / counts.ALL).toFixed(3) }
    : c?.gradSample ?? null;
  // The server clamps pages past the end when filters shrink the result set.
  // Sync ONLY when a new feed arrives: listing `page` as a dependency made the
  // effect run against the stale feed right after NEXT/PREV clicked, instantly
  // reverting the page before the fresh fetch landed (NEXT looked dead).
  useEffect(() => {
    if (feed && Number.isFinite(feed.page)) {
      setPage((current) => (feed.page !== current ? feed.page : current));
    }
  }, [feed]);

  // Completed-but-unconfirmed curves: confirm AMM migration from this
  // visitor's browser and persist it once — afterwards the GRADUATED status
  // is global and sticky for every visitor.
  const pendingGraduation = feed?.pendingGraduation ?? [];
  useEffect(() => {
    if (pendingGraduation.length) confirmPendingGraduations(pendingGraduation);
  }, [pendingGraduation]);
  // Keep the modal attached to a mint, not a stale row or current ranking/filter.
  const detailTokenRaw = (feed?.ranked || []).find((row) => row.mint === detailMint);
  const detailToken = detailTokenRaw ? withDexQuote(detailTokenRaw) : null;

  // Blink + flip: when a fresh poll reorders the tape, moved rows flash once
  // (green slide up / red slide down). Movement is measured on the visible
  // page; entries that just appeared count as moved up. Cached feeds (same
  // timestamp) never flash, so filter/tab/page flips stay calm.
  const prevOrderRef = useRef({ at: null, order: {} });
  const [flash, setFlash] = useState({});
  useEffect(() => {
    if (!feed || !Array.isArray(feed.ranked)) return;
    const order = {};
    feed.ranked.forEach((row, index) => { order[row.mint] = index; });
    const prev = prevOrderRef.current;
    prevOrderRef.current = { at: feed.at, order };
    if (prev.at == null || prev.at === feed.at) return;
    const moved = {};
    for (const [mint, index] of Object.entries(order)) {
      if (!(mint in prev.order) || prev.order[mint] > index) moved[mint] = "up";
      else if (prev.order[mint] < index) moved[mint] = "down";
    }
    if (Object.keys(moved).length) {
      setFlash(moved);
      const timer = setTimeout(() => setFlash({}), 1600);
      return () => clearTimeout(timer);
    }
  }, [feed]);

  return (
    <Dialog open={detailMint !== null} onOpenChange={(open) => { if (!open) setDetailMint(null); }}>
    <div ref={panelRef} tabIndex={-1} className="flex h-full flex-col border border-green-500/30 bg-black p-3">
      <div className="flex items-center justify-between">
        <span className="text-[12px] uppercase tracking-widest text-green-500/70">
          Launcher ecosystem
        </span>
        <span className="text-[11px] text-green-500/40">{feed ? `${counts.ALL} matching · ${feed.stale || live.error ? "STALE" : "30s POLL"}` : "…"}</span>
      </div>

      {live.error && <div role="status" className="mt-2 text-[12px] text-amber-400">{live.error}</div>}
      {feed?.at && (
        <div className="mt-1 text-[11px] text-green-500/50">
          Feed fetched {new Date(feed.at).toLocaleTimeString()} · source snapshots may lag
          {dexAt && <span className="text-emerald-400"> · DEX quotes live {new Date(dexAt).toLocaleTimeString()}</span>}
        </div>
      )}

      {/* cohort KPIs */}
      <div className="mt-2 grid grid-cols-2 gap-1.5 text-center sm:grid-cols-4">
        {[
          ["Launches", c?.launches ?? "—"],
          ["24h volume", c ? fmtUsd(c.vol24h) : "—"],
          ["Grad rate*", gradSample?.rate != null ? `${(gradSample.rate * 100).toFixed(1)}%` : "—"],
          ["Median age", c ? fmtAge(c.medianAgeH) : "—"],
        ].map(([k, v]) => (
          <div key={k} className="border border-green-500/20 p-1.5">
            <div className="text-[11px] uppercase tracking-widest text-green-500/50">{k}</div>
            <div className="font-mono text-sm font-bold text-green-300">{v}</div>
          </div>
        ))}
      </div>

      <div role="tablist" aria-label="Launcher status" className="mt-2 flex flex-wrap gap-1">
        {STATUSES.map((s) => <button key={s} type="button" role="tab" aria-selected={status === s}
          onClick={() => { setStatus(s); setPage(1); if (s === "ABOUT_TO_GRADUATE") setKpi("curveProgress"); }} className={`border px-1.5 py-1 text-[11px] ${status === s ? "border-cyan-400 text-cyan-300" : "border-green-500/30 text-green-500/70"}`}>
          {s} ({counts[s] ?? 0})
        </button>)}
      </div>
      <div role="tablist" aria-label="Launch timeframe" className="mt-1 flex flex-wrap items-center gap-1">
        <span className="text-[11px] uppercase tracking-widest text-green-500/50">Since</span>
        {TIMEFRAMES.map(([tf]) => <button key={tf} type="button" role="tab" aria-selected={timeframe === tf}
          onClick={() => { setTimeframe(tf); setPage(1); }}
          className={`border px-1.5 py-1 text-[11px] ${timeframe === tf ? "border-cyan-400 text-cyan-300" : "border-green-500/30 text-green-500/70"}`}>
          {tf}
        </button>)}
      </div>
      <input aria-label="Search launcher tokens" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        placeholder="Symbol, name or mint · searches the full tape"
        className="mt-2 w-full border border-green-500/30 bg-black px-2 py-1 text-[12px] text-green-300" />

      {/* KPI ranking */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] uppercase tracking-widest text-green-500/50">Rank by</span>
        {KPIS.map((k) => (
          <button key={k.key} type="button" onClick={() => { setKpi(k.key); setPage(1); }}
            className={`border px-1.5 py-0.5 text-[11px] ${kpi === k.key ? "border-green-400 bg-green-500/10 text-green-300" : "border-green-500/30 text-green-500/60"}`}>
            [ {k.label} ]
          </button>
        ))}
      </div>

      {/* launch feed */}
      <div className="mt-2 min-h-0 flex-1 overflow-y-auto border border-green-500/20 max-h-80 lg:max-h-none">
        {tape.map((t, i) => (
          <div key={t.mint} data-selected={selectedMint === t.mint}
            className={`flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-green-500/10 px-2 py-1.5 text-[12px] transition-colors duration-75 last:border-0 hover:bg-green-500/10 hover:border-green-500/40 ${selectedMint === t.mint ? "bg-cyan-500/10" : ""} ${flash[t.mint] === "up" ? "launcher-flip-up" : flash[t.mint] === "down" ? "launcher-flip-down" : ""}`}>
            {/* line 1 — identity: rank, logo, symbol, status, age */}
            <span className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
              <span className="text-green-500/40">#{(page - 1) * (feed?.pageSize ?? 20) + i + 1}</span>
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
              {isOfficialHubMint(t.mint) && (
                <span
                  className="shrink-0 border border-fuchsia-500 bg-fuchsia-500/20 px-1 font-mono text-[10px] font-bold uppercase tracking-widest text-fuchsia-300"
                  title="Official OTC_HUB token — mint verified against the official CA"
                >
                  ★ Official OTC_HUB
                </span>
              )}
              {/* Source-reported reward pairing: e.g. $Nasduck rewards holders
                  in $QQQx. Unverified upstream setting — the token details
                  dialog carries the full payout metadata. */}
              {t.payoutInfo?.rewardSymbol && (
                <span
                  className="shrink-0 border border-amber-400/50 bg-amber-400/10 px-1 font-mono text-[10px] font-bold text-amber-300"
                  title={`$${t.symbol || t.mint.slice(0, 6)} reportedly rewards holders in $${t.payoutInfo.rewardSymbol} · source-reported reward pairing, unverified`}
                >
                  ⟳ $ {t.payoutInfo.rewardSymbol}
                </span>
              )}
              <span className={t.status === "GRADUATED" ? "text-emerald-400" : "text-cyan-400/80"}>[{statusOf(t)}]</span>
              <span className="ml-auto shrink-0 text-green-500/50">{fmtAge(t.ageH)}</span>
            </span>
            {/* line 2 — market metrics: momentum, market cap, volume */}
            <span className="flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-green-500/70 sm:ml-auto sm:w-auto">
              {Number.isFinite(t.change24h) && (
                <span className={t.change24h >= 0 ? "text-emerald-400" : "text-red-400"}>
                  {momentum(t.change24h)}
                </span>
              )}
              {t.dexLive && <span className="text-emerald-400" title="Live DexScreener quote (browser, ~15s)">●</span>}
              <span>mc {fmtUsd(t.mcap)}</span>
              <span>vol {fmtUsd(t.vol24)}</span>
            </span>
            {/* line 3 — curve progress + row actions */}
            <span className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto">
              <CurveProgress token={t} />
              <span className="ml-auto flex flex-wrap items-center gap-2 font-mono text-green-500/70 sm:ml-2 sm:flex-nowrap">
                <button type="button" onClick={() => onTrade?.(t)} disabled={tradingDisabled || !onTrade}
                   className="border border-emerald-500/50 px-1 font-mono text-[11px] text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-40"
                   title={`Trade $${t.symbol} here via Jupiter (route availability varies)`}>
                  [⇄ Trade]
                </button>
                <a href={`https://dexscreener.com/solana/${encodeURIComponent(t.mint)}`} target="_blank" rel="noreferrer" title="View market on DexScreener">[DEX ↗]</a>
                <CopyCa mint={t.mint} />
              </span>
            </span>
          </div>
        ))}
        {!ranked.length && <div className="px-2 py-3 text-center text-[12px] uppercase text-green-500/50">{feed ? "No matching launches · try another status, timeframe or search" : live.error ? "Unavailable" : "Loading…"}</div>}
      </div>
      <Pager page={page - 1} pages={pageCount} onPage={(p) => setPage(p + 1)} total={matches} label="launches" />
      <div className="mt-1 text-[11px] uppercase text-green-500/50">
        Page {feed?.page ?? page}/{pageCount} · {matches} matches · {feed?.rosterTotal ?? "—"} launches total ·
        statuses live-checked for {feed?.statusChecked ?? 0}/{feed?.candidateCount ?? 0} active candidates
        (top 60 volume + top 60 gainers + newest 30); the rest carry archived on-chain curve checks
        (swept every 5 min) — UNKNOWN fades as each sweep covers more of the tape.
        Near graduation = ≥{feed?.nearThreshold ?? 90}% funding · completed curves are AMM-verified, persisted globally in the DB and shown GRADUATED for every visitor.
      </div>
      {!!feed?.statusError?.length && <div className="mt-1 text-[11px] text-amber-400">Some status/progress checks unavailable; UNKNOWN is not BONDING.</div>}
      {tradingDisabled && <div className="mt-1 text-[11px] text-amber-400">Token selection locked while a swap is in progress.</div>}

      {/* fee model + comparison */}
      <div className="mt-2 border border-green-500/20 px-2 py-1.5 text-[11px] uppercase text-green-500/60">
        {err && <span className="text-amber-400">Cohort snapshot unavailable. </span>}
        Fee split · {(data?.feeModel || []).map((s, i) => (
          <span key={s.key} className="mr-2"><span className={`inline-block h-1.5 w-1.5 ${SPLIT_CLS[i]}`} /> {s.label} {s.pct}%</span>
        ))}
        <span className="text-green-500/40">est from 24h vol × 1% curve fee</span>
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-1.5 text-center text-[11px]">
        <div className="border border-emerald-500/30 p-1.5">
          <div className="uppercase tracking-widest text-emerald-400/80">OTC launcher</div>
          <div className="mt-0.5 font-mono text-green-300">
            grad {(gradSample?.rate != null ? (gradSample.rate * 100).toFixed(1) : "—")}% · vol {fmtUsd(c?.vol24h)} · n={c?.launches ?? "—"}
          </div>
        </div>
        <div className="border border-fuchsia-500/30 p-1.5">
          <div className="uppercase tracking-widest text-fuchsia-400/80">pump.fun sample</div>
          <div className="mt-0.5 font-mono text-green-300">
            {n ? `grad ${(n.graduatedShare * 100).toFixed(1)}% · med vol ${fmtUsd(n.medianVol24)} · n=${n.n}${n.source?.startsWith("browser") ? " ● browser scan" : ""}` : "— sample unavailable"}
          </div>
        </div>
      </div>
      <div className="mt-1 text-[10px] text-green-500/40">*Cohort/comparison cached 5 min{data?.stale ? " · STALE" : ""}; grad rate = verified GRADUATED ÷ ALL tape launches ({counts.GRADUATED ?? 0}/{counts.ALL ?? 0}) · pump.fun sample biased to active pairs</div>
      <div className="mt-1 border border-red-500/20 bg-red-500/5 px-2 py-1 text-[10px] uppercase text-red-400/80">
        Not affiliated with the token launches shown · DYOR before buying · high volume &amp; liquidity preferred
        — this is the trench: you win big or lose it all
      </div>
    </div>
    <DialogContent id={detailId} className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto border-green-500/40 bg-black p-4 text-green-300 sm:p-6"
      onCloseAutoFocus={(e) => {
        e.preventDefault();
        // A refresh/filter may have removed the original logo from the list.
        const target = detailTrigger.current?.isConnected ? detailTrigger.current : panelRef.current;
        target?.focus();
      }}>
      {detailToken ? <TokenDetails token={detailToken} symbols={feed?.rewardSymbols || {}} /> : <DialogHeader>
        <DialogTitle>Token unavailable</DialogTitle>
        <DialogDescription>This token is no longer in the latest launcher feed. Close this view to continue.</DialogDescription>
      </DialogHeader>}
      {(feed?.stale || live.error) && <p role="status" className="text-xs text-amber-300">Stale · showing the last available token snapshot.</p>}
    </DialogContent>
    </Dialog>
  );
}