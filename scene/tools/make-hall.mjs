// Просте оточення для сцени електроскутера.
// Запуск з каталогу scene: node tools/make-hall.mjs
// Вихід: models/hall.glb

import * as THREE from 'three';
import { Document, NodeIO } from '@gltf-transform/core';
import fs from 'node:fs/promises';

const OUT = 'models/hall.glb';

const WIDTH = 40;
const DEPTH = 40;
const HEIGHT = 8;
const WALL = 0.2;

const doc = new Document();
const buffer = doc.createBuffer();
const root = doc.createNode('hall');
doc.createScene('hall').addChild(root);

function accessor(array, type) {
  return doc.createAccessor()
    .setArray(array)
    .setType(type)
    .setBuffer(buffer);
}

function material(name, color, roughness = 0.85) {
  return doc.createMaterial(name)
    .setBaseColorFactor([...color, 1])
    .setMetallicFactor(0)
    .setRoughnessFactor(roughness)
    .setDoubleSided(true);
}

function addBox(name, w, h, d, x, y, z, mat) {
  const geometry = new THREE.BoxGeometry(w, h, d);
  const a = geometry.attributes;

  const primitive = doc.createPrimitive()
    .setMaterial(mat)
    .setAttribute('POSITION', accessor(
      new Float32Array(a.position.array), 'VEC3'
    ))
    .setAttribute('NORMAL', accessor(
      new Float32Array(a.normal.array), 'VEC3'
    ))
    .setAttribute('TEXCOORD_0', accessor(
      new Float32Array(a.uv.array), 'VEC2'
    ))
    .setIndices(accessor(
      new Uint16Array(geometry.index.array), 'SCALAR'
    ));

  const mesh = doc.createMesh(name).addPrimitive(primitive);

  root.addChild(
    doc.createNode(name)
      .setMesh(mesh)
      .setTranslation([x, y, z])
  );

  geometry.dispose();
}

const floor = material('floor', [0.48, 0.49, 0.46]);
const walls = material('walls', [0.72, 0.74, 0.76]);

// Підлога: верхня поверхня на Y = 0.
addBox(
  'hall-floor',
  WIDTH, WALL, DEPTH,
  0, -WALL / 2, 0,
  floor
);

// Дві довгі стіни.
addBox(
  'hall-wall-north',
  WIDTH, HEIGHT, WALL,
  0, HEIGHT / 2, -DEPTH / 2,
  walls
);

addBox(
  'hall-wall-south',
  WIDTH, HEIGHT, WALL,
  0, HEIGHT / 2, DEPTH / 2,
  walls
);

// Дві короткі стіни.
addBox(
  'hall-wall-west',
  WALL, HEIGHT, DEPTH,
  -WIDTH / 2, HEIGHT / 2, 0,
  walls
);

addBox(
  'hall-wall-east',
  WALL, HEIGHT, DEPTH,
  WIDTH / 2, HEIGHT / 2, 0,
  walls
);

await fs.mkdir('models', { recursive: true });

const io = new NodeIO();
await fs.writeFile(OUT, await io.writeBinary(doc));

console.log(`Готово: ${OUT}`);