/// <reference types="vite/client" />
// Build-time switch for the $HUB protocol dashboard (src/hub, src/pages/Hub.jsx).
// $HUB is LAUNCHED on mainnet-beta: the dashboard and its menu entries are on
// by default in every environment (Base44 preview, local dev, Cloudflare).
// Preview/local builds that miss the VITE_HUB_ENABLED secret used to hide the
// route + menu entirely — now only an explicit VITE_HUB_ENABLED=false darkens it.
export const HUB_ENABLED = import.meta.env.VITE_HUB_ENABLED !== "false";