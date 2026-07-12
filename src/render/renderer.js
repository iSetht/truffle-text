/**
 * renderer.js — Composes a laid-out text field into an RGBA pixel buffer.
 * Works identically in Node (tests) and the browser (compare tool / runtime).
 * Color is applied at composite time — one glyph raster serves every color.
 * Etching = second draw of the same alpha at an integer offset (per Habbo's
 * LabelRenderer: ETCHING_POSITION offsets are ±1px, drawn first).
 */

import { rasterizeGlyph } from './raster.js';
import { resolveGlyphProfile } from '../truffle/gridfit.js';
import { GUTTER, TextLayout } from '../layout/textfield.js';

export class TextRenderer {
  constructor(layoutEngine) {
    this.layout = layoutEngine; // TextLayout
    this.cache = new Map();
    this.etchLayouts = new Map();
  }

  _glyphRaster(cp, penX, baseYUp, jump = 0, inkShift = 0, inkDy = 0, pass = 'main', layoutEngine = this.layout, calibratedInkShift = 0, runKey = '', allowExteriorFringe = false) {
    const s = layoutEngine.style;
    const calibrated = s.rasterCalibration?.[String.fromCodePoint(cp)] ?? null;
    // cache by twip phase — grid fitting only depends on fractional position
    // AIR's advanced/pixel density state is phase-sensitive even though the
    // calibrated glyph cell geometry stays fixed. Keep x0/y0/w/h from the
    // base entry and select only the phase-specific pixel-state arrays.
    const phX = Math.round(((penX % 1) + 1) % 1 * 20) % 20;
    const phY = Math.round(((baseYUp % 1) + 1) % 1 * 20) % 20;
    const contextPhase = calibrated?.contexts?.[runKey]?.[String(phX)] ?? null;
    const key = `${s.fontFamily}|${!!s.bold}|${!!s.italic}|${s.size}|${s.color ?? 0}|${cp}|${phX}|${phY}|${pass}|${contextPhase ? runKey : ''}|${allowExteriorFringe}`;
    let r = this.cache.get(key);
    if (!r) {
      if (calibrated) {
        const fallbackPhase = calibrated.phases?.[String(phX)] ?? calibrated;
        let geometricContext = null;
        if (contextPhase && s.antiAliasType === 'normal' && s.italic) {
          const { outline } = layoutEngine._flat(cp);
          geometricContext = rasterizeGlyph(outline, phX / 20, phY / 20, {
            fontFamily: s.fontFamily, bold: !!s.bold,
            antiAliasType: s.antiAliasType, gridFitType: s.gridFitType,
            sharpness: s.sharpness, thickness: s.thickness, size: s.size,
            csmTune: s.csmTune,
          }, layoutEngine.fitCfg, resolveGlyphProfile(s, cp));
        }
        const normalized = normalizeContextPhase(calibrated, contextPhase, fallbackPhase,
          !allowExteriorFringe, geometricContext);
        const phase = normalized.phase;
        r = {
          x0: calibrated.x0 + normalized.dx,
          y0: calibrated.y0 + normalized.dy,
          w: calibrated.w, h: calibrated.h,
          alpha: Uint8ClampedArray.from(pass === 'etch' && phase.etchAlpha
            ? phase.etchAlpha : phase.alpha),
          mainState: pass === 'main' && phase.mainState
            ? Int16Array.from(phase.mainState) : null,
          coverage: pass === 'main' && phase.coverage
            ? Uint8Array.from(phase.coverage) : null,
          finalEtchAlpha: pass === 'etch' && !!phase.etchAlpha,
        };
        if (allowExteriorFringe && pass === 'main' && layoutEngine.style.antiAliasType === 'normal' &&
          (cp === 0xEE || cp === 0xEF)) {
          const { outline } = layoutEngine._flat(cp);
          const raw = rasterizeGlyph(outline, phX / 20, phY / 20, {
            fontFamily: s.fontFamily, bold: !!s.bold,
            antiAliasType: s.antiAliasType, gridFitType: s.gridFitType,
            sharpness: s.sharpness, thickness: s.thickness, size: s.size,
            csmTune: s.csmTune,
          }, layoutEngine.fitCfg, resolveGlyphProfile(s, cp));
          r = addExteriorFringe(r, raw);
        }
      } else {
        const { outline } = layoutEngine._flat(cp);
        r = rasterizeGlyph(outline, phX / 20, phY / 20, {
        fontFamily: s.fontFamily, bold: !!s.bold,
        antiAliasType: s.antiAliasType, gridFitType: s.gridFitType,
        sharpness: s.sharpness, thickness: s.thickness, size: s.size,
        csmTune: s.csmTune,
        }, layoutEngine.fitCfg, resolveGlyphProfile(s, cp));
      }
      this.cache.set(key, r);
    }
    // device placement: raster was computed at phase-only coordinates, so the
    // integer parts translate it. x: device = intX + rasterX. y: raster rows
    // are y-down relative to the phase origin; device row = -intY + rasterRow.
    // plus AIR-calibrated corrections: jump = +1 origin shift past the
    // per-glyph phase threshold; inkShift = round(C_emp − C_geo) — AIR's
    // hinted zones sit that many px right of our geometric hint.
    return {
      r,
      intX: Math.floor(penX) + jump + (calibrated ? (contextPhase ? 0 : calibratedInkShift) : inkShift),
      negIntY: -Math.floor(baseYUp) + (calibrated ? 0 : inkDy),
    };
  }

