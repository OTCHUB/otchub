import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import HelpNote from "@/components/otc/HelpNote";

const KIND_ORDER = [
  "PROGRAM",
  "ACCOUNT",
  "STOCK_MINT",
  "PDA_SCHEME",
  "INSTRUCTION",
  "DATA_FLOW",
];
const KIND_LABEL = {
  PROGRAM: "PROGRAMS",
  ACCOUNT: "PROTOCOL_ACCOUNTS",
  STOCK_MINT: "STOCK_MINTS :: DISTRIBUTE LINEUP",
  PDA_SCHEME: "PDA_SCHEMES :: DERIVATION",
  INSTRUCTION: "INSTRUCTIONS",
  DATA_FLOW: "DATA_FLOW :: ON-CHAIN → APP",
};

// On-chain → app map: every program, account, mint, PDA scheme, instruction
// and data source the dashboard is built on, so users and AI agents can
// understand the structure and where each displayed number comes from.
export default function ContractsPanel() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    base44.entities.ContractMap.list()
      .then((r) => setRows(r || []))
      .catch((e) => setError(e?.message || "Failed to load contract map"));
  }, []);

  const copy = (addr) => {
    if (!addr) return;
    navigator.clipboard?.writeText(addr);
    setCopied(addr);
    setTimeout(() => setCopied(""), 1200);
  };

  if (error) {
    return (
      <div className="border border-amber-500/40 bg-amber-500/5 px-2 py-1 text-[10px] text-amber-400 break-all">
        ERR: {error}
      </div>
    );
  }
  if (!rows) {
    return <div className="p-3 text-[10px] text-green-500/50">CONTRACT_MAP :: LOADING…</div>;
  }

  const groups = KIND_ORDER.map((k) => ({ kind: k, items: rows.filter((r) => r.kind === k) })).filter(
    (g) => g.items.length
  );

  return (
    <div className="space-y-2">
      {groups.map((g) => (
        <div key={g.kind} className="border border-green-500/20">
          <div className="border-b border-green-500/20 px-2 py-1 text-[9px] uppercase tracking-widest text-green-500/50">
            {KIND_LABEL[g.kind]}
          </div>
          {g.items.map((r) => (
            <div
              key={r.id}
              className="border-b border-green-500/10 px-2 py-1 last:border-0 sm:flex sm:items-start sm:gap-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[10px] font-bold text-green-300">{r.label}</span>
                  {r.slot != null && (
                    <span className="border border-green-500/30 px-1 text-[8px] text-green-500/60">
                      SLOT {r.slot}
                    </span>
                  )}
                </div>
                {r.address && (
                  <button
                    onClick={() => copy(r.address)}
                    className="mt-0.5 block max-w-full truncate text-left text-[9px] text-cyan-400/80 hover:text-cyan-300"
                    title={r.address}
                  >
                    {r.address}
                    {copied === r.address && <span className="ml-1 text-emerald-400">[COPIED]</span>}
                  </button>
                )}
                <p className="mt-0.5 text-[9px] leading-snug text-green-500/60">{r.description}</p>
                {r.data_flow && (
                  <p className="mt-0.5 text-[9px] leading-snug text-emerald-500/60">
                    → {r.data_flow}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      ))}
      <HelpNote label="[?] HOW_TO_READ" className="mb-1">
        PROGRAMS are on-chain code; PROTOCOL_ACCOUNTS hold protocol state and funds (click an
        address to copy it); STOCK_MINTS are the tokenized stock tickers desks accrue (SLOT is the
        distribute(index) argument); PDA_SCHEMES show how per-desk vaults and token accounts are
        derived; INSTRUCTIONS are the program's callable ops; DATA_FLOW shows where each feed
        enters the app. The same table is exposed read-only to AI agents via the app's MCP server.
      </HelpNote>
    </div>
  );
}