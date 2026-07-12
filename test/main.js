import { HABBO_CSS_STYLE_NAMES } from '../src/index.js';
import { loadPackedTruffle } from '../src/packed.js';

const messageInput = document.querySelector('#message');
const styleSelect = document.querySelector('#style');
const backgroundButton = document.querySelector('#background');
const preview = document.querySelector('#preview');
const canvas = document.querySelector('#output');
const status = document.querySelector('#status');
const context = canvas.getContext('2d');

let truffle;

function render() {
  if (!truffle) return;

  const text = messageInput.value || ' ';
  const buffer = truffle.renderToBuffer(text, styleSelect.value, { padding: 12 });

  canvas.width = Math.max(1, buffer.width);
  canvas.height = Math.max(1, buffer.height);
  context.putImageData(
    new ImageData(new Uint8ClampedArray(buffer.data), buffer.width, buffer.height),
    0,
    0,
  );
}

async function start() {
  try {
    const styles = [...HABBO_CSS_STYLE_NAMES].sort((a, b) => a.localeCompare(b));

    styleSelect.replaceChildren(...styles.map((style) => {
      const option = document.createElement('option');
      option.value = style;
      option.textContent = style;
      option.selected = style === 'u_chat_speak';
      return option;
    }));

    truffle = await loadPackedTruffle({
      base: '../assets/truffle',
      styles: null,
    });

    styleSelect.disabled = false;
    status.textContent = `${styles.length} styles ready`;
    render();
  } catch (error) {
    console.error(error);
    status.textContent = `Could not load Truffle: ${error.message}`;
  }
}

messageInput.addEventListener('input', render);
styleSelect.addEventListener('change', render);
backgroundButton.addEventListener('click', () => {
  const isWhite = preview.style.background === 'white';
  preview.style.background = isWhite ? 'black' : 'white';
  backgroundButton.textContent = isWhite
    ? 'Switch to white background'
    : 'Switch to black background';
});

start();
