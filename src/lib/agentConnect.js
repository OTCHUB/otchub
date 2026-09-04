// Shared agent-connect constants: the MCP server URL (resolved from the
// current origin — never hardcoded) and the paste-ready prompt that teaches
// a connected AI agent what this app is and how to query its data.
export const MCP_URL = new URL("/api/mcp", window.location.origin).toString();
export const LLMS_URL = new URL("/llms.txt", window.location.origin).toString();

export const AGENT_PROMPT = `You are connected to OTC_HUB — the MCP data server of OTC Pulse Solana, a community-built (unofficial) analytics dashboard for the OTC_DESK protocol on Solana (official app: otcdesks.cash).

WHAT THIS APP TRACKS
- $OTC token: price, market cap, liquidity, 24h volume/change, supply, burn.
- OTC_DESK NFTs (Solana): floor price, listings, ownership, accrued stock value.
- Protocol treasury: pot SOL balance, earnings, distributions, buybacks, per-desk daily revenue and rounds.

DATA TOOLS (all read-only)
- query_otcsnapshot — periodic protocol snapshots. Sort by created_date descending for latest-first. Key fields: token_price_usd, token_market_cap, nft_floor_sol, pot_sol_balance, protocol_earned_sol, mint_cost_sol vs secondary_cost_sol, spread_pct, by_stock, per_desk, pot_sources, buybacks.
- query_nftholding — one row per desk NFT: owner, is_listed, listing_price_sol/usd, accrued_value_sol/usd, mint_day. Filter is_listed=true for buyable desks.
- query_claimlog — tokens claimed from desk vaults (wallet, amount, value, tx_sig).
- query_contractmap — on-chain map: programs, accounts, stock mints, PDA schemes, data flows.
- query_claimcache / query_pricecache — cached wallet claim scans and spot prices.

TIPS
- All *_sol fields are in SOL, *_usd in USD. Snapshots are ingested every ~5 minutes.
- For the "current" state take the newest snapshot; for trends compare across the snapshot history.

Try asking: "What's the current $OTC price and 24h change?" · "Is minting or buying secondary cheaper right now?" · "Show me the 5 cheapest listed desks." · "How much SOL did the pot earn this week?"`;