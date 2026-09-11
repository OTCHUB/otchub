import React, { useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";

// $HUB mint icon studio: takes the exact bundled official logo
// (public/stocks/HUB.jpg — untouched) and masks it into a circle with a
// transparent outside. The 1024px PNG can be published to permanent public
// storage — the returned URL is world-readable and ready for the token mint
// metadata JSON, socials, and any other surface going forward.

const SRC = "/stocks/HUB.jpg";
const CHECKER =
  "repeating-conic-gradient(#16181a 0% 25%, #0d0f10 0% 50%) 0 / 24px 24px";

export default function MintIcon() {
  const imgRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let alive = true;
    const img = new Image();
    img.onload = () => alive && setReady(true);
    img.src = SRC;
    imgRef.current = img;
    return () => {
      alive = false;
    };
  }, []);

  // Exact circular crop: clip to the inscribed circle, draw the source
  // scaled to cover the square — content pixels are untouched, everything
  // outside the circle stays transparent.
  const render = (size) => {
    const img = imgRef.current;
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d");
    ctx.save();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.clip();
    const s = Math.max(size / img.naturalWidth, size / img.naturalHeight);
    const w = img.naturalWidth * s;
    const h = img.naturalHeight * s;
    ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
    ctx.restore();
    return c;
  };

  const [previewUrl, setPreviewUrl] = useState(null);
  useEffect(() => {
    if (ready) setPreviewUrl(render(1024).toDataURL("image/png"));
  }, [ready]);

  const download = (size) => {
    render(size).toBlob((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `hub-mint-icon-${size}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, "image/png");
  };

  // Publish the 1024 circular PNG to permanent world-readable storage and
  // hand back the hosted URL — the "image" field for mint metadata.
  const publish = async () => {
    setPublishing(true);
    setErr(null);
    setPublishedUrl(null);
    setCopied(false);
    try {
      const blob = await new Promise((res) => render(1024).toBlob(res, "image/png"));
      const file = new File([blob], "hub-mint-icon.png", { type: "image/png" });
      const r = await base44.integrations.Core.UploadPublicFile({ file });
      setPublishedUrl(r?.file_url || null);
    } catch (e) {
      setErr(e?.response?.data?.error || e.message || "Upload failed — are you signed in?");
    } finally {
      setPublishing(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(publishedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — the URL stays selectable */
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-3 py-6 font-mono">
      <h1 className="text-[14px] font-bold uppercase tracking-[0.2em] text-green-400">
        $HUB :: MINT ICON STUDIO
      </h1>
      <p className="mt-1 text-[11px] leading-snug text-green-500/60">
        Official logo, pixel-identical — only masked into a circle (transparent
        outside, checkerboard below). Publish once and use the permanent URL
        for the token mint metadata, socials, and every surface going forward.
      </p>

      <div className="mt-4 border border-green-500/30 bg-black p-3">
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          <div
            className="h-44 w-44 shrink-0 overflow-hidden rounded-full border border-green-500/30 sm:h-56 sm:w-56"
            style={{ background: CHECKER }}
          >
            {previewUrl ? (
              <img src={previewUrl} alt="$HUB circular icon preview" className="h-full w-full" />
            ) : (
              <div className="flex h-full items-center justify-center text-[11px] text-green-500/40">
                <span className="animate-pulse">▋</span> LOADING_SOURCE…
              </div>
            )}
          </div>
          <div className="flex w-full flex-col gap-2">
            <button
              onClick={publish}
              disabled={!ready || publishing}
              className="border border-emerald-500/60 px-3 py-1.5 text-[12px] font-bold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-30"
            >
              {publishing ? "PUBLISHING…" : "[PUBLISH PERMANENT PNG · 1024]"}
            </button>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => download(1024)}
                disabled={!ready}
                className="border border-green-500/40 px-2.5 py-1 text-[12px] text-green-400 hover:border-emerald-500/50 hover:text-emerald-400 disabled:opacity-30"
              >
                [DOWNLOAD 1024]
              </button>
              <button
                onClick={() => download(512)}
                disabled={!ready}
                className="border border-green-500/40 px-2.5 py-1 text-[12px] text-green-400 hover:border-emerald-500/50 hover:text-emerald-400 disabled:opacity-30"
              >
                [DOWNLOAD 512]
              </button>
            </div>
            {err && <div className="mt-1 text-[11px] text-red-400">ERR: {err}</div>}
            {publishedUrl && (
              <div className="mt-1 border border-emerald-500/40 bg-emerald-500/5 p-2">
                <div className="text-[10px] uppercase tracking-widest text-emerald-400">
                  PERMANENT URL ✓ READY FOR MINT METADATA
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    readOnly
                    value={publishedUrl}
                    onFocus={(e) => e.target.select()}
                    className="compact-input min-w-0 flex-1 border border-green-500/20 bg-black px-1.5 py-1 text-[11px] text-green-300 outline-none"
                  />
                  <button
                    onClick={copy}
                    className="shrink-0 border border-green-500/40 px-2 py-1 text-[11px] text-green-400 hover:border-emerald-500/50 hover:text-emerald-400"
                  >
                    {copied ? "COPIED ✓" : "[COPY]"}
                  </button>
                </div>
                <a
                  href={publishedUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block text-[11px] text-emerald-400 underline hover:text-emerald-300"
                >
                  [OPEN ↗]
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}