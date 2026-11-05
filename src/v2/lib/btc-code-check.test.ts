import { expect, it } from "vitest";
import { readCodeCheck } from "./btc-code-check";

it("passes a real answer through", async () => {
  const res = Response.json({
    valid: true,
    test: false,
    exhausted: false,
    btcPrice: 0.005,
    label: "Early bird",
  });
  expect(await readCodeCheck(res)).toEqual({
    valid: true,
    test: false,
    btcPrice: 0.005,
    label: "Early bird",
    exhausted: false,
  });
});

it("doesn't flag an unknown code as rate limited", async () => {
  const res = Response.json({ valid: false, test: false, exhausted: false });
  const check = await readCodeCheck(res);
  expect(check.valid).toBe(false);
  expect(check.rateLimited).toBeUndefined();
});

it("marks a 429 as rate limited, whatever its body", async () => {
  expect(await readCodeCheck(new Response("", { status: 429 }))).toEqual({
    valid: false,
    test: false,
    btcPrice: null,
    rateLimited: true,
  });
});
