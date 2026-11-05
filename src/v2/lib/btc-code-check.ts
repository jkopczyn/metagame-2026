export type CodeCheck = {
  valid: boolean;
  test: boolean;
  btcPrice: number | null;
  label?: string;
  exhausted?: boolean; // code is real but has hit its redemption cap
  rateLimited?: boolean; // we never looked the code up, so it may well be fine
};

/** Reads /api/checkout/opennode/validate-code's answer for the BTC modal. */
export async function readCodeCheck(res: Response): Promise<CodeCheck> {
  if (res.status === 429)
    return { valid: false, test: false, btcPrice: null, rateLimited: true };
  const d = await res.json();
  return {
    valid: Boolean(d.valid),
    test: Boolean(d.test),
    btcPrice: typeof d.btcPrice === "number" ? d.btcPrice : null,
    label: d.label,
    exhausted: Boolean(d.exhausted),
  };
}
