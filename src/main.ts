import './style.css';
import { Vector3 } from 'three';
import { Renderer } from './render/Renderer';
import { CameraRig } from './render/CameraRig';
import { Input } from './core/Input';
import { Loop } from './core/Loop';
import { Planet } from './world/Planet';
import { Sky } from './world/Sky';
import { scatterProps } from './world/Scatter';
import { addFlatZone, PLANET_RADIUS, surfaceHeight, tangentise } from './core/SphereMath';
import { BIOMES, biomeAt, VILLAGE_DIR } from './world/Biomes';
import { buildHero } from './entities/Models';
import { SHRINE_BIOMES } from './rpg/Types';

const canvas = document.getElementById('scene') as HTMLCanvasElement;

addFlatZone(VILLAGE_DIR, 10, 17);
for (const biome of SHRINE_BIOMES) addFlatZone(BIOMES[biome].centre, 8, 15);

const renderer = new Renderer(canvas, {
  sky: BIOMES.meadow.atmosphere.sky.clone(),
  horizon: BIOMES.meadow.atmosphere.horizon.clone(),
  ground: BIOMES.meadow.atmosphere.ground.clone(),
  fog: BIOMES.meadow.atmosphere.fog.clone(),
  sun: BIOMES.meadow.atmosphere.sun.clone(),
  sunIntensity: BIOMES.meadow.atmosphere.sunIntensity,
  ambient: BIOMES.meadow.atmosphere.ambient,
});

const planet = new Planet(5);
renderer.scene.add(planet.mesh);

const sky = new Sky(renderer.palette);
renderer.scene.add(sky.group);

const exclusions = [
  { dir: VILLAGE_DIR, radius: 16 },
  ...SHRINE_BIOMES.map((b) => ({ dir: BIOMES[b].centre, radius: 13 })),
];
const scatter = scatterProps({ exclusions });
renderer.scene.add(scatter.group);

const hero = buildHero();
renderer.scene.add(hero.root);
const heroDir = VILLAGE_DIR.clone();
const heroForward = tangentise(new Vector3(0, 0, -1), heroDir);
hero.root.position.copy(heroDir).multiplyScalar(PLANET_RADIUS + surfaceHeight(heroDir));

const input = new Input(canvas);
const rig = new CameraRig(renderer.camera);
rig.reset(heroDir, heroForward);
const loop = new Loop();

window.addEventListener('resize', () => renderer.resize());

function frame(now: number) {
  const { dt, rawDt } = loop.begin(now);
  input.sample();
  const look = input.takeLook();
  rig.orbit(look.dx, look.dy);
  rig.zoom(input.takeZoom());
  rig.update(rawDt || 0.016, heroDir, 1.35);
  renderer.updateLighting(hero.root.position, heroDir, rig.rightTangent, rawDt || 0.016);
  renderer.applyAtmosphere(biomeAt(heroDir).atmosphere, rawDt || 0.016);
  sky.update(dt, renderer.camera.position, heroDir, renderer.palette);
  renderer.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

(window as unknown as { __ready: boolean }).__ready = true;
console.info(`[tiny-planet] props: ${scatter.propCount}, blockers: ${scatter.blockers.length}`);
