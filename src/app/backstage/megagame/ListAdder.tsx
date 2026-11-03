"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import PlayerAdder from "./PlayerAdder";
import { boardHref, type BoardParams } from "./board-params";
import { listQueue } from "./player-list";

/** Adds to the list kept in the URL. A scanned quest label opens that quest with the list. */
export default function ListAdder({ params }: { params: BoardParams }) {
  const ids = params.players;
  const router = useRouter();
  const [queue] = useState(listQueue);
  const [navigating, start] = useTransition();

  useEffect(() => {
    if (!navigating) queue.settle();
  }, [navigating, queue]);

  return (
    <PlayerAdder
      onAdd={(p) => {
        const next = queue.add(ids, p.id);
        start(() =>
          router.replace(boardHref({ ...params, players: next }), {
            scroll: false,
          }),
        );
      }}
      onQuest={(code) =>
        router.push(
          boardHref({
            ...params,
            quest: code,
            confirmation: null,
            players: queue.current(ids),
          }),
          { scroll: false },
        )
      }
    />
  );
}
