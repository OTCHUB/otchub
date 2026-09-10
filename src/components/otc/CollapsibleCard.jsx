import React, { useState, useEffect, useLayoutEffect, useRef } from "react";

// All panels open by default; click anywhere on the header bar to toggle.
// `openSignal` lets other panels force this card open: bump the counter and
// the card re-expands (used by the swap panel's "connect wallet" shortcut).
export default function CollapsibleCard({ title, children, defaultOpen = true, mobileOpen = null, id = undefined, right = undefined, openSignal = 0, locked = false }) {
  // Panels auto-expand by default on every screen size; mobileOpen lets a
  // call site override the small-screen starting state when it differs from
  // the desktop defaultOpen.
  const [open, setOpen] = useState(() => {
    if (typeof window === "undefined" || window.innerWidth >= 768) return defaultOpen;
    return mobileOpen !== null ? mobileOpen : defaultOpen;
  });
  const toggle = () => { if (!locked) setOpen((o) => !o); };

  const revealRef = useRef(null);
  // Apple-style scroll reveal: cards sit one notch down and rise into place
  // as they enter the viewport. Falls back to instantly-visible when
  // IntersectionObserver is unavailable or the user prefers reduced motion.
  useLayoutEffect(() => {
    const el = revealRef.current;
    if (!el) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
      el.classList.remove("reveal-pending");
      return;
    }
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      io.disconnect();
      el.classList.remove("reveal-pending");
      el.classList.add("reveal-in");
      // Release the compositing hint once the entrance finishes so the
      // page doesn't hold dozens of will-change layers open.
      el.addEventListener("animationend", () => el.classList.remove("reveal-in"), { once: true });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (openSignal) setOpen(true);
  }, [openSignal]);

  return (
    <div id={id} ref={revealRef} className="term-window reveal-pending flex h-full flex-col break-inside-avoid">
      <div
        onClick={toggle}
        title={locked ? "Keep this panel open until the swap finishes" : undefined}
        className={`flex cursor-pointer select-none items-center justify-between px-3 py-2 ${
          open ? "border border-green-500/30 border-b-0" : "border border-green-500/30"
        }`}
      >
        <div className="flex items-center gap-2 text-[12px] uppercase tracking-widest text-green-500/70">
          <span className="text-green-500/60">{open ? "[−]" : "[+]"}</span>
          {title}
        </div>
        {right && (
          <div onClick={(e) => e.stopPropagation()} className="shrink-0">
            {right}
          </div>
        )}
      </div>
      {open && <div className="flex-1">{children}</div>}
    </div>
  );
}