# Setup and technical reference

Everything needed to install, configure, run, and develop Tallo. For what the app does, see [README.md](README.md).

## Requirements

- Node.js >= 22.13 (uses the built-in `node:sqlite` driver, no native build step)
- npm >= 10

## Quick start

```bash
npm install
cp server/.env.example server/.env   # then set a real JWT_SECRET
npm run db:seed                       # create + seed the "demo" store
npm run dev                           # API on :3000, UI on :5173
```

Seeded logins for the `demo` store (development/test only; sign in with store code `demo`):

| Username | Password        | Role    | What they can do                                                  |
| -------- | --------------- | ------- | ----------------------------------------------------------------- |
| admin    | `test-password` | ADMIN   | Everything, including products, stock, users, reports, refunds    |
| cashier  | `test-password` | CASHIER | Runs a cash register, sells, refunds, views stock and reports     |
| sale     | `test-password` | SALE    | Order-only: browses the catalogue, places orders, sees own orders |

Seeded products: `COKE-001` Coca Cola $2.00, `BURGER-001` Burger $5.00, `WATER-001` Water $1.00 (0% tax), plus chips,
fries, and coffee, each with a photo.

Workspace scripts run with `server/` as the working directory, so `.env` and the data directory (`server/data`,
configurable with `DATA_DIR`) live there.

## Privacy: one private database per store

The project is open source and anyone can try it, so data isolation is structural rather than a query filter:

- **Every store is its own SQLite file** (`DATA_DIR/stores/<code>.db`, created with `0600` permissions). Users,
  products, sales, receipts, customers, and print jobs of a store exist only in that file. A request can only ever
  reach the database of the store its token was issued for, so there is no shared table that could leak across stores.
- **The directory database** (`DATA_DIR/directory.db`) holds only store codes, display names, and creation dates.
- **Self-serve signup** (`/signup`, rate-limited, can be disabled with `ALLOW_SIGNUP=false`) provisions a new store
  with its own admin account. Sign-in needs the store code plus username and password; unknown store codes and wrong
  passwords return the same error.
- **Tokens are store-bound** (the store code is a JWT claim), so a token from one store is useless against another.
- **Live events are scoped per store**: a device only receives events from its own store.
- **Owner controls**: admins can export their store as a standard SQLite file (data portability) and permanently
  delete it after confirming their password (right to erasure). Deletion removes the file immediately.
- **Secrets and logs**: passwords are stored only as bcrypt hashes, tokens are redacted from logs, request bodies are
  never logged, and `.env` files are git-ignored. Card and QR payments store only an optional reference number.
- **Disk encryption** is the host's responsibility: SQLite files are not encrypted by the app. Run the server on an
  encrypted volume and keep `DATA_DIR` out of any public path.

Development uses a seeded `demo` store (`npm run db:seed`); production servers simply start empty and let each
team create their own store.

## Roles

| Capability                                | ADMIN | CASHIER | SALE |
| ----------------------------------------- | :---: | :-----: | :--: |
| Sign in on any number of devices          |  yes  |   yes   | yes  |
| Browse catalogue (with live stock counts) |  yes  |   yes   | yes  |
| Place orders (checkout)                   |  yes  |   yes   | yes  |
| View sales history                        |  all  |   all   | own  |
| Refund                                    |  yes  |   yes   |  no  |
| Open / close register, cash in / out      |  yes  |   yes   |  no  |
| Stock page, movements, adjustments        |  yes  |  view   |  no  |
| Products and categories                   | edit  |  view   |  no  |
| Reports                                   |  yes  |   yes   |  no  |
| Users and roles                           |  yes  |   no    |  no  |

**Shifts.** A cashier opens a shift with an opening float and closes it with a cash count; the UI calls this a
"shift" while the API and database keep the `registers` name. **How SALE orders are booked.** Sales staff do not run
a cash drawer. Their orders are attached to the store's most recently opened shift, so the cash is reconciled by the
cashier responsible for that drawer. If no shift is open the POS shows "Waiting for shift" and the API rejects the
order with `REGISTER_NOT_OPEN`.

**Multiple devices.** Admins create Sales accounts from the Users page (one per device, or one shared account). Sessions
are stateless JWTs, so the same account can be signed in on several devices at once.

## POS screen modes

- **Full screen** (any role): the toolbar button hides the sidebar and header and asks the browser for full screen, giving the catalogue and cart the whole display. Press the button again or Esc to leave. On browsers without the Fullscreen API (for example iOS Safari) the chrome is still hidden.
- **Customer display / dual screen** (ADMIN and CASHIER): the toolbar button opens `/display` in a second window; drag it to the customer-facing monitor (browsers that support the Window Management API place it on the second screen automatically). It shows a welcome screen, the running order with photos, discount, tax and total, then the change due after payment. The two windows are synced through a `BroadcastChannel` in the same browser session, so it works offline and needs no server round-trip. The POS button shows "Customer display on" while a display window is connected.

