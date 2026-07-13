/**
 * packed.js — Runtime loader for the shippable `dist/` payload.
 *
 * This is the production entry point. It loads the binary raster-calibration
 * chunks (.tfc) produced by `tools/pack-calibration.mjs` instead of the
 * 362 MB development JSON, decoding them into typed-array structures that are
 * semantically identical to the JSON (verified by tests/packed.test.mjs).
 * The certified layout/render code is untouched; this changes the CONTAINER,
 * never the calibration data.
 *
 * Browser:
 *   import { loadPackedTruffle } from './src/packed.js';
 *   const truffle = await loadPackedTruffle({ base: '/dist' });            // everything
 *   const truffle = await loadPackedTruffle({ base: '/dist',
 *     styles: ['u_chat_speak', 'u_chat_shout', 'il_regular'] });           // lazy subset
 *   truffle.drawText(ctx, 'hello', { x: 8, y: 8, style: 'u_chat_speak' });
 *   await truffle.ensureStyles(['il_button']);                             // add later
 *
 * Node: identical API; `base` may be a filesystem path.
 */

import {
  TruffleText, HABBO_STYLES, FlashFont, FontRegistry, FONT_FILES, styleDefaults,
} from './index.js';

const F_ALPHA = 1, F_ETCH = 2, F_STATE = 4, F_COVERAGE = 8;

/** Decode one .tfc chunk into { signature, table } (the JSON-equivalent map). */
export function decodeRasterChunk(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  if (view.getUint8(0) !== 0x54 || view.getUint8(1) !== 0x46 ||
      view.getUint8(2) !== 0x43 || view.getUint8(3) !== 0x31) {
    throw new Error('not a TFC1 chunk');
  }
  const headerLength = view.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(
    new Uint8Array(arrayBuffer, 8, headerLength)));
  if (header.version !== 1) throw new Error(`unsupported TFC version ${header.version}`);
  const payload = 8 + headerLength + ((8 + headerLength) & 1);

  const readMask = ([offset, flags], cells, target) => {
    let at = payload + offset;
    if (flags & F_ALPHA) { target.alpha = new Uint8Array(arrayBuffer, at, cells); at += cells; }
    if (flags & F_ETCH) { target.etchAlpha = new Uint8Array(arrayBuffer, at, cells); at += cells; }
    if (flags & F_STATE) { target.mainState = new Int16Array(arrayBuffer, at, cells); at += cells * 2; }
    if (flags & F_COVERAGE) { target.coverage = new Uint8Array(arrayBuffer, at, cells); }
    return target;
  };

  const table = {};
  for (const [ch, meta] of Object.entries(header.chars)) {
    const cells = meta.w * meta.h;
    const entry = { x0: meta.x0, y0: meta.y0, w: meta.w, h: meta.h };
    if (meta.m) readMask(meta.m, cells, entry);
    if (meta.p) {
      entry.phases = {};
      for (const [ph, mask] of Object.entries(meta.p)) {
        entry.phases[ph] = readMask(mask, cells, {});
      }
    }
    if (meta.c) {
      entry.contexts = {};
      for (const [runKey, phases] of Object.entries(meta.c)) {
        const decoded = entry.contexts[runKey] = {};
        for (const [ph, mask] of Object.entries(phases)) {
          decoded[ph] = readMask(mask, cells, {});
        }
      }
    }
    table[ch] = entry;
  }
  return { signature: header.signature, table };
}

