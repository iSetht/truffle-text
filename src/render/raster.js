/**
 * raster.js — Rasterizes a grid-fitted glyph instance to an alpha bitmap.
 * Deterministic: no browser text APIs anywhere. Output pixels are final
 * device pixels; callers place bitmaps at integer coordinates only.
 */

import { toQuadratics, flatten, bbox } from '../truffle/outline.js';
import { gridFitGlyph, DEFAULT_FIT, resolveStyleAlphaTune } from '../truffle/gridfit.js';
import { signedDistance, coverageAt } from '../truffle/distance.js';
import { csmParams, densityOf, TUNE } from '../truffle/csm.js';

/**
 * Render a glyph.
 * outline: from FlashFont.outline() (glyph space, y-up)
 * penX, baselineY: absolute device-px pen position (fractional allowed;
 *                  grid fitting decides where ink actually lands)
 * style: { antiAliasType, gridFitType, sharpness, thickness, size }
 * Returns { x0, y0, w, h, alpha: Uint8ClampedArray, advance } with
 * x0,y0 = integer top-left of the bitmap in device space (y-down).
 */
export function rasterizeGlyph(outline, penX, baselineY, style, fitCfg = DEFAULT_FIT, profile = null) {
  const advanced = style.antiAliasType !== 'normal';
  const gridFit = advanced && style.gridFitType === 'pixel';

  if (outline.empty) {
    return { x0: 0, y0: 0, w: 0, h: 0, alpha: new Uint8ClampedArray(0), advance: outline.advance };
  }

  const flatPolys = outline.contours.map(c => flatten(toQuadratics(c), 0.03));

  // y-up absolute polygons + optional grid fit
  let polys, advance;
  if (gridFit) {
    // FlashType behavior (verified on AIR dumps): the glyph is hinted ONCE in
    // its own space (x phase 0) and the raster is stamped at floor(pen) —
    // ink patterns of stem glyphs are identical at every pen phase. The y
    // phase (baseline subpixel position) does participate in hinting.
    const fit = gridFitGlyph(flatPolys, 0, baselineY, outline.advance, style.size,
      fitCfg, profile, outline.alignmentZones);
    polys = fit.polys;
    advance = fit.advance;
  } else {
    // Flash "normal" AA: glyph origin snaps to the nearest 1/4 px before
    // coverage sampling (verified: AIR alphas are exact quarter steps and
    // ink lands on the 0.25 grid regardless of the twip-precise pen position).
    const qx = Math.floor(penX * 4 + 0.5) / 4;
    const qy = Math.floor(baselineY * 4 + 0.5) / 4;
    polys = flatPolys.map(p => p.map(q => ({ x: q.x + qx, y: q.y + qy })));
    advance = outline.advance;
  }

  const bb = bbox(polys);
  const pad = advanced ? 1 : 0;
  const x0 = Math.floor(bb.xMin) - pad;
  const x1 = Math.ceil(bb.xMax) + pad;
  // y-up ink range → y-down rows. deviceY = baseline-based absolute y-down = -yUp
  const yTop = Math.floor(-bb.yMax) - pad;   // device row of ink top
  const yBot = Math.ceil(-bb.yMin) + pad;
  const w = x1 - x0, h = yBot - yTop;
  const alpha = new Uint8ClampedArray(w * h);

  if (advanced) {
    // Small bold Ubuntu fields with sharpness=0 are commonly produced by XML
    // size overrides (for example u_headline_small at 12px). They have no
    // certified raster row, and the generic 1.4px transition makes a hinted
    // one-pixel stem mostly grey. Narrow only that geometric transition; a
    // certified/auto replay never enters this tuning path.
    const scalableTune = (style.fidelity === 'geometric' || style.certified === false) &&
      style.fontFamily === 'Ubuntu' && !!style.bold && style.size <= 14 &&
      (style.sharpness ?? 0) <= 0
      ? { baseHalfWidth: 0.46 }
      : null;
    const csmTune = {
      ...TUNE, ...scalableTune, ...(profile?.csmTune ?? {}), ...(style.csmTune ?? {}),
    };
    const styleAlpha = resolveStyleAlphaTune(style);
    const p = csmParams(style.sharpness ?? 0, style.thickness ?? 0, csmTune);
    const maxD = Math.max(1.5, Math.abs(p.outsideCutoff) + 1);
    for (let ry = 0; ry < h; ry++) {
      const sy = -(yTop + ry + 0.5); // sample in y-up space at pixel center
      for (let rx = 0; rx < w; rx++) {
        const sx = x0 + rx + 0.5;
        const d = signedDistance(sx, sy, polys, maxD);
        let a = densityOf(d, p);
        // A few embedded AIR glyphs have a repeatable CSM transfer curve
        // difference from the generic Ubuntu profile. Keep this correction
        // raster-only and clamp it after density generation; it cannot alter
        // advances, bounds, or placement.
        if (profile?.alphaGamma !== undefined || profile?.alphaScale !== undefined) {
          const q = a / 255;
          const gamma = profile.alphaGamma ?? 1;
          const scale = profile.alphaScale ?? 1;
          a = Math.round(255 * Math.min(1, Math.pow(q, gamma) * scale));
        }
        if (styleAlpha) {
          const q = a / 255;
          a = Math.round(255 * Math.min(1, Math.pow(q, styleAlpha.alphaGamma) * styleAlpha.alphaScale));
        }
        alpha[ry * w + rx] = a;
      }
    }
  } else {
    for (let ry = 0; ry < h; ry++) {
      const sy = -(yTop + ry + 0.5);
      for (let rx = 0; rx < w; rx++) {
        const sx = x0 + rx + 0.5;
        // floor: matches AIR's quarter-step alphas exactly
        alpha[ry * w + rx] = Math.floor(255 * coverageAt(sx, sy, polys, 4));
      }
    }
  }

  if (profile?.alphaMask && profile.alphaMaskW === w && profile.alphaMaskH === h) {
    alpha.fill(0);
    for (let i = 0; i < alpha.length; i++) alpha[i] = profile.alphaMask[i] ?? 0;
  }

  return { x0, y0: yTop, w, h, alpha, advance };
}
