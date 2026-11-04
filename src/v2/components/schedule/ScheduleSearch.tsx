"use client";

import { useId, useRef, useState } from "react";
import { FaSearch } from "react-icons/fa";
import { formatPacificDay, formatPacificTime, hostNames } from "@/lib/schedule";
import {
  searchSessions,
  type SearchableSession,
  type SearchHit,
} from "@/lib/schedule-search";

/**
 * A search box over the schedule: type part of a session title or a host's
 * name, pick a result (mouse or arrow keys), and the caller takes it from
 * there — on the public schedule that opens the session's page on its day,
 * backstage it opens the editor.
 */
export default function ScheduleSearch<S extends SearchableSession>({
  sessions,
  onPick,
  roomName,
  placeholder = "Search…",
  className = "",
}: {
  sessions: readonly S[];
  onPick: (session: S) => void;
  /** Adds the room to each row when known. */
  roomName?: (session: S) => string | null;
  placeholder?: string;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [picked, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const hits = searchSessions(sessions, query);
  const showing = open && query.trim() !== "";
  // Keep the highlight on a real row as the list shrinks.
  const active = hits.length === 0 ? 0 : Math.min(picked, hits.length - 1);

  const pick = (hit: SearchHit<S>) => {
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
    onPick(hit.session);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!showing || hits.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % hits.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + hits.length) % hits.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(hits[active]);
    }
  };

  const when = (s: S) =>
    s.startsAt
      ? `${formatPacificDay(s.startsAt)} ${formatPacificTime(s.startsAt)}`
      : "Not scheduled";

  return (
    <div className={`relative w-full max-w-md ${className}`}>
      <FaSearch
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink/40"
      />
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-label="Search sessions or hosts"
        aria-expanded={showing}
        aria-controls={listId}
        aria-activedescendant={
          showing && hits[active]
            ? `${listId}-${hits[active].session.id}`
            : undefined
        }
        aria-autocomplete="list"
        autoComplete="off"
        value={query}
        placeholder={placeholder}
        onChange={(e) => {
          setQuery(e.currentTarget.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        // Closing on blur would beat the click on a result; options stop the
        // blur with onMouseDown instead, so this only fires for real leaves.
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className="w-full rounded-lg border border-line bg-white py-2 pr-3 pl-9 text-base text-ink outline-none placeholder:text-ink/40 focus:border-navy"
      />
      {showing && (
        <ul
          id={listId}
          role="listbox"
          className="absolute top-full left-0 z-50 mt-1 max-h-80 w-full overflow-y-auto rounded-lg border border-line bg-white py-1 text-left shadow-lg"
        >
          {hits.length === 0 && (
            <li className="px-3 py-2 text-sm text-ink/50">
              No sessions match.
            </li>
          )}
          {hits.map((hit, i) => {
            const s = hit.session;
            const room = roomName?.(s) ?? null;
            const hosts = hostNames(s);
            return (
              <li
                key={s.id}
                id={`${listId}-${s.id}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(hit)}
                className={`cursor-pointer px-3 py-2 ${i === active ? "bg-navy text-white" : "text-ink"}`}
              >
                <span className="block truncate text-sm font-semibold">
                  {s.title}
                </span>
                <span
                  className={`block truncate text-xs ${i === active ? "text-white/75" : "text-ink/55"}`}
                >
                  {[hosts || null, when(s), room].filter(Boolean).join(" · ")}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
