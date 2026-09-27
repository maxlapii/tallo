-- P2: every stock change is recorded here with the reason and the resulting stock.
CREATE TABLE inventory_movements (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id     INTEGER NOT NULL REFERENCES products(id),
  type           TEXT    NOT NULL CHECK (type IN ('PURCHASE', 'SALE', 'RETURN', 'DAMAGE', 'ADJUSTMENT')),
  quantity       INTEGER NOT NULL CHECK (quantity <> 0),
  stock_after    INTEGER NOT NULL CHECK (stock_after >= 0),
  reference_type TEXT,
  reference_id   INTEGER,
  note           TEXT,
  user_id        INTEGER REFERENCES users(id),
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_inventory_movements_product_id ON inventory_movements(product_id);
CREATE INDEX idx_inventory_movements_reference ON inventory_movements(reference_type, reference_id);
CREATE INDEX idx_inventory_movements_created_at ON inventory_movements(created_at);
