/** Tells a finished async request whether a newer one, or a cancel, has replaced it. */
export function latestRequest() {
  let current = 0;
  return {
    begin() {
      const mine = ++current;
      return () => mine === current;
    },
    cancel() {
      current++;
    },
  };
}
