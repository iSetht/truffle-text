export interface TruffleLayout {
  width: number;
  height: number;
  textWidth: number;
  textHeight: number;
  lines: unknown[];
  charBounds: unknown[];
  metrics: Record<string, number>;
}

export interface TruffleBuffer {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  layout: TruffleLayout;
}

export interface RenderOptions {
  color?: number;
  wordWrap?: boolean;
  width?: number;
  padding?: number;
  fitCfg?: Record<string, unknown>;
}

export class TruffleText {
  static load(fontBase?: string, calibrationUrl?: string, rasterCalibrationUrl?: string, colorCalibrationUrl?: string, compositeCalibrationUrl?: string): Promise<TruffleText>;
  resolveStyle(style: string | Record<string, unknown>): Record<string, unknown>;
  measure(text: string, style: string | Record<string, unknown>, options?: RenderOptions): TruffleLayout;
  renderToBuffer(text: string, style: string | Record<string, unknown>, options?: RenderOptions): TruffleBuffer;
  drawText(context: CanvasRenderingContext2D, text: string, options?: RenderOptions & { x?: number; y?: number; style?: string | Record<string, unknown> }): TruffleLayout;
}

export const HABBO_STYLES: Readonly<Record<string, Record<string, unknown>>>;
export const HABBO_CSS_STYLE_NAMES: readonly string[];
export const HABBO_STYLE_ALIASES: Readonly<Record<string, string>>;
