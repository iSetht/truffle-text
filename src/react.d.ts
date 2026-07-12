import { FC } from 'react';
import { PackedTruffleOptions, PackedTruffleText } from './packed.js';
import { TruffleLayout } from './index.js';

export function preloadTruffle(options: PackedTruffleOptions): Promise<PackedTruffleText>;
export function getTruffle(): PackedTruffleText | null;

export const TruffleCanvasText: FC<{
  text?: string | number;
  styleName?: string;
  color?: number;
  className?: string;
  title?: string;
  onReady?: (layout: TruffleLayout) => void;
}>;
