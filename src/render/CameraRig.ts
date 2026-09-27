import { Vector3, type PerspectiveCamera } from 'three';
import {
  arcAngle,
  clamp,
  damp,
  PLANET_RADIUS,
  rightOf,
  rotateTangent,
  surfaceHeight,
  tangentise,
} from '../core/SphereMath';
import type { Blocker } from '../world/Scatter';

const MIN_PITCH = -0.12;
const MAX_PITCH = 0.85;
const MIN_DISTANCE = 6.5;
const MAX_DISTANCE = 15;

/**
 * Third-person camera for a spherical world.
 *
 * Note the low default pitch: on a globe this small the ground falls away behind
 * the player, so the camera ends up looking ~18 degrees further down than the same
 * pitch would give on flat terrain.
 *
 * The rig keeps its own heading as a tangent vector at the player's position. Each
 * frame the heading is re-projected onto the player's (new) tangent plane, which
 * parallel-transports it as they walk: the view stays put in world terms instead of
 * spinning when the player crosses a pole. `camera.up` is the player's local up, so
 * "down" on screen is always towards the planet's core.
 */
export class CameraRig {
  /** Props shorter than this never push the camera; they cannot fill the frame. */
  private static readonly MIN_BLOCK_HEIGHT = 2.4;
  /** Obstructions inside the hero's own body space are ignored. */
  private static readonly IGNORE_WITHIN = 1.6;
  /**
   * How close the camera will get to clear an obstruction. Pulling in cannot
   * always solve occlusion — a tree two metres behind you is between you and the
   * camera at any distance — so this is set tight enough that the hero always
   * stays on screen, which matters more than a roomy frame.
   */
  private static readonly MIN_BLOCKED_DISTANCE = 2.4;

  /** Tangent direction the camera looks along. */
  heading = new Vector3(0, 0, -1);
  pitch = 0.2;
  distance = 9.6;

  private position = new Vector3();
  private focus = new Vector3();
  private up = new Vector3(0, 1, 0);
  private right = new Vector3(1, 0, 0);
  private shakeAmount = 0;
  private shakeTime = 0;
  private initialised = false;
  /** Extra pull-back while sprinting or fighting, blended in smoothly. */
  private distanceBias = 0;

  constructor(readonly camera: PerspectiveCamera) {}

  /** Snap the rig behind the player, e.g. after loading a save. */
  reset(dir: Vector3, forward: Vector3): void {
    this.up.copy(dir).normalize();
    tangentise(forward, this.up, this.heading);
    this.initialised = false;
  }

  orbit(dxPixels: number, dyPixels: number): void {
    // 0.0032 rad/px is a comfortable default for both mouse drag and pointer lock.
    rotateTangent(this.heading, this.up, -dxPixels * 0.0032);
    this.pitch = clamp(this.pitch + dyPixels * 0.0026, MIN_PITCH, MAX_PITCH);
  }

  zoom(steps: number): void {
    this.distance = clamp(this.distance + steps * 0.85, MIN_DISTANCE, MAX_DISTANCE);
  }

  shake(amount: number): void {
    this.shakeAmount = Math.min(0.85, this.shakeAmount + amount);
  }

  setDistanceBias(bias: number): void {
    this.distanceBias = bias;
  }

  /** Tangent basis the player's movement input is expressed in. */
  get forwardTangent(): Vector3 {
    return this.heading;
  }

  get rightTangent(): Vector3 {
    return this.right;
  }

