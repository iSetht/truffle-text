import { createElement, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { loadPackedTruffle } from './packed.js';

let truffle = null;
let preloadPromise = null;
const listeners = new Set();
const labelCache = new Map();

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
    let cached = labelCache.get(key);
    if (!cached) {
      cached = instance.renderToBuffer(value, styleName, color === undefined ? {} : { color });
      if (labelCache.size >= 1000) labelCache.clear();
      labelCache.set(key, cached);
    }
    return cached;
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
