// Minimal PNG chunk surgery: stamp a print resolution (pHYs) and a text chunk
// into a PNG the browser produced, and read the text back. Lets an exported
// image carry the lab settings that made it.

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function* chunks(png: Uint8Array) {
  let off = 8;
  while (off + 12 <= png.length) {
    const dv = new DataView(png.buffer, png.byteOffset + off);
    const len = dv.getUint32(0);
    const type = String.fromCharCode(...png.subarray(off + 4, off + 8));
    yield { off, type, data: png.subarray(off + 8, off + 8 + len) };
    off += 12 + len;
  }
}

function isPng(png: Uint8Array) {
  return SIG.every((b, i) => png[i] === b);
}

// Returns a copy with pHYs (dots per inch) and a tEXt chunk inserted after
// IHDR. Text must be Latin-1; JSON of ASCII settings is.
export function stampPng(
  png: Uint8Array,
  opts: { dpi?: number; text?: { key: string; value: string } },
): Uint8Array {
  if (!isPng(png)) throw new Error("not a PNG");
  const extra: Uint8Array[] = [];
  if (opts.dpi) {
    const d = new Uint8Array(9);
    const ppm = Math.round(opts.dpi / 0.0254);
    new DataView(d.buffer).setUint32(0, ppm);
    new DataView(d.buffer).setUint32(4, ppm);
    d[8] = 1;
    extra.push(chunk("pHYs", d));
  }
  if (opts.text) {
    const { key, value } = opts.text;
    const bytes = new Uint8Array(key.length + 1 + value.length);
    for (let i = 0; i < key.length; i++) bytes[i] = key.charCodeAt(i);
    for (let i = 0; i < value.length; i++)
      bytes[key.length + 1 + i] = value.charCodeAt(i) & 0xff;
    extra.push(chunk("tEXt", bytes));
  }
  // drop any earlier copies of what we're adding
  const keep: Uint8Array[] = [];
  for (const c of chunks(png)) {
    const whole = png.subarray(c.off, c.off + 12 + c.data.length);
    if (c.type === "IHDR") {
      keep.push(whole);
      continue;
    }
    if (opts.dpi && c.type === "pHYs") continue;
    if (opts.text && c.type === "tEXt" && textKey(c.data) === opts.text.key)
      continue;
    keep.push(whole);
  }
  const parts = [png.subarray(0, 8), keep[0], ...extra, ...keep.slice(1)];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function textKey(data: Uint8Array) {
  const nul = data.indexOf(0);
  return String.fromCharCode(...data.subarray(0, nul < 0 ? data.length : nul));
}

export function readPngText(png: Uint8Array, key: string): string | null {
  if (!isPng(png)) return null;
  for (const c of chunks(png)) {
    if (c.type !== "tEXt" || textKey(c.data) !== key) continue;
    const nul = c.data.indexOf(0);
    let s = "";
    for (const b of c.data.subarray(nul + 1)) s += String.fromCharCode(b);
    return s;
  }
  return null;
}
