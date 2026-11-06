import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  BundleError,
  parseBundle,
  parseManifest,
  readZip,
  resolve,
  titleKey,
} from "./quest-bundle";

const owl = {
  title: "Hoot & Seek",
  body: "First.\r\n\r\nSecond.",
  body_images: ["images/owl.png"],
  requirements: { min_people: 6, levels: { wizard: 4 } },
  rewards: { wizard: 2, any: 1 },
  solution: "AVIANNA",
  solution_images: ["images/a.jpg", "images/b.jpg"],
  hint: "Nocturnal.",
  submitted_by: "Tobias",
  source: "2025 form",
  finalized: false,
};

const files = (names: string[]) =>
  new Map(names.map((n) => [n, new Uint8Array()]));

describe("parseManifest", () => {
  it("maps quest_panic's fields onto a quest and keeps the first solution image", () => {
    const { entries, problems } = parseManifest({ quests: [owl] }, (ref) =>
      ref.startsWith("images/") ? `bundle/${ref}` : null,
    );
    expect(problems).toEqual([]);
    expect(entries).toHaveLength(1);
    const [e] = entries;
    expect(e.input).toMatchObject({
      title: "Hoot & Seek",
      bodyText: "First.\n\nSecond.",
      class: "wizard",
      minLevel: 4,
      maxLevel: null,
      minPlayers: 6,
      stamps: { wizard: 2, pirate: 0, alien: 0, any: 1 },
      evidence: "AVIANNA",
      hint: "Nocturnal.",
      author: "Tobias",
      active: false,
    });
    expect(e.bodyImages).toEqual(["bundle/images/owl.png"]);
    expect(e.evidenceImage).toBe("bundle/images/a.jpg");
    expect(e.warnings).toEqual([
      "solution_images: only the first of 2 is kept as the evidence image",
    ]);
  });

  it("accepts a bare array and this site's own field names", () => {
    const { entries } = parseManifest([
      {
        title: "Own",
        bodyText: "x",
        class: "Alien",
        minLevel: 2,
        maxLevel: 3,
        stamps: { alien: 1 },
      },
    ]);
    expect(entries[0].input).toMatchObject({
      class: "alien",
      minLevel: 2,
      maxLevel: 3,
      active: true,
      stamps: { alien: 1 },
    });
  });

  it("refuses several class levels, since a quest here has one class", () => {
    const { entries, problems } = parseManifest({
      quests: [{ ...owl, requirements: { levels: { wizard: 4, pirate: 3 } } }],
    });
    expect(entries).toEqual([]);
    expect(problems[0].error).toContain("2 classes listed");
  });

  it("lists missing images and bad entries without dropping the good ones", () => {
    const { entries, problems } = parseManifest(
      { quests: [{ title: "Fine" }, { ...owl, title: "" }, "nope"] },
      () => null,
    );
    expect(entries.map((e) => e.title)).toEqual(["Fine"]);
    expect(problems).toEqual([
      {
        index: 1,
        title: "",
        error:
          "image file(s) not in bundle: images/owl.png, images/a.jpg; title: required",
      },
      { index: 2, title: "", error: "entry: not an object" },
    ]);
  });

  it("wants a list of quests", () => {
    expect(() => parseManifest({ nope: 1 })).toThrow(BundleError);
  });
});

describe("parseBundle", () => {
  it("finds the shallowest quests.json and resolves images beside it", () => {
    const zip = files([
      "__MACOSX/quests.json",
      "deep/er/quests.json",
      "bundle/quests.json",
      "bundle/images/owl.png",
      "bundle/images/a.jpg",
    ]);
    zip.set(
      "bundle/quests.json",
      new TextEncoder().encode("﻿" + JSON.stringify({ quests: [owl] })),
    );
    const { entries, problems } = parseBundle(zip);
    expect(problems).toEqual([]);
    expect(entries[0].bodyImages).toEqual(["bundle/images/owl.png"]);
  });

  it("says when there is no manifest", () => {
    expect(() => parseBundle(files(["images/a.png"]))).toThrow(
      "No quests.json",
    );
  });
});

describe("resolve", () => {
  it("joins relative paths inside the zip and refuses escapes", () => {
    expect(resolve("bundle/", "images/owl.png")).toBe("bundle/images/owl.png");
    expect(resolve("bundle/", "./images\\owl.png")).toBe(
      "bundle/images/owl.png",
    );
    expect(resolve("a/b/", "../x.png")).toBe("a/x.png");
    expect(resolve("", "../x.png")).toBeNull();
    expect(resolve("", "/x.png")).toBeNull();
  });
});

describe("titleKey", () => {
  it("ignores case, punctuation and spacing", () => {
    expect(titleKey("Hoot & Seek!")).toBe("hoot seek");
    expect(titleKey("  hoot-seek ")).toBe("hoot seek");
  });
});

// A minimal zip writer, enough for readZip: local headers, central
// directory, end record. Mirrors what any archiver produces.
function zipOf(
  entries: { name: string; data: Uint8Array; deflate?: boolean }[],
) {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
  const u32 = (n: number) => [...u16(n & 0xffff), ...u16((n >>> 16) & 0xffff)];
  for (const e of entries) {
    const name = new TextEncoder().encode(e.name);
    const body = e.deflate ? new Uint8Array(deflateRawSync(e.data)) : e.data;
    const method = e.deflate ? 8 : 0;
    const local = new Uint8Array([
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(0),
      ...u16(method),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(body.length),
      ...u32(e.data.length),
      ...u16(name.length),
      ...u16(0),
      ...name,
    ]);
    central.push(
      new Uint8Array([
        ...u32(0x02014b50),
        ...u16(20),
        ...u16(20),
        ...u16(0),
        ...u16(method),
        ...u16(0),
        ...u16(0),
        ...u32(0),
        ...u32(body.length),
        ...u32(e.data.length),
        ...u16(name.length),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u32(0),
        ...u32(offset),
        ...name,
      ]),
    );
    parts.push(local, body);
    offset += local.length + body.length;
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array([
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(entries.length),
    ...u16(entries.length),
    ...u32(centralSize),
    ...u32(offset),
    ...u16(0),
  ]);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out.buffer;
}

describe("readZip", () => {
  it("reads stored and deflated files, skipping folders", async () => {
    const text = new TextEncoder().encode(JSON.stringify({ quests: [] }));
    const zip = zipOf([
      { name: "bundle/", data: new Uint8Array() },
      { name: "bundle/quests.json", data: text, deflate: true },
      { name: "bundle/images/a.png", data: new Uint8Array([1, 2, 3]) },
    ]);
    const files = await readZip(zip);
    expect([...files.keys()]).toEqual([
      "bundle/quests.json",
      "bundle/images/a.png",
    ]);
    expect(new TextDecoder().decode(files.get("bundle/quests.json"))).toBe(
      JSON.stringify({ quests: [] }),
    );
    expect([...files.get("bundle/images/a.png")!]).toEqual([1, 2, 3]);
  });

  it("rejects something that is not a zip", async () => {
    await expect(readZip(new Uint8Array(40).buffer)).rejects.toThrow(
      "not a .zip",
    );
  });
});
