"use client";

import { useCallback, useEffect, useState } from "react";
import * as THREE from "three";
import type { RollInTake } from "./introDriver";
import {
  DEFAULT_PARAMS,
  readParams,
  type RollParams,
  type TakeMeta,
} from "./physicsRollIn";
import {
  SPIN_LABELS,
  matchRetcon,
  retconOptions,
  type RetconFaceGroup,
} from "./cubeRetcon";
import { setTableauPreview } from "./tableauPreview";

// Dev-only curation panel (Dice.tsx mounts it only in development): throw fresh
// live rolls, re-watch the one just thrown, keep the good ones, and replay or
// delete any roll kept earlier. The dropdown lists the kept rolls in
// src/v2/components/dice/dice3d/takes/ (served by /api/dev/keep-take), which IS the
// shipped set — keeping a roll ships it, deleting one unships it.
//
// Playing an arbitrary take works through window.__replayTake: the panel queues
// a take there and remounts Dice3D, which consumes it. Live mode is a URL param
// the intro already reads (?record / ?launch), so mode changes rewrite those and
// remount too — the intro paths themselves stay untouched.
//
// The tableau picker is the exception: it pushes orientations through
// tableauPreview instead of remounting, because a remount would replay the
// whole 2.5s roll on every cycler click.

type Mode = "live" | "kept" | { file: string };
type Listed = {
  name: string;
  meta: TakeMeta;
  restX: number[];
  n: number;
  hz: number;
};

// The roll-shaping params. ?gap lives outside this — it's a layout knob Dice3D
// reads in every mode, so it's preserved across mode changes rather than
// rewritten here. (launch/base are stale keys from earlier rigs; kept in the
// delete-list so an old URL doesn't leave them lingering.)
const NUM_KEYS = [
  "speed",
  "angle",
  "height",
  "reach",
  "spin",
  "bounce",
] as const;
const ROLL_KEYS = ["sim", "record", "launch", "base", "entry", ...NUM_KEYS];
function writeModeToUrl(mode: Mode, params: RollParams) {
  const p = new URLSearchParams(window.location.search);
  ROLL_KEYS.forEach((k) => p.delete(k));
  // Only live rolls carry the sim params; a kept/curated roll ignores them. Each
  // is written only when it differs from the default, keeping URLs short.
  if (mode === "live") {
    p.set("record", "1");
    NUM_KEYS.forEach((k) => {
      if (params[k] !== DEFAULT_PARAMS[k])
        p.set(k, String(Math.round(params[k] * 100) / 100));
    });
    if (params.entry === "split") p.set("entry", "split");
  }
  const q = p.toString();
  history.replaceState(null, "", q ? `?${q}` : window.location.pathname);
}

// Legality check on a roll — a good-looking roll can still put a die off-camera
// or out of slot order, and a kept roll ships as-is.
const EDGE = 3.18; // visible canvas edge in local units, minus a hair
const GAP_MIN = 1.0; // adjacent rest centers — protects the align slide
const NEAR_MAX = 0.9; // |restX - slotX|

type Badge = { label: string; ok: boolean };

// True x-reach of the beveled die at a pose: 0.44·Σ|basis.x| + 0.06, exact from
// 0.5 face-on to ~0.822 corner-on.
function halfExtentX(q: number[], o: number): number {
  const x = q[o];
  const y = q[o + 1];
  const z = q[o + 2];
  const w = q[o + 3];
  return (
    0.44 *
      (Math.abs(1 - 2 * (y * y + z * z)) +
        Math.abs(2 * (x * y - w * z)) +
        Math.abs(2 * (x * z + w * y))) +
    0.06
  );
}

