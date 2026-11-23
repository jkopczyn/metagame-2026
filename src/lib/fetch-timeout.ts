/** A fetch that gives up after `ms`, covering the response body too. */
export function fetchWithin(ms: number): typeof fetch {
  return (input, init) => {
    const deadline = AbortSignal.timeout(ms);
    return fetch(input, {
      ...init,
      signal: init?.signal
        ? AbortSignal.any([init.signal, deadline])
        : deadline,
    });
  };
}
