"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, type ReactNode } from "react";
import { Dialog } from "radix-ui";
import { samePage } from "@/lib/session-link";
import { FaTimes } from "react-icons/fa";

/**
 * A session's details over the page. Closing replaces the URL with `closeHref`
 * (the page without its ?session= param, or /schedule from the session's own
 * page), so nothing underneath remounts. Not portalled: the session's own page
 * server-renders its details in here.
 */
export default function SessionModal({
  closeHref,
  labelledBy,
  children,
}: {
  closeHref: string;
  labelledBy: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const overlayRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    // Over the page it opened on, rewrite the URL as opening did.
    if (samePage(closeHref, window.location.href)) {
      window.history.replaceState(null, "", closeHref);
    } else {
      router.replace(closeHref, { scroll: false });
    }
  }, [router, closeHref]);

  return (
    <Dialog.Root open onOpenChange={(open) => !open && close()}>
      <Dialog.Overlay
        ref={overlayRef}
        onMouseDown={(e) => {
          if (e.target === overlayRef.current) close();
        }}
        className="fixed inset-0 z-[100] flex items-center justify-center bg-[#1b1530]/70 p-4"
      >
        <Dialog.Content
          ref={contentRef}
          aria-labelledby={labelledBy}
          aria-describedby={undefined}
          // The overlay's own handler closes; a click on a toast shouldn't.
          onInteractOutside={(e) => e.preventDefault()}
          onOpenAutoFocus={(e) => {
            opener.current = document.activeElement as HTMLElement | null;
            // The dialog, not its first control: on a shared link's page load
            // the browser would draw a focus ring around the close button.
            e.preventDefault();
            contentRef.current?.focus({ preventScroll: true });
          }}
          // Radix only restores focus to its own Trigger, and links open this.
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            opener.current?.focus({ preventScroll: true });
          }}
          className="relative max-h-[85vh] w-full max-w-[720px] overflow-y-auto bg-[#fff5e4] p-6 text-[#1b1530] shadow-2xl outline-none sm:p-10"
        >
          <Dialog.Title className="sr-only">Session details</Dialog.Title>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="absolute top-3 right-3 flex h-9 w-9 items-center justify-center text-[#1b1530]/50 transition-colors hover:text-[#1b1530]"
          >
            <FaTimes size={18} />
          </button>
          {children}
        </Dialog.Content>
      </Dialog.Overlay>
    </Dialog.Root>
  );
}
