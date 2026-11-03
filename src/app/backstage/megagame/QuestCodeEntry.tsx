"use client";

import { useRouter } from "next/navigation";
import CodeEntry from "./CodeEntry";
import { boardHref, type BoardParams } from "./board-params";
import ScanCodes from "./ScanCodes";

export default function QuestCodeEntry({ params }: { params: BoardParams }) {
  const router = useRouter();
  const open = (code: string) =>
    router.push(boardHref({ ...params, quest: code, confirmation: null }), {
      scroll: false,
    });
  return (
    <div className="flex flex-col gap-3">
      <CodeEntry
        label="Quest code"
        autoFocus={!params.quest}
        onCode={(code) => {
          open(code);
          return false;
        }}
      />
      <ScanCodes label="Scan a quest label" bareKind="quest" onQuest={open} />
    </div>
  );
}
