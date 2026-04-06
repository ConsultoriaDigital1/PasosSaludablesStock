import 'dotenv/config';
import { createSqlClient, ensureSchema } from '../src/db.js';

const sourceDatabaseUrl = process.env.SOURCE_DATABASE_URL;
const targetDatabaseUrl = process.env.DATABASE_URL;
const force = process.argv.includes('--force');

async function main() {
  if (!sourceDatabaseUrl) {
    throw new Error('SOURCE_DATABASE_URL is required to migrate data');
  }

  if (!targetDatabaseUrl) {
    throw new Error('DATABASE_URL is required to migrate data');
  }

  if (sourceDatabaseUrl === targetDatabaseUrl) {
    throw new Error('SOURCE_DATABASE_URL and DATABASE_URL cannot be the same');
  }

  const sourceSql = createSqlClient(sourceDatabaseUrl);
  const targetSql = createSqlClient(targetDatabaseUrl);

  console.log(`Origen: ${maskDatabaseUrl(sourceDatabaseUrl)}`);
  console.log(`Destino: ${maskDatabaseUrl(targetDatabaseUrl)}`);

  await ensureSchema(sourceSql);
  await ensureSchema(targetSql);

  const sourceData = await readSourceData(sourceSql);
  const sourceCounts = {
    categories: sourceData.categories.length,
    products: sourceData.products.length,
    stockMovements: sourceData.stockMovements.length,
    treasuryTransactions: sourceData.treasuryTransactions.length
  };
  const targetCounts = await readCounts(targetSql);
  const targetHasData = Object.values(targetCounts).some((value) => value > 0);

  console.log(`Origen listo: ${formatCounts(sourceCounts)}`);

  if (targetHasData && !force) {
    throw new Error(
      `La base destino ya tiene datos (${formatCounts(targetCounts)}). Ejecuta "npm run db:migrate -- --force" si quieres reemplazarla.`
    );
  }

  if (targetHasData) {
    console.log('La base destino tiene datos. Se va a vaciar antes de copiar.');
  }

  await clearTarget(targetSql);
  await writeTargetData(targetSql, sourceData);
  await syncSequences(targetSql);

  const targetAfter = await readCounts(targetSql);

  assertSameCounts(sourceCounts, targetAfter);

  console.log('Migracion terminada.');
  console.log(`Copiado: ${formatCounts(targetAfter)}`);
}

async function readSourceData(sourceSql) {
  const [categories, products, stockMovements, treasuryTransactions] = await Promise.all([
    sourceSql`
      SELECT id, name, description, created_at, updated_at
      FROM categories
      ORDER BY id ASC
    `,
    sourceSql`
      SELECT id, name, description, price, category, image, images, featured, stock_quantity, created_at, updated_at
      FROM products
      ORDER BY id ASC
    `,
    sourceSql`
      SELECT id, product_id, movement_type, quantity, reason, note, created_at, batch_code
      FROM stock_movements
      ORDER BY id ASC
    `,
    sourceSql`
      SELECT id, transaction_type, category, amount, payment_method, reference, note, occurred_at, created_at
      FROM treasury_transactions
      ORDER BY id ASC
    `
  ]);

  return {
    categories,
    products,
    stockMovements,
    treasuryTransactions
  };
}

async function readCounts(client) {
  const [row] = await client`
    SELECT
      (SELECT COUNT(*)::int FROM categories) AS categories,
      (SELECT COUNT(*)::int FROM products) AS products,
      (SELECT COUNT(*)::int FROM stock_movements) AS stock_movements,
      (SELECT COUNT(*)::int FROM treasury_transactions) AS treasury_transactions
  `;

  return {
    categories: Number(row.categories || 0),
    products: Number(row.products || 0),
    stockMovements: Number(row.stock_movements || 0),
    treasuryTransactions: Number(row.treasury_transactions || 0)
  };
}

async function clearTarget(targetSql) {
  await targetSql`
    TRUNCATE TABLE stock_movements, treasury_transactions, products, categories
    RESTART IDENTITY CASCADE
  `;
}

