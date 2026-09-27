-- Printers per area (counter, drink maker, kitchen 1, ...) and print jobs routed to them.
CREATE TABLE printers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL,
  area            TEXT    NOT NULL,
  type            TEXT    NOT NULL CHECK (type IN ('BROWSER', 'NETWORK')),
  host            TEXT,
  port            INTEGER,
  prints_receipts INTEGER NOT NULL DEFAULT 0 CHECK (prints_receipts IN (0, 1)),
  prints_tickets  INTEGER NOT NULL DEFAULT 1 CHECK (prints_tickets IN (0, 1)),
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Routing: a product's own printer wins, otherwise its category's printer.
ALTER TABLE categories ADD COLUMN printer_id INTEGER REFERENCES printers(id);
ALTER TABLE products ADD COLUMN printer_id INTEGER REFERENCES printers(id);
CREATE INDEX idx_categories_printer_id ON categories(printer_id);
CREATE INDEX idx_products_printer_id ON products(printer_id);

CREATE TABLE print_jobs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id    INTEGER NOT NULL REFERENCES sales(id),
  printer_id INTEGER NOT NULL REFERENCES printers(id),
  kind       TEXT    NOT NULL CHECK (kind IN ('RECEIPT', 'TICKET')),
  status     TEXT    NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'SENDING', 'PRINTED', 'FAILED')),
  payload    TEXT    NOT NULL,
  error      TEXT,
  attempts   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  printed_at TEXT
);

CREATE INDEX idx_print_jobs_printer_status ON print_jobs(printer_id, status);
CREATE INDEX idx_print_jobs_sale_id ON print_jobs(sale_id);
CREATE INDEX idx_print_jobs_created_at ON print_jobs(created_at);
