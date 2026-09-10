import React, { useEffect, useRef } from "react";

// RU_FOMO brand icon: ships as a flat vector on a solid dark charcoal
// (#181825) background. The browser decodes it into a canvas and flood-fills
// the background (edge-connected only) to full transparency, so the icon
// reads clean on the terminal-black bottom nav. Client-side keying — the
// function runtime cannot run image tools.
const SRC =
  "https://media.base44.com/images/public/6a97c0a4fb3601dc274f8d83/3c36842f4_IMG_5998.png";
// Charcoal floor: background RGB(24,24,37) is well under this; the light
// lavender-grey icon strokes (RGB ≈ 232) are far above it and survive.
const THRESH = 60;

export default function RuFomoIcon({ className = "" }) {
  const hostRef = useRef(null);

  useEffect(() => {
    let dead = false;
    const img = new window.Image();
    img.crossOrigin = "anonymous"; // media host serves ACAO:* — canvas stays untainted
    img.onload = () => {
      if (dead) return;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const { width, height } = canvas;
        const data = ctx.getImageData(0, 0, width, height);
        const px = data.data;
        const N = width * height;
        const keyed = new Uint8Array(N);
        const isKey = (i) => {
          const o = i * 4;
          if (px[o + 3] === 0) return true;
          return px[o] < THRESH && px[o + 1] < THRESH && px[o + 2] < THRESH;
        };
        const stack = [];
        for (let x = 0; x < width; x++) stack.push(x, N - width + x);
        for (let y = 0; y < height; y++) stack.push(y * width, y * width + width - 1);
        while (stack.length) {
          const i = stack.pop();
          if (i < 0 || i >= N || keyed[i] || !isKey(i)) continue;
          keyed[i] = 1;
          const x = i % width;
          if (x > 0) stack.push(i - 1);
          if (x < width - 1) stack.push(i + 1);
          if (i >= width) stack.push(i - width);
          if (i < N - width) stack.push(i + width);
        }
        for (let i = 0; i < N; i++) if (keyed[i]) px[i * 4 + 3] = 0;
        ctx.putImageData(data, 0, 0);
        canvas.className = className;
        const host = hostRef.current;
        if (host) host.replaceChildren(canvas);
      } catch {
        /* canvas unavailable — the nav item shows without the icon */
      }
    };
    img.src = SRC;
    return () => {
      dead = true;
    };
  }, [className]);

  return <span ref={hostRef} className="inline-block leading-none" />;
}