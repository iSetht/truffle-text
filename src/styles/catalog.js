/**
 * Public style catalog and style-property resolution.
 *
 * Named Habbo selectors are compatibility presets, not rendering boundaries.
 * Callers can start from a preset and freely override size, face, color, CSM,
 * spacing, and fidelity properties.
 */

export const ETCH_BOTTOM = Object.freeze({
  color: 0xFFFFFF, alpha: 0xB2 / 255, x: 0, y: 1,
});

function ubuntu(size, { bold = false, italic = false, color = 0x000000,
  sharpness = 80, thickness = -15, etching = null, underline = false,
  fontFamily = 'Ubuntu' } = {}) {
  return {
    fontFamily, size, bold, italic, antiAliasType: 'advanced',
    gridFitType: 'pixel', sharpness, thickness, kerning: true, color,
    // Named Ubuntu UI styles prefer the context-free calibrated base mask in
    // auto mode. Exact mode still replays all observed AIR phase/context data.
    autoRasterPolicy: 'stable',
    ...(etching ? { etching } : {}),
    // Named link presets preserve their certified AIR row. Underlines added
    // dynamically use the product-wide one-pixel breathing room below.
    ...(underline ? { underline: true, underlineOffset: bold ? 1 : 0, underlineGap: 0 } : {}),
  };
}

