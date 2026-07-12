/**
 * ttf.js — Minimal TrueType parser for the Truffle replica.
 *
 * Parses exactly what the renderer needs from Habbo's Ubuntu / Volter TTFs:
 *   head, maxp, cmap (format 4/12), hhea, hmtx, loca, glyf (simple+composite),
 *   kern (format 0), OS/2.
 *
 * All coordinates returned are in FONT UNITS (unitsPerEm grid).
 * Unit conversion to Flash's 1024*20 twip em grid happens in flashfont.js —
 * keeping unit spaces explicit is a core project rule.
 */

export function parseTTF(buffer) {
  const dv = new DataView(buffer.buffer ?? buffer, buffer.byteOffset ?? 0, buffer.byteLength);
  const u8 = (o) => dv.getUint8(o);
  const u16 = (o) => dv.getUint16(o);
  const i16 = (o) => dv.getInt16(o);
  const u32 = (o) => dv.getUint32(o);

  const numTables = u16(4);
  const tables = {};
  for (let i = 0; i < numTables; i++) {
    const off = 12 + i * 16;
    const tag = String.fromCharCode(u8(off), u8(off + 1), u8(off + 2), u8(off + 3));
    tables[tag] = { offset: u32(off + 8), length: u32(off + 12) };
  }
  const need = (t) => {
    if (!tables[t]) throw new Error(`missing table ${t}`);
    return tables[t].offset;
  };

  // ---- head ----
  const headOff = need('head');
  const unitsPerEm = u16(headOff + 18);
  const indexToLocFormat = i16(headOff + 50);

  // ---- maxp ----
  const numGlyphs = u16(need('maxp') + 4);

  // ---- hhea ----
  const hheaOff = need('hhea');
  const hheaAscent = i16(hheaOff + 4);
  const hheaDescent = i16(hheaOff + 6);
  const hheaLineGap = i16(hheaOff + 8);
  const numberOfHMetrics = u16(hheaOff + 34);

  // ---- OS/2 ----
  let os2 = null;
  if (tables['OS/2']) {
    const o = tables['OS/2'].offset;
    os2 = {
      sTypoAscender: i16(o + 68),
      sTypoDescender: i16(o + 70),
      sTypoLineGap: i16(o + 72),
      usWinAscent: u16(o + 74),
      usWinDescent: u16(o + 76),
    };
  }

  // ---- hmtx ----
  const hmtxOff = need('hmtx');
  const advances = new Uint16Array(numGlyphs);
  const lsbs = new Int16Array(numGlyphs);
  {
    let last = 0;
    for (let g = 0; g < numGlyphs; g++) {
      if (g < numberOfHMetrics) {
        last = u16(hmtxOff + g * 4);
        advances[g] = last;
        lsbs[g] = i16(hmtxOff + g * 4 + 2);
      } else {
        advances[g] = last;
        lsbs[g] = i16(hmtxOff + numberOfHMetrics * 4 + (g - numberOfHMetrics) * 2);
      }
    }
  }

  // ---- cmap ----
  const cmap = new Map();
  {
    const co = need('cmap');
    const n = u16(co + 2);
    let best = -1, bestScore = -1;
    for (let i = 0; i < n; i++) {
      const pid = u16(co + 4 + i * 8);
      const eid = u16(co + 6 + i * 8);
      const off = u32(co + 8 + i * 8);
      // prefer windows unicode
      const score = pid === 3 && eid === 10 ? 5 : pid === 3 && eid === 1 ? 4 : pid === 0 ? 3 : 1;
      if (score > bestScore) { bestScore = score; best = co + off; }
    }
    const fmt = u16(best);
    if (fmt === 4) {
      const segCountX2 = u16(best + 6);
      const segCount = segCountX2 / 2;
      const endO = best + 14, startO = endO + segCountX2 + 2, deltaO = startO + segCountX2, rangeO = deltaO + segCountX2;
      for (let s = 0; s < segCount; s++) {
        const end = u16(endO + s * 2), start = u16(startO + s * 2);
        const delta = i16(deltaO + s * 2), rangeOff = u16(rangeO + s * 2);
        for (let c = start; c <= end && c !== 0xFFFF; c++) {
          let g;
          if (rangeOff === 0) g = (c + delta) & 0xFFFF;
          else {
            const gi = rangeO + s * 2 + rangeOff + (c - start) * 2;
            g = u16(gi);
            if (g !== 0) g = (g + delta) & 0xFFFF;
          }
          if (g) cmap.set(c, g);
        }
      }
    } else if (fmt === 12) {
      const nGroups = u32(best + 12);
      for (let gI = 0; gI < nGroups; gI++) {
        const o = best + 16 + gI * 12;
        const sc = u32(o), ec = u32(o + 4), sg = u32(o + 8);
        for (let c = sc; c <= ec; c++) cmap.set(c, sg + (c - sc));
      }
    } else {
      throw new Error(`unsupported cmap format ${fmt}`);
    }
  }

  // ---- loca ----
  const locaOff = need('loca');
  const loca = new Uint32Array(numGlyphs + 1);
  for (let g = 0; g <= numGlyphs; g++) {
    loca[g] = indexToLocFormat === 0 ? u16(locaOff + g * 2) * 2 : u32(locaOff + g * 4);
  }

  // ---- kern (format 0 horizontal) ----
  const kern = new Map(); // key = left<<16|right -> value in font units
  if (tables['kern']) {
    const ko = tables['kern'].offset;
    const version = u16(ko);
    let nTables, p;
    if (version === 0) { nTables = u16(ko + 2); p = ko + 4; }
    else { nTables = u32(ko + 4); p = ko + 8; } // Apple version 1.0
    for (let t = 0; t < nTables; t++) {
      let length, coverage, fmt, dataOff;
      if (version === 0) {
        length = u16(p + 2); coverage = u16(p + 4); fmt = coverage >> 8; dataOff = p + 6;
        const horizontal = (coverage & 1) === 1;
        if (fmt === 0 && horizontal) readKern0(dataOff);
      } else {
        length = u32(p); coverage = u16(p + 4); fmt = coverage & 0xFF; dataOff = p + 8;
        if (fmt === 0) readKern0(dataOff);
      }
      p += length;
    }
    function readKern0(o) {
      const nPairs = u16(o);
      for (let i = 0; i < nPairs; i++) {
        const po = o + 8 + i * 6;
        kern.set((u16(po) << 16) | u16(po + 2), i16(po + 4));
      }
    }
  }

  // ---- glyf ----
  const glyfOff = need('glyf');
  const glyphCache = new Map();

  function parseGlyph(gid, depth = 0) {
    if (glyphCache.has(gid)) return glyphCache.get(gid);
    const start = glyfOff + loca[gid], end = glyfOff + loca[gid + 1];
    let glyph;
    if (start >= end) {
      glyph = { contours: [], xMin: 0, yMin: 0, xMax: 0, yMax: 0 };
    } else {
      const nc = i16(start);
      const xMin = i16(start + 2), yMin = i16(start + 4), xMax = i16(start + 6), yMax = i16(start + 8);
      if (nc >= 0) {
        glyph = { contours: parseSimple(start, nc), xMin, yMin, xMax, yMax };
      } else {
        glyph = { contours: parseComposite(start + 10, depth), xMin, yMin, xMax, yMax };
      }
    }
    glyphCache.set(gid, glyph);
    return glyph;
  }

  function parseSimple(start, numContours) {
    let p = start + 10;
    const endPts = [];
    for (let i = 0; i < numContours; i++) { endPts.push(u16(p)); p += 2; }
    const nPts = numContours ? endPts[numContours - 1] + 1 : 0;
    const insLen = u16(p); p += 2 + insLen;
    const flags = new Uint8Array(nPts);
    for (let i = 0; i < nPts;) {
      const f = u8(p++); flags[i++] = f;
      if (f & 8) { let r = u8(p++); while (r-- > 0 && i < nPts) flags[i++] = f; }
    }
    const xs = new Int16Array(nPts), ys = new Int16Array(nPts);
    let x = 0;
    for (let i = 0; i < nPts; i++) {
      const f = flags[i];
      if (f & 2) { const d = u8(p++); x += (f & 16) ? d : -d; }
      else if (!(f & 16)) { x += i16(p); p += 2; }
      xs[i] = x;
    }
    let y = 0;
    for (let i = 0; i < nPts; i++) {
      const f = flags[i];
      if (f & 4) { const d = u8(p++); y += (f & 32) ? d : -d; }
      else if (!(f & 32)) { y += i16(p); p += 2; }
      ys[i] = y;
    }
    // build contours: arrays of {x, y, onCurve}
    const contours = [];
    let s = 0;
    for (let c = 0; c < numContours; c++) {
      const e = endPts[c];
      const pts = [];
      for (let i = s; i <= e; i++) pts.push({ x: xs[i], y: ys[i], on: (flags[i] & 1) === 1 });
      if (pts.length) contours.push(pts);
      s = e + 1;
    }
    return contours;
  }

  function parseComposite(p, depth) {
    if (depth > 5) return [];
    const contours = [];
    for (;;) {
      const flags = u16(p), gi = u16(p + 2); p += 4;
      let dx, dy;
      if (flags & 1) { dx = i16(p); dy = i16(p + 2); p += 4; }
      else { dx = (u8(p) << 24 >> 24); dy = (u8(p + 1) << 24 >> 24); p += 2; }
      let a = 1, b = 0, c = 0, d = 1;
      if (flags & 8) { a = d = f2dot14(p); p += 2; }
      else if (flags & 0x40) { a = f2dot14(p); d = f2dot14(p + 2); p += 4; }
      else if (flags & 0x80) { a = f2dot14(p); b = f2dot14(p + 2); c = f2dot14(p + 4); d = f2dot14(p + 6); p += 8; }
      const sub = parseGlyph(gi, depth + 1);
      for (const ct of sub.contours) {
        contours.push(ct.map(pt => ({ x: a * pt.x + c * pt.y + dx, y: b * pt.x + d * pt.y + dy, on: pt.on })));
      }
      if (!(flags & 0x20)) break;
    }
    return contours;
    function f2dot14(o) { return i16(o) / 16384; }
  }

  return {
    unitsPerEm,
    numGlyphs,
    hhea: { ascent: hheaAscent, descent: hheaDescent, lineGap: hheaLineGap },
    os2,
    glyphIndex: (codePoint) => cmap.get(codePoint) ?? 0,
    advanceOf: (gid) => advances[gid],
    lsbOf: (gid) => lsbs[gid],
    kernOf: (leftGid, rightGid) => kern.get((leftGid << 16) | rightGid) ?? 0,
    kernPairCount: kern.size,
    glyph: (gid) => parseGlyph(gid),
  };
}