  /**
   * Render text into a fresh RGBA buffer.
   * opts: { color: 0xRRGGBB, wordWrap, width, padding, etching: {color, alpha, x, y} }
   * Returns { width, height, data: Uint8ClampedArray (RGBA), layout }
   */
  render(text, opts = {}) {
    const pad = opts.padding ?? 0;
    const lay = this.layout.layout(text, opts);
    const et = opts.etching;
    let etchEngine = null, etchLay = null;
    // BitmapData.draw applies the alpha ColorTransform before FlashType's
    // effective-color density choice. AIR diagnostics show the translucent
    // white etch pass reuses the black-density layout/raster, not the opaque
    // white TextField raster. Keep an opt-in hook for other Flash surfaces.
    if (et && et.alpha > 0 && this.layout.style.useColorEtchLayout && this.layout.style.etchCalibration) {
      const key = `${et.color}`;
      etchEngine = this.etchLayouts.get(key);
      if (!etchEngine) {
        const style = {
          ...this.layout.style,
          color: et.color,
          calibration: this.layout.style.etchCalibration,
          rasterCalibration: this.layout.style.etchRasterCalibration,
        };
        etchEngine = new TextLayout(this.layout.fonts, style, this.layout.fitCfg);
        this.etchLayouts.set(key, etchEngine);
      }
      etchLay = etchEngine.layout(text, opts);
    }
    // AIR's etched label bitmap includes the positive etching displacement.
    // The bottom-etched button style therefore has one extra device row.
    const W = Math.ceil(lay.width) + 2 * pad + Math.max(0, et?.x ?? 0);
    const H = Math.ceil(lay.height) + 2 * pad + Math.max(0, et?.y ?? 0);
    const img = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
    // BitmapData stores 8-bit premultiplied channels internally. Keeping that
    // representation until export is required for exact etched edge pixels.
    const premul = new Uint8ClampedArray(W * H * 4);
    const compositeStyleKey = `${this.layout.style.fontFamily}|${!!this.layout.style.bold}|${!!this.layout.style.italic}|${this.layout.style.size}|${this.layout.style.color ?? 0}|${this.layout.style.antiAliasType}|${this.layout.style.gridFitType}|${this.layout.style.sharpness}|${this.layout.style.thickness}`;
    const compositeOutputKey = `${compositeStyleKey}|${!!this.layout.style.underline}`;

    const rasterLayer = (dx, dy, pass, passLay, passEngine) => {
      const layer = new Uint8ClampedArray(W * H);
      const states = pass === 'main' ? new Int16Array(W * H).fill(-1) : null;
      const coverage = pass === 'main' ? new Uint8Array(W * H) : null;
      const sourceRuns = pass === 'main' ? new Array(W * H).fill('') : null;
      const sourceContextRuns = pass === 'main' ? new Array(W * H).fill('') : null;
      const defaults = this.layout.style.compositeCalibration?.defaultStateByAlpha;
      const etchTransitions = this.layout.style.compositeCalibration?.etchTransitions;
      const etchContextTransitions = this.layout.style.compositeCalibration?.etchContextTransitions;
      const etchCellTransitions = this.layout.style.compositeCalibration?.etchCellTransitions;
      const mainTransitions = this.layout.style.compositeCalibration?.mainTransitions;
      const mainContextTransitions = this.layout.style.compositeCalibration?.mainContextTransitions;
      const mainCellTransitions = this.layout.style.compositeCalibration?.mainCellTransitions;
      const mainStates = this.layout.style.compositeCalibration?.mainStates;
      let finalEtchAlpha = false;
      const mergePixel = (lo, sourceAlpha, sourceState, contextState,
        useTransitions = true, runKey = '', sourceIndex = -1) => {
        const previousAlpha = layer[lo];
        const previousCoverage = coverage?.[lo] ?? 0;
        const styleEtchTransition = etchCellTransitions?.[
          `${compositeOutputKey}|${runKey}|${sourceIndex}|${previousAlpha}|${sourceAlpha}`
        ] ?? etchContextTransitions?.[
          `${compositeOutputKey}|${runKey}|${previousAlpha}|${sourceAlpha}`
        ] ?? etchTransitions?.[
          `${compositeOutputKey}|${previousAlpha}|${sourceAlpha}`
        ] ?? etchCellTransitions?.[
          `${compositeStyleKey}|${runKey}|${sourceIndex}|${previousAlpha}|${sourceAlpha}`
        ] ?? etchContextTransitions?.[
          `${compositeStyleKey}|${runKey}|${previousAlpha}|${sourceAlpha}`
        ] ?? etchTransitions?.[
          `${compositeStyleKey}|${previousAlpha}|${sourceAlpha}`
        ] ?? etchTransitions?.[`${previousAlpha}|${sourceAlpha}`];
        let combined;
        if (pass === 'etch' && styleEtchTransition !== undefined) {
          combined = styleEtchTransition;
        } else if (!useTransitions && pass === 'etch') {
          // AIR composites the transformed underline as a separate fixed-point
          // source inside the TextField layer.
          combined = sourceAlpha + previousAlpha - ((sourceAlpha * previousAlpha + 255) >> 8);
        } else {
          combined = sourceAlpha + previousAlpha - Math.floor(sourceAlpha * previousAlpha / 255);
        }
        if (contextState !== undefined && mainStates?.[contextState]) {
          combined = Number(mainStates[contextState].split(',', 1)[0]);
        }
        layer[lo] = combined;
        if (coverage) {
          sourceRuns[lo] = sourceRuns[lo]
            ? `${sourceRuns[lo]},${sourceAlpha}` : String(sourceAlpha);
          const sourceContext = `${runKey}:${sourceIndex}:${sourceAlpha}`;
          sourceContextRuns[lo] = sourceContextRuns[lo]
            ? `${sourceContextRuns[lo]};${sourceContext}` : sourceContext;
          coverage[lo] = 1;
          states[lo] = previousCoverage
            ? (contextState ?? mainTransitions?.[`${compositeOutputKey}|${states[lo]}|${sourceState}`] ??
              mainTransitions?.[`${compositeStyleKey}|${states[lo]}|${sourceState}`] ??
              mainTransitions?.[`${states[lo]}|${sourceState}`] ?? defaults?.[combined] ?? -1)
            : (sourceState >= 0 ? sourceState : (defaults?.[combined] ?? -1));
        }
      };
      for (const line of passLay.lines) {
        for (let charIndex = 0; charIndex < line.chars.length; charIndex++) {
          const c = line.chars[charIndex];
          const next = line.chars[charIndex + 1];
          const allowExteriorFringe = !next || passEngine._flat(next.cp).outline.empty;
          const penAbsX = pad + 2 /*gutter*/ + c.penX + dx;
          const baseAbsY = pad + line.baseline + dy;
          const { r, intX, negIntY } = this._glyphRaster(c.cp, penAbsX, -baseAbsY,
            c.jump ?? 0, c.inkShift ?? 0, c.inkDy ?? 0, pass, passEngine,
            c.calibratedInkShift ?? 0, c.rasterKey ?? c.runKey ?? '', allowExteriorFringe);
          finalEtchAlpha ||= !!r.finalEtchAlpha;
          if (!r.w) continue;
          const gx = intX + r.x0, gy = negIntY + r.y0;
          for (let ry = 0; ry < r.h; ry++) {
            const py = gy + ry;
            if (py < 0 || py >= H) continue;
            for (let rx = 0; rx < r.w; rx++) {
              const px = gx + rx;
              if (px < 0 || px >= W) continue;
              const sourceIndex = ry * r.w + rx;
              const sourceAlpha = r.alpha[sourceIndex];
              const sourceCoverage = pass === 'main'
                ? (r.coverage?.[sourceIndex] ?? (sourceAlpha ? 1 : 0)) : (sourceAlpha ? 1 : 0);
              if (!sourceAlpha && !sourceCoverage) continue;
              const lo = py * W + px;
              const previousCoverage = coverage?.[lo] ?? 0;
              const sourceState = pass === 'main'
                ? (r.mainState?.[sourceIndex] ?? defaults?.[sourceAlpha] ?? -1) : -1;
              const cellContext = c.rasterKey ?? c.runKey ?? '';
              const nearbyCellTransition = (styleKey) => {
                for (const delta of [-1, 1, -2, 2]) {
                  const value = mainCellTransitions?.[
                    `${styleKey}|${cellContext}|${sourceIndex + delta}|${states[lo]}|${sourceState}`
                  ];
                  if (value !== undefined) return value;
                }
                return undefined;
              };
              const contextState = pass === 'main' && previousCoverage
                ? (mainCellTransitions?.[`${compositeOutputKey}|${cellContext}|${sourceIndex}|${states[lo]}|${sourceState}`] ??
                  nearbyCellTransition(compositeOutputKey) ??
                  mainContextTransitions?.[`${compositeOutputKey}|${c.rasterKey ?? c.runKey ?? ''}|${states[lo]}|${sourceState}`] ??
                  mainCellTransitions?.[`${compositeStyleKey}|${cellContext}|${sourceIndex}|${states[lo]}|${sourceState}`] ??
                  nearbyCellTransition(compositeStyleKey) ??
                  mainContextTransitions?.[`${compositeStyleKey}|${c.rasterKey ?? c.runKey ?? ''}|${states[lo]}|${sourceState}`])
                : undefined;
              mergePixel(lo, sourceAlpha, sourceState, contextState,
                true, c.rasterKey ?? c.runKey ?? '', sourceIndex);
            }
          }
        }
      }
      if (passEngine.style.underline) {
        const etchAlpha256 = Math.max(0, Math.min(256,
          Math.floor((et?.alpha ?? 1) * 256 + 1e-9)));
        const transformedOpaqueAlpha = (255 * etchAlpha256) >> 8;
        for (const line of passLay.lines) {
          const last = line.chars[line.chars.length - 1];
          if (!last) continue;
          const lineWidth = last.penX + last.advance;
          const wholeWidth = Math.floor(lineWidth + 1e-9);
          const fractionalWidth = lineWidth - wholeWidth;
          const endQuarters = Math.max(0, Math.min(4,
            Math.floor(fractionalWidth * 4 + 0.5 + 1e-9)));
          const x0 = Math.floor(pad + GUTTER + dx + 1e-9);
          const x1 = Math.min(W, x0 + Math.ceil(lineWidth));
          const py = Math.round(pad + line.baseline + dy) + (passEngine.style.underlineOffset ?? 0);
          if (py < 0 || py >= H) continue;
          for (let px = Math.max(0, x0); px < x1; px++) {
            const quarters = fractionalWidth > 1e-9 && px === x0 + wholeWidth
              ? endQuarters : 4;
            if (!quarters) continue;
            const rawUnderlineAlpha = Math.floor(quarters * 255 / 4);
            const sourceAlpha = pass === 'etch' && finalEtchAlpha
              ? Math.floor(quarters * transformedOpaqueAlpha / 4)
              : rawUnderlineAlpha;
            const sourceState = pass === 'main' ? (defaults?.[sourceAlpha] ?? -1) : -1;
            mergePixel(py * W + px, sourceAlpha, sourceState, undefined, false,
              '@underline', quarters);
          }
        }
      }
      return { alpha: layer, states, coverage, sourceRuns, sourceContextRuns, finalEtchAlpha };
    };

    const compositeCalibration = this.layout.style.compositeCalibration;
    const calibratedComposite = et && compositeCalibration &&
      et.color === 0xFFFFFF && et.alpha === 0xB2 / 255 && et.x === 0 && et.y === 1 &&
      (opts.color ?? 0x000000) === 0x000000;
    const calibratedUnetched = !et && !!compositeCalibration;
    if (calibratedComposite || calibratedUnetched) {
      const etchLayer = calibratedComposite
        ? rasterLayer(et.x, et.y, 'etch', etchLay ?? lay, etchEngine ?? this.layout)
        : { alpha: new Uint8ClampedArray(W * H) };
      const mainLayer = rasterLayer(0, 0, 'main', lay, this.layout);
      const transitions = compositeCalibration.transitions;
      const compositeSourceTransitions = compositeCalibration.compositeSourceTransitions;
      const compositeCellTransitions = compositeCalibration.compositeCellTransitions;
      const defaults = compositeCalibration.defaultStateByAlpha;
      for (let i = 0; i < W * H; i++) {
        const e = etchLayer.alpha[i], m = mainLayer.alpha[i];
        if (!e && !m) continue;
        const o = i * 4;
        if (!mainLayer.coverage[i]) {
          img.data[o] = img.data[o + 1] = img.data[o + 2] = 255;
          img.data[o + 3] = e;
          continue;
        }
        const state = mainLayer.states[i] >= 0 ? mainLayer.states[i] : defaults[m];
        const compositeCellKey = `${compositeOutputKey}|${e}|${mainLayer.sourceContextRuns[i]}`;
        const cellOutput = compositeCellTransitions?.[compositeCellKey];
        const fallbackOutput = compositeSourceTransitions?.[
          `${compositeOutputKey}|${e}|${state}|${mainLayer.sourceRuns[i]}`
        ] ?? transitions[`${compositeOutputKey}|${e}|${state}`] ??
          transitions[`${compositeStyleKey}|${e}|${state}`] ??
          transitions[`${e}|${state}`];
        if (cellOutput && this.layout.style.compositeCellUsage &&
          (!fallbackOutput || cellOutput.some((value, channel) => value !== fallbackOutput[channel]))) {
          this.layout.style.compositeCellUsage.add(compositeCellKey);
        }
        const output = cellOutput ?? fallbackOutput;
        if (output) {
          img.data[o] = output[0]; img.data[o + 1] = output[1];
          img.data[o + 2] = output[2]; img.data[o + 3] = output[3];
        } else if (calibratedUnetched) {
          const color = opts.color ?? 0x000000;
          const cr = (color >> 16) & 0xFF, cg = (color >> 8) & 0xFF, cb = color & 0xFF;
          img.data[o] = m ? Math.min(255, Math.floor(Math.floor(cr * m / 255) * 256 / m)) : 0;
          img.data[o + 1] = m ? Math.min(255, Math.floor(Math.floor(cg * m / 255) * 256 / m)) : 0;
          img.data[o + 2] = m ? Math.min(255, Math.floor(Math.floor(cb * m / 255) * 256 / m)) : 0;
          img.data[o + 3] = m;
        } else {
          const white = e ? Math.floor(e * (255 - m) / 255) : 0;
          const alpha = m + white;
          img.data[o] = img.data[o + 1] = img.data[o + 2] = alpha ? Math.floor(white * 255 / alpha) : 0;
          img.data[o + 3] = alpha;
        }
      }
      return { ...img, layout: lay };
    }

    const drawPass = (color, alphaMul, dx, dy, pass, passLay, passEngine) => {
      const cr = (color >> 16) & 0xFF, cg = (color >> 8) & 0xFF, cb = color & 0xFF;
      const alpha256 = Math.max(0, Math.min(256, Math.floor(alphaMul * 256 + 1e-9)));
      const rastered = rasterLayer(dx, dy, pass, passLay, passEngine);
      for (let i = 0; i < rastered.alpha.length; i++) {
        const sourceAlpha = rastered.finalEtchAlpha ? rastered.alpha[i] : (rastered.alpha[i] * alpha256) >> 8;
        if (sourceAlpha) blendPremultiplied(premul, i * 4, cr, cg, cb, sourceAlpha);
      }
    };

    if (et && et.alpha > 0) drawPass(et.color, et.alpha, et.x, et.y, 'etch', etchLay ?? lay, etchEngine ?? this.layout);
    drawPass(opts.color ?? 0x000000, 1, 0, 0, 'main', lay, this.layout);

    for (let o = 0; o < premul.length; o += 4) {
      const a = premul[o + 3];
      if (!a) continue;
      img.data[o] = Math.min(255, Math.floor(premul[o] * 256 / a));
      img.data[o + 1] = Math.min(255, Math.floor(premul[o + 1] * 256 / a));
      img.data[o + 2] = Math.min(255, Math.floor(premul[o + 2] * 256 / a));
      img.data[o + 3] = a;
    }

    return { ...img, layout: lay };
  }
}

