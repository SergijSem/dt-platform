import { Document, NodeIO, Accessor } from '@gltf-transform/core';
import fs from 'node:fs/promises';
import path from 'node:path';

const OUT = path.resolve('tiles');
const TILE_SIZE = 2048;
const CELLS = 64;
const LEVELS = 4;
const io = new NodeIO();

function height(x, z) {
  return (
    10 * Math.sin(x / 150) * Math.cos(z / 170) +
    3 * Math.sin((x + z) / 65) +
    1.5 * Math.cos((x - z) / 37)
  );
}

function makeTileDocument(x0, z0, size) {
  const doc = new Document();
  const buffer = doc.createBuffer();

  const positions = [];
  const normals = [];
  const indices = [];

  const step = size / CELLS;

  for (let iz = 0; iz <= CELLS; iz++) {
    for (let ix = 0; ix <= CELLS; ix++) {
      const x = x0 + ix * step;
      const z = z0 + iz * step;
      const y = height(x, z);

      positions.push(x, y, z);

      // Нормалі для плавного освітлення поверхні.
      const dx = (height(x + 0.1, z) - height(x - 0.1, z)) / 0.2;
      const dz = (height(x, z + 0.1) - height(x, z - 0.1)) / 0.2;
      const nx = -dx;
      const ny = 1;
      const nz = -dz;
      const len = Math.hypot(nx, ny, nz);

      normals.push(nx / len, ny / len, nz / len);
    }
  }

  for (let iz = 0; iz < CELLS; iz++) {
    for (let ix = 0; ix < CELLS; ix++) {
      const a = iz * (CELLS + 1) + ix;
      const b = a + 1;
      const c = a + CELLS + 1;
      const d = c + 1;

      // Два трикутники комірки, нормаль спрямована вгору.
      indices.push(a, c, b, b, c, d);
    }
  }

  const positionAccessor = doc.createAccessor('POSITION', buffer)
    .setType(Accessor.Type.VEC3)
    .setArray(new Float32Array(positions));

  const normalAccessor = doc.createAccessor('NORMAL', buffer)
    .setType(Accessor.Type.VEC3)
    .setArray(new Float32Array(normals));

  const indexAccessor = doc.createAccessor('INDICES', buffer)
    .setType(Accessor.Type.SCALAR)
    .setArray(new Uint16Array(indices));

  const material = doc.createMaterial('Terrain')
    .setBaseColorFactor([0.34, 0.48, 0.29, 1])
    .setMetallicFactor(0)
    .setRoughnessFactor(1);

  const primitive = doc.createPrimitive()
    .setAttribute('POSITION', positionAccessor)
    .setAttribute('NORMAL', normalAccessor)
    .setIndices(indexAccessor)
    .setMaterial(material);

  const mesh = doc.createMesh('TerrainTile').addPrimitive(primitive);
  const node = doc.createNode('TerrainTile').setMesh(mesh);
  const scene = doc.createScene('Terrain').addChild(node);

  doc.getRoot().setDefaultScene(scene);
  return doc;
}

function makeBoundingBox(x0, z0, size) {
  const cx = x0 + size / 2;
  const cy = -(z0 + size / 2);

  // Координати 3D Tiles: Z — вертикальна вісь.
  return [
    cx, cy, 0,
    size / 2, 0, 0,
    0, size / 2, 0,
    0, 0, 20
  ];
}

async function createTile(k, ix, iz) {
  const size = TILE_SIZE / (2 ** k);
  const x0 = -TILE_SIZE / 2 + ix * size;
  const z0 = -TILE_SIZE / 2 + iz * size;

  const file = `k${k}_${ix}_${iz}.glb`;
  const uri = path.join(OUT, file);

  const doc = makeTileDocument(x0, z0, size);
  await io.write(uri, doc);

  const tile = {
    boundingVolume: {
      box: makeBoundingBox(x0, z0, size)
    },
    geometricError: k === LEVELS ? 0 : 32 / (2 ** k),
    refine: 'REPLACE',
    content: {
      uri: file
    }
  };

  if (k < LEVELS) {
    tile.children = [];

    for (let dz = 0; dz < 2; dz++) {
      for (let dx = 0; dx < 2; dx++) {
        tile.children.push(
          await createTile(k + 1, ix * 2 + dx, iz * 2 + dz)
        );
      }
    }
  }

  return tile;
}

await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(OUT, { recursive: true });

console.log('Генерація тайлсету 3D Tiles 1.1...');
const root = await createTile(0, 0, 0);

const tileset = {
  asset: {
    version: '1.1',
    tilesetVersion: 'scooter-terrain-1'
  },
  geometricError: 32,
  root
};

await fs.writeFile(
  path.join(OUT, 'tileset.json'),
  JSON.stringify(tileset, null, 2)
);

const files = await fs.readdir(OUT);
let totalBytes = 0;

for (const file of files) {
  const stat = await fs.stat(path.join(OUT, file));
  totalBytes += stat.size;
}

const tileCount = files.filter(file => file.endsWith('.glb')).length;
const trianglesPerTile = CELLS * CELLS * 2;

console.log(`Готово: ${tileCount} тайлів`);
console.log(`Трикутників: ${tileCount * trianglesPerTile}`);
console.log(`Розмір: ${(totalBytes / 1024 / 1024).toFixed(2)} MiB`);
console.log(`Каталог: ${OUT}`);