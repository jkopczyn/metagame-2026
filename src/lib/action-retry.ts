import { startTransition, type FormEvent } from "react";

export const OFFLINE_MESSAGE =
  "Couldn't reach the site. Check your connection and try again.";

// fetch's rejection in Chrome, Firefox and Safari. Anything else, like the error
// redirect() surfaces as, is for Next to handle.
const NETWORK_FAILURE =
  /failed to fetch|networkerror|load failed|network connection was lost|internet connection appears to be offline/i;

export function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError && NETWORK_FAILURE.test(error.message);
}

/**
 * For useActionState: a rejected action reaches the error boundary and takes the
 * form with it, so a dropped connection comes back as an error on the same step
 * instead. The flags cleared here all describe a submit that succeeded or a
 * field at fault, neither true of this one. `keep` restores what was typed where
 * the state is what fills the field back in after React resets the form.
 */
export function retryable<State extends { error?: string }, Payload>(
  action: (state: State, payload: Payload) => Promise<State>,
  keep?: (payload: Payload) => Partial<State>,
): (state: State, payload: Payload) => Promise<State> {
  return async (state, payload) => {
    try {
      return await action(state, payload);
    } catch (error) {
      if (!isNetworkError(error)) throw error;
      return {
        ...state,
        ...keep?.(payload),
        saved: undefined,
        ok: undefined,
        field: undefined,
        conflict: undefined,
        error: OFFLINE_MESSAGE,
      } as State;
    }
  };
}

/**
 * For a form keyed on `savedAt` to remount after a save: a failed save returns
 * without one, which would change the key too and remount the draft away.
 */
export function keepingSavedAt<State extends { savedAt?: number }, Payload>(
  action: (state: State, payload: Payload) => Promise<State>,
): (state: State, payload: Payload) => Promise<State> {
  return async (state, payload) => {
    const next = await action(state, payload);
    return { ...next, savedAt: next.savedAt ?? state.savedAt };
  };
}

/**
 * onSubmit for a useActionState form with fields worth keeping: a form `action`
 * resets every field once it returns, which would wipe the draft behind a failed
 * save. Leave `action` on the form too, for a submit before hydration.
 */
export function submitKeepingDraft(action: (data: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => action(data));
  };
}
