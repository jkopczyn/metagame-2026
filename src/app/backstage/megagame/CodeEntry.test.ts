import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CodeEntry from "./CodeEntry";

const render = (badge: boolean) =>
  renderToStaticMarkup(
    createElement(CodeEntry, { label: "Code", onCode: () => true, badge }),
  );

describe("CodeEntry", () => {
  it("takes a six-character quest code by default", () => {
    const html = render(false);
    expect(html).toContain("Character 6 of 6");
    expect(html).not.toContain('inputMode="numeric"');
  });

  it("takes a four-digit badge number with badge", () => {
    const html = render(true);
    expect(html).toContain("Digit 4 of 4");
    expect(html).not.toContain("of 6");
    expect(html).toContain('inputMode="numeric"');
  });
});
