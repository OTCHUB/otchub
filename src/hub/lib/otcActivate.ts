// Native OTC Desks program (otcdesks.cash) per-desk activation — the real, user-triggerable
// on-chain step that `nativeActive` (see otcNative.ts) can only report on, not fix. A desk's
// payout `vault` PDA is created once, when the desk NFT is minted through the official program's
// `mint`/`grant` instruction — no user tx can create it after the fact, so `nativeActive === false`
// means "not a genuine otcdesks.cash desk" and there is nothing to activate here (see DeskSheet).
// `nativeActive === true` means the vault exists, but each stock ticker still needs its own
// `nft_stock` token account opened inside that vault (`open_ticker_account[_ext]`) before the OTC
// program's `distribute`/`claim` can pay it out — THAT step is genuinely user-triggerable, and is
// what this module wires up. Discriminators/PDA seeds reverse-engineered from the otcdesks.cash
// production bundle — same source as src/lib/otcClaim.js and base44/shared/otcIdl.ts.
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@hub-sdk";
import { OTC_DESKS_PROGRAM_ID, otcVaultPda } from "./otcNative";
import type { TxLog } from "./swap";
import type { WalletSigner } from "./wallets";

export type NativeActivatePhase = "build" | "sim" | "sign" | "send" | "confirm";
export type NativeActivateResult = { ok: boolean; sig?: string; reason?: string };

const OPEN_DISC = Buffer.from([146, 211, 204, 136, 189, 212, 73, 196]);
const OPEN_EXT_DISC = Buffer.from([218, 121, 110, 45, 87, 244, 170, 225]);
const SYSTEM_PROGRAM = new PublicKey("11111111111111111111111111111111");
/** Legacy tx message budget — matches claim.ts's per-tx account-count caution. */
const TICKERS_PER_TX = 3;

export type OtcTicker = {
  index: number;
  symbol: string;
  mint: string;
  decimals: number;
  extended: boolean;
};

/** Canonical slot-index lineup (index = the u8 arg). `extended` slots need config_ext + vault_ext. */
export const OTC_TICKERS: OtcTicker[] = [
  { index: 0, symbol: "ANDURIL", mint: "PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB", decimals: 9, extended: false },
  { index: 1, symbol: "OPENAI", mint: "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF", decimals: 9, extended: false },
  { index: 2, symbol: "AAPLx", mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", decimals: 8, extended: false },
  { index: 3, symbol: "MSFTx", mint: "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX", decimals: 8, extended: false },
  { index: 4, symbol: "NVDAx", mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", decimals: 8, extended: false },
  { index: 5, symbol: "AMZNx", mint: "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg", decimals: 8, extended: false },
  { index: 6, symbol: "CRCLx", mint: "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1", decimals: 8, extended: false },
  { index: 7, symbol: "SPCXx", mint: "Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8", decimals: 8, extended: false },
  { index: 8, symbol: "ANTHROPIC", mint: "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw", decimals: 9, extended: false },
  { index: 9, symbol: "POLYMARKET", mint: "Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP", decimals: 9, extended: false },
  { index: 10, symbol: "KALSHI", mint: "PreLWGkkeqG1s4HEfFZSy9moCrJ7btsHuUtfcCeoRua", decimals: 9, extended: true },
  { index: 11, symbol: "NEURALINK", mint: "PrekqLJvJ3qVdXmBGDiexvwUTF4rLFDa6HWS4HJbw9S", decimals: 9, extended: true },
  { index: 12, symbol: "OTC", mint: "MukLDtJ8Cx9DxLbeyLRSWPSposTMWuwHANbuaudpump", decimals: 6, extended: true },
];

const pda = (seeds: (Buffer | Uint8Array)[]) =>
  PublicKey.findProgramAddressSync(seeds, OTC_DESKS_PROGRAM_ID)[0];
const configPda = () => pda([Buffer.from("config")]);
const configExtPda = () => pda([Buffer.from("config_ext")]);
const vaultExtPda = (vault: PublicKey) => pda([Buffer.from("vault_ext"), vault.toBuffer()]);

// The OTC program derives every stock token account with a CUSTOM seed order —
// [owner, tokenProgram, mint] under the ATA program — NOT the standard ATA order.
function stockAta(owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
    new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID),
  )[0];
}

/** Resolve which token program owns each ticker mint (Token-2022 vs classic) — one batched RPC. */
export async function resolveOtcTokenPrograms(
  connection: Connection,
): Promise<Map<string, PublicKey>> {
  const mints = OTC_TICKERS.map((t) => new PublicKey(t.mint));
  const infos = await connection.getMultipleAccountsInfo(mints);
  const out = new Map<string, PublicKey>();
  const t22 = new PublicKey(TOKEN_2022_PROGRAM_ID);
  const t = new PublicKey(TOKEN_PROGRAM_ID);
  infos.forEach((info, i) => {
    out.set(OTC_TICKERS[i].mint, info?.owner.equals(t22) ? t22 : t);
  });
  return out;
}

/** Tickers whose `nft_stock` account isn't open yet inside this desk's vault — the ones
 *  `open_ticker_account[_ext]` needs to create before `distribute`/`claim` can reach them.
 *  Returns `[]` once every slot is open. Never throws — a failed RPC batch degrades to "all open"
 *  so a transient read error can't offer a broken activation button. */
export async function fetchMissingOtcTickers(
  connection: Connection,
  asset: string,
  tokenProgramMap: Map<string, PublicKey>,
): Promise<OtcTicker[]> {
  const vault = otcVaultPda(asset);
  const addrs = OTC_TICKERS.map((t) =>
    stockAta(vault, new PublicKey(t.mint), tokenProgramMap.get(t.mint) ?? new PublicKey(TOKEN_PROGRAM_ID)),
  );
  const infos = await connection.getMultipleAccountsInfo(addrs).catch(() => addrs.map(() => null));
  return OTC_TICKERS.filter((_, i) => !infos[i]);
}

