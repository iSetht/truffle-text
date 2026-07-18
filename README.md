# Truffle Text

Truffle is a deterministic HTML canvas text renderer. Certified Habbo
signatures replay exact calibrated Flash/AIR output, while the outline engine
supports arbitrary sizes, runtime TrueType fonts, fallback chains, and mixed
rich formatting without browser font rasterization.

## Install

```bash
yarn add truffle-text
npx truffle-setup --out public/assets/truffle
```

Run `truffle-setup` again after upgrading the package. The command expands the
compact package payload into files that your own website serves; no external
CDN is required. Serve `.tfc` as `application/octet-stream`.

## Browser or canvas usage

```js
import { loadPackedTruffle } from 'truffle-text/packed';

const truffle = await loadPackedTruffle({
  base: './assets/truffle',
  styles: ['u_chat_speak', 'u_chat_name'],
});

truffle.drawText(context, 'Hello world!', {
  x: 0,
  y: 0,
  style: 'u_chat_speak',
});

truffle.drawRichText(context, 'Hello <b>bold</b> and ' +
  '<font size="18" color="#C62828">large red</font>', {
  x: 0,
  y: 24,
  style: 'u_regular',
});
```

## React or Nitro usage

Preload once while the client starts:

```tsx
import { preloadTruffle, TruffleCanvasText, TruffleRichText } from 'truffle-text/react';

await preloadTruffle({
  base: './assets/truffle',
  styles: [
    'u_chat_speak',
    'u_chat_name',
    'u_chat_whisper',
    'u_chat_name_whisper',
    'u_chat_shout',
  ],
});
```

Then render named styles anywhere:

```tsx
<TruffleCanvasText text="C5: " styleName="u_chat_name" />
<TruffleCanvasText text="Hello!" styleName="u_chat_speak" />
<TruffleRichText
  markup={'Hello <b>rich text</b>'}
  baseStyle="u_regular"
  width={320}
/>
```

Chat mappings used by the Habbo-style test:

```text
Speak:   u_chat_name + u_chat_speak
Whisper: u_chat_name_whisper + u_chat_whisper
Shout:   u_chat_name + u_chat_shout
```

For bubble wrapping, measure and place text with Truffle before showing the
bubble. Keep canvas coordinates integer-aligned. Do not show HTML text first
and replace it after loading.

## Styles

Use names from `HABBO_CSS_STYLE_NAMES` or inspect `HABBO_STYLES`. Named styles
are read-only presets, not size or face restrictions:

```js
const style = truffle.resolveStyle('u_regular', {
  fontSize: 17.5,
  bold: true,
  color: 0x17365D,
});
```

`fidelity: 'auto'` replays certified glyphs and falls back to deterministic
outline rendering. Use `'exact'` to reject any calibration miss or
`'geometric'` to force outline rendering. `onFallback` on
`loadPackedTruffle(...)` makes this observable in production.

## Editable search and input fields

```js
import { createTruffleEditable } from 'truffle-text/editable';

const search = createTruffleEditable(document.querySelector('#search'), truffle, {
  style: { styleName: 'u_italic', size: 11 },
  placeholder: 'Search profiles...',
});
```

This keeps a real transparent textarea for keyboard input, IME, clipboard, and
accessibility while Truffle draws the text, selection, and caret from one
layout. Ctrl+A never exposes browser-rendered fallback text. Dynamically added
underlines have a one-pixel gap by default.

## Playground

Try every included style in the browser at
[isetht.github.io/truffle-text/test](https://isetht.github.io/truffle-text/test/).

## Licensing

Truffle's original code is available under the MIT License. Bundled fonts are
third-party components governed separately; see `THIRD_PARTY_NOTICES.md` and
the `licenses/` directory. Volter (Goldfish) does not currently have a located
standalone licence or EULA, so review its notice before redistribution.
