# Truffle Text

Truffle is an exact calibrated HTML canvas text renderer. It includes the
confirmed Habbo text-style names while keeping their calibrated sizes, weights,
sharpness, thickness, and spacing unchanged.

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
```

## React or Nitro usage

Preload once while the client starts:

```tsx
import { preloadTruffle, TruffleCanvasText } from 'truffle-text/react';

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

Use names from `HABBO_CSS_STYLE_NAMES` or inspect `HABBO_STYLES`. Confirmed
styles should be treated as read-only presets. Changing their sizes or render
settings leaves the certified output surface and may look blurry.

## Playground

Try every included style in the browser at
[isetht.github.io/truffle-text/test](https://isetht.github.io/truffle-text/test/).

## Licensing

Truffle's original code is available under the MIT License. Bundled fonts are
third-party components governed separately; see `THIRD_PARTY_NOTICES.md` and
the `licenses/` directory. Volter (Goldfish) does not currently have a located
standalone licence or EULA, so review its notice before redistribution.
