-- P9: cash registers. Created before sales so sales can reference the open register.
CREATE TABLE registers (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             INTEGER NOT NULL REFERENCES users(id),
  status              TEXT    NOT NULL CHECK (status IN ('OPEN', 'CLOSED')),
  opening_cash_cents  INTEGER NOT NULL CHECK (opening_cash_cents >= 0),
  expected_cash_cents INTEGER,
  actual_cash_cents   INTEGER,
  difference_cents    INTEGER,
  opened_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  closed_at           TEXT,
  note                TEXT
);

CREATE INDEX idx_registers_user_id ON registers(user_id);
CREATE INDEX idx_registers_status ON registers(status);
-- Only one OPEN register per user.
CREATE UNIQUE INDEX idx_registers_one_open_per_user ON registers(user_id) WHERE status = 'OPEN';

CREATE TABLE cash_movements (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  register_id    INTEGER NOT NULL REFERENCES registers(id),
  type           TEXT    NOT NULL CHECK (type IN ('OPENING', 'SALE', 'REFUND', 'CASH_IN', 'CASH_OUT')),
  amount_cents   INTEGER NOT NULL CHECK (amount_cents <> 0),
  reference_type TEXT,
  reference_id   INTEGER,
  note           TEXT,
  user_id        INTEGER REFERENCES users(id),
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_cash_movements_register_id ON cash_movements(register_id);
CREATE INDEX idx_cash_movements_reference ON cash_movements(reference_type, reference_id);
