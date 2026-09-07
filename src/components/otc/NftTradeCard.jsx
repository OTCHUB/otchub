import React from "react";
import HelpNote from "@/components/otc/HelpNote";

// Official protocol mint app — minting is protocol-owned (100,000 OTC burned +
// 0.5 SOL surcharge), so this links out rather than reimplementing it.
const MINT_URL = "https://otcdesks.cash/mint";
// Magic Eden collection page — where listed OTC desks trade.
const ME_COLLECTION_URL = "https://magiceden.io/collections/otc_desks";
// Magic Eden profile "My Items" — where you list/sell your desks.
const ME_PROFILE_URL = "https://magiceden.io/profile";

const linkCls =
  "flex items-center justify-between border border-green-500/40 px-2.5 py-2 font-mono text-[12px] text-green-300 hover:border-emerald-500/50 hover:bg-green-500/10";

export default function NftTradeCard() {
  return (
    <div className="border border-green-500/30 bg-black p-3">
      <span className="text-[12px] uppercase tracking-widest text-green-500/70">
        DESK_TRADE :: NFT ROUTES
      </span>

      <div className="mt-2 space-y-1.5">
        <a href={MINT_URL} target="_blank" rel="noreferrer" className={linkCls}>
          <span>[MINT_FRESH_DESK]</span>
          <span className="text-amber-400">otcdesks.cash ↗</span>
        </a>
        <a href={ME_COLLECTION_URL} target="_blank" rel="noreferrer" className={linkCls}>
          <span>[BUY_DESKS]</span>
          <span className="text-cyan-400">magic_eden ↗</span>
        </a>
        <button
          onClick={() =>
            document
              .getElementById("otc-listings")
              ?.scrollIntoView({ behavior: "smooth", block: "start" })
          }
          className={`${linkCls} w-full text-left`}
        >
          <span>[→ SNIPE_LISTINGS]</span>
          <span className="text-emerald-400">in-app ↓</span>
        </button>
        <a href={ME_PROFILE_URL} target="_blank" rel="noreferrer" className={linkCls}>
          <span>[SELL_YOUR_DESKS]</span>
          <span className="text-cyan-400">my_items ↗</span>
        </a>
      </div>

      <HelpNote label="[?] CLAIM BEFORE SELLING" className="mt-2">
        Desks trade on Magic Eden. A listed desk keeps earning until sold — unclaimed vault stock
        transfers WITH the desk to the buyer, so claim first (WALLET :: CLAIM_TOOL) if you want
        the stock, or sell with it bundled for a premium. Verify a desk's REAL vault holding
        before buying — the bundled stock is what makes a listing cheap or expensive.
      </HelpNote>
    </div>
  );
}