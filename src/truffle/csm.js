/**
 * csm.js — Continuous Stroke Modulation (Truffle 3.1).
 *
 * Maps signed distance (positive inside, logical px) to density 0..255 using
 * outside/inside cutoffs (gamma fixed at 1.0 per Truffle guidance):
 *
 *   d <= outsideCutoff → 0
 *   d >= insideCutoff  → 255
 *   linear in between
 *
 * Flash exposes CSM through TextField.sharpness (-400..400) and
 * TextField.thickness (-200..200):
 *   sharpness ↑ → cutoffs move toward each other (narrower transition = sharper)
 *   thickness ↑ → both cutoffs move outward/negative (thicker strokes)
 *
 * The exact Adobe constants are unpublished; TUNE holds our fitted mapping
 * (calibrated against AIR-baked PNGs by tests/tune.mjs).
 */

export const TUNE = {
  // Calibrated against AIR stem cross-sections (il_regular, sharpness 80):
  // half-width at s=80 measures ≈0.52px → base = 0.52 / (1 - 80/400) = 0.65
  baseHalfWidth: 0.70,  // transition half-width in px when sharpness = 0
  minHalfWidth: 0.02,
  thicknessScale: 0.36, // px of cutoff shift at thickness = ±200
};

export function csmParams(sharpness = 0, thickness = 0, tune = TUNE) {
  const s = Math.max(-400, Math.min(400, sharpness));
  const t = Math.max(-200, Math.min(200, thickness));
  const half = Math.max(tune.minHalfWidth, tune.baseHalfWidth * (1 - s / 400));
  const shift = (t / 200) * tune.thicknessScale; // positive = thicker
  return {
    outsideCutoff: -half - shift,
    insideCutoff: +half - shift,
  };
}

export function densityOf(d, p) {
  if (d <= p.outsideCutoff) return 0;
  if (d >= p.insideCutoff) return 255;
  return Math.round(255 * (d - p.outsideCutoff) / (p.insideCutoff - p.outsideCutoff));
}
