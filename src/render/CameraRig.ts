import { Vector3, type PerspectiveCamera } from 'three';
import {
  clamp,
  damp,
  PLANET_RADIUS,
  rightOf,
  rotateTangent,
  surfaceHeight,
  tangentise,
} from '../core/SphereMath';

const MIN_PITCH = -0.18;
const MAX_PITCH = 0.92;
const MIN_DISTANCE = 6.5;
const MAX_DISTANCE = 15;

/**
 * Third-person camera for a spherical world.
 *
 * The rig keeps its own heading as a tangent vector at the player's position. Each
 * frame the heading is re-projected onto the player's (new) tangent plane, which
 * parallel-transports it as they walk: the view stays put in world terms instead of
 * spinning when the player crosses a pole. `camera.up` is the player's local up, so
 * "down" on screen is always towards the planet's core.
 */
export class CameraRig {
  /** Tangent direction the camera looks along. */
  heading = new Vector3(0, 0, -1);
  pitch = 0.36;
  distance = 10.2;

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

  update(dt: number, playerDir: Vector3, eyeHeight: number): void {
    this.up.copy(playerDir).normalize();
    // Re-project the heading so it stays tangent as the player moves.
    tangentise(this.heading, this.up, this.heading);
    rightOf(this.heading, this.up, this.right);

    const focusRadius = PLANET_RADIUS + surfaceHeight(this.up) + eyeHeight;
    const desiredFocus = _v1.copy(this.up).multiplyScalar(focusRadius);

    const distance = clamp(this.distance + this.distanceBias, MIN_DISTANCE, MAX_DISTANCE + 2);
    const back = _v2.copy(this.heading).multiplyScalar(-Math.cos(this.pitch));
    const lift = _v3.copy(this.up).multiplyScalar(Math.sin(this.pitch));
    const desiredPos = _v4.copy(desiredFocus).addScaledVector(back.add(lift).normalize(), distance);

    // Keep the camera above the terrain it is flying over.
    const camDir = _v5.copy(desiredPos).normalize();
    const minRadius = PLANET_RADIUS + surfaceHeight(camDir) + 1.35;
    if (desiredPos.length() < minRadius) desiredPos.copy(camDir).multiplyScalar(minRadius);

    if (!this.initialised) {
      this.initialised = true;
      this.position.copy(desiredPos);
      this.focus.copy(desiredFocus);
    } else {
      this.position.lerp(desiredPos, damp(dt, 0.075));
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
