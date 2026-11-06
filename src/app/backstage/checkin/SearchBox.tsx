"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { fieldClass } from "../ui";
import { CHECKIN_QUERY_MAX } from "@/lib/checkin";

/** One box; the URL carries the query so the server does the search. */
export default function SearchBox({ initial }: { initial: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [value, setValue] = useState(initial);
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const submitted = useRef(initial);

  // A keyboard would cover half a phone; only laptops get the cursor for free.
  useEffect(() => {
    if (window.matchMedia("(pointer: fine)").matches) input.current?.focus();
  }, []);

  useEffect(() => {
    const q = value.trim();
    if (q === submitted.current) return;
    const timer = setTimeout(() => {
      submitted.current = q;
      start(() => {
        router.replace(
          q ? `${pathname}?q=${encodeURIComponent(q)}` : pathname,
          { scroll: false },
        );
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [value, pathname, router]);

  return (
    <div className="relative">
      <input
        ref={input}
        type="search"
        name="q"
        autoComplete="off"
        maxLength={CHECKIN_QUERY_MAX}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Name, email, badge number or ticket code"
        aria-label="Find a ticket"
        className={`${fieldClass} py-3 text-lg`}
      />
      {pending && (
        <span className="absolute top-1/2 right-3 -translate-y-1/2 text-sm text-ink/50">
          Searching…
        </span>
      )}
    </div>
  );
}
