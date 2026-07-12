/**
 * flashfont.js — Emulates how Flash/AIR sees an embedded TTF (DefineFont3-style).
 *
 * Unit spaces (explicit, per project rule):
 *   - FONT UNITS: raw TTF grid (unitsPerEm, Habbo fonts use 1024).
 *   - SWF EM: DefineFont3 stores shapes/advances in twips of a 1024-unit em
 *     (i.e. 1024*20 = 20480 twips per em).
 *   - LOGICAL PX: pixels at the requested TextFormat size. 1 px = 20 twips.
 *
 * Verified against AIR getCharBoundaries dumps (refs/air):
 *   - ascent  = floor(usWinAscent  * size / unitsPerEm * 20) / 20
 *   - descent = floor(usWinDescent * size / unitsPerEm * 20) / 20
 *   - normal-AA advance = floor(rawAdvancePx * 20) / 20   (Volter matches exactly)
 *   - advanced-AA advances are grid-fit modified (see truffle/gridfit.js)
 */

import { parseTTF } from './ttf.js';

export const TWIP = 1 / 20;
export const floorTwip = (v) => Math.floor(v * 20 + 1e-9) / 20;
export const roundTwip = (v) => Math.round(v * 20) / 20;

export class FlashFont {
  constructor(ttfBuffer, name) {
    this.name = name;
    this.ttf = parseTTF(ttfBuffer);
    this.em = this.ttf.unitsPerEm;
  }

  /** Raw (unquantized) advance in logical px at `size`. */
  rawAdvance(codePoint, size) {
    const gid = this.ttf.glyphIndex(codePoint);
    return this.ttf.advanceOf(gid) * size / this.em;
  }

  /** Flash line metrics at `size` (logical px, floor-quantized to twips). */
  lineMetrics(size) {
    const os2 = this.ttf.os2;
    const asc = os2 ? os2.usWinAscent : this.ttf.hhea.ascent;
    const desc = os2 ? os2.usWinDescent : -this.ttf.hhea.descent;
    const ascent = floorTwip(asc * size / this.em);
    const descent = floorTwip(desc * size / this.em);
    const leading = floorTwip(this.ttf.hhea.lineGap * size / this.em);
    return { ascent, descent, leading, height: ascent + descent };
  }

  glyphId(codePoint) { return this.ttf.glyphIndex(codePoint); }

  kern(leftCp, rightCp, size) {
    const k = this.ttf.kernOf(this.ttf.glyphIndex(leftCp), this.ttf.glyphIndex(rightCp));
    return k * size / this.em;
  }

  /**
   * Glyph outline in logical px at `size`, y-UP, origin at pen position on baseline.
   * Coordinates are quantized to the SWF twip grid first (DefineFont3 stores
   * integer twips in the 1024 em), matching what Flash actually rasterizes.
   * Returns { contours: [ [ {x,y,on} ] ], advance }
   */
  outline(codePoint, size) {
    const gid = this.ttf.glyphIndex(codePoint);
    const g = this.ttf.glyph(gid);
    const s = size / this.em;
    const contours = g.contours.map(c => c.map(p => ({
      // quantize to SWF em twips, then scale to px
      x: Math.round(p.x * 20) / 20 * s,
      y: Math.round(p.y * 20) / 20 * s,
      on: p.on,
    })));
    return {
      contours,
      advance: this.ttf.advanceOf(gid) * s,
      lsb: this.ttf.lsbOf(gid) * s,
      xMin: g.xMin * s, xMax: g.xMax * s, yMin: g.yMin * s, yMax: g.yMax * s,
      empty: g.contours.length === 0,
    };
  }
}
