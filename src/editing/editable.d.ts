import type { StyleInput, TruffleText } from '../index.js';

export interface TruffleEditableOptions {
  style?: StyleInput;
  value?: string;
  placeholder?: string;
  multiline?: boolean;
  width?: number | null;
  height?: number | null;
  background?: string;
  selectionColor?: string;
  caretColor?: string;
  ariaLabel?: string;
  role?: string;
  onInput?: (value: string, editor: TruffleEditable) => void;
  onSelectionChange?: (state: { start: number; end: number; caret: CaretGeometry; editor: TruffleEditable }) => void;
}

export interface CaretGeometry {
  index: number;
  lineIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export class TruffleEditable {
  constructor(host: HTMLElement, truffle: TruffleText, options?: TruffleEditableOptions);
  value: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  readonly input: HTMLTextAreaElement;
  readonly canvas: HTMLCanvasElement;
  setStyle(style: StyleInput): this;
  setSelectionRange(start: number, end?: number, direction?: 'forward' | 'backward' | 'none'): this;
  focus(options?: FocusOptions): this;
  refresh(): this;
  currentCaretRect(): CaretGeometry;
  destroy(): void;
}

export function createTruffleEditable(host: HTMLElement, truffle: TruffleText, options?: TruffleEditableOptions): TruffleEditable;