function normalizeContextPhase(entry, context, fallback, restoreTranslatedSupport, geometric) {
  if (!context) return { phase: fallback, dx: 0, dy: 0 };
  const w = entry.w, h = entry.h;
  for (let dy = -2; restoreTranslatedSupport && dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    if (!dx && !dy) continue;
    let differs = false, matches = true;
    for (let y = 0; matches && y < h; y++) for (let x = 0; x < w; x++) {
      const sx = x - dx, sy = y - dy;
      const expected = sx >= 0 && sy >= 0 && sx < w && sy < h
        ? fallback.alpha[sy * w + sx] : 0;
      const actual = context.alpha[y * w + x];
      if (actual !== expected) { matches = false; break; }
      if (actual !== fallback.alpha[y * w + x]) differs = true;
    }
    if (matches && differs) return { phase: fallback, dx, dy };
  }
  if (!geometric) return { phase: context, dx: 0, dy: 0 };

  // Context extraction can occasionally capture a distant pixel from a
  // neighboring glyph. A legitimate density/origin change remains adjacent
  // to the fallback support; discard only disconnected additions.
  const phase = {
    ...context,
    alpha: context.alpha.slice(),
    etchAlpha: context.etchAlpha?.slice(),
    mainState: context.mainState?.slice(),
    coverage: context.coverage?.slice(),
  };
  const supportedNearby = (x, y) => {
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const px = x + ox, py = y + oy;
      if (px < 0 || py < 0 || px >= w || py >= h) continue;
      const i = py * w + px;
      if (fallback.alpha[i] || fallback.coverage?.[i]) return true;
    }
    return false;
  };
  const supportedGeometrically = (x, y) => {
    const rx = entry.x0 + x - geometric.x0;
    const ry = entry.y0 + y - geometric.y0;
    return rx >= 0 && ry >= 0 && rx < geometric.w && ry < geometric.h &&
      !!geometric.alpha[ry * geometric.w + rx];
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (phase.alpha[i] === 255 && !fallback.alpha[i] && !supportedNearby(x, y) &&
      !supportedGeometrically(x, y)) {
      phase.alpha[i] = 0;
      if (phase.etchAlpha) phase.etchAlpha[i] = 0;
      if (phase.mainState) phase.mainState[i] = -1;
      if (phase.coverage) phase.coverage[i] = 0;
    }
  }
  return { phase, dx: 0, dy: 0 };
}