// Every die must be fully on camera from the moment it lands: the off-screen
// entry (left, or right too in split mode) is by design, so we only enforce
// containment once a die has reached the floor — before that it's allowed to be
// mid-flight off either edge. After landing it must stay fully inside ±EDGE
// every frame, and it must have been fully inside at least once (so a die that
// rests half off-frame fails). Symmetric, so split-entry takes are judged too.
function onScreen(take: RollInTake): boolean {
  for (const die of take.dice) {
    let touched = false;
    let enteredFully = false;
    for (let k = 0; k < take.n; k++) {
      const x = die.p[k * 3];
      const h = halfExtentX(die.q, k * 4);
      if (die.p[k * 3 + 1] < 0.55) touched = true;
      const fullyIn = x - h >= -EDGE && x + h <= EDGE;
      if (touched && !fullyIn) return false;
      if (fullyIn) enteredFully = true;
    }
    if (!touched || !enteredFully) return false;
  }
  return true;
}

function judge(meta: TakeMeta, restX: number[], take: RollInTake): Badge[] {
  return [
    {
      label: "sim clean",
      ok: !meta.crashed && !meta.timedOut && meta.nudges === 0,
    },
    { label: "near slots", ok: meta.finalErr.every((e) => e <= NEAR_MAX) },
    {
      label: "in order",
      ok: restX.every((x, i) => i === 0 || x - restX[i - 1] >= GAP_MIN),
    },
    { label: "on screen", ok: onScreen(take) },
  ];
}

const shortName = (f: string) => f.replace(/^take-|\.json$/g, "").slice(-6);

const IDENTITY = new THREE.Quaternion();

// Each die's META pick: its blue front letter (the row spells M·E·T·A) turned
// camera-ward at its most-upright spin. "blue <letter> f" is that face group;
// spin 0 is most-upright (retconOptions sorts it first). Upright is a first
// approximation, estimated from the die's tilted rest pose — same as the picker.
const metaPicks = (groups: RetconFaceGroup[][]) =>
  groups.map((faces) => {
    const face = faces.findIndex(
      (g) => g.label.startsWith("blue") && g.label.endsWith(" f"),
    );
    return { face: face >= 0 ? face : 0, spin: 0 };
  });

// Dimmed stand-in for the judge badges, shown before a roll lands so the toolbar
// reserves its width instead of jumping when the real ones appear.
const BADGE_PLACEHOLDER: Badge[] = [
  { label: "sim clean", ok: false },
  { label: "near slots", ok: false },
  { label: "in order", ok: false },
  { label: "on screen", ok: false },
];

function Cycler({
  label,
  width,
  onStep,
}: {
  label: string;
  width: string;
  onStep: (delta: number) => void;
}) {
  const arrow = "rounded bg-white/15 px-1 hover:bg-white/25";
  return (
    <span className="flex items-center gap-0.5">
      <button className={arrow} onClick={() => onStep(-1)}>
        ‹
      </button>
      <span className={`${width} text-center text-white/80`}>{label}</span>
      <button className={arrow} onClick={() => onStep(1)}>
        ›
      </button>
    </span>
  );
}

