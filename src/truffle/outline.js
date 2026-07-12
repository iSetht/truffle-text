/**
 * outline.js — TrueType quadratic outlines → flattened polygons.
 * Input contours: [{x,y,on}] (implied on-curve midpoints between consecutive
 * off-curve points, TrueType convention). Output: closed polylines.
 * All coordinates logical px, y-up.
 */

/** Expand TrueType point list into explicit quadratic segments. */
export function toQuadratics(contour) {
  // normalize: ensure starts with an on-curve point
  const pts = contour.slice();
  if (!pts.length) return [];
  if (!pts[0].on) {
    const last = pts[pts.length - 1];
    if (last.on) pts.unshift(pts.pop());
    else pts.unshift({ x: (pts[0].x + last.x) / 2, y: (pts[0].y + last.y) / 2, on: true });
  }
  const segs = []; // {p0, c?, p1}
  let prev = pts[0];
  for (let i = 1; i <= pts.length; i++) {
    const cur = pts[i % pts.length];
    if (cur.on) {
      segs.push({ p0: prev, p1: cur });
      prev = cur;
    } else {
      const next = pts[(i + 1) % pts.length];
      const end = next.on ? next : { x: (cur.x + next.x) / 2, y: (cur.y + next.y) / 2, on: true };
      segs.push({ p0: prev, c: cur, p1: end });
      prev = end;
      if (next.on) i++;
    }
  }
  return segs;
}

/** Flatten quadratic segments to a closed polyline with given tolerance (px). */
export function flatten(segs, tol = 0.05) {
  const poly = [];
  for (const s of segs) {
    poly.push({ x: s.p0.x, y: s.p0.y });
    if (s.c) {
      // adaptive subdivision by flatness
      const n = subdivCount(s, tol);
      for (let i = 1; i < n; i++) {
        const t = i / n;
        const mt = 1 - t;
        poly.push({
          x: mt * mt * s.p0.x + 2 * mt * t * s.c.x + t * t * s.p1.x,
          y: mt * mt * s.p0.y + 2 * mt * t * s.c.y + t * t * s.p1.y,
        });
      }
    }
  }
  return poly;
}

function subdivCount(s, tol) {
  const dx = s.p0.x - 2 * s.c.x + s.p1.x;
  const dy = s.p0.y - 2 * s.c.y + s.p1.y;
  const err = Math.hypot(dx, dy) / 4; // max deviation of chord
  if (err <= tol) return 2;
  return Math.min(32, Math.max(2, Math.ceil(Math.sqrt(err / tol) * 2)));
}

/** Bounding box of polygons. */
export function bbox(polys) {
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
  for (const poly of polys) for (const p of poly) {
    if (p.x < xMin) xMin = p.x;
    if (p.x > xMax) xMax = p.x;
    if (p.y < yMin) yMin = p.y;
    if (p.y > yMax) yMax = p.y;
  }
  return { xMin, yMin, xMax, yMax };
}