  /**
   * Pull the camera in when something tall stands between it and the hero.
   *
   * Sweeps outwards from the focus and stops short of the first obstruction —
   * testing only the camera's own position would happily leave a tree filling the
   * middle of the screen.
   *
   * It ignores anything shorter than the hero, since a boulder or a market stall
   * cannot fill the frame from behind, and anything inside the hero's own body
   * space.
   */
  private clearDistance(
    focus: Vector3,
    offset: Vector3,
    wanted: number,
    blockers: readonly Blocker[],
  ): number {
    if (blockers.length === 0) return wanted;
    const playerDir = _v6.copy(focus).normalize();

    // Prefilter once: only tall blockers the ray could possibly reach.
    _nearby.length = 0;
    for (let i = 0; i < blockers.length; i++) {
      const blocker = blockers[i];
      if (blocker.height < CameraRig.MIN_BLOCK_HEIGHT) continue;
      if (arcAngle(playerDir, blocker.dir) * PLANET_RADIUS > wanted + blocker.radius + 1) continue;
      _nearby.push(blocker);
    }
    if (_nearby.length === 0) return wanted;

    const steps = 8;
    for (let step = 1; step <= steps; step++) {
      const distance = (wanted * step) / steps;
      if (distance < CameraRig.IGNORE_WITHIN) continue;
      const sample = _v7.copy(focus).addScaledVector(offset, distance);
      const dir = _v8.copy(sample).normalize();
      const groundHeight = sample.length() - (PLANET_RADIUS + surfaceHeight(dir));
      for (let i = 0; i < _nearby.length; i++) {
        const blocker = _nearby[i];
        if (groundHeight > blocker.height + 0.2) continue;
        if (arcAngle(dir, blocker.dir) * PLANET_RADIUS < blocker.radius + 0.4) {
          return Math.max(CameraRig.MIN_BLOCKED_DISTANCE, (wanted * (step - 1)) / steps);
        }
      }
    }
    return wanted;
  }

  update(dt: number, playerDir: Vector3, eyeHeight: number, blockers: readonly Blocker[] = []): void {
    this.up.copy(playerDir).normalize();
    // Re-project the heading so it stays tangent as the player moves.
    tangentise(this.heading, this.up, this.heading);
    rightOf(this.heading, this.up, this.right);

    const focusRadius = PLANET_RADIUS + surfaceHeight(this.up) + eyeHeight;
    const desiredFocus = _v1.copy(this.up).multiplyScalar(focusRadius);

    const wanted = clamp(this.distance + this.distanceBias, MIN_DISTANCE, MAX_DISTANCE + 2);
    const back = _v2.copy(this.heading).multiplyScalar(-Math.cos(this.pitch));
    const lift = _v3.copy(this.up).multiplyScalar(Math.sin(this.pitch));
    const offset = back.add(lift).normalize();
    const distance = this.clearDistance(desiredFocus, offset, wanted, blockers);
    const desiredPos = _v4.copy(desiredFocus).addScaledVector(offset, distance);

    // Keep the camera above the terrain it is flying over.
    const camDir = _v5.copy(desiredPos).normalize();
    const minRadius = PLANET_RADIUS + surfaceHeight(camDir) + 1.8;
    if (desiredPos.length() < minRadius) desiredPos.copy(camDir).multiplyScalar(minRadius);

    if (!this.initialised) {
      this.initialised = true;
      this.position.copy(desiredPos);
      this.focus.copy(desiredFocus);
    } else {
      // Snap in quickly when something blocks the view, ease back out gently.
      const closing = desiredPos.distanceToSquared(this.focus) < this.position.distanceToSquared(this.focus);
      this.position.lerp(desiredPos, damp(dt, closing ? 0.028 : 0.11));
      this.focus.lerp(desiredFocus, damp(dt, 0.055));
    }

    this.camera.up.copy(this.up);
    this.camera.position.copy(this.position);

    if (this.shakeAmount > 0.0005) {
      this.shakeTime += dt * 42;
      const decay = this.shakeAmount;
      const ox = Math.sin(this.shakeTime * 1.7) * decay;
      const oy = Math.sin(this.shakeTime * 2.3 + 1.1) * decay;
      this.camera.position.addScaledVector(this.right, ox);
      this.camera.position.addScaledVector(this.up, oy);
      this.shakeAmount = Math.max(0, this.shakeAmount - dt * 3.1);
    } else {
      this.shakeAmount = 0;
    }

    this.camera.lookAt(this.focus);
  }
}

const _v1 = /* @__PURE__ */ new Vector3();
const _v2 = /* @__PURE__ */ new Vector3();
const _v3 = /* @__PURE__ */ new Vector3();
const _v4 = /* @__PURE__ */ new Vector3();
const _v5 = /* @__PURE__ */ new Vector3();
const _v6 = /* @__PURE__ */ new Vector3();
const _v7 = /* @__PURE__ */ new Vector3();
const _v8 = /* @__PURE__ */ new Vector3();
const _nearby: Blocker[] = [];