## Printing by area

Printers are set up per **area** (Counter, Drink maker, Kitchen 1, Kitchen 2, … as many as needed) on the Admin →
Printers page. Each printer is either:

- **Network (ESC/POS)**: the server sends the ticket straight to the printer over raw TCP (host + port, usually 9100),
  with a "Test" button to check reachability. Failed jobs are recorded with the error and can be reprinted.
- **Browser / print station**: any device at that area (a kitchen tablet, the counter PC) opens **Print station**,
  picks its area, and receives that area's jobs live. Jobs can be printed with the device's own printer (browser
  print, optionally automatic) and marked done so every other screen sees it.

**Routing**: each category has a default print area; a product can override it. When an order is placed, the server
creates one **ticket** per area containing only that area's items, plus a **receipt** on every printer flagged
"prints receipts" (the counter). Jobs are created after the sale commits and are pushed over the live event stream,
so a printing problem can never fail or delay a sale. Tickets and receipts can be reprinted from the sale page or
from the print jobs list.

Seeded routing: Beverages → Drink maker, Food → Kitchen 1, Snacks → Kitchen 2, receipts → Counter (all seeded as
browser printers, so nothing needs hardware to try it).

## Real-time updates

The API exposes a Server-Sent Events stream at `GET /api/events` (token via `Authorization` header or `?token=`; the
request logger redacts it). Events are emitted **after** the database transaction commits:

| Event              | Payload                                             | Triggered by                                                    |
| ------------------ | --------------------------------------------------- | --------------------------------------------------------------- |
| `sale.created`     | sale id, receipt number, total, cashier, item count | checkout on any device                                          |
| `stock.changed`    | list of `{ productId, sku, stockQty }`              | checkout, refund, stock adjustment, product creation with stock |
| `refund.created`   | sale id, refund id, total                           | refund                                                          |
| `register.changed` | register id, user id, status                        | open, close, cash in, cash out                                  |

The UI keeps one connection per session (a "Live" indicator sits in the header). The POS updates product stock in
place, cashiers and admins get a notification when another device places an order, and the history, dashboard,
register, and stock pages refresh themselves. No polling.

The bus is in-process, which matches the single-server SQLite deployment. Running several API instances would require a
shared broker (for example Redis pub/sub).

## Scripts

| Script                     | Purpose                                                       |
| -------------------------- | ------------------------------------------------------------- |
| `npm run dev`              | Run API and UI with hot reload                                |
| `npm run build`            | Compile shared, server (`server/dist`) and UI (`client/dist`) |
| `npm run start`            | Run the compiled server                                       |
| `npm run lint`             | ESLint over the whole repo                                    |
| `npm run typecheck`        | TypeScript strict checks for shared, server and client        |
| `npm run test`             | Shared unit tests + server unit/integration tests (Vitest)    |
| `npm run test:unit`        | Unit tests only                                               |
| `npm run test:integration` | API/database integration tests only                           |
| `npm run test:watch`       | Vitest in watch mode                                          |
| `npm run test:coverage`    | Tests with V8 coverage (`shared/coverage`, `server/coverage`) |
| `npm run test:e2e`         | Playwright end-to-end tests (starts both servers)             |
| `npm run db:migrate`       | Apply pending migrations to every store                       |
| `npm run db:seed`          | Create the `demo` store if needed and seed it                 |
| `npm run db:reset`         | Delete and recreate the seeded `demo` store (non-prod)        |
| `npm run ci`               | lint → typecheck → coverage → build → e2e                     |
| `npm run docs:screenshots` | Regenerate README screenshots against a running dev stack     |

Before the first E2E run: `npx playwright install chromium`.

## Project layout

```
shared/            Pure business logic used by both sides: money (integer cents),
                   cart calculation (discount allocation, per-line tax rounding), payment validation
server/            Express API (TypeScript, ESM)
  src/config       Environment configuration (validated with zod)
  src/db           SQLite wrapper, migration runner, SQL migrations, seed, CLI
  src/middleware   auth (JWT), role authorization, validation, rate limit, errors, logging
  src/realtime     In-process event bus feeding the SSE stream
  src/services     Business logic (no Express types here)
  src/routes       Thin HTTP routers
  tests/unit       Pure logic tests
  tests/integration  Supertest against the full app with an in-memory DB (incl. SSE stream tests)
client/            Vite + React UI (POS, products, stock, history, register, reports, users)
  src/realtime     EventSource provider and `useLiveEvents` hook
e2e/               Playwright specs (E2E-01 … E2E-08 + MVP smoke scenario)
```

