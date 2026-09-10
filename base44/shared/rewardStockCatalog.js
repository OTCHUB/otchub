// Reward-stock catalog — the EXACT 1:1 resolution otcdesks.cash itself uses,
// harvested by probing the official site (2026-09-10). No pattern matching:
//
//   GET https://otcdesks.cash/api/coins?page=N
//     { coins: [{ mint, symbol, name, image, createdAt,
//                 rewardMint: "<exact SPL mint of the reward token>",
//                 rewardSymbol: "<exact reward identifier>",
//                 snapshot: { marketCap, usdPrice, change24h, volume24h,
//                            liquidity, holders, spark, at, candlesAt } }],
//       total, at }
//     `rewardMint` may be "pending:<SYMBOL>" while the reward token is not
//     deployed yet. Coin images live at
//     firebase .../o/coins%2F<mint>.jpg?alt=media&token=<mint>.
//
//   Stock rewards (rewardSymbol in the official launcher picker catalog, i.e.
//   https://otcdesks.cash/launcher): icon = https://otcdesks.cash/stocks/<icon>
//   (extension and casing are per-entry — NKE.jpg, ARB.svg, ANSEM.webp,
//   farmini.png — so a symbol-based .png guess is NOT 1:1). The site applies
//   this even when the reward mint is a custom token whose symbol collides
//   with a catalog stock (e.g. rewardMint AMC1qw…/rewardSymbol "AMC" renders
//   the AMC Entertainment stock icon).
//
//   Custom rewards (rewardSymbol NOT in the catalog — XMR, RDDT, TIKTOK, $WIF,
//   …): the site renders "Pays <symbol> custom" with the image
//   firebase .../o/rewards%2F<rewardMint>?alt=media&token=<rewardMint> —
//   the rewards bucket is keyed by the exact reward mint (verified on-chain:
//   the RDDT pairing reports rewardMint RDDTGbhHwVXfyCvQMXzzowKjf5qrYBZAnehoXW83ooh,
//   and the coin page serves rewards/<that same mint> as its icon).
//
// The catalog below is the complete picker list at harvest time. If the site
// adds stocks later, unknown symbols still resolve deterministically as
// custom rewards (mint-keyed firebase icon), so icons never mis-match.

export const STOCKS_ORIGIN = "https://otcdesks.cash/stocks/";
export const REWARDS_BUCKET =
  "https://firebasestorage.googleapis.com/v0/b/mp3project-fef5a.firebasestorage.app/o/rewards%2F";

/** @type {Array<{ symbol: string, name: string, icon: string }>} */
export const REWARD_STOCKS = [
  { symbol: "ANDURIL", name: "Anduril", icon: "ANDURIL.png" },
  { symbol: "OPENAI", name: "OpenAI", icon: "OPENAI.png" },
  { symbol: "AAPLx", name: "Apple", icon: "AAPLx.png" },
  { symbol: "MSFTx", name: "Microsoft", icon: "MSFTx.png" },
  { symbol: "NVDAx", name: "NVIDIA", icon: "NVDAx.png" },
  { symbol: "AMZNx", name: "Amazon", icon: "AMZNx.png" },
  { symbol: "CRCLx", name: "Circle", icon: "CRCLx.png" },
  { symbol: "SPCXx", name: "SpaceX", icon: "SPCXx.png" },
  { symbol: "ANTHROPIC", name: "Anthropic", icon: "ANTHROPIC.png" },
  { symbol: "POLYMARKET", name: "Polymarket", icon: "POLYMARKET.png" },
  { symbol: "KALSHI", name: "Kalshi", icon: "KALSHI.png" },
  { symbol: "NEURALINK", name: "Neuralink", icon: "NEURALINK.png" },
  { symbol: "OTC", name: "OTC Desks", icon: "OTC.png" },
  { symbol: "NKE", name: "Nike", icon: "NKE.jpg" },
  { symbol: "Fartcoin", name: "Fartcoin", icon: "FARTCOIN.png" },
  { symbol: "JitoSOL", name: "Jito Staked SOL", icon: "JITOSOL.png" },
  { symbol: "ARB", name: "Arbitrum", icon: "ARB.svg" },
  { symbol: "TAO", name: "Bittensor", icon: "TAO.png" },
  { symbol: "ANSEM", name: "The Black Bull", icon: "ANSEM.webp" },
  { symbol: "AMC", name: "AMC Entertainment", icon: "AMC.png" },
  { symbol: "FIGUREAI", name: "Figure AI", icon: "FIGUREAI.png" },
  { symbol: "WBTC", name: "Bitcoin", icon: "WBTC.png" },
  { symbol: "WETH", name: "Ethereum", icon: "WETH.png" },
  { symbol: "HYPE", name: "Hyperliquid", icon: "HYPE.png" },
  { symbol: "PUMP", name: "pump.fun", icon: "PUMP.png" },
  { symbol: "MCDx", name: "McDonald's", icon: "MCDx.png" },
  { symbol: "PLTRx", name: "Palantir", icon: "PLTRx.png" },
  { symbol: "GOOGLx", name: "Alphabet", icon: "GOOGLx.png" },
  { symbol: "COINx", name: "Coinbase", icon: "COINx.png" },
  { symbol: "MSTRx", name: "MicroStrategy", icon: "MSTRx.png" },
  { symbol: "GMEx", name: "GameStop", icon: "GMEx.png" },
  { symbol: "GLDx", name: "Gold", icon: "GLDx.png" },
  { symbol: "SPYx", name: "S&P 500", icon: "SPYx.png" },
  { symbol: "GPRO", name: "GoPro", icon: "GPRO.png" },
  { symbol: "HOODx", name: "Robinhood", icon: "HOODx.png" },
  { symbol: "QQQx", name: "Nasdaq", icon: "QQQx.png" },
  { symbol: "TSLAx", name: "Tesla", icon: "TSLAx.png" },
  { symbol: "VIDAx", name: "Vida Global", icon: "VIDAx.png" },
  { symbol: "AMDx", name: "AMD", icon: "AMDx.png" },
  { symbol: "BRKBx", name: "Berkshire Hathaway", icon: "BRKBx.png" },
  { symbol: "TTWO", name: "Take-Two", icon: "TTWO.png" },
  { symbol: "ZEC", name: "Zcash", icon: "ZEC.png" },
  { symbol: "PONS", name: "Pons", icon: "PONS.png" },
  { symbol: "WYFI", name: "WhiteFiber", icon: "WYFI.png" },
  { symbol: "WEN", name: "Wendy's", icon: "WEN.png" },
  { symbol: "FAMI", name: "Farmmi", icon: "farmini.png" },
  { symbol: "DJT", name: "Trump Media & Technology Group", icon: "tmtg.jpg" },
];

