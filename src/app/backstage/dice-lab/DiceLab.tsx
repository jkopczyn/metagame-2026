"use client";

import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  FACE_NAMES,
  LETTERS,
  PIP_VALUES,
  PRESETS,
  cloneSpec,
  heroDie,
  type DieSpec,
  type Face,
} from "./labDice";
import {
  DEFAULT_LAYOUT,
  DEFAULT_SHADOW,
  newSeed,
  type DropShadow,
  type Layout,
  type Show,
} from "./labLayout";
import { DEFAULT_THROW, type ThrowFrom, type ThrowParams } from "./labPhysics";
import type { ExportOpts, StageHandle } from "./LabStage";
import type { SavedPose, SettleMode } from "./labRig";
import { readPngText, stampPng } from "./pngMeta";

// WebGL only renders in the browser; keep three out of the server render.
const LabStage = dynamic(() => import("./LabStage"), { ssr: false });

const STORAGE_KEY = "dice-lab:v1";
const MAX_DICE = 12;
const EXPORT_WIDTHS = [1024, 2048, 4096, 8192];
const ROT_STEPS = [1, 5, 15, 45, 90];

type Saved = {
  dice: DieSpec[];
  layout: Layout;
  throwParams: ThrowParams;
  ortho: boolean;
  fov: number;
  shadows: boolean;
  shadow: DropShadow;
  grid: boolean;
  settle: SettleMode;
  keepOrder: boolean;
  exportW: number;
  crop: boolean;
  pad: number;
  poses: SavedPose[] | null;
};
const DEFAULTS: Saved = {
  dice: PRESETS[0].dice,
  layout: DEFAULT_LAYOUT,
  throwParams: DEFAULT_THROW,
  ortho: false,
  fov: 7,
  shadows: true,
  shadow: DEFAULT_SHADOW,
  grid: true,
  settle: "upright-blue",
  keepOrder: true,
  exportW: 4096,
  crop: true,
  pad: 64,
  poses: null,
};

// Fills in anything a saved blob (localStorage, settings file, stamped PNG)
// is missing, so older saves keep working as fields are added.
function normalize(s: Partial<Saved> & { autoSquare?: boolean }): Saved {
  // older saves had a boolean square-up toggle
  if (s.autoSquare !== undefined && s.settle === undefined)
    s.settle = s.autoSquare ? "square" : "none";
  return {
    ...DEFAULTS,
    ...s,
    // dice saved before the Arrange layout have no `show`
    dice: (s.dice ?? DEFAULTS.dice).map((d) => ({
      ...d,
      show: d.show ?? "front",
    })),
    layout: { ...DEFAULT_LAYOUT, ...(s.layout ?? {}) },
    shadow: { ...DEFAULT_SHADOW, ...(s.shadow ?? {}) },
    throwParams: { ...DEFAULT_THROW, ...(s.throwParams ?? {}) },
    poses: s.poses ?? null,
  };
}

