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

async function fetchJsonWithRetry(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch (e) {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 600 * (i + 1)));
  }
  return null;
}

export async function fetchDexScreenerToken(tokenMint) {
  const json = await fetchJsonWithRetry(`https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`);
  if (!json) return null;
  const pairs = json.pairs || [];
  let pair = pairs.find((p) => p.pairAddress === ADDRESSES.DEXSCREENER_PAIR);
  if (!pair && pairs.length) {
    pair = pairs.find((p) => p.chainId === "solana") || pairs[0];
  }
  return pair;
}

export async function fetchSolPriceUsd() {
  const json = await fetchJsonWithRetry(
    `https://api.dexscreener.com/latest/dex/tokens/${ADDRESSES.WRAPPED_SOL}`
  );
  if (!json) return null;
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
  try {
    const result = await heliusRpc("getBalance", [address]);
    return result?.value ?? null;
  } catch (e) {
    try {
      const result = await solanaRpc("https://api.mainnet-beta.solana.com", "getBalance", [address]);
      return result?.value ?? null;
    } catch (e2) {
      return null;
    }
  }
}

async function solanaRpc(rpcUrl, method, params) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "otc", method, params }),
  });
  if (!res.ok) throw new Error(`RPC ${method} HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`RPC ${method} error: ${json.error.message}`);
  return json.result;
}

function supplyFromResult(result) {
  const v = result?.value;
  if (v?.uiAmountString != null) return parseFloat(v.uiAmountString);
  if (v?.uiAmount != null) return v.uiAmount;
  return null;
}

// Circulating OTC supply. Primary source is DexScreener, whose marketCap
// equals priceUsd × circulating supply (verified to match on-chain supply),
// and which is far more reliable than getTokenSupply — Helius intermittently
// 500s on that method (see https://www.helius.dev/docs/api-reference/rpc/http/gettokensupply,
// result.value.uiAmountString). We still fall back to exact on-chain RPCs.
export async function fetchTokenSupply(tokenMint) {
  try {
    const pair = await fetchDexScreenerToken(tokenMint);
    const mc = pair?.marketCap;
    const px = pair?.priceUsd;
    if (mc && px) return mc / px;
  } catch (e) {
    /* fall through to on-chain RPC */
  }
  for (const call of [
    () => heliusRpc("getTokenSupply", [tokenMint]),
    () => solanaRpc("https://api.mainnet-beta.solana.com", "getTokenSupply", [tokenMint]),
  ]) {
    try {
      const v = supplyFromResult(await call());
      if (v != null) return v;
    } catch (e) {
      /* try next */
    }
  }
  return null;
}

export async function fetchCollectionAssets(collectionAddress) {
  try {
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
  } catch (e) {
    return null;
  }
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

export async function fetchMagicEdenListings(symbol, limit = 100) {
  try {
    const all = [];
    let offset = 0;
    // Paginate the entire listings set so every listed desk gets its true
    // current Magic Eden price — not just the first page. NOTE: Magic Eden's
    // v2 /listings endpoint rejects limit > 100 with a 400, so cap at 100.
    while (offset < 10000) {
      const res = await fetch(
        `https://api-mainnet.magiceden.dev/v2/collections/${symbol}/listings?limit=${limit}&offset=${offset}`
      );
      if (!res.ok) break;
      const json = await res.json();
      const page = Array.isArray(json) ? json : [];
      all.push(...page);
      if (page.length < limit) break;
      offset += limit;
    }
    return all;
  } catch (e) {
    return [];
  }
}

export async function fetchProtocolStats() {
  try {
    const res = await fetch("https://otcdesks.cash/api/stats");
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}