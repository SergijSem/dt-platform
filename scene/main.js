import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TilesRenderer } from '3d-tiles-renderer/three';
import { ReorientationPlugin } from '3d-tiles-renderer/three/plugins';

import { loadStation } from './station.js';
import { bindTwin } from './twin.js';
import { createBench } from './bench.js';

export const params = new URLSearchParams(location.search);
export const opt = new Set(params.get('opt')?.split(',').filter(Boolean) ?? []);

const useTiles = params.get('tiles') === '1';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xc9dbea);

scene.add(new THREE.HemisphereLight(0xffffff, 0x556655, 2));

const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.position.set(30, 50, 20);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(
  60, innerWidth / innerHeight, 0.01, 10000
);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const station = await loadStation(scene, opt, renderer);
const s = station.maxSize;

if (useTiles) {
station.lod.position.y += 1.38;
}


// Види для звичайного перегляду електроскутера.
const scooterViews = {
  near: [3, 2, 3],
  mid: [15, 8, 15],
  hall: [55, 30, 55],
  far: [190, 110, 190]
};

// Види для перевірки потокового тайлсету 2048 × 2048 м.
const tileViews = {
  near: [80, 60, 80],
  mid: [180, 130, 180],
  hall: [400, 300, 400],
  far: [1100, 900, 1200]
};

const views = useTiles ? tileViews : scooterViews;
const distance = views[params.get('view')] ?? views.near;
const targetY = s * 0.35;

camera.position.set(...distance);
camera.lookAt(0, targetY, 0);
controls.target.set(0, targetY, 0);
controls.update();

// Умовна підлога для орієнтації в просторі.
const floor = new THREE.GridHelper(s * 8, 20, 0x667788, 0x99aabb);
floor.position.y = 0;
floor.visible = !useTiles;
scene.add(floor);

await bindTwin(station);

// Потокове завантаження 3D Tiles.
let tiles = null;

if (useTiles) {
  tiles = new TilesRenderer('./tiles/tileset.json');
  tiles.registerPlugin(
    new ReorientationPlugin({
      up: '+z',
      recenter: false
    })
  );
  // Цільова екранна похибка, пікселі.
  // Для повторного досліду: ?tiles=1&view=far&errorTarget=32
  tiles.errorTarget = Number(params.get('errorTarget') ?? 16);

  // Бюджет кешу: 32 MiB.
  tiles.lruCache.maxBytesSize = 32 * 1024 * 1024;
  tiles.lruCache.minBytesSize = 24 * 1024 * 1024;

  // Тайлсет розміщений нижче моделі електроскутера.
  tiles.group.position.y = -1.38;

  tiles.setCamera(camera);
  tiles.setResolutionFromRenderer(camera, renderer);

  scene.add(tiles.group);
}

// ?cull=0 вимикає відсікання об'єктів за пірамідою видимості.
if (params.get('cull') === '0') {
  scene.traverse((object) => {
    object.frustumCulled = false;
  });
}

window.__sceneStats = () => {
  const info = renderer.info.render;

  return {
    view: params.get('view') ?? 'near',
    culling: params.get('cull') === '0' ? 'ні' : 'так',
    calls: info.calls,
    triangles: info.triangles,
    lodLevel: station.lod.getCurrentLevel(),
    frustumCulled: station.lod.frustumCulled,
    tiles: tiles ? {
      errorTarget: tiles.errorTarget,
      cached: tiles.stats.inCache,
      visible: tiles.stats.visible,
      active: tiles.stats.active,
      queued: tiles.stats.queued,
      downloading: tiles.stats.downloading,
      parsing: tiles.stats.parsing,
      cachedMiB: Number(
        (tiles.lruCache.cachedBytes / 1024 / 1024).toFixed(2)
      ),
      cacheLimitMiB: 32,
      cacheFull: tiles.lruCache.isFull()
    } : null
  };
};

window.__tiles = tiles;
window.__sceneStatsReady = true;

const bench = params.has('bench')
  ? createBench({
      renderer,
      camera,
      controls,
      scene,
      duration: Number(params.get('bench')) || 30
    })
  : null;

const stats = document.getElementById('stats');

function frame(now) {
  bench?.beforeFrame(now);

  const cpuStart = performance.now();

  controls.update();

  if (tiles) {
    camera.updateMatrixWorld();
    tiles.update();
  }

  bench?.beginRender();
  renderer.render(scene, camera);

  if (!window.__deferStarted && opt.has('defer')) {
    window.__deferStarted = true;

    station.afterFirstFrame().catch((error) => {
      console.error('Помилка відкладеного завантаження:', error);
    });
  }
  const cpuMs = performance.now() - cpuStart;
  bench?.endRender(cpuMs);

  const info = renderer.info.render;

  if (tiles) {
    stats.textContent =
      `Трикутників: ${info.triangles} · ` +
      `тайлів у кеші: ${tiles.stats.inCache} · ` +
      `видимих: ${tiles.stats.visible} · ` +
      `завантаження: ${tiles.stats.downloading} · ` +
      `кеш: ${(tiles.lruCache.cachedBytes / 1024 / 1024).toFixed(1)} / 32 MiB`;
  } else {
    stats.textContent =
      `Викликів: ${info.calls} · трикутників: ${info.triangles}`;
  }
}

renderer.setAnimationLoop(frame);

addEventListener('resize', () => {
  if (bench) return;

  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);

  if (tiles) {
    tiles.setResolutionFromRenderer(camera, renderer);
  }
});