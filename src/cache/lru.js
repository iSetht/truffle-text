/**
 * A small byte-aware LRU used by runtime raster caches.
 *
 * Map-compatible get/set/clear semantics keep it usable by the existing
 * renderer while preventing a long-lived editor or chat client from retaining
 * every glyph/phase/style combination it has ever seen.
 */
export class LRUCache extends Map {
  constructor({ maxEntries = 4096, maxBytes = 32 * 1024 * 1024, sizeOf = defaultSizeOf } = {}) {
    super();
    this.maxEntries = Math.max(1, maxEntries);
    this.maxBytes = Math.max(0, maxBytes);
    this.sizeOf = sizeOf;
    this.bytes = 0;
  }

  get(key) {
    if (!super.has(key)) return undefined;
    const entry = super.get(key);
    // Reinsert to make this the most-recently-used entry.
    super.delete(key);
    super.set(key, entry);
    return entry.value;
  }

  peek(key) {
    return super.get(key)?.value;
  }

  has(key) {
    return super.has(key);
  }

  set(key, value) {
    const previous = super.get(key);
    if (previous) {
      this.bytes -= previous.bytes;
      super.delete(key);
    }
    const bytes = Math.max(0, Number(this.sizeOf(value, key)) || 0);
    super.set(key, { value, bytes });
    this.bytes += bytes;
    this._evict();
    return this;
  }

  delete(key) {
    const entry = super.get(key);
    if (!entry) return false;
    this.bytes -= entry.bytes;
    return super.delete(key);
  }

  clear() {
    super.clear();
    this.bytes = 0;
  }

  *values() {
    for (const entry of super.values()) yield entry.value;
  }

  *entries() {
    for (const [key, entry] of super.entries()) yield [key, entry.value];
  }

  [Symbol.iterator]() {
    return this.entries();
  }

  _evict() {
    while (super.size > this.maxEntries || (this.maxBytes && this.bytes > this.maxBytes)) {
      const oldest = super.keys().next().value;
      if (oldest === undefined) break;
      this.delete(oldest);
    }
  }
}

function defaultSizeOf(value) {
  if (!value || typeof value !== 'object') return 64;
  let bytes = 96;
  const seen = new Set();
  for (const item of Object.values(value)) {
    if (ArrayBuffer.isView(item) && !seen.has(item.buffer)) {
      // Count the view, not the entire packed calibration backing buffer.
      bytes += item.byteLength;
      seen.add(item.buffer);
    }
  }
  return bytes;
}