function load(): Saved {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalize(JSON.parse(raw)) : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

// Settings embedded in an exported PNG live under this tEXt key.
const PNG_KEY = "dice-lab";
const PRINT_DPI = 300;

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const fileStamp = () =>
  new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

export default function DiceLab() {
  // Client-only component (see DiceLabLoader), so localStorage is safe here.
  const [s, setS] = useState<Saved>(load);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch {
      // private mode / quota: the session just won't persist
    }
  }, [s]);
  const set = <K extends keyof Saved>(k: K, v: Saved[K]) =>
    setS((prev) => ({ ...prev, [k]: v }));
  // The stage reports poses whenever the dice come to rest, so hand-dragged
  // and nudged positions survive a reload too.
  const onPoses = useCallback(
    (poses: SavedPose[]) => setS((prev) => ({ ...prev, poses })),
    [],
  );

  const stage = useRef<StageHandle | null>(null);
  const onHandle = useCallback((h: StageHandle) => {
    stage.current = h;
  }, []);

  const [selected, setSelected] = useState<number | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [rotStep, setRotStep] = useState(15);
  // the crop outline shows only while the padding slider is in use
  const [padActive, setPadActive] = useState(false);

  const roll = useCallback(async () => {
    if (!stage.current || busy) return;
    setBusy(true);
    setStatus("rolling…");
    try {
      await stage.current.roll(s.throwParams);
      setStatus("settled");
    } catch (e) {
      setStatus(`roll failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [s.throwParams, busy]);

  // Everything needed to recreate the current picture, die positions included.
  const snapshot = useCallback(
    (): Saved => ({ ...s, poses: stage.current?.getPoses() ?? null }),
    [s],
  );

  const exportPng = useCallback(async () => {
    if (!stage.current) return;
    setStatus("rendering…");
    try {
      const opts: ExportOpts = { width: s.exportW, crop: s.crop, pad: s.pad };
      const raw = await stage.current.exportPng(opts);
      const png = stampPng(new Uint8Array(await raw.arrayBuffer()), {
        dpi: PRINT_DPI,
        text: { key: PNG_KEY, value: JSON.stringify(snapshot()) },
      });
      const name = `dice-${fileStamp()}.png`;
      download(
        new Blob([png.buffer as ArrayBuffer], { type: "image/png" }),
        name,
      );
      setStatus(`saved ${name} (${(png.length / 1024 / 1024).toFixed(1)} MB)`);
    } catch (e) {
      setStatus(`export failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [s.exportW, s.crop, s.pad, snapshot]);

  const exportSvg = () => {
    if (!stage.current) return;
    try {
      const svg = stage.current.exportSvg({ width: s.exportW, pad: s.pad });
      const name = `dice-${fileStamp()}.svg`;
      download(new Blob([svg], { type: "image/svg+xml" }), name);
      setStatus(`saved ${name} (${(svg.length / 1024).toFixed(0)} KB)`);
    } catch (e) {
      setStatus(`export failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const saveSettings = () => {
    const name = `dice-lab-${fileStamp()}.json`;
    download(
      new Blob([JSON.stringify(snapshot(), null, 2)], {
        type: "application/json",
      }),
      name,
    );
    setStatus(`saved ${name}`);
  };

  // A settings .json, or a PNG this lab exported (settings ride inside it).
  const loadSettings = async (file: File) => {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const text =
        readPngText(bytes, PNG_KEY) ?? new TextDecoder().decode(bytes);
      setS(normalize(JSON.parse(text)));
      setSelected(null);
      setStatus(`loaded ${file.name}`);
    } catch (e) {
      setStatus(`load failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const sh = s.shadow;
  const setSh = <K extends keyof DropShadow>(k: K, v: DropShadow[K]) =>
    set("shadow", { ...sh, [k]: v });
  const lay = s.layout;
  const setLay = <K extends keyof Layout>(k: K, v: Layout[K]) =>
    set("layout", { ...lay, [k]: v });
  const shuffle = useCallback(() => {
    setS((prev) => ({
      ...prev,
      layout: { ...prev.layout, seed: newSeed() },
    }));
  }, []);

  // R rolls, E exports, S shuffles, Esc deselects — unless typing in a field.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target;
      if (
        t instanceof HTMLElement &&
        (t.tagName === "INPUT" ||
          t.tagName === "SELECT" ||
          t.tagName === "TEXTAREA")
      )
        return;
      if (ev.key === "r" || ev.key === "R") roll();
      else if (ev.key === "e" || ev.key === "E") exportPng();
      else if (ev.key === "s" || ev.key === "S") shuffle();
      else if (ev.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [roll, exportPng, shuffle]);

  const updateDie = (i: number, fn: (d: DieSpec) => DieSpec) =>
    set(
      "dice",
      s.dice.map((d, j) => (j === i ? fn(cloneSpec(d)) : d)),
    );
  const setFace = (i: number, f: number, face: Face) =>
    updateDie(i, (d) => {
      d.faces[f] = face;
      return d;
    });
  const addDie = () => {
    if (s.dice.length >= MAX_DICE) return;
    const last = s.dice[s.dice.length - 1];
    set("dice", [...s.dice, last ? cloneSpec(last) : heroDie("M", "G", 2)]);
  };
  const removeDie = (i: number) => {
    if (s.dice.length <= 1) return;
    set(
      "dice",
      s.dice.filter((_, j) => j !== i),
    );
    setSelected(null);
  };

  const tp = s.throwParams;
  const setTp = <K extends keyof ThrowParams>(k: K, v: ThrowParams[K]) =>
    set("throwParams", { ...tp, [k]: v });

  const sel = selected !== null ? s.dice[selected] : undefined;
  // Which preset the current dice match, so the dropdown shows what's loaded
  // rather than a permanent "Load…".
  const diceJson = JSON.stringify(s.dice);
  const activePreset =
    PRESETS.find((p) => JSON.stringify(p.dice) === diceJson)?.name ?? "";

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] w-full bg-neutral-950 font-[family-name:var(--font-inter)] text-sm text-neutral-200">
      <aside className="flex w-[340px] shrink-0 flex-col gap-5 overflow-y-auto border-r border-neutral-800 p-4">
        <header>
          <h1 className="font-[family-name:var(--font-bebas)] text-3xl tracking-wide text-white">
            Dice lab
          </h1>
          <p className="text-xs text-neutral-400">
            Arrange (or roll) the hero dice and export them as transparent PNGs.
            Drag a die to move it; orbit with the mouse (left drag rotates,
            right drag pans, wheel zooms). Keys: <kbd>S</kbd> shuffle ·{" "}
            <kbd>R</kbd> roll · <kbd>E</kbd> export.
          </p>
        </header>

        <Section title="Dice">
          <Row label="Preset">
            <select
              className={INPUT}
              value={activePreset}
              onChange={(e) => {
                const p = PRESETS.find((x) => x.name === e.target.value);
                if (p) {
                  set("dice", p.dice.map(cloneSpec));
                  setSelected(null);
                  stage.current?.arrange();
                }
              }}
            >
              {activePreset === "" && <option value="">custom (edited)</option>}
              {PRESETS.map((p) => (
                <option key={p.name}>{p.name}</option>
              ))}
            </select>
          </Row>
          <div className="flex flex-wrap items-center gap-1">
            {s.dice.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setSelected(selected === i ? null : i)}
                className={`h-7 w-7 rounded border text-xs ${
                  selected === i
                    ? "border-sky-400 bg-sky-400/20 text-white"
                    : "border-neutral-700 hover:border-neutral-500"
                }`}
              >
                {i + 1}
              </button>
            ))}
            <button
              type="button"
              onClick={addDie}
              disabled={s.dice.length >= MAX_DICE}
              className={`${BTN} h-7 w-7 px-0`}
              title="Add a die"
            >
              +
            </button>
          </div>
          {sel && selected !== null ? (
            <div className="flex flex-col gap-2 rounded border border-neutral-800 p-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-neutral-300">
                  Die {selected + 1} faces
                </span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    className={BTN}
                    title="Copy front → back and right → left, like the hero dice"
                    onClick={() =>
                      updateDie(selected, (d) => {
                        d.faces[1] = { ...d.faces[0] };
                        d.faces[3] = { ...d.faces[2] };
                        return d;
                      })
                    }
                  >
                    mirror
                  </button>
                  <button
                    type="button"
                    className={BTN}
                    disabled={s.dice.length <= 1}
                    onClick={() => removeDie(selected)}
                  >
                    remove
                  </button>
                </div>
              </div>
              {sel.faces.map((face, f) => (
                <FaceEditor
                  key={f}
                  name={FACE_NAMES[f]}
                  face={face}
                  onChange={(nf) => setFace(selected, f, nf)}
                />
              ))}
              <Row label="Shows">
                <select
                  className={INPUT}
                  value={sel.show}
                  title="Which letter face the Arrange layout points at the camera"
                  onChange={(e) =>
                    updateDie(selected, (d) => {
                      d.show = e.target.value as Show;
                      return d;
                    })
                  }
                >
                  <option value="front">front letter</option>
                  <option value="right">right letter</option>
                </select>
              </Row>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-xs text-neutral-400">Rotate die</span>
                <select
                  className={`${INPUT} max-w-24 flex-none`}
                  value={rotStep}
                  onChange={(e) => setRotStep(Number(e.target.value))}
                  title="Step size"
                >
                  {ROT_STEPS.map((deg) => (
                    <option key={deg} value={deg}>
                      {deg}°
                    </option>
                  ))}
                </select>
              </div>
              {(
                [
                  ["x", "pitch (tip forward / back)"],
                  ["y", "yaw (spin on the table)"],
                  ["z", "roll (tip left / right)"],
                ] as const
              ).map(([axis, hint]) => (
                <div key={axis} className="flex items-center gap-1">
                  <span className="w-3 text-xs text-neutral-500 uppercase">
                    {axis}
                  </span>
                  <span className="flex-1 truncate text-xs text-neutral-500">
                    {hint}
                  </span>
                  <button
                    type="button"
                    className={`${BTN} w-12`}
                    onClick={() =>
                      stage.current?.rotateDie(selected, axis, -rotStep)
                    }
                  >
                    −{rotStep}
                  </button>
                  <button
                    type="button"
                    className={`${BTN} w-12`}
                    onClick={() =>
                      stage.current?.rotateDie(selected, axis, rotStep)
                    }
                  >
                    +{rotStep}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-neutral-500">
              Click a die (on the canvas or above) to edit its faces or rotate
              it.
            </p>
          )}
        </Section>

        <Section title="Arrange">
          <p className="text-xs text-neutral-500">
            Dice in rows, each showing its letter, nudged by up to these
            amounts. Shuffle re-rolls the nudges; the seed brings a variant
            back.
          </p>
          <Slider
            label="Per row"
            v={lay.perRow}
            min={0}
            max={MAX_DICE}
            step={1}
            onChange={(v) => setLay("perRow", v)}
          />
          <Slider
            label="Spacing"
            v={lay.gap}
            min={0.9}
            max={3}
            step={0.05}
            onChange={(v) => setLay("gap", v)}
          />
          <Slider
            label="Row gap"
            v={lay.rowGap}
            min={0.9}
            max={3}
            step={0.05}
            onChange={(v) => setLay("rowGap", v)}
          />
          <Slider
            label="Yaw ±°"
            v={lay.yaw}
            min={0}
            max={60}
            step={1}
            onChange={(v) => setLay("yaw", v)}
          />
          <Slider
            label="Tilt ±°"
            v={lay.tilt}
            min={0}
            max={60}
            step={1}
            onChange={(v) => setLay("tilt", v)}
          />
          <Slider
            label="Lean °"
            v={lay.lean}
            min={-45}
            max={45}
            step={1}
            onChange={(v) => setLay("lean", v)}
          />
          <Slider
            label="Spin ±°"
            v={lay.spin}
            min={0}
            max={60}
            step={1}
            onChange={(v) => setLay("spin", v)}
          />
          <Slider
            label="Scatter"
            v={lay.scatter}
            min={0}
            max={0.5}
            step={0.01}
            onChange={(v) => setLay("scatter", v)}
          />
          <Slider
            label="Depth"
            v={lay.depth}
            min={0}
            max={2}
            step={0.05}
            onChange={(v) => setLay("depth", v)}
          />
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={shuffle}
              className={`${BTN_PRIMARY} flex-1`}
            >
              Shuffle (S)
            </button>
            <span className="text-xs text-neutral-400">seed</span>
            <input
              type="number"
              className={`${INPUT} w-24 flex-none`}
              value={lay.seed}
              onChange={(e) => setLay("seed", Number(e.target.value) || 0)}
            />
          </div>
        </Section>

        <Section title="Roll" collapsed>
          <Row label="From">
            <select
              className={INPUT}
              value={tp.from}
              onChange={(e) => setTp("from", e.target.value as ThrowFrom)}
            >
              <option value="left">left edge</option>
              <option value="right">right edge</option>
              <option value="drop">drop from above</option>
              <option value="scatter">scatter from center</option>
            </select>
          </Row>
          <Slider
            label="Speed"
            v={tp.speed}
            min={0.2}
            max={3}
            step={0.1}
            onChange={(v) => setTp("speed", v)}
          />
          <Slider
            label="Spin"
            v={tp.spin}
            min={0}
            max={3}
            step={0.1}
            onChange={(v) => setTp("spin", v)}
          />
          <Slider
            label="Height"
            v={tp.height}
            min={0.6}
            max={6}
            step={0.1}
            onChange={(v) => setTp("height", v)}
          />
          <Slider
            label="Bounce"
            v={tp.bounce}
            min={0}
            max={2}
            step={0.1}
            onChange={(v) => setTp("bounce", v)}
          />
          <Slider
            label="Arena W"
            v={tp.arenaW}
            min={2}
            max={20}
            step={0.5}
            onChange={(v) => setTp("arenaW", v)}
          />
          <Slider
            label="Arena D"
            v={tp.arenaD}
            min={2}
            max={12}
            step={0.5}
            onChange={(v) => setTp("arenaD", v)}
          />
          <Row label="On settle">
            <select
              className={INPUT}
              value={s.settle}
              onChange={(e) => set("settle", e.target.value as SettleMode)}
            >
              <option value="none">leave as rolled</option>
              <option value="square">square up (faces flat)</option>
              <option value="upright">letters upright, keep yaw</option>
              <option value="upright-blue">
                letters upright, blue letters facing you
              </option>
              <option value="upright-orange">
                letters upright, orange letters facing you
              </option>
            </select>
          </Row>
          <Check
            label="Keep reading order (die 1 lands leftmost)"
            v={s.keepOrder}
            onChange={(v) => set("keepOrder", v)}
          />
          <div className="flex gap-1">
            <button
              type="button"
              onClick={roll}
              disabled={busy}
              className={`${BTN_PRIMARY} flex-1`}
            >
              {busy ? "Rolling…" : "Roll (R)"}
            </button>
            <button
              type="button"
              className={BTN}
              title="Snap every die to its nearest flat orientation"
              onClick={() => stage.current?.squareUp()}
            >
              square
            </button>
            <button
              type="button"
              className={BTN}
              title="Stand every die on its pip face so the letters read upright, facing per the On settle choice"
              onClick={() =>
                stage.current?.upright(
                  s.settle === "upright-blue"
                    ? "blue"
                    : s.settle === "upright-orange"
                      ? "orange"
                      : undefined,
                )
              }
            >
              upright
            </button>
            <button
              type="button"
              className={BTN}
              title="Swap landing spots so die 1 is leftmost, die 2 next, and so on"
              onClick={() => stage.current?.reorder()}
            >
              reorder
            </button>
            <button
              type="button"
              className={BTN}
              title="Back to the Arrange layout"
              onClick={() => stage.current?.arrange()}
            >
              arrange
            </button>
          </div>
        </Section>

        <Section title="Camera & look">
          <Check
            label="Orthographic"
            v={s.ortho}
            onChange={(v) => set("ortho", v)}
          />
          <Slider
            label="FOV"
            v={s.fov}
            min={3}
            max={40}
            step={0.5}
            onChange={(v) => set("fov", v)}
          />
          <Check
            label="Dice cast shadows on each other"
            v={s.shadows}
            onChange={(v) => set("shadows", v)}
          />
          <Check
            label="Show grid / arena (never exported)"
            v={s.grid}
            onChange={(v) => set("grid", v)}
          />
          <div className="flex gap-1">
            <button
              type="button"
              className={`${BTN} flex-1`}
              title="Straight on, no downward angle"
              onClick={() => stage.current?.resetCamera("front")}
            >
              front view
            </button>
            <button
              type="button"
              className={`${BTN} flex-1`}
              title="The hero's slight from-above angle"
              onClick={() => stage.current?.resetCamera("default")}
            >
              hero view
            </button>
          </div>
        </Section>

        <Section title="Drop shadow">
          <Check
            label="Soft shadow behind each die (exported)"
            v={sh.on}
            onChange={(v) => setSh("on", v)}
          />
          <Slider
            label="Right"
            v={sh.dx}
            min={-1}
            max={1}
            step={0.02}
            onChange={(v) => setSh("dx", v)}
            disabled={!sh.on}
          />
          <Slider
            label="Down"
            v={sh.dy}
            min={-1}
            max={1}
            step={0.02}
            onChange={(v) => setSh("dy", v)}
            disabled={!sh.on}
          />
          <Slider
            label="Size"
            v={sh.size}
            min={0.5}
            max={3}
            step={0.05}
            onChange={(v) => setSh("size", v)}
            disabled={!sh.on}
          />
          <Slider
            label="Blur"
            v={sh.blur}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => setSh("blur", v)}
            disabled={!sh.on}
          />
          <Slider
            label="Opacity"
            v={sh.opacity}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => setSh("opacity", v)}
            disabled={!sh.on}
          />
        </Section>

        <Section title="Export">
          <Row label="Width">
            <select
              className={INPUT}
              value={s.exportW}
              onChange={(e) => set("exportW", Number(e.target.value))}
            >
              {EXPORT_WIDTHS.map((w) => (
                <option key={w} value={w}>
                  {w} px
                </option>
              ))}
            </select>
          </Row>
          <Check
            label="Crop to the dice"
            v={s.crop}
            onChange={(v) => set("crop", v)}
          />
          <Slider
            label="Padding"
            v={s.pad}
            min={0}
            max={512}
            step={8}
            onChange={(v) => set("pad", v)}
            onActive={setPadActive}
            disabled={!s.crop}
          />
          <div className="flex gap-1">
            <button
              type="button"
              onClick={exportPng}
              className={`${BTN_PRIMARY} flex-1`}
            >
              Export PNG (E)
            </button>
            <button
              type="button"
              onClick={exportSvg}
              className={`${BTN} h-8`}
              title="Flat vector version: solid shaded faces, no bevels or cast shadows, always straight-on projection"
            >
              SVG
            </button>
          </div>
          <p className="text-xs text-neutral-400">
            PNG: transparent, same framing as the canvas, tagged {PRINT_DPI}{" "}
            dpi, rendered at 2× and scaled down for smooth edges; the settings
            that made it are stored inside the file. SVG: a flat-vector
            rendering of the same dice (shaded faces, letters and pips as paths,
            drop shadow as a blur) with no bevels or cast shadows, and no
            perspective.
          </p>
        </Section>

        <Section title="Settings">
          <div className="flex gap-1">
            <button
              type="button"
              className={`${BTN} flex-1`}
              title="Download every slider plus the current die positions as JSON"
              onClick={saveSettings}
            >
              save settings
            </button>
            <label
              className={`${BTN} flex flex-1 cursor-pointer items-center justify-center`}
            >
              load settings…
              <input
                type="file"
                accept=".json,.png"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) loadSettings(f);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          <p className="text-xs text-neutral-400">
            Load takes a settings .json or any PNG this lab exported.
          </p>
        </Section>

        <p className="mt-auto min-h-4 text-xs text-neutral-500">{status}</p>
      </aside>

      <main className="relative min-w-0 flex-1">
        {/* checkerboard so transparency reads as transparency */}
        <div className="absolute inset-0" style={CHECKER} />
        <div className="absolute inset-0">
          <LabStage
            dice={s.dice}
            ortho={s.ortho}
            fov={s.fov}
            shadows={s.shadows}
            shadow={sh}
            grid={s.grid}
            settle={s.settle}
            keepOrder={s.keepOrder}
            layout={lay}
            poses={s.poses}
            onPoses={onPoses}
            frame={
              s.crop && padActive ? { pad: s.pad, exportW: s.exportW } : null
            }
            arena={{ w: tp.arenaW, d: tp.arenaD }}
            selected={selected}
            onSelect={setSelected}
            onHandle={onHandle}
          />
        </div>
      </main>
    </div>
  );
}

