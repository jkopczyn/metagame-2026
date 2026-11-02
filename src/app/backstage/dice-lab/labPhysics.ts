import * as THREE from "three";
import type { RigidBody, World } from "@dimforge/rapier3d-compat";

// Free-form Rapier roll for the dice lab: N dice thrown into a walled arena and
// left to settle wherever they land (no slots, no steering, no align tail —
// unlike the hero's physicsRollIn). Material constants mirror the hero so the
// tumble has the same weight.
const GRAVITY = 14;
const RESTITUTION = 0.45;
const FRICTION = 0.8;
const LIN_DAMPING = 0.08;
const ANG_DAMPING = 0.9;
const STEP = 1 / 120;
const BASE_SPIN = 8;
const REST_LIN = 0.08;
const REST_ANG = 0.3;
const REST_HOLD = 0.3;
const TIMEOUT = 8;
export const DIE_HALF = 0.5; // resting center height above the floor

export type ThrowFrom = "left" | "right" | "drop" | "scatter";
export type ThrowParams = {
  speed: number; // × launch velocity
  spin: number; // × tumble rate
  height: number; // launch height above the floor, world units
  bounce: number; // × restitution
  from: ThrowFrom;
  arenaW: number; // wall-to-wall x extent
  arenaD: number; // wall-to-wall z extent
};
export const DEFAULT_THROW: ThrowParams = {
  speed: 1,
  spin: 1,
  height: 2,
  bounce: 1,
  from: "left",
  arenaW: 10,
  arenaD: 5,
};

export type Pose = { p: THREE.Vector3; q: THREE.Quaternion };

let rapierReady: Promise<typeof import("@dimforge/rapier3d-compat")> | null =
  null;
function loadRapier() {
  rapierReady ??= import("@dimforge/rapier3d-compat").then(async (R) => {
    await R.init();
    return R;
  });
  return rapierReady;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const randomQuat = () =>
  new THREE.Quaternion().setFromEuler(
    new THREE.Euler(
      rnd(0, Math.PI * 2),
      rnd(0, Math.PI * 2),
      rnd(0, Math.PI * 2),
    ),
  );

// Spawn positions for n dice entering from one edge: a line along z, wrapping
// into a second raised row when the arena is too shallow for the count.
function edgeSpawns(n: number, x: number, params: ThrowParams) {
  const spacing = 1.15;
  const perRow = Math.max(1, Math.floor((params.arenaD - 1) / spacing));
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const count = Math.min(perRow, n - row * perRow);
    const z = (col - (count - 1) / 2) * spacing;
    out.push(new THREE.Vector3(x, params.height + row * 1.2, z));
  }
  return out;
}

export class LabSim {
  readonly poses: Pose[];
  settled = false;
  #world: World;
  #bodies: RigidBody[];
  #restT: number[];
  #acc = 0;
  #elapsed = 0;
  #disposed = false;

  private constructor(world: World, bodies: RigidBody[]) {
    this.#world = world;
    this.#bodies = bodies;
    this.#restT = bodies.map(() => 0);
    this.poses = bodies.map(() => ({
      p: new THREE.Vector3(),
      q: new THREE.Quaternion(),
    }));
    this.#read();
  }

