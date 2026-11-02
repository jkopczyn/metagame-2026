import * as THREE from "three";
import { QUAT } from "@/v2/components/dice/dice3d/Die";
import { arrangePoses, type Layout, type Show } from "./labLayout";
import { LabSim, snapToCube, type Pose, type ThrowParams } from "./labPhysics";
import type { CameraView } from "./LabStage";
import type { SvgOpts } from "./labSvg";

// The lab's mutable scene state — die poses, the running sim, square-up
// targets, the drag in progress — kept outside React so the render loop can
// write it every frame. LabStage owns one instance and the StageHandle the page
// drives is a thin view over it.

export type ExportOpts = { width: number; crop: boolean; pad: number };
// A pose as plain numbers, for settings files.
export type SavedPose = {
  p: [number, number, number];
  q: [number, number, number, number];
};
export type ExportFn = (o: ExportOpts) => Promise<Blob>;
export type SvgFn = (o: SvgOpts) => string;
// What happens to the dice once a roll comes to rest.
export type SettleMode =
  | "none"
  | "square"
  | "upright"
  | "upright-blue"
  | "upright-orange";

const ROW_GAP = 1.5;
const SNAP_RATE = 12; // 1/s — square-up slerp speed

function rowPose(i: number, n: number): Pose {
  return {
    p: new THREE.Vector3((i - (n - 1) / 2) * ROW_GAP, 0, 0),
    q: QUAT.meta.clone(),
  };
}

export class LabRig {
  readonly poses: Pose[] = [];
  #settle: SettleMode = "none";
  #keepOrder = true;
  #exportFn: ExportFn | null = null;
  #svgFn: SvgFn | null = null;
  // fires once the dice come to rest after anything moved them
  #onChange: (() => void) | null = null;
  #dirty = false;
  #resetCameraFn: ((view: CameraView) => void) | null = null;

  #layout: { shows: Show[]; layout: Layout } | null = null;
  #targets: (THREE.Quaternion | null)[] = [];
  #sim: LabSim | null = null;
  #onSettled: (() => void) | null = null;
  #drag: { i: number; plane: THREE.Plane; offset: THREE.Vector3 } | null = null;

