import React, { useEffect, useState } from "react";
import { Image } from "@/components/ui/image";
import { fmtSol, fmtUsd } from "@/lib/format";
import { SOL_MINT } from "@/lib/stockPrices";
import HoldingsDetail from "@/components/otc/HoldingsDetail";
import { useLiveVaultHoldings } from "@/lib/useLiveVaultHoldings";
import HelpNote from "@/components/otc/HelpNote";
import Pager from "@/components/otc/Pager";

const ME_BASE = "https://magiceden.io/item-details";

export default function HoldingsGallery({ holdings, byStock, floorSol, walletOwned, claimPlan, claimPrices, lifetimeByDesk, onDeskCommand }) {
  const [mode, setMode] = useState(walletOwned ? "INVENTORY" : "SNIPE");
  const solUsdSpot = claimPrices?.[SOL_MINT] ?? null;
  // Wallet variant: 3 rows of cards per page, but the grid densifies on wider
  // screens (3 cols mobile → 5 at md → 8 at xl) so desktop cards don't render
  // huge; page size follows the live column count to stay ~3 full rows.
  // The collection-wide view keeps its original layout.
  const [cols, setCols] = useState(3);
  useEffect(() => {
    if (!walletOwned) return;
    const md = window.matchMedia("(min-width: 768px)");
    const xl = window.matchMedia("(min-width: 1280px)");
    const update = () => setCols(xl.matches ? 8 : md.matches ? 5 : 3);
    update();
    md.addEventListener("change", update);
    xl.addEventListener("change", update);
    return () => {
      md.removeEventListener("change", update);
      xl.removeEventListener("change", update);
    };
  }, [walletOwned]);
  const PAGE_SIZE = walletOwned ? cols * 3 : 12;
  const [sel, setSel] = useState(null);
  const [pageNo, setPageNo] = useState(0);
  const [query, setQuery] = useState("");

  const all = holdings || [];
  const listed = all.filter((h) => h.is_listed && h.listing_price_sol != null);
  // Live on-chain vault balances for the listed desks (shared hook — the
  // arbitrage panel uses the same values so both show identical real holdings).
  const { realHold, scanning, rescan } = useLiveVaultHoldings(listed);

  // Real on-chain vault holding, falling back to the snapshot estimate while
  // the live scan loads (or if it failed). This is the value buyers should
  // trust — not the theoretical accrued estimate.
  const holdSol = (h) => {
    const r = realHold[h.asset_id];
    if (r?.loaded) return r.holdingSol || 0;
    return h.accrued_value_sol || 0;
  };
  const holdUsd = (h) => {
    const r = realHold[h.asset_id];
    if (r?.loaded) return r.holdingUsd || 0;
    return h.accrued_value_usd || 0;
  };
  const isLive = (h) => !!realHold[h.asset_id]?.loaded;
  const hasRealStock = (h) => (realHold[h.asset_id]?.loaded ? !!realHold[h.asset_id].hasStock : true);

  const withSpread = (arr) =>
    arr.map((h) => ({ ...h, spread_sol: holdSol(h) - (h.listing_price_sol || 0) }));
  // LISTED: lowest listing price first (cheapest on secondary market)
  const byPriceAsc = [...listed].sort((a, b) => (a.listing_price_sol || 0) - (b.listing_price_sol || 0));
  // STOCK: highest REAL vault holding first
  const byStockDesc = [...all].sort((a, b) => holdSol(b) - holdSol(a));
  // SNIPE: best net (REAL stock holding − listing price), only desks that
  // actually hold stock on-chain. Empty listed desks are excluded so you
  // never snipe an NFT with no holding.
  const snipes = withSpread(listed.filter((h) => hasRealStock(h))).sort(
    (a, b) => b.spread_sol - a.spread_sol
  );
  // Full sorted dataset for the active mode; the gallery shows ONE page at a
  // time so the panel keeps its allocated space no matter how big holdings get.
  // Wallet variant: just INVENTORY (all owned desks) and LISTING (own
  // listings) — no SNIPE mode, which only makes sense when sniping other
  // people's listings in the collection.
  const full = walletOwned
    ? mode === "LISTING"
      ? byPriceAsc
      : byStockDesc
    : mode === "LISTED"
    ? byPriceAsc
    : mode === "STOCK"
    ? byStockDesc
    : snipes;
  // Desk-number search: match the typed text (e.g. 1602) against the desk
  // name/number across ALL modes — inventory, listings, stock and snipes.
  const q = query.trim().toLowerCase();
  const filtered = q ? full.filter((h) => (h.name || "").toLowerCase().includes(q)) : full;
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(pageNo, pages - 1);
  const list = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  return (
    <div className="border border-green-500/30 bg-black p-3">
      {/* Title and controls stack vertically so nothing overflows on narrow
          screens; buttons wrap and keep a comfortable 36px tap target. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[12px] uppercase tracking-widest text-green-500/70">
          NFT_HOLDINGS :: {all.length} · LISTED {listed.length}
          {floorSol != null && (
            <span className="text-cyan-300">
              {" · FLOOR "}
              {fmtSol(floorSol, 3)} ◎
              {walletOwned
                ? ` × ${all.length} DESKS = ${fmtSol(floorSol * all.length, 3)} ◎`
                : ""}
            </span>
          )}
        </span>
        <span className="text-[11px] text-green-500/40">PRICES INCL. 2% FEE + 5% ROYALTY</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden border border-green-500/30">
          {(walletOwned ? ["INVENTORY", "LISTING"] : ["LISTED", "STOCK", "SNIPE"]).map((m, i) => (
            <button
              key={m}
              onClick={() => {
                setMode(m);
                setPageNo(0);
              }}
              className={`min-h-[36px] px-3 font-mono text-[12px] ${i > 0 ? "border-l border-green-500/30" : ""} ${mode === m ? "bg-emerald-500/15 text-emerald-400" : "text-green-500/60 hover:text-green-400"}`}
            >
              {m}
            </button>
          ))}
        </div>
        <div className="inline-flex items-center gap-1 border border-green-500/30 px-1.5">
          <span className="font-mono text-[12px] text-green-500/40">FIND</span>
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPageNo(0);
            }}
            placeholder="#1602"
            inputMode="numeric"
            className="h-[36px] w-24 bg-transparent font-mono text-[12px] text-green-300 placeholder:text-green-500/30 focus:outline-none"
          />
          {query && (
            <button
              onClick={() => {
                setQuery("");
                setPageNo(0);
              }}
              className="font-mono text-[12px] text-green-500/50 hover:text-green-300"
            >
              [x]
            </button>
          )}
        </div>
        <button
          onClick={() => rescan()}
          disabled={scanning || !listed.length}
          className="ml-auto min-h-[36px] border border-cyan-500/40 px-3 font-mono text-[12px] text-cyan-400 hover:border-cyan-400 disabled:opacity-30"
          title="Re-read real on-chain vault balances for listed desks"
        >
          {scanning ? "[LIVE…]" : "[RESCAN_LIVE]"}
        </button>
      </div>
      <HelpNote label="[?] STK_HLD / SNIPE LEGEND">
        STK_HLD shows REAL on-chain vault stock [LIVE], not the snapshot estimate. SNIPE only flags
        listed desks that actually hold stock — empty vaults are marked NO_STOCK so you don't buy a
        desk that's already been claimed out.
      </HelpNote>

      <div
        className={`mt-3 grid gap-2 ${
          walletOwned
            ? "grid-cols-3 md:grid-cols-5 xl:grid-cols-8"
            : "grid-cols-2 sm:grid-cols-3 md:grid-cols-5"
        }`}
      >
        {list.map((h) => {
          const spread = holdSol(h) - (h.listing_price_sol || 0);
          const live = isLive(h);
          const hasStock = hasRealStock(h);
          const noStock = live && !hasStock && h.is_listed;
          // Accurate per-desk figures — the SAME live vault scan and on-chain
          // claim history the claim tool uses, not snapshot estimates.
          const cd = walletOwned ? claimPlan?.find((p) => p.asset_id === h.asset_id) : null;
          const cUsd = (cd?.claimable || []).reduce(
            (s, t) => s + (t.amount / 10 ** t.decimals) * (claimPrices?.[t.mint] || 0),
            0
          );
          const cSol = solUsdSpot ? cUsd / solUsdSpot : null;
          const lt = walletOwned ? lifetimeByDesk?.[h.asset_id] : null;
          const snipe = !walletOwned && h.is_listed && h.listing_price_sol != null && hasStock && spread > 0.0001;
          return (
            <div
              key={h.asset_id}
              onClick={() => setSel(h)}
              className={`border text-left hover:border-green-500/50 ${noStock ? "border-red-500/40 bg-red-500/5 cursor-pointer" : snipe ? "border-emerald-400 bg-emerald-500/10 cursor-pointer" : h.is_listed && h.listing_price_sol != null ? "border-green-500/40 bg-black cursor-pointer" : "border-green-500/20 bg-black cursor-pointer"}`}
            >
              <div className="relative aspect-square">
                {h.image_url ? <Image src={h.image_url} fittingType="fill" className="h-full w-full" /> : <div className="flex h-full items-center justify-center font-mono text-[12px] text-green-500/30">NO_IMG</div>}
                {h.is_listed && h.listing_price_sol != null && <span className="absolute right-1 top-1 bg-black/80 px-1 font-mono text-[11px] text-emerald-400">LST {fmtSol(h.listing_price_sol, 2)}</span>}
                {snipe && <span className="absolute left-1 top-1 bg-emerald-500/90 px-1 font-mono text-[11px] font-bold text-black">SNIPE</span>}
                {noStock && <span className="absolute left-1 top-1 bg-red-500/90 px-1 font-mono text-[11px] font-bold text-black">NO_STOCK</span>}
              </div>
              <div className="border-t border-green-500/20 p-1.5">
                <div className="truncate font-mono text-[12px] text-green-300">{h.name}</div>
                {walletOwned ? (
                  <>
                    {h.is_listed && h.listing_price_sol != null && (
                      <div className="font-mono text-sm font-bold text-emerald-400">LST {fmtSol(h.listing_price_sol, 2)}<span className="ml-1 text-[11px] font-normal text-green-500/50">SOL</span></div>
                    )}
                    {cd ? (
                      <div className={`font-mono text-[11px] ${cd.claimable.length ? "text-emerald-400" : "text-green-500/50"}`}>
                        CLAIM {fmtSol(cSol, 3)} · {fmtUsd(cUsd, 2)} · {cd.claimable.length}T{" "}
                        <span className="text-cyan-400/70">[LIVE]</span>
                      </div>
                    ) : (
                      <div className="font-mono text-[11px] text-green-500/40">VAULT_SCAN…</div>
                    )}
                    <div className="font-mono text-[11px] text-amber-400/80">
                      LT_CLAIMED {fmtSol(lt?.value_sol, 3)} · {fmtUsd(lt?.value_usd, 2)}
                    </div>
                  </>
                ) : h.is_listed && h.listing_price_sol != null ? (
                  <>
                    <div className="font-mono text-sm font-bold text-emerald-400">LST {fmtSol(h.listing_price_sol, 2)}<span className="ml-1 text-[11px] font-normal text-green-500/50">SOL</span></div>
                    <div className={`font-mono text-[11px] ${noStock ? "text-red-400/80" : "text-green-500/60"}`}>
                      STK_HLD {fmtSol(holdSol(h), 3)} · {fmtUsd(holdUsd(h), 2)}{" "}
                      <span className={live ? "text-cyan-400/70" : "text-amber-400/60"}>[{live ? "LIVE" : "EST"}]</span>
                    </div>
                    <div className={`font-mono text-[11px] ${snipe ? "text-emerald-400" : noStock ? "text-red-400/80" : "text-amber-400/70"}`}>
                      {noStock ? "VAULT_EMPTY — claimed out" : `NET(STK−LST) ${fmtSol(spread, 3)}`}
                    </div>
                    <a
                      href={`${ME_BASE}/${h.asset_id}`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className={`mt-1.5 block border px-1.5 py-1.5 text-center font-mono text-[11px] font-bold hover:bg-emerald-500/10 ${noStock ? "border-red-500/50 text-red-400" : "border-emerald-500/50 text-emerald-400"}`}
                    >
                      [BUY_ON_ME ↗]
                    </a>
                  </>
                ) : (
                  <div className={`font-mono text-[11px] ${noStock ? "text-red-400/80" : "text-green-500/60"}`}>
                    STK_HLD {fmtSol(holdSol(h), 3)} · {fmtUsd(holdUsd(h), 2)}{" "}
                    <span className={live ? "text-cyan-400/70" : "text-amber-400/60"}>[{live ? "LIVE" : "EST"}]</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {!list.length && <div className="col-span-full py-6 text-center font-mono text-[13px] text-green-500/40">{q ? `NO_MATCH :: "${query.trim()}"` : "NO_DATA"}</div>}
      </div>
      <Pager page={page} pages={pages} onPage={setPageNo} total={filtered.length} label="DESKS" />
      <HoldingsDetail
        h={sel}
        byStock={byStock}
        onClose={() => setSel(null)}
        walletOwned={walletOwned}
        claimDesk={claimPlan?.find((p) => p.asset_id === sel?.asset_id) || null}
        claimPrices={claimPrices}
        lifetimeDesk={lifetimeByDesk?.[sel?.asset_id] || null}
        onClaim={(id) => {
          setSel(null);
          onDeskCommand?.(id, "claim");
        }}
        onActivate={(id) => {
          setSel(null);
          onDeskCommand?.(id, "activate");
        }}
      />
    </div>
  );
}