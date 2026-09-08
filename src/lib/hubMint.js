// Official $HUB token mint — STEALTH GATED. The value comes from the
// VITE_HUB_MINT secret (baked into the client at build time). Until the
// builder sets the real mint and republishes, HUB_MINT is empty and every
// $HUB-identity UI (launcher badge, header CA banner) renders nothing.
const raw = (import.meta.env.VITE_HUB_MINT || "").trim();
export const HUB_MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(raw) ? raw : "";
export const HUB_MINT_READY = HUB_MINT !== "";
export const isOfficialHubMint = (mint) => HUB_MINT_READY && mint === HUB_MINT;