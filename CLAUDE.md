# Lightweight POS System — AI Implementation Prompt

You are a senior full-stack software engineer. Build a lightweight, production-ready Point of Sale (POS) system.

The primary goal is to deliver a **working MVP first**, with simple architecture, minimal dependencies, clear code, and strong automated test coverage.

Do not over-engineer the system. Do not introduce microservices, event buses, Kubernetes, CQRS, or other unnecessary infrastructure.

---

# 1. Primary Objective

Build a POS system that allows a cashier to:

1. Log in
2. View/search products
3. Scan/search products by barcode/SKU
4. Add products to a cart
5. Change quantities
6. Apply discounts
7. Calculate tax
8. Complete a sale
9. Accept payment
10. Generate a receipt
11. Automatically reduce inventory
12. View sales history
13. Process basic refunds
14. View basic sales/inventory reports

The MVP must be usable from beginning to end:

```text
Login
  ↓
Open Register
  ↓
Scan/Search Product
  ↓
Add to Cart
  ↓
Checkout
  ↓
Payment
  ↓
Complete Sale
  ↓
Update Inventory
  ↓
Receipt
  ↓
Sales Report
```

---

# 2. Technology Requirements

Use a lightweight stack.

Preferred:

```text
Frontend: React + TypeScript
Backend: Node.js + TypeScript
API: REST
Database: SQLite for MVP
ORM/Query Layer: lightweight ORM or SQL layer
Testing: Vitest/Jest + API integration tests
E2E: Playwright
```

If the existing project already has a technology stack, inspect it first and use the existing stack instead of replacing it.

Use PostgreSQL only when the application requires multiple POS terminals or concurrent users beyond what SQLite is appropriate for.

---

# 3. Development Principles

Follow these rules:

- MVP first.
- Simple architecture.
- Keep dependencies minimal.
- TypeScript strict mode.
- Validate all external input.
- Use database transactions for financial operations.
- Never silently lose inventory.
- Never silently modify completed sales.
- Do not delete historical sales.
- Store historical product price/name in sale items.
- Use decimal-safe monetary calculations.
- Use UTC timestamps internally where appropriate.
- Add database indexes for frequently searched fields.
- Keep business logic outside controllers.
- Write tests before declaring a feature complete.
- Do not implement future features unless they are required by the MVP.

---

# 4. Priority Order

Implement features in exactly this priority order.

## P0 — Foundation

Build first:

- Project structure
- Database connection
- Database migrations
- Seed data
- Environment configuration
- Error handling
- Logging
- Authentication
- User roles
- Basic API structure
- Basic frontend shell

Acceptance criteria:

```text
Application starts successfully.
Database can be created from scratch.
Migrations work.
Seed data works.
User can log in.
Unauthorized API requests are rejected.
```

Required tests:

- Database initialization
- Migration
- Seed
- Login success
- Login failure
- Unauthorized request
- Role authorization

Do not continue to P1 until P0 tests pass.

---

# 5. P1 — Product Management

Implement:

- Categories
- Products
- SKU
- Barcode
- Product name
- Cost price
- Selling price
- Tax rate
- Current stock
- Low-stock threshold
- Active/inactive status

API:

```text
GET    /api/products
GET    /api/products/:id
POST   /api/products
PUT    /api/products/:id
DELETE /api/products/:id
```

Category API:

```text
GET    /api/categories
POST   /api/categories
PUT    /api/categories/:id
```

Product search must support:

```text
SKU
Barcode
Product name
```

Acceptance criteria:

- Admin can create product.
- Admin can edit product.
- Product can be searched by barcode.
- Product can be searched by SKU.
- Inactive products cannot be sold.
- Duplicate SKU is rejected.
- Duplicate barcode is rejected.

Tests:

### Unit tests

Test:

- Product validation
- Price validation
- Tax validation
- SKU validation
- Barcode validation

### Integration tests

Test:

- Create product
- Update product
- Search product
- Duplicate SKU
- Duplicate barcode
- Inactive product

### E2E tests

Test:

```text
Login
→ Product page
→ Create product
→ Search product
→ Verify product
```

Do not continue to P2 until tests pass.

---

# 6. P2 — Inventory

Implement inventory management.

Database:

```text
products
inventory_movements
```

Inventory movement types:

```text
PURCHASE
SALE
RETURN
DAMAGE
ADJUSTMENT
```

Implement:

```text
GET /api/inventory
GET /api/inventory/movements
POST /api/inventory/adjust
```

Important rule:

Every stock change must create an inventory movement.

Example:

```text
Product stock = 10

Sale quantity = 2

New stock = 8

Inventory movement:

SALE
quantity = -2
reference_type = SALE
reference_id = <sale id>
```

Do not modify inventory without recording why the stock changed.

Tests:

### Unit

