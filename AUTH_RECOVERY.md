# Administrator login and recovery

## Findings

The credentials provider already used bcryptjs, normalized login emails, rejected inactive/soft-deleted users, and enforced eight attempts in a fixed 15-minute database window. API guards already checked the current account, roles, and sessionVersion. Those protections remain in place.

Normal seed deliberately preserved an existing password. Changing ADMIN_PASSWORD and rerunning seed therefore could not reset that password. The repository had no explicit CLI recovery path, and seed did not reactivate an existing inactive account. Failed attempts could block a newly corrected password until expiration. The seed's DIRECT_URL override also needed an explicit requirement to prevent fallback to the runtime datasource. These gaps are now covered by the administrative commands below.

Read-only checks on September 3, 2026 found that the account in the locally configured Supabase database existed, was active, had SUPER_ADMIN, was unlocked, and matched the locally configured ADMIN_PASSWORD. The local DATABASE_URL used transaction pooling on port 6543 but lacked `pgbouncer=true` and `connection_limit=1`; those options were added locally without changing credentials. Missing options can cause prepared-statement failures with transaction pooling. These findings do not establish what credentials or environment the Vercel deployment currently uses; its exact failure must be confirmed from its environment and server logs.

## Environment

Commands load `.env` in the repository root using dotenv. Existing shell environment variables take precedence. No command prints email, passwords, password hashes, or connection strings.

| Variable          | Where required                                | Value                                                                                   |
| ----------------- | --------------------------------------------- | --------------------------------------------------------------------------------------- |
| `ADMIN_EMAIL`     | Seed/bootstrap, reset, check                  | Target account email; trimmed and lowercased                                            |
| `ADMIN_PASSWORD`  | Seed/bootstrap and reset                      | Your chosen password, 12–72 UTF-8 bytes; never trimmed                                  |
| `DIRECT_URL`      | Seed, reset, check, Prisma migrations         | Supabase session pooler on port 5432 for the intended database                          |
| `DATABASE_URL`    | Vercel runtime; Prisma CLI schema environment | Supabase transaction pooler on port 6543, including `pgbouncer=true&connection_limit=1` |
| `NEXTAUTH_URL`    | Vercel runtime                                | Exact HTTPS origin of the deployment                                                    |
| `NEXTAUTH_SECRET` | Vercel runtime                                | Stable, strong secret shared by instances of that deployment                            |
| `SEED_DEMO_DATA`  | Optional seed setting                         | Leave `false`; only `true` inserts sample data                                          |

Connection shapes, with placeholders only:

```dotenv
DATABASE_URL="postgresql://USER:ENCODED_PASSWORD@HOST:6543/postgres?pgbouncer=true&connection_limit=1"
DIRECT_URL="postgresql://USER:ENCODED_PASSWORD@HOST:5432/postgres"
NEXTAUTH_URL="https://YOUR_DEPLOYMENT_HOST"
NEXTAUTH_SECRET="YOUR_STRONG_SECRET"
ADMIN_EMAIL="YOUR_ADMIN_EMAIL"
ADMIN_PASSWORD="YOUR_CHOSEN_PASSWORD"
SEED_DEMO_DATA="false"
```

Seed/reset/check explicitly construct Prisma with DIRECT_URL. The runtime Prisma client still uses DATABASE_URL. Prisma migrations use the existing schema's directUrl setting. Seed/reset/check do not require a working runtime connection; migrations may require both variables to satisfy schema validation. Administrative credentials need only exist in the environment used to run those commands; setting them on Vercel alone neither creates an account nor changes its password.

## Commands

From the repository root, after configuring the intended database and credentials:

```powershell
npm run check-admin
npm run reset-admin
npm run check-admin
```

`check-admin` reports only account existence, effective active status, SUPER_ADMIN membership, and current lockout. It does not verify a password. Reset fails clearly if the account does not exist. In that case, bootstrap it first:

```powershell
npm run seed
```

Seed upserts roles and the administrator's SUPER_ADMIN assignment. It creates a missing account, reactivates/restores the configured account, and preserves an existing password. It does not clear lockout; use the explicit reset command for recovery. With missing bootstrap credentials it prints setup guidance and creates no default account. Demo data remains opt-in.

