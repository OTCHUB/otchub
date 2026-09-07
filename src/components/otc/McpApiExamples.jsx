import React, { useState } from "react";
import CopyBlock from "@/components/otc/CopyBlock";
import { MCP_URL } from "@/lib/agentConnect";

// Real request/response pairs for every MCP tool on the app's data server,
// captured live from https://otchub.dev/api/mcp (2026-09-04). Responses are
// trimmed to their first record with "…" where arrays continue.
const EXAMPLES = [
  {
    tool: "query_otcsnapshot",
    desc: "Protocol snapshots, newest-first. The 'current' state = newest record.",
    request:
      '{\n  "jsonrpc": "2.0", "id": 1, "method": "tools/call",\n  "params": {\n    "name": "query_otcsnapshot",\n    "arguments": { "limit": 1, "sort": "-created_date" }\n  }\n}',
    response:
      '{\n  "records": [{\n    "token_price_usd": 0.001989,\n    "token_price_change_24h": -41.3,\n    "nft_floor_sol": 1.5925,\n    "nft_listed_count": 85,\n    "pot_sol_balance": 1.2999,\n    "protocol_earned_sol": 5908.0,\n    "mint_cost_sol": 2.461,\n    "secondary_cost_sol": 1.704,\n    "spread_pct": 30.73,\n    "recommendation": "buy_secondary",\n    "desks_minted": 2192,\n    "created_date": "2026-09-04T17:40:23.698Z",\n    "by_stock": { "items": [ … ] },\n    "per_desk": { "items": [ … ] },\n    "pot_sources": { … },\n    "buybacks": { "items": [ … ] }\n  }]\n}',
  },
  {
    tool: "query_nftholding",
    desc: "One row per desk NFT. Filter is_listed=true for buyable desks.",
    request:
      '{\n  "jsonrpc": "2.0", "id": 1, "method": "tools/call",\n  "params": {\n    "name": "query_nftholding",\n    "arguments": {\n      "query": { "is_listed": true },\n      "sort": "listing_price_sol",\n      "limit": 5\n    }\n  }\n}',
    response:
      '{\n  "records": [{\n    "name": "OTC Desk #1460",\n    "asset_id": "CrMTT7pXFg266zuoiGuac19ESzAZ7ARhxs26HRsuA6AN",\n    "owner": "1BWutmTvYPwDtmw9abTkS4Ssr8no61spGAvW1X6NDix",\n    "is_listed": true,\n    "listing_price_sol": 1.7013,\n    "listing_price_usd": 172.66,\n    "accrued_value_sol": 0.000125,\n    "mint_day": "2026-08-30"\n  }, … ]\n}',
  },
  {
    tool: "query_claimlog",
    desc: "Tokenized stock claimed out of desk vaults, newest-first.",
    request:
      '{\n  "jsonrpc": "2.0", "id": 1, "method": "tools/call",\n  "params": {\n    "name": "query_claimlog",\n    "arguments": { "sort": "-created_date", "limit": 10 }\n  }\n}',
    response:
      '{\n  "records": [{\n    "wallet": "7Z49tNXPqS4uKMXxACwwWkyVhhycGfaLZaqFyso9ouSR",\n    "asset_id": "B9HtV1nLReXvjRtWhh5frfS7N1Ry4xibBpmi1W9fSaJE",\n    "symbol": "CRCLx",\n    "amount": 0.00087032,\n    "value_usd": 0,\n    "value_sol": 0,\n    "tx_sig": "39rgWw451eZvaJGKEnGkogDFaFXRGVjhuuNhPL1Q9PLqbbC22YqYyCU37WP8e7JdCEm9GHYkDgYbkfCWvWdP65PE",\n    "created_date": "2026-09-02T19:12:39.104Z"\n  }, … ]\n}',
  },
  {
    tool: "query_contractmap",
    desc: "On-chain map: programs, accounts, stock mints, PDA schemes, data flows.",
    request:
      '{\n  "jsonrpc": "2.0", "id": 1, "method": "tools/call",\n  "params": {\n    "name": "query_contractmap",\n    "arguments": { "query": { "kind": "PROGRAM" }, "limit": 10 }\n  }\n}',
    response:
      '{\n  "records": [{\n    "label": "OTC_DESKS_PROGRAM",\n    "kind": "PROGRAM",\n    "address": "AjMx5My4YUDHMiCtLpTAtgkiUJgrpJnQqd5AcQnddHQW",\n    "description": "otcdesks v0.1.0 mainnet program — \'NFTs that accrue tokenized stock, funded by mint surcharges\'."\n  }, … ]\n}',
  },
  {
    tool: "query_claimcache",
    desc: "Cached per-wallet desk claim scans (vault ticker balances per desk).",
    request:
      '{\n  "jsonrpc": "2.0", "id": 1, "method": "tools/call",\n  "params": {\n    "name": "query_claimcache",\n    "arguments": { "query": { "wallet": "<WALLET_PUBKEY>" }, "limit": 1 }\n  }\n}',
    response:
      '{\n  "records": [{\n    "wallet": "<WALLET_PUBKEY>",\n    "desks": { "items": [{\n      "asset_id": "qKfmBi5PHasBsdUKkxTHtJDqA8LhFpeiB7BEeyuRKzk",\n      "name": "OTC Desk #1180",\n      "tickers": [{\n        "index": 0, "symbol": "ANDURIL", "mint": "PresT…",\n        "decimals": 9, "amount": 37236908, "exists": true\n      }, … ]\n    }, … ] },\n    "updated_date": "2026-09-04T…"\n  }]\n}',
  },
  {
    tool: "query_pricecache",
    desc: "Spot prices for SOL + the 13-stock rotation, plus the $OTC pair.",
    request:
      '{\n  "jsonrpc": "2.0", "id": 1, "method": "tools/call",\n  "params": {\n    "name": "query_pricecache",\n    "arguments": { "limit": 1 }\n  }\n}',
    response:
      '{\n  "records": [{\n    "key": "global_spot",\n    "prices": { "So11111111111111111111111111111111111111112": 101.49, … },\n    "otc_pair": { "price_usd": 0.001989, "price_native": 0.0000196, … },\n    "updated_date": "2026-09-04T…"\n  }]\n}',
  },
];

