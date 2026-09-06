// Pump's official IDL: pump-fun/pump-public-docs, idl/pump.json (2026-09-06).
// Decode only the stable 49-byte prefix; newer fields follow `complete`.
export const PUMP_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
export const PUMP_CURVE_DISCRIMINATOR = Object.freeze([23, 183, 248, 55, 96, 216, 172, 96]);
export const NEAR_THRESHOLD = 90;
const U64_MAX = (1n << 64n) - 1n;
const AMMS = new Set(["pumpswap", "raydium", "meteora"]);
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// PublicKey is injected so the same implementation runs under Deno and Node.
export function createCurveAddressDeriver(PublicKey) {
  const program = new PublicKey(PUMP_PROGRAM_ID);
  const seed = new TextEncoder().encode("bonding-curve");
  return (mint) => {
    if (typeof mint !== "string" || !ADDRESS.test(mint)) throw new Error("INVALID_MINT");
    const key = new PublicKey(mint);
    if (key.toBase58() !== mint) throw new Error("INVALID_MINT");
    return PublicKey.findProgramAddressSync([seed, key.toBytes()], program)[0].toBase58();
  };
}

export function curveFundingProgress({ virtualToken, virtualQuote, realToken, realQuote, complete }) {
  const reserves = [virtualToken, virtualQuote, realToken, realQuote];
  if (reserves.some((v) => typeof v !== "bigint" || v < 0n || v > U64_MAX)
    || typeof complete !== "boolean") return null;
  // A migrated/completed account can have drained reserves; the flag is authoritative.
  if (complete) return 100;
  const remainingVirtual = virtualToken - realToken;
  if (virtualToken === 0n || virtualQuote === 0n || remainingVirtual <= 0n
    || realQuote > virtualQuote) return null;
  const offsetQ = virtualQuote - realQuote;
  const invariant = virtualQuote * virtualToken;
  // targetRealQ = invariant / remainingVirtual - offsetQ. Keep it rational
  // until the final percentage: neither u64 multiplication nor Number rounding.
  const targetNumerator = invariant - offsetQ * remainingVirtual;
  if (targetNumerator <= 0n || invariant > U64_MAX * remainingVirtual
    || targetNumerator > U64_MAX * remainingVirtual) return null;
  const scaled = realQuote * remainingVirtual * 1_000_000n / targetNumerator;
  // Truncate to 4 percentage decimals: 89.99999 must not round up into near-90.
  return Number(scaled > 1_000_000n ? 1_000_000n : scaled) / 10_000;
}

export function decodeLauncherCurve(account) {
  if (account === null) return null; // Absence is not evidence of graduation.
  const invalid = () => new Error("CURVE_ACCOUNT_INVALID");
  if (!account || account.owner !== PUMP_PROGRAM_ID || account.executable === true
    || !Array.isArray(account.data) || account.data[1] !== "base64"
    || typeof account.data[0] !== "string" || account.data[0].length > 4096) throw invalid();
  let bytes;
  try {
    bytes = Uint8Array.from(atob(account.data[0]), (char) => char.charCodeAt(0));
  } catch { throw invalid(); }
  if (bytes.length < 49 || PUMP_CURVE_DISCRIMINATOR.some((v, i) => bytes[i] !== v)
    || bytes[48] > 1) throw invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const complete = bytes[48] === 1;
  return {
    curveComplete: complete,
    curveProgress: curveFundingProgress({
      virtualToken: view.getBigUint64(8, true), virtualQuote: view.getBigUint64(16, true),
      realToken: view.getBigUint64(24, true), realQuote: view.getBigUint64(32, true), complete,
    }),
  };
}

export function hasConfirmedAmmPair(mint, pairs) {
  return pairs.some((p) => p?.chainId === "solana" && AMMS.has(p.dexId)
    && typeof p.pairAddress === "string" && ADDRESS.test(p.pairAddress)
    && (p.baseToken?.address === mint || p.quoteToken?.address === mint)
    && Number.isFinite(p.liquidity?.usd) && p.liquidity.usd > 0);
}

export function launcherStatus(curve, graduated) {
  if (graduated) return "GRADUATED";
  if (curve?.curveComplete === true) return "ABOUT_TO_GRADUATE"; // Migration pending/unconfirmed.
  if (!Number.isFinite(curve?.curveProgress)) return "UNKNOWN";
  return curve.curveProgress >= NEAR_THRESHOLD ? "ABOUT_TO_GRADUATE" : "BONDING";
}