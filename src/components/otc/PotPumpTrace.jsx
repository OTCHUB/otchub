import React from "react";

// The REAL pump.fun fee path for launcher coins — traced live on-chain
// 2026-09-07 by decoding swaps on the $401jk launcher pool (20 txs), parsing
// pool account data for per-coin creators, and reading the pot's own inflow
// tape. Every address below was verified on-chain this day.
const scan = (addr) => `https://solscan.io/account/${addr}`;
const short = (addr) => `${addr.slice(0, 4)}…${addr.slice(-4)}`;

const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const PUMP_GLOBAL_VAULT = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1"; // 34.6 SOL live, per-swap deposits
const SAMPLE_POOL = "4BccuQmAtSJEETp41HTPV2QKuyrxgafPsXoXSkEcrpUw"; // $401jk pumpswap pool
const CREATORS = [
  ["$401jk", "H5q2Sqaq1dgG3gFqeUB3RfyC4Js4U2kSPC18uPGceQcj"],
  ["$NASDUCK", "2kDQAS4FdCf7w2nYuTfUjF974A7WL7NBhx8mBqSBNoin"],
];

export default function PotPumpTrace() {
  return (
    <div className="space-y-0.5 border border-amber-500/30 bg-amber-500/5 px-2 py-1 font-mono text-[11px]">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-amber-300">
        <span>PUMP.FUN :: SWAP_FEE → PUMP GLOBAL VAULT {short(PUMP_GLOBAL_VAULT)} (34.6 SOL LIVE) + POOL VAULT · CREATOR_FEE 0% ON SAMPLED POOL · 0% → POT</span>
        <a href={scan(PUMP_PROGRAM)} target="_blank" rel="noopener noreferrer" className="ml-auto text-cyan-300/80 underline hover:text-cyan-300">PGM ↗</a>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-red-400">
        <span>REWARD_SPLIT :: LAUNCHER-COIN HOLDERS ≈4186 SOL = 78% OF ALL DISTRIBUTED (GPRO 1403 · PUMP 982 · QQQx 616 · SPYx 413 …) — DESKS: 22% · 0.37 → 0.10 SOL/DESK/DAY</span>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-green-500/60">
        <span>POT STILL GETS PER-SWAP MICRO-DEPOSITS (97/100 LATEST POT TXS ≈0.03 EA) BUT −85% vs 09-01 PEAK 828 SOL · TROUGH 61 (09-05)</span>
        <span className="hidden sm:inline">CREATORS HOLD 0 SOL:</span>
        {CREATORS.map(([sym, addr]) => (
          <a key={addr} href={scan(addr)} target="_blank" rel="noopener noreferrer" className="text-amber-300/70 underline hover:text-amber-300">
            {sym} {short(addr)} ↗
          </a>
        ))}
      </div>
      <details className="border border-green-500/15 px-1 py-0.5 text-[11px]">
        <summary className="cursor-pointer select-none uppercase tracking-widest text-green-500/50 hover:text-green-400">
          [+] TRACE EVIDENCE
        </summary>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-green-500/60">
          <a href={scan(PUMP_GLOBAL_VAULT)} target="_blank" rel="noopener noreferrer" className="text-cyan-300/80 underline hover:text-cyan-300">PUMP_GLOBAL_VAULT {short(PUMP_GLOBAL_VAULT)} ↗</a>
          <a href={scan(SAMPLE_POOL)} target="_blank" rel="noopener noreferrer" className="text-cyan-300/80 underline hover:text-cyan-300">POOL $401jk {short(SAMPLE_POOL)} ↗</a>
          {CREATORS.map(([sym, addr]) => (
            <a key={addr} href={scan(addr)} target="_blank" rel="noopener noreferrer" className="text-amber-300/80 underline hover:text-amber-300">CREATOR {sym} {short(addr)} ↗</a>
          ))}
          <a href={`${scan("BZcvtxDy4WihU24k3pezzajuiqYtTUHPfH7b5m26BucR")}#transfers`} target="_blank" rel="noopener noreferrer" className="text-cyan-300/80 underline hover:text-cyan-300">POT TRANSFERS ↗</a>
        </div>
        <p className="mt-1 leading-snug text-green-500/50">
          Method: 20 swaps decoded on the $401jk pumpswap pool — every fee-sized SOL gain landed in the
          pool's own vault (pAMM PDA) or pump.fun's global vault; the coin creator vault accrued 0.00
          and both per-coin creators (parsed from pool account data) hold 0 SOL with only failed txs.
          So no creator-fee route reaches desks or coin creators — swap fees stay with pump.fun and
          the LP, while fee-funded stock rewards flow overwhelmingly to launcher-coin holders
          (≈78% of everything distributed vs ≈22% to desks). Desk pot share continues only as
          collapsed per-swap micro-deposits. Community tooling — verify on Solscan.
        </p>
      </details>
    </div>
  );
}