/// <reference types="vite/client" />
// Build-time switch for the $HUB protocol dashboard (src/hub, src/pages/Hub.jsx).
// Off by default: otchub.dev shows mainnet-only content until the $HUB token
// launches. Flip on with VITE_HUB_ENABLED=true (Base44 env or .env.production.local).
export const HUB_ENABLED = import.meta.env.VITE_HUB_ENABLED === "true";
