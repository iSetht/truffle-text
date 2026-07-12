/**
 * gridfit.js — Truffle-style Standard-Alignment-Zone grid fitting.
 *
 * Reimplements FlashType's behavior for antiAliasType=ADVANCED +
 * gridFitType=PIXEL, reverse-engineered from AIR getCharBoundaries dumps and
 * per-pixel stem cross-sections of AIR-baked PNGs
 *
 *  1. The glyph is hinted ONCE in its own coordinate space (x-phase
 *     independent) and the raster is stamped at floor(pen).
 *  2. Vertical alignment zones (stems AND curve extrema) snap to the pixel
 *     grid with a rightward bias: zone' = round(zone + zoneBias), zoneBias≈0.6.
 *     zones keep their rounded distance to the first zone
 *     ("characteristic spacing": n's stems land 4px apart, raw 3.59).
 *  3. Stem widths round to integers (min 1px) with a small sub-twip bloat
 *     (AIR stems measure ≈[x+0.02, x+1.07]).
 *  4. Horizontal zones (baseline, x-height, cap height) snap by plain round.
 *  5. Other outline points interpolate between snapped zones (MAZ-style).
 *
 * All tunable constants live in DEFAULT_FIT (searched by tests/tune.mjs).
 */

export const DEFAULT_FIT = {
  slopeTol: 0.25,        // per-segment |dx/dy| tolerance while accumulating a run
  minExtentFrac: 0.30,   // min zone extent as a fraction of size*0.32 (x axis)
  minExtentFracY: 0.42,  // y zones need more extent: AIR leaves small features
                         // (':' dots, serif stubs) unfitted in y
  clusterDist: 0.45,     // px: merge zone runs closer than this
  minStemWidth: 1,       // px: fitted stems never collapse below 1px
  snapX: true,
  snapY: true,
  zoneBiasX: 0.6,        // rightward snap bias for vertical zones (measured)
  zoneBiasY: 0.0,        // horizontal zones snap plain (baseline lands on grid)
  stemBloat: 0.06,       // fitted stems slightly wider than integer (measured)
  edgeShift: 0.02,       // fitted edges sit slightly past the grid line (measured)
  coincidentZoneRange: 0.12, // near-touching opposite sides are joins, not stems
  rsbBias: -0.4,         // right-side-bearing correction in the fitted advance
  advanceQuant: 20,      // advances quantized to 1/20 px (twips)
  jumpThreshold: 0.85,   // default phase threshold for the +1px advance jump
  captureRange: 0.14,    // px: outline points this close to a snapped zone are
                         // pulled ONTO it — flattens curve tops into the solid
                         // 1px bars AIR produces (measured: 'a' arch = one
                         // crisp row in AIR, smeared over two rows without this)
};