`reset-admin` changes the password with bcryptjs cost 12, activates/restores the account, increments sessionVersion, clears its normalized email's login attempts, and records a secret-free audit event in one transaction. It preserves role assignments; seed ensures SUPER_ADMIN if the role is missing. Existing sessions are rejected by the fresh database checks in API guards; sign in again after resetting. A password reset changes database state immediately and alone does not require a Vercel redeploy.

## Deployment and diagnosis

Deploy these code changes to Vercel. Verify DATABASE_URL, NEXTAUTH_URL and NEXTAUTH_SECRET in the environment for the deployment you use (Production versus Preview), and redeploy after changing Vercel environment variables. Confirm the direct administrative connection and runtime connection address the same intended Supabase database. Do not run seed automatically during every build.

Browser errors remain generic. Vercel server logs now emit `auth.credentials` with a generated requestId, a SHA-256 hash of normalized email, and one of:

- `USER_NOT_FOUND`: no unique matching account; legacy case-variant duplicates fail closed.
- `INVALID_PASSWORD`: supplied password is missing, oversized, or fails bcrypt comparison.
- `USER_INACTIVE`: disabled or soft-deleted account.
- `RATE_LIMITED`: eight attempts were already reserved in the current 15-minute window.
- `DATABASE_ERROR`: authentication could not complete a database operation.

No raw database exception, credentials, or account record is logged. Repeated blocked requests do not extend the window. Expiration resets the counter atomically using the database clock. Successful authentication and explicit password changes clear that email's attempts. Login continues to support existing shorter passwords; all newly set passwords must satisfy the byte policy.

No Prisma schema changes or new migrations are needed for this fix. Existing migrations containing User.sessionVersion and LoginAttempt must already be applied.

## Verification

```powershell
npm install
npx prisma generate
npx prisma validate
npm test
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-local.ps1
```

The final command needs Docker. It creates and removes only a disposable PostgreSQL verification container, applies migrations there, and runs the integration suites. Recovery tests cover real lockout expiration and reset, bcrypt compatibility, password-preserving seed, role idempotency, and all three administrative CLI entry points with an intentionally unusable DATABASE_URL to verify DIRECT_URL routing. It does not reset a production account.

Verification completed on September 3, 2026: dependency installation (zero reported vulnerabilities), Prisma generation and validation, 100 unit/API tests, two database integration suites, the production build, and migration/schema drift verification all passed. The two integration suites are skipped by ordinary `npm test` and were run separately through the disposable database script. The configured Supabase account was inspected without resetting its password.

## Files changed

- `src/lib/auth/credentialPolicy.ts`: normalized email/key and shared byte validation/bcrypt policy.
- `src/lib/auth/credentials.ts`, `src/lib/auth/authOptions.ts`: credentials authentication, atomic lockout expiration and sanitized diagnostics.
- `src/lib/auth/admin.ts`: bootstrap, reset and status services.
- `scripts/admin-cli.ts`, `scripts/reset-admin.ts`, `scripts/check-admin.ts`: dotenv loading, required DIRECT_URL, safe CLI output and clean disconnect.
- `prisma/seed.ts`: password-preserving bootstrap, active account and role repair, setup guidance, explicit administrative connection.
- `src/app/api/account/password/route.ts`, `src/app/api/users/route.ts`: shared password policy and lockout clearing on password changes.
- `src/app/login/page.tsx`: normalized submission, busy guard, disabled fields and accessible loading state.
- `src/app/account/page.tsx`, `src/app/users/page.tsx`: password byte policy wording and compatible form constraints.
- `package.json`, `package-lock.json`: commands and dotenv dependency.
- `tests/unit/auth.test.ts`, `tests/unit/adminCli.test.ts`, `tests/integration/auth.test.ts`: authentication and administrative recovery coverage.
- `tests/integration/workflow.test.ts`: explicit user-array type for strict TypeScript verification.
- `scripts/verify-local.ps1`: executes both integration suites.
- `.env.example`, `README.md`, `AUTH_RECOVERY.md`: environment and recovery instructions.
- Local ignored `.env`: required runtime pooling options added; credentials preserved. This local change is not part of Git and does not update Vercel.