  setSettleMode(v: SettleMode) {
    this.#settle = v;
  }
  setKeepOrder(v: boolean) {
    this.#keepOrder = v;
  }
  setExportFn(fn: ExportFn | null) {
    this.#exportFn = fn;
  }
  setResetCamera(fn: ((view: CameraView) => void) | null) {
    this.#resetCameraFn = fn;
  }
  resetCamera(view: CameraView) {
    this.#resetCameraFn?.(view);
  }
  exportPng(o: ExportOpts): Promise<Blob> {
    return this.#exportFn
      ? this.#exportFn(o)
      : Promise.reject(new Error("stage not ready"));
  }
  setSvgFn(fn: SvgFn | null) {
    this.#svgFn = fn;
  }
  exportSvg(o: SvgOpts): string {
    if (!this.#svgFn) throw new Error("stage not ready");
    return this.#svgFn(o);
  }
  setOnChange(fn: (() => void) | null) {
    this.#onChange = fn;
  }

  get rolling() {
    return this.#sim !== null;
  }
  get dragging() {
    return this.#drag !== null;
  }

  // One pose per die: new dice join the row, removed ones drop off the end.
  resize(n: number) {
    while (this.poses.length < n) {
      this.poses.push(rowPose(this.poses.length, n));
      this.#targets.push(null);
    }
    this.poses.length = n;
    this.#targets.length = n;
  }

  async roll(params: ThrowParams): Promise<void> {
    this.#endSim();
    this.#targets.fill(null);
    const sim = await LabSim.create(this.poses.length, params);
    this.#sim = sim;
    return new Promise<void>((resolve) => {
      this.#onSettled = resolve;
    });
  }

  // Place every die at its Arrange pose: positions jump, orientations ease in.
  // The latest layout is kept so it can be re-applied after a roll or edit.
  setLayout(shows: Show[], layout: Layout) {
    this.#layout = { shows, layout };
    this.arrange();
  }
  arrange() {
    if (!this.#layout) return;
    this.#endSim();
    arrangePoses(this.#layout.shows, this.#layout.layout).forEach((pose, i) => {
      const mine = this.poses[i];
      if (!mine) return;
      mine.p.copy(pose.p);
      this.#targets[i] = pose.q.clone();
    });
    this.#dirty = true;
  }

  getPoses(): SavedPose[] {
    return this.poses.map((pose) => ({
      p: pose.p.toArray(),
      q: pose.q.toArray() as SavedPose["q"],
    }));
  }
  setPoses(saved: SavedPose[]) {
    this.#endSim();
    saved.forEach((sp, i) => {
      const mine = this.poses[i];
      if (!mine) return;
      mine.p.fromArray(sp.p);
      mine.q.fromArray(sp.q).normalize();
      this.#targets[i] = null;
    });
  }

  squareUp() {
    this.poses.forEach((pose, i) => {
      this.#targets[i] = snapToCube(pose.q);
    });
  }

  // Square up, then stand each die on its pip face (die-local +Y to world up).
  // All four letter panels share local +Y as "up", so this is exactly the pose
  // where every letter around the sides reads upright. By default the yaw the
  // roll landed on is kept; `facing` also yaws the die so its blue (+Z) or
  // orange (+X) letter faces the default camera (world +Z).
  upright(facing?: "blue" | "orange") {
    const up = new THREE.Vector3(0, 1, 0);
    this.poses.forEach((pose, i) => {
      let q = snapToCube(pose.q);
      const localUp = up.clone().applyQuaternion(q);
      q = snapToCube(
        new THREE.Quaternion().setFromUnitVectors(localUp, up).multiply(q),
      );
      if (facing) {
        const front = new THREE.Vector3(
          facing === "orange" ? 1 : 0,
          0,
          facing === "blue" ? 1 : 0,
        ).applyQuaternion(q);
        const yaw = new THREE.Quaternion().setFromAxisAngle(
          up,
          -Math.atan2(front.x, front.z),
        );
        q = snapToCube(yaw.multiply(q));
      }
      this.#targets[i] = q;
    });
  }

  // Hand out the landing spots left-to-right by die number, so die 1 is the
  // leftmost die after a roll and a row still spells what the preset spells.
  // Each die keeps its own orientation.
  reorder() {
    const spots = this.poses.map((p) => p.p.clone()).sort((a, b) => a.x - b.x);
    this.poses.forEach((pose, i) => pose.p.copy(spots[i]));
    this.#dirty = true;
  }

  rotateDie(i: number, axis: "x" | "y" | "z", deg: number) {
    const pose = this.poses[i];
    if (!pose) return;
    const ax = new THREE.Vector3(
      axis === "x" ? 1 : 0,
      axis === "y" ? 1 : 0,
      axis === "z" ? 1 : 0,
    );
    const r = new THREE.Quaternion().setFromAxisAngle(
      ax,
      THREE.MathUtils.degToRad(deg),
    );
    this.#targets[i] = r.multiply(this.#targets[i] ?? pose.q);
  }

  // Per-frame: step the sim while one runs, then ease any square-up targets.
  tick(dt: number) {
    const sim = this.#sim;
    if (sim) {
      const settled = sim.step(dt);
      sim.poses.forEach((pose, i) => {
        const mine = this.poses[i];
        if (!mine) return;
        mine.p.copy(pose.p);
        mine.q.copy(pose.q);
      });
      if (settled) {
        this.#endSim();
        this.#dirty = true;
        if (this.#keepOrder) this.reorder();
        if (this.#settle === "square") this.squareUp();
        else if (this.#settle === "upright") this.upright();
        else if (this.#settle === "upright-blue") this.upright("blue");
        else if (this.#settle === "upright-orange") this.upright("orange");
      }
    }
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * SNAP_RATE);
    let easing = false;
    this.#targets.forEach((t, i) => {
      if (!t) return;
      const q = this.poses[i].q;
      q.slerp(t, k);
      if (q.angleTo(t) < 0.002) {
        q.copy(t);
        this.#targets[i] = null;
        this.#dirty = true;
      } else easing = true;
    });
    if (this.#dirty && !easing && !this.#sim && !this.#drag) {
      this.#dirty = false;
      this.#onChange?.();
    }
  }

  // Dragging slides a die across the horizontal plane through its own center.
  beginDrag(i: number, ray: THREE.Ray): boolean {
    if (this.#sim) return false;
    const p = this.poses[i].p;
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -p.y);
    const hit = new THREE.Vector3();
    if (!ray.intersectPlane(plane, hit)) return false;
    this.#drag = { i, plane, offset: hit.sub(p) };
    return true;
  }
  moveDrag(ray: THREE.Ray) {
    const d = this.#drag;
    if (!d) return;
    const hit = new THREE.Vector3();
    if (!ray.intersectPlane(d.plane, hit)) return;
    const p = this.poses[d.i].p;
    p.x = hit.x - d.offset.x;
    p.z = hit.z - d.offset.z;
    this.#dirty = true;
  }
  endDrag(): boolean {
    const was = this.#drag !== null;
    this.#drag = null;
    return was;
  }

  dispose() {
    this.#endSim();
  }

  #endSim() {
    this.#sim?.dispose();
    this.#sim = null;
    this.#onSettled?.();
    this.#onSettled = null;
  }
}