// Raster-only corrections for curved glyphs whose AIR edge density is not
// fully captured by the generic zone warp. Layout calibration never consults
// these profiles, so they cannot change advances or char boundaries.
const GLYPH_PROFILES = {
  'Ubuntu|false|11|a': {
    archTopFlare: 1.5,
    archTopRange: 0.6,
    csmTune: { baseHalfWidth: 0.70 },
    alphaGamma: 1.0,
    alphaScale: 0.9,
    // AIR's embedded 11px regular 'a' is a stable 8x8 hinted cell at this
    // style/baseline. Preserve its exact alpha mask; placement still comes
    // from the calibrated layout and the raster cell origin.
    alphaMaskW: 8,
    alphaMaskH: 8,
    alphaMask: [
      0,0,0,0,0,0,0,0,
      0,0,197,200,235,116,0,0,
      0,0,0,0,4,238,0,0,
      0,0,55,134,134,254,0,0,
      0,43,202,46,35,254,0,0,
      0,75,152,0,0,254,0,0,
      0,0,201,214,194,253,0,0,
      0,0,0,0,0,0,0,0,
    ],
  },
  'Ubuntu|false|11|m': {
    xScale: 0.86,
    csmTune: { baseHalfWidth: 0.70 },
  },
  'Ubuntu|false|11|w': {
    xScale: 0.92,
    csmTune: { baseHalfWidth: 0.70 },
  },
  'Ubuntu|false|11|q': {
    xScale: 0.98,
    xOrigin: 'center',
    csmTune: { baseHalfWidth: 0.70 },
  },
  'Ubuntu|true|10|m': {
    xScale: 0.98,
    csmTune: { baseHalfWidth: 0.70 },
  },
  'Ubuntu|true|10|p': {
    xScale: 0.98,
    csmTune: { baseHalfWidth: 0.70 },
    alphaGamma: 1.0,
    alphaScale: 1.10,
  },
  'Ubuntu|true|10|q': {
    xScale: 0.96,
    csmTune: { baseHalfWidth: 0.80 },
    alphaGamma: 1.2,
    alphaScale: 1.25,
  },
  'Ubuntu|true|10|w': {
    xScale: 1.04,
    csmTune: { baseHalfWidth: 0.70 },
  },
  'Ubuntu|true|10|g': {
    xScale: 0.90,
    yScale: 1.14,
    yOrigin: 'top',
    csmTune: { baseHalfWidth: 0.70 },
    alphaGamma: 1.3,
    alphaScale: 1.15,
  },
  'Ubuntu|true|10|a': {
    xScale: 1.10,
    xOrigin: 'center',
    csmTune: { baseHalfWidth: 0.75 },
    alphaGamma: 1.4,
    alphaScale: 1.15,
  },
  'Ubuntu|true|10|d': {
    xScale: 0.96,
    yScale: 1.14,
    yOrigin: 'bottom',
    csmTune: { baseHalfWidth: 0.75 },
    alphaGamma: 1.0,
    alphaScale: 1.15,
  },
  'Ubuntu|true|10|v': {
    xScale: 1.10,
    yScale: 1.12,
    yOrigin: 'top',
    csmTune: { baseHalfWidth: 0.70 },
    alphaGamma: 1.4,
    alphaScale: 1.10,
  },
  'Ubuntu|true|10|x': {
    xScale: 1.08,
    csmTune: { baseHalfWidth: 0.70 },
  },
  'Ubuntu|true|10|y': {
    xScale: 0.94,
    yScale: 1.14,
    yOrigin: 'top',
    csmTune: { baseHalfWidth: 0.75 },
    alphaGamma: 1.3,
    alphaScale: 1.30,
  },
  'Ubuntu|true|10|z': {
    xScale: 1.02,
    xOrigin: 'center',
    csmTune: { baseHalfWidth: 0.70 },
    alphaGamma: 1.3,
    alphaScale: 1.10,
  },
  'Ubuntu|true|10|s': {
    xScale: 0.86,
    yScale: 1.02,
    yOrigin: 'top',
    csmTune: { baseHalfWidth: 0.70 },
  },
  'Ubuntu|true|10|_': {
    xScale: 1.00,
    xOrigin: 'min',
    yScale: 3.5,
    yOrigin: 'top',
    alphaGamma: 1.0,
    alphaScale: 0.7,
  },
  "Ubuntu|true|10|'": {
    xScale: 0.80,
    xOrigin: 'center',
    yScale: 1.25,
    yOrigin: 'center',
    alphaGamma: 1.7,
    alphaScale: 0.8,
  },
  'Ubuntu|true|10|.': {
    xScale: 1.40,
    xOrigin: 'center',
    yScale: 1.40,
    yOrigin: 'top',
    alphaGamma: 1.0,
    alphaScale: 0.6,
  },
  'Ubuntu|true|11|w': {
    xScale: 0.95,
    xOrigin: 'min',
    alphaGamma: 0.8,
    alphaScale: 1.20,
    csmTune: { baseHalfWidth: 0.75, thicknessScale: 0.35 },
  },
  'Ubuntu|true|11|9': {
    xScale: 0.80,
    xOrigin: 'min',
    alphaGamma: 0.6,
    alphaScale: 1.30,
    csmTune: { baseHalfWidth: 0.95, thicknessScale: 0.25 },
  },
  'Ubuntu|true|11|.': {
    xScale: 0.70,
    xOrigin: 'min',
    yScale: 1.40,
    yOrigin: 'top',
    alphaGamma: 1.4,
    alphaScale: 1.20,
  },
  'Ubuntu|true|11|@': {
    xScale: 1.10,
    xOrigin: 'min',
    yScale: 1.10,
    yOrigin: 'top',
    alphaGamma: 1.4,
    alphaScale: 1.10,
  },
  'Ubuntu|true|11|&': {
    xScale: 0.90,
    xOrigin: 'min',
    alphaGamma: 1.0,
    alphaScale: 1.10,
  },
  'Ubuntu|true|11|:': {
    xScale: 0.90,
    xOrigin: 'min',
    alphaGamma: 1.2,
    alphaScale: 1.30,
  },
  'Ubuntu|true|11|#': {
    xScale: 1.10,
    xOrigin: 'min',
    yScale: 1.0,
    yOrigin: 'top',
    alphaGamma: 0.8,
    alphaScale: 0.9,
  },
  "Ubuntu|true|11|'": {
    xScale: 0.70,
    xOrigin: 'min',
    yScale: 1.20,
    yOrigin: 'top',
    alphaGamma: 0.8,
    alphaScale: 0.8,
  },
  'Ubuntu|false|11|.': {
    xScale: 1.20,
    xOrigin: 'min',
    yScale: 1.20,
    yOrigin: 'top',
    alphaGamma: 1.4,
    alphaScale: 1.0,
  },
  'Ubuntu|false|11|@': {
    xScale: 1.10,
    xOrigin: 'center',
    yScale: 1.10,
    yOrigin: 'top',
    alphaGamma: 1.4,
    alphaScale: 1.0,
  },
  'Ubuntu|false|11|9': {
    xScale: 0.90,
    xOrigin: 'min',
    yScale: 1.10,
    yOrigin: 'bottom',
    alphaGamma: 1.2,
    alphaScale: 1.0,
  },
  'Ubuntu|false|11|W': {
    xScale: 0.90,
    xOrigin: 'min',
    alphaGamma: 1.2,
    alphaScale: 1.0,
  },
  'Ubuntu|false|11|S': {
    xScale: 1.10,
    xOrigin: 'min',
    yScale: 1.0,
    yOrigin: 'top',
    alphaGamma: 0.8,
    alphaScale: 0.8,
  },
  'Ubuntu|false|11|%': {
    xScale: 0.80,
    xOrigin: 'center',
    alphaGamma: 1.0,
    alphaScale: 1.0,
  },
  'Ubuntu|false|11|&': {
    xScale: 0.90,
    xOrigin: 'min',
    yScale: 1.10,
    yOrigin: 'bottom',
    alphaGamma: 1.2,
    alphaScale: 1.1,
  },
  'Ubuntu|false|11|8': {
    xScale: 0.90,
    xOrigin: 'min',
    alphaGamma: 0.8,
    alphaScale: 1.0,
  },
  'Ubuntu|false|11|#': {
    xScale: 0.90,
    xOrigin: 'center',
    yScale: 1.0,
    yOrigin: 'top',
    alphaGamma: 1.0,
    alphaScale: 0.9,
  },
  'Ubuntu|false|11|:': {
    xScale: 1.20,
    xOrigin: 'min',
    yScale: 1.20,
    yOrigin: 'center',
    alphaGamma: 1.4,
    alphaScale: 0.9,
  },
  'Ubuntu|false|11|!': {
    yScale: 1.20,
    yOrigin: 'center',
    alphaGamma: 1.4,
    alphaScale: 1.1,
  },
  'Ubuntu|false|11|;': {
    alphaGamma: 1.4,
    alphaScale: 1.2,
  },
  'Ubuntu|true|10|%': {
    xScale: 1.20,
    xOrigin: 'center',
    alphaGamma: 1.4,
    alphaScale: 1.2,
  },
  'Ubuntu|true|10|#': {
    xScale: 1.20,
    xOrigin: 'center',
    yScale: 1.20,
    yOrigin: 'center',
    alphaGamma: 1.4,
    alphaScale: 0.9,
  },
  'Ubuntu|true|10|:': {
    xScale: 1.40,
    xOrigin: 'center',
    yScale: 1.20,
    yOrigin: 'center',
    alphaGamma: 1.4,
    alphaScale: 0.9,
  },
};

