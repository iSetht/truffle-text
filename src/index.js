/**
 * Public browser/Node API for Truffle Text.
 *
 * Plain single-style calls retain the certified TextLayout/TextRenderer path.
 * Rich documents resolve to styled runs and use a shared-pen layout pipeline;
 * uniform rich documents automatically return to the certified fast path.
 */

import { FlashFont } from './font/flashfont.js';
import { FontRegistry, TextLayout, GUTTER } from './layout/textfield.js';
import { RichTextLayout } from './layout/richtext.js';
import { caretRect, hitTestText, selectionRects, snapTextIndex } from './layout/editing.js';
import { TextRenderer } from './render/renderer.js';
import { RichTextRenderer } from './render/richtext-renderer.js';
import { DEFAULT_FIT } from './truffle/gridfit.js';
import {
  HABBO_CSS_STYLE_NAMES,
  HABBO_STYLES,
  FONT_FAMILY_GRAPH,
  resolveStyleProperties,
  styleDefaults,
} from './styles/catalog.js';
import {
  isRichTextDocument,
  normalizeDocument,
  parseRichText,
  plainTextOf,
} from './richtext/parser.js';

export const FONT_FILES = [
  ['Ubuntu', false, false, 'Ubuntu-R.ttf', true],
  ['Ubuntu', true,  false, 'Ubuntu-B.ttf', true],
  ['Ubuntu', false, true,  'Ubuntu-I.ttf', true],
  ['Ubuntu', true,  true,  'Ubuntu-BI.ttf', true],
  ['UbuntuCondensed', false, false, 'Ubuntu-C.ttf', true],
  ['Volter', false, false, 'Volter.ttf', true],
  ['Volter', false, true, 'Volter.ttf', true],
  ['Volter Bold', true, false, 'Volter-Bold.ttf', true],
  ['Volter Bold', true, true, 'Volter-Bold.ttf', true],
];

export class TruffleText {
  constructor(
    registry,
    calibration,
    rasterCalibration,
    colorCalibration,
    compositeCalibration,
    options = {},
  ) {
    this.registry = registry;
    this.calibration = calibration ?? {};
    this.rasterCalibration = rasterCalibration ?? {};
    this.colorCalibration = colorCalibration ?? {};
    this.compositeCalibration = compositeCalibration ?? null;
    this.options = {
      maxEngines: 128,
      glyphCacheEntries: 4096,
      glyphCacheBytes: 32 * 1024 * 1024,
      onFallback: null,
      ...options,
    };
    this._engines = new Map();
    this._reportedFallbacks = new Set();
    this._richRenderer = new RichTextRenderer();
  }

  /** Load bundled fonts and development JSON calibration tables. */
  static async load(
    fontBase = '/refs/fonts',
    calibrationUrl = '/src/calibration.json',
    rasterCalibrationUrl = '/src/raster-calibration.json',
    colorCalibrationUrl = '/src/color-calibration.json',
    compositeCalibrationUrl = '/src/composite-calibration.json',
  ) {
    let options = {};
    if (fontBase && typeof fontBase === 'object') {
      const config = fontBase;
      fontBase = config.fontBase ?? '/refs/fonts';
      calibrationUrl = config.calibrationUrl ?? '/src/calibration.json';
      rasterCalibrationUrl = config.rasterCalibrationUrl ?? '/src/raster-calibration.json';
      colorCalibrationUrl = config.colorCalibrationUrl ?? '/src/color-calibration.json';
      compositeCalibrationUrl = config.compositeCalibrationUrl ?? '/src/composite-calibration.json';
      options = config;
    }
    const registry = new FontRegistry();
    await Promise.all(FONT_FILES.map(async ([family, bold, italic, file, required]) => {
      const response = await fetch(`${fontBase}/${file}`);
      if (!response.ok) {
        if (required) throw new Error(`failed to load font ${file}: HTTP ${response.status}`);
        return;
      }
      const buffer = await response.arrayBuffer();
      registry.add(family, bold, new FlashFont(new Uint8Array(buffer), family), italic);
    }));
    const loadJson = async (url, fallback) => {
      try {
        const response = await fetch(url);
        return response.ok ? await response.json() : fallback;
      } catch { return fallback; }
    };
    const [calibration, rasterCalibration, colorCalibration, compositeCalibration] = await Promise.all([
      loadJson(calibrationUrl, {}),
      loadJson(rasterCalibrationUrl, {}),
      loadJson(colorCalibrationUrl, {}),
      loadJson(compositeCalibrationUrl, null),
    ]);
    return new TruffleText(
      registry, calibration, rasterCalibration, colorCalibration, compositeCalibration, options,
    );
  }

