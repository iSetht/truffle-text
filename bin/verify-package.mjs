#!/usr/bin/env node

import { readFile, readdir } from 'node:fs/promises';
import { brotliDecompressSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (packageJson.license !== 'MIT') {
  throw new Error(`Expected package license MIT, received ${packageJson.license ?? 'none'}`);
}

for (const file of [
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
  'licenses/Ubuntu-Font-Licence-1.0.txt',
  'licenses/Volter-Goldfish-NOTICE.txt'
]) {
  const contents = await readFile(join(root, file));
  if (!contents.length) throw new Error(`Required licensing file is empty: ${file}`);
}

const manifest = JSON.parse(await readFile(join(root, 'payload', 'manifest.json'), 'utf8'));
if (manifest.format !== 'truffle-dist' || manifest.version !== 1) {
  throw new Error('Invalid Truffle payload manifest');
}

const rasterFiles = (await readdir(join(root, 'payload', 'raster'))).filter(name => name.endsWith('.tfc.br'));
if (rasterFiles.length !== Object.keys(manifest.raster).length) {
  throw new Error(`Raster payload mismatch: ${rasterFiles.length} files for ${Object.keys(manifest.raster).length} manifest entries`);
}

const firstChunk = brotliDecompressSync(await readFile(join(root, 'payload', 'raster', rasterFiles[0])));
if (firstChunk.subarray(0, 4).toString('ascii') !== 'TFC1') {
  throw new Error('Packed raster does not use the TFC1 container');
}

const legacyBrand = Buffer.from('c2FmZnJvbg==', 'base64').toString('utf8');
for (const file of ['src/index.js', 'src/packed.js', 'src/react.js', 'README.md']) {
  const text = await readFile(join(root, file), 'utf8');
  if (text.toLowerCase().includes(legacyBrand)) throw new Error(`Old branding remains in ${file}`);
}

console.log(`Truffle package verified: ${rasterFiles.length} raster chunks`);
