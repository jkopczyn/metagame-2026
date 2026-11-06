import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("./actions", () => ({ chooseMegagameClass: vi.fn() }));

import MegagamePanel from "./MegagamePanel";

const render = (locked: boolean, badgeCode: string | null = "0042") =>
  renderToStaticMarkup(
    createElement(MegagamePanel, {
      levels: { wizard: 3, pirate: 0, alien: 1 },
      badgeCode,
      locked,
    }),
  );

const text = (html: string) => html.replace(/<[^>]+>/g, "");

describe("MegagamePanel", () => {
  it("offers the faction picker before a volunteer level-up", () => {
    const html = render(false);
    expect(html).toContain("Pick a faction");
    expect(html).toContain('name="class"');
  });

  it("shows the current levels instead of the picker once locked", () => {
    const html = render(true);
    expect(html).not.toContain("Pick a faction");
    expect(html).not.toContain('name="class"');
    expect(html).toContain("Your classes");
  });

  it("shows the badge number zero-padded to four digits", () => {
    expect(text(render(true))).toContain("Badge number 0042");
    expect(text(render(false))).toContain("Badge number 0042");
  });

  it("says when no badge number is assigned yet", () => {
    const shown = text(render(false, null));
    expect(shown).toContain("Your badge number is not assigned yet.");
    expect(shown).not.toContain("Badge number 0");
  });
});
