# Tenant Portal Proof-of-Concept

This folder is an isolated tenant/partner portal scaffold.
It is intentionally separate from the main repository so your existing project is not changed.

## Goals

- demonstrate a first-class tenant schema
- keep tenant identity in session payloads
- show tenant-aware API routes
- provide a partner config model for per-tenant settings

## How to use

1. Copy `.env.example` to `.env` and set `DATABASE_URL`, `JWT_SECRET`, and `API_KEY_PEPPER`.
2. Install dependencies from `tenant-portal`:
   ```bash
   cd tenant-portal
   npm install
   ```
3. For PostgreSQL use:
   ```bash
   npm run prisma:generate
   npm run prisma:migrate:dev
   npm run dev
   ```
   For local SQLite fallback use:
   ```bash
   export DATABASE_URL="file:./dev.db"
   npm run prisma:generate:sqlite
   npm run prisma:migrate:dev:sqlite
   npm run dev
   ```
4. Visit `/admin` in the portal to create a seeded tenant and admin user for testing.
5. Review `src/lib/auth.ts` and `src/app/api` for tenant session flow.

## Partner API (public)

The portal exposes a simple public Partner API authenticated by a per-tenant API key.

- Public endpoint: `GET /api/public/partner?apiKey=<key>` or `Authorization: Bearer <key>`
- Returns: tenant summary and partner config (`plan`, `metadata`)

Example curl:

```bash
curl -s "http://localhost:3000/api/public/partner?apiKey=demo-api-key-123" | jq
```

Use the admin UI at ` /admin/tenants/<tenantId>` to generate/regenerate an API key.

## Admin seed

Use `GET /api/admin/seed` (from the `/admin` page) to create a demo tenant, partner config and admin user.
The seed creates an admin account `admin@demo.local` with password `DemoPass123!` and an API key `demo-api-key-123` for quick testing.

## Examples

Run the example partner client (requires the portal running on localhost:3000):

```bash
cd tenant-portal
npm run example:partner-client
```

Seed the demo tenant and call the public partner API end-to-end:

```bash
cd tenant-portal
npm run example:seed-and-call
```

Note: after changing `prisma/schema.prisma` you should run Prisma migrations locally to update your database schema:

```bash
cd tenant-portal
npm run prisma:migrate:dev
```

If you are using the SQLite fallback, run:

```bash
cd tenant-portal
npm run prisma:migrate:dev:sqlite
```

Security note: API keys are stored using an HMAC-SHA256 keyed hash. Set a strong pepper in your environment with `API_KEY_PEPPER` so the stored `apiKeyHash` cannot be used to reverse keys. The public API verifies the provided key by applying the same HMAC and comparing it to the stored hash. When you generate/regenerate a key the plaintext value is returned once by the API — store it safely.

Set `API_KEY_PEPPER` in `.env` to a long random string before running migrations and seeding.



## Files created

- `prisma/schema.prisma` — tenant + partner config schema
- `src/lib/auth.ts` — session token generation and `tenantId` handling
- `src/app/api/tenant/route.ts` — tenant-aware lookup
- `src/app/api/partner/route.ts` — partner config for current tenant
- `src/app/page.tsx` — example portal landing page

## Notes

This is an experimental workspace. It does not modify your main project.
Once you approve the design, we can integrate the same tenant model and auth flow into your existing repo.
