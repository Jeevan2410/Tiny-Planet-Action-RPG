import {
  BackSide,
  Color,
  DataTexture,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  NearestFilter,
  RedFormat,
  ShaderMaterial,
  SRGBColorSpace,
  type BufferGeometry,
  type Material,
  type Texture,
} from 'three';

/**
 * Cel shading, the cheap and cheerful way: `MeshToonMaterial` reads a 1D gradient
 * map to quantise diffuse lighting into hard bands (the approach used by the
 * three.js toon examples), and characters get a second inverted-hull pass for the
 * ink outline.
 */

const gradientCache = new Map<number, Texture>();

/** A `steps`-band ramp used as the toon gradient map. */
export function toonGradient(steps = 3): Texture {
  const cached = gradientCache.get(steps);
  if (cached) return cached;
  const data = new Uint8Array(steps);
  for (let i = 0; i < steps; i++) {
    // Keep the darkest band off pure black so shadowed sides still read.
    const t = (i + 1) / steps;
    data[i] = Math.round(60 + 195 * t * t);
  }
  const texture = new DataTexture(data, steps, 1, RedFormat);
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  gradientCache.set(steps, texture);
  return texture;
}

export interface ToonOptions {
  color?: number | string | Color;
  emissive?: number | string | Color;
  emissiveIntensity?: number;
  steps?: number;
  flatShading?: boolean;
  vertexColors?: boolean;
  transparent?: boolean;
  opacity?: number;
  doubleSide?: boolean;
  fog?: boolean;
}

const materialCache = new Map<string, MeshToonMaterial>();

/** Shared toon material. Cached by option signature to keep draw calls batched. */
export function toon(options: ToonOptions = {}): MeshToonMaterial {
  const key = JSON.stringify([
    new Color(options.color ?? 0xffffff).getHex(),
    options.emissive ? new Color(options.emissive).getHex() : 0,
    options.emissiveIntensity ?? 1,
    options.steps ?? 3,
    !!options.flatShading,
    !!options.vertexColors,
    !!options.transparent,
    options.opacity ?? 1,
    !!options.doubleSide,
    options.fog ?? true,
  ]);
  const cached = materialCache.get(key);
  if (cached) return cached;
  const material = new MeshToonMaterial({
    color: options.color ?? 0xffffff,
    emissive: options.emissive ?? 0x000000,
    emissiveIntensity: options.emissiveIntensity ?? 1,
    gradientMap: toonGradient(options.steps ?? 3),
    vertexColors: !!options.vertexColors,
    transparent: !!options.transparent,
    opacity: options.opacity ?? 1,
    fog: options.fog ?? true,
  });
  // three's typings omit `flatShading` on MeshToonMaterial even though the
  // renderer honours it for every material, so set it through a narrow cast.
  (material as unknown as { flatShading: boolean }).flatShading = !!options.flatShading;
  if (options.doubleSide) material.side = DoubleSide;
  materialCache.set(key, material);
  return material;
}

/**
 * A one-off toon material. Characters need their own instance so a hit flash can
 * drive `emissive` on just that actor without touching everything else on screen.
 */
export function toonUnique(options: ToonOptions = {}): MeshToonMaterial {
  const material = new MeshToonMaterial({
    color: options.color ?? 0xffffff,
    emissive: options.emissive ?? 0x000000,
    emissiveIntensity: options.emissiveIntensity ?? 1,
    gradientMap: toonGradient(options.steps ?? 3),
    vertexColors: !!options.vertexColors,
    transparent: !!options.transparent,
    opacity: options.opacity ?? 1,
    fog: options.fog ?? true,
  });
  (material as unknown as { flatShading: boolean }).flatShading = !!options.flatShading;
  if (options.doubleSide) material.side = DoubleSide;
  return material;
}

/** An unlit material, for glows, bars and VFX that should not be shaded. */
const flatCache = new Map<string, MeshBasicMaterial>();
export function flat(
  color: number | string,
  opacity = 1,
  options: { fog?: boolean; doubleSide?: boolean } = {},
): MeshBasicMaterial {
  const key = `${new Color(color).getHex()}|${opacity}|${options.fog !== false}|${!!options.doubleSide}`;
  const cached = flatCache.get(key);
  if (cached) return cached;
  const material = new MeshBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    fog: options.fog !== false,
    depthWrite: opacity >= 1,
  });
  if (options.doubleSide) material.side = DoubleSide;
  flatCache.set(key, material);
  return material;
}

const OUTLINE_VERT = /* glsl */ `
  uniform float uThickness;
  void main() {
    vec3 inflated = position + normalize(normal) * uThickness;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(inflated, 1.0);
  }
`;

const OUTLINE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  void main() {
    gl_FragColor = vec4(uColor, 1.0);
  }
`;

/**
 * Inverted-hull outline: draw the same geometry inflated along its normals with
 * front faces culled, so only the silhouette sliver survives.
 */
export function outlineMaterial(thickness = 0.03, color = 0x140f1f): ShaderMaterial {
  const material = new ShaderMaterial({
    uniforms: {
      uThickness: { value: thickness },
      uColor: { value: new Color(color) },
    },
    vertexShader: OUTLINE_VERT,
    fragmentShader: OUTLINE_FRAG,
    side: BackSide,
  });
  material.toneMapped = false;
  return material;
}

/** Attach an outline shell to a mesh. Returns the shell so it can be recoloured. */
export function addOutline(mesh: Mesh, thickness = 0.03, color = 0x140f1f): Mesh {
  const shell = new Mesh(mesh.geometry as BufferGeometry, outlineMaterial(thickness, color));
  shell.name = 'outline';
  shell.renderOrder = -1;
  shell.castShadow = false;
  shell.receiveShadow = false;
  shell.matrixAutoUpdate = false;
  mesh.add(shell);
  return shell;
}

/** Recursively outline every mesh under a node (characters, shrines, signposts). */
export function outlineTree(root: import('three').Object3D, thickness = 0.03, color = 0x140f1f): void {
  const meshes: Mesh[] = [];
  root.traverse((child) => {
    if ((child as Mesh).isMesh && child.name !== 'outline' && !child.userData.noOutline) {
      meshes.push(child as Mesh);
    }
  });
  for (const mesh of meshes) addOutline(mesh, thickness, color);
}

/** Convert a hex colour to a `Color` in the working colour space. */
export function srgb(hex: number | string): Color {
  return new Color().setStyle(typeof hex === 'number' ? `#${hex.toString(16).padStart(6, '0')}` : hex, SRGBColorSpace);
}

export function disposeMaterial(material: Material | Material[]): void {
  if (Array.isArray(material)) material.forEach((m) => m.dispose());
  else material.dispose();
}
