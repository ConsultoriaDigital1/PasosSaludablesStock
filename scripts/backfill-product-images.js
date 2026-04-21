import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureSchema, sql } from '../src/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '..');
const imageRoot = path.join(workspaceRoot, 'img');
const generatedDir = path.join(imageRoot, 'generated');
const generatedAssetPrefix = '/assets/generated';

async function main() {
  await ensureSchema();
  await fs.mkdir(generatedDir, { recursive: true });

  const rows = await sql`
    SELECT id, name, category, image, images
    FROM products
    ORDER BY id ASC
  `;

  if (rows.length === 0) {
    console.log('No hay productos para procesar.');
    return;
  }

  let keptExisting = 0;
  let recoveredFromImagesArray = 0;
  let generated = 0;

  for (const row of rows) {
    const id = Number(row.id);
    const name = String(row.name || '').trim();
    const category = String(row.category || '').trim() || 'Sin categoria';
    const image = normalizeAsset(row.image);
    const images = normalizeAssetArray(row.images);
    const existingCandidate = image || images[0] || '';

    if (existingCandidate && (await isReachableAsset(existingCandidate))) {
      const nextImages = uniqueAssets([existingCandidate, ...images]);

      if (existingCandidate !== image || !sameArray(nextImages, images)) {
        await sql`
          UPDATE products
          SET
            image = ${existingCandidate},
            images = ${nextImages},
            updated_at = NOW()
          WHERE id = ${id}
        `;

        if (!image && images.length > 0) {
          recoveredFromImagesArray += 1;
        } else {
          keptExisting += 1;
        }
      } else {
        keptExisting += 1;
      }

      continue;
    }

    const filename = `product-${id}.svg`;
    const assetPath = `${generatedAssetPrefix}/${filename}`;
    const absolutePath = path.join(generatedDir, filename);
    const svg = buildProductSvg({
      id,
      name: name || `Producto #${id}`,
      category
    });

    await fs.writeFile(absolutePath, svg, 'utf8');

    await sql`
      UPDATE products
      SET
        image = ${assetPath},
        images = ${[assetPath]},
        updated_at = NOW()
      WHERE id = ${id}
    `;

    generated += 1;
  }

  const summaryRows = await sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE COALESCE(NULLIF(TRIM(image), ''), '') = '')::int AS missing_image
    FROM products
  `;
  const summary = summaryRows[0] || {};

  console.log('Backfill de imagenes completado.');
  console.log(`Total de productos: ${Number(summary.total || 0)}`);
  console.log(`Con imagen faltante: ${Number(summary.missing_image || 0)}`);
  console.log(`Generadas nuevas: ${generated}`);
  console.log(`Recuperadas desde images[]: ${recoveredFromImagesArray}`);
  console.log(`Con imagen existente valida: ${keptExisting}`);
}

function normalizeAsset(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const trimmed = value.trim();

  return trimmed ? trimmed : '';
}

function normalizeAssetArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return uniqueAssets(value.map(normalizeAsset).filter(Boolean));
}

function uniqueAssets(assets) {
  const seen = new Set();
  const out = [];

  assets.forEach((asset) => {
    if (!asset || seen.has(asset)) {
      return;
    }

    seen.add(asset);
    out.push(asset);
  });

  return out;
}

function sameArray(a, b) {
  if (a.length !== b.length) {
    return false;
  }

  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }

  return true;
}

async function isReachableAsset(assetPath) {
  if (/^https?:\/\//i.test(assetPath)) {
    return true;
  }

  if (!assetPath.startsWith('/assets/')) {
    return false;
  }

  const relativePath = assetPath.replace(/^\/assets\/?/, '');

  if (!relativePath) {
    return false;
  }

  const absolutePath = path.join(imageRoot, relativePath);

  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

function buildProductSvg({ id, name, category }) {
  const title = `Producto #${id}`;
  const normalizedName = String(name || '').replace(/\s+/g, ' ').trim();
  const normalizedCategory = String(category || '').replace(/\s+/g, ' ').trim();
  const nameLines = splitLines(normalizedName, 28, 3);
  const categoryLine = truncate(normalizedCategory, 34);

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 640" role="img" aria-labelledby="title desc">',
    `  <title>${escapeXml(title)}</title>`,
    `  <desc>${escapeXml(`Imagen generada para ${normalizedName}`)}</desc>`,
    '  <defs>',
    '    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">',
    '      <stop offset="0%" stop-color="#0F172A" />',
    '      <stop offset="100%" stop-color="#1E3A8A" />',
    '    </linearGradient>',
    '  </defs>',
    '  <rect width="960" height="640" fill="url(#bg)" />',
    '  <rect x="48" y="48" width="864" height="544" rx="24" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.25)" />',
    '  <text x="80" y="130" font-size="32" font-family="Arial, Helvetica, sans-serif" fill="#93C5FD">PASOS SALUDABLES</text>',
    '  <text x="80" y="200" font-size="62" font-weight="700" font-family="Arial, Helvetica, sans-serif" fill="#FFFFFF">'
  ]
    .concat(
      nameLines.map(
        (line, index) =>
          `    <tspan x="80" dy="${index === 0 ? 0 : 74}">${escapeXml(line)}</tspan>`
      )
    )
    .concat([
      '  </text>',
      `  <text x="80" y="530" font-size="34" font-family="Arial, Helvetica, sans-serif" fill="#BFDBFE">${escapeXml(categoryLine)}</text>`,
      `  <text x="80" y="580" font-size="26" font-family="Arial, Helvetica, sans-serif" fill="#E2E8F0">${escapeXml(`ID ${id}`)}</text>`,
      '</svg>',
      ''
    ])
    .join('\n');
}

function splitLines(text, maxChars, maxLines) {
  if (!text) {
    return ['Sin nombre'];
  }

  const words = text.split(' ');
  const lines = [];
  let current = '';

  words.forEach((word) => {
    if (!word) {
      return;
    }

    const tentative = current ? `${current} ${word}` : word;

    if (tentative.length <= maxChars) {
      current = tentative;
      return;
    }

    if (current) {
      lines.push(current);
      current = word;
      return;
    }

    lines.push(truncate(word, maxChars));
    current = '';
  });

  if (current) {
    lines.push(current);
  }

  if (lines.length <= maxLines) {
    return lines;
  }

  const clipped = lines.slice(0, maxLines);
  clipped[maxLines - 1] = truncate(clipped[maxLines - 1], Math.max(4, maxChars - 1));

  return clipped;
}

function truncate(text, maxChars) {
  const clean = String(text || '').trim();

  if (clean.length <= maxChars) {
    return clean;
  }

  if (maxChars <= 1) {
    return clean.slice(0, maxChars);
  }

  if (maxChars <= 3) {
    return clean.slice(0, maxChars);
  }

  return `${clean.slice(0, maxChars - 3).trim()}...`;
}

function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
