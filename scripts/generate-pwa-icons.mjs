#!/usr/bin/env node
// =============================================================================
// Generates ARC's PWA / home-screen icons from the Altronic spark mark
// (the same path as src/components/brand/Brandmark.tsx and public/favicon.svg).
//
// Without a manifest declaring real icons, "Install app" / "Add to Home
// Screen" falls back to a browser-generated placeholder — a flat colour
// square with the site's first letter. That's the "plain A" icon this fixes.
//
// Two variants, both Cooper Red (#CB2C30) background with the mark in white:
//   - "plain"     — mark fills ~70% of the canvas. Used for the favicon PNGs,
//                   the apple-touch-icon, and the manifest's "any" icons.
//   - "maskable"  — mark fills ~50% of the canvas, keeping it inside the
//                   ~80% "safe zone" Android's adaptive-icon mask can crop to
//                   any shape without clipping the glyph.
//
// Re-run this whenever the brand mark itself changes:
//   node scripts/generate-pwa-icons.mjs
// =============================================================================

import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "public", "icons");

const COOPER_RED = "#CB2C30";
const WHITE = "#FFFFFF";

// The spark mark's own path data + native viewBox size (public/favicon.svg).
const MARK_PATH =
  "M367.48,2024.44c284.37-291.29,635.14-650.77,635.14-650.77H466l6.45-14.42c5.6-11.88,11.19-23.58,16.45-35.46L671.46,903.23,884.54,410.05l389,900.34L1405,1595.06l276.19,611.6H2000s-39.36-86.52-102.47-225.47C1642.54,1419,998,0,998,0H764.6L353,913.4a17.92,17.92,0,0,0-2.88,5.26,22,22,0,0,0-1.7,4.41C341,941.23,330.12,963.79,321.13,984c-3.23,6.62-6.79,13.4-9.16,19.34-43.6,97.72-88.05,196.29-132,293.84-43.77,97.89-87.37,195.44-131.48,291.12L24.92,1640.7H344.71L173.14,2025.43,0,2411Z";
const MARK_W = 2000;
const MARK_H = 2410.95;

// A single square reference canvas — sharp rasterizes this same vector markup
// at whatever pixel size .resize() asks for, so one string per variant covers
// every output size.
const CANVAS = 512;

/** contentFraction: how much of the canvas' shorter side the mark's height fills. */
function buildSvg(contentFraction) {
  const targetH = CANVAS * contentFraction;
  const scale = targetH / MARK_H;
  const renderedW = MARK_W * scale;
  const x = (CANVAS - renderedW) / 2;
  const y = (CANVAS - targetH) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}">
  <rect width="${CANVAS}" height="${CANVAS}" fill="${COOPER_RED}"/>
  <g transform="translate(${x}, ${y}) scale(${scale})">
    <path fill="${WHITE}" d="${MARK_PATH}"/>
  </g>
</svg>`;
}

const PLAIN_SVG = buildSvg(0.7);
const MASKABLE_SVG = buildSvg(0.5);

async function renderPng(svg, size, filename) {
  const buf = Buffer.from(svg);
  await sharp(buf, { density: (72 * size) / CANVAS })
    .resize(size, size)
    .png()
    .toFile(join(OUT_DIR, filename));
  console.log(`  wrote icons/${filename} (${size}x${size})`);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  console.log("Plain (favicon / apple-touch / \"any\" manifest icons):");
  await renderPng(PLAIN_SVG, 16, "favicon-16.png");
  await renderPng(PLAIN_SVG, 32, "favicon-32.png");
  await renderPng(PLAIN_SVG, 180, "apple-touch-icon.png");
  await renderPng(PLAIN_SVG, 192, "icon-192.png");
  await renderPng(PLAIN_SVG, 512, "icon-512.png");

  console.log("Maskable (Android adaptive icon safe zone):");
  await renderPng(MASKABLE_SVG, 192, "icon-192-maskable.png");
  await renderPng(MASKABLE_SVG, 512, "icon-512-maskable.png");

  console.log("\nDone. See public/manifest.webmanifest for how these are wired up.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