async function loadBytes(url, fetchImpl) {
  if (fetchImpl) return await fetchImpl(url);
  const isHttp = /^https?:/i.test(url);
  if (!isHttp && typeof window === 'undefined' &&
      typeof process !== 'undefined' && process.versions?.node) {
    const { readFile } = await import('node:fs/promises');
    const buf = await readFile(url);
    // Copy out of Node's shared buffer pool: guarantees 0 byteOffset, which
    // keeps Int16Array views aligned.
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return await response.arrayBuffer();
}

async function loadJson(url, fetchImpl, fallback) {
  try {
    const bytes = await loadBytes(url, fetchImpl);
    return JSON.parse(new TextDecoder().decode(new Uint8Array(bytes)));
  } catch (error) {
    if (fallback !== undefined) return fallback;
    throw error;
  }
}

/** All manifest signature keys a style could resolve to (mirrors resolveStyle). */
function styleSignatureCandidates(style) {
  const named = typeof style === 'string' ? HABBO_STYLES[style] : style;
  if (!named?.fontFamily) throw new Error(`unknown style: ${style}`);
  const s = { ...styleDefaults(named.fontFamily), ...named };
  const baseKey = `${s.fontFamily}|${!!s.bold}|${!!s.italic}|${s.size}`;
  const legacyBaseKey = `${s.fontFamily}|${!!s.bold}|${s.size}`;
  const csm = `${s.antiAliasType}|${s.gridFitType}|${s.sharpness}|${s.thickness}`;
  const candidates = [];
  // Dynamic colors fall back to the certified black mask; white and #EEEEEE
  // retain their own exact FlashType calibration when the manifest has it.
  for (const color of [...new Set([s.color ?? 0, 0x000000, 0xEEEEEE, 0xFFFFFF])]) {
    candidates.push(
      `${baseKey}|${color}|${csm}`, // rasterKey / whiteRasterKey
      `${baseKey}|${color}`,        // colorKey fallback
      `${legacyBaseKey}|${color}`,  // legacy fallback
    );
  }
  return candidates;
}

function signaturesForStyles(styles, manifest) {
  const wanted = new Set();
  for (const style of styles) {
    for (const key of styleSignatureCandidates(style)) {
      if (manifest.raster[key]) wanted.add(key);
    }
  }
  return wanted;
}

/**
 * Load a production TruffleText instance from a packed `dist/` payload.
 *
 * opts:
 *   base       URL prefix or filesystem path of the dist folder ('/dist')
 *   styles     array of style names/objects to load raster chunks for
 *              (null = all signatures)
 *   fetchImpl  optional async (url) => ArrayBuffer override
 */
export async function loadPackedTruffle({ base = '/dist', styles = null, fetchImpl = null } = {}) {
  const manifest = await loadJson(`${base}/manifest.json`, fetchImpl);
  if (manifest.format !== 'truffle-dist' || manifest.version !== 1) {
    throw new Error('unsupported dist manifest');
  }

  const registry = new FontRegistry();
  const fontBytes = new Map(); // file → bytes (Volter files are reused for italic aliases)
  await Promise.all([...new Set(FONT_FILES.map(([, , , file]) => file))].map(async file => {
    fontBytes.set(file, await loadBytes(`${base}/fonts/${file}`, fetchImpl));
  }));
  for (const [family, bold, italic, file] of FONT_FILES) {
    registry.add(family, bold, new FlashFont(new Uint8Array(fontBytes.get(file)), family), italic);
  }

  const dataTable = async (key, fallback) => {
    const meta = manifest.data[key];
    if (!meta) {
      console.warn(`truffle: dist payload is missing the "${key}" table — ` +
        'renders remain exact for baked styles, but regenerate and re-pack it for full coverage.');
      return fallback;
    }
    return loadJson(`${base}/${meta.file}`, fetchImpl, fallback);
  };
  const [calibration, colorCalibration, compositeCalibration] = await Promise.all([
    dataTable('calibration', {}),
    dataTable('color-calibration', {}),
    dataTable('composite-calibration', null),
  ]);

  const rasterCalibration = {};
  const loadedSignatures = new Set();
  const loadSignatures = async signatures => {
    const missing = [...signatures].filter(s => !loadedSignatures.has(s));
    await Promise.all(missing.map(async signature => {
      const meta = manifest.raster[signature];
      if (!meta) return;
      const chunk = decodeRasterChunk(await loadBytes(`${base}/${meta.file}`, fetchImpl));
      rasterCalibration[chunk.signature] = chunk.table;
      loadedSignatures.add(signature);
    }));
  };

  await loadSignatures(styles
    ? signaturesForStyles(styles, manifest)
    : Object.keys(manifest.raster));

  const truffle = new TruffleText(
    registry, calibration, rasterCalibration, colorCalibration, compositeCalibration);

  /** Lazily add raster chunks for more styles, then invalidate cached engines. */
  truffle.ensureStyles = async styleList => {
    await loadSignatures(signaturesForStyles(styleList, manifest));
    truffle._engines.clear();
  };
  /** Load every remaining signature. */
  truffle.ensureAllStyles = async () => {
    await loadSignatures(Object.keys(manifest.raster));
    truffle._engines.clear();
  };
  truffle.packedManifest = manifest;
  return truffle;
}
