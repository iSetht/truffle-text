import type { FallbackEvent, StyleInput, TruffleText } from './index.js';

export interface PackedTruffleOptions {
  base?: string;
  styles?: StyleInput[] | null;
  fetchImpl?: (url: string) => Promise<ArrayBuffer>;
  onFallback?: (event: FallbackEvent) => void;
  maxEngines?: number;
  glyphCacheEntries?: number;
  glyphCacheBytes?: number;
}

export interface PackedTruffleText extends TruffleText {
  ensureStyles(styles: StyleInput[]): Promise<void>;
  ensureAllStyles(): Promise<void>;
  packedManifest: unknown;
}

export function decodeRasterChunk(arrayBuffer: ArrayBuffer): {
  signature: string;
  table: Record<string, unknown>;
};

export function loadPackedTruffle(options?: PackedTruffleOptions): Promise<PackedTruffleText>;
