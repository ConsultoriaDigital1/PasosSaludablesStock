import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureSchema, sql } from '../src/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultInputPath = path.resolve(__dirname, 'data/inventory-manual-sync.json');
const inputPath = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : defaultInputPath;
const DEFAULT_CATEGORY = 'PRODUCTOS';

const aliasByTargetName = new Map([
  ['Grasa de chancho kg - viene en frasco de 350-450gr', 'Grasa de chancho 500gr aprox'],
  ['MCT Oil en polvo Don Justo 165 gr', 'MCT Oil En Polvo'],
  ['Queso Bufala Organico santa florencia kg - paquetes de 500-600gr', 'Queso Bufala Organico Santa Florencia p/ Kg'],
  ['Galletita de maiz salmas', 'GALLETITAS DE MAIZ SALMAS Horneadas 90gr'],
  ['CALDO DE HUESO GURU 600 ML', 'Caldo de Huesos GURU 600ml'],
  ['Salame Tipo Tandil UNIDAD', 'SALAME TIPO TANDIL Por unidad (aprox. 500gr)'],
  ['Salame tipo colorado UNIDAD', 'SALAME COLORADO TIPO ESPANOL Por unidad (500gr aprox)'],
  ['Vinagre de manzana organico Serra Gaucha 500ml', 'Vinagre de manzana organica Serra Gaucha 500ml'],
  ['Huevos Libres plancha de 30 unidades', 'Huevos libres de jaula'],
  ['Crema de Leche doble Los Colonos 1 litro', 'CREMA DE LECHE DOBLE LOS COLONOS 1L'],
  ['Manteca Ghee 200 ML Don Justo', 'MANTECA Ghee 200gr'],
  ['Panceta Ahumada - paquetes de 500gr aprox', 'Panceta Ahumada 500gr aprox'],
  ['Pate  de ternera sin conservantes kg 300gr aprox', 'Pate Sin Conservantes Kg'],
  ['Chipita bastoncitos - Lievito', 'CHIPITA BASTONCITO Lievito 45gr']
]);

async function main() {
  await ensureSchema();
  await ensureCategory(DEFAULT_CATEGORY);

  const payload = await readInventoryFile(inputPath);
  validatePayload(payload);

  const currentProducts = await loadProducts();
  const currentByNormalizedName = buildNormalizedMap(currentProducts);
  const results = {
    updated: [],
    inserted: [],
    skipped: [],
    verified: []
  };

  for (const item of payload) {
    const targetName = item.producto.trim();
    const exactMatch = currentByNormalizedName.get(normalizeName(targetName)) ?? null;
    const aliasName = aliasByTargetName.get(targetName) ?? null;
    const aliasMatch = aliasName ? currentByNormalizedName.get(normalizeName(aliasName)) ?? null : null;
    const matched = exactMatch ?? aliasMatch ?? null;

    if (item.precio == null) {
      results.skipped.push({
        name: targetName,
        reason: 'precio faltante en el JSON'
      });
      continue;
    }

    if (matched) {
      await sql`
        UPDATE products
        SET
          name = ${targetName},
          price = ${item.precio},
          category = ${DEFAULT_CATEGORY},
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ${matched.id}
      `;

      results.updated.push({
        id: Number(matched.id),
        from: matched.name,
        to: targetName,
        price: item.precio
      });
      currentByNormalizedName.delete(normalizeName(matched.name));
      currentByNormalizedName.set(normalizeName(targetName), {
        ...matched,
        name: targetName,
        price: item.precio,
        category: DEFAULT_CATEGORY
      });
      continue;
    }

    const [created] = await sql`
      INSERT INTO products (name, description, price, category, image, images, featured, stock_quantity)
      VALUES (${targetName}, ${''}, ${item.precio}, ${DEFAULT_CATEGORY}, ${null}, ${null}, ${false}, ${0})
      RETURNING id, name, price, category
    `;

    results.inserted.push({
      id: Number(created.id),
      name: created.name,
      price: Number(created.price)
    });
    currentByNormalizedName.set(normalizeName(targetName), created);
  }

  results.verified = await verifyInventory(payload);
  printSummary(results);
}

async function ensureCategory(name) {
  const existing = await sql`
    SELECT id
    FROM categories
    WHERE name = ${name}
    LIMIT 1
  `;

  if (existing.length > 0) {
    return;
  }

  await sql`
    INSERT INTO categories (name, description)
    VALUES (${name}, ${'Categoria principal de inventario'})
  `;
}

async function readInventoryFile(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

function validatePayload(payload) {
  if (!Array.isArray(payload)) {
    throw new Error('El JSON debe ser un array de productos.');
  }

  const names = new Set();

  for (const item of payload) {
    if (!item || typeof item !== 'object') {
      throw new Error('Cada item del JSON debe ser un objeto.');
    }

    if (typeof item.producto !== 'string' || !item.producto.trim()) {
      throw new Error('Cada producto debe tener un nombre valido.');
    }

    const normalized = normalizeName(item.producto);
    if (names.has(normalized)) {
      throw new Error(`Hay nombres duplicados en el JSON: ${item.producto}`);
    }
    names.add(normalized);

    if (item.precio != null && (!Number.isFinite(item.precio) || item.precio < 0)) {
      throw new Error(`Precio invalido para ${item.producto}`);
    }
  }
}

async function loadProducts() {
  return sql`
    SELECT id, name, price, category, stock_quantity
    FROM products
    ORDER BY id ASC
  `;
}

function buildNormalizedMap(rows) {
  const map = new Map();

  for (const row of rows) {
    map.set(normalizeName(row.name), row);
  }

  return map;
}

function normalizeName(value) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' y ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function verifyInventory(payload) {
  const expected = payload.filter((item) => item.precio != null);
  const names = expected.map((item) => item.producto.trim());
  const rows = await sql`
    SELECT name, price, category
    FROM products
    WHERE name = ANY(${names})
  `;

  const byName = new Map(rows.map((row) => [row.name, row]));
  const mismatches = [];

  for (const item of expected) {
    const row = byName.get(item.producto.trim());

    if (!row) {
      mismatches.push({
        name: item.producto,
        reason: 'no existe despues de sincronizar'
      });
      continue;
    }

    if (Number(row.price) !== Number(item.precio)) {
      mismatches.push({
        name: item.producto,
        reason: `precio incorrecto (${row.price})`
      });
      continue;
    }

    if (row.category !== DEFAULT_CATEGORY) {
      mismatches.push({
        name: item.producto,
        reason: `categoria incorrecta (${row.category})`
      });
    }
  }

  if (mismatches.length > 0) {
    throw new Error(`La verificacion fallo: ${JSON.stringify(mismatches, null, 2)}`);
  }

  return expected.map((item) => item.producto.trim());
}

function printSummary(results) {
  console.log(`Archivo procesado: ${inputPath}`);
  console.log(`Actualizados: ${results.updated.length}`);
  console.log(`Insertados: ${results.inserted.length}`);
  console.log(`Verificados: ${results.verified.length}`);
  console.log(`Omitidos: ${results.skipped.length}`);

  if (results.updated.length > 0) {
    console.log('Productos actualizados:');
    for (const item of results.updated) {
      console.log(`- #${item.id}: ${item.from} -> ${item.to} (${item.price})`);
    }
  }

  if (results.inserted.length > 0) {
    console.log('Productos insertados:');
    for (const item of results.inserted) {
      console.log(`- #${item.id}: ${item.name} (${item.price})`);
    }
  }

  if (results.skipped.length > 0) {
    console.log('Productos omitidos:');
    for (const item of results.skipped) {
      console.log(`- ${item.name}: ${item.reason}`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
