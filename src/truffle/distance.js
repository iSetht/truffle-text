/**
 * distance.js — Signed distance sampling of a closed polygon set.
 * Truffle's core idea: rasterize by mapping SIGNED DISTANCE → density (CSM),
 * instead of coverage. Sign: positive INSIDE ink (nonzero winding).
 * We sample the exact distance field densely (one sample per output pixel):
 * numerically identical to an ADF evaluated at the same points, without the
 * adaptive-storage optimization (which only matters for perf at large sizes).
 */

/** Distance from point to segment. */
function segDist2(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + t * dx - px, qy = ay + t * dy - py;
  return qx * qx + qy * qy;
}

/** Nonzero winding number via horizontal ray to +x. */
function windingAt(px, py, polys) {
  let w = 0;
  for (const poly of polys) {
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      if (a.y <= py) {
        if (b.y > py && (b.x - a.x) * (py - a.y) - (px - a.x) * (b.y - a.y) > 0) w++;
      } else if (b.y <= py && (b.x - a.x) * (py - a.y) - (px - a.x) * (b.y - a.y) < 0) w--;
    }
  }
  return w;
}

/**
 * Sample signed distance at (px, py). Positive inside.
 * maxDist: distances clamp here (cheap early-out bound).
 */
export function signedDistance(px, py, polys, maxDist = 3) {
  let d2 = maxDist * maxDist;
  for (const poly of polys) {
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      const d = segDist2(px, py, a.x, a.y, b.x, b.y);
      if (d < d2) d2 = d;
    }
  }
  const d = Math.sqrt(d2);
  return windingAt(px, py, polys) !== 0 ? d : -d;
}

/**
 * Coverage sampling (classic AA) for antiAliasType="normal".
 * ss × ss supersamples per pixel, returns coverage 0..1.
 */
export function coverageAt(px, py, polys, ss = 4) {
  let hits = 0;
  for (let sy = 0; sy < ss; sy++) {
    for (let sx = 0; sx < ss; sx++) {
      const x = px - 0.5 + (sx + 0.5) / ss;
      const y = py - 0.5 + (sy + 0.5) / ss;
      if (windingAt(x, y, polys) !== 0) hits++;
    }
  }
  return hits / (ss * ss);
}
