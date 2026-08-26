const path = require("path");
const { createCanvas, registerFont, loadImage } = require("canvas");

// ==================== FONT ====================
registerFont(path.join(__dirname, "fonts/sfprodisplayregular.otf"), {
  family: "SF Pro Display",
  weight: "400",
});

const FONT = "SF Pro Display";

// ==================== KONFIGURASI TAMPILAN ====================
// Ukuran mengikuti screenshot iPhone yang dipakai sebagai background.
const WIDTH = 691;
const HEIGHT = 1536;

const WARNA = {
  bubbleTeks: "#090909",
  bubbleWaktu: "#A6A6AD",
  bubbleMasuk: "rgba(255,255,255,0.96)",
  reaksiBar: "rgba(255,255,255,0.96)",
  menuCard: "rgba(248,248,247,0.94)",
  menuTeks: "#080808",
  menuHapus: "#FF3B30",
  menuDivider: "rgba(60,60,67,0.18)",
  ikon: "#111111",
};

const EMOJI_FILES = [
  "thumbup",
  "redheart",
  "facewithtearofjoy",
  "facewithopenmouth",
  "sadbutrelievedface",
  "foldedhands",
];

const MENU_ITEMS = [
  { label: "Beri Bintang", icon: "star" },
  { label: "Balas", icon: "reply" },
  { label: "Teruskan", icon: "forward" },
  { label: "Salin", icon: "copy" },
  { label: "Laporkan", icon: "report" },
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

// Bubble iOS dengan ekor kecil di kiri bawah.
function bubblePath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + 12, y + h);
  ctx.quadraticCurveTo(x + 2, y + h, x - 12, y + h + 8);
  ctx.quadraticCurveTo(x - 2, y + h - 3, x, y + h - 20);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// Background: foto asli yang di-cover-crop biar penuh isi canvas (mirip object-fit: cover di CSS)
let bgImageCache = null;
async function loadBgImage() {
  if (bgImageCache) return bgImageCache;
  bgImageCache = await loadImage(path.join(__dirname, "assets/bg.jpg"));
  return bgImageCache;
}

function gambarBackground(ctx, w, h, img) {
  ctx.drawImage(img, 0, 0, w, h);
}

// ==================== IKON MENU (vector, digambar manual) ====================

// Panah kurva dengan arrowhead yang ngikutin tangent kurva quadratic Bezier
// secara matematis (bukan kira-kira) — hasilnya jauh lebih rapi & simetris.
function drawCurvedArrow(ctx, cx, cy, s, color, mirror) {
  const m = mirror ? -1 : 1;
  ctx.strokeStyle = color;
  ctx.lineWidth = s * 0.07;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Badan panah melengkung, termasuk ujung pendek yang turun seperti ikon iOS.
  ctx.beginPath();
  ctx.moveTo(cx + m * s * 0.38, cy + s * 0.25);
  ctx.bezierCurveTo(
    cx + m * s * 0.36,
    cy - s * 0.12,
    cx + m * s * 0.1,
    cy - s * 0.3,
    cx - m * s * 0.24,
    cy - s * 0.16
  );
  ctx.stroke();

  // Arrowhead outline.
  const tipX = cx - m * s * 0.38;
  const tipY = cy - s * 0.16;
  ctx.beginPath();
  ctx.moveTo(tipX + m * s * 0.2, tipY - s * 0.19);
  ctx.lineTo(tipX, tipY);
  ctx.lineTo(tipX + m * s * 0.2, tipY + s * 0.19);
  ctx.stroke();
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
  ctx.fillStyle = WARNA.menuCard;
  roundedRectPath(ctx, cx - s * 0.4, cy - s * 0.2, s * 0.55, s * 0.68, s * 0.06);
  ctx.fill();
  ctx.stroke();
}

function iconReport(ctx, cx, cy, s, color) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = s * 0.065;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  ctx.beginPath();
  ctx.moveTo(cx, cy - s * 0.46);
  ctx.lineTo(cx + s * 0.43, cy + s * 0.36);
  ctx.lineTo(cx - s * 0.43, cy + s * 0.36);
  ctx.closePath();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx, cy - s * 0.19);
  ctx.lineTo(cx, cy + s * 0.1);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy + s * 0.24, s * 0.035, 0, Math.PI * 2);
  ctx.fill();
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

