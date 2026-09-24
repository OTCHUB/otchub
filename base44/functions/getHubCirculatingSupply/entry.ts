// Public $HUB circulating-supply endpoint — for Jupiter VRFD's "API Endpoint
// (Preferred)" circulating-supply option and any other aggregator (CoinGecko/
// CoinMarketCap-style consumers) that wants a live, no-auth numeric feed
// instead of a manually-updated value.
//
// Reports raw on-chain mint supply as `circulatingSupply` — matching Jupiter's
// own VRFD form, which already surfaces `mint.supply` (net of every burn,
// since $HUB's mint authority is revoked and burns are the only way supply
// moves) as "Current" circulating supply. Treasury-held $HUB is a plain EOA/
// program-vault balance, not locked behind any on-chain vesting/lock program,
// so it isn't provably non-circulating the way a real lock would be — no
// netting is applied here, by design, to stay consistent with Jupiter's own
// number. No Anchor dependency — raw account-layout parsing only, matching
// every other base44 RPC function (see getHubActivations,
// base44/shared/vaultBalances.ts).

import { Buffer } from "node:buffer";
import { heliusRpc } from "../../shared/otcSources.ts";
import {
  ApiError,
  applyRateLimit,
  createRateLimiter,
  errorResponse,
  requestUrl,
  responseHeaders,
} from "../../shared/apiHttp.js";

// web3.js expects a global Buffer; set it before the module is imported.
if (!globalThis.Buffer) globalThis.Buffer = Buffer;
const { PublicKey } = await import("npm:@solana/web3.js@1.98.4");

const HUB_PROGRAM_ID = new PublicKey("7c5oPs9GvX8vrC5jVFketNx1ZLuPs7HeH8Qc4XJx7b7i");
const HUB_MAX_SUPPLY = 1_000_000_000;

const [CONFIG_PDA] = PublicKey.findProgramAddressSync([Buffer.from("config")], HUB_PROGRAM_ID);

const TTL_MS = 30_000;
const limiter = createRateLimiter(60);
let cache = null; // { ts, payload }

async function getAccount(address) {
  const res = await heliusRpc("getAccountInfo", [address, { encoding: "base64" }]);
  const value = res?.value;
  if (!value?.data?.[0]) return null;
  return { data: Buffer.from(value.data[0], "base64"), owner: value.owner };
}

// spl-token Mint (82 B): COption<Pubkey> mint_auth · u64 supply · u8 decimals · ...
function parseMintSupply(data) {
  if (data.length < 82) throw new Error("bad mint account");
  return { supply: data.readBigUInt64LE(36), decimals: data[44] };
}

async function computeCirculatingSupply() {
  const configAccount = await getAccount(CONFIG_PDA.toBase58());
  if (!configAccount) throw new ApiError(503, "CONFIG_UNAVAILABLE", "$HUB Config account not found.");

  // hub.json `Config`: discriminator(8) + authority(32) + pot(32) + ops_wallet(32) +
  // treasury(32) + otc_program(32) + otc_desk_pot(32) + desk_collection(32) +
  // hub_mint(32, @232) + otc_mint(32) + usdc_mint(32) + ...
  const cfg = configAccount.data;
  const hubMint = new PublicKey(cfg.subarray(232, 264));

  const mintAccount = await getAccount(hubMint.toBase58());
  if (!mintAccount) throw new ApiError(503, "MINT_UNAVAILABLE", "$HUB mint account not found.");
  const { supply: mintSupply, decimals } = parseMintSupply(mintAccount.data);

  return {
    mint: hubMint.toBase58(),
    decimals,
    maxSupply: HUB_MAX_SUPPLY,
    totalSupply: Number(mintSupply) / 10 ** decimals,
    circulatingSupply: Number(mintSupply) / 10 ** decimals,
  };
}

export default async function (req) {
  const headers = responseHeaders(["GET"]);
  try {
    applyRateLimit(headers, limiter());
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (req.method !== "GET") {
      headers.set("Allow", "GET, OPTIONS");
      throw new ApiError(405, "METHOD_NOT_ALLOWED", "Use GET.");
    }
    requestUrl(req); // bounds URL length; this endpoint takes no params

    if (cache && Date.now() - cache.ts < TTL_MS) {
      return Response.json(cache.payload, { headers });
    }
    const result = await computeCirculatingSupply();
    const payload = {
      schemaVersion: 1,
      symbol: "HUB",
      name: "OTCHUB",
      ...result,
      updatedAt: new Date().toISOString(),
    };
    cache = { ts: Date.now(), payload };
    return Response.json(payload, { headers });
  } catch (error) {
    return errorResponse(error, headers);
  }
}
