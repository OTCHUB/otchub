// Transaction amounts never pass through floating point. Number is for USD
// estimates only, not quotes, balance comparisons or MAX.
export const U64_MAX = (1n << 64n) - 1n;

function checkDecimals(decimals) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error("Invalid mint decimals");
  }
}

export function validateRawAmount(value, { positive = false } = {}) {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new Error("Raw amount must be an exact integer");
  }
  if (!["string", "bigint", "number"].includes(typeof value) || !/^[0-9]{1,20}$/.test(String(value))) {
    throw new Error("Raw amount must be an unsigned integer");
  }
  const raw = BigInt(value);
  if (raw > U64_MAX || (positive && raw === 0n)) {
    throw new Error(positive && raw === 0n ? "Enter an amount greater than zero" : "Amount exceeds u64");
  }
  return raw;
}

export function parseAmountToRaw(value, decimals) {
  checkDecimals(decimals);
  if (typeof value !== "string" || value.length > 512 || !/^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/.test(value)) {
    throw new Error("Enter a plain decimal amount (no exponent or sign)");
  }
  const [whole = "", fraction = ""] = value.split(".");
  const significantFraction = fraction.replace(/0+$/, "");
  if (significantFraction.length > decimals) {
    throw new Error(`Amount supports at most ${decimals} decimal places`);
  }
  const digits = `${whole || "0"}${significantFraction.padEnd(decimals, "0")}`.replace(/^0+/, "") || "0";
  return validateRawAmount(digits);
}

export function formatRawAmount(value, decimals) {
  checkDecimals(decimals);
  const digits = validateRawAmount(value).toString().padStart(decimals + 1, "0");
  if (decimals === 0) return digits;
  const fraction = digits.slice(-decimals).replace(/0+$/, "");
  return `${digits.slice(0, -decimals)}${fraction ? `.${fraction}` : ""}`;
}

export function parseSlippageBps(value) {
  const bps = parseAmountToRaw(value, 2);
  if (bps > 5000n) throw new Error("Slippage must be between 0% and 50%");
  return Number(bps);
}