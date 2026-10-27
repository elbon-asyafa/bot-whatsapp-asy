const { createCanvas, registerFont } = require('canvas');
const sharp = require('sharp');
const { text: validateText } = require('./lib/validation');
const path = require('path');

// Register font Arial Narrow dari folder fonts
try {
  registerFont(path.join(__dirname, 'fonts', 'arialnarrow.ttf'), {
    family: 'Arial Narrow',
  });
} catch (e) {
  console.warn('[BRAT] Gagal load Arial Narrow, fallback ke sans-serif');
}

const CANVAS_SIZE = 512;
const MARGIN = 40;
const SAFE_WIDTH = CANVAS_SIZE - MARGIN * 2;
const SAFE_HEIGHT = CANVAS_SIZE - MARGIN * 2;

// Word wrap manual dengan measureText
function wrapText(ctx, text, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let current = '';

  for (const word of words) {
    const test = current ? current + ' ' + word : word;
    const metrics = ctx.measureText(test);
    if (metrics.width <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// Auto-scaling font size
function calculateOptimalFontSize(ctx, text, startSize = 95) {
  let fontSize = startSize;
  let lines = [];
  let lineHeight = 0;

  while (fontSize > 20) {
    ctx.font = `${fontSize}px "Arial Narrow", sans-serif`;
    lines = wrapText(ctx, text, SAFE_WIDTH);
    lineHeight = fontSize * 1.15; // line-height 115% (sedikit lebih rapat)
    const totalHeight = lines.length * lineHeight;

    if (totalHeight <= SAFE_HEIGHT) {
      return { fontSize, lines, lineHeight };
    }
    fontSize -= 2;
  }

  return { fontSize: 20, lines, lineHeight: 23 };
}

// Render teks ke canvas (left-aligned, top-aligned, blur kuat, noise burik)
function renderTextToCanvas(text) {
  const canvas = createCanvas(CANVAS_SIZE, CANVAS_SIZE);
  const ctx = canvas.getContext('2d');

  // Background putih
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  const lower = text.toLowerCase();
  const { fontSize, lines, lineHeight } = calculateOptimalFontSize(ctx, lower);

  // Set font
  ctx.font = `${fontSize}px "Arial Narrow", sans-serif`;
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  // Efek blur lebih kuat (2.4px)
  ctx.filter = 'blur(8.4px)';

  // Posisi Y awal: KIRI ATAS (bukan center)
  let startY = MARGIN;

  // Render tiap baris (left-aligned, top-aligned)
  for (const line of lines) {
    ctx.fillText(line, MARGIN, startY);
    startY += lineHeight;
  }

  // Reset filter
  ctx.filter = 'none';

  // Skipped noise/grain texture
  return canvas;
}

// Keep each request in memory: concurrent animations never share temporary files.
async function generateStaticBrat(value) {
  const canvas = renderTextToCanvas(validateText(value, 'Teks Brat', 300));
  return sharp(canvas.toBuffer('image/png')).webp({ quality: 85 }).toBuffer();
}

async function generateAnimatedBrat(value) {
  const words = validateText(value, 'Teks Brat', 300).toLowerCase().split(/\s+/);
  if (words.length > 30) throw new Error('Teks Brat maksimal 30 kata.');
  const frames = words.map((_, index) =>
    renderTextToCanvas(words.slice(0, index + 1).join(' ')).toBuffer('image/png'));
  const delay = Math.min(750, Math.floor(9000 / frames.length / 10) * 10);
  return sharp(frames, { join: { animated: true } })
    .webp({ quality: 80, loop: 0, delay: frames.map(() => delay) }).toBuffer();
}

module.exports = { generateStaticBrat, generateAnimatedBrat };
