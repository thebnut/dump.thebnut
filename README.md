# dump.thebnut

A tiny multi-tenant hub for static HTML/CSS/JS prototypes.

- Per-user logged-in dashboard
- Zip upload → Vercel Blob hosting at `/p/<slug>/`
- Optional per-project password gate (multiple labelled passwords)
- Access log per project (timestamp, IP, UA, password label, path)
- Admin can manage users and view all projects

Implements Linear [THE-22](https://linear.app/thebnut/issue/THE-22/dumpthebnutcom).

## Stack

- Next.js 16 (App Router) on Vercel
- Auth.js (next-auth v5) — credentials provider, JWT sessions
- Drizzle ORM + Vercel Postgres
- Vercel Blob for project files
- Tailwind v4

## Local development

```bash
npm install
cp .env.example .env.local   # fill in POSTGRES_URL, BLOB_READ_WRITE_TOKEN, AUTH_SECRET
npm run db:push              # apply schema to your DB
npm run user -- you@example.com 'password' admin
npm run dev
```

Open http://localhost:3000 and sign in.

## Database

Schema lives in `src/lib/db/schema.ts`.
Migrations are generated to `drizzle/` via `npm run db:generate`.
Use `npm run db:push` for local development; use `npm run db:migrate` in production deploys.

## Routes

- `/login` — credentials sign-in
- `/` — dashboard (your projects)
- `/projects/new` — zip upload
- `/projects/[slug]` — manage (settings, passwords, access log, delete)
- `/p/[slug]/[[...path]]` — public file serving (gates protected projects)
- `/gate/[slug]` — password entry for protected projects
- `/admin` — admin: list users, create users, see all projects

## Security notes

- Passwords (user and project) are stored as bcrypt hashes only.
- Project gate cookies are HMAC-signed with `AUTH_SECRET`, scoped to `/p/`, 24h TTL.
- Access logs store the matched password's **label**, never the raw password entered.
- File serving streams through the origin so we can log each HTML page load and apply the gate.
- Path traversal in zip uploads is rejected (`../`, absolute paths, trailing-slash entries).
- 50 MB / 200 file upload cap.

## Deployment

This app is deployed to Vercel from the `main` branch of this repo.
Custom domains: `dump.thebnut.com` (primary) and `url.thebnut.com` (alias).

Required env vars on Vercel:

- `POSTGRES_URL` — set automatically by the Vercel Postgres integration
- `BLOB_READ_WRITE_TOKEN` — set automatically by the Vercel Blob integration
- `AUTH_SECRET` — generate with `openssl rand -base64 32`
- `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (optional) — bootstrap a first admin if no users exist

## Bootstrapping the first admin

After the first deploy, either run locally against the production DB:

```bash
POSTGRES_URL='...' npm run user -- brett@thebault.co.uk 'pw' admin
```

Or set `SEED_ADMIN_EMAIL` + `SEED_ADMIN_PASSWORD` env vars and run `npm run seed` (no-ops if any user exists).
