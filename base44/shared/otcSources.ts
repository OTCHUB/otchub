import { secrets } from "base44:runtime";

export const ADDRESSES = {
  OTC_TOKEN_MINT: "MukLDtJ8Cx9DxLbeyLRSWPSposTMWuwHANbuaudpump",
  DEXSCREENER_PAIR: "da4pm4xsdy4m9v4cgakkbvh1pw1ysctqqa5nekghukpt",
  NFT_COLLECTION: "D7sLW9uKZG3G7bNbWfMHvKSgVhU9nXdv7huTfepF5Jrh",
  PROGRAM: "AjMx5My4YUDHMiCtLpTAtgkiUJgrpJnQqd5AcQnddHQW",
  POT: "BZcvtxDy4WihU24k3pezzajuiqYtTUHPfH7b5m26BucR",
  PROTOCOL_WALLET: "DqMAVQ1RcQath18PrSLBVZHjwWXXN8cFEua2XuQ2rbQh",
  CONFIG: "9b5VLbpXedgXcjWyboXqHMbDgeHJtb5PBsy6TE18REU4",
  METAPLEX_CORE_PROGRAM: "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d",
  MAGIC_EDEN_SYMBOL: "otc_desks",
  WRAPPED_SOL: "So11111111111111111111111111111111111111112",
};

function heliusUrl() {
  return `https://mainnet.helius-rpc.com/?api-key=${secrets.get("HELIUS_API_KEY")}`;
}

async function heliusRpc(method, params) {
  const res = await fetch(heliusUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "otc", method, params }),
  });
  if (!res.ok) throw new Error(`Helius RPC ${method} failed: ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`Helius RPC ${method} error: ${json.error.message}`);
  return json.result;
}

export async function fetchDexScreenerToken(tokenMint) {
  const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`);
  if (!res.ok) return null;
  const json = await res.json();
  const pairs = json.pairs || [];
  let pair = pairs.find((p) => p.pairAddress === ADDRESSES.DEXSCREENER_PAIR);
  if (!pair && pairs.length) {
    pair = pairs.find((p) => p.chainId === "solana") || pairs[0];
  }
  return pair;
}

export async function fetchSolPriceUsd() {
  const res = await fetch(
    `https://api.dexscreener.com/latest/dex/tokens/${ADDRESSES.WRAPPED_SOL}`
  );
  if (!res.ok) return null;
  const json = await res.json();
  const pairs = json.pairs || [];
  const solUsd =
    pairs.find((p) => p.chainId === "solana" && (p.quoteToken?.symbol === "USDC" || p.quoteToken?.symbol === "USDT")) ||
    pairs.find((p) => p.chainId === "solana");
  return solUsd ? parseFloat(solUsd.priceUsd) : null;
}

export async function fetchTokenAccountsByOwner(owner, tokenMint) {
  const result = await heliusRpc("getTokenAccountsByOwner", [
    owner,
    { mint: tokenMint },
    { encoding: "jsonParsed" },
  ]);
  return (result?.value || []).map((acc) => ({
    pubkey: acc.pubkey,
    amount: parseFloat(acc.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0),
    decimals: acc.account?.data?.parsed?.info?.tokenAmount?.decimals || 0,
  }));
}

export async function fetchAccountBalanceLamports(address) {
  const result = await heliusRpc("getBalance", [address]);
  return result?.value ?? null;
}

export async function fetchCollectionAssets(collectionAddress) {
  const allAssets = [];
  let page = 1;
  while (page <= 20) {
    const result = await heliusRpc("searchAssets", {
      grouping: ["collection", collectionAddress],
      page,
      limit: 1000,
    });
    const items = result?.items || [];
    allAssets.push(...items);
    if (items.length < 1000) break;
    page++;
  }
  return allAssets;
}

export async function fetchMagicEdenStats(symbol) {
  try {
    const res = await fetch(`https://api-mainnet.magiceden.dev/v2/collections/${symbol}/stats`);
    if (!res.ok) return null;
    const json = await res.json();
    return json;
  } catch (e) {
    return null;
  }
}

export async function fetchMagicEdenListings(symbol, limit = 20) {
  try {
    const res = await fetch(
      `https://api-mainnet.magiceden.dev/v2/collections/${symbol}/listings?limit=${limit}&offset=0`
    );
    if (!res.ok) return [];
    const json = await res.json();
    return Array.isArray(json) ? json : [];
  } catch (e) {
    return [];
  }
}