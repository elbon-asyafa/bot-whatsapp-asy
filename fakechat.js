const path = require("path");
const { createCanvas, registerFont, loadImage } = require("canvas");

// ==================== FONT ====================
registerFont(path.join(__dirname, "fonts/sfprodisplayregular.otf"), {
  family: "SF Pro Display",
  weight: "400",
});

const FONT = "SF Pro Display";

// ==================== KONFIGURASI TAMPILAN ====================
const WIDTH = 720;
const HEIGHT = Math.round((WIDTH * 16) / 9); // rasio 9:16

const WARNA = {
  bubbleTeks: "#111111",
  bubbleWaktu: "#8696A0",
  bubbleMasuk: "#FFFFFF",
  reaksiBar: "#FDFDFD",
  menuCard: "#EDE6E5",
  menuTeks: "#1C1C1C",
  menuHapus: "#D8433A",
  menuDivider: "#D9D1CF",
  ikon: "#3C3C3C",
};

const EMOJI_FILES = [
  "thumbup",
  "redheart",
  "facewithtearofjoy",
  "facewithopenmouth",
  "sadbutrelievedface",
  "foldedhands",
  "coldface",
];

const MENU_ITEMS = [
  { label: "Balas", icon: "reply" },
  { label: "Teruskan", icon: "forward" },
  { label: "Salin", icon: "copy" },
  { label: "Beri bintang", icon: "star" },
  { label: "Hapus", icon: "trash", merah: true },
];

// ==================== UTIL ====================

function wrapText(ctx, text, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let current = "";
  for (const word of words) {
    const test = current ? current + " " + word : word;
    if (ctx.measureText(test).width <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function roundedRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Bubble WA punya sudut lebih tajam di satu pojok (sisi "ekor") — bukan rounded rect polos
function bubblePath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + 4);
  ctx.quadraticCurveTo(x, y, x - 2, y); // sudut kiri-atas nyaris lancip, khas bubble "masuk"
  ctx.lineTo(x + r, y);
  ctx.closePath();
}

function softBlob(ctx, x, y, r, color) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

// Background: foto asli yang di-cover-crop biar penuh isi canvas (mirip object-fit: cover di CSS)
let bgImageCache = null;
async function loadBgImage() {
  if (bgImageCache) return bgImageCache;
  bgImageCache = await loadImage(path.join(__dirname, "assets/bg.jpg"));
  return bgImageCache;
}

function gambarBackground(ctx, w, h, img) {
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  const dx = (w - dw) / 2;
  const dy = (h - dh) / 2;
  ctx.drawImage(img, dx, dy, dw, dh);
}

// ==================== IKON MENU (vector, digambar manual) ====================

// Panah kurva dengan arrowhead yang ngikutin tangent kurva quadratic Bezier
// secara matematis (bukan kira-kira) — hasilnya jauh lebih rapi & simetris.
function drawCurvedArrow(ctx, cx, cy, s, color, mirror) {
  const m = mirror ? -1 : 1;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = s * 0.12;
  ctx.lineCap = "round";

  const p0x = cx + m * s * 0.34, p0y = cy + s * 0.08;
  const p1x = cx - m * s * 0.02, p1y = cy - s * 0.36;
  const p2x = cx - m * s * 0.34, p2y = cy + s * 0.02;

  ctx.beginPath();
  ctx.moveTo(p0x, p0y);
  ctx.quadraticCurveTo(p1x, p1y, p2x, p2y);
  ctx.stroke();

  // Tangent kurva di titik akhir (t=1) = arah (p2 - p1), dinormalisasi
  let dx = p2x - p1x, dy = p2y - p1y;
  const len = Math.hypot(dx, dy);
  dx /= len; dy /= len;
  const nx = -dy, ny = dx; // normal, buat lebar arrowhead

  const headLen = s * 0.34;
  const headWidth = s * 0.22;
  const tipX = p2x + dx * headLen * 0.55;
  const tipY = p2y + dy * headLen * 0.55;
  const backX = tipX - dx * headLen;
  const backY = tipY - dy * headLen;

  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(backX + nx * headWidth, backY + ny * headWidth);
  ctx.lineTo(backX - nx * headWidth, backY - ny * headWidth);
  ctx.closePath();
  ctx.fill();
}

function iconReply(ctx, cx, cy, s, color) {
  drawCurvedArrow(ctx, cx, cy, s, color, false);
}

function iconForward(ctx, cx, cy, s, color) {
  drawCurvedArrow(ctx, cx, cy, s, color, true);
}

function iconCopy(ctx, cx, cy, s, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = s * 0.07;
  ctx.lineJoin = "round";
  roundedRectPath(ctx, cx - s * 0.15, cy - s * 0.42, s * 0.55, s * 0.68, s * 0.06);
  ctx.stroke();
  ctx.fillStyle = "#FFFFFF";
  roundedRectPath(ctx, cx - s * 0.4, cy - s * 0.2, s * 0.55, s * 0.68, s * 0.06);
  ctx.fill();
  ctx.stroke();
}

function iconStar(ctx, cx, cy, s, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = s * 0.07;
  ctx.lineJoin = "round";
  const spikes = 5;
  const outerR = s * 0.48;
  const innerR = s * 0.2;
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = (Math.PI / spikes) * i - Math.PI / 2;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();
}

function iconTrash(ctx, cx, cy, s, color) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = s * 0.08;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.32, cy - s * 0.28);
  ctx.lineTo(cx + s * 0.32, cy - s * 0.28);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.12, cy - s * 0.4);
  ctx.lineTo(cx + s * 0.12, cy - s * 0.4);
  ctx.stroke();
  roundedRectPath(ctx, cx - s * 0.26, cy - s * 0.2, s * 0.52, s * 0.55, s * 0.05);
  ctx.stroke();
  ctx.lineWidth = s * 0.05;
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.1, cy - s * 0.05);
  ctx.lineTo(cx - s * 0.1, cy + s * 0.25);
  ctx.moveTo(cx + s * 0.1, cy - s * 0.05);
  ctx.lineTo(cx + s * 0.1, cy + s * 0.25);
  ctx.stroke();
}