  /** Create a geometric-capable renderer directly from caller-provided TTFs. */
  static fromFonts(fonts, options = {}) {
    const truffle = new TruffleText(
      new FontRegistry(),
      options.calibration,
      options.rasterCalibration,
      options.colorCalibration,
      options.compositeCalibration,
      options,
    );
    for (const font of fonts ?? []) truffle.registerFont(font);
    return truffle;
  }

  /**
   * Register a TrueType face at runtime.
   *
   * registerFont({ family, data, bold, italic, name })
   * registerFont(family, data, { bold, italic, name })
   */
  registerFont(family, data, options = {}) {
    if (family && typeof family === 'object') {
      const descriptor = family;
      family = descriptor.family ?? descriptor.fontFamily ?? descriptor.name;
      data = descriptor.data ?? descriptor.bytes ?? descriptor.buffer ?? descriptor.font;
      options = descriptor;
    }
    if (!family || !data) throw new TypeError('registerFont requires a family and TTF data');
    const font = data instanceof FlashFont
      ? data
      : new FlashFont(toUint8Array(data), options.name ?? family);
    this.registry.add(family, !!options.bold, font, !!options.italic);
    this._engines.clear();
    return this;
  }

  /** Resolve a named/raw style and optional property overrides. */
  resolveStyle(style, overrides = {}) {
    const s = resolveStyleProperties(style, overrides);
    const baseKey = `${s.fontFamily}|${!!s.bold}|${!!s.italic}|${s.size}`;
    const legacyBaseKey = `${s.fontFamily}|${!!s.bold}|${s.size}`;
    const requestedColor = s.color ?? 0;
    const colorKeyFor = color => `${baseKey}|${color}`;
    const legacyColorKeyFor = color => `${legacyBaseKey}|${color}`;
    const rasterKeyFor = color => `${colorKeyFor(color)}|${s.antiAliasType}|${s.gridFitType}|${s.sharpness}|${s.thickness}`;
    const rasterFor = color => this.rasterCalibration[rasterKeyFor(color)] ??
      this.rasterCalibration[colorKeyFor(color)] ??
      this.rasterCalibration[legacyColorKeyFor(color)] ?? null;
    const calibrationFor = color => this.colorCalibration[colorKeyFor(color)] ??
      this.colorCalibration[legacyColorKeyFor(color)] ?? null;

    // Dynamic colors share the certified black mask; white and #EEEEEE keep
    // their dedicated AIR density masks where those exist.
    const fallbackColors = [...new Set([requestedColor, 0x000000, 0xEEEEEE, 0xFFFFFF])];
    const calibrationColor = fallbackColors.find(color => rasterFor(color)) ??
      fallbackColors.find(color => calibrationFor(color)) ?? requestedColor;
    const colorKey = colorKeyFor(calibrationColor);
    const legacyColorKey = legacyColorKeyFor(calibrationColor);
    const whiteKey = `${baseKey}|16777215`;
    const legacyWhiteKey = `${legacyBaseKey}|16777215`;
    const rasterKey = rasterKeyFor(calibrationColor);
    const whiteRasterKey = `${whiteKey}|${s.antiAliasType}|${s.gridFitType}|${s.sharpness}|${s.thickness}`;
    s.calibrationColor = calibrationColor;
    s.calibration = this.colorCalibration[colorKey] ?? this.colorCalibration[legacyColorKey] ??
      this.calibration[baseKey] ?? this.calibration[legacyBaseKey] ?? null;
    s.rasterCalibration = this.rasterCalibration[rasterKey] ??
      this.rasterCalibration[colorKey] ?? this.rasterCalibration[legacyColorKey] ?? null;
    s.etchCalibration = this.colorCalibration[whiteKey] ?? this.colorCalibration[legacyWhiteKey] ?? null;
    s.etchRasterCalibration = this.rasterCalibration[whiteRasterKey] ??
      this.rasterCalibration[whiteKey] ?? this.rasterCalibration[legacyWhiteKey] ?? null;
    s.compositeCalibration = this.compositeCalibration;
    s.applyCalibratedContextShift ??= !!s.italic && !!s.rasterCalibration;
    s.certified = !!s.rasterCalibration;
    s.glyphCacheEntries ??= this.options.glyphCacheEntries;
    s.glyphCacheBytes ??= this.options.glyphCacheBytes;

    if (s.fidelity === 'geometric') {
      s.calibration = null;
      s.rasterCalibration = null;
      s.etchCalibration = null;
      s.etchRasterCalibration = null;
      s.compositeCalibration = null;
      s.applyCalibratedContextShift = false;
    }
    const localFallback = s.onFallback;
    Object.defineProperty(s, '_reportFallback', {
      enumerable: false,
      configurable: true,
      value: event => this._reportFallback({ ...event, style: publicStyleSnapshot(s) }, localFallback),
    });
    return s;
  }