- Stock calculation
- Positive adjustment
- Negative adjustment
- Cannot create invalid stock movement

### Integration

- Stock adjustment
- Inventory movement creation
- Stock query
- Low-stock detection

### Critical test

```text
Initial stock = 10
Adjustment = -3
Expected stock = 7
Expected movement = -3
```

Also test transaction rollback:

```text
If inventory update fails,
the stock and movement must both remain unchanged.
```

---

# 7. P3 — POS Cart

Build the main POS screen.

Required functionality:

- Product search
- Barcode search
- Add item
- Remove item
- Increase quantity
- Decrease quantity
- Manual quantity
- Discount
- Tax calculation
- Subtotal
- Total

Example:

```text
Product       Qty     Price      Total
---------------------------------------
Coke           2       2.00       4.00
Burger         1       5.00       5.00

Subtotal:                         9.00
Discount:                         0.50
Tax:                              0.85
---------------------------------------
TOTAL:                            9.35
```

The calculation logic should be implemented in a reusable service/function rather than directly inside UI components.

Tests:

### Unit tests

Test:

- Add item
- Remove item
- Change quantity
- Subtotal
- Discount
- Tax
- Total
- Empty cart
- Multiple products
- Decimal quantities if supported

Use table-driven tests for calculation logic.

Example scenarios:

```text
1 x $10 = $10
2 x $10 = $20
$20 - $5 discount = $15
$15 + 10% tax = $16.50
```

Include rounding tests.

---

# 8. P4 — Checkout / Sales

This is the most important MVP feature.

Database:

```text
sales
sale_items
payments
```

Endpoint:

```text
POST /api/sales
GET  /api/sales
GET  /api/sales/:id
```

Checkout request example:

```json
{
  "items": [
    {
      "product_id": 1,
      "quantity": 2
    }
  ],
  "discount": 0,
  "payments": [
    {
      "method": "CASH",
      "amount": 20
    }
  ]
}
```

The server must calculate the final amount.

Never trust totals calculated by the frontend.

---

# 9. Checkout Transaction

Checkout must use a database transaction.

Conceptually:

```text
BEGIN TRANSACTION

1. Validate cashier
2. Validate products
3. Validate product status
4. Validate stock
5. Calculate prices
6. Calculate discount
7. Calculate tax
8. Create sale
9. Create sale items
10. Create payment
11. Reduce inventory
12. Create inventory movements

COMMIT
```

If any step fails:

```text
ROLLBACK
```

Nothing should be partially saved.

This is a critical requirement.

---

# 10. Checkout Tests

Write extensive tests.

### Successful sale

```text
Stock = 10
Quantity sold = 2

Expected:
Sale created
Sale item created
Payment created
Stock = 8
Inventory movement = -2
```

### Insufficient stock

```text
Stock = 1
Quantity requested = 2

Expected:
Sale rejected
No sale record
No payment
Stock remains 1
No inventory movement
```

### Invalid product

Expected:

```text
Sale rejected
No database changes
```

### Payment mismatch

If:

```text
Total = $20
Payment = $15
```

reject the sale unless partial payment is explicitly supported.

### Exact payment

```text
Total = $20
Payment = $20
```

Sale succeeds.

### Overpayment

For cash:

```text
Total = $20
Cash = $25
Change = $5
```

Sale succeeds.

For card/QR:

Do not allow an amount greater than the required total unless explicitly supported.

### Database failure

Simulate failure during inventory update.

Expected:

```text
No sale
No payment
No stock change
No inventory movement
```

This test is mandatory.

---

# 11. P5 — Payment

Support MVP payment methods:

```text
CASH
CARD
QR
```

Payment table:

```text
payments
---------
id
sale_id
payment_method
amount
reference_no
created_at
```

Support split payments if it does not significantly complicate the implementation.

Example:

```text
Total = $100

Cash = $40
Card = $60
```

If split payments are implemented, test them thoroughly.

For cash payment calculate:

```text
change = cash_received - total
```

Never store only the payment method on the sale.

---

# 12. P6 — Receipt

After successful checkout:

Display a receipt containing:

```text
Store Name

Receipt #: 000001
Date:
Cashier:

Product       Qty    Price    Total
------------------------------------
Coke           2     2.00      4.00
Burger         1     5.00      5.00

Subtotal:                9.00
Discount:                0.50
Tax:                     0.85
Total:                   9.35

Payment:                 CASH
Received:               10.00
Change:                  0.65

Thank you
```

Receipt should be printable.

Do not make a physical printer mandatory for the MVP.

Browser printing is acceptable initially.

Test:

- Receipt data
- Receipt total
- Receipt number
- Payment information
- Historical prices

---

# 13. P7 — Sales History

Implement:

```text
GET /api/sales
GET /api/sales/:id
```

Support:

- Date filter
- Receipt number
- Cashier
- Payment method

