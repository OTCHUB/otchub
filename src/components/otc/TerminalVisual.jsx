import React, { useEffect, useState } from "react";

// Decorative animated terminal that fills empty desktop grid space. Purely
// visual — "feed" streams simulated RPC calls, "code" types out a protocol
// source snippet. No data enters or leaves this component.
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const short = (s) => `${s.slice(0, 4)}…${s.slice(-4)}`;
const MINT = "MukLDtJ8Cx9DxLbeyLRSWPSposTMWuwHANbuaudpump";

const FEED = [
  () => `getSlot() -> ${rand(320000000, 335000000)}`,
  () => `getBalance(POT_PDA) -> ${rand(120, 980)}.${rand(100, 999)} SOL`,
  () => `getMultipleAccounts(desks[${rand(20, 120)}]) -> OK`,
  () => `searchAssets(collection: ${short(MINT)}) -> ${rand(1, 24)} desks`,
  () => `quote(SOL -> $OTC ${rand(1, 9)}.${rand(0, 9)} SOL) -> ${rand(50000, 900000)} $OTC`,
  () => `simulate(distribute#${rand(0, 4999)}) -> OK · ${rand(40, 180)} CU`,
  () => `sendTransaction(bundle[${rand(1, 5)}]) -> sig ${short("9WzDXwQyFho6YtSMAd1zvW5tRyLNhrx")}`,
  () => `getPriorityFeeEstimate -> ${rand(2, 40)} µlam/CU`,
  () => `DexScreener poll -> $OTC $${(rand(3, 9) + rand(0, 99) / 100).toFixed(4)}`,
  () => `Magic Eden listings -> ${rand(30, 90)} desks for sale`,
  () => `snapshot ingest -> row #${rand(1200, 1900)} stored`,
  () => `anchor log :: Distribute { index: ${rand(0, 4999)}, amount: ${rand(1, 9)}.${rand(0, 99)} }`,
  () => `claim(${short("9WzDXwQyFho6YtSMAd1zvW5tRyLNhrx")}) -> vault drained OK`,
];

const CODE_LINES = [
  "pub fn distribute(ctx: Context<Distribute>, index: u32) -> Result<()> {",
  "    let desk = &mut ctx.accounts.desk;",
  "    let vault = &mut ctx.accounts.vault;",
  "    let owed = desk.claimable_sol;",
  "    require!(owed > 0, ErrorCode::NothingOwed);",
  "",
  "    // move protocol backlog into the desk vault",
  "    let round = ctx.accounts.protocol.rounds;",
  "    vault.credit(owed, round)?;",
  "    desk.claimable_sol = 0;",
  "    emit!(Distributed { index, amount: owed });",
  "    Ok(())",
  "}",
  "",
  "#[derive(Accounts)]",
  "pub struct Distribute<'info> {",
  "    #[account(mut)] pub desk: Account<'info, Desk>,",
  "    #[account(mut)] pub vault: Account<'info, Vault>,",
  "    pub protocol: Account<'info, Protocol>,",
  "}",
];

export default function TerminalVisual({ variant = "feed", className = "" }) {
  const [rows, setRows] = useState([]);
  const [typing, setTyping] = useState("");

  useEffect(() => {
    setRows([]);
    setTyping("");
    if (variant === "code") {
      let li = 0;
      let ci = 0;
      const id = setInterval(() => {
        const line = CODE_LINES[li % CODE_LINES.length];
        if (ci <= line.length) {
          setTyping(line.slice(0, ci));
          ci += 1;
        } else {
          setRows((p) => [...p.slice(-10), line]);
          setTyping("");
          ci = 0;
          li += 1;
        }
      }, 22);
      return () => clearInterval(id);
    }
    setRows([pick(FEED)(), pick(FEED)(), pick(FEED)()]);
    const id = setInterval(() => {
      setRows((p) => [...p.slice(-12), pick(FEED)()]);
    }, 650);
    return () => clearInterval(id);
  }, [variant]);

  return (
    <div className={`flex h-full min-h-[180px] flex-col overflow-hidden bg-black ${className}`}>
      <div className="min-h-0 flex-1 px-2.5 py-2">
        <div className="flex h-full flex-col justify-end gap-0.5 text-[9px] leading-snug sm:text-[10px]">
          {rows.map((r, i) => (
            <div
              key={i}
              className={
                variant === "code"
                  ? "truncate text-green-500/60"
                  : "truncate text-green-400/70"
              }
            >
              {variant === "code" ? (
                <>
                  <span className="mr-2 text-green-500/30">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {r}
                </>
              ) : (
                <>
                  <span className="text-green-500/40">&gt; </span>
                  {r}
                </>
              )}
            </div>
          ))}
          <div className="truncate text-emerald-300">
            {variant === "code" ? null : <span className="text-green-500/40">$ </span>}
            {typing}
            <span className="animate-pulse">▋</span>
          </div>
        </div>
      </div>
    </div>
  );
}