import { BoltIcon } from "./ui/Icons";
import { RewardFlow } from "./ui/RewardFlow";

const PILLARS = [
  {
    id: "mim",
    k: "M.I.M ETF",
    v: "$HUB holders earn a payout basket of $OTC · CRCLx · NVDAx · SPCXx",
  },
  {
    id: "l3",
    k: "3rd layer",
    v: "extra yield on the OTC Desks flywheel — keeps fresh mints affordable as $OTC grows",
  },
  {
    id: "stake",
    k: "Non-custodial",
    v: "desks stake in the owner wallet — HUB-ACTIVATED desks earn boosted payouts",
  },
];

/** Compact "what is $HUB Protocol?" hero — the whole pitch in one glance: the layer stack
 *  (pump.fun → OTC Desks → $HUB) plus the three pillars. Sits above ProtocolGate so it
 *  renders instantly while chain state loads. */
export function HubIntro() {
  return (
    <div className="term-window px-4 py-3 font-mono">
      <div className="flex items-start gap-2.5">
        <BoltIcon className="mt-1 h-4 w-4 shrink-0 text-green-500" />
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-widest text-green-600">
            $HUB Protocol
          </div>
          <p className="mt-1 text-sm leading-snug text-green-300">
            <span className="font-bold text-green-200">Magic Internet Money</span>
            <span className="text-green-400/90">
              {" "}
              — launched via the OTC Labs launcher, paying holders the M.I.M ETF basket.
            </span>
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] uppercase tracking-widest">
            <span className="text-green-600">pump.fun</span>
            <span className="text-green-500/40">→</span>
            <span className="text-green-500">OTC desks</span>
            <span className="text-green-500/40">→</span>
            <span className="border border-emerald-500/50 bg-emerald-500/10 px-1.5 py-px font-bold text-emerald-300">
              $HUB protocol
            </span>
          </div>
          <div className="mt-2">
            <RewardFlow compact />
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {PILLARS.map((p) => (
              <div key={p.id} className="border-l border-green-500/30 pl-2">
                <div className="text-[10px] font-bold uppercase tracking-widest text-green-400">
                  {p.k}
                </div>
                <div className="mt-0.5 text-[11px] leading-snug text-green-700">{p.v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}