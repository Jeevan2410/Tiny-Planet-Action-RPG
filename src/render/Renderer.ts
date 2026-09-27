import {
  AmbientLight,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { damp, lerp, PLANET_RADIUS } from '../core/SphereMath';

export type Quality = 'low' | 'high';

export interface Atmosphere {
  sky: Color;
  horizon: Color;
  ground: Color;
  fog: Color;
  sun: Color;
  sunIntensity: number;
  ambient: number;
}

/**
 * Owns the WebGL context, camera and lighting.
 *
 * On a globe the "sun" cannot be a fixed world direction or half the planet would
 * be unplayable darkness, so the key light is kept up-and-to-the-left of the
 * viewer: it tracks the player's local up plus the camera's right vector, heavily
 * damped so orbiting the camera reads as the light gently swinging.
 */
export class Renderer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly sun: DirectionalLight;
  readonly hemi: HemisphereLight;
  readonly ambient: AmbientLight;
  readonly fog: FogExp2;

  private canvas: HTMLCanvasElement;
  private sunDir = new Vector3(0, 1, 0);
  private quality: Quality = 'high';
  private atmosphere: Atmosphere;

  constructor(canvas: HTMLCanvasElement, atmosphere: Atmosphere) {
    this.canvas = canvas;
    this.atmosphere = atmosphere;
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;

    this.camera = new PerspectiveCamera(58, 1, 0.12, 1600);
    this.camera.position.set(0, PLANET_RADIUS + 14, 24);

    this.fog = new FogExp2(atmosphere.fog.getHex(), 0.0125);
    this.scene.fog = this.fog;

    this.sun = new DirectionalLight(atmosphere.sun, atmosphere.sunIntensity);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const shadowCam = this.sun.shadow.camera;
    shadowCam.near = 1;
    shadowCam.far = 90;
    shadowCam.left = -20;
    shadowCam.right = 20;
    shadowCam.top = 20;
    shadowCam.bottom = -20;
    this.sun.shadow.bias = -0.0009;
    this.sun.shadow.normalBias = 0.035;
    this.scene.add(this.sun, this.sun.target);

    this.hemi = new HemisphereLight(atmosphere.horizon, atmosphere.ground, 0.75);
    this.ambient = new AmbientLight(0xffffff, atmosphere.ambient);
    this.scene.add(this.hemi, this.ambient);

    this.resize();
  }

  /** Blend towards a biome's palette. Called every frame with the local biome. */
  applyAtmosphere(target: Atmosphere, dt: number): void {
    const k = damp(dt, 0.45);
    this.atmosphere.fog.lerp(target.fog, k);
    this.atmosphere.sky.lerp(target.sky, k);
    this.atmosphere.horizon.lerp(target.horizon, k);
    this.atmosphere.ground.lerp(target.ground, k);
    this.atmosphere.sun.lerp(target.sun, k);
    this.atmosphere.sunIntensity = lerp(this.atmosphere.sunIntensity, target.sunIntensity, k);
    this.atmosphere.ambient = lerp(this.atmosphere.ambient, target.ambient, k);

    this.fog.color.copy(this.atmosphere.fog);
    this.sun.color.copy(this.atmosphere.sun);
    this.sun.intensity = this.atmosphere.sunIntensity;
    this.hemi.color.copy(this.atmosphere.horizon);
    this.hemi.groundColor.copy(this.atmosphere.ground);
    this.ambient.intensity = this.atmosphere.ambient;
  }

  get palette(): Atmosphere {
    return this.atmosphere;
  }

  /**
   * Re-aim the key light and its shadow frustum. `up` is the player's local up,
   * `right` the camera's right vector.
   */
  updateLighting(focus: Vector3, up: Vector3, right: Vector3, dt: number): void {
    const desired = _v1.copy(up).multiplyScalar(0.82).addScaledVector(right, -0.52).normalize();
    this.sunDir.lerp(desired, damp(dt, 0.5)).normalize();
    this.sun.position.copy(focus).addScaledVector(this.sunDir, 42);
    this.sun.target.position.copy(focus);
    this.sun.target.updateMatrixWorld();
  }

  setQuality(quality: Quality): void {
    this.quality = quality;
    this.renderer.shadowMap.enabled = quality === 'high';
    this.renderer.setPixelRatio(
      quality === 'high' ? Math.min(window.devicePixelRatio, 2) : Math.min(window.devicePixelRatio, 1),
    );
    this.sun.shadow.mapSize.set(quality === 'high' ? 1024 : 512, quality === 'high' ? 1024 : 512);
    if (this.sun.shadow.map) {
      this.sun.shadow.map.dispose();
      this.sun.shadow.map = null;
    }
    this.resize();
  }

  get currentQuality(): Quality {
    return this.quality;
  }

  resize(): void {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.renderer.dispose();
  }
}

const _v1 = /* @__PURE__ */ new Vector3();
