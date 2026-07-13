/**
 * index.js — Public browser/Node API for the Truffle renderer replica.
 *
 * Browser usage:
 *   import { TruffleText } from './src/index.js';
 *   const truffle = await TruffleText.load();
 *   truffle.drawText(ctx, 'Hello', { x: 10, y: 10, style: 'il_regular', color: 0x000000 });
 */

import { FlashFont } from './font/flashfont.js';
import { FontRegistry, TextLayout, GUTTER } from './layout/textfield.js';
import { TextRenderer } from './render/renderer.js';
import { DEFAULT_FIT } from './truffle/gridfit.js';

const ETCH_BOTTOM = Object.freeze({ color: 0xFFFFFF, alpha: 0xB2 / 255, x: 0, y: 1 });

function ubuntu(size, { bold = false, italic = false, color = 0x000000,
  sharpness = 80, thickness = -15, etching = null, underline = false,
  fontFamily = 'Ubuntu' } = {}) {
  return {
    fontFamily, size, bold, italic, antiAliasType: 'advanced',
    gridFitType: 'pixel', sharpness, thickness, kerning: true, color,
    ...(etching ? { etching } : {}),
    ...(underline ? { underline: true, underlineOffset: bold ? 1 : 0 } : {}),
  };
}

function volter({ bold = false, italic = false, color = 0x000000, size = 9 } = {}) {
  return {
    fontFamily: bold ? 'Volter Bold' : 'Volter', size, bold, italic,
    antiAliasType: 'normal', gridFitType: 'none', sharpness: 0,
    thickness: 0, kerning: false, color,
    ...(italic ? { italicRightOverhang: 3.75 } : {}),
  };
}

/** The 67 selectors from Habbo's decompiled primary styles.css, in source order. */
const HABBO_CSS_STYLES = {
  u_regular: ubuntu(12),
  u_bold: ubuntu(12, { bold: true }),
  u_italic: { ...ubuntu(12, { italic: true }), lineDescent: 3, italicRightOverhang: 4.65 },
  u_bold_italic: { ...ubuntu(12, { bold: true, italic: true }), lineDescent: 2.65, italicRightOverhang: 4.55 },
  u_small: ubuntu(10),
  u_button_tab: ubuntu(12),
  u_headline_small: ubuntu(14, { bold: true, sharpness: 0, thickness: 0 }),
  u_headline_medium: ubuntu(16, { bold: true, sharpness: 0, thickness: 0 }),
  u_headline_big: ubuntu(18, { bold: true }),
  u_frame_title: ubuntu(12, { bold: true }),
  u_chat_name: ubuntu(12, { bold: true }),
  u_chat_name_whisper: { ...ubuntu(12, { bold: true, italic: true }), lineDescent: 2.65, italicRightOverhang: 4.55 },
  u_chat_speak: ubuntu(12),
  u_chat_shout: ubuntu(12, { bold: true }),
  u_chat_whisper: { ...ubuntu(12, { italic: true }), lineDescent: 3, italicRightOverhang: 4.65 },
  u_tool_tip: ubuntu(11, { color: 0xFFFFFF, sharpness: 0, thickness: 0 }),
  u_tag: { ...ubuntu(10, { italic: true, sharpness: 0, thickness: 0 }), italicRightOverhang: 4.05 },
  ubuntu_condensed_regular: ubuntu(11, { fontFamily: 'UbuntuCondensed', color: 0xFFFFFF }),
  ubuntu_condensed_title: ubuntu(18, { fontFamily: 'UbuntuCondensed', color: 0xFFFFFF, thickness: 200 }),

  il_regular: ubuntu(11, { etching: ETCH_BOTTOM }),
  il_regular_white: ubuntu(11, { color: 0xFFFFFF }),
  il_small: ubuntu(9, { etching: ETCH_BOTTOM }),
  il_small_white: ubuntu(9, { color: 0xFFFFFF }),
  il_heading_title: ubuntu(18, { bold: true, etching: ETCH_BOTTOM }),
  il_heading_1: ubuntu(14, { bold: true, etching: ETCH_BOTTOM }),
  il_heading_2: ubuntu(12, { bold: true, etching: ETCH_BOTTOM }),
  il_heading_3: ubuntu(10, { bold: true, etching: ETCH_BOTTOM }),
  il_button: ubuntu(10, { bold: true, etching: ETCH_BOTTOM }),
  il_button_white: ubuntu(10, { bold: true, color: 0xEEEEEE }),
  il_border: ubuntu(10, { bold: true, etching: ETCH_BOTTOM }),
  il_frame_title: ubuntu(10, { bold: true, etching: ETCH_BOTTOM }),
  il_frame_title_white: ubuntu(10, { bold: true, color: 0xEEEEEE }),
  il_frame_modal_title: ubuntu(24, { bold: true, color: 0xFFFFFF }),
  il_link_regular: ubuntu(11, { etching: ETCH_BOTTOM, underline: true }),
  il_link_strong: ubuntu(11, { bold: true, etching: ETCH_BOTTOM, underline: true }),

  id_regular: ubuntu(11, { color: 0xFFFFFF }),
  id_small: ubuntu(9, { color: 0xFFFFFF }),
  id_heading_title: ubuntu(18, { bold: true, color: 0xFFFFFF }),
  id_heading_1: ubuntu(14, { bold: true, color: 0xFFFFFF }),
  id_heading_2: ubuntu(12, { bold: true, color: 0xFFFFFF }),
  id_heading_3: ubuntu(10, { bold: true, color: 0xFFFFFF }),
  id_button: ubuntu(10, { bold: true, color: 0xFFFFFF }),
  id_border: ubuntu(10, { bold: true, color: 0xFFFFFF }),
  id_frame_title: ubuntu(12, { fontFamily: 'UbuntuCondensed', bold: true, color: 0xFFFFFF }),
  id_frame_modal_title: ubuntu(24, { bold: true, color: 0xFFFFFF, sharpness: 0, thickness: 0 }),
  id_link_regular: ubuntu(11, { color: 0xFFFFFF, underline: true }),
  id_link_strong: ubuntu(11, { bold: true, color: 0xFFFFFF, underline: true }),

  regular: volter(),
  italic: volter({ italic: true }),
  bold: volter({ bold: true }),
  small: volter(),
  bold_italic: volter({ bold: true, italic: true }),
  button_regular: volter(),
  button_bold: volter({ bold: true }),
  button_shiny_regular: ubuntu(12),
  button_shiny_bold: ubuntu(12, { bold: true }),
  button_tab: volter(),
  frame_title: volter({ bold: true, color: 0xFFFFFF }),
  headline_big: volter({ bold: true, size: 18 }),
  headline_medium: volter({ bold: true }),
  headline_small: volter({ bold: true }),
  chat_name: volter({ bold: true }),
  chat_speak: volter(),
  chat_shout: volter({ bold: true }),
  chat_whisper: volter(),
  tool_tip: volter({ color: 0xFFFFFF }),
  tag: volter(),
};