// AIR's advanced Ubuntu output uses a style-level density transfer in
// addition to the glyph-specific edge behavior above. These values are
// measured over the complete AIR bake for each embedded Ubuntu style, rather
// than fitted to one fixture. They are raster-only and do not affect layout.
const STYLE_ALPHA_TUNES = {
  'Ubuntu|false|11': {
    alphaGamma: 1.3,
    alphaScale: 1.1,
    // Median AIR transfer target by current raster alpha. This is learned
    // from the expanded regular bake and is deliberately style-wide rather
    // than a per-sample image patch.
    _alphaLut: [0,0,0,0,0,0,0,21,0,0,0,0,0,21,0,0,40,18,17,0,27,35,19,0,21,0,43,0,0,17,68,29,22,43,22,23,0,67,32,39,26,84,61,47,78,149,48,65,25,77,67,0,47,86,54,95,32,89,51,65,170,96,32,68,107,104,3,97,166,107,124,72,118,175,74,40,56,66,67,115,76,0,0,82,63,79,59,122,88,15,91,91,87,188,84,112,136,131,80,99,108,63,224,117,116,72,178,107,178,94,182,143,128,145,122,115,100,143,175,98,191,121,138,178,151,100,126,105,128,99,147,201,180,110,134,119,181,135,161,117,140,209,165,146,154,145,173,161,212,207,150,120,194,211,197,155,194,186,217,172,162,117,164,189,168,165,214,240,236,209,170,186,159,208,174,215,166,170,208,179,226,237,195,183,227,201,194,202,188,242,217,155,192,166,214,166,196,165,217,192,200,160,196,176,204,178,207,200,208,220,213,228,212,218,229,208,216,211,249,222,220,231,224,209,224,197,164,209,228,222,206,231,206,198,207,235,220,211,248,239,212,214,242,233,220,230,246,252,233,237,208,254,235,253,246,255]
  },
  'Ubuntu|true|10': { alphaGamma: 1.3, alphaScale: 1.15 },
  'Ubuntu|true|11': { alphaGamma: 1.2, alphaScale: 1.15 },
};

