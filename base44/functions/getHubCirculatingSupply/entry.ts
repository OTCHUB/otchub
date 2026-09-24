// Public $HUB circulating-supply endpoint — for Jupiter VRFD's "API Endpoint
// (Preferred)" circulating-supply option and any other aggregator (CoinGecko/
// CoinMarketCap-style consumers) that wants a live, no-auth numeric feed
// instead of a manually-updated value.
//
// Mirrors the exact on-chain math src/hub-sdk/src/reader.ts's toSupplyView
// uses: circulating = mint.supply (already net of every burn, since $HUB's
// mint authority is revoked and burns are the ONLY way supply moves) minus
// "locked" $HUB (treasury multisig's ATA + the Hub program's own vault PDA
// ATA) minus $HUB already swapped into the treasury for the LP leg but not
// yet deployed (`TreasuryState.lp_hub_deposited`). No Anchor dependency —
// raw account-layout parsing only, matching every other base44 RPC function
// (see getHubActivations, base44/shared/vaultBalances.ts). Field offsets are
// taken straight from src/hub-sdk/idl/hub.json's `Config` / `TreasuryState`
// type definitions (Anchor/Borsh packs fields tightly, in declared order, no
// padding) — keep both in sync if the on-chain program's structs change.

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
const ATA_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const HUB_MAX_SUPPLY = 1_000_000_000;

const [CONFIG_PDA] = PublicKey.findProgramAddressSync([Buffer.from("config")], HUB_PROGRAM_ID);
const [VAULT_PDA] = PublicKey.findProgramAddressSync([Buffer.from("vault")], HUB_PROGRAM_ID);
const [TREASURY_PDA] = PublicKey.findProgramAddressSync([Buffer.from("treasury")], HUB_PROGRAM_ID);

const TTL_MS = 30_000;
const limiter = createRateLimiter(60);
let cache = null; // { ts, payload }

function ataPda(owner, mint, tokenProgram) {
  const [addr] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
    ATA_PROGRAM_ID,
  );
  return addr;
}

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

// spl-token Account (165 B): mint · owner · u64 amount ...
function parseTokenAmount(data) {
  return data.length >= 72 ? data.readBigUInt64LE(64) : 0n;
}

async function computeCirculatingSupply() {
  const configAccount = await getAccount(CONFIG_PDA.toBase58());
  if (!configAccount) throw new ApiError(503, "CONFIG_UNAVAILABLE", "$HUB Config account not found.");

  // hub.json `Config`: discriminator(8) + authority(32) + pot(32) + ops_wallet(32) +
  // treasury(32, @104) + otc_program(32) + otc_desk_pot(32) + desk_collection(32) +
  // hub_mint(32, @232) + otc_mint(32) + usdc_mint(32) + ...
  const cfg = configAccount.data;
  const treasuryWallet = new PublicKey(cfg.subarray(104, 136));
  const hubMint = new PublicKey(cfg.subarray(232, 264));

  const mintAccount = await getAccount(hubMint.toBase58());
  if (!mintAccount) throw new ApiError(503, "MINT_UNAVAILABLE", "$HUB mint account not found.");
  const { supply: mintSupply, decimals } = parseMintSupply(mintAccount.data);
  const tokenProgram = new PublicKey(mintAccount.owner);

  const treasuryAta = ataPda(treasuryWallet, hubMint, tokenProgram);
  const vaultAta = ataPda(VAULT_PDA, hubMint, tokenProgram);

  const [treasuryAtaAccount, vaultAtaAccount, treasuryStateAccount] = await Promise.all([
    getAccount(treasuryAta.toBase58()),
    getAccount(vaultAta.toBase58()),
    getAccount(TREASURY_PDA.toBase58()),
  ]);

  const lockedUnits =
    (treasuryAtaAccount ? parseTokenAmount(treasuryAtaAccount.data) : 0n) +
    (vaultAtaAccount ? parseTokenAmount(vaultAtaAccount.data) : 0n);

  // hub.json `TreasuryState`: discriminator(8) + multisig(32) + vault(32) + desks_owned u32(4) +
  // sweep_budget_cap_bp u16(2) + sweep_payback_cap_lamports u64(8) + exit_discount_bp u16(2) +
  // exit_hub_leg_bp u16(2) + floor_staleness_bp u16(2) + hub_float_cap_bp u16(2) +
  // total_exits u32(4) + total_sweeps u32(4) + lp_pending_hub_units u64(8) + vault_hub(32) +
  // vault_wsol(32) + vault_usdc(32) + treasury_float_vault(32) + treasury_float_units u64(8) +
  // lp_hub_sol_active bool(1) + lp_hub_otc_active bool(1) + lp_hub_deposited u64 @ byte 248.
  const lpHubDeposited = treasuryStateAccount ? treasuryStateAccount.data.readBigUInt64LE(248) : 0n;

  let circulatingUnits = mintSupply - lockedUnits - lpHubDeposited;
  if (circulatingUnits < 0n) circulatingUnits = 0n;

  return {
    mint: hubMint.toBase58(),
    decimals,
    maxSupply: HUB_MAX_SUPPLY,
    totalSupply: Number(mintSupply) / 10 ** decimals,
    circulatingSupply: Number(circulatingUnits) / 10 ** decimals,
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
