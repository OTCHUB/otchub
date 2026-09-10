import { createClient } from '@base44/sdk';
import { appParams } from '@/lib/app-params';

const { appId, token, functionsVersion, appBaseUrl } = appParams;

//Create a client with authentication required
// serverUrl drives the axios baseURL: `${serverUrl}/api`.
// Empty string means relative `/api/*` — only works on Base44-hosted preview
// because Base44 reverse-proxies /api → its backend. On Cloudflare Pages (pure
// static host) those relative POST requests get 405. Use the env var when set
// (Base44 injects it during its own builds), otherwise fall back to the SDK
// default so production calls go directly to Base44's backend.
export const base44 = createClient({
  appId,
  token,
  functionsVersion,
  serverUrl: import.meta.env.VITE_BASE44_APP_BASE_URL || 'https://base44.app',
  requiresAuth: false,
  appBaseUrl
});
