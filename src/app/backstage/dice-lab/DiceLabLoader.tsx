"use client";

import dynamic from "next/dynamic";

// Client-only: the lab reads localStorage for its initial state and renders
// WebGL, neither of which has a server-side answer.
const DiceLab = dynamic(() => import("./DiceLab"), { ssr: false });

export default function DiceLabLoader() {
  return <DiceLab />;
}
