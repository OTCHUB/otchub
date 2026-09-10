// Solana RPC relay transport shared by the claim / swap / crank flows
// (workers/solana-relay, with the Base44 solanaRelay function as fallback).
//
// WHY THE RELAY EXISTS: client-side Solana RPC (blockhash / simulate / send)
// goes through a dedicated relay using the app's Helius key server-side; the
// public api.mainnet-beta endpoint rate-limits / 403s from the browser. The
// wallet still signs locally; only already-signed bytes are relayed. The
// Worker at VITE_SOLANA_RELAY (workers/solana-relay) takes this traffic
// because it is high-volume (a single claim run fires dozens of relay calls:
// blockhash, simulate x N, send x N, confirm polled every 4-8s) and sharing
// Base44's function-invocation pool with it is what was causing
// wallet-connect/transaction failures under load.
//
// RELIABILITY: a stalled relay call (Worker cold start, Helius hiccup, flaky
// mobile network) must never hang a claim/swap run — a stuck "simulating..."
// phase never reaches the wallet sign prompt, which reads exactly like "the
// wallet sign never pops up", and a stuck broadcast reads like "sent but
// never landed". Every relay call races a hard deadline; read-only modes get
// one retry on a timeout, broadcast modes never do (a timed-out send may
// already have landed — the idempotent re-broadcast in ensureConfirmed
// already covers that case).

import { base44 } from "@/api/base44Client";

const RELAY_URL = import.meta.env.VITE_SOLANA_RELAY_URL || null;
const RELAY_TIMEOUT_MS = 30_000;
// Modes that only READ chain state are safe to retry after a stall; send /
// sendBatch broadcast bytes and must never be blind-retried here.
const RELAY_RETRY_MODES = /^(blockhash|simulate|simulateBatch|accounts|fee|confirm|balance)$/;

async function relayOnce(mode, payload) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), RELAY_TIMEOUT_MS);
  try {
    const res = await fetch(RELAY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, ...payload }),
      signal: ac.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(data.error || `relay ${mode} failed (${res.status})`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export async function relay(mode, payload = {}) {
  if (!RELAY_URL) {
    const res = await base44.functions.invoke("solanaRelay", { mode, ...payload });
    const data = res?.data || {};
    if (data.error) throw new Error(data.error);
    return data;
  }
  try {
    return await relayOnce(mode, payload);
  } catch (e) {
    const timedOut = e?.name === "AbortError";
    if (!timedOut || !RELAY_RETRY_MODES.test(mode)) {
      const broadcast = mode === "send" || mode === "sendBatch";
      throw new Error(
        timedOut
          ? `relay ${mode} timed out after ${RELAY_TIMEOUT_MS / 1000}s — ${broadcast ? "the tx may still land; nothing further was sent" : "nothing was broadcast; retry the run"}`
          : e.message
      );
    }
    return await relayOnce(mode, payload); // one retry for a stalled read
  }
}