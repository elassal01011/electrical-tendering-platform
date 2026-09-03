# E-SOLUTIONS Tendering

Electrical Tendering · CPQ · Panel Engineering

An incremental upgrade of the existing Next.js / Prisma / Supabase / NextAuth application. The implemented workflow now covers client and project creation, reliable Excel BOQ import, engineer verification, supplier pricing, quotations, manager approvals, revisions and commercial exports.

See [IMPLEMENTATION_REPORT.md](IMPLEMENTATION_REPORT.md) for the precise delivered scope and remaining work. A successful local build is not a production deployment verification.

## Current capabilities

- In-memory Excel reading with authenticated 1 MB upload chunks, a configurable 10 MB default limit, column overrides, review counts and explicit treatment of invalid quantities. Legacy `.xls` is rejected with conversion guidance.
- Responsive E-SOLUTIONS shell; light/dark/system themes; searchable command palette; database-backed dashboard, clients, consultants, projects, components, suppliers and documents.
- Preliminary component suggestions, explicit engineer verification and blocked electrical rating shortfalls. Supplier comparisons use net prices and currency conversion.
- Quotation builder, draft editing, protected internal cost view, commercial discount/VAT, approval controls, immutable approved versions, new revisions, Excel exports and browser Print / Save PDF.
- Company profile/logo, configurable pricing profiles, exchange/labor rates, supplier discounts, users, role policy viewer, password changes and audit UI.
- Persistent login attempt limits, fresh database authorization on each API request, disabled-account/session revocation and safe bootstrap behavior.

## Verification

```bash
npm install
npx prisma generate
npx prisma validate
npm test
npm run build
npm audit
```

For the optional database integration suite on Windows with Docker running:

```powershell
./scripts/verify-local.ps1
```

The script uses a disposable PostgreSQL container on localhost port 55439. It tests migrations and the core API workflow, including a workbook above 4.5 MB. The integration suite mocks session retrieval while exercising actual database permission checks and the credentials authorization callback. It does not replace browser or deployed Vercel verification.

## Registration and Google sign-in

Users can register at `/signup` with name, username, email and password, then sign in with either email or username. Google sign-in is available on both authentication pages when its server credentials are configured. Account profile, password setup/change, pending approval and administrator session revocation are included. See [AUTH_SIGNUP_REPORT.md](AUTH_SIGNUP_REPORT.md) for the migration, API inventory, security behavior and verification results.

```dotenv
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
DEFAULT_SIGNUP_ROLE="E_SOLUTIONS_USER"
SIGNUP_REQUIRES_APPROVAL="false"
```

`E_SOLUTIONS_USER` is the default role. It grants broad working access to projects/tenders, clients, consultants, BOQ/Excel import/matching, panel engineering, components, suppliers, pricing/costing, quotations, document upload and existing report/export workflows. It excludes user/role administration, company/security settings, audit access, quotation approval and document deletion. Existing SUPER_ADMIN permissions remain intact. An explicitly configured role must be a valid enum value with an existing Role record; invalid configuration stops registration.

> **SECURITY WARNING: `DEFAULT_SIGNUP_ROLE=SUPER_ADMIN` gives every new registrant full administrative control. Never use this setting for an open public signup page. It is accepted only when explicitly configured and the SUPER_ADMIN role already exists. Other highly privileged roles, including GENERAL_MANAGER, also require care.**

With `SIGNUP_REQUIRES_APPROVAL=true`, new credentials and Google accounts remain inactive until an administrator activates them from Users → Review / approve → Account status → Active. With `false`, newly registered users immediately receive the configured role. For a private company workspace, review this setting before exposing public registration: standard users can access the company's shared tendering data.

### Configure Google OAuth