// API request/response reference for every MCP tool, rendered inside the
// agent-connect panel. Collapsed by default to keep the panel compact.
export default function McpApiExamples() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(EXAMPLES[0].tool);

  return (
    <div className="border border-green-500/20">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-2 py-1 text-[11px] uppercase tracking-widest text-green-500/60 hover:text-green-400"
      >
        <span>API_EXAMPLES :: REQ/RES FOR ALL TOOLS</span>
        <span>{open ? "[−]" : "[+]"}</span>
      </button>
      {open && (
        <div className="border-t border-green-500/20 p-2">
          <CopyBlock
            label="ENDPOINT :: POST JSON-RPC 2.0"
            value={`POST ${MCP_URL}\nContent-Type: application/json\nAccept: application/json, text/event-stream`}
            note="Streamable HTTP MCP. Handshake: initialize → notifications/initialized → tools/call."
          />
          <div className="mt-2 flex flex-wrap gap-1">
            {EXAMPLES.map((e) => (
              <button
                key={e.tool}
                onClick={() => setActive(e.tool)}
                className={`border px-2 py-0.5 text-[12px] ${
                  active === e.tool
                    ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
                    : "border-green-500/30 text-green-500/60 hover:bg-green-500/10"
                }`}
              >
                {e.tool}
              </button>
            ))}
          </div>
          {EXAMPLES.filter((e) => e.tool === active).map((e) => (
            <div key={e.tool} className="mt-2 space-y-2">
              <p className="text-[11px] text-green-500/50">{e.desc}</p>
              <CopyBlock label={`REQUEST :: tools/call ${e.tool}`} value={e.request} />
              <div className="border border-green-500/20 bg-black">
                <div className="border-b border-green-500/20 px-2 py-1 text-[11px] uppercase tracking-widest text-green-500/50">
                  RESPONSE :: 200 OK (TRIMMED)
                </div>
                <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all px-2 py-2 text-[12px] leading-relaxed text-cyan-300/80">
                  {e.response}
                </pre>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}