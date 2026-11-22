import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

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

  const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
  geometry.translate(center.x, center.y, center.z);

  return new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: 0x8a8f96,
      wireframe: false
    })
  );
}

function setLevel0(lod, object) {
  const old = lod.levels[0].object;
  lod.remove(old);
  lod.levels[0].object = object;
  lod.add(object);
}

export async function loadStation(scene, opt = new Set(), renderer) {
  if (opt.has('ktx2')) {
    const ktx2 = new KTX2Loader()
      .setTranscoderPath('node_modules/three/examples/jsm/libs/basis/')
      .detectSupport(renderer);

    loader.setKTX2Loader(ktx2);
  }

  const suffix = opt.has('ktx2') ? '-ktx2' : '';
  const detail = opt.has('simp')
    ? `models/scooter-s${suffix}.glb`
    : `models/scooter${suffix}.glb`;

  const lod1Path = opt.has('ktx2')
    ? 'models/scooter-lod1-ktx2.glb'
    : 'models/scooter-lod1.glb';

  const deferred = opt.has('defer');

  const [gltf1, gltf0] = await Promise.all([
    loader.loadAsync(lod1Path),
    deferred ? Promise.resolve(null) : loader.loadAsync(detail)
  ]);

  const simplified = gltf1.scene;
  const detailed = gltf0?.scene ?? simplified;

  const bounds = new THREE.Box3().setFromObject(detailed);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const maxSize = Math.max(size.x, size.y, size.z);

  const lod = new THREE.LOD();
  const model0 = detailed.clone(true);
  const model1 = simplified.clone(true);
  const box = boxOf(detailed);

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

  async function afterFirstFrame() {
    if (!deferred) return;

    const model = (await loader.loadAsync(detail)).scene;
    setLevel0(lod, model.clone(true));
  }

  return { group, lod, paint, size, maxSize, afterFirstFrame };
}