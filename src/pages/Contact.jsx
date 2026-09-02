import React, { useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";

// Public contact page with a working message form. Submissions are stored
// server-side (contactSubmit backend function) so anonymous visitors can use it.
export default function Contact() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    if (!name.trim() || !message.trim()) {
      setErr("Name and message are required");
      return;
    }
    setBusy(true);
    try {
      const res = await base44.functions.invoke("contactSubmit", {
        name: name.trim(),
        email: email.trim(),
        message: message.trim(),
      });
      if (res?.data?.error) throw new Error(res.data.error);
      setSent(true);
    } catch (e2) {
      setErr(e2?.response?.data?.error || e2.message || "Failed to send");
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    "w-full border border-green-500/30 bg-black px-2 py-1.5 text-[12px] text-green-300 outline-none focus:border-emerald-500/60";

  return (
    <div className="min-h-screen bg-black font-mono text-green-400">
      <div className="mx-auto max-w-2xl px-3 py-4 sm:px-4 sm:py-6">
        {/* Header */}
        <header className="border border-green-500/30 bg-black p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="text-sm font-bold uppercase tracking-widest text-green-400 sm:text-base">
                &gt; CONTACT :: OTC_PULSE
                <span className="ml-1 inline-block animate-pulse text-green-500">▋</span>
              </h1>
              <p className="text-[10px] text-green-500/50">
                FEEDBACK · BUG REPORTS · FEATURE REQUESTS
              </p>
            </div>
            <Link
              to="/"
              className="inline-flex items-center border border-green-500/50 px-2.5 py-1.5 text-[11px] text-green-400 hover:bg-green-500/10"
            >
              [← DASHBOARD]
            </Link>
          </div>
        </header>

        {sent ? (
          <div className="mt-3 border border-emerald-500/40 bg-emerald-500/5 p-3 text-[12px] text-emerald-300">
            MESSAGE_SENT :: thank you — we read every message and will reply if you left an
            email.
            <div className="mt-2">
              <Link to="/" className="text-emerald-400 underline hover:text-emerald-300">
                [RETURN_TO_DASHBOARD]
              </Link>
            </div>
          </div>
        ) : (
          <form
            onSubmit={submit}
            className="mt-3 border border-green-500/30 bg-black p-3"
          >
            <div className="space-y-3">
              <div>
                <label className="text-[9px] uppercase tracking-widest text-green-500/50">
                  NAME *
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={120}
                  className={inputCls}
                  placeholder="your name / handle"
                />
              </div>
              <div>
                <label className="text-[9px] uppercase tracking-widest text-green-500/50">
                  EMAIL (OPTIONAL — IF YOU WANT A REPLY)
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  maxLength={254}
                  className={inputCls}
                  placeholder="you@example.com"
                />
              </div>
              <div>
                <label className="text-[9px] uppercase tracking-widest text-green-500/50">
                  MESSAGE *
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  maxLength={4000}
                  rows={6}
                  className={`${inputCls} resize-y`}
                  placeholder="what's on your mind?"
                />
              </div>
              {err && (
                <div className="border border-amber-500/40 bg-amber-500/5 px-2 py-1.5 text-[10px] text-amber-400">
                  ERR: {err}
                </div>
              )}
              <button
                type="submit"
                disabled={busy}
                className="w-full border border-emerald-500/60 py-2 text-[11px] font-bold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-40"
              >
                {busy ? "TRANSMITTING..." : "[SEND_MESSAGE]"}
              </button>
            </div>
          </form>
        )}

        <p className="mt-2 text-[10px] text-green-500/40">
          OTC_PULSE is community tooling, not affiliated with otcdesks.cash.
        </p>
      </div>
    </div>
  );
}