const CHECKER: CSSProperties = {
  backgroundColor: "#2a2a2e",
  backgroundImage: [
    "linear-gradient(45deg, #343438 25%, transparent 25%)",
    "linear-gradient(-45deg, #343438 25%, transparent 25%)",
    "linear-gradient(45deg, transparent 75%, #343438 75%)",
    "linear-gradient(-45deg, transparent 75%, #343438 75%)",
  ].join(", "),
  backgroundSize: "24px 24px",
  backgroundPosition: "0 0, 0 12px, 12px -12px, -12px 0",
};

const INPUT =
  "h-7 flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 text-xs text-neutral-100";
const BTN =
  "h-7 rounded border border-neutral-700 px-2 text-xs text-neutral-200 hover:border-neutral-500 disabled:opacity-40";
const BTN_PRIMARY =
  "h-8 rounded bg-sky-500 px-3 text-xs font-medium text-white hover:bg-sky-400 disabled:opacity-50";

function Section({
  title,
  collapsed,
  children,
}: {
  title: string;
  collapsed?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={!collapsed} className="group flex flex-col gap-2">
      <summary className="cursor-pointer list-none text-xs font-semibold tracking-wider text-neutral-500 uppercase select-none">
        <span className="mr-1 inline-block transition-transform group-open:rotate-90">
          ▸
        </span>
        {title}
      </summary>
      <div className="mt-2 flex flex-col gap-2">{children}</div>
    </details>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-xs text-neutral-400">{label}</span>
      {children}
    </label>
  );
}

