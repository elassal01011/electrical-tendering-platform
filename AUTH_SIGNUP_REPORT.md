# Signup and Google authentication implementation

## Delivered flow

The existing NextAuth credentials/JWT architecture and database authorization guards are retained. Public `/signup` collects name, username, email and confirmed password. Active accounts are automatically signed in and sent to `/dashboard`; an automatic-login failure goes to `/login?registered=1` with a success notice. Pending accounts go to `/login?pending=1` and cannot access protected APIs until approved.

Credentials login accepts `identifier` (email or username), trims/lowercases it and resolves the canonical account. Both aliases consume the same existing eight-attempt, 15-minute login budget. Expired attempts reset atomically against PostgreSQL's clock, success clears attempts, and explicit password resets still invalidate sessions and clear lockout. Legacy callers can continue supplying `email`.

Google is added only when both server-side OAuth credentials exist. NextAuth validates Google's OAuth/OIDC response, state and PKCE; the callback requires `email_verified=true` and a matching provider subject. `OAuthAccount` stores the Google subject link and user ID. No adapter was previously present. A Prisma adapter was not added because its automatic user/account lifecycle would bypass the application's explicit default-role, approval and session-version policies. This implementation uses the existing JWT sessions and a minimal identity-link model; no database Session or VerificationToken tables are needed.

## Data and migration

- `202609030001_signup_role/migration.sql` adds `E_SOLUTIONS_USER` to RoleName. This is separate so PostgreSQL commits the enum addition before its first use.
- `202609030002_signup_google/migration.sql` adds nullable unique username, nullable passwordHash, image, emailVerified, lastLoginAt, approvalPending, registrationMethod and OAuthAccount. It inserts the standard role.
- The existing `active` field remains the authoritative account-active flag; a second `isActive` field would duplicate state.
- Legacy usernames remain null until chosen. Existing user IDs, roles, password hashes and session versions are preserved. Existing emails are normalized after a collision preflight; a collision stops the migration rather than silently merging accounts.
- Database CHECK constraints enforce normalized email and lowercase valid usernames, and unique indexes resolve concurrent registration races.
- Default role: `E_SOLUTIONS_USER`. It provides access to the existing tendering workflows and exports without user administration, security settings, audit viewing, manager approval or destructive document deletion. This change does not build a separate reports module; existing report/export workflows remain available.

## API and page inventory

