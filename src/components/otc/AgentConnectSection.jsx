import React from "react";
import { Link } from "react-router-dom";
import CopyBlock from "@/components/otc/CopyBlock";
import McpApiExamples from "@/components/otc/McpApiExamples";
import { MCP_URL, AGENT_PROMPT } from "@/lib/agentConnect";

// Compact agent-connect block rendered inside the contracts panel: the MCP
// server URL plus the paste-ready agent prompt, with a link to /connect for
// the full client setup guide.
export default function AgentConnectSection() {
  return (
    <div className="border border-emerald-500/30">
      <div className="flex items-center justify-between border-b border-emerald-500/20 px-2 py-1">
        <span className="text-[9px] uppercase tracking-widest text-emerald-500/70">
          AGENT_CONNECT :: MCP_SERVER
        </span>
        <Link to="/connect" className="text-[9px] text-cyan-400/80 hover:text-cyan-300">
          [FULL_GUIDE ↗]
        </Link>
      </div>
      <div className="space-y-2 p-2">
        <CopyBlock
          label="MCP_URL"
          value={MCP_URL}
          note="Public read-only MCP — paste into Claude / ChatGPT / Cursor / any MCP client."
        />
        <CopyBlock
          label="AGENT_PROMPT :: PASTE INTO THE CHAT AFTER CONNECTING"
          value={AGENT_PROMPT}
          note="Teaches the agent what this app is, which tools it has, and what to ask."
        />
        <div className="pt-1">
          <McpApiExamples />
        </div>
      </div>
    </div>
  );
}