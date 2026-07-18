/**
 * textfield.js — Flash TextField layout emulation.
 *
 * Reproduces (verified against refs/air dumps):
 *   - 2px gutter on every side (charBounds start at x=2, width = textWidth+4)
 *   - ascent/descent = floor-to-twip of usWinAscent/usWinDescent scaled
 *   - normal AA: advance_i = floor-to-twip(rawAdvance)  [Volter exact match]
 *   - advanced+pixel: advance_i = grid-fitted advance (phase dependent!)
 *   - getCharBoundaries(i) = {x: 2+Σadv, y: 2+lineTop, w: adv_i, h: lineHeight}
 *   - left-aligned autoSize first; wrapping on Flash word delimiters
 */

import { floorTwip, roundTwip } from '../font/flashfont.js';
import { toQuadratics, flatten } from '../truffle/outline.js';
import { gridFitGlyph, DEFAULT_FIT } from '../truffle/gridfit.js';

export const GUTTER = 2;
const WORD_DELIMS = /[~%&!\\;:"',<>?#\s.\-()=\[\]{}^_]/; // from TextFieldController

export class TextLayout {
  /**
   * fonts: FontRegistry with get(family, bold) → FlashFont
   * style: { fontFamily, size, bold, antiAliasType, gridFitType, sharpness,
   *          thickness, kerning, letterSpacing, leading }
   */
  constructor(fonts, style, fitCfg = DEFAULT_FIT) {
    this.fonts = fonts;
    this.style = style;
    this.fitCfg = fitCfg;
    this.font = fonts.get(style.fontFamily, !!style.bold, !!style.italic);
    this._flatCache = new Map();
    this._cCache = new Map();
    this._stableRasterBoundsCache = new Map();
    // optional calibration: measured FlashType hinted advances (C values)
    // keyed by char, from AIR getCharBoundaries dumps (see tests/build-calibration.mjs)
    this.calibration = style.calibration ?? null;
  }

  /**
   * FlashType hinted geometry for a char.
   * Returns { C, theta, inkShift }:
   *   C        — hinted advance (calibrated from AIR when available)
   *   theta    — phase threshold for the +1 jump (calibrated or null)
   *   inkShift — integer x shift of AIR's hinted raster relative to our
   *              geometric hint (round(C_measured − C_geometric)); the same
   *              zones that widen the advance also sit further right.
   */
  hintedAdvance(cp) {
    let C = this._cCache.get(cp);
    if (C === undefined) {
      const ch = String.fromCodePoint(cp);
      const { outline, polys } = this._flat(cp);
      const geoC = outline.empty ? floorTwip(outline.advance)
        : gridFitGlyph(polys, 0, 0, outline.advance, this.style.size, this.fitCfg,
          null, outline.alignmentZones).advance;
      const e = this.calibration ? this.calibration[ch] : undefined;
      if (e !== undefined) {
        const arr = Array.isArray(e) ? e : [e];
        const cVal = arr[0];
        const theta = arr.length > 1 ? arr[1] : null;
        // ink offsets: measured directly from AIR PNGs when present (arr[2..3]),
        // otherwise derived from the advance delta; 'zero' mode is used while
        // MEASURING offsets (tests/build-calibration.mjs) to avoid circularity.
        let inkShift, inkDy;
        if (this.style.calibrationInkMode === 'zero') { inkShift = 0; inkDy = 0; }
        else if (arr.length >= 3) { inkShift = arr[2]; inkDy = arr[3] ?? 0; }
        else { inkShift = Math.max(-2, Math.min(2, Math.round(cVal - geoC))); inkDy = 0; }
        C = {
          C: cVal,
          theta,
          inkShift,
          inkDy,
          seenMask: arr[4] ?? 0,
          jumpMask: arr[5] ?? 0,
          inkDxByPhase: arr[6] ?? null,
          sumByPhase: arr[7] ?? null,
          nextSumByPhase: arr[8] ?? null,
          runSumByContext: arr[9] ?? null,
          inkDxByContext: arr[10] ?? null,
          deepSumByContext: arr[11] ?? null,
          calibratedInkDxByPhase: arr[12] ?? null,
          prefixSumByContext: arr[13] ?? null,
          inkDxByPrefixContext: arr[14] ?? null,
        };
      } else {
        if (this.style.fidelity === 'exact' && this.advancedPixel) {
          throw new Error(`exact advance calibration is unavailable for ${ch} ` +
            `in ${this.style.fontFamily} ${this.style.size}px`);
        }
        this.style._reportFallback?.({
          stage: 'layout',
          reason: this.style.fidelity === 'geometric' ? 'geometric-requested' : 'calibration-miss',
          codePoint: cp,
          character: ch,
          signature: `${this.style.fontFamily}|${!!this.style.bold}|${!!this.style.italic}|${this.style.size}`,
        });
        C = { C: geoC, theta: null, inkShift: 0, inkDy: 0 };
      }
      this._cCache.set(cp, C);
    }
    return C;
  }

  /**
   * Fitted step for a char at pen position penX (field coords, x only).
   * Returns { advance, jump, inkShift } — jump is the +1 cell extension AIR
   * applies past the per-glyph phase threshold; the rendered origin is
   * floor(pen) + jump (+ inkShift inside the raster).
   */
  fittedStep(cp, penX, nextCp = 0, runKey = '', deepKey = '', prefixKey = '') {
    const h = this.hintedAdvance(cp);
    const { C, theta, seenMask, jumpMask } = h;
    const phase = penX - Math.floor(penX + 1e-9);
    // exact observed outcome for this twip phase beats the theta estimate
    const ph20 = Math.round(phase * 20) % 20;
    let jump;
    if (seenMask && (seenMask >> ph20) & 1) {
      jump = (jumpMask >> ph20) & 1;
    } else {
      const th = theta ?? this.fitCfg.jumpThreshold ?? 0.85;
      jump = phase >= th - 1e-9 ? 1 : 0;
    }
    const nextCh = nextCp ? String.fromCodePoint(nextCp) : '';
    const lookupObservedPhase = (table) => {
      if (!table) return undefined;
      if (table[ph20] !== undefined) return table[ph20];
      // Reported bounds are twip-rounded; a preceding step can leave our
      // simulated pen one twip away from AIR's bucket. Only run-context
      // measurements get this nearest-bucket fallback, and only by one twip.
      const left = table[(ph20 + 19) % 20], right = table[(ph20 + 1) % 20];
      return left !== undefined ? left : right;
    };
    const prefixSum = h.prefixSumByContext?.[prefixKey]?.[ph20];
    const deepSum = h.deepSumByContext?.[deepKey]?.[ph20];
    const runSum = lookupObservedPhase(h.runSumByContext?.[runKey]);
    // AIR exposes a distinct terminal state for regular Ubuntu (notably the
    // final g in the pangram). The bold etched fixtures do not replay that
    // state consistently, so keep their established phase median.
    const terminalSum = !this.style.bold ? h.nextSumByPhase?.['']?.[ph20] : undefined;
    const measuredSum = prefixSum ?? deepSum ?? runSum ??
      h.nextSumByPhase?.[nextCh]?.[ph20] ?? terminalSum ?? h.sumByPhase?.[ph20];
    if (measuredSum !== undefined) jump = measuredSum - C > 0.5 ? 1 : 0;
    const next = measuredSum !== undefined
      ? penX + (measuredSum - phase)
      : Math.floor(penX + 1e-9) + C + jump;
    // per-phase measured ink override beats the glyph-global ink shift
    let inkShift = h.inkShift;
    let calibratedInkShift = 0;
    const prefixInk = this.style.calibrationInkMode !== 'zero'
      ? h.inkDxByPrefixContext?.[prefixKey]?.[ph20] : undefined;
    const contextInk = this.style.calibrationInkMode !== 'zero'
      ? (prefixInk ?? h.inkDxByContext?.[runKey]?.[ph20]) : undefined;
    if (contextInk !== undefined) {
      inkShift = contextInk;
      const [runLeader, runIndex] = JSON.parse(runKey);
      if (this.style.applyCalibratedContextShift && (runIndex > 0 || runLeader)) {
        calibratedInkShift = contextInk;
      }
    }
    else if (h.inkDxByPhase && this.style.calibrationInkMode !== 'zero' && h.inkDxByPhase[ph20] !== undefined) {
      inkShift = h.inkDxByPhase[ph20];
    }
    // NOTE: pen accumulates twip-rounded (tested: sub-twip pen tracking scored
    // WORSE against golden data — AIR appears to round the pen per glyph too)
    return { advance: roundTwip(Math.max(0.05, next - penX)), jump, inkShift, calibratedInkShift, inkDy: h.inkDy };
  }

  get advancedPixel() {
    return this.style.antiAliasType !== 'normal' && this.style.gridFitType === 'pixel';
  }

  lineMetrics() {
    const lm = this.font.lineMetrics(this.style.size);
    const leading = (this.style.leading ?? 0) + lm.leading * 0; // Flash: font lineGap NOT added per line box
    const ascent = this.style.lineAscent ?? lm.ascent;
    const descent = this.style.lineDescent ?? lm.descent;
    return { ascent, descent, leading, height: ascent + descent + (this.style.leading ?? 0) };
  }

  _flat(cp) {
    let f = this._flatCache.get(cp);
    if (!f) {
      const o = this.font.outline(cp, this.style.size);
      f = { outline: o, polys: o.contours.map(c => flatten(toQuadratics(c), 0.03)) };
      this._flatCache.set(cp, f);
    }
    return f;
  }

  /**
   * Advance of character cp when pen is at absolute x=penX, baseline y=baseY.
   * Grid fitting makes this phase-dependent in advanced+pixel mode.
   */
  advanceOf(cp, penX, baseY, nextCp = 0, runKey = '', deepKey = '', prefixKey = '') {
    const { outline } = this._flat(cp);
    let adv;
    if (this.advancedPixel) {
      // FlashType model (see docs/FINDINGS.md): glyph hinted once (advance C),
      // raster stamped at floor(pen)+jump → advance = floor(pen)+C+jump − pen.
      // Spaces have no outline, but AIR still reports phase-dependent fitted
      // advances for them; keep them on the calibrated path too.
      adv = this.fittedStep(cp, penX, nextCp, runKey, deepKey, prefixKey).advance;
    } else {
      adv = floorTwip(outline.advance);
      // Optional non-Habbo mode for bitmap/pixel fonts: keep normal-AA
      // coverage semantics while preventing fractional phase accumulation on
      // long strings. The default remains AIR-faithful floor-twip advances.
      if (this.style.pixelFont === 'snapAdvances' && this.style.fidelity !== 'exact') {
        adv = Math.max(1, Math.round(adv));
      }
    }
    if (this.style.kerning && nextCp) adv += roundTwip(this.font.kern(cp, nextCp, this.style.size));
    if (this.style.letterSpacing) adv += this.style.letterSpacing;
    return adv;
  }

  _stableRasterBounds(cp) {
    if (this._stableRasterBoundsCache.has(cp)) return this._stableRasterBoundsCache.get(cp);
    const entry = this.style.rasterCalibration?.[String.fromCodePoint(cp)];
    if (!entry?.alpha?.length) {
      this._stableRasterBoundsCache.set(cp, null);
      return null;
    }
    const scan = threshold => {
      let left = Infinity;
      let right = -Infinity;
      for (let y = 0; y < entry.h; y++) for (let x = 0; x < entry.w; x++) {
        if (entry.alpha[y * entry.w + x] < threshold) continue;
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
      return Number.isFinite(left)
        ? { left: entry.x0 + left, right: entry.x0 + right }
        : null;
    };
    const any = scan(1);
    const strong = scan(192) ?? scan(128) ?? any;
    const bounds = any && strong ? { any, strong } : null;
    this._stableRasterBoundsCache.set(cp, bounds);
    return bounds;
  }

  /**
   * Lay out text. opts: { wordWrap, width } width = field width (incl gutters).
   * Returns { lines, charBounds, textWidth, textHeight, width, height, metrics }
   * lines: [{ chars: [{cp, i, penX, advance}], top, baseline }]  (field coords, y-down)
   */
  layout(text, opts = {}) {
    const m = this.lineMetrics();
    const wrapW = opts.wordWrap && opts.width ? opts.width - 2 * GUTTER : Infinity;
    const paragraphs = String(text).split(/\r\n|[\r\n]/);
    const lines = [];
    const charBounds = new Array(text.length).fill(null);
    let charIndex = 0;

    for (const para of paragraphs) {
      let line = { chars: [] };
      let penX = 0;
      let lastBreak = -1; // index in line.chars after which we can break
      // AIR retains fitted pen state that is not fully represented by the
      // exported 1/20px char-boundary phase. Two leading glyphs are enough to
      // distinguish the baked plain / l-prefixed / To-prefixed state families
      // without keying calibration by a complete string.
      const linePrefix = [...para].slice(0, 2).join('');

      const pushLine = () => { lines.push(line); line = { chars: [] }; penX = 0; lastBreak = -1; };

      for (let k = 0; k < para.length; k++) {
        const cp = para.codePointAt(k);
        // AIR drops characters that are absent from an embedded font: they
        // have a null getCharBoundaries() entry, contribute no advance, and
        // do not become the preceding glyph for the next fitted-state step.
        // Falling through to TTF glyph 0 would incorrectly render/advance the
        // .notdef box (notably ten requested characters in Volter Bold).
        if (this.font.glyphId(cp) === 0) continue;
        let runIndex = 0;
        let runLeader = '';
        const previous = line.chars[line.chars.length - 1];
        if (previous && previous.cp === cp) {
          runIndex = (previous.runIndex ?? 0) + 1;
          runLeader = previous.runLeader ?? '';
        } else if (previous) {
          runLeader = String.fromCodePoint(previous.cp);
        }
        const previous2 = line.chars.length > 1
          ? String.fromCodePoint(line.chars[line.chars.length - 2].cp) : '';
        const nextCpForRun = this.style.kerning && k + 1 < para.length ? para.codePointAt(k + 1) : 0;
        const nextGlyph = nextCpForRun ? String.fromCodePoint(nextCpForRun) : '';
        const runKey = JSON.stringify([runLeader, runIndex, nextGlyph]);
        const deepKey = JSON.stringify([previous2, runLeader, runIndex, nextGlyph]);
        const prefixKey = JSON.stringify([linePrefix, previous2, runLeader, runIndex, nextGlyph]);
        const lineTop = lines.length * (m.height + m.leading); // provisional; same for all in single-font field
        const baseY = GUTTER + lineTop + m.ascent;
        let adv = this.advanceOf(cp, penX, -baseY, nextCpForRun, runKey, deepKey, prefixKey);
        if (penX + adv > wrapW && line.chars.length > 0 && !/\s/.test(para[k])) {
          if (lastBreak >= 0 && lastBreak < line.chars.length - 0) {
            // move chars after break to next line
            const moved = line.chars.splice(lastBreak + 1);
            pushLine();
            for (const mc of moved) {
              const nb = GUTTER + lines.length * (m.height + m.leading) + m.ascent;
              const a2 = this.advanceOf(mc.cp, penX, -nb, 0, '');
              mc.penX = penX; mc.advance = a2;
              line.chars.push(mc);
              penX = roundTwip(penX + a2);
            }
          } else {
            pushLine();
          }
        }
        const nextCp = nextCpForRun;
        const step = this.advancedPixel
          ? this.fittedStep(cp, penX, nextCp, runKey, deepKey, prefixKey) : { jump: 0, inkShift: 0, calibratedInkShift: 0, inkDy: 0 };
        let autoClipLeft = null;
        const stableAuto = this.style.fidelity === 'auto' &&
          this.style.autoRasterPolicy === 'stable' && this.advancedPixel &&
          !Number.isFinite(wrapW);
        if (stableAuto && previous && !this._flat(previous.cp).outline.empty &&
          !this._flat(cp).outline.empty) {
          const previousBounds = this._stableRasterBounds(previous.cp);
          const currentBounds = this._stableRasterBounds(cp);
          if (previousBounds && currentBounds) {
            const previousOrigin = Math.floor(previous.penX) + (previous.jump ?? 0) +
              (previous.calibratedInkShift ?? 0);
            let currentOrigin = Math.floor(penX) + (step.jump ?? 0) +
              (step.calibratedInkShift ?? 0);
            let strongGap = currentOrigin + currentBounds.strong.left -
              (previousOrigin + previousBounds.strong.right);
            if (strongGap < 2) {
              const opticalShift = Math.min(3, 2 - strongGap);
              previous.advance = roundTwip(previous.advance + opticalShift);
              penX = roundTwip(penX + opticalShift);
              currentOrigin += opticalShift;
              strongGap += opticalShift;
            }
            const anyGap = currentOrigin + currentBounds.any.left -
              (previousOrigin + previousBounds.any.right);
            if (strongGap >= 2 && anyGap < 2) {
              previous.autoClipRight = previousBounds.strong.right;
              autoClipLeft = currentBounds.strong.left;
            }
          }
        }
        line.chars.push({ cp, i: charIndex + k, penX, advance: adv, jump: step.jump, inkShift: step.inkShift, calibratedInkShift: step.calibratedInkShift, inkDy: step.inkDy, runIndex, runLeader, runKey, rasterKey: prefixKey, autoClipLeft });
        penX = roundTwip(penX + adv);
        if (WORD_DELIMS.test(para[k])) lastBreak = line.chars.length - 1;
      }
      lines.push(line);
      charIndex += para.length + 1; // +1 for the newline char
    }

    // finalize geometry
    let textWidth = 0;
    lines.forEach((line, li) => {
      line.top = li * (m.height + m.leading);
      line.baseline = GUTTER + line.top + m.ascent;
      let w = 0;
      for (const c of line.chars) {
        const x0 = roundTwip(c.penX), x1 = roundTwip(c.penX + c.advance);
        w = x1;
        charBounds[c.i] = {
          x: GUTTER + x0, y: GUTTER + line.top,
          width: roundTwip(x1 - x0), height: m.height,
          right: GUTTER + x1, bottom: GUTTER + line.top + m.height,
        };
      }
      textWidth = Math.max(textWidth, w);
    });
    const textHeight = lines.length * m.height + (lines.length - 1) * m.leading;

    return {
      lines, charBounds,
      textWidth, textHeight,
      width: roundTwip(textWidth + 2 * GUTTER + (this.style.italicRightOverhang ?? 0)),
      height: roundTwip(textHeight + 2 * GUTTER),
      metrics: m,
    };
  }
}

/** Simple font registry. */
export class FontRegistry {
  constructor() { this.map = new Map(); }
  add(family, bold, flashFont, italic = false) {
    this.map.set(`${family}|${!!bold}|${!!italic}`, flashFont);
    return this;
  }
  get(family, bold, italic = false) {
    const exact = this.map.get(`${family}|${!!bold}|${!!italic}`);
    const regularWeight = this.map.get(`${family}|false|${!!italic}`);
    const legacy = !italic
      ? (this.map.get(`${family}|${!!bold}`) ?? this.map.get(`${family}|false`))
      : null;
    const f = exact ?? regularWeight ?? legacy;
    if (!f) throw new Error(`font not registered: ${family} bold=${!!bold} italic=${!!italic}`);
    return f;
  }

  has(family, bold = false, italic = false) {
    try { return !!this.get(family, bold, italic); }
    catch { return false; }
  }

  getExact(family, bold = false, italic = false) {
    return this.map.get(`${family}|${!!bold}|${!!italic}`) ?? null;
  }

  families() {
    return [...new Set([...this.map.keys()].map(key => key.split('|', 1)[0]))];
  }
}
