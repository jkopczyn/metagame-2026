import { describe, expect, it } from "vitest";
import {
  createAccountStatusStore,
  parseAccountStatus,
  STALE_AFTER_MS,
  type AccountStatus,
} from "./account-status-store";

const signedIn = (userId = "u1"): AccountStatus => ({
  signedIn: true,
  admin: false,
  userId,
});
const signedOut: AccountStatus = {
  signedIn: false,
  admin: false,
  userId: null,
};

function setup(answer: () => Promise<AccountStatus | null>) {
  let clock = 1_000;
  const state = { asks: 0 };
  const store = createAccountStatusStore(
    () => {
      state.asks++;
      return answer();
    },
    () => clock,
  );
  return {
    store,
    state,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}
const flush = () => new Promise((resolve) => setTimeout(resolve));

describe("account status store", () => {
  it("asks once however many readers and navigations", async () => {
    const { store, state } = setup(async () => signedIn());
    store.subscribe(() => {});
    store.subscribe(() => {});
    store.navigated("/");
    store.navigated("/");
    await flush();
    for (const path of ["/schedule", "/team", "/sponsor"])
      store.navigated(path);
    await flush();
    expect(state.asks).toBe(1);
    expect(store.getSnapshot()).toEqual(signedIn());
  });

  it("asks again once the answer is old", async () => {
    const { store, state, advance } = setup(async () => signedIn());
    store.navigated("/");
    await flush();
    advance(STALE_AFTER_MS - 1);
    store.navigated("/team");
    expect(state.asks).toBe(1);
    advance(1);
    store.navigated("/sponsor");
    expect(state.asks).toBe(2);
  });

  it("sees a sign-in: leaving /login asks again", async () => {
    let answer = signedOut;
    const { store } = setup(async () => answer);
    store.navigated("/login");
    await flush();
    expect(store.getSnapshot()).toEqual(signedOut);
    answer = signedIn();
    store.navigated("/schedule");
    await flush();
    expect(store.getSnapshot()).toEqual(signedIn());
  });

  it("sees a sign-out by server redirect: leaving /account asks again", async () => {
    let answer = signedIn();
    const { store } = setup(async () => answer);
    store.navigated("/");
    await flush();
    store.navigated("/account");
    await flush();
    answer = signedOut;
    store.navigated("/");
    await flush();
    expect(store.getSnapshot()).toEqual(signedOut);
  });

  it("sees a backstage sign-out: its redirect to the tool root asks again", async () => {
    let answer = signedIn();
    const { store } = setup(async () => answer);
    store.subscribe(() => {});
    store.navigated("/backstage/users/u1");
    await flush();
    answer = signedOut;
    store.navigated("/backstage/users");
    await flush();
    expect(store.getSnapshot()).toEqual(signedOut);
  });

  it("asks again when the first reader returns after none were mounted", async () => {
    const { store, state } = setup(async () => signedIn());
    const leave = store.subscribe(() => {});
    store.navigated("/");
    await flush();
    leave();
    store.navigated("/");
    store.subscribe(() => {});
    expect(state.asks).toBe(2);
  });

  it("asks once on a first mount, whichever effect runs first", async () => {
    const navigatedFirst = setup(async () => signedIn());
    navigatedFirst.store.navigated("/");
    navigatedFirst.store.subscribe(() => {});
    expect(navigatedFirst.state.asks).toBe(1);
    const subscribedFirst = setup(async () => signedIn());
    subscribedFirst.store.subscribe(() => {});
    subscribedFirst.store.navigated("/");
    expect(subscribedFirst.state.asks).toBe(1);
  });

  it("lets refresh overtake an answer already on its way", async () => {
    const pending: ((a: AccountStatus) => void)[] = [];
    const { store } = setup(
      () => new Promise((resolve) => pending.push(resolve)),
    );
    store.navigated("/");
    store.refresh();
    pending[1](signedOut);
    pending[0](signedIn());
    await flush();
    expect(store.getSnapshot()).toEqual(signedOut);
  });

  it("keeps the last answer through a failure, and retries next navigation", async () => {
    let fail = false;
    const { store, state } = setup(async () => {
      if (fail) throw new Error("offline");
      return signedIn();
    });
    store.navigated("/");
    await flush();
    fail = true;
    store.refresh();
    await flush();
    expect(store.getSnapshot()).toEqual(signedIn());
    fail = false;
    store.navigated("/team");
    await flush();
    expect(state.asks).toBe(3);
  });

  it("treats a bad response as signed out only until a real answer", async () => {
    let answer: AccountStatus | null = null;
    const { store } = setup(async () => answer);
    store.navigated("/");
    await flush();
    expect(store.getSnapshot()).toEqual(signedOut);
    answer = signedIn();
    store.navigated("/team");
    await flush();
    expect(store.getSnapshot()).toEqual(signedIn());
    answer = null;
    store.refresh();
    await flush();
    expect(store.getSnapshot()).toEqual(signedIn());
  });

  it("notifies only on a change, so readers keep a stable snapshot", async () => {
    let notified = 0;
    const { store } = setup(async () => signedIn());
    store.subscribe(() => notified++);
    store.navigated("/");
    await flush();
    const first = store.getSnapshot();
    store.refresh();
    await flush();
    expect(notified).toBe(1);
    expect(store.getSnapshot()).toBe(first);
  });
});

describe("parseAccountStatus", () => {
  it("reads anything else as signed out", () => {
    expect(parseAccountStatus({})).toEqual(signedOut);
    expect(parseAccountStatus(null)).toEqual(signedOut);
    expect(parseAccountStatus({ signedIn: "yes", userId: 7 })).toEqual(
      signedOut,
    );
  });
});
