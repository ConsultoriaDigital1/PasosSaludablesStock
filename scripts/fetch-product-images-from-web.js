import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureSchema, sql } from '../src/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '..');
const imageRoot = path.join(workspaceRoot, 'img');
const webImageDir = path.join(imageRoot, 'web-search');
const webAssetPrefix = '/assets/web-search';

const SEARCH_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'accept-language': 'es-AR,es;q=0.9,en;q=0.8'
};

async function main() {
  await ensureSchema();
  await fs.mkdir(webImageDir, { recursive: true });

  const products = await sql`
    SELECT id, name, image, images
    FROM products
    ORDER BY id ASC
  `;

  if (products.length === 0) {
    console.log('No hay productos en la base.');
    return;
  }

  let updated = 0;
  let failed = 0;

  for (let i = 0; i < products.length; i += 1) {
    const product = products[i];
    const id = Number(product.id);
    const name = String(product.name || '').replace(/\s+/g, ' ').trim();

    if (!name) {
      failed += 1;
      console.log(`[${i + 1}/${products.length}] ${id}: nombre vacio, omitido`);
      continue;
    }

    try {
      const candidates = await findCandidateImageUrls(name);
      const downloaded = await downloadFirstValidImage(id, candidates);

      if (!downloaded) {
        failed += 1;
        console.log(`[${i + 1}/${products.length}] ${id}: sin imagen valida para "${name}"`);
        continue;
      }

      await sql`
        UPDATE products
        SET
          image = ${downloaded.assetPath},
          images = ${[downloaded.assetPath]},
          updated_at = NOW()
        WHERE id = ${id}
      `;

      updated += 1;
      console.log(`[${i + 1}/${products.length}] ${id}: imagen asignada -> ${downloaded.assetPath}`);
    } catch (error) {
      failed += 1;
      console.log(`[${i + 1}/${products.length}] ${id}: error al buscar imagen para "${name}"`);
      console.log(error instanceof Error ? error.message : error);
    }

    await wait(400);
  }

  const statsRows = await sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE COALESCE(NULLIF(TRIM(image), ''), '') = '')::int AS missing
    FROM products
  `;
  const stats = statsRows[0] || {};

  console.log('');
  console.log('Busqueda web finalizada.');
  console.log(`Productos procesados: ${products.length}`);
  console.log(`Actualizados con imagen web: ${updated}`);
  console.log(`Sin resultado: ${failed}`);
  console.log(`Total sin imagen en DB: ${Number(stats.missing || 0)}`);
}

async function findCandidateImageUrls(query) {
  const encoded = encodeURIComponent(query);
  const url = `https://www.bing.com/images/search?q=${encoded}&form=HDRSC2`;
  const response = await fetchWithTimeout(url, {
    headers: SEARCH_HEADERS
  });

  if (!response.ok) {
    throw new Error(`Busqueda fallida (${response.status})`);
  }

  const html = await response.text();
  const urls = extractBingImageUrls(html);

  if (urls.length === 0) {
    throw new Error('No se encontraron URLs de imagen en la pagina de resultados');
  }

  return urls;
}

function extractBingImageUrls(html) {
  const urls = [];
  const seen = new Set();
  const pattern = /murl(?:&quot;|\\\"):\s*(?:&quot;|\\\")([^"&]+?)(?:&quot;|\\\")/g;

  for (const match of html.matchAll(pattern)) {
    const raw = htmlDecode(match[1]).trim();

    if (!isHttpUrl(raw) || seen.has(raw)) {
      continue;
    }

    seen.add(raw);
    urls.push(raw);

    if (urls.length >= 20) {
      break;
    }
  }

  return urls;
}

async function downloadFirstValidImage(productId, candidates) {
  for (const url of candidates) {
    const downloaded = await tryDownloadImage(productId, url);

    if (downloaded) {
      return downloaded;
    }
  }

  return null;
}

async function tryDownloadImage(productId, sourceUrl) {
  try {
    const response = await fetchWithTimeout(sourceUrl, {
      headers: SEARCH_HEADERS,
      redirect: 'follow'
    });

    if (!response.ok) {
      return null;
    }

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();

    if (!contentType.startsWith('image/')) {
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    if (buffer.length < 2000) {
      return null;
    }

    const extension = chooseFileExtension(contentType, sourceUrl);
    const filename = `product-${productId}${extension}`;
    const absolutePath = path.join(webImageDir, filename);
    const assetPath = `${webAssetPrefix}/${filename}`;

    await fs.writeFile(absolutePath, buffer);

    return { assetPath, sourceUrl };
  } catch {
    return null;
  }
}

function chooseFileExtension(contentType, sourceUrl) {
  if (contentType.includes('image/jpeg') || contentType.includes('image/jpg')) {
    return '.jpg';
  }

  if (contentType.includes('image/png')) {
    return '.png';
  }

  if (contentType.includes('image/webp')) {
    return '.webp';
  }

  if (contentType.includes('image/gif')) {
    return '.gif';
  }

  if (contentType.includes('image/svg+xml')) {
    return '.svg';
  }

  const parsed = (() => {
    try {
      return new URL(sourceUrl);
    } catch {
      return null;
    }
  })();

  if (!parsed) {
    return '.jpg';
  }

  const ext = path.extname(parsed.pathname || '').toLowerCase();

  if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg'].includes(ext)) {
    return ext === '.jpeg' ? '.jpg' : ext;
  }

  return '.jpg';
}

function htmlDecode(value) {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&#x2f;/gi, '/')
    .replace(/&#x3a;/gi, ':')
    .replace(/&#x3d;/gi, '=')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(value);
}

async function fetchWithTimeout(url, options, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
