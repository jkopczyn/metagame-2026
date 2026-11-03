"use client";

import { GripVerticalIcon } from "lucide-react";
import { useOptimistic, useState, useTransition } from "react";
import { reorderLocations } from "./actions";
import { smallButtonClass } from "../ui";
import { VISIBILITY_LABEL, type ScheduleLocation } from "@/lib/schedule";

/** The rooms table; drag a row by its grip to change the grid's column order. */
export default function RoomList({
  locations,
  canReorder,
  onEdit,
  onError,
}: {
  locations: ScheduleLocation[];
  canReorder: boolean;
  onEdit: (location: ScheduleLocation) => void;
  onError: (message: string | null) => void;
}) {
  // Shown in the dragged order while the save is in flight; a failed save snaps back.
  const [rows, showOrder] = useOptimistic(
    locations,
    (_, next: ScheduleLocation[]) => next,
  );
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const dropOn = (targetId: string) => {
    if (!dragging || dragging === targetId) return;
    const from = rows.findIndex((l) => l.id === dragging);
    const to = rows.findIndex((l) => l.id === targetId);
    if (from < 0 || to < 0) return;
    const next = [...rows];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    startTransition(async () => {
      showOrder(next);
      const result = await reorderLocations(next.map((l) => l.id));
      onError(result.error ?? null);
    });
  };
  const clear = () => {
    setDragging(null);
    setOver(null);
  };

  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-white">
      <table className="w-full text-left text-sm">
        <thead className="text-xs tracking-wide text-ink/50 uppercase">
          <tr>
            {canReorder && <th className="w-8 px-2 py-2" />}
            <th className="px-4 py-2 font-medium">Name</th>
            <th className="px-4 py-2 font-medium">Campus</th>
            <th className="px-4 py-2 font-medium">Capacity</th>
            <th className="px-4 py-2 font-medium">Seen by</th>
            <th className="px-4 py-2 font-medium" />
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((l) => (
            <tr
              key={l.id}
              onDragOver={(e) => {
                if (!canReorder || !dragging) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setOver(l.id);
              }}
              onDrop={(e) => {
                e.preventDefault();
                dropOn(l.id);
                clear();
              }}
              className={`transition-colors ${
                dragging === l.id
                  ? "opacity-40"
                  : over === l.id
                    ? "bg-navy/10"
                    : ""
              }`}
            >
              {canReorder && (
                <td className="px-2 py-2">
                  <button
                    type="button"
                    aria-label={`Move ${l.name}`}
                    title="Drag to reorder"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", l.id);
                      setDragging(l.id);
                    }}
                    onDragEnd={clear}
                    className="flex h-6 w-6 cursor-grab items-center justify-center rounded text-ink/40 transition-colors hover:bg-ink/10 hover:text-ink"
                  >
                    <GripVerticalIcon size={14} aria-hidden />
                  </button>
                </td>
              )}
              <td className="px-4 py-2 font-semibold">
                <span className="flex items-center gap-2">
                  {l.thumbnailUrl && (
                    // eslint-disable-next-line @next/next/no-img-element -- already thumbnail-sized
                    <img
                      src={l.thumbnailUrl}
                      alt=""
                      className="h-8 w-10 rounded object-cover"
                    />
                  )}
                  {l.name}
                </span>
              </td>
              <td className="px-4 py-2">{l.campusLocation ?? "—"}</td>
              <td className="px-4 py-2 tabular-nums">{l.capacity ?? "—"}</td>
              <td className="px-4 py-2">{VISIBILITY_LABEL[l.visibility]}</td>
              <td className="px-4 py-2 text-right">
                <button
                  type="button"
                  onClick={() => onEdit(l)}
                  className={smallButtonClass}
                >
                  Edit
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={canReorder ? 6 : 5}
                className="px-4 py-6 text-center text-ink/50"
              >
                No rooms yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
