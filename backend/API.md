# Backend API contract

Base URL `http://localhost:3000/api/v1`. JSON camelCase fields. Money is decimal strings (`"15000.00"`); send money as strings. UUID IDs. Bearer authentication required except login. No default credentials. Lists return arrays, newest first, capped at 200. Errors `{statusCode,message}`; validation 400, authentication 401, forbidden 403, missing 404, conflict 409, unavailable 503.

## Authentication
- `POST /auth/login` `{email,password}` → `{token,user:{id,email,fullName,role}}`. Token expires after 12 hours.
- `GET /auth/me` → user.
- `POST /auth/logout` invalidates current token.

Roles: `superadmin`, `finance_admin`, `cashier`, `hardware_tech`, `software_dev`. All authenticated roles read operational lists. Finance ledger/dashboard/invoices restricted to superadmin/finance_admin. Cashier may read invoices. Writes: customers superadmin/finance_admin/cashier; inventory and stock adjustment superadmin; orders superadmin/cashier; repairs superadmin/hardware_tech/cashier (state changes superadmin/hardware_tech); projects superadmin/software_dev; payments superadmin/finance_admin/cashier.

## Resources
- `GET /customers` → `[{id,fullName,phoneNumber,email,address,createdAt}]`
- `POST /customers` `{fullName,phoneNumber,email?,address?}` → customer.
- `GET /inventory` → `[{id,sku,name,category,costPrice,salePrice,currentStock,minimumThreshold,unitOfMeasure,createdAt}]`
- `POST /inventory` `{sku,name,category?,costPrice,salePrice,minimumThreshold?,unitOfMeasure?}` → item. Initial stock zero. Categories accessory/sparepart/raw_material_print/consumable.
- `POST /inventory/:id/adjust` `{quantity,reason}` → item. Quantity is signed nonzero integer delta; no negative resulting stock. Immutable stock movement plus inventory/equity journal.
- `GET /orders` → `[{id,orderNumber,customerId,totalAmount,invoiceId,items,createdAt}]`
- `POST /orders` `{customerId?,items:[{itemId,quantity}],paymentMethod:"cash",idempotencyKey}` → order. Positive integer quantities; repeated item IDs rejected. Same actor/key/body returns original order; changed body conflicts. Stock, invoice, cash payment, revenue and cost journals commit together.
- `GET /repairs` → `[{id,ticketNumber,customerId,deviceType,brand,modelName,declaredDefects,currentState,quotationAmount,quotationDescription,createdAt}]`
- `POST /repairs` `{customerId,deviceType,brand,modelName,declaredDefects}` → repair.
- `POST /repairs/:id/quotation` `{amount,description}` → repair. Superadmin/hardware_tech only. Labor-only, positive amount, editable during inspection_pending/diagnosed_quotation_ready only.
- `PATCH /repairs/:id/state` `{state,intakeEvidence?,approvalEvidence?,qcEvidence?}` → repair. Nonempty intakeEvidence required entering inspection_pending; quotation required before diagnosed_quotation_ready; approvalEvidence required entering repair_approved_in_progress from waiting_customer_approval; qcEvidence required entering ready_for_pickup. Evidence is a recorded staff attestation, not externally verified customer identity. States: ticket_created → inspection_pending → diagnosed_quotation_ready → waiting_customer_approval → repair_approved_in_progress → qa_qc_validation → ready_for_pickup → delivered_closed. In-progress may enter waiting_spareparts then return in-progress; QC may return in-progress. Cancellation before QC supported. Closing requires an existing fully paid service invoice. Entering ready_for_pickup atomically issues a labor invoice and receivable/service-revenue journal. Pay via invoice payment endpoint before closing. Closing never posts revenue again. Parts consumption and externally verified approvals remain unsupported.
- `GET /projects` → `[{id,projectCode,customerId,title,totalContractValue,targetDeliveryDate,scopeDescription,status,milestones,createdAt}]`
- `POST /projects` `{customerId,title,totalContractValue,targetDeliveryDate:"YYYY-MM-DD",scopeDescription}` → project. Creates one delivery milestone for full contract value, initially unbilled.
- `POST /projects/:id/milestones/:milestoneId/complete` `{}` → milestone. Marks delivery complete, creates agency invoice, recognizes receivable/revenue atomically. Same completed milestone returns existing record.
- `GET /invoices` → `[{id,invoiceNumber,customerId,sourceModule,sourceId,totalAmount,paidAmount,status,createdAt}]`
- `POST /invoices/:id/payments` `{amount,paymentMethod:"cash"|"manual_transfer",paymentReference}` → invoice. Reference globally unique; identical retry returns current invoice; changed payload conflicts. Rejects overpayment. Unconfigured gateway methods return 503.
- `GET /ledger` → `[{id,referenceType,referenceId,memo,createdAt,lines:[{accountCode,debit,credit}]}]`
- `GET /dashboard` → `{salesToday,outstandingReceivables,orderCount,customerCount,lowStockCount,openRepairs,activeProjects,integrations:{ppob:"unavailable",whatsapp:"unavailable",paymentGateway:"unavailable"}}`
- `POST /integrations/:provider` → 503; integrations are not simulated.

## Running
Node 22+, PostgreSQL 16+. Set `DATABASE_URL`, optionally `PORT` (3000), `CORS_ORIGIN` (http://localhost:3100). `npm install`; `npm run build`; `npm run migrate`; set `ADMIN_EMAIL` and `ADMIN_PASSWORD` (minimum 12 characters), then `npm run seed:admin`; `npm start`. Sample catalog only via `npm run seed:sample` (requires seeded admin); never automatic. `npm test` runs pure logic tests. `TEST_DATABASE_URL=... npm run test:db` runs isolated schema integration tests against a real PostgreSQL database. `npm run seed:demo` (root) upserts five local-trial demo accounts, one per role, sharing the password from `DEMO_PASSWORD` — known public credentials, never for production.

Scope excludes gateway processing, uploads, WhatsApp, parts consumption for repairs, externally verified approvals, refunds, taxes, multiple warehouses, contract deposits, client portal, scheduling, production backup/deployment. Runtime DB user should not own tables or have DDL privileges; use a separate migration owner. Serve behind HTTPS and production edge rate limiting. No Docker required.
