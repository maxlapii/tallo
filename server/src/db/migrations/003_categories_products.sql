-- P1: product catalogue. Money is stored as integer cents; tax rate in basis points.
CREATE TABLE categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE products (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  sku                 TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  barcode             TEXT    UNIQUE,
  name                TEXT    NOT NULL,
  category_id         INTEGER REFERENCES categories(id),
  cost_price_cents    INTEGER NOT NULL DEFAULT 0 CHECK (cost_price_cents >= 0),
  price_cents         INTEGER NOT NULL CHECK (price_cents >= 0),
  tax_rate_bp         INTEGER NOT NULL DEFAULT 0 CHECK (tax_rate_bp >= 0 AND tax_rate_bp <= 10000),
  stock_qty           INTEGER NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  low_stock_threshold INTEGER NOT NULL DEFAULT 0 CHECK (low_stock_threshold >= 0),
  active              INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_products_sku ON products(sku);
CREATE INDEX idx_products_barcode ON products(barcode);
CREATE INDEX idx_products_category_id ON products(category_id);
CREATE INDEX idx_products_name ON products(name COLLATE NOCASE);