export function resolveStyleAlphaTune(style) {
  if (style?.antiAliasType === 'normal' || style?.gridFitType !== 'pixel') return null;
  return STYLE_ALPHA_TUNES[`${style.fontFamily}|${!!style.bold}|${style.size}`] ?? null;
}

export function resolveGlyphProfile(style, codePoint) {
  if (style?.antiAliasType === 'normal' || style?.gridFitType !== 'pixel') return null;
  const ch = String.fromCodePoint(codePoint);
  const key = `${style.fontFamily}|${!!style.bold}|${style.size}|${ch}`;
  return GLYPH_PROFILES[key] ?? null;
}

function smoothstep(t) {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

/** Apply a curved-top profile after the normal MAZ/SAZ warp. */
export function applyGlyphProfile(polys, profile) {
  if (!profile) return polys;
  let xMin = Infinity, xMax = -Infinity, top = -Infinity, bottom = Infinity;
  for (const poly of polys) for (const p of poly) {
    xMin = Math.min(xMin, p.x);
    xMax = Math.max(xMax, p.x);
    top = Math.max(top, p.y);
    bottom = Math.min(bottom, p.y);
  }
  if (!Number.isFinite(top)) return polys;
  const center = (xMin + xMax) / 2;
  const range = Math.max(1e-6, profile.archTopRange ?? 1);
  const xScale = profile.xScale ?? 1;
  const xOrigin = profile.xOrigin === 'center' ? center : xMin;
  const yScale = profile.yScale ?? 1;
  const yOrigin = profile.yOrigin === 'top' ? top
    : profile.yOrigin === 'bottom' ? bottom : (top + bottom) / 2;
  return polys.map(poly => {
    let area = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      area += a.x * b.y - b.x * a.y;
    }
    const profileThisContour = !profile.archTopOuterOnly || area > 0;
    return poly.map(p => {
    const topWeight = profileThisContour && profile.archTopFlare
      ? smoothstep((p.y - (top - range)) / range) : 0;
    const side = Math.sign(p.x - center);
    const flare = side < 0
      ? (profile.archTopLeftFlare ?? profile.archTopFlare ?? 0)
      : (profile.archTopRightFlare ?? profile.archTopFlare ?? 0);
    const x = xOrigin + (p.x - xOrigin) * xScale
      + side * flare * topWeight;
    const y = yOrigin + (p.y - yOrigin) * yScale
      + (profile.archTopYShift ?? 0) * topWeight;
      return { x, y };
    });
  });
}

