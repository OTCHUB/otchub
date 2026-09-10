import React from "react";

// Modern X (formerly Twitter) logo — the official X wordmark glyph as an
// inline SVG, replacing the retired bird icon across the app.
export default function XIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.162H5.117z" />
    </svg>
  );
}