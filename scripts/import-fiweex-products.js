import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureSchema, sql } from '../src/db.js';

const CATALOG_URL = 'https://fiweex.com/ecommerce_producto/5485/pasossaludables';
const CATEGORY_NAME = 'PRODUCTOS';
const DEFAULT_STOCK = 10;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '..');
const imageDir = path.join(workspaceRoot, 'img');

async function main() {
  await ensureSchema();
  await fs.mkdir(imageDir, { recursive: true });

  const html = await fetchText(CATALOG_URL);
  const products = extractProducts(html);

  if (products.length === 0) {
    throw new Error('No se encontraron productos en el catalogo de Fiweex.');
  }

  await ensureCategory(CATEGORY_NAME);

  let inserted = 0;
  let updated = 0;

  for (const product of products) {
    const assetPath = await downloadImage(product);
    const existing = await findExistingProduct(product.name, CATEGORY_NAME);

    if (existing) {
      await updateProduct(existing.id, product, assetPath);
      updated += 1;
      continue;
    }

    await insertProduct(product, assetPath);
    inserted += 1;
  }

  console.log(`Importacion completada desde ${CATALOG_URL}`);
  console.log(`Productos detectados: ${products.length}`);
  console.log(`Insertados: ${inserted}`);
  console.log(`Actualizados: ${updated}`);
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; PasosSaludablesStock/1.0)'
    }
  });

  if (!response.ok) {
    throw new Error(`No se pudo leer ${url}. Status ${response.status}`);
  }

  return response.text();
}

function extractProducts(html) {
  const productRegex = /<div class="col-xs-6 col-md-2 items"[^>]*>[\s\S]*?<img[^>]+id="img_(\d+)"[^>]+src="([^"]+)"[\s\S]*?<div class="div_catalogo_prod_descripcion">[\s\S]*?<p>([\s\S]*?)<\/p>[\s\S]*?<span>([\s\S]*?)<\/span>/gi;
  const products = [];
  const seenIds = new Set();

  for (const match of html.matchAll(productRegex)) {
    const sourceId = match[1].trim();

    if (seenIds.has(sourceId)) {
      continue;
    }

    seenIds.add(sourceId);

    products.push({
      sourceId,
      name: decodeHtml(stripTags(match[3])).replace(/\s+/g, ' ').trim(),
      imageUrl: new URL(match[2], CATALOG_URL).toString(),
      price: parsePrice(match[4])
    });
  }

  return products;
}

function stripTags(value) {
  return String(value).replace(/<[^>]*>/g, '');
}

function decodeHtml(value) {
  return String(value)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&ntilde;/gi, 'ñ')
    .replace(/&Ntilde;/gi, 'Ñ')
    .replace(/&aacute;/gi, 'á')
    .replace(/&eacute;/gi, 'é')
    .replace(/&iacute;/gi, 'í')
    .replace(/&oacute;/gi, 'ó')
    .replace(/&uacute;/gi, 'ú')
    .replace(/&Aacute;/gi, 'Á')
    .replace(/&Eacute;/gi, 'É')
    .replace(/&Iacute;/gi, 'Í')
    .replace(/&Oacute;/gi, 'Ó')
    .replace(/&Uacute;/gi, 'Ú')
    .replace(/&uuml;/gi, 'ü')
    .replace(/&Uuml;/gi, 'Ü')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function parsePrice(rawPrice) {
  const numeric = String(rawPrice).replace(/[^\d]/g, '');
  const price = Number(numeric);

  if (!Number.isFinite(price)) {
    throw new Error(`Precio invalido detectado: ${rawPrice}`);
  }

  return price;
}

async function downloadImage(product) {
  const url = new URL(product.imageUrl);
  const ext = path.extname(url.pathname) || '.jpg';
  const filename = `fiweex-pasos-${product.sourceId}${ext.toLowerCase()}`;
  const absolutePath = path.join(imageDir, filename);
  const relativeAssetPath = `/assets/${filename}`;
  const response = await fetch(product.imageUrl, {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; PasosSaludablesStock/1.0)'
    }
  });

  if (!response.ok) {
    throw new Error(`No se pudo descargar la imagen de ${product.name}. Status ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(absolutePath, buffer);

  return relativeAssetPath;
}

async function ensureCategory(name) {
  const rows = await sql`
    SELECT id
    FROM categories
    WHERE name = ${name}
    LIMIT 1
  `;

  if (rows.length > 0) {
    return Number(rows[0].id);
  }

  const inserted = await sql`
    INSERT INTO categories (name, description)
    VALUES (${name}, ${'Importado desde Fiweex'})
    RETURNING id
  `;

  return Number(inserted[0].id);
}

async function findExistingProduct(name, category) {
  const rows = await sql`
    SELECT id
    FROM products
    WHERE name = ${name}
      AND category = ${category}
    LIMIT 1
  `;

  return rows[0] ? { id: Number(rows[0].id) } : null;
}

async function updateProduct(id, product, assetPath) {
  await sql`
    UPDATE products
    SET
      description = ${''},
      price = ${product.price},
      category = ${CATEGORY_NAME},
      image = ${assetPath},
      images = ${[assetPath]},
      featured = false,
      stock_quantity = ${DEFAULT_STOCK},
      updated_at = NOW()
    WHERE id = ${id}
  `;
}

async function insertProduct(product, assetPath) {
  await sql`
    INSERT INTO products (
      name,
      description,
      price,
      category,
      image,
      images,
      featured,
      stock_quantity
    )
    VALUES (
      ${product.name},
      ${''},
      ${product.price},
      ${CATEGORY_NAME},
      ${assetPath},
      ${[assetPath]},
      ${false},
      ${DEFAULT_STOCK}
    )
  `;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
