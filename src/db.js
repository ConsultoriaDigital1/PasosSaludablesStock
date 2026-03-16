import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required');
}

export const sql = neon(databaseUrl);

export async function ensureSchema() {
  await sql`
    CREATE TABLE IF NOT EXISTS categories (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price DECIMAL(10,2) NOT NULL DEFAULT 0,
      category VARCHAR(255) NOT NULL DEFAULT 'Sin categoria',
      image TEXT,
      images TEXT[],
      featured BOOLEAN DEFAULT false,
      stock_quantity INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS stock_movements (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      movement_type VARCHAR(20) NOT NULL,
      quantity INTEGER NOT NULL,
      reason VARCHAR(255) NOT NULL,
      note TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS treasury_transactions (
      id SERIAL PRIMARY KEY,
      transaction_type VARCHAR(30) NOT NULL,
      category VARCHAR(255) NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      payment_method VARCHAR(100),
      reference VARCHAR(255),
      note TEXT,
      occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await sql`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS featured BOOLEAN DEFAULT false
  `;

  await sql`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS stock_quantity INTEGER NOT NULL DEFAULT 0
  `;

  await sql`
    ALTER TABLE stock_movements
    ADD COLUMN IF NOT EXISTS batch_code VARCHAR(64)
  `;
}

export function mapProduct(row) {
  return {
    id: Number(row.id),
    name: row.name,
    description: row.description ?? '',
    price: Number(row.price),
    category: row.category,
    image: row.image ?? '',
    images: Array.isArray(row.images) ? row.images : [],
    featured: Boolean(row.featured),
    stockQuantity: Number(row.stock_quantity ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function mapCategory(row) {
  return {
    id: Number(row.id),
    name: row.name,
    description: row.description ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function mapMovement(row) {
  return {
    id: Number(row.id),
    productId: row.product_id == null ? null : Number(row.product_id),
    productName: row.product_name ?? '',
    movementType: row.movement_type,
    quantity: Number(row.quantity),
    reason: row.reason,
    note: row.note ?? '',
    createdAt: row.created_at,
    batchCode: row.batch_code ?? '',
    items: Array.isArray(row.items) ? row.items : [],
    totalAmount: row.total_amount == null ? null : Number(row.total_amount)
  };
}

export function mapTransaction(row) {
  return {
    id: Number(row.id),
    transactionType: row.transaction_type,
    category: row.category,
    amount: Number(row.amount),
    paymentMethod: row.payment_method ?? '',
    reference: row.reference ?? '',
    note: row.note ?? '',
    occurredAt: row.occurred_at,
    createdAt: row.created_at
  };
}