function buildOpenTickerIx(
  payer: PublicKey,
  asset: string,
  ticker: OtcTicker,
  tokenProgram: PublicKey,
): TransactionInstruction {
  const assetPk = new PublicKey(asset);
  const vault = otcVaultPda(asset);
  const nftStock = stockAta(vault, new PublicKey(ticker.mint), tokenProgram);
  const keys = [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: configPda(), isSigner: false, isWritable: false },
    ...(ticker.extended ? [{ pubkey: configExtPda(), isSigner: false, isWritable: false }] : []),
    { pubkey: assetPk, isSigner: false, isWritable: false },
    { pubkey: vault, isSigner: false, isWritable: true },
    ...(ticker.extended
      ? [{ pubkey: vaultExtPda(vault), isSigner: false, isWritable: true }]
      : []),
    { pubkey: new PublicKey(ticker.mint), isSigner: false, isWritable: false },
    { pubkey: nftStock, isSigner: false, isWritable: true },
    { pubkey: tokenProgram, isSigner: false, isWritable: false },
    { pubkey: new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID), isSigner: false, isWritable: false },
    { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
  ];
  const disc = ticker.extended ? OPEN_EXT_DISC : OPEN_DISC;
  return new TransactionInstruction({
    programId: OTC_DESKS_PROGRAM_ID,
    keys,
    data: Buffer.concat([disc, Buffer.from([ticker.index])]),
  });
}

/** Opens every given ticker's `nft_stock` account for one desk: sim (unsigned; a failing sim
 *  aborts before any signature is requested) → one wallet prompt per ≤3-ticker batch → send →
 *  confirm. Same reliability model as claim.ts/activate.ts. */
export async function executeOpenOtcTickers(opts: {
  connection: Connection;
  signer: WalletSigner;
  asset: string;
  tickers: OtcTicker[];
  tokenProgramMap: Map<string, PublicKey>;
  onLog: (l: TxLog) => void;
  onPhase?: (p: NativeActivatePhase) => void;
}): Promise<NativeActivateResult> {
  const { connection, signer, asset, tickers, tokenProgramMap, onLog, onPhase } = opts;
  const payer = new PublicKey(signer.publicKey);
  if (!tickers.length) {
    onLog({ type: "info", msg: "OTC_ACTIVATE :: nothing to open — every ticker is already open." });
    return { ok: true };
  }

  onPhase?.("build");
  const bh = await connection.getLatestBlockhash("confirmed");
  const groups: OtcTicker[][] = [];
  for (let i = 0; i < tickers.length; i += TICKERS_PER_TX) {
    groups.push(tickers.slice(i, i + TICKERS_PER_TX));
  }
  const txs = groups.map((group) => {
    const tx = new Transaction({ feePayer: payer, recentBlockhash: bh.blockhash });
    tx.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000 }),
      ...group.map((t) =>
        buildOpenTickerIx(payer, asset, t, tokenProgramMap.get(t.mint) ?? new PublicKey(TOKEN_PROGRAM_ID)),
      ),
    );
    return tx;
  });
  onLog({
    type: "info",
    msg: `OTC_ACTIVATE :: opening ${tickers.length} stock account(s) in ${txs.length} tx(s)`,
  });

  onPhase?.("sim");
  const sims = await Promise.all(txs.map((tx) => connection.simulateTransaction(tx, undefined, false)));
  const passing: Transaction[] = [];
  let simFail: string | undefined;
  sims.forEach((s, i) => {
    if (s.value.err) {
      const line = s.value.logs?.find((l) => /Error Message|Error Code/.test(l));
      simFail = line?.replace("Program log: ", "") ?? JSON.stringify(s.value.err);
      onLog({ type: "err", msg: `TX ${i + 1} SIM_FAIL: ${simFail}` });
    } else {
      onLog({ type: "sim", msg: `TX ${i + 1} sim OK (${s.value.unitsConsumed ?? "?"} CU)` });
      passing.push(txs[i]);
    }
  });
  if (!passing.length) return { ok: false, reason: simFail ?? "all simulations failed" };

  onPhase?.("sign");
  onLog({ type: "info", msg: `SIGN :: 1 prompt for ${passing.length} tx(s)…` });
  let signed: Uint8Array[];
  try {
    signed = await signer.signAllTransactionsRaw(passing);
  } catch (e) {
    const reason = (e as Error).message;
    onLog({ type: "err", msg: `SIGN_REJECTED: ${reason}` });
    return { ok: false, reason };
  }

  onPhase?.("send");
  let lastSig: string | undefined;
  for (const bytes of signed) {
    lastSig = await connection.sendRawTransaction(bytes, { skipPreflight: true, maxRetries: 3 });
    onLog({ type: "ok", msg: `SENT ${lastSig.slice(0, 8)}…`, sig: lastSig });
  }

  onPhase?.("confirm");
  if (lastSig) {
    const conf = await connection.confirmTransaction({ signature: lastSig, ...bh }, "confirmed");
    if (conf.value.err) {
      const reason = JSON.stringify(conf.value.err);
      onLog({ type: "err", msg: `FAILED_ON_CHAIN: ${reason}`, sig: lastSig });
      return { ok: false, sig: lastSig, reason };
    }
  }
  onLog({ type: "ok", msg: `DONE :: ${tickers.length} stock account(s) opened`, sig: lastSig });
  return { ok: true, sig: lastSig };
}
