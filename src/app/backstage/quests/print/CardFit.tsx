"use client";

import { useEffect, useState } from "react";

const TITLE_PT = { max: 44, min: 18, step: 2 };
const BODY_PT = { min: 9, step: 0.5 };

const fits = (box: HTMLElement) =>
  box.scrollHeight <= box.clientHeight + 1 &&
  box.scrollWidth <= box.clientWidth + 1;

function shrink(
  box: HTMLElement,
  text: HTMLElement,
  maxPt: number,
  minPt: number,
  step: number,
) {
  for (let pt = maxPt; pt >= minPt; pt -= step) {
    text.style.fontSize = `${pt}pt`;
    if (fits(box)) return true;
  }
  return false;
}

/** Shrinks each card's title and body until they fit; returns the codes that still overflow. */
export function fitCards(root: ParentNode): string[] {
  const overflow: string[] = [];
  root.querySelectorAll<HTMLElement>("[data-card]").forEach((card) => {
    const title = card.querySelector<HTMLElement>("[data-title]");
    if (title) shrink(title, title, TITLE_PT.max, TITLE_PT.min, TITLE_PT.step);
    const body = card.querySelector<HTMLElement>("[data-body]");
    const text = card.querySelector<HTMLElement>("[data-body-text]");
    if (!body || !text) return;
    // Cards with pictures start smaller so the pictures get more of the page.
    const maxPt = card.querySelector("[data-images]") ? 13 : 18;
    if (!shrink(body, text, maxPt, BODY_PT.min, BODY_PT.step)) {
      card.dataset.overflow = "1";
      overflow.push(card.dataset.card ?? "?");
    }
  });
  return overflow;
}

/**
 * Runs the fit once fonts and pictures have loaded, then offers the print
 * button. Lists the cards whose text could not be made to fit.
 */
export default function CardFit({ count }: { count: number }) {
  const [state, setState] = useState<{ done: boolean; overflow: string[] }>({
    done: false,
    overflow: [],
  });
  useEffect(() => {
    let cancelled = false;
    const images = [...document.images].filter((img) => !img.complete);
    Promise.all([
      document.fonts.ready,
      ...images.map(
        (img) =>
          new Promise((done) => {
            img.addEventListener("load", done, { once: true });
            img.addEventListener("error", done, { once: true });
          }),
      ),
    ]).then(() => {
      if (cancelled) return;
      setState({ done: true, overflow: fitCards(document) });
    });
    return () => {
      cancelled = true;
    };
  }, [count]);
  return (
    <>
      <button
        type="button"
        onClick={() => window.print()}
        disabled={!state.done}
        className="rounded-md bg-navy px-3 py-1.5 font-semibold text-white disabled:opacity-50"
      >
        {state.done ? "Print" : "Laying out…"}
      </button>
      <span>
        {count} card{count === 1 ? "" : "s"}, one per US Letter page. Set
        margins to none and keep background graphics on.
      </span>
      {state.overflow.length > 0 && (
        <span role="alert" className="font-semibold text-[#c0392b]">
          Text doesn&rsquo;t fit on {state.overflow.join(", ")} even at 9pt;
          shorten it.
        </span>
      )}
    </>
  );
}
