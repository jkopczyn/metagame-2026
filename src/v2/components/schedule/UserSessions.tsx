"use client";

import { useState } from "react";
import Link from "next/link";
import {
  buildDays,
  isListed,
  isPlaced,
  openingDayKey,
  selectedDay,
  type PublicLocation,
} from "@/lib/schedule";
import {
  ROLE_LABELS,
  withRole,
  type UserSession,
  type UserSessionRole,
} from "@/lib/user-profile";
import {
  buildColumns,
  DayTabs,
  EmptyPanel,
  GridDay,
  SessionRow,
  SessionRows,
  ViewToggle,
  type View,
} from "./ScheduleViews";
import { ScheduleLegend } from "./SessionBits";

// One person's sessions, as a list or on the schedule grid. Rendered by both
// the public /u/<id> and the team's /backstage/users/<id>; which roles appear
// is the caller's call, not this component's.

const TAG =
  "rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase";

const ROLE_TAG: Record<UserSessionRole, string> = {
  hosting: "bg-[#1b1530] text-[#f4ecd2]",
  shepherding: "bg-[#4096ff] text-white",
  attending: "bg-[#1b1530]/12 text-[#1b1530]",
};

function RoleTags({
  session,
  roles,
}: {
  session: UserSession;
  roles: UserSessionRole[];
}) {
  return (
    <>
      {roles
        .filter((r) => session.roles.includes(r))
        .map((r) => (
          <span key={r} className={`${TAG} ${ROLE_TAG[r]}`}>
            {ROLE_LABELS[r]}
          </span>
        ))}
      {session.status === "draft" && (
        <span className={`${TAG} bg-[#1b1530]/12 text-[#1b1530]`}>Draft</span>
      )}
    </>
  );
}

/** The extra word a role's own list adds: which host, which RSVP. */
function roleNote(session: UserSession, role: UserSessionRole): string | null {
  if (role === "hosting") return session.lead ? "Lead host" : "Co-host";
  if (role === "attending")
    return session.rsvp === "waitlist" ? "Waitlist" : "Going";
  return null;
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-normal text-[#1b1530]/55">
      {children}
    </span>
  );
}

function UnscheduledRows({
  sessions,
  roomName,
  href,
  roles,
}: {
  sessions: UserSession[];
  roomName: (id: string | null) => string | null;
  href: (s: UserSession) => string | null;
  roles: UserSessionRole[];
}) {
  return (
    <SessionRows>
      {sessions.map((s) => {
        const to = href(s);
        const body = (
          <>
            <div className="w-14 shrink-0 pt-0.5 text-right text-[11px] text-[#1b1530]/50 sm:w-16">
              Time TBA
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-start gap-1.5 leading-tight font-semibold">
                <span>{s.title}</span>
                <RoleTags session={s} roles={roles} />
              </div>
              {roomName(s.locationId) && (
                <div className="mt-0.5 text-[13px] text-[#1b1530]/65">
                  {roomName(s.locationId)}
                </div>
              )}
            </div>
          </>
        );
        return (
          <li key={s.id}>
            {to ? (
              <Link
                href={to}
                className="flex w-full items-stretch gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[#1b1530]/[0.04]"
              >
                {body}
              </Link>
            ) : (
              <div className="flex w-full items-stretch gap-3 px-3 py-2.5 text-left">
                {body}
              </div>
            )}
          </li>
        );
      })}
    </SessionRows>
  );
}

export default function UserSessions({
  sessions,
  locations,
  roles,
  linkable,
  emptyLabel = "Nothing on the schedule yet.",
}: {
  sessions: UserSession[];
  locations: PublicLocation[];
  /** Which lists to show, in order. */
  roles: UserSessionRole[];
  /** Whether session pages are reachable yet (the schedule is still gated). */
  linkable: boolean;
  emptyLabel?: string;
}) {
  const placed = sessions.filter(isPlaced);
  const unscheduled = sessions.filter((s) => !isPlaced(s));
  const days = buildDays(placed);
  const firstFilled =
    days.find((d) => d.sessions.length > 0)?.key ?? openingDayKey(days);
  const [view, setView] = useState<View>("list");
  const [dayKey, setDayKey] = useState(firstFilled);

  const href = (s: UserSession) =>
    linkable && isListed(s) ? `/schedule/${encodeURIComponent(s.slug)}` : null;
  const roomName = (id: string | null) =>
    locations.find((l) => l.id === id)?.name ?? null;
  const columns = buildColumns(
    locations,
    placed.some((s) => s.locationId === null),
  );

  if (sessions.length === 0) return <EmptyPanel>{emptyLabel}</EmptyPanel>;

  const day = selectedDay(days, dayKey);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <ViewToggle
          view={view}
          onSelect={setView}
          labels={{ grid: "Schedule" }}
        />
        {view === "grid" && (
          <DayTabs days={days} selected={day.key} onSelect={setDayKey} />
        )}
      </div>

      {view === "grid" ? (
        <div className="flex flex-col gap-4">
          <ScheduleLegend />
          {columns.length > 0 && day.sessions.length > 0 ? (
            <GridDay
              day={day}
              columns={columns}
              href={href}
              // With one list there's nothing to tell apart, so the blocks
              // stay as small as they are on the real schedule.
              badge={
                roles.length > 1
                  ? (s) => (
                      <span className="mt-1 flex flex-wrap gap-1">
                        <RoleTags session={s} roles={roles} />
                      </span>
                    )
                  : undefined
              }
            />
          ) : (
            <EmptyPanel>Nothing on {day.name}.</EmptyPanel>
          )}
          {unscheduled.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="font-grotesk text-sm font-bold text-navy">
                Not yet scheduled
              </h3>
              <UnscheduledRows
                sessions={unscheduled}
                roomName={roomName}
                href={href}
                roles={roles}
              />
            </section>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {roles.map((role) => {
            const mine = withRole(sessions, role);
            const minePlaced = mine.filter(isPlaced);
            const mineLater = mine.filter((s) => !isPlaced(s));
            const others = roles.filter((r) => r !== role);
            return (
              <section key={role} className="flex flex-col gap-2">
                <h3 className="font-grotesk text-lg font-bold text-navy">
                  {ROLE_LABELS[role]}
                </h3>
                {mine.length === 0 && (
                  <EmptyPanel>
                    No sessions {ROLE_LABELS[role].toLowerCase()}.
                  </EmptyPanel>
                )}
                {minePlaced.length > 0 && (
                  <SessionRows>
                    {minePlaced.map((s) => (
                      <SessionRow
                        key={s.id}
                        session={s}
                        roomName={roomName}
                        href={href}
                        badge={(row) => (
                          <>
                            {roleNote(row, role) && (
                              <Note>{roleNote(row, role)}</Note>
                            )}
                            <RoleTags session={row} roles={others} />
                          </>
                        )}
                      />
                    ))}
                  </SessionRows>
                )}
                {mineLater.length > 0 && (
                  <UnscheduledRows
                    sessions={mineLater}
                    roomName={roomName}
                    href={href}
                    roles={others}
                  />
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
