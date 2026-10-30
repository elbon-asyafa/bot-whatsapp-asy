const sharp = require('sharp');
const { Image } = require('node-webpmux');

class Sticker {
  constructor(buffer, options = {}) { this.buffer = buffer; this.options = options; }
  async toBuffer() {
    const image = new Image();
    await image.load(await sharp(this.buffer, { animated: true, limitInputPixels: 25000000 })
      .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: this.options.quality || 80 }).toBuffer());
    const metadata = Buffer.from(JSON.stringify({
      'sticker-pack-id': 'bot-whatsapp-asy',
      'sticker-pack-name': this.options.pack || 'raiasy-bot 2026©',
      'sticker-pack-publisher': this.options.author || 'Asy',
      emojis: [''],
    }));
    const header = Buffer.from('49492a00080000000100415707000000000016000000', 'hex');
    header.writeUInt32LE(metadata.length, 14);
    image.exif = Buffer.concat([header, metadata]);
    return image.save(null);
  }
}
module.exports = { Sticker };
