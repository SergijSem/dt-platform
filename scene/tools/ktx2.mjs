import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { ktx2 } from 'ktx2-encoder/gltf-transform';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';

const [src, dst] = process.argv.slice(2);

if (!src || !dst) {
  throw new Error('Використання: node tools/ktx2.mjs input.glb output.glb');
}

const imageDecoder = async (bytes) => {
  const img = bytes[0] === 0x89
    ? PNG.sync.read(Buffer.from(bytes))
    : jpeg.decode(bytes, { useTArray: true });

  return {
    data: new Uint8Array(img.data),
    width: img.width,
    height: img.height
  };
};

const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
const doc = await io.read(src);

await doc.transform(ktx2({
  isUASTC: false,
  generateMipmap: true,
  enableDebug: false,
  imageDecoder
}));

await io.write(dst, doc);
console.log(`Готово: ${dst}`);
