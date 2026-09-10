// Client twin of the server proxy URL (base44/shared/rewardStockCatalog.js).
// Custom reward icons and not-yet-bundled stock icons are fetched through the
// app's own getRewardIcon endpoint, whose egress reliably reaches hosts that
// some visitor browsers cannot load directly.
export const REWARD_ICON_PROXY_URL = "https://otchubdev.base44.app/functions/getRewardIcon?id=";

export const rewardIconProxyUrl = (id) => REWARD_ICON_PROXY_URL + encodeURIComponent(id);