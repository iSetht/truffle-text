/** Caret, selection, and hit-testing geometry derived from Truffle layout. */

import { GUTTER } from './textfield.js';

export function snapTextIndex(text, index) {
  const value = String(text ?? '');
  let result = Math.max(0, Math.min(value.length, Math.trunc(Number(index) || 0)));
  // A DOM selection is UTF-16 based, but a caret must never split a surrogate
  // pair. Snap an accidental interior index to the pair's leading edge.
  if (result > 0 && result < value.length &&
    value.charCodeAt(result - 1) >= 0xD800 && value.charCodeAt(result - 1) <= 0xDBFF &&
    value.charCodeAt(result) >= 0xDC00 && value.charCodeAt(result) <= 0xDFFF) result--;
  return result;
}

export function caretRect(layout, text, index) {
  const value = String(text ?? layout?.plainText ?? '');
  const target = snapTextIndex(value, index);
  const lines = describeLines(layout, value);
  if (!lines.length) {
    const height = layout?.metrics?.height ?? 0;
    return { index: target, lineIndex: 0, x: GUTTER, y: GUTTER, width: 1, height };
  }

  const stops = new Map();
  for (const line of lines) {
    stops.set(line.start, position(line, line.startX));
    for (const char of line.chars) {
      const bound = layout.charBounds?.[char.i];
      if (!bound) continue;
      stops.set(char.i, position(line, bound.x));
      stops.set(char.i + codeUnitLength(char), position(line, bound.right));
    }
  }
  if (stops.has(target)) return { index: target, ...stops.get(target) };

  // Missing-glyph and newline slots have no char bounds. Place them at the
  // closest logical stop, preferring the following line for an after-newline
  // index and the preceding line at the document end.
  const ordered = [...stops].sort((a, b) => a[0] - b[0]);
  const next = ordered.find(([stop]) => stop > target);
  if (next) return { index: target, ...next[1] };
  const previous = ordered[ordered.length - 1];
  return { index: target, ...(previous?.[1] ?? position(lines[0], lines[0].startX)) };
}

export function selectionRects(layout, text, start, end) {
  const value = String(text ?? layout?.plainText ?? '');
  const from = snapTextIndex(value, Math.min(start, end));
  const to = snapTextIndex(value, Math.max(start, end));
  if (from === to) return [];
  const rects = [];
  for (const line of describeLines(layout, value)) {
    let left = Infinity;
    let right = -Infinity;
    for (const char of line.chars) {
      const charStart = char.i;
      const charEnd = char.i + codeUnitLength(char);
      if (charEnd <= from || charStart >= to) continue;
      const bound = layout.charBounds?.[char.i];
      if (!bound) continue;
      left = Math.min(left, bound.x);
      right = Math.max(right, bound.right);
    }
    if (Number.isFinite(left) && right > left) {
      rects.push({ x: left, y: line.y, width: right - left, height: line.height, lineIndex: line.index });
    }
  }
  return rects;
}

export function hitTestText(layout, text, x, y) {
  const value = String(text ?? layout?.plainText ?? '');
  const lines = describeLines(layout, value);
  if (!lines.length) return 0;
  const py = Number(y) || 0;
  let line = lines[0];
  let best = Infinity;
  for (const candidate of lines) {
    const center = candidate.y + candidate.height / 2;
    const distance = Math.abs(py - center);
    if (distance < best) { line = candidate; best = distance; }
  }
  const px = Number(x) || 0;
  for (const char of line.chars) {
    const bound = layout.charBounds?.[char.i];
    if (!bound) continue;
    if (px < (bound.x + bound.right) / 2) return snapTextIndex(value, char.i);
  }
  return snapTextIndex(value, line.end);
}

function describeLines(layout, text) {
  const source = layout?.lines ?? [];
  const result = [];
  let inferredIndex = 0;
  for (let index = 0; index < source.length; index++) {
    const line = source[index];
    const chars = line.chars ?? [];
    const first = chars[0];
    const last = chars[chars.length - 1];
    let start = first?.i ?? inferredIndex;
    let end = last ? last.i + codeUnitLength(last) : start;
    if (index > 0 && start > inferredIndex && /[\r\n]/.test(text.slice(inferredIndex, start))) {
      // Empty paragraph: the line starts after its newline delimiter.
      start = Math.min(start, inferredIndex + newlineLengthAt(text, inferredIndex));
      end = Math.max(end, start);
    }
    const y = first && layout.charBounds?.[first.i]
      ? layout.charBounds[first.i].y
      : GUTTER + (line.top ?? 0);
    const height = line.metrics?.height ?? line.height ?? layout?.metrics?.height ?? 0;
    const startX = first && layout.charBounds?.[first.i]
      ? layout.charBounds[first.i].x
      : GUTTER + (line.offsetX ?? 0);
    const endX = last && layout.charBounds?.[last.i]
      ? layout.charBounds[last.i].right
      : startX;
    result.push({ index, line, chars, start, end, y, height, startX, endX });
    inferredIndex = end;
    const newline = newlineLengthAt(text, inferredIndex);
    if (newline) inferredIndex += newline;
  }
  return result;
}

function newlineLengthAt(text, index) {
  return text.startsWith('\r\n', index) ? 2 : /[\r\n]/.test(text[index] ?? '') ? 1 : 0;
}

function codeUnitLength(char) {
  return char.text?.length ?? (char.cp > 0xFFFF ? 2 : 1);
}

function position(line, x) {
  return { lineIndex: line.index, x, y: line.y, width: 1, height: line.height };
}
