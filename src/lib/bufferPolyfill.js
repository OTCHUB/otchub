// Must be imported BEFORE @solana/web3.js / @solana/spl-token so the browser
// has the Node globals those libraries expect at module-eval time.
import { Buffer } from "buffer";

if (typeof globalThis !== "undefined") {
  if (!globalThis.Buffer) globalThis.Buffer = Buffer;
  if (!globalThis.process) globalThis.process = { env: {} };
}
if (typeof window !== "undefined") {
  if (!window.Buffer) window.Buffer = Buffer;
}