export default function DiceDevPanel({ onRemount }: { onRemount: () => void }) {
  const [mode, setMode] = useState<Mode>(() =>
    new URLSearchParams(window.location.search).has("record") ? "live" : "kept",
  );
  // Granular roll-shaping params (replaces the old low/high checkbox). Written
  // to the URL and applied by remounting, so ?record bakes at these values.
  const [params, setParams] = useState<RollParams>(readParams);
  // Dice spacing (Dice3D reads ?gap in every mode). Preview-only until the
  // shipped GAP constant is set to match; kept out of ROLL_KEYS.
  const [gap, setGap] = useState<number>(() => {
    const g = Number(new URLSearchParams(window.location.search).get("gap"));
    return Number.isFinite(g) && g > 0 ? g : 1.5;
  });
  const [listed, setListed] = useState<Listed[]>([]);
  const [roll, setRoll] = useState<{
    take: RollInTake;
    meta: TakeMeta;
    badges: Badge[];
  } | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false); // delete needs a second click
  const [hold, setHold] = useState(false);
  // Per-die face × spin options for the selected take, and the current pick.
  const [groups, setGroups] = useState<RetconFaceGroup[][] | null>(null);
  const [picks, setPicks] = useState<{ face: number; spin: number }[]>([]);
  const [savedOrient, setSavedOrient] = useState<string | null>(null);
  // When on, every live roll is oriented to META the instant it lands (no click,
  // no waiting), so keep bakes it oriented. Off = raw faces / manual orient.
  const [autoOrient, setAutoOrient] = useState(true);
  // Whether the per-die orientation cyclers are expanded. Auto-orient sets
  // `groups` silently (so keep bakes) WITHOUT opening this, so a normal roll
  // doesn't grow the panel; the picker opens only on an explicit orient/curate.
  const [showPicker, setShowPicker] = useState(false);

  const refreshList = useCallback(
    () =>
      fetch("/api/dev/keep-take")
        .then((r) => r.json() as Promise<{ takes?: Listed[] }>)
        .then((body) => setListed(body.takes ?? []))
        .catch(() => setListed([])),
    [],
  );
  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  // The live sim publishes each finished take on window; pick it up for badges.
  // With auto-orient on, immediately compute + apply the META orientation so the
  // kept roll bakes oriented and any replay shows it — no wait, no click. It's a
  // silent apply (the live roll already ends at META via its align tail), so no
  // extra re-roll; hit the orient button if you want to freeze-inspect the
  // tableau. `groups`/`picks` are read every frame by playback via tableauPreview.
  useEffect(() => {
    const onTake = () => {
      const t = window.__rollInTake;
      if (!t) return;
      const restX = t.take.dice.map((d) => d.p[(t.take.n - 1) * 3]);
      setRoll({ ...t, badges: judge(t.meta, restX, t.take) });
      setSaved(null);
      if (autoOrient) {
        const g = t.take.dice.map((_, i) => retconOptions(t.take, i));
        setGroups(g);
        setPicks(metaPicks(g));
      }
    };
    window.addEventListener("roll-in-take", onTake);
    return () => window.removeEventListener("roll-in-take", onTake);
  }, [autoOrient]);

  // Queue a take for the next mount and remount, so an arbitrary roll (one kept
  // earlier, or the one just thrown) plays without a page reload.
  const play = (take: RollInTake) => {
    window.__replayTake = take;
    onRemount();
  };

  const selectCurated = async (file: string) => {
    setMode({ file });
    setSaved(null);
    setSavedOrient(null);
    setArmed(false);
    writeModeToUrl({ file }, params);
    try {
      const res = await fetch(
        `/api/dev/keep-take?file=${encodeURIComponent(file)}`,
      );
      const body = (await res.json()) as { take: RollInTake; meta: TakeMeta };
      const restX = body.take.dice.map((d) => d.p[(body.take.n - 1) * 3]);
      const g = body.take.dice.map((_, i) => retconOptions(body.take, i));
      // Start from whatever the take already plays: its saved tableau, or the
      // raw sim output (identity) when it has none.
      const p = g.map((faces, i) =>
        matchRetcon(
          faces,
          body.take.retcon
            ? new THREE.Quaternion().fromArray(body.take.retcon[i])
            : IDENTITY,
        ),
      );
      setGroups(g);
      setPicks(p);
      setShowPicker(true); // curating a kept take → open the picker
      setRoll({ ...body, badges: judge(body.meta, restX, body.take) });
      play(body.take);
    } catch {
      setRoll(null);
      setGroups(null);
    }
  };

  const switchTo = (m: "live" | "kept", p: RollParams = params) => {
    delete window.__replayTake; // stop replaying whatever was selected
    setTableauPreview({ hold: false, retcon: null });
    setHold(false);
    setGroups(null);
    setShowPicker(false);
    setMode(m);
    setParams(p);
    setRoll(null);
    setSaved(null);
    setSavedOrient(null);
    setArmed(false);
    writeModeToUrl(m, p);
    onRemount();
  };

  // Change one roll param and re-throw a live roll at the new value.
  const setParam = <K extends keyof RollParams>(k: K, v: RollParams[K]) =>
    switchTo("live", { ...params, [k]: v });
  // Step a numeric roll param by its own increment, re-throwing each time. Angle
  // may go negative (a downward skid); the rest floor at 0 (reach at 1).
  const stepParam = (k: (typeof NUM_KEYS)[number], d: number) => {
    const inc = {
      speed: 0.1,
      angle: 3,
      height: 0.2,
      reach: 0.5,
      spin: 0.1,
      bounce: 0.1,
    }[k];
    const floor = k === "angle" ? -60 : k === "reach" ? 1 : 0;
    setParam(k, Math.max(floor, Math.round((params[k] + d * inc) * 100) / 100));
  };

  // Dice spacing is a layout knob, not a roll param: write ?gap and remount so
  // Dice3D re-reads it, without touching the live/kept mode or roll params.
  const stepGap = (d: number) => {
    const next = Math.round((gap + d * 0.1) * 100) / 100;
    if (next < 0.8 || next > 2.6) return;
    setGap(next);
    const url = new URLSearchParams(window.location.search);
    url.set("gap", String(next));
    history.replaceState(null, "", `?${url.toString()}`);
    delete window.__replayTake;
    onRemount();
  };

  const cycle = (die: number, kind: "face" | "spin", delta: number) => {
    setPicks((prev) =>
      prev.map((p, i) =>
        i !== die
          ? p
          : kind === "face"
            ? { face: (p.face + delta + 6) % 6, spin: p.spin }
            : { face: p.face, spin: (p.spin + delta + 4) % 4 },
      ),
    );
    setSavedOrient(null);
  };

  // Push the pick to playback, which re-reads it every frame — no remount, so
  // the dice re-pose on the next frame instead of replaying the roll.
  useEffect(() => {
    if (!groups) return;
    setTableauPreview({
      retcon: picks.map((p, i) => groups[i][p.face].spins[p.spin]),
    });
  }, [groups, picks]);

  const saveOrient = async () => {
    if (typeof mode !== "object" || !groups || busy) return;
    setBusy(true);
    try {
      const retcon = picks.map((p, i) =>
        groups[i][p.face].spins[p.spin]
          .toArray()
          .map((v) => Math.round(v * 1e6) / 1e6),
      );
      const res = await fetch("/api/dev/keep-take", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ file: mode.file, retcon }),
      });
      setSavedOrient(res.ok ? "saved" : "save failed");
    } catch {
      setSavedOrient("save failed");
    } finally {
      setBusy(false);
    }
  };

  // Re-watch whatever is loaded: the exact take for a kept or live roll,
  // otherwise just a fresh mount of the random kept set.
  const replay = () => {
    if (roll) play(roll.take);
    else onRemount();
  };

  // Hold is read when the driver decides whether to run the tail, so it only
  // takes effect from a fresh mount.
  const toggleHold = (on: boolean) => {
    setTableauPreview({ hold: on });
    setHold(on);
    replay();
  };

  // Snap every die to its META letter (the blue front face), most-upright — the
  // same face×spin the picker offers, chosen automatically. On a live roll this
  // replays the take held at rest so the oriented tableau shows before you keep;
  // keep() then bakes whatever orientation is applied. A first approximation:
  // "upright" is estimated from each die's tilted rest pose, same as the picker.
  const orientMeta = () => {
    const take = roll?.take;
    if (!take) return;
    const g = take.dice.map((_, i) => retconOptions(take, i));
    const p = metaPicks(g);
    setGroups(g);
    setPicks(p);
    setShowPicker(true); // clicking orient = "let me inspect/tweak the tableau"
    setSavedOrient(null);
    setTableauPreview({
      hold: true,
      retcon: p.map((pk, i) => g[i][pk.face].spins[pk.spin]),
    });
    setHold(true);
    window.__replayTake = take;
    onRemount();
  };

  const keep = async () => {
    if (!roll || busy || mode !== "live") return;
    setBusy(true);
    try {
      // Bake the applied orientation (if any) into the take so the kept roll
      // ships oriented, no separate save-orientation pass. Un-oriented rolls
      // keep their raw symmetries and draw randomly per load, as before.
      const take =
        groups && picks.length
          ? {
              ...roll.take,
              retcon: picks.map((p, i) =>
                groups[i][p.face].spins[p.spin]
                  .toArray()
                  .map((v) => Math.round(v * 1e6) / 1e6),
              ),
            }
          : roll.take;
      const res = await fetch("/api/dev/keep-take", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ take, meta: roll.meta }),
      });
      const body = (await res.json()) as { saved?: string; count?: number };
      setSaved(res.ok ? `saved (${body.count})` : "save failed");
      await refreshList();
    } catch {
      setSaved("save failed");
    } finally {
      setBusy(false);
    }
  };

  // Unship the selected kept roll. Two-step rather than a confirm() dialog,
  // which would block the page (and any browser automation driving it). The arm
  // lapses on a timer rather than on blur — a dev-server hot reload re-renders
  // the panel, and a focus-based disarm would swallow the confirming click.
  const remove = async () => {
    if (typeof mode !== "object" || busy) return;
    if (!armed) {
      setArmed(true);
      setTimeout(() => setArmed(false), 3000);
      return;
    }
    setBusy(true);
    try {
      await fetch(`/api/dev/keep-take?file=${encodeURIComponent(mode.file)}`, {
        method: "DELETE",
      });
      await refreshList();
      switchTo("kept"); // clears the queued replay of the take just deleted
    } finally {
      setArmed(false);
      setBusy(false);
    }
  };

  const selectValue = typeof mode === "object" ? `file:${mode.file}` : mode;

  return (
    <div className="relative z-50 mt-2 flex w-fit max-w-[96vw] flex-col gap-2 rounded-lg bg-black/70 px-3 py-2 font-mono text-xs text-white shadow-lg">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="rounded bg-white/10 px-1 py-0.5"
          value={selectValue}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "live" || v === "kept") switchTo(v);
            else void selectCurated(v.slice("file:".length));
          }}
        >
          <option value="kept">kept (random)</option>
          <option value="live">live roll</option>
          {listed.length > 0 && (
            <optgroup label={`kept rolls (${listed.length})`}>
              {listed.map((t, i) => (
                <option key={t.name} value={`file:${t.name}`}>
                  {`#${i + 1} · ${shortName(t.name)} · ${t.meta.duration.toFixed(1)}s`}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <button
          className="rounded bg-white/15 px-2 py-0.5 hover:bg-white/25"
          onClick={replay}
        >
          replay
        </button>
        <button
          className="rounded bg-white/15 px-2 py-0.5 hover:bg-white/25"
          onClick={() => switchTo("live")}
        >
          roll
        </button>
        {typeof mode === "object" && (
          <button
            className="rounded bg-red-500/30 px-2 py-0.5 hover:bg-red-500/50 disabled:opacity-40"
            disabled={busy}
            onClick={remove}
          >
            {armed ? "sure?" : "delete"}
          </button>
        )}
        {mode === "live" && (
          <>
            {/* entry edge(s) toggle; the steppers throw the cube directly, so
                each maps straight to the flight. Every change re-throws. */}
            <button
              className="rounded bg-white/15 px-2 py-0.5 hover:bg-white/25"
              onClick={() =>
                setParam("entry", params.entry === "left" ? "split" : "left")
              }
            >
              {params.entry}
            </button>
            <Cycler
              label={`spd ${params.speed.toFixed(1)}`}
              width="w-12"
              onStep={(d) => stepParam("speed", d)}
            />
            <Cycler
              label={`ang ${Math.round(params.angle)}°`}
              width="w-12"
              onStep={(d) => stepParam("angle", d)}
            />
            <Cycler
              label={`ht ${params.height.toFixed(1)}`}
              width="w-12"
              onStep={(d) => stepParam("height", d)}
            />
            <Cycler
              label={`rch ${params.reach.toFixed(1)}`}
              width="w-12"
              onStep={(d) => stepParam("reach", d)}
            />
            <Cycler
              label={`spin ${params.spin.toFixed(1)}`}
              width="w-14"
              onStep={(d) => stepParam("spin", d)}
            />
            <Cycler
              label={`bnc ${params.bounce.toFixed(1)}`}
              width="w-14"
              onStep={(d) => stepParam("bounce", d)}
            />
            {/* back to DEFAULT_PARAMS (gap is a separate layout knob, untouched) */}
            <button
              className="rounded bg-white/15 px-2 py-0.5 hover:bg-white/25"
              onClick={() => switchTo("live", DEFAULT_PARAMS)}
            >
              reset
            </button>
            <label className="flex cursor-pointer items-center gap-1">
              <input
                type="checkbox"
                checked={autoOrient}
                onChange={(e) => setAutoOrient(e.target.checked)}
              />
              auto-orient
            </label>
          </>
        )}
        <Cycler label={`gap ${gap.toFixed(1)}`} width="w-14" onStep={stepGap} />
        {(showPicker || typeof mode === "object") && (
          <label className="flex cursor-pointer items-center gap-1">
            <input
              type="checkbox"
              checked={hold}
              onChange={(e) => toggleHold(e.target.checked)}
            />
            hold at rest
          </label>
        )}
        {/* Badges + actions stay MOUNTED (dimmed/disabled until a roll lands) so
            the toolbar doesn't jump the moment a roll completes. */}
        {(mode === "live" || roll) && (
          <>
            {(roll?.badges ?? BADGE_PLACEHOLDER).map((b) => (
              <span
                key={b.label}
                className={
                  !roll
                    ? "text-white/30"
                    : b.ok
                      ? "text-emerald-300"
                      : "text-red-300"
                }
              >
                {!roll ? "·" : b.ok ? "✓" : "✗"} {b.label}
              </span>
            ))}
            {/* snap the whole row to its M·E·T·A letters, upright, before keeping */}
            <button
              className="rounded bg-sky-500/30 px-2 py-0.5 hover:bg-sky-500/50 disabled:opacity-40"
              disabled={busy || !roll}
              onClick={orientMeta}
            >
              orient META
            </button>
            {mode === "live" && (
              <button
                className="rounded bg-emerald-500/30 px-2 py-0.5 hover:bg-emerald-500/50 disabled:opacity-40"
                disabled={busy || !roll || saved !== null}
                onClick={keep}
              >
                {saved ?? "keep"}
              </button>
            )}
          </>
        )}
      </div>
      {showPicker && groups && (
        <div className="flex flex-col gap-1 border-t border-white/15 pt-2">
          {picks.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-white/50">die {i + 1}</span>
              <Cycler
                label={groups[i][p.face].label}
                width="w-20"
                onStep={(d) => cycle(i, "face", d)}
              />
              <Cycler
                label={SPIN_LABELS[p.spin]}
                width="w-4"
                onStep={(d) => cycle(i, "spin", d)}
              />
            </div>
          ))}
          {typeof mode === "object" ? (
            <button
              className="mt-1 rounded bg-emerald-500/30 px-2 py-0.5 hover:bg-emerald-500/50 disabled:opacity-40"
              disabled={busy}
              onClick={saveOrient}
            >
              {savedOrient ?? "save orientation"}
            </button>
          ) : (
            <span className="mt-1 text-white/40">baked into keep</span>
          )}
        </div>
      )}
    </div>
  );
}