function volter({ bold = false, italic = false, color = 0x000000, size = 9 } = {}) {
  return {
    fontFamily: bold ? 'Volter Bold' : 'Volter', size, bold, italic,
    antiAliasType: 'normal', gridFitType: 'none', sharpness: 0,
    thickness: 0, kerning: false, color, pixelFont: 'snapAdvances',
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

export const HABBO_CSS_STYLE_NAMES = Object.freeze(Object.keys(HABBO_CSS_STYLES));
export const HABBO_STYLES = Object.freeze({ ...HABBO_CSS_STYLES });

/**
 * A family graph maps logical weight/style changes to real bundled faces.
 * Ubuntu uses one family with bold/italic flags; Volter's bold face has a
 * distinct embedded family name.
 */
export const FONT_FAMILY_GRAPH = Object.freeze({
  Ubuntu: Object.freeze({ regular: 'Ubuntu', bold: 'Ubuntu', italic: 'Ubuntu', boldItalic: 'Ubuntu' }),
  UbuntuCondensed: Object.freeze({ regular: 'UbuntuCondensed', bold: 'UbuntuCondensed', italic: 'UbuntuCondensed', boldItalic: 'UbuntuCondensed' }),
  Volter: Object.freeze({ regular: 'Volter', bold: 'Volter Bold', italic: 'Volter', boldItalic: 'Volter Bold' }),
  'Volter Bold': Object.freeze({ regular: 'Volter', bold: 'Volter Bold', italic: 'Volter', boldItalic: 'Volter Bold' }),
});

export function styleDefaults(fontFamily) {
  const isVolter = fontFamily === 'Volter' || fontFamily === 'Volter Bold';
  return isVolter
    ? { size: 9, bold: fontFamily === 'Volter Bold', italic: false, antiAliasType: 'normal', gridFitType: 'none', sharpness: 0, thickness: 0, kerning: false, color: 0x000000, pixelFont: 'snapAdvances' }
    : { size: 11, bold: false, italic: false, antiAliasType: 'advanced', gridFitType: 'pixel', sharpness: 80, thickness: -15, kerning: true, color: 0x000000 };
}

/** Resolve a preset/raw style plus overrides into a validated property bag. */
export function resolveStyleProperties(style, overrides = {}) {
  const descriptor = style ?? overrides?.styleName;
  const styleObject = descriptor && typeof descriptor === 'object' ? descriptor : null;
  const styleName = typeof descriptor === 'string'
    ? descriptor
    : styleObject?.styleName;
  const preset = styleName ? HABBO_STYLES[styleName] : null;
  if (styleName && !preset) throw new Error(`unknown style: ${styleName}`);

  const inline = styleObject ? withoutKey(styleObject, 'styleName') : {};
  const normalizedOverrides = normalizeAliases({ ...inline, ...overrides });
  delete normalizedOverrides.styleName;
  const seed = { ...(preset ?? {}), ...normalizedOverrides };
  if (!seed.fontFamily) {
    throw new Error(`unknown style: ${JSON.stringify(style)}`);
  }

  const baseSize = preset?.size ?? styleDefaults(seed.fontFamily).size;
  seed.size = resolveSize(seed.size, baseSize);
  if (!Number.isFinite(seed.size) || seed.size <= 0) {
    throw new RangeError(`font size must be a positive number, got ${seed.size}`);
  }

  const result = {
    ...styleDefaults(seed.fontFamily),
    ...(preset ?? {}),
    ...normalizedOverrides,
    size: seed.size,
  };
  result.bold = toBoolean(result.bold);
  result.italic = toBoolean(result.italic);
  result.kerning = toBoolean(result.kerning);
  result.underline = toBoolean(result.underline);
  if (result.underline && result.underlineGap === undefined) result.underlineGap = 1;
  result.fontFamily = resolveFaceFamily(result.fontFamily, result.bold, result.italic);
  result.fidelity ??= 'auto';
  if (!['auto', 'exact', 'geometric'].includes(result.fidelity)) {
    throw new RangeError(`fidelity must be "auto", "exact", or "geometric", got ${result.fidelity}`);
  }

  // Preset metric exceptions describe a particular face and size. Scale them
  // when a named preset is used as the base for a different size, unless the
  // caller supplied an explicit metric override.
  if (preset && result.size !== preset.size) {
    if (preset.lineAscent !== undefined && normalizedOverrides.lineAscent === undefined) {
      result.lineAscent = preset.lineAscent * result.size / preset.size;
    }
    if (preset.lineDescent !== undefined && normalizedOverrides.lineDescent === undefined) {
      result.lineDescent = preset.lineDescent * result.size / preset.size;
    }
    if (preset.italicRightOverhang !== undefined && normalizedOverrides.italicRightOverhang === undefined) {
      result.italicRightOverhang = preset.italicRightOverhang * result.size / preset.size;
    }
  }

  // Switching a named regular preset to an italic face needs the face's
  // overhang reservation even though the base preset did not carry one.
  if (preset && result.italic && result.italicRightOverhang === undefined) {
    result.italicRightOverhang = italicOverhang(result.fontFamily, result.bold, result.size);
  }
  return result;
}

function normalizeAliases(style) {
  const out = { ...style };
  if (out.fontSize !== undefined && out.size === undefined) out.size = out.fontSize;
  if (out.fontWeight !== undefined && out.bold === undefined) {
    const weight = String(out.fontWeight).toLowerCase();
    out.bold = weight === 'bold' || Number(weight) >= 600;
  }
  if (out.fontStyle !== undefined && out.italic === undefined) {
    out.italic = /italic|oblique/i.test(String(out.fontStyle));
  }
  if (out.fontFace !== undefined && out.fontFamily === undefined) out.fontFamily = out.fontFace;
  if (out.antialiasType !== undefined && out.antiAliasType === undefined) out.antiAliasType = out.antialiasType;
  if (out.gridfitType !== undefined && out.gridFitType === undefined) out.gridFitType = out.gridfitType;
  if (out.letter_spacing !== undefined && out.letterSpacing === undefined) out.letterSpacing = Number(out.letter_spacing);
  delete out.fontSize;
  delete out.fontWeight;
  delete out.fontStyle;
  delete out.fontFace;
  delete out.antialiasType;
  delete out.gridfitType;
  delete out.letter_spacing;
  return out;
}

function resolveSize(value, base) {
  if (typeof value === 'string' && /^[+-](?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) {
    return base + Number(value);
  }
  const numeric = Number(value ?? base);
  return numeric;
}

function resolveFaceFamily(family, bold, italic) {
  const graph = FONT_FAMILY_GRAPH[family];
  if (!graph) return family;
  return graph[bold ? (italic ? 'boldItalic' : 'bold') : (italic ? 'italic' : 'regular')];
}

function italicOverhang(family, bold, size) {
  if (family === 'Volter' || family === 'Volter Bold') return 3.75 * size / 9;
  if (family === 'Ubuntu') return (bold ? 4.55 : 4.65) * size / 12;
  return 0;
}

function toBoolean(value) {
  if (typeof value === 'string') return !/^(?:false|0|no|off)$/i.test(value);
  return !!value;
}

function withoutKey(object, key) {
  const copy = { ...object };
  delete copy[key];
  return copy;
}
