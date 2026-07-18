import { createElement, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { loadPackedTruffle } from './packed.js';

let truffle = null;
let preloadPromise = null;
const listeners = new Set();
const labelCache = new Map();

function cachedLabel(key, create) {
  let value = labelCache.get(key);
  if (value) {
    labelCache.delete(key);
    labelCache.set(key, value);
    return value;
  }
  value = create();
  labelCache.set(key, value);
  if (labelCache.size > 1000) labelCache.delete(labelCache.keys().next().value);
  return value;
}

export function preloadTruffle(options) {
  if (preloadPromise) return preloadPromise;
  preloadPromise = loadPackedTruffle(options).then(instance => {
    truffle = instance;
    for (const listener of listeners) listener(instance);
    return instance;
  });
  return preloadPromise;
}

export function getTruffle() {
  return truffle;
}

export function TruffleCanvasText({
  text = '', styleName = 'u_regular', color, className = '', title, onReady,
}) {
  const [instance, setInstance] = useState(truffle);
  const canvasRef = useRef(null);
  const value = String(text ?? '');

  useEffect(() => {
    if (truffle) {
      setInstance(truffle);
      return undefined;
    }
    const listener = next => setInstance(next);
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, []);

  const buffer = useMemo(() => {
    if (!instance) return null;
    const key = `${styleName}|${color ?? 'default'}|${value}`;
    return cachedLabel(key, () => instance.renderToBuffer(
      value, styleName, color === undefined ? {} : { color },
    ));
  }, [color, instance, styleName, value]);

  useLayoutEffect(() => {
    if (!buffer || !canvasRef.current) return;
    const context = canvasRef.current.getContext('2d');
    context.putImageData(new ImageData(new Uint8ClampedArray(buffer.data), buffer.width, buffer.height), 0, 0);
    onReady?.(buffer.layout);
  }, [buffer, onReady]);

  return createElement('canvas', {
    ref: canvasRef,
    width: buffer?.width ?? 0,
    height: buffer?.height ?? 0,
    className,
    title,
    role: 'img',
    'aria-label': value,
  });
}

export function TruffleRichText({
  markup = '', baseStyle = 'u_regular', color, width, wordWrap = width !== undefined,
  className = '', title, ariaLabel, onReady,
}) {
  const [instance, setInstance] = useState(truffle);
  const canvasRef = useRef(null);
  const value = String(markup ?? '');

  useEffect(() => {
    if (truffle) {
      setInstance(truffle);
      return undefined;
    }
    const listener = next => setInstance(next);
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, []);

  const buffer = useMemo(() => {
    if (!instance) return null;
    const styleKey = typeof baseStyle === 'string' ? baseStyle : JSON.stringify(baseStyle);
    const key = `rich|${styleKey}|${color ?? 'default'}|${width ?? 'auto'}|${wordWrap}|${value}`;
    return cachedLabel(key, () => instance.renderRichText(value, baseStyle, {
      ...(color === undefined ? {} : { color }),
      ...(width === undefined ? {} : { width }),
      wordWrap,
    }));
  }, [baseStyle, color, instance, value, width, wordWrap]);

  useLayoutEffect(() => {
    if (!buffer || !canvasRef.current) return;
    const context = canvasRef.current.getContext('2d');
    context.putImageData(
      new ImageData(new Uint8ClampedArray(buffer.data), buffer.width, buffer.height),
      0,
      0,
    );
    onReady?.(buffer.layout);
  }, [buffer, onReady]);

  return createElement('canvas', {
    ref: canvasRef,
    width: buffer?.width ?? 0,
    height: buffer?.height ?? 0,
    className,
    title,
    role: 'img',
    'aria-label': ariaLabel ?? value.replace(/<[^>]*>/g, ''),
  });
}
