# Database

Postgres via Prisma. Full schema in `prisma/schema.prisma`, annotated
with `[CORE]` / `[STUB]` status comments per section.

## Core entity relationships

```
User --UserRole--> Role --> Permission

Party (CLIENT/CONSULTANT/CONTRACTOR/SUPPLIER/...)
  └─ Project (client, consultant)
       ├─ ProjectAssignment (user, role label)
       ├─ ProjectRevision (versioned snapshots)
       ├─ BOQ
       │    └─ BOQItem (rawDescription, parsedSpec JSON, status,
       │                matchedComponentId, matchScore, matchReason)
       ├─ Panel
       │    ├─ PanelSection
       │    ├─ PanelComponent (componentId, quantity, laborHours, overridePrice)
       │    └─ EngineeringCalculation (type, inputs JSON, outputs JSON, status)
       └─ Quote
            ├─ QuoteItem
            └─ QuoteRevision (versioned snapshots, never overwritten)

Component (catalog)
  ├─ ComponentAccessory (REQUIRED/RECOMMENDED/OPTIONAL)
  └─ SupplierPrice / SupplierDiscount (via Party of type SUPPLIER)

LaborRate / OverheadRule / MarginRule — commercial configuration
ExchangeRate — currency
AuditLog — every sensitive write, userId/action/entity/entityId/old/new
```

## Design notes

- **Soft deletes**: `deletedAt` on `User`, `Party`, `Project`. Queries in
  the implemented routes filter on `deletedAt: null` where it matters
  (e.g. `GET /api/projects`); apply the same filter as you add routes for
  the other soft-deletable models.
- **Revisions are additive**: `Quote` uses `(projectId, quoteNumber,
  revision)` as a unique key — a new revision is always a new row, never
  an update to the previous one. `QuoteRevision` additionally stores a
  full JSON snapshot at each significant change (e.g. approval) for
  audit/diff purposes. `ProjectRevision` follows the same pattern.
- **`BOQItem.parsedSpec` is JSON, not normalized columns.** This is
  intentional: the parser's output shape (`ParsedSpec` in
  `boqParser.ts`) evolves independently of the DB schema, and BOQ line
  items are read far more than they're queried by individual spec
  fields. If you need to query "all BOQ items requiring a 36kA MCCB"
  across projects, add a Postgres GIN index on the JSON column rather
  than normalizing.
- **`EngineeringCalculation.status`** (`PRELIMINARY` /
  `ENGINEER_VERIFIED` / `APPROVED`) is the enforcement point for the
  platform-wide safety rule that no automatically generated calculation
  is presented as certified final design (spec Section 58). Any new
  calculator you add should write into this same table with the same
  default.
- **Enums vs free text**: `ComponentCategory`, `PartyType`, `RoleName`,
  `ProjectStatus`, `QuoteStatus`, `BOQItemStatus`, `CalcStatus` are
  Prisma enums (Postgres native enums). `Panel.panelType`,
  `PanelSection.name`, trip types, etc. are left as free-text strings
  deliberately — they're closer to configurable taxonomy than fixed
  business states, and locking them to enums would make the "Standards
  and calculations must be configurable" requirement (Section 48) harder
  to satisfy without a migration every time a new panel type or standard
  is added.

## Migrations

```bash
npx prisma migrate dev --name <description>   # dev: creates + applies a migration
npx prisma migrate deploy                       # prod: applies pending migrations only
npx prisma studio                                # visual DB browser
```

Checked-in migrations under `prisma/migrations` are the database source of
truth. Use `prisma migrate dev` to create migrations locally and
`prisma migrate deploy` in CI or as a deliberate release step. Do not use
`prisma db push` as a production deployment strategy.
