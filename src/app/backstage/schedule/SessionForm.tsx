"use client";

import {
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  startTransition,
} from "react";
import { CircleAlertIcon, XIcon } from "lucide-react";
import { deleteSession, saveSession, type FormState } from "./actions";
import AttendancePanel from "./AttendancePanel";
import ConfirmDialog from "./ConfirmDialog";
import HostPicker from "./HostPicker";
import RfpPanel from "./RfpPanel";
import ShepherdPicker from "./ShepherdPicker";
import { UnsavedChangesDialog, useUnsavedChanges } from "./UnsavedChanges";
import {
  buttonClass,
  fieldClass,
  selectClass,
  selectStyle,
  smallButtonClass,
} from "../ui";
import {
  AGES,
  CATEGORIES,
  clashDescription,
  EDITOR_DAYS,
  defaultEnd,
  endMinutes,
  movedEnd,
  opensAt,
  STATUSES,
  formatPacificDay,
  minutesToHHMM,
  pacificDayKey,
  wallAt,
  pacificMinutes,
  type Attendance,
  type PlanConflict,
  type ScheduleLocation,
  type ScheduleSession,
  type ViewerPlans,
} from "@/lib/schedule";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/v2/components/ui/dialog";

const LABELS = {
  talk: "Talk",
  workshop: "Workshop",
  game: "Game",
  other: "Other",
  all: "All ages",
  kids: "Kid-friendly",
  adults: "18+",
  draft: "Draft",
  published: "Published",
} as const;

function Field({
  label,
  name,
  state,
  children,
  className = "",
}: {
  label: string;
  name: string;
  state: FormState;
  children: React.ReactNode;
  className?: string;
}) {
  const error = state.field === name ? state.error : null;
  return (
    <label className={`block text-sm ${className}`}>
      <span className="mb-1 block font-medium text-ink/80">{label}</span>
      {children}
      {error && <span className="mt-1 block text-xs text-meeple">{error}</span>}
    </label>
  );
}

function Checkbox({
  name,
  label,
  hint,
  defaultChecked,
}: {
  name: string;
  label: string;
  hint: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex items-start gap-2">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="mt-0.5 size-4 accent-meeple"
      />
      <span>
        <span className="font-medium text-ink/80">{label}</span>
        <span className="block text-xs text-ink/50">{hint}</span>
      </span>
    </label>
  );
}

/** Prefill for a new session, e.g. from clicking an empty grid slot. */
export type SessionDefaults = {
  day: string;
  startMin: number;
  locationId: string | null;
};

const DEFAULT_START = 10 * 60;
const MIDNIGHT = 24 * 60;