const ICON_FN = {
  reply: iconReply,
  forward: iconForward,
  copy: iconCopy,
  star: iconStar,
  report: iconReport,
  trash: iconTrash,
};

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
  mctx.font = `30px "${FONT}"`;

  const BUBBLE_MAX_WIDTH = 475;
  const BUBBLE_PADDING_X = 20;
  const LINE_HEIGHT = 38;
  const maxTextWidth = BUBBLE_MAX_WIDTH - BUBBLE_PADDING_X * 2;
  const lines = wrapText(mctx, isi, maxTextWidth);
  const textWidth = Math.max(...lines.map((l) => mctx.measureText(l).width), 40);
  const bubbleWidth = Math.min(BUBBLE_MAX_WIDTH, Math.max(230, textWidth + BUBBLE_PADDING_X * 2 + 64));
  const bubbleHeight = lines.length * LINE_HEIGHT + 60;

  const REAKSI_H = 106;
  const GAP_REAKSI_BUBBLE = 22;
  const GAP_BUBBLE_MENU = 23;
  const MENU_ITEM_H = 85;
  const MENU_H = MENU_ITEM_H * MENU_ITEMS.length;

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  gambarBackground(ctx, WIDTH, HEIGHT, bgImage);

  const menuX = 29;
  const menuY = HEIGHT - 59 - MENU_H;
  const menuW = 474;
  const bubbleX = 29;
  const bubbleY = menuY - GAP_BUBBLE_MENU - bubbleHeight;
  const reaksiMarginX = 29;
  const reaksiY = bubbleY - GAP_REAKSI_BUBBLE - REAKSI_H;
  const reaksiW = 585;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.08)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = WARNA.reaksiBar;
  roundedRectPath(ctx, reaksiMarginX, reaksiY, reaksiW, REAKSI_H, REAKSI_H / 2);
  ctx.fill();
  ctx.restore();

  const slotCount = EMOJI_FILES.length + 1;
  const slotW = reaksiW / slotCount;
  const emojiSize = 55;
  EMOJI_FILES.forEach((name, i) => {
    const cx = reaksiMarginX + slotW * i + slotW / 2;
    const cy = reaksiY + REAKSI_H / 2;
    ctx.drawImage(emojis[name], cx - emojiSize / 2, cy - emojiSize / 2, emojiSize, emojiSize);
  });
  const plusCx = reaksiMarginX + slotW * EMOJI_FILES.length + slotW / 2;
  const plusCy = reaksiY + REAKSI_H / 2;
  ctx.fillStyle = "#EFEFF1";
  ctx.beginPath();
  ctx.arc(plusCx, plusCy, 35, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#555555";
  ctx.lineWidth = 3.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(plusCx - 14, plusCy);
  ctx.lineTo(plusCx + 14, plusCy);
  ctx.moveTo(plusCx, plusCy - 14);
  ctx.lineTo(plusCx, plusCy + 14);
  ctx.stroke();

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.06)";
  ctx.shadowBlur = 5;
  ctx.shadowOffsetY = 1;
  ctx.fillStyle = WARNA.bubbleMasuk;
  bubblePath(ctx, bubbleX, bubbleY, bubbleWidth, bubbleHeight, 18);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = WARNA.bubbleTeks;
  ctx.font = `30px "${FONT}"`;
  ctx.textBaseline = "top";
  let ty = bubbleY + 14;
  for (const line of lines) {
    ctx.fillText(line, bubbleX + BUBBLE_PADDING_X, ty);
    ty += LINE_HEIGHT;
  }
  ctx.fillStyle = WARNA.bubbleWaktu;
  ctx.font = `20px "${FONT}"`;
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(waktu, bubbleX + bubbleWidth - 17, bubbleY + bubbleHeight - 14);
  ctx.textAlign = "left";

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.08)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = WARNA.menuCard;
  roundedRectPath(ctx, menuX, menuY, menuW, MENU_H, 27);
  ctx.fill();
  ctx.restore();

  for (const [index, item] of MENU_ITEMS.entries()) {
    const iy = menuY + index * MENU_ITEM_H;
    const iconCx = menuX + menuW - 53;
    const iconCy = iy + MENU_ITEM_H / 2;
    const warnaItem = item.merah ? WARNA.menuHapus : WARNA.ikon;
    ICON_FN[item.icon](ctx, iconCx, iconCy, 38, warnaItem);

    ctx.fillStyle = item.merah ? WARNA.menuHapus : WARNA.menuTeks;
    ctx.font = `31px "${FONT}"`;
    ctx.textBaseline = "middle";
    ctx.fillText(item.label, menuX + 30, iconCy + 1);
    ctx.textBaseline = "alphabetic";

    if (index < MENU_ITEMS.length - 1) {
      ctx.strokeStyle = WARNA.menuDivider;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(menuX, iy + MENU_ITEM_H);
      ctx.lineTo(menuX + menuW, iy + MENU_ITEM_H);
      ctx.stroke();
    }
  }

  return canvas.toBuffer("image/png");
}

module.exports = { generateFakeChat };
