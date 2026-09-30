import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

export const ICON_DIRECTORY = new URL('../public/icons/', import.meta.url);
export const ICON_SOURCE = new URL('screw-fall-icon-source.svg', ICON_DIRECTORY);
export const ICON_ASSETS = Object.freeze([
  Object.freeze({ file: 'favicon-16.png', size: 16 }),
  Object.freeze({ file: 'favicon-32.png', size: 32 }),
  Object.freeze({ file: 'apple-touch-icon-180.png', size: 180 }),
  Object.freeze({ file: 'pwa-192.png', size: 192 }),
  Object.freeze({ file: 'pwa-512.png', size: 512 }),
  Object.freeze({ file: 'pwa-maskable-512.png', size: 512 }),
  Object.freeze({ file: 'screw-fall-1024.png', size: 1024 }),
]);

/** No fonts, remote images, clock values or host-specific paths enter the result. */
export function renderIcon(source, size) {
  return new Resvg(source, {
    fitTo: { mode: 'width', value: size },
    font: { loadSystemFonts: false },
  }).render();
}

export async function generatePwaAssets({ check = false } = {}) {
  const source = await readFile(ICON_SOURCE, 'utf8');
  const outputs = [{ file: 'favicon.svg', bytes: Buffer.from(source) }];
  // The master already respects maskable padding, so both 512px purposes can
  // use the same composition. Each PNG is rasterized at its actual dimensions.
  const rasterizations = new Map();
  for (const { file, size } of ICON_ASSETS) {
    if (!rasterizations.has(size)) rasterizations.set(size, renderIcon(source, size).asPng());
    outputs.push({ file, bytes: rasterizations.get(size) });
  }

  const stale = [];
  for (const { file, bytes } of outputs) {
    const destination = new URL(file, ICON_DIRECTORY);
    if (check) {
      let actual;
      try { actual = await readFile(destination); } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (!actual?.equals(bytes)) stale.push(file);
    } else {
      await writeFile(destination, bytes);
    }
  }
  if (stale.length) {
    throw new Error(`PWA icons are missing or stale: ${stale.join(', ')}. Run npm run generate:pwa-assets.`);
  }
  return outputs.map(({ file, bytes }) => ({ file, bytes: bytes.length }));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const unknown = process.argv.slice(2).filter((argument) => argument !== '--check');
  if (unknown.length) {
    console.error(`Unknown arguments: ${unknown.join(', ')}. Use --check to verify generated assets.`);
    process.exitCode = 1;
  } else {
    const check = process.argv.includes('--check');
    try {
      const outputs = await generatePwaAssets({ check });
      console.log(`${check ? 'Verified' : 'Generated'} ${outputs.length} PWA icon assets (${outputs.reduce((total, asset) => total + asset.bytes, 0).toLocaleString('en-GB')} bytes).`);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
