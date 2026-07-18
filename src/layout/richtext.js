/** Run-aware layout for styled documents. */

import { GUTTER } from './textfield.js';
import { roundTwip } from '../font/flashfont.js';
import { normalizeDocument, plainTextOf } from '../richtext/parser.js';

const WORD_DELIMS = /[~%&!\\;:"',<>?#\s.\-()=\[\]{}^_]/;

export class RichTextLayout {
  constructor(truffle, baseStyle = 'il_regular', fitCfg = null) {
    this.truffle = truffle;
    this.baseStyle = baseStyle;
    this.fitCfg = fitCfg;
  }

  /**
   * Lay out a DocModel using one shared pen per line. Context is preserved
   * across same-signature run boundaries and reset when the font/render
   * signature changes, matching the architecture's explicit fidelity rule.
   */
  layout(document, opts = {}) {
    const doc = normalizeDocument(document);
    const baseStyle = doc.baseStyle ?? this.baseStyle;
    const plainText = plainTextOf(doc);
    const charBounds = new Array(plainText.length).fill(null);
    const paragraphs = [];
    const resolvedRuns = [];
    let textIndex = 0;

    for (let paragraphIndex = 0; paragraphIndex < doc.paragraphs.length; paragraphIndex++) {
      const paragraph = doc.paragraphs[paragraphIndex];
      const tokens = [];
      for (const run of paragraph.runs) {
        const style = run.style?.styleName
          ? this.truffle.resolveStyle(run.style)
          : this.truffle.resolveStyle(baseStyle, run.style ?? {});
        const engine = this.truffle.engine(style, this.fitCfg);
        const resolvedRun = { text: run.text, style, engine, paragraphIndex };
        resolvedRuns.push(resolvedRun);
        for (let offset = 0; offset < run.text.length;) {
          const cp = run.text.codePointAt(offset);
          const length = cp > 0xFFFF ? 2 : 1;
          tokens.push({
            cp,
            text: run.text.slice(offset, offset + length),
            i: textIndex + offset,
            style,
            engine,
            run: resolvedRun,
          });
          offset += length;
        }
        textIndex += run.text.length;
      }
      paragraphs.push(tokens);
      if (paragraphIndex < doc.paragraphs.length - 1) textIndex += 1;
    }

    const baseEngine = this.truffle.engine(baseStyle, this.fitCfg);
    const wrapWidth = opts.wordWrap && opts.width
      ? Math.max(0, opts.width - 2 * GUTTER)
      : Infinity;
    const lines = [];

    for (const tokens of paragraphs) {
      if (!tokens.length) {
        lines.push(emptyLine(baseEngine));
        continue;
      }
      const paragraphPrefix = tokens.slice(0, 2).map(token => token.text).join('');
      let start = 0;
      while (start < tokens.length) {
        const split = findLineEnd(tokens, start, wrapWidth, paragraphPrefix, this);
        const end = Math.max(start + 1, split);
        lines.push(buildLine(tokens, start, end, paragraphPrefix, this));
        start = end;
      }
    }

    let top = 0;
    let textWidth = 0;
    let maxItalicOverhang = 0;
    const fieldContentWidth = opts.width
      ? Math.max(0, opts.width - 2 * GUTTER)
      : null;
    for (const line of lines) {
      line.top = roundTwip(top);
      line.baseline = roundTwip(GUTTER + line.top + line.metrics.ascent);
      line.height = line.metrics.height;
      const align = opts.textAlign ?? line.chars[0]?.style.textAlign ?? 'left';
      const available = fieldContentWidth ?? line.width;
      const offsetX = align === 'right'
        ? Math.max(0, available - line.width)
        : align === 'center'
          ? Math.max(0, (available - line.width) / 2)
          : 0;
      line.offsetX = roundTwip(offsetX);
      for (const char of line.chars) {
        char.penX = roundTwip(char.penX + line.offsetX);
        const x0 = roundTwip(char.penX);
        const x1 = roundTwip(char.penX + char.advance);
        charBounds[char.i] = {
          x: GUTTER + x0,
          y: GUTTER + line.top,
          width: roundTwip(x1 - x0),
          height: line.metrics.height,
          right: GUTTER + x1,
          bottom: GUTTER + line.top + line.metrics.height,
        };
        maxItalicOverhang = Math.max(maxItalicOverhang, char.style.italicRightOverhang ?? 0);
      }
      textWidth = Math.max(textWidth, line.width);
      top += line.metrics.height + line.metrics.leading;
    }

    const lastLine = lines[lines.length - 1];
    const textHeight = lines.length
      ? roundTwip(lastLine.top + lastLine.metrics.height)
      : 0;
    const naturalWidth = roundTwip(textWidth + 2 * GUTTER + maxItalicOverhang);
    const width = opts.width ? Math.max(naturalWidth, Number(opts.width)) : naturalWidth;
    const engines = new Set(lines.flatMap(line => line.chars.map(char => char.engine)));
    const uniformEngine = engines.size === 1 ? engines.values().next().value : null;

    return {
      type: 'rich-layout',
      document: doc,
      plainText,
      resolvedRuns,
      lines,
      charBounds,
      textWidth: roundTwip(textWidth),
      textHeight,
      width: roundTwip(width),
      height: roundTwip(textHeight + 2 * GUTTER),
      metrics: uniformEngine?.layout.lineMetrics() ?? aggregateDocumentMetrics(lines),
      uniformEngine,
    };
  }
}

function findLineEnd(tokens, start, wrapWidth, paragraphPrefix, owner) {
  if (!Number.isFinite(wrapWidth)) return tokens.length;
  let lastBreak = -1;
  const state = makeLineState();
  for (let i = start; i < tokens.length; i++) {
    const token = tokens[i];
    const beforeCount = state.chars.length;
    appendToken(state, token, tokens[i + 1], paragraphPrefix, owner);
    if (state.penX > wrapWidth && beforeCount > 0 && !/\s/.test(token.text)) {
      return lastBreak > start ? lastBreak : i;
    }
    if (WORD_DELIMS.test(token.text)) lastBreak = i + 1;
  }
  return tokens.length;
}

function buildLine(tokens, start, end, paragraphPrefix, owner) {
  const state = makeLineState();
  for (let i = start; i < end; i++) {
    appendToken(state, tokens[i], i + 1 < end ? tokens[i + 1] : null, paragraphPrefix, owner);
  }
  return finalizeLine(state, owner);
}

function appendToken(state, token, nextToken, paragraphPrefix, owner) {
  const selected = selectEngine(token, owner);
  if (!selected) return;
  const { engine, style } = selected;
  const layout = engine.layout;
  const previous = state.chars[state.chars.length - 1];
  const sameSignature = !!previous && previous.engine === engine;
  const segment = sameSignature ? state.segment : [];
  let runIndex = 0;
  let runLeader = '';
  const segmentPrevious = segment[segment.length - 1];
  if (segmentPrevious && segmentPrevious.cp === token.cp) {
    runIndex = (segmentPrevious.runIndex ?? 0) + 1;
    runLeader = segmentPrevious.runLeader ?? '';
  } else if (segmentPrevious) {
    runLeader = String.fromCodePoint(segmentPrevious.cp);
  }
  const previous2 = segment.length > 1
    ? String.fromCodePoint(segment[segment.length - 2].cp)
    : '';
  const nextSelected = nextToken ? selectEngine(nextToken, owner, false) : null;
  const nextCp = style.kerning && nextSelected?.engine === engine ? nextToken.cp : 0;
  const nextGlyph = nextCp ? String.fromCodePoint(nextCp) : '';
  const prefix = sameSignature || !previous ? paragraphPrefix : token.text + (nextToken?.text ?? '');
  const runKey = JSON.stringify([runLeader, runIndex, nextGlyph]);
  const deepKey = JSON.stringify([previous2, runLeader, runIndex, nextGlyph]);
  const prefixKey = JSON.stringify([prefix, previous2, runLeader, runIndex, nextGlyph]);
  const adv = layout.advanceOf(token.cp, state.penX, 0, nextCp, runKey, deepKey, prefixKey);
  const step = layout.advancedPixel
    ? layout.fittedStep(token.cp, state.penX, nextCp, runKey, deepKey, prefixKey)
    : { jump: 0, inkShift: 0, calibratedInkShift: 0, inkDy: 0 };
  const char = {
    cp: token.cp,
    i: token.i,
    text: token.text,
    penX: state.penX,
    advance: adv,
    jump: step.jump,
    inkShift: step.inkShift,
    calibratedInkShift: step.calibratedInkShift,
    inkDy: step.inkDy,
    runIndex,
    runLeader,
    runKey,
    rasterKey: prefixKey,
    engine,
    layoutEngine: layout,
    style,
    sourceRun: token.run,
  };
  state.chars.push(char);
  if (sameSignature) state.segment.push(char);
  else state.segment = [char];
  state.penX = roundTwip(state.penX + adv);
  const metrics = layout.lineMetrics();
  state.ascent = Math.max(state.ascent, metrics.ascent);
  state.descent = Math.max(state.descent, metrics.descent);
  state.leading = Math.max(state.leading, metrics.leading);
}

function selectEngine(token, owner, report = true) {
  const primary = token.engine;
  if (primary.layout.font.glyphId(token.cp) !== 0) return { engine: primary, style: primary.style };
  const fallbacks = token.style.fontFallbacks ?? token.style.fontFallback ?? [];
  const families = Array.isArray(fallbacks)
    ? fallbacks
    : String(fallbacks).split(',').map(value => value.trim()).filter(Boolean);
  for (const family of families) {
    const style = owner.truffle.resolveStyle({ ...token.style, fontFamily: family });
    let engine;
    try { engine = owner.truffle.engine(style, owner.fitCfg); }
    catch { continue; }
    if (engine.layout.font.glyphId(token.cp) !== 0) {
      if (report) token.style._reportFallback?.({
        stage: 'font', reason: 'font-fallback', codePoint: token.cp,
        character: token.text, fromFamily: token.style.fontFamily, toFamily: family,
      });
      return { engine, style: engine.style };
    }
  }
  if (token.style.missingGlyph === 'notdef') return { engine: primary, style: primary.style };
  if (report) token.style._reportFallback?.({
    stage: 'font', reason: 'missing-glyph', codePoint: token.cp,
    character: token.text, fromFamily: token.style.fontFamily,
  });
  return null;
}

function makeLineState() {
  return { chars: [], segment: [], penX: 0, ascent: 0, descent: 0, leading: 0 };
}

function finalizeLine(state, owner) {
  if (!state.chars.length) return emptyLine(owner.truffle.engine(owner.baseStyle, owner.fitCfg));
  return {
    chars: state.chars,
    width: roundTwip(state.penX),
    metrics: {
      ascent: roundTwip(state.ascent),
      descent: roundTwip(state.descent),
      leading: roundTwip(state.leading),
      height: roundTwip(state.ascent + state.descent),
    },
  };
}

function emptyLine(engine) {
  const metrics = engine.layout.lineMetrics();
  return { chars: [], width: 0, metrics: { ...metrics } };
}

function aggregateDocumentMetrics(lines) {
  return {
    ascent: Math.max(0, ...lines.map(line => line.metrics.ascent)),
    descent: Math.max(0, ...lines.map(line => line.metrics.descent)),
    leading: Math.max(0, ...lines.map(line => line.metrics.leading)),
    height: Math.max(0, ...lines.map(line => line.metrics.height)),
  };
}
