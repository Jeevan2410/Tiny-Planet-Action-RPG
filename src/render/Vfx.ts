import {
  AdditiveBlending,
  Color,
  DynamicDrawUsage,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  RingGeometry,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
} from 'three';
import { clamp, orientationFrom, PLANET_RADIUS, surfaceHeight, tangentise } from '../core/SphereMath';

interface Particle {
  position: Vector3;
  velocity: Vector3;
  life: number;
  maxLife: number;
  size: number;
  color: Color;
  gravity: number;
  drag: number;
  active: boolean;
}

interface Decal {
  mesh: Mesh;
  life: number;
  maxLife: number;
  fromScale: number;
  toScale: number;
  fromOpacity: number;
  toOpacity: number;
  spin: number;
}

const MAX_PARTICLES = 220;

/**
 * Pooled combat and world effects.
 *
 * Particles all live in one `InstancedMesh` (one draw call for the lot), and the
 * flat effects — slash arcs, telegraph rings, shockwaves — come from a pool of
 * ring sectors laid onto the local tangent plane.
 */
export class Vfx {
  readonly group = new Group();

  private particles: Particle[] = [];
  private particleMesh: InstancedMesh;
  private dummy = new Object3D();
  private matrix = new Matrix4();

  private decals: Decal[] = [];
  private decalPool: Mesh[] = [];
  private arcGeometries = new Map<string, BufferGeometry>();
  private sphereGeometry = new SphereGeometry(1, 12, 9);