function iconMore(ctx, cx, cy, s, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = s * 0.07;
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.42, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = color;
  for (const dx of [-s * 0.16, 0, s * 0.16]) {
    ctx.beginPath();
    ctx.arc(cx + dx, cy, s * 0.05, 0, Math.PI * 2);
    ctx.fill();
  }
}

const ICON_FN = { reply: iconReply, forward: iconForward, copy: iconCopy, star: iconStar, trash: iconTrash, more: iconMore };

// ==================== PARSE 1 PESAN ====================

function parseSatuPesan(script) {
  const baris = script.split("\n").map((l) => l.trim()).filter(Boolean);
  const l = baris[0] || "";
  let isi = l[0] === "<" || l[0] === ">" ? l.slice(1).trim() : l.trim();
  let waktu = "01.46";
  const match = isi.match(/\|\s*([0-9]{1,2}[.:][0-9]{2})\s*$/);
  if (match) {
    waktu = match[1].replace(":", ".");
    isi = isi.slice(0, match.index).trim();
  }
  return { isi, waktu };
}

let emojiCache = null;
async function loadEmojis() {
  if (emojiCache) return emojiCache;
  emojiCache = {};
  for (const name of EMOJI_FILES) {
    emojiCache[name] = await loadImage(path.join(__dirname, "assets/emoji", name + ".png"));
  }
  return emojiCache;
}

// ==================== GENERATOR UTAMA ====================