  static async create(n: number, params: ThrowParams): Promise<LabSim> {
    const RAPIER = await loadRapier();
    const world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
    world.timestep = STEP;

    const hw = params.arenaW / 2;
    const hd = params.arenaD / 2;
    const fixed = (x: number, y: number, z: number) =>
      world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z),
      );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(hw + 2, 0.5, hd + 2).setFriction(FRICTION),
      fixed(0, -0.5, 0),
    );
    // walls: thick slabs just outside the arena, tall enough to catch lobs
    const WALL = 0.5;
    const TALL = 6;
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(WALL, TALL, hd + 2),
      fixed(-hw - WALL, TALL - 0.5, 0),
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(WALL, TALL, hd + 2),
      fixed(hw + WALL, TALL - 0.5, 0),
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(hw + 2, TALL, WALL),
      fixed(0, TALL - 0.5, -hd - WALL),
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(hw + 2, TALL, WALL),
      fixed(0, TALL - 0.5, hd + WALL),
    );

    // launch draws
    const spawns: THREE.Vector3[] = [];
    const vels: THREE.Vector3[] = [];
    const v0 = 5 * params.speed;
    if (params.from === "left" || params.from === "right") {
      const side = params.from === "left" ? -1 : 1;
      edgeSpawns(n, side * (hw - 0.7), params).forEach((p) => {
        spawns.push(p);
        vels.push(
          new THREE.Vector3(
            -side * v0 * rnd(0.85, 1.15),
            rnd(0, 1.5),
            rnd(-0.6, 0.6),
          ),
        );
      });
    } else if (params.from === "drop") {
      for (let i = 0; i < n; i++) {
        spawns.push(
          new THREE.Vector3(
            rnd(-hw + 1, hw - 1),
            params.height + rnd(0, 1) + i * 0.3,
            rnd(-hd + 1, hd - 1),
          ),
        );
        vels.push(
          new THREE.Vector3(rnd(-1, 1), 0, rnd(-1, 1)).multiplyScalar(
            params.speed,
          ),
        );
      }
    } else {
      // scatter: a tight stack over the center bursting outward
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rnd(-0.3, 0.3);
        spawns.push(
          new THREE.Vector3(
            Math.cos(a) * 0.4,
            params.height + i * 1.1,
            Math.sin(a) * 0.4,
          ),
        );
        vels.push(
          new THREE.Vector3(Math.cos(a), 0.1, Math.sin(a) * 0.5).multiplyScalar(
            v0 * 0.6 * rnd(0.7, 1.3),
          ),
        );
      }
    }

    const bodies = spawns.map((p, i) => {
      const q = randomQuat();
      const w = new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1))
        .normalize()
        .multiplyScalar(params.spin * (BASE_SPIN + rnd(0, 5)));
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(p.x, p.y, p.z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
          .setLinvel(vels[i].x, vels[i].y, vels[i].z)
          .setAngvel({ x: w.x, y: w.y, z: w.z })
          .setLinearDamping(LIN_DAMPING)
          .setAngularDamping(ANG_DAMPING),
      );
      world.createCollider(
        RAPIER.ColliderDesc.roundCuboid(0.44, 0.44, 0.44, 0.06)
          .setRestitution(RESTITUTION * params.bounce)
          .setFriction(FRICTION),
        body,
      );
      return body;
    });

    return new LabSim(world, bodies);
  }

  #read() {
    this.#bodies.forEach((b, i) => {
      const t = b.translation();
      const r = b.rotation();
      this.poses[i].p.set(t.x, t.y, t.z);
      this.poses[i].q.set(r.x, r.y, r.z, r.w);
    });
  }

  // Advance by dt (capped); returns true once everything is at rest.
  step(dt: number): boolean {
    if (this.settled || this.#disposed) return true;
    this.#acc += Math.min(dt, 0.1);
    while (this.#acc >= STEP) {
      this.#acc -= STEP;
      this.#elapsed += STEP;
      this.#world.step();
      let allRest = true;
      this.#bodies.forEach((b, i) => {
        const lv = b.linvel();
        const av = b.angvel();
        const slow =
          Math.hypot(lv.x, lv.y, lv.z) < REST_LIN &&
          Math.hypot(av.x, av.y, av.z) < REST_ANG;
        this.#restT[i] = slow ? this.#restT[i] + STEP : 0;
        if (this.#restT[i] < REST_HOLD) allRest = false;
      });
      if (allRest || this.#elapsed > TIMEOUT) {
        this.settled = true;
        break;
      }
    }
    this.#read();
    return this.settled;
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#world.free();
  }
}

// Nearest of the 24 cube orientations to q: greedily snap the rotation matrix
// to a signed permutation matrix, fixing the handedness if the greedy pick
// came out improper. Used to "square up" a settled roll so every visible face
// sits flat instead of a hair off-axis.
const M = new THREE.Matrix4();
export function snapToCube(q: THREE.Quaternion): THREE.Quaternion {
  M.makeRotationFromQuaternion(q);
  const e = M.elements; // column-major 4x4
  const m = [
    [e[0], e[4], e[8]],
    [e[1], e[5], e[9]],
    [e[2], e[6], e[10]],
  ];
  const out = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const usedR = [false, false, false];
  const usedC = [false, false, false];
  let last: [number, number] = [0, 0];
  for (let k = 0; k < 3; k++) {
    let best = -1;
    let br = 0;
    let bc = 0;
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++)
        if (!usedR[r] && !usedC[c] && Math.abs(m[r][c]) > best) {
          best = Math.abs(m[r][c]);
          br = r;
          bc = c;
        }
    out[br][bc] = Math.sign(m[br][bc]) || 1;
    usedR[br] = usedC[bc] = true;
    last = [br, bc];
  }
  const det =
    out[0][0] * (out[1][1] * out[2][2] - out[1][2] * out[2][1]) -
    out[0][1] * (out[1][0] * out[2][2] - out[1][2] * out[2][0]) +
    out[0][2] * (out[1][0] * out[2][1] - out[1][1] * out[2][0]);
  if (det < 0) out[last[0]][last[1]] *= -1;
  M.set(
    out[0][0],
    out[0][1],
    out[0][2],
    0,
    out[1][0],
    out[1][1],
    out[1][2],
    0,
    out[2][0],
    out[2][1],
    out[2][2],
    0,
    0,
    0,
    0,
    1,
  );
  return new THREE.Quaternion().setFromRotationMatrix(M);
}
