#!/usr/bin/env node

import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { brotliDecompressSync } from 'node:zlib';
import { dirname, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const payloadRoot = join(packageRoot, 'payload');
const outIndex = process.argv.indexOf('--out');
const requested = outIndex >= 0 ? process.argv[outIndex + 1] : 'public/assets/truffle';

if (!requested) throw new Error('Usage: truffle-setup --out public/assets/truffle');

const outputRoot = resolve(process.cwd(), requested);
const cwd = resolve(process.cwd());
if (outputRoot === cwd || outputRoot === parse(outputRoot).root) {
  throw new Error(`Refusing unsafe output directory: ${outputRoot}`);
}

async function expand(source, target) {
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const sourcePath = join(source, entry.name);
    if (entry.isDirectory()) {
      await expand(sourcePath, join(target, entry.name));
      continue;
    }
    if (entry.name.endsWith('.br')) {
      const compressed = await readFile(sourcePath);
      await writeFile(join(target, entry.name.slice(0, -3)), brotliDecompressSync(compressed));
      continue;
    }
    await cp(sourcePath, join(target, entry.name));
  }
}

await rm(outputRoot, { recursive: true, force: true });
await expand(payloadRoot, outputRoot);
console.log(`Truffle assets installed at ${outputRoot}`);
