const { createCanvas, registerFont } = require('canvas');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
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

// Tambahkan noise/grain texture yang lebih burik
function addNoiseTexture(ctx) {
  const imageData = ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  const data = imageData.data;
  
  for (let i = 0; i < data.length; i += 4) {
    const noise = Math.random() * 140 - 70; // noise -70 sampai +70
    data[i] = Math.min(255, Math.max(0, data[i] + noise));     // R
    data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise)); // G
    data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise)); // B
  }
  
  ctx.putImageData(imageData, 0, 0);
}

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

// Generate static brat sticker (WebP)
async function generateStaticBrat(text) {
  const canvas = renderTextToCanvas(text);
  const buffer = canvas.toBuffer('image/png');

  // Convert PNG ke WebP via sharp
  try {
    const sharp = require('sharp');
    return await sharp(buffer)
      .webp({ quality: 90 })
      .resize(512, 512, { fit: 'fill' })
      .toBuffer();
  } catch (e) {
    return buffer;
  }
}

// Generate animated brat sticker (WebP animasi kata per kata)
async function generateAnimatedBrat(text) {
  const words = text.toLowerCase().split(/\s+/);
  const tempDir = path.join(__dirname, 'temp');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

  const frameFiles = [];

  // Render frame per frame (kata bertambah)
  for (let i = 0; i < words.length; i++) {
    const partialText = words.slice(0, i + 1).join(' ');
    const canvas = renderTextToCanvas(partialText);
    const framePath = path.join(tempDir, `brat_frame_${String(i).padStart(3, '0')}.png`);
    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(framePath, buffer);
    frameFiles.push(framePath);
  }

  // Buat file concat list untuk ffmpeg
  const concatListPath = path.join(tempDir, `concat_${Date.now()}.txt`);
  const concatContent = frameFiles
    .map((f) => `file '${f.replace(/'/g, "'\\''")}'\nduration 0.75`)
    .join('\n') + '\n';
  fs.writeFileSync(concatListPath, concatContent);
  const lastFrame = frameFiles[frameFiles.length - 1].replace(/'/g, "'\\''");
  // Repeat last frame tanpa durasi ekstra: ini cuma trik ffmpeg agar durasi frame terakhir ikut terbaca.
  fs.appendFileSync(concatListPath, `file '${lastFrame}'\n`);

  // Gabungkan frame jadi WebP animasi dengan ffmpeg (concat demuxer)
  const outputPath = path.join(tempDir, `brat_anim_${Date.now()}.webp`);

  return new Promise((resolve, reject) => {
    const cmd = ffmpeg()
      .input(concatListPath)
      .inputOptions(['-f concat', '-safe 0'])
      .outputOptions([
        '-vcodec libwebp',
        '-lossless 0',
        '-q:v 80',
        '-loop 0',
        '-vf scale=512:512',
        '-preset default',
        '-an',
      ])
      .output(outputPath)
      .on('end', () => {
        const buffer = fs.readFileSync(outputPath);
        
        // Cleanup
        frameFiles.forEach((f) => { try { fs.unlinkSync(f); } catch (_) {} });
        try { fs.unlinkSync(concatListPath); } catch (_) {}
        try { fs.unlinkSync(outputPath); } catch (_) {}

        resolve(buffer);
      })
      .on('error', (err) => {
        frameFiles.forEach((f) => { try { fs.unlinkSync(f); } catch (_) {} });
        try { fs.unlinkSync(concatListPath); } catch (_) {}
        reject(err);
      })
      .run();
  });
}

module.exports = {
  generateStaticBrat,
  generateAnimatedBrat,
};