Display:

```text
Receipt
Date
Cashier
Total
Payment
Status
```

Completed sales must remain immutable.

Do not allow normal users to edit completed sales.

---

# 14. P8 — Refund

Implement basic refund functionality.

Endpoint:

```text
POST /api/sales/:id/refund
```

Refund flow:

```text
Find sale
    ↓
Select item
    ↓
Select quantity
    ↓
Validate refundable quantity
    ↓
Create refund
    ↓
Return inventory
    ↓
Create inventory movement
    ↓
Refund payment
```

Prevent refunding more than the original sold quantity.

Tests:

```text
Sale quantity = 5
Refund = 2
Allowed

Already refunded = 2
New refund = 4
Reject
```

Test inventory return:

```text
Original stock = 10
Sale = -5
Refund = +2

Final stock = 7
```

---

# 15. P9 — Cash Register

Implement:

```text
Open register
Close register
Opening cash
Cash sales
Cash in
Cash out
Expected cash
Actual cash
Difference
```

Database:

```text
registers
cash_movements
```

Register lifecycle:

```text
CLOSED
   ↓
OPEN
   ↓
CLOSED
```

Prevent two active registers for the same terminal/user where applicable.

Tests:

- Open register
- Cannot open duplicate register
- Cash sale affects expected cash
- Cash in
- Cash out
- Close register
- Cash difference calculation

---

# 16. P10 — Basic Reports

Implement only these MVP reports.

### Daily sales

```text
Total transactions
Gross sales
Discounts
Tax
Net sales
Refunds
```

### Payment summary

```text
Cash
Card
QR
Total
```

### Product sales

```text
Product
Quantity sold
Revenue
```

### Inventory

```text
Product
Current stock
Low-stock status
```

Reports must be calculated from transaction data rather than duplicated counters wherever practical.

Tests must verify report totals against known test sales.

---

# 17. Database Schema

Use this core schema:

```text
users
categories
products
customers

sales
sale_items
payments

inventory_movements

registers
cash_movements

refunds
refund_items
```

Relationships:

```text
categories
    │
    └── products
          │
          └── inventory_movements

users
    │
    ├── sales
    └── registers

sales
    ├── sale_items
    ├── payments
    └── refunds
           │
           └── refund_items
```

Use foreign keys.

Use indexes on:

```text
products.sku
products.barcode
products.category_id

sales.receipt_no
sales.created_at
sales.cashier_id

sale_items.sale_id
sale_items.product_id

payments.sale_id

inventory_movements.product_id
inventory_movements.reference_id
```

---

# 18. Testing Strategy

Testing is mandatory, not optional.

Use three levels.

## Level 1 — Unit Tests

Test pure business logic.

Target:

```text
Cart calculation
Tax calculation
Discount calculation
Payment calculation
Change calculation
Inventory calculation
Refund calculation
Validation
```

Target coverage:

```text
≥ 90% for business logic
```

---

## Level 2 — Integration Tests

Test:

```text
API
Database
Services
Transactions
Authentication
Authorization
```

Important integration scenarios:

```text
Create product
Search product
Adjust inventory
Create sale
Create payment
Update inventory
Refund sale
Generate reports
```

Target:

```text
≥ 80% for backend services
```

---

## Level 3 — E2E Tests

Use Playwright or equivalent.

Minimum E2E scenarios:

### E2E-01 Login

```text
Open application
→ Login
→ Dashboard appears
```

### E2E-02 Product

```text
Login
→ Products
→ Create product
→ Search product
```

### E2E-03 Sale

```text
Login
→ POS
→ Search product
→ Add to cart
→ Checkout
→ Cash payment
→ Receipt
```

### E2E-04 Inventory

```text
Create stock
→ Sell product
→ Verify stock decreased
```

### E2E-05 Refund

```text
Create sale
→ Open sale
→ Refund item
→ Verify inventory increased
```

### E2E-06 Register

```text
Open register
→ Complete sale
→ Close register
→ Verify cash reconciliation
```

Target:

```text
All critical user journeys must pass.
```

---

# 19. Coverage Requirements

Generate coverage reports on every CI run.

Minimum targets:

```text
Business logic:     90%
Backend services:   80%
Overall project:    75%
Critical workflows: 100%
```

Do not chase coverage by writing meaningless tests.

Coverage must represent meaningful behavior.

Critical workflows include:

```text
Authentication
Product creation
Inventory adjustment
Checkout
Payment
Inventory deduction
Refund
Cash register
```

---

# 20. Test Data

Create deterministic seed/test data.

Example:

```text
Admin
username: admin
password: test-password

Cashier
username: cashier
password: test-password
```

Products:

```text
COKE-001
Coca Cola
$2.00
Stock: 100

BURGER-001
Burger
$5.00
Stock: 50

WATER-001
Water
$1.00
Stock: 100
```

