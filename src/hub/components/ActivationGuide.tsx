import { Panel } from "./ui/Panel";
import { BasketIcons } from "./ui/StockIcon";

const STEPS = [
  {
    k: "1 · NATIVE YIELD",
    v: "An OTC Desk NFT perpetually earns stock yield from OTC ecosystem revenue — just by holding it in your wallet. That never changes.",
  },
  {
    k: "2 · HUB BOOST",
    v: "Activating adds a second, extra yield stream on top — a low-entry tier system pegged to the USD value of $HUB.",
  },
  {
    k: "3 · CLAIM BY TIER",
    v: "Every round splits 90 / 5 / 2.5 / 2.5 → stakers · $HUB burn · treasury · $HUB/$OTC liquidity. You claim, pro-rata by tier.",
  },
  {
    k: "VOID ON TRANSFER",
    v: "Sell or move an activated desk and the activation voids — the forfeited boost returns to the HUB Pot. New owners re-activate to earn again.",
  },
];

const TIERS = [
  ["T1", "TRADER", "$50"],
  ["T2", "BROKER", "$60"],
  ["T3", "DEALER", "$70"],
  ["T4", "MARKET MAKER", "$80"],
];

/** Compact activation explainer — the whole story in five short blocks, collapsed by default so
 *  the wallet lane stays light. Lives just above ACTIVATE_DESK in WalletPanel. */
export function ActivationGuide() {
  return (
    <Panel
      title="HOW HUB ACTIVATION WORKS"
      collapsible
      defaultCollapsed
      collapsedSummary="native yield + $HUB boost · tiers pegged to $HUB's USD value · 90/5/2.5/2.5 round split"
    >
      <div className="grid gap-2 sm:grid-cols-2">
        {STEPS.map((s) => (
          <div key={s.k} className="border-l border-green-500/30 pl-2">
            <div className="text-[10px] font-bold uppercase tracking-widest text-green-400">
              {s.k}
            </div>
            <div className="mt-0.5 text-[11px] leading-snug text-green-700">{s.v}</div>
          </div>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {TIERS.map(([t, name, usd]) => (
          <div key={t} className="border border-green-500/20 bg-green-500/5 px-2 py-1 text-center">
            <div className="text-[10px] uppercase tracking-widest text-green-600">
              {t} {name}
            </div>
            <div className="text-sm font-bold text-green-300">{usd}</div>
          </div>
        ))}
      </div>
      <div className="mt-1.5 text-center text-[10px] uppercase tracking-widest text-green-700">
        + 0.5 SOL flat per call · upgrades burn only the difference
      </div>
      <div className="mt-2 border-l border-cyan-500/30 pl-2">
        <div className="text-[10px] font-bold uppercase tracking-widest text-cyan-400">
          TREASURY FLYWHEEL
        </div>
        <div className="mt-0.5 text-[11px] leading-snug text-green-700">
          The treasury's initial 2% $HUB stack earns the M.I.M payout basket from $HUB trading
          activity: 10% auto-compounds into locked LP — a fee-earning liquidity layer between $HUB
          and OTC/CRCLx/NVDAx/SPCXx — the rest feeds back into the HUB Pot for activated desks.
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase tracking-widest text-green-700">
            m.i.m basket
          </span>
          <BasketIcons />
        </div>
      </div>
    </Panel>
  );
}