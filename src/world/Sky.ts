import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  Mesh,
  Points,
  PointsMaterial,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { mulberry32 } from '../core/Random';
import {
  clamp,
  orientationFrom,
  PLANET_RADIUS,
  randomDirection,
  tangentise,
} from '../core/SphereMath';
import { toon } from '../render/ToonMaterials';
import type { Atmosphere } from '../render/Renderer';

const SKY_VERT = /* glsl */ `
  varying vec3 vWorldDir;
  void main() {
    vWorldDir = (modelMatrix * vec4(position, 1.0)).xyz - cameraPosition;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */ `
  uniform vec3 uUp;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uNadir;
  uniform float uHaze;
  varying vec3 vWorldDir;

  void main() {
    vec3 d = normalize(vWorldDir);
    float h = dot(d, normalize(uUp));
    vec3 colour = mix(uHorizon, uZenith, smoothstep(0.0, 0.62, h));
    colour = mix(uNadir, colour, smoothstep(-0.30, 0.03, h));
    // A band of haze hugging the horizon reads as atmosphere on a small world.
    float band = exp(-abs(h) * 7.0) * uHaze;
    colour += uHorizon * band * 0.35;
    gl_FragColor = vec4(colour, 1.0);
  }
`;

/**
 * Sky dome, stars and drifting clouds.
 *
 * The gradient is oriented by the player's local up rather than world +Y, so the
 * horizon always looks like a horizon no matter where on the globe you stand.
 */
export class Sky {
  readonly group = new Group();
  private dome: Mesh;
  private material: ShaderMaterial;
  private stars: Points;
  private starMaterial: PointsMaterial;
  private clouds: Group = new Group();
  private cloudSpin: Array<{ axis: Vector3; speed: number; node: Group }> = [];

  constructor(atmosphere: Atmosphere, seed = 0x3c0d) {
    this.material = new ShaderMaterial({
      uniforms: {
        uUp: { value: new Vector3(0, 1, 0) },
        uZenith: { value: atmosphere.sky.clone() },
        uHorizon: { value: atmosphere.horizon.clone() },
        uNadir: { value: atmosphere.ground.clone() },
        uHaze: { value: 1 },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: BackSide,
      depthWrite: false,
      fog: false,
    });
    this.material.toneMapped = false;

    this.dome = new Mesh(new SphereGeometry(760, 24, 16), this.material);
    this.dome.name = 'sky';
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -100;
    this.group.add(this.dome);

    // Starfield.
    const rng = mulberry32(seed);
    const starCount = 700;
    const positions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const d = randomDirection(rng).multiplyScalar(620 + rng() * 60);
      positions[i * 3] = d.x;
      positions[i * 3 + 1] = d.y;
      positions[i * 3 + 2] = d.z;
    }
    const starGeometry = new BufferGeometry();
    starGeometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    this.starMaterial = new PointsMaterial({
      color: 0xfff6e0,
      size: 3.4,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: AdditiveBlending,
      fog: false,
    });
    this.stars = new Points(starGeometry, this.starMaterial);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -99;
    this.group.add(this.stars);

    this.buildClouds(rng);
    this.group.add(this.clouds);
  }

  private buildClouds(rng: () => number): void {
    const puff = new IcosahedronGeometry(1, 1);
    const material = toon({ color: 0xfdfcff, steps: 3, transparent: true, opacity: 0.93 });
    const clusterCount = 16;
    for (let i = 0; i < clusterCount; i++) {
      const cluster = new Group();
      const puffs = 3 + Math.floor(rng() * 4);
      for (let p = 0; p < puffs; p++) {
        const mesh = new Mesh(puff, material);
        mesh.position.set((rng() - 0.5) * 5.5, (rng() - 0.5) * 1.1, (rng() - 0.5) * 3.4);
        const scale = 1.1 + rng() * 1.5;
        mesh.scale.set(scale * 1.35, scale * 0.72, scale);
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        cluster.add(mesh);
      }
      const orbit = new Group();
      const dir = randomDirection(rng);
      const altitude = PLANET_RADIUS + 19 + rng() * 13;
      cluster.position.copy(dir).multiplyScalar(altitude);
      // Lay the cluster flat against the sphere.
      const forward = tangentise(randomDirection(rng), dir);
      orientationFrom(dir, forward, cluster.quaternion);
      orbit.add(cluster);
      this.clouds.add(orbit);
      this.cloudSpin.push({
        axis: tangentise(randomDirection(rng), dir).cross(dir).normalize(),
        speed: (0.006 + rng() * 0.012) * (rng() > 0.5 ? 1 : -1),
        node: orbit,
      });
    }
  }

  update(dt: number, cameraPosition: Vector3, up: Vector3, atmosphere: Atmosphere): void {
    this.group.position.copy(cameraPosition);
    this.dome.position.set(0, 0, 0);
    (this.material.uniforms.uUp.value as Vector3).copy(up);
    (this.material.uniforms.uZenith.value as Color).copy(atmosphere.sky);
    (this.material.uniforms.uHorizon.value as Color).copy(atmosphere.horizon);
    (this.material.uniforms.uNadir.value as Color).copy(atmosphere.ground);

    // Stars fade in as the sky darkens — the Cinder Hollow is where you see them.
    const luminance =
      atmosphere.sky.r * 0.3 + atmosphere.sky.g * 0.55 + atmosphere.sky.b * 0.15;
    this.starMaterial.opacity = clamp(0.95 - luminance * 7.5, 0, 0.9);

    // Clouds live in planet space, so undo the camera-follow offset.
    this.clouds.position.copy(cameraPosition).negate();
    for (const spin of this.cloudSpin) {
      spin.node.rotateOnWorldAxis(spin.axis, spin.speed * dt);
    }
  }
}
