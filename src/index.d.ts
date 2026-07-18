export type Fidelity = 'auto' | 'exact' | 'geometric';

export interface EtchingStyle {
  color: number;
  alpha: number;
  x: number;
  y: number;
}

export interface TextStyle {
  styleName?: string;
  fontFamily?: string;
  fontFace?: string;
  size?: number | `${'+' | '-'}${number}`;
  fontSize?: number | `${'+' | '-'}${number}`;
  bold?: boolean;
  italic?: boolean;
  fontWeight?: string | number;
  fontStyle?: string;
  color?: number;
  antiAliasType?: 'normal' | 'advanced' | string;
  gridFitType?: 'none' | 'pixel' | string;
  sharpness?: number;
  thickness?: number;
  kerning?: boolean;
  letterSpacing?: number;
  leading?: number;
  underline?: boolean;
  underlineOffset?: number;
  /** Additional device-pixel gap below the normal underline row (default 1). */
  underlineGap?: number;
  etching?: EtchingStyle | null;
  lineAscent?: number;
  lineDescent?: number;
  italicRightOverhang?: number;
  fontFallbacks?: string[] | string;
  fontFallback?: string[] | string;
  missingGlyph?: 'drop' | 'notdef';
  fidelity?: Fidelity;
  pixelFont?: 'snapAdvances';
  autoRasterPolicy?: 'replay' | 'stable';
  textAlign?: 'left' | 'center' | 'right';
  glyphCacheEntries?: number;
  glyphCacheBytes?: number;
  onFallback?: (event: FallbackEvent) => void;
  [property: string]: unknown;
}

export type StyleInput = string | TextStyle;

export interface FallbackEvent {
  stage: 'layout' | 'raster' | 'font';
  reason: 'calibration-miss' | 'geometric-requested' | 'font-fallback' | 'missing-glyph' | string;
  codePoint: number;
  character: string;
  signature?: string;
  fromFamily?: string;
  toFamily?: string;
  style: TextStyle;
}

export interface StyledRun {
  text: string;
  style?: TextStyle;
  format?: TextStyle;
}

export interface RichParagraph {
  type?: 'paragraph';
  runs: StyledRun[];
}

export interface RichDocument {
  type: 'document';
  baseStyle?: StyleInput | null;
  paragraphs: RichParagraph[];
}

export type RichTextContent = string | StyledRun[] | RichDocument;

export interface CharacterBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

export interface LineMetrics {
  ascent: number;
  descent: number;
  leading: number;
  height: number;
}

export interface LayoutResult {
  lines: Array<{ chars: unknown[]; top: number; baseline: number; [property: string]: unknown }>;
  charBounds: Array<CharacterBounds | null>;
  textWidth: number;
  textHeight: number;
  width: number;
  height: number;
  metrics: LineMetrics;
  [property: string]: unknown;
}

export interface RenderBuffer {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  layout: LayoutResult;
  richLayout?: LayoutResult;
}

export interface CaretGeometry {
  index: number;
  lineIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SelectionGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  lineIndex: number;
}

/** Backward-compatible public type names from the 1.0 package. */
export type TruffleLayout = LayoutResult;
export type TruffleBuffer = RenderBuffer;

export interface LayoutOptions {
  wordWrap?: boolean;
  width?: number;
  textAlign?: 'left' | 'center' | 'right';
  fitCfg?: Record<string, unknown>;
  format?: 'html';
  richText?: boolean;
  [property: string]: unknown;
}

export interface RenderOptions extends LayoutOptions {
  color?: number;
  etching?: EtchingStyle | null;
  padding?: number;
}

export interface TruffleOptions {
  maxEngines?: number;
  glyphCacheEntries?: number;
  glyphCacheBytes?: number;
  onFallback?: (event: FallbackEvent) => void;
  calibration?: unknown;
  rasterCalibration?: unknown;
  colorCalibration?: unknown;
  compositeCalibration?: unknown;
}

export interface FontDescriptor {
  family?: string;
  fontFamily?: string;
  name?: string;
  data?: ArrayBuffer | ArrayBufferView | FlashFont;
  bytes?: ArrayBuffer | ArrayBufferView;
  buffer?: ArrayBuffer | ArrayBufferView;
  font?: FlashFont;
  bold?: boolean;
  italic?: boolean;
}

