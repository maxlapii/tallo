-- P4-P8: sales, sale items (with historical price/name), payments, refunds.
CREATE TABLE customers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  phone      TEXT,
  email      TEXT,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE sales (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_no     TEXT    NOT NULL UNIQUE,
  cashier_id     INTEGER NOT NULL REFERENCES users(id),
  register_id    INTEGER NOT NULL REFERENCES registers(id),
  customer_id    INTEGER REFERENCES customers(id),
  status         TEXT    NOT NULL DEFAULT 'COMPLETED'
                 CHECK (status IN ('COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED')),
  subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0),
  discount_cents INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  tax_cents      INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents    INTEGER NOT NULL CHECK (total_cents >= 0),
  paid_cents     INTEGER NOT NULL CHECK (paid_cents >= 0),
  change_cents   INTEGER NOT NULL DEFAULT 0 CHECK (change_cents >= 0),
  note           TEXT,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_sales_receipt_no ON sales(receipt_no);
CREATE INDEX idx_sales_created_at ON sales(created_at);
CREATE INDEX idx_sales_cashier_id ON sales(cashier_id);
CREATE INDEX idx_sales_register_id ON sales(register_id);

CREATE TABLE sale_items (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id           INTEGER NOT NULL REFERENCES sales(id),
  product_id        INTEGER NOT NULL REFERENCES products(id),
  product_name      TEXT    NOT NULL,
  product_sku       TEXT    NOT NULL,
  quantity          INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents  INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  unit_cost_cents   INTEGER NOT NULL DEFAULT 0,
  tax_rate_bp       INTEGER NOT NULL DEFAULT 0,
  subtotal_cents    INTEGER NOT NULL,
  discount_cents    INTEGER NOT NULL DEFAULT 0,
  tax_cents         INTEGER NOT NULL DEFAULT 0,
  total_cents       INTEGER NOT NULL,
  refunded_quantity INTEGER NOT NULL DEFAULT 0 CHECK (refunded_quantity >= 0 AND refunded_quantity <= quantity)
);

CREATE INDEX idx_sale_items_sale_id ON sale_items(sale_id);
CREATE INDEX idx_sale_items_product_id ON sale_items(product_id);

CREATE TABLE payments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id        INTEGER NOT NULL REFERENCES sales(id),
  payment_method TEXT    NOT NULL CHECK (payment_method IN ('CASH', 'CARD', 'QR')),
  amount_cents   INTEGER NOT NULL CHECK (amount_cents > 0),
  reference_no   TEXT,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_payments_sale_id ON payments(sale_id);
CREATE INDEX idx_payments_method ON payments(payment_method);

CREATE TABLE refunds (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id        INTEGER NOT NULL REFERENCES sales(id),
  user_id        INTEGER NOT NULL REFERENCES users(id),
  register_id    INTEGER REFERENCES registers(id),
  refund_method  TEXT    NOT NULL CHECK (refund_method IN ('CASH', 'CARD', 'QR')),
  reason         TEXT,
  subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0),
  tax_cents      INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents    INTEGER NOT NULL CHECK (total_cents >= 0),
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_refunds_sale_id ON refunds(sale_id);
CREATE INDEX idx_refunds_created_at ON refunds(created_at);

CREATE TABLE refund_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  refund_id        INTEGER NOT NULL REFERENCES refunds(id),
  sale_item_id     INTEGER NOT NULL REFERENCES sale_items(id),
  product_id       INTEGER NOT NULL REFERENCES products(id),
  quantity         INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL,
  subtotal_cents   INTEGER NOT NULL,
  tax_cents        INTEGER NOT NULL DEFAULT 0,
  total_cents      INTEGER NOT NULL
);

CREATE INDEX idx_refund_items_refund_id ON refund_items(refund_id);
CREATE INDEX idx_refund_items_sale_item_id ON refund_items(sale_item_id);
