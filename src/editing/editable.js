/** Canvas-backed editable text with a real, visually transparent textarea. */

import { caretRect, hitTestText, selectionRects } from '../layout/editing.js';

const STYLE_ID = 'truffle-editable-styles';

export class TruffleEditable {
  constructor(host, truffle, options = {}) {
    if (!host?.appendChild) throw new TypeError('TruffleEditable requires a host element');
    if (!truffle?.renderToBuffer) throw new TypeError('TruffleEditable requires a TruffleText instance');
    this.host = host;
    this.truffle = truffle;
    this.options = {
      style: 'u_regular',
      value: '',
      placeholder: '',
      multiline: false,
      width: null,
      height: null,
      background: 'transparent',
      selectionColor: 'rgba(45, 108, 223, .45)',
      caretColor: '#111111',
      ariaLabel: 'Text',
      ...options,
    };
    this.layout = null;
    this.scrollX = 0;
    this.scrollY = 0;
    this.focused = false;
    this.caretVisible = true;
    this.pointer = null;

    const doc = host.ownerDocument;
    ensureStyles(doc);
    host.classList.add('truffle-editable');
    this.canvas = doc.createElement('canvas');
    this.canvas.className = 'truffle-editable__canvas';
    this.input = doc.createElement('textarea');
    this.input.className = 'truffle-editable__input';
    this.input.value = String(this.options.value ?? '');
    this.input.placeholder = String(this.options.placeholder ?? '');
    this.input.wrap = this.options.multiline ? 'soft' : 'off';
    this.input.rows = this.options.multiline ? 2 : 1;
    this.input.setAttribute('aria-label', this.options.ariaLabel);
    this.input.setAttribute('aria-multiline', String(!!this.options.multiline));
    if (!this.options.multiline) this.input.setAttribute('role', this.options.role ?? 'textbox');
    host.append(this.canvas, this.input);
    this.bufferCanvas = doc.createElement('canvas');
    this.bufferContext = this.bufferCanvas.getContext('2d');
    this.context = this.canvas.getContext('2d');

    this.listeners = [];
    this.listen(this.input, 'input', () => {
      this.caretVisible = true;
      this.render();
      this.options.onInput?.(this.value, this);
    });
    for (const event of ['select', 'keyup', 'compositionupdate', 'compositionend']) {
      this.listen(this.input, event, () => { this.caretVisible = true; this.render(); });
    }
    this.listen(this.input, 'focus', () => { this.focused = true; this.caretVisible = true; this.render(); });
    this.listen(this.input, 'blur', () => { this.focused = false; this.pointer = null; this.render(); });
    this.listen(this.input, 'keydown', event => this.onKeyDown(event));
    this.listen(this.input, 'pointerdown', event => this.onPointerDown(event));
    this.listen(this.input, 'pointermove', event => this.onPointerMove(event));
    this.listen(this.input, 'pointerup', event => this.onPointerUp(event));
    this.listen(this.input, 'pointercancel', event => this.onPointerUp(event));
    this.listen(doc, 'selectionchange', () => {
      if (doc.activeElement === this.input) this.render();
    });

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.render());
      this.resizeObserver.observe(host);
    }
    this.blinkTimer = setInterval(() => {
      if (!this.focused || this.input.selectionStart !== this.input.selectionEnd) return;
      this.caretVisible = !this.caretVisible;
      this.paint();
    }, 530);
    this.render();
  }

  get value() { return this.input.value; }
  set value(value) { this.input.value = String(value ?? ''); this.render(); }

  get selectionStart() { return this.input.selectionStart; }
  get selectionEnd() { return this.input.selectionEnd; }

  setStyle(style) { this.options.style = style; this.render(); return this; }
  setSelectionRange(start, end = start, direction = 'none') {
    this.input.setSelectionRange(start, end, direction);
    this.caretVisible = true;
    this.render();
    return this;
  }
  focus(options) { this.input.focus(options); return this; }
  refresh() { this.render(); return this; }

  render() {
    const value = this.value;
    const display = value || String(this.options.placeholder ?? '');
    const width = Math.max(1, Math.round(this.options.width ?? this.host.clientWidth ?? 240));
    const layoutOptions = this.options.multiline ? { wordWrap: true, width } : {};
    const buffer = this.truffle.renderToBuffer(display, this.options.style, layoutOptions);
    this.layout = value
      ? buffer.layout
      : this.truffle.measure('', this.options.style, layoutOptions);
    this.displayBuffer = buffer;
    const naturalHeight = Math.max(buffer.height, this.layout.height ?? 1);
    const height = Math.max(1, Math.round(this.options.height ?? this.host.clientHeight ?? naturalHeight));
    if (!this.host.clientHeight && this.options.height == null) this.host.style.height = `${height}px`;
    if (!this.host.clientWidth && this.options.width != null) this.host.style.width = `${width}px`;
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    this.ensureCaretVisible();
    this.paint();
    return this.layout;
  }

  paint() {
    if (!this.context || !this.displayBuffer || !this.layout) return;
    const ctx = this.context;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.options.background && this.options.background !== 'transparent') {
      ctx.fillStyle = this.options.background;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    if (this.value && this.focused && this.selectionStart !== this.selectionEnd) {
      ctx.fillStyle = this.options.selectionColor;
      for (const rect of selectionRects(this.layout, this.value, this.selectionStart, this.selectionEnd)) {
        ctx.fillRect(Math.round(rect.x - this.scrollX), Math.round(rect.y - this.scrollY),
          Math.ceil(rect.width), Math.ceil(rect.height));
      }
    }

    const buffer = this.displayBuffer;
    if (this.bufferCanvas.width !== buffer.width) this.bufferCanvas.width = buffer.width;
    if (this.bufferCanvas.height !== buffer.height) this.bufferCanvas.height = buffer.height;
    this.bufferContext.clearRect(0, 0, buffer.width, buffer.height);
    this.bufferContext.putImageData(
      new ImageData(new Uint8ClampedArray(buffer.data), buffer.width, buffer.height), 0, 0,
    );
    ctx.save();
    if (!this.value) ctx.globalAlpha = .48;
    ctx.drawImage(this.bufferCanvas, -Math.round(this.scrollX), -Math.round(this.scrollY));
    ctx.restore();

    const caret = this.currentCaretRect();
    if (this.value !== '' || this.focused) {
      if (this.focused && this.selectionStart === this.selectionEnd && this.caretVisible) {
        ctx.fillStyle = this.options.caretColor;
        ctx.fillRect(Math.round(caret.x - this.scrollX), Math.round(caret.y - this.scrollY),
          1, Math.max(1, Math.round(caret.height)));
      }
    }
    this.options.onSelectionChange?.({
      start: this.selectionStart, end: this.selectionEnd, caret, editor: this,
    });
  }

  currentCaretRect() {
    return caretRect(this.layout, this.value, this.selectionEnd);
  }

  ensureCaretVisible() {
    const caret = this.currentCaretRect();
    const margin = 3;
    if (caret.x - this.scrollX < margin) this.scrollX = Math.max(0, caret.x - margin);
    if (caret.x - this.scrollX > this.canvas.width - margin) {
      this.scrollX = Math.max(0, caret.x - this.canvas.width + margin);
    }
    if (caret.y - this.scrollY < 0) this.scrollY = Math.max(0, caret.y);
    if (caret.y + caret.height - this.scrollY > this.canvas.height) {
      this.scrollY = Math.max(0, caret.y + caret.height - this.canvas.height);
    }
  }

  pointIndex(event) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * this.canvas.width / Math.max(1, rect.width) + this.scrollX;
    const y = (event.clientY - rect.top) * this.canvas.height / Math.max(1, rect.height) + this.scrollY;
    return hitTestText(this.layout, this.value, x, y);
  }

  onPointerDown(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    this.input.focus({ preventScroll: true });
    const index = this.pointIndex(event);
    const anchor = event.shiftKey ? this.selectionStart : index;
    this.pointer = { id: event.pointerId, anchor };
    this.input.setPointerCapture?.(event.pointerId);
    this.input.setSelectionRange(Math.min(anchor, index), Math.max(anchor, index),
      index < anchor ? 'backward' : 'forward');
    this.caretVisible = true;
    this.render();
  }

  onPointerMove(event) {
    if (!this.pointer || this.pointer.id !== event.pointerId) return;
    event.preventDefault();
    const index = this.pointIndex(event);
    const anchor = this.pointer.anchor;
    this.input.setSelectionRange(Math.min(anchor, index), Math.max(anchor, index),
      index < anchor ? 'backward' : 'forward');
    this.caretVisible = true;
    this.render();
  }

  onPointerUp(event) {
    if (!this.pointer || this.pointer.id !== event.pointerId) return;
    this.input.releasePointerCapture?.(event.pointerId);
    this.pointer = null;
  }

  onKeyDown(event) {
    if (!this.options.multiline || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const caret = this.currentCaretRect();
    const direction = event.key === 'ArrowUp' ? -1 : 1;
    const index = hitTestText(this.layout, this.value, caret.x,
      caret.y + direction * Math.max(1, caret.height));
    const anchor = event.shiftKey ? (this.input.selectionDirection === 'backward'
      ? this.selectionEnd : this.selectionStart) : index;
    this.input.setSelectionRange(Math.min(anchor, index), Math.max(anchor, index),
      index < anchor ? 'backward' : 'forward');
    this.caretVisible = true;
    this.render();
  }

  listen(target, event, listener) {
    target.addEventListener(event, listener);
    this.listeners.push(() => target.removeEventListener(event, listener));
  }

  destroy() {
    clearInterval(this.blinkTimer);
    this.resizeObserver?.disconnect();
    for (const remove of this.listeners.splice(0)) remove();
    this.canvas.remove();
    this.input.remove();
    this.host.classList.remove('truffle-editable');
  }
}

export function createTruffleEditable(host, truffle, options) {
  return new TruffleEditable(host, truffle, options);
}

function ensureStyles(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .truffle-editable { position: relative; display: block; overflow: hidden; }
    .truffle-editable__canvas { position: absolute; inset: 0; width: 100%; height: 100%; image-rendering: pixelated; }
    .truffle-editable__input { position: absolute; inset: 0; width: 100%; height: 100%; box-sizing: border-box; margin: 0; padding: 0; border: 0; resize: none; overflow: hidden; background: transparent; color: transparent; caret-color: transparent; -webkit-text-fill-color: transparent; text-shadow: none; outline: none; }
    .truffle-editable__input::selection { color: transparent; background: transparent; }
    .truffle-editable__input::placeholder { color: transparent; -webkit-text-fill-color: transparent; }
  `;
  doc.head.appendChild(style);
}
