import React, { useEffect, useRef } from "react";

// The mascot ships as pixel art on a solid black JPEG. The browser decodes it
// into a canvas, flood-fills the black background (edge-connected only, so the
// dark screen pixels inside the art survive) to full transparency, and mounts
// the resulting transparent PNG as a live canvas element in the hero.
const SRC =
  "https://media.base44.com/images/public/6a97c0a4fb3601dc274f8d83/bc3fe1076_204B8830-6B01-4719-88B5-4CA2676CBAC2.jpeg";
// Near-black JPEG floor. Must stay BELOW the mascot's dark pedestal (#333333
// = 51) so the flood fill eats only the background, never the base.
const THRESH = 36;

export default function MascotLogo({ className = "" }) {
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
        /* canvas unavailable — hero shows without the mascot */
      }
    };
    img.src = SRC;
    return () => {
      dead = true;
    };
  }, [className]);

  return <span ref={hostRef} className="block" />;
}