  constructor() {
    this.group.name = 'vfx';
    const geometry = new IcosahedronGeometry(0.11, 0);
    const material = new MeshBasicMaterial({
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: AdditiveBlending,
      fog: false,
      vertexColors: false,
    });
    material.toneMapped = false;
    this.particleMesh = new InstancedMesh(geometry, material, MAX_PARTICLES);
    this.particleMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.particleMesh.frustumCulled = false;
    this.particleMesh.count = MAX_PARTICLES;
    // Per-instance colour so one mesh can carry sparks of every flavour.
    this.particleMesh.instanceColor = null;
    this.particleMesh.setColorAt(0, new Color(0xffffff));
    this.particleMesh.instanceColor!.setUsage(DynamicDrawUsage);
    this.group.add(this.particleMesh);

    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({
        position: new Vector3(),
        velocity: new Vector3(),
        life: 0,
        maxLife: 1,
        size: 1,
        color: new Color(),
        gravity: 0,
        drag: 1,
        active: false,
      });
    }
    this.hideAllParticles();
  }

  private hideAllParticles(): void {
    this.matrix.makeScale(0, 0, 0);
    for (let i = 0; i < MAX_PARTICLES; i++) this.particleMesh.setMatrixAt(i, this.matrix);
    this.particleMesh.instanceMatrix.needsUpdate = true;
  }

  private nextParticle(): Particle | null {
    for (let i = 0; i < this.particles.length; i++) {
      if (!this.particles[i].active) return this.particles[i];
    }
    return null;
  }

  /** A burst of sparks that arc away and fall back to the ground. */
  burst(
    position: Vector3,
    options: {
      count?: number;
      color?: number | Color;
      speed?: number;
      spread?: number;
      life?: number;
      size?: number;
      gravity?: number;
      direction?: Vector3;
    } = {},
  ): void {
    const count = options.count ?? 10;
    const colour = options.color instanceof Color ? options.color : new Color(options.color ?? 0xffe9a8);
    const speed = options.speed ?? 6;
    const life = options.life ?? 0.42;
    const size = options.size ?? 1;
    const gravity = options.gravity ?? 16;
    const up = _v1.copy(position).normalize();

    for (let i = 0; i < count; i++) {
      const particle = this.nextParticle();
      if (!particle) return;
      particle.active = true;
      particle.position.copy(position);
      const spread = options.spread ?? 1;
      _v2.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
      if (options.direction) _v2.lerp(options.direction, 0.55).normalize();
      _v2.addScaledVector(up, 0.55).normalize();
      particle.velocity.copy(_v2).multiplyScalar(speed * (0.45 + Math.random() * spread));
      particle.life = life * (0.7 + Math.random() * 0.6);
      particle.maxLife = particle.life;
      particle.size = size * (0.65 + Math.random() * 0.7);
      particle.color.copy(colour);
      particle.gravity = gravity;
      particle.drag = 2.2;
    }
  }

  /** A slow drifting mote, used for blight haze and shrine light. */
  mote(position: Vector3, colour: number | Color, rise = 1.4, life = 1.6): void {
    const particle = this.nextParticle();
    if (!particle) return;
    const up = _v1.copy(position).normalize();
    particle.active = true;
    particle.position.copy(position);
    particle.velocity
      .set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1)
      .multiplyScalar(0.5)
      .addScaledVector(up, rise);
    particle.life = life * (0.6 + Math.random() * 0.8);
    particle.maxLife = particle.life;
    particle.size = 0.5 + Math.random() * 0.6;
    particle.color.set(colour as number);
    particle.gravity = -1.2;
    particle.drag = 0.6;
  }

  private arcGeometry(halfArc: number): BufferGeometry {
    const key = halfArc.toFixed(2);
    let geometry = this.arcGeometries.get(key);
    if (!geometry) {
      const full = halfArc >= Math.PI - 0.01;
      const thetaLength = full ? Math.PI * 2 : halfArc * 2;
      const thetaStart = full ? 0 : Math.PI / 2 - halfArc;
      geometry = new RingGeometry(0.42, 1, Math.max(10, Math.ceil(thetaLength * 12)), 1, thetaStart, thetaLength);
      // RingGeometry is authored in XY; lay it flat so +Y maps to -Z (forward).
      geometry.rotateX(-Math.PI / 2);
      this.arcGeometries.set(key, geometry);
    }
    return geometry;
  }

  private takeDecal(geometry: BufferGeometry, colour: number | Color, opacity: number): Mesh {
    let mesh = this.decalPool.pop();
    if (!mesh) {
      const material = new MeshBasicMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        fog: false,
      });
      material.toneMapped = false;
      mesh = new Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = 6;
    }
    mesh.geometry = geometry;
    const material = mesh.material as MeshBasicMaterial;
    material.color.set(colour as number);
    material.opacity = opacity;
    mesh.visible = true;
    this.group.add(mesh);
    return mesh;
  }

  /** The sweep of a melee swing, laid on the ground in front of the attacker. */
  slash(
    dir: Vector3,
    forward: Vector3,
    reach: number,
    halfArc: number,
    colour: number | Color = 0xfff0c0,
    height = 0.9,
  ): void {
    const mesh = this.takeDecal(this.arcGeometry(halfArc), colour, 0.85);
    mesh.position.copy(dir).multiplyScalar(PLANET_RADIUS + surfaceHeight(dir) + height);
    orientationFrom(dir, tangentise(_v3.copy(forward), dir, _v3), mesh.quaternion);
    mesh.scale.setScalar(reach * 0.72);
    this.decals.push({
      mesh,
      life: 0.22,
      maxLife: 0.22,
      fromScale: reach * 0.72,
      toScale: reach * 1.06,
      fromOpacity: 0.85,
      toOpacity: 0,
      spin: 0,
    });
  }

  /**
   * A ring on the ground. Used for enemy wind-up telegraphs (the ring grows to
   * fill the area that is about to be dangerous) and for shockwaves.
   */
  ring(
    dir: Vector3,
    fromRadius: number,
    toRadius: number,
    duration: number,
    colour: number | Color = 0xff5c5c,
    opacity = 0.65,
    height = 0.12,
  ): void {
    const mesh = this.takeDecal(this.arcGeometry(Math.PI), colour, opacity);
    mesh.position.copy(dir).multiplyScalar(PLANET_RADIUS + surfaceHeight(dir) + height);
    orientationFrom(dir, tangentise(_v3.set(dir.y, dir.z, dir.x), dir, _v3), mesh.quaternion);
    mesh.scale.setScalar(fromRadius);
    this.decals.push({
      mesh,
      life: duration,
      maxLife: duration,
      fromScale: fromRadius,
      toScale: toRadius,
      fromOpacity: opacity,
      toOpacity: 0,
      spin: 0,
    });
  }

  /** An expanding light sphere — shrine cures, level ups, big impacts. */
  shockSphere(position: Vector3, radius: number, colour: number | Color, duration = 0.6): void {
    const mesh = this.takeDecal(this.sphereGeometry, colour, 0.5);
    mesh.position.copy(position);
    mesh.quaternion.identity();
    mesh.scale.setScalar(0.3);
    this.decals.push({
      mesh,
      life: duration,
      maxLife: duration,
      fromScale: 0.3,
      toScale: radius,
      fromOpacity: 0.5,
      toOpacity: 0,
      spin: 0,
    });
  }

  update(dt: number): void {
    // Particles.
    let anyActive = false;
    for (let i = 0; i < this.particles.length; i++) {
      const particle = this.particles[i];
      if (!particle.active) {
        this.matrix.makeScale(0, 0, 0);
        this.particleMesh.setMatrixAt(i, this.matrix);
        continue;
      }
      anyActive = true;
      particle.life -= dt;
      if (particle.life <= 0) {
        particle.active = false;
        this.matrix.makeScale(0, 0, 0);
        this.particleMesh.setMatrixAt(i, this.matrix);
        continue;
      }
      const up = _v1.copy(particle.position).normalize();
      particle.velocity.addScaledVector(up, -particle.gravity * dt);
      particle.velocity.multiplyScalar(Math.max(0, 1 - particle.drag * dt));
      particle.position.addScaledVector(particle.velocity, dt);
      // Do not let sparks sink into the planet.
      const floor = PLANET_RADIUS + surfaceHeight(up) + 0.06;
      if (particle.position.length() < floor) {
        particle.position.copy(up).multiplyScalar(floor);
        particle.velocity.multiplyScalar(0.25);
      }
      const t = clamp(particle.life / particle.maxLife, 0, 1);
      const scale = particle.size * (0.35 + t * 0.75);
      this.dummy.position.copy(particle.position);
      this.dummy.quaternion.identity();
      this.dummy.scale.setScalar(scale);
      this.dummy.updateMatrix();
      this.particleMesh.setMatrixAt(i, this.dummy.matrix);
      _colour.copy(particle.color).multiplyScalar(0.35 + t * 0.9);
      this.particleMesh.setColorAt(i, _colour);
    }
    this.particleMesh.instanceMatrix.needsUpdate = true;
    if (this.particleMesh.instanceColor) this.particleMesh.instanceColor.needsUpdate = true;
    this.particleMesh.visible = anyActive;

    // Flat decals.
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const decal = this.decals[i];
      decal.life -= dt;
      const t = 1 - clamp(decal.life / decal.maxLife, 0, 1);
      const eased = t * (2 - t);
      decal.mesh.scale.setScalar(decal.fromScale + (decal.toScale - decal.fromScale) * eased);
      const material = decal.mesh.material as MeshBasicMaterial;
      material.opacity = decal.fromOpacity + (decal.toOpacity - decal.fromOpacity) * t;
      if (decal.spin) decal.mesh.rotateY(decal.spin * dt);
      if (decal.life <= 0) {
        decal.mesh.visible = false;
        this.group.remove(decal.mesh);
        this.decalPool.push(decal.mesh);
        this.decals.splice(i, 1);
      }
    }
  }

  clear(): void {
    for (const particle of this.particles) particle.active = false;
    for (const decal of this.decals) {
      decal.mesh.visible = false;
      this.group.remove(decal.mesh);
      this.decalPool.push(decal.mesh);
    }
    this.decals.length = 0;
    this.hideAllParticles();
  }
}

const _v1 = /* @__PURE__ */ new Vector3();
const _v2 = /* @__PURE__ */ new Vector3();
const _v3 = /* @__PURE__ */ new Vector3();
const _colour = /* @__PURE__ */ new Color();