/** Minutes since midnight from an "HH:MM" time input, or null when cleared. */
function parseHHMM(value: string): number | null {
  const m = /^(\d{2}):(\d{2})/.exec(value);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** "11/6" from "2026-11-06". */
function monthSlashDay(key: string): string {
  const [, m, d] = key.split("-").map(Number);
  return `${m}/${d}`;
}

/** Create (no `session`) or edit a session, in a dialog on the cream admin page. */
export default function SessionForm({
  session,
  defaults,
  locations,
  attendance,
  viewer,
  conflicts,
  onClose,
}: {
  session: ScheduleSession | null;
  defaults?: SessionDefaults;
  locations: ScheduleLocation[];
  attendance?: Attendance[string];
  viewer: (ViewerPlans & { userId: string }) | null;
  conflicts: PlanConflict[];
  onClose: () => void;
}) {
  const [day, setDay] = useState(
    session?.startsAt ? pacificDayKey(session.startsAt) : (defaults?.day ?? ""),
  );
  const [start, setStart] = useState<number | null>(
    session?.startsAt
      ? pacificMinutes(session.startsAt)
      : (defaults?.startMin ?? null),
  );
  const [end, setEnd] = useState<number | null>(
    session?.startsAt && session.endsAt
      ? endMinutes(session.startsAt, session.endsAt)
      : defaults
        ? defaultEnd(defaults.startMin)
        : null,
  );
  // Set only when moving the start cut the end back to midnight.
  const [shortened, setShortened] = useState(false);

  const dayOptions: { key: string; label: string }[] = EDITOR_DAYS.map((d) => ({
    key: d.key,
    label: `${d.name} ${monthSlashDay(d.key)}`,
  }));
  if (day && !dayOptions.some((d) => d.key === day) && session?.startsAt) {
    dayOptions.push({ key: day, label: formatPacificDay(session.startsAt) });
  }

  const pickDay = (key: string) => {
    setDay(key);
    if (!key || start !== null) return;
    const first = Math.max(DEFAULT_START, opensAt(key));
    setStart(first);
    setEnd(defaultEnd(first));
  };

  // Moving the start keeps the duration, like a calendar drag.
  const pickStart = (next: number | null) => {
    setStart(next);
    if (next === null) return;
    const moved = movedEnd(start, end, next);
    setEnd(moved.end);
    setShortened(moved.capped);
  };

  const [state, formAction, pending] = useActionState<FormState, FormData>(
    saveSession,
    {},
  );
  const [deleting, startDelete] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<FormState | null>(null);
  const startRef = useRef<HTMLInputElement>(null);
  const conflict = state !== dismissed ? state.conflict : undefined;
  const submit = (data: FormData) => startTransition(() => formAction(data));

  useEffect(() => {
    if (state.ok) onClose();
  }, [state, onClose]);

  const { form, formRef, requestClose, confirm } = useUnsavedChanges({
    onClose,
    pending,
  });
  const formId = useId();

  const generalError =
    state.error && !state.field ? state.error : (deleteError ?? null);

  return (
    <Dialog open onOpenChange={(open) => !open && requestClose()}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[92vh] max-w-[720px] scroll-pt-20 overflow-y-auto border-line bg-white px-6 py-6 text-ink sm:px-8"
      >
        <button
          type="button"
          onClick={requestClose}
          aria-label="Close"
          className="absolute top-3 right-3 flex h-9 w-9 items-center justify-center rounded-md text-ink/40 transition-colors hover:text-ink"
        >
          <XIcon className="size-[18px]" />
        </button>
        <DialogTitle className="font-bebas mb-5 text-2xl tracking-wide text-navy">
          {session ? "Edit session" : "New session"}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {session ? "Edit this session." : "Add a session to the schedule."}
        </DialogDescription>

        <div className="sticky -top-6 z-10 -mx-6 -mt-3 mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-line bg-white px-6 py-3 sm:-mx-8 sm:px-8">
          <div className="flex items-center gap-2">
            {session &&
              (confirmDelete ? (
                <>
                  <button
                    type="button"
                    disabled={deleting}
                    onClick={() =>
                      startDelete(async () => {
                        const result = await deleteSession(session.id);
                        if (result.error) setDeleteError(result.error);
                        else onClose();
                      })
                    }
                    className={`${smallButtonClass} border-meeple text-meeple hover:bg-meeple hover:text-white`}
                  >
                    {deleting ? "Deleting…" : "Yes, delete it"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className={smallButtonClass}
                  >
                    Keep
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className={`${smallButtonClass} hover:border-meeple hover:text-meeple`}
                >
                  Delete
                </button>
              ))}
            {generalError && (
              <span className="text-sm text-meeple">{generalError}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={requestClose}
              className={smallButtonClass}
            >
              Cancel
            </button>
            <button
              type="submit"
              form={formId}
              disabled={pending}
              className={`${buttonClass} w-auto`}
            >
              {pending ? "Saving…" : session ? "Save" : "Create"}
            </button>
          </div>
        </div>

        <form
          id={formId}
          ref={formRef}
          // Submitted by hand: a form `action` resets every field once it
          // returns, which would wipe the form behind an overlap prompt.
          onSubmit={(e) => {
            e.preventDefault();
            submit(new FormData(e.currentTarget));
          }}
          className="grid gap-4 sm:grid-cols-2"
        >
          {session && <input type="hidden" name="id" value={session.id} />}

          <Field
            label="Title"
            name="title"
            state={state}
            className="sm:col-span-2"
          >
            <input
              name="title"
              required
              defaultValue={session?.title ?? ""}
              className={fieldClass}
              autoFocus
            />
          </Field>

          {session && (
            <RfpPanel
              sessionId={session.id}
              recordId={session.airtableRfpRecordId}
              shepherd={session.shepherd}
            />
          )}

          <ShepherdPicker
            initial={session?.shepherd ?? null}
            error={state.field === "shepherd" ? state.error : null}
          />

          <Field label="Slug" name="slug" state={state}>
            <input
              name="slug"
              defaultValue={session?.slug ?? ""}
              placeholder="from the title if blank"
              className={`${fieldClass} font-mono text-sm`}
            />
          </Field>

          <Field label="Status" name="status" state={state}>
            <select
              name="status"
              defaultValue={session?.status ?? "draft"}
              className={selectClass}
              style={selectStyle}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {LABELS[s]}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-3 gap-3 sm:col-span-2">
            <Field label="Day" name="day" state={state}>
              <select
                value={day}
                onChange={(e) => pickDay(e.target.value)}
                className={selectClass}
                style={selectStyle}
              >
                <option value="">Not scheduled</option>
                {dayOptions.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Starts" name="startsAt" state={state}>
              <input
                ref={startRef}
                type="time"
                step={300}
                value={day && start !== null ? minutesToHHMM(start) : ""}
                disabled={!day}
                onChange={(e) => pickStart(parseHHMM(e.target.value))}
                className={fieldClass}
              />
            </Field>
            <Field label="Ends" name="endsAt" state={state}>
              <input
                type="time"
                step={300}
                value={day && end !== null ? minutesToHHMM(end % MIDNIGHT) : ""}
                disabled={!day}
                // No session ends at the start of its own day, so 00:00 is midnight.
                onChange={(e) => {
                  const next = parseHHMM(e.target.value);
                  setEnd(next === 0 ? MIDNIGHT : next);
                  setShortened(false);
                }}
                className={fieldClass}
              />
              {shortened && (
                <span
                  role="status"
                  className="mt-1 flex items-center gap-1 text-xs text-amber-700"
                >
                  <CircleAlertIcon aria-hidden className="size-3.5 shrink-0" />
                  Shortened to end at midnight.
                </span>
              )}
            </Field>
            <input
              type="hidden"
              name="startsAt"
              value={day && start !== null ? wallAt(day, start) : ""}
            />
            <input
              type="hidden"
              name="endsAt"
              value={day && end !== null ? wallAt(day, end) : ""}
            />
          </div>

          <Field label="Room" name="locationId" state={state}>
            <select
              name="locationId"
              defaultValue={session?.locationId ?? defaults?.locationId ?? ""}
              className={selectClass}
              style={selectStyle}
            >
              <option value="">No room yet</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                  {l.capacity ? ` · 👤 ${l.capacity}` : ""}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Category" name="category" state={state}>
            <select
              name="category"
              defaultValue={session?.category ?? ""}
              className={selectClass}
              style={selectStyle}
            >
              <option value="">Unset</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {LABELS[c]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Ages" name="ages" state={state}>
            <select
              name="ages"
              defaultValue={session?.ages ?? ""}
              className={selectClass}
              style={selectStyle}
            >
              <option value="">Unset</option>
              {AGES.map((a) => (
                <option key={a} value={a}>
                  {LABELS[a]}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Min capacity" name="minCapacity" state={state}>
              <input
                name="minCapacity"
                inputMode="numeric"
                defaultValue={session?.minCapacity ?? ""}
                className={fieldClass}
              />
            </Field>
            <Field label="Max capacity" name="maxCapacity" state={state}>
              <input
                name="maxCapacity"
                inputMode="numeric"
                defaultValue={session?.maxCapacity ?? ""}
                placeholder="unlimited"
                className={fieldClass}
              />
            </Field>
          </div>

          <div className="flex flex-col gap-2 text-sm sm:col-span-2">
            <Checkbox
              name="rsvpIsCommitment"
              label="RSVP is a commitment"
              hint="Attendees claim a limited spot people rely on, and confirm before they do."
              defaultChecked={session?.rsvpIsCommitment ?? false}
            />
            <Checkbox
              name="sponsored"
              label="Sponsor session"
              hint="Tagged “Sponsor” on the schedule."
              defaultChecked={session?.sponsored ?? false}
            />
          </div>

          <HostPicker
            initial={session?.hosts ?? []}
            error={state.field === "hosts" ? state.error : null}
          />

          <Field
            label="Description"
            name="description"
            state={state}
            className="sm:col-span-2"
          >
            <textarea
              name="description"
              rows={4}
              defaultValue={session?.description ?? ""}
              className={fieldClass}
            />
          </Field>

          <Field
            label="Needs (A/V, tables, materials…)"
            name="needs"
            state={state}
            className="sm:col-span-2"
          >
            <textarea
              name="needs"
              rows={2}
              defaultValue={session?.needs ?? ""}
              className={fieldClass}
            />
          </Field>
        </form>
        <ConfirmDialog
          open={Boolean(conflict)}
          title="Room conflict"
          onDismiss={() => setDismissed(state)}
          onClosed={() => startRef.current?.focus()}
          actions={[
            { label: "Edit time", onClick: () => setDismissed(state) },
            {
              label: "Save anyway",
              primary: true,
              disabled: pending,
              onClick: () => {
                const data = new FormData(form!);
                data.set("allowOverlap", "1");
                setDismissed(state);
                submit(data);
              },
            },
          ]}
        >
          {state.conflict && (
            <>This overlaps {clashDescription(state.conflict)}.</>
          )}
        </ConfirmDialog>
        <UnsavedChangesDialog {...confirm} />
        {session && (
          <AttendancePanel
            session={session}
            attendance={attendance}
            viewer={viewer}
            conflicts={conflicts}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
