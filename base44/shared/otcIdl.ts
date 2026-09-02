// Reverse-engineered from the otcdesks.cash production frontend bundle.
// Program: otcdesks v0.1.0 — "OTC DESKS: NFTs that accrue tokenized stock,
// funded by mint surcharges". All discriminators verified against
// sha256("global:<name>").slice(0,8).

export const PROGRAM_ID = "AjMx5My4YUDHMiCtLpTAtgkiUJgrpJnQqd5AcQnddHQW";

// Programs
export const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const ASSOCIATED_TOKEN_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";

// Instruction discriminators (first 8 bytes of instruction data)
export const INSTRUCTIONS = {
  initialize: [175, 175, 109, 31, 13, 152, 155, 237],
  create_collection: [156, 251, 92, 54, 233, 2, 16, 82],
  mint: [51, 57, 225, 47, 182, 146, 137, 166],          // args: traits[4], nonce(u64)
  grant: [145, 189, 68, 153, 161, 231, 76, 107],
  distribute: [191, 44, 223, 207, 164, 236, 126, 61],   // args: index(u8)  — permissionless
  open_ticker_account: [146, 211, 204, 136, 189, 212, 73, 196],      // args: index(u8)
  open_ticker_account_ext: [218, 121, 110, 45, 87, 244, 170, 225],    // args: index(u8)
  claim: [62, 198, 214, 193, 213, 159, 108, 210],                     // args: index(u8)
} as const;

// Stock tickers in canonical slot-index order (index = the u8 arg).
// `extended` = true for slots that require config_ext + vault_ext accounts
// (the program supports an original 10 + extended slots).
export interface StockTicker {
  index: number;
  symbol: string;
  company: string;
  mint: string;
  decimals: number;
  extended: boolean;
}

export const STOCKS: StockTicker[] = [
  { index: 0, symbol: "ANDURIL", company: "Anduril", mint: "PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB", decimals: 9, extended: false },
  { index: 1, symbol: "OPENAI", company: "OpenAI", mint: "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF", decimals: 9, extended: false },
  { index: 2, symbol: "AAPLx", company: "Apple", mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", decimals: 8, extended: false },
  { index: 3, symbol: "MSFTx", company: "Microsoft", mint: "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX", decimals: 8, extended: false },
  { index: 4, symbol: "NVDAx", company: "NVIDIA", mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", decimals: 8, extended: false },
  { index: 5, symbol: "AMZNx", company: "Amazon", mint: "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg", decimals: 8, extended: false },
  { index: 6, symbol: "CRCLx", company: "Circle", mint: "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1", decimals: 8, extended: false },
  { index: 7, symbol: "SPCXx", company: "SpaceX", mint: "Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8", decimals: 8, extended: false },
  { index: 8, symbol: "ANTHROPIC", company: "Anthropic", mint: "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw", decimals: 9, extended: false },
  { index: 9, symbol: "POLYMARKET", company: "Polymarket", mint: "Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP", decimals: 9, extended: false },
  { index: 10, symbol: "KALSHI", company: "Kalshi", mint: "PreLWGkkeqG1s4HEfFZSy9moCrJ7btsHuUtfcCeoRua", decimals: 9, extended: true },
  { index: 11, symbol: "NEURALINK", company: "Neuralink", mint: "PrekqLJvJ3qVdXmBGDiexvwUTF4rLFDa6HWS4HJbw9S", decimals: 9, extended: true },
  { index: 12, symbol: "OTC", company: "OTC Desks", mint: "MukLDtJ8Cx9DxLbeyLRSWPSposTMWuwHANbuaudpump", decimals: 6, extended: true },
];

// PDA seed specs (from the IDL). All PDAs derived against PROGRAM_ID.
//  config       = PDA(["config"])
//  config_ext   = PDA(["config_ext"])              // extended slots only
//  sol_pot      = PDA(["sol_pot"])
//  vault        = PDA(["vault", asset])            // asset = desk NFT address
//  vault_ext    = PDA(["vault_ext", vault])         // extended slots only
//  pool         = PDA([config, token_program, stock_mint])
//  nft_stock    = ATA(vault, stock_mint) under token_program   = PDA([vault, token_program, stock_mint])
//  user_stock   = ATA(user, stock_mint) under token_program   = PDA([user, token_program, stock_mint])
//  user_token   = ATA(user, token_mint) under token_program (OTC token, for mint)
//  asset        = PDA(["asset", user, nonce])       // for mint/grant only
//
// claim(index) accounts (order):
//   user(signer), config, [config_ext if extended], asset, vault, [vault_ext if extended],
//   stock_mint, nft_stock, user_stock, token_program, associated_token_program, system_program
// claim refuses unless the desk's nft_stock account for that ticker is already open;
// open it first with open_ticker_account(index) / open_ticker_account_ext(index).
//
// token_program per mint = the program that owns stock_mint — resolve via RPC
// (mint owner === TOKEN_2022_PROGRAM_ID or TOKEN_PROGRAM_ID). Most ticker mints
// here are Token-2022; OTC (pump) is standard Token.

export function stockByIndex(index: number): StockTicker | undefined {
  return STOCKS[index];
}
export function stockByMint(mint: string): StockTicker | undefined {
  return STOCKS.find((s) => s.mint === mint);
}