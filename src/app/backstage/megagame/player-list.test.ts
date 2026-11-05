import { describe, expect, it } from "vitest";
import {
  MAX_LIST,
  listQueue,
  parsePlayerIds,
  withPlayer,
  withoutPlayer,
} from "./player-list";

describe("player list in the URL", () => {
  it("parses a comma list, dropping blanks and repeats", () => {
    expect(parsePlayerIds("u1,,u2,u1")).toEqual(["u1", "u2"]);
    expect(parsePlayerIds(undefined)).toEqual([]);
    expect(parsePlayerIds(["u1,u2", "u3"])).toEqual(["u1", "u2"]);
  });

  it("caps the list length", () => {
    const many = Array.from({ length: MAX_LIST + 5 }, (_, i) => `u${i}`);
    expect(parsePlayerIds(many.join(","))).toHaveLength(MAX_LIST);
  });

  it("adds at the end once and removes by id", () => {
    expect(withPlayer(["u1"], "u2")).toEqual(["u1", "u2"]);
    expect(withPlayer(["u1", "u2"], "u1")).toEqual(["u1", "u2"]);
    expect(withoutPlayer(["u1", "u2"], "u1")).toEqual(["u2"]);
  });
});

describe("listQueue", () => {
  it("builds on adds the URL has not caught up with yet", () => {
    const queue = listQueue();
    expect(queue.add(["a"], "b")).toEqual(["a", "b"]);
    expect(queue.add(["a"], "c")).toEqual(["a", "b", "c"]);
  });

  it("reports the queued list until navigation settles", () => {
    const queue = listQueue();
    expect(queue.current(["a"])).toEqual(["a"]);
    queue.add(["a"], "b");
    expect(queue.current(["a"])).toEqual(["a", "b"]);
    queue.settle();
    expect(queue.current(["a", "b"])).toEqual(["a", "b"]);
  });

  it("goes back to the URL's list once navigation settles", () => {
    const queue = listQueue();
    queue.add(["a"], "b");
    queue.settle();
    expect(queue.add(["x"], "y")).toEqual(["x", "y"]);
  });

  it("does not add a player twice", () => {
    const queue = listQueue();
    queue.add([], "a");
    expect(queue.add([], "a")).toEqual(["a"]);
  });
});