const BY_SYMBOL = new Map(REWARD_STOCKS.map((stock) => [stock.symbol, stock]));
const BY_SYMBOL_LOWER = new Map(REWARD_STOCKS.map((stock) => [stock.symbol.toLowerCase(), stock]));

const reportedMint = (value) => {
  const mint = typeof value === "string" ? value.trim() : "";
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint) ? mint : null;
};

export const customRewardIconUrl = (mint) => `${REWARDS_BUCKET}${mint}?alt=media&token=${mint}`;

// Exact-match first, case-insensitive second (catalog symbols are unique in
// both spellings). Returns null when neither a mint nor a symbol is known.
export function resolveRewardMeta(rewardMint, rewardSymbol) {
  const mint = reportedMint(rewardMint);
  const symbol = typeof rewardSymbol === "string" ? rewardSymbol.trim() : "";
  const stock = BY_SYMBOL.get(symbol) ?? BY_SYMBOL_LOWER.get(symbol.toLowerCase()) ?? null;
  if (stock) {
    return { symbol: stock.symbol, name: stock.name, icon: STOCKS_ORIGIN + stock.icon, custom: false };
  }
  if (!mint && !symbol) return null;
  return {
    symbol: symbol || null,
    name: null,
    icon: mint ? customRewardIconUrl(mint) : null,
    custom: true,
  };
}

// ---------------------------------------------------------------------------
// Feed-facing resolution — what the launcher tape actually renders.
//
// Stock icons are bundled as app assets (public/stocks/<icon>, backfilled by
// scripts/backfill_stock_icons.mjs) so the tape never depends on
// otcdesks.cash being up or staying at the same address. Custom rewards
// (mint-keyed, unknown until a launch happens) stream through the public
// getRewardIcon proxy, which fetches the official firebase image via the
// app runtime's egress.
//
// Future-proofing: a stock added to REWARD_STOCKS but not yet backfilled 404s
// locally and the client PayoutIcon retries through the proxy (same 1:1
// upstream), so icons still render; run the backfill script to bundle them.
export const REWARD_ICON_PROXY_URL = "https://otchubdev.base44.app/functions/getRewardIcon?id=";
export const STOCKS_ASSET_BASE = "/stocks/";

export const rewardIconProxyUrl = (id) => REWARD_ICON_PROXY_URL + encodeURIComponent(id);

// Feed-facing twin of resolveRewardMeta: identical 1:1 resolution, but icons
// point at our own origin — bundled asset for stocks, proxy for customs.
export function resolveRewardMetaProxied(rewardMint, rewardSymbol) {
  const meta = resolveRewardMeta(rewardMint, rewardSymbol);
  if (!meta || !meta.icon) return meta;
  if (!meta.custom) {
    return { ...meta, icon: STOCKS_ASSET_BASE + meta.icon.slice(STOCKS_ORIGIN.length) };
  }
  const mint = reportedMint(rewardMint);
  return mint ? { ...meta, icon: rewardIconProxyUrl(mint) } : meta;
}