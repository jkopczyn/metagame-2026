"use client";

import { useActionState, useState } from "react";
import AccountPicker from "../checkin/AccountPicker";
import { buttonClass, fieldClass, smallButtonClass } from "../ui";
import { findThieves, recordStealAction, type HatFormState } from "./actions";
import type { CheckinAccount } from "@/lib/checkin";
import { HATS, type HatId } from "@/lib/hat-tricks-hats";
import { toPacificWall } from "@/lib/schedule";

/** Built for a phone: tap the hat, find the thief, record. Time defaults to now. */
export default function StealForm({ onShift }: { onShift: HatId[] }) {
  const [hatId, setHatId] = useState<HatId | null>(null);
  const [thief, setThief] = useState<CheckinAccount | null>(null);
  const [wall, setWall] = useState<string | null>(null);
  const [state, run, pending] = useActionState(
    async (prev: HatFormState, formData: FormData) => {
      const next = await recordStealAction(prev, formData);
      if (next.done) {
        setHatId(null);
        setThief(null);
        setWall(null);
      }
      return next;
    },
    {},
  );

  return (
    <form
      action={run}
      className="flex flex-col gap-5 rounded-xl border border-line bg-white p-4 sm:p-5"
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium text-ink/80">Hat</legend>
        <div className="grid grid-cols-3 gap-2">
          {HATS.map((hat) => (
            <label
              key={hat.id}
              className="relative flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-line bg-white p-2 text-center has-checked:border-2 has-checked:border-navy has-checked:bg-navy/5 has-focus-visible:outline-2 has-focus-visible:outline-navy"
            >
              <input
                type="radio"
                name="hatId"
                value={hat.id}
                checked={hatId === hat.id}
                onChange={() => setHatId(hat.id)}
                className="sr-only"
              />
              {/* eslint-disable-next-line @next/next/no-img-element -- static line art */}
              <img src={hat.art} alt="" className="size-12 object-contain" />
              <span className="text-xs leading-tight text-navy">
                {hat.name}
              </span>
              <span
                className={`rounded-full px-1.5 text-[11px] font-medium ${
                  onShift.includes(hat.id)
                    ? "bg-meeple text-white"
                    : "invisible"
                }`}
              >
                On shift
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-2">
        {thief ? (
          <>
            <span className="text-sm font-medium text-ink/80">Thief</span>
            <input type="hidden" name="userId" value={thief.id} />
            <div className="flex items-center gap-3 rounded-lg border-2 border-navy bg-navy/5 px-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-navy">
                  {thief.name}
                </span>
                <span className="block truncate font-mono text-xs text-ink/60">
                  {thief.email}
                </span>
              </span>
              <button
                type="button"
                onClick={() => setThief(null)}
                className={smallButtonClass}
              >
                Change
              </button>
            </div>
          </>
        ) : (
          <AccountPicker
            suggested={null}
            buyer={null}
            search={findThieves}
            onPick={setThief}
          />
        )}
      </div>

      <div className="flex flex-col gap-2">
        {wall === null ? (
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-ink/80">
              <span className="font-medium">When:</span> just now
            </span>
            <button
              type="button"
              onClick={() => setWall(toPacificWall(new Date().toISOString()))}
              className={smallButtonClass}
            >
              It was earlier
            </button>
          </div>
        ) : (
          <>
            <label
              htmlFor="stolenAt"
              className="text-sm font-medium text-ink/80"
            >
              When (Pacific)
            </label>
            <div className="flex items-center gap-2">
              <input
                id="stolenAt"
                type="datetime-local"
                name="stolenAt"
                value={wall}
                onChange={(e) => setWall(e.target.value)}
                className={`${fieldClass} min-w-0`}
              />
              <button
                type="button"
                onClick={() => setWall(null)}
                className={`${smallButtonClass} shrink-0`}
              >
                Just now
              </button>
            </div>
          </>
        )}
      </div>

      <button
        type="submit"
        disabled={pending || !hatId || !thief}
        className={buttonClass}
      >
        {pending ? "Recording…" : "Record steal"}
      </button>
      <div aria-live="polite" className="empty:hidden">
        {state.error && (
          <p role="alert" className="text-sm text-meeple">
            {state.error}
          </p>
        )}
        {state.done && <p className="text-sm text-navy">{state.done}</p>}
        {state.warning && (
          <p className="mt-1 text-sm text-meeple">{state.warning}</p>
        )}
      </div>
    </form>
  );
}