Never use production credentials in tests.

---

# 21. API Error Format

Use a consistent format:

```json
{
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Insufficient stock for product"
  }
}
```

Example error codes:

```text
INVALID_REQUEST
UNAUTHORIZED
FORBIDDEN
NOT_FOUND
DUPLICATE_SKU
DUPLICATE_BARCODE
INSUFFICIENT_STOCK
INVALID_PAYMENT
SALE_NOT_FOUND
REFUND_EXCEEDS_QUANTITY
REGISTER_NOT_OPEN
INTERNAL_ERROR
```

---

# 22. Security Requirements

Implement:

- Password hashing
- Authentication
- Authorization
- Input validation
- SQL injection protection
- Rate limiting for login if appropriate
- Secure session/token handling
- No passwords in logs
- No sensitive payment information in logs

Never store raw card numbers or CVV.

For the MVP, treat card/QR payment as an external payment confirmation/reference.

---

# 23. Audit Requirements

For important operations record:

```text
user
action
entity
entity_id
timestamp
```

At minimum audit:

```text
Inventory adjustment
Sale void
Refund
Price change
User/role changes
Register close
```

---

# 24. UI Requirements

The POS interface should prioritize speed.

The cashier should be able to:

```text
Scan
→ Add
→ Pay
```

with minimal clicks.

Important UI states:

```text
Loading
Empty
Error
Success
Insufficient stock
Payment failure
Network/API failure
```

Do not make the UI visually complicated.

Prioritize:

```text
Fast
Readable
Keyboard friendly
Barcode scanner friendly
Mobile/tablet compatible where practical
```

---

# 25. Implementation Workflow

Follow this exact development loop for every feature:

```text
1. Inspect existing code
2. Define acceptance criteria
3. Implement database changes
4. Implement backend/service logic
5. Write unit tests
6. Implement API
7. Write integration tests
8. Implement UI
9. Write E2E test
10. Run formatter
11. Run linter
12. Run type checker
13. Run tests
14. Generate coverage
15. Fix failures
16. Review implementation
17. Only then move to next feature
```

Do not mark a feature as complete if its tests are failing.

---

# 26. Required Commands

Provide project scripts similar to:

```text
npm run dev
npm run build
npm run lint
npm run typecheck
npm run test
npm run test:watch
npm run test:coverage
npm run test:e2e
npm run db:migrate
npm run db:seed
```

CI should run:

```text
install
→ lint
→ typecheck
→ unit tests
→ integration tests
→ coverage
→ build
→ E2E tests
```

---

# 27. Definition of Done

A feature is DONE only when:

```text
[ ] Database implemented
[ ] Migration implemented
[ ] Backend implemented
[ ] Validation implemented
[ ] Authorization implemented
[ ] Unit tests written
[ ] Integration tests written
[ ] UI implemented
[ ] E2E test written when applicable
[ ] Error states handled
[ ] Loading states handled
[ ] Documentation updated
[ ] Lint passes
[ ] Typecheck passes
[ ] Tests pass
[ ] Coverage target passes
```

---

# 28. MVP Completion Criteria

The MVP is complete only when this complete scenario passes:

```text
1. Login as cashier
2. Open register
3. Search/scan product
4. Add 2 products
5. Change quantity
6. Apply discount
7. Calculate tax
8. Checkout
9. Pay with cash
10. Calculate change
11. Complete sale
12. Generate receipt
13. Verify sale in sales history
14. Verify inventory decreased
15. Refund one item
16. Verify inventory increased
17. Verify refund appears in history
18. View daily sales report
19. Close register
20. Verify cash reconciliation
```

Automate this as an end-to-end smoke test.

---

# 29. Important Implementation Constraint

Do NOT implement all features at once.

Work incrementally:

```text
P0 → test → verify

P1 → test → verify

P2 → test → verify

P3 → test → verify

P4 → test → verify

P5 → test → verify

...
```

At each stage:

1. Show what was implemented.
2. Show files changed.
3. Show database changes.
4. Show tests added.
5. Run tests.
6. Report coverage.
7. Report remaining issues.
8. Only then proceed.

If a test fails, fix the underlying implementation rather than weakening or deleting the test.

---

# 30. First Task

Start with **P0 — Foundation only**.

Before writing code:

1. Inspect the repository.
2. Identify the existing framework and dependencies.
3. Identify whether a database already exists.
4. Identify existing tests.
5. Identify existing conventions.
6. Propose the minimal implementation structure.

Then implement P0.

Do not implement P1 or later features until P0 is complete and tested.

At the end of P0, provide:

```text
Implementation summary
Files created/changed
Database changes
API endpoints
Tests added
Test results
Coverage results
Known issues
Next recommended phase
```

Keep the implementation simple, maintainable, and suitable for a small-to-medium business POS.