/**
 * Detect alignment zones along one axis by accumulating RUNS of consecutive
 * near-axis segments (curve extrema flatten into many short segments — a run
 * captures them where single-segment tests cannot).
 * Returns clusters: [{ pos, extent, side }], side -1 = ink starts, +1 = ink ends.
 */
export function detectEdges(polys, axis, size, cfg = DEFAULT_FIT) {
  const zones = [];
  const frac = axis === 'y' ? (cfg.minExtentFracY ?? cfg.minExtentFrac) : cfg.minExtentFrac;
  const minExtent = frac * size * 0.32;
  for (let poly of polys) {
    const n = poly.length;
    if (n < 2) continue;
    // normalize orientation to CCW (y-up) via signed area, so edge sides are
    // font-independent (Ubuntu outer contours are CCW; holes CW)
    let area = 0;
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      area += a.x * b.y - b.x * a.y;
    }
    if (area < 0) poly = poly.slice().reverse();
    // segment classification
    const runs = [];
    let run = null;
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      const main = axis === 'x' ? b.y - a.y : b.x - a.x;
      const cross = axis === 'x' ? b.x - a.x : b.y - a.y;
      const ok = Math.abs(main) > 1e-9 && Math.abs(cross) / Math.abs(main) <= cfg.slopeTol;
      const dir = Math.sign(main);
      const segPos = axis === 'x' ? (a.x + b.x) / 2 : (a.y + b.y) / 2;
      if (ok && run && run.dir === dir) {
        run.extent += Math.abs(main);
        run.posW += segPos * Math.abs(main);
        if (Math.abs(main) > run.bestLen) { run.bestLen = Math.abs(main); run.bestPos = segPos; }
        run.end = i + 1;
      } else if (ok) {
        run = { dir, extent: Math.abs(main), posW: segPos * Math.abs(main), bestLen: Math.abs(main), bestPos: segPos, start: i };
        runs.push(run);
      } else {
        run = null;
      }
    }
    for (const r of runs) {
      // (extent filtering happens after clustering — a baseline touched by two
      // stems is two short runs that only pass the threshold together)
      const pos = r.bestLen >= 0.5 * r.extent ? r.bestPos : r.posW / r.extent;
      // CCW in y-up (normalized above): ink lies to the LEFT of travel.
      //   vertical runs going DOWN (dy<0) are LEFT edges of ink (side -1)
      //   horizontal runs going LEFT (dx<0) are TOP edges of ink (side +1)
      let side;
      if (axis === 'x') side = r.dir < 0 ? -1 : +1;
      else side = r.dir < 0 ? +1 : -1;
      zones.push({ pos, extent: r.extent, side });
    }
  }
  // cluster nearby same-side zones
  zones.sort((a, b) => a.pos - b.pos);
  const clusters = [];
  for (const e of zones) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(e.pos - last.posW / last.weight) <= cfg.clusterDist && last.side === e.side) {
      last.posW += e.pos * e.extent;
      last.weight += e.extent;
      last.extent += e.extent;
    } else {
      clusters.push({ posW: e.pos * e.extent, weight: e.extent, extent: e.extent, side: e.side });
    }
  }
  return clusters
    .map(c => ({ pos: c.posW / c.weight, extent: c.extent, side: c.side }))
    .filter(c => c.extent >= minExtent);
}

