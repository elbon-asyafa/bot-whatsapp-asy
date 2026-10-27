const { createCanvas, loadImage } = require('canvas');
const sharp = require('sharp');

async function addMemeText(buffer, input) {
  const png = await sharp(buffer, { limitInputPixels: 25000000 }).rotate().resize({ width: 512, height: 512, fit: 'inside' }).png().toBuffer();
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const [above, ...below] = input.split('|');
  const top = below.length ? above.trim() : '';
  const bottom = below.length ? below.join('|').trim() : above.trim();
  function draw(value, y, baseline) {
    if (!value) return;
    let size = 48;
    do { ctx.font = `bold ${size}px sans-serif`; if (ctx.measureText(value.toUpperCase()).width <= image.width - 20) break; size--; } while (size > 12);
    ctx.textAlign = 'center'; ctx.textBaseline = baseline;
    ctx.lineWidth = 4; ctx.strokeStyle = '#000'; ctx.fillStyle = '#fff';
    ctx.strokeText(value.toUpperCase(), image.width / 2, y, image.width - 20);
    ctx.fillText(value.toUpperCase(), image.width / 2, y, image.width - 20);
  }
  draw(top, 10, 'top'); draw(bottom, image.height - 10, 'bottom');
  return canvas.toBuffer('image/png');
}
module.exports = { addMemeText };