export class TruffleText {
  constructor(
    registry: FontRegistry,
    calibration?: unknown,
    rasterCalibration?: unknown,
    colorCalibration?: unknown,
    compositeCalibration?: unknown,
    options?: TruffleOptions,
  );
  static load(config?: TruffleOptions & {
    fontBase?: string;
    calibrationUrl?: string;
    rasterCalibrationUrl?: string;
    colorCalibrationUrl?: string;
    compositeCalibrationUrl?: string;
  }): Promise<TruffleText>;
  static load(
    fontBase?: string,
    calibrationUrl?: string,
    rasterCalibrationUrl?: string,
    colorCalibrationUrl?: string,
    compositeCalibrationUrl?: string,
  ): Promise<TruffleText>;
  static fromFonts(fonts: FontDescriptor[], options?: TruffleOptions): TruffleText;
  registerFont(descriptor: FontDescriptor): this;
  registerFont(family: string, data: ArrayBuffer | ArrayBufferView | FlashFont, options?: FontDescriptor): this;
  resolveStyle(style: StyleInput, overrides?: TextStyle): TextStyle;
  engine(style: StyleInput, fitCfg?: Record<string, unknown>): unknown;
  measure(text: string | RichDocument | StyledRun[], style?: StyleInput, opts?: LayoutOptions): LayoutResult;
  parse(markup: string, options?: { baseStyle?: StyleInput | null }): RichDocument;
  measureRichText(content: RichTextContent, baseStyle?: StyleInput, opts?: LayoutOptions): LayoutResult;
  renderToBuffer(text: string | RichDocument | StyledRun[], style?: StyleInput, opts?: RenderOptions): RenderBuffer;
  renderRichText(content: RichTextContent, baseStyle?: StyleInput, opts?: RenderOptions): RenderBuffer;
  drawText(context: CanvasRenderingContext2D, text: string | RichDocument | StyledRun[], options?: RenderOptions & { x?: number; y?: number; style?: StyleInput }): LayoutResult;
  drawRichText(context: CanvasRenderingContext2D, content: RichTextContent, options?: RenderOptions & { x?: number; y?: number; style?: StyleInput; baseStyle?: StyleInput }): LayoutResult;
  caretRect(text: string | RichDocument | StyledRun[], index: number, style?: StyleInput, opts?: LayoutOptions): CaretGeometry;
  selectionRects(text: string | RichDocument | StyledRun[], start: number, end: number, style?: StyleInput, opts?: LayoutOptions): SelectionGeometry[];
  hitTest(text: string | RichDocument | StyledRun[], x: number, y: number, style?: StyleInput, opts?: LayoutOptions): number;
  clearCaches(): void;
}

export class FlashFont {
  constructor(data: ArrayBufferView, name: string);
  readonly name: string;
  glyphId(codePoint: number): number;
  rawAdvance(codePoint: number, size: number): number;
  lineMetrics(size: number): LineMetrics;
  alignmentZones(size: number): { baseline: number; xHeight: number; capHeight: number };
}

export class FontRegistry {
  add(family: string, bold: boolean, font: FlashFont, italic?: boolean): this;
  get(family: string, bold: boolean, italic?: boolean): FlashFont;
  getExact(family: string, bold?: boolean, italic?: boolean): FlashFont | null;
  has(family: string, bold?: boolean, italic?: boolean): boolean;
  families(): string[];
}

export class TextLayout {}
export class RichTextLayout {}
export class TextRenderer {}
export class RichTextRenderer {}

export const GUTTER: number;
export const DEFAULT_FIT: Readonly<Record<string, number | boolean>>;
export const HABBO_CSS_STYLE_NAMES: readonly string[];
export const HABBO_STYLES: Readonly<Record<string, Readonly<TextStyle>>>;
export const FONT_FAMILY_GRAPH: Readonly<Record<string, Readonly<Record<string, string>>>>;
export const FONT_FILES: ReadonlyArray<readonly [string, boolean, boolean, string, boolean]>;

export function parseRichText(markup: RichTextContent, options?: { baseStyle?: StyleInput | null }): RichDocument;
export function normalizeDocument(document: RichTextContent): RichDocument;
export function plainTextOf(document: RichTextContent): string;
export function resolveStyleProperties(style: StyleInput, overrides?: TextStyle): TextStyle;
export function styleDefaults(fontFamily: string): TextStyle;
export function snapTextIndex(text: string, index: number): number;
export function caretRect(layout: LayoutResult, text: string, index: number): CaretGeometry;
export function selectionRects(layout: LayoutResult, text: string, start: number, end: number): SelectionGeometry[];
export function hitTestText(layout: LayoutResult, text: string, x: number, y: number): number;