async function writeTargetData(targetSql, sourceData) {
  // Copy in dependency order so product_id references remain valid.
  for (const row of sourceData.categories) {
    await targetSql`
      INSERT INTO categories (id, name, description, created_at, updated_at)
      VALUES (${row.id}, ${row.name}, ${row.description ?? null}, ${row.created_at}, ${row.updated_at ?? row.created_at})
    `;
  }

  for (const row of sourceData.products) {
    await targetSql`
      INSERT INTO products (
        id,
        name,
        description,
        price,
        category,
        image,
        images,
        featured,
        stock_quantity,
        created_at,
        updated_at
      )
      VALUES (
        ${row.id},
        ${row.name},
        ${row.description ?? ''},
        ${row.price},
        ${row.category},
        ${row.image ?? null},
        ${Array.isArray(row.images) ? row.images : null},
        ${Boolean(row.featured)},
        ${row.stock_quantity ?? 0},
        ${row.created_at},
        ${row.updated_at ?? row.created_at}
      )
    `;
  }

  for (const row of sourceData.stockMovements) {
    await targetSql`
      INSERT INTO stock_movements (
        id,
        product_id,
        movement_type,
        quantity,
        reason,
        note,
        created_at,
        batch_code
      )
      VALUES (
        ${row.id},
        ${row.product_id},
        ${row.movement_type},
        ${row.quantity},
        ${row.reason},
        ${row.note ?? null},
        ${row.created_at},
        ${row.batch_code ?? null}
      )
    `;
  }

  for (const row of sourceData.treasuryTransactions) {
    await targetSql`
      INSERT INTO treasury_transactions (
        id,
        transaction_type,
        category,
        amount,
        payment_method,
        reference,
        note,
        occurred_at,
        created_at
      )
      VALUES (
        ${row.id},
        ${row.transaction_type},
        ${row.category},
        ${row.amount},
        ${row.payment_method ?? null},
        ${row.reference ?? null},
        ${row.note ?? null},
        ${row.occurred_at},
        ${row.created_at}
      )
    `;
  }
}

async function syncSequences(targetSql) {
  await targetSql`
    SELECT setval(
      pg_get_serial_sequence('categories', 'id'),
      COALESCE((SELECT MAX(id) FROM categories), 1),
      COALESCE((SELECT COUNT(*) > 0 FROM categories), false)
    )
  `;

  await targetSql`
    SELECT setval(
      pg_get_serial_sequence('products', 'id'),
      COALESCE((SELECT MAX(id) FROM products), 1),
      COALESCE((SELECT COUNT(*) > 0 FROM products), false)
    )
  `;

  await targetSql`
    SELECT setval(
      pg_get_serial_sequence('stock_movements', 'id'),
      COALESCE((SELECT MAX(id) FROM stock_movements), 1),
      COALESCE((SELECT COUNT(*) > 0 FROM stock_movements), false)
    )
  `;

  await targetSql`
    SELECT setval(
      pg_get_serial_sequence('treasury_transactions', 'id'),
      COALESCE((SELECT MAX(id) FROM treasury_transactions), 1),
      COALESCE((SELECT COUNT(*) > 0 FROM treasury_transactions), false)
    )
  `;
}

function assertSameCounts(sourceCounts, targetCounts) {
  const mismatch = Object.entries(sourceCounts).find(([key, value]) => targetCounts[key] !== value);

  if (mismatch) {
    const [key, value] = mismatch;
    throw new Error(`La verificacion fallo en ${key}. Origen: ${value}. Destino: ${targetCounts[key]}.`);
  }
}

function formatCounts(counts) {
  return [
    `categorias=${counts.categories}`,
    `productos=${counts.products}`,
    `movimientos=${counts.stockMovements}`,
    `tesoreria=${counts.treasuryTransactions}`
  ].join(', ');
}

function maskDatabaseUrl(databaseUrl) {
  try {
    const parsed = new URL(databaseUrl);
    const databaseName = parsed.pathname.replace(/^\//, '') || '(sin nombre)';
    return `${parsed.hostname}/${databaseName}`;
  } catch {
    return '(url invalida)';
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
