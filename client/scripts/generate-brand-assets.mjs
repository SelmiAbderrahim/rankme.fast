import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { deflateSync } from 'node:zlib';
import { chromium } from 'playwright';

const ROOT = new URL('../public/', import.meta.url);

const BRAND = {
  name: 'RankMeFast',
  domain: 'rankme.fast',
  tagline: 'Plain-language SEO and AI-answer-engine audits.',
  primary: '#2563eb',
  primaryRgb: [37, 99, 235, 255],
  foreground: '#1a1a1a',
  muted: '#6b7280',
  border: '#e5e7eb',
  accent: '#eff4ff',
  white: '#ffffff',
  whiteRgb: [255, 255, 255, 255],
};

const COLORS = {
  blue: BRAND.primaryRgb,
  white: BRAND.whiteRgb,
  blueSoft: [191, 219, 254, 255],
};

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  typeBuffer.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return out;
}

function createCanvas(width, height) {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  };
}

function setPixel(canvas, x, y, color) {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
  const index = (y * canvas.width + x) * 4;
  canvas.data[index] = color[0];
  canvas.data[index + 1] = color[1];
  canvas.data[index + 2] = color[2];
  canvas.data[index + 3] = color[3];
}

function fillRoundedRect(canvas, x, y, width, height, radius, color) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.ceil(x + width);
  const y1 = Math.ceil(y + height);
  const r = Math.max(0, radius);
  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) {
      const cx = px < x + r ? x + r : px > x + width - r ? x + width - r : px;
      const cy = py < y + r ? y + r : py > y + height - r ? y + height - r : py;
      if ((px - cx) ** 2 + (py - cy) ** 2 <= r ** 2) {
        setPixel(canvas, px, py, color);
      }
    }
  }
}

function strokeLine(canvas, x1, y1, x2, y2, width, color) {
  const radius = width / 2;
  const minX = Math.floor(Math.min(x1, x2) - radius);
  const maxX = Math.ceil(Math.max(x1, x2) + radius);
  const minY = Math.floor(Math.min(y1, y2) - radius);
  const maxY = Math.ceil(Math.max(y1, y2) + radius);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy || 1;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lenSq));
      const px = x1 + t * dx;
      const py = y1 + t * dy;
      if ((x - px) ** 2 + (y - py) ** 2 <= radius ** 2) {
        setPixel(canvas, x, y, color);
      }
    }
  }
}

function renderMark(size) {
  const scale = 4;
  const canvas = createCanvas(size * scale, size * scale);
  const s = (size * scale) / 64;
  const drawRoundedRect = (x, y, width, height, radius, color) =>
    fillRoundedRect(canvas, x * s, y * s, width * s, height * s, radius * s, color);
  const drawLine = (x1, y1, x2, y2, width, color) =>
    strokeLine(canvas, x1 * s, y1 * s, x2 * s, y2 * s, width * s, color);

  drawRoundedRect(0, 0, 64, 64, 14, COLORS.blue);
  drawLine(16, 18, 30, 18, 4, COLORS.white);
  drawLine(16, 25, 25, 25, 4, COLORS.white);
  drawRoundedRect(17, 39, 8, 10, 2.5, COLORS.blueSoft);
  drawRoundedRect(29, 31, 8, 18, 2.5, COLORS.white);
  drawRoundedRect(41, 22, 8, 27, 2.5, COLORS.white);

  return downsample(canvas, size, size, scale);
}

function downsample(source, width, height, scale) {
  const canvas = createCanvas(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const totals = [0, 0, 0, 0];
      for (let sy = 0; sy < scale; sy += 1) {
        for (let sx = 0; sx < scale; sx += 1) {
          const index = ((y * scale + sy) * source.width + x * scale + sx) * 4;
          totals[0] += source.data[index];
          totals[1] += source.data[index + 1];
          totals[2] += source.data[index + 2];
          totals[3] += source.data[index + 3];
        }
      }
      setPixel(
        canvas,
        x,
        y,
        totals.map((value) => Math.round(value / (scale * scale))),
      );
    }
  }
  return canvas;
}

function pngBuffer(canvas) {
  const raw = Buffer.alloc((canvas.width * 4 + 1) * canvas.height);
  for (let y = 0; y < canvas.height; y += 1) {
    const rowOffset = y * (canvas.width * 4 + 1);
    raw[rowOffset] = 0;
    Buffer.from(canvas.data.slice(y * canvas.width * 4, (y + 1) * canvas.width * 4)).copy(
      raw,
      rowOffset + 1,
    );
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(canvas.width, 0);
  ihdr.writeUInt32BE(canvas.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND'),
  ]);
}

function writePng(relativePath, canvas) {
  const url = new URL(relativePath, ROOT);
  mkdirSync(dirname(url.pathname), { recursive: true });
  writeFileSync(url, pngBuffer(canvas));
}

function writeText(relativePath, value) {
  const url = new URL(relativePath, ROOT);
  mkdirSync(dirname(url.pathname), { recursive: true });
  writeFileSync(url, value);
}

function markPaths({ primary = BRAND.primary, foreground = BRAND.white } = {}) {
  return `
  <rect width="64" height="64" rx="14" fill="${primary}"/>
  <path d="M16 18h14M16 25h9" fill="none" stroke="${foreground}" stroke-width="4" stroke-linecap="round"/>
  <rect x="17" y="39" width="8" height="10" rx="2.5" fill="#bfdbfe"/>
  <rect x="29" y="31" width="8" height="18" rx="2.5" fill="${foreground}"/>
  <rect x="41" y="22" width="8" height="27" rx="2.5" fill="${foreground}"/>`;
}

function markSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-labelledby="title">
  <title id="title">${BRAND.name} mark</title>${markPaths()}
</svg>
`;
}

function logoSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 292 64" role="img" aria-labelledby="title">
  <title id="title">${BRAND.name}</title>
  <g>${markPaths()}</g>
  <text x="78" y="42" fill="${BRAND.foreground}" font-family="Inter, system-ui, -apple-system, Segoe UI, sans-serif" font-size="30" font-weight="800">${BRAND.name}</text>
</svg>
`;
}

function safariPinnedTabSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <path d="M16 18h14M16 25h9" fill="none" stroke="#000" stroke-width="4" stroke-linecap="round"/>
  <rect x="17" y="39" width="8" height="10" rx="2.5"/>
  <rect x="29" y="31" width="8" height="18" rx="2.5"/>
  <rect x="41" y="22" width="8" height="27" rx="2.5"/>
</svg>
`;
}

function siteManifest() {
  return `${JSON.stringify(
    {
      name: BRAND.name,
      short_name: BRAND.name,
      description:
        'Plain-language SEO and AI-answer-engine audits for rank tracking and site fixes.',
      icons: [
        {
          src: '/icons/icon-192.png',
          sizes: '192x192',
          type: 'image/png',
          purpose: 'any',
        },
        {
          src: '/icons/icon-512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'any',
        },
        {
          src: '/icons/icon-512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable',
        },
      ],
      theme_color: BRAND.primary,
      background_color: BRAND.white,
      display: 'standalone',
    },
    null,
    2,
  )}\n`;
}

function htmlEscape(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function ogHtml() {
  const backdrop = new URL('og/rankmefast-backdrop.png', ROOT);
  const backdropUrl = existsSync(backdrop.pathname)
    ? `data:image/png;base64,${readFileSync(backdrop.pathname).toString('base64')}`
    : '';
  const backdropImage = backdropUrl
    ? `<img class="backdrop" src="${backdropUrl}" alt="" aria-hidden="true" />`
    : '';

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: ${BRAND.white};
        color: ${BRAND.foreground};
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .frame {
        position: relative;
        width: 1200px;
        height: 630px;
        overflow: hidden;
        background: ${BRAND.white};
      }
      .backdrop {
        position: absolute;
        inset: 0;
        width: 1200px;
        height: 630px;
        object-fit: cover;
      }
      .panel {
        position: absolute;
        inset: 0 auto 0 0;
        width: 575px;
        background: rgba(255, 255, 255, 0.92);
        border-right: 1px solid ${BRAND.border};
      }
      .content {
        position: relative;
        width: 560px;
        padding: 56px 0 0 72px;
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 18px;
        color: ${BRAND.foreground};
        font-size: 34px;
        font-weight: 800;
        line-height: 1;
      }
      .brand svg {
        width: 56px;
        height: 56px;
        flex: none;
      }
      h1 {
        margin: 48px 0 0;
        width: 500px;
        font-size: 54px;
        line-height: 1.03;
        font-weight: 850;
      }
      p {
        margin: 24px 0 0;
        width: 455px;
        color: ${BRAND.muted};
        font-size: 23px;
        line-height: 1.34;
        font-weight: 500;
      }
      .domain {
        display: inline-flex;
        align-items: center;
        margin-top: 32px;
        padding: 13px 18px;
        border: 1px solid ${BRAND.border};
        border-radius: 999px;
        color: ${BRAND.primary};
        background: ${BRAND.accent};
        font-size: 23px;
        font-weight: 750;
      }
    </style>
  </head>
  <body>
    <div class="frame">
      ${backdropImage}
      <div class="panel"></div>
      <main class="content" aria-label="${htmlEscape(BRAND.name)} social preview">
        <div class="brand">
          ${markSvg()
            .replace(' role="img" aria-labelledby="title"', '')
            .replace(/<title[^>]*>.*?<\/title>/s, '')}
          <span>${htmlEscape(BRAND.name)}</span>
        </div>
        <h1>Plain-language SEO audits for search and AI answers</h1>
        <p>Crawl, fix, track rankings, and prove your pages can be found, understood, and cited.</p>
        <div class="domain">${htmlEscape(BRAND.domain)}</div>
      </main>
    </div>
  </body>
</html>`;
}

async function renderOgImage() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
    await page.setContent(ogHtml(), { waitUntil: 'load' });
    await page.screenshot({ path: new URL('og/default.png', ROOT).pathname, type: 'png' });
  } finally {
    await browser.close();
  }
}

writeText('brand/rankmefast-mark.svg', markSvg());
writeText('brand/rankmefast-logo.svg', logoSvg());
writeText('favicon.svg', markSvg());
writeText('safari-pinned-tab.svg', safariPinnedTabSvg());
writeText('site.webmanifest', siteManifest());
writePng('icons/favicon-16.png', renderMark(16));
writePng('icons/favicon-32.png', renderMark(32));
writePng('icons/icon-192.png', renderMark(192));
writePng('icons/icon-512.png', renderMark(512));
writePng('apple-touch-icon.png', renderMark(180));
writePng('og/logo.png', renderMark(512));
await renderOgImage();
