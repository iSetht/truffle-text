import { TruffleText } from './index.js';

export interface PackedTruffleOptions {
  base?: string;
  styles?: Array<string | Record<string, unknown>> | null;
  fetchImpl?: ((url: string) => Promise<ArrayBuffer>) | null;
}

export interface PackedTruffleText extends TruffleText {
  ensureStyles(styles: Array<string | Record<string, unknown>>): Promise<void>;
  ensureAllStyles(): Promise<void>;
  packedManifest: Record<string, unknown>;
}

export function loadPackedTruffle(options?: PackedTruffleOptions): Promise<PackedTruffleText>;
export function decodeRasterChunk(buffer: ArrayBuffer): { signature: string; table: Record<string, unknown> };