function addExteriorFringe(calibrated, raw) {
  const x0 = Math.min(calibrated.x0, raw.x0), y0 = Math.min(calibrated.y0, raw.y0);
  const x1 = Math.max(calibrated.x0 + calibrated.w, raw.x0 + raw.w);
  const y1 = Math.max(calibrated.y0 + calibrated.h, raw.y0 + raw.h);
  if (x0 === calibrated.x0 && y0 === calibrated.y0 &&
    x1 === calibrated.x0 + calibrated.w && y1 === calibrated.y0 + calibrated.h) return calibrated;
  const w = x1 - x0, h = y1 - y0;
  const alpha = new Uint8ClampedArray(w * h);
  const mainState = new Int16Array(w * h).fill(-1);
  const coverage = new Uint8Array(w * h);
  for (let y = 0; y < calibrated.h; y++) for (let x = 0; x < calibrated.w; x++) {
    const source = y * calibrated.w + x;
    const target = (y + calibrated.y0 - y0) * w + x + calibrated.x0 - x0;
    alpha[target] = calibrated.alpha[source];
    mainState[target] = calibrated.mainState?.[source] ?? -1;
    coverage[target] = calibrated.coverage?.[source] ?? (calibrated.alpha[source] ? 1 : 0);
  }
  for (let y = 0; y < raw.h; y++) for (let x = 0; x < raw.w; x++) {
    const rx = raw.x0 + x, ry = raw.y0 + y;
    if (rx >= calibrated.x0 && rx < calibrated.x0 + calibrated.w &&
      ry >= calibrated.y0 && ry < calibrated.y0 + calibrated.h) continue;
    const sourceAlpha = raw.alpha[y * raw.w + x];
    if (!sourceAlpha) continue;
    const target = (ry - y0) * w + rx - x0;
    alpha[target] = sourceAlpha;
    coverage[target] = 1;
  }
  return { ...calibrated, x0, y0, w, h, alpha, mainState, coverage };
}

function blendPremultiplied(d, o, r, g, b, sourceAlpha) {
  const inverse = 256 - sourceAlpha;
  const sourceR = Math.floor(r * sourceAlpha / 255);
  const sourceG = Math.floor(g * sourceAlpha / 255);
  const sourceB = Math.floor(b * sourceAlpha / 255);
  d[o] = Math.min(255, sourceR + ((d[o] * inverse) >> 8));
  d[o + 1] = Math.min(255, sourceG + ((d[o + 1] * inverse) >> 8));
  d[o + 2] = Math.min(255, sourceB + ((d[o + 2] * inverse) >> 8));
  d[o + 3] = Math.min(255, sourceAlpha + ((d[o + 3] * inverse) >> 8));
}