1. Open [Google Cloud Console credentials](https://console.cloud.google.com/apis/credentials) and select/create your application project.
2. Configure the OAuth consent screen (Google Auth Platform → Branding/Audience when shown). Set your application name, support/contact details and appropriate audience. While in Testing, add your test Google accounts. Publish the consent configuration when ready for your intended users.
3. Open **APIs & Services → Credentials → Create Credentials → OAuth client ID**. Choose **Web application**.
4. Add these **Authorized JavaScript origins**, replacing the production placeholder with your stable domain:
   - `http://localhost:3000`
   - `https://YOUR-VERCEL-DOMAIN`
5. Add these exact **Authorized redirect URIs**:
   - `http://localhost:3000/api/auth/callback/google`
   - `https://YOUR-VERCEL-DOMAIN/api/auth/callback/google`
6. Copy the client ID and secret into your local `.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. In Vercel, add the same variables under **Project → Settings → Environment Variables**, selecting the intended Production/Preview environment. Never prefix them with `NEXT_PUBLIC_` or commit their values.
7. Set `NEXTAUTH_URL=http://localhost:3000` locally and `NEXTAUTH_URL=https://YOUR-VERCEL-DOMAIN` in production. Keep a strong, stable `NEXTAUTH_SECRET`. Redeploy after changing environment variables. Register any separately used preview callback explicitly; the application does not hard-code preview deployment URLs.
8. Visit `/signup` or `/login` and choose **Continue with Google**. Existing users are resolved through their Google subject link or normalized verified email. Both flows return to `/dashboard` on success.

Google OAuth configuration and verified-email behavior follow the [NextAuth v4 Google provider documentation](https://next-auth.js.org/providers/google). The application requests only `openid email profile` and stores an identity link, not Google access/refresh tokens.

### Deploy the authentication migration

Configure the intended production `DATABASE_URL` and `DIRECT_URL` before running migration commands. Runtime remains on the Supabase transaction pooler (6543 with `pgbouncer=true&connection_limit=1`); migrations and admin commands use the session connection (5432).

```powershell
npm ci
npx prisma generate
npx prisma validate
npm test
npm run build
npx prisma migrate deploy
npx vercel deploy --prod
```

The two new migrations preserve existing users/passwords, permit nullable passwords for Google-only accounts, add optional usernames and OAuth identity links, and insert the standard role. Legacy users can choose a username on their account page. If legacy emails collide after lowercase/trim normalization, the migration stops without merging identities; resolve those duplicates before retrying. Do not use `prisma db push` for production. Seeding is not required to enable the default signup role after this migration, and build scripts do not mutate production data.

First-time Google linking to an **unverified public credentials signup** invalidates that account's previous password and sessions, preventing someone who pre-registered another person's email from retaining access. The verified owner can set a new local password on `/account`. Existing administrator-provisioned/legacy passwords are preserved when linked. Google-only password setup requires an authenticated, active, current-version session; later changes require the current password.

## Getting started

### Option A — Local Docker PostgreSQL

```bash
cp .env.example .env   # set NEXTAUTH_SECRET, ADMIN_EMAIL and ADMIN_PASSWORD
docker compose up
```

Docker Compose supplies both `DATABASE_URL` and `DIRECT_URL` for its local
PostgreSQL service. The container applies checked-in migrations. Bootstrap requires explicit ADMIN_EMAIL and ADMIN_PASSWORD; demo records require SEED_DEMO_DATA=true.

Visit http://localhost:3000 and sign in with your configured administrator credentials. There is no default password. Existing accounts are never reset by seeding or container startup.

For login diagnosis and administrator recovery, see [AUTH_RECOVERY.md](AUTH_RECOVERY.md). Configure `DIRECT_URL`, `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env`, then use `npm run check-admin` and `npm run reset-admin`. Changing `ADMIN_PASSWORD` alone does not change an existing account's password.

### Option B — Local Node + Supabase PostgreSQL

```bash
cp .env.example .env
# Fill DATABASE_URL, DIRECT_URL, NEXTAUTH_SECRET, NEXTAUTH_URL, ADMIN_EMAIL and ADMIN_PASSWORD in .env
npm install
npx prisma generate
npx prisma migrate deploy
npm run seed
npm run dev
```

Open http://localhost:3000.

`DATABASE_URL` must be the Supabase Transaction Pooler connection string,
usually on port `6543`. For Prisma/serverless compatibility, use the options
provided by Supabase; a typical form ends with
`?pgbouncer=true&connection_limit=1`.

`DIRECT_URL` must be the Supabase Session Pooler connection string, usually
on port `5432`. Prisma uses this direct/session connection for migrations.
Do not put either credential in source control.

Supabase is PostgreSQL hosting only in this application. Authentication
remains NextAuth and data access remains Prisma. The project intentionally
does not require `NEXT_PUBLIC_SUPABASE_URL`, a Supabase publishable key, or
Supabase browser/server SDK helpers.

Redis is not currently referenced by application code. `REDIS_URL` is
optional and the application does not fail when it is absent.

## Deploy to Vercel + Supabase

Set these Vercel environment variables for Production:

```text
DATABASE_URL=<Supabase Transaction Pooler URL, normally port 6543>
DIRECT_URL=<Supabase Session Pooler URL, normally port 5432>
NEXTAUTH_SECRET=<strong random secret>
NEXTAUTH_URL=https://YOUR-VERCEL-DOMAIN.vercel.app
NODE_ENV=production
```

Optional:

```text
REDIS_URL=<managed Redis URL, only if caching is added later>
```

Vercel runs `npm install` (which executes `prisma generate` through the
`postinstall` script) followed by `next build`. Docker is not required at
runtime on Vercel.

Database migrations must never be triggered from an HTTP/browser request.
Before releasing schema-dependent code, run the following deliberately from
a trusted workstation or CI environment with `DIRECT_URL` configured:

```bash
npx prisma migrate deploy
```

For local schema development, create new migrations with:

```bash
npx prisma migrate dev --name <descriptive-name>
```

### Running tests

```bash
npm test
```

## Scope and next steps

See [IMPLEMENTATION_REPORT.md](IMPLEMENTATION_REPORT.md) for completed, partial and deferred features, verification results, migration details, and deployment requirements.

See `ARCHITECTURE.md` and `DATABASE.md` for more detail on how the
pieces fit together.

## Supplier pricing / applying prices

The pricing workflow now includes a Supplier Pricing screen at `/pricing` and an `Apply Best Available Prices` action on the BOQ screen. Supplier prices can be entered manually or imported from Excel using columns `Supplier`, `Manufacturer`, `Part Number`, `Price` and optional `Currency`, `Effective From`, `Effective To`.

After engineer verification, applying prices compares discounted active supplier offers converted to the project currency using stored rates. It excludes offers without a usable conversion. If no supplier price exists, the component catalog list price is used as a fallback. Applied price, currency, supplier/source and timestamp are persisted on the BOQ line.