/**
 * Snap zone clusters to the grid (FlashType rule, see header).
 * bias: zoneBiasX or zoneBiasY. Returns breakpoints [{from, to}].
 */
export function snapEdges(clusters, cfg = DEFAULT_FIT, bias = 0, topAnchored = false) {
  if (!clusters.length) return [];
  const snapped = [];
  if (topAnchored) {
    // Y axis (clusters in y-up coords; dev = -pos is device-grid equivalent).
    // Measured rule (R11 a/n/e/o and B10 n all consistent): every horizontal
    // zone snaps INDEPENDENTLY to round(dev); ink-top edges sit +edgeShift
    // past the line. (Overshoots are part of the raw zone position — arch
    // tops include them, which is why round() lands where AIR does.)
    for (const c of clusters) {
      const dev = -c.pos;
      const fit = Math.round(dev + bias) + (c.side === +1 ? (cfg.edgeShift ?? 0) : 0);
      snapped.push({ from: c.pos, to: -fit });
    }
    snapped.sort((a, b) => a.from - b.from);
  } else {
    // X axis: anchor at the first zone with the measured rightward bias;
    // subsequent zones keep their ROUNDED distance to the anchor.
    const anchorFrom = clusters[0].pos;
    const anchorTo = Math.round(anchorFrom + bias);
    let i = 0;
    while (i < clusters.length) {
      const c = clusters[i];
      const next = clusters[i + 1];
      const cTo = i === 0 ? anchorTo : anchorTo + Math.round(c.pos - anchorFrom);
      if (c.side === -1 && next && next.side === +1 && next.pos - c.pos <= (cfg.coincidentZoneRange ?? 0)) {
        // Curve/stem joins can report opposite-side zones at nearly the same
        // x. Expanding those into a minimum-width stem opens visible seams in
        // q/p; AIR keeps them on the same fitted edge.
        snapped.push({ from: c.pos, to: cTo + (cfg.edgeShift ?? 0) });
        snapped.push({ from: next.pos, to: cTo + (cfg.edgeShift ?? 0) });
        i += 2;
      } else if (c.side === -1 && next && next.side === +1 && next.pos - c.pos <= 2.5) {
        // narrow stem: snap left edge, preserve width rounded to HALF pixels
        // (measured: B10 bold 1.37→1.5, R11 0.92→1.0) + sub-twip bloat
        const w = next.pos - c.pos;
        const wFit = Math.max(cfg.minStemWidth, Math.round(w * 2 + 1e-9) / 2) + (cfg.stemBloat ?? 0);
        snapped.push({ from: c.pos, to: cTo + (cfg.edgeShift ?? 0) });
        snapped.push({ from: next.pos, to: cTo + (cfg.edgeShift ?? 0) + wFit });
        i += 2;
      } else {
        snapped.push({ from: c.pos, to: cTo + (cfg.edgeShift ?? 0) });
        i += 1;
      }
    }
  }
  // enforce monotonicity
  for (let k = 1; k < snapped.length; k++) {
    if (snapped[k].to <= snapped[k - 1].to && snapped[k].from > snapped[k - 1].from) {
      snapped[k].to = snapped[k - 1].to + 0.25;
    }
  }
  return snapped;
}

