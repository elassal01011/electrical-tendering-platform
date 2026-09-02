# Electrical Tendering, CPQ & Panel Engineering Platform

A tendering / estimation / CPQ platform for electrical panel-building and
contracting companies. This repository is a **working foundation**, not a
finished 60-module ERP — see "What's implemented" below before you plan
around it.

## What's implemented (depth-first, per the agreed scope)

The core differentiator workflow is real and tested end-to-end:

```
BOQ text  →  parser  →  component matching engine  →  panel BOM
          →  pricing engine (cost/discount/labor/overhead/markup)
          →  quote (versioned)  →  Excel export
```

- **Database**: full Prisma schema for the core entities (auth/RBAC, CRM
  parties, projects, BOQ, catalog, suppliers, panels/BOM, engineering
  calculations, quotes/revisions, audit log). Extension-only modules (SLD
  editor, PDF technical/commercial offers, inventory/procurement, ERP
  adapters) are modeled as tables but have **no business logic or UI** yet
  — see the `[STUB]` markers in `prisma/schema.prisma`.
- **Auth & RBAC**: NextAuth credentials login, all 14 roles from the spec,
  a permission-check helper used by every API route, audit logging on
  every write.
- **BOQ parser** (`src/lib/services/matching/boqParser.ts`): rule-based
  extraction of category / manufacturer / current / poles / breaking
  capacity / voltage / trip type from free text.
- **Component matching engine**
  (`src/lib/services/matching/componentMatcher.ts`): weighted scoring
  against the catalog, ranked alternatives, and an explicit safety rule —
  it will **never** auto-select a component that is under-rated on
  current or breaking capacity, even if it scores highest.
- **Pricing engine** (`src/lib/services/pricing/pricingEngine.ts`): the
  exact cost/discount/labor/overhead/markup/gross-margin formulas from the
  spec, always returns both markup% and gross margin% side by side.
- **Busbar sizing calculator**
  (`src/lib/services/calculations/busbarCalculator.ts`): preliminary
  copper sizing, every result tagged `PRELIMINARY` per the engineering
  safety rule (never presented as certified design).
- **API routes**: projects, BOQ import, BOQ auto-match, component catalog,
  panels + live BOM pricing, panel engineering calculations, quotes
  (versioned, never overwritten), quote approval, Excel export of a panel
  BOM.
- **UI**: login, dashboard (project pipeline), BOQ import + matching
  screen, panel BOM + live pricing screen with Excel export.
- **Tests**: 24 unit tests covering the parser, matcher, pricing engine,
  and busbar calculator (`npm test`).
- **Seed data**: the "Zed Towers - Phase 4" demo project from the spec,
  with sample clients, suppliers, catalog components, panels, and a BOQ
  ready to run through the matching engine.

## What's explicitly stubbed / not built

These have a correct database shape and are clean extension points, but
no working code yet:

- SLD graphical editor
- PDF technical offer / commercial offer generation (Excel export of one
  document type — panel BOM — is real; the other 7 export types listed in
  the spec share the same ExcelJS setup and are a direct extension)
- Document upload/storage pipeline (S3 adapter)
- Supplier RFQ workflow, inventory, procurement, purchase orders
- ERP adapters (Odoo/SAP/Dynamics) — interface only
- AI-assisted BOQ enrichment layer (the deterministic matcher does the
  real work; this would sit alongside it, never replace it)
- Full commercial-rules UI (per-client/per-category margin overrides) —
  the pricing engine supports it, the UI to configure it doesn't exist yet
- Notifications (email/in-app), 2FA, currency live-rate API, global search

Do not deploy this as-is to production without finishing the auth
hardening (rate limiting, CSRF review, file upload validation) called out
in spec Section 46 — none of that is implemented beyond password hashing
and session handling.

## Getting started

### Option A — Docker (recommended)

```bash
cp .env.example .env   # edit NEXTAUTH_SECRET at minimum
docker compose up
```

The container automatically creates/synchronizes the database schema and seeds the demo account on first startup.

Visit http://localhost:3000 and log in with:

```
email:    admin@tendering.local
password: ChangeMe123!
```

(Sample credential — change immediately, this is seed data.)

### Option B — Local Node + local Postgres

```bash
cp .env.example .env   # point DATABASE_URL at your local Postgres
npm install
npx prisma db push
npm run seed
npm run dev
```

### Running tests

```bash
npm test
```

## Suggested next steps, in priority order

1. Finish the panel configurator UI (drag-drop from catalog into
   sections) — the API (`/api/panels/:id`) already supports it.
2. Wire the enclosure sizing and thermal calculators alongside the
   busbar one — same `EngineeringCalculation` table, same pattern.
3. PDF technical/commercial offer generation via Puppeteer, using the
   Excel export route as the data-shape reference.
4. Document upload pipeline (S3-compatible) to unlock the tender
   document management module.
5. Supplier RFQ workflow and quote-vs-quote comparison UI.

See `ARCHITECTURE.md` and `DATABASE.md` for more detail on how the
pieces fit together.

## Supplier pricing / applying prices

The pricing workflow now includes a Supplier Pricing screen at `/pricing` and an `Apply Best Available Prices` action on the BOQ screen. Supplier prices can be entered manually or imported from Excel using columns `Supplier`, `Manufacturer`, `Part Number`, `Price` and optional `Currency`, `Effective From`, `Effective To`.

After component matching, applying prices uses the lowest active supplier price for the matched component and applies the best active supplier discount for that supplier. If no supplier price exists, the component catalog list price is used as a fallback. Applied price, currency, supplier/source and timestamp are persisted on the BOQ line.