/** Canonical selector names present in Habbo's CSS asset. */
export const HABBO_CSS_STYLE_NAMES = Object.freeze(Object.keys(HABBO_CSS_STYLES));

/** All 67 public named styles. */
export const HABBO_STYLES = Object.freeze({
  ...HABBO_CSS_STYLES,
});

const FONT_FILES = [
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

function styleDefaults(fontFamily) {
  const volter = fontFamily === 'Volter' || fontFamily === 'Volter Bold';
  return volter
    ? { size: 9, bold: fontFamily === 'Volter Bold', italic: false, antiAliasType: 'normal', gridFitType: 'none', sharpness: 0, thickness: 0, kerning: false, color: 0x000000 }
    : { size: 11, bold: false, italic: false, antiAliasType: 'advanced', gridFitType: 'pixel', sharpness: 80, thickness: -15, kerning: true, color: 0x000000 };
}

export class TruffleText {
  constructor(registry, calibration, rasterCalibration, colorCalibration, compositeCalibration) {
    this.registry = registry;
    this.calibration = calibration ?? {};
    this.rasterCalibration = rasterCalibration ?? {};
    this.colorCalibration = colorCalibration ?? {};
    this.compositeCalibration = compositeCalibration ?? null;
    this._engines = new Map();
  }

  static async load(
    fontBase = '/refs/fonts',
    calibrationUrl = '/src/calibration.json',
    rasterCalibrationUrl = '/src/raster-calibration.json',
    colorCalibrationUrl = '/src/color-calibration.json',
    compositeCalibrationUrl = '/src/composite-calibration.json',
  ) {
    const registry = new FontRegistry();
    await Promise.all(FONT_FILES.map(async ([family, bold, italic, file, required]) => {
      const response = await fetch(`${fontBase}/${file}`);
      if (!response.ok) {
        if (required) throw new Error(`failed to load font ${file}: HTTP ${response.status}`);
        return;
      }
      const buf = await response.arrayBuffer();
      registry.add(family, bold, new FlashFont(new Uint8Array(buf), family), italic);
    }));
    const loadJson = async (url, fallback) => {
      try {
        const response = await fetch(url);
        return response.ok ? await response.json() : fallback;
      } catch { return fallback; }
    };
    const [calibration, rasterCalibration, colorCalibration, compositeCalibration] = await Promise.all([
      loadJson(calibrationUrl, {}), loadJson(rasterCalibrationUrl, {}),
      loadJson(colorCalibrationUrl, {}), loadJson(compositeCalibrationUrl, null),
    ]);
    return new TruffleText(registry, calibration, rasterCalibration, colorCalibration, compositeCalibration);
  }

  /** Resolve style: name from HABBO_STYLES or a style object. */
  resolveStyle(style) {
    const named = typeof style === 'string' ? HABBO_STYLES[style] : style;
    if (!named?.fontFamily) throw new Error(`unknown style: ${typeof style === 'string' ? style : JSON.stringify(style)}`);
    const s = { ...styleDefaults(named.fontFamily), ...named };
    const baseKey = `${s.fontFamily}|${!!s.bold}|${!!s.italic}|${s.size}`;
    const legacyBaseKey = `${s.fontFamily}|${!!s.bold}|${s.size}`;
    const colorKey = `${baseKey}|${s.color ?? 0}`;
    const legacyColorKey = `${legacyBaseKey}|${s.color ?? 0}`;
    const whiteKey = `${baseKey}|16777215`;
    const legacyWhiteKey = `${legacyBaseKey}|16777215`;
    const rasterKey = `${colorKey}|${s.antiAliasType}|${s.gridFitType}|${s.sharpness}|${s.thickness}`;
    const whiteRasterKey = `${whiteKey}|${s.antiAliasType}|${s.gridFitType}|${s.sharpness}|${s.thickness}`;
    s.calibration = this.colorCalibration[colorKey] ?? this.colorCalibration[legacyColorKey] ??
      this.calibration[baseKey] ?? this.calibration[legacyBaseKey] ?? null;
    s.rasterCalibration = this.rasterCalibration[rasterKey] ??
      this.rasterCalibration[colorKey] ?? this.rasterCalibration[legacyColorKey] ?? null;
    s.etchCalibration = this.colorCalibration[whiteKey] ?? this.colorCalibration[legacyWhiteKey] ?? null;
    s.etchRasterCalibration = this.rasterCalibration[whiteRasterKey] ??
      this.rasterCalibration[whiteKey] ?? this.rasterCalibration[legacyWhiteKey] ?? null;
    s.compositeCalibration = this.compositeCalibration;
    s.applyCalibratedContextShift ??= !!s.italic && !!s.rasterCalibration;
    return s;
  }

  engine(style, fitCfg) {
    const s = this.resolveStyle(style);
    const key = JSON.stringify([
      s.fontFamily, !!s.bold, !!s.italic, s.size, s.antiAliasType, s.gridFitType,
      s.sharpness, s.thickness, !!s.kerning, s.letterSpacing ?? 0,
      s.leading ?? 0, s.color ?? 0, s.etching ?? null, !!s.underline, s.csmTune ?? null,
      s.underlineOffset ?? 0,
      s.lineAscent ?? null, s.lineDescent ?? null, s.italicRightOverhang ?? 0,
      !!s.applyCalibratedContextShift,
      fitCfg ?? null,
    ]);
    let e = this._engines.get(key);
    if (!e) {
      const layout = new TextLayout(this.registry, s, { ...DEFAULT_FIT, ...(fitCfg ?? {}) });
      e = { layout, renderer: new TextRenderer(layout), style: s };
      this._engines.set(key, e);
    }
    return e;
  }

  /** Measure text; returns TextField-like metrics incl. charBounds. */
  measure(text, style, opts = {}) {
    return this.engine(style, opts.fitCfg).layout.layout(text, opts);
  }

  /** Render to a raw RGBA buffer { width, height, data, layout }. */
  renderToBuffer(text, style, opts = {}) {
    const renderStyle = opts.color === undefined
      ? style
      : { ...(typeof style === 'string' ? HABBO_STYLES[style] : style), color: opts.color };
    const e = this.engine(renderStyle, opts.fitCfg);
    return e.renderer.render(text, {
      color: opts.color ?? e.style.color ?? 0,
      etching: opts.etching !== undefined ? opts.etching : e.style.etching ?? null,
      wordWrap: opts.wordWrap, width: opts.width, padding: opts.padding ?? 0,
    });
  }

  /** Draw onto a canvas 2D context at integer (x, y) — top-left of the field. */
  drawText(ctx, text, { x = 0, y = 0, style = 'il_regular', ...opts } = {}) {
    const buf = this.renderToBuffer(text, style, opts);
    const img = new ImageData(new Uint8ClampedArray(buf.data), buf.width, buf.height);
    // integer placement only — fractional field positions destroy grid fitting
    ctx.putImageData(img, Math.round(x), Math.round(y));
    return buf.layout;
  }
}

export { FlashFont, FontRegistry, TextLayout, TextRenderer, GUTTER, DEFAULT_FIT };
// Exported for the packed-payload loader (src/packed.js); no behavior change.
export { FONT_FILES, styleDefaults };
