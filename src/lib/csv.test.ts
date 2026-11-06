import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";

describe("toCsv", () => {
  it("writes a header row and CRLF line endings", () => {
    expect(
      toCsv(
        ["a", "b"],
        [
          [1, "x"],
          [2, "y"],
        ],
      ),
    ).toBe("a,b\r\n1,x\r\n2,y\r\n");
  });

  it("quotes commas, quotes and newlines", () => {
    expect(toCsv(["v"], [['say "hi", then\nleave']])).toBe(
      'v\r\n"say ""hi"", then\nleave"\r\n',
    );
  });

  it("writes dates as ISO, arrays space-separated, and null as empty", () => {
    const d = new Date("2026-11-07T10:00:00.000Z");
    expect(toCsv(["d", "l", "n", "b"], [[d, ["u1", "u2"], null, false]])).toBe(
      "d,l,n,b\r\n2026-11-07T10:00:00.000Z,u1 u2,,false\r\n",
    );
  });

  it("keeps a spreadsheet from reading a text cell as a formula", () => {
    expect(toCsv(["v"], [["=HYPERLINK(1)"], ["+1"], ["-x"], ["@a"]])).toBe(
      "v\r\n'=HYPERLINK(1)\r\n'+1\r\n'-x\r\n'@a\r\n",
    );
  });

  it("leaves numbers alone, negative ones included", () => {
    expect(toCsv(["v"], [[-3]])).toBe("v\r\n-3\r\n");
  });
});
