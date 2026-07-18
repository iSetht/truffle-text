/** Generic compositor for mixed-style RichTextLayout output. */

import { GUTTER } from '../layout/textfield.js';

export class RichTextRenderer {
  render(layout, opts = {}) {
    const pad = opts.padding ?? 0;
    let extraX = 0, extraY = 0;
    for (const run of layout.resolvedRuns) {
      const etching = opts.etching !== undefined ? opts.etching : run.style.etching;
      extraX = Math.max(extraX, etching?.x ?? 0);
      extraY = Math.max(extraY, etching?.y ?? 0);
    }
    const width = Math.max(1, Math.ceil(layout.width) + pad * 2 + Math.max(0, extraX));
    const height = Math.max(1, Math.ceil(layout.height) + pad * 2 + Math.max(0, extraY));
    const premul = new Uint8ClampedArray(width * height * 4);

    // Etches are the transformed back layer; all main glyphs then compose on
    // top in document order. This is the same layer ordering as Flash labels.
    drawGlyphPass(layout, premul, width, height, pad, 'etch', opts);
    drawUnderlinePass(layout, premul, width, height, pad, 'etch', opts);
    drawGlyphPass(layout, premul, width, height, pad, 'main', opts);
    drawUnderlinePass(layout, premul, width, height, pad, 'main', opts);

    const data = new Uint8ClampedArray(premul.length);
    for (let offset = 0; offset < premul.length; offset += 4) {
      const alpha = premul[offset + 3];
      if (!alpha) continue;
      data[offset] = Math.min(255, Math.floor(premul[offset] * 256 / alpha));
      data[offset + 1] = Math.min(255, Math.floor(premul[offset + 1] * 256 / alpha));
      data[offset + 2] = Math.min(255, Math.floor(premul[offset + 2] * 256 / alpha));
      data[offset + 3] = alpha;
    }
    return { width, height, data, layout };
  }
}

function drawGlyphPass(layout, target, width, height, pad, pass, opts) {
  for (const line of layout.lines) {
    for (let index = 0; index < line.chars.length; index++) {
      const char = line.chars[index];
      const style = char.style;
      const etching = opts.etching !== undefined ? opts.etching : style.etching;
      if (pass === 'etch' && (!etching || etching.alpha <= 0)) continue;
      const dx = pass === 'etch' ? etching.x ?? 0 : 0;
      const dy = pass === 'etch' ? etching.y ?? 0 : 0;
      const color = pass === 'etch'
        ? etching.color ?? 0xFFFFFF
        : opts.color ?? style.color ?? 0;
      const alphaMultiplier = pass === 'etch' ? etching.alpha ?? 1 : 1;
      const next = line.chars[index + 1];
      const allowExteriorFringe = !next || next.engine !== char.engine ||
        char.layoutEngine._flat(next.cp).outline.empty;
      const penX = pad + GUTTER + char.penX + dx;
      const baseline = pad + line.baseline + dy;
      const { r, intX, negIntY } = char.engine.renderer._glyphRaster(
        char.cp,
        penX,
        -baseline,
        char.jump ?? 0,
        char.inkShift ?? 0,
        char.inkDy ?? 0,
        pass,
        char.layoutEngine,
        char.calibratedInkShift ?? 0,
        char.rasterKey ?? char.runKey ?? '',
        allowExteriorFringe,
      );
      if (!r.w || !r.h) continue;
      const x0 = intX + r.x0;
      const y0 = negIntY + r.y0;
      for (let y = 0; y < r.h; y++) {
        const py = y0 + y;
        if (py < 0 || py >= height) continue;
        for (let x = 0; x < r.w; x++) {
          const px = x0 + x;
          if (px < 0 || px >= width) continue;
          const rawAlpha = r.alpha[y * r.w + x];
          const alpha = pass === 'etch' && !r.finalEtchAlpha
            ? (rawAlpha * Math.max(0, Math.min(256, Math.floor(alphaMultiplier * 256 + 1e-9)))) >> 8
            : rawAlpha;
          if (alpha) blendPremultiplied(target, (py * width + px) * 4, color, alpha);
        }
      }
    }
  }
}

function drawUnderlinePass(layout, target, width, height, pad, pass, opts) {
  for (const line of layout.lines) {
    let start = 0;
    while (start < line.chars.length) {
      const first = line.chars[start];
      const style = first.style;
      let end = start + 1;
      while (end < line.chars.length && line.chars[end].engine === first.engine) end++;
      if (style.underline) {
        const etching = opts.etching !== undefined ? opts.etching : style.etching;
        if (pass === 'main' || (etching && etching.alpha > 0)) {
          const dx = pass === 'etch' ? etching.x ?? 0 : 0;
          const dy = pass === 'etch' ? etching.y ?? 0 : 0;
          const color = pass === 'etch'
            ? etching.color ?? 0xFFFFFF
            : opts.color ?? style.color ?? 0;
          const alphaMultiplier = pass === 'etch' ? etching.alpha ?? 1 : 1;
          const last = line.chars[end - 1];
          const x0 = pad + GUTTER + first.penX + dx;
          const x1 = pad + GUTTER + last.penX + last.advance + dx;
          const py = Math.round(pad + line.baseline + dy) +
            (style.underlineOffset ?? 0) + (style.underlineGap ?? 0);
          drawQuarterLine(target, width, height, x0, x1, py, color, alphaMultiplier);
        }
      }
      start = end;
    }
  }
}

function drawQuarterLine(target, width, height, start, end, y, color, alphaMultiplier) {
  if (y < 0 || y >= height || end <= start) return;
  const wholeEnd = Math.floor(end + 1e-9);
  const fractional = end - wholeEnd;
  const first = Math.max(0, Math.floor(start + 1e-9));
  const last = Math.min(width, Math.ceil(end));
  const alpha256 = Math.max(0, Math.min(256, Math.floor(alphaMultiplier * 256 + 1e-9)));
  for (let x = first; x < last; x++) {
    const quarters = fractional > 1e-9 && x === wholeEnd
      ? Math.max(0, Math.min(4, Math.floor(fractional * 4 + 0.5 + 1e-9)))
      : 4;
    if (!quarters) continue;
    const raw = Math.floor(quarters * 255 / 4);
    const alpha = (raw * alpha256) >> 8;
    if (alpha) blendPremultiplied(target, (y * width + x) * 4, color, alpha);
  }
}

function blendPremultiplied(data, offset, color, sourceAlpha) {
  const red = (color >> 16) & 0xFF;
  const green = (color >> 8) & 0xFF;
  const blue = color & 0xFF;
  const inverse = 256 - sourceAlpha;
  data[offset] = Math.min(255, Math.floor(red * sourceAlpha / 255) + ((data[offset] * inverse) >> 8));
  data[offset + 1] = Math.min(255, Math.floor(green * sourceAlpha / 255) + ((data[offset + 1] * inverse) >> 8));
  data[offset + 2] = Math.min(255, Math.floor(blue * sourceAlpha / 255) + ((data[offset + 2] * inverse) >> 8));
  data[offset + 3] = Math.min(255, sourceAlpha + ((data[offset + 3] * inverse) >> 8));
}
