// Public FOMO access gate for the fomo.otchub.dev extension. Anyone can call
// it, but it only reports on-chain public state: the wallet's owned OTC desks
// (live Helius DAS lookup, same source as the portfolio panel) and its $OTC
// balance. Access is GRANTED while the wallet holds >= 1 desk OR >= 100,000
// $OTC, and REVOKED when the balances drop below that — evaluated live on
// every call, so nothing is stored server-side and revocation is automatic.

import { ADDRESSES, fetchTokenAccountsByOwner, fetchAssetsByOwner } from "../../shared/otcSources.ts";

const MIN_DESKS = 1;
const MIN_OTC = 100000;

// The gate is consumed cross-origin (fomo.otchub.dev), so allow any origin —
// the response contains only public on-chain data.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default async function (req) {
  try {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    const body = await req.json().catch(() => ({}));
    const wallet = String(body.wallet || body.address || "").trim();
    // Base58 Solana pubkey — reject anything malformed before hitting RPC.
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) {
      return Response.json({ error: "valid wallet address required" }, { status: 400, headers: CORS });
    }

    const [accounts, assets] = await Promise.all([
      fetchTokenAccountsByOwner(wallet, ADDRESSES.OTC_TOKEN_MINT),
      fetchAssetsByOwner(wallet, ADDRESSES.NFT_COLLECTION),
    ]);

    let otcBalance = 0;
    for (const a of accounts || []) otcBalance += a.amount || 0;
    const desksOwned = Array.isArray(assets) ? assets.length : 0;
    const access = desksOwned >= MIN_DESKS || otcBalance >= MIN_OTC;

    return Response.json(
      {
        wallet,
        access,
        status: access ? "GRANTED" : "REVOKED",
        desks_owned: desksOwned,
        otc_balance: otcBalance,
        requirements: { min_desks: MIN_DESKS, min_otc: MIN_OTC },
        checked_at: new Date().toISOString(),
      },
      { headers: CORS }
    );
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500, headers: CORS });
  }
}