  engine(style, fitCfg) {
    const s = this.resolveStyle(style);
    const key = JSON.stringify([
      s.fontFamily, !!s.bold, !!s.italic, s.size, s.antiAliasType, s.gridFitType,
      s.sharpness, s.thickness, !!s.kerning, s.letterSpacing ?? 0,
      s.leading ?? 0, s.color ?? 0, s.etching ?? null, !!s.underline, s.csmTune ?? null,
      s.underlineOffset ?? 0, s.underlineGap ?? 0,
      s.lineAscent ?? null, s.lineDescent ?? null,
      s.italicRightOverhang ?? 0, !!s.applyCalibratedContextShift, s.fidelity,
      s.pixelFont ?? null, s.autoRasterPolicy ?? null, fitCfg ?? null,
    ]);
    let engine = this._engines.get(key);
    if (engine) {
      this._engines.delete(key);
      this._engines.set(key, engine);
      return engine;
    }
    const layout = new TextLayout(this.registry, s, { ...DEFAULT_FIT, ...(fitCfg ?? {}) });
    engine = { layout, renderer: new TextRenderer(layout), style: s, key };
    this._engines.set(key, engine);
    while (this._engines.size > this.options.maxEngines) {
      this._engines.delete(this._engines.keys().next().value);
    }
    return engine;
  }

  /** Measure plain text, a DocModel, or markup with opts.format='html'. */
  measure(text, style = 'il_regular', opts = {}) {
    if (isRichTextDocument(text) || opts.format === 'html' || opts.richText) {
      return this.measureRichText(text, style, opts);
    }
    if (styleNeedsPerGlyphFonts(style)) {
      return this.measureRichText(literalDocument(text), style, opts);
    }
    return this.engine(style, opts.fitCfg).layout.layout(text, opts);
  }

  /** Parse Flash-compatible markup into the public document model. */
  parse(markup, options = {}) {
    return parseRichText(markup, options);
  }

  measureRichText(content, baseStyle = 'il_regular', opts = {}) {
    const document = isRichTextDocument(content)
      ? normalizeDocument(content)
      : parseRichText(content, { baseStyle });
    if (document.baseStyle == null) document.baseStyle = baseStyle;
    return new RichTextLayout(this, baseStyle, opts.fitCfg).layout(document, opts);
  }

  /** Render plain text to a raw RGBA buffer. */
  renderToBuffer(text, style = 'il_regular', opts = {}) {
    if (isRichTextDocument(text) || opts.format === 'html' || opts.richText) {
      return this.renderRichText(text, style, opts);
    }
    if (styleNeedsPerGlyphFonts(style)) {
      return this.renderRichText(literalDocument(text), style, opts);
    }
    const renderStyle = opts.color === undefined
      ? style
      : this.resolveStyle(style, { color: opts.color });
    const engine = this.engine(renderStyle, opts.fitCfg);
    return engine.renderer.render(text, {
      color: opts.color ?? engine.style.color ?? 0,
      etching: opts.etching !== undefined ? opts.etching : engine.style.etching ?? null,
      wordWrap: opts.wordWrap,
      width: opts.width,
      padding: opts.padding ?? 0,
    });
  }