async function generateFakeChat(script) {
  const { isi, waktu } = parseSatuPesan(script);
  if (!isi) throw new Error("Teks pesan kosong.");

  const emojis = await loadEmojis();
  const bgImage = await loadBgImage();

  const measureCanvas = createCanvas(WIDTH, 100);
  const mctx = measureCanvas.getContext("2d");
  mctx.font = `28px "${FONT}"`;

  const BUBBLE_MAX_WIDTH = Math.floor(WIDTH * 0.78);
  const BUBBLE_PADDING = 18;
  const LINE_HEIGHT = 34;
  const maxTextWidth = BUBBLE_MAX_WIDTH - BUBBLE_PADDING * 2 - 60;
  const lines = wrapText(mctx, isi, maxTextWidth);
  const textWidth = Math.max(...lines.map((l) => mctx.measureText(l).width), 40);
  const bubbleWidth = Math.min(BUBBLE_MAX_WIDTH, textWidth + BUBBLE_PADDING * 2 + 60);
  const bubbleHeight = lines.length * LINE_HEIGHT + BUBBLE_PADDING * 2 + 14;

  const REAKSI_H = 88;
  const GAP_1 = 24;
  const GAP_2 = 22;
  const MENU_ITEM_H = 78;
  const MENU_PAD_V = 14;
  const DIVIDER_GAP = 16;
  const MENU_H = MENU_ITEM_H * MENU_ITEMS.length + DIVIDER_GAP + MENU_ITEM_H + MENU_PAD_V * 2;

  const kontenHeight = REAKSI_H + GAP_1 + bubbleHeight + GAP_2 + MENU_H;
  // Sisa tinggi (di luar konten) dibagi atas-bawah, biar total tetap 9:16 persis
  const sisaHeight = Math.max(0, HEIGHT - kontenHeight);
  const TOP_BLUR = Math.round(sisaHeight * 0.35) + 30;

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  gambarBackground(ctx, WIDTH, HEIGHT, bgImage);

  const reaksiY = TOP_BLUR;
  const reaksiMarginX = 20;
  const reaksiW = WIDTH - reaksiMarginX * 2;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.25)";
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = WARNA.reaksiBar;
  roundedRectPath(ctx, reaksiMarginX, reaksiY, reaksiW, REAKSI_H, REAKSI_H / 2);
  ctx.fill();
  ctx.restore();

  const slotCount = EMOJI_FILES.length + 1;
  const slotW = reaksiW / slotCount;
  const emojiSize = REAKSI_H * 0.58;
  EMOJI_FILES.forEach((name, i) => {
    const cx = reaksiMarginX + slotW * i + slotW / 2;
    const cy = reaksiY + REAKSI_H / 2;
    ctx.drawImage(emojis[name], cx - emojiSize / 2, cy - emojiSize / 2, emojiSize, emojiSize);
  });
  const plusCx = reaksiMarginX + slotW * EMOJI_FILES.length + slotW / 2;
  const plusCy = reaksiY + REAKSI_H / 2;
  ctx.fillStyle = "#EDEDED";
  ctx.beginPath();
  ctx.arc(plusCx, plusCy, REAKSI_H * 0.32, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#555555";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(plusCx - 12, plusCy);
  ctx.lineTo(plusCx + 12, plusCy);
  ctx.moveTo(plusCx, plusCy - 12);
  ctx.lineTo(plusCx, plusCy + 12);
  ctx.stroke();

  const bubbleY = reaksiY + REAKSI_H + GAP_1;
  const bubbleX = reaksiMarginX;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.15)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = WARNA.bubbleMasuk;
  bubblePath(ctx, bubbleX, bubbleY, bubbleWidth, bubbleHeight, 16);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = WARNA.bubbleTeks;
  ctx.font = `28px "${FONT}"`;
  let ty = bubbleY + BUBBLE_PADDING + 22;
  for (const line of lines) {
    ctx.fillText(line, bubbleX + BUBBLE_PADDING, ty);
    ty += LINE_HEIGHT;
  }
  ctx.fillStyle = WARNA.bubbleWaktu;
  ctx.font = `18px "${FONT}"`;
  ctx.textAlign = "right";
  ctx.fillText(waktu, bubbleX + bubbleWidth - BUBBLE_PADDING, bubbleY + bubbleHeight - 14);
  ctx.textAlign = "left";

  const menuY = bubbleY + bubbleHeight + GAP_2;
  const menuX = reaksiMarginX;
  const menuW = Math.floor(WIDTH * 0.72);
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.2)";
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = WARNA.menuCard;
  roundedRectPath(ctx, menuX, menuY, menuW, MENU_H, 22);
  ctx.fill();
  ctx.restore();

  let iy = menuY + MENU_PAD_V;
  for (const item of MENU_ITEMS) {
    const iconCx = menuX + 50;
    const iconCy = iy + MENU_ITEM_H / 2;
    const warnaItem = item.merah ? WARNA.menuHapus : WARNA.ikon;
    ICON_FN[item.icon](ctx, iconCx, iconCy, 40, warnaItem);

    ctx.fillStyle = item.merah ? WARNA.menuHapus : WARNA.menuTeks;
    ctx.font = `30px "${FONT}"`;
    ctx.textBaseline = "middle";
    ctx.fillText(item.label, menuX + 96, iconCy + 1);
    ctx.textBaseline = "alphabetic";

    iy += MENU_ITEM_H;
  }

  ctx.strokeStyle = WARNA.menuDivider;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(menuX + 24, iy + DIVIDER_GAP / 2);
  ctx.lineTo(menuX + menuW - 24, iy + DIVIDER_GAP / 2);
  ctx.stroke();
  iy += DIVIDER_GAP;

  const moreCx = menuX + 50;
  const moreCy = iy + MENU_ITEM_H / 2;
  iconMore(ctx, moreCx, moreCy, 40, WARNA.ikon);
  ctx.fillStyle = WARNA.menuTeks;
  ctx.font = `30px "${FONT}"`;
  ctx.textBaseline = "middle";
  ctx.fillText("Lainnya...", menuX + 96, moreCy + 1);
  ctx.textBaseline = "alphabetic";

  return canvas.toBuffer("image/png");
}

module.exports = { generateFakeChat };