## Conventions

- **Money**: stored and calculated as integer cents; tax rates in basis points. The API exchanges decimal amounts (e.g. `9.35`) with at most two decimals.
- **Errors**: every API error is `{ "error": { "code", "message", "details?" } }`. Codes are listed in `server/src/utils/errors.ts`.
- **Auth**: `POST /api/auth/login` returns a JWT; send it as `Authorization: Bearer <token>`. Roles: `ADMIN`, `CASHIER`, `SALE`.
- **Timestamps**: stored as ISO-8601 UTC text. Report date filters are `YYYY-MM-DD` in UTC.
- **Transactions**: every multi-statement write runs in `db.transaction(() => ...)`; nested calls become savepoints.
- **Stock**: `applyStockChange()` is the only place stock changes; it always writes an `inventory_movements` row.
- **Sales are immutable**: no update/delete routes; refunds are separate rows that reference the sale.
- **Audit**: `recordAudit()` runs inside the same transaction as the audited change.
- **Live events**: services broadcast on `eventBus` only after their transaction commits.
- **Migrations**: add `server/src/db/migrations/NNN_name.sql`; never edit an applied migration. The runner disables foreign-key enforcement while migrations run (needed for table rebuilds) and verifies integrity afterwards.
- **Product images**: products carry an optional `imageUrl` (http/https). The UI shows the photo when it loads and a category-tinted initials tile otherwise; there is no file upload in the MVP.

## API

| Method              | Path                                                      | Role           | Description                                                                                     |
| ------------------- | --------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------- |
| GET                 | `/api/health`                                             | none           | Liveness + DB check                                                                             |
| POST                | `/api/auth/login`                                         | none           | Login (rate limited)                                                                            |
| GET                 | `/api/auth/me`                                            | any            | Current user                                                                                    |
| GET                 | `/api/events`                                             | any            | Server-Sent Events live stream                                                                  |
| GET / POST / PUT    | `/api/users[/:id]`                                        | ADMIN          | List, create, update users and roles (audited)                                                  |
| GET                 | `/api/categories`                                         | any            | List categories                                                                                 |
| POST / PUT          | `/api/categories[/:id]`                                   | ADMIN          | Create / update category                                                                        |
| GET                 | `/api/products`                                           | any            | Search (`q`, `categoryId`, `active`, `lowStock`); includes stock counts                         |
| GET                 | `/api/products/lookup?code=`                              | any            | Exact barcode/SKU lookup for scanners                                                           |
| POST / PUT / DELETE | `/api/products[/:id]`                                     | ADMIN          | Product CRUD (delete deactivates when history exists)                                           |
| GET                 | `/api/inventory`                                          | ADMIN, CASHIER | Stock levels + low-stock count                                                                  |
| GET                 | `/api/inventory/movements`                                | ADMIN, CASHIER | Movement history (`productId`, `type`)                                                          |
| POST                | `/api/inventory/adjust`                                   | ADMIN          | Manual stock change (audited)                                                                   |
| POST                | `/api/sales`                                              | any            | Checkout (requires an open register; SALE uses the store register)                              |
| GET                 | `/api/sales`                                              | any            | History (`from`, `to`, `receiptNo`, `cashierId`, `paymentMethod`, `status`); SALE sees own only |
| GET                 | `/api/sales/:id`, `/api/sales/:id/receipt`                | any            | Sale detail and printable receipt; SALE limited to own orders                                   |
| POST                | `/api/sales/:id/refund`                                   | ADMIN, CASHIER | Refund items (cash refunds need an open register)                                               |
| GET                 | `/api/registers/status`                                   | any            | Can this user sell right now?                                                                   |
| GET                 | `/api/registers/current`, `/api/registers[/:id]`          | ADMIN, CASHIER | Own open register; own registers (admins see all)                                               |
| POST                | `/api/registers/open`, `close`, `cash-in`, `cash-out`     | ADMIN, CASHIER | Register lifecycle                                                                              |
| GET                 | `/api/reports/daily`, `payments`, `products`, `inventory` | ADMIN, CASHIER | Reports (`date` or `from`/`to`)                                                                 |

### Checkout request

```json
{
  "items": [{ "productId": 1, "quantity": 2 }],
  "discount": 0.5,
  "payments": [{ "method": "CASH", "amount": 10 }],
  "customerName": "optional"
}
```

The server recalculates every amount; totals sent by a client are ignored. Card/QR payments may not exceed the
total; cash overpayment is returned as change. All of checkout runs in one transaction with inventory deduction, and
the resulting `sale.created` / `stock.changed` events are pushed to every connected device.
