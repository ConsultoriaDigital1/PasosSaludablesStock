import dotenv from 'dotenv';
import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readBearerToken, signJwt, verifyJwt } from './auth.js';
import { ensureSchema, mapCategory, mapMovement, mapProduct, mapTransaction, sql } from './db.js';

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 4010);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, '../public');
const assetDir = path.resolve(__dirname, '../img');
const authUsername = process.env.AUTH_USERNAME || 'pasossaludables';
const authPassword = process.env.AUTH_PASSWORD || 'pelusa50';
const jwtSecret = process.env.JWT_SECRET || 'stockmanager-change-this-secret';
const jwtExpiresHours = Math.max(Number(process.env.JWT_EXPIRES_HOURS || 12), 1);

app.use(express.json({ limit: '1mb' }));
app.use(express.static(publicDir));
app.use('/assets', express.static(assetDir));

app.post('/api/auth/login', (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!safeEqual(username, authUsername) || !safeEqual(password, authPassword)) {
    return res.status(401).json({ error: 'Credenciales invalidas' });
  }

  const token = signJwt({ sub: username }, jwtSecret, jwtExpiresHours * 60 * 60);

  return res.json({
    token,
    user: { username },
    expiresInHours: jwtExpiresHours
  });
});

app.use('/api', (req, res, next) => {
  if (req.path === '/auth/login') {
    return next();
  }

  const token = readBearerToken(req.headers.authorization);

  if (!token) {
    return res.status(401).json({ error: 'Sesion requerida' });
  }

  try {
    const payload = verifyJwt(token, jwtSecret);
    req.auth = {
      username: payload.sub,
      exp: Number(payload.exp)
    };
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Sesion invalida o vencida' });
  }
});

app.get('/api/auth/session', (req, res) => {
  return res.json({
    user: {
      username: req.auth.username
    },
    expiresAt: req.auth.exp * 1000
  });
});

