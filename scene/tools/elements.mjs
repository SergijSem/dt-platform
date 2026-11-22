import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';

const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);

for (const file of process.argv.slice(2)) {
  const ids = (await io.read(file)).getRoot().listNodes()
    .map((node) => node.getExtras().element)
    .filter(Boolean);

  console.log(`${file}: ${ids.length} — ${ids.join(', ')}`);
}
