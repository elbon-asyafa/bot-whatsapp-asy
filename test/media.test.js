const { test } = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { Image } = require('node-webpmux');
const { generateStaticBrat, generateAnimatedBrat } = require('../brat-advanced');
const { generateFakeChat } = require('../fakechat');
const { Sticker } = require('../lib/sticker');
const { addMemeText } = require('../lib/meme');

test('static Brat produces a real 512px WebP with pack metadata', async () => {
  const output = await new Sticker(await generateStaticBrat('tes linux mint')).toBuffer();
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, 'webp'); assert.equal(metadata.width, 512); assert.equal(metadata.height, 512);
  const image = new Image(); await image.load(output);
  assert.match(image.exif.toString(), /sticker-pack-name/);
});

test('parallel Brat animations preserve frames, delay and loop after sticker conversion', async () => {
  const animations = await Promise.all([generateAnimatedBrat('satu dua tiga'), generateAnimatedBrat('halo dunia')]);
  for (const [index, animation] of animations.entries()) {
    const result = await new Sticker(animation).toBuffer();
    const metadata = await sharp(result, { animated: true }).metadata();
    assert.equal(metadata.pages, index === 0 ? 3 : 2);
    assert.equal(metadata.pageHeight, 512); assert.equal(metadata.loop, 0);
    assert(metadata.delay.every(delay => delay === 750));
  }
});

test('fakechat renders bundled background, emoji and fonts to PNG', async () => {
  const metadata = await sharp(await generateFakeChat('halo dari Linux Mint | 21.30')).metadata();
  assert.equal(metadata.format, 'png'); assert.equal(metadata.width, 691); assert.equal(metadata.height, 1536);
});

test('meme text on a photograph converts to a valid sticker', async () => {
  const source = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#4682b4' } }).jpeg().toBuffer();
  const withText = await addMemeText(source, 'atas | bawah');
  const metadata = await sharp(await new Sticker(withText).toBuffer()).metadata();
  assert.equal(metadata.width, 512); assert.equal(metadata.height, 512);
});
