"use client";

import { useRouter } from "next/navigation";
import { boardHref, type BoardParams } from "./board-params";
import PlayerAdder from "./PlayerAdder";

export default function LevelUpPicker({ params }: { params: BoardParams }) {
  const router = useRouter();
  return (
    <PlayerAdder
      single
      onAdd={(p) =>
        router.replace(boardHref({ ...params, levelUp: p.id }), {
          scroll: false,
        })
      }
    />
  );
}
