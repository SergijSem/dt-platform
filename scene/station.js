import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();

function elementOf(object) {
  while (object && object.userData.element === undefined) {
    object = object.parent;
  }
  return object?.userData.element;
}

function boxOf(model) {
  const bounds = new THREE.Box3().setFromObject(model);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());

  const geometry = new THREE.BoxGeometry(
    size.x, size.y, size.z
  );
  geometry.translate(center.x, center.y, center.z);

  return new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: 0x8a8f96,
      wireframe: false
    })
  );
}

export async function loadStation(scene) {
  const [gltf0, gltf1] = await Promise.all([
    loader.loadAsync('models/scooter.glb'),
    loader.loadAsync('models/scooter-lod1.glb')
  ]);

  const detailed = gltf0.scene;
  const simplified = gltf1.scene;

  const bounds = new THREE.Box3().setFromObject(detailed);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const maxSize = Math.max(size.x, size.y, size.z);

  const lod = new THREE.LOD();

  const model0 = detailed.clone(true);
  const model1 = simplified.clone(true);
  const box = boxOf(detailed);

  // Чотири рівні деталізації та відсікання за відстанню.
  lod.addLevel(model0, 0);
  lod.addLevel(model1, 15, 0.1);
  lod.addLevel(box, 60, 0.1);
  lod.addLevel(new THREE.Object3D(), 250);

  
  lod.position.set(-center.x, -bounds.min.y, -center.z);

  const group = new THREE.Group();
  group.add(lod);
  scene.add(group);

  function paint(element, color) {
    let found = false;

    lod.traverse((object) => {
      if (!object.isMesh || elementOf(object) !== element) return;

      if (!object.userData.ownMaterial) {
        object.material = Array.isArray(object.material)
          ? object.material.map((material) => material.clone())
          : object.material.clone();

        object.userData.ownMaterial = true;
      }

      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];

      for (const material of materials) {
        if (material.color) material.color.copy(color);
      }

      found = true;
    });

    return found;
  }

  return { group, lod, paint, size, maxSize };
}