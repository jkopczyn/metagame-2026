"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { FaTimes } from "react-icons/fa";

type Host = { closeHref: string; navigated: RefObject<boolean> };

const HostContext = createContext<Host | null>(null);

/**
 * Wraps the page a route modal sits on. Until something navigates within it,
 * the modal was the landing page, so closing replaces to `closeHref` instead
 * of going back (off the site).
 */
export function ModalHost({
  closeHref,
  children,
}: {
  closeHref: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const landedOn = useRef(pathname);
  const navigated = useRef(false);
  useEffect(() => {
    if (pathname !== landedOn.current) navigated.current = true;
  }, [pathname]);
  const host = useMemo(() => ({ closeHref, navigated }), [closeHref]);
  return <HostContext value={host}>{children}</HostContext>;
}

/** A modal over the page for a route; closing goes back (see ModalHost). */
export default function RouteModal({
  labelledBy,
  children,
}: {
  labelledBy: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const host = useContext(HostContext);
  const overlayRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    if (host && !host.navigated.current) {
      router.replace(host.closeHref, { scroll: false });
    } else {
      router.back();
    }
  }, [router, host]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Radix preventDefaults the Escape that dismisses a nested layer.
      if (e.key === "Escape" && !e.defaultPrevented) close();
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [close]);

  return (
    <div
      ref={overlayRef}
      onMouseDown={(e) => {
        if (e.target === overlayRef.current) close();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[#1b1530]/70 p-4"
    >
      <div className="relative max-h-[85vh] w-full max-w-[720px] overflow-y-auto bg-[#fff5e4] p-6 text-[#1b1530] shadow-2xl sm:p-10">
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="absolute top-3 right-3 flex h-9 w-9 items-center justify-center text-[#1b1530]/50 transition-colors hover:text-[#1b1530]"
        >
          <FaTimes size={18} />
        </button>
        {children}
      </div>
    </div>
  );
}