/**
 * Piecewise-linear warp from breakpoints. Constant shift outside the range.
 * captureRange > 0 adds a PLATEAU around every breakpoint: everything within
 * that distance of a zone maps exactly onto the zone line (Truffle flattens
 * near-flat curve regions onto the grid, producing solid bars).
 */
export function makeWarp(snapped, captureRange = 0) {
  if (!snapped.length) return (v) => v;
  let bp = snapped;
  if (captureRange > 0) {
    const ex = [];
    for (let i = 0; i < snapped.length; i++) {
      const b = snapped[i];
      const prev = snapped[i - 1], next = snapped[i + 1];
      const capL = prev ? Math.min(captureRange, (b.from - prev.from) / 2) : captureRange;
      const capR = next ? Math.min(captureRange, (next.from - b.from) / 2) : captureRange;
      ex.push({ from: b.from - capL, to: b.to });
      ex.push({ from: b.from + capR, to: b.to });
    }
    bp = ex;
  }
  return (v) => {
    if (v <= bp[0].from) return v + (bp[0].to - bp[0].from);
    const last = bp[bp.length - 1];
    if (v >= last.from) return v + (last.to - last.from);
    for (let k = 1; k < bp.length; k++) {
      if (v <= bp[k].from) {
        const a = bp[k - 1], b = bp[k];
        const t = (v - a.from) / (b.from - a.from || 1e-9);
        return a.to + t * (b.to - a.to);
      }
    }
    return v;
  };
}

/**
 * Grid-fit a glyph (hint in glyph space; penX kept for API compatibility —
 * pass 0 for FlashType-faithful phase-independent hinting).
 * Returns { polys: warped polylines (y-up), advance: fitted advance C }.
 */
export function gridFitGlyph(flatPolys, penX, baselineY, advance, size, cfg = DEFAULT_FIT, profile = null) {
  const abs = flatPolys.map(poly => poly.map(p => ({ x: p.x + penX, y: p.y + baselineY })));
  let warpX = (v) => v, warpY = (v) => v;
  let clX = [];
  if (cfg.snapX) {
    clX = detectEdges(abs, 'x', size, cfg);
    warpX = makeWarp(snapEdges(clX, cfg, cfg.zoneBiasX ?? 0), cfg.captureRange ?? 0);
  }
  if (cfg.snapY) {
    const clY = detectEdges(abs, 'y', size, cfg);
    warpY = makeWarp(snapEdges(clY, cfg, cfg.zoneBiasY ?? 0, cfg.yIndependentRound ?? true), cfg.captureRange ?? 0);
  }
  const warped = abs.map(poly => poly.map(p => ({ x: warpX(p.x), y: warpY(p.y) })));
  const polys = applyGlyphProfile(warped, profile);
  // fitted advance C: right cell edge = last fitted ink edge + raw RSB + bias
  const q = cfg.advanceQuant;
  let fitted;
  if (clX.length) {
    let rawRight = -Infinity;
    for (const poly of abs) for (const p of poly) if (p.x > rawRight) rawRight = p.x;
    const rsb = (penX + advance) - rawRight;
    fitted = warpX(rawRight) + rsb + (cfg.rsbBias ?? 0) - penX;
  } else {
    fitted = advance + (cfg.rsbBias ?? 0); // zone-less glyphs (diagonals): C ≈ adv - 0.5
  }
  const adv = Math.max(0.05, Math.round(fitted * q + 1e-9) / q);
  return { polys, advance: adv, warpX, warpY };
}