| Endpoint/page                | Behavior                                                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /api/auth/signup`      | Zod-validated public registration, bounded request size, same-origin checks, persistent email/IP rate limits, safe errors                        |
| `/api/auth/[...nextauth]`    | Existing credentials provider plus optional Google provider; Node runtime                                                                        |
| `GET /api/account`           | Current user's profile, role/status/authentication method; no hashes or provider tokens                                                          |
| `PATCH /api/account`         | Name/username changes, normalization, uniqueness and audit                                                                                       |
| `POST /api/account/password` | Existing-password verification or authenticated first Google-only password; compare-and-swap update, lockout clear and session-version increment |
| `GET /api/users`             | Authorized administrators see profile, username, role, status, auth method, created and last-login dates                                         |
| `PATCH /api/users`           | Existing access/password management plus explicit session revocation and pending-account activation                                              |
| `/signup`                    | New branded signup form, validation feedback, Google button, show/hide password and requirements                                                 |
| `/login`                     | Email/username login, Google, create-account link, approval/success/error messages                                                               |
| `/account`                   | Profile/image/status/method, name/username edits, password setup/change                                                                          |
| `/users`                     | Pending-user review and access actions; image with initials fallback                                                                             |

## Linking and authorization protections

- Google subject identity is authoritative after linking. The application never links by username, trusts a client JSON Google profile, accepts an unverified email, transfers a linked subject to another account, or reactivates a disabled account through OAuth.
- Google can create a pending account when approval is required; subsequent attempts stay pending until an administrator activates it.
- First Google linking to an unverified public signup removes the previously unverified local password and increments sessionVersion. This closes the pre-registration takeover path where an attacker reserves another person's email. The verified owner can set a local password from their authenticated account page. Legacy/admin-provisioned account passwords are preserved.
- Authenticated API authorization continues to reload active/deleted status, current roles and sessionVersion from the database. Client session updates cannot change permissions or revive revoked sessions. Middleware protects internal pages and uses the existing permission map; `/login`, `/signup` and NextAuth routes are public.
- Login failures keep the browser message generic and emit sanitized server diagnostics plus LOGIN_FAILED audit records. Success records LOGIN_SUCCESS and lastLoginAt. Signup, Google signup/linking, profile/username edits, password changes, activation/deactivation, role changes and session revocation are audited without hashes or secrets.
- Standard role assignment occurs entirely on the server; extra signup JSON fields cannot select a role, active status or sessionVersion. Explicitly configured roles must already exist. SUPER_ADMIN never becomes the fallback.
- New signup/account passwords require at least 12 characters and at most 72 UTF-8 bytes; bcryptjs cost 12 is used throughout. Existing shorter passwords remain usable at login for compatibility. Admin bootstrap/reset retains its established 12–72-byte policy.
- Signup allows 10 attempts per IP/hour and five per normalized email/hour. Vercel's trusted `x-vercel-forwarded-for` header is used only when running on Vercel; other hosts share a conservative fallback bucket rather than trusting arbitrary forwarded headers. Login and signup keys are separate. Blocked requests do not extend either window.
- Callback redirects are limited to the same origin. Google images accept HTTPS googleusercontent.com URLs and fall back to initials. Secrets and Google tokens are not included in sessions, JSON responses or client imports.

## Configuration and release

New variables: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, DEFAULT_SIGNUP_ROLE and SIGNUP_REQUIRES_APPROVAL. Existing NEXTAUTH_URL, NEXTAUTH_SECRET, DATABASE_URL and DIRECT_URL retain their purposes. `.env.example` supplies safe placeholders; no real Google credentials were configured or committed.

Follow the exact [Google Console and deployment steps in README](README.md#configure-google-oauth). The Google button explains that it is unavailable until both credentials are present. On Vercel, use the stable deployment domain for NEXTAUTH_URL and the registered callback, then redeploy after setting variables.

**Security warning:** configuring DEFAULT_SIGNUP_ROLE=SUPER_ADMIN intentionally grants full administrative control to every registrant. The application allows this only as an explicit configuration of an existing role. The default remains E_SOLUTIONS_USER. Public auto-approved registration grants broad access to the shared business workspace; use SIGNUP_REQUIRES_APPROVAL=true when accounts should be approved before accessing company data. This application does not add tenant isolation or email-delivery verification for credentials signup.

No production migration, seed or deployment is performed by this implementation. Google callback behavior is tested with validated-profile fixtures; live Google consent requires configured OAuth credentials and an end-to-end check on the intended deployment.

## Files changed

- `prisma/schema.prisma` and the two migration folders listed above.
- `src/lib/auth/authOptions.ts`, `credentials.ts`, `permissions.ts`, `account.ts`, `google.ts`, `http.ts`, `rateLimit.ts`, `registration.ts`, `signupPolicy.ts`.
- `src/types/next-auth.d.ts`, `src/middleware.ts`, `src/lib/client/signup.ts`.
- `src/app/api/auth/[...nextauth]/route.ts`, `src/app/api/auth/signup/route.ts`, `src/app/api/account/route.ts`, `src/app/api/account/password/route.ts`, `src/app/api/users/route.ts`.
- `src/app/signup/page.tsx`, `src/app/login/page.tsx`, `src/app/account/page.tsx`, `src/app/users/page.tsx`.
- `src/components/AppShell.tsx`, `src/components/Avatar.tsx`, `src/components/auth/GoogleButton.tsx`.
- `tests/unit/signup.test.ts`, `tests/integration/signup.test.ts`, and existing auth/workflow test adjustments.
- `.env.example`, `README.md`, `AUTH_SIGNUP_REPORT.md`.

`prisma/seed.ts` already upserts every RoleName and preserves admin passwords, so it automatically includes the new role without duplicating bootstrap logic. Runtime Prisma still uses DATABASE_URL; admin tooling still requires DIRECT_URL. No new runtime package or replacement authentication system is required.

## Verification results

Verified on September 3, 2026:

| Check                                  | Result                                                                                         |
| -------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `npm install`                          | Passed; zero reported vulnerabilities                                                          |
| `npx prisma generate`                  | Passed                                                                                         |
| `npx prisma validate`                  | Passed                                                                                         |
| `npx tsc --noEmit --incremental false` | Passed                                                                                         |
| `npm test`                             | 142 unit/API tests passed; database suites intentionally skipped here                          |
| `scripts/verify-local.ps1`             | 17 integration tests passed across three suites                                                |
| Migration deployment and schema drift  | Four migrations applied to disposable PostgreSQL; no difference detected                       |
| `npm run build`                        | Passed; 48 pages generated, including `/signup` and the new APIs                               |
| Browser JavaScript / changed-file scan | No configured secrets, passwordHash, PrismaClient or GOOGLE_CLIENT_SECRET in client JavaScript |

The bcrypt lockout test has a 20-second test timeout to accommodate repeated cost-12 comparisons under concurrent test load. Production rate-limit settings are unchanged. Verification containers were removed after each run. Google consent and the deployed Vercel environment remain unverified because OAuth credentials are not configured locally.

## Reference documentation

- [NextAuth Google provider and verified email](https://next-auth.js.org/providers/google)
- [NextAuth sign-in, JWT, session and redirect callbacks](https://next-auth.js.org/configuration/callbacks)
- [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
- [Vercel request headers](https://vercel.com/docs/headers/request-headers)
