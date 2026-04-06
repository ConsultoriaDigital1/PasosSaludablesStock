# Pasos Saludables Stock

App simple para inventario, movimientos y caja sobre Postgres.

## Cambio de base de datos

Cambiar `DATABASE_URL` solo apunta la app a otra base. No migra datos. Si la base nueva esta vacia, la app crea el esquema actual al arrancar, pero el contenido viejo no se copia solo.

### Paso a paso real

1. Deja la base nueva en `.env` como `DATABASE_URL`.
2. Agrega la base vieja en `.env` como `SOURCE_DATABASE_URL`.
3. Ejecuta la migracion:

```bash
npm run db:migrate
```

4. Si la base nueva ya tiene datos y quieres reemplazarlos:

```bash
npm run db:migrate -- --force
```

5. Levanta la app:

```bash
npm run dev
```

## Que hace la migracion

- Sincroniza el esquema en origen y destino con la version actual de la app.
- Vacia la base destino antes de copiar, solo si ejecutas con `--force` cuando ya tenia datos.
- Copia `categories`, `products`, `stock_movements` y `treasury_transactions`.
- Conserva ids, fechas y relaciones para no romper referencias.
- Reajusta las secuencias para que los proximos inserts no choquen.

## Uso normal

```bash
npm install
npm run dev
```

Abrir `http://localhost:4010`.

## API key para n8n

Si quieres consumir la API desde n8n sin hacer login JWT, define `N8N_API_KEY` en `.env`.

El middleware acepta cualquiera de estas dos variantes:

- Header `x-api-key: TU_API_KEY`
- Header `Authorization: Bearer TU_API_KEY`

Para obtener todos los productos:

```bash
curl http://localhost:4010/api/products ^
  -H "x-api-key: TU_API_KEY"
```