  /** Render a rich document. Uniform documents retain exact replay output. */
  renderRichText(content, baseStyle = 'il_regular', opts = {}) {
    const layout = this.measureRichText(content, baseStyle, opts);
    if (layout.uniformEngine && !opts.textAlign) {
      const engine = layout.uniformEngine;
      const buffer = engine.renderer.render(layout.plainText, {
        color: opts.color ?? engine.style.color ?? 0,
        etching: opts.etching !== undefined ? opts.etching : engine.style.etching ?? null,
        wordWrap: opts.wordWrap,
        width: opts.width,
        padding: opts.padding ?? 0,
      });
      buffer.richLayout = layout;
      return buffer;
    }
    return this._richRenderer.render(layout, opts);
  }

  /** Draw onto a Canvas 2D context at integer field coordinates. */
  drawText(ctx, text, { x = 0, y = 0, style = 'il_regular', ...opts } = {}) {
    const buffer = this.renderToBuffer(text, style, opts);
    putBuffer(ctx, buffer, x, y);
    return buffer.layout;
  }

  drawRichText(ctx, content, { x = 0, y = 0, style = 'il_regular', baseStyle = style, ...opts } = {}) {
    const buffer = this.renderRichText(content, baseStyle, opts);
    putBuffer(ctx, buffer, x, y);
    return buffer.layout;
  }

  /** Geometry for a DOM-style UTF-16 caret, derived from rendered advances. */
  caretRect(text, index, style = 'il_regular', opts = {}) {
    const layout = this.measure(text, style, opts);
    return caretRect(layout, layout.plainText ?? String(text ?? ''), index);
  }

  /** One visual rectangle per selected rendered line. */
  selectionRects(text, start, end, style = 'il_regular', opts = {}) {
    const layout = this.measure(text, style, opts);
    return selectionRects(layout, layout.plainText ?? String(text ?? ''), start, end);
  }

  /** Convert a field-space pointer coordinate to a DOM UTF-16 index. */
  hitTest(text, x, y, style = 'il_regular', opts = {}) {
    const layout = this.measure(text, style, opts);
    return hitTestText(layout, layout.plainText ?? String(text ?? ''), x, y);
  }

  clearCaches() {
    this._engines.clear();
    this._reportedFallbacks.clear();
  }

  _reportFallback(event, localHandler) {
    const key = JSON.stringify([
      event.stage, event.reason, event.signature, event.codePoint,
      event.fromFamily, event.toFamily,
    ]);
    if (this._reportedFallbacks.has(key)) return;
    this._reportedFallbacks.add(key);
    localHandler?.(event);
    if (localHandler !== this.options.onFallback) this.options.onFallback?.(event);
  }
}

function putBuffer(ctx, buffer, x, y) {
  const image = new ImageData(new Uint8ClampedArray(buffer.data), buffer.width, buffer.height);
  ctx.putImageData(image, Math.round(x), Math.round(y));
}

function toUint8Array(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  throw new TypeError('font data must be an ArrayBuffer, typed array, or FlashFont');
}

function publicStyleSnapshot(style) {
  return {
    fontFamily: style.fontFamily,
    size: style.size,
    bold: !!style.bold,
    italic: !!style.italic,
    antiAliasType: style.antiAliasType,
    gridFitType: style.gridFitType,
    fidelity: style.fidelity,
  };
}

function styleNeedsPerGlyphFonts(style) {
  return !!style && typeof style === 'object' &&
    (style.fontFallbacks !== undefined || style.fontFallback !== undefined ||
      style.missingGlyph === 'notdef');
}

function literalDocument(text) {
  return {
    type: 'document',
    paragraphs: [{ type: 'paragraph', runs: [{ text: String(text ?? ''), style: {} }] }],
  };
}

export {
  FlashFont,
  FontRegistry,
  TextLayout,
  RichTextLayout,
  TextRenderer,
  RichTextRenderer,
  GUTTER,
  DEFAULT_FIT,
  HABBO_CSS_STYLE_NAMES,
  HABBO_STYLES,
  FONT_FAMILY_GRAPH,
  resolveStyleProperties,
  parseRichText,
  normalizeDocument,
  plainTextOf,
  styleDefaults,
  caretRect,
  selectionRects,
  hitTestText,
  snapTextIndex,
};
