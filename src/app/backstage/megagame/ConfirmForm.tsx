"use client";

import { useActionState } from "react";
import { buttonClass } from "../ui";
import { confirmCompletions } from "./actions";

/** A retry is safe: the store leaves a player who is already completed alone. */
export default function ConfirmForm({
  questId,
  questCode,
  players,
  list,
  board,
}: {
  questId: string;
  questCode: string;
  /** Only the players who can be recorded. */
  players: string[];
  /** The whole list, kept on the board with the result. */
  list: string[];
  /** The board's query string, so the other sections keep their choices. */
  board: string;
}) {
  const [state, run, pending] = useActionState(confirmCompletions, {});
  const n = players.length;
  return (
    <form action={run} className="flex flex-col gap-2">
      <input type="hidden" name="questId" value={questId} />
      <input type="hidden" name="questCode" value={questCode} />
      <input type="hidden" name="list" value={list.join(",")} />
      <input type="hidden" name="board" value={board} />
      {players.map((p) => (
        <input key={p} type="hidden" name="player" value={p} />
      ))}
      <button
        type="submit"
        disabled={pending || n === 0}
        className={buttonClass}
      >
        {pending
          ? "Recording…"
          : n === 0
            ? "Nobody to record"
            : `Confirm ${n} ${n === 1 ? "player" : "players"}`}
      </button>
      {state.error && (
        <p role="alert" className="text-sm text-meeple">
          {state.error}
        </p>
      )}
    </form>
  );
}