function Slider({
  label,
  v,
  min,
  max,
  step,
  onChange,
  onActive,
  disabled,
}: {
  label: string;
  v: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  // hovered, focused or being dragged
  onActive?: (active: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-center gap-2 ${disabled ? "opacity-40" : ""}`}
    >
      <span className="w-16 shrink-0 text-xs text-neutral-400">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={v}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerEnter={() => onActive?.(true)}
        onFocus={() => onActive?.(true)}
        onPointerLeave={(e) => {
          if (document.activeElement !== e.currentTarget) onActive?.(false);
        }}
        onBlur={() => onActive?.(false)}
        className="flex-1 accent-sky-400"
      />
      <span className="w-10 text-right font-mono text-xs text-neutral-300">
        {v}
      </span>
    </label>
  );
}

function Check({
  label,
  v,
  onChange,
}: {
  label: string;
  v: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-neutral-300">
      <input
        type="checkbox"
        checked={v}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-sky-400"
      />
      {label}
    </label>
  );
}

function FaceEditor({
  name,
  face,
  onChange,
}: {
  name: string;
  face: Face;
  onChange: (f: Face) => void;
}) {
  const custom =
    face.kind === "letter" && face.color !== "blue" && face.color !== "orange";
  return (
    <div className="flex items-center gap-1">
      <span className="w-12 shrink-0 text-xs text-neutral-500">{name}</span>
      <select
        className={INPUT}
        value={face.kind}
        onChange={(e) =>
          onChange(
            e.target.value === "letter"
              ? { kind: "letter", letter: "M", color: "blue" }
              : { kind: "pips", value: 1 },
          )
        }
      >
        <option value="letter">letter</option>
        <option value="pips">pips</option>
      </select>
      {face.kind === "letter" ? (
        <>
          <select
            className={INPUT}
            value={face.letter}
            onChange={(e) => onChange({ ...face, letter: e.target.value })}
          >
            {LETTERS.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
          <select
            className={INPUT}
            value={custom ? "custom" : face.color}
            onChange={(e) =>
              onChange({
                ...face,
                color: e.target.value === "custom" ? "#ffffff" : e.target.value,
              })
            }
          >
            <option value="blue">blue</option>
            <option value="orange">orange</option>
            <option value="custom">custom</option>
          </select>
          {custom && (
            <input
              type="color"
              value={face.color}
              onChange={(e) => onChange({ ...face, color: e.target.value })}
              className="h-7 w-8 shrink-0 rounded border border-neutral-700 bg-transparent"
            />
          )}
        </>
      ) : (
        <select
          className={INPUT}
          value={face.value}
          onChange={(e) =>
            onChange({ kind: "pips", value: Number(e.target.value) })
          }
        >
          {PIP_VALUES.map((p) => (
            <option key={p} value={p}>
              {p === 0 ? "blank" : p}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
