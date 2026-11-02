import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { readPngText, stampPng } from "./pngMeta";

// A 1×1 grey PNG built by hand: signature, IHDR, IDAT, IEND.
function tinyPng(): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Uint8Array) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: number[]) => {
    const td = new Uint8Array([...type].map((ch) => ch.charCodeAt(0)));
    const body = new Uint8Array([...td, ...data]);
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, data.length);
    const c = new Uint8Array(4);
    new DataView(c.buffer).setUint32(0, crc(body));
    return [...len, ...body, ...c];
  };
  const idat = [...deflateSync(Buffer.from([0, 128]))];
  return new Uint8Array([
    137,
    80,
    78,
    71,
    13,
    10,
    26,
    10,
    ...chunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0]),
    ...chunk("IDAT", idat),
    ...chunk("IEND", []),
  ]);
}

describe("pngMeta", () => {
  it("round-trips a text chunk and keeps the image chunks in order", () => {
    const out = stampPng(tinyPng(), {
      dpi: 300,
      text: { key: "dice-lab", value: '{"a":1}' },
    });
    expect(readPngText(out, "dice-lab")).toBe('{"a":1}');
    const types: string[] = [];
    let off = 8;
    while (off < out.length) {
      const len = new DataView(out.buffer, off).getUint32(0);
      types.push(String.fromCharCode(...out.subarray(off + 4, off + 8)));
      off += 12 + len;
    }
    expect(types).toEqual(["IHDR", "pHYs", "tEXt", "IDAT", "IEND"]);
  });

  it("replaces an existing stamp instead of adding a second", () => {
    const once = stampPng(tinyPng(), { text: { key: "k", value: "1" } });
    const twice = stampPng(once, { text: { key: "k", value: "2" } });
    expect(readPngText(twice, "k")).toBe("2");
    expect(twice.length).toBe(once.length);
  });

  it("writes 300 dpi as pixels per metre", () => {
    const out = stampPng(tinyPng(), { dpi: 300 });
    const phys = out.indexOf(0x70); // 'p' of pHYs
    const dv = new DataView(out.buffer, phys + 4);
    expect(dv.getUint32(0)).toBe(11811);
    expect(out[phys + 12]).toBe(1);
  });

  it("returns null for something that isn't a PNG", () => {
    expect(readPngText(new Uint8Array([1, 2, 3]), "k")).toBeNull();
  });
});