app.get('/api/health', async (_req, res) => {
  try {
    const result = await sql`SELECT NOW() AS now`;
    res.json({ ok: true, now: result[0].now });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: 'Database connection failed',
      detail: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

app.get('/api/dashboard', async (_req, res) => {
  try {
    const [inventoryRows, movementsRows, treasuryRows, chartRows, expenseRows] = await Promise.all([
      sql`
        SELECT
          COUNT(*)::int AS total_products,
          COALESCE(SUM(stock_quantity), 0)::int AS total_stock,
          COALESCE(SUM(price * stock_quantity), 0)::numeric AS inventory_value,
          COALESCE(SUM(CASE WHEN stock_quantity <= 3 THEN 1 ELSE 0 END), 0)::int AS low_stock_products
        FROM products
      `,
      sql`
        SELECT
          COUNT(*)::int AS recent_movements,
          COALESCE(SUM(CASE WHEN movement_type = 'OUT' THEN quantity ELSE 0 END), 0)::int AS recent_units_out
        FROM stock_movements
        WHERE created_at >= NOW() - INTERVAL '7 days'
      `,
      sql`
        SELECT
          COALESCE(SUM(CASE WHEN transaction_type IN ('INCOME', 'SALE', 'CAPITAL') THEN amount ELSE 0 END), 0)::numeric AS total_income,
          COALESCE(SUM(CASE WHEN transaction_type IN ('EXPENSE', 'PURCHASE', 'WITHDRAWAL', 'TAX') THEN amount ELSE 0 END), 0)::numeric AS total_expense
        FROM treasury_transactions
        WHERE occurred_at >= DATE_TRUNC('month', NOW())
      `,
      sql`
        SELECT
          TO_CHAR(occurred_at, 'YYYY-MM') AS month_key,
          COALESCE(SUM(CASE WHEN transaction_type IN ('INCOME', 'SALE', 'CAPITAL') THEN amount ELSE 0 END), 0)::numeric AS income_total,
          COALESCE(SUM(CASE WHEN transaction_type IN ('EXPENSE', 'PURCHASE', 'WITHDRAWAL', 'TAX') THEN amount ELSE 0 END), 0)::numeric AS expense_total
        FROM treasury_transactions
        WHERE occurred_at >= DATE_TRUNC('month', NOW()) - INTERVAL '5 months'
        GROUP BY month_key
        ORDER BY month_key ASC
      `,
      sql`
        SELECT
          category,
          COALESCE(SUM(amount), 0)::numeric AS total
        FROM treasury_transactions
        WHERE transaction_type IN ('EXPENSE', 'PURCHASE', 'WITHDRAWAL', 'TAX')
          AND occurred_at >= DATE_TRUNC('month', NOW())
        GROUP BY category
        ORDER BY total DESC
        LIMIT 5
      `
    ]);

    const inventory = inventoryRows[0];
    const movements = movementsRows[0];
    const treasury = treasuryRows[0];
    const income = Number(treasury.total_income || 0);
    const expense = Number(treasury.total_expense || 0);

    res.json({
      summary: {
        totalProducts: Number(inventory.total_products || 0),
        totalStock: Number(inventory.total_stock || 0),
        inventoryValue: Number(inventory.inventory_value || 0),
        lowStockProducts: Number(inventory.low_stock_products || 0),
        recentMovements: Number(movements.recent_movements || 0),
        recentUnitsOut: Number(movements.recent_units_out || 0),
        totalIncome: income,
        totalExpense: expense,
        treasuryBalance: income - expense
      },
      monthlyFinance: chartRows.map((row) => ({
        month: row.month_key,
        income: Number(row.income_total || 0),
        expense: Number(row.expense_total || 0)
      })),
      expenseBreakdown: expenseRows.map((row) => ({
        category: row.category,
        total: Number(row.total || 0)
      }))
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

app.get('/api/stats', async (_req, res) => {
  try {
    const [categoryRows, topRows, lowRows, movementTrendRows] = await Promise.all([
      sql`
        SELECT category, COUNT(*)::int AS products, COALESCE(SUM(stock_quantity), 0)::int AS units
        FROM products
        GROUP BY category
        ORDER BY units DESC, products DESC
      `,
      sql`
        SELECT id, name, stock_quantity
        FROM products
        ORDER BY stock_quantity DESC, updated_at DESC
        LIMIT 6
      `,
      sql`
        SELECT id, name, stock_quantity
        FROM products
        WHERE stock_quantity <= 5
        ORDER BY stock_quantity ASC, updated_at DESC
        LIMIT 6
      `,
      sql`
        SELECT
          TO_CHAR(created_at, 'YYYY-MM-DD') AS day_key,
          COALESCE(SUM(CASE WHEN movement_type = 'OUT' THEN quantity ELSE 0 END), 0)::int AS units_out,
          COALESCE(SUM(CASE WHEN movement_type = 'IN' THEN quantity ELSE 0 END), 0)::int AS units_in
        FROM stock_movements
        WHERE created_at >= NOW() - INTERVAL '14 days'
        GROUP BY day_key
        ORDER BY day_key ASC
      `
    ]);

    res.json({
      categoryDistribution: categoryRows.map((row) => ({
        category: row.category,
        products: Number(row.products || 0),
        units: Number(row.units || 0)
      })),
      topStock: topRows.map((row) => ({
        id: Number(row.id),
        name: row.name,
        stockQuantity: Number(row.stock_quantity || 0)
      })),
      lowStock: lowRows.map((row) => ({
        id: Number(row.id),
        name: row.name,
        stockQuantity: Number(row.stock_quantity || 0)
      })),
      movementTrend: movementTrendRows.map((row) => ({
        day: row.day_key,
        unitsOut: Number(row.units_out || 0),
        unitsIn: Number(row.units_in || 0)
      }))
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

app.get('/api/categories', async (_req, res) => {
  try {
    const rows = await sql`
      SELECT id, name, description, created_at, updated_at
      FROM categories
      ORDER BY name ASC
    `;

    res.json(rows.map(mapCategory));
  } catch (error) {
    res.status(500).json({ error: 'Failed to load categories' });
  }
});

app.post('/api/categories', async (req, res) => {
  const { name, description = '' } = req.body ?? {};

  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Category name is required' });
  }

  try {
    const rows = await sql`
      INSERT INTO categories (name, description)
      VALUES (${name.trim()}, ${String(description).trim()})
      RETURNING id, name, description, created_at, updated_at
    `;

    return res.status(201).json(mapCategory(rows[0]));
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create category' });
  }
});

app.get('/api/products', async (req, res) => {
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';

  try {
    let rows;

    if (search) {
      rows = await sql`
        SELECT id, name, description, price, category, image, images, featured, stock_quantity, created_at, updated_at
        FROM products
        WHERE name ILIKE ${`%${search}%`}
          OR description ILIKE ${`%${search}%`}
          OR category ILIKE ${`%${search}%`}
        ORDER BY updated_at DESC, created_at DESC
      `;
    } else if (category) {
      rows = await sql`
        SELECT id, name, description, price, category, image, images, featured, stock_quantity, created_at, updated_at
        FROM products
        WHERE category = ${category}
        ORDER BY updated_at DESC, created_at DESC
      `;
    } else {
      rows = await sql`
        SELECT id, name, description, price, category, image, images, featured, stock_quantity, created_at, updated_at
        FROM products
        ORDER BY updated_at DESC, created_at DESC
      `;
    }

    res.json(rows.map(mapProduct));
  } catch (error) {
    res.status(500).json({ error: 'Failed to load products' });
  }
});

app.post('/api/products', async (req, res) => {
  const payload = normalizeProductInput(req.body);

  if (payload.error) {
    return res.status(400).json({ error: payload.error });
  }

  try {
    const rows = await sql`
      INSERT INTO products (name, description, price, category, image, images, featured, stock_quantity)
      VALUES (
        ${payload.name},
        ${payload.description},
        ${payload.price},
        ${payload.category},
        ${payload.image},
        ${payload.images},
        ${payload.featured},
        ${payload.stockQuantity}
      )
      RETURNING id, name, description, price, category, image, images, featured, stock_quantity, created_at, updated_at
    `;

    return res.status(201).json(mapProduct(rows[0]));
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create product' });
  }
});

app.put('/api/products/:id', async (req, res) => {
  const id = Number(req.params.id);
  const payload = normalizeProductInput(req.body);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid product id' });
  }

  if (payload.error) {
    return res.status(400).json({ error: payload.error });
  }

  try {
    const rows = await sql`
      UPDATE products
      SET
        name = ${payload.name},
        description = ${payload.description},
        price = ${payload.price},
        category = ${payload.category},
        image = ${payload.image},
        images = ${payload.images},
        featured = ${payload.featured},
        stock_quantity = ${payload.stockQuantity},
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING id, name, description, price, category, image, images, featured, stock_quantity, created_at, updated_at
    `;

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    return res.json(mapProduct(rows[0]));
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update product' });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid product id' });
  }

  try {
    const rows = await sql`
      DELETE FROM products
      WHERE id = ${id}
      RETURNING id
    `;

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    return res.status(204).send();
  } catch (error) {
    return res.status(500).json({ error: 'Failed to delete product' });
  }
});

app.post('/api/products/:id/quick-sale', async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid product id' });
  }

  try {
    const rows = await sql`
      WITH selected_product AS (
        SELECT id, name, category, price, stock_quantity
        FROM products
        WHERE id = ${id}
      ),
      updated_product AS (
        UPDATE products
        SET
          stock_quantity = products.stock_quantity - 1,
          updated_at = NOW()
        FROM selected_product
        WHERE products.id = selected_product.id
          AND selected_product.stock_quantity > 0
        RETURNING products.id, products.name, products.category, products.price, products.stock_quantity
      ),
      inserted_movement AS (
        INSERT INTO stock_movements (product_id, movement_type, quantity, reason, note)
        SELECT id, 'OUT', 1, 'Venta rapida', 'Venta registrada desde inventario'
        FROM updated_product
        RETURNING id, product_id, movement_type, quantity, reason, note, created_at
      ),
      inserted_transaction AS (
        INSERT INTO treasury_transactions (
          transaction_type,
          category,
          amount,
          payment_method,
          reference,
          note,
          occurred_at
        )
        SELECT
          'SALE',
          category,
          price,
          'Mostrador',
          name,
          'Venta rapida desde inventario',
          NOW()
        FROM updated_product
        RETURNING id, transaction_type, category, amount, payment_method, reference, note, occurred_at, created_at
      )
      SELECT
        up.id AS product_id,
        up.name AS product_name,
        up.category,
        up.price,
        up.stock_quantity,
        im.id AS movement_id,
        im.product_id AS movement_product_id,
        im.movement_type,
        im.quantity,
        im.reason,
        im.note AS movement_note,
        im.created_at AS movement_created_at,
        tx.id AS transaction_id,
        tx.transaction_type,
        tx.category AS transaction_category,
        tx.amount,
        tx.payment_method,
        tx.reference,
        tx.note AS transaction_note,
        tx.occurred_at,
        tx.created_at AS transaction_created_at
      FROM updated_product up
      INNER JOIN inserted_movement im ON TRUE
      INNER JOIN inserted_transaction tx ON TRUE
    `;

    if (rows.length === 0) {
      const productRows = await sql`
        SELECT id, stock_quantity
        FROM products
        WHERE id = ${id}
      `;

      if (productRows.length === 0) {
        return res.status(404).json({ error: 'Product not found' });
      }

      return res.status(400).json({ error: 'Product is out of stock' });
    }

    const row = rows[0];

    return res.status(201).json({
      product: {
        id: Number(row.product_id),
        name: row.product_name,
        category: row.category,
        price: Number(row.price || 0),
        stockQuantity: Number(row.stock_quantity || 0)
      },
      movement: mapMovement({
        id: row.movement_id,
        product_id: row.movement_product_id,
        product_name: row.product_name,
        movement_type: row.movement_type,
        quantity: row.quantity,
        reason: row.reason,
        note: row.movement_note,
        created_at: row.movement_created_at
      }),
      transaction: mapTransaction({
        id: row.transaction_id,
        transaction_type: row.transaction_type,
        category: row.transaction_category,
        amount: row.amount,
        payment_method: row.payment_method,
        reference: row.reference,
        note: row.transaction_note,
        occurred_at: row.occurred_at,
        created_at: row.transaction_created_at
      })
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to register quick sale' });
  }
});

app.get('/api/stock-movements', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);

  try {
    const rows = await sql`
      SELECT
        sm.id,
        sm.batch_code,
        sm.product_id,
        COALESCE(p.name, CONCAT('Producto #', sm.product_id::text)) AS product_name,
        COALESCE(p.price, 0)::numeric AS price,
        sm.movement_type,
        sm.quantity,
        sm.reason,
        sm.note,
        sm.created_at
      FROM stock_movements sm
      LEFT JOIN products p ON p.id = sm.product_id
      ORDER BY sm.created_at DESC, sm.id DESC
      LIMIT ${Math.max(limit * 6, 40)}
    `;

    res.json(groupMovementRows(rows).slice(0, limit));
  } catch (error) {
    res.status(500).json({ error: 'Failed to load stock movements' });
  }
});

app.post('/api/stock-movements', async (req, res) => {
  const payload = normalizeMovementInput(req.body);

  if (payload.error) {
    return res.status(400).json({ error: payload.error });
  }

  try {
    const productIds = payload.items.map((item) => item.productId);
    const productRows = await sql`
      SELECT id, name, description, price, category, image, images, featured, stock_quantity, created_at, updated_at
      FROM products
      WHERE id = ANY(${productIds})
    `;

    if (productRows.length !== productIds.length) {
      return res.status(404).json({ error: 'Uno o mas repuestos no existen' });
    }

    const productsById = new Map(productRows.map((row) => [Number(row.id), mapProduct(row)]));
    const isOutgoing = ['OUT', 'SALE'].includes(payload.movementType);

    for (const item of payload.items) {
      const product = productsById.get(item.productId);

      if (!product) {
        return res.status(404).json({ error: 'Uno o mas repuestos no existen' });
      }

      if (isOutgoing && product.stockQuantity < item.quantity) {
        return res.status(400).json({ error: `Stock insuficiente para ${product.name}` });
      }
    }

    const itemsJson = JSON.stringify(payload.items.map((item) => ({
      product_id: item.productId,
      quantity: item.quantity
    })));
    const batchCode = payload.movementType === 'SALE' ? crypto.randomUUID() : null;

    if (payload.movementType === 'SALE') {
      const rows = await sql`
        WITH payload_rows AS (
          SELECT *
          FROM jsonb_to_recordset(${itemsJson}::jsonb) AS item(product_id int, quantity int)
        ),
        updated_products AS (
          UPDATE products AS p
          SET
            stock_quantity = p.stock_quantity - payload_rows.quantity,
            updated_at = NOW()
          FROM payload_rows
          WHERE p.id = payload_rows.product_id
          RETURNING p.id, p.name, p.category, p.price, p.stock_quantity, payload_rows.quantity
        ),
        inserted_movements AS (
          INSERT INTO stock_movements (product_id, movement_type, quantity, reason, note, batch_code)
          SELECT
            id,
            'OUT',
            quantity,
            ${payload.reason},
            ${payload.note},
            ${batchCode}
          FROM updated_products
          RETURNING id, product_id, movement_type, quantity, reason, note, created_at, batch_code
        ),
        sale_total AS (
          SELECT COALESCE(SUM(price * quantity), 0)::numeric AS total_amount
          FROM updated_products
        ),
        inserted_transaction AS (
          INSERT INTO treasury_transactions (
            transaction_type,
            category,
            amount,
            payment_method,
            reference,
            note,
            occurred_at
          )
          SELECT
            'SALE',
            'Ventas',
            total_amount,
            ${payload.paymentMethod || 'Mostrador'},
            ${payload.reference || `VENTA-${String(batchCode).slice(0, 8)}`},
            ${buildSaleReferenceNote(payload.items, productsById, payload.note)},
            ${payload.occurredAt}
          FROM sale_total
          RETURNING id, transaction_type, category, amount, payment_method, reference, note, occurred_at, created_at
        )
        SELECT
          im.id,
          im.product_id,
          up.name AS product_name,
          im.movement_type,
          im.quantity,
          im.reason,
          im.note,
          im.created_at,
          im.batch_code,
          up.price,
          tx.id AS transaction_id,
          tx.transaction_type,
          tx.category AS transaction_category,
          tx.amount,
          tx.payment_method,
          tx.reference,
          tx.note AS transaction_note,
          tx.occurred_at,
          tx.created_at AS transaction_created_at
        FROM inserted_movements im
        INNER JOIN updated_products up ON up.id = im.product_id
        CROSS JOIN inserted_transaction tx
      `;

      return res.status(201).json({
        batchCode,
        movement: groupMovementRows(rows)[0] ?? null,
        transaction: mapTransaction({
          id: rows[0].transaction_id,
          transaction_type: rows[0].transaction_type,
          category: rows[0].transaction_category,
          amount: rows[0].amount,
          payment_method: rows[0].payment_method,
          reference: rows[0].reference,
          note: rows[0].transaction_note,
          occurred_at: rows[0].occurred_at,
          created_at: rows[0].transaction_created_at
        })
      });
    }

    const stockDirection = payload.movementType === 'IN' ? 1 : -1;
    const movementRows = await sql`
      WITH payload_rows AS (
        SELECT *
        FROM jsonb_to_recordset(${itemsJson}::jsonb) AS item(product_id int, quantity int)
      ),
      updated_products AS (
        UPDATE products AS p
        SET
          stock_quantity = p.stock_quantity + (${stockDirection} * payload_rows.quantity),
          updated_at = NOW()
        FROM payload_rows
        WHERE p.id = payload_rows.product_id
        RETURNING p.id, p.name, p.price, p.stock_quantity, payload_rows.quantity
      ),
      inserted_movements AS (
        INSERT INTO stock_movements (product_id, movement_type, quantity, reason, note, batch_code)
        SELECT
          id,
          ${payload.movementType},
          quantity,
          ${payload.reason},
          ${payload.note},
          ${batchCode}
        FROM updated_products
        RETURNING id, product_id, movement_type, quantity, reason, note, created_at, batch_code
      )
      SELECT
        im.id,
        im.product_id,
        up.name AS product_name,
        im.movement_type,
        im.quantity,
        im.reason,
        im.note,
        im.created_at,
        im.batch_code,
        up.price
      FROM inserted_movements im
      INNER JOIN updated_products up ON up.id = im.product_id
    `;

    return res.status(201).json({
      batchCode,
      movement: groupMovementRows(movementRows)[0] ?? null
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to register stock movement' });
  }
});

app.get('/api/treasury/transactions', async (req, res) => {
  const type = typeof req.query.type === 'string' ? req.query.type.trim() : '';
  const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';

  try {
    let rows;

    if (type && category) {
      rows = await sql`
        SELECT id, transaction_type, category, amount, payment_method, reference, note, occurred_at, created_at
        FROM treasury_transactions
        WHERE transaction_type = ${type} AND category = ${category}
        ORDER BY occurred_at DESC, id DESC
      `;
    } else if (type) {
      rows = await sql`
        SELECT id, transaction_type, category, amount, payment_method, reference, note, occurred_at, created_at
        FROM treasury_transactions
        WHERE transaction_type = ${type}
        ORDER BY occurred_at DESC, id DESC
      `;
    } else if (category) {
      rows = await sql`
        SELECT id, transaction_type, category, amount, payment_method, reference, note, occurred_at, created_at
        FROM treasury_transactions
        WHERE category = ${category}
        ORDER BY occurred_at DESC, id DESC
      `;
    } else {
      rows = await sql`
        SELECT id, transaction_type, category, amount, payment_method, reference, note, occurred_at, created_at
        FROM treasury_transactions
        ORDER BY occurred_at DESC, id DESC
        LIMIT 200
      `;
    }

    res.json(rows.map(mapTransaction));
  } catch (error) {
    res.status(500).json({ error: 'Failed to load treasury transactions' });
  }
});

app.post('/api/treasury/transactions', async (req, res) => {
  const payload = normalizeTransactionInput(req.body);

  if (payload.error) {
    return res.status(400).json({ error: payload.error });
  }

  try {
    const rows = await sql`
      INSERT INTO treasury_transactions (
        transaction_type,
        category,
        amount,
        payment_method,
        reference,
        note,
        occurred_at
      )
      VALUES (
        ${payload.transactionType},
        ${payload.category},
        ${payload.amount},
        ${payload.paymentMethod},
        ${payload.reference},
        ${payload.note},
        ${payload.occurredAt}
      )
      RETURNING id, transaction_type, category, amount, payment_method, reference, note, occurred_at, created_at
    `;

    res.status(201).json(mapTransaction(rows[0]));
  } catch (error) {
    res.status(500).json({ error: 'Failed to create treasury transaction' });
  }
});

app.delete('/api/treasury/transactions/:id', async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid transaction id' });
  }

  try {
    const rows = await sql`
      DELETE FROM treasury_transactions
      WHERE id = ${id}
      RETURNING id
    `;

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete transaction' });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

function normalizeProductInput(body) {
  const input = body ?? {};
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  const category = typeof input.category === 'string' ? input.category.trim() : '';
  const image = typeof input.image === 'string' ? input.image.trim() : '';
  const price = Number(input.price);
  const stockQuantity = Number(input.stockQuantity);
  const featured = Boolean(input.featured);
  const images = Array.isArray(input.images)
    ? input.images.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
    : image
      ? [image]
      : [];

  if (!name) {
    return { error: 'Product name is required' };
  }

  if (!category) {
    return { error: 'Category is required' };
  }

  if (!Number.isFinite(price) || price < 0) {
    return { error: 'Price must be a valid non-negative number' };
  }

  if (!Number.isInteger(stockQuantity) || stockQuantity < 0) {
    return { error: 'Stock quantity must be a valid non-negative integer' };
  }

  return {
    name,
    description,
    category,
    image,
    images,
    price,
    stockQuantity,
    featured
  };
}

function normalizeMovementInput(body) {
  const input = body ?? {};
  const movementType = typeof input.movementType === 'string' ? input.movementType.trim().toUpperCase() : 'OUT';
  const reasonInput = typeof input.reason === 'string' ? input.reason.trim() : '';
  const note = typeof input.note === 'string' ? input.note.trim() : '';
  const paymentMethod = typeof input.paymentMethod === 'string' ? input.paymentMethod.trim() : '';
  const reference = typeof input.reference === 'string' ? input.reference.trim() : '';
  const occurredAt = typeof input.occurredAt === 'string' && input.occurredAt.trim()
    ? input.occurredAt.trim()
    : new Date().toISOString();
  const rawItems = Array.isArray(input.items) && input.items.length
    ? input.items
    : [{ productId: input.productId, quantity: input.quantity }];
  const items = collapseMovementItems(rawItems);

  if (!['IN', 'OUT', 'SALE'].includes(movementType)) {
    return { error: 'Movement type must be IN, OUT or SALE' };
  }

  if (items.length === 0) {
    return { error: 'Agrega al menos un repuesto valido al movimiento' };
  }

  const reason = reasonInput || defaultReasonForMovement(movementType);

  return {
    items,
    movementType,
    reason,
    note,
    paymentMethod,
    reference,
    occurredAt
  };
}

function normalizeTransactionInput(body) {
  const input = body ?? {};
  const transactionType = typeof input.transactionType === 'string' ? input.transactionType.trim().toUpperCase() : '';
  const category = typeof input.category === 'string' ? input.category.trim() : '';
  const paymentMethod = typeof input.paymentMethod === 'string' ? input.paymentMethod.trim() : '';
  const reference = typeof input.reference === 'string' ? input.reference.trim() : '';
  const note = typeof input.note === 'string' ? input.note.trim() : '';
  const amount = Number(input.amount);
  const occurredAt = typeof input.occurredAt === 'string' && input.occurredAt.trim()
    ? input.occurredAt
    : new Date().toISOString();

  if (!['INCOME', 'EXPENSE', 'SALE', 'PURCHASE', 'WITHDRAWAL', 'CAPITAL', 'TAX'].includes(transactionType)) {
    return { error: 'Invalid transaction type' };
  }

  if (!category) {
    return { error: 'Category is required' };
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: 'Amount must be a positive number' };
  }

  return {
    transactionType,
    category,
    paymentMethod,
    reference,
    note,
    amount,
    occurredAt
  };
}

function collapseMovementItems(items) {
  const merged = new Map();

  items.forEach((item) => {
    const productId = Number(item?.productId);
    const quantity = Number(item?.quantity);

    if (!Number.isInteger(productId) || productId <= 0) {
      return;
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
      return;
    }

    merged.set(productId, {
      productId,
      quantity: (merged.get(productId)?.quantity || 0) + quantity
    });
  });

  return [...merged.values()];
}

function defaultReasonForMovement(movementType) {
  switch (movementType) {
    case 'IN':
      return 'Ingreso de stock';
    case 'SALE':
      return 'Venta de mostrador';
    default:
      return 'Salida de stock';
  }
}

function buildSaleReferenceNote(items, productsById, note) {
  const summary = items
    .map((item) => {
      const product = productsById.get(item.productId);
      return `${product?.name || `Producto #${item.productId}`} x${item.quantity}`;
    })
    .join(', ');

  return note ? `${summary}. ${note}` : summary;
}

function groupMovementRows(rows) {
  const groups = new Map();

  rows.forEach((row) => {
    const key = row.batch_code ? `batch:${row.batch_code}` : `row:${row.id}`;
    const quantity = Number(row.quantity || 0);
    const unitPrice = Number(row.price || 0);
    const item = {
      productId: row.product_id == null ? null : Number(row.product_id),
      productName: row.product_name ?? '',
      quantity,
      unitPrice,
      subtotal: unitPrice * quantity
    };

    if (!groups.has(key)) {
      groups.set(key, {
        id: Number(row.id),
        productId: row.batch_code ? null : Number(row.product_id),
        productName: row.product_name ?? '',
        movementType: row.batch_code ? 'SALE' : row.movement_type,
        quantity,
        reason: row.reason,
        note: row.note ?? '',
        createdAt: row.created_at,
        batchCode: row.batch_code ?? '',
        items: [item],
        totalAmount: unitPrice * quantity
      });
      return;
    }

    const group = groups.get(key);
    group.quantity += quantity;
    group.items.push(item);
    group.totalAmount += unitPrice * quantity;
  });

  return [...groups.values()].map((group) => {
    if (!group.batchCode || group.items.length === 1) {
      return group;
    }

    return {
      ...group,
      productName: `${group.items.length} repuestos`,
      note: `${group.items.map((item) => `${item.productName} x${item.quantity}`).join(', ')}${group.note ? ` - ${group.note}` : ''}`
    };
  });
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

ensureSchema()
  .then(() => {
    app.listen(port, () => {
      console.log(`Stockmanager listening on http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error('Failed to initialize application:', error);
    process.exit(1);
  });
