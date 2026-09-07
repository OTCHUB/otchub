import React from "react";
import { Link } from "react-router-dom";
import CopyBlock from "@/components/otc/CopyBlock";
import { MCP_URL, LLMS_URL, AGENT_PROMPT } from "@/lib/agentConnect";

const TOOLS = [
  {
    name: "query_otcsnapshot",
    entity: "OTCSNAPSHOT",
    desc: "5-min protocol snapshots: $OTC price / mcap / liquidity, NFT floor, pot SOL balance, protocol earnings / buybacks, mint vs secondary cost, spread %, per-desk daily distributions, pot revenue by source.",
  },
  {
    name: "query_nftholding",
    entity: "NFTHOLDING",
    desc: "One row per OTC_DESK NFT: owner, is_listed, listing price SOL/USD, accrued stock value, mint day.",
  },
  {
    name: "query_claimlog",
    entity: "CLAIMLOG",
    desc: "Stock tokens claimed from desk vaults: wallet, amount, USD/SOL value, tx signature.",
  },
  {
    name: "query_contractmap",
    entity: "CONTRACTMAP",
    desc: "On-chain map: programs, accounts, stock mints, PDA schemes, and data flows the app is built on.",
  },
  {
    name: "query_claimcache",
    entity: "CLAIMCACHE",
    desc: "Cached per-wallet scans of claimable desk stock.",
  },
  {
    name: "query_pricecache",
    entity: "PRICECACHE",
    desc: "Cached spot prices for $OTC, SOL, and stock mints.",
  },
];

const CLIENTS = [
  {
    name: "CLAUDE",
    steps: [
      "Profile menu → Settings → Connectors → “Add custom connector”.",
      "Name it (e.g. OTC_HUB) and paste the MCP server URL above.",
      "Click Add — the query tools appear automatically.",
    ],
  },
  {
    name: "CHATGPT",
    steps: [
      "Apps → enable Developer mode (note: ChatGPT warns about the risks of Developer mode).",
      "“Create app” → name it → paste the MCP server URL → Create.",
      "Enable the app from the chat composer before prompting it.",
    ],
  },
  {
    name: "CURSOR",
    steps: [
      "Settings → Tools & Integrations → “New MCP Server” (opens mcp.json).",
      "Add an entry whose \"url\" is the MCP server URL above, then save.",
      "Toggle the server on.",
    ],
  },
  {
    name: "CUSTOM",
    steps: [
      "Copy the MCP server URL.",
      "Add it as a streamable HTTP MCP server — name + URL is all most clients need.",
      "Reload the client so it picks up the tool list.",
    ],
  },
];

function Section({ title, children }) {
  return (
    <div className="mt-3 border border-green-500/30 bg-black p-3">
      <div className="mb-2 text-[12px] uppercase tracking-widest text-green-500/60">{title}</div>
      {children}
    </div>
  );
}

// Agent connect: teaches an end user how to point an AI client at this app's
// public MCP server, and hands them a paste-ready prompt so the agent
// understands the data it just got access to.
export default function Connect() {
  return (
    <div className="min-h-screen max-w-[100vw] overflow-x-hidden bg-black font-mono text-green-400">
      <div className="mx-auto max-w-3xl px-3 py-4 sm:px-4 sm:py-6">
        {/* Header */}
        <header className="border border-green-500/30 bg-black p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-sm font-bold uppercase tracking-widest text-green-400 sm:text-base">
              &gt; OTC_HUB :: AGENT_CONNECT
              <span className="ml-1 inline-block animate-pulse text-green-500">▋</span>
            </h1>
            <Link
              to="/"
              className="border border-green-500/50 px-2.5 py-1.5 text-[13px] text-green-400 hover:bg-green-500/10"
            >
              [← BACK_TO_DASH]
            </Link>
          </div>
          <p className="mt-1 text-[12px] text-green-500/50">
            HOOK UP ANY AI CLIENT TO THIS APP&apos;S LIVE DATA — PUBLIC, READ-ONLY, NO SIGN-IN
          </p>
        </header>

        {/* Endpoints */}
        <Section title="ENDPOINTS">
          <CopyBlock label="MCP_SERVER" value={MCP_URL} note="Streamable HTTP MCP server — paste this into Claude / ChatGPT / Cursor / any MCP client." />
          <div className="mt-2">
            <CopyBlock label="LLMS_TXT" value={LLMS_URL} note="Machine-readable app summary for crawlers and agents." />
          </div>
        </Section>

        {/* Exposed data tools */}
        <Section title="DATA_TOOLS :: PUBLIC READ-ONLY">
          <div className="space-y-1">
            {TOOLS.map((t) => (
              <div key={t.name} className="border border-green-500/20 px-2 py-1.5">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[13px] font-bold text-green-300">{t.name}</span>
                  <span className="text-[11px] text-green-500/40">::{t.entity}</span>
                </div>
                <div className="mt-0.5 text-[12px] leading-relaxed text-green-500/70">{t.desc}</div>
              </div>
            ))}
          </div>
          <div className="mt-2 text-[11px] text-green-500/40">
            Sensitive entities (users, contact messages, locks, keeper runs) are NOT exposed. Wallet
            and admin operations stay app-side only.
          </div>
        </Section>

        {/* Client setup */}
        <Section title="CLIENT_SETUP">
          <div className="grid gap-2 lg:grid-cols-2">
            {CLIENTS.map((c) => (
              <div key={c.name} className="border border-green-500/20 p-2">
                <div className="text-[13px] font-bold text-green-300">{c.name}</div>
                <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-[12px] leading-relaxed text-green-500/70">
                  {c.steps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
          <div className="mt-2 text-[11px] text-green-500/40">
            After we ship changes, refresh the connector in your client — assistants cache the tool
            list.
          </div>
        </Section>

        {/* Paste-ready prompt */}
        <Section title="AGENT_PROMPT :: COPY & PASTE INTO THE CHAT">
          <CopyBlock
            label="PASTE_THIS_PROMPT"
            value={AGENT_PROMPT}
            note="Give this to the agent right after connecting the MCP server — it explains the app, the tools, and what to ask."
          />
        </Section>

        <footer className="mt-4 space-y-1 text-center text-[12px] text-green-500/30">
          <div>OTC_HUB · COMMUNITY_TOOLING · NOT AFFILIATED WITH OTCDESKS.CASH</div>
          <div>MCP SERVER GOES LIVE ON PUBLISH — DATA UPDATES EVERY ~5 MIN</div>
        </footer>
      </div>
    </div>
  );
}