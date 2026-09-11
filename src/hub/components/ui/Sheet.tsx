import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

type Props = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
};

/** Focused-action sheet — the $HUB dashboard's one overlay: a bottom sheet on mobile, a centered
 * modal on desktop, used for per-desk flows (claim / activate / upgrade) so the page itself stays
 * a compact overview no matter how many desks a wallet holds. Click-outside or Esc closes. */
export function Sheet({ open, onClose, title, children }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-150 sm:items-center"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="term-window flex max-h-[88vh] w-full flex-col overflow-hidden border border-green-500/40 font-mono animate-in fade-in slide-in-from-bottom-6 duration-200 sm:max-w-lg sm:slide-in-from-bottom-0 sm:zoom-in-95"
      >
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-green-500/30 bg-black/80 px-3 py-2">
          <span className="min-w-0 truncate text-[12px] uppercase tracking-widest text-green-300">
            {title}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 shrink-0 items-center justify-center border border-green-500/40 text-green-500/70 hover:border-green-400/60 hover:text-green-300"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </header>
        <div className="overflow-y-auto p-3">{children}</div>
      </div>
    </div>
  );
}