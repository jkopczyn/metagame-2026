import { describe, expect, it } from "vitest";
import {
  canRefer,
  couponUsdOff,
  formatReferralCode,
  referralCodeOf,
} from "./referral";

describe("referral codes", () => {
  it("formats as two groups of four", () => {
    expect(formatReferralCode("ABCDEFGH")).toBe("ABCD-EFGH");
  });

  it("accepts typed and linked forms, rejects other lengths", () => {
    expect(referralCodeOf("abcd-efgh")).toBe("ABCDEFGH");
    expect(referralCodeOf(" abcd efgh ")).toBe("ABCDEFGH");
    expect(referralCodeOf("A2C-4EF")).toBe("");
    expect(referralCodeOf(null)).toBe("");
  });

  it("reads confusable letters as their digits", () => {
    expect(referralCodeOf("0O1IL2U3")).toBe("001112V3");
  });

  it("lets every ticket refer but Night Market booths", () => {
    expect(canRefer("Standard")).toBe(true);
    expect(canRefer("Family & Friends Pack — Standard")).toBe(true);
    expect(canRefer(null)).toBe(true);
    expect(canRefer("Saturday Day Pass")).toBe(true);
    expect(canRefer("Metagame Night Market Booth")).toBe(false);
  });
});

describe("couponUsdOff", () => {
  it("values percent and amount coupons against the full price", () => {
    expect(couponUsdOff({ percent_off: 50 }, 425)).toBe(212.5);
    expect(couponUsdOff({ amount_off: 10000, currency: "usd" }, 425)).toBe(100);
    expect(couponUsdOff({ amount_off: 100000 }, 425)).toBe(425);
    expect(couponUsdOff({ amount_off: 10000, currency: "eur" }, 425)).toBe(0);
    expect(couponUsdOff({}, 425)).toBe(0);
  });
});
